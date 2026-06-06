# 八个已确认场景实现差距清单

日期：2026-05-30

本清单只覆盖 `docs/scenarios/README.md` 已确认的 8 个场景。判断口径是：场景文档里的全链路必须在当前代码中有可运行入口、真实调度或 provider、权限/审批闭环、可查询的审计和结果回执。已经存在的 contract-mode、dry-run、debug-only、单点 verifier 都按“已有部分实现”处理，不等同于生产场景闭环。

## 优先级口径

| 优先级 | 判定标准 | 处理目标 |
| --- | --- | --- |
| P0 | 链路断点。缺少真实入口、真实 provider、队列/审批/权限刷新闭环，导致场景不能按设计端到端完成。 | 先补齐可运行闭环和 verifier。 |
| P1 | 链路可跑，但缺少生产隔离、恢复、权限细粒度、审计对齐或 provider parity。 | 补强生产可用性和失败恢复。 |
| P2 | 非阻断增强。规模、体验、报表、可观测性、策略扩展或更多边界条件。 | 排入后续硬化。 |

## 总览

| 场景 | 当前最接近的实现 | P0 状态 |
| --- | --- | --- |
| 01 代码提交 | MCP / Tool Management / Codespace / Gerrit git upload / GitHub CLI contract path | 缺少提交队列和 GitHub 真实回执闭环 |
| 02 知识蒸馏 | Workbench runtime、queue monitor、导出、debug 页触发 | 缺少生产管控台入口和结果级授权隔离 |
| 03 权限配置 | Authorization Governance store、策略裁决、approval grant | 缺少上下游网关刷新和 MCP key/grant 实时刷新闭环 |
| 04 工作空间文件传输 | MCP 上传、下载、stat、patch、checkpoint、restore verifier | 未发现阻断级 P0 |
| 05 技能管理 | `pact.skillHub` outlet、workspace contribution、capability package manifest lifecycle | 缺少“智能体上传技能包到独立技能库”的真实上传和激活链路 |
| 06 云盘共享 | iCloud 本机目录 adapter、OneDrive / Google Drive / Dropbox contract-mode | 缺少外部云盘真实上传/下载 adapter |
| 07 日志记录 | operation audit、console audit、tool audit、局部 ledger | 缺少“所有操作有一个算一个”的统一落账强制覆盖 |
| 08 操作审核 | requiresConfirmation、MCP 授权请求页、知识冲突审批页 | 缺少高危 MCP 操作挂起、主页审批、审批后恢复原请求 |

## P0

### P0-01：代码提交没有进入任务队列 / durable workflow

涉及场景：01 代码提交。

当前实现：

- `workspace.code.change.upload` 在 `executeCodeManagementOperation` 中直接调用 `codespace.uploadChange(...)`。
- `codespace.uploadChange(...)` 直接调用 `uploadGerritGitChange(input)`。
- `gerrit.git_upload` 也直接调用 `uploadGerritGitChange(input)`。
- 代码库里有 work queue、queue monitor 和 durable workflow 基础设施，但代码提交没有创建队列项、没有 worker 领取、没有 durable workflow 状态机。

为什么是 P0：

场景 01 的设计链路已经明确包含 `代码提交任务队列 / durable workflow -> Codespace / Code Review worker`。当前实现是同步直打远端：请求失败、进程退出、网络抖动、审批后恢复都没有持久任务承接。它无法满足“从智能体 MCP 一路打到远程代码库”的可恢复提交链路。

需要补的实现：

- 新增 code submission queue item，包含 `operationId`、repo/worktree、目标 provider、审批决策、idempotencyKey、traceId、actor/grant 快照。
- 新增 Codespace / Code Review worker，从队列领取任务后调用 Gerrit / GitHub adapter。
- 提交结果写回 code-change registry、operation audit、queue monitor、durable workflow history。
- MCP `operation_reply` 不能只代表同步调用完成，还要能回传 queued/running/completed/failed 状态。

验收标准：

- MCP 调用 `pact.workspace.code.change.upload` 后先得到可查询的 `queueId` / `workflowId`。
- worker 完成后可以查询到 Gerrit Change 或 GitHub PR 的真实 receipt。
- verifier 覆盖排队、重启恢复、失败重试、重复 idempotencyKey 去重和审计查询。

### P0-02：GitHub PR 不是完整真实 provider 闭环

涉及场景：01 代码提交。

