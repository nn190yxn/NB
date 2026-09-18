# Requirements Document: 工作台重构（DBS 内核路线）

Feature Name: content-workbench-upgrade
Updated: 2026-09-18

## Introduction

现状问题有两层。表层是判据打架：生成阶段的拦停条件是 `writingIssues()` 任意一条命中，语言审美类判据与结构类判据拥有同等否决权，真实稿子被 `vague_case` 与 `case_claim` 互相卡死。里层是**判据用错了对象**——初稿被当成成品验收，所以「生成端要写足字数」和「审查端别啰嗦」必然对撞；而审美判据是我们自己发明的，没有标准答案，发明越多越互相矛盾。

本特性做三件事：

1. **把诊断从「审查」改成「取材」**。内容层判不了稿子里的价值，因为价值取决于素材、认知落差和定位——三样都在稿子外面。所以内容层前移成生成的前置：拆概念 → 提主张 → 取材 → 形式判断 → 选题把关。素材做扎实，编造从源头消失。
2. **把 DBS（dontbesilent）开源技能的内核移植进来**，用统一的「诊断五步形态」重建全部诊断：接收 → 分维度 → 出报告 → **问要不要改** → 确认后标记式改稿。我们缺的是第 4、5 步。
3. **平台收敛到抖音 + 视频号**，打磨好再复制到小红书与公众号。

判据不再由我们发明，而由两条来源提供：**DBS 的可溯源内核**（75 标题公式、22 个 AI 特征、6 维开头、逻辑延续三维）与**用户自己的终稿回流**。

本特性**取代** `judgment-layering` 的 Requirement 2（语言层 14 个判据归并为 7 类）。归并设计作废：`dbs-ai-check` 有 22 个特征且不矛盾，证明关键不是数量上限，而是每条特征都配「背后意图 + 追问」。`judgment-layering` 的 Requirement 1（闸门收敛）与 Requirement 5、6 继续有效。

## Glossary

- **初稿**：由本工作台生成的第一版正文。定位是**起点**，不是成品，允许不完美。
- **取材层**：生成之前的内容准备环节。产出主张、素材与选题判断，供初稿使用。
- **素材可信度（material_trust）**：素材的事实等级，三档——`verified`（一手，用户自己写的或亲身经历）、`sourced`（外部，研究或火狐采集且带来源）、`derived`（二手，模型根据关键词生成）。
- **内容单元（unit_type）**：素材的认知角色，五类——QST 问题 / CON 概念 / OPI 观点 / CAS 案例 / SOL 方案。对齐 `dbs-content-system`。
- **闸门（gate）**：客观可判定的判据。命中即拦停。
- **提醒（reminder）**：审美类、无标准答案的判断。不拦停，进诊断报告。
- **诊断五步形态**：接收内容 → 分维度诊断 → 出报告 → 问要不要改 → 确认后标记式改稿。全部 DBS 诊断技能共用的骨架。
- **追问（followup）**：针对一处命中，问用户一个问题以取得其真实意图，再据此改写。一条只问一个问题。
- **标记式改稿**：改写时保留原文对比的改稿方式，用户能看到「原文 → 改后」。
- **单步路由**：新手进入时只给下一步一个动作，不给全部面板。取自 `dbs` 主入口的路由原则。
- **冷启动**：用户首次使用，定位、素材库、对标均为空的阶段。

## Requirements

### Requirement 1: 平台收敛到抖音与视频号

**User Story:** AS 个人创作者, I want 工作台先聚焦两个平台, so that 我能把一条内容打磨到位，而不是同时应付四个平台。

#### Acceptance Criteria

1. 系统 SHALL 把草稿生成的平台集合收敛为抖音与视频号。
2. 系统的诊断、适配、发布清单、长度目标 SHALL 只针对这两个平台计算。
3. 系统 SHALL 保留历史小红书与公众号草稿的读取与展示能力。
4. 系统 SHALL NOT 在本期生成小红书或公众号的新草稿。
5. 抖音与视频号的读感差异 SHALL 作为基座的一部分存在（观众心理、开头、节奏、结尾、失败形态），SHALL NOT 只用字数区分。

### Requirement 2: 素材可信度三档

**User Story:** AS 个人创作者, I want 知道每条素材能撑起什么, so that 我知道哪些内容有据可依、哪些只是我的猜测。

#### Acceptance Criteria

1. 系统 SHALL 为素材记录提供 `material_trust` 字段，枚举为 `verified`、`sourced`、`derived`。
2. 手动新建或上传的素材 SHALL 默认为 `verified`。
3. 通过火狐研究或在线搜索采集的素材 SHALL 默认为 `sourced`，且 SHALL 保留来源链接或来源标识。
4. 由模型根据关键词生成的素材 SHALL 为 `derived`，状态 SHALL 为待核实。
5. 素材列表 SHALL 支持按 `material_trust` 筛选，并 SHALL 展示可信度标签。
6. 读取无 `material_trust` 字段的历史素材时，系统 SHALL 按 `verified` 处理。

