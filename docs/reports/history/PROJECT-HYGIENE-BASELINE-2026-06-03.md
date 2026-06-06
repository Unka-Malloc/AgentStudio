# Pact Project Hygiene Baseline 2026-06-03

本文记录 2026-06-03 第一轮项目卫生巡检结果。目标是把当前可复核的问题、已运行门禁、整理优先级和已确认的维护决策集中到一处，避免后续整理时把功能改动、生成物清理和架构重构混在一起。

本文不是长期架构事实源。整理完成后的长期结论应回写到 `Architecture.md`、`PROTOCOLS.md`、`WORKSPACE-ASSET-GOVERNANCE.md`、`KNOWLEDGE-GOVERNANCE.md`、`PRODUCTION-CAPABILITY-GAP.md` 或对应运行支持文档。报告类文档放在 `docs/reports/`，日常维护文档放在 `docs/` 根层级或对应子目录。

## Scope

- 仓库根目录、配置、文档、测试、技能资源。
- `server/**`、`mcp-connector/**`、`external-services/**`。
- `server-web/**`、`vite.config.ts`、`vitest.config.ts`、`tsconfig.json`。
- `client-gui/**`、`client-cli/**`、`scripts/**`、`tests/**`、`skills/**`。

未逐字阅读依赖和生成物目录：`.git/`、`node_modules/`、`build/`、`client-cli/target/`、`client-gui/build/`、`client-gui/.dart_tool/`、`.pact-server-data/`、`test-results/`。这些目录按体量、路径和卫生规则统计为整理对象。

## Repository Snapshot

- 当前分支：`codex/knowledge-distillation-v2`。
- Git 跟踪文件约 1512 个，源码/文档约 43.4 万行。
- 当前工作区已有大量未提交改动：约 74 个已跟踪文件变更，另有未跟踪源码、测试和文档文件。
- 最大本地产物体量：`build/` 约 26G，`tests/` 约 7.8G，`client-cli/target/` 约 2.2G，`node_modules/` 约 460M。
- 最大源码热区：
  - `external-services/knowledge-distillation-service/server.mjs`：约 24k 行。
  - `server/platform/specialized/knowledge/storage/knowledge-core/index.mjs`：约 7.5k 行。
  - `server/platform/specialized/console/console-domain-operation-executor.mjs`：约 7.1k 行。
  - `mcp-connector/bin/pact-mcp.mjs`：约 7.1k 行。
  - `server/platform/common/operation-dispatcher/operation-registry.mjs`：约 6.2k 行。

## Gate Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm run repo:hygiene` | Passed after cleanup | 初始运行失败；确认后已移动根部本地产物、报告和产品文档，并修正 data-dir 默认路径策略。 |
| `node tests/verify-secret-hygiene.mjs` | Passed | 未发现高风险真实密钥模式。 |
| `npm run server:verify:frontend-feature-registry` | Passed after cleanup | 初始运行失败；确认后已恢复 `/approval` 独立页面，并补齐 `/admin/agent-assignment` registry。 |
| `npm run server:verify:frontend-architecture` | Passed after cleanup | 初始运行失败；确认后已恢复 `/approval` side-nav 入口，并同步 side-nav verifier 切片。 |
| `npm run server:verify:runtime-dependency-downloads` | Passed | runtime dependency 下载计划检查通过。 |
| `npm run server:verify:frontend-typecheck` | Passed | TypeScript 前端类型检查通过。 |
| `npm run client:verify:architecture` | Passed | future client 架构门禁通过。 |
| `npm run client:verify:plan` | Passed | 客户端计划门禁通过。 |

## P0 Items

### P0-1: Freeze the Current Working Baseline

当前工作区已混合前端、后端、文档、依赖锁文件和新增测试文件。继续直接整理会让后续 diff 难以阅读。

Recommended action:
- 先决定当前未提交变更是作为一个基线提交、拆分提交，还是暂存到临时分支。
- 后续卫生修复单独开 patch，避免和现有功能改动混在一起。

Paths:
- `package.json`
- `package-lock.json`
- `server-web/**`
- `server/**`
- `docs/**`
- `tests/**`

### P0-2: Repository Hygiene Gate Was Red at Baseline

`npm run repo:hygiene` 初始运行失败，命中条目包括：

- Forbidden root entries: `.DS_Store`、`.pact-server-data`
- Unclassified root entries at baseline time: `.impeccable`、`PRODUCT.md`、`outputs`、`test-results`
- Forbidden generated source-tree entries: `tests/.DS_Store`

