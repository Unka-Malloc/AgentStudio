# External Service Registration Templates

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Draft template catalogue
- Scope: External service registration templates for ServiceHub.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

ServiceHub registration uses typed templates, not a generic URL proxy. The operator-facing shape is a ServiceHub Registration Draft: a minimal, reviewable JSON document with the endpoint, stable service id, and the smallest protocol-specific tool mapping. HTTP JSON, HTTPS JSON, JSON-RPC, raw MCP Streamable HTTP, raw MCP SSE, generic SSE, and OpenAI-compatible model gateway are separate templates. HTTP/HTTPS templates use `upstream.baseUrl`; raw MCP, JSON-RPC, SSE, and model gateway templates use `upstream.url`. The template catalog exposes machine-readable `requiredFields`, `requiredCombinations`, `optionalCombinations`, `defaultedFields`, `operatorMinimumDraft`, `minimumDraft`, and `formContract` so registration UI/CLI can render only the minimum fields by default. Before promotion, Pact materializes that draft into a ServiceHub Materialized Manifest by applying protocol defaults, `policyPreset`, secret binding status, static lint, verification evidence, promotion metadata, and runtime policy expansions.

Raw MCP templates are HTTP/HTTPS forwarding templates only. ServiceHub does not register stdio MCP, command transports, cwd/env launch descriptors, or local-process MCP bridges as external services.

## Template Families

| Template id | Runtime status | Upstream type | Minimal endpoint field | Tool declaration |
| --- | --- | --- | --- | --- |
| `external-service.template.raw-mcp-streamable-http` | Production candidate | `mcp` + `streamable-http` | `upstream.url` | Omitted; discovered from upstream `tools/list`. |
| `external-service.template.raw-mcp-sse` | Production candidate | `mcp` + `sse` | `upstream.url` | Omitted; discovered from legacy HTTP+SSE MCP `tools/list`. |
| `external-service.template.http-json` | Production candidate with egress policy | `http` | `upstream.baseUrl` | Required `tools[]` HTTP mapping. |
| `external-service.template.https-json` | Production candidate | `https` | `upstream.baseUrl` | Required `tools[]` HTTP mapping with TLS defaults. |
| `external-service.template.json-rpc` | Production candidate | `json-rpc` | `upstream.url` | Required `tools[]` JSON-RPC method mapping. |
| `external-service.template.sse` | Bounded finite response only | `sse` | `upstream.url` | Required `tools[]` event stream mapping. |
| `external-service.template.openai-model-gateway` | Production candidate for OpenAI-compatible JSON POST | `llm` | `upstream.url` | Omitted by default; generated from the template/default model protocol. |

HTTP and HTTPS JSON are intentionally separate. `http-json` is for explicitly allowed internal or development endpoints; public production endpoints should use `https-json`. Generic SSE is also separate from raw MCP SSE: raw MCP SSE speaks MCP over SSE, while `external-service.template.sse` wraps an event stream as one or more Pact tools.

## Production Registration Minimum / 生产接入最小组合

接入方不要手写完整 materialized manifest。上线注册只交一个 Registration Draft：如果控制台或 CLI 已经选好模板，就提交 `operatorMinimumDraft`；如果直接走 JSON API，就在同一份草稿前面加 `templateId`。除此之外的字段默认全部隐藏。

| Template | 已选模板后的必填字段 | 直接 JSON 额外字段 | 组合可选字段 | 不应出现在最小草稿 |
| --- | --- | --- | --- | --- |
| HTTP JSON | `serviceId`, `upstream.baseUrl`, `tools[].name`, `tools[].method`, `tools[].path` | `templateId=external-service.template.http-json` | `secret-auth` (`upstream.auth.type` + `upstream.auth.secretRef`), `inputSchema`, request mapping, response projection, health check, timeout/retry | `upstream.type`, `upstream.transport`, `binding`, `policyPreset`, `healthCheck`, `evidence` |
| HTTPS JSON | `serviceId`, `upstream.baseUrl`, `tools[].name`, `tools[].method`, `tools[].path` | `templateId=external-service.template.https-json` | Same as HTTP JSON; TLS verification is defaulted | `upstream.type`, `upstream.transport`, TLS policy expansion, `binding`, `policyPreset`, `evidence` |
| JSON-RPC 2.0 | `serviceId`, `upstream.url`, `tools[].name`, one of `tools[].method` / `tools[].rpc.method` | `templateId=external-service.template.json-rpc` | `rpc.params` / `request.body`, `rpc.resultPath` / `response.resultPath`, `secret-auth`, optional multi-endpoint group (`upstream.endpoints` + `tools[].rpc.endpointRef`) | `upstream.type`, `upstream.rpcVersion`, `binding`, `policyPreset`, `evidence` |
| Generic SSE | `serviceId`, `upstream.url`, `tools[].name` | `templateId=external-service.template.sse` | Event filters (`tools[].sse.eventTypes`), stream budget (`tools[].sse.maxEvents` / `tools[].sse.maxBytes`), `secret-auth` | `upstream.type`, `upstream.eventFormat`, streaming policy expansion, `binding`, `policyPreset`, `evidence` |
| Raw MCP Streamable HTTP | `serviceId`, `upstream.url` | `templateId=external-service.template.raw-mcp-streamable-http` | `secret-auth`, timeout override | `upstream.type`, `upstream.transport`, `tools[]`, MCP firewall expansion, `evidence` |
| Raw MCP SSE | `serviceId`, `upstream.url` | `templateId=external-service.template.raw-mcp-sse` | `secret-auth`, timeout override | `upstream.type`, `upstream.transport`, `tools[]`, MCP firewall expansion, `evidence` |
| OpenAI-compatible model gateway | `serviceId`, `upstream.url` | `templateId=external-service.template.openai-model-gateway` | `upstream.modelProtocol` override, provider hint, `secret-auth`, model budget, redaction, routing/quota overrides | `upstream.type`, `tools[]`, provider auth literals, `binding`, `policyPreset`, `evidence` |

