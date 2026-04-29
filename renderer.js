// タブ切り替え機能
document.addEventListener('DOMContentLoaded', () => {
  const tabNavItems = document.querySelectorAll('.tab-nav li');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabNavItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.dataset.tab;

      // ナビゲーションのアクティブ状態を更新
      tabNavItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // パネルの表示を切り替え
      tabPanels.forEach(panel => panel.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
    });
  });

  // マスタ機能の初期化
  initMasterFeature();

  // 検索機能の初期化
  initSearchFeature();

  // クリックポスト機能の初期化
  initClickPostFeature();

  // 認証機能の初期化
  initAuthFeature();

  // ログ機能の初期化
  initLogFeature();

  // 問い合わせ番号機能の初期化
  initInquiryFeature();
});

// ========================================
// マスタ設定機能
// ========================================

let editingCode = null; // 編集中の商品コード（nullなら新規追加）

function initMasterFeature() {
  const btnAddMaster = document.getElementById('btn-add-master');
  const modal = document.getElementById('master-modal');
  const modalClose = document.getElementById('modal-close');
  const modalCancel = document.getElementById('modal-cancel');
  const modalSave = document.getElementById('modal-save');

  // マスタ追加ボタン
  btnAddMaster.addEventListener('click', () => {
    openModal();
  });

  // モーダルを閉じる
  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);

  // モーダル背景クリックで閉じる
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // 登録ボタン
  modalSave.addEventListener('click', saveMaster);

  // 編集・削除ボタン（イベント委譲）
  document.getElementById('master-table-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, code, name } = btn.dataset;
    if (action === 'edit')   editMaster(code, name);
    if (action === 'delete') deleteMaster(code);
  });

  // 初期データ読み込み
  loadMasters();
}

// モーダルを開く
function openModal(code = null, name = '') {
  const modal = document.getElementById('master-modal');
  const modalTitle = document.getElementById('modal-title');
  const codeInput = document.getElementById('master-code');
  const nameInput = document.getElementById('master-name');

  editingCode = code;

  if (code) {
    // 編集モード
    modalTitle.textContent = 'マスタ編集';
    codeInput.value = code;
    codeInput.readOnly = false;
    nameInput.value = name;
  } else {
    // 新規追加モード
    modalTitle.textContent = 'マスタ追加';
    codeInput.value = '';
    codeInput.readOnly = false;
    nameInput.value = '';
  }

  modal.classList.add('active');
  codeInput.focus();
}

// モーダルを閉じる
function closeModal() {
  const modal = document.getElementById('master-modal');
  modal.classList.remove('active');
  editingCode = null;
}

// マスタ一覧を読み込む
async function loadMasters() {
  const data = await window.electronAPI.loadMasters();
  renderMasterTable(data.masters);
}

// テーブルを描画
function renderMasterTable(masters) {
  const tbody = document.getElementById('master-table-body');

  if (masters.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #999;">データがありません</td></tr>';
    return;
  }

  tbody.innerHTML = masters.map(master => `
    <tr>
      <td>${escapeHtml(master.code)}</td>
      <td>${escapeHtml(master.name)}</td>
      <td class="actions">
        <button class="btn btn-primary" data-action="edit" data-code="${escapeHtml(master.code)}" data-name="${escapeHtml(master.name)}">編集</button>
        <button class="btn btn-danger" data-action="delete" data-code="${escapeHtml(master.code)}">削除</button>
      </td>
    </tr>
  `).join('');
}

// マスタを保存
async function saveMaster() {
  const code = document.getElementById('master-code').value.trim();
  const name = document.getElementById('master-name').value.trim();

  if (!code || !name) {
    await window.electronAPI.showAlert('商品コードと名称を入力してください');
    return;
  }

  let result;
  if (editingCode) {
    // 更新（元のコードと新しいコード・名称を渡す）
    result = await window.electronAPI.updateMaster(editingCode, code, name);
  } else {
    // 新規追加
    result = await window.electronAPI.addMaster(code, name);
  }

  if (result.success) {
    closeModal();
    renderMasterTable(result.data.masters);
  } else {
    await window.electronAPI.showAlert(result.error || '保存に失敗しました');
  }
}

