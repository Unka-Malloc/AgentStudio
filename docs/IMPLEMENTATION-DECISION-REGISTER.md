# Implementation Decision Register

审计日期：2026-05-21。本文是实现前的设计决策登记表，用于接下来集中做设计和拍板。

本文不是第六份核心架构文档。它只记录“还需要决策什么、优先级是什么、决策完成后要回写到哪里”。任何被拍板的长期设计结论，必须同步回写到：

- `docs/Architecture.md`
- `docs/PROTOCOLS.md`
- `docs/WORKSPACE-ASSET-GOVERNANCE.md`
- `docs/KNOWLEDGE-GOVERNANCE.md`
- `docs/PRODUCTION-CAPABILITY-GAP.md`

## 决策原则

对外口径固定为：

> 两个问题，一个能力，三个兼容。

两个问题：

- 知识库缺少面向智能体的权限管控。
- 本地智能体相对独立，难以协同。

一个能力：

- 工作空间管理，覆盖权限控制、统一 Checkpoint Tree、Operation Ledger、回溯、恢复和审计。
- 管理者视角必须有资产贡献统计报表，用来证明公共空间沉淀了什么资产、谁贡献、谁使用、复用多少、风险在哪里。

三个兼容：

- 智能体兼容：不关心底层是什么大模型、agent framework 或机器人体系，统一通过 Pact MCP service / Workspace API 接入。
- 信息源兼容：不关心信息来自知识库、网站订阅、文件库、业务系统、人工整理或智能体上传文档，统一进入 workspace asset model。
- 工作空间环境兼容：不关心工作空间运行在容器、虚拟机、本机、云端、Linux、macOS 或 Windows；只要安装 Pact 管理软件，智能体访问工作空间必须经过 Pact。

优先级定义：

- P0：不拍板就不能开始正确实现，或会影响权限、安全、协议、数据模型和四个核心演示。
- P1：不拍板会影响首轮可用闭环、控制台体验、审计可解释性和试点验收。
- P2：不拍板会影响生产硬化、跨团队扩展、性能、成本和长期维护。
- P3：增强竞争力和生态体验，可以在主闭环稳定后再做。

状态定义：

- `待决策`：需要产品和工程一起拍板。
- `默认建议`：当前文档给出的推荐方向，不等于最终决议。
- `已决议`：已经完成产品决策；实现必须按该结论落地。
- `决议后回写`：拍板后必须更新的核心文档或协议面。

## 当前决议总表

截至本轮，P0/P1/P2/P3 条目均已完成决议。后续实现以本表和各小节 `已决议` 为准；小节中的“需要决策”保留原始问题，用于追溯当时为什么要拍板。

### P0 已决议

| 决策 | 结论 |
| --- | --- |
| `DEC-P0-01` 产品边界 | 锁定“两个问题，一个能力，三个兼容”。不做完整 A2A Gateway、不做自治 Agent 平台、不做外部知识库同型复制。 |
| `DEC-P0-02` 接入面 | 智能体默认通过 Pact MCP service 接入；Workspace API 是协议事实源；其它入口只是适配。 |
| `DEC-P0-03` 身份模型 | 采用四层模型：subject 是权限主体，operator 是执行入口，agentProfile 是风险/能力上下文，libraryCard 是可审计访问凭据。 |
| `DEC-P0-04` 资产模型 | 固定完整最小资产集：rawAssets、derivedAssets、contributedAssets、evidencePacks、artifacts、tasks、observations、proposals、decisions、memoryEntries、operationLedger、snapshots。 |
| `DEC-P0-05` 权限模式 | 采用内置标准模式 + workspace 自定义扩展。内置模式保证互操作，自定义 mode/action 用于业务扩展。 |
| `DEC-P0-06` 上游再授权 | 所有上游对象进入 Pact 后必须生成 upstreamKnowledgeRef、derivedViewRef、derivedKnowledgeSpace、authorizationOverlay。 |
| `DEC-P0-07` 出口裁决 | search、evidence、context、export、artifact、distillation、memory、tool call、eval 等所有出口强制复用同一权限裁决。 |
| `DEC-P0-08` 统一 Checkpoint Tree | 任务、队列、访问请求、文件变动、知识贡献、技能调用、权限裁决、上下文暴露和恢复动作全部进入统一 Checkpoint Tree。 |
| `DEC-P0-09` git worktree 边界 | 可以复用 git tree/diff/worktree 底层能力，但产品恢复必须是 append-only restore operation，采用更安全的模式替代裸 reset 语义以保护用户数据。 |
| `DEC-P0-10` 工作空间环境 | 受管工作空间必须安装 Pact 管理软件；智能体访问必须经过 adapter；直连文件系统视为未受管。 |
| `DEC-P0-11` 贡献状态机 | 固定 submitted -> preview -> scanned -> reviewed -> published/rejected/needs_changes -> adopted -> deprecated/revoked；内容到达服务器并完成最小留档后才是 preview，审核和权限确认后才是 published。 |
| `DEC-P0-12` Skill 贡献值 | 采用“使用为主”的质量加权公式：以 usageCount * successRate 为核心，叠加 uniqueWorkspaceAdoptions，扣减 rollbackCount。 |
| `DEC-P0-13` 贡献报表 | 资产贡献统计报表进入 P0，是管理者视角必备能力。 |
| `DEC-P0-14` 演示验收 | 四个演示全部作为 P0 验收：文档互通、Skill 贡献、A/B 权限、Checkpoint Tree 恢复。 |
| `DEC-P0-15` 控制台页面 | 第一版控制台做闭环全量：asset browser、AgentLibrary 权限、contribution/Skill、资产贡献统计报表、Checkpoint Tree、audit/receipt。 |
| `DEC-P0-16` 存储权威 | Ledger、permission、receipt、loan record、checkpoint metadata 是权威；文件树和索引是 projection。 |
| `DEC-P0-17` MCP 新五类入口 | MCP outlet 硬切为 discovery/knowledge/sharedspace/codespace/skillHub，外部智能体长链路必须有主动回信。 |
| `DEC-P0-18` 2-3-5 安全模型 | 安全模型分为两条边界、三个环境、五个对象：客户端 MCP 入口、服务端 API 出口；终端智能体、平台运行时、应用服务器；身份与准入认证、权限与行为策略、数据与状态语义、流量与资源管理、审计与事实验证。 |
| `DEC-P0-19` Skill Hub 独立技能库 | `pact.skillHub.upload` 是真实技能包上传入口；技能包必须进入独立 server Skill Hub / skill library，不能混在 workspace contribution 里。 |
| `DEC-P0-20` 云盘第一批 live provider | 外部云盘第一版真实上传 / 下载固定接 iCloud + OneDrive；Google Drive / Dropbox 暂留 contract-mode，fake provider 只用于 CI 合同测试。 |
| `DEC-P0-21` 调度内核与统一操作账本 | 所有受管 operation 都必须进入 Operation Scheduling Kernel 和统一 Operation Ledger；非内核操作一律拒绝，模块本地 audit、provider ledger、queue event 和 runtime log 只能作为投影或回执。 |
| `DEC-P0-22` 统一审批流 | 高危 operation 必须由 Operation Scheduling Kernel 挂起为 `pending_operation`，统一进入独立 `/approval` 页面；批准后恢复原 operation，拒绝或过期不执行。 |
| `DEC-P0-23` 外部知识蒸馏服务门禁优先 | 外部知识蒸馏默认远程容器部署，必须先通过入站鉴权、非 root、Tika checksum、healthcheck、资源限制和密钥外置门禁；门禁未过前不得继续增加新解析或蒸馏能力。 |
| `DEC-P0-24` 智能体客户端支持目标 | 第一批一等支持目标固定为 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf；后续不再作为 P0 反复确认。 |
| `DEC-P0-25` 前端统一接口边界 | 前端页面和组件不得直接访问后端；后端路径、HTTP method、参数和返回类型必须收敛到 `server-web/lib/*-client.ts`，页面只调用对应 controller。 |
| `DEC-P0-26` 历史报告归档口径 | `docs/reports/history/` 只作为历史证据归档；不重写历史正文，过期或冲突内容通过顶部标注和核心文档回写处理。 |
| `DEC-P0-27` 安全审计发布阻塞项 | H-1 CSRF 时间安全比较和 H-2 主 Dockerfile 非 root 运行是立即修复的 P0 阻塞项；H-3 CSP 去 `unsafe-inline` 独立批次做。 |
| `DEC-P0-28` 知识蒸馏上游网关切面 | 外部知识蒸馏所有 run、evidence、artifact、download/export/compare/delete/archive 操作必须走同一上游网关切面；兼容工作台只能返回迁移报文。 |
| `DEC-P0-29` 未决事项批量 Checklist 确认 | 2026-06-03 批量决策已完成，过程文档归档到 `docs/reports/history/`；当前执行顺序、目标、改造、测试方法和用例统一进入 `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`。 |
| `DEC-P0-30` 安全硬化剩余排期 | S-01 到 S-09 均批准；S-07 和 S-09 合并；S-10 接受残余风险，维护时处理。 |

### P1 已决议