### Requirement 3: 素材类型升级为五类认知角色

**User Story:** AS 个人创作者, I want 素材按认知角色分类, so that 生成初稿时我能按用途装配（一个案例 + 一个观点 + 一个方案）。

#### Acceptance Criteria

1. 系统 SHALL 为素材记录提供 `unit_type` 字段，枚举为 `QST`、`CON`、`OPI`、`CAS`、`SOL`。
2. 系统 SHALL 保留 `material_kind` 字段用于历史兼容与来源容器识别，SHALL NOT 用它作为生成时的装配依据。
3. 系统 SHALL 提供迁移映射：`quote` → `OPI`、`hotspot` → `QST`、`experience` → `CAS`、`insight` → `CON` 或 `CAS`（按内容判定，无法判定时留空待人工）。
4. `article` 类型的素材 SHALL NOT 生成 `unit_type`，因为它是来源容器而非内容单元。
5. 素材列表 SHALL 支持按 `unit_type` 筛选。
6. 系统 SHALL NOT 在迁移中删除任何既有素材记录。

### Requirement 4: 火狐研究到素材的通道

**User Story:** AS 个人创作者, I want 把研究里看到的东西变成我的素材, so that 研究结果能真正进入创作，而不只是躺在研究库里。

#### Acceptance Criteria

1. WHEN 用户对研究库或热搜榜的条目点击「转为素材」, 系统 SHALL 创建一条 `sourced` 素材，并 SHALL 保留原条目的来源链接与关键词来源标记。
2. 搜索结果的关键词 SHALL 作为**线索**处理，写入研究库；系统 SHALL NOT 把关键词本身当作素材。
3. 火狐未配置时，系统 SHALL 沿用演示数据并标注 `source: 'demo'`，且来源标识 SHALL NOT 被当作真实来源。
4. 转素材后的条目 SHALL 在原位置标记为「已转为素材」并支持跳转。
5. 系统 SHALL 支持从素材反向追溯其来源条目。

### Requirement 5: 内容层前置——拆概念

**User Story:** AS 个人创作者, I want 在写之前先搞清楚我在讲的到底是什么, so that 我不会用一个自己都没想清楚的概念写一整篇。

#### Acceptance Criteria

1. 系统 SHALL 提供「拆概念」环节，移植 `dbs-deconstruct` 的框架：维特根斯坦式审查（你以为它是什么、它在不同场景中的用法）+ 概念还原 + 用大白话说 + 判断这是 Question 还是 Problem。
2. WHEN 拆概念完成, 系统 SHALL 产出至少一条 `CON` 概念单元或 `QST` 问题单元，作为素材入库。
3. 拆概念产出的单元 SHALL 标记来源为本次会话，`material_trust` SHALL 为 `verified`（用户参与确认）。
4. 用户 SHALL 能在拆概念过程中修改模型产出，确认后的版本才入库。

### Requirement 6: 内容层前置——提主张

**User Story:** AS 个人创作者, I want 先确定我这一条到底要说什么, so that 正文不会变成一段没有立场的叙述。

#### Acceptance Criteria

1. 系统 SHALL 提供「提主张」环节，移植 `dbs-resonate` 的前两步：提取所有主张 → 找核心机制。
2. WHEN 提主张完成, 系统 SHALL 产出至少一条 `OPI` 观点单元（含核心判断、适用范围、为什么重要），作为素材入库。
3. 系统 SHALL 提示用户保留的主张不超过两条；超过 SHSALL 提示「两次以上就变成魔术表演了」。
4. 用户 SHALL 能修改模型产出，确认后的版本才入库。

### Requirement 7: 内容层前置——形式判断与选题把关

**User Story:** AS 个人创作者, I want 在动手之前知道这个选题值不值得做, so that 我不会白写一篇。

#### Acceptance Criteria

1. 系统 SHALL 提供形式判断，移植 `dbs-content` Phase 2 的形式匹配表（观点输出 / 工具清单 / 深度分析 / 案例复盘 / 争议话题 → 推荐形式）。
2. 系统 SHALL 提供选题把关，移植 `dbs-content` Phase 3 五维诊断（文字洁癖 / 标题 / 表达效率 / 认知落差 / AI 辅助建议）。
3. 选题把关 SHALL 输出「如果要做，第一步是什么」与一句话结论。
4. IF 五维全部不通过, 系统 SHALL 明确建议不做这条选题，SHALL NOT 强行进入生成。
5. 选题把关 SHALL 是**唯一**允许在内容层拦停的位置；系统 SHALL NOT 在初稿生成后因内容质量拦停。

