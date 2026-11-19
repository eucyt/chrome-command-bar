import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildIndex, defaultResults, search } from '../src/lib/rank.js';

const NOW = Date.UTC(2026, 10, 19);
const DAY = 24 * 60 * 60 * 1000;

function fixture() {
  return buildIndex({
    contextTabId: 1,
    tabs: [
      { id: 1, windowId: 10, title: 'Zenn｜エンジニアのための情報共有コミュニティ', url: 'https://zenn.dev/', lastAccessed: NOW },
      { id: 2, windowId: 10, title: 'octo/hakoniwa', url: 'https://github.com/octo/hakoniwa', lastAccessed: NOW - 1000 },
      { id: 3, windowId: 11, title: '受信トレイ - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox', lastAccessed: NOW - 5000 },
    ],
    closed: [
      { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/', sessionId: 's1', lastModified: NOW - 60_000 },
    ],
    bookmarks: [
      { title: 'GitHub', url: 'https://github.com/', folder: 'ブックマーク バー dev' },
      { title: 'hakoniwa (dup of open tab)', url: 'https://github.com/octo/hakoniwa/', folder: '' },
      { title: 'bookmarklet', url: 'javascript:alert(1)', folder: '' },
    ],
    history: [
      { title: 'Google ドキュメント', url: 'https://docs.google.com/document/u/0/', visitCount: 120, typedCount: 4, lastVisitTime: NOW - DAY / 2 },
      { title: 'Notion議事録 11月', url: 'https://www.notion.so/acme/minutes-2026-11', visitCount: 3, lastVisitTime: NOW - 3 * DAY },
      { title: 'GitHub', url: 'https://github.com', visitCount: 500, lastVisitTime: NOW - 1000 },
      { title: 'docs old page', url: 'https://example.com/docs/old', visitCount: 1, lastVisitTime: NOW - 80 * DAY },
    ],
    commands: [
      { id: 'duplicate-tab', title: 'タブを複製', keywords: 'duplicate clone tab' },
      { id: 'copy-url', title: 'URLをコピー', keywords: 'copy url link' },
    ],
  });
}

const titles = (results) => results.map((r) => r.item.title);

test('buildIndex drops duplicates of open tabs, bookmarks and bookmarklets', () => {
  const items = fixture();
  assert.equal(items.filter((i) => i.url && i.url.startsWith('https://github.com/octo/hakoniwa')).length, 1);
  assert.equal(items.filter((i) => i.title === 'GitHub').length, 1, 'history entry for a bookmarked page is dropped');
  assert.equal(items.find((i) => i.title === 'GitHub').type, 'bookmark');
  assert.equal(items.some((i) => i.title === 'bookmarklet'), false);
});

test('defaultResults lists other tabs by recency, the current tab last, then closed tabs', () => {
  const rows = defaultResults(fixture());
  assert.deepEqual(titles(rows), [
    'octo/hakoniwa',
    '受信トレイ - Gmail',
    'Zenn｜エンジニアのための情報共有コミュニティ',
    'MDN Web Docs',
  ]);
});

test('an open tab beats history for the same query', () => {
  const results = search('hako', fixture(), { now: NOW });
  assert.equal(results[0].item.type, 'tab');
  assert.equal(results[0].item.tabId, 2);
});

test('matches on the URL when the title does not contain the query', () => {
  const results = search('mail.goo', fixture(), { now: NOW });
  assert.equal(results[0].item.tabId, 3);
  assert.ok(results[0].urlPositions.length > 0);
  assert.equal(results[0].titlePositions.length, 0);
});

test('all space-separated terms must match, in any field', () => {
  const results = search('notion 11', fixture(), { now: NOW });
  assert.deepEqual(titles(results), ['Notion議事録 11月']);
  assert.deepEqual(search('notion zzzz', fixture(), { now: NOW }), []);
});

test('Japanese queries match Japanese titles', () => {
  assert.equal(search('議事録', fixture(), { now: NOW })[0].item.title, 'Notion議事録 11月');
  assert.equal(search('受信', fixture(), { now: NOW })[0].item.tabId, 3);
});

test('frequently visited history outranks a stale page with a similar match', () => {
  const results = search('docs', fixture(), { now: NOW });
  const names = titles(results);
  assert.ok(names.indexOf('Google ドキュメント') < names.indexOf('docs old page'));
});

test('scattered letters do not produce noise', () => {
  assert.deepEqual(search('zqx', fixture(), { now: NOW }), []);
  const results = search('gml', fixture(), { now: NOW });
  assert.ok(results.every((r) => r.item.title !== 'Notion議事録 11月'));
});

test('forgives one typo when nothing matches exactly', () => {
  const results = search('gihtub', fixture(), { now: NOW });
  assert.ok(results.length > 0);
  assert.ok(titles(results).includes('GitHub'));
});

test('">" restricts results to commands and lists them all when empty', () => {
  const all = search('>', fixture(), { now: NOW });
  assert.deepEqual(all.map((r) => r.item.commandId), ['duplicate-tab', 'copy-url']);
  const dup = search('> dup', fixture(), { now: NOW });
  assert.deepEqual(dup.map((r) => r.item.commandId), ['duplicate-tab']);
});

test('commands appear in normal results from two characters, below pages', () => {
  assert.ok(search('c', fixture(), { now: NOW }).every((r) => r.item.type !== 'command'));
  const results = search('copy', fixture(), { now: NOW });
  assert.ok(results.some((r) => r.item.commandId === 'copy-url'));
});

test('bookmark folder names are searchable', () => {
  const results = search('dev github', fixture(), { now: NOW });
  assert.equal(results[0].item.type, 'bookmark');
});

test('the tab the bar was opened on is ranked below an equal match elsewhere', () => {
  const items = buildIndex({
    contextTabId: 1,
    tabs: [
      { id: 1, windowId: 1, title: 'Example', url: 'https://example.com/a', lastAccessed: NOW },
      { id: 2, windowId: 1, title: 'Example', url: 'https://example.com/b', lastAccessed: NOW - 1 },
    ],
  });
  assert.equal(search('example', items, { now: NOW })[0].item.tabId, 2);
});

test('respects the result limit', () => {
  const history = Array.from({ length: 200 }, (_, i) => ({
    title: `page ${i}`,
    url: `https://example.com/page/${i}`,
    visitCount: 1,
    lastVisitTime: NOW - i * 1000,
  }));
  assert.equal(search('page', buildIndex({ history }), { now: NOW, limit: 20 }).length, 20);
});

test('stays fast on a realistic history size', () => {
  const history = Array.from({ length: 4000 }, (_, i) => ({
    title: `Some reasonably long page title number ${i} - Example Site`,
    url: `https://sub${i % 50}.example.com/section/${i}/article-with-a-long-slug?ref=${i}`,
    visitCount: i % 30,
    lastVisitTime: NOW - i * 60_000,
  }));
  const items = buildIndex({ history });
  const started = performance.now();
  for (const q of ['e', 'ex', 'exa', 'exam', 'example', 'example art', 'article slug 39']) search(q, items, { now: NOW });
  const perQuery = (performance.now() - started) / 7;
  assert.ok(perQuery < 150, `average ${perQuery.toFixed(1)}ms per keystroke`);
});
