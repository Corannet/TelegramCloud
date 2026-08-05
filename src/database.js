// 数据库与数据结构

// 初始化数据库
export async function initDatabase(config) {
  console.log("开始数据库初始化...");
  if (!config || !config.database) {
    console.error("数据库配置缺失");
    throw new Error("数据库配置无效，请检查D1数据库是否正确绑定");
  }
  if (!config.fileCache) {
    config.fileCache = new Map();
    config.fileCacheTTL = 3600000;
  }
  const maxRetries = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`正在测试数据库连接... (尝试 ${attempt}/${maxRetries})`);
      await config.database.prepare("SELECT 1").run();
      console.log("数据库连接成功");
      console.log("正在验证数据库结构...");
      const structureValid = await validateDatabaseStructure(config);
      if (!structureValid) {
        throw new Error("数据库结构验证失败");
      }
      console.log("数据库初始化成功");
      return true;
    } catch (error) {
      lastError = error;
      console.error(`数据库初始化尝试 ${attempt} 失败:`, error);
      if (error.message.includes('no such table')) {
        console.log("检测到数据表不存在，尝试创建...");
        try {
          await recreateAllTables(config);
          console.log("数据表创建成功");
          return true;
        } catch (tableError) {
          console.error("创建数据表失败:", tableError);
        }
      }
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`等待 ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error(`数据库初始化失败 (${maxRetries} 次尝试): ${lastError?.message || '未知错误'}`);
}

// 创建完整数据表
export async function recreateAllTables(config) {
  try {
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL UNIQUE,
        storage_type TEXT DEFAULT 'telegram',
        current_category_id INTEGER,
        waiting_for TEXT,
        editing_file_id TEXT,
        is_processing INTEGER DEFAULT 0,
        lock_time INTEGER,
        upload_seq INTEGER DEFAULT 0,
        FOREIGN KEY (current_category_id) REFERENCES categories(id)
      )
    `).run();

    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS allowed_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL UNIQUE,
        added_by TEXT,
        created_at INTEGER NOT NULL
      )
    `).run();

    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        fileId TEXT,
        message_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,
        storage_type TEXT DEFAULT 'telegram',
        category_id INTEGER,
        chat_id TEXT,
        custom_suffix TEXT,
        is_chunked INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        upload_id TEXT,
        public_id TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `).run();

    
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS file_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        upload_id TEXT NOT NULL,
        file_id INTEGER,
        chat_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        telegram_file_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(upload_id, chunk_index),
        FOREIGN KEY (file_id) REFERENCES files(id)
      )
    `).run();

    
    
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS bot_upload_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        chat_id TEXT NOT NULL,
        upload_id TEXT NOT NULL UNIQUE,
        category_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,
        total_chunks INTEGER NOT NULL DEFAULT 0,
        uploaded_chunks INTEGER NOT NULL DEFAULT 0,
        uploaded_bytes INTEGER NOT NULL DEFAULT 0,
        result_file_id INTEGER,
        result_url TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (result_file_id) REFERENCES files(id)
      )
    `).run();

    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS upload_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        max_size_mb INTEGER NOT NULL,
        allowed_types TEXT NOT NULL,
        storage_type TEXT NOT NULL DEFAULT 'telegram',
        created_by TEXT,
        created_at INTEGER NOT NULL
      )
    `).run();

    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS upload_page_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id INTEGER NOT NULL,
        file_id INTEGER NOT NULL,
        client_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(page_id, file_id),
        FOREIGN KEY (page_id) REFERENCES upload_pages(id),
        FOREIGN KEY (file_id) REFERENCES files(id)
      )
    `).run();

    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS upload_page_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        upload_id TEXT NOT NULL UNIQUE,
        page_id INTEGER NOT NULL,
        client_hash TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        category_id INTEGER,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        total_chunks INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'uploading',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (page_id) REFERENCES upload_pages(id),
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `).run();

    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id
      ON file_chunks(file_id, chunk_index)
    `).run();

    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_upload_id
      ON file_chunks(upload_id, chunk_index)
    `).run();

    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bot_upload_sessions_chat_status
      ON bot_upload_sessions(chat_id, status, created_at)
    `).run();

    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bot_upload_sessions_expires
      ON bot_upload_sessions(expires_at, status)
    `).run();

    await config.database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_files_public_id
      ON files(public_id)
      WHERE public_id IS NOT NULL
    `).run();

    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_upload_page_files_owner
      ON upload_page_files(page_id, client_hash, created_at)
    `).run();

    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_upload_page_sessions_page
      ON upload_page_sessions(page_id, client_hash, created_at)
    `).run();

    await config.database.prepare(`
      INSERT OR IGNORE INTO categories (name) VALUES ('默认分类')
    `).run();

    return true;
  } catch (error) {
    console.error("重新创建表失败:", error);
    throw error;
  }
}

