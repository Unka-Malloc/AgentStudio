# Pactium Architecture

Pactium is a host-neutral proof-first protocol substrate. Meshrix is an independent downstream framework that imports the public root package; no framework-specific policy or adapter layer sits inside Pactium.

## System Overview

```text
Host framework or service
  -> pactium / pactium/http
       -> Pactium Core
            -> Canonical Value + Protocol Hash
            -> Operation Ledger Transparency Log
            -> Shared Verifiable Index Engine
            -> Lifecycle, workspace, state, and checkpoint structures
            -> Proof Envelopes, Extensions, and Bundles
            -> Repair Planner + explicit Maintenance Task Engine
            -> Storage Port -> in-memory / JSON / SQLite
```

The package root is the public composition boundary. Host-specific semantics remain above it; storage-specific mechanics remain below the Storage Port.

## Authority Model

The Operation Ledger is the global ordering authority. Workspace Projection, Merkle State, Checkpoint Tree, lifecycle, idempotency, and causality indexes are verifiable structures, but they do not replace Ledger Authority.

The shared Verifiable Index Engine is the canonical ordered-key proof engine. State, checkpoint, workspace projection, lifecycle, idempotency, and causality indexes use domain adapters over that shared engine rather than separate tree implementations.

## Data Flow: Recording an Operation

```text
  Host calls recordOperation(input)
       │
       ▼
  ┌─────────────────────────────┐
  │ 1. Idempotency Check        │ Check Intent/Outcome Idempotency Indexes
  │    (replay if existing)     │ Return existing proof if found
  └──────────────┬──────────────┘
                 │ (new operation)
                 ▼
  ┌─────────────────────────────┐
  │ 2. Protocol commitment      │ Hash input/result without retaining them
  │    + explicit content       │ Persist only requested state/extensions
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 3. Ledger Append            │ Append Intent + Outcome as leaf entries
  │    (Transparency Log)       │ Compute new Ledger Head
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 4. Index Updates            │ Update lifecycle, idempotency, workspace,
  │    (Verifiable Index Engine)│ state, checkpoint, and causality indexes
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 5. Proof Assembly           │ Gather inclusion proof, index proofs,
  │    (Proof Envelope)         │ state root, extensions → Proof Envelope
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 6. Return Proof Envelope    │ Content-addressed Proof Material Refs
  │    to caller                │ included for later verification
  └─────────────────────────────┘
```

For read-only or terminal-only host events, `recordOperationReceipt()` skips the open-intent lifecycle. A `receipt` appends one terminal fact; `on-change` compares a domain-separated digest under the same mutation transaction and appends nothing when unchanged.

## Data Flow: Verifying a Proof Envelope

```text
  Caller provides Proof Envelope
       │
       ▼
  ┌─────────────────────────────┐
  │ 1. Resolve Proof Material   │ Load content-addressed blocks via refs
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 2. Ledger Inclusion Check   │ Verify leaf hash against Ledger Head
  │                             │ using RFC 6962 inclusion proof
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 3. Index Proof Check        │ Verify membership/non-membership proofs
  │                             │ against index roots
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 4. Extension Check          │ Verify critical extensions are supported
  │                             │ Verify extension hash bindings
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ 5. Result                   │ { ok, failures[], checked[] }
  │                             │ Failures are structured, not thrown
  └─────────────────────────────┘
```

## Host Boundary

Pactium owns canonical facts, proof algorithms, storage mechanics, verification, and deterministic planning. Every host, including Meshrix, owns identity, policy, authorization, approvals, operation dispatch, side effects, business content, disclosure, UI, and operational controls.

Operation input and result values cross the core boundary only as protocol hashes. A State Value or Proof Extension value crosses as retained content only when the caller explicitly supplies it. Workspace Projection is logical membership and ordering, not an access-control boundary.

```text
Host: identity, authorization, policy, content, effects, operations
  |
  | public host-neutral API
  v
Pactium: facts, hashes, ledger, indexes, proofs, verification, planning
  |
  | Storage Port
  v
Local persistence: in-memory, JSON, or SQLite
```

## Storage Architecture

```text
  Data Directory (.pactium/)
  ├── pactium-manifest.json  Root manifest (protocol, schema, storageBackend)
  ├── pactium.sqlite         SQLite backend database when storageBackend=sqlite
  ├── cas/                   JSON backend content-addressed block store
  │   └── <hex-prefix>/      Prefix-based sharding (first 2 hex chars of CID)
  │       └── <hex>.json     Block by full hex CID hash
  ├── protocol/              JSON backend protocol objects (scoped key-value)
  │   ├── core/              Fixed-size runtime manifest
  │   ├── core-*/            Domain-separated locator and claim records
  │   ├── ledger/            Ledger entries, heads, compact range
  │   ├── ledger-head/       Historical ledger heads
  │   ├── ledger-leaf/       Per-index ledger leaves
  │   ├── ledger-node/       Merkle tree nodes
  │   └── ...                Ledger and normalized runtime records
  └── locks/                 Write-lock directories
      └── <name>.lock/       Per-lock directory
          └── owner.json     Lock owner metadata (pid, ownerId, timestamp)
```

