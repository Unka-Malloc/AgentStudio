# Ordered Implementation Tasks

## Metadata / 元数据

- Last updated: 2026-06-07
- Status: Current implementation ordering and acceptance index
- Scope: Ordered Implementation Tasks.
- Staleness check: Scanned on 2026-06-07; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

日期：2026-06-03

用途：把已拍板的 P0/P1/P2/P3/S 系列事项整理成一份执行顺序清单。本文是当前任务排序和验收口径；早期讨论、Checklist 和解释文档已归档到 `docs/reports/history/`。

2026-06-06 复核：`docs/reports/history/v001-readiness/20260606T121950Z/report.md` 和 `docs/reports/history/production-readiness/20260606T122049Z/report.md` 均为 `pass`。当前可声明的是 v0.0.1 单机可交付基线、iCloud / OneDrive 本机目录投影 verified，以及缺真实凭据 provider 的 contractVerified；不能声明 OneDrive OAuth / Microsoft Graph remote-live 已完成，也不能声明 95% 全局覆盖率已闭环。2026-06-04 的 blocked 评估见 `docs/reports/CURRENT-IMPLEMENTATION-ASSESSMENT-2026-06-04.md`，只作为历史上下文。

全量子任务的正式软件设计说明书见 `docs/reports/DETAILED-SUBTASK-SPECS-2026-06-04.md`。该文档按 SDS 结构维护功能改造点、验收目标、接口设计、数据设计、安全设计、验证设计和变更控制。本文中的“单功能子任务切片”只作为索引，不再作为可直接派发的完整规格。

执行原则：

- 先做门禁、账本、审批、权限、数据边界，再做会产生真实副作用的业务能力。
- 先把 contract-mode / dry-run / live 状态说清楚，再对外宣称真实接通。
- 个人电脑轻量预设和企业私有化预设分开维护；附加能力必须可脱水。
- 每个任务完成时必须有功能改造、测试方法、用例和文档回写。

## 2026-06-04 执行进展（基础高难批次）

本轮先补最小必要前置（T00），再执行 T03/T06/T08/T11/T12/T17/T18 的门禁与最小纵向链路验证。

已落地改造：

- 新增场景状态事实源：`docs/scenarios/scenario-implementation-status.json`。
- 新增聚合门禁：`server/scripts/verify-scenario-implementation-status.mjs`。
- 新增脚本入口：`npm run server:verify:scenario-implementation-status`。
- 场景文档事实源回写：`docs/scenarios/README.md`。
- 子智能体任务包文档：`docs/reports/FOUNDATION-HARD-TASK-PACKS-2026-06-04.md`。

本轮通过的关键命令（证据）：

- T00：`npm run server:verify:scenario-catalog`、`npm run server:verify:business-scenarios`、`npm run server:verify:scenario-agent-code-submission`、`npm run server:verify:scenario-implementation-status`。
- T03：`npm run security:hygiene`、`npm run server:verify:secret-init`、`npm run server:verify:entity-config-layout`。
- T06：`npm run server:verify:dispatcher-unified`、`npm run server:verify:operation-policy`、`npm run server:verify:trace-context`、`npm run server:verify:state-mutations`、`npm run server:verify:runtime-logging`。
- T08：`npm run server:verify:authorization-governance`、`npm run server:verify:opaque-capability-key`、`npm run server:verify:mcp-http`、`npm run server:verify:gateway-ingress`。
- T11：`npm run server:verify:tool-skill-management`、`npm run server:verify:capability-package-lifecycle`、`npm run server:verify:knowledge-skillization`。
- T12：`npm run server:verify:v001-cloud-drive-e2e`、`npm run server:verify:external-service-api-registration`。
- T17：`npm run feature:plan -- --edition enterprise`、`npm run feature:verify -- --edition enterprise`、`npm run composition:list`、`npm run composition:verify`、`npm run composition:dehydrate`、`npm run server:verify:composition-presets`。
- T18：`npm run server:verify:module-ecosystem`、`npm run server:verify:unified-registration`、`npm run server:verify:asset-lineage`、`node server/scripts/pact-module-contract-test.mjs --module ./server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs --mount-name knowledgeBase --sample ./README.md`。
- 收尾：`git diff --check`、`npm run repo:hygiene`。

本轮 blocker：

- `npm run server:verify:runtime-dependency-downloads` 当前工作树通过，T03-c 的 runtime dependency manifest/version/source/install-location 基线已闭环。
- `npm run server:verify:authorization-governance`、`server:verify:authorization-capabilities`、`server:verify:opaque-capability-key`、`server:verify:tool-management`、`server:verify:mcp-http`、`server:verify:gateway-ingress` 当前工作树通过，T08 的权限变更实时生效门禁已闭环。
- `npm run server:verify:dynamic-document-parsing` 当前工作树通过；T14 的 `dynamic-parameter-v1` 前端绑定和 bridge/type 暴露缺口已补齐。
- `docs/examples/document-evaluation-corpus-manifest.schema.json` 与 `docs/examples/document-evaluation-corpus-manifest.template.json` 已补齐，T14-a 的外部 corpus manifest 规则已有仓库内事实源。
- `docs/examples/document-evaluation-corpus-public-smoke.json` 已补齐，T14-b 的公开 PDF/DOCX/XLSX/PPTX 样本 manifest 事实源已有 openability、结构锚点和导出预期占位。
- `docs/examples/document-evaluation-corpus-mail-local.template.json` 已补齐，T14-c 的本机 Mail 样本 manifest/隐私边界已有仓库内脱敏模板，明确只允许记录外部路径、hash 和 message/thread/attachment 统计。
- `document-parsing-runtime` / `preprocess-result` / `dynamic-parameter-document-parsing` 已补齐 T14-d：direct `sources` 入口保留 `contentHash/sourceMetadata/rawObject`，`preprocessResult.sourceTrace` 与 `structureArtifacts.metadata` 现输出 `sourceMetadataHash`、`parserTrace`/`parserTraceRef` 和 source locator，并由 `npm run server:verify:dynamic-document-parsing` 覆盖。
- `docx-human-renderer` / `normalized-documents` / `verify-knowledge-docx-export` 已补齐 T14-e：新增 Markdown 结构一致性基准（heading/list/table/paragraph 摘要）并写入 machine sidecar 与 manifest，`npm run server:verify:knowledge-docx-export` 现对 Markdown 输入语义、sidecar 基准与 DOCX OpenXML 输出做三方机器校验。
- `file-processor` / `document-parsing-runtime` 已补齐 T14-f：输入读取和解析失败现返回结构化 `failureReasons`，全失败时以 `reasonCode + failureReasons` 拒绝，不再只返回 warning 文案或空成功结果，并由 `npm run server:verify:dynamic-document-parsing` 覆盖。
- `verify-document-evaluation-corpus` 已把 T14-c 模板接入真实统计链：`npm run server:verify:document-evaluation-corpus` 现校验 Mail 模板隐私边界，并实际执行 `scripts/collect-dedupe-emails.mjs` 断言 message/thread/attachment 统计可生成且满足仓库允许元数据约束。
- `verify-knowledge-industrial-distillation` 已补齐 T15-c 的 clean-workspace 门禁语义：工业蒸馏质量基准改为基于吸收矩阵服务证据断言 8 项能力覆盖（不再被本地 reference checkout 缺失固定卡死在 0），且在存在本地 checkout 时仍保留 commit/source evidence 强校验。

状态说明：

- 缺真实外部凭据的 provider/live 门禁继续按 `contract` / `blocked` 记录，未宣称 `remote-live` 完成。

## 客观适用性评估

结论：2026-06-04 补充前，本文只能给熟悉 Pact 背景的人做排期参考，不能直接交给低上下文、低判断力执行智能体无偏差执行。原因是原文只写了任务目标和部分 verifier，没有把事实源、禁止项、停止条件、路径边界、provider 状态语义、设计理念和维护规范逐项写清楚。

本文补充后，执行者仍不得把它理解成“自动盲改清单”。如果遇到缺失脚本、缺失模块、事实源冲突、测试无法运行、需要真实外部凭据、需要改动历史归档正文或需要做破坏性操作，必须停下来记录 blocker，并更新对应报告或任务状态；不得自行发明 fake 路径、fake provider、fake receipt、临时绕过权限或口头声明完成。

## 低上下文执行规则

### 事实源读取顺序

1. 先读核心事实源：`docs/Architecture.md`、`docs/PROTOCOLS.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md`、`docs/KNOWLEDGE-GOVERNANCE.md`、`docs/SERVER.md`、`docs/CLIENT_ARCHITECTURE.md`、`docs/FEATURE-PROFILES.md`、`docs/TEST-FRAMEWORK.md`。
2. 再读决策和当前报告：`docs/IMPLEMENTATION-DECISION-REGISTER.md`、本文、`docs/reports/SECURITY-HARDENING-BACKLOG-2026-06-03.md`、`docs/SECURITY-VULNERABILITY-AUDIT.md`。
3. `docs/reports/history/` 只作历史证据，不作当前事实源。历史正文与核心文档冲突时，以核心文档、决策登记和当前 verifier 为准。
4. 如果本文和核心文档冲突，先按核心文档执行，并把冲突回写到本文或新报告中；不能选择更省事的口径。

### 全局禁止项