// 校验并迁移数据结构
export async function validateDatabaseStructure(config) {
  try {
    const tables = [
      'categories',
      'user_settings',
      'allowed_users',
      'files',
      'file_chunks',
      'bot_upload_sessions',
      'upload_pages',
      'upload_page_files',
      'upload_page_sessions'
    ];
    for (const table of tables) {
      try {
        await config.database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).run();
      } catch (error) {
        if (error.message.includes('no such table')) {
          console.log(`表 ${table} 不存在，尝试重新创建所有表...`);
          await recreateAllTables(config);
          continue;
        }
        throw error;
      }
    }
    const tableStructures = {
      categories: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'created_at', type: 'DATETIME' }
      ],
      user_settings: [
        { name: 'id', type: 'INTEGER' },
        { name: 'chat_id', type: 'TEXT' },
        { name: 'storage_type', type: 'TEXT' },
        { name: 'current_category_id', type: 'INTEGER' },
        { name: 'waiting_for', type: 'TEXT' },
        { name: 'editing_file_id', type: 'TEXT' },
        { name: 'is_processing', type: 'INTEGER' },
        { name: 'lock_time', type: 'INTEGER' },
        { name: 'upload_seq', type: 'INTEGER' }
      ],
      allowed_users: [
        { name: 'id', type: 'INTEGER' },
        { name: 'chat_id', type: 'TEXT' },
        { name: 'added_by', type: 'TEXT' },
        { name: 'created_at', type: 'INTEGER' }
      ],
      files: [
        { name: 'id', type: 'INTEGER' },
        { name: 'url', type: 'TEXT' },
        { name: 'fileId', type: 'TEXT' },
        { name: 'message_id', type: 'INTEGER' },
        { name: 'created_at', type: 'DATETIME' },
        { name: 'file_name', type: 'TEXT' },
        { name: 'file_size', type: 'INTEGER' },
        { name: 'mime_type', type: 'TEXT' },
        { name: 'storage_type', type: 'TEXT' },
        { name: 'category_id', type: 'INTEGER' },
        { name: 'chat_id', type: 'TEXT' },
        { name: 'custom_suffix', type: 'TEXT' },
        { name: 'is_chunked', type: 'INTEGER' },
        { name: 'chunk_count', type: 'INTEGER' },
        { name: 'upload_id', type: 'TEXT' },
        { name: 'public_id', type: 'TEXT' }
      ],
      file_chunks: [
        { name: 'id', type: 'INTEGER' },
        { name: 'upload_id', type: 'TEXT' },
        { name: 'file_id', type: 'INTEGER' },
        { name: 'chat_id', type: 'TEXT' },
        { name: 'chunk_index', type: 'INTEGER' },
        { name: 'total_chunks', type: 'INTEGER' },
        { name: 'telegram_file_id', type: 'TEXT' },
        { name: 'message_id', type: 'INTEGER' },
        { name: 'chunk_size', type: 'INTEGER' },
        { name: 'created_at', type: 'INTEGER' }
      ],
      bot_upload_sessions: [
        { name: 'id', type: 'INTEGER' },
        { name: 'token_hash', type: 'TEXT' },
        { name: 'chat_id', type: 'TEXT' },
        { name: 'upload_id', type: 'TEXT' },
        { name: 'category_id', type: 'INTEGER' },
        { name: 'status', type: 'TEXT' },
        { name: 'file_name', type: 'TEXT' },
        { name: 'file_size', type: 'INTEGER' },
        { name: 'mime_type', type: 'TEXT' },
        { name: 'total_chunks', type: 'INTEGER' },
        { name: 'uploaded_chunks', type: 'INTEGER' },
        { name: 'uploaded_bytes', type: 'INTEGER' },
        { name: 'result_file_id', type: 'INTEGER' },
        { name: 'result_url', type: 'TEXT' },
        { name: 'error_message', type: 'TEXT' },
        { name: 'created_at', type: 'INTEGER' },
        { name: 'expires_at', type: 'INTEGER' },
        { name: 'started_at', type: 'INTEGER' },
        { name: 'completed_at', type: 'INTEGER' }
      ],
      upload_pages: [
        { name: 'id', type: 'INTEGER' },
        { name: 'slug', type: 'TEXT' },
        { name: 'title', type: 'TEXT' },
        { name: 'max_size_mb', type: 'INTEGER' },
        { name: 'allowed_types', type: 'TEXT' },
        { name: 'storage_type', type: 'TEXT' },
        { name: 'created_by', type: 'TEXT' },
        { name: 'created_at', type: 'INTEGER' }
      ],
      upload_page_files: [
        { name: 'id', type: 'INTEGER' },
        { name: 'page_id', type: 'INTEGER' },
        { name: 'file_id', type: 'INTEGER' },
        { name: 'client_hash', type: 'TEXT' },
        { name: 'created_at', type: 'INTEGER' }
      ],
      upload_page_sessions: [
        { name: 'id', type: 'INTEGER' },
        { name: 'upload_id', type: 'TEXT' },
        { name: 'page_id', type: 'INTEGER' },
        { name: 'client_hash', type: 'TEXT' },
        { name: 'chat_id', type: 'TEXT' },
        { name: 'category_id', type: 'INTEGER' },
        { name: 'file_name', type: 'TEXT' },
        { name: 'file_size', type: 'INTEGER' },
        { name: 'mime_type', type: 'TEXT' },
        { name: 'total_chunks', type: 'INTEGER' },
        { name: 'status', type: 'TEXT' },
        { name: 'created_at', type: 'INTEGER' }
      ]
    };
    for (const [table, expectedColumns] of Object.entries(tableStructures)) {
      const tableInfo = await config.database.prepare(`PRAGMA table_info(${table})`).all();
      const actualColumns = tableInfo.results;
      for (const expectedColumn of expectedColumns) {
        const found = actualColumns.some(col => 
          col.name.toLowerCase() === expectedColumn.name.toLowerCase() &&
          col.type.toUpperCase().includes(expectedColumn.type)
        );
        if (!found) {
          console.log(`表 ${table} 缺少列 ${expectedColumn.name}，尝试添加...`);
          try {
            await config.database.prepare(`ALTER TABLE ${table} ADD COLUMN ${expectedColumn.name} ${expectedColumn.type}`).run();
  } catch (error) {
            if (!error.message.includes('duplicate column name')) {
              throw error;
            }
          }
        }
      }
    }
    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id
      ON file_chunks(file_id, chunk_index)
    `).run();
    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_upload_id
      ON file_chunks(upload_id, chunk_index)
    `).run();
    await config.database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_files_upload_id
      ON files(upload_id)
      WHERE upload_id IS NOT NULL
    `).run();
    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bot_upload_sessions_chat_status
      ON bot_upload_sessions(chat_id, status, created_at)
    `).run();
    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bot_upload_sessions_expires
      ON bot_upload_sessions(expires_at, status)
    `).run();
    await config.database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_files_public_id
      ON files(public_id)
      WHERE public_id IS NOT NULL
    `).run();
    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_upload_page_files_owner
      ON upload_page_files(page_id, client_hash, created_at)
    `).run();
    await config.database.prepare(`
      CREATE INDEX IF NOT EXISTS idx_upload_page_sessions_page
      ON upload_page_sessions(page_id, client_hash, created_at)
    `).run();

    console.log('检查默认分类...');
    const defaultCategory = await config.database.prepare('SELECT id FROM categories WHERE name = ?')
      .bind('默认分类').first();
    if (!defaultCategory) {
      console.log('默认分类不存在，正在创建...');
      try {
        const result = await config.database.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)')
          .bind('默认分类', Date.now()).run();
        const newDefaultId = result.meta && result.meta.last_row_id;
        console.log(`默认分类创建成功，ID: ${newDefaultId}`);
        if (newDefaultId) {
          const filesResult = await config.database.prepare('SELECT COUNT(*) as count FROM files WHERE category_id IS NULL').first();
          if (filesResult && filesResult.count > 0) {
            console.log(`发现 ${filesResult.count} 个无分类文件，将它们分配到默认分类...`);
            await config.database.prepare('UPDATE files SET category_id = ? WHERE category_id IS NULL')
              .bind(newDefaultId).run();
          }
          const settingsResult = await config.database.prepare('SELECT COUNT(*) as count FROM user_settings WHERE current_category_id IS NULL').first();
          if (settingsResult && settingsResult.count > 0) {
            console.log(`发现 ${settingsResult.count} 条用户设置没有当前分类，更新为默认分类...`);
            await config.database.prepare('UPDATE user_settings SET current_category_id = ? WHERE current_category_id IS NULL')
              .bind(newDefaultId).run();
          }
        }
      } catch (error) {
        console.error('创建默认分类失败:', error);
        throw new Error('无法创建默认分类: ' + error.message);
      }
    } else {
      console.log(`默认分类存在，ID: ${defaultCategory.id}`);
    }
    const checkAgain = await config.database.prepare('SELECT id FROM categories WHERE name = ?')
      .bind('默认分类').first();
    if (!checkAgain) {
      throw new Error('验证失败：即使尝试创建后，默认分类仍然不存在');
    }
    return true;
  } catch (error) {
    console.error('验证数据库结构时出错:', error);
    return false;
  }
}

export async function recreateCategoriesTable(config) {
  try {
    const existingData = await config.database.prepare('SELECT * FROM categories').all();
    await config.database.prepare('DROP TABLE IF EXISTS categories').run();
    await config.database.prepare(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      )
    `).run();
    if (existingData && existingData.results && existingData.results.length > 0) {
      for (const row of existingData.results) {
        await config.database.prepare('INSERT OR IGNORE INTO categories (id, name, created_at) VALUES (?, ?, ?)')
          .bind(row.id || null, row.name || '未命名分类', row.created_at || Date.now()).run();
      }
      console.log(`已恢复 ${existingData.results.length} 个分类数据`);
    }
    console.log("分类表重建完成");
  } catch (error) {
    console.error(`重建分类表失败: ${error.message}`);
  }
}

