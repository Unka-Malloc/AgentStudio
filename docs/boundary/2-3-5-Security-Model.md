# 2-3-5 Security Model

## Metadata / 元数据

- Last updated: 2026-06-13
- Status: Current boundary reference
- Scope: 2-3-5 Security Model.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 Pact 风控模型的风险归属轴：两条边界、三个环境、五个对象。

该模型用于统一后续权限、连接器、客户端运行时、应用服务器接入、审计和生产门禁设计。任何新能力只要跨过客户端 MCP 入口或服务端 API 出口，都必须能说明它属于哪个环境、穿过哪条边界、命中哪些对象，落到哪个风控生命周期控制点，以及最终由哪些平台运行时内部事实源裁决。

Security Model 的显式能力词表至少包含：准入、身份、权限、行为、密钥、凭据、风险。它们不是新增的第六类对象，而是每个跨边界接口、adapter、connector、mount 和 tool/skill 执行路径必须声明的安全控制项。

每个安全控制项必须注册为 Risk Control Point，并用 JS/ESM 声明式 Risk Control DSL 描述。第一版核心原语是 `control`、`owner`、`gate`、`enforcedBy`、`factSource`、`binds`、`decision`、`failsClosed`、`evidence` 和 `verifiedBy`；控制台配置只能投影这些注册项，不能替代注册表。

## 总览

```text
终端智能体
  <-> 边界 1：客户端 MCP 入口
平台运行时
  <-> 边界 2：服务端 API 出口
应用服务器
```

五个对象同时适用于两条边界：

| 对象 | 终端智能体 -> 平台运行时（客户端 MCP 入口） | 平台运行时 -> 应用服务器（服务端 API 出口） |
| --- | --- | --- |
| 身份与准入认证 | client、agent、user、device、MCP grant、opaque key 绑定 | provider account、OAuth、API key、service account、secretRef、tenant 映射 |
| 权限与行为策略 | operation、tool、skill、workspace、dataClass、egress、高风险确认 | provider scope、读写删同步权限、外部副作用审批、Capability 到 provider scope 映射 |
| 数据与状态语义 | 上传、下载、context、memory、export、asset 状态、client lifecycle、路径安全 | import、export、sync、mirror、credential lifecycle、connector lifecycle、etag/version、durable id、真实持久化状态 |
| 流量与资源管理 | QPS、并发、上传速率、队列、quota、上下文大小 | provider 限流、重试、熔断、模型 token 成本、API 成本、同步频率 |
| 审计与事实验证 | receipt、loan、denied request、trace、checkpoint、recovery evidence | provider receipt、webhook 证据、external failure evidence、合规保留 |

生命周期状态属于数据与状态语义。安装、授权、升级、禁用、撤销、过期、解绑、卸载、轮换、清理、恢复和迁移都必须被建模为状态迁移，而不是审计类别本身。审计与事实验证只负责证明这些状态迁移曾经发生、由谁触发、结果是什么。

安全能力词表与五个对象的映射：

| 安全能力 | 归属对象 | 边界含义 |
| --- | --- | --- |
| 准入 | O1 身份与准入认证 | 判断 client、agent、user、device、provider、tenant 是否允许进入边界。 |
| 身份 | O1 身份与准入认证 | 建立 user/agent/client/provider account 与 namespace、workspace、tenant 的可信绑定。 |
| 权限 | O2 权限与行为策略 | 把请求映射到 Capability、operation、tool、skill、workspace、provider scope 和 dataClass。 |
| 行为 | O2 权限与行为策略 | 约束 read/write/delete/export/context/memory/external side effect 等操作语义。 |
| 密钥 | O1 身份与准入认证、O3 数据与状态语义 | 管理 opaque key、sealing key、keyring-backed state、轮换、撤销和失效状态。 |
| 凭据 | O1 身份与准入认证、O3 数据与状态语义 | 管理 OAuth、API key、PAT、service account、secretRef、endpointRef 和 provider credential lifecycle。 |
| 风险 | O2 权限与行为策略、O4 流量与资源管理 | 管理高风险确认、外部副作用、破坏性操作、模型/API 成本、降级和熔断。 |

## 安全领域

Security Model 只覆盖安全领域，不承载 API 对接、数据链路或业务能力定义。安全领域固定拆成七类：

