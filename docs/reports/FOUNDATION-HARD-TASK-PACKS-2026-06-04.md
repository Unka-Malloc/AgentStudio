# Foundation Hard Task Packs (2026-06-04)

## Metadata / 元数据

- Last updated: 2026-06-07
- Status: Superseded assessment retained for planning context
- Scope: Foundation Hard Task Packs (2026-06-04).
- Staleness check: Scanned on 2026-06-07; older blocked/readiness statements are historical context and are superseded by docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

目的：为 T03/T06/T08/T11/T12/T17/T18 提供可并行派发的单功能任务包。

约束：
- 不允许 fake path/provider/receipt。
- 不允许把 key/token/secret/运行数据/测评集/runtime 缓存写入仓库。
- 所有真实副作用必须先进入 Operation Scheduling Kernel。
- 高危操作必须走 pending_operation + /approval。
- GUI 继续 Flutter；CLI 后端继续 Rust；不引入 mobile 交付。

## 当前基线状态

- T00 最小前置已补齐：`docs/scenarios/scenario-implementation-status.json` + `server/scripts/verify-scenario-implementation-status.mjs`。
- T03/T06/T11/T12/T17/T18 相关多数 verifier 可运行。
- 已知 blocker：
  - `npm run server:verify:runtime-dependency-downloads` 当前工作树通过；T03-c 的 runtime dependency metadata 基线已闭环。

- 最近闭环：
  - `npm run server:verify:authorization-governance`、`server:verify:authorization-capabilities`、`server:verify:opaque-capability-key`、`server:verify:tool-management`、`server:verify:mcp-http`、`server:verify:gateway-ingress` 当前工作树通过，T08 的权限变更实时生效基线已闭环。

## 任务包格式

每个子任务包含：目标、可改文件范围、禁止项、验收门禁、测试命令、依赖任务、回写文档。

---

## T03 包

### T03-a 统一数据目录解析
- 目标：统一 `PACT_SERVER_DATA_DIR` / 外部配置 / `~/.pact-server-data` 解析优先级。
- 可改文件范围：`server/scripts/start-server.mjs`、`server/scripts/resolve-server-data-dir.mjs`、`server/platform/**/ServerConfig*`、`docs/SERVER.md`。
- 禁止项：新增仓库内默认数据目录；硬编码个人路径。
- 验收门禁：空配置时默认落到 `~/.pact-server-data`；显式 env 覆盖生效。
- 测试命令：`npm run server:verify:entity-config-layout`。
- 依赖任务：无。
- 回写文档：`docs/SERVER.md`、`docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`。

### T03-b secret/config 外移与 secretRef 引用
- 目标：真实值不落仓库，仅 `secretRef`/环境变量/外部配置引用。
- 可改文件范围：`server/platform/common/security/**`、`server/config/**`、`tests/verify-secret-hygiene.mjs`、`docs/KNOWLEDGE-GOVERNANCE.md`。
- 禁止项：把真实 secret 写入 fixture/log/snapshot。
- 验收门禁：仓库中出现 secret 模式即失败；配置中仅保留引用。
- 测试命令：`npm run security:hygiene`、`npm run server:verify:secret-init`。
- 依赖任务：T03-a。
- 回写文档：`docs/KNOWLEDGE-GOVERNANCE.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`。

### T03-c runtime 依赖 manifest 与 checksum
- 目标：JRE/Tika/runtime 依赖具备版本、checksum、来源与外部安装位置。
- 可改文件范围：`server/platform/specialized/capabilities/runtime-dependencies/**`、`server/scripts/verify-runtime-dependency-downloads.mjs`、`docs/SERVER.md`。
- 禁止项：把 runtime 下载产物提交仓库。
- 验收门禁：缺依赖时返回 blocked/install-needed；版本字段不可空。
- 测试命令：`npm run server:verify:runtime-dependency-downloads`。
- 依赖任务：T03-a。
- 回写文档：`docs/SERVER.md`、`docs/TEST-FRAMEWORK.md`。