- 不得把任何 key、token、secret、外部服务配置、本地运行数据、测评集、邮件样本、runtime 下载缓存、模型文件或 `.pact-server-data` 放进项目目录。
- 不得使用 fake 路径、fake provider、fake receipt 或看起来像真实成功的 contract-mode 文案。`contract`、`dry-run`、`local-live`、`remote-live` 必须分清。
- 不得绕过 Operation Scheduling Kernel 直接执行真实副作用；不得只写模块本地 audit 或 provider log 就声明操作完成。
- 不得绕过统一审批、Tool Management、上游网关切面、Capability Key Kernel 或知识权限出口。
- 不得把 workspace contribution 当成 Skill Hub；技能包必须进入独立 Skill Hub / skill library。
- 不得把 GUI 技术栈从 Flutter 改掉，不得把 CLI 后端从 Rust 改掉，不得把手机端纳入当前交付。
- 不得新增只在本机可用的硬编码路径、环境假设或隐式依赖；所有默认路径必须来自配置解析、manifest 或显式参数。
- 不得为了让 verifier 通过而删除真实检查、扩大 allowlist、降低安全边界或改写历史报告正文。

### 设计理念

- 逻辑隔离先行，物理拆分延后。第一版可以是模块化单体，但模块边界、接口、状态和队列语义必须为未来拆分留好口子。
- Pact 是治理控制面。智能体、外部服务、云盘、Git provider、Skill、模块和客户端都可以各自强大，但进入公共空间的行为必须由 Pact 的 policy、operation、ledger、checkpoint 和 audit 裁决。
- 读请求也是行为。list、search、permission check、evidence read、context injection、export 和 download 都必须能审计、能解释、能撤销影响。
- 追加式恢复优先。不得用裸 reset、裸覆盖、裸删除代替受管 restore operation、version operation 或 rollback operation。
- 外部服务是上游能力，不是绕过 Pact 的后门。知识蒸馏、云盘、GitHub、未来 connector 都必须走统一治理、secretRef、provider mode、receipt 和审计。
- 个人电脑轻量预设和企业私有化预设是两条路线。个人电脑不部署集群；企业能力通过 port / adapter 接入企业已有中间件。

### 任务执行记录

- 开始一个任务前，先确认前置任务状态。T00-T08 是门禁和治理底座；后续真实副作用能力不能越过这些底座。
- 每个任务完成时，至少记录：改动文件、新增或更新的 verifier、手工 smoke 结果、失败或跳过原因、文档回写位置。
- 如果测试命令不存在，先用 `rg` 查找是否改名；确实不存在时，应新增对应 verifier 或把缺失登记为 blocker，不能把“命令不存在”当作通过。
- 如果需要真实第三方凭据，只能读取外部数据目录或 secret store 中的配置；缺凭据时只能证明 contract 或 dry-run，不能宣称 live。
- 收尾必须运行 `git diff --check` 和 `npm run repo:hygiene`；涉及服务端、客户端、安全、前端、场景或 feature profile 时，运行对应专项 verifier。

### 验收门禁口径

- `验收门禁` 是任务关闭条件，高于普通用例描述。用例可以帮助理解场景，门禁决定是否允许把任务状态改为 done。
- 每个任务必须同时满足：代码或文档改造已落地、对应 verifier 通过、负向用例可证明失败、事实源已回写、没有新增 fake 路径或未受管副作用。
- 如果某一条门禁依赖真实外部凭据、第三方环境、容器、云盘或本机 Mail 数据，缺环境时只能把该门禁标为 `blocked` 或 `contract-only`，不能把任务整体关掉。
- 如果实现过程中发现本文门禁和核心文档冲突，先按核心文档执行，并把冲突记录到本文或新的当前报告；不得为了关任务降低门禁。
- 任意门禁通过都必须有证据：命令输出、报告路径、fixture、receipt、audit id、operation id、screenshot 或手工 smoke 记录。没有证据的通过视为未通过。

## 总顺序

| 顺序 | 任务 | 来源 |
| --- | --- | --- |
| T00 | 场景状态和门禁基线 | P2-C |
| T01 | 脚本、版本和依赖治理 | P2-F |
| T02 | 前端门禁优先扩展 | P1-H |
| T03 | 配置、密钥、数据目录和 runtime 资产边界 | P1-D, P1-E |
| T04 | 安全短批次一 | S-02, S-03, S-04, S-05, S-06, S-08 |
| T05 | CSP 和 HTML 渲染安全批次 | S-01, S-07, S-09 |
| T06 | Operation Scheduling Kernel 和统一账本 | P0-07 |
| T07 | 统一审批和独立 `/approval` | P0-08 |
| T08 | 权限变更实时生效 | P0-04 |
| T09 | 11 个智能体安装、配对和客户端清理 | P0-10, P1-A, P1-F |
| T10 | 代码提交 durable workflow | P0-02 |
| T11 | Skill Hub 独立库和 lifecycle | P0-05, P1-C |
| T12 | provider mode、receipt 和 iCloud/OneDrive local projection | P0-06, P2-D |
| T13 | 共享空间产品化 | P1-B |
| T14 | 真实办公文档解析基准 | P0-01 |
| T15 | 知识蒸馏算法和办公文档质量升级 | P1-G |
| T16 | 前端剩余页面接口收敛 | P0-11 |
| T17 | 个人/企业两套可脱水预设构建线 | P2-B |
| T18 | 模块和外部服务接入生态 | P2-E |
| T19 | 管理报告、架构 live map 和样例业务包 | P3-B |
| T20 | 完整贡献者生态、市场和统计面板 | P3-A |
| T21 | P3-C 大包拆分决策 | P3-C |
| T22 | 手机端降级保护 | P2-A |
| T23 | 低危残余风险维护策略 | S-10 |

## 难度、范围、上下文和依赖评估

### 评估口径

- 难度：`S` 表示可由单个智能体在低风险范围内完成；`M` 表示需要理解一个子系统；`L` 表示跨多个模块或需要真实 smoke；`XL` 表示系统级改造，必须拆成多个子任务。
- 改动范围：`文档/门禁`、`单模块`、`跨模块`、`系统级`、`外部集成`。
- 上下文：`低`、`中`、`高`、`极高`。上下文越高，执行前越需要阅读核心设计文档和现有实现。
- `基础高难`：这类任务虽然难，但会影响后续真实副作用、权限、配置、账本或生态治理，必须优先稳定，不能因为困难而后移到业务能力之后。
- 依赖分为硬依赖和软依赖。硬依赖未完成时不得关闭后续任务；软依赖未完成时可以做接口、contract 或 dry-run，但不能宣称 live / done。

### 总览矩阵

| 任务 | 难度 | 改动范围 | 上下文 | 硬依赖 | 标注 |
| --- | --- | --- | --- | --- | --- |
| T00 | M | 文档/门禁 + verifier | 中 | 无 | 基础门禁 |
| T01 | M | 脚本 + 版本 + 依赖治理 | 中 | 无 | 基础门禁 |
| T02 | L | 前端门禁 + 测试 | 高 | T01 | 基础门禁 |
| T03 | XL | 配置 + 密钥 + runtime + 数据目录 | 极高 | T01 | 基础高难 |
| T04 | L | 安全 + Docker + HTTP + Vite | 高 | T03 | 安全前置 |
| T05 | L | CSP + HTML 渲染 + 前端构建 | 高 | T02, T04 | 安全前置 |
| T06 | XL | 调度内核 + 账本 + 副作用治理 | 极高 | T00, T03 | 基础高难 |
| T07 | L | 审批 API + 审批页 + MCP 回信 | 高 | T06 | 基础治理 |
| T08 | XL | 权限 + key + SSE + 网关缓存 | 极高 | T03, T06 | 基础高难 |
| T09 | L | 客户端安装 + 配对 + 旧模块清理 | 高 | T03, T08 | 产品底座 |
| T10 | XL | durable workflow + GitHub live | 极高 | T06, T07, T08 | 场景高风险 |
| T11 | XL | Skill Hub + lifecycle + catalog | 极高 | T06, T07, T08 | 基础高难 |
| T12 | XL | provider mode + iCloud/OneDrive local projection | 极高 | T03, T06, T07, T08 | 基础高难 |
| T13 | L | 共享空间 + ACL + 大文件 + 恢复 | 高 | T06, T07, T08 | 核心能力 |
| T14 | L | 外部 corpus + parser 基准 + lineage | 高 | T03 | 质量底座 |
| T15 | XL | 外部知识蒸馏 + 算法 + 办公文档 | 极高 | T03, T08, T14 | 场景高风险 |
| T16 | L | 前端接口收敛 + controller | 高 | T02, T07, T08 | 前端治理 |
| T17 | L | feature profile + 预设构建线 | 高 | T01, T03, T06 | 基础高难 |
| T18 | XL | 模块生态 + 外部服务治理 | 极高 | T06, T07, T08, T17 | 基础高难 |
| T19 | M | 管理报告 + live map + 样例包 | 中 | T00, T17 | P3 维护项 |
| T20 | XL | 贡献者生态 + 市场 + 统计 | 极高 | T11, T18, T19 | P3 高风险 |
| T21 | S | 决策和文档门禁 | 低 | 无 | 防跑偏 |
| T22 | S | 客户端交付边界 | 低 | T09, T17 | 防跑偏 |
| T23 | S | 安全残余风险维护 | 中 | T04, T05 | 维护项 |

### 依赖分层

- 第 0 层：T00、T01。先建立场景事实和脚本/依赖治理，后续任务才有统一 verifier 入口。
- 第 1 层：T02、T03。前端门禁和配置/数据边界可以并行，但 T03 是后续所有真实外部能力的硬前置。
- 第 2 层：T04、T05。安全短批次和 CSP/HTML 批次必须在真实业务能力扩大前完成。
- 第 3 层：T06、T08。Operation Scheduling Kernel 和权限实时生效是后续所有真实副作用、审批、Skill、云盘、代码提交的硬底座。
- 第 4 层：T07。统一审批依赖 T06，和 T08 配合后才能承接高危 operation。
- 第 5 层：T09、T10、T11、T12、T13、T14、T16。客户端、代码提交、Skill Hub、云盘、共享空间、文档基准和前端接口开始接入真实产品链路；其中 T10/T11/T12 不能越过 T06/T07/T08。
- 第 6 层：T15、T17、T18。知识蒸馏质量、双预设和模块生态依赖前面的数据边界、权限和调度底座。
- 第 7 层：T19、T20、T21、T22、T23。P3 管理和市场能力不抢 P0/P1/P2；T21/T22/T23 主要是防跑偏和维护。

