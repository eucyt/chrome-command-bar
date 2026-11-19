// End-to-end test against real Chrome. Needs an X display (use `xvfb-run -a`),
// Chrome for Testing, and python3 with python-xlib + Pillow.
//
//   xvfb-run -a -s "-screen 0 1280x800x24" node test/e2e/run.mjs
//
// The shortcut is pressed through the X server, so the whole chain is real:
// browser shortcut -> extension command -> activeTab grant -> injection.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import puppeteer from 'puppeteer-core';

const here = import.meta.dirname;
const extensionDir = path.resolve(here, '../..');
const artifacts = path.join(here, 'artifacts');
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const TOGGLE = 'ctrl+shift+k';
mkdirSync(artifacts, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xkeys = (...args) => execFileSync('python3', [path.join(here, 'xkeys.py'), ...args]);
const pressGlobal = (combo) => xkeys('key', combo);
const screenShot = (name) => xkeys('shot', path.join(artifacts, name));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}\n     ${String(error?.message ?? error).split('\n').join('\n     ')}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
async function waitFor(fn, what, timeout = 5000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

// --- test pages -------------------------------------------------------------
const PAGES = {
  '/alpha': { title: 'Alpha ホーム', body: '<input id="page-input" placeholder="page input"><p>alpha</p>' },
  '/beta-github': { title: 'Beta GitHub リポジトリ', body: '<p>beta</p>' },
  '/dark': {
    title: 'Dark page',
    head: '<meta name="color-scheme" content="dark"><style>html{background:#101010;color:#eee}</style>',
    body: '<p>dark</p>',
  },
  '/hostile-css': {
    title: 'Hostile CSS',
    head: '<style>iframe{display:none!important;width:10px!important;height:10px!important;position:static!important;opacity:0!important}</style>',
    body: '<p>this page tries to hide every iframe</p>',
  },
  '/xss': { title: '<img src=x onerror="window.__pwned=1"><b>bold</b>', body: '<p>xss title</p>' },
  '/embedder': { title: 'Embedder', body: '<p>embeds the bar without a token</p>' },
  '/bookmarked-target': { title: 'Bookmarked target', body: '<p>bookmark</p>' },
  '/typed-target': { title: 'Typed target', body: '<p>typed</p>' },
};
const server = http
  .createServer((req, res) => {
    const page = PAGES[new URL(req.url, 'http://x').pathname];
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (!page) {
      res.statusCode = 404;
      return res.end('<title>404</title>');
    }
    const title = page.title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    res.end(`<!doctype html><html><head><title>${title}</title>${page.head ?? ''}</head><body style="font:18px sans-serif">${page.body}<p>${'lorem ipsum '.repeat(120)}</p></body></html>`);
  })
  .listen(0);
const origin = `http://localhost:${server.address().port}`;

// --- browser ----------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false,
  pipe: true,
  enableExtensions: [extensionDir],
  userDataDir: mkdtempSync(path.join(os.tmpdir(), 'command-bar-e2e-')),
  defaultViewport: null,
  args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', '--window-position=0,0'],
});

const workerTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'));
const worker = await workerTarget.worker();
const extensionId = new URL(workerTarget.url()).host;
const inWorker = (fn, ...args) => worker.evaluate(fn, ...args);
const activeTab = () => inWorker(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]);
const allTabs = () => inWorker(() => chrome.tabs.query({}));

