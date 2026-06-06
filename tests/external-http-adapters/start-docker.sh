#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONTAINER_ENGINE=docker exec "$SCRIPT_DIR/start-container.sh"
