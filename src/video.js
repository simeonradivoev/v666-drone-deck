'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

class MjpegBridge extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.ffmpeg = null;
    this.clients = new Set();
    this.buffer = Buffer.alloc(0);
    this.port = null;
  }

  async start(url) {
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

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 1)); return; }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) { if (start > 0) this.buffer = this.buffer.subarray(start); return; }
      const frame = this.buffer.subarray(start, end + 2);
      this.buffer = this.buffer.subarray(end + 2);
      const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      for (const client of this.clients) {
        try { client.write(header); client.write(frame); client.write('\r\n'); } catch (_) { this.clients.delete(client); }
      }
      this.emit('frame');
    }
  }

  stopFfmpeg() {
    if (this.ffmpeg) this.ffmpeg.kill();
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

module.exports = { MjpegBridge };
