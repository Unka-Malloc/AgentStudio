# Pact 历史报告综合决策队列

> 归档说明：本文是 2026-06-03 的决策过程记录，已从当前报告层移入 `docs/reports/history/`。当前任务顺序和验收口径以 `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md` 为准。

日期：2026-06-03  
性质：从 `docs/reports/history/` 归纳出的当前决策队列。  
用途：把历史进度、审计、缺口、缺陷和 readiness 报告里的重复问题合并成一份可批量确认的工作清单。

本文不是新的架构事实源。被确认的长期结论必须回写到 `docs/Architecture.md`、`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/KNOWLEDGE-GOVERNANCE.md`、`docs/PRODUCTION-CAPABILITY-GAP.md` 或对应运行支持文档。

## 来源范围

本次综合覆盖：

- `docs/reports/history/` 顶层 21 份历史报告、计划、审计、差距和基线文档。
- `docs/reports/history/production-readiness/` 中 28 个历史生产准入运行报告目录，以最新可读 `20260531T173448Z/report.md` 作为 readiness 状态口径。
- `docs/reports/history/v001-readiness/` 中 2 个 v0.0.1 readiness 运行报告目录，以 `20260525T171911Z/report.md` 和 migration report 作为 v0.0.1 状态口径。

## 归并原则

- 同一问题在多个历史文档重复出现时，只保留一个决策项。
- 已经由维护者确认并已落地的事项不再进入待询问队列。
- `contractVerified`、`dry-run`、`mocked`、`localAdapterVerified` 只代表合同或本地适配通过，不代表真实外部 provider 已生产可用。
- 最新 readiness 报告里的阻塞项优先级高于较早的历史审计判断。
- P0 只保留会阻断端到端场景、生产准入、安全边界、用户误导或基础维护秩序的事项。

## 已处理或不再询问的历史 P0

| 项 | 结论 |
| --- | --- |
| 许可证口径冲突 | 已确认统一为 `GPL-3.0-or-later`。 |
| `/approval` 独立页面 | 已确认恢复为独立页面。 |
| `PRODUCT.md` 根目录位置 | 已移动到 `docs/PRODUCT.md`。 |
| `.pact-server-data` 位置 | 已确认使用 `~/.pact-server-data`，和项目源码目录解耦。 |
| 根目录本地报告和历史文档 | 已归档到 `docs/reports/history/`。 |
| 生产报告输出目录 | 已改到 `docs/reports/history/production-readiness/` 和 `docs/reports/history/v001-readiness/`。 |
| `report/history` 归档规则 | 已形成 `docs/reports/history/` 归档区，当前综合文档放在 `docs/reports/`。 |

## P0 决策队列

### P0-01：生产准入仍被真实文档解析样例阻塞

状态：已确认。

问题：最新生产准入历史报告 `20260531T173448Z` 的 overall status 为 `blocked`，唯一失败 gate 是 `document-parsing-real-sample`。知识蒸馏进展台账也把成熟上传链路、全尺寸文件闭环、格式 openability、PDF 视觉版面、多模态图片理解和真实评估闭环列为主线 P0。

确认结论：

- 把“真实文档解析样例 + openability + 结构锚点 + 动态切分 + DOCX 导出基准”作为下一批 P0。
- 网上可下载公开 PDF / Word / Excel / PPT 测评集，本机 Mail 邮件也可用于真实复杂度样本。
- 所有测评集一律放到外部数据目录，不准放到项目内部。
- 默认外部目录为 `~/.pact-server-data/evaluation-corpora/`。
- 项目内只保留下载脚本、manifest/schema、校验规则、小型合成 fixture 和 verifier 源码。

下一步：补最小真实样本矩阵、manifest 和 verifier，目标是让 `document-parsing-real-sample` 从 blocked 变成 pass。测评集治理规则见 `docs/DOCUMENT-EVALUATION-CORPUS.md`。

来源：

- `docs/reports/history/production-readiness/20260531T173448Z/report.md`
- `docs/reports/history/KNOWLEDGE-DISTILLATION-PROGRESS.md`
- `docs/reports/history/PROJECT-PROGRESS-ASSESSMENT-2026-06-03.md`

