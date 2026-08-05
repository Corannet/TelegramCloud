// 独立上传网页模板

import {
  getTelegramChunkSizeBytes
} from './storage.js'

import {
  normalizeUploadPageAllowedTypes
} from './upload-page-types.js'

import {
  formatSize,
  escapeHtml
} from './utils.js'

// 生成上传网页管理页面
export function generateUploadPageManagementPage(globalMaxSizeMB) {
  const safeGlobalMax = Math.max(1, Math.floor(Number(globalMaxSizeMB) || 1024));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>上传网页管理</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:24px;font-family:Arial,"Microsoft YaHei",sans-serif;background:#f2f5f8;color:#243447}
    .container{max-width:1100px;margin:0 auto}
    .header,.panel{background:#fff;border-radius:14px;box-shadow:0 8px 28px rgba(15,35,55,.08);padding:22px;margin-bottom:20px}
    .header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
    h1,h2{margin:0}h1{font-size:28px}h2{font-size:20px;margin-bottom:18px}
    .nav{display:flex;gap:10px;flex-wrap:wrap}.nav a{color:#fff;text-decoration:none;padding:10px 15px;border-radius:8px;background:#3498db}.nav a.secondary{background:#6c7a89}
    .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    label{display:block;font-weight:700;margin-bottom:7px}
    input{width:100%;padding:11px 12px;border:1px solid #ccd5df;border-radius:8px;font-size:15px}
    .full{grid-column:1/-1}.types{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .type-item{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #dce3ea;border-radius:8px;background:#fafcfd}.type-item input{width:auto}
    .actions{margin-top:18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    button{border:0;border-radius:8px;padding:11px 16px;font-size:15px;cursor:pointer;color:#fff;background:#27ae60}button:disabled{opacity:.55;cursor:not-allowed}
    .message{min-height:24px;margin-top:12px}.message.error{color:#c0392b}.message.ok{color:#1e8449}
    .list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
    .card{border:1px solid #e2e8ef;border-radius:12px;padding:17px;background:#fff}.card h3{margin:0 0 10px;font-size:18px}.meta{font-size:14px;color:#5f6f7f;line-height:1.8;word-break:break-all}.url{margin:10px 0;padding:9px;background:#f4f7f9;border-radius:7px;color:#2980b9;word-break:break-all}
    .card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.card-actions a,.card-actions button{padding:8px 12px;font-size:14px;text-decoration:none;color:#fff;border-radius:7px;background:#3498db}.card-actions .copy{background:#7f8c8d}.card-actions .delete{background:#e74c3c}
    .empty{text-align:center;color:#718096;padding:30px}
    @media(max-width:700px){body{padding:12px}.form-grid{grid-template-columns:1fr}.types{grid-template-columns:repeat(2,minmax(0,1fr))}.header{align-items:flex-start}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>上传网页管理</h1>
      <div class="nav">
        <a href="/users" class="secondary">用户管理</a>
        <a href="/admin">文件管理</a>
      </div>
    </div>
    <div class="panel">
      <h2>创建上传网页</h2>
      <div class="form-grid">
        <div>
          <label for="title">网页名称</label>
          <input id="title" maxlength="80" value="上传页面">
        </div>
        <div>
          <label for="maxSize">单文件大小上限 MB</label>
          <input id="maxSize" type="number" min="1" max="${safeGlobalMax}" value="${Math.min(20, safeGlobalMax)}">
        </div>
        <div>
          <label for="slug">自定义链接标识</label>
          <input id="slug" minlength="3" maxlength="50" placeholder="留空时自动生成">
        </div>
        <div>
          <label for="randomLength">随机标识长度</label>
          <input id="randomLength" type="number" min="3" max="50" value="8">
        </div>
        <div class="full">
          <label>允许上传的文件类型</label>
          <div class="types">
            <label class="type-item"><input type="checkbox" name="allowedType" value="image" checked>图片</label>
            <label class="type-item"><input type="checkbox" name="allowedType" value="video" checked>视频</label>
            <label class="type-item"><input type="checkbox" name="allowedType" value="audio" checked>音频</label>
            <label class="type-item"><input type="checkbox" name="allowedType" value="document" checked>文档</label>
            <label class="type-item"><input type="checkbox" name="allowedType" value="archive" checked>压缩包</label>
            <label class="type-item"><input type="checkbox" name="allowedType" value="other" checked>其他</label>
          </div>
        </div>
      </div>
      <div class="actions">
        <button id="createButton" type="button">创建网页</button>
        <span>链接格式为当前域名加 updata 路径</span>
      </div>
      <div id="message" class="message"></div>
    </div>
    <div class="panel">
      <h2>已创建网页</h2>
      <div id="pageList" class="list"><div class="empty">正在加载</div></div>
    </div>
  </div>
  <script>
    const globalMaxSize = ${safeGlobalMax};
    const typeNames = {image:'图片',video:'视频',audio:'音频',document:'文档',archive:'压缩包',other:'其他'};
    const message = document.getElementById('message');
    const pageList = document.getElementById('pageList');
    const createButton = document.getElementById('createButton');

    function showMessage(text, isError) {
      message.textContent = text || '';
      message.className = 'message ' + (isError ? 'error' : 'ok');
    }

    async function requestJson(url, options) {
      const response = await fetch(url, options || {});
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok || !data.status) throw new Error(data.error || '请求失败');
      return data;
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        showMessage('链接已复制', false);
      } catch (_) {
        window.prompt('请复制链接', text);
      }
    }

    function renderPages(pages) {
      pageList.innerHTML = '';
      if (!pages.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '暂未创建上传网页';
        pageList.appendChild(empty);
        return;
      }
      pages.forEach(function(page) {
        const card = document.createElement('div');
        card.className = 'card';
        const title = document.createElement('h3');
        title.textContent = page.title;
        const meta = document.createElement('div');
        meta.className = 'meta';
        const types = (page.allowed_types || []).map(function(value){ return typeNames[value] || value; }).join('、');
        meta.textContent = '大小上限 ' + page.max_size_mb + 'MB  文件数量 ' + page.file_count + '  类型 ' + types;
        const url = document.createElement('div');
        url.className = 'url';
        url.textContent = page.url;
        const actions = document.createElement('div');
        actions.className = 'card-actions';
        const open = document.createElement('a');
        open.href = page.url;
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = '打开';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'copy';
        copy.textContent = '复制链接';
        copy.addEventListener('click', function(){ copyText(page.url); });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete';
        del.textContent = '删除网页';
        del.addEventListener('click', async function(){
          if (!window.confirm('确认删除该上传网页吗\n已生成的文件直链不会被删除')) return;
          del.disabled = true;
          try {
            await requestJson('/api/upload-pages/delete', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({id: page.id})
            });
            showMessage('上传网页已删除', false);
            await loadPages();
          } catch (error) {
            showMessage(error.message, true);
          } finally {
            del.disabled = false;
          }
        });
        actions.append(open, copy, del);
        card.append(title, meta, url, actions);
        pageList.appendChild(card);
      });
    }

    async function loadPages() {
      try {
        const data = await requestJson('/api/upload-pages');
        renderPages(data.pages || []);
      } catch (error) {
        pageList.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = error.message;
        pageList.appendChild(empty);
      }
    }

    createButton.addEventListener('click', async function(){
      const allowedTypes = Array.from(document.querySelectorAll('input[name="allowedType"]:checked')).map(function(input){ return input.value; });
      if (!allowedTypes.length) {
        showMessage('至少选择一种文件类型', true);
        return;
      }
      const maxSize = Number(document.getElementById('maxSize').value);
      if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > globalMaxSize) {
        showMessage('文件大小上限无效', true);
        return;
      }
      createButton.disabled = true;
      try {
        const data = await requestJson('/api/upload-pages/create', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            title: document.getElementById('title').value,
            slug: document.getElementById('slug').value,
            random_length: Number(document.getElementById('randomLength').value),
            max_size_mb: maxSize,
            allowed_types: allowedTypes
          })
        });
        showMessage('创建成功 ' + data.page.url, false);
        document.getElementById('slug').value = '';
        await loadPages();
      } catch (error) {
        showMessage(error.message, true);
      } finally {
        createButton.disabled = false;
      }
    });

    loadPages();
  </script>
</body>
</html>`;
}

// 生成独立上传页面
export function generatePublicUploadPage(page, config) {
  const allowedTypes = normalizeUploadPageAllowedTypes(page.allowed_types);
  const acceptParts = [];
  if (allowedTypes.includes('image')) acceptParts.push('image/*');
  if (allowedTypes.includes('video')) acceptParts.push('video/*');
  if (allowedTypes.includes('audio')) acceptParts.push('audio/*');
  if (allowedTypes.includes('document')) acceptParts.push('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.xml,.rtf');
  if (allowedTypes.includes('archive')) acceptParts.push('.zip,.rar,.7z,.tar,.gz,.bz2,.xz');
  if (allowedTypes.includes('other')) acceptParts.length = 0;
  const pageData = JSON.stringify({
    slug: page.slug,
    title: page.title,
    maxSizeMB: Number(page.max_size_mb),
    allowedTypes,
    chunkSizeBytes: getTelegramChunkSizeBytes(config)
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;padding:20px;font-family:Arial,"Microsoft YaHei",sans-serif;background:linear-gradient(135deg,#eef5fb,#dce9f5);color:#243447;min-height:100vh}
    .container{max-width:980px;margin:0 auto}.panel{background:rgba(255,255,255,.96);border-radius:16px;box-shadow:0 12px 34px rgba(30,55,80,.12);padding:22px;margin-bottom:20px}
    h1,h2{margin-top:0}h1{font-size:28px;margin-bottom:8px}.subtitle{color:#657786;margin:0}
    .drop{margin-top:20px;border:2px dashed #78a9d4;border-radius:14px;padding:34px 18px;text-align:center;background:#f8fbfe;transition:.2s}.drop.active{border-color:#2980b9;background:#eaf5fd}.drop input{display:none}
    .choose{display:inline-block;padding:11px 18px;background:#2980b9;color:#fff;border-radius:9px;cursor:pointer}.rule{margin-top:12px;color:#657786;font-size:14px}
    .queue{margin-top:18px}.task{border:1px solid #dce5ed;border-radius:10px;padding:13px;margin-top:10px}.task-head{display:flex;justify-content:space-between;gap:12px}.bar{height:9px;background:#e8edf2;border-radius:6px;overflow:hidden;margin-top:9px}.bar span{display:block;height:100%;width:0;background:#27ae60;transition:width .2s}.task-message{font-size:13px;color:#607080;margin-top:7px;word-break:break-all}
    .result-link{display:flex;gap:8px;margin-top:8px}.result-link input{flex:1;min-width:0;padding:8px;border:1px solid #ccd5df;border-radius:7px}.result-link button,.delete,.copy{border:0;border-radius:7px;padding:8px 12px;color:#fff;cursor:pointer}.copy{background:#3498db}.delete{background:#e74c3c}
    .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:15px}.file-card{border:1px solid #dfe7ee;border-radius:12px;overflow:hidden;background:#fff}.preview{height:170px;background:#f2f5f7;display:flex;align-items:center;justify-content:center;overflow:hidden}.preview img{width:100%;height:100%;object-fit:cover}.file-icon{font-size:44px;color:#7f8c8d}.info{padding:12px}.name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{font-size:13px;color:#718096;margin:7px 0}.url{font-size:12px;color:#2980b9;word-break:break-all}.actions{display:flex;gap:8px;margin-top:10px}.empty{text-align:center;color:#718096;padding:28px}
    @media(max-width:600px){body{padding:10px}.panel{padding:16px}.gallery{grid-template-columns:1fr}.result-link{flex-direction:column}}
  </style>
</head>
<body>
  <div class="container">
    <div class="panel">
      <h1>${escapeHtml(page.title)}</h1>
      <p class="subtitle">上传文件后获得无后缀直链</p>
      <div id="drop" class="drop">
        <label class="choose" for="fileInput">选择文件</label>
        <input id="fileInput" type="file" multiple${acceptParts.length ? ` accept="${acceptParts.join(',')}"` : ''}>
        <div class="rule">单文件最大 ${Number(page.max_size_mb)}MB</div>
      </div>
      <div id="queue" class="queue"></div>
    </div>
    <div class="panel">
      <h2>我的上传</h2>
      <div id="gallery" class="gallery"><div class="empty">正在加载</div></div>
    </div>
  </div>
  <script>
    const PAGE = ${pageData};
    const API = '/api/updata/' + encodeURIComponent(PAGE.slug) + '/';
    const tokenKey = 'upload_page_client_' + PAGE.slug;
    const fileInput = document.getElementById('fileInput');
    const drop = document.getElementById('drop');
    const queue = document.getElementById('queue');
    const gallery = document.getElementById('gallery');

    function randomToken(length) {
      const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      let value = '';
      for (let index = 0; index < bytes.length; index++) value += alphabet[bytes[index] % alphabet.length];
      return value;
    }

    function getClientToken() {
      let token = localStorage.getItem(tokenKey);
      if (!token || token.length < 32) {
        token = randomToken(64);
        localStorage.setItem(tokenKey, token);
      }
      return token;
    }

    function headers(extra) {
      return Object.assign({'X-Upload-Client-Token': getClientToken()}, extra || {});
    }

    function formatSize(bytes) {
      const value = Number(bytes || 0);
      if (value < 1024) return value + ' B';
      if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
      if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB';
      return (value / 1073741824).toFixed(2) + ' GB';
    }

    async function parseResponse(response) {
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok || !data.status) throw new Error(data.error || '请求失败');
      return data;
    }

    function createTask(file) {
      const task = document.createElement('div');
      task.className = 'task';
      const head = document.createElement('div');
      head.className = 'task-head';
      const name = document.createElement('strong');
      name.textContent = file.name;
      const size = document.createElement('span');
      size.textContent = formatSize(file.size);
      head.append(name, size);
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('span');
      bar.appendChild(fill);
      const message = document.createElement('div');
      message.className = 'task-message';
      message.textContent = '等待上传';
      task.append(head, bar, message);
      queue.prepend(task);
      return {
        progress: function(percent, text){ fill.style.width = Math.max(0, Math.min(100, percent)) + '%'; message.textContent = text; },
        complete: function(url){
          fill.style.width = '100%';
          message.textContent = '上传完成';
          const result = document.createElement('div');
          result.className = 'result-link';
          const input = document.createElement('input');
          input.readOnly = true;
          input.value = url;
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.className = 'copy';
          copy.textContent = '复制';
          copy.addEventListener('click', function(){ copyText(url); });
          result.append(input, copy);
          task.appendChild(result);
        },
        fail: function(text){ fill.style.background = '#e74c3c'; message.textContent = text; }
      };
    }

    async function copyText(text) {
      try { await navigator.clipboard.writeText(text); }
      catch (_) { window.prompt('请复制直链', text); }
    }

    async function uploadSmall(file, task) {
      const form = new FormData();
      form.append('file', file, file.name);
      const response = await fetch(API + 'upload', {method:'POST', headers:headers(), body:form});
      const data = await parseResponse(response);
      task.progress(100, '上传完成');
      return data.file;
    }

    async function uploadChunked(file, task) {
      const uploadId = randomToken(40);
      const totalChunks = Math.ceil(file.size / PAGE.chunkSizeBytes);
      try {
        for (let index = 0; index < totalChunks; index++) {
          const start = index * PAGE.chunkSizeBytes;
          const end = Math.min(file.size, start + PAGE.chunkSizeBytes);
          const form = new FormData();
          form.append('upload_id', uploadId);
          form.append('chunk_index', String(index));
          form.append('total_chunks', String(totalChunks));
          form.append('file_name', file.name);
          form.append('file_size', String(file.size));
          form.append('mime_type', file.type || 'application/octet-stream');
          form.append('chunk', file.slice(start, end), file.name + '.part');
          const response = await fetch(API + 'chunk', {method:'POST', headers:headers(), body:form});
          await parseResponse(response);
          const percent = ((index + 1) / totalChunks) * 95;
          task.progress(percent, '正在上传分片 ' + (index + 1) + ' / ' + totalChunks);
        }
        const response = await fetch(API + 'complete', {
          method:'POST',
          headers:headers({'Content-Type':'application/json'}),
          body:JSON.stringify({upload_id:uploadId})
        });
        return (await parseResponse(response)).file;
      } catch (error) {
        fetch(API + 'abort', {
          method:'POST',
          headers:headers({'Content-Type':'application/json'}),
          body:JSON.stringify({upload_id:uploadId})
        }).catch(function(){});
        throw error;
      }
    }

    async function uploadFile(file) {
      const task = createTask(file);
      if (file.size <= 0 || file.size > PAGE.maxSizeMB * 1024 * 1024) {
        task.fail('文件大小不符合要求');
        return;
      }
      try {
        task.progress(2, '开始上传');
        const result = file.size > PAGE.chunkSizeBytes
          ? await uploadChunked(file, task)
          : await uploadSmall(file, task);
        task.complete(result.url);
        await loadFiles();
      } catch (error) {
        task.fail(error.message);
      }
    }

    async function processFiles(files) {
      for (const file of Array.from(files || [])) await uploadFile(file);
      fileInput.value = '';
    }

    fileInput.addEventListener('change', function(){ processFiles(fileInput.files); });
    ['dragenter','dragover'].forEach(function(name){ drop.addEventListener(name, function(event){ event.preventDefault(); drop.classList.add('active'); }); });
    ['dragleave','drop'].forEach(function(name){ drop.addEventListener(name, function(event){ event.preventDefault(); drop.classList.remove('active'); }); });
    drop.addEventListener('drop', function(event){ processFiles(event.dataTransfer.files); });

    async function deleteFile(file) {
      if (!window.confirm('确认删除 ' + file.file_name + ' 吗')) return;
      try {
        const response = await fetch(API + 'delete', {
          method:'POST',
          headers:headers({'Content-Type':'application/json'}),
          body:JSON.stringify({file_id:file.id})
        });
        await parseResponse(response);
        await loadFiles();
      } catch (error) {
        window.alert(error.message);
      }
    }

    function renderFiles(files) {
      gallery.innerHTML = '';
      if (!files.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '当前浏览器还没有上传记录';
        gallery.appendChild(empty);
        return;
      }
      files.forEach(function(file) {
        const card = document.createElement('div');
        card.className = 'file-card';
        const preview = document.createElement('div');
        preview.className = 'preview';
        if (String(file.mime_type || '').startsWith('image/')) {
          const image = document.createElement('img');
          image.src = file.url;
          image.alt = file.file_name;
          image.loading = 'lazy';
          preview.appendChild(image);
        } else {
          const icon = document.createElement('div');
          icon.className = 'file-icon';
          icon.textContent = 'FILE';
          preview.appendChild(icon);
        }
        const info = document.createElement('div');
        info.className = 'info';
        const name = document.createElement('div');
        name.className = 'name';
        name.title = file.file_name;
        name.textContent = file.file_name;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = formatSize(file.file_size);
        const url = document.createElement('div');
        url.className = 'url';
        url.textContent = file.url;
        const actions = document.createElement('div');
        actions.className = 'actions';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'copy';
        copy.textContent = '复制直链';
        copy.addEventListener('click', function(){ copyText(file.url); });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'delete';
        del.textContent = '删除';
        del.addEventListener('click', function(){ deleteFile(file); });
        actions.append(copy, del);
        info.append(name, meta, url, actions);
        card.append(preview, info);
        gallery.appendChild(card);
      });
    }

    async function loadFiles() {
      try {
        const response = await fetch(API + 'files', {headers:headers()});
        const data = await parseResponse(response);
        renderFiles(data.files || []);
      } catch (error) {
        gallery.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = error.message;
        gallery.appendChild(empty);
      }
    }

    getClientToken();
    loadFiles();
  </script>
</body>
</html>`;
}
