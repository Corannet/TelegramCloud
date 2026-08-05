// 独立上传网页

import {
  getWebOwnerChatId
} from './auth.js'

import {
  sha256Hex
} from './large-upload.js'

import {
  normalizeUploadPageAllowedTypes,
  getUploadPageFileTypeKey,
  isUploadPageFileAllowed
} from './upload-page-types.js'

export {
  normalizeUploadPageAllowedTypes,
  getUploadPageFileTypeKey,
  isUploadPageFileAllowed
} from './upload-page-types.js'

import {
  generateSafeKey,
  createRandomIdentifier,
  normalizeUploadId,
  sanitizeTelegramFileName,
  getTelegramChunkSizeBytes,
  uploadOneTelegramChunk,
  abortPendingChunkUpload,
  finalizeChunkedTelegramUpload,
  saveTelegramFileFromBlob,
  deleteStoredFileRecord,
  getContentType
} from './storage.js'

import {
  generateLargeUploadMessagePage
} from './templates-large-upload.js'

import {
  generateUploadPageManagementPage,
  generatePublicUploadPage
} from './templates-upload-pages.js'

// 校验上传网页配置
export function normalizeUploadPageSlug(value) {
  const slug = String(value || '').trim();
  return /^[A-Za-z0-9_-]{3,50}$/.test(slug) ? slug : null;
}

export function normalizeUploadPageClientToken(value) {
  const token = String(value || '').trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
}

export async function getUploadPageClientHash(request, bodyOrForm = null) {
  const token = normalizeUploadPageClientToken(
    request.headers.get('X-Upload-Client-Token') ||
    (bodyOrForm && typeof bodyOrForm.get === 'function' ? bodyOrForm.get('client_token') : null) ||
    (bodyOrForm && bodyOrForm.client_token)
  );
  if (!token) throw new Error('客户端身份标识无效');
  return sha256Hex(token);
}

export function uploadPageJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function ensureDefaultCategoryId(config) {
  let category = await config.database.prepare(
    'SELECT id FROM categories WHERE name = ? LIMIT 1'
  ).bind('默认分类').first();
  if (category) return category.id;
  const result = await config.database.prepare(
    'INSERT INTO categories (name, created_at) VALUES (?, ?)'
  ).bind('默认分类', Date.now()).run();
  return result.meta && result.meta.last_row_id;
}

export async function getUploadPageBySlug(slug, config) {
  const normalized = normalizeUploadPageSlug(slug);
  if (!normalized) return null;
  return config.database.prepare(`
    SELECT * FROM upload_pages
    WHERE slug = ?
    LIMIT 1
  `).bind(normalized).first();
}

export async function createUniqueUploadPageSlug(config, length = 8) {
  const safeLength = Math.max(3, Math.min(50, Math.floor(Number(length) || 8)));
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = createRandomIdentifier(safeLength);
    const existing = await config.database.prepare(
      'SELECT id FROM upload_pages WHERE slug = ? LIMIT 1'
    ).bind(slug).first();
    if (!existing) return slug;
  }
  throw new Error('无法生成唯一上传网页链接');
}

// 管理上传网页
export async function listUploadPages(config) {
  const result = await config.database.prepare(`
    SELECT
      p.id,
      p.slug,
      p.title,
      p.max_size_mb,
      p.allowed_types,
      p.storage_type,
      p.created_at,
      COUNT(f.id) AS file_count
    FROM upload_pages p
    LEFT JOIN upload_page_files upf ON upf.page_id = p.id
    LEFT JOIN files f ON f.id = upf.file_id
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
  `).all();
  return (result.results || []).map(row => ({
    ...row,
    allowed_types: normalizeUploadPageAllowedTypes(row.allowed_types),
    url: `https://${config.domain}/updata/${row.slug}`,
    file_count: Number(row.file_count || 0)
  }));
}

