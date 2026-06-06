# Pact Client Architecture

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: Pact Client Architecture.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

**Status:** Design baseline
**Scope:** Pact Desktop Client

This document is the product and engineering contract for the next Pact desktop
client. The new architecture takes precedence over the current Flutter client
implementation. Existing client features may be reused only when they fit this
contract. Features that require a heavy local business runtime should be moved
into Skills, MCP plugins, or removed from the main client.

This document is the active authority for the destructive desktop-client
refactor. The current client is the only maintained implementation. Code that
does not clearly serve this architecture must be deleted or replaced so it
cannot enter product navigation, CLI, build, or package plan.

## 1. Product Identity

Pact Client is a lightweight local environment manager. It is responsible for
visual MCP configuration, local Skill Hub management, model request forwarding,
and target-specific adapter flows for OpenClaw, Claude Code, Codex, Gemini CLI,
Antigravity, OpenCode, Copilot, Kilo Code, Cursor, Hermes Agent, and Windsurf.

Pact Client is not an agent harness, network proxy, permission broker, local
analysis engine, or universal MCP aggregation gateway.

The client keeps the user's local machine understandable without becoming a
second agent framework. It helps users see and edit what would otherwise be
manual configuration files, package downloads, version pins, and rollback
records.

## 2. Non-Goals

- Do not build a new Agent Harness framework.
- Do not implement an autonomous agent loop, planner, tool chooser, memory
  manager, or tool execution state machine.
- Do not proxy all local MCP traffic through Pact Client.
- Do not execute local tools on behalf of intelligent agents.
- Do not approve or reject runtime tool calls. The endpoint that executes a
  tool owns the approval UX.
- Do not preserve removed desktop-client UI, CLI, daemon, HTTP panel,
  DataConnector, Mail, Knowledge Graph, upload queue, or agent invocation
  surfaces as compatibility shells.
- Do not keep `local-agents` as a formal CLI or GUI dependency.
- Do not use `agent invoke` as the basis for Model Forwarding.
- Do not install Python, Node.js, system packages, remote SSH keys, or runtime
  dependencies for Skills.
- Do not copy Skills into an agent workspace, remote host, or container. The
  requesting agent is responsible for copying, executing, and requesting any
  required permissions.
- Do not preserve current heavy Flutter client pages as product requirements
  when they conflict with this document.

## 3. Primary UI Modules

The main client should be organized around a small set of first-level modules:

| Module | Responsibility |
| --- | --- |
| Agents | Discover supported intelligent agent runtimes, show target-specific configuration state, and expose manual add flows. |
| MCP Plugins | Manage Pact MCP and other configured MCP entries as peer plugins, including install, version display, update trigger, rollback trigger, and target-specific config fields. |
| Skill Hub | Store, sync, verify, version, pin, hide, delete, and expose Skills as a passive local repository. |
| Model Forwarding | Configure model endpoints and forward thin requests through existing MCP/plugin/server capabilities without owning agent orchestration. |
| Activity And Snapshots | Show every configuration write, Skill sync, visibility change, version pin, update trigger, rollback, conflict, and snapshot. |
| Settings | Configure known paths, manual binaries, local repository location, server profile, and client preferences. |

The client must not retain a server-console-style information architecture as
the main product. Existing HTTP panels, upload queues, DataConnector pages,
Mail import flows, knowledge graph pages, checkpoint views, and local daemon
surfaces are outside the current client boundary. They must be removed unless a
new explicit design decision reclassifies them into the six-module
architecture.

## 4. Out-of-Band MCP Configuration

Pact Client manages MCP configuration out of band. It directly reads and writes
target agent configuration files or calls official target CLI commands when
available. Closing Pact Client must not break an already configured agent.

Rules:

- The file system and target-native configuration are the source of truth.
- Pact Client is a visual editor for configuration, not an intercepting proxy.
- Pact MCP is a peer MCP plugin, not a privileged super-plugin.
- Each target agent keeps its own MCP scope, permissions, tokens, and runtime
  behavior.
- Manual edits and client edits are semantically equivalent. The client must
  rescan and reflect external edits rather than assume exclusive ownership.

## 5. Target Adapters

Pact Client adapts external frameworks. The adapter layer should understand the
real configuration shape and operational expectations of each first-class target:
OpenClaw, Claude Code, Codex, Gemini CLI, Antigravity, OpenCode, Copilot,
Kilo Code, Cursor, Hermes Agent, and Windsurf.

This target set is already decided and must not be reopened as a P0 scope
question. New targets require an explicit implementation decision and verifier
updates.

Rules:

- Adapters produce target-native configuration, not generic fake labels.
- Show the fields the target actually needs, such as MCP URL, transport,
  headers, environment variable references, config path, VM endpoint, reload
  requirement, CLI command, and token reference.
- Do not invent generic permission labels unless they map to real target
  configuration or a real target-native user decision.
