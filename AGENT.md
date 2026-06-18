# Pactium Agent Rules

## Project Scope

- Pactium is a library-first protocol framework, not the full product runtime.
- Active code lives in `src/`, CLI code lives in `bin/`, tests live in `tests/pactium/`, and maintained docs live in `docs/`.
- The archived full-system implementation is stored outside this repository as a compressed archive. Treat it as reference material; do not import old product code into active code.
- Default data location is `~/.pactium`, overridable with `PACTIUM_DATA_DIR` or explicit `dataDir`.

## Implementation Boundaries

- Keep the active runtime focused on Operation Ledger, Checkpoint Tree, Merkle State Substrate, the Pactium kernel, the thin CLI, and the thin HTTP facade.
- Host systems own authentication, business authorization, UI, knowledge pipelines, agent gateways, tool management, and product workflows.
- New public APIs should be exported from `src/index.js` and covered by `tests/pactium/`.
- Avoid reintroducing old CLI names, old environment variable namespaces, or old server data paths in active code.

## Verification

- Run `npm run verify:core` for core behavior.
- Run `npm run verify:hygiene` after renaming or documentation edits.
- Run `npm run pack:dry-run` before release-oriented changes.
