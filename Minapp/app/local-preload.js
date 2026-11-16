const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localBridge', {
  stream: (id, fresh) => ipcRenderer.invoke('sc:stream', id, !!fresh),
  hls: (u) => ipcRenderer.invoke('sc:hls', u),
  seg: (u) => ipcRenderer.invoke('sc:seg', u),
  fail: (m) => ipcRenderer.send('sc:fail', m),
  log: (m) => ipcRenderer.send('local:log', m),
  state: (s) => ipcRenderer.send('local:state', s),
  onCmd: (cb) => ipcRenderer.on('local:cmd', (_e, c, a) => cb(c, a)),
});
