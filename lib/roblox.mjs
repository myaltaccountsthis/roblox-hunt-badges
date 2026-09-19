export const SPOTLIGHT = 'https://www.roblox.com/spotlight/the-hunt-roblox-20';
export const HUB = '10766456501';
export const HUB_IDS = ['788444728772728','854647440808329','2874537913586721','197788328316229','2237888773337343','1439816114867036','2677851507722761','1719653187423190','2250297984172921','973955333235103','1991530753845746','2971308898705223','308225565184426','3162193440550804','389109338362080','1070119183239664','3178004040363002','1246917220157214','1301021780785777','3699804200217169'];
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function idString(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe numeric Roblox ID');
  const id = String(value);
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new Error('Invalid Roblox ID');
  return id;
}

export async function request(url, asText = false, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetcher(url, { headers: { Accept: asText ? 'text/html' : 'application/json' }, signal: AbortSignal.timeout(10000), cache: 'no-store' }); }
    catch (error) { if (attempt === 2) throw error; await sleep(500 * (attempt + 1)); continue; }
    if (response.ok) return asText ? response.text() : response.json();
    const error = new Error(`Roblox returned HTTP ${response.status}`);
    if ((response.status !== 429 && response.status < 500) || attempt === 2) throw error;
    const retry = response.headers.get('retry-after');
    const delay = retry ? (/^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 750 * (2 ** attempt);
    // Longer backoffs are retried on the next poll instead of holding an HTTP request open.
    if (delay > 5000) throw new Error(`Roblox is rate limiting requests; retry after ${retry}`);
    await sleep(Math.max(250, Number.isFinite(delay) ? delay : 1000));
  }
}

export async function mapLimit(items, concurrency, action) {
  const results = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) { const current = index++; results[current] = await action(items[current], current); }
  }));
  return results;
}

export function parseGames(html) {
  const script = html.match(/<script\b[^>]*\bid=["']landing-page-api-response["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('Roblox spotlight format changed: embedded game data not found. Existing catalog was preserved.');
  const page = JSON.parse(script[1]);
  const games = new Map();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.universeItems)) for (const game of value.universeItems) {
      if (!/^20\d\d:/.test(game.subtitle ?? '') || String(game.universeId) === HUB) continue;
      const universeId = idString(game.universeId);
      const info = page.hydrationData?.universe?.[universeId];
      if (!info) throw new Error(`Missing game details for ${universeId}`);
      games.set(universeId, { game: game.title || info.name, universeId, rootPlaceId: idString(info.rootPlaceId), year: Number(game.subtitle.slice(0, 4)) });
    }
    for (const entry of Object.values(value)) walk(entry);
  }
  walk(page.pageEntries);
  if (games.size !== 20) throw new Error(`Expected 20 event games, found ${games.size}. Existing catalog was preserved.`);
  return [...games.values()].sort((a, b) => a.year - b.year);
}

