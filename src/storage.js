// 文件存储与直链

import {
  TELEGRAM_MANIFEST_MAGIC
} from './constants.js'

import {
  telegramMethodUrl,
  fetchTelegramBinaryFile,
  deleteTelegramStorageMessage
} from './telegram.js'

import {
  formatSize
} from './utils.js'

// 生成存储键和公开标识
export function generateSafeKey(originalName) {
  let ext = 'bin';
  if (originalName && originalName.includes('.')) {
    const rawExt = originalName.split('.').pop();
    const cleanExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanExt) ext = cleanExt;
  }
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}_${randomPart}.${ext}`;
}

export function normalizePublicId(value) {
  const publicId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(publicId) ? publicId : null;
}

export function createRandomIdentifier(length = 16) {
  const safeLength = Math.max(3, Math.min(80, Math.floor(Number(length) || 16)));
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(safeLength);
  crypto.getRandomValues(bytes);
  let output = '';
  for (const value of bytes) {
    output += alphabet[value % alphabet.length];
  }
  return output;
}

export function buildPublicFileUrl(config, publicId) {
  return `https://${config.domain}/${publicId}`;
}

export async function createUniquePublicId(config, length = 16) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const publicId = createRandomIdentifier(length);
    const url = buildPublicFileUrl(config, publicId);
    const existing = await config.database.prepare(`
      SELECT id FROM files
      WHERE public_id = ? OR url = ?
      LIMIT 1
    `).bind(publicId, url).first();
    if (!existing) return publicId;
  }
  throw new Error('无法生成唯一文件直链标识');
}

export async function createPublicFileIdentity(config, preferredId = '') {
  const publicId = normalizePublicId(preferredId) || await createUniquePublicId(config);
  return {
    publicId,
    url: buildPublicFileUrl(config, publicId)
  };
}

// 管理电报分片存储
export function normalizeUploadId(value) {
  const uploadId = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{16,80}$/.test(uploadId) ? uploadId : null;
}

