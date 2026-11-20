import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ARCHIVE_MAX_AGE, DEFAULT_TTL, addToArchive, normalizeSettings, planSweep, removeFromArchive } from '../src/lib/autoclose.js';
import { buildArchiveIndex, search } from '../src/lib/rank.js';

const NOW = Date.UTC(2026, 10, 19);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const tab = (id, extra = {}) => ({ id, url: `https://example.com/${id}`, title: `Page ${id}`, ...extra });
const ids = (tabs) => tabs.map((t) => t.id);

test('settings default to on with a 12 hour limit', () => {
  assert.deepEqual(normalizeSettings(undefined), { enabled: true, since: 0, ttl: 12 * HOUR });
  assert.deepEqual(normalizeSettings({ enabled: false, since: 5, ttl: 1000 }), { enabled: false, since: 5, ttl: 1000 });
  assert.equal(normalizeSettings({ ttl: -1 }).ttl, DEFAULT_TTL);
  assert.equal(normalizeSettings({ ttl: 'soon' }).ttl, DEFAULT_TTL);
});

test('a tab idle for the whole limit is closed, a more recent one is kept', () => {
  const plan = planSweep([tab(1), tab(2)], { 1: NOW - 12 * HOUR, 2: NOW - 12 * HOUR + 1 }, { now: NOW });
  assert.deepEqual(ids(plan.close), [1]);
  assert.deepEqual(plan.lastUsed, { 2: NOW - 12 * HOUR + 1 });
});

test('pinned, showing and audible tabs are never closed and count as used now', () => {
  const old = NOW - 3 * DAY;
  const tabs = [tab(1, { pinned: true }), tab(2, { active: true }), tab(3, { audible: true }), tab(4)];
  const plan = planSweep(tabs, { 1: old, 2: old, 3: old, 4: old }, { now: NOW });
  assert.deepEqual(ids(plan.close), [4]);
  assert.deepEqual(plan.lastUsed, { 1: NOW, 2: NOW, 3: NOW });
});

test('a tab that stops playing gets a full period from that moment', () => {
  const first = planSweep([tab(1, { audible: true })], { 1: NOW - 3 * DAY }, { now: NOW });
  const later = planSweep([tab(1)], first.lastUsed, { now: NOW + 11 * HOUR });
  assert.deepEqual(later.close, []);
  assert.deepEqual(ids(planSweep([tab(1)], later.lastUsed, { now: NOW + 12 * HOUR }).close), [1]);
});

test("a tab seen for the first time starts from Chrome's lastAccessed, or from now without one", () => {
  const plan = planSweep([tab(1, { lastAccessed: NOW - 13 * HOUR }), tab(2, { lastAccessed: NOW - HOUR }), tab(3), tab(4, { lastAccessed: NOW + DAY })], {}, { now: NOW });
  assert.deepEqual(ids(plan.close), [1]);
  assert.deepEqual(plan.lastUsed, { 2: NOW - HOUR, 3: NOW, 4: NOW });
});

test('a recorded time wins over lastAccessed', () => {
  const plan = planSweep([tab(1, { lastAccessed: NOW })], { 1: NOW - 13 * HOUR }, { now: NOW });
  assert.deepEqual(ids(plan.close), [1]);
});

test('idle time before the feature was switched on does not count', () => {
  const lastUsed = { 1: NOW - 3 * DAY };
  assert.deepEqual(planSweep([tab(1)], lastUsed, { now: NOW, since: NOW - HOUR }).close, []);
  assert.deepEqual(ids(planSweep([tab(1)], lastUsed, { now: NOW, since: NOW - 12 * HOUR }).close), [1]);
});

test('times of tabs that no longer exist are dropped', () => {
  assert.deepEqual(planSweep([tab(1)], { 1: NOW, 99: NOW }, { now: NOW }).lastUsed, { 1: NOW });
});

test('closed tabs go to the front of the archive, one entry per page', () => {
  const existing = [
    { url: 'https://example.com/1/', title: 'old title', closedAt: NOW - DAY },
    { url: 'https://example.com/other', title: 'Other', closedAt: NOW - 2 * DAY },
  ];
  const archive = addToArchive(existing, [tab(1), tab(2, { title: '' })], { now: NOW });
  assert.deepEqual(archive, [
    { url: 'https://example.com/1', title: 'Page 1', closedAt: NOW },
    { url: 'https://example.com/2', title: 'https://example.com/2', closedAt: NOW },
    { url: 'https://example.com/other', title: 'Other', closedAt: NOW - 2 * DAY },
  ]);
});

test('incognito tabs and pages that cannot be reopened are not archived', () => {
  const tabs = [
    tab(1, { incognito: true }),
    tab(2, { url: 'chrome-extension://abc/src/options.html' }),
    tab(3, { url: 'chrome://newtab/' }),
    tab(4, { url: '' }),
    tab(5, { url: '', pendingUrl: 'https://example.com/pending' }),
  ];
  assert.deepEqual(addToArchive([], tabs, { now: NOW, ownOrigin: 'chrome-extension://abc/' }).map((e) => e.url), ['https://example.com/pending']);
});

test('the archive drops entries past 30 days and keeps at most 500', () => {
  const aged = [
    { url: 'https://example.com/keep', title: 'keep', closedAt: NOW - ARCHIVE_MAX_AGE },
    { url: 'https://example.com/drop', title: 'drop', closedAt: NOW - ARCHIVE_MAX_AGE - 1 },
  ];
  assert.deepEqual(addToArchive(aged, [], { now: NOW }).map((e) => e.title), ['keep']);

  const many = Array.from({ length: 600 }, (_, i) => ({ url: `https://example.com/p${i}`, title: `p${i}`, closedAt: NOW - i }));
  const capped = addToArchive(many, [tab(1)], { now: NOW });
  assert.equal(capped.length, 500);
  assert.equal(capped[0].title, 'Page 1');
  assert.equal(capped.at(-1).title, 'p498');
});

test('restoring a page removes it from the archive', () => {
  const archive = [
    { url: 'https://example.com/a', title: 'A', closedAt: NOW },
    { url: 'https://example.com/b', title: 'B', closedAt: NOW },
  ];
  assert.deepEqual(removeFromArchive(archive, 'https://example.com/a/').map((e) => e.title), ['B']);
});

test('the archive list is newest first and searchable', () => {
  const items = buildArchiveIndex([
    { url: 'https://example.com/older', title: 'Older page', closedAt: NOW - DAY },
    { url: 'https://zenn.dev/articles/x', title: 'Zennの記事', closedAt: NOW },
  ]);
  assert.deepEqual(items.map((i) => [i.type, i.title]), [['archived', 'Zennの記事'], ['archived', 'Older page']]);
  assert.deepEqual(search('older', items, { now: NOW }).map((r) => r.item.title), ['Older page']);
});