当前实现：

- `uploadGithubChange(...)` 在没有 `repoId` / `worktreePath` 时返回 `contractVerifiedReceipt(...)`，不创建真实 PR。
- 有本地 repo 时通过 `repo.proposal.create` 调用 `gh pr create`，但 `codespace` 层仍把结果标记为 `contractVerified: true`，并会生成 `github.example.invalid/.../pull/...` 形式的兜底 URL。
- PR number、PR URL、head/base、draft 状态和 provider response 没有被稳定解析成生产 receipt。

为什么是 P0：

场景 01 的终点是 `Gerrit / GitHub`。Gerrit 已有 git push 路径，GitHub 仍可能停留在 contract receipt 或不可用的示例 URL。只要目标选择 GitHub，链路就不能稳定证明“已创建远程 PR”。

需要补的实现：

- 明确 GitHub live adapter：优先 GitHub App/API，CLI 只能作为本地 fallback。
- 解析并保存真实 PR number、URL、state、headRef、baseRef、draft flag、createdAt。
- dry-run / contractVerified 与 live upload 必须分开，不能 live 成功后仍标记 contract-only。
- 增加 GitHub PR 状态同步和失败映射。

验收标准：

- verifier 在可注入 mock GitHub API 的情况下创建 PR，并断言 receipt 里没有 `github.example.invalid`。
- dry-run、无 repo、本地 CLI、GitHub API 四种路径状态语义明确。

### P0-03：知识蒸馏缺少正式管控台入口

涉及场景：02 知识蒸馏。

当前实现：

- 后端已有 `knowledge.distillation.workbench.*` operation、durable run 文件、queue monitor、阶段导出和整包导出。
- 前端当前可见入口主要在 `DebugView.vue` 的 `knowledgeDistillation` 调试 tab，文案也标注为“调试模式”。
- `KnowledgeDistillationWorkbench.vue` 虽然存在，但没有作为正式知识管理或管控台一级工作区入口接入。

为什么是 P0：

场景 02 的起点是“管控台入口执行”，不是调试页。没有正式入口，普通管理员无法按生产工作流创建、追踪、重跑、导出蒸馏结果。

需要补的实现：

- 在知识管理或专门的管控台页面接入 Knowledge Distillation Workbench。
- 支持选择知识源 / 上传源、模型、prompt、预算、运行优先级。
- 展示 run 列表、阶段状态、失败原因、重跑、取消、归档、导出。
- 把 debug-only 的文件上传到蒸馏链路迁移为正式工作流。

验收标准：

- 浏览器 verifier 从正式管控台页面发起一次蒸馏任务并下载结果。
- Debug tab 不再是唯一入口。

### P0-04：知识蒸馏结果缺少 run 级授权隔离

涉及场景：02 知识蒸馏。

当前实现：

- 旧内部 Workbench 已废弃，知识蒸馏 run 需要统一迁移到 `external.knowledge.distillation` 服务的持久化与导出链路。
- operation registry 只按 `knowledge:read` / `knowledge:maintain` 做粗粒度 scope。
- 外部服务的 `runs.create` / `runs.get` / `artifacts.export` 需要持久化 owner / workspace / tenant / source permission snapshot，并在读取、导出、取消、归档和对比时按 run 归属做授权裁决。

为什么是 P0：

场景 02 的验收口径包含“未授权用户不能读取或导出不属于自己的蒸馏结果”。当前只要有 `knowledge:read`，就可能读取其他 run。蒸馏结果通常包含浓缩后的业务知识，越过结果级授权会直接破坏场景安全边界。

需要补的实现：

- run 创建时写入 owner、tenant、workspace、sourceIds、permissionSnapshot、modelAlias。
- `get/export/package/compare/delete/archive` 全部通过 authorization facade 做资源级裁决。
- 导出包 manifest 写入权限快照和访问 receipt。

验收标准：

- verifier 创建两个用户/agent 的 run，断言跨用户读取、导出、比较会被拒绝。
- audit 中能看到允许和拒绝的 policy decision。

### P0-05：权限配置没有刷新上下游网关和 MCP grant/key

涉及场景：03 权限配置。

当前实现：

- Authorization Governance store 支持 role、team、user policy、agent group、agent binding、approval grant 的持久化与裁决。
- `authorization.policy.evaluate` 可以按当前 store 立即评估。
- Tool Management grant/token 存储和 opaque capability key 体系存在。
- 没有看到权限变更后对 MCP 长连接、active grants、gateway policy cache、上下游网关的显式刷新 / invalidation / reissue。

