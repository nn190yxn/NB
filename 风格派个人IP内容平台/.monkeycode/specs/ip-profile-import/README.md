# IP 档案导入

作者: Monkeycode

## 项目简介
将 `E:\Work\Alex\个人IP` 中已确认的核心定位映射到风格派个人 IP 内容平台，替换原有林默示例身份。

## 使用方式
启动项目后进入工作台，首页和侧栏显示“小姚哥｜创业过来人”；服务端演示数据中的定位、受众、问题、内容支柱和表达边界可通过 `/api/profile` 与 `/api/positioning` 查看。

## 当前状态
已完成核心档案导入与展示身份替换，已部署线上并完成公网验证，未导入完整私密档案原文。

## 关键文件
- `server/data.json`：本地演示用户的初始化定位与 IP 档案字段
- `src/main.tsx`：工作台身份展示
- `server/web-assets.test.mjs`：身份与初始化数据特征测试
- `README.md`：项目当前 IP 初始化说明

## 产出文件
- `server/data.json`
- `src/main.tsx`
- `server/web-assets.test.mjs`
- `README.md`

## 关键依赖
Node.js、React、Vite、现有 JSON/MySQL 双轨存储。

## 下次接着做什么
线上已完成一次授权部署：已备份线上 `dist` 与服务端文件，更新前端和服务端种子，重启 PM2，并验证首页 HTTP 200、`/api/health` 正常、`/api/profile` 返回小姚哥身份。
