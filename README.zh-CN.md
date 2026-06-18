<p align="center">
  <img src="docs/banner.svg" alt="Pactium - 面向可审计系统的协议基底" width="100%"/>
</p>

<p align="center">
  <strong>面向 Operation Ledger、append-only Restore Tree 与 Merkle 可验证状态的协议基底。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pactium"><img src="https://img.shields.io/npm/v/pactium.svg" alt="npm version"/></a>
  <a href="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml"><img src="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/License-GPL_3.0--or--later-blue.svg" alt="License: GPL-3.0-or-later"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white" alt="Node.js 22+"/></a>
  <img src="https://img.shields.io/badge/ESM-library-111827" alt="ESM library"/>
  <img src="https://img.shields.io/badge/SQLite-backed-0f766e" alt="SQLite backed"/>
</p>

**Pactium** 是一个**库优先的协议层框架**，适用于需要持久化操作记录、可恢复执行检查点和可验证状态提交的宿主系统。

Pactium 不是完整协作产品。它只提供协议层：**Operation Ledger**、append-only **Checkpoint Tree** 和 **Merkle State Substrate**。认证、产品语义、策略引擎、智能体网关、知识流水线和用户界面都由宿主系统负责。

> [!WARNING]
> Pactium 处于早期公开形态。核心模型已经收敛并有测试覆盖，但 v0.1 API 在稳定发布线之前仍可能调整。

## 为什么选择 Pactium？

- **在效果消失之前记录它** - 将操作写入持久化账本，保留 operationId、workspace、subject、risk、status、receipt 和脱敏输入。
- **恢复历史，但不改写历史** - 以 append-only tree 表达检查点；恢复操作通过 preview 和 restore marker 追加记录，而不是覆盖原始轨迹。
- **验证状态，而不是信任存储** - 通过内容地址块、Merkle manifest、索引、事件日志和 state commit verification 建立可校验状态。
- **嵌入协议，保留你的产品** - Pactium 提供协议原语和很薄的 CLI/HTTP facade；宿主系统负责 auth、policy、UI 和业务含义。

## 核心能力

| 能力 | Pactium 提供什么 |
| --- | --- |
| **Operation Ledger** | 基于 SQLite 的操作记录，支持幂等 replay、状态流转、warnings、receipts 以及查询/列表 API。 |
| **Checkpoint Tree** | append-only 任务/工作流树，支持 `startTree`、`upsertNode`、`finishTree`、`diffTree`、`queryScope`、`previewRestore` 和 `restore`。 |
| **Merkle State Substrate** | 内容地址存储、Merkle DAG manifest、排序索引、分区事件日志、state commit 和 ingest receipt。 |
| **Pactium Kernel** | 组合层：一次 operation 同时串联 ledger entry、checkpoint node 和可选 state commit。 |
| **薄 Facade** | `pactium` CLI 与 localhost JSON HTTP server，用于 smoke test、本地工具和宿主集成。 |

## 安装

```bash
npm install pactium
```

## 作为库使用

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

## 公开 API

- `createPactiumKernel({ dataDir })`
- `createOperationLedger({ dataDir })`
- `createCheckpointTreeStore({ dataDir })`
- `createMerkleStateSubstrate({ dataDir })`
- `createPactiumHttpServer({ dataDir })`
- `startPactiumHttpServer({ dataDir, host, port })`

包内已提供 `src/index.d.ts` 类型声明。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `src/` | Pactium 协议层实现。 |
| `bin/` | `pactium` 命令行 facade。 |
| `tests/pactium/` | Core、CLI 与 HTTP smoke tests。 |
| `docs/` | Pactium 协议与架构说明。 |
| `examples/` | 最小库使用示例。 |

旧完整系统实现已压缩归档在仓库外部，不属于 Pactium 发布包或维护面。

## 验证

```bash
npm run verify
npm audit
npm publish --dry-run --access public
```

## 许可证

本项目基于 [GNU General Public License v3.0 or later](LICENSE) 发布。

---

> *"在 Pactium 中，系统不依赖对调用方的信任，而依赖可回放的操作、append-only checkpoints 与可验证状态。"*
