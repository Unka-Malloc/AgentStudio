# Pact Docs

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Documentation index for the current Pact implementation.
- Staleness check: Checked against the consolidated docs layout, package scripts, module manifests, and documentation governance verifier on 2026-06-16.

## 权威文档

| 类型 | 路径 |
| --- | --- |
| 文档分布清单 | [Manifest.md](Manifest.md) |
| 术语表 | [TERM.md](TERM.md) |
| 架构 | [ARCHITECTURE.md](architecture/ARCHITECTURE.md) |
| 功能模块 | [functionality/](functionality/) |
| 脚本与 CLI 用法 | [USAGES.md](USAGES.md) |
| 前端设计与配色 | [DESIGN.md](DESIGN.md) |
| 兼容目标 | [COMPATIBILITY.md](COMPATIBILITY.md) |
| 智能体开发引导 | [AGENT.md](AGENT.md) |
| 开发规范、测试、发布门禁 | [DEVELOPMENT-RUNBOOK.md](runbook/DEVELOPMENT-RUNBOOK.md) |
| 版本 | [VERSION.md](VERSION.md) |
| 状态机 | [STATE-MACHINES.md](state-machine/STATE-MACHINES.md) |
| 协议 | [PROTOCOLS.md](protocols/PROTOCOLS.md) |
| 实现差距 | [IMPLEMENTATION-GAP.md](IMPLEMENTATION-GAP.md) |
| 长期决策 | [adr/](adr/) |

## 功能模块

`docs/functionality/` 固定为 10 个模块文档：

- `docs/functionality/SERVER-RUNTIME.md`
- `docs/functionality/INGESTION-JOBS.md`
- `docs/functionality/KNOWLEDGE.md`
- `docs/functionality/WORKSPACE-ASSETS.md`
- `docs/functionality/AGENT-COLLABORATION.md`
- `docs/functionality/TOOL-MANAGEMENT.md`
- `docs/functionality/EXTERNAL-SERVICES.md`
- `docs/functionality/SECURITY-AUTHORIZATION.md`
- `docs/functionality/CLIENT-DESKTOP.md`
- `docs/functionality/OPERATIONS-OBSERVABILITY.md`

功能模块不能新增临时横向文档。若模块边界确需调整，先更新 `docs/architecture/ARCHITECTURE.md` 中的模块清单，再同步增删对应模块文档。

## 维护规则

- `README.md` 产品页由人工维护，本文不替代根目录产品页。
- 当前文档只保留与当前代码实现一致的事实。
- 专业名词必须先登记到 `docs/TERM.md`；未登记术语不进入当前文档。
- 历史过程文档、阶段计划、审计旧报告、Checklist 和 Summary 不保留在 `docs/`。
- 新长期决策写入 `docs/adr/`；如果只是开发规范、测试或发布门禁，写入 `docs/runbook/DEVELOPMENT-RUNBOOK.md`。
- 文档更新后运行 `npm run server:verify:docs-governance`。
