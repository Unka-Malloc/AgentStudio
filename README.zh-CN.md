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

## 💡 为什么选择 Pact？

- **不再担心智能体越权** — 所有状态变更（写入、导出、知识访问）必须经过严格的策略引擎裁决，并永久记录在不可篡改的 Operation Ledger 中。
- **一个中枢，统合所有智能体** — 本地 AI 智能体、自动化脚本、CLI 工具和人类成员在同一个统一工作空间协作，彻底消除信息孤岛。
- **全程可回放，零信任架构** — 每次文件修改、权限请求，甚至每一次被*拒绝*的访问，都会生成不可篡改的 Checkpoint 节点，支持类 Git 的历史回溯与安全恢复。

## ⚡ 一行命令接入你的智能体

已有本地 AI 智能体？一行命令即可将其接入 Pact：

```bash
npm run mcp:register
```

连接器发布到 npm 或 GitHub Releases 后，可使用 [mcp-connector/README.md](mcp-connector/README.md) 中记录的发布通道命令。

> 通过 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 支持：OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf。

## 🏛️ 架构概览

```mermaid
graph TB
    subgraph Clients["🖥️ 客户端层"]
        CLI["CLI<br/>(Rust)"]
        GUI["GUI<br/>(Flutter)"]
        Console["Web 管控台<br/>(Vue 3 + Element Plus)"]
        MCPClient["MCP Connector<br/>(Client)"]
        Agents["本地智能体<br/>OpenClaw · Claude Code · Codex · Gemini CLI · Antigravity<br/>OpenCode · Copilot · Kilo Code · Cursor · Hermes Agent · Windsurf"]
    end

    subgraph Server["⚙️ 服务端 (Node.js + SQLite)"]
        MCP["MCP Service<br/>(HTTP + stdio)"]
        API["Workspace API"]
        Policy["Policy Engine"]
        Ledger["Operation Ledger"]
    end

    subgraph Governance["🛡️ 治理层"]
        CPT["Checkpoint Tree"]
        AL["AgentLibrary"]
        CR["Contribution Registry"]
        LB["Leaderboard"]
    end

    subgraph Storage["💾 存储层"]
        SQLite["SQLite"]
        Objects["对象存储"]
        ExtKB["外部知识库<br/>pgvector · Qdrant · OpenSearch"]
    end

    CLI --> API
    GUI --> API
    Console --> API
    Agents --> MCPClient
    MCPClient --> MCP
    MCP --> API
    API --> Policy
    Policy --> Ledger
    Ledger --> CPT
    API --> AL
    API --> CR
    CR --> LB
    Ledger --> SQLite
    CPT --> SQLite
    AL --> Objects
    AL --> ExtKB
```

## ✨ 核心特性

- 🛡️ **智能体治理**：智能体只是外部操作员。系统的每一次状态变更（写入、导出），必须经过 Policy Engine 和 Operation Ledger 裁决。
- 📚 **AgentLibrary（受控知识库）**：管理知识源与智能体之间的鸿沟。上游知识进入系统后会被重新切分与实时再授权。支持 `controlledView`、`copyToContext`、`checkoutAllowed` 等极细粒度的出库限制。
- 🌳 **统一 Checkpoint Tree（可审计）**：每一次文件修改、权限请求，甚至是知识检索和被拒绝的访问，都会生成 Checkpoint 节点，支持类 Git 的 Append-only 安全恢复。
- 🔌 **全生态协议兼容（MCP Native）**：首批一等支持目标为 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf，全面拥抱 Model Context Protocol (MCP) 标准暴露工作空间能力。
- 📊 **资产贡献量化排行榜**：智能体不仅消耗算力，更在此沉淀数字资产。系统内置贡献排行榜，量化评估哪个智能体或成员贡献了最具复用价值的知识、规则和技能。

## 🏗️ 架构与技术栈

本项目遵循"模块化单体 (Modular Monolith)"原则，物理目录按职责严格收敛：

| 目录 | 职责 | 技术栈 |
| --- | --- | --- |
| **`server`** | 核心控制面 — 鉴权、资产切分、状态机与 Ledger | Node.js + SQLite |
| **`server-web`** | 管控台 — 资产浏览器、审计视图和权限配置 | Vue 3 + Element Plus |
| **`client-cli`** | 客户端执行层 — 本地环境适配、高吞吐交互 | Rust |
| **`client-gui`** | 跨端桌面应用 — 轻量化操作终端 | Flutter |
| **`mcp-connector`** | MCP 客户端连接器 — 为本地智能体提供一键安装与连接能力 | Node.js |
| **测试体系** | 单元测试、组件测试、集成测试与 E2E 验证标准 | Vitest + `@vitest/coverage-v8` + Vue Test Utils + Playwright |
| **`docs`** | 核心架构原则与设计决议记录 | Markdown |

## 🚀 部署与快速开始

Pact 提供了多种启动模式以适配不同的环境与场景。请仔细阅读并区分本机开发、Docker 本机启动、开发联调、局域网/公网监听以及企业生产部署的边界与要求。

### 1. 本机开发 (Local Development)
适用于本机源码级开发与调试。首先确保本地具备 Node.js 环境（最低支持 Node.js 22+，推荐使用 Node.js 24）。
```bash
# 安装服务端依赖
npm install

# 本地拉取项目内 JRE 和 Tika (仅在项目内写入，不修改系统环境)
npm run server:setup-runtime

# 一键启动完整的服务端 API 与 Web 管控台
npm run start:all
```
启动后，通过 `http://127.0.0.1:7228` 访问 Web 管控台。

