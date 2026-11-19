// Helpers for driving the command bar in end-to-end tests.

import { TOGGLE_SHORTCUT, pressGlobal, sleep, waitFor } from './harness.mjs';

const OVERLAY_ID = 'chrome-command-bar-overlay';

/** Pages shared by the bar tests. Pass to `serve()`, adding more as needed. */
export const PAGES = {
  '/alpha': { title: 'Alpha ホーム', body: '<input id="page-input" placeholder="page input"><p>alpha</p>' },
  '/beta-github': { title: 'Beta GitHub リポジトリ', body: '<p>beta</p>' },
};

/**
 * @param {Awaited<ReturnType<import('./harness.mjs').launch>>} chrome
 */
export function barDriver(chrome) {
  const barUrl = `chrome-extension://${chrome.extensionId}/src/bar.html`;

  /** The bar's frame inside `page`, if it is open there. */
  const barFrame = (page) => page.frames().find((f) => f.url().startsWith(barUrl));
  const overlayPresent = (page) => page.evaluate((id) => Boolean(document.getElementById(id)), OVERLAY_ID);
  const waitClosed = (page) => waitFor(async () => !(await overlayPresent(page)), 'the bar to close');

  /** Opens the bar over `page` with the real shortcut and waits for its first rows. */
  async function openBar(page) {
    await page.bringToFront();
    await sleep(150);
    // A step that failed half-way may have left the bar open; start from closed.
    if (await overlayPresent(page)) {
      pressGlobal(TOGGLE_SHORTCUT);
      await waitClosed(page);
    }
    pressGlobal(TOGGLE_SHORTCUT);
    const frame = await waitFor(() => barFrame(page), 'the bar frame');
    await frame.waitForSelector('#results .row', { timeout: 5000 });
    // Rows can be drawn a moment before the frame owns the keyboard.
    await waitFor(() => frame.evaluate(() => document.hasFocus() && document.activeElement?.id === 'query'), 'the bar input to have focus');
    return frame;
  }

  /** The result rows as plain data. Works on the overlay frame and on the popup / new tab page. */
  const rows = (frame) =>
    frame.$$eval('#results .row', (els) =>
      els.map((el) => ({
        type: el.dataset.type,
        title: el.querySelector('.title')?.textContent ?? '',
        sub: el.querySelector('.sub')?.textContent ?? '',
        badge: el.querySelector('.badge')?.textContent ?? '',
        selected: el.getAttribute('aria-selected') === 'true',
        marks: [...el.querySelectorAll('mark')].map((m) => m.textContent).join('|'),
      })),
    );

  /** Sets the query, Japanese included. Real typing is covered separately with typeGlobal(). */
  async function type(frame, text) {
    await frame.focus('#query');
    await frame.evaluate((value) => {
      const input = document.getElementById('query');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await sleep(120);
  }

  /** Sends one keydown to the query input, with modifiers or IME state as given. */
  const key = (frame, name, init = {}) =>
    frame.evaluate(
      (name, init) => {
        document.getElementById('query').dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
      },
      name,
      init,
    );

  return { barFrame, overlayPresent, waitClosed, openBar, rows, type, key, overlayId: OVERLAY_ID };
}
