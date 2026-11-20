// `npm run screenshots`: retakes the README image in docs/.
// Linux only, like the end-to-end tests whose harness this borrows.
//
// The demo pages are served over HTTPS under made-up .example hosts, so the bar shows
// tidy URLs and no "not HTTPS" warning. Chrome is told to resolve every host to this
// machine and to accept the throwaway certificate.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const self = fileURLToPath(import.meta.url);

if (!process.env.DISPLAY) {
  const run = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', process.execPath, self], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

const { launch, sleep } = await import('../test/e2e/harness.mjs');
const { barDriver } = await import('../test/e2e/bar.mjs');

const icon = (emoji) =>
  `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`,
  )}">`;

const article = `
  <style>
    body { max-width: 640px; margin: 72px auto; font: 17px/1.7 system-ui, sans-serif; }
    h1 { font-size: 34px; line-height: 1.2; }
    p { opacity: 0.75; }
  </style>
  <h1>Hermit crabs and their shells</h1>
  <p>A hermit crab does not grow its own shell. It finds an empty one, moves in, and trades up when the old one gets tight.</p>
  <p>When a good shell washes ashore, crabs line up by size and swap in sequence, each taking the shell the next one leaves behind.</p>
  <p>The shell decides how fast a crab grows, how well it hides and how long it survives out of water.</p>
  <h2>Choosing a shell</h2>
  <p>A crab turns a candidate over, measures the opening with its claws and tries it on. If it fits worse than the old one, it switches straight back.</p>
  <p>Too small and the crab cannot withdraw from a predator. Too large and it wastes energy carrying the weight around.</p>
  <p>Shells are scarce on most shores, so a vacancy rarely lasts longer than a tide.</p>`;

/** host -> path -> page */
const SITES = {
  'tidepool.example': { '/hermit-crabs': { title: 'Hermit crabs and their shells', icon: '🐚', body: article } },
  'docs.example': { '/shell/scripting': { title: 'Shell scripting cheat sheet', icon: '📘' } },
  'mail.example': { '/inbox': { title: 'Inbox (3)', icon: '✉️' } },
  'tides.example': { '/shimoda': { title: 'Tide tables: Shimoda', icon: '🌊' } },
  'journal.example': { '/shell-exchange': { title: 'How hermit crabs queue for a shell exchange', icon: '📝' } },
  'walks.example': { '/shelly-beach': { title: 'Shelly Beach at low tide', icon: '🥾' } },
};

function serve() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'yadokari-shots-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=example', '-keyout', key, '-out', cert], {
    stdio: 'ignore',
  });
  const server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const page = SITES[req.headers.host]?.[new URL(req.url, 'https://x').pathname];
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (!page) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.end(`<!doctype html><html><head><title>${page.title}</title>${icon(page.icon)}</head><body>${page.body ?? ''}</body></html>`);
  });
  // 443, so that no port shows in the URLs.
  return new Promise((resolve) => server.listen(443, '127.0.0.1', () => resolve(server)));
}

async function shoot() {
  const chrome = await launch({
    // Without --no-proxy-server, a proxy from the environment would be asked for the made-up hosts.
    args: ['--host-resolver-rules=MAP * 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'],
  });
  const { browser, inWorker } = chrome;
  const { openBar, type } = barDriver(chrome);

  const first = (await browser.pages())[0];
  await first.goto('https://docs.example/shell/scripting');
  for (const url of ['https://mail.example/inbox', 'https://tides.example/shimoda']) {
    await (await browser.newPage()).goto(url);
  }
  // Visited, so that Chrome has their icons, then left behind as a bookmark and a history entry.
  const visitor = await browser.newPage();
  await visitor.goto('https://journal.example/shell-exchange');
  await visitor.goto('https://walks.example/shelly-beach');
  await sleep(500);
  await visitor.close();
  await inWorker(() => chrome.bookmarks.create({ title: 'How hermit crabs queue for a shell exchange', url: 'https://journal.example/shell-exchange' }));

  const page = await browser.newPage();
  await page.goto('https://tidepool.example/hermit-crabs');
  await sleep(1000);

  const frame = await openBar(page);
  await type(frame, 'shel');
  await sleep(500);
  await page.setViewport({ width: 1200, height: 640, deviceScaleFactor: 2 });
  await sleep(500);
  await page.screenshot({ path: path.join(root, 'docs', 'bar.png') });
  await chrome.close();
}

const server = await serve();
await shoot();
server.close();