### 子任务拆分原则

- `L` 和 `XL` 任务不得作为单个实现任务直接派发，必须拆成下面的单功能子任务。
- 每个子任务只能改一个功能面：schema、verifier、API、UI、provider adapter、receipt、policy、文档回写等不能无边界混做。
- 子任务完成时必须独立满足本任务的相关验收门禁，并记录证据。不能用“总任务以后会验证”来关闭子任务。
- 如果子任务发现缺少前置门禁，必须回到依赖任务补门禁或登记 blocker，不能在当前任务里临时绕过。

### 单功能子任务切片

正式软件设计规格见 `docs/reports/DETAILED-SUBTASK-SPECS-2026-06-04.md`。下面列表只保留编号和名称索引；派发任务时必须使用完整规格中的功能改造点、验收目标、接口/数据/安全约束和变更控制规则。

- T00：
  - T00-a：定义 `scenario-implementation-status.json` schema。
  - T00-b：把 8 个场景填入状态文件并绑定 verifier/evidence/blocker。
  - T00-c：新增聚合 verifier，阻断缺 operation/tool/verifier 的 `verified` 状态。
  - T00-d：让文档和后续控制台读取同一状态事实源。
- T01：
  - T01-a：盘点根 `package.json` 脚本并按责任域归类。
  - T01-b：建立 Node/Flutter/Rust/Java/Docker/Tika 版本元数据。
  - T01-c：建立关键依赖 owner 和影响范围清单。
  - T01-d：补脚本/依赖治理 verifier，阻断静默跳过。
- T02：
  - T02-a：前端直接后端访问门禁，阻断 `fetch`、硬编码 `/api` 和直接 `bridge.*`。
  - T02-b：i18n、style、shared type facade 边界门禁。
  - T02-c：公共组件 focused test 和豁免规则。
  - T02-d：稳定 id 门禁，阻断随机 id 破坏测试。
- T03：
  - T03-a：统一 data dir 解析和文档，默认 `~/.pact-server-data`。
  - T03-b：secret/config 外移，所有真实值只通过 `secretRef`、环境变量或外部配置引用。
  - T03-c：runtime dependency manifest、checksum、下载和外部安装位置。
  - T03-d：repo/secret hygiene 阻断项目内 key、运行数据、测评集和 `.pact-server-data`。
  - T03-e：SQLite migration 版本化和执行记录。
- T04：
  - T04-a：iframe sandbox 加固。
  - T04-b：初始 owner 凭据 stdout 暴露收窄。
  - T04-c：HTTP/IP/subject/login 限流。
  - T04-d：`.dockerignore` 加固。
  - T04-e：Docker Compose 开发/生产 TLS 口径。
  - T04-f：Vite HTTPS 代理证书验证。
- T05：
  - T05-a：生产 CSP 去掉 `unsafe-inline` 并落 nonce/hash 或等价方案。
  - T05-b：`SafeHtmlBlock` sanitizer 或 branded safe type。
  - T05-c：邮件 HTML allowlist sanitizer。
  - T05-d：危险 HTML 回归样本和浏览器 smoke。
- T06：
  - T06-a：operation registry 和受管 operation 分类。
  - T06-b：Kernel accept、`operationId` 分配和 started/pending ledger 写入。
  - T06-c：阻断未经过内核的 provider side effect 和状态写入。
  - T06-d：trace、receipt、policy decision、idempotency 和失败语义。
  - T06-e：先迁移一个垂直链路，再批量迁移其它入口。
- T07：
  - T07-a：`pending_operation` 数据模型和过期语义。
  - T07-b：审批 API 和 policy 接入。
  - T07-c：独立 `/approval` 页面。
  - T07-d：approve/reject/expire 恢复和账本事件。
  - T07-e：MCP `operation_reply`。
- T08：
  - T08-a：policy revision 和 active grant 重算。
  - T08-b：Tool Management catalog 和 MCP discovery 刷新。
  - T08-c：SSE/list_changed 通知。
  - T08-d：capability/opaque key policy version 校验。
  - T08-e：上游网关缓存失效。
  - T08-f：权限和 key 状态外部持久化，重启后不要求重新配置。
- T09：
  - T09-a：11 个一等智能体目标 registry。
  - T09-b：每个目标的 install plan/doctor/rollback/report。
  - T09-c：配置写入快照、回滚和审计。
  - T09-d：CLI pairing request 和控制台批准/撤销。
  - T09-e：旧客户端模块 keep/migrate/remove/dev-only 清单。
- T10：
  - T10-a：代码提交 workflow schema 和 operation 注册。
  - T10-b：durable queue、retry、resume、idempotency。
  - T10-c：GitHub live adapter 和 PR receipt。
  - T10-d：高危提交接入 T07 审批。
  - T10-e：worker restart、重复提交和 provider failure 回归。
- T11：
  - T11-a：Skill package schema、manifest 和 checksum。
  - T11-b：`pact.skillHub.upload` 独立存储和记录。
  - T11-c：签名、扫描、pin 和 rollback。
  - T11-d：lifecycle 状态机。
  - T11-e：Tool Management catalog / MCP discovery 原子刷新。
  - T11-f：disabled/revoked 可见性和执行拒绝。
- T12：
  - T12-a：provider mode schema 和统一词表。
  - T12-b：receipt 字段统一。
  - T12-c：OneDrive local projection adapter 和本地读写 smoke。
  - T12-d：iCloud local-live adapter 和文案边界。
  - T12-e：UI/API/文档 provider mode 展示。
  - T12-f：contract/fake provider 不能替代 live 的门禁。
- T13：
  - T13-a：大文件流式上传/下载/恢复。
  - T13-b：路径级 ACL、配额和只读/可写范围。
  - T13-c：版本恢复作为新 operation。
  - T13-d：冲突处理。
  - T13-e：共享空间、checkpoint、cloud receipt 和 artifact/proposal 统一视图。
- T14：
  - T14-a：外部 corpus 目录和 manifest 规则。
  - T14-b：公开 PDF/DOCX/XLSX/PPTX 样本 manifest。
  - T14-c：本机 Mail / 邮件样本 manifest 和隐私边界。
  - T14-d：parser trace 和 source metadata hash。
  - T14-e：DOCX/Markdown/export 一致性基准。
  - T14-f：机器可读失败原因。
- T15：
  - T15-a：`external.knowledge.distillation.*` 网关边界。
  - T15-b：外部服务 auth、healthcheck、非 root、Tika checksum 和资源限制门禁。
  - T15-c：质量基准，覆盖证据保真、召回/排序、成本、错误率和 trace。
  - T15-d：DOCX/XLSX/PPTX/PDF 到 Markdown 或包导出。
  - T15-e：旧 workbench shim 迁移和删除。
- T16：
  - T16-a：剩余页面直接后端访问盘点。
  - T16-b：domain client 补齐 HTTP method、路径、参数和返回类型。
  - T16-c：页面 controller 承接 loading/error/retry/stale response。
  - T16-d：`useConsole()` 瘦身和 allowlist 删除计划。
  - T16-e：Dashboard、Knowledge、External Services、Approval、Runtime browser smoke。
- T17：
  - T17-a：feature profile / composition preset schema。
  - T17-b：personal 轻量预设 plan。
  - T17-c：enterprise adapter/port 预设 plan。
  - T17-d：模块 dehydrate verifier。
  - T17-e：模块 membership、secret refs、runtime assets 和 audit behavior 清单。
- T18：
  - T18-a：模块/外部服务/Skill/Tool Package/mount 治理状态词表。
  - T18-b：create-module 模板。
  - T18-c：module contract test。
  - T18-d：外部服务 registration、health、scope、secretRef 和审计。
  - T18-e：disable/revoke 后 Tool Management、MCP discovery、gateway route 和 grants 同步失效。
  - T18-f：asset lineage 和 source metadata 接入。
- T19：
  - T19-a：executive report 数据模型。
  - T19-b：architecture live map 扫描器。
  - T19-c：sample business pack materialize/import/cleanup。
  - T19-d：production readiness 数据接入。
- T20：
  - T20-a：市场条目 schema。
  - T20-b：授权、安装、撤销和回滚。
  - T20-c：usage/operation/rollback/revoke/denied request 统计。
  - T20-d：推荐和风险提示。
  - T20-e：贡献者主页、市场和统计面板 UI。
  - T20-f：revoke 后 discovery/grant/catalog/可见性同步。
- T21：
  - T21-a：P3-C 大包文档门禁。
  - T21-b：feature profile 扫描，阻断分布式 worker / 多租户默认化。
  - T21-c：P3-C 子方向决策模板。
- T22：
  - T22-a：client package plan 扫描，阻断 mobile 默认构建。
  - T22-b：客户端文档和 feature profile 标记 future/deferred。
  - T22-c：release/CI 入口防止新增 mobile 默认交付。
- T23：
  - T23-a：安全 backlog 保持 S-10 残余风险状态。
  - T23-b：CI 输出收窄 regression。
  - T23-c：legacy/dev-only Rust unsafe 默认不可达检查。
  - T23-d：User-Agent mismatch 审计可见性。

## T00 场景状态和门禁基线

### 目标

- 让 8 个场景的完成度机器可读，不能只靠文档说完成。
- 为后续所有任务提供统一状态表、blocker 表和 verifier 入口。

### 涉及的功能改造

