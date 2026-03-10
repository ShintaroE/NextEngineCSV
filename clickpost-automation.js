const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * クリックポスト自動決済クラス
 */
class ClickPostAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.progressCallback = null;
    this.isStopped = false;

    // セレクター設定を読み込む（必須）
    const selectorsPath = path.join(__dirname, 'clickpost-selectors.json');

    try {
      const selectorsJson = fs.readFileSync(selectorsPath, 'utf-8');
      this.selectors = JSON.parse(selectorsJson);
    } catch (error) {
      const errorMessage = `
========================================
❌ エラー: clickpost-selectors.json が見つかりません
========================================

このファイルはクリックポスト自動化に必須です。

対処方法:
1. プロジェクトルートに clickpost-selectors.json があることを確認
2. ファイルが削除されている場合は、CLICKPOST_SETUP.md を参照して再作成

ファイルパス: ${selectorsPath}
========================================
      `.trim();

      console.error(errorMessage);
      throw new Error('clickpost-selectors.json が見つかりません。このファイルは必須です。');
    }
  }

  /**
   * 進行状況コールバックを設定
   */
  onProgress(callback) {
    this.progressCallback = callback;
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
      this.sendProgress(0, csvData.length, 'ブラウザを起動しています...', 'info');

      // ブラウザを起動（ユーザーに見せる）
      this.browser = await chromium.launch({
        headless: false,
        slowMo: 100  // 操作を少しゆっくりに（人間らしく）
      });

      this.page = await this.browser.newPage();

      // クリックポストサイトにアクセス
      this.sendProgress(0, csvData.length, 'クリックポストサイトにアクセスしています...', 'info');
      await this.page.goto('https://clickpost.jp/');

      // ログイン画面が表示されたら待機
      this.sendProgress(0, csvData.length, 'ログインしてください（手動）', 'info');

      // ログイン後のページを待機（ユーザーが手動でログイン）
      // マイページのURLまたは要素を待機
      try {
        await Promise.race([
          this.page.waitForURL('**/mypage/**', { timeout: 300000 }),
          this.page.waitForSelector(this.selectors.navigation.myPageIndicator, { timeout: 300000 })
        ]);
      } catch (error) {
        throw new Error('ログインタイムアウト。5分以内にログインしてください。');
      }

      this.sendProgress(0, csvData.length, 'ログイン完了。処理を開始します...', 'success');

      // 各行を処理
      for (let i = 0; i < csvData.length; i++) {
        if (this.isStopped) {
          this.sendProgress(i, csvData.length, '処理が停止されました', 'error');
          break;
        }

        const row = csvData[i];

        try {
          await this.processRow(row, i + 1, csvData.length);
          this.sendProgress(i + 1, csvData.length, `${i + 1}件目: ${row['お届け先氏名'] || ''}の処理が完了しました`, 'success');
        } catch (error) {
          this.sendProgress(i + 1, csvData.length, `${i + 1}件目: エラー - ${error.message}`, 'error');
          // エラーが発生しても次の行に進む
        }

        // レート制限（1秒待機）
        await this.page.waitForTimeout(1000);
      }

      this.sendProgress(csvData.length, csvData.length, 'すべての処理が完了しました！', 'success');

    } catch (error) {
      this.sendProgress(0, csvData.length, `エラーが発生しました: ${error.message}`, 'error');
      throw error;
    } finally {
      // ブラウザを閉じる
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    }
  }

  /**
   * 1行を処理（1件のクリックポスト登録）
   */
  async processRow(row, currentIndex, total) {
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 登録フォームを開いています...`, 'info');

    // 新規作成ボタンをクリックまたは直接URLに移動
    try {
      const newLabelButton = await this.page.$(this.selectors.navigation.newLabelButton);
      if (newLabelButton) {
        await newLabelButton.click();
      } else {
        // ボタンが見つからない場合は直接URLに移動
        await this.page.goto(this.selectors.urls.newLabel || 'https://clickpost.jp/mypage/new');
      }
    } catch (error) {
      // エラー時は直接URLに移動
      await this.page.goto(this.selectors.urls.newLabel || 'https://clickpost.jp/mypage/new');
    }

    await this.page.waitForLoadState('networkidle');

    // フォームに入力
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 送り先情報を入力しています...`, 'info');

    // 郵便番号
    const postalCode = row['お届け先郵便番号'] || row['郵便番号'] || '';
    if (postalCode) {
      await this.fillInputMulti(this.selectors.labelForm.postalCode, postalCode);
    }

    // 氏名
    const name = row['お届け先氏名'] || row['氏名'] || '';
    if (name) {
      await this.fillInputMulti(this.selectors.labelForm.recipientName, name);
    }

    // 住所1（都道府県・市区町村）
    const address1 = row['お届け先住所1行目'] || row['お届け先住所1'] || row['住所1'] || '';
    if (address1) {
      await this.fillInputMulti(this.selectors.labelForm.address1, address1);
    }

    // 住所2（町域・番地）
    const address2 = row['お届け先住所2行目'] || row['お届け先住所2'] || row['住所2'] || '';
    if (address2) {
      await this.fillInputMulti(this.selectors.labelForm.address2, address2);
    }

    // 住所3（建物名等）
    const address3 = row['お届け先住所3行目'] || row['お届け先住所3'] || row['住所3'] || '';
    if (address3) {
      await this.fillInputMulti(this.selectors.labelForm.address3, address3);
    }

    // 内容品（商品名）
    const productName = row['内容品'] || row['商品名'] || '';
    if (productName) {
      await this.fillInputMulti(this.selectors.labelForm.content, productName);
    }

    // 少し待機（フォーム検証のため）
    await this.page.waitForTimeout(500);

    // 決済ボタンをクリック
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 決済を実行しています...`, 'info');

    try {
      // 決済ボタンをクリック
      await this.clickMulti(this.selectors.labelForm.submitButton);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });

      // エラーチェック
      const hasError = await this.checkForErrors();
      if (hasError) {
        const errorText = await this.getErrorText();
        throw new Error(`決済処理エラー: ${errorText}`);
      }

      // 成功確認（次のページに遷移したか確認）
      await this.page.waitForTimeout(1000);

    } catch (error) {
      throw new Error(`決済実行エラー: ${error.message}`);
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
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = ClickPostAutomation;
