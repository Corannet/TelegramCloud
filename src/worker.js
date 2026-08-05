// 工作线程入口

import {
  handleDeleteMultipleRequest,
  handleUserManagementRequest,
  handleListAllowedUsersRequest,
  handleAddAllowedUserRequest,
  handleDeleteAllowedUserRequest,
  handleAdminRequest,
  handleSearchRequest,
  handleDeleteRequest,
  handleBingImagesRequest,
  handleUpdateSuffixRequest
} from './admin.js'

import {
  normalizeIdList,
  authenticate,
  handleLoginRequest
} from './auth.js'

import {
  handleTelegramWebhook
} from './bot.js'

import {
  LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES
} from './constants.js'

import {
  initDatabase
} from './database.js'

import {
  createLargeUploadMaintenanceConfig,
  cleanupStaleLargeUploadSessions,
  handleLargeUploadPageRequest,
  handleLargeUploadStatusRequest,
  handleLargeUploadChunkRequest,
  handleLargeUploadCompleteRequest
} from './large-upload.js'

import {
  handleFileRequest
} from './storage.js'

import {
  normalizeTelegramApiRoot,
  setWebhook
} from './telegram.js'

import {
  handleUploadPageManagementRequest,
  handleListUploadPagesRequest,
  handleCreateUploadPageRequest,
  handleDeleteUploadPageRequest,
  handlePublicUploadPageRequest,
  handlePublicUploadApiRequest,
  cleanupStaleUploadPageSessions
} from './upload-pages.js'

import {
  handleCreateCategoryRequest,
  handleDeleteCategoryRequest,
  handleUploadRequest,
  handleUploadChunkRequest,
  handleUploadCompleteRequest,
  handleUploadAbortRequest
} from './web-upload.js'

