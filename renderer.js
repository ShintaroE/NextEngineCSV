// preload.jsで公開されたAPIを使用
const versionsElement = document.getElementById('versions');

// バージョン情報を表示
versionsElement.innerHTML = `
  Node.js: ${window.versions.node()}<br>
  Chrome: ${window.versions.chrome()}<br>
  Electron: ${window.versions.electron()}
`;
