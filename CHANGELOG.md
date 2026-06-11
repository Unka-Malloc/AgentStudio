# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added Gerrit MCP support for agent-facing read, write, maintenance, and audited Git review upload operations.
- Added repository-scoped Tool Management grants for `repo:read`, `repo:write`, `repo:review`, `repo:approve`, `repo:maintain`, and `repo:admin`.

### Security

- Hardened MCP local grants with catalog-driven risk elevation, explicit repair-mode confirmation, per-grant `maxRisk`, and toolset `maxRisk` enforcement.
- Overrode vulnerable transitive `uuid` versions used through LangGraph packages to audited fixed versions.

---

## [0.0.1] — 2026-05-22

### Initial Release

The inaugural release of **Pact** — a trusted agent collaboration space.

### Added

#### Workspace Asset Governance
- Full Workspace Asset Governance framework with fine-grained policy engine
- **Operation Ledger** — an append-only, immutable audit log for every state change (writes, exports, permission requests, and denied access)
- Asset lifecycle management with controlled ingestion, modification, and export flows

#### Agent Library
- Governed knowledge system with **8-level access mode** hierarchy
- Upstream knowledge dynamic slicing and re-authorization upon ingestion
- Hyper-granular egress controls: `controlledView`, `copyToContext`, `checkoutAllowed`, and more

#### Unified Checkpoint Tree
- 100% auditability — every file modification, permission request, and knowledge retrieval generates an immutable Checkpoint Node
- Append-only, Git-like safe restore capability across workspace history

#### MCP Service
- Full Model Context Protocol (MCP) service implementation
- **HTTP transport** for network-based agent integration
- **stdio transport** for local agent communication
- Compatible with OpenClaw, Claude Code, Codex, Gemini CLI, Kilo Code, Cursor, and other MCP agents

#### Knowledge Summarization Pipeline
- Knowledge summarization pipeline powered by **LangGraph.js**
- Multi-agent orchestration for collaborative knowledge extraction
- Automated distillation of workspace knowledge into reusable summaries

#### Tool Management
- Declarative tool registration and lifecycle control
- Governed tool execution within the zero-trust security model
- Tool capability discovery and permission-scoped invocation

#### Contribution Leaderboard
- Built-in leaderboard quantifying and ranking agent/human contributions
- Tracks reusable knowledge, rules, and skills contributed to the team workspace
- Real-time scoring and ranking visualization

#### Web Console
- Full-featured management console built with **Vue 3** and **Element Plus**
- Asset browser, audit log viewer, and permission configuration UI
- Real-time dashboard with contribution metrics and system health

#### CLI & GUI Clients
- **CLI** (Rust): High-performance command-line client for CI/CD and terminal operations
- **GUI** (Flutter): Cross-platform desktop application as a lightweight terminal
- Both clients support full workspace interaction and agent management

#### Knowledge Distillation Pipeline
- End-to-end knowledge distillation pipeline for workspace assets
- Automated extraction, transformation, and loading of knowledge artifacts
- Support for structured and unstructured knowledge sources

#### Deployment
- Docker and Docker Compose support for containerized deployment
- Offline packaging for air-gapped environments
- Self-contained deployment bundle with all dependencies

#### External Knowledge Base Support
- **pgvector** integration for PostgreSQL-based vector search
- **Qdrant** integration for dedicated vector database deployments
- **OpenSearch** integration for enterprise search and analytics
- Pluggable adapter architecture for additional knowledge base backends

[unreleased]: https://github.com/Unka-Malloc/Pact/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/Unka-Malloc/Pact/releases/tag/v0.0.1
