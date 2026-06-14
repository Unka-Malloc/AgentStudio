# Pact Work Queue

`server/platform/common/resource-management/work-queue` owns the platform infrastructure queue primitive defined by ADR 0007.

Current contents are intentionally lightweight but executable:

- finite queue state machine;
- full state x event matrix proof;
- unified queue time source;
- queue-owned UUIDv7 identity generation;
- queue definition normalization helpers;
- in-memory Queue Definition Registry for trusted ids and versions;
- SQLite WAL store adapter with transition journal plus projection;
- lease-bound `claim` / `ack` / `nack` / `progress` / `term`;
- automatic delayed retry and expired lease recovery;
- fallback coordinator with independent fallback tasks and `fallback_review`;
- Queue Worker Runtime for upper-layer handlers;
- push dispatcher that performs durable claim before handler dispatch;
- queue control for pause, resume, and drain;
- unified background write aspect;
- conformance and deterministic randomized smoke tests.

The module must not depend on application capabilities. Business job managers and workflow activities adapt to this queue through Queue Worker Runtime handlers and payload references.

The default local deployment uses `better-sqlite3` with WAL under `<userDataPath>/work-queue/work-queue.sqlite`. Future external stores must preserve the same adapter primitives instead of exposing broker-native APIs to upper layers.
