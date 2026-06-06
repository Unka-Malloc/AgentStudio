# Pact Protocol Boundaries

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: Pact Protocol Boundaries.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

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
| `pact.workspace.v1` | 公共工作空间 context、tasks、observations、artifacts、proposals、decisions、audit events。 |
| `pact.operation.v1` | idempotency、policy check、dry-run、diff、snapshot boundary、apply、rollback。 |
| `pact.knowledge.v1` | `knowledgeBase` mount、evidence pack、asset、search、export、external knowledge adapter。 |
| `pact.context-bundle.v1` | 面向本地智能体和短上下文模型的 context compiler / context compression。 |
| `pact.client-runtime-bootstrap.v1` | 最小 MCP connector 或客户端主动声明平台、命令、模块需求和上传规模，服务端返回裁剪后的 Pact client runtime 计划、可拉取 artifact refs 与 transport 降级顺序。 |
| `pact.agent-runtime.v1` | Agent config registry、Agent Gateway config/registry/call、Model Probe、model routing health 和带 settings/model-library 投影的 gateway call provider。 |
| `pact.strategy-management.v1` | 处理流程策略、智能体调用策略、切面路由策略、模型路由策略包装和工具调用策略预览；安全授权仍委托 `pact.security-permissions.v1`。 |
| `pact.tool-management.v1` | Tool Management v1 catalog、grant、policy preview、execute、audit、metrics。 |
| `pact.tool-skill-management.v1` | Tool/Skill Management provider，统一封装 Tool catalog/grant/runtime、MCP local grant、workspace ref 解析、MCP 可见 operation 和输出脱敏。 |
| `pact.security.v1` | subject、workspace、scope、grant、data class、secret ref、redaction、audit policy。 |
| `pact.security-permissions.v1` | 组合根注入的统一安全权限 provider，封装 console auth、operation authorization、authorization policy、authorization audit artifact、workspace asset policy 和 Tool/MCP grant 裁决。 |
| `pact.workflow.v1` | 长任务、activity、checkpoint、retry、signal、timer、恢复和补偿语义。 |
| `pact.job-workflow.v1` | 任务创建、列表、详情、checkpoint lookup、结果读取和重跑 provider；HTTP/RPC/console 不直接持有 job manager。 |
| `pact.backup-restore.v1` | 服务端数据目录备份、manifest、restore preview、确认恢复和恢复报告。 |
| `pact.data-connector-governance.v1` | 服务端数据连接器合同、OAuth refresh 策略、增量 cursor、mirror 冲突/清理、localQuery 禁远程和卸载验收。 |
| `pact.performance-capacity.v1` | 容量目标、benchmark runner、ingest/search/sync/distillation/cost 指标、失败注入和阈值门禁。 |
| `pact.knowledge-distillation-optimization.v1` | 知识蒸馏持续优化报告，覆盖 prompt/baseline/dataset 版本、错误归因、趋势、人工审核和 canary/promote/rollback。 |
| `pact.executive-report.v1` | 管理层报告，聚合生产门禁、资产价值、评估、容量成本、trace 安全和风险决策。 |
| `pact.architecture-live-map.v1` | 架构活文档，链接核心架构节点、设计文档、服务端实现路径和生产门禁状态。 |
| `pact.sample-business-pack.v1` | 服务端样例业务包，物化邮件、PDF、PPT、Markdown 项目和外部知识库 compose 示例。 |
| `pact.module-ecosystem.v1` | 服务端模块模板、脚手架计划、生成、合同测试、CI 模板和 Tool/Skill 包 manifest 验收。 |
| `pact.asset-lineage.v1` | 多模态资产 raw object、page/slide、bbox、parser/model/OCR 版本、派生链和重解析计划。 |
| `pact.knowledge-access.v1` | source-level knowledge permissions、accessMode、checkoutPolicy、controlledView、export 和 context injection 裁决。 |
| `pact.agent-library.v1` | AgentLibrary / 图书馆的 library card、loanRecord、knowledgeAccessReceipt、share、checkout 和 revoke 语义。 |
| `pact.workspace-contribution.v1` | 终端贡献资产、Skills、工具、脚本、专家意见、黄金规则、排行榜、资产贡献统计报表和贡献授权。 |
| `pact.code-review.v1` | 源代码上传目标兼容、Gerrit change 准备、push、review 状态同步、fallback 和审计。 |
| `pact.workspace-governance.v1` | organization/project/dataClass/retention/legalHold、外部协作者、跨空间复制、共享授权和审计。 |
| `pact.checkpoint-tree.v1` | 统一 Checkpoint Tree：访问请求、文件变动、知识贡献、技能调用、权限裁决、diff、restore preview、restore commit 和按 operation scope 回撤。 |

### Security, Audit, and Trace Hardening

