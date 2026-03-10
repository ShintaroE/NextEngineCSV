# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**NextEngineCSV** は、ネクストエンジン（eコマース受注管理システム）のAPIを活用して、受注データを検索・CSV出力するElectronデスクトップアプリケーションです。

**技術スタック**: Electron + Vanilla JavaScript（Node.js環境）

## 開発コマンド

```bash
# 依存関係インストール
npm install

# Playwrightブラウザインストール（クリックポスト機能に必要）
npx playwright install chromium

# 開発環境で実行
npm start

# Windowsポータブルビルド（x64 + ia32）
npm run build:win

# クロスプラットフォームビルド
npm run build
```

**注**: テストフレームワークは未導入

## アーキテクチャ

### 3層IPC通信構造

```
[UI Layer]
  ├─ index.html - レイアウト・スタイル
  └─ renderer.js - UIロジック、タブ管理、CSV生成
         ↓ IPC通信
[Main Process Layer]
  ├─ preload.js - セキュアなAPI公開層
  └─ main.js - IPCハンドラー、ファイルI/O、OAuth認証
         ↓
[API/Data Layer]
  ├─ nextengine-api.js - ネクストエンジンAPI通信、ログ管理
  ├─ clickpost-automation.js - Playwright自動化（遅延ロード: 初回呼び出し時のみ require）
  └─ data/*.json - 永続化データ（認証情報、マスタ）
```

### 主要ファイルの責務

| ファイル | 役割 |
|---------|------|
| [main.js](main.js) | Electronメインプロセス。ウィンドウ作成、IPC通信、ファイルI/O、OAuth認証フロー |
| [preload.js](preload.js) | Context Isolation用のAPI公開層。`window.electronAPI`を提供 |
| [renderer.js](renderer.js) | UIロジック。タブ管理、フォーム処理、CSV出力ロジック、イベントハンドリング |
| [nextengine-api.js](nextengine-api.js) | ネクストエンジンAPI通信。認証、トークン管理、ログ機構 |
| [clickpost-automation.js](clickpost-automation.js) | Playwright自動化。クリックポスト決済の自動実行 |
| [clickpost-selectors.json](clickpost-selectors.json) | クリックポストセレクター設定（カスタマイズ可能） |
| [index.html](index.html) | UIレイアウト。5タブ構成（検索、クリックポスト、ログ、マスタ、認証） |

### IPC通信インターフェース

`preload.js`で公開されるAPI（`window.electronAPI`）:

```javascript
// マスタ操作
loadMasters() → Promise<Array>
addMaster(code, name) → Promise<void>
updateMaster(oldCode, newCode, name) → Promise<void>
deleteMaster(code) → Promise<void>

// データ操作
loadOrders() → Promise<Array>

// CSV操作
saveCsv(csvContent) → Promise<void>
saveCsvMultiple(csvContents) → Promise<void>

// 認証関連
loadAuth() → Promise<Object>
saveAuth(authData) → Promise<void>
getAuthStatus() → Promise<boolean>
startOAuth(clientId, clientSecret) → Promise<Object>

// ネクストエンジンAPI
neSearchOrders(conditions) → Promise<Object>

// ログ
getLogs() → Promise<Array>
clearLogs() → Promise<void>

// ダイアログ
showConfirm(message) → Promise<boolean>
showAlert(message) → Promise<void>

// クリックポスト自動化
loadClickPostCsv() → Promise<{success, data, fileName, rowCount}>
startClickPostAutomation(csvData) → Promise<{success}>
stopClickPostAutomation() → Promise<{success}>
onClickPostProgress(callback) → void  // IPC イベントリスナー (clickpost:progress)
```

## データファイル管理

### ポータブルビルド対応

