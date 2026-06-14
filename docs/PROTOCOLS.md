# Pact Protocol Boundaries

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: Pact Protocol Boundaries.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 Pact 的协议边界。协议层只描述请求、响应、事件、版本、权限、错误语义和兼容策略；业务实现、算法实现和存储细节不写进协议层。

## 目录 / Table of Contents

- [核心原则](#核心原则)
- [协议分组](#协议分组)
- [Middle Layer Strategy](#middle-layer-strategy)
- [Compatibility Strategy](#compatibility-strategy)
- [Workspace API](#workspace-api)
- [Workspace Event](#workspace-event)
- [Operation Protocol](#operation-protocol)
  - [Unified Checkpoint Tree Protocol](#unified-checkpoint-tree-protocol)
- [Backup Restore Protocol](#backup-restore-protocol)
- [Workspace Contribution Protocol](#workspace-contribution-protocol)
  - [Device MCP Hub](#device-mcp-hub)
- [Code Review Route Protocol](#code-review-route-protocol)
- [Workspace Governance Protocol](#workspace-governance-protocol)
- [Knowledge Protocol](#knowledge-protocol)
- [Asset Lineage Protocol](#asset-lineage-protocol)
- [Knowledge Access Protocol](#knowledge-access-protocol)
  - [Upstream Permission Demo Flow](#upstream-permission-demo-flow)
- [Context Bundle Protocol](#context-bundle-protocol)
- [Client Runtime Bootstrap Protocol](#client-runtime-bootstrap-protocol)
- [Strategy Management Protocol](#strategy-management-protocol)
- [Tool Management Protocol](#tool-management-protocol)
- [Agent Session Compatibility](#agent-session-compatibility)
- [Module Ecosystem Protocol](#module-ecosystem-protocol)
- [Executive Report Protocol](#executive-report-protocol)
- [Architecture Live Map Protocol](#architecture-live-map-protocol)
- [Sample Business Pack Protocol](#sample-business-pack-protocol)
- [Protocol Adapters](#protocol-adapters)
- [版本与兼容](#版本与兼容)

## 核心原则

- “两个问题，一个能力，三个兼容层”只定义产品问题域；协议边界统一使用 `agent-client-mcp-compatibility`、`external-service-compatibility` 和 `pact-internal-compatibility`。
- 核心协议面向 workspace state，不面向某个具体 Agent。
- 协议设计专攻中间狭窄地带：上游知识库太粗时做权限精加工，下游本地智能体太细时做共享工作空间。
- A2A、MCP、agent traffic gateway、OpenAPI、OpenAI-compatible endpoint、CLI SDK 都是 adapter，不是核心抽象。
- 本地智能体、控制台、CLI、脚本和人工操作者都必须通过公开协议操作公共空间。
- 接口日志不等于业务状态；workspace event 和 operation ledger 才是可复用、可恢复、可审计的事实记录。

## 协议分组

| 协议 | 责任 |
| --- | --- |
| `v0.0.1:workspace:core-1` | 公共工作空间 context、tasks、observations、artifacts、proposals、decisions、audit events。 |
| `v0.0.1:operation:core-1` | idempotency、policy check、dry-run、diff、snapshot boundary、apply、rollback。 |
| `v0.0.1:knowledge:core-1` | `knowledgeBase` mount、evidence pack、asset、search、export、external knowledge adapter。 |
| `v0.0.1:agent:context-bundle-1` | 面向本地智能体和短上下文模型的 context compiler / context compression。 |
| `v0.0.1:agent:client-runtime-bootstrap-1` | 最小 MCP connector 或客户端主动声明平台、命令、模块需求和上传规模，服务端返回裁剪后的 Pact client runtime 计划、可拉取 artifact refs 与 transport 降级顺序。 |
| `v0.0.1:agent:runtime-1` | Agent config registry、Agent Gateway config/registry/call、Model Probe、model routing health 和带 settings/model-library 投影的 gateway call provider。 |
| `v0.0.1:strategy:strategy-management-1` | 处理流程策略、智能体调用策略、切面路由策略、模型路由策略包装和工具调用策略预览；安全授权仍委托 `v0.0.1:risk-control:permissions-1`。 |
| `v0.0.1:tool:management-1` | Tool Management v1 catalog、grant、policy preview、execute、audit、metrics。 |
| `v0.0.1:tool:skill-management-1` | Tool/Skill Management provider，统一封装 Tool catalog/grant/runtime、MCP local grant、workspace ref 解析、MCP 可见 operation 和输出脱敏。 |
| `v0.0.1:risk-control:core-1` | subject、workspace、scope、grant、data class、secret ref、redaction、audit policy。 |
| `v0.0.1:risk-control:permissions-1` | 组合根注入的统一安全权限 provider，封装 console auth、operation authorization、authorization policy、authorization audit artifact、workspace asset policy 和 Tool/MCP grant 裁决。 |
| `v0.0.1:workflow:core-1` | 长任务、activity、checkpoint、retry、signal、timer、恢复和补偿语义。 |
| `v0.0.1:workflow:job-workflow-1` | 任务创建、列表、详情、checkpoint lookup、结果读取和重跑 provider；HTTP/RPC/console 不直接持有 job manager。 |
| `v0.0.1:storage:backup-restore-1` | 服务端数据目录备份、manifest、restore preview、确认恢复和恢复报告。 |
| `v0.0.1:storage:data-connector-governance-1` | 服务端数据连接器合同、OAuth refresh 策略、增量 cursor、mirror 冲突/清理、localQuery 禁远程和卸载验收。 |
| `v0.0.1:platform:performance-capacity-1` | 容量目标、benchmark runner、ingest/search/sync/distillation/cost 指标、失败注入和阈值门禁。 |
| `v0.0.1:knowledge:distillation-optimization-1` | 知识蒸馏持续优化报告，覆盖 prompt/baseline/dataset 版本、错误归因、趋势、人工审核和 canary/promote/rollback。 |
| `v0.0.1:platform:executive-report-1` | 管理层报告，聚合生产门禁、资产价值、评估、容量成本、trace 安全和风险决策。 |
| `v0.0.1:platform:architecture-live-map-1` | 架构活文档，链接核心架构节点、设计文档、服务端实现路径和生产门禁状态。 |
| `v0.0.1:platform:sample-business-pack-1` | 服务端样例业务包，物化邮件、PDF、PPT、Markdown 项目和外部知识库 compose 示例。 |
| `v0.0.1:tool:module-ecosystem-1` | 服务端模块模板、脚手架计划、生成、合同测试、CI 模板和 Tool/Skill 包 manifest 验收。 |
| `v0.0.1:asset:asset-lineage-1` | 多模态资产 raw object、page/slide、bbox、parser/model/OCR 版本、派生链和重解析计划。 |
| `v0.0.1:knowledge:access-1` | source-level knowledge permissions、accessMode、checkoutPolicy、controlledView、export 和 context injection 裁决。 |
| `v0.0.1:agent:library-1` | AgentLibrary / 图书馆的 library card、loanRecord、knowledgeAccessReceipt、share、checkout 和 revoke 语义。 |
| `v0.0.1:workspace:contribution-1` | 终端贡献资产、Skills、工具、脚本、专家意见、黄金规则、排行榜、资产贡献统计报表和贡献授权。 |
| `v0.0.1:platform:code-review-1` | 源代码上传目标兼容、Gerrit change 准备、push、review 状态同步、fallback 和审计。 |
| `v0.0.1:workspace:governance-1` | organization/project/dataClass/retention/legalHold、外部协作者、跨空间复制、共享授权和审计。 |
| `v0.0.1:storage:checkpoint-tree-1` | 统一 Checkpoint Tree：访问请求、文件变动、知识贡献、技能调用、权限裁决、diff、restore preview、restore commit 和按 operation scope 回撤。 |

### Security, Audit, and Trace Hardening

`v0.0.1:risk-control:permissions-1` 的裁决输入可以携带 `tenantId`、`workspaceId`、`dataClass` 和 `requestedEgress`。subject、console user、tool grant 或 agent profile 可以声明 `tenantId`、`allowedWorkspaceIds`、`allowedDataClasses` 和 `allowedEgress`；tenant、workspace、data class 或出口越界必须返回 denied decision，并写入 denied request audit。`owner` / `auth:admin` 可以跨 tenant 做管理操作，但普通 subject 不能借助 search、evidence、context bundle、export、tool call 或 memory write 绕过同一裁决。

审计和 trace 的服务端入口固定为：

- `auth.audit` / `GET /api/auth/audit`：按 operation、status、user、tenant 或 trace 查询 operation audit。
- `auth.audit.export` / `GET /api/auth/audit/export`：导出脱敏审计包；secret、token、cookie、API key 和本机绝对路径不得出现在导出内容中。
- `auth.audit.retention.get|set` / `GET|POST /api/auth/audit/retention`：读取或设置审计保留策略。
- `auth.audit.prune` / `POST /api/auth/audit/prune`：按保留策略清理过期审计。
- `auth.sessions.rotate` / `POST /api/auth/sessions/rotate`：轮换当前控制台 session token 和 HMAC-derived CSRF token，旧 session token 立即失效，并写入审计。
- `observability.trace.get` / `GET /api/observability/traces/:traceId`：按 traceId 聚合 operation audit span 和 authorization decision，作为本地 trace drill-down 的事实源。OpenTelemetry / OTLP 只是后续可选导出目标。

## Middle Layer Strategy

Pact 的协议不追求覆盖所有智能体协作场景，也不替代上游知识库。协议只把中间层两个问题做深：

1. `v0.0.1:knowledge:access-1` / `v0.0.1:agent:library-1`
   - 解决上游知识库太粗的问题。
   - 把上游资源加工成可发现、可读、可引用、可上下文注入、可导出、可借走或不可见的细颗粒度授权视图。
2. `v0.0.1:workspace:contribution-1` / `v0.0.1:workspace:core-1`
   - 解决下游本地智能体太细的问题。
   - 把终端贡献沉淀到公共工作空间，让知识、Skills、工具、脚本、文件、黄金规则和专家意见可以被发现、排行、授权、复用和撤销。

这两个方向共同构成框架的核心卖点：上游资源经过 Pact 后变细、变可控；下游本地智能体经过 Pact 后能共享部分资产和能力。

## Compatibility Strategy

三个兼容层不是“支持很多插件”，而是协议层的稳定承诺。任何 adapter、connector、mount、compatibility component 或 runtime bridge 都必须归入以下三层之一：

1. `agent-client-mcp-compatibility`
   - 面向智能体客户端和本机 MCP 插件，例如 OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、脚本型 agent 和人工 CLI。
   - 责任是客户端发现、MCP HTTP / stdio 兼容、可选 agent traffic/load gateway、grant pairing、local bridge、client runtime bootstrap、transport fallback、版本协商和工具列表稳定性。
   - 这一层只处理“客户端如何安全调用 Pact”，不直接实现外部业务服务、不直接读写 workspace 内部状态。
2. `external-service-compatibility`
   - 面向 Pact 进程外部的服务或系统，例如 Docker、GitHub、Gerrit、Mailbox、外部知识库、模型 provider、外部向量库、外部图数据库、业务系统和云盘。
   - 责任是服务认证、凭据引用、API/协议适配、远端状态同步、cursor、rate limit、webhook、mirror、错误归一化和服务侧能力发现。
   - 外部服务适配不能裸转发上游权限，也不能绕过 Tool Management、policy、Operation Ledger、Checkpoint Tree 和 audit。
   - `pact.serviceHub` 只暴露已注册、已授权、当前 grant 可见的外部服务调用和发现能力；外部服务注册、配置保存、密钥绑定、刷新和删除属于 operator/admin control plane，不能作为普通 MCP agent 的自助写入口。
3. `pact-internal-compatibility`
   - 面向 Pact 应用内部系统层面的可替换、可演进边界，是统一的对内兼容层。
   - 细分为：module contract compatibility、resource operation compatibility、capability lifecycle compatibility、runtime environment compatibility、state boundary compatibility。
   - 责任是内部 mount/module 合同、repo/drive/knowledge 等资源语义抽象、Tool/Skill 能力包生命周期、JRE/Tika/runner/cache 等运行时差异、Operation/Audit/Checkpoint 等状态边界稳定。

三层边界必须保持单向依赖：智能体客户端层调用 Pact 协议入口；外部服务层通过受控 operation 访问远端系统；Pact 系统层承载内部模块、治理、状态和运行环境兼容。Tool Management、Policy、Operation Ledger、Checkpoint Tree 和 audit 是跨三层的治理面，不单独作为第四个兼容层。

“两个问题，一个能力，三个兼容”只作为产品问题定义保留，不再作为协议或架构分层口径。协议分层统一使用 `agent-client-mcp-compatibility`、`external-service-compatibility` 和 `pact-internal-compatibility`；受管工作空间仍必须经过 Pact 管理软件，不能让智能体直接绕过兼容层改写公共状态。

## Workspace API

Workspace API 是本地智能体接入 Pact 的首选方式。OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、脚本型 agent 或人工工具都只需要遵守这个协议。

当前公开面分为两类。资源型 Workspace API 使用当前服务端事实路径 `/api/agent-workspaces`；协议 façade 使用 operation id 对应的 `/api/workspace/*` 路径，供 MCP / Tool Management / RPC 统一路由。旧的 `/api/workspaces/:workspaceId/...` 前缀不再作为新架构口径。

资源型 Workspace API：

```text
GET    /api/agent-workspaces
POST   /api/agent-workspaces
GET    /api/agent-workspaces/:workspaceId
DELETE /api/agent-workspaces/:workspaceId
GET    /api/agent-workspaces/:workspaceId/context
GET    /api/agent-workspaces/:workspaceId/context-bundle
POST   /api/agent-workspaces/:workspaceId/context-bundle/restore
GET    /api/agent-workspaces/:workspaceId/files
POST   /api/agent-workspaces/:workspaceId/files
GET    /api/agent-workspaces/:workspaceId/files/stat
GET    /api/agent-workspaces/:workspaceId/files/download
POST   /api/agent-workspaces/:workspaceId/files/write
DELETE /api/agent-workspaces/:workspaceId/files
POST   /api/agent-workspaces/:workspaceId/files/move
GET    /api/agent-workspaces/:workspaceId/locks
POST   /api/agent-workspaces/:workspaceId/locks
POST   /api/agent-workspaces/:workspaceId/profile
POST   /api/agent-workspaces/:workspaceId/sources
POST   /api/agent-workspaces/:workspaceId/share
POST   /api/agent-workspaces/:workspaceId/unshare
```

协议 façade：

```text
GET  /api/workspace/info
POST /api/workspace/files/upload
GET  /api/workspace/files
GET  /api/workspace/files/download
GET  /api/workspace/files/read
POST /api/workspace/files/write
POST /api/workspace/files/patch
POST /api/workspace/contributions/submit
GET  /api/workspace/contributions
GET  /api/workspace/contributions/leaderboard
GET  /api/workspace/contributions/stats
POST /api/workspace/contributions/report
POST /api/workspace/contributions/:contributionId/permission/request
POST /api/workspace/contributions/:contributionId/permission/grant
POST /api/workspace/code/target/evaluate
POST /api/workspace/code/change/prepare
POST /api/workspace/code/change/upload
POST /api/workspace/code/change/link
POST /api/workspace/code/change/status/sync
GET  /api/workspace/audit
GET  /api/workspace/operations/history
```

写入请求必须带：

- `workspaceId`
- `subject`
- `operatorId` 或 `agentId`
- `taskId`
- `traceId`
- `idempotencyKey`
- `intent`
- `inputRefs`
- `visibilityPolicy`
- `requestedScopes`
- `knowledgeAccessCard`

响应必须返回：

- `accepted`
- `operationId`
- `auditId`
- `policyDecision`
- `resultRef`
- `snapshotRef`
- `nextRequiredAction`

## Workspace Event

公共空间里的业务事实用 event 表达，而不是只依赖接口日志。

核心 event type：

- `task.created`
- `task.claimed`
- `task.updated`
- `observation.appended`
- `artifact.uploaded`
- `asset.download.requested`
- `asset.downloaded`
- `proposal.created`
- `proposal.reviewed`
- `decision.recorded`
- `evidence.attached`
- `permission.requested`
- `contribution.submitted`
- `contribution.previewed`
- `contribution.reviewed`
- `contribution.published`
- `contribution.used`
- `contribution.permission.requested`
- `contribution.permission.granted`
- `contribution.rank.updated`
- `code.route.evaluated`
- `code.change.prepared`
- `code.change.uploaded`
- `code.change.linked`
- `code.change.status.synced`
- `code.change.fallback.created`
- `context.bundle.generated`
- `access.requested`
- `access.granted`
- `access.denied`
- `file.changed`
- `skill.invoked`
- `operation.applied`
- `operation.reverted`
- `checkpoint.created`
- `checkpoint.restored`

event 必须 append-only。撤销、归档、合并和恢复都用新事件表达，不删除历史事件。

## Operation Protocol

所有受管 operation 都必须走 `v0.0.1:operation:core-1` 或对应领域协议，并先进入 Operation Scheduling Kernel。只有调度内核受理、分配 `operationId`、写入 `started` / `pending` 账本、完成策略裁决并返回执行许可的 operation，才是 Pact 的真实操作。这里不只包括改变 canonical workspace state 的写操作，也包括 API / RPC / MCP / CLI / 控制台入口、后台任务、workflow activity、队列状态变更、provider adapter 调用、webhook 处理、模型调用、工具执行、访问请求、权限拒绝、文件读出、列表、发现、权限检查、receipt 查询、审计查询、历史查询、checkpoint tree 查询、技能调用和上下文暴露，因为它们会改变审计、receipt、loan record、usage event、贡献统计、风险状态或外部事实。

Operation Registry 是目录和合同，不是执行许可。HTTP handler、RPC method、CLI command、MCP tool、控制台 handler、worker 和 provider adapter 都只能提交 intent envelope 给调度内核，不能直接调用业务 executor。未带内核准入印记的业务函数、provider side effect、状态写入或工具执行必须拒绝为 `operation_unmanaged` / `operation_not_scheduled`，只允许留下拒绝记录，不允许产生真实副作用。

Operation Ledger 是事实源。console log、tool audit、provider ledger、queue event、runtime log、trace span 和 readiness report 只能作为投影、回执、索引或报告，不能替代统一账本。写操作和外部副作用必须由调度内核先追加 `started` / `pending` ledger entry，再执行副作用；账本不可写时必须失败在副作用之前。读请求可以在任务会话内做高频聚合，但聚合结果仍必须可按 `operationId`、`traceId`、`subject`、`targetRef` 和 `reasonCode` 查询。

高危 operation 的统一审批也属于调度内核职责。`requiresConfirmation` 或 `confirm=true` 只能作为风险输入，不能直接等同于审批完成。需要人工确认或高风险审批时，调度内核必须把原 intent envelope 挂起为 `pending_operation`，写入 `pending_approval` 状态并暴露到独立 `/approval` 页面。`pending_operation` 至少保存原始 `operationId`、`traceId`、`idempotencyKey`、subject、operator、agentProfile、workspace、grant / token 摘要、requestedScopes、risk reason、policy decision、approvalScope、expiresAt、payload hash、redacted input summary 和 resume pointer。审批通过后只能恢复原 operation，沿用原 `operationId` / `traceId`；拒绝、过期、撤销或上层 hard deny 时不得执行副作用。

Intent Operation envelope 承载一个服务端采纳的 Risk Control Operation Envelope 作为风控证据段。它由 append-only Risk Control Gate Records 组成，记录 subject、intent、resource、environment、命中的 `controlId@definitionVersion`、definition digest、gate decision、reason、registered evidence references、adopted `enforcedById@componentContractVersion + componentDigest`、adopted `factSourceId@factContractVersion + factSourceDigest`、time 和 execution component，并贯穿 `admit -> bind -> authorize -> approve -> execute -> audit/recover`。definition digest 覆盖该 Control Definition 采用的 `verifiedById@verifierContractVersion + verifierDigest`；Gate Record 不需要重复 verifier reference，除非它通过 evidence locator 附加某次 verifier run evidence。该证据段不是请求时授权引擎，也不是客户端可自证的字段；客户端提交的 `riskControl`、`controlRef`、版本或 digest 不能作为可信事实，只能由调度内核和各 enforcing component 忽略、拒绝或替换为服务端追加的记录。

Risk Control Definition 与 Gate Record 中的 `definitionVersion`、component/fact-source/verifier contract version、`storeVersion`、`profileVersion` 和相关 digest 是平台统一版本能力采纳后的领域引用。所有平台治理版本都必须使用 Governed Version String，格式为 `v<platform-version>:<domain>:<subsection>-<version>`，复合版本继续追加完整词汇轴段；当前平台基线为 `v0.0.1`。版本推进、相邻版本迁移、退役、兼容投影、dry-run、checkpoint、retry、audit/recovery 必须通过 Platform Managed Migration 和 Migration Path Config 完成；Risk Control 和 Capability Kernel 不得在协议外各自封装迁移 runner、兼容分支或版本 registry。

每个 enforcing component 只能追加自己负责 gate 的 Risk Control Gate Record，不能改写、删除或重新解释前序 gate record。纠错、撤销、补偿和恢复必须追加新的 `audit/recover` record，而不是原地修改历史证据。

Risk Control Gate Records 必须组成严格的 operation-local hash chain。链起点是 `operationAnchorDigest`，覆盖 canonical operation identity 和 input boundary：`operationId`、`traceId`、`idempotencyKey`、API version、operation name、subject、operator、agent profile、workspace、intent、requested scopes 和 input hash。第一条 record 使用 `recordSeq=0` 且 `previousRecordDigest=operationAnchorDigest`；后续 record 必须连续递增 `recordSeq`，并把 `previousRecordDigest` 指向上一条 `recordDigest`。

`recordDigest` 必须覆盖除 `recordDigest` 自身外的 canonical gate record 字段：`recordSeq`、`previousRecordDigest`、gate、`controlId@definitionVersion`、definition digest、decision、reason code、evidence reference descriptors、允许的 inline evidence projection、adopted `enforcedBy` reference、adopted `factSource` reference、time 和 execution component。缺失、重复序号、序号断裂、fork、重排、anchor mismatch、digest mismatch、unresolved control reference 或 unresolved evidence reference 都是 hard validation failure；该 operation 不能被视为风控完成，只能通过新的 `audit/recover` record 或独立 recovery operation 引用并处理异常链，不能原地修补。

Gate Record 中的 `enforcedBy` 和 `factSource` 必须是 Risk Control catalog 的 adopted versioned reference，不能是裸 ID、代码路径、模块名、UI label 或显示名。无法解析的 enforcement component / fact source catalog ID、contract version、digest mismatch 或非 eligible version 与 unresolved control reference 同级，都是 hard validation failure。

Control Definition 中的 `verifiedBy` 也必须是 Risk Control verifier catalog 的 adopted versioned reference，不能是脚本路径、测试名、CI job、UI label 或显示名。无法解析的 verifier catalog ID、contract version、digest mismatch 或非 eligible version 与 unresolved control reference 同级，都是 hard validation failure。脚本路径、命令、测试过滤器、CI job、run ID 和输出 digest 只能作为 catalog metadata 或 verifier run evidence。

新建 Gate Record 只能采用 `active` 的 enforcement component 和 fact source catalog version；新建 Control Definition、validation evidence 和 migration-completion evidence 只能采用 `active` verifier catalog version。`candidate` 只能验证不能生产采用，`deprecated` / `retired` 只用于历史解析和 recovery；运行时不可用必须通过 health、degraded 或 blocked 状态表达，不能把 catalog entry 改成 `disabled`。

Risk Control digest canonicalization 固定为 canonical JSON + SHA-256 + domain-separated prefix。digest 输入是 UTF-8 字节串 `<domain>\n<canonical-json>`，展示格式是 `sha256:<domain>:<hex>`。首批 domain 是：

- `v0.0.1:risk-control:definition-digest-1`：Registry `definitionDigest`。
- `v0.0.1:risk-control:evidence-store-digest-1`：Evidence Store `storeDigest`。
- `v0.0.1:risk-control:evidence-profile-digest-1`：Evidence Governance Profile `profileDigest`。
- `v0.0.1:risk-control:evidence-locator-digest-1`：Evidence Locator `evidenceLocatorId`。
- `v0.0.1:risk-control:operation-anchor-digest-1`：`operationAnchorDigest`。
- `v0.0.1:risk-control:gate-record-digest-1`：Risk Control Gate Record `recordDigest`。
- `v0.0.1:risk-control:evidence-digest-1`：registered evidence entry body 的 `evidenceDigest`。

Canonical JSON 在领域值归一化后计算：object key 按字典序排序，array 保持原顺序，禁止无意义 whitespace，缺省 optional field 直接省略，`null` 只表达有语义的空值，timestamp 必须是 UTC ISO-8601 `Z` 字符串，拒绝 non-finite number。verifier、doctor、audit 和 recovery 不得接受基于 JS object 插入顺序、pretty JSON、locale 格式化、进程私有序列化或 digest boundary 外字段计算出的 digest。

Gate Record evidence 采用统一注册解析规则。无论证据大小、轻重或敏感度，每个 evidence item 都必须保存完整 Risk Control Evidence Locator、匹配的 `evidenceLocatorId`、实际采用的 `classificationProfile`、`redactionPolicyProfile` 和 `retentionProfile`。Evidence Locator 是可解析载荷，字段为 `locatorVersion=v0.0.1:risk-control:evidence-locator-1`、`storeId`、`storeVersion`、`storeDigest`、`evidenceRef` 和 `evidenceDigest`；`evidenceLocatorId` 是该 locator canonical digest，展示为 `sha256:v0.0.1:risk-control:evidence-locator-digest-1:<hex>`，作为全局统一 evidence ID。`classificationProfile`、`redactionPolicyProfile`、`retentionProfile` 和 inline projection 不进入 `evidenceLocatorId`，它们是本次 Gate Record 的 evidence governance profile 引用；每个 profile 引用必须包含 `profileId@profileVersion` 和 `profileDigest`，其中 `profileVersion` 使用 `v0.0.1:risk-control:evidence-profile:profile-schema-1:lifecycle-1:contract-1:revision-1` 形式。Evidence Store registration 声明允许 profile 和默认 profile，Control Definition 的 `evidence` primitive 声明最低治理 profile 要求，Gate Record 记录实际采用 profile；默认 profile 可以在 append 前参与确定实际值，但持久化 Gate Record 不能依赖未来重新计算默认值。Gate Record 不得只保存 `evidenceLocatorId` 而丢弃 locator payload；`recordDigest` 必须覆盖 locator payload、`evidenceLocatorId`、证据治理 profile 引用、`profileDigest` 和允许的 inline projection，locator ID 与 locator payload 不匹配时记录无效。

`storeId` 是稳定 Evidence Store identity；同一 `storeId` 只能在 evidence authority、`evidenceRef` namespace 和 resolution meaning 兼容时复用。`storeVersion` 使用 `v0.0.1:risk-control:evidence-store:schema-1:lifecycle-1:contract-1:revision-1` 形式：`schema` 是 Evidence Store catalog schema / digest boundary，`lifecycle` 是 Store lifecycle 状态机，`contract` 是 resolver/verifier/redaction/retention/recovery 兼容合同，`revision` 是同一合同下的不可变修订；不兼容的 authority、namespace、resolver、verifier、redaction、retention 或 recovery 变化必须新建 `storeId`。`storeId@storeVersion` 必须解析到 Risk Control Evidence Store Catalog，store registration 必须声明 lifecycle state、authority、允许的 `classificationProfile` / `retentionProfile` / `redactionPolicyProfile`、resolver、verifier、recovery 行为和 evidence-governance 默认 profile。Evidence Governance Profile registration 必须声明 `profileId`、`profileVersion`、`profileDigest`、profile kind、lifecycle state、可比较治理语义、验证覆盖和 enforcement metadata；`profileVersion` 使用 `v0.0.1:risk-control:evidence-profile:profile-schema-1:lifecycle-1:contract-1:revision-1` 形式，profile lifecycle 使用 `candidate`、`active`、`deprecated`、`retired` 四态。只有 `active` store version 和 active profile version 可以被新建 Gate Record 选择，`deprecated` / `retired` 只用于历史验证和 recovery，不是新证据入口。小型、非敏感、结构化、已脱敏且可 canonicalize 的证据可以附带 bounded inline projection，但该 projection 只是已注册 evidence entry 的缓存或展示副本，不是独立证据源。大型证据、敏感证据、provider receipt、原始 request/response 片段、文件、日志、截图、recovery package 或 secret-adjacent material 不得 inline。`recordDigest` 不把敏感证据原文塞进风控链。

新建 Gate Record 遇到缺失 locator payload、`evidenceLocatorId` mismatch、未知 `storeId@storeVersion`、`storeDigest` mismatch、非 active store version、无法解析的 `evidenceRef`、`evidenceDigest` mismatch、未知 `profileId@profileVersion`、`profileDigest` mismatch、非 active profile version、profile 不被 store 允许、resolver/verifier 缺失、recovery 行为未定义，或实际采用 profile 低于 Control Definition 最低要求，都必须无效。历史 Gate Record 只有在记录当时引用的 store/profile version 合法，并且现在仍能按其 retention 或 recovery contract 解析时才继续有效。

Evidence 追溯固定走一条路径：从 Gate Record 读取 locator 和实际采用的 evidence-governance profiles，复算 `evidenceLocatorId`，通过 Evidence Store Catalog 解析 `storeId@storeVersion`，通过 Evidence Governance Profile catalog 解析 `profileId@profileVersion`，复算并比对 `storeDigest` 和每个 `profileDigest`，调用该 store version 的 resolver 解析 `evidenceRef`，复算并比对 `evidenceDigest`，验证实际 profile 同时满足 Store 合同和 Control Definition 要求，再按 classification、redactionPolicy、retention 和 recovery contract 返回原文、脱敏投影、recovery package 或不可读原因。系统可以从 Operation Ledger / Gate Records 重建 Evidence Locator Index，把 `evidenceLocatorId` 映射回 operation、gate record、controlRef 和 timestamp，把 `evidenceDigest` 映射到引用同一 evidence body 的所有 locators；该 index 只是查询投影，不是证据事实源。

```text
intent envelope
  -> Operation Scheduling Kernel
  -> append risk-control gate records
  -> registry contract resolve
  -> identity / policy / risk decision
  -> ledger started / pending
  -> pending_operation / approval wait when required
  -> queue / concurrency / retry scheduling
  -> dry-run / diff / snapshot boundary
  -> executor invocation
  -> receipt / audit / checkpoint / trace
  -> operation reply
```

操作必须支持：

- 幂等：`idempotencyKey`
- 内核准入：`operationId`、`kernelDecision`、`scheduledAt`
- 可预览：`dryRun=true`
- 可解释：`policyDecision.reason`
- 可恢复：`preSnapshot`、`postSnapshot`
- 可复制：`exportableOperationBundle`
- 可审计：`auditId`、`traceId`

智能体提交的写入默认只能成为 `observation`、`artifact` 或 `proposal`。只有经过策略、人审或授权 agent 审核后，才允许形成 `decision` 或 canonical state。

Proposal 最小协议入口：

- `workspace.proposal.create`：创建受控 `decisionProposal` submission。
- `workspace.proposal.apply`：审核 proposal；通过后生成 `decision`，但不能直接改写任意 canonical state。

### Unified Checkpoint Tree Protocol

`v0.0.1:storage:checkpoint-tree-1` 管理统一 Checkpoint Tree。它不是单独的任务队列树，也不是单纯的文件树，而是公共空间所有可治理影响的状态图。

最小能力：

- `workspace.checkpoint.tree.list`
- `workspace.checkpoint.diff`
- `workspace.checkpoint.restore.preview`
- `workspace.checkpoint.restore`
- `workspace.operation.revert.scope`
- `workspace.checkpoint.node.get`
- `workspace.checkpoint.scope.query`

进入统一 Checkpoint Tree 的事件至少包括：

- 所有访问请求：workspace info/list、catalog discover、metadata read、permission check、search、evidence read、asset list/read/download、skill list/download、receipt list、audit query、operation history、checkpoint tree list、restore preview、context bundle、export、checkout。
- 所有文件变动：create、update、move、delete、archive、restore。
- 所有知识贡献：submit、scan、review、publish、adopt、revoke。
- 所有代码贡献：target evaluate、prepare local worktree、upload Gerrit change、link existing change、sync review status、fallback proposal。
- 所有技能调用：list、download、install、execute、usage report、revoke。
- 所有权限裁决：grant、deny、permission request、authorizationOverlay change。
- 所有上下文暴露：context compile、memory write、distillation input、tool call input。
- 所有恢复动作：restore preview、restore、revert operation scope、branch、merge。

`checkpointNode` 最小字段：

- `checkpointNodeId`
- `parentNodeIds`
- `workspaceId`
- `subject`
- `operatorId`
- `agentProfile`
- `eventKind`
- `effectKind`
- `targetRefs`
- `policyDecision`
- `stateDelta`
- `receiptRefs`
- `auditId`
- `createdAt`

`effectKind` 至少包含：

- `read`
- `write`
- `execute`
- `permission`
- `restore`
- `deny`
- `report`

读请求也必须形成 checkpoint node。它可能不改变文件树，但会产生 `knowledgeAccessReceipt`、`loanRecord`、`asset.download.requested`、`asset.downloaded`、`skill.used`、`denied request audit`、贡献统计或模型上下文暴露记录。这些都是公共空间安全状态的一部分。第一版读请求全量入树，不能把 list、discover、metadata、permission check、receipt list、audit query、operation history 或 checkpoint tree list 降级为普通接口日志。`asset.downloaded` 只能在真实内容传输完成并校验成功后产生；策略通过和返回下载状态响应只能记录 requested/started。

全量入树的边界是外部可见请求、后台任务 activity 和 provider side effect。为了避免查询 Checkpoint Tree 自身时递归生成无限节点，同一次请求内部读取 Ledger、AuditStore、CheckpointTree 或 projection 的系统内部读不再生成新的 checkpoint node，但必须继承父 `operationId` / `traceId`，重要子步骤作为 span、receipt 或 child event 关联回统一账本。

Checkpoint Tree 安全恢复演示：

1. A 逐个删除工作空间中的多个文件。
2. 每次删除都形成 `operation.applied` 和 `checkpoint.created`，记录 `preSnapshotRef`、`postSnapshotRef`、operation diff、operator、policy decision 和 `auditId`。
3. 管控台调用 `workspace.checkpoint.tree.list` 展示 Checkpoint Tree 历史。
4. 管理员选择 A 操作之前的 checkpoint，调用 `workspace.checkpoint.restore.preview` 查看 dry-run diff。
5. 管理员确认后调用 `workspace.checkpoint.restore`。
6. 系统创建新的 restore operation 和 `checkpoint.restored` 事件，把 workspace 恢复到目标节点对应状态，但保留 A 的删除 commit 和恢复 commit。

恢复协议必须支持两种粒度：

- `restoreToCheckpoint`：恢复到某个 checkpoint 节点。
- `revertOperationScope`：按 operator / task / operation batch 回撤 A 本次所有操作。

实现可以复用 git worktree 能力，例如 tree object、diff、commit graph、checkout-like restore、临时 worktree 预览和 branch / merge；但协议层不能暴露裸 git reset 作为恢复语义。Pact 必须把文件状态恢复、数据库元数据、权限 overlay、knowledge evidence、loan record、contribution 引用和 audit record 作为一次完整 workspace restore 处理。

## Backup Restore Protocol

`v0.0.1:storage:backup-restore-1` 只用于未来存在独立备份服务器、灾备目标或离线备份介质时的服务端数据目录备份恢复。它不是 v0.0.1 上传留档主链路，不是 sharedspace 管理语义，也不是 cloud drive sync 的别名。当前 v0.0.1 主线只依赖上传留档、Checkpoint Restore 和 Cloud Sync；Backup Restore 保留为生产硬化协议。

第一版恢复不删除备份中不存在的当前文件，只恢复 manifest 中声明的权威文件，避免误删运行期新增状态。只有复制完成、manifest hash 校验完成、restore preview 可读，才能称为 `backup.created`；复制中只能称为 `backup.running` 或 `backup.staged`。

备份 manifest 必须包含：

- `backupId`、`createdAt`、`sourceRoot`、`backupPath`
- `summary.fileCount/bytes/byCategory`
- `files[].relativePath/category/bytes/sha256/mtimeMs`

公开操作：

- `storage.backups.list`：列出已生成备份。
- `storage.backups.create`：生成 `backup-manifest.json` 并复制服务端数据文件。
- `storage.backups.restore_preview`：比较当前数据目录和备份 manifest，输出 create/replace/noop/blocked。
- `storage.backups.restore`：需要确认后执行恢复，并写出 restore report。

## Workspace Contribution Protocol

`v0.0.1:workspace:contribution-1` 管理终端贡献型资产。它把本地智能体、脚本、人工操作者和下游 workspace 产生的高价值信息沉淀为可治理资产。

贡献资产类型：

- `knowledge`
- `skill`
- `tool`
- `script`
- `file`
- `sourceCode`
- `codeChange`
- `goldenRule`
- `expertOpinion`

每个 workspace 必须暴露固定存放位置：

- `skills/`
- `tools/`
- `scripts/`
- `files/`
- `knowledge/`
- `rules/`
- `expert-opinions/`

`sourceCode` 表示作为知识、示例、报告附件或非合并材料进入 workspace 的代码资产。`codeChange` 表示需要进入代码仓库评审的变更，默认不作为普通文件资产发布，而是交给 `v0.0.1:platform:code-review-1` 生成或关联 Gerrit change。

提交请求必须带：

- `contributionId`
- `contributorId`
- `contributorKind`
- `sourceWorkspaceIds`
- `targetWorkspaceIds`
- `contributionType`
- `payloadRefs`
- `skillManifestRef`
- `toolSchemaRef`
- `scriptRefs`
- `fileRefs`
- `knowledgeRefs`
- `goldenRuleRefs`
- `expertOpinionRefs`
- `license`
- `risk`
- `requestedVisibility`
- `requestedActions`
- `reviewPolicy`

贡献资产必须物化为持久 workspace asset，而不是只停留在运行时注册表。服务端默认持久结构：

```text
workspace-contribution/
  registry.json
  workspaces/<workspaceId>/
    skills/
    tools/
    scripts/
    files/
    knowledge/
    rules/
    expert-opinions/
```

每次提交、扫描、审核、预览、发布、采用或撤销都必须更新贡献注册表和对应 workspace bucket 下的 `asset.json` manifest。跨 workspace 复用不能只增加 usage 计数；必须生成目标 workspace 的 adoption asset record，并保留 source workspace、grant/loan、usage event 和 audit 关联。

贡献状态机：

```text
submitted
  -> scanned
  -> reviewed
  -> preview -> published | rejected | needs_changes
  -> adopted
  -> deprecated | revoked
```

排行榜统计字段：

- `contributionCount`
- `acceptedCount`
- `usageCount`
- `uniqueWorkspaceAdoptions`
- `skillExecutionCount`
- `permissionRequestCount`
- `permissionGrantCount`
- `reuseSuccessRate`
- `rollbackCount`
- `maintenanceFreshness`
- `rankScore`

资产贡献统计报表字段：

- `reportId`
- `workspaceId`
- `timeRange`
- `assetTypeBreakdown`
- `contributorBreakdown`
- `workspaceAdoptionBreakdown`
- `permissionFlowBreakdown`
- `usageActionBreakdown`
- `riskBreakdown`
- `maintenanceBreakdown`
- `topReusableAssets`
- `underMaintainedAssets`
- `highDemandRestrictedAssets`
- `rollbackHotspots`
- `assetContributionReportV0`

协议资源键使用 `workspaceId/contributions/report` 表达“某个 workspace 的贡献统计报表”；HTTP façade 仍使用当前统一入口 `POST /api/workspace/contributions/report`，请求体中携带 `workspaceId`。

`assetContributionReportV0` 的默认汇总口径：

```text
assetContributionReportV0 =
  acceptedCount
  + usageCount
  + uniqueWorkspaceAdoptions
  + permissionGrantCount
  - rollbackCount
```

排行榜可以从报表派生，但报表是管理者视角的一等能力。它回答公共空间是否在沉淀可复用资产、哪些贡献真正被使用、哪些资产需要授权治理、哪些资产正在制造风险。

贡献授权请求必须返回 `contributionGrant`、`loanRecord`、`auditId` 和可撤销策略。贡献资产被其它智能体下载、安装、执行、复制到上下文或带到其它 workspace 时，必须记录使用事件和借阅记录。

初始排行榜算法：

```text
rankScoreV0 =
  usageCount * successRate
  + uniqueWorkspaceAdoptions
  - rollbackCount
```

`usageCount` 统计被授权主体确认下载、安装、执行、复制到上下文或跨 workspace 采用的次数，`successRate = successfulUseCount / max(usageCount, 1)`，`uniqueWorkspaceAdoptions` 是去重后的 workspace 采用数，`rollbackCount` 是该资产导致的恢复、撤销或禁用次数。`acceptedCount` 保留为资产贡献统计报表字段，不作为排行榜主导项。

## Durable Workflow Protocol

`v0.0.1:workflow:core-1` 是长任务 durable execution 协议。Pact 第一版不直接强依赖 Temporal，但语义向 durable workflow 对齐：

- workflow 状态和 execution history 默认持久化，可恢复、可观察、可校验。
- activity 必须带幂等 key、输入 hash、输出 hash、重试策略和补偿动作。
- workflow 必须支持 signal、timer、human review wait、manual approval、cancel 和 compensation。
- 外部写入必须区分 partial、committed、failed、compensated，不能把 partial write 当 completed。
- 崩溃恢复必须能回答恢复点、上次成功 activity、待重试 activity、待人工处理事项和外部副作用状态。

单机实现入口是 `server/platform/common/workflow/durable-workflow-store.mjs`。它把 workflow、activity、signal、timer、human review 和 external write 写成 hash-chain execution history；导入解析 job 通过 `job-manager` 写入 `worker-run` activity heartbeat、完成、失败和恢复信号。`server:verify:durable-workflow` 是协议语义门禁，覆盖模拟崩溃恢复、幂等 activity 复用、human review、timer firing、external partial write commit 和 history 校验。

### Device MCP Hub

历史文档里的 MCP Demo Flows 现在收敛为本节的设备级 MCP Hub，并按 Stitch MCP 的 HTTP 接入方案落地。

Pact MCP service 是 Workspace API 的设备级协议适配器，不是 agent-to-agent gateway。它必须让同一台设备上的 OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor 和 Hermes Agent 都能通过同一套发现、授权和工具边界访问 Pact，而不是为某一个 agent 单独硬编码。

Pact MCP service 可以位于 agent traffic/load gateway 后面，但 gateway 只能作为可拆卸流量入口。拆除 gateway 后，HTTP MCP endpoint、stdio proxy 到 HTTP MCP 的转发、grant pairing、discovery manifest、client runtime bootstrap 和 upload session 必须继续使用 direct Pact endpoint 正常工作。gateway 注入的 request id、route id、边缘认证结果和限流结果只能进入审计上下文，不能替代 Pact grant 或 workspace policy。

设备级 MCP Hub 由五部分组成：

1. **HTTP MCP endpoint**：服务端权威入口，复用主服务进程。
2. **stdio proxy**：本地 agent 兼容入口，只把 stdio MCP 消息转发到 HTTP MCP。
3. **设备级发现清单**：让 installer、doctor 和本机 agent adapter 发现 Pact MCP 服务。
4. **每 agent 独立 grant/token**：每个 agent 有自己的权限、身份和审计轨迹。
5. **release discovery publisher**：以独立 connector release 包发布共享 Hub 发现清单；只有用户明确选择某个客户端时才写入该客户端配置。

Pact MCP 必须完全按 Stitch MCP 的接入方案实现：客户端配置直接指向一个 HTTP MCP endpoint，认证作为客户端侧 metadata / headers 独立声明。Stitch 的 API key 变体使用 `X-Goog-Api-Key`；Pact 对应优先使用 `X-Pact-Api-Key`，值为 Tool Management grant token。Codex CLI 的标准 HTTP MCP 安装命令只支持 bearer token env var，因此 Codex 使用 `--bearer-token-env-var PACT_MCP_TOKEN`，服务端同时接受 `Authorization: Bearer <token>` 和 `X-Pact-Api-Key`。只有目标客户端不支持 HTTP MCP 或自定义 headers 时才落到 stdio proxy，stdio 不作为默认方案。

终端用户不拉取完整 Pact 服务端仓库。服务端只发布 MCP HTTP endpoint、发现清单和 grant token；客户端侧统一通过 `pact-mcp-connector` release 包安装或升级。

#### Transport endpoints

HTTP MCP 是权威服务入口：

```text
<discovered-pact-base-url>/mcp
<discovered-orbstack-host-url>/mcp
```

connector 不把 `127.0.0.1:7228` 作为默认事实写入客户端。安装开始时必须扫描本机 Pact 候选服务、读取本机 registry，并通过 `/api/mcp/handshake` 校验服务端 Ed25519 签名；只有签名握手通过后，才把 discovery 返回的 HTTP MCP URL 写入目标客户端。OrbStack VM 内访问宿主机的 URL 也来自 discovery 的 advertised endpoint。

HTTP endpoint 必须遵守 MCP Streamable HTTP 的最小要求：

- `POST /mcp` 接收 MCP JSON-RPC request / notification / response。
- `GET /mcp` 在支持事件流时返回 `text/event-stream`，否则返回 `405 Method Not Allowed` 并带 `Allow: POST`。
- 绑定本机默认只允许 localhost；对来自浏览器或远端 HTTP 的请求校验 `Origin`，防止 DNS rebinding。
- 未授权时返回 `401`，并提供 MCP authorization discovery 所需的 protected resource metadata 位置。
- 不把大文件直接塞入 MCP JSON-RPC 响应；大 payload 返回 `assetId`、`downloadUrl`、`jobId` 或 evidence reference。

stdio proxy 只保留为未来本地兼容入口；当前 release 安装路径默认不启用 stdio。

stdio proxy 不维护独立业务状态，不直接读写 workspace、文件、SQLite、KnowledgeCore 或 Tool Management 数据。它只负责：

- 从 stdin 读取 MCP JSON-RPC。
- 给 HTTP MCP 注入对应 agent grant/token。
- 把 HTTP MCP 响应写回 stdout。
- 日志只写 stderr，stdout 只能出现合法 MCP message。

#### Device discovery

Pact 必须写入设备级发现清单：

```text
~/.pact/mcp/servers.json
```

清单最小结构：

```json
{
  "version": "v0.0.1:mcp:device-hub-1",
  "servers": {
    "pact": {
      "name": "Pact",
      "httpUrl": "<signed-discovered-base-url>/mcp",
      "vmHttpUrl": "<signed-discovered-vm-url>/mcp",
      "connector": {
        "packageName": "pact-mcp-connector",
        "packageVersion": "0.0.1",
        "discoverCommand": "npx pact-mcp-connector@latest discover-local --json",
        "autoInstallCommand": "npx pact-mcp-connector@latest install --target auto --json",
        "priorityInstallCommand": "npx pact-mcp-connector@latest install --target claude-code,codex,openclaw --json",
        "installCommand": "npx pact-mcp-connector@latest install --target <client>"
      },
      "discoveryUrl": "<signed-discovered-base-url>/.well-known/pact/mcp.json"
    }
  }
}
```

服务端同时暴露：

```text
GET /.well-known/pact/mcp.json
GET /api/mcp/discovery
POST /api/mcp/handshake
```

`.well-known/pact/mcp.json` 是 Pact 的设备发现约定，不声明为 MCP 官方标准。它用于让本机 installer、doctor、CLI 和 adapter 发现同一个服务端、VM endpoint 和已安装 target 状态。

`/api/mcp/handshake` 接收客户端 nonce，返回包含 nonce、server identity、endpoint、interface version 和 toolset version 的稳定 JSON payload，并用服务端本机 Ed25519 identity 签名。connector 必须先验证签名，再信任 discovery URL。

本机发现必须收敛到统一入口封装：`pact-mcp discover-local --json`。它是所有 agent 可复用的本机查询命令，内部只维护一个 canonical registry 文件 `~/.pact/mcp/servers.json`，并按需兜底访问服务端 HTTP discovery；不得通过写多个本机发现文件来制造兼容性。

Codex 在本机定位 Pact MCP 的实际路径应被产品化为所有 agent 都能复用的查找顺序：

1. 调用 `pact-mcp discover-local --json`。
2. `discover-local` 内部先读 `PACT_MCP_URL`、`PACT_MCP_DISCOVERY_URL`、`PACT_MCP_DISCOVERY_FILE`。
3. 读取唯一 registry：`~/.pact/mcp/servers.json`。
4. 扫描本机候选端口。
5. 对候选 URL 读取 `/api/mcp/discovery` 并执行 `/api/mcp/handshake` 签名校验。
6. 对验证通过的 `httpUrl` 执行 MCP `initialize`。

`pact-mcp register` 只写入这一个 registry，并可通过 launchctl 发布同一组环境变量；它不修改任何客户端配置。扫不到签名有效的 Pact 服务时，TTY 安装流程必须明确提示用户配置服务端 URL，并提供 `skip, manually configure later` 选项，不能静默落到硬编码地址。

本机服务端地址配置由 connector 管理，命令形态固定为：

```bash
pact-mcp server-config --set --url http://<host>:<port> --name local
pact-mcp server-config --switch local
pact-mcp server-config --refresh
pact-mcp server-config --reset
pact-mcp server-config --list
```

`--set`、`--switch`、`--refresh` 都必须验证签名握手。`--reset` 清空本机 connector 对服务端地址的配置，使下一次安装重新扫描或让用户手动配置。

#### Connector release channel

`pact-mcp-connector` 是独立客户端发布包，只包含 MCP 客户端安装器、doctor 和各智能体配置写入逻辑，不包含服务端 runtime、SQLite、KnowledgeCore、UI 或任何服务端源代码。

发布通道必须同时提供两种客户端形态：

- npm 包：适合已有 Node.js / npx 的开发机。
- portable 包：适合没有 Node.js、npm、npx 或包管理器的机器；包内自带当前平台 Node runtime，并提供 `pact-mcp` 命令和 macOS 可双击的 `install.command`。

服务端 release 构建命令：

```bash
npm run server:mcp:release
npm run server:verify:mcp-release
```

release 产物写入 `build/release/mcp/`，包含：

- `pact-mcp-connector-<version>.tgz`
- `pact-mcp-connector-<version>-<platform>.zip`
- `pact-mcp-connector-<version>-<platform>.tar.gz`
- `pact-mcp-install.sh`
- `pact-mcp-release.json`
- `latest.json`

发布通道使用 npm / GitHub Release 上传上述产物；`pact-mcp-release.json` 记录 npm tarball sha256、portable zip sha256、portable tarball sha256、GitHub 一行安装命令、版本、支持的 target、Hub 注册命令、本机发现命令、多选交互式安装命令、auto 脚本化连接命令、priority 脚本化连接命令、单客户端模板命令和 `npm publish` 命令。终端用户首选 GitHub 一行命令或 zip 包入口，不需要完整服务端 checkout。一行安装脚本必须优先检测本机 Node.js 20+，命中时只下载小体积 source tarball；只有本机没有可用 Node.js 时才下载内置 runtime 的 portable zip。

具备 npm registry 权限时可以直接发布：

```bash
npm run server:mcp:release -- --publish
```

用户安装分成两层。第一层只注册共享本机 MCP Hub，不写入任何具体智能体客户端：

```bash
npx pact-mcp-connector@latest register
```

第二层按需连接一个或多个客户端：

```bash
npx pact-mcp-connector@latest install
```

无 `--target` 且运行在 TTY 中时，`install` 必须启动多选交互式菜单，扫描 OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 claw-compatible 衍生体，允许用户用上下键移动、Space 多选、`a` 切换所有已检测客户端。菜单只在用户确认选择后写入对应客户端配置。

客户端扫描必须是真正分层扫描：先检测宿主 OS（`darwin` / `linux` / `win32`），再按本系统特点依次执行 PATH scanner、package-manager scanners（brew、npm/pnpm/yarn/bun global、nvm/asdf/mise shims、pipx、cargo bin、winget/scoop/choco、snap/flatpak 等）、App/desktop scanners（macOS `.app`、Linux `.desktop`、Windows Start Menu / App Paths），最后扫描 Container/VM（OrbStack、Docker、Podman、WSL）并在目标环境内重复 Linux 分层扫描。所有 CLI 候选必须统一 normalize + realpath 去重，并实际执行 `mcp --help` capability probe；只有确实暴露 MCP 子命令的 CLI 才能显示为可安装 MCP 客户端。同一个 VM / container 内同类客户端只显示一个归一化候选，本机不同 realpath 的 claw-compatible 客户端可以分别显示。App/desktop 层不做全量泛探测，只针对常见智能体/开发平台名单和名称模式（例如 `*Bot`、`*Claw`、`*Agent`、`*Code`）过滤候选。macOS `.app` scanner 只允许探测 bundle 内的 CLI helper 目录（例如 `Contents/Resources` / `Contents/Resources/bin`），不得执行 `Contents/MacOS/CFBundleExecutable` 这类 GUI 主程序，避免触发登录、钥匙串或授权弹窗。

GitHub Release 必须额外提供一条安装命令入口；它校验 SHA256、安装到 `~/.pact/mcp/connector`，并立即启动同一个多选 TUI。脚本默认优先下载 npm/source tarball，只有没有可用 Node.js 时才 fallback 到 portable zip：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

GitHub Release 还必须提供对称的一条卸载命令入口；它复用同一个 release connector，扫描全机/VM/container 中支持 MCP 子命令的客户端，打开多选 TUI，并只删除用户选中的客户端配置：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-uninstall.sh)"
```

脚本化安装默认使用 auto target；默认由 connector 在本机向已验证签名的 Pact 服务申请 Tool Management grant token，一次安装 connector 能验证到的全部受支持客户端：

```bash
npx pact-mcp-connector@latest install --target auto --json
```

面向 Claude Code、Codex、OpenClaw 的优先接入场景，可以使用 priority target list；这仍是一条命令，不要求智能体逐个客户端安装：

```bash
npx pact-mcp-connector@latest install --target claude-code,codex,openclaw --json
```

面向任意智能体自助执行的 GitHub Release 无人值守入口必须使用 auto target：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --target auto --json
```

只有使用预先签发的自定义 grant 时才传入 token：

```bash
printf '%s\n' '<issued-token>' | npx pact-mcp-connector@latest install \
  --target auto \
  --token-stdin \
  --json
```

没有 Node.js / npx 的用户使用 portable zip 包：

```bash
unzip pact-mcp-connector-<version>-<platform>.zip
cd pact-mcp-connector-<version>-<platform>
./pact-mcp install
```

portable zip 包同样保留脚本化安装：

```bash
./pact-mcp install --target auto --json
./pact-mcp install --target claude-code,codex,openclaw --json
```

portable zip 包也必须支持交互式卸载和脚本化卸载：

```bash
./pact-mcp uninstall
./pact-mcp uninstall --target claude-code,codex,openclaw
```

macOS 上也可以双击 portable 包里的 `install.command`，由 connector 自动扫描并校验签名，然后选择连接一个或多个客户端；双击 `uninstall.command` 则进入同一套扫描和多选卸载流程。

用户验证命令形态固定为；无 token 时只验证发现和握手，有 token 时额外验证 `tools/list` / `tools/call`：

```bash
PACT_MCP_TOKEN='<issued-token>' npx pact-mcp-connector@latest doctor
```

用户脚本化卸载必须显式指定 target 或 target list：

```bash
npx pact-mcp-connector@latest uninstall --target claude-code,codex,openclaw
```

`npm run server:mcp:install` 只保留为服务端开发者和本机调试入口，不作为终端用户安装通道。默认用户路径是 `register` 和 `discover-local`；客户端接入是每个 agent 明确 opt-in 的动作。

#### Agent identity and grants

MCP 不复用控制台 cookie / CSRF。每个 agent 使用独立 grant/token：

正常安装不要求用户手动复制 token。connector 在扫描到本机 Pact 并完成 `/api/mcp/handshake` 签名验证后，调用本机限定的 `/api/mcp/local-grant` 申请默认 agent grant。该 grant 使用 Tool Management 默认 agent toolsets，默认不授予 admin/repair 权限。`PACT_MCP_TOKEN` 只是 Codex 等只支持 bearer-token-env-var 客户端需要引用的环境变量名，变量值由 connector 写入；不是要求用户手工配置的前置条件。

```text
pact.mcp.openclaw
pact.mcp.claude-code
pact.mcp.codex
pact.mcp.antigravity
pact.mcp.opencode
pact.mcp.copilot
pact.mcp.kilo-code
pact.mcp.cursor
pact.mcp.hermes
```

每个 grant 必须记录：

| 字段 | 用途 |
| --- | --- |
| `operatorId` | 区分真实调用方，例如 `codex:local`、`orbstack:kate:openclaw`。 |
| `subjectId` | 归属用户、团队或 demo subject。 |
| `agentProfileId` | 绑定 agent 默认上下文、预算、工具授权和审计标签。 |
| `defaultWorkspaceId` | 省略 `workspaceId` 时使用的 workspace。 |
| `allowedToolsets` | 可用 MCP toolset 白名单。 |
| `allowedScopes` | Tool Management / Operation Registry 的 scope 白名单。 |
| `createdAt` / `lastUsedAt` | 安装和调用审计。 |

grant 只授予 curated MCP toolset。不得把完整 Operation Registry 默认暴露给任意 agent。

#### Target install matrix

| Target | 推荐接入 | endpoint |
| --- | --- | --- |
| OpenClaw | VM / remote 环境内 `openclaw mcp set pact <json>`，HTTP endpoint 指向宿主机或已发现远端 | signed discovery `vmHttpUrl` / `httpUrl` |
| Claude Code | `claude mcp add-json pact <server-json>` 或等价 CLI 配置写入 | signed discovery `httpUrl` |
| Codex | `codex mcp add --url --bearer-token-env-var`（若需兼容旧版本再尝试 `codex plugin marketplace add` + `codex plugin add`） | signed discovery `httpUrl` |
| Antigravity | 按官方 `~/.gemini/antigravity/mcp_config.json` 的 `serverUrl` + `headers` 写入 HTTP server | signed discovery `httpUrl` |
| OpenCode | 按 `~/.config/opencode/opencode.jsonc` 的 `mcp.pact.type=remote`、`url`、`headers.X-Pact-Api-Key` 和 `enabled` 写入 HTTP server | signed discovery `httpUrl` |
| Copilot | `copilot mcp add --transport http --header X-Pact-Api-Key` | signed discovery `httpUrl` |
| Kilo Code | 按 Kilo CLI 标准 `~/.config/kilo/kilo.json` 的 `mcp.<name>.type=remote` 写入 HTTP server | signed discovery `httpUrl` |
| Cursor | 按 Cursor MCP settings 的 `mcpServers.pact` 写入 HTTP server | signed discovery `httpUrl` |
| Hermes Agent | VM / remote 环境内 `hermes mcp add --url --auth header`，并用 Hermes config helper 启用后 `hermes mcp test` | signed discovery `vmHttpUrl` / `httpUrl` |

installer 只追加或替换 `pact` 这一项，必须先生成会被结构化写入目标配置的回滚副本。不得覆盖、清空或重排用户已有 MCP server、API key、bot token 或 agent 配置。能用客户端标准 CLI 的目标必须调用标准 CLI；没有可脚本化标准 CLI 的目标由 `server:mcp:install` 按目标官方配置格式做结构化写入并生成回滚副本。

上述 MCP 安装路径只负责让本机 agent 客户端调用 Pact 工具。ACP Relay 的 agent-to-agent 参与者目录由下游客户端切面装配，不通过 MCP 配置写入。下游客户端切面会为 OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor 和 Hermes Agent 各注册一个 ACP/Relay participant 描述：能使用 native ACP、官方 ACP adapter、operator-approved ACP Registry distribution 或专用 API 的目标走对应适配器；只有没有任何 ACP 路径的未知或降级目标才允许走受管 `agent-cli-exec`。所有路径继续走 Relay 权限、审计和平台管理边界。

Codex 标准 CLI 配置形态：

```toml
[mcp_servers.pact]
url = "<signed-discovered-http-url>/mcp"
bearer_token_env_var = "PACT_MCP_TOKEN"
```

#### Stable MCP outlets

对外 MCP 工具面必须收敛为七个稳定语义入口：

```text
pact.discovery
pact.agentLibrary
pact.sharedspace
pact.codespace
pact.skillHub
pact.agentRelay
pact.serviceHub
```

本阶段硬切新七类入口，不保留 `pact.knowledge`、`pact.workspace`、`pact.list`、`pact.skill`、`pact.help` 等旧 alias。每个入口的入参固定为 Intent Operation envelope：

```json
{
  "apiVersion": "v0.0.1:mcp:interface-1",
  "operation": "system.health",
  "subject": { "type": "tool-grant", "subjectId": "<grant-id>" },
  "operatorId": "codex:local",
  "agentProfileId": "pact.mcp.codex",
  "workspaceId": "workspace-1",
  "traceId": "mcp_trace_...",
  "idempotencyKey": "mcp_intent_...",
  "intent": "system.health",
  "input": {},
  "dryRun": false,
  "requestedScopes": []
}
```

`operation` 是 Pact 内部 Operation Registry / Tool Management 的操作 id。外部智能体不直接看到 100+ 个内部 operation，也不把内部 operation 展开成 MCP tool name。MCP adapter 只能把 JSON-RPC 请求转换成 Intent Operation envelope；能力发现、grant 校验、可见 operation 过滤、local grant、workspace ref 解析、工具执行和输出脱敏必须进入 `v0.0.1:tool:skill-management-1` provider。需要发现内部能力时，调用 `pact.discovery`：

该外部入参示例不包含可信 Risk Control Operation Envelope。风控证据段由服务端调度和 enforcing components 基于 Registry 追加 Gate Records；外部智能体不能通过提交 `riskControl` 或 `controlRef` 字段来声明自己已通过风控。

```text
pact.discovery({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.capabilities.list", "input": {} })
pact.discovery({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.mcp.version", "input": {} })
```

`pact.capabilities.list` 必须按当前 grant 过滤 operation：智能体能看到权限范围内所有可用工具，不能看到缺少 scope、toolset、risk 上限或被 deny 的工具。`/api/mcp/local-grant` 的默认策略是：没有匹配目标时只授予默认只读 agent toolset；匹配到受支持本机 agent 目标后自动授予预定义 safe-write agent toolset，并记录 `targetMatch`、`matchedTargets`、`unmatchedTargets` 和 `agentProfileId`。高风险内部 operation 只能通过显式 grant 扩展，并且必须保留 Tool Management policy preview、approval 和 audit。

`pact.serviceHub` 的边界是 external-service invocation surface，不是 registration surface。普通 MCP agent 可以在 grant 允许时发现和调用已经注册的上游 HTTP/HTTPS MCP / HTTP / OpenAPI / RPC 服务；不得通过 `pact.serviceHub` 创建任意外联 endpoint、保存外部服务配置、绑定 secretRef、刷新上游工具缓存或删除服务。为了注册易用性，控制台或 admin API 必须提供类型化 External Service Registration Template，用于生成 manifest 草稿、lint、dry-run plan、egress policy 预检和 contract verification；真正写入 registry 必须使用 operator/admin grant、显式确认、secretRef 绑定和审计记录。

首批注册模板必须按上游协议族分开维护，不能只提供一个“URL 转 MCP”万能表单：

- `external-service.template.raw-mcp-streamable-http`：原始 MCP Streamable HTTP 服务，默认 `upstream.type=mcp`、`upstream.transport=streamable-http`、`binding.mode=passthrough`、`binding.outlet=pact.serviceHub`，通过上游 `tools/list` 自动发现工具。
- `external-service.template.raw-mcp-sse`：原始 MCP SSE-over-HTTP 服务，默认 `upstream.type=mcp`、`upstream.transport=sse`、`binding.mode=passthrough`、`binding.outlet=pact.serviceHub`，通过旧 HTTP+SSE `endpoint` 事件建立 message endpoint，并通过上游 `tools/list` 自动发现工具；不等同于普通 event stream。
- `external-service.template.http-json`：HTTP JSON 服务，默认 `upstream.type=http`、`binding.mode=compile`，要求显式 `tools[]` 映射；生产公开服务不应使用该模板，除非 egress 和环境策略明确允许非 TLS 内网或开发地址。
- `external-service.template.https-json`：HTTPS JSON 服务，默认 `upstream.type=https`、TLS 校验开启，要求显式端口和 `tools[]` 映射；需要认证时只声明 `secretRef`，不保存 secret value。
- `external-service.template.json-rpc`：JSON-RPC 2.0 服务，默认 `upstream.type=json-rpc`、`rpcVersion=2.0`，每个工具映射到一个 JSON-RPC method；HTTP 200 内含 JSON-RPC `error` envelope 必须按失败工具调用处理。
- `external-service.template.sse`：普通 Server-Sent Events 服务，默认 `upstream.type=sse`，每个工具映射到一个受治理的 event stream，不等同于 MCP SSE transport；当前 runtime 只支持有界 finite response 解析，长连接生产转发必须等待 streaming/backpressure verifier。
- `external-service.template.openai-model-gateway`：OpenAI-compatible model gateway 转发，默认 `upstream.type=llm`，必须声明 `openai-compatible` 或 `openai-responses` 模型协议；未显式声明 `tools[]` 时自动生成 `chat_completions_create` 或 `responses_create` MCP 工具，并通过受治理 HTTP POST 转发 JSON 请求。redaction、audit、quota 和 model budget 由 production preset 物化，可按需覆盖；非 OpenAI LLM 协议 adapter 仍是 scaffold。

模板输出分三层：Template-selected Draft 是控制台或 admin API 已选模板后的最小填写面；Self-describing Registration Draft 是直接提交 JSON 时的最小草案，额外带 `templateId`；ServiceHub Materialized Manifest 是保存或 promote 前的运行时合同。已选模板时，`upstream.type`、原始 MCP `upstream.transport`、JSON-RPC `rpcVersion=2.0` 和普通 SSE `eventFormat=json-data` 都由模板注入，不再让服务所有者手填。直接 JSON 提交也只需要 `templateId` 来区分 HTTP、HTTPS、JSON-RPC、SSE 等协议族，仍不需要重复写 `upstream.type` 或 `transport`。

Template-selected Draft 可省略 `schemaVersion`、`kind`、`templateId`、`upstream.type`、MCP `upstream.transport`、`serviceName`、`displayName`、`mode`、`startupPolicy`、`binding`、`mcp`、`scopes`、`metadata`、`policyPreset` 和完整 `policies`。真正必填只剩 `serviceId`、协议族自己的 endpoint，以及非自动发现模板的 `tools[]` 最小映射。HTTP 与 HTTPS JSON 必须分开，二者都要求一个工具稳定名加 `method/path`；JSON-RPC 要求 `method` 或 `rpc.method`；普通 SSE 要求 stream 工具名并且必须等待 Streaming And Backpressure verifier 后才能生产 promotion。ServiceHub Materialized Manifest 在 operator/admin 保存或 promote 前必须记录采用的 `policyPreset`、展开后的 policy evidence、secretRef 状态、verification evidence、promotion metadata 和 `binding.outlet=pact.serviceHub`。

首批模板的最小可用组合固定如下。`schemaVersion`、`kind`、`policyPreset`、`serviceName`、`displayName`、`mode`、`startupPolicy`、`binding`、`healthCheck`、`metadata` 和 `policies` 默认隐藏；保存或物化 manifest 时由 ServiceHub 规范化补齐。

| 模板 | 已选模板后的最小必填组合 | 直接 JSON 提交时额外字段 | 组合可选字段 |
| --- | --- | --- |
| Raw MCP Streamable HTTP | `serviceId`, `upstream.url` | `templateId=external-service.template.raw-mcp-streamable-http` | `secret-auth` 整组：`upstream.auth.type` + `upstream.auth.secretRef`；`healthCheck` 整组；`timeout/deadline/retry` 按需 |
| Raw MCP SSE | `serviceId`, `upstream.url` | `templateId=external-service.template.raw-mcp-sse` | 同 Raw MCP Streamable HTTP；旧 HTTP+SSE runtime 会先 GET SSE endpoint 读取 `endpoint` 事件，再向 message endpoint POST JSON-RPC |
| HTTP JSON | `serviceId`, `upstream.baseUrl`, `tools[].name`, `tools[].method`, `tools[].path` | `templateId=external-service.template.http-json` | `secret-auth` 整组；`tools[].inputSchema`；`tools[].request.query/body/headers`；`tools[].response.resultPath`；`healthCheck`；`timeout/deadline/retry` |
| HTTPS JSON | `serviceId`, `upstream.baseUrl`, `tools[].name`, `tools[].method`, `tools[].path` | `templateId=external-service.template.https-json` | 同 HTTP JSON；额外要求 TLS 校验通过 |
| JSON-RPC 2.0 | `serviceId`, `upstream.url`, `tools[].name`, `tools[].method` 或 `tools[].rpc.method` | `templateId=external-service.template.json-rpc` | `secret-auth` 整组；`tools[].rpc.params`/`tools[].request.body`；`tools[].rpc.resultPath`/`tools[].response.resultPath`；多 endpoint 整组：`upstream.endpoints` + `tools[].rpc.endpointRef` |
| Generic SSE | `serviceId`, `upstream.url`, `tools[].name` | `templateId=external-service.template.sse` | `secret-auth` 整组；`tools[].transport.eventTypes`；`tools[].response.maxBytes`/`policies.streaming` |
| OpenAI-compatible model gateway | `serviceId`, `upstream.url`, `upstream.modelProtocol` | `templateId=external-service.template.openai-model-gateway` | `upstream.provider`；`secret-auth` 整组；`policies.modelBudget`/`policies.quota`；`policies.redaction`；`policies.routing`；`tools[]` 可省略，默认按协议生成一个模型转发工具 |

当前 control-plane 已提供只读模板辅助能力：

```text
GET /api/external-services/templates
POST /api/external-services/templates/draft
POST /api/external-services/verify
```

这些只读 operation 只能返回模板、字段说明、sanitized manifest draft、静态 lint、缺失字段、secretRef 缺口和 policy/verification plan；不能保存 registry、不能绑定 secret value、不能刷新工具缓存、不能删除服务，也不能把草稿变成可调用工具。普通 MCP agent 通过 `pact.discovery` 读取这些模板辅助能力仍需要单独的 Tool Management projection，未完成前不得把它描述为 agent 可直接调用能力。

Static Registration Dry Run 不得访问上游 URL，不得解析远端 OpenAPI spec，不得调用 MCP `initialize` / `tools/list`，不得测试模型 token，也不得做 DNS/端口探测。真实 External Service Contract Verification 只能是 operator/admin control-plane operation，并且必须先通过 egress policy 预检、显式确认、超时、限流和审计。允许的 live probe 也必须受限：原始 MCP 只允许 `initialize` / `tools/list`，HTTP/HTTPS 只允许 health 或显式 read-only probe，OpenAI-compatible model gateway 只允许鉴权/模型协议探测或配置中声明的最小测试请求。

ServiceHub MCP Transport Boundary 规定原始 MCP passthrough 必须是 HTTP/HTTPS 转发。`upstream.type=mcp` 只能使用带显式 URL、host、port 和 path 的 HTTP/HTTPS MCP transport，例如 Streamable HTTP 或 SSE-over-HTTP；`transport=stdio`、`command`、`args`、`cwd`、`env`、本机进程启动描述和 stdio-to-MCP bridge 不属于 ServiceHub 外部服务注册面，也不能通过模板、manifest、dry-run 或 admin 保存路径绕进去。本机 stdio MCP 会继承或接近本机配置、环境变量、文件系统、shell 权限和用户身份，容易被恶意工具描述、prompt injection 或上游工具调用链利用，因此不得作为“外部服务地址转 MCP”的生产能力。需要对接的本机 MCP 服务必须先由服务所有者以独立进程暴露为受控 HTTP/HTTPS MCP endpoint，再按 egress、secretRef、Tool Adoption Gate 和 Output Governance 注册到 ServiceHub。

ServiceHub MCP Capability Firewall 规定外部 MCP passthrough 只桥接工具能力。Pact 作为上游 MCP client 只允许使用 `initialize`、`tools/list` 和 `tools/call`；上游声明或发送的 `resources`、`prompts`、`roots`、`sampling`、`elicitation`、`logging`、任意非工具 notification、client callback 或反向请求能力都不得透传给下游 agent，也不得让上游要求 Pact/agent 执行模型采样、读取本机/工作区资源、注入 prompt、打开额外交互通道或订阅事件。上游 `notifications/tools/list_changed` 只能作为内部“候选目录可能变化”信号，必须重新走 Tool Adoption Gate 和 operator/admin 采纳，不能直接改变下游 `tools/list`。如果上游工具返回资源、prompt、HTML、富文本或大对象，这些内容只能按 Output Governance 作为不可信数据处理：安全文本/JSON 可脱敏投影，资源类结果必须变成 AgentLibrary/SharedSpace 受管 asset/ref，prompt 类内容不得升级为系统提示、工具说明或授权策略。

`pact.serviceHub` 调用必须使用 Manifest-Bound Request Mapping。普通 MCP agent 的 `input` 只能包含当前 tool `inputSchema` 声明并通过校验的业务字段；上游 `url`、`baseUrl`、`method`、`path`、`transport.headers`、`Authorization`、cookie、proxy、TLS 选项和 retry/timeout 上限只能来自已注册 manifest、服务端 policy 和 secretRef 注入。manifest 也不得把 `headers`、`url`、`method`、`path`、`authorization` 或 `token` 这类自由对象直接映射为 agent 可控字段；如确需业务 header，必须逐字段 allowlist、逐字段 schema 校验、逐字段 redaction/audit 声明。这样 `pact.serviceHub` 不能退化成通用 HTTP 代理。

ServiceHub Mapping Sandbox Contract 规定 request mapping、response mapping、error mapping、`bodyTemplate` 和 `transform` 只能运行在声明式安全子集内。manifest 不得携带 JavaScript/eval/WASM/插件脚本、shell、正则灾难回溯、文件读取、网络请求、环境变量读取、进程信息读取、系统时间随机源、SecretStore 直接读取或任意自定义函数。mapping 只能引用当前已校验 input、manifest 常量、服务端允许的 redacted metadata 和已授权 projection/ref；不得动态覆盖 upstream URL、method、path、auth、cookie、proxy、TLS 或 wildcard header，也不得把 secretRef、hidden prompt、内部路径、授权 overlay 或 raw asset 拼接进请求。运行时必须给每个 mapping 设置表达式长度、模板大小、输出大小、JSON 深度、数组长度、CPU/耗时、内存和递归上限；失败统一返回 `mapping_input_invalid`、`mapping_sandbox_violation`、`mapping_timeout` 或 `mapping_output_too_large`，写 denied audit 和 `externalCallReceipt`，receipt 只记录 mapping policy、失败类型、字段摘要和 auditRef，不记录中间值或渲染后的 request body。

ServiceHub Outbound Payload Governance 是发往上游前的必经出口。即使 agent 输入已经通过 tool `inputSchema`，运行时仍必须按 manifest/policy 校验可外发字段、数据类别、最大字节数、最大 JSON 深度、最大文本长度、数组长度、附件/ref 处理方式和 redaction 规则。默认只允许用户显式提供且当前 grant 可外发的数据，以及 manifest 明确声明的最小业务字段；secret、token、cookie、hidden/system/developer prompt、Pact internal instruction、原始 workspace 文件、原始 AgentLibrary/loanRecord 内容、未授权 dataClass、未经 checkout/export 授权的 asset/ref、调试上下文和完整 conversation transcript 默认不得外发。需要把 AgentLibrary/SharedSpace 内容发给上游时，必须先通过对应授权、生成可审计的 derived/projection view，并只发送 manifest 允许的脱敏片段或受管 ref；不能把原始资产、内部路径或权限覆盖信息直接塞进 request body。被阻断时返回标准化 `outbound_payload_blocked`，写 denied audit 和 `externalCallReceipt`，receipt 只记录 outbound governance decision、字段摘要、dataClass 摘要和 redaction summary，不记录 request body 原文。

ServiceHub Secret Binding Contract 规定外部服务凭证只能由 operator/admin control plane 绑定、写入、轮换和撤销。注册模板、`pact.discovery` 草稿和 dry-run 只能生成 secret slot、建议的 `secretRef` 占位、缺失凭证诊断和 `credentialConfigured/missing` 状态；普通 MCP agent 不能提交、读取、更新、轮换 secret value，也不能通过 `pact.serviceHub` 或 discovery operation 重新绑定 secretRef。持久化 manifest 只能保存 `secretRef`、auth scheme、允许的上游 host/protocol/scope 和脱敏投影，不能保存 bearer token、API key、basic password、OAuth access/refresh token、cookie 或 provider session。运行时只能在服务端解析 SecretStore 中的 secretRef，并注入到已注册 manifest 声明的 auth/transport 位置；如果 secretRef 的 service、tenant/workspace、allowed host/protocol、auth scheme 或 scope 与 manifest 不匹配，调用必须 fail closed。secret 轮换、撤销、scope 降级或 SecretStore 条目失效必须使相关上游 MCP session、连接 auth context、工具发现缓存和健康状态失效，并要求重新通过受控 health/contract verification 后才能恢复 healthy。trace、audit、catalog、tool output、错误信息和导出包只允许出现脱敏摘要或 audit ref，不得出现 secret value。

ServiceHub Egress Policy 默认拒绝。每个外部服务注册 manifest 必须显式声明允许的 protocol、host、port 和地址类别；未声明时不能访问网络。生产默认禁止 loopback、localhost、私有网段、link-local、云 metadata 地址、Kubernetes/Docker/OrbStack/本机管理端口以及其它管理平面地址。只有本机开发模式或 operator/admin 显式授权的 local service 可以放开这些地址，并且必须带 owner、用途、到期时间和审计。调用执行时必须在 DNS 解析后校验实际 IP，HTTP redirect 后必须重新执行同一校验；host 字符串 allowlist 不能替代解析后地址校验，以防 DNS rebinding、重定向 SSRF 和别名绕过。

外部 MCP passthrough 必须执行 ServiceHub MCP Session Isolation。Pact 可以复用底层 TCP/HTTP 连接池，但上游 MCP `initialize` 后形成的 session state、tool auth context、cursor、pagination token、conversation id 和任何带状态的上游上下文，默认必须按 `serviceId + Pact grant/subject + workspace/tenant + auth binding` 隔离。manifest 只有在上游被验证为 stateless 且显式声明 `sharedSessionSafe=true` 时，才可以共享无状态连接资源；即使如此，也不能把一个 agent 的 MCP session id、cursor 或认证上下文返回给另一个 agent 使用。grant 撤销、secretRef 轮换、workspace/tenant 解绑或 service disable 必须使相关上游 MCP session 失效。上游 session id、cursor、pagination token 和 conversation id 按 secret-like runtime state 处理，只能写入脱敏审计摘要，不能作为 tool output 返回给 agent。

外部 MCP passthrough 发现到的 `tools/list` 结果必须经过 ServiceHub Tool Adoption Gate，不能原样暴露给下游 agent。每个上游工具必须进入 `serviceId` 命名空间并生成稳定 Pact operation id，例如 `pact.externalMcp.<serviceId>.<toolName>`；上游 `name`、`title`、`description`、`annotations`、`inputSchema` 和任何 instructions 都是不可信元数据。Pact 必须限制描述和标题长度、清洗 prompt-injection 指令、拒绝或裁剪危险 annotations、把 JSON Schema 收敛到受支持安全子集，并基于 manifest/default policy 重新判定 read/write/destructive risk。上游工具缓存必须记录 fingerprint、discoveredAt、schema/version 摘要和 operator-visible diff；新增工具、schema 扩权、risk 升级、description/instruction 大幅变化或新增 destructive/write 能力默认不可见，直到 operator/admin 显式采纳并刷新授权投影。同名 fingerprint 变化不得由 refresh 直接替换 active catalog，而应保留旧 active 并生成 replacement candidate；上游不再返回已采纳工具时，refresh 必须写入 tombstone evidence 并保持 active catalog 稳定，直到 operator/admin 显式禁用、替换或回滚。采纳请求可以携带 operator 审查时看到的 expected tool fingerprint；当前 candidate fingerprint 不匹配时必须返回 stale candidate，不得把刷新后的未知候选误采纳。

ServiceHub Versioned Promotion Contract 规定注册后的上游变化必须走双阶段发布。上游 `tools/list` refresh、tool schema 变化、risk/annotation/description/instruction 变化、endpoint/baseUrl/path/TLS/redirect/egress 变化、secretRef 绑定变化、model protocol 变化、output policy 变化或 manifest policy 变化，都必须先写入 candidate catalog version，并生成 operator-visible diff、fingerprint、contract verification 计划、Tool Adoption Gate 结果、grant projection impact、回归验证结果和 rollback plan；不得直接覆盖 active production catalog。只有 operator/admin 执行 `promote` 后，candidate 才能成为 active，并更新 projection version、发出必要的 `notifications/tools/list_changed`、失效相关 session/cache/health state。旧 active version 必须保留为 rollback target；已有 grant 在迁移窗口内可继续绑定旧版本，直到新版本通过 contract verification、Tool Adoption Gate、grant projection 和回归验证。`rollback` 也必须是 operator/admin operation，写入审计、恢复 projection version、失效新版本 session/cache，并禁止把失败 candidate 的 schema/risk 残留给下游 agent。普通 MCP agent 只能看到脱敏状态、diff 摘要和需要人工处理的提示，不能 promote、rollback、force refresh active 或绕过版本门禁。

ServiceHub Grant Projection Contract 规定外部工具的可见性必须按当前 grant 显式裁剪。一个工具被采纳只表示它进入 ServiceHub 稳定候选 catalog；对某个 agent 可见还必须同时满足 service enabled、tool adopted、当前 grant 允许 `serviceId` 和 `operationId`、tool risk 不超过 grant `maxRisk`、tenant/workspace 匹配、egress policy 允许、dataClass 允许、secret binding 为 configured 且 scope 匹配、service 未被 operator/admin 禁用。未授权时默认隐藏工具存在性：`tools/list`、`pact.capabilities.list` 和 discovery projection 不返回该 service/tool 的名称、schema、描述或健康状态。每次 `pact.serviceHub` 调用仍必须按最新策略实时裁决，不能因为工具曾出现在 `tools/list` 就跳过授权；grant 变更、tenant/workspace 解绑、risk policy 变更、egress/dataClass policy 变更、secret binding 失效或 service disable 必须触发 projection version 更新和必要的 `notifications/tools/list_changed`。调用未授权工具时返回不泄露存在性的标准错误，并写 denied audit，不能把未授权表现为上游不可用或 schema 错误。

ServiceHub Health And Circuit Breaker 把“工具目录是否存在”和“上游当前是否可调用”分开。`tools/list` 和 `pact.capabilities.list` 必须来自已采纳的稳定 catalog 与当前 grant projection；上游临时宕机、超时、健康检查失败、DNS 临时失败或 circuit open 不得自动删除工具、不得触发 schema 回退，也不得把工具目录改写成上游实时状态。只有 operator/admin 显式采纳、禁用、删除、schema/risk 变更或授权策略变更，才改变可见工具目录并触发 `notifications/tools/list_changed`。调用时如果上游不可用，Pact 返回标准化 `upstream_unavailable`、`service_degraded` 或 `circuit_open` 错误，包含 redacted message、retry hint、serviceId、operationId、health state 和 audit ref，不泄露内部 URL、token、provider debug 或网络细节。连续失败必须进入 circuit breaker：按 service/operation/auth binding 维度记录失败窗口、打开熔断后 fail fast、限制并发和探测频率，半开状态只允许受限健康探测或 read-only contract recheck；恢复 healthy 必须通过 health/contract recheck 并写入审计。熔断不能绕过 ServiceHub Retry Semantics，不能制造自动重试风暴，也不能把未知副作用写操作误判为可重放失败。

ServiceHub Quota And Bulkhead Contract 规定外部服务调用必须分舱隔离和预算化。每个 production profile、service、operation、tenant/workspace、grant/subject、auth binding、upstream host、transport class 和 model gateway 都必须有可验证的 rate、concurrency、queue、connection、worker、byte、stream event、retry、token 和 cost budget。队列必须有最大长度和 TTL，禁止无界排队；连接池、worker pool、stream buffer 和 model gateway budget 必须至少按 service/auth binding 隔离，并受全局上限保护，不能让单个外部服务、单个 agent 或单个上游 host 耗尽全局 ServiceHub 容量。所有 retry、stream chunk、partial result、模型 token 和上游返回字节都必须计入预算；agent input 不能覆盖配额、优先级、队列策略、连接池、worker pool 或成本预算。超限时返回标准化 `quota_exceeded`、`concurrency_limited`、`queue_full`、`queue_timeout`、`bulkhead_saturated`、`byte_budget_exceeded` 或 `model_budget_exhausted`，写 denied/limited audit 和 `externalCallReceipt`；receipt 只记录维度、预算类型、剩余额度 bucket、bulkhead decision 和 auditRef，不记录请求/响应内容。Quota/Bulkhead 失败不能表现为上游错误，也不能触发盲目 retry storm；被限流调用不得占用后续 deadline lease、stream buffer 或上游连接。

ServiceHub Error Taxonomy And Retry Hint Contract 规定所有外部服务调用错误都必须由 Pact 归一化。ServiceHub 不能把上游 HTTP body、MCP error、provider exception、TLS/DNS/socket detail、stack trace 或 provider debug 原样返回给 agent；对外统一返回稳定 MCP error envelope，包含 `pactCode`、`category`、redacted `message`、`retryable`、可选 `retryAfterMs`、`unknownOutcome`、`auditRef`、可选 `receiptRef`，以及只有在当前 grant 可见时才返回的 `serviceId`、`operationId` 和 `catalogVersion`。错误分类至少覆盖 `visibility_or_authorization`、`policy_denied`、`manifest_or_contract`、`egress_denied`、`secret_unavailable`、`mapping_failed`、`outbound_blocked`、`quota_or_bulkhead`、`deadline_or_cancelled`、`stream_failed`、`output_blocked`、`upstream_unavailable`、`upstream_protocol`、`unknown_external_outcome` 和 `internal_servicehub_error`。标准 `pactCode` 至少包括 `not_found_or_not_authorized`、`grant_denied`、`service_disabled`、`tool_not_adopted`、`contract_verification_required`、`egress_denied`、`secret_missing`、`secret_scope_mismatch`、`mapping_input_invalid`、`mapping_sandbox_violation`、`mapping_timeout`、`mapping_output_too_large`、`outbound_payload_blocked`、`quota_exceeded`、`concurrency_limited`、`service_busy`、`queue_full`、`queue_timeout`、`bulkhead_saturated`、`byte_budget_exceeded`、`model_budget_exhausted`、`upstream_unavailable`、`service_degraded`、`circuit_open`、`deadline_exceeded`、`call_cancelled`、`stream_limit_exceeded`、`stream_cancelled`、`stream_backpressure`、`partial_result_truncated`、`output_governance_blocked`、`upstream_error`、`upstream_protocol_error` 和 `unknown_external_outcome`。`retryable` 和 `retryAfterMs` 只能由 ServiceHub policy、operation risk、idempotency、ledger attempt/fence、circuit state 和 quota budget 共同决定；上游返回的 retry header 只能作为输入信号，不能直接成为 agent-visible 指令。未授权、未采纳、service disabled 或 grant 不可见时默认返回不泄露存在性的 `not_found_or_not_authorized`，不能暴露服务名、schema、health、quota bucket 或 provider 状态。所有错误都必须写 denied/failed/limited audit 和 receipt，且 receipt 中只保存 error taxonomy decision、status class、retry hint 和 redacted evidence ref。

ServiceHub Deadline And Cancellation Contract 规定每次外部服务调用必须有服务端强制 deadline、并发租约和 orphan cleanup。普通 MCP agent 不能通过 input 覆盖 `timeoutMs`、deadline、lease TTL、并发上限或取消策略；这些值只能来自 manifest、Tool Management policy、ServiceHub policy 和服务端保护上限，且运行时必须取更严格者。调用开始前必须获取 service/operation/auth binding 维度的 concurrency lease，写入 Operation Ledger attempt/fence；拿不到租约时返回标准化 `service_busy` 或 `concurrency_limited`，不能排队成无界等待。client 断连、MCP request cancel、deadline 到期或服务端 shutdown 时，Pact 可以向上游 HTTP/MCP transport 传播 abort/cancel，但取消是 best-effort：只读调用可返回 `cancelled`，副作用调用只有在上游明确证明未执行时才能视为取消；否则必须进入 `unknown_external_outcome` 或 manifest 声明的 reconciliation path。deadline 到期后必须释放本地租约、记录 redacted timeout evidence、更新 circuit breaker 计数，并启动 orphan cleanup 或状态核对；不能让悬挂上游调用继续占用并发槽，也不能在后台静默完成后把结果写给已断开的 agent。长调用必须有最大执行时长、心跳或 progress 策略、lease expiry、清理审计和恢复路径，防止少量挂死上游拖垮整个 ServiceHub。

ServiceHub Reconciliation And Recovery Contract 规定所有可能产生外部副作用的 ServiceHub 工具必须有受管恢复路径。`safe_write`、`repair_write`、`destructive`，以及 manifest 标记 `sideEffecting=true` 的操作，在 candidate promote 前必须声明 `policies.reconciliation.failClosed=true`，并至少提供以下一种恢复能力：operation-scoped idempotency key、read-only status query、manifest-bound reconciliation operation、manifest-bound compensation operation、或 operator recovery workflow。没有恢复策略的副作用工具只能保持不可见，不能进入下游 `tools/list`。当 timeout、disconnect、ambiguous upstream failure、best-effort cancel 或 stream interruption 产生 `unknown_external_outcome` 时，Pact 必须创建 recovery record，记录 operation ledger attempt/fence、idempotency key fingerprint、external reference fingerprint、candidate recovery operations、deadline/circuit evidence 和 auditRef；在恢复完成前，自动 retry、重复提交和 destructive follow-up 必须 fail closed。恢复结果状态必须归一化为 `confirmed_succeeded`、`confirmed_no_effect`、`confirmed_failed_with_effect`、`compensated`、`still_unknown` 或 `requires_operator_recovery`。agent 只能在当前 grant 允许时读取脱敏 recovery status 或触发 manifest 声明的 read-only status query；不能伪造 resolved 状态、写 recovery evidence、改 idempotency key、选择任意 URL，或把 operator recovery 当作自动审批。所有恢复调用仍然经过 manifest-bound invocation、egress、secret injection、mapping sandbox、outbound payload governance、quota/bulkhead、error taxonomy、output governance 和 externalCallReceipt。

ServiceHub Streaming And Backpressure Contract 规定上游流式响应不得原样透传。raw MCP streamable-http、SSE、HTTP chunked、模型网关 streaming 或其它分块事件流，都必须先进入受控 streaming runtime：按 manifest allowlist 校验 event type/content type，限制单 chunk 字节数、总字节数、总时长、event rate、缓冲区大小和并发占用；每个 chunk/frame/event 在发给 agent 前都必须经过 Output Governance 和 redaction，不能把 headers、cookie、provider debug、partial stack、token 片段或未经授权 asset 内容混在流里透出。下游 backpressure 必须向上游读取侧传播或触发受控 buffer-then-error，不能无限缓存；client cancel、deadline 到期或 buffer 超限必须停止读取、释放 lease、记录 partial evidence，并按 policy 返回 `stream_limit_exceeded`、`stream_cancelled`、`stream_backpressure` 或 `partial_result_truncated`。partial result 只能是已治理片段或 governed asset/ref；不得在错误路径返回未经治理的尾包。streaming summary、chunk counts、bytes、duration、partial/truncated 标记和 backpressure decision 必须写入 receipt/audit，但不记录原始 chunk 内容。

ServiceHub External Call Receipt 是每次外部服务调用的必备回执。每次 `pact.serviceHub` 调用无论成功、拒绝、mapping sandbox 阻断、quota/bulkhead 限制、错误归一化、超时、熔断、取消、上游错误、outbound payload 阻断、streaming/backpressure 中止、输出治理失败、recovery 状态变化或 `unknown_external_outcome`，都必须写入脱敏 `externalCallReceipt` 并返回/关联 `auditRef`。receipt 至少包含 `receiptId`、`traceId`、`operationLedgerId`、`serviceId`、`catalogVersion`、`operationId`、`grantId/subjectId` 脱敏引用、`tenantId/workspaceId`、risk、tool adoption fingerprint、catalog binding fingerprint、service/materialized manifest fingerprint、egress decision、mapping sandbox decision、outbound governance decision、quota/bulkhead decision、error taxonomy decision、reconciliation decision、streaming/backpressure decision、secretRef fingerprint、auth binding id、deadline/lease 摘要、retry attempt、circuit state、upstream status class、latency bucket、output governance decision、redaction summary、assetRef 列表、unknown outcome 标记、recovery status、error code、retry hint 和 audit ref。receipt 不得包含 secret value、Authorization/header 原文、cookie、原始 URL query、request body 原文、response body 原文、mapping 中间值、provider debug、stack trace、内部路径、私有对象 id、完整上游 request id 或原始 stream chunk；如确需排障，只能保存已注册 evidence store 中的受控 redacted evidence ref，并受 retention/redaction policy 管理。denied 调用也必须有 denied receipt/audit，但默认不泄露服务或工具存在性。当前实现已记录 materialized manifest fingerprint、全局 Tool Management catalog fingerprint、per-operation catalog binding fingerprint、service fingerprint、tool adoption fingerprint 和 grant projection fingerprint；仍需把这些指纹与真实 egress evidence、quota/bulkhead ledger、mapping sandbox evidence、output governance evidence、deadline lease、auth binding evidence、recovery record 和 catalog snapshot retention 完整绑定。

ServiceHub Production Verification Matrix 是 `pact.serviceHub` 上线和 promote 的阻断级 gate。每个 ServiceHub production profile、每个外部服务模板和每个 candidate catalog version 都必须产生机器可验证 evidence；缺少 evidence 或 verifier 失败时，candidate 不得 promote，active catalog 不得被覆盖，相关 tool 不得进入下游 `tools/list`。matrix 至少覆盖：七个稳定 outlet 且无 `pact.knowledge`/`pact.call` 旧入口；raw MCP 拒绝 stdio、command、本机进程和 local bridge；模板 dry-run 不联网；manifest-bound invocation；Mapping Sandbox 阻止脚本执行、文件/网络/环境访问和动态 URL/auth/header 覆盖；Outbound Payload Governance 防止 secret、hidden prompt、workspace/AgentLibrary 原文和未授权 dataClass 外发；egress 对 SSRF、DNS rebinding、redirect 和受限地址 fail closed；secret 只通过 SecretStore 注入且日志/trace/output 无泄露；Tool Adoption Gate 对恶意描述、schema 扩权和风险升级阻断；Grant Projection 的可见性和调用实时授权；MCP Capability Firewall 拒绝 resources/prompts/sampling/client callback 等非工具能力；Quota/Bulkhead 隔离 service/operation/tenant/grant/auth-binding/worker/connection/stream/model budget；Error Taxonomy/Retry Hint 归一化所有策略、上游、stream、output、timeout 和 unknown outcome 错误且不泄露内部细节；Reconciliation/Recovery 要求副作用工具有幂等、状态查询、reconcile、compensation 或 operator recovery 路径；health/circuit 不改写工具目录且 fail fast；deadline/cancel/lease/orphan cleanup 和 `unknown_external_outcome`；Streaming And Backpressure 阻止 raw stream/chunk 绕过输出治理；versioned promotion/rollback；Output Governance；`externalCallReceipt` 字段完整且脱敏。普通 MCP agent 可以看到脱敏 verifier summary，但不能跳过、覆盖或伪造 verifier evidence；live verification 仍然只属于 operator/admin control plane。

ServiceHub Output Governance 是所有外部服务调用的必经出口。上游返回值不能原样返回给下游 agent；Pact 必须按 manifest/policy 限制 content type、最大字节数、最大 JSON 深度/数组长度、最大文本长度和错误详情级别。允许 inline 返回的内容只限结构化 JSON 与安全文本投影，并必须执行敏感字段、secret pattern、token、cookie、内部路径、私有对象 id、上游 request id 和 provider debug 信息脱敏。上游 response headers、set-cookie、redirect header、server banner、trace header 和认证相关 header 不得透传给 agent。HTML、script、富文本、二进制、压缩包、图片、音视频、大结果或未知 content type 必须登记为受管 asset/ref，并通过 AgentLibrary/SharedSpace 权限再读取。上游错误也必须归一化为 Pact error code、redacted message、retry hint 和 audit ref，不能泄露上游 token、内部 URL、私有路径或完整 stack trace。

ServiceHub Retry Semantics 默认不自动重试。只有 `risk=read_only` 且 manifest 明确声明 idempotent 的操作可以按显式 retry policy 自动重试；`safe_write`、`repair_write` 和 `destructive` 操作必须默认 `maxAttempts=1`，除非 manifest 声明 `idempotency.required=true`、调用提供 `idempotencyKey`、Operation Ledger 已记录 attempt/fence、并且策略明确允许有限重试。外部写操作超时、连接中断或上游返回 ambiguous failure 时，Pact 必须把调用标为 `unknown_external_outcome`，不能把它当作失败后盲目重放；后续只能通过 manifest 声明的 status query、reconciliation operation、compensation operation、恢复 workflow 或 operator/agent 可见的处理路径继续。

每次 `tools/call` 执行完成或失败后，服务端必须通过同一 grant 的 SSE 连接推送主动回信：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/pact/operation_reply",
  "params": {
    "schemaVersion": "v0.0.1:operation:reply-schema-1",
    "status": "completed",
    "operation": "workspace.file.upload",
    "envelope": { "traceId": "mcp_trace_...", "idempotencyKey": "mcp_intent_..." },
    "target": {
      "schemaVersion": "v0.0.1:operation:reply-target-schema-1",
      "targetKind": "sharedspace",
      "targetProvider": "pact",
      "targetRef": "workspace-1",
      "workspaceId": "workspace-1",
      "status": "completed"
    },
    "payload": {}
  }
}
```

对 Codespace 上传，`target` 必须能表达 `targetKind=codespace`、`targetProvider`、`repositoryRef`、`branch`、`changeRef`、`reviewUrl` 或 provider durable id；不能只返回“已执行”而不告诉智能体数据送到了哪里。

#### Version upgrade push

MCP interface version 固定从 `v0.0.1:mcp:interface-1` 开始。服务端必须在三个位置暴露版本：

- `initialize.result.serverInfo.version`
- `initialize.result._meta.interfaceVersion` / `toolsetVersion`
- `GET /.well-known/pact/mcp.json` 和 `GET /api/mcp/discovery`

服务端声明 `capabilities.tools.listChanged = true`。当工具 schema、interface version 或 toolset version 变化时，支持 Streamable HTTP 的客户端可通过 `GET /mcp` 的 SSE 事件收到 JSON-RPC notification：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed",
  "params": {
    "interfaceVersion": "v0.0.1:mcp:interface-1",
    "toolsetVersion": "2026-05-25.1",
    "categorizedOutlets": ["pact.discovery", "pact.agentLibrary", "pact.sharedspace", "pact.codespace", "pact.skillHub", "pact.agentRelay", "pact.serviceHub"],
    "removedToolNames": ["pact.call", "pact.knowledge"]
  }
}
```

不支持持续 SSE 的客户端通过下一次 `initialize`、`tools/list` 或 `pact.discovery({ "operation": "pact.mcp.version" })` 获取版本变化。只有 endpoint、auth 或客户端插件 manifest 变更时才需要重新运行 `pact-mcp register` 或按单客户端重新连接。

#### ACP Agent Relay discovery over MCP

ACP Agent Relay 作为独立顶层 MCP outlet 暴露为 `pact.agentRelay`。它仍然只接收 Intent Operation envelope，并继续进入 Tool Management、Operation Scheduling、权限和审计路径；它不是绕过治理的 agent socket proxy。

让客户端在启动第一秒知道 Pact 具备 ACP Relay 能力的路径是：

1. `initialize.result._meta.capabilityFamilies.agentRelay` 和 `tools/list.result._meta.capabilityFamilies.agentRelay` 声明 Pact 支持 `v0.0.1:agent:acp-agent-relay-1`，并给出 `templateOperation=pact.agentRelay.templates.list`、`mcpOutlet=pact.agentRelay`。
2. 客户端调用 `pact.discovery({ "operation": "pact.capabilities.list" })`，读取 `structuredContent.capabilityFamilies.agentRelay`，根据当前 grant 判断 `canView` / `canOperate`。
3. 客户端通过 `pact.agentRelay` 调用 `operation=pact.agentRelay.templates.list` 取得服务端模板，然后按模板调用 `pact.agentRelay.session.create` 和 `pact.agentRelay.prompt`。
4. `pact.discovery` 只负责发现和模板指引；注册目标、创建 session、发送 prompt、取消或关闭 Relay session 都必须通过 `pact.agentRelay` outlet 进入 Tool Management、Operation Scheduling、权限和审计路径。

启动发现返回的是统一 Relay participant 目录，而不是某一个目标的特例目录。可用虚拟智能体可以通过 `agent/list` 或服务端模板暴露为可选择项；缺失命令或缺失 adapter 的目标通过 `target/list` 暴露 disabled target descriptor 和原因。客户端只选择虚拟智能体或模板字段，不把 `opencode acp`、`copilot --acp`、CSRF token、API endpoint 或其它启动细节拼进 prompt。Pact 根据目标描述启动 native ACP、官方 ACP adapter、registry-imported ACP distribution、Agent API proxy 或受管 CLI fallback，并在 source-facing descriptor 中暴露 enabled/disabled 状态、通信模式和安全元数据。只要发现到 ACP，Pact 就使用现成 ACP，不把它重新封装成新的非 ACP 命令协议。

示例：

```text
pact.discovery({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.capabilities.list", "input": {} })
pact.agentRelay({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.agentRelay.templates.list", "input": {} })
pact.agentRelay({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.agentRelay.session.create", "input": {...} })
pact.agentRelay({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.agentRelay.prompt", "input": {...} })
```

#### Installation and doctor commands

设备级 Hub 注册入口：

```bash
npm run server:mcp:register
npm run server:mcp:discover-local -- --json
```

开发调试安装入口：

```bash
npm run server:mcp:install -- --target auto --json
npm run server:mcp:install -- --target claude-code,codex,openclaw --json
npm run server:mcp:install -- --target kilo-code
npm run server:mcp:install -- --target copilot
npm run server:mcp:install -- --target openclaw --vm kate
npm run server:mcp:install -- --target hermes --vm serena
npm run server:mcp:install -- --target antigravity
```

诊断入口：

```bash
npm run server:mcp:discover
npm run server:mcp:doctor
npm run server:verify:mcp-http
```

`server:mcp:doctor` 必须验证：

1. 是否能发现签名有效的 Pact MCP 服务。
2. `POST /mcp initialize` 是否成功。
3. `tools/list` 是否只返回 `pact.discovery`、`pact.agentLibrary`、`pact.sharedspace`、`pact.codespace`、`pact.skillHub`、`pact.agentRelay`、`pact.serviceHub`。
4. `tools/call pact.discovery` 调用 `operation=pact.mcp.version` 是否成功，`tools/call pact.sharedspace` 调用一个已授权 workspace operation 是否成功。
5. 统一 registry `~/.pact/mcp/servers.json` 是否存在并指向已签名验证的当前服务。
6. 每个显式 opt-in 的 target 配置是否包含 Pact MCP。
7. OrbStack VM 是否能访问 discovery 返回的 `vmHttpUrl`。

#### Implementation boundary

MCP handler 不能直接读写文件夹、知识库内部实现、外部服务实现或 Tool Management platform internals。所有 `tools/call` 都必须先进入七个语义入口，再通过 `v0.0.1:tool:skill-management-1` provider 落到现有 Operation Registry、Tool Management、Workspace API、Policy Engine、Operation Ledger、Checkpoint Tree 和 storage metadata。MCP adapter 只做协议转换、身份注入、版本协商、错误规范化和 streaming / stdio transport 兼容。

本机五阶段演示使用的是内部 operation id，不是 MCP tool name。调用方式固定为通过语义入口传递 `operation`：

```text
pact.sharedspace({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "workspace.file.upload", "input": {...} })
pact.sharedspace({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "workspace.file.list", "input": {...} })
pact.agentLibrary({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "knowledge.search", "input": {...} })
pact.skillHub({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.skillHub.list", "input": {...} })
pact.agentRelay({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.agentRelay.prompt", "input": {...} })
pact.serviceHub({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.externalMcp.demo.search", "input": {...} })
pact.discovery({ "apiVersion": "v0.0.1:mcp:interface-1", "operation": "pact.capabilities.list", "input": {} })
```

工具命名要对智能体稳定。内部可以把 operation `workspace.file.upload` 映射为 `workspace.contribution.submit(type=file)`，把 `workspace.file.list/download` 的结果投影成 asset 视图，但 MCP 对外工具名只能是七个语义入口，不能在演示过程中漂移。

Checkpoint 使用现有协议正名：`workspace.checkpoint.tree.list`、`workspace.checkpoint.restore.preview`、`workspace.checkpoint.restore`。这些是 operation id，不是公开 MCP tool name；实施讨论里的 `workspace.checkpoint.list/preview/restore` 只作为简称。

OpenClaw 文档互通演示：

1. OpenClaw A 调用 `workspace.contribution.submit`，把本地文档提交为 `knowledge` 或 `file` 资产。
2. Pact 在真实内容到达服务器并完成最小留档后生成 `contribution.submitted`、`contribution.previewed`、`asset.preview`、`snapshot.created` 和 `auditId`。
3. 资产通过权限、风险、许可、重复性和审核策略后进入 `contribution.published`。
4. OpenClaw B 调用 `workspace.file.list` 或带 `workspaceId` 的 `knowledge.search` 查找目标 workspace 中可见的文档。
5. B 调用 `workspace.file.download`；策略通过后返回下载状态报文、`loanRecord`、`knowledgeAccessReceipt` 和 transfer id。只有内容真实传完并完成校验后，才记录 `asset.downloaded`。

Skill 贡献排行榜演示（Skill Hub 采用排行榜）：

1. OpenClaw A 调用 `pact.skillHub.upload`，上传 Skill manifest、说明、执行约束和必要文件，并设置默认可见策略。
2. Pact 在 Skill manifest 和必要文件到达服务器后进入 capability package lifecycle，权限、风险、许可和审核通过后才发布到独立 Skill Hub / SkillLibrary，并刷新 MCP `pact.skillHub` discovery。
3. Workspace contribution 只能记录来源、审核、采用、排行榜和引用关系，不能作为技能包文件、版本、发布状态或启用状态的事实源。
4. OpenClaw B 通过面板或 `pact.skillHub.list` 看到该 Skill。
5. B 调用 `pact.skillHub.download` 或安装后上报 `pact.skillHub.usage.report`。
6. Pact 只在 Skill 文件真实传完并校验成功后记录 `skill.downloaded`；安装完成后记录 `skill.installed`；实际调用完成后记录 `skill.used` 并执行 `usageCount += 1`。成功使用会提高 `successRate`，跨 workspace 采用会提高 `uniqueWorkspaceAdoptions`，随后刷新 `rankScoreV0`。

`workspace.skill.upload/list/download/usage.report` 只能作为兼容 operation 保留；如果存在，必须路由到 Skill Hub / capability package lifecycle，不能直接写 workspace contribution registry，并要求使用 `workspace.skill.usage.report` 上报使用结果。

兼容 operation 映射要求：

- `workspace.skill.list` 在统一入口中可见，但其输出必须是基于 SkillHub 可见技能引用的资产面投影；技能包事实（版本、生命周期、发布状态、撤销状态）由 `pact.skillHub` 与 capability package registry 持有。
- `sharedspace.drive.connect` 属于 v0.0.1 Cloud Drive 语义入口，按协议应通过 Tool Management catalog 暴露为 `pact.sharedspace.drive.connect`，并由统一策略与审计路径治理。

## Tool/Skill Management Provider Protocol

`v0.0.1:tool:skill-management-1` 是通用工具与技能的应用层 provider 协议。它聚合 Tool Management catalog/grant/runtime、Skill Hub 语义出口、MCP local grant、workspace ref 公共映射、MCP 输出脱敏和 MCP client connection projection。

服务层和 MCP adapter 的约束：

- 只能调用 `toolSkillManagementProvider.authorizeRequest/listVisibleTools/executeTool/resolveMcpWorkspaceInput/publicMcpToolPayload/createLocalMcpGrant/markLocalMcpGrantUninstalled` 等 provider 方法。
- 不能直接读取 Tool Management platform 的 `registry`、`store`、`runtime` 或 `router`。
- console grant、MCP authorization request、Tool Management HTTP passthrough 和 client connection projection 也必须通过 provider 进入 Tool/Skill 子系统。

验收守卫：`npm run server:verify:tool-skill-management` 必须确认 MCP adapter 没有回退到 Tool Management internals，并验证 provider 的授权、可见 operation、执行、local grant、workspace ref 和输出脱敏行为。

## Code Review Route Protocol

`v0.0.1:platform:code-review-1` 管理代码上传的目标选择、Gerrit change 创建和状态同步。它不是 Git API 的裸代理，也不是 Workspace Asset API 的替代品；它是 Workspace API 下的一条代码贡献路线。Pact 内部由 `v0.0.1:platform:codespace-1` 的 Codespace registry/provider 持久化 target、CodeChange、changeSet、review target link、upload receipt、status sync 和 fallback event。

目标兼容评估请求：

```json
{
  "workspaceId": "workspace_id",
  "subject": "subject_id",
  "operatorId": "operator_id",
  "taskId": "task_id",
  "payloadKind": "sourceCode|patch|gitDiff|repositoryChange|file|knowledge",
  "payloadRefs": ["asset_or_upload_ref"],
  "repositoryHint": "repo_or_remote",
  "branchHint": "main",
  "requestedAction": "review|submit|link|draft",
  "idempotencyKey": "key"
}
```

目标兼容评估响应：

```json
{
  "accepted": true,
  "routeDecision": "gerritChange|workspaceAsset|workspaceContribution|proposalFallback|reject",
  "compatibleTargets": [
    {
      "targetId": "code_target_id",
      "targetKind": "gerritChange",
      "targetProvider": "gerrit",
      "repositoryId": "repo_id",
      "repositoryRef": "repo_or_remote",
      "branch": "main",
      "reason": "source code changes require review"
    }
  ],
  "policyDecision": "allow|deny|needsApproval",
  "fallbackReason": null,
  "fallback": null,
  "auditId": "audit_id"
}
```

公开操作：

- `workspace.code.target.evaluate`：只做分类、策略和兼容目标判断，不写代码；结果进入 Codespace target registry。
- `workspace.code.change.prepare`：创建或复用本地 git worktree，应用 patch / 文件变更，生成 diff、commit plan 和 Change-Id 预检查；结果作为 `changeSet` 进入 Codespace registry。
- `workspace.code.change.upload`：在策略通过后执行受控 `git push refs/for/<branch>`，创建 Gerrit change 或新的 patch set；Gerrit 确认 receipt 回写到 CodeChange。
- `workspace.code.change.link`：把已有 Gerrit change 与 workspace task / operation / contribution 关联，并追加 `code.change.linked` event。
- `workspace.code.change.status.sync`：从 Gerrit 同步 review、submit、abandon、merge、rebase 和 conflict 状态，并追加 `code.change.status.synced` event。

v0.0.1 Codespace 语义入口：

- `codespace.providers.manifest`：读取运行态 GitHub/Gerrit provider manifest；只返回 `secretRef`，不返回 secret value。
- `codespace.repository.status`、`codespace.tree.list`、`codespace.file.read`、`codespace.diff.read`：统一 `RepositoryPort` 读接口；本机 `repoId/worktreePath` 可实读，外部 provider 缺少凭据时只返回 `contractVerified` receipt。
- `codespace.change.prepare`：生成受控 `changeSet`，保留 `dataClass`、`policy`、`checkpoint` 和 audit，不直接提交。
- `codespace.change.upload`：统一 GitHub PR / Gerrit Change 上传语义；无真实凭据或 dry-run 时必须标记 `contractVerified`，不能说成真实 PR/Change 已创建。
- `codespace.review.comment`、`codespace.review.requestChanges`、`codespace.review.approve`、`codespace.review.status.sync`：统一 `ReviewPort`；review action 和 status sync 必须追加 Codespace registry event。

v0.0.1 Cloud Drive 语义入口：

- `sharedspace.drive.connect`：创建云盘连接或本机 iCloud / OneDrive 受控目录 mount；基础模式固定暴露 `default/` 和 `public/` 两个 agent 视图，分别映射到 `.pact-data/<client>` 可写默认空间和 `.pact-data/public` 只读公共空间；高级模式只能额外暴露用户显式选择的既有目录，默认只读。后续 OAuth provider 只保存 `secretRef`，不保存 token value。
- `sharedspace.drive.status`、`sharedspace.drive.item.list`、`sharedspace.drive.permission.list`：只返回安全元数据、连接状态、目录映射、读写语义、ACL 摘要和 provider contract 标记，不返回私有本机路径、上游裸 ID、下载 URL 或 secret value。
- `sharedspace.drive.file.download`、`sharedspace.drive.file.upload`：所有传输都必须生成 `transferReceipt`；iCloud / OneDrive local projection adapter 只能在 `default/` 可写空间实写，`public/` 和高级暴露目录默认只读；v0.0.1 当前完成口径是 iCloud + OneDrive 本机目录投影，必须标记 `localAdapterVerified` / `localProjectionVerified`，不得说成远端云 API 已同步。OneDrive OAuth / Microsoft Graph 远端 upload/download receipt 是后续目标，只有真实远端请求才能标记 `remoteLiveVerified` 或 `realE2EVerified`；Google Drive/Dropbox 缺少真实 OAuth 凭据时只能返回 `contractVerified`，不能说成真实上传或真实下载。
- `sharedspace.drive.sync.plan`、`sharedspace.drive.sync.apply`：同步以 Sharedspace 为 Pact 权威状态，云盘只是外部 adapter/projection；apply 必须写 sync receipt 和 checkpoint，contract-mode 只能证明操作合同，不声明 remote sync completed。

v0.0.1 release readiness 语义：

- `server:migrate:v001` 只在 `ServerConfig.getDataDir()` 对应运行目录生成运行时保留报告、恢复点 manifest 和 rollback preview，不移动运行配置回 repo，也不清空旧 runtime 状态；secret value、sealing key、CSRF HMAC secret 和 sensitive payload store 只能作为 manifest/hash evidence 记录，不能复制到普通 `recovery-files/`。
- `server:verify:v001` 聚合 Phase 0-4 verifier、迁移报告、Tool/Policy/MCP 注册和 renderer raw build，输出 `docs/reports/history/v001-readiness/<run-id>/report.{json,md}`。
- readiness report 的结论只能声明 v0.0.1 单机可交付；iCloud / OneDrive 只能声明本机目录投影 verified，不能被文案提升为远端云 API 已同步。缺少真实外部凭据的 GitHub、Gerrit、Dify、RAGFlow、Google Drive 和 Dropbox 必须保留 `contractVerified`，不能被文案提升为真实外部 E2E、真实上传、真实同步或 production ready。OneDrive 只有在后续通过专用 OAuth / Microsoft Graph live verifier 或真实 adapter receipt 后，才能从本地投影提升为远端云盘接通。

v0.0.1 本地 secret 初始化入口：

- `pact secret <provider> init` 和点号别名 `pact secret.<provider>.init` 是开发/运维 bootstrap 入口，支持 `github`、`gerrit`、`dify`、`ragflow`、`onedrive`、`google-drive` 和 `dropbox`。
- CLI 必须从 stdin、环境变量或本地 JSON body 读取真实密钥，默认写入 `ServerConfig.getDataDir()/secrets`；仓库内只保留 source、模板和默认 manifest，不保存真实 token。
- 对 OneDrive、Google Drive 和 Dropbox，`pact secret <provider> oauth` / `pact secret.<provider>.oauth` 必须支持本机 `127.0.0.1` OAuth redirect、state 校验、PKCE、可选自动打开浏览器、`--no-open` 手动打开和 `--port` 固定回调地址；token exchange 结果只允许进入 secret store。
- `secrets/registry.json` 只保存脱敏索引、`secretRef`、字段名和配置状态；`secrets/values/*.json` 是本机 0600 权限密钥文件；`secrets/audit.jsonl` 记录初始化/更新审计。
- CLI 同步更新运行态 `code-management/codespace-providers.json`、`knowledge/knowledge-backends.json` 或 `agent-workspaces/cloud-drive-connections.json`，这些 manifest 只能保存 `secretRef` / `endpointRef` 和 `credentialConfigured`，不能保存 token value。
- `server:verify:v001` 可以把本地 secret store 识别为 `credentialConfigured`，但仍不声明真实外部 E2E；只有 provider 专用 live verifier 或真实 adapter receipt 可以把某条链路提升为真实验证。

Gerrit upload 的完成判定不能只看 `git push` 进程退出码。`workspace.code.change.upload` / MCP concrete operation `pact.workspace.code.change.upload` 必须在 push 退出 0 后继续通过 Gerrit REST 查询上传的 `HEAD` commit，直到 Gerrit 返回 change 且 `current_revision` 或 revisions 中包含该 commit，才能把操作标记为 `completed`。确认结果必须进入响应的 `completion` 字段，并通过 `GET /mcp` SSE 向同一 grant 推送 `notifications/pact/operation_reply`；如果确认超时或无法证明 Gerrit 已接收该 revision，则整个 upload 返回失败，不能推送 completed 回信。

Agent-facing Gerrit MCP 操作：

- `pact.gerrit.read` / `gerrit.read`：读取 Gerrit server 信息、project、branch、change、topic、hashtag、reviewer、message、comment、revision、file、diff、patch、mergeable、submit type、attention set 和 included-in 信息；需要 `repo:read`。
- `pact.gerrit.write` / `gerrit.write`：创建 change，维护 topic、hashtag、WIP、private、reviewer、vote、review label/comment、draft、change edit、reviewed 标记和 attention set；需要 `repo:write`。
- `pact.gerrit.maintain` / `gerrit.maintain`：创建 project/branch，执行 abandon、restore、rebase、move、submit、revert、delete、index、check/fix、comment delete 和 cherry-pick；需要 `repo:maintain` 与 safety confirmation。
- `pact.gerrit.gitUpload` / `gerrit.git_upload`：把本地 git `HEAD` 推到 `refs/for/<branch>`，支持 topic、hashtag、reviewer、cc、notify、trace、WIP/private 等 Gerrit push option；需要 `repo:maintain` 与 safety confirmation。

`CodeChange` 最小响应形状：

```json
{
  "codeChangeId": "code_change_id",
  "workspaceId": "workspace_id",
  "targetId": "code_target_id",
  "repositoryId": "repo_id",
  "repositoryRef": "repo_or_remote",
  "branch": "main",
  "changeId": "I...",
  "changeRef": "I...|42",
  "gerritChangeUrl": "http://gerrit/c/project/+/123",
  "patchSetRefs": ["patch_set_ref"],
  "reviewStatus": "draft|open|reviewed|submitted|merged|abandoned",
  "submitStatus": "notSubmitted|submitted|merged|failed",
  "operationId": "operation_id",
  "checkpointNodeId": "checkpoint_node_id",
  "auditId": "audit_id",
  "changeSet": {"changeSetId": "change_set_id"},
  "target": {
    "targetKind": "codespace",
    "targetProvider": "gerrit",
    "repositoryRef": "repo_or_remote",
    "branch": "main",
    "changeRef": "I...|42",
    "reviewUrl": "http://gerrit/c/project/+/123"
  },
  "completion": {"confirmed": true}
}
```

协议边界：

- `payloadKind=sourceCode|patch|gitDiff|repositoryChange` 默认返回 `gerritChange` 兼容目标；只有策略明确判断为知识材料、报告附件、样例或 fallback 时才走 workspace asset。
- MCP、CLI 和控制台都不能把裸 `git push` 暴露成通用工具；它们只能调用 `workspace.code.change.upload`，由服务端注入身份、策略、目标仓库和审计。
- Gerrit 保存 diff、patch set、review comment 和 submit 结果；Pact Codespace registry 保存 route decision、policyDecision、hash/reference、operation、checkpoint、upload receipt、status projection 和 audit event。
- 状态同步必须追加事件，不覆盖历史：`code.route.evaluated`、`code.change.prepared`、`code.change.uploaded`、`code.change.linked`、`code.change.status.synced`、`code.change.fallback.created`。
- fallback 只能生成受控 proposal、artifact 或 `sourceCode` workspace asset，不能把可合并代码伪装成普通文件发布。

## Workspace Governance Protocol

`v0.0.1:workspace:governance-1` 是组织级工作空间共享治理协议。它不替代 contribution lifecycle，而是在 contribution、workspace share、asset copy/export/checkout、retention dispose 之前提供统一裁决。

工作空间策略必须至少包含：

- `organizationId`、`projectId`、`departmentId`
- `dataClass` 与主体 `clearance`
- `ownerSubjectIds`、`allowedSubjectIds`、`externalCollaboratorIds`
- `allowedActions`、`copyPolicy`、`exportAllowed`、`checkoutAllowed`
- `retention.policyId`、`retention.ttlDays`、`retention.retainUntil`、`retention.disposalAction`
- `legalHold.enabled`、`legalHold.holdIds`、`legalHold.reason`

公开操作：

- `workspace_governance.describe`：读取策略、共享授权和审计事件。
- `workspace_governance.policy.set`：写入或更新 workspace governance policy。
- `workspace_governance.evaluate`：对 subject/action/targetWorkspace 做组织、项目、密级、外部协作者、retention 和 legal hold 裁决。
- `workspace_governance.share_grant`：在评估通过后创建带 dataClass、retention 和 legalHold 继承信息的 share grant。

Legal hold 必须阻断 delete/purge/expire/retention.dispose 等破坏性动作。跨 workspace copy/share 必须遵守 `copyPolicy`：`deny` 全拒绝，`sameProject` 只允许同项目，`withApproval` 必须带审批号，`allow` 仍要满足主体、组织和 dataClass 裁决。

## Knowledge Protocol

知识协议公开面是 `knowledgeBase` mount 和 `v0.0.1:knowledge:core-1`。调用方不能直接扫描 SQLite、raw object、manifest 或外部知识库私有 API。

主要能力：

- `knowledge.search`
- `knowledge.get.evidence`
- `knowledge.backend.connect`
- `knowledge.space.list`
- `knowledge.evidence.get`
- `knowledge.export.request`
- `knowledge.permission.request`
- `knowledge.asset`
- `knowledge.document.structure`
- `knowledge.export.docx`，HTTP 入口固定为 `GET /api/knowledge/export/docx`
- `raw-corpus.format.convert`，使用 `targetFormat`
- `knowledge.dossier.export`，输出同一事项的 unified dossier，使用 `outputFormat`
- `knowledge.distillation.export`，使用 `outputFormat`，仅作为迁移期废弃入口；新调用使用 `external.knowledge.distillation.artifacts.export`

`raw-corpus.format.convert`、`knowledge.dossier.export` 和 `knowledge.distillation.export` 由 `v0.0.1:knowledge:transformation-1` provider 执行。返回值统一为 portable export package：包含 `contentType`、`fileName`、`byteSize`、文本 `content`（适用时）、`contentBase64`、`manifest`、`documentCount` 和 `knowledgeAccessDecision`。导出前必须经 AgentLibrary access decision 裁决，并把 receipt/loan/denied request 写入 authorization store。

知识分三层：

1. `raw-corpus-construction`：原始语料、format-conversion-only、normalized documents、sourceRange、DOCX/YAML sidecar；所有受支持原始输入格式都必须能以 DOCX 作为目标格式导出。
2. `knowledge-index-construction`：canonical evidence/index，`KnowledgeCore` 或 external knowledge-base adapter。
3. `knowledge-distillation`：从原始语料全文生成自包含知识文档，只作为背景和交付物，不替代 evidence；第二层 evidence 只负责校验、引用、补证。

工业级蒸馏验收使用 `v0.0.1:external-service:knowledge-distillation-industrial-benchmark-1`。唯一维护面是 `external.knowledge.distillation`，通过本地 RAGFlow、MinerU、Docling、LlamaIndex、Marker、GraphRAG、Haystack 和 Unstructured 参考框架对比 route-first、windowing、分类蒸馏、Graph evidence、human/agent 响应分离和 Office 专业适配；内部 `knowledge.distillation.*` 只返回迁移报文。

外部知识蒸馏服务按远程容器默认部署时，`v0.0.1:external-service:knowledge-distillation-service-gates-1` 是前置门禁。容器态默认要求 `PACT_EXTERNAL_KD_API_TOKEN`，只有 `/health` 和 `/v1/runtime/health` 作为编排健康检查公开；capabilities、runs、evidence、artifacts 和 cancel 等业务 API 必须通过 bearer gate。镜像还必须固定 Tika checksum、运行非 root 用户并声明 healthcheck。`npm run server:verify:external-knowledge-distillation-service-gates` 必须先于外部知识蒸馏功能回归执行。

Pact 侧访问 `external.knowledge.distillation` 时必须先进入外部服务上游网关切面。`runs.list/get/create/cancel`、`evidence.query`、`projects.evidence.query`、`artifacts.export`、产物下载、package export、stage export、compare、delete 和 archive 都不能绕过 operation authorization、Tool Management grant、egress policy、audit receipt 和 denied decision。兼容期 `knowledge.distillation.workbench.*` 只返回迁移报文，不对智能体暴露，也不能继续承载真实算法或下载能力。

蒸馏持续优化使用 `v0.0.1:knowledge:distillation-optimization-1`。每次 `knowledgeSkillSet` evolution run 必须记录 `promptVersion`、baseline skill/model/framework、candidate skill IDs、evaluation dataset version/case IDs、error attribution、metric trend、human review 状态和 canary deployment；失败评估进入人工审核队列，通过评估后才能发布 canary，后续仍必须保留 promote/rollback 审计链。

蒸馏 portable 输出使用 `v0.0.1:strategy:portable-knowledge-distillation-1`，正文由稳定有序的 `contentBlocks` 组成。

搜索和证据读取必须支持预算：

- `contextBudget.knowledgeTokens`
- `payloadBudget.maxResponseBytes`
- `payloadBudget.maxEvidenceBytes`
- `continuationToken`
- `payload.nextContinuationToken`

超长结构必须保留 `structureArtifacts`，并按需派生 `granularityFragments`。预算不足时返回截断状态和 continuation，不能把完整 evidence 硬塞给调用方。

动态参数文档解析策略保留在 `dynamic-parameter-document-parsing-policy`：

- `dispatchDynamicDocumentParsingAlgorithm(input)`
- `bindDynamicDocumentParsingInvocation(request, runtimeState)`
- `granularity.secondaryParse.enabled`
- `completeOriginalAvailable`

外部知识库适配器必须仍返回 Pact 形状的 evidence pack，包含 `sourceTrace`、`citations`、`assetId`、`scoreReasons`、`backendTrace` 和权限过滤结果。内部索引型外部适配器入口是 `server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs`，首批后端为 `pgvector`、`qdrant`、`opensearch`，通过 `PACT_EXTERNAL_KB_PROVIDER` 等配置启用。

v0.0.1 面向上游知识库的兼容入口是 `v0.0.1:knowledge:backend-port-1`，实现位于 `server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs`。Dify 和 RAGFlow provider manifest 写入 `ServerConfig.getDataDir()/knowledge/knowledge-backends.json`，只允许 `secret://` secret ref 和 `config://` endpoint ref；Agent、MCP、CLI 和控制台都不能接触上游 token。当前无真实 Dify/RAGFlow 凭据时，`knowledge.backend.connect`、`knowledge.space.list`、`knowledge.search`、`knowledge.evidence.get` 和 `knowledge.export.request` 返回 `contractVerified=true`，不能表述为真实上游检索、真实 evidence 回读或真实导出。

`knowledge.space.list` 只返回安全派生空间元数据：`derivedKnowledgeSpace`、`derivedViewRef`、`upstreamKnowledgeRef`、`upstreamPolicyRef`、data class、sensitivity 和访问模式。默认 discover/search 不返回正文、snippet、上游裸对象 id、私有路径或上游 dataset id。v0.0.1 protocol evidence HTTP path 为 `GET /api/knowledge/evidence-read`，避免与旧兼容路径 `GET /api/knowledge/evidence/:evidenceId` 冲突。

`knowledge.search` 如带 `provider=dify|ragflow`、`knowledgeBackend=true`、`spaceId` 或 `backendRef`，先进入 KnowledgeBasePort，再执行 AgentLibrary authorization overlay。search 结果默认 `metadataOnly=true`，正文只能通过 `knowledge.evidence.get` 在授权后读取。成功 evidence 读取必须写入 `knowledgeAccessReceipt` 和 `loanRecord`；未授权 evidence 或 export 必须写入 denied request audit。`knowledge.export.request` 必须显式授权，未授权时 `backendExportInvoked=false`。

数据连接器治理保留在服务端协议层，不要求本轮实现客户端连接器。`v0.0.1:storage:data-connector-governance-1` 校验 `v0.0.1:storage:data-connector-1` manifest，并用 `v0.0.1:storage:local-mirror-1` 验收 OAuth refresh 策略、增量 cursor、冲突处理、hash collision quarantine、rate limit、mirror cleanup、localQuery 禁远程和 uninstall policy。当前实现入口是 `server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs`。

性能容量基准使用 `v0.0.1:platform:performance-capacity-1`。该协议定义 `smoke`、`pilot`、`production` 容量目标，并用合成 corpus 实际经过 `KnowledgeCore` ingest/search，同时记录外部 mirror sync、蒸馏吞吐、估算成本和失败注入结果。当前实现入口是 `server/platform/specialized/knowledge/performance/capacity-benchmark/index.mjs`。

## Asset Lineage Protocol

`v0.0.1:asset:asset-lineage-1` 是多模态资产治理协议。图片、表格、OCR 文本、PDF/PPT 视觉元素和图文穿插蒸馏材料都必须能回溯到原始对象、页面或幻灯片、坐标锚点、解析器版本和视觉模型版本。

lineage record 必须包含：

- `assetId`、`assetType`、`mediaType`
- `rawObject.objectId`、`rawObject.uri`、`rawObject.contentHash`、`rawObject.mediaType`
- `sourceAnchor.documentId`、`sourceAnchor.page`、`sourceAnchor.slideIndex`、`sourceAnchor.bbox`、`sourceAnchor.coordinateSystem`、`sourceAnchor.sourceRange`
- `parser.id`、`parser.version`
- `visualModel.id`、`visualModel.version`、`visualModel.promptVersion`
- `ocr.id`、`ocr.version`
- `derivedFromAssetIds`
- `producedBy.operationId/jobId/batchId/mountName/parserRoute`
- `reparsePolicy.whenParserChanges/whenModelChanges/whenSourceHashChanges`

公开操作：

- `asset_lineage.describe`：读取 lineage registry。
- `asset_lineage.record`：记录或更新 asset lineage。
- `asset_lineage.trace`：按 `assetId` 或 `lineageId` 回溯派生链和 root raw object。
- `asset_lineage.reparse_plan`：当 parser、视觉模型、prompt 或 raw object hash 改变时输出重解析候选。

## Knowledge Access Protocol

`v0.0.1:knowledge:access-1` 是智能体访问 AgentLibrary 资产的源头权限协议。它不是检索算法的后处理，而是在 source、document、section、block、field、asset、evidence、export、context bundle、memory write 之前统一裁决。

`v0.0.1:agent:library-1` 是同一能力的产品语义层：它把知识访问表达为 library card、reading room、share、checkout、loan record 和 revoke。底层可继续由 `knowledgeBase` / `v0.0.1:knowledge:core-1` mount 实现。

上游知识库的信息和资源权限再分配是该协议的核心功能。协议必须支持把同一份 `upstreamKnowledgeRef` 映射为多个 `derivedViewRef`，并为每个 subject / workspace / agent profile 分配不同 `authorizationOverlay`、`accessMode`、`checkoutPolicy` 和 `requestedEgress` 裁决。

每个知识资产入库时必须带：

- `upstreamKnowledgeRef`
- `upstreamPolicyRef`
- `derivedKnowledgeSpace`
- `authorizationOverlay`
- `dataClass`
- `sensitivity`
- `workspaceScope`
- `sourceScope`
- `owner`
- `retention`
- `allowedSubjects`
- `allowedAgentProfiles`
- `allowedActions`
- `checkoutPolicy`

每次知识访问请求必须带：

- `libraryCardId`
- `subject`
- `operatorId`
- `agentProfile`
- `workspaceId`
- `taskId`
- `requestedAction`
- `requestedAccessMode`
- `requestedEgress`
- `targetRefs`
- `contextTarget`
- `modelRoute`

裁决结果必须返回：

- `accessMode`
- `knowledgeAccessReceipt`
- `loanRecord`
- `derivedViewRef`
- `upstreamAccessDenied`
- `allowedRefs`
- `withheldRefs`
- `withheldCounts`
- `filteredReason`
- `redactionPolicy`
- `checkoutPolicy`
- `canCite`
- `canCopyToContext`
- `canExport`
- `canWriteMemory`
- `canRetain`
- `canShare`
- `expiresAt`
- `revocationPolicy`
- `auditId`

`accessMode` 至少包含：

- `deny`
- `discoverOnly`
- `metadataOnly`
- `controlledView`
- `citeOnly`
- `copyToContext`
- `exportAllowed`
- `checkoutAllowed`

这些是内置标准模式，用于保证 Workspace API、MCP service、控制台和审计系统能解释同一套权限。Workspace 可以通过 policy 增加自定义 `accessMode` 或 custom action，但必须映射回内置 `requestedEgress` / action，不能绕开统一裁决、receipt、loan record 或 denied request audit。

`controlledView` 表示智能体可在 Pact 受控会话内阅览内容；它不是读取本机原路径，也不是返回文件系统句柄。该模式不能下载、导出、复制进 artifact、写入长期 memory、带到其它 workspace 或送入未授权模型上下文。`checkoutAllowed` 才表示内容可以被本地智能体长期持有、下载或迁移。

知识检索必须先做权限预过滤，再做召回和排序。没有权限的内容不能作为 hidden context、rerank hint、摘要材料、蒸馏输入或评估样本参与后续算法。

外部知识库接入必须使用再授权模型。上游对象只能以 `upstreamKnowledgeRef` 进入 Pact，不能把上游 API token、对象路径、collection id 或裸检索结果暴露给下游智能体。Pact 对上游材料执行 information slicing 后，生成 `derivedKnowledgeSpace` 和 `authorizationOverlay`；下游访问只能命中派生视图。上游存在但下游无权访问的内容必须返回 `upstreamAccessDenied=true` 或按策略完全隐藏存在性。

### Upstream Permission Demo Flow

上游知识库 A/B 权限再授权演示验证 `v0.0.1:knowledge:access-1` 是否真的在源头治理权限：

1. `externalKnowledge.sync` 或等价 adapter 从上游知识库获取文件，生成 `upstreamKnowledgeRef`、`derivedViewRef`、`derivedKnowledgeSpace` 和 Pact asset id。
2. 管控台调用权限配置 API 更新 `authorizationOverlay`：A 被授予目标文件的 `read` / `export` / `checkout`，B 被设置为 `deny`。
3. 对话页面以 A 的 `libraryCardId`、subject、agent profile、workspace、task 和 `requestedEgress=exportFile` 请求同一文件。
4. 策略通过时，协议返回 `accessMode=checkoutAllowed` 或 `exportAllowed`、`allowedRefs`、`derivedViewRef`、`knowledgeAccessReceipt`、`loanRecord` 和 `auditId`。
5. 对话页面再以 B 的身份请求同一文件。
6. 策略拒绝时，协议返回权限错误，包含 `upstreamAccessDenied=true`、`withheldRefs` 或 `withheldCounts`、`filteredReason` 和 `auditId`，并写入 denied request audit。

验收要求：A 成功和 B 失败必须来自同一套 `authorizationOverlay` 裁决；B 的失败不能被表现为上游知识库不可用，也不能被 search、context bundle、export、artifact、distillation、memory write 或 tool call 旁路绕过。

所有出口必须复用同一裁决结果。`requestedEgress` 至少覆盖 `searchResult`、`evidenceRead`、`contextBundle`、`artifactWrite`、`exportFile`、`distillationInput`、`distillationOutput`、`memoryWrite`、`toolCall`、`evaluationSample`。如果裁决没有授予对应出口，系统必须返回拒绝并写入 denied request audit，不能用其它接口绕过。

`knowledgeAccessReceipt` 必须记录实际出馆的信息引用，而不是只记录调用名。最小字段包括：

- `receiptId`
- `libraryCardId`
- `subject`
- `agentProfile`
- `workspaceId`
- `taskId`
- `egress`
- `accessMode`
- `infoRefs`
- `redactionPolicy`
- `loanRecordId`
- `auditId`

`loanRecord` 表示内容被借走或可在会话外保留。只有 `checkoutAllowed`、`exportAllowed` 或明确授权的 `copyToContext` 才能生成可保留内容；否则只能生成 `controlledView` 阅览记录。

## Context Bundle Protocol

Context Compiler 负责把 workspace state 编译成本地智能体可用的上下文包。

输入：

- `workspaceId`
- `taskId`
- `operatorProfile`
- `contextBudget`
- `knowledgeScopes`
- `memoryScopes`
- `outputContract`

输出：

- `goals`
- `constraints`
- `allowedActions`
- `forbiddenActions`
- `evidenceRefs`
- `memoryEntries`
- `recentEvents`
- `artifactRefs`
- `openQuestions`
- `compressionTrace`

短上下文智能体拿到的是压缩上下文；长上下文智能体可以拿到更多 evidence 摘要和轨迹。无论上下文多长，canonical fact 仍然以 evidence 和 decision 为准。

## Client Runtime Bootstrap Protocol

`v0.0.1:agent:client-runtime-bootstrap-1` 让最小 MCP connector 或本地客户端先声明环境，再由服务端返回可裁剪的 Pact client runtime 计划。当前客户端实现是独立 `future-client` 包，根 npm 服务端包不携带 `client-cli/` 或 `client-gui/`。协议不能预设本地已有完整客户端；当本地缺少当前 `future-client` 模块时，connector 只能取得计划或 manifest，占位能力不能被描述为已实现。

入口：

- HTTP `POST /api/client-runtime/bootstrap/plan`
- HTTP `POST /api/client-runtime/bootstrap/pull`
- RPC `client_runtime.bootstrap.plan`
- RPC `client_runtime.bootstrap.pull`
- MCP Tool Management 名称 `pact.clientRuntime.bootstrapPlan`
- MCP Tool Management 名称 `pact.clientRuntime.bootstrapPull`

输入：

- `clientUid`
- `client.os` / `client.arch` / `client.libc`
- `client.availableCommands` 或 `client.commands`：例如 `rsync`、`ssh`、`scp`、`sftp`
- `serverCapabilities`：服务端确认可用的 native transport 能力
- `modules` / `requestedModules` / `needs`
- `transfer.totalBytes` / `transfer.fileCount` / `transfer.directory` / `transfer.incremental`

输出：

- `modules`：当前实现只允许描述 `client-cli`、`target-adapters`、`mcp-plugins`、`skill-hub`、`model-forwarding`、`mobile-relay`、`activity-snapshots`、`settings` 等 `future-client` 模块。
- `transportPlan`：候选顺序为 `local-copy`、`rsync-over-ssh`、小文件 `scp`、`sftp`、`pact-http-upload-session`、极小文本 `mcp-inline-content`。
- `installation`：安装根、签名校验要求、当前 artifact 状态、是否需要用户授权，以及是 `plan-only` 还是 `pull-artifacts`。
- `artifacts`：bootstrap pull 的 TODO 实现返回裁剪模块 artifact refs、版本、digest、签名状态和交付信息；在发布流水线或 capability package publisher 填充真实下载 URL 前，不得伪造二进制 URL。

使用约束：

- `bootstrap.pull` 不能返回完整服务端仓库，也不能默认拉取所有客户端能力。
- 客户端必须在请求中声明需要的当前能力；`clientd`、`upload-queue`、`mcp-local-bridge`、`connectors`、`knowledge-cache` 和 `mail-import` 都是 TODO 占位，不得进入当前 package plan。
- 服务端按能力裁剪 bundle：当前大文件上传继续使用 HTTP upload session / checkpoint 链路；没有本地 upload queue、没有 `mcp-local-bridge`、没有 `pact-client upload enqueue`。
- 客户端必须校验 artifact digest 和签名后才能启用模块。
- `local-copy` 只能作为字节搬运优化，必须把真实 bytes 深拷贝到 Pact staging/CAS；不得保存共享路径引用，不得采用零拷贝引用语义。

native transport 不能仅凭 Linux 平台推断可用。`rsync-over-ssh`、`sftp`、`scp` 都要求客户端命令和服务端能力同时声明；否则标准兜底是现有 upload session/checkpoint 分块协议。

## Strategy Management Protocol

`v0.0.1:strategy:strategy-management-1` 是应用层策略管理协议。它收敛处理流程选择、人工确认门禁、智能体调用策略、切面路由策略、模型路由策略包装和工具调用策略预览，不承载真实认证、授权、scope、grant 或 denied audit。安全权限裁决只能通过 `v0.0.1:risk-control:permissions-1` provider 执行，策略管理只能把安全裁决结果纳入策略输出和审计语义。

公开操作：

- `strategy.describe`：读取策略管理协议版本、能力和委托协议。
- `strategy.workflow_policy.evaluate`：评估处理流程策略，返回 `allow`、`require_confirmation` 或 `deny`。
- `strategy.agent_policy.evaluate`：评估智能体调用策略，作为模型决策和模型路由的统一策略包装。
- `strategy.route_policy.evaluate`：评估上下游切面和网关入口到平台内部能力或外部服务 endpointRef 的路由策略，返回路由裁决和路由目标摘要，不执行真实路由。
- `strategy.tool_policy.preview`：预览工具调用策略，委托 Tool Management catalog/grant/profile 与安全权限 provider 后返回策略化 decision。

运行时边界：

- Agent Gateway 的模型路由必须通过 Strategy Management provider 包装，返回 `strategyPolicyDecision`，不能在 gateway 内部散落流程策略。
- 上游服务切面和下游客户端切面到内部能力或外部服务地址的路由必须通过 route policy 表达，不能在切面 adapter、MCP/ACP 翻译层或外部服务 adapter 中硬编码绕过策略管理的路由分支。
- Knowledge model decision runtime 对上暴露的 `describe/decide` 端口必须经 Strategy Management provider 包装，调用方不直接持有底层模型决策 runtime。
- Tool Management policy engine 可以保留本地执行能力，但被 Strategy Management provider 注入时，HTTP / RPC / CLI 的 policy preview 都必须带 `strategyProtocolVersion` 和 `strategy_management` 评估层。
- Workflow policy 只表达流程门禁；真正阻止未授权访问仍以 Security Permissions provider 的 authorization decision 为准。

## Tool Management Protocol

Tool Management v1 管理公共能力，不管理智能体人格。

能力：

- catalog
- grant
- policy preview
- execute
- audit
- metrics

危险操作必须由策略层裁决，不能依赖提示词自律。工具执行必须带 `toolGrantId`、`risk`、`confirm`、`requiredScopes` 和 `auditId`。

## Agent Session Protocol

`agent_sessions.list/get/context/events.append/fork` 是当前会话工作状态入口，用于加载历史会话和构造 context bundle。

`agent_sessions.*` 属于 `agent_workspace` 能力，权限归口使用 `workspace:read` / `workspace:write`，不再沿用早期把会话线程写操作挂到 `knowledge:write` 的旧口径。

会话线程治理补齐 `agent_sessions.compare`、`agent_sessions.merge_proposal` 和 `agent_sessions.archive`。compare 是只读 diff；merge proposal 只追加 `session_merge_proposal` 事件且 `autoMergeApplied=false`；archive 追加 `session_archived` 事件并标记状态，不删除历史。

长期方向是把会话视为 workspace state 的一种 event stream：

- `trace`：执行轨迹
- `observation`：观察
- `summary`：压缩记忆
- `proposal`：建议
- `decision`：已确认事实

会话 memory 可以被其它智能体加载，但不能直接成为公共事实。

## Module Ecosystem Protocol

`v0.0.1:tool:module-ecosystem-1` 是服务端模块生态协议，不要求实现客户端。它把外部团队接入 parser、analysis、knowledgeBase、vectorStore、graphStore、Tool Package 和 Skill Package 的动作收敛为四类服务端能力：

- `module_ecosystem.templates`：列出官方模板、mountName、capability、默认示例和 CI 要求。
- `module_ecosystem.plan`：生成脚手架写入计划，明确将创建或覆盖的文件。
- `module_ecosystem.scaffold`：写入 module manifest、示例实现、sample、contract test 脚本和 GitHub Actions 模板；写入操作必须经过 `runtime:admin` 或等价授权。
- `module_ecosystem.contract_test`：导入外部 mount factory，验证 `createMount`、`supports`、`extractDocument/extractText`、`onBatchCompleted`、`reload`、`close` 等合同；对 Tool/Skill 包则验证 capability package manifest。

生成的 mount module manifest 使用 `v0.0.1:tool:mount-module-1`，必须声明 `moduleId`、`templateId`、`mountName`、`entrypoint`、`capabilities`、`contract.factoryExports` 和 `contract.contractTest`。生成的 Tool/Skill 包必须继续服从 `v0.0.1:tool:package-1` / `v0.0.1:tool:skill-registry-1` 生命周期治理。

## Executive Report Protocol

`v0.0.1:platform:executive-report-1` 是服务端管理层报告协议，不依赖前端驾驶舱。它把生产准入、资产贡献统计、容量成本、评估质量和 trace 安全摘要合并成可持久化、可追溯与透明化、可给阶段复盘使用的报告。

报告必须包含：

- `executiveSummary.keyFindings` 和 `recommendedDecisions`
- `productionReadiness.status/latestRunId/blockedP0/failedGates/missingCoverage`
- `productionReadiness.gates[].verificationMode`，取值至少为 `verified` 或 `mocked`；mocked 只能证明接口合同，不计入真实完成率
- `assetValue.acceptedCount/usageCount/uniqueWorkspaceAdoptions/permissionRequestCount/permissionGrantCount/rollbackCount`
- `assetValue.topReusableAssets/highDemandRestrictedAssets/rollbackHotspots/underMaintainedAssets`
- `qualityAndEvaluation.ragScore/distillationScore/agentTaskSuccessRate/unsupportedClaimCount/regressions`
- `capacityAndCost.capacityProfile/searchP95Ms/qps/estimatedCostUsd/failures`
- `traceAndSecurity.redactionFailures/deniedRequests/highRiskToolCalls/costUsd`
- `risks`，按 production gate、restricted asset、rollback hotspot 等来源生成

公开操作：

- `executive_report.list`：读取已生成报告。
- `executive_report.preview`：基于输入和最新 production health 生成预览，不持久化。
- `executive_report.generate`：生成并持久化报告。

## Architecture Live Map Protocol

`v0.0.1:platform:architecture-live-map-1` 是服务端架构活文档协议。它不要求实现客户端，而是把核心架构节点连接到设计文档、服务端实现路径和 production readiness gate，让阶段评审可以直接看到“设计是否落地、落地是否仍在运行门禁中通过”。

每个架构节点必须包含：

- `nodeId`、`label` 和节点级 `status`
- `docRefs[].path/exists`，指向对应设计文档
- `implementationPaths[].path/exists`，指向服务端实现入口
- `gates[].gateId/status/title/nextStep`，指向生产就绪门禁
- `missingDocs` 和 `missingImplementations`，明确活文档断链

公开操作：

- `architecture.live_map`：读取当前架构节点到文档、实现路径和生产门禁状态的映射。

## Sample Business Pack Protocol

`v0.0.1:platform:sample-business-pack-1` 是服务端样例业务包协议，不依赖客户端。它把新成员和业务方最常见的验收材料打包成可物化目录：邮件线程、PDF、PPT、Markdown 项目文档和外部知识库 docker compose。

样例业务包必须包含：

- `packId`、`title`、`businessDomain`、`tags`
- `assets[].relativePath/category/mediaType/parserRoute/evidenceRole/sha256`
- `ingestPlan[].stepId/source/route/expectedSignals`
- `externalServices[].serviceId/role/composePath/defaultEndpoint`
- 物化结果中的 `targetRoot`、`manifestPath` 和 `writtenFiles`

公开操作：

- `sample_business_pack.list`：列出内置样例业务包。
- `sample_business_pack.get`：读取指定样例业务包 manifest。
- `sample_business_pack.materialize`：在服务端数据目录下生成样例文件和 manifest。

## Protocol Adapters

Pact 可以提供协议适配，但适配层不得污染核心模型：

- MCP server：属于 `agent-client-mcp-compatibility`，把 workspace/evidence/artifact/proposal 能力暴露成工具，是智能体长期正式接入面。
- Agent traffic/load gateway：属于 `agent-client-mcp-compatibility` 的可选 ingress adapter，只做 TLS/mTLS、负载均衡、限流、SSE/WebSocket 透传、request id 和边缘观测；direct Pact endpoint 必须始终可用。
- A2A adapter：只做兼容 agent card 和任务入口，不内嵌完整 A2A Gateway。
- OpenAI-compatible model gateway：可选，用于 workspace-aware model routing、context injection、audit 和 redaction。
- OpenAPI/REST：服务端、控制台和调试兼容面，不作为智能体同级正式面。
- CLI/SDK：辅助自动化和运维入口，不作为长期同级承诺。

外部服务 adapter 不放在 Protocol Adapters 下统一描述；它们属于 `external-service-compatibility`，必须声明目标服务、凭据边界、同步语义、风险等级和验证命令。Pact 内部 mount、resource operation、capability package、runtime cache 和状态边界属于 `pact-internal-compatibility`，必须能通过本地 verifier 或 contract test 固化。

## 版本与兼容

受管版本字符串采用 `v<platform-version>:<domain>:<subsection>-<version>`。`v<platform-version>` 是平台统一基线，例如 `v0.0.1`；`domain` 是稳定治理域，例如 `workspace`、`risk-control`、`state-machine`、`storage` 或 `mcp`；`subsection-version` 表达该治理域下的细分对象及其独立递增版本。复合版本继续追加完整词汇轴段，例如 `v0.0.1:risk-control:definition:model-1:dsl-1:lifecycle-1:control-1:revision-1`。旧式 `pact.<domain>.vN` 只允许作为本次迁移前的历史输入被清理，迁移完成后不得继续存在。

平台级版本事实归 `server/platform/common/version-control` 的 Version Governance Module 统一治理。协议版本、schema 版本、能力包版本、运行时依赖版本、迁移路径、兼容窗口、退役状态和版本证据引用都必须能回到同一版本事实源；发布页、生产准入报告和 release readiness 只能消费这些事实，不能成为版本事实源。

Version Registry 是项目源代码中的单例配置事实源，落点为 `server/platform/common/version-control/version-registry.json`，Schema 边界为 `server/platform/common/version-control/version-registry.schema.json`。运行时可以把版本制品、bundle、manifest、报告和证据正文物化到 `.pact-server-data/artifacts`，但 artifact store 只能作为被引用的制品库，不能反向成为版本配置、兼容规则或迁移路径的权威。

Version Registry 中每个版本事实必须用 `artifactId@version` 引用。`artifactId` 使用稳定 dotted identity，例如 `pact.platform`、`pact.protocol.mcp`、`pact.store.tool-management`、`pact.capability.skill-hub`、`pact.runtime-dependency.gerrit` 或 `pact.compatibility.baseline`；`version` 必须使用 Governed Version String。例如平台装配版本写作 `pact.platform@v0.0.1:platform:assembly-1`，MCP 协议版本写作 `pact.protocol.mcp@v0.0.1:mcp:interface-1`，状态机版本写作 `pact.state-machine.version-artifact-lifecycle@v0.0.1:state-machine:version-artifact-1`。

完整受管版本事实表以 `server/platform/common/version-control/version-registry.json` 为准，并由 `server:verify:version-registry` 反向扫描仓库强制覆盖。以下清单只保留核心命名样例：

| 对象 | 版本命名 |
| --- | --- |
| 平台基线 | `v0.0.1` |
| 平台装配 artifact | `v0.0.1:platform:assembly-1` |
| Version Registry schema | `v0.0.1:version-governance:registry-schema-1` |
| Version Governance protocol | `v0.0.1:version-governance:protocol-1` |
| Version Compatibility Table | `v0.0.1:version-governance:compatibility-table-1` |
| Version Transition config | `v0.0.1:version-governance:transition-config-1` |
| MCP interface | `v0.0.1:mcp:interface-1` |
| MCP device discovery schema | `v0.0.1:mcp:device-discovery-schema-1` |
| MCP connector package | `v0.0.1:mcp:connector-package-1` |
| Versioned Artifact lifecycle state machine | `v0.0.1:state-machine:version-artifact-1` |
| Version Transition lifecycle state machine | `v0.0.1:state-machine:version-transition-1` |
| Workspace core | `v0.0.1:workspace:core-1` |
| Workspace governance | `v0.0.1:workspace:governance-1` |
| Workspace contribution | `v0.0.1:workspace:contribution-1` |
| Context bundle | `v0.0.1:context:bundle-1` |
| Operation core | `v0.0.1:operation:core-1` |
| Operation reply schema | `v0.0.1:operation:reply-schema-1` |
| Operation reply target schema | `v0.0.1:operation:reply-target-schema-1` |
| Workflow core | `v0.0.1:workflow:core-1` |
| Job workflow | `v0.0.1:workflow:job-1` |
| Checkpoint Tree | `v0.0.1:state:checkpoint-tree-1` |
| Knowledge core | `v0.0.1:knowledge:core-1` |
| Knowledge access | `v0.0.1:knowledge:access-1` |
| Knowledge transformation | `v0.0.1:knowledge:transformation-1` |
| Knowledge distillation optimization | `v0.0.1:knowledge:distillation-optimization-1` |
| Knowledge backend port | `v0.0.1:knowledge:backend-port-1` |
| Knowledge rule | `v0.0.1:knowledge:rule-1` |
| AgentLibrary core | `v0.0.1:agent-library:core-1` |
| Agent runtime | `v0.0.1:agent:runtime-1` |
| ACP agent relay | `v0.0.1:agent:acp-relay-1` |
| Client runtime bootstrap | `v0.0.1:client-runtime:bootstrap-1` |
| Tool management | `v0.0.1:tool:management-1` |
| Tool and Skill management | `v0.0.1:tool-skill:management-1` |
| Tool package | `v0.0.1:tool:package-1` |
| Skill registry | `v0.0.1:skill:registry-1` |
| Security core | `v0.0.1:security:core-1` |
| Security permissions | `v0.0.1:security:permissions-1` |
| Capability security helper | `v0.0.1:security:capability-helper-1` |
| Risk Control definition | `v0.0.1:risk-control:definition:model-1:dsl-1:lifecycle-1:control-1:revision-1` |
| Risk Control evidence store | `v0.0.1:risk-control:evidence-store:schema-1:lifecycle-1:contract-1:revision-1` |
| Risk Control evidence profile | `v0.0.1:risk-control:evidence-profile:profile-schema-1:lifecycle-1:contract-1:revision-1` |
| Risk Control evidence locator | `v0.0.1:risk-control:evidence-locator-1` |
| Risk Control definition digest domain | `v0.0.1:risk-control:definition-digest-1` |
| Risk Control evidence store digest domain | `v0.0.1:risk-control:evidence-store-digest-1` |
| Risk Control evidence profile digest domain | `v0.0.1:risk-control:evidence-profile-digest-1` |
| Risk Control evidence locator digest domain | `v0.0.1:risk-control:evidence-locator-digest-1` |
| Risk Control operation anchor digest domain | `v0.0.1:risk-control:operation-anchor-digest-1` |
| Risk Control gate record digest domain | `v0.0.1:risk-control:gate-record-digest-1` |
| Risk Control evidence digest domain | `v0.0.1:risk-control:evidence-digest-1` |
| Storage core | `v0.0.1:storage:core-1` |
| Backup restore | `v0.0.1:storage:backup-restore-1` |
| Data connector | `v0.0.1:storage:data-connector-1` |
| Data connector governance | `v0.0.1:storage:data-connector-governance-1` |
| Local mirror | `v0.0.1:storage:local-mirror-1` |
| Asset lineage | `v0.0.1:asset:lineage-1` |
| Code review | `v0.0.1:codespace:code-review-1` |
| Codespace core | `v0.0.1:codespace:core-1` |
| Strategy management | `v0.0.1:strategy:management-1` |
| Performance capacity | `v0.0.1:performance:capacity-1` |
| Executive report | `v0.0.1:report:executive-1` |
| Architecture live map | `v0.0.1:architecture:live-map-1` |
| Sample business pack | `v0.0.1:sample:business-pack-1` |
| Module ecosystem | `v0.0.1:module:ecosystem-1` |
| Mount module | `v0.0.1:module:mount-1` |
| Devops core | `v0.0.1:devops:core-1` |
| Runtime dependencies | `v0.0.1:runtime:dependencies-1` |
| Organization model | `v0.0.1:organization:model-1` |
| External knowledge distillation industrial benchmark | `v0.0.1:external-service:knowledge-distillation-industrial-benchmark-1` |
| External knowledge distillation service gates | `v0.0.1:external-service:knowledge-distillation-service-gates-1` |

Version Registry 使用 `compatibilityTable` 维护版本兼容关系表。表格行以 `consumerRef -> providerRef` 表达一个版本事实能否消费、依赖、解释或绑定另一个版本事实，状态为 `compatible`、`deprecated`、`historical_only` 或 `blocked`；表格是兼容事实源，semver/range 只能作为展示 hint，不能替代表格事实。

Versioned Artifact 生命周期使用状态机集合中的 `version.artifact.lifecycle`：`draft -> candidate -> active -> deprecated -> retired`。`retired` 为终态；`activate`、`deprecate` 和 `retire` 属于受保护转移，不能由领域私有状态直接替代。

跨版本状态变化必须表达为受管 Version Transition：`fromVersion -> toVersion`、适用对象、相邻迁移规则、dry-run、checkpoint、retry、audit/recovery、兼容投影和验收证据。Version Transition 生命周期使用状态机集合中的 `version.transition.lifecycle`：`planned -> dry_run_passed -> checkpointed -> running -> verified -> completed`，失败后进入 `failed` 并必须显式 `retry`、`rollback` 或 `abandon`；`completed`、`rolled_back` 和 `abandoned` 为终态。单个领域不得在启动路径里私有封装隐式迁移 runner、长期兼容分支或隐藏 registry。

所有协议变更必须同步：

- `SERVER_API_OPERATIONS`
- Tool Management catalog
- 控制台 bridge/types
- 相关验证脚本
- `docs/PRODUCTION-CAPABILITY-GAP.md` 中的差距项
