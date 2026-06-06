# Production Readiness Report

- Run ID: `20260521T164333Z`
- Generated At: `2026-05-21T16:43:38.755Z`
- Branch: `main`
- Commit: `be58a9f79ba3d72f41f30d94a7a64f9cc29d91e1`
- Dirty Files: `30`
- Overall Status: `blocked`

## Summary

- Passed: 3
- Failed: 0
- Timed Out: 0
- Blocked P0: 0
- Missing Coverage: agent-library-access, workspace-contribution-governance, external-knowledge-base-consistency, rag-evaluation, distillation-evaluation, session-thread, tool-permission, trace-observability, durable-workflow, backup-restore, upgrade-migration, offline-license

## Gates

| Gate | Status | Blocker | Owner | Evidence | Next Step |
| --- | --- | --- | --- | --- | --- |
架构门禁 | pass | P0 | platform-architecture | `reports/production-readiness/20260521T164333Z/architecture.log` | 修复架构治理、平台分层或核心文档与实现偏差。
文档解析真实样例 | pass | P0 | knowledge-ingestion | `reports/production-readiness/20260521T164333Z/document-parsing-real-sample.log` | 补齐真实文档解析 fixture、结构锚点、动态切分和 DOCX 导出基准。
端到端 UI smoke | pass | P0 | console-frontend | `reports/production-readiness/20260521T164333Z/ui-smoke.log` | 补齐控制台生产健康页、关键路由 smoke、前端 feature registry 和页面验收。

## Coverage Checklist

- [x] `architecture`: architecture
- [ ] `agent-library-access`
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
- [x] `ui-smoke`: ui-smoke
- [ ] `offline-license`

## Notes

- Passing this gate is required before claiming production readiness.
- A passing command is only counted for the gate it explicitly covers; uncovered design requirements remain blockers.
- Reports are append-only run artifacts under `reports/production-readiness/<run-id>/`.
