# 更新记录（CHANGELOG）

> **维护规则（所有后续接手的开发者与 AI Agent 必读）：**
> 1. 本文件是**追加式**日志：只在最上方新增条目，**不修改、不删除任何历史条目**。
> 2. README.md 是"当前状态"文档；发生过什么、什么时候发生，查这里。
> 3. 新条目格式：`## YYYY-MM-DD · 主题`，列出变更内容、涉及文件、验证结果与提交号。
> 4. 一批相关工作合并为一个条目；小修小补可并入当日条目的"修复"小节。

## 2026-09-07 · 用户旅程发布回执

- 修复提交 `ff24abb` 已推送 GitHub `origin/main`，生产运行同批构建与服务端代码；详细备份和验证见下条记录及审计 README。
- 更新 README 当前状态与验收限制，保留原始审计及历史记录；全局任务登记册与任务记忆已同步。
- 浏览器结束回执包含本地 Vite 页面一次可恢复 `NotFoundError`，原因未确认；功能断言与生产检查通过，不将其描述为零脚本警告。

## 2026-09-07 · 用户旅程三批修复上线

- 配置持久化：注册 MySQL `api_configs` 集合；访谈按账号恢复回答与进度，保存失败保留输入、成功后才跳步。
- 定位与选题：调用配置模型并验证结构和来源；确认定位仅补充空白档案，保留手填内容；恢复历史选题，支持编辑与重新评估。
- 草稿与账号：未保存内容的覆盖/离开保护、401 后原账号重登保留编辑；认证后加载数据；桌面登录/注册统一账号协议，同步队列按账号隔离。
- 真实反馈：移除固定增长率、自动比例建议、研究徽标及同步时间；首页读取历史选题，搜索重新加载完整方法分页并提示加载失败，策略保存失败明确提示。
- 文件：`src/main.tsx`、`src/sync-queue.ts`、`server/index.mjs`、`server/mysql.mjs`、`server/positioning-generation.mjs`、`desktop/main.mjs`、`desktop/preload.mjs`、`desktop/auth-request.mjs`及对应测试和规格文档。
- 验证：串行全套 163/163、类型检查和构建通过；本地模拟浏览器两组验收通过。曾有一次并行套件的表现快照测试失败，单测与串行全套均通过，原因未最终确认，不声称并行稳定性已解决。
- 生产：代码和数据库已备份；站点登录页、MySQL 健康检查、新 bundle 和服务端哈希验证通过；未写入生产测试账号或调用付费模型。
- 备份：`/home/ubuntu/content-ip-workbench/deploy-backup-20260907-231225-user-journey`。
- 边界：尚未完成真实 MySQL 配置重启回读、真实模型质量及桌面新安装包验收。桌面代码更新不等于旧安装包已升级。
- 提交号：见包含本条记录的 Git 提交；GitHub 同步回执另行追加。

## 2026-09-07 · 内测共享额度边界修复

- 修复共享 AI 额度耗尽后复盘、平台适配返回请求错误的问题；额度不足时改为确定性规则降级。
- 修复仅配置账号备用模型即可绕过项目共享主模型额度的问题；是否计费改为按实际主模型来源判断。
- 修复本地违禁词检查错误消耗红狐共享额度的问题，响应来源统一为 `builtin`。
- 补充额度耗尽降级、备用模型计费、本地检查不计费、自有主模型豁免回归覆盖。
- 同步 README 的测试数量、账号认证、RedFox、记忆提炼和生产加密主密钥说明。
- 涉及文件：`server/index.mjs`、`server/quota.test.mjs`、`server/redfox-skills.test.mjs`、`README.md`。
- 验证：149/149 自动化测试、TypeScript 检查、Vite 生产构建全部通过；已部署 `https://content.woyai.cn`，线上首页 200、健康检查正常且存储为 MySQL，服务端文件哈希与本地一致。
- 部署备份：`/home/ubuntu/content-ip-workbench/deploy-backup-20260907-quota-fix`。
- 提交号：未创建（待用户授权）。