export function sanitizeTelegramFileName(fileName, fallback = 'file.bin') {
  const value = String(fileName || fallback)
    .replace(/[\\/\0\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (value || fallback).slice(0, 180);
}

export function getTelegramChunkSizeBytes(config) {
  return Math.floor(Number(config.telegramChunkSizeMB || 19) * 1024 * 1024);
}

export function shouldUseTelegramChunks(fileSize, config) {
  return Number(fileSize || 0) > getTelegramChunkSizeBytes(config);
}

export function chooseTelegramUploadMode(mimeType, fileSize, config) {
  const size = Number(fileSize || 0);
  const mime = String(mimeType || 'application/octet-stream').toLowerCase();
  const photoLimit = Number(config.telegramPhotoLimitMB || 10) * 1024 * 1024;

  if (
    mime.startsWith('image/') &&
    !['image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(mime) &&
    size <= photoLimit
  ) {
    return { method: 'sendPhoto', field: 'photo' };
  }
  if (mime.startsWith('video/')) return { method: 'sendVideo', field: 'video' };
  if (mime.startsWith('audio/')) return { method: 'sendAudio', field: 'audio' };
  return { method: 'sendDocument', field: 'document' };
}

export function extractTelegramUploadedFile(result, field) {
  let fileId = null;
  if (field === 'photo') {
    const photos = result.photo || [];
    fileId = photos.length ? photos[photos.length - 1].file_id : null;
  } else if (field === 'video') {
    fileId = result.video && result.video.file_id;
  } else if (field === 'audio') {
    fileId = result.audio && result.audio.file_id;
  } else {
    fileId = result.document && result.document.file_id;
  }
  return {
    fileId,
    messageId: result.message_id
  };
}

export async function uploadBlobToTelegram(
  blob,
  fileName,
  mimeType,
  config,
  options = {}
) {
  if (!config.tgBotToken || !config.tgStorageChatId) {
    throw new Error('未配置 Telegram 存储参数 (TG_BOT_TOKEN 和 TG_STORAGE_CHAT_ID)');
  }

  const method = options.method || 'sendDocument';
  const field = options.field || 'document';
  const safeName = sanitizeTelegramFileName(fileName);
  const formData = new FormData();
  formData.append('chat_id', config.tgStorageChatId);
  formData.append(field, blob, safeName);
  if (options.caption && field !== 'photo') {
    formData.append('caption', String(options.caption).slice(0, 1024));
  }

  const response = await fetch(
    telegramMethodUrl(config.tgBotToken, method, config),
    { method: 'POST', body: formData }
  );
  const responseText = await response.text();
  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch (_) {}

  if (!response.ok || !data || !data.ok) {
    const description = data && data.description ? data.description : responseText;
    throw new Error(`Telegram ${method} 失败: ${description || response.status}`);
  }

  const uploaded = extractTelegramUploadedFile(data.result, field);
  if (!uploaded.fileId || !uploaded.messageId) {
    throw new Error(`Telegram ${method} 成功但未返回有效 file_id/message_id`);
  }

  return uploaded;
}

export async function uploadSingleFileToTelegram(blob, fileName, mimeType, config) {
  const size = Number(blob.size || 0);
  const mode = chooseTelegramUploadMode(mimeType, size, config);
  const caption = `File: ${sanitizeTelegramFileName(fileName)}\nType: ${mimeType || 'application/octet-stream'}\nSize: ${formatSize(size)}`;

  try {
    return await uploadBlobToTelegram(blob, fileName, mimeType, config, {
      ...mode,
      caption
    });
  } catch (error) {
    if (mode.method === 'sendDocument') throw error;
    console.warn(`${mode.method} 失败，改用 sendDocument:`, error.message);
    return uploadBlobToTelegram(blob, fileName, mimeType, config, {
      method: 'sendDocument',
      field: 'document',
      caption
    });
  }
}

export async function savePendingChunk({
  uploadId,
  chatId,
  chunkIndex,
  totalChunks,
  telegramFileId,
  messageId,
  chunkSize
}, config) {
  const result = await config.database.prepare(`
    INSERT OR IGNORE INTO file_chunks (
      upload_id, file_id, chat_id, chunk_index, total_chunks,
      telegram_file_id, message_id, chunk_size, created_at
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    uploadId,
    chatId,
    chunkIndex,
    totalChunks,
    telegramFileId,
    messageId,
    chunkSize,
    Date.now()
  ).run();

  if (!result.meta || Number(result.meta.changes || 0) === 0) {
    const existing = await config.database.prepare(`
      SELECT telegram_file_id, message_id, chunk_size
      FROM file_chunks
      WHERE upload_id = ? AND chat_id = ? AND chunk_index = ?
      LIMIT 1
    `).bind(uploadId, chatId, chunkIndex).first();
    if (existing) {
      await deleteTelegramStorageMessage(messageId, config);
      return existing;
    }
    throw new Error('保存分片记录失败');
  }

  return {
    telegram_file_id: telegramFileId,
    message_id: messageId,
    chunk_size: chunkSize
  };
}

export async function uploadOneTelegramChunk(
  chunk,
  uploadId,
  chunkIndex,
  totalChunks,
  originalFileName,
  chatId,
  config
) {
  const existing = await config.database.prepare(`
    SELECT telegram_file_id, message_id, chunk_size
    FROM file_chunks
    WHERE upload_id = ? AND chat_id = ? AND chunk_index = ?
    LIMIT 1
  `).bind(uploadId, chatId, chunkIndex).first();
  if (existing) return existing;

  const partNumber = String(chunkIndex + 1).padStart(5, '0');
  const safeOriginal = sanitizeTelegramFileName(originalFileName, 'large-file.bin');
  const partName = `${safeOriginal}.part${partNumber}`;
  const uploaded = await uploadBlobToTelegram(
    chunk,
    partName,
    'application/octet-stream',
    config,
    {
      method: 'sendDocument',
      field: 'document',
      caption: `blob [${chunkIndex + 1}/${totalChunks}] - ${safeOriginal}`
    }
  );

  return savePendingChunk({
    uploadId,
    chatId,
    chunkIndex,
    totalChunks,
    telegramFileId: uploaded.fileId,
    messageId: uploaded.messageId,
    chunkSize: Number(chunk.size || 0)
  }, config);
}

export async function abortPendingChunkUpload(uploadId, chatId, config) {
  const validUploadId = normalizeUploadId(uploadId);
  if (!validUploadId) return 0;

  const result = await config.database.prepare(`
    SELECT id, message_id
    FROM file_chunks
    WHERE upload_id = ? AND chat_id = ? AND file_id IS NULL
    ORDER BY chunk_index
  `).bind(validUploadId, chatId).all();
  const chunks = result.results || [];

  for (const chunk of chunks) {
    await deleteTelegramStorageMessage(chunk.message_id, config);
  }
  await config.database.prepare(`
    DELETE FROM file_chunks
    WHERE upload_id = ? AND chat_id = ? AND file_id IS NULL
  `).bind(validUploadId, chatId).run();
  return chunks.length;
}

export async function insertFileRecord(fileData, config) {
  const identity = await createPublicFileIdentity(config, fileData.publicId);
  const result = await config.database.prepare(`
    INSERT INTO files (
      url, fileId, message_id, created_at, file_name, file_size,
      mime_type, storage_type, category_id, chat_id,
      is_chunked, chunk_count, upload_id, public_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    identity.url,
    fileData.fileId,
    fileData.messageId,
    fileData.createdAt || Date.now(),
    fileData.fileName,
    Number(fileData.fileSize || 0),
    fileData.mimeType || 'application/octet-stream',
    fileData.storageType || 'telegram',
    fileData.categoryId || null,
    fileData.chatId,
    fileData.isChunked ? 1 : 0,
    Number(fileData.chunkCount || 0),
    fileData.uploadId || null,
    identity.publicId
  ).run();

  let fileRowId = result.meta && result.meta.last_row_id;
  if (!fileRowId && fileData.uploadId) {
    const row = await config.database.prepare(`
      SELECT id FROM files WHERE upload_id = ? LIMIT 1
    `).bind(fileData.uploadId).first();
    fileRowId = row && row.id;
  }
  if (!fileRowId) {
    const row = await config.database.prepare(`
      SELECT id FROM files WHERE public_id = ? LIMIT 1
    `).bind(identity.publicId).first();
    fileRowId = row && row.id;
  }
  if (!fileRowId) throw new Error('写入文件记录后未能获取文件 ID');
  return {
    id: Number(fileRowId),
    url: identity.url,
    publicId: identity.publicId
  };
}

export async function finalizeChunkedTelegramUpload({
  uploadId,
  chatId,
  fileName,
  fileSize,
  mimeType,
  categoryId,
  key,
  totalChunks,
  publicId
}, config) {
  const validUploadId = normalizeUploadId(uploadId);
  if (!validUploadId) throw new Error('upload_id 格式无效');

  const existingFile = await config.database.prepare(`
    SELECT * FROM files WHERE upload_id = ? AND chat_id = ? LIMIT 1
  `).bind(validUploadId, chatId).first();
  if (existingFile) return existingFile;

  const result = await config.database.prepare(`
    SELECT * FROM file_chunks
    WHERE upload_id = ? AND chat_id = ?
    ORDER BY chunk_index ASC
  `).bind(validUploadId, chatId).all();
  const chunks = result.results || [];

  if (chunks.length !== Number(totalChunks)) {
    throw new Error(`分片不完整：应有 ${totalChunks} 片，实际 ${chunks.length} 片`);
  }
  for (let index = 0; index < chunks.length; index++) {
    if (Number(chunks[index].chunk_index) !== index) {
      throw new Error(`缺少第 ${index + 1} 个分片`);
    }
  }
  const actualSize = chunks.reduce((sum, chunk) => sum + Number(chunk.chunk_size || 0), 0);
  if (actualSize !== Number(fileSize)) {
    throw new Error(`分片总大小不一致：应为 ${fileSize}，实际 ${actualSize}`);
  }

  const safeName = sanitizeTelegramFileName(fileName, 'large-file.bin');
  const manifestText = [
    TELEGRAM_MANIFEST_MAGIC,
    safeName,
    `size${fileSize}`,
    ...chunks.map(chunk => chunk.telegram_file_id)
  ].join('\n');
  const manifestBlob = new Blob([manifestText], { type: 'text/plain;charset=UTF-8' });
  const manifestUpload = await uploadBlobToTelegram(
    manifestBlob,
    'fileAll.txt',
    'text/plain',
    config,
    {
      method: 'sendDocument',
      field: 'document',
      caption: safeName
    }
  );

  const finalKey = key || generateSafeKey(safeName);
  const identity = await createPublicFileIdentity(config, publicId);
  let fileRowId = null;
  try {
    const inserted = await insertFileRecord({
      publicId: identity.publicId,
      fileId: manifestUpload.fileId,
      messageId: manifestUpload.messageId,
      fileName: safeName,
      fileSize,
      mimeType,
      storageType: 'telegram',
      categoryId,
      chatId,
      isChunked: true,
      chunkCount: chunks.length,
      uploadId: validUploadId
    }, config);
    fileRowId = inserted.id;

    await config.database.prepare(`
      UPDATE file_chunks
      SET file_id = ?
      WHERE upload_id = ? AND chat_id = ?
    `).bind(fileRowId, validUploadId, chatId).run();

    return await config.database.prepare(
      'SELECT * FROM files WHERE id = ?'
    ).bind(fileRowId).first();
  } catch (error) {
    await deleteTelegramStorageMessage(manifestUpload.messageId, config);
    if (fileRowId) {
      await config.database.prepare('DELETE FROM files WHERE id = ?').bind(fileRowId).run();
    }
    throw error;
  }
}

export async function saveTelegramFileFromBlob({
  blob,
  fileName,
  fileSize,
  mimeType,
  categoryId,
  chatId,
  key
}, config) {
  const finalKey = key || generateSafeKey(fileName);
  const identity = await createPublicFileIdentity(config);

  if (!shouldUseTelegramChunks(fileSize, config)) {
    const uploaded = await uploadSingleFileToTelegram(blob, fileName, mimeType, config);
    await insertFileRecord({
      publicId: identity.publicId,
      fileId: uploaded.fileId,
      messageId: uploaded.messageId,
      fileName,
      fileSize,
      mimeType,
      storageType: 'telegram',
      categoryId,
      chatId,
      isChunked: false,
      chunkCount: 0
    }, config);
    return { url: identity.url, isChunked: false, chunkCount: 0 };
  }

  const uploadId = crypto.randomUUID().replace(/-/g, '_');
  const chunkSize = getTelegramChunkSizeBytes(config);
  const totalChunks = Math.ceil(Number(fileSize) / chunkSize);
  try {
    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, Number(fileSize));
      await uploadOneTelegramChunk(
        blob.slice(start, end),
        uploadId,
        index,
        totalChunks,
        fileName,
        chatId,
        config
      );
    }

    const file = await finalizeChunkedTelegramUpload({
      uploadId,
      chatId,
      fileName,
      fileSize,
      mimeType,
      categoryId,
      key: finalKey,
      totalChunks,
      publicId: identity.publicId
    }, config);
    return { url: file.url, isChunked: true, chunkCount: totalChunks };
  } catch (error) {
    await abortPendingChunkUpload(uploadId, chatId, config);
    throw error;
  }
}

export async function getTelegramFileResponse(fileId, config, rangeStart = null, rangeEnd = null) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const infoResponse = await fetch(
        `${telegramMethodUrl(config.tgBotToken, 'getFile', config)}?file_id=${encodeURIComponent(fileId)}`
      );
      const info = await infoResponse.json();
      if (!infoResponse.ok || !info.ok || !info.result || !info.result.file_path) {
        throw new Error(info.description || `getFile HTTP ${infoResponse.status}`);
      }
      const headers = new Headers();
      if (rangeStart !== null && rangeEnd !== null) {
        headers.set('Range', `bytes=${rangeStart}-${rangeEnd}`);
      }
      const fileResponse = await fetchTelegramBinaryFile(
        fileId,
        info.result.file_path,
        config,
        headers
      );
      if (!fileResponse.ok && fileResponse.status !== 206) {
        throw new Error(`文件下载 HTTP ${fileResponse.status}`);
      }
      return fileResponse;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
      }
    }
  }
  throw lastError || new Error('Telegram 文件下载失败');
}