`pact.security-permissions.v1` 的裁决输入可以携带 `tenantId`、`workspaceId`、`dataClass` 和 `requestedEgress`。subject、console user、tool grant 或 agent profile 可以声明 `tenantId`、`allowedWorkspaceIds`、`allowedDataClasses` 和 `allowedEgress`；tenant、workspace、data class 或出口越界必须返回 denied decision，并写入 denied request audit。`owner` / `auth:admin` 可以跨 tenant 做管理操作，但普通 subject 不能借助 search、evidence、context bundle、export、tool call 或 memory write 绕过同一裁决。

审计和 trace 的服务端入口固定为：

- `auth.audit` / `GET /api/auth/audit`：按 operation、status、user、tenant 或 trace 查询 operation audit。
- `auth.audit.export` / `GET /api/auth/audit/export`：导出脱敏审计包；secret、token、cookie、API key 和本机绝对路径不得出现在导出内容中。
- `auth.audit.retention.get|set` / `GET|POST /api/auth/audit/retention`：读取或设置审计保留策略。
- `auth.audit.prune` / `POST /api/auth/audit/prune`：按保留策略清理过期审计。
- `auth.sessions.rotate` / `POST /api/auth/sessions/rotate`：轮换当前控制台 session token 和 HMAC-derived CSRF token，旧 session token 立即失效，并写入审计。
- `observability.trace.get` / `GET /api/observability/traces/:traceId`：按 traceId 聚合 operation audit span 和 authorization decision，作为本地 trace drill-down 的事实源。OpenTelemetry / OTLP 只是后续可选导出目标。

## Middle Layer Strategy

Pact 的协议不追求覆盖所有智能体协作场景，也不替代上游知识库。协议只把中间层两个问题做深：

1. `pact.knowledge-access.v1` / `pact.agent-library.v1`
   - 解决上游知识库太粗的问题。
   - 把上游资源加工成可发现、可读、可引用、可上下文注入、可导出、可借走或不可见的细颗粒度授权视图。
2. `pact.workspace-contribution.v1` / `pact.workspace.v1`
   - 解决下游本地智能体太细的问题。
   - 把终端贡献沉淀到公共工作空间，让知识、Skills、工具、脚本、文件、黄金规则和专家意见可以被发现、排行、授权、复用和撤销。

这两个方向共同构成框架的核心卖点：上游资源经过 Pact 后变细、变可控；下游本地智能体经过 Pact 后能共享部分资产和能力。

## Compatibility Strategy

三个兼容层不是“支持很多插件”，而是协议层的稳定承诺。任何 adapter、connector、mount、compatibility component 或 runtime bridge 都必须归入以下三层之一：

1. `agent-client-mcp-compatibility`
   - 面向智能体客户端和本机 MCP 插件，例如 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、脚本型 agent 和人工 CLI。
   - 责任是客户端发现、MCP HTTP / stdio 兼容、可选 agent traffic/load gateway、grant pairing、local bridge、client runtime bootstrap、transport fallback、版本协商和工具列表稳定性。
   - 这一层只处理“客户端如何安全调用 Pact”，不直接实现外部业务服务、不直接读写 workspace 内部状态。
2. `external-service-compatibility`
   - 面向 Pact 进程外部的服务或系统，例如 Docker、GitHub、Gerrit、Mailbox、外部知识库、模型 provider、外部向量库、外部图数据库、业务系统和云盘。
   - 责任是服务认证、凭据引用、API/协议适配、远端状态同步、cursor、rate limit、webhook、mirror、错误归一化和服务侧能力发现。
   - 外部服务适配不能裸转发上游权限，也不能绕过 Tool Management、policy、Operation Ledger、Checkpoint Tree 和 audit。
3. `pact-internal-compatibility`
   - 面向 Pact 应用内部系统层面的可替换、可演进边界，是统一的对内兼容层。
   - 细分为：module contract compatibility、resource operation compatibility、capability lifecycle compatibility、runtime environment compatibility、state boundary compatibility。
   - 责任是内部 mount/module 合同、repo/drive/knowledge 等资源语义抽象、Tool/Skill 能力包生命周期、JRE/Tika/runner/cache 等运行时差异、Operation/Audit/Checkpoint 等状态边界稳定。

三层边界必须保持单向依赖：智能体客户端层调用 Pact 协议入口；外部服务层通过受控 operation 访问远端系统；Pact 系统层承载内部模块、治理、状态和运行环境兼容。Tool Management、Policy、Operation Ledger、Checkpoint Tree 和 audit 是跨三层的治理面，不单独作为第四个兼容层。

“两个问题，一个能力，三个兼容”只作为产品问题定义保留，不再作为协议或架构分层口径。协议分层统一使用 `agent-client-mcp-compatibility`、`external-service-compatibility` 和 `pact-internal-compatibility`；受管工作空间仍必须经过 Pact 管理软件，不能让智能体直接绕过兼容层改写公共状态。

