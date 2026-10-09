const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ytBridge', {
  log: (m) => ipcRenderer.send('yt:log', m),
  state: (s) => ipcRenderer.send('yt:state', s),
  onCmd: (cb) => ipcRenderer.on('yt:cmd', (_e, c, a) => cb(c, a)),
});
