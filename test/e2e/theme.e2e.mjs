// The bar's colours and glass with the system in dark mode: the frame follows the
// system rather than the page, blurs the page behind it, and turns solid where
// nothing should show through.

import { barDriver } from './bar.mjs';
import { expect, finish, launch, pixelAt, screenshot, serve, sleep, step } from './harness.mjs';

const site = await serve({
  '/light': {
    title: 'Light page',
    head: '<meta name="color-scheme" content="light"><style>html{background:#ffffff}</style>',
    body: '<p>a page that only knows light</p>',
  },
});
const chrome = await launch({ args: ['--force-dark-mode'] });
const { browser, extensionId } = chrome;
const { openBar, key, waitClosed, overlayId } = barDriver(chrome);

const page = (await browser.pages())[0];
await page.goto(`${site.origin}/light`);

/** What the bar's own document decided about its colours. */
const palette = (frame) =>
  frame.evaluate(() => ({
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    panel: getComputedStyle(document.getElementById('panel')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }));
const frameBlur = () => page.evaluate((id) => getComputedStyle(document.getElementById(id)).backdropFilter, overlayId);

await step('over a light-only page the bar still follows the system into dark', async () => {
  const frame = await openBar(page);
  await sleep(300);
  screenshot('theme-dark-over-light-page');
  const colours = await palette(frame);
  expect(colours.dark && colours.panel === 'rgba(44, 36, 30, 0.68)', `bar colours: ${JSON.stringify(colours)}`);
});

await step('the page shows, blurred, around the panel instead of an opaque frame', async () => {
  const blur = await frameBlur();
  expect(blur.includes('blur'), `backdrop-filter on the frame: ${blur}`);
  // A frame whose scheme disagrees with its document paints itself black here.
  const pixel = await pixelAt(page, 5, 500);
  expect(pixel.every((c) => c > 120), `corner pixel is ${pixel}`);
});

await step('with reduced transparency asked for, the page is not blurred', async () => {
  const frame = await openBar(page);
  await key(frame, 'Escape');
  await waitClosed(page);
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  await openBar(page);
  const blur = await frameBlur();
  expect(blur === 'none', `backdrop-filter on the frame: ${blur}`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
});

await step('as a window of its own the bar is solid, in the dark colours', async () => {
  const own = await browser.newPage();
  await own.goto(`chrome-extension://${extensionId}/src/bar.html?mode=window`);
  await own.waitForSelector('#results .row');
  const colours = await palette(own.mainFrame());
  expect(colours.dark && colours.body === 'rgb(42, 35, 30)' && colours.panel === 'rgb(42, 35, 30)', `window colours: ${JSON.stringify(colours)}`);
  await own.close();
});

await finish(chrome, site);
