# Pactium Product

This document owns Pactium's durable product goal and repository boundary. Current protocol and API facts belong to the indexed technical documentation and executable package surface.

## Purpose

Pactium is a host-neutral proof-first protocol substrate. It records immutable operation facts, maintains verifiable projections and state commitments, and produces portable cryptographic evidence that a host can verify independently.

Meshrix is an independent downstream framework that consumes Pactium through the public `pactium` package contract. Meshrix owns its platform governance, policies, permissions, services, plugins, workspaces, execution, and operations. Pactium does not contain a Meshrix-specific aspect or product mode.

## Repository boundary

Pactium owns:

- canonical value encoding, protocol hashing, content identifiers, and fixed protocol parameters;
- the append-only Operation Ledger and its inclusion and consistency proofs;
- verifiable indexes, workspace projections, operation lifecycle facts, state commitments, and checkpoints;
- Proof Envelopes, Proof Extensions, Proof Bundles, verification, and trust-policy primitives;
- host-selected local JSON and SQLite storage adapters behind the Storage Port;
- deterministic recovery and repair planning, explicit maintenance calls, and a host-controlled HTTP adapter; and
- package-owned tests, protocol vectors, quality gates, and release validation.

Pactium does not own:

- Meshrix or another host framework's product semantics, policy decisions, permissions, approvals, dispatch, side effects, or user interface;
- authentication, tenant isolation, transport security, public-service exposure, distributed consensus, or hosted operation;
- a business database, object store, queue, workflow engine, audit policy, or automatic repair executor; or
- the truth of host claims carried by a hash, reference, state value, or Proof Extension.

## Content and evidence boundary

Operation Intent and Outcome facts commit to caller inputs and results with protocol hashes. Pactium does not retain those business values by default.

A caller may explicitly persist content in two ways:

- a state mutation value becomes a content-addressed State Value because the caller requested durable verifiable state; or
- a Proof Extension value becomes a hash-bound block and is included in a Proof Bundle when reachable from the exported envelope.

Those explicit values may contain sensitive content. Pactium verifies their integrity, not their business meaning or disclosure safety. The host owns minimization, authorization, retention, and redaction before supplying them.

## Durable direction

Pactium remains independently usable by any conforming host. Host-specific integration code belongs to the host repository unless it is a protocol-neutral adapter useful to all Pactium consumers. Protocol or storage changes use complete current-schema migrations without permanent compatibility paths.
