# 跨端内容资产闭环

作者: Monkeycode

## 项目简介

为风格派个人 IP 内容平台建立热点研究收录、Windows Electron 本地文件夹同步、手机数据截图解析和三 API 加密配置中心。

## 使用方式

按 `tasklist.md` 从任务 1 开始顺序实施；任务 5、10 为阶段检查点。用户已确认执行全部开发与测试任务。

## 当前状态

阶段一任务 1–4、任务 5 检查点、任务 6“Windows Electron 桌面应用”、任务 7“本地文件夹同步引擎”和任务 8“服务端文档解析流水线”和任务 9“Electron 同步管理界面”已完成；任务 10 尚未开始。最终验证通过：95 项测试、TypeScript 类型检查、生产构建和 Windows Electron 目录打包。

## 关键文件

- `tasklist.md`：完整实施任务清单
- `server/content-assets.mjs`：旧素材迁移和跨端集合归一化
- `server/api-settings.mjs`：三 API AES-256-GCM 加密、掩码与运行时解密
- `server/llm.mjs`：主备文本调用、独立视觉调用和能力验证
- `server/private-files.mjs`：私有文件校验、路径隔离、原子存储和读取
- `server/research-collection.test.mjs`：热点研究收录、幂等和账号隔离测试
- `desktop/main.mjs`：Electron 主进程、托盘、会话和窗口生命周期
- `desktop/preload.mjs`：受限安全 IPC 暴露层
- `desktop/electron-core.mjs`：IPC 白名单与生命周期纯逻辑
- `desktop/sync-client.mjs`：多目录同步配置、稳定监听、二进制清单和持久化队列
- `server/document-parser.mjs`：五类文档解析适配器、候选字段提取和失败隔离
- `server/sync-management.test.mjs`：同步目录生命周期与账号隔离集成测试
- `server/performance-snapshots.test.mjs`：表现快照追加、空值和账号隔离测试
- `server/vision-tasks.test.mjs`：多图视觉任务、API 3 失败保留、候选匹配、人工确认和重试测试
- `server/cross-platform-e2e.test.mjs`：热点→素材→创作→发布→表现快照自动化端到端测试
- `release-packager/dingweipai-win32-x64/`：Windows Electron 未压缩应用包
- `server/mysql.mjs`：跨端集合持久化和复合用户主键
- `src/shared/types.ts`：素材、设备、同步文件、私有文件、表现快照和视觉任务类型
- `docs/superpowers/specs/2026-09-01-content-asset-cross-platform-design.md`
- `docs/superpowers/specs/2026-09-01-hotspot-material-collection-design.md`
- `docs/superpowers/specs/2026-09-01-electron-folder-sync-design.md`
- `docs/superpowers/specs/2026-09-01-mobile-performance-ingestion-design.md`

## 产出文件

已完成统一素材生命周期、六类跨端模型、JSON/MySQL 用户隔离、三 API 按账号加密配置、私有文件安全存储、热点研究手动收录、Windows Electron 桌面壳、本地文件夹同步引擎和服务端文档解析流水线。同步队列按相对路径合并、落盘并仅保留失败项；文档解析结果会写入正文、候选主题、金句和来源引用；同步管理面板支持目录生命周期、队列状态和失败重试。

## 关键依赖

现有 React/Vite/Node/MySQL 架构；加密和文件存储使用 Node.js 内置能力，本阶段未新增依赖。运行时必须配置 32 字节 `API_CONFIG_ENCRYPTION_KEY`；可通过 `PRIVATE_FILE_ROOT` 和 `PRIVATE_FILE_MAX_BYTES` 配置私有文件目录与大小上限。

## 下次接着做什么

任务 1–14 已全部完成；跨端内容资产闭环进入最终审阅状态。