- Use the target official CLI when it exists and is scriptable. Otherwise use a
  structured parser/writer for the target config file.
- OpenCode support must use the real remote MCP shape: `url`,
  `headers.X-Pact-Api-Key`, and `enabled`.
- Only modify Pact-managed blocks or fields. Preserve unrelated user config,
  third-party MCP entries, API keys, tokens, comments where the parser supports
  them, and ordering where practical.

Adapter updates should be protocol-first. The server may publish target adapter
capabilities, field definitions, compatibility metadata, and safe configuration
recipes that the client can consume. When a target requires new local code,
parser support, binary probing behavior, or platform integration that cannot be
expressed safely through the adapter protocol, Pact should ship a new client
version. Server-driven client update delivery is the normal way to roll out
those local adapter changes.

## 6. Discovery Boundary

Discovery must be useful and conservative.

Rules:

- Scan only known, common locations: system binary directories, common package
  manager paths, known app config directories, known agent config files, and
  common VM/container agent locations.
- Do not start GUI apps during scanning.
- Do not trigger login prompts, keychain prompts, or agent authorization
  dialogs during passive discovery.
- Do not perform broad home-directory crawling.
- Probe binaries only enough to identify supported commands, such as a help or
  version command.
- Provide manual add flows. Users can add a binary path, config path, or choose
  a file through the native file browser.
- Manual entries are first-class and should be tracked with the same snapshot,
  conflict, and activity records as discovered entries.

## 7. Thin Model Forwarding

The model configuration in Pact Client exists to forward requests, not to build
another agent framework.

Allowed behavior:

- Forward a user request to Pact MCP, Pact Server MCP, or a user-configured
  local agent command.
- Reuse server scripts and MCP plugin capabilities instead of implementing
  duplicated client business logic.
- Invoke a local agent in a thin form such as passing text to a supported
  command interface.
- Display the returned result and activity record.

Disallowed behavior:

- No self-owned agent loop.
- No planner, tool chooser, hidden scratchpad, long-running autonomous worker,
  or local tool execution chain.
- No client-side business implementation that should live in a server script,
  MCP plugin, or Skill.

## 8. Pact MCP Plugin Lifecycle

Pact Client may include Pact MCP as a default plugin, but it must manage it with
the same lifecycle model used for external agent MCP plugins.

Rules:

- Plugin update, rollback, version check, repair request, and status display
  should be thin actions over the same MCP or server capability available to
  external agents.
- The UI may expose buttons for these actions, but must not introduce a private
  heavy upgrade framework.
- If Pact MCP is missing or broken, the normal recovery path is the independent
  release package or connector. The client should guide the user to that path
  instead of becoming a special offline bootstrapper.
- Version and compatibility should be visible, but the client should not become
  a hidden package manager for arbitrary runtimes.

## 9. Passive Skill Hub

Pact Client is a passive Skill Hub. It stores Skills, exposes metadata and
packages to permitted agents, and lets users manage local visibility.

Rules:

- The Skill schema, protocol fields, and versioning are owned by the server
  Skill management protocol.
- The client must not invent a separate client-only Skill manifest format.
- The protocol version used by client and server must be explicit. The server
  is responsible for compatibility with multiple client versions.
- Unknown compatible fields should be preserved where practical.
- The client can list, download, delete, refresh, hide, reveal, pin, and expose
  Skills.
- The client does not execute Skills.
- The client does not install dependencies.
- The client does not copy Skills into an agent workspace.
- The client does not manage remote `scp`, container transfer, workspace
  copying, or directory permissions.
- Until the Skill Hub, server Skill Registry, and MCP Skill Hub protocol is
  designed, protocol-dependent operations must return `protocol_deferred`
  instead of pretending the three-party protocol is complete.

Agents may copy, execute, or move a Skill after they retrieve it. That is outside
the client boundary.

The Skill Hub retrieval interface is local-only and CLI-based. The client should
not expose a general HTTP endpoint or MCP endpoint for arbitrary Skill Hub
access. Supported agents retrieve from the Hub through a local command-line
entrypoint such as `pact-client skill ...`, with target adapters writing the
target-native command or reference shape needed by each agent. This keeps the
Hub passive, auditable, and limited to the user's machine.

## 10. Skill Integrity

Skill distribution integrity is mandatory.

Cloud-hosted Skills:

- Must be verified before they enter the local Skill Hub.
- Must satisfy the server protocol's required integrity fields.
- Must fail closed when hash, signature, source, version, or protocol checks
  fail.
- Must not be shown as usable or exposed to agents when verification fails.

Local Skills:

- May be marked as local.
- Must still receive a local hash and metadata record.
- Version or content changes are recorded and remain traceable.
- Local changes do not block usage by default, but they must be visible and
  reversible through history records.

## 11. Skill Visibility And Pinning

Hub visibility is not runtime approval. It only controls whether Pact Client
will show or return a Skill to a given agent in the future.