// 配置运行环境并分发请求
export default {
  async fetch(request, env, executionCtx) {
    if (!env.DATABASE) {
      console.error("缺少DATABASE配置");
      return new Response('缺少必要配置: DATABASE 环境变量未设置', { status: 500 });
    }
    const tgApiBaseUrl = normalizeTelegramApiRoot(
      env.TG_BOT_API_BASE_URL || 'https://api.telegram.org'
    );
    const tgFileBaseUrl = normalizeTelegramApiRoot(
      env.TG_BOT_FILE_BASE_URL || tgApiBaseUrl
    );
    const useLocalBotApi =
      String(env.TG_LOCAL_BOT_API || '').toLowerCase() === 'true' ||
      tgApiBaseUrl !== 'https://api.telegram.org';
    const tgFileProxyUrl = String(env.TG_FILE_PROXY_URL || '').trim();
    const allowLargeBotDownloads =
      useLocalBotApi &&
      (
        Boolean(tgFileProxyUrl) ||
        String(env.TG_LOCAL_FILE_ENDPOINT || '').toLowerCase() === 'true'
      );

    const updateTimeMinutes = Math.max(
      1,
      Math.floor(Number(env.UPDATE_TIME) || 20)
    );

    const config = {
      domain: env.DOMAIN || request.headers.get("host") || '',
      database: env.DATABASE,
      username: env.USERNAME || '',
      password: env.PASSWORD || '',
      enableAuth: env.ENABLE_AUTH === 'true' || false,
      tgBotToken: env.TG_BOT_TOKEN || '',
      tgApiBaseUrl,
      tgFileBaseUrl,
      tgFileProxyUrl,
      tgFileProxySecret: String(env.TG_FILE_PROXY_SECRET || ''),
      useLocalBotApi,
      allowLargeBotDownloads,
      tgAdminId: normalizeIdList(env.TG_ADMIN_ID),
      tgStorageChatId: String(env.TG_STORAGE_CHAT_ID || '').trim(),
      cookie: Number(env.COOKIE) || 7,
      
      maxSizeMB: Number(env.MAX_SIZE_MB) || 1024,
      telegramPhotoLimitMB: 10,
      telegramFileLimitMB: Number(env.TG_FILE_LIMIT_MB) || (useLocalBotApi ? 2000 : 50),
      telegramDownloadLimitMB: allowLargeBotDownloads
        ? Number(env.TG_LOCAL_DOWNLOAD_LIMIT_MB) || 2000
        : 20,
      
      telegramChunkSizeMB: Math.min(19, Math.max(1, Number(env.TG_CHUNK_SIZE_MB) || 19)),
      
      updateTimeMinutes,
      bucket: env.BUCKET,
      fileCache: new Map(),
      fileCacheTTL: 3600000,
      buttonCache: new Map(),
      buttonCacheTTL: 600000,
      menuCache: new Map(),
      
      menuCacheTTL: Math.min(300000, updateTimeMinutes * 30 * 1000),
      notificationCache: '',
      notificationCacheTTL: 3600000,
      lastNotificationFetch: 0
    };

    
    globalThis.__TG_BOT_API_BASE_URL = config.tgApiBaseUrl;
    globalThis.__TG_BOT_FILE_BASE_URL = config.tgFileBaseUrl;
    if (config.enableAuth && (!config.username || !config.password)) {
        console.error("启用了认证但未配置用户名或密码");
        return new Response('认证配置错误: 缺少USERNAME或PASSWORD环境变量', { status: 500 });
    }
    const url = new URL(request.url);
    const { pathname } = url;
    console.log(`[Auth] Request Path: ${pathname}, Method: ${request.method}`);
    if (pathname === '/favicon.ico') {
      console.log('[Auth] Handling favicon.ico request.');
      return new Response(null, { status: 204 });
    }
    const isAuthEnabled = config.enableAuth;
    const isAuthenticated = authenticate(request, config);
    const isLoginPage = pathname === '/login';
    const isPublicApi = pathname === '/webhook' || pathname === '/config' || pathname === '/bing';
    console.log(`[Auth] isAuthEnabled: ${isAuthEnabled}, isAuthenticated: ${isAuthenticated}, isLoginPage: ${isLoginPage}, isPublicApi: ${isPublicApi}`);
    const protectedPaths = [
      '/',
      '/upload',
      '/upload-chunk',
      '/upload-complete',
      '/upload-abort',
      '/admin',
    
      
      '/users',
      '/api/users',
      '/api/users/add',
      '/api/users/delete',
      '/upload-pages',
      '/api/upload-pages',
      '/api/upload-pages/create',
      '/api/upload-pages/delete',
    
      '/create-category',
      '/delete-category',
      '/update-suffix',
      '/delete',
      '/delete-multiple',
      '/search'
    ];
    const requiresAuth = isAuthEnabled && protectedPaths.includes(pathname);
    console.log(`[Auth] Path requires authentication: ${requiresAuth}`);
    if (requiresAuth && !isAuthenticated && !isLoginPage) {
        console.log(`[Auth] FAILED: Accessing protected path ${pathname} without authentication. Redirecting to login.`);
        if (request.method === 'POST' || request.headers.get('Accept')?.includes('application/json')) {
            return new Response(JSON.stringify({ status: 0, error: "未授权访问", redirect: `${url.origin}/login` }), {
                status: 401,
                headers: { 
                    'Content-Type': 'application/json;charset=UTF-8',
                    'Cache-Control': 'no-store'
                 }
            });
        }
        const redirectUrl = `${url.origin}/login?redirect=${encodeURIComponent(pathname + url.search)}`;
        return Response.redirect(redirectUrl, 302);
    }
    if (isAuthEnabled && isAuthenticated && isLoginPage) {
        const redirectTarget = url.searchParams.get('redirect') || '/upload';
        console.log(`[Auth] SUCCESS: Authenticated user accessing login page. Redirecting to ${redirectTarget}.`);
        return Response.redirect(`${url.origin}${redirectTarget}`, 302);
    }
    console.log(`[Auth] Check PASSED for path: ${pathname}`);
    try {
      const shouldInitDatabase =
        !isLoginPage &&
        (
          pathname === '/webhook' ||
          !isPublicApi
        );
    
      if (shouldInitDatabase) {
        await initDatabase(config);
        console.log('[DB] Database initialized successfully.');
      } else {
        console.log(
          '[DB] Skipping database initialization for public API or login page.'
        );
      }
    } catch (error) {
      console.error(`[DB] Database initialization FAILED: ${error.message}`);
      return new Response(`数据库初始化失败: ${error.message}`, { 
        status: 500,
        headers: { 
            'Content-Type': 'text/plain;charset=UTF-8',
            'Cache-Control': 'no-store'
        }
      });
    }
    if (config.tgBotToken) {
      try {
        const webhookUrl = `https://${config.domain}/webhook`;
        console.log(`[Webhook] Attempting to set webhook to: ${webhookUrl}`);
        const webhookSet = await setWebhook(webhookUrl, config.tgBotToken);
        if (!webhookSet) { 
            console.error('[Webhook] FAILED to set webhook after retries.'); 
        } else {
            console.log('[Webhook] Webhook set successfully (or already set).');
        }
      } catch (error) {
        console.error(`[Webhook] FAILED to set webhook due to error: ${error.message}`);
      }
    }
    const routes = {
      '/': async () => {
          console.log('[Route] Handling / request.');
          return handleUploadRequest(request, config);
      },
      '/login': async () => {
          console.log('[Route] Handling /login request.');
          return handleLoginRequest(request, config);
      },
      '/upload': async () => {
          console.log('[Route] Handling /upload request.');
          return handleUploadRequest(request, config);
      },
      '/upload-chunk': async () => {
          console.log('[Route] Handling /upload-chunk request.');
          return handleUploadChunkRequest(request, config);
      },
      '/upload-complete': async () => {
          console.log('[Route] Handling /upload-complete request.');
          return handleUploadCompleteRequest(request, config);
      },
      '/upload-abort': async () => {
          console.log('[Route] Handling /upload-abort request.');
          return handleUploadAbortRequest(request, config);
      },
      '/large-upload': async () => {
          console.log('[Route] Handling /large-upload request.');
          return handleLargeUploadPageRequest(request, config);
      },
      '/large-upload/status': async () => {
          console.log('[Route] Handling /large-upload/status request.');
          return handleLargeUploadStatusRequest(request, config);
      },
      '/large-upload/chunk': async () => {
          console.log('[Route] Handling /large-upload/chunk request.');
          return handleLargeUploadChunkRequest(request, config);
      },
      '/large-upload/complete': async () => {
          console.log('[Route] Handling /large-upload/complete request.');
          return handleLargeUploadCompleteRequest(request, config);
      },
      '/admin': async () => {
          console.log('[Route] Handling /admin request.');
          return handleAdminRequest(request, config);
      },
      '/users': async () => {
        console.log('[Route] Handling /users request.');
        return handleUserManagementRequest(request, config);
      },
      
      '/api/users': async () => {
        console.log('[Route] Handling /api/users request.');
        return handleListAllowedUsersRequest(request, config);
      },
      
      '/api/users/add': async () => {
        console.log('[Route] Handling /api/users/add request.');
        return handleAddAllowedUserRequest(request, config);
      },
      
      '/api/users/delete': async () => {
        console.log('[Route] Handling /api/users/delete request.');
        return handleDeleteAllowedUserRequest(request, config);
      },
      '/upload-pages': () => handleUploadPageManagementRequest(request, config),
      '/api/upload-pages': () => handleListUploadPagesRequest(request, config),
      '/api/upload-pages/create': () => handleCreateUploadPageRequest(request, config),
      '/api/upload-pages/delete': () => handleDeleteUploadPageRequest(request, config),
      '/delete': () => handleDeleteRequest(request, config),
      '/delete-multiple': () => handleDeleteMultipleRequest(request, config),
      '/search': () => handleSearchRequest(request, config),
      '/create-category': () => handleCreateCategoryRequest(request, config),
      '/delete-category': () => handleDeleteCategoryRequest(request, config),
      '/update-suffix': () => handleUpdateSuffixRequest(request, config),
      '/config': () => {
          console.log('[Route] Handling /config request.');
          const safeConfig = {
            maxSizeMB: config.maxSizeMB,
            telegramPhotoLimitMB: config.telegramPhotoLimitMB,
            telegramFileLimitMB: config.telegramFileLimitMB,
            telegramDownloadLimitMB: config.telegramDownloadLimitMB,
            telegramChunkSizeMB: config.telegramChunkSizeMB,
            updateTimeMinutes: config.updateTimeMinutes,
            largeUploadChunkTimeoutMinutes: LARGE_UPLOAD_CHUNK_TIMEOUT_MINUTES,
            useLocalBotApi: config.useLocalBotApi,
            allowLargeBotDownloads: config.allowLargeBotDownloads
          };
          return new Response(JSON.stringify(safeConfig), {
              headers: { 
                  'Content-Type': 'application/json',
                  'Cache-Control': 'public, max-age=3600'
               }
          });
      },
      '/webhook': () => { 
          console.log('[Route] Handling /webhook request.');
          return handleTelegramWebhook(request, config, executionCtx); 
      },
      '/bing': () => { 
          console.log('[Route] Handling /bing request.');
          return handleBingImagesRequest(request, config);
      }
    };
    const publicPageMatch = pathname.match(/^\/updata\/([A-Za-z0-9_-]{3,50})\/?$/);
    if (publicPageMatch) {
      return handlePublicUploadPageRequest(request, config, publicPageMatch[1]);
    }
    const publicApiMatch = pathname.match(/^\/api\/updata\/([A-Za-z0-9_-]{3,50})\/(files|upload|chunk|complete|abort|delete)$/);
    if (publicApiMatch) {
      return handlePublicUploadApiRequest(request, config, publicApiMatch[1], publicApiMatch[2]);
    }

    const handler = routes[pathname];
    if (handler) {
      try {
          console.log(`[Route] Executing handler for ${pathname}`);
          const response = await handler();
          if (isAuthEnabled && requiresAuth && response.headers.get('Content-Type')?.includes('text/html')) {
              response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
              response.headers.set('Pragma', 'no-cache');
              response.headers.set('Expires', '0');
          }
          return response;
      } catch (error) {
          console.error(`[Route] Error handling route ${pathname}:`, error);
          return new Response("服务器内部错误", { status: 500, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    console.log(`[File] Handling file request for ${pathname}`);
    return await handleFileRequest(request, config);
  },

  
  
  async scheduled(_controller, env, executionCtx) {
    if (!env.DATABASE) {
      console.error('[Large Upload Cleanup] 缺少 DATABASE，跳过定时清理');
      return;
    }
    const config = createLargeUploadMaintenanceConfig(env);
    globalThis.__TG_BOT_API_BASE_URL = config.tgApiBaseUrl;
    globalThis.__TG_BOT_FILE_BASE_URL = config.tgFileBaseUrl;

    const task = (async () => {
      await initDatabase(config);
      const result = await cleanupStaleLargeUploadSessions(config);
      await cleanupStaleUploadPageSessions(config);
      if (result.cancelled > 0) {
        console.log(
          `[Large Upload Cleanup] 已取消 ${result.cancelled} 个超时任务，` +
          `删除 ${result.deletedChunks} 个分片`
        );
      }
    })().catch(error => {
      console.error('[Large Upload Cleanup] 定时清理失败:', error);
    });

    if (executionCtx && typeof executionCtx.waitUntil === 'function') {
      executionCtx.waitUntil(task);
      return;
    }
    await task;
  }
};
