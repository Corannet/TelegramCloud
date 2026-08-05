# 更新说明

## 一 无后缀直链

新增 `files.public_id` 字段作为公开文件标识

新文件写入数据库时会同时生成独立随机标识和无后缀公开地址

文件存储键继续保留扩展名 因此不会影响内容类型识别和底层存储

文件请求按以下顺序查找

1. R2 原存储键
2. 数据库完整旧直链
3. 新 `public_id`
4. 旧 `fileId`
5. 旧文件名

这种方式保证已有扩展名直链保持可用

## 二 上传网页管理

新增上传网页管理页面和三个管理接口

- `/upload-pages`
- `/api/upload-pages`
- `/api/upload-pages/create`
- `/api/upload-pages/delete`

新增公开页面和接口

- `/updata/<slug>`
- `/api/updata/<slug>/files`
- `/api/updata/<slug>/upload`
- `/api/updata/<slug>/chunk`
- `/api/updata/<slug>/complete`
- `/api/updata/<slug>/abort`
- `/api/updata/<slug>/delete`

上传网页支持普通上传和 Telegram 分片上传

每个浏览器通过本地随机令牌管理自己的上传记录 服务端仅保存令牌哈希
