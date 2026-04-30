const nextengineApi = require('./nextengine-api');

/**
 * 氏名で受注伝票を検索（既存の4条件 + 氏名完全一致）
 * @param {string} name - 送り先氏名
 * @returns {Array} 受注伝票リスト
 */
async function searchOrderByName(name) {
  const fields = [
    'receive_order_id',
    'receive_order_last_modified_date',
    'receive_order_consignee_name'
  ].join(',');

  const params = {
    fields,
    'receive_order_order_status_id-in': '0,2,20',
    'receive_order_confirm_check_id-eq': '1',
    'receive_order_cancel_type_id-eq': '0',
    'receive_order_deposit_type_id-eq': '2',
    'receive_order_consignee_name-eq': name
  };

  const result = await nextengineApi.callApi('/api_v1_receiveorder_base/search', params);
  return result.data || [];
}

/**
 * 受注伝票の追跡番号（発送伝票番号）を更新
 * @param {string|number} orderId - 伝票番号
 * @param {string} lastModifiedDate - 最終更新日（楽観的ロック用）
 * @param {string} trackingNumber - 追跡番号（問い合わせ番号）
 */
async function updateTrackingNumber(orderId, lastModifiedDate, trackingNumber) {
  const xml = `<?xml version="1.0" encoding="utf-8"?><root><receiveorder_base><receive_order_delivery_cut_form_id>${trackingNumber}</receive_order_delivery_cut_form_id></receiveorder_base></root>`;

  const params = {
    'receive_order_id': orderId,
    'receive_order_last_modified_date': lastModifiedDate,
    'receive_order_shipped_update_flag': '1',
    'data': xml
  };

  return await nextengineApi.callApi('/api_v1_receiveorder_base/update', params);
}

/**
 * 問い合わせ番号連携用CSVの内容をパース
 * @param {string} content - CSVテキスト（Shift-JISデコード済み）
 * @returns {{ data: Array<{name, inquiryNumber}>, rowCount: number }}
 */
function parseLinkCsv(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) {
    throw new Error('CSVデータが空です');
  }

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;
    data.push({ name: cols[0], inquiryNumber: cols[1] });
  }

  return { data, rowCount: data.length };
}

/**
 * 問い合わせ番号をネクストエンジンに一括連携
 * @param {Array<{name, inquiryNumber}>} csvData - 連携対象データ
 * @param {Function} sendProgress - (current, total, message, status) を受け取るコールバック
 * @returns {{ successCount: number, errorCount: number }}
 */
async function runLinking(csvData, sendProgress) {
  const total = csvData.length;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < csvData.length; i++) {
    const { name, inquiryNumber } = csvData[i];
    sendProgress(i, total, `${i + 1}件目: 「${name}」を検索中...`, 'info');

    try {
      const orders = await searchOrderByName(name);

      if (orders.length === 0) {
        sendProgress(i + 1, total, `${i + 1}件目: 「${name}」— 伝票が見つかりませんでした`, 'error');
        errorCount++;
        continue;
      }

      for (const order of orders) {
        await updateTrackingNumber(
          order.receive_order_id,
          order.receive_order_last_modified_date,
          inquiryNumber
        );
      }

      sendProgress(i + 1, total, `${i + 1}件目: 「${name}」— 追跡番号を登録しました（${orders.length}件）`, 'success');
      successCount++;
    } catch (err) {
      sendProgress(i + 1, total, `${i + 1}件目: 「${name}」— エラー: ${err.message}`, 'error');
      errorCount++;
    }
  }

  return { successCount, errorCount };
}

module.exports = {
  parseLinkCsv,
  runLinking
};