export function parseByteRange(rangeHeader, totalSize) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return { invalid: true };
  let start;
  let end;
  if (match[1] === '' && match[2] !== '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? totalSize - 1 : Number(match[2]);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= totalSize) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, totalSize - 1) };
}

export async function loadChunkRows(file, config) {
  const result = await config.database.prepare(`
    SELECT chunk_index, telegram_file_id, message_id, chunk_size
    FROM file_chunks
    WHERE file_id = ?
    ORDER BY chunk_index ASC
  `).bind(file.id).all();
  const chunks = result.results || [];
  if (chunks.length) return chunks;

  
  const manifestResponse = await getTelegramFileResponse(file.fileId, config);
  const manifestText = await manifestResponse.text();
  const lines = manifestText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== TELEGRAM_MANIFEST_MAGIC || lines.length < 4) {
    throw new Error('分片清单无效，且数据库中没有分片记录');
  }
  let startLine = 2;
  if (lines[startLine] && lines[startLine].startsWith('size')) startLine++;
  const ids = lines.slice(startLine);
  const defaultChunkSize = getTelegramChunkSizeBytes(config);
  const totalSize = Number(file.file_size || 0);
  return ids.map((telegramFileId, index) => ({
    chunk_index: index,
    telegram_file_id: telegramFileId,
    message_id: 0,
    chunk_size: index === ids.length - 1
      ? Math.max(0, totalSize - defaultChunkSize * (ids.length - 1))
      : defaultChunkSize
  }));
}

