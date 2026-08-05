// 机器人消息处理

import {
  isTelegramAdmin,
  normalizeTelegramUserId,
  isAllowedTelegramUser,
  listAllowedTelegramUsers,
  addAllowedTelegramUser,
  removeAllowedTelegramUser
} from './auth.js'

import {
  acquireUploadLock,
  releaseUploadLock
} from './database.js'

import {
  createLargeUploadSession
} from './large-upload.js'

import {
  generateSafeKey,
  createPublicFileIdentity,
  sanitizeTelegramFileName,
  insertFileRecord,
  getStoredDisplayName,
  renameStoredFileRecord,
  deleteStoredFileRecord,
  saveTelegramFileFromResponse,
  getContentType,
  getExtensionFromMime
} from './storage.js'

import {
  telegramMethodUrl,
  fetchTelegramBinaryFile,
  editTelegramTextMessage,
  sendUploadCompletedWithQr,
  sendMessage,
  sendInputPrompt,
  deleteTelegramMessage,
  deleteCallbackSourceMessage
} from './telegram.js'

import {
  normalizeInput,
  extractKeyFromInput,
  formatSize,
  formatDate,
  escapeHtml,
  getFileName
} from './utils.js'

import {
  buildUploadCompletedCaption
} from './messages.js'

// 处理机器人更新
export async function handleTelegramWebhook(request, config, executionCtx = null) {
  try {
    const update = await request.json();
    let chatId;
    let userId;
    if (update.message) {
      chatId = update.message.chat.id.toString();
      userId = update.message.from.id.toString();
      console.log(`[Webhook] Received message from chat ID: ${chatId}, User ID: ${userId}`);
      
      if (update.message.chat.type === 'group' || update.message.chat.type === 'supergroup') {
        console.log(`[Webhook] Ignoring message from group/supergroup chat ID: ${chatId}`);
        return new Response('OK');
      }
      
    } else if (update.callback_query) {
      chatId = update.callback_query.from.id.toString();
      userId = update.callback_query.from.id.toString();
      console.log(`[Webhook] Received callback_query from chat ID: ${chatId}, User ID: ${userId}`);
    } else {
      console.log('[Webhook] Received update without message or callback_query:', JSON.stringify(update));
      return new Response('OK');
    }
    const isAdmin = isTelegramAdmin(chatId, config);
    
    let isAllowed = false;
    
    try {
      isAllowed =
        isAdmin ||
        await isAllowedTelegramUser(chatId, config);
    } catch (error) {
      console.error(
        `[Auth Check] 查询用户授权失败: ${error.message}`
      );
    
      return new Response(
        'Authorization database error',
        { status: 500 }
      );
    }
    
    if (!isAllowed) {
      console.log(
        `[Auth Check] FAILED: Chat ID ${chatId}, ` +
        `User ID ${userId} is not authorized.`
      );
    
      if (config.tgBotToken) {
        await sendMessage(
          chatId,
          "❌ 你无权使用，请联系管理员",
          config.tgBotToken
        );
      }
    
      return new Response('OK');
    }
    
    console.log(
      `[Auth Check] PASSED: Chat ID ${chatId}, ` +
      `User ID ${userId}, admin=${isAdmin}.`
    );
    let userSetting = await config.database.prepare('SELECT * FROM user_settings WHERE chat_id = ?').bind(chatId).first();
    if (!userSetting) {
      let defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?').bind('默认分类').first();
      let defaultCategoryId = null;
      if (!defaultCategory) {
          try {
              console.log('默认分类不存在，为新用户创建...');
              const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
                  .bind('默认分类', Date.now()).run();
              defaultCategoryId = result.meta && result.meta.last_row_id;
              console.log(`新默认分类创建成功，ID: ${defaultCategoryId}`);
          } catch (error) {
              console.error('为新用户创建默认分类失败:', error);
          }
      } else {
          defaultCategoryId = defaultCategory.id;
      }
      await config.database.prepare('INSERT INTO user_settings (chat_id, storage_type, current_category_id) VALUES (?, ?, ?)')
         .bind(chatId, 'telegram', defaultCategoryId).run();
      
      userSetting = { 
       chat_id: chatId, 
       storage_type: 'telegram', 
       current_category_id: defaultCategoryId 
      };
    }
    if (update.message) {
      const incomingText =
        typeof update.message.text === 'string'
          ? update.message.text
          : '';
    
      


      if (
        userSetting.waiting_for &&
        isPauseCommand(incomingText)
      ) {
        await resetWaitingState(
          chatId,
          userSetting,
          config
        );
    
        await sendMessage(
          chatId,
          "⏸ 已暂停当前操作，已返回主菜单",
          config.tgBotToken
        );
    
        await sendPanel(
          chatId,
          userSetting,
          config
        );
    
        return new Response('OK');
      }
    
      


      if (
        userSetting.waiting_for &&
        !update.message.text
      ) {
        await sendInputPrompt(
          chatId,
          "⚠️ 当前操作需要文字输入\n\n" +
          getWaitingPromptText(
            userSetting.waiting_for
          ),
          config
        );
    
        return new Response('OK');
      }
    
      
      if (
        userSetting.waiting_for === 'add_user_id' &&
        update.message.text
      ) {
        
        if (!isTelegramAdmin(chatId, config)) {
          await resetWaitingState(
            chatId,
            userSetting,
            config
          );
      
          await sendMessage(
            chatId,
            "❌ 只有 TG_ADMIN_ID 管理员可以添加用户",
            config.tgBotToken
          );
      
          await sendPanel(
            chatId,
            userSetting,
            config
          );
      
          return new Response('OK');
        }
      
        const targetUserId = normalizeTelegramUserId(
          update.message.text
        );
      
        


        if (!targetUserId) {
          await sendInputPrompt(
            chatId,
            "⚠️ 用户 ID 格式不正确\n\n" +
            "请继续输入纯数字 Telegram 用户 ID，" +
            "例如：123456789",
            config
          );
      
          return new Response('OK');
        }
      
        try {
          const result = await addAllowedTelegramUser(
            targetUserId,
            chatId,
            config
          );
      
          


          await resetWaitingState(
            chatId,
            userSetting,
            config
          );
      
          if (result.alreadyAdmin) {
            await sendMessage(
              chatId,
              `ℹ️ 用户 ${targetUserId} 已经是 ` +
              "TG_ADMIN_ID 管理员，无需重复添加",
              config.tgBotToken
            );
          } else if (!result.created) {
            await sendMessage(
              chatId,
              `ℹ️ 用户 ${targetUserId} 已经在授权列表中`,
              config.tgBotToken
            );
          } else {
            await sendMessage(
              chatId,
              `✅ 已添加授权用户：${targetUserId}`,
              config.tgBotToken
            );
          }
      
          await sendPanel(
            chatId,
            userSetting,
            config
          );
      
          return new Response('OK');
        } catch (error) {
          console.error(
            '添加授权用户失败:',
            error
          );
      
          


          await sendInputPrompt(
            chatId,
            "❌ 添加用户失败：" +
            escapeHtml(error.message) +
            "\n\n请重新输入用户 ID，" +
            "或点击下方按钮暂停",
            config
          );
      
          return new Response('OK');
        }
      }
      else if (
        userSetting.waiting_for === 'new_category' &&
        update.message.text
      ) {
        const categoryName = String(
          update.message.text || ''
        ).trim();
      
        if (!categoryName) {
          await sendInputPrompt(
            chatId,
            "⚠️ 分类名称不能为空\n\n" +
            "请继续输入新分类名称",
            config
          );
      
          return new Response('OK');
        }
      
        if (categoryName.length > 50) {
          await sendInputPrompt(
            chatId,
            "⚠️ 分类名称不能超过 50 个字符\n\n" +
            "请重新输入",
            config
          );
      
          return new Response('OK');
        }
      
        try {
          const existingCategory =
            await config.database.prepare(`
              SELECT id
              FROM categories
              WHERE name = ?
              LIMIT 1
            `).bind(categoryName).first();
      
          if (existingCategory) {
            await sendInputPrompt(
              chatId,
              `⚠️ 分类“${escapeHtml(categoryName)}”已存在\n\n` +
              "请继续输入其他分类名称",
              config
            );
      
            return new Response('OK');
          }
      
          const result =
            await config.database.prepare(`
              INSERT INTO categories (
                name,
                created_at
              )
              VALUES (?, ?)
            `).bind(
              categoryName,
              Date.now()
            ).run();
      
          let newCategoryId =
            result.meta &&
            result.meta.last_row_id;
      
          if (!newCategoryId) {
            const newCategory =
              await config.database.prepare(`
                SELECT id
                FROM categories
                WHERE name = ?
                LIMIT 1
              `).bind(categoryName).first();
      
            newCategoryId =
              newCategory && newCategory.id;
          }
      
          if (!newCategoryId) {
            throw new Error(
              '创建后未能获取分类 ID'
            );
          }
      
          await config.database.prepare(`
            UPDATE user_settings
            SET current_category_id = ?,
                waiting_for = NULL,
                editing_file_id = NULL
            WHERE chat_id = ?
          `).bind(
            newCategoryId,
            chatId
          ).run();
      
          userSetting.current_category_id =
            newCategoryId;
      
          userSetting.waiting_for = null;
          userSetting.editing_file_id = null;
      
          await sendMessage(
            chatId,
            `✅ 分类“${escapeHtml(categoryName)}”` +
            "创建成功，并已设为当前分类",
            config.tgBotToken
          );
      
          await sendPanel(
            chatId,
            userSetting,
            config
          );
      
          return new Response('OK');
        } catch (error) {
          console.error(
            '创建分类失败:',
            error
          );
      
          
          await sendInputPrompt(
            chatId,
            "❌ 创建分类失败：" +
            escapeHtml(error.message) +
            "\n\n请重新输入，或点击暂停",
            config
          );
      
          return new Response('OK');
        }
      }
      else if (userSetting.waiting_for === 'new_suffix' && update.message.text && userSetting.editing_file_id) {
        const fileId = userSetting.editing_file_id;
        try {
          const file = await config.database.prepare(
            'SELECT * FROM files WHERE id = ? AND chat_id = ?'
          ).bind(fileId, chatId).first();
          if (!file) {
            await sendMessage(chatId, "⚠️ 文件不存在、已被删除或不属于当前用户", config.tgBotToken);
          } else {
            const renamed = await renameStoredFileRecord(
              file,
              update.message.text,
              config
            );
            const chunkText = renamed.isChunked
              ? `
🧩 分片：${renamed.chunkCount} 个（无需重新上传分片）`
              : '';
            await sendMessage(
              chatId,
              `✅ 文件名修改成功！${chunkText}

新名称：${escapeHtml(renamed.fileName)}
新链接：${renamed.url}`,
              config.tgBotToken
            );
          }
        } catch (error) {
          console.error('修改文件名失败:', error);
          await sendMessage(chatId, `❌ 修改失败: ${escapeHtml(error.message)}`, config.tgBotToken);
        }
        await resetWaitingState(chatId, userSetting, config);
        await sendPanel(chatId, userSetting, config);
        return new Response('OK');
      }
      else if (userSetting.waiting_for === 'delete_file_input' && update.message.text) {
        try {
          const userInput = update.message.text;
          let fileToDelete = await findFileRecord(userInput, chatId, config);
          if (!fileToDelete) {
            await sendInputPrompt(
              chatId,
              "⚠️ 未找到匹配的文件\n\n" +
              "请继续输入完整文件名称或完整 URL",
              config
            );
          
            return new Response('OK');
          }
          const fileName = fileToDelete.file_name || getFileName(fileToDelete.url);
          console.log(`[TG Delete] 找到匹配文件: ID=${fileToDelete.id}, 名称=${fileName}, URL=${fileToDelete.url}`);
          console.log(`[TG Delete] 开始删除: ID=${fileToDelete.id}, 类型=${fileToDelete.storage_type}, TGMsgID=${fileToDelete.message_id}, R2ID=${fileToDelete.fileId}`);
          await deleteStoredFileRecord(fileToDelete, config);
          await resetWaitingState(
            chatId,
            userSetting,
            config
          );
          console.log(`[TG Delete] 存储对象、分片和数据库记录已删除: ID=${fileToDelete.id}`);
          const cacheKey = `file:${fileName}`;
          if (config.fileCache && config.fileCache.has(cacheKey)) {
            config.fileCache.delete(cacheKey);
            console.log(`[TG Delete] 文件缓存已清除: ${cacheKey}`);
          }
          await sendMessage(chatId, `✅ 文件已成功删除: ${fileName}`, config.tgBotToken);
          await sendPanel(chatId, userSetting, config);
          return new Response('OK');
        } catch (error) {
          console.error(`[TG Delete] 删除过程中出错:`, error);
          await sendMessage(chatId, `❌ 删除文件时出错: ${error.message}`, config.tgBotToken);
          await sendPanel(chatId, userSetting, config);
          return new Response('OK');
        }
      }
      if (update.message.text === '/start') {
        await sendPanel(chatId, userSetting, config);
      }
      else if (update.message.photo || update.message.document || update.message.video || update.message.audio || update.message.voice || update.message.video_note) {
        console.log('收到文件上传:', JSON.stringify({
          hasPhoto: !!update.message.photo,
          hasDocument: !!update.message.document,
          hasVideo: !!update.message.video,
          hasAudio: !!update.message.audio,
          hasVoice: !!update.message.voice,
          hasVideoNote: !!update.message.video_note
        }));
        let file;
        let isDocument = false;
        if (update.message.document) {
          file = update.message.document;
          isDocument = true;
        } else if (update.message.video) {
          file = update.message.video;
          isDocument = true;
        } else if (update.message.audio) {
          file = update.message.audio;
          isDocument = true;
        } else if (update.message.voice) {
          file = update.message.voice;
          isDocument = true;
        } else if (update.message.video_note) {
          file = update.message.video_note;
          isDocument = true;
        } else if (update.message.photo) {
          file = update.message.photo && update.message.photo.length ? update.message.photo[update.message.photo.length - 1] : null;
          isDocument = false;
        }
        if (file) {
          const processMediaUpload = async () => {
            const gotLock = await acquireUploadLock(chatId, config);
            if (!gotLock) {
              await sendMessage(chatId, "⏳ 有其他文件正在处理中，请稍后重试或稍等片刻", config.tgBotToken);
              return;
            }
            try {
              await handleMediaUpload(
                chatId,
                file,
                isDocument,
                config,
                userSetting,
                update.message.message_id
              );
            } finally {
              await releaseUploadLock(chatId, config);
            }
          };

          if (executionCtx && typeof executionCtx.waitUntil === 'function') {
            executionCtx.waitUntil(processMediaUpload());
            return new Response('OK');
          }
          await processMediaUpload();
        } else {
          await sendMessage(chatId, "❌ 无法识别的文件类型", config.tgBotToken);
        }
      }
      else {
        const message = update.message;
        let fileField = null;
        for (const field in message) {
          if (message[field] && typeof message[field] === 'object' && message[field].file_id) {
            fileField = field;
            break;
          }
        }
        if (fileField) {
          console.log(`找到未明确处理的文件类型: ${fileField}`, JSON.stringify(message[fileField]));
          const processUnknownMediaUpload = async () => {
            const gotLock = await acquireUploadLock(chatId, config);
            if (!gotLock) {
              await sendMessage(chatId, "⏳ 有其他文件正在处理中，请稍后重试", config.tgBotToken);
              return;
            }
            try {
              await handleMediaUpload(
                chatId,
                message[fileField],
                true,
                config,
                userSetting,
                update.message.message_id
              );
            } finally {
              await releaseUploadLock(chatId, config);
            }
          };

          if (executionCtx && typeof executionCtx.waitUntil === 'function') {
            executionCtx.waitUntil(processUnknownMediaUpload());
            return new Response('OK');
          }
          await processUnknownMediaUpload();
        } else if (userSetting.waiting_for === 'edit_suffix_input_file' && message.text) {
          try {
            const userInput = message.text.trim();
            let fileToEdit = null;
            if (userInput.startsWith('http://') || userInput.startsWith('https://')) {
              fileToEdit = await config.database.prepare(
                'SELECT id, url, file_name FROM files WHERE url = ? AND chat_id = ?'
              ).bind(userInput, chatId).first();
            } else {
              let fileName = userInput;
              if (!fileName.includes('.')) {
                await sendMessage(chatId, "⚠️ 请输入完整的文件名称（包含扩展名）或完整URL", config.tgBotToken);
                await config.database.prepare('UPDATE user_settings SET waiting_for = NULL, editing_file_id = NULL WHERE chat_id = ?')
                  .bind(chatId).run();
                userSetting.waiting_for = null;
                userSetting.editing_file_id = null;
                await sendPanel(chatId, userSetting, config);
                return new Response('OK');
              }
              fileToEdit = await config.database.prepare(
                'SELECT id, url, file_name FROM files WHERE (file_name = ? OR url LIKE ?) AND chat_id = ? ORDER BY created_at DESC LIMIT 1'
              ).bind(fileName, `%/${fileName}`, chatId).first();
            }
            if (!fileToEdit) {
              await sendMessage(chatId, "⚠️ 未找到匹配的文件，请输入完整的文件名称或URL", config.tgBotToken);
              await config.database.prepare('UPDATE user_settings SET waiting_for = NULL, editing_file_id = NULL WHERE chat_id = ?')
                .bind(chatId).run();
              userSetting.waiting_for = null;
              userSetting.editing_file_id = null;
              await sendPanel(chatId, userSetting, config);
              return new Response('OK');
            }
            const fileName = fileToEdit.file_name || getFileName(fileToEdit.url);
            const fileNameParts = fileName.split('.');
            const extension = fileNameParts.pop();
            const currentSuffix = fileNameParts.join('.');
            await config.database.prepare('UPDATE user_settings SET waiting_for = ?, editing_file_id = ? WHERE chat_id = ?')
              .bind('edit_suffix_input_new', fileToEdit.id, chatId).run();
            userSetting.waiting_for = 'edit_suffix_input_new';
            userSetting.editing_file_id = fileToEdit.id;
            await sendMessage(
              chatId,
              `📝 找到文件: ${fileName}\n当前后缀: ${currentSuffix}\n\n请回复此消息，输入文件的新后缀（不含扩展名）`,
              config.tgBotToken
            );
            return new Response('OK');
          } catch (error) {
            console.error('处理修改后缀文件选择失败:', error);
            await sendMessage(chatId, `❌ 处理失败: ${error.message}`, config.tgBotToken);
            await config.database.prepare('UPDATE user_settings SET waiting_for = NULL, editing_file_id = NULL WHERE chat_id = ?')
              .bind(chatId).run();
            userSetting.waiting_for = null;
            userSetting.editing_file_id = null;
            await sendPanel(chatId, userSetting, config);
            return new Response('OK');
          }
        } else if (userSetting.waiting_for === 'edit_suffix_input_new' && message.text && userSetting.editing_file_id) {
          const fileId = userSetting.editing_file_id;
          try {
            const file = await config.database.prepare(
              'SELECT * FROM files WHERE id = ? AND chat_id = ?'
            ).bind(fileId, chatId).first();
            if (!file) {
              await sendMessage(chatId, "⚠️ 文件不存在、已被删除或不属于当前用户", config.tgBotToken);
            } else {
              const renamed = await renameStoredFileRecord(file, message.text, config);
              const chunkText = renamed.isChunked
                ? `
🧩 分片：${renamed.chunkCount} 个（无需重新上传分片）`
                : '';
              await sendMessage(
                chatId,
                `✅ 文件名修改成功！${chunkText}

新名称：${escapeHtml(renamed.fileName)}
新链接：${renamed.url}`,
                config.tgBotToken
              );
            }
          } catch (error) {
            console.error('修改文件名失败:', error);
            await sendMessage(chatId, `❌ 修改失败: ${escapeHtml(error.message)}`, config.tgBotToken);
          }
          await resetWaitingState(chatId, userSetting, config);
          await sendPanel(chatId, userSetting, config);
          return new Response('OK');
        } else if (message.text && message.text !== '/start') {
          await sendMessage(chatId, "请发送图片或文件进行上传，或使用 /start 查看主菜单", config.tgBotToken);
        }
      }
    }
    else if (update.callback_query) {
      await handleCallbackQuery(update, config, userSetting);
    }
    return new Response('OK');
  } catch (error) {
    console.error('Error handling webhook:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
}

// 生成机器人菜单
export async function sendPanel(chatId, userSetting, config) {
  try {
    const menuRole = isTelegramAdmin(chatId, config)
      ? 'admin'
      : 'user';
    
    const cacheKey =
      `menu:${chatId}:` +
      `${userSetting.storage_type || 'default'}:` +
      `${menuRole}`;
    if (config.menuCache && config.menuCache.has(cacheKey)) {
      const cachedData = config.menuCache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < config.menuCacheTTL) {
        console.log(`使用缓存的菜单: ${cacheKey}`);
        const response = await fetch(telegramMethodUrl(config.tgBotToken, 'sendMessage', config), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cachedData.menuData
        });
        if (!response.ok) {
          config.menuCache.delete(cacheKey);
          console.log(`缓存菜单发送失败，重新生成: ${await response.text()}`);
        } else {
          return await response.json();
        }
      } else {
        config.menuCache.delete(cacheKey);
      }
    }
    const { messageBody, keyboard } = await generateMainMenu(chatId, userSetting, config);
    const menuData = JSON.stringify({
      chat_id: chatId,
      text: messageBody,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
    if (config.menuCache) {
      config.menuCache.set(cacheKey, {
        menuData,
        timestamp: Date.now()
      });
    }
    const response = await fetch(telegramMethodUrl(config.tgBotToken, 'sendMessage', config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: menuData
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`发送面板失败: ${errorText}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('发送面板出错:', error);
    return null;
  }
}

export async function generateMainMenu(chatId, userSetting, config) {
  const storageText = userSetting.storage_type === 'r2' ? 'R2对象存储' : 'Telegram存储';
  let categoryName = '未选择分类';
  const categoryPromise = userSetting.current_category_id ? 
      config.database.prepare('SELECT name FROM categories WHERE id = ?')
        .bind(userSetting.current_category_id).first() 
      : Promise.resolve(null);
  const statsPromise = config.database.prepare(`
    SELECT COUNT(*) as total_files, SUM(file_size) as total_size
    FROM files WHERE chat_id = ?
  `).bind(chatId).first();
  const notificationPromise = (async () => {
    const now = Date.now();
    if (!config.notificationCache || (now - config.lastNotificationFetch > config.notificationCacheTTL)) {
      try {
        console.log('[Notification] Fetching new notification...');
        config.notificationCache = await fetchNotification();
        config.lastNotificationFetch = now;
      } catch (error) {
        console.error('[Notification] Failed to fetch notification:', error);
        config.notificationCache = config.notificationCache || ''; 
      }
    }
    return config.notificationCache;
  })();
  const largeUploadSessionPromise = createLargeUploadSession(
    chatId,
    userSetting,
    config
  ).catch(error => {
    console.error('创建大文件上传临时页面失败:', error);
    return null;
  });

  const [categoryResult, stats, notificationText, largeUploadSession] = await Promise.all([
    categoryPromise,
    statsPromise,
    notificationPromise,
    largeUploadSessionPromise
  ]);
  if (categoryResult) {
    categoryName = categoryResult.name;
  }
  const defaultNotification = 
    "➡️ 现在您可以直接发送图片或文件，上传完成后会自动生成图床直链";
  
  const messageBody = `☁️ <b>图床助手v2</b>
  📂 当前存储：${storageText}
  📁 当前分类：${categoryName}
  📊 已上传：${stats && stats.total_files ? stats.total_files : 0} 个文件
  💾 已用空间：${formatSize(stats && stats.total_size ? stats.total_size : 0)}
  📤 超出20MB请使用上传大文件
  
  👇 请选择操作：`;
  const keyboard = getKeyboardLayout(
    userSetting,
    isTelegramAdmin(chatId, config),
    largeUploadSession && largeUploadSession.url
  );
  return { messageBody, keyboard };
}

export function getKeyboardLayout(userSetting, isAdmin = false, largeUploadUrl = '') {
  const rows = [];

  
  if (largeUploadUrl) {
    rows.push([
      {
        text: "📤 上传大文件",
        url: largeUploadUrl
      }
    ]);
  }

  rows.push([
    {
      text: "📋 选择分类",
      callback_data: "list_categories"
    }
  ]);

  
  if (isAdmin) {
    rows.push([
      {
        text: "📤 切换存储",
        callback_data: "switch_storage"
      },
      {
        text: "📊 R2统计",
        callback_data: "r2_stats"
      },
      {
        text: "📝 创建分类",
        callback_data: "create_category"
      },
    ],
    [
      {
        text: "➕ 添加用户",
        callback_data: "add_user"
      },
      {
        text: "➖ 删除用户",
        callback_data: "delete_user"
      }
    ]);
  }

  rows.push(
    [
      {
        text: "📂 最近文件",
        callback_data: "recent_files"
      },
      {
        text: "✏️ 修改后缀",
        callback_data: "edit_suffix_input"
      },
      {
        text: "🗑️ 删除文件",
        callback_data: "delete_file_input"
      }
    ],
    [
      {
        text: "📦 联系我们",
        url: "https://t.me/unmihari1"
      }
    ]
  );

  return {
    inline_keyboard: rows
  };
}

export async function findFileRecord(rawInput, chatId, config) {
  const input = normalizeInput(rawInput);
  if (!input) return null;
  const isUrl = input.startsWith('http://') || input.startsWith('https://');
  const basename = extractKeyFromInput(input);

  if (isUrl) {
    let rec = await config.database.prepare(
      'SELECT * FROM files WHERE url = ? AND (chat_id = ? OR chat_id IS NULL)'
    ).bind(input, chatId).first();
    if (rec) return rec;

    const altUrl = input.startsWith('https://')
      ? 'http://' + input.slice('https://'.length)
      : 'https://' + input.slice('http://'.length);
    rec = await config.database.prepare(
      'SELECT * FROM files WHERE url = ? AND (chat_id = ? OR chat_id IS NULL)'
    ).bind(altUrl, chatId).first();
    if (rec) return rec;
  }

  if (basename) {
    let rec = await config.database.prepare(
      'SELECT * FROM files WHERE (fileId = ? OR url LIKE ?) AND (chat_id = ? OR chat_id IS NULL) ORDER BY created_at DESC LIMIT 1'
    ).bind(basename, `%/${basename}`, chatId).first();
    if (rec) return rec;
  }

  if (!isUrl) {
    let rec = await config.database.prepare(
      'SELECT * FROM files WHERE (file_name = ? OR url LIKE ?) AND (chat_id = ? OR chat_id IS NULL) ORDER BY created_at DESC LIMIT 1'
    ).bind(input, `%/${input}`, chatId).first();
    if (rec) return rec;
  }

  return null;
}

// 处理机器人按钮操作
export async function handleCallbackQuery(update, config, userSetting) {
  const chatId = update.callback_query.from.id.toString();
  const cbData = update.callback_query.data;
  const answerPromise = fetch(telegramMethodUrl(config.tgBotToken, 'answerCallbackQuery', config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: update.callback_query.id })
  }).catch(error => {
    console.error('确认回调查询失败:', error);
  });
  try {
    
    if (cbData === 'pause_and_back') {
      await answerPromise;
    
      
      await resetWaitingState(
        chatId,
        userSetting,
        config
      );
    
      
      await deleteCallbackSourceMessage(
        update,
        config
      );
    
      
      await sendPanel(
        chatId,
        userSetting,
        config
      );
    
      return;
    }
    if (
      userSetting.waiting_for &&
      !cbData.startsWith('delete_file_do_')
    ) {
      if (
        !(
          userSetting.waiting_for === 'new_suffix' &&
          cbData.startsWith('edit_suffix_file_')
        ) &&
        !(
          userSetting.waiting_for === 'new_category' &&
          cbData === 'create_category'
        ) &&
        !(
          userSetting.waiting_for === 'add_user_id' &&
          cbData === 'add_user'
        ) &&
        !(
          userSetting.waiting_for === 'delete_file_input' &&
          cbData === 'delete_file_input'
        ) &&
        !(
          userSetting.waiting_for === 'edit_suffix_input_file' &&
          cbData === 'edit_suffix_input'
        ) &&
        !(
          userSetting.waiting_for === 'edit_suffix_input_new' &&
          userSetting.editing_file_id
        )
      ) {
        await config.database.prepare(`
          UPDATE user_settings
          SET waiting_for = NULL,
              editing_file_id = NULL
          WHERE chat_id = ?
        `).bind(chatId).run();
    
        userSetting.waiting_for = null;
        userSetting.editing_file_id = null;
      }
    }
    const cacheKey = `button:${chatId}:${cbData}`;
    const isStatefulOrNavigationCallback =
      cbData === 'switch_storage' ||
      cbData === 'add_user' ||
      cbData === 'delete_user' ||
      cbData === 'create_category' ||
      cbData === 'list_categories' ||
      cbData === 'recent_files' ||
      cbData === 'edit_suffix' ||
      cbData === 'edit_suffix_input' ||
      cbData === 'delete_file_input' ||
      cbData === 'back_to_panel' ||
      cbData === 'pause_and_back' ||
      cbData.startsWith('remove_user_') ||
      cbData.startsWith('set_category_') ||
      cbData.startsWith('edit_suffix_file_');
    if (
      config.buttonCache &&
      config.buttonCache.has(cacheKey) &&
      !isStatefulOrNavigationCallback &&
      !cbData.startsWith('delete_file_confirm_') &&
      !cbData.startsWith('delete_file_do_')
    ) {
      const cachedData = config.buttonCache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < config.buttonCacheTTL) {
        console.log(`使用缓存的按钮响应: ${cacheKey}`);
        await answerPromise;
        if (cachedData.responseText) {
          await sendMessage(chatId, cachedData.responseText, config.tgBotToken);
        }
        if (cachedData.sendPanel) {
          await sendPanel(chatId, userSetting, config);
        }
        if (cachedData.replyMarkup) {
          await fetch(telegramMethodUrl(config.tgBotToken, 'sendMessage', config), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: cachedData.replyText,
              reply_markup: cachedData.replyMarkup,
              parse_mode: 'HTML',
              disable_web_page_preview: cachedData.disablePreview || false
            })
          });
        }
        return;
      } else {
        config.buttonCache.delete(cacheKey);
      }
    }
    if (cbData === 'switch_storage') {
      
      if (
        config.tgAdminId &&
        config.tgAdminId.length > 0 &&
        !config.tgAdminId.includes(chatId)
      ) {
        await answerPromise;
    
        await sendMessage(
          chatId,
          "❌ 你没有权限切换存储模式",
          config.tgBotToken
        );
    
        return;
      }
    
      const newStorageType =
        userSetting.storage_type === 'telegram'
          ? 'r2'
          : 'telegram';
    
      await Promise.all([
        config.database.prepare(
          'UPDATE user_settings SET storage_type = ? WHERE chat_id = ?'
        )
        .bind(newStorageType, chatId)
        .run(),
    
        answerPromise
      ]);
    
      if (config.buttonCache) {
        config.buttonCache.set(cacheKey, {
          timestamp: Date.now(),
          sendPanel: true
        });
      }
    
      await sendMessage(
        chatId,
        `✅ 已切换存储模式：${newStorageType === 'r2' ? 'R2对象存储' : 'Telegram存储'}`,
        config.tgBotToken
      );
    
      await sendPanel(
        chatId,
        { ...userSetting, storage_type: newStorageType },
        config
      );
    }
    else if (cbData === 'add_user') {
      if (!isTelegramAdmin(chatId, config)) {
        await answerPromise;
    
        await sendMessage(
          chatId,
          "❌ 只有 TG_ADMIN_ID 管理员可以添加用户",
          config.tgBotToken
        );
    
        return;
      }
    
      await Promise.all([
        answerPromise,
    
        config.database.prepare(`
          UPDATE user_settings
          SET waiting_for = ?,
              editing_file_id = NULL
          WHERE chat_id = ?
        `).bind(
          'add_user_id',
          chatId
        ).run()
      ]);
    
      userSetting.waiting_for = 'add_user_id';
      userSetting.editing_file_id = null;
    
      await sendInputPrompt(
        chatId,
        "➕ 请输入需要授权的 Telegram 用户 ID\n\n" +
        "只输入纯数字，例如：123456789",
        config
      );
    }
    else if (cbData === 'delete_user') {
      if (!isTelegramAdmin(chatId, config)) {
        await answerPromise;
    
        await sendMessage(
          chatId,
          "❌ 只有 TG_ADMIN_ID 管理员可以删除用户",
          config.tgBotToken
        );
    
        return;
      }
    
      const users = await listAllowedTelegramUsers(config);
    
      await answerPromise;
    
      if (!users.length) {
        await sendMessage(
          chatId,
          "ℹ️ 当前没有普通授权用户",
          config.tgBotToken
        );
    
        return;
      }
    
      const userButtons = users.map(user => {
        return [
          {
            text: `🗑️ ${user.chat_id}`,
            callback_data: `remove_user_${user.chat_id}`
          }
        ];
      });
    
      userButtons.push([
        {
          text: "« 返回",
          callback_data: "back_to_panel"
        }
      ]);

      
      await deleteCallbackSourceMessage(
        update,
        config
      );
    
      await fetch(
        telegramMethodUrl(config.tgBotToken, 'sendMessage', config),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chat_id: chatId,
            text:
              "➖ 请选择要取消授权的用户：\n\n" +
              "删除授权不会删除该用户已经上传的文件",
            reply_markup: {
              inline_keyboard: userButtons
            }
          })
        }
      );
    }
    else if (cbData.startsWith('remove_user_')) {
      if (!isTelegramAdmin(chatId, config)) {
        await answerPromise;
    
        await sendMessage(
          chatId,
          "❌ 只有 TG_ADMIN_ID 管理员可以删除用户",
          config.tgBotToken
        );
    
        return;
      }
    
      const targetUserId = normalizeTelegramUserId(
        cbData.slice('remove_user_'.length)
      );
    
      await answerPromise;
    
      if (!targetUserId) {
        await sendMessage(
          chatId,
          "❌ 无效的 Telegram 用户 ID",
          config.tgBotToken
        );
    
        return;
      }
    
      try {
        const removed = await removeAllowedTelegramUser(
          targetUserId,
          config
        );
    
        if (removed) {
          await sendMessage(
            chatId,
            `✅ 已取消用户 ${targetUserId} 的使用权限`,
            config.tgBotToken
          );
        } else {
          await sendMessage(
            chatId,
            `ℹ️ 用户 ${targetUserId} 已不在授权列表中`,
            config.tgBotToken
          );
        }
      } catch (error) {
        console.error('删除授权用户失败:', error);
    
        await sendMessage(
          chatId,
          `❌ 删除用户失败：${error.message}`,
          config.tgBotToken
        );
      }

      await deleteCallbackSourceMessage(
        update,
        config
      );
      await sendPanel(chatId, userSetting, config);
    }
    else if (cbData === 'list_categories') {
      const categoriesPromise = config.database.prepare('SELECT id, name FROM categories').all();
      await answerPromise;
      const categories = await categoriesPromise;
      if (!categories.results || categories.results.length === 0) {
        await sendMessage(chatId, "⚠️ 暂无分类，请先创建分类", config.tgBotToken);
        return;
      }
      const categoriesText = categories.results.map((cat, i) =>
        `${i + 1}. ${cat.name}`
      ).join('\n');
      const keyboard = {
        inline_keyboard: categories.results.map(cat => [
          { text: cat.name, callback_data: `set_category_${cat.id}` }
        ]).concat([[{ text: "« 返回", callback_data: "back_to_panel" }]])
      };

      
      await deleteCallbackSourceMessage(
        update,
        config
      );
      
      if (config.buttonCache) {
        config.buttonCache.set(cacheKey, {
          timestamp: Date.now(),
          replyText: "📂 请选择要使用的分类：\n\n" + categoriesText,
          replyMarkup: keyboard
        });
      }
      
      await fetch(telegramMethodUrl(config.tgBotToken, 'sendMessage', config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: "📂 请选择要使用的分类：\n\n" + categoriesText,
          reply_markup: keyboard
        })
      });
    }
    else if (cbData === 'create_category') {
      
      if (!isTelegramAdmin(chatId, config)) {
        await answerPromise;

        await sendMessage(
          chatId,
          "❌ 你没有权限创建分类，请联系管理员",
          config.tgBotToken
        );

        return;
      }

      
      
      
      await Promise.all([
        answerPromise,
        config.database.prepare(`
          UPDATE user_settings
          SET waiting_for = ?,
              editing_file_id = NULL
          WHERE chat_id = ?
        `).bind(
          'new_category',
          chatId
        ).run()
      ]);

      userSetting.waiting_for = 'new_category';
      userSetting.editing_file_id = null;

      await sendInputPrompt(
        chatId,
        "📝 请输入新分类名称\n\n" +
        "分类名称最多 50 个字符",
        config
      );
    }
    else if (cbData.startsWith('set_category_')) {
      const categoryId = Number(
        cbData.slice('set_category_'.length)
      );
    
      await answerPromise;
    
      if (
        !Number.isInteger(categoryId) ||
        categoryId <= 0
      ) {
        await sendMessage(
          chatId,
          "❌ 无效的分类 ID",
          config.tgBotToken
        );
    
        return;
      }
    
      const category = await config.database.prepare(`
        SELECT id, name
        FROM categories
        WHERE id = ?
        LIMIT 1
      `).bind(categoryId).first();
    
      if (!category) {
        await sendMessage(
          chatId,
          "⚠️ 该分类不存在或已被删除",
          config.tgBotToken
        );
    
        return;
      }
    
      await config.database.prepare(`
        UPDATE user_settings
        SET current_category_id = ?,
            waiting_for = NULL,
            editing_file_id = NULL
        WHERE chat_id = ?
      `).bind(
        categoryId,
        chatId
      ).run();
    
      userSetting.current_category_id = categoryId;
      userSetting.waiting_for = null;
      userSetting.editing_file_id = null;
    
      
      await deleteCallbackSourceMessage(
        update,
        config
      );
    
      await sendMessage(
        chatId,
        `✅ 已切换到分类：${escapeHtml(category.name)}`,
        config.tgBotToken
      );
    
      await sendPanel(
        chatId,
        userSetting,
        config
      );
    
      return;
    }
    else if (cbData === 'back_to_panel') {
      await answerPromise;
    
      
      await resetWaitingState(
        chatId,
        userSetting,
        config
      );
    
      
      await deleteCallbackSourceMessage(
        update,
        config
      );
    
      
      await sendPanel(
        chatId,
        userSetting,
        config
      );
    
      return;
    }
    if (cbData === 'r2_stats') {
      
      if (
        config.tgAdminId &&
        config.tgAdminId.length > 0 &&
        !config.tgAdminId.includes(chatId)
      ) {
        await answerPromise;
        await sendMessage(
          chatId,
          "❌ 你没有权限查看 R2 统计，请联系管理员",
          config.tgBotToken
        );
        return;
      }
      await answerPromise;
      const stats = await statsPromise;
      const statsMessage = `📊 您的 R2 存储使用统计
  ─────────────
  📁 R2 文件数: ${stats.total_files || 0}
  💾 R2 存储量: ${formatSize(stats.total_size || 0)}`;
      if (config.buttonCache) {
        config.buttonCache.set(cacheKey, {
          timestamp: Date.now(),
          responseText: statsMessage
        });
      }
      await sendMessage(chatId, statsMessage, config.tgBotToken);
    }
    else if (cbData === 'edit_suffix') {
      await answerPromise;
      const recentFiles = await config.database.prepare(`
        SELECT id, url, fileId, file_name, created_at, storage_type,
               is_chunked, chunk_count
        FROM files
        WHERE chat_id = ?
        ORDER BY created_at DESC
        LIMIT 5
      `).bind(chatId).all();
      if (!recentFiles.results || recentFiles.results.length === 0) {
        await sendMessage(chatId, "⚠️ 您还没有上传过文件", config.tgBotToken);
        return;
      }
      const keyboard = {
        inline_keyboard: recentFiles.results.map(file => {
          const fileName = getStoredDisplayName(file);
          const chunkLabel = Number(file.is_chunked || 0) === 1
            ? ` 🧩${Number(file.chunk_count || 0)}`
            : '';
          return [{ text: `${fileName}${chunkLabel}`, callback_data: `edit_suffix_file_${file.id}` }];
        }).concat([[{ text: "« 返回", callback_data: "back_to_panel" }]])
      };
      await fetch(telegramMethodUrl(config.tgBotToken, 'sendMessage', config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: "📝 请选择要修改后缀的文件：",
          reply_markup: keyboard
        })
      });
    }
    else if (cbData.startsWith('edit_suffix_file_')) {
      await answerPromise;
      const fileId = Number(cbData.slice('edit_suffix_file_'.length));
      if (!Number.isInteger(fileId) || fileId <= 0) {
        await sendMessage(chatId, "❌ 文件标识无效", config.tgBotToken);
        return;
      }
      const file = await config.database.prepare(`
        SELECT * FROM files
        WHERE id = ? AND chat_id = ?
        LIMIT 1
      `).bind(fileId, chatId).first();
      if (!file) {
        await sendMessage(chatId, "⚠️ 文件不存在、已被删除或不属于当前用户", config.tgBotToken);
        return;
      }
      await config.database.prepare(`
        UPDATE user_settings
        SET waiting_for = 'new_suffix', editing_file_id = ?
        WHERE chat_id = ?
      `).bind(file.id, chatId).run();
      userSetting.waiting_for = 'new_suffix';
      userSetting.editing_file_id = file.id;
      const fileName = getStoredDisplayName(file);
      const chunkText = Number(file.is_chunked || 0) === 1
        ? `
🧩 这是分片文件，共 ${Number(file.chunk_count || 0)} 片；修改名称不会重新上传分片`
        : '';
      await sendInputPrompt(
        chatId,
        `✏️ 当前文件：${escapeHtml(fileName)}${chunkText}

请输入新的文件名主体（无需输入扩展名）`,
        config
      );
      return;
    }
    else if (cbData.startsWith('delete_file_confirm_')) {
      await answerPromise;
      const fileId = Number(cbData.slice('delete_file_confirm_'.length));
      const file = Number.isInteger(fileId) && fileId > 0
        ? await config.database.prepare(`
            SELECT * FROM files WHERE id = ? AND chat_id = ? LIMIT 1
          `).bind(fileId, chatId).first()
        : null;
      if (!file) {
        await sendMessage(chatId, "⚠️ 文件不存在、已被删除或不属于当前用户", config.tgBotToken);
        return;
      }
      const chunkText = Number(file.is_chunked || 0) === 1
        ? `
🧩 将同时删除 ${Number(file.chunk_count || 0)} 个分片和 1 个清单文件`
        : '';
      await fetch(telegramMethodUrl(config.tgBotToken, 'sendMessage', config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `⚠️ 确定删除“${getStoredDisplayName(file)}”吗？${chunkText}

删除后直链将立即失效`,
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ 确认删除', callback_data: `delete_file_do_${file.id}` },
              { text: '取消', callback_data: 'back_to_panel' }
            ]]
          }
        })
      });
      return;
    }
    else if (cbData.startsWith('delete_file_do_')) {
      await answerPromise;
      const fileId = Number(cbData.slice('delete_file_do_'.length));
      const file = Number.isInteger(fileId) && fileId > 0
        ? await config.database.prepare(`
            SELECT * FROM files WHERE id = ? AND chat_id = ? LIMIT 1
          `).bind(fileId, chatId).first()
        : null;
      if (!file) {
        await sendMessage(chatId, "⚠️ 文件不存在、已被删除或不属于当前用户", config.tgBotToken);
        return;
      }
      const fileName = getStoredDisplayName(file);
      const deleted = await deleteStoredFileRecord(file, config);
      await deleteCallbackSourceMessage(update, config);
      const warning = deleted.failedTelegramMessages.length
        ? `
⚠️ ${deleted.failedTelegramMessages.length} 条 Telegram 存储消息未能立即删除，但文件记录和直链已清理`
        : '';
      await sendMessage(
        chatId,
        `✅ 已删除：${escapeHtml(fileName)}
🧩 清理分片：${deleted.deletedChunkRows} 个${warning}`,
        config.tgBotToken
      );
      await sendPanel(chatId, userSetting, config);
      return;
    }
    else if (cbData === 'recent_files') {
      const recentFilesPromise = config.database.prepare(`
        SELECT id, url, created_at, file_name, file_size, storage_type,
               is_chunked, chunk_count
        FROM files
        WHERE chat_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(chatId).all();
      await answerPromise;
      const recentFiles = await recentFilesPromise;
      if (!recentFiles.results || recentFiles.results.length === 0) {
        await sendMessage(chatId, "⚠️ 您还没有上传过文件", config.tgBotToken);
        return;
      }
      const filesList = recentFiles.results.map((file, i) => {
        const fileName = getStoredDisplayName(file);
        const date = formatDate(file.created_at);
        const storageEmoji = file.storage_type === 'r2' ? '☁️' : '✈️';
        const chunkText = Number(file.is_chunked || 0) === 1
          ? ` · 🧩 ${Number(file.chunk_count || 0)}片`
          : '';
        return `${i + 1}. ${fileName}\n   📦 ${formatSize(file.file_size || 0)}${chunkText}\n   📅 ${date} ${storageEmoji}\n   🔗 ${file.url}`;
      }).join('\n\n');
      const actionRows = recentFiles.results.map((file, index) => ([
        { text: `🔗 ${index + 1}`, url: file.url },
        { text: `✏️ ${index + 1}`, callback_data: `edit_suffix_file_${file.id}` },
        { text: `🗑️ ${index + 1}`, callback_data: `delete_file_confirm_${file.id}` }
      ]));
      const keyboard = {
        inline_keyboard: actionRows.concat([
          [{ text: "« 返回", callback_data: "back_to_panel" }]
        ])
      };
      await deleteCallbackSourceMessage(
        update,
        config
      );
      if (config.buttonCache) {
         config.buttonCache.set(cacheKey, {
           timestamp: Date.now(),
           replyText: "📋 您最近上传的文件：\n\n" + filesList,
           replyMarkup: keyboard,
           disablePreview: true
         });
      }
      await fetch(telegramMethodUrl(config.tgBotToken, 'sendMessage', config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: "📋 您最近上传的文件：\n\n" + filesList,
          reply_markup: keyboard,
          disable_web_page_preview: true
        })
      });
    }
    else if (cbData === 'edit_suffix_input') {
      await answerPromise;
    
      await config.database.prepare(`
        UPDATE user_settings
        SET waiting_for = ?,
            editing_file_id = NULL
        WHERE chat_id = ?
      `).bind(
        'edit_suffix_input_file',
        chatId
      ).run();
    
      userSetting.waiting_for =
        'edit_suffix_input_file';
    
      userSetting.editing_file_id = null;
    
      await sendInputPrompt(
        chatId,
        "✏️ 请输入要修改后缀的文件完整名称，" +
        "必须包含扩展名；也可以输入完整 URL",
        config
      );
    
      return;
    }
    else if (cbData === 'delete_file_input') {
      await answerPromise;
    
      await config.database.prepare(`
        UPDATE user_settings
        SET waiting_for = ?,
            editing_file_id = NULL
        WHERE chat_id = ?
      `).bind(
        'delete_file_input',
        chatId
      ).run();
    
      userSetting.waiting_for =
        'delete_file_input';
    
      userSetting.editing_file_id = null;
    
      await sendInputPrompt(
        chatId,
        "🗑️ 请输入要删除的文件完整名称，" +
        "必须包含扩展名；也可以输入完整 URL",
        config
      );
    
      return;
    }
    else if (userSetting.waiting_for === 'edit_suffix_input_file' && update.message.text) {
      console.error('错误: 不应该执行到这里，修改后缀的逻辑已移至handleTelegramWebhook函数');
      try { await answerPromise; } catch {}
      return;
    }
    else if (userSetting.waiting_for === 'edit_suffix_input_new' && update.message.text && userSetting.editing_file_id) {
      console.error('错误: 不应该执行到这里，修改后缀的逻辑已移至handleTelegramWebhook函数');
      try { await answerPromise; } catch {}
      return;
    }
  } catch (error) {
    console.error('处理回调查询时出错:', error);
    try { await answerPromise; } catch {}
    await sendMessage(chatId, `❌ 处理请求时出错: ${error.message}`, config.tgBotToken);
  }
}

export function buildBotUploadId(chatId, sourceMessageId, file) {
  const uniquePart = String(
    (file && (file.file_unique_id || file.file_id)) || crypto.randomUUID()
  ).replace(/[^a-zA-Z0-9_-]/g, '_');
  const raw = `bot_${chatId}_${sourceMessageId || Date.now()}_${uniquePart}`;
  return raw.slice(0, 80).padEnd(16, '_');
}

export function buildProgressBar(percent, width = 12) {
  const normalized = Math.max(0, Math.min(100, Number(percent || 0)));
  const filled = Math.round((normalized / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

export function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  if (value < 60) return `${value} 秒`;
  const minutes = Math.floor(value / 60);
  const remain = value % 60;
  return remain ? `${minutes} 分 ${remain} 秒` : `${minutes} 分钟`;
}

export function createUploadProgressUpdater(chatId, messageId, fileName, totalBytes, config) {
  const startedAt = Date.now();
  let lastEditAt = 0;
  let lastText = '';

  return async function updateProgress({
    phase = '准备中',
    processedBytes = 0,
    completedChunks = 0,
    totalChunks = 0,
    force = false,
    finalUrl = '',
    error = ''
  } = {}) {
    const now = Date.now();
    const total = Math.max(0, Number(totalBytes || 0));
    const processed = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, Number(processedBytes || 0)));
    const percent = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
    const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1000);
    const speed = processed / elapsedSeconds;
    const remainingSeconds = speed > 0 && total > processed
      ? (total - processed) / speed
      : 0;

    let text;
    if (error) {
      text = `❌ <b>上传失败</b>\n\n` +
        `📄 ${escapeHtml(fileName)}\n` +
        `⚠️ ${escapeHtml(error)}`;
    } else if (finalUrl) {
      text = `✅ <b>上传完成</b>\n\n` +
        `📄 ${escapeHtml(fileName)}\n` +
        `📦 ${formatSize(total)}\n` +
        (totalChunks > 1 ? `🧩 ${totalChunks} 个分片\n` : '') +
        `🔗 ${escapeHtml(finalUrl)}`;
    } else {
      text = `⏳ <b>${escapeHtml(phase)}</b>\n\n` +
        `📄 ${escapeHtml(fileName)}\n` +
        `${buildProgressBar(percent)} ${percent.toFixed(1)}%\n` +
        `📦 ${formatSize(processed)} / ${formatSize(total)}\n` +
        (totalChunks > 0 ? `🧩 ${completedChunks}/${totalChunks} 分片\n` : '') +
        `🚀 ${formatSize(speed)}/s` +
        (remainingSeconds > 0 ? `\n⏱ 预计剩余 ${formatDuration(remainingSeconds)}` : '');
    }

    if (!force && now - lastEditAt < 1200) return false;
    if (!force && text === lastText) return false;
    lastEditAt = now;
    lastText = text;
    return editTelegramTextMessage(chatId, messageId, text, config);
  };
}

