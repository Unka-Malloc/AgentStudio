# Frequently Asked Questions

## General

### What is Pactium?

Pactium is a proof-first protocol substrate for Node.js. It records operation facts into an append-only transparency log and produces cryptographic proofs that operations were recorded and the ledger history is consistent. It is designed as the protocol substrate for LicoLite.

### What does "proof-first" mean?

Every write operation returns a verifiable proof envelope rather than a simple acknowledgment. The proof is the API response -- it includes ledger inclusion proofs, index proofs, and content-addressed references that can be independently verified.

### Is Pactium a database?

No. Pactium is a protocol substrate that records operation metadata and produces cryptographic proofs. It maintains verifiable indexes and state roots, but it is not a general-purpose data store. Host systems own their application data, business logic, and side effects.

### Is Pactium a blockchain?

No. Pactium is a local protocol substrate, not a distributed consensus system. It uses a transparency log (similar to Certificate Transparency) for append-only operation recording and Merkle proofs for verification, but it does not run a network, perform consensus, or require gas/tokens.

### What is the relationship between Pactium and LicoLite?

Pactium exists to serve LicoLite as its protocol substrate. LicoLite is the primary host, and `pactium/licolite` is a first-class package aspect (not a plugin). LicoLite requirements may shape Pactium core capabilities.

---

## Installation and Setup

### Why does Pactium require Node.js 22+?

Pactium uses modern Node.js APIs (built-in test runner, structured clone, modern crypto) that are stable in Node.js 22 LTS. It also supports Node.js 24 for forward compatibility.

### I get `ERR_REQUIRE_ESM` -- what do I do?

Pactium is a pure ESM package. It cannot be loaded with `require()`. Options:

1. Add `"type": "module"` to your `package.json`
2. Rename your file to `.mjs`
3. Use dynamic import: `const { createPactium } = await import("pactium")`

### Does Pactium have any runtime dependencies?

No. Pactium has zero runtime dependencies. It uses only Node.js built-in modules (`node:crypto`, `node:fs`, `node:path`, etc.).

### Where does Pactium store data?

By default, Pactium stores data in the directory you specify via `dataDir` option (e.g., `./.pactium`). You can also use `inMemory: true` for testing. The storage format is content-addressed JSON files managed through the Storage Port abstraction.

---

## Usage

### How do I record an operation?

```js
import { createPactium } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

const envelope = await pactium.recordOperation({
  operationId: "my.operation",
  workspaceId: "my-workspace",
  idempotencyKey: "unique-intent-key",
  outcomeIdempotencyKey: "unique-outcome-key",
  input: { /* your operation input */ },
  stateMutations: [
    { key: "state-key", value: { /* your state */ } }
  ]
});
```

### What happens if I record the same operation twice?

If you use the same `idempotencyKey`, Pactium returns an Idempotency Replay -- the existing proof envelope is returned without appending a new ledger fact. The replay is marked so callers can distinguish it from a new commit.

### How do I verify a proof?

```js
// Local verification (requires Pactium instance)
const result = await pactium.verifyEnvelope(envelope);

// Portable verification (no local storage needed)
import { verifyProofBundle } from "pactium";
const bundle = await pactium.exportProofBundle(envelope);
const result = await verifyProofBundle(bundle);
```

### What is a Proof Bundle and when should I use it?

A Proof Bundle is a portable, self-contained export that includes all content-addressed blocks needed for verification. Use it when:

- You need to verify a proof without access to the original Pactium storage
- You want to share verification material with external parties
- You want to archive proof material independently from the data directory
- You need to preserve verification capability across Pactium version upgrades

### What is the difference between Intent and Outcome?

- **Operation Intent** declares what the host intends to do (recorded before the operation)
- **Operation Outcome** declares the result (recorded after the operation completes or fails)

Both are append-only facts. The Intent is never mutated into the Outcome. Failed and successful outcomes are both recorded as facts.

### Can I use Pactium without LicoLite?

Yes. The core `pactium` export is independent. `pactium/licolite` is a first-class aspect for LicoLite hosts, but you can use the core API directly for any host system that needs verifiable operation recording.

---

## Architecture

### Why is there only one Verifiable Index Engine?

Pactium uses a shared Canonical Prolly Tree-based engine for all indexes (state, workspace, lifecycle, idempotency, causality). Domain adapters convert domain-specific material into canonical keys and values. This eliminates the complexity of maintaining multiple independent tree implementations while keeping proofs consistent.

### Why are hash algorithms and chunking not configurable?

These are protocol constants, not tuning options. If a verifier expects `sha256` and the writer used `sha3`, proofs would be incompatible. Protocol parameters are fixed per protocol version to ensure all parties can verify proofs without negotiation.

### What does the host system own vs. what does Pactium own?

**Pactium owns:** Protocol facts, canonical encoding, hash computation, ledger ordering, index proofs, verification, proof generation, repair planning.

**Host owns:** Policy decisions (allow/deny), operation dispatching, side-effect execution, authorization, durable evidence storage, UI, key management and rotation.

### How does workspace isolation work?

Each operation is associated with a `workspaceId`. Pactium maintains per-workspace projection indexes (order and membership) that are verifiable. You can prove that a ledger event belongs to a specific workspace, or prove that it does not belong, using Merkle proofs from the shared index engine.

---

## Verification

