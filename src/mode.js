// Loaded synchronously in <head> so the right layout applies before first paint.
(() => {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  if (!root.dataset.mode) root.dataset.mode = params.get('mode') || 'popup';
  root.dataset.platform = /Mac/i.test(navigator.platform) ? 'mac' : 'other';

  // Chrome puts the cursor in the address bar on a new tab and ignores focus()
  // from the page. Re-navigating the tab to this same page hands focus to the
  // page, at the price of the address bar showing the extension URL. The
  // settings page can switch this off (key and default as in preferences.js).
  if (root.dataset.mode === 'newtab' && !params.has('focus')) {
    chrome.storage.local.get('preferences').then(
      (stored) => stored.preferences?.newtabFocus !== false,
      () => true,
    ).then((wanted) => {
      if (wanted) location.replace(`${location.pathname}?focus=1`);
    });
  }
})();
