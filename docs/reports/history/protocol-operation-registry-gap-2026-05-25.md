# Protocol Operation Registry Gap Report

审计日期：2026-05-25

本报告跟踪 `pact.workspace-contribution.v1`、`pact.knowledge-access.v1`、`pact.code-review.v1` 以及相关 workspace/knowledge 协议操作的当前注册、接线和实现状态。统计口径来自：

- `server/platform/common/operation-dispatcher/protocol-operation-definitions.mjs`
- `server/platform/specialized/console/console-domain-operation-executor.mjs`
- `npm run server:verify:protocol-operations`
- `npm run server:verify:workspace-checkpoints`
- `npm run server:verify:knowledge-transformation`
- `npm run server:verify:v001-codespace-e2e`
- `npm run server:verify:v001-knowledge-e2e`
- `npm run server:verify:v001-cloud-drive-e2e`

## 总览

| 指标 | 当前值 | 说明 |
| --- | ---: | --- |
| 协议操作定义 | 76 | 全部追加进 `SERVER_API_OPERATIONS`。 |
| 已注册并可发现 | 76 | 已通过 HTTP/RPC/Tool Management/MCP 发现验证。 |
| 明确空后端 | 0 | 协议操作均已绑定执行器/provider 后端；不再存在 `contract_registered` 空实现。 |
| P0 旧“零实现”模块 | 0 | workspace contribution、knowledge access、code management 和 knowledge transformation 均已有执行器/provider 后端。 |

## 按子系统统计

| 子系统 | 操作数 | 空后端数 | 当前判断 |
| --- | ---: | ---: | --- |
| authorization | 7 | 0 | 已统一进入 authorization engine/store。 |
| workspace-contribution | 8 | 0 | 已接入 contribution registry，支持 submit/list/leaderboard/stats/report/permission grant。 |
| knowledge-access | 4 | 0 | 已接入 `evaluateKnowledgeAccess` 和 authorization store receipt/loan/denied list。 |
| knowledge-backend-port | 4 | 0 | v0.0.1 Dify/RAGFlow `KnowledgeBasePort` 已接入 backend connect、safe space list、export request 和 permission request；`knowledge.search` / `knowledge.evidence.get` 在 provider 输入下进入同一 port，外部凭据缺失时只标记 `contractVerified`。 |
| code-management | 16 | 0 | `workspace.code.*` 和 v0.0.1 `codespace.*` 均已接入 Codespace registry/provider，覆盖 target evaluation、RepositoryPort status/tree/file/diff、changeSet prepare、GitHub/Gerrit upload receipt、review target link、review action、status sync 与 fallback event；外部凭据缺失时明确标记 `contractVerified`。 |
| cloud-drive-port | 8 | 0 | v0.0.1 `CloudDrivePort` 已接入 iCloud / OneDrive local projection adapter 和 Google Drive / Dropbox contract adapters，覆盖 connect/status/list/download/upload/sync plan/sync apply/permission list；iCloud / OneDrive 受控目录可实读实写，OAuth provider 缺少真实凭据时只标记 `contractVerified`。 |
| workspace-file | 6 | 0 | upload/list/download/read/write/patch 已接入 agent workspace file backend。 |
| checkpoint | 7 | 0 | tree/node/diff/scope/restore preview/restore 已接入 checkpoint tree backend；operation revert scope 已接入 operation audit store。 |
| workspace-proposal | 2 | 0 | create/apply 已接入 agent workspace submission/decision 后端，proposal 必须先审核再形成 decision。 |
| knowledge-export/evidence | 3 | 0 | evidence get 已接线；dossier export 与 distillation export 已接入 `KnowledgeTransformation` provider，并统一写入 AgentLibrary access receipt/loan。 |
| raw-corpus | 1 | 0 | format convert 已接入 `KnowledgeTransformation` provider，支持 Markdown/HTML/JSON/DOCX/text portable export package。 |
| workspace-asset-policy | 2 | 0 | 已进入 authorization facade。 |
| workspace-audit | 2 | 0 | 已接入 operation audit store。 |
| workspace-skill | 4 | 0 | 已复用 contribution registry。 |