| 决策 | 结论 |
| --- | --- |
| `DEC-P1-01` Context Compiler | 权限优先压缩：只编译授权内容；短上下文拿压缩包，长上下文拿完整 evidence summary。 |
| `DEC-P1-02` receipt/loan | 细粒度记录到 section/block/field/info ref；loan record 记录保留范围、过期、撤销和跨 workspace 流转。 |
| `DEC-P1-03` connector 顺序 | 第一批信息源：本地文件、智能体上传、外部知识库。网站订阅延后。 |
| `DEC-P1-04` Skill 沙箱 | Skill 可带 manifest 和资源；执行必须通过 Tool Management grant；安装和使用都写事件。 |
| `DEC-P1-05` durable execution | 语义先行：定义 `pact.workflow.v1`，第一版自研轻量 runner 对齐 workflow/activity/retry/signal/timer/resume。 |
| `DEC-P1-06` 验收门禁 | 建立统一 production readiness 报告和门禁。 |
| `DEC-P1-07` 可观测性 | 内部 Trace 是事实源，但字段设计预留 OpenTelemetry 导出映射。 |
| `DEC-P1-08` 评估基准 | 建立最小真实样例集，覆盖 RAG、蒸馏、Agent、工具调用、权限拒绝、恢复演练。 |
| `DEC-P1-09` 贡献生态 | 贡献生态先走报表驱动，不单独做完整市场。 |
| `DEC-P1-10` 授权工作流 | 贡献资产、AgentLibrary 资产、外部知识库派生资产共用 permission request，审批人由资产类型和 workspace policy 决定。 |
| `DEC-P1-11` 安装接入产品化 | 安装、发现、配对、配置写入、doctor、回滚和远端接入升级为 P1 产品能力，覆盖 11 个一等智能体目标。 |
| `DEC-P1-12` 共享空间产品化 | 共享空间继续产品化，补齐大文件、路径级 ACL、版本恢复、冲突处理、跨智能体演示和审计 drilldown。 |
| `DEC-P1-13` Skill lifecycle | Skill Hub lifecycle 批准，拆短批次，优先签名、扫描、pin、回滚和 Tool Management catalog 原子刷新。 |
| `DEC-P1-14` 配置存储工程护栏 | 配置边界、SQLite migration、后端大模块拆分和静态边界检查进入 P1 工程治理。 |
| `DEC-P1-15` runtime 资产外移 | JRE、Tika、模型和下载缓存等 runtime 资产必须迁出源码目录，进入外部数据/cache/release artifact。 |
| `DEC-P1-16` 客户端清理和配对 | 客户端 GUI 继续 Flutter，CLI 后端继续 Rust；其它旧遗留按 keep/migrate/remove/dev-only 清单清理，并补非 GUI pairing。 |
| `DEC-P1-17` 知识蒸馏质量升级 | 知识蒸馏 P1 优先算法升级；文档解析优先支持 DOCX、XLSX、PPTX、PDF 等流行办公文档。 |
| `DEC-P1-18` 前端门禁扩展 | 前端 i18n、style、shared type、组件测试和稳定 id 边界进入 P1，门禁优先做。 |

### P2 已决议

| 决策 | 结论 |
| --- | --- |
| `DEC-P2-01` 多租户 | Workspace boundary 优先；完整 tenant/org/team 在 P2 再做。 |
| `DEC-P2-02` 密钥 | 系统内只暴露 secret ref；上下文、trace、export、checkpoint node 不出现 secret value。 |
| `DEC-P2-03` 外部检索引擎后端 | 首个真实底层检索引擎后端选 pgvector。 |
| `DEC-P2-04` 环境适配顺序 | 先做本机和容器；VM/云端复用 adapter contract。 |
| `DEC-P2-05` 会话合并 | 冲突治理走 merge proposal，不自动写 decision。 |
| `DEC-P2-06` 成本配额 | 建立按 workspace/subject/agentProfile 的 budget policy。 |
| `DEC-P2-07` SDK/CLI/OpenAPI | 正式面长期以 MCP service 为主；SDK/CLI/OpenAPI 不作为同级承诺。 |
| `DEC-P2-08` 多端客户端降级 | 手机端先不做；桌面 GUI 继续 Flutter，CLI 后端继续 Rust。 |
| `DEC-P2-09` 个人和企业预设构建线 | 个人电脑轻量预设和企业私有化预设两条线优先做；所有附加功能必须可脱水，企业中间件通过 port/adapter 替换，个人电脑不部署集群。 |
| `DEC-P2-10` 场景状态门禁 | 场景级 verifier 和 `scenario-implementation-status.json` 批准并提前到 P1 门禁批次。 |
| `DEC-P2-11` provider mode 词表 | provider mode 和 receipt 字段统一提前到 P1，固定 `contract`、`local-live`、`remote-live`、`dry-run`、`failed`。 |
| `DEC-P2-12` 模块和外部服务生态 | 模块和外部服务接入生态批准；必须提供统一治理逻辑和模块划分。 |
| `DEC-P2-13` 脚本和依赖治理 | package scripts、Node/Flutter/Rust 版本元数据和依赖 ownership 批准，优先拆分。 |

### P3 已决议

| 决策 | 结论 |
| --- | --- |
| `DEC-P3-01` 贡献者生态和市场 | 完整贡献者生态、市场和统计面板进入 P3，不降级，不回退。 |
| `DEC-P3-02` 管理驾驶舱 | 管理驾驶舱优先，第一版突出资产价值。 |
| `DEC-P3-03` A2A/模型网关 | A2A adapter 和 OpenAI-compatible model gateway 保持可选，不进入核心闭环。 |
| `DEC-P3-04` Agent Traffic Gateway | 智能体流量负载网关保持可选、可拆卸；拆除后 Pact direct mode 必须正常运行。 |
| `DEC-P3-05` 联邦工作空间 | 暂不做；等单实例 workspace governance 稳定后再评估。 |
| `DEC-P3-06` P3-C 大包搁置拆分 | connector SDK、多租户、分布式 worker、mTLS fleet、插件市场拆成单独决策，不作为一个大包启动。 |

## P0 决策

### DEC-P0-01 产品边界是否锁定为“两个问题，一个能力，三个兼容”

需要决策：

- 是否把“两个问题，一个能力，三个兼容”作为所有实现、演示、对外介绍和验收的最高口径。
- 是否明确不做完整 A2A Gateway、不做自治 Agent 平台、不做外部知识库同型复制。

默认建议：锁定。后续所有功能都必须能解释自己服务于知识权限管控、本地智能体协同、工作空间管理或三个兼容之一。

已决议：锁定。

决议后回写：`Architecture.md`、`PROTOCOLS.md`、`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P0-02 首选接入面是否确定为 Pact MCP service / Workspace API

需要决策：

- OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、脚本型 agent 是否统一通过 Pact MCP service / Workspace API 接入。
- REST / OpenAPI / CLI / SDK 是不是只作为同一协议的其它 adapter。
- 第一版 MCP 工具集是否只覆盖 workspace、asset、knowledge、contribution、checkpoint、permission、audit。

默认建议：MCP service 是智能体首选接入面，Workspace API 是协议事实源，其它 adapter 只做兼容。

已决议：MCP service 是智能体首选接入面，Workspace API 是协议事实源。

决议后回写：`PROTOCOLS.md`、`Architecture.md`。

### DEC-P0-03 身份、主体、门禁卡和 agent profile 模型

需要决策：

- `subject`、`operatorId`、`agentProfile`、`workspaceId`、`libraryCardId` 的关系。
- 人、智能体、脚本、服务账号是否共用一套 subject model。
- agent profile 是否参与权限裁决，例如同一个人使用不同智能体时权限不同。
- library card 是绑定人、agent、workspace，还是绑定一次任务会话。

默认建议：subject 是权限主体，operator 是执行入口，agentProfile 是风险和能力上下文，libraryCard 是进入 AgentLibrary 的可审计凭据。

已决议：采用 subject / operator / agentProfile / libraryCard 四层模型。

决议后回写：`PROTOCOLS.md`、`KNOWLEDGE-GOVERNANCE.md`、`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P0-04 Workspace Asset Model 的最小资产类型

需要决策：

- 第一版是否固定 `rawAssets`、`derivedAssets`、`contributedAssets`、`evidencePacks`、`artifacts`、`tasks`、`observations`、`proposals`、`decisions`、`memoryEntries`、`operationLedger`、`snapshots`。
- `knowledge`、`file`、`skill`、`tool`、`script`、`goldenRule`、`expertOpinion` 是否都作为 workspace asset 类型，而不是散落在不同模块。
- 文件树路径、数据库对象、evidence id、asset id 如何互相引用。

默认建议：先固定最小资产类型和引用关系，再做 UI 和接口；文件树只是资产的一种视图，不是全部权威状态。

已决议：固定完整最小资产集。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`PROTOCOLS.md`。

### DEC-P0-05 AgentLibrary 权限颗粒度和 accessMode

需要决策：

- 是否固定 `deny`、`discoverOnly`、`metadataOnly`、`controlledView`、`citeOnly`、`copyToContext`、`exportAllowed`、`checkoutAllowed`。
- 是否把 `read`、`cite`、`copyToContext`、`export`、`checkout`、`writeMemory`、`share` 分成不同动作。
- 表格 cell、图片、附件、section、block、field 是否都要成为可授权颗粒度。

