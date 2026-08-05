// 管理端文件上传

import {
  getWebOwnerChatId,
  authenticate
} from './auth.js'

import {
  generateSafeKey,
  createPublicFileIdentity,
  normalizeUploadId,
  sanitizeTelegramFileName,
  getTelegramChunkSizeBytes,
  uploadOneTelegramChunk,
  abortPendingChunkUpload,
  insertFileRecord,
  finalizeChunkedTelegramUpload,
  saveTelegramFileFromBlob,
  getContentType
} from './storage.js'

import {
  generateUploadPage
} from './templates-upload.js'

import {
  escapeHtml
} from './utils.js'

// 处理管理端分类
export async function handleCreateCategoryRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return new Response(JSON.stringify({ status: 0, msg: "未授权" }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  try {
    const { name } = await request.json();
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return new Response(JSON.stringify({ status: 0, msg: "分类名称不能为空" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const categoryName = name.trim();
    const time = Date.now();
    const existingCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
    if (existingCategory) {
      return new Response(JSON.stringify({ status: 0, msg: `分类 "${categoryName}" 已存在，请选择一个不同的名称！` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
      .bind(categoryName, time).run();
    const category = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
    return new Response(JSON.stringify({ status: 1, msg: "分类创建成功", category: { id: category.id, name: categoryName } }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ status: 0, msg: `创建分类失败：${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleDeleteCategoryRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return new Response(JSON.stringify({ status: 0, msg: "未授权" }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  try {
    const { id } = await request.json();
    if (!id || isNaN(id)) {
      return new Response(JSON.stringify({ status: 0, msg: "分类ID无效" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const isDefaultCategory = await config.database.prepare('SELECT id FROM categories WHERE id = ? AND name = ?')
      .bind(id, '默认分类').first();
    if (isDefaultCategory) {
      return new Response(JSON.stringify({ status: 0, msg: "默认分类不能删除" }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const category = await config.database.prepare('SELECT name FROM categories WHERE id = ?').bind(id).first();
    if (!category) {
      return new Response(JSON.stringify({ status: 0, msg: "分类不存在" }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?')
      .bind('默认分类').first();
    let defaultCategoryId;
    if (!defaultCategory) {
      const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
        .bind('默认分类', Date.now()).run();
      defaultCategoryId = result.meta && result.meta.last_row_id ? result.meta.last_row_id : null;
      console.log('创建了新的默认分类，ID:', defaultCategoryId);
    } else {
      defaultCategoryId = defaultCategory.id;
    }
    if (defaultCategoryId) {
      await config.database.prepare('UPDATE files SET category_id = ? WHERE category_id = ?')
        .bind(defaultCategoryId, id).run();
      await config.database.prepare('UPDATE user_settings SET current_category_id = ? WHERE current_category_id = ?')
        .bind(defaultCategoryId, id).run();
    } else {
      await config.database.prepare('UPDATE files SET category_id = NULL WHERE category_id = ?').bind(id).run();
      await config.database.prepare('UPDATE user_settings SET current_category_id = NULL WHERE current_category_id = ?').bind(id).run();
    }
    await config.database.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
    return new Response(JSON.stringify({ 
      status: 1, 
      msg: `分类 "${category.name}" 删除成功${defaultCategoryId ? '，相关文件已移至默认分类' : ''}` 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('删除分类失败:', error);
    return new Response(JSON.stringify({ status: 0, msg: `删除分类失败：${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理管理端文件上传
export async function handleUploadRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/`, 302);
  }

  const chatId = getWebOwnerChatId(config);
  if (!chatId) {
    return new Response('未配置 TG_ADMIN_ID，网页上传无法确定文件归属用户', {
      status: 500,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'no-store' }
    });
  }

  if (request.method === 'GET') {
    const categories = await config.database.prepare('SELECT id, name FROM categories').all();
    const categoryOptions = categories.results.length
      ? categories.results.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="">暂无分类</option>';
    let userSetting = await config.database.prepare(
      'SELECT * FROM user_settings WHERE chat_id = ?'
    ).bind(chatId).first();
    if (!userSetting) {
      const defaultCategory = await config.database.prepare(
        'SELECT id FROM categories WHERE name = ?'
      ).bind('默认分类').first();
      await config.database.prepare(`
        INSERT INTO user_settings (chat_id, storage_type, current_category_id)
        VALUES (?, ?, ?)
      `).bind(chatId, 'telegram', defaultCategory && defaultCategory.id).run();
      userSetting = {
        storage_type: 'telegram',
        current_category_id: defaultCategory && defaultCategory.id
      };
    }
    return new Response(generateUploadPage(categoryOptions, userSetting.storage_type), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const categoryId = formData.get('category');
    const storageType = formData.get('storage_type') === 'r2' ? 'r2' : 'telegram';
    if (!file || typeof file.slice !== 'function') throw new Error('未找到文件');
    if (Number(file.size) > Number(config.maxSizeMB) * 1024 * 1024) {
      throw new Error(`文件超过${config.maxSizeMB}MB限制`);
    }

    let defaultCategory = await config.database.prepare(
      'SELECT id FROM categories WHERE name = ?'
    ).bind('默认分类').first();
    if (!defaultCategory) {
      const result = await config.database.prepare(
        'INSERT INTO categories (name, created_at) VALUES (?, ?)'
      ).bind('默认分类', Date.now()).run();
      defaultCategory = { id: result.meta && result.meta.last_row_id };
    }
    const finalCategoryId = categoryId || (defaultCategory && defaultCategory.id) || null;
    await config.database.prepare(`
      UPDATE user_settings
      SET storage_type = ?, current_category_id = ?
      WHERE chat_id = ?
    `).bind(storageType, finalCategoryId, chatId).run();

    const rawExt = (file.name.split('.').pop() || '').toLowerCase();
    const mimeType = file.type || getContentType(rawExt);
    const key = generateSafeKey(file.name);
    let finalUrl;
    let chunked = false;
    let chunkCount = 0;

    if (storageType === 'r2') {
      if (!config.bucket) throw new Error('未配置R2存储桶(BUCKET)，无法使用R2存储');
      await config.bucket.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: mimeType }
      });
      const identity = await createPublicFileIdentity(config);
      finalUrl = identity.url;
      await insertFileRecord({
        publicId: identity.publicId,
        fileId: key,
        messageId: -1,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        storageType: 'r2',
        categoryId: finalCategoryId,
        chatId,
        isChunked: false
      }, config);
    } else {
      const saved = await saveTelegramFileFromBlob({
        blob: file,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        categoryId: finalCategoryId,
        chatId,
        key
      }, config);
      finalUrl = saved.url;
      chunked = saved.isChunked;
      chunkCount = saved.chunkCount;
    }

    return new Response(JSON.stringify({
      status: 1,
      msg: chunked ? `✔ 分片上传成功（${chunkCount}片）` : '✔ 上传成功',
      url: finalUrl,
      chunked,
      chunk_count: chunkCount
    }), {
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  } catch (error) {
    console.error(`[Upload Error] ${error.message}`);
    let statusCode = 500;
    if (error.message.includes('文件超过')) statusCode = 400;
    else if (error.message.includes('Telegram')) statusCode = 502;
    else if (error instanceof TypeError && error.message.includes('Failed to fetch')) statusCode = 504;
    return new Response(JSON.stringify({
      status: 0,
      msg: '✘ 上传失败',
      error: error.message
    }), {
      status: statusCode,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
}

export async function handleUploadChunkRequest(request, config) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ status: 0, error: '只支持 POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
  const chatId = getWebOwnerChatId(config);
  if (!chatId) throw new Error('未配置 TG_ADMIN_ID');

  try {
    const formData = await request.formData();
    const uploadId = normalizeUploadId(formData.get('upload_id'));
    const chunk = formData.get('chunk');
    const chunkIndex = Number(formData.get('chunk_index'));
    const totalChunks = Number(formData.get('total_chunks'));
    const fileName = String(formData.get('file_name') || 'large-file.bin');
    const fileSize = Number(formData.get('file_size') || 0);

    if (!uploadId) throw new Error('upload_id 格式无效');
    if (!chunk || typeof chunk.slice !== 'function') throw new Error('缺少分片数据');
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error('chunk_index 无效');
    if (!Number.isInteger(totalChunks) || totalChunks <= 1 || chunkIndex >= totalChunks) {
      throw new Error('total_chunks 无效');
    }
    if (fileSize <= 0 || fileSize > Number(config.maxSizeMB) * 1024 * 1024) {
      throw new Error(`文件超过${config.maxSizeMB}MB限制或大小无效`);
    }
    const maxChunkSize = getTelegramChunkSizeBytes(config);
    if (Number(chunk.size) <= 0 || Number(chunk.size) > maxChunkSize) {
      throw new Error(`单个分片必须大于0且不超过${config.telegramChunkSizeMB}MB`);
    }
    if (totalChunks !== Math.ceil(fileSize / maxChunkSize)) {
      throw new Error('total_chunks 与文件大小不匹配');
    }

    const saved = await uploadOneTelegramChunk(
      chunk,
      uploadId,
      chunkIndex,
      totalChunks,
      fileName,
      chatId,
      config
    );

    return new Response(JSON.stringify({
      status: 1,
      chunk_index: chunkIndex,
      chunk_size: Number(saved.chunk_size || chunk.size)
    }), {
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  } catch (error) {
    console.error('[Chunk Upload Error]', error);
    return new Response(JSON.stringify({ status: 0, error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
}

export async function handleUploadCompleteRequest(request, config) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ status: 0, error: '只支持 POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
  const chatId = getWebOwnerChatId(config);
  try {
    if (!chatId) throw new Error('未配置 TG_ADMIN_ID');
    const body = await request.json();
    const uploadId = normalizeUploadId(body.upload_id);
    const fileName = sanitizeTelegramFileName(body.file_name, 'large-file.bin');
    const fileSize = Number(body.file_size || 0);
    const mimeType = String(body.mime_type || 'application/octet-stream');
    const totalChunks = Number(body.total_chunks || 0);
    let categoryId = body.category || null;
    const key = body.key ? String(body.key) : generateSafeKey(fileName);

    if (!uploadId) throw new Error('upload_id 格式无效');
    if (!Number.isInteger(totalChunks) || totalChunks <= 1) throw new Error('total_chunks 无效');
    if (fileSize <= 0 || fileSize > Number(config.maxSizeMB) * 1024 * 1024) {
      throw new Error(`文件超过${config.maxSizeMB}MB限制或大小无效`);
    }
    const expectedChunks = Math.ceil(fileSize / getTelegramChunkSizeBytes(config));
    if (totalChunks !== expectedChunks) {
      throw new Error(`total_chunks 不匹配：应为 ${expectedChunks}`);
    }
    if (!categoryId) {
      const defaultCategory = await config.database.prepare(
        'SELECT id FROM categories WHERE name = ? LIMIT 1'
      ).bind('默认分类').first();
      categoryId = defaultCategory && defaultCategory.id;
    }

    await config.database.prepare(`
      UPDATE user_settings
      SET storage_type = 'telegram', current_category_id = ?
      WHERE chat_id = ?
    `).bind(categoryId || null, chatId).run();

    const file = await finalizeChunkedTelegramUpload({
      uploadId,
      chatId,
      fileName,
      fileSize,
      mimeType,
      categoryId,
      key,
      totalChunks
    }, config);

    return new Response(JSON.stringify({
      status: 1,
      msg: `✔ 分片上传成功（${totalChunks}片）`,
      url: file.url,
      chunked: true,
      chunk_count: totalChunks
    }), {
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  } catch (error) {
    console.error('[Chunk Complete Error]', error);
    return new Response(JSON.stringify({ status: 0, error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
}

export async function handleUploadAbortRequest(request, config) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ status: 0, error: '只支持 POST' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
  const chatId = getWebOwnerChatId(config);
  try {
    if (!chatId) throw new Error('未配置 TG_ADMIN_ID');
    const body = await request.json();
    const deleted = await abortPendingChunkUpload(body.upload_id, chatId, config);
    return new Response(JSON.stringify({ status: 1, deleted }), {
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ status: 0, error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' }
    });
  }
}

export function createApiJsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}
