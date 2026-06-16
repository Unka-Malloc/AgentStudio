# Pact Compatibility Targets

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Compatibility targets for server platforms, client platforms, agent frameworks, and external services.
- Staleness check: Checked against `package.json`, `client-gui/pubspec.yaml`, `client-gui/packaging.modules.json`, module manifests, target adapters, external service operations, and Docker/runtime scripts on 2026-06-16.

## 服务端平台

| 目标 | 当前口径 |
| --- | --- |
| Node.js | `package.json` 要求 `^22.0.0 || ^24.0.0`。 |
| 默认服务端端口 | `7228`，Dockerfile 与 docker-compose 必须保持一致。 |
| 本机开发 | macOS/Linux/Windows 开发环境均以 Node.js、npm、SQLite 和本地数据目录为主。 |
| Docker | 支持 Docker / Docker Compose 单机部署；生产必须置于 HTTPS 反向代理和受控网段后。 |
| Client-local runtime | loopback only，`edition=client-local`，`profile=minimal`，必须传入 runtime config。 |
| Runtime dependencies | Tika/JRE、OCR Python/PaddleOCR、Gerrit local runtime、外部知识蒸馏容器等按显式脚本下载或配置。 |

## 客户端平台

| 目标 | 当前口径 |
| --- | --- |
| Flutter SDK | `client-gui/pubspec.yaml` 使用 Dart SDK `^3.11.4`。 |
| 桌面平台 | macOS、Linux、Windows 均在 `client-gui/packaging.modules.json` 声明。 |
| macOS | 支持 `client:build:macos`、`client:install:macos` 和 AppIcon 生成。 |
| Linux | 支持 `client:build:linux`、`client:linux:smoke`、`client:linux:gui-smoke`。 |
| Windows | 支持 `client:build:windows`；相关系统密钥后端和 smoke 覆盖按 verifier 推进。 |
| Android | 存在 `client:build:android` 脚本，但不作为当前桌面客户端主交付面。 |
| Rust sidecar | `client-cli` 作为 `pact-client` native sidecar 打包进桌面客户端。 |

## 智能体框架

一等目标智能体固定为：

- OpenClaw
- Claude Code
- Codex
- Antigravity
- OpenCode
- Copilot
- Kilo Code
- Cursor
- Hermes Agent

这些目标在客户端侧有 MCP config / native history / runtime adapter 边界，在服务端侧通过 Downstream Client Aspect、MCP adapter layer、ACP adapter layer、ACP Relay target registry 或 Tool Management projection 暴露。native ACP 不是所有目标的必达要求；Pact 只对当前可发现、可验证的 ACP adapter 执行 native ACP 适配和调用。未发现 native ACP 时跳过 native 适配，不阻断目标兼容性；CLI fallback、Agent API proxy 或 contract mock 仍可用，但 source-visible evidence 必须标注 degraded、unsupported 或对应 proxy mode。

## 外部服务

| 服务族 | 支持口径 |
| --- | --- |
| Gerrit | 通过 Gerrit code review route、local Gerrit doctor/download/start/smoke 和 audited Git review upload 支持。 |
| GitHub / GitLab / Git | 作为 repo/codespace provider 目标存在；真实凭据和组织策略按 provider manifest 与 secretRef 管理。 |
| Cloud Drive | iCloud 与 OneDrive local directory projection 是当前真实本机验证重点；Google Drive、Dropbox 和 OneDrive remote API 仍按 contract/live verifier 区分。 |
| External Knowledge Distillation | 远程容器服务，必须通过 bearer gate、non-root、Tika checksum、healthcheck、资源限制和密钥外置门禁。 |
| Dify / RAGFlow | 通过 KnowledgeBackendPort 的 secretRef 与 contract-mode verification 接入。 |
| Vector / Search Backends | sqlite-vec/local fallback、LanceDB、Qdrant、OpenSearch、pgvector 按模块或 external knowledge base mount 接入。 |
| Model Providers | Google/OpenAI/custom HTTP/Ollama-compatible 等由 settings、model routing、ServiceHub 或外部模型网关管理；secret 不进入文档。 |
| Raw MCP upstream | 只接受 HTTP/HTTPS endpoint；不接受 stdio、本机 command transport、cwd/env 进程描述或 ServiceHub 托管本机 MCP。 |

## 兼容声明规则

- `live` 表示真实服务或真实客户端路径已由 verifier 或 smoke 证明。
- `contract-mode` 表示接口形状、manifest、schema、policy 或 mock path 通过，但未证明真实外部服务。
- `localProjectionVerified` 表示本机目录投影可用，不等同远端云 API 同步。
- native ACP 采用 detect-and-use-if-present；没有官方/主流 ACP adapter 或本机 proof 时跳过，不登记为实现缺口。
- `nativeAcpTargetSupported=false` 不能被 CLI fallback 或 Agent API proxy 改写为 true。
- 新增兼容目标必须同步更新代码、manifest、verifier 和本文。
