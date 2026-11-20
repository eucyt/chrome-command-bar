// Pages that use the browser's top layer: a fullscreen element and a modal dialog.

import { PAGES, barDriver } from './bar.mjs';
import { TOGGLE_SHORTCUT, expect, finish, launch, pixelAt, pressGlobal, screenshot, serve, sleep, step, typeGlobal, waitFor } from './harness.mjs';

const site = await serve({
  ...PAGES,
  '/fullscreen': {
    title: 'Fullscreen',
    body:
      '<div id="stage" style="background:#123;color:#fff"><button id="go">fullscreen</button><p>stage</p></div>' +
      '<script>document.getElementById("go").onclick = () => document.getElementById("stage").requestFullscreen()</script>',
  },
  '/video': {
    title: 'Video',
    body:
      '<button id="go">fullscreen</button><video id="film" style="background:#000"></video>' +
      '<script>document.getElementById("go").onclick = () => document.getElementById("film").requestFullscreen()</script>',
  },
  '/dialog': {
    title: 'Dialog',
    body:
      '<button id="go">open</button><dialog id="modal"><input id="in-dialog"><p>modal dialog</p></dialog>' +
      '<script>document.getElementById("go").onclick = () => document.getElementById("modal").showModal()</script>',
  },
});
const chrome = await launch();
const { browser } = chrome;
const { barFrame, overlayPresent, waitClosed, openBar, rows, key, overlayId } = barDriver(chrome);

const page = (await browser.pages())[0];

await step('the bar is drawn above a fullscreen element and takes keys and clicks', async () => {
  await page.goto(`${site.origin}/fullscreen`);
  await page.click('#go');
  await waitFor(() => page.evaluate(() => document.fullscreenElement?.id === 'stage'), 'the stage to go fullscreen');
  const frame = await openBar(page);
  const onTop = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.id);
  expect(onTop === overlayId, `the element on top is "${onTop}"`);
  typeGlobal('alp');
  await waitFor(() => frame.$eval('#query', (el) => el.value === 'alp'), 'the typed text to reach the bar');
  await sleep(200);
  screenshot('bar-over-fullscreen');
  await page.mouse.click(640, 700);
  await waitClosed(page);
  await page.evaluate(() => document.exitFullscreen());
});

await step('over a fullscreen video the bar is visible and takes keys', async () => {
  await page.goto(`${site.origin}/video`);
  await page.click('#go');
  await waitFor(() => page.evaluate(() => document.fullscreenElement?.id === 'film'), 'the video to go fullscreen');
  const frame = await openBar(page);
  typeGlobal('alp');
  await waitFor(() => frame.$eval('#query', (el) => el.value === 'alp'), 'the typed text to reach the bar');
  await sleep(200);
  screenshot('bar-over-fullscreen-video');
  const box = await frame.$eval('#query', (el) => el.getBoundingClientRect().toJSON());
  const pixel = await pixelAt(page, box.x + box.width - 10, box.y + box.height / 2);
  expect(pixel.every((c) => c > 200), `the pixel inside the input is ${pixel}; the video is covering the bar`);
  await key(frame, 'Escape');
  await waitClosed(page);
  await page.evaluate(() => document.exitFullscreen());
});

await step('with a modal dialog open, the shortcut opens the popup instead', async () => {
  await page.goto(`${site.origin}/dialog`);
  await page.click('#go');
  await page.bringToFront();
  await sleep(200);
  pressGlobal(TOGGLE_SHORTCUT);
  const target = await browser.waitForTarget((t) => /\/src\/bar\.html\?mode=(popup|window)/.test(t.url()), { timeout: 5000 });
  const popup = await target.asPage();
  await popup.waitForSelector('#results .row', { timeout: 5000 });
  await sleep(400);
  screenshot('popup-over-modal-dialog');
  expect(!(await overlayPresent(page)) && !barFrame(page), 'the bar was also inserted into the page');
  expect((await rows(popup)).some((r) => r.title === 'Dialog'), 'the popup does not list the open tab');
  await popup.close().catch(() => {});
});

await finish(chrome, site);
