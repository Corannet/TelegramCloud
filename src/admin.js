// 管理接口

import {
  normalizeTelegramUserId,
  listAllowedTelegramUsers,
  addAllowedTelegramUser,
  removeAllowedTelegramUser,
  authenticate
} from './auth.js'

import {
  getStoredDisplayName,
  renameStoredFileRecord,
  deleteStoredFileRecord
} from './storage.js'

import {
  generateUserManagementPage,
  generateAdminPage
} from './templates-admin.js'

import {
  formatSize,
  formatDate
} from './utils.js'

import {
  createApiJsonResponse
} from './web-upload.js'

// 处理批量文件操作
export async function handleDeleteMultipleRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/`, 302);
  }
  try {
    const { urls } = await request.json();
    if (!Array.isArray(urls) || urls.length === 0) {
      return new Response(JSON.stringify({ status: 0, error: '无效的URL列表' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const results = { success: [], failed: [] };
    for (const url of urls) {
      try {
        const fileName = String(url).split('/').pop();
        let file = await config.database.prepare(
          'SELECT * FROM files WHERE url = ?'
        ).bind(url).first();
        if (!file && fileName) {
          file = await config.database.prepare(
            'SELECT * FROM files WHERE fileId = ? OR url LIKE ? ORDER BY id DESC LIMIT 1'
          ).bind(fileName, `%/${fileName}`).first();
        }
        if (!file) {
          results.failed.push({ url, reason: '未找到文件记录' });
          continue;
        }
        const deleted = await deleteStoredFileRecord(file, config);
        results.success.push({
          url,
          deletedChunks: deleted.deletedChunkRows,
          cleanupWarnings: deleted.failedTelegramMessages
        });
      } catch (error) {
        results.failed.push({ url, reason: error.message });
      }
    }

    return new Response(JSON.stringify({
      status: 1,
      message: '批量删除处理完成',
      results: {
        success: results.success.length,
        failed: results.failed.length,
        details: results
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ status: 0, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 管理授权用户页面
export async function handleUserManagementRequest(request, config) {
  if (request.method !== 'GET') {
    return new Response(
      'Method Not Allowed',
      {
        status: 405,
        headers: {
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  return new Response(
    generateUserManagementPage(),
    {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}

export async function handleListAllowedUsersRequest(request, config) {
  if (request.method !== 'GET') {
    return createApiJsonResponse(
      {
        status: 0,
        error: 'Method Not Allowed'
      },
      405
    );
  }

  try {
    const users = await listAllowedTelegramUsers(config);

    return createApiJsonResponse({
      status: 1,
      admins: config.tgAdminId || [],
      users
    });
  } catch (error) {
    console.error('获取授权用户列表失败:', error);

    return createApiJsonResponse(
      {
        status: 0,
        error: error.message
      },
      500
    );
  }
}

export async function handleAddAllowedUserRequest(request, config) {
  if (request.method !== 'POST') {
    return createApiJsonResponse(
      {
        status: 0,
        error: 'Method Not Allowed'
      },
      405
    );
  }

  try {
    const body = await request.json();
    const chatId = normalizeTelegramUserId(
      body && body.chat_id
    );

    if (!chatId) {
      return createApiJsonResponse(
        {
          status: 0,
          error: '请输入正确的纯数字 Telegram 用户 ID'
        },
        400
      );
    }

    const result = await addAllowedTelegramUser(
      chatId,
      `web:${config.username || 'admin'}`,
      config
    );

    let message = '';

    if (result.alreadyAdmin) {
      message = '该用户已经是 TG_ADMIN_ID 管理员';
    } else if (result.created) {
      message = '用户添加成功';
    } else {
      message = '该用户已经在授权列表中';
    }

    return createApiJsonResponse({
      status: 1,
      created: result.created,
      already_admin: result.alreadyAdmin,
      chat_id: chatId,
      message
    });
  } catch (error) {
    console.error('网页添加授权用户失败:', error);

    return createApiJsonResponse(
      {
        status: 0,
        error: error.message
      },
      500
    );
  }
}

export async function handleDeleteAllowedUserRequest(request, config) {
  if (request.method !== 'POST') {
    return createApiJsonResponse(
      {
        status: 0,
        error: 'Method Not Allowed'
      },
      405
    );
  }

  try {
    const body = await request.json();
    const chatId = normalizeTelegramUserId(
      body && body.chat_id
    );

    if (!chatId) {
      return createApiJsonResponse(
        {
          status: 0,
          error: '用户 ID 格式不正确'
        },
        400
      );
    }

    const removed = await removeAllowedTelegramUser(
      chatId,
      config
    );

    return createApiJsonResponse({
      status: 1,
      removed,
      chat_id: chatId,
      message: removed
        ? '用户权限已删除'
        : '该用户已不在授权列表中'
    });
  } catch (error) {
    console.error('网页删除授权用户失败:', error);

    return createApiJsonResponse(
      {
        status: 0,
        error: error.message
      },
      400
    );
  }
}

// 管理文件列表
export async function handleAdminRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/`, 302);
  }
  try {
    const categories = await config.database.prepare('SELECT id, name FROM categories').all();
    const categoryOptions = categories.results.length
      ? categories.results.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
      : '<option value="">暂无分类</option>';
    const files = await config.database.prepare(`
      SELECT f.id, f.url, f.fileId, f.message_id, f.created_at, f.file_name,
             f.file_size, f.mime_type, f.storage_type, f.is_chunked,
             f.chunk_count, f.upload_id,
             c.name as category_name, c.id as category_id
      FROM files f
      LEFT JOIN categories c ON f.category_id = c.id
      ORDER BY f.created_at DESC
    `).all();
    const fileList = files.results || [];
    console.log(`文件总数: ${fileList.length}`);
    const fileCards = fileList.map(file => {
        const url = file.url;
        const uniqueId = `file-checkbox-${encodeURIComponent(url)}`;
        return `
          <div class="file-card" data-file-id="${file.id}" data-url="${url}" data-category-id="${file.category_id || ''}" data-chunked="${Number(file.is_chunked || 0)}">
            <input type="checkbox" id="${uniqueId}" name="selectedFile" class="file-checkbox" value="${url}">
            <div class="file-preview">
              ${getPreviewHtml(url)}
            </div>
            <div class="file-info">
              <div>${getStoredDisplayName(file)}</div>
              <div>大小: ${formatSize(file.file_size || 0)}</div>
              <div>存储: ${file.storage_type === 'r2' ? 'R2' : (Number(file.is_chunked || 0) === 1 ? `Telegram 分片（${Number(file.chunk_count || 0)}片）` : 'Telegram')}</div>
              <div>上传时间: ${formatDate(file.created_at)}</div>
              <div>分类: ${file.category_name || '无分类'}</div>
            </div>
            <div class="file-actions" style="display:flex; gap:5px; justify-content:space-between; padding:10px;">
              <button class="btn btn-share" style="flex:1; background-color:#3498db; color:white; padding:8px 12px; border-radius:6px; border:none; cursor:pointer; font-weight:bold;" onclick="shareFile('${url}', '${getStoredDisplayName(file)}')">分享</button>
              <button class="btn btn-delete" style="flex:1;" onclick="showConfirmModal('确定要删除这个文件吗？', function() { deleteFile('${url}'); })">删除</button>
              <button class="btn btn-edit" style="flex:1;" onclick="showEditSuffixModal('${url}')">修改后缀</button>
            </div>
          </div>
        `;
    }).join('');
    const html = generateAdminPage(fileCards, categoryOptions);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  } catch (error) {
    console.error(`[Admin Error] ${error.message}`);
    return new Response(`加载文件列表失败，请检查数据库配置：${error.message}`, { status: 500 });
  }
}

