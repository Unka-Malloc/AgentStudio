# 外部 MCP 直通接入 Pact

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Maintained example
- Scope: 外部 MCP 直通接入 Pact.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

这个例子展示一个已经通过 HTTP/HTTPS 暴露 MCP endpoint 的外部服务如何以最小配置接入 Pact。此场景不需要重新声明上游 tools；Pact 从上游 MCP 的 `tools/list` 发现工具，并通过 Pact 的权限、审计、配额、出口治理和输出治理包装后暴露给下游智能体。

## 最小注册草案

```json
{
  "schemaVersion": "v0.0.1:schema:definition-1",
  "kind": "pact.external-service.config",
  "templateId": "external-service.template.raw-mcp-streamable-http",
  "serviceId": "upstream-demo",
  "upstream": {
    "type": "mcp",
    "transport": "streamable-http",
    "url": "https://mcp.example.com:443/mcp/"
  }
}
```

Raw MCP 支持 Streamable HTTP 和旧 HTTP+SSE 两种 HTTP/HTTPS 转发。旧 SSE transport 会先打开 SSE endpoint，读取 `endpoint` 事件，再把 MCP JSON-RPC 消息 POST 到该 message endpoint，并从同一 SSE 流等待匹配响应。如果要注册一个上游 MCP SSE 服务，可以使用对应模板和 transport：

```json
{
  "schemaVersion": "v0.0.1:schema:definition-1",
  "kind": "pact.external-service.config",
  "templateId": "external-service.template.raw-mcp-sse",
  "serviceId": "upstream-sse-demo",
  "upstream": {
    "type": "mcp",
    "transport": "sse",
    "url": "https://mcp.example.com:443/sse"
  }
}
```

## 字段边界

| 字段 | 要求 | 语义 |
| --- | --- | --- |
| `schemaVersion` | 必填 | 声明注册 DSL 版本。 |
| `kind` | 必填 | 必须是 `pact.external-service.config`，避免和通用 MCP client 配置混淆。 |
| `templateId` | 必填 | 选择 raw MCP Streamable HTTP 或 raw MCP SSE 的注册模板。 |
| `serviceId` | 必填 | 给上游服务一个稳定 Pact 身份，用于命名空间、审计、策略、指标和生命周期状态。 |
| `upstream.type` | 必填 | raw MCP passthrough 必须是 `mcp`。 |
| `upstream.transport` | 必填 | 只允许 `streamable-http` 或 `sse`；不允许 `stdio`、command、cwd/env 或本机进程 bridge。 |
| `upstream.url` | 必填 | 上游 MCP endpoint，必须显式包含协议、主机、端口和路径。 |
| `upstream.auth` | 组合可选 | 公开服务可省略；需要认证时只写 auth scheme 和 `secretRef`，真实 secret value 只能由 operator/admin 写入 SecretStore。 |
| `policyPreset` | 可选，默认 `servicehub.production-default` | 注册草案可省略；保存或 promote 时必须记录采用的 preset 和展开后的 policy evidence。 |
| `tools` | raw MCP 下省略 | Pact 通过上游 `tools/list` 自动发现，再经过 Tool Adoption Gate 生成 Pact virtual operations。 |
| `displayName` / `mode` / `startupPolicy` / `binding` / `mcp` / `scopes` / `metadata` | 默认生成 | 不属于最小注册草案字段；模板和 materialization step 负责补齐。 |
| `policies` | 可选覆盖 | 不在最小示例里展开。生产所需 egress、capability firewall、session isolation、quota、error taxonomy、streaming、output governance、receipt、promotion 和 verification 由 preset 物化。 |

## 运行时语义

