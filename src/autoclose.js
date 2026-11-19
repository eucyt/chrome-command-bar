// Closes tabs that have not been used for a while and keeps a record of them,
// so the bar can bring them back.

import { addToArchive, normalizeSettings, planSweep, removeFromArchive } from './lib/autoclose.js';

const SETTINGS_KEY = 'autoclose';
const ARCHIVE_KEY = 'autoclose:archive';
const LAST_USED_KEY = 'autoclose:lastUsed';

/** @returns {Promise<import('./lib/autoclose.js').Settings>} */
export async function loadSettings() {
  return normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

/** Switching on restarts every tab's clock, so nothing closes the moment the feature comes back. */
export async function setEnabled(enabled) {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {};
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...stored, enabled, since: Date.now() } });
}

/** @returns {Promise<import('./lib/autoclose.js').ArchiveEntry[]>} */
export async function loadArchive() {
  return (await chrome.storage.local.get(ARCHIVE_KEY))[ARCHIVE_KEY] ?? [];
}

export async function forgetArchived(url) {
  await chrome.storage.local.set({ [ARCHIVE_KEY]: removeFromArchive(await loadArchive(), url) });
}

/**
 * Service worker side. There is no timer (that would need the `alarms`
 * permission): tabs are checked whenever the user does something with a tab.
 */
export function watchTabs() {
  chrome.runtime.onInstalled.addListener(async () => {
    const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    // Tabs that were already idle before the extension arrived get a full period first.
    if (!stored) await chrome.storage.local.set({ [SETTINGS_KEY]: { enabled: true, since: Date.now() } });
    queueSweep();
  });
  chrome.runtime.onStartup.addListener(queueSweep);
  chrome.tabs.onActivated.addListener(queueSweep);
  chrome.tabs.onCreated.addListener(queueSweep);
  chrome.tabs.onRemoved.addListener(queueSweep);
  chrome.tabs.onUpdated.addListener((_id, change) => {
    if (change.status === 'complete' || 'audible' in change || 'pinned' in change) queueSweep();
  });
  chrome.windows.onFocusChanged.addListener(queueSweep);
}

let queue = Promise.resolve();

/** One sweep at a time: each reads and rewrites the same stored state. */
function queueSweep() {
  queue = queue.then(sweep).catch((error) => console.warn('[yadokari] auto-close failed:', error?.message ?? error));
  return queue;
}

async function sweep() {
  const settings = await loadSettings();
  // Nothing to keep up to date while off: switching back on restarts every clock.
  if (!settings.enabled) return;
  const tabs = await chrome.tabs.query({});
  const stored = (await chrome.storage.session.get(LAST_USED_KEY))[LAST_USED_KEY] ?? {};
  const now = Date.now();
  const plan = planSweep(tabs, stored, { now, ttl: settings.ttl, since: settings.since });

  if (plan.close.length) {
    // Recorded before closing, so a tab is never gone without a way back.
    await chrome.storage.local.set({ [ARCHIVE_KEY]: addToArchive(await loadArchive(), plan.close, { now, ownOrigin: chrome.runtime.getURL('') }) });
  }
  await chrome.storage.session.set({ [LAST_USED_KEY]: plan.lastUsed });
  await Promise.all(plan.close.map((tab) => chrome.tabs.remove(tab.id).catch(() => {})));
}
