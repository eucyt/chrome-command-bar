// Stages the files Chrome needs into a directory, leaving tests and tooling behind.
// CI uploads that directory as an artifact; GitHub zips it, so the download is the extension zip.

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

/** Everything the extension loads at runtime. Anything outside these never ships. */
export const PACKAGED = ['manifest.json', 'src', 'icons'];

/** @param {string} outDir Replaced if it already exists, so stale files cannot ship. */
export function stage(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const entry of PACKAGED) {
    cpSync(path.join(root, entry), path.join(outDir, entry), {
      recursive: true,
      filter: (source) => path.basename(source) !== '.DS_Store',
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'yadokari'));
  stage(outDir);
  console.log(outDir);
}
