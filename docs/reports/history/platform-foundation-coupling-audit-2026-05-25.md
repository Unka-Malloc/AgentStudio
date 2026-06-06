# Pact 平台基础能力低耦合高内聚审计

> 历史归档标注：本文保留为 2026-05-25 的审计证据，不再作为当前架构事实源。当前分层、Operation Scheduling Kernel、统一账本、审批流和前端边界以核心文档、决策登记和 verifier 为准。

审计日期：2026-05-25
范围：`docs/Architecture.md`、`docs/PROTOCOLS.md`、`server/platform/common`、`server/platform/interactive`、`server/platform/specialized`

## 架构师结论

Pact 当前不是“架构方向错误”，而是“骨架正确，职责还没有完全收口”。统一 Operation Registry、统一 authorization engine、Tool Management runtime、MCP 五语义入口和 composition root 是正确主线；基础层不应反向依赖业务层，业务能力必须通过 operation、provider、mount contract 或明确注入接口接入。

本轮已把 `server/platform/common` 到 `server/platform/specialized` 的真实 static/dynamic import 清到 0，并新增 `server:verify:platform-boundaries` 门禁保持 allowlist 为空。`common/console` 也已从直接持有大量业务 runtime，转为通过 `operationId + input + context` 交给 specialized console operation executor 或专用 executor。

架构评级：**基本符合低耦合高内聚原则，但 `common/console` 的组合根和 HTTP adapter 仍需继续拆薄**。

## 基础能力分项判断

| 基础能力 | 当前判断 | 合格边界 | 剩余风险 | 后续约束 |
| --- | --- | --- | --- | --- |
| 安全 + 权限管理 | 基本符合 | `server/platform/common/security` 统一认证、CSRF、subject resolution、authorization decision、grant/token 裁决、toolset maxRisk 约束和 denied audit。 | 业务模块仍可能绕过 authorization engine 直查权限或把高风险 operation 放入低风险 toolset。 | 权限层只暴露裁决和审计接口；业务策略作为数据输入，不能写死在安全层。 |
| 模块管理 | 基本符合 | `server/platform/common/module-manager` 只识别 mount contract、module descriptor、provider interface 和 capability package 生命周期。 | 把具体 knowledge/OCR/vector 逻辑写回 module-manager 会重新造成基础层了解业务实现。 | 具体 mount provider 必须由 composition root 或 specialized provider 注入。 |
| 算法 + 数据结构 | 基本符合 | `server/platform/common/data-structure` 保持纯数据结构、序列化、diff/merge/checkpoint 和文本规范化等无副作用工具。 | 引入 HTTP、UI 状态或业务 runtime 会污染算法层。 | 业务含义由上层通过 operation input、event 和 metadata 传入。 |
| 存储 | 基本符合 | `server/platform/common/storage` 负责 SQLite migration、raw object、metadata repository、backup/restore 和 storage doctor。 | storage 反向承担知识检索、agent workspace 或 Tool Management 业务逻辑会形成硬耦合。 | storage 保存 normalized metadata，不负责知识规则演进；知识域服务由 specialized provider 注入。 |
| 运维 | 基本符合 | `server/platform/common/devops` 聚焦 process status、monitor alerts、unified registration 和只读运行状态。 | 运维层如果直接修复业务状态，会绕过 operation、authorization 和 audit。 | 运维只做观测、告警、注册和 runbook 调度；业务变更必须走 operation。 |

## 已清除的旧口径

1. MCP 公开面已收敛为五个语义入口：`pact.discovery`、`pact.knowledge`、`pact.sharedspace`、`pact.codespace`、`pact.skillHub`。`pact.workspace`、`pact.list`、`pact.skill`、`pact.help` 不再作为 v0.0.1 alias 口径。
2. `/api/workspaces/:workspaceId/...` 不再作为当前 Workspace API 口径；文档应使用 `/api/agent-workspaces` 或协议 facade `/api/workspace/*`。
3. `workspace.file.upload`、`knowledge.search` 等名称是内部 operation id，不是 MCP tool name。
4. `contract_registered` 只能表示接口合同已登记，不能等同于 production-ready。能力报告必须区分 `registered`、`wired`、`implemented`、`verified`。
5. `common -> specialized` 迁移例外不再保留常态 allowlist；如未来确有短期桥接，必须登记 owner、原因、退出条件和到期日。

## 本轮已经收口的实现边界