// マスタを編集
function editMaster(code, name) {
  openModal(code, name);
}

// マスタを削除
async function deleteMaster(code) {
  const confirmed = await window.electronAPI.showConfirm(`商品コード「${code}」を削除しますか？`);
  if (!confirmed) {
    return;
  }

  const result = await window.electronAPI.deleteMaster(code);
  if (result.success) {
    renderMasterTable(result.data.masters);
  } else {
    await window.electronAPI.showAlert(result.error || '削除に失敗しました');
  }
}

// HTMLエスケープ
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========================================
// 検索機能
// ========================================

let currentSearchResults = [];

function initSearchFeature() {
  const btnSearch = document.getElementById('btn-search');
  const btnSelectAll = document.getElementById('btn-select-all');
  const btnCsvExport = document.getElementById('btn-csv-export');
  const chkSelectAll = document.getElementById('chk-select-all');

  // 検索ボタン
  btnSearch.addEventListener('click', searchOrders);

  // 全選択ボタン（大きいボタン）
  btnSelectAll.addEventListener('click', selectAll);

  // CSV出力ボタン
  btnCsvExport.addEventListener('click', exportCsv);

  // 全選択チェックボックス（テーブルヘッダー）
  chkSelectAll.addEventListener('change', toggleSelectAll);

  // 初期状態：テーブルは空
  renderSearchResults([]);
}

// 検索実行
async function searchOrders() {
  const btnSearch = document.getElementById('btn-search');
  btnSearch.disabled = true;
  btnSearch.textContent = '検索中...';

  try {
    const result = await window.electronAPI.neSearchOrders({
      'receive_order_order_status_id-in': '0,2,20',
      'receive_order_confirm_check_id-eq': '1',
      'receive_order_cancel_type_id-eq': '0',
      'receive_order_deposit_type_id-eq': '2'
    });

    if (result.success) {
      const orders = result.orders || [];

      // マスタで商品名を上書き
      const masterData = await window.electronAPI.loadMasters();
      const masterMap = new Map(masterData.masters.map(m => [m.code, m.name]));
      orders.forEach(item => {
        if (item.productCode && masterMap.has(item.productCode)) {
          item.productName = masterMap.get(item.productCode);
        }
      });

      currentSearchResults = orders;
      renderSearchResults(currentSearchResults);
    } else {
      alert('検索に失敗しました: ' + (result.error || '不明なエラー'));
      currentSearchResults = [];
      renderSearchResults([]);
    }
  } catch (error) {
    alert('検索エラー: ' + error.message);
    currentSearchResults = [];
    renderSearchResults([]);
  } finally {
    btnSearch.disabled = false;
    btnSearch.textContent = '検索';
  }
}

// 全選択
function selectAll() {
  const chkSelectAll = document.getElementById('chk-select-all');
  const checkboxes = document.querySelectorAll('.row-checkbox');

  chkSelectAll.checked = true;
  checkboxes.forEach(checkbox => {
    checkbox.checked = true;
  });
}

// 検索結果を描画
function renderSearchResults(results) {
  const tbody = document.getElementById('search-result-body');
  const chkSelectAll = document.getElementById('chk-select-all');
  const countBar = document.getElementById('search-count-bar');

  // 全選択チェックボックスをリセット
  chkSelectAll.checked = false;

  if (results.length === 0) {
    countBar.style.display = 'none';
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #999;">該当するデータがありません</td></tr>';
    return;
  }

  // カウントバーを更新
  const slipCount = new Set(results.map(item => item.slipNo)).size;
  document.getElementById('count-rows').textContent = results.length;
  document.getElementById('count-slips').textContent = slipCount;
  countBar.style.display = 'block';

  tbody.innerHTML = results.map((item, index) => `
    <tr>
      <td><input type="checkbox" class="row-checkbox" data-index="${index}"></td>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.slipNo)}</td>
      <td>${escapeHtml(item.productCode)}</td>
      <td>${escapeHtml(item.productName)}</td>
      <td>${item.quantity}</td>
      <td>${escapeHtml(item.shipName)}</td>
      <td>${escapeHtml(item.postalCode)}</td>
      <td>${escapeHtml(item.address)}</td>
    </tr>
  `).join('');
}

