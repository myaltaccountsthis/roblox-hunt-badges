import catalog from '@/data/badges.json';
import seed from '@/data/snapshot.json';
import seedIcons from '@/data/game-icons.json';
import { fetchBadges, refreshCatalog, request, idString } from '@/lib/roblox.mjs';
import type { BadgeRow, Snapshot } from './types';

let current: Snapshot = { ...seed, badges: seed.badges.map(b => ({ ...b, stale: true, error: 'Saved snapshot; awaiting live refresh' })), icons: seedIcons };
let selected: BadgeRow[] = catalog.badges;
let expires = 0, iconsExpire = 0;
let pending: Promise<Snapshot> | null = null;
const gameIds = new Set(catalog.badges.filter(b => b.group === 'game').map(b => b.universeId));

export async function getSnapshot(force = false): Promise<Snapshot> {
  if (!force && Date.now() < expires) return current;
  // ponytail: cache/coalescing is per isolate. Add shared caching for a busy public deployment.
  pending ??= (async () => {
    selected = await refreshCatalog(selected);
    const badges = await fetchBadges(selected, current.badges);
    let icons = current.icons;
    if (Date.now() > iconsExpire) {
      try {
        const ids = [...new Set(catalog.badges.map(b => b.universeId))].join(',');
        const thumbnails = await request(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`);
        icons = { ...icons };
        for (const item of thumbnails.data ?? []) if (item.state === 'Completed' && /^https:\/\/[\w.-]+\.rbxcdn\.com\//.test(item.imageUrl)) icons[String(item.targetId)] = item.imageUrl;
        iconsExpire = Date.now() + 12 * 60 * 60 * 1000;
      } catch { /* Keep saved icons; badge statistics still refresh. */ }
    }
    current = { checkedAt: new Date().toISOString(), catalogCheckedAt: new Date().toISOString(), badges, icons };
    expires = Date.now() + 55000;
    return current;
  })().finally(() => { pending = null; });
  return pending;
}

export function validateSelections(input: unknown): { universeId: string; badgeId: string }[] {
  if (!Array.isArray(input) || input.length > 20) throw new Error('Expected at most 20 badge choices');
  const seen = new Set();
  return input.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid badge choice');
    const universeId = idString(item.universeId), badgeId = idString(item.badgeId);
    if (!gameIds.has(universeId) || seen.has(universeId)) throw new Error('Invalid or duplicate event game');
    seen.add(universeId);
    return { universeId, badgeId };
  });
}

export async function validateBadge(universeId: string, badgeId: string) {
  validateSelections([{ universeId, badgeId }]);
  const data = await request(`https://badges.roblox.com/v1/badges/${badgeId}`);
  if (String(data.id) !== badgeId || !data.statistics || typeof data.enabled !== 'boolean') throw new Error('Roblox returned incomplete badge details');
  if (String(data.awardingUniverse?.id) !== universeId) throw new Error(`That badge belongs to ${data.awardingUniverse?.name ?? 'another game'}, not this event game.`);
  return data;
}

export async function applySelections(snapshot: Snapshot, selections: { universeId: string; badgeId: string }[]): Promise<Snapshot> {
  const customEntries = selections.map(({ universeId, badgeId }) => {
    const base = snapshot.badges.find(b => b.group === 'game' && b.universeId === universeId)!;
    return { ...base, badgeId, badgeName: badgeId === base.badgeId ? base.badgeName : 'Selected badge', badgeUrl: `https://www.roblox.com/badges/${badgeId}`, status: badgeId === base.badgeId && base.status === 'confirmed' ? 'confirmed' : 'candidate', note: badgeId === base.badgeId && base.status === 'confirmed' ? base.note : 'Manually selected in this browser. Secret-quest identification is based on the user selection.', isNewest: undefined, created: undefined };
  });
  const customRows: BadgeRow[] = await fetchBadges(customEntries);
  return { ...snapshot, badges: snapshot.badges.map(row => customRows.find(custom => custom.universeId === row.universeId) ?? row) };
}
