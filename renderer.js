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

  // 認証機能の初期化
  initAuthFeature();
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
    codeInput.readOnly = true; // コードは編集不可
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
        <button class="btn btn-primary" onclick="editMaster('${escapeHtml(master.code)}', '${escapeHtml(master.name)}')">編集</button>
        <button class="btn btn-danger" onclick="deleteMaster('${escapeHtml(master.code)}')">削除</button>
      </td>
    </tr>
  `).join('');
}

// マスタを保存
async function saveMaster() {
  const code = document.getElementById('master-code').value.trim();
  const name = document.getElementById('master-name').value.trim();

  if (!code || !name) {
    alert('商品コードと名称を入力してください');
    return;
  }

  let result;
  if (editingCode) {
    // 更新
    result = await window.electronAPI.updateMaster(code, name);
  } else {
    // 新規追加
    result = await window.electronAPI.addMaster(code, name);
  }

  if (result.success) {
    closeModal();
    renderMasterTable(result.data.masters);
  } else {
    alert(result.error || '保存に失敗しました');
  }
}

// マスタを編集
function editMaster(code, name) {
  openModal(code, name);
}

// マスタを削除
async function deleteMaster(code) {
  if (!confirm(`商品コード「${code}」を削除しますか？`)) {
    return;
  }

  const result = await window.electronAPI.deleteMaster(code);
  if (result.success) {
    renderMasterTable(result.data.masters);
  } else {
    alert(result.error || '削除に失敗しました');
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
  const data = await window.electronAPI.loadOrders();
  currentSearchResults = data.orders || [];
  renderSearchResults(currentSearchResults);
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

  // 全選択チェックボックスをリセット
  chkSelectAll.checked = false;

  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #999;">該当するデータがありません</td></tr>';
    return;
  }

  tbody.innerHTML = results.map((item, index) => `
    <tr>
      <td><input type="checkbox" class="row-checkbox" data-index="${index}"></td>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.slipNo)}</td>
      <td>${escapeHtml(item.productCode)}</td>
      <td>${escapeHtml(item.productName)}</td>
      <td>${item.quantity}</td>
      <td>${escapeHtml(item.shipCode)}</td>
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

  // 3. 同じお届け先氏名の出現回数をカウント
  const nameCount = {};
  expandedRows.forEach(row => {
    nameCount[row.shipName] = (nameCount[row.shipName] || 0) + 1;
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

  const csvContent = [headers.join(','), ...rows].join('\n');

  // メインプロセスでファイル保存
  const result = await window.electronAPI.saveCsv(csvContent);

  if (result.success) {
    alert(`${expandedRows.length}件のデータをCSV出力しました（元データ: ${selectedData.length}件）\n\n保存先: ${result.filePath}`);
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

  // 保存ボタン
  btnSaveAuth.addEventListener('click', saveAuth);

  // 初期データ読み込み
  await loadAuth();
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
