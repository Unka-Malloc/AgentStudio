# Pactium Trust Anchors

Pactium separates structural proof validity from trusted signature validity.

Structural validity answers: "Do the envelope, ledger proof, index proof, and bundle bytes recompute correctly?"

Trusted signature validity answers: "Did a trusted signer or quorum sign the ledger head under a manifest the verifier accepts?"

## Verification Profiles

| Profile | Intended use | Behavior |
| --- | --- | --- |
| `structural` | Debugging and format checks | Verifies proof structure and skips trust decisions. |
| `self-carried-manifest` | In-memory development and portable smoke tests | Validates signatures against the manifest embedded in proof material, but does not mark the head trusted. |
| `trusted-manifest-required` | Production persistent verification | Requires a caller-supplied trusted manifest and fails closed when it is absent. |

Persistent Pactium verification and Proof Bundle verification default to `trusted-manifest-required`. In-memory Pactium instances default to `self-carried-manifest` for development ergonomics.

## Verifier Manifest

The verifier manifest is the trust anchor:

- `manifestId` and `manifestHash` bind signatures to a specific manifest.
- `signers[]` declares signer id, algorithm, public key, roles, validity window, and optional revocation fields.
- `revokedSigners[]` records signer revocation independent of the signer record.
- `quorum` / `quorumPolicy` declares how many unique accepted signers are required.
- `witnesses`, `publicCheckpoint`, and `gossip` are explicit policy metadata for deployments that publish checkpoints, use external witnesses, or run gossip monitoring.

## Rotation And Revocation

Signer rotation is a manifest update:

1. Add the replacement signer with `roles: ["ledger-head"]`.
2. Set quorum policy so the transition period requires the intended signer set.
3. Revoke the retired signer with `revokedAt` on the signer record or a `revokedSigners[]` entry.
4. Distribute the new manifest through the host's trust-anchor channel.

Pactium rejects a ledger-head signature when the signing timestamp is at or after the signer's revocation time, when the signer is outside its validity window, when roles do not include `ledger-head`, or when accepted unique signer count does not satisfy quorum.

## Witness, Cosign, Checkpoint, Gossip

Pactium does not run a witness network or public transparency service. It provides fields that let hosts bind those policies into the manifest and verify signed ledger heads under that manifest.

Production deployments that need split-view detection should publish public checkpoints or use external witness/cosign infrastructure, then require verifiers to pin the manifest and advance trusted heads only through valid consistency proofs.
