# Pact MCP Release Install

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: Pact MCP Release Install.
- Staleness check: Scanned on 2026-06-14; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

[中文安装说明](MCP_INSTALL.zh-CN.md)

Pact MCP is distributed as a GitHub Release connector package. A normal
user does not need to clone the Pact repository. If Node.js 20+ is already
installed, the one-command installer uses the small source package; if Node.js is
missing, it falls back to the portable package with its own runtime.

## One Command

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

A localized Chinese installer script is also published:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)"
```

The command downloads the latest connector from GitHub Releases, verifies its
SHA256 checksum, installs the connector under `~/.pact/mcp/connector`,
and opens a multi-select TUI. On machines with Node.js 20+, this is the small
source tarball. On machines without Node.js, the script downloads the larger
portable zip that bundles Node.

The installer does not assume an IP address. Before it writes any agent config,
it scans local Pact candidates, fetches MCP discovery, and verifies the
`/api/mcp/handshake` Ed25519 signature for the discovered server identity.
After a server is verified, the installer requests a local Tool Management grant
from Pact and writes that token into the selected client configuration.
Users do not need to copy `PACT_MCP_TOKEN` during normal install.

## Separate Client Runtime Package

The MCP connector must not assume that a full Pact client already exists on the
machine. The connector remains a minimal bootstrapper: after discovery,
handshake, and grant pairing, it can ask the verified Pact server for a client
runtime plan.

The current desktop client is packaged separately as the `future-client` bundle
from `client-gui/packaging.modules.json`. It contains the Flutter shell, Rust
`pact-client` sidecar, target adapters, MCP plugin lifecycle, passive Skill Hub,
model forwarding, mobile relay, activity/snapshots, and settings. The root npm
server package does not ship `client-cli/` or `client-gui/`.

These client runtime capabilities are TODO placeholders, not shipped features:
`clientd`, upload queue, `mcp-local-bridge`, local data connectors, local
knowledge cache, and client-side mail import runtime.

Protocol entry points:

```text
HTTP POST /api/client-runtime/bootstrap/plan
HTTP POST /api/client-runtime/bootstrap/pull
RPC  client_runtime.bootstrap.plan
RPC  client_runtime.bootstrap.pull
MCP  pact.clientRuntime.bootstrapPlan
MCP  pact.clientRuntime.bootstrapPull
```

The first implementation may return only an inline manifest bundle and must not
fake binary download URLs. Release/package publishing later fills real artifact
URLs. The connector must verify each artifact digest and signature before
enabling the runtime. Until the TODO local bridge/upload queue exists, large
file and directory uploads must continue to use authenticated HTTP upload
session/checkpoint APIs rather than a local stdio bridge or
`pact-client upload enqueue`.

In the TUI:

- Use Up/Down or `j`/`k` to move.
- Press Space to select or clear a client.
- Press `a` to select or clear all detected clients.
- Press Enter to install the selected clients.
- Press `q` to cancel.

After installation, the connector prints a concise install report with the
verified MCP URL, selected clients, per-client success or failure, token source,
and verification status. It does not dump client configuration files. Use
`--json` only when a script needs machine-readable details.

Supported targets are OpenClaw (`openclaw`), Claude Code (`claude-code`),
Codex (`codex`), Antigravity (`antigravity`),
OpenCode (`opencode`), Copilot (`copilot`), Kilo Code (`kilo-code`),
OpenClaw-compatible OrbStack agents such as IronClaw or ZeroClaw are discovered
through the same Claw-compatible scan.

## Options

Use an explicit Pact server URL only when automatic discovery cannot find
the intended service. The explicit URL still must pass signed handshake
verification:

```bash
PACT_MCP_BASE_URL=http://<host>:<port> \
  /bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

Use a custom local install directory:

```bash
PACT_MCP_INSTALL_DIR="$HOME/.local/share/pact-mcp" \
  /bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

Pass connector install flags after the shell command:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --no-verify
```

Unattended agent shells can use automatic detection directly:

```bash
~/.pact/mcp/connector/current/pact-mcp install --target auto --json
```

`auto` installs every supported client the connector can verify. A
non-interactive `pact-mcp install` without `--target` uses the same
auto-detected path. Use `--target claude-code,codex,openclaw --json` only when a
script must intentionally limit the install scope to the priority agent clients first.

For an agent that needs one copyable GitHub Release command, use the unattended
auto target form. This covers OpenClaw, Claude Code, Codex,
Antigravity, OpenCode, Copilot, Kilo Code, Cursor, Hermes Agent, and
every other supported client that the connector can verify:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --target auto --json
```

For a known single client, replace `<client>` with any supported target, for
example `openclaw`, `claude-code`, `codex`, `antigravity`, `opencode`,
`copilot`, `kilo-code`, `cursor`, or `hermes`:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --target <client> --json
```

To prioritize Claude Code, Codex, and OpenClaw in one unattended pass:

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)" -- --target claude-code,codex,openclaw --json
```

Manage local server address profiles:

```bash
~/.pact/mcp/connector/current/pact-mcp server-config --set --url http://<host>:<port> --name local
~/.pact/mcp/connector/current/pact-mcp server-config --switch local
~/.pact/mcp/connector/current/pact-mcp server-config --refresh
~/.pact/mcp/connector/current/pact-mcp server-config --reset
```

`--reset` clears the local connector server address config. The next install will
scan again and, if no signed Pact service is found, offer
`skip, manually configure later`.

## Manual Portable Install

Download `pact-mcp-connector-<version>-<platform>.zip` from GitHub
Releases, unzip it, then run:

```bash
./pact-mcp install
```

The zip bundles its own Node.js runtime.

## Verify

```bash
~/.pact/mcp/connector/current/pact-mcp doctor
```

`doctor` can verify discovery without a token. To verify authenticated
`tools/list` and `tools/call`, use the token that was written for a client or
pass a pre-issued custom grant:

```bash
PACT_MCP_TOKEN='<issued-token>' \
  ~/.pact/mcp/connector/current/pact-mcp doctor
```