- `system-controller.mjs` 不再直接 import specialized capability，也不再直接调用 knowledge、agent、capability package、code review、data connector、benchmark、background process、checkpoint tree、monitor alert、job manager、console auth、maintenance agent、operation audit store、event bus、Tool Management router、runtime mount、Agent Gateway 或 storage repair/backup 的业务方法。
- `system-controller-contexts.mjs` 集中负责 domain provider 解析、authorization engine/store 装配、审计日志封装，以及 knowledge、Agent Gateway、authorization context 组装。
- `system-controller-auth-handlers.mjs` 承接 auth session、login/logout、users、OIDC、audit、sessions 和 revoke session。
- `system-controller-foundation-handlers.mjs` 承接 authorization facade、Tool Management grant facade、workspace file protocol facade、workspace contribution、AgentLibrary access、workspace skill 和 workspace asset permission。
- `system-controller-runtime-handlers.mjs` 承接 system interfaces、events/agent-sync、discovery、runtime info/path/mounts/console state 和 maintenance agent。
- `system-controller-agent-settings-handlers.mjs` 承接 settings、model probe、Agent Gateway、agent registry 和 model routing。
- `system-controller-workspace-protocol-handlers.mjs` 承接 workspace audit/history、checkpoint facade、workspace code change facade、raw corpus format convert、knowledge dossier export 和 knowledge distillation export。
- `system-controller-knowledge-operations-handlers.mjs` 承接 email rules、expert vocabulary、knowledge taxonomy、corpus significant terms、document parse、word-cloud、word-bag、storage summary/doctor/reconcile/backup 和 affair taxonomy。
- `system-controller-ops-observation-handlers.mjs` 承接 failed jobs review、background processes、checkpoint tree observation 和 monitor alerts。
- `system-controller-capability-ecosystem-handlers.mjs` 承接 capability package、Codex OAuth、production health、executive report、architecture live map、sample business pack、module ecosystem、workspace governance、Gerrit/repo、asset lineage、data connector governance 和 performance capacity。
- `system-controller-workspace-runtime-handlers.mjs` 承接 context profiles、context preview/compaction/session memory/build records/evaluation、client runtime allocation/bootstrap/status、agent workspace、agent sessions、workspace inheritance、locks 和 workspace file runtime。
- `system-controller-knowledge-runtime-handlers.mjs` 承接 knowledge console/source/config schema/capabilities/export/health/maintenance/review/learning/golden rules/distillation/workbench/skills/evaluation/evolution/summarization/exploration/search/graph。
- `system-controller.mjs` 当前只保留 handler family composition 和 shared request/response helper，不再直接实现任何 `async handle*` 方法。
- `http-server.mjs` 发布启动期 `system.interfaces.snapshot`、`discovery.config.snapshot`、`agent_sync.config.snapshot`、`system.console_state.snapshot` 和 `storage.summary.snapshot` 时已改为通过 `dispatchInternalOperation(...)` 进入 Operation Dispatcher，不再直接调用 `buildConsoleState()`、`loadAgentSyncConfig()`、`metadataStore.getStorageSummary()` 或手工拼装接口/发现/存储快照。
- `agent-configs` 启动 refresh 已从 `http-server.mjs` 迁入 `composition-root.mjs`，服务入口不再直接 import specialized agent config registry。
- agent memory、context runtime 和 Agent Gateway 调用适配已从 `http-server.mjs` 迁入 `server-runtime-providers.mjs`，服务入口不再直接 import `agent-memory`、`agent-context` 或 `agent-gateway` specialized 模块。
- Tool Management runtime 创建已从 `http-server.mjs` 直连 specialized `tool-management-core` 迁入 `server-runtime-providers.mjs` 的 `createServerToolManagementPlatform(...)` helper，服务入口不再直接 import `tool-management-core/index.mjs`。
- checkpoint upload session 协议实现已从 `common/console` 直连迁入 `console-domain-services.mjs` 的 `uploadSessionStore` provider，`jobs-controller.mjs` 和 `system-controller-contexts.mjs` 不再直接 import `protocols/checkpoint/upload-session-store.mjs`。
- Tool Management MCP grant 到客户端连接列表的投影已从 `api-facade.mjs` 迁入 `tool-management-client-connections.mjs`，`common/console` 不再直接读取 `toolManagementPlatform.store.listGrants()` 或拼装 MCP grant metadata。
- Knowledge console summary 投影已从 `api-facade.mjs` 迁入 `knowledge-console-summary.mjs`，`common/console` 不再直接访问 `runtime.mounts.knowledgeBase` 或调用 knowledgeBase health/capabilities/maintenance。
- Runtime console summary 投影已从 `api-facade.mjs` 迁入 `runtime-console-summary.mjs`，`common/console` 不再直接读取 `runtime.runtimeOptions`、枚举 `runtime.mounts` 或拼装 mount config/capability summary。