export async function handleUploadPageManagementRequest(request, config) {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  return new Response(generateUploadPageManagementPage(config.maxSizeMB), {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function handleListUploadPagesRequest(request, config) {
  if (request.method !== 'GET') {
    return uploadPageJson({ status: 0, error: '只支持 GET' }, 405);
  }
  return uploadPageJson({ status: 1, pages: await listUploadPages(config) });
}

export async function handleCreateUploadPageRequest(request, config) {
  if (request.method !== 'POST') {
    return uploadPageJson({ status: 0, error: '只支持 POST' }, 405);
  }
  try {
    const body = await request.json();
    const customSlugText = String(body.slug || '').trim();
    let slug = null;
    if (customSlugText) {
      slug = normalizeUploadPageSlug(customSlugText);
      if (!slug) throw new Error('链接标识只能包含字母数字下划线和短横线且长度为三到五十位');
      const existing = await config.database.prepare(
        'SELECT id FROM upload_pages WHERE slug = ? LIMIT 1'
      ).bind(slug).first();
      if (existing) throw new Error('该链接标识已被使用');
    } else {
      const randomLength = Number(body.random_length || 8);
      if (!Number.isInteger(randomLength) || randomLength < 3 || randomLength > 50) {
        throw new Error('随机标识长度必须为三到五十位整数');
      }
      slug = await createUniqueUploadPageSlug(config, randomLength);
    }

    const title = String(body.title || '上传页面').trim().slice(0, 80) || '上传页面';
    const defaultMaxSize = Math.min(20, Number(config.maxSizeMB) || 20);
    const maxSizeMB = Math.floor(Number(body.max_size_mb) || defaultMaxSize);
    if (maxSizeMB < 1 || maxSizeMB > Number(config.maxSizeMB)) {
      throw new Error(`上传大小必须在一到${config.maxSizeMB}MB之间`);
    }
    const allowedTypes = normalizeUploadPageAllowedTypes(body.allowed_types);
    await config.database.prepare(`
      INSERT INTO upload_pages (
        slug,
        title,
        max_size_mb,
        allowed_types,
        storage_type,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, 'telegram', ?, ?)
    `).bind(
      slug,
      title,
      maxSizeMB,
      JSON.stringify(allowedTypes),
      'web_admin',
      Date.now()
    ).run();

    const page = await getUploadPageBySlug(slug, config);
    return uploadPageJson({
      status: 1,
      page: {
        ...page,
        allowed_types: allowedTypes,
        url: `https://${config.domain}/updata/${slug}`,
        file_count: 0
      }
    });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export async function handleDeleteUploadPageRequest(request, config) {
  if (request.method !== 'POST') {
    return uploadPageJson({ status: 0, error: '只支持 POST' }, 405);
  }
  try {
    const body = await request.json();
    const pageId = Number(body.id || 0);
    if (!Number.isInteger(pageId) || pageId <= 0) throw new Error('网页标识无效');
    const page = await config.database.prepare(
      'SELECT * FROM upload_pages WHERE id = ? LIMIT 1'
    ).bind(pageId).first();
    if (!page) throw new Error('上传网页不存在');

    const sessions = await config.database.prepare(`
      SELECT upload_id, chat_id
      FROM upload_page_sessions
      WHERE page_id = ?
    `).bind(pageId).all();
    for (const session of sessions.results || []) {
      await abortPendingChunkUpload(session.upload_id, session.chat_id, config);
    }
    await config.database.prepare(
      'DELETE FROM upload_page_sessions WHERE page_id = ?'
    ).bind(pageId).run();
    await config.database.prepare(
      'DELETE FROM upload_page_files WHERE page_id = ?'
    ).bind(pageId).run();
    await config.database.prepare(
      'DELETE FROM upload_pages WHERE id = ?'
    ).bind(pageId).run();

    return uploadPageJson({ status: 1, message: '上传网页已删除且原直链继续可用' });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export async function handlePublicUploadPageRequest(request, config, slug) {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const page = await getUploadPageBySlug(slug, config);
  if (!page) {
    return new Response(generateLargeUploadMessagePage('页面不存在', '该上传页面已删除或链接无效'), {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
  return new Response(generatePublicUploadPage(page, config), {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

// 管理访客文件归属
export async function linkUploadPageFile(pageId, fileId, clientHash, config) {
  await config.database.prepare(`
    INSERT OR IGNORE INTO upload_page_files (
      page_id,
      file_id,
      client_hash,
      created_at
    ) VALUES (?, ?, ?, ?)
  `).bind(pageId, fileId, clientHash, Date.now()).run();
}

export async function findFileRecordByUrl(url, config) {
  return config.database.prepare(
    'SELECT * FROM files WHERE url = ? LIMIT 1'
  ).bind(url).first();
}

export async function handlePublicUploadFilesRequest(request, config, page) {
  if (request.method !== 'GET') {
    return uploadPageJson({ status: 0, error: '只支持 GET' }, 405);
  }
  try {
    const clientHash = await getUploadPageClientHash(request);
    const result = await config.database.prepare(`
      SELECT
        f.id,
        f.url,
        f.file_name,
        f.file_size,
        f.mime_type,
        f.created_at
      FROM upload_page_files upf
      INNER JOIN files f ON f.id = upf.file_id
      WHERE upf.page_id = ? AND upf.client_hash = ?
      ORDER BY upf.created_at DESC, upf.id DESC
      LIMIT 300
    `).bind(page.id, clientHash).all();
    return uploadPageJson({ status: 1, files: result.results || [] });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export function validatePublicUploadFile(page, fileName, fileSize, mimeType, config) {
  const size = Number(fileSize || 0);
  if (!fileName || size <= 0) throw new Error('文件信息无效');
  const pageLimit = Number(page.max_size_mb || 1) * 1024 * 1024;
  const globalLimit = Number(config.maxSizeMB || 1) * 1024 * 1024;
  if (size > pageLimit) throw new Error(`文件超过${page.max_size_mb}MB限制`);
  if (size > globalLimit) throw new Error(`文件超过${config.maxSizeMB}MB全局限制`);
  if (!isUploadPageFileAllowed(page, mimeType, fileName)) {
    throw new Error('当前上传网页不允许此文件类型');
  }
}

export async function savePublicUploadFile(page, file, clientHash, config) {
  const chatId = getWebOwnerChatId(config);
  if (!chatId) throw new Error('未配置 TG_ADMIN_ID');
  const fileName = sanitizeTelegramFileName(file.name, 'upload.bin');
  const mimeType = String(file.type || getContentType(fileName.split('.').pop()) || 'application/octet-stream');
  validatePublicUploadFile(page, fileName, file.size, mimeType, config);
  const categoryId = await ensureDefaultCategoryId(config);
  const key = generateSafeKey(fileName);
  const saved = await saveTelegramFileFromBlob({
    blob: file,
    fileName,
    fileSize: file.size,
    mimeType,
    categoryId,
    chatId,
    key
  }, config);
  const record = await findFileRecordByUrl(saved.url, config);
  if (!record) throw new Error('上传完成后未找到文件记录');
  await linkUploadPageFile(page.id, record.id, clientHash, config);
  return record;
}

export async function handlePublicUploadFileRequest(request, config, page) {
  if (request.method !== 'POST') {
    return uploadPageJson({ status: 0, error: '只支持 POST' }, 405);
  }
  try {
    const formData = await request.formData();
    const clientHash = await getUploadPageClientHash(request, formData);
    const file = formData.get('file');
    if (!file || typeof file.slice !== 'function') throw new Error('未找到上传文件');
    const record = await savePublicUploadFile(page, file, clientHash, config);
    return uploadPageJson({
      status: 1,
      file: {
        id: record.id,
        url: record.url,
        file_name: record.file_name,
        file_size: record.file_size,
        mime_type: record.mime_type,
        created_at: record.created_at
      }
    });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export async function getOrCreateUploadPageSession(page, clientHash, metadata, config) {
  let session = await config.database.prepare(
    'SELECT * FROM upload_page_sessions WHERE upload_id = ? LIMIT 1'
  ).bind(metadata.uploadId).first();
  if (session) {
    if (Number(session.page_id) !== Number(page.id) || session.client_hash !== clientHash) {
      throw new Error('上传任务不属于当前客户端');
    }
    if (
      String(session.file_name) !== metadata.fileName ||
      Number(session.file_size) !== metadata.fileSize ||
      String(session.mime_type) !== metadata.mimeType ||
      Number(session.total_chunks) !== metadata.totalChunks
    ) {
      throw new Error('上传任务参数不一致');
    }
    return session;
  }

  const chatId = getWebOwnerChatId(config);
  if (!chatId) throw new Error('未配置 TG_ADMIN_ID');
  const categoryId = await ensureDefaultCategoryId(config);
  await config.database.prepare(`
    INSERT INTO upload_page_sessions (
      upload_id,
      page_id,
      client_hash,
      chat_id,
      category_id,
      file_name,
      file_size,
      mime_type,
      total_chunks,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?)
  `).bind(
    metadata.uploadId,
    page.id,
    clientHash,
    chatId,
    categoryId,
    metadata.fileName,
    metadata.fileSize,
    metadata.mimeType,
    metadata.totalChunks,
    Date.now()
  ).run();
  return config.database.prepare(
    'SELECT * FROM upload_page_sessions WHERE upload_id = ? LIMIT 1'
  ).bind(metadata.uploadId).first();
}

// 处理访客分片上传
export async function handlePublicUploadChunkRequest(request, config, page) {
  if (request.method !== 'POST') {
    return uploadPageJson({ status: 0, error: '只支持 POST' }, 405);
  }
  try {
    const formData = await request.formData();
    const clientHash = await getUploadPageClientHash(request, formData);
    const uploadId = normalizeUploadId(formData.get('upload_id'));
    const chunk = formData.get('chunk');
    const chunkIndex = Number(formData.get('chunk_index'));
    const totalChunks = Number(formData.get('total_chunks'));
    const fileName = sanitizeTelegramFileName(formData.get('file_name'), 'upload.bin');
    const fileSize = Number(formData.get('file_size') || 0);
    const mimeType = String(formData.get('mime_type') || 'application/octet-stream');
    if (!uploadId) throw new Error('上传任务标识无效');
    if (!chunk || typeof chunk.slice !== 'function') throw new Error('缺少分片数据');
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error('分片序号无效');
    if (!Number.isInteger(totalChunks) || totalChunks <= 1 || chunkIndex >= totalChunks) throw new Error('分片总数无效');
    validatePublicUploadFile(page, fileName, fileSize, mimeType, config);
    const chunkSize = getTelegramChunkSizeBytes(config);
    if (Number(chunk.size) <= 0 || Number(chunk.size) > chunkSize) throw new Error('分片大小无效');
    if (totalChunks !== Math.ceil(fileSize / chunkSize)) throw new Error('分片总数与文件大小不匹配');

    const session = await getOrCreateUploadPageSession(page, clientHash, {
      uploadId,
      fileName,
      fileSize,
      mimeType,
      totalChunks
    }, config);
    const saved = await uploadOneTelegramChunk(
      chunk,
      uploadId,
      chunkIndex,
      totalChunks,
      fileName,
      session.chat_id,
      config
    );
    return uploadPageJson({
      status: 1,
      chunk_index: chunkIndex,
      chunk_size: Number(saved.chunk_size || chunk.size)
    });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export async function handlePublicUploadCompleteRequest(request, config, page) {
  if (request.method !== 'POST') {
    return uploadPageJson({ status: 0, error: '只支持 POST' }, 405);
  }
  try {
    const body = await request.json();
    const clientHash = await getUploadPageClientHash(request, body);
    const uploadId = normalizeUploadId(body.upload_id);
    if (!uploadId) throw new Error('上传任务标识无效');
    const session = await config.database.prepare(`
      SELECT * FROM upload_page_sessions
      WHERE upload_id = ? AND page_id = ? AND client_hash = ?
      LIMIT 1
    `).bind(uploadId, page.id, clientHash).first();
    if (!session) throw new Error('上传任务不存在');
    const file = await finalizeChunkedTelegramUpload({
      uploadId,
      chatId: session.chat_id,
      fileName: session.file_name,
      fileSize: session.file_size,
      mimeType: session.mime_type,
      categoryId: session.category_id,
      key: generateSafeKey(session.file_name),
      totalChunks: session.total_chunks
    }, config);
    await linkUploadPageFile(page.id, file.id, clientHash, config);
    await config.database.prepare(
      'DELETE FROM upload_page_sessions WHERE upload_id = ?'
    ).bind(uploadId).run();
    return uploadPageJson({
      status: 1,
      file: {
        id: file.id,
        url: file.url,
        file_name: file.file_name,
        file_size: file.file_size,
        mime_type: file.mime_type,
        created_at: file.created_at
      }
    });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export async function handlePublicUploadAbortRequest(request, config, page) {
  if (request.method !== 'POST') {
    return uploadPageJson({ status: 0, error: '只支持 POST' }, 405);
  }
  try {
    const body = await request.json();
    const clientHash = await getUploadPageClientHash(request, body);
    const uploadId = normalizeUploadId(body.upload_id);
    if (!uploadId) throw new Error('上传任务标识无效');
    const session = await config.database.prepare(`
      SELECT * FROM upload_page_sessions
      WHERE upload_id = ? AND page_id = ? AND client_hash = ?
      LIMIT 1
    `).bind(uploadId, page.id, clientHash).first();
    if (!session) return uploadPageJson({ status: 1, deleted: 0 });
    const deleted = await abortPendingChunkUpload(uploadId, session.chat_id, config);
    await config.database.prepare(
      'DELETE FROM upload_page_sessions WHERE upload_id = ?'
    ).bind(uploadId).run();
    return uploadPageJson({ status: 1, deleted });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export async function handlePublicUploadDeleteRequest(request, config, page) {
  if (request.method !== 'POST') {
    return uploadPageJson({ status: 0, error: '只支持 POST' }, 405);
  }
  try {
    const body = await request.json();
    const clientHash = await getUploadPageClientHash(request, body);
    const fileId = Number(body.file_id || 0);
    if (!Number.isInteger(fileId) || fileId <= 0) throw new Error('文件标识无效');
    const association = await config.database.prepare(`
      SELECT upf.id AS relation_id, f.*
      FROM upload_page_files upf
      INNER JOIN files f ON f.id = upf.file_id
      WHERE upf.page_id = ? AND upf.client_hash = ? AND upf.file_id = ?
      LIMIT 1
    `).bind(page.id, clientHash, fileId).first();
    if (!association) throw new Error('文件不存在或不属于当前客户端');
    await config.database.prepare(
      'DELETE FROM upload_page_files WHERE id = ?'
    ).bind(association.relation_id).run();
    await deleteStoredFileRecord(association, config);
    return uploadPageJson({ status: 1, message: '文件已删除' });
  } catch (error) {
    return uploadPageJson({ status: 0, error: error.message }, 400);
  }
}

export async function handlePublicUploadApiRequest(request, config, slug, action) {
  const page = await getUploadPageBySlug(slug, config);
  if (!page) return uploadPageJson({ status: 0, error: '上传网页不存在' }, 404);
  const handlers = {
    files: handlePublicUploadFilesRequest,
    upload: handlePublicUploadFileRequest,
    chunk: handlePublicUploadChunkRequest,
    complete: handlePublicUploadCompleteRequest,
    abort: handlePublicUploadAbortRequest,
    delete: handlePublicUploadDeleteRequest
  };
  const handler = handlers[action];
  if (!handler) return uploadPageJson({ status: 0, error: '接口不存在' }, 404);
  return handler(request, config, page);
}

export async function cleanupStaleUploadPageSessions(config, limit = 100) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const result = await config.database.prepare(`
    SELECT upload_id, chat_id
    FROM upload_page_sessions
    WHERE created_at < ?
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(cutoff, limit).all();
  let deletedSessions = 0;
  let deletedChunks = 0;
  for (const session of result.results || []) {
    deletedChunks += await abortPendingChunkUpload(session.upload_id, session.chat_id, config);
    await config.database.prepare(
      'DELETE FROM upload_page_sessions WHERE upload_id = ?'
    ).bind(session.upload_id).run();
    deletedSessions++;
  }
  return { deletedSessions, deletedChunks };
}
