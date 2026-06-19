# Pactium Verifiable Protocol Model

Pactium is a proof-first rewrite that supports LicoLite as its primary host through a complete verifiable protocol substrate. The model centers on an Operation Ledger as global ordering authority, a transparency log for ledger proofs, one shared Canonical Prolly Tree based Verifiable Index Engine for state, checkpoint, workspace projection, lifecycle, idempotency, and causality indexes, append-only Operation Intent and Operation Outcome facts, synchronous LicoLite workspace projections, cross-proof envelopes, content-addressed proof bundles, latest-schema-only data directories, and a first-class `pactium/licolite` aspect with signing, workspace projection, policy/effect extensions, verification, and repair planning.

This ADR is the implementation entry point for the detailed decisions recorded in ADR 0001 through ADR 0051.
