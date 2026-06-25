# Pactium API Reference

This document covers the complete public API surface of the `pactium` package.

## Entry Points

| Export path | Description |
| --- | --- |
| `pactium` | Core proof-first protocol API |
| `pactium/http` | HTTP adapter for the proof-first protocol API |
| `pactium/licolite` | LicoLite integration aspect |

---

## API Completeness Audit

The 2026-06-20 public API audit compared Pactium's exposed surface with the practical API patterns used by Trillian/Rekor-style transparency logs, CAR/IPLD-style portable block archives, Hypercore-style signed append-only feeds, and EventStore/Axon-style append conditions, cursors, and recovery flows.

The algorithmic protocol surface already exposed the required primitives through `pactium`: append-only writes, inclusion and consistency proofs, signed heads, verifiable indexes, workspace projections, proof bundles, cursors, append conditions, and repair planning. The missing surface was the HTTP adapter: `pactium serve` existed, but package consumers could not import it through a package export, and HTTP clients could only record operations and verify proof envelopes. That forced server-based upstreams to bypass package exports or reimplement bundle export, workspace queries, cursor paging, and recovery calls locally.

This gap is closed by making `pactium/http` a public entry point and by aligning the HTTP routes with the proof-first core capabilities. The adapter remains a transport layer only: it does not add authentication, authorization, business policy, witness networking, or host side-effect execution.

## Core API (`pactium`)

### `createPactium(options?)`

Creates a Pactium instance with full protocol capabilities.

```js
import { createPactium } from "pactium";

const pactium = createPactium({
  dataDir: "./.pactium",  // Data directory path (default: ~/.pactium)
  inMemory: false,        // Use in-memory storage (for testing)
  storage: null           // Provide a pre-configured StoragePort
});
```

**Returns:** `PactiumCore`

The returned instance exposes:

| Property | Type | Description |
| --- | --- | --- |
| `protocol` | `string` | Protocol identifier (`pactium.v0.2`) |
| `schema` | `string` | Schema version |
| `dataDir` | `string` | Resolved data directory path |

**Read-only resolvers (recommended for external consumers):**

| Method | Description |
| --- | --- |
| `resolveBlock(cid)` | Resolve a CAS block by CID. Returns a canonical clone. |
| `hasBlock(cid)` | Check whether a CAS block exists. |
| `readLedgerHead(id?)` | Read the current ledger head, or a specific head by ID. |
| `readLedgerLeaf(index)` | Read a ledger leaf by index. |
| `readProtocolObject(scope, key, fallback?)` | Read a protocol object. Returns a canonical clone. |
| `listProtocolObjectKeys(scope)` | List all keys in a protocol object scope. |

**Advanced (deprecated for external use):**

| Property | Type | Description |
| --- | --- | --- |
| `advanced.storage` | `PactiumStoragePort` | **@deprecated** Prefer read-only resolvers. |
| `advanced.ledger` | `PactiumLedger` | **@deprecated** Prefer `readLedgerHead()`/`readLedgerLeaf()`. |
| `advanced.indexEngine` | `PactiumIndexEngine` | **@deprecated** Internal, unstable API. |

`pactium.advanced` remains an internal maintenance and diagnostics surface. Application code should use the public lifecycle, resolver, verification, and bundle APIs.

---

### Operation Lifecycle

#### `pactium.recordOperation(input)`

Records a complete operation (intent + outcome) in a single call. This is the high-level convenience API.

```js
const envelope = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-unique-key",
  outcomeIdempotencyKey: "outcome-unique-key",
  input: { path: "file.txt" },
  outcome: "success",
  stateMutations: [
    { key: "file.txt", value: { content: "data" } }
  ]
});
```

For operations with many `stateMutations`, Pactium emits bounded state mutation proofs by default: the first 32 unique touched keys in canonical key order receive individual `touchedKeyProofs`. If the same key appears more than once in one state commit, the State Commit records the key's final net effect, using the last mutation for that key. Hosts that need strict per-key verification can request full proof generation at write time:

```js
const envelope = await pactium.recordOperation({
  operationId: "workspace.batch.write",
  workspaceId: "workspace-a",
  idempotencyKey: "batch-intent",
  outcomeIdempotencyKey: "batch-outcome",
  proofOptions: { stateMutationProofMode: "full" },
  stateMutations: manyMutations
});
```

Relevant proof-generation options:

| Field | Type | Description |
| --- | --- | --- |
| `proofOptions.stateMutationProofMode` | `"sampled" \| "full"?` | Choose bounded 32-key state mutation proofs or full per-key proofs over unique touched keys |
| `proofOptions.fullStateMutationProofs` | `boolean?` | Alias for `stateMutationProofMode: "full"` |