- 新增或完善 `docs/scenarios/scenario-implementation-status.json`。
- 每个场景节点记录 `status`、`operationIds`、`toolIds`、`verifier`、`evidence`、`blockers`。
- 增加聚合门禁，至少覆盖现有 `scenario-catalog` 和业务场景 verifier。
- 控制台后续读取同一状态文件显示完成度，不再手工维护另一套状态。

### 测试方法

- `npm run server:verify:scenario-catalog`
- `npm run server:verify:business-scenarios`
- `npm run server:verify:scenario-agent-code-submission`
- `git diff --check`

### 验收门禁

- `docs/scenarios/scenario-implementation-status.json` 必须存在，并覆盖全部 8 个场景；每个场景必须有 `status`、`verifier`、`evidence` 和 `blockers` 字段。
- 任意场景标为 `verified` 前，必须有可执行 verifier 和证据路径；缺 verifier、缺 operation/tool 绑定或仅 contract 通过时不得标 `verified`。
- 场景聚合门禁必须能发现已登记 operation/tool 被删除或重命名的情况，并以非零退出阻断。
- 当前文档、状态 JSON 和后续控制台展示必须指向同一状态事实源；发现分叉口径时任务不得关闭。

### 用例

- 删除一个已登记 operation，场景门禁必须失败。
- 缺少 verifier 的场景节点不能标为 `verified`。
- contract-mode provider 只能让场景显示 `partial` 或 `contract`，不能显示 `remote-live`。

### 设计理念和维护规范

- 场景状态是执行事实，不是宣传文案；只能由 verifier、evidence 和 blocker 推导。
- `verified` 必须代表真实链路可重复通过，`partial` 必须说明缺哪一段，`contract` 必须说明只验证了合同。
- 不得手工把 UI 状态、场景文档和 JSON 状态维护成三套口径；后续控制台也必须读取同一状态事实源。
- 如果某场景依赖后续任务，不得提前标完成，应把依赖任务编号写进 `blockers`。

## T01 脚本、版本和依赖治理

### 目标

- 优先拆分过大的 `package.json` 脚本入口。
- 让 Node、Flutter、Rust、Java、Docker、Tika 等版本和依赖 owner 可复现。

### 涉及的功能改造

- 按 `server`、`client`、`docs`、`security`、`runtime`、`scenario` 等责任域拆分脚本说明和聚合入口。
- 建立版本元数据和依赖 ownership 文档。
- 新增脚本时必须有 owner、影响范围、验证命令和回滚口径。
- 不再无限向根 `package.json` 单层追加无归属脚本。

### 测试方法

- `npm run repo:hygiene`
- `npm run server:verify`
- `npm run client:verify`
- `npm run feature:verify -- --edition enterprise`

### 验收门禁

- 脚本入口必须按责任域形成清单，根 `package.json` 只能保留清晰聚合入口；新增或保留的关键脚本必须有 owner、用途、输入输出和失败语义。
- Node、Flutter、Rust、Java、Docker、Tika 等版本和关键依赖 owner 必须有可审阅元数据；仅修改 lockfile 不算通过。
- `repo:hygiene`、服务端聚合验证、客户端聚合验证和 enterprise feature 验证必须可运行；命令缺失必须登记 blocker 或补 verifier。
- 不得通过删除 verifier、扩大 ignore、静默跳过平台检查或降级安全检查来让聚合命令变绿。

### 用例

- 新人按版本元数据可复现开发环境。
- 重要依赖升级时能定位 owner 和受影响 verifier。
- 删除或重命名脚本时，相关聚合命令能明确失败，而不是静默跳过。

### 设计理念和维护规范

- 脚本是项目治理接口，不是个人便利命令；命名、owner、输入输出和失败语义必须稳定。
- 新增脚本优先放到责任域脚本或聚合器中，根 `package.json` 只保留清晰入口。
- 依赖升级必须说明影响 Node、Flutter、Rust、Java、Docker 或 Tika 的哪一层；不能只改 lockfile。
- 禁止通过删除 verifier、扩大 ignore 或静默跳过平台检查来“修复”脚本失败。

## T02 前端门禁优先扩展

### 目标

- 在继续改前端前，先把 i18n、style、shared type、组件测试和稳定 id 纳入门禁。
- 防止页面私有状态、后端调用和全局 singleton 回流。

### 涉及的功能改造

- 扩展 `server/scripts/verify-frontend-architecture.mjs`。
- 新文案优先进入结构化 message key，DOM localization 只做兼容层。
- 样式明确归属到 token、component、view 或 feature slice。
- 公共组件新增 focused test，覆盖关闭、焦点、disabled、保存/刷新、tooltip 等行为。
- 禁止随机 id 破坏测试稳定性。

### 测试方法

- `npm run server:verify:frontend-architecture`
- `npm run server:verify:frontend-typecheck`
- `npm run server:verify:frontend-feature-registry`
- `npm run server:verify:frontend-cache-storage`

### 验收门禁

- 前端门禁必须阻断 view/component 直接 `fetch()`、硬编码 `/api`、直接调用全局 `bridge.*` 和新增随机 id；负向 fixture 或等价检查必须覆盖。
- i18n、style、shared type 和公共组件测试边界必须进入 verifier 或明确 allowlist；allowlist 必须有负责人和删除条件。
- 新公共组件必须有 focused test 或书面豁免；豁免不能成为默认通过路径。
- 类型检查、feature registry 和 cache/storage verifier 必须通过；失败时不得用扩大 facade 或跳过检查代替修复。

### 用例

- 新增 view/component 直接 `fetch()` 或硬编码 `/api` 时门禁失败。
- 新公共组件没有测试或豁免记录时门禁失败。
- i18n facade、CSS facade 或 shared type facade 重新膨胀时门禁失败。

### 设计理念和维护规范

- 前端页面只表达用户意图和状态展示；后端路径、HTTP method、参数和返回类型必须收敛到 domain client。
- 组件越公共，行为越需要稳定测试；不能让全局 singleton、随机 id 或页面私有逻辑污染公共组件。
- i18n、style、shared type 可以有 facade，但 facade 必须保持薄层，不能重新变成跨领域大单体。
- 新 allowlist 只能用于真实迁移窗口，必须有失效条件和负责人。

## T03 配置、密钥、数据目录和 runtime 资产边界

### 目标

- 所有密钥、外部服务配置、本地数据和 runtime 资产外移到 `${PACT_SERVER_DATA_DIR}`，默认 `~/.pact-server-data`。
- 项目目录只保留源码、模板、manifest 和校验规则。

### 涉及的功能改造

- 建立配置权威表，区分用户配置、候选模板、环境默认值和运行时 fallback。
- SQLite schema 演进统一到版本化 migration。
- JRE、Tika、模型、下载缓存和评估集迁出 source checkout。
- runtime dependency manager 负责下载、校验、安装、升级和清理。
- repo hygiene / secret hygiene 阻断项目目录内 key、运行数据和 fake path。

### 测试方法

- `npm run repo:hygiene`
- `npm run security:hygiene`
- `npm run server:verify:runtime-dependency-downloads`
- `npm run server:verify:secret-init`
- `npm run server:verify:entity-config-layout`

### 验收门禁

- 默认数据目录解析必须以 `PACT_SERVER_DATA_DIR` / 外部配置 / `~/.pact-server-data` 为权威，不得把仓库内任意目录作为默认运行数据或配置落点。
- `repo:hygiene` 和 `security:hygiene` 必须能阻断项目目录内 key、token、secret、`.pact-server-data`、运行数据库、测评集、邮件样本和 runtime 下载缓存。
- 空用户配置必须保持空；默认值只能来自候选模板、环境默认值或运行时 fallback，不能写回用户配置文件。
- runtime 依赖必须有 manifest、版本、checksum、来源和外部安装位置；缺依赖时只能报告 blocked/install-needed，不得伪装 ready。

### 用例

- 空用户配置保持空，不被默认值污染。
- 项目任意子目录出现 key、token 或 `.pact-server-data` 时门禁失败。
- 缺 runtime 依赖时给出可执行安装命令，不伪装成已就绪。

### 设计理念和维护规范

- 源码目录只保存可审阅源码、模板、manifest 和校验规则；运行状态和配置属于外部数据目录。
- 默认数据目录是 `~/.pact-server-data`，可由 `PACT_SERVER_DATA_DIR` 显式覆盖；不得把项目内路径作为默认值或示例落点。
- secret 只能以 `secretRef`、环境变量或外部配置引用出现；不得把真实值写进 docs、fixtures、logs、SQLite dump 或测试快照。
- runtime 依赖必须有来源、版本、checksum、安装位置和清理策略；不能把下载结果提交进仓库。

## T04 安全短批次一

### 目标

- 关闭不需要大构建改造的安全硬化项。
- 包括 S-02、S-03、S-04、S-05、S-06、S-08。

### 涉及的功能改造

- iframe sandbox 移除不必要的 `allow-popups-to-escape-sandbox` / `allow-same-origin` 组合。
- 初始 owner 凭据提示减少 stdout 暴露。
- HTTP 层增加 IP / subject 级限流，登录接口额外 per-IP 限流。
- `.dockerignore` 排除运行数据、agent 历史、临时报告和敏感上下文。
- Docker Compose 区分本地开发和生产 TLS 口径。
- Vite 代理 HTTPS 远端时不默认关闭证书验证。

### 测试方法

- `npm run server:verify:security-hardening`
- `npm run server:verify:console-auth`
- `npm run test:security`
- `npm run repo:hygiene`

### 验收门禁

- S-02、S-03、S-04、S-05、S-06、S-08 每一项都必须有实现证据、负向检查和状态回写；不能用一个笼统安全通过代替逐项关闭。
- 登录限流、iframe sandbox、Docker build context、Compose TLS 口径和 Vite HTTPS 证书验证必须有自动检查或可复现 smoke。
- 安全改造不得泄露 owner 初始凭据、token、cookie、secretRef 解析值或敏感路径。
- 本批次不得混入 S-01/S-07/S-09 的 CSP/HTML 大改；混入时必须拆分后再关闭。

