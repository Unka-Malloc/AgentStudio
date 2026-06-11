# N-2-N-Interfaces

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Current boundary reference
- Scope: N-2-N-Interfaces.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文把 Pact 的外接面拆成两个边界、四个清单：

1. Pact 系统与外部服务的分界线。
2. 分界线内的 Pact 适配器。
3. 分界线外的外部服务。
4. Pact 系统与下游客户端的分界线，其中线内是 MCP 服务网关，线外是客户端支持列表。

状态口径：

- `运行路径`：仓库里已有本地、HTTP、CLI 或服务端运行路径。
- `contract-mode`：已有协议、配置、secretRef、ledger 或 verifier 合同，但不能在没有真实凭据和 live verifier 的情况下声明生产级接通。
- `scaffold/template`：已有 mount、模板或生态合同，供外部团队实现；不等同于内置 provider。

## 边界能力

边界能力是 Pact 在系统边界上提供的接口、adapter、网关和合同能力。它负责让客户端或外部服务能接入 Pact，但不替代安全裁决和数据事实源：

- 安全裁决归 `2-3-5-Security-Model.md`。
- 数据、资源、状态、证据和链路语义归 `U-1-Data.md`。
- 本文只定义跨边界接入、转换、发现、路由和合同能力。

| 边界能力 | 责任 | 适用边界 |
| --- | --- | --- |
| API / 协议入口 | 暴露 HTTP MCP、Workspace API、Tool Management API、upload session、discovery API 等入口。 | 下游客户端、外部服务 |
| Adapter / Port / Mount | 把外部 provider、parser、vectorStore、graphStore、knowledgeBase、cloud drive、repo/review 系统接入 Pact。 | 外部服务 |
| MCP 服务网关 | 处理 MCP initialize、tools/list、tools/call、SSE、stdio proxy 和分类 toolset。 | 下游客户端 |
| Discovery / Handshake | 发现 Pact endpoint、校验 server identity、返回 interfaceVersion 和 toolsetVersion。 | 下游客户端 |
| Connector / Installer | 为目标客户端写入 Pact MCP 配置、doctor、register、discover-local、server-config。 | 下游客户端 |
| Request Envelope Normalization | 将 MCP、HTTP、CLI、webhook 或 adapter 输入归一成 operation、subject、traceId、idempotencyKey、intent。 | 下游客户端、外部服务 |
| Operation Routing | 将归一化请求路由到 Workspace API、Tool Management、Knowledge、Codespace、Sharedspace、SkillHub 或 adapter。 | 下游客户端、外部服务 |
| Capability Visibility | 只暴露当前 grant 可见的工具、operation、provider capability 或 mount capability。 | 下游客户端、外部服务 |
| Payload Transport | 处理 inline 小文本、upload session、大文件传输、client runtime bootstrap、download URL 和 transport fallback。 | 下游客户端 |
| Callback / Event Bridge | 处理 SSE operation reply、webhook、provider event、tool result、sync completion 和 list changed 事件。 | 下游客户端、外部服务 |
| Response / Error Normalization | 把 provider response、adapter error、MCP error 和 operation result 转成稳定响应。 | 下游客户端、外部服务 |
| Contract Test / Readiness | 区分运行路径、contract-mode、scaffold/template、realE2EVerified 和 production ready。 | 外部服务 |
| Detachable Traffic Gateway | 允许 Caddy / Nginx 等边缘网关代理 MCP、HTTP API、upload 和 bootstrap，同时保持 direct mode 可用。 | 下游客户端 |

边界能力的输出必须能被安全领域和数据链路消费：每次调用都必须先进入 Operation Scheduling Kernel，产生 accepted / rejected decision 和统一 Operation Ledger 记录，并关联 subject、operation、target、state、receipt/audit/checkpoint 或明确的 contract-mode 标记。模块本地 audit、provider ledger、queue event 和 runtime log 只能作为投影或回执，不能替代统一账本。

