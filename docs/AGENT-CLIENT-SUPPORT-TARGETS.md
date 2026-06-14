# Agent Client Support Targets

## Metadata / 元数据

- Last updated: 2026-06-13
- Status: Current maintained document
- Scope: Agent Client Support Targets.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

**Status:** Decided  

Pact's first-class agent client support targets are fixed:

1. OpenClaw (`openclaw`)
2. Claude Code (`claude-code`)
3. Codex (`codex`)
4. Antigravity (`antigravity`)
5. OpenCode (`opencode`)
6. Copilot (`copilot`)
7. Kilo Code (`kilo-code`)
8. Cursor (`cursor`)
9. Hermes Agent (`hermes`)

Gemini CLI (`gemini-cli`) and Windsurf (`windsurf`) are no longer maintained as Pact canonical agent client targets. Current installer, connector, downstream client aspect, and verifier scope must not expose them as fixed supported targets. A non-canonical agent that appears in an operator-approved ACP Registry manifest may still be imported as a registry ACP participant without reopening the canonical target set.

Every target in this set is a Pact Relay participant candidate in both directions: as an MCP client target for agent-to-Pact tool access, and as an ACP Relay source or target binding for agent-to-agent delegation through Pact. The downstream client aspect must therefore emit one MCP-layer record and one ACP/Relay-layer record for each canonical target. Existing ACP is always preferred: Pact must use the target's native ACP stdio command, official ACP adapter, or operator-approved ACP Registry distribution before considering any CLI fallback. "Participant" does not mean "native ACP verified": the descriptor must truthfully expose whether the route is native ACP stdio, a platform adapter, a registry-imported ACP distribution, a non-ACP fallback, disabled pending installation, or missing from the host.

Current ACP/Relay participant routes are:

| Target | ACP/Relay participant route | Default availability |
| --- | --- | --- |
| OpenClaw | Native `openclaw acp` stdio target | Enabled when an OpenClaw ACP command is discoverable |
| Claude Code | Official `claude-code-acp` stdio adapter, with `@zed-industries/claude-code-acp` install path | Enabled when the adapter is discoverable; installable otherwise |
| Codex | Native `codex-acp` stdio adapter, with governed `codex` CLI fallback when the native adapter is unavailable | Enabled when `codex-acp`, project-local `@zed-industries/codex-acp`, `npx`, or the fallback CLI is available |
| Antigravity | Antigravity Agent API proxy / Pact-owned wrapper path | Enabled through the Agent API proxy, not labeled native Antigravity ACP |
| OpenCode | Native `opencode acp` stdio target | Enabled when `opencode` is discoverable |
| Copilot | Native `copilot --acp` stdio target | Enabled when `copilot` is discoverable |
| Kilo Code | Native `kilo acp` stdio target | Enabled when `kilo` is discoverable |
| Cursor | Native `cursor agent acp` stdio target | Enabled when `cursor` is discoverable |
| Hermes Agent | Native `hermes acp` stdio target | Enabled when `hermes` is discoverable |

Managed CLI fallback remains available only for non-ACP or explicitly degraded targets. It must never replace an available ACP command or adapter, and source-facing descriptors must mark it as non-native (`nativeAcpTargetSupported=false`). Fallback participants remain under ACP Relay permissions, source identity isolation, operation scheduling, audit, redaction, and platform policy. Their default policy is read-only (`writes=deny`, `terminal=deny`, `maxRisk=read_only`), and source-facing descriptors must not expose launch command environment, tokens, CSRF values, or private adapter metadata.

This target set applies to the desktop client target adapters, the downstream client aspect MCP/ACP adapter catalog, `pact-mcp-connector`, server MCP discovery metadata, local grant profile matching, install/uninstall support, docs, and verifier gates. Do not reopen target scope as a P0 question; add new targets through an explicit implementation decision and update `server:verify:agent-client-support-targets`.

For platform-mediated agent-to-agent delegation through ACP, see `docs/ACP-AGENT-RELAY-DESIGN.md`. The downstream client aspect keeps MCP and ACP in separate adapter layers: MCP remains agent-to-Pact compatibility, while ACP is the agent-to-agent relay path. The aspect translates inbound protocol traffic to MCP Server Side / Tool Management or ACP Agent Relay; it does not execute either path directly.
