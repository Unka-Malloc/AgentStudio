# Client Desktop

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Flutter desktop client, Rust sidecar, local runtime, target adapters, MCP plugins, Skill Hub, model forwarding, mobile relay, activity, snapshots, and settings.
- Staleness check: Checked against `client-gui/lib/src/`, `client-cli/src/`, `client-gui/packaging.modules.json`, client scripts, and client tests on 2026-06-16.

## 模块边界

客户端是本机环境管理器。Flutter 负责展示和控制器，Rust `pact-client` 负责本机能力和 portable state。客户端不实现自治 agent loop、权限代理或服务端知识分析；本机 Source Queue、connector host、Knowledge Cache mirror、Mail scope handoff 和 MCP local bridge 只作为受控 sidecar 能力存在，服务端仍拥有治理与权威状态。

## 功能项 CL-01 Agents

| 项 | 设计 |
| --- | --- |
| 目标 | 发现和展示 OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent。 |
| 输入 | 已知路径、手动路径、目标配置文件、CLI probe、native history roots。 |
| 处理 | `pact-client` 目标 adapter 负责解析与探测，Flutter 渲染 target card。 |
| 输出 | target state、adapter capability、manual add result、配置建议。 |
| 错误 | 被动发现不启动 GUI app、不触发 login/keychain prompt、不全盘扫描 home。 |
| 验证 | `npm run client:verify:targets`。 |

## 功能项 CL-02 MCP Plugins

| 项 | 设计 |
| --- | --- |
| 目标 | 将 Pact MCP 作为 peer plugin 配置到目标智能体。 |
| 输入 | target、base URL、token、config path、discovery file、state root。 |
| 处理 | `mcp config plan/apply/rollback` 只修改 Pact-managed 区块并创建 snapshot。 |
| 输出 | plan、applied config、snapshot id、rollback result、plugin status。 |
| 错误 | endpoint 未验证或 trust receipt 不匹配时禁止 apply，除非显式 dev override。 |
| 验证 | `npm run client:verify:mcp-plugins`, `npm run client:verify:mcp-opencode-connector`。 |

## 功能项 CL-03 Skill Hub

| 项 | 设计 |
| --- | --- |
| 目标 | 提供被动本地 Skill 仓库、目标配对、可见性、隐藏和版本 pin。 |
| 输入 | pair request/approve/revoke/list、skill list/get、visibility、pin。 |
| 处理 | 未配对目标默认看不到技能；deny-by-default 时需要显式 reveal。 |
| 输出 | skill list、skill detail、pairing status、activity record。 |
| 错误 | Skill Hub 不执行技能脚本，不复制技能到 agent workspace。 |
| 验证 | `npm run client:verify:pairing-skill-cli`。 |

## 功能项 CL-04 Model Forwarding

| 项 | 设计 |
| --- | --- |
| 目标 | 管理薄模型转发 profile，转发请求而不构建 agent harness。 |
| 输入 | profile id、command/url、args、api key、timeout、request text。 |
| 处理 | sidecar 保存脱敏 profile，执行一次薄调用并返回结果。 |
| 输出 | profile list、forwarding result、activity。 |
| 错误 | 不保存 planner、tool chooser、memory 或隐藏 scratchpad 字段。 |
| 验证 | `npm run client:verify:thin-forwarding`。 |

## 功能项 CL-05 Mobile Relay

| 项 | 设计 |
| --- | --- |
| 目标 | 手机通过 relay gateway 与 PC 客户端配对，请求白名单本机命令。 |
| 输入 | gateway config、pairing code、mobile token、PC check-in、commands poll/sync/complete/result。 |
| 处理 | PC 端只执行 `agent.sessions.list` 和 `agent.message.send` 等白名单命令。 |
| 输出 | pairing status、command result、mobile relay activity。 |
| 错误 | gateway 不执行本机动作；payload 不允许携带自定义本机 runtime command。 |
| 验证 | `npm run server:verify:mobile-relay`, `npm run client:native:test`。 |

## 功能项 CL-06 Native History