需要人工确认或高风险审批的边界调用必须由调度内核转为 `pending_operation`，统一进入 `/approval`。审批只能满足人工确认门槛，不能覆盖 Capability Kernel、Binding Guard、tenant、workspace、dataClass、egress 或 provider scope 的硬拒绝。

## Pact 与外部服务的分界线

边界层：`external-service-compatibility`。

线内属于 Pact：adapter、mount、port、connector governance、secretRef、policy、Operation Ledger、Checkpoint 和 audit。线外属于外部系统：模型服务、知识库、代码平台、云盘、邮箱、协作系统、向量库、图数据库和 operator-provided module。

外部服务适配不能裸转发上游权限，也不能绕过 Tool Management、policy、Operation Ledger、Checkpoint Tree 和 audit。下游客户端也不直接调用这些外部服务；下游只通过 Pact 的 MCP / Workspace / Operation 入口访问受控能力。

`external.knowledge.distillation` 是线外远程容器服务，不是线内共享库。它的接口先由 Pact 上游网关和 Operation Scheduling Kernel 管控，再由服务自身执行 `pact.external-knowledge-distillation.service-gates.v1`：除 `/health` 和 `/v1/runtime/health` 外，业务 API 必须 bearer 鉴权；容器必须非 root、固定 Tika checksum、声明 healthcheck，且所有 token/key 来自外部配置或 secret store。

### 线内适配器

| 线内 Pact 适配器 | 责任 | 状态 |
| --- | --- | --- |
| `knowledge-backend-port` | 连接外部知识库空间、检索、证据读取、导出请求和权限请求 | Dify、RAGFlow 为 `contract-mode`，真实接通取决于 secretRef 和 live verifier |
| `external-knowledge-base` mount | 将 KnowledgeCore 记录镜像到外部知识后端 | Qdrant、OpenSearch、pgvector 为 operator-configured optional mount |
| `vectorStore` mount | 将 chunk 同步到外部向量索引并执行相似度查询 | sqlite-vec / local fallback 有本地路径，LanceDB 为外部适配入口 |
| `graphStore` mount | 将实体和边同步到外部图索引 | 当前主要是 mount/template 能力，不应宣称已有完整内置 provider |
| Agent Gateway / Model Probe | 统一探测和调用模型 provider、企业代理或自定义 HTTP 模型端点 | 多 provider 运行路径，具体可用性取决于模型配置和凭据 |
| Codespace / repo operations / code review | 抽象仓库读写、diff、提交、push、review、merge、submit 等代码协作操作 | GitHub、Gerrit 为配置化 provider；GitLab 在 repo operation provider 集合中 |
| Cloud Drive Port | 管理云盘连接、列表、权限、下载、上传和同步计划 | v0.0.1 scope 为 iCloud + OneDrive 本机目录 projection；OAuth / Remote live adapter 是后续目标；Google Drive、Dropbox 暂为 contract-mode |
| Data Connector Governance | 规范外部数据源 connector 的 auth、sync、cursor、mirror、本地查询和卸载策略 | Gmail、Outlook、Google Drive、OneDrive、Slack、Teams、macOS Mail 等通过 feature/client module 暴露 |
| Module Ecosystem | 给外部团队生成 parser、analysis、knowledgeBase、vectorStore、graphStore、customMount、Tool Package、Skill Package 的模板和 contract test | scaffold/template |
| Agent Exploration Runtime | 通过 allowlist 约束的 HTTP request 和 local command 接入特定外部端点或本地命令 | 运行路径，受 allowlist 和权限控制 |
| Local Secret Store | 用 secretRef / endpointRef 连接 provider 凭据，不把原始 token 写入 manifest | GitHub、Gerrit、Dify、RAGFlow、OneDrive、Google Drive、Dropbox 等 provider |

### 线外外部服务

