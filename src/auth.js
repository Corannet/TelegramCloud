// 身份验证与用户权限

import {
  generateLoginPage
} from './templates-auth.js'

// 规范用户标识
export function normalizeIdList(value) {
  return String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

export function isTelegramAdmin(chatId, config) {
  const normalizedId = String(chatId || '').trim();

  return (
    Array.isArray(config.tgAdminId) &&
    config.tgAdminId.includes(normalizedId)
  );
}

export function normalizeTelegramUserId(value) {
  const normalizedId = String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();

  
  if (!/^\d{5,20}$/.test(normalizedId)) {
    return null;
  }

  return normalizedId;
}

// 管理机器人授权用户
export async function isAllowedTelegramUser(chatId, config) {
  const normalizedId = String(chatId || '').trim();

  
  if (isTelegramAdmin(normalizedId, config)) {
    return true;
  }

  const user = await config.database.prepare(`
    SELECT chat_id
    FROM allowed_users
    WHERE chat_id = ?
    LIMIT 1
  `).bind(normalizedId).first();

  return !!user;
}

export async function listAllowedTelegramUsers(config) {
  const result = await config.database.prepare(`
    SELECT
      id,
      chat_id,
      added_by,
      created_at
    FROM allowed_users
    ORDER BY created_at DESC, id DESC
  `).all();

  const users = result.results || [];

  
  return users.filter(user => {
    return !isTelegramAdmin(user.chat_id, config);
  });
}

export async function addAllowedTelegramUser(chatId, addedBy, config) {
  const normalizedId = normalizeTelegramUserId(chatId);

  if (!normalizedId) {
    throw new Error('用户 ID 格式不正确');
  }

  
  if (isTelegramAdmin(normalizedId, config)) {
    return {
      chatId: normalizedId,
      created: false,
      alreadyAdmin: true
    };
  }

  const existing = await config.database.prepare(`
    SELECT id
    FROM allowed_users
    WHERE chat_id = ?
    LIMIT 1
  `).bind(normalizedId).first();

  if (existing) {
    return {
      chatId: normalizedId,
      created: false,
      alreadyAdmin: false
    };
  }

  await config.database.prepare(`
    INSERT INTO allowed_users (
      chat_id,
      added_by,
      created_at
    )
    VALUES (?, ?, ?)
  `).bind(
    normalizedId,
    String(addedBy || ''),
    Date.now()
  ).run();

  return {
    chatId: normalizedId,
    created: true,
    alreadyAdmin: false
  };
}

export async function removeAllowedTelegramUser(chatId, config) {
  const normalizedId = normalizeTelegramUserId(chatId);

  if (!normalizedId) {
    throw new Error('用户 ID 格式不正确');
  }

  
  if (isTelegramAdmin(normalizedId, config)) {
    throw new Error('TG_ADMIN_ID 管理员不能被删除');
  }

  const result = await config.database.prepare(`
    DELETE FROM allowed_users
    WHERE chat_id = ?
  `).bind(normalizedId).run();

  return !!(
    result.meta &&
    Number(result.meta.changes || 0) > 0
  );
}

export function getWebOwnerChatId(config) {
  if (
    Array.isArray(config.tgAdminId) &&
    config.tgAdminId.length > 0
  ) {
    return config.tgAdminId[0];
  }

  return '';
}

// 处理网页登录验证
export function authenticate(request, config) {
  if (!config.enableAuth) {
    console.log('[Auth] Authentication disabled.');
    return true;
  }
  if (!config.username || !config.password) {
    console.error("[Auth] FAILED: Missing USERNAME or PASSWORD configuration while auth is enabled.");
    return false;
  }
  const cookies = request.headers.get("Cookie") || "";
  const authToken = cookies.match(/auth_token=([^;]+)/);
  if (!authToken) {
    console.log('[Auth] FAILED: No auth_token cookie found.');
    return false;
  }
  try {
    const tokenData = JSON.parse(atob(authToken[1]));
    const now = Date.now();
    if (now > tokenData.expiration) {
      console.log("[Auth] FAILED: Token expired.");
      return false;
    }
    if (tokenData.username !== config.username) {
      console.log("[Auth] FAILED: Token username mismatch.");
      return false;
    }
    console.log('[Auth] SUCCESS: Valid token found.');
    return true;
  } catch (error) {
    console.error("[Auth] FAILED: Error validating token:", error);
    return false;
  }
}

export async function handleLoginRequest(request, config) {
  if (request.method === 'POST') {
    const { username, password } = await request.json();
    if (username === config.username && password === config.password) {
      const expirationDate = new Date();
      const cookieDays = config.cookie || 7;
      expirationDate.setDate(expirationDate.getDate() + cookieDays);
      const expirationTimestamp = expirationDate.getTime();
      const tokenData = JSON.stringify({
        username: config.username,
        expiration: expirationTimestamp
      });
      const token = btoa(tokenData);
      const cookie = `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expirationDate.toUTCString()}`;
      return new Response("登录成功", {
        status: 200,
        headers: {
          "Set-Cookie": cookie,
          "Content-Type": "text/plain"
        }
      });
    }
    return new Response("认证失败", { status: 401 });
  }
  const html = generateLoginPage();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}
