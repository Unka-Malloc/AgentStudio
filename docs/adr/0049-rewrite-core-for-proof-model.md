# Rewrite Core for the Proof Model

Pactium will rewrite the core modules around the proof-first model rather than gradually patching the experimental earlier storage-first implementation. The new model changes ledger lifecycle, state indexing, checkpoint verification, proof envelopes, workspace projections, and LicoLite integration enough that retaining mutable row and weak proof assumptions would undermine the latest-schema boundary.
