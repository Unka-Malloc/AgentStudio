# Contributing to Pactium

Thank you for considering a contribution to Pactium. This guide covers development setup, coding standards, and the pull request process.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold this standard.

## Your First Contribution

Not sure where to start? Here are some good entry points:

1. **Improve documentation** -- fix typos, clarify explanations, add examples
2. **Add test coverage** -- write tests that exercise public API paths
3. **Report bugs** -- file a clear issue with reproduction steps
4. **Review ADRs** -- read the [Architecture Decision Records](./docs/adr/) to understand design context

Look for issues labeled `good first issue` or `help wanted` in [GitHub Issues](https://github.com/Unka-Malloc/Pactium/issues).

## Getting Started

### Prerequisites

- Node.js 22+ or Node.js 24+
- npm 10+
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Unka-Malloc/Pactium.git
cd Pactium

# Install dependencies
npm ci

# Run the test suite
npm test

# Run the full release gate
npm run verify:release
```

### Project Structure

```
pactium/
  src/
    canonical/        # Canonical Value encoding (DAG-CBOR-style)
    protocol/         # Protocol constants and hashing
    storage/          # Storage Port (local JSON backend)
    ledger/           # Ledger Transparency Log
    index-engine/     # Verifiable Index Engine (Prolly Tree)
    core/             # Pactium Core composition
    proof/            # Proof Envelopes and Bundles
    verification/     # Verification failure types
    repair/           # Repair Planner
    maintenance/      # Maintenance Task Engine
    aspects/licolite/ # LicoLite Aspect (first-class)
    quality/          # Public API pressure profiles
  bin/                # CLI entry point
  tests/              # Test suites and fixtures
  scripts/            # Verification and release scripts
  docs/               # Maintained documentation
  examples/           # Usage examples
```

## Development Workflow

### 1. Choose an area

Most changes should fit one of these package areas:

- Canonical Value encoding and Protocol Hash
- Operation Ledger (Transparency Log)
- Shared Verifiable Index Engine
- Operation lifecycle, Workspace Projection, Merkle State, and Checkpoint
- Proof Envelopes and Proof Bundles
- `pactium/licolite` integration aspect
- CLI and HTTP facades

### 2. Understand the documentation

Start by reading the maintained docs for the area:

| Area | Documents |
| --- | --- |
| Protocol behavior | [protocols/PROTOCOLS.md](./docs/protocols/PROTOCOLS.md), [protocols/PROFILE.md](./docs/protocols/PROFILE.md) |
| Architecture | [architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) |
| LicoLite integration | [LICOLITE-ASPECT.md](./docs/LICOLITE-ASPECT.md) |
| Release gates | [QUALITY-GATES.md](./docs/QUALITY-GATES.md) |
| Decisions | [docs/adr/](./docs/adr/) (55 architectural decisions) |

### 3. Implement and test

- Write tests that exercise the public API whenever possible
- Add proof-vector tests for new protocol primitives
- Include regression fixtures for export surfaces

### 4. Verify locally

```bash
# Quick check (hygiene only)
npm run verify:hygiene

# Coverage-enforced tests
npm run test:coverage

# Full release gate
npm run verify:release
```

## Coding Standards

### JavaScript

- Pure ESM (`import`/`export`), no CommonJS
- No runtime dependencies
- No transpilers or bundlers -- ship source directly
- Use `node:` prefixed built-in imports (`node:crypto`, `node:fs`, etc.)
- Prefer explicit function declarations over arrow assignments for public APIs
- Keep modules focused: one conceptual area per file

### Naming

- Files: `kebab-case.js` for modules, `kebab-case.test.mjs` for tests
- Functions: `camelCase` -- `createPactium`, `verifyProofBundle`
- Constants: `SCREAMING_SNAKE_CASE` -- `PACTIUM_PROTOCOL`, `HASH_DOMAINS`
- Types: `PascalCase` -- `PactiumProofEnvelope`, `PactiumCore`

### Type Declarations

- Hand-written `.d.ts` files alongside `.js` source
- Prefer precise types over `Record<string, unknown>` for public APIs
- Use `@param` JSDoc in source when the intention is not obvious from the type

### Documentation

- Maintained docs describe current implemented behavior only
- Design claims require a corresponding ADR and working implementation
- Use [docs/TERM.md](./docs/TERM.md) vocabulary consistently

## Pull Request Process

### Before submitting

1. Use `npm run release:prepare -- <version>` for release file preparation, or run `npm run docs:sync-version` after any manual `package.json` version change
2. Run `npm run verify:release` and confirm it passes
3. Ensure your change aligns with the [Protocol Profile](./docs/protocols/PROFILE.md)
4. If you changed public API surface, update:
   - `src/index.d.ts` or `src/aspects/licolite/index.d.ts`
   - `docs/API.md`
   - Relevant regression snapshots in `tests/fixtures/`
5. If you made an architectural decision, add an ADR to `docs/adr/`

### PR guidelines

- Keep PRs focused on a single concern
- Include a clear description of what changed and why
- Reference related issues with `Fixes #N` or `Relates to #N`
- Expect review feedback on protocol correctness and proof model alignment

### What we look for in review

- Proof model correctness: does the change preserve verification guarantees?
- Boundary discipline: is host-owned behavior kept outside Pactium?
- Test coverage: are protocol paths exercised through public APIs?
- Documentation alignment: do maintained docs still match the implementation?

## What Pactium Does Not Accept

- Host-level product features (policy enforcement, UI, authorization)
- Runtime dependencies
- Historical data migration code
- Host-configurable hash algorithms, chunking parameters, or proof formats
- Storage backends that define their own hash or proof semantics
- Process-state documents (implementation plans, gap analyses)

These belong in the host system that embeds Pactium, not in the protocol substrate.

## Reporting Issues

- Use [GitHub Issues](https://github.com/Unka-Malloc/Pactium/issues) for bug reports and feature requests
- For security vulnerabilities, see [SECURITY.md](./SECURITY.md)
- Include the Node.js version, Pactium version, and a minimal reproduction

## License

By contributing, you agree that your contributions will be licensed under the [GPL-3.0-or-later](./LICENSE) license.
