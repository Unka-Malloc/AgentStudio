# P1 决策说明

> 归档说明：本文是 2026-06-03 的 P1 批量决策过程记录，已从当前报告层移入 `docs/reports/history/`。当前任务顺序和验收口径以 `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md` 为准。

日期：2026-06-03

用途：记录 `docs/reports/OPEN-DECISION-CHECKLIST-2026-06-03.md` 里的 P1 批量决策。本文先解释为什么需要这些 P1 项；2026-06-03 维护者已批量批准，并补充了 P1-F、P1-G、P1-H 的范围约束。

回复方式仍然用编号：

```text
P1-A 批准
P1-C 调整：先做签名和回滚，依赖隔离下一批
P1-G 批准：优先算法升级，解析优先流行办公文档
```

## 已批准结论

2026-06-03 已批准：

- `P1-A` 批准。
- `P1-B` 批准。
- `P1-C` 批准，拆成短批次；先做签名、扫描、pin、回滚和 catalog 原子刷新。
- `P1-D` 批准。
- `P1-E` 批准。
- `P1-F` 批准；客户端 GUI 继续使用 Flutter，CLI 后端继续使用 Rust，其它旧遗留按清单清理。
- `P1-G` 批准；优先做算法升级，文档解析优先支持 DOCX、XLSX、PPTX、PDF 等流行办公文档。
- `P1-H` 批准；门禁优先做。

## 总体判断

P1 不是“再开一堆新方向”。它分成三类：

- 产品化：`P1-A` 安装接入、`P1-B` 共享空间。
- 治理闭环：`P1-C` Skill lifecycle、`P1-F` 客户端清理和配对。
- 工程护栏：`P1-D` 配置和迁移、`P1-E` runtime 资产外移、`P1-H` 前端边界、`P1-G` 知识蒸馏算法和旧壳清理。

## P1-A 安装和接入成为第一产品能力

问题：

Pact 已有 MCP、connector、doctor、目标扫描和配置写入基础，但现在更像工程工具链，不像用户能稳定使用的产品入口。只要用户还需要手工找配置文件、手工判断装没装好、手工回滚失败配置，Pact 就很难在 11 个智能体目标里形成稳定接入。

要做的决策：

是否把“安装、发现、配对、写配置、doctor、回滚、远端接入”作为 P1 产品能力，而不是散落在脚本和文档里的辅助功能。

决策状态：

已批准。

批准后的范围：

- 一条命令完成安装、校验、目标发现、handshake、grant、配置写入和 doctor。
- 覆盖 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf。
- 配置写入前必须有备份，失败后能回滚。
- 远端、VM、容器和无交互环境要有 bootstrap 命令、短期凭据、安装报告回传和撤销路径。
- 控制台要能看到每个目标的 installed、paired、healthy、needs_action 状态。

不做的范围：

- 不把 Pact 做成下游智能体 harness。
- 不为了一个智能体写特例路径，所有目标走同一 target adapter 模型。
- 不把用户 key 或配置写进项目目录。

验收标准：

- 任意一等支持目标都能输出安装计划、应用配置、运行 doctor、失败回滚。
- 配置文件写入有快照和审计记录。
- 远端安装能回传机器可读状态。

如果降级或搁置：

Pact 会继续像“懂的人能接起来”的开发工具，商业化和多智能体覆盖都会卡在安装门槛上。

## P1-B 共享空间产品化

问题：

共享空间已有本机目录、部分文件操作、checkpoint、audit 和云盘端口基础，但还没成为用户视角的可靠产品。大文件、路径级权限、版本恢复、冲突处理、跨智能体演示和审计 drilldown 不闭合时，它只能算协议和局部能力，不能算主场景。

要做的决策：

是否把共享空间作为 P1 产品主线，补齐从文件流转到跨智能体协作的用户闭环。

决策状态：

已批准。

批准后的范围：

- 大文件流式上传、下载、断点续传和传输进度。
- 路径级 ACL、只读/可写范围、配额、冲突处理和版本恢复。
- 文件、artifact、proposal、checkpoint、cloud drive receipt 能在同一视图里追踪。
- 至少一个跨智能体真实演示：A 写入共享空间，B 读取、处理、产出，用户能看到审计链。

