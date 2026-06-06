# Production Readiness Report

- Run ID: `20260521T161452Z`
- Generated At: `2026-05-21T16:16:47.141Z`
- Branch: `main`
- Commit: `f12ebd577c323ed3cb86814f3c38d841315f3f2d`
- Dirty Files: `17`
- Overall Status: `pass`

## Summary

- Passed: 14
- Failed: 0
- Timed Out: 0
- Blocked P0: 0
- Missing Coverage: none

## Gates

| Gate | Status | Blocker | Owner | Evidence | Next Step |
| --- | --- | --- | --- | --- | --- |
架构门禁 | pass | P0 | platform-architecture | `reports/production-readiness/20260521T161452Z/architecture.log` | 修复架构治理、平台分层或核心文档与实现偏差。
AgentLibrary 源头权限 | pass | P0 | knowledge-security | `reports/production-readiness/20260521T161452Z/agent-library-access.log` | 补齐 knowledgeAccessReceipt、loanRecord、authorizationOverlay 和所有知识出口的统一裁决。
终端贡献资产治理 | pass | P0 | workspace-governance | `reports/production-readiness/20260521T161452Z/workspace-contribution-governance.log` | 补齐贡献状态机、贡献授权、usage event、排行榜和资产贡献统计报表。
文档解析真实样例 | pass | P0 | knowledge-ingestion | `reports/production-readiness/20260521T161452Z/document-parsing-real-sample.log` | 补齐真实文档解析 fixture、结构锚点、动态切分和 DOCX 导出基准。
外部知识库一致性 | pass | P0 | knowledge-storage | `reports/production-readiness/20260521T161452Z/external-knowledge-base-consistency.log` | 补齐外部知识库 conformance：权限预过滤、删除/tombstone、回读和重建语义。
RAG 检索评估 | pass | P0 | knowledge-quality | `reports/production-readiness/20260521T161452Z/rag-evaluation.log` | 补齐检索质量、证据忠实度、权限过滤和 evidence pack 的持续评估。
知识蒸馏评估 | pass | P0 | knowledge-distillation | `reports/production-readiness/20260521T161452Z/distillation-evaluation.log` | 补齐蒸馏覆盖率、同一事项合并、时间线顺序和 unsupported claims 评估。
会话线程与上下文 | pass | P0 | agent-runtime | `reports/production-readiness/20260521T161452Z/session-thread.log` | 补齐 session fork、context bundle、workspace 状态和 agent sync 的端到端验收。
工具权限和安全策略 | pass | P0 | security-tooling | `reports/production-readiness/20260521T161452Z/tool-permission.log` | 补齐 tool grant、risk policy、scope、CSRF/safety-confirm 和审计边界。
备份恢复和 Checkpoint | pass | P0 | ops-runtime | `reports/production-readiness/20260521T161452Z/backup-restore.log` | 补齐 backup manifest、restore drill、checkpoint tree 和恢复审计演示。
升级迁移和配置兼容 | pass | P0 | release-engineering | `reports/production-readiness/20260521T161452Z/upgrade-migration.log` | 补齐 schema migration report、feature profile 构建和连接器迁移门禁。
端到端 UI smoke | pass | P0 | console-frontend | `reports/production-readiness/20260521T161452Z/ui-smoke.log` | 补齐控制台生产健康页、关键路由 smoke、前端 feature registry 和页面验收。
离线包和 License | pass | P0 | release-engineering | `reports/production-readiness/20260521T161452Z/offline-license.log` | 补齐离线包许可清单、第三方运行时声明和可复制打包报告。
业务场景回归 | pass | P1 | product-quality | `reports/production-readiness/20260521T161452Z/business-scenarios.log` | 补齐真实业务场景覆盖，避免只验证单点功能。

## Coverage Checklist

- [x] `architecture`: architecture
- [x] `agent-library-access`: agent-library-access
- [x] `workspace-contribution-governance`: workspace-contribution-governance
- [x] `document-parsing-real-sample`: document-parsing-real-sample
- [x] `external-knowledge-base-consistency`: external-knowledge-base-consistency
- [x] `rag-evaluation`: rag-evaluation
- [x] `distillation-evaluation`: distillation-evaluation
- [x] `session-thread`: session-thread
- [x] `tool-permission`: tool-permission
- [x] `backup-restore`: backup-restore
- [x] `upgrade-migration`: upgrade-migration
- [x] `ui-smoke`: ui-smoke
- [x] `offline-license`: offline-license

## Notes

- Passing this gate is required before claiming production readiness.
- A passing command is only counted for the gate it explicitly covers; uncovered design requirements remain blockers.
- Reports are append-only run artifacts under `reports/production-readiness/<run-id>/`.
