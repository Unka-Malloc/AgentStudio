# Pact Client Design Conformance

**Status:** Destructive refactor control matrix
**Scope:** `client-cli`, `client-gui`, client packaging, and client verifier gates
**Updated:** 2026-05-26

This document is the working conformance matrix for the destructive Pact desktop
client refactor. `docs/CLIENT_ARCHITECTURE.md` and
`docs/CLIENT-IMPLEMENTATION-PLAN.md` are the only product targets. Existing code
is retained only when it clearly serves the new six-module client. The old
client is not a compatibility target.

Historical context for the old client has been consolidated in
`docs/CLIENT-HISTORY.md`. That document is reference-only and cannot justify
legacy modules entering default navigation, CLI, tests, builds, or packaging.

Decision values:

- `keep`: stays in the main product path.
- `replace`: old implementation is removed and replaced by new client code.
- `delete`: removed from the main product and repository path for the client.
- `legacy-dev-only`: may remain only under a development-only path and must not
  be referenced by default navigation, default CLI, default tests, or default
  packaging.

## Required Main Product Modules

| Module | Required path | Notes |
| --- | --- | --- |
| Agents | `client-cli targets ...`, GUI Agents module | Target discovery, manual add, pairing status, OpenCode visible in first batch. |
| MCP Plugins | `client-cli mcp plugin ...`, GUI MCP Plugins module | Pact MCP is a peer plugin, never a privileged host. |
| Skill Hub | `client-cli skill ...`, GUI Skill Hub module | Passive local boundary only until the three-party protocol is designed. |
| Model Forwarding | `client-cli forward ...`, GUI Model Forwarding module | Thin forwarding only; no session harness, planner, or tool loop. |
| Activity And Snapshots | `ClientStateStore`, `ActivityLog`, `SnapshotStore`, GUI Activity module | JSON/JSONL state, configuration snapshots, rollback. |
| Settings | GUI Settings module, JSON settings | Paths, manual binaries, local repo, server profile, preferences. |

## First Target Adapters

| Target | Decision | Required behavior |
| --- | --- | --- |
| Codex | keep | Target-native config scan, plan, apply, rollback. Preserve unrelated MCP entries and tokens. |
| OpenCode | keep | Remote MCP config with `url`, `headers.X-Pact-Api-Key`, and `enabled`. |
| OpenClaw | keep | VM or endpoint-aware adapter; no fixed localhost assumption. |
| Antigravity | keep | Target-native config path and no GUI launch during scan. |
| Cursor | keep | Target-native config handling; preserve third-party MCP entries. |
| Windsurf | keep | Target-native MCP config handling. |
| Gemini CLI | keep | CLI/config adapter; no broad home-directory crawl. |

## Old Module Disposition Matrix

| Existing module or entry | Decision | Required action | Verifier |
| --- | --- | --- | --- |
| `client-cli/src/local_agents.rs` | delete | Remove or replace with target adapter implementation. `local-agents` must not remain a formal CLI. | `client:verify:architecture`, `client:verify:targets` |
| `pact-client local-agents scan/install/uninstall` | replace | Replace with `targets scan/add/inspect` and `mcp config plan/apply/rollback`. | `client:verify:targets` |
| GUI `AgentService` local-agents calls | replace | Call the new targets API, not `local-agents`. | Flutter service/widget tests |
| `client-cli/src/agent_client.rs` | delete | Remove from mainline or move to `legacy/dev-only`; do not back Model Forwarding with it. | `client:verify:thin-forwarding` |
| `pact-client agent invoke` | delete | Remove from main CLI. Use `pact-client forward` for thin forwarding. | `client:verify:thin-forwarding` |
| `knowledge agent-answer` custom HTTP adapter | legacy-dev-only | Do not expose as new Model Forwarding. If temporarily present for tests, isolate and schedule removal. | `client:verify:architecture` |
| Rust daemon `pact-clientd` | legacy-dev-only | Not part of default new client runtime. Keep only while packaging/test removal is staged. | `client:package:plan` |
| `pact-client daemon ...` | legacy-dev-only | Remove from product CLI or isolate from default usage. | `client:verify:architecture` |
| `pact-client server api ...` and old HTTP panel bridge | delete | GUI must not rely on old server HTTP panels. | `client:verify:architecture` |
| Mail import CLI/UI and `MacOSMailImporter` | legacy-dev-only | Remove from main navigation and default package; may become Skill/plugin example later. | `client:package:plan`, `client:analyze` |
| DataConnector/connectors CLI/UI | legacy-dev-only | Remove from default client; keep only as server/plugin asset. | `client:package:plan` |
| Knowledge Graph UI/models/services | legacy-dev-only | Remove from main navigation and product package. | `client:analyze`, `client:test` |
| Upload queue/checkpoint client CLI | legacy-dev-only | Not part of new default desktop client. | `client:package:plan` |
| Old Console/Server/Modules/Export/Logs navigation | delete | Replace main shell with six modules only. | `client:verify:architecture`, `client:test` |
| `client-gui/packaging.modules.json` old heavy defaults | replace | Default package includes only new client modules and CLI. Old modules require `legacy/dev-only` profile. | `client:package:plan` |
| Server Skill Registry and MCP Skill Hub protocol | keep boundary only | Return `protocol_deferred` where protocol is required. Do not mark complete. | `client:verify:pairing-skill-cli` |

## Temporary Holds

Temporary holds are allowed only when a test or release entry cannot be removed
in the same batch. Each hold must name the deletion batch and guard.

| Hold | Reason | Delete by | Guard |
| --- | --- | --- | --- |
| None yet | N/A | N/A | N/A |

## Non-Conformance Rules

The following are automatic conformance failures:

- Main navigation contains anything other than Agents, MCP Plugins, Skill Hub,
  Model Forwarding, Activity, and Settings.
- Default CLI exposes `local-agents`.
- GUI calls `local-agents`.
- Model Forwarding depends on `agent invoke` or `agent_client.rs`.
- Default package includes DataConnector, Mail, Knowledge Graph, upload queue,
  old daemon, or old HTTP panel runtime.
- A verifier is only a string check or marks deferred protocol work as done.