### 用例

- 邮件 evidence iframe 仍可读，但不能逃逸沙箱。
- 登录暴力请求触发 HTTP 层限流。
- Docker build context 不包含运行数据或 agent 历史。
- `VITE_API_ORIGIN=https://...` 时证书验证默认开启。

### 设计理念和维护规范

- 安全小修必须保持小批次、可验证、可回滚；不得混入 CSP 大改或功能重构。
- 开发便利不能变成生产默认。TLS、证书验证、Docker 用户、限流和 sandbox 都必须有清晰 dev/prod 口径。
- 安全日志要能解释拒绝原因，但不得泄露 owner 初始凭据、token、cookie、secretRef 解析值或敏感路径。
- 关闭每个安全项时必须同步更新安全审计报告和安全 backlog 状态。

## T05 CSP 和 HTML 渲染安全批次

### 目标

- 单独处理 S-01，并把 S-07 和 S-09 合并为 HTML 渲染安全批次。

### 涉及的功能改造

- CSP 去掉 `script-src 'unsafe-inline'`，采用 Vite nonce/hash 或等价方案。
- `SafeHtmlBlock` 增加强制消毒或 TypeScript branded type。
- 邮件 HTML 消毒从 blocklist 升级到 allowlist 或等价策略。
- 覆盖危险 URL、事件属性、`math`、`svg`、`annotation-xml` 等回归。

### 测试方法

- `npm run server:verify:frontend-architecture`
- `npm run server:verify:frontend-typecheck`
- `npm run server:verify:security-hardening`
- 浏览器 smoke：控制台登录、Knowledge evidence、邮件 evidence、Markdown 渲染。

### 验收门禁

- 生产 CSP 必须去掉 `script-src 'unsafe-inline'`，并用 nonce/hash 或等价方案保证控制台构建和登录可用。
- 所有安全 HTML 入口必须经过 sanitizer 或 branded safe type；普通 string 直接进入 HTML 渲染必须被类型或 verifier 阻断。
- 邮件 HTML sanitizer 必须采用 allowlist 或等价安全策略，并覆盖事件属性、危险 URL、`svg`、`math`、`annotation-xml` 等回归样本。
- S-01、S-07、S-09 必须同步回写安全审计和安全 backlog；任何重新打开 unsafe 行为的例外都必须有测试和到期条件。

### 用例

- 注入 inline `<script>` 被 CSP 阻断。
- 普通 string 不能直接传给安全 HTML 渲染组件。
- 邮件正文中的事件属性和危险 URL 被移除。

### 设计理念和维护规范

- HTML 渲染必须默认不信任输入；允许显示不代表允许执行。
- CSP、HTML sanitizer、typed safe HTML 和邮件 evidence 渲染必须作为同一条防线维护，不能只修其中一层。
- 不得为了兼容旧内容重新打开 `unsafe-inline`、危险 URL、事件属性或不受控 iframe 权限。
- 所有例外都必须可枚举、可测试、可删除，不能靠人工记忆。

## T06 Operation Scheduling Kernel 和统一账本

### 目标

- 只有 Operation Scheduling Kernel 受理的 operation 才能产生真实副作用。
- 所有操作进入统一 Operation Ledger。

### 涉及的功能改造

- Operation Dispatcher 升级为 Operation Scheduling Kernel。
- API、RPC、MCP、CLI、控制台、后台任务、workflow activity、provider side effect 都必须先进入内核。
- 模块本地 audit、provider ledger、queue event 和 runtime log 只能作为投影或回执。
- 对未注册、未排期或未落账的副作用直接拒绝。

### 测试方法

- `npm run server:verify:dispatcher-unified`
- `npm run server:verify:operation-policy`
- `npm run server:verify:trace-context`
- `npm run server:verify:state-mutations`
- `npm run server:verify:runtime-logging`

### 验收门禁

- 所有会产生外部副作用或公共状态变化的 API/RPC/MCP/CLI/控制台/后台任务/provider 路径，必须先由 Operation Scheduling Kernel accept、分配 `operationId` 并写入 started 或 pending ledger。
- verifier 必须能阻断至少一个未经过内核直接调用 provider 或状态写入的负向样例。
- ledger 事件必须能关联 `operationId`、`traceId`、subject、workspace、policy decision、receipt 和失败原因；模块本地日志不能替代统一账本。
- 内核不可用、ledger 不可写或 operation 未注册时，真实副作用不得发生。

### 用例

- 直接调用 provider 写状态但未经过内核时失败。
- 外部 IO 发生前无法写入 ledger 时，operation 失败且无副作用。
- 任意受管 operation 可按 `traceId` / `operationId` 查到完整账本。

### 设计理念和维护规范

- Pact 的真实操作事实源是 Operation Scheduling Kernel 和 Operation Ledger，不是模块日志、provider 回调或 UI 状态。
- 所有产生外部副作用或公共状态变化的路径都必须先 accepted、分配 `operationId`、写 started 或 pending，再执行。
- provider adapter 只能执行内核发出的受管命令；直接调用 adapter 写外部系统必须被拒绝。
- 新增操作时必须同时定义 policy、ledger event、receipt、trace、retry/idempotency 和失败语义。

## T07 统一审批和独立 `/approval`

### 目标

- 高危 operation 挂起为 `pending_operation`，进入独立 `/approval` 页面。
- 批准后恢复原 operation，拒绝或过期不执行。

### 涉及的功能改造

- Operation Scheduling Kernel 识别高危操作并创建 pending item。
- pending item 保存原始 payload、grant、trace、risk reason、expiresAt、idempotencyKey。
- `/approval` 展示、批准、拒绝、过期和恢复执行。
- MCP client 收到 `operation_reply`。

### 测试方法

- `npm run server:verify:operation-policy`
- `npm run server:verify:authorization-governance`
- `npm run server:verify:tool-management`
- `npm run server:verify:mcp-http`
- 前端路由 smoke：`/approval`。

### 验收门禁

- 高危 operation 必须被内核挂起为 `pending_operation`，审批前不得执行真实副作用。
- `/approval` 必须是独立可访问页面，支持展示风险、批准、拒绝、过期和恢复执行；不得退回到旧工作台面板。
- approve 后必须恢复原始 operation、trace、payload、grant 和 idempotencyKey；reject/expire 必须写 ledger/audit 并通知调用方。
- MCP client 必须收到机器可读 `operation_reply`，能区分 pending、approved、rejected、expired 和 failed。

### 用例

- 高危云盘删除被挂起，审批前不执行。
- approve 后沿用原 trace 恢复执行。
- reject/expire 后写审计并通知客户端。

### 设计理念和维护规范

- 审批不是弹窗确认，而是 operation 生命周期的一部分；pending item 必须可恢复、可拒绝、可过期、可审计。
- `/approval` 是独立页面，不得退回到嵌在其它工作台里的临时面板。
- 批准后恢复的是原 operation，不是重新拼一个相似请求；trace、idempotencyKey、policy decision 和 payload 必须保持可追溯。
- 拒绝和过期也是正常治理结果，必须通知调用方并写入 ledger/audit。

## T08 权限变更实时生效

### 目标

- 权限变更后 MCP grant/key、SSE、网关缓存和 policy version 立即刷新。

### 涉及的功能改造

- policy revision 变更后重算 active grant。
- SSE/list_changed 通知相关客户端。
- 上游网关缓存失效。
- capability key / opaque key 绑定最新 policy version。

### 测试方法

- `npm run server:verify:authorization-governance`
- `npm run server:verify:authorization-capabilities`
- `npm run server:verify:opaque-capability-key`
- `npm run server:verify:mcp-http`
- `npm run server:verify:gateway-ingress`

### 验收门禁

- policy revision 变化必须即时影响 active grant、Tool Management catalog、MCP discovery、SSE/list_changed、上游网关缓存和 capability/opaque key 校验。
- 撤销 grant 后，同一客户端无需重启服务或重新配置 key 即可看到能力消失；旧 policy version 的 key 写操作必须被拒绝。
- 密钥和权限状态必须持久化到外部数据目录或 secret store，服务重启后不能要求维护者重新手工配置 key。
- 知识蒸馏、云盘、Skill 和外部服务不得保留任何绕过统一授权的专用权限缓存。

### 用例

- 撤销 grant 后，同一 MCP client 立即看不到对应工具。
- policy version 旧的 key 调用写操作被拒绝。
- SSE 收到工具目录变化通知。

### 设计理念和维护规范

- 权限不是启动时加载一次的配置；policy revision 是运行时事实，变更必须立刻影响 grant、key、discovery 和网关缓存。
- Capability key 只能表达当前 policy version 下的最小能力，旧 version 不能继续写入。
- 目录变化必须主动通知客户端；不能要求用户重启服务或重新手工配置 key 才生效。
- 不得为知识蒸馏、云盘或 Skill 单独发明旁路权限体系。

## T09 11 个智能体安装、配对和客户端清理

### 目标

- 安装接入成为产品能力，覆盖 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf。
- GUI 继续 Flutter，CLI 后端继续 Rust，其它旧遗留清理。

### 涉及的功能改造

- 一条命令完成安装、发现、配对、配置写入、doctor 和回滚。
- 远端/VM/容器无交互 bootstrap，回传机器可读安装报告。
- 客户端旧模块形成 keep / migrate / remove / dev-only 清单。
- 非 GUI target 通过 CLI pairing request 和控制台批准/撤销完成配对。

### 测试方法

- `npm run server:verify:agent-client-support-targets`
- `npm run server:verify:mcp-agent-target-install`
- `npm run client:verify:targets`
- `npm run client:verify:config-writes`
- `npm run client:verify:pairing-skill-cli`
- `npm run client:verify`