// 全選択/全解除
function toggleSelectAll() {
  const chkSelectAll = document.getElementById('chk-select-all');
  const checkboxes = document.querySelectorAll('.row-checkbox');

  checkboxes.forEach(checkbox => {
    checkbox.checked = chkSelectAll.checked;
  });
}

// 住所を指定文字数で分割する関数
function splitAddress(address, maxLength = 20) {
  const lines = [];
  let remaining = address;

  while (remaining.length > 0) {
    lines.push(remaining.substring(0, maxLength));
    remaining = remaining.substring(maxLength);
  }

  // 4行分を確保（足りない分は空文字）
  while (lines.length < 4) {
    lines.push('');
  }

  return lines.slice(0, 4); // 最大4行まで
}

// CSV出力
async function exportCsv() {
  const checkboxes = document.querySelectorAll('.row-checkbox:checked');

  if (checkboxes.length === 0) {
    alert('出力する行を選択してください');
    return;
  }

  // 選択された行のデータを取得
  const selectedData = Array.from(checkboxes).map(checkbox => {
    const index = parseInt(checkbox.dataset.index);
    return currentSearchResults[index];
  });

  // 1. 全行を展開（個数分だけ複製）
  const expandedRows = [];
  selectedData.forEach(item => {
    const quantity = item.quantity || 1;
    for (let i = 0; i < quantity; i++) {
      expandedRows.push({ ...item });
    }
  });

  // 2. お届け先氏名でソート
  expandedRows.sort((a, b) => a.shipName.localeCompare(b.shipName, 'ja'));

  // 3. 同じお届け先氏名の出現回数をカウント（分割前の全データで計算）
  const nameCount = {};
  expandedRows.forEach(row => {
    nameCount[row.shipName] = (nameCount[row.shipName] || 0) + 1;
  });

  // 3.5. 伝票番号順に戻す
  expandedRows.sort((a, b) => {
    if (a.slipNo < b.slipNo) return -1;
    if (a.slipNo > b.slipNo) return 1;
    return 0;
  });

  // 4. CSV行を生成（出現回数2以上なら◎をつける）
  const headers = ['お届け先郵便番号', 'お届け先氏名', 'お届け先敬称', 'お届け先住所1行目', 'お届け先住所2行目', 'お届け先住所3行目', 'お届け先住所4行目', '内容品', '重複'];

  const rows = expandedRows.map(item => {
    const addressLines = splitAddress(item.address, 20);
    const isDuplicate = nameCount[item.shipName] >= 2;

    return [
      item.postalCode,
      item.shipName,
      '様',
      addressLines[0],
      addressLines[1],
      addressLines[2],
      addressLines[3],
      item.productName,
      isDuplicate ? '◎' : ''
    ].map(field => `"${field}"`).join(',');
  });

  const MAX_ROWS_PER_FILE = 40;

  // 40行以下の場合は単一ファイル保存
  if (rows.length <= MAX_ROWS_PER_FILE) {
    const csvContent = [headers.join(','), ...rows].join('\n');
    const result = await window.electronAPI.saveCsv(csvContent);

    if (result.success) {
      alert(`${expandedRows.length}件のデータをCSV出力しました（元データ: ${selectedData.length}件）\n\n保存先: ${result.filePath}`);
    } else if (result.canceled) {
      // キャンセルされた場合は何もしない
    } else {
      alert('CSV保存に失敗しました: ' + (result.error || '不明なエラー'));
    }
    return;
  }

  // 41行以上の場合は分割保存
  const csvContents = [];
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_FILE) {
    const chunk = rows.slice(i, i + MAX_ROWS_PER_FILE);
    const csvContent = [headers.join(','), ...chunk].join('\n');
    csvContents.push(csvContent);
  }

  const result = await window.electronAPI.saveCsvMultiple(csvContents);

  if (result.success) {
    alert(`${result.fileCount}ファイルに分割して出力しました（計${expandedRows.length}件、元データ: ${selectedData.length}件）\n\n保存先: ${result.filePaths[0]} など`);
  } else if (result.canceled) {
    // キャンセルされた場合は何もしない
  } else {
    alert('CSV保存に失敗しました: ' + (result.error || '不明なエラー'));
  }
}

