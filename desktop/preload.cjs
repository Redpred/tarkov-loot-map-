const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('tarkovDesktop', Object.freeze({
  action: name => ipcRenderer.invoke('desktop:action', name),
  screenshots: (action, id) => ipcRenderer.invoke('desktop:screenshots', action, id),
  updates: (action, value) => ipcRenderer.invoke('desktop:updates', action, value),
  onUpdateState: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('desktop:update-state', listener);
    return () => ipcRenderer.removeListener('desktop:update-state', listener);
  },
  onFullscreen: callback => { ipcRenderer.on('desktop:fullscreen', (_event, value) => callback(Boolean(value))); }
}));
