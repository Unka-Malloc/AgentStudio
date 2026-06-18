# Pactium Architecture

Pactium is a small embeddable protocol layer.

```text
Host system
  -> Pactium Kernel
       -> Operation Ledger
       -> Checkpoint Tree
       -> Merkle State Substrate
```

The host system owns product semantics, user identity, authorization, UI, and external integrations. Pactium provides the durable protocol primitives that make those systems traceable and recoverable.

## Active Modules

- `src/ledger.js`: operation records with redaction, idempotency, status updates, and receipts.
- `src/checkpoint-tree.js`: append-only checkpoint lifecycle, restore preview, restore markers, scope query, and diff.
- `src/merkle-state.js`: CAS, manifests, indexes, partitioned events, state commits, and ingest receipts.
- `src/kernel.js`: composition API for recording one operation across all core primitives.
- `src/http.js` and `bin/pactium.mjs`: thin facades for local operation and smoke verification.
