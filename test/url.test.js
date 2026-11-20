import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dedupeKey, describeOrigin, hostLength, isOpenable, matchableUrl, toUrl, withoutQuery } from '../src/lib/url.js';

test('toUrl keeps explicit URLs', () => {
  assert.equal(toUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(toUrl('http://localhost:3000'), 'http://localhost:3000/');
  assert.match(toUrl('chrome://extensions'), /^chrome:\/\/extensions\/?$/);
});

test('toUrl adds a scheme to bare hosts', () => {
  assert.equal(toUrl('github.com'), 'https://github.com/');
  assert.equal(toUrl('github.com/octo'), 'https://github.com/octo');
  assert.equal(toUrl('localhost:5173/app'), 'http://localhost:5173/app');
  assert.equal(toUrl('192.168.0.1'), 'http://192.168.0.1/');
  assert.equal(toUrl('example.co.jp'), 'https://example.co.jp/');
});

test('toUrl leaves search queries alone', () => {
  assert.equal(toUrl('how to center a div'), null);
  assert.equal(toUrl('node.js'), null);
  assert.equal(toUrl('readme.md'), null);
  assert.equal(toUrl('github'), null);
  assert.equal(toUrl(''), null);
  assert.equal(toUrl('c++'), null);
});

test('toUrl treats an unknown TLD as a URL once it has a path or port', () => {
  assert.equal(toUrl('intra.corp/wiki'), 'https://intra.corp/wiki');
  assert.equal(toUrl('intra.corp:8443'), 'https://intra.corp:8443/');
});

test('toUrl refuses schemes that would run code', () => {
  assert.equal(toUrl('javascript://alert(1)'), null);
  assert.equal(toUrl('data://text/html,hi'), null);
});

test('dedupeKey ignores www and a trailing slash but keeps query and hash', () => {
  assert.equal(dedupeKey('https://www.example.com/a/'), dedupeKey('https://example.com/a'));
  assert.notEqual(dedupeKey('https://example.com/a?x=1'), dedupeKey('https://example.com/a?x=2'));
  assert.notEqual(dedupeKey('https://example.com/#/a'), dedupeKey('https://example.com/#/b'));
  assert.notEqual(dedupeKey('http://example.com/'), dedupeKey('https://example.com/'));
});

test('withoutQuery cuts the query and keeps the fragment', () => {
  assert.equal(withoutQuery('https://example.com/a?utm_source=x&b=2'), 'https://example.com/a');
  assert.equal(withoutQuery('https://example.com/a?x=1#top'), 'https://example.com/a#top');
  assert.equal(withoutQuery('http://localhost:3000/?debug'), 'http://localhost:3000/');
  assert.equal(withoutQuery('https://example.com/a?'), 'https://example.com/a');
});

test('withoutQuery leaves URLs without a query, and other schemes, as given', () => {
  assert.equal(withoutQuery('https://github.com'), 'https://github.com');
  assert.equal(withoutQuery('https://example.com/#/route?tab=2'), 'https://example.com/#/route?tab=2');
  assert.equal(withoutQuery('chrome://settings/?search=proxy'), 'chrome://settings/?search=proxy');
  assert.equal(withoutQuery('file:///tmp/a.html?x=1'), 'file:///tmp/a.html?x=1');
});

test('matchableUrl drops the scheme and www', () => {
  assert.equal(matchableUrl('https://www.github.com/octo/repo'), 'github.com/octo/repo');
  assert.equal(matchableUrl('https://example.com/'), 'example.com');
  assert.equal(matchableUrl('chrome://settings/'), 'chrome://settings/');
});

test('matchableUrl decodes Japanese paths for matching', () => {
  assert.equal(matchableUrl('https://ja.wikipedia.org/wiki/%E6%9D%B1%E4%BA%AC'), 'ja.wikipedia.org/wiki/東京');
});

test('describeOrigin flags plain http and shows punycode for lookalike hosts', () => {
  assert.deepEqual(describeOrigin('https://github.com/x'), { label: 'github.com', secure: true, kind: 'web' });
  assert.equal(describeOrigin('http://example.com/').secure, false);
  assert.equal(describeOrigin('http://localhost:3000/').secure, true);
  assert.equal(describeOrigin('http://127.0.0.1:8080/').secure, true);
  assert.equal(describeOrigin('https://аpple.com/').label, 'xn--pple-43d.com');
  assert.equal(describeOrigin('chrome://settings/').kind, 'internal');
  assert.equal(describeOrigin('not a url').kind, 'unknown');
});

test('isOpenable rejects bookmarklets', () => {
  assert.equal(isOpenable('javascript:void(0)'), false);
  assert.equal(isOpenable('https://example.com'), true);
});

test('hostLength finds where the path starts in a matchable URL', () => {
  assert.equal(hostLength('github.com/octo/repo'), 'github.com'.length);
  assert.equal(hostLength('localhost:3000?q=1'), 'localhost:3000'.length);
  assert.equal(hostLength('example.com#top'), 'example.com'.length);
  assert.equal(hostLength('example.com'), 'example.com'.length);
  assert.equal(hostLength(''), 0);
});

test('hostLength counts code points, as match positions do', () => {
  assert.equal(hostLength('𝒳.example/a'), Array.from('𝒳.example').length);
  assert.equal(hostLength('例え.jp/パス'), 5);
});

test('hostLength leaves text that still has a scheme whole', () => {
  assert.equal(hostLength('chrome://extensions/shortcuts'), 'chrome://extensions/shortcuts'.length);
  assert.equal(hostLength('file:///Users/me/a.html'), 'file:///Users/me/a.html'.length);
  assert.equal(hostLength('about:blank'), 'about:blank'.length);
});
