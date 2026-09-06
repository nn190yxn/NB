# Windows 本地一键启动

作者: Monkeycode

## 项目简介

为风格派个人 IP 内容平台提供 Windows 双击启动入口，同时隐藏启动本地 API 与 Vite 前端、合并日志，并在服务就绪后自动打开浏览器。

## 使用方式

1. 首次使用先在项目根目录运行 `npm install`。
2. 双击根目录的 `一键启动.bat`。
3. 页面将自动打开至 `http://127.0.0.1:5173/`。
4. 如启动异常，查看根目录 `local-app.log`。

脚本只负责启动。关闭服务时，请在任务管理器中结束对应 Node.js 进程。

## 当前状态

已完成。7 项启动器专项测试与完整 `npm run verify`（126 项测试、类型检查、生产构建）通过；首次启动和重复启动验收均通过，3001/5173 服务正常响应，日志合并和浏览器自动打开已验证。

## 关键文件

- `一键启动.bat`：Windows 双击入口
- `scripts/start-local.mjs`：服务检查、启动、日志和浏览器控制
- `server/start-local.test.mjs`：自动测试
- `local-app.log`：统一运行日志，不纳入 Git
- `docs/superpowers/specs/2026-09-06-windows-one-click-start-design.md`：设计规格
- `.monkeycode/specs/windows-one-click-start/tasklist.md`：实施计划

## 产出文件

- BAT 启动入口
- Node 启动器
- 自动测试与使用说明

## 关键依赖

Windows、Node.js、npm、PowerShell 5.1 及已安装的项目依赖。

## 下次接着做什么

本任务已闭环。后续如需要一键关闭服务，可单独设计停止脚本；本次不包含部署。
