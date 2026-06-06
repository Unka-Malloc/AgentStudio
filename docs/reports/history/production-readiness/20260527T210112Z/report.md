# Production Readiness Report

- Run ID: `20260527T210112Z`
- Generated At: `2026-05-27T21:02:47.235Z`
- Branch: `main`
- Commit: `74c293b862c16de76d03d009ce530aedec07103c`
- Dirty Files: `82`
- Overall Status: `blocked`

## Summary

- Passed: 26
- Failed: 1
- Timed Out: 0
- Blocked P0: 1
- Missing Coverage: offline-license

## Gates

| Gate | Status | Blocker | Owner | Evidence | Next Step |
| --- | --- | --- | --- | --- | --- |
架构门禁 | pass | P0 | platform-architecture | `reports/production-readiness/20260527T210112Z/architecture.log` | 修复架构治理、平台分层或核心文档与实现偏差。
AgentLibrary 源头权限 | pass | P0 | knowledge-security | `reports/production-readiness/20260527T210112Z/agent-library-access.log` | 补齐 knowledgeAccessReceipt、loanRecord、authorizationOverlay 和所有知识出口的统一裁决。
终端贡献资产治理 | pass | P0 | workspace-governance | `reports/production-readiness/20260527T210112Z/workspace-contribution-governance.log` | 补齐贡献状态机、贡献授权、usage event、排行榜和资产贡献统计报表。
文档解析真实样例 | pass | P0 | knowledge-ingestion | `reports/production-readiness/20260527T210112Z/document-parsing-real-sample.log` | 补齐真实文档解析 fixture、结构锚点、动态切分和 DOCX 导出基准。
外部知识库一致性 | pass | P0 | knowledge-storage | `reports/production-readiness/20260527T210112Z/external-knowledge-base-consistency.log` | 补齐外部知识库 conformance：权限预过滤、删除/tombstone、回读和重建语义。
RAG 检索评估 | pass | P0 | knowledge-quality | `reports/production-readiness/20260527T210112Z/rag-evaluation.log` | 补齐检索质量、证据忠实度、权限过滤和 evidence pack 的持续评估。
知识蒸馏评估 | pass | P0 | knowledge-distillation | `reports/production-readiness/20260527T210112Z/distillation-evaluation.log` | 补齐蒸馏覆盖率、同一事项合并、时间线顺序、unsupported claims、优化趋势和人工审核闭环。
会话线程与上下文 | pass | P0 | agent-runtime | `reports/production-readiness/20260527T210112Z/session-thread.log` | 补齐 session fork/compare/merge proposal/archive、context bundle、workspace 状态和 agent sync 的端到端验收。
工具权限和安全策略 | pass | P0 | security-tooling | `reports/production-readiness/20260527T210112Z/tool-permission.log` | 补齐 tool grant、risk policy、scope、CSRF/safety-confirm、组织模型和授权治理边界。
Capability Kernel 与密钥边界 | pass | P0 | security-kernel | `reports/production-readiness/20260527T210112Z/capability-kernel-security.log` | 补齐 Capability Kernel、opaque key、Binding Guard、helper、recovery 和 OS backend 的生产验收。
模型路由成本和降级 | pass | P1 | agent-runtime | `reports/production-readiness/20260527T210112Z/model-routing.log` | 补齐 pact.model-routing.v1、预算、fallback chain、熔断、prompt version 和成本台账。
工具与技能包生命周期 | pass | P1 | tooling-governance | `reports/production-readiness/20260527T210112Z/capability-package-lifecycle.log` | 补齐 pact.tool-package.v1、pact.skill-registry.v1、签名、依赖、审批、回滚和废弃策略。
数据连接器治理与本地镜像一致性 | pass | P1 | knowledge-connectors | `reports/production-readiness/20260527T210112Z/data-connector-governance.log` | 补齐 pact.data-connector-governance.v1、OAuth refresh 策略、增量 cursor、mirror 冲突/清理、localQuery 禁远程和卸载策略。
性能和容量基准 | pass | P1 | production-readiness | `reports/production-readiness/20260527T210112Z/performance-capacity.log` | 补齐 pact.performance-capacity.v1、容量目标、benchmark runner、失败注入和报告阈值。
模块 SDK 与模板 | pass | P2 | module-management | `reports/production-readiness/20260527T210112Z/module-ecosystem.log` | 补齐 pact.module-ecosystem.v1、create-module、contract test、示例模块、CI 模板和 schema docs。
组织级工作空间治理 | pass | P2 | workspace-governance | `reports/production-readiness/20260527T210112Z/workspace-governance.log` | 补齐 organization/project/dataClass/retention/legalHold、外部协作者、跨空间复制和共享授权治理。
多模态资产血缘 | pass | P2 | knowledge-ingestion | `reports/production-readiness/20260527T210112Z/asset-lineage.log` | 补齐 raw object、page/slide、bbox、parser/model/version、OCR、视觉模型和重解析计划。
资产价值管理报告 | pass | P3 | product-quality | `reports/production-readiness/20260527T210112Z/executive-report.log` | 补齐 asset contribution、production readiness、eval、trace、benchmark 的管理层报告汇总。
架构图运行状态联动 | pass | P3 | platform-architecture | `reports/production-readiness/20260527T210112Z/architecture-live-map.log` | 补齐核心架构节点到文档、实现路径和生产门禁状态的联动映射。
样例业务包 | pass | P3 | product-quality | `reports/production-readiness/20260527T210112Z/sample-business-pack.log` | 补齐邮件、PDF、PPT、Markdown 项目和外部知识库 compose 的可物化样例包。
内部 Trace 与日志脱敏 | pass | P0 | observability | `reports/production-readiness/20260527T210112Z/trace-observability.log` | 补齐 pact.trace.v1、span 关联、权限裁决引用、成本字段和 OpenTelemetry 导出映射。
长任务 Durable Workflow | pass | P0 | workflow-runtime | `reports/production-readiness/20260527T210112Z/durable-workflow.log` | 继续把更多高风险长任务接入 pact.workflow.v1，并用真实外部服务演练 partial write 补偿。
备份恢复和 Checkpoint | pass | P0 | ops-runtime | `reports/production-readiness/20260527T210112Z/backup-restore.log` | 补齐 backup manifest、restore drill、checkpoint tree 和恢复审计演示。
升级迁移和配置兼容 | pass | P0 | release-engineering | `reports/production-readiness/20260527T210112Z/upgrade-migration.log` | 补齐 schema migration report、feature profile 构建和连接器迁移门禁。
端到端 UI smoke | pass | P0 | console-frontend | `reports/production-readiness/20260527T210112Z/ui-smoke.log` | 补齐控制台生产健康页、关键路由 smoke、前端 feature registry 和页面验收。
离线包和 License | fail | P0 | release-engineering | `reports/production-readiness/20260527T210112Z/offline-license.log` | 补齐离线包许可清单、第三方运行时声明和可复制打包报告。
业务场景回归 | pass | P1 | product-quality | `reports/production-readiness/20260527T210112Z/business-scenarios.log` | 补齐真实业务场景覆盖，避免只验证单点功能。

## Coverage Checklist

- [x] `architecture`: architecture
- [x] `agent-library-access`: agent-library-access
- [x] `capability-kernel-security`: capability-kernel-security
- [x] `workspace-contribution-governance`: workspace-contribution-governance
- [x] `document-parsing-real-sample`: document-parsing-real-sample
- [x] `external-knowledge-base-consistency`: external-knowledge-base-consistency
- [x] `rag-evaluation`: rag-evaluation
- [x] `distillation-evaluation`: distillation-evaluation
- [x] `session-thread`: session-thread
- [x] `tool-permission`: tool-permission
- [x] `trace-observability`: trace-observability
- [x] `durable-workflow`: durable-workflow
- [x] `backup-restore`: backup-restore
- [x] `upgrade-migration`: upgrade-migration
- [x] `ui-smoke`: ui-smoke
- [ ] `offline-license`

## Notes

- Passing this gate is required before claiming production readiness.
- A passing command is only counted for the gate it explicitly covers; uncovered design requirements remain blockers.
- Reports are append-only run artifacts under `reports/production-readiness/<run-id>/`.
