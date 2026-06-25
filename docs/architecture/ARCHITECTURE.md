# Pactium Architecture

Pactium is a proof-first protocol substrate for LicoLite. LicoLite is the primary host, and `pactium/licolite` is a first-class package aspect rather than an external plugin.

## System Overview

```text
LicoLite host
  -> pactium/licolite
       -> Proof-first Pactium core
            -> Canonical Value encoding and Protocol Hash
            -> Storage Port and content-addressed blocks
            -> Operation Ledger Transparency Log
            -> Shared Verifiable Index Engine
            -> Operation Lifecycle indexes
            -> Workspace Projection
            -> Merkle State
            -> Checkpoint Tree
            -> Proof Envelopes and Proof Bundles
            -> Maintenance Task Engine and Repair Planner
```

## Module Dependency Graph

```text
                    ┌─────────────────────┐
                    │   pactium/licolite   │  LicoLite Aspect
                    │  (aspect.js, etc.)   │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │    pactium (core)     │  Public API facade
                    │    src/index.js       │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌─────▼──────────┐
    │  Pactium Core  │  │   Proof    │  │  Maintenance   │
    │  pactium-core  │  │ envelope   │  │  task-engine   │
    │                │  │ bundle     │  │  repair plan   │
    └───────┬────────┘  └─────┬──────┘  └────────────────┘
            │                 │
    ┌───────┼─────────────────┼──────────────────┐
    │       │                 │                  │
    │  ┌────▼────┐  ┌────────▼───────┐  ┌──────▼──────┐
    │  │ Ledger  │  │ Index Engine   │  │ Verification│
    │  │ transp. │  │ snapshot-      │  │ failure.js  │
    │  │ log     │  │ merkle-index   │  └─────────────┘
    │  └────┬────┘  └────────┬───────┘
    │       │                │
    │  ┌────▼────────────────▼───────┐
    │  │     Protocol Layer          │
    │  │  canonical/value.js         │
    │  │  protocol/constants.js      │
    │  │  protocol/hashing.js        │
    │  └─────────────┬───────────────┘
    │                │
    │  ┌─────────────▼───────────────┐
    │  │     Storage Port            │
    │  │  storage-port.js            │
    │  │  json/sqlite adapters       │
    │  └─────────────────────────────┘
    └────────────────────────────────────────────┘
```

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
  │ 2. Canonical Encode         │ Normalize input to PactiumCanonicalValue
  │    + Protocol Hash          │ Compute content-addressed identifiers
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

## LicoLite Boundary

Pactium owns protocol facts, proof algorithms, canonical encoding, storage ports, verification, repair planning, and LicoLite protocol-substrate adapters.

LicoLite owns runtime policy decisions, operation dispatching, side effects, UI ownership, authorization, and durable Host Evidence storage. Pactium binds LicoLite policy and workspace-effect evidence as critical proof extensions and verifies those bindings.

```text
  ┌──────────────────────────────────────────────────────┐
  │                    LicoLite Host                      │
  │                                                      │
  │  Policy     Operations    Side Effects    Evidence   │
  │  Decisions  Dispatching   Execution       Storage    │
  │                                                      │
  └────────────────────────┬─────────────────────────────┘
                           │
              ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─  Host Boundary
                           │
  ┌────────────────────────▼─────────────────────────────┐
  │                  pactium/licolite                     │
  │                                                      │
  │  Signing    Critical Extensions    Workspace Proj.   │
  │  Authority  (policy + effects)     (default: on)     │
  │                                                      │
  └────────────────────────┬─────────────────────────────┘
                           │
  ┌────────────────────────▼─────────────────────────────┐
  │                   Pactium Core                       │
  │                                                      │
  │  Ledger   Index Engine   Proofs   Repair   Storage   │
  │                                                      │
  └──────────────────────────────────────────────────────┘
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
  │   ├── core/              Core runtime state
  │   ├── ledger/            Ledger entries, heads, compact range
  │   ├── ledger-head/       Historical ledger heads
  │   ├── ledger-leaf/       Per-index ledger leaves
  │   ├── ledger-node/       Merkle tree nodes
  │   └── index/             Index roots (keyed by domain-hash)
  └── locks/                 Write-lock directories
      └── <name>.lock/       Per-lock directory
          └── owner.json     Lock owner metadata (pid, ownerId, timestamp)
```