### P0-02：代码提交缺少 durable workflow 和 GitHub live receipt

状态：已确认。

问题：场景 01 仍被两个断点阻塞：代码提交没有进入任务队列 / durable workflow；GitHub PR 路径可能停留在 contract receipt 或示例 URL。

确认结论：

- 代码提交必须做成后台任务，不允许 MCP / Console 同步直打 Gerrit 或 GitHub provider。
- 代码提交必须先进入 durable workflow / background queue，再由 Codespace / Code Review worker 执行。
- 这轮需要顺便优化当前后台任务队列，使它适配代码提交场景。
- GitHub live adapter 优先使用 GitHub API/App；CLI 只能作为本地 fallback。

队列优化范围：

- 任务 payload 必须保存 `operationId`、`traceId`、`idempotencyKey`、workspace/repo/worktree、目标 provider、审批决策、actor/grant/policy snapshot。
- 任务状态至少覆盖 `queued`、`running`、`waiting_approval`、`retrying`、`completed`、`failed`、`canceled`。
- worker 必须支持重启恢复、失败重试、幂等去重、超时和取消。
- 提交结果必须写回 code-change registry、operation audit、queue history、provider receipt 和 MCP `operation_reply`。
- provider receipt 必须区分 `contractVerified`、`dry-run`、`live-created`、`live-synced` 和 `failed`；live 成功后必须保存真实 Gerrit Change 或 GitHub PR URL/number/id。

下一步：设计并实现 code submission workflow 与 queue adapter，验收覆盖排队、重启恢复、失败重试、重复 idempotencyKey 去重、审批后恢复执行、真实/模拟 provider receipt 和审计查询。

来源：

- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/V0.0.1-IMPLEMENTATION-PLAN.md`
- `docs/reports/history/PROJECT-PROGRESS-ASSESSMENT-2026-06-03.md`

### P0-03：知识蒸馏权限纳入外部服务上游网关切面

状态：已确认，已补齐网关切面覆盖门禁。

当前事实：

- 管控台左侧“知识库”分组下已经有“知识蒸馏”入口。
- 前端已有 `KnowledgeDistillationWorkbench` 正式工作台组件，支持 run 列表、创建、取消、归档、删除、重跑、比较和导出。
- 历史报告里的“缺少正式管控台入口”不再作为当前 P0。

确认结论：

- 知识蒸馏不单独建立特殊权限体系。
- 知识蒸馏作为外部服务能力，权限应与其它外部服务对接一致，通过上游网关切面统一管理。
- 网关切面负责 subject、tenant、workspace、source scope、artifact export、egress、audit receipt 和 denied decision。
- `external.knowledge.distillation.runs.list/get/create/cancel`、`evidence.query`、`projects.evidence.query`、`artifacts.export` 全部必须带 `external-upstream-gateway` 切面、required scopes、受控 `/api/external/knowledge/distillation/*` API 和 Tool Management 映射。
- 兼容工作台操作 `knowledge.distillation.workbench.*` 只能作为 deprecated migration shim 保留，不对智能体暴露，不运行旧内部算法面；进入兼容壳前仍必须经过 console authorization。
- 产物下载 URL、package export、stage export、compare、delete/archive 都不能绕过同一权限切面。下载和导出只能通过受控 operation 返回，不能给调用方一个可绕过授权的裸 URL。

落地状态：`server:verify:knowledge-distillation-workbench` 和 `server:verify:external-service-api-registration` 已检查外部上游网关切面、required scopes、受控路径、Tool Management 暴露和内部兼容壳不对智能体暴露。

来源：

- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/KNOWLEDGE-DISTILLATION-PROGRESS.md`
- `docs/reports/history/KNOWLEDGE-DISTILLATION-AUDIT.md`

### P0-04：权限配置需要刷新 MCP grant/key 和网关策略

状态：已确认。

问题：权限保存成功不等于已经连接的智能体和上下游网关立即生效。历史差距要求 governance mutation 生成 policy version，并让 active grants、MCP SSE、gateway cache 和 capability set 刷新或失效。同时，grant/key 是持久身份凭据，系统重启不能要求用户重新配置一遍 key。

确认结论：

- 权限变更必须立刻对已连接智能体生效；同一个 MCP token/key 的下一次请求要按最新 policy version、grant projection 和 gateway policy 裁决。
- key/token/grant 本身必须持久化到外部 server data dir，重启后自动恢复；除非用户显式撤销、过期或轮换，不得要求重新配置。
- 项目目录内任何位置都不得保存真实 key、token、secret value、运行态配置、provider manifest、mount config 或本地 Pact 数据目录；门禁必须扫描仓库范围内的本地数据目录、运行态配置文件和密钥文件名，`repo:hygiene` 也必须执行 secret 内容扫描。
- key rotation 是单独的安全动作，不能作为普通权限刷新机制；普通权限变更只刷新策略、标记 stale/version、推送 `permissions.updated` / tools list changed，并让网关缓存失效。
- P0 验收必须覆盖：权限变更后无需重装 MCP/重新复制 token；同一 token 的 allow/deny 结果按新权限变化；重启后旧 token 仍可作为身份凭据使用，但权限裁决仍读取最新策略。
- P0 门禁必须覆盖：`build/`、`docs/`、`tests/`、源码目录等项目自有路径都不能藏 `.pact-agent-history`、`.pact-server-data`、`.splitall-server-data`、`build/server-data`、`build/local-data`、真实邮件下载/导入目录、运行态 `settings.json`、`knowledge-backends.json`、`codespace-providers.json`、`cloud-drive-connections.json`、mount config、`.sealing-key`、`csrf-hmac-secret.bin`、`.env`、私钥、service account、client secret 或 token 文件；真实运行态配置和凭据状态只能进 `~/.pact-server-data` 或系统 secret store。

下一步：把场景 03 的验收实现为“持久 grant/key + 实时策略裁决 + 网关缓存刷新 + SSE 通知 + audit policyVersion”。 

来源：

- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/V0.0.1-IMPLEMENTATION-PLAN.md`
- `docs/reports/history/COMMERCIALIZATION-IMPROVEMENT-PLAN.zh-CN.md`

### P0-05：Skill Hub 上传必须进入独立技能库

状态：已确认。

问题：历史差距指出 `workspace.skill.upload` 和 capability package lifecycle 没有形成“智能体上传技能包 -> 独立 server skill library -> 校验 -> 激活 -> MCP discovery 刷新”的闭环。

确认结论：

- `pact.skillHub.upload` 固定为真实技能包上传入口，上传结果必须进入独立 server Skill Hub / skill library。
- 技能包不得只作为 workspace contribution 管理；workspace contribution 可以记录来源、采用、排行榜、审核意见和引用关系，但不能承载技能包文件、版本、发布状态和启用事实源。
- 兼容入口 `workspace.skill.upload/list/download/usage.report` 若继续保留，必须路由到 Skill Hub / capability package lifecycle，不得直接写 `workspace.contribution` registry。
- 独立技能库必须保存 skillId、version、manifest、bundle digest/signature、source workspace、uploader、review state、active/deprecated/disabled 状态、rollback target 和 MCP discovery projection。
- P0 验收必须覆盖：MCP 上传最小技能包后，`<userDataPath>/knowledge-skills/` 或等价 Skill Hub store 出现独立记录；workspace contribution 只出现引用/统计记录；激活、禁用、回滚会刷新 MCP `pact.skillHub` 可见能力并写 audit。

下一步：把 `workspace.skill.upload` 的现有 contribution fallback 收敛为兼容路由，并补 `pact.skillHub.upload` -> capability package lifecycle -> skill library -> active discovery 的端到端 verifier。

来源：

- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/client-design-review-2026-05-26.md`
- `docs/reports/history/PROJECT-PROGRESS-ASSESSMENT-2026-06-03.md`

### P0-06：外部云盘不能长期停留在 contract-mode

状态：已确认。

问题：历史口径曾要求 OneDrive 必须从 contract-mode 直接升级 remote-live。2026-06-06 已重新决议：v0.0.1 当前范围先收敛为 iCloud / OneDrive 本机目录投影；Google Drive / Dropbox 仍是 contract-mode；外部云盘远端 API 真实上传 / 下载作为后续目标。

确认结论：

- 第一批 v0.0.1 真实可运行上传 / 下载 provider 固定为 iCloud + OneDrive 本机目录投影。
- iCloud 继续走受控本机路径 / 本机 iCloud Drive 投影，必须保持默认空间、公共空间和高级只读目录的路径隔离；公开响应不得泄漏本机绝对路径。
- OneDrive 当前先走受控本机 OneDrive 同步目录投影，必须保持默认空间、公共空间和高级只读目录的路径隔离；公开响应不得泄漏本机绝对路径。
- OneDrive OAuth / Microsoft Graph live adapter 是后续适配目标，届时支持 secretRef、refresh、scope 校验、上传、下载、列目录、权限摘要和 provider receipt。
- Google Drive / Dropbox 暂时保留 contract-mode / 后续 provider 位置，不能计入本轮 P0 live 完成。
- fake provider server 只能作为 CI / contract harness，不能作为产品第一版真实云盘完成口径。
- v0.0.1 local projection receipt 至少包含 provider、connectionId、scope snapshot、local projection path digest、content hash、byte count、upload/download receipt、audit id、checkpoint id、`localAdapterVerified` / `localProjectionVerified` 状态；不得包含本机绝对路径、raw token 或私有下载 URL。
- v0.0.1 验收必须覆盖：同一最小样例文件可以分别上传到 iCloud 和 OneDrive 本机投影，再凭 receipt 下载校验 hash；OneDrive receipt 不得只标 `contractVerified`，也不得伪装成 `remoteLiveVerified`。

下一步：把 OneDrive OAuth / Microsoft Graph remote-live adapter 作为后续目标；把 fake provider server 固定为 contract 测试工具；readiness 报告继续区分 local projection、contract 和 remote-live。

来源：

- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/v001-readiness/20260525T171911Z/report.md`
- `docs/reports/history/COMMERCIALIZATION-IMPROVEMENT-PLAN.zh-CN.md`

### P0-07：全系统状态变更必须统一落账

状态：已确认。

问题：当前历史报告显示 operation audit、console log、tool audit、provider ledger、queue event 多套并存，仍可能有后台 worker、provider helper 或 domain helper 绕过统一审计。

确认结论：

- 所有操作都必须进入统一 Operation Ledger / audit facade。
- 所有操作必须封装进统一调度内核，即 Operation Scheduling Kernel；只有调度内核受理、分配 `operationId`、写入 `started/pending` 账本并完成策略裁决的 operation，才算 Pact 里的真实操作。
- 范围包括：API / RPC / MCP / CLI / 控制台入口、读请求、写请求、权限裁决、拒绝、后台任务、workflow activity、队列状态变更、外部 IO、provider adapter 调用、webhook 处理、工具执行、模型调用、解析 / 蒸馏 / 上传 / 下载 / 代码提交 / 云盘同步、配置和密钥引用变更。
- 统一账本是事实源；console log、tool audit、provider ledger、queue event、runtime log、trace span 只能作为投影、回执或索引，不能替代统一账本。
- Operation Registry 只是目录和合同，不是执行许可；HTTP / RPC / CLI / MCP / 控制台 / worker 只能提交 intent envelope 给调度内核，不能直接调用业务 executor。
- 非调度内核路径触发的业务函数、provider side effect、状态写入或工具执行一律拒绝为 `operation_unmanaged` / `operation_not_scheduled`，只允许留下拒绝记录，不允许产生真实副作用。
- 写操作和外部副作用必须先创建 `started/pending` ledger entry，再执行副作用；如果账本不可写，操作必须失败在副作用之前。
- 读操作和高频查询也不能只进接口日志；可以做会话级聚合或轻量 checkpoint，但必须能按 operationId / traceId / subject / target / reason 查询。
- 内部 helper 不需要为同一次请求的每个函数调用递归建账，但必须继承父 `operationId` / `traceId`，并把重要子步骤作为 span、receipt 或 child event 关联回统一账本。
- P0 验收必须覆盖：MCP tool call、控制台操作、后台 worker、provider 调用、权限拒绝和失败重试都能从调度内核获得同一 operation record，并能从同一 ledger 查询到完整链路；绕过调度内核或账本的写路径被 verifier 阻断。

下一步：把现有 Operation Dispatcher 升级成 Operation Scheduling Kernel，收敛各模块本地 audit / queue event / provider ledger 写入点，补统一内核 facade 和静态门禁，确保受管 operation 无法绕过内核与账本。

来源：

- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/PROJECT-PROGRESS-ASSESSMENT-2026-06-03.md`
- `docs/reports/history/platform-foundation-coupling-audit-2026-05-25.md`

### P0-08：高危 MCP 操作需要 pending operation 审批和恢复

状态：已确认。

问题：`requiresConfirmation` 或同步拒绝不等于主页审批流。场景 08 要求高危 MCP 操作被挂起到 `/approval`，审批后恢复原请求，拒绝或过期则不执行。

确认结论：

- 统一审批。所有需要人工确认或高风险审批的 operation，都必须由 Operation Scheduling Kernel 创建 `pending_operation`。
- 范围不只 MCP：API / RPC / CLI / MCP / 控制台 / worker / provider side effect 触发的高危操作都走同一套 pending operation 和 `/approval` 页面。
- `/approval` 是独立页面，统一承载 MCP 授权请求、高危操作 pending execution、代码提交审批、云盘外发审批、配置 / 密钥引用变更审批、恢复 / 删除 / reindex / runtime mount 等高危维护审批。
- `pending_operation` 必须保存原始 intent envelope、operationId、traceId、idempotencyKey、subject、operator、agentProfile、workspace、grant / token 摘要、requestedScopes、risk reason、policy decision、approvalScope、expiresAt、payload hash、redacted input summary 和恢复指针。
- 审批通过后只能恢复原 operation，沿用原 `operationId` / `traceId`，追加 approval decision / receipt / checkpoint，再由调度内核继续执行；不能另起一个绕过原策略的新 operation。
- 审批拒绝、过期、撤销或上层 policy hard deny 时，原 operation 必须终止，不允许产生业务副作用。
- 审批只能满足“需要人工确认 / 授权”的门槛，不能覆盖租户、workspace、dataClass、egress、provider scope、Capability Kernel 或 Binding Guard 的硬拒绝。
- P0 验收必须覆盖：高危 MCP tool、控制台 repair 操作、CLI 写操作、worker 外部副作用都能被挂起到 `/approval`；批准后恢复原 operation；拒绝 / 过期后副作用不发生；智能体收到 `operation_reply`。

下一步：把当前 `requiresConfirmation`、Tool Management pending operations、authorization approvals 和控制台审批流收敛到 Operation Scheduling Kernel 的统一 `pending_operation` 模型，并补 `/approval` E2E verifier。

来源：

- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/PROJECT-HYGIENE-BASELINE-2026-06-03.md`

### P0-09：外部知识蒸馏服务按远程容器默认部署收紧边界

问题：外部知识蒸馏服务是大单文件，包含子进程、Tika、PDF、压缩包、邮件、Office 等解析路径。维护者已确认默认远程访问，后续单独部署到容器，通过网络通信。

已确认：

- 必须先做门禁。入站鉴权、非 root 容器用户、Tika 下载 checksum 固定、healthcheck、网络边界、超时和资源上限全部列为 P0。
- 容器态默认要求 `PACT_EXTERNAL_KD_API_TOKEN`，token 只能来自外部运行配置或 secret store，不能写入项目目录。
- `/health` 和 `/v1/runtime/health` 可作为编排健康检查公开；`/v1/capabilities`、run 列表、创建、取消、证据和 artifacts 等业务 API 必须通过 bearer gate。
- 新增解析器、格式路由、模型蒸馏或导出能力前，必须先通过 `npm run server:verify:external-knowledge-distillation-service-gates`。
- `external-services/knowledge-distillation-service/server.mjs` 需要后续拆分；拆分前只允许门禁、安全、运维和缺陷修复类改动继续进入大文件，不继续堆新能力。

拒绝选项：

- 不接受外部知识蒸馏容器裸 API 默认可用。
- 不接受把 API token、模型 key、OAuth token 或其它密钥写进仓库任意目录。
- 不接受在未通过门禁 verifier 前继续增加新解析能力或新模型蒸馏能力。

落地状态：已新增服务入口 bearer gate、容器非 root / healthcheck / Tika checksum 门禁和 `server:verify:external-knowledge-distillation-service-gates`。

来源：

- `docs/reports/history/PROJECT-HYGIENE-BASELINE-2026-06-03.md`
- `docs/reports/history/KNOWLEDGE-DISTILLATION-PROGRESS.md`
- `docs/reports/history/KNOWLEDGE-DISTILLATION-AUDIT.md`

### P0-10：客户端协议和智能体支持目标需要补齐

状态：已确认。

问题：客户端历史审查把 OpenCode 缺失、Skill Hub 协议引用空指针、client pairing / adapter protocol 缺失列为 P0。后续客户端不能只覆盖 GUI agent，也要覆盖 terminal / CLI agent。

确认结论：

- 客户端和 MCP connector 的第一批一等支持目标固定为 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf。
- 这不是开放问题，后续不再反复询问支持哪些智能体客户端。
- `client-cli`、`client-gui`、`pact-mcp-connector`、server MCP discovery、local grant target match、安装 / 卸载 / doctor 文档和 verifier 都必须使用同一份目标清单。
- `pact.skill-hub.v1`、`pact.client-pairing.v1`、`pact.adapter-protocol.v1` 这类协议名只在有最小字段、版本和 verifier 后写入 `PROTOCOLS.md`；没有达到门槛时按 CLI contract / deferred boundary 表达。

下一步：把代码和文档中的 supported target、first target adapter、client boundary 和 MCP install matrix 统一到这 11 个目标，并用 `server:verify:agent-client-support-targets` 守住清单。

来源：

- `docs/reports/history/client-design-review-2026-05-26.md`
- `docs/CLIENT_ARCHITECTURE.md`
- `docs/reports/history/CLIENT-IMPLEMENTATION-PLAN.md`

### P0-11：前端架构边界继续作为硬门禁

状态：已确认。

问题：前端历史审计的 P0 包括 `useConsole()` 过大、组件直接调用 bridge、大组件混合状态和副作用、CSS 全局过大、API/type contract 单体化。部分已经拆分并有 verifier，但仍需作为硬约束防止回流。

确认结论：

- 前端后端访问必须收敛到统一接口层：`server-web/lib/*-client.ts` 负责后端路径、HTTP method、参数和返回类型。
- 页面和组件只负责展示与用户交互；不得直接 `fetch()`、直接调用全局 `bridge.*`、自行拼 `/api/...` 后端 URL 或绕过对应 controller。
- 页面状态、loading/error、刷新和业务动作必须放在对应 view/domain controller 中，例如 `console-*-controller.ts` 或专门 view controller。
- `useConsole()` 继续瘦身，只保留全局 shell、登录态、导航和公共刷新；具体业务能力迁回各自 controller。
- `bridge.*` 只作为兼容 facade 和明确 allowlist 边界存在；新 view/component 不得把它作为通用后端入口。
- 300 行级大 view/component、CSS ownership、focused controller 和 type domain split 继续作为前端架构硬门禁。

下一步：以 `server:verify:frontend-architecture` 继续守住页面 / 组件不得直接访问后端的规则；后续迁移按页面推进 `/approval`、外部服务、runtime downloads、clients、knowledge / distillation，把剩余状态和副作用收敛到 domain client + controller。

来源：

- `docs/reports/history/SERVER-WEB-FRONTEND-AUDIT-2026-06-01.md`
- `docs/reports/history/PROJECT-HYGIENE-BASELINE-2026-06-03.md`

### P0-12：历史文档矛盾需要回写到核心文档或标注为 superseded

状态：已确认。

问题：历史审计曾指出 MCP 五语义入口与旧 26 个扁平工具名、Workspace API 路径前缀、SUBSYSTEM checklist 与客户端架构等口径矛盾。部分问题可能已被后续实现改变，但历史文档仍会误导维护者。

确认结论：

- `docs/reports/history/` 只作为历史审计、阶段计划、临时进度、生产 readiness run 输出和旧任务总结归档。
- 旧文档正文不重写，避免破坏当时证据；只加目录说明和关键旧报告顶部归档标注。
- 当前事实以 `docs/Architecture.md`、`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/KNOWLEDGE-GOVERNANCE.md`、`docs/PRODUCTION-CAPABILITY-GAP.md`、`docs/IMPLEMENTATION-DECISION-REGISTER.md` 和当前 verifier 为准。
- 旧 MCP 工具名、旧 Workspace API 路径、旧客户端支持目标、旧 readiness 结论和旧 checklist 完成度，只能作为当时状态参考，不能直接复用到新实现或新文档。
- 新安全审计和当前缺陷不塞回 history，进入当前报告或本综合队列继续决策。

落地状态：已新增 `docs/reports/history/README.md`，并给最容易误导的旧设计审计、客户端审查、平台耦合审计、子系统 checklist 和资源操作草案追加归档标注。

来源：

- `docs/reports/history/design-audit-2026-05-23.md`
- `docs/reports/history/client-design-review-2026-05-26.md`
- `docs/reports/history/platform-foundation-coupling-audit-2026-05-25.md`

### P0-13：安全审计高危项要不要作为发布前硬阻塞

状态：已确认，H-1 / H-2 已落地。

问题：`docs/SECURITY-VULNERABILITY-AUDIT.md` 新增了 3 个高危、6 个中危、5 个低危和 4 个信息性发现。里面有两类问题：一类是小改动就能直接堵住的硬伤，另一类是需要构建、部署或前端渲染链路配合的系统改造。

确认结论：

- H-1 CSRF token 时间安全比较和 H-2 主 Dockerfile 非 root 运行列为必须立刻修复的 P0 发布阻塞项，并进入 `server:verify:security-hardening` 门禁。
- H-3 CSP 去掉 `unsafe-inline` 不和本轮小修混在一起，先登记为安全硬化缺口，等 Vite 构建 nonce/hash 方案一起做。
- M-1 iframe sandbox、M-3 初始凭据日志、M-5 HTTP 全局限流、L-3 `.dockerignore` 加固作为紧随其后的短批次修复。

落地状态：`server/platform/common/security/auth/console-auth.mjs` 已改为时间安全 CSRF 比较；主 `Dockerfile` runtime stage 已创建并切换到 `pact` 非 root 用户；`server/scripts/verify-security-hardening.mjs` 已加入静态门禁。

暂缓记录：H-3、M-1、M-3、M-5、L-3 已记录到 `docs/reports/SECURITY-HARDENING-BACKLOG-2026-06-03.md`，当前不继续修代码。

来源：

- `docs/SECURITY-VULNERABILITY-AUDIT.md`
- `docs/reports/SECURITY-HARDENING-BACKLOG-2026-06-03.md`

## P1 归并队列

状态：已批准。

P1 不在早期 P0 确认范围内，但历史报告反复出现的 P1 可以归为以下批次：

详细解释、可批量回复模板和维护者补充约束见 `docs/reports/P1-DECISION-EXPLANATION-2026-06-03.md`。

| 批次 | 归并主题 | 主要来源 |
| --- | --- | --- |
| P1-A | 安装和接入成为第一产品能力：一命令安装、doctor、真实配置写入、远端智能体接入页。 | `COMMERCIALIZATION-IMPROVEMENT-PLAN.zh-CN.md` |
| P1-B | 共享空间产品化：大文件流式、路径级 ACL、版本恢复、跨智能体演示。 | `SCENARIO-IMPLEMENTATION-GAPS.md`、`PROJECT-PROGRESS-ASSESSMENT-2026-06-03.md` |
| P1-C | 技能包 lifecycle 与 Tool Management catalog 原子同步，补安全扫描、依赖隔离、签名、pin、回滚。 | `SCENARIO-IMPLEMENTATION-GAPS.md`、`PROJECT-HYGIENE-BASELINE-2026-06-03.md` |
| P1-D | 配置边界、SQLite migration、后端超大模块拆分、后端静态边界检查。 | `PROJECT-HYGIENE-BASELINE-2026-06-03.md` |
| P1-E | runtime assets 和大二进制从 source checkout 迁出。 | `PROJECT-HYGIENE-BASELINE-2026-06-03.md` |
| P1-F | 客户端旧 smoke 脚本、Rust client keep/migrate/remove 清单、非 GUI agent pairing。 | `client-design-review-2026-05-26.md`、`CLIENT-IMPLEMENTATION-PLAN.md` |
| P1-G | 知识蒸馏 embedding、ranker、legacy Office、邮件解析、平台迁移壳删除。 | `KNOWLEDGE-DISTILLATION-PROGRESS.md` |
| P1-H | 前端 i18n / style 边界、新组件测试、shared utility type 收紧。 | `SERVER-WEB-FRONTEND-AUDIT-2026-06-01.md`、`PROJECT-HYGIENE-BASELINE-2026-06-03.md` |

## P2 归并队列

状态：已批准或降级。详细解释和维护者补充约束见 `docs/reports/P2-DECISION-EXPLANATION-2026-06-03.md`。

| 批次 | 归并主题 | 结论 |
| --- | --- | --- |
| P2-A | 多端客户端：桌面、iOS、Android、移动审批和分享入口。 | 降级，手机端先不做。 |
| P2-B | 云服务和私有化双线：个人云控制面、企业 Docker Compose / Kubernetes、升级迁移、审计导出。 | 批准，优先做；结合模块脱水能力，维护个人电脑轻量预设和企业私有化预设。 |
| P2-C | 场景级 verifier 和 `scenario-implementation-status.json`。 | 批准，提前到 P1 门禁批次。 |
| P2-D | provider 模式命名统一：`contract`、`local-live`、`remote-live`、`dry-run`、`failed`。 | 批准，提前到 P1，先统一 provider mode 和 receipt 字段。 |
| P2-E | 模块 SDK / 模板、组织级治理、多模态资产血缘。 | 批准，做模块和外部服务接入生态，统一治理逻辑和模块划分。 |
| P2-F | package scripts 过大、Node / Flutter 版本元数据、依赖 ownership。 | 批准，优先拆分。 |

## P3 归并队列

状态：已批准或搁置。详细解释和维护者补充约束见 `docs/reports/REMAINING-DECISION-EXPLANATION-2026-06-03.md`。

| 批次 | 归并主题 | 结论 |
| --- | --- | --- |
| P3-A | Skill、知识和服务生态：签名、下载、授权、撤销、使用统计、服务一次注册多智能体复用。 | 批准完整贡献者生态、市场和统计面板；不降级，不回退。 |
| P3-B | 管理层报告、架构图运行状态联动、样例业务包。 | 批准为 P3 维护项，不抢 P0/P1/P2。 |
| P3-C | 第三方 connector SDK、插件市场、多组织多租户、分布式 worker、mTLS fleet、S3/MinIO 生产部署。 | 搁置，拆成 connector SDK、多租户、分布式 worker、mTLS fleet、插件市场后再单独决策。 |

## 批量确认规则

后续不再逐项询问。尚未闭环和后续未决批次统一进入 `docs/reports/OPEN-DECISION-CHECKLIST-2026-06-03.md`。

维护者可以按编号批量回复：

- `批准`：进入路线或保持当前优先级。
- `调整`：保留事项，但修改范围、顺序、验收或拆分方式。
- `降级`：降低优先级，不进入当前批次。
- `搁置`：暂不进入路线。

批量回复后，再统一回写本文、核心文档和运行支持文档。