## Workspace API

Workspace API 是本地智能体接入 Pact 的首选方式。OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、脚本型 agent 或人工工具都只需要遵守这个协议。

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

所有受管 operation 都必须走 `pact.operation.v1` 或对应领域协议，并先进入 Operation Scheduling Kernel。只有调度内核受理、分配 `operationId`、写入 `started` / `pending` 账本、完成策略裁决并返回执行许可的 operation，才是 Pact 的真实操作。这里不只包括改变 canonical workspace state 的写操作，也包括 API / RPC / MCP / CLI / 控制台入口、后台任务、workflow activity、队列状态变更、provider adapter 调用、webhook 处理、模型调用、工具执行、访问请求、权限拒绝、文件读出、列表、发现、权限检查、receipt 查询、审计查询、历史查询、checkpoint tree 查询、技能调用和上下文暴露，因为它们会改变审计、receipt、loan record、usage event、贡献统计、风险状态或外部事实。

Operation Registry 是目录和合同，不是执行许可。HTTP handler、RPC method、CLI command、MCP tool、控制台 handler、worker 和 provider adapter 都只能提交 intent envelope 给调度内核，不能直接调用业务 executor。未带内核准入印记的业务函数、provider side effect、状态写入或工具执行必须拒绝为 `operation_unmanaged` / `operation_not_scheduled`，只允许留下拒绝记录，不允许产生真实副作用。

Operation Ledger 是事实源。console log、tool audit、provider ledger、queue event、runtime log、trace span 和 readiness report 只能作为投影、回执、索引或报告，不能替代统一账本。写操作和外部副作用必须由调度内核先追加 `started` / `pending` ledger entry，再执行副作用；账本不可写时必须失败在副作用之前。读请求可以在任务会话内做高频聚合，但聚合结果仍必须可按 `operationId`、`traceId`、`subject`、`targetRef` 和 `reasonCode` 查询。

高危 operation 的统一审批也属于调度内核职责。`requiresConfirmation` 或 `confirm=true` 只能作为风险输入，不能直接等同于审批完成。需要人工确认或高风险审批时，调度内核必须把原 intent envelope 挂起为 `pending_operation`，写入 `pending_approval` 状态并暴露到独立 `/approval` 页面。`pending_operation` 至少保存原始 `operationId`、`traceId`、`idempotencyKey`、subject、operator、agentProfile、workspace、grant / token 摘要、requestedScopes、risk reason、policy decision、approvalScope、expiresAt、payload hash、redacted input summary 和 resume pointer。审批通过后只能恢复原 operation，沿用原 `operationId` / `traceId`；拒绝、过期、撤销或上层 hard deny 时不得执行副作用。

