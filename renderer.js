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