Machine-readable clients should read `formContract.templateSelectedRequiredFields`, `formContract.directJsonRequiredFields`, `formContract.minimumUsableCombination`, `formContract.directJsonMinimumCombination`, and `formContract.fieldCategories`. Those fields are the source of truth for rendering a small registration form.

## Field Minimality

ServiceHub has two shapes:

- Template-selected Draft: the control-plane or console has already selected one template. The operator only fills the template's `operatorMinimumDraft`: `serviceId`, endpoint, and the smallest tool mapping where the protocol needs one. It omits `schemaVersion`, `kind`, `templateId`, `upstream.type`, MCP `upstream.transport`, `serviceName`, `displayName`, `mode`, `startupPolicy`, `binding`, `policyPreset`, `policies`, `healthCheck`, `metadata`, and all materialized evidence fields.
- Self-describing Registration Draft: direct JSON submissions include `templateId` plus the same minimum fields. They still omit `upstream.type` and MCP `upstream.transport`; Pact injects those from the selected template before validation.
- Materialized Manifest: the persisted runtime contract. Pact fills in `schemaVersion=v0.0.1:schema:definition-1`, `kind=pact.external-service.config`, the inferred `templateId`, `serviceName=serviceId`, `mode=connected`, `startupPolicy=external-only`, `binding.outlet=pact.serviceHub`, `policyPreset=servicehub.production-default`, policy expansion, verifier evidence, promotion metadata, secret binding status, and audit metadata.

The template catalog now exposes the same split as `formContract`:

| Field group | Meaning | Default UI behavior |
| --- | --- | --- |
| `requiredFields` | Minimum fields that must be supplied for the selected protocol family. | Rendered in the first registration form. |
| `requiredCombinations` | Protocol-selected required groups, such as HTTP/HTTPS `upstream.baseUrl` or JSON-RPC/SSE `upstream.url`. | Rendered as one focused control. |
| `optionalCombinations` | Fields that must appear together when used, such as `upstream.auth.type` plus `upstream.auth.secretRef`. | Hidden under optional fields. |
| `advancedOptionalFields` | Useful overrides with safe defaults, such as timeout, display name, health check, binding and policy leaf overrides. | Hidden under optional fields. |
| `defaultedFields` | Fields inferred from template selection or `upstream.type`. | Not hand-authored in the minimum draft. |
| `materializedOnlyFields` | Evidence, promotion, expanded policy and audit fields. | Never hand-authored during registration. |

