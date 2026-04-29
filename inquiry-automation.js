const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class InquiryAutomation {
  constructor() {
    this.browser = null;
    this.page = null;
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

  async start(page) {
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

    const url = `https://clickpost.jp/mypage/index?page=${page}`;
    await this.page.goto(url);
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
