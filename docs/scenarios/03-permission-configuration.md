# Scenario 03: 权限配置

## Metadata / 元数据

- Last updated: 2026-06-08
- Status: Scenario draft with machine-readable status tracking
- Scope: Scenario 03: 权限配置.
- Staleness check: Scanned on 2026-06-08; scenario live/contract/local status must match docs/scenarios/scenario-implementation-status.json and the latest readiness reports.

状态：已确认场景草案

## 元数据

### 执行路线

```text
管控台权限入口 -> authorization governance operation -> 权限策略持久化 -> 上游 / 下游网关策略刷新 -> 智能体 MCP grant / key 权限投影刷新 -> 网关拦截验证 -> audit / trace / receipt
```

### 涉及模块

#### 接入层

- 管控台权限配置页。
- Frontend bridge、HTTP API 和 operation 调用入口。

#### 调度层

- Operation Registry / Dispatcher。
- Console Domain Operation Executor。
- 策略刷新、缓存失效和结果回执。

#### 安全治理层

- Console Auth、用户 / 团队 / 角色管理。
- Authorization Governance Store。
- Tool Management grant、MCP key / token 权限和风险策略。

#### 业务能力层

- 权限策略编辑、校验、版本化和持久化。
- 上游 / 下游网关策略同步。
- 智能体能力目录刷新和权限解释。

#### 数据与观测层

- 权限策略 store、grant store 和 approval store。
- 拦截记录、policy decision receipt。
- Audit、Trace、Report 和安全事件。

## 场景目标

用户从管控台入口更新权限配置。Pact 必须把配置变更持久化，并让上下游网关拦截策略和智能体 MCP 密钥权限刷新生效。MCP token/key 是持久身份凭据，不是权限配置缓存；系统重启必须从外部 server data dir 恢复 grant/key 状态，不能要求用户重新配置。

```text
管控台入口
-> authorization governance operation
-> 权限策略持久化
-> 上游 / 下游网关策略刷新
-> 智能体 MCP grant / key 权限投影刷新
-> 拦截验证
-> audit / trace / receipt
```

## 链路要求

- 管控台必须能配置用户、团队、智能体、智能体分组、tool grant、workspace 和外部服务权限。
- 权限更新必须生成可追溯的策略版本或 receipt。
- 上下游网关必须读取新的策略版本，不能继续用旧缓存放行。
- 智能体 MCP 密钥或 grant 的有效权限必须在配置变更后刷新，但 token/key 本身除显式撤销、过期或轮换外继续有效。
- 已连接智能体的下一次请求必须实时按最新 policy version、grant projection 和 gateway policy 裁决。
- MCP token/key/grant 必须持久化到外部 server data dir；服务重启后必须自动恢复，不得要求用户重新复制或重新配置 key。
- 项目目录内任何位置都不能保存真实 key、token、secret value、运行态配置、provider manifest、mount config、原始 agent history、真实邮件下载/导入目录或本地 Pact 数据目录；门禁必须扫描 `build/`、`docs/`、`tests/` 和源码目录等项目自有路径，发现 `.pact-agent-history`、`.pact-server-data`、`.splitall-server-data`、`build/server-data`、`build/local-data`、运行态 `settings.json`、provider manifest、mount config、`.sealing-key`、`csrf-hmac-secret.bin`、`.env`、私钥、service account、client secret 或 token 文件即失败。
- `permissions.updated` / tools list changed 通知用于刷新客户端可见能力；通知丢失时，服务端请求裁决仍必须读取最新策略，不能依赖客户端主动刷新才生效。
- 刷新失败时必须返回明确失败状态，不能静默成功。

## 验收口径

- 修改权限后，同一智能体 MCP 请求的放行 / 拒绝结果发生预期变化。
- 网关拦截记录能显示使用了新的策略版本。
- MCP grant / key 的权限解释能显示刷新后的 scope / toolset。
- 服务重启后，未撤销且未过期的既有 MCP token/key 仍可连接，不需要重新配置；其权限裁决继续使用最新策略。
- 普通权限变更不得强制 key rotation；rotation / revoke 必须是显式安全动作。
- `npm run repo:hygiene` 能拦截项目目录内任何本地数据目录、运行态配置、密钥文件或真实 secret 内容。
- 权限变更、刷新、拦截结果都能在 audit / trace 中查询。
