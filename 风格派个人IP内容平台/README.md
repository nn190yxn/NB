# 定位派内容工作台

面向个人 IP 创作者的内容研究、素材管理、选题生成、多平台草稿和拍摄执行工作台。

## 快速开始

```bash
# 安装依赖
npm install

# 启动 API，默认端口 3001
npm run server

# 另开终端启动前端，默认端口 5173
npm run dev
```

前端通过 `/api` 访问 API。端口冲突时可使用 `API_PROXY_TARGET` 指定代理目标，例如 `API_PROXY_TARGET=http://localhost:3002 npm run dev`。

## 验证

```bash
# 执行完整验证链
npm run verify

# 仅执行核心 API 端到端验收
npm run e2e
```

完整验证包含 Node.js 测试、TypeScript 类型检查和 Vite 生产构建。

## 主要能力

- 定位发现访谈、候选定位生成和确认
- IP 档案导入、审核、来源追踪和缺口检测
- 素材导入、格式解析、checksum 去重、重试和软删除
- 桌面同步队列、文件事件归并、离线同步和冲突恢复
- RedFox 研究刷新和爆款内容拆解
- 基于来源约束的选题生成和四平台草稿生成
- 草稿版本历史、恢复、事实核验和拍摄清单
- 手机 PWA、离线应用壳和提词器
- 可调整的泛流量、垂直信任和核心目标内容策略

## 生产边界

当前实现使用 JSON MVP 存储。生产环境需要接入身份认证、数据库、对象存储、HTTPS、日志、监控、限流和真实 RedFox 服务。

生产模式会拒绝演示会话创建，并要求业务请求携带有效会话。项目凭据使用 `PROJECT_REDFOX_API_KEY`，仅由服务端读取。

生产上线前检查清单位于 `.monkeycode/docs/PRODUCTION_READINESS.md`。

## 项目文档

- `.monkeycode/docs/ARCHITECTURE.md`：系统架构和数据边界
- `.monkeycode/docs/INTERFACES.md`：API 接口说明
- `.monkeycode/docs/DEVELOPER_GUIDE.md`：开发与验证指南
- `.monkeycode/specs/content-ip-workbench/`：需求、设计和实施清单