### 2. Docker 本机启动 (Local Docker Startup)
适用于无需本地开发工具链，快速拉起容器进行体验与测试的场景：
```bash
docker compose up -d
```
启动后，通过 `http://127.0.0.1:7228` 访问 Web 管控台。

### 3. 开发联调 (Dev Integration & HMR)
如果需要对前端控制台进行二次开发，并启用 Vite 热重载（HMR）以及与后端 API 进行联调：
```bash
npm run start:all -- --dev
```
此命令将启动监听在 `7228` 端口的后端 API，并启动监听在 `5173` 端口的 Vite 前端开发服务器（自动代理 `/api` 流量到后端）。

### 4. 局域网/公网监听 (LAN/WAN Listening)
用于临时将本地 Pact 服务暴露给局域网内的其他成员或智能体进行联调测试：
```bash
npm run server:start:public
```
*注意：这会使服务监听在 `0.0.0.0` 地址的 `7228` 端口上。在未配置传输层安全（TLS）的非受信网络中，请勿直接使用此命令。*

### 5. 企业生产部署 (Enterprise Production Deployment)
Pact 支持企业级的协作与资产治理。但是，**生产门禁未关闭前不建议对外宣称生产可用 (Before the production gates are closed, it is not recommended to claim production readiness)**。

企业上线部署时，**严禁直接复用本机的 HTTP 配置**，必须强制实施以下生产加固策略：
*   **HTTPS 反向代理**：前端及 API 出口前必须配置反向代理（如 Caddy、Nginx 或 Ingress），以终止并启用 HTTPS，确保全链路传输加密。
*   **受控网段**：严格限制服务暴露范围，将其部署在受控的私有网络网段内，禁止在公网直接暴露后端端口。
*   **密钥管理**：真实的 API Key、凭证与 Token 必须通过系统运行态密钥库（Secret Store）或外部 KMS/Vault 工具注入，严禁硬编码。
*   **审计归档**：开启不可篡改的操作账本 (Operation Ledger) 并配置审计日志的定期归档与归一化备份。
*   **备份恢复**：配置针对数据目录内 SQLite 数据库、对象存储以及 Checkpoint Tree 的定期热备份与冷备归档，确保灾备恢复能力。

### MCP 客户端连接器

一行命令将任意兼容的本地 AI 智能体接入 Pact：

```bash
npm run mcp:register
```

*(源码 checkout、npm 和 GitHub Release 安装选项请参考 [mcp-connector/README.md](mcp-connector/README.md)。)*

### CLI 快速交互

Pact 提供了强大的 CLI 工具以支持 CI/CD 与终端快捷操作：

```bash
npm run cli -- health
npm run cli -- --file README.md --wait
npm run cli -- rpc-call jobs.list --params '{"limit":20}'
```

## 📖 文档体系

### 核心设计文档

以下五份文档是 Pact 架构的权威真相源：

| 文档 | 说明 |
| --- | --- |
| 🏛️ [架构总览](docs/Architecture.md) | 总定位、设计范围、需求、模块设计、数据模型 |
| 📡 [协议边界](docs/PROTOCOLS.md) | Workspace API、Operation、工具管理、知识、协议适配 |
| 🔒 [工作空间资产治理](docs/WORKSPACE-ASSET-GOVERNANCE.md) | 资产治理、快照、溯源、恢复和安全原则 |
| 🧠 [知识治理与 AgentLibrary](docs/KNOWLEDGE-GOVERNANCE.md) | AgentLibrary、三层知识模型、证据包、维护闭环 |
| 🚧 [生产能力差距](docs/PRODUCTION-CAPABILITY-GAP.md) | P0 差距、验收门禁和当前阻塞项 |

### 运行支持文档

| 文档 | 说明 |
| --- | --- |
| 🖥️ [服务端指南](docs/SERVER.md) | 启动、配置、挂载、KnowledgeCore、接口 |
| 📘 [使用说明](docs/USAGE.md) | 控制台、客户端、CLI 和邮件导入工作流 |
| 👨‍💻 [开发者核心守则](docs/DEVELOPER-GUIDELINES.md) | 编码规范、架构原则 |
| 🧪 [测试框架](docs/TEST-FRAMEWORK.md) | 统一测试契约和验证 |
| ⚙️ [Feature Profiles](docs/FEATURE-PROFILES.md) | 功能开关和 Profile 规划 |
| 🤝 [Git 协作约定](docs/GIT-COLLAB.md) | 本地协作约定 |
| 📋 [设计决策登记表](docs/IMPLEMENTATION-DECISION-REGISTER.md) | 实现前设计决策记录 |

## 🤝 参与贡献

欢迎贡献！请阅读我们的[贡献指南](CONTRIBUTING.md)开始参与。

开发规范请参阅[开发者核心守则](docs/DEVELOPER-GUIDELINES.md)。

## 📄 许可证

本项目基于 [GNU General Public License v3.0 or later](LICENSE) 发布 — 详见 LICENSE 文件。

---

> *"在 Pact 中，智能体不被信任。我们只信任可验证的资产状态与可回放的操作账本。"*
