// Turns raw tabs / bookmarks / history into one ranked result list. Pure functions.

import { normalize, positionsPrepared, prepare, scorePrepared, toNeedle, typoVariants } from './fuzzy.js';
import { dedupeKey, isOpenable, matchableUrl } from './url.js';

/** @typedef {'tab' | 'closed' | 'bookmark' | 'history' | 'command'} ItemType */

/**
 * @typedef {object} Item
 * @property {ItemType} type
 * @property {string} title
 * @property {string} [url]
 * @property {string} matchUrl text shown and matched for the URL (no scheme)
 * @property {string} [keywords] extra matchable text (command aliases, bookmark folder)
 * @property {number} [tabId]
 * @property {number} [windowId]
 * @property {string} [sessionId]
 * @property {string} [commandId]
 * @property {boolean} [isContext] the tab the bar was opened on
 * @property {number} [lastAccessed]
 * @property {number} [visitCount]
 * @property {number} [typedCount]
 * @property {number} [lastVisitTime]
 */

const TYPE_BONUS = { tab: 1.2, bookmark: 0.6, closed: 0.4, history: 0, command: -0.2 };
const TYPE_ORDER = { tab: 0, closed: 1, bookmark: 2, command: 3, history: 4 };
const URL_WEIGHT = 0.95;
const KEYWORD_WEIGHT = 0.9;
const MIN_SCORE_PER_CHAR = 0.34;
const TYPO_PENALTY = 1.0;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Merges every source into one list, dropping duplicates of the same page.
 * Priority when the same URL appears twice: tab > closed > bookmark > history.
 */
export function buildIndex({ tabs = [], closed = [], bookmarks = [], history = [], commands = [], contextTabId } = {}) {
  /** @type {Item[]} */
  const items = [];
  const seen = new Set();

  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl || '';
    seen.add(dedupeKey(url));
    items.push({
      type: 'tab',
      title: tab.title || url,
      url,
      matchUrl: matchableUrl(url),
      tabId: tab.id,
      windowId: tab.windowId,
      isContext: tab.id === contextTabId,
      lastAccessed: tab.lastAccessed ?? 0,
      pinned: Boolean(tab.pinned),
      audible: Boolean(tab.audible),
    });
  }

  const addUnique = (item) => {
    if (!item.url || !isOpenable(item.url)) return;
    const key = dedupeKey(item.url);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ ...item, matchUrl: matchableUrl(item.url) });
  };

  for (const entry of closed) {
    addUnique({
      type: 'closed',
      title: entry.title || entry.url,
      url: entry.url,
      sessionId: entry.sessionId,
      lastAccessed: entry.lastModified ?? 0,
    });
  }
  for (const bm of bookmarks) {
    addUnique({ type: 'bookmark', title: bm.title || bm.url, url: bm.url, keywords: bm.folder || '' });
  }
  for (const h of history) {
    addUnique({
      type: 'history',
      title: h.title || h.url,
      url: h.url,
      visitCount: h.visitCount ?? 0,
      typedCount: h.typedCount ?? 0,
      lastVisitTime: h.lastVisitTime ?? 0,
    });
  }
  for (const cmd of commands) {
    items.push({ type: 'command', title: cmd.title, matchUrl: '', keywords: cmd.keywords || '', commandId: cmd.id });
  }
  for (const item of items) prepared.set(item, fieldsOf(item));
  return items;
}

// Query-independent match data per item, computed once when the index is built.
const prepared = new WeakMap();

function fieldsOf(item) {
  return [
    { field: 'title', weight: 1, data: prepare(item.title) },
    { field: 'url', weight: URL_WEIGHT, data: prepare(item.matchUrl) },
    { field: 'keywords', weight: KEYWORD_WEIGHT, data: prepare(item.keywords) },
  ].filter((f) => f.data.hay.length > 0);
}

function preparedFields(item) {
  let fields = prepared.get(item);
  if (!fields) {
    fields = fieldsOf(item);
    prepared.set(item, fields);
  }
  return fields;
}

