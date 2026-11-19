// Idle tabs are closed automatically and can be brought back from the bar.
// The limit is 12 hours in real use; here it is shortened through the stored settings.

import { PAGES, barDriver } from './bar.mjs';
import { expect, finish, launch, screenshot, serve, sleep, step, waitFor } from './harness.mjs';

const TTL = 1500;

const site = await serve({ ...PAGES, '/gamma-pinned': { title: 'Gamma pinned', body: '<p>gamma</p>' } });
const origin = site.origin;
const chrome = await launch();
const { browser, inWorker, activeTab, allTabs } = chrome;
const { waitClosed, openBar, rows, type, key } = barDriver(chrome);

const alpha = (await browser.pages())[0];
await alpha.goto(`${origin}/alpha`);
const beta = await browser.newPage();
await beta.goto(`${origin}/beta-github`);
const gamma = await browser.newPage();
await gamma.goto(`${origin}/gamma-pinned`);
await inWorker(async () => {
  const [tab] = await chrome.tabs.query({ url: '*://localhost/gamma-pinned' });
  await chrome.tabs.update(tab.id, { pinned: true });
});
await alpha.bringToFront();

const settings = () => inWorker(async () => (await chrome.storage.local.get('autoclose')).autoclose);
const setSettings = (patch) =>
  inWorker(async (patch) => {
    const stored = (await chrome.storage.local.get('autoclose')).autoclose;
    await chrome.storage.local.set({ autoclose: { ...stored, ...patch } });
  }, patch);
const archive = () => inWorker(async () => (await chrome.storage.local.get('autoclose:archive'))['autoclose:archive'] ?? []);
const openPaths = async () => (await allTabs()).map((t) => new URL(t.url).pathname).sort();
/** Tabs are only checked when something happens to a tab; a reload is such a thing. */
const nudge = () => alpha.reload();
const runCommand = async (query, title) => {
  const frame = await openBar(alpha);
  await type(frame, query);
  const top = (await rows(frame))[0];
  expect(top?.title === title, `top row for "${query}": ${JSON.stringify(top)}`);
  await key(frame, 'Enter');
  return frame;
};

let frame;

await step('the feature is on after install', async () => {
  const stored = await waitFor(settings, 'the settings to be stored');
  expect(stored.enabled === true && stored.since > 0, `settings: ${JSON.stringify(stored)}`);
});

await step('a tab left alone past the limit is closed; the showing tab and the pinned tab stay', async () => {
  await setSettings({ ttl: TTL, since: 0 });
  await sleep(TTL + 500);
  await nudge();
  await waitFor(async () => !(await openPaths()).includes('/beta-github'), 'the idle tab to close');
  const paths = await openPaths();
  expect(paths.join() === '/alpha,/gamma-pinned', `open tabs: ${paths}`);
});

await step('the closed tab is recorded in the archive', async () => {
  const entries = await archive();
  expect(entries.length === 1 && entries[0].url === `${origin}/beta-github` && entries[0].title === 'Beta GitHub リポジトリ', `archive: ${JSON.stringify(entries)}`);
});

await step('the archive stays out of the everyday search', async () => {
  frame = await openBar(alpha);
  await type(frame, 'beta github');
  const list = await rows(frame);
  expect(!list.some((r) => r.type === 'archived'), `rows: ${JSON.stringify(list)}`);
  await key(frame, 'Escape');
  await waitClosed(alpha);
});

await step('"アーカイブしたタブを表示" lists the closed tab in the bar', async () => {
  frame = await runCommand('> アーカイブ', 'アーカイブしたタブを表示');
  await waitFor(async () => (await rows(frame))[0]?.type === 'archived', 'the archive rows');
  const list = await rows(frame);
  expect(list.length === 1 && list[0].title === 'Beta GitHub リポジトリ' && list[0].badge === 'アーカイブ' && list[0].selected, `rows: ${JSON.stringify(list)}`);
  expect((await frame.$eval('#query', (el) => el.value)) === '', 'the query was not cleared');
  screenshot('autoclose-archive');
});

await step('typing filters the archive, and says so when nothing matches', async () => {
  await type(frame, 'zzzz');
  let list = await rows(frame);
  expect(list.length === 1 && list[0].type === 'empty', `rows: ${JSON.stringify(list)}`);
  await type(frame, 'btgh');
  list = await rows(frame);
  expect(list.length === 1 && list[0].type === 'archived', `rows: ${JSON.stringify(list)}`);
});

await step('Enter reopens the archived tab and removes it from the archive', async () => {
  await setSettings({ ttl: 60 * 60 * 1000 });
  await key(frame, 'Enter');
  await waitFor(async () => (await activeTab()).url.endsWith('/beta-github'), 'the restored tab to become active');
  expect((await archive()).length === 0, `archive: ${JSON.stringify(await archive())}`);
  await alpha.bringToFront();
  await waitClosed(alpha);
});

await step('the archive view says when there is nothing in it', async () => {
  frame = await runCommand('> アーカイブ', 'アーカイブしたタブを表示');
  await waitFor(async () => (await rows(frame))[0]?.type === 'empty', 'the empty row');
  expect((await rows(frame))[0].title === 'アーカイブしたタブはありません', 'wrong empty text');
  screenshot('autoclose-archive-empty');
  await key(frame, 'Escape');
  await waitClosed(alpha);
});

await step('switched off from the bar, nothing is closed', async () => {
  await runCommand('> 自動クローズ', 'タブの自動クローズをオフにする');
  await waitClosed(alpha);
  await waitFor(async () => (await settings()).enabled === false, 'the feature to switch off');
  await setSettings({ ttl: TTL });
  await sleep(TTL + 500);
  await nudge();
  await sleep(500);
  expect((await openPaths()).includes('/beta-github'), 'a tab was closed while the feature was off');
});

await step('switched back on, tabs get a full period before they are closed', async () => {
  await runCommand('> 自動クローズ', 'タブの自動クローズをオンにする');
  await waitClosed(alpha);
  await waitFor(async () => (await settings()).enabled === true, 'the feature to switch on');
  await nudge();
  await sleep(300);
  expect((await openPaths()).includes('/beta-github'), 'a tab was closed the moment the feature came back');
  await sleep(TTL + 500);
  await nudge();
  await waitFor(async () => !(await openPaths()).includes('/beta-github'), 'the idle tab to close');
});

await finish(chrome, site);
