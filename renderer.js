// ==========================================================================
// renderer.js  ―― 画面の動きを担当。ドロップの受付、設定の読み取り、
//   変換の呼び出し、進捗・結果の表示を行います。
// ==========================================================================

// いま読み込んでいるファイルの情報
let currentFile = null; // { path, name, width, height, duration }

// 画面部品をまとめて取得
const el = (id) => document.getElementById(id);
const dropZone = el('dropZone');
const fileInput = el('fileInput');
const fileInfo = el('fileInfo');
const panel = el('panel');
const progress = el('progress');
const result = el('result');

// ---- 秒を "1分23.4秒" のような表示に整える ----
function fmtDuration(sec) {
  if (!sec) return '0秒';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// ==========================================================================
// ドラッグ&ドロップの受付
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
    // ウィンドウの外に出たとき / ドロップしたときに枠の強調を戻す
    if (ev === 'drop' || e.relatedTarget === null) {
      dropZone.classList.remove('drag-over');
    }
  })
);

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files || []);
  const valid = files.find((f) => /\.(mp4|mov)$/i.test(f.name));
  if (!valid) {
    showError('MP4 または MOV ファイルをドロップしてください。');
    return;
  }
  loadFile(valid);
});

// クリックでファイルを選ぶ
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

// ==========================================================================
// ファイルを読み込んで情報を表示
// ==========================================================================
async function loadFile(file) {
  hideResult();
  const filePath = window.api.getPathForFile(file);
  try {
    const meta = await window.api.probe(filePath);
    currentFile = { path: filePath, name: file.name, ...meta };

    el('fiName').textContent = file.name;
    el('fiMeta').textContent =
      `${meta.width}×${meta.height} px ・ 長さ ${fmtDuration(meta.duration)}`;
    fileInfo.classList.add('show');

    // 設定の初期値を元動画に合わせる
    el('width').value = meta.width || 480;
    el('start').value = 0;
    el('end').value = meta.duration ? meta.duration.toFixed(1) : 0;

    panel.classList.add('show');
  } catch (err) {
    showError('ファイルを読み込めませんでした。\n' + err.message);
  }
}

// ==========================================================================
// 画質スライダーの数値表示
// ==========================================================================
el('quality').addEventListener('input', (e) => {
  el('qualityVal').textContent = e.target.value;
});

// ロスレス時は画質スライダーを無効化
el('lossless').addEventListener('change', (e) => {
  el('quality').disabled = e.target.checked;
});

// ==========================================================================
// 変換ボタン
// ==========================================================================
el('convertBtn').addEventListener('click', async () => {
  if (!currentFile) return;

  const start = parseFloat(el('start').value) || 0;
  const end = parseFloat(el('end').value) || currentFile.duration;
  const duration = Math.max(0.1, end - start);

  if (end <= start) {
    showError('終了位置は開始位置より後にしてください。');
    return;
  }

  const options = {
    filePath: currentFile.path,
    start,
    duration,
    width: parseInt(el('width').value) || currentFile.width,
    fps: parseInt(el('fps').value) || 15,
    quality: parseInt(el('quality').value),
    lossless: el('lossless').checked,
    compression: parseInt(el('compression').value),
  };

  // 変換中のUI
  hideResult();
  setBusy(true);
  updateProgress(0);

  try {
    const res = await window.api.convert(options);
    setBusy(false);
    showSuccess(res.outputPath);
  } catch (err) {
    setBusy(false);
    showError('変換に失敗しました。\n' + err.message);
  }
});

// 進捗の受信
window.api.onProgress((pct) => updateProgress(pct));

// ==========================================================================
// 表示の切り替えヘルパー
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

function showSuccess(outputPath) {
  progress.classList.remove('show');
  result.className = 'result ok show';
  el('resultHead').textContent = '✓ 変換できました';
  el('resultDetail').textContent = outputPath;
  const btns = el('resultBtns');
  btns.innerHTML = '';
  const open = document.createElement('button');
  open.className = 'primary';
  open.textContent = 'フォルダを開く';
  open.onclick = () => window.api.reveal(outputPath);
  btns.appendChild(open);
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