| 安全领域 | 责任 | 不属于该领域的内容 |
| --- | --- | --- |
| 准入 | 判断客户端、智能体、用户、设备、provider、tenant 是否允许进入边界。 | 具体 API 路由、provider SDK 选型、文件解析流程。 |
| 身份 | 建立 user、agent、client、device、provider account、tenant、namespace 的可信绑定。 | 业务对象建模、数据切分、搜索排序。 |
| 权限 | 裁决 subject 对 operation、tool、skill、workspace、asset、provider scope、dataClass 的可用范围。 | 外部接口字段映射、状态投影、报表聚合。 |
| 行为 | 约束读、写、删、导出、下载、上下文注入、memory write、模型调用、shell/process、外部副作用。 | adapter 生命周期、传输重试、索引构建。 |
| 密钥 | 管理 opaque capability key、sealing key、lookup key、keyring-backed state、轮换、撤销和失效。 | 外部 API URL、模型别名、运行时配置展示。 |
| 凭据 | 管理 OAuth、API key、PAT、service account、secretRef、endpointRef、provider credential lifecycle。 | provider 业务 schema、外部对象内容、同步 cursor 语义。 |
| 风险 | 管理高风险确认、破坏性操作、外部写入、数据出口、模型/API 成本、降级和熔断。 | 普通业务优先级、UI 排序、非安全性质的用户偏好。 |

安全领域的输出必须是可执行的裁决或可审计的事实：allow/deny、needsApproval、riskLevel、secretRef、binding result、credential status、denied reason、audit reference。不能只停留在说明性文档或 UI 展示。

代码入口：

- `server/platform/common/security/risk-control/model/`：风控模型领域版本身份、风险归属轴、生命周期 gate、边界、环境和对象定义；版本推进和迁移执行使用平台统一能力。
- `server/platform/common/security/risk-control/registry/`：Risk Control DSL、Registry、Definition Lifecycle、digest、reference validation 和 index。
- `server/platform/common/security/risk-control/catalogs/`：`enforcedBy`、`factSource`、`verifiedBy`、Evidence Store、Evidence Governance Profile 等可解析目录。
- `server/platform/common/security/risk-control/controls/`：Atomic Risk Control Point 定义。
- `server/platform/common/security/risk-control/paths/`：Risk Control Path 定义。
- `server/platform/common/security/risk-control/projections/`：生成 `controlsByObject`、console、doctor、docs 和 API 输出投影。
- `server/platform/common/security/governance/`：旧实现路径；本阶段完成标准要求全量迁移并移除，不能作为兼容 facade 或迁移期旧导入位置保留。
- `server/scripts/verify-risk-control-model.mjs`：Risk Control Validation Gate，以及 Platform Managed Migration 的风控领域 completion verifier；它替代并移除旧 `verify-2-3-5-security-model.mjs`，但不承担独立迁移执行。

## 核心原则

