const { contextBridge, ipcRenderer } = require('electron');

// レンダラープロセスに安全にAPIを公開する
contextBridge.exposeInMainWorld('electronAPI', {
  // 例: メインプロセスにメッセージを送る
  // sendMessage: (channel, data) => ipcRenderer.send(channel, data),
  // 例: メインプロセスからの応答を受け取る
  // onMessage: (channel, callback) => ipcRenderer.on(channel, callback)
});

// Node.jsとElectronのバージョン情報を公開
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
});