为什么是 P0：

场景 03 的终点不是“配置保存成功”，而是“上下游网关拦截生效 + 智能体 MCP 密钥权限刷新”。当前实现只能证明新评估会读到新策略，不能证明已经连接的智能体和网关都刷新了有效权限。

需要补的实现：

- 每次 governance mutation 生成 policy version / revision。
- Tool Management grant 关联 policy version，策略变更后标记 stale 或重算 capability set。
- MCP SSE/notification 向受影响 grant 推送 `permissions.updated`。
- Gateway ingress / downstream gateway 接入 versioned policy reload。
- 旧 key 的使用要么按新版本实时裁决，要么触发轮换/失效。

验收标准：

- 同一 MCP token 在权限变更前后执行同一 tool，结果从 allow 变 deny 或从 deny 变 allow。
- verifier 断言通知已发出、grant version 已变化、gateway 拦截状态已变化。

### P0-06：技能管理没有“上传技能包到独立技能库”的真实链路

涉及场景：05 技能管理。

当前实现：

- MCP 暴露了 `pact.skillHub` outlet。
- `workspace.skill.upload` 当前走 workspace contribution registry，`contributionType: "skill"`，不是独立 server skill library。
- capability package lifecycle 支持 `kind: "skill"` 的 manifest plan/submit/lifecycle，但主要是 manifest registry，没有实现技能包文件上传、解包、隔离存储、激活后目录刷新。
- `capabilities/skills/README.md` 明确要求外部技能进入 capability package lifecycle，但 MCP upload operation 与该 lifecycle 没有合并成一条端到端链路。

为什么是 P0：

场景 05 的终点是“服务端的技能库，单独存放管理”。当前上传入口把技能当 workspace contribution；另一个 lifecycle 只管理 manifest。两者没有形成智能体 MCP 上传技能包、校验、入库、版本、发布、禁用、目录刷新的闭环。

需要补的实现：

- 定义 `pact.skillHub.upload` 或将 `workspace.skill.upload` 路由到 capability package lifecycle。
- 支持上传技能包 artifact：manifest、SKILL.md、scripts/assets/templates、checksum、signature。
- 服务端独立 skill library 存储：不能混在 workspace contribution。
- lifecycle 变更后刷新 Tool/Skill catalog、agent profile 可见目录和 MCP discovery。
- 增加禁用、回滚、删除、审计和安全扫描。

验收标准：

- MCP 上传一个最小技能包后，服务端 skill library 出现独立记录。
- approve/install/activate 后，`pact.discovery` 能看到更新后的技能能力。
- disabled/deprecated 后，同一 MCP grant 不再可见或不可执行。

### P0-07：云盘共享只有 iCloud 本机 adapter，外部云盘是 contract-mode

涉及场景：06 云盘共享。

当前实现：

- CloudDrivePort 支持 provider 名称：iCloud、OneDrive、Google Drive、Dropbox。
- iCloud 使用本机目录 adapter，可以真实读写本地受控目录。
- OneDrive / Google Drive / Dropbox 创建的是 `mode: "contract"`，`contractVerified: true`，upload/download 生成 receipt，但不调用真实 provider API。
- module metadata 也标注这些 provider 是 contract-mode adapters。

为什么是 P0：

场景 06 明确是“上传文件到外部云盘的全链路，以及下载文件”。contract-mode 只能证明 Pact 内部协议与 receipt，不证明外部云盘实际写入或读取。

需要补的实现：

- 为 OneDrive、Google Drive、Dropbox 增加 live adapter。
- 接入 OAuth token secretRef、endpointRef、refresh、scope 校验。
- 上传、下载、列目录、权限列表和 sync apply 调用真实 API。
- receipt 必须包含 provider fileId / revision / webUrl / etag 或等价字段。
- contract-mode 保留为测试模式，但 UI 和 API 要清楚区分。

验收标准：

- 可用 fake provider server 或官方 sandbox 跑 E2E，断言远端文件被创建、读取、覆盖和删除。
- receipt 中 `contractVerified` 与 `localAdapterVerified` 不能被误用为 live success。

### P0-08：日志记录没有全系统强制落账覆盖

涉及场景：07 日志记录。

当前实现：

