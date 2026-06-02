# Pact Docs

> Documentation index for Pact — a controllable agent collaboration space.
>
> Pact 文档索引 — 可控的智能体协作空间。

本文档目录分为核心设计文档和运行支持文档。新的长期架构决策只能进入核心设计文档，避免重新扩散成多份互相漂移的设计说明。

This directory is organized into **Core Design Documents** and **Operational Documents**. New long-term architectural decisions must be merged into one of the core documents to prevent fragmentation.

---

## 核心设计文档 / Core Design Documents

当前核心设计文档固定为五份 / Fixed to five authoritative documents:

| Document | 文档 | Description | Size |
| --- | --- | --- | --- |
| [Architecture.md](Architecture.md) | 架构总览 | System positioning, design scope, requirements, module design, data models, deployment | 54 KB |
| [PROTOCOLS.md](PROTOCOLS.md) | 协议边界 | Workspace API, Operation, Tool Management, Knowledge, and protocol adapter boundaries | 29 KB |
| [WORKSPACE-ASSET-GOVERNANCE.md](WORKSPACE-ASSET-GOVERNANCE.md) | 工作空间资产治理 | Public workspace asset governance, snapshots, traceability, restore, copy, and security principles | 37 KB |
| [KNOWLEDGE-GOVERNANCE.md](KNOWLEDGE-GOVERNANCE.md) | 知识治理 | Knowledge evidence, 3-layer knowledge model, agent-citable context, and knowledge maintenance loop | 19 KB |
| [PRODUCTION-CAPABILITY-GAP.md](PRODUCTION-CAPABILITY-GAP.md) | 生产能力差距 | Production capability gaps, acceptance gates, and current blockers | 38 KB |

### Document Dependencies / 文档依赖

```mermaid
graph LR
    A["Architecture.md<br/>总架构基线"] --> P["PROTOCOLS.md<br/>协议边界"]
    A --> W["WORKSPACE-ASSET-<br/>GOVERNANCE.md<br/>资产治理"]
    A --> K["KNOWLEDGE-<br/>GOVERNANCE.md<br/>知识治理"]
    A --> G["PRODUCTION-<br/>CAPABILITY-GAP.md<br/>能力差距"]
    P --> W
    P --> K
    W --> G
    K --> G
```

---

## 运行支持文档 / Operational Documents

| Document | 文档 | Description | Size |
| --- | --- | --- | --- |
| [SERVER.md](SERVER.md) | 服务端指南 | Server startup, runtime, protocols, packaging, and operations | 57 KB |
| [USAGE.md](USAGE.md) | 使用说明 | Console, client, and CLI usage guide | 7 KB |
| [FEATURE-PROFILES.md](FEATURE-PROFILES.md) | Feature Profile | Feature profile planning, trimming, and build commands | 2 KB |
| [IMPLEMENTATION-DECISION-REGISTER.md](IMPLEMENTATION-DECISION-REGISTER.md) | 设计决策登记表 | Pre-implementation design decisions; finalized conclusions must be merged back into core docs | 33 KB |
| [CLIENT_ARCHITECTURE.md](CLIENT_ARCHITECTURE.md) | 客户端架构 | Destructive desktop-client architecture target and six-module product boundary | 13 KB |
| [V0.0.1-IMPLEMENTATION-PLAN.md](V0.0.1-IMPLEMENTATION-PLAN.md) | v0.0.1 实施计划 | Single-node v0.0.1 delivery phases, checkpoints, interfaces, compatibility targets, and acceptance gates | 28 KB |
| [CLIENT-IMPLEMENTATION-PLAN.md](CLIENT-IMPLEMENTATION-PLAN.md) | 客户端实施路线 | Lightweight Pact Client refactor phases, checkpoints, interfaces, compatibility targets, and acceptance gates | 28 KB |
| [CLIENT-DESIGN-CONFORMANCE.md](CLIENT-DESIGN-CONFORMANCE.md) | 客户端设计符合性矩阵 | Destructive keep/replace/delete/legacy-dev-only decisions for old client modules | 9 KB |
| [CLIENT-HISTORY.md](CLIENT-HISTORY.md) | 客户端历史说明 | Previous desktop-client direction, why it changed, and how old capabilities map to the future client | 5 KB |
| [CHECKPOINT-ALGORITHM-EVOLUTION-PLAN.md](CHECKPOINT-ALGORITHM-EVOLUTION-PLAN.md) | Checkpoint 算法演进方案 | Step-by-step LSM/Merkle/CAS/checkpoint algorithm evolution path from single-node contracts to distributed lossless migration | 25 KB |
| [KNOWLEDGE-DISTILLATION-EVOLUTION-PLAN.md](KNOWLEDGE-DISTILLATION-EVOLUTION-PLAN.md) | 知识蒸馏演进方案 | Chaptered full-chain knowledge distillation plan covering routing, runtime, parsing, raw corpus, large files, grounding, timeline filtering, exports, and single-node deployment | 32 KB |
| [KNOWLEDGE-DISTILLATION-PROGRESS.md](KNOWLEDGE-DISTILLATION-PROGRESS.md) | 知识蒸馏进展台账 | Current completed, partially completed, and unfinished knowledge distillation work items with gates and TODOs | 20 KB |
| [KNOWLEDGE-DISTILLATION-AUDIT.md](KNOWLEDGE-DISTILLATION-AUDIT.md) | 知识蒸馏审计 | Current implementation audit, gaps, and quality risks for the distillation runtime and workbench | 7 KB |
| [KNOWLEDGE-DISTILLATION-IMPLEMENTATION-BASELINE.md](KNOWLEDGE-DISTILLATION-IMPLEMENTATION-BASELINE.md) | 知识蒸馏实现基线 | Baseline implementation notes for current distillation behavior and artifacts | 4 KB |
| [ENTITY-CONFIG-LAYOUT.md](ENTITY-CONFIG-LAYOUT.md) | 实体配置目录 | Human-maintainable entity config directory, lightweight skill packs, and validation | 2 KB |
| [TEST-FRAMEWORK.md](TEST-FRAMEWORK.md) | 测试框架 | Unified test framework contract | 6 KB |
| [DEVELOPER-GUIDELINES.md](DEVELOPER-GUIDELINES.md) | 开发者核心守则 | Coding conventions, architecture principles, and design philosophy | 5 KB |
| [GIT-COLLAB.md](GIT-COLLAB.md) | Git 协作约定 | Local collaboration conventions | 2 KB |
| [scenarios/README.md](scenarios/README.md) | 场景链路草案 | Client-to-backend scenario drafts; finalized decisions must be merged back into core docs | < 1 KB |
| [testing/memory-and-smoke-framework.md](testing/memory-and-smoke-framework.md) | 记忆与 Smoke 测试 | Memory and smoke test framework guide | < 1 KB |

