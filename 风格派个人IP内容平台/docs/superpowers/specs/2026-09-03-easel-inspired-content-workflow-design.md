# Easel 借鉴型内容流程编排设计

- 日期：2026-09-03
- 作者：Monkeycode
- 状态：第一阶段任务 1–5 已实现，任务 6 待实施

## 1. 背景

定位派已经具备定位发现、IP 档案、研究、素材原子化、爆款方法库、选题、草稿、今日拍摄、表现快照、AI 记忆以及 Web/PWA/Electron 跨端能力。本设计吸收 Easel 的内容运营分层、能力契约、Prompt 分层、质量门和复盘回写思想，但不重建现有架构。

## 2. 目标

将已有能力串成可追踪、可回退、有人审的内容运营流程：

```text
定位/策略 → 选题 → 评估 → Hook/草稿 → 平台适配 → 检查 → 人工确认 → 拍摄/发布记录 → 表现 → 复盘 → 经验候选
```

目标包括：

1. 统一能力的输入、输出、读取、写回和确认规则。
2. 限制模型只能在当前账号和当前任务上下文内工作。
3. 让选题、草稿、检查、拍摄、表现和复盘保持来源链。
4. 将人设检查、质量门和发布清单分离。
5. 让复盘结论经人工确认后再写入记忆或方法库。
6. 保留现有 React/Vite、Node HTTP、JSON/MySQL、PWA 和 Electron 体系。

## 3. 非目标

本设计不包含：

- 浏览器自动登录或自动发布。
- 复制 Easel 的 112 个 Skill。
- 引入 OpenClaw 作为运行时前提。
- 将全部操作改造成聊天式 Agent。
- 重写现有后端或替换数据存储。
- 自动修改核心 IP 定位、目标受众或内容支柱。
- 未经确认把偶然表现写入长期记忆。

## 4. 设计原则

```text
固定流程优先于自由规划
结构化数据优先于 Prompt 猜测
确定性计算交给代码
模型负责理解、生成和解释
人工确认负责发布和长期知识写回
```

所有流程必须保持 `owner_id` 隔离，并沿用现有 `source_refs` 追踪来源。

## 5. 能力目录

第一版能力目录控制在 10 项以内：

| 能力 | 来源思想 | 主要输入 | 主要输出 | 确认 |
|---|---|---|---|---|
| `topic_matrix` | content-matrix | IP、支柱、研究、素材 | 候选选题 | 是 |
| `topic_evaluate` | topic-evaluator | 选题、平台、历史表现 | 七维评分、决策、证据 | 是 |
| `hook_generate` | hook-generator | 已确认选题、风格 | Hook 变体 | 选一条 |
| `draft_generate` | 现有草稿生成 | 选题、Hook、方法、素材 | 主稿 | 是 |
| `platform_adapt` | content-repurposing | 主稿、目标平台 | 平台版本 | 是 |
| `persona_check` | persona-check | 内容、IP 档案 | 一致性报告 | 否，仅提醒 |
| `quality_gate` | quality-gate | 内容、平台规则 | 质量/合规结论 | 阻断 |
| `publish_checklist` | publish-checklist | 平台版本、产物 | 完整性结论 | 阻断 |
| `content_postmortem` | content-postmortem | 表现快照、内容 | 复盘报告、经验候选 | 是 |
| `memory_candidate` | strategy-advisor | 复盘报告、历史经验 | 记忆/方法候选 | 是 |

能力不等于独立页面。优先作为现有页面中的流程节点和后端可调用能力存在。

## 6. Prompt Stack

统一上下文分四层：

```text
账号身份与定位
→ 定位派业务规则
→ 当前任务上下文
→ 当前能力指令
```

### 6.1 账号层

读取当前账号的定位、受众、内容支柱、表达风格、偏好和红线。

### 6.2 业务规则层

包含来源引用要求、账号隔离、人工确认、事实核验、API Key 禁止进入模型上下文等规则。

### 6.3 任务层

只加载本次任务关联的选题、平台、内容类型、研究、素材、方法和相关记忆，不把整个历史数据集注入模型。

### 6.4 能力层

明确本次只做什么，例如“只生成 Hook”“只检查人设”“只输出复盘，不修改 IP 档案”。

## 7. 流程设计

### 7.1 选题流程

```text
研究/素材 → 选题矩阵 → 七维评估 → 做/改/暂缓 → 用户确认 → 进入创作
```

评估维度：流量潜力、账号匹配、竞争差异化、时效价值、变现空间、制作成本、合规风险。

建议阈值：

- 70 分及以上：建议做。
- 50-69 分：改方向后重新评估。
- 50 分以下：建议暂缓，但不删除。

所有评分必须带证据；模型不能因为缺数据而编造热度或历史表现。

### 7.2 创作流程

```text
已确认选题 → 方法模板 → Hook 变体 → 用户选择 → 主稿 → 平台版本 → 人设检查 → 质量门 → 发布清单 → 用户确认 → 今日拍摄
```

人设检查只产生提醒；质量门和发布清单可以阻断；任何阻断都必须允许修改后重试。

一稿多平台时，主稿和平台版本独立保存，平台版本不得覆盖主稿。

### 7.3 复盘流程

```text
发布/表现快照 → 单条复盘 → 多条归因 → 经验候选 → 用户确认 → memories 或 structures
```

数据聚合、增长率、互动率、样本量提示等由确定性代码完成；模型只负责解释、归因假设和行动建议。

复盘结论不能直接修改 `profile`、核心定位、受众或内容支柱。

