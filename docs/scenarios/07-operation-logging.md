# Scenario 07: 日志记录

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Scenario draft with machine-readable status tracking
- Scope: Scenario 07: 日志记录.
- Staleness check: Scanned on 2026-06-11; scenario live/contract/local status must match docs/scenarios/scenario-implementation-status.json and the latest readiness reports.

状态：已确认场景草案

## 元数据

### 执行路线

```text
HTTP / RPC / CLI / MCP / 管控台 / 后台任务 -> Operation Scheduling Kernel -> 身份 / 权限 / 请求上下文 -> 账本 started / pending -> 业务执行 -> ledger / audit / trace / report 写入 -> 查询 / 导出 / 告警 / 回溯
```

### 涉及模块

#### 接入层

- HTTP API、RPC、CLI、MCP、管控台和后台任务入口。
- 统一 request / operation context 注入。

#### 调度层

- Operation Registry / Operation Scheduling Kernel。
- Console Domain Operation Executor。
- Background worker、job workflow 和队列运行时。

#### 安全治理层

- Console Auth、MCP grant 和主体解析。
- Authorization decision、risk policy 和 approval linkage。
- 敏感字段脱敏和 secret protection。

#### 业务能力层

- 所有注册 operation。
- 外部 provider 调用、runtime action、维护任务和系统配置变更。

#### 数据与观测层

- Operation Ledger。
- Audit store、Trace store、Report 和 metrics。
- Receipt、correlation ID、告警和导出。

## 场景目标

Pact 必须记录系统的所有操作，有一个算一个全都记下来。日志记录不是单独页面能力，而是所有 HTTP、RPC、CLI、MCP、管控台和后台任务的横切链路。真实操作只能由 Operation Scheduling Kernel 受理和调度；其它路径触发的动作一律拒绝为 unmanaged / not scheduled。

```text
HTTP / RPC / CLI / MCP / 管控台 / 后台任务
-> Operation Scheduling Kernel
-> 身份、权限与请求上下文
-> 账本 started / pending
-> 业务执行
-> ledger / audit / trace / report 写入
-> 查询、导出、告警和回溯
```

## 链路要求

- 所有 operation 必须先进入 Operation Scheduling Kernel，并记录入口、主体、目标、结果、耗时、风险、权限裁决和错误摘要。
- Operation Registry 只是目录和合同，不是执行许可；HTTP / RPC / CLI / MCP / 控制台 / worker 只能提交 intent envelope，不能直接调用业务 executor。
- 未被调度内核 accepted 的业务执行、provider side effect、状态写入和工具调用必须拒绝，不能产生真实副作用。
- 高危行为必须能关联审批记录。
- 外部系统调用必须能关联 provider receipt。
- 后台任务、队列任务、重试、补偿、失败恢复也必须记录。
- 日志记录必须避免泄露密钥、token、密码和敏感正文。

## 验收口径

- 任意可注册 operation 执行前，都能查到调度内核 accepted / rejected 记录；执行后能查到 audit 或 ledger 记录。
- 成功、失败、拒绝、审批中、审批放行都能区分。
- 同一请求的 trace、audit、receipt 和 report 能通过 correlation ID 对齐。
- 日志导出不包含敏感密钥明文。
- 绕过 Operation Scheduling Kernel 的测试操作必须返回 `operation_unmanaged` / `operation_not_scheduled`，且不能改变状态或调用 provider。
