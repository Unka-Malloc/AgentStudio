# Pact 子系统协议化重构进度 Checklist

> 历史归档标注：本文保留为阶段性 checklist，不再作为当前完成度事实源。当前能力完成度必须看核心文档、生产 readiness 报告和对应 `npm run server:verify:*` verifier。

更新日期：2026-05-25

本文用于跟踪 Pact 各层、各子系统的低耦合高内聚重构进度。分层口径以 `docs/architecture/PACT-SYSTEM-ARCHITECTURE.html` 中的系统架构图为准：

```text
管理层
  -> 应用层：左列（知识转化〔含 AgentLibrary〕 + 共享空间） + 右列（代码管理 + 通用工具与技能）
  -> 切面层：上游服务切面 + 下游客户端切面 + 平台应用服务切面
  -> 能力层：平台能力 + 协作治理 + 智能体 + 策略管理
  -> 基建层：核心能力 + 安全权限 + 模块管理 + 算法和数据结构 + 存储 + 运维基础

侧边：启动装配 / Composition Root 向管理层、应用层、切面层、能力层和基建层注入依赖
```

应用层按架构图使用显式左右列，每列两个模块；能力层按架构图包含平台能力、协作治理、智能体和策略管理：

| 列内顺序 | 左列 | 右列 |
| ---: | --- | --- |
| 1 | 知识转化 | 代码管理 |
| 2 | 共享空间 | 通用工具与技能 |

架构图已用 `specialized-grid` 两列容器和两个 `application-column` 容器固化应用层左右分组，用 `capability-grid` 承载能力层平台能力、协作治理、智能体和策略管理：桌面端保持应用层左列两个、右列两个；移动端退化为单列时先展示应用层左列两个、右列两个，再展示切面层和能力层平台能力、协作治理、智能体、策略管理，但模块归属口径不变。

2026-05-25 本轮复核：`docs/architecture/PACT-SYSTEM-ARCHITECTURE.html` 的应用层 HTML 结构已与本 Checklist 对齐，左列固定为知识转化、共享空间，右列固定为代码管理、通用工具与技能；协作治理、智能体和策略管理归入能力层。

进度百分比表示“协议化/解耦完成度”，不是产品功能完成度，也不是生产可用性评分。启动装配是侧边组合边界，不属于能力层、应用层或基建层；协议注册表、权限迁移、API Facade 拆分、Jobs Controller 拆分、MCP Adapter 拆分属于横切治理任务，不能再作为独立架构层统计。

## 跟踪口径

| 状态 | 含义 |
| --- | --- |
| `[ ]` | 尚未开始或仍以直接调用为主 |
| `[~]` | 已有边界或 provider，但仍存在明显直接依赖 |
| `[x]` | 已完成协议化/解耦，并有验证或架构门禁保护 |

完成度评估同时看五件事：

1. 是否有清晰的协议、operation、provider 或 mount contract 边界。
2. 上层是否仍直接持有下层 runtime、store、service 或业务实现细节。
3. 子系统之间是否通过 operation/input/context/provider 交互，而不是跨层直接调用。
4. 文档口径是否与真实实现和架构图一致。
5. 是否有 `server:verify:*` 或架构守卫脚本保护边界不回退。

能力层和应用层架构图验收还额外检查：

1. HTML 结构中能力层必须包含平台能力、协作治理、智能体和策略管理，应用层仍保留左列和右列语义分组，便于按模块归属维护。
2. CSS 必须保留 `capability-grid`、`specialized-grid` 和 `application-column` 结构，不能把能力层与应用层模块混成一个自然流式列表。
3. 移动端单列顺序必须是外观层、知识转化、共享空间、代码管理、通用工具与技能、切面层、能力层平台能力、协作治理、智能体、策略管理、基建层。

## 架构图节点进度

