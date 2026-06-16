# Agent Collaboration

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Agent framework integration, ACP Relay, MCP compatibility, Agent Gateway, sessions, sync, model routing, and maintenance agent.
- Staleness check: Checked against Downstream Client Aspect, ACP Relay module manifest, agent workspace/session operations, agent gateway runtime, mobile relay operations, and agent verification scripts on 2026-06-16.

## 模块边界

本模块负责本地或远程智能体通过 Pact 访问工作空间、工具、知识和彼此委托的协作边界。Pact 不成为自治 agent，也不把一个智能体的权限原样转给另一个智能体。

## 功能项 AC-01 Downstream Client Aspect

| 项 | 设计 |
| --- | --- |
| 目标 | 统一面向智能体框架的 MCP 和 ACP adapter layer。 |
| 输入 | framework definitions、命令探测、配置路径、operator target registry。 |
| 处理 | 分别装配 MCP compatibility record 和 ACP relay participant record。 |
| 输出 | client discovery config、target descriptors、virtual agent descriptors 和 safe metadata。 |
| 错误 | command argv、env、tokens 和私有 endpoint 不暴露给 source agent。 |
| 验证 | `npm run server:verify:downstream-client-aspect`, `npm run server:verify:agent-client-support-targets`。 |

## 功能项 AC-02 ACP Agent Relay

| 项 | 设计 |
| --- | --- |
| 目标 | 让 source agent 通过 Pact 受控委托 target agent 完成一个 prompt turn。 |
| 输入 | virtual agent、target、source identity、workspace、prompt、permission callbacks。 |
| 处理 | Pact 作为 inbound ACP agent 和 outbound ACP client/CLI participant，中间执行 policy、routing、session、permission bridge 和 audit；native ACP adapter 采用 detect-and-use-if-present，未发现时跳过 native 适配；本机 source-facing proof harness 通过 loopback HTTP bridge 进入 Relay，不直接开放本机 stdio source hosting。 |
| 输出 | source-safe progress、accepted/completed/error/cancelled event、relay session 和 turn record。 |
| 错误 | fallback CLI 和 Agent API proxy 不能声称 native ACP；target permission request 不能直达 source；缺 initialize/session/prompt/resume-close proof refs 时 `nativeAcpTargetVerified` 必须保持 false，但不能阻断非 native proxy/fallback 路径。 |
| 验证 | `npm run server:verify:acp-agent-relay`, `npm run server:verify:acp-agent-relay-state-machine`, `node server/scripts/verify-acp-agent-relay-downstream-codex-acp-target.mjs`, `node server/scripts/verify-acp-agent-relay-codex-antigravity.mjs`。 |

## 功能项 AC-03 Agent Workspace 与 Sessions

| 项 | 设计 |
| --- | --- |
| 目标 | 管理 agent workspace、session、events、context、fork、compare、merge proposal 和 archive。 |
| 输入 | `/api/agent-workspaces/*`, `/api/agent-sessions/*`。 |
| 处理 | 会话事实进入 workspace projection 和 operation history；merge 先形成 proposal。 |
| 输出 | workspace list/detail、session list/detail、context、event append、compare/merge result。 |
| 错误 | session event 不能自动升级为 canonical decision。 |
| 验证 | `npm run server:verify:agent-workspace`, `npm run server:verify:agent-session-governance`。 |

## 功能项 AC-04 Agent Gateway 与模型路由

| 项 | 设计 |
| --- | --- |
| 目标 | 管理 agent gateway config、model call、model probe、model routing health 和策略。 |
| 输入 | settings、gateway config、model request、provider config。 |
| 处理 | gateway 只在授权边界内调用模型或外部 provider；model routing 不保存 secret 明文。 |
| 输出 | call result、model health、routing decision、audit。 |
| 错误 | provider token 不进入请求体示例、日志或文档。 |
| 验证 | `npm run server:verify:agent-gateway`, `npm run server:verify:model-routing`。 |

## 功能项 AC-05 Agent Sync 与事件

| 项 | 设计 |
| --- | --- |
| 目标 | 支持 agent-to-client 或 agent-to-console 的状态同步与事件订阅。 |
| 输入 | agent sync config、publish、subscribe、events cursor。 |
| 处理 | publish 通过 operation 和 scope 控制；subscribe 只返回授权 topic。 |
| 输出 | sync event、event stream、config snapshot。 |
| 错误 | 未授权 topic 不泄露存在性。 |
| 验证 | `npm run server:verify:agent-sync`。 |

## 功能项 AC-06 Maintenance Agent

| 项 | 设计 |
| --- | --- |
| 目标 | 为运维场景提供受控维护计划、工具执行和审批。 |
| 输入 | chat/run request、tool registry、approval decision、maintenance config。 |
| 处理 | planner 只能选择已注册维护工具；高风险步骤需要 approval。 |
| 输出 | run plan、step outputs、audit、approval state。 |
| 错误 | 维护 agent 不能拥有未注册的隐藏工具或绕过 operation dispatcher。 |
| 验证 | `npm run server:verify:maintenance-agent`, `npm run server:verify:maintenance-agent-compaction`。 |
