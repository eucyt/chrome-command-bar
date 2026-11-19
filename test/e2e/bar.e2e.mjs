// The bar over a web page: opening and closing, searching, keys and actions.

import { PAGES, barDriver } from './bar.mjs';
import { TOGGLE_SHORTCUT, expect, finish, launch, pressGlobal, screenshot, serve, sleep, step, typeGlobal, waitFor } from './harness.mjs';

const site = await serve({
  ...PAGES,
  '/bookmarked-target': { title: 'Bookmarked target', body: '<p>bookmark</p>' },
  '/typed-target': { title: 'Typed target', body: '<p>typed</p>' },
});
const origin = site.origin;
const chrome = await launch();
const { browser, inWorker, activeTab, allTabs } = chrome;
const { barFrame, overlayPresent, waitClosed, openBar, rows, type, key, overlayId } = barDriver(chrome);

const alpha = (await browser.pages())[0];
await alpha.goto(`${origin}/alpha`);
const beta = await browser.newPage();
await beta.goto(`${origin}/beta-github`);

await inWorker(async (origin) => {
  await chrome.bookmarks.create({ title: 'お気に入りのページ Bookmarked', url: `${origin}/bookmarked-target` });
  await chrome.bookmarks.create({ title: 'bookmarklet', url: 'javascript:alert(1)' });
  await chrome.history.addUrl({ url: `${origin}/history-only-page?topic=kombucha` });
}, origin);

let frame;

await step('the real shortcut opens the bar over a web page, with the input focused', async () => {
  frame = await openBar(alpha);
  const focus = await frame.evaluate(() => ({ id: document.activeElement?.id, hasFocus: document.hasFocus() }));
  expect(focus.id === 'query' && focus.hasFocus, `focus was ${JSON.stringify(focus)}`);
  const rect = await alpha.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  }, overlayId);
  expect(rect.w >= rect.vw - 20 && rect.h >= rect.vh - 20, `overlay does not cover the viewport: ${JSON.stringify(rect)}`);
  screenshot('bar-default');
});

await step('before typing: other tabs first, the current tab last and labelled', async () => {
  const list = await rows(frame);
  expect(list[0].title === 'Beta GitHub リポジトリ' && list[0].selected, `first row: ${JSON.stringify(list[0])}`);
  const current = list.find((r) => r.title === 'Alpha ホーム');
  expect(current?.badge === '現在のタブ', `current tab row: ${JSON.stringify(current)}`);
  expect(list.indexOf(current) === list.filter((r) => r.type === 'tab').length - 1, 'current tab is not last among tabs');
});

await step('the footer shows the host of the page under the bar', async () => {
  const text = await frame.$eval('#origin', (el) => el.textContent);
  expect(text.includes(new URL(origin).host), `footer was "${text}"`);
});

await step('typing filters with fuzzy matching and highlights the matched letters', async () => {
  await type(frame, 'btgh');
  const list = await rows(frame);
  expect(list[0].title === 'Beta GitHub リポジトリ', `top row: ${JSON.stringify(list[0])}`);
  expect(list[0].marks.replace(/\|/g, '').toLowerCase() === 'btgh', `marks: ${list[0].marks}`);
  expect(list.at(-1).type === 'search', 'web search row is missing at the end');
  screenshot('bar-query');
});

await step('Japanese text matches', async () => {
  await type(frame, 'リポジ');
  expect((await rows(frame))[0].title === 'Beta GitHub リポジトリ', 'Japanese query did not match');
});

await step('Enter during IME composition does nothing', async () => {
  await key(frame, 'Enter', { isComposing: true });
  await sleep(200);
  expect(await overlayPresent(alpha), 'the bar closed on a composing Enter');
  expect((await activeTab()).url.endsWith('/alpha'), 'tab changed on a composing Enter');
});

await step('Enter switches to the selected tab and closes the bar', async () => {
  await key(frame, 'Enter');
  await waitFor(async () => (await activeTab()).url.endsWith('/beta-github'), 'the beta tab to become active');
  await waitClosed(alpha);
});

await step('real key presses type into the bar, move the selection and activate it', async () => {
  frame = await openBar(beta);
  typeGlobal('alpha');
  await sleep(300);
  expect((await frame.$eval('#query', (el) => el.value)) === 'alpha', 'typed text did not reach the bar input');
  expect((await beta.evaluate(() => document.activeElement?.tagName)) === 'IFRAME', 'the page kept keyboard focus');
  for (const chord of ['down', 'up', 'enter']) pressGlobal(chord, { focusBrowser: false });
  await waitFor(async () => (await activeTab()).url.endsWith('/alpha'), 'the alpha tab to become active');
  await beta.bringToFront();
  await waitClosed(beta);
});

await step('pressing the shortcut again closes the bar', async () => {
  frame = await openBar(beta);
  pressGlobal(TOGGLE_SHORTCUT);
  await waitClosed(beta);
});

await step('Esc closes the bar and gives focus back to the page', async () => {
  await alpha.bringToFront();
  await alpha.focus('#page-input');
  frame = await openBar(alpha);
  await key(frame, 'Escape');
  await waitClosed(alpha);
  expect((await alpha.evaluate(() => document.activeElement?.id)) === 'page-input', 'focus did not return to the page input');
});