export async function handleSearchRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/`, 302);
  }
  try {
    const { query } = await request.json();
    const searchPattern = `%${query}%`;
    const files = await config.database.prepare(`
      SELECT id, url, fileId, message_id, created_at, file_name, file_size,
             mime_type, storage_type, is_chunked, chunk_count, upload_id
       FROM files 
       WHERE file_name LIKE ? ESCAPE '!'
       COLLATE NOCASE
       ORDER BY created_at DESC
    `).bind(searchPattern).all();
    return new Response(
      JSON.stringify({ files: files.results || [] }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`[Search Error] ${error.message}`);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export function getPreviewHtml(url) {
  const ext = (url.split('.').pop() || '').toLowerCase();
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'icon'].includes(ext);
  const isVideo = ['mp4', 'webm'].includes(ext);
  const isAudio = ['mp3', 'wav', 'ogg'].includes(ext);
  if (isImage) {
    return `<img src="${url}" alt="预览">`;
  } else if (isVideo) {
    return `<video src="${url}" controls></video>`;
  } else if (isAudio) {
    return `<audio src="${url}" controls></audio>`;
  } else {
    return `<div style="font-size: 48px">📄</div>`;
  }
}

export async function handleDeleteRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/`, 302);
  }
  try {
    const { id, fileId } = await request.json();
    if (!id && !fileId) {
      return new Response(JSON.stringify({ status: 0, message: '缺少文件标识信息' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let file = null;
    if (id && String(id).startsWith('http')) {
      file = await config.database.prepare('SELECT * FROM files WHERE url = ?').bind(id).first();
    } else if (id) {
      file = await config.database.prepare('SELECT * FROM files WHERE id = ?').bind(id).first();
    }
    if (!file && fileId) {
      file = await config.database.prepare('SELECT * FROM files WHERE fileId = ?').bind(fileId).first();
    }
    if (!file) {
      return new Response(JSON.stringify({ status: 0, message: '文件不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const deleted = await deleteStoredFileRecord(file, config);
    return new Response(JSON.stringify({
      status: 1,
      message: deleted.failedTelegramMessages.length
        ? '文件已删除，但部分 Telegram 存储消息未能立即清理'
        : '删除成功',
      deletedChunks: deleted.deletedChunkRows,
      deletedStorageMessages: deleted.deletedStorageMessages,
      cleanupWarnings: deleted.failedTelegramMessages
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('删除文件失败:', error);
    return new Response(JSON.stringify({
      status: 0,
      message: '删除文件失败: ' + error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function handleBingImagesRequest(request, config) {
  const cache = caches.default;
  const cacheKey = new Request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    console.log('Returning cached response');
    return cachedResponse;
  }
  try {
    const res = await fetch(cacheKey);
    if (!res.ok) {
      console.error(`Bing API 请求失败，状态码：${res.status}`);
      return new Response('请求 Bing API 失败', { status: res.status });
    }
    const bingData = await res.json();
    const images = bingData.images.map(image => ({ url: `https://cn.bing.com${image.url}` }));
    const returnData = { status: true, message: "操作成功", data: images };
    const response = new Response(JSON.stringify(returnData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=21600',
        'Access-Control-Allow-Origin': '*'
      }
    });
    await cache.put(cacheKey, response.clone());
    console.log('响应数据已缓存');
    return response;
  } catch (error) {
    console.error('请求 Bing API 过程中发生错误:', error);
    return new Response('请求 Bing API 失败', { status: 500 });
  }
}

// 处理文件名称修改
export async function handleUpdateSuffixRequest(request, config) {
  try {
    const { url, suffix, id } = await request.json();
    if ((!url && !id) || !String(suffix || '').trim()) {
      return new Response(JSON.stringify({
        status: 0,
        msg: '文件标识和新文件名不能为空'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let fileRecord = null;
    if (id) {
      fileRecord = await config.database.prepare(
        'SELECT * FROM files WHERE id = ?'
      ).bind(id).first();
    }
    if (!fileRecord && url) {
      fileRecord = await config.database.prepare(
        'SELECT * FROM files WHERE url = ?'
      ).bind(url).first();
    }
    if (!fileRecord && url) {
      const path = (() => {
        try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); }
        catch (_) { return String(url).split('/').pop(); }
      })();
      fileRecord = await config.database.prepare(`
        SELECT * FROM files
        WHERE fileId = ? OR file_name = ?
        ORDER BY id DESC LIMIT 1
      `).bind(path, path).first();
    }
    if (!fileRecord) {
      return new Response(JSON.stringify({
        status: 0,
        msg: '未找到对应的文件记录'
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const renamed = await renameStoredFileRecord(fileRecord, suffix, config);
    return new Response(JSON.stringify({
      status: 1,
      msg: renamed.isChunked
        ? `文件名修改成功；${renamed.chunkCount} 个分片无需重新上传`
        : '文件名修改成功',
      newUrl: renamed.url,
      fileName: renamed.fileName,
      isChunked: renamed.isChunked,
      chunkCount: renamed.chunkCount
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('更新文件名失败:', error);
    return new Response(JSON.stringify({
      status: 0,
      msg: '更新文件名失败: ' + error.message
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}