The Storage Port abstraction separates Pactium's protocol logic from persistence mechanics. The current implementation ships local JSON and SQLite adapters behind a manifest-bound factory. `createStoragePort()` defaults to auto backend selection for persistent directories: SQLite is selected for new directories when an implemented provider is available (`node:sqlite` or optional npm `better-sqlite3`), otherwise JSON. JSON is intended for local development, low-concurrency use, and debugging. SQLite is the production local-durability candidate; distributed multi-node deployments still require an external consistency layer.

SQLite stores canonical payloads as BLOBs and computes CIDs before adaptive Brotli compression. Block references live in normalized rows, unchanged protocol objects use a content-hash no-op UPSERT, and transaction cache entries are promoted only after commit. `compactStorage()` snapshots current roots and performs fail-closed mark/sweep in one write transaction; only unreachable current-domain index nodes are eligible. Incremental page reclamation runs after commit. JSON deliberately does not implement durable GC.

Storage ports expose an idempotent asynchronous `close()` contract. JSON and SQLite stop admitting operations and drain admitted work; SQLite also drains its write lane before closing the database, while auto storage closes only an already selected backend. A core mutation or storage write callback cannot await closure of the lifecycle that admitted it; reentrant close is rejected before lifecycle state changes, and closure must be requested after that callback settles. Failed JSON initialization remains failed for that storage instance and cannot fall through into writes. SQLite enforces private directory and database modes, rejects symbolic-link or special-file database artifacts, and retries writer admission within the declared busy deadline. Storage backends may change how bytes are stored but cannot change canonical encoding, hash computation, or proof semantics.

### Canonical Value Encoding

Pactium's canonical value encoding (`canonical/value.js`) is **Pactium-specific**. It is NOT an implementation of RFC 8785 (JSON Canonicalization Scheme / JCS).

Key differences from RFC 8785 JCS:

| Aspect | Pactium Canonical Value | RFC 8785 JCS |
| --- | --- | --- |
| Binary data | `$bytes` wrapper with base64 encoding | Not supported |
| String normalization | Unicode NFC normalization | No normalization (code-point identity) |
| Numbers | Only IEEE 754 safe integers (53-bit) | Arbitrary JSON numbers (implementation-defined) |
| `-0` | Normalized to `0` | Preserved as `-0` (JSON: `-0`) |
| `undefined` values | Filtered from objects | N/A (undefined is not valid JSON) |
| `Buffer` / `Uint8Array` | Encoded as `{ $bytes: base64 }` | Not supported |
| Reserved keys | `$bytes` is reserved in user objects | No reserved keys |

The canonical value encoding borrows the general concept of deterministic JSON canonicalization (sorted object keys, stable array ordering, no whitespace) but adds Pactium-specific constraints that make it incompatible with generic RFC 8785 implementations. Protocol documents and API descriptions MUST NOT describe Pactium's canonical encoding as "RFC 8785 compatible" or "JCS-compliant."

## Shared Engine: Index Domain Adapters

All verifiable indexes share one Canonical Prolly Tree engine:

```text
  ┌─────────────────────────────────────────────────────────┐
  │              Verifiable Index Engine                     │
  │         (Canonical Prolly Tree + CAS nodes)             │
  └─────────────────────────┬───────────────────────────────┘
                            │
       ┌────────────┬───────┼───────┬────────────┬──────────┐
       │            │       │       │            │          │
  ┌────▼───┐  ┌────▼──┐  ┌─▼──┐  ┌─▼──────┐  ┌─▼────┐  ┌─▼───────┐
  │ State  │  │Worksp.│  │Life│  │Idempot.│  │Check │  │Causality│
  │ Index  │  │Proj.  │  │cycle│ │Index   │  │point │  │Index    │
  │Adapter │  │Adapter│  │Adp.│  │Adapter │  │Adptr │  │Adapter  │
  └────────┘  └───────┘  └────┘  └────────┘  └──────┘  └─────────┘
```

Each domain adapter normalizes its domain-specific keys and values into canonical `Index Key` and `Index Value Ref` forms before they enter the shared engine. This means:

- One set of membership/non-membership proof algorithms
- One set of structural-sharing and diff algorithms
- One CDC (Content-Defined Chunking) implementation
- Consistent proof format across all domain indexes

