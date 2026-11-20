// Reads and writes what the settings page changes.

import { normalizePreferences } from './lib/preferences.js';

const KEY = 'preferences';

/** @returns {Promise<import('./lib/preferences.js').Preferences>} */
export async function loadPreferences() {
  return normalizePreferences((await chrome.storage.local.get(KEY))[KEY]);
}

/**
 * @param {Partial<Record<keyof import('./lib/preferences.js').Preferences, unknown>>} patch
 * @returns {Promise<import('./lib/preferences.js').Preferences>} what was stored, after limits were applied
 */
export async function savePreferences(patch) {
  const next = normalizePreferences({ ...(await chrome.storage.local.get(KEY))[KEY], ...patch });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
