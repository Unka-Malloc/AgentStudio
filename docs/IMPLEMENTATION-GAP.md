# Pact Implementation Gap

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Gap between current implementation and documentation plan.
- Staleness check: Checked against module manifests, operation registry, package scripts, client packaging manifest, current compatibility docs, and version registry evidence references on 2026-06-16.

## 当前结论

本文只记录当前代码实现与文档规划之间的差异。已经删除的历史过程文档不再作为缺口事实源。

## 已收口事项

| 项 | 当前状态 |
| --- | --- |
| 文档布局 | 架构、功能、用法、设计、兼容、智能体引导、开发规范、版本、状态机、协议和实现差距已归拢到目标路径。 |
| 历史过程文档 | 旧 `docs/reports/`, `docs/scenarios/`, `docs/boundary/`, `docs/security/`, `docs/testing/` 等过程或横向文档已从当前 docs 事实源移除。 |
| 功能模块文档 | `docs/functionality/` 固定为 10 个模块文档，每个模块内部按功能项说明。 |
| 版本证据引用 | version registry 的 docs evidence refs 需指向新权威文档路径。 |

## 剩余实现差异

| 缺口 | 当前实现 | 文档要求 | 处理方式 |
| --- | --- | --- | --- |
| 当前无 | 当前关闭口径不再要求所有 canonical target 都具备 native ACP；native ACP 改为可选探测能力，有可验证 adapter/proof 时启用，没有时标记 unsupported/skip。 | 文档只声明当前实现能力，不把外部产品尚未提供的 native ACP 当作 Pact 缺口。 | 新缺口必须重新写入本表。 |

## 已关闭实现差异

| 项 | 关闭证据 |
| --- | --- |
| Source Queue / upload-queue alias | `client-cli/src/source_queue.rs` 提供 SQLite 队列、JSONL audit、pause/resume/retry/cancel/drain 和 `/api/upload-sessions` + `/api/jobs` 提交；`pact-client upload-queue` 是兼容别名。 |
| 客户端本地 connector host | `client-cli/src/connectors.rs` 提供 local directory、iCloud local projection、OneDrive local projection，并统一输出到 Source Queue。 |
| 客户端 Knowledge Cache mirror | `client-cli/src/knowledge_cache.rs` 提供授权 mirror SQLite/FTS；返回 `authoritative=false`，服务端 KnowledgeCore 仍是权威。 |
| macOS Mail Swift helper proof | `client-gui/macos/MailHelper/PactMailHelper.swift` 编译为 `pact-mail-helper`，`pact-client mail preview|enqueue` 通过显式 scope 调用 helper；真实 macOS Mail smoke 在 2026-06-16 验证授权、指定 mailbox/date/limit preview/export、`.eml` 与 `manifest.tsv` 导出、Source Queue handoff 和无 server URL 时 drain defer 均成功。 |
| MCP local bridge | `client-cli/src/mcp_local_bridge.rs` 只生成 client-local-runtime loopback HTTP bridge plan/register，不让 ServiceHub 直接托管 stdio。 |
| Cloud Drive 官方远端 adapter | `server/platform/specialized/agent/cloud-drive-port/index.mjs` 保留 local projection/contract/generic bridge，并新增 Google Drive REST v3、Dropbox HTTP API v2、OneDrive Microsoft Graph official remote-live adapter 分派。 |
| Work Queue 产品化管理面 | `jobs.work_queue.*` 管理操作已进 operation registry、HTTP controller、Tool Management catalog；JobManager 仍拥有业务状态。 |
| ServiceHub HTTP/HTTPS tools-only 边界 | external service registration、MCP HTTP 和 local stdio lockdown verifiers 约束 HTTP/HTTPS raw MCP 与禁止直接 stdio。 |
| ACP native support 全目标目标取消 | `server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs` 仍区分 native ACP、CLI fallback、Agent API proxy、contract mock；`server/scripts/verify-acp-agent-relay-real.mjs` 默认跳过 Antigravity ACP wrapper，只有显式 wrapper proof flag 才跑。Codex ACP target 可通过 `--codex-cli` 显式验证；Antigravity 当前保持 `agent_api_proxy`，`nativeAcpTargetVerified=false`。 |

## 维护规则

- 新增缺口必须说明实现位置、文档要求和处理方式。
- 缺口关闭后删除本表对应行，不能保留历史过程描述。
- 若缺口变成长期架构决策，写入 `docs/adr/` 并从本文移除。
