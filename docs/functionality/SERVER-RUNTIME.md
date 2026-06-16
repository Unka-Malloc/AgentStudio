# Server Runtime And Console

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Server runtime, configuration, console, module mounting, service discovery, and runtime dependencies.
- Staleness check: Checked against `server/scripts/start-server.mjs`, `server/services/server-runtime/http-server.mjs`, `server/platform/common/config/ServerConfig.mjs`, `server/platform/common/platform-core/settings.mjs`, `server-web/`, and package scripts on 2026-06-16.

## 模块边界

本模块负责服务端进程启动、运行时配置、HTTP/API 发布、Server Console、运行时依赖、mount 模块、服务发现和基础设置。业务任务、知识处理、工作空间、外部服务和安全策略由对应模块拥有。

## 功能项 SR-01 启动与部署模式

| 项 | 设计 |
| --- | --- |
| 目标 | 支持本机开发、Docker、本机 HMR、公开监听、minimal profile 和 client-local runtime。 |
| 输入 | CLI 参数、环境变量、runtime config、composition preset、feature profile。 |
| 处理 | `start-server.mjs` 解析参数后创建 server runtime providers，按 profile/edition 装配模块。 |
| 输出 | HTTP 服务、控制台静态资源、健康检查、bootstrap、interfaces 和 console state。 |
| 错误 | runtime config 缺失、端口冲突、profile 不匹配、依赖缺失时 fail closed。 |
| 验证 | `npm run server:verify:headless`, `npm run server:verify:client-local-runtime-profile`。 |

## 功能项 SR-02 配置与设置

| 项 | 设计 |
| --- | --- |
| 目标 | 统一服务端默认设置、运行态设置和控制台保存行为。 |
| 输入 | `settings.json`、`PACT_*` 环境变量、控制台表单、CLI/RPC 请求。 |
| 处理 | 默认值在 `settings.mjs`，标准数据目录来源是 `ServerConfig.getDataDir()`；保存通过 settings operations。 |
| 输出 | 脱敏配置、模型/OCR/Tika/cloud parsing/mount 相关设置。 |
| 错误 | secret-like 值不得进入文档、控制台输出或普通日志。 |
| 验证 | `npm run server:verify:core-platform`, `npm run server:verify:privacy-placeholders`。 |

## 功能项 SR-03 Server Console

| 项 | 设计 |
| --- | --- |
| 目标 | 提供受控运维、知识、工作空间、工具、授权和外部服务控制台。 |
| 输入 | Console auth session、`/api/*` 请求、运行时事件和 domain operation 结果。 |
| 处理 | `server-web` 只调用公开 API；`system-controller` 和 domain handlers 负责请求归一化与 operation dispatch。 |
| 输出 | 控制台页面、数据表、配置面板、证据预览、运行态状态和操作反馈。 |
| 错误 | UI 不得直接导入服务端内部模块，不得绕过 RBAC 或 operation audit。 |
| 验证 | `npm run server:verify:frontend-typecheck`, `npm run server:verify:frontend-architecture`。 |

## 功能项 SR-04 Mount 模块管理

| 项 | 设计 |
| --- | --- |
| 目标 | 管理 documentParser、ocr、multimodalParser、analysis、knowledgeBase、vectorStore、graphStore 等 mount。 |
| 输入 | `.pact-server-data/mount-modules.json`、`mount-routing.json`、控制台模块配置。 |
| 处理 | module manager 装配、reload、route resolution 和 module contract test。 |
| 输出 | 当前 mount 状态、路由结果、热加载结果、合同测试结果。 |
| 错误 | 不合格 module 不能注册；secret 不写入 committed module 文件。 |
| 验证 | `npm run server:module:contract-test`, `npm run server:verify:module-ecosystem`。 |

## 功能项 SR-05 服务发现与客户端接入

| 项 | 设计 |
| --- | --- |
| 目标 | 向客户端发布 bootstrap、active service、discovery config 和迁移状态。 |
| 输入 | `/api/bootstrap`, `/api/discovery/check-in`, discovery config operations。 |
| 处理 | 服务端记录 check-in、active URL、forward mode、offline 判定和 migration 标记。 |
| 输出 | 客户端可消费的服务发现状态和迁移建议。 |
| 错误 | discovery URL 不得泄露私密 token；client-local 应固定 loopback 与 strict port。 |
| 验证 | `npm run server:verify:client-runtime-bootstrap`, `npm run server:verify:agent-client-support-targets`。 |

## 功能项 SR-06 运行时依赖下载

| 项 | 设计 |
| --- | --- |
| 目标 | 管理 JRE/Tika、runtime downloads、OCR、Gerrit local runtime 等可选依赖。 |
| 输入 | runtime dependency config、下载请求、checksum、容器/本机路径。 |
| 处理 | 依赖下载、校验、状态持久化和控制台反馈。 |
| 输出 | 依赖状态、配置结果、下载进度和失败原因。 |
| 错误 | checksum 或安全门禁失败时不得标记可用。 |
| 验证 | `npm run server:verify:runtime-dependency-downloads`, `npm run server:gerrit:smoke`。 |
