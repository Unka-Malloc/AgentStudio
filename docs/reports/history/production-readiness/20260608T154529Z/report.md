# Production Readiness Report

- Run ID: `20260608T154529Z`
- Generated At: `2026-06-08T15:45:37.217Z`
- Branch: `nightly`
- Commit: `3568f6f37b1a593b32728fef3329d22f3a98dafc`
- Evidence For Commit: `3568f6f37b1a593b32728fef3329d22f3a98dafc`
- Dirty Files: `8`
- Generated From Dirty Worktree: `true`
- Claim Scope: `historical`
- Mode: `quick`
- Production Claim Allowed: `false`
- Quick Check Passed: `false`
- Overall Status: `dirty_quick_report`

> :warning: **DIRTY WORKTREE**: This report was generated from a dirty repository. It is marked as `claimScope: historical` and cannot be used as current-head production evidence.

## Summary

- Passed: 3
- Failed: 0
- Timed Out: 0
- Blocked P0: 0
- Missing Coverage: none

> Quick mode: the checklist below reflects quick coverage only.

## Gates

| Gate | Status | Blocker | Owner | Evidence | Next Step |
| --- | --- | --- | --- | --- | --- |
架构门禁 | pass | P0 | platform-architecture | `docs/reports/history/production-readiness/20260608T154529Z/architecture.log` | 修复架构治理、平台分层或核心文档与实现偏差。
文档解析真实样例 | pass | P0 | knowledge-ingestion | `docs/reports/history/production-readiness/20260608T154529Z/document-parsing-real-sample.log` | 补齐真实文档解析 fixture、结构锚点、动态切分和 DOCX 导出基准。
端到端 UI smoke | pass | P0 | console-frontend | `docs/reports/history/production-readiness/20260608T154529Z/ui-smoke.log` | 补齐控制台生产健康页、关键路由 smoke、前端 feature registry 和页面验收。

## Coverage Checklist

- [x] `architecture`: architecture
- [x] `document-parsing-real-sample`: document-parsing-real-sample
- [x] `ui-smoke`: ui-smoke

> Quick pass does not imply production pass. Full coverage checklist is below as reference.

## Full Coverage Reference (not required for quick pass)

- [x] `architecture`: architecture
- [ ] `agent-library-access`
- [ ] `capability-kernel-security`
- [ ] `workspace-contribution-governance`
- [x] `document-parsing-real-sample`: document-parsing-real-sample
- [ ] `external-knowledge-base-consistency`
- [ ] `external-service-api-registration`
- [ ] `capability-kernel-api-capability`
- [ ] `key-management-storage-distribution`
- [ ] `permission-management-auth-config`
- [ ] `mcp-gateway-client-push`
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
- Reports are append-only run artifacts under `docs/reports/history/production-readiness/<run-id>/`.