不做的范围：

- 不把 OneDrive/iCloud live provider 的 P0 实现并入这一项；那是 `P0-06`。
- 不把共享空间直接变成无权限的普通文件夹。
- 不把本机目录 source/projection 说成已经备份，只有进入受控对象和 checkpoint 后才算受管资产。

验收标准：

- 大文件不会一次性读入内存。
- 任意路径访问都能解释“谁、何时、凭什么权限、对哪个版本做了什么”。
- 版本恢复能产生新的操作记录，而不是静默覆盖。

如果降级或搁置：

Pact 最核心的跨智能体协作价值会停在局部 API，用户很难感知 Pact 和普通文件夹、普通云盘的差别。

## P1-C 技能包 lifecycle 和 Tool Management catalog 原子同步

问题：

`P0-05` 已经确认技能包必须进独立 Skill Hub，不能混在 workspace contribution。P1-C 要解决的是另一个问题：技能包上传后，怎么扫描、签名、审批、安装、启用、降级、回滚、撤销，并且和 Tool Management catalog 保持一致。

要做的决策：

是否把 Skill Hub 做成有生命周期的受管技能库，而不是只做“能上传一个目录”的文件入口。

决策状态：

已批准，拆成短批次；先做签名、扫描、pin、回滚和 catalog 原子刷新。

批准后的范围：

- 技能包 manifest、`SKILL.md`、scripts、assets、templates、checksum 和签名进入统一包结构。
- 上传后先进入 scanned / reviewed 状态，不能直接对智能体可执行。
- Tool Management catalog、MCP discovery、agent profile 可见目录和 grant matcher 必须原子刷新。
- 支持 version pin、disable、deprecate、revoke、rollback。
- 安全扫描、依赖隔离和执行权限必须进入门禁。

不做的范围：

- 不做第三方插件市场，那是 P3。
- 不允许技能包绕过 Skill Hub 直接变成 workspace contribution。
- 不允许上传后立刻执行未扫描脚本。

验收标准：

- 上传最小技能包后，server Skill Hub 出现独立记录。
- 审批 / 激活后，`pact.discovery` 能看到新技能。
- 禁用或撤销后，同一个 grant 不再能看到或执行该技能。
- catalog 刷新失败时不能出现“包已启用但工具不可见”或“工具可见但包已撤销”的半状态。

如果降级或搁置：

Skill Hub 会有上传入口，但缺少生产治理，后续很难给智能体开放真实执行权限。

## P1-D 配置边界、SQLite migration、后端拆分和静态边界检查

问题：

配置、默认值、候选模板、运行时 fallback 和用户真实配置容易混在一起。SQLite 迁移风格也不统一。再叠加后端大模块，后续每次改功能都可能顺手破坏边界，而且不一定马上被测试发现。

要做的决策：

是否把这些工程债作为 P1 正式治理项，而不是等出问题再局部修。

决策状态：

已批准。

批准后的范围：

- 建立配置权威表：用户配置、候选模板、环境默认值、运行时 fallback 分开。
- 所有密钥、外部服务配置和本地数据默认外移到 `${PACT_SERVER_DATA_DIR}`，默认值为 `~/.pact-server-data`。
- SQLite schema 演进统一到版本化 migration，必要时有 rebuild/rollback 证据。
- 后端超大模块按领域拆分，先拆高频变更和边界不清的模块。
- 增加静态 verifier，阻断 fake path、项目目录内 key、跨层私有 import、裸路径拼接等回流。

不做的范围：

- 不为了“统一”做无业务收益的大重写。
- 不把客户端轻量配置改成默认 SQLite；客户端配置仍按既有结论使用 JSON，activity 使用 JSONL。
- 不把所有模块一次性拆完。

验收标准：

- 空用户配置仍然保持空，不被默认值污染。
- migration 有明确版本和执行记录。
- repo hygiene / secret hygiene 能阻断项目目录内密钥和 fake path。

如果降级或搁置：

后续 P0/P1 功能会继续堆在不稳定边界上，修一个场景可能带出新的配置和存储回归。

