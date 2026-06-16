# MCP Gateway Installer Agent Entry

## Scope

- Owns the Pact Server MCP Gateway installer source under `server/platform/common/mcp/gateway-installer/`.
- Keep installer changes inside this directory unless install docs, server MCP
  discovery, or release packaging must be updated together.

## First Reads

- Start with root `AGENT.md`, then this file.
- Read `server/platform/common/mcp/gateway-installer/README.md` for user-facing install and registration
  behavior.
- Inspect `server/platform/common/mcp/gateway-installer/package.json` for connector package metadata.
- Inspect `server/platform/common/mcp/gateway-installer/bin/pact-mcp.mjs` for CLI behavior.
- Use `docs/USAGES.md` only for install workflow or troubleshooting docs.

## Directory Routing

- `bin/`: executable installer entry points.
- `server/platform/common/mcp/gateway-installer/package.json`: package metadata, bin mapping, and release
  surface.
- `docs/USAGES.md`: maintained install guidance shared with users.

## Verification

- Prefer `npm run mcp:doctor`, `npm run mcp:discover-local`, or a specific MCP
  verifier when the changed path maps to one of those flows.
- For server-side MCP discovery changes, coordinate with the server worktree
  instead of changing both worktrees independently.

## Context Budget

- Avoid reading server MCP internals until the connector boundary requires it.
- Keep install docs and connector behavior aligned, but do not load unrelated
  operational docs by default.
