// Places the bar cannot be injected into get the toolbar popup instead.

import { PAGES, barDriver } from './bar.mjs';
import { TOGGLE_SHORTCUT, expect, finish, launch, pressGlobal, screenshot, serve, sleep, step } from './harness.mjs';

const site = await serve(PAGES);
const chrome = await launch();
const { browser, allTabs } = chrome;
const { rows } = barDriver(chrome);

const alpha = (await browser.pages())[0];
await alpha.goto(`${site.origin}/alpha`);

await step('on a page extensions cannot touch, the shortcut opens the popup instead', async () => {
  const internal = await browser.newPage();
  await internal.goto('chrome://version');
  await internal.bringToFront();
  await sleep(200);
  pressGlobal(TOGGLE_SHORTCUT);
  const target = await browser.waitForTarget((t) => /\/src\/bar\.html\?mode=(popup|window)/.test(t.url()), { timeout: 5000 });
  await sleep(600);
  screenshot('fallback-on-internal-page');
  const popup = await target.asPage();
  await popup.waitForSelector('#results .row', { timeout: 5000 });
  const state = await popup.evaluate(() => ({ mode: document.documentElement.dataset.mode, focused: document.activeElement?.id }));
  expect(state.focused === 'query', `the fallback opened as ${state.mode} with focus on ${state.focused}`);
  expect((await rows(popup)).some((r) => r.title === 'Alpha ホーム'), 'the popup does not list the open tab');
  await popup.close().catch(() => {});
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