**Returns:** `PactiumProofEnvelope`

#### `pactium.recordOperations(inputs)`

Records multiple complete operations through one public batch mutation surface. Each input has the same shape as `recordOperation(input)`. Pactium preserves operation order, records each operation as Intent plus Outcome, and returns the resulting outcome envelopes.

```js
const batch = await pactium.recordOperations([
  {
    operationId: "workspace.file.write",
    workspaceId: "workspace-a",
    idempotencyKey: "batch-intent-1",
    outcomeIdempotencyKey: "batch-outcome-1",
    stateMutations: [{ key: "a.txt", value: { content: "A" } }]
  },
  {
    operationId: "workspace.file.write",
    workspaceId: "workspace-a",
    idempotencyKey: "batch-intent-2",
    outcomeIdempotencyKey: "batch-outcome-2",
    stateMutations: [{ key: "b.txt", value: { content: "B" } }]
  }
]);
// { batchType: "pactium.operation-record-batch", count: 2, envelopes: [...] }
```

**Returns:** `{ protocol, batchType, count, envelopes }`

#### `pactium.beginOperationIntent(input)`

Records an Operation Intent fact. Use this for two-phase operation lifecycle.

```js
const intentEnvelope = await pactium.beginOperationIntent({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-key",
  input: { path: "file.txt" }
});
```

**Returns:** `PactiumProofEnvelope` -- The envelope's `factRef` references the intent.

#### `pactium.appendOperationOutcome(input)`

Records an Operation Outcome fact that closes an existing intent.

```js
const outcomeEnvelope = await pactium.appendOperationOutcome({
  intentId: intentEnvelope.factId,
  workspaceId: "workspace-a",
  idempotencyKey: "outcome-key",
  outcome: "success",
  stateMutations: [
    { key: "file.txt", value: { content: "data" } }
  ]
});
```

**Returns:** `PactiumProofEnvelope`

#### `pactium.lookupOpenIntent(intentId)`

Looks up an Operation Intent that does not yet have a corresponding outcome.

```js
const openIntent = await pactium.lookupOpenIntent("intent-id");
// Returns the intent record or null
```

#### `pactium.lookupOutcome(intentId)`

Looks up the Operation Outcome for a given intent.

```js
const outcome = await pactium.lookupOutcome("intent-id");
// Returns the outcome record or null
```

---

### Workspace Projection

#### `pactium.getWorkspaceProjection(workspaceId, options?)`

Returns the current workspace projection state for a given workspace.

```js
const projection = await pactium.getWorkspaceProjection("workspace-a");
// { workspaceId, nextOrdinal, orderRoot, membershipRoot, order, membership }

// With options
const limited = await pactium.getWorkspaceProjection("workspace-a", { limit: 10 });
```

#### `pactium.proveWorkspaceMembership(input)`

Generates a verifiable proof that a ledger event belongs (or does not belong) to a workspace.

```js
const proof = await pactium.proveWorkspaceMembership({
  workspaceId: "workspace-a",
  ledgerEventId: "ledger-event-id",
  proofOptions: { maxProofBytes: 1024 }
});
// { member: true/false, proof: { ... } }
```

**Options:**
| Field | Type | Description |
| --- | --- | --- |
| `workspaceId` | `string` | Workspace identifier |
| `ledgerEventId` | `string` | Ledger event to prove membership for |
| `proofOptions.maxProofLeafEntries` | `number?` | Maximum leaf entries before proofSizeWarning |
| `proofOptions.maxProofBytes` | `number?` | Maximum proof bytes before proofSizeWarning |
| `proofOptions.failOnProofSizeWarning` | `boolean?` | Treat proofSizeWarning as hard failure |

---

### Proof Verification

#### `pactium.verifyEnvelope(envelope, options?)`

Verifies a Proof Envelope against local proof material.

```js
const result = await pactium.verifyEnvelope(envelope, {
  failOnProofSizeWarning: true,
  trustPolicy: "self-carried-manifest",
  requireFullStateMutationProofs: true
});
// { ok, failures: [...], checked: [], warnings: [...] }
```

**Options:**
| Field | Type | Description |
| --- | --- | --- |
| `maxProofLeafEntries` | `number?` | Max leaf entries before proofSizeWarning |
| `maxProofBytes` | `number?` | Max proof bytes before proofSizeWarning |
| `failOnProofSizeWarning` | `boolean?` | Treat proofSizeWarning as hard failure |
| `supportedCriticalExtensions` | `string[]?` | Extensions the verifier supports |
| `proofVerifiers` | `PactiumRecord?` | Custom proof verifier registry |
| `requireAllProofs` | `boolean?` | Require verifiers for all embedded proofs |
| `verifierManifest` | `PactiumRecord?` | Manifest for signature verification |
| `trustedManifest` | `PactiumRecord?` | Caller-supplied trusted manifest |
| `ledgerHeadSignatures` | `PactiumRecord[]?` | Ledger head signatures |
| `trustPolicy` | `string?` | `"structural"`, `"self-carried-manifest"`, or `"trusted-manifest-required"` |
| `requireFullStateMutationProofs` | `boolean?` | Require full (non-sampled) state mutation proofs during verification; generate them at write time with `proofOptions.stateMutationProofMode: "full"` |

