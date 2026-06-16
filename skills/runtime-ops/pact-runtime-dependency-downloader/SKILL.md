---
name: pact-runtime-dependency-downloader
description: Use when preparing, downloading, caching, or auditing Pact runtime dependencies and adapter artifacts, including knowledge backends, cloud drives, Docker, JRE/Python runtimes, caddy/nginx, and Gerrit.
---

# Pact Runtime Dependency Downloader

## Purpose

Prepare Pact runtime artifacts without confusing downloaded local bytes, configured external services, and contract-mode adapters.

This Skill is for repository maintenance. Keep it under `skills/runtime-ops/`; never move it into `.pact-server-data` or another runtime data directory.

## Quick Commands

List the supported dependency matrix:

```bash
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs list
```

Plan or download every dependency through the same on-demand runtime dependency manager used by the console:

```bash
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target all --dry-run
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target all
```

Download one target:

```bash
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target document-runtime
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target gerrit-war
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target docker
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target dify
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target rag-flow
```

Gateway runtimes use the local source config written by the runtime dependency manager:

```bash
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs list
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target gateway-caddy
node skills/runtime-ops/pact-runtime-dependency-downloader/scripts/pact-runtime-dependencies.mjs download --target gateway-nginx
```

## Rules

- Treat this as download/cache preparation, not global installation.
- Never run these downloads during startup. The trigger must be a user click, an explicit API/RPC/CLI call, or an operator-run Skill command.
- Always detect the local device and local cache first; skip download when the dependency is already present.
- The backend status vocabulary is only `present`, `installed`, or `failed`.
- Download sources are written to the local `runtime/runtime-dependency-sources.json` config under the Pact data directory. If a built-in source is unreachable, configure a mirror in that file and retry.
- Prefer existing project scripts over new ad hoc download logic.
- Do not claim a provider is live just because it is configured or `contractVerified`.
- For external services such as GitHub, Dify, RAGFlow, cloud drives, Qdrant, OpenSearch, or pgvector, record them as configured/operator-provided unless the repo has a real downloader.
- If a downloader writes runtime state, keep the script's existing destination. Do not relocate runtime bytes into source files.

## Source Map

- Runtime dependency manager: `server/platform/specialized/capabilities/runtime-dependencies/index.mjs`
- Console entry: `/admin/runtime-downloads`
- HTTP API: `GET /api/runtime/dependencies`, `POST /api/runtime/dependencies/download`
- Document runtime: `server/scripts/setup-local-runtime.mjs`
- Gerrit runtime: `server/scripts/gerrit-local.mjs`
- Gateway runtime: `server/scripts/gateway-ingress.mjs`
- OCR runtime boundary: `server/platform/modules/knowledge/ocr/runtime/README.md`
- PDF visual runtime boundary: `server/platform/modules/knowledge/file-processor/FileNormalizer/PDFProcessor/pdf-visual.mjs`
- External service boundary: `docs/protocols/PROTOCOLS.md`, `docs/functionality/SERVER-RUNTIME.md`

## Dependency Matrix

| Target | Capability | Current download status | Primary command |
| --- | --- | --- | --- |
| `dify` | Dify backend knowledge base adapter | Detects Dify config first; optional image pulls only use explicitly configured local source config | `runtime.dependencies.download targetId=dify` |
| `rag-flow` | RAG Flow backend knowledge base adapter | Detects RAG Flow config first; optional image pulls only use explicitly configured local source config | `runtime.dependencies.download targetId=rag-flow` |
| `cloud-drives` | iCloud local folder and OneDrive/Google Drive/Dropbox OAuth refs | Configure-only; no binary download | `runtime.dependencies.list` |
| `docker` | Container runtime used by optional image pulls | Detects Docker CLI/app first; caches installer artifact when supported | `runtime.dependencies.download targetId=docker` |
| `programming-runtimes` | JRE, Python, current Node runtime | Detects each child first; JRE can use built-in setup, Python uses the local source config if PATH/bundled runtime is absent | `runtime.dependencies.download targetId=programming-runtimes` |
| `jre` / `document-runtime` | Java runtime for Java-backed flows | Detects settings/bundled/PATH first; downloads from local source config only on request | `runtime.dependencies.download targetId=jre` |
| `python` / `ocr-python` / `pdf-visual-python` | OCR/PDF sidecar Python | Detects env/bundled/PATH first; downloads from local source config only on request | `runtime.dependencies.download targetId=python` |
| `caddy` / `gateway-caddy` | Optional traffic gateway | Detects configured/cache/PATH first; pulls from local source config only on request | `runtime.dependencies.download targetId=caddy` |
| `nginx` / `gateway-nginx` | Optional traffic gateway | Detects configured/cache/PATH first; pulls from local source config only on request | `runtime.dependencies.download targetId=nginx` |
| `gerrit` / `gerrit-war` | Local Gerrit code-review runtime | Default official WAR downloader exists | `npm run server:gerrit:download` |
| `gerrit-docker` | Alternate local Gerrit runner | Docker image is still runner-managed; do not start just to download | `runtime.dependencies.download targetId=docker` before Gerrit Docker use |
| `sqlite-vec` | Local vector KNN | npm dependency, not runtime-pulled by this Skill | `npm install` / packaging flow |
| `model-providers` | OpenAI-compatible/custom model gateway | External endpoint, configure only | Agent Gateway config |

## Verification

After download work, run the smallest relevant checks:

```bash
npm run server:gerrit:doctor --silent
npm run server:gerrit:smoke --silent
npm run server:verify:dynamic-document-parsing --silent
npm run server:verify:gateway-ingress --silent
npm run server:verify:runtime-dependency-downloads --silent
```

Use only the checks that match the targets touched.
