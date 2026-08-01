<p align="center">
  <img src="docs/logo.svg" alt="Pactium" width="120" />
</p>

<h1 align="center">Pactium</h1>

<p align="center">Host-neutral, proof-first protocol substrate for verifiable operation facts, append-only recovery history, and cryptographic state commitments.</p>

<p align="center">
  <a href="./README.zh-CN.md">中文文档</a> |
  <a href="./PRODUCT.md">Product Boundary</a> |
  <a href="./docs/API.md">API Reference</a> |
  <a href="./docs/protocols/PROTOCOLS.md">Protocol Spec</a>
</p>

## What Pactium is

Pactium is an independently usable Node.js package for recording immutable operation facts and producing verifiable Proof Envelopes and Proof Bundles. It provides:

- an RFC 6962-style append-only Operation Ledger;
- Intent, Outcome, and terminal Receipt lifecycle facts;
- canonical Prolly Tree indexes with membership, non-membership, range, multiproof, and diff support;
- workspace projections, state commitments, checkpoints, cursors, and trusted-head advancement;
- content-addressed proof material and portable bundle verification;
- local JSON and SQLite Storage Port implementations; and
- deterministic repair planning, explicit maintenance tasks, and a host-controlled HTTP adapter.

Pactium is not a business database, workflow engine, authorization service, tenant boundary, public transparency service, distributed consensus system, or side-effect executor.

Meshrix is an independent downstream framework that consumes Pactium through its public package API. Meshrix owns platform governance, permissions, policies, services, plugins, execution, and operations; Pactium contains no Meshrix-specific aspect or product mode.

## Evidence and content boundary

Pactium records protocol hashes of operation input and result values. It does not retain those business values by default.

Content is persisted only when the caller explicitly supplies it as:

- a `stateMutations` value, which becomes content-addressed verifiable state; or
- a Proof Extension `value`, which becomes a hash-bound block and travels with an exported Proof Bundle when reachable from the envelope.

The host owns content minimization, authorization, disclosure, retention, and redaction. Pactium proves integrity, not the truth or safety of host content.

## Installation

```bash
npm install pactium
```

Requirements: Node.js 22 or 24, ESM only.

## Quick start

```js
import { createPactium, verifyProofBundle } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

const envelope = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-001",
  outcomeIdempotencyKey: "outcome-001",
  input: { path: "docs/readme.md" },
  result: { status: "written" },
  extensions: [{
    name: "host.operation-copy",
    critical: false,
    value: {
      input: { path: "docs/readme.md" },
      result: { status: "written" }
    }
  }]
});

const local = await pactium.verifyEnvelope(envelope);
const bundle = await pactium.exportProofBundle(envelope);
const portable = await verifyProofBundle(bundle, {
  trustPolicy: "self-carried-manifest"
});

console.log(local.ok, portable.ok);
```

Remove `extensions` when only digest commitments are required. Supplying extension or state values is an explicit persistence decision.

## Public API

| Export | Purpose |
| --- | --- |
| `pactium` | Core protocol, storage, ledger, index, proof, repair, maintenance, and HTTP exports |
| `pactium/http` | Host-controlled JSON adapter |
| `pactium/package.json` | Package metadata |

The HTTP adapter starts read-only. Mutation and privileged routes require `enableMutations: true`; hosts must still provide authentication, authorization, TLS, network exposure policy, quotas, and operational controls.

## Important boundaries

- Workspace Projection proves logical ledger membership and workspace-local order. It does not provide tenant or authorization isolation.
- Proof Bundles include reachable proof and explicit extension blocks. They do not automatically include operation input or result values.
- State mutation values are deliberately persisted and may contain sensitive content.
- Runtime metadata is bounded by normalized records, but immutable facts, envelopes, proof material, extensions, and state values can grow. Current garbage collection only sweeps unreachable derived index nodes.
- Repair Planner produces tasks; it does not execute repairs or append Repair Facts.
- Maintenance runs only when invoked. Pactium has no resident scheduler or daemon.
- JSON is intended for local development and low-concurrency use. SQLite is the local durable candidate. Distributed deployment requires host-owned coordination.

## CLI

```bash
pactium doctor --data-dir ./.pactium
pactium serve --data-dir ./.pactium --port 7288
pactium intent begin --body '{"operationId":"example","workspaceId":"ws"}'
pactium outcome append --body-file ./outcome.json
pactium operation record --body-file ./operation.json
pactium envelope verify --body-file ./envelope.json
pactium bundle verify --body-file ./bundle.json
```

## Documentation

| Authority | Purpose |
| --- | --- |
| [Product](./PRODUCT.md) | Durable goal and repository boundary |
| [Domain language](./CONTEXT.md) | Canonical terms and invariants |
| [Documentation index](./docs/README.md) | Maintained documentation map |
| [API](./docs/API.md) | Public JavaScript, TypeScript, HTTP, and CLI surfaces |
| [Architecture](./docs/architecture/ARCHITECTURE.md) | Modules, data flow, ownership, and storage behavior |
| [Protocols](./docs/protocols/PROTOCOLS.md) | Protocol facts and proof semantics |
| [Profile](./docs/protocols/PROFILE.md) | Fixed protocol parameters and current capability matrix |
| [Security](./SECURITY.md) | Security scope and disclosure process |

## Verification

```bash
npm test
npm run verify:release
```

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
