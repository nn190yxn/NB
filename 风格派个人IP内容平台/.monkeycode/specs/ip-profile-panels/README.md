# IP 档案双区

作者: Monkeycode

## 项目简介
将 IP 档案页面调整为“已确认基础档案 + 待审核变更”双区结构。

## 使用方式
进入“IP 档案”页面查看当前基础资料；未来访谈、素材和外部资料提取出的新内容进入待审核变更区，通过后增量合并。

## 当前状态
已完成开发、测试和线上部署。

## 关键文件
- `src/main.tsx`：双区数据读取和页面渲染
- `src/styles.css`：档案面板和移动端样式
- `server/web-assets.test.mjs`：页面特征回归测试
- `docs/superpowers/specs/2026-08-31-ip-profile-panels-design.md`：设计说明
- `.monkeycode/specs/ip-profile-panels/tasklist.md`：实施计划

## 产出文件
已确认基础档案展示、待审核 pending 过滤、移动端样式和回归测试。

## 关键依赖
React、TypeScript、现有 `/api/profile`、`/api/positioning`、`/api/profile/reviews` 接口。

## 下次接着做什么
如需进一步增强，可增加基础档案字段的人工编辑入口和字段级版本对比；当前审核通过流程保持原有接口兼容。
