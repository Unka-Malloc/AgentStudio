# Coverage 95% 闭环计划与本轮进展（2026-06-04）

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Active coverage backlog
- Scope: Coverage 95% 闭环计划与本轮进展（2026-06-04）.
- Staleness check: Scanned on 2026-06-11; the 95% coverage closure backlog remains open unless a newer coverage scan supersedes this file.

## 一、结论

本轮已并行拉起多组 `gpt-5.3-codex-spark` worker，按 `client-gui`、`client-cli`、`server-web` 纯函数、`server` 大模块分别补测试。当前结果是：

- `client-gui` 已达标：`95.73%`（`561 / 586`）
- `client-cli` 已达标：`95.03%`（`3693 / 3886`）
- `server` 未达标：`13.77%`（`5916 / 42960`）
- `server-web` 未达标：`6.14%`（`753 / 12271`）

因此，全局 `npm run test:unit-coverage:scan` 仍未通过。失败原因已经收敛为 `server` 与 `server-web` 的全量覆盖分母过大，而不是客户端覆盖不足。

本轮没有通过调整阈值、改覆盖率 include/exclude、删除源码、写假 LCOV、加 ignore 注释等方式绕过门禁。

## 二、本轮验证结果

已通过：

- `npm run test:node-vue:coverage`
  - `16` 个测试文件通过
  - `189` 个用例通过
  - Node/Vue 总行覆盖：`12.07%`（coverage summary），LCOV 合计 `6690 / 55231 = 12.11%`
- `npm run test:unit-coverage:scan`
  - 执行成功但门禁失败，失败项为 `server`、`server-web`

当前门禁输出：

| Area | Coverage | Covered / Total | 状态 |
| --- | ---: | ---: | --- |
| `server` | `13.77%` | `5916 / 42960` | 未达标 |
| `server-web` | `6.14%` | `753 / 12271` | 未达标 |
| `client-gui` | `95.73%` | `561 / 586` | 已达标 |
| `client-cli` | `95.03%` | `3693 / 3886` | 已达标 |
| `scope:maintenance-agent-config` | `96.23%` | `51 / 53` | 已达标 |
| `scope:server-web-routes` | `100.00%` | `24 / 24` | 已达标 |
| `scope:console-format-utils` | `100.00%` | `65 / 65` | 已达标 |

## 三、起始基线

本轮启动前执行 `npm run test:unit-coverage:scan` 的基线：

| Area | Coverage | Covered / Total |
| --- | ---: | ---: |
| `server` | `0.77%` | `332 / 42864` |
| `server-web` | `0.00%` | `0 / 12126` |
| `client-gui` | `52.40%` | `251 / 479` |
| `client-cli` | `73.66%` | `2137 / 2901` |

本轮净进展：

| Area | 起始 | 当前 | 变化 |
| --- | ---: | ---: | ---: |
| `server` | `0.77%` | `13.77%` | `+13.00pp` |
| `server-web` | `0.00%` | `6.14%` | `+6.14pp` |
| `client-gui` | `52.40%` | `95.73%` | `+43.33pp` |
| `client-cli` | `73.66%` | `95.03%` | `+21.37pp` |

## 四、本轮已落地测试范围

新增或显著扩展的测试文件：

- `tests/vitest/server-web/routes.test.ts`
- `tests/vitest/server-web/console-format-utils.test.ts`
- `tests/vitest/server-web/high-coverage-lib-utils.test.ts`
- `tests/vitest/server/maintenance-agent-*.test.mjs`
- `tests/vitest/server/console-domain-operation-executor.test.mjs`
- `tests/vitest/server/knowledge-storage-core.test.mjs`
- `tests/vitest/server/agent-workspace.test.mjs`
- `tests/vitest/server/batch-repository.test.mjs`
- `tests/vitest/server/security-authorization-core.test.mjs`
- `tests/vitest/server/mcp-and-dispatcher-core.test.mjs`
- `client-gui/test/manual_target_dialog_test.dart`
- `client-gui/test/portable_data_root_test.dart`
- `client-gui/test/target_card_test.dart`
- `client-gui/test/theme_test.dart`
- `client-cli/src/**` 内新增 Rust 单元测试分支

代表性源文件覆盖结果：

| 源文件 | 当前行覆盖 |
| --- | ---: |
| `server/platform/common/storage/batch-repository.mjs` | `77.00%` |
| `server/platform/common/security/authorization/authorization-engine.mjs` | `88.11%` |
| `server/platform/specialized/knowledge/storage/knowledge-core/index.mjs` | `50.00%` |
| `server/platform/specialized/agent/agent-workspace/index.mjs` | `46.62%` |
| `server/platform/specialized/console/console-domain-operation-executor.mjs` | `18.66%` |
| `server-web/router/routes.ts` | `100.00%` |
| `server-web/composables/console-format-utils.ts` | `100.00%` |
| `server-web/lib/bridge.ts` | `100.00%` |
| `server-web/lib/upload-file-list.ts` | `97%+` 语句覆盖 |
| `server-web/lib/knowledge-upload-session.ts` | `100%` 语句覆盖 |

