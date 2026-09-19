# 风格派个人IP内容平台（定位派内容工作台）

**作者：Monkeycode**

面向个人 IP 创作者的一站式内容工作台：定位发现、热点研究、素材管理、选题生成、多平台草稿、爆款方法、拍摄执行与 AI 记忆。Web 工作台 + 手机 PWA 双形态，支持七个内容平台（全平台/小红书/抖音/视频号/公众号/B站/微博/X）。

本文档面向所有后续接手本项目的开发者与 AI Agent，读完即可独立开展开发、验证与部署。

## 单步路由与全量验收（2026-09-18）

作者：Monkeycode。

新手进来不该对着一堆面板发愁，所以加了一条单步路由（`GET /api/guide`）：链路是定位 → 素材 → 对标 → 结构库 → 选题 → 初稿 → 诊断改稿 → 定稿 → 拍摄 → 发布 → 回流十一章，每一章回答一个问题、给一个动作。界面只把「下一步」摆到最前面，但所有环节都带完成状态一并返回，想跳哪就是哪，不强制线性。

三种模式照 `dbs` 主入口：一条都没做是「新手教程」，做到一半是「任务前路由」，链路走完是「任务后导航」。定位、素材、对标全空的时候一并给降级路径（先做小样本 / 先收缩边界 / 直接用纯选题生成一版没素材的初稿），并说清缺什么、补上能得到什么。

判定「做过没做过」只看你手上真实存在的东西，不看你自己说到哪了；定位只认你自己写的那份文档，演示数据不当成你做过。

今日工作台挂了 `NextStepCard`：空账号显示「新手教程」，下一步只突出定位，缺定位/素材/对标时给出三条降级路径。点定位进访谈，点拍摄进今日拍摄，其余环节可跳、不强制线性。测试端口全部下移到 49152 以下（见下方坑位说明）。

## 双通道回流（2026-09-18）

作者：Monkeycode。

判据不再由系统发明。两条通道都只出**候选**，要你点了确认才生效。

终稿回流比的是「最早留下的那一版」和「你确认的那一版」，只数数得出来的差分：改长了还是改短了、删掉哪几句、自己加了哪几句、开头选了哪一种，每条给一个观察加一句可以改写的偏好提议（删掉的多是解释句，就提议「少解释，判断说完就走」）。数据回流只认确认过的发布表现，按平台比最好和最差，得出下一轮选题该往哪偏；待确认的表现数据不参与，不拿没核过的数字改选题。

已产出过的候选不会重复问第二遍（拒掉的也留痕）。确认时还可以指明它替换掉 22 个通用语言特征里的哪一条，`GET /api/preferences` 会回一份替换清单，替换过程可回溯。确认和拒绝都只改偏好记录，草稿正文、版本、检查、确认状态一律不动。

## 公众号版本（2026-09-19）
作者：Monkeycode。

发布面板加了「公众号版本」，用的是 dbs-wechat-html：把定稿的标题和正文渲染成能直接粘进公众号后台的 HTML，内置 15 个风格（极简黑白、Medium、Stripe、WIRED、FT、课程讲义、Apple、GitHub README、Notion 等），CSS 逐条取自源技能文件，不手抄。

**关键约束**：微信后台会剥掉 `<style>` 标签和 class，所以这里把 CSS 全部转成每个标签上的内联 `style`，复制过去直接粘就行。为此写了一个只认源文件那套扁平 CSS 的小解析器。

**排版规则**（源技能的 11 条）：连续列表项合并成一个列表、段内单换行并成空格、不生成 `<br>`、图片只留 `[图片：描述]` 占位、表格降级成列表（表头算内容、分隔行丢掉）、外链只留文字、特殊字符转义。

源技能还有一条「去掉段落末尾的中文句号」，**按 Alex 的决定关掉了**：排版不改他写的标点。

**这一层只排版**：不改观点、不润色、不调模型、不花额度、不改草稿任何字段。伪元素（标题前的小横条、列表序号）没法内联，用等价的 span 顶上，做不到的在面板里写出来说明。

