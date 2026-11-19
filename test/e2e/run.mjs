// `npm run test:e2e`: runs every test/e2e/*.e2e.mjs, each in its own Chrome,
// on a virtual X display. Pass file names to run only those.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;

if (process.platform !== 'linux') {
  console.error('test:e2e runs on Linux only (it drives Chrome through an X server). Rely on CI for these tests.');
  process.exit(1);
}

const wanted = process.argv.slice(2).map((f) => path.basename(f));
const files = readdirSync(here)
  .filter((f) => f.endsWith('.e2e.mjs'))
  .filter((f) => wanted.length === 0 || wanted.includes(f))
  .sort();

if (files.length === 0) {
  console.error(wanted.length ? `No end-to-end test matches: ${wanted.join(', ')}` : 'No *.e2e.mjs files found.');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  console.log(`\n# ${file}`);
  const run = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', process.execPath, path.join(here, file)], {
    stdio: 'inherit',
    timeout: 5 * 60 * 1000,
  });
  if (run.error?.code === 'ENOENT') {
    console.error('xvfb-run is not installed. Run `npm run setup` to see what is missing.');
    process.exit(1);
  }
  if (run.status !== 0) failed += 1;
}

console.log(`\n${files.length - failed}/${files.length} files passed`);
process.exit(failed ? 1 : 0);