/** What to show before anything is typed: other tabs, most recent first, then a few closed tabs. */
export function defaultResults(items, { limit = 50, closedLimit = 5 } = {}) {
  const tabs = items
    .filter((i) => i.type === 'tab')
    .sort((a, b) => Number(a.isContext) - Number(b.isContext) || b.lastAccessed - a.lastAccessed);
  const closed = items
    .filter((i) => i.type === 'closed')
    .sort((a, b) => b.lastAccessed - a.lastAccessed)
    .slice(0, closedLimit);
  return [...tabs, ...closed].slice(0, limit).map((item) => ({ item, score: 0, titlePositions: [], urlPositions: [] }));
}

function frecency(item, now) {
  if (item.type !== 'history') return 0;
  const visits = Math.min(1, Math.log10(1 + (item.visitCount || 0)) / 2) * 0.7;
  const typed = Math.min(0.3, (item.typedCount || 0) * 0.05);
  const age = now - (item.lastVisitTime || 0);
  const recent = age < DAY ? 0.4 : age < 7 * DAY ? 0.25 : age < 30 * DAY ? 0.1 : 0;
  return visits + typed + recent;
}

/**
 * Best field for one term: which of title / URL / keywords matched best.
 * @param {string[]} needle
 * @returns {{field: string, score: number, data: object} | null}
 */
function matchTerm(needle, item) {
  const minScore = needle.length * MIN_SCORE_PER_CHAR;
  let best = null;
  for (const { field, weight, data } of preparedFields(item)) {
    const raw = scorePrepared(needle, data);
    if (raw === null) continue;
    const score = raw * weight;
    if (score < minScore) continue;
    if (!best || score > best.score) best = { field, score, data };
  }
  return best;
}

/** Cheap pass: total score only. Positions are filled in later for the rows that survive. */
function scoreItem(needles, item, now) {
  let total = 0;
  const matches = [];
  for (const needle of needles) {
    const m = matchTerm(needle, item);
    if (!m) return null;
    total += m.score;
    matches.push(m);
  }
  const score = total + TYPE_BONUS[item.type] + frecency(item, now) + (item.isContext ? -0.5 : 0);
  return { item, score, needles, matches, titlePositions: [], urlPositions: [] };
}

/** Expensive pass, run only on the rows that will be shown. */
function withPositions(result) {
  const title = new Set();
  const url = new Set();
  result.matches.forEach((m, i) => {
    if (m.field !== 'title' && m.field !== 'url') return;
    const found = positionsPrepared(result.needles[i], m.data);
    for (const p of found?.positions ?? []) (m.field === 'title' ? title : url).add(p);
  });
  return {
    item: result.item,
    score: result.score,
    titlePositions: [...title].sort((a, b) => a - b),
    urlPositions: [...url].sort((a, b) => a - b),
  };
}

function runTerms(terms, items, now) {
  const needles = terms.map(toNeedle);
  const out = [];
  for (const item of items) {
    const scored = scoreItem(needles, item, now);
    if (scored) out.push(scored);
  }
  return out;
}

/**
 * Ranks items for a typed query.
 * A leading ">" restricts the search to commands. Terms are space separated and
 * must all match. When nothing matches, one typo per term is forgiven.
 */
export function search(query, items, { now = Date.now(), limit = 50 } = {}) {
  let text = normalize(query).trim();
  let pool = items;
  if (text.startsWith('>')) {
    text = text.slice(1).trim();
    pool = items.filter((i) => i.type === 'command');
    if (!text) {
      return pool.map((item) => ({ item, score: 0, titlePositions: [], urlPositions: [] }));
    }
  } else if (toNeedle(text).length < 2) {
    pool = items.filter((i) => i.type !== 'command');
  }
  const terms = text.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  let results = runTerms(terms, pool, now);

  if (results.length === 0) {
    const best = new Map();
    terms.forEach((term, index) => {
      for (const variant of typoVariants(term)) {
        const relaxed = terms.slice();
        relaxed[index] = variant;
        for (const r of runTerms(relaxed, pool, now)) {
          r.score -= TYPO_PENALTY;
          const prev = best.get(r.item);
          if (!prev || r.score > prev.score) best.set(r.item, r);
        }
      }
    });
    results = [...best.values()];
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      TYPE_ORDER[a.item.type] - TYPE_ORDER[b.item.type] ||
      (b.item.lastAccessed || b.item.lastVisitTime || 0) - (a.item.lastAccessed || a.item.lastVisitTime || 0),
  );
  return results.slice(0, limit).map(withPositions);
}
