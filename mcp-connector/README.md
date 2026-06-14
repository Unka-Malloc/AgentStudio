# Pact MCP Connector

Release-packaged installer for connecting local AI agents to a Pact MCP HTTP endpoint.

This package is the client-side connector only. It does not contain the Pact server.

## Install

One command from GitHub Release:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

This downloads the connector from GitHub Releases, verifies its checksum,
installs it under `~/.pact/mcp/connector`, then opens the multi-select TUI.
If Node.js 20+ is available, the installer uses the small source package. If
Node.js is missing, it falls back to the larger portable zip with an embedded
runtime.

The connector does not assume a default IP address. It scans local Pact
candidates, fetches MCP discovery, then verifies the `/api/mcp/handshake`
Ed25519 signature before using the endpoint.
For normal local installs, it also requests a Tool Management grant token from
the verified Pact service. Users do not need to manually copy
`PACT_MCP_TOKEN`.

For npm-based installs after the package is published:

```bash
npx pact-mcp-connector@latest register
```

This writes one local registry at `~/.pact/mcp/servers.json`. It does not mutate any agent client config.

For interactive multi-client install:

```bash
pact-mcp install
```

The interactive installer scans local clients and lets you choose one or more targets with the arrow keys and Space.
The default output is a human install report with per-client success or failure,
not a raw configuration dump. Use `--json` for scripts.

Supported targets are OpenClaw (`openclaw`), Claude Code (`claude-code`),
Codex (`codex`), Antigravity (`antigravity`),
OpenCode (`opencode`), Copilot (`copilot`), Kilo Code (`kilo-code`),
Cursor (`cursor`), and Hermes Agent (`hermes`).

For scripts and unattended agent shells:

```bash
npx pact-mcp-connector@latest install --target auto --json
```

`auto` installs every supported client that the connector can verify on this
machine or in a detected runtime context. A non-interactive `pact-mcp install`
with no `--target` uses the same auto-detected path.

For a known single client:

```bash
npx pact-mcp-connector@latest install --target <client> --json
```

Limit scope only when a script intentionally targets a known client set:

```bash
npx pact-mcp-connector@latest install --target claude-code,codex,openclaw --json
```

For a single copyable GitHub Release command in an unattended agent shell:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --target auto --json
```

For a known client, replace `<client>` with any supported target:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --target <client> --json
```

Priority clients can be installed in one unattended pass:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --target claude-code,codex,openclaw --json
```

Use `--token-stdin` only when installing with a pre-issued custom grant token.

## Server Config

Manage the local connector's server address profiles:

```bash
pact-mcp server-config --set --url http://<host>:<port> --name local
pact-mcp server-config --switch local
pact-mcp server-config --refresh
pact-mcp server-config --reset
pact-mcp server-config --list
```

`--set`, `--switch`, and `--refresh` verify the server's signed MCP handshake.
`--reset` clears the local server address config so future installs must discover
or configure a server again.

## Install Without Node.js

Use the portable zip release artifact instead of the npm package:

```bash
unzip pact-mcp-connector-<version>-<platform>.zip
cd pact-mcp-connector-<version>-<platform>
./pact-mcp install
```

For scripts:

```bash
./pact-mcp install --target auto --json
```

The portable zip package includes its own Node.js runtime. macOS users can open `install.command` and follow the prompts.

## Verify

```bash
PACT_MCP_TOKEN='<issued-token>' npx pact-mcp-connector@latest doctor
```

The token is only needed for authenticated doctor checks. Normal install issues
one automatically.

## Discover Local Hub

```bash
npx pact-mcp-connector@latest discover-local --json
```

Agents should use this command as the unified local discovery entrypoint.

## Scan Clients

```bash
npx pact-mcp-connector@latest scan --json
```

## Uninstall

```bash
npx pact-mcp-connector@latest uninstall --target claude-code,codex,openclaw
```

Non-interactive uninstall requires an explicit target list.

Supported targets: OpenClaw (`openclaw`), Claude Code (`claude-code`),
Codex (`codex`), Antigravity (`antigravity`),
OpenCode (`opencode`), Copilot (`copilot`), Kilo Code (`kilo-code`),
Cursor (`cursor`), and Hermes Agent (`hermes`).