## 五、为什么全局还没有到 95%

`server` 要超过 95%，按当前分母 `42960` 计算，需要命中至少 `40813` 行。当前命中 `5916` 行，还差约 `34897` 行。

`server-web` 要超过 95%，按当前分母 `12271` 计算，需要命中至少 `11658` 行。当前命中 `753` 行，还差约 `10905` 行。

也就是说，剩余不是“几个边界分支”问题，而是大量模块仍是 0 覆盖或接近 0 覆盖。继续推进必须以模块级拆分方式执行。

## 六、下一轮优先任务

### Server P0：继续啃最大未覆盖模块

优先级按未覆盖行数排序：

1. `server/platform/specialized/console/console-domain-operation-executor.mjs`
   - 当前 `490 / 2626`
   - 下一轮目标：覆盖 `executeKnowledgeManagementOperation`、`executeAuthorizationFacadeOperation`、workspace/agent/system 分发后段。
2. `server/platform/specialized/knowledge/preprocessing/domain/rules/transaction-continuity-model.mjs`
   - 当前 `0 / 977`
   - 下一轮目标：交易连续性规则、归一化、评分、拒绝路径。
3. `server/platform/specialized/capabilities/tools/tool-management-core/store.mjs`
   - 当前 `0 / 818`
   - 下一轮目标：catalog 原子刷新、pin、rollback、签名/扫描状态。
4. `server/services/client/work-queue-core/jobs/job-manager.mjs`
   - 当前 `0 / 774`
   - 下一轮目标：后台队列任务创建、状态迁移、失败重试、代码提交场景 receipt。
5. `server/platform/specialized/capabilities/tools/agent-exploration-runtime/index.mjs`
   - 当前 `0 / 750`
   - 下一轮目标：输入校验、运行状态、错误分支。
6. `server/platform/specialized/agent/cloud-drive-port/index.mjs`
   - 当前 `13 / 741`
   - 下一轮目标：OneDrive/iCloud provider mode、上传下载 receipt、失败映射。
7. `server/platform/specialized/agent/agent-gateway/index.mjs`
   - 当前 `0 / 687`
   - 下一轮目标：上游网关切面、权限拒绝、统一审批。

### Server-Web P0：先覆盖 composable/controller 层

优先级按未覆盖行数排序：

1. `server-web/composables/external-services-view-controller.ts`
   - 当前 `0 / 389`
2. `server-web/views/ExternalServicesView.vue`
   - 当前 `0 / 240`
3. `server-web/views/admin/AgentAssignmentView.vue`
   - 当前 `0 / 234`
4. `server-web/composables/console-navigation-controller.ts`
   - 当前 `0 / 175`
5. `server-web/composables/useConsole.ts`
   - 当前 `0 / 160`
6. `server-web/composables/knowledge-distillation-workbench-controller.ts`
   - 当前 `0 / 146`
7. `server-web/composables/console-rule-authoring-controller.ts`
   - 当前 `0 / 142`
8. `server-web/composables/console-ops-monitor-controller.ts`
   - 当前 `0 / 139`
9. `server-web/composables/console-word-cloud-utils.ts`
   - 当前 `0 / 136`

下一轮不建议先补大量 Vue SFC 快照；优先补 composable/controller 的纯逻辑、状态迁移、错误格式化、请求参数归一化。SFC 只补高价值交互和可稳定断言的渲染状态。

## 七、验收门禁

每个后续 worker 必须满足：

1. 只增加真实测试，不改覆盖率阈值、不改 include/exclude、不伪造 LCOV、不加 ignore。
2. 写入范围必须互不重叠，避免并发冲突。
3. 测试数据目录不得写进项目目录；临时目录使用系统 temp 或 `~/.pact-server-data`。
4. 每个测试文件单跑必须通过：
   - `npm run test:node-vue -- --run <test-file>`
5. 汇总必须通过：
   - `npm run test:node-vue:coverage`
6. 每轮结束必须运行：
   - `npm run test:unit-coverage:scan`
7. 最终闭环标准：
   - `server > 95%`
   - `server-web > 95%`
   - `client-gui > 95%`
   - `client-cli > 95%`

## 八、当前状态

本轮已完成一批有效覆盖率提升，但全局 95% 尚未闭环。下一步应继续以 `server` 与 `server-web` 的最大未覆盖模块为单位分批派发 worker，直到两个剩余区域跨过 95%。