// ========================================
// 認証機能
// ========================================

async function initAuthFeature() {
  const btnSaveAuth = document.getElementById('btn-save-auth');
  const btnStartOAuth = document.getElementById('btn-start-oauth');

  // 保存ボタン
  btnSaveAuth.addEventListener('click', saveAuth);

  // 認証開始ボタン
  btnStartOAuth.addEventListener('click', startOAuth);

  // 初期データ読み込み
  await loadAuth();
}

// OAuth認証を開始
async function startOAuth() {
  const clientId = document.getElementById('auth-client-id').value.trim();
  const clientSecret = document.getElementById('auth-client-secret').value.trim();

  if (!clientId || !clientSecret) {
    alert('client_id と client_secret を入力してください');
    return;
  }

  const btnStartOAuth = document.getElementById('btn-start-oauth');
  btnStartOAuth.disabled = true;
  btnStartOAuth.textContent = '認証中...';

  try {
    const result = await window.electronAPI.startOAuth(clientId, clientSecret);

    if (result.success) {
      alert('認証が完了しました');
      await loadAuth(); // トークン情報を再読み込み
    } else if (result.canceled) {
      // キャンセルされた場合は何も表示しない
    } else {
      alert('認証に失敗しました: ' + (result.error || '不明なエラー'));
    }
  } catch (error) {
    alert('認証エラー: ' + error.message);
  } finally {
    btnStartOAuth.disabled = false;
    btnStartOAuth.textContent = '認証開始';
  }
}

// 認証情報を読み込む
async function loadAuth() {
  const auth = await window.electronAPI.loadAuth();

  document.getElementById('auth-client-id').value = auth.client_id || '';
  document.getElementById('auth-client-secret').value = auth.client_secret || '';
  document.getElementById('auth-access-token').value = auth.access_token || '';
  document.getElementById('auth-refresh-token').value = auth.refresh_token || '';

  // 認証状態を更新
  updateAuthStatus();
}

// 認証情報を保存
async function saveAuth() {
  const authData = {
    client_id: document.getElementById('auth-client-id').value.trim(),
    client_secret: document.getElementById('auth-client-secret').value.trim(),
    access_token: document.getElementById('auth-access-token').value.trim(),
    refresh_token: document.getElementById('auth-refresh-token').value.trim()
  };

  const result = await window.electronAPI.saveAuth(authData);

  if (result.success) {
    alert('認証情報を保存しました');
    updateAuthStatus();
  } else {
    alert('認証情報の保存に失敗しました');
  }
}

// 認証状態を更新
async function updateAuthStatus() {
  const status = await window.electronAPI.getAuthStatus();
  const statusElement = document.getElementById('auth-status');

  if (status.status === 'configured') {
    statusElement.textContent = '認証状態: ● 設定済み';
    statusElement.style.color = '#27ae60';
  } else {
    statusElement.textContent = '認証状態: ○ 未設定';
    statusElement.style.color = '#e74c3c';
  }
}

// ========================================
// ログ機能
// ========================================

let logRefreshInterval = null;

function initLogFeature() {
  const btnClearLog = document.getElementById('btn-clear-log');

  // クリアボタン
  btnClearLog.addEventListener('click', clearLogs);

  // ログタブが表示されたときに更新を開始
  const tabNavItems = document.querySelectorAll('.tab-nav li');
  tabNavItems.forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.tab === 'log') {
        startLogRefresh();
      } else {
        stopLogRefresh();
      }
    });
  });
}