```text
intent envelope
  -> Operation Scheduling Kernel
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

`pact.checkpoint-tree.v1` 管理统一 Checkpoint Tree。它不是单独的任务队列树，也不是单纯的文件树，而是公共空间所有可治理影响的状态图。

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

`pact.backup-restore.v1` 只用于未来存在独立备份服务器、灾备目标或离线备份介质时的服务端数据目录备份恢复。它不是 v0.0.1 上传留档主链路，不是 sharedspace 管理语义，也不是 cloud drive sync 的别名。当前 v0.0.1 主线只依赖上传留档、Checkpoint Restore 和 Cloud Sync；Backup Restore 保留为生产硬化协议。

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

`pact.workspace-contribution.v1` 管理终端贡献型资产。它把本地智能体、脚本、人工操作者和下游 workspace 产生的高价值信息沉淀为可治理资产。

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

`sourceCode` 表示作为知识、示例、报告附件或非合并材料进入 workspace 的代码资产。`codeChange` 表示需要进入代码仓库评审的变更，默认不作为普通文件资产发布，而是交给 `pact.code-review.v1` 生成或关联 Gerrit change。

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

`pact.workflow.v1` 是长任务 durable execution 协议。Pact 第一版不直接强依赖 Temporal，但语义向 durable workflow 对齐：

- workflow 状态和 execution history 默认持久化，可恢复、可观察、可校验。
- activity 必须带幂等 key、输入 hash、输出 hash、重试策略和补偿动作。
- workflow 必须支持 signal、timer、human review wait、manual approval、cancel 和 compensation。
- 外部写入必须区分 partial、committed、failed、compensated，不能把 partial write 当 completed。
- 崩溃恢复必须能回答恢复点、上次成功 activity、待重试 activity、待人工处理事项和外部副作用状态。

单机实现入口是 `server/platform/common/workflow/durable-workflow-store.mjs`。它把 workflow、activity、signal、timer、human review 和 external write 写成 hash-chain execution history；导入解析 job 通过 `job-manager` 写入 `worker-run` activity heartbeat、完成、失败和恢复信号。`server:verify:durable-workflow` 是协议语义门禁，覆盖模拟崩溃恢复、幂等 activity 复用、human review、timer firing、external partial write commit 和 history 校验。

### Device MCP Hub

历史文档里的 MCP Demo Flows 现在收敛为本节的设备级 MCP Hub，并按 Stitch MCP 的 HTTP 接入方案落地。

Pact MCP service 是 Workspace API 的设备级协议适配器，不是 agent-to-agent gateway。它必须让同一台设备上的 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf 都能通过同一套发现、授权和工具边界访问 Pact，而不是为某一个 agent 单独硬编码。

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
  "version": 1,
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

无 `--target` 且运行在 TTY 中时，`install` 必须启动多选交互式菜单，扫描 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf 和 claw-compatible 衍生体，允许用户用上下键移动、Space 多选、`a` 切换所有已检测客户端。菜单只在用户确认选择后写入对应客户端配置。

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
pact.mcp.gemini-cli
pact.mcp.antigravity
pact.mcp.opencode
pact.mcp.copilot
pact.mcp.kilo-code
pact.mcp.cursor
pact.mcp.hermes
pact.mcp.windsurf
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
| Gemini CLI | `gemini mcp add --transport http --header X-Pact-Api-Key`；同时生成并校验 Stitch 形态 extension manifest | signed discovery `httpUrl` |
| Antigravity | 按官方 `~/.gemini/antigravity/mcp_config.json` 的 `serverUrl` + `headers` 写入 HTTP server | signed discovery `httpUrl` |
| OpenCode | 按 `~/.config/opencode/opencode.jsonc` 的 `mcp.pact.type=remote`、`url`、`headers.X-Pact-Api-Key` 和 `enabled` 写入 HTTP server | signed discovery `httpUrl` |
| Copilot | `copilot mcp add --transport http --header X-Pact-Api-Key` | signed discovery `httpUrl` |
| Kilo Code | 按 Kilo CLI 标准 `~/.config/kilo/kilo.json` 的 `mcp.<name>.type=remote` 写入 HTTP server | signed discovery `httpUrl` |
| Cursor | 按 Cursor MCP settings 的 `mcpServers.pact` 写入 HTTP server | signed discovery `httpUrl` |
| Hermes Agent | VM / remote 环境内 `hermes mcp add --url --auth header`，并用 Hermes config helper 启用后 `hermes mcp test` | signed discovery `vmHttpUrl` / `httpUrl` |
| Windsurf | 按 `~/.codeium/windsurf/mcp_config.json` 的 `mcpServers.pact` 写入 HTTP server | signed discovery `httpUrl` |

installer 只追加或替换 `pact` 这一项，必须先生成会被结构化写入目标配置的回滚副本。不得覆盖、清空或重排用户已有 MCP server、API key、bot token 或 agent 配置。能用客户端标准 CLI 的目标必须调用标准 CLI；没有可脚本化标准 CLI 的目标由 `server:mcp:install` 按目标官方配置格式做结构化写入并生成回滚副本。

Codex 标准 CLI 配置形态：

```toml
[mcp_servers.pact]
url = "<signed-discovered-http-url>/mcp"
bearer_token_env_var = "PACT_MCP_TOKEN"
```

Gemini CLI 标准 MCP 配置形态：

```json
{
  "mcpServers": {
    "pact": {
      "url": "<signed-discovered-http-url>/mcp",
      "type": "http",
      "headers": {
        "X-Pact-Api-Key": "<agent-specific grant token>"
      },
      "timeout": 300000,
      "trust": true
    }
  }
}
```

安装器还会生成并校验 Stitch extension 同构 manifest，供未来 extension 分发复用：

```json
{
  "mcpServers": {
    "pact": {
      "httpUrl": "<signed-discovered-http-url>/mcp",
      "headers": {
        "X-Pact-Api-Key": "<agent-specific grant token>"
      },
      "timeout": 300000
    }
  }
}
```

#### Stable MCP outlets

对外 MCP 工具面必须收敛为五个稳定语义入口：

```text
pact.discovery
pact.knowledge
pact.sharedspace
pact.codespace
pact.skillHub
```

v0.0.1 硬切新五类入口，不保留 `pact.workspace`、`pact.list`、`pact.skill`、`pact.help` 等旧 alias。每个入口的入参固定为 Intent Operation envelope：

```json
{
  "apiVersion": "pact.mcp.v1",
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

`operation` 是 Pact 内部 Operation Registry / Tool Management 的操作 id。外部智能体不直接看到 100+ 个内部 operation，也不把内部 operation 展开成 MCP tool name。MCP adapter 只能把 JSON-RPC 请求转换成 Intent Operation envelope；能力发现、grant 校验、可见 operation 过滤、local grant、workspace ref 解析、工具执行和输出脱敏必须进入 `pact.tool-skill-management.v1` provider。需要发现内部能力时，调用 `pact.discovery`：

```text
pact.discovery({ "apiVersion": "pact.mcp.v1", "operation": "pact.capabilities.list", "input": {} })
pact.discovery({ "apiVersion": "pact.mcp.v1", "operation": "pact.mcp.version", "input": {} })
```

`pact.capabilities.list` 必须按当前 grant 过滤 operation：智能体能看到权限范围内所有可用工具，不能看到缺少 scope、toolset、risk 上限或被 deny 的工具。`/api/mcp/local-grant` 的默认策略是：没有匹配目标时只授予默认只读 agent toolset；匹配到受支持本机 agent 目标后自动授予预定义 safe-write agent toolset，并记录 `targetMatch`、`matchedTargets`、`unmatchedTargets` 和 `agentProfileId`。高风险内部 operation 只能通过显式 grant 扩展，并且必须保留 Tool Management policy preview、approval 和 audit。

每次 `tools/call` 执行完成或失败后，服务端必须通过同一 grant 的 SSE 连接推送主动回信：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/pact/operation_reply",
  "params": {
    "schemaVersion": 1,
    "status": "completed",
    "operation": "workspace.file.upload",
    "envelope": { "traceId": "mcp_trace_...", "idempotencyKey": "mcp_intent_..." },
    "target": {
      "schemaVersion": 1,
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

MCP interface version 固定从 `pact.mcp.v1` 开始。服务端必须在三个位置暴露版本：

- `initialize.result.serverInfo.version`
- `initialize.result._meta.interfaceVersion` / `toolsetVersion`
- `GET /.well-known/pact/mcp.json` 和 `GET /api/mcp/discovery`

服务端声明 `capabilities.tools.listChanged = true`。当工具 schema、interface version 或 toolset version 变化时，支持 Streamable HTTP 的客户端可通过 `GET /mcp` 的 SSE 事件收到 JSON-RPC notification：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed",
  "params": {
    "interfaceVersion": "pact.mcp.v1",
    "toolsetVersion": "2026-05-25.1",
    "categorizedOutlets": ["pact.discovery", "pact.knowledge", "pact.sharedspace", "pact.codespace", "pact.skillHub"],
    "compatToolName": "pact.call"
  }
}
```

不支持持续 SSE 的客户端通过下一次 `initialize`、`tools/list` 或 `pact.discovery({ "operation": "pact.mcp.version" })` 获取版本变化。只有 endpoint、auth 或客户端插件 manifest 变更时才需要重新运行 `pact-mcp register` 或按单客户端重新连接。

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
npm run server:mcp:install -- --target gemini-cli
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
3. `tools/list` 是否只返回 `pact.discovery`、`pact.knowledge`、`pact.sharedspace`、`pact.codespace`、`pact.skillHub`。
4. `tools/call pact.discovery` 调用 `operation=pact.mcp.version` 是否成功，`tools/call pact.sharedspace` 调用一个已授权 workspace operation 是否成功。
5. 统一 registry `~/.pact/mcp/servers.json` 是否存在并指向已签名验证的当前服务。
6. 每个显式 opt-in 的 target 配置是否包含 Pact MCP。
7. OrbStack VM 是否能访问 discovery 返回的 `vmHttpUrl`。

#### Implementation boundary

MCP handler 不能直接读写文件夹、知识库内部实现或 Tool Management platform internals。所有 `tools/call` 都必须先进入五个语义入口或兼容入口 `pact.call`，再通过 `pact.tool-skill-management.v1` provider 落到现有 Operation Registry、Tool Management、Workspace API、Policy Engine、Operation Ledger、Checkpoint Tree 和 storage metadata。MCP adapter 只做协议转换、身份注入、版本协商、错误规范化和 streaming / stdio transport 兼容。

本机五阶段演示使用的是内部 operation id，不是 MCP tool name。调用方式固定为通过语义入口传递 `operation`：

```text
pact.sharedspace({ "apiVersion": "pact.mcp.v1", "operation": "workspace.file.upload", "input": {...} })
pact.sharedspace({ "apiVersion": "pact.mcp.v1", "operation": "workspace.file.list", "input": {...} })
pact.knowledge({ "apiVersion": "pact.mcp.v1", "operation": "knowledge.search", "input": {...} })
pact.skillHub({ "apiVersion": "pact.mcp.v1", "operation": "pact.skillHub.list", "input": {...} })
pact.skillHub({ "apiVersion": "pact.mcp.v1", "operation": "workspace.audit.query", "input": {...} })
pact.discovery({ "apiVersion": "pact.mcp.v1", "operation": "pact.capabilities.list", "input": {} })
```

工具命名要对智能体稳定。内部可以把 operation `workspace.file.upload` 映射为 `workspace.contribution.submit(type=file)`，把 `workspace.file.list/download` 的结果投影成 asset 视图，但 MCP 对外工具名只能是五个语义入口，不能在演示过程中漂移。

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

`pact.tool-skill-management.v1` 是通用工具与技能的应用层 provider 协议。它聚合 Tool Management catalog/grant/runtime、Skill Hub 语义出口、MCP local grant、workspace ref 公共映射、MCP 输出脱敏和 MCP client connection projection。

服务层和 MCP adapter 的约束：

- 只能调用 `toolSkillManagementProvider.authorizeRequest/listVisibleTools/executeTool/resolveMcpWorkspaceInput/publicMcpToolPayload/createLocalMcpGrant/markLocalMcpGrantUninstalled` 等 provider 方法。
- 不能直接读取 Tool Management platform 的 `registry`、`store`、`runtime` 或 `router`。
- console grant、MCP authorization request、Tool Management HTTP passthrough 和 client connection projection 也必须通过 provider 进入 Tool/Skill 子系统。

验收守卫：`npm run server:verify:tool-skill-management` 必须确认 MCP adapter 没有回退到 Tool Management internals，并验证 provider 的授权、可见 operation、执行、local grant、workspace ref 和输出脱敏行为。

## Code Review Route Protocol

`pact.code-review.v1` 管理代码上传的目标选择、Gerrit change 创建和状态同步。它不是 Git API 的裸代理，也不是 Workspace Asset API 的替代品；它是 Workspace API 下的一条代码贡献路线。Pact 内部由 `pact.codespace.v1` 的 Codespace registry/provider 持久化 target、CodeChange、changeSet、review target link、upload receipt、status sync 和 fallback event。

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

- `server:migrate:v001` 只在 `ServerConfig.getDataDir()` 对应运行目录生成迁移/保留报告、恢复点 manifest 和 rollback preview，不移动运行配置回 repo，也不清空旧 runtime 状态。
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

`pact.workspace-governance.v1` 是组织级工作空间共享治理协议。它不替代 contribution lifecycle，而是在 contribution、workspace share、asset copy/export/checkout、retention dispose 之前提供统一裁决。

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

知识协议公开面是 `knowledgeBase` mount 和 `pact.knowledge.v1`。调用方不能直接扫描 SQLite、raw object、manifest 或外部知识库私有 API。

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

`raw-corpus.format.convert`、`knowledge.dossier.export` 和 `knowledge.distillation.export` 由 `pact.knowledge-transformation.v1` provider 执行。返回值统一为 portable export package：包含 `contentType`、`fileName`、`byteSize`、文本 `content`（适用时）、`contentBase64`、`manifest`、`documentCount` 和 `knowledgeAccessDecision`。导出前必须经 AgentLibrary access decision 裁决，并把 receipt/loan/denied request 写入 authorization store。

知识分三层：

1. `raw-corpus-construction`：原始语料、format-conversion-only、normalized documents、sourceRange、DOCX/YAML sidecar；所有受支持原始输入格式都必须能以 DOCX 作为目标格式导出。
2. `knowledge-index-construction`：canonical evidence/index，`KnowledgeCore` 或 external knowledge-base adapter。
3. `knowledge-distillation`：从原始语料全文生成自包含知识文档，只作为背景和交付物，不替代 evidence；第二层 evidence 只负责校验、引用、补证。

工业级蒸馏验收使用 `pact.external-knowledge-distillation.industrial-benchmark.v1`。唯一维护面是 `external.knowledge.distillation`，通过本地 RAGFlow、MinerU、Docling、LlamaIndex、Marker、GraphRAG、Haystack 和 Unstructured 参考框架对比 route-first、windowing、分类蒸馏、Graph evidence、human/agent 响应分离和 Office 专业适配；内部 `knowledge.distillation.*` 只返回迁移报文。

外部知识蒸馏服务按远程容器默认部署时，`pact.external-knowledge-distillation.service-gates.v1` 是前置门禁。容器态默认要求 `PACT_EXTERNAL_KD_API_TOKEN`，只有 `/health` 和 `/v1/runtime/health` 作为编排健康检查公开；capabilities、runs、evidence、artifacts 和 cancel 等业务 API 必须通过 bearer gate。镜像还必须固定 Tika checksum、运行非 root 用户并声明 healthcheck。`npm run server:verify:external-knowledge-distillation-service-gates` 必须先于外部知识蒸馏功能回归执行。

Pact 侧访问 `external.knowledge.distillation` 时必须先进入外部服务上游网关切面。`runs.list/get/create/cancel`、`evidence.query`、`projects.evidence.query`、`artifacts.export`、产物下载、package export、stage export、compare、delete 和 archive 都不能绕过 operation authorization、Tool Management grant、egress policy、audit receipt 和 denied decision。兼容期 `knowledge.distillation.workbench.*` 只返回迁移报文，不对智能体暴露，也不能继续承载真实算法或下载能力。

蒸馏持续优化使用 `pact.knowledge-distillation-optimization.v1`。每次 `knowledgeSkillSet` evolution run 必须记录 `promptVersion`、baseline skill/model/framework、candidate skill IDs、evaluation dataset version/case IDs、error attribution、metric trend、human review 状态和 canary deployment；失败评估进入人工审核队列，通过评估后才能发布 canary，后续仍必须保留 promote/rollback 审计链。

蒸馏 portable 输出使用 `portable.knowledge-distillation.v1`，正文由稳定有序的 `contentBlocks` 组成。

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

v0.0.1 面向上游知识库的兼容入口是 `pact.knowledge-backend-port.v1`，实现位于 `server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs`。Dify 和 RAGFlow provider manifest 写入 `ServerConfig.getDataDir()/knowledge/knowledge-backends.json`，只允许 `secret://` secret ref 和 `config://` endpoint ref；Agent、MCP、CLI 和控制台都不能接触上游 token。当前无真实 Dify/RAGFlow 凭据时，`knowledge.backend.connect`、`knowledge.space.list`、`knowledge.search`、`knowledge.evidence.get` 和 `knowledge.export.request` 返回 `contractVerified=true`，不能表述为真实上游检索、真实 evidence 回读或真实导出。

`knowledge.space.list` 只返回安全派生空间元数据：`derivedKnowledgeSpace`、`derivedViewRef`、`upstreamKnowledgeRef`、`upstreamPolicyRef`、data class、sensitivity 和访问模式。默认 discover/search 不返回正文、snippet、上游裸对象 id、私有路径或上游 dataset id。v0.0.1 protocol evidence HTTP path 为 `GET /api/knowledge/evidence-read`，避免与旧兼容路径 `GET /api/knowledge/evidence/:evidenceId` 冲突。

`knowledge.search` 如带 `provider=dify|ragflow`、`knowledgeBackend=true`、`spaceId` 或 `backendRef`，先进入 KnowledgeBasePort，再执行 AgentLibrary authorization overlay。search 结果默认 `metadataOnly=true`，正文只能通过 `knowledge.evidence.get` 在授权后读取。成功 evidence 读取必须写入 `knowledgeAccessReceipt` 和 `loanRecord`；未授权 evidence 或 export 必须写入 denied request audit。`knowledge.export.request` 必须显式授权，未授权时 `backendExportInvoked=false`。

数据连接器治理保留在服务端协议层，不要求本轮实现客户端连接器。`pact.data-connector-governance.v1` 校验 `pact.data-connector.v1` manifest，并用 `pact.local-mirror.v1` 验收 OAuth refresh 策略、增量 cursor、冲突处理、hash collision quarantine、rate limit、mirror cleanup、localQuery 禁远程和 uninstall policy。当前实现入口是 `server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs`。

性能容量基准使用 `pact.performance-capacity.v1`。该协议定义 `smoke`、`pilot`、`production` 容量目标，并用合成 corpus 实际经过 `KnowledgeCore` ingest/search，同时记录外部 mirror sync、蒸馏吞吐、估算成本和失败注入结果。当前实现入口是 `server/platform/specialized/knowledge/performance/capacity-benchmark/index.mjs`。

## Asset Lineage Protocol

`pact.asset-lineage.v1` 是多模态资产治理协议。图片、表格、OCR 文本、PDF/PPT 视觉元素和图文穿插蒸馏材料都必须能回溯到原始对象、页面或幻灯片、坐标锚点、解析器版本和视觉模型版本。

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

`pact.knowledge-access.v1` 是智能体访问 AgentLibrary 资产的源头权限协议。它不是检索算法的后处理，而是在 source、document、section、block、field、asset、evidence、export、context bundle、memory write 之前统一裁决。

`pact.agent-library.v1` 是同一能力的产品语义层：它把知识访问表达为 library card、reading room、share、checkout、loan record 和 revoke。底层可继续由 `knowledgeBase` / `pact.knowledge.v1` mount 实现。

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

上游知识库 A/B 权限再授权演示验证 `pact.knowledge-access.v1` 是否真的在源头治理权限：

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

`pact.client-runtime-bootstrap.v1` 让最小 MCP connector 或本地客户端先声明环境，再由服务端返回可裁剪的 Pact client runtime 计划。协议不能预设本地已有完整客户端；当本地缺少 `pact-client-cli`、`clientd`、upload queue 或 MCP local bridge 时，connector 必须能通过 bootstrap pull 从服务端拉取经过裁剪的客户端模块。

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

- `modules`：始终包含 runtime framework 和 `pact-client-cli`，按需求加入 `clientd`、`upload-queue`、`mcp-local-bridge`、connector/cache 模块和 transport adapter。
- `transportPlan`：候选顺序为 `local-copy`、`rsync-over-ssh`、小文件 `scp`、`sftp`、`pact-http-upload-session`、极小文本 `mcp-inline-content`。
- `installation`：安装根、签名校验要求、当前 artifact 状态、是否需要用户授权，以及是 `plan-only` 还是 `pull-artifacts`。
- `artifacts`：bootstrap pull 返回裁剪模块 artifact refs、版本、digest、签名状态和交付信息；首版实现返回 inline manifest bundle，不伪造二进制 URL，真实下载 URL 由发布流水线或 capability package publisher 填充。

使用约束：

- `bootstrap.pull` 不能返回完整服务端仓库，也不能默认拉取所有客户端能力。
- 客户端必须在请求中声明需要的能力，例如 `upload`、`mcp-local-bridge`、`connectors`、`knowledge-cache` 或 `mail-import`。
- 服务端按能力裁剪 bundle：MCP 大文件上传只需要 framework、`pact-client-cli`、`clientd`、upload queue、`mcp-local-bridge`、HTTP upload session 和必要 transport adapter。
- 客户端必须校验 artifact digest 和签名后才能启用模块。
- `local-copy` 只能作为字节搬运优化，必须把真实 bytes 深拷贝到 Pact staging/CAS；不得保存共享路径引用，不得采用零拷贝引用语义。

native transport 不能仅凭 Linux 平台推断可用。`rsync-over-ssh`、`sftp`、`scp` 都要求客户端命令和服务端能力同时声明；否则标准兜底是现有 upload session/checkpoint 分块协议。

## Strategy Management Protocol

`pact.strategy-management.v1` 是应用层策略管理协议。它收敛处理流程选择、人工确认门禁、智能体调用策略、切面路由策略、模型路由策略包装和工具调用策略预览，不承载真实认证、授权、scope、grant 或 denied audit。安全权限裁决只能通过 `pact.security-permissions.v1` provider 执行，策略管理只能把安全裁决结果纳入策略输出和审计语义。

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

`pact.module-ecosystem.v1` 是服务端模块生态协议，不要求实现客户端。它把外部团队接入 parser、analysis、knowledgeBase、vectorStore、graphStore、Tool Package 和 Skill Package 的动作收敛为四类服务端能力：

- `module_ecosystem.templates`：列出官方模板、mountName、capability、默认示例和 CI 要求。
- `module_ecosystem.plan`：生成脚手架写入计划，明确将创建或覆盖的文件。
- `module_ecosystem.scaffold`：写入 module manifest、示例实现、sample、contract test 脚本和 GitHub Actions 模板；写入操作必须经过 `runtime:admin` 或等价授权。
- `module_ecosystem.contract_test`：导入外部 mount factory，验证 `createMount`、`supports`、`extractDocument/extractText`、`onBatchCompleted`、`reload`、`close` 等合同；对 Tool/Skill 包则验证 capability package manifest。

生成的 mount module manifest 使用 `pact.mount-module.v1`，必须声明 `moduleId`、`templateId`、`mountName`、`entrypoint`、`capabilities`、`contract.factoryExports` 和 `contract.contractTest`。生成的 Tool/Skill 包必须继续服从 `pact.tool-package.v1` / `pact.skill-registry.v1` 生命周期治理。

## Executive Report Protocol

`pact.executive-report.v1` 是服务端管理层报告协议，不依赖前端驾驶舱。它把生产准入、资产贡献统计、容量成本、评估质量和 trace 安全摘要合并成可持久化、可追溯与透明化、可给阶段复盘使用的报告。

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

`pact.architecture-live-map.v1` 是服务端架构活文档协议。它不要求实现客户端，而是把核心架构节点连接到设计文档、服务端实现路径和 production readiness gate，让阶段评审可以直接看到“设计是否落地、落地是否仍在运行门禁中通过”。

每个架构节点必须包含：

- `nodeId`、`label` 和节点级 `status`
- `docRefs[].path/exists`，指向对应设计文档
- `implementationPaths[].path/exists`，指向服务端实现入口
- `gates[].gateId/status/title/nextStep`，指向生产就绪门禁
- `missingDocs` 和 `missingImplementations`，明确活文档断链

公开操作：

- `architecture.live_map`：读取当前架构节点到文档、实现路径和生产门禁状态的映射。

## Sample Business Pack Protocol

`pact.sample-business-pack.v1` 是服务端样例业务包协议，不依赖客户端。它把新成员和业务方最常见的验收材料打包成可物化目录：邮件线程、PDF、PPT、Markdown 项目文档和外部知识库 docker compose。

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

协议版本采用 `pact.<domain>.vN`。破坏性字段变更必须升级版本；新增字段必须向后兼容；删除字段必须先进入 deprecated 状态并保留迁移期。

所有协议变更必须同步：

- `SERVER_API_OPERATIONS`
- Tool Management catalog
- 控制台 bridge/types
- 相关验证脚本
- `docs/PRODUCTION-CAPABILITY-GAP.md` 中的差距项
