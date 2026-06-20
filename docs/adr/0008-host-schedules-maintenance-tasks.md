# Host Schedules Maintenance Tasks

Pactium provides a deterministic maintenance task engine for sealing, compaction, verification, and garbage-collection work, but it does not run a resident scheduler or daemon. Host systems own scheduling, process lifetime, permissions, and operational policy, while Pactium owns task semantics, idempotency, and verifiable task results.