## 2026-09-06 · 内测版本上线（红狐官网接口 / 多用户 / 体验闭环 / 反馈与日志）

本批次为内测发布做准备，全部功能已部署至 `https://content.woyai.cn` 并线上验证。提交号：`74d7da1`、`deedb35`、`a39fd9a`、`cd2ff8f`、`fab54ac`。

### 1. 红狐官网 API 全量接入

- 背景：此前按假定的 `/v1/*` 路径调用，实际官网接口为 `https://redfox.hk` 下的 `/story/api/*`，导致"返回了无效数据"。
- `server/redfox.mjs` 整体重写，接口契约取自官网文档系统（`/story/web/api/doc/detail/no/*`，2026-09-06 核对）：
  - 全网聚合热点 `POST /story/api/hotKeyword/list`（连接测试也走此接口）
  - 各平台热点榜 `GET /story/api/hotSpot/getListByPlatform`（平台编号：1快手 2抖音 5微博 6小红书 7百度 8B站 9知乎 10今日头条）
  - 关键词热搜 `POST /story/api/hotSpot/getListByPlatformWithKeyword`（≤30 天）
  - 七平台搜作品：小红书 `xhsUser/searchArticle`、抖音 `dyData/searchArticle`、公众号 `gzhData/searchArticle`、视频号 `sphAllData/searchWork`、快手 `ksAllData/searchWork`、B站 `bili/data/workSearch`（响应键为 `workList`）、今日头条 `toutiao/searchWork`
  - 对标账号 `POST /story/api/xhsUser/searchUser`（输入驱动，替代无关联的热门账号榜单；仅小红书）
- 鉴权统一 `REDFOX_API_KEY` 请求头；成功响应 `{ code: 2000 }`；错误可行动化（401/403 鉴权失败、429 额度不足、非 JSON 提示确认 Base URL、业务码透传官网 msg），不泄露 Key。
- 官网无违禁词检测接口（已核实目录），违禁词检测保持本地词库（`prohibitedWordlist`，source `builtin`），不猜测、不扣额度。
- 热度值解析 `parseHeatValue`：官网返回 `920.8w / 11.9万 / 2.3亿` 等中文格式，统一解析为数值。
- 前端 Base URL 默认 `https://redfox.hk`；研究页平台下拉扩至 9 个（新增快手、今日头条）。
- 保留：服务端 AES-256-GCM 加密、前端不带明文 Key、日志脱敏、账号配置隔离、无 Key 演示双轨。
- 测试：`server/redfox.test.mjs` 重写（官网契约 21 项）、`server/redfox-skills.test.mjs` mock 上游改官网路径、`server/api-settings-api.test.mjs`、`server/settings.test.mjs` 同步更新。

### 2. 多用户账号体系与数据隔离

- 新增 `users` 集合：注册（用户名 2-32 位 + 密码 ≥8 位，scrypt 加盐哈希）、登录，会话绑定真实 `user_id`。
- 生产环境默认账号制：未登录访问任何 `/api/*` 返回 401（`registration_open: true`）；开发/测试模式保留免登录行为。
- 数据按 `owner_id` 全链路隔离（存量机制，此前所有用户共享 `owner`，本次打通）。
- 兼容：桌面端旧"访问密码"通道保留——设置 `PRODUCT_ACCESS_PASSWORD` 后仍以 `owner` 身份登录。

### 3. 共享 API Key 与每日额度（费用护栏）

- 服务器级共享 Key（`.env.production`，不入库）：`PROJECT_REDFOX_API_KEY` + `REDFOX_API_URL` 作红狐兜底；`PROJECT_LLM_BASE_URL / PROJECT_LLM_API_KEY / PROJECT_LLM_MODEL` 作大模型兜底（`runtimeConfig` 的 `text_primary` 槽位）。内测用户零配置即可用真实数据与 AI 能力。
- 每人每日额度（北京时间零点重置，持久化于 `usage_daily` 集合）：`REDFOX_DAILY_LIMIT=5`（热搜/搜索/对标/关键词热搜/刷新）、`LLM_DAILY_LIMIT=20`（改写/适配/复盘/提炼）。设为 0 表示不限。
- 只在使用共享 Key 时计数；用户在 API 中心配置自己的 Key 后自动豁免。超额返回 429 与可行动提示。
- `GET /api/usage/today` 查询用量；API 中心顶部展示"今日共享额度"。
- 测试：`server/quota.test.mjs`（共享兜底、超额 429、自有 Key 豁免、用量查询）。

