# 更新记录（CHANGELOG）

## 2026-09-14 · 平台字数改成确定性检查（不再依赖提示词）

- **问题**：提示词写了「小红书 400-800 字；抖音、视频号是口播稿且不超过 250 字；公众号 600-1200 字」，但模型并不遵守——实测新稿抖音 384 字、视频号 483 字（上限 250）、公众号 514 字（下限 600），改前的旧草稿（抖音 338 / 254、视频号 531 / 275）同样违规。无法验证的提示词约束等于没有约束。
- 文件：`server/draft-writing.mjs`、`server/draft-checks.mjs`、`server/draft-checks.test.mjs`。
- 单一来源：`server/draft-writing.mjs` 新增并导出 `draftLengthTargets`（小红书 400-800 / 抖音 ≤250 / 视频号 ≤250 / 公众号 600-1200）与 `draftLengthRange()`，数字只写一份。
- 确定性校验：`checkQuality` 新增 `platform_length` 证据项，用正文实际字数对照目标，超出或不足时给出「正文 384 字，抖音目标不超过 250 字」与「把正文调整到不超过 250 字」。复用现有检查 UI（草稿卡「质量门」的证据列表与建议行），未新增界面元素。
- 提示词文案一字未改，但新增测试断言提示词里的数字与 `draftLengthTargets` 一致，防止两处各说各话。
- **刻意选择 warning 而不是 blocked**：字数不合平台偏好不代表不能发布，硬拦会让「质量门通过才能进入拍摄与发布」这条链路卡住真实内容；也没有自动截断或重写正文（会破坏他的表达）。质量门状态与评分不变，只在证据与建议里如实说明。
- 验证：188/188 测试（新增 2 项：字数警告行为、提示词与检查表数字一致）；用真实草稿做纯函数计算（不写回数据）核对：#46 抖音 384 字、#47 视频号 483 字、#48 公众号 514 字都会告警，#45 小红书 507 字与 #37 567 字不告警。
- 待办：提示词里的「开头第一句直给冲突或结论」同样没被模型遵守（新稿仍用设问开头），目前也只能靠生成后检查发现。


## 2026-09-14 · 端到端验证：真实大模型生成跑通

前面两轮的改动全部只用 mock 验证过，这轮用真实模型跑通了一次完整生成（已确认选题 topic_id=1）。

- 结果：`POST /api/drafts/generate` 返回 201，耗时 11.7 秒，`provider: primary`（用他账号自己配置的 agnes-2.5-flash，未消耗服务器共享额度），一次产出小红书 507 字 / 抖音 384 字 / 视频号 483 字 / 公众号 514 字四份正文（草稿 #45–#48）。
- **新简报结构在真实调用里生效**：`generation_context.brief` 字段为 `…, style, mechanisms, platforms`，其中 `style: []`（预期：原有 9 条全是对标机制）、`mechanisms` 9 条且 `source` 全为「对标dbs」、`quotes: []`（本次未选素材）。
- **最大风险已排除**：新增的三条提示词规则没有破坏模型输出，仍返回可解析的 JSON，四份正文都不是提纲、不是占位。
- 验证方式：本地 API 已重启到最新代码，脚本读真实接口数据比对（不与 mock 混用）。

### 顺带发现的既有问题（非本轮引入）

- **长度区间提示词形同虚设**：提示词写明抖音/视频号不超过 250 字、公众号 600–1200 字，改前的旧草稿就已违规（抖音 338 / 254 字、视频号 531 / 275 字），本轮新稿同样违规（抖音 384、视频号 483），公众号这次只有 514 字（低于下限）。属于模型不遵守长度约束的既有问题，需要单独处理（例如生成后按平台做长度校验并给出警告，或把长度写成更硬的约束）。
- 提示词要求「开头第一句直给冲突或结论」，新稿仍出现设问式开头。同一类问题。


## 2026-09-14 · 素材库标出对标出处并可直接读正文

