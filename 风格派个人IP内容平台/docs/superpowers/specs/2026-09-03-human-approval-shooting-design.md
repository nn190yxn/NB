# 人工确认与今日拍摄衔接设计

- 日期：2026-09-03
- 作者：Monkeycode
- 状态：已实现，待用户验收
- 上游设计：`docs/superpowers/specs/2026-09-03-easel-inspired-content-workflow-design.md`
- 前置实现：Task 4 人设、质量和发布完整性检查

## 1. 目标

在质量检查完成后增加人工确认节点，将确认后的草稿安全、幂等地衔接到现有今日拍摄清单。确认记录必须可追溯、可回退，且不破坏现有拍摄、发布记录、表现快照和账号隔离能力。

## 2. 范围与非目标

本任务包含：

- 专用人工确认接口；
- 确认快照、确认人、确认时间和撤回信息；
- 草稿到今日拍摄清单的原子衔接；
- 未确认、质量阻断和事实未核验的状态保护；
- 内容创作页的确认、撤回和状态展示；
- 选题确认到今日拍摄的端到端测试。

本任务不包含：

- 浏览器自动连接；
- 自动发布；
- 人工审批流或多人审批；
- 今日拍摄页面重构；
- Task 6 阶段性总检查之外的架构替换。

## 3. 方案选择

采用专用接口并在确认接口内完成拍摄项衔接：

```text
POST /api/drafts/:id/approve
POST /api/drafts/:id/revoke-approval
```

确认接口一次完成前置校验、确认记录写入、草稿状态更新和 shooting 幂等创建，避免“草稿已确认但拍摄项未创建”的中间状态。

不采用：

- 仅通过 `PUT /api/drafts/:id` 更新确认字段：接口语义和权限边界混杂；
- 确认与入拍摄分两次请求：两次请求之间可能形成不一致；
- 由拍摄列表动态发现 `ready_to_shoot` 草稿：会改变现有 shooting 数据模型，并影响表现快照链路。

## 4. 数据结构

沿用现有 `draft.approval`，补充确认版本和检查快照：

```json
{
  "approval": {
    "status": "pending | approved | revoked",
    "user_id": null,
    "approved_at": null,
    "revoked_at": null,
    "revoked_by": null,
    "revoke_reason": null,
    "draft_version": null,
    "checks_snapshot": null
  }
}
```

`checks_snapshot` 保存确认时的人设、质量和发布清单结果的深拷贝；不因后续草稿修改而改变。确认只引用当前草稿版本，不能使用旧版本检查结果完成确认。

旧草稿启动时补充默认 `approval`，不覆盖已有确认记录。旧拍摄记录继续按照既有字段读取。

## 5. 状态流转

```text
draft / content_ready
  → persona_checked
  → quality_checked
  → publish_ready
  → ready_to_shoot
  → shooting / published

ready_to_shoot → needs_revision（撤回确认）
```

### 5.1 确认前置条件

当前草稿必须满足：

- `checks.persona.draft_version === draft.version`；
- `checks.quality.draft_version === draft.version` 且状态为 `passed`；
- `checks.publish_checklist.draft_version === draft.version` 且状态为 `passed`；
- `fact_check_status === verified`；
- 不存在当前版本的阻断检查；
- 请求的 `version` 等于当前草稿版本。

任一条件不满足都返回 `409 invalid_transition`，不修改草稿、确认记录或拍摄清单。

### 5.2 确认成功

一次保存中完成：

1. 写入 `approval.status = approved`；
2. 保存当前用户、时间、草稿版本和检查快照；
3. 设置 `workflow_status = ready_to_shoot`；
4. 设置兼容字段 `status = ready_to_shoot`；
5. 按 `owner_id + draft_id` 查找今日拍摄项；
6. 已存在则复用，不存在则创建；
7. 复制平台、标题、正文、策略字段、目标字段和 `source_refs`。

重复确认同一版本返回已保存结果，不创建重复 shooting 项。版本变化后必须重新完成人设、质量和发布检查。

