# 大模型 API 连接测试修复

作者: Monkeycode

## 项目简介

修复工作台 API 中心“大模型 API 1/2/3”测试按钮调用不存在的后端路由，导致统一显示“连接失败：测试请求未完成”的问题。

## 使用方式

1. 打开工作台“设置 → API 中心”。
2. 填写并启用对应的大模型配置。
3. 点击“测试连接与能力”。
4. 成功时显示能力验证通过；失败时显示上游状态或超时原因。测试不要求先启用配置；“启用”只控制正式创作调用。

## 当前状态

已完成。后端测试路由、成功分支、上游失败分支、未启用但已配置仍可测试、密钥不泄漏及 `127.0.0.1:5173` 本地来源兼容均已验证；完整 `npm run verify` 通过，共 128 项测试。修复后的本地 API 已重启并监听 3001。

## 关键文件

- `server/index.mjs`：账号级 API 配置测试路由
- `server/llm.mjs`：文本与视觉能力测试
- `server/api-settings-api.test.mjs`：接口回归测试
- `src/main.tsx`：API 中心测试按钮及结果展示

## 产出文件

- `.monkeycode/specs/api-settings-test-route/README.md`

## 关键依赖

Node.js 原生 `fetch`、现有 AES-256-GCM API 配置存储及 OpenAI 兼容 `/chat/completions` 协议。

## 下次接着做什么

用户先吊销已在聊天中暴露的旧 API Key 并生成新 Key，再在页面重新填写配置后执行真实供应商测试。Base URL 使用服务根路径（通常以 `/v1` 结尾），不要填写完整的 `/chat/completions` 地址。
