# Pactium API Reference

This document covers the complete public API surface of the `pactium` package.

## Entry Points

| Export path | Description |
| --- | --- |
| `pactium` | Core proof-first protocol API |
| `pactium/licolite` | LicoLite integration aspect |

---

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
| `storage` | `PactiumStoragePort` | Underlying storage port |
| `ledger` | `PactiumLedger` | Operation Ledger instance |
| `indexEngine` | `PactiumIndexEngine` | Verifiable Index Engine instance |

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

**Returns:** `PactiumProofEnvelope`

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

#### `pactium.getWorkspaceProjection(workspaceId)`

Returns the current workspace projection state for a given workspace.

```js
const projection = await pactium.getWorkspaceProjection("workspace-a");
// { workspaceId, nextOrdinal, orderRoot, membershipRoot, order, membership }
```

#### `pactium.proveWorkspaceMembership(input)`

Generates a verifiable proof that a ledger event belongs (or does not belong) to a workspace.

```js
const proof = await pactium.proveWorkspaceMembership({
  workspaceId: "workspace-a",
  ledgerEventId: "ledger-event-id"
});
// { member: true/false, proof: { ... } }
```

---

### Proof Verification

#### `pactium.verifyEnvelope(envelope, options?)`

Verifies a Proof Envelope against local proof material.

```js
const result = await pactium.verifyEnvelope(envelope);
// { ok: true/false, failures: [...], checked: [...] }
```

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

**Returns:** `PactiumVerificationResult & { bundleHash?: string }`

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
| `ledger.append(entry)` | Append an entry and return `{ head, leafIndex, inclusionProof }` |
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
const inclusion = createLedgerInclusionProof({ leafIndex, treeSize, hashes });
const valid = verifyLedgerInclusionProof({ leafHash, treeSize, rootHash, proof: inclusion });

// Verify that a smaller ledger is a prefix of a larger one
const consistency = createLedgerConsistencyProof({ oldSize, newSize, hashes });
const valid = verifyLedgerConsistencyProof({ oldSize, newSize, oldRoot, newRoot, proof: consistency });
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
  signerId: "authority-1",
  algorithm: "ed25519",
  publicKey: publicKeyHex
});

// Sign a ledger head
const signedHead = signLedgerHead(head, { signer, manifest });

// Verify signature
const result = verifyLedgerHeadSignature(signedHead, manifest);
// { ok: true/false, accepted: signatureCount }

// Advance a local trust anchor
const advanced = advanceTrustedHead({
  lastTrusted: previousHead,
  candidate: newHead,
  consistencyProof: proof
});
```

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
| `engine.put(root, key, value, options?)` | Insert/update a key |
| `engine.delete(root, key, options?)` | Delete a key |
| `engine.get(root, key)` | Retrieve a value by key |
| `engine.prove(root, key)` | Generate a membership/non-membership proof |
| `engine.verifyProof(proof)` | Verify an index proof |
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

The canonical value model is a restricted IPLD/DAG-CBOR-style data model supporting: `null`, `boolean`, `number`, `string`, arrays, and plain objects with string keys.

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
  inMemory: false
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

### Protocol Constants

```js
import {
  PACTIUM_PROTOCOL,           // "pactium.v0.2"
  PACTIUM_SCHEMA_VERSION,     // "pactium.v0.2.schema.latest"
  PACTIUM_PACKAGE_VERSION,    // "0.2.1"
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
  PactiumIndexScanOptions,
  PactiumIndexEngine,
  PactiumLedgerPageOptions,
  PactiumLedgerPage,
  PactiumLedger,
  PactiumCore
} from "pactium";

import type {
  LicoLiteSigner,
  LicoLiteAspect
} from "pactium/licolite";
```

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