await step('clicking outside the panel closes the bar', async () => {
  frame = await openBar(alpha);
  // Chrome routes clicks to a new frame only once it has been composited. A
  // click sent sooner lands on the page underneath, so click until one arrives.
  await waitFor(async () => {
    await alpha.mouse.click(30, 600);
    await sleep(250);
    return !(await overlayPresent(alpha));
  }, 'a click outside the panel to close the bar');
});

await step('bookmarks are found, bookmarklets are not, and Enter opens a new tab next to the current one', async () => {
  frame = await openBar(alpha);
  await type(frame, 'bookmarklet');
  expect(!(await rows(frame)).some((r) => r.type === 'bookmark' && r.title === 'bookmarklet'), 'a javascript: bookmark was listed');
  await type(frame, 'お気に入り');
  const top = (await rows(frame))[0];
  expect(top.type === 'bookmark' && top.badge === 'ブックマーク', `top row: ${JSON.stringify(top)}`);
  const before = await activeTab();
  await key(frame, 'Enter');
  const opened = await waitFor(async () => {
    const tab = await activeTab();
    return (tab.url || tab.pendingUrl || '').endsWith('/bookmarked-target') ? tab : null;
  }, 'the bookmark to open');
  expect(opened.id !== before.id && opened.index === before.index + 1, `opened at index ${opened.index}, expected ${before.index + 1}`);
  await waitClosed(alpha);
});

await step('history entries are found by URL', async () => {
  frame = await openBar(alpha);
  await type(frame, 'kombucha');
  const top = (await rows(frame))[0];
  expect(top.type === 'history' && top.sub.includes('history-only-page'), `top row: ${JSON.stringify(top)}`);
});

await step('a typed URL is offered first; Alt+Enter opens it in the current tab', async () => {
  frame = barFrame(alpha) ?? (await openBar(alpha));
  const typed = `${new URL(origin).host}/typed-target`;
  await type(frame, typed);
  const top = (await rows(frame))[0];
  expect(top.type === 'url' && top.title === `http://${typed}`, `top row: ${JSON.stringify(top)}`);
  const before = await allTabs();
  await key(frame, 'Enter', { altKey: true });
  await waitFor(() => alpha.url().endsWith('/typed-target'), 'the current tab to navigate');
  expect((await allTabs()).length === before.length, 'a new tab was opened');
  await alpha.goto(`${origin}/alpha`);
});

await step('a query with no match offers only the web search', async () => {
  frame = await openBar(alpha);
  await type(frame, 'qqqq wwww zzzz');
  const list = await rows(frame);
  expect(list.length === 1 && list[0].type === 'search' && list[0].selected, JSON.stringify(list));
});

await step('Shift+Enter sends the typed text to the default search engine in a new tab', async () => {
  frame = barFrame(alpha) ?? (await openBar(alpha));
  await type(frame, 'kombucha brewing guide');
  const before = (await allTabs()).length;
  await key(frame, 'Enter', { shiftKey: true });
  const searchTab = await waitFor(async () => {
    const tabs = await allTabs();
    return tabs.length === before + 1 && tabs.find((t) => /kombucha(\+|%20)brewing/.test(t.pendingUrl || t.url || ''));
  }, 'a search tab');
  await waitClosed(alpha);
  await inWorker((id) => chrome.tabs.remove(id), searchTab.id);
  await sleep(200);
});

await step('">" lists commands; "タブを複製" duplicates the current tab', async () => {
  frame = await openBar(alpha);
  await type(frame, '>');
  const list = await rows(frame);
  expect(list.length >= 10 && list.every((r) => r.type === 'command'), `rows: ${list.length}`);
  screenshot('bar-commands');
  await type(frame, '> 複製');
  expect((await rows(frame))[0].title === 'タブを複製', 'duplicate command not on top');
  const before = (await allTabs()).length;
  await key(frame, 'Enter');
  await waitFor(async () => (await allTabs()).length === before + 1, 'the duplicated tab');
  const duplicate = await activeTab();
  await inWorker((id) => chrome.tabs.remove(id), duplicate.id);
  await sleep(200);
});

await step('"URLをコピー" puts the page URL on the clipboard', async () => {
  await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read']);
  frame = await openBar(alpha);
  await type(frame, '> urlをコピー');
  expect((await rows(frame))[0].title === 'URLをコピー', 'copy command not on top');
  await key(frame, 'Enter');
  await waitClosed(alpha);
  await alpha.bringToFront();
  await alpha.focus('#page-input');
  const clip = await alpha.evaluate(() => navigator.clipboard.readText());
  expect(clip === `${origin}/alpha`, `clipboard was "${clip}"`);
});

await step('the close-tab chord closes the highlighted tab and keeps the bar open', async () => {
  const victim = await browser.newPage();
  await victim.goto(`${origin}/bookmarked-target`);
  frame = await openBar(alpha);
  await type(frame, 'bookmarked target');
  const top = (await rows(frame))[0];
  expect(top.type === 'tab', `top row: ${JSON.stringify(top)}`);
  const before = (await allTabs()).length;
  await key(frame, 'Backspace', { altKey: true });
  await waitFor(async () => (await allTabs()).length === before - 1, 'the tab to close');
  expect(await overlayPresent(alpha), 'the bar closed');
  await key(frame, 'Escape');
  await waitClosed(alpha);
});

await finish(chrome, site);
