# Electron 正式包生产入口修复设计

日期：2026-09-01
作者：Monkeycode

## 背景

内测发现 `desktop/main.mjs` 在未设置 `APP_ORIGIN` 时默认访问 `http://127.0.0.1:5173`。该地址只适用于本地 Vite 开发环境，正式 Windows 包在普通用户电脑上启动时无法访问页面。

## 目标

- 正式桌面包无需额外配置即可访问 `https://content.woyai.cn`。
- 本地开发仍可通过 `APP_ORIGIN` 指向 Vite 或其他测试环境。
- 不改变现有会话存储、同步目录、托盘和 IPC 行为。

## 方案

将桌面进程的默认应用地址改为 `https://content.woyai.cn`：

```text
APP_ORIGIN 已设置 → 使用并校验该地址
APP_ORIGIN 未设置 → 使用 https://content.woyai.cn
```

地址继续通过 `normalizeAppOrigin` 校验，只允许 HTTP 或 HTTPS。开发命令使用显式环境变量覆盖，不在正式包中引入服务器地址输入界面，也不内嵌本地 Web/服务端。

## 测试与验收

1. 默认地址为 `https://content.woyai.cn`。
2. `APP_ORIGIN=http://127.0.0.1:5173` 可覆盖默认地址。
3. 非 HTTP/HTTPS 地址继续被拒绝。
4. Electron 相关单元测试通过。
5. `npm run verify` 全量通过。
6. 使用国内 Electron 镜像重新构建 Windows x64 包，产物包含 `dingweipai.exe` 与 `resources/app.asar`。

## 范围外

- 不实现离线本地后端。
- 不增加启动时服务器选择界面。
- 不修改 Web 页面视觉设计。
- 不自动发布桌面安装包到公网下载渠道。
