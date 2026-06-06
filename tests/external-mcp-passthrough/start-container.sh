#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONTAINER_ENGINE="${CONTAINER_ENGINE:-}"
if [ -z "$CONTAINER_ENGINE" ]; then
  if command -v docker >/dev/null 2>&1; then
    CONTAINER_ENGINE=docker
  elif command -v podman >/dev/null 2>&1; then
    CONTAINER_ENGINE=podman
  else
    printf 'No container engine found. Set CONTAINER_ENGINE=docker or CONTAINER_ENGINE=podman.\n' >&2
    exit 1
  fi
fi
IMAGE_TAG="${IMAGE_TAG:-pact-external-mcp-fixture-fastmcp:verify}"
CONTAINER_NAME="${CONTAINER_NAME:-pact-external-mcp-fixture-fastmcp}"
HOST_PORT="${HOST_PORT:-8787}"

"$CONTAINER_ENGINE" build -t "$IMAGE_TAG" "$SCRIPT_DIR"
"$CONTAINER_ENGINE" rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
"$CONTAINER_ENGINE" run \
  -d \
  --rm \
  --name "$CONTAINER_NAME" \
  -p "127.0.0.1:${HOST_PORT}:8787" \
  "$IMAGE_TAG"

printf 'External MCP fixture service: http://127.0.0.1:%s/mcp/\n' "$HOST_PORT"