| 项 | 设计 |
| --- | --- |
| 目标 | 只读导入各目标智能体原生会话历史。 |
| 输入 | `pact-client conversations list --agent AGENT` 和可选 history root。 |
| 处理 | 每个一等目标有专用 adapter，共享解析工具必须藏在目标 adapter 后。 |
| 输出 | `native-history` JSON、sessions、messages、adapter id、source path。 |
| 错误 | `append` 和 `delete` 必须拒绝；不创建 Pact-local conversation database。 |
| 验证 | `cargo test --manifest-path client-cli/Cargo.toml conversations`。 |

## 功能项 CL-07 Local Runtime

| 项 | 设计 |
| --- | --- |
| 目标 | 从本机 Pact 源码构建并托管 minimal client-local 服务端 runtime。 |
| 输入 | source root、preset config、port、runtime config、claim token。 |
| 处理 | `local-runtime ensure` 生成 runtime config、启动服务、健康检查并执行 process identity claim。 |
| 输出 | status、logs、pid、server URL、identity status。 |
| 错误 | 必须显式传入 preset config；claim token 不写入 JSON config。 |
| 验证 | `npm run server:verify:client-local-runtime-profile`, `npm run client:native:test`。 |

## 功能项 CL-08 Activity And Snapshots

| 项 | 设计 |
| --- | --- |
| 目标 | 记录配置写入、Skill 变化、MCP apply/rollback、relay、runtime 和状态快照。 |
| 输入 | sidecar operation result、GUI action、state store update。 |
| 处理 | portable data 写入 activity 和 snapshot，GUI 渲染历史。 |
| 输出 | activity list、snapshot list、rollback target。 |
| 错误 | snapshot 不能包含 token 明文。 |
| 验证 | `npm run client:verify:state-store`。 |

## 功能项 CL-09 Settings

| 项 | 设计 |
| --- | --- |
| 目标 | 管理服务端地址、已知路径、手动目标、本机仓库位置、偏好和外观。 |
| 输入 | GUI settings、portable data、appearance preset。 |
| 处理 | Flutter 控制器更新 portable state；sidecar 使用同一数据目录。 |
| 输出 | settings JSON、UI state、theme preference。 |
| 错误 | GUI 不直接写服务端 runtime secret。 |
| 验证 | `npm run client:test`, `npm run client:verify:config-writes`。 |

## 功能项 CL-10 Source Queue And Connectors

| 项 | 设计 |
| --- | --- |
| 目标 | 用 Rust sidecar 管理本机 source item 队列、恢复提交、connector enqueue 和 upload-queue 兼容命名。 |
| 输入 | `source-queue add|list|status|pause|resume|retry|cancel|drain`, `connectors list|sync|status|mirror inspect`。 |
| 处理 | Source Queue 使用 SQLite 保存状态、JSONL 保存 audit；local directory、iCloud local projection、OneDrive local projection 输出统一进入队列。 |
| 输出 | 队列 item、connector mirror、upload session/job handoff。 |
| 错误 | 无 server URL 时 drain 只 defer；mail scope 未物化时不冒充已上传。 |
| 验证 | `cargo test --manifest-path client-cli/Cargo.toml`, `npm run client:verify:architecture`。 |

## 功能项 CL-11 Cache, Mail, And Local Bridge

| 项 | 设计 |
| --- | --- |
| 目标 | 提供 KnowledgeCore 授权 mirror、本机 Mail 显式 scope preview/export/handoff，以及 ServiceHub 可注册的 loopback MCP HTTP bridge plan。 |
| 输入 | `knowledge-cache sync|search|evidence|get|status`, `mail preview|enqueue|status|cancel`, `mcp-local-bridge plan|start|stop|status|register`。 |
| 处理 | Knowledge Cache 是 `authoritative=false` mirror；Mail 由 `pact-mail-helper` Swift sidecar 访问 macOS Mail，要求 mailbox/date/query 显式 scope，先 preview/stats，再把选中邮件物化为 `.eml` 和 `manifest.tsv` 后 enqueue；MCP bridge 只通过 client-local-runtime HTTP endpoint 暴露。 |
| 输出 | FTS search result、Mail export directory、Mail source queue item、ServiceHub registration draft。 |
| 错误 | 客户端不能声称离线 KnowledgeCore；ServiceHub 不直接启动本机 stdio。 |
| 验证 | `cargo test --manifest-path client-cli/Cargo.toml`, `xcrun swiftc -parse-as-library client-gui/macos/MailHelper/PactMailHelper.swift`, `npm run server:verify:security-local-stdio-lockdown`。 |
