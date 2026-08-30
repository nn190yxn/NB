# 风格派个人IP内容平台（定位派内容工作台）

面向个人 IP 创作者的一站式内容工作台：定位发现、热点研究、素材管理、选题生成、多平台草稿、爆款结构、拍摄执行与 AI 记忆。Web 工作台 + 手机 PWA 双形态，支持七个内容平台（全平台/小红书/抖音/视频号/公众号/B站/微博/X）。

本文档面向所有后续接手本项目的开发者与 AI Agent，读完即可独立开展开发、验证与部署。

## 技术栈与架构

- **前端**：Vite + React 19 + TypeScript，单入口 `src/main.tsx`（全部 UI 组件）+ `src/styles.css`（全部样式，CSS 变量主题系统）。PWA（Service Worker + manifest），离线应用壳。
- **后端**：Node.js 原生 `http` 模块单文件路由（`server/index.mjs`），零框架依赖。
- **存储双轨**：本地/开发用 JSON 文件（`DATA_FILE`）；生产用 MySQL（`server/mysql.mjs`，按 `PROJECT_DB_*` 环境变量自动切换，数据按 `collection` 分表）。
- **外部服务**：红狐内容 API（热搜榜、违禁词检测、相似账号对标），三技能均带演示数据双轨（无 Key 时自动降级 demo）。
- **AI 能力**：选题/草稿生成当前为确定性规则引擎；大模型 API 预留（用户 Key 存浏览器 localStorage，服务端永不落库）。

### 目录结构

```
src/main.tsx          # 全部前端 UI（组件 + 状态 + API 调用）
src/styles.css        # 主题变量 + 全部样式
public/sw.js          # Service Worker（缓存版本 dingweipai-shell-v3）
server/index.mjs      # 全部 API 路由 + 业务逻辑 + 静态托管
server/mysql.mjs      # MySQL 适配层（collection 读写）
server/redfox.mjs     # 红狐 API 适配（x-redfox-api-key 头透传 + demo 双轨）
server/*.test.mjs     # Node 原生测试（55 个）
desktop/              # 桌面壳（Electron）
.monkeycode/docs/     # 架构/接口/开发指南/上线清单文档
.monkeycode/specs/    # 各特性需求与设计文档（EARS 格式）
```

## 本地开发

```bash
npm install

# 启动 API，默认端口 3001
npm run server

# 另开终端启动前端，默认端口 5173
npm run dev
```

前端通过 `/api` 前缀访问 API（Vite 代理）。端口冲突时：`API_PROXY_TARGET=http://localhost:3002 npm run dev`。

## 验证（改代码后必跑）

```bash
npm run verify
```

完整链 = `node --test`（55 个测试，使用独立临时 DATA_FILE，不碰真实数据）+ `tsc` 类型检查 + Vite 生产构建。全部通过才允许交付。

新增后端功能必须在 `server/*.test.mjs` 补测试；新增前端能力在 `server/web-assets.test.mjs` 加特征断言（该测试读取 src 源码验证关键类名/组件存在）。

## 核心领域模型

数据以 `collection` 为单位存储（JSON 模式为一个大对象，MySQL 模式按表分）：`research`（研究）、`materials`（素材）、`drafts`（草稿）、`structures`（爆款结构）、`topics`（选题）、`memories`（AI 记忆）、`shooting`（拍摄清单）、`profile_reviews`（IP 档案审核）等。

**新增 collection 有两处必改**：`server/mysql.mjs` 的 `collectionNames` + `server/index.mjs` 的 state 初始化。漏掉后者会报 `owned() TypeError`。

### 素材原子化

素材分五类 `material_kind`：`article`（文章，历史数据默认）/ `quote`（金句）/ `hotspot`（热点）/ `insight`（洞察）/ `experience`（经历）。两种产生方式：从文章提取结果一键收录（`POST /api/materials/atoms`，按 `origin_source_id + origin_text` 去重，源素材 `extracted_fields.collected` 标记）或手动新建。删除原子会恢复源素材的 collected 标记。

### 组合创作

`POST /api/drafts/generate` 除 `topic_id` / `structure_id` 外支持 `quote_ids`、`experience_ids`，正文按 结构骨架 → 金句参考 → 经历素材 → 行动指引 组装，`source_refs` 保留全部来源链路。

### AI 记忆层

三类记忆 `type`：`style`（风格）/ `topic`（选题）/ `feedback`（反馈）。CRUD 见 `/api/memories`；active 状态的记忆会在草稿生成时注入"创作风格要求"段落。`POST /api/memories/extract` 是自动提炼桩，当前固定返回 422 `llm_not_configured`，等大模型 Key 接入后实现。记忆 `provider` 字段已预留升级路径（内建 → 腾讯 Agent Memory / Mem0）。

## 认证与密钥模型

- **认证可选**：设置环境变量 `PRODUCT_ACCESS_PASSWORD` 即启用密码门槛；不设置则开放访问（userId 固定 `owner`）。当前生产为开放模式。
- **API Key 只存浏览器**：红狐 Key 与大模型 Key 存 localStorage（`dingweipai:api-settings`），红狐调用通过 `x-redfox-base-url` / `x-redfox-api-key` 请求头透传，服务端不持久化任何 Key。
- 生产拒绝演示会话；项目级红狐 Key 可用环境变量 `PROJECT_REDFOX_API_KEY`（仅服务端读取）。

