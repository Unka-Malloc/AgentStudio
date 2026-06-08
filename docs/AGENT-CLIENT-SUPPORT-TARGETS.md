# Agent Client Support Targets

## Metadata / 元数据

- Last updated: 2026-06-08
- Status: Current maintained document
- Scope: Agent Client Support Targets.
- Staleness check: Scanned on 2026-06-08; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

**Status:** Decided  

Pact's first-class agent client support targets are fixed:

1. OpenClaw (`openclaw`)
2. Claude Code (`claude-code`)
3. Codex (`codex`)
4. Gemini CLI (`gemini-cli`)
5. Antigravity (`antigravity`)
6. OpenCode (`opencode`)
7. Copilot (`copilot`)
8. Kilo Code (`kilo-code`)
9. Cursor (`cursor`)
10. Hermes Agent (`hermes`)
11. Windsurf (`windsurf`)

This target set applies to the desktop client target adapters, the downstream client aspect MCP/ACP adapter catalog, `pact-mcp-connector`, server MCP discovery metadata, local grant profile matching, install/uninstall support, docs, and verifier gates. Do not reopen target scope as a P0 question; add new targets through an explicit implementation decision and update `server:verify:agent-client-support-targets`.

For platform-mediated agent-to-agent delegation through ACP, see `docs/ACP-AGENT-RELAY-DESIGN.md`. The downstream client aspect keeps MCP and ACP in separate adapter layers: MCP remains agent-to-Pact compatibility, while ACP is the agent-to-agent relay path. The aspect translates inbound protocol traffic to MCP Server Side / Tool Management or ACP Agent Relay; it does not execute either path directly.
