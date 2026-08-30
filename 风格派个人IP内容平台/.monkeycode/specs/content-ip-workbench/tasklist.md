# 需求实施计划

## Overall Development Roadmap

- [x] Phase 1: 建立前后端基础设施、共享类型、鉴权边界、API 反向代理和测试命令。（MVP API 基线）
- [x] Phase 2: 实现定位发现访谈、IP 核心目标和个人 IP 档案持久化。（MVP API 基线）
- [x] Phase 3: 实现定位匹配引擎与分层内容策略，支持泛流量、垂直信任和核心目标转化。（MVP API 基线）
- [x] Phase 4: 实现素材导入、桌面同步、RedFox 热点研究和爆款拆解。（MVP API 基线）
- [x] Phase 5: 实现目标驱动的选题生成、多平台草稿和内容承接链路。（MVP API 基线）
- [x] Phase 6: 实现拍摄清单、手机 PWA、提词器和多端同步。（MVP API 与安装基线）
- [x] Phase 7: 实现定期复盘、策略版本、指标分析和策略对话调整。（MVP API 基线）
- [ ] Phase 8: 完成安全、可访问性、自动化测试和完整链路验收。当前已完成核心 API 集成测试、PWA/无障碍静态契约测试，以及定位候选、档案审核、素材上传、草稿复制和历史查询的工作区接入；浏览器级自动化和生产环境验收仍待接入。

- [ ] 1. 初始化全栈项目结构和开发基础设施
  - [x] 创建 React + Vite + TypeScript 前端、服务端 API 和共享类型目录，落实 design.md 的 Web Client 与 Application API 边界。
  - 配置 Tailwind CSS、自定义 design tokens、shadcn/ui 源码组件基础、Lucide 图标和基础响应式布局。
   - [x] 配置服务端配置读取、数据库连接和初始化迁移入口；RedFox 凭证仅从项目服务端配置读取（Requirement 7.1）。对象存储、日志和统一错误响应格式仍按后续任务接入。
  - 配置前端 `/api` 反向代理和开发服务器允许的预览域名，确保 Web 与 API 可通过单一预览入口运行。
  - [x] 配置类型检查命令；单元测试和 API 自动化测试留在 Phase 8。

- [ ] 2. 实现共享数据模型、版本和权限基础
  - [x] 2.1 定义 `IPProfile`、`Material`、`ResearchItem` 和 `TopicDraft` 的共享类型与 MVP JSON 模型（design.md Data Models）。
   - [x] 2.2 实现用户归属校验、来源引用、版本号、更新时间和软删除字段，保证用户只能访问自己的内容（Requirement 6.2、Requirement 7.2、Requirement 7.3）。
   - [x] 2.3 为模型校验、用户隔离和来源关联编写单元测试与属性测试，验证所有生成记录都能关联至少一个来源（Correctness Property 1、4）。

- [ ] 3. 实现定位发现访谈
   - 实现 5 至 8 轮一问一答式访谈状态机，默认 8 个环节；最后一个 IP 核心目标环节分别收集变现方式、获客目标和其他核心目的，根据回答质量提前结束或追加追问（Requirement 2.1、2.2、2.3）。
   - 实现事实、推断和待验证信息的阶段记录，支持示例提示、选择题和跳过入口（Requirement 2.2、2.7）。
   - 将 IP 核心目标纳入定位候选生成、评分、比较、修改和用户确认流程，并为每个候选说明目标关联（Requirement 2.4、2.5、2.6）。
  - 实现定位发现页面，展示进度、当前问题、阶段记录和候选定位卡。
  - 为问题路由、信息充分度、候选评分和未确认定位不可保存编写 API、组件和属性测试。

- [ ] 4. 实现创作者定位与内容匹配引擎
  - 实现创作者定位编辑模型，保存身份角色、服务对象、核心问题、内容主题、专业依据、表达风格和禁用方向（Requirement 1.1）。
  - 实现定位到关键词组、主题组、素材类型和平台研究建议的生成与编辑（Requirement 1.2）。
   - 实现内容资产匹配评分、目标关联理由、待匹配状态和按定位及 IP 核心目标重新匹配流程（Requirement 1.3、1.4、1.5）。
  - 实现定位向导和匹配结果预览页，支持用户在收集素材前确认内容边界。
   - 为定位字段校验、匹配解释和重新匹配编写 API、组件和属性测试。

