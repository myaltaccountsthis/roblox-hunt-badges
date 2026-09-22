'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, RefreshCw, Radio, ShieldCheck, CircleHelp, Clock3, AlertTriangle, Check, Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import catalog from '@/data/badges.json';
import seedIcons from '@/data/game-icons.json';
import type { BadgeRow as Row, Snapshot, Preference } from '@/lib/types';

const number = (value?: number) => value == null ? '—' : new Intl.NumberFormat('en-US').format(value);
const labels: Record<string, string> = { confirmed: 'Secret quest', candidate: 'Candidate', unconfirmed: 'Reference only', provided: 'Hub badge', 'user-confirmed': 'Confirmed by you' };
const time = (value: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Waiting for Roblox';
const PREF_KEY = 'roblox20-badge-choices-v1';
const COMPLETED_KEY = 'roblox20-badge-completed-v1';
const HIDE_COMPLETED_KEY = 'roblox20-hide-completed-v1';
const THRESHOLD_KEY = 'roblox20-highlight-threshold-v1';
const NOTIFY_KEY = 'roblox20-enable-notifications-v1';
const NOTIFY_COUNTS_KEY = 'roblox20-notification-counts-v1';
const NOTIFY_SOUND_KEY = 'roblox20-notification-sound-v1';
const COUNT_HISTORY_KEY = 'roblox20-badge-counts-v1';
const gameUniverseIds = new Set(catalog.badges.filter(b => b.group === 'game').map(b => b.universeId));

function Identity({ row }: { row: Row }) {
  return <span className={`identity ${row.status}`} title={row.note}>{['confirmed', 'user-confirmed'].includes(row.status) ? <ShieldCheck size={14} /> : <CircleHelp size={14} />}{labels[row.status]}</span>;
}

function GameIcon({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img className="game-icon" src={src} alt={`${name} icon`} width={48} height={48} loading="lazy" onError={() => setFailed(true)} /> : <span className="game-icon icon-fallback" aria-label={name}>{name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()}</span>;
}

export default function Home() {
  const [rows, setRows] = useState<Row[]>(catalog.badges);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [catalogCheckedAt, setCatalogCheckedAt] = useState(catalog.checkedAt);
  const [icons, setIcons] = useState<Record<string, string>>(seedIcons);
  const [preferences, setPreferences] = useState<Record<string, Preference>>({});
  const prefsRef = useRef<Record<string, Preference>>({});
  const choiceVersion = useRef(0);
  const [notice, setNotice] = useState('');
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [hideCompleted, setHideCompleted] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [badgeInput, setBadgeInput] = useState('');
  const [markConfirmed, setMarkConfirmed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [remaining, setRemaining] = useState(60);
  const running = useRef(false);
  const nextAt = useRef(0);
  const alive = useRef(true);
  const [threshold, setThreshold] = useState(5);
  const [enableNotifications, setEnableNotifications] = useState(false);
  const [enableNotificationSound, setEnableNotificationSound] = useState(false);
  const soundEnabledRef = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const notificationBaselinePending = useRef(false);
  const previousAwardCounts = useRef<Record<string, number>>({});
  const previousDisplayedCounts = useRef<Record<string, number>>({});
  const [countChanges, setCountChanges] = useState<Record<string, number>>({});

  const getAwardCounts = (source: Row[]) => Object.fromEntries(source.filter(row => row.badgeId && row.data).map(row => [row.badgeId!, row.data!.statistics.awardedCount])) as Record<string, number>;
  const saveAwardCounts = (counts: Record<string, number>) => {
    previousAwardCounts.current = counts;
    try { localStorage.setItem(NOTIFY_COUNTS_KEY, JSON.stringify(counts)); } catch {}
  };
  const trackAwardChanges = (source: Row[]) => {
    const counts = getAwardCounts(source);
    const changes: Record<string, number> = {};
    for (const [badgeId, current] of Object.entries(counts)) {
      const previous = previousDisplayedCounts.current[badgeId];
      if (previous !== undefined && previous !== current) changes[badgeId] = current - previous;
    }
    previousDisplayedCounts.current = counts;
    try { localStorage.setItem(COUNT_HISTORY_KEY, JSON.stringify(counts)); } catch {}
    setCountChanges(changes);
  };
  const countChangeStyle = (change: number, current: number) => {
    if (change <= 0) return undefined;
    const previous = Math.max(1, current - change);
    const percentGain = (change / previous) * 100;
    const intensity = Math.min(1, Math.log2(percentGain + 1) / Math.log2(11));
    return { color: "hsl(151 " + Math.round(24 + intensity * 46) + "% " + Math.round(42 - intensity * 12) + "%)" };
  };
  const getAudioContext = () => {
    if (typeof window === 'undefined') return null;
    try {
      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      const context = audioContext.current ?? new AudioContextCtor();
      audioContext.current = context;
      void context.resume();
      return context;
    } catch { return null; }
  };
  const playNotificationSound = () => {
    if (!soundEnabledRef.current) return;
    const context = getAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  };
  const sendNotification = (title: string, options?: NotificationOptions) => {
    if (!enableNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(title, options);
    playNotificationSound();
  };

  const checkAndNotify = (newRows: Row[]) => {
    if (!enableNotifications) return;
    if (notificationBaselinePending.current) {
      saveAwardCounts(getAwardCounts(newRows));
      notificationBaselinePending.current = false;
      return;
    }
    for (const row of newRows) {
      const badgeId = row.badgeId;
      if (!badgeId || !row.data) continue;
      const current = row.data.statistics.awardedCount;
      const previous = previousAwardCounts.current[badgeId];
      if (previous !== undefined) {
        const crossedThreshold = previous < threshold && current > threshold;
        const belowThreshold = current > previous && current <= threshold;
        if (belowThreshold || crossedThreshold) sendNotification(row.game + ': ' + row.badgeName, { body: current + ' award' + (current === 1 ? '' : 's') + ' received!', tag: badgeId });
      }
    }
    saveAwardCounts(getAwardCounts(newRows));
  };

  const refresh = useCallback(async (force = false) => {
    if (running.current) return;
    running.current = true;
    nextAt.current = Date.now() + 60000;
    setBusy(true);
    setRemaining(60);
    setError('');
    const revision = choiceVersion.current;
    try {
      const selections = Object.entries(prefsRef.current).map(([universeId, choice]) => ({ universeId, badgeId: choice.badgeId }));
      const response = await fetch(`/api/badges${force ? '?force=1' : ''}`, { method: selections.length ? 'POST' : 'GET', ...(selections.length ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selections }) } : {}), cache: 'no-store', signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(response.status === 429 ? "You are refreshing too quickly. Please wait a few seconds before trying again. Your previous results are still shown; automatic refresh will retry." : `Refresh failed (${response.status}). Your previous results are still shown.`);
      const result: Snapshot = await response.json();
      if (!Array.isArray(result.badges) || result.badges.length !== catalog.badges.length) throw new Error('The response was incomplete. Your previous results are still shown.');
      if (!alive.current) return;
      if (revision !== choiceVersion.current) { nextAt.current = Date.now(); return; }
      const newRows = result.badges.map(row => {
        const prior = rows.find(item => item.badgeId === row.badgeId);
        return row.stale && !row.data && prior?.data ? { ...row, data: prior.data, fetchedAt: prior.fetchedAt } : row;
      });
      trackAwardChanges(newRows);
      checkAndNotify(newRows);
      setRows(newRows);
      setCheckedAt(result.checkedAt);
      setCatalogCheckedAt(result.catalogCheckedAt);
      if (result.icons) setIcons(result.icons);
      setLoaded(true);
      return { checkedAt: result.checkedAt, badgeCount: result.badges.length, failedCount: result.badges.filter(b => b.stale).length };
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : 'Roblox could not be reached. Try refreshing again.'); setRows(previous => previous.map(row => ({ ...row, stale: true }))); }
      return { error: e instanceof Error ? e.message : 'Refresh failed' };
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }, [threshold, enableNotifications]);

  useEffect(() => {
    alive.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
      const valid: Record<string, Preference> = {};
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [universeId, value] of Object.entries(saved)) {
        const choice = value as Preference;
        if (gameUniverseIds.has(universeId) && choice && typeof choice.badgeId === 'string' && /^[1-9]\d{0,19}$/.test(choice.badgeId) && typeof choice.confirmed === 'boolean') valid[universeId] = choice;
      }
      prefsRef.current = valid; setPreferences(valid);
      const savedCompleted = JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? '{}');
      const validCompleted: Record<string, boolean> = {};
      if (savedCompleted && typeof savedCompleted === 'object' && !Array.isArray(savedCompleted)) for (const [badgeId, value] of Object.entries(savedCompleted)) {
        if (/^[1-9]\d{0,19}$/.test(badgeId) && value === true) validCompleted[badgeId] = true;
      }
      setCompleted(validCompleted);
      setHideCompleted(localStorage.getItem(HIDE_COMPLETED_KEY) === '1');
      const savedThreshold = parseInt(localStorage.getItem(THRESHOLD_KEY) ?? '5', 10);
      if (savedThreshold >= 1 && savedThreshold <= 100) setThreshold(savedThreshold);
      const notificationsEnabled = localStorage.getItem(NOTIFY_KEY) === '1';
      setEnableNotifications(notificationsEnabled);
      const soundEnabled = localStorage.getItem(NOTIFY_SOUND_KEY) === '1';
      soundEnabledRef.current = soundEnabled;
      setEnableNotificationSound(soundEnabled);
      const savedCounts = JSON.parse(localStorage.getItem(NOTIFY_COUNTS_KEY) ?? '{}');
      const validCounts: Record<string, number> = {};
      if (savedCounts && typeof savedCounts === 'object' && !Array.isArray(savedCounts)) for (const [badgeId, value] of Object.entries(savedCounts)) {
        if (/^[1-9]\d{0,19}$/.test(badgeId) && typeof value === 'number' && Number.isFinite(value) && value >= 0) validCounts[badgeId] = value;
      }
      previousAwardCounts.current = validCounts;
      notificationBaselinePending.current = notificationsEnabled && Object.keys(validCounts).length === 0;
      const savedDisplayCounts = JSON.parse(localStorage.getItem(COUNT_HISTORY_KEY) ?? '{}');
      const validDisplayCounts: Record<string, number> = {};
      if (savedDisplayCounts && typeof savedDisplayCounts === 'object' && !Array.isArray(savedDisplayCounts)) for (const [badgeId, value] of Object.entries(savedDisplayCounts)) {
        if (/^[1-9]\d{0,19}$/.test(badgeId) && typeof value === 'number' && Number.isFinite(value) && value >= 0) validDisplayCounts[badgeId] = value;
      }
      previousDisplayedCounts.current = validDisplayCounts;
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } catch { setNotice('Browser storage is unavailable. Choices will last for this session.'); }
    void refresh();
    const tick = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((nextAt.current - Date.now()) / 1000)));
      if (Date.now() >= nextAt.current && !running.current) void refresh();
    }, 1000);
    return () => { alive.current = false; clearInterval(tick); };
  }, [refresh]);

  useEffect(() => {
    type ModelContext = { registerTool(tool: object, options: { signal: AbortSignal }): Promise<void> | void };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({ name: 'refresh_badges', title: 'Refresh badge counts', description: 'Fetch current Roblox badge statistics and update this dashboard.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async (input: unknown) => {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object');
        if (running.current) throw new Error('A refresh is already running');
        return refresh(true);
      } }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Experimental browser capability: normal controls remain available. */ }
    return () => lifecycle.abort();
  }, [refresh]);

  const displayRows = rows.map(row => preferences[row.universeId]?.badgeId === row.badgeId && preferences[row.universeId]?.confirmed && row.status !== 'confirmed' ? { ...row, status: 'user-confirmed', note: 'You confirmed this badge as the correct secret badge. This browser keeps your choice until you reset it.' } : row);
  const gameRows = displayRows.filter(row => row.group === 'game');
  const hubRows = displayRows.filter(row => row.group === 'hub');
  const failed = rows.filter(row => row.stale).length;
  const successes = rows.filter(row => row.data && !row.stale).length;
  const confirmed = gameRows.filter(row => ['confirmed', 'user-confirmed'].includes(row.status)).length;
  const candidates = gameRows.filter(row => row.status === 'candidate').length;
  const discoveryFailed = rows.filter(row => row.discoveryError).length;
  const highlighted = gameRows.filter(row => row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) >= threshold).length;
  function savePreferences(next: Record<string, Preference>) {
    choiceVersion.current++;
    prefsRef.current = next; setPreferences(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); }
    catch { setNotice('Choice saved for this session. Browser storage is unavailable.'); }
  }
  function confirm(row: Row) {
    if (!row.badgeId) return;
    setNotice(`${row.game}: badge confirmed. Saved in this browser.`);
    savePreferences({ ...prefsRef.current, [row.universeId]: { badgeId: row.badgeId, confirmed: true } });
  }
  function reset(row: Row) {
    const next = { ...prefsRef.current }; delete next[row.universeId];
    setNotice(`${row.game}: automatic badge discovery restored.`);
    savePreferences(next); nextAt.current = Date.now();
    if (!running.current) void refresh(true);
  }
  function openEditor(row: Row) { setEditing(row); setBadgeInput(''); setEditError(''); setMarkConfirmed(true); }
  async function saveBadge(event: React.FormEvent) {
    event.preventDefault(); if (!editing || saving) return;
    setSaving(true); setEditError('');
    try {
      let badgeId = badgeInput.trim();
      if (!/^\d+$/.test(badgeId)) {
        const url = new URL(badgeId);
        if (!['roblox.com', 'www.roblox.com'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Paste a badge ID or an https://www.roblox.com/badges/ link.');
        badgeId = url.pathname.match(/^\/badges\/(\d+)(?:\/|$)/)?.[1] ?? '';
      }
      if (!/^[1-9]\d{0,19}$/.test(badgeId)) throw new Error('Enter a valid numeric Roblox badge ID.');
      const response = await fetch('/api/badges/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ universeId: editing.universeId, badgeId }), signal: AbortSignal.timeout(45000) });
      const result = await response.json() as { data: NonNullable<Row['data']>; fetchedAt: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not verify this badge.');
      const replacement: Row = { ...editing, badgeId, badgeName: result.data.name, badgeUrl: `https://www.roblox.com/badges/${badgeId}`, status: 'candidate', note: 'Manually selected in this browser; secret-quest role is unconfirmed unless confirmed by you.', data: result.data, fetchedAt: result.fetchedAt, checkedAt: result.fetchedAt, stale: false, error: null, isNewest: undefined };
      setRows(previous => previous.map(row => row.universeId === editing.universeId ? replacement : row));
      setNotice(`${editing.game}: ${result.data.name} added${markConfirmed ? ' and confirmed' : ''}. Saved in this browser.`);
      savePreferences({ ...prefsRef.current, [editing.universeId]: { badgeId, confirmed: markConfirmed } });
      setEditing(null);
    } catch (e) { setEditError(e instanceof Error ? e.message : 'Could not add that badge.'); }
    finally { setSaving(false); }
  }
  function download(format: 'csv' | 'json') {
    const entries = displayRows.map(({ data, fetchedAt, stale, error: rowError, ...entry }) => ({ ...entry, badgeName: data?.name ?? entry.badgeName }));
    const columns = ['badgeId', 'game', 'badgeName', 'group', 'status', 'year', 'universeId', 'rootPlaceId', 'note', 'badgeUrl', 'gameUrl', 'checkedAt'];
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const contents = format === 'json' ? JSON.stringify({ ...catalog, checkedAt: catalogCheckedAt, badges: entries }, null, 2) : [columns.join(','), ...entries.map(entry => columns.map(key => quote((entry as Record<string, unknown>)[key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([contents], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `roblox20-badges.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function linkedBadgeIds(row: Row) {
    const paired = row.group === 'hub' ? gameRows.find(game => game.game === row.note) : hubRows.find(hub => hub.note === row.game);
    return [row.badgeId, paired?.badgeId].filter((id): id is string => !!id);
  }
  function isCompleted(row: Row) { return linkedBadgeIds(row).some(id => completed[id]); }
  function setCompletedBadge(row: Row, checked: boolean) {
    const ids = linkedBadgeIds(row);
    const next = checked ? { ...completed, ...Object.fromEntries(ids.map(id => [id, true])) } : Object.fromEntries(Object.entries(completed).filter(([id]) => !ids.includes(id)));
    setCompleted(next);
    try { localStorage.setItem(COMPLETED_KEY, JSON.stringify(next)); } catch { setNotice('Completion saved for this session. Browser storage is unavailable.'); }
  }
  function setHideCompletedPreference(value: boolean) {
    setHideCompleted(value);
    try { localStorage.setItem(HIDE_COMPLETED_KEY, value ? '1' : '0'); } catch { setNotice('Hide completed is set for this session. Browser storage is unavailable.'); }
  }
  function setThresholdPreference(value: number) {
    setThreshold(value);
    try { localStorage.setItem(THRESHOLD_KEY, String(value)); } catch {}
  }
  function setNotificationPreference(value: boolean) {
    setEnableNotifications(value);
    try { localStorage.setItem(NOTIFY_KEY, value ? '1' : '0'); } catch {}
    if (value) {
      const counts = getAwardCounts(rows);
      saveAwardCounts(counts);
      notificationBaselinePending.current = Object.keys(counts).length === 0;
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    } else notificationBaselinePending.current = false;
  }
  function setNotificationSoundPreference(value: boolean) {
    soundEnabledRef.current = value;
    setEnableNotificationSound(value);
    try { localStorage.setItem(NOTIFY_SOUND_KEY, value ? '1' : '0'); } catch {}
    if (value) void getAudioContext()?.resume();
  }
  const visibleGameRows = hideCompleted ? gameRows.filter(row => !isCompleted(row)) : gameRows;
  const visibleHubRows = hubRows;
  return <>
    <header className="site-header">
      <a href="/" className="brand" aria-label="The Hunt 20 badge watch home"><span className="brand-mark">20</span><span>THE HUNT<span className="brand-sub">BADGE WATCH</span></span></a>
      <a href={catalog.spotlightUrl} target="_blank" rel="noreferrer" className="event-link">Roblox 20 event <ArrowUpRight size={17} /></a>
    </header>
    <main>
      <div className="heading-row"><div><p className="eyebrow">THE SECRET PATH / 2006–2025</p><h1>Every badge. Every minute.</h1><p className="intro">Live award counts for the hub and all 20 event games.</p></div><Button variant="outline" className="download" onClick={() => download('csv')}><ArrowDownToLine /> Badge IDs</Button></div>
      <section className="monitor" aria-label="Refresh status">
        <div className="monitor-label"><Radio size={19} /><div><strong>{busy ? 'Checking Roblox' : successes === rows.length ? 'All badges up to date' : loaded ? `${successes} of ${rows.length} badges updated` : 'Connecting to Roblox'} </strong><span>Automatic refresh every 60 seconds</span></div></div>
        <div className="last-check"><span>Last check</span><strong>{time(checkedAt)}</strong></div>
        <div className="countdown"><Clock3 size={17} /><span>{busy ? 'Refreshing…' : `Next in ${String(remaining).padStart(2, '0')}s`}</span></div>
        <Button onClick={() => void refresh(true)} disabled={busy} className="refresh"><RefreshCw className={busy ? 'spinning' : ''} />{busy ? 'Refreshing' : 'Force refresh'}</Button>
      </section>
      <div aria-live="polite" className="messages">{error && <p className="warning"><AlertTriangle size={17} />{error}</p>}{!error && loaded && failed > 0 && <p className="warning"><AlertTriangle size={17} />{failed} badge{failed === 1 ? '' : 's'} could not update. Saved values are marked stale; the next refresh will retry.</p>}{discoveryFailed > 0 && <p className="warning"><AlertTriangle size={17} />Could not check {discoveryFailed} game catalogs for new badges. Previously selected badges are still tracked.</p>}{notice && <p className="notice"><Check size={16} />{notice}</p>}</div>
      <Tabs defaultValue="games" className="badge-tabs">
        <div className="tabs-row"><TabsList className="tab-list"><TabsTrigger value="games">Game badges <span>20</span></TabsTrigger><TabsTrigger value="hub">Hub badges <span>20</span></TabsTrigger></TabsList><span className="record-count">40 BADGES TRACKED</span></div>
        <TabsContent value="games">
          <div className="section-summary"><h2>Follow the fragments</h2><div className="legend"><span><i className="confirmed-dot" />{confirmed} identified</span><span><i className="candidate-dot" />{candidates} candidates</span><span><i className="reference-dot" />{20 - confirmed - candidates} reference only</span></div></div>
        <div className="completion-toolbar"><label className="confirm-checkbox"><Checkbox checked={hideCompleted} onCheckedChange={value => setHideCompletedPreference(value === true)} />Hide completed game badges</label><span>Completion is saved only in this browser.</span></div>
          <label className="confirm-checkbox"><Checkbox checked={enableNotifications} onCheckedChange={value => setNotificationPreference(value === true)} />Desktop notifications for award updates</label>
          <label className="confirm-checkbox"><Checkbox checked={enableNotificationSound} disabled={!enableNotifications} onCheckedChange={value => setNotificationSoundPreference(value === true)} />Play a sound with notifications</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0' }}>
            <label htmlFor="threshold-input" style={{ minWidth: '120px' }}>Highlight threshold:</label>
            <Input id="threshold-input" type="number" min="1" max="100" value={threshold} onChange={e => setThresholdPreference(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} style={{ width: '60px' }} />
            <span>{threshold}+ awards</span>
          </div>
          <p className="catalog-note">New, obscurely named badges are likely secret candidates, with an uncertainty note. "Reference only" means no secret badge was identified. New badges are checked every minute.</p>
          <div className="activity-key"><span><i />{highlighted} candidate or secret badges with {threshold}+ awards</span><span>Your confirmations and badge choices are saved in this browser.</span></div>
          <div className="table-wrap"><table><caption className="sr-only">Event game badge award counts. Candidate and reference badges are not confirmed secret quests.</caption><thead><tr><th>EVENT GAME / BADGE</th><th>IDENTIFICATION</th><th className="numeric">TOTAL AWARDED</th><th className="numeric">PAST 24 HOURS</th><th>COMPLETED</th><th>YOUR CHOICE</th></tr></thead><tbody>{visibleGameRows.map(row => <tr key={row.universeId} className={`${row.stale ? 'stale-row' : ''} ${row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) >= threshold ? 'active-badge' : ''}`}>
            <td><div className="game-cell"><div className="game-visual"><GameIcon src={icons[row.universeId]} name={row.game} /><span className="year">{row.year}</span></div><div className="badge-description"><a className="game-name" href={row.gameUrl} target="_blank" rel="noreferrer">{row.game}<ArrowUpRight size={13} /></a><a className="badge-name" href={row.badgeUrl ?? row.gameUrl} target="_blank" rel="noreferrer">{row.data?.name ?? row.badgeName}</a><span className="badge-id">{row.badgeId ?? 'No public badge'} · {row.data ? (row.data.enabled ? 'Enabled' : 'Disabled') : 'Loading'}</span>{row.stale && <span className="stale-note" title={row.error ?? ''}>{row.data ? `Stale · last updated ${time(row.fetchedAt ?? null)}` : 'Unavailable · retrying next refresh'}</span>}</div></div></td>
            <td><Identity row={row} /><details className="badge-note"><summary>Why this badge?</summary><p>{row.note}</p>{row.discoveryError && <p>{row.discoveryError}</p>}</details>{row.isNewest === false && <span className="selection-note">Newer badge excluded</span>}</td>
            <td className="numeric"><span className="total-value">{number(row.data?.statistics.awardedCount)}{row.badgeId && countChanges[row.badgeId] ? <span className={'count-change ' + (countChanges[row.badgeId] > 0 ? 'increase' : 'decrease')} style={countChangeStyle(countChanges[row.badgeId], row.data?.statistics.awardedCount ?? 0)}>{countChanges[row.badgeId] > 0 ? '+' : ''}{number(countChanges[row.badgeId])}</span> : null}</span>{row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) >= threshold && <span className="award-signal">{threshold}+ awarded</span>}</td><td className="numeric"><span className="day-value">{number(row.data?.statistics.pastDayAwardedCount)}</span></td>
            <td className="row-actions"><Checkbox checked={isCompleted(row)} onCheckedChange={value => setCompletedBadge(row, value === true)} aria-label={`Mark ${row.game} as completed`} disabled={!row.badgeId} /></td>
            <td className="row-actions">{row.status === 'candidate' && <Button variant="outline" size="sm" onClick={() => confirm(row)} disabled={!row.data || row.stale} aria-label={`Confirm ${row.game} badge`}><Check />Confirm</Button>}{row.status === 'user-confirmed' && <span className="your-confirmation"><Check size={15} />Saved</span>}<Button variant="ghost" size="sm" onClick={() => openEditor(row)} aria-label={`${row.status === 'unconfirmed' ? 'Add' : 'Change'} badge for ${row.game}`}>{row.status === 'unconfirmed' ? <Plus /> : <Pencil />}{row.status === 'unconfirmed' ? 'Add badge' : 'Change'}</Button>{preferences[row.universeId] && <button className="reset-choice" onClick={() => reset(row)} aria-label={`Reset ${row.game} badge choice`}>Reset choice</button>}</td>
          </tr>)}</tbody></table></div>
          {visibleGameRows.length === 0 && <p className="completion-empty">All game badges are completed. <button onClick={() => setHideCompletedPreference(false)}>Show completed badges</button></p>}
        </TabsContent>
        <TabsContent value="hub"><div className="section-summary"><h2>The hub collection</h2><span className="hub-label">S01 — S20</span></div><p className="catalog-note">All 20 supplied badges are awarded by The Hunt: Roblox 20 hub. Their S-numbers do not establish a mapping to individual games. Badges with {threshold}+ awards are yellow; badges you complete have a green outline.</p><div className="hub-grid">{visibleHubRows.map(row => <article className={`hub-card ${isCompleted(row) ? 'completed-badge' : row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) >= threshold ? 'active-badge' : ''}`} key={row.badgeId}><div className="hub-card-top"><GameIcon src={icons[row.universeId]} name={row.game} /><a href={row.badgeUrl!} target="_blank" rel="noreferrer">{row.data?.name ?? row.badgeName}<ArrowUpRight size={17} /></a><span className="hub-game-name">{row.note}</span></div><strong className="hub-total">{number(row.data?.statistics.awardedCount)}{row.badgeId && countChanges[row.badgeId] ? <span className={'count-change ' + (countChanges[row.badgeId] > 0 ? 'increase' : 'decrease')} style={countChangeStyle(countChanges[row.badgeId], row.data?.statistics.awardedCount ?? 0)}>{countChanges[row.badgeId] > 0 ? '+' : ''}{number(countChanges[row.badgeId])}</span> : null}</strong><span className="hub-total-label">total awarded · {row.data ? (row.data.enabled ? 'Enabled' : 'Disabled') : 'Loading'}</span><div className="hub-day"><span>Past 24 hours</span><strong>{number(row.data?.statistics.pastDayAwardedCount)}</strong></div><span className="badge-id">{row.badgeId}</span>{row.stale && <span className="stale-note">{row.data ? 'Stale · refresh pending' : 'Unavailable · retry pending'}</span>}<label className="hub-completion"><Checkbox checked={isCompleted(row)} onCheckedChange={value => setCompletedBadge(row, value === true)} aria-label={`Mark ${row.badgeName} as completed`} disabled={!row.badgeId} />Completed</label></article>)}</div>{visibleHubRows.length === 0 && <p className="completion-empty">All hub badges are completed. <button onClick={() => setHideCompletedPreference(false)}>Show completed badges</button></p>}</TabsContent>
      </Tabs>
      <footer><p><strong>About these counts</strong> · Public Roblox awards across all players. Enabled badges may still require an unreleased quest. No player login required.</p><div><span>Catalog checked {new Date(catalogCheckedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span><button className="text-download" onClick={() => download('json')}>Full catalog JSON <ArrowDownToLine size={14} /></button><a href="https://create.roblox.com/docs/cloud/reference/domains/badges" target="_blank" rel="noreferrer">Roblox API <ArrowUpRight size={14} /></a></div><p className="unofficial">Independent tracker. Not affiliated with Roblox.</p></footer>
      <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving) setEditing(null); }}><DialogContent className="badge-dialog"><DialogHeader><DialogTitle>Choose the secret badge</DialogTitle><DialogDescription>{editing?.game} · The badge must belong to this game.</DialogDescription></DialogHeader><form onSubmit={saveBadge}><label htmlFor="badge-input">Badge ID or Roblox badge link</label><Input id="badge-input" value={badgeInput} onChange={event => setBadgeInput(event.target.value)} placeholder="123456789 or https://www.roblox.com/badges/…" autoComplete="off" required aria-invalid={!!editError} aria-describedby={editError ? 'badge-error' : undefined} /><label className="confirm-checkbox"><Checkbox checked={markConfirmed} onCheckedChange={value => setMarkConfirmed(value === true)} />Mark this as the correct secret badge</label><p className="dialog-note">Your choice stays selected during automatic refreshes and is saved in this browser.</p>{editError && <p className="edit-error" id="badge-error" role="alert">{editError}</p>}<div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Checking badge…' : 'Save badge'}</Button></div></form></DialogContent></Dialog>
    </main>
  </>;
}
