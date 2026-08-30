# Requirements Document — 爆款结构库可检索化

Feature Name: structure-library-retrieval
Updated: 2026-08-30

## Introduction

爆款结构库当前以大卡片网格展示一两条示例数据，结构条目依附于热点研究数据，缺少独立存储、搜索、筛选、排序和分页能力。当条目增长到几十条、几百条时，用户无法快速定位目标结构。本需求将爆款结构升级为一等内容资产：独立存储、可检索、可筛选、可排序、可收藏，并与内容创作形成"找到结构 → 用结构写稿"的动作链路。同一检索模式未来可复制到素材库与热点研究。

## Glossary

- **结构条目（Structure）**：从高表现内容提炼的可复用写作框架，包含标题、步骤序列、平台适配、内容类型、来源引用与使用统计。
- **内容类型（Content Type）**：结构适用的写作范式，如观点、案例、清单、故事、对比、教程。
- **检索视图（Retrieval View）**：以紧凑列表呈现条目、面向快速定位的高密度视图。
- **浏览视图（Browse View）**：以卡片呈现条目、面向学习与灵感浏览的视图。
- **使用计数（Usage Count）**：结构被用于生成草稿的累计次数。

## Requirements

### Requirement 1: 结构条目独立存储

**User Story:** AS 内容创作者, I want 每条爆款结构作为独立资产保存, SO THAT 结构库可以持续积累并独立于热点研究数据增长。

#### Acceptance Criteria

1. THE system SHALL 为每条结构条目存储标题、步骤序列、平台、内容类型、来源引用、收藏状态、使用计数、创建时间与更新时间。
2. WHEN 系统从热点研究提取结构拆解, THE system SHALL 将拆解结果保存为独立的结构条目并关联来源。
3. WHEN 用户从结构生成草稿, THE system SHALL 将对应结构的使用计数增加 1。

### Requirement 2: 关键词检索

**User Story:** AS 内容创作者, I want 通过关键词搜索结构库, SO THAT 我能在几百条结构中直接定位目标框架。

#### Acceptance Criteria

1. WHEN 用户在结构库输入关键词, THE system SHALL 返回标题或任一步骤文本匹配关键词的结构条目。
2. WHEN 检索结果为空, THE system SHALL 展示空状态提示与清除筛选动作。
3. WHILE 检索词未变化且结果已展示, THE system SHALL 保持结果顺序稳定以便用户对照。

### Requirement 3: 筛选与排序

**User Story:** AS 内容创作者, I want 按平台、内容类型和收藏状态筛选结构并排序, SO THAT 我能按创作场景缩小范围。

#### Acceptance Criteria

1. WHEN 用户选择平台筛选, THE system SHALL 仅显示适配该平台的结构条目。
2. WHEN 用户选择内容类型筛选, THE system SHALL 仅显示该类型的结构条目。
3. WHEN 用户选择"收藏"筛选, THE system SHALL 仅显示已收藏的结构条目。
4. THE system SHALL 提供按最新、按使用次数、按收藏优先三种排序方式。

### Requirement 4: 双视图与分页

**User Story:** AS 内容创作者, I want 在卡片浏览与列表检索两种视图间切换, SO THAT 学习时看得舒服、找目标时效率优先。

#### Acceptance Criteria

1. THE system SHALL 提供浏览视图与检索视图两种展示方式并支持随时切换。
2. WHEN 结构条目总数超过 12 条, THE system SHALL 默认展示检索视图。
3. WHEN 结果数量超过单页容量 50 条, THE system SHALL 分批加载其余条目。

### Requirement 5: 结构详情与创作链路

**User Story:** AS 内容创作者, I want 查看结构完整拆解并直接用该结构开始创作, SO THAT 找到结构后可以立即进入写作。

#### Acceptance Criteria

1. WHEN 用户点击结构条目, THE system SHALL 展开展示完整步骤、来源引用与定位匹配理由。
2. WHEN 用户在详情中点击"用这个结构", THE system SHALL 携带该结构跳转到内容创作并生成草稿初稿。

### Requirement 6: 收藏持久化

**User Story:** AS 内容创作者, I want 收藏常用结构, SO THAT 高频框架始终触手可及。

#### Acceptance Criteria

1. WHEN 用户收藏或取消收藏结构条目, THE system SHALL 持久化收藏状态并在设备间同步。

### Requirement 7: 结构手动管理

**User Story:** AS 内容创作者, I want 手动新增、编辑和删除结构条目, SO THAT 我自己的写作框架也能沉淀进结构库。

#### Acceptance Criteria

1. WHEN 用户点击"添加结构", THE system SHALL 提供包含标题、步骤序列、平台与内容类型的表单。
2. WHEN 用户提交空标题或空步骤的结构表单, THE system SHALL 阻止保存并提示必填项。
3. WHEN 用户编辑结构条目, THE system SHALL 保存修改并更新该条目的更新时间。
4. WHEN 用户删除结构条目, THE system SHALL 展示确认提示并在确认后删除。
5. IF 已删除的结构曾被用于生成草稿, THE system SHALL 保留草稿内容并将草稿中的结构来源标记为已删除。
