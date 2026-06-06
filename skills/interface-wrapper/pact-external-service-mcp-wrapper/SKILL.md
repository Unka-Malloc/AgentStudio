---
name: pact-external-service-mcp-wrapper
description: Use when wrapping any external HTTP, REST, OpenAPI, JSON endpoint, or RPC service into a Pact external service config that registers on Pact's upstream API aspect and can be exposed as a standard MCP tool service.
---

# Pact External Service MCP Wrapper

Use this skill to convert an arbitrary external HTTP/RPC service into Pact-managed tools and then expose those tools through Pact's MCP boundary.

## Core decision

Prefer RPC as Pact's canonical intermediate shape:

```text
external service -> Pact external-service config -> Pact Tool Management -> MCP tools/list + tools/call
```

Do not require the upstream service to implement MCP. Do not modify the upstream service unless the user explicitly asks for that. Wrap it through configuration.

## Workflow

1. Identify the upstream service contract:
   - OpenAPI available: use `upstream.type = "openapi"`.
   - Canonical method/params endpoint: use `upstream.type = "rpc"`.
   - REST paths without OpenAPI: use `upstream.type = "http"` with `tools[].transport`.
   - Single JSON endpoint: use `upstream.type = "http"` with `request.body` and `response.resultPath`.

2. Require explicit endpoints:
   - HTTP/RPC URLs must include a port.
   - RPC must not assume `/rpc`; use `upstream.url` with a path, `upstream.path`, `upstream.rpcPath`, or `tools[].rpc.endpointRef/path/url`.
   - For multiple RPC versions or gateway paths, declare `upstream.endpoints` and point tools to `rpc.endpointRef`.

3. Convert each desired function into a Pact tool:
   - stable `operationId`
   - JSON `inputSchema`
   - read/write risk: `read_only`, `safe_write`, `repair_write`, or `destructive`
   - required scopes
   - request mapping and response result path

4. Generate or register config:
   - Use `scripts/pact-wrap-external-service.mjs` for deterministic config generation.
   - Save through Pact external service registry when `--save --user-data-path <path>` is provided.
   - Save through a running Pact API gateway when `--save --api-url <url>` is provided.
   - Refresh Tool Management so `pact.externalHttp.*` or `pact.externalRpc.*` appears in the catalog.

5. Verify with real service execution:
   - Prefer container verification when possible.
   - If no container runtime is available, start a local real service and run the same registration/execution path.
   - Do not claim MCP compatibility until a tool appears in Tool Management and executes successfully.

## Script

Generate a config from a descriptor:

```bash
node skills/interface-wrapper/pact-external-service-mcp-wrapper/scripts/pact-wrap-external-service.mjs \
  --input service-descriptor.json \
  --output external-service.config.json
```

Register directly into a Pact data dir:

```bash
node skills/interface-wrapper/pact-external-service-mcp-wrapper/scripts/pact-wrap-external-service.mjs \
  --input service-descriptor.json \
  --save \
  --user-data-path /path/to/pact-data
```

Register through a running Pact API service:

```bash
node skills/interface-wrapper/pact-external-service-mcp-wrapper/scripts/pact-wrap-external-service.mjs \
  --input service-descriptor.json \
  --save \
  --api-url http://127.0.0.1:7228
```

Use `--token`, `--authorization`, `--csrf`, or `--cookie` when the console API requires an authenticated session. API registration posts to `/api/external-services/config` and refreshes `/api/external-services/refresh` unless `--no-refresh` is set.

Read `references/mapping-contract.md` when deciding the exact mapping shape. Use templates from `assets/` when the user provides only partial service information.
