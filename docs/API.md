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

`resolveDataDir()` expands `~` to the current user's home directory. Protocol object scopes and keys are stored as path-safe tokens and cannot escape the Pactium data directory.

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
  PACTIUM_PACKAGE_VERSION,    // "0.3.0"
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
  PactiumIndexScanOptions,
  PactiumIndexEngine,
  PactiumLedgerPageOptions,
  PactiumLedgerPage,
  PactiumLedger,
  PactiumCore,
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