- [ ] 4.1 实现分层内容策略
  - 实现泛流量触达、垂直信任和核心目标转化三类策略层级、阶段状态和默认比例（Requirement 11.1、11.4）。
  - 为热点、素材、选题、文案和拍摄内容增加策略层级、内容任务、目标关联和前后承接关系（Requirement 11.2、11.5）。
  - 实现初期流量阶段的泛流量推荐，并校验每条泛流量内容至少具备一个定位、信任或目标承接点（Requirement 11.3、11.6）。
  - 实现用户直接调整、策略对话调整和定期复盘调整，保存策略版本、调整原因和对应表现数据（Requirement 11.7、11.8、11.9）。
  - 为策略比例、阶段推荐、目标承接和内容链路编写 API、组件和属性测试。

- [x] 5. 实现个人 IP 档案管理（MVP：档案读写、文本导入、字段提取、待审核列表和确认/拒绝）
  - 实现 `GET /api/profile` 和 `PUT /api/profile`，保存定位、目标受众、内容支柱、常用观点、表达偏好和禁用表达（Requirement 1.1）。
  - 实现 IP 档案文档/表格导入、字段提取和待审核条目模型，保留原始文件与字段来源（Requirement 1.2、1.4）。
   - [x] 实现待审核条目的确认、拒绝、修改和合并写回流程，将确认内容写入 IP 档案并记录来源（Requirement 1.3）。
  - 实现桌面端 IP 档案编辑页和待审核条目审核界面，并展示资料缺口状态。
  - [x] 3.1 实现档案读写 API 与来源字段基础结构；组件测试留在 Phase 8。（Requirement 1）

- [x] 6. 实现素材导入、解析和去重（MVP：文本/链接/JSON 上传、格式推断、checksum 去重、失败重试和提取字段）
  - 实现 `POST /api/materials/import`，支持 PDF、Word、Excel、Markdown、TXT、网页链接和手动输入，并记录名称、格式、正文、表格字段、链接和导入时间（Requirement 2.1）。
  - 实现文件存储适配器和原始文件保留策略，解析失败时保存元数据、失败原因和重试状态（Requirement 1.4、Requirement 2.5）。
  - 实现基于 checksum、相对路径和文件版本的去重逻辑，避免相同用户的相同文件版本重复导入（Requirement 2.2、Correctness Property 3）。
  - 实现素材分段、候选选题、核心观点、金句、可引用段落和平台适配建议的内部数据结构（Requirement 2.3）。
  - 实现素材库页面，支持导入状态、来源、相关性标签、人工审核状态、失败重试和手动补录。
    - [x] 4.1 为文件 checksum 去重、解析失败恢复和素材字段提取编写单元测试与属性测试（Requirement 2、Correctness Property 3）。

- [ ] 7. 实现桌面素材同步客户端
  - 创建桌面同步客户端，支持用户选择一个或多个素材目录并保存本地同步配置（Requirement 2.2、design.md Desktop Sync Client）。
  - 监测 PDF、Word、Excel、Markdown 和 TXT 文件的新增与修改，基于校验值和相对路径生成同步清单。
  - 实现 `POST /api/materials/sync` 与 `POST /api/materials/upload`，支持队列、进度、失败原因、重试和短期设备令牌（Requirement 2.2、Requirement 6.2）。
   - [x] 实现同步冲突记录、解决接口和文件事件归并，避免重复上传同一文件版本（Requirement 6.4、Requirement 6.5）。
   - [x] 5.1 为文件事件归并、同步队列和断点重试编写服务端测试（Requirement 2.2、Requirement 6.5）。

- [x] 8. 实现 RedFox 数据适配器和热点研究（MVP：服务端适配、样例回退、额度/网络/无效响应处理和研究刷新）
  - 封装 `trending-hub-top10`、`douyin-search`、`douyin-content-surge`、`xiaohongshu-search`、`gzh-search-crawler` 和 `wechat-write` 的服务端调用。
  - 将不同平台响应归一化为 `ResearchItem`，保留平台原始字段、查询条件、时间范围、来源链接、抓取时间和额度状态（Requirement 3.1、design.md RedFox Adapter）。
  - 实现 `POST /api/research/refresh`，支持按商业创业方向和目标平台手动刷新，并保留上次成功数据（Requirement 3.1、3.5）。
  - 实现热点研究页、平台筛选、更新时间、数据来源、互动指标、搜索条件和额度错误状态。
   - [x] 6.1 使用固定 RedFox 响应样例编写字段映射、错误处理和额度不足测试（Requirement 3.1、3.5）。

