// The few things the app's own side offers the pages. Nothing else of the computer is reachable from them.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('antogoApp', {
  kind: 'mac',
  garminFetch: (url, init) => ipcRenderer.invoke('garmin:fetch', url, init),
  keyCan: () => ipcRenderer.invoke('key:can'),
  keyRead: () => ipcRenderer.invoke('key:read'),
  keyUnreadable: () => ipcRenderer.invoke('key:unreadable'),
  keySave: (key, expires) => ipcRenderer.invoke('key:save', key, expires),
  keyForget: () => ipcRenderer.invoke('key:forget'),
  onBluetooth: (fn) => { ipcRenderer.on('bt:devices', (_e, list) => fn(list)); },
  chooseBluetooth: (id) => ipcRenderer.invoke('bt:choose', id),
  openEngineNotices: () => ipcRenderer.invoke('notices:engine'),
});
