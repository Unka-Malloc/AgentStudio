# Pact Version

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Server and client version description plus release history.
- Staleness check: Checked against `package.json`, `CHANGELOG.md`, `client-gui/pubspec.yaml`, `client-gui/packaging.modules.json`, and `server/platform/common/version-control/version-registry.json` on 2026-06-16.

## 服务端版本

| 项 | 当前值 |
| --- | --- |
| npm package | `pact` |
| package version | `0.0.1` |
| Node engine | `^22.0.0 || ^24.0.0` |
| Platform baseline | `v0.0.1` |
| Governed version format | `v<platform-version>:<domain>:<subsection>-<version>` |
| Version registry | `server/platform/common/version-control/version-registry.json` |

服务端代码版本由 `package.json` 管理；平台内部 artifact、协议、状态机、schema、runtime 和 transition 使用 Governed Version String。版本注册表是源代码内的单例事实源，证据引用必须指向仍存在的当前文档或实现文件。

## 客户端版本

| 项 | 当前值 |
| --- | --- |
| Flutter app version | `1.0.0+1` |
| Client package profile | `future-client` |
| Native sidecar | `pact-client` from `client-cli` |
| Supported package platforms | macOS, Linux, Windows |
| Android package script | present, not primary desktop delivery |

客户端 GUI 版本来自 `client-gui/pubspec.yaml`。Rust sidecar 与客户端包一起发布，不单独声明为产品版本。客户端本机 runtime 使用服务端 `client-local` edition，不改变服务端 package version。

## 版本治理规则

- 服务端 package 版本、客户端 GUI 版本、Governed Version String、状态机定义版本和 feature profile 版本不得混用。
- 新增 artifact 或协议版本必须进入 version registry，并提供当前存在的 evidence refs。
- 状态机版本变化遵守 SemVer 语义：破坏状态或终态语义为 major，新增兼容状态/事件为 minor，证明或描述修正为 patch 或同版本证据更新。
- 版本迁移必须通过 `version.transition.lifecycle` 表达 plan、dry-run、checkpoint、run、verify、complete、rollback 或 abandon。
- 发布前运行 `npm run server:verify:version-registry` 和 `npm run server:verify:version-naming`。

## 发布记录附录

### Unreleased

- Added Gerrit MCP support for agent-facing read, write, maintenance, and audited Git review upload operations.
- Added repository-scoped Tool Management grants for `repo:read`, `repo:write`, `repo:review`, `repo:approve`, `repo:maintain`, and `repo:admin`.
- Hardened MCP local grants with catalog-driven risk elevation, explicit repair-mode confirmation, per-grant `maxRisk`, and toolset `maxRisk` enforcement.
- Overrode vulnerable transitive `uuid` versions used through LangGraph packages to audited fixed versions.

### 0.0.1 - 2026-05-22

- Initial Pact release with workspace asset governance, AgentLibrary access, checkpoint tree, MCP service, knowledge summarization, Tool Management, contribution leaderboard, Web Console, CLI/GUI clients, knowledge distillation, Docker deployment, and external knowledge backend support.