### Requirement 8: 生成初稿接上取材产出

**User Story:** AS 个人创作者, I want 初稿用我的真素材写, so that 模型不用编客户和数字。

#### Acceptance Criteria

1. WHEN 生成初稿, 系统 SHALL 把 R5-R7 产出的主张、素材清单、形式判断一并作为写作简报输入。
2. 写作简报中的案例与数字 SHALL 只允许来自 `verified` 或 `sourced` 素材；`derived` 素材 SHALL NOT 用于填充案例位与数字位。
3. IF 案例位或数字位没有任何可用素材, 正文 SHALL 留空占位或写成不含具体案例与数字的表述，系统 SHALL NOT 编造。
4. 生成结果的 `source_refs` SHALL 包含本次使用的全部素材引用。
5. 系统 SHALL 允许在无素材的情况下生成，但 SHALL 明确提示「本次初稿没有素材支撑，案例与数字位置会留空」。

### Requirement 9: 诊断统一五步形态

**User Story:** AS 个人创作者, I want 诊断只告诉我问题在哪，别替我决定怎么改, so that 我保留对自己内容的控制权。

#### Acceptance Criteria

1. 全部诊断 SHALL 遵循五步形态：接收内容 → 分维度诊断 → 出报告 → 问要不要改 → 确认后改稿。
2. 诊断报告 SHALL 按**文本顺序**逐处呈现，SHALL NOT 按特征分类呈现。
3. 每一处 SHALL 包含：直接引用的原文、一句人话说明、严重度标签。
4. 严重度 SHALL 分三档，且 SHALL NOT 带否决权。
5. 系统 SHALL NOT 在用户确认前自动改写正文。
6. 报告结尾 SHALL 明确说明「以上是检测结果，不涉及修改」，并询问是否要改。

### Requirement 10: 标记式改稿

**User Story:** AS 个人创作者, I want 看见每一处改了什么, so that 我能判断这个改动是不是我想要的。

#### Acceptance Criteria

1. WHEN 用户确认改稿, 系统 SHALL 以标记式改稿呈现，保留原文与改后文字的对比。
2. 系统 SHALL 提供改动清单，列出每一处的原文、改后文字与原因。
3. 标记式改稿 SHALL 只作用于当前草稿，SHALL NOT 影响其他平台草稿。
4. 改稿结果 SHALL 进入既有版本历史，用户 SHALL 能回退。

### Requirement 11: 语言层换成 22 个特征 × 追问

**User Story:** AS 个人创作者, I want 系统问出我本来想说什么, so that 改完还是我的话，不是系统的话。

#### Acceptance Criteria

1. 系统 SHALL 移植 `dbs-ai-check` 的特征骨架：每个特征包含特征名、AI 特征识别规则、**背后意图**与**追问**。
2. 语言层诊断 SHALL 按文本顺序逐处指出，SHALL NOT 按特征归类。
3. 每一处 SHALL 引用原文，并 SHALL 附一条追问，一条只问一个问题。
4. 系统 SHALL NOT 用「去 AI 味」作为目标表述；识别 AI 特征的目的是让用户看清自己的文字。
5. IF 正文整体没有明显特征, 系统 SHALL 直接说明没有发现，SHALL NOT 硬找。
6. 特征集 SHALL 允许后续扩充，SHALL NOT 设类别数量上限。

### Requirement 12: 追问的答案回写素材

**User Story:** AS 个人创作者, I want 我回答问题时说的话别丢掉, so that 越改素材越厚，下一轮初稿越好。

#### Acceptance Criteria

1. WHEN 用户在追问中回答, 系统 SHALL 把回答内容作为候选素材提交入库。
2. 回写素材的 `material_trust` SHALL 为 `verified`，`unit_type` SHALL 由内容判定（观点回答 → `OPI`，经历回答 → `CAS`）。
3. 入库前 SHALL 经用户确认，SHALL NOT 静默写入。
4. 回写素材 SHALL 记录来源为「改稿追问」，并关联当前草稿。

### Requirement 13: 结构层接入逻辑延续检查

**User Story:** AS 个人创作者, I want 知道我的稿子哪一段跳了, so that 口播时不会让人听不懂。

#### Acceptance Criteria

1. 系统 SHALL 移植 `dbs-script-flow` 的检查流程：分段 → 逐段扫描三维 → 标注风险等级。
2. 结构层 SHALL 输出风险等级报告，SHALL NOT 拦停生成。
3. 结构层 SHALL 只拦停「初稿根本没做出来」这一类：无正文、串台、格式泄漏、两平台同一篇、案例位或数字位使用了不可溯源的素材。
4. `length_severe`（长度严重不足）SHALL 从闸门降级为提醒，SHALL NOT 触发自动重写。

### Requirement 14: 标题与开头接入公式与多维诊断