export function buildChunkSelections(chunks, rangeStart, rangeEnd) {
  const selections = [];
  let offset = 0;
  for (const chunk of chunks) {
    const size = Number(chunk.chunk_size || 0);
    const chunkStart = offset;
    const chunkEnd = offset + size - 1;
    offset += size;
    if (chunkEnd < rangeStart || chunkStart > rangeEnd) continue;
    selections.push({
      ...chunk,
      localStart: Math.max(0, rangeStart - chunkStart),
      localEnd: Math.min(size - 1, rangeEnd - chunkStart),
      fullChunk: rangeStart <= chunkStart && rangeEnd >= chunkEnd
    });
  }
  return selections;
}

export function createTelegramChunkStream(selections, config) {
  let selectionIndex = 0;
  let currentReader = null;

  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (currentReader) {
            const { done, value } = await currentReader.read();
            if (!done) {
              controller.enqueue(value);
              return;
            }
            currentReader = null;
            selectionIndex++;
          }

          if (selectionIndex >= selections.length) {
            controller.close();
            return;
          }

          const selected = selections[selectionIndex];
          const response = await getTelegramFileResponse(
            selected.telegram_file_id,
            config,
            selected.fullChunk ? null : selected.localStart,
            selected.fullChunk ? null : selected.localEnd
          );

          if (!selected.fullChunk && response.status !== 206) {
            
            const buffer = await response.arrayBuffer();
            const sliced = buffer.slice(selected.localStart, selected.localEnd + 1);
            controller.enqueue(new Uint8Array(sliced));
            selectionIndex++;
            return;
          }

          if (!response.body) throw new Error('Telegram 返回了空响应体');
          currentReader = response.body.getReader();
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (currentReader) {
        try { await currentReader.cancel(reason); } catch (_) {}
      }
    }
  });
}

