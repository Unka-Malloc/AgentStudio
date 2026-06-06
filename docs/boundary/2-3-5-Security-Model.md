# 2-3-5 Security Model

## Metadata / 元数据

- Last updated: 2026-06-07
- Status: Current boundary reference
- Scope: 2-3-5 Security Model.
- Staleness check: Scanned on 2026-06-07; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 Pact 的安全治理总模型：两条边界、三个环境、五个对象。

该模型用于统一后续权限、连接器、客户端运行时、应用服务器接入、审计和生产门禁设计。任何新能力只要跨过客户端 MCP 入口或服务端 API 出口，都必须能说明它属于哪个环境、穿过哪条边界、命中哪些对象，以及最终由哪些平台运行时内部事实源裁决。

Security Model 的显式能力词表至少包含：准入、身份、权限、行为、密钥、凭据、风险。它们不是新增的第六类对象，而是每个跨边界接口、adapter、connector、mount 和 tool/skill 执行路径必须声明的安全控制项。

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

- `server/platform/common/security/governance/security-governance-constants.mjs`：模型版本、边界 ID、环境 ID、对象 ID。
- `server/platform/common/security/governance/boundaries.mjs`：两条安全边界定义。
- `server/platform/common/security/governance/environments.mjs`：三个运行环境定义。
- `server/platform/common/security/governance/objects.mjs`：五个对象定义。
- `server/platform/common/security/governance/security-governance-model.mjs`：2-3-5 模型装配、查询和完整性检查。
- `server/platform/common/security/governance/control-map.mjs`：对象控制项装配工具。
- `server/platform/common/security/governance/*/controls.mjs`：每个边界或平台自我治理的控制项汇总。
- `server/platform/common/security/governance/client-boundary/<object>.mjs`：客户端 MCP 入口按对象拆分的真实控制项，例如 `client-boundary/identity-admission-authentication.mjs`。
- `server/platform/common/security/governance/external-service-boundary/<object>.mjs`：服务端 API 出口按对象拆分的真实控制项，例如 `external-service-boundary/permission-behavior-policy.mjs`。
- `server/platform/common/security/governance/platform-self-governance/<object>.mjs`：平台运行时自我治理按对象拆分的内部控制项，例如 `platform-self-governance/audit-fact-verification.mjs`。
- `server/scripts/verify-2-3-5-security-model.mjs`：模型、文档和分层入口一致性验证。

## 核心原则

- 两条边界都是外部边界。平台运行时自我治理不是第三条外部边界，而是平台运行时内部支撑这两条边界的治理能力。
- 三个环境不是权限主体。终端智能体、平台运行时、应用服务器只是安全治理的运行位置和信任假设。
- 权限内核只认 Capability。组织、用户、角色、Owner、智能体、provider account、外部 scope 都不得进入 Capability Kernel。
- Binding Guard 处理调用身份绑定。`opaqueKey + namespace/user/agent/client` 是否匹配由 Binding Guard 裁决，不由 Capability Kernel 裁决。
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

- OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf 等本地智能体或 agent client。
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

2-3-5 Security Model 是上层安全治理架构；Capability Kernel 是其中“权限与行为策略”的核心裁决组件之一。

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
