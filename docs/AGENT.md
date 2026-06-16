# Docs Agent Entry

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Agent-facing development and documentation guidance for Pact.
- Staleness check: Checked against current docs layout, root package scripts, Pact skill references, and repository module structure on 2026-06-16.

## 入口规则

本文是 Pact 项目内智能体开发引导的唯一文档入口。根目录 `README.md` 是产品页，禁止作为智能体工作指引修改。其它目录中的临时过程说明、历史计划或横向设计草案不能替代本文。

## 首读顺序

1. `docs/architecture/ARCHITECTURE.md`
2. 与任务匹配的 `docs/functionality/*.md`
3. 协议任务读取 `docs/protocols/PROTOCOLS.md`
4. 状态机任务读取 `docs/state-machine/STATE-MACHINES.md`
5. 命令或脚本任务读取 `docs/USAGES.md`
6. 开发规范、测试、发布门禁读取 `docs/runbook/DEVELOPMENT-RUNBOOK.md`

## 代码事实源

| 主题 | 首选代码入口 |
| --- | --- |
| 服务端脚本 | `package.json`, `server/scripts/` |
| Operation | `server/platform/common/operation-dispatcher/operation-registry.mjs` |
| HTTP runtime | `server/services/server-runtime/http-server.mjs` |
| 模块 manifest | `server/platform/**/module.json` |
| 状态机 | `server/platform/common/state-machine/definitions/` |
| Tool Management | `server/platform/specialized/capabilities/tools/tool-management-core/` |
| Knowledge | `server/platform/specialized/knowledge/` and `server/protocols/knowledge/` |
| ACP Relay | `server/platform/specialized/capabilities/agent-relay/acp-agent-relay/` |
| Server Console | `server-web/` |
| Flutter client | `client-gui/lib/src/` |
| Rust sidecar | `client-cli/src/` |

## 子系统入口

`server/AGENT.md`, `server-web/AGENT.md`, `server/platform/common/mcp/gateway-installer/AGENT.md`, `client-cli/AGENT.md`, `client-gui/AGENT.md`, `docs/AGENT.md`

## 文档治理

- 新长期架构结论写入 `docs/architecture/ARCHITECTURE.md`。
- 新专业名词先写入 `docs/TERM.md`，未登记术语不进入当前文档。
- 新功能设计写入对应 `docs/functionality/*.md`，不能新增第 11 个功能模块文档，除非先调整架构中的模块清单。
- 新协议写入 `docs/protocols/PROTOCOLS.md`。
- 新状态机写入 `docs/state-machine/STATE-MACHINES.md`，实现必须先进入 state-machine definitions 或对应 verifier。
- 新命令、脚本、CLI 使用方式写入 `docs/USAGES.md`。
- 新开发规范、测试验证、发布门禁写入 `docs/runbook/DEVELOPMENT-RUNBOOK.md`。
- 历史过程文档不保留；若有长期价值，先合并到权威文档或 ADR，再删除原文件。

## 安全边界

- 不在文档、日志或对话中写入 API key、OAuth token、cookie、grant token、claim token 或私钥。
- 涉及密钥的示例必须使用环境变量、stdin 或 secretRef。
- 对删除、恢复、发布、外部写入、grant 变更和 destructive operation，先读取实现和 verifier，再动手。

## 验证与 Context Budget

- 先读取与任务匹配的最小文档集合，再扩大到代码或 verifier。
- 不读取历史过程文档；当前 docs 中不保留 `reports/`、`history/`、`scenarios/` 作为事实源。

文档变更至少运行：

```bash
npm run server:verify:docs-governance
git diff --check
```

触及版本证据引用时还需运行：

```bash
npm run server:verify:version-registry
npm run server:verify:version-naming
```
