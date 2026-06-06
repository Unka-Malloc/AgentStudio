# Pact Architecture / Software Design Specification

审计日期：2026-05-21。本文是 Pact 的总架构基线和软件设计说明书。

## 目录 / Table of Contents

- [设计文档边界](#设计文档边界)
- [软件设计说明书](#软件设计说明书)
  - [文档目标](#文档目标)
  - [设计范围](#设计范围)
  - [用户和执行者](#用户和执行者)
  - [功能需求](#功能需求)
  - [非功能需求](#非功能需求)
  - [运行上下文](#运行上下文)
  - [模块设计](#模块设计)
  - [核心数据模型](#核心数据模型)
  - [接口设计](#接口设计)
  - [关键流程设计](#关键流程设计)
  - [存储设计](#存储设计)
  - [权限与安全设计](#权限与安全设计)
  - [可观测性设计](#可观测性设计)
  - [错误处理和幂等设计](#错误处理和幂等设计)
  - [部署和配置设计](#部署和配置设计)
  - [验收设计](#验收设计)
- [核心原则](#核心原则)
  - [资产是主体](#资产是主体)
  - [不信任智能体](#不信任智能体)
  - [权限从源头治理](#权限从源头治理)
  - [公共工作空间优先](#公共工作空间优先)
  - [终端贡献是第二信息源](#终端贡献是第二信息源)
  - [OpenClaw 演示闭环](#openclaw-演示闭环)
  - [协议适配不是核心抽象](#协议适配不是核心抽象)
  - [可拆卸 Agent Traffic Gateway](#可拆卸-agent-traffic-gateway)
- [逻辑架构](#逻辑架构)
- [代码分层](#代码分层)
- [公共状态模型](#公共状态模型)
- [写入路径](#写入路径)
- [客户端运行时与上传传输设计](#客户端运行时与上传传输设计)
- [代码贡献双路线：Workspace 与 Gerrit](#代码贡献双路线workspace-与-gerrit)
- [知识位置](#知识位置)
- [智能体接入边界](#智能体接入边界)
- [上游和后端定位](#上游和后端定位)
- [验证入口](#验证入口)
- [架构演进与长期提升规划 (Architecture Evolution)](#架构演进与长期提升规划-architecture-evolution)
  - [1. 架构可扩展性：控制面与数据面的深度解耦 (Control/Data Plane Separation)](#1-架构可扩展性控制面与数据面的深度解耦-controldata-plane-separation)
  - [2. 智能体协同范式：从"主动轮询"到"事件订阅" (Reactive Collaboration)](#2-智能体协同范式从主动轮询到事件订阅-reactive-collaboration)
  - [3. 审计存储优化：读请求的"逻辑入树"与时序聚合 (Read Node Aggregation)](#3-审计存储优化读请求的逻辑入树与时序聚合-read-node-aggregation)
  - [4. 冲突治理升级：引入"语义合并" (Semantic Merging)](#4-冲突治理升级引入语义合并-semantic-merging)
  - [5. 权限模型演进：动态上下文权限控制 (Context-Aware Dynamic Policies)](#5-权限模型演进动态上下文权限控制-context-aware-dynamic-policies)
- [核心工程原则与开发守则 (Core Engineering Principles)](#核心工程原则与开发守则-core-engineering-principles)
  - [1. 接口与契约先行，把实现藏起来 (Interface First)](#1-接口与契约先行把实现藏起来-interface-first)
  - [2. 构建状态存储的"防腐层" (Anti-Corruption Layer)](#2-构建状态存储的防腐层-anti-corruption-layer)
  - [3. 事件驱动的本地化 (Local Pub/Sub)](#3-事件驱动的本地化-local-pubsub)
  - [4. 容忍"半自动"，保留"降级口" (Graceful Degradation)](#4-容忍半自动保留降级口-graceful-degradation)

Pact 的核心定位是：

> 面向多人、多终端、多本地智能体的 Team Workspace Asset Governance System。

核心卖点是专攻中间狭窄地带：

> 上游知识库太粗，Pact 做权限精加工；下游本地智能体太细，Pact 做共享工作空间。

产品框架可以压缩为一句话：

> 两个问题，一个能力，三个兼容。

两个问题：

1. 知识库缺少面向智能体的权限管控。传统知识库通常解决“存了什么、怎么检索”，但没有在 source / asset / evidence / export / context / memory 这些出口上治理“哪个智能体能看、能引用、能带走、能写回”。
2. 本地智能体相对独立，难以协同。OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、脚本和人工终端都可以很强，但它们各自拥有本地上下文和本地文件，缺少一个统一、可编辑、可审计、可恢复的公共工作空间。

一个能力：

- 工作空间管理。Pact 管理公共工作空间的资产、权限、快照、Checkpoint Tree、Operation Ledger、审计和恢复。核心不是让智能体互相聊天，而是让所有智能体通过同一个受控工作空间读写资产，并且任何修改都可追踪、可回溯、可撤销。
- 资产贡献统计报表是工作空间管理的管理者视角输出。公共空间的价值必须能被管理者看见：谁贡献了资产、贡献了什么、被谁使用、复用了多少次、带来了多少跨 workspace 采用、产生过哪些授权请求、失败、回滚和维护动作。

三个兼容层：

1. 智能体客户端 MCP 插件兼容层（`agent-client-mcp-compatibility`）：不关心底层是哪个大模型、哪个 agent framework、哪个机器人体系；只要通过 Pact MCP service、MCP connector、local bridge、可选 agent traffic gateway 或 Workspace API 接入，就按同一套权限、审计和工作空间协议操作。
2. 外部服务交互兼容层（`external-service-compatibility`）：不关心外部系统是 Docker、GitHub、Gerrit、Mailbox、外部知识库、模型 provider、向量库、图数据库、云盘还是业务系统；进入 Pact 后必须被转换为受控 operation、workspace asset、evidence、codeChange 或 mirror projection。
3. Pact 内部兼容层（`pact-internal-compatibility`）：不把 Pact 应用内部的模块、mount、资源语义、运行时、状态边界和能力包生命周期散落成多套兼容概念；统一归入内部兼容层，由明确子类承载内部演进。

`external.knowledge.distillation` 属于外部服务交互兼容层，默认远程容器部署。它在进入新解析、导出或模型蒸馏能力演进前必须先通过 `pact.external-knowledge-distillation.service-gates.v1`：入站 bearer gate、非 root 容器、Tika checksum、healthcheck、资源限制和密钥外置都是 P0。

Pact 调用 `external.knowledge.distillation` 的所有业务操作都必须走外部服务上游网关切面：run 列表 / 详情 / 创建 / 取消、evidence 查询、project evidence 查询、artifact export、产物下载、package export、stage export、compare、delete 和 archive 都必须经同一 operation authorization、Tool Management grant、egress policy、audit receipt 和 denied decision。`knowledge.distillation.workbench.*` 只允许作为迁移兼容壳返回替代入口说明，不得继续承载真实算法或绕过网关下载产物。

“两个问题，一个能力，三个兼容”的产品表达只保留为问题定义，不再作为架构分层口径；架构分层统一使用 `agent-client-mcp-compatibility`、`external-service-compatibility` 和 `pact-internal-compatibility` 三个边界。

安全模型按两条边界、三个环境、五个对象表达：

- 两条边界：客户端 MCP 入口、服务端 API 出口。
- 三个环境：终端智能体、平台运行时、应用服务器。
- 平台运行时自我治理约束 Capability Kernel、Binding Guard、SecretStore、Operation Ledger、Checkpoint、Audit、runtime state、模块合同和降级模式。它不是第三条外部边界，而是平台运行时内部为防止自我绕过、状态篡改和语义漂移而建立的治理能力。

两条边界共用同一组对象，差异只在每个对象下面的治理项：

| 对象 | 终端智能体 -> 平台运行时（客户端 MCP 入口） | 平台运行时 -> 应用服务器（服务端 API 出口） |
| --- | --- | --- |
| 身份与准入认证 | client、agent、user、device、MCP grant、opaque key 绑定 | provider account、OAuth、API key、service account、secretRef、tenant 映射 |
| 权限与行为策略 | operation、tool、skill、workspace、dataClass、egress、高风险确认 | provider scope、读写删同步权限、外部副作用审批、Capability 到 provider scope 映射 |
| 数据与状态语义 | 上传、下载、context、memory、export、asset 状态、client lifecycle、路径安全 | import、export、sync、mirror、credential lifecycle、connector lifecycle、etag/version、durable id、真实持久化状态 |
| 流量与资源管理 | QPS、并发、上传速率、队列、quota、上下文大小 | provider 限流、重试、熔断、模型 token 成本、API 成本、同步频率 |
| 审计与事实验证 | receipt、loan、denied request、trace、checkpoint、recovery evidence | provider receipt、webhook 证据、external failure evidence、合规保留 |

生命周期不是独立审计分类，属于数据与状态语义。安装、授权、升级、禁用、撤销、过期、解绑、清理、恢复和迁移必须表达为可查询状态迁移；审计与事实验证负责证明这些迁移。

这不是横向再造知识库，也不是横向再造智能体平台。Pact 只猛攻两端之间最缺的中间层：

- 对上游和外部服务：用 `external-service-compatibility` 接入外部知识库、文件库、邮箱、代码评审系统、向量库、图谱库和业务资产源，把粗粒度资源重新切分、重新标注、重新授权、重新登记。
- 对下游智能体客户端：用 `agent-client-mcp-compatibility` 接入各类本地智能体、脚本和人工终端，让它们在公共工作空间里共享一部分资产、Skills、工具、脚本、专家意见和任务状态。
- 对 Pact 内部系统：用 `pact-internal-compatibility` 统一模块合同、资源语义、能力包生命周期、运行时环境和状态边界，再由 AgentLibrary、Workspace Asset Governance、Operation Ledger、Contribution Registry 和 Context Compiler 把“可看、可借、可贡献、可复用、可撤销”做成同一套治理机制。

Pact 不做另一个智能体平台，不做完整 A2A Gateway，也不把自己包装成自治 Agent。系统只治理公共工作空间里的资产、知识、任务、产物、决策和审计状态。本地智能体可以接入、读取、提交和请求操作，但永远不能绕过工作空间协议直接改写 canonical state。

## 设计文档边界

核心设计文档只保留五份：

- `docs/Architecture.md`：总定位、系统分层、运行时边界。
- `docs/PROTOCOLS.md`：Workspace API、Operation、Tool Management、Knowledge、协议适配边界。
- `docs/WORKSPACE-ASSET-GOVERNANCE.md`：公共工作空间资产治理、快照、溯源、恢复、复制和安全原则。
- `docs/KNOWLEDGE-GOVERNANCE.md`：知识证据、三层知识模型、智能体可引用上下文和知识维护闭环。
- `docs/PRODUCTION-CAPABILITY-GAP.md`：生产能力差距、验收门禁和当前阻塞项。

其它文档只能作为运行说明、配置说明或测试说明存在，不能再承载新的长期架构决策。

## 软件设计说明书

### 文档目标

本文面向产品设计、工程实现、控制台开发、MCP adapter 开发、运行维护和后续验收。它回答六个问题：

1. Pact 要解决什么问题。
2. 系统边界在哪里，哪些能力明确不做。
3. 核心模块如何分层，模块之间如何协作。
4. 公共工作空间、AgentLibrary、权限、贡献、审计和 Checkpoint Tree 的权威数据如何建模。
5. 智能体、控制台、CLI、外部知识库和本机管理软件通过什么接口进入系统。
6. 第一阶段到生产级演进分别用什么验收标准证明闭环。

本文不是实现任务清单。具体待拍板事项仍在 `docs/IMPLEMENTATION-DECISION-REGISTER.md` 中追踪；拍板后的长期结论必须回写本文、`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/KNOWLEDGE-GOVERNANCE.md` 和 `docs/PRODUCTION-CAPABILITY-GAP.md`。

### 设计范围

第一版设计范围：

- 面向本机、容器、虚拟机和云端工作空间的统一资产治理。
- 面向 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、脚本和人工终端的 MCP / Workspace API 接入。
- 面向外部知识库、本地文件、智能体上传、人工整理和网站订阅的统一信息源收纳。
- 面向知识、文件、Skills、工具、脚本、黄金规则、专家意见和任务产物的 workspace asset model。
- 面向源代码、补丁、仓库变更和代码文件上传的 Gerrit code review route，并与 Workspace route 并行存在。
- 面向读、写、下载、导出、上下文注入、借阅、安装、执行和恢复的权限裁决。
- 面向访问请求、文件变动、知识贡献、技能调用、权限裁决、上下文暴露和恢复动作的统一 Checkpoint Tree。
- 面向管理者的资产贡献统计报表和贡献排行榜。

第一版非目标：

- 不做完整 A2A Gateway。
- 不做自治 Agent 平台。
- 不把 Pact 暴露成一个需要其它 Agent 调度的 Agent。
- 不做外部知识库同型复制或裸代理。
- 不把 git 仓库本身暴露为产品恢复接口。
- 不把 Gerrit 替换为公共 workspace，也不把 workspace 文件树替换为 Gerrit 仓库。
- 不把代码变更作为普通文件上传的默认路径；需要提交、评审或合并的代码必须优先进入 Gerrit route。
- 不承诺所有 SDK、CLI、OpenAPI 与 MCP 同级长期稳定；长期事实源是 Workspace API，智能体首选接入面是 MCP service。

### 用户和执行者

系统中的用户和执行者统一进入 `subject / operator / agentProfile / libraryCard` 四层模型：

| 名称 | 含义 | 典型来源 |
| --- | --- | --- |
| `subject` | 权限主体，可以是人、服务账号、团队身份或受控智能体身份。 | 管控台登录、MCP header、stdio proxy 参数、服务账号 token |
| `operatorId` | 实际执行入口，描述谁在操作系统或协议层发起请求。 | `orbstack:kate:openclaw`、`orbstack:serena:hermes-agent`、CLI、console |
| `agentProfile` | 风险、能力和上下文 profile，用于区分同一 subject 使用不同智能体时的权限。 | OpenClaw、本地编码 agent、通用任务 agent、脚本 runner |
| `libraryCard` | 进入 AgentLibrary 的可审计访问凭据。 | workspace 门禁卡、任务会话凭据、短期只读凭据 |

设计要求：

- 权限主体和执行入口必须分开。同一个人用高风险 agent 和低风险 agent 时，可以得到不同权限。
- 智能体不能因为拥有本地文件能力而绕过 Workspace API。
- 读请求也要带身份上下文，因为读请求会产生 receipt、loan record、usage event、上下文暴露记录和拒绝审计。

### 功能需求

#### FR-1 Workspace Asset Governance

系统必须提供受管公共工作空间。所有公共资产必须具备：

- 资产 ID、类型、来源、所属 workspace、版本和状态。
- 权限策略、敏感度、数据分类和保留策略。
- 快照引用、Operation Ledger 引用和审计引用。
- 可发现、可读取、可引用、可下载、可导出、可复制、可撤销和可恢复的状态。

文件树只是 workspace asset 的一种 projection，不是唯一权威状态。权威状态由 Ledger、permission、receipt、loan record、checkpoint metadata 和 storage metadata 共同构成。

#### FR-2 AgentLibrary / 图书馆

系统必须把传统知识库能力提升为 AgentLibrary：

- 支持上游知识库、文件库、人工整理和智能体上传进入 `derivedKnowledgeSpace`。
- 支持 source、document、section、block、field、table cell、image、attachment、evidence pack 和 asset rendition 级别授权。
- 支持 `deny`、`discoverOnly`、`metadataOnly`、`controlledView`、`citeOnly`、`copyToContext`、`exportAllowed`、`checkoutAllowed`。
- 支持知识访问 receipt、loan record、denied request audit 和撤销策略。
- 支持知识搜索、证据回读、上下文编译、导出、蒸馏、memory write 和 tool call 出口共用同一权限裁决。

系统必须保证没有权限的知识不会进入 retrieval candidate、hidden context、rerank hint、distillation input、memory summary、artifact、trace 或 evaluation sample。

#### FR-3 上游知识库再授权

外部知识库进入 Pact 后必须被重新切分和重新授权：

```text
upstream knowledge base
  -> connector / adapter
  -> upstreamKnowledgeRef
  -> information slicing
  -> derivedKnowledgeSpace
  -> authorizationOverlay
  -> downstream workspace / agent access
```

下游智能体不能持有上游 token、上游私有对象路径、collection id 或裸 source id。它们只能访问 Pact 授权后的派生视图、脱敏内容、只读阅览会话或 evidence pack。

v0.0.1 的上游知识库兼容通过 `pact.knowledge-backend-port.v1` 接入 Dify 和 RAGFlow。运行配置只保存到 `ServerConfig.getDataDir()/knowledge/knowledge-backends.json`，且只能保存 `secretRef` / `endpointRef`；Agent、MCP、CLI 和控制台都不能直接持有上游 token。缺少真实 Dify/RAGFlow 凭据时只能标记 `contractVerified`，不能声明真实上游检索、evidence 回读或导出已完成。

#### FR-4 终端贡献和贡献统计

系统必须允许本地智能体、脚本、人工终端向公共工作空间提交贡献资产：

- 贡献类型：`knowledge`、`skillRef`、`tool`、`script`、`file`、`sourceCode`、`codeChange`、`goldenRule`、`expertOpinion`。
- 固定位置：`workspace/tools/`、`workspace/scripts/`、`workspace/files/`、`workspace/knowledge/`、`workspace/rules/`、`workspace/expert-opinions/`；Skill 包本体进入独立 Skill Hub / skill library，workspace 只保存 skill library record 引用、采用和统计视图。
- 状态机：`submitted -> preview -> scanned -> reviewed -> published | rejected | needs_changes -> adopted -> deprecated | revoked`。内容到达服务器并完成最小留档后才是 `preview`；权限、风险和审核确认后才是 `published`。
- 下载、安装、执行、复制到上下文、跨 workspace 使用都必须写 usage event、loan record 和 audit。

资产贡献统计报表是 P0 能力。第一版报表按 workspace、贡献者、资产类型、时间窗口、使用动作、授权流、风险和维护状态统计。排行榜从报表中派生，第一版主分数为：

```text
rankScoreV0 =
  usageCount * successRate
  + uniqueWorkspaceAdoptions
  - rollbackCount
```

#### FR-5 MCP Service 和 Workspace API

智能体首选通过 Pact MCP service 接入。MCP service 是 adapter，Workspace API 是协议事实源。

第一版 MCP service 必须做成设备级 Pact MCP Hub，而不是 OpenClaw 专用 adapter：

- HTTP 权威入口复用主服务：connector 不内置默认 IP；安装启动时先扫描本机 Pact 候选端口和已发布的本机 registry，读取 discovery 后通过 `/api/mcp/handshake` 校验服务端 Ed25519 签名，验证通过后才使用对应 HTTP MCP URL。OrbStack 内仍使用服务端 discovery 给出的 `host.orb.internal:<port>/mcp` advertised endpoint。
- 按 Stitch MCP 方案优先生成 HTTP MCP 客户端配置：OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf 都直接指向 HTTP MCP endpoint 或 discovery 给出的 VM / remote endpoint，并带 agent-specific token header；Codex CLI 使用其标准 `--bearer-token-env-var` HTTP MCP 形态，服务端同时接受 bearer token 和 `X-Pact-Api-Key`；stdio proxy 只作为不支持 HTTP MCP 或自定义 headers 的兼容入口。正常安装由 connector 在签名验证后调用本机 `/api/mcp/local-grant` 自动申请默认 agent grant，用户不需要手动复制 token。
- 设备级发现统一封装为 `pact-mcp discover-local`，它只维护 canonical registry `~/.pact/mcp/servers.json`，并由 `/.well-known/pact/mcp.json` 和 `/api/mcp/discovery` 暴露当前 HTTP endpoint、VM endpoint、connector release 包和安装状态；不得通过写多个本机发现文件来兼容不同客户端。
- 客户端安装器必须通过 `pact-mcp-connector` release 包发布；终端用户不得为了安装 MCP 拉取完整服务端仓库。release manifest 必须包含 package version、npm tarball sha256、portable zip sha256、portable tarball sha256、GitHub 一行安装命令、Hub 注册命令、本机发现命令、多选交互式安装命令、单客户端脚本化连接命令、卸载命令、doctor 命令和支持的 target 列表。一行安装脚本优先使用已有 Node.js 20+ 下载小体积 source tarball；没有 Node.js / npm / npx 的机器必须能 fallback 到自带 Node runtime 的 portable zip 包安装。
- 每个智能体使用独立 grant/token，不复用控制台 cookie / CSRF；grant 记录目标客户端、默认 agent toolset、scope、policyVersion、projectionVersion 和审计时间。MCP token/key 是持久身份凭据，随 server data dir 恢复，服务重启不得要求重新配置；普通权限变更只刷新 policy / grant projection / gateway cache，除显式 revoke、expire 或 rotate 外不替换 token。
- 最小 MCP JSON-RPC：`initialize`、`tools/list`、`tools/call`、标准错误、工具 schema；**v0.0.1 硬切语义分类出口：`tools/list` 对外必须且只能返回 `pact.discovery`、`pact.knowledge`、`pact.sharedspace`、`pact.codespace` 和 `pact.skillHub` 五个功能大类入口**。旧入口 `pact.workspace`、`pact.list`、`pact.skill`、`pact.help` 不再作为 alias 接受；新版 connector / doctor 必须提示旧配置重装。绝不允许直接暴露内部庞杂的基础工具列表，通过语义分类在保护 Context Window 的同时为智能体建立清晰的职能心理模型，统一由服务端处理版本分发和权限收敛。
- 所有分类入口均采用统一 Intent Operation envelope：`apiVersion`、`operation`、`subject`、`operatorId`、`agentProfileId`、`workspaceId`、`traceId`、`idempotencyKey`、`intent`、`input`、`dryRun` 和 `requestedScopes`。MCP adapter 可为缺省字段注入认证 grant 和本机目标信息，但进入 Operation Registry、Tool Management、Workspace API、Policy Engine、Operation Ledger 和审计前必须形成完整 envelope。高风险 restore/delete/reindex、auth、settings、runtime mounts 和 grant 管理必须通过显式 grant 扩展，不能作为独立 MCP tool 展开。
- 所有 API、RPC、MCP、CLI、控制台、后台任务、workflow activity、队列状态变更、provider adapter、webhook、工具执行、模型调用、读请求、写请求、权限裁决和拒绝都必须进入统一 Operation Scheduling Kernel。只有内核受理、分配 `operationId`、写入 `started` / `pending` 账本并完成策略裁决的请求，才算真实 operation。模块本地 audit、provider ledger、queue event、runtime log 和 trace span 只能作为投影或回执；账本写不进去时，写操作和外部副作用必须失败在副作用之前。
- 统一审批归 Operation Scheduling Kernel 管。`requiresConfirmation` 或 `confirm=true` 只能触发 pending 状态，不能代表审批完成；高危 operation 必须挂起为 `pending_operation`，进入独立 `/approval` 页面。审批通过后恢复原 operation 并沿用原 `operationId` / `traceId`；拒绝、过期、撤销或 hard deny 时不得执行副作用。
- MCP capability discovery 必须按当前 grant 和最新 policy projection 过滤：智能体能看到权限范围内所有可调用 operation，不能看到未授权写入、维护、admin 或被 deny 的 operation。`/api/mcp/local-grant` 没有匹配目标时只授予默认只读 agent toolset；匹配到 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf 等受支持目标时自动授予预定义 safe-write agent toolset，并写入 `targetMatch`、`matchedTargets` 和 `agentProfileId`。
- 版本和操作回信推送：`initialize` 声明 `tools.listChanged=true`，服务端在 discovery / initialize / `pact.mcp.version` 暴露 `interfaceVersion`、`toolsetVersion` 和当前 grant projection 版本，并在 `GET /mcp` SSE 上发送 `notifications/tools/list_changed` 和权限变更通知。每次已授权 operation 执行完成或失败后，服务端还必须向同一 grant 的 SSE 连接推送 `notifications/pact/operation_reply`，包含 envelope、执行状态、目标回执、错误或结果摘要。SSE 只负责让客户端刷新可见能力；每次请求的 allow/deny 必须由服务端按最新策略实时裁决，不能依赖客户端收到通知才生效。
- 安装器必须覆盖 `openclaw`、`claude-code`、`codex`、`gemini-cli`、`antigravity`、`opencode`、`copilot`、`kilo-code`、`cursor`、`hermes` 和 `windsurf`：无 `--target` 的 `pact-mcp install` 必须启动 TUI 菜单，扫描可用客户端和 OrbStack / remote 中的 claw-compatible、Hermes 等衍生体；能调用标准 CLI 的目标必须调用标准 CLI；无非交互 CLI 的目标按官方配置格式结构化写入、先生成配置回滚副本、只替换 `pact` 条目，不覆盖其它 agent 配置。
- MCP 上传大文件或目录时，MCP service 只承担控制面和权限面，数据面优先交给本机 Pact client runtime。不能预设本地已经安装 `pact-client-cli` 或 `clientd`：最小 MCP connector 必须能先向服务端发起 client runtime bootstrap pull，按需拉取裁剪后的客户端模块，再启动本地 sidecar / stdio bridge 复用 `pact-client upload enqueue`、后台队列、upload session、checkpoint 和断点续传；纯 HTTP MCP 的 inline/base64 上传只作为小文本兼容路径。
- Pact client runtime 必须支持客户端主动 bootstrap：客户端声明平台、可用命令、需要模块和上传规模，服务端返回裁剪后的 `pact-client-cli`、`clientd`、upload queue、MCP local bridge、connector/cache 和 transport adapter 计划，并提供从服务端拉取这些模块的 MCP/HTTP/RPC 操作。服务端不得仅凭 Linux 平台假设 `rsync` 可用，native transport 只能在客户端命令和服务端能力同时声明后启用。

MCP handler 不能直接改文件夹或数据库，必须提交 intent envelope 给 Operation Scheduling Kernel，再由内核落到 Workspace API、Policy Engine、Operation Ledger、Checkpoint Tree 和 storage metadata。后台 worker、provider helper、domain helper 和控制台 handler 同样不能绕过调度内核直接改变持久状态或执行外部副作用；未带内核准入印记的路径必须拒绝为 `operation_unmanaged` / `operation_not_scheduled`。

#### FR-6 统一 Checkpoint Tree

系统必须把所有进入公共空间边界的行为、后台任务 activity 和 provider side effect 纳入统一 Checkpoint Tree：

- 访问请求：workspace info/list、catalog discover、metadata read、permission check、search、evidence read、asset list/read/download、skill list/download、receipt list、audit query、operation history、checkpoint tree list、restore preview、context bundle、export、checkout、memory write。
- 文件变动：create、update、move、delete、archive、restore。
- 知识贡献：submit、scan、review、publish、adopt、revoke。
- 代码贡献：target evaluate、prepare local worktree、upload Gerrit change、link existing change、sync review status、fallback proposal。
- 技能调用：list、download、install、execute、usage report、revoke。
- 权限裁决：grant、deny、permission request、authorizationOverlay change。
- 恢复动作：restore preview、restore、revert operation scope、branch、merge。

恢复必须是 append-only restore operation。可以复用 git tree、diff、commit graph、临时 worktree 和 checkout-like restore 能力，但不能把裸 `git reset` 作为产品语义。

#### FR-7 代码贡献双路线

系统必须把普通 workspace 资产路线和 Gerrit 代码评审路线并行保留：

- Workspace route：治理知识、文件、Skill、工具、脚本、报告、上下文材料、运行时资产和非代码交付物。
- Gerrit route：治理需要进入代码仓库、形成补丁、提交评审、关联 Change-Id 或最终合并的源代码变更。

客户端提出“上传代码文件”“提交 patch”“同步仓库改动”“创建代码修改”这类意图时，Pact 必须优先引导到 Gerrit route。Workspace route 只能作为以下情况的 fallback：

- 代码片段只是知识材料、证据、教程、设计草稿或报告附件。
- 目标仓库未登记、用户无 Gerrit 权限、策略禁止直接发起 review，或需要先形成人审 proposal。
- 上传内容不是可应用到仓库的变更，例如孤立片段、日志、构建输出或临时分析材料。

Gerrit route 不替代 Workspace API。Pact 仍负责 identity resolution、policy evaluation、target compatibility、Operation Ledger、Checkpoint Tree、audit、贡献统计和状态同步；Gerrit 负责代码 diff、review、submit、merge 和仓库级权限。

#### FR-8 管控台

管控台第一版必须覆盖完整闭环：

- Workspace asset browser。
- AgentLibrary 权限和上游再授权配置。
- 贡献资产、Skills、排行榜和资产贡献统计报表。
- Gerrit code review route 的目标仓库、待提交变更、Change-Id、review URL、状态同步和 fallback 原因。
- 访问 receipt、loan record、denied request audit。
- Operation history 和 Checkpoint Tree。
- Restore preview 和恢复到此节点。
- 权限错误、不可见过滤、授权请求和撤销记录。

管控台只消费公开 API，不引用后端内部模块。

### 非功能需求

| 类型 | 要求 |
| --- | --- |
| 安全 | 权限从 source / asset 入库开始治理；所有出口共用裁决；secret value 不进入 trace、export、checkpoint node 或 context bundle。 |
| 可恢复 | 所有公共空间行为形成 Operation Ledger 和 Checkpoint Tree；恢复动作保留原历史。 |
| 可审计 | 所有访问、拒绝、借阅、导出、执行、授权和恢复都有 `auditId`。 |
| 可解释 | 检索、证据、权限过滤、上下文编译和恢复 preview 必须能解释原因和影响范围。 |
| 可移植 | 本机、容器、虚拟机、云端、Linux、macOS、Windows 通过管理软件和 adapter 适配。 |
| 可替换 | 外部知识库、向量库、图谱库、解析器、OCR、模型和 tool runtime 通过 mount / adapter 替换。 |
| 可验证 | 每个 P0 能力必须有本地 verify 脚本和可复现 demo。 |
| 可降级 | 外部知识库、模型、OCR 或 tool runtime 不可用时，系统必须返回可解释错误，并保留失败审计。 |

### 运行上下文

Pact 运行在服务端进程、本地管理软件、CLI、GUI 和 Web 控制台之间：

```text
Local agents / humans / scripts
  -> MCP service / CLI / Console / Workspace API
  -> Policy Engine
  -> Operation Ledger
  -> Workspace Runtime
  -> Asset / Knowledge / Skill / Tool runtimes
  -> Storage, indexes, object files, external adapters
```

部署形态：

- 单机开发：Node.js 服务端、Vue 控制台、Rust CLI、Flutter GUI、本地 SQLite 和本地对象目录。
- OrbStack / VM demo：服务端在 Mac 或 VM 内运行，智能体通过 `host.orb.internal` 或 stdio proxy 访问 MCP。
- 容器和云端：服务端、控制台、管理软件和外部知识库 adapter 分离部署，权限和 checkpoint metadata 仍由 Pact 持有。
- 企业生产：外部存储、外部向量库、审计归档、密钥服务、OTLP exporter 和备份恢复流程接入。

### 模块设计

#### Presentation Layer

外观层是面向个人用户的控制面板，只负责用户可见操作和状态展示。切面层位于应用层之下，面向上游服务、下游客户端、前端控制面板和本地智能体调用，负责对外合同、发现投影、认证切面、credential / secretRef 投影和协议映射。

`server-web` 是 Vue 控制面板。职责：

- 展示 workspace、AgentLibrary、贡献、权限、审计、任务、checkpoint 和生产门禁。
- 通过 view/domain controller 调用 `server-web/lib/*-client.ts` 中的公开接口。
- 不直接读取后端文件、SQLite、raw object 或内部模块。

前端后端访问必须收敛到统一接口层：`server-web/lib/*-client.ts` 持有后端路径、HTTP method、请求参数、返回类型和下载 / SSE / JSON 等底层差异；view/domain controller 负责页面状态、loading/error、刷新、确认和业务动作；view/component 只负责展示、输入和用户动作。view/component 不得直接 `fetch()`、直接调用全局 `bridge.*`、自行拼 `/api/...` URL 或绕过对应 controller。`bridge.*` 只作为兼容 facade 或明确 allowlist 边界存在，例如受控下载按钮，不能作为新页面的通用后端入口。

`server-web` 不能 import `server/platform`、`server/services`、`server/config`、Node runtime API，也不能引用 metadata store、Tool Management platform 或 agent config registry 等后端内部对象。该边界由 `npm run server:verify:management-layer` 和 `npm run server:verify:frontend-architecture` 共同守卫。

前端组件复用规则必须从 `server-web/components/common.ts` 开始。新增界面控件时，能用通用组件就用通用组件；通用组件不能直接覆盖需求时，能继承就继承；确实需要新组件时，先扩展通用组件和 `commonComponentRegistry`，再在业务页面中使用。也就是说，页面级实现必须先扩展通用组件，而不是在每个 view 内复制 checkbox、option bar、status pill、browse button、fold card 或 history/session panel 的私有实现。

`client-gui` 是 Flutter 跨平台交互层。职责：

- 展示本机客户端状态、上传、导出、配置和用户操作。
- 不承载业务权威状态。

#### Application Layer

`server/platform/specialized` 承载应用能力：

- `knowledge`：三层知识模型、KnowledgeCore、外部知识库 adapter、document export、retrieval、preprocessing。架构图中原始语料、知识索引、知识蒸馏按自下而上的三层 pipeline 放在左侧，AgentLibrary / 图书馆作为右侧等高访问面。
- 共享空间：上层为云盘共享，承载 Cloud Drive Port、iCloud local projection、OneDrive live adapter 和后续 OAuth contractVerified 外部云盘接入；下层为本地共享，承载受控文件空间和 StateCommit。
- 代码管理：Codespace、代码变更记录、代码评审路由和 GitHub/Gerrit provider 兼容。
- `capabilities/tools`：Tool Management、catalog、grant、policy、execute 和 audit。
- `capabilities/skills`：`pact.tool-skill-management.v1` provider、SkillLibrary、skill registry、skill bundle、MCP Skill Hub 语义入口和 skill 使用事件。MCP adapter、console grant / authorization / passthrough、client connection projection 只能通过该 provider 访问 Tool/Skill 能力，不能直接持有 Tool Management `registry/store/runtime/router`。

这些应用模块可以拥有各自 runtime，但不能绕过 Workspace API 改写公共状态。

#### Aspect Layer

切面层位于应用层下方，承接外观层、应用层和外部入口，只保留协议适配、请求归一化、公开调用面收口和返回结构拼装。`server/platform/common/operation-dispatcher` 升级为 Operation Scheduling Kernel：接收切面层给出的 operation contract，完成准入、统一分发、并发控制、队列 / workflow 绑定、账本 started / pending、审批 pending / resume、执行许可和执行回执。公开 operation manifest、interface catalog、HTTP/RPC/CLI 映射、discovery 投影、character tag projection contract、authentication aspect contract 和 secret distribution contract 归切面层所有。Operation Registry 只是目录和合同，不能作为执行许可；只有调度内核 accepted 的 operation 才能调用 executor。

#### Capability Layer

能力层位于切面层下方，承载平台能力、通信服务、智能体运行能力和策略管理。切面层只能通过 operation、provider 或 domain service 投影调用能力层，不能重新持有业务 runtime、store 或 service。

角色配置是能力层的 Tag 能力，不是传统组织 / 小组 / 角色三套根模型。`Tag Management` 是基础能力；`Organization Management`、`Group Management` 和 `Character Management` 都是继承自 Tag 的 typed projection。每个用户可以拥有多个标签，组织、小组、层级身份、管理员身份和自定义角色都表达为 tag；tag 有层级和作用域约束，授予某个组织特有标签前必须先满足该组织 scope tag，允许一个主体同时持有多个组织管理员标签。

认证管理是能力层能力，不属于安全内核。认证管理包含 `Credential Distribution` 和 `Authentication Aspect`：`Credential Distribution` 负责向 Pact Client 与 Agent MCP 输出 credential / secretRef projection；`Authentication Aspect` 负责 Identity Verification，并把 Character & Permission 映射为 Credential & Capability。安全内核只裁决 `capability -> secretRef` 的绑定和授权结果；认证管理必须根据切面层给出的上游服务、下游客户端和平台应用服务投影工作，不得暴露 secret value，也不得绕过 `pact.security-permissions.v1` provider。

通信服务归入能力层：ACP Relay 和 MCP Server Side 都是平台能力，不属于下游客户端切面的内部网关。下游客户端切面负责 MCP/ACP adapter layer、协议请求翻译和 route intent；真实通信服务 runtime 由能力层提供，并在 route policy、Operation Scheduling Kernel、安全权限和审计之后被调用。MCP 请求路由到 MCP Server Side / Tool Management，ACP 请求路由到 ACP Relay；两者都不能回落为下游切面的 raw socket proxy。

协作治理归入能力层：`workspace-governance` 承载 issue / proposal、锁与继承等跨共享空间治理能力；共享空间只保留云盘共享、本地共享和公共资产状态本体。

智能体归入能力层：`server/platform/specialized/agent` 承载 `pact.agent-runtime.v1` provider、agent workspace、agent context、agent memory、agent gateway、model probe、model routing 和 agent config registry。Console settings/gateway/model-routing/word-cloud agent calls 只能通过该 provider 进入 Agent Gateway、Model Probe 和 agent-configs，不能直接持有 gateway module loader 或 registry 实例。

策略管理归入能力层：`server/platform/specialized/capabilities/strategy-management` 承载 `pact.strategy-management.v1` provider，统一处理 workflow policy、agent policy、route policy、模型路由策略包装和工具调用策略预览。route policy 表达上游服务切面、下游客户端切面和其它网关入口到平台内部能力或外部服务 endpointRef 的路由裁决；它不执行路由，也不替代安全权限。

新增或调整 MCP service 时必须遵守：

- MCP tool name 稳定。
- MCP 输入先归一化为 Workspace API request。
- MCP 输出必须包含 operation、audit、policy 和 checkpoint 相关引用。
- stdio proxy 不持有状态。

策略管理只决定流程、调用、路由和门禁策略；真实认证、授权、grant、scope 和 denied audit 仍归 `pact.security-permissions.v1`，能力层不能把安全权限裁决重新硬编码到策略模块里。

#### Governance Layer

治理层是 Pact 的核心，逻辑上包含：

- `WorkspaceGateway`
- `PolicyEngine`
- `OperationLedger`
- `SnapshotManager`
- `CheckpointTree`
- `ArtifactRegistry`
- `ContributionRegistry`
- `AgentLibrary`
- `SkillLibrary`
- `LeaderboardRuntime`
- `ContextCompiler`
- `AuditStore`

其中 Ledger、permission、receipt、loan record、checkpoint metadata 是权威；文件树、索引和报表都是 projection。

#### Infrastructure Layer

`server/platform/common` 承载基建：

- `security`：认证、权限、CSRF、grant、secret ref、策略裁决。
- `storage`：SQLite、对象存储、batch repository、metadata。
- `observability`：trace、日志、metrics 和后续 OTLP 映射。
- `module-manager`：外部 mount、parser、knowledgeBase、vectorStore、graphStore 和 custom adapter。
- `devops`：进程状态、统一注册、监控告警、快照、备份、恢复编排和生产运行辅助。

`server/platform/modules` 存放外置模块和本地运行时资源，例如 Tika、OCR、document parser 和 runtime assets。

#### 基础能力内聚和解耦合同

平台基础能力必须遵守低耦合、高内聚。`server/platform/common` 不是业务能力仓库，也不是跨模块 service locator；它只承载可被多个应用能力复用的稳定合同、运行时基础设施和防腐层。依赖方向固定为：

```text
foundation composition management
  -> common platform contracts
  -> specialized capability implementations
  -> modules / external adapters

specialized capability implementations
  -> common platform contracts

common platform contracts
  -/-> specialized capability implementations
```

基础能力归口如下：

| 基础能力 | 高内聚边界 | 允许依赖 | 禁止依赖 |
| --- | --- | --- | --- |
| 安全和权限管理 | `server/platform/common/security` 统一认证、CSRF、`pact.security-permissions.v1` provider、subject resolution、authorization decision、tenant/resource ABAC、grant/token 裁决、capability 到 secretRef 绑定裁决、toolset maxRisk 约束、workspace asset policy、audit retention、redacted audit export 和 denied audit。 | 切面层输出的最小授权策略投影、独立 authorization store、operation audit store、装配能力输出的 console auth contract。 | 直接读取 knowledge、workspace、tool runtime 的内部状态；持有 operation manifest、interface catalog、secret distribution contract 或协议映射事实源；负责密钥分发；让能力层或应用层直接持有 `consoleAuth`、`authorizationEngine` 或 `authorizationStore` 执行权限裁决；为某个业务模块硬编码权限分支；把高风险 operation 挂入低风险 toolset；把 secret value、本机绝对路径或未脱敏输入输出写入 trace/export。 |
| 模块管理 | `server/platform/common/module-manager` 统一 mount 合同、模块发现、加载、热重载、合同测试和 capability package 生命周期入口。 | mount manifest、module descriptor、runtime provider interface。 | 在模块管理器里直接实现知识、OCR、向量库或业务处理逻辑。 |
| 装配能力 | `server/platform/common/composition-management` 统一三类装配：独立部署依赖打包、动态模块挂载、启动装配撮合。独立部署依赖打包把平台核心能力和目标应用能力所需依赖合成为部署包；动态模块挂载处理运行期热加载、热切换、热卸载和 provider rebinding；启动装配撮合在服务启动期按依赖合同、feature profile 和 provider contract 收敛模块与功能。 | module descriptor、dependency contract、deployment package manifest、bootstrap package manifest、mount contract、feature profile、provider contract、runtime health summary、切面层输出的合同投影。 | 仅作为图外说明存在；反向理解业务语义；让能力层、应用层或切面层各自私有装配 provider；绕过依赖合同或装配计划直接连接模块；把依赖打包、动态挂载、启动撮合或脱水策略散落到业务模块。 |
| 算法和数据结构 | `server/platform/common/data-structure` 承载 Checkpoint Tree、共享图结构、排序/合并/差异算法和状态协调原语。 | 纯数据模型、序列化合同、无副作用算法。 | HTTP controller、UI 状态、业务 runtime、裸数据库细节。 |
| 平台适配 | `server/platform/common/platform-adapter` 负责环境适配、操作系统级兼容、异构运行时桥接和平台级垫片。 | 环境变量、平台常量、标准操作系统 API。 | 任何应用层组件、平台能力或高层存储细节。 |
| 资源管理 | `server/platform/common/resource-management` 统一资源池、缓存空间、本地磁盘调度、执行控制和轻量状态协调原语。 | 只读状态摘要、存储系统参数、并发锁、执行队列、文件系统原子写入、序列化合同。 | 持有 operation manifest、interface catalog、HTTP/RPC/CLI 映射、discovery 投影、应用上下文、业务逻辑、智能体状态以及策略执行引擎。 |
| ├─ File System Management | 数据目录、路径治理、原子写入、权限边界和本地文件资源预算必须保留。 | 标准 fs、私有目录、原子写入、路径归一化、文件锁。 | 文件 watcher、外部盘、导入器可动态卸载；不得暴露本机绝对路径给下游客户端。 |
| ├─ Memory Management | 内存预算、缓存上限、背压和 OOM 防护必须保留。 | runtime memory summary、缓存预算、队列背压信号。 | 高级 profiler、外部观测器可卸载；不得让业务模块直接调全局内存策略。 |
| ├─ Process Management | 进程生命周期、子进程隔离、退出清理和资源回收必须保留。 | process supervisor、pid/exit receipt、超时/取消信号。 | 特定 worker pool、外部 runtime launcher 可动态解绑。 |
| ├─ Shell Management | 只保留受控执行合同、命令白名单和安全包装。 | shell execution policy、env redaction、cwd boundary。 | 具体 shell provider 可卸载；不得作为平台启动生命线。 |
| ├─ Terminal Management | 只保留 terminal session 合同、审计和资源限制。 | PTY session contract、terminal lease、输出截断和审计。 | PTY、terminal UI、交互式 session provider 可动态卸载。 |
| ├─ Database Management | 最小 metadata、audit、权限和状态索引能力必须保留。 | repository contract、migration、事务。 | SQLite、Postgres、外部 DB adapter 可替换；备份恢复归运维编排；不得让上层直接拼 SQL 操作核心表。 |
| ├─ Message Queue Management | 最小后台队列、异步回执、重试和恢复能力必须保留。 | queue contract、job receipt、retry/backoff、dead-letter summary。 | 外部 MQ、复杂 broker、worker pool 可卸载或降级为本地队列。 |
| ├─ Cache Management | 最小 TTL cache、防抖、热点缓存和失效合同必须保留。 | in-memory cache、TTL、capacity budget、invalidation hook。 | Redis、持久 cache、分布式 cache adapter 可卸载。 |
| ├─ Runtime Management | runtime 生命周期、profile、feature binding、mount 生命周期和 provider 状态必须保留。 | runtime provider contract、feature runtime、mount lifecycle、health summary。 | 具体 runtime provider、外部 launcher、语言运行时 adapter 可动态绑定/解绑。 |
| ├─ 执行控制 | 资源管理下的执行资源原语，负责并发锁、执行排队、超时/取消和执行回执。 | 调度合同、并发域、装配能力绑定的 executor contract。 | 理解 operation registry、接口目录、协议映射或具体业务 runtime。 |
| ├─ 状态协调 | 资源管理下的状态资源原语，负责原子写入、JSONL 序列化、状态锁和轻量状态收敛。 | 文件系统原子写入、序列化合同、runtime logger。 | 持有 HTTP controller、UI 状态、业务 runtime、备份恢复编排或裸数据库细节；把业务策略塞进状态协调工具。 |
| └─ Storage Provider | `server/platform/common/storage` 统一 SQLite migration、对象存储、raw object、metadata repository、`pact.storage.v1` provider 和 storage doctor。 | 数据库连接、repository interface、对象引用、migration、装配能力绑定的 storage provider contract。 | 上层直接调用 `metadataStore.getStorageSummary()`、raw object 路径解析、storage repair 函数、运维备份恢复入口或直接拼 SQL 操作核心表；storage 反向调用知识检索、agent workspace、Tool Management 或直接拥有运维备份恢复编排。 |
| 运维 | `server/platform/common/devops` 统一 `pact.devops.v1` provider、进程状态、启动发现、监控告警、快照、备份、恢复编排、生产运行辅助和统一注册。 | runtime health interface、event bus、只读状态摘要、快照合同、备份计划、恢复演练记录、装配能力绑定的 queue monitor 观测端口。 | 绕过 operation/authorization 直接修复业务状态；让协议入口或 console executor 直接装配 monitor alert core / background process 实现；把运维脚本变成业务状态事实源；让存储或资源管理层反向拥有备份恢复策略。 |

装配能力的第一个预设配置是 `server/platform/common/composition-management/knowledge-transformation-standalone.preset.json`，展示名为 Pact Agent Library：它把原始语料建构、知识索引、知识蒸馏和 AgentLibrary 访问面打包成可脱水的独立外部应用，保留安全、审计、操作分发、存储、上传回执、模块生命周期和健康检查这些平台核心能力。

第二个预设配置是 `server/platform/common/composition-management/gerrit-service.preset.json`：它打包 Pact 的 Gerrit 服务集成、代码评审路由、Codespace 管理、repo operation 兼容和 runtime dependency 下载能力，但不把 Gerrit WAR、Docker Desktop 或其它真实运行时二进制放进部署包。Gerrit 运行时由 `pact.runtime-dependencies.v1` 的 `runtime.dependencies.download targetId=gerrit` 或 `server:gerrit:download` 按需拉取、校验和缓存。

第三个预设配置是 `server/platform/common/composition-management/skill-hosting-repository.preset.json`，展示名为 Pact Skill Hub：它把技能托管仓库脱水成独立服务，只负责技能包集中存储、生命周期推进、目录发现、bootstrap 拉取计划、下载物化和回执审计；技能执行仍在智能体本地运行。该预设依赖上游发布/管理网关、下游智能体拉取网关、`work-queue-core` 队列和异步运行时，避免上传校验、索引刷新、下载物化等耗时任务阻塞服务请求线程。

切面对接能力归口如下：

| 切面 | 对接能力 | 高内聚边界 | 禁止依赖 |
| --- | --- | --- | --- |
| 上游服务切面 | 外部服务发现、上游 endpointRef、上游 secretRef 投影、服务接口契约、服务快照。 | 上游服务投影、外部服务配置、provider contract、secretRef projection 和服务快照。 | 直接读取具体业务 runtime 状态；把业务模块状态作为服务发现事实源；持有 secret value。 |
| 下游客户端切面 | 客户端交互配置、MCP/ACP adapter layer、协议请求翻译、能力目录投影、bootstrap manifest、客户端 secretRef 投影、客户端可见功能裁剪。Pact 自有客户端可以和平台双向交互；MCP/ACP 侧只被动接收智能体请求并翻译为 route intent。 | 客户端 interaction config、public feature runtime、active capability manifest、connector/client bootstrap manifest、secretRef projection、MCP/ACP framework adapter catalog 和协议到平台服务的 route intent。 | 向客户端暴露应用 runtime、基建存储、本机绝对路径或 secret value；直接执行 MCP/ACP 请求；绕过 MCP Server Side、ACP Relay、Tool Management、Operation Scheduling Kernel 或安全权限裁决。 |
| 平台应用服务切面 | operation manifest、Operation Registry、interface catalog、HTTP / RPC / CLI 映射、character tag projection contract、authentication aspect contract、secret distribution contract、系统接口目录。 | Operation Registry、interface manifest、controller wiring 生命周期投影、协议绑定投影、character tag projection contract、authentication aspect contract 和 secret distribution contract。 | 绕过 Operation Scheduling Kernel 执行业务；把 Operation Registry 当执行许可；接口目录只声明接口但不输出 `registered/wired/implemented/verified` 生命周期；绕过安全内核直接分发密钥。 |

任何基础能力对应用能力的调用都必须通过装配能力输出的接口、切面层 Operation Registry / interface catalog、Tool Management runtime 或明确的 mount contract 完成。`common/console` 对 system health/bootstrap operations、console auth/session management、authorization façade / grant / MCP authorization operations、Tool Management HTTP passthrough operations、event subscribe / agent sync operations、runtime info / console state aggregation、system interfaces / runtime path browse、maintenance agent operations、workspace audit/history、discovery/client registration operations、knowledge core operations（retrieval/evidence/knowledge graph/asset rendering/export/maintenance/review/learning）、knowledge source management、preprocessing rules、document parsing、corpus search/source vocabulary、word-cloud/domain summary、storage summary/doctor/reconcile/backup-restore、client runtime allocation/bootstrap、runtime mount operations、production readiness / executive report / architecture live map / sample business pack operations、module ecosystem operations、Codex OAuth operations、settings/model-library/Agent Gateway operations、monitor alerts、system observation/background process/checkpoint tree、job failed review、evidence sufficiency、knowledge agent skill、golden rules / rule authoring / gold cases、knowledge skills、agent evaluation、model decision、knowledge evolution、knowledge distillation/workbench、summarization、agent exploration、agent workspace file、agent workspace management/session/inheritance/lock、context runtime、workspace contribution、protocol façade / contract-registered operations、AgentLibrary knowledge access、workspace governance、asset lineage、Gerrit/repo、data connector、performance capacity 和 capability package 这类 console 操作只能提交 `operationId + input + context` 给 `server/platform/specialized/console/console-domain-operation-executor.mjs` 或同目录下的专用 operation executor，不能直接持有具体业务 registry、access policy、runtime 方法、runtime mount config/apply 方法、runtime refreshMounts 调用、production readiness/report/module ecosystem/OAuth 执行函数、settings/model-library/gateway provider 方法、model probe/gateway 调用、Agent Gateway workspace/session context 解析、discovery client registration/config 方法、console auth 方法、authorization engine/store 方法、maintenance agent service 方法、operation audit store 查询、event bus 订阅策略/agent-sync policy、Tool Management grant/authorization store/router 方法、metadataStore 业务方法、knowledge source service 方法、knowledge.search/search.query 输入策略、多模态检索策略、event/agent-sync subscription topic 策略、word-cloud corpusPath 策略、storage repair/backup 函数、client runtime allocator/bootstrap 方法、background process 函数、checkpoint tree API、job manager 查询、文件系统路径浏览、接口目录拼装、controller-to-controller 业务转调、知识配置 schema 拼装、协议占位响应或执行函数。`system-controller.mjs` 当前只保留 handler family composition、shared request/response helper 和 `securityPermissions` fallback 包装，不再直接实现任何 `async handle*` 方法；domain provider 解析、审计日志封装和 knowledge / Agent Gateway / authorization context 组装集中在 `server/platform/common/console/http/controllers/system-controller-contexts.mjs`，其中授权上下文只传递 `pact.security-permissions.v1` provider，不再传递裸 `authorizationEngine` 或 `authorizationStore`；console auth/session handler 已按接口族进入 `server/platform/common/console/http/controllers/system-controller-auth-handlers.mjs`；authorization、workspace file façade、workspace contribution、AgentLibrary access、workspace skill 和 workspace asset permission 这些基础协议 handler 已按接口族进入 `server/platform/common/console/http/controllers/system-controller-foundation-handlers.mjs`；system interfaces、events/agent-sync、discovery、runtime info/path/mounts/console state 和 maintenance agent 这些 runtime/system handler 已按接口族进入 `server/platform/common/console/http/controllers/system-controller-runtime-handlers.mjs`；settings、model probe、Agent Gateway、agent registry 和 model routing handler 已按接口族进入 `server/platform/common/console/http/controllers/system-controller-agent-settings-handlers.mjs`；workspace audit/history、checkpoint façade、workspace code change façade、raw corpus、dossier 和 distillation export handler 已按接口族进入 `server/platform/common/console/http/controllers/system-controller-workspace-protocol-handlers.mjs`；knowledge workflow config、corpus、document parse、word-cloud、word-bag、storage summary/doctor/reconcile/backup 和 affair taxonomy handler 已按接口族进入 `server/platform/common/console/http/controllers/system-controller-knowledge-operations-handlers.mjs`；knowledge console/source/config schema/capabilities/export/health/maintenance/review/learning/golden rules/distillation/workbench/skills/evaluation/evolution/summarization/exploration/search/graph handler 已按接口族进入 `server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs`。当前门禁要求 `server/platform/common` 到 `server/platform/specialized` 的真实 static/dynamic import 为 0，并禁止 `system-controller.mjs` 回流上述业务直接调用、context/provider assembly 或已拆出的接口族 handler；如未来确有短期迁移桥，必须先登记 owner、原因、退出条件和到期日，并在同一轮变更中给出移除计划，不能作为常态架构口径。

`server/platform/common/console/http/controllers/system-controller-ops-observation-handlers.mjs` 已承接 failed jobs review、background processes、checkpoint tree observation 和 monitor alerts handler。`system-controller.mjs` 只能通过 `createSystemControllerOpsObservationHandlers(...)` 组合这些运维观测方法，不能回到主文件内直接调用 background process 函数、checkpoint tree API、monitor alert API 或 job manager 查询。

`server/platform/common/console/http/controllers/system-controller-capability-ecosystem-handlers.mjs` 已承接 capability package、Codex OAuth、production health、executive report、architecture live map、sample business pack、module ecosystem、workspace governance、Gerrit/repo、asset lineage、data connector governance 和 performance capacity handler。`system-controller.mjs` 只能通过 `createSystemControllerCapabilityEcosystemHandlers(...)` 组合这一组能力生态和治理入口，不能回到主文件内承载这些生产治理、模块生态或外部能力转发方法。

`server/platform/common/console/http/controllers/system-controller-workspace-runtime-handlers.mjs` 已承接 context profiles、context preview/compaction/session memory/build records/evaluation、client runtime allocation/bootstrap/status、agent workspace、agent sessions、workspace inheritance、locks 和 workspace file runtime handler。`system-controller.mjs` 只能通过 `createSystemControllerWorkspaceRuntimeHandlers(...)` 组合这一组工作空间运行时入口，不能回到主文件内承载 context runtime、client runtime 或 agent workspace 转发方法。

`server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs` 已承接 knowledge console/source/config schema/capabilities/export/health/maintenance/review/learning/golden rules/distillation/workbench/skills/evaluation/evolution/summarization/exploration/search/graph 等知识运行时 handler。`system-controller.mjs` 只能通过 `createSystemControllerKnowledgeRuntimeHandlers(...)` 组合这一组知识运行时入口，不能回到主文件内承载知识源、检索、蒸馏、技能、评估或进化 handler。

服务端内部工作流也必须遵守同一条协议边界。`server/services/server-runtime/http-server.mjs` 发布启动期 `system.interfaces.snapshot`、`discovery.config.snapshot`、`agent_sync.config.snapshot`、`system.console_state.snapshot` 和 `storage.summary.snapshot` 时只能通过切面层提供的 operation contract 进入 Operation Scheduling Kernel，不能直接调用 `buildConsoleState()`、`loadAgentSyncConfig()`、`metadataStore.getStorageSummary()` 或手工拼装 interface/discovery/storage 快照；内部调度、HTTP 和 RPC 的合同、接口目录和发现投影归切面层维护，kernel 负责准入、账本、并发控制和调用分发。

协议入口不得直接装配 specialized agent 配置注册表。`server/services/server-runtime/http-server.mjs` 不能 import 或调用 `getAgentConfigRegistry()`；agent config registry refresh 归基建层装配能力所有，随 feature runtime、platform registry、console domain services 和 storage/runtime provider 一起完成装配图收敛。

协议入口也不得直接装配 agent memory、context runtime 或 Agent Gateway adapter。`server/services/server-runtime/http-server.mjs` 不能 import 或调用 `createAgentMemory()`、`createContextRuntime()` 或 `agent-gateway/index.mjs`；这些 agent runtime provider 由基建层装配能力按 feature runtime 和 provider contract 建立绑定，再作为装配产物提供给 controller、maintenance agent、summarization、agent exploration 和其它 workflow。

Tool Management runtime 也归基建层装配能力。`server/services/server-runtime/http-server.mjs` 不能直接 import `tool-management-core/index.mjs` 或调用 `createToolManagementPlatform()`；协议入口只能消费装配能力输出的 Tool Management provider，由装配图绑定 operations、feature runtime、controllers、audit/concurrency/protocol event bus、console auth 和 logger。

Checkpoint upload session 属于协议工作流实现，不属于 `common/console` 的稳定基础能力。`server/platform/common/console/http/controllers/jobs-controller.mjs` 和 `system-controller-contexts.mjs` 不能直接 import `protocols/checkpoint/upload-session-store.mjs`；它们只能通过 `server/platform/specialized/console/console-domain-services.mjs` 注入的 `uploadSessionStore` provider 调用创建/查询/追加 chunk、receipt 构建、文件解析和清理能力。

Job workflow 属于任务工作流 provider，不属于 `common/console` 的直接依赖。`jobs-controller.mjs`、runtime/system handler、knowledge console handler 和 failed-jobs observation handler 只能接收 `pact.job-workflow.v1` provider，不能直接持有或查询 `jobManager`；`server/platform/specialized/console/job-workflow-provider.mjs` 负责把任务创建、查询、checkpoint lookup、结果读取和重跑能力封装成协议端口。

Console state projection 也不属于 `api-facade`。`server/platform/common/console/http/api-facade.mjs` 不能直接调用 `loadSettings()`、agent config registry、job manager、client runtime allocator、maintenance agent summary 或 storage client registration；settings/agent selector、jobs、client connection、maintenance summary、client runtime status 和 runtime info settings 只能通过 `console-domain-services.mjs` 暴露的 projection provider 进入，由 `server/platform/specialized/console/console-state-projections.mjs` 统一完成。

Tool Management grant 到客户端连接列表的投影属于 Tool Management 领域语义，也不属于 `common/console`。`server/platform/common/console/http/api-facade.mjs` 不能直接读取 `toolManagementPlatform.store.listGrants()`、不能理解 MCP grant metadata 或拼装 MCP 插件连接行；只能调用 `console-domain-services.mjs` 暴露的 `buildConsoleClientConnections(...)`，由 specialized console projection 调用 `buildToolManagementClientConnectionRows(...)` 并与 Pact client registration rows 做通用列表合并。

Knowledge console summary 属于知识运行时领域语义，不属于 `common/console`。`server/platform/common/console/http/api-facade.mjs` 不能直接访问 `runtime.mounts.knowledgeBase`、调用 knowledgeBase health/capabilities/maintenance 或维护知识模块路径脱敏逻辑；只能调用 `console-domain-services.mjs` 暴露的 `buildKnowledgeConsoleSummary(...)`，由 `server/platform/specialized/console/knowledge-console-summary.mjs` 负责知识运行时摘要投影。

Runtime console summary 属于 runtime/domain projection，也不属于 `common/console`。`server/platform/common/console/http/api-facade.mjs` 不能直接读取 `runtime.runtimeOptions`、枚举 `runtime.mounts`、拼装 mount summary 或读取 mount config 路径；只能调用 `console-domain-services.mjs` 暴露的 `buildRuntimeConsoleSummary(...)`，由 `server/platform/specialized/console/runtime-console-summary.mjs` 统一投影 runtime profile、mount modules/routing、mount config、mount capability summary 和 analysis module 列表。

### 核心数据模型

#### Workspace

```text
Workspace {
  workspaceId
  name
  ownerSubjectId
  environmentRef
  policyRefs
  rootAssetRefs
  checkpointTreeRef
  createdAt
  updatedAt
}
```

Workspace 是公共空间边界。所有资产、知识、贡献、任务、上下文和恢复动作都必须归属 workspace 或明确跨 workspace 授权。

#### Asset

```text
Asset {
  assetId
  workspaceId
  assetType
  sourceRef
  storageRef
  metadata
  dataClass
  sensitivity
  policyRef
  currentVersionRef
  lifecycleState
  createdBy
  createdAt
}
```

`assetType` 至少覆盖 `rawAsset`、`derivedAsset`、`knowledge`、`file`、`sourceCode`、`codeChange`、`skill`、`tool`、`script`、`goldenRule`、`expertOpinion`、`artifact`。

#### Knowledge Evidence

```text
EvidencePack {
  evidenceId
  assetId
  derivedViewRef
  sourceTrace
  citations
  contentRefs
  scoreReasons
  policyDecision
  allowedRefs
  withheldCounts
}
```

Evidence Pack 是权限裁决后的证据包，不是裸 chunk。

#### Permission Decision

```text
PermissionDecision {
  decisionId
  subject
  operatorId
  agentProfile
  workspaceId
  targetRefs
  requestedAction
  requestedEgress
  accessMode
  allowed
  reason
  redactionPolicy
  auditId
}
```

同一请求的 search、evidence、context、export、artifact、distillation、memory 和 tool call 必须复用同一类裁决结果。

#### Receipt and Loan Record

```text
KnowledgeAccessReceipt {
  receiptId
  subject
  agentProfile
  workspaceId
  taskId
  evidenceRefs
  accessMode
  egress
  auditId
  createdAt
}

LoanRecord {
  loanRecordId
  receiptId
  retainedRefs
  canRetain
  canShare
  expiresAt
  revocationPolicy
  downstreamWorkspaceRefs
}
```

Receipt 记录智能体知道了什么；LoanRecord 记录智能体能不能带走、保留、再分享和跨 workspace 使用。

#### Operation and Checkpoint Node

```text
Operation {
  operationId
  workspaceId
  subject
  operatorId
  agentProfile
  idempotencyKey
  operationKind
  targetRefs
  policyDecisionRef
  preSnapshotRef
  diffRef
  postStateRef
  auditId
  createdAt
}

CheckpointNode {
  checkpointNodeId
  parentNodeIds
  workspaceId
  subject
  operatorId
  agentProfile
  eventKind
  effectKind
  targetRefs
  policyDecision
  stateDelta
  receiptRefs
  auditId
  createdAt
}
```

读请求和拒绝请求也必须产生 node，因为它们改变治理状态。第一版不做“高价值读请求才入树”的例外：每个外部可见读请求都要生成 checkpoint node，包括 list、discover、metadata、permission check、receipt list、audit query、operation history 和 checkpoint tree list。为了避免递归膨胀，同一次外部请求内部读取 Ledger、AuditStore 或 CheckpointTree 所需的系统内部读，不再生成新的读节点，但必须继承父 `operationId` / `traceId`，重要子步骤作为 span、receipt 或 child event 关联回统一账本。

#### Contribution

```text
Contribution {
  contributionId
  assetId
  contributorSubject
  contributorAgentProfile
  workspaceId
  contributionType
  lifecycleState
  scanResultRef
  reviewResultRef
  permissionPolicyRef
  usageStatsRef
  createdAt
}
```

Contribution lifecycle 不能被 Skill、file 或 knowledge 各自私有化；它是 workspace asset governance 的统一状态机。

### 接口设计

#### Workspace API

Workspace API 是协议事实源。第一版必须覆盖：

- workspace info、list、context、context bundle。
- asset upload、list、read、download、policy set、permission check。
- code target evaluate、change prepare、change upload、change link、status sync。
- file read、write、patch、delete、restore。
- contribution submit、review、publish、adopt、revoke。
- checkpoint tree list、restore preview、restore。
- operation history 和 audit query。

#### Knowledge API

Knowledge API 公开能力：

- `knowledge.search`
- `knowledge.get.evidence`
- `knowledge.backend.connect`
- `knowledge.space.list`
- `knowledge.evidence.get`
- `knowledge.export.request`
- `knowledge.permission.request`
- `knowledge.asset`
- `knowledge.document.structure`
- `knowledge.export.docx`
- `raw-corpus.format.convert`
- `knowledge.dossier.export`
- `knowledge.distillation.export`

所有入口必须接入 `pact.knowledge-access.v1`，不能出现绕过权限的直读接口。

#### MCP Tool Surface

第一版 MCP 对外工具面固定为五个语义分类入口：

```text
pact.discovery
pact.knowledge
pact.sharedspace
pact.codespace
pact.skillHub
```

v0.0.1 不保留旧入口 alias。`tools/list` 的产品口径是五个语义入口，不再把内部 operation 展开为 20+ 个扁平 MCP tools。MCP adapter 只负责 JSON-RPC / SSE / handshake / envelope 转换；Tool/Skill 能力发现、授权、调用、local grant、workspace ref 解析和返回脱敏必须下沉到 `pact.tool-skill-management.v1` provider。

`workspace.info`、`workspace.file.upload`、`knowledge.search`、`workspace.checkpoint.restore.preview` 等名称是 Operation Registry / Tool Management 的 operation id，只能作为分类入口的 `operation` 参数出现，不能被写成 MCP tool name。公开 checkpoint operation id 使用 `workspace.checkpoint.tree.list`、`workspace.checkpoint.restore.preview` 和 `workspace.checkpoint.restore`。

#### Tool Management API

Tool Management 负责外部工具和 Skill 执行授权：

- catalog 定义工具。
- toolset 聚合权限。
- grant 表达主体可用范围。
- 新发 grant 的调用凭据是 `ock_` opaque capability key；Tool Management DB 只保存 grant 展示、限流、审计投影和 credential 摘要，不保存明文 capability 列表作为最终权限事实源。
- execute 在运行工具前必须调用 Capability Key Kernel 校验 `opaqueKey + cap:tool:<toolId>:execute`；scope/toolset/risk policy 只能进一步收紧，不能绕过 kernel 放行。
- execute 看到 `ock_` 调用凭据但 Capability Kernel provider 不可用或缺少 `verify()` 时必须拒绝为 `capability_kernel_unavailable`，不能退回 legacy token hash、scope 或 toolset grant 裁决。
- 如果 grant 在签发时绑定了 namespace、用户、智能体或客户端，execute 还必须调用 Binding Guard 校验当前请求报文中的 `namespace/userId/agentId/clientId`；该绑定不进入 Capability Kernel，且普通 DB metadata 被篡改不能改变绑定裁决。
- policy evaluate / preview 表达执行前裁决。
- execute 只在授权通过后运行，并写 audit、usage event 和 checkpoint node。

Skill 可以被贡献和安装，但执行必须通过 Tool Management grant。

### 关键流程设计

#### 文件互通流程

```text
Agent A upload file
  -> MCP `pact.sharedspace` with operation `workspace.file.upload`
  -> identity resolution
  -> policy evaluation
  -> Operation Ledger append
  -> asset object write
  -> checkpoint node
  -> audit event
  -> MCP operation_reply pushed to the calling grant with target receipt
  -> Agent B list/download through same policy path
```

验收要求：A 不需要知道 B，B 不直接访问 A 的本地文件系统；双方只通过公共 workspace asset 互通。

#### MCP 大文件上传流程

```text
Agent calls MCP `pact.sharedspace` with operation `workspace.file.upload`
  -> MCP adapter classifies payload and local file intent
  -> client runtime bootstrap pull if local runtime is missing
  -> client runtime bootstrap plan if local runtime is stale or incomplete
  -> MCP local bridge invokes pact-client upload enqueue
  -> transport negotiation
  -> upload session/checkpoint or native transport
  -> server validates manifest/digest/policy
  -> asset object write
  -> Operation Ledger append
  -> checkpoint node
  -> audit event
  -> MCP operation_reply pushed to the calling grant with upload target receipt
```

验收要求：小文本可以通过 MCP inline 兼容上传；大文件、目录和可恢复上传必须复用 client-cli 的后台队列、checkpoint 和 upload session，不把大 payload 塞进 JSON-RPC。

#### 代码贡献流程

```text
Client upload code intent
  -> target compatibility evaluate
  -> policy evaluation
  -> local git worktree / patch prepare
  -> Gerrit Change-Id ensure
  -> git push refs/for/<branch>
  -> Gerrit change link
  -> Operation Ledger append
  -> checkpoint node
  -> audit event
  -> workspace codeChange projection sync
```

验收要求：代码文件、patch 或仓库变更默认进入 Gerrit review；Workspace 只保存 `codeChange` 治理记录、review reference、hash、状态、权限裁决和 fallback 原因。需要评审和合并的代码不得默认沉淀为普通 `file` 资产。

#### 云盘投影流程

```text
Agent calls MCP `pact.sharedspace` with operation `sharedspace.drive.file.upload`
  -> CloudDrivePort resolves provider connection
  -> default/public/advanced directory mapping resolution
  -> secretRef / local path guard validation
  -> policy decision
  -> transfer receipt
  -> checkpoint
  -> Operation Ledger append
  -> cloud drive projection status
```

验收要求：Sharedspace 仍是 Pact 权威状态，云盘只作为外部 adapter/projection。iCloud local adapter 默认只创建 `.pact-data/<client>` 可写空间和 `.pact-data/public` 只读公共空间；用户显式添加的高级目录暴露默认只读，不能被当成整盘映射。公开响应只能返回 `driveRef`、root hash、目录映射、receipt 和 checkpoint，不返回本机绝对路径。P0 第一批真实 provider 固定为 iCloud + OneDrive：OneDrive 必须通过真实 OAuth / live adapter 完成上传、下载和 provider receipt，并标记 `remoteLiveVerified` 或 `realE2EVerified`；Google Drive、Dropbox 缺少真实 OAuth 凭据时只能标记 `contractVerified`，不能把 contract-mode 说成真实上传、真实同步或 production ready。

#### 知识再授权流程

```text
external KB sync
  -> upstreamKnowledgeRef
  -> slicing
  -> derivedKnowledgeSpace
  -> authorizationOverlay
  -> A allowed evidence/export
  -> B deny or invisible
```

验收要求：A 能获取授权内容并产生 receipt / loan record；B 不能通过 search、context bundle、export、distillation 或 memory write 旁路拿到。

#### Skill 贡献流程

```text
Agent A upload Skill
  -> contribution.submitted
  -> scan
  -> review / policy
  -> published
  -> Agent B list/download/use
  -> usage event
  -> leaderboard and report refresh
```

验收要求：贡献值随真实使用增长，失败、回滚和风险会降低质量分。

#### 共享文件修改流程

```text
Agent A patch shared file
  -> preSnapshot
  -> diff
  -> write
  -> checkpoint C1
Agent B patch same file
  -> preSnapshot
  -> diff
  -> write
  -> checkpoint C2
```

验收要求：最终文件包含两次授权修改；Operation history 能解释每次修改由谁发起、改了什么、属于哪个 checkpoint。

#### 安全恢复流程

```text
C0 -> C1(A change) -> C2(B change) -> R1(restore to C1) -> R2(restore to C0)
```

恢复不删除原历史。`R1` 和 `R2` 都是新的 restore operation，必须有 restore preview、diff、policy decision、audit event 和 checkpoint node。

### 存储设计

第一版本地默认存储：

- metadata SQLite：workspace、asset、operation、audit、policy、contribution、checkpoint metadata。
- knowledge SQLite：KnowledgeCore、evidence、document structure、retrieval metadata。
- raw object / asset directory：原始文件、派生文档、DOCX/YAML sidecar、导出物。
- git-backed workspace tree：文件树 projection、diff、commit graph、restore preview 的底层能力。
- config files：settings、mount config、feature profile、entity config。

存储原则：

- SQLite 和对象目录是本地默认实现，不是协议边界。
- 上层只能通过 `pact.storage.v1` provider 或明确 repository contract 访问 storage summary、raw object、client registry、doctor/reconcile、source vocabulary 和 corpus search 端口；备份恢复由运维基础编排。
- 外部知识库、向量库、图谱库只能通过 adapter / mount 进入，不能成为智能体直连面。
- checkpoint metadata 和 Operation Ledger 是产品恢复事实源；git commit 是文件树 projection。
- 运维备份恢复必须覆盖 metadata DB、knowledge DB、raw objects、assets、jobs、settings、mount configs、model configs 和 auth DB。

### 权限与安全设计

权限模型按入口、对象、动作、出口四层裁决：

1. 入口：subject、operator、agentProfile、libraryCard、workspace。
2. 对象：source、asset、evidence、field、tool、skill、file、context、memory。
3. 动作：discover、read、cite、copyToContext、download、export、checkout、write、execute、share、restore。
4. 出口：searchResult、evidenceRead、contextBundle、artifactWrite、exportFile、distillationInput、distillationOutput、memoryWrite、toolCall、evaluationSample。

安全要求：

- 默认拒绝，显式授权。
- 高敏资产可以隐藏存在性。
- `controlledView` 是 Pact 受控会话内阅览，不是读取本机原路径，也不等于可以下载或写 memory。
- 任何导出、下载、checkout、context injection 都必须产生 receipt / loan record。
- 权限拒绝必须进入 denied request audit。
- secret 只以 secret ref 存储和传递。
- 日志、trace、评估样本和导出必须执行 redaction policy。
- tenant、workspace、dataClass 和 requestedEgress 是统一 ABAC 裁决字段；普通 subject 不能跨 tenant 或越过 allowlist 读取、导出、写 memory 或调用工具。
- Capability Key Kernel 只接受 `opaqueKey + requestedCapability` 并返回最小 allow/deny 裁决；默认响应不能暴露 keyHash、capabilitySetHash、完整 capability 数量、metadata 或 constraints，也不能提供列出某个 key 全部权限的接口；授权 decision 和直接 denied request 落盘都必须脱敏 opaque key、keyHash、capabilitySetHash、lookup key 和完整 subject capability 集合。
- `ock_` opaque capability key 进入执行路径后必须由 Capability Kernel 验证；Kernel provider 不可用或缺少 `verify()` 时必须拒绝为 `capability_kernel_unavailable`，不能回退到 token hash、scope、toolset 或普通 grant 策略。
- runtime lookup key 只用于本地 HMAC 索引，不代表任何权限主体；一旦已有 Capability binding，不能单独轮换 lookup key，因为内核不保存明文 opaque key，无法重算现有索引。调用密钥滚动必须走 `rotateCapabilityKey`：新发 `ock_`，旧 key 置为 invalid。
- denied request 审计查询必须支持按 `reasonCode`、`operationId`、`toolId`、`subjectId`、`tenantId` 和 `workspaceId` 组合过滤，用于事后证明拒绝原因和影响范围。
- Capability 必须来自内核硬编码 manifest；未知 Capability 在 opaque key 签发、轮换和 Tool Management grant 创建时必须拒绝，不能静默过滤或退回 legacy token / scope 裁决。
- 普通业务数据库、JSON 运行态文件和智能体可写 data dir 不能作为权限事实源，只能作为审计投影、展示、申请单或缓存。
- 默认本机部署使用 OS keyring-backed Capability Kernel：sealed state 优先存 Keychain / Linux keyring / Linux Secret Service / pass-GPG / DPAPI-CNG，启动后加载到内存，高频验证只查内存；不默认创建独立系统用户。
- OS keyring 不可用时允许降级到 file fallback，保持系统可用；该模式必须在 doctor、控制台和审计中标记为 degraded，且仍不得使用业务 DB 作为权限事实源。file fallback 的 sealed state 和本地 sealing-key sidecar 必须使用私有目录、`0600` 文件权限和原子写入，主状态文件不得嵌入 sealing key、明文 capability、opaque key 或明文绑定身份。
- Capability Kernel 与 Binding Guard 的 sealed state 写入必须串行化：同一进程内使用 mutation queue，跨 helper / CLI / server 进程使用 data dir 下的私有 lock file。并发签发、绑定、撤销、恢复导入和调用密钥轮换不能互相覆盖；首次 runtime lookup key 初始化也必须在锁内完成并持久化。读路径必须等待当前写入完成后再返回裁决或 recovery package。
- Capability state 和 Binding Guard state 必须支持统一 recovery package，用于换机、重装、keyring 损坏和 file fallback 到 keyring 的迁移；recovery package 必须显式导出、默认加密、不得进入普通 trace/export/bundle，且包外不得暴露 runtime lookup key、binding lookup key、明文 capability、opaque key 或明文身份。
- `pact.capability-security-helper.v1` 是增强本机模式的第一层 helper 协议：业务进程可以通过命令子进程完成 opaque key 签发、指定 Capability 裁决、Binding Guard 裁决和撤销，只返回当前请求的 allow/deny 与必要摘要，不返回完整 capability 列表、绑定身份集合或 lookup key。
- 独立长期驻留 `capabilityd`、专用 OS 用户、TPM/HSM/KMS/TEE 是后续增强或企业模式，不是个人版默认安装前提。
- 用户、组织、角色、Owner、智能体和 namespace binding 不进入权限内核模型；它们只能在内核外的受控绑定层完成校验。
- 组织模型独立于权限内核：`pact.organization-model.v1` 固定根节点为 `Pact Root`，组织可以挂到 Root 或其它组织下，用户可以挂到 Root 或组织下；Owner 默认挂到 Root 下。Root 不是权限主体，也没有可授予的 Root capability；组织树只提供身份归属和治理上下文，不作为 Capability Kernel 的事实源。
- Binding Guard 的状态也必须是 sealed state：只保存 HMAC 后的 key/user/agent/client/namespace 索引和 `valid | invalid` 状态；验证接口只回答“当前 key 是否允许被当前 namespace/user/agent/client 使用”，不能列出绑定身份集合。
- 直连受管工作空间文件系统视为未受管操作，不能进入 canonical workspace state。

### 可观测性设计

内部 Trace 是事实源，OpenTelemetry 是可选导出映射。第一版 trace schema 必须能关联：

- request、operation、checkpoint、audit、policy decision。
- upload、parse、normalize、ingest、search、evidence、distill。
- model route、token、cost、latency、error。
- tool grant、tool execution、skill usage。
- asset、evidence、context bundle、memory write 和 export。

管控台和 API 需要能从一个回答或一次操作展开看到证据、权限、模型、工具、成本、失败点和对应 checkpoint。服务端最小 drill-down 入口是 `observability.trace.get` / `GET /api/observability/traces/:traceId`，它以 operation audit 和 authorization decision 为本地事实源；OTLP exporter 后续只能作为可选外发通道。

### 错误处理和幂等设计

所有写操作必须支持：

- `idempotencyKey`
- 输入 hash
- precondition
- dry-run / preview
- diff
- policy decision
- rollback or restore plan
- audit event

错误类型至少区分：

- `permission_denied`
- `not_found`
- `conflict`
- `quota_exceeded`
- `payload_too_large`
- `external_dependency_unavailable`
- `policy_required`
- `checkpoint_restore_blocked`
- `invalid_identity`
- `unsafe_tool_execution`

权限拒绝不是系统错误；它是受控治理结果，必须可审计、可解释、可统计。

### 部署和配置设计

本地开发默认：

- Node.js 服务端。
- Vue 控制台。
- Rust CLI。
- Flutter GUI。
- 本地 SQLite、对象目录和 runtime assets。

关键配置：

- 服务端 settings。
- feature profile。
- mount config。
- model routing。
- MCP endpoint。
- workspace root。
- external knowledge-base provider。
- secret ref provider。

配置原则：

- 人工可维护实体配置放在 `server/config/entity-config/`。
- runtime 二进制资源放在 `server/platform/modules/knowledge/`。
- 生产环境 secret value 不进入 settings JSON。
- adapter 配置可以追加，但不能破坏已有 agent 配置。

### 验收设计

基础架构变更必须运行：

```bash
npm run server:verify:architecture-patterns
npm run server:verify:knowledge-architecture-governance
npm run server:verify:platform-layout
npm run server:verify:tool-management
npm run server:verify:agent-workspace
```

五阶段 MCP demo 必须提供：

```bash
npm run server:mcp:discover
npm run server:mcp:doctor
npm run server:verify:mcp-release
npm run server:verify:mcp-http
npm run server:verify:mcp-workspace-demo
npm run server:verify:mcp-knowledge-demo
npm run server:verify:mcp-permission-demo
npm run server:verify:checkpoint-restore-demo
npm run server:verify:mcp-demo
```

每个 demo 输出必须包含：

- agent identity
- workspace path
- asset ids
- operation ids
- checkpoint node ids
- audit ids
- 成功样例
- 拒绝样例

v0.0.1 单机交付验收由 `npm run server:verify:v001` 聚合 Phase 0-4 verifier、非破坏迁移报告、MCP/Tool/Policy 注册和前端 raw build，输出 `docs/reports/history/v001-readiness/<run-id>/report.{json,md}`。该报告只能证明单机可交付和 contract-mode 外部 adapter 合同通过。

生产级验收最终必须收敛为 `npm run server:verify:production-readiness`，并输出可汇报的 Markdown / JSON 报告。缺少真实 GitHub/Gerrit/Dify/RAGFlow/云盘 OAuth 凭据时，readiness 必须明确标为 `contractVerified` 或未配置，不能声明真实外部 E2E、真实上传、真实同步或 production ready。场景 06 的第一批 live scope 是 iCloud + OneDrive；Google Drive / Dropbox 或 fake provider 的 contract pass 不得替代 OneDrive live smoke。

## 核心原则

### 资产是主体

系统不关心智能体之间如何互相扮演、协商或聊天。系统关心的是公共工作空间资产本身：

- 可快照
- 可溯源
- 可恢复
- 可操作
- 可复制
- 可分支
- 可审计
- 可按权限暴露给外部执行者

智能体、CLI、控制台、脚本和人工操作者都是外部 operator。operator 只提交 intent、observation、artifact、proposal 或 trace；公共状态由 Pact 的 Operation Ledger、Policy Engine 和 Snapshot Boundary 决定是否变化。

### 不信任智能体

智能体可以很强，但不能被当作可信状态源。Pact 只信任可验证的资产状态、可回放的操作记录、可追溯的证据和经过确认的 decision。

错误智能体最多只能制造错误 proposal、错误 artifact 或失败 operation，不能直接污染 canonical workspace。

### 权限从源头治理

面向智能体开放的知识能力命名为 `AgentLibrary / 图书馆`。`knowledgeBase` / `pact.knowledge.v1` 是当前兼容协议和内部 mount 名称，不能反过来限制产品定位。

图书馆权限必须在 source / asset 进入公共空间时就被治理，而不是等检索结果返回后再靠 prompt 约束智能体。每一份资产都必须携带 data class、sensitivity、workspace scope、source scope、可读范围、可引用范围、可导出范围和可写回范围。

未来智能体会越来越强，上下文窗口会越来越长，注意力和推理能力也会继续提升。在这个前提下，知识库不应该主要扮演“把有限信息挑出来喂给智能体”的角色，而应该更像一栋公共图书馆：

- 门禁卡决定能不能进入知识空间。
- 楼层权限决定能访问哪些 workspace / source group。
- 书架权限决定能浏览哪些目录和元数据。
- 图书权限决定能读取哪些 document / section / block / field / asset。
- 借阅权限决定能不能把内容带走、导出、写入 artifact 或放进长期 memory。

有些资料允许智能体读，但不允许取走。这里的“取走”包括下载原文、导出、复制进 artifact、写入长期 memory、进入非授权模型上下文或被带到其它 workspace。读权限、引用权限、上下文注入权限和导出权限必须分开。

从 AgentLibrary 带走的每一条信息都必须登记。登记范围不是只记录“调用了 search”，而是记录具体哪些 evidence、section、field、table cell、image、summary、derived view 或 redacted snippet 被交给了哪个 subject / agent / workspace / task。系统没有批准带走的内容，无论通过 search、evidence、context bundle、export、artifact、distillation、memory write 还是外部知识库 adapter 发请求，都必须拿不到。

外部知识库是上游资产源，不是下游智能体的直接暴露面。Pact 的 workspace asset 不与外部知识库撞型：外部知识库可以提供原始文档、索引、向量、图谱或检索结果，但进入 Pact 后必须被重新切分、重新标注、重新授权，形成 `derivedKnowledgeSpace`。下游某些人或智能体能看哪些内容，完全由 Pact 的 `authorizationOverlay` 决定。

上游知识库的信息和资源权限再分配是 AgentLibrary 的核心功能。Pact 必须能把同一份上游知识资源拆成多个下游视图：A workspace 能看全文，B workspace 只能看元数据，C agent 只能 controlledView，D agent 可以 checkout，E agent 完全不可见。这个再分配结果必须独立于上游知识库原始权限模型，并由 Pact 自己登记、审计和恢复。

因此，某些智能体即使能操作 Pact，也永远访问不到最上游知识库。它们只能访问被 Pact 授权后的派生视图、evidence pack、脱敏内容或只读阅览会话。上游知识库凭据、原始 API、原始对象路径和未授权 source id 不能泄漏给下游智能体。

上游知识库 A/B 权限再授权演示用于证明这条边界：Pact 从上游知识库获取某个文件后，在本地生成 `derivedKnowledgeSpace` 和 `authorizationOverlay`。管理员在管控台配置 A 可以访问该文件，B 不可以访问该文件。随后进入对话页面，分别让 A 和 B 请求获取同一文件：A 应拿到授权范围内的文件或派生视图，并产生 `knowledgeAccessReceipt` / `loanRecord`；B 应收到权限错误，系统写入 denied request audit，且不能通过检索、上下文包、导出或其它接口旁路拿到内容。

### 公共工作空间优先

本地智能体有自己的本地上下文和本地能力是合理的，例如 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、本地脚本型 agent 或人工客户端。它们可以各自擅长编码、浏览器、文件、桌面或通用任务。

Pact 提供的是公共可编辑工作空间：

- 统一任务状态
- 统一资产状态
- 统一知识证据
- 统一上下文包
- 统一 artifact 与 proposal
- 统一 decision 与 audit

本地智能体想复用其它智能体之前留下的记忆，可以请求 Pact 编译 context bundle。上下文短的智能体由 Pact 做 context compression / Context Compiler，而不是要求所有智能体共享同一个运行时。

### 终端贡献是第二信息源

信息源不必然是上游知识库。很多高价值信息来自终端贡献：本地智能体、脚本、人工操作者或团队成员把已经过滤、验证、精加工的信息上传到公共工作空间。这些贡献可能是知识，也可能是 Skills、工具、脚本、文件、代码变更、规则、专家意见或黄金规则。

终端贡献型资产治理是 Workspace Asset Governance 的核心功能。下游智能体在自己可访问的一个或多个 workspace 中提交资产；每个 workspace 都有固定位置存放 `skills`、`tools`、`scripts`、`files`、`knowledge`、`rules` 和 `expert-opinions`。贡献默认进入 review / permission / publish 流程，而不是直接成为公共事实或公共工具。

代码贡献是特殊终端贡献：如果它需要进入仓库评审或合并，默认走 Gerrit route；如果它只是知识材料或报告附件，才作为 `sourceCode` workspace asset 进入普通贡献流程。

Pact 必须提供贡献排行榜和统计面板：

- 贡献次数。
- 被审核通过次数。
- 被使用次数。
- 被其它 workspace 采用次数。
- 贡献的 Skills / 工具 / 脚本被调用次数。
- 被请求授权次数和授权通过次数。
- 贡献质量、回滚率、风险等级和维护状态。

资产贡献统计报表是管理者视角的核心输出，不只是排行榜。它必须按 workspace、贡献者、资产类型、时间窗口、使用路径、授权状态和风险状态汇总，回答“公共空间到底沉淀了多少可复用资产、谁在贡献、谁在使用、哪些资产产生了团队价值、哪些资产需要治理”。

贡献越多、贡献资产越常被使用、复用质量越高，贡献者在排行榜上越高。其它人或智能体可以请求贡献者或 workspace owner 授予权限，把贡献资产下载、复制或接入给其它智能体使用；所有授权、下载、使用和撤销都必须登记。

### OpenClaw 演示闭环

OpenClaw 文档互通演示用于证明 Pact 的生态位：两个本地 OpenClaw 都安装 Pact MCP service，但它们不是互相通信，也不是暴露成 Agent 互相调度，而是共同操作同一个公共工作空间。

流程：

1. OpenClaw A 通过 MCP 工具把本地文档提交到目标 workspace。
2. Pact 在真实内容到达服务器并完成最小留档后，把文档登记为 `knowledge` 或 `file` 类型贡献资产，生成 `contribution.submitted`、`contribution.previewed`、上传记录、资产快照和审计记录，资产状态先进入 `preview`。
3. 经过权限、风险、许可、重复性和审核策略确认后，资产进入 `contribution.published`，并按 workspace 权限决定谁能看、能引用、能复制到上下文、能导出或能 checkout。
4. OpenClaw B 通过同一个 Pact MCP service 查询该 workspace 的资产。
5. 如果 B 的 subject / agent profile 有授权，Pact 返回下载状态响应或可借走的派生视图，并生成 `knowledgeAccessReceipt`、`loanRecord` 和 `auditId`；只有内容真实传完并完成校验后才记录 `asset.downloaded`。

这个场景实现的是文档通过公共工作空间互通，而不是 A 把文件直接发给 B。资产状态、权限状态、快照、借阅和撤销都由 Pact 统一治理。

Skill 贡献排行榜演示用于证明终端贡献闭环：

1. OpenClaw A 通过 `pact.skillHub.upload` 上传一个 Skill，并设置默认公开权限，例如允许同 workspace 内主体 `read`、`install` 和 `use`。
2. Pact 将 Skill 包送入 capability package lifecycle 和独立 Skill Hub / skill library；workspace contribution 只登记 skill library record 引用、采用和统计视图。
3. OpenClaw B 在面板上看到该 Skill，或通过 `pact.skillHub.list` 列出可用 Skills。
4. B 下载、安装或调用该 Skill 时，Pact 记录使用事件、借阅记录和审计记录。
5. 初始贡献算法采用使用为主的质量加权口径：每次确认下载、安装或使用都会写 `usageEvent`，但排行榜主分数是 `rankScoreV0 = usageCount * successRate + uniqueWorkspaceAdoptions - rollbackCount`。`acceptedCount` 保留为报表维度，不作为排行榜主导项。

后续可以加入去重、风险降权、失败降权、维护新鲜度和跨 workspace 采用权重；但第一版只要求“被用多少次，贡献值就加多少”，让演示链路先闭环。

### 协议适配不是核心抽象

A2A、MCP、OpenAPI、OpenAI-compatible model endpoint、CLI SDK 都是协议适配层。Pact 可以提供这些 adapter，但核心模型不依赖任何一种 agent 协议。

当前优先级：

1. Pact MCP service，作为智能体的正式接入面。
2. Agent-neutral Workspace API，作为协议事实源。
3. Tool Management / Operation API
4. Knowledge Evidence API
5. Context Compiler API
6. 可选 A2A adapter / OpenAI-compatible model gateway

如果 OpenClaw 作为本地操作手接入，它只是 workspace operator。Pact 可以作为它的服务端上游和后端控制面，但不复制 OpenClaw 的消息网关，也不复制外部实现代码。

### 可拆卸 Agent Traffic Gateway

Pact 可以接入真正的智能体流量负载网关，但它必须是可拆卸的边缘数据面，不是 Pact 的生命线。第一版内置 Caddy 与 Nginx 两个适配器，后续异构网关通过同一个 adapter registry 扩展。网关配置和可选运行时解析到本机 `.cache`，不写入 Pact canonical data dir。网关负责 TLS/mTLS、负载均衡、限流、粗粒度来源策略、连接超时、SSE/WebSocket 透传、上传 body/streaming 限制、request id 注入、边缘指标和访问日志；Pact 继续负责 subject/grant/workspace policy、Tool Management、Operation Ledger、Checkpoint Tree、audit、knowledge evidence 和 canonical state。

硬性规则：

- 网关拆除后，Pact 服务端必须仍能用 direct mode 正常启动、发现、授权、MCP 调用、HTTP API、client runtime bootstrap、upload session、workspace 操作和控制台访问。
- Pact 的启动、feature profile、grant 校验、operation 执行、checkpoint 写入和审计写入不得依赖网关控制面、网关数据库或网关缓存。
- 网关只允许传递边缘事实，例如 `X-Request-Id`、边缘认证结果、来源网络、限流结果和 route id；这些事实只能作为审计上下文，不能替代 Pact 的 grant、workspace policy 或 Tool Management 裁决。
- 可信 header 必须绑定来源约束，例如 loopback/private network allowlist、mTLS 或显式 gateway shared secret。direct mode 必须忽略或剥离外部伪造的 gateway-only header。
- discovery 可以优先发布 gateway endpoint，但必须同时保留 direct fallback endpoint。客户端、MCP connector 和 `pact-client` 不能只知道网关地址。
- SSE/MCP 会话需要连接级 sticky 或可恢复订阅，但 workflow、operation、upload job 和 agent session 的事实状态仍在 Pact，不在网关。
- 大文件和目录上传仍以 client runtime、upload session、checkpoint 和 transport adapter 为数据面事实源；网关只做流量保护和流式转发，不重新实现分块、digest、重试或资产登记。
- 验收必须覆盖三种状态：只有 Pact 无网关、Pact 经过网关、拆掉网关后回到 Pact direct mode。三种状态都必须证明 health、MCP/SSE、Tool Management execute、workspace file/upload 和 request/audit correlation 不破坏。

归口上，agent traffic gateway 属于 `agent-client-mcp-compatibility` 的 ingress adapter。若它集成云 LB、service mesh、WAF 或企业 API gateway，这些外部产品的凭据、部署和同步语义再归入 `external-service-compatibility`；但对 Pact 代码和协议而言，它永远只是可选入口，不是核心抽象。

## 逻辑架构

```text
Local Operators
  - OpenClaw / Claude Code / Codex / Gemini CLI / Antigravity / OpenCode / Copilot / Kilo Code / Cursor / Hermes Agent / Windsurf / scripts / humans
  - browser, files, shell, desktop and coding execution

Protocol Adapters
  - MCP server
  - Workspace API
  - Tool Management API
  - Knowledge Evidence API
  - Context Compiler API
  - optional A2A / OpenAI-compatible adapters

Compatibility Layers
  - agent-client-mcp-compatibility
    - MCP connector, local grant pairing, client runtime bridge, transport fallback
  - external-service-compatibility
    - Docker, GitHub, Gerrit, Mailbox, external knowledge, model provider, vector/graph backend
  - pact-internal-compatibility
    - module contracts, resource operations, capability lifecycle, runtime environment, state boundary

Pact Core
  - WorkspaceGateway
  - OperationLedger
  - PolicyEngine
  - SnapshotManager
  - ArtifactRegistry
  - ContributionRegistry
  - SkillLibrary
  - LeaderboardRuntime
  - ProposalLedger
  - EvidenceRuntime
  - ContextCompiler
  - AuditStore

Storage and Indexes
  - metadata/pact.sqlite
  - knowledge-core/knowledge.sqlite
  - raw objects and assets
  - job snapshots
  - external knowledge-base adapters
```

## 代码分层

- 外观层 / 控制面板
  - 个人用户控制面板：server-web、client-gui、console shell 和只读系统视图，只通过应用层或切面层入口进入平台。
- `server/platform/specialized`
  - 应用层：knowledge、sharedspace、codespace、capabilities/tools、capabilities/skills，其中通用工具与技能通过 `pact.tool-skill-management.v1` provider 聚合对外访问。
- 切面层
  - 对接能力：upstream service aspect、downstream client aspect、platform application service aspect，承载协议适配、请求归一化、公开调用面收口、服务发现、上游 endpointRef、客户端交互配置、bootstrap manifest、secretRef 投影、character tag projection contract、authentication aspect contract、secret distribution contract、operation manifest、Operation Registry、interface catalog 和 HTTP/RPC/CLI 映射。
- 能力层
  - 平台能力：public call surface、character configuration（Tag Management、Organization Management、Group Management、Character Management）、authentication management（Credential Distribution、Authentication Aspect）、communication service（ACP Relay、MCP Server Side）；独立部署依赖打包、动态模块挂载、启动装配撮合和 runtime provider 装配归基建层装配能力。
  - 协作治理：workspace-governance、issue/proposal、锁与继承等跨共享空间治理能力。
  - 智能体：agent workspace/context/memory、agent gateway、model probe、model routing 和 agent config registry。
  - 策略管理：workflow policy、agent policy、route policy、模型路由策略包装和工具调用策略预览。
- `server/platform/common`
  - 基建层：security、module management、composition management（deployment dependency package、dynamic module mount、startup composition）、data structure、platform adapter、resource management（file system、memory、process、shell、terminal、database、message queue、cache、runtime、execution control、state coordination、storage provider）、devops（snapshot、backup、restore orchestration）、console API 基础设施。
- `server/platform/modules`
  - 外置模块和本地运行时资源，例如 Tika、OCR、document parser、可替换 mount runtime。
- `server/services`
  - 产品入口：HTTP server、client service、agent-facing service wiring。
- `server-web`
  - Vue 控制台，只消费公开 API，不引用后端内部实现。
- `client-cli`
  - Rust 本地执行层与 CLI sidecar，负责本机文件、上传、mirror、connector、checkpoint、导出和系统适配。
- `client-gui`
  - Flutter 展示层和跨平台交互层，不能成为业务执行层。

## 公共状态模型

Workspace state 由以下对象构成：

- `tasks`：任务、接力、状态机。
- `assets`：原始资产、派生产物、外部引用、版本。
- `evidence`：可引用证据包、来源、定位、置信度、权限范围。
- `artifacts`：智能体或人工操作产生的文件、报告、patch、导出物。
- `codeChanges`：Gerrit change、patch set、review URL、local git worktree、submit status 和 fallback reason 的治理记录。
- `observations`：operator 声称观察到的事实，不自动成为 canonical fact。
- `proposals`：对公共状态的修改建议。
- `decisions`：经策略、人审或授权流程确认的团队事实。
- `memory`：运行时辅助记忆，可被加载和压缩，但不等于 evidence。
- `audit events`：接口调用、策略裁决、状态变更、模型调用和工具执行记录。

## 写入路径

公共状态变更必须走受控流程：

```text
operator intent
  -> policy check
  -> idempotency check
  -> dry-run / diff
  -> proposal or operation
  -> snapshot boundary
  -> apply
  -> audit event
  -> recoverable state
```

默认写操作是 append-only。任何会改变 canonical workspace 的操作都必须具备：

- `workspaceId`
- `subject`
- `agentId` 或 operator id
- `taskId` 或 operation scope
- `idempotencyKey`
- `policyDecision`
- `preSnapshot`
- `operationDiff`
- `postStateRef`
- `auditId`

Checkpoint Tree 必须升级为统一 Checkpoint Tree，而不是只服务任务、队列或文件删除。所有进入公共空间边界的行为都要成为 checkpoint node：

- 所有访问请求：workspace info/list、catalog discover、metadata read、permission check、search、evidence read、asset list/read/download、skill list/download、receipt list、audit query、operation history、checkpoint tree list、restore preview、context bundle、export、checkout、memory write。
- 所有文件变动：create、update、move、delete、archive、restore。
- 所有知识贡献：submit、scan、review、publish、adopt、revoke。
- 所有代码贡献：target evaluate、prepare local worktree、upload Gerrit change、link existing change、sync review status、fallback proposal。
- 所有技能调用：list、download、install、execute、usage report、revoke。
- 所有权限裁决：grant、deny、permission request、authorizationOverlay change。
- 所有恢复动作：restore preview、restore、revert operation scope、branch、merge。

读请求看似不改变文件，但会改变公共空间的治理状态：它会产生 access receipt、loan record、usage event、denied request audit、贡献统计和模型上下文暴露记录。因此读请求也必须全量进入统一 Checkpoint Tree。第一版不允许把普通 list / discover / metadata / permission check 只放进接口日志；它们也要形成轻量 checkpoint node。否则系统只能恢复文件，不能回答“智能体到底看过什么目录、知道过什么、借走过什么、调用过什么、被拒绝过什么”。

全量入树只针对外部可见请求边界。同一次请求内部为了构造响应而读取 Ledger、AuditStore、CheckpointTree 或 projection 的系统内部读，不递归生成新的 checkpoint node。

统一 Checkpoint Tree 的节点必须至少携带：

- `checkpointNodeId`
- `parentNodeIds`
- `workspaceId`
- `subject`
- `operatorId`
- `agentProfile`
- `eventKind`
- `effectKind`：read、write、execute、permission、restore、deny、report。
- `targetRefs`
- `policyDecision`
- `stateDelta`
- `receiptRefs`
- `auditId`
- `createdAt`

只有这样，智能体即使在公共空间里乱删、乱读、乱试权限、乱调用技能，系统也能按树回放、定位、解释、回撤和恢复。

安全恢复演示必须证明：即使 A 把工作空间里的很多文件逐个删除，团队也不需要慌。A 的每次删除都只是一个带 `preSnapshot` / `postSnapshot` 的 workspace commit，所有 commit 形成 Checkpoint Tree。管理员在管控台打开 Checkpoint Tree 历史，下滑找到 A 操作之前的节点，点击“恢复到此节点”，系统创建一次新的 restore operation，把 workspace 回到该节点对应的状态，同时保留 A 的删除历史、恢复记录和审计链。

这个模型可以复用 git worktree 的思想和部分系统能力：tree object、diff、commit graph、checkout-like restore、临时 worktree 预览和 merge / branch 语义都很适合。但 Pact 的权威状态不只是文件树，还包含权限、知识 evidence、贡献记录、借阅记录、operation ledger 和审计，因此恢复入口必须是 Pact 的 Checkpoint Tree / Operation Ledger，而不是让智能体直接操作裸 git 仓库。

## 客户端运行时与上传传输设计

Pact 的智能体接入面是 MCP service，但文件上传的数据面不能长期依赖 MCP JSON-RPC 的 `contentBase64` 或 inline text。MCP 适合作为控制面：认证、授权、目标 workspace、操作意图、审计和错误语义；本机文件读取、目录遍历、断点续传、增量同步和长任务队列必须由运行在文件所在机器上的 Pact client runtime 执行。

默认不能假设本地已经有完整客户端。Pact MCP connector 的最小形态只负责发现服务端、完成握手、申请 grant、请求 bootstrap pull、下载并校验裁剪模块、启动本地 bridge。需要上传大文件时，connector 先把缺失的 client runtime 从服务端拉下来，而不是要求用户预先安装完整客户端，也不是要求用户 clone 服务端仓库。

### 目标架构

```text
Agent MCP client
  -> HTTP MCP endpoint or stdio MCP bridge
  -> MCP control operation
  -> bootstrap pull from server when local runtime is missing
  -> local Pact client runtime
  -> pact-client upload enqueue
  -> transport adapter
  -> server upload/session/workspace API
```

`pact-client-cli` 是上传执行层事实源。MCP plugin、GUI、脚本和人工 CLI 都不应该各自实现一套分块、重试、checkpoint 和 digest 逻辑；它们应该复用同一个后台上传队列。MCP local bridge 的职责是把智能体给出的本地路径、workspace 目标和元数据转换成 `pact-client upload enqueue` 请求，然后把 job id、进度、失败原因和最终 asset refs 回传给 MCP 调用方。

### Client Runtime Bootstrap

客户端首次连接、能力过期或本地没有客户端时，主动向服务端请求运行时计划和裁剪包：

```text
client bootstrap request
  -> clientUid
  -> os / arch / libc
  -> availableCommands: rsync, ssh, scp, sftp
  -> requested modules: upload, mcp-local-bridge, connectors, cache
  -> transfer profile: bytes, file count, directory, incremental
  -> server returns trimmed module plan, pull manifest, and transport plan
```

服务端返回的是裁剪后的模块 manifest，而不是要求终端用户拉完整服务端仓库。模块分层为：

| 模块 | 职责 |
| --- | --- |
| runtime framework | 模块安装、签名校验、版本协商和自更新框架 |
| pact-client-cli | CLI、配置、RPC、upload session 和基础命令 |
| clientd | 后台队列 worker、进度事件、重试和暂停恢复 |
| upload queue | `enqueue`、checkpoint、manifest digest、job polling |
| mcp-local-bridge | stdio/local bridge，把 MCP 文件意图转成本机队列任务 |
| transport adapters | local-copy、rsync、scp、sftp、HTTP upload session、MCP inline |
| connector/cache modules | 邮件、本地知识缓存、外部 connector 等按需下发能力 |

动态裁剪规则是：框架和 `pact-client-cli` 必选；上传能力请求会带上 `clientd`、`upload queue` 和 `checkpoint-http-upload`；MCP 本地文件上传请求会带上 `mcp-local-bridge`；connector、mail、cache 等能力只在客户端声明需要时加入。

MCP 必须支持一个从服务端拉取客户端的操作。该操作不是“下载完整客户端”，而是按请求能力拉取经过裁剪的 client runtime bundle：

```text
client_runtime.bootstrap.pull
  -> request: client profile, requested modules, transfer profile
  -> response: selected modules, artifact refs, digests, signatures, delivery metadata
  -> connector downloads artifacts
  -> connector verifies signatures and digests
  -> connector installs modules under local client runtime root
  -> connector starts or refreshes local bridge
```

所有下载模块必须由服务端发布 manifest 提供 artifact id、版本、digest、签名和交付信息。客户端必须先校验签名和 digest，再启用模块。bootstrap plan 可以先返回 manifest-only 计划；bootstrap pull 首版返回 inline manifest bundle，不伪造二进制 URL，实际二进制发布由 release 或 capability package lifecycle 填充。

### Transport 降级顺序

上传 transport 是数据面优化，不是权限绕行。所有 transport 最终都必须回到 Workspace API 的资产登记、策略裁决、Operation Ledger、Checkpoint Tree 和 audit。

候选顺序：

1. `local-copy`：客户端和服务端声明共享文件系统时使用，适合本机同进程或受控挂载目录；它仍然必须把真实 bytes 深拷贝到 Pact staging/CAS，不能保存共享路径引用或零拷贝引用。
2. `rsync-over-ssh`：客户端存在 `rsync` 和 `ssh`，服务端声明 `rsync` 和 `ssh` 可用时启用，适合目录、增量、大文件和失败重试。
3. 小文件 `scp`：客户端存在 `scp` 和 `ssh`，服务端声明 `scp` 和 `ssh` 可用，且是小的单文件时启用。
4. `sftp`：客户端存在 `sftp` 和 `ssh`，服务端声明 `sftp` 和 `ssh` 可用时启用，适合没有 rsync 但需要稳定传输的文件。
5. `pact-http-upload-session`：标准兜底，使用 Pact 现有 upload session、分块、checkpoint、offset realignment、manifest digest 和后台队列。
6. `mcp-inline-content`：只用于极小文本或少量小文件兼容场景，不能作为目录或大文件上传方案。

不能写成“Linux 默认有 rsync”。`rsync`、`scp`、`sftp` 都必须由客户端运行时探测并声明，同时服务端也必须声明相应能力。任一侧缺失时，计划中必须给出 blocked reason，并退回下一个候选。

### 安全边界

- MCP grant 只表达调用者能发起什么操作；native transport 还必须经过 workspace policy 和 storage policy。
- 本机 bridge 不接受任意 shell 字符串，只接受结构化任务：本地路径、目标 workspace、目标目录、元数据、传输偏好和幂等 key。
- `rsync/scp/sftp` 命令必须由 adapter 以参数数组构造，禁止拼接 shell。
- 远端落点必须是服务端分配的 staging area，不能让客户端写任意服务端路径。
- 服务端必须校验 manifest、文件大小、digest、路径归一化结果、quota、policy 和最终 asset metadata。
- upload job、transport decision、checkpoint id、native command adapter、失败原因和 retry 结果必须写 audit。

### 状态和幂等

客户端上传队列至少持有：

- `checkpointId`
- `uploadSessionId`
- `workspaceId`
- `sourceManifestDigest`
- `transportPlanId`
- `selectedTransport`
- `fallbackOrder`
- `bytesTransferred`
- `offset`
- `fileDigests`
- `jobStatus`
- `lastError`

服务端 upload session 是可恢复上传事实源。native transport 只负责把字节移动到受控 staging area；最终提交仍必须通过同一个 manifest validate/commit 流程，避免 `rsync` 成为绕过权限、审计或去重的隐形写入口。

### 分阶段验收

第一阶段只落设计和协议：明确 bootstrap 请求/响应、模块目录、transport 降级规则、安全边界和验收脚本。

第二阶段落服务端 bootstrap plan/pull：提供 HTTP/RPC/MCP tool 入口，`plan` 返回裁剪模块计划、transport candidates、blocked reason 和 manifest-only artifact refs；`pull` 返回裁剪模块 artifact refs、digest、签名状态和 inline manifest bundle。

第三阶段落 MCP local bridge：bridge 调用 `pact-client upload enqueue`，复用已有后台队列和 upload session checkpoint，MCP 只返回 job handle 和进度查询入口。

第四阶段落 native transport adapters：先 `rsync-over-ssh`，再小文件 `scp` 和 `sftp`，每个 adapter 必须能降级到 `pact-http-upload-session`。

第五阶段落发布链路：release/capability package 产生带签名和 digest 的 runtime modules，客户端按需拉取、校验和启用。

## 代码贡献双路线：Workspace 与 Gerrit

Pact 的 workspace 能力必须保留，Gerrit 能力也必须保留。它们不是互相替换的模式，而是两条由同一个控制面治理的路线：

| 路线 | 适用对象 | 权威状态 | Pact 职责 |
| --- | --- | --- | --- |
| Workspace route | 文档、知识、Skill、工具、脚本、报告、上下文材料、样例文件、非合并目标资产 | Workspace Asset、Operation Ledger、Checkpoint Tree | 资产治理、权限、快照、贡献统计、上下文暴露和恢复 |
| Gerrit route | 源代码、patch、仓库变更、需要 review/submit/merge 的代码文件 | Git repository + Gerrit change | 路由决策、策略裁决、Change 关联、审计、状态同步和 fallback 治理 |

客户端接口不能只暴露“上传文件到 workspace”这一种目标。上传目标必须先经过 target compatibility：

```text
client intent
  -> classify payload kind
  -> resolve target compatibility list
  -> policy decision
  -> choose Gerrit route for code change
  -> choose Workspace route for governed asset
  -> record route decision and fallback reason
```

兼容目标至少包括：

- `workspaceAsset`：普通工作空间资产。
- `workspaceContribution`：知识、Skill、工具、脚本、文件、规则、专家意见等贡献资产。
- `gerritChange`：需要进入代码评审的仓库变更。
- `localGitWorktree`：Gerrit push 前的本地准备区，用于 apply patch、格式化、测试、生成 commit 和 Change-Id。
- `externalVcsRef`：外部仓库、上游镜像或只读代码引用。

路由规则：

- 当 `payloadKind=sourceCode | patch | gitDiff | repositoryChange`，并且目标仓库已登记、主体具备上传权限、分支策略允许 review 时，默认进入 Gerrit route。
- 当代码内容只是知识证据、教程片段、错误日志、报告附件或临时分析材料时，可以进入 Workspace route，但必须标注为 `sourceCode` 或 `file` 的非合并资产。
- 当 Gerrit 不可用、仓库未登记、权限不足或策略要求人审时，系统生成 `codeChange.fallback`，把 patch/diff 作为受控 proposal 或 artifact 暂存到 workspace，不直接发布为可合并资产。
- 当同一次任务同时包含代码和文档时，代码部分进入 Gerrit route，设计说明、测试报告、截图和运行记录进入 Workspace route，并通过同一个 `operationScope` 关联。

Gerrit route 的最小状态模型：

```text
CodeChange {
  codeChangeId
  workspaceId
  targetId
  repositoryId
  repositoryRef
  branch
  localWorktreeRef
  changeSetId
  commitRefs
  changeId
  changeRef
  gerritChangeUrl
  patchSetRefs
  reviewStatus
  submitStatus
  routeDecision
  fallbackReason
  uploadReceipt
  auditId
  createdAt
  updatedAt
}
```

Gerrit route 必须遵守这些边界：

- Gerrit 保存代码 diff 和 review 历史；Pact Codespace registry 保存治理元数据、target registry、changeSet、引用、hash、权限裁决、upload receipt、status projection、审计和 checkpoint。
- Pact 可以调用本地 git 工具准备 commit、检查 diff、生成 Change-Id、执行测试和 push `refs/for/<branch>`，但不能把裸 git push 暴露给任意智能体。
- Gerrit change 状态必须同步回 Workspace projection，让控制台能按 workspace、任务、主体、仓库、分支和 review 状态过滤。
- Gerrit 的 review comment、submit、abandon、rebase 和 merge 结果都要形成 Operation Ledger event 和 checkpoint node。
- 代码 review 失败、push 失败或策略拒绝时，系统必须留下可解释的 `fallbackReason`、`policyDecision` 和 `auditId`。

这个设计的核心是：代码走专业代码评审系统，workspace 继续承担公共资产治理。客户端需要上传代码时，默认被引导到 Gerrit；但所有路线选择、权限、审计、状态同步和跨资产关联仍由 Pact 控制。

## 知识位置

知识不是独立资产仓库，而是公共工作空间可用状态的一部分。Pact 的知识能力负责把资产型资料转成智能体可安全引用的 evidence runtime。

知识分三层：

1. `raw-corpus-construction`：原始语料建构和格式转换。
2. `knowledge-index-construction`：canonical evidence/index，权威检索和证据回读。
3. `knowledge-distillation`：有损蒸馏背景，只供上下文和交付使用，不能替代 evidence。

架构图中这三层作为左侧纵向 pipeline 表达，自下而上为原始语料、知识索引、知识蒸馏；右侧的 AgentLibrary / 图书馆与三层高度相等，表示它是面向智能体的等高访问面，而不是第四层知识加工流程。

详见 `docs/KNOWLEDGE-GOVERNANCE.md`。

## 智能体接入边界

本地智能体可以：

- 读取 workspace context
- 领取或创建 task
- 搜索 evidence
- 读取受控 memory
- 上传 artifact
- 提交 observation
- 创建 proposal
- 请求 permission
- 回传 trace
- 请求 context compression

本地智能体不能：

- 直接覆盖 canonical evidence
- 直接改写 decision
- 绕过 policy 读取敏感 source
- 绕过 operation ledger 修改资产
- 把私有 memory 当作公共事实
- 用裸数据库路径替代公开 API

## 上游和后端定位

如果和 OpenClaw 配合，Pact 是服务端上游：

- Pact 下发任务、上下文、证据、权限和输出契约。
- OpenClaw 在本地执行浏览器、文件、桌面、shell 和通用任务。
- OpenClaw 回传 observation、artifact、trace 和 proposal。
- Pact 验收结果、生成快照、维护 evidence 和 audit。

这个形态也适用于其它本地智能体。Pact 不关心对方是什么 agent，只关心它是否遵守 Workspace API 和资产治理协议。

## 验证入口

架构相关变更至少运行：

```bash
npm run server:verify:architecture-patterns
npm run server:verify:knowledge-architecture-governance
npm run server:verify:platform-layout
npm run server:verify:tool-management
npm run server:verify:agent-workspace
```

## 架构演进与长期提升规划 (Architecture Evolution)

在当前“治理优先、安全审计闭环”的 P0/P1 基线之上，随着并发量、接入智能体数量以及数据规模的增长，架构在以下几个维度预留了演进空间，这些改进思想将在后续的迭代中逐步落地：

### 1. 架构可扩展性：控制面与数据面的深度解耦 (Control/Data Plane Separation)

- **当前状态：** Node.js 服务端兼顾了治理控制（鉴权、账本维护）与重型数据处理（文档解析、信息切分）。
- **演进方向：** 显式分离控制面与数据面。Node.js + SQLite 作为控制面（Control Plane），专注于极度轻量的状态机流转、鉴权与生成 Token/Ticket。将 CPU/内存密集型的任务（如 PDF/OCR 解析、大型文档的动态切分、大模型 Context 压缩）剥离为独立的可水平扩展的 Worker 集群（Data Plane）。

### 2. 智能体协同范式：从“主动轮询”到“事件订阅” (Reactive Collaboration)

- **当前状态：** 智能体通过 MCP 客户端主动请求（Pull）工作空间状态，多智能体协同存在信息延迟。
- **演进方向：** 强化 Pact 作为“事件中心（Event Hub）”的角色。引入受权限控制的 Pub/Sub 机制。当公共空间的资产、权限或状态发生变更并产生新 Checkpoint 时，系统根据 `authorizationOverlay` 实时向有权限的智能体推送“状态失效”或“资产更新”信号，从而实现真正的响应式多智能体协同。

### 3. 审计存储优化：读请求的“逻辑入树”与时序聚合 (Read Node Aggregation)

- **当前状态：** 为了极致审计，所有读请求（Search, Read, Check Permission）均物理生成 Checkpoint Node。在高并发下可能导致 SQLite 写瓶颈及树结构噪声。
- **演进方向：** 保持 100% 审计的底线不变，但在存储结构上进行优化。在特定的任务会话（Task Session）内，将同主体的高频冗余读取在内存中进行时序聚合（Temporal Aggregation），并在任务节点提交时生成单一的“聚合读节点（Aggregated Read Node）”。底层存储可将读日志下沉至专门的高吞吐时序引擎，核心 SQLite 树仅保留索引指针。

### 4. 冲突治理升级：引入“语义合并” (Semantic Merging)

- **当前状态：** 冲突处理默认降级为 `merge proposal`，依赖人工或更高阶干预。
- **演进方向：** 减少协作阻塞。针对不同资产类型引入语义合并策略：对于结构化配置（JSON/Table）采用预定义的自动合并规则；对于知识性文本，可引入“合并评审大模型（Merge-Reviewer LLM）”进行后台静默合并，仅在置信度过低时才提升为需要人工干预的阻塞型 Proposal。

### 5. 权限模型演进：动态上下文权限控制 (Context-Aware Dynamic Policies)

- **当前状态：** 主要依赖基于身份和目标的静态策略（RBAC/ABAC）。
- **演进方向：** 引入更动态的降级与风控机制。例如“预算驱动降级”：当智能体 Token 预算吃紧时，系统自动将长文档的 `read` 权限临时降级为仅提供蒸馏摘要的 `metadataOnly`；或“风险传播冻结”：当监测到某智能体产出质量极差时，系统自动挂起其将内容转为公共贡献（Publish）的权限，直至人工复核。

## 核心工程原则与开发守则 (Core Engineering Principles)

Pact 的目标是从少数几个智能体平滑过渡到企业级规模，但这并不意味着我们要在初期堆砌过度复杂的架构。为防止“过早优化（Premature Optimization）”带来沉重的运维负担（DevOps Tax），所有开发必须遵循 **“逻辑隔离先行，物理拆分延后”（Logical Separation over Physical Separation）** 即“模块化单体（Modular Monolith）”的原则。

### 1. 接口与契约先行，把实现藏起来 (Interface First)

虽然系统早期可能只是在一个 Node.js 进程里执行同步或简单的异步操作，但组件间的交互必须通过严格定义的领域接口，严禁直接引用内部实例细节或裸调数据库。
- **守则：** 即使是本地方法调用，也必须抽象为如 `TaskQueue.submit(type, payload)` 或 `AgentGateway.invoke()` 的形式。底层实现初期可以是简单的 `setTimeout` 或内存队列，以确保未来剥离为独立 Worker 服务或引入分布式消息队列时，业务调用方代码无需修改。

### 1.1 三大兼容层归口 (Compatibility Ownership)

新增兼容能力必须先归入三大兼容层之一：

- `agent-client-mcp-compatibility`：智能体客户端、MCP 插件、stdio/HTTP bridge、client runtime bootstrap 和本机发现安装。
- `external-service-compatibility`：Docker、GitHub、Gerrit、Mailbox、外部知识库、模型 provider、向量库、图数据库、云盘和业务系统。
- `pact-internal-compatibility`：Pact 内部模块、mount、资源操作语义、能力包生命周期、运行时环境和状态边界。

`pact-internal-compatibility` 内部可以细分为 module contract、resource operation、capability lifecycle、runtime environment 和 state boundary，但对外统一作为 Pact 内部兼容层，不再把内部 mount、adapter、connector、runtime helper 混写成多套顶层概念。

### 2. 构建状态存储的“防腐层” (Anti-Corruption Layer)

即使系统初期并发量很低，单节点 SQLite 就能满足所有请求，也绝不允许业务逻辑代码直接拼写 SQL 去操作核心的 Checkpoint Tree 或 Operation Ledger。
- **守则：** 所有的状态变更和读取记录必须通过统一的领域服务网关（如 `OperationLedger.append()` 或 `AuditLogger.recordAccess()`）进行。这层防腐隔离使得未来能在底层无缝插入内存 Buffer、批量合并（Batch Flush）或更换时序数据库，而不会污染业务控制流。

### 3. 事件驱动的本地化 (Local Pub/Sub)

系统架构旨在支持智能体的响应式协同，但在初期不要引入外部的消息中间件（如 RabbitMQ）或复杂的集群架构。
- **守则：** 采用进程内原生事件总线（如 Node.js 原生的 `EventEmitter`）来实现事件驱动。在核心业务路径上（如生成了新的 Checkpoint 或资产权限变更时）发布定义明确的事件 Topic（如 `workspace.asset.updated`）。订阅方在进程内存中监听，明确预留出未来切换为外部集中式 Pub/Sub 服务的“架构插槽”。

### 4. 容忍“半自动”，保留“降级口” (Graceful Degradation)

不要为小概率的并发冲突或极端的语义合并场景去设计庞大且脆弱的自动仲裁算法。
- **守则：** 在遇到资产并发修改冲突且难以自动解决时，系统应直接降级并抛出 `Merge Proposal` 让流程“挂起”，转交人工或指定的高权限 Agent 处理。保持主干写入流程的极简与安全闭环：`Diff -> 发现冲突 -> 产生 Proposal -> 挂起等待 -> 收到决策 -> Apply`。未来只需在挂起阶段旁路插入更智能的 Reviewer 算法进行静默仲裁，而无需重构系统的核心状态机。
