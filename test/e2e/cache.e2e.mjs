// The copy of bookmarks and history kept between two openings of the bar:
// it is used while nothing changed, and read again once something did.

import { PAGES, barDriver } from './bar.mjs';
import { expect, finish, launch, serve, sleep, step, waitFor } from './harness.mjs';

const CACHE_KEY = 'index:cache';
const CHANGED_KEY = 'index:changedAt';

const site = await serve(PAGES);
const origin = site.origin;
const chrome = await launch();
const { browser, inWorker } = chrome;
const { openBar, waitClosed, rows, type, key } = barDriver(chrome);

const alpha = (await browser.pages())[0];
await alpha.goto(`${origin}/alpha`);
await inWorker((origin) => chrome.bookmarks.create({ title: 'Quokka handbook', url: `${origin}/quokka` }), origin);

const session = () => inWorker((keys) => chrome.storage.session.get(keys), [CACHE_KEY, CHANGED_KEY]);
const isCurrent = (s) => s[CACHE_KEY] && s[CACHE_KEY].loadedAt > (s[CHANGED_KEY] ?? 0);

/** Bookmark and history rows for a query, as "title url", from a bar opened for the occasion. */
async function titlesFor(query) {
  const frame = await openBar(alpha);
  await type(frame, query);
  // Long enough for a reload from the APIs to have replaced the first rows.
  await sleep(400);
  const titles = (await rows(frame)).filter((r) => r.type === 'bookmark' || r.type === 'history').map((r) => `${r.title} ${r.sub}`);
  await key(frame, 'Escape');
  await waitClosed(alpha);
  return titles;
}

await step('the first bar reads the sources and leaves a copy behind', async () => {
  const titles = await titlesFor('quokka');
  expect(titles.some((t) => t.startsWith('Quokka handbook')), `rows: ${JSON.stringify(titles)}`);
  const stored = await waitFor(async () => {
    const s = await session();
    return isCurrent(s) ? s : null;
  }, 'a current cache in storage.session');
  expect(stored[CACHE_KEY].bookmarks.some((b) => b.title === 'Quokka handbook'), 'the bookmark is not in the cache');
  expect(Object.keys(stored[CACHE_KEY].history[0] ?? {}).sort().join() === 'lastVisitTime,title,typedCount,url,visitCount', `history entry: ${JSON.stringify(stored[CACHE_KEY].history[0])}`);
});

await step('while nothing changed, the next bar lists the copy without reading again', async () => {
  // An entry only the copy has: it can only be listed if the APIs were not asked.
  await inWorker(async (key) => {
    const cache = (await chrome.storage.session.get(key))[key];
    cache.bookmarks.push({ title: 'Only in the copy', url: 'https://copy.example/', folder: '' });
    await chrome.storage.session.set({ [key]: cache });
  }, CACHE_KEY);
  const titles = await titlesFor('only copy');
  expect(titles.some((t) => t.startsWith('Only in the copy')), `rows: ${JSON.stringify(titles)}`);
});

await step('a new bookmark makes the next bar read again', async () => {
  await inWorker((origin) => chrome.bookmarks.create({ title: 'Wombat notes', url: `${origin}/wombat` }), origin);
  await waitFor(async () => !isCurrent(await session()), 'the change to be noted');
  expect((await titlesFor('wombat')).some((t) => t.startsWith('Wombat notes')), 'the new bookmark is not listed');
  const stale = await titlesFor('only copy');
  expect(!stale.some((t) => t.startsWith('Only in the copy')), 'the old copy was still used');
});

await step('a removed bookmark is gone from the next bar', async () => {
  await inWorker(async () => {
    const [found] = await chrome.bookmarks.search({ title: 'Wombat notes' });
    await chrome.bookmarks.remove(found.id);
  });
  await waitFor(async () => !isCurrent(await session()), 'the change to be noted');
  const titles = await titlesFor('wombat');
  expect(!titles.some((t) => t.startsWith('Wombat notes')), `rows: ${JSON.stringify(titles)}`);
});

await step('a page visited since then is found in the next bar', async () => {
  await waitFor(async () => isCurrent(await session()), 'a current cache');
  await inWorker((origin) => chrome.history.addUrl({ url: `${origin}/history-only?topic=kombucha` }), origin);
  await waitFor(async () => !isCurrent(await session()), 'the visit to be noted');
  const titles = await titlesFor('kombucha');
  expect(titles.some((t) => t.includes('topic=kombucha')), `rows: ${JSON.stringify(titles)}`);
});

await finish(chrome, site);
