'use strict';

const dgram = require('node:dgram');
const net = require('node:net');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { PROFILES, buildPacket } = require('./protocols');

const execFileAsync = promisify(execFile);
const COMMON_DRONE_IPS = ['192.168.4.153', '192.168.100.1', '192.168.169.1', '192.168.0.1', '172.16.10.1'];
const CAMERA_URLS = (host) => [
  `rtsp://${host}:7070/H264VideoSMS`,
  `rtsp://${host}:7070/webcam`,
  `rtsp://${host}:554/11`,
  ...(host === '192.168.169.1' ? [`wifi-uav://${host}`] : []),
  `rtsp://${host}:554/live/ch00_0`
];

function localIPv4() {
  return Object.values(os.networkInterfaces()).flat().filter((item) => item?.family === 'IPv4' && !item.internal);
}

async function defaultGateway() {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await execFileAsync('ip', ['route', 'show', 'default']);
      return stdout.match(/default via ([0-9.]+)/)?.[1] || null;
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).NextHop"]);
      return stdout.trim() || null;
    }
  } catch (_) {}
  return null;
}

function probeTcp(host, port, timeout = 220) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function discover() {
  const gateway = await defaultGateway();
  const hosts = [...new Set([gateway, ...COMMON_DRONE_IPS].filter(Boolean))];
  const ports = [80, 554, 7070, 8888, 4646];
  const found = [];
  await Promise.all(hosts.flatMap((host) => ports.map(async (port) => {
    if (await probeTcp(host, port)) found.push({ host, port });
  })));
  const cameraPortPriority = [7070, 554, 8888, 4646, 80];
  found.sort((a, b) => cameraPortPriority.indexOf(a.port) - cameraPortPriority.indexOf(b.port));
  const host = found[0]?.host || gateway || null;
  return { gateway, interfaces: localIPv4(), openPorts: found, host, cameraCandidates: host ? CAMERA_URLS(host) : [] };
}

class FlightLink {
  constructor(onStatus = () => {}) {
    this.socket = null;
    this.timer = null;
    this.target = null;
    this.packetCounters = null;
    this.state = { roll: 0, pitch: 0, throttle: 0, yaw: 0, flags: 0, speed: 0x20 };
    this.onStatus = onStatus;
  }

  async connect(profileId, host) {
    this.stop();
    const profile = PROFILES[profileId];
    if (!profile?.controlPort) throw new Error('Select a verified control profile first.');
    this.target = { profileId, host, port: profile.controlPort };
    this.socket = dgram.createSocket('udp4');
    this.packetCounters = { first: 0, second: 1, third: 2 };
    this.socket.on('error', (error) => this.onStatus({ connected: false, error: error.message }));
    await new Promise((resolve) => this.socket.bind(0, resolve));
    if (profile.activationPort) this.socket.send(Buffer.from([0x42, 0x76]), profile.activationPort, host);
    this.timer = setInterval(() => this.send(), 40);
    this.onStatus({ connected: true, profileId, host, port: profile.controlPort });
  }

  update(next) {
    this.state = { ...this.state, ...next };
  }

  getSocket() {
    return this.socket;
  }

  command(flags) {
    this.state.flags = flags;
    let count = 8;
    const burst = setInterval(() => {
      this.send();
      if (--count <= 0) { clearInterval(burst); this.state.flags = 0; }
    }, 40);
  }

  send() {
    if (!this.socket || !this.target) return;
    const packet = buildPacket(this.target.profileId, this.state, this.state.flags, this.target.profileId === 'wifiUavFld' ? this.packetCounters : this.state.speed);
    if (this.target.profileId === 'wifiUavFld') {
      this.packetCounters.first = (this.packetCounters.first + 1) & 0xffff;
      this.packetCounters.second = (this.packetCounters.second + 1) & 0xffff;
      this.packetCounters.third = (this.packetCounters.third + 1) & 0xffff;
    }
    this.socket.send(packet, this.target.port, this.target.host);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.socket) this.socket.close();
    this.socket = null;
    this.target = null;
    this.packetCounters = null;
    this.onStatus({ connected: false });
  }
}

module.exports = { COMMON_DRONE_IPS, CAMERA_URLS, defaultGateway, discover, FlightLink };
