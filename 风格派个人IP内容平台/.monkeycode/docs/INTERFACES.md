# 接口说明

所有接口返回 JSON，开发环境 API 地址为 `http://localhost:3001`，前端通过 `/api` 访问。

- `GET /healthz`、`GET /api/health`：返回 API 进程和当前存储状态，支持 `HEAD` 探活。
- API 响应包含 `x-request-id`；超过限额时返回 `429`、`retry-after` 和可重试标记。

## 数据库迁移命令

- `npm run db:migrate`：读取 `PROJECT_DB_HOST`、`PROJECT_DB_PORT`、`PROJECT_DB_NAME`、`PROJECT_DB_USER` 和 `PROJECT_DB_PASSWORD`，在项目数据库中创建 `app_state` 表并验证当前连接。
- 迁移使用 `CREATE TABLE IF NOT EXISTS`，只操作配置指定的项目数据库，不包含其他项目的数据库凭据。

## 三 API 配置

- `GET /api/api-settings`：返回当前账号的三套配置元数据，只含启用状态、Base URL、模型名和 API Key 掩码。
- `PUT /api/api-settings/text_primary`、`/text_fallback`、`/vision`：保存或更新单套配置；首次保存必须提供完整 API Key，后续不输入 Key 时保留原密文。
- `POST /api/api-settings/{slot}?action=test`：独立验证文本或视觉能力；视觉槽位发送最小图片请求。
- `POST /api/api-settings/migrate`：用户明确确认后迁移旧浏览器的 API 1/API 2 配置。
- 服务端需要 32 字节 `API_CONFIG_ENCRYPTION_KEY`；明文 Key 不进入响应、日志或 JSON 数据文件。

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

## 本地文件夹同步

- `desktop/sync-client.mjs` 支持多个目录配置和稳定监听 TXT、Markdown、Word、PDF、Excel 文件。
- 同一路径的新事件覆盖旧事件，队列落盘；提交后仅保留服务端返回的失败事件。
- 同步清单携带 SHA-256 和 Base64 内容，服务端通过 `POST /api/materials/sync` 接收。
- 本地删除只写入 `source_deleted_at`，云端素材记录保留但默认素材列表不展示。
- `POST /api/materials/sync/:job_id/process`：独立处理一个同步任务；成功后创建素材并写入正文、候选主题、金句和 `sync_job` 来源引用；失败只更新该任务的失败状态。

## 手机截图与视觉解析接口

- `POST /api/private-files`：上传 PNG、JPEG 或 WebP 截图，文件按账号私有存储。
- `POST /api/vision-tasks`：提交一个或多个截图文件 ID，创建 API 3 视觉解析任务。
- `GET /api/vision-tasks/:id`：查询视觉任务状态、原始结果或失败原因。
- `POST /api/vision-tasks/:id/retry`：重试失败任务；处理中任务不可重复提交。
- `POST /api/vision-tasks/:id/matches`：按平台、标题和发布时间生成候选拍摄文案及匹配依据。
- `POST /api/vision-tasks/:id/files`、`DELETE /api/vision-tasks/:id/files/:file_id`：补充或删除任务截图。
- `POST /api/vision-tasks/:id/confirm`：人工选择文案并提交修正后的指标；只有确认后才创建正式表现快照。
- 视觉调用只使用账号的 `vision` 配置，不回退到文本 API；API 3 未配置或调用失败时任务保留。

## 发布与表现接口

- `PUT /api/shooting/:id`：更新今日待拍条目；`status=published` 时可记录 `platform` 和 ISO `published_at`。
- `GET /api/performance-snapshots`：按账号读取表现快照，可用 `draft_id` 或 `shooting_id` 筛选。
- `POST /api/performance-snapshots`：追加表现快照，保存平台、发布时间、采集时间、原始指标、模型原始结果、置信度、修正字段和确认状态。
- 快照没有更新/覆盖接口；缺失指标保持 `null` 或未提供，不自动填充为 0。

## 同步管理接口