| 服务域 | 当前列入支持或适配范围的外部服务 |
| --- | --- |
| 模型服务 | DeepSeek、Google Gemini、OpenRouter、Copilot / enterprise proxy、OpenAI / ChatGPT Codex OAuth、OpenAI-compatible local model、custom HTTP model |
| 外部知识库 / RAG | Dify、RAGFlow、Qdrant、OpenSearch、pgvector |
| 向量 / 图存储 | LanceDB、外部 graph database；graph database 当前以 `graphStore` mount/template 预留 |
| 代码仓库 / 评审 | GitHub、Gerrit、GitLab、Git remote |
| 云盘 / 共享文件 | iCloud Drive、OneDrive、Google Drive、Dropbox |
| 邮箱 / 协作 / 数据源 | Gmail、Outlook Mail、Slack、Teams、macOS Mail、本地文件、knowledge mirror |
| 通用外部端点 | allowlisted HTTP service、allowlisted local command、operator-provided module |

## Pact 与下游客户端的分界线

边界层：`agent-client-mcp-compatibility`。

线内属于 Pact：MCP HTTP endpoint、stdio proxy、设备级 discovery、handshake、grant/token、MCP toolset、connector release、client runtime bootstrap 和可选 traffic gateway ingress。线外属于下游客户端：本机智能体 CLI、编辑器/IDE agent、脚本型 agent、人工 CLI 和其它 MCP client。

Pact MCP service 是 Workspace API 的设备级协议适配器，不是 agent-to-agent gateway。客户端只能拿到经 grant、policy 和 tool boundary 约束后的 Pact 能力。

### 线内 MCP 服务网关

| 线内网关组件 | 责任 | 状态 |
| --- | --- | --- |
| HTTP MCP endpoint | 通过 `POST /mcp` 接收 MCP JSON-RPC；支持 `GET /mcp` SSE 时推送事件 | 权威服务入口 |
| MCP categorized tools | 暴露 `pact.discovery`、`pact.knowledge`、`pact.sharedspace`、`pact.codespace`、`pact.skillHub` | 稳定 toolset |
| stdio proxy | 兼容不支持 HTTP MCP 或自定义 header 的本地 agent，只转发到 HTTP MCP | 兼容入口，不维护业务状态 |
| Device discovery | 发布 `~/.pact/mcp/servers.json`、`/.well-known/pact/mcp.json`、`/api/mcp/discovery` | 设备级发现面 |
| MCP handshake | 通过 `/api/mcp/handshake` 返回 server identity、endpoint、interface version、toolset version 和签名 | connector 信任 discovery URL 前必须验证 |
| Grant / token auth | 支持 `X-Pact-Api-Key` 和 `Authorization: Bearer <PACT_MCP_TOKEN>` | 每 agent 独立权限和审计 |
| `pact-mcp-connector` | 作为独立 release 包提供 install、register、discover、doctor、server-config 等客户端侧操作 | 不包含服务端 runtime、SQLite、KnowledgeCore 或 UI |
| Client runtime bootstrap | 按客户端能力裁剪 local bridge、transport fallback、upload path 等运行计划 | 客户端兼容层 |
| Agent traffic gateway ingress | 可选放在 Caddy / Nginx 后，代理 MCP、HTTP API、upload session、client runtime bootstrap | 可拆卸入口；direct mode 必须可用 |

### 线外客户端支持列表

| 下游客户端 | 支持口径 |
| --- | --- |
| OpenClaw | connector install target；支持 VM / remote 环境中的目标原生 MCP 配置 |
| Claude Code | connector install target；CLI-backed MCP 配置 |
| Codex | connector install target；Codex 使用 bearer token env var 路径 |
| Gemini CLI | connector install target |
| Antigravity | connector install target |
| OpenCode | connector install target |
| Copilot | connector install target |
| Kilo Code | connector install target |
| Cursor | connector install target |
| Hermes Agent | connector install target；支持 VM / remote 环境中的目标原生 MCP 配置 |
| Windsurf | connector install target |
| 脚本型 agent、人工 CLI | 通过 Workspace API / MCP 协议入口接入；不等同于 connector install target |

