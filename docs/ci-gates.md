# CI Gate Tiers

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: CI gate tiering, PR gate scope, external dependency reports, and release readiness triggers.
- Staleness check: Created during the 2026-06-11 CI gate split and checked against `.github/workflows/ci.yml`, `tests/run.mjs`, and `package.json`.

## Overview

Pact CI is split by decision type. Pull requests should prove that the current
code still supports the core product surface. External dependency compatibility
and release readiness are reported separately because they depend on package,
service, container, desktop, or publishing context.

## Pull Request Gate

Branch protection should require the single `Required CI gate` check. That
aggregate depends only on deterministic local checks:

| Area | CI job or profile | Purpose |
| --- | --- | --- |
| Repository hygiene | `Hygiene checks` | Reject committed local artifacts, broken root layout, and checked-in secrets. |
| Static correctness | `TypeScript check` | Keep the server and web TypeScript surface type-safe. |
| Web build | `Build frontend` | Confirm the server console renderer still builds. |
| Core functionality | `npm run test:core` | Exercise server runtime, MCP entry point, knowledge/source evidence, dispatcher guards, auth, client targets, and CLI smoke coverage. |
| Code and docs audit | `npm run test:audit` | Check documentation consistency, operation policy, state machines, feature registry, singleton boundaries, and client architecture records. |

The PR gate intentionally excludes package advisory drift, Docker image builds,
Linux desktop packaging, external service containers, and release readiness.

## Regression Reports

Broader regression coverage is available through `npm run test:regression` and
the manual `run_regression_report` workflow input. These jobs upload test
reports and use continue-on-failure behavior so the report can be inspected
without turning every dependency or environment issue into a merge blocker.

## External Dependencies

External services and dependency compatibility use `npm run test:external` and
the manual `run_external_dependency_report` workflow input. This flow covers
package audit status, external service registration, MCP/HTTP adapter contracts,
external knowledge distillation compatibility, Linux desktop smoke coverage, and
Docker/Ubuntu checks.

Supported external service versions should be managed with each service or
package manifest. A version mismatch should produce a compatibility report, then
be handled through the normal dependency upgrade, pinning, rollback, or support
matrix process.

## Release Gate

Release readiness runs only for release decisions: version tags (`v*`) or an
explicit manual workflow run with `run_release_readiness` enabled. It is not part
of ordinary commits, pushes, branch merges, or pull request promotion.
