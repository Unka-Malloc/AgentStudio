# Pactium Tooling Surface

Pactium keeps a deliberately small tooling surface. Tools exist only when they support current package development, local operation, maintenance, or release verification.

## Current Tools

| Surface | Kept tool | Purpose |
| --- | --- | --- |
| Package scripts | `start`, `docs:sync-version`, `test`, `test:coverage`, `verify`, `verify:core`, `verify:docs:versions`, `verify:hygiene`, `verify:protocol:gates`, `verify:package:contents`, `verify:release:readiness`, `verify:release`, `pack:dry-run`, `publish:dry-run` | Development, published-doc version sync, coverage, protocol gates, package-content checks, release readiness, package dry run, and publish dry run. |
| CLI | `bin/pactium.mjs` | Local Pactium doctor, HTTP server, operation recording, proof verification, and LicoLite recording/verification. |
| Release scripts | `scripts/update-published-doc-versions.mjs`, `scripts/verify-pactium-hygiene.mjs`, `scripts/verify-protocol-gates.mjs`, `scripts/verify-package-contents.mjs`, `scripts/verify-publish-dry-run.mjs`, `scripts/verify-release-readiness.mjs` | Published-doc version sync, hygiene scanning, protocol fixtures/properties/pressure gates, package content checks, publish dry-run checks, and release closure checks. |
| GitHub Actions | `.github/workflows/ci.yml`, `.github/workflows/publish.yml` | Matrix release-gate CI and trusted-publishing npm release workflow. |
| HTTP facade | `src/http.js` | Local JSON endpoints for health, protocol catalog, operation recording, LicoLite operation recording, and envelope verification. |
| Public package exports | `.`, `./licolite`, `./package.json` | Current proof-first package API, first-class LicoLite aspect, and package metadata. |

The HTTP facade is a local integration surface. `pactium serve` defaults to `127.0.0.1` and a 1 MiB JSON request body cap; non-loopback exposure must be owned by the embedding host's authentication, authorization, TLS, and network policy.

## Agent Entry

`AGENT.md` is the single root entry for automated coding agents maintaining this repository. It is a maintained repository guide, not a package runtime surface and not an agent skill registry.

Pactium keeps no project-local agent skills. Agent, editor, or design-assistant skill directories such as `.gemini/skills`, `.github/skills`, `.impeccable`, `.kilo`, root `skills/`, root `tools/`, and `AGENTS.md` are not Pactium package assets and must live outside this repository.

Runtime product skills, Tool Management registries, and KnowledgeSkill catalogs belong to the host system that embeds Pactium. They are not part of this proof-first npm package unless a current implementation, ADR, and release gate are added.

## Release Gate

`npm run verify:release` runs `scripts/verify-release-readiness.mjs`, which enforces this tooling surface before release:

- package scripts, `bin`, `exports`, `publishConfig`, and packaged files must match the current Pactium surface;
- root `AGENT.md` must remain the single in-repository agent entry;
- only `bin/pactium.mjs`, `scripts/update-published-doc-versions.mjs`, and the five verification scripts may exist under `bin/` and `scripts/`;
- project-local agent skills and unrelated tool registries are rejected;
- version-organized entrypoints, scripts, fixtures, and tooling names are rejected;
- npm package contents must exclude process docs, agent maintenance docs, release tooling, tests, build outputs, binary caches, and compressed archives;
- package-facing docs may link to unpublished process documents only through GitHub URLs, never as npm-package-relative links;
- maintained docs must describe implemented behavior and map durable claims to code and ADRs.
