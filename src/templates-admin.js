// 管理网页模板

import {
  getFileName
} from './utils.js'

// 生成用户管理页面
export function generateUserManagementPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <title>用户管理</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 20px;
      min-height: 100vh;
      font-family: Arial, "Microsoft YaHei", sans-serif;
      background: linear-gradient(135deg, #f0f4f8, #d9e2ec);
      color: #2c3e50;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    .header,
    .panel {
      background: rgba(255, 255, 255, 0.96);
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
      padding: 22px;
      margin-bottom: 20px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
    }

    h1,
    h2 {
      margin-top: 0;
    }

    h1 {
      margin-bottom: 0;
      font-size: 28px;
    }

    h2 {
      font-size: 20px;
      margin-bottom: 16px;
    }

    .back-button {
      display: inline-block;
      padding: 10px 16px;
      border-radius: 8px;
      text-decoration: none;
      color: white;
      background: #3498db;
    }

    .add-form {
      display: flex;
      gap: 12px;
    }

    .add-form input {
      flex: 1;
      min-width: 0;
      padding: 12px;
      border: 2px solid #dfe6e9;
      border-radius: 8px;
      font-size: 16px;
    }

    .add-form input:focus {
      outline: none;
      border-color: #3498db;
    }

    button {
      border: 0;
      border-radius: 8px;
      padding: 11px 18px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
    }

    .add-button {
      color: white;
      background: #27ae60;
    }

    .delete-button {
      color: white;
      background: #e74c3c;
    }

    .refresh-button {
      color: white;
      background: #7f8c8d;
    }

    .message {
      display: none;
      margin-top: 14px;
      padding: 12px;
      border-radius: 8px;
    }

    .message.success {
      display: block;
      background: #eafaf1;
      color: #1e8449;
    }

    .message.error {
      display: block;
      background: #fdecea;
      color: #c0392b;
    }

    .admin-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .admin-item {
      padding: 10px 14px;
      border-radius: 8px;
      background: #f3e5f5;
      color: #7d3c98;
      font-weight: 600;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 15px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 12px;
      border-bottom: 1px solid #ecf0f1;
      text-align: left;
      word-break: break-all;
    }

    th {
      background: #f8f9fa;
    }

    .empty {
      padding: 20px;
      text-align: center;
      color: #7f8c8d;
    }

    .hint {
      color: #7f8c8d;
      font-size: 14px;
      line-height: 1.7;
    }

    @media (max-width: 700px) {
      body {
        padding: 10px;
      }

      .header {
        flex-direction: column;
        align-items: stretch;
      }

      .back-button {
        text-align: center;
      }

      .add-form {
        flex-direction: column;
      }

      .toolbar {
        flex-direction: column;
        align-items: stretch;
      }

      .refresh-button {
        width: 100%;
      }

      table,
      thead,
      tbody,
      tr,
      th,
      td {
        display: block;
      }

      thead {
        display: none;
      }

      tr {
        padding: 12px;
        margin-bottom: 12px;
        border: 1px solid #ecf0f1;
        border-radius: 8px;
      }

      td {
        border-bottom: 0;
        padding: 7px 0;
      }
    }
  </style>
</head>

<body>
  <div class="container">
    <div class="header">
      <h1>用户管理</h1>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/upload-pages" class="back-button" style="background:#16a085">
          上传网页管理
        </a>
        <a href="/admin" class="back-button">
          返回文件管理
        </a>
      </div>
    </div>

    <div class="panel">
      <h2>添加用户</h2>

      <div class="add-form">
        <input
          type="text"
          id="chatIdInput"
          inputmode="numeric"
          placeholder="输入 Telegram 用户 ID，例如 123456789"
        >

        <button
          type="button"
          class="add-button"
          id="addUserButton"
        >
          添加用户
        </button>
      </div>

      <div id="messageBox" class="message"></div>

      <p class="hint">
        只填写 Telegram 用户 ID，不要填写用户名或 @username
        TG_ADMIN_ID 管理员无需重复添加
      </p>
    </div>

    <div class="panel">
      <h2>TG_ADMIN_ID 管理员</h2>
      <div id="adminList" class="admin-list"></div>
    </div>

    <div class="panel">
      <div class="toolbar">
        <h2 style="margin:0;">
          普通授权用户
        </h2>

        <button
          type="button"
          class="refresh-button"
          id="refreshButton"
        >
          刷新列表
        </button>
      </div>

      <div id="userTableContainer">
        <div class="empty">正在加载……</div>
      </div>
    </div>
  </div>

  <script>
    const chatIdInput =
      document.getElementById('chatIdInput');

    const addUserButton =
      document.getElementById('addUserButton');

    const refreshButton =
      document.getElementById('refreshButton');

    const messageBox =
      document.getElementById('messageBox');

    const adminList =
      document.getElementById('adminList');

    const userTableContainer =
      document.getElementById('userTableContainer');

    function showMessage(text, type) {
      messageBox.textContent = text;
      messageBox.className =
        'message ' + (type || 'success');
    }

    function formatTime(timestamp) {
      const value = Number(timestamp || 0);

      if (!value) {
        return '-';
      }

      return new Date(value).toLocaleString('zh-CN');
    }

    async function parseResponse(response) {
      let data = null;

      try {
        data = await response.json();
      } catch (error) {
        throw new Error('服务器返回格式错误');
      }

      if (!response.ok || !data || data.status !== 1) {
        throw new Error(
          data && (data.error || data.message)
            ? (data.error || data.message)
            : '请求失败'
        );
      }

      return data;
    }

    function renderAdmins(admins) {
      adminList.innerHTML = '';

      if (!admins || admins.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '尚未配置 TG_ADMIN_ID';
        adminList.appendChild(empty);
        return;
      }

      admins.forEach(function(adminId) {
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.textContent = adminId;
        adminList.appendChild(item);
      });
    }

    function renderUsers(users) {
      userTableContainer.innerHTML = '';

      if (!users || users.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '当前没有普通授权用户';
        userTableContainer.appendChild(empty);
        return;
      }

      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');

      [
        'Telegram 用户 ID',
        '添加来源',
        '添加时间',
        '操作'
      ].forEach(function(title) {
        const th = document.createElement('th');
        th.textContent = title;
        headRow.appendChild(th);
      });

      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      users.forEach(function(user) {
        const row = document.createElement('tr');

        const idCell = document.createElement('td');
        idCell.textContent = user.chat_id || '-';

        const sourceCell = document.createElement('td');
        sourceCell.textContent = user.added_by || '-';

        const timeCell = document.createElement('td');
        timeCell.textContent = formatTime(user.created_at);

        const actionCell = document.createElement('td');
        const deleteButton = document.createElement('button');

        deleteButton.type = 'button';
        deleteButton.className = 'delete-button';
        deleteButton.textContent = '删除';

        deleteButton.addEventListener('click', function() {
          deleteUser(user.chat_id);
        });

        actionCell.appendChild(deleteButton);

        row.appendChild(idCell);
        row.appendChild(sourceCell);
        row.appendChild(timeCell);
        row.appendChild(actionCell);

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      userTableContainer.appendChild(table);
    }

    async function loadUsers() {
      userTableContainer.innerHTML =
        '<div class="empty">正在加载……</div>';

      try {
        const response = await fetch('/api/users', {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          },
          cache: 'no-store'
        });

        const data = await parseResponse(response);

        renderAdmins(data.admins || []);
        renderUsers(data.users || []);
      } catch (error) {
        userTableContainer.innerHTML = '';

        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent =
          '加载失败：' + error.message;

        userTableContainer.appendChild(empty);
      }
    }

    async function addUser() {
      const chatId = chatIdInput.value.trim();

      if (!/^\\d{5,20}$/.test(chatId)) {
        showMessage(
          '请输入正确的纯数字 Telegram 用户 ID',
          'error'
        );
        return;
      }

      addUserButton.disabled = true;

      try {
        const response = await fetch('/api/users/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            chat_id: chatId
          })
        });

        const data = await parseResponse(response);

        showMessage(
          data.message || '用户添加成功',
          'success'
        );

        chatIdInput.value = '';

        await loadUsers();
      } catch (error) {
        showMessage(
          '添加失败：' + error.message,
          'error'
        );
      } finally {
        addUserButton.disabled = false;
      }
    }

    async function deleteUser(chatId) {
      const confirmed = window.confirm(
        '确定取消用户 ' + chatId + ' 的使用权限吗？\\n\\n' +
        '该操作不会删除用户已经上传的文件'
      );

      if (!confirmed) {
        return;
      }

      try {
        const response = await fetch('/api/users/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            chat_id: chatId
          })
        });

        const data = await parseResponse(response);

        showMessage(
          data.message || '用户权限已删除',
          'success'
        );

        await loadUsers();
      } catch (error) {
        showMessage(
          '删除失败：' + error.message,
          'error'
        );
      }
    }

    addUserButton.addEventListener(
      'click',
      addUser
    );

    chatIdInput.addEventListener(
      'keydown',
      function(event) {
        if (event.key === 'Enter') {
          addUser();
        }
      }
    );

    refreshButton.addEventListener(
      'click',
      loadUsers
    );

    loadUsers();
  </script>
