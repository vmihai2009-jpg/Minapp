const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localBridge', {
  log: (m) => ipcRenderer.send('local:log', m),
  state: (s) => ipcRenderer.send('local:state', s),
  onCmd: (cb) => ipcRenderer.on('local:cmd', (_e, c, a) => cb(c, a)),
});