Recommended action:
- 删除 OS 元数据文件。
- 将本地运行态数据和测试输出移到 `build/` 或外部本地数据目录。
- `PRODUCT.md` 已确认移动到 `docs/PRODUCT.md`，后续不再作为根目录文件。
- `.pact-server-data` 已确认应使用 `~/.pact-server-data`，和项目开发目录解耦，作为纯数据和配置目录。
- 明确 `.impeccable` 属于本地工具状态还是项目资产；如果是本地状态，应保持忽略和不纳入卫生允许清单。

Paths:
- `tests/verify-root-hygiene.mjs`
- `.gitignore`
- `docs/PRODUCT.md`
- `.pact-server-data/`
- `outputs/`
- `test-results/`

Current status:
- Confirmed cleanup moved local root artifacts out of the checkout.
- Confirmed data-dir defaults now resolve through `ServerConfig.getDataDir()`, which defaults to `~/.pact-server-data`.
- `npm run repo:hygiene` now passes.

### P0-3: Frontend Route and Feature Registry Drift

Initial finding:
- `/approval` 在前端路由里已变成重定向，但 feature registry 仍登记为真实页面。
- `/admin/agent-assignment` 在路由中存在，但需要和 registry 对齐。

Observed facts at baseline time:
- `server-web/router/index.ts` 中 `/approval` 重定向到 `/`。
- `server-web/router/routes.ts` 中 `viewToPath("approval")` 返回 `/`。
- `server/config/frontend-feature-registry.yaml` 仍登记 `/approval -> ApprovalFlowView.vue`。
- `server-web/router/index.ts` 存在 `/admin/agent-assignment`。

Confirmed direction:
- `/approval` 恢复为独立页面。
- `/admin/agent-assignment` 保留为独立管理页，并补齐 registry 记录。

Recommended action:
- 恢复 `/approval` 的真实懒加载页面路由。
- 同步 registry、导航、刷新控制和 i18n 文案。
- 为 `/admin/agent-assignment` 补齐 registry 记录。

Current status:
- `/approval` has been restored as an independent lazy-loaded page.
- `/admin/agent-assignment` has been added to the feature registry.
- `npm run server:verify:frontend-feature-registry` now passes.

Paths:
- `server-web/router/index.ts`
- `server-web/router/routes.ts`
- `server/config/frontend-feature-registry.yaml`
- `server-web/views/ApprovalFlowView.vue`
- `server-web/views/admin/AgentAssignmentView.vue`

### P0-4: Frontend Architecture Gate Drift

`npm run server:verify:frontend-architecture` 报：

```text
ConsoleSideNavPrimaryLinks.vue must own its expected side-nav slice
```

Initial finding:
- Verifier 仍期待 `ConsoleSideNavPrimaryLinks.vue` 包含 `approval` 切片，但组件已经移除对应入口。

Confirmed direction:
- `/approval` 应作为独立页面恢复。

Recommended action:
- 恢复导航入口和路由事实。
- 保持 verifier 哨兵与 side-nav 切片约定一致。

Current status:
- `/approval` side-nav entry has been restored.
- Side-nav verifier expectations now match the current Primary, Team, Knowledge, External Service and System sections.
- `npm run server:verify:frontend-architecture` now passes.

Paths:
- `server/scripts/verify-frontend-architecture.mjs`
- `server-web/components/shell/side-nav/ConsoleSideNavPrimaryLinks.vue`
- `server-web/components/shell/ConsoleSideNav.vue`

### P0-5: License Identifier Conflict

Initial finding: 许可证口径不一致。

- `LICENSE` 明确 canonical identifier 为 `GPL-3.0-only`。
- `client-cli/Cargo.toml` 使用 `GPL-3.0-only`。
- `package.json` 使用 `GPL-3.0-or-later`。
- README 徽章使用 `GPL-3.0-or-later`，正文又写 GPL v3.0 only。

Confirmed direction:
- 项目统一为 `GPL-3.0-or-later`。

Recommended action:
- 更新 `LICENSE`、`client-cli/Cargo.toml` 和 `CONTRIBUTING.md`，使其与 `package.json`、README 徽章统一。

Current status:
- License metadata has been aligned to `GPL-3.0-or-later`.

Paths:
- `LICENSE`
- `package.json`
- `client-cli/Cargo.toml`
- `README.md`
- `README.zh-CN.md`
- `CONTRIBUTING.md`

### P0-6: External Knowledge Distillation Service Exposure

外部知识蒸馏服务是独立 HTTP 服务，承担大量文件解析和蒸馏逻辑。当前需要重点收紧默认暴露面。

