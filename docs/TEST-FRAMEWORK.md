# Pact Unified Test Framework

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Current maintained document
- Scope: Pact Unified Test Framework.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

Pact has server runtime code, a Vue server console, a Flutter desktop client,
Rust native client binaries, platform adapters, and external document/mail
evaluation corpora. The test framework is intentionally layered instead of tied
to one language runner.

The single repository entrypoint is:

```sh
npm test
```

For release-grade regression:

```sh
npm run test:regression
```

The runner writes machine-readable reports to `build/test-reports/`, including
`build/test-reports/latest.json`.

## Design Principles

- One entrypoint: every repository-level check is registered in `tests/run.mjs`.
- Owned tests stay near owned code: Rust tests stay in `client-cli`, Flutter
  tests stay in `client-gui`, existing server verifier scripts stay in
  `server/scripts`, and new focused Node/Vue unit tests use the standard Vitest
  stack.
- Profiles compose suites: developers run fast tests locally; CI and release
  workflows run standard, security, coverage, and platform profiles.
- Security is part of default regression: secret hygiene and production
  dependency audit run before broader integration work.
- Generated output stays under `build/`; root and source-tree hygiene tests
  reject misplaced artifacts.
- Runtime settings, provider manifests, mount config, local data dirs, and
  credential state stay outside the repository under `~/.pact-server-data/`.
- Raw agent conversation history and real mail download/import directories are
  external data and must not be kept under the project checkout.
- Downloaded evaluation corpora, real mailboxes, imported messages, and real
  document sample sets stay outside the repository under
  `~/.pact-server-data/evaluation-corpora/`. Repository tests may keep only
  small synthetic fixtures and manifests.
- Every feature or refactor must update the smallest suite that can fail for
  the changed behavior, then any integration suite needed for the contract.

## Standard Test Stack

Pact standardizes new Node.js and Vue tests on the Vite-native test stack:

| Layer | Standard | Scope |
| --- | --- | --- |
| Node.js server unit tests | `vitest` | Pure modules, state reducers, authorization helpers, runtime policies, storage utilities, and other deterministic server logic. |
| Node.js server integration tests | `vitest` | HTTP/API behavior, temporary filesystem state, SQLite-backed flows, and focused runtime workflows. |
| Vue console unit/component tests | `vitest` + `@vue/test-utils` + `jsdom` or `happy-dom` | Composables, route-level controllers, component rendering, emitted events, forms, and DOM assertions that do not require a real browser. |
| Browser E2E tests | `@playwright/test` | Full console workflows, routing, real browser behavior, network boundaries, and user-visible regressions. |
| Node/Vue coverage | `@vitest/coverage-v8` | Text, HTML, and LCOV coverage reports for Vitest-owned server and Vue tests, with optional thresholds for CI gates. |

Existing `server/scripts/verify-*.mjs` checks remain valid contract and
regression gates. New narrowly scoped server unit tests should prefer Vitest;
broader system-contract checks may stay as verifier scripts when they exercise
process boundaries, generated reports, or multi-step runtime workflows.

Coverage is supported by the standard stack. Vitest can collect V8 coverage via
`@vitest/coverage-v8` for Node.js server modules, Vue composables, and Vue
component tests. Playwright remains the E2E runner; it should not be the primary
source of unit coverage, though E2E suites can still be used as release
confidence gates. Flutter coverage continues to use `flutter test --coverage`,
and Rust CLI coverage uses `cargo-llvm-cov`.

## Coverage Baseline

Baseline captured on 2026-06-03:

| Area | Command | Line coverage | Covered / total lines | Report |
| --- | --- | --- | --- | --- |
| `server` | `npm run test:node-vue:coverage` | 0.91% | 387 / 42,684 | `build/coverage/node-vue/lcov.info` filtered to `server/` |
| `server-web` | `npm run test:node-vue:coverage` | 0.22% | 26 / 12,024 | `build/coverage/node-vue/lcov.info` filtered to `server-web/` |
| `client-gui` | `npm run client:test:coverage` | 52.40% | 251 / 479 | `client-gui/coverage/lcov.info` |
| `client-cli` | `npm run client:native:test:coverage` | 73.66% | 2,137 / 2,901 | `build/coverage/client-cli/lcov.info` |

The `server` and `server-web` baselines come from the same Vitest LCOV report
and are split by `SF:` path prefix. The Node/Vue baseline is intentionally
repository-wide over `server/**/*.mjs`, `server-web/**/*.ts`, and
`server-web/**/*.vue`, excluding verifier scripts, generated/runtime bundles,
static public assets, and non-source documents. The first Node/Vue baseline is
low because it only contains the initial Vitest seed tests; new server and Vue
work should raise this value by adding focused Vitest tests for changed modules.
Rust CLI coverage uses `cargo-llvm-cov`; local and CI environments need that
Cargo subcommand available before running `npm run client:native:test:coverage`.

