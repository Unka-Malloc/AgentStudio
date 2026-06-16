# Security Authorization And Identity

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Console auth, authorization governance, capability keys, binding guard, process identity, secrets, risk policy, audit, and local stdio lockdown.
- Staleness check: Checked against auth handlers, authorization engine, process identity handlers, security modules, Tool Management grant behavior, and security verification scripts on 2026-06-16.

## 模块边界

本模块负责身份、认证、授权、密钥、权限绑定、风险策略、审计和安全门禁。它不拥有业务数据，但为所有模块提供统一安全裁决。

## 功能项 SA-01 Console Auth

| 项 | 设计 |
| --- | --- |
| 目标 | 控制台登录、登出、session、用户、角色、OIDC、session rotate/revoke 和 auth audit。 |
| 输入 | username/password、OIDC config、session cookie、admin action。 |
| 处理 | auth handler 生成 session，RBAC 控制控制台 API。 |
| 输出 | session state、user list、role policy、audit/export/retention。 |
| 错误 | auth audit export 不能泄露 secret、password hash 或 token。 |
| 验证 | `npm run server:verify:console-auth`。 |

## 功能项 SA-02 Authorization Governance

| 项 | 设计 |
| --- | --- |
| 目标 | 管理 subject、role、team、user policy、agent group、agent binding、approval、receipt、loan 和 denied request。 |
| 输入 | authorization API、operation context、workspace/tenant/agent metadata。 |
| 处理 | authorization engine 解析 subject，评估 policy，生成 allowed/denied decision。 |
| 输出 | governance summary、policy result、grant、receipt、loan record。 |
| 错误 | 未授权默认隐藏存在性；高风险动作需要 approval 或 explicit confirmation。 |
| 验证 | `npm run server:verify:authorization-governance`, `npm run server:verify:authorization-capabilities`。 |

## 功能项 SA-03 Capability Key 与 Binding Guard

| 项 | 设计 |
| --- | --- |
| 目标 | 使用 opaque capability key 与绑定守卫避免 agent 推断或转借权限。 |
| 输入 | opaque key、subject、agent、namespace、operation。 |
| 处理 | kernel introspection 后验证绑定关系、scope、risk 和 lifecycle。 |
| 输出 | allow/deny decision、audit、capability metadata projection。 |
| 错误 | key 不可自解释；绑定不匹配 fail closed。 |
| 验证 | `npm run server:verify:opaque-capability-key`, `npm run server:verify:capability-binding-guard`。 |

## 功能项 SA-04 Process Identity

| 项 | 设计 |
| --- | --- |
| 目标 | 绑定客户端本机进程、runtime package、public key 和服务端 claim。 |
| 输入 | claim token、default identity hash、server URL、signed request。 |
| 处理 | 客户端保存私钥到系统密钥后端或安全位置；服务端记录 process key id 和 public key。 |
| 输出 | identity package、signed request headers、rotate/revoke result。 |
| 错误 | claim token 必须走 0600 文件或环境变量，不写入 runtime config。 |
| 验证 | `npm run server:verify:process-identity`, `npm run client:native:test`。 |

## 功能项 SA-05 Secret 管理

| 项 | 设计 |
| --- | --- |
| 目标 | 外部 provider token、OAuth credential、grant token、claim token 和 API key 不进入源码或文档。 |
| 输入 | stdin、secretRef、运行态 secret store、系统 keychain。 |
| 处理 | secret value 只在运行态注入，审计和配置只保存脱敏状态或 fingerprint。 |
| 输出 | credentialConfigured、secretRef、redacted audit。 |
| 错误 | token 出现在 manifest 明文、tool output、error、trace 或 docs 是阻断级缺陷。 |
| 验证 | `npm run server:verify:secret-init`, `npm run server:verify:privacy-placeholders`。 |

## 功能项 SA-06 Risk 与安全门禁

| 项 | 设计 |
| --- | --- |
| 目标 | 对 read_only、safe_write、repair_write、destructive 等风险执行策略和确认。 |
| 输入 | operation risk、toolset maxRisk、grant maxRisk、approval policy。 |
| 处理 | risk control model、operation policy、Tool Management policy 和 approval flow 联合裁决。 |
| 输出 | allow/deny、approval pending、receipt、audit。 |
| 错误 | 本机 stdio 不是公开 Pact framework surface；raw stdio 入口必须锁定。 |
| 验证 | `npm run server:verify:risk-control-model`, `npm run server:verify:security-local-stdio-lockdown`；production readiness gate id 为 `local-stdio-interface-lockdown`。 |
