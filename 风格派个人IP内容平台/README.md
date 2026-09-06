# 风格派个人IP内容平台（定位派内容工作台）

**作者：Monkeycode**

面向个人 IP 创作者的一站式内容工作台：定位发现、热点研究、素材管理、选题生成、多平台草稿、爆款方法、拍摄执行与 AI 记忆。Web 工作台 + 手机 PWA 双形态，支持七个内容平台（全平台/小红书/抖音/视频号/公众号/B站/微博/X）。

本文档面向所有后续接手本项目的开发者与 AI Agent，读完即可独立开展开发、验证与部署。

## 当前状态

内容决策与创作质量链 Task 1–6 已全部完成：能力契约、选题七维评估、Hook/平台草稿、三道草稿检查、人工确认/撤回与第一阶段质量门均已验证。2026-09-03 代码级验收复核通过：全量质量门 119/119、真实临时 API 关键链 7/7、类型检查和生产构建通过；未部署、未提交、未推送。下一步等待生产验收或另行定义第二阶段。

## 当前 IP 初始化档案

当前演示工作区已按 `E:\Work\Alex\个人IP\01_定位与战略.md` 映射为：**小姚哥｜创业过来人**。核心定位是“帮本地生意老板诊断：钱漏在哪，人卡在哪。”，目标用户为本地生意老板、实体门店老板、本地服务商和小团队老板。数据只写入与产品字段对应的核心定位、受众、问题、内容支柱和表达边界，不复制完整私密档案；暂定假设仍保持为待验证状态。

当前首页“研究脉搏”读取 `/api/research?sort=latest` 的最新三条真实研究；点击卡片会进入“热点研究”并自动定位、展开对应详情。热点研究列表采用桌面双列、移动单列的响应式卡片网格，小红书标签使用暖橙文字与浅杏底色。首页与各子页面采用 React 条件渲染隔离。产品界面统一使用“爆款方法库”，按“选题方法、标题方法、开头方法、内容结构”四类组织；底层继续兼容既有 `/api/structures`、`content_type` 和历史数据。方法库筛选区采用“方法分类为一级导航、适用平台为二级筛选”的层级。

## 技术栈与架构

- **前端**：Vite + React 19 + TypeScript，单入口 `src/main.tsx`（全部 UI 组件）+ `src/styles.css`（全部样式，CSS 变量主题系统）。PWA（Service Worker + manifest），离线应用壳。
- **后端**：Node.js 原生 `http` 模块单文件路由（`server/index.mjs`），零框架依赖。
- **存储双轨**：本地/开发用 JSON 文件（`DATA_FILE`）；生产用 MySQL（`server/mysql.mjs`，按 `PROJECT_DB_*` 环境变量自动切换，数据按 `collection` 分表）。
- **外部服务**：红狐内容 API（热搜榜、违禁词检测、相似账号对标），三技能均带演示数据双轨（无 Key 时自动降级 demo）。
- **AI 能力**：选题评估、Hook 和草稿质量检查采用确定性规则；API 1/2 为主备文本调用，API 3 为独立视觉调用，账号级配置由服务端加密保存且前端只读取掩码。

### 目录结构

```
src/main.tsx          # 全部前端 UI（组件 + 状态 + API 调用）
src/styles.css        # 主题变量 + 全部样式
public/sw.js          # Service Worker（缓存版本 dingweipai-shell-v3）
server/index.mjs      # 全部 API 路由 + 业务逻辑 + 静态托管
server/mysql.mjs      # MySQL 适配层（collection 读写）
server/redfox.mjs     # 红狐 API 适配（x-redfox-api-key 头透传 + demo 双轨）
server/*.test.mjs     # Node 原生测试（当前全量 129 个）
desktop/              # 桌面壳（Electron）
scripts/import-benchmark.mjs # 对标账号资料包导入器（方法库/素材原子/AI 记忆）
scripts/benchmarks/   # 对标账号资料包（如 dontbesilent.json）
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

### Windows 一键启动

完成一次 `npm install` 后，双击项目根目录的 `一键启动.bat`。脚本会隐藏启动 API 和前端，等待服务就绪后自动打开 `http://127.0.0.1:5173/`。API、前端和启动器输出统一写入根目录的 `local-app.log`。

