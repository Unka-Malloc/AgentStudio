# Memory And Smoke Test Framework

## Metadata / 元数据

- Last updated: 2026-06-08
- Status: Maintained testing guide
- Scope: Memory And Smoke Test Framework.
- Staleness check: Scanned on 2026-06-08; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## Purpose

Pact uses a prebuild gate so renderer builds cannot proceed until regression and smoke coverage pass. The smoke layer is intentionally smaller than the full release suite, but it must cover process startup, API reachability, CLI behavior, and memory growth in historically risky paths.

## Standards Applied

- Measure Node memory with `process.memoryUsage()` fields: `rss`, `heapTotal`, `heapUsed`, `external`, and `arrayBuffers`.
- Force GC before retained-heap samples by running memory smoke tests with `node --expose-gc`.
- Treat leak detection as a trend, not a single sample: smoke tests compare post-warmup deltas and simple slopes.
- Capture a `.heapsnapshot` when a memory smoke test fails.
- Keep evidence and large payload rendering bounded; source evidence opens must return previews instead of full multi-MB raw files.
- Keep frontend smoke separate from regression builds so build scripts do not recurse.

## Commands

- `npm run test:smoke`: run smoke only.
- `npm run test:regression`: run the standard regression suite.
- `npm run test:prebuild`: run regression plus smoke.
- `npm run build:renderer`: automatically runs `test:prebuild` first, then performs the raw Vite build.
- `npm run build:renderer:raw`: raw renderer build for test suites and controlled internal use.

## Smoke Coverage

- `smoke.server.lifecycle`: starts an in-process server, logs in as owner, checks health/bootstrap/session/interfaces/runtime.
- `smoke.memory.source-evidence`: indexes and searches source EML files repeatedly under `--expose-gc`, verifies ignored directories, verifies bounded evidence previews, and enforces heap/RSS budgets.
- `smoke.client.cli`: runs the Rust CLI against an isolated portable workspace and verifies core commands produce expected output.
- `server.source-evidence`: regression coverage for source evidence preview and bounded source indexing.

## Failure Artifacts

Reports are written to `build/test-reports/`. Memory smoke reports are written under `build/test-reports/smoke/`; failing memory checks also write a `.heapsnapshot` next to the JSON report.
