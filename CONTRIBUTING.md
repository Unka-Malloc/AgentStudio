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
    canonical/        # Pactium-specific canonical JSON encoding
    protocol/         # Protocol constants and hashing
    storage/          # Storage Port (in-memory, JSON, and SQLite)
    ledger/           # Ledger Transparency Log
    index-engine/     # Verifiable Index Engine (Prolly Tree)
    core/             # Pactium Core composition
    proof/            # Proof Envelopes and Bundles
    verification/     # Verification failure types
    repair/           # Repair Planner
    maintenance/      # Maintenance Task Engine
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
- CLI and HTTP facades

### 2. Understand the documentation

Start by reading the maintained docs for the area:

| Area | Documents |
| --- | --- |
| Product boundary | [PRODUCT.md](./PRODUCT.md), [CONTEXT.md](./CONTEXT.md) |
| Protocol behavior | [protocols/PROTOCOLS.md](./docs/protocols/PROTOCOLS.md), [protocols/PROFILE.md](./docs/protocols/PROFILE.md) |
| Architecture | [architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) |
| Release gates | [QUALITY-GATES.md](./docs/QUALITY-GATES.md) |
| Decisions | [docs/adr/](./docs/adr/) |

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
   - `src/index.d.ts` or `src/http.d.ts`
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

## Host Capability Intake Workflow

When a host (including Meshrix) observes a reusable proof or verifiable-state capability that belongs in Pactium, follow this intake order. Pactium remains an independent product; host convenience never expands the repository boundary.

| Phase | Owner | Action | Done when |
| --- | --- | --- | --- |
| A1 Freeze | Cross-repo review | Pass the admission gate below and freeze host-neutral API names | No host product names in the Pactium draft |
| A2 Implement | Pactium | Implement, document, test, and pass `npm run verify:release` | Gate green; no host leakage |
| A3 Publish | Pactium | Publish the npm version that contains the capability | Version visible on the registry |
| A4 Switch | Host | Bump the exact `pactium` dependency and route authority through the new API | New path is authoritative |
| A5 Deprecate | Host | Keep old host exports callable only as thin delegates; mark Deprecated with replacement and next-major removal | Docs and symbols agree |
| A6 Verify | Both | Pactium boundary gates + host substrate/boundary/proof gates | Failures attributed by owner |
| B Remove | Host next major | Delete Deprecated symbols, wrappers, and old-entry tests | No compatibility residue |

Admission gate (all required):

1. Host-neutral: no host product names, env vars, scopes, or extension names in Pactium.
2. Multi-host reusable: any conforming host can call the API without Meshrix or another product.
3. Inside PRODUCT ownership: facts, hashes, ledger, indexes, proofs, storage mechanics, verification, planning, or a strict subset helper.
4. Verifiable in Pactium alone: tests and examples must not import a host repository.
5. Pactium names the contract first; hosts adapt afterward.

Constraints:

- Do not couple a host to an unpublished Pactium contract.
- Do not delete still-public host APIs in phase A; only Deprecated delegates are allowed.
- Deprecated wrappers must not keep a second business implementation.

## What Pactium Does Not Accept

- Host-level product features (policy enforcement, UI, authorization)
- Runtime dependencies
- Historical data migration code
- Host-configurable hash algorithms, chunking parameters, or proof formats
- Storage backends that define their own hash or proof semantics
- Process-state documents (implementation plans, gap analyses)
- Host-specific aspects, product modes, or Meshrix-shaped adapters

These belong in the host system that embeds Pactium, not in the protocol substrate.

## Reporting Issues

- Use [GitHub Issues](https://github.com/Unka-Malloc/Pactium/issues) for bug reports and feature requests
- For security vulnerabilities, see [SECURITY.md](./SECURITY.md)
- Include the Node.js version, Pactium version, and a minimal reproduction

## License

By contributing, you agree that your contributions will be licensed under the [GPL-3.0-or-later](./LICENSE) license.
