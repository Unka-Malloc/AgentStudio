# ACP Agent Relay Design

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: ACP Agent Relay Design.
- Staleness check: Scanned on 2026-06-14; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

**Status:** Phase 1 governed relay implementation under verification  
**Scope:** Design plus HTTP and Tool Management source-facing ACP Relay operations, governed outbound ACP stdio target communication, downstream MCP/ACP agent framework adapter assembly, unified Relay participant target assembly, native OpenCode ACP stdio target assembly, and Antigravity Agent API/Connect verification paths. Native third-party ACP transports beyond stdio remain contract-mode until verified.
**Decision record:** [ADR 0001 - Govern Agent-to-Agent ACP Delegation Through Pact](./adr/0001-govern-agent-to-agent-acp-delegation-through-pact.md)

## Purpose

Pact needs a governed way for one local or remote agent to delegate work to another ACP-capable agent through the platform. The source agent talks to Pact through ACP, and Pact talks to the target agent through ACP. The platform must not become a raw socket proxy. It must remain the policy, operation, audit, and context broker between the source agent and the target agent.

This design introduces an `ACP Agent Relay` module. It lets Pact accept an inbound ACP session from a source agent, open or reuse an outbound ACP session with a target agent, forward a bounded prompt turn, collect target `session/update` events, and return normalized ACP progress and completion updates to the source agent.

## Protocol Facts

ACP is a client-agent protocol for editor or client applications talking to coding agents. Its v1 flow is JSON-RPC based:

- The client initializes the connection with `initialize`.
- The client creates or restores a session with `session/new`, `session/load`, or `session/resume`.
- The client sends user input with `session/prompt`.
- The agent streams progress through `session/update`.
- The agent may request client-side permission, filesystem, or terminal operations.
- The prompt turn ends when `session/prompt` returns a stop reason.

References:

- [ACP introduction](https://agentclientprotocol.com/get-started/introduction)
- [ACP v1 overview](https://agentclientprotocol.com/protocol/v1/overview)
- [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP v1 prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP v1 transports](https://agentclientprotocol.com/protocol/v1/transports)

## Boundary Decision

Pact now has a real downstream client aspect boundary for facing local and remote agent frameworks. All client-facing MCP and ACP adapter logic belongs to this aspect. The aspect has two independent protocol adapter layers:

- MCP layer: agent-to-Pact compatibility. It helps Codex, Claude Code, Antigravity, Kilo Code, and other supported clients discover, configure, and call Pact MCP tools. It does not push tasks to MCP clients.
- ACP layer: agent-to-agent delegation through Pact. It adapts ACP-capable agents or ACP adapters such as `codex-acp` and OpenCode's `opencode acp` stdio server into target and virtual-agent descriptors for the ACP Relay.

The MCP layer and ACP layer are assembled independently when the downstream client aspect starts. A framework can have MCP support only, ACP support only, both, or neither. The aspect publishes client discovery config, capability catalog projection, bootstrap manifest inputs, startup status, secretRef projection metadata, and framework-specific adapter metadata. It does not execute platform work. It translates inbound MCP or ACP requests into route intents and sends them to the platform service boundary. MCP requests go to MCP Server Side / Tool Management, and ACP requests go to ACP Agent Relay. ACP Relay and MCP Server Side are both platform communication service capabilities; they are not owned by the downstream client aspect. All execution still goes through Tool Management, the operation dispatcher, security permissions, ACP Relay, MCP Server Side, and global audit. The aspect is not a raw socket proxy and is not a second permission system.

The relay is a separate platform capability. Pact has two ACP roles:

- Inbound role: Pact acts as an ACP agent to the source agent.
- Outbound role: Pact acts as an ACP client to the target agent.

The canonical flow is:

```text
source ACP agent
  -> downstream client aspect ACP layer
  -> Pact inbound ACP facade
  -> Operation Scheduling Kernel
  -> Capability / Authorization Kernel
  -> ACP Agent Relay runtime
  -> target ACP agent via outbound ACP client
```

The target agent is always treated as an external capability boundary. Its tool calls, file requests, terminal requests, and permission requests are not trusted merely because they arrive through ACP.

## Canonical Terms

| Term | Meaning |
| --- | --- |
| Source agent | The ACP-capable agent asking Pact to delegate a prompt to another agent. |
| Virtual inbound agent | A source-visible ACP agent projection published by Pact. It binds a target agent, profile, capability descriptor, data-source envelope, and relay policy. |
| Target agent | The ACP-capable agent that receives `session/prompt` from Pact. |
| Downstream client aspect | The only client-facing aspect for agent frameworks. It owns MCP/ACP adapter layers, framework catalog, client interaction/config/bootstrap projection, secretRef projection metadata, and protocol-to-platform route translation. Pact-owned clients may use bidirectional interaction; MCP/ACP adapters only accept agent requests and translate them into route intents. |
| MCP framework adapter layer | Downstream client aspect layer that adapts agent clients to Pact MCP discovery, installation, profile, and Tool Management boundaries. |
| ACP framework adapter layer | Downstream client aspect layer that adapts ACP-capable frameworks or ACP adapter packages into relay target/source capability descriptors. |
| Inbound ACP facade | Pact's ACP-agent surface exposed to source agents. |
| Outbound ACP client | Pact's ACP-client connection to a target agent. |
| Relay session | Pact-owned durable session mapping between the source agent, workspace, virtual inbound agent, inbound ACP session id, and last known or resumable target session reference. |
| Relay turn | One governed prompt turn inside a relay session. It maps to one `session/prompt` request. |
| Delegation grant | Effective permission envelope computed from source agent grant, target profile, workspace policy, data policy, and relay policy. |

## Non-Goals

- Do not make MCP itself push tasks to downstream MCP clients.
- Do not let one agent get another agent's raw token, local filesystem access, or terminal access.
- Do not forward ACP byte streams blindly.
- Do not skip the inbound ACP facade in favor of a first-release MCP-only source-facing surface.
- Do not store raw agent transcripts in the Git checkout.
- Do not bypass Tool Management, Capability Kernel, Operation Scheduling Kernel, or `/approval`.
- Do not treat Antigravity `chat` CLI as production ACP unless it exposes a real ACP transport.

## Module Placement

Recommended modules:

```text
server/platform/common/downstream-client-aspect/
  index.mjs
  module.json

server/platform/specialized/capabilities/agent-relay/acp-agent-relay/
  index.mjs
  acp-inbound-facade.mjs
  acp-virtual-agent-registry.mjs
  acp-client-connection.mjs
  acp-session-driver.mjs
  acp-permission-bridge.mjs
  acp-event-normalizer.mjs
  acp-relay-router.mjs
  acp-target-registry.mjs
```

Common protocol-only helpers may live under:

```text
server/platform/common/protocols/acp/
```

That common package may contain JSON-RPC framing, schema normalization, and stable protocol constants only. It must not import specialized runtimes, storage, Agent Gateway, Tool Management internals, or provider adapters.

Console HTTP handlers must not call this runtime directly. They submit `operationId + input + context` through `console-domain-operation-executor.mjs` or a dedicated specialized operation executor, following the existing controller split.

## Components

| Component | Responsibility |
| --- | --- |
| `DownstreamClientAspectService` | Starts the downstream client aspect, iterates every configured framework, assembles MCP and ACP adapter layer records one by one, and translates inbound client protocol requests into platform route intents. |
| `McpAgentFrameworkAdapterLayer` | Produces MCP-specific descriptors for supported client frameworks: profile id, install/config strategy, command probe, locations, and Tool Management boundary. |
| `AcpAgentFrameworkAdapterLayer` | Produces ACP-specific descriptors for supported ACP adapters: transport, adapter package, modes, modalities, target registry descriptor, virtual agent descriptor, and reasoning visibility policy. |
| `AcpInboundFacade` | Presents Pact as multiple virtual ACP agents to source agents and maps inbound `initialize`, `session/new`, `session/prompt`, `session/cancel`, and client callbacks into relay operations. |
| `AcpVirtualAgentRegistry` | Builds and publishes source-visible virtual agents from concrete targets, profiles, data-source grants, modality support, mode support, and workspace visibility policy. |
| `AcpRelayRouter` | Resolves the selected virtual inbound agent to the target agent, target session policy, context policy, and delegation grant for each inbound ACP turn. |
| `AcpTargetRegistry` | Reads concrete ACP target transports from external service config, agent client target registry, or operator-managed provider manifests. |
| `AcpClientConnection` | Owns one outbound ACP transport connection to a target agent. Stdio is the first supported transport; HTTP/WebSocket remain contract-mode until live support is implemented. |
| `AgentCliExecConnection` | Runs a local managed CLI participant when a target is explicitly registered for governed CLI execution, including degraded fallback targets and canonical targets without a verified native ACP adapter. It returns normalized completion evidence and must stay under Relay operation, capability, and audit controls. |
| `AcpSessionDriver` | Runs outbound `initialize`, `session/new`, `session/resume`, `session/prompt`, `session/cancel`, and optional `session/close` based on advertised target capabilities. |
| `AcpPermissionBridge` | Converts target agent permission, filesystem, and terminal requests into Pact operations. |
| `AcpEventNormalizer` | Converts target ACP `session/update`, tool status, plan updates, reasoning traces, stop reasons, and errors into Pact relay events, operation receipts, and source-facing ACP updates according to the per-turn visibility policy. |
| `RelaySessionStore` | Stores relay sessions, target session ids, operation ids, idempotency keys, state, and references to globally managed transcript/audit artifacts. It must not own retention policy. |
| `RelayOperationExecutor` | Accepts platform operations and invokes the relay runtime after operation and authorization checks. |

## Downstream Client Aspect Assembly

The downstream client aspect owns the first-pass framework catalog and adapter assembly. The catalog includes the fixed first-class agent client support targets: OpenClaw, Claude Code, Codex, Antigravity, OpenCode, Copilot, Kilo Code, Cursor, and Hermes Agent.

Each framework record can declare independent `mcp` and `acp` sections:

```json
{
  "frameworkId": "codex",
  "label": "Codex",
  "kind": "cli",
  "commandNames": ["codex"],
  "mcp": {
    "adapterId": "codex-mcp-cli",
    "profileId": "pact.mcp.codex",
    "installMode": "codex-release-plugin-and-mcp-cli",
    "configurationStrategy": "cli-mcp-command"
  },
  "acp": {
    "adapterId": "codex-acp-stdio",
    "profileId": "pact.acp.codex",
    "transport": "stdio",
    "commandNames": ["codex-acp"],
    "npxPackage": "@zed-industries/codex-acp",
    "configurationStrategy": "codex-acp-adapter",
    "advertisedModes": ["ask", "agent"],
    "advertisedTools": ["codex.session", "codex.patch"],
    "reasoningVisibilityPolicy": "never"
  }
}
```

Startup assembly rules:

1. The aspect service iterates frameworks in canonical target order.
2. For each framework it assembles the MCP layer and ACP layer separately.
3. MCP records describe client compatibility and install/config strategy; they do not create ACP targets.
4. ACP records describe Relay participant targets and virtual agents. Every canonical framework receives an ACP-layer record, but the concrete target may be enabled, disabled pending installation, installable, or missing from the host. Public capability records omit command env, tokens, CSRF values, URLs with credentials, and private metadata. Internal target registry descriptors keep launch details needed to start the target.
5. Existing ACP is the first path. The aspect checks canonical native ACP commands, official ACP adapters, and operator-approved ACP Registry manifests before any non-ACP fallback. Missing ACP adapters are recorded as `installable`, `missing_dependency`, or `unavailable` instead of being silently skipped. For Codex, bare `codex` is not treated as native ACP; the project-pinned `@zed-industries/codex-acp` dev dependency, a local `codex-acp`, or `npx @zed-industries/codex-acp` is the ACP adapter path. For OpenCode, bare `opencode` is the native ACP command only when Pact launches it with static args `["acp"]`, matching the documented `opencode acp` stdio server. Startup command discovery searches `PATH` first and then the project-local `node_modules/.bin` so a checked-out Pact workspace can launch pinned adapters without relying on global installs or transient `npx` downloads.
6. Operator-approved ACP Registry manifests are accepted as ACP definitions, not as Pact-specific wrappers. The downstream aspect supports local or injected registry JSON with `binary`, `npx`, and `uvx` distributions. It converts the selected distribution into a standard stdio ACP target and preserves private launch env only in the internal target registry. Pact does not fetch the public registry over the network at startup by default.
7. Targets without any discoverable ACP command, adapter, or registry distribution can still be represented as managed CLI Relay participants through `agent-cli-exec`. This is not a raw command bridge and must never replace a usable ACP route: the target carries a read-only capability policy (`writes=deny`, `terminal=deny`, `maxRisk=read_only`), redacted public metadata, normalized completion evidence, `nativeAcpTargetSupported=false`, and the same ACP Relay / Operation Scheduling / Tool Management audit boundary as a native target. The target remains disabled when no safe non-interactive command is known or operator supplied.
8. If a framework declares a `fallback` and the primary ACP adapter is not assembled, the aspect may probe the fallback CLI command and emit a `degraded` ACP relay target. CLI fallback never upgrades an ordinary CLI into native ACP. Source-facing evidence must report `codex_cli_exec_fallback` or `agent_cli_exec_fallback` and `nativeAcpTargetSupported=false`. If neither the primary ACP adapter nor the fallback CLI command is available, the target remains disabled as `installable` or `missing_dependency`.
9. `createAcpAgentRelayRuntimeServices()` starts the downstream client aspect by default and registers ACP descriptors into the shared target and virtual-agent registries before route resolution begins. Embedders may pass `downstreamClientAspect: false` for isolated tests or pass an existing `downstreamClientAspectService` when the platform has already started the aspect.

Unified Relay participant model:

- The canonical targets are OpenClaw, Claude Code, Codex, Antigravity, OpenCode, Copilot, Kilo Code, Cursor, and Hermes Agent. Each is assembled as an MCP client compatibility record and an ACP/Relay participant record. MCP remains the agent-to-Pact tool access path; ACP Relay is the agent-to-agent delegation path.
- The aspect may also import non-canonical operator-approved ACP Registry agents. These imports become `registryImported=true` ACP stdio targets and do not change the canonical support target list.
- Codex uses `codex-acp` as the native ACP stdio adapter when available. If the native adapter is unavailable and `codex` is discoverable, Pact may emit the governed read-only `codex-cli-exec` fallback target.
- OpenCode uses target `opencode.acp:default` and virtual agent `opencode.acp-agent`. The transport is stdio with `protocolStyle=agent-client-protocol-v1`, command name `opencode`, static args `["acp"]`, profile `pact.acp.opencode`, adapter id `opencode-acp-stdio`, and configuration strategy `opencode-native-acp-stdio`. If `opencode` is not discoverable, Pact emits `missing_dependency` / `acp_adapter_command_not_found` and leaves the target disabled.
- Antigravity uses the Agent API proxy or Pact-owned Agent API ACP wrapper path. It is a Relay participant, but source-facing metadata must keep `nativeAntigravityAcp=false` until an official Antigravity ACP transport is verified.
- OpenClaw, Copilot, Kilo Code, Cursor, and Hermes Agent use their native ACP stdio command shapes when the corresponding command is discoverable: `openclaw acp`, `copilot --acp`, `kilo acp`, `cursor agent acp`, and `hermes acp`.
- Claude Code uses the `claude-code-acp` stdio adapter and exposes `@zed-industries/claude-code-acp` as its installable adapter path when the command is absent.
- Public target and virtual-agent descriptors expose only safe metadata such as `relayParticipant`, communication classification, enabled state, disabled reason, and native support flags. Internal target registry descriptors retain launch commands and private environment only for target startup.

Generic local CLI fallback invocation contract:

- Source clients should not invent Relay request bodies from memory. They can request server-authored templates through `GET /api/agent-relay/v1/templates` or `GET /api/agent-relay/v1/templates/:templateId`. The same operation is exposed as `acp_agent_relay.templates.list` / `pact.agentRelay.templates.list` and requires `agent_relay:view`.
- MCP clients discover this capability through `initialize._meta.capabilityFamilies.agentRelay`, `tools/list._meta.capabilityFamilies.agentRelay`, and `pact.discovery({ operation: "pact.capabilities.list" })`. The concrete Relay operations are called through the dedicated `pact.agentRelay` outlet, separate from SkillHub and ServiceHub.
- The caller sends source identity, source grant, workspace, virtual agent, idempotency, and relay metadata to Pact through the Relay operation input or authenticated transport context.
- Pact strips those fields for its own authorization, session routing, audit, and policy work. They are not appended to the target CLI prompt, argv, stdin, environment, or config unless the operator explicitly configures a non-secret CLI argument.
- The target CLI is invoked exactly according to the registered command descriptor: `transport.command.executable`, static `args`, optional `promptArgs`, and one prompt delivery mode. `promptDelivery=argument` appends the task text as the final argument after `args` and `promptArgs`; `promptDelivery=stdin` writes only the task text to stdin; `promptDelivery=none` sends no prompt body.
- Pact passes a minimal process environment for generic fallback targets and captures stdout/stderr as completion evidence. Secret-bearing source tokens, source MCP config, relay child grants, CSRF values, and Pact internal launch metadata stay inside Pact.
- Because an unknown local CLI may perform its own filesystem or network side effects, a generic fallback target must remain degraded/read-only unless the operator supplies an enforceable sandbox or a target-specific adapter that can map tool and permission requests back through Pact.

Inbound routing rules:

1. The aspect accepts client-facing MCP and ACP protocol requests only at the adapter boundary.
2. It normalizes protocol, framework, profile, method, request metadata, and client identity into a route intent.
3. MCP route intents target MCP Server Side / Tool Management and carry no ACP relay execution authority.
4. ACP route intents target ACP Agent Relay and carry no direct Tool Management execution authority except through relay-scoped projection.
5. Unknown protocols fail closed before reaching platform services.
6. The aspect never calls ACP Relay, MCP Server Side, workspace runtime, storage, or external targets directly. Those services execute only after their own operation, security, policy, and audit gates.

External source basis checked on 2026-06-06:

- ACP official docs describe ACP as a protocol for standardizing communication between code editors/IDEs and coding agents, with local agents commonly communicating over JSON-RPC on stdio. Pact's ACP layer follows that boundary and does not treat ordinary chat CLIs as ACP unless they expose a clean JSON-RPC ACP transport.
- `zed-industries/codex-acp` describes itself as an ACP adapter around the Codex CLI and documents both release installation and `npx @zed-industries/codex-acp`. Pact pins this package so `codex-acp` can be launched deterministically during verifier runs.
- OpenAI Codex public manual documents MCP and `codex mcp-server`, but the current local `codex --help` / `codex exec --help` output does not expose a bare Codex ACP source/client mode. Pact therefore distinguishes Codex CLI participation from native bare-Codex ACP source proof.
- Current local Antigravity official CLI surfaces expose MCP configuration and plugin management, but no ACP stdio/stream command. Pact therefore keeps the direct Antigravity Agent API target as `agent_api_proxy` until a verified official ACP adapter or native transport appears. The Pact-owned Antigravity Agent API ACP wrapper is a separate proof path: Pact talks ACP stdio to the wrapper, and the wrapper talks Agent API to Antigravity; it must not be labeled native Antigravity ACP.
- OpenCode official documentation checked on 2026-06-13 documents ACP support and the `opencode acp` command as an ACP stdio server. Pact therefore treats `opencode acp` as the maintained native OpenCode ACP target path, distinct from generic CLI fallback.

The current implementation exports this as `v0.0.1:agent:downstream-client-aspect-1` from:

```text
server/platform/common/downstream-client-aspect/
```

## Data Model

Suggested runtime tables or equivalent durable records:

| Record | Key fields |
| --- | --- |
| `acp_relay_targets` | `targetId`, `label`, `transport`, `command` or `url`, `agentProfileId`, `enabled`, `capabilityPolicy`, `externalServiceId`, `lastHandshakeAt` |
| `acp_relay_virtual_agents` | `virtualAgentId`, `targetId`, `profileId`, `displayName`, `description`, `advertisedModes`, `defaultMode`, `advertisedModalities`, `advertisedDataSources`, `advertisedTools`, `visibilityPolicy`, `reasoningVisibilityPolicy`, `capabilityPolicy`, `enabled`, `revision` |
| `acp_relay_sources` | `sourceId`, `label`, `transport`, `agentProfileId`, `enabled`, `capabilityPolicy`, `lastHandshakeAt` |
| `acp_relay_sessions` | `relaySessionId`, `sourceId`, `sourceSessionId`, `virtualAgentId`, `targetId`, `targetSessionId`, `sourceSubjectId`, `workspaceId`, `cwd`, `lifecycleState`, `wakePolicy`, `targetResumeRef`, `relayMcpGrantId`, `policyRevision`, `lastWokenAt`, `createdAt`, `updatedAt`, `lastOperationId` |
| `acp_relay_turns` | `relayTurnId`, `relaySessionId`, `operationId`, `promptFingerprint`, `effectiveMode`, `progressVisibility`, `reasoningVisibility`, `status`, `stopReason`, `startedAt`, `completedAt`, `idempotencyKey` |
| `acp_relay_events` | `eventId`, `relayTurnId`, `type`, `sequence`, `redactedPayload`, `globalAuditId`, `artifactRef`, `source`, `operationId`, `createdAt` |
| `acp_relay_permission_requests` | `requestId`, `relayTurnId`, `targetToolCallId`, `requestedAction`, `risk`, `status`, `pendingOperationId`, `decisionId` |

Raw prompt text and transcript bodies must be governed by existing global audit, workspace governance, and artifact lifecycle mechanisms. ACP relay may keep redacted projections and references, but it must not define a private transcript retention policy or write raw bodies into repository paths.

## Operations

New operations should be registered before any runtime code executes:

| Operation | Risk | Notes |
| --- | --- | --- |
| `acp_agent_relay.virtual_agents.list` | `read_only` | List source-visible virtual ACP agents after policy filtering. |
| `acp_agent_relay.targets.list` | `read_only` | Operator-facing concrete target list; not the primary source-agent catalog. |
| `acp_agent_relay.sessions.list` | `read_only` | Read relay session summaries for source/operator observability without child-agent reasoning. |
| `acp_agent_relay.sessions.get` | `read_only` | Read one relay session plus sanitized turn summaries after ownership and policy filtering. |
| `acp_agent_relay.turns.list` | `read_only` | Read sanitized turn summaries for one relay session. |
| `acp_agent_relay.turn.observe` | `read_only` | Refresh a completed or accepted-only relay turn from target-side observation when the target adapter exposes safe local observation. It updates target evidence and `communicationSummary` without re-sending the prompt or exposing raw transcripts/reasoning. |
| `acp_agent_relay.virtual_agent.initialize` | `safe_write` | Register or validate an inbound ACP source connection to a selected virtual agent. |
| `acp_agent_relay.session.create` | `safe_write` | Create a durable Pact relay session and source ACP session mapping. Target session creation may be deferred until first prompt. |
| `acp_agent_relay.session.resume` | `safe_write` | Resume a source-facing persistent relay session and re-evaluate current policy. |
| `acp_agent_relay.session.wake` | `safe_write` | Lazy-start, reconnect, resume, or rehydrate the concrete target session for a persistent relay session. |
| `acp_agent_relay.prompt.send` | `repair_write` by default | Send a governed prompt turn to a target agent. Risk may downgrade to `read_only` for read-only ask mode. |
| `acp_agent_relay.fs.read_text_file` | `read_only` | Source-facing, operation-guarded workspace text read used by ACP callback/tool projections. |
| `acp_agent_relay.fs.write_text_file` | `repair_write` | Source-facing, approval-gated workspace text write used by ACP callback/tool projections. |
| `acp_agent_relay.session.cancel` | `safe_write` | Map to `session/cancel`, write cancellation receipt. |
| `acp_agent_relay.session.close` | `safe_write` | Map to `session/close` when supported; otherwise local cleanup only. |
| `acp_agent_relay.permission.resolve` | internal | Resolve target ACP permission requests through the security and operation kernels. |

Tool Management can expose these as a new toolset:

```text
pact.agent.relay
  pact.agentRelay.virtualAgents.list
  pact.agentRelay.targets.list
  pact.agentRelay.sessions.list
  pact.agentRelay.sessions.get
  pact.agentRelay.turns.list
  pact.agentRelay.turn.observe
  pact.agentRelay.virtualAgent.initialize
  pact.agentRelay.session.create
  pact.agentRelay.session.resume
  pact.agentRelay.session.wake
  pact.agentRelay.prompt
  pact.agentRelay.fs.readTextFile
  pact.agentRelay.fs.writeTextFile
  pact.agentRelay.cancel
  pact.agentRelay.session.close
```

The toolset is a compatibility projection for existing MCP callers. The primary source-agent path is inbound ACP. Neither projection owns relay execution or bypasses operation scheduling.

## Operation Kernel Integration

Every relay session and turn is an operation-governed workflow:

1. Source agent selects one Pact-published virtual inbound ACP agent and runs `initialize`.
2. Pact validates the selected `virtualAgentId`, source identity, and virtual agent visibility.
3. Source agent creates or resumes a persistent source-facing ACP session bound to the virtual agent.
4. Source agent sends `session/prompt` to Pact.
5. Operation Scheduling Kernel accepts or rejects the relay turn and writes the initial ledger event.
6. Capability Kernel evaluates the source agent, workspace, virtual agent, concrete target, prompt mode, requested context, and max risk.
7. If high risk or policy requires human review, the operation becomes `pending_operation` and appears in `/approval`.
8. Only after accepted or approved state may the relay runtime wake, open, or reuse outbound ACP transport.
9. Each outbound ACP prompt turn uses the parent `operationId`.
10. Each target-originated permission, filesystem, or terminal request becomes a child operation with the same trace.
11. Final stop reason, normalized output, target receipt, and errors are written to Operation Ledger.
12. Pact returns source-facing ACP `session/update` events and prompt completion result.

Minimum ledger event sequence:

```text
source_initialize_received
source_session_created|source_session_resumed
accepted
policy_evaluated
session_wake_requested*
target_handshake_started
target_handshake_completed
target_session_created|target_session_resumed|target_session_rehydrated
prompt_turn_started
session_update_received*
target_permission_requested*
child_operation_started*
child_operation_completed*
prompt_turn_completed|prompt_turn_failed|prompt_turn_cancelled
source_completion_emitted
receipt_recorded
```

The relay must fail closed if the ledger cannot be written before an external side effect.

The complete source-to-Pact-to-target transition model is defined in [ACP Agent Relay State Machine](./ACP-AGENT-RELAY-STATE-MACHINE.md). That document is the contract for JSON-RPC frame handling, source identity binding, operation guard, routing, session lifecycle, prompt turns, target callbacks, approval suspension and resume, cancellation, closure, and source-facing observability.

## Session Persistence and Wake

Relay sessions are durable by default. A source agent can return later to the same source-facing ACP session and ask Pact to continue the conversation with the selected virtual inbound agent.

Persistence is owned by Pact, not by the concrete target. The target process does not need to stay running. When a persistent relay session is used again, Pact runs a wake sequence:

1. Load the `acp_relay_sessions` record by `sourceId`, `sourceSessionId`, `virtualAgentId`, and `workspaceId`.
2. Re-evaluate source visibility, virtual agent policy, target enablement, workspace policy, data-source policy, and operation risk.
3. If the concrete target is already connected and reports reusable health, reuse the target session.
4. If the target advertises native ACP resume/load support and Pact has a valid `targetResumeRef`, reconnect and resume or load the target session according to the target's advertised session capabilities.
5. If the target cannot resume natively, create a new target session and rehydrate it with a Pact-authored context envelope allowed by the current policy.
6. If rehydration is disallowed or impossible, keep the relay session dormant and return a machine-readable wake failure to the source agent.

The Pact-owned relay session remains valid even when the target is stopped, unavailable, upgraded, or restarted. Durable relay state must include enough metadata to decide whether wake is allowed, but it must not preserve stale authority. Every wake and every prompt turn recalculates effective permission from current grants and policy revisions.

Cached outbound connections are reusable only when the connection and its transport both remain healthy. Targets may expose this through a connection-level `isReusable()` check; stdio ACP targets also fail reuse when the child transport has closed even if the connection object has not yet observed the close event. An unreusable cached connection is discarded before wake, and Pact reconnects using the persisted target resume reference instead of discovering the failure halfway through the next prompt.

Recommended lifecycle states:

| State | Meaning |
| --- | --- |
| `active` | Source session is open and target session is connected or immediately reusable. |
| `dormant` | Pact retains durable session state, but no target process or transport is currently active. |
| `waking` | Pact is reconnecting, resuming, or rehydrating the target session. |
| `blocked` | Wake is prevented by target unavailability, revoked policy, missing data source, or another route-time policy gate that cannot be suspended as a pending approval. |
| `approval_pending` | A relay turn is suspended while a source or platform approval is pending. The target is not woken for relay-side pending writes, and target callback writes resume only after approval. |
| `closed` | Session was explicitly closed and cannot be resumed without a new source session. |

`session.close` closes the source-facing relay session and is terminal for new wake, resume, cancel, and prompt operations on that relay session. For native ACP targets that advertise `close` or `session/close`, Pact first sends target `session/close` and records the target response, then closes and removes the corresponding target connection so stdio child processes are not reused after the source declared the session closed. Targets that do not advertise close support are cleaned up locally. It should not be used for ordinary target process suspension. Idle target processes may be stopped by runtime policy while the Pact relay session remains `dormant`.

`session.cancel` is not terminal. It maps to target `session/cancel` for in-flight work, records the relay session as `dormant`, and keeps the target connection available for later wake or prompt unless runtime policy independently closes idle targets.

A source-facing `relaySessionId` is an identifier, not a bearer secret. Any source ACP method that accepts a direct `sessionId` or `relaySessionId` must also prove the session belongs to the current `sourceId`, `workspaceId`, `sourceSessionId`, and `virtualAgentId` context. Source identity comes from the authenticated transport or per-connection context first; request body identity fields are only a compatibility fallback when no trusted context exists and must not override an already established source connection identity. A shared source JSON-RPC service may serve multiple transports concurrently, but each transport has an independent connection context and identity memory; source identity must not be stored as global mutable state for all connections. Foreign sessions are reported as not found, including `session/load`, `session/resume`, `session/prompt`, `session/cancel`, `session/close`, and `session/request_permission`. A direct session id that fails this ownership check must fail closed rather than falling back to an unrelated mapped source session. The same ownership filter applies in the operation executor so REST and Tool Management projections share the invariant.

The source guard is connected to the platform Authentication Management path. The trusted chain is: credential or login proof, identity verification, authentication aspect, character and permission binding, ACP source identity normalization, and then operation authorization. `AcpSourceJsonRpcBridge` normalizes platform `authSession`, `grant`, `profile`, `authorizationSubject`, and authentication-context source identity into an internal `sourceAuthContext` before request-body fields are considered. Request-body `sourceId`, `workspaceId`, `sourceSubjectId`, or `virtualAgentId` cannot override that trusted binding. Tool Management execution adds the same invariant at the runtime boundary: grant-bound source metadata from `__pactToolRuntimeAuthorization` is overlaid before session create/load/prompt/close dispatch, so a caller cannot spoof source/session ownership through `/api/tool-management/v1/execute`. The source-facing `sourceIdentity` projection remains public and route-safe; the internal `sourceAuthContext` can carry `authSessionId`, `grantId`, `credentialRef`, effective source scopes, and capabilities for `AcpSourceOperationGuard`, but not raw tokens, CSRF values, command env, or credential material. Credential Distribution is therefore an input to the binding only through references and grants, not through bearer secrets parsed by the relay.

## Permission Kernel Integration

The effective permission for the target agent is the intersection of:

1. Source agent or user subject grant.
2. Virtual inbound agent visibility and capability policy.
3. Target agent profile grant.
4. Workspace allowlist.
5. Data class allowlist.
6. Egress allowlist.
7. Relay target policy.
8. Operation risk policy.
9. ACP capability negotiation result.

The target agent cannot receive a broader filesystem, terminal, MCP, or tool capability than the source agent could exercise through Pact.

ACP client capabilities should be advertised conservatively:

| ACP client capability | Default | Policy |
| --- | --- | --- |
| `fs.readTextFile` | false for untrusted targets | Enable only through workspace-scoped child operations. |
| `fs.writeTextFile` | approval-required when the virtual agent allows writes | Enable only through operation-governed repository file writes, path ACL, and `/approval`. |
| `terminal` | false in Phase 1 | Do not advertise or bridge terminal capability in Phase 1. Future support requires a separate explicit policy decision. |
| MCP servers | scoped | Pass only a Pact-provided MCP proxy with the delegation grant, not raw user MCP config. |

When the target calls `session/request_permission`, Pact resolves it with the security kernel. Human approval can satisfy confirmation requirements, but it cannot override hard denies such as tenant mismatch, workspace mismatch, data class denial, egress denial, disabled target, or revoked grant.

## Request and Response Flow

### Source-to-Target Delegated Prompt

```text
source ACP agent
  -> selected Pact virtual inbound ACP agent initialize
  -> Pact source-facing ACP session/new|session/resume bound to virtualAgentId
  -> Pact inbound ACP session/prompt
  -> Operation Scheduling Kernel
  -> Capability Kernel
  -> Pact session wake
  -> outbound ACP initialize/session/new|session/resume|rehydrate as needed
  -> outbound ACP session/prompt to target agent
  <- target ACP session/update events
  <- target ACP stopReason
  -> source-facing ACP session/update events
  -> source-facing ACP prompt completion
```

### Target Permission Request

```text
target ACP agent
  -> session/request_permission
  -> AcpPermissionBridge
  -> Operation Scheduling Kernel child operation
  -> Capability Kernel
  -> optional /approval
  -> ACP permission response
```

### Target Filesystem Request

```text
target fs/read_text_file
  -> AcpPermissionBridge
  -> workspace file read operation
  -> data policy and path ACL
  -> redacted response or denial
```

Write requests follow the same pattern but require a write-capable virtual agent, workspace path ACL, operation ledger receipt, and `/approval` by default. Terminal requests are denied in Phase 1.

## Terminal Policy in Phase 1

Phase 1 does not allow target agents to invoke terminal operations through Pact.

Denied Phase 1 terminal behavior:

- Advertising terminal capability to target ACP agents.
- Bridging target terminal requests into local shell operations.
- Compatibility-mode terminal execution through a non-ACP CLI wrapper.
- Terminal-mediated file writes, package installs, tests, build commands, or repository mutations.
- Human approval that overrides the Phase 1 terminal deny.

If a target requests terminal access in Phase 1, Pact must deny the request, record the denial as a child operation or relay event, and continue or stop the target turn according to ACP stop semantics.

## Repository File Writes in Phase 1

Phase 1 allows cross-agent repository file modification through Pact-mediated file write operations.

Allowed Phase 1 write behavior:

- The selected virtual inbound agent must advertise write capability and set `capabilityPolicy.writes` to `approval_required` or stricter.
- The target may request file writes only through ACP client callbacks mediated by `AcpPermissionBridge`.
- Every write becomes a child operation under the parent relay turn.
- Every write records path, intent, before digest when available, after digest, source session, virtual agent, target, and approval decision.
- `/approval` is required by default before the write is committed to the workspace.
- The source-facing result includes write receipts instead of unstructured claims that files were changed.

Denied Phase 1 write behavior:

- Direct target filesystem access outside Pact callbacks.
- Writes outside the active workspace or outside the virtual agent path allowlist.
- Writes from read-only virtual agents such as `antigravity.repo-analysis`.
- Terminal-mediated writes.
- Silent write retries that change content after approval was granted for a different payload.

## Source-Facing Interfaces

The first release must include an inbound ACP facade that publishes multiple virtual ACP agents. Those virtual agents are the product surface for one agent calling another agent through Pact.

Each virtual inbound agent must expose a stable name and capability descriptor. The descriptor should include:

- Supported prompt modes, such as `ask`, `edit`, or `agent`.
- Default prompt mode for prompts that do not explicitly request a mode.
- Supported input and output modalities, such as text, image, screenshot, audio, or document.
- Visible data-source classes, such as workspace files, local Pact knowledge base, remote knowledge base, mail archive, or issue tracker.
- Tool and MCP visibility class, expressed as capabilities rather than raw credentials.
- Default risk level, write policy, terminal policy, and approval requirements.
- Target health and capability receipt revision.

The implemented source-facing projection uses a safe `capabilitiesSnapshot` shape for this descriptor. It is returned by `initialize`, the ACP extension method `agent/list`, `session/new`, and `session/prompt.targetEvidence`. The snapshot includes the virtual agent id, target id, profile, display metadata, advertised modes/modalities/data sources/tools, effective tools and policy envelope, final-response policy, and a minimal target summary (`targetId`, label, external service id, transport type, enabled). The target summary also carries source-safe communication classification fields: `protocolStyle`, `targetCommunicationMode`, `nativeAcpTargetSupported`, `nativeAcpTargetVerified`, `nativeAcpSourceSupported`, `nativeAcpSourceVerified`, and a compact `communication` object with the same values. Discovery can therefore distinguish native ACP stdio targets from Codex CLI exec proxies, Antigravity Agent API proxies, and contract mocks before a prompt is delegated. `supported` is static advertised capability; source-facing discovery does not accept registry or target-descriptor self-assertions for `verified`, and proof-specific summaries are the place where a verifier may report `nativeAcpTargetVerified: true`. The projection deliberately omits raw target transport configuration such as command argv, binary paths, URLs, CSRF tokens, environment variables, and connector credentials.

Compatibility and operator surfaces may still exist, but they are secondary:

- MCP tool projection for existing connected agents that do not yet support ACP-client mode.
- HTTP/RPC operation API for console, automation, and verifier setup.
- Console UI for target management, relay session audit, source session audit, and approval.

The inbound ACP facade must submit every source `session/prompt` to Operation Scheduling Kernel before doing target relay work. It must not directly call target ACP transports.

A concrete target may publish more than one virtual inbound agent. For example, the same Antigravity ACP target can be projected as a read-only repo analysis agent, a multimodal document inspection agent, and a full coding agent if each profile has a distinct capability descriptor and policy envelope.

## Mode Selection

There is no concrete-target-wide default mode. Mode defaults belong to virtual inbound agents.

For each prompt turn, Pact resolves the effective mode in this order:

1. Use the source-requested mode if it is included in the selected virtual agent's `advertisedModes`.
2. Otherwise use the selected virtual agent's `defaultMode`.
3. Reject the prompt if neither the requested mode nor the default mode is currently allowed by the virtual agent policy, source grant, target capability receipt, and operation risk policy.

The selected mode does not bypass write, terminal, data-source, or MCP policy. A virtual agent may default to `agent` while still requiring `/approval` for writes and denying terminal in Phase 1.

## Source-Visible Event Policy

Source agents receive progress by default, not target reasoning traces.

Default source-visible progress includes:

- Plan summaries.
- Step and tool status.
- Permission request status.
- File, terminal, MCP, and data-source access receipts.
- Errors, denials, stop reasons, and final answer.

Target reasoning traces are allowed, but they are request-gated:

1. The selected virtual inbound agent must allow reasoning trace access through `reasoningVisibilityPolicy`.
2. The source agent must explicitly request reasoning trace visibility for the session or prompt turn through Pact relay metadata.
3. The Operation Scheduling Kernel and Capability Kernel must approve the request for the current source, workspace, virtual agent, data envelope, and risk level.
4. `AcpEventNormalizer` must deliver reasoning traces on a separate source-facing event channel. It must not merge them into the default progress stream or synthesized prompt context.

This keeps the main source-agent context clean. Sub-agent reasoning can be inspected when actively requested, but the default relay path avoids contaminating the source agent's working context with low-signal intermediate thoughts that may increase hallucination or misjudgment risk.

Pact should not invent hidden reasoning. It can only relay target-provided reasoning trace events when the target emits them, the virtual agent policy permits them, and the source explicitly asks for them.

## Transcript Retention and Global Governance

ACP relay must use global Pact retention, audit, redaction, and artifact lifecycle mechanisms. It must not create a separate transcript-retention subsystem.

Default retention behavior:

- Operation and relay facts are recorded through Operation Ledger and the existing operation audit path.
- Redacted progress events, denials, receipts, and policy decisions are available through trace drill-down and audit export.
- Raw prompt text, raw response text, raw reasoning traces, screenshots, documents, and multimodal payloads are not retained by default.
- When raw retention is explicitly enabled for a workspace, retained bodies are stored as globally governed runtime artifacts or asset records with `dataClass`, workspace scope, retention policy, and legal hold metadata.
- ACP relay tables store only redacted projections plus `operationId`, `traceId`, `globalAuditId`, `artifactRef`, hashes, and receipts.

Required global integrations:

- `v0.0.1:platform:audit-retention-1` / `auth.audit.retention.get|set|prune` owns audit retention windows and pruning.
- `v0.0.1:platform:audit-export-1` owns redacted audit export.
- `observability.trace.get` owns trace drill-down over operation/audit spans.
- `v0.0.1:workspace:governance-1` owns workspace `dataClass`, `retention`, and `legalHold` decisions.
- Global artifact or asset lifecycle storage owns any opt-in raw transcript artifacts.

ACP relay must not introduce:

- A relay-local raw transcript table.
- A relay-local retention config file.
- A relay-specific transcript export endpoint that bypasses global redaction/export.
- A relay-specific prune job that ignores workspace governance or legal hold.
- Raw transcript files inside the Git checkout.

If a source agent requests reasoning traces or raw transcript replay, Pact must evaluate the request through the same global retention and workspace governance mechanisms before returning an artifact or trace reference.

## Target and Virtual Agent Registration

Concrete targets should be registered through external service governance. Source-facing virtual agents should be derived from the target plus profile-specific capability descriptors:

```json
{
  "schemaVersion": "v0.0.1:schema:definition-1",
  "kind": "pact.external-service.config",
  "serviceId": "antigravity-acp",
  "serviceName": "agent.antigravity.acp",
  "displayName": "Antigravity ACP",
  "mode": "connected",
  "startupPolicy": "external-only",
  "upstream": {
    "type": "acp",
    "transport": "stdio",
    "command": {
      "executable": "/path/to/antigravity-acp",
      "args": []
    },
    "timeoutMs": 120000,
    "metadata": {
      "agentProfileId": "pact.acp.antigravity"
    }
  },
  "binding": {
    "mode": "passthrough",
    "outlet": "pact.agentRelay",
    "requiredScopes": ["agent_relay:prompt"],
    "risk": "repair_write"
  },
  "virtualAgents": [
    {
      "virtualAgentId": "antigravity.repo-analysis",
      "displayName": "Antigravity Repo Analysis",
      "profileId": "pact.acp.antigravity.repo_analysis",
      "advertisedModes": ["ask"],
      "defaultMode": "ask",
      "advertisedModalities": ["text"],
      "advertisedDataSources": ["workspace.files", "pact.knowledge.local"],
      "advertisedTools": ["pact.agentLibrary.search", "fs.readTextFile"],
      "reasoningVisibilityPolicy": "requestable",
      "capabilityPolicy": {
        "writes": "deny",
        "terminal": "deny",
        "maxRisk": "read_only"
      }
    },
    {
      "virtualAgentId": "antigravity.multimodal-coding",
      "displayName": "Antigravity Multimodal Coding",
      "profileId": "pact.acp.antigravity.multimodal_coding",
      "advertisedModes": ["ask", "edit", "agent"],
      "defaultMode": "agent",
      "advertisedModalities": ["text", "image", "screenshot", "document"],
      "advertisedDataSources": ["workspace.files", "pact.knowledge.local", "pact.document.runtime"],
      "advertisedTools": ["pact.agentLibrary.search", "fs.readTextFile", "fs.writeTextFile"],
      "reasoningVisibilityPolicy": "requestable",
      "capabilityPolicy": {
        "writes": "approval_required",
        "terminal": "deny",
        "maxRisk": "repair_write"
      }
    }
  ]
}
```

The current local Antigravity IDE CLI verified on 2026-06-04 is version `1.107.0`. It exposes `antigravity-ide chat`, but no documented native ACP stdio or stream command. That is not enough to mark it as native ACP. Native ACP requires a transport where stdout contains only ACP JSON-RPC messages and stdin accepts only ACP JSON-RPC messages. If Antigravity provides a hidden or future ACP command, the target config should reference that command instead of the chat command.

## MCP Handling Inside ACP

ACP allows clients to provide MCP server configuration to the target agent. For Pact relay, the target must not receive the source agent's raw MCP configuration. Pact should pass a relay-scoped Pact MCP endpoint with a delegation grant:

```text
target ACP agent
  -> relay-scoped Pact MCP proxy
  -> Tool Management runtime
  -> Capability Kernel
  -> Operation Scheduling Kernel
```

This keeps MCP tool discovery and tool calls subject to the same grant and audit rules as direct MCP clients.

Relay-scoped MCP rules:

- Pact mints a relay delegation grant for the target turn or session. The grant is distinct from the source agent token.
- Tool Management compiles the target-visible catalog from the intersection of source grant, virtual agent policy, workspace policy, data class policy, egress policy, target profile, operation risk, and current policy revision.
- The target sees only the scoped Pact MCP proxy. It must not receive source MCP server definitions, source bearer tokens, local MCP stdio commands, or upstream provider credentials.
- Every target MCP tool call is a child operation under the relay turn and carries `relaySessionId`, `relayTurnId`, `virtualAgentId`, `targetId`, `relayMcpGrantId`, `operationId`, and `traceId`.
- Policy changes, grant revocation, virtual agent disablement, or workspace/data-source changes must invalidate the target-visible tool catalog.
- If the target is connected through MCP, Pact must emit the appropriate catalog refresh signal, such as MCP `list_changed`, or force a target wake/reconnect when the transport cannot refresh safely.
- Relay-scoped grants must expire no later than the relay turn/session policy permits and must be revoked when the relay session is closed.

Current minimum implementation:

- Tool/Skill Management exposes `createRelayMcpGrant()` and `revokeRelayMcpGrant()` as the common relay-child authorization adapter. The adapter requires a verified source Tool Management grant, intersects requested relay scopes/toolsets/capabilities with the source grant, records source/relay/target metadata, and issues a normal Tool Management bearer token. It does not accept or copy source MCP bearer tokens. If a requested durable grant id already exists, the adapter only reuses it when the existing grant is a Pact ACP relay child grant for the same relay session, same source grant, and same target binding; otherwise it rejects with `relay_mcp_grant_id_collision` instead of upserting another owner's grant.
- `RelayOperationExecutor` calls that adapter before target wake/prompt when a Tool/Skill provider and verified source authorization are present. The durable relay session stores only a platform-generated `relayMcpGrantId` plus non-secret metadata (`tokenPersisted: false`); source request bodies cannot choose this durable child-grant id. The child bearer token is held only in the current in-memory wake/prompt parameters.
- Relay MCP child grants use an explicit short-lived expiry policy. The default TTL is 15 minutes, the maximum TTL is 1 hour, and the final expiry is capped by the verified source grant expiry when one exists. Reissued child bearers keep the same durable `relayMcpGrantId` but receive a fresh non-persisted token under the current expiry policy.
- `AcpClientConnection` projects a target-visible `relayMcp` object plus `mcpServers.pact` on target `initialize` and `session/prompt`. The projection carries the relay session id, target id, relay MCP grant id, Pact MCP URL, `relay-managed` authorization metadata, refresh semantics, and the relay child bearer token in `mcpServers.pact.headers.Authorization`. It does not pass source MCP server definitions, source tokens, local MCP stdio commands, target launch secrets, or upstream provider credentials.
- The relay MCP projection also carries a turn-scoped `childOperation` envelope and matching MCP HTTP headers for `relaySessionId`, `relayTurnId`, `virtualAgentId`, `targetId`, `relayMcpGrantId`, `traceId`, and parent relay operation id. Tool Management records each target MCP tool call under the normal `tool_executions` audit row with `resultSummary.relayChildOperation`; canonical session/turn/target/grant binding is read from the relay child grant metadata. Target-supplied header/envelope values are consistency evidence only; any mismatch is rejected before tool execution with `relay_child_operation_binding_mismatch`.
- `AcpSessionDriver` passes `relayMcpGrantId` and the non-persisted `relayMcpToken` from the prepared relay session into target wake and prompt calls, records the grant id on the cached target connection, and exposes `invalidateRelayMcpGrant()` so a revoked or rotated relay grant can force the next target wake to rebuild the connection.
- When the target connection is lost while the relay session persists, the next wake/prompt uses the durable `relayMcpGrantId` to reissue a fresh child bearer token through Tool Management. The old child bearer becomes invalid, the new bearer is projected only to the rebuilt target connection, and the durable relay session still stores only the grant id plus `tokenPersisted: false`.
- Closing a relay session calls the common provider revoke path for the relay MCP child grant when one was issued.
- The opaque capability kernel preserves already-loaded valid grant bindings across consecutive Tool Management mutations by merging hot state with the persisted sealed state before writing. Invalid records still win during merge. This prevents a stale secure-store read from dropping the verified source grant while the relay issues the target child grant.
- Tool Management store mutations emit best-effort change events for grant create/update/delete/revoke/token rotation and catalog snapshot changes.
- Tool Management platform maps those change events to MCP `notifications/tools/list_changed` through the shared HTTP MCP adapter. Grant-scoped changes target the matching active SSE connection; catalog refreshes broadcast to all active MCP SSE clients.
- The same Tool Management change is also published on `tool_management.mcp_catalog_changed` when a protocol event bus is present. Tool Management platform also exposes a general change-handler registry; the HTTP server composition registers the ACP Relay runtime handler so grant update/delete/revoke/token-rotate events discard affected target connections without creating ACP-specific notification logic.

The relay MCP proxy is a governance projection, not a convenience tunnel. It must not become a second way to reach tools that the target could not obtain through Tool Management.

## Failure and Cancellation Semantics

| Failure | Required behavior |
| --- | --- |
| Unknown or disabled virtual agent | Operation fails before target connection; ledger records `virtual_agent_unavailable`. |
| Target not installed | Operation fails before side effects; ledger records `target_unavailable`. |
| ACP initialize mismatch | Operation fails; target capability receipt is recorded. |
| Target writes non-ACP stdout | Kill target connection; mark target as unhealthy. |
| Persistent session cannot wake | Keep relay session durable but mark `blocked`; return machine-readable wake failure. |
| Policy changed since last wake | Re-evaluate with current policy; deny, require approval, or rehydrate instead of reusing stale target state. |
| Ledger unavailable | Do not open or prompt target. |
| Authorization deny | Return machine-readable denial to the source agent and write audit. |
| Human approval pending | Suspend workflow with original payload, trace, grant, and idempotency key. |
| Source agent cancels | Send `session/cancel`; mark incomplete child operations cancelled. |
| Target ignores cancel | Enforce timeout, terminate transport if local, write failed cancellation receipt. |

## Observability

Relay events must be visible through:

- Operation Ledger by `operationId`.
- Trace view by `traceId`.
- Relay session list by source agent, virtual agent, concrete target, workspace, lifecycle state, and last wake result.
- Tool Management metrics for compatibility tool calls and ACP relay turns.
- Virtual agent catalog projection: visible, enabled, advertised capabilities, policy revision, target health.
- Target health projection: installed, initialized, native capability receipt, last failure, last successful prompt.
- Wake timeline: dormant, waking, resumed, rehydrated, blocked, or failed.
- Transcript and reasoning retention through global audit retention, trace drill-down, workspace governance, and artifact lifecycle views.

Sensitive payloads must be redacted in logs. Full transcripts require explicit workspace-governed raw retention and must be stored only through global runtime artifact or asset lifecycle storage.

## Verifier Plan

Recommended verification commands to add:

| Verifier | Coverage |
| --- | --- |
| `server:verify:acp-agent-relay-contract` | JSON-RPC framing, initialize, session/new, session/prompt, session/update, stop reason. |
| `server:verify:acp-agent-relay-virtual-agent-catalog` | Multiple source-visible virtual agents can resolve to one concrete target with different capabilities and policies. |
| `server:verify:acp-agent-relay-session-wake` | Durable relay session can be resumed after target shutdown; policy is recalculated before target wake. |
| `server:verify:acp-agent-relay-reasoning-visibility` | Target reasoning traces are hidden by default, exposed only on explicit source request and allowed policy, and never merged into the default progress stream. |
| `server:verify:acp-agent-relay-transcript-retention` | Relay uses global audit retention, workspace governance, redaction export, trace drill-down, and artifact lifecycle; no relay-local raw transcript table, config, export, or prune job. |
| `server:verify:acp-agent-relay-policy` | Deny unknown virtual agent, revoked target, workspace mismatch, data class denial, egress denial. |
| `server:verify:acp-agent-relay-operation-kernel` | No target side effect before accepted ledger event; child operations for target requests. |
| `server:verify:acp-agent-relay-approval` | Write request becomes pending and resumes only after approval. Terminal request remains denied in Phase 1. |
| `server:verify:acp-agent-relay-file-write` | Write-capable virtual agent can modify allowed workspace files only after approval; read-only virtual agent and denied paths fail closed. |
| `server:verify:acp-agent-relay-terminal-deny` | Target terminal requests are denied in Phase 1 even when the source agent explicitly asks or human approval is attempted. |
| `server:verify:acp-agent-relay-cancel` | Source agent cancellation maps to ACP `session/cancel`, ledger records cancellation. |
| `server:verify:acp-agent-relay-mcp-scope` | Target sees only relay-scoped Pact MCP tools allowed by delegation grant; source MCP config/token is never exposed; policy revision triggers catalog refresh or reconnect. |
| Antigravity ACP wrapper target proof | No package script is exposed because former proofs depended on the source-facing stdio harness. Replacement proof must use HTTP or Tool Management source entrypoints while keeping the outbound wrapper as an internal target transport. |
| Downstream Antigravity ACP wrapper proof | No package script is exposed for the same reason; downstream-client-aspect wrapper coverage must be reintroduced through HTTP or Tool Management proof. |
| `server:verify:external-service-api-registration` | `upstream.type="acp"` remains accepted and includes runtime readiness fields. |

## Implementation Phases

### Phase 0 - Contract and registry

- Define `v0.0.1:agent:acp-agent-relay-1` protocol contract.
- Define inbound ACP facade behavior and source-agent identity mapping.
- Extend external service config validation for `upstream.type="acp"` with stdio command fields.
- Define virtual inbound agent projection schema and capability descriptor shape.
- Add operation definitions and Capability IDs.
- Add source, virtual agent, and concrete target registry projections and console read-only list.

### Phase 1 - Mock source and target ACP agents

- Implement `AcpInboundFacade` against a mock source ACP peer.
- Implement `AcpVirtualAgentRegistry` with at least two mock virtual agents resolving to one mock target.
- Implement `AcpClientConnection` and `AcpSessionDriver` against transport-backed ACP JSON-RPC targets, while keeping a mock fallback for local policy tests.
- Support ACP stdio target process launch from target `transport.command` and wrap stdout/stdin as newline-delimited JSON-RPC.
- Implement durable relay session, wake, and turn storage.
- Implement progress-only default updates and request-gated reasoning trace events.
- Wire relay transcript projections to global audit retention, trace, workspace governance, and artifact lifecycle references.
- Implement guarded repository `fs.writeTextFile` child operations with `/approval` and write receipts.
- Implement Phase 1 terminal denial receipts for target terminal requests.
- Add operation kernel and policy tests.
- Return normalized ACP `session/update` and prompt completion results to the source agent.

### Phase 2 - Permission bridge

- Implement `session/request_permission` handling.
- Implement guarded `fs/read_text_file`.
- Keep `terminal` disabled.
- Keep terminal approval override unavailable.

### Phase 3 - MCP scoped proxy

- Pass relay-scoped Pact MCP config to target agents that advertise MCP capabilities. Minimum target-visible projection is implemented through target `initialize` and `session/prompt`.
- Enforce target-visible tool catalog through Tool Management grant, relay policy, operation risk, workspace/data/egress policy, and policy revision. Current work has the Tool Management grant/catalog change hooks, relay child grant minting, and target MCP child-operation metadata injection through the normal Tool Management audit path.
- Add `list_changed`, grant revocation, catalog refresh, and forced reconnect handling. Minimum `list_changed` broadcast, grant/catalog hooks, event-bus publication, and relay grant connection invalidation entrypoint are implemented.

### Phase 4 - Real targets

- Add target adapters for any agent that exposes native ACP stdio.
- Mark Antigravity as `contract-mode` until its native ACP command is verified.
- If a non-ACP CLI bridge is unavoidable, isolate it as `compatibility` and do not mark it native ACP.

## Required Decisions

1. **Inbound source surface.** Decision: first release exposes multiple virtual inbound ACP agents. Each virtual agent is source-visible and advertises its name, modes, modality support, data-source envelope, tool class, and policy. Pact still acts as an ACP agent to the source agent and as an ACP client to the concrete target agent.
2. **Relay session persistence.** Decision: relay sessions are durable by default and support lazy wake at any time. Pact owns source-facing session continuity; concrete targets may be reused, resumed, or rehydrated depending on current capability and policy.
3. **Target mode default.** Decision: no concrete target gets a global default mode. Each virtual inbound agent declares `advertisedModes` and `defaultMode`; for example `antigravity.repo-analysis` defaults to `ask`, while `antigravity.multimodal-coding` defaults to `agent`.
4. **Target reasoning visibility.** Decision: source agents receive progress-only updates by default. Target reasoning traces are available only when the source explicitly requests them and the selected virtual agent policy permits them. Reasoning traces are delivered on a separate event channel and are not merged into the source agent's default context.
5. **Phase 1 repository writes.** Decision: Phase 1 allows cross-agent repository file modification through Pact-mediated file write child operations. Writes require write-capable virtual agent policy, workspace path ACL, operation ledger receipt, and `/approval` by default. Terminal-mediated writes remain denied.
6. **Phase 1 terminal access.** Decision: target agents cannot invoke terminal operations through Pact in Phase 1. Pact must not advertise terminal capability, bridge terminal requests, execute terminal through compatibility CLI wrappers, or allow approval to override the Phase 1 deny.
7. **Antigravity readiness label.** Decision: local Antigravity IDE CLI `1.107.0` is `contract-mode` until a native ACP stdio or stream transport is discovered and verified. `antigravity-ide chat` is not enough.
8. **Transcript retention.** Decision: use global Pact retention, audit, redaction, trace, workspace governance, and artifact lifecycle mechanisms. Store redacted events and receipts by default. Raw transcript and reasoning bodies are opt-in per workspace, globally governed, and never stored in the Git checkout. ACP relay must not implement a separate transcript retention subsystem.
9. **Relay-scoped MCP visibility.** Decision: target agents receive a separate relay delegation grant and a Pact MCP proxy scoped to the current relay session or turn. They never receive the source agent's raw MCP config, token, local MCP commands, or upstream provider credentials. Tool Management dynamically compiles the visible catalog from source grant, virtual agent policy, workspace/data/egress policy, target profile, operation risk, and current policy revision.

## Implementation Readiness

The architectural and product decisions are sufficient to start the ACP Agent Relay module and complete a governed Phase 0/Phase 1 implementation. No product-owner decision is currently blocking the first implementation pass.

## Implementation Status

Phase 0/1 implementation is present in:

- `server/platform/common/protocols/acp/`
- `server/platform/common/downstream-client-aspect/`
- `server/platform/specialized/capabilities/agent-relay/acp-agent-relay/`
- `server/platform/common/operation-dispatcher/operation-registry.mjs`
- `server/platform/specialized/capabilities/tools/tool-management-core/`
- `server/config/entity-config/tools/scopes/agent-relay-*.json`
- `server/config/entity-config/tools/toolsets/agentstudio.agent.relay.json`

The implemented downstream client aspect assembles MCP and ACP framework adapter records at startup through `DownstreamClientAspectService`. MCP support and ACP support are independent layers, and every canonical framework receives one MCP-layer record and one ACP/Relay participant record. Codex ACP is represented by the `codex-acp` adapter path, not by the bare `codex` CLI. The current pinned adapter is `@zed-industries/codex-acp@0.15.0`, whose public package metadata describes it as an ACP-compatible coding agent powered by Codex and exposes the `codex-acp` binary. Claude Code is represented by `claude-code-acp` / `@zed-industries/claude-code-acp`. OpenCode is represented by its native `opencode acp` stdio server. OpenClaw, Copilot, Kilo Code, Cursor, and Hermes Agent are represented by native ACP stdio command shapes (`openclaw acp`, `copilot --acp`, `kilo acp`, `cursor agent acp`, and `hermes acp`). Antigravity ACP is represented by the local Agent API adapter plus optional Connect trajectory observation, not by an installed ACP plugin; the Pact-owned Agent API ACP wrapper is only a Pact-to-wrapper ACP transport proof and remains explicitly `nativeAntigravityAcp: false`. Operator-approved ACP Registry manifests can also be imported into stdio ACP target descriptors through explicit runtime options or `PACT_ACP_AGENT_REGISTRY_JSON` / `PACT_ACP_AGENT_REGISTRY_PATHS`. ACP Relay runtime startup now starts this aspect by default and uses the shared registry registration path, so enabled virtual agents become selectable through `agent/list`, while disabled participant targets remain visible through `target/list` with machine-readable disabled reasons. ACP target descriptors assembled at startup are persisted through the same target registry adapter, which lets Pact restore a target's wake command and capability policy after a restart without rerunning the aspect scan. The aspect translates inbound MCP requests to MCP Server Side / Tool Management route intents and inbound ACP requests to ACP Agent Relay route intents; it does not execute either path directly. The downstream client aspect module is verified by `npm run server:verify:downstream-client-aspect`.

The implemented source-facing REST compatibility surface is `/api/agent-relay/v1/*`, but it is mediated by Tool Management grant authorization, policy evaluation, audit, and metrics. The runtime also remains executable through Tool Management `/api/tool-management/v1/execute` by operation-backed tools in `pact.agent.relay`.

Relay session state is persisted under the runtime `userDataPath` through `agent-relay/acp-relay-store.json`; it is not stored in the Git checkout. Target descriptors can use the same runtime storage root through `agent-relay/acp-target-registry.json`, or an explicit `targetRegistryPath` / `targetRegistryFilePath`. Virtual-agent descriptors can use `agent-relay/acp-virtual-agent-registry.json`, or an explicit `virtualAgentRegistryPath` / `virtualAgentRegistryFilePath`. The target and virtual-agent registries remain the single write paths: `AcpTargetRegistry.upsertTarget()` and `AcpVirtualAgentRegistry.upsertAgent()` write the in-memory descriptors and, when file adapters are configured, atomically persist the normalized descriptor maps. Persisted target descriptors may contain internal transport launch details needed to wake the target, but source-facing `target/list`, `agent/list`, session snapshots, and prompt evidence continue to expose only redacted capability descriptors. The current outbound target implementations include the contract mock, target ACP JSON-RPC over stdio, the local Antigravity Agent API adapter with optional Antigravity Connect trajectory observation, the Pact-owned Antigravity Agent API ACP stdio wrapper, a `codex-cli-exec` target adapter that lets Pact invoke a real local `codex exec` process only when native Codex ACP is unavailable, the generic governed `agent-cli-exec` participant adapter for non-ACP fallback targets, and the standard ACP v1 stdio target path used by canonical native commands, official ACP adapters, and registry-imported `binary` / `npx` / `uvx` ACP distributions.

Pact exposes governed registration and refresh operations through the same operation and permission kernels as the rest of Tool Management: `acp_agent_relay.targets.upsert`, `acp_agent_relay.virtual_agents.upsert`, and `acp_agent_relay.downstream_clients.refresh`. All three require `agent_relay:operate`; HTTP callers reach them through `POST /api/agent-relay/v1/targets`, `PUT /api/agent-relay/v1/targets/:targetId`, `POST /api/agent-relay/v1/virtual-agents`, `PUT /api/agent-relay/v1/virtual-agents/:virtualAgentId`, or `POST /api/agent-relay/v1/downstream-clients/refresh`. `targets.upsert` can register a target and an optional virtual agent in one transaction-like operation. `virtual_agents.upsert` requires the target to already exist, preventing source-visible agents from being created without a routeable target binding. `downstream_clients.refresh` reruns the common downstream client aspect assembly, re-registers ACP target and virtual-agent descriptors through the same registries, and returns only source-safe assembly summaries without target launch commands or credential-bearing environment. The refresh path also reconciles descriptors owned by `downstream-client-aspect`: when an aspect-owned target or virtual agent is no longer produced by the current assembly, Pact disables it with `downstream_client_aspect_not_assembled` instead of deleting it. Manually registered targets and virtual agents are not pruned by this reconcile step.

The former Pact-owned source-facing ACP stdio launch path is retired. Pact no longer exposes package scripts, module manifest exports, active composition presets, or public MCP payloads that let an external source agent start Pact through local stdio. That safety decision is recorded separately in `docs/security/design/0001-local-stdio-interface-lockdown.md` and verified by `npm run server:verify:security-local-stdio-lockdown`.

ACP Relay functional verifiers now cover route behavior, session state, target communication, callback approval, reconnect, idempotency, and real downstream targets without treating Pact's former source stdio entrypoint as a public interface. Target-side native ACP stdio remains an internal downstream target transport where Pact is the caller and the target command is governed by target registry policy, Tool Management authorization, audit, and redacted source-facing descriptors.

Historical package scripts that depended on the retired source-facing stdio harness are removed instead of wrapped. Former Codex ACP target, downstream Codex ACP target, OpenCode ACP target, Antigravity ACP wrapper target, target callback approval, target reconnect, idempotency, and top-level real proof commands may remain as development verifier source files, but they are not package entrypoints, not production readiness evidence, and must not start Pact through local stdio.

Replacement proof must use authenticated HTTP or Tool Management source entrypoints while preserving the same downstream target assertions: `codex-acp` adapter discovery, downstream-client-aspect descriptor provenance, redacted target catalog metadata, internal ACP stdio target communication, final-response or accepted-only projection, target callback approval semantics, reconnect/load behavior, idempotency replay/conflict behavior, and no command/env leakage to source-facing payloads. Target-side native ACP stdio remains allowed only as Pact-owned downstream transport.

Antigravity Agent API capability proof must check whether the Antigravity conversation file changes after the relay prompt when the local `.pb` file is observable and require marker-based local conversation observation when file timestamps are not a strong signal. `get-conversation-metadata` remains useful endpoint diagnostics, but metadata-only reachability is not accepted as proof that the relay moved the target conversation. The proof must also probe common Agent API final-response commands such as `get-conversation`, `get-conversation-messages`, `wait-for-response`, and `stream-conversation`. These Agent API commands currently fail as unknown commands. When Antigravity Connect is not enabled or no Connect final response is observed, the real Antigravity path remains `externalCompletionState: "accepted_only"` and `finalResponseAvailable: false`; when Connect trajectory observation is enabled and exposes a final planner response for the delegated turn, Pact reports `externalCompletionState: "completed"`, `finalResponseAvailable: true`, and `finalResponsePolicy: "connect_trajectory"`.

Each normal `prompt.send` turn now emits a single `globalAuditId` and `artifactRef` derived from the relay turn id. The id is present on the stored turn, every stored relay event, `targetEvidence`, runtime responses, HTTP facade responses, and source-facing ACP `session/prompt` results. Target evidence also includes the effective target binding and policy view: `externalServiceId`, intersected advertised tools, effective write policy, effective terminal policy, effective max risk, policy revision, and relay MCP grant id.

Every source-facing prompt result also carries `communicationSummary`, a compact source-agent-facing status object that is safe to consume through Tool Management or source ACP without reading child-agent reasoning. It includes the relay/session ids, virtual/target agent ids, stop reason, output availability, target completion state, final-response policy, target error code/message when present, receipt and pending-permission counts, progress/reasoning event counts, audit ids, policy revision, and relay MCP grant id. It also classifies the summary with `summaryKind`: `final_response` when Pact has a target final response, `acknowledgement` when the target only accepted the delegated prompt, `target_error` for current-turn target failures, and approval/cancel status values for suspended or terminated turns. Non-terminal states are classified before final availability, so `target_error`, `approval_pending`, `approval_denied`, and `cancelled` cannot be misreported as `final_response`. Source-facing prompt, observe, permission, turn-list, and session-update responses also expose top-level `responseKind`, which is a direct alias of `communicationSummary.summaryKind` or the equivalent event classification. Consumers must use `responseKind` or `communicationSummary.summaryKind` for semantic branching; `output`, `outputSummary`, and `content` remain compatibility text fields and can contain either final text or an acknowledgement. `finalResponseSummary` is populated only for final responses; `acknowledgementSummary` is populated only for accepted-only acknowledgements. The same summary is persisted under turn metadata so idempotency replay, HTTP facade responses, and later audit reads expose consistent communication evidence.

The real Codex/Antigravity gates also emit proof matrices. The relay source harness emits `relayProofMatrix` with schema `v0.0.1:agent:acp-agent-relay-proof-matrix-1`; it records which relay claims are proven by the current run, which optional claims were not requested, and which claims are explicitly unsupported. Source-facing multi-turn continuity is a required relay proof: the verifier must show that a source ACP client can reload and resume the same durable relay session after source transport reconnection and then create a second distinct delegated turn without exposing child-agent reasoning. Source-facing `turn.observe` is also a required relay proof: the Codex/Antigravity verifier must show that the source ACP client can call `_pact/turn/observe` through Pact and receive a redacted target observation for the same relay turn. Source identity isolation is also a required relay proof: the verifier uses a separate source identity, attempts to spoof the owner source fields in the request body, and must observe `relay_session_not_found` plus isolated session enumeration. The final `acp-agent-relay-real` proof bundle emits a top-level `proofMatrix` with schema `v0.0.1:agent:acp-agent-relay-real-proof-matrix-1`; it preserves the relay requirements but recomputes `codex_cli_participation`, `codex_cli_target_communication`, `codex_acp_target_communication`, `downstream_client_aspect_codex_acp_target_communication`, `antigravity_agentapi_acp_wrapper_target_communication`, `antigravity_cross_run_binding`, `target_callback_approval_resume`, `target_callback_approval_denial`, `target_callback_parent_binding`, `source_facing_session_cancel_running_prompt`, `target_reconnect_resume_after_process_restart`, `target_reconnect_load_only_after_process_restart`, and `source_facing_idempotency_replay_conflict` according to the top-level gate. In current local tooling, Codex CLI participation through `codex exec`, source-to-Codex CLI target communication through `codex-cli-exec`, source-to-Codex ACP target communication through `codex-acp`, downstream-client-aspect assembled Codex ACP target communication through the shared registries, and downstream-client-aspect assembled Antigravity wrapper target communication can be proven, while native Codex CLI ACP source/client mode and native Antigravity IDE CLI ACP source/client mode both remain `unsupported` unless the actual source client exposes a verified transport. The top-level real gate emits a final proof bundle with schema `v0.0.1:agent:acp-agent-relay-real-proof-bundle-1` and includes a `codexCli` summary with process, marker, relay, Antigravity, source turn observation, unsupported native source modes, and Connect proof status when requested, a `codexCliTarget` summary with source ACP protocol, transport, target process, completion, `responseKind`, safe communication summary, final-response projection evidence, source-facing operational method proof, reconnect `session/load` replay proof, and reconnect `session/load` reasoning-trace suppression proof for the CLI exec proxy, a `codexAcpTarget` summary with standard ACP stdio adapter, native ACP target verification, source-facing operational method proof, reconnect `session/load` replay proof, reconnect `session/load` reasoning-trace suppression proof, `responseKind`, safe communication summary, and final-response projection evidence, a `downstreamCodexAcpTarget` summary with downstream-client-aspect startup assembly proof, safe source discovery metadata, redacted target descriptor proof, native Codex ACP stdio invocation, source-facing operational method proof, reconnect `session/load` replay proof, and final-response projection evidence, an `antigravityAcpWrapperTarget` summary with downstream-client-aspect startup assembly proof, safe source discovery metadata, redacted target descriptor proof, Pact-owned outbound ACP stdio wrapper invocation, accepted-only projection, marker observation, and reconnect `session/load` reasoning suppression, a `targetCallbackApproval` summary proving target-originated callback approval suspend/resume on the same relay turn, denial without workspace writes or guarded-content leaks, parent-binding fail-closed evidence for `target_callback_parent_ambiguous` plus `target_callback_parent_not_found`, and source-facing running-prompt `session/cancel` evidence showing the target received cancel while late target completion stayed suppressed, a `targetReconnect` summary proving Pact discards a closed downstream ACP stdio process, relaunches it, resumes with the previous `targetResumeRef`, preserves the source relay session, creates a distinct second turn, and suppresses default reasoning replay, a `targetLoadReconnect` summary proving Pact uses `session/load` instead of `session/resume` for a restarted load-only ACP target, and an `idempotency` summary proving duplicate source-facing prompts replay the same completed turn without target wake and same-key different prompts fail with `idempotency_key_conflict`. The bundle also exposes the current communication mode: Antigravity real proof is `agent_api_proxy`, Antigravity wrapper proof is `antigravity_agentapi_acp_stdio_wrapper`, Codex CLI target proof is `codex_cli_exec_proxy`, Codex ACP target proof is `codex_acp_stdio`, downstream-client-aspect Codex ACP target proof is also `codex_acp_stdio` but additionally requires aspect provenance, and only the Codex ACP target proofs are reported as native ACP target evidence. `relayRequiredProofsMet` reports only the relay source harness matrix; top-level `allRequiredProofsMet` reports the top-level matrix and therefore includes Codex CLI participation plus all three Codex target communication requirements when requested, Antigravity wrapper target communication and cross-run binding by default, plus target callback approval resume, target callback approval denial, target callback parent binding, source-facing running prompt cancellation, target reconnect/resume after process restart, target reconnect/load-only after process restart, and idempotency replay/conflict safety by default. Operators can also persist that bundle by setting `PACT_ACP_RELAY_REAL_PROOF_BUNDLE_PATH`.

The same top-level real proof matrix includes `antigravity_agentapi_acp_wrapper_target_communication` and `antigravity_cross_run_binding` by default. Its `antigravityAcpWrapperTarget` summary proves source ACP -> Pact -> downstream-client-aspect assembled outbound ACP stdio wrapper -> Antigravity Agent API communication, command redaction, accepted-only projection, marker-based local observation, and restart `session/load` reasoning suppression. Its communication mode is `antigravity_agentapi_acp_stdio_wrapper`; the source-facing target descriptor remains `native_acp_stdio` because Pact talks ACP to the wrapper, while `nativeAntigravityAcp` remains `false` because Antigravity itself is still reached through Agent API. The cross-run binding requirement prevents a misleading bundle where direct Antigravity proof, Codex-orchestrated proof, and wrapper proof accidentally target different local Antigravity conversations.

Source-facing virtual agent discovery is available through `agent/list` and `_pact/agent/list`. The methods return only safe capability descriptors, including public/safe metadata only, and `session/new` returns the same descriptor as `capabilitiesSnapshot` plus a minimal route summary instead of the raw internal route object. The same safe snapshot is persisted on the relay session and returned by `session/load`, `session/resume`, closed-session `session/load`, idempotency replay target evidence, and normal prompt target evidence. This lets source agents choose among multiple virtual agents by capability and recover that choice after process restart while keeping target transport secrets and internal connector configuration out of source-visible responses.

Source-facing concrete target discovery is available through `target/list` and `_pact/target/list` for cases where the source agent explicitly needs to reason about target-specific capabilities, such as multimodal support, special data-source reachability, provider-specific toolsets, or native ACP/proxy communication differences. The response is a safe target capability descriptor: target id, label, profile, enabled state, disabled reason when present, external service id, transport type, protocol style, communication mode, native ACP support/verification flags, advertised toolsets, write/terminal/risk envelope, final-response policy, revision, and public/safe metadata only. Current mode values include `native_acp_stdio` for stdio targets declaring `agent-client-protocol-v1`, `codex_cli_exec_proxy` for the Codex CLI exec compatibility adapter, `agent_cli_exec_proxy` / `agent_cli_exec_fallback` for governed local CLI participants, `agent_api_proxy` for the Antigravity Agent API adapter, and `contract_mock` for mock targets. It deliberately omits raw transport config, command argv, binary paths, URLs, CSRF tokens, environment variables, endpoint credentials, and unclassified target metadata.

The Antigravity wrapper verifier uses source-facing `native_acp_stdio` discovery because the immediate Pact target is an ACP stdio process. Its proof-specific result uses `antigravity_agentapi_acp_stdio_wrapper` to make the downstream hop explicit and to prevent confusing wrapper ACP support with native Antigravity ACP support.

Relay read-side observability is exposed through Tool Management-backed `acp_agent_relay.sessions.list`, `acp_agent_relay.sessions.get`, `acp_agent_relay.turns.list`, and `acp_agent_relay.turn.observe`, plus the compatibility HTTP paths `GET /api/agent-relay/v1/sessions`, `GET /api/agent-relay/v1/sessions/:sessionId`, `GET /api/agent-relay/v1/sessions/:sessionId/turns`, and `POST /api/agent-relay/v1/sessions/:sessionId/turns/:turnId/observe`. The same status plane is available to source ACP clients through Pact extension methods `_pact/session/list`, `session/list`, `_pact/session/get`, `session/get`, `_pact/turn/list`, `turn/list`, `_pact/turn/observe`, and `turn/observe`, but the source-facing ACP projection is narrower than the operator-facing Tool Management summary. It returns session and turn status, pending-permission counts, wake status, capability snapshots, audit ids, artifact refs, and source-safe `communicationSummary`, while omitting target session/resume references, relay MCP grant ids, and child-agent reasoning. By default list/get/turn observability returns only pending-permission counts; when the caller explicitly sets `includePendingPermissionRequests=true`, the response includes sanitized pending request details with request id, action, path, target tool-call id, status, and payload hash, but still omits prompt text, write content, transport secrets, and reasoning traces. Reasoning remains a separate visibility-controlled channel and is only surfaced when the caller explicitly requested and policy allowed it. Source-facing observability requests are filtered by current source identity so one source agent cannot enumerate another source's relay sessions.

`turn.observe` is a bounded observation refresh. It can update a previously accepted-only or completed turn when the target adapter exposes safe local observation, for example Antigravity Agent API conversation observation. It must not replay the prompt, wake an unrelated target, or fetch raw transcripts for the source. The operation stores only redacted observation metadata, event counts, preview text, completion state, and refreshed target evidence. If a final response is observed later, Pact upgrades the source-safe `communicationSummary` to `externalCompletionState: "completed"` and `finalResponseAvailable: true`; if no new evidence is present, the result is `refreshed: false`; if the target does not support observation, the result is `observed: false` with a machine-readable reason. Source-facing ACP observe responses still return the safe turn summary for the requested turn, and `includePendingPermissionRequests=true` can expose sanitized pending request ids and hashes while the turn is `approval_pending`.

The source-facing ACP `sessionId` returned by Pact is the durable `relaySessionId`. On later `session/load`, `session/resume`, `session/prompt`, `session/cancel`, and `session/close` calls it is used to locate the relay session, but it is not treated as the source agent's original `sourceSessionId`. This keeps direct ACP session-id restore compatible with ordinary ACP clients while preserving source ownership checks through `sourceId`, `workspaceId`, `virtualAgentId`, and any explicitly supplied `sourceSessionId`.

`session/load` is an observability operation and may return the persisted safe capability snapshot for a historical or closed session. `session/resume` is an activation operation and always re-evaluates the current route and policy before returning. If the virtual agent or target is disabled, rebinding fails, or policy no longer allows the route, Pact marks the relay session `blocked` and returns the route error. If the route is still allowed, Pact refreshes the persisted `capabilitiesSnapshot` and `policyRevision`; sessions with pending permission requests remain `approval_pending`, while sessions with no pending approval return to `dormant`. Both `session/load` and `session/resume` return sanitized `pendingPermissionRequests` so a reconnecting source agent can recover request ids without reading write content, prompt text, transport secrets, or target reasoning.

Write approvals now have a suspend/resume path without storing raw write bodies in the durable relay tables. When a relay-side file write or a target-originated `fs/write_text_file` callback returns `pending_approval`, the relay records a `permissionRequest`, marks the relay turn `approval_pending`, returns `stopReason: "approval_pending"`, and exposes only request id, action, path, target tool-call id, and payload hash to the source agent. Durable `permissionRequest.details` stores hashes and internal sensitive-payload references, not raw `content` or raw `promptText`; file-backed relay runtimes store pending prompt/write bodies in `agent-relay/acp-sensitive-payloads.json` with owner-only file permissions, while in-memory runtimes keep only a process-local cache. The internal `acp_agent_relay.permission.resolve` operation can approve or deny the pending request after validating `requestId` and `payloadHash`; approval executes the guarded write once when the referenced sensitive payload is available, resumes the original turn under the same audit ids, and denial completes the turn without writing. Permission resolve is serialized per relay turn so concurrent approvals cannot double-resume the same suspended prompt. If the source repeats the same `session/prompt` with the same `idempotencyKey` while approval is pending or after completion, Pact replays the same turn result without waking the target or repeating the write. If the sensitive payload is unavailable, approval fails closed with `permission_payload_unavailable` instead of writing from stale or missing data. The operation remains hidden from the Tool Management catalog and `/api/agent-relay/v1/.../permission/resolve` compatibility route.

Source-facing ACP Relay responses expose progress through stored relay events before the final `session/prompt` result. The projection suppresses duplicate `progress/accepted` notices for a single prompt, preserves completion/update ordering, and keeps public payloads free of target launch details.

Source-facing `session/load` replays stored relay events as `session/update` notifications before returning the load response. The response includes `replayedUpdateCount`, and stdio/verifier readers must continue reading frames until the matching JSON-RPC response id appears. Closed sessions remain loadable for observability and also replay their stored updates, while later `session/resume`, `session/prompt`, `session/cancel`, and `session/close` fail closed.

Replay uses the same reasoning visibility rule as live prompt streaming. Historical `reasoning_trace` events are filtered from `session/load` by default and are only replayed when the source explicitly sets `requestReasoning=true`; even a virtual agent policy of `always` does not bypass the source-request gate. This keeps the source agent's default context progress-only across both live turns and restored sessions.

The source-facing ACP projection now favors ACP v1-compatible envelope fields while preserving Pact-specific extension fields. `initialize` returns numeric `protocolVersion: 1` plus `pactProtocolVersion: "v0.0.1:agent:acp-agent-relay-1"` and source-visible capability snapshots. It derives prompt modality declarations from the selected virtual agent's capability snapshot instead of using a fixed bridge-wide value, so a text-only Agent API profile does not advertise image prompt support. It advertises `sessionCapabilities.load`, `resume`, `cancel`, and `close` only for source-facing relay-session operations Pact actually implements and only marks activation operations available while the selected route snapshot is available. Source prompts may arrive as either Pact legacy strings or ACP text content blocks; the bridge extracts text blocks into the governed relay prompt without losing idempotency semantics. `session/update` notifications include the standard `params.sessionId` and `params.update.sessionUpdate` shape with text content under `params.update.content`, while retaining legacy `type`, `phase`, `text`, audit, and relay ids for existing Pact verifiers. Pact's multi-agent catalog remains available as `agent/list` and the explicit extension alias `_pact/agent/list`.

Source-facing JSON-RPC distinguishes frame-level errors from relay operation errors. Parse errors remain `-32700`, malformed request frames remain `-32600`, unsupported methods remain `-32601`, and handler crashes remain `-32603`. Normal relay failures such as `relay_session_not_found`, `relay_session_closed`, source-guard denial, route denial, idempotency conflict, or target wake failure return JSON-RPC `-32002` with the machine-readable relay code preserved at `error.data.code` and the normalized operation payload under `error.data.operation`.

Source-facing JSON-RPC supports batch request frames without changing the single-message `parseJsonRpcMessage` contract. The frame parser accepts a single request, notification, response, or a batch array; the source bridge returns one batch response array for request entries and omits notification responses, while empty batches fail closed with JSON-RPC `-32600`. Client-originated JSON-RPC response envelopes are ignored, including when mixed into a batch, so source clients that answer Pact notifications or callbacks do not receive spurious invalid-request errors. Source-facing `fs/read_text_file` and `fs/write_text_file` are also guarded by the virtual agent's advertised tool set before the permission bridge runs. A virtual agent that has not advertised `fs.readTextFile` or `fs.writeTextFile` receives an explicit `-32003` denial with a source-visible reason code, and no file write is attempted.

The former source-facing stdio service is no longer a public production interface. Source-facing concurrency, cancel, load, resume, and close semantics are owned by the relay runtime and HTTP/Tool Management entrypoints, while target-side ACP stdio remains an internal downstream transport managed by Pact.

Source-facing ACP operations can be guarded by the same `securityPermissions` facade used by Tool Management. `AcpSourceOperationGuard` consumes operation metadata from the global operation registry and calls `authorizeOperation` or `evaluatePolicy` before dispatching relay operations. The minimum implementation shares `acp-source-auth-context.mjs` between the source JSON-RPC bridge and the guard: the bridge produces a public `sourceIdentity` plus internal `sourceAuthContext`, and the guard derives the authorization subject and resource context from that trusted binding before falling back to request fields. Denied source operations return a normal relay operation error with decision evidence and do not wake, connect, or prompt the target agent. When no security provider is injected, the runtime remains compatibility-mode for local verifiers.

Source agents resolve pending approvals through the ACP method `session/request_permission`, not through a Tool Management-exposed internal operation. The source-facing response returns sanitized `pendingPermissionRequests`, permission results, and safe turn summaries: request id, action, path, payload hash, status, and receipt metadata are visible, while stored write content, prompt text, and internal `turn.metadata` remain internal. Approval resumes the suspended turn and emits receipt/completion `session/update` notifications; denial emits denial/completion notifications, leaves the workspace untouched, and returns `stopReason: "approval_denied"`.

`session/prompt` evaluates relay-side terminal and file-write requests before waking the target transport. If a relay-side prompt write enters `approval_pending`, the target connection is not opened and Antigravity or stdio target APIs are not called until `session/request_permission` approves the pending operation. If a target-originated write callback enters `approval_pending`, Pact records the pending request, closes the in-flight target callback transport, and later resumes the same relay turn after approval. Replayed target callbacks with the same target tool-call id and payload hash receive the existing completed receipt so the approved file write is not repeated.

The current Antigravity Agent API command surface exposes `new-conversation`, `send-message`, and `get-conversation-metadata`, but no stable Agent API wait-for-completion or final-response read command. Pact therefore treats `send-message` as an acceptance acknowledgement unless the optional Connect trajectory path supplies authoritative progress, final-response evidence, or target-error evidence. The Antigravity evidence snapshot also probes the local `antigravity-ide` CLI and `agy` CLI. Current `antigravity-ide --help` exposes editor launch, extension management, and MCP configuration via `--add-mcp`; current `agy --help` exposes prompt modes, model listing, update, and plugin management; current `agy plugin --help` exposes plugin install/import/enable/disable/validate commands. None expose a native ACP stdio/stream command or a documented Antigravity ACP adapter. The source-visible `agentApiCapabilitySnapshot.ideCli` records this as `nativeAcpTransportSupported: false`, `chatIsAcpTransport: false`, and `nativeAcpTargetVerified: false`, so the Agent API proxy path cannot be silently reclassified as native ACP. With `connectWaitForFinalResponse` enabled, the Antigravity adapter waits up to `connectObservationTimeoutMs` for the current Connect trajectory to reach idle, a pending interaction, or a final planner response. If a final planner response is found, the source-facing ACP result receives that text as `result.output` and the completion notification text. If the current Connect trajectory reports an error step, failed status, or post-send observation failure, Pact returns `stopReason: "target_error"`, `externalCompletionState: "target_error"`, `finalResponsePolicy: "target_error"`, and a source-visible `targetEvidence.targetError` object. If neither final response nor target error is observed, Pact keeps the turn accepted-only and records the target resume evidence for later observation. A later `turn.observe` call may refresh that accepted-only evidence from configured local observation and update the turn's source-safe completion summary, but it still does not expose raw Antigravity transcript bodies or target reasoning.

Antigravity Connect may emit empty `ERROR_MESSAGE` steps while the local transcript contains a readable quota or runtime failure message from the same observation window. The relay distinguishes current-turn error classification from diagnostic context: `latestError` is the last error in the current post-baseline observation window, while `latestKnownError` is the most recent readable error in that same window. A blank current Connect error can use the local transcript `latestKnownError` as `targetError.diagnosticMessage` and, when no better current text exists, as the source-facing target error message. A known historical error outside the current baseline must not classify a new turn as `target_error` or replace the current turn's error message. A blank Connect `ERROR_MESSAGE` without readable Connect error text, without a failed Connect run status, and without a current high-signal local transcript diagnostic remains visible under `connectConversationObservation.latestError`, but does not by itself convert an accepted Agent API send into `stopReason: "target_error"`.

Connect trajectory normalization reads Antigravity's nested step shapes rather than only top-level `content` and `error` fields. System-message steps can carry the delegated relay prompt and marker under `systemMessage.agentMessage.content` or `systemMessage.renderInfo.markdown`; user-input and add-cascade-input steps can carry markers under `userInput.*` and `addCascadeInput.*`; error-message steps can carry quota and provider failures under `errorMessage.error.userErrorMessage`, `modelErrorMessage`, `shortError`, `message`, or `fullError`; planner-response steps retain `plannerResponse.stopReason`. Redacted Connect evidence exposes only safe diagnostics such as `hasSystemMessage`, `hasUserInput`, `hasAddCascadeInput`, `plannerResponseStopReason`, `contentSourcePath`, and `errorSourcePath`, so operators can see which field produced the evidence without leaking raw prompts, full provider errors, CSRF tokens, or connector credentials. When the real Antigravity verifier requires Connect, the top-level post-send Connect observation must directly show the delegated prompt marker; source-side target evidence is included as diagnostics, not as the primary proof.

Antigravity target evidence carries `finalResponsePolicy` and an `agentApiCapabilitySnapshot`. The snapshot is derived from the local `agentapi` command surface, final-response probes, and the Connect observation state, not from an optimistic hard-coded claim. Current usage output lists `get-conversation-metadata`, `new-conversation`, and `send-message`; probes for `get-conversation`, `get-conversation-messages`, `wait-for-response`, and `stream-conversation` fail as unknown commands. Real Antigravity verifiers assert this snapshot so the relay cannot silently reclassify a plain `send-message` acknowledgement as a completed final response without Connect trajectory evidence.

Standard ACP targets are no longer limited to the local mock connection. `AcpClientConnection` can send `initialize`, `session/new`, `session/resume`, `session/load`, `session/prompt`, and advertised `session/close` over a JSON-RPC transport, collect target `session/update` notifications, and return completed target output through source-facing ACP `result.output` and completion notifications. When a persisted target resume reference exists, load-only targets receive `session/load` instead of `session/resume`. `AcpSessionDriver` can also launch a stdio ACP target from `target.transport.command`, wrap the child process stdin/stdout as line-delimited JSON-RPC, and close the transport with the relay connection lifecycle.

Target-originated ACP callback requests are handled inside the same governed relay turn. When a target stdio ACP agent sends JSON-RPC requests such as `session/request_permission`, `fs/read_text_file`, or `fs/write_text_file` while Pact is waiting for the target `session/prompt` response, `AcpClientConnection` routes the request to the relay executor instead of treating it as an unexpected response frame. Callback routing is parent-bound: Pact includes a `pactParentRequestId` on callback-capable target requests, and inbound target callbacks may use that id to select the parent. Without an explicit parent id, the connection layer routes only when exactly one callback-capable pending parent exists; otherwise it returns JSON-RPC `-32601` with a parent resolution reason and performs no side effect. It does not FIFO-route callbacks to unrelated pending `session/cancel`, `session/new`, or other target requests. The executor dispatches routed callbacks through a target callback registry. The built-in registry handlers map permission and filesystem callbacks through `AcpPermissionBridge`, record a relay permission request plus permission-sourced receipt or denial event, send a JSON-RPC response back to the target when the callback is immediately resolved, and include sanitized callback receipts in final target evidence. Runtime file-read callbacks may return content to the target but store only digest/length metadata in permission receipts; terminal callbacks remain hard-denied. Runtime target file-write callbacks can now suspend the turn as `approval_pending`; source approval through `session/request_permission` writes once, then target callback replay is answered with the completed receipt rather than writing again. Additional callback methods can be registered by runtime embedders through `targetCallbackHandlers`; registry misses fail closed with JSON-RPC `-32601` and an auditable denial receipt, rather than silently disappearing.

Stdio target lifecycle failures are modeled as connection failures, not partial initialization. If spawn, transport send, `initialize`, or `session/new|resume` fails, `AcpClientConnection.initialized` remains false and the connection is marked closed. Child `error` and `exit` events close the line transport so `AcpSessionDriver.wake()` can rebuild the connection instead of reusing a dead child. Child stderr is treated as diagnostics only and is control-character cleaned and token-redacted before logging.

`AcpSessionDriver.wake()` now discards a newly cached target connection when target initialization returns `ok: false` or throws. `acp_agent_relay.session.wake` records the failed `lastWakeResult`, restores the previous non-`waking` relay lifecycle state, and returns a machine-readable operation error instead of leaving the relay session stuck in `waking` or incorrectly promoting it to `active`.

Prompt turns that have already been accepted also fail closed into source-visible state when target wake or target prompt execution throws. Pact records a `target_error` completion event, stores target-error evidence and `communicationSummary`, avoids leaving the turn `running`, and keeps the relay session out of `waking` so future operations can inspect or retry under current policy.

The former source-facing stdio end-to-end verifier path is retired and no longer counts as production readiness evidence. Runtime shutdown still calls `AcpSessionDriver.closeAll()` so target stdio children are closed when the relay runtime shuts down.

The target lifecycle path verifies close behavior: Pact sends target `session/close` when the target advertises close support, closes the target stdio child, removes the cached target connection, keeps `session/load` able to report the closed session state, and rejects later wake, cancel, resume, or prompt attempts with `relay_session_closed`.

The retired source-stdio verifier set previously covered target callback approval, target reconnect, load-only target reconnect, and source-facing idempotency against real target stdio processes. Those behaviors remain required, but their production evidence must be rebuilt through HTTP or Tool Management source entrypoints. The replacement proof must still show target-originated `fs/write_text_file` approval/denial without guarded-content leaks, parent-binding fail-closed behavior, running prompt cancellation, target process restart recovery with refreshed `targetResumeRef`, load-only `session/load` recovery, and idempotency replay/conflict behavior without repeating target prompts.

`npm run server:verify:acp-agent-relay` is the unified verifier for the current implementation. It covers JSON-RPC contract helpers, virtual agent and target discovery, durable wake and policy recalculation, reasoning visibility, final-response-capable target output and idempotent replay, transcript retention hygiene, policy fail-closed cases, file-write approval behavior, Phase 1 terminal denial, relay-scoped MCP projection, Tool Management-mediated REST facade execution, read-side session/turn observability, `turn.observe` target observation refresh, and persisted relay store state. It also checks that Tool Management grant-bound source identity overrides request-body source/session spoofing, that relay audit/artifact ids are derived from relay turns rather than source-supplied refs, that durable relay MCP grant ids are generated by the platform, and that every public ACP Relay Tool Management tool is registered in the Authorization Kernel capability list. `server/scripts/verify-acp-agent-relay-mcp-scope.mjs` exercises Tool Management entry -> ACP Relay -> relay MCP child grant -> target `Authorization` projection -> explicit short-lived child-grant TTL -> target MCP tool call audit with relay turn child-operation binding -> child grant id collision rejection -> target child-operation mismatch rejection -> non-persistence check -> target connection loss -> child bearer reissue with old bearer invalidation -> session close revoke.

The module is not yet production-complete. Remaining engineering details include:

- Exact `v0.0.1:agent:acp-agent-relay-1` contract fixtures for inbound ACP, outbound ACP, progress events, reasoning trace events, permission callbacks, file callbacks, cancel, and stop reasons.
- Production storage schema or durable record implementation for relay targets, virtual agents, sources, sessions, turns, events, permission requests, wake state, and relay MCP grant references beyond the current JSON-backed Phase 1 store.
- Additional native target ACP transport fixtures for concrete third-party agents beyond the current stdio process fixture, OpenCode downstream ACP stdio fixture, and Antigravity Agent API adapter.
- Inbound virtual agent discovery/binding details for how third-party source agents select one Pact-published virtual inbound agent without relying on Pact-specific convenience fields.
- Additional expiry and retention-policy fixtures for pending approvals after the verified target-originated runtime write resume path.
- Wake/resume/rehydration fixtures that prove policy is recalculated before target reuse.
- Production relay-scoped MCP hardening beyond the minimum grant/token implementation: none currently recorded for Phase 1; future work can add dedicated query indexes for relay child-operation audit dimensions if operational dashboards need them.
- Integration with global audit retention, trace drill-down, workspace governance, and artifact lifecycle without relay-local transcript retention.
- Expanded verifier fixtures for native third-party ACP transports beyond the verified target stdio path, Codex CLI exec proxy, downstream OpenCode ACP stdio fixture, and Antigravity Agent API proxy.

Completion criteria should be verifier-driven: the module is not complete until the contract, policy, operation-kernel, write approval, terminal deny, reasoning visibility, transcript governance, MCP scope, wake, and external-service registration gates pass.

## Open Questions for Product Owner

None recorded.
