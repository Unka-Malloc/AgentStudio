# Adopt the Protocol Profile

Pactium uses the active Protocol Profile as the implementation and verification baseline for the proof-first rewrite. The profile fixes the Ledger transparency-log model, shared Canonical Prolly Tree index engine, operation lifecycle, workspace projection, checkpoint and state proof semantics, proof envelope and bundle shapes, LicoLite Aspect defaults, and current maintenance/repair boundaries as one coherent protocol matrix rather than independent tuning knobs.

Profile entries must stay aligned with implemented package behavior. Future surfaces such as separate per-workspace queues, repair fact execution, and benchmark baseline enforcement require implementation and ADR updates before they become profile commitments.
