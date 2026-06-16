# Pact State Machines

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Pact state machines and state-machine documentation.
- Staleness check: Checked against `server/platform/common/state-machine/definitions/`, `server/scripts/acp-agent-relay-state-machine-spec.mjs`, `server/scripts/verify-state-machines.mjs`, and ACP Relay verification scripts on 2026-06-16.

## 服务端状态机

服务端状态机事实源位于 `server/platform/common/state-machine/definitions/`。所有定义必须能通过 `npm run server:verify:state-machines`，并由状态机 verifier 检查状态、事件、终态、非法迁移和完整性。

| 状态机 | 版本 | 状态 | 说明 |
| --- | --- | --- | --- |
| `operation.narrow` | `v0.0.1:state-machine:operation-narrow-1` | `received`, `normalized`, `policy_checked`, `policy_denied`, `ledger_started`, `executing`, `checkpoint_recorded`, `audit_recorded`, `completed`, `failed` | 单次受控 operation 的窄生命周期。 |
| `contribution.lifecycle` | `v0.0.1:state-machine:contribution-lifecycle-1` | `submitted`, `preview`, `scanned`, `needs_changes`, `reviewed`, `published`, `adopted`, `deprecated`, `rejected`, `revoked` | 工作空间贡献生命周期。 |
| `checkpoint.restore` | `v0.0.1:state-machine:checkpoint-restore-1` | `restore_requested`, `restore_preview_generated`, `approval_pending`, `approved`, `rejected`, `expired`, `restore_marker_recording`, `completed`, `failed` | checkpoint 恢复的 preview、审批、marker 和终态。 |
| `agentlibrary.loan` | `v0.0.1:state-machine:agentlibrary-loan-1` | `loan_requested`, `loan_active`, `renewal_requested`, `renewed`, `expired`, `revoked`, `returned` | AgentLibrary 借阅或受控引用授权。 |
| `production.readiness.lifecycle` | `v0.0.1:state-machine:production-readiness-lifecycle-1` | `not_started`, `collecting_evidence`, `running_checks`, `passed`, `failed`, `blocked`, `waiver_requested`, `waiver_approved`, `waiver_rejected`, `release_candidate` | 生产准入门禁生命周期。 |
| `version.artifact.lifecycle` | `v0.0.1:state-machine:version-artifact-1` | `draft`, `candidate`, `active`, `deprecated`, `retired` | 版本化 artifact 生命周期。 |
| `version.transition.lifecycle` | `v0.0.1:state-machine:version-transition-1` | `planned`, `dry_run_passed`, `checkpointed`, `running`, `verified`, `completed`, `failed`, `rolled_back`, `abandoned` | 版本迁移或切换生命周期。 |

## ACP Relay 状态机

ACP Relay 的组合状态由 `server/scripts/acp-agent-relay-state-machine-spec.mjs` 与 `server/platform/specialized/capabilities/agent-relay/acp-agent-relay/` 实现共同约束。该状态机不是单线性字段，而是以下域的组合：

`RelayState = (FrameState, SourceIdentityState, AuthorizationState, RouteState, SessionState, TurnState, CallbackPermissionState, VisibilityState)`。`accepted-only` 观察流在 `turn.observe` 上只能做 source-safe refresh；当目标最终响应后来可见时，状态证据进入 `final_refreshed`，不能回放 raw target transcript。

| 域 | 典型状态 |
| --- | --- |
| Frame | received, parsed, method_routed, rejected |
| Source identity | unbound, connection_bound, default_bound, ownership_matched |
| Authorization | pending, allowed, denied |
| Route | unresolved, virtual_agent_resolved, target_resolved, unsupported |
| Session | creating, active, resumable, closed, cancelled, failed |
| Turn | queued, target_waking, target_running, approval_pending, completed, accepted, target_error, cancelled |
| Callback / Permission | observed, unsupported_callback, approval_requested, approval_resolved |

ACP Relay 状态迁移必须满足以下约束：

- source agent 只能看 source-safe progress、completion、accepted、cancelled、target_error 或 permission 状态。
- target agent 的 raw command、env、token、CSRF、URL credential、private metadata 和内部 transcript 不进入 source-visible state。
- permission、filesystem 和 terminal 请求必须进入 Pact operation 和 permission bridge，不能直接透传。
- cancellation、resume、wake、observe 和 session close 都必须保留 audit / relay session 证据。
- `target_callback_parent_binding` 是目标 callback 绑定父 turn 的唯一入口；`target_callback_parent_ambiguous` 与 `target_callback_parent_not_found` 都是 fail-closed 分支，结果必须是 No relay side effect。
- source-facing `session/cancel` 可以取消 running delegated prompt；如果 target 之后才返回 late target completion，Relay 只记录被抑制的审计证据，不向 source 改写已取消状态。

## Work Queue 状态机

Pact Work Queue 是服务端调度原语，当前验证入口为 `npm run server:verify:work-queue` 与 `npm run server:verify:job-work-queue`。调度状态属于队列，不替代业务状态：

| 状态 | 含义 |
| --- | --- |
| `pending` | 可被 claim 或 dispatch。 |
| `delayed` | 等待延迟成熟后回到可调度状态。 |
| `leased` | 已被 worker 持有，必须通过 ack/nack/progress/lease expiry 继续。 |
| `dead_letter` | 调度层耗尽重试，业务对象未必失败。 |
| `fallback_review` | 自动 fallback 失败后的安全人工检查态。 |
| `acked` | 调度完成终态。 |
| `terminated` | 管理操作终止终态。 |

## 客户端状态机

客户端状态不使用服务端 state-machine verifier，但必须保持可恢复、可审计、可回滚：

| 状态对象 | 位置 | 规则 |
| --- | --- | --- |
| MCP config snapshot | `target-config-cache`, `future-client/snapshots` | apply 前创建快照，rollback 只能恢复 Pact-managed 区块。 |
| Skill visibility / pin | `future-client/skills`, `future-client/pins` | 配对通过后才可见；隐藏和 pin 写入 activity。 |
| Mobile relay pairing | `future-client/mobile-relay` | pairing、PC token、gateway config 和命令结果分开存储。 |
| Local runtime | `future-client/local-runtime` | `ensure/start/stop/status` 记录 pid、runtime config、claim 状态和日志路径。 |
| Process identity | 系统密钥后端或便携状态索引 | 私钥不进入普通 JSON；请求签名绑定 package 和 server URL。 |

## 变更规则

- 新增服务端状态机必须先添加 JSON 定义，再添加 verifier 或扩展现有 verifier。
- 任何状态机文档变更必须引用实现文件或 verifier，不得记录未实现的计划状态。
- 状态机历史过程说明不保留在 `docs/`；若某个状态机决策需要长期追溯，写入 `docs/adr/`。