## 统一 API 注册切面设计稿

统一 API 注册切面负责把平台内部 API、外部服务 API 和 adapter 暴露的 API 统一登记为安全内核可识别的 Capability。注册只表达“这个 API 存在、如何调用、属于谁、有什么风险和权限语义”；纳管表达“安全内核是否已经为它配置治理策略、授权关系和可授予状态”。两者必须分离：只要 API 已注册，就必须进入管控台 API 列表，即使它尚未被安全内核纳管。

### 设计目标

- 所有跨边界调用面都进入同一个 API Registry，包括平台服务 API、外部服务 API、adapter/port/mount API、Tool Management 包装 API 和 MCP/Workspace 可见 API。
- 每个已注册 API 都能稳定映射到一个 Capability，默认形态为 `cap:api:<apiId>`；现有 `apiCapabilityId(operation.id)` 继续作为平台 API 的规范生成方式。
- HTTP、RPC、CLI 是同一 API 的 transport 投影，而不是三份权限对象。内部平台 API 优先保持 HTTP/RPC/CLI 三面一致；外部远程服务 API 只需要声明真实可用的 HTTP 和 RPC，或者其中之一，CLI 不作为必填项。
- API Registry 是安全内核的 Capability manifest 输入源，但注册不自动授权、不自动可授予、不自动进入 toolset。安全内核只基于已注册 Capability 进行权限配置、裁决、审计和未知 Capability 拒绝。
- 管控台新增 `API 列表`，展示所有已注册 API。列表必须同时展示 `注册状态` 和 `纳管状态`，不能因为 API 未纳管而隐藏它。

### 概念边界

| 概念 | 责任 | 不是 |
| --- | --- | --- |
| API Registry | 登记 API 的身份、调用 transport、来源、风险、权限语义、Capability 映射和生命周期。 | 不是授权结果，也不保存 provider secret value。 |
| Capability Kernel | 消费 API Registry 的 Capability manifest，对 subject/grant/policy 做 allow/deny/needsApproval 裁决。 | 不维护 HTTP path、provider SDK 细节或 UI 展示排序。 |
| Tool Catalog | 面向智能体的工具目录，可包装一个或多个 API，并有自己的 `cap:tool:<toolId>:execute`。 | 不是 API 的唯一事实源。 |
| `system.interfaces` | 当前平台操作注册表的接口投影，偏 HTTP/RPC/CLI 调用清单。 | 不等同于完整 API Registry，后者还包含外部 API、纳管状态和 Capability 状态。 |
| 外部 provider manifest | 外部服务或 mount 声明 provider API、scope、secretRef 需求、readiness 和 contract 状态。 | 不得绕过 Pact adapter、policy、audit 和状态语义直接放行。 |

### API 描述模型

API Registry 的规范记录建议使用 `pact.api-registry.v1`：

