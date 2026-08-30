# Requirements Document: AI 记忆层

Feature Name: ai-memory-layer
Updated: 2026-08-30

## Introduction

工作台需要"越用越懂用户"的进化能力。当前定位档案、素材、选题、草稿已构成事实记忆，本特性补齐偏好与经验记忆：让创作者的风格偏好、选题经验、反馈修正被持久记录、可视化管理，并在选题/草稿生成时自动注入，同时预留向腾讯 TencentDB Agent Memory 或 Mem0 升级的接口。

## Glossary

- **记忆（Memory）**：一条关于创作者的持久事实，形如"我的开头从不用问句"。
- **记忆类型（memory_type）**：style（风格偏好）、topic（选题经验）、feedback（反馈修正）。
- **记忆来源（source）**：manual（用户手动添加）或 auto（LLM 自动提炼，本期预留）。
- **记忆注入**：生成选题/草稿时把 active 记忆组装进生成上下文。
- **记忆提供方（provider）**：builtin（本系统内建）或外部引擎（tencentdb / mem0，预留字段）。

## Requirements

### Requirement 1: 记忆记录管理

**User Story:** AS 个人创作者, I want 手动添加、编辑和删除 AI 应记住的事实, so that 工作台的 AI 行为符合我的预期。

#### Acceptance Criteria

1. 系统 SHALL 提供记忆的增、查、改、删接口，记忆包含 memory_type、content、source、status 字段。
2. WHEN 用户提交新记忆, 系统 SHALL 校验 memory_type 枚举（style/topic/feedback）与 content 非空，并将 source 记为 manual。
3. WHEN 用户归档记忆, 系统 SHALL 将 status 置为 archived，归档记忆停止注入但保留可见。
4. IF 记忆内容重复（同类型同内容已存在且 active）, 系统 SHALL 拒绝创建并提示已存在。

### Requirement 2: 记忆管理面板

**User Story:** AS 个人创作者, I want 在设置页查看和管理全部记忆, so that 我对 AI 记住了什么拥有完全掌控。

#### Acceptance Criteria

1. 系统 SHALL 在工作台设置中提供 AI 记忆面板，按类型分组展示全部记忆（含来源与时间）。
2. WHEN 用户在面板提交表单, 系统 SHALL 创建记忆并就地刷新列表。
3. WHEN 用户点击某条记忆的删除按钮, 系统 SHALL 在二次确认后删除并刷新。
4. 系统 SHALL 在面板中展示自动提炼入口；WHEN 大模型未配置, 系统 SHALL 将其置为不可用并说明原因。

### Requirement 3: 生成时记忆注入

**User Story:** AS 个人创作者, I want 生成草稿时自动应用我的偏好与反馈, so that 产出内容越来越贴合我的风格。

#### Acceptance Criteria

1. WHEN 系统生成草稿, 系统 SHALL 读取全部 active 状态的 style 与 feedback 记忆，组装为"创作风格要求"段落写入草稿正文。
2. WHEN 系统生成选题, 系统 SHALL 在生成上下文中携带 active 记忆数量。
3. IF 无 active 记忆, 系统 SHALL 按现有逻辑生成，正文不出现空段落。

### Requirement 4: 升级接口预留

**User Story:** AS 系统维护者, I want 记忆层预留外部引擎升级口, so that 后续可平滑接入腾讯 Agent Memory 或 Mem0。

#### Acceptance Criteria

1. 系统 SHALL 为每条记忆记录 provider 字段，内建记忆固定为 builtin。
2. 系统 SHALL 提供自动提炼路由（POST /api/memories/extract）骨架；WHEN 大模型未配置, 系统 SHALL 返回 422 与 llm_not_configured 原因码。
