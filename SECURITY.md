# Security Policy 🔒

# 安全策略

Thank you for helping keep **Pact** and its users safe. We take security seriously — it is foundational to our zero-trust governance model.

---

## Supported Versions / 受支持的版本

Security updates are provided for the following versions:

| Version | Supported |
|---------|-----------|
| 0.0.x   | ✅ Active support |
| < 0.0.1 | ❌ No longer supported |

> As the project matures, this table will be updated to reflect the current support policy. We recommend always running the latest stable release.

---

## Reporting a Vulnerability / 报告安全漏洞

> ⚠️ **Please do NOT report security vulnerabilities through public GitHub Issues.**

If you discover a security vulnerability in Pact, we kindly ask you to report it responsibly through one of the following channels:

### Option 1: GitHub Security Advisory (Recommended / 推荐)

Use GitHub's built-in private vulnerability reporting:

👉 [**Report a Vulnerability via GitHub Security Advisory**](https://github.com/Unka-Malloc/Pact/security/advisories/new)

This creates a private discussion between you and the maintainers, with full support for coordinated disclosure.

### Option 2: Email / 邮件

If you prefer email, contact the project maintainer directly:

📧 **Unka Y.Y.** — Reach out via the contact information on the [GitHub profile](https://github.com/Unka-Malloc)

When reporting, please include as much of the following as possible:

- **Description** of the vulnerability
- **Steps to reproduce** or proof-of-concept
- **Affected component(s)** — `server`, `server-web`, `client-cli`, `client-gui`, `modules`
- **Impact assessment** — What could an attacker achieve?
- **Suggested fix** (if any)

---

## Response Timeline / 响应时间

We aim to adhere to the following timeline upon receiving a valid vulnerability report:

| Stage | Target Timeframe |
|-------|-----------------|
| **Acknowledgment** — Confirm receipt of report | Within **48 hours** |
| **Triage** — Validate and assess severity | Within **5 business days** |
| **Remediation plan** — Communicate fix timeline | Within **10 business days** |
| **Patch release** — Deploy fix to supported versions | Varies by severity (Critical: ASAP; High: ≤14 days; Medium/Low: next release cycle) |
| **Public disclosure** — Coordinate advisory publication | After patch is available, in coordination with reporter |

We will keep you informed throughout the process and credit you in the advisory (unless you prefer to remain anonymous).

---

## Scope / 适用范围

This security policy covers the following components of the Pact project:

### In Scope / 适用范围内

- **Control Plane** (`server`) — Authentication, authorization, policy engine, Operation Ledger, state machines
- **Web Console** (`server-web`) — Vue 3 management interface, including XSS, CSRF, and session management
- **MCP Service** — HTTP and stdio transports, protocol-level vulnerabilities
- **AgentLibrary** — Access control bypass, knowledge exfiltration, privilege escalation in the 8-level access mode
- **Checkpoint Tree** — Integrity violations, tampering with immutable records
- **CLI Client** (`client-cli`) — Command injection, credential leakage
- **GUI Client** (`client-gui`) — Local privilege escalation, insecure storage
- **External KB integrations** — Injection attacks against pgvector, Qdrant, or OpenSearch adapters
- **Docker / deployment configurations** — Container escape, insecure defaults

### Out of Scope / 适用范围外

- Vulnerabilities in upstream dependencies (report these to the respective maintainers, but do let us know so we can evaluate impact)
- Social engineering attacks against maintainers or contributors
- Denial-of-service attacks against GitHub infrastructure
- Issues in forks or unofficial distributions

---

## Zero-Trust Security Model / 零信任安全模型

Pact is built on a **zero-trust architecture** where agents are treated as untrusted external operators. This is a core design principle, not merely a feature:

- **Every state change** (writes, exports, permission requests) must pass through the strict Policy Engine
- **Every operation** is recorded in the immutable Operation Ledger — no exceptions
- **Agent permissions** are scoped, time-limited, and auditable
- **Knowledge egress** is controlled through hyper-granular access modes (`controlledView`, `copyToContext`, `checkoutAllowed`)
- **Checkpoint Tree** provides append-only integrity guarantees with full replayability

For a deeper understanding of our security architecture, refer to:

- 📖 [Architecture](docs/architecture/ARCHITECTURE.md)
- 📖 [Workspace Assets](docs/functionality/WORKSPACE-ASSETS.md)
- 📖 [Knowledge](docs/functionality/KNOWLEDGE.md)
- 📖 [Security and Authorization](docs/functionality/SECURITY-AUTHORIZATION.md)
- 📖 [Protocols](docs/protocols/PROTOCOLS.md)

---

## Acknowledgments / 致谢

We gratefully acknowledge security researchers who help improve Pact's security posture. Responsible reporters will be credited in release notes and security advisories (with permission).

---

*Pact — where trust is earned through verifiable state, not assumed by default.*

*Pact — 信任来自可验证的状态，而非默认的假设。*
