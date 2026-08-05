// 机器人大文件上传

import {
  buildUploadCompletedCaption
} from './messages.js'

import {
  LARGE_UPLOAD_SESSION_STATUS,
  LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES,
  LARGE_UPLOAD_CHUNK_TIMEOUT_MS
} from './constants.js'

import {
  generateSafeKey,
  sanitizeTelegramFileName,
  getTelegramChunkSizeBytes,
  uploadOneTelegramChunk,
  abortPendingChunkUpload,
  finalizeChunkedTelegramUpload
} from './storage.js'

import {
  normalizeTelegramApiRoot,
  sendUploadCompletedWithQr,
  sendMessage
} from './telegram.js'

import {
  generateLargeUploadMessagePage,
  generateLargeUploadPage
} from './templates-large-upload.js'

import {
  escapeHtml
} from './utils.js'

// 创建大文件维护配置
export function createLargeUploadMaintenanceConfig(env) {
  const tgApiBaseUrl = normalizeTelegramApiRoot(
    env.TG_BOT_API_BASE_URL || 'https://api.telegram.org'
  );
  return {
    database: env.DATABASE,
    tgBotToken: env.TG_BOT_TOKEN || '',
    tgApiBaseUrl,
    tgFileBaseUrl: normalizeTelegramApiRoot(
      env.TG_BOT_FILE_BASE_URL || tgApiBaseUrl
    ),
    tgStorageChatId: String(env.TG_STORAGE_CHAT_ID || '').trim(),
    fileCache: new Map(),
    fileCacheTTL: 3600000
  };
}

