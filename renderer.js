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

// デモ用データ（将来的にはNextEngine APIから取得）
const demoData = [
  { slipNo: 'D-20240001', productCode: 'P001', productName: 'サンプル商品A', quantity: 2, shipCode: 'S001', shipName: '山田商店', postalCode: '150-0001', address: '東京都渋谷区1-2-3' },
  { slipNo: 'D-20240002', productCode: 'P002', productName: 'サンプル商品B', quantity: 1, shipCode: 'S002', shipName: '田中物産', postalCode: '530-0001', address: '大阪府大阪市北区4-5-6' },
  { slipNo: 'D-20240003', productCode: 'P003', productName: 'サンプル商品C', quantity: 3, shipCode: 'S003', shipName: '鈴木電機', postalCode: '460-0001', address: '愛知県名古屋市中区7-8-9' },
  { slipNo: 'D-20240004', productCode: 'P001', productName: 'サンプル商品A', quantity: 5, shipCode: 'S004', shipName: '佐藤工業', postalCode: '812-0001', address: '福岡県福岡市博多区10-11-12' },
  { slipNo: 'D-20240005', productCode: 'P004', productName: 'サンプル商品D', quantity: 1, shipCode: 'S005', shipName: '高橋商事', postalCode: '060-0001', address: '北海道札幌市中央区13-14-15' },
  { slipNo: 'D-20240006', productCode: 'P002', productName: 'サンプル商品B', quantity: 2, shipCode: 'S006', shipName: '伊藤製作所', postalCode: '980-0001', address: '宮城県仙台市青葉区16-17-18' },
  { slipNo: 'D-20240007', productCode: 'P005', productName: 'サンプル商品E', quantity: 4, shipCode: 'S007', shipName: '渡辺運輸', postalCode: '730-0001', address: '広島県広島市中区19-20-21' },
  { slipNo: 'D-20240008', productCode: 'P003', productName: 'サンプル商品C', quantity: 1, shipCode: 'S008', shipName: '中村食品', postalCode: '604-0001', address: '京都府京都市中京区22-23-24' },
];

let currentSearchResults = [];

function initSearchFeature() {
  const btnSelectAll = document.getElementById('btn-select-all');
  const btnCsvExport = document.getElementById('btn-csv-export');
  const chkSelectAll = document.getElementById('chk-select-all');

  // 全選択ボタン（大きいボタン）
  btnSelectAll.addEventListener('click', selectAll);

  // CSV出力ボタン
  btnCsvExport.addEventListener('click', exportCsv);

  // 全選択チェックボックス（テーブルヘッダー）
  chkSelectAll.addEventListener('change', toggleSelectAll);

  // 初期データを表示
  currentSearchResults = demoData;
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

  // クリックポスト形式のCSVを生成
  const headers = ['お届け先郵便番号', 'お届け先氏名', 'お届け先敬称', 'お届け先住所1行目', 'お届け先住所2行目', 'お届け先住所3行目', 'お届け先住所4行目', '内容品'];

  const rows = selectedData.map(item => {
    const addressLines = splitAddress(item.address, 20);
    return [
      item.postalCode,
      item.shipName,
      '様',
      addressLines[0],
      addressLines[1],
      addressLines[2],
      addressLines[3],
      item.productName
    ].map(field => `"${field}"`).join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');

  // メインプロセスでファイル保存
  const result = await window.electronAPI.saveCsv(csvContent);

  if (result.success) {
    alert(`${selectedData.length}件のデータをCSV出力しました\n\n保存先: ${result.filePath}`);
  } else if (result.canceled) {
    // キャンセルされた場合は何もしない
  } else {
    alert('CSV保存に失敗しました: ' + (result.error || '不明なエラー'));
  }
}