- 两条边界都是外部边界。平台运行时自我治理不是第三条外部边界，而是平台运行时内部支撑这两条边界的治理能力。
- 三个环境不是权限主体。终端智能体、平台运行时、应用服务器只是风控模型的运行位置和信任假设。
- 权限内核只认 Capability。组织、用户、角色、Owner、智能体、provider account、外部 scope 都不得进入 Capability Kernel。
- Binding Guard 处理调用身份绑定。`opaqueKey + namespace/user/agent/client` 是否匹配由 Binding Guard 裁决，不由 Capability Kernel 裁决。
- Risk Control Registry 是装配和验证事实源，不是请求时裁决引擎。Registry 无效时，相关风控能力必须在 build、verify、doctor 或 server boot 阶段 fail closed、degraded 或 blocked；请求路径仍由 Capability Kernel、Binding Guard、Policy、Approval、Execution、Audit 和 Recovery 各自裁决，并记录经过的 `controlId`。
- Risk Control 与 Capability Kernel 的版本推进、状态迁移、退役和 recovery 都必须使用平台统一版本能力、Platform Managed Migration 和 Migration Path Config；风控 Registry 和权限内核只能提供领域定义、合同引用、domainMapping、adopted verifier reference 和 verifier evidence，不能单独封装迁移 runner、兼容分支或版本 registry。
- Risk Control Operation Envelope 是现有 Intent Operation envelope 的风控证据段，不是第二套 operation 协议。它由 append-only Risk Control Gate Record 列表组成，承载 subject、intent、resource、environment、`controlId@definitionVersion`、digest、gate decision、reason、evidence、adopted `enforcedById@componentContractVersion + componentDigest`、adopted `factSourceId@factContractVersion + factSourceDigest` 和 time；可信 controlRef 必须由服务端风控路径追加，不能信任客户端自带字段。
- Risk Control Gate Record 必须组成严格的 operation-local hash chain。首条记录锚定 operation identity 和 input hash，后续记录必须连续链接前序 digest；缺失、重排、fork 或 digest mismatch 都会使该 operation 的风控证据链无效。
- Risk Control digest canonicalization 统一使用 canonical JSON、SHA-256 和 domain-separated prefix。`definitionDigest`、`storeDigest`、`profileDigest`、`evidenceLocatorId`、`operationAnchorDigest`、`recordDigest` 和 `evidenceDigest` 必须能被 verifier、doctor、audit 和 recovery 跨运行时复算。
- Risk Control Gate Record 的所有 evidence 都必须统一注册解析。无论大小、轻重或敏感度，每个 evidence item 都必须保存完整 Evidence Locator 和匹配的 `evidenceLocatorId`；locator payload 包含 `storeId@storeVersion`、`storeDigest`、`evidenceRef` 和 `evidenceDigest`，`storeId@storeVersion` 必须解析到 Evidence Store catalog。`classificationProfile`、`redactionPolicyProfile`、`retentionProfile` 都必须解析为 `profileId@profileVersion + profileDigest`，其中 `profileVersion` 使用 `v0.0.1:risk-control:evidence-profile:profile-schema-1:lifecycle-1:contract-1:revision-1` 形式；这些 profile 引用和 inline projection 不进入 locator identity，但必须由 `recordDigest` 覆盖；实际采用 profile 必须同时满足 Evidence Store 允许/默认 profile 合同和 Control Definition 最低治理 profile 要求。
- Risk Control Evidence Store registration 自身必须有 lifecycle、version 和 digest。`storeVersion` 使用 `v0.0.1:risk-control:evidence-store:schema-1:lifecycle-1:contract-1:revision-1` 形式；Evidence Store lifecycle 使用 `candidate`、`active`、`deprecated`、`retired` 四态；只有 `active` store version 可以被新建 Gate Record 选择，`deprecated` / `retired` 只用于历史验证和 recovery。
- `storeId` 是长期证据解释身份。同一 `storeId` 只能在 evidence authority、`evidenceRef` namespace 和 resolution meaning 兼容时复用；不兼容变化必须新建 `storeId`，不能只 bump `storeVersion`。
- Risk Control Migration Completion Verifier 是 Platform Managed Migration 的风控领域硬验收验证。只要仍存在旧 `security/governance` 生产导入、旧 verifier 权威入口、手写 `controlsByObject`/control map、Registry 外控制点事实源、未解析 `controlId@definitionVersion` 或 digest，就不能声明平台迁移完成。
- `controlId` 是长期审计身份，必须使用稳定 dotted ID，不得复用或静默改义。旧 control map 字符串只能作为 displayName 或 migration source，不能作为事实引用；dotted namespace 只服务可读性，不能被解析为 `owner`、`gate`、`enforcedBy` 或 `factSource`；控制点语义变化必须新建 `controlId`，旧控制点通过生命周期状态声明 deprecated、superseded 或终止关系。
- 旧 control map 字符串不是迁移单位。一个旧字符串如果覆盖多个 lifecycle gate、enforcing component、fact source 或可验证责任，必须拆成多条 Atomic Risk Control Point；迁移来源只用于追溯，不决定新控制点数量。
- 旧 label 如果表达组件、存储或事实权威，例如 Operation Ledger、Checkpoint Tree、Tool Management 或 Capability Kernel verify，必须先分类为 `enforcedBy` 或 `factSource` catalog entry；新 `controlId` 命名被治理的责任，不命名组件本身。
- Risk Control Definition Lifecycle 只描述控制点定义在 Registry 中的状态，不描述单次请求的 allow、deny、needsApproval、degraded 或执行结果。第一版状态集合是 `draft`、`candidate`、`active`、`deprecated`、`superseded` 和 `retired`；不提供 `disabled` 作为普通安全开关。
- Risk Control Definition Lifecycle 必须按显式迁移表执行。`candidate -> active` 必须通过 Validation Gate；`active -> superseded` 必须带 `supersededBy`；`deprecated -> active` 只允许兼容回滚且必须带 reason；`retired` 不可恢复；不允许 `active -> retired` 直接跳转。
- 同一个 `controlId` 同一时间只能有一个 `active` 定义。历史定义可以保留用于审计和恢复解释，但生产投影必须解析到唯一 active 定义。
- 每个控制点定义必须有 Risk Control Definition Version：`v0.0.1:risk-control:definition:model-1:dsl-1:lifecycle-1:control-1:revision-1`，并携带 canonical definition digest。trace、audit、doctor 和 recovery 必须记录完整 `controlId@definitionVersion` 与 digest。
- Risk Control Definition Digest 只覆盖影响风控语义和证据解释的 canonical 字段，例如 owner、gate、adopted enforcedBy reference、adopted factSource reference、adopted verifiedBy reference、binds、decision、failsClosed、evidence、supersededBy 和 lifecycle constraints；不覆盖 displayName、description、notes、docsUrl、UI grouping 或排序字段。
- Risk Control Point 必须是单 gate 原子控制点：一个主生命周期 gate、一个主 `enforcedBy` 和一个可验证风控责任。跨多个 gate 的高层流程必须拆成多个 `controlId`。
- Risk Control Path 可以把多个 active atomic controls 组合成端到端风控链路，用于 trace、doctor、console 和文档解释；Path 不执行裁决，不能替代 atomic control，也不能引用 inactive、retired 或无法解析的控制点。
- Risk Control Registry 的语义字段必须是可解析引用。`controlId`、`owner`、`gate`、`enforcedBy`、`factSource`、`verifiedBy`、Evidence Locator 和 Evidence Governance Profile 不能是自由字符串；显示名称和说明可以是自由文本，但不能参与风控语义。
- `enforcedBy` 和 `factSource` 必须引用不同目录，并使用 adopted versioned catalog reference，包含稳定 catalog ID、contract version 和 digest，不能使用裸 ID、代码路径、模块名、UI label 或显示名。前者回答“谁执行控制”，后者回答“可信事实从哪里来”；同一底层模块可以同时出现在两个目录，但注册语义不能混用。
- `verifiedBy` 也必须引用独立 verifier catalog，并使用 adopted versioned catalog reference，包含稳定 verifier ID、contract version 和 digest；脚本路径、测试名、命令、CI job、run ID 和输出 digest 只能作为 catalog metadata 或 verifier run evidence，不能作为语义引用。
- `enforcedBy`、`factSource` 和 `verifiedBy` catalog entry 使用 `candidate`、`active`、`deprecated`、`retired` 生命周期；新控制点定义、新 Gate Record 和新 verifier evidence 只能选择 active version，deprecated / retired 只用于历史解析和 recovery；不提供 `disabled`，运行时不可用必须表达为 health、degraded 或 blocked。
- 普通业务 DB 不是安全事实源。业务 DB、可见 DB、agent 可写 DB、JSON 运行态文件只能作为展示、申请单、审计投影或缓存。
- `file fallback` 是可用性方案，不是强安全边界。它必须标记 degraded，不得伪装成 keyring-backed 或企业级隔离。

