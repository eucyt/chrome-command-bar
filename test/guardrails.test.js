// Mechanical checks for the project rules in CLAUDE.md ("守ること").
// Loosening anything here is a decision for its own pull request, with the reason.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));

/** Every permission the design needs. Nothing outside this list may be requested. */
const ALLOWED_PERMISSIONS = ['activeTab', 'bookmarks', 'favicon', 'history', 'scripting', 'search', 'sessions', 'storage', 'tabs'];

/** Manifest keys that would widen what the extension can reach or run. */
const FORBIDDEN_MANIFEST_KEYS = [
  'host_permissions',
  'optional_host_permissions',
  'optional_permissions',
  'content_scripts',
  'content_security_policy',
  'externally_connectable',
];

const ALLOWED_DEV_DEPENDENCIES = ['puppeteer-core'];

function filesUnder(dir, extensions) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true })
    .map((entry) => path.join(dir, String(entry)))
    .filter((file) => statSync(path.join(root, file)).isFile() && extensions.includes(path.extname(file)));
}

function findings(files, rules) {
  const out = [];
  for (const file of files) {
    read(file)
      .split('\n')
      .forEach((line, index) => {
        for (const { pattern, why } of rules) {
          if (pattern.test(line)) out.push(`${file}:${index + 1}: ${why}\n    ${line.trim()}`);
        }
      });
  }
  return out;
}

test('manifest is Manifest V3 and requests only allowed permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  const extra = (manifest.permissions ?? []).filter((p) => !ALLOWED_PERMISSIONS.includes(p));
  assert.deepEqual(extra, [], `permissions outside the allow list: ${extra.join(', ')}`);
});

test('manifest has no host access, content scripts or relaxed CSP', () => {
  const present = FORBIDDEN_MANIFEST_KEYS.filter((key) => key in manifest);
  assert.deepEqual(present, [], `forbidden manifest keys: ${present.join(', ')}`);
  assert.ok(!JSON.stringify(manifest.permissions ?? []).includes('://'), 'host patterns do not belong in permissions');
});

test('every file the manifest points at exists', () => {
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    manifest.options_ui?.page,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.chrome_url_overrides ?? {}),
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? []),
  ]
    .filter(Boolean)
    .map((file) => String(file).split(/[?#]/)[0])
    .filter((file) => !file.includes('*'));
  const missing = referenced.filter((file) => !existsSync(path.join(root, file)));
  assert.deepEqual(missing, [], `manifest references missing files: ${missing.join(', ')}`);
});

test('there are no runtime dependencies and no unreviewed dev dependencies', () => {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) {
    assert.deepEqual(Object.keys(pkg[field] ?? {}), [], `package.json must not have ${field}`);
  }
  const extra = Object.keys(pkg.devDependencies ?? {}).filter((name) => !ALLOWED_DEV_DEPENDENCIES.includes(name));
  assert.deepEqual(extra, [], `devDependencies outside the allow list: ${extra.join(', ')}`);
});

test('there is no build step', () => {
  for (const script of ['build', 'prepare', 'postinstall', 'preinstall', 'install']) {
    assert.ok(!(script in (pkg.scripts ?? {})), `package.json must not define a "${script}" script`);
  }
  const typescript = filesUnder('src', ['.ts', '.tsx', '.jsx']);
  assert.deepEqual(typescript, [], 'src/ must stay plain JavaScript that Chrome loads as is');
});

test('source never parses strings as HTML or code', () => {
  const found = findings(filesUnder('src', ['.js', '.html']), [
    { pattern: /\b(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|\bsrcdoc\b/, why: 'render untrusted text with textContent / text nodes only' },
    { pattern: /\beval\s*\(|new\s+Function\s*\(/, why: 'no dynamic code' },
  ]);
  assert.deepEqual(found, [], `\n${found.join('\n')}`);
});

test('source makes no network requests and loads nothing remote', () => {
  const found = [
    ...findings(filesUnder('src', ['.js']), [
      { pattern: /\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon|importScripts\s*\(/, why: 'the extension must not talk to the network' },
    ]),
    ...findings(filesUnder('src', ['.html']), [
      { pattern: /\b(src|href)\s*=\s*["']?(https?:)?\/\//i, why: 'load only files shipped with the extension' },
      { pattern: /<script(?![^>]*\bsrc=)[^>]*>/i, why: 'no inline scripts' },
    ]),
    ...findings(filesUnder('src', ['.css']), [
      { pattern: /url\(\s*["']?(https?:)?\/\//i, why: 'load only files shipped with the extension' },
      { pattern: /@import/i, why: 'no stylesheet imports' },
    ]),
  ];
  assert.deepEqual(found, [], `\n${found.join('\n')}`);
});

test('src/lib is pure: no chrome.*, document or window', () => {
  const found = findings(filesUnder('src/lib', ['.js']), [
    { pattern: /\bchrome\s*\.|\b(document|window|navigator|localStorage)\s*\./, why: 'src/lib must run under plain Node; move browser code to src/' },
  ]);
  assert.deepEqual(found, [], `\n${found.join('\n')}`);
});

test('every module in src/lib has a unit test file', () => {
  const untested = filesUnder('src/lib', ['.js'])
    .map((file) => path.basename(file, '.js'))
    .filter((name) => !existsSync(path.join(root, 'test', `${name}.test.js`)));
  assert.deepEqual(untested, [], `add test/<name>.test.js for: ${untested.join(', ')}`);
});
