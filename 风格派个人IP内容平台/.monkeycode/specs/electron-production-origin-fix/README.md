# Electron 正式包生产入口修复

作者: Monkeycode

## 项目简介

修复 Windows Electron 正式包默认访问本地 Vite 地址的问题，使普通用户启动后直接连接生产工作台。

## 使用方式

正式包默认访问 `https://content.woyai.cn`；本地开发可通过 `APP_ORIGIN` 覆盖。

## 当前状态

已完成。桌面正式包默认连接生产站，本地开发仍可通过 `APP_ORIGIN` 覆盖。桌面专项测试、`npm run verify`、Windows x64 打包、ASAR 内容检查和进程启动冒烟测试均通过。

## 关键文件

- `desktop/main.mjs`
- `desktop/electron-core.mjs`
- `desktop/electron-core.test.mjs`
- `docs/superpowers/specs/2026-09-01-electron-production-origin-fix-design.md`
- `tasklist.md`

## 产出文件

已生成 `release-packager/dingweipai-win32-x64/`，包含 `dingweipai.exe` 与 `resources/app.asar`。

## 关键依赖

Electron、@electron/packager、Node.js 测试运行器。

## 下次接着做什么

如需分发桌面包，先确定内部交付渠道；不要将可执行文件提交到 Git。
