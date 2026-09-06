# 红狐 API 账号级加密配置

作者: Monkeycode

## 项目简介

将红狐 API 从浏览器 `localStorage` 明文配置迁移为账号级服务端 AES-256-GCM 加密配置，统一保存、测试和热点研究调用链。

## 使用方式

1. 打开“工作台设置 → API 中心”。
2. 填写红狐 Base URL 和完整 API Key。
3. 点击“加密保存配置”或“测试连接”。
4. 保存后输入框只显示末四位掩码；热点研究功能自动使用当前账号配置。

## 当前状态

已完成。红狐配置支持账号隔离、服务端加密、掩码返回、连接测试及研究功能复用。前端不再通过 `x-redfox-api-key` 传输浏览器明文 Key。129 项自动化测试通过；本地 API 已重启并加载新接口。

完整 `npm run verify` 目前被工作区另一项未提交变更中的 `ProfileHistory.changed_at` 类型错误阻塞，该问题不属于本任务。

## 关键文件

- `server/api-settings.mjs`：红狐配置加密、解密和公开掩码
- `server/index.mjs`：红狐配置接口、测试接口及账号运行时读取
- `server/api-settings-api.test.mjs`：加密、账号隔离、测试与研究复用回归测试
- `src/main.tsx`：红狐服务端保存、测试及移除浏览器 Key 请求头
- `server/web-assets.test.mjs`：前端不再传输红狐明文 Key 的静态验证

## 产出文件

- `.monkeycode/specs/redfox-encrypted-settings/README.md`

## 关键依赖

Node.js `crypto` AES-256-GCM、现有 `api_configs` 账号级存储、RedFox HTTP 适配器。

## 下次接着做什么

在页面使用新生成的红狐 Key 完成真实供应商连通测试；不要继续使用已经在聊天中公开过的 Key。