- `GET /api/devices`：读取当前账号设备状态。
- `GET /api/sync-directories`：读取当前账号同步目录。
- `POST /api/sync-directories`：添加同步目录并登记设备。
- `PUT /api/sync-directories/:id`：暂停或恢复同步目录。
- `DELETE /api/sync-directories/:id`：移除同步目录配置。
- 同步管理面板读取 `/api/materials/sync` 展示队列，并调用单任务重试接口。

## Electron 桌面 IPC

- 预加载层只暴露登录、会话刷新、退出、开机启动和应用退出方法。
- IPC 通道使用显式白名单；渲染进程不接触会话 Cookie 或 Node.js API。
- 主进程使用 `safeStorage` 加密保存会话，并将会话 Cookie 注入 Electron 会话。

## 热点研究收录

- `POST /api/research/:id/collect`：将当前账号的研究记录收录为 `material_kind=hotspot` 素材。
- 收录素材保留研究记录 ID、平台、热度、原链接、研究来源引用和收录时间。
- 同账号同一研究记录重复收录返回已有素材并标记 `duplicate=true`；不同账号相互隔离。
- 研究列表返回 `collected` 状态，前端显示“收录为素材”或“已收录”。

## 私有文件

- `GET /api/private-files`：读取当前账号文件元数据，不返回服务器存储路径。
- `POST /api/private-files`：以原始二进制请求体上传；文件名通过 `x-file-name`，MIME 使用 `Content-Type`。支持 TXT、Markdown、CSV、Word、PDF、Excel、PNG、JPEG、WebP。
- `GET /api/private-files/:id`：读取当前账号文件元数据。
- `GET /api/private-files/:id/preview`：鉴权后以内联方式预览。
- `GET /api/private-files/:id/download`：鉴权后以附件方式下载。
- 上传按账号和 SHA-256 校验值去重；文件名清洗，存储路径包含账号哈希、UTC 日期和校验值，禁止路径穿越；大小由 `PRIVATE_FILE_MAX_BYTES` 控制。

## 选题与草稿

- `POST /api/topics/generate`：基于研究和素材生成选题；IP 档案缺少角色、受众或内容支柱时返回 `422`、`missing_fields` 和可重试标记。成功结果保留生成上下文、来源与事实风险状态。
- `POST /api/drafts/generate`：为一个选题生成小红书、抖音、视频号和公众号草稿；可传 `hook_text`，服务端会执行 Hook 校验并将生成上下文写入草稿。现有直接组合生成入口保持兼容，选题助手仅对已人工确认的 `approved` 选题开放生成。
- `POST /api/drafts/:id/hooks`：为当前账号草稿生成四个独立 Hook 候选；重复调用默认幂等，传 `{"force":true}` 可重新生成。
- `GET /api/drafts`：读取草稿列表。
- `POST /api/drafts/:id/copy`：复制当前用户的草稿为新的草稿版本。
- `GET /api/drafts/:id/history`：读取草稿版本历史；MVP 至少返回当前版本快照。
- `POST /api/drafts/:id/restore`：使用 `{"version":2}` 恢复历史快照，并生成新的当前版本。
- `PUT /api/drafts/:id`：保存草稿新版本，校验版本号和来源集合；可传 `selected_hook_id` 选择已通过校验的 Hook，选择后进入 `content_ready` 并将 Hook 写入正文开头；修改正文、来源、Hook 或事实状态会清空下游检查并使已有确认失效。通用更新拒绝客户端写入 `approval`、`checks`、`workflow_status`，也不能直接进入 `ready_to_shoot` 或 `published`。
- `POST /api/drafts/:id/checks/persona`：按当前账号 IP 档案检查角色、受众、内容支柱和表达边界；只返回 `passed/warning`，不阻断后续操作。
- `POST /api/drafts/:id/checks/quality`：要求当前版本已做人设检查，返回 Hook、受众、观点、来源、结构/风险五维结果；低分或严重问题返回 `blocked` 并进入 `needs_revision`。
- `POST /api/drafts/:id/checks/publish`：要求质量门通过，检查标题、正文、平台、来源、事实核验、Hook、风险词和版本组；通过后进入 `publish_ready`。
- 三类检查结果均包含 `status`、`score`、`dimensions`、`evidence`、`suggestions`、`draft_version` 和 `checked_at`；同版本重复请求幂等，传 `{"force":true}` 可重跑。已确认草稿需先撤回确认才能重新运行检查或生成 Hook。
- `POST /api/drafts/:id/approve`：请求体为 `{"version":4}`。仅允许当前账号、当前版本、事实已核验且人设/质量/发布检查满足要求的草稿确认；成功保存确认人、时间、版本和检查深拷贝，并按 `owner_id + draft_id` 幂等创建或复用今日拍摄项。原版本重复请求返回同一确认和拍摄项。
- `POST /api/drafts/:id/revoke-approval`：请求体为 `{"version":5,"reason":"需要修改正文"}`。只允许未发布的 `ready_to_shoot` 草稿撤回；保留原确认与检查快照，记录撤回信息并将拍摄项置为 `needs_revision`。原版本重复撤回幂等返回，已发布内容返回 `409`。

