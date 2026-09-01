'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateTranslation } = require('../src/renderer/optical-flow');

test('optical flow finds a textured translation', () => {
  const width = 48; const height = 36; const previous = new Uint8Array(width * height); const current = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) previous[y * width + x] = (x * 37 + y * 19 + (x * y) % 61) & 0xff;
  for (let y = 1; y < height; y += 1) for (let x = 0; x < width - 2; x += 1) current[(y - 1) * width + x + 2] = previous[y * width + x];
  const flow = estimateTranslation(previous, current, width, height);
  assert.equal(flow.dx, 2); assert.equal(flow.dy, -1); assert.ok(flow.confidence > .5);
});

test('optical flow reports no confidence for a flat image', () => {
  const pixels = new Uint8Array(48 * 36);
  assert.equal(estimateTranslation(pixels, pixels, 48, 36).confidence, 0);
});