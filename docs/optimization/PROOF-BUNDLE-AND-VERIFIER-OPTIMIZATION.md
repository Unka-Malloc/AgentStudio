# Proof Bundle And Verifier Optimization

## Objective

Make Pactium proof verification complete and make proof bundles portable at larger sizes by adding proof-type dispatch, signed head verification, and CAR-like indexed bundle transport.

## Baseline State

At the start of this optimization pass, proof envelopes and bundles already had useful structure:

- `createEnvelope` stores Proof Material Refs and extension refs (`src/core/pactium-core.js:162`).
- `verifyProofEnvelope` validates envelope identity, proof refs, extension block hashes, ledger inclusion, and ledger consistency (`src/proof/envelope.js:91`, `src/proof/envelope.js:197`).
- `exportProofBundle` walked direct proof/extension refs and emitted a JSON block list.
- `verifyProofBundle` checks required direct blocks and delegates to envelope verification (`src/proof/bundle.js:6`).

The baseline gap was proof coverage. `proofMaterial.proofs` could contain workspace, state, checkpoint, idempotency, and lifecycle index proofs, but core verification did not dispatch to index proof verifiers. Bundle transport was also all-in-memory JSON with no offset index. These items are now implemented; see [Implementation Status](IMPLEMENTATION-STATUS.md).

## Reference Signals

| Reference | Relevant code | Takeaway |
| --- | --- | --- |
| Rekor | `pkg/verify/verify.go:116`, `pkg/verify/verify.go:141`, `pkg/verify/verify.go:182` | Verification should cover checkpoint signature, inclusion proof, and signed entry timestamp as separate failure layers. |
| Hypercore | `lib/verifier.js:58`, `lib/fully-remote-proof.js:75`, `lib/merkle-tree.js:672` | Remote proof verification should bind root hashes to signer manifests and tree state. |
| go-car | Indexed archive writer, index generator, options, and block reader | Portable block bundles need offsets, optional indexes, limits, and streaming readers. |

## Verifier Registry

Add a registry to `src/proof`:

```js
const registry = {
  "ledger.inclusion.audit-path": verifyLedgerInclusionProof,
  "ledger.consistency.audit-path": verifyLedgerConsistencyProof,
  "index.membership.prolly-path": verifyIndexProof,
  "index.non-membership.prolly-path": verifyIndexProof
};
```

`verifyProofEnvelope` should:

1. Decode every proof material block.
2. Verify ledger material as it does today.
3. Traverse `proofMaterial.proofs` recursively.
4. For every object with `proofType`, find a registered verifier.
5. Record a structured failure if the verifier is missing, if it returns false, or if it throws.
6. Add checked proof paths such as `proofs.workspaceProjection.orderProof`.

Unknown proof types should be allowed only when they are explicitly declared non-critical. Proof material tied to critical extensions must be fail-closed.

## LicoLite Verification Upgrade

The baseline LicoLite verifier added critical extension and signature checks, then reported `licolite-workspace-projection` in `checked`. The registry upgrade implemented the following:

1. `verifyLicoLiteEnvelope` must require valid workspace projection proofs for:
   - `workspaceProjection.orderProof`;
   - `workspaceProjection.membershipProof`;
   - any LicoLite workspace-effect proof extension.
2. It must decode critical extension payloads with `canonicalDecode`, not raw `JSON.parse`, so the verifier follows the same codec abstraction as core proof material.
3. The default HMAC signer should be labelled as development or host-local trust. Portable proof bundles should prefer a public-key signer manifest.

## Signed Head And Verifier Manifest

Add a manifest object:

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
      roles: ["ledger-head", "proof-envelope"]
    }
  ],
  quorum: 1
}
```

Signed heads should reference the manifest hash and signer id. Verification should reject:

- unknown signer id;
- unsupported algorithm;
- signature over a different canonical head payload;
- head size/root mismatch;
- manifest quorum failure.

This mirrors the useful parts of Rekor checkpoints and Hypercore signer manifests without introducing a witness network yet.

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

The binary payload should be length-delimited block records:

```text
varint(recordLength)
canonical-json(blockHeader)
raw block bytes
```

This is not required to be byte-compatible with IPLD CAR at first. It should copy the important operational properties:

- root manifest first;
- strict maximum header size;
- strict maximum block size;
- cid-to-offset index;
- duplicate control;
- streaming verification;
- ability to skip or fetch a block by cid without decoding every block.

If full CAR interoperability becomes a goal, the next step is to emit actual CARv1/CARv2 blocks whose CIDs are multiformat CIDs. That is a larger canonical encoding decision and should not be hidden inside this optimization.

## Verification Algorithm

1. Validate bundle manifest identity and `bundleHash`.
2. Build `bundleMap` from the index, not from a full decoded block array.
3. Verify every required block exists and matches payload hash.
4. Verify the envelope id.
5. Verify proof refs and extension refs.
6. Decode proof material blocks.
7. Run proof registry verification for every embedded proof.
8. Verify signed ledger head if present and verifier manifest is provided.
9. Verify LicoLite critical extensions and signatures when `pactium/licolite` verifier is used.

## API Changes

| API | Change |
| --- | --- |
| `verifyProofEnvelope(envelope, options)` | Add `proofVerifiers`, `requireAllProofs`, and `verifierManifest`. |
| `verifyProofBundle(bundle, options)` | Verifies the indexed bundle format and required proof/extension blocks. |
| `exportProofBundle(envelopeOrId, options)` | Emits the indexed bundle format. |
| `createLicoLiteAspect` | Accept public-key signer/verifier manifest options in addition to local signer. |

## Tests

| Test | Purpose |
| --- | --- |
| Embedded proof tamper | Corrupt workspace/state/checkpoint proof and assert envelope verification fails. |
| Missing verifier | Unknown critical proof type fails with structured failure. |
| Bundle random access | Verify a bundle by loading only required indexed blocks. |
| Bundle limits | Reject oversized header, oversized block, duplicate cid mismatch, and bad offset. |
| Signed head | Verify valid manifest/signature; reject wrong signer, wrong quorum, wrong root, wrong size. |
| LicoLite codec | Signature extension decoding works through canonical codec and rejects corrupted payload. |

## Rollout

1. Add proof registry and use it for index proofs while keeping ledger verification behavior. Done.
2. Make LicoLite workspace projection checks depend on registry results. Done.
3. Add signed head manifest support as optional verification. Done.
4. Add indexed bundle export/import. Done.
5. Remove the JSON block-list export path so bundle structure is organized by transport behavior, not by release labels. Done.