Default trust policy depends on verification context: in-memory Pactium instances use `self-carried-manifest`; persistent Pactium instances and `verifyProofBundle()` use `trusted-manifest-required`.

**Returns:** `PactiumVerificationResult`

#### `verifyProofEnvelope(envelope, options?)`

Standalone envelope verification function (does not require a Pactium instance).

```js
import { verifyProofEnvelope } from "pactium";

const result = await verifyProofEnvelope(envelope, {
  storage: storagePort,
  verifierRegistry: customRegistry
});
```

#### `verifyProofBundle(bundle, options?)`

Verifies a portable Proof Bundle without access to local storage.

```js
import { verifyProofBundle } from "pactium";

const result = await verifyProofBundle(bundle, {
  verifyAllBlocks: true  // Verify all content-addressed blocks
});
```

**Returns:** `PactiumProofBundleVerificationResult` extending `PactiumVerificationResult` with:
- `ok: boolean` — overall verification result
- `failures: PactiumVerificationFailure[]` — structured failures
- `bundleHash?: string` — hash of the verified bundle
- `envelope?: PactiumVerificationResult` — envelope-level verification result

#### `pactium.exportProofBundle(envelopeOrId, options?)`

Exports an envelope as a portable Proof Bundle.

```js
const bundle = await pactium.exportProofBundle(envelope, {
  format: "indexed"
});
```

**Returns:** `PactiumProofBundle`

---

### Verification Failures

#### `createVerificationFailure(input)`

Creates a structured verification failure object.

```js
import { createVerificationFailure } from "pactium";

const failure = createVerificationFailure({
  layer: "ledger",
  code: "consistency_violation",
  severity: "critical",
  message: "Ledger history diverged",
  repairable: false
});
```

**Returns:** `PactiumVerificationFailure`

| Field | Type | Description |
| --- | --- | --- |
| `protocol` | `string` | Protocol identifier |
| `layer` | `string` | Verification layer (ledger, index, envelope, extension) |
| `code` | `string` | Machine-readable failure code |
| `severity` | `string` | Severity level (critical, warning, info) |
| `message` | `string?` | Human-readable description |
| `evidenceRef` | `string?` | Reference to failure evidence |
| `repairable` | `boolean?` | Whether automated repair is possible |
| `details` | `object?` | Additional structured details |

---

### Ledger Transparency Log

#### `createLedgerTransparencyLog(options?)`

Creates a standalone Ledger Transparency Log instance.

```js
import { createLedgerTransparencyLog } from "pactium";

const ledger = createLedgerTransparencyLog({ storage: storagePort });
```

**Returns:** `PactiumLedger`

| Method | Description |
| --- | --- |
| `ledger.append(entry)` | Append one fact and return `{ entry, head, previousHead, inclusionProof, consistencyProof }` |
| `ledger.appendBatch(entries, options?)` | Append ordered facts in one ledger append lane run and return `{ batchType, count, entries, head, previousHead, appends }` |
| `ledger.head()` | Return the current `PactiumLedgerHead` |
| `ledger.entries()` | Return all ledger entries |
| `ledger.pageEntries({ start, limit })` | Return a paginated slice of entries |

#### Proof helpers

```js
import {
  createLedgerInclusionProof,
  verifyLedgerInclusionProof,
  createLedgerConsistencyProof,
  verifyLedgerConsistencyProof,
  createCompactRange,
  ledgerLeafHash,
  ledgerNodeHash,
  emptyTreeHash
} from "pactium";

// Verify that a leaf is included in the ledger at a given size
const inclusion = createLedgerInclusionProof({
  leafHashes,
  index,
  leaf
});
const valid = verifyLedgerInclusionProof({
  head,
  proof: inclusion
});

// Verify that a smaller ledger is a prefix of a larger one
const consistency = createLedgerConsistencyProof({
  oldHead,
  newEntries
});
const consistent = verifyLedgerConsistencyProof({
  oldHead,
  newHead,
  proof: consistency
});
```

---

### Signed Ledger Heads

