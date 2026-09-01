# 跨端功能审计阻断项修复

作者: Monkeycode

## 项目简介

补齐 Electron 本地目录同步、手机截图解析人工确认及同一文案表现历史，修复跨端内容资产任务 9、12、13 的验收缺口。

## 使用方式

按照 `tasklist.md` 顺序实施；设计依据见 `docs/superpowers/specs/2026-09-01-cross-platform-audit-remediation-design.md`。

## 当前状态

审计修复完成。API 配置、私有文件、研究收录、结构库筛选、设备/目录管理、视觉确认和表现快照链路已补齐。

验证结果：`npm run verify` 全部通过（96 tests、typecheck、Vite build）。

## 关键文件

- `server/index.mjs`：跨端 API 与数据生命周期
- `server/api-settings.mjs`：API Key 加密与脱敏
- `server/private-files.mjs`：私有文件安全校验与存储
- `server/llm.mjs`：文本/视觉模型调用
- `desktop/main.mjs`、`desktop/preload.mjs`：Electron 同步 IPC
- `desktop/sync-client.mjs`：本地目录扫描、监听与队列
- `src/main.tsx`：同步管理、截图确认、表现时间线
- `src/styles.css`：新增跨端确认与时间线样式

## 产出文件

- 跨端审计修复实现及专项测试
- 全量验证构建产物 `dist/`

## 关键依赖

Electron、React、Node.js 测试运行器、Vite、AES-256-GCM。

## 下次接着做什么

已创建提交 `dd20046` 并推送 `origin/main`。服务器部署尚未执行：项目约定的 `.monkeycode-tmp-files` 部署凭据当前不存在，需要补充部署凭据或明确其他部署方式。