### T03-d repo/secret hygiene 阻断
- 目标：阻断 key、`.pact-server-data`、运行数据库、测评集、邮件样本进入仓库。
- 可改文件范围：`tests/verify-root-hygiene.mjs`、`tests/verify-secret-hygiene.mjs`、`docs/TEST-FRAMEWORK.md`。
- 禁止项：扩大 allowlist 绕过检查。
- 验收门禁：负向 fixture 必须能触发失败。
- 测试命令：`npm run repo:hygiene`、`npm run security:hygiene`。
- 依赖任务：T03-b。
- 回写文档：`docs/TEST-FRAMEWORK.md`。

### T03-e SQLite migration 版本化记录
- 目标：迁移执行可审计，版本递进可回放。
- 可改文件范围：`server/scripts/migrate-*.mjs`、`server/platform/**/migration*`、`docs/SERVER.md`。
- 禁止项：隐式裸升级。
- 验收门禁：migration 记录包含版本、时间、结果。
- 测试命令：`npm run server:verify:entity-config-layout`。
- 依赖任务：T03-a。
- 回写文档：`docs/SERVER.md`。

## T06 包

### T06-a operation registry 分类
- 目标：明确受管 operation 分类与注册元数据完整性。
- 可改文件范围：`server/platform/common/operation-dispatcher/operation-registry.mjs`、`server/scripts/verify-protocol-operation-registration.mjs`。
- 禁止项：删除已有 operation 规避验证。
- 验收门禁：operation 必须具备 safety/inputSchema/audit/requiredScopes。
- 测试命令：`npm run server:verify:protocol-operations`。
- 依赖任务：T00、T03。
- 回写文档：`docs/PROTOCOLS.md`。

### T06-b kernel accept + ledger started/pending
- 目标：所有入口先入内核并分配 operationId，再写 ledger。
- 可改文件范围：`server/platform/common/operation-dispatcher/**`、`server/platform/common/security/operation-audit.mjs`。
- 禁止项：直接执行 provider side effect。
- 验收门禁：ledger 不可写时副作用不得发生。
- 测试命令：`npm run server:verify:dispatcher-unified`、`npm run server:verify:operation-policy`。
- 依赖任务：T06-a。
- 回写文档：`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`。

### T06-c 阻断未经过内核的副作用
- 目标：构造负向样例，证明旁路调用被拒绝。
- 可改文件范围：`server/scripts/verify-dispatcher-unified.mjs`、`server/platform/**/tool-registry*.mjs`。
- 禁止项：仅日志警告不阻断。
- 验收门禁：至少 1 条旁路路径返回 `operation_unmanaged`/等价拒绝。
- 测试命令：`npm run server:verify:dispatcher-unified`。
- 依赖任务：T06-b。
- 回写文档：`docs/PROTOCOLS.md`。

### T06-d trace/receipt/policy/idempotency 语义
- 目标：统一 traceId、receipt 与失败原因关联。
- 可改文件范围：`server/scripts/verify-trace-context.mjs`、`server/scripts/verify-runtime-logging.mjs`、`server/platform/common/security/**`。
- 禁止项：删减审计字段通过测试。
- 验收门禁：按 traceId 可追溯完整决策链。
- 测试命令：`npm run server:verify:trace-context`、`npm run server:verify:runtime-logging`。
- 依赖任务：T06-b。
- 回写文档：`docs/Architecture.md`。

### T06-e 纵向迁移一条真实链路
- 目标：先迁移 1 条外部副作用链路到内核，再扩展。
- 可改文件范围：`server/platform/specialized/**`（单条链路）+ 对应 verifier。
- 禁止项：一次性改多链路导致不可回归。
- 验收门禁：该链路从入口到 ledger 全链路可复现。
- 测试命令：按链路执行 `npm run server:verify:*`。
- 依赖任务：T06-c、T06-d。
- 回写文档：`docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`。