- **缺陷**：素材库里 33 条对标 dbs 素材（11 金句 + 9 句式 + 13 洞察）全部显示「来源：手动创建」，来源信息只藏在名称「对标dbs·金句」里，界面等于在暗示这些是他自己的素材——直接抄有洗稿风险。
- **更严重**：原子素材的正文在素材库界面里**根本不显示**（正文只进 `content`，列表只渲染名称与元信息，展开区只读 `extracted_fields`，而原子素材的该字段是空的）。等于他看不见自己的金句库。
- 文件：`server/index.mjs`、`scripts/import-benchmark.mjs`、`src/main.tsx`、`src/styles.css`、`server/benchmark-memory-api.test.mjs`、`server/web-assets.test.mjs`。
- **来源标注**：`POST /api/materials/atoms` 接受可选 `source_label`；导入器给原子素材带上资料包的 `source_label`。界面每行显示「来源：对标dbs」，分组表头写明「对标素材，不是他的话，别直接抄」。
- **旧数据不迁移**：界面用 `materialSourceLabel` 读取，优先 `source_label`，回退到名称里「·」前的部分；不适合「·」的普通文件名不会被误判成来源（已用接口数据验过）。
- **正文可见 + 悬停看全文**：新增 `.material-text`（两行截断）+ `title` 属性，长金句悬停可看全文。
- **分组折叠**：素材库按名称分组（对标dbs·金句 / 对标dbs·句式 / 对标dbs·洞察），每组用 `<details>` 可折叠并显示条数，组内保留原有全部行交互（展开详情、收为素材、删除）。非原子素材归入「文章素材」，一篇文章不会各自成组。
- **句式自带类型标签**：句式的类型就写在正文末尾括号里（数字冲击开场 / 量化损失 / 设问反转…），界面把它抽成标签展示，不改动正文数据。
- 验证：186/186 测试（新增对标素材来源标注 1 项，web-assets 补素材库与记忆层断言）、`tsc --noEmit`、生产构建通过。本地 API 已重启，并用真实数据核对：33 条素材分成 12/9/13 三组，句式标签抽取正确。
- 待办：仅出现在本机数据里的来源标注未回填到 `source_label` 字段（读取时回退，不改数据）；素材上传走浏览器 `readAsText` 导致 PDF/DOCX 读成乱码的老问题仍未修。


## 2026-09-14 · 分离「对标机制」与「自有表达」（style 字段错位）

- **缺陷**：`buildDraftBrief` 把 9 条 dbs 打法记忆塞进 `style`，而提示词写着「style 是创作者本人的表达习惯，必须遵守」——对标账号的机制被当成他本人的表达习惯；这 9 条 `source_refs` 全为空，没有任何来源标记。同一批 dbs 知识在 `structures` 里还有一份拷贝，但只有选中 `structure_id` 才生效（存量 8 条草稿 `structure_id` 全为 null）。
- 文件：`server/draft-writing.mjs`、`server/index.mjs`、`scripts/import-benchmark.mjs`、`scripts/benchmarks/dontbesilent.json`、新增 `scripts/migrate-benchmark-memories.mjs` 与 `server/benchmark-memory-api.test.mjs`、`server/draft-writing.test.mjs`、`server/materials-atoms.test.mjs`、`src/main.tsx`、`src/styles.css`。
- **简报分层**：`style` 只放他本人的表达习惯（style/feedback）；新增 `mechanisms`（对标机制，每条带 `source`）；`quotes` 由字符串改为 `{text, source}`，来源取自素材原子名称（如「对标dbs·金句」）。提示词分别规定：style 必须遵守；mechanisms 可照用结构与节奏但不能写成他的习惯；quotes 只能当引用且必须写出 source 给的来源；两者为空时不许提对标、不许虚构来源。
- **记忆新增类型 `benchmark`（对标机制）+ `source_label`**：`POST /api/memories` 建对标机制必须带来源（否则 422）；`PUT /api/memories/:id` 支持改类型与来源，用于纠正错记。自动提炼仍只产出 style/topic/feedback，对标机制只能从资料包导入或手工录入。
- **导入器**：资料包 `memories` 统一按 `benchmark` + `pack.source_label` 导入，不再沿用包里的 `memory_type`（旧包把它写成 style/topic，正是错位的来源）；去重键从「类型+内容」改为按内容，避免重跑产生同内容的重复记忆。
- **存量迁移**：`scripts/migrate-benchmark-memories.mjs` 按内容与资料包精确匹配（不猜测），把错记的 9 条（8 条 style + 1 条 topic）改为 benchmark + 「对标dbs」，幂等、支持 `--dry-run`。已在本地执行：9 条全部迁移，二次执行无改动。
- **界面标来源**：记忆面板新增「对标机制」标签、筛选与类型下拉，建对标机制时要求填来源，列表显示来源；草稿卡新增「写作依据」，列出本次用到的对标机制/对标原话（含来源）、他自己的表达习惯与经历条数。存量草稿的简报是旧口径，会显示「旧记录未区分对标机制」，不把机制冒充成他的习惯。
- **连带**：平台适配原来是通过 style 记忆吃进对标机制的，改为独立的 `mechanism_memories` 字段并在提示词里注明边界，避免能力静默消失。
- **影响**：迁移后他的 `style` 为空（原有 9 条全是对标机制），新生成的草稿 `style` 会是空数组，直到他自己录入表达习惯。这是预期结果，不是丢失数据。
- 验证：185/185 自动化测试、`tsc --noEmit`、生产构建 1818 modules 通过；本地 API 已重启并跑完迁移。未跑真实大模型端到端生成（会消耗额度并产生真实草稿）。
- 待办：`structures` 里那份 dbs 拷贝与 memories 仍有重复，本次未合并；真实生成待手动验。


## 2026-09-14 · 提交记录：草稿槽位选择器与开头机制收敛