```js
import {
  signLedgerHead,
  verifyLedgerHeadSignature,
  advanceTrustedHead,
  createVerifierManifest,
  ledgerHeadSigningPayload
} from "pactium";

// Create a verifier manifest describing the signing authority
const manifest = createVerifierManifest({
  signers: [{
    signerId: "authority-1",
    algorithm: "ed25519",
    publicKey: publicKeyPem,
    roles: ["ledger-head"]
  }],
  quorum: 1
});

// Sign a ledger head
const signature = signLedgerHead(head, {
  privateKey: privateKeyPem,
  signerId: "authority-1",
  manifest
});

// Verify signature
const result = verifyLedgerHeadSignature(head, manifest, {
  signatures: [signature]
});
// { ok: true/false, accepted: signatureCount }

// Advance a local trust anchor
const advanced = advanceTrustedHead({
  oldHead: previousHead,
  newHead,
  proof: consistencyProof,
  manifest,
  signatures: [signature]
});
```

Verifier manifests support signer validity windows, signer revocation, signer rotation through manifest updates, quorum policies, external witness metadata, public checkpoint metadata, and gossip policy metadata. Production verification should use `trustPolicy: "trusted-manifest-required"` with a caller-supplied trusted manifest rather than relying on a self-carried manifest embedded in proof material.

---

### Verifiable Index Engine

#### `createVerifiableIndexEngine(options?)`

Creates a Verifiable Index Engine instance (Canonical Prolly Tree).

```js
import { createVerifiableIndexEngine } from "pactium";

const engine = createVerifiableIndexEngine({
  storage: storagePort,
  domain: "state"  // Domain adapter identifier
});
```

**Returns:** `PactiumIndexEngine`

| Method | Description |
| --- | --- |
| `engine.createIndex(entries?, options?)` | Create an index from initial entries |
| `engine.put(root, key, value, options?)` | Insert/update a key with path-copying |
| `engine.delete(root, key, options?)` | Delete a key with path-copying |
| `engine.mutate(root, mutations?, options?)` | Apply ordered batch index mutations through one path-copying mutation pass |
| `engine.get(root, key)` | Retrieve a value by key |
| `engine.prove(root, key)` | Generate a membership/non-membership proof |
| `engine.proveMembershipMultiproof(root, keys, options?)` | Generate one compact membership multiproof for multiple keys |
| `engine.proveRange(root, options?)` | Generate a range proof for `min`/`max`/`after`/`limit` scan options |
| `engine.verifyProof(proof, context?)` | Verify an index proof; pass `{ proofMaterial }` when descriptor tables were hoisted into proof material |
| `engine.scan(root, options?)` | Scan keys in range |
| `engine.prefix(root, keyPrefix?, options?)` | Scan keys by prefix |
| `engine.diff(leftRoot, rightRoot)` | Compute differences between two roots |
| `engine.readSnapshot(root)` | Read full index snapshot |
| `engine.readIndexRoot(root)` | Read index root metadata |
| `engine.readNode(root)` | Read a single index node |

#### `verifyIndexProof(proof)`

Standalone index proof verification.

```js
import { verifyIndexProof } from "pactium";

const valid = verifyIndexProof(proof);
```

---

### Canonical Value Encoding

```js
import {
  canonicalEncode,
  canonicalDecode,
  canonicalString,
  normalizeCanonicalValue
} from "pactium";

// Encode a value to canonical bytes (deterministic)
const bytes = canonicalEncode({ key: "value", nested: [1, 2, 3] });

// Decode canonical bytes back to a value
const value = canonicalDecode(bytes);

// Get the canonical JSON string (sorted keys)
const str = canonicalString({ b: 2, a: 1 }); // '{"a":1,"b":2}'

// Normalize a value to PactiumCanonicalValue
const normalized = normalizeCanonicalValue(input);
```

The canonical value model is a Pactium-specific restricted data model supporting: `null`, `boolean`, safe-integer `number`, NFC-normalized `string`, arrays, plain objects with string keys, and binary data through the reserved `$bytes` wrapper. See [Canonical Encoding](./protocols/CANONICAL-ENCODING.md) for the formal byte-level rules.

---

### Protocol Hashing

```js
import {
  protocolHash,
  protocolHashHex,
  cidForBytes,
  cidForCanonical,
  HASH_DOMAINS
} from "pactium";

// Hash with domain separation
const hash = protocolHash("ledger.leaf", value);
const hex = protocolHashHex("ledger.node", value);

// Content-addressed identifiers
const cid = cidForBytes(bytes);        // "cid:sha256:<hex>"
const cid = cidForCanonical(value);    // Canonical encode then hash
```

---

### Storage Port

