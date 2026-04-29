const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class InquiryAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
    this.progressCallback = null;
  }

  onProgress(callback) {
    this.progressCallback = callback;
  }

  sendProgress(current, total, message, status = 'info') {
    if (this.progressCallback) {
      this.progressCallback({ current, total, message, status });
    }
  }

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

  async start(rowCount) {
    const totalPages = Math.ceil(rowCount / 10);
    const results = [];

    try {
      this.sendProgress(0, rowCount, 'ブラウザを起動しています...', 'info');

      const profilePath = this.getBrowserProfilePath();
      if (!fs.existsSync(profilePath)) {
        fs.mkdirSync(profilePath, { recursive: true });
      }

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
        this.browser = await chromium.launchPersistentContext(profilePath, {
          ...launchOptions,
          channel: 'chrome'
        });
      } catch (e1) {
        console.log('Chrome起動失敗、Edgeを試します:', e1.message);
        try {
          this.browser = await chromium.launchPersistentContext(profilePath, {
            ...launchOptions,
            channel: 'msedge'
          });
        } catch (e2) {
          console.log('Edge起動失敗、Playwright内蔵Chromiumを使用します:', e2.message);
          this.browser = await chromium.launchPersistentContext(profilePath, launchOptions);
        }
      }

      this.page = this.browser.pages()[0] || await this.browser.newPage();

      this.sendProgress(0, rowCount, 'クリックポストにアクセスしています...', 'info');
      await this.page.goto('https://clickpost.jp/mypage/index?page=1');
      await this.page.waitForLoadState('networkidle');

      // ログイン未済の場合は手動ログイン待機
      if (!this.page.url().includes('/mypage/')) {
        this.sendProgress(0, rowCount, 'ログインしてください（手動）', 'info');
        try {
          await this.page.waitForURL('**/mypage/**', { timeout: 300000 });
        } catch {
          throw new Error('ログインタイムアウト。5分以内にログインしてください。');
        }
        await this.page.goto('https://clickpost.jp/mypage/index?page=1');
        await this.page.waitForLoadState('networkidle');
      }

      this.sendProgress(0, rowCount, 'データ抽出を開始します...', 'success');

      for (let p = 1; p <= totalPages; p++) {
        if (p > 1) {
          await this.page.goto(`https://clickpost.jp/mypage/index?page=${p}`);
          await this.page.waitForLoadState('networkidle');
        }

        this.sendProgress(results.length, rowCount, `${p} / ${totalPages} ページを処理中...`, 'info');

        const rows = await this.page.$$('tbody[data-mypage-target="tbody"] tr');

        for (const row of rows) {
          if (results.length >= rowCount) break;

          const inquiryNumberEl = await row.$('td.col_package_number');
          const nameEl = await row.$('td.col_receiver');
          if (!inquiryNumberEl || !nameEl) continue;

          const inquiryNumber = (await inquiryNumberEl.textContent() || '').trim();
          const name = (await nameEl.textContent() || '').trim();

          // お問い合わせ番号が空の行はスキップ
          if (!inquiryNumber) continue;

          results.push({ name, inquiryNumber });
        }

        this.sendProgress(results.length, rowCount, `${p} / ${totalPages} ページ完了（${results.length} 件取得）`, 'success');

        if (results.length >= rowCount) break;
      }

      return results;

    } finally {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    }
  }

  async stop() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = InquiryAutomation;