## 两条边界

### B1. 客户端 MCP 入口

定义：

终端智能体发起请求、上传数据、下载数据、调用工具、读取证据、注入上下文或提交贡献时，都会穿过这条边界进入平台运行时。平台运行时必须在这条边界上判断调用者是谁、凭据是否有效、请求是否被授权、数据是否可进入或离开公共工作空间、以及该行为是否需要审计、回执、限流或人工确认。

边界两侧：

- 客户端侧：本地智能体、MCP connector、HTTP/stdio MCP client、`pact-client`、client runtime、local bridge、人工终端、本机脚本、上传队列、断点续传组件。
- 平台运行时侧：MCP service、Workspace API、Operation Gateway、Tool Management、Capability Kernel、Binding Guard、Operation Ledger、Audit、Checkpoint、CAS/Merkle state、Policy Engine。

信任假设：

- 终端智能体是部分可信或不可信环境。
- 客户端可以持有调用凭据，但不能被信任为权限事实源。
- 客户端声明的 user、agent、client、workspace、scope、dataClass、target 都必须由平台运行时重新验证。
- 客户端本机路径、本机文件系统状态、本机工具输出和本机 runtime 能力都必须被视为声明，而不是事实。

必须治理的问题：

- 这个客户端、智能体、用户和设备是否允许接入。
- 这个调用凭据是否允许被当前 user/agent/client/namespace 使用。
- 这个请求对应的 operation/tool/skill/capability 是否被允许。
- 这次上传、下载、导出、context injection 或 memory write 是否允许。
- 这次请求是否超过流量、容量、成本、风险或队列限制。
- 这次行为是否产生 receipt、loan record、denied request、checkpoint node 或 audit event。

### B2. 服务端 API 出口

定义：

应用服务器被平台运行时调用、同步、读取、写入、接收 webhook 或返回持久化结果时，都会穿过这条边界。平台运行时必须在这条边界上治理 provider 凭据、provider scope、外部副作用、真实持久化语义、同步一致性、外部成本、provider 失败和外部证据。

