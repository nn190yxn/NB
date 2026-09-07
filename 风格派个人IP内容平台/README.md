# 风格派个人IP内容平台（定位派内容工作台）

**作者：Monkeycode**

面向个人 IP 创作者的一站式内容工作台：定位发现、热点研究、素材管理、选题生成、多平台草稿、爆款方法、拍摄执行与 AI 记忆。Web 工作台 + 手机 PWA 双形态，支持七个内容平台（全平台/小红书/抖音/视频号/公众号/B站/微博/X）。

本文档面向所有后续接手本项目的开发者与 AI Agent，读完即可独立开展开发、验证与部署。

## 当前发布状态（2026-09-07 · 用户旅程修复）

作者：Monkeycode。

- 三批修复已部署至 `https://content.woyai.cn`：配置持久化白名单、访谈恢复与失败保护、模型定位和选题闭环、草稿保护、真实首页与复盘反馈、搜索刷新、账号重登和桌面账号协议。
- 账号同步队列改为分账号存储，归属不明的旧队列保留但不会自动上传；策略保存失败不再显示成功。
- 验证：串行全套测试 163/163、TypeScript/生产构建通过；本地模拟 API 浏览器验证访谈与草稿的失败恢复。生产登录页、新资源和 MySQL 健康检查通过，三个后端文件及首页文件哈希与本地一致。
- 备份：`/home/ubuntu/content-ip-workbench/deploy-backup-20260907-231225-user-journey`，含代码和校验通过的 MySQL 压缩备份；没有替换环境配置、用户数据、私有文件或其他项目。
- 边界：未调用真实付费模型，未做真实账号配置的 MySQL 重启回读验收；桌面源码已修复，但既有安装包不会自动获得新 IPC，尚未重新打包及完成 Electron 真机验收。
- 下一步：GitHub 同步发布记录；后续安排桌面新包和上述真实环境验收。以下第一、二批段落保留为历史过程记录，以本节状态为准。
- 使用方式、关键文件与详细验收见 `docs/audits/2026-09-07-user-journey/README.md`；依赖沿用 React、Vite、Node.js、MySQL、Electron，未新增依赖。

## 综合审计（2026-09-07）

使用流程与存储审计报告见 `docs/audits/2026-09-07-user-journey/README.md`。发现配置 MySQL 持久化、首次定位闭环、访谈恢复与草稿保存保护等待修问题；现有 35 项专项回归通过，但未覆盖这些缺口。仅完成源码审计与生产登录页查看，未完成浏览器全流程验收，未修改业务代码。

## 第一批可靠保存修复（本地，2026-09-07）

作者：Monkeycode。

- API 配置已加入 MySQL 集合保存白名单；访谈加载账号进度、等待保存成功后跳步、稍后填写保存当前答案，失败保留输入，结果目标摘要不清空。
- 未保存草稿执行检查/Hook/恢复/改写前会提示先保存；保存期间禁用编辑并防重复请求，失败显示提示；离开工作区和刷新增加未保存提醒。
- 验证：`npm run verify` 155/155、类型检查与构建通过。新增访谈真实处理器测试、模拟 MySQL 重载测试和源码契约断言；未完成真实 MySQL 重启及浏览器全流程验收。
- 关键文件：`server/mysql.mjs`、`src/main.tsx`、`server/mysql.test.mjs`、`server/onboarding-saving.test.mjs`、`server/web-assets.test.mjs`。
- 设计产出：`docs/superpowers/specs/2026-09-07-reliable-saving-design.md`。依赖沿用 React、Vite、MySQL 和 Node test。
- 当前仅本地修复，未部署/提交。历史已遗失配置无法自动找回；下一批处理定位到档案及选题闭环。

## 第二批定位到选题闭环（本地，2026-09-07）

作者：Monkeycode。

