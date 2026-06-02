---
name: pact-agent-tool-platform
description: Use when configuring or calling Pact Tool Management v1 catalog, toolsets, grants, policy preview/evaluate, bearer tokens, audit, metrics, or knowledge/skill tool execution through /api/tool-management/v1.
---

# Pact Agent Tool Platform

## Purpose

Expose Pact tools to agents and external callers through the Tool Management v1 platform with catalog, toolset, grant, profile, policy, audit, and metrics controls. In current Pact, Tool Management v1 is the only tool boundary; legacy `/api/tool-platform/*` and `/api/agent-tools/*` routes are expected to be unavailable.

## Workflow

1. Read `references/agent-tool-platform-map.md`.
2. Choose the minimum toolset and scope set required.
3. Use `/api/tool-management/v1/policy/preview` before issuing broad grants.
4. Create, rotate, or revoke grants through `/api/tool-management/v1/grants*`, the server Console, or `pact tools grants ...`.
5. Call tools through `/api/tool-management/v1/execute`, `/batch`, or `/dry-run` with bearer token or `x-pact-tool-token`.
6. Do not use grant tokens against Console-only `/api/knowledge/*` routes; use the matching `pact.knowledge.*` tool id through Tool Management.
7. Check `/api/tool-management/v1/audit`, `/audit/:toolExecutionId`, and `/api/tool-management/v1/metrics/summary` after testing.

Do not paste grant tokens into project docs or logs.
