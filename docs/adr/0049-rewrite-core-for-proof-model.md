# Rewrite Core for the Proof Model

Pactium rewrote the core modules around the proof-first model rather than gradually patching the experimental earlier storage-first implementation. The current model changes ledger lifecycle, state indexing, checkpoint verification, proof envelopes, and workspace projections enough that retaining mutable-row and weak-proof assumptions would undermine the latest-schema boundary.