export async function getCatalog(universeId) {
  const data = [], cursors = new Set();
  let cursor = '';
  do {
    const page = await request(`https://badges.roblox.com/v1/universes/${idString(universeId)}/badges?limit=100&sortOrder=Desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!Array.isArray(page.data)) throw new Error('Unexpected Roblox catalog response');
    data.push(...page.data);
    cursor = page.nextPageCursor;
    if (cursor && cursors.has(cursor)) throw new Error('Roblox repeated a pagination cursor');
    if (cursor) cursors.add(cursor);
    if (cursors.size > 100) throw new Error('Catalog exceeded the 100-page safety limit');
  } while (cursor);
  // Roblox catalog ordering can be customized by a creator. Compare creation timestamps, not IDs or list position.
  return data.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
}

export function chooseSecret(badges) {
  const sorted = [...badges].sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  const recent = sorted.filter(b => Date.parse(b.created) >= Date.parse('2026-09-01T00:00:00Z'));
  const explicit = recent.find(b => /secret\s+quest/i.test(`${b.name} ${b.description ?? ''}`));
  if (explicit) return { badge: explicit, status: 'confirmed', note: 'The current badge name or description explicitly identifies a secret quest.' };
  // ponytail: this event-specific heuristic ranks candidates, not proof; replace with an official mapping if Roblox publishes one.
  const placeholder = recent.find(b => /^(honeypot|b|LoyaltyBadge|Test|Badge|dsfsffda)$/i.test(b.name) || /unknown|placeholder|\?{2,}/i.test(b.name) || (/^[a-z]{1,16}$/i.test(b.name) && !b.description));
  if (placeholder) return { badge: placeholder, status: 'candidate', note: 'Likely secret badge: recently created with an obscure or placeholder name. This is an inference, not a confirmed secret-quest identification.' };
  if (recent.length >= 2) return { badge: recent[0], status: 'candidate', note: 'Newest badge created alongside another event-period badge. Secret-quest role is unconfirmed.' };
  return { badge: sorted[0] ?? null, status: 'unconfirmed', note: 'No identifiable secret badge is currently exposed in this game catalog. Tracking the newest visible badge as a reference only; it may be a main quest or unrelated.' };
}

export function gameEntry(game, badges, checkedAt) {
  const choice = chooseSecret(badges);
  return { ...game, badgeId: choice.badge ? idString(choice.badge.id) : null, badgeName: choice.badge?.name ?? 'No public badges', group: 'game', status: choice.status, note: choice.note, checkedAt, catalogCount: badges.length, created: choice.badge?.created ?? null, isNewest: !!choice.badge && choice.badge.id === badges[0]?.id, badgeUrl: choice.badge ? `https://www.roblox.com/badges/${idString(choice.badge.id)}` : null, gameUrl: `https://www.roblox.com/games/${game.rootPlaceId}`, discoveryError: null };
}

export async function refreshCatalog(entries) {
  return mapLimit(entries, 3, async entry => {
    if (entry.group !== 'game') return entry;
    try { return gameEntry(entry, await getCatalog(entry.universeId), new Date().toISOString()); }
    catch (error) { return { ...entry, discoveryError: `Could not check for new badges: ${error instanceof Error ? error.message : 'request failed'}` }; }
  });
}

export async function discover() {
  const games = parseGames(await request(SPOTLIGHT, true));
  const checkedAt = new Date().toISOString();
  const gameBadges = await mapLimit(games, 3, async game => {
    const badges = await getCatalog(game.universeId);
    return gameEntry(game, badges, checkedAt);
  });
  const hubBadges = HUB_IDS.map((badgeId, i) => ({ badgeId, badgeName: `S${String(i + 1).padStart(2, '0')}`, group: 'hub', status: 'provided', game: 'The Hunt: Roblox 20', universeId: HUB, rootPlaceId: '74205509034203', year: null, note: 'User-provided hub badge. The API identifies the event hub as the awarding game; S-number to featured-game mapping is not established.', checkedAt, badgeUrl: `https://www.roblox.com/badges/${badgeId}`, gameUrl: 'https://www.roblox.com/games/74205509034203' }));
  return { checkedAt, spotlightUrl: SPOTLIGHT, methodology: 'All catalog pages scanned and sorted by created timestamp. Explicit secret-quest labels are confirmed; recent placeholders are candidates; other newest badges are reference-only. IDs are stored as strings.', badges: [...hubBadges, ...gameBadges] };
}

export async function fetchBadges(entries, previous = [], fetcher = fetch) {
  const old = new Map(previous.map(row => [row.badgeId, row]));
  return mapLimit(entries, 4, async entry => {
    try {
      if (!entry.badgeId) throw new Error('No public badge available for this game');
      const data = await request(`https://badges.roblox.com/v1/badges/${idString(entry.badgeId)}`, false, fetcher);
      if (idString(data.id) !== entry.badgeId || !data.statistics || typeof data.enabled !== 'boolean') throw new Error('Unexpected Roblox badge response');
      if (String(data.awardingUniverse?.id) !== entry.universeId) throw new Error('Badge awarding game no longer matches this catalog');
      const explicit = entry.group === 'game' && /secret\s+quest/i.test(`${data.name} ${data.description ?? ''}`);
      const status = explicit ? 'confirmed' : entry.status;
      return { ...entry, badgeName: data.name, status, note: explicit ? 'The current badge name or description explicitly identifies a secret quest.' : entry.note, data, fetchedAt: new Date().toISOString(), error: null, stale: false };
    } catch (error) {
      const prior = old.get(entry.badgeId);
      return { ...entry, data: prior?.data ?? null, fetchedAt: prior?.fetchedAt ?? null, stale: true, error: error instanceof Error ? error.message : 'Badge request failed' };
    }
  });
}
