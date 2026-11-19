// The bookmarks and history kept between two openings of the bar, and the rule
// for when that copy can be used without reading them again. Pure functions.

/**
 * @typedef {object} IndexCache
 * @property {number} loadedAt taken just before the sources were read
 * @property {number} historyDays the settings the history was read with
 * @property {number} historyMax
 * @property {{title: string, url: string, folder: string}[]} bookmarks
 * @property {{title: string, url: string, visitCount: number, typedCount: number, lastVisitTime: number}[]} history
 */

/**
 * Keeps only what ranking reads, so that thousands of entries stay well inside
 * the storage quota.
 * @returns {IndexCache['history']}
 */
export function slimHistory(items = []) {
  return items.map((h) => ({
    title: h.title ?? '',
    url: h.url ?? '',
    visitCount: h.visitCount ?? 0,
    typedCount: h.typedCount ?? 0,
    lastVisitTime: h.lastVisitTime ?? 0,
  }));
}

/**
 * @param {{bookmarks: IndexCache['bookmarks'], history: object[], prefs: {historyDays: number, historyMax: number}, loadedAt: number}} parts
 * @returns {IndexCache}
 */
export function makeCache({ bookmarks, history, prefs, loadedAt }) {
  return { loadedAt, historyDays: prefs.historyDays, historyMax: prefs.historyMax, bookmarks, history: slimHistory(history) };
}

/**
 * What was stored, or null when it is missing or not in the expected shape.
 * @returns {IndexCache | null}
 */
export function validCache(stored) {
  if (!stored || !Number.isFinite(stored.loadedAt)) return null;
  if (!Array.isArray(stored.bookmarks) || !Array.isArray(stored.history)) return null;
  return stored;
}

/**
 * Whether the copy still equals what the APIs would return. A change stamped
 * in the same millisecond as the read counts as newer: reading once too often
 * is harmless, showing a page that is gone is not.
 * @param {IndexCache | null} cache
 * @param {{changedAt?: number, prefs: {historyDays: number, historyMax: number}}} now
 */
export function isFresh(cache, { changedAt = 0, prefs }) {
  if (!cache) return false;
  if (cache.historyDays !== prefs.historyDays || cache.historyMax !== prefs.historyMax) return false;
  return cache.loadedAt > changedAt;
}
