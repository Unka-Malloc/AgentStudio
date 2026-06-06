# P2 决策说明

> 归档说明：本文是 2026-06-03 的 P2 批量决策过程记录，已从当前报告层移入 `docs/reports/history/`。当前任务顺序和验收口径以 `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md` 为准。

日期：2026-06-03

用途：记录 `docs/reports/OPEN-DECISION-CHECKLIST-2026-06-03.md` 里的 P2 批量决策。P2 不阻断当前 P0/P1，但会决定后续产品规模、交付形态和长期架构。

说明：本文里的 P2 是历史报告归并出的后续批次，不替换 `docs/IMPLEMENTATION-DECISION-REGISTER.md` 里早期已经拍板的 `DEC-P2-*`。2026-06-03 维护者已批量确认，新的归并批次已登记到核心决策表。

回复方式：

```text
P2-A 降级
P2-B 批准
P2-C 批准：提前到 P1 门禁批次
```

## 已批准结论

2026-06-03 已确认：

- `P2-A` 降级，手机端先不做。
- `P2-B` 批准，优先做；必须结合平台功能模块脱水能力，把企业和个人所需模块分成两条线维护。企业私有化部署时，中间件必须能替换为企业内部已有服务；个人电脑上不部署集群。所有附加功能都作为可脱水模块，形成个人电脑轻量预设和企业私有化预设两套构建路线。
- `P2-C` 批准，提前到 P1 门禁批次。
- `P2-D` 批准，提前到 P1，先统一 provider mode 和 receipt 字段。
- `P2-E` 批准，建设模块和外部服务接入生态，提供统一治理逻辑和模块划分。
- `P2-F` 批准，优先拆分。

## 总体判断

P2 主要有三类：

- 产品形态：`P2-A` 多端客户端、`P2-B` 个人云和企业私有化。
- 事实门禁：`P2-C` 场景状态机器可读报告、`P2-D` provider 状态命名。
- 长期工程化：`P2-E` 模块 SDK、外部服务生态、多模态资产血缘、脚本和依赖治理。

## P2-A 多端客户端

问题：

Pact 的客户端方向已经明确：桌面 GUI 继续 Flutter，CLI 后端继续 Rust。当前缺的是 iOS / Android 手机端：手机不能只做展示页，它需要支持共享空间、系统分享、审批、安装状态和远端智能体唤起。但如果太早做手机端，会分散 P1-A 安装接入和 P1-F 客户端主线清理。

要做的决策：

是否现在就把 iOS / Android Flutter shell 纳入路线，还是先降级保留，等桌面和 CLI 主线稳定后再启动。

决策状态：

已降级，手机端先不做。

保留范围：

- 桌面 GUI 继续 Flutter。
- CLI 后端继续 Rust。
- iOS / Android Flutter shell 暂不启动；只保留后续路线，不进入当前实现批次。

不做的范围：

- 不做手机端产品入口。
- 不在手机端内置重型本地服务。
- 不让手机端提前抢 P0/P1 资源。

验收标准：

- P1-A/P1-F 稳定前，不新增手机端实现任务。
- 后续如重启手机端，必须继续使用轻量 Flutter shell，不能绕过 Operation Scheduling Kernel、统一审批和操作账本。

如果搁置：

Pact 暂时保持桌面和 CLI 优先，移动端体验后移；短期影响用户便利性，不影响当前 P0/P1 主闭环。

## P2-B 个人云服务和企业私有化双线

问题：

Pact 当前更接近本地服务和私有化原型。要商业化，需要两条线：个人用户能用云服务；企业用户能完全私有化部署。两者都需要账号、设备、升级、迁移、备份恢复、密钥管理和审计导出，但不能一开始就引入过重分布式栈。

要做的决策：

是否把“个人云 + 企业私有化”列为 P2 正式路线，而不是散落在部署脚本和商业化文档里。

决策状态：

已批准，优先做。

批准后的范围：