| Protocol family | Template-selected minimum | Self-describing minimum | Combination optional fields |
| --- | --- | --- |
| Raw MCP Streamable HTTP | `serviceId`, `upstream.url` with explicit scheme/host/port/path. | Add `templateId=external-service.template.raw-mcp-streamable-http`. | `secret-auth` as `upstream.auth.type` + `upstream.auth.secretRef`; `upstream.timeoutMs`. No `tools[]` because tools are discovered from upstream MCP `tools/list`. |
| Raw MCP SSE transport | `serviceId`, `upstream.url` with explicit scheme/host/port/path. | Add `templateId=external-service.template.raw-mcp-sse`. | Same as raw MCP Streamable HTTP. This is MCP over legacy HTTP+SSE, not generic SSE; runtime reads the `endpoint` event and POSTs JSON-RPC to that message endpoint. |
| HTTP JSON | `serviceId`, `upstream.baseUrl`, and at least one `tools[]` entry with one stable name plus `method` and `path`. | Add `templateId=external-service.template.http-json`. | `inputSchema`; `request.query`/`request.body`/business `request.headers`; `response.resultPath`; `secret-auth`; health check; retry/timeout policy. Use only where non-TLS HTTP is explicitly allowed. |
| HTTPS JSON | `serviceId`, `upstream.baseUrl`, and at least one `tools[]` entry with one stable name plus `method` and `path`. | Add `templateId=external-service.template.https-json`. | Same as HTTP JSON, with TLS verification defaulted on. |
| JSON-RPC | `serviceId`, `upstream.url` with explicit scheme/host/port/path, and at least one `tools[]` entry with `name` plus `method` or `rpc.method`. | Add `templateId=external-service.template.json-rpc`. | `inputSchema`; `rpc.params`/`request.body`; `rpc.resultPath`/`response.resultPath`; `secret-auth`; endpoint refs as `upstream.endpoints` + `tools[].rpc.endpointRef`. `rpcVersion=2.0` is injected by the template. |
| Generic SSE | `serviceId`, `upstream.url` with explicit scheme/host/port/path, and at least one `tools[]` stream name. | Add `templateId=external-service.template.sse`. | `tools[].sse.eventTypes`; `tools[].sse.maxEvents`; `tools[].sse.maxBytes`; `secret-auth`. `eventFormat=json-data` is injected by the template. Runtime exposes bounded finite responses only. |
| OpenAI-compatible model gateway | `serviceId`, `upstream.url`. | Add `templateId=external-service.template.openai-model-gateway`. | `upstream.modelProtocol`; `provider`; `secret-auth`; model budget; redaction; quota; audit and routing overrides. `tools[]` can be omitted; `openai-compatible` generates `chat_completions_create`, and `openai-responses` generates `responses_create`. |

## Operator Field Rules

The registration UI should start from `operatorMinimumDraft` after a template has been selected. Direct JSON API submissions use the same shape plus `templateId` as `minimumDraft`.

| Category | Fields | Rule |
| --- | --- | --- |
| Always required | `serviceId` | Stable registry key; names default from it. |
| Protocol endpoint | HTTP/HTTPS: `upstream.baseUrl`; raw MCP/JSON-RPC/SSE/model gateway: `upstream.url` | Exactly one endpoint field is shown per selected template. |
| Tool mapping required | HTTP/HTTPS: `tools[].name`, `tools[].method`, `tools[].path`; JSON-RPC: `tools[].name` plus `tools[].method` or `tools[].rpc.method`; generic SSE: `tools[].name` | Raw MCP and OpenAI-compatible model gateway omit `tools[]` in the minimum path. |
| Model gateway optional | `upstream.modelProtocol` | Hidden by default; the template URL can infer `openai-responses`, and operators only override this for non-default model protocols. |
| Combination optional | `upstream.auth.type` + `upstream.auth.secretRef`; health check fields; multi-endpoint JSON-RPC `upstream.endpoints` + `tools[].rpc.endpointRef` | Hide by default; if the operator opens a group, enforce the group rule. |
| Independent optional | Display text, description, timeout/retry overrides, request mapping, response projection, event filters, quotas, redaction/routing overrides | Hide by default; only show when the service owner needs non-default behavior. |
| Defaulted | `schemaVersion`, `kind`, `upstream.type`, MCP `upstream.transport`, SSE `upstream.eventFormat`, JSON-RPC `rpcVersion`, `serviceName`, `displayName`, `mode`, `startupPolicy`, `binding`, `policyPreset`, default policies | Do not ask the operator to fill these in the minimum flow. |
| Materialized only | `evidence`, `promotion`, `verification`, `expandedPolicies`, `audit`, `secretBindingStatus`, generated dependency/runtime fields | Never hand-authored by upstream service owners. |

Optional combination rules:

- Auth is all-or-nothing: omit `auth` for public services; when present it must use SecretStore references only. Never store bearer tokens, API keys, basic passwords, OAuth tokens, cookies, or provider sessions as literal manifest values.
- TLS is implicit for HTTPS endpoints. Custom CA or mTLS material is optional and must use secret refs.
- Read-only tools can omit reconciliation. Any side-effecting tool or `risk >= safe_write` needs idempotency, status query, reconciliation, compensation, or operator recovery evidence before production promotion.
- Policy overrides are leaf overrides only. Do not copy the full production policy block into a draft.
- Production default rejects literal localhost, loopback, private, link-local and metadata-style addresses. Local mock or Docker development endpoints must explicitly set `policyPreset: "servicehub.development-local"` and should not be promoted as production services.

## Minimal Raw MCP Streamable HTTP

