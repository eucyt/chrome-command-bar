// Service worker: opens and closes the bar, closes idle tabs and notes when bookmarks or history change.
// All searching happens in the bar page itself.

import { watchTabs } from './autoclose.js';
import { watchSources } from './index-cache.js';

const BAR_PAGE = 'src/bar.html';
const NONCE_PREFIX = 'nonce:';
const WINDOW_SIZE = { width: 720, height: 480 };

watchTabs();
watchSources();

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-bar') toggleBar(tab);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Asked for by name where Chrome can list the keys (130+): get(null) would
  // also copy the cached search data, on every closed tab.
  const session = chrome.storage.session;
  const keys = session.getKeys ? (await session.getKeys()).filter((k) => k.startsWith(NONCE_PREFIX)) : null;
  const all = await session.get(keys);
  const stale = Object.keys(all).filter((k) => k.startsWith(NONCE_PREFIX) && all[k]?.tabId === tabId);
  if (stale.length) await chrome.storage.session.remove(stale);
});

/**
 * Shows the bar over the given tab, or removes it when it is already there.
 * Pages Chrome does not let extensions touch (chrome://, the Web Store, the
 * new tab page) get the toolbar popup instead.
 */
async function toggleBar(tab) {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id) return openFallback(tab);

  // One-time token so that only the frame this call inserts can render the bar.
  const nonce = crypto.randomUUID();
  const key = NONCE_PREFIX + nonce;
  await chrome.storage.session.set({ [key]: { tabId: tab.id, createdAt: Date.now() } });

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: toggleOverlay,
      args: [`${chrome.runtime.getURL(BAR_PAGE)}?mode=overlay#${nonce}`],
    });
    if (injection?.result !== 'opened') await chrome.storage.session.remove(key);
  } catch (error) {
    // Expected on chrome:// pages, the Web Store and the like.
    console.info('[yadokari] cannot inject into this page, using the popup:', error?.message ?? error);
    await chrome.storage.session.remove(key);
    await openFallback(tab);
  }
}

async function openFallback(tab) {
  try {
    await chrome.action.openPopup(tab?.windowId ? { windowId: tab.windowId } : undefined);
    return;
  } catch {
    // openPopup refuses when the window is not focused or a popup is already open.
  }
  const parent = tab?.windowId ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
  const left = parent ? Math.round(parent.left + (parent.width - WINDOW_SIZE.width) / 2) : undefined;
  const top = parent ? Math.round(parent.top + Math.max(80, (parent.height - WINDOW_SIZE.height) / 4)) : undefined;
  await chrome.windows.create({
    url: `${chrome.runtime.getURL(BAR_PAGE)}?mode=window${tab?.id ? `&tabId=${tab.id}` : ''}`,
    type: 'popup',
    focused: true,
    ...WINDOW_SIZE,
    ...(parent ? { left, top } : {}),
  });
}

/**
 * Runs inside the page (isolated world). Inserts the bar as a full-viewport
 * iframe pointing at an extension page, so the page itself can read neither
 * what is typed nor the results.
 * @returns {'opened' | 'closed'}
 */
function toggleOverlay(src) {
  const ID = 'yadokari-overlay';
  const existing = document.getElementById(ID);
  if (existing) {
    if (typeof existing.__commandBarCleanup === 'function') existing.__commandBarCleanup();
    else existing.remove();
    return 'closed';
  }

  const frame = document.createElement('iframe');
  frame.id = ID;
  frame.src = src;
  frame.allow = 'clipboard-write';
  frame.title = 'Yadokari';

  const styles = {
    all: 'initial',
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    border: '0',
    margin: '0',
    padding: '0',
    display: 'block',
    'z-index': '2147483647',
    background: 'transparent',
    // Must equal the frame document's scheme, or Chrome paints the frame opaque.
    'color-scheme': 'light',
  };
  for (const [prop, value] of Object.entries(styles)) frame.style.setProperty(prop, value, 'important');

  const previouslyFocused = document.activeElement;
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type === 'yadokari:close') cleanup();
    // The bar lost the keyboard while open: the page called focus(), or Chrome
    // restored focus after a tab switch. Hand it back, unless the whole window
    // is in the background.
    if (event.data?.type === 'yadokari:focus' && document.hasFocus()) frame.focus({ preventScroll: true });
  };
  const cleanup = () => {
    window.removeEventListener('message', onMessage);
    frame.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
  };
  frame.__commandBarCleanup = cleanup;
  window.addEventListener('message', onMessage);
  frame.addEventListener('load', () => frame.focus({ preventScroll: true }));

  document.documentElement.appendChild(frame);
  frame.focus({ preventScroll: true });
  return 'opened';
}