export function encodeContentDispositionFileName(fileName) {
  return encodeURIComponent(String(fileName || 'download.bin'))
    .replace(/[!'()*]/g, character =>
      '%' + character.charCodeAt(0).toString(16).toUpperCase()
    );
}

export function getStoredDisplayName(file) {
  if (!file) return 'download.bin';
  const candidate = String(file.file_name || '').trim();
  if (candidate) return candidate;
  try {
    return decodeURIComponent(new URL(String(file.url || '')).pathname.split('/').pop()) || 'download.bin';
  } catch (_) {
    return String(file.url || '').split('/').pop() || 'download.bin';
  }
}

export function splitStoredFileName(fileName) {
  const safeName = sanitizeTelegramFileName(fileName, 'file.bin');
  const lastDot = safeName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === safeName.length - 1) {
    return { stem: safeName, extension: '' };
  }
  return {
    stem: safeName.slice(0, lastDot),
    extension: safeName.slice(lastDot + 1)
  };
}

export function normalizePublicFileStem(value) {
  let stem = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  stem = stem.replace(/\s+/g, ' ');
  
  if (!stem) throw new Error('新文件名不能为空');
  if (stem === '.' || stem === '..') throw new Error('新文件名无效');
  if (stem.length > 120) throw new Error('新文件名不能超过 120 个字符');
  return stem;
}

export function invalidateStoredFileCache(file, config, extraPaths = []) {
  if (!config || !config.fileCache) return;
  const paths = new Set(extraPaths.filter(Boolean));
  if (file && file.url) {
    try {
      paths.add(decodeURIComponent(new URL(file.url).pathname.split('/').pop()));
    } catch (_) {
      paths.add(String(file.url).split('/').pop());
    }
  }
  for (const path of paths) {
    if (path) config.fileCache.delete(`file:${path}`);
  }
}

// 管理文件重命名和删除
export async function renameStoredFileRecord(file, requestedStem, config) {
  if (!file || !file.id) throw new Error('文件不存在');
  const oldName = getStoredDisplayName(file);
  const { extension } = splitStoredFileName(oldName);
  let stem = normalizePublicFileStem(requestedStem);
  if (extension && stem.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) {
    stem = stem.slice(0, -(extension.length + 1)).trim();
    if (!stem) throw new Error('新文件名不能为空');
  }
  const newFileName = extension ? `${stem}.${extension}` : stem;
  const encodedPath = encodeURIComponent(newFileName).replace(/%2F/gi, '_');
  const newUrl = file.public_id
    ? buildPublicFileUrl(config, file.public_id)
    : `https://${config.domain}/${encodedPath}`;

  const conflict = await config.database.prepare(`
    SELECT id FROM files
    WHERE id != ? AND (url = ? OR file_name = ?)
    LIMIT 1
  `).bind(file.id, newUrl, newFileName).first();
  if (conflict) throw new Error('该文件名或直链已被使用');

  const oldPath = (() => {
    try { return decodeURIComponent(new URL(file.url).pathname.split('/').pop()); }
    catch (_) { return String(file.url || '').split('/').pop(); }
  })();

  let newStorageKey = file.fileId;
  let copiedR2Object = false;
  if (file.storage_type === 'r2' && config.bucket && file.fileId) {
    const object = await config.bucket.get(file.fileId);
    if (!object) throw new Error('R2 中未找到原文件，无法重命名');
    newStorageKey = newFileName;
    if (newStorageKey !== file.fileId) {
      await config.bucket.put(newStorageKey, object.body, {
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata
      });
      copiedR2Object = true;
    }
  }

  let fileRowUpdated = false;
  try {
    await config.database.prepare(`
      UPDATE files
      SET url = ?, file_name = ?, custom_suffix = ?, fileId = ?
      WHERE id = ?
    `).bind(
      newUrl,
      newFileName,
      stem,
      newStorageKey,
      file.id
    ).run();
    fileRowUpdated = true;

    
    await config.database.prepare(`
      UPDATE bot_upload_sessions
      SET result_url = ?, file_name = ?
      WHERE result_file_id = ? AND status = 'completed'
    `).bind(newUrl, newFileName, file.id).run();
  } catch (error) {
    if (fileRowUpdated) {
      try {
        await config.database.prepare(`
          UPDATE files
          SET url = ?, file_name = ?, custom_suffix = ?, fileId = ?
          WHERE id = ?
        `).bind(
          file.url,
          file.file_name || oldName,
          file.custom_suffix || null,
          file.fileId,
          file.id
        ).run();
      } catch (rollbackError) {
        console.error('回滚文件名修改失败:', rollbackError);
      }
    }
    if (copiedR2Object && newStorageKey && newStorageKey !== file.fileId) {
      try { await config.bucket.delete(newStorageKey); } catch (_) {}
    }
    throw error;
  }

  
  if (copiedR2Object && file.fileId !== newStorageKey) {
    try {
      await config.bucket.delete(file.fileId);
    } catch (cleanupError) {
      console.warn(`旧 R2 对象 ${file.fileId} 删除失败:`, cleanupError.message);
    }
  }

  invalidateStoredFileCache(file, config, [oldPath, encodedPath, newFileName]);
  return {
    id: Number(file.id),
    url: newUrl,
    fileName: newFileName,
    storageType: file.storage_type,
    isChunked: Number(file.is_chunked || 0) === 1,
    chunkCount: Number(file.chunk_count || 0)
  };
}

