'use strict';

const MODE_MAPS = Object.freeze({
  1: { leftX: 'yaw', leftY: 'pitch', rightX: 'roll', rightY: 'throttle' },
  2: { leftX: 'yaw', leftY: 'throttle', rightX: 'roll', rightY: 'pitch' },
  3: { leftX: 'roll', leftY: 'pitch', rightX: 'yaw', rightY: 'throttle' },
  4: { leftX: 'roll', leftY: 'throttle', rightX: 'yaw', rightY: 'pitch' }
});

const PROFILES = Object.freeze({
  diagnostic: {
    id: 'diagnostic', label: 'Camera only / diagnostic', controlPort: null,
    ssid: [], description: 'Never sends flight-control packets.'
  },
  wifi8k: {
    id: 'wifi8k', label: 'WIFI_8K / E88-E99 family', controlPort: 8090,
    activationPort: 8080, ssid: [/^WIFI_8K/i, /^WIFI-8K/i],
    description: '9-byte 0x03/0x66 protocol. Select only when the SSID or capture matches.'
  },
  flowUfo: {
    id: 'flowUfo', label: 'FLOW-UFO / KY family', controlPort: 7099,
    ssid: [/^FLOW[-_]?UFO/i, /^FLOW-/i, /^KY-/i],
    description: '21-byte KY UFO protocol. Select only when the SSID matches.'
  }
});

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function applyDeadzone(value, deadzone = 0.08) {
  const v = clamp(value);
  if (Math.abs(v) <= deadzone) return 0;
  return Math.sign(v) * ((Math.abs(v) - deadzone) / (1 - deadzone));
}

function mapSticks(mode, axes, deadzone = 0.08) {
  const map = MODE_MAPS[mode] || MODE_MAPS[2];
  const physical = {
    leftX: applyDeadzone(axes.leftX, deadzone),
    leftY: applyDeadzone(-axes.leftY, deadzone),
    rightX: applyDeadzone(axes.rightX, deadzone),
    rightY: applyDeadzone(-axes.rightY, deadzone)
  };
  const result = { roll: 0, pitch: 0, throttle: 0, yaw: 0 };
  for (const [stickAxis, channel] of Object.entries(map)) result[channel] = physical[stickAxis];
  return result;
}

function axisByte(value) {
  return Math.max(1, Math.min(255, Math.round(128 + clamp(value) * 127)));
}

function xor(values) {
  return values.reduce((sum, value) => sum ^ value, 0) & 0xff;
}

function wifi8kPacket(channels, flags = 0) {
  const body = [
    axisByte(channels.roll), axisByte(channels.pitch),
    axisByte(channels.throttle), axisByte(channels.yaw), flags & 0xff
  ];
  return Buffer.from([0x03, 0x66, ...body, xor(body), 0x99]);
}

function flowUfoPacket(channels, flags = 0, speed = 0x20) {
  const core = [
    axisByte(channels.roll), axisByte(channels.pitch),
    axisByte(channels.throttle), axisByte(channels.yaw), flags & 0xff,
    speed & 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ];
  return Buffer.from([0x03, 0x66, 0x14, ...core, xor(core), 0x99]);
}

function buildPacket(profileId, channels, flags = 0, speed = 0x20) {
  if (profileId === 'wifi8k') return wifi8kPacket(channels, flags);
  if (profileId === 'flowUfo') {
    // KY uses command numbers, while WIFI_8K uses bit flags. Translate the
    // semantic flags exposed by the UI before constructing the KY packet.
    let command = 0;
    if (flags & 0x03) command = 0x01; // takeoff/land is a toggle
    else if (flags & 0x04) command = 0x02;
    else if (flags & 0x80) command = 0x03;
    else if (flags & 0x10) command = 0x04;
    else if (flags & 0x08) command = 0x05;
    return flowUfoPacket(channels, command, speed);
  }
  throw new Error('Camera-only mode cannot produce control packets.');
}

function suggestProfile(ssid = '') {
  return Object.values(PROFILES).find((profile) => profile.ssid.some((pattern) => pattern.test(ssid)))?.id || 'diagnostic';
}

module.exports = { MODE_MAPS, PROFILES, applyDeadzone, mapSticks, buildPacket, suggestProfile, wifi8kPacket, flowUfoPacket };
