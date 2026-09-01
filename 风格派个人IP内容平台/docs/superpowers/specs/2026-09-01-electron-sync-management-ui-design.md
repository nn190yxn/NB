# Electron 同步管理界面设计

- 日期：2026-09-01
- 范围：任务 9.1–9.5
- 目标：为 Web 工作台与 Electron 桌面端提供统一的本地文件夹同步管理能力。

## 目标与边界

同步管理面板放入现有设置面板，Web 与 Electron 共用同步状态 API。面板负责目录配置、同步控制、队列状态、逐文件状态和失败重试；不在本任务中重写 Electron 主窗口或文档解析器。

## 交互

面板包含设备状态、在线状态、队列数量、最后同步时间和“立即同步”按钮。目录列表支持添加、暂停、恢复和移除。文件列表展示相对路径、文件名、状态、更新时间和错误原因；失败项提供单项重试，本地已删除项显示保留云端的状态。

Web 端调用 API 管理数据；Electron 端通过现有安全 IPC 触发桌面能力。浏览器环境缺少 Electron IPC 时，目录控制按钮显示不可用提示，但仍可查看服务端状态。

## 数据流与接口

- `GET /api/devices`：读取当前账号设备状态。
- `GET /api/sync-directories`：读取目录配置。
- `POST /api/sync-directories`：添加目录。
- `PUT /api/sync-directories/:id`：暂停或恢复目录。
- `DELETE /api/sync-directories/:id`：移除目录。
- `GET /api/materials/sync`：读取同步任务和逐文件状态。
- `POST /api/materials/sync/:job_id/process`：触发单文件解析处理。
- `POST /api/materials/sync/:job_id/retry`：重试失败任务。

如果现有服务端缺少目录或设备接口，本任务补齐最小的按账号隔离 API；目录路径仅作为配置元数据保存，不向素材库以外的响应泄露不必要的本地绝对路径。

## 组件边界

- `SyncManagementPanel`：面板布局、加载和刷新状态。
- `SyncDirectoryList`：目录增删及暂停/恢复操作。
- `SyncQueueList`：队列、成功、失败和删除状态展示。
- `sync-management.ts`：API 请求、状态映射和错误归一化。

现有设置、素材库和 Electron IPC 保持原有职责，仅增加同步面板入口和同步来源字段。

## 错误处理

网络失败时保留已加载状态并提示“暂时无法刷新”；写操作失败显示可重试错误，不从界面移除本地状态。失败同步任务保留错误原因和尝试次数。登录失效时停止写操作并回到现有认证流程。

## 测试

- API：目录增删改、账号隔离、设备状态和同步任务状态。
- 前端：面板关键文本、目录操作、队列状态、失败重试和素材来源字段。
- 集成：Electron IPC 触发同步请求，服务端返回任务状态；失败任务可重试且不影响其他任务。
- 验证：`npm test`、`npm run typecheck`、`npm run build`。
