'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { PROFILES, MODE_MAPS, suggestProfile } = require('./protocols');
const { discover, scanDroneWifi, connectDroneWifi, FlightLink } = require('./network');
const { MjpegBridge } = require('./video');

let window;
const video = new MjpegBridge();
const flight = new FlightLink((status) => send('flight:status', status));

function send(channel, payload) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const settingsKeys = new Set(['ssid', 'host', 'cameraUrl', 'cameraOrientation', 'cameraSource', 'profile', 'mode', 'response', 'protocolConfirmed']);
async function loadSettings() {
  try { return JSON.parse(await fs.readFile(settingsPath(), 'utf8')); } catch (_) { return {}; }
}
async function saveSettings(settings) {
  const safe = Object.fromEntries(Object.entries(settings || {}).filter(([key, value]) => settingsKeys.has(key) && ['string', 'boolean', 'number'].includes(typeof value)));
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(safe), 'utf8');
  return safe;
}

const updateMarkerPath = () => path.join(app.getPath('userData'), 'downloaded-update.json');
const updaterCachePath = () => path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'china-drone-deck-updater');
async function markDownloadedUpdate(version) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(updateMarkerPath(), JSON.stringify({ version }), 'utf8');
}
async function clearAppliedUpdateCache() {
  if (process.platform !== 'linux') return;
  try {
    const { version } = JSON.parse(await fs.readFile(updateMarkerPath(), 'utf8'));
    if (version !== app.getVersion()) return;
    await fs.rm(updaterCachePath(), { recursive: true, force: true });
    await fs.rm(updateMarkerPath(), { force: true });
  } catch (_) {}
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600, fullscreenable: true,
    backgroundColor: '#071015', title: 'China Drone Deck', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.CHINA_DRONE_DEVTOOLS === '1') window.webContents.openDevTools({ mode: 'detach' });
}

function configureUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'current' }));
  autoUpdater.on('update-available', (info) => send('update:status', { state: 'downloading', version: info.version }));
  autoUpdater.on('download-progress', (progress) => send('update:status', { state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', async (info) => {
    try { await markDownloadedUpdate(info.version); } catch (_) {}
    send('update:status', { state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (error) => send('update:status', { state: 'error', message: error.message }));
}

app.whenReady().then(async () => {
  await clearAppliedUpdateCache();
  createWindow();
  configureUpdater();
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { flight.stop(); video.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, profiles: PROFILES, modes: MODE_MAPS }));
ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_, settings) => saveSettings(settings));
ipcMain.handle('network:discover', () => discover());
ipcMain.handle('network:scan-wifi', () => scanDroneWifi());
ipcMain.handle('network:connect-wifi', (_, ssid) => connectDroneWifi(ssid));
ipcMain.handle('profile:suggest', (_, ssid) => suggestProfile(ssid));
ipcMain.handle('flight:connect', (_, options) => flight.connect(options.profileId, options.host));
ipcMain.handle('flight:update', (_, state) => flight.update(state));
ipcMain.handle('flight:command', (_, flags) => flight.command(flags));
ipcMain.handle('flight:disconnect', () => flight.stop());
ipcMain.handle('video:start', (_, url, cameraSource = 'main') => video.start(url, { socket: flight.getSocket(), cameraSource }));
ipcMain.handle('video:stop', () => video.stopFfmpeg());
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { state: 'development', message: 'Updates are checked by packaged AppImage builds.' };
  return autoUpdater.checkForUpdates();
});
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(false, true));
ipcMain.handle('update:import', async () => {
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'AppImage', extensions: ['AppImage'] }] });
  if (result.canceled) return null;
  shell.showItemInFolder(result.filePaths[0]);
  return { path: result.filePaths[0], message: 'Run the installer script with this AppImage, or replace the current AppImage while the app is closed.' };
});

video.on('frame', (frame) => {
  send('video:status', { running: true, frame: true });
  send('video:frame', frame.toString('base64'));
});
video.on('log', (message) => send('video:log', message));
video.on('error', (error) => send('video:status', { running: false, error: error.message }));
video.on('status', (status) => send('video:status', status));
