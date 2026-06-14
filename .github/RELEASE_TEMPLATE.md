# Pact v<VERSION>

<brief summary of the primary focus or theme of this release>

## Highlights

- **[Feature/Fix Name]:** [Brief description of the impact or what changed]
- **[Feature/Fix Name]:** [Brief description of the impact or what changed]

## Quick Install

### Docker (Server + Web Console)

```bash
docker pull ghcr.io/unka-malloc/pact:<VERSION>
docker compose up -d
```

### MCP Connector (Agent Integration)

Automatically detects your OS and architecture:

```bash
/bin/sh -c "$(curl -fsSL https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

## Release Assets

| Asset | Description |
| --- | --- |
| `pact-mcp-connector-<VERSION>-macos-arm64.tar.gz` | MCP Connector for macOS Apple Silicon |
| `pact-mcp-connector-<VERSION>-macos-arm64.zip` | MCP Connector for macOS Apple Silicon (zip) |
| `pact-mcp-connector-<VERSION>-linux-x86_64.tar.gz` | MCP Connector for Linux x86_64 |
| `pact-mcp-connector-<VERSION>-linux-arm64.tar.gz` | MCP Connector for Linux ARM64 |
| `pact-mcp-connector-<VERSION>-linux-x86_64-musl.tar.gz` | MCP Connector for Alpine/musl Linux |
| `pact-mcp-install.sh` | Bootstrap installer script |
| `pact-mcp-uninstall.sh` | Uninstaller script |
| `pact-mcp-release.json` | Release manifest |
| `latest.json` | Latest version metadata |

## Uninstall

```bash
/bin/sh -c "$(curl -fsSL https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-uninstall.sh)"
```

## Supported Agents

OpenClaw, Claude Code, Codex, Antigravity, OpenCode, Copilot, Kilo Code, Cursor, Hermes Agent — and any other MCP-compatible agent.

---

[Full Changelog](https://github.com/Unka-Malloc/Pact/blob/main/CHANGELOG.md)