Latest strict non-ACP scan captured on 2026-06-06 after the latest Vitest
coverage expansion. The Node/Vue report was produced by the strict non-ACP
Vitest coverage run over 507 test files, excluding ACP relay, downstream-client,
and communication-service protocol work left for the ACP batch:

| Area | Command | Line coverage | Covered / total lines | Report |
| --- | --- | --- | --- | --- |
| `server` non-ACP | strict non-ACP `vitest --coverage` + `PACT_UNIT_COVERAGE_NODE_VUE_REPORT=build/coverage/node-vue-non-acp-strict/lcov.info npm run test:unit-coverage:scan` | 95.01% | 40,725 / 42,866 | `build/coverage/node-vue-non-acp-strict/lcov.info` filtered to `server/`, excluding ACP relay/downstream/communication-service paths |
| `server-web` | strict non-ACP `vitest --coverage` + `PACT_UNIT_COVERAGE_NODE_VUE_REPORT=build/coverage/node-vue-non-acp-strict/lcov.info npm run test:unit-coverage:scan` | 95.44% | 11,963 / 12,535 | `build/coverage/node-vue-non-acp-strict/lcov.info` filtered to `server-web/` |
| `client-gui` | `npm run client:test:coverage` + `npm run test:unit-coverage:scan` | 95.73% | 561 / 586 | `client-gui/coverage/lcov.info` |
| `client-cli` | `npm run client:native:test:coverage` + `npm run test:unit-coverage:scan` | 95.11% | 3,696 / 3,886 | `build/coverage/client-cli/lcov.info` |

## Coverage Gate

The first quality gate for future changes is the direct unit coverage scan.
The repository runner registers `coverage.unit-threshold` as the first suite in
every `tests/run.mjs` profile, including the dynamically selected `changed`
profile; coverage is checked before the broader hygiene, security, build, and
regression gates. The first gate runs:

```sh
npm run test:unit-coverage:scan
```

This command directly runs `tests/verify-unit-coverage-threshold.mjs` over the
existing LCOV reports. For the combined Node/Vue report, the scanner uses
`build/coverage/node-vue/lcov.info` when present and otherwise falls back to the
current strict non-ACP reports under `build/coverage/node-vue-non-acp-strict/`
or `build/coverage/node-vue-non-acp/`. Report paths can be overridden with
`PACT_UNIT_COVERAGE_NODE_VUE_REPORT`, `PACT_UNIT_COVERAGE_CLIENT_GUI_REPORT`,
and `PACT_UNIT_COVERAGE_CLIENT_CLI_REPORT` when scanning a scoped report such as
`build/coverage/node-vue-non-acp/lcov.info`. Each code area must be strictly
greater than 95.00% line coverage:

- `server`
- `server-web`
- `client-gui`
- `client-cli`

When reports need to be refreshed before scanning, run:

```sh
npm run test:unit-coverage:gate
```

That command runs the coverage tools for all four code areas, then runs the same
direct scan. Every `tests/run.mjs` profile starts with the scan-only gate. As of
the 2026-06-05 non-ACP scan above, the four submitted areas are above the
strict >95% threshold; ACP relay/downstream/communication-service coverage is
tracked separately with the remaining ACP work.

## Profiles

| Profile | Command | Purpose |
| --- | --- | --- |
| `fast` | `npm test` / `npm run test:fast` | Local pre-commit loop: repo hygiene, secret hygiene, destructive client gates, Flutter analyze/tests, Rust client tests. |
| `standard` | `npm run test:regression` / `npm run test:standard` | Full cross-layer regression: security, server console build, server runtime checks, client tests, hygiene after generated output. |
| `coverage` | `npm run test:coverage` | Coverage profile: first runs the direct unit coverage threshold scan and enforces the >95% line threshold. Refresh LCOV reports with `npm run test:unit-coverage:gate` when needed. |
| `security` | `npm run test:security` | Secret scan, dependency audit, server smoke, client native tests. |
| `server` | `npm run test:server` | Server console and server runtime verification. |
| `client` | `npm run test:client` | Flutter and Rust client verification. |
| `changed` | `npm run test:changed` | Git-diff based selection for focused local checks. |
| `release` | `npm run test:full` | Standard regression plus Linux GUI and Ubuntu Docker verification. |

List all suites:

```sh
npm run test:list
```

Run a single suite:

```sh
node tests/run.mjs --suite client.native.test
```

