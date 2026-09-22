import assert from 'node:assert/strict';
import { shouldReportAward, readActivity, pruneActivity } from '../lib/award-activity.ts';

assert.equal(shouldReportAward(undefined, 3, 5), false, 'first observation only establishes baseline');
assert.equal(shouldReportAward(2, 3, 5), true);
assert.equal(shouldReportAward(4, 5, 5), true);
assert.equal(shouldReportAward(4, 8, 5), true, 'jump across threshold is logged');
assert.equal(shouldReportAward(5, 6, 5), false, 'preserve notification threshold boundary');
assert.equal(shouldReportAward(6, 7, 5), false);
assert.equal(shouldReportAward(3, 3, 5), false);
assert.equal(shouldReportAward(3, 2, 5), false);
const now = Date.now();
const entry = { id: 'test', badgeId: '123', game: 'Example', badgeName: 'Secret', previous: 1, current: 2, timestamp: now };
assert.deepEqual(readActivity(JSON.parse(JSON.stringify([entry]))), [entry], 'stored entries survive reload');
assert.deepEqual(readActivity([null, {}, { ...entry, current: '2' }]), []);
assert.deepEqual(pruneActivity([{ ...entry, timestamp: now - 3600001 }, { ...entry, timestamp: now - 3600000 }, entry], now), [{ ...entry, timestamp: now - 3600000 }, entry]);
console.log('Activity rules, storage validation, and one-hour pruning passed.');