边界两侧：

- 平台运行时侧：Connector Runtime、SecretStorePort、Operation Gateway、Data Connector Governance、Tool Management、Model Routing、Audit、Checkpoint、StateCommit、Mirror Projection。
- 应用服务器侧：模型 provider、GitHub、Gerrit、云盘、邮箱、外部知识库、向量库、图数据库、对象存储、业务系统、外部 webhook source。

信任假设：

- 应用服务器是平台运行时管控之外的系统。
- 应用服务器返回的状态必须被校验、归一化、登记和审计。
- 应用服务器凭据不能进入普通配置、trace、export、context 或 checkpoint node。
- 应用服务器 scope 和 Pact Capability 不等价，必须有明确映射。
- mock/contract-mode 只能证明协议合同，不能被标记为真实 E2E 或 production ready。

必须治理的问题：

- 平台运行时是否持有有效、最小权限、可轮换的 provider 凭据。
- 当前 operation 是否允许调用该 provider 的对应 scope。
- 外部写入、删除、同步、发信、提交代码、创建 PR/change 等副作用是否需要审批。
- provider 返回的 id、etag、version、commit、reviewUrl、fileId、digest 是否足以证明持久化结果。
- 外部同步状态是 queued、staged、synced、committed、projected、cached 还是 contractVerified。
- provider 的限流、故障、重试、熔断、成本和审计是否受平台运行时控制。

## 三个环境

### E1. 终端智能体

定义：

终端智能体是平台运行时之外、通过客户端 MCP 入口主动发起操作的一侧。它包含智能体、人工终端、本机 bridge、MCP connector、client runtime、上传队列和本机工具执行环境。

典型组件：

- OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 等本地智能体或 agent client。
- MCP connector、stdio/HTTP MCP client、本机 discovery 和 local grant installer。
- `pact-client-cli`、client runtime、clientd、upload queue、checkpoint upload adapter。
- 本机文件系统、本机命令、本机缓存、本机 bridge、本机 runtime module。

治理定位：

- 它可以发起请求，但不能自行决定权限。
- 它可以声明身份，但必须被平台运行时认证和绑定验证。
- 它可以上传文件，但不能直接写平台运行时 canonical state。
- 它可以接收结果，但平台运行时必须控制结果出口、上下文暴露、下载和导出。

### E2. 平台运行时

定义：

平台运行时是安全治理的中心环境。它负责把客户端请求和应用服务器调用转换为受控 Operation、Capability 裁决、状态提交、审计证据和可恢复的工作空间事实。

典型组件：

- MCP service、Workspace API、Operation Gateway、Operation Dispatcher。
- Capability Kernel、Binding Guard、Console Auth、Tool Management、Operation Policy。
- SecretStorePort、Connector Runtime、Model Routing、Data Connector Governance。
- Operation Ledger、Audit、Checkpoint Tree、StateCommit、CAS/Merkle state、receipt、loan record。
- Production readiness gate、doctor、runtime logger、redaction policy、recovery package。

治理定位：

- 它是最终裁决和事实登记的位置。
- 它必须防止业务 DB、配置文件、grant projection 或 agent 可写数据成为权限事实源。
- 它必须把所有外部可见行为纳入 Operation、Audit、Checkpoint 或等价证据链。
- 它必须把降级模式标记清楚，不能把 file fallback、contract-mode、cached、projected 说成强安全或真实持久化。

### E3. 应用服务器

定义：

应用服务器是平台运行时之外、被平台运行时调用或向平台运行时回调的 provider 环境。它包括所有模型、代码平台、云盘、知识库、邮箱、向量库、图数据库、对象存储和业务 API。

典型组件：

- 模型 provider、embedding/rerank provider、OpenAI-compatible model gateway。
- GitHub、Gerrit、代码仓库、review system、CI/CD provider。
- Google Drive、OneDrive、Dropbox、对象存储、企业网盘。
- Dify、RAGFlow、外部知识库、向量库、图数据库、检索后端。
- 邮箱、业务系统、外部 webhook source、外部审计或合规系统。

治理定位：

- 它可以提供数据、计算和持久化结果，但不能绕过平台运行时的授权、审计和状态语义。
- 它的凭据必须由 SecretStore 管理，业务代码只能拿到 secretRef 或受控 handle。
- 它的状态必须转换为平台运行时可理解、可回放、可审计的 receipt、mirror projection、evidence、codeChange 或 external object ref。
- 它的失败、限流、成本和副作用必须进入平台运行时的治理模型。