样式数据在 `server/wechat-styles.mjs`，由 `scripts/extract-wechat-styles.mjs` 从源技能文件抽取生成；上游更新后重跑那个脚本即可。

## 发布前风险检查（2026-09-19）

作者：Monkeycode。

发布前那一块再多一份「发布前风险检查」，用的是 dbs-content-risk-check 的两层判断：一、平台机器可能识别到什么（完整外链、手机号、站外联系方式、二维码、连续长数字、导流动作、绝对化说法、医疗功效词）；二、内容本身有没有实质问题。规则先把词面信号扫出来，完整语义和独立证据交给模型判——**词面只负责召回线索，不负责定性**。

三道卡防编造：层级只认「建议优先处理 / 可能触发机器审核 / 发布前确认」三个；每条引用的原句必须在稿子里逐字找得到，编一句「原文」出来这条就不成立；贴片小字必须是三行、每行 4 到 9 个汉字，对不上整份不要，也不替它凑。

源技能的规矩也写进了提示词：机器误伤只能写成「可能触发机器审核」，不许补造一个违规原因；强观点、情绪、口语、夸张修辞本身不是风险，不许以「更稳妥」为由建议改；不预测违规概率，不写「能发 / 不能发 / 保证通过」；只给最小修改动作，不给谐音、拆字、暗号这类绕审写法。跟另外两份报告一样**只提醒、不拦发布**。

这个版本没有动已有的「质量与合规检查」：它仍然是关键词命中就走门禁，语义层判断交给这份新报告，两件事分开。

## 逐字稿衔接检查（2026-09-19）

作者：Monkeycode。

发布前诊断区除了共鸣报告，多了一份「逐字稿衔接检查」，用的是 dbs-script-flow 的三维检查法：段落衔接、信息密度、口播流畅。规则先把能数的数出来（分了几段、超过 30 字的单句几处、书面语字眼几处、哪几句在重复表述），判定交给模型，每条结论必须落到具体段落号和文稿原句上；段落号越界、判定不在档位、指不到原句的整条丢掉。

源技能拿「观众会在哪一秒划走」当说法，这里不这么写：只描述文稿本身（这一段到那一段缺不缺过渡、哪句念不出来），**不预测完播率、点击率、推荐量**——那是平台指标，判不了也不该拿来当结论。跟共鸣报告一样，这份检查**只提醒，不拦发布**：不写检查、不改工作流状态、不动确认状态。报告连同四组改法（补过渡、删、合并、改口播）挂在草稿上，正文一改就提示这份检查是基于旧版本做的。

## 拍摄衔接与发布前共鸣报告（2026-09-18）

作者：Monkeycode。

确认定稿就是进拍摄的那一步：确认时把定稿那一版正文冻进拍摄项的 `script`，之后再把草稿改来改去也不会漏进提词器；想改稿得先撤回定稿，撤回只是把可拍状态收回去，拍摄稿不动。这一块原来就有，这个版本补了测试把它钉住。

发布面板多了一份「发布前共鸣报告」，用的是 dbs-resonate 的五维共鸣与 dbs-spread 的传播心理——两个技能用的是同一批经典传播学理论，所以合成一份：沉默解除、满足动机、立场框架、传播入口、信念结构，每条给判定（有效/弱/无效）、指向哪句原文、以及受众那一侧的解码；另外给核心机制审查（判断句多了会提示核心被稀释）和改法（删什么、压什么、放大什么）。

按源技能的硬规矩，判定不在三档内、维度不认识、指不到原文原句的整条丢掉，不替它编。这份报告**只提醒，不拦发布**：不写检查、不改工作流状态，发布流程不会因为它停下来。

## 标题公式库与开头多方案（2026-09-18）

作者：Monkeycode。

标题不再只给一条：从抖音、视频号各 75 条标题公式里出多个方案，每条带公式编号、心理触发器分类、原始举例和「为什么选这条」；编号对不上的方案一律丢掉，不给编的。举例全部是源技能里的小红书原例并标清来源——源技能没给抖音/视频号版本，这里没有编造平台版。