Confirmed deployment direction:
- 默认支持远程访问；后续会单独部署到容器，通过网络通信。

Observed risks:
- 服务源码是单文件约 24k 行，安全审阅和回归成本高。
- 子进程、Tika、PDF、压缩包、邮件、Office 等解析路径集中在同一服务中。
- 需要确认默认监听地址、入站鉴权、容器运行用户、Tika jar checksum 和 healthcheck 是否符合部署要求。

Recommended action:
- 以远程容器部署为默认设计目标，补齐入站鉴权、网络边界和部署说明。
- Dockerfile 使用非 root 用户，下载依赖固定 checksum，并提供 healthcheck。

Paths:
- `external-services/knowledge-distillation-service/server.mjs`
- `external-services/knowledge-distillation-service/Dockerfile`
- `external-services/knowledge-distillation-service/README.md`
- `server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs`

## P1 Items

### P1-1: Split Oversized Backend Modules

Several backend files are too large to review safely and make unrelated edits easy to couple.

Recommended first split targets:
- `external-services/knowledge-distillation-service/server.mjs`
- `server/platform/specialized/knowledge/storage/knowledge-core/index.mjs`
- `server/platform/specialized/console/console-domain-operation-executor.mjs`
- `mcp-connector/bin/pact-mcp.mjs`
- `server/platform/common/operation-dispatcher/operation-registry.mjs`
- `server/services/client/work-queue-core/jobs/job-manager.mjs`

Expected direction:
- Move route tables, parser strategies, storage adapters, CLI target writers, operation groups and verification fixtures into focused modules.
- Keep compatibility shims isolated and clearly marked.

### P1-2: Configuration Boundaries Are Scattered

Configuration currently lives across CLI args, env vars, `ServerConfig`, `settings.mjs`, mount config, feature registry, package scripts and external service env.

Risk:
- Hard to distinguish user configuration, candidate templates, environment defaults and runtime fallback.
- This matters because project rules require empty user config to remain empty.

Recommended action:
- Create an authoritative configuration map from `ServerConfig.mjs`, `settings.mjs`, `mount-config.mjs`, feature profiles and external service env.
- Separate user-owned settings, candidate templates and runtime defaults.

Paths:
- `server/platform/common/config/ServerConfig.mjs`
- `server/platform/common/platform-core/settings.mjs`
- `server/platform/common/module-manager/mount-config.mjs`
- `server/config/**`
- `docs/SERVER.md`

### P1-3: SQLite Migration Style Drift

Storage schema evolution is not uniformly represented.

Observed pattern:
- `schema-manager.mjs` uses inline schema and `ensureColumn`.
- Other areas use more explicit versioned migration style.

Recommended action:
- Move core storage evolution into one migration pattern with versioned steps and rollback/rebuild evidence where needed.

Paths:
- `server/platform/common/storage/schema-manager.mjs`
- `server/platform/common/storage/sqlite-migrations.mjs`
- `server/platform/common/storage/metadata-store.mjs`
- `server/platform/specialized/capabilities/tools/tool-management-core/store.mjs`

### P1-4: Runtime Assets and Large Binaries Pollute Source Checkout

Large runtime assets are present under source-like paths.

Examples:
- `server/platform/modules/knowledge/runtime/jre/**`
- `server/platform/modules/knowledge/tika/tika-app-3.2.3.jar`
- `modules/jre/downloads/**`

Recommended action:
- Keep only `.gitkeep` or metadata in source tree.
- Move actual runtimes and archives to installer cache, release artifact, or local runtime setup flow.

Paths:
- `server/scripts/setup-local-runtime.mjs`
- `server/scripts/verify-runtime-dependency-downloads.mjs`
- `server/platform/modules/knowledge/RUNTIME-RESOURCES.md`
- `server/platform/specialized/capabilities/runtime-dependencies/index.mjs`

### P1-5: Frontend Singleton and Large View Components

The frontend is migrating from `useConsole()` toward focused controllers and contexts, but several large surfaces remain.

Observed hotspots:
- `server-web/composables/useConsole.ts` still exports a very large shared surface.
- `server-web/views/ExternalServicesView.vue` is still large and contains script, form, popover and style concerns.
- `server-web/views/admin/AgentAssignmentView.vue` recently grew with probing and saving flows.

Recommended action:
- Continue route provider + context + focused component extraction.
- Avoid new direct `useConsole()` consumers.

Paths:
- `server-web/composables/useConsole.ts`
- `server-web/views/ExternalServicesView.vue`
- `server-web/views/admin/AgentAssignmentView.vue`
- `server-web/composables/external-services-view-controller.ts`
- `server-web/composables/console-shell-*-context.ts`

