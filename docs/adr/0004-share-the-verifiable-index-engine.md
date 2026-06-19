# Share the Verifiable Index Engine

Pactium will use one shared verifiable index engine for ordered-key indexes that need stable roots, membership proofs, non-membership proofs, structural sharing, and efficient diffs. Merkle State indexes, Checkpoint Node indexes, and Workspace Projection indexes may expose different domain adapters for key normalization, value envelopes, and semantic validation, but they must reuse the same canonical proof engine instead of duplicating domain-specific tree implementations.
