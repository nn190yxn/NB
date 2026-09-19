# dbskill 技能覆盖清单（2026-09-19 核对）

这份清单回答一个问题：Alex 手上那套 dbs 技能，哪些已经并进平台、哪些还没并、哪些不适合并。

核对方法（两条证据，不靠记忆）：

1. 本地已装技能：`C:\Users\Alex\.agents\skills\dbs-*\SKILL.md`，共 **28 个**；
2. 平台侧：`server/` 下各模块首行的来源注释，以及 `README.md` 里写明「用的是 dbs-xxx」的段落。

（`dbs-content-risk-check` 不在本地已装列表里，是从 GitHub 源仓库取的，已并入。）

---

## 一、已并入（10 个）

| 技能 | 并到哪 | 证据 |
|---|---|---|
| `dbs-ai-check` | 去 AI 味：22 条特征骨架 + 句子级判据 | `server/ai-features.mjs`、`server/draft-checks.mjs` |
| `dbs-resonate` | 发布前共鸣报告（五维）+ 主张提取 | `server/resonance.mjs`、`server/claims.mjs` |
| `dbs-spread` | 发布前共鸣报告（传播心理维度） | `server/resonance.mjs` |
| `dbs-deconstruct` | 拆概念（维特根斯坦式审查） | `server/deconstruct.mjs` |
| `dbs-script-flow` | 结构层逻辑延续检查 + 发布前逐字稿三维检查 | `server/structure-flow.mjs`、`server/script-flow.mjs` |
| `dbs-hook` | 开头多方案 + 开头六维诊断 + 素材丰富度检查 | `server/hook-diagnosis.mjs` |
| `dbs-xhs-title` | 标题公式库（小红书 75 条 + 抖音/视频号两套） | `server/title-formulas.mjs` |
| `dbs-content-risk-check` | 发布前风险检查（机器信号 + 实质问题两层） | `server/publish-risk.mjs` |
| `dbs-wechat-html` | 公众号排版（15 个风格，内联样式 HTML） | `server/wechat-html.mjs`、`server/wechat-styles.mjs` |
| （`dbs` 主入口） | 新手教程 / 任务前路由 / 任务后导航三种模式 | `server/guide.mjs` |

## 二、平台已有等价功能，不必再并（1 个）

| 技能 | 平台现状 |
|---|---|
| `dbs-save` / `dbs-restore` | 平台已有草稿版本历史、撤回定稿与恢复（`server/draft-restore-api.test.mjs`、`draft-archive-api.test.mjs`），覆盖了「存档 / 取回」这件事 |

## 三、明确没并、可能值得做（3 个）

| 技能 | 它管什么 | 和平台现状的关系 |
|---|---|---|
| `dbs-content-system` | 内容体系：支柱 × 目标 × 平台的整体排布（不是单条选题） | 平台有单条选题生成和结构库，缺「一个月的整体内容体系」这一层 |
| `dbs-good-question` | 提问能力：把模糊问题变成能回答的问题 | 可接在定位访谈与 AI 追问那一环，提升访谈质量 |
| `dbs-knowledge` | 知识管理：把散落的记录整理成能调用的东西 | 平台有 AI 记忆与方法库，但这是更系统的整理层 |

这三个我只按技能名和平台现状分类，**还没逐条读细节**。要做哪个，我再读它的 SKILL.md，先说清能给你什么、接在哪一环，再动手。

## 四、名字对得上、但不确定是不是照它做的（5 个）

这五件事平台都做了，但 `server/` 里没有它们的来源注释，所以我不能说是「已并入」，也不能说是「缺口」：

| 技能 | 平台里对应的事 | 需要核对什么 |
|---|---|---|
| `dbs-content` | 初稿生成（`server/draft-writing.mjs`） | 生成规则照的是这份技能，还是平台自己长出来的 |
| `dbs-benchmark` | 对标（红狐账号搜索 + `scripts/import-benchmark.mjs` 导入器） | 导入的是资料，有没有它的分析方法 |
| `dbs-diagnosis` | 定位（4 步访谈 + `server/positioning-generation.mjs`） | 访谈问题集与判定标准是否覆盖了这份技能 |
| `dbs-goal` | 目标（草稿上的 `goal_refs`） | 目标体系是否按它的分层做的 |
| `dbs-report` | 复盘回流（`server/return-flow.mjs`） | 复盘报告的口径是否照它 |

## 五、不适合并进内容生产流程（9 个）

| 技能 | 为什么不并 |
|---|---|
| `dbs-action`、`dbs-decision`、`dbs-learning`、`dbs-slowisfast` | 是你的思考与决策方法，不是内容生产步骤；硬塞进流水线只会变成摆设 |
| `dbs-bridge` | 跨域连接，偏个人思考工具 |
| `dbs-chatroom`、`dbs-chatroom-austrian` | 多角色聊天室，是独立玩法，不是工作台的一个环节 |
| `dbs-agent-migration`、`dbs-skill-cleaner`、`dbs-update` | 技能仓库自身的维护工具，和内容生产无关 |

---

## 下次要接着做什么

按这份清单，只有三件事是「确实没做、也可能有用」的（第三节）。
第四节那五件要么核对后归入「已并入」，要么变成新的候选——核对成本比开发低，建议先核对再决定。