### P1-6: Frontend i18n and Style Boundaries Are Mixed

Observed pattern:
- Structured message maps, phrase replacement and DOM localizer coexist.
- Global CSS, component CSS and scoped SFC CSS coexist.

Risk:
- Dynamic text, aria labels, tooltips and placeholders can drift.
- Style ownership can become hard to trace.

Recommended action:
- New code should prefer structured message keys.
- Keep DOM localization as compatibility layer only.
- Assign styles to global tokens/components/views deliberately, not by convenience.

Paths:
- `server-web/i18n/console-messages.ts`
- `server-web/i18n/console-dom-localizer.ts`
- `server-web/i18n/console-phrases/**`
- `server-web/styles/**`
- `server-web/components/**`

### P1-7: New Frontend Components Need Stabilization and Tests

Current untracked or recent components include reusable UI that should be either committed with tests or held back.

Observed issues:
- `ConfigFloatingPanel.vue`, `ConfigListSummaryBubble.vue`, `HelpTooltip.vue`, `RuntimeDependencyConfigButton.vue` are new/untracked in the current worktree.
- Some popover/tooltip ids are generated with `Math.random()`, which is less stable for tests and snapshots.
- Common registry names include Chinese display names while most entries use component-style names.

Recommended action:
- Add focused Vitest/component tests for close behavior, focus behavior, disabled state, save/refresh state and tooltip visibility.
- Prefer stable id generation through Vue APIs or deterministic props.
- Normalize common component registry names to PascalCase component names while keeping Chinese descriptions.

Paths:
- `server-web/components/common.ts`
- `server-web/components/ConfigFloatingPanel.vue`
- `server-web/components/ConfigListSummaryBubble.vue`
- `server-web/components/HelpTooltip.vue`
- `server-web/components/admin/runtime-downloads/RuntimeDependencyConfigButton.vue`
- `tests/vitest/server-web/**`
- `vitest.config.ts`

### P1-8: Old Client Smoke Scripts Remain

Client architecture and plan gates pass, but smoke scripts still reference old daemon/mail/log commands.

Observed examples:
- `tests/smoke/client-cli-smoke.mjs` calls `daemon status`, `config get`, `mail stats`, `logs tail`.
- Linux bundle smoke scripts still expect `pact-clientd` and mail-import directories.

Recommended action:
- Update smoke scripts to test future client flows: targets, MCP config, Skill Hub, model forwarding, activity/snapshots and settings.
- Keep legacy daemon/mail checks only under `legacy/dev-only` gates if still needed.

Paths:
- `tests/smoke/client-cli-smoke.mjs`
- `client-gui/scripts/smoke-linux-bundle.mjs`
- `client-gui/scripts/gui-smoke-linux-bundle.mjs`
- `client-gui/scripts/verify-client-architecture.mjs`

### P1-9: Test Corpus and Fixture Paths Drift

Mail corpus scripts and hygiene policy disagree.

Observed pattern:
- Scripts default to `tests/email-corpus`.
- Hygiene rules prohibit `tests/email-corpus`.
- `tests/README.md` says reusable fixtures live under `tests/fixtures`.

Recommended action:
- Choose one policy for reusable small fixtures and large local/private corpora.
- Move large/private corpora out of source roots or keep under ignored local fixture paths with explicit docs.

Paths:
- `scripts/collect-dedupe-emails.mjs`
- `scripts/split-mbox-corpus.mjs`
- `tests/README.md`
- `tests/verify-root-hygiene.mjs`
- `tests/fixtures/**`

### P1-10: Skills Are Not Portable Enough

Several skills hardcode the local absolute repository path.

Observed pattern:
- Multiple `SKILL.md` files contain `/Users/unka/DevSpace/Unka-Malloc/Pact`.
- Only a small subset appears to carry `metadata.short-description`.

Recommended action:
- Add a skill hygiene verifier for frontmatter, short description, relative script references, optional agent metadata and local data-dir handling.
- Replace absolute paths with repo-relative examples or `$PACT_REPO` style variables.

Paths:
- `skills/**/SKILL.md`
- `skills/**/agents/**`
- `skills/**/scripts/**`
- `skills/README.md`

### P1-11: Documentation Set Needs Triage

`docs/` contains core docs plus many plans, progress logs, draft interfaces and reports. This is useful history, but it conflicts with the stated goal of preventing lateral design drift.

Recommended action:
- Keep the five core design documents authoritative.
- Move current-state reports into a clearly named reports/baselines section, or convert them into actionable sections in operational docs.
- Mark obsolete drafts with superseded references before deleting or archiving.

