# Align Current Docs With Implementation

Maintained Pactium documentation must describe current implemented behavior rather than aspirational protocol shape. The current implementation is the package surface in `src/`, `bin/`, tests, and package scripts.

The following claims are not current behavior and must not be documented as implemented:

- local filesystem/SQLite storage backend;
- separate per-workspace FIFO Workspace Lane Queue;
- Repair Fact execution and Ledger append from repair tasks;
- pressure-profile baseline regression enforcement in CI;
- release-blocking coverage thresholds beyond the thresholds enforced by `npm run test:coverage`.

These items are not rejected permanently. They require explicit implementation, focused tests, and ADR updates before maintained docs may promote them to current behavior.
