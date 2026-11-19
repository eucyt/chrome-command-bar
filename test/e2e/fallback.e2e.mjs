// Places the bar cannot be injected into: internal pages get the toolbar popup,
// and the new tab page is the bar itself.

import { PAGES, barDriver } from './bar.mjs';
import { TOGGLE_SHORTCUT, expect, finish, launch, pressGlobal, screenshot, serve, sleep, step, typeGlobal, waitFor } from './harness.mjs';

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

await step('a real Ctrl+T lands on the bar with the cursor in its input', async () => {
  await alpha.bringToFront();
  await sleep(200);
  const before = (await allTabs()).length;
  pressGlobal('ctrl+t');
  await waitFor(async () => (await allTabs()).length === before + 1, 'the new tab');
  const page = await waitFor(async () => {
    for (const candidate of await browser.pages()) {
      const mode = await candidate.evaluate(() => document.documentElement.dataset.mode).catch(() => null);
      if (mode === 'newtab' && (await candidate.$('#results .row'))) return candidate;
    }
    return null;
  }, 'a page in newtab mode');
  await sleep(600);
  typeGlobal('al');
  await sleep(400);
  const typed = await page.evaluate(() => document.getElementById('query').value);
  screenshot('newtab-after-real-ctrl-t');
  await page.close();
  expect(typed === 'al', `typing after Ctrl+T went elsewhere; the bar input holds "${typed}"`);
});

await step('the new tab page lists the open tabs but not blank new tabs', async () => {
  const newtab = await browser.newPage();
  await newtab.goto('chrome://newtab');
  await newtab.waitForSelector('#results .row', { timeout: 5000 });
  const mode = await newtab.evaluate(() => document.documentElement.dataset.mode);
  const titles = (await rows(newtab)).map((r) => r.title);
  expect(mode === 'newtab', `mode was ${mode}`);
  expect(titles.includes('Alpha ホーム') && !titles.includes('新しいタブ'), `titles: ${titles}`);
  await newtab.close();
});

await finish(chrome, site);