データファイルの読み込み優先順位（[main.js:8-30](main.js#L8-L30)）:

1. **ビルド時**: `exe同じフォルダのdata/`
2. **開発時**: `プロジェクトルートのdata/`
3. **フォールバック**: `AppData/Roaming/NextEngineCSV/data/`

### データファイル

- `data/auth.json` - 認証情報（client_id, client_secret, access_token, refresh_token）
- `data/master-data.json` - 商品マスタ（`{masters: [{code, name}, ...]}`形式）
- `data/demo-data.json` - デモ用注文データ（開発/テスト用、`{orders: [...]}`形式）

## 主要機能

### 1. 受注検索・CSV出力（検索タブ）

- 固定検索条件: ステータス（保留中/確認/一部発送）、確認済み、キャンセルなし、入金済み
- **40行以下**: 単一CSV
- **41行以上**: 自動分割（`_1.csv`, `_2.csv`...）
- 住所を20文字×4行に分割（[renderer.js:325](renderer.js#L325) `splitAddress`）
- 重複配送先に`◎`マーク付与（[renderer.js:398](renderer.js#L398)）
- Shift_JISエンコード（`iconv-lite`使用）

### 2. マスタ設定（マスタ設定タブ）

- CRUD操作: 追加、編集（コード・名称変更可能）、削除
- 「マスタで上書き」: 検索結果の商品名をマスタで置き換え
- JSON永続化（`data/master-data.json`）

### 3. OAuth2認証（認証タブ）

- ブラウザウィンドウで認証フロー
- トークン自動更新（API通信時にレスポンスから取得）
- 有効期限目安: access_token 24時間、refresh_token 72時間

### 4. クリックポスト自動決済（クリックポストタブ）

- **CSV読み込み**: ネクストエンジンから出力したCSVを読み込み
- **データプレビュー**: 最初の10件をテーブル表示
- **自動決済実行**: Playwrightでブラウザ自動操作
  - 手動ログイン待機（Yahoo!/Amazon Pay）
  - フォーム自動入力（郵便番号、氏名、住所、商品名）
  - 決済ボタン自動クリック
- **進行状況表示**: リアルタイムプログレスバー、ログ表示
- **停止機能**: 処理中断可能
- **セレクター設定**: [clickpost-selectors.json](clickpost-selectors.json)でカスタマイズ可能

### 5. ログ出力（ログ出力タブ）

- API通信の全ログを記録（メモリ保持、最大100件）
- 2秒ごと自動更新（ログタブ表示時）
- クリア機能付き

## セキュリティ設定

- **Context Isolation**: 有効
- **Node Integration**: 無効
- **CSP**: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`
- **XSS防止**: `escapeHtml`関数実装（[renderer.js:190](renderer.js#L190)）

## 開発時のポイント

### イベント委譲パターン

マスタテーブルのボタン処理は委譲で実装（[renderer.js:68-75](renderer.js#L68-L75)）:

```javascript
document.getElementById('master-table-body').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, code, name } = btn.dataset;
  if (action === 'edit')   editMaster(code, name);
  if (action === 'delete') deleteMaster(code);
});
```

### トークンリフレッシュ

`nextengine-api.js`でAPI通信時に自動でトークンを更新（[nextengine-api.js:240-245](nextengine-api.js#L240-L245)）:

```javascript
// レスポンスから新トークンを取得して保存
if (result.access_token && result.refresh_token) {
  auth.access_token = result.access_token;
  auth.refresh_token = result.refresh_token;
  saveAuthData(auth);
}
```

### CSV分割ロジック

40行超の場合、自動分割（[renderer.js:402-430](renderer.js#L402-L430)）:

```javascript
const MAX_ROWS_PER_FILE = 40;
if (rows.length <= MAX_ROWS_PER_FILE) {
  // 単一ファイル保存
} else {
  // ファイル名に _1, _2 を付与して分割保存
}
```

### クリックポストセレクターの調整

[clickpost-selectors.json](clickpost-selectors.json) でセレクターをカスタマイズ:

1. ブラウザ開発者ツール（F12）でクリックポストサイトを確認
2. フォーム要素の`name`属性、`id`属性、`class`名を取得
3. JSONファイルのセレクターを実際のものに更新

```json
{
  "labelForm": {
    "postalCode": "input[name='postal_code']",  // 実際のname属性に合わせる
    "recipientName": "input[id='recipient_name']"
  }
}
```

複数セレクターをカンマ区切りで指定可能（フォールバック対応）:

```json
"postalCode": "input[name='postal_code'], input[id='postal'], #postalCode"
```

## ネクストエンジンAPI

- **ベースURL**: `https://api.next-engine.org`
- **認証エンドポイント**: `https://base.next-engine.org`
- **OAuth2**: クライアント認証フロー
- **ドキュメント**: [ネクストエンジンAPI仕様](https://developer.next-engine.com/)

## ビルド設定

`package.json`の`build`セクション:

- **appId**: `com.example.nextenginecsv`
- **productName**: `NextEngineCSV`
- **出力先**: `dist/`
- **ターゲット**: Windows Portable (x64 + ia32)
