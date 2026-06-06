# 42. 追踪矩阵 (Traceability Matrix)

## Metadata / 元数据

- Last updated: 2026-06-07
- Status: Current maintained document
- Scope: State Machine Traceability.
- Staleness check: Scanned on 2026-06-07; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## 42.1 State Machines Traceability

| Requirement | Doc | Machine ID | Implementation Files | Test Files | Verifier | Proof Obligations | Status |
|---|---|---|---|---|---|---|---|---|
| REQ-SM-CORE | 03 | N/A | `server/platform/common/state-machine/state-machine-core.mjs`<br>`server/platform/common/state-machine/state-machine-errors.mjs`<br>`server/platform/common/state-machine/state-machine-definition-schema.mjs`<br>`server/platform/common/state-machine/state-machine-verifier.mjs` | `tests/server/state-machine/state-machine-core.test.mjs`<br>`tests/vitest/server/state-machine-core.test.mjs` | `server/scripts/verify-state-machines.mjs` | N/A | implemented |
| REQ-CONTRIB-001 | 05 | `contribution.lifecycle.v1` | `server/platform/common/state-machine/definitions/contribution.lifecycle.v1.json` | `tests/vitest/server/contribution-lifecycle-state-machine.test.mjs` | `server/scripts/verify-state-machines.mjs` | `PO-CONTRIB-001` — `PO-CONTRIB-006` | implemented |
| REQ-LOAN-001 | 06 | `agentlibrary.loan.v1` | `server/platform/common/state-machine/definitions/agentlibrary.loan.v1.json` | `tests/vitest/server/knowledge-loan-lifecycle-state-machine.test.mjs` | `server/scripts/verify-state-machines.mjs` | `PO-LOAN-001` — `PO-LOAN-005` | implemented |
| REQ-RESTORE-001 | 08 | `checkpoint.restore.v1` | `server/platform/common/state-machine/definitions/checkpoint.restore.v1.json` | `tests/vitest/server/checkpoint-restore-lifecycle-state-machine.test.mjs` | `server/scripts/verify-state-machines.mjs` | `PO-RESTORE-001` — `PO-RESTORE-005` | implemented |
| REQ-OPERATION-001 | 04 | `operation.narrow.v1` | `server/platform/common/state-machine/definitions/operation.narrow.v1.json` | `tests/vitest/server/operation-state-machine-integration.test.mjs` | `server/scripts/verify-state-machines.mjs` | `PO-OP-001` — `PO-OP-005` | implemented |
| REQ-READY-001 | 19 | `production.readiness.lifecycle.v1` | `server/platform/common/state-machine/definitions/production.readiness.lifecycle.v1.json` | `tests/vitest/server/production-readiness-lifecycle-state-machine.test.mjs` | `server/scripts/verify-state-machines.mjs` | `PO-READY-001` — `PO-READY-004` | implemented |