默认建议：固定 accessMode 和动作集合，宁可第一版实现少一点，也不要继续使用一个笼统的 `canAccess`。

已决议：采用内置标准模式 + workspace 自定义扩展。内置模式用于互操作，自定义 mode/action 用于业务策略扩展。

决议后回写：`KNOWLEDGE-GOVERNANCE.md`、`PROTOCOLS.md`。

### DEC-P0-06 上游知识库再授权模型

需要决策：

- 外部知识库进入 Pact 后是否必须生成 `upstreamKnowledgeRef`、`derivedViewRef`、`derivedKnowledgeSpace`、`authorizationOverlay`。
- 下游智能体是否永远不能持有上游 token、上游对象路径、collection id 或裸 source id。
- A/B 权限演示中，B 被拒绝时是显示明确权限错误，还是按策略隐藏存在性。

默认建议：必须生成派生视图和本地权限覆盖层；B 的对话页默认显示可解释权限错误，只有高敏感资产才隐藏存在性。

已决议：强制生成派生视图和本地权限覆盖层。

决议后回写：`KNOWLEDGE-GOVERNANCE.md`、`PROTOCOLS.md`、`PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P0-07 所有出口是否强制复用同一权限裁决

需要决策：

- search、evidence read、context bundle、export、artifact write、distillation、memory write、tool call、evaluation sample 是否必须共享同一裁决结果。
- 权限拒绝是否必须进入 denied request audit。
- 未授权内容能否进入 rerank hint、hidden context、distillation input 或评估样本。

默认建议：所有出口共用同一裁决；未授权内容不能以任何形式进入算法后续链路。

已决议：所有出口强制共用同一权限裁决。

决议后回写：`PROTOCOLS.md`、`KNOWLEDGE-GOVERNANCE.md`。

### DEC-P0-08 Operation Ledger 和统一 Checkpoint Tree 的提交模型

需要决策：

- 是否把任务、队列、访问请求、文件变动、知识贡献、技能调用、权限裁决、上下文暴露和恢复动作都纳入同一棵统一 Checkpoint Tree。
- 每个进入公共空间边界的行为是否都形成 `checkpointNode`。
- `checkpointNode` 最小字段是否固定为 `checkpointNodeId`、`parentNodeIds`、`workspaceId`、`subject`、`operatorId`、`agentProfile`、`eventKind`、`effectKind`、`targetRefs`、`policyDecision`、`stateDelta`、`receiptRefs`、`auditId`、`createdAt`。
- 读请求是否也必须入树，即使它不改变文件树。
- Checkpoint Tree 是只管理文件树，还是同时管理资产、权限、evidence、贡献、技能调用、receipt、loan record、usage event、denied request audit 和审计引用。

默认建议：所有公共空间行为都进入 Operation Ledger，并物化为统一 Checkpoint Tree。读请求也入树，因为它会产生 receipt、loan record、usage event、denied request audit 或上下文暴露记录。Checkpoint Tree 是 workspace governance graph，不只是文件树历史。

已决议：所有公共空间行为全量进入统一 Checkpoint Tree。第一版读请求也全量入树，包括 list、discover、metadata、permission check、receipt list、audit query、operation history 和 checkpoint tree list；不能只进普通接口日志。同一次外部请求内部读取 Ledger、AuditStore、CheckpointTree 或 projection 时，不递归生成新的 checkpoint node。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`PROTOCOLS.md`。

### DEC-P0-09 恢复语义和 git worktree 复用边界

需要决策：

- 是否复用 git worktree 的 tree、diff、commit graph、临时 worktree preview、checkout-like restore 能力。
- 是否采用更安全的方式保护数据以替代裸 `git reset --hard` 作为产品恢复语义。
- `restoreToCheckpoint` 和 `revertOperationScope` 是否都进入第一版。

默认建议：可以复用 git 底层能力，但产品恢复必须是 append-only restore operation；第一版同时支持按 checkpoint 恢复和按 operator/task scope 回撤。

已决议：复用 git 底层能力但必须封装；采用更安全的恢复模式替代裸 reset 语义以保护数据。

决议后回写：`PROTOCOLS.md`、`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P0-10 工作空间环境兼容和管理软件边界

需要决策：

- Pact 管理软件在本机、容器、虚拟机、云端分别承担哪些职责。
- Linux、macOS、Windows 的路径、权限、文件监听、shell、进程能力如何抽象。
- 智能体是否只能通过管理软件访问受管工作空间，是否允许直连文件系统。

默认建议：受管工作空间必须经由 Pact adapter 访问；本地文件系统直连只能作为未受管区域，不进入公共 workspace state。

已决议：受管工作空间强制经过 Pact 管理软件和 adapter。

决议后回写：`Architecture.md`、`PROTOCOLS.md`、`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P0-11 终端贡献的入库、审核和发布状态机

需要决策：

- 贡献资产类型是否固定为 `knowledge`、`skill`、`tool`、`script`、`file`、`goldenRule`、`expertOpinion`。
- 状态机是否固定为 `submitted -> preview -> scanned -> reviewed -> published | rejected | needs_changes -> adopted -> deprecated | revoked`。
- 哪些贡献必须人审，哪些可以策略自动发布。

默认建议：类型和状态机先固定；第一版默认高风险 Skill、tool、script 必须人审，knowledge/file 可按 workspace policy 自动发布或进入 review。

已决议：固定贡献状态机。内容到达服务器并完成最小留档后进入 `preview`；权限、风险、许可、重复性和审核策略确认后才进入 `published`。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`PROTOCOLS.md`。

### DEC-P0-12 Skill 共享权限和贡献值 v0 算法

需要决策：

- Skill 的默认公开权限是否允许配置为 workspace 内 `read`、`install`、`use`。
- `usageCount` 是按下载、安装、执行分别计数，还是统一计一次使用。
- 第一版是否仍使用简单的 accepted/usage 求和，还是改为使用为主的质量加权公式。

默认建议：使用为主的质量加权公式；下载、安装、执行都写 usage event，但排行榜默认按确认成功使用和跨 workspace 采用计分。

已决议：改为使用为主的质量加权公式，核心为 `usageCount * successRate + uniqueWorkspaceAdoptions - rollbackCount`；提交数量不作为主导项。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`PROTOCOLS.md`。

### DEC-P0-13 资产贡献统计报表

需要决策：

- 资产贡献统计报表是否作为工作空间管理的管理者视角必备能力进入 P0。
- 第一版报表是否覆盖 workspace、贡献者、资产类型、时间窗口、使用动作、授权流、风险和维护状态。
- `assetContributionReportV0 = acceptedCount + usageCount + uniqueWorkspaceAdoptions + permissionGrantCount - rollbackCount` 是否作为第一版汇总口径。
- 报表和排行榜的关系：排行榜是否从报表派生，报表是否保留更完整的治理维度。

默认建议：资产贡献统计报表进入 P0；排行榜只是外显激励，报表才是管理者判断公共空间价值的核心入口。

已决议：资产贡献统计报表进入 P0。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`PROTOCOLS.md`、`PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P0-14 四个演示场景的第一版验收口径

需要决策：

- OpenClaw 文档互通演示：A 上传本地文档，B 从 workspace 下载。
- Skill 贡献排行榜演示：A 上传默认公开 Skill，B 下载/使用，A 贡献值增加。
- 上游知识库 A/B 权限演示：A 能获取文件，B 返回权限错误。
- Checkpoint Tree 安全恢复演示：A 删除大量文件，管理员恢复到 A 操作前节点。

默认建议：四个演示都作为 P0 实现验收，需完整覆盖所有场景后方可宣称主线闭环。

已决议：四个演示全部作为 P0 验收。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`、`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P0-15 控制台第一版必须有哪些页面

需要决策：

- 是否至少需要 workspace asset browser、AgentLibrary 权限面板、contribution/Skill 面板、资产贡献统计报表、Checkpoint Tree、audit/receipt 页面。
- 对话页面是否必须支持切换 A/B 身份来验证权限。
- Checkpoint Tree 是否必须支持 restore preview。

默认建议：第一版控制台必须覆盖权限配置、贡献发现、资产贡献统计报表、Checkpoint Tree 恢复和审计查看；否则四个演示和管理者价值无法闭环。

已决议：控制台第一版按闭环全量建设。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P0-16 数据库和文件存储的权威边界

需要决策：

- 哪些状态在 SQLite / metadata DB，哪些在对象存储，哪些在 git-like tree，哪些可重建。
- evidence、loanRecord、knowledgeAccessReceipt、operationLedger、checkpoint 是否都需要稳定 id。
- workspace restore 后如何重建索引、evidence、贡献引用和权限 overlay。

默认建议：ledger、permission、receipt、loan record、checkpoint metadata 是权威状态；向量索引和派生检索结构必须可重建。

已决议：Ledger、permission、receipt、loan record、checkpoint metadata 是权威；文件树和索引是 projection。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`KNOWLEDGE-GOVERNANCE.md`、`PROTOCOLS.md`。

## P1 决策

### DEC-P1-01 Context Compiler 和短上下文智能体支持

需要决策：

- context bundle 能包含哪些 workspace state。
- 短上下文智能体是否默认拿压缩包，长上下文智能体是否拿完整 evidence summary。
- 权限拒绝内容是否允许进入摘要。

