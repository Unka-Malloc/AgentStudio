# 0061. Use Compressed SQLite BLOBs and Conservative Garbage Collection

Date: 2026-07-21

Status: Implemented

## Context

SQLite stored canonical payloads as base64 text and stored references as repeated JSON arrays. The representation expanded bytes, repeated parsing, and made reachability scans expensive. Rewriting unchanged protocol objects also created avoidable WAL and page churn.

The design was compared with SQLite's BLOB/WAL/UPSERT guidance, Kubo's root-based garbage collection, RocksDB BlobDB's value separation, and Git's pack/MIDX maintenance. External segment files were rejected because they would introduce a second durability protocol beside SQLite without solving proof semantics.

## Decision

- The current SQLite format stores canonical bytes in BLOB columns. CID and protocol hashes are always computed before compression from the canonical bytes.
- Payloads use adaptive Brotli quality 4 only at or above 768 bytes and only when at least 32 bytes and 5% are saved. Small or incompressible payloads remain uncompressed.
- References use a normalized `block_refs(parent_cid, ordinal, child_cid)` table. Duplicate CAS writes union references.
- Protocol-object UPSERT compares a content hash and performs no row update when bytes are unchanged.
- Transaction-local cache entries become visible only after commit. The weighted LRU is bounded by both entry count and raw byte weight.
- SQLite uses incremental auto-vacuum. `compactStorage()` performs fail-closed mark/sweep under the same write transaction that reads current roots, defaults to dry-run, and permits only current-domain `index-node:*` kinds to be swept.
- Page reclamation runs after the mark/sweep transaction commits. Ledger facts, envelopes, proof material, extensions, and state values are never in the sweep allowlist.
- JSON intentionally does not expose durable garbage collection because it cannot provide the same atomic root snapshot.
- The prior text schema is removed rather than dual-read.

## Consequences

Compression changes physical bytes only; proofs and CIDs are stable over canonical bytes. Normalized edges make reachability proportional to reachable nodes and edges. GC remains conservative: a missing root or incomplete graph aborts deletion. Incremental vacuum bounds latency and releases free pages without a full database rewrite.

Primary references: [SQLite BLOB values](https://www.sqlite.org/datatype3.html), [SQLite UPSERT](https://www.sqlite.org/lang_upsert.html), [SQLite incremental vacuum](https://www.sqlite.org/pragma.html#pragma_incremental_vacuum), [Kubo garbage collection](https://github.com/ipfs/kubo/blob/master/docs/config.md), and [RocksDB BlobDB](https://github.com/facebook/rocksdb/wiki/BlobDB).
