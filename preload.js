const { contextBridge, ipcRenderer } = require('electron');

// レンダラープロセスに安全にAPIを公開する
contextBridge.exposeInMainWorld('electronAPI', {
  // マスタ操作API
  loadMasters: () => ipcRenderer.invoke('master:load'),
  addMaster: (code, name) => ipcRenderer.invoke('master:add', code, name),
  updateMaster: (code, name) => ipcRenderer.invoke('master:update', code, name),
  deleteMaster: (code) => ipcRenderer.invoke('master:delete', code),
  // CSV操作API
  saveCsv: (csvContent) => ipcRenderer.invoke('csv:save', csvContent)
});

// Node.jsとElectronのバージョン情報を公開
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
});