- 平台功能必须支持模块脱水：附加功能不能强塞进默认包，必须能被 Feature Profile / composition preset 裁剪。
- 维护两套预设构建路线：个人电脑轻量预设和企业私有化预设。
- 个人电脑预设默认使用模块化单体、SQLite、本机文件对象存储、本机目录和可选网关，不部署集群。
- 企业私有化预设允许启用企业级中间件，但通过 port / adapter 接入；Postgres、Redis、S3、KMS、网关、审计导出等都必须能替换为企业内部已有服务。
- 个人云控制面：账号、设备、workspace、共享空间、用量、限额、成本归因、滥用防护。
- 企业私有化：Docker Compose / Kubernetes、管理员初始化、升级迁移、回滚、备份恢复演练、审计导出。
- 密钥后端：本地 secret store 仍可用，企业版预留 KMS/HSM/Infisical 等后端。

不做的范围：

- 不把个人电脑部署成集群。
- 不把 P0/P1 阶段强制迁到 Postgres、Redis、S3 或 Kubernetes。
- 不把 contract-mode 外部 provider 包装成云服务可用。
- 不让业务模块直接依赖某个云厂商或某个企业中间件实现。
- 不让企业附加能力污染个人版默认路径。

验收标准：

- 有个人电脑轻量预设和企业私有化预设的 feature/composition 计划。
- 任意附加功能能说明是否可脱水、依赖哪些模块、在哪个预设启用。
- 企业私有化部署能把中间件替换为企业内部已有服务，并仍通过同一 port / adapter 合同运行。
- 私有化部署能演示初始化、升级、备份、恢复、审计导出。
- 云和私有化都能解释数据、密钥、审计、成本和撤销边界。

如果降级或搁置：

项目会继续偏本地工程验证，商业交付口径会缺少可信闭环。

## P2-C 场景级 verifier 和实现状态 JSON

问题：

现在已有很多单项 verifier，但 8 个场景的完成度仍主要靠文档归纳。缺少一个机器可读状态文件，能说明每个场景节点对应哪个 operation、哪个 verifier、当前状态和 blocker。

要做的决策：

是否新增 `scenario-implementation-status.json` 和场景级 verifier，把场景完成度从文字报告变成门禁事实。

决策状态：

已批准，提前到 P1 门禁批次。

批准后的范围：

- 新增 `docs/scenarios/scenario-implementation-status.json` 或等价机器可读文件。
- 每个场景节点记录 status、operationIds、toolIds、verifier、evidence、blockers。
- 新增 `server:verify:scenario-e2e` 或聚合 verifier，检查文档、注册 operation 和测试项一致。
- 控制台后续可以读取该状态，显示场景级完成度和 blocker。

不做的范围：

- 不把场景状态手工写成永远不校验的表格。
- 不把局部 verifier 通过当成场景完成。
- 不在状态文件里伪造 live provider 或真实外部 E2E。

验收标准：

- 任意场景显示 planned / partial / blocked / verified 时，都有对应 verifier 或 blocker。
- operation 删除、重命名或 verifier 缺失时，场景门禁失败。

如果降级或搁置：

后续仍会反复靠人工阅读报告判断完成度，容易把历史状态误认为当前事实。

## P2-D provider 模式命名统一

问题：

代码和文档里存在 `contractVerified`、`localAdapterVerified`、`dryRun`、`uploaded`、`projected` 等不同说法。它们不能混用：contract-mode 只证明协议合同，不等于真实外部上传成功；local-live 只证明本机 adapter，不等于远端云盘 API 成功。

要做的决策：

是否固定 provider 模式词表和 receipt 字段，避免“假接通”继续混进真实状态。

决策状态：

已批准，提前到 P1；先统一 provider mode 和 receipt 字段。

批准后的范围：

- 固定模式：`contract`、`local-live`、`remote-live`、`dry-run`、`failed`。
- receipt 必须声明 provider mode、verification source、remote id 或 local projection id。
- UI 文案区分“合同验证”“本机适配器成功”“远端 provider 成功”。
- verifier 阻断把 contract-mode 说成 live success。

不做的范围：

- 不继续使用含糊的 `connected` 表达真实外部可用。
- 不让 fake provider、dry-run 或 contract-mode 出现在生产口径。

验收标准：

