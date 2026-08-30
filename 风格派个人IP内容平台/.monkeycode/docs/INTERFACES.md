# 接口说明

所有接口返回 JSON，开发环境 API 地址为 `http://localhost:3001`，前端通过 `/api` 访问。

- `GET /healthz`、`GET /api/health`：返回 API 进程和当前存储状态，支持 `HEAD` 探活。
- API 响应包含 `x-request-id`；超过限额时返回 `429`、`retry-after` 和可重试标记。

## 数据库迁移命令

- `npm run db:migrate`：读取 `PROJECT_DB_HOST`、`PROJECT_DB_PORT`、`PROJECT_DB_NAME`、`PROJECT_DB_USER` 和 `PROJECT_DB_PASSWORD`，在项目数据库中创建 `app_state` 表并验证当前连接。
- 迁移使用 `CREATE TABLE IF NOT EXISTS`，只操作配置指定的项目数据库，不包含其他项目的数据库凭据。

## 定位与档案

- `GET /api/positioning`：读取定位、目标和访谈答案。
- `PUT /api/positioning`：更新定位状态、目标或访谈答案。
- `POST /api/positioning/generate-keywords`：根据当前定位和 IP 档案生成关键词组、主题组、素材类型和平台研究建议。
- `POST /api/positioning/candidates`：根据访谈答案生成三个带评分、来源和目标关联的定位候选。
- `PUT /api/positioning/candidates/:id`：确认或拒绝定位候选；确认后写入当前定位版本。
- `GET /api/profile`：读取 IP 档案。
- `PUT /api/profile`：更新角色、受众、问题、内容支柱和表达偏好。
- `POST /api/profile/import`：从文本档案提取可识别字段，生成待审核条目并保留未识别内容。
- `GET /api/profile/reviews`：读取当前用户的档案待审核条目。
- `PUT /api/profile/reviews/:id`：确认或拒绝档案待审核条目，确认后写入 IP 档案和来源引用。
  请求可附带 `fields` 对已提取的 `role`、`audiences`、`pillars` 和 `viewpoints` 进行修改后再确认。

## 内容策略

- `GET /api/content-strategy`：读取当前阶段和比例。
- `PUT /api/content-strategy`：更新比例，三项总和必须为 100。
- `POST /api/content-strategy/reviews`：生成最近 14 天复盘建议。
- `POST /api/content-strategy/recommend`：根据当前阶段生成策略比例和内容任务建议。
- `POST /api/content-strategy/versions`：确认并保存新的策略版本。
- `GET /api/content-strategy/versions`：读取策略版本历史。

## 素材与研究

- `GET /api/materials`：读取素材列表。
- `POST /api/materials/import`：导入文本、链接或文件元数据，自动推断常见文件格式；解析失败仍保留素材记录并返回 `status: failed`，重复 checksum 返回 `duplicate: true`。同步导入时会保留 `source_path`。
- `POST /api/materials/upload`：接收桌面同步客户端确认的素材内容，使用与手动导入相同的格式推断、解析、去重和来源记录规则。
- `DELETE /api/materials/:id`：撤回当前用户的素材，保留审计记录并从默认列表排除。
- `POST /api/materials/:id/retry`：使用补充正文或 URL 重试失败素材解析。
- `POST /api/materials/sync`：提交桌面同步清单，按用户、设备和 checksum 去重，返回 `202` 及队列结果；缺少文件名和相对路径的条目进入 `failed` 状态并返回原因；`type: deleted` 会按 `source_path` 执行素材软删除并返回 `withdrawn`。
- `POST /api/materials/sync/:job_id/retry`：重置失败同步任务为可重试队列。
- `GET /api/research`：读取研究条目。
- `POST /api/research/refresh`：刷新研究条目；配置 `REDFOX_API_URL` 后调用 RedFox，未配置时使用 MVP 样例。RedFox 额度不足返回 `429` 并保留上次成功数据，其他上游错误返回 `502`。上游暂时不可用、`5xx` 或无效响应时返回 `retryable: true`，额度或其他不可重试错误返回 `retryable: false`。
- `POST /api/research/:id/analyze`：生成包含 Hook、受众、痛点、论点、结构、金句、CTA、证据引用、可迁移模式和置信度的爆款结构分析。

## 选题与草稿

- `POST /api/topics/generate`：基于研究和素材生成选题；IP 档案缺少角色、受众或内容支柱时返回 `422`、`missing_fields` 和可重试标记。成功结果保留生成上下文、来源与事实风险状态。
- `POST /api/drafts/generate`：为一个选题生成小红书、抖音、视频号和公众号草稿。
- `GET /api/drafts`：读取草稿列表。
- `POST /api/drafts/:id/copy`：复制当前用户的草稿为新的草稿版本。
- `GET /api/drafts/:id/history`：读取草稿版本历史；MVP 至少返回当前版本快照。
- `POST /api/drafts/:id/restore`：使用 `{"version":2}` 恢复历史快照，并生成新的当前版本。
- `PUT /api/drafts/:id`：保存草稿新版本，校验版本号和来源集合；标记为 `ready_to_shoot` 时加入拍摄清单，标记为 `published` 前必须将 `fact_check_status` 更新为 `verified`。

## 拍摄与 PWA

- `GET /api/shooting/today`：读取当天拍摄清单。
- `PUT /api/shooting/:id`：按版本号更新待拍、拍摄中、已完成或需修改状态，也可更新提词脚本；版本冲突返回 `409`。
- `GET /api/sync/conflicts`：读取当前用户未解决的草稿和拍摄清单同步冲突。
- `POST /api/sync/conflicts/:id`：使用 `local`、`remote` 或带 `patch` 的 `merge` 解决冲突，并返回更新后的资源。

前端提供 `/manifest.webmanifest` 和 `/sw.js`，支持安装入口和基础 shell 缓存。

草稿默认标记为 `needs_review`，发布前需要完成事实核验。
