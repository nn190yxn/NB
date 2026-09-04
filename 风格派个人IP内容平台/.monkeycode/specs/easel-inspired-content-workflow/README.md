# Easel 借鉴型内容流程编排升级

作者: Monkeycode

## 项目简介

在不重建定位派现有架构的前提下，吸收 Easel 的内容运营分层、能力契约、Prompt Stack、质量门、模板版本和复盘回写机制，增强定位、选题、创作、检查、表现和经验沉淀之间的流程连接。

## 使用方式

先阅读同目录正式设计文档，再按三个子项目分别创建需求和实施计划：

1. 内容决策与创作质量链
2. 方法库与平台适配体系
3. 表现复盘与经验闭环

## 当前状态

第一阶段任务 1–6 已全部完成。Task 6 已验证旧 JSON/MySQL 兼容、任务 1–5 新接口账号隔离、全链路来源引用、敏感配置过滤、检查与确认状态边界；审计未发现需修改的运行时缺陷，也未引入浏览器自动连接、自动发布或全量 Easel Skill。

## 关键文件

- `docs/superpowers/specs/2026-09-03-easel-inspired-content-workflow-design.md`：正式设计文档
- `docs/superpowers/specs/2026-09-03-stage-quality-gate-design.md`：Task 6 第一阶段质量门审计设计
- `server/index.mjs`：现有定位、选题、草稿、记忆和表现快照 API
- `server/llm.mjs`：现有模型调用边界
- `src/main.tsx`：现有工作台流程界面
- `src/shared/types.ts`：共享领域类型
- `server/draft-workflow.mjs`：Hook 校验、候选生成和草稿流程默认字段
- `server/draft-workflow.test.mjs`、`server/draft-workflow-api.test.mjs`：Task 3 专项测试
- `server/draft-checks.mjs`：人设、质量和发布清单确定性检查
- `server/draft-checks.test.mjs`、`server/draft-checks-api.test.mjs`：Task 4 专项测试
- `server/draft-approval.mjs`：Task 5 人工确认默认值、前置校验和快照逻辑
- `server/draft-approval.test.mjs`、`server/draft-approval-api.test.mjs`：Task 5 专项测试
- `server/stage-quality-gate.test.mjs`、`server/mysql-migration.test.mjs`、`server/cross-platform-e2e.test.mjs`：Task 6 兼容、持久化与全链路审计证据
- `.monkeycode/docs/INTERFACES.md`：现有接口说明

## 产出文件

- Easel 借鉴型内容流程编排设计文档
- 三阶段升级路线与验收标准
- Task 3 Hook/草稿/平台版本增量实现
- Task 4 人设/质量/发布检查增量实现
- Task 5 人工确认、撤回与今日拍摄衔接实现
- Task 6 第一阶段质量门审计测试、设计结果和文档同步

## 关键依赖

现有 React/Vite、Node.js、JSON/MySQL、PWA、Electron 和项目既有测试体系；本设计不新增运行时依赖。

## 下次接着做什么

Task 1–6 已完成并通过代码级验收复核：`npm run verify` 119/119，真实临时 API 关键链 7/7，类型检查、生产构建和 `git diff --check` 通过。生产 MySQL、浏览器人工交互和线上部署尚未验收；不提前开发后续阶段，不部署、不提交、不推送。