export async function deleteStoredFileRecord(file, config) {
  if (!file || !file.id) throw new Error('文件不存在');

  const failedTelegramMessages = [];
  let deletedChunkRows = 0;
  let deletedStorageMessages = 0;

  
  await config.database.prepare(`
    UPDATE bot_upload_sessions
    SET status = 'cancelled', result_file_id = NULL, result_url = NULL,
        error_message = '文件已删除'
    WHERE result_file_id = ? OR (upload_id = ? AND upload_id IS NOT NULL)
  `).bind(file.id, file.upload_id || null).run();

  if (file.storage_type === 'telegram') {
    const chunkResult = await config.database.prepare(`
      SELECT id, message_id
      FROM file_chunks
      WHERE file_id = ? OR (upload_id = ? AND ? IS NOT NULL)
      ORDER BY chunk_index ASC
    `).bind(file.id, file.upload_id || null, file.upload_id || null).all();
    const chunks = chunkResult.results || [];
    deletedChunkRows = chunks.length;

    for (const chunk of chunks) {
      if (!chunk.message_id) continue;
      const deleted = await deleteTelegramStorageMessage(chunk.message_id, config);
      if (deleted) deletedStorageMessages++;
      else failedTelegramMessages.push(Number(chunk.message_id));
    }

    if (file.message_id) {
      const manifestDeleted = await deleteTelegramStorageMessage(file.message_id, config);
      if (manifestDeleted) deletedStorageMessages++;
      else failedTelegramMessages.push(Number(file.message_id));
    }

    await config.database.prepare(`
      DELETE FROM file_chunks
      WHERE file_id = ? OR (upload_id = ? AND ? IS NOT NULL)
    `).bind(file.id, file.upload_id || null, file.upload_id || null).run();
  } else if (file.storage_type === 'r2' && config.bucket && file.fileId) {
    await config.bucket.delete(file.fileId);
  }

  await config.database.prepare(
    'DELETE FROM upload_page_files WHERE file_id = ?'
  ).bind(file.id).run();
  await config.database.prepare('DELETE FROM files WHERE id = ?').bind(file.id).run();
  invalidateStoredFileCache(file, config, [getStoredDisplayName(file)]);

  return {
    deleted: true,
    deletedChunkRows,
    deletedStorageMessages,
    failedTelegramMessages
  };
}