// ログの定期更新を開始
function startLogRefresh() {
  // 即座に更新
  refreshLogs();

  // 2秒ごとに更新
  if (!logRefreshInterval) {
    logRefreshInterval = setInterval(refreshLogs, 2000);
  }
}

// ログの定期更新を停止
function stopLogRefresh() {
  if (logRefreshInterval) {
    clearInterval(logRefreshInterval);
    logRefreshInterval = null;
  }
}

// ログを更新
async function refreshLogs() {
  const logs = await window.electronAPI.getLogs();
  renderLogs(logs);
}

// ログを描画
function renderLogs(logs) {
  const logContent = document.getElementById('log-content');
  const logCount = document.getElementById('log-count');
  const logContainer = document.getElementById('log-container');

  logCount.textContent = `件数: ${logs.length}件`;

  if (logs.length === 0) {
    logContent.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999;">ログはありません</td></tr>';
    return;
  }

  const html = logs.map(log => {
    const time = new Date(log.timestamp).toLocaleTimeString('ja-JP');
    const levelClass = log.level === 'success' ? 'status-shipped' : log.level === 'error' ? 'status-returned' : 'status-pending';
    const levelText = log.level === 'success' ? '成功' : log.level === 'error' ? '失敗' : '情報';

    return `<tr>` +
      `<td>${time}</td>` +
      `<td><span class="status-badge ${levelClass}">${levelText}</span></td>` +
      `<td>${escapeHtml(log.endpointName)}</td>` +
      `<td>${escapeHtml(log.message)}</td>` +
      `</tr>`;
  }).join('');

  logContent.innerHTML = html;

  // 自動スクロール
  logContainer.scrollTop = logContainer.scrollHeight;
}

// ログをクリア
async function clearLogs() {
  await window.electronAPI.clearLogs();
  refreshLogs();
}

// ========================================
// クリックポスト自動決済機能
// ========================================

let clickpostCsvData = null;
let isAutomationRunning = false;

function initClickPostFeature() {
  const btnLoadCsv = document.getElementById('btn-load-clickpost-csv');
  const btnStartAutomation = document.getElementById('btn-start-automation');
  const btnStopAutomation = document.getElementById('btn-stop-automation');
  const btnCardSettings = document.getElementById('btn-clickpost-card-settings');
  const cardModal = document.getElementById('card-settings-modal');

  // CSV読み込みボタン
  btnLoadCsv.addEventListener('click', loadClickPostCsv);

  // 自動決済開始ボタン
  btnStartAutomation.addEventListener('click', startAutomation);

  // 停止ボタン
  btnStopAutomation.addEventListener('click', stopAutomation);

  // カード設定ボタン → モーダルを開く
  btnCardSettings.addEventListener('click', async () => {
    const config = await window.electronAPI.loadClickPostConfig();
    document.getElementById('card-last4').value = config.cardLast4 || '';
    document.getElementById('card-cvv').value = config.cvv || '';
    cardModal.classList.add('active');
  });

  // モーダルを閉じる
  document.getElementById('card-settings-modal-close').addEventListener('click', () => {
    cardModal.classList.remove('active');
  });
  document.getElementById('card-settings-cancel').addEventListener('click', () => {
    cardModal.classList.remove('active');
  });

  // 保存ボタン
  document.getElementById('card-settings-save').addEventListener('click', async () => {
    const cardLast4 = document.getElementById('card-last4').value.trim();
    const cvv = document.getElementById('card-cvv').value.trim();

    if (cardLast4 && !/^\d{4}$/.test(cardLast4)) {
      await window.electronAPI.showAlert('クレジットカード下4桁は数字4桁で入力してください。');
      return;
    }
    if (cvv && !/^\d{3,4}$/.test(cvv)) {
      await window.electronAPI.showAlert('セキュリティコードは数字3〜4桁で入力してください。');
      return;
    }

    const result = await window.electronAPI.saveClickPostConfig({ cardLast4, cvv });
    if (result.success) {
      cardModal.classList.remove('active');
    } else {
      await window.electronAPI.showAlert(`保存に失敗しました: ${result.error}`);
    }
  });

  // 進行状況イベントを受信
  window.electronAPI.onClickPostProgress((event, progress) => {
    updateProgress(progress);
  });
}