默认建议：Context Compiler 只能编译授权内容；压缩策略不能突破 AgentLibrary 权限裁决。

已决议：权限优先压缩；短上下文拿授权压缩包，长上下文拿完整 evidence summary。

决议后回写：`PROTOCOLS.md`、`KNOWLEDGE-GOVERNANCE.md`。

### DEC-P1-02 审计、receipt、loan record 的字段和保留周期

需要决策：

- `knowledgeAccessReceipt` 记录到 section/block/field 级别还是 asset 级别。
- `loanRecord` 是否记录过期、撤销、保留范围、跨 workspace 流转。
- denied request audit 保留多久，是否对用户可见。

默认建议：P1 固定字段，P0 可以先用最小 schema；denied request audit 必须管理员可见。

已决议：细粒度记录到 section/block/field/info ref，loan record 记录保留范围、过期、撤销和跨 workspace 流转。

决议后回写：`KNOWLEDGE-GOVERNANCE.md`、`PROTOCOLS.md`。

### DEC-P1-03 信息源兼容的第一批 connector 顺序

需要决策：

- 上游知识库、网站订阅、文件夹同步、人工上传、智能体上传，第一批先做哪些。
- 外部知识库后端优先 pgvector、qdrant、opensearch，还是先做本地 adapter。
- 网站订阅是 P1 还是 P2。

默认建议：第一批只做本地文件/智能体上传/外部知识库 mock 或单一真实后端；网站订阅延后。

已决议：第一批信息源为本地文件、智能体上传、外部知识库。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`、`PROTOCOLS.md`。

### DEC-P1-04 Tool / Skill 安装和沙箱模型

需要决策：

- Skill 是纯 prompt/workflow，还是允许携带脚本、文件、依赖和工具 schema。
- 安装到本地智能体后如何记录版本、来源、授权、撤销和使用。
- 脚本执行是否进入 Tool Management v1 风险分层。

默认建议：Skill 可携带 manifest 和资源，但执行必须通过 Tool Management grant；安装和使用都写 usage event。

已决议：采用 manifest + resource + Tool Management grant。

决议后回写：`PROTOCOLS.md`、`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P1-05 长任务 durable execution 语义

需要决策：

- 是否引入 Temporal 类语义，还是先自研 lightweight workflow runner。
- workflow、activity、retry、signal、timer、resume、compensation 的最小集合。
- 文档解析、外部知识库同步、批量恢复、批量导入是否都走 workflow。

默认建议：先定义 `pact.workflow.v1` 语义，第一版自研 runner 对齐接口，后续可替换。

已决议：语义先行，第一版自研轻量 runner 对齐。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`、`PROTOCOLS.md`。

### DEC-P1-06 生产验收门禁和报告格式

需要决策：

- 是否新增统一 `server:verify:production-readiness`。
- 报告是否覆盖四个演示、权限、安全、恢复、真实文档解析、外部知识库、RAG/Agent eval。
- P0 未通过时是否阻断发版。

默认建议：必须做统一门禁；P0 不通过不能宣称生产可用。

已决议：建立统一 production readiness 报告和门禁。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P1-07 可观测性和 trace schema

需要决策：

- 是否使用 OpenTelemetry 作为 trace/metrics/logs 标准。
- upload、parse、ingest、search、evidence、context compile、tool execution、checkpoint restore 是否都要串同一个 trace。
- 模型调用和权限裁决是否写入同一 trace。

默认建议：内部 Trace 作为事实源，字段设计预留 OpenTelemetry 导出映射；权限裁决必须可追踪。

已决议：内部 Trace 是事实源，字段设计预留 OpenTelemetry 导出映射。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`、`PROTOCOLS.md`。

### DEC-P1-08 评估体系和真实样例基准

需要决策：

- 是否建立 RAG、蒸馏、Agent、工具调用、权限拒绝、恢复演练的统一评估集。
- 外部 baseline 使用哪些：Dify、LlamaIndex、Haystack、Ragas、Phoenix、Repomix、Gitingest。
- eval 失败是否阻断发版。

默认建议：P1 先建立最小真实样例集和回归评估，P2 再扩大基准。

已决议：建立最小真实样例集，覆盖 RAG、蒸馏、Agent、工具调用、权限拒绝、恢复演练。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`、`KNOWLEDGE-GOVERNANCE.md`。

### DEC-P1-09 贡献排行榜 v1

需要决策：

- 是否在 v0 基础上加入质量、失败率、回滚率、维护新鲜度、跨 workspace 采用权重。
- 是否防刷榜，例如同一主体重复下载是否只算一次。
- 是否区分贡献者声誉和单资产热度。

默认建议：v0 先闭环；v1 加去重和质量降权；声誉和资产热度分开。

已决议：贡献生态先走报表驱动，不单独做完整市场。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P1-10 权限请求和授权工作流

需要决策：

- 贡献资产、AgentLibrary 资产、外部知识库派生资产是否共用一套 permission request。
- 请求方要填写用途、有效期、目标 workspace、目标动作和风险等级。
- 谁能审批：贡献者、workspace owner、asset owner、security admin。

默认建议：共用一套授权请求框架，但审批人由资产类型和 workspace policy 决定。

已决议：统一授权请求框架。

决议后回写：`PROTOCOLS.md`、`WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P1-11 安装接入产品化

已决议：安装、发现、配对、配置写入、doctor、回滚和远端接入升级为 P1 产品能力，覆盖 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf。

最小验收：任意一等支持目标都能输出安装计划、应用配置、运行 doctor、失败回滚；远端安装能回传机器可读状态；配置写入有快照和审计记录。

决议后回写：`docs/reports/history/P1-DECISION-EXPLANATION-2026-06-03.md`、`docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`、`docs/AGENT-CLIENT-SUPPORT-TARGETS.md`、`docs/MCP_INSTALL.md`、`docs/USAGE.md`。

### DEC-P1-12 共享空间产品化

已决议：共享空间继续产品化，补齐大文件流式传输、路径级 ACL、版本恢复、冲突处理、跨智能体真实演示和审计 drilldown。

最小验收：大文件不一次性读入内存；任意路径访问能解释主体、权限、版本和操作记录；版本恢复产生新的受管 operation。

决议后回写：`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/PROTOCOLS.md`、`docs/scenarios/06-cloud-drive-sharing.md`、`docs/scenarios/07-operation-logging.md`。

### DEC-P1-13 Skill lifecycle

已决议：Skill Hub lifecycle 批准，拆成短批次，先做签名、扫描、pin、回滚和 Tool Management catalog 原子刷新。

最小验收：上传最小技能包后进入独立 Skill Hub 记录；审批/激活后 `pact.discovery` 可见；禁用或撤销后同一 grant 不可见或不可执行；catalog 刷新不能出现半状态。

决议后回写：`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/KNOWLEDGE-GOVERNANCE.md`。

### DEC-P1-14 配置存储工程护栏

已决议：配置边界、SQLite migration、后端大模块拆分和静态边界检查进入 P1 工程治理；所有密钥、外部服务配置和本地数据默认外移到 `${PACT_SERVER_DATA_DIR}`，默认 `~/.pact-server-data`。

最小验收：空用户配置保持空；migration 有明确版本和执行记录；repo hygiene / secret hygiene 阻断项目目录内密钥、fake path、跨层私有 import 和裸路径拼接回流。

决议后回写：`docs/SERVER.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P1-15 runtime 资产外移

已决议：JRE、Tika、模型和下载缓存等 runtime 资产必须迁出源码目录，进入外部数据/cache/release artifact；源码目录只保留元数据、manifest、校验规则和必要占位文件。

最小验收：源码 checkout 不包含真实 JRE、Tika jar、模型大文件或下载缓存；runtime dependency verifier 能解释来源、版本、checksum 和落地位置。

决议后回写：`docs/SERVER.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`。

### DEC-P1-16 客户端清理和配对

已决议：客户端 GUI 继续 Flutter，CLI 后端继续 Rust；其它旧遗留按 keep / migrate / remove / dev-only 清单清理，并补齐非 GUI pairing。

最小验收：每个旧模块都有清理结论；非 GUI target 能通过 CLI 发起 pairing request 并在控制台批准或撤销；旧 smoke 脚本更新到新架构或明确归档。

决议后回写：`docs/CLIENT_ARCHITECTURE.md`、`docs/AGENT-CLIENT-SUPPORT-TARGETS.md`、`client-gui/README.md`、`client-cli/Cargo.toml`。

### DEC-P1-17 知识蒸馏质量升级

已决议：知识蒸馏 P1 优先算法升级；文档解析优先支持 DOCX、XLSX、PPTX、PDF 等流行办公文档。所有新能力继续只进入 `external.knowledge.distillation` 外部服务边界。

最小验收：外部服务能对真实流行办公文档输出可下载 Markdown 或包；评估样本位于外部数据目录；算法、解析、成本、错误率和证据保真进入 operation/job/trace 记录。

决议后回写：`docs/KNOWLEDGE-GOVERNANCE.md`、`docs/DOCUMENT-EVALUATION-CORPUS.md`、`docs/PROTOCOLS.md`。

### DEC-P1-18 前端门禁扩展

已决议：前端 i18n、style、shared type、组件测试和稳定 id 边界进入 P1，门禁优先做。

最小验收：`npm run server:verify:frontend-architecture` 继续守住 API/client/controller 边界，并逐步增加 i18n/style/type/component 检查；新增公共组件有 focused test 或明确豁免理由。

决议后回写：`docs/Architecture.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`。

## P2 决策

### DEC-P2-01 多租户、组织和团队边界

需要决策：

- tenant、org、team、workspace 的层级关系。
- 跨 workspace 共享是否默认暂不开启。
- 审计是否按 tenant 独立存储和导出。

默认建议：P2 再做完整多租户；P0/P1 先让 workspace boundary 稳定。

已决议：Workspace boundary 优先。2026-05-26 起 v0.0.1 服务端增加 tenant/resource ABAC 基础层：console user、tool grant 和 policy input 可携带 `tenantId`、workspace allowlist、dataClass allowlist 和 egress allowlist；审计和 trace 支持按 tenant 查询/导出。完整 org/team 生命周期、跨租户共享审批和 SaaS 隔离仍按 P2 处理。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`、`PROTOCOLS.md`。