- `operation-dispatcher` 对注册 operation 写入 `operation_audit.sqlite`。
- `appendConsoleOperationLog` 为部分 console domain operation 做 best-effort 记录。
- Tool Management 有独立 audit/metric/execution 表。
- 云盘、知识后端、workspace 等能力有自己的 ledger 或 receipt。
- 后台 worker、直接 provider 调用、运行时内部事件、部分 domain helper 并不强制经过统一 audit facade。

为什么是 P0：

场景 07 的要求是“记录系统的所有操作，有一个算一个全都记下来”。当前实现是多套日志并存，且存在绕过统一 operation dispatcher 的调用路径。只要某个操作能改变状态但没有统一 audit record，就不能满足该场景。

需要补的实现：

- 定义全局 audit facade，所有 state mutation、外部 IO、后台任务、MCP tool execution 都必须调用。
- operation audit、tool audit、provider ledger、queue event 统一关联 `traceId` / `requestId` / `operationId` / `actor`。
- 增加 coverage verifier：扫描注册 operation 和关键 mutation provider，断言有 audit wrapper 或 ledger bridge。
- 对 best-effort 日志路径补失败告警，不能静默吞掉审计失败。

验收标准：

- 任意注册 operation 执行后可在统一 audit 查询到记录。
- 典型后台任务、云盘上传、技能上传、权限更新、代码提交都能通过同一 trace drilldown 查到完整链。

### P0-09：高危 MCP 操作没有挂起到主页审批流并恢复原请求

涉及场景：08 操作审核。

当前实现：

- operation safety 支持 `requiresConfirmation`，缺少确认时返回 428/409。
- Tool policy 对 `requiresApproval` / `requiresConfirmation` 会直接拒绝或要求确认。
- ApprovalFlowView 当前聚合 MCP 授权请求和知识冲突 review。
- Tool Management 有 `mcp_authorization_requests`，用于请求授予 MCP 权限，不是某一次高危操作的 pending execution。
- 没有看到保存原始 MCP operation payload、挂起、主页审批、审批通过后恢复执行的状态机。

为什么是 P0：

场景 08 的核心不是“要求 confirm=true”，而是“所有高危行为都拦截下来，提到主页审批流，审批通过之后放行智能体操作”。当前实现会拒绝或要求同步确认，不会把原请求变成 pending item，也不会在审批后自动恢复。

需要补的实现：

- 在 MCP gateway / Tool Management runtime 中识别高危操作，创建 `pending_operation`。
- pending item 保存原始 payload、grant、trace、risk reason、expiresAt、idempotencyKey。
- ApprovalFlowView 展示该 pending operation，支持 approve/reject/expire。
- approve 后 worker 或 runtime 恢复原请求，沿用原 traceId 并回发 `operation_reply`。
- reject/expire 后记录终止审计并通知 MCP client。

验收标准：

- MCP 调用高危 tool 时不会直接执行，主页出现 pending item。
- 审批通过后远端操作执行并返回结果。
- 审批拒绝/过期时不执行原操作，audit 可查。

## P1

### P1-01：代码提交缺少 provider 状态同步的生产一致性

涉及场景：01 代码提交。

当前实现有 `codespace.review.status.sync` 和 Gerrit / GitHub review 操作入口，但 GitHub receipt 可能来自 contract path，Gerrit 状态同步也主要围绕 registry 内部变更。补齐 P0 队列后，还需要把 PR / Change 的实时状态、CI、review labels、submit/merge 状态同步回统一 code-change registry。

### P1-02：代码提交缺少提交前后 workspace 变更快照绑定

涉及场景：01 代码提交、04 工作空间。

场景 01 需要能解释“智能体提交了什么”。当前 workspace 文件链路有 checkpoint，但代码提交链路没有强制绑定 workspace checkpoint、diff snapshot、审批快照和最终远程 receipt。后续应把 code change task 与 workspace checkpoint tree、repo commit、remote review object 建立不可变关联。

### P1-03：知识蒸馏没有正式报表化验收面

涉及场景：02 知识蒸馏、07 日志记录。

Workbench 已有 stage、quality report、导出包，但还缺少面向管控台的质量报告页：输入摘要、引用覆盖、 unsupported conclusion、模型配置、失败重试、运行成本和审计 receipt 应该能在同一视图查看。

### P1-04：权限配置缺少变更审批和回滚

