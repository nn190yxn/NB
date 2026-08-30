# Requirements Document

## Introduction

定位派（个人 IP 内容成长平台）面向所有希望经营个人 IP 的创作者，支持创业者、手艺人、顾问、教练、设计师、教师和兴趣创作者等多种定位。平台主张“找到你在互联网上的独特价值，持续放大你的影响力”，先帮助用户明确个人定位，再根据定位匹配关键词、素材、热点、爆款、主题、金句和文案，随后提供研究沉淀、选题生成、跨平台创作和拍摄提词能力。系统同时支持电脑浏览器和手机桌面安装入口，内容数据通过云端服务在设备之间同步。首版以商业创业作为示例场景，通过桌面同步客户端监测指定本地素材文件夹，服务器部署作为后续阶段接入。

## Glossary

- **个人 IP 档案**：描述创作者定位、IP 核心目标、目标受众、内容支柱、表达偏好和可复用经历的结构化资料。
- **创作者定位**：描述用户是谁、服务谁、解决什么问题、凭什么被相信以及希望持续表达的主题边界。
- **IP 核心目标**：描述用户经营整个个人 IP 的长期变现目标、获客目标或其他核心目的，并贯穿内容资产和创作决策。
- **内容策略**：描述内容服务的流量阶段和任务，包括泛流量触达、垂直信任建立和核心目标转化。
- **素材**：用户导入的 PDF、Word、Excel、Markdown、TXT、网页链接或手动输入内容。
- **爆款结构**：从高表现内容中提炼的标题、开头、论证、节奏、金句和互动方式。
- **拍摄清单**：按日期组织的待拍选题、脚本、镜头提示和提词内容。
- **提词器**：手机端逐行显示拍摄文案的阅读界面。

## Requirements

### Requirement 1: 定位驱动的内容匹配

**User Story:** AS 个人 IP 创作者, I want to先定义自己的定位, SO THAT系统能够判断哪些内容资产真正适合我。

#### Acceptance Criteria

1. WHEN 用户创建创作者定位, THE system SHALL 保存身份角色、服务对象、核心问题、内容主题、专业依据、表达风格、禁用方向和 IP 核心目标。
2. WHEN 用户完成或更新创作者定位, THE system SHALL 生成与定位及 IP 核心目标对应的关键词组、主题组、素材类型和平台研究建议。
3. WHEN 用户查看任一热点、素材、爆款、金句或文案, THE system SHALL 展示该内容与创作者定位及 IP 核心目标的匹配理由、匹配维度和匹配分数。
4. WHEN 用户收集内容资产, THE system SHALL 支持按创作者定位和 IP 核心目标筛选、归档和批量调整内容主题。
5. WHEN 用户生成选题或文案, THE system SHALL 检查内容是否服务于至少一个 IP 核心目标，并展示目标关联理由。
6. IF 创作者定位或 IP 核心目标信息不足, THE system SHALL 展示缺失字段并允许用户补充后重新匹配已有内容资产。

### Requirement 2: 定位发现访谈

**User Story:** AS 尚未明确定位的个人, I want to通过多轮问答发现自己的 IP 优势和整个 IP 的核心目标, SO THAT我能获得有依据的定位方向并持续产出服务于长期目标的内容。

#### Acceptance Criteria

1. WHEN 用户没有完成创作者定位, THE system SHALL 提供 5 至 8 轮的一问一答式定位发现访谈。
2. WHEN 访谈进行中, THE system SHALL 根据上一轮回答选择下一轮问题，并在每轮结束时展示已识别的事实、假设和待验证信息。
3. WHEN 用户进入 IP 核心目标环节, THE system SHALL 分别收集变现方式与获客目标或其他核心目的，并将目标标记为后续内容决策的长期约束。
4. THE system SHALL 从真实经历、可交付能力、反复被需要的问题、目标人群、独特视角、信任证据、个人边界、表达方式和 IP 核心目标中提炼定位要素。
5. WHEN 访谈达到足够信息量, THE system SHALL 生成至少 3 个定位候选，并展示每个候选的目标人群、核心问题、独特价值、证据基础、内容支柱、关键词和风险提示。
6. WHEN 用户选择或修改定位候选, THE system SHALL 保存定位版本，并生成对应的素材收集规则、热点研究规则和内容排除规则。
7. IF 用户无法回答某一问题, THE system SHALL 提供具体示例、选择题或跳过入口，并将缺失信息标记为待验证。

### Requirement 3: 个人 IP 档案

