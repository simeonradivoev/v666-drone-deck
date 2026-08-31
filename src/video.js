'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const WIFI_UAV_START = Buffer.from([0xef, 0x00, 0x04, 0x00]);
const WIFI_UAV_COMMAND = Buffer.from([0x66, 0x14, 0x80, 0x80, 0x80, 0x80, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x99]);
const LUMA_QUANT = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const CHROMA_QUANT = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];
function wifiUavJpegHeader(width = 640, height = 360) {
  const dqt = (id, table) => Buffer.from([0xff, 0xdb, 0x00, 0x43, id, ...table]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), dqt(0, LUMA_QUANT), dqt(1, CHROMA_QUANT), sof, sos]);
}
function wifiUavRequest(frameId, includeAcks) {
  const packet = Buffer.alloc(includeAcks ? 124 : 88);
  packet.set([0xef, 0x02, 0x00, 0x00, 0x02, 0x02, 0x00, 0x01, includeAcks ? 2 : 0], 0);
  packet.writeUInt32LE(frameId >>> 0, 12); packet.writeUInt16LE(WIFI_UAV_COMMAND.length, 16); WIFI_UAV_COMMAND.copy(packet, 18);
  packet.set([0x32, 0x4b, 0x14, 0x2d, 0x00], 82);
  if (includeAcks) { packet.writeBigUInt64LE(BigInt(frameId), 88); packet.writeUInt32LE(1, 96); packet.writeUInt32LE(20, 100); packet.writeUInt32LE(0xffffffff, 104); packet.writeBigUInt64LE(BigInt(frameId), 108); packet.writeUInt32LE(3, 116); packet.writeUInt32LE(16, 120); }
  packet.writeUInt16LE(packet.length, 2);
  return packet;
}

function wifiUavPorts(host) {
  return host === '192.168.169.1' ? [8800, 8801] : [8800];
}

function parseWifiUavFragment(packet) {
  if (packet.length < 56 || packet[0] !== 0x93 || packet[1] !== 0x01) return null;
  if (packet.readUInt16LE(2) === packet.length) {
    const total = packet.readUInt32LE(36);
    const fragmentId = packet.readUInt32LE(32);
    if (total > 0 && fragmentId < total) return { frameId: packet.readBigUInt64LE(8).toString(), fragmentId, total, payload: packet.subarray(56) };
  }
  // Older FLD firmware reports 16-bit counters and only reveals the total on the tail packet.
  const fragmentId = packet.readUInt16LE(32);
  return { frameId: String(packet.readUInt16LE(16)), fragmentId, total: packet[2] === 0x38 ? 0 : fragmentId + 1, payload: packet.subarray(56) };
}

