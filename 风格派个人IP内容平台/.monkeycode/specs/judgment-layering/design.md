# Design Document: 判据分层（闸门收敛 + 提醒合并）

Feature Name: judgment-layering
Updated: 2026-09-18
Requirements: `requirements.md`

## 1. 现状与问题

### 1.1 闸门过宽（唯一根因）

生成阶段的拦停条件是 `server/draft-checks.mjs` 的 `writingIssues(draft).evidence.length > 0`：

```js
export function scanGeneratedBody(body, platform) {
  const evidence = writingIssues({ body, platform }).evidence
  return { failed: evidence.length > 0, evidence, summary: ... }
}
```

`writingIssues` 产出 17 个 code，`scanGeneratedBodies` 另有 `same_essay`。共 18 个拦停触发点，远超「闸门 ≤5」。审美类判据与结构类判据拥有同等否决权，这是用户稿子改不动的直接原因。

### 1.2 其余两处的拦停范围已经是窄的

- `checkPersona`：最差只到 `warning`，**根本不拦停**。
- `checkQuality`：只被 4 个 `severity === 'blocked'`（`body_missing`、`opening_missing`、`source_missing`、`risk_words`）+ `score < 60` 拦停。写作类判据在这里是 `warning`，不拦停；综合分只由 `dimensions` 算出，不受判据条数影响。

结论：**「闸门太宽」的全部问题集中在 `writingIssues` 一处**，不需要动 `checkPersona` 与 `checkQuality` 的拦停逻辑。

### 1.3 提醒给的是「方向」不是「替换」

`checkRewriteHints` / `templateSentenceHints` 全是文字指令（例：「删掉段尾那句总结，把最后一个具体事实留着当结尾」），拿不到「原文 → 改后」。违反需求 3。系统里唯一能产出可校验替换对的通道是 `POST /api/drafts/:id/replacements`（模型只回替换对，服务端校验原句唯一、非原样、不越改越短）。

### 1.4 顺带修掉的缺陷：质量门无守卫建议

`server/draft-checks.mjs:154-157`：

```js
const mixupWords = platformMixupHits(draft?.body, draft?.platform)
    suggestions.push('把其他平台名和分发说明换成这一条自己的具体内容，不要只删掉那句话')   // 缺 if
const methodWords = methodTalkHits(draft?.body)
    suggestions.push(checkRewriteHints.method_talk)                                      // 缺 if
```

应为 `if (mixupWords.length) { evidence.push(...); suggestions.push(...) }`。

- **归因**：`dcca6c0`（feat-short-video-300-900-and-replace-instead-of-delete）把两个带守卫的块替换成两行无守卫 push，替换行连缩进都掉了。`10f7814` 引入时是正确的。
- **影响**：任何草稿的质量门建议里恒有多出这两条无关建议；这两个 code 在 `checkQuality` 内的 evidence 不再产出（`writingIssues` 兜住了，证据本身没丢）；`mixupWords` / `methodWords` 成为死变量。
- **为什么测试没抓到**：`server/draft-checks.test.mjs:273-284` 只断言 `evidence` 含这两个 code，从不断言 `suggestions`。

## 2. 分层模型

```
一次生成的判定流：

  body ──► gateIssues()   ──命中的是客观项──► 自动重写一次 ──仍命中──► 入库 + needs_revision
        └► reminders()    ──审美项，不拦停──► 放着，等用户点「检查」或「重写」

  draft.checks.quality ──► 结构类 blocked（缺正文/缺开头槽位/缺来源/风险词/分数<60）→ 拦质量门
                       └► reminders（7 类）→ 只展示，不拦
```

判定只在有依据的层上做：结构层客观 → 闸门；语言层是审美 → 提醒；内容层（案例、数字真假）没有事实来源 → 不判、只标来源。

## 3. 闸门定义

### 3.1 5 条闸门

| code | 含义 | 为什么客观 |
|---|---|---|
| `format_leak` | 正文混入结构骨架、占位符、Markdown 标题/加粗、其他平台列表建议 | 这些标记是我们自己塞进去的，出现即可判 |
| `platform_mixup` | 正文出现当前平台之外的其他平台名 | 字符串包含，可判 |
| `self_intro` | 正文出现自我介绍或引导关注（`大家好` / `我是+英文名` / `我叫+中文名` / `关注我`） | 字符串包含，且是平台约定 |
| `same_essay` | 四平台正文是同一篇（`identical` / `jaccard ≥ 0.42` / `containment ≥ 0.7`） | 四个平台必须写不同内容，是我们指定的 |
| `length_severe` | 正文长度 < 目标下限 × 0.6 | 阈值可算 |