---

## 边界文档 / Boundary Documents

| Document | 文档 | Description | Size |
| --- | --- | --- | --- |
| [boundary/2-3-5-Security-Model.md](boundary/2-3-5-Security-Model.md) | 2-3-5 安全治理模型 | Security governance reference for two boundaries, three environments, and five governance objects; authoritative decisions are mirrored in core docs | 27 KB |
| [boundary/N-2-N-Interfaces.md](boundary/N-2-N-Interfaces.md) | N-2-N 接口边界 | External-service and downstream-client boundaries, with in-Pact adapters/gateways and out-of-Pact services/clients split explicitly | 11 KB |
| [boundary/U-1-Data.md](boundary/U-1-Data.md) | U-1 数据边界 | Unified vocabulary for data, resources, state, evidence, receipts, ledgers, checkpoints, projections, and external refs | 12 KB |

---

## 架构图 / Architecture Diagrams

长期维护的 HTML 架构图保存在 `docs/architecture/`，作为可审阅的源文件。`build/artifacts/architecture/` 只能作为本地构建或导出产物，不作为事实源。

| Diagram | 图 | Description |
| --- | --- | --- |
| [architecture/PACT-SYSTEM-ARCHITECTURE.html](architecture/PACT-SYSTEM-ARCHITECTURE.html) | Pact 系统架构图 | Pact internal system structure, application layer, runtime assembly, and foundation boundaries |
| [architecture/PACT-SERVICE-CAPABILITY-ARCHITECTURE.html](architecture/PACT-SERVICE-CAPABILITY-ARCHITECTURE.html) | Pact 服务能力架构图 | Agent Harness / Pact Client to MCP Plugin, routing, algorithm substrate, gateway, and external services |

---

## 维护规则 / Maintenance Rules

- 不再新增横向设计文档；新设计必须合并到五份核心文档之一。
  *No new lateral design documents. New designs must be merged into one of the five core documents.*
- 旧设计说明如果仍有价值，先合并为核心文档章节，再删除旧文件。
  *Legacy design documents with remaining value must be merged as a section of a core document, then deleted.*
- 操作说明、命令说明、配置说明可以保留为运行支持文档，但不得承载新的架构决策。
  *Operational docs may contain instructions and configurations, but must not carry new architectural decisions.*
- 生成物不进入 `docs/`。需要长期维护的图必须放在 `docs/architecture/` 作为可审阅源文件；报告或导出必须转成可审阅的 Markdown 设计或运行文档。
  *Generated artifacts do not belong in `docs/`. Long-lived diagrams must live under `docs/architecture/` as reviewable source files; reports and exports must be converted to reviewable Markdown.*
