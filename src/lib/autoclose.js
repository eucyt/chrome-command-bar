// Decides which idle tabs to close and what the archive of closed tabs keeps. Pure functions.

import { dedupeKey, isOpenable } from './url.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DEFAULT_TTL = 12 * HOUR;
export const ARCHIVE_MAX = 500;
export const ARCHIVE_MAX_AGE = 30 * DAY;

/**
 * @typedef {object} Settings
 * @property {boolean} enabled
 * @property {number} since when the feature was last switched on; idle time before it does not count
 * @property {number} ttl how long a tab may sit unused, in ms
 */

/** @typedef {{url: string, title: string, closedAt: number}} ArchiveEntry */

/**
 * The fields of Chrome's tab object that matter here.
 * @typedef {{id?: number, url?: string, pendingUrl?: string, title?: string, pinned?: boolean, active?: boolean, audible?: boolean, incognito?: boolean, lastAccessed?: number}} Tab
 */

/**
 * Fills in defaults for whatever is stored.
 * @returns {Settings}
 */
export function normalizeSettings(stored) {
  const ttl = Number(stored?.ttl);
  return {
    enabled: stored?.enabled !== false,
    since: Number(stored?.since) || 0,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL,
  };
}

/** Tabs that are never closed: pinned, showing in a window, or playing sound. */
function isProtected(tab) {
  return Boolean(tab.pinned || tab.active || tab.audible);
}

/**
 * One pass over the open tabs: refreshes the last-used times and picks the tabs
 * that have been idle for longer than `ttl`.
 *
 * Chrome's own `lastAccessed` is only trusted for tabs seen for the first time
 * (after a browser restart, say); it is reported to be lost when a tab is discarded.
 *
 * @param {Tab[]} tabs
 * @param {Record<string, number>} lastUsed tab id -> time, from the previous pass
 * @param {{now: number, ttl?: number, since?: number}} options
 * @returns {{lastUsed: Record<string, number>, close: Tab[]}}
 */
export function planSweep(tabs, lastUsed, { now, ttl = DEFAULT_TTL, since = 0 }) {
  /** @type {Record<string, number>} */
  const next = {};
  const close = [];
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    if (isProtected(tab)) {
      next[tab.id] = now;
      continue;
    }
    const seen = lastUsed?.[tab.id] ?? (tab.lastAccessed > 0 ? Math.min(tab.lastAccessed, now) : now);
    if (now - Math.max(seen, since) >= ttl) close.push(tab);
    else next[tab.id] = seen;
  }
  return { lastUsed: next, close };
}

/**
 * Incognito pages must not be written to disk, some URLs cannot be reopened,
 * and neither an empty new tab nor one of this extension's own pages is worth keeping.
 */
function isArchivable(tab, ownOrigin) {
  const url = tab.url || tab.pendingUrl;
  if (tab.incognito || !url || !isOpenable(url)) return false;
  return !url.startsWith('chrome://newtab') && !(ownOrigin && url.startsWith(ownOrigin));
}

/**
 * Adds just-closed tabs to the archive. Newest first, one entry per page,
 * old and surplus entries dropped.
 * @param {ArchiveEntry[]} archive
 * @param {Tab[]} tabs
 * @param {{now: number, ownOrigin?: string, max?: number, maxAge?: number}} options `ownOrigin` is this extension's URL prefix
 * @returns {ArchiveEntry[]}
 */
export function addToArchive(archive, tabs, { now, ownOrigin, max = ARCHIVE_MAX, maxAge = ARCHIVE_MAX_AGE }) {
  const added = tabs.filter((tab) => isArchivable(tab, ownOrigin)).map((tab) => {
    const url = tab.url || tab.pendingUrl;
    return { url, title: tab.title || url, closedAt: now };
  });
  const seen = new Set();
  const out = [];
  for (const entry of [...added, ...(archive ?? [])]) {
    if (now - entry.closedAt > maxAge) continue;
    const key = dedupeKey(entry.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out.sort((a, b) => b.closedAt - a.closedAt).slice(0, max);
}

/** The archive without the given page, for after it has been restored. */
export function removeFromArchive(archive, url) {
  const key = dedupeKey(url);
  return (archive ?? []).filter((entry) => dedupeKey(entry.url) !== key);
}
