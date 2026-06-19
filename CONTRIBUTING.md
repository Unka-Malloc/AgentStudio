# Contributing

Pactium is a proof-first protocol substrate for LicoLite. Contributions are easiest to review when they keep the package centered on the protocol core and make the verification story clear.

## Project Focus

Most changes should fit one of these package areas:

- Canonical Value encoding and Protocol Hash
- Operation Ledger
- Shared Verifiable Index Engine
- Operation lifecycle, Workspace Projection, Merkle State, and Checkpoint proof material
- Proof Envelopes and Proof Bundles
- `pactium/licolite`
- Thin CLI and HTTP facades

Product workflows, UI behavior, business authorization, and runtime policy decisions usually belong in the host system that embeds Pactium. In this repository, the maintained package surface stays small and proof-oriented.

## Maintenance Flow

Start from the maintained docs that match the area you are changing:

- Protocol behavior: `docs/protocols/PROTOCOLS.md` and `docs/protocols/PROFILE.md`
- Architecture and durable decisions: `docs/architecture/ARCHITECTURE.md` and `docs/adr/`
- LicoLite integration: `docs/LICOLITE-ASPECT.md`
- Release expectations: `docs/QUALITY-GATES.md`, `docs/RELEASE.md`, and `docs/TOOLING.md`

When code changes affect a public behavior, update the related docs or ADR in the same change. When docs describe behavior, keep the implementation and tests close enough that a reviewer can trace the claim.

## Documentation Style

Maintained documentation describes the current project state. If you need planning notes while developing, keep them temporary and fold the durable decisions back into `docs/` or ADRs before release.

Use current topic-oriented documents instead of version-named or process-state documents. Historical material is easiest to maintain when it is merged into the current docs or captured as an ADR.

`CONTEXT.md` is development scratch space. Treat it as working context, then move durable terminology or decisions into maintained docs before they become package documentation.

Tooling changes are part of the release surface. Keep `docs/TOOLING.md`, `package.json`, `bin/`, `scripts/`, and the release-readiness gate aligned when any of them changes.

## Verification

Before submitting a change, run the release gate:

```bash
npm run verify:release
```

The release gate includes hygiene checks, coverage-enforced tests, protocol gates, release-readiness checks, and package dry run. Release CI runs the same gate on each supported Node.js LTS major declared by `engines`.
