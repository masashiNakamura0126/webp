// ==========================================================================
// preload.js  ―― 画面(index.html)と裏方(main.js)をつなぐ「窓口」。
//   ここで許可した機能だけを window.api として画面から使えるようにします。
// ==========================================================================

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ドロップされたファイルから実際のパス(場所)を取り出す
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // 動画の情報を調べる
  probe: (filePath) => ipcRenderer.invoke('probe', filePath),

  // 変換を実行する
  convert: (options) => ipcRenderer.invoke('convert', options),

  // 保存先フォルダを開く
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),

  // 変換の進捗(%)を受け取る
  onProgress: (callback) =>
    ipcRenderer.on('progress', (_event, pct) => callback(pct)),
});