export async function recreateUserSettingsTable(config) {
  try {
    await config.database.prepare('DROP TABLE IF EXISTS user_settings').run();
    await config.database.prepare(`
      CREATE TABLE user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL UNIQUE,
        storage_type TEXT DEFAULT 'telegram',
        category_id INTEGER,
        custom_suffix TEXT,
        waiting_for TEXT,
        editing_file_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    console.log('用户设置表重新创建成功');
    return true;
  } catch (error) {
    console.error('重新创建用户设置表失败:', error);
    return false;
  }
}

export async function recreateFilesTable(config) {
  console.log('开始重建文件表...');
  try {
    const existingData = await config.database.prepare('SELECT * FROM files').all();
    await config.database.prepare('DROP TABLE IF EXISTS files').run();
    await config.database.prepare(`
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        fileId TEXT,
        message_id INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,
        chat_id TEXT,
        storage_type TEXT NOT NULL DEFAULT 'telegram',
        category_id INTEGER,
        custom_suffix TEXT,
        is_chunked INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        upload_id TEXT,
        public_id TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `).run();

    if (existingData && existingData.results && existingData.results.length > 0) {
      for (const row of existingData.results) {
        try {
          await config.database.prepare(`
            INSERT INTO files (
              id, url, fileId, message_id, created_at, file_name, file_size,
              mime_type, chat_id, storage_type, category_id, custom_suffix,
              is_chunked, chunk_count, upload_id, public_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            row.id || null,
            row.url,
            row.fileId || row.url,
            row.message_id || 0,
            row.created_at || Date.now(),
            row.file_name,
            row.file_size,
            row.mime_type,
            row.chat_id,
            row.storage_type || 'telegram',
            row.category_id,
            row.custom_suffix,
            Number(row.is_chunked || 0),
            Number(row.chunk_count || 0),
            row.upload_id || null,
            row.public_id || null
          ).run();
        } catch (error) {
          console.error(`恢复记录失败: ${error.message}`, row);
        }
      }
    }

    console.log('文件表重建完成!');
    return true;
  } catch (error) {
    console.error('重建文件表失败:', error);
    return false;
  }
}

