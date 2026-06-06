# Scenario 08: 操作审核

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Scenario draft with machine-readable status tracking
- Scope: Scenario 08: 操作审核.
- Staleness check: Scanned on 2026-06-06; scenario live/contract/local status must match docs/scenarios/scenario-implementation-status.json and the latest readiness reports.

状态：已确认场景草案

## 元数据

### 执行路线

```text
API / RPC / CLI / MCP / 管控台 / worker 请求 -> Operation Scheduling Kernel -> 高危行为识别 -> pending_operation -> /approval 统一审批 -> 审批通过后恢复原 operation -> 业务 operation 执行 -> 拒绝 / 超时 / 放行审计
```

### 涉及模块

#### 接入层

- Pact MCP 网关、HTTP API、RPC、CLI、管控台和 worker 入口。
- 独立 `/approval` 页面、审批流入口和 completion reply。

#### 调度层

- Operation Registry / Operation Scheduling Kernel。
- Approval operation executor。
- Pending request 挂起、恢复、超时和放行调度。

#### 安全治理层

- 高危行为识别、risk policy 和 operation policy。
- Authorization Governance approval store。
- 用户 / 管理员审批权限、撤销和过期策略。

#### 业务能力层

- 被拦截的原始 tool / operation / worker activity / provider side effect。
- `/approval` 统一审批流、审批项状态机和审批结果回写。
- 审批通过后的原请求恢复执行。

#### 数据与观测层

- Approval record、pending operation state 和 decision receipt。
- Audit、Trace、Report 和拒绝 / 超时记录。
- 智能体响应与管控台状态同步。

## 场景目标

任何受管入口进入 Pact 后，所有高危行为都必须在 Operation Scheduling Kernel 内被挂起为 `pending_operation`，并提交到独立 `/approval` 页面统一审批。审批通过后，Pact 才能恢复原 operation；拒绝、撤销或超时必须终止操作。

```text
API / RPC / CLI / MCP / 管控台 / worker 请求
-> Operation Scheduling Kernel
-> 高危行为识别
-> pending_operation
-> /approval 统一审批
-> 用户 / 管理员审批
-> 审批通过后恢复原 operation
-> 拒绝 / 超时 / 放行审计
```

## 链路要求

- 高危行为识别必须发生在 Operation Scheduling Kernel 内，不能等业务 provider 已执行后再补记。
- 审批项必须出现在 `/approval` 页面，包含主体、动作、目标、风险原因、权限上下文、原 operationId、traceId、idempotencyKey 和过期时间。
- 审批通过后必须恢复原始 operation，并保留原请求上下文。
- 审批只能满足人工确认 / 授权门槛，不能覆盖租户、workspace、dataClass、egress、provider scope、Capability Kernel 或 Binding Guard 的硬拒绝。
- 审批拒绝、过期、撤销必须阻止操作继续执行。
- 放行结果必须回写给原调用方；MCP 调用必须收到 `operation_reply`，控制台也必须可见。

## 验收口径

- 高危 MCP tool、控制台 repair 操作、CLI 写操作和 worker 外部副作用默认被拦截，不会直接执行。
- `/approval` 出现可审批的 pending item。
- 审批通过后，原 operation 继续执行并返回结果。
- 拒绝或超时后，智能体收到明确失败，业务副作用不发生。
- 拦截、审批、放行和拒绝均可在 audit / trace 中查询。
