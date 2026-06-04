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
    this.currentPaymentUrl = null;

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
      let successCount = 0;
      let errorCount = 0;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 3;

      while (!this.isStopped) {
        await this.page.waitForLoadState('networkidle');

        // 決済ボタンが現れるまで最大15秒待機、現れなければ全件完了とみなす
        try {
          await this.waitForSelectorMulti(this.selectors.paymentList.yahooWalletButton, 15000);
        } catch {
          break;
        }

        // 残りの決済ボタン数でループ終了・現在の件番号を判定
        // 成功するとボタンが消えるため、total - 残数 + 1 が現在処理中の件番号になる
        const buttons = await this.page.$$(this.selectors.paymentList.yahooWalletButton);

        const currentItem = total - buttons.length + 1;

        try {
          await this.processPayment(currentItem, total);
          this.sendProgress(currentItem, total, `${currentItem}件目: 決済が完了しました`, 'success');
          successCount++;
          consecutiveErrors = 0;
          this.currentPaymentUrl = null;

        } catch (error) {
          this.sendProgress(currentItem, total, `${currentItem}件目: エラー - ${error.message}`, 'error');
          errorCount++;
          consecutiveErrors++;

          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            this.sendProgress(currentItem, total, `同一件で${MAX_CONSECUTIVE_ERRORS}回連続失敗。処理を中断します。`, 'error');
            break;
          }

          if (this.currentPaymentUrl) {
            this.sendProgress(currentItem, total, `${currentItem}件目: ウォレットURLから再試行します...`, 'info');
            try {
              await this.page.goto(this.currentPaymentUrl);
              await this.page.waitForLoadState('networkidle');
              await this.executePaymentFlow(currentItem, total);
              this.sendProgress(currentItem, total, `${currentItem}件目: 決済が完了しました（再試行）`, 'success');
              errorCount--;
              successCount++;
              consecutiveErrors = 0;
            } catch (retryError) {
              this.sendProgress(currentItem, total, `${currentItem}件目: 再試行失敗 - ${retryError.message}`, 'error');
              await this.navigateToPaymentList(currentItem, total);
              this.sendProgress(currentItem, total, '決済一覧に戻りました。次の件を処理します...', 'info');
            }
          } else {
            await this.navigateToPaymentList(currentItem, total);
            this.sendProgress(currentItem, total, '決済一覧に戻りました。次の件を処理します...', 'info');
          }

          this.currentPaymentUrl = null;
        }

        // ネットワークが安定するまで待機
        await this.page.waitForLoadState('networkidle');
      }

      this.sendProgress(total, total, `すべての処理が完了しました！（${successCount}件成功・${errorCount}件失敗）`, 'success');
      return { successCount, errorCount };

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

    // ウォレットURLを取得して保存（エラー時の再試行用）
    this.currentPaymentUrl = await this.extractWalletUrl();
    if (this.currentPaymentUrl) {
      console.log(`[WalletUrl] Extracted: ${this.currentPaymentUrl}`);
    }

    // 「お支払い手続きへ」ボタンをクリック（Yahoo!ウォレット）
    await this.waitForSelectorMulti(this.selectors.paymentList.yahooWalletButton, 30000);
    await this.clickMulti(this.selectors.paymentList.yahooWalletButton);
    await this.page.waitForLoadState('networkidle');

    await this.executePaymentFlow(currentIndex, total);
  }

  /**
   * ウォレットページのURLをmultiple_paymentページのhidden inputから取得
   */
  async extractWalletUrl() {
    try {
      const keyInput = await this.page.$(this.selectors.paymentList.walletKeyInput);
      if (!keyInput) return null;
      const keyValue = await keyInput.getAttribute('value');
      if (!keyValue) return null;
      return `${this.selectors.urls.walletBase}?key=${encodeURIComponent(keyValue)}`;
    } catch (error) {
      console.warn('[WalletUrl] キー取得失敗:', error.message);
      return null;
    }
  }

  /**
   * ウォレットページでのCVV入力〜決済確定フロー
   * processPayment から直接呼ぶほか、再試行時にも使用する
   */
  async executePaymentFlow(currentIndex, total) {
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 支払いを確定しています...`, 'info');

    try {
      // 「次へ」ボタンが見つかるまで待機（最大30秒）
      await this.waitForSelectorMulti(this.selectors.paymentList.nextButton, 30000);

      // カード下4桁でラジオボタンを選択
      if (this.config.cardLast4) {
        console.log(`[Card] Config value: ${this.config.cardLast4}`);
        const cardResult = await this.selectCardByLast4(this.config.cardLast4);
        console.log(`[Card] Result: ${cardResult ? 'SUCCESS' : 'FAILED'}`);
        // カード選択後、CVVフィールドが有効になるまで待機
        await this.page.waitForTimeout(500);
      } else {
        console.log('[Card] No config value set');
      }

      // セキュリティコード（CVV）を入力
      if (this.config.cvv) {
        console.log(`[CVV] Config value: ${this.config.cvv}`);
        const cvvResult = await this.fillCvvInput(this.config.cvv);
        console.log(`[CVV] Result: ${cvvResult ? 'SUCCESS' : 'FAILED'}`);
        await this.page.waitForTimeout(300);
      } else {
        console.log('[CVV] No config value set');
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

    // 成功判定を先に行う（マイページへのリダイレクト等）
    const isSuccess = await this.isPaymentSuccessful();
    if (isSuccess) {
      console.log('[Payment] Payment completed successfully');
      return;
    }

    // エラーチェック（成功でない場合のみ）
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
   * セキュリティコード（CVV）を入力
   * @param {string} cvv - セキュリティコード
   */
  async fillCvvInput(cvv) {
    const cvvSelector = this.selectors.paymentList.cvvInput;
    const selectors = cvvSelector.split(',').map(s => s.trim());

    console.log(`[CVV] Start input: selector = ${cvvSelector}`);

    for (const selector of selectors) {
      try {
        console.log(`[CVV] Trying selector: ${selector}`);
        const element = await this.page.$(selector);

        if (element) {
          console.log(`[CVV] Element found`);

          // 要素が表示・有効になるまで待機
          await this.page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
          console.log(`[CVV] Element is visible`);

          // フォーカスを当てる
          await element.focus();
          await this.page.waitForTimeout(100);

          // 既存の値をクリア（Ctrl+A → Delete）
          await this.page.keyboard.press('Control+A');
          await this.page.keyboard.press('Delete');
          await this.page.waitForTimeout(100);

          // キーボードで直接入力
          await this.page.keyboard.type(cvv, { delay: 50 });
          console.log(`[CVV] Input complete`);

          return true;
        } else {
          console.log(`[CVV] Element not found with: ${selector}`);
        }
      } catch (error) {
        console.error(`[CVV] Error (${selector}): ${error.message}`);
        continue;
      }
    }

    console.warn(`[CVV] Input field not found: ${cvvSelector}`);
    return false;
  }

  /**
   * カード下4桁でラジオボタンを選択
   * @param {string} last4 - カードの下4桁
   */
  async selectCardByLast4(last4) {
    try {
      // カードラベルを取得
      const labelSelector = this.selectors.paymentList.cardLabels;
      const labels = await this.page.$$(labelSelector);
      console.log(`[Card] Searching for card ending in: ${last4}`);
      console.log(`[Card] Found ${labels.length} card label(s)`);

      for (const label of labels) {
        const text = await label.textContent();
        console.log(`[Card] Checking label: ${text ? text.trim() : '(empty)'}`);
        // ラベルテキストに下4桁が含まれているか確認
        if (text && text.includes(last4)) {
          // ラベルの for 属性から対応するラジオボタンのIDを取得
          const forAttr = await label.getAttribute('for');
          if (forAttr) {
            const radioButton = await this.page.$(`#${forAttr}`);
            if (radioButton) {
              await radioButton.click();
              console.log(`[Card] Selected: ${text.trim()}`);
              return true;
            }
          }
          // for属性がない場合はラベル自体をクリック
          await label.click();
          console.log(`[Card] Selected (via label click): ${text.trim()}`);
          return true;
        }
      }

      console.warn(`[Card] Card with last4=${last4} not found`);
      return false;
    } catch (error) {
      console.warn(`[Card] Selection error: ${error.message}`);
      return false;
    }
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
   * 決済が成功したか判定
   * @returns {boolean} 成功ならtrue
   */
  async isPaymentSuccessful() {
    try {
      // 1. URLチェック（マイページにリダイレクトされたか）
      const currentUrl = this.page.url();
      const mypagePattern = this.selectors.success?.mypageUrlPattern || '/mypage';
      if (currentUrl.includes(mypagePattern)) {
        console.log(`[Payment] Success: Redirected to mypage (${currentUrl})`);
        return true;
      }

      // 2. 成功インジケータ要素チェック
      const successSelector = this.selectors.success?.completedIndicator;
      if (successSelector) {
        const successElement = await this.page.$(successSelector);
        if (successElement) {
          const isVisible = await successElement.isVisible();
          if (isVisible) {
            console.log('[Payment] Success: Found success indicator');
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.warn(`[Payment] Success check error: ${error.message}`);
      return false;
    }
  }

  /**
   * エラーチェック（表示されているエラー要素のみ検出）
   */
  async checkForErrors() {
    try {
      const errorSelector = this.selectors.errors.errorMessage;
      const selectors = errorSelector.split(',').map(s => s.trim());

      for (const selector of selectors) {
        const errorElement = await this.page.$(selector);
        if (errorElement) {
          // 要素が表示されているかも確認
          const isVisible = await errorElement.isVisible();
          if (isVisible) {
            console.log(`[Error] Visible error found: ${selector}`);
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * エラーメッセージテキストを取得
   */
  async getErrorText() {
    try {
      const errorSelector = this.selectors.errors.errorMessage;
      const selectors = errorSelector.split(',').map(s => s.trim());

      for (const selector of selectors) {
        const errorElement = await this.page.$(selector);
        if (errorElement) {
          const isVisible = await errorElement.isVisible();
          if (isVisible) {
            const text = await errorElement.textContent();
            return text ? text.trim() : 'エラーが発生しました';
          }
        }
      }
      return 'エラーが発生しました';
    } catch (error) {
      return 'エラーが発生しました';
    }
  }

  /**
   * 決済一覧ページへ復帰（リトライ付き）
   * 全リトライ失敗時は throw してループを停止する
   */
  async navigateToPaymentList(currentIndex, total, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.page.goto(this.selectors.urls.multiplePayment);
        await this.page.waitForLoadState('networkidle');
        return;
      } catch (error) {
        this.sendProgress(currentIndex, total, `決済一覧への復帰失敗 (${attempt}/${retries}): ${error.message}`, 'error');
        if (attempt < retries) {
          await this.page.waitForTimeout(2000 * attempt);
        }
      }
    }
    throw new Error('決済一覧への復帰に失敗しました。処理を中断します。');
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