const barFrame = (page) => page.frames().find((f) => f.url().startsWith(`chrome-extension://${extensionId}/src/bar.html`));
const overlayPresent = (page) => page.evaluate(() => Boolean(document.getElementById('chrome-command-bar-overlay')));
async function openBar(page) {
  await page.bringToFront();
  await sleep(150);
  // A step that failed half-way may have left the bar open; start from closed.
  if (await overlayPresent(page)) {
    pressGlobal(TOGGLE);
    await waitFor(async () => !(await overlayPresent(page)), 'a leftover bar to close');
  }
  pressGlobal(TOGGLE);
  const frame = await waitFor(() => barFrame(page), 'the bar frame');
  await frame.waitForSelector('#results .row', { timeout: 5000 });
  return frame;
}
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
async function type(frame, text) {
  await frame.focus('#query');
  await frame.evaluate((value) => {
    const input = document.getElementById('query');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await sleep(120);
}
const key = (frame, k, mods = {}) =>
  frame.evaluate(
    (k, mods) => {
      document.getElementById('query').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
    },
    k,
    mods,
  );

try {
  const alpha = (await browser.pages())[0];
  await alpha.goto(`${origin}/alpha`);
  const beta = await browser.newPage();
  await beta.goto(`${origin}/beta-github`);

  await inWorker(async (origin) => {
    await chrome.bookmarks.create({ title: 'お気に入りのページ Bookmarked', url: `${origin}/bookmarked-target` });
    await chrome.bookmarks.create({ title: 'bookmarklet', url: 'javascript:alert(1)' });
    await chrome.history.addUrl({ url: `${origin}/history-only-page?topic=kombucha` });
  }, origin);

  let frame;

  await step('real shortcut opens the bar over a web page, with the input focused', async () => {
    frame = await openBar(alpha);
    const focus = await frame.evaluate(() => ({ id: document.activeElement?.id, hasFocus: document.hasFocus() }));
    expect(focus.id === 'query' && focus.hasFocus, `focus was ${JSON.stringify(focus)}`);
    const rect = await alpha.evaluate(() => {
      const r = document.getElementById('chrome-command-bar-overlay').getBoundingClientRect();
      return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
    });
    expect(rect.w >= rect.vw - 20 && rect.h >= rect.vh - 20, `overlay does not cover the viewport: ${JSON.stringify(rect)}`);
    screenShot('01-overlay-default.png');
  });

  await step('before typing: other tabs first, the current tab last and labelled', async () => {
    const list = await rows(frame);
    expect(list[0].title === 'Beta GitHub リポジトリ' && list[0].selected, `first row: ${JSON.stringify(list[0])}`);
    const current = list.find((r) => r.title === 'Alpha ホーム');
    expect(current?.badge === '現在のタブ', `current tab row: ${JSON.stringify(current)}`);
    expect(list.indexOf(current) === list.filter((r) => r.type === 'tab').length - 1, 'current tab is not last among tabs');
  });

  await step('the footer shows the host of the page under the bar', async () => {
    const text = await frame.$eval('#origin', (el) => el.textContent);
    expect(text.includes(new URL(origin).host), `footer was "${text}"`);
  });

  await step('typing filters with fuzzy matching and highlights the matched letters', async () => {
    await type(frame, 'btgh');
    const list = await rows(frame);
    expect(list[0].title === 'Beta GitHub リポジトリ', `top row: ${JSON.stringify(list[0])}`);
    expect(list[0].marks.replace(/\|/g, '').toLowerCase() === 'btgh', `marks: ${list[0].marks}`);
    expect(list.at(-1).type === 'search', 'web search row is missing at the end');
    screenShot('02-overlay-query.png');
  });

  await step('Japanese text matches', async () => {
    await type(frame, 'リポジ');
    expect((await rows(frame))[0].title === 'Beta GitHub リポジトリ', 'Japanese query did not match');
  });

  await step('Enter during IME composition does nothing', async () => {
    await key(frame, 'Enter', { isComposing: true });
    await sleep(200);
    expect(await overlayPresent(alpha), 'the bar closed on a composing Enter');
    expect((await activeTab()).url.endsWith('/alpha'), 'tab changed on a composing Enter');
  });

  await step('Enter switches to the selected tab and closes the bar', async () => {
    await key(frame, 'Enter');
    await waitFor(async () => (await activeTab()).url.endsWith('/beta-github'), 'the beta tab to become active');
    await waitFor(async () => !(await overlayPresent(alpha)), 'the overlay to be removed');
  });

  await step('real key presses type into the bar, move the selection and activate it', async () => {
    frame = await openBar(beta);
    for (const ch of 'alpha') xkeys('key', ch, '--no-focus');
    await sleep(300);
    expect((await frame.$eval('#query', (el) => el.value)) === 'alpha', 'typed text did not reach the bar input');
    expect((await beta.evaluate(() => document.activeElement?.tagName)) === 'IFRAME', 'the page kept keyboard focus');
    xkeys('key', 'down', '--no-focus');
    xkeys('key', 'up', '--no-focus');
    xkeys('key', 'enter', '--no-focus');
    await waitFor(async () => (await activeTab()).url.endsWith('/alpha'), 'the alpha tab to become active');
    await beta.bringToFront();
    await waitFor(async () => !(await overlayPresent(beta)), 'the overlay to be removed');
  });

  await step('pressing the shortcut again closes the bar', async () => {
    frame = await openBar(beta);
    pressGlobal(TOGGLE);
    await waitFor(async () => !(await overlayPresent(beta)), 'the overlay to be removed by the second press');
  });

  await step('Esc closes the bar and gives focus back to the page', async () => {
    await alpha.bringToFront();
    await alpha.focus('#page-input');
    frame = await openBar(alpha);
    await key(frame, 'Escape');
    await waitFor(async () => !(await overlayPresent(alpha)), 'the overlay to be removed');
    expect((await alpha.evaluate(() => document.activeElement?.id)) === 'page-input', 'focus did not return to the page input');
  });

  await step('clicking outside the panel closes the bar', async () => {
    frame = await openBar(alpha);
    await alpha.mouse.click(30, 600);
    await waitFor(async () => !(await overlayPresent(alpha)), 'the overlay to be removed');
  });

  await step('bookmarks are found, bookmarklets are not, and Enter opens a new tab next to the current one', async () => {
    frame = await openBar(alpha);
    await type(frame, 'bookmarklet');
    expect(!(await rows(frame)).some((r) => r.type === 'bookmark' && r.title === 'bookmarklet'), 'a javascript: bookmark was listed');
    await type(frame, 'お気に入り');
    const top = (await rows(frame))[0];
    expect(top.type === 'bookmark' && top.badge === 'ブックマーク', `top row: ${JSON.stringify(top)}`);
    const before = await activeTab();
    await key(frame, 'Enter');
    const opened = await waitFor(async () => {
      const tab = await activeTab();
      return (tab.url || tab.pendingUrl || '').endsWith('/bookmarked-target') ? tab : null;
    }, 'the bookmark to open');
    expect(opened.id !== before.id && opened.index === before.index + 1, `opened at index ${opened.index}, expected ${before.index + 1}`);
    await waitFor(async () => !(await overlayPresent(alpha)), 'the overlay to be removed');
  });

  await step('history entries are found by URL', async () => {
    frame = await openBar(alpha);
    await type(frame, 'kombucha');
    const top = (await rows(frame))[0];
    expect(top.type === 'history' && top.sub.includes('history-only-page'), `top row: ${JSON.stringify(top)}`);
  });

  await step('a typed URL is offered first; Alt+Enter opens it in the current tab', async () => {
    frame = barFrame(alpha) ?? (await openBar(alpha));
    const typed = `${new URL(origin).host}/typed-target`;
    await type(frame, typed);
    const top = (await rows(frame))[0];
    expect(top.type === 'url' && top.title === `http://${typed}`, `top row: ${JSON.stringify(top)}`);
    const before = await allTabs();
    await key(frame, 'Enter', { altKey: true });
    await waitFor(() => alpha.url().endsWith('/typed-target'), 'the current tab to navigate');
    expect((await allTabs()).length === before.length, 'a new tab was opened');
    await alpha.goto(`${origin}/alpha`);
  });

  await step('a query with no match offers only the web search', async () => {
    frame = await openBar(alpha);
    await type(frame, 'qqqq wwww zzzz');
    const list = await rows(frame);
    expect(list.length === 1 && list[0].type === 'search' && list[0].selected, JSON.stringify(list));
  });

  await step('">" lists commands; "タブを複製" duplicates the current tab', async () => {
    await type(frame, '>');
    const list = await rows(frame);
    expect(list.length >= 10 && list.every((r) => r.type === 'command'), `rows: ${list.length}`);
    screenShot('03-overlay-commands.png');
    await type(frame, '> 複製');
    expect((await rows(frame))[0].title === 'タブを複製', 'duplicate command not on top');
    const before = (await allTabs()).length;
    await key(frame, 'Enter');
    await waitFor(async () => (await allTabs()).length === before + 1, 'the duplicated tab');
    const duplicate = await activeTab();
    await inWorker((id) => chrome.tabs.remove(id), duplicate.id);
    await sleep(200);
  });

  await step('"URLをコピー" puts the page URL on the clipboard', async () => {
    await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read']);
    frame = await openBar(alpha);
    await type(frame, '> urlをコピー');
    expect((await rows(frame))[0].title === 'URLをコピー', 'copy command not on top');
    await key(frame, 'Enter');
    await waitFor(async () => !(await overlayPresent(alpha)), 'the overlay to be removed');
    await alpha.bringToFront();
    await alpha.focus('#page-input');
    const clip = await alpha.evaluate(() => navigator.clipboard.readText());
    expect(clip === `${origin}/alpha`, `clipboard was "${clip}"`);
  });

  await step('the close-tab chord closes the highlighted tab and keeps the bar open', async () => {
    const victim = await browser.newPage();
    await victim.goto(`${origin}/bookmarked-target`);
    frame = await openBar(alpha);
    await type(frame, 'bookmarked target');
    const top = (await rows(frame))[0];
    expect(top.type === 'tab', `top row: ${JSON.stringify(top)}`);
    const before = (await allTabs()).length;
    await key(frame, 'Backspace', { altKey: true });
    await waitFor(async () => (await allTabs()).length === before - 1, 'the tab to close');
    expect(await overlayPresent(alpha), 'the bar closed');
    await key(frame, 'Escape');
    await waitFor(async () => !(await overlayPresent(alpha)), 'the overlay to be removed');
  });

  await step('page titles are shown as text, never parsed as HTML', async () => {
    const xss = await browser.newPage();
    await xss.goto(`${origin}/xss`);
    frame = await openBar(alpha);
    await type(frame, 'onerror');
    const info = await frame.evaluate(() => ({
      title: document.querySelector('#results .row .title')?.textContent,
      injected: document.querySelectorAll('#results .title img, #results .title b').length,
      pwned: window.__pwned === 1,
    }));
    expect(info.title?.includes('<img src=x') && info.injected === 0 && !info.pwned, JSON.stringify(info));
    await key(frame, 'Escape');
    await xss.close();
  });

  await step('a page that embeds the bar without a token gets an empty frame', async () => {
    const embedder = await browser.newPage();
    await embedder.goto(`${origin}/embedder`);
    await embedder.evaluate((src) => {
      const f = document.createElement('iframe');
      f.id = 'sneaky';
      f.src = src;
      document.body.appendChild(f);
    }, `chrome-extension://${extensionId}/src/bar.html?mode=overlay#00000000-0000-0000-0000-000000000000`);
    const sneaky = await waitFor(() => barFrame(embedder), 'the embedded frame');
    await sleep(600);
    const children = await sneaky.evaluate(() => document.body.childElementCount);
    expect(children === 0, `the frame rendered ${children} elements`);
    await embedder.close();
  });

  await step('a token cannot be reused after the bar has consumed it', async () => {
    frame = await openBar(alpha);
    const src = frame.url();
    await key(frame, 'Escape');
    await waitFor(async () => !(await overlayPresent(alpha)), 'the overlay to be removed');
    await alpha.evaluate((src) => {
      const f = document.createElement('iframe');
      f.id = 'replay';
      f.src = src;
      document.body.appendChild(f);
    }, src);
    const replay = await waitFor(() => barFrame(alpha), 'the replayed frame');
    await sleep(600);
    expect((await replay.evaluate(() => document.body.childElementCount)) === 0, 'a replayed token rendered the bar');
    await alpha.evaluate(() => document.getElementById('replay').remove());
  });

  await step('stays transparent over a dark page', async () => {
    const dark = await browser.newPage();
    await dark.goto(`${origin}/dark`);
    frame = await openBar(dark);
    await sleep(300);
    screenShot('04-overlay-dark-page.png');
    const png = await dark.screenshot({ clip: { x: 5, y: 500, width: 4, height: 4 }, encoding: 'base64' });
    const pixel = JSON.parse(
      execFileSync('python3', ['-c', 'import sys,base64,io,json\nfrom PIL import Image\nim=Image.open(io.BytesIO(base64.b64decode(sys.stdin.read()))).convert("RGB")\nprint(json.dumps(im.getpixel((1,1))))'], { input: png }).toString(),
    );
    expect(pixel.every((c) => c < 60), `corner pixel is ${pixel}; the frame is painting an opaque background`);
    await key(frame, 'Escape');
    await dark.close();
  });

  await step('page CSS cannot hide or shrink the bar', async () => {
    const hostile = await browser.newPage();
    await hostile.goto(`${origin}/hostile-css`);
    frame = await openBar(hostile);
    const rect = await hostile.evaluate(() => {
      const el = document.getElementById('chrome-command-bar-overlay');
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: r.width, h: r.height, display: cs.display, position: cs.position, opacity: cs.opacity, vw: innerWidth };
    });
    expect(rect.display === 'block' && rect.position === 'fixed' && rect.opacity === '1' && rect.w >= rect.vw - 20, JSON.stringify(rect));
    await key(frame, 'Escape');
    await hostile.close();
  });

  await step('on a page extensions cannot touch, the shortcut opens the popup instead', async () => {
    const internal = await browser.newPage();
    await internal.goto('chrome://version');
    await internal.bringToFront();
    await sleep(200);
    pressGlobal(TOGGLE);
    const target = await browser.waitForTarget((t) => /\/src\/bar\.html\?mode=(popup|window)/.test(t.url()), { timeout: 5000 });
    await sleep(600);
    screenShot('05-fallback-on-internal-page.png');
    console.log(`     fallback surface: ${new URL(target.url()).searchParams.get('mode')}`);
    const popupPage = await target.asPage().catch(() => null);
    if (popupPage) {
      await popupPage.waitForSelector('#results .row', { timeout: 5000 });
      const focus = await popupPage.evaluate(() => document.activeElement?.id);
      expect(focus === 'query', `popup focus was ${focus}`);
      await popupPage.close().catch(() => {});
    }
    await internal.close();
  });

  await step('a real Ctrl+T lands on the bar with the cursor in its input', async () => {
    await alpha.bringToFront();
    await sleep(200);
    const before = (await allTabs()).length;
    pressGlobal('ctrl+t');
    await waitFor(async () => (await allTabs()).length === before + 1, 'the new tab');
    await sleep(1200);
    const tab = await activeTab();
    const pages = await browser.pages();
    let page = null;
    for (const candidate of pages) {
      const mode = await candidate.evaluate(() => document.documentElement.dataset.mode).catch(() => null);
      if (mode === 'newtab') page = candidate;
    }
    expect(page, `no page in newtab mode among: ${pages.map((p) => p.url()).join(', ')}`);
    const info = await page.evaluate(() => ({ focused: document.activeElement?.id, hasFocus: document.hasFocus(), href: location.href }));
    console.log(`     tab.url=${tab.url} page=${info.href} activeElement=${info.focused} documentHasFocus=${info.hasFocus}`);
    xkeys('key', 'a', '--no-focus');
    xkeys('key', 'l', '--no-focus');
    await sleep(400);
    const typed = await page.evaluate(() => document.getElementById('query').value);
    screenShot('07-real-ctrl-t.png');
    await page.close();
    expect(typed === 'al', `typing after Ctrl+T went elsewhere; the bar input holds "${typed}"`);
  });

  await step('the new tab page is the bar, and lists the open tabs', async () => {
    const newtab = await browser.newPage();
    await newtab.goto('chrome://newtab');
    await newtab.waitForSelector('#results .row', { timeout: 5000 });
    const info = await newtab.evaluate(() => ({
      mode: document.documentElement.dataset.mode,
      titles: [...document.querySelectorAll('#results .row .title')].map((e) => e.textContent),
      focused: document.activeElement?.id,
      hasFocus: document.hasFocus(),
    }));
    expect(info.mode === 'newtab', `mode was ${info.mode}`);
    expect(info.titles.includes('Alpha ホーム') && !info.titles.includes('新しいタブ'), `titles: ${info.titles}`);
    console.log(`     new tab focus: activeElement=${info.focused} documentHasFocus=${info.hasFocus}`);
    screenShot('06-newtab.png');
    await newtab.close();
  });
} finally {
  await browser.close().catch(() => {});
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
