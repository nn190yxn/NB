# Electron 正式包生产入口修复实施计划

- [x] 1. 修复桌面应用默认入口
  - [x] 1.1 修改 `desktop/main.mjs`，未设置 `APP_ORIGIN` 时默认使用 `https://content.woyai.cn`
  - [x] 1.2 保留显式 `APP_ORIGIN` 覆盖和 HTTP/HTTPS 校验

- [x] 2. 补齐桌面入口测试
  - [x] 2.1 为默认生产地址添加单元测试
  - [x] 2.2 验证本地开发地址覆盖和非法协议拒绝

- [x] 3. 检查点
  - [x] 3.1 运行 Electron 专项测试和 `npm run verify`，确保所有测试通过

- [x] 4. 重建 Windows 桌面包
  - [x] 4.1 使用国内 Electron 镜像执行 `npm run build:desktop`
  - [x] 4.2 验证 `dingweipai.exe` 与 `resources/app.asar` 存在且包含最新入口配置