// 管理临时上传会话
export function getPublicOrigin(config) {
  const value = String(config && config.domain || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export function createSecureTokenHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function normalizeLargeUploadToken(value) {
  const token = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function getLargeUploadSessionByToken(token, config) {
  const validToken = normalizeLargeUploadToken(token);
  if (!validToken) return null;
  const tokenHash = await sha256Hex(validToken);
  return config.database.prepare(`
    SELECT *
    FROM bot_upload_sessions
    WHERE token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();
}

export function isLargeUploadSessionExpired(session) {
  return !session || Number(session.expires_at || 0) <= Date.now();
}

export function mayContinueLargeUploadSession(session) {
  if (!session) return false;
  return [
    LARGE_UPLOAD_SESSION_STATUS.UPLOADING,
    LARGE_UPLOAD_SESSION_STATUS.FINALIZING,
    LARGE_UPLOAD_SESSION_STATUS.COMPLETED
  ].includes(String(session.status || ''));
}

export function isLargeUploadSessionCancelled(session) {
  return Boolean(
    session &&
    String(session.status || '') === LARGE_UPLOAD_SESSION_STATUS.CANCELLED
  );
}

export async function createLargeUploadSession(chatId, userSetting, config) {
  const token = createSecureTokenHex(32);
  const tokenHash = await sha256Hex(token);
  const uploadId = crypto.randomUUID().replace(/-/g, '_');
  const now = Date.now();
  const expiresAt = now + Number(config.updateTimeMinutes || 20) * 60 * 1000;
  const categoryId = Number(userSetting && userSetting.current_category_id) || null;

  
  await config.database.prepare(`
    DELETE FROM bot_upload_sessions
    WHERE chat_id = ? AND status = ?
  `).bind(chatId, LARGE_UPLOAD_SESSION_STATUS.PENDING).run();

  await config.database.prepare(`
    INSERT INTO bot_upload_sessions (
      token_hash, chat_id, upload_id, category_id, status,
      created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    String(chatId),
    uploadId,
    categoryId,
    LARGE_UPLOAD_SESSION_STATUS.PENDING,
    now,
    expiresAt
  ).run();

  return {
    token,
    uploadId,
    expiresAt,
    url: `${getPublicOrigin(config)}/large-upload?token=${encodeURIComponent(token)}`
  };
}

export function largeUploadJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function getLargeUploadTokenFromRequest(request, bodyOrForm = null) {
  const requestUrl = new URL(request.url);
  return normalizeLargeUploadToken(
    requestUrl.searchParams.get('token') ||
    (bodyOrForm && typeof bodyOrForm.get === 'function' ? bodyOrForm.get('token') : null) ||
    (bodyOrForm && bodyOrForm.token)
  );
}

export async function getLargeUploadProgress(session, config) {
  const result = await config.database.prepare(`
    SELECT
      COUNT(*) AS uploaded_chunks,
      COALESCE(SUM(chunk_size), 0) AS uploaded_bytes,
      MAX(created_at) AS last_chunk_at
    FROM file_chunks
    WHERE upload_id = ? AND chat_id = ?
  `).bind(session.upload_id, session.chat_id).first();

  const indexesResult = await config.database.prepare(`
    SELECT chunk_index
    FROM file_chunks
    WHERE upload_id = ? AND chat_id = ?
    ORDER BY chunk_index ASC
  `).bind(session.upload_id, session.chat_id).all();

  return {
    uploadedChunks: Number(result && result.uploaded_chunks || 0),
    uploadedBytes: Number(result && result.uploaded_bytes || 0),
    uploadedIndexes: (indexesResult.results || []).map(row => Number(row.chunk_index)),
    lastChunkAt: Number(result && result.last_chunk_at || 0)
  };
}

export async function cancelLargeUploadSessionForChunkTimeout(session, config) {
  if (!session || String(session.status || '') !== LARGE_UPLOAD_SESSION_STATUS.UPLOADING) {
    return { session, cancelled: false, deletedChunks: 0 };
  }

  const progress = await getLargeUploadProgress(session, config);
  const totalChunks = Number(session.total_chunks || 0);

  
  
  if (
    progress.uploadedChunks <= 0 ||
    !progress.lastChunkAt ||
    (totalChunks > 0 && progress.uploadedChunks >= totalChunks) ||
    Date.now() - progress.lastChunkAt <= LARGE_UPLOAD_CHUNK_TIMEOUT_MS
  ) {
    return { session, cancelled: false, deletedChunks: 0, progress };
  }

  const reason =
    `相邻分片上传间隔超过 ${LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES} 分钟，` +
    '任务已取消，已上传分片已删除';

  
  const updateResult = await config.database.prepare(`
    UPDATE bot_upload_sessions
    SET status = ?, error_message = ?, uploaded_chunks = 0, uploaded_bytes = 0
    WHERE id = ? AND status = ?
  `).bind(
    LARGE_UPLOAD_SESSION_STATUS.CANCELLED,
    reason,
    session.id,
    LARGE_UPLOAD_SESSION_STATUS.UPLOADING
  ).run();

  if (!updateResult.meta || Number(updateResult.meta.changes || 0) <= 0) {
    const current = await config.database.prepare(
      'SELECT * FROM bot_upload_sessions WHERE id = ? LIMIT 1'
    ).bind(session.id).first();
    return { session: current || session, cancelled: false, deletedChunks: 0 };
  }

  
  const deletedChunks = await abortPendingChunkUpload(
    session.upload_id,
    session.chat_id,
    config
  );

  const cancelledSession = await config.database.prepare(
    'SELECT * FROM bot_upload_sessions WHERE id = ? LIMIT 1'
  ).bind(session.id).first();

  
  try {
    await sendMessage(
      session.chat_id,
      `⏱️ <b>大文件上传任务已取消</b>

` +
      `原因：两个分片间隔超过 ${LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES} 分钟
` +
      `已清理分片：${deletedChunks} 个

` +
      '请重新点击“上传大文件”创建新任务',
      config.tgBotToken
    );
  } catch (notifyError) {
    console.warn('发送大文件超时取消通知失败:', notifyError.message);
  }

  return {
    session: cancelledSession || { ...session, status: LARGE_UPLOAD_SESSION_STATUS.CANCELLED, error_message: reason },
    cancelled: true,
    deletedChunks
  };
}

export async function enforceLargeUploadChunkTimeout(session, config) {
  const result = await cancelLargeUploadSessionForChunkTimeout(session, config);
  return result.session || session;
}

export async function cleanupStaleLargeUploadSessions(config, limit = 100) {
  const cutoff = Date.now() - LARGE_UPLOAD_CHUNK_TIMEOUT_MS;
  const result = await config.database.prepare(`
    SELECT s.*
    FROM bot_upload_sessions s
    WHERE s.status = ?
      AND s.total_chunks > 0
      AND (
        SELECT COUNT(*)
        FROM file_chunks c
        WHERE c.upload_id = s.upload_id
          AND c.chat_id = s.chat_id
          AND c.file_id IS NULL
      ) > 0
      AND (
        SELECT COUNT(*)
        FROM file_chunks c
        WHERE c.upload_id = s.upload_id
          AND c.chat_id = s.chat_id
          AND c.file_id IS NULL
      ) < s.total_chunks
      AND (
        SELECT MAX(c.created_at)
        FROM file_chunks c
        WHERE c.upload_id = s.upload_id
          AND c.chat_id = s.chat_id
          AND c.file_id IS NULL
      ) < ?
    ORDER BY s.id ASC
    LIMIT ?
  `).bind(
    LARGE_UPLOAD_SESSION_STATUS.UPLOADING,
    cutoff,
    Math.max(1, Number(limit || 100))
  ).all();

  let cancelled = 0;
  let deletedChunks = 0;
  for (const session of result.results || []) {
    const cleanup = await cancelLargeUploadSessionForChunkTimeout(session, config);
    if (cleanup.cancelled) {
      cancelled += 1;
      deletedChunks += Number(cleanup.deletedChunks || 0);
    }
  }
  return { cancelled, deletedChunks };
}

export async function buildLargeUploadStatusPayload(session, config) {
  const progress = await getLargeUploadProgress(session, config);
  const fileSize = Number(session.file_size || 0);
  const percent = fileSize > 0
    ? Math.min(100, Math.round(progress.uploadedBytes / fileSize * 10000) / 100)
    : 0;
  const cancelled = isLargeUploadSessionCancelled(session);
  const chunkDeadlineAt =
    progress.lastChunkAt > 0 &&
    progress.uploadedChunks > 0 &&
    progress.uploadedChunks < Number(session.total_chunks || 0)
      ? progress.lastChunkAt + LARGE_UPLOAD_CHUNK_TIMEOUT_MS
      : 0;

  return {
    status: String(session.status || LARGE_UPLOAD_SESSION_STATUS.PENDING),
    expired: isLargeUploadSessionExpired(session),
    cancelled,
    closePage: cancelled,
    canStart:
      !cancelled &&
      (!isLargeUploadSessionExpired(session) || mayContinueLargeUploadSession(session)),
    expiresAt: Number(session.expires_at || 0),
    fileName: session.file_name || '',
    fileSize,
    mimeType: session.mime_type || '',
    totalChunks: Number(session.total_chunks || 0),
    uploadedChunks: progress.uploadedChunks,
    uploadedBytes: progress.uploadedBytes,
    uploadedIndexes: progress.uploadedIndexes,
    lastChunkAt: progress.lastChunkAt,
    chunkDeadlineAt,
    chunkTimeoutMinutes: LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES,
    progress: percent,
    resultUrl: session.result_url || '',
    error: session.error_message || ''
  };
}

// 处理大文件上传接口
export async function handleLargeUploadPageRequest(request, config) {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const token = getLargeUploadTokenFromRequest(request);
  let session = await getLargeUploadSessionByToken(token, config);
  if (!session) {
    return new Response(generateLargeUploadMessagePage(
      '上传页面无效',
      '该上传链接不存在或已被新的链接替换，请返回机器人重新点击“上传大文件”'
    ), {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' }
    });
  }

  session = await enforceLargeUploadChunkTimeout(session, config);

  
  
  if (
    String(session.status || '') === LARGE_UPLOAD_SESSION_STATUS.PENDING &&
    isLargeUploadSessionExpired(session)
  ) {
    return new Response(generateLargeUploadMessagePage(
      '上传页面已过期',
      `该页面在创建后 ${Number(config.updateTimeMinutes || 20)} 分钟内未开始上传，请返回机器人重新生成`
    ), {
      status: 410,
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' }
    });
  }

  const categories = await config.database.prepare(`
    SELECT id, name
    FROM categories
    ORDER BY CASE WHEN name = '默认分类' THEN 0 ELSE 1 END, id ASC
  `).all();
  const categoryOptions = (categories.results || []).map(category => {
    const selected = Number(category.id) === Number(session.category_id) ? ' selected' : '';
    return `<option value="${Number(category.id)}"${selected}>${escapeHtml(category.name)}</option>`;
  }).join('');
  const statusPayload = await buildLargeUploadStatusPayload(session, config);

  return new Response(generateLargeUploadPage({
    token,
    categoryOptions,
    statusPayload,
    chunkSizeBytes: getTelegramChunkSizeBytes(config),
    maxSizeBytes: Number(config.maxSizeMB || 1024) * 1024 * 1024,
    updateTimeMinutes: Number(config.updateTimeMinutes || 20)
  }), {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

export async function handleLargeUploadStatusRequest(request, config) {
  if (request.method !== 'GET') {
    return largeUploadJson({ status: 0, error: '只支持 GET' }, 405);
  }
  const token = getLargeUploadTokenFromRequest(request);
  let session = await getLargeUploadSessionByToken(token, config);
  if (!session) return largeUploadJson({ status: 0, error: '上传会话不存在' }, 404);
  session = await enforceLargeUploadChunkTimeout(session, config);
  return largeUploadJson({
    status: 1,
    session: await buildLargeUploadStatusPayload(session, config)
  });
}

export async function resolveLargeUploadCategory(categoryValue, session, config) {
  let categoryId = Number(categoryValue || session.category_id || 0);
  if (Number.isInteger(categoryId) && categoryId > 0) {
    const category = await config.database.prepare(
      'SELECT id FROM categories WHERE id = ? LIMIT 1'
    ).bind(categoryId).first();
    if (category) return Number(category.id);
  }
  const defaultCategory = await config.database.prepare(
    'SELECT id FROM categories WHERE name = ? LIMIT 1'
  ).bind('默认分类').first();
  return defaultCategory ? Number(defaultCategory.id) : null;
}

export async function handleLargeUploadChunkRequest(request, config) {
  if (request.method !== 'POST') {
    return largeUploadJson({ status: 0, error: '只支持 POST' }, 405);
  }

  try {
    const formData = await request.formData();
    const token = getLargeUploadTokenFromRequest(request, formData);
    let session = await getLargeUploadSessionByToken(token, config);
    if (!session) throw new Error('上传会话不存在');
    session = await enforceLargeUploadChunkTimeout(session, config);
    if (isLargeUploadSessionCancelled(session)) {
      return largeUploadJson({
        status: 0,
        cancelled: true,
        closePage: true,
        error: session.error_message || '上传任务已取消'
      }, 410);
    }
    if (session.status === LARGE_UPLOAD_SESSION_STATUS.COMPLETED) {
      return largeUploadJson({ status: 1, completed: true, url: session.result_url });
    }
    if (isLargeUploadSessionExpired(session) && !mayContinueLargeUploadSession(session)) {
      throw new Error('上传页面已过期，请返回机器人重新生成');
    }

    const chunk = formData.get('chunk');
    const chunkIndex = Number(formData.get('chunk_index'));
    const totalChunks = Number(formData.get('total_chunks'));
    const fileName = sanitizeTelegramFileName(formData.get('file_name'), 'large-file.bin');
    const fileSize = Number(formData.get('file_size') || 0);
    const mimeType = String(formData.get('mime_type') || 'application/octet-stream');
    const categoryId = await resolveLargeUploadCategory(formData.get('category'), session, config);
    const maxChunkSize = getTelegramChunkSizeBytes(config);

    if (!chunk || typeof chunk.slice !== 'function') throw new Error('缺少分片数据');
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error('chunk_index 无效');
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || chunkIndex >= totalChunks) {
      throw new Error('total_chunks 无效');
    }
    if (fileSize <= 0 || fileSize > Number(config.maxSizeMB) * 1024 * 1024) {
      throw new Error(`文件超过${config.maxSizeMB}MB限制或大小无效`);
    }
    if (totalChunks !== Math.ceil(fileSize / maxChunkSize)) {
      throw new Error('total_chunks 与文件大小不匹配');
    }
    const expectedChunkSize = chunkIndex < totalChunks - 1
      ? maxChunkSize
      : fileSize - maxChunkSize * (totalChunks - 1);
    if (Number(chunk.size) !== expectedChunkSize) {
      throw new Error(`第 ${chunkIndex + 1} 片大小不正确`);
    }

    if (session.status === LARGE_UPLOAD_SESSION_STATUS.PENDING) {
      await config.database.prepare(`
        UPDATE bot_upload_sessions
        SET status = ?, category_id = ?, file_name = ?, file_size = ?,
            mime_type = ?, total_chunks = ?, started_at = ?, error_message = NULL
        WHERE id = ? AND status = ?
      `).bind(
        LARGE_UPLOAD_SESSION_STATUS.UPLOADING,
        categoryId,
        fileName,
        fileSize,
        mimeType,
        totalChunks,
        Date.now(),
        session.id,
        LARGE_UPLOAD_SESSION_STATUS.PENDING
      ).run();
      session = await config.database.prepare(
        'SELECT * FROM bot_upload_sessions WHERE id = ? LIMIT 1'
      ).bind(session.id).first();
    } else {
      if (String(session.file_name || '') !== fileName || Number(session.file_size) !== fileSize) {
        throw new Error('所选文件与当前上传会话中的文件不一致');
      }
      if (Number(session.total_chunks) !== totalChunks) {
        throw new Error('分片数量与当前上传会话不一致');
      }
    }

    await uploadOneTelegramChunk(
      chunk,
      session.upload_id,
      chunkIndex,
      totalChunks,
      fileName,
      session.chat_id,
      config
    );

    
    
    session = await config.database.prepare(
      'SELECT * FROM bot_upload_sessions WHERE id = ? LIMIT 1'
    ).bind(session.id).first();
    if (isLargeUploadSessionCancelled(session)) {
      await abortPendingChunkUpload(session.upload_id, session.chat_id, config);
      return largeUploadJson({
        status: 0,
        cancelled: true,
        closePage: true,
        error: session.error_message || '上传任务已取消'
      }, 410);
    }

    const progress = await getLargeUploadProgress(session, config);
    await config.database.prepare(`
      UPDATE bot_upload_sessions
      SET uploaded_chunks = ?, uploaded_bytes = ?, error_message = NULL
      WHERE id = ?
    `).bind(progress.uploadedChunks, progress.uploadedBytes, session.id).run();

    return largeUploadJson({
      status: 1,
      chunkIndex,
      uploadedChunks: progress.uploadedChunks,
      uploadedBytes: progress.uploadedBytes,
      totalChunks,
      progress: Math.min(100, Math.round(progress.uploadedBytes / fileSize * 10000) / 100)
    });
  } catch (error) {
    console.error('[Large Upload Chunk Error]', error);
    return largeUploadJson({ status: 0, error: error.message }, 400);
  }
}

export async function handleLargeUploadCompleteRequest(request, config) {
  if (request.method !== 'POST') {
    return largeUploadJson({ status: 0, error: '只支持 POST' }, 405);
  }

  let session = null;
  try {
    const body = await request.json();
    const token = getLargeUploadTokenFromRequest(request, body);
    session = await getLargeUploadSessionByToken(token, config);
    if (!session) throw new Error('上传会话不存在');
    session = await enforceLargeUploadChunkTimeout(session, config);
    if (isLargeUploadSessionCancelled(session)) {
      return largeUploadJson({
        status: 0,
        cancelled: true,
        closePage: true,
        error: session.error_message || '上传任务已取消'
      }, 410);
    }
    if (session.status === LARGE_UPLOAD_SESSION_STATUS.COMPLETED) {
      return largeUploadJson({ status: 1, completed: true, url: session.result_url });
    }
    if (![LARGE_UPLOAD_SESSION_STATUS.UPLOADING, LARGE_UPLOAD_SESSION_STATUS.FINALIZING].includes(session.status)) {
      throw new Error('上传尚未开始或当前状态不可完成');
    }

    await config.database.prepare(`
      UPDATE bot_upload_sessions
      SET status = ?, error_message = NULL
      WHERE id = ?
    `).bind(LARGE_UPLOAD_SESSION_STATUS.FINALIZING, session.id).run();

    const file = await finalizeChunkedTelegramUpload({
      uploadId: session.upload_id,
      chatId: session.chat_id,
      fileName: session.file_name,
      fileSize: Number(session.file_size),
      mimeType: session.mime_type || 'application/octet-stream',
      categoryId: session.category_id || null,
      key: generateSafeKey(session.file_name),
      totalChunks: Number(session.total_chunks)
    }, config);

    const completedAt = Date.now();
    await config.database.prepare(`
      UPDATE bot_upload_sessions
      SET status = ?, result_file_id = ?, result_url = ?,
          uploaded_chunks = total_chunks, uploaded_bytes = file_size,
          completed_at = ?, error_message = NULL
      WHERE id = ?
    `).bind(
      LARGE_UPLOAD_SESSION_STATUS.COMPLETED,
      file.id,
      file.url,
      completedAt,
      session.id
    ).run();

    
    try {
      await sendUploadCompletedWithQr({
        chatId: session.chat_id,
        title: '大文件上传完成',
        fileName: session.file_name,
        fileSize: Number(session.file_size || 0),
        url: file.url,
        chunkCount: Number(session.total_chunks || 0)
      }, config);
    } catch (notifyError) {
      console.warn('发送大文件合并完成消息失败:', notifyError.message);
      await sendMessage(
        session.chat_id,
        buildUploadCompletedCaption({
          title: '大文件上传完成',
          fileName: session.file_name,
          fileSize: Number(session.file_size || 0),
          url: file.url,
          chunkCount: Number(session.total_chunks || 0),
          includeQrHint: false
        }),
        config.tgBotToken
      );
    }

    return largeUploadJson({
      status: 1,
      completed: true,
      url: file.url,
      fileName: session.file_name,
      fileSize: Number(session.file_size || 0),
      chunkCount: Number(session.total_chunks || 0)
    });
  } catch (error) {
    console.error('[Large Upload Complete Error]', error);
    if (session && session.id) {
      await config.database.prepare(`
        UPDATE bot_upload_sessions
        SET status = ?, error_message = ?
        WHERE id = ?
      `).bind(
        LARGE_UPLOAD_SESSION_STATUS.UPLOADING,
        String(error.message || '完成上传失败').slice(0, 500),
        session.id
      ).run().catch(() => null);
    }
    return largeUploadJson({ status: 0, error: error.message }, 400);
  }
}
