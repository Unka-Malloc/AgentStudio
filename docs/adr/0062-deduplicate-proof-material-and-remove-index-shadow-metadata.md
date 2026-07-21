# 0062. Deduplicate Proof Material and Remove Index Shadow Metadata

Date: 2026-07-21

Status: Implemented

## Context

Every index proof repeated leaf bodies and sibling descriptors. Causality emitted one proof object per edge, and root metadata was duplicated in protocol-object aliases even though the root CAS node already committed the same information. Host signing also finalized an unsigned envelope before storing a second signed form.

## Decision

- Proof material owns one deterministic `proofDescriptorTable` and one `proofLeafTable`; individual proofs carry integer references into those tables.
- The leaf table remains inside the proof-material CAS block, so historical verification does not depend on retaining obsolete index nodes.
- Causality uses one membership multiproof over the exact canonical edge-key set.
- Index root metadata is reconstructed from the root CAS node. Root protocol-object shadow aliases are removed.
- Leaf-node CAS references include CID-shaped value references so storage reachability is explicit.
- Envelope extension finalization runs once before registration. Only the final signed envelope is assigned an identity and stored.
- Verifiers reject mixed inline/table leaf forms, invalid table indexes, wrong domains, and causality key-set rebinding.

## Consequences

Repeated descriptors and leaves are stored once per proof-material block; causality proof overhead grows with shared paths instead of one independent path object per edge. Removing shadow metadata eliminates an UPSERT per index root while keeping the CAS root authoritative. Historical envelopes stay self-contained and remain verifiable after conservative index-node GC.

The approach follows the table-deduplication idea used by Git's [multi-pack-index](https://git-scm.com/docs/multi-pack-index) while retaining Jellyfish-Merkle-style authenticated paths in one immutable proof object; see the [Jellyfish Merkle Tree paper](https://developers.diem.com/papers/jellyfish-merkle-tree/2021-01-14.pdf).