</body>
</html>`;
}

// 生成文件管理页面
export function generateAdminPage(fileCards, categoryOptions) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <link rel="shortcut icon" href="https://tc-212.pages.dev/1744302340226.ico" type="image/x-icon">
    <meta name="description" content="Telegram文件存储与分享平台">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件管理</title>
    
    <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    <style>
      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        margin: 0;
        padding: 20px;
        min-height: 100vh;
        background: linear-gradient(135deg, #f0f4f8, #d9e2ec);
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
      }
      .header {
        background: rgba(255, 255, 255, 0.95);
        padding: 1.5rem;
        border-radius: 15px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        margin-bottom: 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      h2 {
        color: #2c3e50;
        margin: 0;
        font-size: 1.8rem;
      }
      .right-content {
        display: flex;
        gap: 1rem;
        align-items: center;
      }
      .search, .category-filter {
        padding: 0.7rem;
        border: 2px solid #dfe6e9;
        border-radius: 8px;
        font-size: 0.9rem;
        background: #fff;
        transition: border-color 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
      }
      .search:focus, .category-filter:focus {
        outline: none;
        border-color: #3498db;
      }
      .backup {
        color: #3498db;
        text-decoration: none;
        font-size: 1rem;
        transition: color 0.3s ease;
      }
      .backup:hover {
        color: #2980b9;
      }
      .return-btn {
        background: #2ecc71;
        color: white;
        padding: 0.7rem 1.5rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.3s ease;
        text-decoration: none;
        margin-left: 10px;
      }
      .return-btn:hover {
        background: #27ae60;
        transform: translateY(-2px);
      }
      .action-bar {
        background: rgba(255, 255, 255, 0.95);
        padding: 1.5rem;
        border-radius: 15px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        margin-bottom: 1.5rem;
        display: flex;
        gap: 1rem;
        align-items: center;
        justify-content: space-between;
      }
      .action-bar-left {
        display: flex;
        gap: 1rem;
        align-items: center;
      }
      .action-bar-right {
        display: flex;
        gap: 1rem;
        align-items: center;
      }
      .action-bar h3 {
        margin: 0;
        color: #2c3e50;
        font-size: 1.2rem;
      }
      .action-bar select {
        padding: 0.7rem;
        border: 2px solid #dfe6e9;
        border-radius: 8px;
        font-size: 0.9rem;
        background: #fff;
        transition: border-color 0.3s ease;
      }
      .action-bar select:focus {
        outline: none;
        border-color: #3498db;
      }
      .action-button {
        padding: 0.7rem 1.5rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        font-size: 0.9rem;
      }
      .select-all-btn {
        background: #3498db;
        color: white;
      }
      .delete-files-btn {
        background: #e74c3c;
        color: white;
      }
      .delete-category-btn {
        background: #e74c3c;
        color: white;
      }
      .action-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      }
      .select-all-btn:hover {
        background: #2980b9;
      }
      .delete-files-btn:hover {
        background: #c0392b;
      }
      .delete-category-btn:hover {
        background: #c0392b;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 1.5rem;
      }
      .file-card {
        background: rgba(255, 255, 255, 0.95);
        border-radius: 15px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        overflow: hidden;
        position: relative;
        transition: all 0.3s ease;
        cursor: pointer;
      }
      .file-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 20px rgba(0,0,0,0.15);
      }
      .file-card.selected {
        border: 3px solid #3498db;
      }
      .file-checkbox {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 5;
        width: 20px;
        height: 20px;
      }
      .file-preview {
        height: 150px;
        background: #f8f9fa;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .file-preview img, .file-preview video {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .file-info {
        padding: 1rem;
        font-size: 0.9rem;
        color: #2c3e50;
      }
      .file-actions {
        padding: 1rem;
        border-top: 1px solid #eee;
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .btn {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        font-size: 0.9rem;
        display: inline-block;
        text-align: center;
      }
      .btn-share {
        background: #3498db;
        color: white;
        flex: 1;
      }
      .btn-down {
        background: #2ecc71;
        color: white;
        text-decoration: none;
        flex: 1;
      }
      .btn-delete {
        background: #e74c3c;
        color: white;
        flex: 1;
      }
      .btn-edit {
        background: #f39c12;
        color: white;
        flex: 1;
      }
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      }
      .btn-share:hover {
        background: #2980b9;
      }
      .btn-down:hover {
        background: #27ae60;
      }
      .btn-delete:hover {
        background: #c0392b;
      }
      .btn-edit:hover {
        background: #e67e22;
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
      #qrModal {
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
      #qrModal.show {
        display: flex;
        opacity: 1;
      }
      .qr-content {
        background: white;
        padding: 2rem;
        border-radius: 15px;
        box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        text-align: center;
        width: 90%;
        max-width: 350px;
        transform: scale(0.9);
        transition: transform 0.3s ease;
      }
      #qrModal.show .qr-content {
        transform: scale(1);
      }
      .qr-title {
        color: #2c3e50;
        font-size: 1.3rem;
        margin-top: 0;
        margin-bottom: 0.5rem;
      }
      .qr-file-name {
        color: #7f8c8d;
        font-size: 0.9rem;
        margin-bottom: 1rem;
        word-break: break-all;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #qrcode {
        margin: 1.5rem auto;
      }
      .qr-buttons {
        display: flex;
        gap: 0.5rem;
        justify-content: center;
        margin-top: 1.5rem;
      }
      .qr-copy, .qr-download, .qr-close {
        padding: 0.8rem 1rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        font-size: 0.9rem;
        font-weight: 500;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .qr-copy {
        background: #3498db;
        color: white;
      }
      .qr-download {
        background: #2ecc71;
        color: white;
      }
      .qr-close {
        background: #95a5a6;
        color: white;
      }
      .qr-copy:hover, .qr-download:hover, .qr-close:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      }
      .qr-copy:hover {
        background: #2980b9;
      }
      .qr-download:hover {
        background: #27ae60;
      }
      .qr-close:hover {
        background: #7f8c8d;
      }
      #editSuffixModal {
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
      }
      #editSuffixModal.show {
        display: flex;
      }
      #editSuffixModal .modal-content {
        background: white;
        padding: 2rem;
        border-radius: 15px;
        box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        text-align: center;
        width: 90%;
        max-width: 400px;
      }
      #editSuffixModal input {
        width: 100%;
        padding: 0.8rem;
        margin: 1rem 0;
        border: 2px solid #dfe6e9;
        border-radius: 8px;
        font-size: 1rem;
      }
      @media (max-width: 768px) {
        body {
          padding: 10px;
        }
        .container {
          padding: 1rem;
        }
        .header {
          flex-direction: column;
          align-items: flex-start;
          gap: 10px;
        }
        .header .right-content {
          flex-direction: column;
          width: 100%;
          gap: 10px;
          align-items: stretch;
        }
        .header input.search,
        .header select.category-filter,
        .header a.return-btn {
          width: 100%;
          box-sizing: border-box;
          margin-left: 0;
          text-align: center;
        }
        .action-bar {
          flex-direction: column;
          align-items: stretch;
          gap: 1rem;
        }
        .action-bar-left,
        .action-bar-right {
          flex-direction: column;
          align-items: stretch;
          gap: 10px;
          width: 100%;
        }
        .action-bar h3 {
          text-align: center;
        }
        .grid {
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 1rem;
        }
        .file-card {
          border-radius: 10px;
        }
        .file-info {
           padding: 0.8rem;
           font-size: 0.85rem;
        }
        .file-actions {
           padding: 0.8rem;
           gap: 5px;
           flex-wrap: wrap;
        }
        .btn {
           padding: 0.6rem 0.8rem;
           font-size: 0.8rem;
           flex-grow: 1;
           min-width: 80px;
        }
      }
      @media (max-width: 480px) {
         .grid {
            grid-template-columns: 1fr;
         }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2>文件管理</h2>
        <div class="right-content">
          <input type="text" id="search-input" name="searchInput" class="search" placeholder="搜索文件名...">
          <select id="category-filter" name="categoryFilter" class="category-filter">
            <option value="">所有分类</option>
            ${categoryOptions}
          </select>
          
          <a
            href="/users"
            class="return-btn"
            style="background:#8e44ad;"
          >
            用户管理
          </a>

          <a
            href="/upload-pages"
            class="return-btn"
            style="background:#16a085;"
          >
            上传网页管理
          </a>
          
          <a href="/upload" class="return-btn">
            返回上传
          </a>
        </div>
      </div>
      <div class="action-bar">
        <div class="action-bar-left">
          <h3>文件操作：</h3>
          <button class="action-button select-all-btn" id="selectAllBtn">全选/取消</button>
          <button class="action-button delete-files-btn" id="deleteFilesBtn">删除选中</button>
        </div>
        <div class="action-bar-right">
          <h3>分类管理：</h3>
          <select id="categoryDeleteSelect" name="categoryDeleteSelect" class="category-filter">
            ${categoryOptions}
          </select>
          <button class="action-button delete-category-btn" id="deleteCategoryBtn">删除分类</button>
        </div>
      </div>
      <div class="grid" id="fileGrid">
        ${fileCards}
      </div>
      
      <div id="confirmModal" class="modal">
        <div class="modal-content">
          <h3 class="modal-title">确认操作</h3>
          <p class="modal-message" id="confirmModalMessage"></p>
          <div class="modal-buttons">
            <button class="modal-button modal-confirm" id="confirmModalConfirm">确认</button>
            <button class="modal-button modal-cancel" id="confirmModalCancel">取消</button>
          </div>
        </div>
      </div>
      
      <div id="editSuffixModal" class="modal">
        <div class="modal-content">
          <h3 class="modal-title">修改文件后缀</h3>
          <input type="text" id="editSuffixInput" name="editSuffixInput" placeholder="输入新的文件后缀">
          <div class="modal-buttons">
            <button class="modal-button modal-confirm" id="editSuffixConfirm">确认</button>
            <button class="modal-button modal-cancel" id="editSuffixCancel">取消</button>
          </div>
        </div>
      </div>
    </div>
    <script>
      let currentShareUrl = '';
      let currentConfirmCallback = null;
      let currentEditUrl = '';
      let confirmModal, confirmModalMessage, confirmModalConfirm, confirmModalCancel, editSuffixModal, qrModal, qrCopyBtn, qrDownloadBtn, qrCloseBtn;
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
      setTimeout(setBingBackground, 1000);
      document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM已加载，初始化页面...');
        confirmModal = document.getElementById('confirmModal');
        confirmModalMessage = document.getElementById('confirmModalMessage');
        confirmModalConfirm = document.getElementById('confirmModalConfirm');
        confirmModalCancel = document.getElementById('confirmModalCancel');
        editSuffixModal = document.getElementById('editSuffixModal');
        qrModal = document.getElementById('qrModal');
        qrCopyBtn = document.getElementById('qrCopyBtn');
        qrDownloadBtn = document.getElementById('qrDownloadBtn');
        qrCloseBtn = document.getElementById('qrCloseBtn');
        const searchInput = document.getElementById('search-input');
        const categoryFilter = document.getElementById('category-filter');
        const selectAllBtn = document.getElementById('selectAllBtn');
        const deleteFilesBtn = document.getElementById('deleteFilesBtn');
        const deleteCategoryBtn = document.getElementById('deleteCategoryBtn');
        const editSuffixConfirm = document.getElementById('editSuffixConfirm');
        const editSuffixCancel = document.getElementById('editSuffixCancel');
        console.log('页面元素引用:', {
          confirmModal: !!confirmModal,
          editSuffixModal: !!editSuffixModal,
          qrModal: !!qrModal
        });
        if (searchInput) searchInput.addEventListener('input', filterFiles);
        if (categoryFilter) categoryFilter.addEventListener('change', filterFiles);
        if (selectAllBtn) selectAllBtn.addEventListener('click', toggleSelectAll);
        if (deleteFilesBtn) deleteFilesBtn.addEventListener('click', confirmDeleteSelected);
        if (deleteCategoryBtn) deleteCategoryBtn.addEventListener('click', confirmDeleteCategory);
        if (confirmModalConfirm) confirmModalConfirm.addEventListener('click', handleConfirmModalConfirm);
        if (confirmModalCancel) confirmModalCancel.addEventListener('click', closeConfirmModal);
        if (editSuffixCancel) editSuffixCancel.addEventListener('click', function() {
          if (editSuffixModal) editSuffixModal.classList.remove('show');
        });
        if (editSuffixConfirm) editSuffixConfirm.addEventListener('click', updateFileSuffix);
        if (qrCopyBtn) qrCopyBtn.addEventListener('click', copyCurrentShareUrl);
        if (qrDownloadBtn) { }
        if (qrCloseBtn) qrCloseBtn.addEventListener('click', closeQrModal);
        window.addEventListener('click', handleWindowClick);
        initializeFileCards();
      });
      function initializeFileCards() {
        const fileGrid = document.getElementById('fileGrid');
        if (!fileGrid) return;
        const fileCards = Array.from(fileGrid.children);
        fileCards.forEach(card => {
          const checkbox = card.querySelector('.file-checkbox');
          if (!checkbox) return;
          card.addEventListener('click', (e) => {
            if (e.target === checkbox || 
                e.target.closest('.file-actions a') || 
                e.target.closest('.file-actions button')) {
              return; 
            }
            checkbox.checked = !checkbox.checked;
            const changeEvent = new Event('change', { bubbles: true });
            checkbox.dispatchEvent(changeEvent);
          });
          checkbox.addEventListener('change', () => {
            card.classList.toggle('selected', checkbox.checked);
          });
           card.classList.toggle('selected', checkbox.checked);
        });
      }
      function filterFiles() {
        const searchInput = document.getElementById('search-input');
        const categoryFilter = document.getElementById('category-filter');
        const fileGrid = document.getElementById('fileGrid');
        if (!searchInput || !categoryFilter || !fileGrid) return;
        const searchTerm = searchInput.value.toLowerCase();
        const selectedCategory = categoryFilter.value;
        const fileCards = Array.from(fileGrid.children);
        fileCards.forEach(card => {
          const fileInfo = card.querySelector('.file-info');
          if (!fileInfo) return;
          const fileName = fileInfo.querySelector('div:first-child')?.textContent.toLowerCase() || '';
          const categoryId = card.getAttribute('data-category-id') || '';
          const matchesSearch = fileName.includes(searchTerm);
          const matchesCategory = selectedCategory === '' || categoryId === selectedCategory;
          card.style.display = matchesSearch && matchesCategory ? '' : 'none';
        });
      }
      function toggleSelectAll() {
        const fileGrid = document.getElementById('fileGrid');
        if (!fileGrid) return;
        const fileCards = Array.from(fileGrid.children);
        const visibleCards = fileCards.filter(card => card.style.display !== 'none');
        const allSelected = visibleCards.every(card => card.querySelector('.file-checkbox')?.checked);
        visibleCards.forEach(card => {
          const checkbox = card.querySelector('.file-checkbox');
          if (checkbox) {
            checkbox.checked = !allSelected;
            card.classList.toggle('selected', !allSelected);
          }
        });
      }
      function confirmDeleteSelected() {
        const selectedCheckboxes = document.querySelectorAll('.file-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
          showConfirmModal('请先选择要删除的文件！', null, true);
          return;
        }
        showConfirmModal(
          \`确定要删除选中的 \${selectedCheckboxes.length} 个文件吗？\`, 
          deleteSelectedFiles
        );
      }
      function confirmDeleteCategory() {
        const select = document.getElementById('categoryDeleteSelect');
        if (!select) return;
        const categoryId = select.value;
        if (!categoryId) {
          showConfirmModal('请选择要删除的分类', null, true);
          return;
        }
        const categoryName = select.options[select.selectedIndex].text;
        showConfirmModal(
          \`确定要删除分类 "\${categoryName}" 吗？这将清空所有关联文件的分类！\`, 
          deleteCategory
        );
      }
      function shareFile(url, fileName) {
        console.log('分享文件:', url);
        try {
          const modal = document.createElement('div');
          modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:1000;display:flex;justify-content:center;align-items:center;';
          const content = document.createElement('div');
          content.style.cssText = 'background:white;padding:20px;border-radius:10px;max-width:90%;width:350px;text-align:center;';
          const title = document.createElement('h3');
          title.style.cssText = 'margin-top:0;color:#333;';
          title.textContent = '分享文件';
          const fileNameElem = document.createElement('div');
          fileNameElem.style.cssText = 'margin-bottom:10px;word-break:break-all;font-size:14px;color:#666;';
          fileNameElem.textContent = fileName || getFileName(url);
          const qrContainer = document.createElement('div');
          qrContainer.id = 'qrcode-container';
          qrContainer.style.cssText = 'margin:20px auto;height:200px;width:200px;';
          try {
            const qrcode = new QRCode(qrContainer, {
              text: url,
              width: 200,
              height: 200,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
          } catch (qrError) {
            console.error('二维码生成失败:', qrError);
            qrContainer.innerHTML = '<div style="padding:20px;word-break:break-all;border:1px dashed #ccc;">' + url + '</div>';
          }
          const buttons = document.createElement('div');
          buttons.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:20px;';
          const copyBtn = document.createElement('button');
          copyBtn.id = 'copy-link-btn';
          copyBtn.style.cssText = 'flex:1;padding:8px 15px;border:none;border-radius:4px;background:#3498db;color:white;cursor:pointer;';
          copyBtn.textContent = '复制';
          copyBtn.onclick = function() {
            navigator.clipboard.writeText(url)
              .then(() => {
                copyBtn.textContent = '已复制';
                setTimeout(() => { copyBtn.textContent = '复制'; }, 2000);
              })
              .catch(() => {
                prompt('请手动复制链接:', url);
              });
          };
          const downloadBtn = document.createElement('a');
          downloadBtn.id = 'download-file-btn';
          downloadBtn.style.cssText = 'flex:1;padding:8px 15px;border:none;border-radius:4px;background:#2ecc71;color:white;cursor:pointer;text-decoration:none;display:inline-block;text-align:center;';
          downloadBtn.textContent = '下载';
          downloadBtn.href = url;
          downloadBtn.setAttribute('download', fileName || getFileName(url));
          const cancelBtn = document.createElement('button');
          cancelBtn.id = 'close-share-btn';
          cancelBtn.style.cssText = 'flex:1;padding:8px 15px;border:none;border-radius:4px;background:#95a5a6;color:white;cursor:pointer;';
          cancelBtn.textContent = '取消';
          cancelBtn.onclick = function() {
            document.body.removeChild(modal);
          };
          buttons.appendChild(copyBtn);
          buttons.appendChild(downloadBtn);
          buttons.appendChild(cancelBtn);
          content.appendChild(title);
          content.appendChild(fileNameElem);
          content.appendChild(qrContainer);
          content.appendChild(buttons);
          modal.appendChild(content);
          modal.addEventListener('click', function(e) {
            if (e.target === modal) {
              document.body.removeChild(modal);
            }
          });
          document.body.appendChild(modal);
        } catch (error) {
          console.error('分享功能出错:', error);
          try {
            navigator.clipboard.writeText(url)
              .then(() => alert('链接已复制: ' + url))
              .catch(() => prompt('请复制链接:', url));
          } catch (e) {
            prompt('请复制链接:', url);
          }
        }
      }
      function closeQrModal() {
        if (qrModal) qrModal.style.display = 'none';
      }
      function copyCurrentShareUrl() {
        if (!currentShareUrl) return;
        navigator.clipboard.writeText(currentShareUrl)
          .then(() => {
            if (qrCopyBtn) {
              qrCopyBtn.textContent = '✓ 已复制';
              setTimeout(() => {
                qrCopyBtn.textContent = '复制链接';
              }, 2000);
            }
          })
          .catch(() => {
            prompt('请手动复制链接:', currentShareUrl);
          });
      }
      function showConfirmModal(message, callback, alertOnly = false) {
        if (!confirmModal || !confirmModalMessage || !confirmModalConfirm || !confirmModalCancel) {
          alert(message);
          if (callback && !alertOnly) callback();
          return;
        }
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
        if (confirmModal) confirmModal.classList.remove('show');
      }
      function handleConfirmModalConfirm() {
        if (currentConfirmCallback) {
          currentConfirmCallback();
        }
        closeConfirmModal();
      }
      function handleWindowClick(event) {
        if (confirmModal && event.target === confirmModal) {
          closeConfirmModal();
        }
        if (qrModal && event.target === qrModal) { 
          closeQrModal();
        }
        if (editSuffixModal && event.target === editSuffixModal) {
          editSuffixModal.classList.remove('show');
        }
      }
      function showEditSuffixModal(url) {
        console.log('显示修改后缀弹窗:', url, '弹窗元素:', !!editSuffixModal);
        if (!editSuffixModal) {
          console.error('修改后缀弹窗元素不存在');
          alert('修改后缀功能不可用');
          return;
        }
        currentEditUrl = url;
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        const fileName = pathParts[pathParts.length - 1];
        const fileNameParts = fileName.split('.');
        const extension = fileNameParts.pop(); 
        const currentSuffix = fileNameParts.join('.'); 
        const editSuffixInput = document.getElementById('editSuffixInput');
        if (editSuffixInput) {
          editSuffixInput.value = currentSuffix;
          editSuffixModal.classList.add('show');
        } else {
          console.error('找不到编辑后缀输入框');
        }
      }
      async function deleteFile(url, card) {
        try {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/');
          const fileName = pathParts[pathParts.length - 1];
          const response = await fetch('/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: url, fileId: fileName }) 
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || errorData.message || '删除失败');
          }
          if (card) {
            card.remove();
          } else {
            const card = document.querySelector(\`[data-url="\${url}"]\`);
            if (card) card.remove();
          }
          showConfirmModal('文件删除成功', null, true);
        } catch (error) {
          showConfirmModal('文件删除失败: ' + error.message, null, true);
        }
      }
      async function deleteSelectedFiles() {
        const checkboxes = document.querySelectorAll('.file-checkbox:checked');
        const urls = Array.from(checkboxes).map(cb => cb.value);
        try {
          const response = await fetch('/delete-multiple', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls })
          });
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '批量删除失败');
          }
          checkboxes.forEach(cb => {
            const card = cb.closest('.file-card');
            if (card) card.remove();
          });
          showConfirmModal('批量删除成功', null, true);
        } catch (error) {
          showConfirmModal('批量删除失败: ' + error.message, null, true);
        }
      }
      async function deleteCategory() {
        const select = document.getElementById('categoryDeleteSelect');
        if (!select) return;
        const categoryId = select.value;
        try {
          const response = await fetch('/delete-category', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: categoryId })
          });
          const data = await response.json();
          if (data.status === 1) {
            select.remove(select.selectedIndex);
            showConfirmModal(data.msg, () => {
              window.location.reload();
            }, true);
          } else {
            showConfirmModal(data.msg, null, true);
          }
        } catch (error) {
          showConfirmModal('删除分类失败: ' + error.message, null, true);
        }
      }
      async function updateFileSuffix() {
        const editSuffixInput = document.getElementById('editSuffixInput');
        if (!editSuffixInput) return;
        const newSuffix = editSuffixInput.value;
        try {
          const response = await fetch('/update-suffix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              url: currentEditUrl,
              suffix: newSuffix
            })
          });
          const data = await response.json();
          if (data.status === 1) {
            if (editSuffixModal) editSuffixModal.classList.remove('show');
            const card = document.querySelector('.file-card[data-url="' + currentEditUrl + '"]');
            if (card) {
              card.setAttribute('data-url', data.newUrl);
              const shareBtn = card.querySelector('.btn-share');
              const deleteBtn = card.querySelector('.btn-delete');
              const editBtn = card.querySelector('.btn-edit');
              if (shareBtn) {
                const fileName = data.fileName || getFileName(data.newUrl);
                shareBtn.setAttribute('onclick', 'shareFile("' + data.newUrl + '", "' + fileName + '")');
              }
              if (deleteBtn) {
                const newOnclick = deleteBtn.getAttribute('onclick').replace(currentEditUrl, data.newUrl);
                deleteBtn.setAttribute('onclick', newOnclick);
              }
              if (editBtn) {
                editBtn.setAttribute('onclick', 'showEditSuffixModal("' + data.newUrl + '")');
              }
              const fileNameElement = card.querySelector('.file-info div:first-child');
              if (fileNameElement) {
                let fileName = data.fileName;
                if (!fileName) {
                  const urlObj = new URL(data.newUrl);
                  fileName = decodeURIComponent(urlObj.pathname.split('/').pop() || '');
                }
                fileNameElement.textContent = fileName;
              }
              const checkbox = card.querySelector('.file-checkbox');
              if (checkbox) {
                checkbox.value = data.newUrl;
              }
            }
            currentEditUrl = data.newUrl;
            showConfirmModal(data.msg, null, true);
          } else {
            showConfirmModal(data.msg || '修改后缀失败', null, true);
          }
        } catch (error) {
          showConfirmModal('修改后缀时出错：' + error.message, null, true);
        }
      }
      function getFileName(url) {
        try {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/');
          return pathParts[pathParts.length - 1];
        } catch (e) {
          return url.split('/').pop() || url;
        }
      }
    </script>
  </body>
  </html>`;
}
