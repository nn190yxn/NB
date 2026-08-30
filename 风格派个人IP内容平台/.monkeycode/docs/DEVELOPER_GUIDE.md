# 开发指南

## 环境要求

- Node.js 运行时
- npm

## 安装与运行

```bash
# 安装依赖
npm install

# 启动 API
npm run server

# 启动前端
npm run dev
```

前端开发地址由 Vite 输出，API 默认监听 `3001`。端口冲突或多服务并行验证时，可通过 `API_PROXY_TARGET` 指定前端代理目标。

健康检查地址支持 `GET`/`HEAD` `/healthz` 和 `/api/health`。生产环境需要通过项目自己的环境配置注入 `APP_ORIGIN`、`NODE_ENV`、`DATA_FILE` 以及可选的 RedFox 配置；生产 Cookie 会自动启用 `Secure`。生产模式下所有业务 API 请求都必须携带有效会话，身份认证服务接入前会话创建接口返回 `503`，演示用户仅在开发/测试模式可用。
API 请求会返回 `x-request-id` 并输出结构化访问日志。可通过 `API_RATE_LIMIT_WINDOW_MS` 和 `API_RATE_LIMIT_MAX` 调整单客户端 API 限流，健康检查请求不计入限额。

## 验证命令

```bash
# 类型检查
npm run typecheck

# 生产构建
npm run build

# 核心 API 端到端链路
npm run e2e

# 完整验证链
npm run verify
```

## 数据开发

API 启动时读取 `server/data.json`。该文件属于本地运行数据，已加入 `.gitignore`。修改数据模型时需要保留启动迁移逻辑，为旧 JSON 补充新字段。
生产数据库迁移使用 `npm run db:migrate`，连接配置通过 `PROJECT_DB_HOST`、`PROJECT_DB_PORT`、`PROJECT_DB_NAME`、`PROJECT_DB_USER` 和 `PROJECT_DB_PASSWORD` 注入。迁移创建 `app_state` 基础表；配置完整数据库变量后，API 使用 MySQL 状态存储，否则回退到 JSON MVP 模式。
数据库备份使用 `npm run db:backup`，备份文件写入 `PROJECT_DB_BACKUP_DIR` 指定目录并设置为仅所有者可读写；备份命令使用单事务和 gzip，不清理历史备份。
浏览器请求的 `Origin` 必须匹配 `APP_ORIGIN`；未携带 `Origin` 的服务端请求仍可使用 API。
素材撤回使用 `DELETE /api/materials/:id`，服务端保留记录并写入 `deleted_at`，默认查询自动排除撤回记录。

## 前端约定

- 页面请求使用 `src/main.tsx` 内的 `apiJson`。
- API 请求使用 `/api` 前缀。
- 新内容资产需要保留 `source_refs`、`goal_refs` 和 `strategy_layer`。
- 提词器设置通过 `src/shooting-utils.ts` 读写本地存储；剪贴板能力优先使用 Clipboard API，并保留浏览器降级路径。
- 浏览器端待同步素材通过 `src/sync-queue.ts` 持久化到 `localStorage`，网络恢复后调用 `flushSyncQueue()`；服务端冲突通过 `/api/sync/conflicts` 查询和解决。
- 桌面同步模块位于 `desktop/sync-client.mjs`，负责保存目录配置、读取文件校验值和监听支持的素材扩展名；生产桌面壳可直接调用这些无 UI 函数。
- 视觉修改沿用 `src/styles.css` 的主题令牌和响应式规则。
