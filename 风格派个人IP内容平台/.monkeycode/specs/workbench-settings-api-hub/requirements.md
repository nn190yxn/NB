# Requirements Document — 工作台设置与 API 中心

Updated: 2026-08-30

## Introduction

为个人 IP 内容工作台提供统一的"工作台设置"面板：修复当前"工作台设置"按钮误开策略复盘面板的语义错位；集中外观设置（主题、字体）；新增"API 中心"分区，用户可在其中配置红狐 API 与自定义大模型 API，并验证连通性。

## Glossary

- **设置面板**：工作台侧栏"工作台设置"按钮打开的覆盖层面板
- **API 中心**：设置面板中管理外部 API 配置的分区
- **大模型 API**：OpenAI 兼容接口的 LLM 服务（Base URL + API Key + 模型名）
- **红狐 API**：RedFox 内容研究数据服务（Base URL + API Key）
- **API 配置**：某外部服务的 Base URL、API Key、模型名（如适用）的集合

## Requirements

### Requirement 1 — 设置入口

**User Story:** AS 创作者，I want 点击"工作台设置"打开设置面板，so that 我能集中管理外观与 API 配置。

#### Acceptance Criteria

1. WHEN 用户点击侧栏"工作台设置"，系统 SHALL 打开设置面板覆盖层。
2. WHEN 用户点击面板关闭按钮、遮罩区域或按 Esc，系统 SHALL 关闭设置面板并保持既有状态。
3. 系统 SHALL 在打开设置面板时保持当前工作区内容与滚动位置。

### Requirement 2 — 外观设置

**User Story:** AS 创作者，I want 在设置面板中切换主题与字体，so that 界面符合我的审美偏好。

#### Acceptance Criteria

1. WHEN 用户在设置面板选择某主题，系统 SHALL 立即应用该主题并标记为当前选中。
2. WHEN 用户在设置面板选择某字体，系统 SHALL 立即应用该字体并标记为当前选中。
3. 主题与字体的选择 SHALL 与既有 ThemeMenu 保持同一持久化机制（字体 localStorage、主题当前会话生效）。

### Requirement 3 — 大模型 API 配置

**User Story:** AS 创作者，I want 配置我自己的大模型 API（Base URL、API Key、模型名），so that 后续内容生成能力使用我的账号与额度。

#### Acceptance Criteria

1. 设置面板 SHALL 提供大模型 API 的 Base URL、API Key、模型名三个输入项。
2. WHEN 用户保存大模型 API 配置，系统 SHALL 将配置持久化到本地浏览器存储并在界面显示已保存状态。
3. WHEN 用户点击"测试连接"，系统 SHALL 通过服务端向该服务发起连通性测试并返回成功或失败原因。
4. IF 测试失败，系统 SHALL 显示失败原因且保留用户已输入的配置。
5. API Key 输入 SHALL 以掩码形式显示且已保存的 Key 在重新打开面板时保持掩码。

### Requirement 4 — 红狐 API 配置

**User Story:** AS 创作者，I want 配置我自己的红狐 API（Base URL、API Key），so that 热点研究使用我的红狐账号。

#### Acceptance Criteria

1. 设置面板 SHALL 提供红狐 API 的 Base URL 与 API Key 两个输入项。
2. WHEN 用户保存红狐 API 配置，系统 SHALL 持久化到本地浏览器存储。
3. WHEN 用户点击"测试连接"，系统 SHALL 通过服务端向红狐服务发起连通性测试并返回结果。

### Requirement 5 — 密钥安全

**User Story:** AS 创作者，I want 我的 API Key 不被写入服务端数据库，so that 泄露风险最小化。

#### Acceptance Criteria

1. 系统 SHALL 将 API 配置（含 Key）仅持久化在浏览器 localStorage。
2. WHEN 前端发起需要外部 API 的请求，系统 SHALL 通过请求头将 API 配置透传给服务端。
3. 服务端 SHALL 使用请求头中的 API 配置处理本次请求且不将 Key 写入数据库或日志。
4. 服务端 SHALL 在测试连通性时仅使用请求体中的配置且不记录请求体内容。

### Requirement 6 — 红狐配置接入研究刷新

**User Story:** AS 创作者，I want 热点研究刷新优先使用我在 API 中心配置的红狐 API，so that 研究数据来自我的账号。

#### Acceptance Criteria

1. WHEN 用户发起研究刷新且请求头携带红狐 API 配置，系统 SHALL 使用该配置调用红狐服务。
2. IF 请求头未携带红狐配置，系统 SHALL 回退到服务端环境变量配置（现有行为）。
3. WHEN 红狐调用失败，系统 SHALL 返回现有错误语义（429/502 与 retryable 标记）。
