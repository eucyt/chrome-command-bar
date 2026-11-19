// The bar against hostile or awkward pages: nothing leaks in, nothing renders
// for a page that embeds it, and page styles cannot break it.

import { execFileSync } from 'node:child_process';

import { PAGES, barDriver } from './bar.mjs';
import { expect, finish, launch, screenshot, serve, sleep, step, typeGlobal, waitFor } from './harness.mjs';

const site = await serve({
  ...PAGES,
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
});
const origin = site.origin;
const chrome = await launch();
const { browser, extensionId } = chrome;
const { barFrame, waitClosed, openBar, type, key, overlayId } = barDriver(chrome);

const alpha = (await browser.pages())[0];
await alpha.goto(`${origin}/alpha`);

/** RGB of one pixel of the page as rendered, frames included. */
async function pixelAt(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 4, height: 4 }, encoding: 'base64' });
  const script = 'import sys,base64,io,json\nfrom PIL import Image\nim=Image.open(io.BytesIO(base64.b64decode(sys.stdin.read()))).convert("RGB")\nprint(json.dumps(im.getpixel((1,1))))';
  return JSON.parse(execFileSync('python3', ['-c', script], { input: png }).toString());
}

await step('page titles are shown as text, never parsed as HTML', async () => {
  const xss = await browser.newPage();
  await xss.goto(`${origin}/xss`);
  const frame = await openBar(alpha);
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
  const frame = await openBar(alpha);
  const src = frame.url();
  await key(frame, 'Escape');
  await waitClosed(alpha);
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

await step('a page that grabs focus while the bar is open does not get the keystrokes', async () => {
  const frame = await openBar(alpha);
  await alpha.evaluate(() => document.getElementById('page-input').focus());
  await waitFor(() => frame.evaluate(() => document.hasFocus()), 'the bar to take focus back');
  typeGlobal('be');
  await sleep(300);
  const typed = { bar: await frame.$eval('#query', (el) => el.value), page: await alpha.$eval('#page-input', (el) => el.value) };
  expect(typed.bar === 'be' && typed.page === '', `typed text went to ${JSON.stringify(typed)}`);
  await key(frame, 'Escape');
  await waitClosed(alpha);
});

await step('stays transparent over a dark page', async () => {
  const dark = await browser.newPage();
  await dark.goto(`${origin}/dark`);
  const frame = await openBar(dark);
  await sleep(300);
  screenshot('bar-over-dark-page');
  const pixel = await pixelAt(dark, 5, 500);
  expect(pixel.every((c) => c < 60), `corner pixel is ${pixel}; the frame is painting an opaque background`);
  await key(frame, 'Escape');
  await dark.close();
});

await step('page CSS cannot hide or shrink the bar', async () => {
  const hostile = await browser.newPage();
  await hostile.goto(`${origin}/hostile-css`);
  const frame = await openBar(hostile);
  const rect = await hostile.evaluate((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: r.width, h: r.height, display: cs.display, position: cs.position, opacity: cs.opacity, vw: innerWidth };
  }, overlayId);
  expect(rect.display === 'block' && rect.position === 'fixed' && rect.opacity === '1' && rect.w >= rect.vw - 20, JSON.stringify(rect));
  await key(frame, 'Escape');
  await hostile.close();
});

await finish(chrome, site);
