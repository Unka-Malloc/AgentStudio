# Pactium

Pactium 是 LicoLite 的 proof-first protocol substrate，用于证明系统状态是可记录、可回溯、可管理的。

## 当前状态

- package root 只导出 proof-first API。
- `pactium/licolite` 是 first-class LicoLite Aspect。
- 数据目录采用 latest schema only；不会执行历史数据迁移。
- Operation Intent / Operation Outcome 是 append-only 生命周期事实。
- Workspace Projection 默认服务 LicoLite，并与 Ledger commit 同步更新。
- Proof Envelope 与 Proof Bundle 是主要 receipt/export 形状。

## 安装

```bash
npm install pactium
```

## Root API

```js
import { createPactium } from "pactium";

const pactium = createPactium({ dataDir: "./.pactium" });

const envelope = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "workspace-a",
  idempotencyKey: "intent-a",
  outcomeIdempotencyKey: "outcome-a",
  input: { path: "docs/a.md" },
  stateMutations: [
    { key: "docs/a.md", value: { text: "hello" } }
  ]
});

console.log(envelope.envelopeId);
console.log(await pactium.verifyEnvelope(envelope));
```

## LicoLite Aspect

```js
import { createLicoLiteAspect, createLicoLiteSigner } from "pactium/licolite";

const signingSecret = process.env.LICOLITE_SIGNING_SECRET;
if (!signingSecret) throw new Error("LICOLITE_SIGNING_SECRET is required.");

const licolite = createLicoLiteAspect({
  evidencePolicy: "production",
  signer: createLicoLiteSigner({
    signerId: "host-managed-signer",
    secret: signingSecret
  })
});

const envelope = await licolite.recordWorkspaceOperation({
  operationId: "workspace.effect",
  workspaceId: "workspace-a",
  policyEvidence: { decision: "allow" },
  workspaceEffectEvidence: { durableRef: "host:asset:a" }
});

console.log(await licolite.verifyEnvelope(envelope));
```

## 验证

```bash
npm run verify:release
```

完整压力 profile 可通过以下命令显式开启：

```bash
PACTIUM_FULL_PRESSURE=1 npm run verify:protocol:gates
```

## 文档

- [Terms](./docs/TERM.md)
- [Protocol Profile](./docs/protocols/PROFILE.md)
- [Protocol Overview](./docs/protocols/PROTOCOLS.md)
- [Architecture](./docs/architecture/ARCHITECTURE.md)
- [LicoLite Aspect](./docs/LICOLITE-ASPECT.md)

## 许可证

本项目基于 [GNU General Public License v3.0 or later](LICENSE) 发布。