### 5.3 撤回确认

`revoke-approval` 只允许当前用户将未发布草稿从 `ready_to_shoot` 回退到 `needs_revision`：

- 写入撤回人、撤回时间和原因；
- 保留原确认信息和检查快照；
- 将对应 shooting 项标记为 `needs_revision`；
- 不删除历史记录和来源引用；
- 撤回后重新检查并确认才能再次进入拍摄。

已进入 `published` 的草稿或拍摄项不允许撤回。

## 6. API 契约

### `POST /api/drafts/:id/approve`

请求：

```json
{ "version": 4 }
```

成功返回当前草稿和 shooting 记录：

```json
{
  "status": "approved",
  "draft": {
    "id": 12,
    "workflow_status": "ready_to_shoot",
    "approval": {
      "status": "approved",
      "user_id": "current-user",
      "approved_at": "ISO-8601",
      "draft_version": 4,
      "checks_snapshot": {}
    }
  },
  "shooting": {}
}
```

错误：

- 不存在或越权：`404 resource_not_found`；
- 版本冲突：`409 version_conflict`；
- 检查未完成、阻断或事实未核验：`409 invalid_transition`；
- 缺少或非法版本：`422 validation_failed`。

### `POST /api/drafts/:id/revoke-approval`

请求：

```json
{ "version": 5, "reason": "需要修改正文" }
```

按同样的版本和账号边界处理。重复撤回同一版本返回已保存结果，不重复追加历史或改变已发布记录。

## 7. 前端交互

在现有草稿卡片中复用 Task 4 检查区：

- 发布清单通过后显示“确认进入拍摄”；
- 确认中显示忙碌状态，避免重复提交；
- 确认成功后显示“已确认”、确认人、时间和“查看今日拍摄”；
- 已确认且未发布时显示“撤回确认”；
- 撤回后显示“需要修改”，保留检查结果快照提示；
- 阻断或事实未核验时不展示可用确认按钮，并显示具体原因。

不新增页面，今日拍摄继续使用现有入口和接口。

## 8. 错误处理与安全边界

- 所有草稿、拍摄项和确认操作均按 `owner_id` 查询；
- 客户端不能通过提交 `approval`、`workflow_status` 或检查快照绕过服务端校验；
- 确认写回前重新读取当前草稿，避免使用过期前端状态；
- 失败时保留既有草稿、检查结果和来源引用；
- shooting 创建失败时整体保存失败，不留下已确认但无拍摄项的状态；
- 不向客户端返回 API Key、模型配置或其他敏感字段。

## 9. 测试计划

新增专项测试覆盖：

- 未通过质量门、发布清单或事实核验时确认失败；
- 未完成当前版本检查时确认失败；
- 确认记录包含用户、时间、版本和检查快照；
- 确认成功创建 shooting，重复确认不重复创建；
- 版本冲突和账号隔离；
- `source_refs`、平台、正文和策略字段保留；
- 撤回保存原因、保留历史并同步拍摄项状态；
- 已发布内容不可撤回；
- 选题确认 → 草稿 → 检查 → 人工确认 → 今日拍摄完整链路；
- 旧草稿和旧拍摄数据启动迁移后仍可读取。

最终运行：

```text
node --test server/draft-approval.test.mjs server/draft-approval-api.test.mjs
npm test
npm run typecheck
npm run verify
```

## 10. 验收标准

1. 用户只能对当前账号、当前版本且通过所有阻断检查的草稿确认；
2. 确认成功后草稿进入 `ready_to_shoot`，并且今日拍摄清单有且只有一条对应记录；
3. 确认快照可追溯，后续修改不会篡改历史确认；
4. 撤回不会删除历史，并会让拍摄项进入 `needs_revision`；
5. 未确认、阻断或事实未核验内容无法进入拍摄；
6. 现有发布记录、表现快照、来源引用、账号隔离和旧数据兼容性不回归；
7. 所有专项测试、全量测试、类型检查和生产构建通过。
