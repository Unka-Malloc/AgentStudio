<p align="center">
  <img src="docs/logo.svg" alt="Pactium" width="120" />
</p>

<h1 align="center">Pactium</h1>

<p align="center">
  Proof-first protocol substrate for verifiable operation facts, append-only recovery history, and cryptographic state verification.
</p>

<p align="center">
  <a href="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml"><img src="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/pactium"><img src="https://img.shields.io/npm/v/pactium.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/pactium"><img src="https://img.shields.io/npm/dm/pactium.svg" alt="npm downloads" /></a>
  <a href="https://github.com/Unka-Malloc/Pactium/blob/stable/LICENSE"><img src="https://img.shields.io/npm/l/pactium.svg" alt="license" /></a>
  <a href="https://img.shields.io/node/v/pactium"><img src="https://img.shields.io/node/v/pactium.svg" alt="node version" /></a>
  <img src="https://img.shields.io/badge/types-included-blue.svg" alt="TypeScript types" />
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文文档</a> |
  <a href="./docs/API.md">API Reference</a> |
  <a href="./docs/protocols/PROTOCOLS.md">Protocol Spec</a> |
  <a href="https://github.com/Unka-Malloc/Pactium/blob/stable/CONTRIBUTING.md">Contributing</a>
</p>

---

## Table of Contents

