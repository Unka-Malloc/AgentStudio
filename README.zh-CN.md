<p align="center">
  <img src="docs/logo.svg" alt="Pactium" width="120" />
</p>

<h1 align="center">Pactium</h1>

<p align="center">宿主中立、证明优先的协议基底，用于可验证操作事实、仅追加恢复历史和密码学状态承诺。</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./PRODUCT.md">产品边界</a> |
  <a href="./docs/API.md">API 参考</a> |
  <a href="./docs/protocols/PROTOCOLS.md">协议规范</a>
</p>

英文正式文档是规范来源；本文件同步投影相同的产品事实。

## Pactium 是什么

Pactium 是一个可独立使用的 Node.js 包，用于记录不可变操作事实并生成可验证的证明信封与证明包。它提供：

- RFC 6962 风格的仅追加 Operation Ledger；
- Intent、Outcome 和终态 Receipt 生命周期事实；
- 支持成员、非成员、范围、多重证明和差异查询的 Canonical Prolly Tree 索引；
- 工作空间投影、状态承诺、检查点、游标与可信头推进；
- 内容寻址证明材料和可移植证明包验证；
- 本地 JSON 与 SQLite Storage Port；以及
- 确定性修复规划、显式维护任务和宿主受控 HTTP 适配器。

Pactium 不是业务数据库、工作流引擎、授权服务、租户边界、公共透明日志服务、分布式共识系统或副作用执行器。

Meshrix 是独立的下游框架，通过 Pactium 的公共包 API 使用通用证明能力。Meshrix 拥有平台治理、权限、策略、服务、插件、执行和运维；Pactium 不包含 Meshrix 专用 Aspect 或产品模式。

## 证据与内容边界

Pactium 在协议事实中记录操作输入和结果的哈希，默认不保存这些业务值。

只有调用方显式提供下列内容时，Pactium 才会持久化内容：

- `stateMutations` 值：成为内容寻址的可验证状态；
- Proof Extension 的 `value`：成为哈希绑定块，并在信封可达时随证明包导出。

宿主负责内容最小化、授权、披露、保留和脱敏。Pactium 证明完整性，不证明宿主内容的真实性或披露安全性。

## 安装

```bash
npm install pactium
```

要求：Node.js 22 或 24，仅支持 ESM。

## 快速开始

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

仅需要摘要承诺时应移除 `extensions`。提供扩展值或状态值属于显式持久化决定。

## 公共 API

| 导出 | 用途 |
| --- | --- |
| `pactium` | 核心协议、存储、账本、索引、证明、修复、维护及 HTTP 导出 |
| `pactium/http` | 宿主受控 JSON 适配器 |
| `pactium/package.json` | 包元数据 |

HTTP 适配器默认只读。写入和特权路由需要 `enableMutations: true`；宿主仍须提供身份认证、授权、TLS、网络暴露策略、配额及运维控制。

## 重要边界

- Workspace Projection 证明逻辑账本成员关系和工作空间内顺序，不提供租户或授权隔离。
- Proof Bundle 包含可达的证明块和显式扩展块，不会自动包含操作输入或结果值。
- 状态变更值会被显式持久化，可能包含敏感内容。
- 运行时元数据采用有界规范化记录，但不可变事实、信封、证明材料、扩展和状态值会持续增长；当前垃圾回收仅清理不可达的派生索引节点。
- Repair Planner 只生成任务，不执行修复，也不追加 Repair Fact。
- 维护仅在宿主调用时运行；Pactium 没有常驻调度器或守护进程。
- JSON 适用于本地开发和低并发场景；SQLite 是本地持久化候选；分布式部署需要宿主协调。

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

## 文档

| 权威 | 用途 |
| --- | --- |
| [产品](./PRODUCT.md) | 持久目标与仓库边界 |
| [领域语言](./CONTEXT.md) | 规范术语与不变量 |
| [文档索引](./docs/README.md) | 维护中文档地图 |
| [API](./docs/API.md) | JavaScript、TypeScript、HTTP 与 CLI 公共表面 |
| [架构](./docs/architecture/ARCHITECTURE.md) | 模块、数据流、所有权与存储行为 |
| [协议](./docs/protocols/PROTOCOLS.md) | 协议事实与证明语义 |
| [协议画像](./docs/protocols/PROFILE.md) | 固定协议参数与当前能力矩阵 |
| [安全](./SECURITY.md) | 安全范围与漏洞披露流程 |

## 验证

```bash
npm test
npm run verify:release
```

## 许可证

GPL-3.0-or-later。参见 [LICENSE](./LICENSE)。