## 五个对象

### O1. 身份与准入认证

对象定义：

身份与准入认证解决“谁或什么可以进入边界”的问题。它不等于权限授权；它只建立调用者、客户端、设备、provider account、凭据和租户映射的可信上下文。

客户端 MCP 入口真实治理项：

- client registration：记录 clientId、客户端类型、版本、安装目标、运行平台、能力声明、在线状态。
- agent identity：记录 agentId、agentProfile、目标匹配结果、默认 toolset、风险上下文。
- user/operator identity：记录 userId、operator、session、CSRF、控制台角色和操作入口。
- device/runtime identity：记录本机 device、client runtime bundle、runtime module、bootstrap plan 和 digest。
- MCP grant：记录 grantId、token 摘要、scope、toolset、workspace allowlist、targetMatch、过期时间。
- opaque key binding：由 Binding Guard 验证 `opaqueKey + namespace/user/agent/client` 是否匹配。
- token/session rotation：支持轮换、撤销、过期、禁用和审计。
- discovery trust：客户端发现结果必须经过 normalize、probe、版本校验和能力声明，不直接相信本机扫描结果。

服务端 API 出口真实治理项：

- provider registration：登记 provider 类型、adapter、account、tenant/org/project 映射和启用状态。
- provider account：记录 accountId、外部组织、外部 workspace/repository/drive/mailbox 映射。
- OAuth/PAT/API key/service account：所有真实凭据只进 SecretStore，以 secretRef 暴露。
- credential status：区分 missing、configured、expired、revoked、contractVerified、realE2EVerified。
- tenant mapping：明确平台运行时 tenant/workspace 与 provider tenant/org/project/repository/drive 的映射。
- webhook identity：校验 webhook 签名、source、event id、timestamp、replay window 和 schema。
- provider capability declaration：记录 provider 当前支持的 read/write/delete/sync/webhook/stream 能力。

平台运行时自我治理项：

- Console Auth、SecretStore、Binding Guard 和 Capability Kernel 是身份和凭据治理事实源。
- 普通 grant metadata、provider manifest、console projection 只能展示身份状态，不能单独放行。
- 所有凭据导出、trace、checkpoint、context bundle 都不得包含 secret value。

### O2. 权限与行为策略

对象定义：

权限与行为策略解决“允许做什么、禁止做什么、需要什么确认”的问题。它把准入后的身份上下文、请求意图、Capability、资源范围、风险级别和外部副作用统一到执行前裁决。

客户端 MCP 入口真实治理项：

- operation permission：每个请求必须映射到明确 operation 和 requestedCapability。
- tool/skill permission：工具和 Skill 执行必须经过 Tool Management grant、Capability Kernel 和 risk policy。
- workspace scope：请求必须落在允许的 workspace、project、asset、source、evidence 或 artifact 范围内。
- dataClass policy：未分类、高敏、受限数据必须限制 discover/read/export/context/memory。
- egress policy：download、export、context injection、memory write、external call 必须按出口裁决。
- high-risk confirmation：write、repair、shell/process、external side effect 等高风险行为需要 safety-confirm 或审批。
- capability discovery：`capabilities.list` 只能返回当前 grant 可见能力，不返回未授权目录。
- deny semantics：拒绝必须是治理结果，有 reasonCode，不应伪装成系统错误。

服务端 API 出口真实治理项：

- provider scope mapping：Pact Capability 必须映射到 provider 的 read/write/delete/sync/webhook scope。
- external side effect policy：发邮件、写云盘、提交代码、创建 PR/change、调用业务 API 必须单独裁决。
- destructive operation policy：delete、overwrite、force sync、credential revoke、mirror cleanup 必须更高风险级别。
- provider object scope：限制 repository、branch、drive folder、mailbox、knowledge base、collection、index、tenant。
- write target policy：外部写入必须明确 targetProvider、targetKind、targetRef 和 durable id。
- model policy：模型调用必须受 model routing、prompt/version、dataClass、cost budget 和 output policy 约束。
- connector conformance：外部 adapter 必须通过 schema、error mapping、permission prefilter 和 contract test。

平台运行时自我治理项：

- Capability manifest 是硬编码强约束，未知 Capability 必须拒绝。
- Capability Kernel 只裁决 `opaqueKey + requestedCapability`。
- Binding Guard 只裁决当前 key 是否允许被当前 namespace/user/agent/client 使用。
- Operation Policy、Tool Management、ABAC、risk policy 只能进一步收紧，不能绕过 Capability Kernel。