// 处理机器人文件上传
export async function handleMediaUpload(
  chatId,
  file,
  isDocument,
  config,
  userSetting,
  sourceMessageId = null
) {
  const declaredSize = Number(file && file.file_size || 0);
  
  
  let fileName = sanitizeTelegramFileName(
    file && file.file_name,
    `telegram_${sourceMessageId || Date.now()}.bin`
  );
  
  const processingMessage = await sendMessage(
    chatId,
    `⏳ <b>准备上传</b>\n\n📄 ${escapeHtml(fileName)}\n${buildProgressBar(0)} 0.0%`,
    config.tgBotToken
  );
  const processingMessageId = processingMessage && processingMessage.result
    ? processingMessage.result.message_id
    : null;

  const uploadId = buildBotUploadId(chatId, sourceMessageId, file);
  let progress = createUploadProgressUpdater(
    chatId,
    processingMessageId,
    fileName,
    declaredSize,
    config
  );

  try {
    if (!file || !file.file_id) throw new Error('消息中没有有效的 Telegram file_id');
    if (declaredSize > Number(config.maxSizeMB) * 1024 * 1024) {
      throw new Error(`文件超过 ${config.maxSizeMB}MB 业务限制`);
    }

    const cloudDownloadLimit = 20 * 1024 * 1024;
    if (!config.allowLargeBotDownloads && declaredSize > cloudDownloadLimit) {
      throw new Error(`文件超出官方限制`);
    }

    
    const existingFile = await config.database.prepare(`
      SELECT * FROM files WHERE upload_id = ? AND chat_id = ? LIMIT 1
    `).bind(uploadId, chatId).first();
    if (existingFile) {
      const existingSize = Number(existingFile.file_size || declaredSize);
      const existingChunks = Number(existingFile.chunk_count || 0);
      await progress({
        phase: '正在生成二维码',
        processedBytes: existingSize,
        completedChunks: existingChunks || 1,
        totalChunks: Math.max(1, existingChunks),
        force: true
      });
      try {
        await sendUploadCompletedWithQr({
          chatId,
          fileName: existingFile.file_name || fileName,
          fileSize: existingSize,
          url: existingFile.url,
          chunkCount: existingChunks
        }, config);
        await deleteTelegramMessage(chatId, processingMessageId, config);
      } catch (notifyError) {
        console.warn('发送合并上传完成消息失败:', notifyError.message);
        await progress({
          processedBytes: existingSize,
          completedChunks: existingChunks || 1,
          totalChunks: Math.max(1, existingChunks),
          finalUrl: existingFile.url,
          force: true
        });
      }
      return;
    }

    
    await progress({ phase: '正在获取 Telegram 文件信息', force: true });
    const fileInfoResponse = await fetch(
      `${telegramMethodUrl(config.tgBotToken, 'getFile', config)}?file_id=${encodeURIComponent(file.file_id)}`
    );
    const data = await fileInfoResponse.json().catch(() => null);
    if (!fileInfoResponse.ok || !data || !data.ok || !data.result || !data.result.file_path) {
      throw new Error(`获取文件路径失败: ${(data && data.description) || fileInfoResponse.status}`);
    }

    const actualSize = Number(data.result.file_size || declaredSize || 0);
    if (!actualSize) throw new Error('Telegram 未返回有效文件大小');
    if (!config.allowLargeBotDownloads && actualSize > cloudDownloadLimit) {
      throw new Error(`文件为 ${formatSize(actualSize)}，超过官方限制；`);
    }
    if (actualSize > Number(config.maxSizeMB) * 1024 * 1024) {
      throw new Error(`文件超过 ${config.maxSizeMB}MB 业务限制`);
    }

    
    const filePath = data.result.file_path;
    const filePathExt = (String(filePath).split('.').pop() || '').toLowerCase();

    let mimeType = file.mime_type || 'application/octet-stream';
    if (filePathExt) {
      const guessedMime = getContentType(filePathExt);
      if (guessedMime !== 'application/octet-stream') {
        mimeType = guessedMime;
      }
    }
    let ext = filePathExt;
    if (!ext) ext = getExtensionFromMime(mimeType);
    if (!ext) ext = 'bin';

    
    if (!file.file_name) {
      if (file.video_note) {
        fileName = `video_note_${Date.now()}.${ext}`;
      } else if (file.voice) {
        fileName = `voice_message_${Date.now()}.${ext}`;
      } else if (file.audio) {
        fileName = (file.audio.title || `audio_${Date.now()}`) + `.${ext}`;
      } else if (file.video) {
        fileName = `video_${Date.now()}.${ext}`;
      } else if (file.photo) {
        fileName = `photo_${Date.now()}.${ext}`;
      } else {
        fileName = `file_${Date.now()}.${ext}`;
      }
    } else {
      
      if (!file.file_name.includes('.')) {
        fileName = `${file.file_name}.${ext}`;
      } else {
        fileName = file.file_name;
      }
    }

    
    progress = createUploadProgressUpdater(
      chatId,
      processingMessageId,
      fileName,
      actualSize,
      config
    );
    await progress({ phase: '正在下载并准备分片', force: true });

    
    const fileResponse = await fetchTelegramBinaryFile(
      file.file_id,
      filePath,
      config
    );
    if (!fileResponse.ok) {
      throw new Error(`获取文件内容失败: HTTP ${fileResponse.status}`);
    }

    const storageType = userSetting && userSetting.storage_type
      ? userSetting.storage_type
      : 'telegram';
    const categoryId = await (async () => {
      if (userSetting && userSetting.current_category_id) {
        return userSetting.current_category_id;
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
      return defaultCategory && defaultCategory.id;
    })();

    const key = generateSafeKey(fileName);
    let saved;
    if (storageType === 'r2' && config.bucket) {
      await progress({
        phase: '正在读取文件并写入 R2',
        processedBytes: Math.min(actualSize, Math.floor(actualSize * 0.25)),
        totalChunks: 1,
        completedChunks: 0,
        force: true
      });
      const r2Buffer = await fileResponse.arrayBuffer();
      await progress({
        phase: '正在写入 R2 存储',
        processedBytes: actualSize,
        totalChunks: 1,
        completedChunks: 0,
        force: true
      });
      await config.bucket.put(key, r2Buffer, {
        httpMetadata: { contentType: mimeType }
      });
      const identity = await createPublicFileIdentity(config);
      await insertFileRecord({
        publicId: identity.publicId,
        fileId: key,
        messageId: -1,
        fileName,
        fileSize: actualSize,
        mimeType,
        storageType: 'r2',
        categoryId,
        chatId,
        isChunked: false,
        chunkCount: 0,
        uploadId
      }, config);
      saved = { url: identity.url, isChunked: false, chunkCount: 0 };
    } else {
      saved = await saveTelegramFileFromResponse({
        response: fileResponse,
        uploadId,
        fileName,
        fileSize: actualSize,
        mimeType,
        categoryId,
        chatId,
        key,
        progress
      }, config);
    }

    await progress({
      phase: '正在生成二维码',
      processedBytes: actualSize,
      completedChunks: saved.chunkCount || 1,
      totalChunks: saved.chunkCount || 1,
      force: true
    });

    try {
      await sendUploadCompletedWithQr({
        chatId,
        fileName,
        fileSize: actualSize,
        url: saved.url,
        chunkCount: saved.chunkCount || 0
      }, config);
      await deleteTelegramMessage(chatId, processingMessageId, config);
    } catch (notifyError) {
      console.warn('发送合并上传完成消息失败:', notifyError.message);
      const edited = await progress({
        processedBytes: actualSize,
        completedChunks: saved.chunkCount || 1,
        totalChunks: saved.chunkCount || 1,
        finalUrl: saved.url,
        force: true
      });
      if (!edited) {
        await sendMessage(
          chatId,
          buildUploadCompletedCaption({
            fileName,
            fileSize: actualSize,
            url: saved.url,
            chunkCount: saved.chunkCount || 0,
            includeQrHint: false
          }),
          config.tgBotToken
        );
      }
    }

  } catch (error) {
    console.error('Error handling media upload:', error);
    const edited = await progress({ error: error.message, force: true });
    if (!edited) {
      await sendMessage(chatId, `❌ 上传失败: ${escapeHtml(error.message)}`, config.tgBotToken);
    }
  }
}

export function isPauseCommand(text) {
  const normalized = String(text || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();

  return [
    '/start',
    '/cancel',
    '取消',
    '暂停',
    '返回'
  ].includes(normalized);
}

export function getWaitingPromptText(waitingFor) {
  const promptMap = {
    add_user_id:
      "请输入纯数字 Telegram 用户 ID，例如：123456789",

    new_category:
      "请输入新的分类名称",

    edit_suffix_input_file:
      "请输入完整文件名称（包含扩展名）或完整 URL",

    edit_suffix_input_new:
      "请输入新的文件后缀，不要包含扩展名",

    delete_file_input:
      "请输入要删除的完整文件名称或完整 URL",

    new_suffix:
      "请输入新的文件后缀"
  };

  return (
    promptMap[waitingFor] ||
    "请继续输入当前操作需要的文字内容"
  );
}

export async function resetWaitingState(
  chatId,
  userSetting,
  config
) {
  await config.database.prepare(`
    UPDATE user_settings
    SET waiting_for = NULL,
        editing_file_id = NULL
    WHERE chat_id = ?
  `).bind(chatId).run();

  if (userSetting) {
    userSetting.waiting_for = null;
    userSetting.editing_file_id = null;
  }
}

export async function fetchNotification() {
  try {
    const response = await fetch('https://raw.githubusercontent.com/iawooo/cftc/refs/heads/main/cftc/panel.md');
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (error) {
    return null;
  }
}
