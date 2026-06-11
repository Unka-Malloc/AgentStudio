# Versioning Policy

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Current maintained document
- Scope: Code, protocol, state machine definition, document pack, feature profile, verify gate, demo scenario, and production readiness report version governance.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## Versioned Objects

Pact concurrently governs version semantics for:

1. **Package version** — `package.json` version field (`0.0.1`).
2. **Protocol version** — MCP outlet protocol surface, Workspace API, relay protocol.
3. **State machine definition version** — Each machine definition JSON carries its own `version` field using SemVer.
4. **Document pack version** — Governance pack version (currently `v0.2`).
5. **Feature profile version** — Community / Pro / Enterprise edition capability manifests.
6. **Verify gate version** — CI gate registry and individual verifier script conformance levels.
7. **Demo scenario version** — Scenario manifests under `docs/scenarios/`.
8. **Production readiness report version** — Schema version in `build/reports/production-readiness/latest.json`.

## State Machine Definition Versioning (SemVer)

| Change Type | Example | Version Bump |
|---|---|---|
| Description text, test metadata, proof mappings (no semantic change) | Fix typo in label | **Patch** (1.0.0 → 1.0.1) |
| Add non-breaking state, add non-breaking event, add proof obligation, add guard without changing existing legal paths | Add `queued` state before `executing` | **Minor** (1.0.0 → 1.1.0) |
| Delete state or event, change initial state, change terminal semantics, swap legal/illegal, change side-effect ordering, change policy/approval requirements | Remove `reviewed` state | **Major** (1.0.0 → 2.0.0) |

Each state machine definition JSON in `server/platform/common/state-machine/definitions/` carries an independent `version` string.

## Document Pack Versioning

Current pack version: **v0.2**.

- `v0.2.x` — Fix typos, links, tables.
- `v0.3` — Add new state machine SDS or proof framework documents.
- `v1.0` — Requirement: at least Contribution, Loan, Restore, State Machine Core achieve C3, and one runtime path reaches C4.

## Production Readiness Declaration Constraints

While P0 gates remain open, the following claims are **prohibited**:

- `production-ready`
- `enterprise-ready`
- `enterprise-grade production`
- `工业级` (industrial-grade)
- `正式可用` (formally available)

Only these are allowed:

- `engineering baseline`
- `architecture baseline`
- `controlled local demo`
- `internal pilot`
- `prototype with verified local gates`

Any release claim must reference the `productionClaimAllowed` field from `build/reports/production-readiness/latest.json`.

## Version Update Files

| File | Purpose |
|---|---|
| `docs/VERSIONING.md` | This document — version policy |
| `docs/STATE-MACHINE-REGISTRY.md` | State machine registry with version tracking |
| `docs/STATE-MACHINE-CHANGELOG.md` | Per-machine definition change log |

State machine definition changes **must** update the changelog.
