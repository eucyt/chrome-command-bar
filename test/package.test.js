import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { stage } from '../scripts/package.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(mkdtempSync(path.join(tmpdir(), 'yadokari-package-')), 'yadokari');
stage(out);
after(() => rmSync(path.dirname(out), { recursive: true, force: true }));

const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));

test('the package holds only what the extension loads', () => {
  assert.deepEqual(readdirSync(out).sort(), ['icons', 'manifest.json', 'src']);
});

test('every file the manifest points at is in the package', () => {
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
  const missing = referenced.filter((file) => !existsSync(path.join(out, file)));
  assert.deepEqual(missing, [], `missing from the package: ${missing.join(', ')}`);
});

test('every source file is in the package', () => {
  const list = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();
  assert.deepEqual(list(path.join(out, 'src')), list(path.join(root, 'src')));
});

test('the manifest and package.json agree on the version', () => {
  // The artifact is named after this version; a mismatch would mislabel the download.
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
});
