# U-1-Data

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current boundary reference
- Scope: U-1-Data.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文是 Pact 的数据、资源、状态、证据统一口径文档。它不存放运行时数据值，而是存放所有跨边界数据对象的分类、权威状态、证据语义、生命周期和事实源约束。

`U-1-Data` 与其它边界文档的分工：

- `2-3-5-Security-Model.md`：定义准入、身份、权限、行为、密钥、凭据、风险。
- `N-2-N-Interfaces.md`：定义 Pact 与外部服务、下游客户端之间的接口和 adapter 边界。
- `U-1-Data.md`：定义数据、资源、状态、证据、回执、账本、快照、投影和外部引用的统一事实口径。

## 目标

`U-1-Data` 解决四个问题：

1. 什么东西算 Pact 的数据、资源、状态或证据。
2. 哪些对象是 canonical state，哪些只是 projection、cache、mirror 或外部引用。
3. 跨客户端边界或外部服务边界时，数据如何进入、离开、被证明、被恢复。
4. 控制台、MCP、CLI、外部 adapter 和内部模块应该引用同一套对象语义，而不是各自发明状态名。

## 数据分类

| 类别 | 定义 | 例子 | 事实源要求 |
| --- | --- | --- | --- |
| Data | 可被读取、解析、切分、导出或写入上下文的内容本体 | raw object、document、chunk、field、table cell、image、attachment、context bundle | 必须有来源、digest、dataClass、权限范围和存储引用 |
| Resource | 可被治理、授权、引用、复用、撤销或恢复的资源对象 | workspace、source、asset、artifact、skill、tool package、codeChange、driveRef、externalObjectRef | 必须有 resource id、owner/workspace、state、policyRefs 和 lineage |
| State | 对资源、任务、同步、运行、授权或外部写入的当前事实判断 | asset state、task state、upload job、sync cursor、grant status、provider health、runtime degraded state | 必须能通过 Operation Ledger、Checkpoint、metadata store 或 provider receipt 解释 |
| Evidence | 用于证明访问、裁决、来源、持久化、同步、失败或恢复的记录 | evidence pack、receipt、loan record、audit event、checkpoint node、policy decision、provider receipt、trace | 必须可追溯、可审计、可关联到 operation 和 subject |
| Projection | 从 canonical state 派生出来的查询、展示或镜像视图 | file tree、search index、report、dashboard row、mirror projection、cache | 不能作为权限事实源或恢复事实源 |
| External Ref | 指向外部系统中对象或状态的受控引用 | GitHub PR、Gerrit change、Google Drive fileId、Dify dataset、Qdrant collection | 必须带 provider、scope、durable id、status 和 receipt |

## 数据链路

数据链路描述数据从边界外进入 Pact、在 Pact 内变成 canonical state、再被授权输出或同步到外部系统的全过程。链路中的每一步都必须能落到 Data、Resource、State、Evidence、Projection 或 External Ref。

| 阶段 | 输入 | Pact 处理 | 输出事实 |
| --- | --- | --- | --- |
| 1. Source Intake | 上传文件、本地路径、外部 API 返回、webhook、模型输出、代码 diff、人工输入 | 生成 sourceRef、初始 operation、trace 和 ingest intent | `source`、`operation`、`auditEvent` |
| 2. Capture / Transfer | 字节流、小文本、目录、远端对象、外部引用 | 校验 size、digest、media type、路径、quota、transport result | `rawObject`、`storageRef`、`upload state` |
| 3. Normalize / Parse | raw object 或外部对象内容 | 解析正文、metadata、attachment、table、image、code、mail thread | `document`、`chunk`、`asset rendition`、`parse receipt` |
| 4. Classify / Govern | 解析结果和来源 metadata | 标注 dataClass、sensitivity、workspace scope、retention、policyRefs | `classification state`、`authorizationOverlay` |
| 5. Commit Canonical State | 受治理的资源对象和状态变化 | 写入 metadata、Operation Ledger、Checkpoint Tree、Audit Store | `asset`、`stateDelta`、`checkpointNode`、`auditRefs` |
| 6. Build Projections | canonical state | 构建文件树、搜索索引、报表、dashboard、mirror projection | `projection`、`index state`、`report row` |
| 7. Evidence Materialization | asset、chunk、policy、query context | 生成权限裁决后的 evidence pack、controlled view、context bundle | `evidencePack`、`receipt`、`loanRecord` |
| 8. Output / Export | 下载、导出、context injection、memory write、tool/model input | 经过权限、出口、风险、审计和 payload budget 裁剪 | `export package`、`context bundle`、`output receipt` |
| 9. External Sync / Write | 外部 adapter 写入、代码 review、云盘同步、知识库镜像 | 记录 provider scope、durable id、etag/version、commit/change/fileId | `externalObjectRef`、`providerReceipt`、`sync state` |
| 10. Lifecycle / Recovery | 撤销、过期、清理、恢复、重建、重放 | 根据 checkpoint、ledger、receipt、lineage 重放或恢复 | `restore operation`、`retention state`、`recovery evidence` |

