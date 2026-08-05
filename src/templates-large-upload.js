// 大文件上传网页模板

import {
  formatSize,
  escapeHtml
} from './utils.js'

// 生成大文件提示页面
export function generateLargeUploadMessagePage(title, message) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(135deg, #eef4ff, #f7f9fc); color: #1f2937; }
      .card { width: min(520px, 100%); padding: 30px; border-radius: 18px; background: #fff;
        box-shadow: 0 18px 50px rgba(15, 23, 42, .12); text-align: center; }
      h1 { margin: 0 0 14px; font-size: 24px; }
      p { margin: 0; line-height: 1.7; color: #64748b; }
    </style>
  </head>
  <body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
  </html>`;
}

// 生成大文件上传页面
export function generateLargeUploadPage({
  token,
  categoryOptions,
  statusPayload,
  chunkSizeBytes,
  maxSizeBytes,
  updateTimeMinutes
}) {
  const tokenJson = JSON.stringify(token);
  const statusJson = JSON.stringify(statusPayload).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="机器人专属大文件分片上传页面">
    <title>上传大文件</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; padding: 20px; display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
        color: #172033; background: linear-gradient(135deg, #eef5ff 0%, #f7f9fc 55%, #eaf7f5 100%); }
      .container { width: min(760px, 100%); background: rgba(255,255,255,.97); border-radius: 20px;
        box-shadow: 0 22px 60px rgba(30, 41, 59, .14); padding: clamp(20px, 4vw, 36px); }
      h1 { margin: 0 0 8px; font-size: clamp(25px, 5vw, 34px); }
      .subtitle { margin: 0 0 24px; color: #64748b; line-height: 1.6; }
      .notice { margin-bottom: 20px; padding: 12px 14px; border-radius: 12px; background: #fff7ed;
        color: #9a3412; font-size: 14px; line-height: 1.55; }
      label { display: block; margin-bottom: 8px; font-weight: 650; }
      select, input[type="text"] { width: 100%; height: 46px; border: 1px solid #d7deea; border-radius: 11px;
        padding: 0 13px; background: #fff; font-size: 15px; outline: none; }
      select:focus, input[type="text"]:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.12); }
      .field { margin-bottom: 20px; }
      .upload-area { position: relative; min-height: 180px; border: 2px dashed #9fb0c8; border-radius: 16px;
        display: grid; place-items: center; padding: 24px; text-align: center; background: #f8fafc;
        transition: .2s ease; cursor: pointer; }
      .upload-area.dragover { border-color: #2563eb; background: #eff6ff; transform: translateY(-1px); }
      .upload-area.disabled { opacity: .55; pointer-events: none; }
      .upload-icon { font-size: 38px; margin-bottom: 8px; }
      .upload-title { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
      .upload-hint { color: #64748b; font-size: 14px; line-height: 1.5; }
      #fileInput { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
      .file-card { display: none; margin-top: 16px; padding: 14px; border: 1px solid #dbe4f0;
        border-radius: 13px; background: #fff; }
      .file-name { font-weight: 700; overflow-wrap: anywhere; }
      .file-meta { color: #64748b; font-size: 13px; margin-top: 4px; }
      .progress-wrap { display: none; margin-top: 20px; }
      .progress-head { display: flex; justify-content: space-between; gap: 14px; margin-bottom: 8px; font-size: 14px; }
      .progress-bar { height: 18px; background: #e7edf5; border-radius: 999px; overflow: hidden; }
      .progress-track { height: 100%; width: 0; border-radius: inherit;
        background: linear-gradient(90deg, #2563eb, #06b6d4); transition: width .18s ease; }
      .progress-detail { margin-top: 9px; color: #64748b; font-size: 13px; line-height: 1.55; }
      .status { display: none; margin-top: 18px; padding: 12px 14px; border-radius: 11px; line-height: 1.55; }
      .status.info { display: block; color: #1e40af; background: #eff6ff; }
      .status.error { display: block; color: #991b1b; background: #fef2f2; }
      .status.success { display: block; color: #166534; background: #f0fdf4; }
      .result { margin-top: 24px; }
      .result-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
      button { height: 46px; border: 0; border-radius: 11px; padding: 0 18px; font-weight: 700; cursor: pointer;
        color: #fff; background: #2563eb; }
      button:disabled { opacity: .55; cursor: not-allowed; }
      .footer { margin-top: 20px; color: #94a3b8; font-size: 12px; line-height: 1.6; text-align: center; }
      @media (max-width: 560px) { .result-row { grid-template-columns: 1fr; } button { width: 100%; } }
    </style>
  </head>
  <body>
    <main class="container">
      <h1>📤 上传大文件</h1>
      <p class="subtitle">机器人专属临时页面 · 浏览器将文件按 ${Math.round(chunkSizeBytes / 1024 / 1024)} MB 分片保存到 Telegram</p>
      <div class="notice">页面在尚未开始上传时有效 ${Number(updateTimeMinutes)} 分钟首个分片成功后不再受该时限影响；关闭页面不会删除已上传分片，完成后机器人也会发送永久直链</div>

      <div class="field">
        <label for="categorySelect">选择分类</label>
        <select id="categorySelect">${categoryOptions || '<option value="">默认分类</option>'}</select>
      </div>

      <div id="uploadArea" class="upload-area">
        <input id="fileInput" type="file">
        <div>
          <div class="upload-icon">☁️</div>
          <div class="upload-title">点击选择文件，或拖放到这里</div>
          <div class="upload-hint">最大允许 ${Math.round(maxSizeBytes / 1024 / 1024)} MB；推荐用于超过 20 MB 的文件</div>
        </div>
      </div>

      <div id="fileCard" class="file-card">
        <div id="fileName" class="file-name"></div>
        <div id="fileMeta" class="file-meta"></div>
      </div>

      <section id="progressWrap" class="progress-wrap">
        <div class="progress-head"><span id="progressLabel">准备上传</span><strong id="progressPercent">0%</strong></div>
        <div class="progress-bar"><div id="progressTrack" class="progress-track"></div></div>
        <div id="progressDetail" class="progress-detail"></div>
      </section>

      <div id="statusBox" class="status"></div>

      <section class="result">
        <label for="resultUrl">返回直链</label>
        <div class="result-row">
          <input id="resultUrl" type="text" readonly placeholder="上传完成后将在这里显示直链">
          <button id="copyButton" type="button" disabled>复制直链</button>
        </div>
      </section>
      <div class="footer">临时页面失效或会话记录被清理，不会删除已经生成的文件和直链</div>
    </main>

    <script>
      const TOKEN = ${tokenJson};
      const INITIAL_STATUS = ${statusJson};
      const CHUNK_SIZE = ${Number(chunkSizeBytes)};
      const MAX_SIZE = ${Number(maxSizeBytes)};
      const uploadArea = document.getElementById('uploadArea');
      const fileInput = document.getElementById('fileInput');
      const categorySelect = document.getElementById('categorySelect');
      const fileCard = document.getElementById('fileCard');
      const fileNameEl = document.getElementById('fileName');
      const fileMetaEl = document.getElementById('fileMeta');
      const progressWrap = document.getElementById('progressWrap');
      const progressTrack = document.getElementById('progressTrack');
      const progressPercent = document.getElementById('progressPercent');
      const progressLabel = document.getElementById('progressLabel');
      const progressDetail = document.getElementById('progressDetail');
      const statusBox = document.getElementById('statusBox');
      const resultUrl = document.getElementById('resultUrl');
      const copyButton = document.getElementById('copyButton');
      let busy = false;
      let currentStatus = INITIAL_STATUS;
      let statusPollTimer = null;
      let closeScheduled = false;

      function formatSize(bytes) {
        const value = Number(bytes || 0);
        if (value < 1024) return value + ' B';
        const units = ['KB', 'MB', 'GB', 'TB'];
        let size = value / 1024;
        let index = 0;
        while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
        return size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2) + ' ' + units[index];
      }

      function setStatus(message, type = 'info') {
        statusBox.className = 'status ' + type;
        statusBox.textContent = message;
      }

      function clearStatus() {
        statusBox.className = 'status';
        statusBox.textContent = '';
      }

      function setProgress(percent, label, detail) {
        const safePercent = Math.max(0, Math.min(100, Number(percent || 0)));
        progressWrap.style.display = 'block';
        progressTrack.style.width = safePercent + '%';
        progressPercent.textContent = safePercent.toFixed(safePercent < 100 ? 1 : 0) + '%';
        progressLabel.textContent = label || '正在上传';
        progressDetail.textContent = detail || '';
      }

      function showResult(url) {
        resultUrl.value = url || '';
        copyButton.disabled = !url;
        if (url) {
          uploadArea.classList.add('disabled');
          fileInput.disabled = true;
          categorySelect.disabled = true;
          stopStatusPolling();
        }
      }

      function stopStatusPolling() {
        if (statusPollTimer) {
          clearInterval(statusPollTimer);
          statusPollTimer = null;
        }
      }

      function closeCancelledPage() {
        if (closeScheduled) return;
        closeScheduled = true;
        stopStatusPolling();
        uploadArea.classList.add('disabled');
        fileInput.disabled = true;
        categorySelect.disabled = true;
        setTimeout(() => {
          try {
            if (
              window.Telegram &&
              window.Telegram.WebApp &&
              typeof window.Telegram.WebApp.close === 'function'
            ) {
              window.Telegram.WebApp.close();
            }
          } catch (_) {}

          try { window.close(); } catch (_) {}
          setTimeout(() => {
            try {
              if (history.length > 1) {
                history.back();
                return;
              }
            } catch (_) {}
            document.body.innerHTML =
              '<main style="font-family:sans-serif;padding:32px;text-align:center">' +
              '<h2>上传任务已取消</h2><p>该页面已关闭，请返回 Telegram</p></main>';
          }, 300);
        }, 1800);
      }

      async function fetchStatus() {
        const response = await fetch('/large-upload/status?token=' + encodeURIComponent(TOKEN), {
          cache: 'no-store'
        });
        const data = await response.json();
        if (!response.ok || !data.status) throw new Error(data.error || '读取上传状态失败');
        currentStatus = data.session;
        return currentStatus;
      }

      function applyStatus(status) {
        if (!status) return;
        if (status.cancelled || status.status === 'cancelled' || status.closePage) {
          const reason = status.error || '两个分片间隔超过 10 分钟，任务已取消，全部分片已删除';
          setProgress(0, '任务已取消', '已清理该任务的全部 Telegram 分片');
          setStatus(reason + ' 页面即将关闭', 'error');
          closeCancelledPage();
          return;
        }
        if (status.resultUrl) {
          showResult(status.resultUrl);
          setProgress(100, '上传完成', '直链已经生成，并已发送到机器人');
          setStatus('上传完成，可以复制直链', 'success');
          return;
        }
        if (status.fileName) {
          fileCard.style.display = 'block';
          fileNameEl.textContent = status.fileName;
          fileMetaEl.textContent = formatSize(status.fileSize) + ' · 已完成 ' + status.uploadedChunks + '/' + status.totalChunks + ' 个分片';
        }
        if (status.status === 'uploading' || status.status === 'finalizing') {
          setProgress(status.progress, status.status === 'finalizing' ? '正在生成直链' : '已有上传进度',
            formatSize(status.uploadedBytes) + ' / ' + formatSize(status.fileSize));
          const deadlineText = status.chunkDeadlineAt
            ? '下一片须在 ' + new Date(status.chunkDeadlineAt).toLocaleTimeString() + ' 前完成'
            : '';
          setStatus(
            '页面关闭不会立即删除分片；若相邻分片超过 10 分钟，任务将自动取消并清理' + deadlineText,
            'info'
          );
        } else if (status.error) {
          setStatus(status.error, 'error');
        }
      }

      function uploadChunkWithProgress(formData, baseBytes, fileSize, chunkIndex, totalChunks) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/large-upload/chunk?token=' + encodeURIComponent(TOKEN));
          xhr.responseType = 'json';
          xhr.upload.onprogress = event => {
            if (!event.lengthComputable) return;
            const uploaded = Math.min(fileSize, baseBytes + event.loaded);
            const percent = uploaded / fileSize * 100;
            setProgress(percent, '正在上传第 ' + (chunkIndex + 1) + '/' + totalChunks + ' 片',
              formatSize(uploaded) + ' / ' + formatSize(fileSize));
          };
          xhr.onload = () => {
            const data = xhr.response || {};
            if (xhr.status >= 200 && xhr.status < 300 && data.status) {
              resolve(data);
            } else {
              if (data.cancelled || data.closePage || xhr.status === 410) {
                applyStatus({ status: 'cancelled', cancelled: true, closePage: true, error: data.error });
              }
              reject(new Error(data.error || '分片上传失败（HTTP ' + xhr.status + '）'));
            }
          };
          xhr.onerror = () => reject(new Error('网络连接中断'));
          xhr.send(formData);
        });
      }

      async function uploadFile(file) {
        if (busy) return;
        if (!file) return;
        if (file.size <= 0) return setStatus('文件为空，无法上传', 'error');
        if (file.size > MAX_SIZE) return setStatus('文件超过最大限制：' + formatSize(MAX_SIZE), 'error');
        busy = true;
        clearStatus();
        uploadArea.classList.add('disabled');
        fileInput.disabled = true;
        categorySelect.disabled = true;
        fileCard.style.display = 'block';
        fileNameEl.textContent = file.name;
        fileMetaEl.textContent = formatSize(file.size) + ' · ' + (file.type || 'application/octet-stream');

        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const startTime = Date.now();
        try {
          const latest = await fetchStatus();
          if (latest.resultUrl) {
            applyStatus(latest);
            return;
          }
          if (latest.fileName && (latest.fileName !== file.name || Number(latest.fileSize) !== Number(file.size))) {
            throw new Error('该页面已有另一个文件的上传进度，请重新从机器人生成页面');
          }
          const completed = new Set((latest.uploadedIndexes || []).map(Number));
          let uploadedBytes = Number(latest.uploadedBytes || 0);

          for (let index = 0; index < totalChunks; index++) {
            if (completed.has(index)) continue;
            const start = index * CHUNK_SIZE;
            const end = Math.min(file.size, start + CHUNK_SIZE);
            const chunk = file.slice(start, end);
            const formData = new FormData();
            formData.append('token', TOKEN);
            formData.append('chunk', chunk, file.name + '.part' + String(index + 1).padStart(5, '0'));
            formData.append('chunk_index', String(index));
            formData.append('total_chunks', String(totalChunks));
            formData.append('file_name', file.name);
            formData.append('file_size', String(file.size));
            formData.append('mime_type', file.type || 'application/octet-stream');
            formData.append('category', categorySelect.value || '');

            const result = await uploadChunkWithProgress(
              formData,
              uploadedBytes,
              file.size,
              index,
              totalChunks
            );
            uploadedBytes = Number(result.uploadedBytes || end);
            const elapsedSeconds = Math.max(1, (Date.now() - startTime) / 1000);
            const speed = uploadedBytes / elapsedSeconds;
            setProgress(result.progress, '已完成 ' + result.uploadedChunks + '/' + totalChunks + ' 个分片',
              formatSize(uploadedBytes) + ' / ' + formatSize(file.size) + ' · ' + formatSize(speed) + '/s');
          }

          setProgress(99.8, '正在校验分片并生成直链', '请勿关闭页面');
          const completeResponse = await fetch('/large-upload/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: TOKEN })
          });
          const completeData = await completeResponse.json();
          if (!completeResponse.ok || !completeData.status) {
            throw new Error(completeData.error || '生成直链失败');
          }
          showResult(completeData.url);
          setProgress(100, '上传完成', '共 ' + completeData.chunkCount + ' 个分片');
          setStatus('上传完成，直链已生成，同时已发送到机器人', 'success');
        } catch (error) {
          setStatus(error.message || '上传失败', 'error');
          const latest = await fetchStatus().catch(() => null);
          if (latest) applyStatus(latest);
        } finally {
          busy = false;
          if (!resultUrl.value && !closeScheduled) {
            uploadArea.classList.remove('disabled');
            fileInput.disabled = false;
            categorySelect.disabled = false;
          }
        }
      }

      fileInput.addEventListener('change', event => uploadFile(event.target.files && event.target.files[0]));
      ['dragenter', 'dragover'].forEach(name => uploadArea.addEventListener(name, event => {
        event.preventDefault();
        if (!busy) uploadArea.classList.add('dragover');
      }));
      ['dragleave', 'drop'].forEach(name => uploadArea.addEventListener(name, event => {
        event.preventDefault();
        uploadArea.classList.remove('dragover');
      }));
      uploadArea.addEventListener('drop', event => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) uploadFile(file);
      });
      copyButton.addEventListener('click', async () => {
        if (!resultUrl.value) return;
        try {
          await navigator.clipboard.writeText(resultUrl.value);
          copyButton.textContent = '已复制';
          setTimeout(() => { copyButton.textContent = '复制直链'; }, 1200);
        } catch (_) {
          resultUrl.select();
          document.execCommand('copy');
        }
      });

      applyStatus(INITIAL_STATUS);
      if (!INITIAL_STATUS.resultUrl && !INITIAL_STATUS.cancelled) {
        statusPollTimer = setInterval(async () => {
          try {
            const latest = await fetchStatus();
            applyStatus(latest);
          } catch (_) {
          }
        }, 5000);
      }
    </script>
  </body>
  </html>`;
}