// CSVファイルを読み込む
async function loadClickPostCsv() {
  const result = await window.electronAPI.loadClickPostCsv();

  if (result.canceled) {
    return;
  }

  if (!result.success) {
    await window.electronAPI.showAlert(`CSVの読み込みに失敗しました: ${result.error}`);
    return;
  }

  // データを保存
  clickpostCsvData = result.data;

  // ファイル情報を表示
  const csvInfo = document.getElementById('csv-info');
  csvInfo.textContent = `ファイル: ${result.fileName} (${result.rowCount}件)`;
  csvInfo.style.color = '#27ae60';

  // プレビューを表示
  showPreview(result.data);
}

// データプレビューを表示
function showPreview(data) {
  const previewSection = document.getElementById('clickpost-preview');
  const summaryDiv = document.getElementById('clickpost-summary');
  const previewBody = document.getElementById('clickpost-preview-body');
  const actionSection = document.getElementById('clickpost-action');

  // サマリーを表示
  summaryDiv.innerHTML = `<strong>合計: ${data.length}件</strong>のデータを読み込みました`;

  // プレビューテーブルを作成（最初の10件のみ）
  const previewData = data.slice(0, 10);
  const html = previewData.map((row, index) => {
    const postalCode = row['お届け先郵便番号'] || row['郵便番号'] || '';
    const name = row['お届け先氏名'] || row['氏名'] || '';
    const address = [
      row['お届け先住所1行目'] || row['お届け先住所1'] || row['住所1'] || '',
      row['お届け先住所2行目'] || row['お届け先住所2'] || row['住所2'] || '',
      row['お届け先住所3行目'] || row['お届け先住所3'] || row['住所3'] || '',
      row['お届け先住所4行目'] || row['お届け先住所4'] || row['住所4'] || ''
    ].filter(a => a).join(' ');
    const productName = row['内容品'] || row['商品名'] || '';

    return `<tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(postalCode)}</td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(address)}</td>
      <td>${escapeHtml(productName)}</td>
    </tr>`;
  }).join('');

  previewBody.innerHTML = html;

  if (data.length > 10) {
    previewBody.innerHTML += `<tr><td colspan="5" style="text-align: center; color: #999;">... 他${data.length - 10}件</td></tr>`;
  }

  // プレビューセクションとアクションセクションを表示
  previewSection.style.display = 'block';
  actionSection.style.display = 'block';
}

// 自動決済を開始
async function startAutomation() {
  if (!clickpostCsvData || clickpostCsvData.length === 0) {
    await window.electronAPI.showAlert('CSVデータがありません。先にCSVファイルを読み込んでください。');
    return;
  }

  const confirmed = await window.electronAPI.showConfirm(
    `${clickpostCsvData.length}件のクリックポスト決済を自動実行します。\n\nこの処理には時間がかかる場合があります。よろしいですか?`
  );

  if (!confirmed) {
    return;
  }

  // 自動決済を開始
  isAutomationRunning = true;
  updateAutomationButtons();

  // 進行状況セクションを表示
  const progressSection = document.getElementById('clickpost-progress');
  progressSection.style.display = 'block';

  // 進行状況をリセット
  document.getElementById('progress-bar-fill').style.width = '0%';
  document.getElementById('progress-text').textContent = '0 / 0 件処理完了';
  document.getElementById('progress-log').innerHTML = '';

  // 自動決済を実行
  const result = await window.electronAPI.startClickPostAutomation(clickpostCsvData);

  if (!result.success) {
    await window.electronAPI.showAlert(`自動決済の実行に失敗しました: ${result.error}`);
    isAutomationRunning = false;
    updateAutomationButtons();
    return;
  }

  // 完了
  isAutomationRunning = false;
  updateAutomationButtons();
}