```js
import { createStoragePort, resolveDataDir, resolveWithin } from "pactium";

const storage = createStoragePort({
  dataDir: "./.pactium",
  inMemory: false,
  storageBackend: "json" // "json" (default), "sqlite", or "auto"
});

await storage.initialize();

// Content-addressed block storage
const record = await storage.putBlock(value);
const block = await storage.getBlock(cid);
const exists = await storage.hasBlock(cid);

// Protocol object storage (scoped key-value)
await storage.putProtocolObject("ledger", "head", headValue);
const head = await storage.getProtocolObject("ledger", "head");
```

`resolveDataDir()` expands `~` to the current user's home directory. Protocol object scopes and keys are stored as path-safe tokens and cannot escape the Pactium data directory. For SQLite, `databasePath` is optional and must resolve inside `dataDir`; once `pactium-manifest.json` records `sqlitePath`, that path is manifest-bound.

`detectSqliteCapabilities()` reports local SQLite signals across npm packages, the `sqlite3` CLI, and platform package managers (Brew on macOS, Choco on Windows, apt/rpm/pacman on Linux). `sqliteStorageAvailable()` is narrower: it is true only when Pactium can actually open a SQLite backend through a supported provider (`node:sqlite` or optional npm `better-sqlite3`).

---

### Tracking Cursors and Append Conditions

```js
import {
  createTrackingCursor,
  advanceTo,
  covers,
  samePositionAs,
  verifyTrackingCursor,
  createAppendCondition
} from "pactium";

// Create a cursor tracking ledger position
const cursor = createTrackingCursor({ position: 0, headHash: rootHash });

// Advance to a new position
const advanced = advanceTo(cursor, 5, { headHash: newRootHash });

// Check coverage
covers(cursor, 3); // true if cursor position >= 3

// Append condition for optimistic concurrency
const condition = createAppendCondition({
  expectedHead: currentHead,
  expectedSize: currentSize
});
```

---

### Maintenance and Repair

```js
import { createRepairPlanner, createMaintenanceTaskEngine } from "pactium";

// Repair planning from verification failures
const planner = createRepairPlanner();
const plan = planner.planRepair(failures);
// Returns deterministic repair tasks for host execution

// Maintenance task engine
const engine = createMaintenanceTaskEngine({ pactium });
const result = await engine.run("doctor");
// { ok: true/false, dataDir, checks: [...] }
```

---

## HTTP Adapter API (`pactium/http`)

The HTTP adapter exposes Pactium's proof-first capabilities to local service processes and host-controlled gateways.

```js
import {
  PACTIUM_HTTP_PROTOCOL,
  PACTIUM_HTTP_MAX_BODY_BYTES,
  createPactiumHttpServer,
  startPactiumHttpServer
} from "pactium/http";

const started = await startPactiumHttpServer({
  dataDir: "./.pactium",
  host: "127.0.0.1",
  port: 7288,
  maxBodyBytes: PACTIUM_HTTP_MAX_BODY_BYTES
});

console.log(started.url);
```

The same exports are also available from the root `pactium` entry point for hosts that centralize imports.

### HTTP Routes

All non-`GET` routes accept JSON and return JSON. The adapter is intended to sit behind host-owned authentication, authorization, and transport security when exposed beyond localhost.

| Route | Method | Core call |
| --- | --- | --- |
| `/health` | `GET` | Health check without data directory disclosure |
| `/doctor` | `GET` | `pactium.doctor()` |
| `/protocols` | `GET` | `pactium.protocolCatalog()` |
| `/intents` | `POST` | `pactium.beginOperationIntent(body)` |
| `/intents/lookup` | `POST` | `pactium.lookupOpenIntent(body.intentId)` |
| `/intents/:intentId` | `GET` | `pactium.lookupOpenIntent(intentId)` |
| `/outcomes` | `POST` | `pactium.appendOperationOutcome(body)` |
| `/outcomes/lookup` | `POST` | `pactium.lookupOutcome(body.intentId)` |
| `/outcomes/:intentId` | `GET` | `pactium.lookupOutcome(intentId)` |
| `/operations` | `POST` | `pactium.recordOperation(body)` |
| `/verify/envelope` | `POST` | `pactium.verifyEnvelope(envelope, options)` |
| `/verify/bundle` | `POST` | `verifyProofBundle(bundle, options)` |
| `/bundles/export` | `POST` | `pactium.exportProofBundle(envelopeOrId, options)` |
| `/workspaces/projection` | `POST` | `pactium.getWorkspaceProjection(body.workspaceId)` |
| `/workspaces/:workspaceId/projection` | `GET` | `pactium.getWorkspaceProjection(workspaceId)` |
| `/workspaces/membership` | `POST` | `pactium.proveWorkspaceMembership(body)` |
| `/cursors/ledger` | `POST` | `pactium.getLedgerCursor(body)` |
| `/cursors/workspace` | `POST` | `pactium.getWorkspaceCursor(body)` |
| `/cursors/verify` | `POST` | `pactium.verifyCursor(body.cursor, body.context)` |
| `/append-conditions` | `POST` | `pactium.createAppendCondition(body)` |
| `/trusted-heads/advance` | `POST` | `pactium.advanceTrustedHead(body)` |
| `/repair/plan` | `POST` | `pactium.planRecovery(body)` |
| `/maintenance/tasks/plan` | `POST` | `createMaintenanceTaskEngine({ pactium }).planTask(body.taskType, body.input)` |
| `/maintenance/tasks/run` | `POST` | `createMaintenanceTaskEngine({ pactium }).runTask(body)` |
| `/extensions` | `POST` | `pactium.createExtension(body)` |
| `/envelopes` | `POST` | `pactium.storeEnvelope(body)` |
| `/licolite/operations` | `POST` | `licolite.recordWorkspaceOperation(body)` |
| `/licolite/verify/envelope` | `POST` | `licolite.verifyEnvelope(envelope, options)` |
| `/licolite/verify/bundle` | `POST` | `licolite.verifyBundle(bundle, options)` |
| `/licolite/bundles/export` | `POST` | `licolite.exportProofBundle(envelopeOrId, options)` |
| `/licolite/repair/plan` | `POST` | `licolite.planRepair(body.failures)` |

