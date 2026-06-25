# Proof Bundle And Verifier Optimization

## Objective

Document the current proof verification and portable bundle implementation: proof-type dispatch, signed head verification, and CAR-like indexed bundle transport.

## Current State

Proof envelopes and bundles now use the implemented verifier and indexed bundle path:

- `createEnvelope` stores content-addressed Proof Material Refs and extension refs.
- `verifyProofEnvelope` validates envelope identity, proof refs, extension block hashes, ledger inclusion, ledger consistency, semantic bindings, optional signed head material, and embedded proof material.
- `createDefaultProofVerifierRegistry` registers ledger inclusion, ledger consistency, index membership, compact index non-membership, index membership multiproof, and index range verifiers.
- `verifyProofEnvelope` recursively traverses `proofMaterial.proofs` and dispatches every object with a `proofType`.
- `exportProofBundle` emits `pactium.proof-bundle.indexed` with a length-delimited binary record stream and offset index.
- `verifyProofBundle` validates bundle identity, bundle hash, required block closure, indexed block integrity, and the embedded envelope without access to local Pactium storage. Bundle verification defaults to `trusted-manifest-required` unless the caller selects another trust policy.

The JSON block-list export path and the un-dispatched embedded proof gap are not current behavior.

## Reference Signals

| Reference | Relevant code | Takeaway |
| --- | --- | --- |
| Rekor | `pkg/verify/verify.go:116`, `pkg/verify/verify.go:141`, `pkg/verify/verify.go:182` | Verification should cover checkpoint signature, inclusion proof, and signed entry timestamp as separate failure layers. |
| Hypercore | `lib/verifier.js:58`, `lib/fully-remote-proof.js:75`, `lib/merkle-tree.js:672` | Remote proof verification should bind root hashes to signer manifests and tree state. |
| go-car | Indexed archive writer, index generator, options, and block reader | Portable block bundles need offsets, optional indexes, limits, and streaming readers. |

## Verifier Registry

The default registry in `src/proof/registry.js` covers the built-in proof types:

```js
const registry = {
  "ledger.inclusion.audit-path": verifyLedgerInclusionProof,
  "ledger.consistency.audit-path": verifyLedgerConsistencyProof,
  "index.membership.prolly-path": verifyIndexProof,
  "index.non-membership.compact-prolly-boundary": verifyIndexProof,
  "index.membership-multiproof.prolly-paths": verifyIndexProof,
  "index.range.prolly-paths": verifyIndexProof
};
```

`verifyProofEnvelope` currently:

1. Decode every proof material block.
2. Verify ledger material as it does today.
3. Traverse `proofMaterial.proofs` recursively.
4. For every object with `proofType`, find a registered verifier.
5. Record a structured failure if the verifier is missing, if it returns false, or if it throws.
6. Add checked proof paths such as `proofs.workspaceProjection.orderProof`.

Unknown proof types are allowed only when `requireAllProofs` is false and the proof object is explicitly non-critical. The default behavior is fail-closed.

## LicoLite Verification Upgrade

The LicoLite verifier now layers LicoLite requirements on top of core envelope verification:

1. `verifyLicoLiteEnvelope` requires valid workspace projection proofs through core registry verification for:
   - `workspaceProjection.orderProof`;
   - `workspaceProjection.membershipProof`.
2. It decodes critical extension payloads with `canonicalDecode`, not raw `JSON.parse`, so the verifier follows the same codec abstraction as core proof material.
3. It verifies LicoLite signature material against the configured signer and binds signer id and algorithm.
4. Production mode requires explicit signer material for recording and verification.

## Signed Head And Verifier Manifest

The verifier manifest object is implemented as:

```js
{
  protocol: "pactium.v0.2",
  manifestType: "pactium.verifier-manifest",
  manifestId,
  signers: [
    {
      signerId,
      algorithm: "ed25519",
      publicKey,
      validFrom,
      validTo,
      revokedAt,
      revocationReason,
      roles: ["ledger-head", "proof-envelope"]
    }
  ],
  revokedSigners: [{ signerId, revokedAt, reason }],
  quorum: 1,
  quorumPolicy,
  witnesses,
  publicCheckpoint,
  gossip
}
```

