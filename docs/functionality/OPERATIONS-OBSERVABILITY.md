# Operations Storage And Observability

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Storage, backups, metadata rebuild, operations tools, monitoring, production health, runtime logging, traces, reports, and verification gates.
- Staleness check: Checked against storage modules, ops scripts, monitor alert operations, production health operations, observability routes, and verification scripts on 2026-06-16.

## 模块边界

本模块负责服务端运行态的存储运维、备份恢复、可观测性、生产健康、监控告警、运行日志和验证门禁。它不拥有业务事实，只提供诊断、恢复和证据能力。

## 功能项 OO-01 Storage Summary

| 项 | 设计 |
| --- | --- |
| 目标 | 展示 SQLite 元数据、raw objects、jobs、upload sessions 和存储健康摘要。 |
| 输入 | `GET /api/storage/summary`, metadata store, raw object store。 |
| 处理 | 只读聚合存储状态，不修改业务对象。 |
| 输出 | storage summary、counts、path、health indicators。 |
| 错误 | summary 不返回 secret、raw token 或未授权路径内容。 |
| 验证 | `npm run server:verify:ops`。 |

## 功能项 OO-02 Doctor / Locate / Reconcile

| 项 | 设计 |
| --- | --- |
| 目标 | 诊断和修复文件系统与 SQLite 元数据不一致。 |
| 输入 | `server:doctor`, `server:locate`, `server:reconcile`, storage operations。 |
| 处理 | 先只读 doctor/locate，再在明确风险下 reconcile。 |
| 输出 | diagnosis、candidate mismatch、reconcile result、audit。 |
| 错误 | 不执行无确认的原始对象删除。 |
| 验证 | `npm run server:verify:ops`, `npm run server:verify:rebuild`。 |

## 功能项 OO-03 Backup / Restore

| 项 | 设计 |
| --- | --- |
| 目标 | 提供运行态备份列表、创建、restore preview 和 restore。 |
| 输入 | backup create、restore preview、restore request。 |
| 处理 | 备份恢复必须与 checkpoint、audit 和权限绑定。 |
| 输出 | backup record、preview、restore result。 |
| 错误 | 生产恢复必须要求审计和确认，不直接覆盖未知状态。 |
| 验证 | `npm run server:verify:backup-restore`。 |

## 功能项 OO-04 Runtime Logging And Trace

| 项 | 设计 |
| --- | --- |
| 目标 | 记录 operation、runtime、agent、external call 和 maintenance trace。 |
| 输入 | operation context、trace id、logger events。 |
| 处理 | 日志脱敏，trace 与 operationId、auditRef、receiptRef 关联。 |
| 输出 | logs、`/api/observability/traces/:traceId`、audit refs。 |
| 错误 | 不保存 token、cookie、headers 原文、provider debug stack。 |
| 验证 | `npm run server:verify:runtime-logging`, `npm run server:verify:trace-context`。 |

## 功能项 OO-05 Monitor Alerts

| 项 | 设计 |
| --- | --- |
| 目标 | 管理系统监控告警配置、列表和 ack。 |
| 输入 | monitor alert config、ack request、background process state。 |
| 处理 | 告警作为运维事件，不直接修改业务状态。 |
| 输出 | alert list、config、ack receipt。 |
| 错误 | ack 不等于修复；修复仍走对应 operation。 |
| 验证 | `npm run server:verify:monitor-alerts`。 |

## 功能项 OO-06 Production Health And Reports

| 项 | 设计 |
| --- | --- |
| 目标 | 汇总生产健康、执行报告、样例业务包和生产准入门禁。 |
| 输入 | production health、executive report、sample business pack、readiness gate。 |
| 处理 | 生产声明必须基于 verifier evidence，不用历史过程报告。 |
| 输出 | health result、report preview/generate、sample pack materialize、readiness state。 |
| 错误 | waiver 必须进入 production readiness lifecycle。 |
| 验证 | `npm run server:verify:production-health-console`, `npm run server:verify:production-readiness`。 |

## 功能项 OO-07 Verification Registry

| 项 | 设计 |
| --- | --- |
| 目标 | 用 package scripts 和 dedicated verifier 证明功能仍符合当前文档。 |
| 输入 | `npm run server:verify:*`, `npm run client:verify:*`。 |
| 处理 | 验证脚本读取代码事实源，不以历史过程文档为依据。 |
| 输出 | stdout、build/reports 下的最新机器报告、失败原因。 |
| 错误 | 失败 verifier 不得用文档声明绕过。 |
| 验证 | `npm run server:verify`, `npm run client:verify`。 |