Envelope and bundle verification routes accept either the object directly or a wrapper:

```json
{
  "envelope": { "...": "..." },
  "options": { "requireAllProofs": true }
}
```

Bundle export accepts `{ "envelope": ... }`, `{ "envelopeId": "..." }`, `{ "id": "..." }`, or a JSON string envelope id.

---

### Protocol Constants

```js
import {
  PACTIUM_PROTOCOL,           // "pactium.v0.2"
  PACTIUM_SCHEMA_VERSION,     // "pactium.v0.2.schema.latest"
  PACTIUM_PACKAGE_VERSION,    // "0.3.1"
  PACTIUM_INDEX_ENGINE,       // "pactium.verifiable-index-engine"
  PACTIUM_INDEX_SPLITTER,     // "pactium-cdc-boundary"
  PACTIUM_PROOF_BUNDLE_TYPE,  // "pactium.proof-bundle.indexed"
  PACTIUM_BUNDLE_ENCODING,    // "pactium.bundle.indexed-record-stream"
  PACTIUM_PROOF_TYPES,        // { ledgerInclusion, ledgerConsistency, indexMembership, indexNonMembership }
  PACTIUM_PROTOCOL_PROFILE,   // Full protocol parameter matrix
  HASH_DOMAINS                // Domain separation constants
} from "pactium";
```

---

## LicoLite Aspect API (`pactium/licolite`)

### `createLicoLiteAspect(options?)`

Creates a LicoLite Aspect instance with workspace projection and signing defaults.

```js
import { createLicoLiteAspect, createLicoLiteSigner } from "pactium/licolite";

const licolite = createLicoLiteAspect({
  pactium: pactiumInstance,           // Optional: provide existing instance
  dataDir: "./.pactium",             // Or create new instance from dataDir
  evidencePolicy: "production",       // "production" | "opportunistic"
  signer: createLicoLiteSigner({
    signerId: "host-signer",
    secret: signingSecret
  })
});
```

**Returns:** `LicoLiteAspect`

| Property | Type | Description |
| --- | --- | --- |
| `protocol` | `string` | LicoLite aspect protocol identifier |
| `core` | `PactiumCore` | Underlying Pactium instance |
| `evidencePolicy` | `string` | Evidence policy mode |
| `workspaceProjectionDefault` | `true` | Workspace projection always enabled |
| `criticalExtensions` | `string[]` | Required critical extensions |
| `signer` | `LicoLiteSigner \| null` | Signing authority |

When `evidencePolicy` is `"production"`, recording and verification require an explicit `signer` or `signerSecret`; Pactium does not install a hidden production default signing key.

---

### `createLicoLiteSigner(options)`

Creates a signing authority for LicoLite proof envelopes.

```js
import { createLicoLiteSigner } from "pactium/licolite";

const signer = createLicoLiteSigner({
  signerId: "my-signer",
  secret: "base64-encoded-secret",
  algorithm: "ed25519"  // Default
});
```

**Returns:** `LicoLiteSigner`

| Method | Description |
| --- | --- |
| `signer.sign(message)` | Sign a message string |
| `signer.verify(message, signature)` | Verify a signature |

---

### `licolite.recordWorkspaceOperation(input)`

Records a workspace operation with LicoLite policy and workspace effect evidence.