### What does verification actually check?

Envelope verification checks:

1. Ledger inclusion proof validity (leaf is in the ledger at the stated tree size)
2. Content-addressed proof material integrity (referenced blocks match their CIDs)
3. Index proof validity (state/workspace proofs are mathematically correct)
4. Critical extension support (all required extensions are understood)
5. Signed Ledger Head validity when verifier manifest material is present (default core recording signs heads unless unsigned mode is explicit)

### What is a "critical extension"?

A critical extension is a Proof Extension that must be understood by the verifier. If a verifier encounters an unknown critical extension, verification fails. This prevents silently ignoring important evidence bindings.

LicoLite uses two critical extensions: Policy Extension and Workspace Effect Extension.

### What happens when verification fails?

Pactium returns structured Verification Failures (not thrown exceptions). Each failure includes:

- `layer` -- which verification layer failed (ledger, index, envelope, extension)
- `code` -- machine-readable failure code
- `severity` -- critical, warning, or info
- `repairable` -- whether the Repair Planner can address it

You can feed failures to the Repair Planner to generate deterministic repair tasks.

---

## Troubleshooting

### "Storage not initialized" error

Call `createPactium()` or `createStoragePort()` with a valid `dataDir`. The data directory is created automatically on first use.

### Verification returns unexpected failures

- Ensure you're verifying against the same Pactium instance (or use Proof Bundles for portable verification)
- Check that proof material refs are resolvable (content-addressed blocks exist in storage)
- For LicoLite envelopes, ensure the verifier supports the required critical extensions

### Proof Bundle verification fails but envelope verification passes

This usually means the bundle export is incomplete. Ensure `exportProofBundle()` was called with a valid envelope and that the bundle contains all required content-addressed blocks.

### "Consistency proof failed" between two ledger heads

This means the ledger history diverged -- a later ledger state is not a valid continuation of the earlier one. This is a security-critical finding that indicates the ledger was rewritten or forked.

### Performance concerns with large indexes

The Prolly Tree engine uses structural sharing and Content-Defined Chunking for efficient updates. For large state sets, consider:

- Using the `scan()` and `prefix()` methods for range queries instead of full snapshots
- Using `diff()` to compute changes between state roots (canonical diff API; note that current implementation is not yet Dolt-style skip-common-subtree optimized — P3 deferred)
- Checking memory usage with the pressure profile: `PACTIUM_FULL_PRESSURE=1 npm run verify:protocol:gates`

### What trust policies does Pactium support?

Pactium supports three trust policies via the `trustPolicy` option on `verifyEnvelope()` and `verifyProofBundle()`:

| Mode | Behavior |
| --- | --- |
| `structural` (least trust) | Verifies proof structure only. Skips all signature verification. |
| `self-carried-manifest` (default) | Verifies proof structure + validates signatures against the manifest embedded in the proof material. Does **not** require a caller-supplied trusted manifest. `ledgerHeadTrusted` is always `false`. |
| `trusted-manifest-required` (most trust) | Requires a caller-supplied `trustedManifest`. Verifies proof structure + validates signatures against the trusted manifest. `ledgerHeadTrusted` can be `true`. |

A **self-carried manifest** (embedded in the proof) is NOT a trusted manifest. It provides format-level signature validation but not trust. Only a caller-supplied `trustedManifest` establishes trust.

### What is the difference between full and sampled state mutation proofs?

State mutation proofs use **sampled mode** by default when there are more than 32 mutations. In sampled mode, the **first 32 touched keys in canonical mutation order** are proven. Set `requireFullStateMutationProofs: true` to require all mutation keys to be proven individually (proofCompleteness becomes `full`). When `requireFullStateMutationProofs` is true and the proof is sampled, verification fails.

### Does the local JSON backend provide ACID transactions?

No. The local JSON backend uses **write-ahead commit markers** (pending/complete) with `doctor()` diagnostics for crash detection. This is a WAL marker + diagnostic pattern, not an ACID database transaction.

**Commit marker coverage boundaries:**
- Commit markers currently cover operation lifecycle commits only: `beginOperationIntent`, `appendOperationOutcome`, and `recordOperation` (which combines both).
- Materialization/cache operations (`exportProofBundle`, `storeEnvelope`, `createExtension`) may write storage or runtime-state but are not covered by lifecycle commit markers.
- The local JSON backend remains a WAL-marker + diagnostic pattern, not ACID.

For production deployments requiring full crash recovery guarantees, consider a storage backend with transactional semantics.

### Are proofs constant-size (bounded)?

No. The `maxProofLeafEntries` and `maxProofBytes` options are **size guards**, not a bounded proof format. They produce `proofSizeWarning` when limits are exceeded. By default this is a non-fatal warning. Set `failOnProofSizeWarning: true` for hard failures. Bounded (constant-size) proofs are a future protocol goal.

### Is the index engine a fully optimized Prolly Tree?

The index engine is **correct and canonical** but not yet fully optimized for large-scale workloads. Key limitations:
- Single-key mutations use local-window rechunking (not full path-copying).
- Diff does not yet skip identical subtrees via root hash comparison (Dolt-style).
- Cursor/chunker path-copying is planned (P3 deferred).

For current throughput characteristics, run the pressure profile: `PACTIUM_FULL_PRESSURE=1 npm run verify:protocol:gates`.
