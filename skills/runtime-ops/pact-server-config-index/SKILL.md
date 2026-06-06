---
name: pact-server-config-index
description: Use when explaining, documenting, or changing Pact server settings, environment variables, settings.json, mount config files, and server command line options.
---

# Pact Server Config Index

## Purpose

Provide the missing index between server code, persisted config files, environment variables, and UI controls.

## Workflow

1. Read `references/server-config-map.md`.
2. Confirm defaults in `server/platform/common/platform-core/settings.mjs`.
3. Confirm UI wiring in `server-web/ServerConsoleApp.vue` and `server-web/lib/bridge.ts`.
4. When adding a setting, update server defaults, API serialization, UI field, and docs together.

## Guardrail

Never expose API keys or OAuth tokens in generated docs or logs.
