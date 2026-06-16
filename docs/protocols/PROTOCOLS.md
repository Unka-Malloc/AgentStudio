# Pact Protocols

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Pact protocol surfaces, grouped by server and client.
- Staleness check: Checked against `SERVER_API_OPERATIONS`, `server/protocols/`, `client-cli/src`, Tool Management routes, upload routes, mobile relay routes, and ACP Relay module manifest on 2026-06-16.

## 服务端

### 协议入口规则

服务端协议事实源是 `server/platform/common/operation-dispatcher/operation-registry.mjs` 与 `server/protocols/`。HTTP、RPC、MCP、Tool Management、控制台和维护智能体必须进入注册式 operation 或显式 protocol facade。旧式未注册的横向 API 文档不再作为协议事实源。

### 三个兼容层

任何 adapter、connector、mount、compatibility component 或 runtime bridge 都必须归入以下三层之一：`agent-client-mcp-compatibility`、`external-service-compatibility`、`pact-internal-compatibility`。Tool Management、Policy、Operation Ledger、Checkpoint Tree 和 audit 是跨三层的治理面。外部服务 adapter 不放在 Protocol Adapters 下统一描述，而是按 ServiceHub、External Services 和 capability manifest 归档。

### 核心协议族

| 协议族 | 入口 | 说明 |
| --- | --- | --- |
| System / Console | `/api/healthz`, `/api/bootstrap`, `/api/interfaces`, `/api/console/state`, `/api/settings`, `/api/runtime/*` | 服务健康、启动信息、接口注册表、控制台聚合状态、运行时依赖、mount 和设置。 |
| Upload Session / Jobs | `/api/upload-sessions`, `/api/jobs`, `/api/jobs/:jobId/result`, `/api/jobs/:jobId/normalized-documents` | 分块上传、断点续传、任务创建、任务状态、结果和归一化文档读取。 |
| Pub/Sub Events | `/api/events` | 服务端事件流，支持 cursor、topic、timeout 和 snapshot。 |
| Knowledge | `/api/knowledge/*`, `/api/search`, `knowledge.*` operations | 知识源、检索、证据、资产、规则、维护、导出、演化、Playbook/Skill alias 和检索智能体。 |
| Workspace / Sharedspace | `/api/workspace/*`, `/api/agent-workspaces/*`, `/api/sharedspace/*` | 工作空间文件、贡献、资产、权限、checkpoint、proposal、local dir sync、context bundle 和共享空间。 |
| Tool Management v1 | `/api/tool-management/v1/*` | catalog、toolsets、profiles、policy、execute、dry-run、batch、grants、audit、metrics 和 events。 |
| MCP Server Side | `/mcp`, `/api/mcp`, `/.well-known/pact/mcp.json` | agent-to-Pact 工具调用入口；工具目录由 Tool Management 和 grant projection 裁决。 |
| ACP Agent Relay | `/api/agent-relay/v1/*` | Source agent 到 target agent 的受控 ACP delegation、virtual agents、targets、sessions、turns、permission bridge 和文件回调。 |
| Agent Workspace / Sessions | `/api/agent-workspaces/*`, `/api/agent-sessions/*` | 工作空间、会话、context、events、fork、compare、merge proposal、archive 和 workspace runtime。 |
| Client Runtime | `/api/client-runtime/*`, `/api/process-identity/*` | 客户端本机 runtime 分配、bootstrap、状态、process identity claim、rotate 和 revoke。 |
| Mobile Relay | `/api/mobile-relay/*` | 手机与 PC 客户端 pairing、check-in、命令队列、完成回执和结果读取。 |
| External Services | `/api/external-services/*`, `/api/external/*` | ServiceHub 注册模板、配置、验证、工具采纳、版本 promote/rollback、外部知识蒸馏、云盘等上游服务。 |
| Code / Repo | `/api/repo/*`, `/api/codespace/*`, `/api/gerrit/*` | 仓库读写、diff、change prepare/upload、review、Gerrit route 和 Codespace registry。 |
| Security / Authorization | `/api/auth/*`, `/api/authorization/*`, `/api/oauth/*` | 控制台认证、session、用户、角色、OIDC、审计、授权治理、grant 和 Codex OAuth。 |
| Storage / Operations | `/api/storage/*`, `/api/system/*`, `/api/observability/*`, `/api/production/*` | 存储摘要、doctor、reconcile、backup/restore、checkpoint tree、monitor alert、trace 和 production health。 |

