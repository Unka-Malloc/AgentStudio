# Pactium Release Rules

Pactium releases are allowed only from a closed, current-state repository. Maintained documentation must describe implemented behavior, and every durable design decision must live in `docs/` or ADRs before publishing.

## Node.js LTS Matrix

`package.json` declares support for Node.js 22 and Node.js 24. Release CI must run the full release gate on each supported LTS major independently.

Current release matrix:

| Node.js major | Gate |
| --- | --- |
| 22 | `npm run verify:release` |
| 24 | `npm run verify:release` |

When the Node.js project changes active LTS lines, update `engines`, CI, and this matrix together.

## Required Gate

Run:

```bash
npm run verify:release
```

The release gate must include:

- hygiene checks;
- coverage-enforced tests;
- protocol proof vectors and regression snapshots;
- seeded property tests;
- public API pressure profiles;
- tool and skill surface checks;
- package content checks that exclude process docs, release tooling, tests, build outputs, binary caches, compressed archives, and unpublished-doc links;
- release-readiness scans;
- package dry run;
- publish dry run.

## npm Publishing

Published package contents are limited to runtime source, CLI, examples, public protocol/architecture docs, README files, security policy, and license. Repository maintenance documents such as agent guides, release rules, tooling notes, quality gates, ADRs, optimization records, tests, scripts, build outputs, binary caches, and compressed archives must not be included in the npm tarball.

Publishing is handled by `.github/workflows/publish.yml` after the Node.js 22 and Node.js 24 release gates pass. The workflow uses npm Trusted Publishing through GitHub Actions OIDC; configure npm's trusted publisher for repository `Unka-Malloc/Pactium` and workflow filename `publish.yml`.

The publish workflow first checks whether the package version already exists on npm. Existing versions are treated as already released, so manual workflow dispatch can validate the gate without attempting to republish an immutable npm version. The local publish dry run follows the same rule because npm versions are immutable after publication.

## Documentation Closure

Release is blocked when any of the following exists:

- Implementation Plan, Implementation Guide, Gap, or similar process-state documents;
- maintained documents named after a package or protocol version;
- published docs that cite development scratch files as an authority or navigational source;
- design claims in maintained docs that do not map to implemented code and an ADR;
- historical documents that have not been merged into current design docs.
- missing root `AGENT.md`, extra agent entry files, project-local agent skills, unrelated tool registries, historical entrypoints, or old version-named tooling outside the current [Tooling Surface](TOOLING.md).

Durable decisions from development scratch files must be moved into maintained docs or ADRs before release.
