# Share the Verifiable Index Engine

Pactium uses one shared verifiable index engine for ordered-key indexes that need stable roots, membership proofs, non-membership proofs, structural sharing, and efficient diffs. Merkle State indexes, Checkpoint Node indexes, Workspace Projection indexes, lifecycle indexes, idempotency indexes, and causality indexes expose different domain material but reuse the same canonical proof engine instead of duplicating domain-specific tree implementations.