### RPC 规则

`POST /api/rpc` 调用注册 operation。请求方必须提供 operation id 与参数；服务端按 operation metadata 执行 authorization、risk、audit、handler dispatch 和错误归一化。RPC 不能绕过 HTTP 同等权限边界。

### Tool Management 协议

Tool Management v1 是外部 agent 和维护工具调用 Pact 能力的稳定协议。调用方通过 catalog 或 toolset resolve 发现工具，通过 grant token、console auth 或 `x-pact-tool-token` 调用 `/execute`、`/dry-run`、`/batch`。grant plaintext 只在创建或轮换时返回，运行态只保存 hash。

MCP target identifiers cover OpenClaw, Claude Code, Codex, Antigravity, OpenCode, Copilot, Kilo Code, Cursor, and Hermes Agent. 兼容口径以 `docs/COMPATIBILITY.md` 为准。

### ACP Relay 协议

ACP Relay 协议把 Pact 表现为 source-facing ACP agent，同时由 Pact 作为 outbound ACP client 或受控 CLI participant 调用目标。Relay 不是 raw socket proxy；每个 session、turn、target callback、permission request 和文件访问都必须经过 Relay policy、operation、Tool Management projection、audit 和 source-safe event projection。

### ServiceHub 协议

ServiceHub 只注册和调用已配置上游服务，不启动本机 stdio MCP 进程。raw MCP 只接受 HTTP/HTTPS endpoint；agent input 不能覆盖 URL、method、headers、Authorization、TLS、proxy 或 timeout。上游 tools/list 必须经 Tool Adoption Gate、risk recalculation、schema sanitization、candidate catalog 和 operator/admin promote 后才能进入下游可见目录。

## 客户端

### `pact-client` 命令协议

Rust sidecar 暴露以下命令族，GUI 和本机 agent 应优先通过这些命令使用本机能力：

| 命令族 | 说明 |
| --- | --- |
| `model profiles list|set` | 管理薄模型转发 profile。 |
| `state get|set` | 读写便携状态集合。 |
| `process-identity bootstrap claim|request sign|status` | 与本机服务端 runtime 建立进程身份并签名请求。 |
| `local-runtime ensure|build|start|restart|stop|status|logs` | 构建、启动、停止和检查 client-local 服务端 runtime。 |
| `conversations list|append|delete` | 只读扫描 native agent history；append/delete 返回拒绝。 |
| `agent message send` | 通过目标 runtime adapter 发送一次白名单消息。 |
| `agents pair request|approve|revoke|list` | Skill Hub 目标配对。 |
| `skill list|get|visibility set|pin set` | 被动 Skill Hub 读、可见性和版本 pin。 |
| `mobile relay ...` | 手机 pairing、PC check-in、命令 poll/sync/complete/create/result。 |
| `mcp plugin status|update|rollback` | Pact MCP 作为 peer plugin 的状态、更新和回滚。 |
| `mcp config plan|apply|rollback` | 目标智能体 MCP 配置计划、应用和快照回滚。 |

### 客户端 HTTP 使用

Flutter GUI 只应调用服务端公开 API 或 sidecar 命令，不应直接写服务端运行态数据。移动中继 HTTP 调用属于 `pact-client mobile relay` 实现细节，GUI 展示命令结果。

### 协议版本规则

服务端 artifact 和协议使用 Governed Version String：`v<platform-version>:<domain>:<subsection>-<version>`。客户端 Flutter `pubspec.yaml` 当前应用版本为 `1.0.0+1`，Rust sidecar 随客户端包交付。服务端 package version 当前为 `0.0.1`。
