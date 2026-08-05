// 通用工具

// 处理文本输入
export function normalizeInput(str) {
  return (str || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

export function extractKeyFromInput(input) {
  try {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const u = new URL(input);
      return decodeURIComponent(u.pathname.split('/').pop());
    }
  } catch (e) {}
  return input.split('/').pop();
}

// 处理显示格式
export function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDate(timestamp) {
  if (!timestamp) return '未知时间';
  let date;
  try {
    let msTimestamp;
    if (typeof timestamp === 'number') {
      msTimestamp = timestamp > 9999999999 ? timestamp : timestamp * 1000;
    } else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        msTimestamp = date.getTime();
      } else {
        const numTimestamp = parseInt(timestamp);
        if (!isNaN(numTimestamp)) {
          msTimestamp = numTimestamp > 9999999999 ? numTimestamp : numTimestamp * 1000;
        } else {
          return '日期无效 (无法解析)';
        }
      }
    } else if (timestamp instanceof Date) {
      msTimestamp = timestamp.getTime();
    } else {
       return '日期无效 (类型错误)';
    }
    if (msTimestamp < 0 || msTimestamp > 8640000000000000) {
        return '日期无效 (范围超限)';
    }
    date = new Date(msTimestamp);
    if (isNaN(date.getTime())) {
        return '日期无效 (转换失败)';
    }
    const beijingTimeOffset = 8 * 60 * 60 * 1000;
    const beijingDate = new Date(date.getTime() + beijingTimeOffset);
    const year = beijingDate.getUTCFullYear();
    const month = (beijingDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = beijingDate.getUTCDate().toString().padStart(2, '0');
    const hours = beijingDate.getUTCHours().toString().padStart(2, '0');
    const minutes = beijingDate.getUTCMinutes().toString().padStart(2, '0');
    const seconds = beijingDate.getUTCSeconds().toString().padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    console.error("formatDate 错误:", error, "原始输入:", timestamp);
    return '日期格式化错误';
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getFileName(url) {
  try {
    const urlObj = new URL(String(url || ''));
    const pathParts = urlObj.pathname.split('/');
    return decodeURIComponent(pathParts[pathParts.length - 1] || '');
  } catch (_) {
    return String(url || '').split('/').pop() || '';
  }
}