- [x] 9. 实现爆款内容拆解（MVP：分析 schema、来源关联和结构库展示）
  - 实现 `POST /api/research/{id}/analyze`，输出 Hook、目标受众、痛点、论点、叙事结构、金句、互动引导、证据和可迁移模式（Requirement 3.3）。
  - 实现爆款详情页，展示标题、作者、平台、互动数据、原文链接和拆解入口（Requirement 3.2）。
  - 实现爆款结构保存、版本更新和与原始 `ResearchItem` 的可追溯关联（Requirement 3.4）。
  - 实现结构库页面，支持按平台、内容支柱、结构类型和审核状态筛选。
   - [x] 7.1 为拆解输出 schema、来源引用和保存关联编写 API 测试（Requirement 3.3、3.4、Correctness Property 1）。

- [x] 10. 实现 AI 编排和选题生成（MVP：来源约束、档案缺口提示、生成上下文和选题工作区）
  - 实现素材预处理、IP 相关性标注、研究内容结构化和事实风险标注流程（Requirement 2.3、2.4、Requirement 7.4）。
   - 实现 `POST /api/topics/generate`，根据选中的热点、素材、爆款结构、IP 档案和 IP 核心目标生成多个选题，并返回每个选题的目标关联及生成依据（Requirement 4.1）。
  - 实现 IP 档案缺口检测，在配置不完整时返回明确提示并允许用户补充资料后重试（Requirement 4.5）。
  - 实现选题工作区，支持来源选择、相关性标签、生成参数、候选比较、保存和进入创作流程。
    - [x] 8.1 为 AI 输入约束、来源必填、缺口提示和输出 schema 编写单元测试与属性测试（Requirement 4.1、4.5、Correctness Property 1）。

- [x] 11. 实现多平台草稿生成与编辑（MVP：四平台生成、复制、历史快照、事实核验和拍摄入口）
   - 实现 `POST /api/drafts/generate`，基于统一主题 ID 和 IP 核心目标生成小红书、抖音、视频号和公众号草稿（Requirement 4.2、Correctness Property 2）。
   - [x] 实现草稿编辑器的版本保存、复制、历史恢复和标记为待拍摄（Requirement 4.3）。
  - 在草稿中展示引用素材、IP 档案依据、外部事实和人工核验状态；未核验事实阻止无提示发布动作（Requirement 4.4、Requirement 7.4）。
  - 实现草稿列表、版本历史、来源回溯和待拍摄入口。
   - [x] 9.1 为跨平台主题 ID、一致来源集合、版本保存和事实标记编写 API 与前端测试（Requirement 4、Correctness Property 2）。

- [x] 12. 实现拍摄清单和手机端提词器 PWA（MVP：拍摄状态、提词配置、manifest、Service Worker、离线状态提示）
  - [x] 实现 `GET /api/shooting/today` 与 `PUT /api/shooting/{id}`，支持待拍、拍摄中、已完成和需修改状态（Requirement 5.1、5.2）。
  - 实现今日拍摄页，支持按日期查看、排序、状态更新、草稿预览和进入提词器。
  - [x] 实现 PWA manifest、service worker、基础离线缓存和移动端安装入口（Requirement 6.1、design.md Web Client）。
  - 实现全屏提词器，支持字号、滚动速度、镜像、暂停、恢复、剪贴板复制和拍摄记录保留（Requirement 5.3、5.4）。
    - [x] 实现跨设备版本同步 API、冲突记录和选择保留版本接口（Requirement 5.5、Requirement 6.3、6.4）。
    - [x] 10.1 为拍摄状态、提词器控制、剪贴板复制、离线缓存和窄屏布局编写静态契约与工具测试（Requirement 5、Requirement 6）。

- [ ] 13. 完成端到端安全、可访问性和核心流程验证
  - 验证用户鉴权隔离、服务端 RedFox 凭证保护、文件归属、软删除和来源审计（Requirement 6.2、Requirement 7）。
  - 验证桌面研究、热点刷新、爆款拆解、选题生成、草稿编辑、加入拍摄清单、手机打开和进入提词器的完整流程。
  - 验证桌面与手机响应式布局、键盘焦点、状态标签语义、减少动态效果和提词器大触控区域。
   - [x] 11.1 编写服务端关键路径回归测试，覆盖 RedFox 不可用、解析失败、断网队列和同步冲突场景；核心 API 链路可通过 `npm run e2e` 独立执行，浏览器端自动化仍需接入测试运行器。

- [ ] 14. 检查点 - 确保所有测试通过
  - 确保类型检查、单元测试、API 测试、集成测试和端到端测试通过。
  - 确保核心链路可在电脑端完成研究和创作，并可在手机 PWA 中打开当天拍摄清单和提词器。
