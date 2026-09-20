import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discover, fetchBadges, sleep } from '../lib/roblox.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
for (const arg of args) if (!['--discover', '--watch'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
async function readJson(name) { return JSON.parse(await fs.readFile(path.join(root, 'data', name), 'utf8')); }
async function atomic(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, contents);
  await fs.rename(`${file}.tmp`, file);
}
const json = value => JSON.stringify(value, null, 2) + '\n';
const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

async function run() {
  let catalog;
  try {
    if (args.has('--discover')) {
      let existing = [];
      try { existing = (await readJson('badges.json')).badges; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      catalog = await discover(existing);
    } else catalog = await readJson('badges.json');
  }
  catch (error) { console.error(`Catalog discovery failed: ${error.message}. Existing files were not changed.`); process.exitCode = 1; return; }
  let previous = [];
  try { previous = (await readJson('snapshot.json')).badges; } catch { /* First run has no snapshot. */ }
  const badges = await fetchBadges(catalog.badges, previous);
  const snapshot = { checkedAt: new Date().toISOString(), catalogCheckedAt: catalog.checkedAt, badges };
  const columns = ['badgeId', 'game', 'badgeName', 'group', 'status', 'year', 'universeId', 'rootPlaceId', 'note', 'badgeUrl', 'gameUrl', 'checkedAt'];
  const csv = [columns.join(','), ...catalog.badges.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n') + '\r\n';
  const md = `# The Hunt: Roblox 20 badge IDs\n\nChecked: ${catalog.checkedAt}\n\nSource: ${catalog.spotlightUrl}\n\n${catalog.methodology}\n\nThe 20 S-badges are awarded by the event hub. Their numbers do not establish which featured game they correspond to.\n\n| Badge ID | Game | Badge name | Status |\n| --- | --- | --- | --- |\n${catalog.badges.map(row => `| ${row.badgeId ?? 'None'} | ${row.game.replaceAll('|', '\\|')} | ${row.badgeName.replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${row.status} |`).join('\n')}\n\n${catalog.badges.filter(row => row.group === 'game').map(row => `- **${row.game}:** ${row.note}${row.isNewest === false ? ' This candidate is not the newest badge.' : ''}`).join('\n')}\n`;
  // Complete discovery before replacing any catalog: upstream failures must not silently remove games.
  await atomic(path.join(root, 'data/badges.json'), json(catalog));
  await atomic(path.join(root, 'data/snapshot.json'), json(snapshot));
  await atomic(path.join(root, 'public/badges.json'), json(catalog));
  await atomic(path.join(root, 'public/badges.csv'), csv);
  await atomic(path.join(root, 'BADGE_IDS.md'), md);
  console.log(`${snapshot.checkedAt}: ${badges.filter(b => !b.stale).length}/${badges.length} badges refreshed; ${catalog.badges.filter(b => b.status === 'confirmed').length} explicit secret badges. Files written to data/, public/, and BADGE_IDS.md.`);
  if (badges.some(b => b.stale)) { for (const b of badges.filter(b => b.stale)) console.error(`${b.badgeId}: ${b.error}`); if (!args.has('--watch')) process.exitCode = 1; }
}
do {
  const started = Date.now();
  await run();
  if (args.has('--watch')) await sleep(Math.max(0, 60000 - (Date.now() - started)));
} while (args.has('--watch'));