- [Why Pactium](#why-pactium)
- [Design Philosophy](#design-philosophy)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Overview](#api-overview)
- [CLI](#cli)
- [Architecture](#architecture)
- [When to Use Pactium](#when-to-use-pactium)
- [Documentation](#documentation)
- [Requirements](#requirements)
- [Verification](#verification)
- [Contributing](#contributing)
- [License](#license)

## Why Pactium

Pactium is the protocol substrate for [LicoLite](https://github.com/Unka-Malloc). It exists to provide LicoLite with durable operation facts, append-only recovery history, and verifiable state -- capabilities that LicoLite's product requirements demand at the protocol level.

Concretely, Pactium provides:

- **Append-only operation ledger** -- records operation facts as immutable entries in a transparency log
- **Cryptographic proofs** -- every write returns a proof envelope with inclusion and consistency proofs
- **Portable verification** -- proof bundles can be verified without access to the original storage
- **Workspace projection** -- verifiable workspace-scoped indexes with membership and non-membership proofs

Pactium is a zero-dependency, pure-ESM Node.js package. It records operation metadata into an append-only transparency log, maintains verifiable indexes, and produces proof envelopes and bundles. It does not replace databases, message queues, or other storage systems that a host might use for its own application data.

The first-class integration surface for LicoLite is at `pactium/licolite`.

## Design Philosophy

| Principle | Meaning |
| --- | --- |
| **Proof-first** | Write operations return verifiable proof envelopes, not storage acknowledgments. The proof is the API response. |
| **Append-only facts** | Full operations use immutable Intent/Outcome facts; terminal-only operations use one immutable Receipt. Corrections create new facts with causality references rather than mutating history. |
| **Single ordering authority** | The Operation Ledger is the only global ordering authority. All other structures derive their ordering from it. |
| **Verifiable indexes** | Every index (state, workspace, lifecycle) uses the same Canonical Prolly Tree engine with membership and non-membership proofs. |
| **Host boundary** | Pactium owns protocol facts and proofs. Host systems own policy decisions, side effects, authorization, and durable evidence storage. |
| **Zero dependencies** | No runtime dependencies. Ships source directly. Predictable supply chain. |
| **Protocol, not configuration** | Hash algorithms, encoding formats, and chunking parameters are protocol constants, not host options. Changes require a new protocol version. |

## Features

| Capability | Description |
| --- | --- |
| **Operation Ledger** | RFC 6962-style transparency log with inclusion and consistency proofs |
| **Append-Only Lifecycle** | Operation Intent / Outcome facts with idempotency replay |
| **Receipt Profiles** | One-fact `receipt` and atomic write-free `on-change` suppression for read-only/terminal evidence |
| **Verifiable Index Engine** | Canonical Prolly Tree with path-copying mutations, membership/non-membership proofs, multiproofs, range proofs, and shared-node diffs |
| **Workspace Projection** | Verifiable workspace-scoped order and membership indexes |
| **Merkle State** | Content-addressed state commits bound to operation outcomes |
| **Checkpoint Tree** | Verifiable recovery and progress structure |
| **Proof Envelopes** | Cross-proof receipts binding ledger, index, state, and checkpoint evidence |
| **Proof Bundles** | Portable CAR-like exports for offline verification |
| **Signed Heads** | Optional Ed25519 ledger head signing with verifier manifests |
| **LicoLite Aspect** | First-class integration surface with default workspace projection and signing |
| **Repair Planning** | Deterministic repair task generation from structured verification failures; repair execution is host-owned |
| **Canonical Value** | Pactium-specific canonical encoding (deterministic JSON + NFC + $bytes + safe integers; not RFC 8785 JCS) |
| **Trust Policy** | Explicit trust model: structural / self-carried-manifest / trusted-manifest-required verification modes |
| **Bounded Storage** | Fixed-size runtime manifest, adaptive Brotli SQLite BLOBs, normalized refs, no-op UPSERT, and conservative derived-index GC |
| **Zero Dependencies** | Pure ESM, no runtime dependencies, ships source directly |

## Installation

```bash
npm install pactium
```

```bash
pnpm add pactium
```

```bash
yarn add pactium
```

### Requirements

- Node.js 22+ or Node.js 24+
- ESM-only (`"type": "module"` in your `package.json`)

## Quick Start

### Record an operation with a verifiable proof envelope

```js
import { createPactium } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

// Record an operation and receive a verifiable proof envelope
const envelope = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-001",
  outcomeIdempotencyKey: "outcome-001",
  input: { path: "docs/readme.md" },
  stateMutations: [
    { key: "docs/readme.md", value: { content: "hello world" } }
  ]
});

// Verify the envelope against local proof material
const result = await pactium.verifyEnvelope(envelope);
console.log(result.ok); // true
```

### Use the LicoLite Aspect

```js
import { createLicoLiteAspect, createLicoLiteSigner } from "pactium/licolite";

const licolite = createLicoLiteAspect({
  evidencePolicy: "production",
  signer: createLicoLiteSigner({
    signerId: "host-signer",
    secret: process.env.LICOLITE_SIGNING_SECRET
  })
});

const envelope = await licolite.recordWorkspaceOperation({
  operationId: "workspace.asset.upload",
  workspaceId: "workspace-a",
  policyEvidence: { decision: "allow", rule: "upload-permitted" },
  workspaceEffectEvidence: { durableRef: "host:asset:image-001" }
});

// LicoLite-level verification checks signing + critical extensions
const result = await licolite.verifyEnvelope(envelope);
console.log(result.ok); // true
```

Production LicoLite mode requires an explicit `signer` or `signerSecret` when recording and verifying envelopes. Opportunistic mode is for local development and may use a development signer.

### Export and verify a portable proof bundle

```js
import { createPactium, verifyProofBundle } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

// Export envelope as a portable bundle
const bundle = await pactium.exportProofBundle(envelope);

// Verify without access to local storage
const result = await verifyProofBundle(bundle);
console.log(result.ok); // true
```

## API Overview

Pactium exposes three package entry points:

| Export | Entry | Description |
| --- | --- | --- |
| `pactium` | `./src/index.js` | Core proof-first protocol API |
| `pactium/http` | `./src/http.js` | HTTP adapter for host-controlled service integration |
| `pactium/licolite` | `./src/aspects/licolite/index.js` | LicoLite integration aspect |

### Core API (`pactium`)

```js
import {
  // Instance
  createPactium,

  // Protocol constants
  PACTIUM_PROTOCOL,
  PACTIUM_SCHEMA_VERSION,
  PACTIUM_PROTOCOL_PROFILE,

  // Canonical encoding
  canonicalEncode,
  canonicalDecode,
  normalizeCanonicalValue,

  // Protocol hashing
  protocolHash,
  protocolHashHex,
  cidForBytes,
  cidForCanonical,

  // Storage
  createStoragePort,
  resolveDataDir,

  // Ledger
  createLedgerTransparencyLog,
  createLedgerInclusionProof,
  verifyLedgerInclusionProof,
  createLedgerConsistencyProof,
  verifyLedgerConsistencyProof,

  // Verifiable Index Engine
  createVerifiableIndexEngine,
  verifyIndexProof,

  // Proof verification
  verifyProofEnvelope,
  verifyProofBundle,
  createDefaultProofVerifierRegistry,

  // Maintenance and repair (planning — hosts execute plans)
  createRepairPlanner,
  createMaintenanceTaskEngine,

  // HTTP adapter
  createPactiumHttpServer,
  startPactiumHttpServer
} from "pactium";
```

### HTTP Adapter (`pactium/http`)

```js
import {
  createPactiumHttpServer,
  startPactiumHttpServer
} from "pactium/http";
```

The HTTP adapter exposes operation lifecycle, envelope and bundle verification, proof bundle export, workspace projection, cursor paging, append-condition, trusted-head, repair, maintenance, extension, and envelope storage calls as JSON routes. By default, the HTTP adapter starts in read-only mode; set `enableMutations: true` to enable write operations. An `authorize(ctx)` hook is available for host-controlled access control. See [docs/API.md](./docs/API.md#http-adapter-api-pactiumhttp) for the full route matrix.

**Important**: The HTTP adapter is a host-controlled internal adapter. It is not designed as a default public-facing network service. Hosts must provide their own authentication, authorization, and transport security controls.

### LicoLite Aspect (`pactium/licolite`)

```js
import {
  createLicoLiteAspect,
  createLicoLiteSigner,
  recordLicoLiteWorkspaceOperation,
  verifyLicoLiteEnvelope,
  verifyLicoLiteBundle,
  LICOLITE_ASPECT_PROTOCOL,
  LICOLITE_CRITICAL_EXTENSIONS
} from "pactium/licolite";
```

### TypeScript

Pactium ships hand-written TypeScript declarations. All public types are available from the package entry points:

```ts
import type {
  PactiumCore,
  PactiumProofEnvelope,
  PactiumVerificationResult,
  PactiumProofBundle,
  PactiumLedgerHead,
  PactiumVerificationFailure
} from "pactium";

import type {
  LicoLiteAspect,
  LicoLiteSigner
} from "pactium/licolite";
```

For the complete API reference, see [docs/API.md](./docs/API.md).

## CLI

Pactium ships a CLI for local operation recording and verification:

```bash
# Check data directory health
pactium doctor --data-dir ./.pactium

# Start the HTTP verification server
pactium serve --port 7288

# Record an operation
pactium operation record --body '{"operationId":"test","workspaceId":"ws"}'

# Verify a proof envelope
pactium envelope verify --body-file ./envelope.json

# Verify a proof bundle
pactium bundle verify --body-file ./bundle.json

# LicoLite workspace operations
pactium licolite record --body '{"operationId":"ws.op","workspaceId":"ws"}'
pactium licolite verify --body-file ./licolite-envelope.json
```

The CLI reads JSON from `--body`, `--body-file`, or stdin.

### Crash consistency & recovery

Pactium uses write-ahead commit markers for crash consistency. Operation lifecycle commits (`beginOperationIntent` and `appendOperationOutcome`) write pending/complete commit markers before work begins and after `runtime-state` is saved. `recordOperation()` consists of two lifecycle commits: intent + outcome. Materialization operations such as `storeEnvelope` and `createExtension` write content-addressed blocks plus the envelope reference registry but are not covered by lifecycle commit markers. `exportProofBundle` is a pure read that derives the bundle from immutable content-addressed blocks. `doctor()` scans for incomplete commits (pending without complete) and reports them as repairable failures.

The HTTP route `/bundles/export` remains gated behind the mutation capability switch because it exports raw proof block payloads, but it is not a ledger lifecycle commit and does not mutate runtime state.

```bash
# Run standard integrity checks
pactium doctor --data-dir ./.pactium

# Replay ledger leaves to rebuild derived state and compare roots
pactium doctor --data-dir ./.pactium --rebuild
```

`doctor({ rebuild: true })` replays all ledger leaves to reconstruct derived index roots and compares them against the stored `runtime-state`. Roots are categorized:

- **Fully comparable** (`openIntent`, `outcome`, `causality`, workspace `orderRoot`/`membershipRoot`): strict comparison — mismatches report `derived_root_mismatch`.
- **Partially comparable** (`intentIdempotency`, `outcomeIdempotency`, workspace `checkpointRoot`): may need material not in old ledger facts — mismatches produce `*_rebuild_incomplete` warnings.
- **Skipped** (workspace `stateRoot`): state mutations are not in ledger facts — reports `state_rebuild_incomplete`.

`pactium serve` binds to `127.0.0.1` by default and enforces a 1 MiB JSON body limit. Use `--host`, `--max-body-bytes`, `PACTIUM_HTTP_HOST`, and `PACTIUM_HTTP_MAX_BODY_BYTES` only when the server is behind the host system's authentication, authorization, and transport security controls.

## Architecture

```
                    Host System (LicoLite)
                           |
                    pactium/licolite
                           |
            +--------------+---------------+
            |       Pactium Core           |
            |                              |
            |  +------------------------+  |
            |  | Canonical Value + Hash |  |
            |  +------------------------+  |
            |  | Storage Port (CAS)     |  |
            |  +------------------------+  |
            |  | Operation Ledger       |  |  <- Global ordering authority
            |  | (Transparency Log)     |  |
            |  +------------------------+  |
            |  | Verifiable Index Engine|  |  <- Shared Prolly Tree
            |  +------------------------+  |
            |  | Workspace Projection   |  |
            |  | Merkle State           |  |
            |  | Checkpoint Tree        |  |
            |  | Lifecycle Indexes      |  |
            |  +------------------------+  |
            |  | Proof Envelopes        |  |
            |  | Proof Bundles          |  |
            |  +------------------------+  |
            |  | Repair Planner         |  |
            |  | Maintenance Engine     |  |
            |  +------------------------+  |
            +------------------------------+
```

**Key design principles:**

- The Operation Ledger is the single global ordering authority
- All indexes share one Verifiable Index Engine (Canonical Prolly Tree)
- Write operations return verifiable proof envelopes, not storage records
- Proof Bundles enable verification without access to original storage
- Host systems own policy, side effects, and durable evidence storage

For detailed architecture documentation, see [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md).

### Current Implementation Boundaries

Pactium is actively developed. The following areas are in active refinement:

**Index Engine Scalability:**
The Verifiable Index Engine supports a no-op fast path and full path-copying mutations. `put`, `delete`, and `mutate` descend the search path, rewrite the affected leaf plus necessary ancestors, collapse single-child roots, and reuse unchanged subtrees. `diff()` traverses Prolly nodes, skips equal subtree roots, and handles non-aligned child ranges before falling back to leaf-level comparison. Membership proofs, compact non-membership proofs, membership multiproofs, and range proofs all use descriptor-table compaction.

**Proof Size Guard (not bounded proof format):**
`maxProofLeafEntries` and `maxProofBytes` options produce `proofSizeWarning` on generated and verified proofs. This is a size guard / diagnostic, not a bounded proof format. By default, `proofSizeWarning` is non-fatal (severity: warning). Set `failOnProofSizeWarning: true` to treat it as a hard failure.

**Storage Backends and Crash Consistency:**
`createStoragePort()` defaults to `storageBackend: "auto"` for persistent data directories: Pactium chooses SQLite for new directories when a supported provider is available (`node:sqlite` or optional npm `better-sqlite3`), otherwise JSON. Existing data directories stay bound to the backend recorded in `pactium-manifest.json`; Pactium does not silently switch an initialized directory to another backend. The JSON backend is intended for local development, low-concurrency use, and debugging. SQLite is the production local-durability candidate; distributed multi-node deployments still need an external consistency layer. See [docs/API.md](./docs/API.md#crash-consistency-and-doctor) for details.

**Lock Heartbeat / Fencing (best-effort):**
Write locks use heartbeat intervals and fencing tokens for stale detection and cross-process safety. Fencing token comparison uses string equality (UUID strings, not numeric). Stale lock cleanup performs a double-read with owner identity verification. Dirty/ownerless lock directories are cleaned up safely using directory mtime-based staleness with a double-stat pattern. Lock cleanup occurs only during write-lock acquisition; `doctor()` does not scan for dirty or stale locks. This is a best-effort mechanism; for production deployments with high contention, consider external lock managers.

## When to Use Pactium

**Use Pactium when you need:**

- Cryptographic proof that an operation was recorded and the ledger is consistent
- Portable proof bundles that can be verified without the original system
- Workspace-scoped operation isolation with verifiable membership
- Append-only operation history with deterministic recovery
- Idempotent operation recording with replay detection
- Verifiable state roots with path-copying mutations and deterministic shared-node diffs

**Pactium is not for:**

- General-purpose database storage (use a database)
- Network consensus between distributed nodes (Pactium is a local protocol substrate)
- Authorization or access control (host systems own policy)
- File storage or blob management (Pactium stores operation metadata and proofs)

## Documentation

| Document | Description |
| --- | --- |
| [API Reference](./docs/API.md) | Complete public API documentation |
| [Architecture](./docs/architecture/ARCHITECTURE.md) | System architecture and module structure |
| [Protocol Specification](./docs/protocols/PROTOCOLS.md) | Protocol behavior and data flow |
| [Protocol Profile](./docs/protocols/PROFILE.md) | Protocol parameter matrix |
| [Canonical Encoding](./docs/protocols/CANONICAL-ENCODING.md) | Formal Pactium Canonical Value encoding rules |
| [Trust Anchors](./docs/protocols/TRUST-ANCHORS.md) | Production trust policy and signer governance |
| [LicoLite Aspect](./docs/LICOLITE-ASPECT.md) | LicoLite integration surface |
| [Terms](./docs/TERM.md) | Protocol glossary and vocabulary |
| [FAQ](./docs/FAQ.md) | Frequently asked questions |
| [Migration Guide](./docs/MIGRATION.md) | Version compatibility and upgrade guidance |
| [Examples Guide](./examples/README.md) | Annotated usage examples |
| [Quality Gates](https://github.com/Unka-Malloc/Pactium/blob/stable/docs/QUALITY-GATES.md) | Release verification requirements |
| [ADRs](https://github.com/Unka-Malloc/Pactium/tree/stable/docs/adr) | Architecture Decision Records (55 decisions) |

## Requirements

| Requirement | Version |
| --- | --- |
| Node.js | `^22.0.0 \|\| ^24.0.0` |
| Module system | ESM only (`"type": "module"`) |
| Runtime dependencies | None |

Pactium is a pure ESM package. It cannot be `require()`'d from CommonJS modules. If you need CJS interop, use dynamic `import()`.

## Verification

Run the full release gate locally:

```bash
npm run verify:release
```

This runs coverage-enforced tests, protocol proof vectors, regression snapshots, seeded property tests, scaled public API pressure profiles, hygiene checks, package-content checks, package dry run, and publish dry run.

For full-count pressure profiles (explicit release review):

```bash
PACTIUM_FULL_PRESSURE=1 npm run verify:protocol:gates
```

## Ecosystem

| Package | Description |
| --- | --- |
| [`pactium`](https://www.npmjs.com/package/pactium) | Core protocol substrate (this package) |
| `pactium/licolite` | First-class LicoLite integration aspect (included) |

Pactium is the protocol substrate for [LicoLite](https://github.com/Unka-Malloc). The `pactium/licolite` aspect is a first-class package export, not an external plugin.

## Contributing

See [CONTRIBUTING.md](https://github.com/Unka-Malloc/Pactium/blob/stable/CONTRIBUTING.md) for development setup, coding standards, and submission guidelines.

## License

[GPL-3.0-or-later](./LICENSE) -- Copyright (c) Unka Y.Y.
