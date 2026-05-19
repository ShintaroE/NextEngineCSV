const nextengineApi = require('./nextengine-api');

/**
 * CSV氏名リストをIN条件で一括検索し、Map<氏名, 伝票[]> を返す
 * @param {string[]} names - 検索対象の氏名リスト（重複あり可）
 * @returns {{ nameMap: Map, totalFetched: number }}
 */
async function fetchOrderNameMap(names) {
  const uniqueNames = [...new Set(names)];

  const result = await nextengineApi.callApi('/api_v1_receiveorder_base/search', {
    fields: 'receive_order_id,receive_order_last_modified_date,receive_order_consignee_name',
    'receive_order_order_status_id-in': '0,2,20',
    'receive_order_confirm_check_id-eq': '1',
    'receive_order_cancel_type_id-eq': '0',
    'receive_order_deposit_type_id-eq': '2',
    'receive_order_consignee_name-in': uniqueNames.join(','),
  });

  const orders = result.data || [];

  const nameMap = new Map();
  for (const order of orders) {
    const name = order.receive_order_consignee_name;
    if (!nameMap.has(name)) nameMap.set(name, []);
    nameMap.get(name).push(order);
  }

  return { nameMap, totalFetched: orders.length };
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

  return nextengineApi.callApi('/api_v1_receiveorder_base/update', params);
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

  sendProgress(0, total, 'CSV氏名で伝票を一括検索しています...', 'info');
  const { nameMap, totalFetched } = await fetchOrderNameMap(csvData.map(r => r.name));
  sendProgress(0, total, `${totalFetched}件の伝票を取得しました。照合を開始します...`, 'success');

  for (let i = 0; i < csvData.length; i++) {
    const { name, inquiryNumber } = csvData[i];
    sendProgress(i, total, `${i + 1}件目: 「${name}」を照合中...`, 'info');

    try {
      const orders = nameMap.get(name) || [];

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