### DEC-P2-02 密钥、secret ref 和外部系统凭据

需要决策：

- 外部知识库、网站订阅、模型供应商、工具调用的密钥如何保存。
- secret ref 是否允许进入 context bundle、trace、export。
- 管理员如何轮换和撤销密钥。

默认建议：建议使用 secret ref，避免 secret value 直接进入任何智能体上下文、trace 或导出。

已决议：只暴露 secret ref。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`、`PROTOCOLS.md`。

### DEC-P2-03 外部检索引擎后端一致性

需要决策：

- pgvector、qdrant、opensearch 哪个作为首个真实后端（用于检索本工作空间资产）。
- 检索后端 adapter 的 conformance test 如何定义。
- 资产删除、权限变化、索引不一致时如何同步。

默认建议：先选一个真实底层检索引擎做硬基准；其它后端按同一 conformance suite 接入。

已决议：首个真实底层检索引擎后端选 pgvector。

决议后回写：`KNOWLEDGE-GOVERNANCE.md`、`PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P2-04 工作空间环境适配实现顺序

需要决策：

- 本机 macOS、Linux、Windows、容器、虚拟机、云端哪个先做。
- 文件监听、权限探测、shell/process 能力、路径映射如何抽象。
- 无法安装管理软件的远端空间是否被视为未受管空间。

默认建议：先做本机和容器；虚拟机/云端复用 adapter contract；未安装管理软件的空间不纳入受管 workspace。

已决议：先做本机和容器。

决议后回写：`Architecture.md`、`PROTOCOLS.md`。

### DEC-P2-05 会话分叉、合并和冲突治理

需要决策：

- 本地智能体留下的 trace、summary、proposal 如何分叉。
- 两个智能体同时改同一资产时怎么 merge。
- 冲突是否进入 proposal review。

默认建议：所有冲突都先形成 merge proposal，不自动写 decision。

已决议：冲突治理走 merge proposal。

决议后回写：`WORKSPACE-ASSET-GOVERNANCE.md`、`PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P2-06 性能、成本和配额

需要决策：

- 权限裁决、搜索、context compile、checkpoint diff、restore preview 的性能目标。
- 模型调用、蒸馏、embedding、外部知识库查询是否需要 budget。
- workspace、subject、agentProfile 是否有配额。

默认建议：P2 建立 budget policy；P0/P1 先保证正确性和审计。

已决议：建立按 workspace/subject/agentProfile 的 budget policy。

决议后回写：`PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P2-07 SDK、CLI 和 OpenAPI 暴露范围

需要决策：

- MCP service 之外，是否提供 CLI、TypeScript SDK、OpenAPI。
- SDK 是否允许执行高风险操作，还是只能包一层确认和 dry-run。
- 外部团队如何接入贡献、权限请求和 checkpoint restore。

默认建议：P2 提供 SDK/CLI；高风险操作默认 dry-run + confirm。

已决议：正式面长期以 MCP service 为主；SDK/CLI/OpenAPI 不作为同级承诺。

决议后回写：`PROTOCOLS.md`。

### DEC-P2-08 多端客户端降级

已决议：手机端先不做。桌面 GUI 继续 Flutter，CLI 后端继续 Rust。iOS / Android Flutter shell 只保留后续路线，不进入当前实现批次。

最小验收：P1-A/P1-F 稳定前，不新增手机端实现任务；后续如重启手机端，必须继续使用轻量 Flutter shell，不能绕过 Operation Scheduling Kernel、统一审批和操作账本。

决议后回写：`docs/reports/history/P2-DECISION-EXPLANATION-2026-06-03.md`、`docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`、`docs/FEATURE-PROFILES.md`、`docs/CLIENT_ARCHITECTURE.md`。

### DEC-P2-09 个人和企业预设构建线

已决议：优先做个人电脑轻量预设和企业私有化预设两条线。必须结合平台功能模块脱水能力，把企业和个人所需模块分开维护；所有附加功能都作为可脱水模块。企业私有化部署时，中间件必须能替换为企业内部已有服务；个人电脑上不部署集群。

最小验收：Feature Profile / composition preset 能输出个人电脑轻量预设和企业私有化预设计划；任意附加功能能说明是否可脱水、依赖哪些模块、在哪个预设启用；企业私有化中间件通过 port / adapter 替换，不污染个人电脑默认路径。

决议后回写：`docs/FEATURE-PROFILES.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`、`docs/SERVER.md`。

### DEC-P2-10 场景状态门禁

已决议：场景级 verifier 和 `scenario-implementation-status.json` 批准，提前到 P1 门禁批次。

最小验收：每个场景节点记录 status、operationIds、toolIds、verifier、evidence 和 blockers；operation 删除、重命名或 verifier 缺失时，场景门禁失败。

决议后回写：`docs/scenarios/README.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`。

### DEC-P2-11 provider mode 词表

已决议：provider mode 和 receipt 字段统一提前到 P1，先固定 `contract`、`local-live`、`remote-live`、`dry-run`、`failed`。UI、API、receipt 和文档必须区分合同验证、本机适配器成功和远端 provider 成功。

最小验收：contract-mode provider 不能显示为真实远端成功；receipt 必须声明 provider mode、verification source、remote id 或 local projection id。

决议后回写：`docs/PROTOCOLS.md`、`docs/scenarios/06-cloud-drive-sharing.md`、`docs/boundary/U-1-Data.md`。

### DEC-P2-12 模块和外部服务生态

已决议：模块和外部服务接入生态批准；提供统一治理逻辑和模块划分。模块、外部服务、Skill、Tool Package 和 mount 不能各自发明治理状态。

最小验收：新模块可用模板生成并通过 contract test；外部服务和模块使用同一治理口径描述注册、启用、禁用、授权、审计和撤销；多模态资产能从结果追溯到来源对象和解析步骤。

决议后回写：`docs/PROTOCOLS.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`、`docs/Architecture.md`。

### DEC-P2-13 脚本和依赖治理

已决议：package scripts、Node/Flutter/Rust 版本元数据和依赖 ownership 批准，优先拆分。新增验证入口不能继续无限塞进根 `package.json` 的单层脚本清单。

最小验收：新人与 CI 能根据版本元数据复现开发和验证环境；重要依赖升级有 owner、影响范围和 verifier；脚本入口按 server/client/docs/security/runtime/scenario 等责任域收敛。

决议后回写：`docs/TEST-FRAMEWORK.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`、`package.json`。

## P3 决策

### DEC-P3-01 高级排行榜和贡献生态

已决议：完整贡献者生态、市场和统计面板进入 P3，不降级，不回退。

范围：

- 贡献者主页、贡献资产列表、贡献请求、维护 SLA、订阅、评分、推荐和使用统计。
- Skill、知识包、服务和贡献资产的市场展示、授权、安装、撤销、审计和排行。
- 贡献者声誉、维护新鲜度、风险提示和滥用防护。

拒绝选项：

- 不接受把 P3-A 降级为普通统计报表。
- 不接受市场绕过 P2-E 的模块/外部服务治理、签名、撤销、审批和审计。
- 不接受把 P3-C 的分布式 worker、mTLS fleet、企业 S3/MinIO 生产部署和多租户大包混进 P3-A。

最小验收：

- 市场上展示的每个条目都有来源、版本、签名状态、授权范围、安装/撤销记录和风险提示。
- 统计和推荐基于真实 operation / usage / rollback / revoke 事件。
- 撤销后可证明 discovery、grant、Tool Management catalog 和多智能体可见性同步失效。

### DEC-P3-02 可视化和管理驾驶舱

需要决策：

- 是否做 workspace graph、permission graph、checkpoint graph、asset lineage graph。
- 是否做管理层汇报面板。
- 是否做安全事件态势面板。

默认建议：先用列表和审计表格闭环，图谱可视化放到 P3。

已决议：管理驾驶舱优先，第一版突出资产价值。

### DEC-P3-03 A2A 和模型网关增强

需要决策：

- 是否需要可选 A2A adapter。
- 是否提供 OpenAI-compatible model gateway 做 workspace-aware routing。
- 是否把 context injection、redaction、audit 放进模型网关。