开头按 dbs-hook 的做法走：先做素材丰富度检查（冲击力数据、转变故事、金句、权威背书、痛点共鸣五类），一类都没有就直接停，不拿模型硬编开头；素材够才出方案，每条标出用了三种方法（素材提取、素材增补、悬念制造）里的哪一种。开头六维诊断里独立性、匹配度要读懂语义，规则判不了就如实留白，不猜。

方案都在草稿编辑区的「标题与开头方案」面板里，点「用这个」才落进草稿，并记下选的是哪条公式或哪种方法。正文一改，旧方案整批作废。

## 内容创作改写行为（2026-09-17）

作者：Monkeycode。

「按检查意见改写」不再只看模型回没回话：改完先和原稿比一次——不许越改越短（原稿没超平台上限时，新稿不得低于原稿 85%；用户明确要求变短时不设下限），被点名的问题必须在同一套检测下严格减少。任一不过就带原因重写一次，再不过返回 502 且不改库，界面会把原因原样显示出来。


## 内容字数与写作判据（2026-09-17）

作者：Monkeycode。

抖音、视频号短视频目标改成 300-900 字（原上限 250、下限 0，写 80 字也算合格；旧改写一路压到 201 字），时长口径约 1–3 分钟；中视频 400-1000、长视频 600-1500、小红书 400-1000、公众号 1000-2500 不变。数字只写在 `server/draft-writing.mjs`，前端 `src/main.tsx` 有一份必须同步的副本，漂移会被 `server/web-assets.test.mjs` 拦下。

新增两条确定性判据，同时接在生成验收、质量门证据与「按检查意见改写」的改写指令上：`platform_mixup`（正文出现当前平台之外的其他平台名）、`method_talk`（「拆成N块 / 分成N个部分 / 裂变 / 一鱼多吃 / 同一内核 / 多平台分发」这类方法骨架）。只抓能确定判的骨架词；正文换别的话讲方法论仍拦不住，那需要模型评审或人工看。这两条判据的改写指令用「换成具体内容、字数不要变少」，不是「删掉」——只删句会让稿子更空。另有 ai_tone_phrase、vague_case、no_concrete_support 三条去 AI 味判据：前两条命中即拦停重写，第三条只对 120 字以上、通篇没有一个数字或具体场合的稿子生效。句子级还有 triple_list（凑数三连）、golden_tail（段尾金句）、generic_ending（万能结尾）、ing_tail、avoid_copula、fake_rebuttal、connector_abuse 七条；除 connector_abuse 要出现两种以上书面连接词外，其余都是单点命中即拦。整篇重写改不动时用草稿页的「定位替换」：模型只回替换对，服务端校验（原句唯一、不是原样、不越改越短）后按句换进正文，其余一字不动，接口是 POST /api/drafts/:id/replacements。同一条问题只出一行建议（按 evidence code 去重，文案只有一份来源）。档案字段（服务对象、内容支柱）全都超过 12 字时不再算正文不合格，只在面板里提醒改档案——那种写法正文永远不会原样出现，判据会一直命中。这些判据都拦不住换一种说法的方法腔，那仍需要模型评审或人工看。这两条判据的改写指令用「换成具体内容、字数不要变少」，不是「删掉」——只删句会让稿子更空。

确定性判据在 `server/draft-checks.mjs` 的 `checkReviseOutcome`，接入点在 `server/index.mjs` 的 `POST /api/drafts/:id/revise`；回归见 `server/draft-revise-outcome.test.mjs`。

## 当前发布状态（2026-09-07 · 用户旅程修复）

作者：Monkeycode。