链路规则：

- 进入链路的内容如果没有 `sourceRef`、`digest` 或等价完整性证明，只能处于 `staged` 或 `degraded`。
- 没有写入 Operation Ledger 和 Checkpoint Tree 的对象，不能被声明为 canonical state。
- Projection 可以被重建，不能反向成为事实源。
- Evidence 必须来自权限裁决后的对象，不能把裸 chunk、外部搜索结果或 provider 原始响应直接交给下游。
- Output 必须产生 receipt；失败或拒绝也必须产生 denied request 或 audit evidence。
- External Sync 必须有 providerReceipt；没有 durable id 的外部写入不能标记为 `committed`。

## Canonical State

Pact 的 canonical state 不是某一个文件夹或某一张表。它由以下对象共同构成：

- Workspace metadata：workspace、source、asset、artifact、task、contribution、policy、retention。
- Operation Ledger：所有外部可见操作的 intent、input 摘要、result、stateDelta 和 error。
- Checkpoint Tree：可恢复状态边界、pre/post snapshot、restore preview 和 restore operation。
- Audit Store：访问、拒绝、授权、下载、导出、工具执行、模型调用、外部副作用和恢复记录。
- Receipt / Loan Record：内容被看见、借走、导出、写入上下文或同步到外部的证据。
- Storage metadata：raw object、parsed object、asset rendition、content root、digest、size、media type。
- Authorization overlay：资源在 workspace、subject、agentProfile、dataClass 和出口动作上的可见范围。
- External object registry：外部 provider 的 durable id、etag/version、commit/change/fileId、sync cursor 和状态投影。

文件树、索引、报表、缓存、mirror 和控制台列表都是 projection。它们可以提升查询体验，但不能单独证明权限、状态或恢复结果。

## 资源对象

| 资源对象 | 说明 |
| --- | --- |
| `workspace` | 公共工作空间边界，承载资产、任务、知识、贡献、权限和审计。 |
| `source` | 数据来源，可以是上传、本地文件、邮箱、云盘、外部知识库、代码平台或业务系统。 |
| `asset` | 被 Pact 治理的资源实体，可以是文件、知识、代码材料、报告、脚本、Skill、工具包或派生产物。 |
| `evidencePack` | 权限裁决后的证据包，不是裸 chunk。它描述证据、来源、可见范围、可引用范围和带走限制。 |
| `artifact` | 由人或 agent 生成的产物，例如分析报告、补丁、导出包、context bundle。 |
| `codeChange` | 需要进入代码评审系统的代码变更治理对象，不等同普通文件资产。 |
| `task` | 工作空间内可恢复、可审计的任务状态和接力对象。 |
| `proposal` | 对公共状态的修改建议，等待审核、合并或拒绝。 |
| `externalObjectRef` | 外部服务对象引用，例如 PR、Gerrit change、drive file、knowledge dataset、vector collection。 |

## 状态对象

状态必须说明“这件事现在处于哪个事实阶段”，不能用模糊文本代替。

