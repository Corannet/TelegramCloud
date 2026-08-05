// 电报接口

import {
  buildUploadCompletedCaption
} from './messages.js'

// 构建电报接口地址
export function normalizeTelegramApiRoot(value) {
  const root = String(value || 'https://api.telegram.org').trim();
  return (root || 'https://api.telegram.org').replace(/\/+$/, '');
}

export function getTelegramApiRoot(config = null) {
  return normalizeTelegramApiRoot(
    (config && config.tgApiBaseUrl) ||
    globalThis.__TG_BOT_API_BASE_URL ||
    'https://api.telegram.org'
  );
}

export function getTelegramFileRoot(config = null) {
  return normalizeTelegramApiRoot(
    (config && config.tgFileBaseUrl) ||
    globalThis.__TG_BOT_FILE_BASE_URL ||
    getTelegramApiRoot(config)
  );
}

export function telegramMethodUrl(botToken, method, config = null) {
  return `${getTelegramApiRoot(config)}/bot${botToken}/${String(method || '').replace(/^\/+/, '')}`;
}

export function telegramFileDownloadUrl(botToken, filePath, config = null) {
  const path = String(filePath || '').replace(/^\/+/, '');
  return `${getTelegramFileRoot(config)}/file/bot${botToken}/${path}`;
}

export async function fetchTelegramBinaryFile(
  fileId,
  filePath,
  config,
  requestHeaders = null
) {
  const headers = new Headers(requestHeaders || undefined);
  if (config && config.tgFileProxyUrl) {
    const proxyUrl = new URL(config.tgFileProxyUrl);
    proxyUrl.searchParams.set('file_id', String(fileId || ''));
    if (config.tgFileProxySecret) {
      headers.set('X-Telegram-File-Proxy-Secret', config.tgFileProxySecret);
    }
    return fetch(proxyUrl.toString(), { headers });
  }
  return fetch(
    telegramFileDownloadUrl(config.tgBotToken, filePath, config),
    { headers }
  );
}

