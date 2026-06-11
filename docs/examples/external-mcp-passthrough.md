# 外部 MCP 直通接入 Pact

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Maintained example
- Scope: 外部 MCP 直通接入 Pact.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

这个例子展示一个已经实现 MCP 协议的外部服务如何以最小配置接入 Pact。此场景不需要重新声明上游 tools；Pact 从上游 MCP 的 `tools/list` 发现工具，并通过 Pact 的权限、审计、配额和出口治理包装后暴露给下游智能体。

## 最小配置

```json
{
  "kind": "pact.external-service.config",
  "serviceId": "upstream-demo",
  "upstream": {
    "type": "mcp",
    "transport": "streamable-http",
    "url": "http://127.0.0.1:8787/mcp/"
  },
  "binding": {
    "mode": "passthrough",
    "outlet": "pact.skillHub"
  }
}
```

## 逐行语义

| 行 | 配置 | 语义 |
| --- | --- | --- |
| 1 | `{` | 开始一个外部服务注册文档。 |
| 2 | `"kind": "pact.external-service.config"` | 声明这是 Pact 外部服务配置，不是通用 MCP client 配置。 |
| 3 | `"serviceId": "upstream-demo"` | 给上游服务一个稳定的 Pact 身份。Pact 用它做命名空间、审计、策略、指标和生命周期状态归属。 |
| 4 | `"upstream": {` | 开始定义上游连接切面。这一段描述 Pact 作为平台运行时，如何连接外部应用服务。 |
| 5 | `"type": "mcp"` | 表示上游本身已经是 MCP 服务。Pact 不需要为它编译 REST、gRPC 或 CLI 映射。 |
| 6 | `"transport": "streamable-http"` | 指定上游 MCP 传输方式。这里表示 Pact 通过 Streamable HTTP 连接上游。 |
| 7 | `"url": "http://127.0.0.1:8787/mcp/"` | 指定上游 MCP endpoint，包括协议、主机、端口和路径。Pact 会把上游 `initialize`、`tools/list`、`tools/call` 流量发到这个地址。 |
| 8 | `}` | 结束上游连接切面。 |
| 9 | `"binding": {` | 开始定义 Pact 绑定切面。这一段描述上游服务如何被 Pact 暴露和治理。 |
| 10 | `"mode": "passthrough"` | 表示直通桥接上游 MCP tools，而不是从本地 request/response mapping 生成 tools。 |
| 11 | `"outlet": "pact.skillHub"` | 指定下游 MCP 暴露入口。这里表示桥接后的 tools 放在 Pact Skill Hub outlet 下。 |
| 12 | `}` | 结束 Pact 绑定切面。 |
| 13 | `}` | 结束外部服务注册文档。 |

## 运行时语义

这份配置的运行时含义是：

1. Pact 把 `upstream-demo` 注册为一个外部服务。
2. Pact 作为 MCP client 连接 `http://127.0.0.1:8787/mcp/`。
3. Pact 调用上游 MCP server 的 `tools/list`，动态发现上游 tools。
4. Pact 通过自己的 MCP service 把这些 tools 暴露给下游智能体，入口归属为 `pact.skillHub`。
5. 下游 `tools/call` 请求先经过 Pact 授权，再由 Pact 转发给上游 MCP 服务。
6. Pact 把这次调用记录为受管外部服务调用，包含 trace、audit、policy decision 和脱敏后的失败证据。

最小形式不需要 `tools` 数组。只有当 Pact 需要把 REST、OpenAPI、gRPC、command 或不完整 MCP surface 合成为 MCP tools 时，才需要 `tools` 段。

`url` 不允许省略端口。即使使用 HTTP 80 或 HTTPS 443，也必须写成 `http://example.com:80/mcp` 或 `https://example.com:443/mcp`。这样 Pact 可以在配置校验、egress policy、审计和故障排查里拿到明确的上游网络边界。
