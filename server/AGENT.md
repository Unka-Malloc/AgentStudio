# Server Agent Entry

## Scope

- Owns the Node.js control plane, runtime services, policy/governance flows,
  protocol adapters, server scripts, and server-side verification gates.
- Keep server changes inside `server/` and directly related `tests/server/`
  files unless the task explicitly crosses into a client or documentation
  contract.

## First Reads

- Start with root `AGENT.md`, then this file.
- Use `server/platform/README.md` for platform module layout.
- Use `server/protocols/README.md` for protocol registration and boundary work.
- Use `docs/functionality/SERVER-RUNTIME.md` only for startup, runtime, mounts, packaging, or
  operational behavior.

## Directory Routing

- `server/config/`: environment and server configuration loading.
- `server/platform/`: platform capabilities, modules, storage, knowledge,
  operations, and shared runtime services.
- `server/protocols/`: protocol-facing boundaries and adapters.
- `server/scripts/`: CLI entry points, verifiers, startup, migration, and
  operational scripts.
- `server/services/`: service-level composition and long-running behavior.

## Verification

- Prefer the narrowest `server:verify:*` script that matches the changed area.
- Use `rg -n "server:verify:<topic>" package.json` to find a script instead of
  reading the full script list.
- Run full `npm run server:verify` only for release/readiness integration work.

## Context Budget

- Avoid generated runtime downloads and local data directories.
- Do not expand `build/`, `node_modules/`, Tika/JRE/OCR runtime payloads, or
  large history reports unless the failing command points there.
