<p align="center">
  <img src="docs/banner.svg" alt="Pactium - Protocol Substrate for Auditable Systems" width="100%"/>
</p>

<p align="center">
  <strong>A protocol substrate for operation ledgers, append-only restore trees, and Merkle-verifiable state.</strong>
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pactium"><img src="https://img.shields.io/npm/v/pactium.svg" alt="npm version"/></a>
  <a href="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml"><img src="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/License-GPL_3.0--or--later-blue.svg" alt="License: GPL-3.0-or-later"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white" alt="Node.js 22+"/></a>
  <img src="https://img.shields.io/badge/ESM-library-111827" alt="ESM library"/>
  <img src="https://img.shields.io/badge/SQLite-backed-0f766e" alt="SQLite backed"/>
</p>

**Pactium** is a **library-first protocol framework** for host systems that need durable operation records, restoreable execution checkpoints, and verifiable state commits.

It is intentionally not a full collaboration product. Pactium provides the protocol layer: an **Operation Ledger**, an append-only **Checkpoint Tree**, and a **Merkle State Substrate**. Authentication, product semantics, policy engines, agent gateways, knowledge pipelines, and user interfaces belong to the host system.

> [!WARNING]
> Pactium is in early public shape. The core model is small and test-covered, but the v0.1 API may still evolve before a stable release line.

## Why Pactium?

- **Record effects before they disappear** - write operations into a durable ledger with operation ID, workspace, subject, risk, status, receipts, and redacted input.
- **Restore without rewriting history** - model checkpoints as append-only trees; preview and apply restore markers without mutating the original trace.
- **Verify state instead of trusting storage** - commit state through content-addressed blocks, Merkle manifests, indexes, event logs, and state commit verification.
- **Embed the protocol, keep your product** - Pactium exposes primitives and thin CLI/HTTP facades; your system owns auth, policy, UI, and domain meaning.

## Core Capabilities

| Capability | What Pactium Provides |
| --- | --- |
| **Operation Ledger** | SQLite-backed operation records with idempotent replay, status transitions, warnings, receipts, and lookup/list APIs. |
| **Checkpoint Tree** | Append-only task/workflow trees with `startTree`, `upsertNode`, `finishTree`, `diffTree`, `queryScope`, `previewRestore`, and `restore`. |
| **Merkle State Substrate** | Content-addressed store, Merkle DAG manifests, sorted indexes, partitioned event logs, state commits, and ingest receipts. |
| **Pactium Kernel** | A composition layer that records one operation across ledger entry, checkpoint node, and optional state commit. |
| **Thin Facades** | `pactium` CLI and localhost JSON HTTP server for smoke tests, local tooling, and host integration. |

## Install

```bash
npm install pactium
```

## Use As A Library

```js
import { createPactiumKernel } from "pactium";

const kernel = createPactiumKernel({ dataDir: "./.pactium" });

const receipt = await kernel.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  subject: { type: "agent", id: "agent-a" },
  effectKind: "file.changed",
  state: {
    mutations: [
      { action: "put", key: "docs/a.md", value: { text: "hello" } }
    ]
  }
});

console.log(receipt.ledgerEventId);
console.log(receipt.checkpointNodeId);
console.log(receipt.stateCommitId);
```

## CLI

```bash
pactium doctor
pactium operation record --body '{"operationId":"demo.write","workspaceId":"demo"}'
pactium ledger list
pactium checkpoint list
pactium state verify state_commit_example
pactium serve --host 127.0.0.1 --port 7288
```

## Public API

- `createPactiumKernel({ dataDir })`
- `createOperationLedger({ dataDir })`
- `createCheckpointTreeStore({ dataDir })`
- `createMerkleStateSubstrate({ dataDir })`
- `createPactiumHttpServer({ dataDir })`
- `startPactiumHttpServer({ dataDir, host, port })`

Type declarations are included through `src/index.d.ts`.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/` | Pactium protocol-layer implementation. |
| `bin/` | `pactium` command line facade. |
| `tests/pactium/` | Core, CLI, and HTTP smoke tests. |
| `docs/` | Pactium protocol and architecture notes. |
| `examples/` | Minimal library usage examples. |

The old full-system implementation is stored outside this repository as a compressed reference archive. It is not part of the Pactium package or maintenance surface.

## Verify

```bash
npm run verify
npm audit
npm publish --dry-run --access public
```

## License

This project is licensed under the [GNU General Public License v3.0 or later](LICENSE).

---

> *"In Pactium, systems do not rely on trust in the caller. They rely on replayable operations, append-only checkpoints, and verifiable state."*
