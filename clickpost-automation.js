const { chromium } = require('playwright');

/**
 * クリックポスト自動決済クラス
 */
class ClickPostAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.progressCallback = null;
    this.isStopped = false;
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
      // マイページのURLを待機
      await this.page.waitForURL('**/mypage/**', { timeout: 300000 }); // 5分待機

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
    // 新規登録ページへ移動
    // 注意: 実際のクリックポストサイトのセレクターは異なる可能性があります
    // この実装は参考例であり、実際のサイト構造に合わせて調整が必要です

    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 登録フォームを開いています...`, 'info');

    // 新規作成ボタンをクリック（セレクターは実際のサイトに合わせて調整）
    try {
      await this.page.click('a[href*="regist"]', { timeout: 5000 });
    } catch (error) {
      // ボタンが見つからない場合は直接URLに移動
      await this.page.goto('https://clickpost.jp/mypage/regist');
    }

    await this.page.waitForLoadState('networkidle');

    // フォームに入力
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 送り先情報を入力しています...`, 'info');

    // 郵便番号
    const postalCode = row['お届け先郵便番号'] || row['郵便番号'] || '';
    if (postalCode) {
      await this.fillInput('input[name*="postal"]', postalCode);
    }

    // 氏名
    const name = row['お届け先氏名'] || row['氏名'] || '';
    if (name) {
      await this.fillInput('input[name*="name"]', name);
    }

    // 住所1（都道府県・市区町村）
    const address1 = row['お届け先住所1'] || row['住所1'] || '';
    if (address1) {
      await this.fillInput('input[name*="address1"]', address1);
    }

    // 住所2（町域・番地）
    const address2 = row['お届け先住所2'] || row['住所2'] || '';
    if (address2) {
      await this.fillInput('input[name*="address2"]', address2);
    }

    // 住所3（建物名等）
    const address3 = row['お届け先住所3'] || row['住所3'] || '';
    if (address3) {
      await this.fillInput('input[name*="address3"]', address3);
    }

    // 内容品（商品名）
    const productName = row['商品名'] || '';
    if (productName) {
      await this.fillInput('input[name*="content"]', productName);
    }

    // 決済ボタンをクリック
    this.sendProgress(currentIndex - 1, total, `${currentIndex}件目: 決済を実行しています...`, 'info');

    try {
      // 決済ボタン（実際のセレクターに合わせて調整）
      await this.page.click('button[type="submit"]', { timeout: 5000 });
      await this.page.waitForLoadState('networkidle');

      // エラーチェック
      const hasError = await this.checkForErrors();
      if (hasError) {
        throw new Error('決済処理でエラーが発生しました');
      }

    } catch (error) {
      throw new Error(`決済実行エラー: ${error.message}`);
    }
  }

  /**
   * 入力フィールドに値を入力
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
   * エラーチェック
   */
  async checkForErrors() {
    try {
      // エラーメッセージの有無をチェック（実際のサイトに合わせて調整）
      const errorElement = await this.page.$('.error-message, .alert-danger, [class*="error"]');
      return errorElement !== null;
    } catch (error) {
      return false;
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
