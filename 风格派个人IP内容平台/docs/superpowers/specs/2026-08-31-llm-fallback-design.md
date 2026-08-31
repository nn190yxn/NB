# 双大模型 API 主备兜底设计

日期：2026-08-31
状态：已获用户确认，待实施计划

## 目标

在现有「工作台设置 → API 中心」增加第二组 OpenAI 兼容大模型配置。两个 API 都保存在浏览器本地，由服务端在单次请求内按主备顺序调用，提升选题、草稿和 AI 记忆能力的可用性。

## 配置模型

前端 `localStorage` 的 `dingweipai:api-settings` 中，将现有 `llm` 配置扩展为：

```ts
llm: {
  primary: { base_url: string; api_key: string; model: string },
  fallback: { base_url: string; api_key: string; model: string }
}
```

兼容迁移：如果检测到旧格式 `llm: { base_url, api_key, model }`，自动映射为 `llm.primary`，`fallback` 为空。API Key 不写入服务端数据库或日志。

## 界面

设置页将现有“大模型 API”拆成“API 1（主用）”和“API 2（备用）”两张配置卡。两张卡都提供 Base URL、API Key、模型名和测试连接按钮，并保留现有保存配置行为。测试结果分别展示，不因备用 API 未配置而阻止 API 1 使用。

## 调用架构

服务端增加统一的大模型调用层，例如 `callLlmWithFallback()`：

1. 读取请求头中的 API 1 和 API 2 配置。
2. 优先调用 API 1。
3. API 1 网络错误、超时、HTTP 4xx/5xx、空响应或响应格式无效时，调用 API 2。
4. API 1 成功时不调用 API 2。
5. 两者都失败时返回统一错误。
6. 两者都未配置时继续使用现有确定性规则引擎，不影响当前功能。

请求头使用明确的主备前缀：

```text
x-llm-primary-base-url
x-llm-primary-api-key
x-llm-primary-model
x-llm-fallback-base-url
x-llm-fallback-api-key
x-llm-fallback-model
```

选题生成、草稿生成、AI 记忆自动提炼及后续大模型能力均通过该调用层，不在各业务路由重复实现兜底。

## 错误与可观测性

- API 1 成功：用户无感知。
- API 1 失败、API 2 成功：正常返回，并在服务端内部保留使用备用 API 的结果标识；不记录 Key 或完整请求内容。
- 两个 API 都失败：返回“两个大模型 API 均不可用”及可重试标识。
- 测试连接结果分别反馈成功、HTTP 错误、超时或响应格式错误。

## 验收标准

- 旧版单 API 配置无需重新录入。
- 两组配置可保存、刷新后读取，并仅存在浏览器 localStorage。
- API 1 成功时 API 2 不被调用。
- API 1 失败时 API 2 自动接管。
- 两者失败时错误可识别且不会产生半成品数据。
- 未配置 API 时现有规则引擎继续工作。
- 选题、草稿、AI 记忆三类调用共用同一套兜底逻辑。
- 现有测试、类型检查和构建全部通过。

## 非目标

- 本次不改为服务端统一保存 Key。
- 本次不做两个模型的智能质量评分、结果合并或并行竞速。
- 本次不改变现有选题业务规则和数据结构。