### 验收门禁

- 11 个一等目标必须来自同一份 registry，并在服务端、MCP connector、CLI、GUI、安装文档和 verifier 中保持一致；漏掉 Hermes Agent 或 Windsurf 即失败。
- 每个目标必须至少支持 plan、apply 或明确 blocked reason、doctor、rollback 和机器可读安装报告；只写文档不算完成。
- 配置写入必须有快照、回滚和审计；不得把真实 key 写入项目目录或目标客户端的不安全位置。
- 安装成功和 pairing 授权必须是两个状态；未 pairing 的客户端不能获得受管能力。

### 用例

- 每个一等目标能输出安装 plan、apply、doctor、rollback。
- 安装成功不等于配对授权，必须有 pairing 状态。
- 非 GUI target 可发起配对并被控制台撤销。

### 设计理念和维护规范

- 一等支持目标固定为 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf；不得再反复确认或漏项实现。
- 安装、发现、配置写入和 doctor 是产品能力，必须有 plan/apply/rollback/report，不是散落脚本。
- 安装只代表客户端可用，配对才代表授权可用；两者状态、错误和审计必须分开。
- GUI 继续 Flutter，CLI 后端继续 Rust；清理旧模块时必须先给 keep/migrate/remove/dev-only 结论。

## T10 代码提交 durable workflow

### 目标

- 代码提交必须进入 durable workflow / queue。
- 补真实 GitHub live receipt。

### 涉及的功能改造

- 代码提交 operation 转为 durable workflow。
- 支持 retry、idempotency、resume、provider 状态同步。
- GitHub PR receipt 返回 review URL、branch、commit、provider durable id。
- 高危代码提交接入 T07 审批恢复。

### 测试方法

- `npm run server:verify:durable-workflow`
- `npm run server:verify:scenario-agent-code-submission`
- `npm run server:verify:v001-codespace-e2e`
- `npm run server:verify:codespace`

### 验收门禁

- 代码提交 operation 必须由 durable workflow 执行，具备 retry、resume、idempotency 和 provider 状态同步；普通同步 handler 不能关闭任务。
- 高危提交必须能进入 T07 审批，审批前不 push、不创建 PR、不修改远端状态。
- GitHub live 成功必须返回真实 PR/review URL、branch、commit 和 provider durable id；缺凭据时只能标 `contract-only` 或 `blocked`。
- worker 重启、重复 idempotency key、provider 失败和恢复路径必须有自动测试或可复现 smoke 证据。

### 用例

- worker 重启后代码提交继续或可恢复。
- 重复提交同一 idempotency key 不产生重复 PR。
- GitHub live provider 成功后 receipt 包含 PR URL 和 commit。

### 设计理念和维护规范

- 代码提交是高价值外部副作用，必须走 durable workflow、Operation Scheduling Kernel、审批和统一账本。
- Git provider receipt 必须来自真实 provider 响应；缺 GitHub live 凭据时只能标 contract 或 blocked。
- retry 和 resume 必须基于 idempotency key 和 provider durable id，不能靠再次执行本地 shell 命令碰运气。
- 失败时要留下可解释 fallbackReason、policyDecision、auditId 和可恢复状态。

## T11 Skill Hub 独立库和 lifecycle

### 目标

- 技能包进入独立 server Skill Hub / skill library，不能混在 workspace contribution。
- 先做签名、扫描、pin、回滚和 Tool Management catalog 原子刷新。

### 涉及的功能改造

- `pact.skillHub.upload` 作为真实技能包入口。
- manifest、`SKILL.md`、scripts、assets、templates、checksum、signature 形成包结构。
- scanned / reviewed / activated / disabled / revoked / rollback 状态机。
- Tool Management catalog、MCP discovery、agent profile 可见目录和 grant matcher 原子刷新。

### 测试方法

- `npm run server:verify:tool-skill-management`
- `npm run server:verify:capability-package-lifecycle`
- `npm run server:verify:knowledge-skillization`
- `npm run client:verify:pairing-skill-cli`

### 验收门禁

- `pact.skillHub.upload` 必须写入独立 Skill Hub / skill library 记录；workspace contribution 只能保存引用和统计视图。
- 技能包必须有 manifest、`SKILL.md`、checksum 和生命周期状态；签名、扫描、pin、rollback 的缺口必须明确 blocked，不得跳过。
- Tool Management catalog、MCP discovery、agent profile 和 grant matcher 必须原子刷新；失败时不得出现半启用状态。
- disabled/revoked 后，同一 grant 必须不可见且不可执行，并留下 receipt/audit。

### 用例

- 上传最小技能包后，Skill Hub 有独立记录。
- 激活后 `pact.discovery` 可见。
- revoke 后同一 grant 不可见且不可执行。
- catalog 刷新失败不产生半启用状态。

### 设计理念和维护规范

- Skill 是可执行能力包，不是普通 workspace 附件；必须进入独立 Skill Hub / skill library。
- workspace contribution 只能记录引用、采用和统计视图，不能承载 Skill 包权威状态。
- 签名、扫描、pin、rollback、catalog 原子刷新和 grant 可见性必须在同一 lifecycle 中维护。
- 禁用或撤销必须同步影响 Tool Management catalog、MCP discovery、agent profile 和执行授权。

## T12 provider mode、receipt 和 iCloud/OneDrive local projection

### 目标

- 统一 provider mode：`contract`、`local-live`、`remote-live`、`dry-run`、`failed`。
- iCloud + OneDrive 第一批本机目录投影上传/下载。

### 涉及的功能改造

- receipt 必须声明 provider mode、verification source、remote id 或 local projection id。
- OneDrive 从 contract-mode 升级为本机目录投影 adapter。
- iCloud / OneDrive 本机 adapter 明确 `local-live` / `localProjectionVerified`，不能说成远端云盘成功。
- UI/API/文档区分合同验证、本机成功和远端 provider 成功。

### 测试方法

- `npm run server:verify:v001-cloud-drive-e2e`
- `npm run server:verify:external-service-api-registration`
- `npm run server:verify:scenario-catalog`
- local projection provider smoke：OneDrive 上传、下载、覆盖、只读目录拒绝和同步计划。

### 验收门禁

- provider mode 词表必须在 API、receipt、UI、日志和文档中统一为 `contract`、`local-live`、`remote-live`、`dry-run`、`failed`。
- OneDrive v0.0.1 smoke 必须证明本机目录投影真实上传、下载、覆盖和只读拒绝，并记录 local projection receipt；不得写成远端同步成功。
- iCloud 第一版如果只是本机目录 adapter，只能标 `local-live`；不得写成远端同步成功。
- Google Drive、Dropbox 或 fake provider 的 contract pass 不得替代 iCloud + OneDrive 第一批本地投影验收。

### 用例

- contract provider 不显示为真实远端成功。
- OneDrive 上传后 receipt 包含 local projection 状态、byte count、hash、checkpoint 和 audit 引用；不伪造 fileId / etag / webUrl。
- iCloud / OneDrive 本机目录写入只标记 `local-live` / `localProjectionVerified`。

### 设计理念和维护规范

- provider mode 是产品事实，不是 UI 标签；receipt、API、日志、报告和控制台必须使用同一词表。
- OneDrive 第一版目标调整为本机目录投影；OAuth / Microsoft Graph `remote-live` 是后续适配目标。
- Google Drive、Dropbox 或 fake provider 的 contract pass 不能替代 OneDrive/iCloud 第一批本地投影验收。
- 每次外部写入都必须返回可追溯 remote id、local projection id、verification source 和失败原因。

## T13 共享空间产品化

### 目标

- 共享空间可靠承载大文件、权限、版本、冲突和跨智能体协作。

### 涉及的功能改造

- 大文件流式上传、下载、断点续传和进度。
- 路径级 ACL、只读/可写范围、配额和冲突处理。
- 版本恢复必须生成新 operation。
- 文件、artifact、proposal、checkpoint、cloud drive receipt 在同一视图可追踪。

### 测试方法

- `npm run server:verify:workspace-file-ops`
- `npm run server:verify:workspace-checkpoints`
- `npm run server:verify:workspace-governance`
- `npm run server:verify:v001-local-dir-e2e`
- `npm run server:verify:v001-cloud-drive-e2e`

### 验收门禁

- 大文件上传、下载和恢复必须流式或分块，不能一次性读入内存；测试必须覆盖大文件或模拟大流。
- 路径级 ACL、配额、只读/可写范围、冲突和无权限拒绝必须进入 policy、ledger 和 audit。
- 版本恢复必须创建新的受管 operation，并保留原历史；裸覆盖、裸 reset 或直接文件系统恢复不算通过。
- 共享空间、checkpoint、cloud drive receipt 和 artifact/proposal 视图必须能按 operation/trace 串起来。

### 用例

- A 智能体写入共享空间，B 读取处理，C 审批写回。
- 大文件不会一次性读入内存。
- 无权限路径读写被拒绝并留下审计。

### 设计理念和维护规范

- 共享空间是受管公共空间，不是普通文件夹；读写、版本、恢复、授权和审计必须由 Pact 裁决。
- 大文件能力必须流式、可恢复、可限额，不能一次性读入内存或保存共享路径引用。
- 版本恢复必须创建新 operation，保留旧历史；不得裸覆盖或裸 reset。
- 任意跨智能体协作都必须留下谁读过、谁写过、谁审批、谁被拒绝的记录。

## T14 真实办公文档解析基准

### 目标

- 建立真实 PDF、DOCX、XLSX、PPTX、邮件样本基准。
- 测评集放外部数据目录，不进项目内部。

### 涉及的功能改造