```js
const envelope = await licolite.recordWorkspaceOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-key",
  outcomeIdempotencyKey: "outcome-key",
  input: { path: "file.txt" },
  outcome: "success",
  policyEvidence: { decision: "allow", rule: "write-permitted" },
  workspaceEffectEvidence: { durableRef: "host:asset:file-001" },
  stateMutations: [
    { key: "file.txt", value: { content: "data" } }
  ]
});
```

The returned envelope includes critical LicoLite extensions for policy and workspace effect evidence.

---

### `licolite.verifyEnvelope(envelope, options?)`

LicoLite-level verification that checks core proofs plus:
- Signature validity
- Critical extension support
- Policy extension binding
- Workspace effect extension binding
- Workspace projection proof

```js
const result = await licolite.verifyEnvelope(envelope);
// { ok: true/false, failures: [...] }
```

Production verification fails closed when the required LicoLite policy/effect extensions are not critical, when signature material is present without a configured verifier, or when no explicit verifier signer is configured.

---

### `licolite.verifyBundle(bundle, options?)`

Verifies a Proof Bundle with LicoLite-level checks.

```js
const result = await licolite.verifyBundle(bundle);
```

---

### `licolite.planRepair(failures?)`

Translates verification failures into deterministic repair tasks.

```js
const plan = licolite.planRepair(result.failures);
// { tasks: [...], repairable: true/false }
```

---

### LicoLite Constants

```js
import {
  LICOLITE_ASPECT_PROTOCOL,
  LICOLITE_POLICY_EXTENSION,            // "licolite.policy"
  LICOLITE_WORKSPACE_EFFECT_EXTENSION,  // "licolite.workspaceEffect"
  LICOLITE_SIGNATURE_EXTENSION,         // "licolite.signature"
  LICOLITE_CRITICAL_EXTENSIONS,
  LICOLITE_SUPPORTED_CRITICAL_EXTENSIONS
} from "pactium/licolite";
```

### Evidence Helpers

```js
import {
  licoLitePolicyExtensionValue,
  licoLiteWorkspaceEffectExtensionValue
} from "pactium/licolite";

// Generate policy extension value
const policyExt = licoLitePolicyExtensionValue({
  decision: "allow",
  rule: "upload-permitted"
});

// Generate workspace effect extension value
const effectExt = licoLiteWorkspaceEffectExtensionValue({
  durableRef: "host:asset:001",
  effectType: "file-write"
});
```

---

## TypeScript Types

All public types are exported from the package entry points:

```ts
import type {
  PactiumCanonicalValue,
  PactiumRecord,
  PactiumDataDirOptions,
  PactiumStoragePort,
  PactiumLedgerHead,
  PactiumProofEnvelope,
  PactiumVerificationFailure,
  PactiumVerificationResult,
  PactiumProofBundle,
  PactiumProofBundleVerificationResult,
  PactiumIndexScanOptions,
  PactiumIndexEngine,
  PactiumLedgerPageOptions,
  PactiumLedgerPage,
  PactiumLedger,
  PactiumCore,
  PactiumProofOptions,
  PactiumProofVerificationOptions,
  PactiumProofBundleVerificationOptions,
  PactiumHttpServerOptions,
  PactiumHttpServerStartOptions,
  PactiumHttpServerStartResult
} from "pactium";

import type {
  LicoLiteSigner,
  LicoLiteAspect
} from "pactium/licolite";
```

---

## Crash Consistency and Doctor

Pactium's local JSON backend uses **write-ahead commit markers** for crash detection:

1. Before mutation work begins, a **pending marker** is written to the `commit` protocol object scope.
2. If preflight validation fails (e.g., idempotency conflict, append-condition conflict), the pending marker is **cleaned up** — no false `incomplete_commit`.
3. After all mutation work completes (ledger append + proof material + index + runtime-state save), a **complete marker** is written and the pending marker is cleaned up.
4. If a crash occurs after the ledger append but before the complete marker is written, the pending marker **remains** — `doctor()` reports `incomplete_commit`.

`createStoragePort()` defaults to `storageBackend: "auto"` for persistent data directories. Auto mode runs the SQLite capability detector and selects SQLite for a new data directory when a Pactium-supported SQLite provider is available (`node:sqlite` or optional npm `better-sqlite3`), otherwise JSON. System SQLite signals such as the `sqlite3` CLI or package-manager records are reported by `detectSqliteCapabilities()` but are not treated as storage drivers until an adapter exists. Once a data directory has a manifest, Pactium reuses the manifest-bound backend and does not silently switch or fall back to another backend.

This is **not an ACID database transaction**. It is a WAL marker + diagnostic pattern:
- `doctor()` scans for orphan pending markers.
- `doctor({ rebuild: true })` replays ledger leaves to reconstruct derived state and compares against runtime state.
- Rebuild categorizes roots as fully comparable, partially comparable, or skipped (see README architecture section).

