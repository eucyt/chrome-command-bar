// Shared parts for end-to-end tests: a real Chrome with this extension loaded,
// real key presses through the X server, screenshots and a tiny step runner.
//
// A test file is a plain script named `*.e2e.mjs`:
//
//   import { launch, serve, step, expect, finish } from './harness.mjs';
//   const site = await serve({ '/a': { title: 'A', body: '<p>a</p>' } });
//   const chrome = await launch();
//   await step('does the thing', async () => { ... expect(ok, 'why it failed'); });
//   await finish(chrome, site);
//
// Run them with `npm run test:e2e`, which supplies the X display.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import puppeteer from 'puppeteer-core';

const here = import.meta.dirname;
export const extensionDir = path.resolve(here, '../..');
export const artifactsDir = path.join(here, 'artifacts');

/** The shortcut from manifest.json, as an X key chord. */
export const TOGGLE_SHORTCUT = 'ctrl+shift+k';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) {
    throw new Error('No Chrome found. Install Chrome for Testing and point CHROME_PATH at it (see scripts/setup.sh).');
  }
  return found;
}

function xkeys(...args) {
  return execFileSync('python3', [path.join(here, 'xkeys.py'), ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
}

/**
 * Presses a key chord through the X server, e.g. 'ctrl+shift+k' or 'enter'.
 * This is the only way to trigger an extension shortcut: the browser handles
 * those itself, and Puppeteer's keyboard only reaches the page.
 * By default the browser window is given the keyboard first.
 */
export function pressGlobal(chord, { focusBrowser = true } = {}) {
  xkeys('key', chord, ...(focusBrowser ? [] : ['--no-focus']));
}

/** Types lowercase letters, digits and spaces with real key presses, into whatever has focus. */
export function typeGlobal(text) {
  xkeys('type', text);
}

/** Saves a screenshot of the whole display, browser UI included, to test/e2e/artifacts/. */
export function screenshot(name) {
  mkdirSync(artifactsDir, { recursive: true });
  const file = path.join(artifactsDir, name.endsWith('.png') ? name : `${name}.png`);
  xkeys('shot', file);
  return file;
}

/**
 * Serves throwaway pages on localhost.
 * @param {Record<string, {title: string, body?: string, head?: string}>} pages keyed by path
 * @returns {Promise<{origin: string, close: () => void}>}
 */
export async function serve(pages) {
  const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const server = http.createServer((req, res) => {
    const page = pages[new URL(req.url, 'http://localhost').pathname];
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (!page) {
      res.statusCode = 404;
      res.end('<!doctype html><title>404</title>');
      return;
    }
    res.end(
      `<!doctype html><html><head><title>${escapeHtml(page.title)}</title>${page.head ?? ''}</head>` +
        `<body style="font:18px sans-serif">${page.body ?? ''}</body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://localhost:${server.address().port}`, close: () => server.close() };
}

/**
 * Starts Chrome with the extension loaded from the repository root.
 * @returns {Promise<{
 *   browser: import('puppeteer-core').Browser,
 *   extensionId: string,
 *   inWorker: (fn: Function, ...args: any[]) => Promise<any>,
 *   activeTab: () => Promise<chrome.tabs.Tab>,
 *   allTabs: () => Promise<chrome.tabs.Tab[]>,
 *   close: () => Promise<void>,
 * }>}
 */
export async function launch() {
  if (!process.env.DISPLAY) {
    throw new Error('No X display. Run through `npm run test:e2e`, which wraps the tests in xvfb-run.');
  }
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: false,
    pipe: true,
    enableExtensions: [extensionDir],
    userDataDir: mkdtempSync(path.join(os.tmpdir(), 'command-bar-e2e-')),
    defaultViewport: null,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', '--window-position=0,0'],
  });

  const isOurWorker = (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://');
  let workerTarget;
  try {
    workerTarget = await browser.waitForTarget(isOurWorker, { timeout: 10_000 });
  } catch {
    await browser.close().catch(() => {});
    throw new Error(
      'The extension did not load. Regular Google Chrome ignores --load-extension; use Chrome for Testing (CHROME_PATH).',
    );
  }
  const extensionId = new URL(workerTarget.url()).host;
  // Keep what the extension logs, so a failed step can show why it did what it did:
  // the service worker's output, and errors from pages and the frames inside them.
  (await workerTarget.worker())?.on('console', (message) => extensionLog.push(`service worker: ${message.text()}`));
  const watchPage = async (target) => {
    if (target.type() !== 'page') return;
    const page = await target.page().catch(() => null);
    page?.on('console', (message) => {
      if (message.type() === 'error') extensionLog.push(`page console: ${message.text()}`);
    });
  };
  browser.targets().forEach(watchPage);
  browser.on('targetcreated', watchPage);

  // The service worker can be stopped and restarted by Chrome, so look it up on every call.
  const inWorker = async (fn, ...args) => {
    const target = await browser.waitForTarget(isOurWorker, { timeout: 10_000 });
    const worker = await target.worker();
    return worker.evaluate(fn, ...args);
  };

  return {
    browser,
    extensionId,
    inWorker,
    activeTab: () => inWorker(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]),
    allTabs: () => inWorker(() => chrome.tabs.query({})),
    close: () => browser.close().catch(() => {}),
  };
}

// --- step runner --------------------------------------------------------------

const results = [];
/** What the extension logged since the last failed step. */
const extensionLog = [];

/** Runs one named check. A failure is recorded and the following steps still run. */
export async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    const shot = screenshot(`failed-${results.length}`);
    console.log(`FAIL ${name}`);
    console.log(`     ${String(error?.message ?? error).split('\n').join('\n     ')}`);
    console.log(`     screenshot: ${path.relative(process.cwd(), shot)}`);
    for (const line of extensionLog.splice(0)) console.log(`     ${line}`);
  }
}

/** Throws with `message` unless `condition` holds. Put the observed value in the message. */
export function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/** Polls `fn` until it returns something truthy, and returns that. */
export async function waitFor(fn, what, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** Closes everything, prints the tally and exits non-zero when a step failed or none ran. */
export async function finish(...closables) {
  for (const c of closables) await c?.close?.();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed || results.length === 0 ? 1 : 0);
}
