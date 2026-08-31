'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { PROFILES, MODE_MAPS, suggestProfile } = require('./protocols');
const { discover, FlightLink } = require('./network');
const { MjpegBridge } = require('./video');

let window;
const video = new MjpegBridge();
const flight = new FlightLink((status) => window?.webContents.send('flight:status', status));

function send(channel, payload) { window?.webContents.send(channel, payload); }

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
  autoUpdater.on('update-downloaded', (info) => send('update:status', { state: 'ready', version: info.version }));
  autoUpdater.on('error', (error) => send('update:status', { state: 'error', message: error.message }));
}

app.whenReady().then(() => {
  createWindow();
  configureUpdater();
  if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { flight.stop(); video.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, profiles: PROFILES, modes: MODE_MAPS }));
ipcMain.handle('network:discover', () => discover());
ipcMain.handle('profile:suggest', (_, ssid) => suggestProfile(ssid));
ipcMain.handle('flight:connect', (_, options) => flight.connect(options.profileId, options.host));
ipcMain.handle('flight:update', (_, state) => flight.update(state));
ipcMain.handle('flight:command', (_, flags) => flight.command(flags));
ipcMain.handle('flight:disconnect', () => flight.stop());
ipcMain.handle('video:start', (_, url) => video.start(url, { socket: flight.getSocket() }));
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

video.on('frame', () => send('video:status', { running: true, frame: true }));
video.on('log', (message) => send('video:log', message));
video.on('error', (error) => send('video:status', { running: false, error: error.message }));
video.on('status', (status) => send('video:status', status));
