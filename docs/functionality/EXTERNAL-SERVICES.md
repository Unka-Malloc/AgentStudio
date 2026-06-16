# External Services And Code Repositories

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: ServiceHub, external service registration, raw HTTP/MCP upstreams, cloud drive, external knowledge distillation, knowledge backend ports, repo operations, Codespace, and Gerrit.
- Staleness check: Checked against external service operations, cloud drive module manifest, knowledge backend port manifests, repo/codespace/gerrit modules, and external verification scripts on 2026-06-16.

## 模块边界

本模块负责 Pact 到外部系统的受控出口和代码仓库能力。所有外部调用必须经过 manifest、secretRef、egress policy、authorization、audit、quota/bulkhead 和 output governance。

## 功能项 ES-01 ServiceHub 注册与模板

| 项 | 设计 |
| --- | --- |
| 目标 | 用类型化模板注册外部 HTTP/HTTPS JSON、JSON-RPC、SSE、raw MCP、模型网关等服务。 |
| 输入 | template id、ServiceHub registration draft、endpoint、tools mapping、secret slot。 |
| 处理 | 模板注入默认 policy、field model、materialized manifest 和 safety defaults。 |
| 输出 | draft、config、verification result、candidate catalog。 |
| 错误 | agent dry-run 只能静态分析；真实 contract verification 属于 admin 控制面。 |
| 验证 | `npm run server:verify:external-service-api-registration`。 |

## 功能项 ES-02 Tool Adoption Gate

| 项 | 设计 |
| --- | --- |
| 目标 | 将上游工具安全采纳为 Pact operation/tool。 |
| 输入 | upstream tools/list、schema、description、risk metadata、operator decision。 |
| 处理 | 命名空间化、schema 安全子集校验、risk recalculation、fingerprint/diff、candidate version。 |
| 输出 | adopted tool、promoted catalog、rollback target。 |
| 错误 | 新增或风险升级工具默认不可见，直到 promote。 |
| 验证 | `npm run server:verify:external-service-api-registration`, `npm run server:verify:tool-management`。 |

## 功能项 ES-03 外部调用治理

| 项 | 设计 |
| --- | --- |
| 目标 | 对外部请求执行 egress、mapping sandbox、secret injection、quota、deadline、reconciliation 和 output governance。 |
| 输入 | tool input、materialized manifest、grant、workspace/tenant、secretRef。 |
| 处理 | agent 不能覆盖 URL/auth/header/TLS/proxy；服务端注入 secret；响应先治理再返回。 |
| 输出 | result、asset/ref、externalCallReceipt、standard error envelope。 |
| 错误 | SSRF、DNS rebinding、secret 泄露、mapping violation、unknown outcome 均 fail closed。 |
| 验证 | `npm run server:verify:external-service-api-registration`, `npm run server:verify:security-hardening`。 |

## 功能项 ES-04 Cloud Drive

| 项 | 设计 |
| --- | --- |
| 目标 | 通过 external cloud drive operations 接入 iCloud、OneDrive、Google Drive、Dropbox。 |
| 输入 | connect、status、item list、file download/upload、sync plan/apply、permission list。 |
| 处理 | iCloud/OneDrive local projection 与远端 API live 证明分开；contract-mode 不冒充 live。 |
| 输出 | connection status、local projection、sync result、permission projection。 |
| 错误 | secretRef 缺失或 provider 未 live verified 时不得声明远端同步成功。 |
| 验证 | `npm run server:verify:v001-cloud-drive-e2e`。 |

## 功能项 ES-05 外部知识蒸馏

| 项 | 设计 |
| --- | --- |
| 目标 | 通过远程容器服务执行知识蒸馏 run、evidence query 和 artifact export。 |
| 输入 | `/api/external/knowledge/distillation/*` operations、API token、source refs。 |
| 处理 | 服务端上游网关执行 bearer gate、egress、resource limit、artifact governance 和 audit。 |
| 输出 | run list/get/create/cancel、evidence query、artifact export、service health。 |
| 错误 | 缺少门禁 evidence 时不得 promote 或宣称 production ready。 |
| 验证 | `npm run server:verify:external-knowledge-distillation-service-gates`。 |

## 功能项 ES-06 仓库与代码评审

| 项 | 设计 |
| --- | --- |
| 目标 | 管理 repo operations、Codespace registry、Gerrit route 和 review status sync。 |
| 输入 | repo status/tree/file/diff/change/review operations、Gerrit credentials、provider manifest。 |
| 处理 | repo.* 是受控兼容路由；Codespace 管理 workspace code target；Gerrit route 执行 audited review upload。 |
| 输出 | repo read/write result、change receipt、review comment/approve/request changes/status。 |
| 错误 | 智能体不直接获得裸 Git push；真实 Gerrit live 需要凭据和 smoke 验证。 |
| 验证 | `npm run server:verify:resource-operations`, `npm run server:verify:gerrit-mcp`, `npm run server:verify:codespace`。 |

## 功能项 ES-07 外部知识后端

| 项 | 设计 |
| --- | --- |
| 目标 | 将 Dify、RAGFlow、Qdrant、OpenSearch、pgvector 等后端作为受控 adapter/mount。 |
| 输入 | provider endpoint、secretRef、query、export request、permission request。 |
| 处理 | 外部后端只作为兼容层或 mirror，不越过 KnowledgeCore 和 AgentLibrary 裁决。 |
| 输出 | space list、search result、evidence、export、permission projection。 |
| 错误 | contract-mode provider 不能声明 live production。 |
| 验证 | `npm run server:verify:external-knowledge-base`, `npm run server:verify:v001-knowledge-e2e`。 |
