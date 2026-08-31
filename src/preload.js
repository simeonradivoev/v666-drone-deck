'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (callback) => {
  const handler = (_, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('deckDrone', {
  info: invoke('app:info'), discover: invoke('network:discover'), suggestProfile: invoke('profile:suggest'),
  connect: invoke('flight:connect'), updateFlight: invoke('flight:update'), command: invoke('flight:command'), disconnect: invoke('flight:disconnect'),
  startVideo: invoke('video:start'), stopVideo: invoke('video:stop'),
  checkUpdate: invoke('update:check'), installUpdate: invoke('update:install'), importUpdate: invoke('update:import'),
  onFlightStatus: listen('flight:status'), onVideoStatus: listen('video:status'), onVideoLog: listen('video:log'), onUpdateStatus: listen('update:status')
});
