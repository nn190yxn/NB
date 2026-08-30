# 系统架构

## 概述

定位派是面向个人 IP 创作者的内容研究与创作工作台。用户通过定位发现访谈明确长期目标，再用分层内容策略组织素材、热点、选题和多平台草稿。

当前 MVP 由 React/Vite Web 客户端和 Node.js HTTP API 组成。API 统一保存定位、策略、素材、研究、选题、草稿、档案审核和拍摄清单数据，并通过来源引用保持内容可追溯。

## 技术栈

- TypeScript、React、Vite
- Node.js 原生 HTTP 服务
- Lucide React 图标
- 本地 JSON 持久化（MVP 默认模式）
- MySQL 连接池与初始化迁移入口（生产准备）
- Vite `/api` 开发代理

## 项目结构

```text
src/main.tsx       React 工作台、定位访谈和策略交互
src/styles.css     主题令牌与响应式样式
src/shared/types.ts共享领域类型
server/index.mjs   API 路由、校验和持久化
vite.config.ts     Vite 配置与 API 代理
```

## 请求流

```mermaid
flowchart LR
    Client[Web 客户端] --> Proxy["Vite API 代理"]
    Proxy --> API["Node API"]
    API --> Domain["定位策略素材研究领域"]
    Domain --> Store["JSON MVP 或 MySQL 生产存储"]
```

## 数据原则

- 每个内容资产包含策略层级、目标关联和来源引用。
- 素材使用 checksum 去重。
- 素材撤回采用 `deleted_at` 软删除，默认资源查询和来源选择会排除已撤回素材。
- 策略更新保存版本历史。
- `server/data.json` 是本地 MVP 存储，生产环境使用项目专用 MySQL 数据库。
- `server/mysql.mjs` 读取 `PROJECT_DB_*` 配置，提供连接池、连接验证和 `app_state` 初始化迁移。
- 配置完整的 `PROJECT_DB_*` 后，API 启动从 MySQL 加载状态并将写入回写到 `app_state`；缺少数据库配置时使用 JSON MVP 回退。
