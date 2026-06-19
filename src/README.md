# Source Status

`src/` is the Pactium proof-first implementation.

- `index.js` is the package root facade and exports only proof-first APIs.
- `protocol/`, `canonical/`, and `storage/` own protocol constants, canonical values, hashing, and the local storage port adapter.
- `ledger/`, `index-engine/`, `proof/`, `repair/`, and `maintenance/` own proof algorithms and verification-oriented protocol machinery.
- `core/pactium-core.js` composes the protocol modules into the root Pactium runtime.
- `aspects/licolite/` owns the first-class `pactium/licolite` LicoLite Aspect.
- `quality/` owns public API pressure profiles used by release gates.
- Historical storage-shaped source files are removed and are not accepted by the current implementation.

Use [Architecture](../docs/architecture/ARCHITECTURE.md), [Protocols](../docs/protocols/PROTOCOLS.md), and [Protocol Profile](../docs/protocols/PROFILE.md) as the protocol authority.
