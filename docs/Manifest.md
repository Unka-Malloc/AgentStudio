# Pactium Maintained Surface Manifest

[PRODUCT.md](../PRODUCT.md) owns the repository boundary and [CONTEXT.md](../CONTEXT.md) owns vocabulary. This internal manifest records the maintained source and documentation surface used by release validation.

## Runtime surface

- `pactium`: host-neutral proof-first API.
- `pactium/http`: host-controlled JSON adapter.
- `pactium/package.json`: package metadata.
- `bin/pactium.mjs`: doctor, local HTTP startup, operation lifecycle, envelope verification, and bundle verification.

## Owned implementation

- canonical values, protocol hashes, and content identifiers;
- Operation Ledger, signed heads, and trust-policy primitives;
- shared Verifiable Index Engine and workspace, state, checkpoint, lifecycle, idempotency, and causality structures;
- Proof Envelopes, Proof Extensions, Proof Bundles, and verification;
- JSON and SQLite Storage Port implementations;
- deterministic repair planning and explicit maintenance tasks.

## Excluded implementation

- framework-specific aspects, policies, permissions, routes, commands, or evidence namespaces;
- authentication, tenant isolation, public network security, business effects, hosted operation, and distributed consensus;
- automatic repair execution, a resident maintenance scheduler, and historical state readers.

## Documentation authorities

- root `PRODUCT.md` and `CONTEXT.md`;
- `docs/architecture/ARCHITECTURE.md`;
- `docs/protocols/PROTOCOLS.md`, `PROFILE.md`, `CANONICAL-ENCODING.md`, and `TRUST-ANCHORS.md`;
- `docs/API.md`, `TERM.md`, `FAQ.md`, and `MIGRATION.md`;
- `SECURITY.md`.

All projections must preserve the same content boundary: inputs and results are hashed by default; State Values and Proof Extension values are explicit caller-authorized persistence.
