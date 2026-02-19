/**
 * ネクストエンジンAPI基盤
 * - 認証情報の読み込み/保存
 * - APIリクエストの共通処理
 * - 受注伝票検索・受注明細検索
 */

const fs = require('fs');
const path = require('path');

// APIホスト
const API_HOST = 'https://api.next-engine.org';

// データフォルダのパスを取得する関数（main.jsから渡される）
let getDataDirFunc = null;

/**
 * 初期化：データフォルダ取得関数を設定
 */
function init(getDataDir) {
  getDataDirFunc = getDataDir;
}

/**
 * 認証データファイルのパスを取得
 */
function getAuthFilePath() {
  if (!getDataDirFunc) {
    throw new Error('NextEngineAPI not initialized. Call init() first.');
  }
  return path.join(getDataDirFunc(), 'auth.json');
}

/**
 * 認証情報を読み込む
 */
function loadAuthData() {
  const filePath = getAuthFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('認証情報読み込みエラー:', error);
  }
  return {
    client_id: '',
    client_secret: '',
    access_token: '',
    refresh_token: ''
  };
}

/**
 * 認証情報を保存する
 */
function saveAuthData(data) {
  const filePath = getAuthFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('認証情報保存エラー:', error);
    return false;
  }
}

/**
 * 認証状態を確認
 */
function getAuthStatus() {
  const auth = loadAuthData();
  if (auth.access_token && auth.refresh_token) {
    return { status: 'configured', message: '設定済み' };
  }
  return { status: 'not_configured', message: '未設定' };
}

/**
 * API呼び出し共通処理
 * - トークンを自動で付与
 * - レスポンスの新トークンを自動保存
 */
async function callApi(endpoint, params = {}) {
  const auth = loadAuthData();

  if (!auth.access_token || !auth.refresh_token) {
    throw new Error('認証情報が設定されていません');
  }

  // リクエストパラメータを構築
  const requestParams = new URLSearchParams({
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    wait_flag: '1',
    ...params
  });

  const url = `${API_HOST}${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: requestParams.toString()
    });

    const result = await response.json();

    // 新しいトークンをレスポンスから取得して保存
    if (result.access_token && result.refresh_token) {
      auth.access_token = result.access_token;
      auth.refresh_token = result.refresh_token;
      saveAuthData(auth);
    }

    // エラーチェック
    if (result.result !== 'success') {
      throw new Error(`API Error: ${result.code} - ${result.message || 'Unknown error'}`);
    }

    return result;
  } catch (error) {
    console.error('API呼び出しエラー:', error);
    throw error;
  }
}

/**
 * 受注伝票検索
 * @param {Object} conditions - 検索条件
 * @returns {Array} 受注伝票リスト
 */
async function searchOrders(conditions = {}) {
  const fields = [
    'receive_order_id',
    'receive_order_shop_cut_form_id',
    'receive_order_consignee_name',
    'receive_order_consignee_kana',
    'receive_order_consignee_zip_code',
    'receive_order_consignee_address1',
    'receive_order_consignee_address2',
    'receive_order_consignee_tel',
    'receive_order_date',
    'receive_order_note'
  ].join(',');

  const params = {
    fields: fields,
    ...conditions
  };

  const result = await callApi('/api_v1_receiveorder_base/search', params);
  return result.data || [];
}

/**
 * 受注明細検索（複数伝票ID対応）
 * @param {Array<string|number>} orderIds - 伝票番号の配列
 * @returns {Array} 受注明細リスト
 */
async function searchOrderRows(orderIds) {
  if (!orderIds || orderIds.length === 0) {
    return [];
  }

  const fields = [
    'receive_order_row_receive_order_id',
    'receive_order_row_no',
    'receive_order_row_goods_id',
    'receive_order_row_goods_name',
    'receive_order_row_quantity',
    'receive_order_row_unit_price'
  ].join(',');

  const params = {
    fields: fields,
    'receive_order_row_receive_order_id-in': orderIds.join(',')
  };

  const result = await callApi('/api_v1_receiveorder_row/search', params);
  return result.data || [];
}

/**
 * 受注伝票と明細を結合して取得（最適化版：2回のAPI呼び出し）
 * @param {Object} conditions - 検索条件
 * @returns {Array} アプリ用データ形式に変換された受注リスト
 */
async function fetchOrdersWithDetails(conditions = {}) {
  // 1. 受注伝票を検索（1回目のAPI呼び出し）
  const orders = await searchOrders(conditions);

  if (orders.length === 0) {
    return [];
  }

  // 2. 全伝票IDを収集
  const orderIds = orders.map(order => order.receive_order_id);

  // 3. 全明細を一括取得（2回目のAPI呼び出し）
  const allRows = await searchOrderRows(orderIds);

  // 4. 明細を伝票IDでグループ化
  const rowsByOrderId = {};
  for (const row of allRows) {
    const orderId = row.receive_order_row_receive_order_id;
    if (!rowsByOrderId[orderId]) {
      rowsByOrderId[orderId] = [];
    }
    rowsByOrderId[orderId].push(row);
  }

  // 5. 伝票と明細を結合してアプリ用形式に変換
  const results = [];

  for (const order of orders) {
    const rows = rowsByOrderId[order.receive_order_id] || [];

    // 明細ごとに1行として出力（明細がない場合は伝票情報のみ）
    if (rows.length === 0) {
      results.push({
        slipNo: order.receive_order_id,
        orderNo: order.receive_order_shop_cut_form_id,
        shipCode: '',
        shipName: order.receive_order_consignee_name,
        postalCode: order.receive_order_consignee_zip_code,
        address: (order.receive_order_consignee_address1 || '') + (order.receive_order_consignee_address2 || ''),
        productCode: '',
        productName: '',
        quantity: 0
      });
    } else {
      for (const row of rows) {
        results.push({
          slipNo: order.receive_order_id,
          orderNo: order.receive_order_shop_cut_form_id,
          shipCode: '',
          shipName: order.receive_order_consignee_name,
          postalCode: order.receive_order_consignee_zip_code,
          address: (order.receive_order_consignee_address1 || '') + (order.receive_order_consignee_address2 || ''),
          productCode: row.receive_order_row_goods_id,
          productName: row.receive_order_row_goods_name,
          quantity: row.receive_order_row_quantity
        });
      }
    }
  }

  return results;
}

// エクスポート
module.exports = {
  init,
  loadAuthData,
  saveAuthData,
  getAuthStatus,
  callApi,
  searchOrders,
  searchOrderRows,
  fetchOrdersWithDetails
};
