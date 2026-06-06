# External HTTP/RPC to Pact MCP Mapping

## Canonical target

Pact wraps external services as tool calls:

```json
{
  "operationId": "lookup",
  "input": {},
  "result": {}
}
```

The external service can be REST, OpenAPI, custom JSON, or RPC. Pact compiles it into Tool Management and exposes it as MCP tools.

## OpenAPI

Use when the service publishes an OpenAPI spec.

```json
{
  "upstream": {
    "type": "openapi",
    "baseUrl": "http://127.0.0.1:8788",
    "spec": {}
  },
  "binding": { "mode": "compile", "outlet": "pact.skillHub" }
}
```

Rules:

- `baseUrl` must include an explicit port.
- Each OpenAPI operation with `operationId` becomes a tool.
- Path/query/body parameters become tool input schema.

## REST without OpenAPI

Use method/path mapping.

```json
{
  "upstream": { "type": "http", "url": "http://127.0.0.1:8788" },
  "tools": [
    {
      "operationId": "search",
      "transport": { "type": "http", "method": "POST", "path": "/search" },
      "inputSchema": { "type": "object" }
    }
  ]
}
```

Rules:

- Path variables use `{name}` or `:name`.
- GET/DELETE inputs become query params unless `request.query` is declared.
- POST/PUT/PATCH inputs become JSON body unless `request.body` is declared.

## Custom JSON endpoint

Use when the service has one endpoint with a custom envelope.

```json
{
  "upstream": { "type": "http", "url": "http://127.0.0.1:8788" },
  "tools": [
    {
      "operationId": "classify",
      "transport": { "type": "http", "method": "POST", "path": "/gateway" },
      "request": {
        "body": { "action": "classify", "payload": "$input" }
      },
      "response": { "resultPath": "result" },
      "inputSchema": { "type": "object" }
    }
  ]
}
```

## RPC

Use RPC when the upstream has method/params semantics or when choosing the most compatible contract for a new wrapper.

```json
{
  "upstream": {
    "type": "rpc",
    "protocol": "json-rpc-2.0",
    "url": "http://127.0.0.1:8788",
    "endpoints": {
      "primary": { "path": "/gateway/invoke" },
      "v2": { "path": "/gateway/v2/invoke", "protocol": "json-rpc-2.0" }
    }
  },
  "tools": [
    {
      "operationId": "lookup",
      "rpc": {
        "endpointRef": "primary",
        "method": "lookup",
        "params": "$input",
        "resultPath": "result"
      },
      "inputSchema": { "type": "object" }
    }
  ]
}
```

Rules:

- Pact does not default to `/rpc`.
- The endpoint path must be explicit in `upstream.url`, `upstream.path`, `upstream.rpcPath`, `upstream.endpoints`, `tools[].rpc.url`, or `tools[].rpc.path`.
- Different tools can use different `endpointRef` values.
- `tools[].rpc.url` overrides service-level endpoint routing for that tool.

## Security fields

Every config should declare:

```json
{
  "binding": {
    "mode": "compile",
    "outlet": "pact.skillHub",
    "requiredScopes": ["knowledge:read"],
    "risk": "read_only"
  }
}
```

Choose `risk` conservatively:

- `read_only`: query and inspection only.
- `safe_write`: reversible or low-risk writes.
- `repair_write`: corrective writes.
- `destructive`: deletion, irreversible changes, external side effects.

## Pact API registration

To register through a running Pact service, post the generated config text to:

```text
POST /api/external-services/config
```

Payload:

```json
{
  "configText": "{...serialized pact.external-service.config...}"
}
```

Then refresh the compiled external tools:

```text
POST /api/external-services/refresh
```

Payload:

```json
{
  "serviceId": "service-id"
}
```

Write operations require the safety confirmation header:

```text
x-pact-safety-confirm: true
```

Authenticated consoles may also require `Authorization`, CSRF, or cookie headers from the active operator session.

## Verification

A wrapper is not valid until:

- Pact saves the external service config.
- runtime refresh compiles tools.
- Tool Management catalog contains the expected `pact.externalHttp.*` or `pact.externalRpc.*` ids.
- At least one tool executes against the real upstream service.