## Current Implementation Status

The current `src/` implementation is the host-neutral proof-first package surface. The package root exports the protocol API and `pactium/http` exports its host-controlled transport adapter.

The implementation follows the package protocol documents:

- [Protocol Profile](../protocols/PROFILE.md)
- [Protocols](../protocols/PROTOCOLS.md)

## Implemented Surfaces

The maintained design is implemented by these package surfaces:

| Design area | Implementation anchor |
| --- | --- |
| Protocol constants and hashing | `src/protocol/constants.js`, `src/protocol/hashing.js` |
| Canonical Value | `src/canonical/value.js`: `canonicalEncode`, `canonicalDecode`, `normalizeCanonicalValue` |
| Storage Port | `src/storage/storage-port.js`: `createStoragePort`; `src/storage/local-json-storage-port.js` and `src/storage/sqlite-storage-port.js`: backend adapters |
| Ledger Transparency Log | `src/ledger/transparency-log.js`: `createLedgerTransparencyLog`, inclusion and consistency proof helpers |
| Verifiable Index Engine | `src/index-engine/snapshot-merkle-index.js`: `createVerifiableIndexEngine` |
| Operation lifecycle | `src/core/pactium-core.js`: `beginOperationIntent`, `appendOperationOutcome`, `recordOperation` |
| Workspace Projection | `src/core/pactium-core.js`: `getWorkspaceProjection`, `proveWorkspaceMembership` |
| Proof Envelopes and Bundles | `src/proof/envelope.js`, `src/proof/bundle.js`, `src/core/pactium-core.js`: verification and export surfaces |
| CLI and HTTP facades | `bin/pactium.mjs`, `src/http.js` |

## Non-Surfaces

Separate per-workspace lane queues, repair execution, and pressure-baseline regression enforcement are not current package surfaces.

If a maintained document introduces a design area that cannot be mapped to an implementation anchor, the design must be implemented and documented before release.

## Current Implementation Boundaries

### Index Engine Scalability

- **No-op fast path**: Mutations that do not change structure produce the same root.
- **Path-copying mutations**: `put`, `delete`, and `mutate` descend search paths, rewrite affected leaves and necessary ancestors, collapse single-child roots, and reuse unchanged subtrees.
- **Diff**: Implemented. `diff()` skips equal subtree roots, merges non-aligned child ranges, descends overlap groups, and compares entries at leaf level.
- **Proof compaction**: Membership multiproofs, range proofs, compact non-membership proofs, a global descriptor table, and a self-contained global leaf table are implemented. Index roots are read from CAS nodes rather than protocol-object aliases.

The current implementation is correct, canonical, and deterministic. Throughput-sensitive hosts should validate pressure-profile results against their own workload and persistence backend.

### Proof Size Guard

`maxProofLeafEntries` and `maxProofBytes` produce `proofSizeWarning` on proofs that exceed configured limits. This is a **size guard / diagnostic**, not a constant-size proof format; Pactium proofs remain variable-size.

### Crash Consistency

The JSON backend publishes each domain-separated record into the slot opposite its latest published value, then atomically replaces the fixed-size runtime manifest. Unpublished future records are ignored after a crash, including for records that skipped generations. JSON keeps at most one marker per in-flight lifecycle mutation: it overwrites that marker with a finalized phase and deletes it, so successful work leaves no permanent marker history. Each JSON file is published from a private synchronized temporary file, followed by an atomic rename and parent-directory synchronization. This provides crash detection and recovery guidance, not an ACID multi-file transaction.

SQLite publishes normalized records, the manifest, ledger facts, indexes, and envelopes in one transaction and therefore creates no lifecycle commit markers. `withMutationTransaction()` enters the core mutation lane first, then the storage transaction, and lets nested core mutations reuse that boundary; a failed compound task rolls back both host projection writes and Pactium evidence and refreshes in-memory state from the committed generation. Each lifecycle phase publishes the manifest once.

### Lock Fencing

Write locks use UUID fencing tokens compared as strings. Heartbeat intervals refresh lock freshness. Stale cleanup uses double-read with owner identity verification (ownerId + fencingToken + processStartKey). Ownerless or malformed lock directories are cleaned up using mtime-based staleness with a double-stat safety pattern. Lock cleanup occurs only during write-lock acquisition; `doctor()` does not scan for dirty or stale locks. This is best-effort; production deployments with high contention should consider external lock managers.

### Read-Only Resolvers

External consumers inspect protocol material through the public resolver APIs: `resolveBlock()`, `hasBlock()`, `readLedgerHead()`, `readLedgerLeaf()`, `readProtocolObject()`, and `listProtocolObjectKeys()`. Direct storage, ledger, and index internals are not part of the package root API.