- OneDrive/iCloud 等 provider 状态在 API、receipt、UI、文档里用同一词表。
- contract-mode provider 不会显示为真实远端成功。

如果降级或搁置：

外部集成会继续出现“看起来接通了，其实只是 contract-mode”的误导。

## P2-E 模块 SDK、模板、组织治理和多模态资产血缘

问题：

Pact 已有模块和外部服务边界，但第三方或内部团队要稳定扩展模块，还缺 SDK、模板、合同测试、schema docs、组织级策略和多模态资产血缘。没有这些，模块扩展会靠复制现有代码，后期难治理。

要做的决策：

是否建设模块生态基础，但不进入插件市场和商业 marketplace。

决策状态：

已批准。

批准后的范围：

- 模块 SDK、create-module 模板、contract test、CI 模板、schema docs。
- 外部服务接入生态：统一注册、健康检查、capability 声明、scope、secretRef、审计、降级和撤销逻辑。
- 组织级策略：谁能安装、启用、升级、撤销模块。
- 统一模块划分：模块、外部服务、Skill、Tool Package 和 mount 不能各自发明治理状态。
- 多模态资产血缘：图片、OCR、表格、附件、派生块和 evidence ref 之间的来源链。
- 模块能力必须继续走 operation registry、Tool Management、权限、审批和审计。

不做的范围：

- 不做完整插件市场，那是 P3。
- 不允许模块绕过调度内核、统一审批和账本。
- 不让模块 SDK 绑定某个单一部署后端。
- 不让外部服务绕过统一治理逻辑自建授权、审计或启停状态。

验收标准：

- 新模块可用模板生成，并通过 contract test。
- 外部服务和模块使用同一治理口径描述注册、启用、禁用、授权、审计和撤销。
- 多模态资产能从结果追溯到来源对象和解析步骤。

如果降级或搁置：

短期不影响 P0/P1，但后续扩展模块会越来越依赖人工经验和复制粘贴。

## P2-F package scripts、版本元数据和依赖 ownership

问题：

`package.json` 脚本持续变大，Node、Flutter、Rust、Docker、外部服务和测试脚本之间的版本要求与责任边界不够清楚。长期会导致“能在某个人机器上跑，但别人复现不了”。

要做的决策：

是否把脚本拆分、版本元数据和依赖 ownership 做成 P2 工程治理项。

决策状态：

已批准，优先拆分。

批准后的范围：

- 拆分过大的 package scripts，形成按 server/client/docs/security/runtime/scenario 分组的入口。
- 记录 Node、Flutter、Rust、Java、Docker、Tika 等版本要求和检查方式。
- 为主要依赖和 runtime assets 建立 ownership，说明谁维护、怎么升级、怎么验证。
- repo hygiene 能检查关键版本元数据和脚本入口没有漂移。

不做的范围：

- 不为了整理脚本打断 P0/P1 工作流。
- 不把所有工具链升级混进同一个大提交。
- 不继续把新增验证入口无限塞进根 `package.json` 的单层脚本清单。

验收标准：

- 新人或 CI 能根据版本元数据复现开发和验证环境。
- 重要依赖升级有 owner、影响范围和 verifier。

如果降级或搁置：

短期能继续开发，但仓库可复现性和维护成本会持续恶化。

## 实际批准口径

维护者已经按以下口径批准：

```text
P2-A 降级，手机端先不做
P2-B 批准：优先做，结合模块脱水能力，个人电脑轻量预设和企业私有化预设两条线维护
P2-C 批准：提前到 P1 门禁批次
P2-D 批准：提前到 P1，先统一 provider mode 和 receipt 字段
P2-E 批准：做模块和外部服务接入生态，统一治理逻辑和模块划分
P2-F 批准：优先拆分
```

## 来源

- `docs/reports/history/COMMERCIALIZATION-IMPROVEMENT-PLAN.zh-CN.md`
- `docs/reports/history/PROJECT-PROGRESS-ASSESSMENT-2026-06-03.md`
- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/V0.0.1-IMPLEMENTATION-PLAN.md`
- `docs/reports/history/production-readiness/*/report.md`
- `docs/reports/history/CLIENT-IMPLEMENTATION-PLAN.md`