## P1-E runtime assets 和大二进制迁出 source checkout

问题：

JRE、Tika jar、下载缓存和其它 runtime 大文件如果长期留在类似源代码目录的位置，会拖慢 checkout、污染 diff、制造许可证和安全扫描噪音，也和“项目目录不保存运行数据或配置”的原则冲突。

要做的决策：

是否把 runtime 依赖、模型、jar、压缩包和下载缓存从 source checkout 迁到外部 runtime cache / 数据目录 / release artifact。

决策状态：

已批准。

批准后的范围：

- 源代码目录只保留元数据、manifest、校验规则和 `.gitkeep`。
- 本地默认 runtime cache 使用 `${PACT_SERVER_DATA_DIR}` 下的受控 runtime 区域，默认根目录仍是 `~/.pact-server-data`。
- 下载、校验、安装、升级和清理走 runtime dependency manager。
- Docker、离线包和 release artifact 可以携带运行时依赖，但必须有 checksum 和来源记录。

不做的范围：

- 不把大文件移动到另一个项目子目录里。
- 不在文档里引入不可验证的 fake 路径。
- 不在启动时偷偷下载未校验依赖。

验收标准：

- 源代码 checkout 不包含真实 JRE、Tika jar、模型大文件或下载缓存。
- runtime dependency verifier 能解释依赖来源、版本、checksum 和落地位置。
- 缺依赖时给出可执行安装命令，不伪装成已就绪。

如果降级或搁置：

项目会继续被运行时资产拖重，生产构建、审计和开发体验都会变差。

## P1-F 客户端旧 smoke、Rust client 清单和非 GUI pairing

问题：

客户端方向已经确认支持 11 个智能体目标，但旧客户端、Rust client、GUI 页面、CLI pairing、旧 smoke 脚本之间还有口径不清的地方。尤其是 Rust `agent_client` 到底保留、迁移还是删除，不能继续只靠抽象原则判断。

要做的决策：

是否为客户端旧能力建立 keep / migrate / remove 清单，并补齐非 GUI 智能体的 pairing 路径。

决策状态：

已批准；客户端 GUI 继续 Flutter，CLI 后端继续 Rust，其它旧遗留按 keep / migrate / remove / dev-only 清单清理。

批准后的范围：

- 为 Rust CLI 后端、旧页面、旧 smoke 脚本、local agent 原型和 adapter 代码建立逐模块清单。
- 明确哪些保留为主线，哪些迁到 Skill 示例，哪些只留开发工具，哪些删除。
- 非 GUI 智能体要有 CLI pairing、短期 pairing code、手动 target、撤销和状态查看路径。
- 11 个智能体目标在 README、安装器、客户端 UI、CLI、verifier 中保持一致。

不做的范围：

- 不把客户端变成自有 agent loop。
- 不把“安装成功”当成“已配对授权”。
- 不把 GUI 当成唯一入口，终端和远端智能体必须能完成配对。

验收标准：

- 每个旧模块都有 keep / migrate / remove / dev-only 结论。
- 非 GUI target 能通过命令行发起 pairing request，并在控制台批准或撤销。
- 旧 smoke 脚本要么更新到新架构，要么明确归档，不再代表当前产品状态。

如果降级或搁置：

客户端会继续出现“文档说薄转发、代码像 harness、GUI 和 CLI 各说各话”的问题。

## P1-G 知识蒸馏 embedding、ranker、legacy Office、邮件解析和旧壳删除

问题：

知识蒸馏已经有管控台入口，也已经明确走 `external.knowledge.distillation` 外部服务和上游网关切面。P1-G 不是重新确认入口，而是处理质量和债务：embedding/ranker 还需增强，legacy Office、邮件、复杂 PDF 和评估闭环还不够，内部旧 workbench shim 最终也要删除。

要做的决策：

是否把知识蒸馏的算法质量升级和旧壳删除纳入 P1，但排在安全、调度内核、队列落账和真实样本集之后。

决策状态：

已批准；优先做算法升级，文档解析优先支持 DOCX、XLSX、PPTX、PDF 等流行办公文档。