The Storage Port abstraction separates Pactium's protocol logic from persistence mechanics. The current implementation ships local JSON and SQLite adapters behind a manifest-bound factory. `createStoragePort()` defaults to auto backend selection for persistent directories: SQLite is selected for new directories when an implemented provider is available (`node:sqlite` or optional npm `better-sqlite3`), otherwise JSON. JSON is intended for local development, low-concurrency use, and debugging. SQLite is the production local-durability candidate; distributed multi-node deployments still require an external consistency layer. Storage backends may change how bytes are stored but cannot change canonical encoding, hash computation, or proof semantics.

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

The current `src/` implementation is the proof-first package surface. The package root exports proof-first APIs, and `pactium/licolite` exports the first-class LicoLite Aspect.

The implementation follows the package protocol and aspect documents:

- [Protocol Profile](../protocols/PROFILE.md)
- [Protocols](../protocols/PROTOCOLS.md)
- [LicoLite Aspect](../LICOLITE-ASPECT.md)

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
| LicoLite Aspect | `src/aspects/licolite/`: `createLicoLiteAspect`, `createLicoLiteSigner`, evidence helpers, verifier |
| CLI and HTTP facades | `bin/pactium.mjs`, `src/http.js` |

## Non-Surfaces

Maintained docs must not describe separate per-workspace lane queues, repair fact execution, or pressure baseline regression enforcement as implemented unless those surfaces are added and verified.

If a maintained document introduces a design area that cannot be mapped to an implementation anchor, the design must be implemented and documented before release.

## Current Implementation Boundaries

### Index Engine Scalability

- **No-op fast path**: Mutations that do not change structure produce the same root.
- **Path-copying mutations**: `put`, `delete`, and `mutate` descend search paths, rewrite affected leaves and necessary ancestors, collapse single-child roots, and reuse unchanged subtrees.
- **Diff**: Implemented. `diff()` skips equal subtree roots, merges non-aligned child ranges, descends overlap groups, and compares entries at leaf level.
- **Proof compaction**: Membership multiproofs, range proofs, compact non-membership proofs, and proof-material descriptor-table deduplication are implemented.

The current implementation is correct, canonical, and deterministic. Throughput-sensitive hosts should validate pressure-profile results against their own workload and persistence backend.

### Proof Size Guard

`maxProofLeafEntries` and `maxProofBytes` produce `proofSizeWarning` on proofs that exceed configured limits. This is a **size guard / diagnostic**, not a bounded (constant-size) proof format. Bounded proofs are a future protocol goal.

### Crash Consistency

The JSON backend uses write-ahead commit markers (pending/complete) with `doctor()` diagnostics. Commit markers cover operation lifecycle commits (`beginOperationIntent`, `appendOperationOutcome`, `recordOperation`, and the per-operation commits inside `recordOperations`). Materialization operations (`exportProofBundle`, `storeEnvelope`, `createExtension`) may write storage or runtime-state but are not lifecycle commits. This provides crash detection and recovery guidance. It is not an ACID database transaction. The SQLite adapter uses SQLite transactions for `withWriteLock()` scopes, but Pactium still treats the Storage Port as a persistence adapter rather than part of the proof semantics.

### Lock Fencing

Write locks use UUID fencing tokens compared as strings. Heartbeat intervals refresh lock freshness. Stale cleanup uses double-read with owner identity verification (ownerId + fencingToken + processStartKey). Ownerless or malformed lock directories are cleaned up using mtime-based staleness with a double-stat safety pattern. Lock cleanup occurs only during write-lock acquisition; `doctor()` does not scan for dirty or stale locks. This is best-effort; production deployments with high contention should consider external lock managers.

### Read-Only Resolvers

External consumers inspect protocol material through the public resolver APIs: `resolveBlock()`, `hasBlock()`, `readLedgerHead()`, `readLedgerLeaf()`, `readProtocolObject()`, and `listProtocolObjectKeys()`. Direct storage, ledger, and index internals are not part of the package root API.