命中规则与阈值全部沿用现有实现，不改。

### 3.2 长度严重不足的阈值

阈值由 `server/draft-writing.mjs` 的长度表推导（单点维护，前端副本同步）：

| 平台 / 体裁 | 目标区间 | 60% 拦停线 |
|---|---|---|
| 小红书 图文笔记 | 400–1000 | 240 |
| 抖音 短视频 | 300–900 | 180 |
| 视频号 短视频 | 300–900 | 180 |
| 公众号 长文 | 1000–2500 | 600 |
| 视频 中视频 | 400–1000 | 240 |
| 视频 长视频 | 600–1500 | 360 |

全部目标都有下限，无 `min = 0` 的例外；万一出现无下限目标，不判 `length_severe`。

### 3.3 summary 的口径

`gate.summary` 只由闸门命中组成（供 `draftGateRewritePrompt` 与草稿页展示）。语言层命中不再进 summary。这会让自动重写的指令从「一长串审美问题」收窄成「这五类客观问题」，提示词更短、更可执行。

## 4. 提醒：14 → 7 类

### 4.1 类别定义（`server/draft-checks.mjs` 导出单一来源）

| 类别 key | 展示名 | 吸收的原 code |
|---|---|---|
| `tone_elevation` | 升华句与金句收束 | `ai_tone_phrase`、`golden_tail`、`ing_tail`、`avoid_copula`、`generic_ending` |
| `template_filler` | 凑数三连、假反驳、书面连接词 | `triple_list`、`fake_rebuttal`、`connector_abuse` |
| `unsourced_case` | 没主体的案例、来路不明的数字 | `vague_case`、`case_claim` |
| `no_concrete_support` | 整篇通用判断、没有落地 | `no_concrete_support` |
| `method_talk` | 方法骨架 / 分发说明 | `method_talk` |
| `consulting_tone` | 咨询腔与工程词 | `consulting_tone` |
| `opening_question` | 开头第一句是问句 | `opening_question` |

原 code 保留在 evidence 里（可追溯、可测试），但**展示与呈现以类别为单位**。

### 4.2 数据结构

`writingIssues` 改为返回分层结果：

```js
writingIssues(draft) -> {
  gate:      [ { code, message, severity } ],        // 5 类闸门命中
  reminders: [ { category, label, evidence: [原 code...], message } ],  // ≤7 类
  suggestions: [ ... ],                              // 结构类建议，用于 checkQuality
}
```

`result()` 增加可选 `reminders = []` 字段；`checkQuality` / `checkPersona` 的 `evidence` 语义不变（结构类与闸门项），语言层从 `evidence` 移到 `reminders`。

### 4.3 7 类上限的约束方式

`reminderCategories` 是模块常量，长度必须 ≤7；用一条单元测试断言 `reminderCategories.length <= 7`，新增类别时这条会先红，强制先合并或删除。结构类问题（缺来源引用、缺开头槽位、字数未达严重不足）走 `suggestions`，不计入该上限。

### 4.4 提醒与「按检查意见改写」的关系（关键，别搞错）

- **生成阶段**：提醒不触发自动重写（闸门只有 5 类）。
- **用户主动点「按检查意见改写」时**：提醒**仍然**作为改写意见传给模型。

因此 `draftCheckRewriteNote` 与 `actionableIssueCodes` 必须同时覆盖闸门 code 与提醒类别，否则「按检查意见改写」会失去修语言问题的能力，且 `checkReviseOutcome` 的「被点名的问题没减少」护栏（`requireImprove`）会失效——那是它当初被建出来的原因。`checkRewriteHints` 的 key 从原 code 改成类别 key，`consulting_tone` / `opening_question` / `unsourced_case` 的「点名原文」分支保留。

## 5. 提醒的替换对产出

### 5.1 流程

```
用户点「检查」或「定位替换」
  → 若尚未产出替换对：POST /api/drafts/:id/replacements（模型只回替换对）
  → 服务端校验：原句在正文唯一、改后不是原样、不越改越短
  → 按类别归组
  → 面板一次显示一条：类别名 + 该类替换对（可勾选）+ 下一条 + n/N
  → 用户勾选后替换落进正文（走既有保存流程，version+1）
```

### 5.2 接口变更

`POST /api/drafts/:id/replacements` 的返回从 `{ pairs, dropped, remaining, message }` 改为：

