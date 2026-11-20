// Keeps the bookmarks and history the bar last read in `storage.session`, so
// the next bar can list them at once instead of waiting for the APIs.

import { validCache } from './lib/index-cache.js';

const CACHE_KEY = 'index:cache';
const CHANGED_KEY = 'index:changedAt';

/** @returns {Promise<{cache: import('./lib/index-cache.js').IndexCache | null, changedAt: number}>} */
export async function readIndexCache() {
  const stored = await chrome.storage.session.get([CACHE_KEY, CHANGED_KEY]).catch(() => ({}));
  return { cache: validCache(stored[CACHE_KEY]), changedAt: stored[CHANGED_KEY] ?? 0 };
}

/** @param {import('./lib/index-cache.js').IndexCache} cache */
export async function writeIndexCache(cache) {
  try {
    await chrome.storage.session.set({ [CACHE_KEY]: cache });
  } catch (error) {
    // Over the quota (a very large history). An older copy must not linger as if current.
    console.info('[yadokari] search data not cached:', error?.message ?? error);
    await chrome.storage.session.remove(CACHE_KEY).catch(() => {});
  }
}

/**
 * Service worker side. Only notes when something changed; the bar reads the
 * sources again the next time it opens. Rebuilding here would mean reading the
 * whole history on every page visit.
 */
export function watchSources() {
  const changed = () => chrome.storage.session.set({ [CHANGED_KEY]: Date.now() }).catch(() => {});
  for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[event].addListener(changed);
  }
  chrome.history.onVisited.addListener(changed);
  chrome.history.onVisitRemoved.addListener(changed);
  // History has no event for a title that arrives after the visit was recorded.
  chrome.tabs.onUpdated.addListener((_id, change) => {
    if ('title' in change) changed();
  });
}
