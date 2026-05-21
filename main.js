const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const iconv = require('iconv-lite');
const nextengineApi = require('./nextengine-api');
const inquiryLinking = require('./inquiry-linking');

// Windows コンソールのUTF-8対応
if (process.platform === 'win32') {
  const { execSync } = require('child_process');
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch (e) {
    // ignore
  }
}

// データフォルダのパスを取得
function getDataDir() {
  if (app.isPackaged) {
    // ポータブルビルド: 元のexeと同じフォルダのdata/
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
      return path.join(portableDir, 'data');
    }
    // フォールバック: AppData（PORTABLE_EXECUTABLE_DIRが取れない場合）
    return path.join(app.getPath('userData'), 'data');
  } else {
    // 開発時: プロジェクトフォルダのdata/
    return path.join(__dirname, 'data');
  }
}

// データフォルダを作成（存在しない場合）
function ensureDataDir() {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// データファイルのパス
function getDataFilePath() {
  return path.join(ensureDataDir(), 'master-data.json');
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
ipcMain.handle('master:update', (event, oldCode, newCode, name) => {
  const data = loadMasterData();
  const index = data.masters.findIndex(m => m.code === oldCode);
  if (index === -1) {
    return { success: false, error: 'マスタが見つかりません' };
  }
  // コードが変わる場合は重複チェック
  if (newCode !== oldCode && data.masters.some(m => m.code === newCode)) {
    return { success: false, error: '同じ商品コードが既に存在します' };
  }
  data.masters[index] = { code: newCode, name };
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

// IPC ハンドラー: 注文データを読み込む
ipcMain.handle('data:loadOrders', () => {
  const filePath = path.join(ensureDataDir(), 'demo-data.json');
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('注文データ読み込みエラー:', error);
  }
  return { orders: [] };
});

// ========================================
// 認証関連 IPC ハンドラー
// ========================================

// IPC ハンドラー: 認証情報を読み込む
ipcMain.handle('auth:load', () => {
  return nextengineApi.loadAuthData();
});

// IPC ハンドラー: 認証情報を保存
ipcMain.handle('auth:save', (event, authData) => {
  const success = nextengineApi.saveAuthData(authData);
  return { success };
});

// IPC ハンドラー: 認証状態を取得
ipcMain.handle('auth:status', () => {
  return nextengineApi.getAuthStatus();
});

// リダイレクトURI（認証コールバック用）
const REDIRECT_URI = 'https://localhost/callback';

// IPC ハンドラー: OAuth認証を開始
ipcMain.handle('auth:startOAuth', async (event, clientId, clientSecret) => {
  return new Promise((resolve, reject) => {
    // 認証用ウィンドウを作成
    const authWindow = new BrowserWindow({
      width: 800,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // リダイレクトをインターセプトするフィルタを設定
    const filter = { urls: [`${REDIRECT_URI}*`] };

    session.defaultSession.webRequest.onBeforeRequest(filter, async (details, callback) => {
      try {
        const url = new URL(details.url);
        const uid = url.searchParams.get('uid');
        const state = url.searchParams.get('state');

        if (uid && state) {
          // 認証完了フラグを立てる
          authCompleted = true;

          // リダイレクトをキャンセル
          callback({ cancel: true });

          // 認証ウィンドウを閉じる
          authWindow.close();

          // フィルタを解除
          session.defaultSession.webRequest.onBeforeRequest(filter, null);

          // トークンを取得
          try {
            const tokens = await nextengineApi.fetchAccessToken(uid, state, clientId, clientSecret);
            resolve({ success: true, tokens });
          } catch (error) {
            resolve({ success: false, error: error.message });
          }
        } else {
          callback({ cancel: false });
        }
      } catch (error) {
        callback({ cancel: false });
        resolve({ success: false, error: error.message });
      }
    });

    // 認証完了フラグ
    let authCompleted = false;

    // ウィンドウが閉じられた場合
    authWindow.on('closed', () => {
      // フィルタを解除
      session.defaultSession.webRequest.onBeforeRequest(filter, null);

      // 認証が完了していない場合はキャンセルとして処理
      if (!authCompleted) {
        resolve({ success: false, canceled: true, error: '認証がキャンセルされました' });
      }
    });

    // ログインURLを開く
    const loginUrl = nextengineApi.getLoginUrl(clientId, REDIRECT_URI);
    authWindow.loadURL(loginUrl);
  });
});

// IPC ハンドラー: ネクストエンジンAPIで注文検索
ipcMain.handle('ne:searchOrders', async (event, conditions) => {
  try {
    const orders = await nextengineApi.fetchOrdersWithDetails(conditions);
    return { success: true, orders };
  } catch (error) {
    console.error('注文検索エラー:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// ログ関連 IPC ハンドラー
// ========================================

// IPC ハンドラー: ログを取得
ipcMain.handle('log:get', () => {
  return nextengineApi.getLogs();
});

// IPC ハンドラー: ログをクリア
ipcMain.handle('log:clear', () => {
  nextengineApi.clearLogs();
  return { success: true };
});

// ========================================
// クリックポスト自動決済関連 IPC ハンドラー
// ========================================

let clickpostAutomation = null;
let mainWindowForProgress = null;

// RFC 4180準拠のCSV行パーサー（クォート内カンマ・改行対応）
function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // "" はエスケープされたクォート
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// IPC ハンドラー: クリックポスト用CSVを読み込む
ipcMain.handle('clickpost:loadCsv', async (event) => {
  try {
    // ファイル選択ダイアログを表示
    const result = await dialog.showOpenDialog({
      title: 'クリックポスト用CSVファイルを選択',
      filters: [
        { name: 'CSVファイル', extensions: ['csv'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];

    // ファイルを読み込む（Shift-JIS対応）
    let content;
    try {
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'Shift_JIS');
    } catch (error) {
      // Shift-JISで読めない場合はUTF-8で試す
      content = fs.readFileSync(filePath, 'utf-8');
    }

    // CSVをパース
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      return { success: false, error: 'CSVデータが空です' };
    }

    // ヘッダー行を解析
    const headers = parseCSVRow(lines[0]);

    // データ行をパース
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVRow(lines[i]);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }

    return { success: true, data, fileName: path.basename(filePath), rowCount: data.length };
  } catch (error) {
    console.error('CSV読み込みエラー:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: クリックポスト自動決済を開始
ipcMain.handle('clickpost:startAutomation', async (event, csvData) => {
  try {
    // メインウィンドウへの参照を保存
    mainWindowForProgress = BrowserWindow.fromWebContents(event.sender);

    // 自動化モジュールを読み込む（初回のみ）
    if (!clickpostAutomation) {
      const ClickPostAutomation = require('./clickpost-automation');
      clickpostAutomation = new ClickPostAutomation();
    }

    // 進行状況コールバックを設定
    clickpostAutomation.onProgress((progress) => {
      if (mainWindowForProgress && !mainWindowForProgress.isDestroyed()) {
        mainWindowForProgress.webContents.send('clickpost:progress', progress);
      }
    });

    // 自動決済を実行
    const { successCount, errorCount } = await clickpostAutomation.start(csvData);

    return { success: true, successCount, errorCount };
  } catch (error) {
    console.error('クリックポスト自動決済エラー:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: クリックポスト設定を読み込む
ipcMain.handle('clickpost:loadConfig', () => {
  const filePath = path.join(ensureDataDir(), 'clickpost-config.json');
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('クリックポスト設定読み込みエラー:', error);
  }
  return { cardLast4: '', cvv: '' };
});

// IPC ハンドラー: クリックポスト設定を保存
ipcMain.handle('clickpost:saveConfig', (_event, config) => {
  const filePath = path.join(ensureDataDir(), 'clickpost-config.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('クリックポスト設定保存エラー:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: クリックポスト自動決済を停止
ipcMain.handle('clickpost:stopAutomation', async () => {
  try {
    if (clickpostAutomation) {
      await clickpostAutomation.stop();
    }
    return { success: true };
  } catch (error) {
    console.error('クリックポスト停止エラー:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: 確認ダイアログ（Windows フォーカス問題回避）
ipcMain.handle('dialog:confirm', async (event, message) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['キャンセル', 'OK'],
    defaultId: 1,
    cancelId: 0,
    message: message
  });
  return response === 1;
});

// IPC ハンドラー: アラートダイアログ（Windows フォーカス問題回避）
ipcMain.handle('dialog:alert', async (event, message) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['OK'],
    message: message
  });
});

// Electronの初期化が完了したらウィンドウを作成
app.whenReady().then(() => {
  // NextEngine APIを初期化
  nextengineApi.init(ensureDataDir);

  createWindow();

  // macOS: ドックアイコンクリック時にウィンドウがなければ作成
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// IPC ハンドラー: CSVを保存
ipcMain.handle('csv:save', async (event, csvContent) => {
  try {
    // ファイル保存ダイアログを表示
    const result = await dialog.showSaveDialog({
      title: 'CSVファイルを保存',
      defaultPath: 'clickpost.csv',
      filters: [
        { name: 'CSVファイル', extensions: ['csv'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    // Shift-JISに変換して保存
    const sjisBuffer = iconv.encode(csvContent, 'Shift_JIS');
    fs.writeFileSync(result.filePath, sjisBuffer);

    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('CSV保存エラー:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: 複数CSVを保存（分割出力用）
ipcMain.handle('csv:saveMultiple', async (event, csvContents) => {
  try {
    // ファイル保存ダイアログを表示（ベースファイル名を取得）
    const result = await dialog.showSaveDialog({
      title: 'CSVファイルを保存（分割出力）',
      defaultPath: 'clickpost.csv',
      filters: [
        { name: 'CSVファイル', extensions: ['csv'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    // ベースファイル名を取得（拡張子を除く）
    const basePath = result.filePath.replace(/\.csv$/i, '');
    const savedFiles = [];

    // 各CSVを保存
    for (let i = 0; i < csvContents.length; i++) {
      const filePath = `${basePath}_${i + 1}.csv`;
      const sjisBuffer = iconv.encode(csvContents[i], 'Shift_JIS');
      fs.writeFileSync(filePath, sjisBuffer);
      savedFiles.push(filePath);
    }

    return { success: true, filePaths: savedFiles, fileCount: savedFiles.length };
  } catch (error) {
    console.error('CSV複数保存エラー:', error);
    return { success: false, error: error.message };
  }
});

// ========================================
// 問い合わせ番号関連 IPC ハンドラー
// ========================================

let inquiryAutomation = null;
let mainWindowForInquiryProgress = null;
let mainWindowForInquiryLink = null;

// IPC ハンドラー: 問い合わせ番号CSVファイル作成（スクレイピング→CSV保存）
ipcMain.handle('inquiry:startCsvCreation', async (event, rowCount) => {
  try {
    mainWindowForInquiryProgress = BrowserWindow.fromWebContents(event.sender);

    if (!inquiryAutomation) {
      const InquiryAutomation = require('./inquiry-automation');
      inquiryAutomation = new InquiryAutomation();
    }

    inquiryAutomation.onProgress((progress) => {
      if (mainWindowForInquiryProgress && !mainWindowForInquiryProgress.isDestroyed()) {
        mainWindowForInquiryProgress.webContents.send('inquiry:progress', progress);
      }
    });

    const data = await inquiryAutomation.start(rowCount);

    if (data.length === 0) {
      return { success: false, error: '抽出できるデータがありませんでした' };
    }

    // CSVを生成
    const header = 'お届け先氏名,お問い合わせ番号';
    const rows = data.map(({ name, inquiryNumber }) =>
      `"${name.replace(/"/g, '""')}","${inquiryNumber.replace(/"/g, '""')}"`
    );
    const csvContent = [header, ...rows].join('\r\n');

    // 保存ダイアログ
    const result = await dialog.showSaveDialog({
      title: '問い合わせ番号CSVを保存',
      defaultPath: 'inquiry.csv',
      filters: [{ name: 'CSVファイル', extensions: ['csv'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const sjisBuffer = iconv.encode(csvContent, 'Shift_JIS');
    fs.writeFileSync(result.filePath, sjisBuffer);

    return { success: true, count: data.length };
  } catch (error) {
    console.error('問い合わせ番号CSV作成エラー:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: 問い合わせ番号連携用CSVを読み込む
ipcMain.handle('inquiry:loadLinkCsv', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '問い合わせ番号CSVファイルを選択',
      filters: [{ name: 'CSVファイル', extensions: ['csv'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    let content;
    try {
      const buffer = fs.readFileSync(filePath);
      content = iconv.decode(buffer, 'Shift_JIS');
    } catch {
      content = fs.readFileSync(filePath, 'utf-8');
    }

    const { data, rowCount } = inquiryLinking.parseLinkCsv(content);
    return { success: true, data, rowCount };
  } catch (error) {
    console.error('問い合わせ番号連携CSV読み込みエラー:', error);
    return { success: false, error: error.message };
  }
});

// IPC ハンドラー: 問い合わせ番号をネクストエンジンに連携
ipcMain.handle('inquiry:startLinking', async (event, csvData) => {
  mainWindowForInquiryLink = BrowserWindow.fromWebContents(event.sender);

  const sendProgress = (current, total, message, status = 'info') => {
    if (mainWindowForInquiryLink && !mainWindowForInquiryLink.isDestroyed()) {
      mainWindowForInquiryLink.webContents.send('inquiry:linkProgress', { current, total, message, status });
    }
  };

  try {
    const { successCount, errorCount, errorNames } = await inquiryLinking.runLinking(csvData, sendProgress);
    return { success: true, successCount, errorCount, errorNames };
  } catch (error) {
    console.error('問い合わせ番号連携エラー:', error);
    return { success: false, error: error.message };
  }
});

// 全ウィンドウが閉じられたらアプリを終了（macOS以外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
