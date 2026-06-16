# Pact Docs Manifest

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Distribution map for Pact documentation and adjacent documentation entry points.
- Staleness check: Checked against the current `docs/` tree, `package.json` files list, `docs/README.md`, and documentation governance verifier on 2026-06-16.

## 分布原则

`docs/README.md` 是文档索引，本文是文档分布清单。根目录 `README.md` 与 `README.zh-CN.md` 是产品页，不作为工程事实源。当前 `docs/` 只保留长期维护文档、ADR、少量示例 schema/template 和视觉资产；历史过程文档、阶段计划和临时报告不放在 `docs/`。

## 当前文档分布

| 区域 | 路径 | 内容 |
| --- | --- | --- |
| 文档索引 | `docs/README.md` | 当前文档入口、权威文档列表、功能模块清单和维护规则。 |
| 文档分布清单 | `docs/Manifest.md` | 本文件，说明项目文档的目录分布和归属边界。 |
| 术语表 | `docs/TERM.md` | 当前文档允许使用的专业名词和受控标识符清单。 |
| 智能体引导 | `docs/AGENT.md` | 智能体读取顺序、文档治理、代码事实源和验证要求。 |
| 架构 | `docs/architecture/ARCHITECTURE.md` | Pact 服务端、客户端、兼容层和核心架构原则。 |
| 功能模块 | `docs/functionality/*.md` | 10 个长期维护功能模块文档。 |
| 协议 | `docs/protocols/PROTOCOLS.md` | 服务端协议面、客户端命令协议、兼容层和协议版本规则。 |
| 状态机 | `docs/state-machine/STATE-MACHINES.md` | 状态机清单、实现入口和验证入口。 |
| 开发运行手册 | `docs/runbook/DEVELOPMENT-RUNBOOK.md` | 开发规范、测试验证、发布门禁和文档治理规则。 |
| 命令用法 | `docs/USAGES.md` | 服务端、客户端、CLI、打包、安装和验证命令。 |
| 兼容目标 | `docs/COMPATIBILITY.md` | 服务端平台、客户端平台、智能体框架和外部服务兼容口径。 |
| 前端设计 | `docs/DESIGN.md` | Console、客户端 UI、组件、配色和交互约束。 |
| 版本治理 | `docs/VERSION.md` | 当前版本、artifact、兼容性和证据维护规则。 |
| 实现差距 | `docs/IMPLEMENTATION-GAP.md` | 当前实现与目标能力之间仍需跟踪的差距。 |
| 长期决策 | `docs/adr/*.md` | ADR，记录长期架构和治理决策。 |
| 示例资产 | `docs/examples/*.json` | 文档评估语料 manifest schema、template 和 public smoke 示例。 |
| 视觉资产 | `docs/banner.svg`, `docs/logo.svg`, `docs/product-matrix*.svg` | 文档和产品页可引用的静态视觉资产。 |

## 功能模块文档

`docs/functionality/` 固定为 10 个模块文档：

| 模块 | 路径 |
| --- | --- |
| 服务端运行时与控制台 | `docs/functionality/SERVER-RUNTIME.md` |
| 上传、解析与任务 | `docs/functionality/INGESTION-JOBS.md` |
| 知识治理 | `docs/functionality/KNOWLEDGE.md` |
| 工作空间资产治理 | `docs/functionality/WORKSPACE-ASSETS.md` |
| 智能体协作 | `docs/functionality/AGENT-COLLABORATION.md` |
| 工具管理与能力包 | `docs/functionality/TOOL-MANAGEMENT.md` |
| 外部服务与代码仓库 | `docs/functionality/EXTERNAL-SERVICES.md` |
| 安全、授权与身份 | `docs/functionality/SECURITY-AUTHORIZATION.md` |
| 桌面客户端 | `docs/functionality/CLIENT-DESKTOP.md` |
| 运维、存储与可观测性 | `docs/functionality/OPERATIONS-OBSERVABILITY.md` |

## 相邻文档入口

| 区域 | 路径 | 用途 |
| --- | --- | --- |
| 产品页 | `README.md`, `README.zh-CN.md` | 对外产品介绍，由人工维护。 |
| 根智能体入口 | `AGENT.md` | 仓库级智能体工作规则。 |
| 子系统智能体入口 | `server/AGENT.md`, `server-web/AGENT.md`, `client-cli/AGENT.md`, `client-gui/AGENT.md`, `server/platform/common/mcp/gateway-installer/AGENT.md` | 子系统级工作规则。 |
| 协议实现说明 | `server/protocols/**/README.md` | 由对应代码层维护的局部协议说明。 |
| 平台局部说明 | `server/platform/**/README.md`, `server/config/entity-config/**/README.md` | 局部运行时、配置和模块说明。 |
| 测试说明 | `tests/README.md` | 测试目录入口和约定。 |

## 发布清单

`package.json` 当前发布文档范围包含：

- `docs/README.md`
- `docs/Manifest.md`
- `docs/TERM.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/functionality/*.md`
- `docs/protocols/PROTOCOLS.md`
- `docs/state-machine/STATE-MACHINES.md`
- `docs/runbook/DEVELOPMENT-RUNBOOK.md`
- `docs/AGENT.md`
- `docs/COMPATIBILITY.md`
- `docs/DESIGN.md`
- `docs/IMPLEMENTATION-GAP.md`
- `docs/USAGES.md`
- `docs/VERSION.md`
- `docs/adr/*.md`
- `docs/examples/*.json`
- `docs/banner.svg`
- `docs/logo.svg`
- `docs/product-matrix.svg`
- `docs/product-matrix.original.svg`

## 验证

文档分布变化后运行：

```bash
npm run server:verify:docs-governance
git diff --check
```
