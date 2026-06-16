# ADR 0010: Seven Stable MCP Outlets

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Accepted
- Scope: Stable public MCP outlet naming and legacy outlet retirement.
- Staleness check: Checked against current consolidated docs layout and referenced implementation evidence on 2026-06-16.

## Status
Accepted

Pact's public MCP surface will use seven stable outlets: `pact.discovery`, `pact.agentLibrary`, `pact.sharedspace`, `pact.codespace`, `pact.skillHub`, `pact.agentRelay`, and `pact.serviceHub`. The previous `pact.knowledge` outlet will not be kept as a compatibility alias because the product capability has moved from a knowledge-base mental model to AgentLibrary asset governance, and keeping both names would split agent behavior, documentation, and production verification.

The implementation may continue to use internal `knowledge.*` operation ids and `v0.0.1:knowledge:core-1` mount contracts during migration, but MCP clients must route through `pact.agentLibrary`. Completion of this migration requires removing the old MCP outlet implementation and making connector, doctor, tests, and documentation fail or prompt reinstall when `pact.knowledge` is used.
