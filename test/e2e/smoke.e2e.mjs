// Proves the harness itself: the extension loads, real key presses arrive, and
// the extension shortcut fires. If this file fails, no other end-to-end result
// can be trusted.

import { existsSync } from 'node:fs';

import { TOGGLE_SHORTCUT, expect, finish, launch, pressGlobal, screenshot, serve, sleep, step, typeGlobal, waitFor } from './harness.mjs';

const site = await serve({
  '/': { title: 'Harness smoke page', body: '<input id="field" autofocus><p>harness smoke page</p>' },
});
const chrome = await launch();
const page = (await chrome.browser.pages())[0];
await page.goto(`${site.origin}/`);
await page.bringToFront();

// Count shortcut deliveries inside the service worker.
const countCommands = () => chrome.inWorker(() => globalThis.__commands ?? []);
await chrome.inWorker(() => {
  globalThis.__commands = [];
  chrome.commands.onCommand.addListener((command) => globalThis.__commands.push({ command }));
});

await step('the extension is loaded from the repository root', async () => {
  const manifest = await chrome.inWorker(() => chrome.runtime.getManifest());
  expect(manifest.name === 'Yadokari' && manifest.manifest_version === 3, `manifest: ${JSON.stringify(manifest)}`);
});

await step('real key presses reach the focused page', async () => {
  await page.focus('#field');
  typeGlobal('hello 42');
  const value = await waitFor(() => page.$eval('#field', (el) => el.value), 'typed text').catch(() => '');
  expect(value === 'hello 42', `the input holds "${value}"`);
});

await step("Puppeteer's keyboard does not fire the extension shortcut", async () => {
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await sleep(500);
  const seen = await countCommands();
  expect(seen.length === 0, `the shortcut fired from a synthetic key press: ${JSON.stringify(seen)}`);
});

await step('a real key press fires the extension shortcut', async () => {
  pressGlobal(TOGGLE_SHORTCUT);
  const seen = await waitFor(async () => {
    const list = await countCommands();
    return list.length ? list : null;
  }, 'the shortcut to reach the service worker');
  expect(seen.length === 1 && seen[0].command === 'toggle-bar', `commands: ${JSON.stringify(seen)}`);
});

await step('screenshots of the whole display are saved', async () => {
  const file = screenshot('smoke');
  expect(existsSync(file), `${file} was not written`);
});

await finish(chrome, site);