### 4. 体验闭环（对标 Easel 五层工作流补缺）

- **发布中心**（新导航页）：母版草稿 → 9 平台版本适配（`POST /api/drafts/:id/adapt`，LLM 或规则兜底 `server/growth.mjs`）+ 平台发布检查清单（自动含字数与违禁词检查）+ 一键复制标题/正文/标签。刻意不做自动发布（规避平台风控）。
- **内容日历**（新导航页）：`GET /api/calendar?month=` 聚合草稿/拍摄/已定选题；`planned_date` 字段（草稿、拍摄 PUT 均支持，格式校验 YYYY-MM-DD）。
- **归因复盘闭环**：`POST /api/performance-snapshots/:id/retrospect` —— 快照指标 → AI/规则复盘（verdict: winner/ok/underperformed + 可复用经验）→ 自动沉淀 feedback 记忆（去重），下次草稿生成注入。指标字段按关键词模糊匹配（播放/点赞/评论/收藏/转发，中英文均可）。
- **去 AI 感改写**：`POST /api/drafts/:id/deai`，LLM 改写 + 风格记忆注入，前端预览后确认替换。
- **定位匹配度**：`GET /api/research?sort=fit`，按定位档案（身份/支柱/受众/问题 + 平台偏好 + 新鲜度）打 0-10 分并展示匹配原因。

### 5. 记忆自动提炼接通 LLM

- `/api/memories/extract` 从固定 422 桩改为真实实现：粘贴对话/访谈文本 → 主备大模型提炼 style/topic/feedback 记忆 → 去重入库（source `auto`）。未配大模型时保持 422 `llm_not_configured`。前端记忆面板新增提炼文本框。

### 6. 反馈通道（内测）

- `feedback` 集合 + `POST/GET /api/feedback`、`PUT /api/feedback/:id`（状态：open/acknowledged/resolved）。
- 左侧导航 IP 档案下方新增"反馈"入口（弹窗）：Bug 反馈 / 功能建议、自动附带当前页面、提交人、UA；用户看自己的反馈与状态进度。
- 管理员：`.env.production` 配 `ADMIN_USERNAMES=用户名1,用户名2`，该用户可看全部反馈、更新状态；左侧"反馈"按钮显示待处理角标。
- 测试：`server/feedback.test.mjs`。

### 7. 服务器日志

- 新增进程级崩溃日志：`uncaughtException` / `unhandledRejection` 处理器写入 `logs/crash.log`（`uncaughtException` 记录后退出交由 pm2 拉起）。
- `/home/ubuntu/content-ip-workbench/logs/`：`app-access.log`（请求流水）、`app-error.log`（业务异常堆栈）为 pm2 日志软链，附 `README.txt` 说明常用查询命令。

### 8. 修复

- `src/main.tsx` `ProfileHistory.changed_at` 类型错误（曾阻塞全量验证）。
- 红狐热榜热度值中文格式解析（`920.8w`）。

### 9. 部署与验证

- 线上：`content.woyai.cn`（pm2 `content-ip-workbench` + MySQL `content_ip_workbench` + Nginx HTTPS），共享 Key 已配置并实测（真实小红书热榜、agnes 大模型四功能全通），额度计费准确。
- 质量门：149/149 自动化测试 + 类型检查 + 生产构建全绿；新增测试文件 `closure/quota/feedback.test.mjs`。
- 已知边界：桌面端 exe 仍走旧访问密码通道（内测建议用浏览器）；`/api/topics` 无 GET 列表接口（前端不需要，无害）；旧 `owner` 数据（10 条研究 + 4 条草稿）保留在 owner 空间。
