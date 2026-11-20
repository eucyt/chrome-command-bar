// The bar UI. Runs as an extension page in three places: an iframe over a web
// page ("overlay"), the toolbar popup ("popup") and a small fallback window
// ("window").

import { forgetArchived, loadArchive, loadSettings } from './autoclose.js';
import { availableCommands, findCommand } from './commands.js';
import { readIndexCache, writeIndexCache } from './index-cache.js';
import { MAX_TEXT_LENGTH } from './lib/fuzzy.js';
import { isFresh, makeCache } from './lib/index-cache.js';
import { DEFAULTS, opensInCurrentTab } from './lib/preferences.js';
import { buildArchiveIndex, buildIndex, defaultResults, search } from './lib/rank.js';
import { dedupeKey, describeOrigin, toUrl } from './lib/url.js';
import { loadPreferences } from './preferences.js';

const RESULT_LIMIT = 50;
const DAY = 24 * 60 * 60 * 1000;
const NONCE_PREFIX = 'nonce:';
const REFOCUS_LIMIT = 50;

const mode = document.documentElement.dataset.mode;
const isMac = document.documentElement.dataset.platform === 'mac';
const params = new URLSearchParams(location.search);

const input = /** @type {HTMLInputElement} */ (document.getElementById('query'));
const list = document.getElementById('results');
const originEl = document.getElementById('origin');
const backdrop = document.getElementById('backdrop');
const panel = document.getElementById('panel');

const OWN_ORIGIN = chrome.runtime.getURL('');
/** Empty new tabs and this extension's own pages are not worth listing as places to go. */
const isBlankTab = (url) => !url || url.startsWith(OWN_ORIGIN) || url.startsWith('chrome://newtab');

const TYPE_LABEL = { tab: 'タブ', closed: '最近閉じた', archived: 'アーカイブ', bookmark: 'ブックマーク', history: '履歴', command: 'コマンド' };

const state = {
  /** @type {chrome.tabs.Tab | null} */
  contextTab: null,
  sources: { tabs: [], closed: [], bookmarks: [], history: [] },
  /** @type {import('./lib/rank.js').Item[]} */
  items: [],
  /** @type {{kind: string, item?: any, url?: string, text?: string, titlePositions?: number[], urlPositions?: number[]}[]} */
  rows: [],
  /** What the bar lists: everything, or only the tabs that were closed automatically. */
  view: 'all',
  /** @type {boolean | undefined} unknown until the setting has been read */
  autoClose: undefined,
  /** @type {import('./lib/preferences.js').Preferences} */
  prefs: DEFAULTS,
  selected: 0,
  /** @type {string | null} last pointer position seen over the list */
  pointerAt: null,
};

main();

async function main() {
  const [allowed, prefs] = await Promise.all([resolveContext(), loadPreferences().catch(() => DEFAULTS)]);
  if (!allowed) {
    document.body.replaceChildren();
    return;
  }
  state.prefs = prefs;
  localizeHints();
  renderOrigin();
  bindEvents();
  input.focus();

  // Tabs come back at once, and bookmarks and history are listed from the copy
  // the previous bar left behind. The slower sources follow.
  const [tabs, stored] = await Promise.all([chrome.tabs.query({}).catch(() => []), readIndexCache()]);
  state.sources.tabs = tabs.filter((t) => !isBlankTab(t.url || t.pendingUrl));
  if (stored.cache) {
    state.sources.bookmarks = stored.cache.bookmarks;
    state.sources.history = stored.cache.history;
  }
  rebuild();

  const fresh = isFresh(stored.cache, { changedAt: stored.changedAt, prefs });
  const [closed, reloaded, settings] = await Promise.all([loadClosed(), fresh ? null : reloadCache(), loadSettings().catch(() => null)]);
  state.autoClose = settings?.enabled;
  state.sources.closed = closed;
  if (reloaded) {
    state.sources.bookmarks = reloaded.bookmarks;
    state.sources.history = reloaded.history;
  }
  rebuild();
}

/** Reads bookmarks and history from the APIs and leaves a copy for the next bar. */
async function reloadCache() {
  const loadedAt = Date.now();
  const [bookmarks, history] = await Promise.all([loadBookmarks(), loadHistory()]);
  const cache = makeCache({ bookmarks, history, prefs: state.prefs, loadedAt });
  // Not awaited: the rows should not wait for the write.
  writeIndexCache(cache);
  return cache;
}

