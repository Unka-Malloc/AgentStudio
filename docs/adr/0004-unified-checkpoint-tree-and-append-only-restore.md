# ADR 0004: Unified Checkpoint Tree and Append-Only Restore

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: ADR 0004 - Unified Checkpoint Tree and Append-Only Restore.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## Status
Accepted

## Context
Rollbacks in traditional systems often involve destructive "resets" (e.g., `git reset --hard`). In a multi-agent environment, this destroys the audit trail.

## Decision
1. **Append-Only Restore**: A "restore" action is just another operation that appends a new node to the Checkpoint Tree. It moves the `HEAD` of the workspace projection without deleting previous nodes.
2. **Unified Tree**: All actions (read requests, writes, permission changes) are nodes in the same tree.
3. **Restore Preview**: Any restore action must support a dry-run preview showing affected assets and potential conflicts.

## Consequences
- 100% auditability is maintained even after "undo" operations.
- Allows "time travel" exploration without losing divergent agent attempts.
