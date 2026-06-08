# Feature Profiles

## Metadata / 元数据

- Last updated: 2026-06-08
- Status: Current maintained document
- Scope: Feature Profiles.
- Staleness check: Scanned on 2026-06-08; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

Feature profiles are defined in `server/platform/interactive/features/feature-manifest.mjs`.

## Product Preset Lines

Pact maintains two preset build lines:

| Preset line | Purpose | Default shape |
| --- | --- | --- |
| Personal computer lightweight | Single-user local or personal-cloud-oriented use. | Modular monolith, SQLite, local file/object storage, local directory integration, optional gateway. No cluster middleware by default. |
| Enterprise private deployment | Enterprise-controlled deployment where infrastructure may already exist. | Dehydrated modules selected by profile; middleware is accessed through ports/adapters so Postgres, Redis, S3-compatible storage, KMS, gateways and audit export can be replaced with enterprise-owned services. |

All additional features must be dehydrated modules: they must declare profile membership, required ports, runtime assets, secret refs, audit behavior and verification commands. Enterprise-only modules must not leak into the personal computer default path.

## Layout

| Boundary | Server directory |
| --- | --- |
| foundation/core | `server/platform/common/platform-core` |
| foundation/security | `server/platform/common/security` |
| foundation/module-management | `server/platform/common/module-manager` |
| foundation/data-structure | `server/platform/common/data-structure` |
| foundation/storage | `server/platform/common/storage` |
| foundation/devops | `server/platform/common/devops` |
| service/interface-wrapper | `server/platform/common/operation-dispatcher` |
| service/console-api | `server/platform/common/console` |
| service/runtime-assembly | `server/platform/interactive` |
| service/agent | `server/services/agent` |
| service/client | `server/services/client` |
| specialized/agent | `server/platform/specialized/agent` |
| specialized/capabilities/tools | `server/platform/specialized/capabilities/tools` |
| specialized/capabilities/skills | `server/platform/specialized/capabilities/skills` |
| specialized/knowledge | `server/platform/specialized/knowledge` |
| specialized/knowledge/preprocessing/chunking | `server/platform/specialized/knowledge/preprocessing/chunking` |
| specialized/knowledge/preprocessing/domain | `server/platform/specialized/knowledge/preprocessing/domain` |
| modules/knowledge | `server/platform/modules/knowledge` |
| modules/agent | `server/platform/modules/agent` |

## Commands

```bash
npm run feature:plan -- --edition pro
npm run feature:verify -- --edition pro
npm run feature:diff -- --from community --to enterprise
npm run feature:build:server -- --edition enterprise --target linux-x64
npm run feature:build:client -- --edition enterprise --platform macos --dry-run
npm run feature:instantiate:minimal -- --output pact-v1 --force --install
```