## T08 包

### T08-a policy revision 与 active grant 重算
- 目标：policy 变更即刻重算 grant。
- 可改文件范围：`server/platform/common/security/authorization/**`。
- 禁止项：要求重启才能生效。
- 验收门禁：撤销后同连接能力即时消失。
- 测试命令：`npm run server:verify:authorization-governance`。
- 依赖任务：T03、T06。
- 回写文档：`docs/PROTOCOLS.md`。

### T08-b Tool Management catalog + MCP discovery 刷新
- 目标：权限变化驱动目录刷新。
- 可改文件范围：`server/platform/specialized/capabilities/tools/**`、`server/platform/common/mcp/**`。
- 禁止项：本地静态缓存绕过。
- 验收门禁：撤销 grant 后 tools/list 立即变化。
- 测试命令：`npm run server:verify:mcp-http`、`npm run server:verify:tool-management`。
- 依赖任务：T08-a。
- 回写文档：`docs/PROTOCOLS.md`。

### T08-c SSE list_changed 通知
- 目标：目录变化主动推送客户端。
- 可改文件范围：`server/platform/common/mcp/http-mcp-adapter.mjs`、`server/scripts/verify-mcp-http.mjs`。
- 禁止项：轮询替代通知。
- 验收门禁：收到机器可读 list_changed/operation_reply。
- 测试命令：`npm run server:verify:mcp-http`。
- 依赖任务：T08-b。
- 回写文档：`docs/PROTOCOLS.md`。

### T08-d capability/opaque key policy version 校验
- 目标：旧 policy version key 写操作拒绝。
- 可改文件范围：`server/platform/common/security/**opaque*`、`server/scripts/verify-opaque-capability-key.mjs`。
- 禁止项：兼容旧 key 写入。
- 验收门禁：旧 version key 写操作失败并有审计。
- 测试命令：`npm run server:verify:opaque-capability-key`。
- 依赖任务：T08-a。
- 回写文档：`docs/WORKSPACE-ASSET-GOVERNANCE.md`。

### T08-e 上游网关缓存失效
- 目标：撤销授权后 gateway 缓存即时失效。
- 可改文件范围：`server/scripts/gateway-ingress.mjs`、`server/scripts/verify-gateway-ingress.mjs`。
- 禁止项：仅 TTL 等待。
- 验收门禁：同会话下权限变更立即生效。
- 测试命令：`npm run server:verify:gateway-ingress`。
- 依赖任务：T08-a。
- 回写文档：`docs/PROTOCOLS.md`。

### T08-f 权限/key 外部持久化
- 目标：重启后保持授权状态，不需手工重配。
- 可改文件范围：`server/platform/common/security/auth/**`、`server/scripts/verify-authorization-governance.mjs`。
- 禁止项：将 key 存仓库。
- 验收门禁：重启后 key/grant 仍有效且版本正确。
- 测试命令：`npm run server:verify:authorization-governance`。
- 依赖任务：T03-b、T08-d。
- 回写文档：`docs/SERVER.md`。

## T11 包

### T11-a Skill package schema + checksum
- 目标：Skill 包 manifest、SKILL.md、checksum 结构固化。
- 可改文件范围：`server/platform/specialized/capabilities/package-lifecycle/**`。
- 禁止项：无 checksum 包进入激活态。
- 验收门禁：坏包被拒绝。
- 测试命令：`npm run server:verify:capability-package-lifecycle`。
- 依赖任务：T06、T08。
- 回写文档：`docs/PROTOCOLS.md`。

### T11-b `pact.skillHub.upload` 独立存储
- 目标：Skill 包进入独立 skill library，workspace 仅引用。
- 可改文件范围：`server/platform/specialized/capabilities/skills/**`、`server/scripts/verify-tool-skill-management.mjs`。
- 禁止项：继续把包本体放 workspace contribution。
- 验收门禁：上传后 skill library 有独立记录。
- 测试命令：`npm run server:verify:tool-skill-management`。
- 依赖任务：T11-a。
- 回写文档：`docs/WORKSPACE-ASSET-GOVERNANCE.md`。