默认建议：A2A 和模型网关保持可选，不进入核心闭环。

已决议：A2A adapter 和 OpenAI-compatible model gateway 保持可选。

### DEC-P3-04 Agent Traffic Gateway

需要决策：

- 是否提供真正的智能体流量负载网关。
- 网关是否可以成为 Pact 启动、发现、授权、MCP、上传或工作空间操作的硬依赖。
- 网关是否可以替代 Pact grant、workspace policy、Tool Management 或 Operation Ledger。

默认建议：提供可选 agent traffic/load gateway 作为边缘数据面，只负责 TLS/mTLS、负载均衡、限流、SSE/WebSocket 透传、上传流量保护、request id 和边缘观测。第一版直接落 Caddy 与 Nginx 两套适配，并预留异构网关 adapter registry；网关配置和可选运行时统一解析到本机 `.cache`，不进入 Pact canonical data dir。Pact direct mode 必须始终完整可用，网关拆除后不影响启动、MCP、HTTP API、client runtime bootstrap、upload session、Tool Management、workspace 操作和控制台。

已决议：Agent Traffic Gateway 保持可选、可拆卸。网关只能增强入口和负载能力，不能成为 Pact canonical state、授权、审计或 operation 执行的事实源。

### DEC-P3-05 离线同步和联邦工作空间

需要决策：

- 是否支持多个 Pact 实例之间同步 workspace asset。
- 离线工作空间如何合并和冲突治理。
- loan record 和 permission overlay 如何跨实例复制。

默认建议：先不做；等单实例 workspace governance 稳定后再评估。

已决议：暂不做联邦工作空间。

### DEC-P3-06 P3-C 大包搁置拆分

已决议：第三方 connector SDK、插件市场、多组织多租户、分布式 worker、mTLS fleet、S3/MinIO 生产部署不作为一个大 P3 包启动。该大包搁置，并拆成 connector SDK、多租户、分布式 worker、mTLS fleet、插件市场后再单独决策。

拒绝选项：

- 不接受把分布式 worker、mTLS fleet、S3/MinIO 变成默认依赖。
- 不接受把多租户和企业私有化混成一件事。
- 不接受用 P3-C 的搁置结论回退 P3-A 已批准的完整贡献者生态、市场和统计面板。

最小验收：

- 重启任一 P3-C 子方向前，必须单独说明依赖、风险、预设线、脱水方式和验收门禁。

### DEC-P0-30 安全硬化剩余排期

已决议：

- S-01 CSP 去掉 `script-src 'unsafe-inline'`：批准，单独 CSP 批次。
- S-02 iframe sandbox 策略加固：批准。
- S-03 初始 owner 凭据提示减少 stdout 暴露：批准。
- S-04 HTTP 层全局请求频率限制：批准。
- S-05 `.dockerignore` 加固：批准。
- S-06 Docker Compose 生产 TLS 口径：批准。
- S-07 `v-html` 防御深度加固：批准，和 S-09 合并。
- S-08 Vite 代理 HTTPS 证书验证：批准。
- S-09 邮件 HTML 消毒 allowlist：批准，和 S-07 合并。
- S-10 低危残余风险：批准为接受残余风险，维护时处理。

最小验收：

- S-01 单独落地，不和小修混做。
- S-07/S-09 作为同一个 HTML 渲染安全批次关闭。
- S-10 不作为当前发布阻塞；维护相关文件时收窄输出、添加说明或补审计可见性。
- 每个安全项关闭时必须补 verifier 或回归检查，并回写 `docs/SECURITY-VULNERABILITY-AUDIT.md` 和 `docs/reports/SECURITY-HARDENING-BACKLOG-2026-06-03.md`。

### DEC-P0-17 MCP 新五类入口和外部智能体回信闭环

已决议：

- MCP `tools/list` 在 v0.0.1 硬切为 `pact.discovery`、`pact.knowledge`、`pact.sharedspace`、`pact.codespace`、`pact.skillHub`，旧入口 `pact.workspace`、`pact.list`、`pact.skill`、`pact.help` 不保留 alias。
- MCP 调用全面采用 Intent Operation envelope。外部请求缺省字段可由 adapter 从 grant、目标匹配和请求上下文补齐，但进入 Operation Registry、Tool Management、Workspace API、Audit 和 Checkpoint 前必须形成完整 envelope。
- `pact.capabilities.list` 只返回当前 grant 权限范围内可见的全部 operation，不返回未授权或被 deny 的 operation。
- 本机 local grant 必须按目标匹配：无匹配时默认只读；匹配支持目标后自动授予预定义 safe-write agent toolset，并记录 `targetMatch`、`matchedTargets` 和 `agentProfileId`。
- `GET /mcp` SSE 必须承担 MCP Event Hub；operation 完成或失败后向同一 grant 主动推送 `notifications/pact/operation_reply`。
- 所有上传和写入链路必须返回目标回执，明确 `targetKind`、`targetProvider`、`targetRef` 以及 workspace、repository、branch、change、reviewUrl 或 provider durable id。

拒绝选项：

- 不接受旧 outlet alias 过渡期，因为会继续污染智能体工具心智模型并让验证脚本长期背兼容包袱。
- 不接受 `capabilities.list` 返回全量目录再让智能体自行猜权限；权限事实必须由 Pact 返回。
- 不接受上传完成后只在同步 HTTP 响应里给结果；长链路必须有主动回信，避免外部智能体轮询或误判。

### DEC-P0-18 2-3-5 安全模型

已决议：

- 两条边界：客户端 MCP 入口、服务端 API 出口。
- 三个环境：终端智能体、平台运行时、应用服务器。
- 平台运行时自我治理覆盖 Capability Kernel、Binding Guard、SecretStore、Operation Ledger、Checkpoint、Audit、runtime state、模块合同、降级模式和 recovery package。它不是第三条外部边界，而是服务于前两条边界，防止平台运行时内部绕过自身裁决、把普通 DB 提升为事实源，或在降级模式下误承诺强安全边界。

两条边界共用五个对象：

| 对象 | 终端智能体 -> 平台运行时（客户端 MCP 入口） | 平台运行时 -> 应用服务器（服务端 API 出口） |
| --- | --- | --- |
| 身份与准入认证 | client、agent、user、device、MCP grant、opaque key 绑定 | provider account、OAuth、API key、service account、secretRef、tenant 映射 |
| 权限与行为策略 | operation、tool、skill、workspace、dataClass、egress、高风险确认 | provider scope、读写删同步权限、外部副作用审批、Capability 到 provider scope 映射 |
| 数据与状态语义 | 上传、下载、context、memory、export、asset 状态、client lifecycle、路径安全 | import、export、sync、mirror、credential lifecycle、connector lifecycle、etag/version、durable id、真实持久化状态 |
| 流量与资源管理 | QPS、并发、上传速率、队列、quota、上下文大小 | provider 限流、重试、熔断、模型 token 成本、API 成本、同步频率 |
| 审计与事实验证 | receipt、loan、denied request、trace、checkpoint、recovery evidence | provider receipt、webhook 证据、external failure evidence、合规保留 |

生命周期状态归入“数据与状态语义”，不作为第五类对象。审计与事实验证只负责证明状态迁移、权限裁决、外部副作用和拒绝结果。

决议后回写：`Architecture.md`、`PRODUCTION-CAPABILITY-GAP.md`、`docs/reports/history/V0.0.1-IMPLEMENTATION-PLAN.md`。

### DEC-P0-19 Skill Hub 独立技能库

已决议：

- `pact.skillHub.upload` 固定为真实技能包上传入口。
- 技能包必须进入独立 server Skill Hub / skill library，并通过 capability package lifecycle 完成 manifest 校验、风险扫描、审批、发布、禁用、回滚和 MCP discovery 刷新。
- Workspace contribution 只能记录来源、审核、采用、排行榜、usage 和引用关系；不能保存技能包文件、版本、发布状态、启用状态或 rollback target。
- `workspace.skill.upload/list/download/usage.report` 如果继续保留，只能作为兼容 operation 路由到 Skill Hub，不能直接写 workspace contribution registry。

拒绝选项：

- 不接受把 skill package 只作为 `contributionType: "skill"` 的普通 workspace contribution。
- 不接受 capability package lifecycle 只登记 manifest、不管理真实 bundle 文件和 active discovery。

最小验收：

- MCP 上传最小技能包后，`<userDataPath>/knowledge-skills/` 或等价 Skill Hub store 出现独立记录。
- 若产生 workspace contribution，该 contribution 必须只引用 skill library record。
- 发布、禁用、回滚后，`pact.skillHub` 可见目录和 audit / trace 同步更新。

### DEC-P0-20 云盘第一批 live provider

已决议：

- 场景 06 外部云盘第一版真实上传 / 下载固定接 iCloud + OneDrive。
- iCloud 继续作为受控本机 iCloud Drive 路径 / projection：默认空间可写、公共空间只读、高级暴露目录默认只读，公开响应不得暴露本机绝对路径。
- OneDrive 必须通过真实 OAuth / live adapter 完成远端上传、下载、列目录、权限摘要和 provider receipt；密钥只通过 `secretRef` / `endpointRef` 存在 `ServerConfig.getDataDir()` 下。
- Google Drive / Dropbox 暂时保留 contract-mode 和后续 provider 插槽，不计入本轮 P0 live 完成。
- fake provider server 只能作为 CI / contract harness，不能替代真实 provider 验收。

