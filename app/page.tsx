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
  const [editing, setEditing] = useState<Row | null>(null);
  const [badgeInput, setBadgeInput] = useState('');
  const [markConfirmed, setMarkConfirmed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [remaining, setRemaining] = useState(60);
  const running = useRef(false);
  const nextAt = useRef(0);
  const alive = useRef(true);

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
      if (!response.ok) throw new Error(`Refresh failed (${response.status}). Your previous results are still shown.`);
      const result: Snapshot = await response.json();
      if (!Array.isArray(result.badges) || result.badges.length !== catalog.badges.length) throw new Error('The response was incomplete. Your previous results are still shown.');
      if (!alive.current) return;
      if (revision !== choiceVersion.current) { nextAt.current = Date.now(); return; }
      setRows(previous => result.badges.map(row => {
        const prior = previous.find(item => item.badgeId === row.badgeId);
        return row.stale && !row.data && prior?.data ? { ...row, data: prior.data, fetchedAt: prior.fetchedAt } : row;
      }));
      setCheckedAt(result.checkedAt);
      setCatalogCheckedAt(result.catalogCheckedAt);
      if (result.icons) setIcons(result.icons);
      setLoaded(true);
      return { checkedAt: result.checkedAt, badgeCount: result.badges.length, failedCount: result.badges.filter(b => b.stale).length };
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : 'Roblox could not be reached. Try refreshing again.'); setRows(previous => previous.map(row => ({ ...row, stale: true }))); }
      return { error: e instanceof Error ? e.message : 'Refresh failed' };
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }, []);

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

  const displayRows = rows.map(row => preferences[row.universeId]?.badgeId === row.badgeId && preferences[row.universeId]?.confirmed ? { ...row, status: 'user-confirmed', note: 'You confirmed this badge as the correct secret badge. This browser keeps your choice until you reset it.' } : row);
  const gameRows = displayRows.filter(row => row.group === 'game');
  const hubRows = displayRows.filter(row => row.group === 'hub');
  const failed = rows.filter(row => row.stale).length;
  const successes = rows.filter(row => row.data && !row.stale).length;
  const confirmed = gameRows.filter(row => ['confirmed', 'user-confirmed'].includes(row.status)).length;
  const candidates = gameRows.filter(row => row.status === 'candidate').length;
  const discoveryFailed = rows.filter(row => row.discoveryError).length;
  const highlighted = gameRows.filter(row => row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) > 2).length;
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
          <p className="catalog-note">New, obscurely named badges are likely secret candidates, with an uncertainty note. “Reference only” means no secret badge was identified. New badges are checked every minute.</p>
          <div className="activity-key"><span><i />{highlighted} candidate or secret badges with more than 2 awards</span><span>Your confirmations and badge choices are saved in this browser.</span></div>
          <div className="table-wrap"><table><caption className="sr-only">Event game badge award counts. Candidate and reference badges are not confirmed secret quests.</caption><thead><tr><th>EVENT GAME / BADGE</th><th>IDENTIFICATION</th><th className="numeric">TOTAL AWARDED</th><th className="numeric">PAST 24 HOURS</th><th>YOUR CHOICE</th></tr></thead><tbody>{gameRows.map(row => <tr key={row.universeId} className={`${row.stale ? 'stale-row' : ''} ${row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) > 2 ? 'active-badge' : ''}`}>
            <td><div className="game-cell"><div className="game-visual"><GameIcon src={icons[row.universeId]} name={row.game} /><span className="year">{row.year}</span></div><div className="badge-description"><a className="game-name" href={row.gameUrl} target="_blank" rel="noreferrer">{row.game}<ArrowUpRight size={13} /></a><a className="badge-name" href={row.badgeUrl ?? row.gameUrl} target="_blank" rel="noreferrer">{row.data?.name ?? row.badgeName}</a><span className="badge-id">{row.badgeId ?? 'No public badge'} · {row.data ? (row.data.enabled ? 'Enabled' : 'Disabled') : 'Loading'}</span>{row.stale && <span className="stale-note" title={row.error ?? ''}>{row.data ? `Stale · last updated ${time(row.fetchedAt ?? null)}` : 'Unavailable · retrying next refresh'}</span>}</div></div></td>
            <td><Identity row={row} /><details className="badge-note"><summary>Why this badge?</summary><p>{row.note}</p>{row.discoveryError && <p>{row.discoveryError}</p>}</details>{row.isNewest === false && <span className="selection-note">Newer badge excluded</span>}</td>
            <td className="numeric"><span className="total-value">{number(row.data?.statistics.awardedCount)}</span>{row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) > 2 && <span className="award-signal">3+ awarded</span>}</td><td className="numeric"><span className="day-value">{number(row.data?.statistics.pastDayAwardedCount)}</span></td>
            <td className="row-actions">{row.status === 'candidate' && <Button variant="outline" size="sm" onClick={() => confirm(row)} disabled={!row.data || row.stale} aria-label={`Confirm ${row.game} badge`}><Check />Confirm</Button>}{row.status === 'user-confirmed' && <span className="your-confirmation"><Check size={15} />Saved</span>}<Button variant="ghost" size="sm" onClick={() => openEditor(row)} aria-label={`${row.status === 'unconfirmed' ? 'Add' : 'Change'} badge for ${row.game}`}>{row.status === 'unconfirmed' ? <Plus /> : <Pencil />}{row.status === 'unconfirmed' ? 'Add badge' : 'Change'}</Button>{preferences[row.universeId] && <button className="reset-choice" onClick={() => reset(row)} aria-label={`Reset ${row.game} badge choice`}>Reset choice</button>}</td>
          </tr>)}</tbody></table></div>
        </TabsContent>
        <TabsContent value="hub"><div className="section-summary"><h2>The hub collection</h2><span className="hub-label">S01 — S20</span></div><p className="catalog-note">All 20 supplied badges are awarded by The Hunt: Roblox 20 hub. Their S-numbers do not establish a mapping to individual games. Badges with more than 2 awards are highlighted.</p><div className="hub-grid">{hubRows.map(row => <article className={`hub-card ${row.status !== 'unconfirmed' && (row.data?.statistics.awardedCount ?? 0) > 2 ? 'active-badge' : ''}`} key={row.badgeId}><div className="hub-card-top"><GameIcon src={icons[row.universeId]} name={row.game} /><a href={row.badgeUrl!} target="_blank" rel="noreferrer">{row.data?.name ?? row.badgeName}<ArrowUpRight size={17} /></a></div><strong className="hub-total">{number(row.data?.statistics.awardedCount)}</strong><span className="hub-total-label">total awarded · {row.data ? (row.data.enabled ? 'Enabled' : 'Disabled') : 'Loading'}</span><div className="hub-day"><span>Past 24 hours</span><strong>{number(row.data?.statistics.pastDayAwardedCount)}</strong></div><span className="badge-id">{row.badgeId}</span>{row.stale && <span className="stale-note">{row.data ? 'Stale · refresh pending' : 'Unavailable · retry pending'}</span>}</article>)}</div></TabsContent>
      </Tabs>
      <footer><p><strong>About these counts</strong> · Public Roblox awards across all players. Enabled badges may still require an unreleased quest. No player login required.</p><div><span>Catalog checked {new Date(catalogCheckedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC</span><button className="text-download" onClick={() => download('json')}>Full catalog JSON <ArrowDownToLine size={14} /></button><a href="https://create.roblox.com/docs/cloud/reference/domains/badges" target="_blank" rel="noreferrer">Roblox API <ArrowUpRight size={14} /></a></div><p className="unofficial">Independent tracker. Not affiliated with Roblox.</p></footer>
      <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving) setEditing(null); }}><DialogContent className="badge-dialog"><DialogHeader><DialogTitle>Choose the secret badge</DialogTitle><DialogDescription>{editing?.game} · The badge must belong to this game.</DialogDescription></DialogHeader><form onSubmit={saveBadge}><label htmlFor="badge-input">Badge ID or Roblox badge link</label><Input id="badge-input" value={badgeInput} onChange={event => setBadgeInput(event.target.value)} placeholder="123456789 or https://www.roblox.com/badges/…" autoComplete="off" required aria-invalid={!!editError} aria-describedby={editError ? 'badge-error' : undefined} /><label className="confirm-checkbox"><Checkbox checked={markConfirmed} onCheckedChange={value => setMarkConfirmed(value === true)} />Mark this as the correct secret badge</label><p className="dialog-note">Your choice stays selected during automatic refreshes and is saved in this browser.</p>{editError && <p className="edit-error" id="badge-error" role="alert">{editError}</p>}<div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Checking badge…' : 'Save badge'}</Button></div></form></DialogContent></Dialog>
    </main>
  </>;
}
