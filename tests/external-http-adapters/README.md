# External HTTP Adapter Verification Bundle

This bundle verifies that Pact can register and execute external HTTP services compiled into Tool Management tools.

It covers four adapter shapes:

- OpenAPI service: Pact compiles an OpenAPI operation into a tool.
- REST service: Pact uses an explicit method/path tool mapping.
- JSON endpoint service: Pact uses an explicit request envelope and response result path.
- RPC service: Pact uses `upstream.type=rpc` and a canonical `rpc.method + params + resultPath` mapping.

RPC endpoints must declare their path explicitly. Pact does not default to `/rpc`; use `upstream.url` with a path, `upstream.path`, `upstream.rpcPath`, or `tools[].rpc.path`.

One RPC service can also declare multiple endpoints and let each tool choose one:

```json
{
  "upstream": {
    "type": "rpc",
    "url": "http://127.0.0.1:8788",
    "endpoints": {
      "primary": { "path": "/gateway/invoke" },
      "v2": { "path": "/gateway/v2/invoke", "protocol": "json-rpc-2.0" }
    }
  },
  "tools": [
    { "operationId": "lookup", "rpc": { "endpointRef": "primary", "method": "lookup" } },
    { "operationId": "lookupV2", "rpc": { "endpointRef": "v2", "method": "lookupV2" } }
  ]
}
```

Files:

- `Dockerfile`: builds the fixture HTTP upstream service.
- `server.mjs`: fixture HTTP upstream with OpenAPI, REST, JSON endpoint, and JSON-RPC routes.
- `start.sh`: container entrypoint.
- `start-container.sh`: manual container build and run script.
- `start-docker.sh`: Docker compatibility wrapper for `start-container.sh`.
- `verify.mjs`: end-to-end verification script.
- `../external-service-env-probe.mjs`: selects `container` or `local` verification mode.

Run the full verification:

```bash
npm run server:verify:external-http-adapters
```

By default the verification uses `PACT_EXTERNAL_SERVICE_VERIFY_MODE=auto`: container runtime first, local runtime second. Use `PACT_EXTERNAL_SERVICE_VERIFY_MODE=container` to require a container runtime, or `PACT_EXTERNAL_SERVICE_VERIFY_MODE=local` to force local Node execution. `docker` is accepted as a compatibility alias for `container`.

Start the fixture service manually:

```bash
tests/external-http-adapters/start-container.sh
```

The manual script accepts `CONTAINER_ENGINE`, `IMAGE_TAG`, `CONTAINER_NAME`, and `HOST_PORT` environment overrides. By default it uses Docker and exposes the fixture service at `http://127.0.0.1:8788`.
