# Pact

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: Pact.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

Pact is the governed collaboration context for agents, tools, workspaces, knowledge, and external capabilities. Its language emphasizes policy-mediated access, operation traceability, and auditable delegation.

## Language

**Source Agent**:
The ACP-capable agent that asks Pact to delegate work to another agent.
_Avoid_: requester, caller agent, main agent

**Target Agent**:
The agent that receives delegated work from Pact through a governed outbound connection.
_Avoid_: downstream bot, sub-agent

**Virtual Inbound Agent**:
A source-visible agent projection published by Pact that represents a target capability profile, including its modes, modalities, data-source envelope, tool class, and policy.
_Avoid_: generic relay endpoint, target alias

**Concrete Target**:
The actual local or remote agent runtime behind one or more virtual inbound agents.
_Avoid_: virtual agent, provider name

**Downstream Client Aspect**:
The client-facing aspect that owns agent framework MCP/ACP adapter layers, discovery/configuration projection, bootstrap manifest inputs, secretRef projection metadata, and protocol-to-platform route translation.
_Avoid_: downstream agent gateway, raw agent proxy

**Communication Service**:
The platform capability that owns ACP Relay and MCP Server Side as executable communication services reached through route policy and operation/security/audit gates.
_Avoid_: downstream adapter, raw socket proxy

**Relay Session**:
A durable Pact-owned session that preserves source-facing continuity for a selected virtual inbound agent.
_Avoid_: target session, chat window

**Relay Turn**:
One governed delegated prompt exchange inside a relay session.
_Avoid_: message, raw prompt

**Delegation Grant**:
The effective permission envelope Pact computes for a delegated relay turn or session.
_Avoid_: source token, target token

**Relay-Scoped Tool Projection**:
The tool catalog Pact exposes to a target agent for a relay turn or session after policy filtering.
_Avoid_: source MCP config, full tool environment
