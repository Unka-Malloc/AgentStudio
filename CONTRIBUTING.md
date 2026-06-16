# Contributing to Pact 🤝

# 参与贡献 Pact

English | [简体中文](README.zh-CN.md)

Thank you for your interest in contributing to **Pact** — a controllable agent collaboration platform (可控的智能体协作空间). We welcome contributions from the community and are grateful for every pull request, bug report, and idea.

> *"In Pact, agents are not trusted. We only trust verifiable asset states and a replayable operation ledger."*

---

## Table of Contents / 目录

- [Code of Conduct / 行为准则](#code-of-conduct--行为准则)
- [Reporting Bugs & Requesting Features / 报告 Bug 与功能请求](#reporting-bugs--requesting-features--报告-bug-与功能请求)
- [Development Environment Setup / 开发环境搭建](#development-environment-setup--开发环境搭建)
- [Code Style / 代码风格](#code-style--代码风格)
- [Git Workflow / Git 工作流](#git-workflow--git-工作流)
- [Pull Request Process / 拉取请求流程](#pull-request-process--拉取请求流程)
- [Core Design Documents / 核心设计文档](#core-design-documents--核心设计文档)
- [Commit Message Format / 提交信息格式](#commit-message-format--提交信息格式)
- [License / 许可证](#license--许可证)

---

## Code of Conduct / 行为准则

We are committed to providing a welcoming and inclusive environment for everyone. All contributors are expected to:

- Be respectful, constructive, and professional in all interactions
- Welcome diverse perspectives and experiences
- Accept constructive criticism gracefully
- Focus on what is best for the project and its community
- Refrain from personal attacks, trolling, or harassment of any kind

Violations may result in temporary or permanent exclusion from the project at the maintainers' discretion.

我们致力于为所有人提供友好和包容的环境。所有贡献者都应尊重他人、保持专业，并以项目利益为重。

---

## Reporting Bugs & Requesting Features / 报告 Bug 与功能请求

We use **GitHub Issues** to track bugs, feature requests, and discussions.

### Bug Reports / 报告 Bug

When filing a bug, please include:

1. **Environment** — OS, Node.js version, browser (if applicable), Rust/Flutter versions
2. **Steps to reproduce** — A clear, minimal set of steps
3. **Expected behavior** — What you expected to happen
4. **Actual behavior** — What actually happened
5. **Logs / Screenshots** — Server logs, console output, or screenshots if relevant

👉 [**Open a Bug Report**](https://github.com/Unka-Malloc/Pact/issues/new?labels=bug)

### Feature Requests / 功能请求

For feature requests, describe:

1. **The problem** you're trying to solve
2. **Your proposed solution** (if any)
3. **Alternatives** you've considered
4. **Context** — Which component(s) would be affected (`server`, `server-web`, `client-cli`, `client-gui`, `modules`)

👉 [**Open a Feature Request**](https://github.com/Unka-Malloc/Pact/issues/new?labels=enhancement)

> **Note**: For security vulnerabilities, please **do not** open a public issue. See [SECURITY.md](SECURITY.md) instead.

---

## Development Environment Setup / 开发环境搭建

### Prerequisites / 前提条件

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- **Rust** toolchain (for `client-cli`)
- **Flutter** SDK (for `client-gui`)

### Getting Started / 快速开始

```bash
# 1. Clone the repository
git clone https://github.com/Unka-Malloc/Pact.git
cd Pact

# 2. Install server dependencies
npm install

# 3. Install client dependencies (Flutter/Rust assets)
npm run client:get

# 4. Start all services (API server + Web console)
npm run start:all
```

For development with Vite HMR (Hot Module Replacement):

```bash
npm run start:all -- --dev
```

Once running, access the management console in your browser and connect local agents to the MCP Service endpoint.

---

## Code Style / 代码风格

All code should conform to the standards documented in:

📖 **[Development Runbook](docs/runbook/DEVELOPMENT-RUNBOOK.md)**

Key principles:

- Follow the existing patterns in each component (`server`, `server-web`, `client-cli`, `client-gui`)
- Write self-documenting code with clear naming conventions
- Include JSDoc / Rustdoc comments for public APIs
- Keep functions focused and composable

---

## Git Workflow / Git 工作流

We follow a structured branching model. Please read the full workflow guide:

📖 **[Development Runbook](docs/runbook/DEVELOPMENT-RUNBOOK.md)**

In summary:

1. **Fork** the repository and create a feature branch from `main`
2. **Name branches** descriptively (e.g., `feat/checkpoint-export`, `fix/ledger-race-condition`)
3. **Rebase** your branch onto the latest `main` before submitting a PR
4. **Squash** trivial commits to keep history clean

---

## Pull Request Process / 拉取请求流程

### Before Submitting / 提交前

- [ ] Ensure your code builds successfully (`npm run start:all`)
- [ ] Run existing tests and ensure they pass
- [ ] Update documentation if your change affects public APIs or user-facing behavior
- [ ] Add/update tests for new functionality
- [ ] Self-review your diff for unintended changes

### PR Expectations / PR 审查要求

1. **Title**: Use [Conventional Commits](#commit-message-format--提交信息格式) format
2. **Description**: Clearly explain *what* changed, *why*, and *how*
3. **Scope**: Keep PRs focused — one logical change per PR
4. **Review turnaround**: Maintainers aim to provide initial review within **5 business days**
5. **Iteration**: Be responsive to review feedback; stale PRs (>30 days inactive) may be closed

### Review Criteria / 审查标准

- Adherence to code style and architectural principles
- Test coverage for new behavior
- No regressions to existing functionality
- Consistency with the zero-trust governance model
- Alignment with the project's [core design documents](#core-design-documents--核心设计文档)

---

## Core Design Documents / 核心设计文档

Pact maintains canonical documentation by topic. These are the current sources of truth:

| # | Document | Purpose |
|---|----------|---------|
| 1 | [Architecture](docs/architecture/ARCHITECTURE.md) | System-level design and component relationships |
| 2 | [Functionality](docs/functionality/) | One maintained document per functional module |
| 3 | [Protocols](docs/protocols/PROTOCOLS.md) | MCP integration and inter-component communication |
| 4 | [Usage](docs/USAGES.md) | Server and client commands |
| 5 | [Development Runbook](docs/runbook/DEVELOPMENT-RUNBOOK.md) | Coding standards, validation, and release gates |

> ⚠️ **Important Rule / 重要规则**:
>
> **Documentation governance:** add durable facts to the matching canonical document above. If a new module document is needed, update the module inventory and governance checks together.

---

## Commit Message Format / 提交信息格式

We follow the **[Conventional Commits](https://www.conventionalcommits.org/)** specification.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Code style changes (formatting, semicolons, etc.) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `build` | Build system or external dependency changes |
| `ci` | CI/CD configuration changes |
| `chore` | Other changes that don't modify src or test files |

### Scopes

Use component names as scopes: `server`, `web`, `cli`, `gui`, `modules`, `docs`, `build`

### Examples

```
feat(server): add checkpoint export endpoint for Operation Ledger

fix(web): resolve asset browser pagination overflow

docs(server): update MCP Service configuration reference

refactor(modules): extract knowledge slicing into standalone pipeline
```

---

## License / 许可证

By contributing to Pact, you agree that your contributions will be licensed under the **[GPL-3.0-or-later](LICENSE)** license.

This means all contributed code must be compatible with GPL-3.0-or-later. If your contribution includes third-party code, please ensure its license is GPL-3.0 compatible and clearly attribute it.

参与贡献即表示您同意您的贡献将按照 **GPL-3.0-or-later** 许可证进行授权。

---

Thank you for helping make Pact better! 🚀

感谢您的贡献！