/**
 * Works out which tab the bar belongs to. In overlay mode this also checks the
 * one-time token the service worker stored, so a web page that embeds this
 * page on its own gets nothing.
 */
async function resolveContext() {
  if (mode === 'overlay') {
    const key = NONCE_PREFIX + location.hash.slice(1);
    const stored = (await chrome.storage.session.get(key))[key];
    if (!stored) return false;
    await chrome.storage.session.remove(key);
    state.contextTab = await chrome.tabs.get(stored.tabId).catch(() => null);
    return true;
  }
  if (mode === 'window') {
    const tabId = Number(params.get('tabId'));
    state.contextTab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
    return true;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.contextTab = active ?? null;
  return true;
}

async function loadClosed() {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS }).catch(() => []);
  const out = [];
  for (const s of sessions) {
    const when = (s.lastModified ?? 0) * 1000;
    if (s.tab) out.push({ title: s.tab.title, url: s.tab.url, sessionId: s.tab.sessionId, lastModified: when });
    for (const t of s.window?.tabs ?? []) {
      out.push({ title: t.title, url: t.url, sessionId: t.sessionId, lastModified: when });
    }
  }
  return out.filter((e) => e.sessionId && !isBlankTab(e.url));
}

async function loadBookmarks() {
  const tree = await chrome.bookmarks.getTree().catch(() => []);
  const out = [];
  const walk = (nodes, path) => {
    for (const node of nodes) {
      if (node.url) out.push({ title: node.title, url: node.url, folder: path });
      if (node.children) walk(node.children, node.title ? `${path} ${node.title}`.trim() : path);
    }
  };
  walk(tree, '');
  return out;
}

function loadHistory() {
  return chrome.history
    .search({ text: '', startTime: Date.now() - state.prefs.historyDays * DAY, maxResults: state.prefs.historyMax })
    .catch(() => []);
}

function rebuild() {
  if (state.view !== 'all') return;
  const ctx = { tab: state.contextTab, autoClose: state.autoClose };
  state.items = buildIndex({
    ...state.sources,
    commands: availableCommands(ctx),
    contextTabId: state.contextTab?.id,
  });
  update();
}

/** Recomputes the rows for the current query and redraws them. */
function update({ keepSelection = false } = {}) {
  const query = input.value;
  const trimmed = query.trim();
  const rows = [];

  if (state.view === 'archive') {
    const results = trimmed
      ? search(query, state.items, { limit: RESULT_LIMIT })
      : state.items.slice(0, RESULT_LIMIT).map((item) => ({ item, titlePositions: [], urlPositions: [] }));
    for (const r of results) rows.push({ kind: 'item', ...r });
    if (!rows.length) rows.push({ kind: 'empty', text: trimmed ? '一致するタブはありません' : 'アーカイブしたタブはありません' });
  } else if (!trimmed) {
    for (const r of defaultResults(state.items, { limit: RESULT_LIMIT, closedLimit: state.prefs.closedCount })) rows.push({ kind: 'item', ...r });
  } else {
    const results = search(query, state.items, { limit: RESULT_LIMIT });
    const commandOnly = trimmed.startsWith('>');
    const url = commandOnly ? null : toUrl(trimmed);
    const topIsSamePage = url && results[0]?.item.url && dedupeKey(results[0].item.url) === dedupeKey(url);
    if (url && !topIsSamePage) rows.push({ kind: 'url', url });
    for (const r of results) rows.push({ kind: 'item', ...r });
    if (!commandOnly) rows.push({ kind: 'search', text: trimmed });
  }

  state.rows = rows;
  state.selected = keepSelection ? Math.min(state.selected, Math.max(0, rows.length - 1)) : 0;
  render();
}

function render() {
  const fragment = document.createDocumentFragment();
  state.rows.forEach((row, index) => fragment.appendChild(renderRow(row, index)));
  list.replaceChildren(fragment);
  applySelection();
}

