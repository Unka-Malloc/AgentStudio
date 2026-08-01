# 0063. Keep Host Semantics Outside the Proof Substrate

Status: Accepted

Pactium remains a host-neutral protocol substrate rather than owning a framework-specific aspect, policy, verifier, route family, CLI mode, or evidence namespace. Operation facts commit to inputs and results by digest without retaining those business values by default; callers that deliberately require portable content attach a host-named Proof Extension, while state mutation values remain explicit durable state. This keeps Meshrix and every other host responsible for business semantics, authorization, effects, disclosure, and retention while Pactium owns only canonical facts, integrity, proofs, storage mechanics, and verification. The decision removes the superseded host-specific package surface and compatibility paths instead of preserving aliases or historical state discovery.
