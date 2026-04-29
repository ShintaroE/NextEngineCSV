const { contextBridge, ipcRenderer } = require('electron');

// レンダラープロセスに安全にAPIを公開する
contextBridge.exposeInMainWorld('electronAPI', {
  // マスタ操作API
  loadMasters: () => ipcRenderer.invoke('master:load'),
  addMaster: (code, name) => ipcRenderer.invoke('master:add', code, name),
  updateMaster: (oldCode, newCode, name) => ipcRenderer.invoke('master:update', oldCode, newCode, name),
  deleteMaster: (code) => ipcRenderer.invoke('master:delete', code),
  // データ操作API
  loadOrders: () => ipcRenderer.invoke('data:loadOrders'),
  // CSV操作API
  saveCsv: (csvContent) => ipcRenderer.invoke('csv:save', csvContent),
  saveCsvMultiple: (csvContents) => ipcRenderer.invoke('csv:saveMultiple', csvContents),
  // 認証API
  loadAuth: () => ipcRenderer.invoke('auth:load'),
  saveAuth: (authData) => ipcRenderer.invoke('auth:save', authData),
  getAuthStatus: () => ipcRenderer.invoke('auth:status'),
  startOAuth: (clientId, clientSecret) => ipcRenderer.invoke('auth:startOAuth', clientId, clientSecret),
  // ネクストエンジンAPI
  neSearchOrders: (conditions) => ipcRenderer.invoke('ne:searchOrders', conditions),
  // ログAPI
  getLogs: () => ipcRenderer.invoke('log:get'),
  clearLogs: () => ipcRenderer.invoke('log:clear'),
  // ダイアログAPI（Windows フォーカス問題回避）
  showConfirm: (message) => ipcRenderer.invoke('dialog:confirm', message),
  showAlert: (message) => ipcRenderer.invoke('dialog:alert', message),
  // クリックポストAPI
  loadClickPostCsv: () => ipcRenderer.invoke('clickpost:loadCsv'),
  startClickPostAutomation: (csvData) => ipcRenderer.invoke('clickpost:startAutomation', csvData),
  stopClickPostAutomation: () => ipcRenderer.invoke('clickpost:stopAutomation'),
  onClickPostProgress: (callback) => ipcRenderer.on('clickpost:progress', callback),
  loadClickPostConfig: () => ipcRenderer.invoke('clickpost:loadConfig'),
  saveClickPostConfig: (config) => ipcRenderer.invoke('clickpost:saveConfig', config),
  // 問い合わせ番号API
  startInquiryCsvCreation: (page) => ipcRenderer.invoke('inquiry:startCsvCreation', page)
});

// Node.jsとElectronのバージョン情報を公開
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
});
