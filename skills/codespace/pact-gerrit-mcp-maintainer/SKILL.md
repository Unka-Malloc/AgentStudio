---
name: pact-gerrit-mcp-maintainer
description: Use when maintaining Pact Gerrit MCP compatibility, local Gerrit runtime, repo scopes/toolsets, Gerrit live verification, or code-review route release evidence.
---

# Pact Gerrit MCP Maintainer

## Purpose

Keep Gerrit as a durable Pact system-maintenance capability and compatibility component for agent-assisted project maintenance. This Skill covers the local Gerrit test runtime, MCP-facing Gerrit operations, repo-scoped Tool Management grants, audit verification, and release evidence.

Gerrit route and Workspace route are both retained. Code, patches, git diffs, and repository changes should prefer Gerrit review; knowledge material, reports, examples, and fallback proposals can stay in Workspace assets.

## Source Map

- Gerrit compatibility component: `server/platform/specialized/capabilities/code-review/gerrit/`
- Generic repo operation component: `server/platform/specialized/capabilities/code-repository/repo-operations/`
- Operation registration: `server/platform/common/operation-dispatcher/operation-registry.mjs`
- Tool catalog and repo scopes: `server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs`
- MCP local grants and risk gates: `server/platform/common/mcp/http-mcp-adapter.mjs`
- HTTP controller wiring: `server/platform/common/console/http/controllers/system-controller.mjs`
- Local runtime helper: `server/scripts/gerrit-local.mjs`
- Verifier: `server/scripts/verify-gerrit-mcp.mjs`

## Maintenance Workflow

1. Check local runtime availability:

```bash
npm run server:gerrit:doctor --silent
node server/scripts/gerrit-local.mjs status
npm run server:gerrit:smoke --silent
```

2. Start or refresh the local Gerrit runtime when needed:

```bash
npm run server:gerrit:start --silent
```

The default local runtime uses Gerrit `3.14.0`, HTTP `http://localhost:18080/`, SSH `ssh://localhost:29418`, state under `build/local-data/gerrit`, and the cached JRE under `server/platform/modules/knowledge/runtime/jre/`.

3. Verify the MCP compatibility surface:

```bash
npm run server:verify:gerrit-mcp --silent
PACT_VERIFY_GERRIT_LIVE=1 npm run server:verify:gerrit-mcp --silent
npm run server:verify:resource-operations --silent
npm run server:verify:mcp-http --silent
npm run server:verify:tool-management --silent
```

4. Check security evidence before release wording:

```bash
npm audit --audit-level=high --omit=dev
npm run security:hygiene --silent
```

## Required Boundaries

- Do not expose concrete `pact.gerrit.*` tools as top-level MCP tools. They must remain behind categorized outlets such as `pact.skill` or `pact.call`.
- Do not bypass Tool Management. Gerrit calls must pass grant, scope, risk, audit, and redaction handling.
- Do not grant write or maintain scopes through local-grant without explicit safety confirmation. Maintain-level grants require `grantMode=maintain` or `maxRisk=repair_write`.
- Do not move this Skill or Gerrit compatibility manifests into `.pact-server-data` or another runtime data directory.
- Do not claim absolute absence of vulnerabilities. Prefer evidence-backed wording such as `未发现已知高风险问题` and `关键路径进入审计链路`.

## Compatibility Contract

The component manifests that make this capability discoverable are:

- `server/platform/specialized/capabilities/code-review/gerrit/module.json`
- `server/platform/specialized/capabilities/code-repository/repo-operations/module.json`

Update those manifests when adding operations, changing scopes, changing required risk, changing the local test runtime, or changing verification commands.