export async function checkAndAddMissingColumns(config) {
  try {
    await ensureColumnExists(config, 'files', 'custom_suffix', 'TEXT');
    await ensureColumnExists(config, 'files', 'chat_id', 'TEXT');
    await ensureColumnExists(config, 'files', 'is_chunked', 'INTEGER');
    await ensureColumnExists(config, 'files', 'chunk_count', 'INTEGER');
    await ensureColumnExists(config, 'files', 'upload_id', 'TEXT');
    await ensureColumnExists(config, 'files', 'public_id', 'TEXT');
    await ensureColumnExists(config, 'user_settings', 'custom_suffix', 'TEXT');
    await ensureColumnExists(config, 'user_settings', 'waiting_for', 'TEXT');
    await ensureColumnExists(config, 'user_settings', 'editing_file_id', 'TEXT');
    await ensureColumnExists(config, 'user_settings', 'current_category_id', 'INTEGER');
    await ensureColumnExists(config, 'user_settings', 'is_processing', 'INTEGER');
    await ensureColumnExists(config, 'user_settings', 'lock_time', 'INTEGER');
    await ensureColumnExists(config, 'user_settings', 'upload_seq', 'INTEGER');
    return true;
  } catch (error) {
    console.error('检查并添加缺失列失败:', error);
    return false;
  }
}

