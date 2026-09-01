# 基础 IP 档案字段编辑

作者: Monkeycode

## 项目简介
为“已确认基础档案”增加字段级编辑、持久化和修改历史。

## 使用方式
进入“IP 档案”，点击任意字段右侧“编辑”；列表字段可每行填写一项，保存后立即用于内容生成。展开“查看最近修改”可查看字段修改前后内容。

## 当前状态
开发、验证和线上部署已完成。

## 关键文件
- `src/main.tsx`：字段编辑、保存和历史展示
- `src/styles.css`：编辑器和历史记录样式
- `server/index.mjs`：字段非空校验与版本历史
- `server/auth.test.mjs`：持久化和历史测试
- `server/web-assets.test.mjs`：前端特征测试
- `docs/superpowers/specs/2026-08-31-ip-profile-editing-design.md`：设计说明

## 产出文件
字段级编辑器、局部保存、空值保护、版本历史和回归测试。

## 关键依赖
现有 `/api/profile` 与 `/api/positioning` 接口、React、TypeScript。

## 下次接着做什么
线上已备份并部署前端、`server/index.mjs` 与 `server/profile-seed.mjs`；PM2 online，首页、健康检查、档案接口和编辑器前端标识均验证通过。