function renderRow(row, index) {
  const li = document.createElement('li');
  li.className = 'row';
  li.id = `row-${index}`;
  li.setAttribute('role', 'option');
  li.dataset.index = String(index);

  const icon = document.createElement('span');
  icon.className = 'icon';
  const text = document.createElement('div');
  text.className = 'text';
  const title = document.createElement('div');
  title.className = 'title';
  const sub = document.createElement('div');
  sub.className = 'sub';
  const badge = document.createElement('span');
  badge.className = 'badge';

  if (row.kind === 'empty') {
    li.dataset.type = 'empty';
    title.textContent = row.text;
  } else if (row.kind === 'url') {
    li.dataset.type = 'url';
    icon.textContent = '↗';
    title.textContent = row.url;
    sub.textContent = 'このURLを開く';
    badge.textContent = 'URL';
  } else if (row.kind === 'search') {
    li.dataset.type = 'search';
    icon.textContent = '⌕';
    title.textContent = row.text;
    sub.textContent = '既定の検索エンジンで検索';
    badge.textContent = 'Web検索';
  } else {
    const item = row.item;
    li.dataset.type = item.type;
    if (item.type === 'command') {
      icon.textContent = '›';
      title.append(...highlight(item.title, row.titlePositions));
    } else {
      icon.appendChild(favicon(item.url));
      title.append(...highlight(item.title, row.titlePositions));
      sub.append(...highlight(item.matchUrl, row.urlPositions));
    }
    badge.textContent = item.isContext ? '現在のタブ' : TYPE_LABEL[item.type];
  }

  text.appendChild(title);
  if (sub.childNodes.length) text.appendChild(sub);
  li.append(icon, text, badge);
  return li;
}

/**
 * Splits text into plain and <mark> nodes. Built from text nodes only: page
 * titles are untrusted, so nothing here is ever parsed as HTML.
 */
function highlight(text, positions = []) {
  const chars = Array.from(String(text ?? ''));
  if (!positions.length) return [document.createTextNode(chars.join(''))];
  const marked = new Set(positions.filter((p) => p < MAX_TEXT_LENGTH));
  const nodes = [];
  let buffer = '';
  let inMark = false;
  const flush = () => {
    if (!buffer) return;
    if (inMark) {
      const el = document.createElement('mark');
      el.textContent = buffer;
      nodes.push(el);
    } else {
      nodes.push(document.createTextNode(buffer));
    }
    buffer = '';
  };
  chars.forEach((ch, i) => {
    const hit = marked.has(i);
    if (hit !== inMark) {
      flush();
      inMark = hit;
    }
    buffer += ch;
  });
  flush();
  return nodes;
}

function favicon(pageUrl) {
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.src = `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl ?? '')}&size=32`;
  return img;
}

function applySelection() {
  const rows = list.children;
  for (let i = 0; i < rows.length; i++) rows[i].setAttribute('aria-selected', String(i === state.selected));
  const active = rows[state.selected];
  if (active) {
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function move(delta) {
  const count = state.rows.length;
  if (!count) return;
  state.selected = (state.selected + delta + count) % count;
  applySelection();
}

function renderOrigin() {
  if (!state.contextTab?.url) {
    originEl.textContent = '';
    return;
  }
  const info = describeOrigin(state.contextTab.url);
  originEl.dataset.secure = String(info.secure);
  const isHttps = state.contextTab.url.startsWith('https:');
  originEl.textContent =
    info.kind !== 'web' ? info.label : info.secure ? `${isHttps ? '🔒 ' : ''}${info.label}` : `⚠ ${info.label}（暗号化なし）`;
}

function localizeHints() {
  if (state.prefs.openIn === 'currentTab') {
    for (const el of document.querySelectorAll('.alt-action')) el.textContent = '新しいタブで開く';
  }
  if (isMac) return;
  for (const el of document.querySelectorAll('.alt-key')) el.textContent = 'Alt ↵';
}

function bindEvents() {
  input.addEventListener('input', () => update());
  input.addEventListener('keydown', onKeyDown);
  window.addEventListener('focus', () => input.focus());

  list.addEventListener('mousemove', (event) => {
    // Chrome fires mousemove when the list appears or changes under a resting
    // cursor. Only a real move may take the selection away from the top row.
    const at = `${event.screenX},${event.screenY}`;
    if (state.pointerAt === null) state.pointerAt = at;
    if (state.pointerAt === at) return;
    state.pointerAt = at;
    const row = event.target.closest?.('.row');
    if (!row) return;
    const index = Number(row.dataset.index);
    if (index !== state.selected) {
      state.selected = index;
      applySelection();
    }
  });
  list.addEventListener('click', (event) => {
    const row = event.target.closest?.('.row');
    if (!row) return;
    state.selected = Number(row.dataset.index);
    activate({ inCurrentTab: opensInCurrentTab(state.prefs, event.altKey) });
  });

  if (mode === 'overlay') {
    backdrop.addEventListener('click', (event) => {
      if (!panel.contains(event.target)) close();
    });
    // Without this, a page that calls focus() on one of its own fields would
    // receive whatever is typed next. Capped so a page cannot drag the bar into
    // an endless focus fight.
    let refocusBudget = REFOCUS_LIMIT;
    window.addEventListener('blur', () => {
      if (refocusBudget-- > 0) window.parent.postMessage({ type: 'yadokari:focus' }, '*');
    });
  }
  if (mode === 'window') {
    window.addEventListener('blur', () => close());
  }
  if (mode !== 'overlay') {
    // The shortcut was pressed again; the page under an overlay removes that one itself.
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'yadokari:close') close();
    });
  }
}