Run all security-tagged suites:

```sh
node tests/run.mjs --tag security
```

## Test Layers

### Static and Hygiene

- `repo.hygiene.*`: validates repository layout, prevents generated output
  from leaking into source roots, and blocks project-local runtime or
  credential state such as local Pact data dirs, runtime `settings.json`,
  provider manifests, mount config, `.env`, private keys, service account
  files, client secrets, and token files anywhere under the repository.
- `security.secret-hygiene`: scans source, docs, and tests for high-risk secret
  patterns such as private keys, cloud credentials, GitHub tokens, and API keys.
- `security.npm-audit`: fails on high-risk production dependency advisories.
- `client.flutter.analyze`: runs Flutter static analysis.

### Unit and Component

- Flutter unit/widget tests live under `client-gui/test`.
- Rust unit tests live beside `client-cli/src` code.
- New Node.js server unit tests should use Vitest.
- Vue console composable and component tests should use Vitest with
  `@vue/test-utils` and a DOM environment such as `jsdom` or `happy-dom`.
- Existing server verifier scripts under `server/scripts` remain the right
  place for broader contract, architecture, and runtime workflow checks.

### Contract and Integration

- `client:verify:architecture` checks the destructive desktop-client boundary:
  only six product modules, future package profile, first target adapters, no
  removed daemon/connector/mail/graph/upload package, no old CLI main command
  set, no retained `client-cli/legacy` or `client-gui/legacy` tree, and zero
  `unsafe` occurrences anywhere under the Rust CLI source tree.
- `client:verify:plan` checks that docs, package scripts, and `tests/run.mjs`
  agree on the client verifier set, and that deferred Skill Hub protocol work is
  not marked complete.
- `client:verify:state-store` covers the future local JSON/JSONL state,
  activity, and snapshot substrate.
- `client:verify:targets` covers target discovery, manual target addition, and
  first target adapter contracts.
- `client:verify:config-writes` covers structured target-native MCP config
  plan/apply/rollback writes.
- `client:verify:pairing-skill-cli` covers pairing, passive Skill Hub listing,
  hidden skill refusal, and `protocol_deferred` boundaries.
- `client:verify:mcp-plugins` covers peer MCP plugin status/update/rollback.
- `client:verify:thin-forwarding` covers model profiles and thin forwarding
  without a planner, session harness, or tool loop.
- `client.native.test` covers Rust client unit and contract tests. Removed
  daemon, connector, mail, upload queue, and server bridge tests are not part of
  the product gate.
- `server.headless` validates the server runtime without the GUI.
- `server.continuity`, `server.checkpoints`, `server.rebuild`, `server.ops`,
  and `server.knowledge` validate storage, upload, rebuild, and knowledge
  processing invariants.
- `server.web.build` ensures the Vue server console still compiles.

### Desktop GUI and Platform

- `client.linux.build` builds the Flutter Linux bundle.
- `client.linux.smoke` validates the generated Linux bundle and sidecar files.
- `client.linux.gui-smoke` launches the Flutter app under Xvfb, captures
  screenshots, verifies they are nonblank, and checks basic input stability.
- `client.ubuntu.verify` runs the Ubuntu Docker desktop verification path.

## Security Expectations

Security tests are not limited to dependency audit. New sensitive flows must add
tests for:

- secret and token storage boundaries;
- RPC token validation and protocol version rejection;
- path traversal rejection for shared workspace files;
- atomic write and partial-write recovery;
- untrusted file parsing failures;
- upload checkpoint replay and mismatch behavior;
- stale runtime state cleanup.

Use OWASP ASVS as the external vocabulary for security control requirements, but
map those requirements to Pact-owned suites instead of adding disconnected
checklists.

## Change Rules

When changing `server/`:

```sh
npm run test:server
```

When changing `client-cli/`:

```sh
node tests/run.mjs --suite client.native.test
```

When changing `client-gui/`:

```sh
npm run test:client
```

When changing shared protocols, portable data, RPC, upload checkpoints, or expert
vocabulary hot update behavior:

```sh
npm run test:regression
```

When changing Linux packaging, GUI startup, or sidecar bundling:

```sh
npm run test:full
```

If a change intentionally updates behavior, update the matching unit or contract
test in the same patch. If no existing suite represents the behavior, add a new
suite to `tests/run.mjs` and document it here.

## CI Recommendation

Use staged CI jobs:

1. `npm test` on every push and pull request.
2. `npm run test:security` on every pull request.
3. `npm run test:regression` before merge to protected branches.
4. `npm run test:full` on release branches and nightly schedules with Docker
   available.

