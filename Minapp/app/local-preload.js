const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localBridge', {
  stream: (id) => ipcRenderer.invoke('sc:stream', id),
  log: (m) => ipcRenderer.send('local:log', m),
  state: (s) => ipcRenderer.send('local:state', s),
  onCmd: (cb) => ipcRenderer.on('local:cmd', (_e, c, a) => cb(c, a)),
});