- document evaluation corpus 文档和外部目录约定。
- openability、结构锚点、动态切分、DOCX 导出基准。
- 解析结果要能追溯 raw object、page/slide、bbox、parser/model/version。
- 失败样本输出机器可读原因。

### 测试方法

- `npm run server:verify:dynamic-document-parsing`
- `npm run server:verify:document-preview-consistency`
- `npm run server:verify:document-parser-dry-run`
- `npm run server:verify:knowledge-docx-export`
- `npm run server:verify:asset-lineage`

### 验收门禁

- 测评集目录必须在外部数据目录或显式外部 corpus 下；仓库内只能保存 manifest、hash、公开来源 URL 和说明。
- PDF、DOCX、XLSX、PPTX、邮件样本必须至少覆盖 openability、结构锚点、失败原因和导出一致性；缺某类样本时必须标 blocked。
- 解析输出必须能追溯 raw object、页/slide/sheet、bbox、parser/model/version 和 source metadata hash。
- 解析失败必须返回机器可读 failure reason，不能生成空结果后标 success。

### 用例

- DOCX 表格、PPTX 图文、XLSX sheet、PDF 图片和邮件附件能保留结构锚点。
- 解析失败不会伪装成功。
- 外部样本路径在 `${PACT_SERVER_DATA_DIR}` 或明确外部 corpus 下。

### 设计理念和维护规范

- 测评集和邮件样本属于外部数据，不属于项目源码；只能通过 manifest、hash、公开来源 URL 或本机外部路径引用。
- 文档解析优先保留结构，再做检索颗粒度派生；不能先按固定 token 或字符粗暴切分。
- 解析结果必须可追溯 raw object、页/幻灯片/sheet、bbox、parser、model、version 和失败原因。
- 公开样本、用户本机邮件样本和私有企业样本必须分开标记，不能混进同一个默认 corpus。

## T15 知识蒸馏算法和办公文档质量升级

### 目标

- 优先做算法升级。
- 文档解析优先支持 DOCX、XLSX、PPTX、PDF 等流行办公文档。
- 所有新能力继续只进入 `external.knowledge.distillation`。

### 涉及的功能改造

- embedding provider、ranker、近邻索引或等价质量提升。
- 真实办公文档到 Markdown / 包导出。
- 评估样本、成本、错误率、证据保真进入 operation/job/trace。
- 旧内部 workbench shim 完成调用方迁移后删除。

### 测试方法

- `npm run server:verify:knowledge-distillation-workbench`
- `npm run server:verify:external-knowledge-distillation-service-gates`
- `npm run server:verify:knowledge-distillation-optimization`
- `npm run server:verify:knowledge-industrial-distillation`
- `npm run server:verify:knowledge-retrieval-quality`

### 验收门禁

- 所有真实能力必须暴露在 `external.knowledge.distillation.*`，并经过外部服务上游网关切面；旧 workbench 只能返回迁移报文。
- 外部知识蒸馏服务门禁必须通过 required-auth、业务 API bearer gate、公开 healthcheck、Docker 非 root、Tika checksum 和资源限制。
- 算法升级必须有质量基准，至少记录证据保真、召回/排序质量、成本、错误率和 trace；单个漂亮输出不算验收。
- DOCX/XLSX/PPTX/PDF 到 Markdown 或包导出必须有真实样本验证；缺模型或凭据时必须标 blocked，不得降级成规则整理。

### 用例

- 上传 DOCX/PPTX/XLSX/PDF 后生成可下载 Markdown 或包。
- 无证据 claim 被拦截或标记低置信度。
- 旧 workbench 入口只返回迁移报文，不执行真实算法。

### 设计理念和维护规范

- 知识蒸馏唯一维护面是 `external.knowledge.distillation`，所有 run、evidence、artifact、download、export、compare、delete 和 archive 都必须走上游网关切面。
- 算法升级必须用证据保真、召回质量、成本、错误率和可解释 trace 验收，不能只看单个样例输出好不好看。
- 新解析器或导出能力必须在 T03/T08/T14 的配置、权限、测评集和门禁基础上落地。
- 模型不可用时任务应失败或标 blocked，不能降级成规则整理后声称完成蒸馏。

## T16 前端剩余页面接口收敛

### 目标

- 剩余页面继续收敛到 `server-web/lib/*-client.ts` + controller。

### 涉及的功能改造

- view/component 不直接访问后端，不硬编码 `/api`。
- domain client 持有 HTTP method、路径、参数和返回类型。
- 页面只调用 controller。
- global bridge direct use 继续 allowlist 管控。

### 测试方法

- `npm run server:verify:frontend-architecture`
- `npm run server:verify:frontend-typecheck`
- `npm run server:verify:frontend-feature-registry`
- 浏览器 smoke：Dashboard、Knowledge、External Services、Approval、Runtime pages。

### 验收门禁

- 剩余页面不得直接 `fetch()`、硬编码 `/api` 或直接使用全局 `bridge.*`；所有后端协议事实必须在 `server-web/lib/*-client.ts`。
- 页面组件只能调用 controller 暴露的字段和方法；loading、error、retry、stale response 和刷新逻辑不得散落到组件里。
- `useConsole()` 新增业务状态或业务副作用必须被 verifier 阻断或登记为迁移 blocker。
- Dashboard、Knowledge、External Services、Approval、Runtime pages 的浏览器 smoke 必须覆盖主路径和错误态。

### 用例

- 新增直接 `bridge.*` 或 `fetch()` 的组件时门禁失败。
- 修改某后端 API 路径只需要更新对应 domain client。
- 页面 controller 能处理 loading、error、retry 和 stale response。

### 设计理念和维护规范

- 前端统一接口不是换文件名，而是把后端协议事实集中到 `server-web/lib/*-client.ts`，把页面副作用集中到 controller。
- 页面组件不得知道 API 路径、HTTP method、认证细节、SSE/下载差异或 retry 策略。
- `useConsole()` 只保留 shell、登录态、导航和公共刷新；业务状态必须回到领域 controller。
- 迁移时允许短期兼容 facade，但必须有 allowlist、负责人和删除条件。

## T17 个人/企业两套可脱水预设构建线

### 目标

- 优先做个人电脑轻量预设和企业私有化预设两条线。
- 所有附加功能必须可脱水。

### 涉及的功能改造

- Feature Profile / composition preset 输出两套计划。
- 个人电脑预设默认模块化单体、SQLite、本机文件对象存储、本机目录和可选网关，不部署集群。
- 企业预设通过 port / adapter 接入 Postgres、Redis、S3-compatible storage、KMS、网关和审计导出。
- 附加功能声明 profile membership、required ports、runtime assets、secret refs、audit behavior 和 verification commands。

### 测试方法

- `npm run feature:plan -- --edition enterprise`
- `npm run feature:verify -- --edition enterprise`
- `npm run composition:list`
- `npm run composition:verify`
- `npm run composition:dehydrate`
- `npm run server:verify:composition-presets`

### 验收门禁

- personal 和 enterprise 两套 preset 必须都能输出机器可读 plan，说明启用模块、禁用模块、required ports、secret refs、runtime assets 和 verifier。
- personal 默认不得包含 Postgres、Redis、S3、KMS、分布式 worker、集群或企业网关强依赖。
- enterprise 必须通过 port / adapter 替换企业已有 Postgres/Redis/S3/KMS/网关/审计服务，不能污染 personal 默认路径。
- 任意附加模块必须能 dehydrate；禁用后 direct mode、核心授权、账本、控制台和基础场景仍可运行。

### 用例

- 个人电脑预设不包含集群中间件。
- 企业预设可替换企业内部已有 Postgres/Redis/S3/KMS。
- 任意 enterprise-only 模块不能泄漏到 personal 默认路径。

### 设计理念和维护规范

- 个人电脑路线追求轻量、可本机启动、低运维税；企业路线追求可替换中间件、合规、审计和私有化部署。
- 功能模块必须声明 profile membership、required ports、secret refs、runtime assets、audit behavior 和 verifier。
- 企业能力通过 port / adapter 接入企业已有服务，不能把 Postgres、Redis、S3、KMS 或集群依赖变成个人默认项。
- 可脱水模块必须在禁用后不破坏 direct mode、核心授权、账本、控制台和基础场景。

## T18 模块和外部服务接入生态

### 目标

- 建设模块和外部服务接入生态，统一治理逻辑和模块划分。

### 涉及的功能改造

- 模块 SDK、create-module 模板、contract test、CI 模板、schema docs。
- 外部服务注册、健康检查、capability 声明、scope、secretRef、审计、降级和撤销。
- 模块、外部服务、Skill、Tool Package 和 mount 共用治理状态。
- 多模态资产血缘接入模块输出。

### 测试方法

- `npm run server:verify:module-ecosystem`
- `npm run server:verify:external-service-api-registration`
- `npm run server:verify:unified-registration`
- `npm run server:verify:asset-lineage`
- `node server/scripts/pact-module-contract-test.mjs`

### 验收门禁

- 模块、外部服务、Skill、Tool Package 和 mount 必须共享注册、启用、禁用、授权、撤销、审计和 health 状态词表。
- create-module 模板生成的新模块必须能通过 contract test；缺 contract test 不得进入正式 discovery。
- 外部服务禁用或撤销后，Tool Management、MCP discovery、gateway route 和相关 grants 必须同步失效。
- 外部服务不得暴露裸 secret、裸 URL、裸下载路径或未审计副作用；所有结果进入 Pact 后必须有 asset lineage。

### 用例

- 新模块用模板生成并通过 contract test。
- 外部服务禁用后 Tool Management 和 MCP discovery 同步失效。
- 多模态结果能追溯到来源对象和解析步骤。

### 设计理念和维护规范