- 定位建议和选题生成接入账号文本模型/共享模型，不再返回固定模板；失败显示错误并保留已有候选或历史选题。来源编号经过服务端校验，模型建议仍需人工核实。
- 候选通过访谈摘要识别过期，返回页面先加载当前候选；确认只补齐空白档案字段并记录历史，已有内容不覆盖，重复确认不重复写历史。确认后进入 IP 档案核对与补充。
- 新增账号历史选题 GET 与调整接口。新选题合并历史列表；调整/暂缓后可编辑标题说明、重新评估，再确认创作。修改会清除旧评估，不绕过批准状态限制。
- 使用：完成访谈→确认建议→核对 IP 档案→收录研究或素材→生成选题→评估/调整→确认生成草稿。文本模型必须配置可用；不再把无配置当作模板生成成功。
- 关键文件：`server/positioning-generation.mjs`、`server/index.mjs`、`src/main.tsx`；测试在 `server/positioning-generation.test.mjs`、`server/auth.test.mjs`、`server/topic-evaluation-api.test.mjs`，模拟上游为 `server/generation-test-helper.mjs`。
- 产出：`docs/superpowers/specs/2026-09-07-positioning-topic-loop-{design,plan}.md`；依赖复用 Node、React、已有模型主备调用及 MySQL，无新增包。
- 验证：160/160 测试、类型检查、构建通过；最终前端提示调整后再次类型与构建通过。模拟接口覆盖上游失败、非法输出、候选保留、过期、重复确认、账号隔离、暂缓调整重评。
- 边界：未调用真实模型，未进行本批浏览器全流程和真实 MySQL 事务/重启验收。确认的 MySQL 写入采用事务，但未证明所有并发写入场景均安全；模型内容正确性仍需人工验收。
- 状态：本地实现完成，未部署、未提交；下一步优先本地浏览器与真实数据库验收，再处理第三批真实指标、首页与桌面登录。

## 当前状态

当前内测版本已完成红狐官网 API、多用户账号与数据隔离、服务器共享 API Key 及每日额度、发布适配/复盘闭环、记忆自动提炼和用户反馈通道。账号首次登录会自动进入 4 步定位访谈，可稍后填写并从“定位发现”继续；首页不再展示固定演示身份和示例选题。质量门当前为 149 项自动化测试、TypeScript 检查和生产构建。

## 内测数据状态

2026-09-07 已在生产数据库备份后清空业务测试数据，保留账号、反馈、账号加密 API 配置、系统方法和违禁词库。清理范围包括研究、素材、选题、草稿、拍摄、同步、档案审核、冲突、记忆、额度及跨端业务集合；定位、策略和档案用户文档未删除。清理后生产库仅保留 2 条账号集合记录，服务健康检查为 MySQL。

## 技术栈与架构

- **前端**：Vite + React 19 + TypeScript，单入口 `src/main.tsx`（全部 UI 组件）+ `src/styles.css`（全部样式，CSS 变量主题系统）。PWA（Service Worker + manifest），离线应用壳。首次使用状态保存在账号的定位文档中，不使用浏览器本地标记。
- **后端**：Node.js 原生 `http` 模块单文件路由（`server/index.mjs`），零框架依赖。
- **存储双轨**：本地/开发用 JSON 文件（`DATA_FILE`）；生产用 MySQL（`server/mysql.mjs`，按 `PROJECT_DB_*` 环境变量自动切换，数据按 `collection` 分表）。
- **外部服务**：红狐官网内容 API（聚合热点、平台热榜、关键词热搜、七平台作品搜索、小红书对标账号）；违禁词检测使用本地词库，不请求红狐、不消耗红狐额度。无 Key 时研究能力自动降级为演示数据。
- **AI 能力**：选题评估、Hook 和草稿质量检查采用确定性规则；API 1/2 为主备文本调用，API 3 为独立视觉调用，账号级配置由服务端加密保存且前端只读取掩码。

### 目录结构