涉及场景：03 权限配置、08 操作审核。

当前 governance mutation 可以直接 upsert。权限变更本身属于高风险操作，应进入审批流或至少要求高权限确认，并支持按 policy version 回滚。否则“配置权限”场景上线后容易产生不可追踪的越权或误锁。

### P1-05：工作空间文件传输缺少大文件/二进制流式能力

涉及场景：04 工作空间。

MCP 验证覆盖了文本文件、base64、下载、patch、checkpoint 和 restore。仍缺少大文件分片上传、断点续传、下载流式响应、二进制 MIME 处理和配额限制。当前 inline `content` / `contentBase64` 模式适合小文件，不适合大文件协作。

### P1-06：工作空间文件权限仍偏 workspace 级，缺少路径级策略

涉及场景：04 工作空间、03 权限配置。

workspace file operation 已有 scopes 和 access receipt，但 path-level ACL、目录共享策略、敏感路径黑白名单、跨 workspace 下载授权还需要和 Authorization Governance 统一起来。

### P1-07：技能包 lifecycle 与 Tool Management catalog 尚未原子同步

涉及场景：05 技能管理。

capability package 激活后需要把新技能同步到 Tool/Skill catalog、agent profiles、MCP discovery。当前 lifecycle registry 与 Tool Management catalog 是相邻能力，但不是同一个事务边界。需要避免“包已 active，但智能体不可见”或“已禁用但仍可见”。

### P1-08：技能包缺少运行时安全扫描和依赖安装隔离

涉及场景：05 技能管理。

manifest 校验覆盖签名、license、sandbox、dependencies，但没有对上传内容做脚本扫描、依赖锁定、命令白名单、网络访问证明、资源限制和安装前 dry-run。技能管理一旦允许智能体上传代码，这些就是生产必需项。

### P1-09：云盘共享缺少远端权限映射和冲突解决

涉及场景：06 云盘共享、03 权限配置。

CloudDrivePort 有 `permission.list` 操作和 directory mapping，但 live provider 后还需要把外部 ACL 映射到 Pact workspace 权限，并处理远端文件版本冲突、覆盖策略、etag 不匹配和撤销共享。

### P1-10：审计查询没有把多类 ledger 合成单一时间线

涉及场景：07 日志记录。

operation audit、tool audit、workspace checkpoint、cloud drive ledger、knowledge backend ledger 仍是多处查询。需要 `trace drilldown` 能把这些按同一 correlation ID 合并，否则排障时仍要人工跨表拼接。

### P1-11：审批流缺少 pending operation 的超时、撤销和幂等

涉及场景：08 操作审核。

P0 补齐 pending/resume 后，还要补超时处理、审批撤销、重复 approve 的幂等、client disconnect 后恢复、审批人权限校验和审批结果不可篡改存证。

## P2

### P2-01：场景级 verifier 覆盖不均

当前有单项 verifier：Gerrit MCP、workspace file upload、cloud drive e2e、knowledge distillation workbench、authorization governance、operation policy 等。缺少一个按 8 个场景聚合的 `server:verify:scenario-e2e`，能把每条链路的关键断言串起来并输出缺口报告。

### P2-02：场景文档与实现状态缺少机器可读关联

`scenario-catalog.json` 记录了链路，但没有记录每个链路节点的实现状态、对应 operation、verifier 和 blocker。后续可以把本缺口文档转成 `scenario-implementation-status.json`，由 verifier 校验文档、代码和测试项一致。

### P2-03：管控台缺少按场景聚合的运维视图

现在功能分散在 Workspaces、Debug、Approval、Logs、Tools、AgentPermissions 等页面。建议增加场景视角：每个场景显示入口、最近执行、失败率、未完成任务、审批积压和缺口状态。

### P2-04：provider 模式命名需要统一

代码里同时出现 `dryRun`、`contractVerified`、`localAdapterVerified`、`uploaded`、`projected`、`staged`。这些状态不能混用。建议统一为 `contract`、`local-live`、`remote-live`、`dry-run`、`failed`，并在 receipt 中强制声明。

### P2-05：审批、权限和审计的 UI 文案需要避免误导

例如“批准”可能是批准 MCP 授权请求，也可能是批准某次高危操作；“已连接云盘”可能是 contract-mode，不等于真实外部账号可用。后续需要在 UI 上把授权请求、操作审批、contract-mode、真实 provider 成功分开展示。
