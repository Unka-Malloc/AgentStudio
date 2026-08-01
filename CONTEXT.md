# Pactium Domain Language

This glossary defines Pactium-local vocabulary and invariants. [PRODUCT.md](./PRODUCT.md) owns the repository boundary; technical documents own implemented API and protocol details.

| Term | Meaning |
| --- | --- |
| **Pactium** | A host-neutral proof-first protocol substrate for immutable operation facts, verifiable state commitments, and portable proof material. |
| **Host** | A system that calls Pactium and owns business meaning, identity, authorization, policy, effects, content handling, and operational controls. |
| **Meshrix** | An independent downstream framework and Pactium consumer. It is not a Pactium aspect, mode, namespace, or repository-owned policy layer. |
| **Operation Fact** | An immutable Intent, Outcome, or Receipt recorded in the Operation Ledger. A fact proves what Pactium recorded, not whether a host-owned business claim is true. |
| **Input Digest** | The protocol hash by which an Operation Intent commits to caller input without retaining the input value by default. |
| **Result Digest** | The protocol hash by which an Operation Outcome or Receipt commits to caller output without retaining the output value by default. |
| **Host Content** | Any caller-owned input, result, document, path, prompt, response, policy material, or other business value outside Pactium's core facts. |
| **Explicit Proof Copy** | Host Content deliberately supplied as a Proof Extension value so its content-addressed block can travel with a Proof Bundle. It is never created implicitly from operation input or result. |
| **State Value** | A caller-supplied state mutation value deliberately persisted as content-addressed verifiable state. It is not an implicit copy of operation input or result. |
| **Operation Ledger** | The append-only global ordering authority for Pactium protocol facts. |
| **Workspace Projection** | A verifiable logical membership and ordering projection derived from the global ledger. It is not tenant, authorization, or storage isolation. |
| **Proof Envelope** | A receipt that binds one fact to ledger, index, state, checkpoint, and extension references required for verification. |
| **Proof Extension** | A host-named, hash-bound value attached without changing Pactium's core fact schema. A critical extension requires explicitly configured verifier support. |
| **Proof Bundle** | A portable indexed collection containing an envelope and its reachable required proof blocks. It is not a storage snapshot and does not automatically include caller input or result. |
| **Trust Policy** | The verifier rule that determines which carried or externally trusted signing material is sufficient. Pactium does not provide a universal trust root. |
| **Repair Plan** | A deterministic description of possible recovery work. It does not execute a repair or append a Repair Fact. |
| **Maintenance Task** | A host-invoked bounded task. Pactium has no resident scheduler or autonomous maintenance daemon. |
