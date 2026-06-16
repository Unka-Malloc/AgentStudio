---
status: accepted
date: 2026-06-04
---

# Govern Agent-to-Agent ACP Delegation Through Pact

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Accepted ADR
- Scope: Govern Agent-to-Agent ACP Delegation Through Pact.
- Staleness check: Checked against current consolidated docs layout and referenced implementation evidence on 2026-06-16.

Pact will mediate agent-to-agent delegation by acting as an inbound ACP agent to the source agent and as an outbound ACP client to the concrete target agent. Pact will not be a raw ACP socket proxy: every relay turn remains governed by the Operation Scheduling Kernel, Capability Kernel, Tool Management, `/approval`, trace, audit, workspace governance, and global artifact lifecycle.

All downstream client-facing protocol adaptation belongs to the downstream client aspect. MCP and ACP framework adapter layers are part of that aspect, not a separate downstream agent gateway. The aspect owns client discovery/configuration, capability catalog projection, bootstrap manifest inputs, secretRef projection metadata, framework-specific adapter assembly, and protocol-to-platform route translation. MCP traffic is translated to MCP Server Side / Tool Management; ACP traffic is translated to ACP Agent Relay. The aspect does not execute either path directly.

Pact exposes multiple source-visible virtual inbound agents instead of one generic relay endpoint. Each virtual inbound agent advertises its own modes, default mode, modalities, data-source envelope, tool class, write policy, reasoning visibility policy, and target health, because different target profiles may represent materially different capabilities even when they resolve to the same concrete target.

Relay sessions are durable and wakeable. Pact owns source-facing session continuity; concrete targets may be reused, resumed, or rehydrated under current policy, but stale target state never preserves stale authority.

Phase 1 permits governed repository file writes through Pact-mediated `fs.writeTextFile` child operations with path policy, receipts, and approval. Phase 1 does not permit target terminal access, terminal-mediated writes, or approval override of the terminal deny.

Source agents receive progress-only updates by default. Target reasoning traces may be exposed only on explicit source request and allowed policy, through a separate event channel that is not merged into the source agent's default context.

Transcript retention uses Pact's global audit, redaction, trace, workspace governance, and artifact lifecycle mechanisms. ACP relay must not create relay-local raw transcript tables, retention config, export endpoints, or prune jobs.

Target-visible MCP access is a relay-scoped Tool Management projection. Target agents receive a separate relay delegation grant and Pact MCP proxy; they never receive the source agent's raw MCP configuration, tokens, local MCP commands, or upstream provider credentials.

Antigravity IDE CLI `1.107.0` remains `contract-mode` for this design until a native ACP stdio or stream transport is discovered and verified; `antigravity-ide chat` is not sufficient evidence of native ACP support.
