const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  // ブラウザウィンドウを作成
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // セキュリティのため有効化
      nodeIntegration: false   // セキュリティのため無効化
    }
  });

  // index.htmlを読み込む
  mainWindow.loadFile('index.html');

  // 開発者ツールを開く（開発中のみ）
  // mainWindow.webContents.openDevTools();
}

// Electronの初期化が完了したらウィンドウを作成
app.whenReady().then(() => {
  createWindow();

  // macOS: ドックアイコンクリック時にウィンドウがなければ作成
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 全ウィンドウが閉じられたらアプリを終了（macOS以外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
