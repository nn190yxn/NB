# Requirements Document: 判据分层（闸门收敛 + 提醒合并）

Feature Name: judgment-layering
Updated: 2026-09-18

## Introduction

写作判据当前不分层：生成阶段的拦停条件是 `writingIssues()` 里任意一条命中（17 个 code + 四平台同一篇），语言审美类判据与结构类判据拥有同等否决权。结果是规则越多越具体、产出越困难——真实稿子被 `vague_case` 与 `case_claim` 互相打架卡死，删句又触发字数下限，用户改不动。

本特性按「三层判定模型」重建判据：只有**客观可判定**的判据能拦停（闸门 ≤5 条），**审美类**判据一律降为提醒且必须给出可替换的原文→改后文字（提醒 ≤7 类），**内容事实类**（案例、数字是否真实）由于系统没有事实来源，不判、只标来源。

## Glossary

- **闸门（gate）**：客观可判定的判据。命中即让生成结果标 `needs_revision`，并触发一次带理由的自动重写。
- **提醒（reminder）**：审美类、无标准答案的判断。不拦停、不触发重写、不影响 `workflow_status`，只在用户点「检查」或「重写」时出现。
- **闸门判据集（gateIssues）**：构成闸门的 5 类判据，见 Requirement 1。
- **语言层提醒**：去 AI 化与表达腔调类提醒，合并后共 7 类，受 7 类上限约束。
- **结构类问题**：缺来源引用、缺开头槽位、缺正文、命中风险词等可核对项，不受 7 类上限约束。
- **替换对（pair）**：一条「原文 → 改后文字」，由模型产出、服务端校验，经 `POST /api/drafts/:id/replacements` 返回。
- **长度严重不足（length_severe）**：正文长度低于该平台/体裁目标下限的 60%。

## Requirements

### Requirement 1: 闸门收敛到 5 条

**User Story:** AS 个人创作者, I want 只有客观可判定的问题能拦住我的稿子, so that 稿子不会因为审美偏好被反复打回。

#### Acceptance Criteria

1. 系统 SHALL 只在以下 5 类判据命中时把生成结果标为 `needs_revision`：`format_leak`、`platform_mixup`、`self_intro`、`same_essay`、`length_severe`。
2. `scanGeneratedBody` 与 `scanGeneratedBodies` SHALL 只依据上述 5 类判据计算 `failed` 与 `summary`。
3. IF 命中闸门, 系统 SHALL 先带理由自动重写一次；重写后仍命中才入库并标 `needs_revision`（沿用现有 A 方案流程）。
4. 系统 SHALL NOT 因内容层的案例或数字断言（`case_claim`、`vague_case`）拦停任何稿子。
5. `length_severe` SHALL 定义为正文长度 < 目标下限 × 0.6；IF 目标没有下限, 系统 SHALL 不判 `length_severe`。
6. 系统 SHALL 保持 `format_leak`、`platform_mixup`、`self_intro` 的现有命中规则不变。

### Requirement 2: 语言层提醒合并为 7 类

**User Story:** AS 个人创作者, I want 提醒数量有硬上限, so that 检查结果不会变成一张永远做不完的清单。

#### Acceptance Criteria

1. 系统 SHALL 把原 14 个语言层判据归并为以下 7 类提醒：

   | 类别 key | 吸收的原 code |
   |---|---|
   | `tone_elevation` | `ai_tone_phrase`、`golden_tail`、`ing_tail`、`avoid_copula`、`generic_ending` |
   | `template_filler` | `triple_list`、`fake_rebuttal`、`connector_abuse` |
   | `unsourced_case` | `vague_case`、`case_claim` |
   | `no_concrete_support` | `no_concrete_support` |
   | `method_talk` | `method_talk` |
   | `consulting_tone` | `consulting_tone` |
   | `opening_question` | `opening_question` |

2. 系统 SHALL 保证语言层提醒类别数不超过 7；新增一类必须先合并或删除一类。
3. 语言层提醒 SHALL NOT 进入 `gate.summary`、SHALL NOT 触发自动重写、SHALL NOT 影响 `workflow_status`。
4. 字数提醒（未达 `length_severe` 但超出目标区间）与结构类问题 SHALL NOT 计入 7 类上限。
5. 归并后同一类命中多个原 code 时，系统 SHALL 只产出一条该类别提醒。

### Requirement 3: 提醒必须给出可替换的原文 → 改后文字

**User Story:** AS 个人创作者, I want 每条提醒都附上能改的具体句子, so that 我不必自己猜该怎么改。

#### Acceptance Criteria

1. WHEN 用户点「检查」或「重写」, 系统 SHALL 为命中的语言层提醒产出替换对。
2. IF 某一类提醒给不出任何替换对, 系统 SHALL 不展示该类提醒。
3. 替换对 SHALL 走既有服务端校验：原句在正文中唯一存在、改后不是原样、不越改越短。
4. 系统 SHALL NOT 在草稿生成阶段调用模型产出替换对。
5. 提醒文案 SHALL 只保留一份来源，SHALL NOT 出现同一问题两种措辞。

### Requirement 4: 提醒一次只呈现一条

**User Story:** AS 个人创作者, I want 一次只看一条建议, so that 我知道现在该改哪一句。

#### Acceptance Criteria

1. 检查面板 SHALL 一次只显示一条提醒。
2. 每条提醒 SHALL 就地展示其替换对。
3. 用户 SHALL 能切到下一条，并 SHALL 能看到已展示条数与总条数。
4. 系统 SHALL NOT 用 `suggestions.join('；')` 一次性铺开全部提醒。

### Requirement 5: 修复质量门无守卫建议

**User Story:** AS 系统维护者, I want 质量门不再输出与正文无关的建议, so that 用户看到的每条建议都对应真实问题。

#### Acceptance Criteria

1. `checkQuality` SHALL 恢复 `platform_mixup` 与 `method_talk` 的条件判定：仅当命中时才产出对应 evidence 与建议。
2. WHEN 正文既无其他平台名也无方法骨架, 系统 SHALL NOT 在质量门建议中出现这两条。
3. 系统 SHALL 清理因该缺陷产生的死变量（`mixupWords`、`methodWords`）。
4. 回归测试 SHALL 断言上述条件行为，而不只是断言 evidence 中存在该 code。

### Requirement 6: 向后兼容与回归

**User Story:** AS 系统维护者, I want 重写判据不破坏已有数据与行为, so that 升级过程不影响正在用的草稿。

#### Acceptance Criteria

1. 历史草稿已存的 `checks` 数据 SHALL 仍可正常展示。
2. IP 档案字段超长（>12 字）时不判正文不合格的逻辑 SHALL 保持不变。
3. 「按检查意见改写」改不动时返回 502 `REVISE_NOT_IMPROVED` 且不改库的行为 SHALL 保持不变。
4. 全量测试 SHALL 通过后再交付。

## Out of Scope

- 在线搜索与「有没有来源引用」判据：等在线搜索/素材来源接上后另开特性。
- 人工终稿回流学风格（diff 产偏好候选）。
- 内容层事实判据（案例、数字是否真实）：系统当前没有事实来源，不判。
- 新增页面或面板；本特性只改既有检查面板的呈现。
