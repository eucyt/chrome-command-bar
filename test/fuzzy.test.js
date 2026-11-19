import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fuzzyMatch, isSubsequence, normalize, typoVariants } from '../src/lib/fuzzy.js';

test('returns null when the query is not a subsequence', () => {
  assert.equal(fuzzyMatch('xyz', 'GitHub'), null);
  assert.equal(fuzzyMatch('hubgit', 'GitHub'), null);
  assert.equal(fuzzyMatch('longer than text', 'short'), null);
});

test('an empty query matches with no positions', () => {
  assert.deepEqual(fuzzyMatch('', 'anything'), { score: 0, positions: [] });
});

test('matches out-of-order-free subsequences and reports positions', () => {
  const m = fuzzyMatch('ghb', 'GitHub');
  assert.ok(m);
  assert.deepEqual(m.positions, [0, 3, 5]);
});

test('is case and width insensitive', () => {
  assert.ok(fuzzyMatch('GITHUB', 'github'));
  assert.ok(fuzzyMatch('github', 'ＧｉｔＨｕｂ'));
  assert.equal(normalize('ＡＢＣ'), 'abc');
});

test('a contiguous match outscores a scattered one', () => {
  const contiguous = fuzzyMatch('doc', 'Google Docs');
  const scattered = fuzzyMatch('doc', 'dashboard of commits');
  assert.ok(contiguous.score > scattered.score);
});

test('a match at a word start outscores one in the middle of a word', () => {
  const start = fuzzyMatch('not', 'Notion');
  const middle = fuzzyMatch('not', 'keynote');
  assert.ok(start.score > middle.score);
});

test('prefers the word-start occurrence when the text contains both', () => {
  const m = fuzzyMatch('pr', 'approve the PR list');
  assert.deepEqual(m.positions, [12, 13]);
});

test('rewards path and host boundaries in URLs', () => {
  const afterSlash = fuzzyMatch('pull', 'github.com/octo/repo/pull/12');
  const inside = fuzzyMatch('pull', 'example.com/xxpullxx');
  assert.ok(afterSlash.score > inside.score);
});

test('rewards camelCase humps', () => {
  const m = fuzzyMatch('gh', 'GitHub');
  assert.deepEqual(m.positions, [0, 3]);
  assert.ok(m.score > fuzzyMatch('gh', 'eightch').score);
});

test('matches Japanese text and treats a script change as a word start', () => {
  const m = fuzzyMatch('議事', 'Notion議事録 11月');
  assert.deepEqual(m.positions, [6, 7]);
  assert.ok(m.score > fuzzyMatch('事録', 'Notion議事録 11月').score);
});

test('positions are code-point indices, so emoji do not shift highlights', () => {
  const m = fuzzyMatch('doc', '📄 doc');
  assert.deepEqual(m.positions, [2, 3, 4]);
});

test('isSubsequence works on arrays and strings', () => {
  assert.equal(isSubsequence('ace', 'abcde'), true);
  assert.equal(isSubsequence(['a', 'e', 'c'], ['a', 'b', 'c', 'd', 'e']), false);
});

test('typoVariants undoes a dropped or swapped character', () => {
  const variants = typoVariants('gihtub');
  assert.ok(variants.includes('github'));
  assert.ok(typoVariants('githubb').includes('github'));
  assert.deepEqual(typoVariants('abc'), []);
});