| 字段 | 说明 |
| --- | --- |
| `apiId` | 稳定 ID。平台 API 复用 `operation.id`，外部服务 API 使用 `external.<serviceId>.<operation>` 或 `<adapterId>.<provider>.<operation>`。 |
| `label` / `description` | 管控台展示名称和边界说明。 |
| `sourceKind` | `platform-service`、`external-service`、`adapter`、`mount`、`tool-management`、`mcp-gateway`。 |
| `owner` | 负责该 API 的平台模块、adapter、mount、provider 或外部服务。 |
| `domain` | `system`、`knowledge`、`repo`、`drive`、`model`、`tool_management`、`storage` 等业务域。 |
| `transports` | 支持的调用方式列表。元素包含 `kind=http|rpc|cli|webhook`、`method`、`path`、`rpcMethod`、`command`、`implemented`、`required`、`notes`。 |
| `target` | 平台 controller/method、adapter operation、provider method 或 mount operation。 |
| `security` | `requiredScopes`、`requiredCapabilities`、`risk`、`approvalScope`、`providerScopes`、`dataClasses`、`requestedEgress`、`sideEffects`、`credentialPolicy`。 |
| `capability` | `capabilityId`、`grantable`、`managed`、`aliases`、`derivedFrom`。注册后即可生成 capabilityId，但 `grantable=false` 直到纳管策略允许授予。 |
| `readiness` | `registered`、`wired`、`implemented`、`contractVerified`、`realE2EVerified`、`productionReady`、`deprecated`。 |
| `governance` | `state=unmanaged|managed|disabled|pending|denied`、`policyRefs`、`lastDecisionAt`、`missingControls`。 |
| `evidence` | source file、module manifest、verifier、lastVerifiedAt、contract test receipt、provider receipt。 |

最小注册记录必须包含 `apiId`、`sourceKind`、`owner`、至少一个 `transports`、`security.risk`、`capability.capabilityId` 和 `governance.state`。没有真实 secret 的外部 API 只能登记 `credentialPolicy.secretRefRequired=true` 或 `endpointRefRequired=true`，不得登记明文凭据。

### 注册来源

| 来源 | 进入 API Registry 的方式 | 备注 |
| --- | --- | --- |
| `SERVER_API_OPERATIONS` | 通过 platform operation adapter 转成 API record。 | 现有 HTTP/RPC/CLI 定义、scope、risk、audit、inputSchema 直接成为平台 API 投影。 |
| `PROTOCOL_OPERATION_DEFINITIONS` | 作为平台协议 API 的子集进入 Registry。 | 继续由 `server:verify:protocol-operations` 保护。 |
| Tool Management catalog | 只登记工具包装出的 API 关系，不替代底层 API。 | 工具仍有 `cap:tool:<toolId>:execute`。 |
| 外部服务 adapter/port | adapter manifest 或 provider manifest 声明 `apis`。 | 例如 knowledge backend、model gateway、repo/code review、cloud drive、data connector。 |
| mount/module ecosystem | `module.json` 或 contract test 输出声明可注册 API。 | scaffold/template 必须标记 `readiness=scaffold` 或 `contractVerified`，不能标成生产可用。 |
| 动态 discovery | 运行时发现的 provider API 可登记为 `discovered`。 | 默认 `governance.state=unmanaged`、`grantable=false`，直到 operator 确认。 |

### 注册流程

```text
source registry / manifest / discovery
  -> ApiRegistrationCollector
  -> ApiRegistrationNormalizer
  -> ApiRegistrationValidator
  -> CapabilityManifestBuilder
  -> SecurityKernel Capability Universe
  -> Console API List Projection
```

1. `Collector` 从平台 operation registry、外部 adapter manifest、mount manifest、Tool Catalog 和动态 discovery 收集原始 API。
2. `Normalizer` 生成统一 `apiId`、transport 投影、风险字段、provider scope 映射和 capabilityId。
3. `Validator` 校验 transport、secretRef、scope、risk、readiness、source anchor 和重复 ID。
4. `CapabilityManifestBuilder` 输出安全内核可消费的 Capability universe：所有已注册 API 都进入已知 Capability 集合，但未纳管 API 标记 `managed=false`、`grantable=false`。
5. 安全内核基于该 manifest 做权限配置和裁决。未知 Capability 一律拒绝；已注册但未纳管 Capability 可以展示、审计和申请纳管，但不能被普通 grant 放行。
6. 管控台读取 API List projection，显示所有注册 API 和纳管状态。

### Transport 规则