Rules:

- Skill retrieval requires an agent pairing record. Installing Pact MCP or a
  supported target adapter should make the agent discoverable, but the user must
  pair it in the client UI before it can retrieve Skills from the Hub.
- Pairing records bind a concrete agent target to the local Hub, including the
  target kind, label, config path or binary path, generated local identity, and
  the time/user action that approved the pairing.
- Default policy after pairing is allow-all. Paired agents can see and retrieve
  available Skills by default.
- Users can hide a Skill from a specific agent.
- Users can hide a specific Skill version from a specific agent.
- Visibility revocation is prospective only. If an agent already copied,
  cached, installed, or transferred a Skill, the client does not track, delete,
  or revoke that copy.
- Cleanup of already copied Skills is a user or target-agent responsibility.
- The Skill Hub must support multiple versions of the same Skill.
- Agents can request `latest` or a specific version.
- Users can pin a specific Skill version for a specific agent.
- Integrity metadata is version-specific.
- Deleting a version should warn when a target is pinned to that version.

Pairing is a Hub access control boundary, not runtime permission approval. A
paired agent may retrieve a Skill from the local Hub according to visibility and
pinning rules. Any later copy, execution, remote transfer, or permission prompt
belongs to that agent runtime and its user-facing approval system.

Unpaired agents:

- May be detected and displayed as installable or configurable targets.
- May have Pact MCP configuration prepared or repaired.
- Must not receive Skill package contents or usable Skill references from
  `pact-client skill ...`.
- Should receive a machine-readable "pairing required" response from the CLI so
  the target adapter can surface the correct next action to the user.

## 12. Configuration Snapshots And Rollback

Every write to a target agent configuration must be recoverable.

Rules:

- Before writing, record file metadata, content hash, parsed configuration tree,
  and a snapshot of the original content.
- The write must be atomic where the platform permits it.
- A failed write must not leave a partial configuration.
- Record the intended patch scope and before/after summary.
- Preserve unrelated fields.
- Provide rollback for each write.
- Rollback must apply to the recorded snapshot and target path, not to a broad
  guessed config area.

## 13. Field-Level Conflict Handling

Pact Client must not silently overwrite external edits.

Save flow:

1. Read target config and record `mtime`, size, content hash, and parsed tree.
2. Build a structured patch against the parsed tree.
3. Immediately before writing, read and parse the file again.
4. If metadata and hash match, snapshot and write.
5. If they differ, stop automatic write and show field-level conflict cards.

Conflict UI:

- Show conflicts as parsed tree paths, not only whole-file text.
- Each field card can choose a different action, such as keep external value,
  apply Pact value, skip this field, or use an explainable merge result.
- Duplicate fields or duplicate MCP entries should be listed explicitly.
- If the file cannot be parsed structurally, fall back to a whole-file warning
  and default to no overwrite.
- The final confirmed write still creates a snapshot first.

## 14. Permission Delegation

The client does not own runtime execution permissions.

Rules:

- Whoever executes the tool owns runtime approval.
- If Codex executes a Skill, Codex owns the approval prompt.
- If OpenClaw executes a Skill, OpenClaw owns the approval prompt.
- If Antigravity executes a Skill, Antigravity owns the approval prompt.
- Pact Client may control future Skill visibility at the Hub boundary, but it
  does not approve a runtime tool call.

This avoids fake safety labels and false security UX. Pact Client should show
real target-specific configuration facts rather than pretending to be a
universal permission system.

## 15. Activity Log

Every meaningful client-side action must be recorded.

Record at least:

- Discovery results and manual target additions.
- Agent pairing requests, approvals, denials, revocations, and pairing identity
  changes.
- Configuration snapshots and writes.
- Field-level conflict decisions.
- Rollbacks.
- MCP plugin installs, updates, version checks, and rollback triggers.
- Skill downloads, verification results, deletes, refreshes, visibility
  changes, and version pins.
- Model forwarding requests and target endpoint summaries.
- Errors, failed verifications, failed writes, and user cancellations.

The activity log is local operational history. It is not a runtime permission
ledger and not a record of what an agent did after it took a Skill.

## 16. Refactor Rule

During implementation, prefer deletion or migration over preserving removed
client weight.

Use this decision rule:

1. If an existing feature is visual configuration, target discovery, Skill Hub
   storage, integrity verification, snapshot/rollback, conflict resolution, or
   thin forwarding, it may stay in the main client.
2. If an existing feature is a reusable capability but requires business
   execution, move it to a Skill, MCP plugin, or server script.
3. If an existing feature needs a heavy local daemon, custom business API,
   agent harness, or client-owned analysis runtime, remove it from the main
   client unless a new explicit design decision reclassifies it.
4. If a removed feature is reintroduced, it must first have a new explicit
   design decision and a verifier that keeps it inside the current architecture.