拒绝选项：

- 不接受继续用 OneDrive contract-mode 冒充真实云盘已接通。
- 不接受把 fake provider server 的 green test 标成产品真实上传 / 下载。
- 不接受一次铺开 OneDrive、Google Drive、Dropbox 三家而没有第一批 live smoke 和 receipt 事实源。

最小验收：

- 同一最小样例文件可以分别上传到 iCloud 和 OneDrive，再凭 receipt 下载并校验 byte count 与 hash。
- OneDrive receipt 必须包含 provider、connectionId、scope snapshot、driveId、itemId/fileId、revision 或 eTag/cTag、provider request id、audit id、checkpoint id 和 `remoteLiveVerified` / `realE2EVerified` 状态。
- provider manifest 和 transfer receipt 不得包含 raw token、refresh token、client secret 或私有下载 URL。

### DEC-P0-21 调度内核与统一操作账本

已决议：

- 所有受管 operation 都必须进入统一 Operation Scheduling Kernel，再由内核写统一 Operation Ledger / audit facade。
- 只有调度内核受理、分配 `operationId`、写入 `started` / `pending` 账本、完成策略裁决并返回执行许可的 operation，才是 Pact 的真实操作。
- 范围覆盖 API、RPC、MCP、CLI、控制台、后台任务、workflow activity、队列状态变更、provider adapter、webhook、工具执行、模型调用、文件上传下载、知识检索和读取、解析、蒸馏、代码提交、云盘同步、配置变更、密钥引用变更、权限裁决和拒绝。
- Operation Registry 是目录和合同来源，不是执行许可。HTTP / RPC / CLI / MCP / 控制台 / worker 只能提交 intent envelope 给调度内核，不能直接调用业务 executor。
- Operation Ledger 是事实源；console log、tool audit、provider ledger、queue event、runtime log、trace span、readiness report 只能作为投影、回执、索引或报告。
- 写操作和外部副作用必须先追加 `started` / `pending` ledger entry，再执行副作用；如果账本不可写，操作必须失败在副作用之前。
- 读请求也必须入账。高频读可以在任务会话内做聚合，但聚合结果仍必须可按 `operationId`、`traceId`、`subject`、`targetRef`、`reasonCode` 查询。
- 同一次外部请求内的内部 helper、projection 读取和存储索引读取不递归创建新 operation，但必须继承父 `operationId` / `traceId`，重要子步骤作为 span、receipt 或 child event 关联回统一账本。

拒绝选项：

- 不接受后台 worker、provider helper 或 domain helper 直接写状态，只事后补普通日志。
- 不接受模块各自维护不可关联的 audit / ledger / queue event 并把它们当事实源。
- 不接受 Operation Registry、HTTP handler、RPC method、CLI command、MCP tool、控制台 handler、worker 或 provider adapter 自行决定“这是一个真实操作”。
- 不接受未带调度内核准入印记的业务函数、provider side effect、状态写入或工具执行继续运行；这类路径必须拒绝为 `operation_unmanaged` / `operation_not_scheduled`。
- 不接受账本写失败时继续执行外部副作用或持久状态变更。

最小验收：

- 任一 MCP tool call、控制台操作、CLI operation、后台 worker activity、provider upload/download、权限拒绝和失败重试，都能先从 Operation Scheduling Kernel 查到 accepted/rejected decision，再从同一 Operation Ledger 按 `operationId` / `traceId` 查到 started、policy、effect、receipt、checkpoint、status 和 failure。
- 静态门禁阻止新代码绕过调度内核直接调用 executor、直接落状态、直接写模块私有 audit 作为唯一事实源，或在外部副作用之后才补 ledger。
- 账本不可写时，写操作、外部 IO 和 durable workflow activity 必须失败或暂停为 blocked，不得静默继续。

### DEC-P0-22 统一审批流

已决议：

- 高危 operation 必须由 Operation Scheduling Kernel 挂起为 `pending_operation`，统一进入独立 `/approval` 页面审批。
- 审批范围覆盖 API、RPC、CLI、MCP、控制台、worker 和 provider side effect，不只覆盖 MCP gateway。
- `/approval` 统一承载 MCP 授权请求、高危 operation pending execution、代码提交审批、云盘外发审批、配置 / 密钥引用变更审批、恢复 / 删除 / reindex / runtime mount 等高危维护审批。
- `pending_operation` 必须保存原始 intent envelope、operationId、traceId、idempotencyKey、subject、operator、agentProfile、workspace、grant / token 摘要、requestedScopes、risk reason、policy decision、approvalScope、expiresAt、payload hash、redacted input summary 和 resume pointer。
- 审批通过后只能恢复原 operation，沿用原 `operationId` / `traceId`，追加 approval decision、receipt 和 checkpoint，再由调度内核继续执行。
- 审批拒绝、过期、撤销或上层 hard deny 时，原 operation 终止，不允许产生业务副作用。
- 审批只能满足人工确认 / 授权门槛，不能覆盖租户、workspace、dataClass、egress、provider scope、Capability Kernel 或 Binding Guard 的硬拒绝。

拒绝选项：

- 不接受 `requiresConfirmation=true` 或 `confirm=true` 直接等同于审批完成。
- 不接受不同模块各建一套审批队列，导致控制台、MCP、Tool Management 和 worker 审批状态不一致。
- 不接受审批通过后创建一个新 operation 绕过原 operation 的 trace、policy、idempotency 和恢复链。
- 不接受业务 provider 已执行后再补审批记录。

最小验收：

- 高危 MCP tool、控制台 repair 操作、CLI 写操作和 worker 外部副作用都会被调度内核挂起为 `pending_operation`，并出现在 `/approval`。
- 批准后原 operation 恢复执行，智能体或调用方收到沿用原 trace 的 `operation_reply`。
- 拒绝、过期或撤销后，原 operation 状态为 denied/expired/revoked，业务副作用不发生。
- 审批记录、原 operation、ledger、checkpoint、receipt 和 audit 可以互相追溯。

### DEC-P0-23 外部知识蒸馏服务门禁优先

已决议：

- `external.knowledge.distillation` 默认按远程容器服务部署，通过网络由 Pact 上游网关或受控 adapter 调用。
- 容器态必须默认要求 `PACT_EXTERNAL_KD_API_TOKEN`；API token、模型 key、OAuth token 和其它配置密钥只能来自外部数据目录、运行配置或 secret store，不能进入项目目录。
- 服务入口必须集中鉴权。`/health` 和 `/v1/runtime/health` 可以公开给编排器，其它业务 API 必须通过 bearer gate。
- Docker 镜像必须固定 Tika 下载 checksum，运行非 root 用户，声明 healthcheck，并让 `/data` 由服务用户持有。
- 解析、OCR、Tika、PDF、压缩包、目录、邮件和模型网关调用必须有超时、大小、深度、数量和队列边界；默认远程容器不能依赖项目内 `.pact-server-data`。
- `external-services/knowledge-distillation-service/server.mjs` 后续必须拆分，但门禁优先；拆分前只允许安全、运维、门禁和缺陷修复，不继续堆新格式解析或模型蒸馏能力。

拒绝选项：

- 不接受外部知识蒸馏容器默认裸 API。
- 不接受把 token 或 key 写入仓库任何目录，包括 `docs/`、`external-services/`、`.pact-server-data/` 或测试 fixtures。
- 不接受 checksum、healthcheck、非 root、入口鉴权缺失时继续推进新解析器、新导出或新模型能力。

最小验收：

- `npm run server:verify:external-knowledge-distillation-service-gates` 必须通过，并在默认 `server:verify` 的外部服务段先于知识蒸馏功能回归执行。
- 无 token 启动的 required-auth 服务必须失败；无 token 或错 token 访问业务 API 必须返回 `EXTERNAL_KD_AUTH_REQUIRED`；正确 bearer 才能访问业务 API。
- Dockerfile 必须可被静态 verifier 证明：有 checksum 校验、非 root 用户、healthcheck、required-auth 默认值，且没有内置 API token。

### DEC-P0-24 智能体客户端支持目标

已决议：

- 第一批一等支持目标固定为 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf。
- 该目标集适用于桌面客户端 target adapters、`pact-mcp-connector`、server MCP discovery metadata、local grant target match、安装 / 卸载 / doctor、文档和 verifier。
- 支持目标不是待确认 P0。新增目标只能通过明确实现决策进入，并同步更新 `server:verify:agent-client-support-targets`。

拒绝选项：

- 不接受只覆盖 Codex、OpenClaw、Claude Code、Cursor 或任意子集后宣称完成第一批客户端支持；Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Hermes Agent 和 Windsurf 也必须按一等目标进入同一批。
- 不接受文档写全量目标、代码安装器或 grant matcher 只支持部分目标。
- 不接受把 OpenCode、Hermes Agent 或 Windsurf 留在“以后再确认”的模糊状态。

最小验收：