| 架构层 | 架构图节点 | 状态 | 完成度 | 当前情况 | 待完成事项 | 下一步验收 |
| --- | --- | --- | ---: | --- | --- | --- |
| 管理层 | 管理层 | `[x]` | 100% | 管理界面承载知识库、工作空间、调试和系统管理入口；`server-web` 源码只通过 `bridge`、`/api/*`、事件订阅和受控下载 URL 进入应用层或切面层，不 import server platform/runtime/storage，也不构造后端 runtime。 | 已完成。本子系统后续只允许维护性变更；管理层需要的新能力必须先进入应用层能力、切面 operation 或 bridge 方法，不能在前端绕过协议读取运行时实现。 | 已通过 `npm run server:verify:management-layer` 和全量 `npm run server:verify`。 |
| 启动装配边界 | 启动装配 / Composition Root | `[x]` | 100% | `http-server` 中 runtime/provider 创建已迁到 `composition-root` 和 `server-runtime-providers`；启动快照通过 `dispatchInternalOperation` 发布；启动装配在架构图中已作为侧边 Composition Root 表达。 | 已完成。本子系统后续只允许维护性变更，不能让业务 runtime 装配回流到 `http-server`、切面层或能力层。 | 已通过 `npm run server:verify:architecture-patterns`、`npm run server:verify:platform-boundaries`、`npm run server:verify:protocol-operations` 和全量 `npm run server:verify`。 |
| 切面层 | 协议入口 / 服务入口 | `[x]` | 100% | HTTP server 入口已变薄；System Controller 已拆成 handler family；MCP adapter 只面对五个语义入口和 `toolSkillManagementProvider`；`api-facade` 只拼 HTTP/RPC 返回结构，settings/agent selector、jobs、client connection、maintenance、client runtime、Tool/Knowledge/Runtime summary 均来自 `console-domain-services` 或 provider；`jobs-controller` 只通过 `pact.job-workflow.v1` provider 创建、查询、复用、重跑和读取任务结果。 | 已完成。本子系统后续只允许维护性变更；协议入口新增能力必须先进入 operation、provider 或 domain service 投影，不能重新直接持有业务 runtime/store/service。 | 已通过 `npm run server:verify:architecture-patterns`、`npm run server:verify:headless`、`npm run server:verify:business-scenarios` 和全量 `npm run server:verify`。 |
| 应用层 | 知识转化 | `[x]` | 100% | 架构图把知识蒸馏、知识索引、原始语料、外部 KnowledgeBasePort 和 AgentLibrary 归为一个应用层模块；Knowledge console summary 已独立，`api-facade` 不再直接读 `runtime.mounts.knowledgeBase`；`knowledge-access` 已有 evaluate/receipt/loan/denied request 执行器；`raw-corpus.format.convert`、`knowledge.dossier.export`、`knowledge.distillation.export` 已接入 `KnowledgeTransformation` provider，并统一返回 portable export package 与 AgentLibrary access decision；v0.0.1 已新增 Dify/RAGFlow `pact.knowledge-backend-port.v1` contract-mode，覆盖 backend connect、safe space list、backend search、evidence read、export gate 和 permission request。 | 已完成。本子系统后续只允许维护性变更；更复杂的真实语料转换、Dossier 编排、真实 Dify/RAGFlow 凭据验收和蒸馏运行质量属于功能增强，不再是协议化/解耦缺口。无真实 Dify/RAGFlow 凭据时只能标记 `contractVerified`，不能说成真实上游 API 已完成。 | 已通过 `npm run server:verify:v001-knowledge-e2e`、`npm run server:verify:knowledge-transformation`、`npm run server:verify:agent-library-access`、`npm run server:verify:knowledge-architecture-governance`、`npm run server:verify:protocol-operations` 和 `npm run server:verify:architecture-patterns`。 |
| 能力层 | 智能体 | `[x]` | 100% | 已落地 `pact.agent-runtime.v1` provider，统一封装 agent config registry、Agent Gateway config/registry/call、Model Probe、model routing health 和带 settings/model-library 投影的 gateway 调用；agent context、agent memory、Agent Gateway、agent-configs 已从协议入口迁入 runtime provider 或 composition root；settings 与 agent selector 的 console 投影已从 `api-facade` 下沉到 `console-state-projections`；word-cloud 的智能体调用也改走 agent provider。 | 已完成。本子系统后续只允许维护性变更；新增 agent 能力必须先进入 `pact.agent-runtime.v1` provider 或 agent operation，不能让切面层重新拿 gateway module loader、model probe loader 或 agent config registry 实例。 | 已通过 `npm run server:verify:agent-gateway`、`npm run server:verify:model-routing`、`npm run server:verify:knowledge-console`、`npm run server:verify:business-scenarios` 和 `npm run server:verify:architecture-patterns`。 |
| 应用层 | 共享空间 | `[x]` | 100% | 架构图将共享空间拆为上下两类：上层云盘共享承载 Cloud Drive Port、iCloud local projection 和 OAuth contractVerified 外部云盘接入；下层本地共享承载 `agent-workspace`、受控文件空间和 StateCommit。workspace handler 已拆分；`workspace-contribution`、workspace file upload/list/download/read/write/patch、checkpoint diff/scope/restore preview/restore 均已接入 operation/provider 后端；checkpoint restore 在通用 checkpoint tree 记录 marker/event/audit，同时把文件树 dry-run 和实际恢复委托给共享空间 `restoreWorkspaceFiles` provider；v0.0.1 本机目录闭环已补齐 `pact.sharedspace.*` 语义 operation、运行态 local-dir mount JSON 配置、mountRef sync、MCP sourcePath 脱敏、控制台连接/同步入口和 symlink 拒绝审计。 | 已完成。本子系统后续只允许维护性变更；本机目录 source/projection 不能被说成已备份，只有 CAS + StateCommit 后才是 archived/committed。 | 已通过 `npm run server:verify:v001-local-dir-e2e`、`npm run server:verify:workspace-local-dir-sync`、`npm run server:verify:workspace-checkpoints`、`npm run server:verify:workspace-contribution-governance` 和 `npm run server:verify:agent-workspace`。 |
| 能力层 | 协作治理 | `[x]` | 100% | 架构图已将协作治理下移到能力层；issue/proposal、锁和继承治理不再归共享空间本体。proposal create/apply 已接入 operation/provider 后端；workspace runtime、issue resolve、lock、inheritance/share/profile/source 已通过 `agent_workspaces.*` registry 暴露。 | 已完成。本子系统后续只允许维护性变更；proposal apply 按设计只把审核后的 proposal 转为 decision，不直接改写任意 canonical state。 | 已通过 `npm run server:verify:workspace-proposals` 和 `npm run server:verify:workspace-governance`。 |
| 应用层 | 代码管理 / Codespace | `[x]` | 100% | 架构图新增 `pact.codespace` 和 `pact.code-review.v1` 应用能力；Codespace 已有持久化 registry，保存 target evaluation、CodeChange、changeSet、review target link、status sync、upload receipt 和 append-only event；`workspace.code.*` 已从轻量 facade 迁入 `createCodespaceRegistry` provider；v0.0.1 代码库闭环新增 `codespace.*` 语义 operation、运行态 `code-management/codespace-providers.json` provider manifest、GitHub/Gerrit `RepositoryPort` / `ReviewPort` 统一包装、GitHub PR contract upload、Gerrit review dry-run、控制台 Codespace workbench 和 MCP/API/CLI 暴露。 | 已完成。本子系统后续只允许维护性变更；安全授权迁移仍作为横切任务处理，不计入代码管理子系统本身。缺少真实 GitHub/Gerrit 凭据时只能标记 `contractVerified`，不能说成真实 PR/Change 已创建。 | 已通过 `npm run server:verify:v001-codespace-e2e`、`npm run server:verify:codespace`、`npm run server:verify:gerrit-mcp`、`npm run server:verify:resource-operations`、`npm run server:verify:protocol-operations`、`npm run server:verify:architecture-patterns` 和 `npm run server:verify:platform-boundaries`。 |
| 能力层 | 策略管理 | `[x]` | 100% | 已落地 `pact.strategy-management.v1` provider 和 `strategy.*` operation；workflow policy、agent policy、模型路由包装、model decision port 和 Tool Management policy preview 已统一经策略管理 provider 输出 `strategyPolicyDecision` / `strategyProtocolVersion`。 | 已完成。本子系统后续只允许维护性变更；认证、授权、grant、scope 和 denied audit 继续归 `pact.security-permissions.v1`，不能回流到策略管理硬编码。 | 已通过 `npm run server:verify:strategy-management`、`npm run server:verify:architecture-patterns`、`npm run server:verify:feature-profiles`、`npm run server:verify:core-platform` 和全量 `npm run server:verify`。 |
| 应用层 | 通用工具与技能 | `[x]` | 100% | 已落地 `pact.tool-skill-management.v1` provider，统一承接 Tool Management catalog/grant/runtime、MCP local grant、MCP 可见 operation、workspace ref 解析、输出脱敏和 MCP client connection 投影；`http-mcp-adapter` 不再直接依赖 Tool Management platform 的 `registry/store/runtime/router`；console grant/MCP authorization/passthrough 和 client connection 投影也改走 provider。 | 已完成。本子系统后续只允许维护性变更；真实 skill 包安装、远程依赖执行和更复杂 sandbox 属于功能增强，必须继续服从 capability package lifecycle、workspace asset governance 和 Tool Management grant。 | 已通过 `npm run server:verify:tool-skill-management`、`npm run server:verify:mcp-http`、`npm run server:verify:tool-management`、`npm run server:verify:architecture-patterns` 和 `npm run server:verify:protocol-operations`。 |
| 基建层 | 核心能力 | `[x]` | 100% | 已落地 `pact.core-platform.v1` provider，统一封装 Operation Dispatcher、HTTP/RPC/internal operation 调度、forward proxy 判定、接口目录和 operation registry 生命周期治理；`system.interfaces` 现在输出 `registered/wired/implemented/verified` 分级摘要，`http-server` 不再直接 import Operation Dispatcher 或手工拼接口目录。 | 已完成。本子系统后续只允许维护性变更；具体业务 operation 的执行质量归各自应用模块，核心能力只治理注册、路由、实现绑定和验证绑定。 | 已通过 `npm run server:verify:core-platform`、`npm run server:verify:architecture-patterns`、`npm run server:verify:platform-layout`、`npm run server:verify:dispatcher-unified`、`npm run server:verify:protocol-operations` 和全量 `npm run server:verify`。 |
| 基建层 | 安全权限 | `[x]` | 100% | 已落地 `pact.security-permissions.v1` provider，统一封装 console auth、operation authorization、authorization policy、authorization audit artifact、workspace asset policy、Tool policy/runtime denial audit 和 MCP local grant 授权；切面层、console executor、Tool Management 和 MCP adapter 不再直接调用 `consoleAuth.authorizeOperation`、裸 `authorizationEngine` 或裸 `authorizationStore` 做权限裁决。 | 已完成。本子系统后续只允许维护性变更；策略编排类能力继续归入能力层“策略管理”，不能回流到安全权限层硬编码业务流程。 | 已通过 `npm run server:verify:authorization-migration`、`npm run server:verify:console-auth`、`npm run server:verify:tool-management`、`npm run server:verify:architecture-patterns`，并通过直接调用扫描确认目标路径无权限直连。 |
| 基建层 | 模块管理 | `[x]` | 100% | 已落地 `pact.module-management.v1` provider，统一封装 runtime mount snapshot、mount config 持久化、热加载、runtime summary、模块模板、脚手架和 contract test；切面层、Console executor、Runtime summary 和模块生态 HTTP handler 不再直接读取 `runtime.runtimeOptions`、`runtime.mounts` 或 `mount-config` 文件。 | 已完成。本子系统后续只允许维护性变更；业务模块的具体 mount 实现和知识类 runtime 质量不计入模块管理边界。 | 已通过 `npm run server:verify:module-ecosystem`、`npm run server:verify:architecture-patterns` 和 `npm run server:verify:platform-layout`；架构守卫已禁止上层回退到 mount-config/module-ecosystem 直连。 |
| 基建层 | 算法和数据结构 | `[x]` | 100% | 已落地 `pact.data-structure.v1` provider，统一暴露 checkpoint tree projection 和 text-normalization 纯算法能力；`http-server` 不再直接导入 checkpoint tree store，而是由 Composition Root 注入 `dataStructures.checkpointTree`；provider 具备 capability 声明。 | 已完成。本子系统后续只允许维护性变更；业务层 checkpoint 使用场景和 workspace 文件恢复语义归各自应用模块，不回流到数据结构层。 | 已通过 `npm run server:verify:architecture-patterns`、`npm run server:verify:platform-layout`、`npm run server:verify:checkpoints`、`npm run server:verify:workspace-checkpoints`、`npm run server:verify:headless` 和 `npm run server:verify:state-coordination`。 |
| 基建层 | 存储 | `[x]` | 100% | 已落地 `pact.storage.v1` provider，统一封装 storage summary、raw object 读取、client registry、storage doctor、reconcile、backup/restore、source vocabulary 和 corpus search 端口；`api-facade`、`jobs-controller`、storage operation executor 和 discovery client 操作不再直接调用 `metadataStore.getStorageSummary()`、raw object 路径解析或 storage ops 工具。 | 已完成。本子系统后续只允许维护性变更；任务队列自身的 jobManager 协议化继续归入平台能力/任务工作流拆分，不回流到存储层。 | 已通过 `npm run server:verify:architecture-patterns`、`npm run server:verify:platform-layout`、`npm run server:verify:protocol-operations`、`npm run server:verify:ops` 和 `npm run server:verify:backup-restore`。 |
| 基建层 | 运维基础 | `[x]` | 100% | 已落地 `pact.devops.v1` provider，统一封装 background process status、monitor alerts、unified registration normalize/compose；`http-server` 不再直接装配 monitor alert core，console executor 不再直接 import background process status 或持有裸 `monitorAlertApi`。 | 已完成。本子系统后续只允许维护性变更；维护智能体自身的 runbook 编排继续归应用/任务工作流，不回流到运维基础层。 | 已通过 `npm run server:verify:architecture-patterns`、`npm run server:verify:platform-layout`、`npm run server:verify:monitor-alerts`、`npm run server:verify:unified-registration`、`npm run server:verify:protocol-operations`、`npm run server:verify:headless` 和 `npm run server:verify:maintenance-agent`。 |

