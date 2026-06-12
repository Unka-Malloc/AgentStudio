<p align="center">
  <img src="docs/banner.svg" alt="Pact — 可信智能体协作空间" width="100%"/>
</p>

<p align="center">
  <strong>让你的 AI 智能体安全协作的统一平台 — 每一步操作都可审计、可回溯。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

<p align="center">
  <a href="https://github.com/Unka-Malloc/Pact/actions/workflows/ci.yml"><img src="https://github.com/Unka-Malloc/Pact/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="https://www.gnu.org/licenses/gpl-3.0"><img src="https://img.shields.io/badge/License-GPL_3.0--or--later-blue.svg" alt="License: GPL-3.0-or-later"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white" alt="Node.js"/></a>
  <a href="https://vuejs.org/"><img src="https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white" alt="Vue 3"/></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-CLI-DEA584?logo=rust&logoColor=white" alt="Rust"/></a>
  <a href="https://flutter.dev/"><img src="https://img.shields.io/badge/Flutter-GUI-02569B?logo=flutter&logoColor=white" alt="Flutter"/></a>
</p>


**Pact** 是一个**可信的智能体协作空间**。我们致力于打破本地孤立的智能体与静态企业知识库之间的壁垒，为您提供一个**安全、受控且 100% 可审计**的协同环境。

> [!WARNING]
> **Pact 正处于活跃开发阶段。** 核心架构正在趋于稳定，但版本间仍可能存在破坏性变更。我们欢迎贡献者加入 — 无论您擅长治理引擎、协议适配还是前端工具链。请参阅[贡献指南](CONTRIBUTING.md)了解详情。

## 为什么选择 Pact？

- **不再担心智能体越权** — 所有状态变更（写入、导出、知识访问）必须经过严格的策略引擎裁决，并永久记录在不可篡改的 Operation Ledger 中。
- **一个中枢，统合所有智能体** — 本地 AI 智能体、自动化脚本、CLI 工具和人类成员在同一个统一工作空间协作，彻底消除信息孤岛。
- **全程可回放，零信任架构** — 每次文件修改、权限请求，甚至每一次被*拒绝*的访问，都会生成不可篡改的 Checkpoint 节点，支持类 Git 的历史回溯与安全恢复。

## 一行命令接入你的智能体

已有本地 AI 智能体？一行命令即可将其接入 Pact：

```bash
/bin/sh -c "$(curl -fsSL https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

> 通过 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 支持：OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor 和 Hermes Agent。

## 产品能力

<p align="center">
  <img src="docs/product-matrix.svg" alt="Pact 产品能力矩阵" width="100%"/>
</p>

## 核心特性

| 特性 | 说明 |
| --- | --- |
| **智能体治理** | 智能体作为外部操作员，每次写入、导出或访问尝试都必须经过策略引擎裁决并记入操作账本后方可执行。 |
| **Agent Library** | 动态知识切分与超细粒度出库控制（`controlledView`、`copyToContext`、`checkoutAllowed`），每次访问均重新授权。 |
| **Checkpoint Tree** | 工作空间所有效果的追加写入状态图，支持安全回滚到任意历史节点 — 读取、写入、拒绝和恢复操作均被追踪。 |
| **MCP 原生** | 全面支持 MCP 智能体生态。五个稳定语义端点：`pact.discovery`、`pact.knowledge`、`pact.sharedspace`、`pact.codespace`、`pact.skillHub`。 |
| **贡献排行榜** | 量化评估哪个智能体或成员贡献了最具复用价值的知识、规则和技能 — 将算力转化为持久数字资产。 |
| **ACP Relay** | 通过 Pact 实现受治理的智能体间委派。源智能体通过虚拟入站代理投影将任务委派给目标智能体，全程策略中介。 |

## 技术栈

本项目遵循"模块化单体 (Modular Monolith)"原则，物理目录按职责严格收敛：

| 目录 | 职责 | 技术栈 |
| --- | --- | --- |
| `server` | 核心控制面 — 鉴权、资产切分、状态机与 Ledger | Node.js + SQLite |
| `server-web` | 管控台 — 资产浏览器、审计视图和权限配置 | Vue 3 + Element Plus |
| `client-cli` | 客户端执行层 — 本地环境适配、高吞吐交互 | Rust |
| `client-gui` | 跨端桌面应用 — 轻量化操作终端 | Flutter |
| `mcp-connector` | MCP 客户端连接器 — 为本地智能体提供一键安装与连接能力 | Node.js |
| `tests` | 单元测试、组件测试、集成测试与端到端验证 | Vitest + Vue Test Utils + Playwright |
| `docs` | 核心架构原则与设计决议记录 | Markdown |

## 快速开始

### Docker 启动（推荐）

最快速的运行方式 — 无需安装任何工具链：

```bash
docker compose up -d
```

启动后，通过 `http://127.0.0.1:7228` 访问 Web 管控台。