## 明确空后端清单

当前无明确空后端。`raw-corpus.format.convert`、`knowledge.dossier.export` 和 `knowledge.distillation.export` 已由 `pact.knowledge-transformation.v1` provider 执行；`knowledge.backend.connect`、`knowledge.space.list`、`knowledge.export.request` 和 `knowledge.permission.request` 已由 `pact.knowledge-backend-port.v1` provider 执行；`sharedspace.drive.*` 已由 `pact.cloud-drive-port.v1` provider 执行。MCP/HTTP/RPC 路径通过专项验证；Dify/RAGFlow/OneDrive/Google Drive/Dropbox 缺少真实凭据时只能计为 `contractVerified`。

Checkpoint 注意事项：`workspace.checkpoint.restore` 仍由通用 checkpoint tree 负责 restore marker、`checkpoint.restored` event 和审计范围记录；当 checkpoint node 携带 `workspaceFileSnapshot` 时，文件树 dry-run 和实际恢复会委托给共享空间 `restoreWorkspaceFiles` provider。其他业务状态回滚仍必须由各自 owning protocol 提供。

## P0 旧结论复核

| 模块 | 旧结论 | 当前结论 | 剩余风险 |
| --- | --- | --- | --- |
| `pact.workspace-contribution.v1` | 有协议、零实现 | 已有 operation registry、system handler、console domain executor 和 contribution registry 后端 | 仍需更完整的资产持久化、权限生命周期验证和 workspace 视角 E2E。 |
| `pact.knowledge-access.v1` | 有协议、零实现 | 已有 evaluate/receipt/loan/denied request 操作，并写入 authorization store；知识转化 export 已纳入同一 AgentLibrary 裁决链。 | 后续风险转为更复杂业务流的 E2E 覆盖，不再是协议后端缺口。 |
| `pact.code-review.v1` | 有协议、零实现 | 已有 Codespace registry/provider、`codespace.*` 语义入口、GitHub/Gerrit provider manifest 与 Gerrit upload route；target/prepare/link/status 不再是轻量 facade | 后续风险转为真实 GitHub/Gerrit 凭据、组织策略、更多 review provider 和权限迁移，不再是 P0 注册/后端缺口。 |
| `pact.knowledge-backend-port.v1` | Phase 3 未接入 | 已有 Dify/RAGFlow provider manifest、secretRef-only connect、safe discovery、contract search、evidence receipt/loan、denied audit、export gate 和 permission request。 | 后续风险转为真实 Dify/RAGFlow 凭据、上游 API 差异、真实 export 和更多权限 overlay 场景，不再是 v0.0.1 contract 后端缺口。 |
| `pact.cloud-drive-port.v1` | Phase 4 未接入 | 已有 CloudDrivePort、`sharedspace.drive.*` 语义入口、iCloud / OneDrive local projection adapter、OAuth provider secretRef-only contract-mode、transfer receipt、access receipt、checkpoint 和 operation audit。 | 后续风险转为真实 OneDrive/Google Drive/Dropbox OAuth、刷新 token、真实远端 upload/download/sync 和 provider ACL 差异，不再是 v0.0.1 local projection / contract 后端缺口。 |

## 下一步顺序

1. 安全权限迁移：console/auth/tool/workspace/codespace 权限统一进入 authorization engine / policy provider。
2. 接口封装层继续：`api-facade`、`jobs-controller` 和 MCP adapter 按 Checklist 横切任务拆分。
3. 策略管理补齐：定义 workflow-policy / agent-policy 协议入口、策略注册表、评估 provider 和审计输出。
4. 每补一个子系统，必须同步更新 `docs/reports/history/SUBSYSTEM-REFACTOR-CHECKLIST.md`，并增加或扩展 `server:verify:*` 覆盖。