Paths:
- `docs/README.md`
- `docs/reports/history/PROJECT-AUDIT-REPORT.md`
- `docs/reports/history/RESOURCE-OPERATION-INTERFACE-DRAFT.md`
- `docs/reports/history/KNOWLEDGE-DISTILLATION-*.md`
- `docs/reports/history/SUBSYSTEM-REFACTOR-CHECKLIST.md`

### P1-12: Backend Static Checks Are Thin

`tsconfig` mainly covers `server-web`, while backend is mostly `.mjs`.

Recommended action:
- Add lightweight import-boundary and JSDoc/type checks for backend modules.
- Start with `server/platform/common` to `server/platform/specialized` dependency direction.

Paths:
- `tsconfig.json`
- `server/platform/common/**`
- `server/platform/specialized/**`
- `server/scripts/verify-architecture-patterns.mjs`

## P2 Items

### P2-1: Package Scripts Are Too Large

`package.json` contains 250+ scripts, including roughly 140 `server:verify:*` entries.

Recommended action:
- Keep common developer commands in `package.json`.
- Move detailed verifier metadata to a manifest or task runner owned by `tests/run.mjs` and server scripts.

Paths:
- `package.json`
- `tests/run.mjs`
- `server/scripts/**`

### P2-2: Server Runtime Naming Is Misleading

`server/services/client/work-queue-core/**` appears to contain server-side job runtime code.

Recommended action:
- Rename or move when refactoring job manager to avoid "client" meaning server worker runtime.

Paths:
- `server/services/client/work-queue-core/**`

### P2-3: Client Orphan Legacy Source

`client-cli/src/checkpoints.rs` remains in main `src` but is not clearly part of the future client public surface.

Recommended action:
- Move it to `client-cli/legacy/dev-only` or delete it after confirming no active import path depends on it.
- Extend `client:verify:architecture` to catch orphan legacy modules in main `src`.

Paths:
- `client-cli/src/checkpoints.rs`
- `client-gui/scripts/verify-client-architecture.mjs`

### P2-4: Node and Flutter Version Metadata Drift

Observed drift:
- README advertises Node 22+.
- CONTRIBUTING still references Node >=18.
- `package.json` does not declare `engines.node`.
- `client-gui/pubspec.yaml` still has template-like `1.0.0+1`.

Recommended action:
- Declare the Node version policy in `package.json`.
- Align contributing docs and package metadata.
- Align Flutter package version with repository release strategy.

Paths:
- `package.json`
- `CONTRIBUTING.md`
- `client-gui/pubspec.yaml`
- `docs/TEST-FRAMEWORK.md`

### P2-5: Explicit Dependency Ownership

If frontend code directly imports icon packages or other Element Plus subpackages, direct dependencies should be declared instead of relying on transitive installs.

Recommended action:
- Add explicit dependency only when direct imports exist.
- Otherwise standardize on currently registered Element Plus usage.

Paths:
- `package.json`
- `server-web/main.ts`
- `server-web/components/**`

### P2-6: Deprecated Internal Knowledge Distillation Shims

Internal knowledge distillation compatibility remains alongside the external service.

Recommended action:
- Keep compatibility shims isolated.
- Remove operation registry entries once console callers fully migrate.

Paths:
- `server/platform/common/operation-dispatcher/operation-registry.mjs`
- `server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs`
- `server/scripts/verify-external-knowledge-distillation*.mjs`

## Confirmed Decisions

These maintainer decisions were confirmed after the first hygiene pass:

1. License direction: standardize on `GPL-3.0-or-later`.
2. Approval route direction: restore `/approval` as an independent page.
3. Product document location: move root `PRODUCT.md` to `docs/PRODUCT.md`.
4. Local data directory: `.pact-server-data` should live at `~/.pact-server-data`, fully decoupled from the project checkout.
5. External knowledge distillation deployment: default to remote/container deployment over network communication.
6. Documentation placement: reports live under `docs/reports/`; daily maintenance docs live under `docs/`.

## Recommended First Cleanup Sequence

1. Preserve or split the current dirty worktree baseline.
2. Keep `repo:hygiene` green as later path moves and data-dir changes land.
3. Restore `/approval` as an independent page and align route, registry, side-nav and verifier expectations.
4. Align all license metadata to `GPL-3.0-or-later`.
5. Harden external knowledge distillation for remote container deployment.
6. Update old client smoke scripts or move them to legacy-only verification.
7. Add focused tests for new frontend config components.
8. Start splitting oversized modules one boundary at a time.