// 自動決済を停止
async function stopAutomation() {
  const confirmed = await window.electronAPI.showConfirm('自動決済を停止しますか?');

  if (!confirmed) {
    return;
  }

  await window.electronAPI.stopClickPostAutomation();
  isAutomationRunning = false;
  updateAutomationButtons();

  addProgressLog('停止されました', 'error');
}

// 進行状況を更新
function updateProgress(progress) {
  const { current, total, message, status } = progress;

  // プログレスバーを更新
  const percentage = total > 0 ? (current / total) * 100 : 0;
  document.getElementById('progress-bar-fill').style.width = `${percentage}%`;

  // テキストを更新
  document.getElementById('progress-text').textContent = `${current} / ${total} 件処理完了`;

  // ログを追加
  if (message) {
    addProgressLog(message, status || 'info');
  }
}

// 進行状況ログを追加
function addProgressLog(message, status = 'info') {
  const progressLog = document.getElementById('progress-log');
  const time = new Date().toLocaleTimeString('ja-JP');

  const statusColors = {
    success: '#27ae60',
    error: '#e74c3c',
    info: '#666'
  };

  const color = statusColors[status] || statusColors.info;

  const logLine = document.createElement('div');
  logLine.style.color = color;
  logLine.style.marginBottom = '4px';
  logLine.textContent = `[${time}] ${message}`;

  progressLog.appendChild(logLine);

  // 自動スクロール
  progressLog.scrollTop = progressLog.scrollHeight;
}

// ========================================
// 問い合わせ番号機能
// ========================================

function initInquiryFeature() {
  document.getElementById('btn-create-inquiry-csv').addEventListener('click', async () => {
    const rowCount = parseInt(document.getElementById('inquiry-page').value, 10);

    if (!rowCount || rowCount < 1) {
      await window.electronAPI.showAlert('問い合わせ番号抽出行数を1以上の数値で入力してください');
      return;
    }

    // 進行状況をリセットして表示
    document.getElementById('inquiry-csv-progress').style.display = 'block';
    document.getElementById('inquiry-progress-bar-fill').style.width = '0%';
    document.getElementById('inquiry-progress-text').textContent = `0 / ${rowCount} 件取得`;
    document.getElementById('inquiry-progress-log').innerHTML = '';

    const result = await window.electronAPI.startInquiryCsvCreation(rowCount);

    if (result.success) {
      addInquiryProgressLog(`完了: ${result.count} 件をCSVに保存しました`, 'success');
    } else if (!result.canceled) {
      addInquiryProgressLog(`エラー: ${result.error}`, 'error');
      await window.electronAPI.showAlert(`エラーが発生しました: ${result.error}`);
    }
  });

  window.electronAPI.onInquiryProgress((_event, progress) => {
    const { current, total, message, status } = progress;

    document.getElementById('inquiry-csv-progress').style.display = 'block';

    const percentage = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('inquiry-progress-bar-fill').style.width = `${percentage}%`;
    document.getElementById('inquiry-progress-text').textContent = `${current} / ${total} 件取得`;

    if (message) {
      addInquiryProgressLog(message, status || 'info');
    }
  });
}

function addInquiryProgressLog(message, status = 'info') {
  const progressLog = document.getElementById('inquiry-progress-log');
  const time = new Date().toLocaleTimeString('ja-JP');

  const statusColors = { success: '#27ae60', error: '#e74c3c', info: '#666' };
  const color = statusColors[status] || statusColors.info;

  const logLine = document.createElement('div');
  logLine.style.color = color;
  logLine.style.marginBottom = '4px';
  logLine.textContent = `[${time}] ${message}`;

  progressLog.appendChild(logLine);
  progressLog.scrollTop = progressLog.scrollHeight;
}

// ボタンの表示状態を更新
function updateAutomationButtons() {
  const btnStart = document.getElementById('btn-start-automation');
  const btnStop = document.getElementById('btn-stop-automation');

  if (isAutomationRunning) {
    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-block';
  } else {
    btnStart.style.display = 'inline-block';
    btnStop.style.display = 'none';
  }
}
