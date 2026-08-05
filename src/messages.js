// 共用消息格式

import {
  formatSize,
  escapeHtml
} from './utils.js'

export function buildUploadCompletedCaption({
  title = '上传完成',
  fileName,
  fileSize,
  url,
  chunkCount = 0,
  includeQrHint = true
}) {
  return `✅ <b>${escapeHtml(title)}</b>\n\n` +
    `📄 文件：${escapeHtml(fileName)}\n` +
    `📦 大小：${formatSize(Number(fileSize || 0))}\n` +
    (Number(chunkCount || 0) > 1
      ? `🧩 分片：${Number(chunkCount)} 个\n`
      : '') +
    `🔗 ${escapeHtml(url)}` +
    (includeQrHint ? '\n\n🔍 扫描二维码访问' : '')
}