**User Story:** AS 内容创作者, I want to建立并维护个人 IP 档案, SO THAT系统能够生成符合我定位的选题和文案。

#### Acceptance Criteria

1. WHEN 用户创建或编辑个人 IP 档案, THE system SHALL 保存定位、目标受众、内容支柱、常用观点、表达偏好和禁用表达。
2. WHEN 用户提交一份个人 IP 档案文档或表格, THE system SHALL 提取可识别字段并生成待审核条目。
3. WHEN 用户审核待审核条目, THE system SHALL 将用户确认的条目加入个人 IP 档案并记录来源。
4. IF 导入文件包含无法识别的内容, THE system SHALL 保留原始文件并将无法识别部分标记为待人工处理。

### Requirement 4: 素材导入与筛选

**User Story:** AS 内容创作者, I want to导入本地素材文件夹和外部文档, SO THAT系统能够发现适合个人 IP 的选题、观点、金句和文案片段。

#### Acceptance Criteria

1. WHEN 用户上传文档、表格或网页链接, THE system SHALL 解析文件名称、格式、正文、表格字段、链接地址和导入时间。
2. WHEN 用户通过桌面同步客户端连接指定素材目录, THE system SHALL 识别新增或更新的 PDF、Word、Excel、Markdown 和 TXT 文件并避免重复导入相同文件版本。
3. WHEN 素材解析完成, THE system SHALL 提取候选选题、核心观点、金句、可引用段落和平台适配建议。
4. WHEN 系统完成 IP 相关性筛选, THE system SHALL 为每条候选内容提供相关性标签、证据来源和人工审核状态。
5. IF 文件解析失败, THE system SHALL 展示失败原因并允许用户重新上传、重新授权链接或改用手动输入。

### Requirement 5: 热点与爆款研究

**User Story:** AS 内容创作者, I want to按商业创业方向研究热点和爆款内容, SO THAT我能找到适合当天创作的真实素材。

#### Acceptance Criteria

1. WHEN 用户手动触发热点刷新, THE system SHALL 获取目标平台的热点和爆款数据并展示数据时间、来源平台和更新时间。
2. WHEN 用户查看一条爆款素材, THE system SHALL 展示标题、作者、平台、互动数据、原文链接和结构化拆解入口。
3. WHEN 系统拆解爆款素材, THE system SHALL 提取 Hook、目标受众、痛点、论点、叙事结构、金句、互动引导和可迁移模式。
4. WHEN 用户保存拆解结果, THE system SHALL 将爆款结构与原始素材建立可追溯关联。
5. IF 数据源不可用或额度不足, THE system SHALL 展示可理解的错误状态并保留已有研究数据。

### Requirement 6: 选题与多平台创作

**User Story:** AS 内容创作者, I want to把热点、个人 IP 档案和素材组合成选题及草稿, SO THAT我能快速完成多平台内容准备。

#### Acceptance Criteria

1. WHEN 用户选择热点、素材或爆款结构并发起选题生成, THE system SHALL 生成多个商业创业方向选题并说明选题依据。
2. WHEN 用户确认一个选题, THE system SHALL 生成小红书、抖音、视频号和公众号的对应内容草稿。
3. WHEN 用户编辑草稿, THE system SHALL 支持版本保存、复制、重新生成和标记为待拍摄。
4. WHEN 系统生成文案, THE system SHALL 展示引用素材、IP 档案依据和需要用户核验的事实信息。
5. IF 用户未完成 IP 档案配置, THE system SHALL 使用明确的资料缺口提示影响生成结果并允许用户补充资料。

### Requirement 7: 拍摄清单与移动端提词器

**User Story:** AS 内容创作者, I want to在手机上打开当天拍摄内容并一键进入提词器, SO THAT我能从准备好的文案直接开始拍摄。

#### Acceptance Criteria

1. WHEN 用户将草稿标记为待拍摄, THE system SHALL 将其加入指定日期的拍摄清单。
2. WHEN 用户打开手机端当天拍摄清单, THE system SHALL 按状态展示待拍、拍摄中、已完成和需修改的内容。
3. WHEN 用户点击进入提词器, THE system SHALL 以适合手机拍摄的全屏界面显示文案，并支持字号、滚动速度、镜像和暂停控制。
4. WHEN 用户在手机端复制提词内容, THE system SHALL 将完整文案复制到系统剪贴板并保留当前拍摄记录。
5. WHEN 用户在任一设备更新拍摄状态或文案, THE system SHALL 在其他已登录设备同步最新版本。

### Requirement 8: 多端访问与云端同步