```json
{
  "templateId": "external-service.template.raw-mcp-streamable-http",
  "serviceId": "raw-mcp-http-demo",
  "upstream": {
    "url": "https://mcp.example.com:443/mcp/"
  }
}
```

This is the minimum production-candidate draft for an already hosted MCP server using Streamable HTTP. Pact materializes the `pact.serviceHub` binding, MCP capability firewall, egress policy, tool adoption gate, schema-bound forwarding, streaming/backpressure policy, quota, error taxonomy, output governance, and external-call receipts from `servicehub.production-default`. Discovered tools start as candidates with review descriptors; operator adoption can be scoped to selected tools and guarded by expected fingerprints.

## Minimal Raw MCP SSE

```json
{
  "templateId": "external-service.template.raw-mcp-sse",
  "serviceId": "raw-mcp-sse-demo",
  "upstream": {
    "url": "https://mcp.example.com:443/sse"
  }
}
```

Use this for an upstream MCP server over legacy SSE-over-HTTP. It is not the same as wrapping an arbitrary event stream: Pact opens the SSE endpoint, reads the `endpoint` event, POSTs MCP JSON-RPC messages to that endpoint, and waits for matching `message` events.

## Minimal HTTP JSON

```json
{
  "templateId": "external-service.template.http-json",
  "serviceId": "http-json-demo",
  "upstream": {
    "baseUrl": "http://api.internal.example:8080"
  },
  "tools": [
    {
      "name": "getItem",
      "method": "GET",
      "path": "/v1/items/{id}"
    }
  ]
}
```

The HTTP template exists for explicitly allowed non-TLS internal or development endpoints. Production public services should use HTTPS.

## Minimal HTTPS JSON

```json
{
  "templateId": "external-service.template.https-json",
  "serviceId": "https-json-demo",
  "upstream": {
    "baseUrl": "https://api.example.com:443"
  },
  "tools": [
    {
      "name": "searchItems",
      "method": "POST",
      "path": "/v1/items/search"
    }
  ]
}
```

`auth` is a combination field: omit it for unauthenticated services; when present, it references SecretStore only.

## Minimal JSON-RPC

```json
{
  "templateId": "external-service.template.json-rpc",
  "serviceId": "json-rpc-demo",
  "upstream": {
    "url": "https://rpc.example.com:443/jsonrpc"
  },
  "tools": [
    {
      "name": "lookupTicket",
      "method": "ticket.lookup"
    }
  ]
}
```

JSON-RPC is not treated as generic HTTP JSON because request framing, method identity, id correlation, batch behavior, and error mapping are protocol-specific. A JSON-RPC HTTP 200 response containing an `error` envelope is treated as a failed tool call, not a successful result.

## Minimal SSE

```json
{
  "templateId": "external-service.template.sse",
  "serviceId": "sse-demo",
  "upstream": {
    "url": "https://events.example.com:443/v1/events"
  },
  "tools": [
    {
      "name": "watchEvents"
    }
  ]
}
```

SSE tools must go through Streaming And Backpressure controls before any event reaches an agent. Event data is governed output, not raw passthrough.

The current generic SSE runtime compiles the minimum tool into a bounded `GET` call that parses `text/event-stream` data into an `events[]` result and closes the upstream reader at `tools[].sse.maxEvents`, with a default of 1. It enforces byte/event budgets and records cancel/release cleanup evidence. Long-lived stream forwarding is not exposed as a production capability.

## Minimal OpenAI-Compatible Model Gateway

```json
{
  "templateId": "external-service.template.openai-model-gateway",
  "serviceId": "openai-compatible-demo",
  "upstream": {
    "url": "https://api.openai.com:443/v1/responses"
  }
}
```

For `openai-compatible`, Pact generates `chat_completions_create`; for `openai-responses`, it generates `responses_create`. The `/v1/responses` endpoint infers `openai-responses`; service owners only set `upstream.modelProtocol` when the endpoint shape is not inferable or needs an explicit override. Both tools forward the caller's JSON body to the registered endpoint through ServiceHub egress, SecretStore, adoption, receipt and output-governance paths. Non-OpenAI LLM protocol adapters remain scaffolded until their own contract/live verifiers exist.

## Materialization Contract

The minimum JSON examples above are drafts. A promoted ServiceHub Materialized Manifest must record the adopted `policyPreset`, expanded egress policy, SecretStore binding status, mapping sandbox limits, outbound payload policy, MCP capability firewall where applicable, streaming/backpressure policy, quota/bulkhead policy, error taxonomy, recovery policy, output governance, verification evidence, catalog version, and rollback metadata.

This materialization step is required for production stability, but those fields are not required registration form fields. The registration UI, CLI, and discovery template draft operation should present them as defaulted policy evidence and focused override controls, not as a large JSON block that every upstream service owner must hand-author.