- 三批修复已部署至 `https://content.woyai.cn`：配置持久化白名单、访谈恢复与失败保护、模型定位和选题闭环、草稿保护、真实首页与复盘反馈、搜索刷新、账号重登和桌面账号协议。
- 账号同步队列改为分账号存储，归属不明的旧队列保留但不会自动上传；策略保存失败不再显示成功。
- 验证：串行全套测试 163/163、TypeScript/生产构建通过；本地模拟 API 浏览器验证访谈与草稿的失败恢复。生产登录页、新资源和 MySQL 健康检查通过，三个后端文件及首页文件哈希与本地一致。
- 备份：`/home/ubuntu/content-ip-workbench/deploy-backup-20260907-231225-user-journey`，含代码和校验通过的 MySQL 压缩备份；没有替换环境配置、用户数据、私有文件或其他项目。
- 边界：未调用真实付费模型，未做真实账号配置的 MySQL 重启回读验收；桌面源码已修复，但既有安装包不会自动获得新 IPC，尚未重新打包及完成 Electron 真机验收。
- GitHub：修复提交 `ff24abb` 已推送至 `origin/main`；发布回执随文档提交同步。后续安排桌面新包和上述真实环境验收。以下第一、二批段落保留为历史过程记录，以本节状态为准。
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

当前内测版本已完成红狐官网 API、多用户账号与数据隔离、服务器共享 API Key 及每日额度、发布适配/复盘闭环、记忆自动提炼和用户反馈通道。账号首次登录会自动进入 4 步定位访谈，可稍后填写并从“定位发现”继续；首页不再展示固定演示身份和示例选题。质量门当前为 322 项自动化测试、TypeScript 检查和生产构建。

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
server/*.test.mjs     # Node 原生测试（当前全量 322 个，含 desktop）
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

完整链 = `node --test`（当前 322 个测试，使用独立临时 DATA_FILE，不碰真实数据）+ `tsc` 类型检查 + Vite 生产构建。全部通过才允许交付。

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

## 2026-09-17 · 按检查意见改写这一条

人设检查或质量门没过时，检查栏有「按检查意见改写」：把字数、设问开头、咨询腔、编客户这些问题直接拿去重写这一条。开头句槽位、来源引用、档案里的长句短词，改写管不了，还是要你点。空检查或只有槽位问题会 422，不改库。

质量门没过会把草稿标成要改。检查栏写成「要改」；改写成功后是「内容已就绪」。左侧列表同一套说法，不再露出内部英文 `needs_revision`。

检查栏按钮以前在「没能改正文的意见、正文改过还没再查、有未保存改动」时是灰的，点了没反应。现在按钮能点：没保存、检查过期、只有槽位问题，红字写在按钮下面；真正改写时显示「改写中...」。

`POST /api/drafts/:id/revise` 在旧 API 进程上会落到「接口不存在」。前端改成「后台还是旧版本，关掉窗口重新打开后再试。」页面热更新不会带上 Node。

以前检查意见塞进 JSON 的 note 字段，模型只看见「改短」，就把稿子写成更简单的一版。现在用户消息逐条列出字数、设问、咨询腔、编客户，并写明保留原判断、不要另写一篇更简单的。咨询腔会点名要删的词。

验证：`npm test` 217/217 通过。未做真实模型 A/B。开头句仍要点。

## 2026-09-18 · 生成验收不过的稿子不再丢

作者：Monkeycode。

草稿生成时写作验收拦停（`platform_mixup`、`method_talk` 这类骨架判据命中），以前是重写一次仍不过就返回 502、整批稿子丢掉。现在稿子照常入库，`workflow_status` 标 `needs_revision`，验收理由记在 `generation_context.gate`（`failed` / `rewritten` / `summary`），用户可以直接在草稿页「定位替换」按句改，不必重新生成。

模型完全不可用或输出解析不出正文仍是 502 且不落库——那是没东西可救的情况。「按检查意见改写」不变，仍会在改不动时返回 502 `REVISE_NOT_IMPROVED` 且不改库。

验证：`node --test server/*.test.mjs desktop/*.test.mjs` 226/226 通过。A 方案与定位替换仍只在 mock 集成测试下验证，未跑真实模型端到端。
