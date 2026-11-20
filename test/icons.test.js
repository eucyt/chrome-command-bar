// Every icon the bar asks for exists in the sprite in bar.html. A missing symbol
// draws nothing and raises no error, so nothing else would notice.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const symbols = new Set([...read('src/bar.html').matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]));

test('the sprite has a symbol for every command', () => {
  const icons = [...read('src/commands.js').matchAll(/\bicon: '([a-z-]+)'/g)].map((m) => m[1]);
  const commands = [...read('src/commands.js').matchAll(/\bid: '([a-z-]+)'/g)].length;
  assert.equal(icons.length, commands, 'every command names an icon');
  assert.deepEqual(icons.filter((name) => !symbols.has(name)), []);
});

test('the sprite has a symbol for every icon bar.js draws', () => {
  const source = read('src/bar.js');
  const names = [
    ...[...source.matchAll(/glyph\('([a-z-]+)'\)/g)].map((m) => m[1]),
    // Values of the lookup tables: TYPE_ICON, PROMPT_ICON, KEY_ICON.
    ...[...source.matchAll(/const (?:TYPE|PROMPT|KEY)_ICON = \{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/: '([a-z-]+)'/g)].map((v) => v[1])),
  ];
  assert.ok(names.length > 10, `found only ${names.length} icon names in bar.js`);
  assert.deepEqual([...new Set(names)].filter((name) => !symbols.has(name)), []);
});