批准后的范围：

- 可配置 embedding provider、ranker、近邻索引或等价检索质量提升优先。
- DOCX、XLSX、PPTX、PDF 等流行办公文档优先；legacy Office、邮件和归档样本作为后续补齐。
- 测评集和样本必须放在外部数据目录，不能放进项目内部。
- 评估结果、成本、错误率、openability、证据保真都进入 operation / job / trace 记录。
- 所有新能力继续只进入 `external.knowledge.distillation`，旧内部 workbench shim 只保留迁移期，迁移完成后删除。

不做的范围：

- 不恢复内部知识蒸馏真实算法面。
- 不绕过上游网关、统一审批和操作账本。
- 不把 contract-mode 样本结果说成真实质量。

验收标准：

- 外部服务能对真实 PDF、Word、Excel、PPT、邮件样本输出可下载 Markdown 或包。
- 评估样本路径位于外部数据目录。
- legacy shim 删除前有调用方迁移证明；删除后 verifier 阻断内部 workbench 被当成真实入口。

如果降级或搁置：

知识蒸馏仍可作为外部服务运行，但质量和旧债会限制复杂文档场景的可信度。

## P1-H 前端 i18n、style、shared type 和组件测试边界

问题：

`P0-11` 已经把前端后端访问边界收紧到 `server-web/lib/*-client.ts` + controller，但前端还剩另一类问题：i18n 文案、DOM localizer、CSS ownership、shared utility type、新组件测试和稳定 id 容易继续混在一起。

要做的决策：

是否把前端边界治理从“API 访问”扩展到“文案、样式、类型、组件行为”的 P1 门禁。

决策状态：

已批准；门禁优先做。

批准后的范围：

- 新文案优先进入结构化 message key，DOM localization 只作为兼容层。
- 样式明确归属到 token、component、view 或 feature slice，避免随手塞到全局 CSS。
- 新公共组件要有最小测试，覆盖关闭、焦点、disabled、保存/刷新状态、tooltip 可见性等行为。
- stable id 使用 Vue API 或确定性 props，不使用随机 id 破坏测试。
- shared utility type 继续按领域拆分，避免大类型 facade 重新膨胀。

不做的范围：

- 不为了抽象把所有重复 UI 一次性组件化。
- 不把 DOM localizer 删除成破坏兼容的改动。
- 不把页面私有状态重新塞回 `useConsole()`。

验收标准：

- `npm run server:verify:frontend-architecture` 继续守住 API/client/controller 边界，并逐步增加 i18n/style/type/component 检查。
- 新增公共组件有 focused test 或明确豁免理由。
- 大 CSS、i18n 和 type facade 不重新变成业务聚合点。

如果降级或搁置：

前端后端 API 边界会好一些，但 UI 质量、可维护性和测试稳定性仍会反复掉回旧模式。

## 实际批准口径

维护者已经按以下口径批准：

```text
P1-A 批准
P1-B 批准
P1-C 批准：拆成短批次，先做签名、扫描、pin、回滚和 catalog 原子刷新
P1-D 批准
P1-E 批准
P1-F 批准：客户端的 GUI 还是 Flutter，CLI 后端还是 Rust，其它的旧遗留清理
P1-G 批准：优先做算法升级，文档解析优先支持流行的办公文档
P1-H 批准：门禁需要优先做
```

## 来源

- `docs/reports/history/COMMERCIALIZATION-IMPROVEMENT-PLAN.zh-CN.md`
- `docs/reports/history/SCENARIO-IMPLEMENTATION-GAPS.md`
- `docs/reports/history/PROJECT-PROGRESS-ASSESSMENT-2026-06-03.md`
- `docs/reports/history/PROJECT-HYGIENE-BASELINE-2026-06-03.md`
- `docs/reports/history/client-design-review-2026-05-26.md`
- `docs/reports/history/CLIENT-IMPLEMENTATION-PLAN.md`
- `docs/reports/history/KNOWLEDGE-DISTILLATION-PROGRESS.md`
- `docs/reports/history/SERVER-WEB-FRONTEND-AUDIT-2026-06-01.md`
