# Pact Server Platform Layout

`server/platform` follows `docs/Architecture.md` as the target boundary. Pact is workspace-state-first rather than agent-first: local agents, external knowledge bases, model gateways, tools, and skills are replaceable operators or adapters around the governed workspace asset state.

| Target layer | 中文名 | Module id | Current directory | Responsibility |
| --- | --- | --- | --- | --- |
| 基建层 | 核心能力 | `core` | `common/platform-core` | Discovery, settings, state coordination, common scheduling. |
| 基建层 | 安全权限 | `security` | `common/security` | Authentication, authorization, access control helpers, operation audit policy. |
| 基建层 | 模块管理 | `module-management` | `common/module-manager` | Mount configuration, routing, runtime snapshots, lazy module loading. |
| 基建层 | 数据结构 | `data-structure` | `common/data-structure` | Shared durable data structures such as checkpoint trees. |
| 基建层 | 平台适配 | `platform-adapter` | `common/platform-adapter` | OS and environmental adaptation, VM/container runtime bridging. |
| 基建层 | 资源管理 | `resource-management` | `common/resource-management` | Resource quotas, caching, local disk scheduling, and storage. |
| 基建层 | └─ 存储 | `storage` | `common/storage` | Metadata SQLite, raw object store, repositories, storage maintenance tools. |
| 基建层 | 运维基础 | `devops` | `common/devops` | Process status, monitor alerts, unified registration, diagnostics. |
| 服务层 | 接口封装层 | `interface-wrapper` | `common/operation-dispatcher` | HTTP / RPC / CLI operation registry and dispatch implementation. |
| 服务层 | 控制台 API | `console-api` | `common/console` | Console API controllers, response helpers, state facade. |
| 服务层 | 运行时装配 | `runtime-assembly` | `interactive` | Composition root, provider registry, feature profile resolution, product-facing call surface. |
| 应用层 / Knowledge | Knowledge | `knowledge` | `specialized/knowledge` | Raw corpus, knowledge index, knowledge distillation, and knowledge base mount. |
| 应用层 / Capabilities | Tools / Skills | `capabilities` | `specialized/capabilities` | Shared tool management, skill management, grants, profiles, audit, and policy. |
| 应用层 / Agent | Agent | `agent` | `specialized/agent` | Temporary context, team-shared workspace switching, memory, model gateway, config. |

## Access Rules

Management UI code calls the service layer only. Service code calls application and foundation capabilities through the runtime assembly / product API surfaces.

Foundation modules do not contain Knowledge or Agent business semantics. Application modules must not register themselves as foundation modules.

Security implementation files live under `common/security`; `common/platform-core` must not contain auth or security submodules.
