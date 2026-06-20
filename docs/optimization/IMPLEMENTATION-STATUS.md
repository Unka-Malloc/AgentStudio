# Optimization Implementation Status

Date: 2026-06-19

This file records the implementation pass for the optimization dossier. All design items in this directory are implemented in the current codebase; there are no remaining implementation gaps or downgraded paths.

## Implemented

| Area | Status |
| --- | --- |
| Verifiable index | Replaced the full-entry snapshot authority with content-addressed Canonical Prolly nodes. Index roots now store root metadata only, while leaf/internal nodes are CAS blocks with child refs. Membership and non-membership proofs use `index.*.prolly-path`; `readSnapshot` remains an inspection API. |
| Index verification | Added `verifyIndexProof` and registered index proof types in the proof verifier registry. `verifyProofEnvelope` recursively verifies embedded workspace, state, checkpoint, idempotency, causality, and lifecycle proofs, including nested `leftProof`/`rightProof` material. |
| Index scan/diff/mutation | `scan`, `prefix`, and `diff` now traverse Prolly nodes. `scan`/`prefix` use keyRange-bounded leaf traversal, skip non-overlapping subtrees, support exclusive `after` pagination, and stop once `limit` matching entries are collected. Diff skips equal subtree roots, handles non-aligned child ranges with ordered range merge, descends internal overlap groups until leaf-level comparison, and never falls back to collecting both full index descriptors. `put` and `delete` update a local leaf descriptor window, extend it until the replacement tail lands on a real chunk boundary or the global tail, splice the replacement leaves, and rebuild canonical parent levels from the resulting leaf descriptor sequence. |
| Workspace state root | Workspace runtime state now maintains `workspace.stateRoot` as the authoritative state proof root. Empty roots are bootstrapped once from materialized `stateEntries`; subsequent `stateMutations` update the Prolly root incrementally with `put`/`delete`. `stateEntries` remains only the runtime/materialized cache, and in-memory compaction retains `stateRoot` nodes. |
| Ledger transparency | Ledger append now persists leaves, compact-range peaks, immutable heads, and compact tree nodes separately. Durable load reads only `head-current` and `compact-range-current`; page reads use `ledger.pageEntries({ start, limit })` and missing authoritative leaves fail closed. Emitted inclusion and consistency proofs use `ledger.*.audit-path`. Consistency proofs carry RFC6962-style audit paths and never embed `oldLeafHashes`/`newLeafHashes`. Stored proof generation reads the required persisted leaves and `ledger-node` records instead of rebuilding proofs from full history. |
| Ledger verification | Inclusion and consistency verification accepts the current audit-path material, validates proof shape and hash syntax, consumes all path elements, rejects impossible head/index combinations, binds envelope `factRef` to the included ledger leaf, and supports explicit trusted-head advancement. |
| Signed heads | Added verifier manifests, automatic local Ed25519 ledger-head signing by default, signer injection, unsigned mode for explicit policy use, manifest-bound signature verification, duplicate-signer quorum rejection, and `advanceTrustedHead`. `verifyProofEnvelope` checks signed heads from embedded head manifests/signatures or supplied verifier material. |
| Proof bundles | `exportProofBundle(envelopeOrId)` emits `pactium.proof-bundle.indexed`. The indexed format uses a length-delimited binary `binaryBase64` record stream, indexed offsets, duplicate detection, size limits, block integrity checks, transitive required-block manifests, and lazy required-block verification. `verifyProofBundle(bundle, { verifyAllBlocks: true })` performs full archive integrity verification. |
| LicoLite verification | LicoLite signature extensions are decoded through the canonical codec, signer identity and algorithm are bound to the verifier, and policy/workspace-effect evidence blocks are required in offline bundles. Core registry checks now cover workspace projection proofs before the LicoLite verifier reports success. |
| Lifecycle boundary | Added append conditions, tracking cursors, cursor helpers, trusted-head advancement, causality proof material, idempotency conflict detection, and recovery planning without adding host side-effect execution to Pactium. Append-condition failures occur before ledger append and surface structured lifecycle failures. |

## Completion Notes

The previous implementation questions have been resolved in code:

