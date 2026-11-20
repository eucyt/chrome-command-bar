// Places the bar cannot be injected into get the toolbar popup instead, or a
// small window when the popup cannot open.

import { PAGES, barDriver } from './bar.mjs';
import { TOGGLE_SHORTCUT, expect, finish, launch, pressGlobal, screenshot, serve, sleep, step, typeGlobal, waitFor } from './harness.mjs';

const site = await serve(PAGES);
const chrome = await launch();
const { browser, inWorker } = chrome;
const { rows } = barDriver(chrome);

const alpha = (await browser.pages())[0];
await alpha.goto(`${site.origin}/alpha`);

const isFallbackBar = (t) => /\/src\/bar\.html\?mode=(popup|window)/.test(t.url());
const fallbackBars = () => browser.targets().filter(isFallbackBar).map((t) => t.url());
let internal;

await step('on a page extensions cannot touch, the shortcut opens the popup instead', async () => {
  internal = await browser.newPage();
  await internal.goto('chrome://version');
  await internal.bringToFront();
  await sleep(200);
  pressGlobal(TOGGLE_SHORTCUT);
  const target = await browser.waitForTarget(isFallbackBar, { timeout: 5000 });
  await sleep(600);
  screenshot('fallback-on-internal-page');
  const popup = await target.asPage();
  await popup.waitForSelector('#results .row', { timeout: 5000 });
  const state = await popup.evaluate(() => ({ mode: document.documentElement.dataset.mode, focused: document.activeElement?.id }));
  expect(state.focused === 'query', `the fallback opened as ${state.mode} with focus on ${state.focused}`);
  expect((await rows(popup)).some((r) => r.title === 'Alpha ホーム'), 'the popup does not list the open tab');
});

await step('pressing the shortcut again closes that popup instead of opening a second bar', async () => {
  pressGlobal(TOGGLE_SHORTCUT, { focusBrowser: false });
  await waitFor(() => fallbackBars().length === 0, 'the popup to close');
  // A second bar would arrive as a new window a moment later.
  await sleep(800);
  expect(fallbackBars().length === 0, `bars showing after the second press: ${JSON.stringify(fallbackBars())}`);
});

await step('a third press opens it again', async () => {
  pressGlobal(TOGGLE_SHORTCUT);
  const target = await browser.waitForTarget(isFallbackBar, { timeout: 5000 });
  expect(fallbackBars().length === 1, `bars showing: ${JSON.stringify(fallbackBars())}`);
  await (await target.asPage()).close().catch(() => {});
  await internal.close();
});

await step('when the popup cannot open, a small window takes the keys and lists the tabs', async () => {
  // Chrome refuses the popup in situations a test cannot stage reliably (the
  // window lost focus between the key press and the call), so refuse for it.
  await inWorker(() => {
    chrome.action.openPopup = () => Promise.reject(new Error('refused by the test'));
  });
  // Closing a popup through Puppeteer does not always take; have it close itself.
  for (const target of browser.targets().filter(isFallbackBar)) {
    await (await target.asPage()).evaluate(() => window.close()).catch(() => {});
  }
  await waitFor(() => fallbackBars().length === 0, 'the popup of the previous step to be gone');
  internal = await browser.newPage();
  await internal.goto('chrome://version');
  await internal.bringToFront();
  await sleep(200);
  pressGlobal(TOGGLE_SHORTCUT);
  const bar = await (await browser.waitForTarget(isFallbackBar, { timeout: 5000 })).asPage();
  await bar.waitForSelector('#results .row', { timeout: 5000 });
  const opened = await bar.evaluate(() => ({ mode: document.documentElement.dataset.mode, origin: document.getElementById('origin').textContent }));
  expect(opened.mode === 'window', `the fallback opened as ${opened.mode}`);
  expect(opened.origin.includes('version'), `the footer shows "${opened.origin}", not the page the shortcut was pressed on`);
  await waitFor(() => bar.evaluate(() => document.hasFocus() && document.activeElement?.id === 'query'), 'the window to have the keyboard');
  typeGlobal('alp');
  await waitFor(() => bar.$eval('#query', (el) => el.value === 'alp'), 'the typed text to reach the window');
  expect((await rows(bar))[0]?.title === 'Alpha ホーム', `rows: ${JSON.stringify(await rows(bar))}`);
  screenshot('fallback-window');

  pressGlobal('enter', { focusBrowser: false });
  await waitFor(() => fallbackBars().length === 0, 'the window to close after Enter');
  await waitFor(async () => (await chrome.activeTab()).url?.endsWith('/alpha'), 'the chosen tab to become active');
});

await step('the small window closes on a second press and when it loses focus', async () => {
  await internal.bringToFront();
  await sleep(200);
  const open = async () => {
    pressGlobal(TOGGLE_SHORTCUT);
    const bar = await (await browser.waitForTarget(isFallbackBar, { timeout: 5000 })).asPage();
    await waitFor(() => bar.evaluate(() => document.hasFocus()), 'the window to have the keyboard');
  };

  await open();
  pressGlobal(TOGGLE_SHORTCUT, { focusBrowser: false });
  await waitFor(() => fallbackBars().length === 0, 'the window to close on the second press');
  await sleep(800);
  expect(fallbackBars().length === 0, `bars showing after the second press: ${JSON.stringify(fallbackBars())}`);

  await open();
  const mainWindowId = (await chrome.allTabs()).find((t) => t.url.startsWith('chrome://version')).windowId;
  await inWorker((id) => chrome.windows.update(id, { focused: true }), mainWindowId);
  await waitFor(() => fallbackBars().length === 0, 'the window to close when another window takes focus');
  await internal.close();
});

await step('a new tab is the page Chrome provides, not the bar', async () => {
  const newtab = await browser.newPage();
  await newtab.goto('chrome://newtab');
  const url = newtab.url();
  await newtab.close();
  expect(!url.startsWith('chrome-extension://'), `the new tab page is ${url}`);
});

await finish(chrome, site);
