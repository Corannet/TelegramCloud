// 管理端上传网页模板

import {
  formatSize
} from './utils.js'

// 生成管理端上传页面
export function generateUploadPage(categoryOptions, storageType) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <link rel="shortcut icon" href="https://tc-212.pages.dev/1744302340226.ico" type="image/x-icon">
    <meta name="description" content="Telegram文件存储与分享平台">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件上传</title>
    <style>
      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        margin: 0;
        padding: 0;
        min-height: 100vh;
        background: linear-gradient(135deg, #f0f4f8, #d9e2ec);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .container {
        max-width: 900px;
        width: 100%;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 15px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        padding: 2rem;
        margin: 20px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
      }
      h1 {
        color: #2c3e50;
        margin: 0;
        font-size: 1.8rem;
        font-weight: 600;
      }
      .admin-link {
        color: #3498db;
        text-decoration: none;
        font-size: 1rem;
        transition: color 0.3s ease;
      }
      .admin-link:hover {
        color: #2980b9;
      }
      .options {
        display: flex;
        gap: 1rem;
        margin-bottom: 1.5rem;
        flex-wrap: wrap;
      }
      .category-select, .new-category input {
        padding: 0.8rem;
        border: 2px solid #dfe6e9;
        border-radius: 8px;
        font-size: 1rem;
        background: #fff;
        transition: border-color 0.3s ease, box-shadow 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
      }
      .category-select:focus, .new-category input:focus {
        outline: none;
        border-color: #3498db;
        box-shadow: 0 0 8px rgba(52,152,219,0.3);
      }
      .new-category {
        display: flex;
        gap: 1rem;
        align-items: center;
      }
      .new-category button {
        padding: 0.8rem 1.5rem;
        background: #2ecc71;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.3s ease, transform 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      }
      .new-category button:hover {
        background: #27ae60;
        transform: translateY(-2px);
      }
      .storage-toggle {
        display: flex;
        gap: 0.5rem;
      }
      .storage-btn {
        padding: 0.8rem 1.5rem;
        border: 2px solid #dfe6e9;
        border-radius: 8px;
        background: #fff;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
      }
      .storage-btn.active {
        background: #3498db;
        color: white;
        border-color: #3498db;
      }
      .storage-btn:hover:not(.active) {
        background: #ecf0f1;
        transform: translateY(-2px);
      }
      .upload-area {
        border: 2px dashed #b2bec3;
        padding: 2rem;
        text-align: center;
        margin-bottom: 1.5rem;
        border-radius: 10px;
        background: #fff;
        transition: all 0.3s ease;
        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
      }
      .upload-area.dragover {
        border-color: #3498db;
        background: #f8f9fa;
        box-shadow: 0 0 15px rgba(52,152,219,0.2);
      }
      .upload-area p {
        margin: 0;
        color: #7f8c8d;
        font-size: 1.1rem;
      }
      .preview-area {
        margin-top: 1rem;
      }
      .preview-item {
        display: flex;
        align-items: center;
        padding: 1rem;
        background: #fff;
        border-radius: 8px;
        margin-bottom: 1rem;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        transition: transform 0.3s ease;
      }
      .preview-item:hover {
        transform: translateY(-2px);
      }
      .preview-item img {
        max-width: 100px;
        max-height: 100px;
        margin-right: 1rem;
        border-radius: 5px;
      }
      .preview-item .info {
        flex-grow: 1;
        color: #2c3e50;
      }
      .progress-bar {
        height: 20px;
        background: #ecf0f1;
        border-radius: 10px;
        margin: 8px 0;
        overflow: hidden;
        position: relative;
      }
      .progress-track {
        height: 100%;
        background: #3498db;
        transition: width 0.3s ease;
        width: 0;
      }
      .progress-text {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        color: #fff;
        font-size: 12px;
      }
      .success .progress-track {
        background: #2ecc71;
      }
      .error .progress-track {
        background: #e74c3c;
      }
      .url-area {
        margin-top: 1.5rem;
      }
      .url-area textarea {
        width: 100%;
        min-height: 100px;
        padding: 0.8rem;
        border: 2px solid #dfe6e9;
        border-radius: 8px;
        background: #fff;
        font-size: 0.9rem;
        resize: vertical;
        transition: border-color 0.3s ease;
      }
      .url-area textarea:focus {
        outline: none;
        border-color: #3498db;
      }
      .button-group {
        margin-top: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
      }
      .button-container button {
        padding: 0.7rem 1.2rem;
        border: none;
        border-radius: 8px;
        background: #3498db;
        color: white;
        cursor: pointer;
        transition: background 0.3s ease, transform 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      }
      .button-container button:hover {
        background: #2980b9;
        transform: translateY(-2px);
      }
      .copyright {
        font-size: 0.8rem;
        color: #7f8c8d;
      }
      .copyright a {
        color: #3498db;
        text-decoration: none;
      }
      .copyright a:hover {
        text-decoration: underline;
      }
      .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        justify-content: center;
        align-items: center;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .modal.show {
        display: flex;
        opacity: 1;
      }
      .modal-content {
        background: white;
        padding: 2rem;
        border-radius: 15px;
        box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        text-align: center;
        width: 90%;
        max-width: 400px;
        transform: scale(0.9);
        transition: transform 0.3s ease;
      }
      .modal.show .modal-content {
        transform: scale(1);
      }
      .modal-title {
        color: #2c3e50;
        font-size: 1.3rem;
        margin-top: 0;
        margin-bottom: 1rem;
      }
      .modal-message {
        margin-bottom: 1.5rem;
        color: #34495e;
        line-height: 1.5;
      }
      .modal-buttons {
        display: flex;
        gap: 1rem;
        justify-content: center;
      }
      .modal-button {
        padding: 0.8rem 1.8rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        font-size: 0.95rem;
        font-weight: 500;
      }
      .modal-confirm {
        background: #3498db;
        color: white;
      }
      .modal-cancel {
        background: #95a5a6;
        color: white;
      }
      .modal-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      }
      .modal-confirm:hover {
        background: #2980b9;
      }
      .modal-cancel:hover {
        background: #7f8c8d;
      }
      @media (max-width: 768px) {
        body {
          padding: 10px;
          align-items: flex-start;
        }
        .container {
          padding: 1rem;
          margin: 10px;
        }
        .header {
          flex-direction: column;
          align-items: flex-start;
          gap: 10px;
        }
        .options {
          flex-direction: column;
          align-items: stretch;
        }
        .new-category {
           flex-direction: column;
           align-items: stretch;
           width: 100%;
        }
        .new-category input {
           width: auto;
        }
        .storage-toggle {
           justify-content: center;
        }
        .upload-area p {
           font-size: 1rem;
        }
        .button-group {
          flex-direction: column;
          align-items: stretch;
          gap: 0.5rem;
        }
        .button-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          justify-content: center;
        }
        .button-container button {
          flex-grow: 1;
        }
        .copyright {
           text-align: center;
           margin-top: 1rem;
        }
        .modal-content {
           padding: 1.5rem;
        }
      }
      @media (max-width: 480px) {
        .storage-btn {
           padding: 0.6rem 1rem;
           font-size: 0.9rem;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>文件上传</h1>
        <a href="/admin" class="admin-link">管理文件</a>
      </div>
      <div class="options">
        <select id="categorySelect" class="category-select">
          <option value="">选择分类</option>
          ${categoryOptions}
        </select>
        <div class="new-category">
          <input type="text" id="newCategoryInput" placeholder="输入新分类名称">
          <button onclick="createNewCategory()">新建分类</button>
        </div>
        <div class="storage-toggle">
          <button class="storage-btn ${storageType === 'telegram' ? 'active' : ''}" data-storage="telegram">Telegram</button>
          <button class="storage-btn ${storageType === 'r2' ? 'active' : ''}" data-storage="r2">R2</button>
        </div>
      </div>
      <div class="upload-area" id="uploadArea">
        <p>点击选择 或 拖拽文件到此处</p>
        <input type="file" id="fileInput" multiple style="display: none">
      </div>
      <div class="preview-area" id="previewArea"></div>
      <div class="url-area">
        <textarea id="urlArea" readonly placeholder="上传完成后的链接将显示在这里"></textarea>
        <div class="button-group">
          <div class="button-container">
            <button onclick="copyUrls('url')">复制URL</button>
            <button onclick="copyUrls('markdown')">复制Markdown</button>
            <button onclick="copyUrls('html')">复制HTML</button>
          </div>
          <div class="copyright">
            <span>© 2025 Copyright by <a href="https://github.com/iawooo/cftc" target="_blank">AWEI's GitHub</a> | <a href="https://awei.nyc.mn/" target="_blank">AWEI</a></span>
          </div>
        </div>
      </div>
      
      <div id="confirmModal" class="modal">
        <div class="modal-content">
          <h3 class="modal-title">提示</h3>
          <p class="modal-message" id="confirmModalMessage"></p>
          <div class="modal-buttons">
            <button class="modal-button modal-confirm" id="confirmModalConfirm">确认</button>
            <button class="modal-button modal-cancel" id="confirmModalCancel">取消</button>
          </div>
        </div>
      </div>
    </div>
    <script>
      async function setBingBackground() {
        try {
          const response = await fetch('/bing', { cache: 'no-store' });
          const data = await response.json();
          if (data.status && data.data && data.data.length > 0) {
            const randomIndex = Math.floor(Math.random() * data.data.length);
            document.body.style.backgroundImage = \`url(\${data.data[randomIndex].url})\`;
          }
        } catch (error) {
          console.error('获取背景图失败:', error);
        }
      }
      setBingBackground();
      setInterval(setBingBackground, 3600000);
      const uploadArea = document.getElementById('uploadArea');
      const fileInput = document.getElementById('fileInput');
      const previewArea = document.getElementById('previewArea');
      const urlArea = document.getElementById('urlArea');
      const categorySelect = document.getElementById('categorySelect');
      const newCategoryInput = document.getElementById('newCategoryInput');
      const storageButtons = document.querySelectorAll('.storage-btn');
      const confirmModal = document.getElementById('confirmModal');
      const confirmModalMessage = document.getElementById('confirmModalMessage');
      const confirmModalConfirm = document.getElementById('confirmModalConfirm');
      const confirmModalCancel = document.getElementById('confirmModalCancel');
      let uploadedUrls = [];
      let currentConfirmCallback = null;
      storageButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          storageButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
      async function createNewCategory() {
        const categoryName = newCategoryInput.value.trim();
        if (!categoryName) {
          showConfirmModal('分类名称不能为空！', null, true);
          return;
        }
        try {
          const response = await fetch('/create-category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: categoryName })
          });
          const data = await response.json();
          if (data.status === 1) {
            const option = document.createElement('option');
            option.value = data.category.id;
            option.textContent = data.category.name;
            categorySelect.appendChild(option);
            categorySelect.value = data.category.id;
            newCategoryInput.value = '';
            showConfirmModal(data.msg, null, true);
          } else {
            showConfirmModal(data.msg, null, true);
          }
        } catch (error) {
          showConfirmModal('创建分类失败：' + error.message, null, true);
        }
      }
      function showConfirmModal(message, callback, alertOnly = false) {
        closeConfirmModal();
        confirmModalMessage.textContent = message;
        currentConfirmCallback = callback;
        if (alertOnly) {
          confirmModalConfirm.textContent = '确定';
          confirmModalCancel.style.display = 'none';
        } else {
          confirmModalConfirm.textContent = '确认';
          confirmModalCancel.style.display = 'inline-block';
        }
        confirmModal.classList.add('show');
      }
      function closeConfirmModal() {
        confirmModal.classList.remove('show');
      }
      confirmModalConfirm.addEventListener('click', () => {
        if (currentConfirmCallback) {
          currentConfirmCallback();
        }
        closeConfirmModal();
      });
      confirmModalCancel.addEventListener('click', closeConfirmModal);
      window.addEventListener('click', (event) => {
        if (confirmModal && event.target === confirmModal) {
          closeConfirmModal();
        }
      });
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
      });
      function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
      }
      ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, highlight, false);
      });
      ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, unhighlight, false);
      });
      function highlight(e) {
        uploadArea.classList.add('dragover');
      }
      function unhighlight(e) {
        uploadArea.classList.remove('dragover');
      }
      uploadArea.addEventListener('drop', handleDrop, false);
      uploadArea.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', handleFiles);
      function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles({ target: { files } });
      }
      document.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
          if (item.kind === 'file') {
            const file = item.getAsFile();
            await uploadFile(file);
          }
        }
      });
      let runtimeConfigPromise = null;
      function getRuntimeConfig() {
        if (!runtimeConfigPromise) {
          runtimeConfigPromise = fetch('/config', { cache: 'no-store' }).then(async response => {
            if (!response.ok) throw new Error('读取上传配置失败');
            return response.json();
          });
        }
        return runtimeConfigPromise;
      }
      async function handleFiles(e) {
        const config = await getRuntimeConfig();
        const files = Array.from(e.target.files || []);
        for (const file of files) {
          if (file.size > config.maxSizeMB * 1024 * 1024) {
            showConfirmModal('文件超过' + config.maxSizeMB + 'MB限制', null, true);
            continue;
          }
          await uploadFile(file, config);
        }
      }
      async function uploadFile(file, runtimeConfig = null) {
        const config = runtimeConfig || await getRuntimeConfig();
        const preview = createPreview(file);
        previewArea.appendChild(preview);
        const storageType = document.querySelector('.storage-btn.active').dataset.storage;
        try {
          let data;
          if (
            storageType === 'telegram' &&
            file.size > config.telegramChunkSizeMB * 1024 * 1024
          ) {
            data = await uploadFileInChunks(file, preview, config);
          } else {
            data = await uploadFileDirect(file, preview, storageType);
          }
          if (!data || data.status !== 1) {
            throw new Error((data && (data.error || data.msg)) || '上传失败');
          }
          const progressTrack = preview.querySelector('.progress-track');
          const progressText = preview.querySelector('.progress-text');
          progressTrack.style.width = '100%';
          progressText.textContent = data.msg || '✔ 上传成功';
          uploadedUrls.push(data.url);
          updateUrlArea();
          preview.classList.add('success');
        } catch (error) {
          preview.querySelector('.progress-text').textContent = '✗ ' + error.message;
          preview.classList.add('error');
        }
      }
      function uploadFileDirect(file, preview, storageType) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const progressTrack = preview.querySelector('.progress-track');
          const progressText = preview.querySelector('.progress-text');
          xhr.upload.addEventListener('progress', event => {
            if (!event.lengthComputable) return;
            const percent = Math.round(event.loaded / event.total * 100);
            progressTrack.style.width = percent + '%';
            progressText.textContent = percent + '%';
          });
          xhr.addEventListener('load', () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(data.error || data.msg || ('HTTP ' + xhr.status)));
                return;
              }
              resolve(data);
            } catch (error) {
              reject(new Error('响应解析失败'));
            }
          });
          xhr.addEventListener('error', () => reject(new Error('网络错误')));
          const formData = new FormData();
          formData.append('file', file);
          formData.append('category', categorySelect.value);
          formData.append('storage_type', storageType);
          xhr.open('POST', '/upload');
          xhr.send(formData);
        });
      }
      function createUploadId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID().replace(/-/g, '_');
        }
        const random = Math.random().toString(36).slice(2);
        return Date.now().toString(36) + '_' + random + '_' + Math.random().toString(36).slice(2);
      }
      function uploadChunkRequest(formData, preview, completedBytes, fileSize) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const progressTrack = preview.querySelector('.progress-track');
          const progressText = preview.querySelector('.progress-text');
          xhr.upload.addEventListener('progress', event => {
            if (!event.lengthComputable) return;
            const loaded = Math.min(fileSize, completedBytes + event.loaded);
            const percent = Math.floor(loaded / fileSize * 100);
            progressTrack.style.width = percent + '%';
            progressText.textContent = '分片上传 ' + percent + '%';
          });
          xhr.addEventListener('load', () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status < 200 || xhr.status >= 300 || data.status !== 1) {
                reject(new Error(data.error || ('分片上传失败 HTTP ' + xhr.status)));
                return;
              }
              resolve(data);
            } catch (_) {
              reject(new Error('分片响应解析失败'));
            }
          });
          xhr.addEventListener('error', () => reject(new Error('分片上传网络错误')));
          xhr.open('POST', '/upload-chunk');
          xhr.send(formData);
        });
      }
      async function uploadFileInChunks(file, preview, config) {
        const chunkSize = config.telegramChunkSizeMB * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);
        const uploadId = createUploadId();
        const keyParts = file.name.split('.');
        const extension = keyParts.length > 1 ? keyParts.pop().replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : 'bin';
        const key = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + (extension || 'bin');
        let completedBytes = 0;
        try {
          for (let index = 0; index < totalChunks; index++) {
            const start = index * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                const formData = new FormData();
                formData.append('upload_id', uploadId);
                formData.append('chunk_index', String(index));
                formData.append('total_chunks', String(totalChunks));
                formData.append('file_name', file.name);
                formData.append('file_size', String(file.size));
                formData.append('chunk', chunk, file.name + '.part' + String(index + 1).padStart(5, '0'));
                await uploadChunkRequest(formData, preview, completedBytes, file.size);
                lastError = null;
                break;
              } catch (error) {
                lastError = error;
                if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 800));
              }
            }
            if (lastError) throw lastError;
            completedBytes += chunk.size;
          }

          const response = await fetch('/upload-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              upload_id: uploadId,
              file_name: file.name,
              file_size: file.size,
              mime_type: file.type || 'application/octet-stream',
              total_chunks: totalChunks,
              category: categorySelect.value,
              key
            })
          });
          const data = await response.json();
          if (!response.ok || data.status !== 1) {
            throw new Error(data.error || data.msg || '合并分片失败');
          }
          return data;
        } catch (error) {
          fetch('/upload-abort', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_id: uploadId })
          }).catch(() => {});
          throw error;
        }
      }
      function createPreview(file) {
        const div = document.createElement('div');
        div.className = 'preview-item';
        if (file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          div.appendChild(img);
        }
        const info = document.createElement('div');
        info.className = 'info';
        info.innerHTML = \`
          <div>\${file.name}</div>
          <div>\${formatSize(file.size)}</div>
          <div class="progress-bar">
            <div class="progress-track"></div>
            <span class="progress-text">0%</span>
          </div>
        \`;
        div.appendChild(info);
        return div;
      }
      function formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
          size /= 1024;
          unitIndex++;
        }
        return \`\${size.toFixed(2)} \${units[unitIndex]}\`;
      }
      function updateUrlArea() {
        urlArea.value = uploadedUrls.join('\\n');
      }
      function copyUrls(format) {
        let text = '';
        switch (format) {
          case 'url':
            text = uploadedUrls.join('\\n');
            break;
          case 'markdown':
            text = uploadedUrls.map(url => \`![](\${url})\`).join('\\n');
            break;
          case 'html':
            text = uploadedUrls.map(url => \`<img src="\${url}" />\`).join('\\n');
            break;
        }
        navigator.clipboard.writeText(text)
          .then(() => {
            showConfirmModal('已复制到剪贴板', null, true);
          })
          .catch(() => {
            showConfirmModal('复制失败，请手动复制', null, true);
          });
      }
    </script>
  </body>
  </html>`;
}
