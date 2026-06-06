# Pact 设计文档审计报告

> 历史归档标注：本文保留为 2026-05-23 的审计证据，不再作为当前事实源。MCP 五入口、Workspace API 路径、客户端支持目标和 operation 完成度以 `docs/Architecture.md`、`docs/PROTOCOLS.md`、`docs/IMPLEMENTATION-DECISION-REGISTER.md` 和当前 verifier 为准。

审计日期：2026-05-23
范围：docs/ 全部设计文档 vs server/ 实际实现

---

## 一、致命问题：Architecture.md 内部自相矛盾

**`docs/Architecture.md` 第 231 行 vs 第 593 行给出了两套互斥的 MCP 工具面模型：**

| | 第 231 行（语义分类模型）✅ 实际在用 | 第 593 行（26 个扁平工具名）❌ 未实现 |
|---|---|---|
| 形态 | `pact.knowledge` / `pact.workspace` / `pact.list` / `pact.skill` / `pact.help` + `pact.call` | `workspace.info`, `workspace.file.upload`, `knowledge.search`, ... 共 26 个 |
| 状态 | **已实现** | **22/26 未在 operation-registry 中找到** |

同一篇文档的第 231 行说"MCP `tools/list` 必须且只能返回 5 个语义分类入口"，然后第 593 行又列出了 26 个扁平工具名。`docs/PROTOCOLS.md` 第 849-875 行照搬了这 26 个扁平工具名。

**建议：立即删除 Architecture.md 第 593-622 行和 PROTOCOLS.md 第 849-875 行的扁平工具名列表，它们代表的是已被废弃的旧方案。**

---

## 二、协议层定义了但实现层完全缺失的模块

以下协议在 PROTOCOLS.md 中有完整的语义定义，但 `operation-registry.mjs` 中**零注册**：

### 2.1 `pact.workspace-contribution.v1` — 终端贡献治理（零实现）

| 协议要求 | 注册表状态 |
|----------|-----------|
| contribution.submit / scanned / reviewed / published / adopted / deprecated / revoked 状态机 | ❌ 没有任何 contribution.* 操作 |
| 排行榜 rankScoreV0 | ❌ 无 |
| 资产贡献统计报表 assetContributionReportV0 | ❌ 无 |
| contributionGrant / loanRecord / permissionRequest | ❌ 无 |

**影响**：P0-00-02 生产阻塞项名义上最核心的功能——"终端贡献型资产治理"——协议写了 118 行，操作注册表里一个条目都没有。

### 2.2 `pact.agent-library.v1` / `pact.knowledge-access.v1` — 图书馆借阅（零实现）

| 协议要求 | 注册表状态 |
|----------|-----------|
| libraryCard / knowledgeAccessReceipt / loanRecord | ❌ 无 |
| accessMode 8 级裁决（deny → checkoutAllowed） | ❌ 无 |
| 上游知识库 A/B 权限再授权 | ❌ 无 |
| receipt list / denied request audit | ❌ 无 |

**影响**：P0-00 是"智能体知识源头权限门禁缺失"，这正是 AgentLibrary 的核心。`access-policy.mjs` 文件存在但其接口未注册到 dispatcher。

### 2.3 `pact.code-review.v1` — 代码审查（零实现）

PROTOCOLS.md 定义了 `workspace.code.target.evaluate` / `workspace.code.change.prepare` / `workspace.code.change.upload` / `workspace.code.change.status.sync`。注册表中完全没有这四个 ID。存在的是 `gerrit.*` 和 `repo.*` 系列，属于不同领域。

---

## 三、路径前缀不一致

PROTOCOLS.md 第 113-133 行定义的 Workspace API 使用 `/api/workspaces/:workspaceId/...`，实际实现使用 `/api/agent-workspaces/:workspaceId/...`。**15+ 个端点路径全部对不上。**

| PROTOCOLS.md 声称 | 实际实现 |
|-------------------|---------|
| `GET /api/workspaces/:wsId/context` | `GET /api/agent-workspaces/:wsId/context` |
| `POST /api/workspaces/:wsId/tasks` | 不存在（task 概念已合并到 agentWorkspace） |
| `POST /api/workspaces/:wsId/observations` | 不存在 |
| `POST /api/workspaces/:wsId/artifacts` | 不存在（artifact 由 `agentWorkspace.file.upload` 间接创建） |

