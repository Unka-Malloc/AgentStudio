# Pact 项目进度综合评估

日期：2026-06-03  
分支：`codex/knowledge-distillation-v2`  
评估性质：内部进度评估，不是对外宣传材料，也不是生产可用声明。

## 1. 评估口径

本评估覆盖当前仓库已经形成的产品目标、架构基础、云端服务、平台网关、外部服务对接、MCP/工具/技能治理、共享空间、客户端管理和 8 个已确认上下贯穿场景。

评估依据包括：

- `docs/reports/history/COMMERCIALIZATION-IMPROVEMENT-PLAN.zh-CN.md` 中已记录的商业目标和工程约束。
- `docs/scenarios/README.md` 中确认的 8 个场景。
- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md` 中的场景差距清单。
- `docs/reports/history/SUBSYSTEM-REFACTOR-CHECKLIST.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`、`docs/reports/history/PROJECT-HYGIENE-BASELINE-2026-06-03.md` 中的架构、生产和工程卫生口径。
- 近期已提交变更，尤其是外部服务注册、运行时依赖下载、知识蒸馏服务硬化、前端架构门禁和 Tool/Skill Management 改造。
- 当前可见的验证脚本和已纳入 `package.json` 的门禁。

本评估不把当前工作树中未提交的并行改动计入“已实现”。未提交改动只能作为后续验证线索，不能作为完成证据。

## 2. 总体结论

Pact 当前已经具备继续商业化推进的软件基础：架构边界清晰，MCP 服务层、共享空间、Tool/Skill Management、外部服务注册、运行时依赖下载、操作审计、指标采集、知识蒸馏外部服务边界和控制台模块化均已形成可验证基础。

但 Pact 当前还不能判断为商业目标已经全部实现。项目更接近“主干架构已成型、多个关键链路已有局部闭环、正在从工程原型向可试点产品收敛”的阶段。主要缺口集中在：

- 真实云服务控制面还没有闭合，包括账号、租户、设备、订阅、用量、限额、多端同步和公网运营安全。
- 企业私有化交付仍缺安装、升级、迁移、备份恢复、密钥管理、审计导出和运维证据。
- 8 个场景中只有工作空间文件传输最接近完整闭环，其余场景仍有真实 provider、授权刷新、统一审计、审批恢复、客户端体验或生产证据缺口。
- 外部云盘、GitHub/Gerrit、Dify/RAGFlow 等外部系统仍大量依赖 contract-mode、dry-run、fake provider 或本地适配证据，缺真实凭据环境下的稳定 E2E。
- 手机客户端、个人云服务和企业部署包还没有达到可销售产品级闭环。

当前最合理的推进方式是继续围绕 8 个场景分批收敛，每次只提交一个可独立验证的最小功能项，先补齐场景状态台账和真实链路断点，再推进客户端和云端控制面。

## 3. 商业目标记录状态

此前提出的商业目标和工程约束已经在文档中记录，核心内容如下：

| 目标或约束 | 当前记录状态 | 备注 |
| --- | --- | --- |
| Pact 是轻量协作服务层，不是新超级智能体 | 已记录 | 已写入商业化提升计划和架构口径。 |
| 覆盖个人云服务 | 已记录 | 目标已明确，但实现仍未闭合。 |
| 覆盖企业私有化部署 | 已记录 | 目标已明确，但交付包和运维证据不足。 |
| 优化主线从云端服务、外部服务、平台网关到下游客户端管理 | 已记录 | 新增实现应按全链路价值排序。 |
| 集中攻关 8 个已确认场景 | 已记录 | `docs/scenarios/` 已列明场景和机器可读目录。 |
| 知识蒸馏算法由独立线程推进 | 已记录 | 本主线只覆盖服务接入、网关、控制台、授权、审计、导出和可观测性。 |
| 开发阶段增加 SQLite 指标埋点 | 已记录并部分实现 | Tool Management 已有请求量、工具调用量、传输大小、速率、耗时和错误率等 SQLite 事件表。 |
| 控制第三方插件和依赖数量 | 已记录 | 非必要不新增。 |
| 依赖政策 | 已记录 | 默认仅允许依赖开源项目，并优先选择可自托管、可替换方案。 |
| 最小独立提交和门禁验证后推送 | 已记录并在近期执行 | 仍需要坚持按功能拆分提交。 |

## 4. 已实现的软件基础

### 4.1 架构和文档基础

已实现：

- `docs/Architecture.md`、`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/reports/history/COMMERCIALIZATION-IMPROVEMENT-PLAN.zh-CN.md` 和 `docs/scenarios/` 已形成主线文档基础。
- `docs/scenarios/scenario-catalog.json` 已提供 8 个场景的机器可读目录。
- `docs/reports/history/SUBSYSTEM-REFACTOR-CHECKLIST.md` 已把管理层、服务层、应用层、基建层和横切治理的 provider / operation / domain service 边界状态纳入台账。
- 已有生产差距清单、工程卫生基线、验证框架和多类 `server:verify:*` 门禁。

仍未实现：

- 场景差距文档与最新代码进度尚未完全同步，部分原 P0 缺口已经被近期提交缩小，需要新增“当前状态”或“证据链接”字段。
- 还缺统一的面向决策层的场景完成度仪表盘，把 `implemented`、`contractVerified`、`liveVerified`、`blocked`、`planned` 分开显示。

### 4.2 MCP 服务层和平台网关

已实现：

- MCP HTTP 入口、discovery、signed handshake、本地 grant、SSE/list_changed 以及五类语义出口已形成基础。
- MCP adapter 已从直接依赖 Tool Management internals 迁移为面向 `pact.tool-skill-management.v1` provider。
- Tool Management catalog、grant、policy、runtime、audit 和 local grant 已有基础。
- 外部 MCP passthrough、外部服务 adapter、外部服务 registry、composition preset 和 external service API registration 已在近期提交中落地。
- 运行时依赖下载、预检、脚手架、离线包相关逻辑已有进一步硬化。

仍未实现：

- 个人云公网网关、企业独立网关、多租户 ingress、限流、滥用防护、租户隔离和成本治理还没有产品级闭环。
- 已连接智能体的 grant/key 在权限变更后的实时刷新、失效和 SSE 通知仍需要在场景 03 中继续验证和硬化。
- 外部 MCP 和外部 HTTP 服务的真实生产运行、密钥轮换、provider 级健康探测和故障降级仍缺长期证据。

### 4.3 Tool/Skill Management 和能力包

已实现：

- `pact.tool-skill-management.v1` provider 已承接工具和技能管理边界。
- Tool Management 已有 catalog、grant、policy preview/evaluate、runtime 调用、审计、metric、pending operation 和 Prometheus 文本导出。
- SQLite 开发态埋点已覆盖 HTTP 请求、工具调用、传输字节、传输速率、耗时、错误率、top tool、top route、pending operation 等统计。
- capability package lifecycle 已支持 `plan`、`submit`、`lifecycle` 等基础流程。
- 近期已把上传后的 skill package 独立存储到服务端 skill library，并把 active skill package 暴露到 MCP discovery。

仍未实现：

- `workspace.skill.upload` 到独立 server skill library、capability package lifecycle、安全扫描、激活、目录刷新和客户端可安装体验还需要进一步统一。
- Skill 包依赖隔离、运行时依赖扫描、签名校验、版本 pin、回滚、禁用和执行沙箱仍未达到生产级。
- 客户端 Skill Hub 还没有形成“发现、下载、安装、授权、执行、撤销、审计”的完整体验。

### 4.4 共享空间和文件传输

已实现：

- 工作空间、文件夹、文件、artifact、proposal、checkpoint 等协议和 operation 已有基础。
- MCP 上传、下载、stat、patch、checkpoint、restore 等链路已有验证基础。
- 共享空间资产治理、workspace contribution、固定资产 bucket、贡献状态机、loan record、usage event、audit event 和排行榜已有基础。
- 本机目录、iCloud local adapter、共享空间 mount、受控路径和 checkpoint 相关能力已形成较强闭环。

仍未实现：

- 大文件和二进制文件的流式上传下载、断点续传、配额、路径 ACL、冲突处理、跨设备同步和版本恢复仍需要生产硬化。
- 共享空间 UI、审计 drilldown、跨智能体协作演示和移动端输入体验仍未完成。
- “共享空间作为个人云第一产品入口”的云端对象存储、同步和多端一致性还没有闭合。

### 4.5 云盘和外部文件服务

已实现：

- CloudDrivePort 已覆盖 iCloud、OneDrive、Google Drive、Dropbox 等 provider 名称和统一 receipt 形态。
- iCloud / OneDrive 本机目录 projection 能进行受控目录实读实写。
- contract-mode adapter 能证明内部协议、receipt、ledger、checkpoint 和审计链路。
- 近期外部服务 gateway registration 为更多 provider 接入提供了统一注册、doctor、prepare、smoke 和运行时桥接基础。

仍未实现：

- OneDrive、Google Drive、Dropbox 的真实 OAuth / Remote、真实远端上传下载、列目录、权限列表、etag/revision/webUrl receipt 仍未完成；其中 OneDrive v0.0.1 已先收敛为本机同步目录 projection。
- WebDAV、S3、SFTP、NAS、用户指定云主机和更多本地目录模式仍未产品化。
- 还缺真实 provider lab、fake provider server、nightly contract test 和真实凭据 smoke 的分层验证策略。

### 4.6 知识蒸馏和知识服务接入

已实现：

- 知识蒸馏主线已从内部算法入口迁移为 `external.knowledge.distillation` 外部服务边界。
- 工具 catalog 已暴露外部知识蒸馏的 health、capabilities、runtime health、runs、evidence、export 等能力。
- 知识蒸馏服务近期完成了运行时硬化，包括服务健康、运行时依赖、容器验证、引用框架同步和外部服务验证脚本。
- 内部旧 `knowledge.distillation.*` 和 `knowledge.distillation.workbench.*` 已进入迁移壳或兼容壳口径，不再作为算法演进主面。
- AgentLibrary access decision、receipt、loan、denied request audit 已为知识访问和导出提供安全边界基础。

仍未实现：

- 本主线不负责知识蒸馏算法本身的优化，算法质量、模型选择、蒸馏策略和评测细节由独立线程推进。
- 控制台正式入口、运行级授权隔离、导出级权限快照、跨用户 run 读取拒绝、取消/归档/比较等资源级裁决仍需要继续验证。
- 真实外部知识库、真实语料、真实模型调用和成本归因仍缺生产证据。

### 4.7 代码提交和代码评审

已实现：

- Codespace、RepositoryPort、ReviewPort、Gerrit local/git upload、GitHub contract path 和相关 verifier 已存在。
- `pact.codespace` 和代码管理相关 operation 已纳入架构和协议边界。
- Gerrit 方向有本地 git upload 路径，GitHub 方向有 contract upload 和本地 CLI fallback 基础。

仍未实现：

- 代码提交仍需要 durable queue / workflow，把智能体 MCP 调用、审批、worker、重试、idempotency、状态查询和真实 provider receipt 串起来。
- GitHub PR live adapter 还需要稳定解析真实 PR number、URL、state、head/base、draft 和 provider response。
- Gerrit/GitHub 真实凭据下的 E2E、失败恢复、重复提交去重和审计查询仍需补齐。

### 4.8 权限、审批、审计和可观测性

已实现：

- Authorization Governance store、策略裁决、approval grant、console auth、operation authorization、Tool policy、MCP local grant 和 denied audit 已有基础。
- Tool Management 已有 pending operation 表和运行时接口，可记录高风险 MCP 操作的挂起、审批、拒绝和恢复所需字段。
- Operation audit、console audit、tool audit、cloud drive ledger、workspace ledger、knowledge receipt 等多套记录已存在。
- Trace、runtime logging、operation policy、security hardening、observability API 和审计导出方向已有脚本和实现基础。
- SQLite 指标表已经覆盖用户要求的请求量、工具调用量、数据传输大小和速率等开发期统计量。

仍未实现：

- 场景 07 的“所有操作有一个算一个全都记下来”还需要全局 audit facade 和强制覆盖验证，避免后台 worker、provider helper 或直接调用绕过统一审计。
- 场景 08 的主页审批 UI、pending operation 全流程、超时、撤销、幂等恢复、客户端 `operation_reply` 体验和审批后原请求恢复仍需继续硬化。
- 跨 operation audit、tool audit、provider ledger、queue event、trace event 的统一 trace drilldown 仍不完整。

### 4.9 客户端管理和控制台

已实现：

- `server-web` 管理层已按 bridge、`/api/*`、事件订阅和受控下载 URL 访问服务层，不直接读 server runtime。
- 近期已通过前端架构门禁修复，控制台组件、侧边栏、runtime downloads、knowledge view 和 external services view 正在模块化。
- 已有客户端目标扫描、MCP 插件安装、pairing、doctor、runtime downloads、production health、Knowledge、Workspace、External Services、Admin 等入口基础。

仍未实现：

- 桌面客户端、服务器控制台和移动端之间还没有统一的一等用户旅程。
- iOS / Android 手机端尚未形成产品入口。
- 一条命令安装需要覆盖 macOS、Linux、Windows、WSL、OrbStack、常见云主机、无 Node 环境、远端智能体无交互安装和安装报告回传。
- 控制台还缺面向 8 个场景的统一完成度、pending approvals、外部 provider 凭据、真实 E2E 状态和成本用量视图。

### 4.10 部署、运维和交付

已实现：

- Docker、离线包、Feature Profile、runtime dependency downloads、production readiness gate、v0.0.1 readiness 和多类 verifier 已有基础。
- `pact.devops.v1`、monitor alerts、maintenance agent、runtime summary 和 operation registry 相关能力已形成雏形。

仍未实现：

- 个人云控制面、企业安装包、一键部署、管理员初始化、升级、迁移、回滚、备份恢复演练、密钥管理后端和标准运维手册仍未完成。
- 还缺长期容量、性能、备份恢复、异常恢复和真实外部依赖故障演练证据。
- `server:verify:production-readiness` 的结果需要持续跟踪，不能用局部 verifier 通过替代生产就绪判断。

## 5. 八个场景逐项进度

| 编号 | 场景 | 当前状态 | 已实现部分 | 未实现或未闭合部分 |
| --- | --- | --- | --- | --- |
| 01 | 代码提交 | 部分实现 | Codespace、Gerrit 路径、GitHub contract path、本地 repo 操作、代码管理 operation 和 verifier 基础已存在。 | 缺 durable queue/workflow、审批后恢复、真实 GitHub PR receipt、重试/idempotency、provider 状态同步和真实凭据 E2E。 |
| 02 | 知识蒸馏 | 部分实现 | 外部服务边界、runtime health、runs、evidence、export、容器/引用框架/依赖验证、旧内部入口迁移壳已形成。 | 算法主线不在本线程；正式控制台入口、run 级授权隔离、真实模型/语料/成本证据、跨用户拒绝验证仍需闭合。 |
| 03 | 权限配置 | 部分实现 | Governance store、策略裁决、approval grant、Tool/MCP grant、policy revision receipt 基础已有。 | 权限变更后 MCP key/grant 实时刷新、SSE 通知、网关缓存失效、active grant 重算和上下游拦截证据仍需完成。 |
| 04 | 工作空间文件传输 | 接近闭合 | MCP 上传/下载/stat/patch/checkpoint/restore、本机目录、受控路径、checkpoint、operation audit 和 verifier 基础较完整。 | 大文件流式传输、断点续传、路径 ACL、配额、冲突处理、跨设备同步和 UI drilldown 仍需生产硬化。 |
| 05 | 技能管理 | 部分实现且近期有进展 | Tool/Skill provider、capability package lifecycle、skill package 独立存储、active skills discovery 已有基础。 | MCP 上传到独立 skill library 的全链路、扫描、激活、目录刷新、客户端安装/执行/撤销体验和运行时隔离仍未完全闭合。 |
| 06 | 云盘共享 | 部分实现 | iCloud / OneDrive 本机目录 projection、统一 CloudDrivePort、Google Drive / Dropbox contract-mode provider、transfer/access receipt、checkpoint 和外部服务注册基础已存在。 | OneDrive/Google Drive/Dropbox 真实 remote live adapter、OAuth、真实远端上传下载、provider receipt、nightly real provider smoke 仍未完成。 |
| 07 | 日志记录 | 部分实现 | Operation audit、console audit、tool audit、provider ledger、trace/observability/API 审计导出基础已存在。 | 还缺全局强制 audit facade、覆盖率 verifier、所有 mutation/外部 IO/后台任务统一落账和同一 trace drilldown。 |
| 08 | 操作审核 | 部分实现且近期有进展 | `requiresConfirmation`、Tool policy、MCP authorization request、pending operation store/runtime 已有基础。 | 主页审批 UI、原请求 payload 挂起、审批后恢复执行、超时/撤销/幂等、客户端 `operation_reply` 体验仍需闭合。 |

## 6. 仍未实现的产品级能力

### 6.1 个人云服务

尚未完成：

- 账号、租户、设备和客户端生命周期。
- 云端 workspace、共享空间和对象存储。
- 订阅、用量、限额、成本归因和滥用防护。
- 多设备同步、授权撤销、远端智能体状态跟踪。
- 公网 API 的安全、速率限制、运营监控和事件响应。

### 6.2 企业私有化部署

尚未完成：

- 一键部署、管理员初始化、离线升级、迁移和回滚流程。
- 企业级密钥管理、审计导出、数据保留、删除证明和权限继承。
- 备份恢复演练、容量基准、故障演练和运维 runbook。
- 私有化部署下的外部服务凭据配置、provider lab 和长期监控。

### 6.3 多端客户端

尚未完成：

- iOS 和 Android 手机端。
- 手机系统分享、文件、图片、语音、剪贴板输入到共享空间。
- 手机端查看审批、产物、共享文件、安装状态和远端智能体状态。
- 桌面客户端、控制台、远端智能体和手机端的一致旅程。

### 6.4 外部服务真实闭环

尚未完成：

- GitHub live PR、Gerrit live change、OneDrive/Google Drive/Dropbox live upload/download。
- Dify/RAGFlow 等真实上游知识库凭据环境和权限再授权证据。
- 外部服务 provider 的统一 smoke、contract test、real provider smoke 和故障降级。
- provider receipt 不能只停留在 `contractVerified`。

### 6.5 生产级治理

尚未完成：

- 全局 audit facade 和 trace drilldown。
- 生产级限流、配额、成本、容量、备份、恢复、迁移和升级报告。
- 开源依赖约束的机器门禁和第三方插件新增审查流程。
- 对外材料脱敏、能力状态标记和生产承诺边界。

## 7. 当前已形成的验证资产

已经存在或近期使用过的关键验证入口包括：

- `npm run server:verify:mcp-http --silent`
- `npm run server:verify:tool-management --silent`
- `npm run server:verify:tool-skill-management --silent`
- `npm run server:verify:capability-package-lifecycle --silent`
- `npm run server:verify:architecture-patterns --silent`
- `npm run server:verify:scenario-catalog --silent`
- `npm run server:verify:business-scenarios --silent`
- `npm run server:verify:frontend-architecture --silent`
- `npm run server:verify:runtime-dependency-downloads --silent`
- `npm run server:verify:external-knowledge-distillation --silent`

注意：这些门禁能证明对应模块或场景合同，不等同于整体生产可用。真实外部 provider、云端控制面、移动端和企业部署仍需要独立 E2E 与生产证据。

## 8. 下一批最小提交建议

建议按以下顺序继续收敛，每项都应单独提交、单独验证、单独推送：

1. 更新场景状态台账：为 8 个场景增加当前状态、完成证据、阻塞项、下一步和验证脚本，修正旧 P0 差距中已经被近期提交部分缩小的条目。
2. 补场景 05 技能上传闭环：把 `workspace.skill.upload`、capability package lifecycle、独立 skill library、active discovery 和基础扫描串成一个可验证链路。
3. 补场景 08 审批闭环：把高风险 MCP 操作挂起到 pending operation，控制台主页审批后恢复原请求，并补超时/撤销/幂等验证。
4. 补场景 03 权限刷新闭环：权限变更生成 revision，active grant 标记 stale 或重算，MCP SSE 通知和网关拦截状态可验证。
5. 补场景 06 live/fake provider lab：为云盘 provider 建 fake server 和 live smoke 分层，先让 receipt 能区分 contract、fake-live、real-live。
6. 补场景 01 durable code submission：代码提交进入 durable queue/workflow，worker 写回 Gerrit/GitHub receipt，MCP 返回可查询状态。
7. 补场景 07 全局审计覆盖：定义 audit facade，先覆盖 operation dispatcher、Tool runtime、provider 外部 IO 和后台 worker 的关键状态改变。
8. 建立个人云和企业私有化的最小控制面文档，再决定第一批实现范围，避免客户端和网关功能继续分散。

## 9. 收敛判断

当前项目已经在主线方向上推进，重点不再是单点算法，而是从外部服务、平台网关、共享空间、工具/技能治理到客户端管理的全链路。近期实现也符合这个方向：外部服务注册、运行时依赖下载、Tool/Skill Management、指标埋点、知识蒸馏外部服务和前端架构门禁都服务于全链路收敛。

但距离“已实现商业愿景的软件基础并可停止”仍有明显距离。最短路径不是继续扩展更多新模块，而是把 8 个场景逐个做成可演示、可审计、可恢复、可授权、可观测、可验证的闭环，并严格区分 contract-mode 和真实生产证据。
