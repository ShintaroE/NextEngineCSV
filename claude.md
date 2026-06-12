# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**NextEngineCSV** は、ネクストエンジン（eコマース受注管理システム）のAPIを活用して、受注データを検索・CSV出力するElectronデスクトップアプリケーションです。

**技術スタック**: Electron + Vanilla JavaScript（Node.js環境）

## 開発コマンド

```bash
# 依存関係インストール
npm install

# Playwrightブラウザインストール（クリックポスト・問い合わせ番号機能に必要）
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
  └─ main.js - IPCハンドラー（薄いブリッジ）、ファイルI/O、OAuth認証
         ↓
[Feature/Data Layer]
  ├─ nextengine-api.js - 汎用ネクストエンジンAPI通信、ログ管理
  ├─ clickpost-automation.js - Playwright自動化（クリックポスト決済）
  ├─ inquiry-automation.js - Playwright自動化（問い合わせ番号スクレイピング）
  ├─ inquiry-linking.js - 問い合わせ番号連携ロジック（NE API呼び出し＋連携ループ）
  └─ data/*.json - 永続化データ
```

### 主要ファイルの責務

| ファイル | 役割 |
|---------|------|
| [main.js](main.js) | Electronメインプロセス。ウィンドウ作成、IPCブリッジ、ファイルI/O、OAuth認証フロー |
| [preload.js](preload.js) | Context Isolation用のAPI公開層。`window.electronAPI`を提供 |
| [renderer.js](renderer.js) | UIロジック。タブ管理、フォーム処理、CSV出力ロジック、イベントハンドリング |
| [nextengine-api.js](nextengine-api.js) | 汎用ネクストエンジンAPI通信。認証、トークン管理、ログ機構。問い合わせ専用APIは含まない |
| [clickpost-automation.js](clickpost-automation.js) | Playwright自動化。クリックポスト決済の自動実行 |
| [clickpost-selectors.json](clickpost-selectors.json) | クリックポスト自動決済セレクター設定（カスタマイズ可能） |
| [inquiry-automation.js](inquiry-automation.js) | Playwright自動化。マイページから問い合わせ番号を抽出しCSV出力 |
| [inquiry-linking.js](inquiry-linking.js) | 問い合わせ番号連携ロジック。`searchOrderByName`・`updateTrackingNumber`（NE API）、`parseLinkCsv`、`runLinking` |
| [inquiry-selectors.json](inquiry-selectors.json) | 問い合わせ番号抽出セレクター設定（カスタマイズ可能） |
| [index.html](index.html) | UIレイアウト。6タブ構成（検索、クリックポスト自動決済、問い合わせ番号、ログ出力、マスタ設定、認証） |

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
loadClickPostConfig() → Promise<{cardLast4, cvv}>
saveClickPostConfig(config) → Promise<{success}>

