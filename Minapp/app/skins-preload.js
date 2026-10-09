const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('skinsBridge', {
  list: (q, offset) => ipcRenderer.invoke('skins:list', q, offset),
  apply: (item) => ipcRenderer.invoke('skins:apply', item),
  openWeb: () => ipcRenderer.send('skins:web'),
});
