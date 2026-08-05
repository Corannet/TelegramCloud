// 运行常量

export const TELEGRAM_MANIFEST_MAGIC = 'tgstate-blob';

export const LARGE_UPLOAD_SESSION_STATUS = Object.freeze({
  PENDING: 'pending',
  UPLOADING: 'uploading',
  FINALIZING: 'finalizing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
});

export const LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES = 10;

export const LARGE_UPLOAD_CHUNK_TIMEOUT_MS =
  LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES * 60 * 1000;

export const UPLOAD_PAGE_ALLOWED_TYPE_KEYS = Object.freeze([
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'other'
]);
