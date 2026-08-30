# 定位派项目文档

- [系统架构](ARCHITECTURE.md)
- [接口说明](INTERFACES.md)
- [开发指南](DEVELOPER_GUIDE.md)
- [需求规格](../specs/content-ip-workbench/requirements.md)
- [技术设计](../specs/content-ip-workbench/design.md)

当前实现覆盖定位访谈基础流程、定位候选、IP 档案审核、素材导入与同步、RedFox 研究、选题、跨平台草稿、拍摄清单和 PWA 基础能力。API 在配置 `PROJECT_DB_*` 时使用项目专用 MySQL 的 `app_state`，未配置时使用本地 JSON 文件；对象存储和正式鉴权仍需生产化接入。
