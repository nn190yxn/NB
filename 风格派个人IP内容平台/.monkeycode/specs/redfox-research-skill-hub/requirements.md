# Requirements Document — 热点研究 × 红狐 Skill 融合

Updated: 2026-08-30

## Introduction

将"热点研究"从静态示例升级为以红狐（RedFox，redfox.hk）为数据源的真实研究工作区：支持关键词输入与系统推荐、平台筛选、以及红狐 Skill 的启用管理与工作台融合。红狐提供 10+ 平台的公开数据 API（`X-API-KEY: ak_xxx` 认证）与 100+ 新媒体 Skill（热搜榜、爆文搜索、相似账号、违禁词检测等）。

## Glossary

- **红狐 API**：RedFox 数据平台接口，基址可配置（默认 `https://redfox.hk`），认证头 `X-API-KEY: ak_xxx`
- **Skill**：红狐封装好的数据采集/分析能力单元，如微博热搜榜、小红书爆文搜索、违禁词检测
- **关键词**：用于搜索热点内容的查询词
- **推荐关键词**：系统从用户定位支柱、素材提取字段、历史研究热词生成的候选查询词
- **Skill 目录**：工作台内置的红狐 Skill 清单，含名称、用途、融合位置说明

## Requirements

### Requirement 1 — 关键词搜索

**User Story:** AS 创作者，I want 输入关键词搜索各平台热点内容，so that 带着明确目标研究我的领域热点。

#### Acceptance Criteria

1. WHEN 用户在热点研究输入关键词并提交，系统 SHALL 通过服务端调用红狐搜索并展示结构化结果（标题、作者、互动数据、平台）。
2. WHEN 搜索结果返回，系统 SHALL 将结果写入研究库并保留关键词来源标记。
3. IF 红狐调用失败，系统 SHALL 展示失败原因且保留已有研究数据（维持现有 429/502 语义）。
4. WHEN 用户未配置红狐 API Key，系统 SHALL 使用内置示例数据并明确标注来源为演示。

### Requirement 2 — 关键词推荐

**User Story:** AS 创作者，I want 系统根据我的定位与素材推荐关键词，so that 没有明确搜索目标时也能快速出发。

#### Acceptance Criteria

1. WHEN 用户打开热点研究，系统 SHALL 展示推荐关键词列表，来源为定位支柱、素材候选话题与已有研究热词。
2. WHEN 用户点击某推荐关键词，系统 SHALL 以该关键词执行搜索。
3. IF 无任何推荐来源，系统 SHALL 展示领域通用关键词占位（个人 IP、内容创业等）。

### Requirement 3 — 平台筛选

**User Story:** AS 创作者，I want 搜索时选择目标平台，so that 研究聚焦我运营的平台。

#### Acceptance Criteria

1. 系统 SHALL 在搜索区提供平台筛选（全平台、小红书、抖音、视频号、公众号、B站、微博、X）。
2. WHEN 用户选择平台后搜索，系统 SHALL 将平台参数传递给红狐调用。
3. 搜索结果的平台标签 SHALL 与筛选一致。

### Requirement 4 — 红狐 Skill 目录与启用管理

**User Story:** AS 创作者，I want 查看红狐有哪些可用 Skill 并选择启用，so that 我能控制哪些能力融合进工作台。

#### Acceptance Criteria

1. 系统 SHALL 提供内置 Skill 目录，每个条目含名称、能力说明与融合位置。
2. WHEN 用户启用某 Skill，系统 SHALL 持久化该选择并在对应工作台位置暴露该能力入口。
3. WHEN 用户禁用某 Skill，系统 SHALL 隐藏对应入口且保留启用状态记录。
4. Skill 目录 SHALL 支持后续扩展新条目。

### Requirement 5 — Skill 融合：热搜榜

**User Story:** AS 创作者，I want 一键拉取所选平台的实时热搜榜，so that 快速发现当下热点。

#### Acceptance Criteria

1. WHEN 用户启用"热搜榜" Skill 并点击"拉取热搜"，系统 SHALL 通过服务端调用红狐热搜榜并展示带排名的结构化列表。
2. WHEN 用户对某热搜条目点击"入库研究"，系统 SHALL 将该条目写入研究库。

### Requirement 6 — Skill 融合：违禁词检测

**User Story:** AS 创作者，I want 对草稿做违禁词检测，so that 发布前规避限流与删文风险。

#### Acceptance Criteria

1. WHEN 用户启用"违禁词检测" Skill，内容创作每条草稿 SHALL 出现"合规检查"入口。
2. WHEN 用户点击"合规检查"，系统 SHALL 通过服务端调用红狐违禁词检测并展示命中词与风险提示。
3. IF 检测调用失败，系统 SHALL 显示失败原因且不影响草稿编辑。

### Requirement 7 — 密钥与计费安全

**User Story:** AS 创作者，I want 我的红狐 API Key 不被服务端持久化，so that 积分与密钥安全可控。

#### Acceptance Criteria

1. 红狐配置（Base URL、API Key）SHALL 仅存浏览器 localStorage 并随请求头透传。
2. 服务端 SHALL 优先使用请求头配置，未携带时回退环境变量（现有行为）。
3. 服务端日志 SHALL 记录调用结果状态而记录密钥值。

### Requirement 8 — 真实调用与演示数据双轨

**User Story:** AS 创作者，I want 未配置真实 Key 时依然能体验完整流程，so that 配置前不被阻塞。

#### Acceptance Criteria

1. WHEN 红狐配置缺失，所有 Skill 调用 SHALL 返回内置演示数据并标注 `source: 'demo'`。
2. WHEN 红狐配置存在，系统 SHALL 调用真实端点且结果标注 `source: 'redfox'`。
3. 真实端点路径 SHALL 支持通过配置覆盖，以适配红狐文档演进。
