// The settings page: what it shows, that changes are stored, and that the bar follows them.

import { PAGES, barDriver } from './bar.mjs';
import { expect, finish, launch, screenshot, serve, sleep, step, waitFor } from './harness.mjs';

const site = await serve({
  ...PAGES,
  '/gamma': { title: 'Gamma', body: '<p>gamma</p>' },
  '/delta': { title: 'Delta', body: '<p>delta</p>' },
});
const origin = site.origin;
const chrome = await launch();
const { browser, extensionId, inWorker, activeTab, allTabs } = chrome;
const { waitClosed, openBar, rows, hints, type, key } = barDriver(chrome);

const alpha = (await browser.pages())[0];
await alpha.goto(`${origin}/alpha`);
// Leaves one entry among the recently closed tabs.
const beta = await browser.newPage();
await beta.goto(`${origin}/beta-github`);
await beta.close();

const options = await browser.newPage();
await options.goto(`chrome-extension://${extensionId}/src/options.html`);
await options.waitForSelector('[name=historyDays]');

const stored = () => inWorker(async () => (await chrome.storage.local.get('preferences')).preferences);
const shown = () =>
  options.evaluate(() => {
    const form = document.getElementById('options');
    return {
      historyDays: form.elements.historyDays.value,
      historyMax: form.elements.historyMax.value,
      closedCount: form.elements.closedCount.value,
      openIn: form.elements.openIn.value,
    };
  });
/** Replaces a number field's content the way a person would: select all, type, leave the field. */
const fill = async (name, text) => {
  await options.bringToFront();
  await options.click(`[name=${name}]`, { count: 3 });
  await options.keyboard.type(text);
  await options.keyboard.press('Tab');
};

let frame;

await step('the page shows the defaults and the current shortcut', async () => {
  await waitFor(async () => (await shown()).historyDays === '90', 'the stored values to be shown');
  const values = await shown();
  expect(JSON.stringify(values) === JSON.stringify({ historyDays: '90', historyMax: '4000', closedCount: '5', openIn: 'newTab' }), `shown: ${JSON.stringify(values)}`);
  const shortcut = await waitFor(() => options.$eval('#shortcut', (el) => el.textContent), 'the shortcut');
  expect(shortcut === 'Ctrl+Shift+K', `shortcut shown as "${shortcut}"`);
  await sleep(300);
  screenshot('options-defaults');
});

await step('by default the bar lists the closed tab and Enter opens a typed URL in a new tab', async () => {
  frame = await openBar(alpha);
  await waitFor(async () => (await rows(frame)).some((r) => r.type === 'closed'), 'the closed tab row');
  const before = (await allTabs()).length;
  await type(frame, `${origin}/gamma`);
  const shown = await hints(frame);
  expect(shown[0] === '新しいタブで開く' && shown[1] === 'このタブで開く', `hints: ${shown}`);
  await key(frame, 'Enter');
  await waitFor(async () => (await allTabs()).length === before + 1, 'a new tab');
  expect(alpha.url().endsWith('/alpha'), `the current tab moved to ${alpha.url()}`);
  await (await browser.pages()).find((p) => p.url().endsWith('/gamma'))?.close();
});

await step('a changed number is stored at once; one outside the limits is corrected in the field', async () => {
  await fill('closedCount', '0');
  await waitFor(async () => (await stored())?.closedCount === 0, 'closedCount to be stored');
  await fill('historyDays', '99999');
  await waitFor(async () => (await stored())?.historyDays === 365, 'historyDays to be stored');
  await waitFor(async () => (await shown()).historyDays === '365', 'the field to show the corrected value');
  expect((await options.$eval('#status', (el) => el.textContent)) === '保存しました', 'no saved notice');
});

await step('with the count at 0, the bar no longer lists closed tabs before anything is typed', async () => {
  frame = await openBar(alpha);
  await sleep(400);
  const list = await rows(frame);
  expect(list.length > 0 && !list.some((r) => r.type === 'closed'), `rows: ${JSON.stringify(list)}`);
  await key(frame, 'Escape');
  await waitClosed(alpha);
});

await step('set to "現在のタブ", Enter reuses the tab and the modifier opens a new one', async () => {
  await options.bringToFront();
  await options.click('[name=openIn][value=currentTab]');
  await waitFor(async () => (await stored())?.openIn === 'currentTab', 'openIn to be stored');
  await sleep(200);
  screenshot('options-changed');

  frame = await openBar(alpha);
  let before = (await allTabs()).length;
  await type(frame, `${origin}/gamma`);
  const shown = await hints(frame);
  expect(shown[0] === 'このタブで開く' && shown[1] === '新しいタブで開く', `hints: ${shown}`);
  screenshot('options-bar-current-tab');
  await key(frame, 'Enter');
  await waitFor(() => alpha.url().endsWith('/gamma'), 'the current tab to navigate');
  expect((await allTabs()).length === before, 'a tab was opened as well');

  frame = await openBar(alpha);
  before = (await allTabs()).length;
  await type(frame, `${origin}/delta`);
  await key(frame, 'Enter', { altKey: true });
  await waitFor(async () => (await allTabs()).length === before + 1, 'a new tab');
  expect(alpha.url().endsWith('/gamma'), `the current tab moved to ${alpha.url()}`);
});

await step('the settings survive a reload of the page', async () => {
  await options.reload();
  await waitFor(async () => (await shown()).openIn === 'currentTab', 'the stored values to be shown');
  const values = await shown();
  expect(JSON.stringify(values) === JSON.stringify({ historyDays: '365', historyMax: '4000', closedCount: '0', openIn: 'currentTab' }), `shown: ${JSON.stringify(values)}`);
});

await step('the button opens Chrome\'s shortcut settings', async () => {
  await options.bringToFront();
  await options.click('#open-shortcuts');
  await waitFor(async () => (await activeTab())?.url?.startsWith('chrome://extensions/shortcuts'), 'the shortcut settings tab');
});

await step('"Yadokariの設定を開く" in the bar opens this page', async () => {
  await options.close();
  frame = await openBar(alpha);
  await type(frame, '> yadokari');
  const top = (await rows(frame))[0];
  expect(top?.title === 'Yadokariの設定を開く', `top row: ${JSON.stringify(top)}`);
  await key(frame, 'Enter');
  await waitFor(async () => (await activeTab())?.url?.endsWith('/src/options.html'), 'the settings page');
});

await finish(chrome, site);