- 提交：`93070f0` `feat-draft-slots-and-llm-written-body`，28 个文件，+1084 / -239。
- 仓库既有约定是 ASCII 短横线标题（`docs-record-...` / `fix-user-journey-...`），本次沿用；中文细节放在本文件与任务 README。
- 中文提交信息在 GBK 终端下会被写坏，已改用 Node 以 UTF-8 写消息文件再 `git commit -F`，并回读校验字节无替换字符。
- 未做 hunk 级拆分：`server/index.mjs`、`src/main.tsx`、`server/generation-test-helper.mjs` 同时承载「正文改由大模型撰写」「工作台布局与归档」「槽位选择器与开头机制收敛」三项改动，按文件拆分会得到测试不过的中间提交，故合并为一次提交。



## 2026-09-14 · 草稿槽位选择器（标题改法 / 开头句 / 正文结构 / 结尾）

- 新增：`server/draft-slots.mjs`、`GET /api/draft-slots?platform=`、`POST /api/drafts/:id/slots/:slot`；新增测试 `server/draft-slots.test.mjs`（8 项）、`server/draft-slot-api.test.mjs`（2 项）。
- 文件：`server/draft-slots.mjs`（新增）、`server/index.mjs`、`server/generation-test-helper.mjs`、`src/main.tsx`、`src/styles.css`。
- **设计**：槽位是“生成后”用的——选中一个写法只重写对应那一段，不重写全篇。标题改法是**整组作用域**（同 `variant_group_id` 的四条平台草稿一起改）。
- **目录来源**：标题 8 种改法为内置（5 种来自对标 dbs 句式 + 3 种自有）；开头句 / 结尾 / 内容骨架直接从爆款方法库按 `content_type` 取（要求有 steps）；正文结构拆为「平台体裁（内置 4 条，来自现有分平台长度与口播约束）」+「内容骨架（母模板）」。每个选项都标 `对标dbs` / `自有`。
- **不扣额度**：槽位目录接口不调大模型；只有确认改写才调，并计入共享额度。
- **真实数据验证**：用线上 18 条方法库跑抖音平台目录 —— 标题 8 / 开头 4（dbs 四种开头范式）/ 结尾 3（金句复现、社会反思、行动号召）/ 正文结构 2（抖音口播三段 + 爆款四段式骨架）。
- **修正的缺陷**：正文首尾段原本按空行块切分，而真实正文中「正文：」标题行与第一段同属一块，会把“改开头”改到中间段；改为按行定位（先跳过「标题：」「正文：」行）。
- **收敛重复的开头机制**：删除规则引擎硬编码的 4 条 Hook 候选与 `POST /api/drafts/:id/hooks` 路由，开头统一由「开头句」槽位（方法库开头范式）确定；发布清单的 `selected_hook` 项与质量项的 `hook_clarity` 改为 `opening` / `opening_clarity`，以 `drafts.opening_ref` 为准，旧记录里的 `selected_hook` 继续兼容；能力目录中 `hook_generate` 替换为 `opening_choose`。前端删除「生成 Hook / Hook 候选」入口。
- 验证：183/183 自动化测试、`tsc --noEmit`、生产构建 1818 modules 全部通过。未做真实大模型端到端改写（会消耗额度并改动真实草稿）。
- 提交：`93070f0 feat-draft-slots-and-llm-written-body`（含本页上一轮的工作台布局与正文由大模型撰写）。

前一轮的工作台布局、手动归档、正文改由大模型撰写与本次槽位选择器同处 `server/index.mjs`、`src/main.tsx`、`server/generation-test-helper.mjs`，无法按文件拆成各自独立可运行的提交，故合并为一次提交。




## 2026-09-14 · 内容创作页改为工作台布局，新增手动归档

- 文件：`src/main.tsx`、`src/styles.css`、`server/index.mjs`、`server/draft-workflow.mjs`、`server/auth.test.mjs`、新增 `server/draft-archive-api.test.mjs`。
- **布局**：内容创作页由双列网格改为「左列表 + 右全宽编辑器」两栏工作台（`.draft-workbench`）。左栏按选题分组列出草稿（平台、字数、归档/变体标记、状态），带 进行中 / 已归档 / 全部 筛选；右栏是全宽编辑区。原卡片 JSX 未改写，仅把它从网格卡片改为右侧面板。窄屏（≤1100px）自动退回上下堆叠。
- **手动归档**：新增 `POST /api/drafts/:id/archive`，body `{archived: true|false}`。只写 `archived_at`，**不递增 version、不写 history、不重置 checks/approval**，避免归档这个纯视图动作让已通过的检查失效。`archived_at` 进入 `defaultDraftWorkflowFields` 归一化，旧记录自动补 `null`。
- **手动加变体**：`POST /api/drafts/:id/copy` 的产物现在标记为 `variant_type: 'manual'` + `variant_of: <源草稿 id>`，标题后缀由「（副本）」改为「（变体）」，前端按钮改名为「复制成变体」。保留 `variant_group_id` 以维持发布前检查通过。
- 验证：171/171 自动化测试（新增 2 项：归档不改版本/检查/确认状态、变体复制保留变体组）、`tsc --noEmit`、生产构建（1818 modules）全部通过。



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
