'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDriftAssist } = require('../src/renderer/position-assist');

test('position assist is gated and bounded', () => {
  const flow = { dx: 40, dy: -30, confidence: .8, timestamp: 1000 };
  assert.equal(calculateDriftAssist({ enabled: true, calibrated: false, deadman: true, manualRoll: 0, manualPitch: 0, flow, now: 1100 }).active, false);
  const output = calculateDriftAssist({ enabled: true, calibrated: true, deadman: true, manualRoll: 0, manualPitch: 0, flow, now: 1100 });
  assert.deepEqual(output, { roll: -.1, pitch: .075, active: true, reason: 'Correcting visual drift' });
  assert.equal(calculateDriftAssist({ enabled: true, calibrated: true, deadman: true, manualRoll: .1, manualPitch: 0, flow, now: 1100 }).active, false);
  assert.equal(calculateDriftAssist({ enabled: true, calibrated: true, deadman: true, manualRoll: 0, manualPitch: 0, manualYaw: .1, flow, now: 1100 }).active, false);
});

test('position assist rejects stale or low confidence flow', () => {
  const base = { enabled: true, calibrated: true, deadman: true, manualRoll: 0, manualPitch: 0, now: 2000 };
  assert.equal(calculateDriftAssist({ ...base, flow: { dx: 1, dy: 1, confidence: .8, timestamp: 1000 } }).active, false);
  assert.equal(calculateDriftAssist({ ...base, flow: { dx: 1, dy: 1, confidence: .1, timestamp: 1900 } }).active, false);
});