<p align="center">
  <img src="docs/logo.svg" alt="Pactium" width="120" />
</p>

<h1 align="center">Pactium</h1>

<p align="center">
  证明优先的协议基底，提供可验证的操作事实、仅追加的恢复历史和密码学状态验证。
</p>

<p align="center">
  <a href="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml"><img src="https://github.com/Unka-Malloc/Pactium/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/pactium"><img src="https://img.shields.io/npm/v/pactium.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/pactium"><img src="https://img.shields.io/npm/dm/pactium.svg" alt="npm downloads" /></a>
  <a href="https://github.com/Unka-Malloc/Pactium/blob/stable/LICENSE"><img src="https://img.shields.io/npm/l/pactium.svg" alt="license" /></a>
  <a href="https://img.shields.io/node/v/pactium"><img src="https://img.shields.io/node/v/pactium.svg" alt="node version" /></a>
  <img src="https://img.shields.io/badge/types-included-blue.svg" alt="TypeScript types" />
</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./docs/API.md">API 参考</a> |
  <a href="./docs/protocols/PROTOCOLS.md">协议规范</a> |
  <a href="https://github.com/Unka-Malloc/Pactium/blob/stable/CONTRIBUTING.md">贡献指南</a>
</p>

---

## 目录

- [为什么选择 Pactium](#为什么选择-pactium)
- [设计哲学](#设计哲学)
- [特性](#特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [API 概览](#api-概览)
- [CLI 命令行](#cli-命令行)
- [架构](#架构)
- [适用场景](#适用场景)
- [文档](#文档)
- [运行环境](#运行环境)
- [验证](#验证)
- [贡献](#贡献)
- [许可证](#许可证)

## 为什么选择 Pactium

Pactium 是 [LicoLite](https://github.com/Unka-Malloc) 的协议基底。它的存在是为了向 LicoLite 提供持久操作事实、仅追加恢复历史和可验证状态——这些是 LicoLite 的产品需求在协议层面所要求的能力。

具体来说，Pactium 提供：

- **仅追加操作账本** -- 将操作事实记录为透明日志中的不可变条目
- **密码学证明** -- 每次写入返回包含包含证明和一致性证明的证明信封
- **可移植验证** -- 证明包可以在无需访问原始存储的情况下验证
- **工作空间投影** -- 可验证的工作空间范围索引，支持成员和非成员证明

Pactium 是一个零依赖的纯 ESM Node.js 包。它将操作元数据记录到仅追加的透明日志中，维护可验证索引，并生成证明信封和证明包。它不替代数据库、消息队列或宿主系统用于自身应用数据的其他存储系统。

LicoLite 的一等集成界面位于 `pactium/licolite`。

## 设计哲学

| 原则 | 含义 |
| --- | --- |
| **证明优先** | 写操作返回可验证的证明信封，而非存储确认。证明就是 API 响应。 |
| **仅追加事实** | 操作被记录为不可变的 Intent 和 Outcome 事实。修正创建带有因果引用的新事实，而非修改历史。 |
| **唯一排序权威** | Operation Ledger 是唯一的全局排序权威，所有其他结构从中派生排序。 |
| **可验证索引** | 每个索引（状态、工作空间、生命周期）使用相同的 Canonical Prolly Tree 引擎，支持成员和非成员证明。 |
| **宿主边界** | Pactium 拥有协议事实和证明，宿主系统拥有策略决策、副作用、授权和持久证据存储。 |
| **零依赖** | 无运行时依赖。直接发布源码。可预测的供应链。 |
| **协议，非配置** | 哈希算法、编码格式和分块参数是协议常量，不是宿主选项。更改需要新的协议版本。 |

## 特性

| 能力 | 描述 |
| --- | --- |
| **Operation Ledger** | RFC 6962 风格透明日志，支持包含证明和一致性证明 |
| **仅追加生命周期** | Operation Intent / Outcome 事实，支持幂等重放 |
| **可验证索引引擎** | Canonical Prolly Tree，支持成员、非成员证明和高效差异比对 |
| **工作空间投影** | 可验证的工作空间范围顺序和成员索引 |
| **Merkle 状态** | 内容寻址的状态提交，绑定到操作结果 |
| **检查点树** | 可验证的恢复和进度结构 |
| **证明信封** | 跨证明收据，绑定账本、索引、状态和检查点证据 |
| **证明包** | 可移植的 CAR 格式导出，支持离线验证 |
| **签名头** | 可选的 Ed25519 账本头签名，配合验证者清单 |
| **LicoLite Aspect** | 一等集成界面，默认启用工作空间投影和签名 |
| **修复规划** | 从结构化验证失败中确定性地生成修复任务 |
| **零依赖** | 纯 ESM，无运行时依赖，直接发布源码 |

## 安装

```bash
npm install pactium
```

```bash
pnpm add pactium
```

```bash
yarn add pactium
```

### 运行环境要求

- Node.js 22+ 或 Node.js 24+
- 仅 ESM（你的 `package.json` 中需要 `"type": "module"`）

## 快速开始

### 记录操作并获取完整证明

```js
import { createPactium } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

// 记录操作，返回可验证的证明信封
const envelope = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-001",
  outcomeIdempotencyKey: "outcome-001",
  input: { path: "docs/readme.md" },
  stateMutations: [
    { key: "docs/readme.md", value: { content: "hello world" } }
  ]
});

// 验证信封
const result = await pactium.verifyEnvelope(envelope);
console.log(result.ok); // true
```

### 使用 LicoLite Aspect

```js
import { createLicoLiteAspect, createLicoLiteSigner } from "pactium/licolite";

const licolite = createLicoLiteAspect({
  evidencePolicy: "production",
  signer: createLicoLiteSigner({
    signerId: "host-signer",
    secret: process.env.LICOLITE_SIGNING_SECRET
  })
});

const envelope = await licolite.recordWorkspaceOperation({
  operationId: "workspace.asset.upload",
  workspaceId: "workspace-a",
  policyEvidence: { decision: "allow", rule: "upload-permitted" },
  workspaceEffectEvidence: { durableRef: "host:asset:image-001" }
});

// LicoLite 级别验证：检查签名 + 关键扩展
const result = await licolite.verifyEnvelope(envelope);
console.log(result.ok); // true
```

LicoLite 生产模式在记录和验证信封时必须显式提供 `signer` 或 `signerSecret`。`opportunistic` 模式用于本地开发，可能使用开发签名器。

### 导出和验证可移植证明包

```js
import { createPactium, verifyProofBundle } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

// 将信封导出为可移植的证明包
const bundle = await pactium.exportProofBundle(envelope);

// 无需本地存储即可验证
const result = await verifyProofBundle(bundle);
console.log(result.ok); // true
```

## API 概览

Pactium 暴露三个包入口点：

| 导出 | 入口 | 描述 |
| --- | --- | --- |
| `pactium` | `./src/index.js` | 核心证明优先协议 API |
| `pactium/http` | `./src/http.js` | 宿主受控服务集成的 HTTP 适配器 |
| `pactium/licolite` | `./src/aspects/licolite/index.js` | LicoLite 集成 Aspect |

### HTTP 适配器 (`pactium/http`)

```js
import {
  createPactiumHttpServer,
  startPactiumHttpServer
} from "pactium/http";
```

HTTP 适配器以 JSON 路由开放操作生命周期、证明信封和证明包验证、证明包导出、工作空间投影、游标分页、追加条件、可信头推进、修复计划、维护任务、扩展和信封存储等调用。完整路由矩阵见 [docs/API.md](./docs/API.md#http-adapter-api-pactiumhttp)。

### TypeScript

Pactium 附带手工编写的 TypeScript 声明。所有公共类型均可从包入口点导入：

```ts
import type {
  PactiumCore,
  PactiumProofEnvelope,
  PactiumVerificationResult,
  PactiumProofBundle,
  PactiumLedgerHead,
  PactiumVerificationFailure
} from "pactium";

import type {
  LicoLiteAspect,
  LicoLiteSigner
} from "pactium/licolite";
```

完整 API 参考见 [docs/API.md](./docs/API.md)。

## CLI 命令行

Pactium 提供 CLI 用于本地操作记录和验证：

```bash
# 检查数据目录健康状态
pactium doctor --data-dir ./.pactium

# 启动 HTTP 验证服务器
pactium serve --port 7288

# 记录操作
pactium operation record --body '{"operationId":"test","workspaceId":"ws"}'

# 验证证明信封
pactium envelope verify --body-file ./envelope.json

# 验证证明包
pactium bundle verify --body-file ./bundle.json

# LicoLite 工作空间操作
pactium licolite record --body '{"operationId":"ws.op","workspaceId":"ws"}'
pactium licolite verify --body-file ./licolite-envelope.json
```

CLI 从 `--body`、`--body-file` 或标准输入读取 JSON。

`pactium serve` 默认绑定 `127.0.0.1`，并强制 1 MiB JSON 请求体上限。只有在宿主系统提供认证、授权和传输安全控制时，才应使用 `--host`、`--max-body-bytes`、`PACTIUM_HTTP_HOST` 和 `PACTIUM_HTTP_MAX_BODY_BYTES` 暴露到非本机地址。

## 架构

```
                    宿主系统 (LicoLite)
                           |
                    pactium/licolite
                           |
            +--------------+---------------+
            |       Pactium 核心            |
            |                              |
            |  +------------------------+  |
            |  | Canonical Value + Hash |  |
            |  +------------------------+  |
            |  | Storage Port (CAS)     |  |
            |  +------------------------+  |
            |  | Operation Ledger       |  |  <- 全局排序权威
            |  | (Transparency Log)     |  |
            |  +------------------------+  |
            |  | Verifiable Index Engine|  |  <- 共享 Prolly Tree
            |  +------------------------+  |
            |  | Workspace Projection   |  |
            |  | Merkle State           |  |
            |  | Checkpoint Tree        |  |
            |  | Lifecycle Indexes      |  |
            |  +------------------------+  |
            |  | Proof Envelopes        |  |
            |  | Proof Bundles          |  |
            |  +------------------------+  |
            |  | Repair Planner         |  |
            |  | Maintenance Engine     |  |
            |  +------------------------+  |
            +------------------------------+
```

**核心设计原则：**

- Operation Ledger 是唯一的全局排序权威
- 所有索引共享同一个可验证索引引擎（Canonical Prolly Tree）
- 写操作返回可验证的证明信封，而非存储记录
- 证明包支持无需原始存储的独立验证
- 宿主系统拥有策略、副作用和持久证据存储的所有权

详细架构文档见 [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)。

## 适用场景

**适合使用 Pactium 的场景：**

- 需要操作被记录且账本一致的密码学证明
- 需要可移植的证明包，可在无需原始系统的情况下验证
- 需要工作空间范围的操作隔离及可验证的成员证明
- 需要仅追加的操作历史及确定性恢复
- 需要幂等操作记录及重放检测
- 需要可验证的状态根及高效差异比对

**Pactium 不适合：**

- 通用数据库存储（请使用数据库）
- 分布式节点间的网络共识（Pactium 是本地协议基底）
- 授权或访问控制（宿主系统拥有策略）
- 文件存储或 Blob 管理（Pactium 存储操作元数据和证明）

## 文档

| 文档 | 描述 |
| --- | --- |
| [API 参考](./docs/API.md) | 完整的公共 API 文档 |
| [架构](./docs/architecture/ARCHITECTURE.md) | 系统架构和模块结构 |
| [协议规范](./docs/protocols/PROTOCOLS.md) | 协议行为和数据流 |
| [协议参数矩阵](./docs/protocols/PROFILE.md) | 协议参数矩阵 |
| [LicoLite Aspect](./docs/LICOLITE-ASPECT.md) | LicoLite 集成界面 |
| [术语表](./docs/TERM.md) | 协议词汇表 |
| [常见问题](./docs/FAQ.md) | 常见问题与故障排除 |
| [迁移指南](./docs/MIGRATION.md) | 版本兼容性与升级指导 |
| [示例指南](./examples/README.md) | 带注释的使用示例 |
| [质量门](https://github.com/Unka-Malloc/Pactium/blob/stable/docs/QUALITY-GATES.md) | 发布验证要求 |
| [ADR](https://github.com/Unka-Malloc/Pactium/tree/stable/docs/adr) | 架构决策记录（55 项决策） |

## 运行环境

| 要求 | 版本 |
| --- | --- |
| Node.js | `^22.0.0 \|\| ^24.0.0` |
| 模块系统 | 仅 ESM (`"type": "module"`) |
| 运行时依赖 | 无 |

Pactium 是纯 ESM 包，不能从 CommonJS 模块中 `require()`。如需 CJS 互操作，请使用动态 `import()`。

## 验证

本地运行完整发布门：

```bash
npm run verify:release
```

这将运行覆盖率强制测试、协议证明向量、回归快照、种子属性测试、缩放公共 API 压力测试、卫生检查、包内容检查、打包干燥运行和发布干燥运行。

完整计数压力测试（显式发布审查）：

```bash
PACTIUM_FULL_PRESSURE=1 npm run verify:protocol:gates
```

## 生态系统

| 包 | 描述 |
| --- | --- |
| [`pactium`](https://www.npmjs.com/package/pactium) | 核心协议基底（本包） |
| `pactium/licolite` | 一等 LicoLite 集成 Aspect（已包含） |

Pactium 是 [LicoLite](https://github.com/Unka-Malloc) 的协议基底。`pactium/licolite` Aspect 是一等包导出，而非外部插件。

## 贡献

参见 [CONTRIBUTING.md](https://github.com/Unka-Malloc/Pactium/blob/stable/CONTRIBUTING.md) 了解开发环境设置、编码规范和提交指南。

## 许可证

[GPL-3.0-or-later](./LICENSE) -- Copyright (c) Unka Y.Y.
