# 生产上线检查清单

本文档记录内容工作台从 MVP 运行模式进入生产环境前需要完成的事项。

## 当前 MVP 基线

- 存储：本地 JSON 文件，适合开发和集成验收。
- 身份认证：开发/测试模式支持演示会话。
- 研究服务：未配置 RedFox 时使用确定性样例数据。
- 前端入口：Vite 开发服务器，API 使用 `/api` 前缀。
- 健康检查：`GET /healthz` 返回 API 与存储状态。

## 必需配置

生产环境需要通过项目自己的配置系统提供以下变量：

```env
NODE_ENV=production
APP_ORIGIN=https://your-app.example.com
DATA_FILE=/srv/content-ip/data.json
REDFOX_API_URL=https://your-redfox.example.com
PROJECT_REDFOX_API_KEY=由部署系统注入
```

身份认证服务需要在业务会话接口启用前完成接入。当前生产模式会拒绝演示会话创建，并对缺少有效会话的业务请求返回 `401`。

## 基础设施替换

- 将 JSON 存储替换为具备迁移、备份和事务能力的数据库。
- 将原始素材从本地文件策略迁移到对象存储，并保留 checksum、来源和软删除字段。
- 将 API 日志接入集中式日志系统，记录请求 ID、用户 ID、错误类别和重试状态。
- 配置 HTTPS、Cookie 安全属性、备份策略和数据保留周期。
- 为 RedFox 请求配置超时、额度监控和可观测性。
- 将桌面同步模块封装为 Electron、Tauri 或系统托盘客户端，并管理设备令牌生命周期。

## 发布前验收

```bash
# 执行完整本地验证
npm run verify

# 启动生产模式 API 进行鉴权边界检查
NODE_ENV=production npm run server
```

- 未登录业务请求返回 `401`。
- 生产模式演示会话创建返回 `503`。
- `GET /healthz` 和 `HEAD /healthz` 均可被部署平台探活。
- 前端代理目标指向同一环境的 API 地址。
- 浏览器请求的 `Origin` 与 `APP_ORIGIN` 严格匹配，其他来源返回 `403`。
- API 响应包含 CSP、`X-Content-Type-Options`、`X-Frame-Options`、Referrer-Policy 和 Permissions-Policy。
- 素材、草稿、拍摄清单和冲突记录均通过用户归属校验。
- 未核验事实无法直接发布草稿。
- 备份恢复演练和真实手机 PWA 验收通过。

## 当前未完成项

- 生产身份认证服务。
- 生产数据库和对象存储。
- 真实 RedFox 服务配置与额度监控。
- 浏览器级自动化测试运行器。
- 生产 HTTPS、日志、监控和限流配置。
