# External MCP Passthrough Verification Bundle

This bundle verifies that Pact can register an external MCP service through `pact.external-service.config`, discover upstream tools, compile them into Tool Management virtual operations, and forward calls through the external MCP passthrough runtime.

Files:

- `Dockerfile`: builds a fixture Python FastMCP HTTP service.
- `requirements.txt`: Python dependencies for the fixture service.
- `server.py`: fixture FastMCP server with test tools.
- `start.sh`: container entrypoint.
- `start-container.sh`: manual container build and run script.
- `start-docker.sh`: Docker compatibility wrapper for `start-container.sh`.
- `verify.mjs`: end-to-end verification script.
- `../external-service-env-probe.mjs`: selects `container` or `local` verification mode.

Run the full verification:

```bash
node tests/external-mcp-passthrough/verify.mjs
```

By default the verification uses `PACT_EXTERNAL_SERVICE_VERIFY_MODE=auto`: container runtime first, local Python venv second. Use `PACT_EXTERNAL_SERVICE_VERIFY_MODE=container` to require a container runtime, or `PACT_EXTERNAL_SERVICE_VERIFY_MODE=local` to force local FastMCP execution. `docker` is accepted as a compatibility alias for `container`.

Start the fixture service manually:

```bash
tests/external-mcp-passthrough/start-container.sh
```

The manual script accepts `CONTAINER_ENGINE`, `IMAGE_TAG`, `CONTAINER_NAME`, and `HOST_PORT` environment overrides. By default it uses Docker and exposes the MCP endpoint at `http://127.0.0.1:8787/mcp/`.

The verification script requires Docker and preserves this test bundle in the repository.