// 管理用户上传锁
export async function acquireUploadLock(chatId, config, maxWaitMs = 20000, pollMs = 300, lockTimeoutMs = 30 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const now = Date.now();
    const result = await config.database.prepare(
      `UPDATE user_settings 
       SET is_processing = 1, lock_time = ?
       WHERE chat_id = ? AND (
         is_processing IS NULL OR is_processing = 0 
         OR (lock_time IS NOT NULL AND ? - lock_time > ?)
       )`
    ).bind(now, chatId, now, lockTimeoutMs).run();
    if (result.meta && result.meta.changes > 0) return true;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return false;
}

export async function releaseUploadLock(chatId, config) {
  try {
    await config.database.prepare(
      'UPDATE user_settings SET is_processing = 0 WHERE chat_id = ?'
    ).bind(chatId).run();
  } catch (error) {
    console.error('释放上传锁失败:', error);
  }
}

export async function ensureColumnExists(config, tableName, columnName, columnType) {
  console.log(`确保列 ${columnName} 存在于表 ${tableName} 中...`); 
  try {
    console.log(`检查列 ${columnName} 是否存在于 ${tableName}...`); 
    const tableInfo = await config.database.prepare(`PRAGMA table_info(${tableName})`).all();
    const columnExists = tableInfo.results.some(col => col.name === columnName);
    if (columnExists) {
      console.log(`列 ${columnName} 已存在于表 ${tableName} 中`);
      return true; 
    }
    console.log(`列 ${columnName} 不存在于表 ${tableName}，尝试添加...`); 
    try {
      await config.database.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`).run();
      console.log(`列 ${columnName} 已成功添加到表 ${tableName}`);
      return true; 
    } catch (alterError) {
      console.warn(`添加列 ${columnName} 到 ${tableName} 时发生错误: ${alterError.message}. 尝试再次检查列是否存在...`, alterError); 
      const tableInfoAfterAttempt = await config.database.prepare(`PRAGMA table_info(${tableName})`).all();
      if (tableInfoAfterAttempt.results.some(col => col.name === columnName)) {
         console.log(`列 ${columnName} 在添加尝试失败后被发现存在于表 ${tableName} 中`);
         return true; 
      } else {
         console.error(`添加列 ${columnName} 到 ${tableName} 失败，并且再次检查后列仍不存在`);
         return false; 
      }
    }
  } catch (error) {
    console.error(`检查或添加表 ${tableName} 中的列 ${columnName} 时发生严重错误: ${error.message}`, error);
    return false; 
  }
}