- `client-cli` scan / plan、`client-gui` 手动目标、`pact-mcp-connector` supported targets、server MCP discovery、local grant target match、release verifier 和安装文档都包含同一份 11 项清单。
- `npm run server:verify:agent-client-support-targets`、`npm run client:verify:architecture`、`npm run client:verify:plan` 和 `npm run client:verify:targets` 通过。

### DEC-P0-25 前端统一接口边界

已决议：

- 前端后端访问必须收敛到统一接口层。`server-web/lib/*-client.ts` 负责后端路径、HTTP method、请求参数、返回类型和下载 / SSE / JSON 等底层差异。
- 页面和组件只负责展示、输入和用户动作；不得直接 `fetch()`、直接调用全局 `bridge.*`、自行拼 `/api/...` URL 或绕过对应 controller。
- 页面状态、loading/error、刷新、确认和业务动作必须放在对应 view/domain controller 中；组件只消费 controller 暴露的字段和方法。
- `useConsole()` 继续瘦身，只保留全局 shell、登录态、导航和公共刷新；具体业务能力迁回各自 controller。
- `bridge.*` 只作为兼容 facade 或明确 allowlist 边界存在，不能作为新页面的通用后端入口。

拒绝选项：

- 不接受新 view/component 直接请求后端或硬编码 `/api` 路径。
- 不接受为了快速开发把业务状态、副作用和后端调用继续塞回 `useConsole()`。
- 不接受 CSS、类型和 controller 重新变成跨领域大单体。

最小验收：

- `npm run server:verify:frontend-architecture` 必须阻断 view/component 直接 import 全局 bridge、直接 `bridge.*`、直接 `fetch()` 和硬编码 `/api` URL。
- `server-web/lib/*-client.ts` 是后端路径事实位置；view/domain controller 调用 client，页面组件调用 controller。
- 现有明确例外必须进入 allowlist，并且 allowlist 条目失效时 verifier 必须失败。

### DEC-P0-26 历史报告归档口径

已决议：

- `docs/reports/history/` 只作为历史审计、阶段计划、临时进度、生产 readiness run 输出和旧任务总结归档。
- 历史正文不重写，避免破坏当时证据；旧结论过期或冲突时，只在目录说明和关键文档顶部追加归档标注。
- 当前架构、协议、权限、客户端支持目标、生产状态和 verifier 口径，必须以核心文档、决策登记和当前脚本为准。
- 新安全审计、当前缺陷和新 P0 不塞回 history；应进入 `docs/reports/` 下的当前报告或综合决策队列。

拒绝选项：

- 不接受继续把 history 报告当成当前实现事实源。
- 不接受为“修正历史”大规模改写旧报告正文，导致审计链路不可追溯。
- 不接受从旧报告复制旧 MCP 工具名、旧 Workspace API 路径、旧客户端目标或旧完成度结论到新实现。

最小验收：

- `docs/reports/history/README.md` 明确说明 history 目录只作归档。
- 关键旧报告顶部有归档标注，并指向核心事实源。
- 综合决策队列记录 P0-12 已确认，后续新增缺陷另起当前报告或新 P0 条目。

### DEC-P0-27 安全审计发布阻塞项

已决议：

- `docs/SECURITY-VULNERABILITY-AUDIT.md` 的 H-1 CSRF token 时间安全比较和 H-2 主 Dockerfile 非 root 运行列为立即修复的 P0 发布阻塞项。
- H-1 必须在控制台认证边界使用 `crypto.timingSafeEqual` 支撑的时间安全比较，不能用 `csrf !== session.csrfToken`。
- H-2 要求主 `Dockerfile` runtime stage 创建专用 `pact` 用户和组，运行时切到 `USER pact`，并确保 `/data` 与 `/codex-home` 由该用户持有。
- H-3 / S-01 CSP 去掉 `unsafe-inline` 已批准，等 Vite 构建 nonce/hash 方案一起做，不能为了快速通过而破坏控制台构建。
- S-02 到 S-09 已批准待实现；S-07 和 S-09 合并为 HTML 渲染安全批次。
- S-10 已批准为接受残余风险，维护相关文件时处理。

拒绝选项：

- 不接受 CSRF 校验继续使用普通字符串比较。
- 不接受主运行容器默认 root 执行。
- 不接受把 CSP 大改和小修混在一个补丁里导致控制台构建风险扩大。

最小验收：

- `npm run server:verify:security-hardening` 必须静态阻断 CSRF 直接字符串比较，并检查主 Dockerfile runtime stage 为非 root。
- `npm run server:verify:console-auth` 必须继续通过，证明正常登录、CSRF 缺失拒绝和合法 CSRF 写操作未被破坏。
- 安全审计报告和综合决策队列必须标出 H-1/H-2 已处理，S-01 到 S-09 已批准待实现，S-10 接受残余风险。

### DEC-P0-28 知识蒸馏上游网关切面

已决议：

- 知识蒸馏不建立专属权限体系；它是 `external.knowledge.distillation` 外部服务能力，权限与其它外部服务一样由上游网关切面统一管理。
- `external.knowledge.distillation.runs.list/get/create/cancel`、`evidence.query`、`projects.evidence.query`、`artifacts.export` 必须全部带 `external-upstream-gateway` 切面、required scopes、受控 `/api/external/knowledge/distillation/*` 路径和 Tool Management 映射。
- 产物下载 URL、package export、stage export、compare、delete/archive 不能绕过同一权限切面；下载和导出只能通过受控 operation 返回，不能暴露绕开授权的裸 URL。
- 兼容工作台操作 `knowledge.distillation.workbench.*` 只能作为 deprecated migration shim 保留；进入兼容壳前仍要经过 console authorization，且不对智能体或 Tool Management 暴露。

拒绝选项：

- 不接受知识蒸馏 run、evidence、artifact 或下载导出路径绕过外部服务上游网关。
- 不接受用可直接访问的产物 URL、临时文件路径或静态下载路径绕过 operation authorization。
- 不接受继续维护内部 `knowledge.distillation.workbench.*` 作为真实算法面。

最小验收：

- `npm run server:verify:knowledge-distillation-workbench` 必须证明外部操作和兼容工作台操作都受控，兼容壳只返回迁移报文。
- `npm run server:verify:external-service-api-registration` 必须证明 `external.knowledge.distillation.*` 带 `external-upstream-gateway` 切面，并位于受控外部服务 API 下。
- Tool Management 只能暴露 `external.knowledge.distillation.*` 真实外部服务入口，不能暴露内部 workbench 兼容操作。

### DEC-P0-29 未决事项批量 Checklist 确认

已决议：

- 后续不再一个问题一个问题地追问维护者。
- 2026-06-03 的批量 checklist 已完成，并归档到 `docs/reports/history/OPEN-DECISION-CHECKLIST-2026-06-03.md`。
- 维护者已按编号批量回复 P1/P2/P3/S 系列决策；这些决策不再作为开放问题反复询问。
- 当前执行顺序、目标、涉及的功能改造、测试方法和用例统一维护在 `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`。

拒绝选项：

- 不接受在没有新事实的情况下反复确认已经拍板的 P0。
- 不接受把后续 P1/P2/P3 方向拆成多轮零散追问，增加沟通成本。
- 不接受只在对话里保存决策，必须有文档化入口。

最小验收：

- `docs/reports/history/OPEN-DECISION-CHECKLIST-2026-06-03.md` 必须保留为历史过程记录。
- `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md` 必须存在，并按任务先后顺序列出目标、功能改造、测试方法和用例。
- 后续新增未决事项不得写回历史 checklist，应新开当前决策入口，并同步更新核心文档和任务排序文档。

## 原建议决策顺序

以下顺序已经完成，用于保留决策过程；新增决策应继续按 P0 到 P3 登记。

第一轮已拍板：

1. `DEC-P0-01` 产品边界。
2. `DEC-P0-02` MCP service / Workspace API 接入面。
3. `DEC-P0-03` 身份和 library card 模型。
4. `DEC-P0-04` Workspace Asset Model。
5. `DEC-P0-05` AgentLibrary 权限颗粒度。
6. `DEC-P0-08` Operation Ledger 和统一 Checkpoint Tree。
7. `DEC-P0-13` 资产贡献统计报表。
8. `DEC-P0-14` 四个演示场景验收口径。

第二轮已拍板：

1. `DEC-P0-06` 上游知识库再授权。
2. `DEC-P0-07` 所有出口共用权限裁决。
3. `DEC-P0-09` git worktree 复用边界。
4. `DEC-P0-10` 工作空间环境兼容。
5. `DEC-P0-11` 终端贡献状态机。
6. `DEC-P0-12` Skill 共享和贡献值算法。
7. `DEC-P0-15` 控制台第一版页面。
8. `DEC-P0-16` 数据库和文件存储权威边界。

第三轮 P1 已拍板：

1. Context Compiler。
2. receipt / loan record 细节。
3. connector 顺序。
4. Tool / Skill 沙箱。
5. durable workflow。
6. production readiness gate。
7. observability 和 eval。

## 决策完成标准

每个决策完成时必须同时满足：

- 有明确选项和最终选择。
- 有拒绝其它选项的理由。
- 有协议字段、数据模型或 UI 行为变化。
- 有最小验收场景。
- 有要更新的核心设计文档。
- 如果影响安全、权限、恢复或智能体接入，必须补验证脚本或测试计划。