```
src/main.tsx          # 全部前端 UI（组件 + 状态 + API 调用）
src/styles.css        # 主题变量 + 全部样式
public/sw.js          # Service Worker（缓存版本 dingweipai-shell-v3）
server/index.mjs      # 全部 API 路由 + 业务逻辑 + 静态托管
server/mysql.mjs      # MySQL 适配层（collection 读写）
server/redfox.mjs     # 红狐官网 API 适配（服务端读取账号加密 Key 或项目共享 Key）
server/*.test.mjs     # Node 原生测试（当前全量 149 个）
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

完整链 = `node --test`（当前 149 个测试，使用独立临时 DATA_FILE，不碰真实数据）+ `tsc` 类型检查 + Vite 生产构建。全部通过才允许交付。

新增后端功能必须在 `server/*.test.mjs` 补测试；新增前端能力在 `server/web-assets.test.mjs` 加特征断言（该测试读取 src 源码验证关键类名/组件存在）。

## 核心领域模型

数据以 `collection` 为单位存储（JSON 模式为一个大对象，MySQL 模式按表分）：`research`（研究）、`materials`（素材）、`drafts`（草稿）、`structures`（爆款方法库的兼容存储）、`topics`（选题）、`memories`（AI 记忆）、`shooting`（拍摄清单）、`profile_reviews`（IP 档案审核）等。

**新增 collection 有两处必改**：`server/mysql.mjs` 的 `collectionNames` + `server/index.mjs` 的 state 初始化。漏掉后者会报 `owned() TypeError`。

### 素材原子化

素材分五类 `material_kind`：`article`（文章，历史数据默认）/ `quote`（金句）/ `hotspot`（热点）/ `insight`（洞察）/ `experience`（经历）。两种产生方式：从文章提取结果一键收录（`POST /api/materials/atoms`，按 `origin_source_id + origin_text` 去重，源素材 `extracted_fields.collected` 标记）或手动新建。删除原子会恢复源素材的 collected 标记。

### 组合创作

`POST /api/drafts/generate` 除 `topic_id` / `structure_id` 外支持 `quote_ids`、`experience_ids`，正文按 方法骨架 → 金句参考 → 经历素材 → 行动指引 组装，`source_refs` 保留全部来源链路。

### AI 记忆层

三类记忆 `type`：`style`（风格）/ `topic`（选题）/ `feedback`（反馈）。CRUD 见 `/api/memories`；active 状态的记忆会在草稿生成时注入"创作风格要求"段落。`POST /api/memories/extract` 使用账号自有或项目共享的主备大模型，从对话/访谈文本提炼记忆；没有可用模型时返回 422 `llm_not_configured`。记忆 `provider` 字段保留后续升级路径。

## 认证与密钥模型

- **生产账号制**：生产环境要求注册或登录后访问 `/api/*`；开发/测试保留免登录身份，设置 `PRODUCT_ACCESS_PASSWORD` 时继续兼容旧访问密码通道。
- **API 配置服务端加密**：大模型 API 1/API 2/API 3 按账号使用 `API_CONFIG_ENCRYPTION_KEY` 进行 AES-256-GCM 加密，前端只读取掩码；API 1/2 串行兜底，视觉任务只使用 API 3。旧浏览器配置只通过显式迁移接口导入。
- 生产拒绝演示会话；项目共享红狐和文本模型 Key 只从服务端环境变量读取，并受每账号每日额度限制。

## 生产部署

生产运行于独立 Ubuntu 服务器（IP 见运维密码库/本地 `.monkeycode-tmp-files/` 密钥文件，该目录已 gitignore，不入库）：

| 项 | 值 |
|---|---|
| 目录 | `/home/ubuntu/content-ip-workbench` |
| 进程 | PM2 `content-ip-workbench`，端口 3003 |
| 域名 | `https://content.woyai.cn`（Nginx 反代 → 3003） |
| 环境 | `.env.production`（PROJECT_DB_*、APP_ORIGIN、PORT、API_CONFIG_ENCRYPTION_KEY、共享 API 与额度配置） |
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

生产必须配置随机的 32 字节十六进制或 Base64 `API_CONFIG_ENCRYPTION_KEY`。当前代码为开发兼容保留固定默认值，因此部署检查必须保证生产环境变量存在，禁止使用默认值保存用户 API Key。

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
- 大模型和红狐 Key 由用户通过 API 中心提交，由服务端按账号加密保存；Agent 不得读取生产 Key、写入代码或输出到日志。
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

1. 完成内测反馈收集与额度使用观察
2. 仪表盘数字统计卡（4 列核心指标）
3. 相似账号对标深化
4. 评估多实例部署时的数据库原子额度计数

## 更新记录

所有版本变更、功能上线与部署记录见 [CHANGELOG.md](CHANGELOG.md)。

> **多 Agent 协作约定**：CHANGELOG 为追加式日志——新条目加在最上方（`## YYYY-MM-DD · 主题`），**禁止修改或删除历史条目**；README 只维护"当前状态"，历史过程一律写入 CHANGELOG。
