# 0058. Adopt Verification Hot-Path Optimizations

Status: Implemented

Pactium verification uses call-scoped lookup maps, visited-object tracking, resolver-owned bundle index projections, and bounded caches to avoid repeated scans and decoding without retaining mutable caller input across requests. Critical extension checks are O(E+C), signed-head verification indexes signers and revocations once per call, membership multiproofs verify each leaf path once, range proofs reuse normalized leaf data, and Proof Bundle verification reuses resolver precomputation only when resolver identity is bound to the same bundle. These optimizations do not change public proof shapes, trust policy, failure semantics, append ordering, storage clone boundaries, or the host-owned content and authorization boundary.
