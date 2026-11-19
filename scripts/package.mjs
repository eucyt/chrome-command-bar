// Stages the files Chrome needs into a directory, leaving tests and tooling behind.
// The release workflow zips that directory and attaches it to the GitHub release.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

/** Everything the extension loads at runtime. Anything outside these never ships. */
export const PACKAGED = ['manifest.json', 'src', 'icons'];

/**
 * @param {string} outDir Replaced if it already exists, so stale files cannot ship.
 * @param {string} [version] Stamped into the staged manifest. The repository's own manifest keeps a
 *   placeholder, so that releasing never needs a commit.
 */
export function stage(outDir, version) {
  if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version: ${version}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const entry of PACKAGED) {
    cpSync(path.join(root, entry), path.join(outDir, entry), {
      recursive: true,
      filter: (source) => path.basename(source) !== '.DS_Store',
    });
  }
  if (version !== undefined) {
    const file = path.join(outDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = path.join(root, 'dist', 'yadokari');
  stage(outDir, process.argv[2]);
  console.log(outDir);
}