### T11-c 签名/扫描/pin/rollback
- 目标：lifecycle 中加入签名、扫描、pin 与回滚。
- 可改文件范围：`server/platform/specialized/capabilities/package-lifecycle/**`。
- 禁止项：跳过 scan 即激活。
- 验收门禁：缺签名或扫描失败不可激活。
- 测试命令：`npm run server:verify:capability-package-lifecycle`。
- 依赖任务：T11-a。
- 回写文档：`docs/KNOWLEDGE-GOVERNANCE.md`。

### T11-d lifecycle 状态机收敛
- 目标：scanned/reviewed/activated/disabled/revoked/rollback 完整状态机。
- 可改文件范围：`server/platform/specialized/capabilities/package-lifecycle/**`。
- 禁止项：隐式状态跳转。
- 验收门禁：非法跃迁被拒绝。
- 测试命令：`npm run server:verify:capability-package-lifecycle`。
- 依赖任务：T11-c。
- 回写文档：`docs/PROTOCOLS.md`。

### T11-e catalog/discovery 原子刷新
- 目标：激活/禁用/revoke 对 catalog 与 discovery 原子生效。
- 可改文件范围：`server/platform/specialized/capabilities/tools/**`、`server/platform/common/mcp/**`。
- 禁止项：半启用状态。
- 验收门禁：刷新失败时不产生部分可见。
- 测试命令：`npm run server:verify:tool-skill-management`。
- 依赖任务：T11-d。
- 回写文档：`docs/PROTOCOLS.md`。

### T11-f disabled/revoked 可见性与执行拒绝
- 目标：同 grant 下 revoked skill 不可见不可执行。
- 可改文件范围：`server/platform/specialized/capabilities/skills/**`。
- 禁止项：仅隐藏 UI 不阻断执行。
- 验收门禁：执行请求返回拒绝并写审计。
- 测试命令：`npm run server:verify:tool-skill-management`。
- 依赖任务：T11-e。
- 回写文档：`docs/KNOWLEDGE-GOVERNANCE.md`。

## T12 包

### T12-a provider mode schema 统一
- 目标：统一 `contract/local-live/remote-live/dry-run/failed`。
- 可改文件范围：`server/platform/common/operation-dispatcher/protocol-operation-definitions.mjs`、`server/scripts/verify-v001-cloud-drive-e2e.mjs`。
- 禁止项：使用模糊 mode 文案。
- 验收门禁：API/UI/receipt 使用同词表。
- 测试命令：`npm run server:verify:v001-cloud-drive-e2e`。
- 依赖任务：T03、T06、T07、T08。
- 回写文档：`docs/PROTOCOLS.md`。

### T12-b receipt 字段统一
- 目标：receipt 必须包含 mode、verificationSource、remoteId/localProjectionId。
- 可改文件范围：`server/platform/**/receipt*`、`server/scripts/verify-v001-cloud-drive-e2e.mjs`。
- 禁止项：contract 伪装 remote-live。
- 验收门禁：remote-live 返回 fileId/etag/webUrl 等价字段。
- 测试命令：`npm run server:verify:v001-cloud-drive-e2e`。
- 依赖任务：T12-a。
- 回写文档：`docs/SERVER.md`。

### T12-c OneDrive local projection adapter
- 目标：接通 OneDrive 本机同步目录投影上传/下载/覆盖/只读拒绝 smoke。
- 可改文件范围：`server/platform/common/composition-management/external-service-registry.mjs`、`server/platform/specialized/**cloud*`。
- 禁止项：把本机目录投影声明为 remote-live 或远端云 API 成功。
- 验收门禁：本机投影标 `localAdapterVerified` / `localProjectionVerified`；OAuth / remote-live 缺凭据时标 contract-only/blocked。
- 测试命令：`npm run server:verify:v001-cloud-drive-e2e`。
- 依赖任务：T12-b。
- 回写文档：`docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`。

