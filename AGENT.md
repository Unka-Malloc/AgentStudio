# Pactium Agent Entry

This is the single in-repository entry point for automated coding agents. Read [PRODUCT.md](./PRODUCT.md) for the repository boundary and [CONTEXT.md](./CONTEXT.md) for canonical vocabulary before changing code, tests, documentation, package metadata, or release tooling.

## Scope

- Pactium is a host-neutral proof-first protocol substrate. Meshrix is an independent downstream framework and must not be implemented as a Pactium aspect, product mode, route family, or policy namespace.
- Active runtime code lives in `src/`, CLI code in `bin/`, tests in `tests/pactium/`, examples in `examples/`, and maintained technical documentation in `docs/`.
- `PRODUCT.md` owns durable intent and repository boundaries. `CONTEXT.md` owns vocabulary. Architecture, protocol, profile, API, and security documents own implemented technical projections.
- Process-only material, ADRs, tests, tooling, reports, caches, and build outputs remain outside the npm package unless the package-content policy explicitly includes them.

## Implementation boundaries

- Keep business identity, authorization, policy, approval, dispatch, side effects, content minimization, and UI behavior in the host system.
- Operation facts store input and result digests by default. Do not implicitly persist business input or result values. Explicit state mutations and Proof Extension values are caller-authorized content boundaries.
- The Operation Ledger is the global ordering authority. Checkpoint, state, workspace, lifecycle, idempotency, and causality structures remain verifiable derivatives.
- Reuse the shared Verifiable Index Engine. Do not introduce domain-specific proof trees or storage-defined hash semantics.
- Workspace Projection is logical membership and ordering, not tenant, authorization, or storage isolation.
- Pactium plans repairs and exposes explicit maintenance tasks; it does not run a resident scheduler, execute host policy, or invent missing facts.
- Root exports expose only the current proof-first API. Complete migrations remove superseded names, paths, compatibility layers, fixtures, and documentation in the same change.
- Support only the current verifiable schema. Do not discover, import, or migrate retired product state.

## Verification

- Keep code, declarations, tests, examples, package metadata, and all affected documentation aligned in one bounded change.
- Run the narrowest relevant test first, then the release gate once after all changes are complete.
- Add protocol vectors for new protocol primitives and regression coverage for public API or wire-shape changes.
- Keep the npm tarball limited to the approved runtime, CLI, examples, public docs, metadata, security policy, changelog, and license.
- Publish only through the repository's protected release workflow after the full verification matrix passes.