## 横切治理清单

这些任务横跨多个架构节点，不再作为架构层单独统计，但必须作为后续重构顺序执行。

| 顺序 | 横切任务 | 关联架构节点 | 当前状态 | 验收口径 |
| --- | --- | --- | --- | --- |
| 1 | 跑最新全量验证：`npm run server:verify` | 全部，尤其启动装配边界 | `[x]` | 最新 runtime summary 迁移后已全量通过。 |
| 2 | 输出 operation registry 差距清单 | 核心能力、平台能力、应用层各能力 | `[x]` | 已落地 `docs/reports/history/protocol-operation-registry-gap-2026-05-25.md`；当前 76 个协议操作全部注册，明确空后端为 0。 |
| 3 | 补齐 P0 协议缺口 | AgentLibrary、知识转化 | `[x]` | 共享空间、代码管理、knowledge access 和知识转化协议均已完成 operation/provider/verify 闭环；原 3 个知识/原始语料空后端已清零。 |
| 4 | 迁移安全 + 权限管理 | 平台能力、安全权限、工具管理、共享空间、代码管理 | `[x]` | 已统一进入 `pact.security-permissions.v1` provider；console/auth/tool/MCP/workspace asset/knowledge access artifact 不再由能力层或应用 executor 直接持有裸 `consoleAuth`、`authorizationEngine` 或 `authorizationStore` 裁决。 |
| 5 | 继续拆 `api-facade.mjs` | 平台能力、智能体、运维基础 | `[x]` | settings、agent selector、jobs、client connection、client runtime、maintenance、Tool/Knowledge/Runtime summary 均已改为 provider/domain service 投影；`api-facade` 不再直接调用 `loadSettings()`、agent config registry、job manager、client runtime allocator 或 maintenance agent。 |
| 6 | 继续拆 `jobs-controller.mjs` | 平台能力、原始语料、任务工作流 | `[x]` | metadataStore、raw object download、stored object path 已迁入 `storageProvider`；任务创建/查询/复用/重跑/结果读取已统一进入 `pact.job-workflow.v1` provider。 |
| 7 | 继续拆 MCP adapter | 平台能力、工具管理、模块管理、安全权限 | `[x]` | MCP adapter 已只面对五个语义入口和 `pact.tool-skill-management.v1` provider；`verify-tool-skill-management` 已禁止 adapter 回退到 Tool Management platform internals。 |
| 8 | 清理 `PROTOCOLS.md` | 全部 | `[x]` | 已补齐 `pact.agent-runtime.v1`、`pact.tool-skill-management.v1` 和 `pact.job-workflow.v1` 协议口径；旧 `/api/workspaces/`、旧 MCP alias 和内部 operation 展开为 MCP tool name 的内容仅作为否定/兼容说明保留。 |
| 9 | 清理 `PRODUCTION-CAPABILITY-GAP.md` | 全部 | `[x]` | 已增加 2026-05-25 协议化重构校准，生产缺口改用 `verified-complete` / `implemented-needs-production-evidence` / `planned-contract` / `not-started` 四级完成度，避免把已完成协议化的子系统继续列为未实现。 |
| 10 | 补架构门禁 | 全部 | `[x]` | `server:verify:architecture-patterns`、`server:verify:protocol-operations`、`server:verify:platform-boundaries` 已覆盖本轮 provider/operation/domain service 边界，并由全量 `npm run server:verify` 验证。 |
| 11 | 补 v0.0.1 Phase 0 基线门禁 | 核心能力、工具管理、存储、算法和数据结构、管理层 | `[x]` | 已新增 `v001.baseline.status` API/RPC/MCP operation、控制台生产健康页基线状态卡、`server:verify:v001-baseline` 和全量 `server:verify` 集成，覆盖本地 ConfigRegistryPort、MetadataStorePort、CachePort、QueuePort、ArtifactStorePort、contract-mode SecretStorePort、五类 MCP 出口和真实存储语义。 |
| 12 | 补 v0.0.1 Phase 1 本机目录门禁 | 共享空间、工具管理、安全权限、算法和数据结构、管理层 | `[x]` | 已新增 `sharedspace.localDir.connect/list`、`sharedspace.item.list`、`sharedspace.file.read/write`、`sharedspace.item.delete` 的 operation 和 Tool Management 映射；`server:verify:v001-local-dir-e2e` 覆盖 MCP -> Sharedspace -> Local Directory 的 mountRef、sync plan/apply、CAS/StateCommit/checkpoint、audit/access receipt、控制台入口和 symlink 拒绝。 |
| 13 | 补 v0.0.1 Phase 2 代码库门禁 | Codespace、代码评审、工具管理、安全权限、管理层 | `[x]` | 已新增 `codespace.providers.manifest`、`codespace.repository.status`、`codespace.tree.list`、`codespace.file.read`、`codespace.diff.read`、`codespace.change.prepare/upload`、`codespace.review.comment/requestChanges/approve/status.sync` 的 operation 和 Tool Management 映射；`server:verify:v001-codespace-e2e` 覆盖 API/RPC/MCP/CLI 注册、GitHub/Gerrit provider manifest、secretRef-only、RepositoryPort 本地实读、ReviewPort dry-run、GitHub contract upload、audit event 和 `contractVerified` 标记。 |
| 14 | 补 v0.0.1 Phase 3 知识库门禁 | 知识转化、AgentLibrary、工具管理、安全权限、管理层 | `[x]` | 已新增 `knowledge.backend.connect`、`knowledge.space.list`、`knowledge.export.request`、`knowledge.permission.request` 的 operation 和 Tool Management 映射，并改造 `knowledge.search` / `knowledge.evidence.get` 在 Dify/RAGFlow 输入下进入 `KnowledgeBasePort`；`server:verify:v001-knowledge-e2e` 覆盖 API/RPC/MCP/CLI 注册、运行态 provider manifest、secretRef-only、safe metadata discovery、contract search、evidence receipt/loan、denied audit、export gate 和控制台 Knowledge backend workbench。 |
| 15 | 补 v0.0.1 Phase 4 云盘门禁 | 共享空间、外部服务兼容、工具管理、安全权限、管理层 | `[x]` | 已新增 `CloudDrivePort` 和 `sharedspace.drive.connect/status/item.list/file.download/file.upload/sync.plan/sync.apply/permission.list` 的 operation、Tool Management scope/toolset 和控制台 Cloud Drive workbench；`server:verify:v001-cloud-drive-e2e` 覆盖 API/RPC/MCP/CLI 注册、`.pact-data/<client>` 默认可写空间、`.pact-data/public` 只读公共空间、高级只读目录暴露、iCloud / OneDrive 受控本机目录实读/实写/同步投影、Google Drive / Dropbox secretRef-only contract-mode、transfer receipt、access receipt、checkpoint、operation audit、`localAdapterVerified` 和 `contractVerified` 标记。 |
| 16 | 补 v0.0.1 Phase 5 release 收口 | 全部，尤其迁移、验证、文档和管理层 | `[x]` | 已新增 `server:migrate:v001` 非破坏迁移/恢复点报告、`server:verify:v001` Phase 0-4 聚合 verifier 和 `docs/reports/history/v001-readiness/<run-id>/report.{json,md}`；readiness 明确区分单机可交付、`contractVerified` 外部 provider 和缺少真实凭据的生产阻塞。 |
| 17 | 补 v0.0.1 外部凭据初始化入口 | 安全权限、代码管理、知识转化、共享空间、管理层 | `[x]` | 已新增本地 `pact secret <provider> init/list/status/targets`、`pact secret.<provider>.init` 和云盘 `pact secret <provider> oauth` / `pact secret.<provider>.oauth` CLI；真实密钥仅写入 `ServerConfig.getDataDir()/secrets` 的 0600 本机 secret store，provider manifest 只保存 `secretRef` / `endpointRef` / `credentialConfigured`；`server:verify:secret-init` 覆盖 Gerrit、Dify、OneDrive stdin 初始化，以及 Google Drive mock OAuth redirect、state/PKCE/token exchange、脱敏 registry、manifest 更新、audit 和 readiness 本地凭据识别。 |
| 18 | 补安全/审计/trace 生产硬化基础闭环 | 安全权限、平台能力、工具管理、管理层 | `[x]` | 已新增 tenant/resource ABAC 裁决、console user tenant 属性、审计保留策略、脱敏审计导出和 trace drill-down API/RPC/CLI operation；`server:verify:security-hardening` 覆盖 tenant mismatch、workspace/dataClass/egress allowlist、denied request audit、脱敏 JSONL export、retention prune、真实启动后的 `/api/observability/traces/:traceId` 和 `/api/auth/audit/export`。 |
| 19 | 补控制台 session token rotation | 安全权限、平台能力 | `[x]` | 已新增 `auth.sessions.rotate` API/RPC/CLI operation；当前 session 通过 CSRF 与 scope 校验后轮换 session token 和 HMAC CSRF token，旧 token 立即失效，并写入 console audit / operation audit；`server:verify:console-auth` 覆盖轮换前后登录态与旧 token 失效。 |

## 更新规则

1. 每完成一个子系统迁移，必须同步更新本文件的状态、完成度、当前情况、待完成事项和下一步验收。
2. 每次把 `[~]` 调整为 `[x]`，必须写明对应验证命令或守卫脚本。
3. 不允许只因为文档存在就把能力标为完成；`contract_registered` 只能计为注册完成，不能计为实现完成。
4. 新增接口或模块时，必须先映射到架构图节点，再补到本 checklist。
5. 横切治理任务不能替代架构层统计；它们只能说明为什么某个架构节点尚未完成。
6. 长期架构口径仍以 `docs/Architecture.md`、`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/KNOWLEDGE-GOVERNANCE.md` 和 `docs/PRODUCTION-CAPABILITY-GAP.md` 为准。
