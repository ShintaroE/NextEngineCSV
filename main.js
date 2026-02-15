const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// データファイルのパス
function getDataFilePath() {
  return path.join(app.getPath('userData'), 'master-data.json');
}

// マスタデータを読み込む
function loadMasterData() {
  const filePath = getDataFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('データ読み込みエラー:', error);
  }
  return { masters: [] };
}

// マスタデータを保存する
function saveMasterData(data) {
  const filePath = getDataFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('データ保存エラー:', error);
    return false;
  }
}

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

// IPC ハンドラー: マスタ一覧を取得
ipcMain.handle('master:load', () => {
  return loadMasterData();
});

// IPC ハンドラー: マスタを追加
ipcMain.handle('master:add', (event, code, name) => {
  const data = loadMasterData();
  // 重複チェック
  if (data.masters.some(m => m.code === code)) {
    return { success: false, error: '同じ商品コードが既に存在します' };
  }
  data.masters.push({ code, name });
  const success = saveMasterData(data);
  return { success, data: success ? data : null };
});

// IPC ハンドラー: マスタを更新
ipcMain.handle('master:update', (event, code, name) => {
  const data = loadMasterData();
  const index = data.masters.findIndex(m => m.code === code);
  if (index === -1) {
    return { success: false, error: 'マスタが見つかりません' };
  }
  data.masters[index].name = name;
  const success = saveMasterData(data);
  return { success, data: success ? data : null };
});

// IPC ハンドラー: マスタを削除
ipcMain.handle('master:delete', (event, code) => {
  const data = loadMasterData();
  data.masters = data.masters.filter(m => m.code !== code);
  const success = saveMasterData(data);
  return { success, data: success ? data : null };
});

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