export function combineUint8Arrays(parts, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export async function* splitResponseBodyIntoBlobs(response, chunkSize, mimeType, onRead) {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (onRead) await onRead(buffer.byteLength);
    for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
      yield new Blob([buffer.subarray(offset, Math.min(offset + chunkSize, buffer.byteLength))], {
        type: mimeType || 'application/octet-stream'
      });
    }
    return;
  }

  const reader = response.body.getReader();
  let parts = [];
  let partLength = 0;
  let totalRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(chunkSize - partLength, value.byteLength - offset);
        parts.push(value.subarray(offset, offset + take));
        partLength += take;
        offset += take;
        totalRead += take;
        if (onRead) await onRead(totalRead);

        if (partLength === chunkSize) {
          yield new Blob([combineUint8Arrays(parts, partLength)], {
            type: mimeType || 'application/octet-stream'
          });
          parts = [];
          partLength = 0;
        }
      }
    }
    if (partLength > 0) {
      yield new Blob([combineUint8Arrays(parts, partLength)], {
        type: mimeType || 'application/octet-stream'
      });
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

export async function saveTelegramFileFromResponse({
  response,
  uploadId,
  fileName,
  fileSize,
  mimeType,
  categoryId,
  chatId,
  key,
  progress
}, config) {
  const chunkSize = getTelegramChunkSizeBytes(config);
  const totalChunks = Math.max(1, Math.ceil(Number(fileSize) / chunkSize));
  const finalKey = key || generateSafeKey(fileName);
  const identity = await createPublicFileIdentity(config);

  const existingFile = await config.database.prepare(`
    SELECT * FROM files WHERE upload_id = ? AND chat_id = ? LIMIT 1
  `).bind(uploadId, chatId).first();
  if (existingFile) {
    return {
      url: existingFile.url,
      isChunked: Number(existingFile.is_chunked || 0) === 1,
      chunkCount: Number(existingFile.chunk_count || 0)
    };
  }

  let uploadedBytes = 0;
  let chunkIndex = 0;
  try {
    for await (const chunk of splitResponseBodyIntoBlobs(
      response,
      chunkSize,
      mimeType,
      async totalRead => {
        if (progress) {
          await progress({
            phase: `读取并切分第 ${Math.min(chunkIndex + 1, totalChunks)}/${totalChunks} 片`,
            processedBytes: Math.max(uploadedBytes, totalRead),
            completedChunks: chunkIndex,
            totalChunks
          });
        }
      }
    )) {
      if (totalChunks === 1) {
        if (progress) {
          await progress({
            phase: '正在写入 Telegram 存储',
            processedBytes: chunk.size,
            completedChunks: 0,
            totalChunks: 1,
            force: true
          });
        }
        
        const uploaded = await uploadBlobToTelegram(
          chunk,
          fileName,
          mimeType,
          config,
          {
            method: 'sendDocument',
            field: 'document',
            caption: `File: ${sanitizeTelegramFileName(fileName)}\nSize: ${formatSize(fileSize)}`
          }
        );
        await insertFileRecord({
          publicId: identity.publicId,
          fileId: uploaded.fileId,
          messageId: uploaded.messageId,
          fileName,
          fileSize,
          mimeType,
          storageType: 'telegram',
          categoryId,
          chatId,
          isChunked: false,
          chunkCount: 0,
          uploadId
        }, config);
        return { url: identity.url, isChunked: false, chunkCount: 0 };
      }

      if (progress) {
        await progress({
          phase: `正在上传第 ${chunkIndex + 1}/${totalChunks} 片`,
          processedBytes: Math.max(uploadedBytes, Math.min(fileSize, uploadedBytes + chunk.size)),
          completedChunks: chunkIndex,
          totalChunks
        });
      }
      await uploadOneTelegramChunk(
        chunk,
        uploadId,
        chunkIndex,
        totalChunks,
        fileName,
        chatId,
        config
      );
      uploadedBytes += chunk.size;
      chunkIndex++;
      if (progress) {
        await progress({
          phase: '分片上传中',
          processedBytes: uploadedBytes,
          completedChunks: chunkIndex,
          totalChunks,
          force: true
        });
      }
    }

    if (chunkIndex !== totalChunks) {
      throw new Error(`分片数量不一致：预计 ${totalChunks}，实际 ${chunkIndex}`);
    }

    if (progress) {
      await progress({
        phase: '正在生成分片清单',
        processedBytes: fileSize,
        completedChunks: totalChunks,
        totalChunks,
        force: true
      });
    }
    const fileRow = await finalizeChunkedTelegramUpload({
      uploadId,
      chatId,
      fileName,
      fileSize,
      mimeType,
      categoryId,
      key: finalKey,
      totalChunks,
      publicId: identity.publicId
    }, config);
    return { url: fileRow.url, isChunked: true, chunkCount: totalChunks };
  } catch (error) {
    await abortPendingChunkUpload(uploadId, chatId, config);
    throw error;
  }
}

// 处理公开文件直链
export async function handleFileRequest(request, config) {
  try {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.slice(1));
    if (!path) return new Response('Not Found', { status: 404 });

    const rangeHeader = request.headers.get('Range');
    const cacheKey = `file:${path}`;
    if (!rangeHeader && request.method !== 'HEAD' && config.fileCache && config.fileCache.has(cacheKey)) {
      const cachedData = config.fileCache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < config.fileCacheTTL) {
        return cachedData.response.clone();
      }
      config.fileCache.delete(cacheKey);
    }

    const cacheAndReturnResponse = (response, allowCache = true) => {
      if (allowCache && !rangeHeader && request.method !== 'HEAD' && config.fileCache) {
        config.fileCache.set(cacheKey, { response: response.clone(), timestamp: Date.now() });
      }
      return response;
    };

    
    if (config.bucket) {
      try {
        const object = await config.bucket.get(path);
        if (object) {
          const contentType = object.httpMetadata.contentType || getContentType(path.split('.').pop());
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('Content-Type', contentType);
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Cache-Control', 'public, max-age=31536000');
          headers.set('etag', object.httpEtag);
          return cacheAndReturnResponse(new Response(
            request.method === 'HEAD' ? null : object.body,
            { headers }
          ));
        }
      } catch (error) {
        if (error.name !== 'NoSuchKey') console.error('R2获取文件错误:', error);
      }
    }

    const urlPattern = `https://${config.domain}/${path}`;
    let file = await config.database.prepare(
      'SELECT * FROM files WHERE url = ?'
    ).bind(urlPattern).first();
    if (!file) {
      file = await config.database.prepare(
        'SELECT * FROM files WHERE public_id = ?'
      ).bind(path).first();
    }
    if (!file) {
      file = await config.database.prepare(
        'SELECT * FROM files WHERE fileId = ?'
      ).bind(path).first();
    }
    if (!file) {
      const fileName = path.split('/').pop();
      file = await config.database.prepare(
        'SELECT * FROM files WHERE file_name = ? ORDER BY id DESC LIMIT 1'
      ).bind(fileName).first();
    }
    if (!file) return new Response('File not found', { status: 404 });

    const contentType = file.mime_type || getContentType(path.split('.').pop());
    const totalSize = Number(file.file_size || 0);
    const fileName = file.file_name || path.split('/').pop() || 'download.bin';
    const inline = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType.startsWith('audio/');
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=31536000');
    headers.set(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeContentDispositionFileName(fileName)}`
    );

    const parsedRange = totalSize > 0 ? parseByteRange(rangeHeader, totalSize) : null;
    if (parsedRange && parsedRange.invalid) {
      headers.set('Content-Range', `bytes */${totalSize}`);
      return new Response('Requested Range Not Satisfiable', { status: 416, headers });
    }
    const rangeStart = parsedRange ? parsedRange.start : 0;
    const rangeEnd = parsedRange ? parsedRange.end : Math.max(0, totalSize - 1);
    if (totalSize > 0) {
      headers.set('Content-Length', String(rangeEnd - rangeStart + 1));
      if (parsedRange) headers.set('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${totalSize}`);
    }
    if (request.method === 'HEAD') {
      return new Response(null, { status: parsedRange ? 206 : 200, headers });
    }

    if (file.storage_type === 'telegram') {
      if (Number(file.is_chunked || 0) === 1) {
        const chunks = await loadChunkRows(file, config);
        if (!chunks.length) throw new Error('没有找到任何分片');
        const selections = buildChunkSelections(chunks, rangeStart, rangeEnd);
        if (!selections.length) throw new Error('请求范围没有对应分片');
        const stream = createTelegramChunkStream(selections, config);
        return new Response(stream, {
          status: parsedRange ? 206 : 200,
          headers
        });
      }

      if (!file.fileId) throw new Error('文件记录缺少 Telegram fileId');
      const response = await getTelegramFileResponse(
        file.fileId,
        config,
        parsedRange ? rangeStart : null,
        parsedRange ? rangeEnd : null
      );
      let body = response.body;
      if (parsedRange && response.status !== 206) {
        const buffer = await response.arrayBuffer();
        body = buffer.slice(rangeStart, rangeEnd + 1);
      }
      const output = new Response(body, {
        status: parsedRange ? 206 : 200,
        headers
      });
      return cacheAndReturnResponse(output, totalSize > 0 && totalSize <= 5 * 1024 * 1024);
    }

    if (file.storage_type === 'r2' && config.bucket) {
      const object = await config.bucket.get(file.fileId);
      if (object) {
        object.writeHttpMetadata(headers);
        return cacheAndReturnResponse(new Response(object.body, { headers }));
      }
    }

    if (file.url && file.url !== urlPattern) return Response.redirect(file.url, 302);
    return new Response('File not available', { status: 404 });
  } catch (error) {
    console.error('处理文件请求出错:', error);
    return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}