**User Story:** AS 个人创作者, I want 标题和开头有可选的改法, so that 我不用凭空想。

#### Acceptance Criteria

1. 标题 SHALL 移植 `dbs-xhs-title` 的公式库形态（公式编号 + 心理触发器分类 + 原始举例 + 为什么选它），并为抖音与视频号各建一份。
2. 开头 SHALL 移植 `dbs-hook` 的开头多维诊断、素材丰富度检查与多种生成方法。
3. 标题与开头 SHALL 输出**多个方案**供用户选择，SHALL NOT 只给一个结论。
4. 每个方案 SHALL 可溯源到具体公式编号或方法名。

### Requirement 15: 拍摄衔接

**User Story:** AS 个人创作者, I want 定稿之后能直接拍, so that 中间不用再倒一次。

#### Acceptance Criteria

1. 系统 SHALL 保留既有拍摄清单与提词器能力。
2. 标记式改稿确认后的定稿 SHALL 能直接进入拍摄环节。
3. 提词器 SHALL 只读已定稿版本，SHALL NOT 使用诊断中的中间态。

### Requirement 16: 发布衔接

**User Story:** AS 个人创作者, I want 发布前知道这条会怎样, so that 我能判断要不要再改一轮。

#### Acceptance Criteria

1. 系统 SHALL 保留既有平台适配、发布清单与违禁词检测能力，并收敛到抖音与视频号。
2. 系统 SHALL 提供发布前内容层报告：移植 `dbs-resonate` 的五维共鸣诊断与 `dbs-spread` 的传播心理维度。
3. 发布前报告 SHALL NOT 拦停发布。

### Requirement 17: 双通道回流

**User Story:** AS 个人创作者, I want 系统从我自己改的稿子和发布数据里学, so that 判断依据来自我，而不是系统自己发明。

#### Acceptance Criteria

1. 系统 SHALL 提供终稿回流：对比原稿与用户的定稿，产出偏好候选。
2. 系统 SHALL 提供数据回流：发布表现数据进入复盘，并 SHALL 能影响下一轮选题。
3. 两类候选 SHALL 经用户确认后才生效，SHALL NOT 自动改写判据。
4. 语言层判据 SHALL 逐步由回流产出替换掉通用特征，替换过程 SHALL 可回溯。

### Requirement 18: 新手单步路由

**User Story:** AS 不会写初稿的新手, I want 界面只告诉我下一步做什么, so that 我不会被一堆面板吓住。

#### Acceptance Criteria

1. 系统 SHALL 提供单步路由：WHEN 用户处于某个环节, 界面 SHALL 只突出下一个动作。
2. 系统 SHALL 提供新手引导路径，覆盖从定位到发布的完整链路。
3. 系统 SHALL 提供环节切换入口，SHALL NOT 强制线性流程。
4. 系统 SHALL 参考 `dbs` 主入口的三种模式：新手教程、任务前路由、任务后导航。

### Requirement 19: 冷启动降级路径

**User Story:** AS 第一次使用的新手, I want 素材和对标都是空的时候也能开始, so that 我不会卡在第一步。

#### Acceptance Criteria

1. WHEN 定位、素材库或对标为空, 系统 SHALL 提供降级路径，SHALL NOT 直接进入重流程。
2. 降级路径 SHALL 至少包含：先做小样本、先收缩边界、或先用纯选题生成无素材初稿。
3. 系统 SHALL 明确告知用户当前缺什么、补上之后能得到什么。
4. 系统 SHALL NOT 在缺素材时静默编造内容来填充流程。

### Requirement 20: 向后兼容与数据迁移

**User Story:** AS 系统维护者, I want 重构不破坏正在用的数据, so that 升级过程不中断。

#### Acceptance Criteria

1. 历史草稿、素材、对标、研究数据的读取 SHALL 保持可用。
2. 新增字段（`material_trust`、`unit_type`、诊断条目结构）SHALL 有默认值，SHALL NOT 因缺失而报错。
3. 历史小红书与公众号草稿 SHALL 只读保留。
4. 迁移 SHALL NOT 删除任何既有记录，SHALL 可重入。
5. 全量测试 SHALL 通过后再交付。

## Out of Scope

- 商业诊断类 DBS 技能：`dbs-action`、`dbs-goal`、`dbs-decision`、`dbs-diagnosis`、`dbs-slowisfast`、`dbs-good-question`、`dbs-knowledge`、`dbs-learning`、`dbs-chatroom*`、`dbs-bridge`、`dbs-agent-migration`、`dbs-update`、`dbs-skill-cleaner`。
- 小红书与公众号的新稿生成与诊断：二期复制。
- 成本与配额优化：本期不设调用上限。
- 内容层事实判据（案例、数字是否真实）：不判真假，只判**能否溯源到 `verified` 或 `sourced` 素材**。