function onKeyDown(event) {
  // Enter and arrows belong to the IME while Japanese text is being composed.
  if (event.isComposing || event.keyCode === 229) return;

  const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      return move(1);
    case 'ArrowUp':
      event.preventDefault();
      return move(-1);
    case 'Tab':
      event.preventDefault();
      return move(event.shiftKey ? -1 : 1);
    case 'n':
    case 'p':
      if (ctrlOnly) {
        event.preventDefault();
        return move(event.key === 'n' ? 1 : -1);
      }
      return undefined;
    case 'Enter':
      event.preventDefault();
      if (event.shiftKey && state.view === 'all') return webSearch(input.value.trim());
      return activate({ inCurrentTab: opensInCurrentTab(state.prefs, event.altKey) });
    case 'Escape':
      event.preventDefault();
      return close();
    case 'Backspace':
      if (isCloseTabChord(event)) {
        event.preventDefault();
        return closeSelectedTab();
      }
      return undefined;
    default:
      return undefined;
  }
}

/** Ctrl+⌫ on macOS, Alt+⌫ elsewhere: close the highlighted tab without leaving the bar. */
function isCloseTabChord(event) {
  return isMac ? event.ctrlKey && !event.metaKey : event.altKey && !event.ctrlKey;
}

async function closeSelectedTab() {
  const row = state.rows[state.selected];
  if (row?.kind !== 'item' || row.item.type !== 'tab' || row.item.isContext) return;
  await chrome.tabs.remove(row.item.tabId).catch(() => {});
  state.sources.tabs = state.sources.tabs.filter((t) => t.id !== row.item.tabId);
  const selected = state.selected;
  rebuild();
  state.selected = Math.min(selected, Math.max(0, state.rows.length - 1));
  applySelection();
}

async function activate({ inCurrentTab = false } = {}) {
  const row = state.rows[state.selected];
  if (!row) {
    const text = input.value.trim();
    if (text) await webSearch(text);
    return;
  }
  try {
    if (row.kind === 'empty') return;
    if (row.kind === 'url') return await openUrl(row.url, inCurrentTab);
    if (row.kind === 'search') return await webSearch(row.text);

    const item = row.item;
    if (item.type === 'tab') {
      await chrome.tabs.update(item.tabId, { active: true });
      await chrome.windows.update(item.windowId, { focused: true });
      return close();
    }
    if (item.type === 'closed') {
      await chrome.sessions.restore(item.sessionId);
      return close();
    }
    if (item.type === 'archived') {
      await forgetArchived(item.url);
      return await openUrl(item.url, inCurrentTab);
    }
    if (item.type === 'command') {
      const command = findCommand(item.commandId);
      if (command?.view === 'archive') return await showArchive();
      await command?.run({ tab: state.contextTab });
      return close();
    }
    return await openUrl(item.url, inCurrentTab);
  } catch (error) {
    console.error(`[yadokari] action failed: ${error?.name ?? ''} ${error?.message ?? error}`);
    close();
  }
}

/** Turns the bar into a list of the automatically closed tabs, newest first. */
async function showArchive() {
  state.view = 'archive';
  document.documentElement.dataset.view = 'archive';
  state.items = buildArchiveIndex(await loadArchive());
  input.value = '';
  input.placeholder = 'アーカイブしたタブを検索';
  update();
  input.focus();
}

async function openUrl(url, inCurrentTab) {
  const ctx = state.contextTab;
  if (ctx && inCurrentTab) {
    await chrome.tabs.update(ctx.id, { url });
    return close();
  }
  await chrome.tabs.create(
    ctx ? { url, windowId: ctx.windowId, index: ctx.index + 1, openerTabId: ctx.id } : { url },
  );
  return close();
}

async function webSearch(text) {
  if (!text) return;
  await chrome.search.query({ text, disposition: 'NEW_TAB' });
  return close();
}

function close() {
  if (mode === 'overlay') {
    window.parent.postMessage({ type: 'yadokari:close' }, '*');
  } else {
    window.close();
  }
}
