# Pactium Architecture

Pactium is a proof-first protocol substrate for LicoLite. LicoLite is the primary host, and `pactium/licolite` is a first-class package aspect rather than an external plugin.

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

## Authority

The Operation Ledger is the global ordering authority. Workspace Projection, Merkle State, Checkpoint Tree, lifecycle, idempotency, and causality indexes are verifiable structures, but they do not replace Ledger Authority.

The shared Verifiable Index Engine is the canonical ordered-key proof engine. State, checkpoint, workspace projection, lifecycle, idempotency, and causality indexes use domain adapters over that shared engine rather than separate tree implementations.

## LicoLite Boundary

Pactium owns protocol facts, proof algorithms, canonical encoding, storage ports, verification, repair planning, and LicoLite protocol-substrate adapters.

LicoLite owns runtime policy decisions, operation dispatching, side effects, UI ownership, authorization, and durable Host Evidence storage. Pactium binds LicoLite policy and workspace-effect evidence as critical proof extensions and verifies those bindings.

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
| Storage Port | `src/storage/local-json-storage-port.js`: `createStoragePort` |
| Ledger Transparency Log | `src/ledger/transparency-log.js`: `createLedgerTransparencyLog`, inclusion and consistency proof helpers |
| Verifiable Index Engine | `src/index-engine/snapshot-merkle-index.js`: `createVerifiableIndexEngine` |
| Operation lifecycle | `src/core/pactium-core.js`: `beginOperationIntent`, `appendOperationOutcome`, `recordOperation` |
| Workspace Projection | `src/core/pactium-core.js`: `getWorkspaceProjection`, `proveWorkspaceMembership` |
| Proof Envelopes and Bundles | `src/proof/envelope.js`, `src/proof/bundle.js`, `src/core/pactium-core.js`: verification and export surfaces |
| LicoLite Aspect | `src/aspects/licolite/`: `createLicoLiteAspect`, `createLicoLiteSigner`, evidence helpers, verifier |
| CLI and HTTP facades | `bin/pactium.mjs`, `src/http.js` |

Maintained docs must not describe SQLite storage, separate per-workspace lane queues, repair fact execution, or pressure baseline regression enforcement as implemented unless those surfaces are added and verified.

If a maintained document introduces a design area that cannot be mapped to an implementation anchor, the design must be implemented and documented before release.
