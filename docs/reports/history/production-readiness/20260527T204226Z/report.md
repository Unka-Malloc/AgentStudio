# Production Readiness Report

- Run ID: `20260527T204226Z`
- Generated At: `2026-05-27T20:42:32.097Z`
- Branch: `main`
- Commit: `74c293b862c16de76d03d009ce530aedec07103c`
- Dirty Files: `78`
- Overall Status: `blocked`

## Summary

- Passed: 1
- Failed: 2
- Timed Out: 0
- Blocked P0: 2
- Missing Coverage: architecture, agent-library-access, capability-kernel-security, workspace-contribution-governance, external-knowledge-base-consistency, rag-evaluation, distillation-evaluation, session-thread, tool-permission, trace-observability, durable-workflow, backup-restore, upgrade-migration, ui-smoke, offline-license

## Gates

| Gate | Status | Blocker | Owner | Evidence | Next Step |
| --- | --- | --- | --- | --- | --- |
架构门禁 | fail | P0 | platform-architecture | `reports/production-readiness/20260527T204226Z/architecture.log` | 修复架构治理、平台分层或核心文档与实现偏差。
文档解析真实样例 | pass | P0 | knowledge-ingestion | `reports/production-readiness/20260527T204226Z/document-parsing-real-sample.log` | 补齐真实文档解析 fixture、结构锚点、动态切分和 DOCX 导出基准。
端到端 UI smoke | fail | P0 | console-frontend | `reports/production-readiness/20260527T204226Z/ui-smoke.log` | 补齐控制台生产健康页、关键路由 smoke、前端 feature registry 和页面验收。

## Coverage Checklist

- [ ] `architecture`
- [ ] `agent-library-access`
- [ ] `capability-kernel-security`
- [ ] `workspace-contribution-governance`
- [x] `document-parsing-real-sample`: document-parsing-real-sample
- [ ] `external-knowledge-base-consistency`
- [ ] `rag-evaluation`
- [ ] `distillation-evaluation`
- [ ] `session-thread`
- [ ] `tool-permission`
- [ ] `trace-observability`
- [ ] `durable-workflow`
- [ ] `backup-restore`
- [ ] `upgrade-migration`
- [ ] `ui-smoke`
- [ ] `offline-license`

## Notes

- Passing this gate is required before claiming production readiness.
- A passing command is only counted for the gate it explicitly covers; uncovered design requirements remain blockers.
- Reports are append-only run artifacts under `reports/production-readiness/<run-id>/`.
