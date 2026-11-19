import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULTS, LIMITS, normalizePreferences, opensInCurrentTab } from '../src/lib/preferences.js';

test('nothing stored gives the defaults', () => {
  assert.deepEqual(normalizePreferences(undefined), DEFAULTS);
  assert.deepEqual(normalizePreferences({}), DEFAULTS);
});

test('the defaults are the values that used to be constants', () => {
  assert.deepEqual(DEFAULTS, { historyDays: 90, historyMax: 4000, closedCount: 5, openIn: 'newTab', newtabFocus: true });
});

test('stored values are kept, numbers typed as text included', () => {
  const prefs = normalizePreferences({ historyDays: '30', historyMax: 1000, closedCount: 0, openIn: 'currentTab', newtabFocus: false });
  assert.deepEqual(prefs, { historyDays: 30, historyMax: 1000, closedCount: 0, openIn: 'currentTab', newtabFocus: false });
});

test('numbers outside the limits are pulled back in and fractions rounded', () => {
  const prefs = normalizePreferences({ historyDays: 99999, historyMax: 1, closedCount: -3 });
  assert.equal(prefs.historyDays, LIMITS.historyDays.max);
  assert.equal(prefs.historyMax, LIMITS.historyMax.min);
  assert.equal(prefs.closedCount, 0);
  assert.equal(normalizePreferences({ closedCount: 2.6 }).closedCount, 3);
});

test('an emptied or meaningless field falls back to its default', () => {
  for (const junk of ['', '  ', 'abc', null, NaN, Infinity]) {
    const prefs = normalizePreferences({ historyDays: junk, closedCount: junk, openIn: junk, newtabFocus: junk });
    assert.equal(prefs.historyDays, DEFAULTS.historyDays, `historyDays for ${junk}`);
    assert.equal(prefs.closedCount, DEFAULTS.closedCount, `closedCount for ${junk}`);
    assert.equal(prefs.openIn, 'newTab');
    assert.equal(prefs.newtabFocus, true);
  }
});

test('the modifier key opens in whichever place is not the default', () => {
  assert.equal(opensInCurrentTab(DEFAULTS, false), false);
  assert.equal(opensInCurrentTab(DEFAULTS, true), true);
  const reuse = { ...DEFAULTS, openIn: 'currentTab' };
  assert.equal(opensInCurrentTab(reuse, false), true);
  assert.equal(opensInCurrentTab(reuse, true), false);
});