class MjpegBridge extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.ffmpeg = null;
    this.wifi = null;
    this.clients = new Set();
    this.buffer = Buffer.alloc(0);
    this.port = null;
  }

  async start(url, options = {}) {
    if (url.startsWith('wifi-uav://')) return this.startWifiUav(new URL(url).hostname, options.socket);
    this.stopFfmpeg();
    if (!this.server) await this.startServer();
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-rtsp_transport', 'udp',
      '-fflags', 'nobuffer', '-flags', 'low_delay', '-i', url,
      '-an', '-vf', 'scale=960:-2', '-r', '20', '-q:v', '5', '-f', 'mjpeg', 'pipe:1'
    ];
    this.ffmpeg = spawn(process.env.CHINA_DRONE_FFMPEG || 'ffmpeg', args, { windowsHide: true });
    this.ffmpeg.stdout.on('data', (chunk) => this.consume(chunk));
    this.ffmpeg.stderr.on('data', (chunk) => this.emit('log', chunk.toString().trim()));
    this.ffmpeg.once('error', (error) => this.emit('error', new Error(`ffmpeg could not start: ${error.message}`)));
    this.ffmpeg.once('exit', (code) => this.emit('status', { running: false, code }));
    this.emit('status', { running: true, url });
    return { feedUrl: `http://127.0.0.1:${this.port}/camera.mjpg` };
  }

  async startWifiUav(host, socket) {
    this.stopFfmpeg();
    this.stopWifiUav();
    if (!this.server) await this.startServer();
    const ownsSocket = !socket;
    const udp = socket || require('node:dgram').createSocket('udp4');
    if (ownsSocket) await new Promise((resolve) => udp.bind(0, resolve));
    const state = { host, udp, ownsSocket, frameId: 1, frames: new Map(), timer: null, timeout: null, received: false, onMessage: null };
    const request = (frameId, includeStart = false) => {
      for (const port of wifiUavPorts(host)) {
        if (includeStart) udp.send(WIFI_UAV_START, port, host);
        udp.send(wifiUavRequest(frameId, false), port, host);
        udp.send(wifiUavRequest(frameId, true), port, host);
      }
    };
    state.onMessage = (packet) => {
      const fragment = parseWifiUavFragment(packet);
      if (!fragment) return;
      state.received = true; clearTimeout(state.timeout);
      const frame = state.frames.get(fragment.frameId) || { total: fragment.total, fragments: new Map() };
      if (fragment.total) frame.total = fragment.total;
      frame.fragments.set(fragment.fragmentId, fragment.payload); state.frames.set(fragment.frameId, frame);
      if (!frame.total || frame.fragments.size !== frame.total) return;
      const parts = []; for (let index = 0; index < frame.total; index++) { const part = frame.fragments.get(index); if (!part) return; parts.push(part); }
      state.frames.clear(); state.frameId = Number(BigInt(fragment.frameId) + 1n);
      this.publishFrame(Buffer.concat([wifiUavJpegHeader(), ...parts, Buffer.from([0xff, 0xd9])]));
      request(state.frameId);
    };
    udp.on('message', state.onMessage);
    state.timer = setInterval(() => request(state.frameId, !state.received), 80);
    state.timeout = setTimeout(() => {
      if (!state.received) this.emit('error', new Error('WiFi-UAV camera received no video packets. Keep the flight link enabled, then retry.'));
    }, 5000);
    this.wifi = state;
    request(0, true);
    this.emit('status', { running: true, url: `wifi-uav://${host}` });
    return { feedUrl: `http://127.0.0.1:${this.port}/camera.mjpg` };
  }
  stopWifiUav() {
    if (!this.wifi) return;
    clearInterval(this.wifi.timer); clearTimeout(this.wifi.timeout); this.wifi.udp.off('message', this.wifi.onMessage);
    if (this.wifi.ownsSocket) this.wifi.udp.close();
    this.wifi = null;
  }

  startServer() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((request, response) => {
        if (request.url !== '/camera.mjpg') { response.writeHead(404).end(); return; }
        response.writeHead(200, {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Connection': 'close',
          'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
          'Access-Control-Allow-Origin': '*'
        });
        this.clients.add(response);
        request.on('close', () => this.clients.delete(response));
      });
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  publishFrame(frame) {
    const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    for (const client of this.clients) { try { client.write(header); client.write(frame); client.write('\r\n'); } catch (_) { this.clients.delete(client); } }
    this.emit('frame');
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 1)); return; }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) { if (start > 0) this.buffer = this.buffer.subarray(start); return; }
      const frame = this.buffer.subarray(start, end + 2);
      this.buffer = this.buffer.subarray(end + 2);
      this.publishFrame(frame);
    }
  }

  stopFfmpeg() {
    if (this.ffmpeg) this.ffmpeg.kill();
    this.stopWifiUav();
    this.ffmpeg = null;
    this.buffer = Buffer.alloc(0);
  }

  stop() {
    this.stopFfmpeg();
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (this.server) this.server.close();
    this.server = null;
  }
}

module.exports = { MjpegBridge, wifiUavRequest, wifiUavJpegHeader, wifiUavPorts, parseWifiUavFragment };
