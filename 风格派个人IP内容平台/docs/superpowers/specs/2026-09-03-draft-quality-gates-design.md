# Task 4：人设、质量与发布完整性检查设计

- 日期：2026-09-03
- 作者：Monkeycode
- 状态：已获用户口头批准，待书面规格复核
- 上游设计：`docs/superpowers/specs/2026-09-03-easel-inspired-content-workflow-design.md`

## 1. 目标

在现有草稿生成、Hook 选择、版本历史和拍摄流程之间增加三道确定性检查：人设检查、质量门和发布完整性清单。检查结果必须可解释、可保存、可重试，并保持现有账号隔离、来源引用和旧草稿兼容性。

本任务不调用大模型，不实现浏览器连接、自动发布、人工批准或拍摄清单重构。

## 2. 方案选择

采用独立检查模块：新增 `server/draft-checks.mjs`，提供三类纯函数。`server/index.mjs` 只负责身份边界、状态流转、幂等保存和 HTTP 错误映射。

未采用以下方案：

- 将规则全部写入 `server/index.mjs`：改动集中，但无法保持清晰测试边界。
- 建立通用配置化检查引擎：扩展性较高，但超过当前三类检查的必要复杂度。

## 3. 数据结构

沿用 Task 3 已加入的 `draft.checks`：

```json
{
  "checks": {
    "persona": null,
    "quality": null,
    "publish_checklist": null
  }
}
```

每次检查写入统一结果：

```json
{
  "status": "passed | warning | blocked",
  "score": 82,
  "dimensions": {},
  "evidence": [],
  "suggestions": [],
  "draft_version": 3,
  "checked_at": "ISO-8601"
}
```

`dimensions` 只用于质量门；其他检查保持空对象。检查不删除或替换 `source_refs`。

## 4. 检查规则

### 4.1 人设检查

接口：`POST /api/drafts/:id/checks/persona`

输入为当前账号草稿、IP 档案和草稿上下文。检查：

- 档案是否包含角色、受众和内容支柱；
- 正文是否能关联至少一个受众问题、内容支柱或观点；
- 正文是否包含档案中的禁用表达；
- 正文是否具有第一人称、真实经历或明确观点信号。

人设检查只产生 `passed` 或 `warning`，不产生 `blocked`。完成后草稿进入 `persona_checked`。

### 4.2 质量门

接口：`POST /api/drafts/:id/checks/quality`

必须先完成人设检查。质量门输出五个 0–100 分维度：

1. Hook 清晰度；
2. 受众问题匹配；
3. 核心观点明确度；
4. 证据与来源完整度；
5. 正文结构与风险控制。

缺少正文、缺少来源、未选择有效 Hook 或命中明确风险表达时可以阻断。综合分低于 60 或存在阻断项时返回 `blocked` 并进入 `needs_revision`；否则返回 `passed` 并进入 `quality_checked`。

### 4.3 发布完整性清单

接口：`POST /api/drafts/:id/checks/publish`

必须先通过质量门。检查：

- 标题、正文和目标平台非空；
- `source_refs` 有效且未被清空；
- `fact_check_status` 为 `verified`；
- 已选 Hook 存在且通过校验；
- 正文未命中明确风险词；
- 当前平台版本属于有效版本组，或属于兼容旧草稿。

全部通过时写入 `passed` 并进入 `publish_ready`；任一必选项失败时写入 `blocked` 并进入 `needs_revision`。

## 5. 状态流转与重试

```text
content_ready → persona_checked → quality_checked → publish_ready
                       ↓                  ↓
                 needs_revision ←────────┘
```

- 人设警告不阻断后续检查。
- 质量门或发布清单阻断后，用户必须修改草稿并重试。
- 修改 `title`、`body`、`platform`、`source_refs` 或 `selected_hook_id` 后，草稿回到 `content_ready`；清空质量和发布结果，人设结果可保留为历史快照但不作为当前版本通过依据。
- 检查结果记录 `draft_version`。同一版本重复调用且已有结果时返回现有结果；传 `force=true` 可重跑。
- 明确存在 `blocked` 结果的草稿不得更新为 `ready_to_shoot`。尚未使用新检查链的旧草稿保持兼容，完整人工批准门禁由 Task 5/6 收紧。

## 6. API 与错误处理

三个接口均只读取当前 `owner_id` 的草稿和档案：

- 草稿不存在或跨账号访问：`404 resource_not_found`；
- 前置状态未完成：`409 invalid_transition`；
- 档案缺少角色、受众或内容支柱：`422 missing_context`；
- 检查已执行且无需重跑：返回 `200` 和已保存草稿；
- 确定性规则不依赖外部 API，因此没有模型配置或上游网络错误。

接口返回更新后的完整草稿，前端无需额外合并检查对象。

## 7. 前端交互

内容创作页的现有草稿卡片增加顺序操作：

```text
人设检查 → 质量检查 → 发布检查
```

每项展示状态、综合分（如有）、证据和建议。按钮根据前置状态启用，不新增页面或弹窗，不改变现有主题和卡片结构。阻断结果明确显示“修改后重试”，但不自动修改正文。

## 8. 兼容性与安全边界

- 旧草稿在启动迁移时补齐空检查字段，不修改正文、状态、历史和来源。
- 平台版本独立保存；运行检查只修改当前草稿。
- 不把 API Key、私有配置或其他账号资源放入检查上下文。
- `source_refs` 只能校验，不能由检查函数删除或改写。
- 不新增依赖，不建立平行数据库。

## 9. 测试与验收

新增纯函数和 API 专项测试，覆盖：

- 三类检查结果结构及分数范围；
- 人设警告不阻断；
- 质量/发布阻断及状态回退；
- 前置状态顺序；
- 修改后清空下游检查并可重试；
- 同版本幂等和强制重跑；
- `owner_id` 账号隔离；
- `source_refs` 保留；
- 平台版本互不覆盖；
- 旧草稿兼容；
- 已明确阻断时不能进入 `ready_to_shoot`。

完成后运行：

```text
node --test server/draft-checks.test.mjs server/draft-checks-api.test.mjs
npm test
npm run typecheck
npm run verify
```

验收条件为全部检查通过，现有草稿、拍摄、合规和来源链回归测试无退化。
