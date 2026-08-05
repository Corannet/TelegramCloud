// 登录网页模板

// 生成登录页面
export function generateLoginPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <link rel="shortcut icon" href="https://tc-212.pages.dev/1744302340226.ico" type="image/x-icon">
    <meta name="description" content="文件存储与分享平台">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录</title>
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
        max-width: 400px;
        width: 100%;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 15px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        padding: 2rem;
        margin: 20px;
      }
      .header {
        margin-bottom: 1.5rem;
        text-align: center;
      }
      h1 {
        color: #2c3e50;
        margin: 0;
        font-size: 1.8rem;
        font-weight: 600;
      }
      .form-group {
        margin-bottom: 1.5rem;
      }
      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        color: #2c3e50;
        font-weight: 500;
      }
      .form-group input {
        width: 100%;
        padding: 0.8rem;
        border: 2px solid #dfe6e9;
        border-radius: 8px;
        font-size: 1rem;
        background: #fff;
        transition: border-color 0.3s ease, box-shadow 0.3s ease;
        box-sizing: border-box;
      }
      .form-group input:focus {
        outline: none;
        border-color: #3498db;
        box-shadow: 0 0 8px rgba(52,152,219,0.3);
      }
      .btn-login {
        width: 100%;
        padding: 0.8rem;
        background: #3498db;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.3s ease;
      }
      .btn-login:hover {
        background: #2980b9;
      }
      .error-message {
        color: #e74c3c;
        margin-top: 1rem;
        padding: 0.8rem;
        background: rgba(231, 76, 60, 0.1);
        border-radius: 8px;
        display: none;
      }
      .success-message {
        color: #27ae60;
        margin-top: 1rem;
        padding: 0.8rem;
        background: rgba(39, 174, 96, 0.1);
        border-radius: 8px;
        display: none;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>登录</h1>
        <p>请输入管理员账号和密码</p>
      </div>
      <form id="loginForm">
        <div class="form-group">
          <label for="username">用户名</label>
          <input type="text" id="username" name="username" required>
        </div>
        <div class="form-group">
          <label for="password">密码</label>
          <input type="password" id="password" name="password" required>
        </div>
        <button type="submit" class="btn-login">登录</button>
      </form>
      <div id="errorMessage" class="error-message"></div>
      <div id="successMessage" class="success-message"></div>
    </div>
    <script>
      const urlParams = new URLSearchParams(window.location.search);
      const redirectPath = urlParams.get('redirect') || '/upload';
      document.getElementById('loginForm').addEventListener('submit', async function(event) {
        event.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorMessage = document.getElementById('errorMessage');
        const successMessage = document.getElementById('successMessage');
        errorMessage.style.display = 'none';
        successMessage.style.display = 'none';
        if (!username || !password) {
          errorMessage.textContent = '请输入用户名和密码';
          errorMessage.style.display = 'block';
          return;
        }
        try {
          const response = await fetch('/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
          });
          if (response.ok) {
            successMessage.textContent = '登录成功，正在跳转...';
            successMessage.style.display = 'block';
            setTimeout(() => {
              window.location.href = redirectPath;
            }, 1000);
          } else {
            const data = await response.text();
            errorMessage.textContent = data || '用户名或密码错误';
            errorMessage.style.display = 'block';
          }
        } catch (error) {
          errorMessage.textContent = '登录请求失败，请稍后重试';
          errorMessage.style.display = 'block';
          console.error('登录错误:', error);
        }
      });
    </script>
  </body>
  </html>`;
}
