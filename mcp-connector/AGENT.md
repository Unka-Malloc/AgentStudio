# MCP Connector Agent Entry

## Scope

- Owns the local MCP connector package under `mcp-connector/`.
- Keep connector changes inside this directory unless install docs, server MCP
  discovery, or release packaging must be updated together.

## First Reads

- Start with root `AGENT.md`, then this file.
- Read `mcp-connector/README.md` for user-facing install and registration
  behavior.
- Inspect `mcp-connector/package.json` for connector package metadata.
- Inspect `mcp-connector/bin/pact-mcp.mjs` for CLI behavior.
- Use `docs/MCP_INSTALL.md` only for install workflow or troubleshooting docs.

## Directory Routing

- `mcp-connector/bin/`: executable connector entry points.
- `mcp-connector/package.json`: package metadata, bin mapping, and release
  surface.
- `docs/MCP_INSTALL*.md`: maintained install guidance shared with users.

## Verification

- Prefer `npm run mcp:doctor`, `npm run mcp:discover-local`, or a specific MCP
  verifier when the changed path maps to one of those flows.
- For server-side MCP discovery changes, coordinate with the server worktree
  instead of changing both worktrees independently.

## Context Budget

- Avoid reading server MCP internals until the connector boundary requires it.
- Keep install docs and connector behavior aligned, but do not load unrelated
  operational docs by default.