Keep report artifacts from `build/test-reports/` for all CI jobs. Keep GUI
screenshots from `build/artifacts/ubuntu-client-gui/` only for release and failed
GUI jobs.

## Pipeline Gate Capability Registry

Use this checklist as the source of truth when adding or reviewing CI gate
coverage for product capabilities. A capability is only marked checked when it
has an executable verifier and is included in the appropriate CI profile or
workflow job. If a requested capability is missing, add the smallest verifier
that can fail for that contract, wire it into `tests/run.mjs` or a release gate,
then update this list in the same patch.

- [x] `repository-hygiene`: enforced by `repo.hygiene.pre`,
  `repo.hygiene.post`, and `npm run repo:hygiene`; blocks generated output and
  misplaced artifacts from leaking into source roots.
- [x] `secret-hygiene`: enforced by `security.secret-hygiene` and
  `npm run security:hygiene`; blocks high-risk secrets in source, docs, and
  tests.
- [x] `production-dependency-audit`: enforced by `security.npm-audit` in
  security, standard, prebuild, and release profiles.
- [x] `typescript-typecheck`: enforced by the CI `typecheck` job with
  `npx tsc --noEmit`.
- [x] `renderer-build`: enforced by `server.web.build`,
  `npm run build:renderer:raw`, and the CI `build-renderer` job.
- [x] `server-runtime-regression`: enforced by the `standard`, `server`,
  `prebuild`, and `release` profiles across headless runtime, MCP HTTP,
  continuity, checkpoints, rebuild, ops, knowledge, policy, trace, logging, and
  business scenario suites.
- [x] `acp-agent-relay`: enforced by `server:verify:acp-agent-relay` and
  `npm run server:verify:acp-agent-relay`; validates ACP relay protocol
  contract and phase 0/1 governance behavior, including virtual agent mapping,
  durable wake/policy recalculation, reasoning visibility gating, fail-closed
  policy kernels, write approval/receipt behavior, terminal denial, and relay-scope MCP
  projection without source token leakage, plus Tool Management-mediated REST
  facade execution and persisted relay store state.
- [x] `external-service-api-registration`: enforced by
  `server.external-service-api-registration`,
  `npm run server:verify:external-service-api-registration`, and the production
  readiness external-service gate; requires every `external-services/*`
  capability to register through `external.*` operations and mediated
  `/api/external/*` APIs, and rejects Tool Management exposure of platform
  internal algorithm operations such as `knowledge.distillation.*`.
- [x] `capability-kernel-api-capability`: enforced by
  `npm run server:verify:authorization-capabilities` and the production
  readiness Capability Kernel gate; verifies every `SERVER_API_OPERATIONS`
  entry and Tool Catalog entry has a known kernel Capability and that
  Capability-only authorization allow/deny behavior works.
- [x] `key-management-storage-distribution`: enforced by the production
  readiness key-management gate, `npm run server:verify:secret-init`,
  `npm run server:verify:opaque-capability-key`,
  `npm run server:verify:tool-management`, and `npm run server:verify:mcp-http`;
  covers key initialization, opaque key storage/verification, grant
  rotate/revoke storage, and MCP local grant delivery.
- [x] `permission-management-auth-config`: enforced by the production readiness
  tool-permission gate, `npm run server:verify:console-auth`,
  `npm run server:verify:2-3-5-security-model`,
  `npm run server:verify:tool-management`, and
  `npm run server:verify:authorization-governance`; covers client identity,
  role/policy/governance configuration, tool grants, and authorization audit.
- [x] `mcp-gateway-client-push`: enforced by the production readiness MCP
  gateway gate, `npm run server:verify:mcp-http`,
  `npm run server:verify:mcp-release`, `npm run client:verify:mcp-plugins`,
  and `npm run server:verify:client-runtime-bootstrap`; covers MCP discovery,
  `notifications/tools/list_changed`, connector version packaging, client MCP
  config update/rollback, and key grant delivery to downstream clients.
- [x] `client-native-and-flutter`: enforced by the `fast`, `client`,
  `standard`, `prebuild`, and `release` profiles across Rust native tests,
  client architecture gates, target/config contracts, Flutter analyze, and
  Flutter tests.
- [x] `smoke-runtime-memory-cli`: enforced by `npm run test:smoke`; covers
  server lifecycle, bounded source evidence memory behavior, and client CLI
  smoke.
- [x] `docker-image-build`: enforced by the CI `docker-build` job.
- [x] `release-readiness`: enforced on release branches, version tags, and
  manual runs by `npm run test:full`, `npm run server:verify:v001`, and
  `npm run server:verify:production-readiness`; uploads release and production
  readiness reports.