### T12-d iCloud local-live adapter 语义收敛
- 目标：iCloud 本机目录 adapter 仅声明 local-live。
- 可改文件范围：`server/platform/specialized/**cloud*`、`server/scripts/verify-v001-cloud-drive-e2e.mjs`。
- 禁止项：把 local-live 描述成 remote-live。
- 验收门禁：receipt 文案明确 local projection。
- 测试命令：`npm run server:verify:v001-cloud-drive-e2e`。
- 依赖任务：T12-a。
- 回写文档：`docs/PROTOCOLS.md`。

### T12-e UI/API/文档 mode 一致展示
- 目标：控制台、API、文档一致显示 provider mode。
- 可改文件范围：`server-web/**`、`docs/SERVER.md`、`docs/PROTOCOLS.md`。
- 禁止项：仅改某一端。
- 验收门禁：contract 不显示为 live。
- 测试命令：`npm run server:verify:v001-cloud-drive-e2e`、`npm run server:verify:frontend-architecture`。
- 依赖任务：T12-a、T12-b。
- 回写文档：`docs/SERVER.md`。

### T12-f contract/fake provider 不得替代 live
- 目标：门禁上阻断“contract 即 live”误判。
- 可改文件范围：`server/scripts/verify-v001-cloud-drive-e2e.mjs`、`server/scripts/verify-external-service-api-registration.mjs`。
- 禁止项：放宽断言使 contract 通过 live 门禁。
- 验收门禁：live 门禁需要真实凭据与 remote 字段证据。
- 测试命令：`npm run server:verify:v001-cloud-drive-e2e`。
- 依赖任务：T12-c。
- 回写文档：`docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`。

## T17 包

### T17-a profile/preset schema
- 目标：feature profile 与 composition preset schema 固化。
- 可改文件范围：`server/platform/interactive/features/feature-manifest.mjs`、`server/scripts/feature-profiles.mjs`。
- 禁止项：schema 漂移无 verifier。
- 验收门禁：plan 输出模块、ports、secret refs、runtime assets、verifier。
- 测试命令：`npm run feature:plan -- --edition enterprise`、`npm run feature:verify -- --edition enterprise`。
- 依赖任务：T01、T03、T06。
- 回写文档：`docs/FEATURE-PROFILES.md`。

### T17-b personal 轻量预设
- 目标：personal 不包含 Postgres/Redis/S3/KMS/集群依赖。
- 可改文件范围：`server/platform/interactive/features/feature-manifest.mjs`、`server/scripts/verify-feature-profiles*`。
- 禁止项：引入企业中间件为默认。
- 验收门禁：personal plan 不含企业强依赖。
- 测试命令：`npm run server:verify:feature-profiles`。
- 依赖任务：T17-a。
- 回写文档：`docs/FEATURE-PROFILES.md`。

### T17-c enterprise adapter/port 预设
- 目标：enterprise 经 port/adapter 接已有企业中间件。
- 可改文件范围：`server/platform/common/composition-management/**`、`server/scripts/composition-presets.mjs`。
- 禁止项：把 enterprise 依赖回灌 personal。
- 验收门禁：enterprise plan 明确 required ports/secret refs。
- 测试命令：`npm run composition:verify`、`npm run server:verify:composition-presets`。
- 依赖任务：T17-a。
- 回写文档：`docs/FEATURE-PROFILES.md`。

### T17-d dehydrate verifier
- 目标：附加模块禁用后核心链路仍可运行。
- 可改文件范围：`server/scripts/composition-presets.mjs`、`server/scripts/verify-composition-presets.mjs`。
- 禁止项：通过跳过检查假绿。
- 验收门禁：dehydrate 输出 `ok=true` 且回归可跑。
- 测试命令：`npm run composition:dehydrate`、`npm run server:verify:composition-presets`。
- 依赖任务：T17-b、T17-c。
- 回写文档：`docs/FEATURE-PROFILES.md`。