重复双击会复用已经正常运行的 3001/5173 服务。本脚本只负责启动；如需关闭，请在任务管理器中结束对应 Node.js 进程。

## 验证（改代码后必跑）

```bash
npm run verify
```

完整链 = `node --test`（当前 129 个测试，使用独立临时 DATA_FILE，不碰真实数据）+ `tsc` 类型检查 + Vite 生产构建。全部通过才允许交付。

新增后端功能必须在 `server/*.test.mjs` 补测试；新增前端能力在 `server/web-assets.test.mjs` 加特征断言（该测试读取 src 源码验证关键类名/组件存在）。

## 核心领域模型

数据以 `collection` 为单位存储（JSON 模式为一个大对象，MySQL 模式按表分）：`research`（研究）、`materials`（素材）、`drafts`（草稿）、`structures`（爆款方法库的兼容存储）、`topics`（选题）、`memories`（AI 记忆）、`shooting`（拍摄清单）、`profile_reviews`（IP 档案审核）等。

**新增 collection 有两处必改**：`server/mysql.mjs` 的 `collectionNames` + `server/index.mjs` 的 state 初始化。漏掉后者会报 `owned() TypeError`。

### 素材原子化

素材分五类 `material_kind`：`article`（文章，历史数据默认）/ `quote`（金句）/ `hotspot`（热点）/ `insight`（洞察）/ `experience`（经历）。两种产生方式：从文章提取结果一键收录（`POST /api/materials/atoms`，按 `origin_source_id + origin_text` 去重，源素材 `extracted_fields.collected` 标记）或手动新建。删除原子会恢复源素材的 collected 标记。

### 组合创作

`POST /api/drafts/generate` 除 `topic_id` / `structure_id` 外支持 `quote_ids`、`experience_ids`，正文按 方法骨架 → 金句参考 → 经历素材 → 行动指引 组装，`source_refs` 保留全部来源链路。

### AI 记忆层

三类记忆 `type`：`style`（风格）/ `topic`（选题）/ `feedback`（反馈）。CRUD 见 `/api/memories`；active 状态的记忆会在草稿生成时注入"创作风格要求"段落。`POST /api/memories/extract` 是自动提炼桩，当前固定返回 422 `llm_not_configured`，等大模型 Key 接入后实现。记忆 `provider` 字段已预留升级路径（内建 → 腾讯 Agent Memory / Mem0）。

## 认证与密钥模型

- **认证可选**：设置环境变量 `PRODUCT_ACCESS_PASSWORD` 即启用密码门槛；不设置则开放访问（userId 固定 `owner`）。当前生产为开放模式。
- **API 配置服务端加密**：大模型 API 1/API 2/API 3 按账号使用 `API_CONFIG_ENCRYPTION_KEY` 进行 AES-256-GCM 加密，前端只读取掩码；API 1/2 串行兜底，视觉任务只使用 API 3。旧浏览器配置只通过显式迁移接口导入。
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
scp 密钥 server/index.mjs server/llm.mjs server/mysql.mjs server/redfox.mjs 服务器:/home/ubuntu/content-ip-workbench/server/
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

## 对标账号资料包导入

把对标账号的研究成果批量导入工作台（方法库 / 素材原子 / AI 记忆），幂等可重跑：

```bash
npm run server  # 先启动 API（本地 dev 免认证）
node scripts/import-benchmark.mjs scripts/benchmarks/dontbesilent.json
# 可选：--base http://localhost:3002 换端口；--password <访问密码> 用于生产；--user <id> 指定 dev 用户
```

资料包 JSON 结构：`structures[]`（title/steps/platform/content_type）、`atoms[]`（kind: quote|insight|hotspot|experience / name / text）、`memories[]`（memory_type: style|topic|feedback / content）。制作新对标资料包时只导入**可复制机制**（结构/范式/清单），对标账号的人设观点类素材一律加「对标」前缀作参考素材。

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

## 更新记录

所有版本变更、功能上线与部署记录见 [CHANGELOG.md](CHANGELOG.md)。

> **多 Agent 协作约定**：CHANGELOG 为追加式日志——新条目加在最上方（`## YYYY-MM-DD · 主题`），**禁止修改或删除历史条目**；README 只维护"当前状态"，历史过程一律写入 CHANGELOG。