// 配置机器人回调地址
export async function setWebhook(webhookUrl, botToken) {
  if (!botToken) {
    console.log('未配置Telegram机器人令牌，跳过webhook设置');
    return true;
  }
  const maxRetries = 3;
  let retryCount = 0;
  while (retryCount < maxRetries) {
    try {
      console.log(`尝试设置webhook: ${webhookUrl}`);
      const response = await fetch(
        `${telegramMethodUrl(botToken, 'setWebhook')}?url=${encodeURIComponent(webhookUrl)}`
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Telegram API错误: HTTP ${response.status} - ${errorText}`);
        retryCount++;
        continue;
      }
      const result = await response.json();
      if (!result.ok) {
        if (result.error_code === 429) {
          const retryAfter = result.parameters?.retry_after || 1;
          console.log(`请求频率限制，等待 ${retryAfter} 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          retryCount++;
          continue;
        }
        console.error(`设置webhook失败: ${JSON.stringify(result)}`);
        return false;
      }
      console.log(`Webhook设置成功: ${webhookUrl}`);
    return true;
  } catch (error) {
      console.error(`设置webhook时出错: ${error.message}`);
      retryCount++;
      if (retryCount < maxRetries) {
        const delay = 1000 * Math.pow(2, retryCount);
        console.log(`等待 ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay)); 
      }
    }
  }
  console.error('多次尝试后仍未能设置webhook');
  return false;
}

export async function deleteTelegramStorageMessage(messageId, config) {
  if (!messageId || Number(messageId) <= 0 || !config.tgStorageChatId) return true;
  try {
    const response = await fetch(
      telegramMethodUrl(config.tgBotToken, 'deleteMessage', config),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.tgStorageChatId,
          message_id: Number(messageId)
        })
      }
    );
    const data = await response.json().catch(() => null);
    if (response.ok && data && data.ok) return true;
    const description = data && data.description ? data.description : '';
    if (/message to delete not found|message can't be deleted/i.test(description)) {
      return false;
    }
    console.warn(`删除 Telegram 消息 ${messageId} 失败:`, description || response.status);
    return false;
  } catch (error) {
    console.warn(`删除 Telegram 消息 ${messageId} 出错:`, error.message);
    return false;
  }
}

export async function editTelegramTextMessage(chatId, messageId, text, config, replyMarkup = null) {
  if (!messageId) return false;
  const body = {
    chat_id: chatId,
    message_id: Number(messageId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(
        telegramMethodUrl(config.tgBotToken, 'editMessageText', config),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      );
      const data = await response.json().catch(() => null);
      if (response.ok && data && data.ok) return true;
      const description = data && data.description ? data.description : '';
      if (/message is not modified/i.test(description)) return true;
      if (data && Number(data.error_code) === 429 && attempt < 3) {
        const retryAfter = Number(data.parameters && data.parameters.retry_after) || 1;
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      console.warn('编辑 Telegram 进度消息失败:', description || response.status);
      return false;
    } catch (error) {
      if (attempt >= 3) {
        console.warn('编辑 Telegram 进度消息出错:', error.message);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  return false;
}

export async function sendUploadCompletedWithQr({
  chatId,
  title = '上传完成',
  fileName,
  fileSize,
  url,
  chunkCount = 0
}, config) {
  const qrCodeUrl =
    'https://api.qrserver.com/v1/create-qr-code/' +
    `?size=320x320&data=${encodeURIComponent(url)}`;

  const response = await fetch(
    telegramMethodUrl(config.tgBotToken, 'sendPhoto', config),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: qrCodeUrl,
        caption: buildUploadCompletedCaption({
          title,
          fileName,
          fileSize,
          url,
          chunkCount
        }),
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 打开文件',
                url
              }
            ]
          ]
        }
      })
    }
  );

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.ok) {
    throw new Error(
      (data && data.description) ||
      `Telegram sendPhoto 返回 HTTP ${response.status}`
    );
  }
  return data;
}

// 发送机器人消息
export async function sendMessage(
  chatId,
  text,
  botToken,
  replyToMessageId = null,
  replyMarkup = null
) {
  try {
    const requestBody = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    };

    if (replyToMessageId) {
      requestBody.reply_to_message_id = replyToMessageId;
    }

    
    if (replyMarkup) {
      requestBody.reply_markup = replyMarkup;
    }

    const response = await fetch(
      telegramMethodUrl(botToken, 'sendMessage'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorData = await response.text();

      console.error(
        `发送消息失败: HTTP ${response.status}, ${errorData}`
      );

      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('发送消息错误:', error);
    return null;
  }
}

export function getPauseKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "⏸ 暂停并返回主菜单",
          callback_data: "pause_and_back"
        }
      ]
    ]
  };
}

export async function sendInputPrompt(chatId, text, config) {
  return sendMessage(
    chatId,
    text,
    config.tgBotToken,
    null,
    getPauseKeyboard()
  );
}

export async function deleteTelegramMessage(
  chatId,
  messageId,
  botTokenOrConfig
) {
  const telegramConfig =
    botTokenOrConfig && typeof botTokenOrConfig === 'object'
      ? botTokenOrConfig
      : null;

  const botToken = telegramConfig
    ? telegramConfig.tgBotToken
    : botTokenOrConfig;

  if (!chatId || !messageId || !botToken) {
    return false;
  }

  try {
    const response = await fetch(
      telegramMethodUrl(
        botToken,
        'deleteMessage',
        telegramConfig
      ),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: Number(messageId)
        })
      }
    );

    const result = await response.json().catch(() => null);

    if (
      !response.ok ||
      !result ||
      !result.ok
    ) {
      console.warn(
        '[TG Menu] 删除旧消息失败:',
        result || `HTTP ${response.status}`
      );

      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      '[TG Menu] 删除旧消息时出错:',
      error
    );

    return false;
  }
}

export async function deleteCallbackSourceMessage(update, config) {
  const callbackMessage =
    update &&
    update.callback_query &&
    update.callback_query.message;

  if (!callbackMessage) {
    return false;
  }

  return deleteTelegramMessage(
    callbackMessage.chat.id,
    callbackMessage.message_id,
    config.tgBotToken
  );
}
