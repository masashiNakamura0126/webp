// ==========================================================================
// app.js — Web版 WebP Converter
// FFmpeg.wasm を使ってブラウザ内で MP4/MOV → WebP 変換
// ==========================================================================

const { FFmpeg } = FFmpegWASM;

// fetchFile: File → Uint8Array
async function fetchFile(file) {
  if (file instanceof File || file instanceof Blob) {
    return new Uint8Array(await file.arrayBuffer());
  }
  const res = await fetch(file);
  return new Uint8Array(await res.arrayBuffer());
}

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let currentFile = null; // { file, name, url, width, height, duration }

// DOM
const el = (id) => document.getElementById(id);
const dropZone     = el('dropZone');
const fileInput    = el('fileInput');
const fileInfo     = el('fileInfo');
const panel        = el('panel');
const progress     = el('progress');
const result       = el('result');
const videoPreview = el('videoPreview');
const previewVideo = el('previewVideo');
const resultPreview = el('resultPreview');
const loadingOverlay = el('loadingOverlay');

// ==========================================================================
// FFmpeg 初期化
// ==========================================================================
async function initFFmpeg() {
  loadingOverlay.classList.add('show');
  try {
    ffmpeg.on('log', ({ message }) => {
      // 進捗をパース (time=00:00:01.23)
      const m = message.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m && currentFile && currentFile.duration > 0) {
        const sec = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        const startSec = parseFloat(el('start').value) || 0;
        const endSec = parseFloat(el('end').value) || currentFile.duration;
        const dur = endSec - startSec;
        const pct = Math.min(99, Math.round((sec / dur) * 100));
        updateProgress(pct);
      }
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
    ffmpegLoaded = true;
    el('loadingMsg').textContent = '準備完了';
  } catch (err) {
    el('loadingMsg').textContent = 'FFmpegの読み込みに失敗しました: ' + err.message;
    console.error(err);
    return;
  }
  loadingOverlay.classList.remove('show');
}

initFFmpeg();

// ==========================================================================
// ユーティリティ
// ==========================================================================
function fmtDuration(sec) {
  if (!sec) return '0秒';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ==========================================================================
// ドラッグ&ドロップ
// ==========================================================================
['dragenter', 'dragover'].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop' || e.relatedTarget === null) {
      dropZone.classList.remove('drag-over');
    }
  })
);

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files || []);
  const valid = files.find((f) => /\.(mp4|mov|webm)$/i.test(f.name));
  if (!valid) {
    showError('MP4、MOV、または WebM ファイルをドロップしてください。');
    return;
  }
  loadFile(valid);
});

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

// ==========================================================================
// ファイル読み込み — video要素でメタデータ取得
// ==========================================================================
async function loadFile(file) {
  hideResult();
  resultPreview.classList.remove('show');

  // 前のURLを開放
  if (currentFile && currentFile.url) URL.revokeObjectURL(currentFile.url);

  const url = URL.createObjectURL(file);

  // video要素でメタ取得
  const meta = await new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      resolve({
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration
      });
    };
    v.onerror = () => reject(new Error('動画のメタデータを読み取れませんでした'));
    v.src = url;
  });

  currentFile = { file, name: file.name, url, ...meta };

  // プレビュー表示
  previewVideo.src = url;
  videoPreview.classList.add('show');

  // 情報表示
  el('fiName').textContent = file.name;
  el('fiMeta').textContent =
    `${meta.width}×${meta.height} px ・ 長さ ${fmtDuration(meta.duration)} ・ ${fmtSize(file.size)}`;
  fileInfo.classList.add('show');

  // 設定の初期値
  el('width').value = Math.min(meta.width, 480);
  el('start').value = 0;
  el('end').value = meta.duration ? meta.duration.toFixed(1) : 0;

  panel.classList.add('show');
  el('convertBtn').disabled = false;
}

// ==========================================================================
// 画質スライダー
// ==========================================================================
el('quality').addEventListener('input', (e) => {
  el('qualityVal').textContent = e.target.value;
});
el('lossless').addEventListener('change', (e) => {
  el('quality').disabled = e.target.checked;
});

// ==========================================================================
// 変換
// ==========================================================================
el('convertBtn').addEventListener('click', async () => {
  if (!currentFile || !ffmpegLoaded) return;

  const start = parseFloat(el('start').value) || 0;
  const end = parseFloat(el('end').value) || currentFile.duration;

  if (end <= start) {
    showError('終了位置は開始位置より後にしてください。');
    return;
  }

  const duration = Math.max(0.1, end - start);
  const width = parseInt(el('width').value) || 480;
  const fps = parseInt(el('fps').value) || 15;
  const quality = parseInt(el('quality').value);
  const lossless = el('lossless').checked;
  const compression = parseInt(el('compression').value);

  hideResult();
  resultPreview.classList.remove('show');
  setBusy(true);
  updateProgress(0);

  try {
    // ファイル書き込み
    const inputName = 'input' + (currentFile.name.match(/\.\w+$/)?.[0] || '.mp4');
    await ffmpeg.writeFile(inputName, await fetchFile(currentFile.file));

    // ffmpegコマンド構築
    const args = ['-ss', String(start), '-i', inputName, '-t', String(duration)];

    // スケール
    args.push('-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`);

    // WebP設定
    if (lossless) {
      args.push('-lossless', '1');
    } else {
      args.push('-quality', String(quality));
    }
    args.push('-compression_level', String(compression));
    args.push('-loop', '0'); // 無限ループ
    args.push('-an'); // 音声なし
    args.push('output.webp');

    await ffmpeg.exec(args);

    // 結果読み取り
    const data = await ffmpeg.readFile('output.webp');
    const blob = new Blob([data.buffer], { type: 'image/webp' });

    setBusy(false);
    updateProgress(100);
    showSuccess(blob);

    // クリーンアップ
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile('output.webp');
  } catch (err) {
    setBusy(false);
    showError('変換に失敗しました。\n' + err.message);
  }
});

// ==========================================================================
// UI ヘルパー
// ==========================================================================
function setBusy(busy) {
  el('convertBtn').disabled = busy;
  el('convertBtn').textContent = busy ? '変換中…' : 'WebP に変換';
  progress.classList.toggle('show', busy);
}

function updateProgress(pct) {
  el('progressBar').style.width = pct + '%';
  el('progressLabel').textContent = `変換中… ${pct}%`;
}

function showSuccess(blob) {
  progress.classList.remove('show');
  result.className = 'result ok show';
  el('resultHead').textContent = '✓ 変換できました';
  el('resultDetail').textContent = `サイズ: ${fmtSize(blob.size)}`;

  const btns = el('resultBtns');
  btns.innerHTML = '';

  // ダウンロードボタン
  const dl = document.createElement('button');
  dl.className = 'primary';
  dl.textContent = 'ダウンロード';
  dl.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentFile.name.replace(/\.\w+$/, '') + '.webp';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  btns.appendChild(dl);

  // もう一度ボタン
  const again = document.createElement('button');
  again.textContent = 'もう一度';
  again.onclick = () => {
    hideResult();
    resultPreview.classList.remove('show');
  };
  btns.appendChild(again);

  // 結果画像プレビュー
  const imgUrl = URL.createObjectURL(blob);
  el('resultImg').src = imgUrl;
  resultPreview.classList.add('show');
}

function showError(message) {
  progress.classList.remove('show');
  result.className = 'result err show';
  el('resultHead').textContent = 'エラー';
  el('resultDetail').textContent = message;
  el('resultBtns').innerHTML = '';
}

function hideResult() {
  result.className = 'result';
}
