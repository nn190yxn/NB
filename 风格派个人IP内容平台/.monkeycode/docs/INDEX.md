# 定位派项目文档

- [系统架构](ARCHITECTURE.md)
- [接口说明](INTERFACES.md)
- [开发指南](DEVELOPER_GUIDE.md)
- [需求规格](../specs/content-ip-workbench/requirements.md)
- [技术设计](../specs/content-ip-workbench/design.md)

当前实现覆盖定位访谈、IP 档案、素材/研究、选题七维评估、Hook 与跨平台草稿、人设/质量/发布检查、人工确认、拍摄清单和 PWA。第一阶段质量门已验证旧 JSON/MySQL 兼容、账号隔离、来源链、敏感配置过滤和状态保护。API 在配置 `PROJECT_DB_*` 时使用项目专用 MySQL，未配置时使用本地 JSON 文件。