Backend profile:
- JSON is intended for local development, low-concurrency use, and debugging.
- SQLite is the production local-durability candidate because it provides WAL, transactions, foreign keys, and synchronous durability settings.
- Distributed multi-node deployments still require an external consistency layer; Storage Port backends do not provide consensus.

**Doctor rebuild boundaries:**
- **Fully comparable**: `openIntent`, `outcome`, `causality`, workspace `orderRoot`/`membershipRoot` — mismatch is a hard `derived_root_mismatch`.
- **Partially comparable**: `intentIdempotency`, `outcomeIdempotency`, workspace `checkpointRoot` — mismatch is a `*_rebuild_incomplete` warning (old facts may lack material).
- **Skipped**: workspace `stateRoot` — state mutations live in proof material, not ledger facts. Reports `state_rebuild_incomplete`.

**Commit marker coverage boundaries:**
- `beginOperationIntent`, `appendOperationOutcome`, `recordOperation`, and `recordOperations` are covered by pending/complete commit markers.
- `storeEnvelope`, `createExtension`, and `exportProofBundle` are materialization/caching operations that do NOT have commit markers. These operations write blocks or update the proof bundle cache; failures leave recoverable artifacts.
- HTTP `/bundles/export` is classified as a mutation route because it updates the proof bundle cache in runtime-state, but it is not a ledger lifecycle commit.

---

## Lock Heartbeat and Fencing

Write locks use:
- **Fencing tokens** (UUID strings): compared as strings, not numbers. Using `Number()` on UUID produces `NaN`, and `NaN === NaN` is always `false` — a known bug fixed in the current release.
- **Heartbeat interval**: refreshes `heartbeatAtMs` periodically (at most every 5 seconds). A fresh heartbeat means the lock is still active even if `createdAtMs` is old.
- **Double-read on stale cleanup**: `removeStaleLock()` reads the owner, checks staleness, re-reads the owner, and only deletes if `ownerId`, `fencingToken`, and `processStartKey` all match.
- **Dirty/ownerless lock cleanup**: lock directories without `owner.json` (or with malformed `owner.json`) are cleaned up safely if stale (directory `mtimeMs` exceeds `staleMs`), using a double-stat pattern to avoid TOCTOU races. Fresh ownerless directories are not removed.
- **Release guard**: lock release also checks `fencingToken` — if another process tampered with the owner metadata, the lock is not deleted.
- **Cleanup timing**: lock cleanup occurs only during write-lock acquisition (`withWriteLock`). The `doctor()` function does not currently scan for dirty or stale locks.

This is a **best-effort** mechanism. For production deployments with high lock contention, consider external lock managers.

---

## Proof Size Guard

`maxProofLeafEntries` and `maxProofBytes` options are available on:
- `indexEngine.prove(root, key, options?)`
- `pactium.verifyEnvelope(envelope, options?)`
- `verifyProofBundle(bundle, options?)`

When a proof exceeds the configured limits, a `proofSizeWarning` is emitted:
- By default, `proofSizeWarning` is **non-fatal** (severity: "warning") — `ok` remains `true`.
- Set `failOnProofSizeWarning: true` to treat it as a **hard failure** (`ok: false`).

**This is a size guard / diagnostic, not a bounded proof format.** Bounded proofs (constant-size proofs) are a future protocol goal.

For many related key proofs, use `engine.proveMembershipMultiproof()` or `engine.proveRange()` to avoid repeating path descriptors. Proof envelopes also hoist duplicate sibling descriptors into `proofMaterial.proofDescriptorTable`.

---

## Index Engine Scalability

Current state:
- **No-op fast path**: mutations that do not change structure produce the same root.
- **Path-copying mutation**: `put`, `delete`, and `mutate` descend search paths, rewrite affected leaves and necessary ancestors, and reuse unchanged subtrees.
- **Diff**: `diff()` traverses Prolly nodes, skips equal subtree roots, merges non-aligned child ranges, descends internal overlap groups, and compares entries at leaf level.
- **Proof compaction**: membership multiproofs, range proofs, compact non-membership proofs, and proof-material descriptor deduplication are implemented.

The current implementation is correct, canonical, and deterministic. Throughput-sensitive hosts should still run pressure profiles against their workload and choose SQLite for durable local production profiles.

---

## Error Handling

Pactium does not throw exceptions for verification failures. Instead, verification methods return structured results:

```js
const result = await pactium.verifyEnvelope(envelope);

if (!result.ok) {
  for (const failure of result.failures) {
    console.error(`[${failure.layer}] ${failure.code}: ${failure.message}`);
    if (failure.repairable) {
      // Can be addressed by repair planner
    }
  }
}
```

Protocol errors (invalid arguments, storage failures) throw standard JavaScript `Error` instances.