| 状态域 | 标准状态 |
| --- | --- |
| 资产贡献 | `submitted`、`preview`、`scanned`、`reviewed`、`published`、`rejected`、`needs_changes`、`adopted`、`deprecated`、`revoked` |
| 上传/传输 | `queued`、`staged`、`transferring`、`archived`、`failed`、`rejected`、`deduplicated` |
| 外部同步 | `queued`、`staged`、`synced`、`committed`、`projected`、`cached`、`failed`、`contractVerified`、`realE2EVerified` |
| 权限裁决 | `allowed`、`denied`、`needsApproval`、`expired`、`revoked`、`degraded` |
| 运行健康 | `healthy`、`degraded`、`unavailable`、`misconfigured`、`contractOnly` |
| 恢复流程 | `previewed`、`approved`、`restored`、`blocked`、`superseded` |

弱状态不能被冒充为强状态：

- `queued` 不等于 `archived`。
- `cached` 不等于 `committed`。
- `projected` 不等于 canonical state。
- `contractVerified` 不等于真实 E2E 或 production ready。
- `degraded` 不等于强安全边界。

## 证据对象

证据不是日志别名。证据必须能回答“谁、何时、通过什么边界、对哪个对象、做了什么、为什么允许或拒绝、结果是否真的发生”。

| 证据对象 | 证明内容 |
| --- | --- |
| `auditEvent` | 操作、访问、拒绝、授权、工具执行、模型调用、外部写入和恢复动作发生过。 |
| `receipt` | 数据被返回、下载、导出、同步、写入上下文或交给某个 subject。 |
| `loanRecord` | 某个 evidence、asset 或 context 被借走，并有范围、期限和撤销策略。 |
| `deniedRequest` | 请求被拒绝，包含 reasonCode、operationId、subject、resource 和策略依据。 |
| `checkpointNode` | 读、写、导出、下载、工具调用、权限裁决或恢复形成了可回放状态节点。 |
| `policyDecision` | 某次准入、权限、风险、出口或外部副作用裁决的结果。 |
| `providerReceipt` | 外部服务返回的持久化证明，例如 fileId、commit、change、reviewUrl、messageId、etag。 |
| `trace` | 连接 operation、policy、model、tool、provider、成本、失败点和 checkpoint 的排障路径。 |

## 最小字段

进入 `U-1-Data` 管辖范围的对象，至少要能映射出这些字段：

```text
id
kind
workspaceId
sourceRef
subjectRef
agentProfileRef
dataClass
state
policyRefs
lineageRefs
digest
storageRef
externalRefs
receiptRefs
auditRefs
checkpointRefs
createdAt
updatedAt
expiresAt
```

不是每个对象都要物理保存全部字段，但接口、投影和审计必须能回答这些问题；不能回答时应明确标记为 `unknown`、`notApplicable` 或 `degraded`。

## 边界规则

- 客户端、agent、CLI、控制台和脚本只能提交 intent、文件、观察、proposal 或 artifact；不能直接改 canonical state。
- 外部服务只能提供原始数据、计算结果、持久化回执或 webhook 事件；不能成为 Pact 权限、恢复或审计事实源。
- 所有数据进入公共工作空间前，必须完成 source、digest、dataClass、workspace scope、policyRefs 和初始 state 登记。
- 所有数据离开 Pact 前，必须经过权限、出口、风险、审计和 receipt 记录。
- 所有读请求也会改变治理状态，因为它会产生 access receipt、loan record、usage event、denied request 或 context exposure。
- 所有外部写入必须有 provider durable id 或明确失败原因；没有持久化证明时只能是 staged、queued、failed 或 contractVerified。
- 所有 projection 都必须能追溯到 canonical state；不能从 projection 反向授予权限或执行恢复。

## 与现有核心文档的关系

- `Architecture.md` 继续描述总体公共状态模型和模块边界。
- `WORKSPACE-ASSET-GOVERNANCE.md` 继续描述 workspace asset 的治理流程、贡献、排行、恢复和验收场景。
- `KNOWLEDGE-GOVERNANCE.md` 继续描述知识、Evidence Pack、证据回读、授权覆盖和上下文编译。
- `U-1-Data.md` 只收敛这些文档中的数据对象、资源对象、状态对象和证据对象的统一命名与边界规则。