// 問い合わせ番号
startInquiryCsvCreation(rowCount) → Promise<{success, count?, canceled?, error?}>
onInquiryProgress(callback) → void  // IPC イベントリスナー (inquiry:progress)
loadInquiryLinkCsv() → Promise<{success, data?, rowCount?, canceled?, error?}>
startInquiryLinking(csvData) → Promise<{success, successCount?, errorCount?, errorNames?, error?}>
onInquiryLinkProgress(callback) → void  // IPC イベントリスナー (inquiry:linkProgress)
```

## データファイル管理

### ポータブルビルド対応

データファイルの読み込み優先順位（[main.js:18-31](main.js#L18-L31)）:

1. **ビルド時**: `exe同じフォルダのdata/`
2. **開発時**: `プロジェクトルートのdata/`
3. **フォールバック**: `AppData/Roaming/NextEngineCSV/data/`

`clickpost-automation.js`・`inquiry-automation.js`の`getSelectorsPath()`と`getBrowserProfilePath()`も同じロジックで解決する。

### データファイル

- `data/auth.json` - 認証情報（client_id, client_secret, access_token, refresh_token）
- `data/master-data.json` - 商品マスタ（`{masters: [{code, name}, ...]}`形式）
- `data/demo-data.json` - デモ用注文データ（開発/テスト用、`{orders: [...]}`形式）
- `data/clickpost-config.json` - クリックポスト決済設定（`{cardLast4, cvv}`形式）

### ブラウザプロファイル

`browser-profile/` ディレクトリに Playwright 永続コンテキストのプロファイルを保存。Yahoo!ウォレット・クリックポストへのログイン状態がここに保持されるため、2回目以降は手動ログインが省略される場合がある。ポータブルビルド時は`exe同じフォルダ/browser-profile/`に配置される。クリックポストと問い合わせ番号機能で同一プロファイルを共有する。

## 主要機能

### 1. 受注検索・CSV出力（検索タブ）

- 固定検索条件: ステータス（保留中/確認/一部発送）、確認済み、キャンセルなし、入金済み
- 選択行を`quantity`の個数分だけ行展開してから出力（quantity=3なら3行に複製）
- **40行以下**: 単一CSV
- **41行以上**: 自動分割（`_1.csv`, `_2.csv`...）
- 住所を20文字×4行に分割（[renderer.js:328](renderer.js#L328) `splitAddress`）
- 同一氏名が2件以上あれば「重複」列に`◎`マーク付与（[renderer.js:385](renderer.js#L385)）。住所ではなく**氏名**で判定
- Shift_JISエンコード（`iconv-lite`使用）

### 2. マスタ設定（マスタ設定タブ）

- CRUD操作: 追加、編集（コード・名称変更可能）、削除
- 「マスタで上書き」: 検索結果の商品名をマスタで置き換え
- JSON永続化（`data/master-data.json`）

### 3. OAuth2認証（認証タブ）

- ブラウザウィンドウで認証フロー
- トークン自動更新（API通信時にレスポンスから取得）
- 有効期限目安: access_token 24時間、refresh_token 72時間

### 4. クリックポスト自動決済（クリックポスト自動決済タブ）

自動化は3フェーズで実行される（[clickpost-automation.js:95-221](clickpost-automation.js#L95-L221)）:

1. **Phase 1 - 初期化**: Chrome/Edge/Chromium の順でブラウザ起動、`clickpost.jp` にアクセス、マイページURLへの遷移を確認して手動ログイン完了を待機（タイムアウト5分）
2. **Phase 2 - CSVアップロード**: ネクストエンジンCSVデータからクリックポスト形式の一時CSVを作成しShift-JIS保存、「まとめ申込」ページでCSVをアップロード・取込確定
3. **Phase 3 - 決済処理**: ラベル一覧から1件ずつ Yahoo!ウォレット決済ボタンをクリック。カード下4桁（ラベル照合）・CVV入力 → 規約同意チェック → 「次へ」→「支払手続き確定」の順で操作

停止は `isStopped` フラグで制御。エラー行はスキップして次へ続行。

### 5. 問い合わせ番号（問い合わせ番号タブ）

2つのセクションで構成される:

**セクション1: CSVファイル作成**
- 抽出行数を入力 → ブラウザ起動（アプリ共有プロファイル使用）
- `https://clickpost.jp/mypage/index?page={N}` を10件/ページでページング
- `inquiry-automation.js` がスクレイピング、セレクターは `inquiry-selectors.json` で管理
- 氏名・問い合わせ番号を抽出しShift-JIS CSVとして保存

**セクション2: 問い合わせ番号連携**
- セクション1で作成したCSVを読み込む
- 確認ダイアログ後、`inquiry-linking.js` の `runLinking()` がネクストエンジンへ一括更新
- `fetchOrderNameMap()` で全ユニーク氏名を1回のAPI呼び出し（`receive_order_consignee_name-in`）で一括取得し、ローカルでMap化
- ローカルMapから氏名で照合し、楽観的ロック（`receive_order_last_modified_date`）付きで `receive_order_delivery_cut_form_id` を更新
- 同名伝票が複数あれば全件更新。見つからない場合はエラーとしてスキップし次へ続行