1. Pact 把 `upstream-demo` 注册为一个外部 MCP 服务候选。
2. Pact 作为 MCP client 连接 `https://mcp.example.com:443/mcp/`。
3. Pact 只使用上游 MCP 的 `initialize`、`tools/list` 和 `tools/call`。
4. 上游 tools 先进入 Tool Adoption Gate，经过命名空间、描述清洗、schema 校验、风险分级、fingerprint 和 operator/admin 采纳后，才可能进入 active catalog。候选工具会带 review descriptor，显示 schema/risk/transport/fingerprint/reason；operator 采纳时可提交 expected fingerprint，防止刷新竞态下采纳了未审查的新候选。同名 schema/transport 变化会保留旧 active 并生成 replacement candidate；上游删除已采纳工具会产生 tombstone evidence，而不是由 refresh 静默删除下游 `tools/list`。执行回执会记录 service fingerprint、tool adoption fingerprint 和 per-operation catalog binding fingerprint，用于追溯调用时实际采用的工具版本。
5. 下游智能体只通过 `pact.serviceHub` 调用当前 grant 可见的已采纳工具。
6. 每次调用都走 Manifest-Bound Request Mapping、egress、secret injection、quota/bulkhead、deadline/cancellation、streaming/backpressure、output governance、error taxonomy 和 external-call receipt。

Raw MCP SSE 与普通 SSE 分属不同入口：Raw MCP SSE 是 MCP transport；普通 `external-service.template.sse` 是把事件流包装成一个有界工具结果。当前普通 SSE runtime 只支持 bounded `GET` 和 `events[]` 解析，不支持长连接生产转发。

`url` 不允许省略端口。即使使用 HTTP 80 或 HTTPS 443，也必须写成 `http://example.com:80/mcp` 或 `https://example.com:443/mcp`。这样 Pact 可以在配置校验、egress policy、审计和故障排查里拿到明确的上游网络边界。

这份配置只能通过 operator/admin control plane 保存和刷新。普通 MCP agent 可以在授权后通过 `pact.serviceHub` 调用注册后的工具，但不能通过 `pact.serviceHub` 写入配置、绑定 secretRef、刷新上游工具缓存、删除服务，或把任意 URL 临时注册成新工具。

ServiceHub 原始 MCP 直通只接受 HTTP/HTTPS MCP endpoint。`stdio` MCP、本机 command transport、`cwd/env` 进程启动描述和 stdio bridge 不能作为外部服务注册到 ServiceHub；这些入口会暴露或接近本机配置、环境变量、文件系统、shell 权限和用户身份。需要接入的本机 MCP 能力必须先由服务所有者暴露为受控 HTTP/HTTPS MCP endpoint，再按本例注册。

上游 MCP session 默认按 `serviceId + Pact grant/subject + workspace/tenant + auth binding` 隔离。Pact 可以复用底层 TCP/HTTP 连接池，但不能把一个 agent 的 MCP session、cursor、pagination token、conversation id 或上游认证上下文给另一个 agent 复用。grant 撤销、secretRef 轮换、workspace/tenant 解绑或 service disable 必须使相关上游 session 失效。

ServiceHub 只桥接上游 MCP tools。`resources`、`prompts`、`roots`、`sampling`、`elicitation`、`logging`、非工具 notification 和 client callback 不会透传给下游 agent，也不能让上游反向请求 Pact 或 agent 执行模型采样、读取资源或注入 prompt。资源类返回按 Output Governance 变成受管 asset/ref；prompt-like 内容只当不可信数据。

生产上线必须通过 ServiceHub Production Verification Matrix。矩阵仍然覆盖稳定 outlet、旧入口移除、raw MCP HTTP/HTTPS-only、静态模板 dry-run、manifest-bound invocation、Mapping Sandbox、Outbound Payload Governance、egress 解析后 IP 与 redirect 复检、secret 注入与脱敏、Tool Adoption Gate、Grant Projection、Capability Firewall、Quota/Bulkhead、Error Taxonomy/Retry Hint、Reconciliation/Recovery、health/circuit、deadline/cancel/unknown outcome、Streaming And Backpressure、promotion/rollback、Output Governance 和 external-call receipt。区别只是这些字段由 materialization step 记录为 policy evidence，不要求外部服务注册方手写完整策略块。

工具目录保持稳定。上游临时宕机、超时、健康检查失败或 circuit open 不会自动从 `tools/list` 删除已采纳工具；调用时返回标准化 `upstream_unavailable`、`service_degraded` 或 `circuit_open`，并带 retry hint 和 audit ref。