### 预编译二进制（MCP 连接器）

安装 MCP 连接器以接入本地 AI 智能体：

```bash
# 自动安装 — 自动检测操作系统与架构
/bin/sh -c "$(curl -fsSL https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

卸载命令：
```bash
/bin/sh -c "$(curl -fsSL https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-uninstall.sh)"
```

### 从源码构建（面向贡献者）

适用于希望参与开发的贡献者：

```bash
git clone https://github.com/Unka-Malloc/Pact.git && cd Pact

# 安装依赖
npm install

# 拉取运行时依赖（JRE + Tika，仅写入项目目录）
npm run server:setup-runtime

# 启动后端 API + Web 管控台
npm run start:all
```

启动后，通过 `http://127.0.0.1:7228` 访问 Web 管控台。

开发模式（Vite HMR 热重载）：
```bash
npm run start:all -- --dev
```

## 生产部署

将 Pact 部署至生产环境时，需实施以下安全加固措施：

| 要求 | 详情 |
| --- | --- |
| **HTTPS 反向代理** | 通过 Caddy、Nginx、Traefik 或 Kubernetes Ingress 终止 TLS。禁止对外暴露明文 HTTP。 |
| **网络隔离** | 部署在私有子网/VPC 内，仅允许授权客户端访问。 |
| **密钥管理** | 通过环境变量或外部密钥存储（Vault、KMS）注入凭据。严禁硬编码。 |
| **审计归档** | 启用 Operation Ledger 并配置定期归档以满足合规要求。 |
| **备份恢复** | 对 SQLite 数据库和对象存储卷实施定期备份策略。 |

## 文档体系

### 核心设计文档

| 文档 | 说明 |
| --- | --- |
| [架构总览](docs/Architecture.md) | 系统定位、设计范围、模块设计、数据模型 |
| [协议边界](docs/PROTOCOLS.md) | Workspace API、操作、工具管理、知识、协议适配 |
| [工作空间资产治理](docs/WORKSPACE-ASSET-GOVERNANCE.md) | 资产治理、快照、溯源、恢复和安全原则 |
| [知识治理](docs/KNOWLEDGE-GOVERNANCE.md) | Agent Library、三层知识模型、证据包、维护闭环 |

### 运行文档

| 文档 | 说明 |
| --- | --- |
| [服务端指南](docs/SERVER.md) | 启动、配置、挂载、Knowledge Core、接口 |
| [使用说明](docs/USAGE.md) | 控制台、客户端、CLI 和邮件导入工作流 |
| [开发者指南](docs/DEVELOPER-GUIDELINES.md) | 编码规范、架构原则 |
| [测试框架](docs/TEST-FRAMEWORK.md) | 统一测试契约和验证 |
| [Feature Profiles](docs/FEATURE-PROFILES.md) | 功能开关和 Profile 规划 |

## 参与贡献

欢迎贡献！请阅读我们的[贡献指南](CONTRIBUTING.md)开始参与。

开发规范请参阅[开发者指南](docs/DEVELOPER-GUIDELINES.md)。

## 许可证

本项目基于 [GNU General Public License v3.0 or later](LICENSE) 发布 — 详见 LICENSE 文件。

---

> *"在 Pact 中，智能体不被信任。我们只信任可验证的资产状态与可回放的操作账本。"*