---

## 四、PROTOCOLS.md 引用了 7 个不存在的操作

| 声称的操作 | 实际情况 |
|-----------|---------|
| `workspace.checkpoint.diff` | 不存在，diff 能力通过 `repo.diff.read` |
| `workspace.checkpoint.node.get` | 不存在 |
| `workspace.checkpoint.scope.query` | 不存在 |
| `workspace.operation.revert.scope` | 不存在 |
| `knowledge.dossier.export` | 不存在 |
| `knowledge.distillation.export` | 不存在（有 `knowledge.distillation.workbench.*` 但不是同一个） |
| `raw-corpus.format.convert` | 不存在 |

---

## 五、PRODUCTION-CAPABILITY-GAP.md 过时

文档中列出的 17 个 P1-03 到 P3-03 的缺口项**已经被实现**（对应 operation 已注册），但仍标记为未解决：

| 缺口 ID | 内容 | 实际状态 |
|---------|------|---------|
| P1-01 | 会话 merge/compare | ✅ `agent_sessions.compare/merge_proposal/archive` 已注册 |
| P1-02 | 前端治理界面 | ✅ `ProductionHealthView.vue` 存在 |
| P1-03 | 模型网关降级 | ✅ `model_routing.health` 已注册 |
| P1-04 | 工具/技能生命周期 | ✅ `capability_packages.*` 4 个操作已注册 |
| P1-05 | 数据连接器治理 | ✅ `data_connectors.governance.*` 3 个操作已注册 |
| P1-06 | 性能基准 | ✅ `performance.capacity.targets/benchmark` 已注册 |
| P2-01 | 蒸馏持续优化 | ✅ `knowledge.evolution.*` 已注册 |
| P2-02 | 模块生态 SDK | ✅ `module_ecosystem.*` 4 个操作已注册 |
| P2-03 | 组织级治理 | ✅ `workspace_governance.*` 4 个操作已注册 |
| P2-04 | 资产溯源 | ✅ `asset_lineage.*` 4 个操作已注册 |
| P3-01 | Executive Report | ✅ `executive_report.*` 3 个操作已注册 |
| P3-02 | Architecture Live Map | ✅ `architecture.live_map` 已注册 |
| P3-03 | Sample Business Pack | ✅ `sample_business_pack.*` 3 个操作已注册 |

---

## 六、建议的优先级修复顺序

### P0 — 立即修复（文档自相矛盾，会误导开发者）

1. **删除** Architecture.md 第 593-622 行的 26 个扁平工具名
2. **删除** PROTOCOLS.md 第 849-875 行的同样内容
3. **修正** PROTOCOLS.md 第 113-133 行的 API 路径前缀：`/api/workspaces/` → `/api/agent-workspaces/`

### P1 — 补全缺失的实现（决定产品定位）

4. **实现 `pact.workspace-contribution.v1`** — contribution submit/review/publish + leaderboard（这是 P0-00-02 阻塞项）
5. **实现 `pact.knowledge-access.v1`** — receipt/loan record/accessMode 裁决（这是 P0-00 阻塞项）

### P2 — 文档更新

6. **更新 PRODUCTION-CAPABILITY-GAP.md** — 将已实现的 17 个 P1-P3 项标记为已解决
7. **删除** PROTOCOLS.md 中 7 个不存在的操作引用，或标注为"未实现"
8. **删除** PROTOCOLS.md 中 `pact.code-review.v1` 的 `workspace.code.*` 操作，或 rename 为 `repo.*`

---

## 七、统计数据

| 指标 | 数值 |
|------|------|
| 注册的操作总数 | ~230 |
| 文档声称但缺失的操作 | 29 |
| 协议有定义但零实现的模块 | 3 个（contribution, knowledge-access, code-review） |
| 已实现但文档仍标记为"缺口"的项 | 17 |
| 路径前缀错误 | 15+ |
| 文档内部自相矛盾 | 1 处（Architecture.md 行 231 vs 行 593） |
