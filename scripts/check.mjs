import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { HUB_IDS, chooseSecret, gameEntry, fetchBadges, idString, mapLimit, parseGames, request } from '../lib/roblox.mjs';

const badge = (id, name, created, description = null) => ({ id, name, created, description });
const main = badge(1, 'Completed The Hunt 20 Quest!', '2026-09-05');
const hidden = badge(2, 'dsfsffda', '2026-09-04');
assert.equal(chooseSecret([main, hidden]).badge.id, 2, 'Obscure badge should outrank the newer named main badge');
assert.equal(chooseSecret([main, hidden]).status, 'candidate');
assert.equal(chooseSecret([badge(3, 'aabbcc', '2026-09-20')]).status, 'candidate', 'Future obscure names are candidates with a note');
assert.match(chooseSecret([hidden]).note, /inference/);
assert.equal(chooseSecret([main, badge(4, 'Secret Badge', '2020-01-01')]).status, 'unconfirmed', 'Old secret badges are unrelated');
assert.equal(chooseSecret([main, badge(5, 'Secret Quest: test', '2026-09-03')]).status, 'confirmed');
assert.equal(chooseSecret([]).badge, null);
assert.equal(idString(4181684440049565), '4181684440049565');
assert.throws(() => idString(Number.MAX_SAFE_INTEGER + 1));
assert.throws(() => idString('../badges'));
assert.throws(() => parseGames('<html></html>'), /format changed/);

const page = { pageEntries: [{ universeItems: Array.from({ length: 20 }, (_, i) => ({ universeId: String(i + 1), subtitle: `${2006 + i}: Test`, title: `Game ${i}` })) }], hydrationData: { universe: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), { rootPlaceId: String(i + 100) }])) } };
assert.equal(parseGames(`<script id="landing-page-api-response">${JSON.stringify(page)}</script>`).length, 20);

let active = 0, max = 0;
const result = await mapLimit([1, 2, 3, 4, 5], 2, async value => { max = Math.max(max, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return value * 2; });
assert.deepEqual(result, [2, 4, 6, 8, 10]);
assert.equal(max, 2);

const entries = [{ badgeId: '1', universeId: '10', group: 'game', status: 'candidate' }, { badgeId: '2', universeId: '10', group: 'game', status: 'candidate' }];
const old = [{ badgeId: '2', data: { name: 'Previous', statistics: { awardedCount: 42 } }, fetchedAt: '2026-09-01T00:00:00Z' }];
const refreshed = await fetchBadges(entries, old, async url => url.endsWith('/1') ? Response.json({ id: 1, name: 'Secret Quest', enabled: true, statistics: { awardedCount: 5 }, awardingUniverse: { id: 10 } }) : new Response('', { status: 404 }));
assert.equal(refreshed[0].status, 'confirmed');
assert.equal(refreshed[0].stale, false);
assert.equal(refreshed[1].data.statistics.awardedCount, 42, 'Failures preserve last-known stats');
assert.equal(refreshed[1].stale, true);
assert.match(refreshed[1].error, /404/);
let attempts = 0;
await request('https://example.test', false, async () => ++attempts === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : Response.json({ ok: true }));
assert.equal(attempts, 2, '429 responses retry with bounded backoff');

const catalog = JSON.parse(await fs.readFile(new URL('../data/badges.json', import.meta.url), 'utf8'));
assert.equal(catalog.badges.length, 40);
assert.deepEqual(catalog.badges.filter(b => b.group === 'hub').map(b => b.badgeId), HUB_IDS);
assert.equal(new Set(catalog.badges.map(b => b.badgeId)).size, 40);
assert.equal(catalog.badges.filter(b => b.group === 'game').length, 20);
console.log('Checks passed: candidate selection, parsing, ID precision, concurrency, retries, stale data, and all 40 catalog entries.');

const worldZeroPin = catalog.badges.find(row => row.universeId === '985731078');
assert.equal(worldZeroPin.badgeId, '2124728600');
const rediscovered = gameEntry(worldZeroPin, [badge(2153489069, 'Arcane Tower Champion', '2023-10-20')], new Date().toISOString());
assert.equal(rediscovered.badgeId, '2124728600', 'Automatic discovery must preserve the manually pinned Magma Goo ID');
assert.equal(rediscovered.badgeName, 'Magma Goo');
const unpinned = gameEntry({ ...worldZeroPin, pinned: false }, [badge(2153489069, 'Arcane Tower Champion', '2023-10-20')], new Date().toISOString());
assert.equal(unpinned.badgeId, '2153489069', 'Unpinned entries should still use automatic discovery');
console.log('Pinned World Zero selection survives discovery; automatic selection still works for unpinned entries.');
