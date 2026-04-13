const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const iconv = require('iconv-lite');

/**
 * クリックポスト自動決済クラス
 */
class ClickPostAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.progressCallback = null;
    this.isStopped = false;
    this.tempFilePath = null;

    // セレクター設定を読み込む（必須）
    const selectorsPath = ClickPostAutomation.getSelectorsPath();

    try {
      const selectorsJson = fs.readFileSync(selectorsPath, 'utf-8');
      this.selectors = JSON.parse(selectorsJson);
    } catch (error) {
      console.error(`clickpost-selectors.json が見つかりません: ${selectorsPath}`);
      throw new Error(`clickpost-selectors.json が見つかりません: ${selectorsPath}`);
    }

    // クリックポスト設定を読み込む（オプション）
    this.config = this.loadClickPostConfig();
  }

  /**
   * クリックポスト設定を読み込む
   */
  loadClickPostConfig() {
    const { app } = require('electron');
    let configPath;
    if (app.isPackaged) {
      const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
      configPath = portableDir
        ? path.join(portableDir, 'data', 'clickpost-config.json')
        : path.join(app.getPath('userData'), 'data', 'clickpost-config.json');
    } else {
      configPath = path.join(__dirname, 'data', 'clickpost-config.json');
    }
    try {
      const configJson = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configJson);
    } catch (error) {
      return { cardLast4: '', cvv: '' };
    }
  }

  /**
   * 進行状況コールバックを設定
   */
  onProgress(callback) {
    this.progressCallback = callback;
  }

  /**
   * ブラウザプロファイルのパスを取得
   * ポータブルビルド対応（main.jsのgetDataDir()と同様のロジック）
   */
  getBrowserProfilePath() {
    const { app } = require('electron');
    if (app.isPackaged) {
      const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
      if (portableDir) {
        return path.join(portableDir, 'browser-profile');
      }
      return path.join(app.getPath('userData'), 'browser-profile');
    }
    return path.join(__dirname, 'browser-profile');
  }

  /**
   * 進行状況を送信
   */
  sendProgress(current, total, message, status = 'info') {
    if (this.progressCallback) {
      this.progressCallback({
        current,
        total,
        message,
        status
      });
    }
  }

  /**
   * 自動決済を開始
   */
  async start(csvData) {
    try {
      this.isStopped = false;
      const total = csvData.length;

      // ========== Phase 1: 初期化 ==========
      this.sendProgress(0, total, 'ブラウザを起動しています...', 'info');

      // アプリ専用プロファイルを使用してブラウザを起動
      // 初回起動時はYahoo/Amazonへのログインが必要です
      const profilePath = this.getBrowserProfilePath();

      // プロファイルディレクトリを作成（存在しない場合）
      if (!fs.existsSync(profilePath)) {
        fs.mkdirSync(profilePath, { recursive: true });
      }

      // 自動化検知を回避するオプション
      const launchOptions = {
        headless: false,
        slowMo: 100,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-automation',
          '--no-first-run'
        ],
        ignoreDefaultArgs: ['--enable-automation']
      };

      try {
        // 1. 既存Chrome使用を試行
        this.browser = await chromium.launchPersistentContext(profilePath, {
          ...launchOptions,
          channel: 'chrome'
        });
      } catch (e1) {
        console.log('Chrome起動失敗、Edgeを試します:', e1.message);
        try {
          // 2. Edge使用を試行
          this.browser = await chromium.launchPersistentContext(profilePath, {
            ...launchOptions,
            channel: 'msedge'
          });
        } catch (e2) {
          console.log('Edge起動失敗、Playwright内蔵Chromiumを使用します:', e2.message);
          // 3. Playwright内蔵Chromiumを使用
          this.browser = await chromium.launchPersistentContext(profilePath, launchOptions);
        }
      }

      // 既存のページを使うか、新しいページを作成
      this.page = this.browser.pages()[0] || await this.browser.newPage();

      // クリックポストサイトにアクセス
      this.sendProgress(0, total, 'クリックポストサイトにアクセスしています...', 'info');
      await this.page.goto('https://clickpost.jp/');

      // ログイン待機（手動）
      this.sendProgress(0, total, 'ログインしてください（手動）', 'info');

      try {
        await Promise.race([
          this.page.waitForURL('**/mypage/**', { timeout: 300000 }),
          this.page.waitForSelector(this.selectors.navigation.myPageIndicator, { timeout: 300000 })
        ]);
      } catch (error) {
        throw new Error('ログインタイムアウト。5分以内にログインしてください。');
      }

      this.sendProgress(0, total, 'ログイン完了。CSVアップロードを開始します...', 'success');

      // ========== Phase 2: CSVアップロード ==========
      // 一時CSVファイルを作成
      this.sendProgress(0, total, 'CSVファイルを準備しています...', 'info');
      await this.createTempCsvFile(csvData);

      // まとめ申込ページに移動
      this.sendProgress(0, total, 'まとめ申込ページに移動しています...', 'info');
      await this.navigateToBulkUpload();

      // CSVをアップロード
      this.sendProgress(0, total, 'CSVファイルをアップロードしています...', 'info');
      await this.uploadCsvFile();

      // 取込を実行
      this.sendProgress(0, total, 'データを取り込んでいます...', 'info');
      await this.confirmUpload();

      this.sendProgress(0, total, 'CSV取込完了。決済処理を開始します...', 'success');

      // ========== Phase 3: 決済処理 ==========
      for (let i = 0; i < total; i++) {
        if (this.isStopped) {
          this.sendProgress(i, total, '処理が停止されました', 'error');
          break;
        }

        try {
          await this.processPayment(i + 1, total);
          const name = csvData[i]['お届け先氏名'] || csvData[i]['氏名'] || '';
          this.sendProgress(i + 1, total, `${i + 1}件目: ${name}の決済が完了しました`, 'success');
        } catch (error) {
          this.sendProgress(i + 1, total, `${i + 1}件目: エラー - ${error.message}`, 'error');
          // エラーが発生しても次の行に進む
        }

        // レート制限（1秒待機）
        await this.page.waitForTimeout(1000);
      }

      this.sendProgress(total, total, 'すべての処理が完了しました！', 'success');

    } catch (error) {
      this.sendProgress(0, csvData.length, `エラーが発生しました: ${error.message}`, 'error');
      throw error;
    } finally {
      // 一時ファイルを削除
      this.cleanupTempFile();

      // ブラウザを閉じる
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    }
  }

  /**
   * 一時CSVファイルを作成（クリックポスト形式、Shift-JIS）
   */
  async createTempCsvFile(csvData) {
    const tempDir = os.tmpdir();
    this.tempFilePath = path.join(tempDir, `clickpost_upload_${Date.now()}.csv`);

    // クリックポストCSVヘッダー
    const headers = [
      'お届け先郵便番号',
      'お届け先氏名',
      'お届け先敬称',
      'お届け先住所1行目',
      'お届け先住所2行目',
      'お届け先住所3行目',
      'お届け先住所4行目',
      '内容品'
    ];

    // データ行を生成
    const rows = csvData.map(row => {
      const fields = [
        (row['お届け先郵便番号'] || row['郵便番号'] || '').replace(/-/g, ''),
        row['お届け先氏名'] || row['氏名'] || '',
        row['お届け先敬称'] || '様',
        row['お届け先住所1行目'] || row['お届け先住所1'] || row['住所1'] || '',
        row['お届け先住所2行目'] || row['お届け先住所2'] || row['住所2'] || '',
        row['お届け先住所3行目'] || row['お届け先住所3'] || row['住所3'] || '',
        row['お届け先住所4行目'] || row['お届け先住所4'] || row['住所4'] || '',
        row['内容品'] || row['商品名'] || ''
      ];
      // CSVエスケープ（ダブルクォートで囲む）
      return fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(',');
    });

    // CSV文字列を作成
    const csvContent = [headers.join(','), ...rows].join('\r\n');

    // Shift-JISで保存
    const sjisBuffer = iconv.encode(csvContent, 'Shift_JIS');
    fs.writeFileSync(this.tempFilePath, sjisBuffer);

    return this.tempFilePath;
  }

  /**
   * まとめ申込ページに移動（「まとめ申込」ボタンをクリック）
   */
  async navigateToBulkUpload() {
    // 「まとめ申込」ボタンをクリック
    await this.clickMulti(this.selectors.navigation.bulkUploadButton);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * CSVファイルをアップロード
   */
  async uploadCsvFile() {
    if (!this.tempFilePath) {
      throw new Error('一時CSVファイルが作成されていません');
    }

    // ファイル入力要素を探してファイルを設定
    const fileInputSelector = this.selectors.bulkUpload.fileInput;
    const selectors = fileInputSelector.split(',').map(s => s.trim());

    let uploaded = false;
    for (const selector of selectors) {
      try {
        const fileInput = await this.page.$(selector);
        if (fileInput) {
          await fileInput.setInputFiles(this.tempFilePath);
          uploaded = true;
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!uploaded) {
      throw new Error('ファイル入力フィールドが見つかりません');
    }

    // 「次へ」ボタンをクリック
    await this.page.waitForTimeout(500);
    await this.clickMulti(this.selectors.bulkUpload.nextButton);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * 取込を実行（内容確認画面で「次へ」をクリック）
   */
  async confirmUpload() {
    // 「次へ」ボタンをクリック
    await this.clickMulti(this.selectors.bulkUpload.nextButton);
    await this.page.waitForLoadState('networkidle');

    // エラーチェック
    const hasError = await this.checkForErrors();
    if (hasError) {
      const errorText = await this.getErrorText();
      throw new Error(`CSV取込エラー: ${errorText}`);
    }

    await this.page.waitForTimeout(1000);
  }

  /**
   * 1件の決済を処理
   */
  async processPayment(currentIndex, total) {
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: Yahoo!ウォレット決済ボタンを探しています...`, 'info');

    // 「お支払い手続きへ」ボタンをクリック（Yahoo!ウォレット）
    await this.clickMulti(this.selectors.paymentList.yahooWalletButton);
    await this.page.waitForLoadState('networkidle');

    // 決済確認ページで規約同意と「次へ」をクリック
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 支払いを確定しています...`, 'info');

    try {
      // 「次へ」ボタンが見つかるまで待機（最大30秒）
      await this.waitForSelectorMulti(this.selectors.paymentList.nextButton, 30000);

      // カード下4桁を入力
      if (this.config.cardLast4 && this.selectors.paymentList.cardLast4Input) {
        await this.fillInputMulti(this.selectors.paymentList.cardLast4Input, this.config.cardLast4);
        await this.page.waitForTimeout(200);
      }

      // セキュリティコード（CVV）を入力
      if (this.config.cvv) {
        await this.fillInputMulti(this.selectors.paymentList.cvvInput, this.config.cvv);
        await this.page.waitForTimeout(200);
      }

      // 「上記規約情報に合意する」チェックボックスをクリック
      await this.clickMulti(this.selectors.paymentList.consentCheckbox);
      await this.page.waitForTimeout(300);

      // 「次へ」ボタンをクリック
      await this.clickMulti(this.selectors.paymentList.nextButton);
      await this.page.waitForLoadState('networkidle');

      // 「支払手続き確定」ボタンが見つかるまで待機
      await this.waitForSelectorMulti(this.selectors.paymentList.finalConfirmButton, 30000);

      // 「支払手続き確定」ボタンをクリック
      await this.clickMulti(this.selectors.paymentList.finalConfirmButton);
      await this.page.waitForLoadState('networkidle');
    } catch (error) {
      throw new Error(`決済確定エラー: ${error.message}`);
    }

    // エラーチェック
    const hasError = await this.checkForErrors();
    if (hasError) {
      const errorText = await this.getErrorText();
      throw new Error(`決済処理エラー: ${errorText}`);
    }

    await this.page.waitForTimeout(500);
  }

  /**
   * 一時ファイルを削除
   */
  cleanupTempFile() {
    if (this.tempFilePath && fs.existsSync(this.tempFilePath)) {
      try {
        fs.unlinkSync(this.tempFilePath);
      } catch (error) {
        console.warn('一時ファイル削除エラー:', error);
      }
      this.tempFilePath = null;
    }
  }

  /**
   * 入力フィールドに値を入力（単一セレクター）
   */
  async fillInput(selector, value) {
    try {
      await this.page.waitForSelector(selector, { timeout: 3000 });
      await this.page.fill(selector, value);
    } catch (error) {
      console.warn(`入力フィールド ${selector} が見つかりません: ${error.message}`);
    }
  }

  /**
   * 複数セレクターを試して入力（カンマ区切りのセレクター対応）
   */
  async fillInputMulti(selectorString, value) {
    const selectors = selectorString.split(',').map(s => s.trim());

    for (const selector of selectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          await element.fill(value);
          return true;
        }
      } catch (error) {
        // 次のセレクターを試す
        continue;
      }
    }

    console.warn(`入力フィールドが見つかりません: ${selectorString}`);
    return false;
  }

  /**
   * 複数セレクターを試してクリック（カンマ区切りのセレクター対応）
   */
  async clickMulti(selectorString) {
    const selectors = selectorString.split(',').map(s => s.trim());

    for (const selector of selectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          await element.click();
          return true;
        }
      } catch (error) {
        // 次のセレクターを試す
        continue;
      }
    }

    throw new Error(`クリック可能な要素が見つかりません: ${selectorString}`);
  }

  /**
   * 複数セレクターのいずれかが見つかるまで待機（カンマ区切りのセレクター対応）
   */
  async waitForSelectorMulti(selectorString, timeout = 30000) {
    const selectors = selectorString.split(',').map(s => s.trim());
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            return true;
          }
        } catch (error) {
          // 次のセレクターを試す
          continue;
        }
      }
      // 100ms待機して再試行
      await this.page.waitForTimeout(100);
    }

    throw new Error(`要素が見つかりません（タイムアウト）: ${selectorString}`);
  }

  /**
   * エラーチェック
   */
  async checkForErrors() {
    try {
      const errorElement = await this.page.$(this.selectors.errors.errorMessage);
      return errorElement !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * エラーメッセージテキストを取得
   */
  async getErrorText() {
    try {
      const errorElement = await this.page.$(this.selectors.errors.errorMessage);
      if (errorElement) {
        const text = await errorElement.textContent();
        return text ? text.trim() : 'エラーが発生しました';
      }
      return 'エラーが発生しました';
    } catch (error) {
      return 'エラーが発生しました';
    }
  }

  /**
   * 自動決済を停止
   */
  async stop() {
    this.isStopped = true;

    // 一時ファイルを削除
    this.cleanupTempFile();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
  /**
   * clickpost-selectors.json のパスを取得
   * ポータブルビルド時はexeと同じフォルダ、開発時はプロジェクトルート
   */
  static getSelectorsPath() {
    const { app } = require('electron');
    if (app.isPackaged) {
      const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
      if (portableDir) {
        return path.join(portableDir, 'clickpost-selectors.json');
      }
      return path.join(app.getPath('userData'), 'clickpost-selectors.json');
    }
    return path.join(__dirname, 'clickpost-selectors.json');
  }

}

module.exports = ClickPostAutomation;
