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
});