| Topic | Resolution |
| --- | --- |
| Local Prolly mutation rechunking | Implemented canonical local leaf-window mutation for `put` and `delete`; large-index tests assert mutation write counts remain far below full rebuild writes, and long boundary-shifting mutation sequences assert every incremental root equals a full canonical rebuild. |
| Consistency proof node fetching | Implemented stored-node proof generation for inclusion and consistency proofs, including non-power-of-two ranges and missing leaf/node fail-closed behavior. |
| Automatic ledger-head signing | Implemented default local Ed25519 signing, custom signer injection, verifier manifest persistence, signature embedding on heads, and explicit `signer: false` unsigned mode. |
| Binary CAR-like bundle bytes | Implemented indexed binary record streams with varint record lengths, canonical headers, raw payload bytes, indexed offsets, and parser/verifier coverage for corruption modes. |
| Prolly scan/prefix paging | Implemented keyRange-bounded traversal for `scan` and `prefix`, including exclusive `after`, empty-prefix ordered scan, `min > max` empty result, and explicit `limit <= 0` clamp to one matching record. |
| Cursor page reads | Implemented `ledger.pageEntries` and switched ledger/workspace cursors away from full-history reads. Ledger cursors read only requested `ledger-leaf/<index>` objects; workspace cursors page directly through `indexEngine.scan(workspace.orderRoot, { min: padOrdinal(start), limit })`. |
| Lazy bundle verification | Implemented the indexed bundle resolver used by core and LicoLite verification. `indexedBlocksFromBundle` remains the explicit full parse/debug API, while default `verifyProofBundle` reads only the blocks needed for proof verification. |
| Incremental state root authority | Closed the remaining state gap: operation outcomes update `workspace.stateRoot` incrementally and state proof material is generated from that root rather than from a rebuilt `stateEntries` snapshot. |
| Non-aligned index diff | Closed the remaining diff gap: child range merge no longer requires aligned chunk boundaries, and leaf/internal overlap is handled by descending the internal side instead of collecting whole descriptors. |
| Proof Bundle export | Closed the remaining bundle gap: export emits the indexed record stream and no JSON block-list path remains. |
| Independent reference audit | Closed the audit gaps found against Rekor/Trillian-style logs, Dolt-like Prolly indexes, go-car/IPLD bundles, Hypercore-like signer quorum, and Axon-like lifecycle retries. Added execution tests for factRef-to-leaf binding, manifest-bound unique signer quorum, raw key ordering across reloads, canonical long-sequence Prolly mutations, transitive bundle evidence closure, recursive embedded proof verification, causality edge proofs, and idempotency conflicts. |

## Verification

The implementation is covered by focused protocol tests for:

- ledger inclusion and compact consistency audit-path proofs without full-history leakage, malformed audit hash rejection, empty-head bootstrap rejection, impossible head/index fail-fast behavior, and missing authoritative leaf fail-closed behavior;
- Prolly node roots, membership/non-membership Prolly-path proofs, canonical raw key ordering across reloads, cross-leaf non-membership forgery rejection, multi-chunk and non-aligned range diff traversal without full-tree fallback, long boundary-shifting mutation equivalence to full rebuild, bounded scan/prefix traversal, `after` pagination, and limit clamp behavior;
- incremental workspace state-root mutation, all touched-key proof verification, low single-key mutation write counts, and state-root retention through in-memory compaction;
- embedded proof tampering, factRef semantic binding, workspace/outcome/state/causality proof binding, missing verifier, non-critical unknown verifier, and verifier exception failures;
- indexed proof bundle export, random-access metadata, duplicate/offset/size/index failures, transitive required-block closure, required-block lazy verification, corrupted extra-block skip behavior, and full archive verification with `verifyAllBlocks`;
- append-condition success/conflicts, `recordOperation` intent-condition closure, durable ledger/workspace cursor paging without full-history reads, recovery planning, Ed25519 signed heads, manifest-bound unique signer quorum, envelope-level signature checks, LicoLite signer/evidence closure checks, idempotency conflict rejection, causality proof verification, and trusted-head advancement.

Current verification command:

- `npm run verify:release`
