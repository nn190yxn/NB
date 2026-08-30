# Requirements Document: 素材原子化与组合创作

Feature Name: material-atomization
Updated: 2026-08-30

## Introduction

素材库当前以整篇文章为主要形态，金句、热点关键词、知识点等有价值的片段只作为文章详情中的只读提取结果存在，选题和创作时难以直接取用。本特性为素材引入类型维度（文章 / 金句 / 热点 / 知识点 / 经历），支持把文章中的提取结果收为独立原子素材，并在内容创作时把热点、结构、金句、经历组合生成文案资产，打通"热点 + 经历 + 爆款结构 + 金句 → 文案"的创作链路。

## Glossary

- **原子素材**：以单条金句、热点关键词、知识点或个人经历为单位的小颗粒素材，material_kind 不为 article 的素材记录。
- **素材类型（material_kind）**：素材的形态标签，枚举：article（文章）、quote（金句）、hotspot（热点关键词）、insight（知识点/案例）、experience（个人经历）。
- **收为素材**：把文章详情中某条提取结果（金句/候选主题）转化为独立原子素材的操作，来源链路指向原文。
- **组合生成**：在内容创作中选择选题（或热点）+ 爆款结构 + 若干金句/经历素材，一次性生成多平台草稿。
- **来源链路（source_refs）**：记录素材、选题、草稿之间引用关系的追溯字段，沿用现有 sourceRef 机制。

## Requirements

### Requirement 1: 素材类型维度

**User Story:** AS 个人创作者, I want 素材按类型分类展示, so that 我能按用途快速定位金句、热点或知识点。

#### Acceptance Criteria

1. 系统 SHALL 为素材记录提供 material_kind 字段，枚举为 article、quote、hotspot、insight、experience，历史素材默认为 article。
2. WHEN 用户打开素材库, 系统 SHALL 展示类型筛选行（全部/文章/金句/热点/知识点/经历）并显示各类型计数。
3. WHEN 用户选择某类型筛选, 系统 SHALL 仅返回该类型的素材。
4. WHEN 用户手动新建素材, 系统 SHALL 允许选择素材类型。
5. IF 素材为原子素材, 系统 SHALL 在列表行展示其类型标签与来源文章标题。

### Requirement 2: 从文章收为原子素材

**User Story:** AS 个人创作者, I want 把文章详情里的金句或候选主题一键收为独立素材, so that 高价值片段可以脱离原文被检索和复用。

#### Acceptance Criteria

1. WHEN 用户在素材详情中点击某条金句的"收为素材", 系统 SHALL 创建一条 material_kind 为 quote 的原子素材，内容为该金句原文，来源链路指向源文章。
2. WHEN 用户在素材详情中点击某条候选主题的"收为素材", 系统 SHALL 创建一条 material_kind 为 hotspot 的原子素材，内容为该主题文本，来源链路指向源文章。
3. WHEN 收为素材成功, 系统 SHALL 在原位置将该条目标记为"已收录"，并支持点击跳转查看。
4. IF 原子素材已存在且来源链路相同, 系统 SHALL 停止重复创建并提示已收录。

### Requirement 3: 组合生成文案

**User Story:** AS 个人创作者, I want 选定热点主题、爆款结构、金句和个人经历后一键生成文案, so that 创作素材在草稿中自动就位，我只需补充表达并口播。

#### Acceptance Criteria

1. 系统 SHALL 在内容创作页提供组合生成面板，包含选题（或热点关键词）、爆款结构（可选）、金句素材（多选）、经历素材（多选）四类输入。
2. WHEN 用户提交组合生成, 系统 SHALL 为四个平台各生成一份草稿，正文按顺序组装：开场场景、结构步骤、选中的金句与经历、行动指引。
3. WHEN 组合生成完成, 系统 SHALL 把全部被引用素材与结构写入草稿的来源链路。
4. IF 用户未选择任何金句与经历, 系统 SHALL 允许生成，正文仅包含场景与结构。
5. IF 选题输入为空且未选择结构, 系统 SHALL 拒绝生成并提示至少需要一个创作锚点。

### Requirement 4: 类型数据向后兼容

**User Story:** AS 系统维护者, I want 历史素材在新版本中正常展示, so that 升级过程不影响已有数据。

#### Acceptance Criteria

1. 系统 SHALL 在读取无 material_kind 字段的历史素材时按 article 处理。
2. WHEN 原子素材被删除, 源文章的提取结果 SHALL 恢复为未收录状态。

## Notes

- 已确认决策（2026-08-30）：类型体系采用五类（article/quote/hotspot/insight/experience）；原子素材同时支持"从文章一键收录"与"手动新建"；组合生成面板位于内容创作页。
- 现有提取逻辑（server/index.mjs:415）基于行长启发式，本期不改提取算法，只增加"收为素材"的转化链路；语义级提取留给大模型接入后迭代。
- 经历素材与 IP 档案的关系：本期经历作为普通素材类型存在，暂与档案数据解耦。