Signed heads reference the manifest hash and signer id. Verification rejects:

- unknown signer id;
- unsupported algorithm;
- signature over a different canonical head payload;
- head size/root mismatch;
- signer validity or revocation failure;
- manifest quorum failure.

This mirrors the useful parts of Rekor checkpoints and Hypercore signer manifests without introducing a witness network.

## Indexed Bundle Format

The implemented bundle format is the indexed proof-bundle record stream:

```js
{
  protocol: "pactium.v0.2",
  bundleType: "pactium.proof-bundle.indexed",
  manifest,
  envelope,
  index: [
    { cid, offset, byteLength, payloadHash, codec, kind, refs }
  ],
  blocksEncoding: "pactium.bundle.indexed-record-stream"
}
```

The binary payload is length-delimited block records:

```text
varint(recordLength)
canonical-json(blockHeader)
raw block bytes
```

This is not byte-compatible with IPLD CAR. It copies the important operational properties:

- root manifest first;
- strict maximum header size;
- strict maximum block size;
- cid-to-offset index;
- duplicate control;
- streaming verification;
- ability to skip or fetch a block by cid without decoding every block.

Boundary tests cover malformed varints, oversized headers/blocks, duplicate CIDs, offset/header/payload length mismatches, trailing bytes, missing required blocks, and corrupted required payloads. If full CAR interoperability becomes a goal, the next step is to emit actual CARv1/CARv2 blocks whose CIDs are multiformat CIDs. That is a larger canonical encoding decision and should not be hidden inside this optimization.

## Verification Algorithm

1. Validate bundle manifest identity and `bundleHash`.
2. Build `bundleMap` from the index, not from a full decoded block array.
3. Verify every required block exists and matches payload hash.
4. Verify the envelope id.
5. Verify proof refs and extension refs.
6. Decode proof material blocks.
7. Run proof registry verification for every embedded proof.
8. Verify signed ledger head according to trust policy. Persistent/bundle verification requires a caller-supplied trusted manifest unless the caller selects a less strict policy.
9. Verify LicoLite critical extensions and signatures when `pactium/licolite` verifier is used.

## API Changes

| API | Current behavior |
| --- | --- |
| `verifyProofEnvelope(envelope, options)` | Supports `proofVerifiers`, `requireAllProofs`, `trustedManifest`, `trustPolicy`, `ledgerHeadSignatures`, `bundle`, and `bundleResolver`. |
| `verifyProofBundle(bundle, options)` | Verifies the indexed bundle format, required proof/extension blocks, and embedded envelope under the selected trust policy. |
| `exportProofBundle(envelopeOrId, options)` | Emits the indexed bundle format. |
| `createLicoLiteAspect` | Accepts local HMAC or Ed25519 signer material; core ledger-head verification uses verifier manifests. |

## Tests

| Test | Purpose |
| --- | --- |
| Embedded proof tamper | Corrupt workspace/state/checkpoint proof and assert envelope verification fails. |
| Missing verifier | Unknown critical proof type fails with structured failure. |
| Bundle random access | Verify a bundle by loading only required indexed blocks. |
| Bundle limits | Reject oversized header, oversized block, duplicate cid mismatch, bad offset, malformed layout, trailing bytes, and corrupted required payloads. |
| Signed head | Verify valid manifest/signature; reject wrong signer, wrong quorum, wrong root, wrong size, expired signer, future signer, and revoked signer. |
| LicoLite codec | Signature extension decoding works through canonical codec and rejects corrupted payload. |

## Maintained Boundary

1. Proof registry dispatch is the current verification path for embedded proofs.
2. LicoLite workspace projection checks depend on core registry results.
3. Signed head manifest support is implemented for core Ledger Heads.
4. Indexed bundle export/import is the only supported proof bundle transport.
5. Full CAR/IPLD interoperability remains a separate protocol decision.