### O3. 数据与状态语义

对象定义：

数据与状态语义解决“数据是什么状态、是否真的保存、是否只是引用、处于哪个生命周期阶段、是否可以恢复”的问题。它防止把 queued、cached、projected、contractVerified、revoked、expired、degraded 等状态误说成 archived、committed、synced 或 active。

客户端 MCP 入口真实治理项：

- upload semantics：上传必须区分 queued、staged、archived、failed、rejected、deduplicated。
- file validation：校验 manifest、size、digest、MIME、extension、directory depth、path normalization。
- path safety：禁止路径穿越、任意服务端路径写入、危险 symlink、特殊设备文件、socket、命名管道。
- context semantics：区分 searchResult、evidenceRead、contextBundle、distillationInput、memoryWrite。
- export/download semantics：下载和导出必须产生目标、范围、digest、receipt 和审计。
- asset lifecycle：asset 必须有 source、dataClass、state、owner/workspace、retention、lineage、checkpoint。
- client lifecycle state：安装、授权、升级、禁用、撤销、过期、解绑、卸载和离线必须表达为可查询状态。
- local bridge semantics：local-copy、rsync、scp、sftp 都是 transport decision，不等于已进入 Pact canonical state。

服务端 API 出口真实治理项：

- import semantics：外部对象进入 Pact 后必须有 upstream id、version/etag、digest、source metadata。
- export semantics：外部写入必须返回 provider durable id，例如 fileId、commit、change、reviewUrl、messageId。
- sync semantics：同步必须记录 cursor、page token、delta state、conflict、tombstone、retry 和 final status。
- mirror semantics：mirror projection 不是 canonical state；必须能说明哪些内容是投影、缓存或可重建索引。
- contract-mode semantics：contractVerified 只代表接口合同通过，不代表真实凭据、真实写入或真实 E2E。
- persistence semantics：只有平台运行时 CAS/metadata commit 或 provider 持久化确认后，才能标记 archived/committed/synced。
- version semantics：外部 etag/version/digest 变化必须进入同步一致性和冲突治理。
- credential lifecycle state：凭据初始化、轮换、撤销、失效、scope 变化、恢复和禁用必须表达为状态。
- connector lifecycle state：adapter 启用、禁用、升级、conformance 结果和失败原因必须表达为状态。
- mirror cleanup state：provider 解绑后的 mirror、cache、projection、cursor 和 residual ref 清理必须表达为状态。

平台运行时自我治理项：

- 平台运行时 canonical state、Operation Ledger、StateCommit、CAS/Merkle state 是状态语义事实源。
- Checkpoint Tree 表达可恢复视图，但不能替代底层事实源。
- Recovery package、Capability Kernel state 和 Binding Guard state 的导出、导入、恢复、失效和迁移属于状态生命周期。
- API、控制台、日志和报告必须使用同一状态词表，不能对用户夸大状态。

### O4. 流量与资源管理

对象定义：

流量与资源管理解决“能用多少、什么时候用、失败后如何退避”的问题。它同时保护平台运行时、终端智能体、应用服务器、预算和用户体验。

客户端 MCP 入口真实治理项：

- QPS/burst：按 user、agent、client、grant、workspace 限制请求速率和突发。
- concurrency：限制并发 operation、并发上传、并发工具执行、并发解析任务。
- upload bandwidth：限制上传速度、chunk size、session 数量、重试频率、后台队列深度。
- storage quota：限制 workspace 容量、asset 数量、raw object 大小、export 包大小。
- context quota：限制 context bundle、memory write、distillation input、prompt token 和 evidence 数量。
- runtime distribution：限制 client runtime bootstrap 包大小、模块数量、版本下载频率和升级窗口。
- retry/backoff：客户端断点续传、bridge 启动和 operation reply 等都必须有幂等和退避策略。

服务端 API 出口真实治理项：

- provider rate limit：按 provider/account/tenant/object scope 记录限流和重试窗口。
- circuit breaker：provider 失败、凭据失效、超时、配额耗尽时必须熔断或降级。
- model cost：按 workspace/user/agent/model 记录 token、embedding、rerank、tool call 和 fallback 成本。
- API cost：记录云盘、代码平台、外部知识库、向量库和业务 API 调用成本或用量。
- sync frequency：控制全量同步、增量同步、mirror refresh、webhook replay 和 backfill 频率。
- batch policy：大批量导入、导出、重建和同步必须有窗口、暂停、恢复和限额。
- external retry：provider 写入、webhook 回放和同步失败必须幂等，避免重复副作用。