- 模块、外部服务、Skill、Tool Package 和 mount 必须共享治理语言，不能各自发明注册、启用、禁用、授权和撤销状态。
- 外部服务只暴露受控 capability，不暴露原始 secret、裸 URL、裸下载路径或未审计副作用。
- 新模块必须先通过 contract test 和 schema docs，再进入正式 discovery 或市场。
- 多模态和外部结果进入 Pact 后必须有 asset lineage、source metadata hash、content root 和权限 overlay。

## T19 管理报告、架构 live map 和样例业务包

### 目标

- P3 维护管理体验，不抢 P0/P1/P2。

### 涉及的功能改造

- executive report 聚合 production readiness、资产价值、评估、容量、成本、安全和风险。
- architecture live map 连接设计文档、实现路径和门禁状态。
- sample business pack 可物化、导入和清理。
- 样例数据可公开、可复现、可脱敏；敏感测评集仍放外部数据目录。

### 测试方法

- `npm run server:verify:executive-report`
- `npm run server:verify:architecture-live-map`
- `npm run server:verify:sample-business-pack`
- `npm run server:verify:production-readiness`

### 验收门禁

- executive report 必须只基于真实 verifier、operation、usage、risk、capacity、cost 和 readiness 数据；不得手写乐观完成度。
- architecture live map 必须能从设计文档定位到实现路径和 verifier；路径不存在、脚本缺失或状态冲突必须失败。
- sample business pack 必须可 materialize、import、verify、cleanup，且只使用公开、可复现、可脱敏数据。
- P3 管理能力不得成为 P0/P1/P2 的隐式依赖；未完成底座任务时只能显示 blocked 或 unavailable。

### 用例

- 管理报告能解释资产价值、生产风险和容量成本。
- live map 中某实现路径不存在时 verifier 失败。
- 样例业务包 materialize 后可被导入并清理。

### 设计理念和维护规范

- 管理报告必须基于真实 verifier、operation、usage、risk 和 readiness 数据，不能用手写乐观摘要代替。
- architecture live map 是设计到实现到门禁的索引；路径不存在、脚本不存在或状态冲突都应失败。
- 样例业务包只能使用公开、可复现、可清理、可脱敏数据；敏感 corpus 和邮件样本仍留在外部数据目录。
- P3 管理体验不应抢占 P0/P1/P2 底座任务。

## T20 完整贡献者生态、市场和统计面板

### 目标

- 完整贡献者生态、市场和统计面板进入 P3，不降级、不回退。

### 涉及的功能改造

- 贡献者主页、贡献资产列表、贡献请求、维护 SLA、订阅、评分、推荐和使用统计。
- Skill、知识包、服务和贡献资产的市场展示、授权、安装、撤销、审计和排行。
- 条目必须显示来源、版本、签名状态、授权范围、安装/撤销记录和风险提示。
- 市场不得绕过 P2-E 的模块/外部服务治理、签名、撤销、审批和审计。

### 测试方法

- `npm run server:verify:workspace-contribution-governance`
- `npm run server:verify:tool-skill-management`
- `npm run server:verify:capability-package-lifecycle`
- `npm run server:verify:executive-report`

### 验收门禁

- 市场条目必须显示来源、版本、签名状态、授权范围、安装/撤销记录、风险提示和回滚能力；缺任一项不得上架为可安装。
- 安装、授权、撤销、评分、推荐和统计必须基于真实 operation / usage / rollback / revoke / denied request 事件。
- 未授权用户不得安装或执行市场条目；revoke 后 discovery、grant、catalog、多智能体可见性和统计状态必须同步变化。
- 市场不得绕过 Skill Hub、Tool Management、模块/外部服务治理、统一审批和审计。

### 用例

- 高复用 Skill 出现在市场推荐，但未授权用户不能安装。
- revoke 后 discovery、grant、catalog 和多智能体可见性同步失效。
- 统计面板只基于真实 operation / usage / rollback / revoke 事件。

### 设计理念和维护规范

- 贡献者生态是完整 P3 目标，不降级为简单排行或静态统计页。
- 市场条目必须继承 P2-E 治理：来源、版本、签名、授权、安装、撤销、审计、风险提示和回滚。
- 推荐和统计只能来自真实 usage、operation、rollback、revoke、denied request 和维护事件。
- 市场不能绕过 Skill Hub、Tool Management、审批、模块治理或外部服务治理。

## T21 P3-C 大包拆分决策

### 目标

- P3-C 不作为一个大包启动，后续拆成小决策。

### 涉及的功能改造

- 暂不实现 connector SDK、多租户、分布式 worker、mTLS fleet、插件市场大包。
- 如重启任一子方向，先形成独立决策说明。
- 子方向必须说明依赖、风险、预设线、脱水方式和验收门禁。

### 测试方法

- 文档门禁：新 P3-C 子方向必须有决策登记和执行任务。
- `npm run repo:hygiene`
- `git diff --check`

### 验收门禁

- 本任务关闭条件不是实现 P3-C，而是确保 connector SDK、多租户、分布式 worker、mTLS fleet、插件市场不会作为一个未拆分大包进入当前计划。
- 任意新 P3-C 子方向必须有独立决策登记、依赖清单、风险说明、预设线归属、脱水方式和验收门禁。
- 文档和 feature profile 不得把多租户等同于企业私有化，不得把分布式 worker 变成 personal 默认依赖。
- 如果发现代码或文档已悄悄启动 P3-C 大包，必须登记 blocker，不能把本任务标完成。

### 用例

- 新增分布式 worker 任务时，必须说明是否进入 enterprise preset、依赖哪些 port、如何脱水。
- 新增多租户任务时，不能和企业私有化混成一个默认能力。

### 设计理念和维护规范

- P3-C 当前是搁置和拆分，不是隐藏启动；不得把 connector SDK、多租户、分布式 worker、mTLS fleet、插件市场作为一个大包落地。
- 每个子方向重启前必须单独说明依赖、风险、预设线、脱水方式、运维成本和验收门禁。
- 多租户不是企业私有化的同义词；分布式 worker 也不是个人电脑默认能力。
- 新 P3-C 子方向不能回退 P3-A 已批准的完整贡献者生态、市场和统计面板。

## T22 手机端降级保护

### 目标

- 手机端先不做，避免抢 P0/P1/P2 资源。

### 涉及的功能改造

- 不新增 iOS / Android Flutter shell 实现任务。
- 桌面 GUI 继续 Flutter，CLI 后端继续 Rust。
- 后续如果重启手机端，必须轻量 shell，不承载重解析、重蒸馏或长期后台服务。

### 测试方法

- `npm run client:verify`
- `npm run client:package:plan`
- 文档扫描：不得把手机端列为当前实现任务。

### 验收门禁

- 当前 package plan、feature profile、任务清单和客户端文档不得把 iOS/Android 列为当前交付。
- 桌面 GUI 必须继续 Flutter，CLI 后端必须继续 Rust；不得以手机端预留为理由改变当前客户端主线。
- 如果保留手机端未来路线，必须标为 future/blocked/deferred，不得影响 P0/P1/P2 资源排序。
- 新增 mobile 代码、CI、release 或默认构建入口时，本任务必须失败，除非已有新的明确决策。

### 用例

- package plan 不包含 mobile 默认构建。
- 手机端相关文档只保留未来路线，不显示为当前交付承诺。

### 设计理念和维护规范

- 手机端先不做是资源排序决策，不是技术否定；当前不得新增 iOS/Android 交付承诺。
- 桌面 GUI 继续 Flutter，CLI 后端继续 Rust；不能以手机端为理由改变当前客户端主线。
- 后续如果重启手机端，只能作为轻量 shell，通过 Pact 控制面访问能力，不能承载重解析、重蒸馏或长期后台服务。
- 文档、package plan 和 feature profile 都必须反映“非当前交付”状态。

## T23 低危残余风险维护策略

### 目标

- S-10 接受残余风险，不作为当前发布阻塞；维护相关文件时处理。

### 涉及的功能改造

- CI 失败输出避免过宽 JSON。
- legacy/dev-only Rust unsafe 添加说明或后续替换。
- User-Agent 软校验保持当前权衡，确保审计记录可见。

### 测试方法

- `npm run test:security`
- `npm run security:hygiene`
- 相关文件被改动时补最小 regression。

### 验收门禁

- S-10 相关低危项必须在安全 backlog 中保持“接受残余风险，维护时处理”状态，不得误标为已完全修复。
- 维护 CI 输出、legacy/dev-only Rust unsafe 或 User-Agent 校验相关文件时，必须补最小 regression 或说明残余风险未扩大。
- legacy/dev-only unsafe 不得进入主线默认包；如进入默认路径，必须重新升级为安全修复任务。
- User-Agent mismatch 必须有审计记录且不误杀正常用户；不能用静默吞错或完全放开代替当前权衡。

### 用例

- CI 失败日志不输出过宽 `needs` JSON。
- legacy unsafe 不进入主线默认包。
- User-Agent mismatch 有审计记录但不误杀正常用户。

### 设计理念和维护规范

- S-10 是接受残余风险，不是忽略风险；维护相关文件时必须顺手收窄或补说明。
- 低危项不阻断当前发布，但不能被扩大成新默认行为或新暴露面。
- legacy/dev-only 代码必须保持主线默认不可达，进入默认包前必须重新审计。
- 任何残余风险处理都要保持审计可见，不得用静默吞错代替治理。

## 收尾验收

每个任务关闭时必须完成：

- 更新对应核心文档或运行文档。
- 更新 `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md` 状态或新增替代任务文档。
- 至少运行 `git diff --check` 和 `npm run repo:hygiene`。
- 如果涉及服务端，运行对应 `npm run server:verify:*`。
- 如果涉及客户端，运行对应 `npm run client:verify:*`。
- 如果涉及安全，运行 `npm run server:verify:security-hardening` 或 `npm run test:security`。