## 8. 状态机

### 8.1 选题

```text
candidate → evaluated → approved → in_production → completed
                 ↓
           needs_revision
```

“暂缓”保留选题及理由，不做物理删除。

### 8.2 草稿

```text
draft → hooks_ready → content_ready → persona_checked → quality_checked → publish_ready → ready_to_shoot → published
                         ↑                 ↓
                    needs_revision ←─────┘
```

质量失败回退至 `needs_revision`，修订后重新进入 `content_ready`，不得直接跳到 `ready_to_shoot`。

### 8.3 复盘

```text
snapshot_recorded → postmortem_ready → insight_candidate → human_approved → memory_written / structure_written
```

## 9. 数据设计

优先在现有集合中增加字段，不建立平行内容数据库。

### 9.1 topics

```json
{
  "workflow_status": "candidate",
  "evaluation": {
    "score": 78,
    "decision": "do",
    "dimensions": {},
    "evidence": [],
    "suggestions": [],
    "evaluated_at": ""
  }
}
```

### 9.2 drafts

```json
{
  "workflow_status": "draft",
  "hooks": [],
  "selected_hook_id": null,
  "platform_variants": [],
  "checks": {
    "persona": null,
    "quality": null,
    "publish_checklist": null
  },
  "approval": {
    "status": "pending",
    "approved_at": null
  }
}
```

### 9.3 structures

增加模板版本、适用平台、适用内容类型、适用条件、使用次数、表现摘要和来源引用。历史草稿记录使用时的模板版本。

### 9.4 performance_snapshots

沿用现有 `draft_id`、`shooting_id`、`metrics`、`raw_model_result`、`confidence`、`status`，新增复盘关联和经验候选引用时必须保持原始快照不可变。

## 10. API 规划

现有接口继续复用：

```text
POST /api/topics/generate
POST /api/drafts/generate
PUT  /api/drafts/:id
GET  /api/drafts/:id/history
POST /api/drafts/:id/restore
PUT  /api/shooting/:id
POST /api/performance-snapshots
GET  /api/performance-snapshots
POST /api/content-strategy/reviews
POST /api/content-strategy/versions
POST /api/memories
```

建议新增的接口按批次实现：

```text
POST /api/topics/:id/evaluate
PUT  /api/topics/:id/decision
POST /api/drafts/:id/hooks
POST /api/drafts/:id/checks/persona
POST /api/drafts/:id/checks/quality
POST /api/drafts/:id/checks/publish
POST /api/performance-snapshots/:id/postmortem
POST /api/postmortem/:id/approve
POST /api/insight-candidates/:id/accept
```

是否引入统一 `workflow_runs` 集合，在实现阶段根据流程审计需求决定。若引入，只保存流程状态和节点结果引用，不复制 topics/drafts/performance 的业务数据。

## 11. 模板与排期

模板版本化和内容日历属于第二阶段：

- 模板不覆盖历史版本。
- 草稿记录模板版本。
- 内容日历只维护内容状态、平台、计划时间、实际时间、关联草稿和表现快照。
- 不建立 Easel 式独立 `outputs/` 资产系统。
- 排期前读取近期发布、待拍、断更和活动上下文。

## 12. 错误处理

统一错误格式：

```json
{
  "status": "failed",
  "code": "missing_context | model_error | validation_failed | blocked",
  "message": "可理解的错误说明",
  "retryable": true,
  "failed_at": "quality_gate",
  "preserved_outputs": []
}
```

要求：

- 缺少上下文时指出具体字段。
- 模型失败时保留输入和已有输出。
- 可重试错误不能重复创建资产。
- 质量阻断必须保留检查结果。
- 样本不足时输出警告，不生成确定结论。
- 任何写回都必须校验当前账号和资源所有权。

## 13. 实施分期

### 子项目 A：内容决策与创作质量链

先做选题评估、Hook、平台版本、人设检查、质量门、发布清单和人工确认。

### 子项目 B：方法库与平台适配体系

再做 Prompt Stack、模板版本、方法表现、内容日历和声音画像增强。

### 子项目 C：表现复盘与经验闭环

最后做复盘归因、经验候选、策略建议和记忆/方法库人工写回。

每个子项目独立设计、实现、测试和验收，不一次性改完全部系统。

## 14. 测试要求

### 后端

- 能力输入校验。
- 状态流转和非法跳转。
- 账号隔离。
- 来源引用完整性。
- 质量阻断不可绕过。
- 人工确认才能写回长期记忆。
- 失败重试和幂等。
- 缺失指标不填零。

### 前端

- 流程状态展示。
- 检查报告展示。
- 修改、回退、重试。
- 多平台版本切换。
- 人工确认。
- 复盘候选确认。

### 端到端

至少覆盖：

```text
研究 → 选题 → 评估 → 草稿 → 检查 → 拍摄 → 表现快照 → 复盘 → 经验候选
```

最终仍须通过项目既有 `npm run verify`。

## 15. 第一阶段验收

第一阶段完成后，用户能够在不离开定位派的情况下：

1. 从研究或素材生成选题。
2. 查看选题七维评估及证据。
3. 确认一个选题进入创作。
4. 选择一个 Hook 并生成草稿。
5. 生成独立的平台版本。
6. 查看人设、质量和发布完整性检查。
7. 修改失败项并重新检查。
8. 确认后进入今日拍摄。
9. 回填表现数据并触发后续复盘入口。

浏览器自动连接和自动发布不属于本阶段验收内容。
