# Migration Guide

This guide covers version compatibility, protocol stability, and upgrade guidance for Pactium.

## Version Policy

Pactium follows [Semantic Versioning](https://semver.org/):

- **Major** -- breaking changes to public API or protocol format
- **Minor** -- new features and backward-compatible API additions
- **Patch** -- bug fixes with no API or protocol changes

During the `0.x` series, minor versions may include breaking changes. The protocol profile is locked per minor version.

## Protocol Stability

| Component | Stability | Change policy |
| --- | --- | --- |
| Protocol Hash (`sha256`) | Locked per protocol version | Requires new `PACTIUM_PROTOCOL` value |
| Canonical Value encoding | Locked per protocol version | Requires new protocol version |
| Proof vector outputs | Locked per protocol version | Changing expected vectors requires explicit protocol revision |
| Ledger leaf/node hash format | Locked per protocol version | Part of protocol constants |
| Content-Defined Chunking params | Locked per protocol version | Protocol constants, not configuration |
| Public API shape | Stable within minor | Additions in minor, removals in next minor/major |
| TypeScript declarations | Stable within minor | New types in minor, type changes in next minor/major |

## Data Directory Compatibility

### Current protocol/data format: v0.2.x

Pactium 0.4.x keeps the v0.2 protocol/data directory format and creates and manages its own data directory format. Key constraints:

- **New directories only** -- Pactium does not read or migrate data from earlier experimental formats
- **Latest schema only** -- there is no support for loading older schema versions
- **Forward-compatible within patch** -- patch releases do not change data format

### Upgrading between minor versions

When upgrading from one minor version to the next:

1. Check the [CHANGELOG](../CHANGELOG.md) for breaking changes
2. Create a fresh data directory for the new version if the protocol version changes
3. Use Proof Bundles to preserve portable verification material from the old version

Pactium intentionally does not include automatic migration. Data directories are protocol-versioned, and mixing protocol versions in one directory is not supported.

## Node.js Compatibility

| Pactium version | Node.js requirement |
| --- | --- |
| 0.4.x | `^22.0.0 \|\| ^24.0.0` |
| 0.3.x | `^22.0.0 \|\| ^24.0.0` |
| 0.2.x | `^22.0.0 \|\| ^24.0.0` |

Pactium is pure ESM. It cannot be loaded via `require()`. If your project uses CommonJS, use dynamic `import()`:

```js
// CommonJS interop
const { createPactium } = await import("pactium");
```

## ESM-Only Package

Pactium ships as a pure ES module. There is no CommonJS build and no dual-package export.

**If you see `ERR_REQUIRE_ESM`:**

- Ensure your `package.json` has `"type": "module"`
- Or rename your files to `.mjs`
- Or use dynamic `import()` from CommonJS

**If you see `ERR_MODULE_NOT_FOUND`:**

- Ensure you're importing from the correct path (`pactium`, `pactium/http`, or `pactium/licolite`)
- Deep imports into `src/` are not part of the public API and may change without notice

## API Stability Tiers

| Tier | Surface | Guarantee |
| --- | --- | --- |
| **Public** | Exports from `pactium`, `pactium/http`, and `pactium/licolite` | Semver-governed; no removals in patch |
| **Protocol Constants** | `PACTIUM_PROTOCOL`, `PACTIUM_PROTOCOL_PROFILE`, `HASH_DOMAINS` | Locked per protocol version |
| **Type Declarations** | `.d.ts` exports | Stable within minor version |
| **CLI** | `pactium` commands | Stable within minor; new subcommands in minor |
| **Internal** | Files under `src/` not exported from entry points | No stability guarantee |

## Proof Portability

Proof Bundles exported from any Pactium version remain independently verifiable as long as:

1. The protocol version is known to the verifier
2. The bundle contains all required content-addressed blocks
3. Critical extensions in the bundle are supported by the verifier

Proof Bundles are the recommended way to preserve verification material across Pactium version upgrades.

## Breaking Change Announcements

Breaking changes will be:

1. Documented in the [CHANGELOG](../CHANGELOG.md) under a `### Breaking Changes` section
2. Announced at least one minor version in advance when possible (deprecation notices)
3. Accompanied by migration instructions in this document

## From Pre-Release to Stable (Future)

When Pactium reaches 1.0:

- The protocol format will be considered stable
- Data directory format will receive backward-compatible migration support
- The public API will follow strict semver without the `0.x` flexibility
- This section will be updated with specific 0.x-to-1.0 migration steps