平台运行时自我治理项：

- Budget Policy、queue、durable workflow、performance capacity gate 是资源治理事实源。
- 限流和预算不能只做 UI 提示，必须在执行入口或调度层生效。
- 所有重试必须绑定 idempotencyKey、operationId 或 provider durable id。

### O5. 审计与事实验证

对象定义：

审计与事实验证解决“事后如何证明、如何复查、如何追踪责任”的问题。它不定义生命周期；生命周期由数据与状态语义定义。审计与事实验证只记录状态迁移、权限裁决、外部副作用和拒绝结果的证明材料。

客户端 MCP 入口真实治理项：

- access receipt：记录谁访问了什么、用哪个 grant、通过哪个 operation、获得了哪个结果范围。
- loan record：记录 evidence、asset、context 或 export 的借出范围、过期、撤销和跨 workspace 流转。
- denied request：记录拒绝原因、operation、tool、subject、tenant、workspace、reasonCode。
- trace/log redaction：trace 和日志必须脱敏 token、secret、cookie、API key、本机绝对路径和敏感正文。
- checkpoint node：读、写、导出、下载、工具调用、权限裁决和恢复动作都必须进入 checkpoint 或等价证据链。
- recovery evidence：客户端相关授权、binding、runtime 状态和已提交资产必须能恢复或明确不可恢复边界。

服务端 API 出口真实治理项：

- provider receipt：记录外部 object id、commit/change、fileId、messageId、digest、etag、version、timestamp。
- webhook evidence：记录 webhook event id、signature result、source、dedupe key、replay status 和处理结果。
- compliance retention：按 tenant/workspace/provider/dataClass 保留或清理审计、receipt、loan 和 export 记录。
- external failure evidence：限流、超时、provider outage、permission denied、schema drift 必须可追踪。

平台运行时自我治理项：

- Audit、Operation Ledger、Checkpoint Tree、runtime logger 和 production readiness report 是证据事实源。
- Recovery package 必须覆盖 Capability Kernel 和 Binding Guard，默认加密，不进入普通 trace/export/bundle。
- 审计导出必须执行 redaction policy，并保留足够字段用于证明 allow/deny 和外部副作用结果。

## 新能力设计检查清单

任何新增客户端能力、外部连接器、工具、Skill、上传路径、模型调用或同步任务，都必须回答以下问题：

1. 它穿过哪条边界：客户端 MCP 入口、服务端 API 出口，还是两者都穿过。
2. 它涉及哪几个环境：终端智能体、平台运行时、应用服务器。
3. 它需要哪些身份与准入认证事实源。
4. 它映射到哪些 Capability、operation、provider scope 和风险策略。
5. 它产生、读取或改变哪些数据状态；这些状态是否能被回读验证。
6. 它需要哪些 QPS、并发、容量、成本、重试和熔断限制。
7. 它产生哪些 receipt、loan、audit、trace、checkpoint、provider evidence。
8. 它有哪些生命周期状态；撤销、禁用、解绑、清理、恢复和迁移分别产生什么状态迁移。
9. 它是否错误依赖普通 DB、配置 JSON、缓存、projection 或 agent 可写文件作为安全事实源。
10. 它在 degraded file fallback、contract-mode、provider outage 或 client offline 时如何明确标记状态。

## 与权限内核的关系

2-3-5 Security Model 是风控模型的风险归属轴；Capability Kernel 是其中“权限与行为策略”的核心裁决组件之一。

关系如下：

```text
请求进入边界
  -> 身份与准入认证：确认 client/user/agent/provider/account/secretRef
  -> Binding Guard：确认 opaque key 是否允许被当前 namespace/user/agent/client 使用
  -> Capability Kernel：确认 opaque key 是否允许 requestedCapability
  -> Policy/ABAC/Risk：按 workspace/dataClass/egress/risk/provider scope 进一步收紧
  -> State/Audit/Checkpoint：登记状态生命周期、回执和证据
```

Capability Kernel 不处理用户、组织、角色、Owner、智能体、provider account、provider scope 或业务状态。它只处理 `opaqueKey + requestedCapability -> allow/deny`。其余对象由平台运行时的其他组件完成，但这些组件不能绕过 Capability Kernel 或把普通业务 DB 提升为最终权限事实源。

Capability Kernel 的 capability contract、sealed state schema、恢复包和状态迁移也必须走平台统一版本能力、Platform Managed Migration 和 Migration Path Config；权限内核只提供可验证合同和领域映射，不单独封装版本 registry、迁移 runner 或兼容分支。
