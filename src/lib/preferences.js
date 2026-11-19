// The values the settings page can change, with their defaults and limits. Pure functions.

/**
 * @typedef {object} Preferences
 * @property {number} historyDays how far back the history search reaches
 * @property {number} historyMax how many history entries are read at most
 * @property {number} closedCount recently closed tabs listed before anything is typed
 * @property {'newTab' | 'currentTab'} openIn where Enter opens a page; the modifier key gives the other one
 * @property {boolean} newtabFocus reload the new tab page once so that its input gets the cursor
 */

/** @type {Readonly<Preferences>} */
export const DEFAULTS = Object.freeze({
  historyDays: 90,
  historyMax: 4000,
  closedCount: 5,
  openIn: 'newTab',
  newtabFocus: true,
});

/** Chrome keeps at most 25 closed sessions, so asking for more would promise rows that never come. */
export const LIMITS = Object.freeze({
  historyDays: { min: 1, max: 365 },
  historyMax: { min: 100, max: 20000 },
  closedCount: { min: 0, max: 25 },
});

function clampInt(value, fallback, { min, max }) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Fills in defaults and pulls out-of-range values back in, whatever is stored or typed.
 * @returns {Preferences}
 */
export function normalizePreferences(stored) {
  return {
    historyDays: clampInt(stored?.historyDays, DEFAULTS.historyDays, LIMITS.historyDays),
    historyMax: clampInt(stored?.historyMax, DEFAULTS.historyMax, LIMITS.historyMax),
    closedCount: clampInt(stored?.closedCount, DEFAULTS.closedCount, LIMITS.closedCount),
    openIn: stored?.openIn === 'currentTab' ? 'currentTab' : DEFAULTS.openIn,
    newtabFocus: stored?.newtabFocus !== false,
  };
}

/**
 * Whether an activation should reuse the current tab: the modifier key picks
 * whichever of the two places is not the default.
 * @param {Preferences} prefs
 * @param {boolean} modifier
 */
export function opensInCurrentTab(prefs, modifier) {
  return (prefs.openIn === 'currentTab') !== Boolean(modifier);
}
