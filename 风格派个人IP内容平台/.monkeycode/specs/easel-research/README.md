# Easel 仓库研究

作者: Monkeycode

## 项目简介

研究 ZJU-REAL/Easel 开源仓库，提炼其产品定位、架构、技能系统、内容工作流与对“风格派个人IP内容平台（定位派）”的可借鉴机制。

## 使用方式

本目录为研究记录索引；结论基于 Easel GitHub 公开 README、代码、文档和目录页面。正式分析在当前会话回复中交付。

## 当前状态

研究完成。未修改当前项目业务代码、配置、测试或部署产物。

本轮进一步核查了 `positioning-analysis`、`content-strategy`、`content-matrix`、`topic-evaluator`、`hook-generator`、`xhs-note-creator`、`content-repurposing`、`persona-check`、`quality-gate`、`publish-checklist`、`content-postmortem`、`strategy-advisor`、`publish-log`、`data-tracker` 和 `content-calendar` 等公开 Skill，筛选出适合定位派的可控流程编排组合：定位/策略 → 选题矩阵 → 单题评估 → 草稿与 Hook → 人设/质量双门 → 平台适配 → 人工确认 → 表现快照 → 复盘与经验回写。浏览器自动发布不纳入本阶段。

## 关键文件

- `README.md`：本研究任务说明
- Easel 公开仓库：`https://github.com/ZJU-REAL/Easel`
- Easel 文档：`docs/SKILL-SPEC.md`、`docs/prompt-stack.md`、`docs/skill-function-mapping.md`
- Easel 核心参考：`pyproject.toml`、`easel/persona.py`、`skills/shared/README.md`

## 产出文件

- Easel 产品与技术研究结论（本次会话交付）

## 关键依赖

公开 GitHub 页面；未引入本地依赖。

## 下次接着做什么

如需实施借鉴建议，另立开发任务，先确认优先级与不变约束，再进入设计和代码修改。
