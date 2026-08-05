// 上传网页文件类型

import {
  UPLOAD_PAGE_ALLOWED_TYPE_KEYS
} from './constants.js'

export function normalizeUploadPageAllowedTypes(value) {
  let source = value
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch (_) {
      source = source.split(',')
    }
  }
  if (!Array.isArray(source)) source = []
  const values = source
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => UPLOAD_PAGE_ALLOWED_TYPE_KEYS.includes(item))
  return values.length ? Array.from(new Set(values)) : [...UPLOAD_PAGE_ALLOWED_TYPE_KEYS]
}

export function getUploadPageFileTypeKey(mimeType, fileName) {
  const mime = String(mimeType || '').toLowerCase()
  const extension = String(fileName || '').split('.').pop().toLowerCase()
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'tif', 'tiff', 'ico'].includes(extension)) {
    return 'image'
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv', 'ts'].includes(extension)) {
    return 'video'
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'].includes(extension)) {
    return 'audio'
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'].includes(extension)) {
    return 'archive'
  }
  if (
    mime.startsWith('text/') ||
    ['application/pdf', 'application/json', 'application/xml', 'application/rtf'].includes(mime) ||
    ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'xml', 'rtf'].includes(extension)
  ) {
    return 'document'
  }
  return 'other'
}

export function isUploadPageFileAllowed(page, mimeType, fileName) {
  const allowed = normalizeUploadPageAllowedTypes(page && page.allowed_types)
  return allowed.includes(getUploadPageFileTypeKey(mimeType, fileName))
}