### 6. ログ出力（ログ出力タブ）

- API通信の全ログを記録（メモリ保持、最大100件）
- 2秒ごと自動更新（ログタブ表示時）
- クリア機能付き

## セキュリティ設定

- **Context Isolation**: 有効
- **Node Integration**: 無効
- **CSP**: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`
- **XSS防止**: `escapeHtml`関数実装（[renderer.js:193](renderer.js#L193)）

## 開発時のポイント

### 開発者ツールの有効化

[main.js:90](main.js#L90) の以下の行をアンコメントすると DevTools が起動時に開く:

```javascript
mainWindow.webContents.openDevTools();
```

### 受注ステータスIDの対応表

`receive_order_order_status_id` の値（固定検索条件 `'0,2,20'` で使用）:

| ID | 意味 |
|----|------|
| 0  | 保留中 |
| 2  | 確認済み |
| 20 | 一部発送 |

### IPC通信パターンの使い分け

- **`ipcRenderer.invoke`**: 呼び出し→応答の1回限りの通信（ほぼ全API）
- **`ipcRenderer.on`**: メインプロセスからのプッシュ通知（`onClickPostProgress`・`onInquiryProgress`・`onInquiryLinkProgress`）

自動化処理中の進行状況はプッシュ型のため、`on`登録後でないと進行状況が受け取れない。

### 問い合わせ番号更新時の副作用

`inquiry-linking.js` の `updateTrackingNumber` は `receive_order_shipped_update_flag: '1'` を同時に送信するため、NEの受注ステータスが「出荷済み」に変更される。意図しないステータス変更に注意。

### 自動化モジュールのレイジーロード

`ClickPostAutomation` と `InquiryAutomation` クラスは、各 IPC ハンドラー内で初回呼び出し時に `require()` される（アプリ起動時ではない）。セレクターJSONが読み込めない場合はクラスのコンストラクタで例外が発生する。

### NEAPIの同期モード

`callApi()` は常に `wait_flag: '1'` を送信する（NE APIの同期実行モード）。非同期モードへの変更が必要な場合はここを修正する。

### parseLinkCsvの制限

`inquiry-linking.js` の `parseLinkCsv` は単純な `split(',')` でCSVをパースするため、フィールド内にカンマが含まれると壊れる。`main.js` の RFC 4180 準拠 `parseCSVRow` とは異なる。問い合わせCSVはアプリ自身が生成するため通常は問題ない（氏名にカンマが含まれる場合は要注意）。

### セレクターの調整

`clickpost-selectors.json` / `inquiry-selectors.json` でセレクターをカスタマイズ:

1. ブラウザ開発者ツール（F12）でサイトを確認
2. フォーム要素の`name`属性、`id`属性、`class`名を取得
3. JSONファイルのセレクターを実際のものに更新

`clickpost-automation.js` の `clickMulti`/`fillInputMulti`/`waitForSelectorMulti` はカンマ区切りで複数セレクターを順に試すフォールバック設計。

詳細セットアップ手順は [CLICKPOST_SETUP.md](CLICKPOST_SETUP.md) を参照。

## ネクストエンジンAPI

- **ベースURL**: `https://api.next-engine.org`
- **認証エンドポイント**: `https://base.next-engine.org`
- **OAuth2**: クライアント認証フロー
- **`callApi()`**: 認証トークン付与・レスポンスからのトークン自動更新を共通処理で行う。`inquiry-linking.js` は `nextengine-api.callApi()` を直接利用する
- **ドキュメント**: [ネクストエンジンAPI仕様](https://developer.next-engine.com/)

## ビルド設定

`package.json`の`build`セクション:

- **appId**: `com.example.nextenginecsv`
- **productName**: `NextEngineCSV`
- **出力先**: `dist/`
- **ターゲット**: Windows Portable (x64 + ia32)