## 人工确认与今日拍摄补充

- 确认成功的拍摄项携带 `approval_required` 和 `approval_draft_version`；进入拍摄中、完成或发布状态时服务端会再次校验关联草稿仍为已确认。
- 撤回只改变当前流程状态，不删除来源引用、历史快照或拍摄记录。

## 拍摄与 PWA

- `GET /api/shooting/today`：读取当天拍摄清单。
- `PUT /api/shooting/:id`：按版本号更新待拍、拍摄中、已完成或需修改状态，也可更新提词脚本；版本冲突返回 `409`。
- `GET /api/sync/conflicts`：读取当前用户未解决的草稿和拍摄清单同步冲突。
- `POST /api/sync/conflicts/:id`：使用 `local`、`remote` 或带 `patch` 的 `merge` 解决冲突，并返回更新后的资源。

前端提供 `/manifest.webmanifest` 和 `/sw.js`，支持安装入口和基础 shell 缓存。

草稿默认标记为 `needs_review`，发布前需要完成事实核验。

## 内容能力上下文

- `server/content-capabilities.mjs` 提供 `listCapabilities()`、`getCapability(id)` 和 `isCapabilityId(id)`，登记第一阶段的 10 项可控能力。
- `server/content-context.mjs` 提供 `buildContentContext(state, options)`，按 `ownerId`、选题/草稿 ID 和显式资源 ID 组装账号、策略、研究、素材、方法、记忆和表现上下文。
- 上下文只读取当前账号资源；未选择的集合不自动加载全部数据；`api_configs` 不进入上下文，敏感键名会被过滤。
- 缺少 `ownerId` 返回 `error.code=missing_context`；指定的选题或草稿不存在或无权访问时返回 `error.code=resource_not_found`。

## 选题七维评估

- `POST /api/topics/:id/evaluate`：仅评估当前账号选题；读取账号 IP 档案及选题 `source_refs` 指向的研究/素材，返回 `evaluation.score`、七个 `dimensions`、逐条 `evidence` 和 `suggestions`，并将 `workflow_status` 置为 `evaluated`。
- `PUT /api/topics/:id/decision`：接受 `decision=do|revise|defer` 及可选 `reason`。只有已评估选题可决策；`do` 进入 `approved`，`revise/defer` 进入 `needs_revision`，原始选题不会删除。
- 评估综合分按七维平均值计算：70 分及以上为 `do`，50–69 分为 `revise`，50 分以下为 `defer`。每维分数限制在 0–100。
- 没有研究热度数据时只输出“无可用数据”的证据和建议，不推断热度；重复评估默认返回已有结果，调整方向后可重新评估。

## 第一阶段质量门兼容约定

- 旧选题和草稿缺少新流程字段时由启动归一化补安全默认值；已有评估、Hook、检查、确认及来源字段不得被覆盖。
- 旧拍摄记录没有 `approval_required` 时继续按历史规则可用；Task 5 新建拍摄项必须校验关联草稿仍处于当前版本已确认状态。
- 任务 1–5 的选题、草稿、检查、确认、撤回及拍摄接口均按 `owner_id` 隔离，越权资源统一返回 `404 resource_not_found`。
- 内容上下文不得包含 `api_configs` 或嵌套的 Key、密码、Token、私钥字段；公开 API 配置只返回掩码和固定能力角色。
