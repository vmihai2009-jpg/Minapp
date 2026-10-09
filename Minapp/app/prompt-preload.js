const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('promptBridge', {
  submit: (t) => ipcRenderer.send('prompt:submit', t),
  cancel: () => ipcRenderer.send('prompt:cancel'),
});