**User Story:** AS 内容创作者, I want to在电脑和手机之间共享内容工作台数据, SO THAT我能在不同场景连续完成研究、编辑和拍摄。

#### Acceptance Criteria

1. THE system SHALL 提供响应式电脑端和手机端界面，并支持将手机端安装为桌面入口。
2. WHEN 用户在云端完成登录, THE system SHALL 仅返回该用户有权访问的档案、素材、草稿和拍摄记录。
3. WHEN 用户在设备上创建、编辑或审核内容, THE system SHALL 保存变更版本和更新时间。
4. WHEN 多台设备存在版本差异, THE system SHALL 展示冲突版本并允许用户选择保留的版本。
5. IF 云端暂时不可用, THE system SHALL 保留已加载内容和未提交编辑，并在恢复连接后提示用户同步状态。

### Requirement 9: 安全与数据治理

**User Story:** AS 内容创作者, I want to控制个人素材和第三方数据的访问范围, SO THAT我的内容资产能够安全使用。

#### Acceptance Criteria

1. THE system SHALL 将 RedFox API Key 和其他服务凭证保存在服务端配置中，并通过用户项目配置注入。
2. THE system SHALL 对上传文件、原始素材、AI 输出和用户操作记录建立归属关系。
3. WHEN 用户删除或撤回一条素材, THE system SHALL 将其从默认检索结果中排除并保留可审计状态记录。
4. WHEN AI 输出包含外部事实或第三方内容, THE system SHALL 标记来源和人工核验状态。

### Requirement 10: 可切换视觉主题与产品化设计系统

**User Story:** AS 内容创作者和未来的产品用户, I want to在多个成熟视觉主题之间切换, SO THAT我能选择符合个人审美或品牌定位的工作环境。

#### Acceptance Criteria

1. THE system SHALL 提供至少三套具有独立配色、字体层级、密度和装饰语言的完整视觉主题。
2. WHEN 用户切换视觉主题, THE system SHALL 在工作台、研究卡片、编辑器、拍摄清单和提词器中保持主题一致，并保留用户的主题选择。
3. WHEN 用户在移动端访问系统, THE system SHALL 根据当前主题提供适配窄屏的布局、对比度和触控状态。
4. WHEN 产品新增品牌或行业场景, THE system SHALL 支持通过设计令牌扩展主题颜色、字体、圆角、阴影和动效参数。
5. THE system SHALL 为每套主题提供主题名称、适用场景和视觉预览，帮助用户在切换前做出选择。
6. WHEN 用户打开系统, THE system SHALL 直接展示工作台首页，并在左侧导航中提供定位发现、热点研究、素材库、爆款结构库、选题助手、内容创作和今日拍摄入口。
7. THE system SHALL 提供至少两套浅色主题，并在主题选择器中展示浅色背景、文字、强调色和卡片层级的视觉差异。

### Requirement 11: 分层内容策略

**User Story:** AS 个人 IP 创作者, I want to在流量积累的不同阶段采用不同内容策略, SO THAT我能在获得泛流量的同时逐步建立信任并服务 IP 核心目标。

#### Acceptance Criteria

1. WHEN 用户完成 IP 核心目标配置, THE system SHALL 生成泛流量触达、垂直信任和核心目标转化三类内容策略。
2. WHEN 用户生成或筛选热点、素材、选题或文案, THE system SHALL 为内容标记所属策略层级、内容任务和对应的 IP 核心目标。
3. WHEN 用户处于初期流量积累阶段, THE system SHALL 推荐与创作者领域相关且具备广泛兴趣入口的泛流量内容，并保留与 IP 核心目标的关联解释。
4. WHEN 用户查看内容策略组合, THE system SHALL 展示三类策略的建议比例、发布节奏、平台适配和阶段目标。
5. WHEN 用户从泛流量内容进入垂直信任或核心目标转化, THE system SHALL 支持建立内容链路并展示前后内容的承接关系。
6. IF 内容仅具备泛流量价值且缺少定位、信任或目标承接, THE system SHALL 标记承接缺口并提供补充方向。
7. WHEN 用户调整策略比例或发布节奏, THE system SHALL 校验策略总量和阶段目标，并保存调整后的策略版本。
8. WHEN 用户完成定期复盘或与系统完成策略讨论, THE system SHALL 基于用户确认的判断更新策略比例、阶段状态、内容任务和调整原因。
9. WHEN 用户查看策略历史, THE system SHALL 展示每次调整的时间、调整前后配置、依据和对应内容表现。
