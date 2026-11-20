import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fallbackWindowBounds } from '../src/lib/window.js';

const SIZE = { width: 720, height: 480 };

test('the fallback window is centred over its parent, a quarter of the spare height down', () => {
  assert.deepEqual(fallbackWindowBounds({ left: 0, top: 0, width: 1280, height: 800 }, SIZE), { ...SIZE, left: 280, top: 80 });
});

test('a parent on another display keeps the window on that display', () => {
  assert.deepEqual(fallbackWindowBounds({ left: -1920, top: 100, width: 1920, height: 1080 }, SIZE), { ...SIZE, left: -1320, top: 250 });
});

test('a parent shorter than the window still gets the window below its top edge', () => {
  assert.equal(fallbackWindowBounds({ left: 0, top: 50, width: 800, height: 300 }, SIZE).top, 130);
});

test('without a usable parent the position is left to Chrome', () => {
  assert.deepEqual(fallbackWindowBounds(null, SIZE), SIZE);
  assert.deepEqual(fallbackWindowBounds({ width: 1280, height: 800 }, SIZE), SIZE);
});