export function getContentType(ext) {
  const types = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    ico: 'image/x-icon',
    icon: 'image/x-icon',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    mkv: 'video/x-matroska',
    m4v: 'video/x-m4v',
    ts: 'video/mp2t',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wma: 'audio/x-ms-wma',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    rtf: 'application/rtf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    xml: 'application/xml',
    json: 'application/json',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    swf: 'application/x-shockwave-flash',
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    eot: 'application/vnd.ms-fontobject',
    ini: 'text/plain',
    yml: 'application/yaml',
    yaml: 'application/yaml',
    toml: 'text/plain',
    py: 'text/x-python',
    java: 'text/x-java',
    c: 'text/x-c',
    cpp: 'text/x-c++',
    cs: 'text/x-csharp',
    php: 'application/x-php',
    rb: 'text/x-ruby',
    go: 'text/x-go',
    rs: 'text/x-rust',
    sh: 'application/x-sh',
    bat: 'application/x-bat',
    sql: 'application/sql'
  };
  const lowerExt = ext.toLowerCase();
  return types[lowerExt] || 'application/octet-stream';
}

export function getExtensionFromMime(mimeType) {
  if (!mimeType) return 'jpg';
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
    'image/tiff': 'tiff',
    'image/x-icon': 'ico',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/x-msvideo': 'avi',
    'video/quicktime': 'mov',
    'video/x-ms-wmv': 'wmv',
    'video/x-flv': 'flv',
    'video/x-matroska': 'mkv',
    'video/x-m4v': 'm4v',
    'video/mp2t': 'ts',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/x-ms-wma': 'wma',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/rtf': 'rtf',
    'application/zip': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
    'application/x-tar': 'tar',
    'application/gzip': 'gz',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'text/html': 'html',
    'text/css': 'css',
    'text/javascript': 'js',
    'application/javascript': 'js',
    'application/json': 'json',
    'application/xml': 'xml',
    'font/ttf': 'ttf',
    'font/otf': 'otf',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'application/vnd.ms-fontobject': 'eot',
    'application/octet-stream': 'bin',
    'application/x-shockwave-flash': 'swf'
  };
  return mimeMap[mimeType] || 'bin';
}