```js
{
  categories: [ { category, label, pairs: [ { old, new } ], dropped: [ { old, reason } ] } ],
  remaining,          // 换完后剩余命中的原 code 数
  message,            // 无问题时的说明
}
```

前端是唯一消费方，同步改，不留兼容分支。

### 5.3 成本约束

- 生成阶段**不**调模型产替换对（否则一次生成变成两次调用）。
- 「检查」与「重写」本来就要调模型，替换对搭车产出，边际成本为 0。
- 给不出替换对的类别不展示（需求 3.2）。

## 6. UI 变更（`src/main.tsx`）

### 6.0 简洁约束（用户硬要求，优先级高于本节其余条目）

用户原话：「界面不要搞得太复杂。比如之前的草稿，如果每次修改都留一个，或者在界面上都能看到，就会很乱。」所以：

1. **不新增页面、不新增常驻面板。** 只改既有草稿卡片里的检查面板。
2. **版本历史维持现状**：只在点「查看历史」后展开，草稿卡片上**不**常驻版本列表、**不**显示「已改 N 版」这类计数。
3. **替换/改写不留常驻痕迹**：替换对应用后收起，正文里多一行都算失败；不新增「上次改了什么」的常驻区块。
4. **同一屏内不出现第二个提醒列表**：语言层提醒只有一处入口，一次只显示一条。
5. 落地任何一条 UI 改动前先问：这会不会让草稿卡片上多出一行常驻内容？会，就不要做。

若为实现需求 3（替换对）必须多出可视元素，优先复用现有 `.replace-pair` / `.deani-result` 样式，不引入新的视觉层级。

只改既有检查面板，不新增页面：

1. 语言层提醒区改成一次一条：`当前条 / 共 N 条` + 「下一条」。
2. 每条就地展示该类别的替换对（复用现有 `.replace-pair` 勾选样式）。
3. 去掉 `suggestions.join('；')` 对语言层提醒的一次性铺开；结构类 `suggestions` 保持现有展示。
4. `DraftCheck` 类型增加 `reminders?: { category: string; label: string }[]`。
5. 检查面板底部的说明文案（「改正文：字数、设问开头、咨询腔、编客户、升华句、凑数三连」）按新的 7 类口径改写。

## 7. 回归测试点

| 测试文件 | 断言 |
|---|---|
| `server/draft-checks.test.mjs` | 语言层命中（如 `vague_case`）但无闸门命中时，`scanGeneratedBody().failed === false` |
| 同上 | 5 类闸门各自命中时 `failed === true` |
| 同上 | `reminderCategories.length <= 7` |
| 同上 | `length_severe` 边界：刚好 60% 不判、低于 60% 判、无下限不判 |
| 同上 | **缺陷回归**：正文无其他平台名、无方法骨架时，`checkQuality().suggestions` 不含这两条文案（现有测试只断言 evidence，必须补 suggestions 断言） |
| 同上 | 同一类别命中多个原 code 时只产出一条提醒 |
| `server/draft-writing.test.mjs` | A 方案测试保持绿：`sermon_stuck` 靠 `same_essay` 命中（三平台正文完全相同），属保留闸门，不受收敛影响 |
| `server/draft-revise-outcome.test.mjs` | 「按检查意见改写」仍能因语言问题判「没减少」，护栏未失效 |
| `server/web-assets.test.mjs` | 前端检查面板一次一条的特征断言 |

## 8. 风险与未验证

- **闸门收窄会让更多稿子入库为 `draft`**：这正是目的，但意味着原本被拦的语言问题会直接落到用户面前。卸载点就是「提醒 + 替换对」——若替换对质量差，体验会比现在更差。替换对质量只能在真实稿子上验证。
- **模型产替换对的成本与时延**：单条约 20-30 秒（沿用 `/replacements` 现状）。一次检查产全部类别可能较慢，必要时按类别惰性产出（点在哪个类别才产哪类）。
- **真实模型端到端仍未验证**：A 方案与定位替换至今只跑过 mock 集成测试。
- **`same_essay` 阈值（0.42 / 0.7）未在真实稿子上复核**，本次不动。

## 9. 不做的事（明确排除）

- 不接在线搜索、「有没有来源引用」判据（等数据来源接上另开特性）。
- 不做人工终稿回流学风格。
- 不判案例与数字的真假（系统当前没有事实来源，没资格判）。
- 不新增页面或面板，不往单个页面堆功能。
- 不改 `checkPersona` 与 `checkQuality` 的拦停逻辑，不改「按检查意见改写」的 502 不改库行为。
