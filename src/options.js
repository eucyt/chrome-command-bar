// The settings page. Every change is stored at once; there is no save button.

import { LIMITS } from './lib/preferences.js';
import { loadPreferences, savePreferences } from './preferences.js';

const form = /** @type {HTMLFormElement} */ (document.getElementById('options'));
const status = document.getElementById('status');

for (const [name, { min, max }] of Object.entries(LIMITS)) {
  const field = /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
  field.min = String(min);
  field.max = String(max);
}
if (!/Mac/i.test(navigator.platform)) document.getElementById('modifier').textContent = 'Alt+';

show(await loadPreferences());
showShortcut();

/** @param {import('./lib/preferences.js').Preferences} prefs */
function show(prefs) {
  for (const [name, value] of Object.entries(prefs)) {
    const field = form.elements.namedItem(name);
    if (field instanceof RadioNodeList) field.value = String(value);
    else if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = Boolean(value);
    else if (field instanceof HTMLInputElement) field.value = String(value);
  }
}

form.addEventListener('change', async (event) => {
  const field = /** @type {HTMLInputElement} */ (event.target);
  if (!field.name) return;
  // Shown again after saving, so a value outside the limits is visibly corrected.
  show(await savePreferences({ [field.name]: field.type === 'checkbox' ? field.checked : field.value }));
  status.textContent = '保存しました';
});

document.getElementById('open-shortcuts').addEventListener('click', () => {
  // chrome:// pages cannot be linked to; they have to be opened through the API.
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

async function showShortcut() {
  const commands = await chrome.commands.getAll().catch(() => []);
  const shortcut = commands.find((c) => c.name === 'toggle-bar')?.shortcut;
  document.getElementById('shortcut').textContent = shortcut || '未設定';
}
