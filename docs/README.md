# Pactium Documentation

Welcome to the Pactium documentation. This index covers all maintained documentation for the proof-first protocol substrate.

## Getting Started

| Resource | Description |
| --- | --- |
| [README](../README.md) | Project overview, installation, and quick start |
| [API Reference](./API.md) | Complete public API documentation |
| [Examples Guide](../examples/README.md) | Annotated usage examples with learning path |
| [FAQ](./FAQ.md) | Frequently asked questions and troubleshooting |

## Core References

| Document | Description |
| --- | --- |
| [Architecture](./architecture/ARCHITECTURE.md) | System architecture, module structure, and data flow |
| [Protocol Specification](./protocols/PROTOCOLS.md) | Protocol behavior, data structures, and verification rules |
| [Protocol Profile](./protocols/PROFILE.md) | Versioned protocol parameter matrix (algorithms, constants, formats) |
| [Canonical Encoding](./protocols/CANONICAL-ENCODING.md) | Formal Pactium Canonical Value encoding rules |
| [Trust Anchors](./protocols/TRUST-ANCHORS.md) | Production trust policy, signer rotation/revocation, quorum, witness/checkpoint metadata |
| [LicoLite Aspect](./LICOLITE-ASPECT.md) | First-class LicoLite integration surface and requirements |
| [Terms](./TERM.md) | Protocol glossary with preferred and avoided vocabulary |

## Maintenance and Operations

| Document | Description |
| --- | --- |
| [Migration Guide](./MIGRATION.md) | Version compatibility, upgrade guidance, and breaking changes |
| [Quality Gates](https://github.com/Unka-Malloc/Pactium/blob/stable/docs/QUALITY-GATES.md) | Release verification requirements and automated gate coverage |
| [Release Rules](https://github.com/Unka-Malloc/Pactium/blob/stable/docs/RELEASE.md) | Release process and publication criteria |

## Decisions

| Document | Description |
| --- | --- |
| [ADR Index](https://github.com/Unka-Malloc/Pactium/tree/stable/docs/adr) | Architecture Decision Records covering protocol design choices |

## Documentation Principles

- **Current behavior only** -- maintained docs describe what is implemented today, not planned features
- **Design claims require evidence** -- every design claim has a corresponding ADR and working implementation
- **Protocol vocabulary** -- all docs use the vocabulary defined in [Terms](./TERM.md)
- **Closure enforced** -- the release gate rejects documentation that describes unimplemented surfaces

## What Is Not Published

The npm package includes a curated subset of documentation:

**Published in npm tarball:** `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `SECURITY.md`, `docs/README.md`, `docs/API.md`, `docs/FAQ.md`, `docs/MIGRATION.md`, `docs/logo.svg`, `docs/architecture/`, `docs/protocols/`, `docs/LICOLITE-ASPECT.md`, `docs/TERM.md`, `examples/`

**Not published:** ADRs, quality gates, release rules, agent instructions, release tooling, tests, build outputs, and binary/cache artifacts (these are available on GitHub only when appropriate)