### T17-e membership/secret/runtime assets/audit 清单
- 目标：模块元数据完整声明可脱水属性。
- 可改文件范围：`server/platform/**/module.json`、`docs/FEATURE-PROFILES.md`。
- 禁止项：隐式依赖。
- 验收门禁：缺字段模块不能进入 profile。
- 测试命令：`npm run feature:verify -- --edition enterprise`。
- 依赖任务：T17-a。
- 回写文档：`docs/FEATURE-PROFILES.md`。

## T18 包

### T18-a 统一治理状态词表
- 目标：模块/外部服务/Skill/Tool Package/mount 共享状态词表。
- 可改文件范围：`server/platform/common/module-manager/**`、`server/platform/common/composition-management/**`。
- 禁止项：新增私有状态机分叉。
- 验收门禁：状态词表冲突时 verifier 失败。
- 测试命令：`npm run server:verify:unified-registration`。
- 依赖任务：T06、T07、T08、T17。
- 回写文档：`docs/PROTOCOLS.md`。

### T18-b create-module 模板
- 目标：模板生成模块具备最小合同与文档。
- 可改文件范围：`server/scripts/pact-create-module.mjs`、`server/platform/common/module-manager/**`。
- 禁止项：生成无 contract 测试模板。
- 验收门禁：新模块可通过 contract test。
- 测试命令：`npm run server:module:contract-test`（带显式参数）。
- 依赖任务：T18-a。
- 回写文档：`docs/DEVELOPER-GUIDELINES.md`。

### T18-c module contract test
- 目标：模块必须通过可执行 contract test。
- 可改文件范围：`server/scripts/pact-module-contract-test.mjs`、`server/scripts/verify-module-ecosystem.mjs`。
- 禁止项：无参数仅打印 usage 视为通过。
- 验收门禁：至少 1 个真实模块合约样例通过。
- 测试命令：
  - `npm run server:verify:module-ecosystem`
  - `node server/scripts/pact-module-contract-test.mjs --module ./server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs --mount-name knowledgeBase --sample ./README.md`
- 依赖任务：T18-b。
- 回写文档：`docs/PROTOCOLS.md`。

### T18-d 外部服务 registration/health/scope/secretRef/audit
- 目标：外部服务注册要带 scope、secretRef、health 和审计。
- 可改文件范围：`server/platform/common/composition-management/external-service-registry.mjs`、`server/scripts/verify-external-service-api-registration.mjs`。
- 禁止项：裸 secret、裸 URL、未审计副作用。
- 验收门禁：注册不全直接失败。
- 测试命令：`npm run server:verify:external-service-api-registration`。
- 依赖任务：T18-a。
- 回写文档：`docs/PROTOCOLS.md`、`docs/SERVER.md`。

### T18-e disable/revoke 同步失效
- 目标：禁用后 catalog/discovery/gateway/grant 同步失效。
- 可改文件范围：`server/platform/specialized/capabilities/tools/**`、`server/platform/common/mcp/**`、`server/scripts/verify-unified-registration.mjs`。
- 禁止项：部分路径继续可调用。
- 验收门禁：disable/revoke 后调用立即拒绝。
- 测试命令：`npm run server:verify:unified-registration`、`npm run server:verify:mcp-http`。
- 依赖任务：T18-d。
- 回写文档：`docs/PROTOCOLS.md`。

### T18-f asset lineage 接入
- 目标：外部结果进入 Pact 后具备 lineage/source metadata hash。
- 可改文件范围：`server/platform/specialized/knowledge/**`、`server/scripts/verify-asset-lineage.mjs`。
- 禁止项：无 lineage 即入库。
- 验收门禁：raw object -> derived -> export 可追溯。
- 测试命令：`npm run server:verify:asset-lineage`。
- 依赖任务：T18-d。
- 回写文档：`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/KNOWLEDGE-GOVERNANCE.md`。