- 内部平台 API：如果面向客户端或 operator，默认要求 HTTP、RPC、CLI 三个 transport 都有注册项。确实不需要 CLI 的 API 必须写 `transportException.reason`，并由 verifier 报出为可审查例外。
- 外部远程服务 API：允许只实现 HTTP、RPC 或两者。CLI 只是 operator 工具投影，不是外部服务 API 的达标条件。
- Webhook/callback：作为 `kind=webhook` transport 登记，但它表示外部服务回调进入 Pact，不替代 Pact 主动调用的 HTTP/RPC API。
- MCP tool：作为下游客户端调用投影登记到关联关系中，底层 Capability 仍区分 `cap:api:*` 和 `cap:tool:*`。
- 同一个 `apiId` 可以有多个 transport，但只能有一个 canonical Capability。transport 变化不应导致 Capability ID 变化。

### Capability 映射规则

| API 类型 | Capability ID | 纳管口径 |
| --- | --- | --- |
| 平台 Operation API | `cap:api:<operation.id>` | 现有 `KERNEL_API_OPERATION_IDS` 迁移为 Registry 生成或校验产物。 |
| 外部服务 API | `cap:api:<apiId>` | 注册后已知，默认未纳管、不可授予；纳管后才能进入策略和 grant。 |
| Adapter API | `cap:api:<adapterId>.<operation>` | adapter 对 provider scope 和 Pact capability 做一对一或一对多映射。 |
| Tool API 包装 | `cap:tool:<toolId>:execute` + 关联的 `cap:api:<apiId>` | tool 执行权限不自动等于底层外部 API 权限；策略可要求二者同时满足。 |
| 管控台 API 列表 | `cap:api:api_registry.apis.list` | 默认需要 `console:read` 或后续专用 `api_registry:read`。 |

安全内核的 grant 只存 Capability，不存 HTTP path、RPC method 或 provider secret。scope 继续保留为兼容和分组维度，但新的强约束应优先使用 Capability。

### API 列表页面

管控台新增管理页面 `API 列表`，建议路径为 `/admin/api-list`。列表读取 `GET /api/api-registry/apis`，同一能力提供 RPC `api_registry.apis.list` 和 CLI `api-registry apis`，用于满足统一 API 层自己的 HTTP/RPC/CLI 投影。

列表字段：

| 列 | 内容 |
| --- | --- |
| API | `label`、`apiId`、描述和来源文件。 |
| 来源 | `platform-service`、`external-service`、`adapter`、`mount`、`tool-management`。 |
| 所属服务 | owner、provider、adapter 或模块名。 |
| 调用方式 | HTTP/RPC/CLI/Webhook tag；缺失项显示原因，不隐藏。 |
| Capability | `capabilityId`、`grantable`、`managed`。 |
| 权限语义 | required scopes、provider scopes、risk、approval scope、egress/dataClass。 |
| 注册状态 | registered/wired/implemented/contractVerified/realE2EVerified/productionReady/deprecated。 |
| 纳管状态 | unmanaged/managed/disabled/pending/denied。 |
| 验证证据 | lastVerifiedAt、verifier、contract receipt 或 provider receipt。 |

筛选项：来源、业务域、外部服务、transport、风险、注册状态、纳管状态、是否可授予、是否存在 transport 例外。详情抽屉展示完整 JSON、transport 路由、provider scope 映射、相关 tool、相关 grant、最近拒绝原因和 source anchors。

### 与现有代码的落点

- `server/platform/common/operation-dispatcher/operation-registry.mjs`：继续作为平台 API 的主要注册来源。
- `server/platform/common/platform-core/core-platform-provider.mjs`：当前 `buildSystemInterfaces()` 可成为 API Registry 平台来源 adapter。
- `server/platform/common/security/authorization/authorization-engine.mjs`：`apiCapabilityId()` 保持规范；`KERNEL_API_OPERATION_IDS` 后续改成由 Registry verifier 生成或双向校验。
- `server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs`：Tool Catalog 增加 `apiIds` 关联，不作为 API Registry 主事实源。
- `server/platform/common/devops/unified-registration-core/unified-registration.mjs`：保留系统状态统一注册；API Registry 不复用 `process/queue/task/monitor/alert` 的运行状态 bucket，避免 API 列表和运行状态混淆。
- `server-web/views/admin/ToolsView.vue`：工具列表继续展示 tool；新增 API 列表展示 API。两者可以通过 `operationId/apiId` 互链。