## 主要剩余问题

### 1. `common/console` 仍是最大聚合点

虽然直接业务调用已经迁出，`common/console` 仍同时承担 HTTP route adapter、handler family composition、request normalization、console state 聚合和 provider context 分发。它已不再是业务实现层，`system-controller.mjs` 也已不再直接实现 `async handle*`，启动期系统/发现/同步/控制台/存储快照也已走内部 operation dispatch，但组合根和 shared adapter helper 仍偏宽。

目标形态：

```text
http-server
  -> operation-dispatcher
  -> thin controller adapter
  -> specialized capability provider
```

下一步应把 route mapping、handler family composition 和 shared request/response normalization 继续收薄，避免 `common/console` 再演化成横跨所有能力域的事实控制器。

### 2. 基础层合同测试还不够独立

安全、模块、数据结构、存储和运维的边界已经写进 `docs/Architecture.md`，但还需要每个基础能力都有最小合同测试，证明它们可以在不加载 specialized runtime 的情况下初始化和执行核心协议。

### 3. operation 完成度需要分级治理

部分 operation 已注册并接入 facade，但后端仍可能是 `contract_registered`。后续报告不能只看 operation 是否存在，而要按 `registered -> wired -> implemented -> verified` 分级。

## 建议执行顺序

### P0：文档和门禁口径

- 以 `docs/Architecture.md` 的“基础能力内聚和解耦合同”为唯一架构口径。
- 所有 MCP 文档只写五个语义入口；内部 operation id 只称为 operation。
- 所有 Workspace API 文档使用 `/api/agent-workspaces` 或 `/api/workspace/*`。
- 保持 `server:verify:platform-boundaries` allowlist 为空。

### P1：继续拆实现层

1. 保持 `system-controller.mjs` 无 `async handle*` 实现；新增 console operation 必须先进入对应 handler family，或新增专用 handler family。
2. 保持 `common/storage` 只提供 repository/migration/raw object/backup contract，不追加 knowledge specialized direct import。
3. 保持 `common/module-manager` 只加载 provider contract，不追加具体业务 mount direct import。
4. 保持 authorization engine 为唯一权限裁决入口，Tool Management catalog/toolset 只通过 scopes、risk 和 policy 数据表达策略。

### P2：能力完成度

1. 分批把 `contract_registered` operation 绑定真实后端。
2. 在生产能力报告中展示 `registered/wired/implemented/verified` 四级状态。
3. 为五类基础能力补最小 contract tests。

## 本轮验证记录

- `npm run server:verify:architecture-patterns` 已通过。
- `npm run server:verify:platform-boundaries` 已通过，输出 `0 tracked common-to-specialized migration imports`。
- `npm run server:verify:module-ecosystem` 已通过。
- `npm run server:verify:capability-package-lifecycle` 已通过。
- `npm run server:verify:production-health-console` 已通过。
- `npm run server:verify:sample-business-pack` 已通过。
- `npm run server:verify:workspace-governance` 已通过。
- `npm run server:verify:asset-lineage` 已通过。
- `npm run server:verify:data-connector-governance` 已通过。
- `npm run server:verify:performance-capacity` 已通过。
- `npm run server:verify:gerrit-mcp` 已通过，输出 `gerrit-mcp verification passed (MCP dry-run matrix + live Gerrit 3.14.0)`。
- `npm run server:verify:protocol-operations` 已通过，输出 `protocol operation registration verification passed (50 protocol operations)`。
- `npm run server:verify:agent-workspace` 已通过。
- `npm run server:verify:agent-session-governance` 已通过。
- `npm run server:verify:agent-memory` 已通过。
- `npm run server:verify:context-runtime` 已通过。
- `npm run server:verify:client-runtime-allocator` 已通过。
- `npm run server:verify:client-runtime-bootstrap` 已通过。
- `npm run server:verify:context-compaction` 已通过。
- `npm run server:verify:agent-workspace-file-upload` 已通过。
- `npm run server:verify:monitor-alerts` 已通过。
- `npm run server:verify:ops` 已通过。
- `npm run server:verify:checkpoints` 已通过。
- `npm run server:verify:business-scenarios` 已通过，输出 `Business scenarios passed: 9/9`。
- `npm run server:verify` 已完整通过。
