'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapSticks, wifi8kPacket, flowUfoPacket, wifiUavFldPacket, buildPacket, suggestProfile } = require('../src/protocols');
const { wifiUavRequest, wifiUavJpegHeader, wifiUavPorts } = require('../src/video');

test('Mode 2 maps throttle/yaw left and pitch/roll right', () => {
  assert.deepEqual(mapSticks(2, { leftX: .5, leftY: -.5, rightX: -.25, rightY: .25 }, 0), {
    roll: -.25, pitch: -.25, throttle: .5, yaw: .5
  });
});

test('all four modes assign every channel once', () => {
  for (const mode of [1, 2, 3, 4]) {
    const mapped = mapSticks(mode, { leftX: .1, leftY: .2, rightX: .3, rightY: .4 }, 0);
    assert.deepEqual(Object.keys(mapped).sort(), ['pitch', 'roll', 'throttle', 'yaw']);
    assert.equal(new Set(Object.values(mapped)).size, 4);
  }
});

test('WIFI_8K packet has framing and XOR checksum', () => {
  const packet = wifi8kPacket({ roll:0, pitch:0, throttle:0, yaw:0 }, 0x40);
  assert.equal(packet.length, 9);
  assert.deepEqual([...packet.subarray(0, 2)], [0x03, 0x66]);
  assert.equal(packet[8], 0x99);
  assert.equal(packet[7], packet.subarray(2, 7).reduce((a, b) => a ^ b, 0));
});

test('FLOW-UFO packet is 21 bytes and semantic commands are translated', () => {
  const packet = buildPacket('flowUfo', { roll:0, pitch:0, throttle:0, yaw:0 }, 0x80);
  assert.equal(packet.length, 21);
  assert.deepEqual([...packet.subarray(0, 3)], [0x03, 0x66, 0x14]);
  assert.equal(packet[7], 0x03);
  assert.equal(packet[20], 0x99);
  assert.equal(flowUfoPacket({ roll:0, pitch:0, throttle:0, yaw:0 }).length, 21);
});

test('FLOW_09B183 WiFi-UAV/FLD packet matches the extended UDP layout', () => {
  const packet = wifiUavFldPacket({ roll: 0, pitch: 0, throttle: 0, yaw: 0 }, 0, { first: 0, second: 1, third: 2 });
  assert.equal(packet.length, 124);
  assert.deepEqual([...packet.subarray(0, 12)], [0xef, 0x02, 0x7c, 0x00, 0x02, 0x02, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00]);
  assert.deepEqual([...packet.subarray(18, 26)], [0x66, 0x14, 0x80, 0x80, 0x80, 0x80, 0x00, 0x02]);
  assert.equal(packet[36], 0x02);
  assert.equal(packet[37], 0x99);
  assert.equal(packet.readUInt16LE(88), 1);
  assert.equal(packet.readUInt16LE(108), 2);
  const takeoff = buildPacket('wifiUavFld', { roll: 0, pitch: 0, throttle: 0, yaw: 0 }, 0x01, { first: 3, second: 4, third: 5 });
  assert.deepEqual([...takeoff.subarray(18, 26)], [0x66, 0x14, 0x80, 0x80, 0x80, 0x80, 0x01, 0x02]);
});

test('profile suggestion is conservative', () => {
  assert.equal(suggestProfile('WIFI_8K_ABC'), 'wifi8k');
  assert.equal(suggestProfile('FLOW-UFO-1234'), 'flowUfo');
  assert.equal(suggestProfile('FLOW_09B183'), 'wifiUavFld');
  assert.equal(suggestProfile('mystery-camera'), 'diagnostic');
});

test('WiFi-UAV camera requests match the native UDP envelope', () => {
  const start = wifiUavRequest(7, false);
  const ack = wifiUavRequest(7, true);
  assert.equal(start.length, 88);
  assert.equal(ack.length, 124);
  assert.deepEqual([...ack.subarray(0, 9)], [0xef, 0x02, 0x7c, 0x00, 0x02, 0x02, 0x00, 0x01, 0x02]);
  assert.equal(ack.readUInt32LE(12), 7);
  assert.deepEqual([...wifiUavJpegHeader().subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual(wifiUavPorts('192.168.169.1'), [8800, 8801]);
  assert.deepEqual(wifiUavPorts('192.168.4.153'), [8800]);
});
