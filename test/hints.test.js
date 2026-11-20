import assert from 'node:assert/strict';
import { test } from 'node:test';

import { footerHints } from '../src/lib/hints.js';

const base = { scope: 'all', typed: false, openIn: 'newTab', mac: true };
const labels = (options) => footerHints({ ...base, ...options }).map((h) => h.label);
const primary = (options) => footerHints({ ...base, ...options }).find((h) => h.primary)?.label;

test('Enter is described for each kind of row, first', () => {
  assert.equal(primary({ row: { type: 'tab' } }), 'タブに切り替え');
  assert.equal(primary({ row: { type: 'tab', isContext: true } }), 'このタブに戻る');
  assert.equal(primary({ row: { type: 'closed' } }), '閉じたタブを復元');
  assert.equal(primary({ row: { type: 'command' }, scope: 'command' }), '実行');
  assert.equal(primary({ row: { type: 'search' }, typed: true }), 'Web検索');
  for (const type of ['bookmark', 'history', 'archived', 'url']) {
    assert.equal(footerHints({ ...base, row: { type } })[0].label, '新しいタブで開く', type);
  }
});

test('pages offer the other place to open them, following the setting', () => {
  assert.deepEqual(labels({ row: { type: 'bookmark' } }), ['新しいタブで開く', 'このタブで開く', '閉じる']);
  assert.deepEqual(labels({ row: { type: 'bookmark' }, openIn: 'currentTab' }), ['このタブで開く', '新しいタブで開く', '閉じる']);
  assert.deepEqual(labels({ row: { type: 'tab' } }), ['タブに切り替え', 'タブを閉じる', '閉じる']);
});

test('the close-tab chord is offered for other tabs only', () => {
  assert.ok(labels({ row: { type: 'tab' } }).includes('タブを閉じる'));
  assert.ok(!labels({ row: { type: 'tab', isContext: true } }).includes('タブを閉じる'));
  assert.ok(!labels({ row: { type: 'closed' } }).includes('タブを閉じる'));
});

test('web search by Shift+Enter is offered only while searching everything', () => {
  assert.ok(labels({ row: { type: 'tab' }, typed: true }).includes('Web検索'));
  assert.ok(!labels({ row: { type: 'tab' } }).includes('Web検索'));
  assert.ok(!labels({ row: { type: 'command' }, scope: 'command', typed: true }).includes('Web検索'));
  assert.ok(!labels({ row: { type: 'archived' }, scope: 'archive', typed: true }).includes('Web検索'));
  // The search row already says it; once is enough.
  assert.deepEqual(labels({ row: { type: 'search' }, typed: true }), ['Web検索', '閉じる']);
});

test('modifier keys are named for the platform', () => {
  const keysFor = (options, label) => footerHints({ ...base, ...options }).find((h) => h.label === label).keys;
  assert.deepEqual(keysFor({ row: { type: 'history' } }, 'このタブで開く'), ['⌥', '↵']);
  assert.deepEqual(keysFor({ row: { type: 'history' }, mac: false }, 'このタブで開く'), ['Alt', '↵']);
  assert.deepEqual(keysFor({ row: { type: 'tab' } }, 'タブを閉じる'), ['⌃', '⌫']);
  assert.deepEqual(keysFor({ row: { type: 'tab' }, mac: false }, 'タブを閉じる'), ['Alt', '⌫']);
});

test('with nothing to act on, only closing is left', () => {
  assert.deepEqual(labels({ row: null }), ['閉じる']);
  assert.deepEqual(labels({ row: { type: 'empty' }, scope: 'archive' }), ['閉じる']);
});
