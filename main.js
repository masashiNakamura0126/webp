// ==========================================================================
// main.js  ―― アプリの「裏方」。ウィンドウを作り、FFmpeg を実行する場所です。
//   画面(index.html)からの依頼を受けて、動画を WebP に変換します。
// ==========================================================================

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// --- 同梱された FFmpeg / ffprobe の場所を取得 --------------------------------
// アプリを配布用にパッケージすると、実行ファイルが app.asar の中に入りますが、
// バイナリはそのままでは実行できないため app.asar.unpacked から読み込みます。
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');

// --- ウィンドウを作る -------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 620,
    height: 820,
    minWidth: 520,
    minHeight: 640,
    backgroundColor: '#f5f4f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // セキュリティのため画面側とは分離
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false); // 上部メニューバーを隠す
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==========================================================================
// 動画の情報(幅・高さ・長さ)を調べる
// ==========================================================================
ipcMain.handle('probe', async (_event, filePath) => {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      filePath,
    ];
    const proc = spawn(ffprobePath, args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || 'ffprobe に失敗しました'));
      try {
        const data = JSON.parse(out);
        const stream = (data.streams && data.streams[0]) || {};
        const duration = parseFloat(data.format && data.format.duration) || 0;
        resolve({
          width: stream.width || 0,
          height: stream.height || 0,
          duration,
        });
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
});

// ==========================================================================
// WebP に変換する本体
// ==========================================================================
ipcMain.handle('convert', async (event, options) => {
  const {
    filePath, start, duration, width, fps,
    quality, lossless, compression,
  } = options;

  // 出力先: 元ファイルと同じ場所に「元の名前.webp」で保存
  const outputPath = filePath.replace(/\.[^.]+$/, '') + '.webp';

  // 映像フィルタ: フレームレート変更 + 横幅リサイズ(高さは -1 で自動=比率維持)
  const scaleFilter = width && width > 0
    ? `scale=${width}:-1:flags=lanczos`
    : 'scale=iw:ih';
  const vf = `fps=${fps || 15},${scaleFilter}`;

  // FFmpeg に渡す引数を組み立てる
  const args = ['-y'];                       // 既存ファイルは上書き
  if (start && start > 0) args.push('-ss', String(start)); // 開始位置
  args.push('-i', filePath);                 // 入力
  if (duration && duration > 0) args.push('-t', String(duration)); // 長さ
  args.push(
    '-vf', vf,
    '-c:v', 'libwebp',                       // WebP エンコーダ
    '-loop', '0',                            // 0 = 無限ループ
    '-lossless', lossless ? '1' : '0',       // 可逆(1) / 非可逆(0)
    '-q:v', String(quality != null ? quality : 75), // 画質 0〜100
    '-compression_level', String(compression != null ? compression : 4),
    '-preset', 'picture',
    '-an',                                    // 音声は不要(WebP に音は入らない)
    outputPath
  );

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let err = '';
    const totalSec = duration && duration > 0 ? duration : null;

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      err += text;
      // FFmpeg の進捗(time=00:00:03.20 のような行)を拾って % を計算
      const m = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && totalSec) {
        const cur = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        const pct = Math.min(99, Math.round((cur / totalSec) * 100));
        event.sender.send('progress', pct);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        event.sender.send('progress', 100);
        resolve({ outputPath });
      } else {
        // エラーは最後の数行だけ返す(全部だと長すぎるため)
        reject(new Error(err.split('\n').filter(Boolean).slice(-12).join('\n') || 'ffmpeg に失敗しました'));
      }
    });
    proc.on('error', reject);
  });
});

// 保存先フォルダを開く(結果画面の「フォルダを開く」ボタン用)
ipcMain.handle('reveal', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});
