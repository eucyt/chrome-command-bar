import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isFresh, makeCache, slimHistory, validCache } from '../src/lib/index-cache.js';

const prefs = { historyDays: 90, historyMax: 4000 };
const cache = makeCache({ bookmarks: [{ title: 'B', url: 'https://b.example/', folder: '' }], history: [], prefs, loadedAt: 1000 });

test('slimHistory keeps only the fields ranking reads', () => {
  const [slim] = slimHistory([{ id: '7', title: 'T', url: 'https://t.example/', visitCount: 3, typedCount: 1, lastVisitTime: 5, extra: 'x' }]);
  assert.deepEqual(slim, { title: 'T', url: 'https://t.example/', visitCount: 3, typedCount: 1, lastVisitTime: 5 });
  assert.deepEqual(slimHistory([{ url: 'https://u.example/' }]), [
    { title: '', url: 'https://u.example/', visitCount: 0, typedCount: 0, lastVisitTime: 0 },
  ]);
});

test('makeCache records when and with which settings the sources were read', () => {
  assert.equal(cache.loadedAt, 1000);
  assert.equal(cache.historyDays, 90);
  assert.equal(cache.historyMax, 4000);
  assert.equal(cache.bookmarks.length, 1);
});

test('validCache rejects anything that is not a stored cache', () => {
  assert.equal(validCache(undefined), null);
  assert.equal(validCache({ loadedAt: 1 }), null);
  assert.equal(validCache({ loadedAt: 'x', bookmarks: [], history: [] }), null);
  assert.equal(validCache(cache), cache);
});

test('a cache is fresh until a source changes after it was read', () => {
  assert.equal(isFresh(cache, { prefs }), true);
  assert.equal(isFresh(cache, { changedAt: 999, prefs }), true);
  assert.equal(isFresh(cache, { changedAt: 1000, prefs }), false);
  assert.equal(isFresh(cache, { changedAt: 1001, prefs }), false);
  assert.equal(isFresh(null, { prefs }), false);
});

test('a cache read with other history settings is stale', () => {
  assert.equal(isFresh(cache, { prefs: { ...prefs, historyDays: 30 } }), false);
  assert.equal(isFresh(cache, { prefs: { ...prefs, historyMax: 100 } }), false);
});
