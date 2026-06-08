# ADR 0003: Terminal State and Side Effect Isolation

## Metadata / 元数据

- Last updated: 2026-06-08
- Status: Current maintained document
- Scope: ADR 0003 - Terminal State and Side Effect Isolation.
- Staleness check: Scanned on 2026-06-08; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## Status
Accepted

## Context
State machines govern the lifecycle of workspace assets. Mismanagement of terminal states could lead to "ghost operations" or unauthorized late-stage modifications.

## Decision
1. **Strict Terminality**: Once a state machine reaches a terminal state (e.g., `rejected`, `revoked`, `completed`), it cannot transition out unless explicitly permitted by an ADR-backed "allowedReopenTransition".
2. **Side Effect Blockade**: The Operation Scheduling Kernel must block any side effects (file writes, external API calls) if the associated state machine is in a terminal state or an invalid transition is attempted.
3. **Fail Closed**: If a state machine definition is missing or the current state is ambiguous, the system must default to `illegal_transition`.

## Consequences
- Guarantees that assets cannot be modified after a governance decision has been finalized.
- Simplifies audit by providing clear "end-of-life" markers for operations.
