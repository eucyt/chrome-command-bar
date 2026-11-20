// Loaded synchronously in <head> so the right layout applies before first paint.
(() => {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  if (!root.dataset.mode) root.dataset.mode = params.get('mode') || 'popup';
  root.dataset.platform = /Mac/i.test(navigator.platform) ? 'mac' : 'other';
})();
