<p align="center">
  <strong>Pactium — the verifiable protocol substrate for LicoLite.</strong>
</p>

Pactium is a proof-first npm package that provides LicoLite's durable protocol substrate: verifiable operation facts, workspace projections, checkpoint recovery history, Merkle state, proof envelopes, and proof bundles.

Pactium implements the current verifiable protocol model documented in [Architecture](./docs/architecture/ARCHITECTURE.md), [Protocols](./docs/protocols/PROTOCOLS.md), and [Protocol Profile](./docs/protocols/PROFILE.md). The package root exposes only the latest proof-first API.

## Direction

- **Operation Ledger** is the global ordering authority and uses a transparency log for inclusion and consistency proofs.
- **Operation lifecycle** is append-only through Operation Intent and Operation Outcome facts.
- **Workspace Projection** is first priority for the LicoLite Aspect and is enabled by default.
- **Verifiable Index Engine** is a shared Canonical Prolly Tree based proof engine for state, checkpoint, workspace projection, lifecycle, idempotency, and causality indexes.
- **Proof Envelopes** bind Ledger, Workspace Projection, Checkpoint, State, and LicoLite evidence into one receipt shape.
- **Proof Bundles** export portable CAR-like proof material for offline verification.
- **LicoLite Aspect** is a first-class package surface under `pactium/licolite`.

## Boundaries

Pactium owns protocol facts, proof algorithms, canonical encoding, storage ports, verification, repair planning, and LicoLite protocol-substrate adapters.

LicoLite owns runtime policy decisions, operation dispatching, side effects, UI ownership, and durable host evidence storage.

## Status

The proof-first implementation is active. Pactium accepts the latest verifiable schema only; earlier experimental data formats are rejected.

## Usage

```js
import { createPactium } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

const envelope = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-a",
  outcomeIdempotencyKey: "outcome-a",
  input: { path: "docs/a.md" },
  stateMutations: [
    { key: "docs/a.md", value: { text: "hello" } }
  ]
});

console.log(await pactium.verifyEnvelope(envelope));
```

```js
import { createLicoLiteAspect, createLicoLiteSigner } from "pactium/licolite";

const signingSecret = process.env.LICOLITE_SIGNING_SECRET;
if (!signingSecret) throw new Error("LICOLITE_SIGNING_SECRET is required.");

const licolite = createLicoLiteAspect({
  evidencePolicy: "production",
  signer: createLicoLiteSigner({
    signerId: "host-managed-signer",
    secret: signingSecret
  })
});

const envelope = await licolite.recordWorkspaceOperation({
  operationId: "workspace.effect",
  workspaceId: "workspace-a",
  policyEvidence: { decision: "allow" },
  workspaceEffectEvidence: { durableRef: "host:asset:a" }
});

console.log(await licolite.verifyEnvelope(envelope));
```

## Verification

```bash
npm run verify:release
```

The default release gate runs deterministic proof vectors, regression snapshots, seeded property tests, scaled public API pressure profiles, coverage thresholds, hygiene checks, release-readiness checks, and package dry run. CI runs the same release gate on every supported Node.js LTS major.

## Documentation

- [Terms](./docs/TERM.md)
- [Protocol Overview](./docs/protocols/PROTOCOLS.md)
- [Protocol Profile](./docs/protocols/PROFILE.md)
- [Architecture](./docs/architecture/ARCHITECTURE.md)
- [LicoLite Aspect](./docs/LICOLITE-ASPECT.md)

## License

This project is licensed under the [GNU General Public License v3.0 or later](LICENSE).