## 生产部署

生产运行于独立 Ubuntu 服务器（IP 见运维密码库/本地 `.monkeycode-tmp-files/` 密钥文件，该目录已 gitignore，不入库）：

| 项 | 值 |
|---|---|
| 目录 | `/home/ubuntu/content-ip-workbench` |
| 进程 | PM2 `content-ip-workbench`，端口 3003 |
| 域名 | `https://content.woyai.cn`（Nginx 反代 → 3003） |
| 环境 | `.env.production`（PROJECT_DB_*、APP_ORIGIN、PORT、DATA_FILE、NODE_ENV） |
| 数据库 | MySQL 库名读 `PROJECT_DB_NAME`（当前 `ip_collections`） |

### 部署流程

```bash
# 1. 前端构建产物
tar -C dist -czf /tmp/dist.tar.gz .
scp 密钥 /tmp/dist.tar.gz 服务器:/tmp/
# 服务器上解压到临时目录后 rsync -a --delete 进 dist/

# 2. 验证前端上线（bundle 名每次构建都变）
curl -s https://content.woyai.cn/ | grep -oP "index-[A-Za-z0-9_-]+\.js"

# 3. 服务端有改动时，额外执行（否则线上仍是旧逻辑！）
scp 密钥 server/index.mjs server/mysql.mjs server/redfox.mjs 服务器:/home/ubuntu/content-ip-workbench/server/
ssh 服务器 "pm2 restart content-ip-workbench --update-env"

# 4. 验证服务端新路由特征（curl 打新端点确认 200/预期响应）
```

**最大陷阱**：服务端变更后只部署 dist 忘了 scp + pm2 restart，前端已更新而后端仍旧代码，表现为"接口不存在/行为不对"。部署后必须用 curl 验证一个新路由的特征响应。

**PM2 环境变量残留**：修改环境变量后 `pm2 restart --update-env` 可能不生效，需 `pm2 delete content-ip-workbench` 后用完整命令重建：

```bash
pm2 start server/index.mjs --name content-ip-workbench \
  --node-args="--env-file=/home/ubuntu/content-ip-workbench/.env.production" --time
```

服务器是多项目共存环境：数据库、目录、PM2 服务、Nginx、crontab 均按项目隔离，严禁改动其他项目的配置。

## 设计规范（新 UI 必须遵守）

- **四主题**：`warm`（默认，暖米纸 + 朱橙，对齐用户设计稿）/ 其余三套经 CSS 变量切换。主题存 `dingweipai:theme`。
- **字号阶梯**：次要文字 11.5px、正文 12.5px、强调 13.5px、标题 15-21px。禁止引入游离的 12px/13px。
- **视觉语言**：白卡片 + 1px 线框 + hover 上浮（translateY(-1px) + shadow-lg）+ fadein 动画 + 毛玻璃 topbar；独立结果卡用 `.asset-row`，空态用 `.structure-empty`（居中虚线框），筛选行用 `.chip` + `.filter-label`。
- **子页面布局**：`.workspace-mode` 下隐藏 dashboard 页头（`.workspace-mode > *:not(.workspace-view):not(.offline-banner):not(.conflict-banner)`），横幅提示必须保留可见。
- 前端 localStorage 键前缀 `dingweipai:`：`theme` / `font` / `api-settings` / `skill-toggles`。
- 改动 `public/`（sw.js 等）需 bump 缓存版本号；认证/缓存/主题相关变更后提示用户硬刷新。

## 协作约定

- 未经明确授权不执行 `git commit` / `git push`。
- 改动后先 `npm run verify` 全绿再交付；部署后单独验证代码特征（bundle 名、新路由响应）。
- 大模型 Key 由用户自行提供并存浏览器，Agent 不得从执行环境读取或写入任何 Key 到代码。
- 需求与设计文档放 `.monkeycode/specs/{特性名}/`（requirements.md + design.md）。
- 远端仓库：`github.com/nn190yxn/NB` 的 `风格派个人IP内容平台/` 子文件夹（推送时用临时克隆组装，排除 node_modules/dist/数据/密钥）。

## 项目文档索引

- `.monkeycode/docs/ARCHITECTURE.md`：系统架构和数据边界
- `.monkeycode/docs/INTERFACES.md`：API 接口说明
- `.monkeycode/docs/DEVELOPER_GUIDE.md`：开发与验证指南
- `.monkeycode/docs/PRODUCTION_READINESS.md`：生产上线检查清单
- `.monkeycode/specs/material-atomization/`：素材原子化需求与设计
- `.monkeycode/specs/ai-memory-layer/`：AI 记忆层需求与设计（含升级路径）

## Roadmap（按优先级）

1. 大模型 API 接入：记忆自动提炼（extract 桩已就位）、选题/草稿升级为真实 LLM 生成
2. 仪表盘数字统计卡（4 列核心指标）
3. 相似账号对标深化
4. 记忆层升级评估（腾讯 Agent Memory / Mem0，provider 字段已预留）