### 验证门禁

- `server:verify:api-registration`：校验 API Registry schema、重复 ID、transport 合法性、secretRef 安全、risk/scope/capability 完整性。
- `server:verify:authorization-capabilities`：校验所有已注册 API 都能映射到已知 Capability，未知 Capability 被拒绝，未纳管 API 不可被普通 grant 放行。
- `server:verify:protocol-operation-registration`：继续校验平台 operation 的 HTTP/RPC/CLI 注册一致性。
- `server:verify:tool-management`：校验 tool 到 apiId 的引用存在，tool capability 和 API capability 不混用。
- `client:verify` 或前端 smoke：校验 `API 列表` 能显示已注册但未纳管 API，且筛选不会把 unmanaged API 当成 missing。

### 分阶段落地

1. 文档和 schema：固定 `pact.api-registry.v1` 字段、Capability 映射、transport 例外口径。
2. 平台来源 adapter：把 `SERVER_API_OPERATIONS` 转成 API Registry projection，并保持 `/api/interfaces` 兼容。
3. 安全内核对接：让 Capability universe 从 API Registry projection 生成或被 verifier 强制校验。
4. 外部服务 manifest：给 knowledge/model/repo/drive/data connector/mount 增加 `apis` 声明。
5. 管控台 API 列表：新增页面、桥接 API、筛选、详情抽屉和 tool/API 互链。
6. 纳管操作闭环：在 API 详情中加入申请纳管、禁用、策略绑定和 grantable 开关，但不把这些操作混入注册流程。

### 待确认问题

- 外部 provider 原生 API 是否需要和 Pact adapter API 同时显示？本设计建议同时显示，并用 parent/child 关系说明 “provider 原生能力” 和 “Pact 受控 adapter 能力” 的区别。
- RPC 的命名是否只指 Pact JSON-RPC，还是也要覆盖 provider 的 gRPC/JSON-RPC？本设计建议 transport 用 `kind=rpc`，再用 `protocol=json-rpc|grpc|provider-rpc` 细分。
- 未纳管 API 是否进入安全内核已知 Capability 集合但 `grantable=false`？本设计建议进入，原因是这样管控台能展示、申请纳管，安全内核也能明确拒绝未知和未纳管的差异。

## Source anchors

- 兼容层定义：`docs/PROTOCOLS.md` 的 `Compatibility Strategy`。
- Device MCP Hub：`docs/PROTOCOLS.md` 的 `Device MCP Hub`。
- MCP toolset：`server/platform/common/mcp/http-mcp-adapter.mjs`。
- MCP connector targets：`mcp-connector/bin/pact-mcp.mjs`。
- mount 名称与模板：`server/platform/common/module-manager/mount-config.mjs`、`server/platform/common/module-manager/module-ecosystem/index.mjs`。
- 知识库适配：`server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs`、`server/platform/specialized/knowledge/storage/external-knowledge-base/module.json`。
- 模型适配：`server/platform/specialized/agent/agent-gateway/model-probe/index.mjs`。
- 云盘适配：`server/platform/specialized/agent/cloud-drive-port/index.mjs`。
- 代码平台适配：`server/platform/specialized/capabilities/code-management/codespace/index.mjs`、`server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs`。
- 数据连接器：`server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs`、`server/platform/interactive/features/feature-manifest.mjs`。
- secret provider：`server/platform/common/security/secrets/local-secret-store.mjs`。
- traffic gateway：`server/platform/specialized/capabilities/agent-ingress/traffic-gateway/module.json`。
