# AgentLibrary Governance

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: AgentLibrary Governance.
- Staleness check: Scanned on 2026-06-13; this update adds the AgentLibrary native capability boundary and normalized knowledge-rule DSL primitive model and does not change release/readiness claims.

本文定义 Pact 的 `AgentLibrary / 图书馆` 治理边界。图书馆不是资产后台，也不是智能体私有记忆；它是公共工作空间可安全引用、可共享、可借阅、可登记、可管控的 evidence runtime。

## 目录 / Table of Contents

- [定位](#定位)
  - [AgentLibrary 自有能力](#agentlibrary-自有能力)
- [智能体知识权限第一原则](#智能体知识权限第一原则)
- [终端贡献与专家知识](#终端贡献与专家知识)
  - [借阅登记](#借阅登记)
  - [外部知识库再授权](#外部知识库再授权)
  - [演示场景：上游知识库 A/B 权限再授权](#演示场景上游知识库-ab-权限再授权)
- [三层知识模型](#三层知识模型)
  - [1. Raw Corpus Construction](#1-raw-corpus-construction)
  - [2. Knowledge Index Construction](#2-knowledge-index-construction)
  - [3. Knowledge Distillation](#3-knowledge-distillation)
- [Evidence Pack](#evidence-pack)
- [知识权限](#知识权限)
- [动态解析与预算](#动态解析与预算)
- [知识规则 DSL 原语](#知识规则-dsl-原语)
- [Markdown 基线](#markdown-基线)
- [Dossier](#dossier)
- [外部知识库适配](#外部知识库适配)
- [知识维护闭环](#知识维护闭环)
- [受控蒸馏验收流程](#受控蒸馏验收流程)
- [与工作空间的关系](#与工作空间的关系)

## 定位

> Pact 把资产型知识库转化为 AgentLibrary：面向智能体的受控图书馆。

AgentLibrary 的核心卖点是中间层治理：

- 上游知识库太粗，AgentLibrary 做信息切分、权限精加工、脱敏、借阅登记和再授权。
- 下游本地智能体太细，AgentLibrary 给它们提供共享的知识、Skills、专家意见、黄金规则和可复用贡献入口。
- 智能体不直接面对最上游知识库，也不只在自己的本地小空间里互相复制资料；它们通过 AgentLibrary 使用被治理过的公共资产。

命名边界：

- `AgentLibrary / 图书馆` 是产品概念和用户心智。
- `knowledgeBase` / `v0.0.1:knowledge:core-1` 是当前内部 mount 和兼容协议名。
- 新设计、控制台文案和后续能力命名应优先使用 AgentLibrary；底层协议可在兼容期继续保留 knowledge 命名。

### AgentLibrary 自有能力

AgentLibrary 自有能力只包括：

- `Library Access`：外部知识库接入、授权、space / source / library card 发现。
- `Governed Projection`：把外部结果转成 Pact 可治理的 document、section、block、evidence 和 asset projection。
- `Rule Decision`：统一规则包，对 access、projection、egress、classification 和 route 做决策。
- `Delivery Ledger`：记录阅读、引用、导出、checkout、context injection 和撤销。
- `Contribution Intake`：接收人或智能体贡献的专家意见、规则包、Skill 和整理产物；进入 AgentLibrary 前仍要过治理和投影。

解析器、OCR、向量库、图谱库、蒸馏服务、导出 renderer、word bag、taxonomy、source sync 和 maintenance job 都不是 AgentLibrary 自有能力。它们只能作为外部 adapter、stage worker 或 projection helper 被上述五类能力调用。

AgentLibrary 公开控制台和 agent-facing operation 必须按这五类自有能力组织：

| 公开分组 | 吸收的现有能力 |
| --- | --- |
| `Library Access` | source / space discovery、search、external adapter query、library card。 |
| `Governed Projection` | parse route、projection build、evidence pack、export projection、distillation projection。 |
| `Rule Decision` | AgentLibrary Rule Package、规则发布、规则验证、规则命中 trace。 |
| `Delivery Ledger` | evidence read、citation、export、checkout、context injection、loan record、revocation。 |
| `Contribution Intake` | expert opinion、rule draft、Skill、人工整理产物和智能体贡献入口。 |

现有 ingest、maintenance、rules、word cloud、taxonomy、export 等页面或 operation 不能继续作为并列产品分组出现；保留时只能映射到上述五类之一，或降级为 adapter / stage worker / projection helper 的内部维护面。

Governed Projection 边界：

- Projection builder 只负责把外部对象或 stage worker 输出包装成可治理视图。
- 输出形态是 document、section、block、evidence、asset projection、permission overlay、sourceTrace、projectionHash、ttl 和 revocationPolicy。
- Projection builder 不负责 parser、OCR、embedding、graph merge、taxonomy inference、distillation summary 或 export rendering。
- 解析、OCR、索引、图谱、蒸馏、分类算法和导出渲染只能由 adapter、stage worker 或外部服务完成，并把结果交给 Projection builder 登记为 governed projection。
- 如果 Projection builder 需要补全字段，只能调用已授权的 stage output 或 adapter hydrate 结果，不能绕过 Source Authority Policy 直接发明事实。

传统知识库偏资产管理：资料多、维护难、不透明、有什么说什么、缺少面向智能体的权限控制。Pact 的知识能力必须解决这些问题：

- 智能体不是默认拿到全库资产，而是先经过源头权限裁决；有权限时可以进入更大的知识空间读取，不再被算法强行限制在少量 chunk。
- 权限作用在知识层，不只是工具层。
- 检索结果解释为什么命中、为什么过滤、哪里不确定。
- 维护入口来自使用过程中的冲突、过期、解析失败和用户反馈。
- 知识上下文按任务、角色、权限和预算编译；算法优化是辅助，源头权限和可操作索引是主线。

## 智能体知识权限第一原则

Pact 和传统知识库走的是两条路。传统知识库常把重点放在切分、召回、排序和摘要上，默认“存了多少就尽量给智能体多少”，安全边界主要靠应用层或提示词。Pact 的第一问题是：哪些知识从源头就不允许智能体参考，哪些知识允许参考，允许参考到什么颗粒度，允许不允许带走。

这不是后处理问题，而是 source-level governance：

- 资产入库时必须标记 `dataClass`、`sensitivity`、`workspaceScope`、`sourceScope`、`owner`、`retention`、`allowedSubjects`、`allowedAgentProfiles` 和 `allowedActions`。
- 权限颗粒度必须能细到 source、document、section、block、field、table cell、image、attachment、evidence pack、asset rendition。
- 检索、上下文编译、证据回读、导出、蒸馏、记忆写入、artifact 生成都必须先经过同一套知识权限裁决。
- 被禁止给智能体参考的资产，不能进入 retrieval candidate、context bundle、distillation input、memory summary、artifact、trace 或评估样本。

随着大模型基座更强、上下文更长、注意力更好，知识库的角色会减轻：它不应主要替智能体压缩世界，而应维护一个分类清楚、索引完备、权限严格的知识空间。智能体只要有权限，就可以像进入图书馆一样访问大量资料；没有权限时，即使算法认为相关，也不能返回。

图书馆模型：

| 类比 | Pact 权限 |
| --- | --- |
| 门禁卡 | `workspace.enter`，能不能进入这个知识空间。 |
| 楼层 | `sourceGroup.read`，能访问哪些业务域、项目、团队、密级区域。 |
| 书架 | `catalog.discover` / `metadata.read`，能不能看到目录、标题、摘要和存在性。 |
| 图书 | `asset.read` / `evidence.read`，能不能读具体内容。 |
| 阅览室 | `controlledView`，只能在 Pact 受控会话内阅览，不能导出或写入长期记忆；它不是读取本机原路径。 |
| 借走 | `checkout` / `export`，能不能下载、复制进 artifact、放入 context bundle 或带到其它 workspace。 |

因此，`read`、`cite`、`copyToContext`、`export`、`checkout`、`writeMemory` 是不同权限，不能合并成一个“可访问”布尔值。

## 终端贡献与专家知识

AgentLibrary 的信息源不只有知识库。终端贡献的知识、Skills、脚本、文件、黄金规则和专家意见是更接近智能体可用参考的资产，因为它们通常已经经过人或本地智能体的过滤、验证和精加工。

Contribution Intake 的默认状态是 proposal / contribution，不是 fact。专家意见、规则草稿、Skill、人工整理产物、智能体生成内容和本地上传材料都必须先作为贡献进入治理流程；它们不能因为贡献者可信、排名高、模型置信度高或内容格式完整而直接覆盖外部知识库事实。

贡献型知识仍然要被治理：

- `goldenRule` 可以作为高优先级工作约束，但必须有来源、适用范围和复核周期。
- `expertOpinion` 可以作为人工判断，但必须与 evidence / decision 分层，不能自动覆盖事实。
- `skill` 可以被其它智能体复用，但必须声明权限、风险、版本、输入输出和可撤销授权。
- `script` 和 `tool` 必须进入 Tool Management / Policy 裁决，不能因为贡献者排名高就自动执行。
- `knowledge` 贡献可以进入 AgentLibrary，但是否成为 accepted governed evidence 或 contribution evidence 仍需 review；它不能伪装成外部知识库 authoritative fact。

Contribution Intake 必选字段：

| 字段 | 语义 |
| --- | --- |
| `contributionId` | 贡献记录 ID。 |
| `contributionType` | expertOpinion、ruleDraft、skill、curatedDocument、agentGenerated、script、tool、knowledgeNote 等。 |
| `contributorRef` | 人、agent、service 或 workspace contributor。 |
| `createdAt` | 贡献时间。 |
| `workspaceRef` | 所属 workspace / tenant / project scope。 |
| `sourceAuthority` | 必须标注为 `local contribution`、`agent contribution` 或其它非上游权威来源。 |
| `evidenceRefs` | 支撑该贡献的外部 evidence、projection、artifact 或人工引用；没有时必须显式为空并说明原因。 |
| `scope` | 适用 workspace、source group、stage、task type、rule scope 或 Skill scope。 |
| `riskClass` | data class、sensitivity、execution risk、egress risk 和 legal / retention 约束。 |
| `expiry` | 过期时间或复核周期。 |
| `reviewCycle` | reviewer、review state、next review at 和 required approvals。 |
| `promotionStatus` | proposed、acceptedGovernedEvidence、activeRulePackage、reusableAsset、rejected、retired。 |
| `reviewDecision` | allow、deny、needsRevision、superseded，以及 decision reason 和 audit ref。 |
| `provenance` | 原始提交、生成模型、prompt、人工编辑、sourceTrace 和变更历史。 |

晋升规则：

- `expertOpinion` 晋升后仍是 opinion / decision support，不能成为外部知识库事实。
- `ruleDraft` 只能晋升为 active AgentLibrary Rule Package，不能保留旧规则类型。
- `skill` 晋升为 reusable asset 前必须经过权限、输入输出、风险和撤销策略审查。
- `curatedDocument` 或 `agentGenerated` 内容晋升后只能成为 accepted governed evidence 或 contribution evidence，并必须保留本地贡献来源。
- 如果贡献和外部知识库事实冲突，默认外部知识库胜出；贡献只能生成 review item、dispute、annotation 或 proposal。

贡献排行榜和统计面板用于发现高价值贡献者和高复用资产。贡献次数、被使用次数、被授权次数、跨 workspace 采用次数和复用成功率都可以提高排名；回滚、过期、风险和失败率会降低排名。

### 借阅登记

AgentLibrary 允许共享，也允许借走，但必须登记和管控。

凡是离开图书馆边界的信息，都必须产生 `knowledgeAccessReceipt` 和 `loanRecord`：

- 哪个 subject / agent / workspace / task 取用了信息。
- 取用的是原文、脱敏摘录、summary、evidence、metadata、表格单元格、图片还是派生视图。
- 权限模式是 `controlledView`、`citeOnly`、`copyToContext`、`exportAllowed` 还是 `checkoutAllowed`。
- 是否允许写入 artifact、长期 memory、上下文包、导出文件或其它 workspace。
- 有效期、撤销策略、再次分享策略和审计 ID。

系统必须记录智能体从图书馆知道的每一项信息。这里的“知道”指任何被返回给智能体、被注入模型上下文、被写入 artifact、被导出、被写入 memory、被用于蒸馏或被传给下游工具的内容。

被禁止带走的内容必须在所有出口都被同一策略拦截：

- search result
- evidence read
- context bundle
- export
- artifact generation
- distillation input / output
- memory write
- external adapter passthrough
- trace / evaluation sample

也就是说，不允许带走的内容，智能体怎么发请求都带不走。

Delivery Ledger 全链路字段：

所有离开 AgentLibrary 控制边界的信息交付或交付尝试，都必须写入 `Delivery Ledger Event`。覆盖路径包括 search result、evidence read、citation、context injection、artifact write、export、checkout、distillation input / output、memory write、tool passthrough、trace 和 evaluation sample。

必选字段：

| 字段 | 语义 |
| --- | --- |
| `deliveryEventId` | 全局事件 ID。 |
| `eventType` | `searchResult`、`evidenceRead`、`citation`、`contextInjection`、`artifactWrite`、`export`、`checkout`、`distillationInput`、`distillationOutput`、`memoryWrite`、`toolPassthrough`、`traceSample`、`evaluationSample` 等。 |
| `occurredAt` | 事件时间。 |
| `subjectRef` | 发起访问的用户、agent、service 或 workspace subject。 |
| `agentRef` | 具体 agent profile、agent instance 或 automation 身份。 |
| `workspaceRef` | 当前 workspace / tenant / project scope。 |
| `taskRef` | task、operation、conversation、run 或 workflow 引用。 |
| `sourceRef` | 上游 source、externalRef、contributionRef 或 local compatibility wrapper 引用。 |
| `projectionRef` | governed projection、evidence pack、section、block、field、asset rendition 或 snippet 引用。 |
| `sourceAuthority` | external authoritative、local contribution、compat wrapper、cache sidecar 等来源权威类型。 |
| `contentShape` | metadata、snippet、field、tableCell、image、summary、fullText、asset、package 等交付形态。 |
| `egressMode` | controlledView、citeOnly、copyToContext、exportAllowed、checkoutAllowed、memoryWrite、toolPassthrough 等。 |
| `permissionDecisionId` | AgentLibrary access decision 引用。 |
| `decisionOutcome` | allowed、denied、redacted、partial、needsReview。 |
| `receiptId` | `knowledgeAccessReceipt` 或 denied receipt 引用。 |
| `loanRecordId` | 可带走、导出、checkout、context injection、memory write 时的借阅记录；不适用时为空但字段必须存在。 |
| `ttl` | 交付或借阅有效期。 |
| `revocationPolicy` | 撤销策略和传播要求。 |
| `downstreamTarget` | 接收方：model context、artifact、file export、tool、memory、distillation service、evaluation store 等。 |
| `redactionSummary` | 是否脱敏、字段级脱敏摘要和 redaction policy ref。 |
| `projectionHash` | 交付投影的 hash。 |
| `auditId` | Operation Ledger / audit trail 引用。 |
| `traceId` | 端到端 trace。 |

可选字段按场景启用：

| 字段 | 适用场景 |
| --- | --- |
| `queryRef` | search result、retrieval rank、evidence lookup。 |
| `citationRefs` | citation、evidence read、artifact write、export。 |
| `sourceRange` | section、block、field、snippet、table cell、image crop。 |
| `modelContextRef` | context injection、distillation、memory write、agent response。 |
| `artifactRef` | artifact write、export、checkout package。 |
| `exportPackageRef` | export、checkout、distillation output。 |
| `memoryRef` | memory write 或 long-term context。 |
| `toolCallRef` | tool passthrough 或下游工具调用。 |
| `distillationRunRef` | distillation input / output。 |
| `evaluationSampleRef` | trace / evaluation sample。 |
| `adapterRef` | external adapter query / evidence read / hydrate。 |
| `cacheEntryRef` | 命中或写入可撤销缓存。 |
| `externalPolicyRef` | 上游知识库权限、dataset policy 或 provider policy。 |
| `withheldRefs` | 因权限、脱敏、预算或 revocation 被隐藏的字段或 evidence。 |
| `budget` | token、byte、row、image、time 或 cost budget。 |
| `riskClass` | data class、sensitivity、legal hold、retention class。 |
| `approvalRef` | 高风险导出、checkout、跨 workspace share 或人工审批。 |
| `revocationCascadeRef` | 撤销向 artifact、memory、export package 或下游 workspace 传播的记录。 |
| `failureReason` | denied、partial、redacted、adapter unavailable、fieldUnavailable 等失败或降级原因。 |

### 外部知识库再授权

Pact 的知识空间不是外部知识库的同型复制，也不是用内部知识库替代外部知识库。外部知识库是主要事实源、索引源和资产源；Pact 只提供轻量封装、授权覆盖、证据投影、规则扩展、审计和可控出口。

Source Authority Policy：

- 外部知识库对象是 authoritative source，优先拥有事实、索引和资产权威。
- Pact 本地只保存 governed projection、cache、receipt、ledger、config、rule package 和 contribution。
- `KnowledgeCore`、SQLite、本地 source sync 和 external mirror 只能是 dev backend、compat wrapper、cache sidecar 或审计辅助，不能被命名或使用为 canonical evidence store。
- 每个 projection 必须带 `externalRef`、`sourceAuthority`、`projectionHash`、`ttl` 和 `revocationPolicy`。
- 外部知识库和本地投影冲突时，默认外部知识库胜出；本地只能生成 review item 或 contribution proposal，不能直接覆盖上游事实。
- 导出、蒸馏、索引扩展和 evidence pack 必须能回溯到上游 `externalRef` 或明确标注为本地 contribution，而不能伪装成上游事实。

上游知识库的信息和资源权限再分配是 AgentLibrary 的核心功能。AgentLibrary 不把外部知识库整体搬进内部库，而是把上游返回结果投影为 workspace、source group、document、section、block、field、asset rendition、evidence pack 等下游可治理视图，并为每个 subject / workspace / agent profile 生成独立的 `authorizationOverlay`。这些投影视图是上游引用和授权派生，不是新的 canonical 资产事实源。

流程必须是：

```text
upstream knowledge base
  -> upstream connector / adapter
  -> Pact on-demand fetching / live proxying
  -> governed projection / information slicing
  -> authorizationOverlay
  -> derivedKnowledgeView
  -> downstream workspace / agent access
```

这条链路解决的是上游和下游权限不一致的问题：上游知识库里有的内容，不代表下游某个人、某个 workspace 或某个智能体能看。Pact 可以在中间卡住权限颗粒度：

- 上游文档允许进入 Pact，但只允许某些 workspace 发现。
- 某些人只能看 metadata，不能看正文。
- 某些智能体可以读脱敏 evidence，不能读原始资产。
- 某些任务可以 `controlledView`，但不能 `checkout`。
- 某些内容可以进入人类控制台，不允许进入模型上下文。
- 某些 source 可以用于人工审计，不能进入自动蒸馏。
- 同一份上游资源可以对不同下游身份生成不同派生视图、不同脱敏版本和不同借阅策略。

下游智能体不需要、也不应该直接访问最上游知识库。它们不能持有上游 API token，不能知道上游私有对象路径，不能绕过 Pact 的 `authorizationOverlay` 直接查上游索引。这样上游知识库仍然是资产源，Pact 则是面向 workspace 的再切分、再授权、规则扩展和证据治理层。

live proxy 是默认形态：Pact 在请求时从外部知识库读取、投影、裁决和返回。只有为了受控缓存、审计重放、导出、离线评估或明确的用户 checkout，才保存最小必要的授权派生内容。保存内容也必须标记 `externalRef`、`projectionHash`、`ttl`、`revocationPolicy` 和 `cachePurpose`，并且不得被当作替代外部知识库的 canonical store。

### 演示场景：上游知识库 A/B 权限再授权

目标：证明 Pact 可以把上游知识库里的同一份文件重新授权给不同下游主体，并且对话页、检索、上下文编译和导出都执行同一个权限裁决。

流程：

1. Pact 通过上游知识库 adapter 获取某个文件，只把上游对象登记为 `upstreamKnowledgeRef`，不把上游 token、对象路径、collection id 或裸 source id 暴露给下游。
2. Pact 对上游返回内容执行信息切分，生成下游可治理的 document、section、block、field、asset rendition 和 evidence pack 投影，并写入可重建的 `derivedKnowledgeView` 索引或短期缓存。
3. 管理员在管控台配置 `authorizationOverlay`：A 可以访问该文件，B 不可以访问该文件。
4. 进入对话页面，让 A 请求“获取这个文件”。系统按 A 的 `libraryCardId`、subject、agent profile、workspace 和 requested egress 裁决权限。
5. A 的请求通过后，只返回授权范围内的文件、派生视图或 evidence pack，并生成 `knowledgeAccessReceipt`、`loanRecord` 和 `auditId`。
6. 在同一个对话页面让 B 请求“获取这个文件”。系统按 B 的身份重新裁决，返回权限错误或按策略隐藏存在性，记录 `upstreamAccessDenied=true` 和 denied request audit。

闭环标准：

- A 可以获取，不代表 B 可以获取。
- B 不能通过换问法、换接口、请求 context bundle、请求 export、请求 distillation input 或写 memory 的方式拿到该文件。
- 对话页面必须显示可解释的权限错误，而不是假装检索失败。
- 管控台必须能看到 A 的出馆登记、B 的拒绝记录和对应 `authorizationOverlay`。

## 三层知识模型

### 1. Raw Corpus Construction

`raw-corpus-construction` 负责原始语料建构：

- 文件、邮件、附件、聊天记录、本地镜像、目录项目。
- `format-conversion-only`，不建档、不切块、不索引。
- 所有受支持原始输入格式都必须能导出为 DOCX。
- 形成 normalized documents、DOCX/YAML sidecar、sourceRange、时间线、事务链和 raw object 引用。

用户可见导出：

- `raw-corpus.format.convert`
- 参数使用 `targetFormat`

该导出由 `v0.0.1:knowledge:transformation-1` provider 执行，返回 portable export package，并在导出前写入 AgentLibrary access receipt/loan 或 denied request。

### 2. Knowledge Index Construction

`knowledge-index-construction` 负责外部知识库的治理接入、证据投影和索引扩展，不负责用内部知识库替代外部知识库。内部 `KnowledgeCore`、SQLite、缓存和文件投影只作为轻量封装、兼容层、审计辅助或本地开发后端；生产事实源优先由外部知识库 adapter 提供。

- `knowledgeBase`
- `v0.0.1:knowledge:core-1`
- external knowledge-base adapter
- `KnowledgeCore` / local store compatibility wrapper
- evidence pack
- asset protocol
- hierarchy
- embedding
- dossier
- relationship
- sourceTrace

正式检索入口必须通过 Pact 治理层访问外部知识库或本地兼容 wrapper：

- `knowledge.search`
- `knowledge.get.evidence`
- `knowledge.asset`
- `knowledge.document.structure`
- `knowledge.export.docx`
- `GET /api/knowledge/export/docx`

用户可见导出：

- `knowledge.dossier.export`
- 参数使用 `outputFormat`

`knowledge.export.docx` 是第二层外部知识库证据及治理投影的 DOCX 语料导出，不能替代 raw format convert、dossier export 或 distillation export。

`knowledge.dossier.export` 由 `v0.0.1:knowledge:transformation-1` provider 把 evidence/search/request 文档汇总成 unified dossier，再按目标格式渲染为 portable export package；导出前必须经 AgentLibrary access decision 裁决。

### 3. Knowledge Distillation

`knowledge-distillation` 负责有损知识蒸馏：

- 从第一层原始语料全文开始。
- 必要时分批、多轮、按项目或线程 digest 读取。
- 生成自包含 Markdown / DOCX / HTML / PDF 风格交付文档。
- 第二层 external evidence / governed projection 只负责校验、引用、补证和审计。
- 蒸馏输出只能作为上下文背景或交付文档，不能替代外部知识库证据或 Pact 授权投影。

用户可见导出：

- `knowledge.distillation.export`
- 参数使用 `outputFormat`

`knowledge.distillation.export` 由 `v0.0.1:knowledge:transformation-1` provider 读取蒸馏 run、candidate 或 portable document，渲染为 portable export package；导出前必须经 AgentLibrary access decision 裁决。

portable 输出协议：

- `v0.0.1:strategy:portable-knowledge-distillation-1`
- `contentBlocks`
- 可读 citations
- 可读 evidence 摘录
- 不依赖内部 `evidenceId/documentId/assetId` 才能理解正文

## Evidence Pack

智能体检索知识时，默认返回受权限裁决后的 Evidence Pack，而不是裸 chunk。Evidence Pack 既是证据包，也是权限裁决结果：它说明哪些可以看、哪些只能知道存在、哪些可以引用、哪些不能带走。

Evidence Pack 至少包含：

- `claim` 或候选结论
- `evidenceRefs`
- `citations`
- `sourceTrace`
- `sourceRange`
- `assetRefs`
- `scoreReasons`
- `confidence`
- `permissionScope`
- `accessMode`
- `checkoutPolicy`
- `withheldCounts`
- `filteredReason`
- `conflicts`
- `maintenanceHints`
- `backendTrace`

Evidence Pack 必须说明：

- 为什么这些证据被返回。
- 哪些内容因为权限被过滤。
- 当前结果是 `controlledView`、`citeOnly`、`copyToContext` 还是 `exportAllowed`。
- 是否存在冲突证据。
- 是否截断。
- 是否需要 continuation。
- 是否建议人工维护。

## 知识权限

权限不能只停留在“能不能调用 search”。知识权限必须控制：

- 能看哪些 workspace。
- 能看哪些 source。
- 能不能发现某个 source 或 document 的存在。
- 能不能看原文。
- 能不能看敏感字段。
- 能不能引用。
- 能不能复制进上下文。
- 能不能导出。
- 能不能下载或 checkout。
- 能不能触发重新索引。
- 能不能触发蒸馏。
- 能不能写反馈。
- 能不能把 memory 写入公共空间。

外部知识库检索必须在检索前应用 tenant、workspace、source-scope 和权限过滤，不能先 topK 再后过滤。

权限模式至少包括：

- `deny`：完全不可见，不能泄漏存在性。
- `discoverOnly`：只能看到存在性、类型或脱敏标题，不能读内容。
- `metadataOnly`：可看目录、来源、时间、owner、摘要级元数据。
- `controlledView`：可在 Pact 受控会话中阅览，但不能下载、导出、写 memory 或进入非授权模型上下文；它不是读取本机原路径或返回文件系统句柄。
- `citeOnly`：可引用经过脱敏的 evidence，不可输出原文全文。
- `copyToContext`：可进入本次上下文包，但不得写入长期 memory 或 artifact。
- `exportAllowed`：可进入导出文件或 artifact。
- `checkoutAllowed`：可被下载、复制到其它 workspace 或交给外部本地智能体长期持有。

这些是 AgentLibrary 的内置标准模式，用于保证不同智能体、不同 workspace 和不同接入协议之间能互相解释权限。Workspace 可以通过 policy 增加自定义 `accessMode` 或 action，但自定义项必须映射回内置出口动作，不能绕开 receipt、loan record、denied request audit 和撤销策略。

高敏感资产默认至少禁止 `exportAllowed` 和 `checkoutAllowed`，并且可能禁止 `copyToContext`；如果必须允许读取，应优先使用 `controlledView` 或受控本地模型 / 私有模型路径。

## 动态解析与预算

知识读取必须支持调用方预算：

- `contextBudget.knowledgeTokens`
- `payloadBudget.maxResponseBytes`
- `payloadBudget.maxEvidenceBytes`
- `continuationToken`
- `payload.nextContinuationToken`

动态参数文档解析策略是 `dynamic-parameter-document-parsing-policy`。

第一层必须保留完整结构副本 `structureArtifacts`：

- 标题树
- 页/幻灯片顺序
- 段落
- 列表
- 表格
- 图片
- 附件
- 邮件线程
- sourceRange
- textDigest
- asset refs

预算不足时才生成 `granularityFragments`：

- `parentArtifactId`
- `granularity`
- `fragmentRange`
- `order`
- `fragmentationTrace`
- `completeOriginalAvailable`

算法边界：

- `dispatchDynamicDocumentParsingAlgorithm(input)`
- `bindDynamicDocumentParsingInvocation(request, runtimeState)`
- `granularity.secondaryParse.enabled`

不能把固定 token/字符大小当成默认第一切分边界。

## 知识规则 DSL 原语

Pact 所有知识规则必须原生表达为 `v0.0.1:knowledge:rule-1`。邮件规则、文档解析规则、专家词汇、Golden Rules、去重策略、分类规则、权限出口规则、维护规则和蒸馏门禁都只是不同阶段的同一种规则语义，不能继续各自发明独立 JSON 结构，也不能以旧兼容 runtime、旧 API、旧 store 或旧 UI 面板继续存在。

旧规则格式只能作为平台迁移输入。迁移完成后，运行时、公开入口、控制台和后端存储只接受当前 active 版本的 `pact.knowledge-rule.vN` 规则包；不存在“旧 JSON 或旧规则协议进入运行时前动态编译”的兼容路径。

规则协议每次从 `vN` 升级到 `vN+1` 时，也必须走 Platform Managed Migration。迁移不是发布说明、临时脚本或兼容 compiler，而是 Pact Work Queue 管理的可恢复状态转换：每个 `vN+1` 规则协议版本必须为 `vN` 定义 Migration Path Config、受平台登记的 migrator artifact、queue definition、migrator identity、dry-run、checkpoint、retry、dead-letter、completion verifier、retirement gate 和 rollback / compensation 语义。若这些平台能力未实现，该规则版本升级必须标注为待补全，不能声明 cutover 完成。

Platform Managed Migration 是平台通用版本迁移能力，适用于协议、模型、store 和 projection 的递增演进。Migration Path Config 使用平台级统一 schema；AgentLibrary 不定义私有迁移框架或私有迁移 schema，只向平台注册自己的 `domainMapping`、migrator artifact、queue definition 和 verifier。

Migration Path Config 只能定义相邻版本迁移，即 `vN -> vN+1`。不允许定义 `vN -> vN+k` 的直跳迁移配置或多跳 migrator。跨多个版本升级时，Platform Managed Migration 必须按已注册链路顺序组合执行相邻迁移，并为每一跳分别记录 checkpoint、retry、fallback、completion verifier 和 retirement gate。

`vN+1` 必须声明“`vN` 记录被按 `vN+1` 投影查询”时的字段行为。新增字段必须在 Migration Path Config 中指定 default fallback、由旧字段派生、由字段重命名转移、由外部 adapter hydrate，或明确返回 `fieldUnavailable` reason；不能让调用方靠猜测、空值或运行时多版本解释分支处理。处理策略的线路、worker、stage、fallback 顺序、验证步骤和退休门禁必须通过配置文件定义，并由 Platform Managed Migration 执行。

设计参考：

- [CEL](https://cel.dev/) 适合嵌入式、可控、无副作用表达式。Pact 借鉴它的安全表达和宿主扩展边界，但不把任意表达式字符串作为唯一规则格式。
- [JsonLogic](https://jsonlogic.com/) 证明了 JSON AST 可以在前后端、存储和不同语言之间传递。Pact 采用 JSON/YAML 可序列化 AST，而不是直接采用 JsonLogic 的单键对象语法。
- [OPA/Rego](https://openpolicyagent.org/docs/policy-language) 把 `input`、`data` 和 policy decision 分离，适合治理场景。Pact 借鉴这种事实输入和规则决策分离，但避免把完整 Rego 语言暴露给普通规则维护入口。
- [DMN](https://www.omg.org/dmn/) 是业务规则和决策表的主流标准。Pact 借鉴 decision table、hit policy 和业务可读性。
- [Sigma](https://sigmahq.io/docs/basics/rules.html) 的 YAML 规则包证明元数据、检测条件、严重性、误报说明和样例是可共享规则的必要部分。Pact 借鉴其包结构和可移植性，而不是其安全日志领域词汇。

原则：

- 规则是数据，不是代码。规则可以被审计、版本化、回滚、授权、灰度和导出。
- 单一规则模型是硬边界。运行时只接受当前 active 版本的 `pact.knowledge-rule.vN` 规则包；旧邮件规则、专家词汇、Golden Rules、旧规则协议版本和规则生成结果不能再保留独立协议、面板、存储或执行器。
- 版本迁移是平台能力。任何 `pact.knowledge-rule.vN -> vN+1` 都必须通过 Pact Work Queue 记录状态、重试、进度、审计和验证，并通过 Migration Path Config 定义字段 fallback、rename、derive 和 workflow route；不能靠启动时 best-effort 转换或运行时兼容分支。
- Rule Decision 不是工作流引擎。规则只读取已投影 facts，产出 decision，并输出 typed effects；文件系统、数据库、外部知识库、模型、网络、parser、OCR、export renderer、workflow 和 queue 都只能由对应 stage executor 调用。
- 表达式无副作用。任何写入、解析、归并、拒绝、打分或路由都必须表现为 `effects`，由阶段执行器解释。
- 事实输入和规则分离。规则只读取 `input`、`facts`、`profile`、`policy` 和 `data`，不能直接读文件系统、网络、数据库或模型。
- 外部知识库优先。规则看到的是 Pact 统一投影事实，事实可以来自外部知识库、live proxy、受控缓存或本地兼容 wrapper；规则不能假设存在完整内部 canonical store。
- 投影不是替代存储。`document`、`section`、`chunk` 和 `evidence` 可以只是外部对象的授权派生视图，必须保留 `externalRef` 和可重建信息。
- 模型能力显式启用。任何 `semantic.*`、`model.*` 或 `llm.*` 操作必须声明 `modelEnabled: true`、模型 profile、预算和 fallback。
- 执行结果必须可解释。每条命中的规则必须产生 `decisionTrace`，包括匹配条件、输入片段、效果、置信度、审计 ID 和是否可复现。
- 所有规则都必须有样例或测试。没有 `tests` 的规则只能处于 `draft` 或 `pending_review`。

规范包络：

```yaml
protocolVersion: v0.0.1:knowledge:rule-1
rulesetId: mail-analysis-core
version: v0.0.1:knowledge:rule-authoring-1
status: draft | pending_review | active | retired
source: builtin | manual | agent-rule-authoring | platform-migration
sourceSystem:
  kind: externalKnowledgeBase | localCompatibilityWrapper | generated
  adapterId: qdrant-primary
  authoritative: true
scope:
  stages:
    - parser.route
    - document.normalize
    - mail.thread
  targetTypes:
    - source
    - document
    - mail.message
  mediaTypes:
    - message/rfc822
    - application/vnd.ms-outlook
  workspaces: []
hitPolicy: priority_first | collect_all | deny_overrides | review_overrides
modelPolicy:
  modelEnabled: false
metadata:
  title: Mail analysis rules
  owner: pact
  tags: [mail, parsing]
rules: []
tests: []
audit:
  requiresHumanReviewBeforePublish: true
```

通用事实模型：

| 原语 | 语义 |
| --- | --- |
| `source` | 原始来源，包括文件、目录、邮件容器、外部知识库对象、网页、附件或云盘条目。 |
| `externalRef` | 外部知识库对象引用，包括 provider、collection、object id、revision、score、metadata hash 和可撤销访问令牌引用。 |
| `adapter` | 上游知识库、解析服务、OCR、云盘或外部蒸馏服务的受控接入描述。 |
| `projection` | Pact 对外部对象生成的授权派生视图，包含 projection id、hash、ttl、permission overlay 和 sourceTrace。 |
| `cacheEntry` | 可丢弃、可重建的本地缓存项，用于性能、审计重放、导出或离线评估，不能成为 canonical 事实源。 |
| `asset` | 可读取或可渲染资产，包括原始文件、图片、附件、PDF 页面、DOCX 渲染结果。 |
| `document` | 规范化文档实体，包含 `text`、`metadata`、`structureArtifacts` 和 `sourceTrace`。 |
| `block` | 段落、标题、列表项、表格、表格单元、代码块、图片说明、邮件头等最小结构块。 |
| `section` | 由标题树、页、幻灯片、邮件消息、表格区域或语义边界形成的连续结构范围。 |
| `chunk` | 预算驱动的上下文片段，必须能回指 `section`、`block` 和 `sourceRange`。 |
| `mail.message` | 邮件消息事实，包含 sender、recipients、subject、headers、body、attachments、messageId。 |
| `mail.thread` | 由 messageId、references、subject、participants、timeWindow 等规则归并出的邮件线程。 |
| `event` | 时间线上可排序事实，例如发送、回复、审批、变更、付款、交付、异常。 |
| `transaction` | 跨邮件、文档或事件聚合出的业务事务、问题、订单、合同、账单或任务。 |
| `entity` | 人、组织、部门、项目、合同、订单、金额、地点、系统、指标等实体。 |
| `relation` | 实体、事件、文档、事务之间的可审计关系。 |
| `evidence` | 可引用证据单元，带 citation、sourceRange、permissionScope 和 confidence。 |
| `knowledge.skill` | 可复用 KnowledgeSkill 或 SkillSet 候选。 |
| `rule.package` | 规则包自身，用于 Golden Rule、发布门禁和规则质量验证。 |
| `access.request` | 检索、证据读取、导出、蒸馏、写 memory、checkout 等知识出口请求。 |

阶段枚举：

| 阶段 | 输入 | 典型输出 |
| --- | --- | --- |
| `source.discover` | source metadata | source inclusion、ignore、watch、hydrate plan |
| `source.hydrate` | source | raw asset、placeholder decision、retry policy |
| `external.query` | query、authorization context、adapter profile | upstream query plan、external results、filtered refs |
| `external.evidence.read` | externalRef、access.request | authorized projection、withheld fields、receipt |
| `projection.build` | external result、policy、budget | document、section、chunk、evidence projection |
| `parser.route` | source、mediaType、extension、metadata | parserId、mountId、ocr/multimodal profile |
| `document.parse` | asset | document、blocks、assets、warnings |
| `document.normalize` | document、blocks | canonical text、synonyms、field normalization |
| `structure.segment` | document、blocks | sections、chunks、fragment plan |
| `content.extract` | text、blocks、metadata | entities、events、relations、evidence |
| `mail.thread` | mail.message[] | mail.thread[] |
| `transaction.merge` | threads、events、entities | transaction[] |
| `taxonomy.classify` | document、section、entity、transaction | category、path、tags |
| `retrieval.index` | evidence、chunk、taxonomy | index terms、embeddings、filters |
| `retrieval.rank` | query、candidate evidence | score adjustments、reason codes |
| `evidence.gate` | claim、evidenceRefs、quality report | allow、review、reject、canary |
| `knowledge.distill` | corpus、evidence、task | distillation plan、Skill、document output |
| `governance.gate` | candidate、rule.package、access.request | deny、review、allow、skip |
| `export.render` | dossier、distillation、asset | export package、redaction trace |
| `maintenance.review` | conflict、warning、feedback | review item、gold case、rule proposal |

表达式 AST：

```yaml
match:
  op: all
  args:
    - op: eq
      args:
        - var: target.type
        - literal: mail.message
    - op: text.containsAny
      args:
        - var: target.subject
        - literal: [周报, 月报, weekly report]
```

表达式原语：

| 类别 | 操作 |
| --- | --- |
| 逻辑 | `all`、`any`、`not`、`exists`、`missing` |
| 比较 | `eq`、`neq`、`gt`、`gte`、`lt`、`lte`、`between` |
| 集合 | `in`、`contains`、`containsAny`、`containsAll`、`intersects`、`count` |
| 文本 | `text.normalize`、`text.contains`、`text.containsAny`、`text.regex`、`text.similarity`、`text.tokens` |
| 路径 | `path.exists`、`path.extensionIn`、`path.basenameMatches` |
| 时间 | `time.before`、`time.after`、`time.withinDays`、`time.gapDays` |
| 邮件 | `mail.header`、`mail.addressDomain`、`mail.sameThreadHint`、`mail.referenceOverlap` |
| 结构 | `structure.headingPath`、`structure.blockKind`、`structure.tableShape`、`structure.sourceRangeOverlap` |
| 证据 | `evidence.count`、`evidence.supportVerdict`、`evidence.conflictLevel` |
| 权限 | `access.modeAtLeast`、`access.egressAllowed`、`policy.hasScope` |
| 模型 | `semantic.supports`、`semantic.duplicates`、`model.classify`，必须显式声明 `modelEnabled`。 |

效果原语：

| effect type | 语义 |
| --- | --- |
| `route` | 选择 parser、mount、OCR、multimodal、cloud parsing 或 index profile。 |
| `adapterQuery` | 选择外部知识库 adapter、query profile、vector/text/hybrid strategy 和 upstream filter。 |
| `buildProjection` | 生成可治理的 document、section、chunk、evidence 或 asset rendition 投影。 |
| `cacheProjection` | 按 ttl、purpose 和 revocation policy 保存可重建缓存。 |
| `setField` | 设置规范字段，例如 `target.cadence`、`entity.department`。 |
| `appendTag` | 添加标签、reason code、taxonomy path 或 maintenance hint。 |
| `normalizeTerm` | 将同义词、部门别名、字段名或实体名归一到 canonical form。 |
| `extract` | 产生 entity、event、relation、attachment、citation 或 evidence。 |
| `classify` | 赋予 taxonomy category、intent、document class 或 transaction type。 |
| `split` | 产生 section、chunk、secondary fragment 或 continuation boundary。 |
| `merge` | 合并 message、thread、entity、transaction、duplicate evidence 或 skill candidate。 |
| `score` | 调整检索、分类、证据支持或重复判定得分。 |
| `gate` | 返回 `allow`、`deny`、`needs_human_review`、`auto_reject`、`skip_existing`、`canary_allowed`。 |
| `redact` | 对字段、block、evidence、export 或 model context 做脱敏。 |
| `emit` | 写入 audit、receipt、maintenance item、gold case、warning 或 protocol event。 |

规则原语：

```yaml
ruleId: mail-report-series-monthly
label: Monthly report series
priority: 80
enabled: true
target:
  stages: [document.normalize, mail.thread, taxonomy.classify]
  types: [mail.message]
match:
  op: text.containsAny
  args:
    - var: target.subject
    - literal: [月报, monthly report]
effects:
  - type: setField
    path: target.reportSeries
    value: monthly-report
  - type: classify
    categoryPath: 邮件规则/报告序列/月报
decision:
  action: allow
  confidence: 0.9
  reason: Subject matched monthly report keywords.
tests:
  - input:
      target:
        type: mail.message
        subject: 6 月客户成功月报
    expect:
      effects:
        - type: setField
          path: target.reportSeries
```

决策和冲突处理：

- `priority_first`：按 `priority` 从高到低选择第一条产生终局 `decision` 的规则。
- `collect_all`：收集所有匹配规则的 effects，适合标签、抽取和 score 累加。
- `deny_overrides`：任何 `deny`、`auto_reject` 或 `redact` 优先于 allow。
- `review_overrides`：任何高风险、低置信度或 canonical mutation 规则将结果提升为 `needs_human_review`。
- 同一个字段多个 `setField` 冲突时，执行器必须记录 `ruleConflict`，不能静默覆盖。

规则迁移和版本演进：

规则迁移归属于 Platform Managed Migration 和平台 Work Queue，不归属于规则执行器。规则执行器只执行 active 规则包；迁移 worker 负责把旧规则数据或旧协议版本转换为目标版本规则包，并把每一步写入队列状态、Operation Ledger、checkpoint 和 verifier evidence。

每次 `vN -> vN+1` 规则版本升级必须至少声明：

- `fromProtocolVersion` 和 `toProtocolVersion`。
- 相邻版本约束：`toProtocolVersion` 必须是 `fromProtocolVersion` 的下一版本，不能直跳到更高版本。
- queue definition id，例如 `agent-library.rule-migration`.
- Migration Path Config 文件，使用平台级统一 schema 声明字段 fallback、字段重命名、派生字段、外部 hydrate、workflow route、worker stage、验证和退休门禁；AgentLibrary 专属映射只能放在 `domainMapping`。
- 受平台登记的 migrator artifact，包括 migrator id、migrator version、脚本或处理器入口、配置 digest 和代码 digest。
- dry-run 输出，包括将创建、更新、retire 或拒绝的规则包数量。
- 新版本字段查询策略，确保旧版本记录被新版本 projection 查询时能默认 fallback、从旧字段迁移、通过 rename 映射、按配置 hydrate，或返回可解释的 `fieldUnavailable`。
- checkpoint 粒度，至少能按 ruleset、workspace 和 source store 恢复。
- retry / dead-letter 策略，以及人工修复入口。
- completion verifier，证明目标版本规则包可通过结构校验、样例测试、权限校验和执行器 capability allowlist。
- retirement gate，证明旧 endpoint、旧 store、旧 panel、旧 event topic、旧 runtime 分支和旧协议版本入口已删除或不可再入队。
- 多版本升级计划，必须由平台组合相邻迁移链路生成，不能由 AgentLibrary 提供直跳 migrator。

若 `agent-library.rule-migration` queue definition、平台级 Migration Path Config schema、migrator artifact registry、worker runtime handler、migration state store、completion verifier 或 retirement gate 缺失，则迁移能力标记为待补全；不能用领域私有 schema、未登记脚本、启动时转换或运行时兼容 compiler 代替。

旧规则兼容移除：

旧规则兼容入口的移除是一次性代码 cleanup，不属于 Platform Managed Migration，也不需要引入平台队列。Platform Managed Migration 只负责规则数据或规则协议版本的状态迁移；旧 API、旧 panel、旧 event topic、旧 runtime 分支和旧 compiler path 的删除可以由一次性 cleanup 脚本完成。

- `email_rules.*`、`expert_vocabulary.*`、`knowledge.golden_rules.*` 不能再作为公开 operation、RPC、HTTP API、CLI 或控制台动作暴露。
- 规则控制台不能继续挂 Email Rules、Expert Vocabulary、Golden Rules、Rule Authoring 四个并列产品面板；只允许统一 AgentLibrary Rule Package 管理面。
- event topic 必须收敛为规则包 topic；不能继续使用 `email_rules.current`、`expert_vocabulary.current` 或 `knowledge.golden_rules` 作为产品状态源。
- rule authoring 只能产出 `pact.knowledge-rule.vN` draft ruleset，不能产出 Golden Rule draft 或旧规则 JSON。
- cleanup 脚本应输出删除清单，覆盖旧 endpoint、旧 store、旧 panel、旧 event topic、旧 runtime 分支和旧规则 compiler path。
- cleanup 脚本不能成为长期兼容层，执行完成后不再保留旧规则 runtime 作为临时路径。

旧规则导入映射：

下表只定义迁移 worker 如何把旧数据改写为 `v0.0.1:knowledge:rule-1`。这些旧结构不是兼容协议，不是运行时输入，也不是控制台继续暴露的产品能力。旧 endpoint、旧 store、旧 panel、旧 event topic 和旧 runtime 分支由旧规则兼容移除 cleanup 脚本删除。

| 旧结构 | 迁移目标 |
| --- | --- |
| `email-rules.reportSeries[]` | `mail.message` / `taxonomy.classify` 规则，match subject/body keywords，effect 为 `setField(reportSeries)` 和 `classify`。 |
| `email-rules.synonymDictionary[]` | `document.normalize` / `retrieval.index` 规则，effect 为 `normalizeTerm`。 |
| `email-rules.departmentDictionary[]` | `content.extract` / `mail.thread` 规则，match name/email/domain，effect 为 `setField(entity.department)`。 |
| `email-rules.keywordStopwords[]` | tokenization profile rule，作用于 `document.normalize`、`retrieval.index` 和 `retrieval.rank`。 |
| `email-rules.transactionMergeRules` | `transaction.merge` 规则，match similarity、participant overlap、time gap，effect 为 `merge`。 |
| `expert-vocabulary.entries[]` | `taxonomy.classify` 规则，match path、keywords、domains，effect 为 `classify` 和 `appendTag`。 |
| `golden-rule-runtime.rules[]` | `governance.gate` / `evidence.gate` 规则，match quality/evidence/duplicate/canonical mutation，decision 为 `auto_reject`、`needs_human_review`、`canary_allowed` 或 `skip_existing`。 |
| `rule-authoring templates` | `rule.package` 工厂，直接输出 `v0.0.1:knowledge:rule-1` draft ruleset，再经统一规则包校验和人工确认发布。 |

外部知识库查询规则示例：

```yaml
ruleId: route-contract-query-to-external-hybrid-search
label: Contract queries use governed external hybrid search
priority: 85
target:
  stages: [external.query]
  types: [access.request]
match:
  op: all
  args:
    - { op: eq, args: [{ var: target.intent }, { literal: knowledge.search }] }
    - { op: text.containsAny, args: [{ var: target.query }, { literal: [合同, contract, 订单, order] }] }
    - { op: access.egressAllowed, args: [{ literal: evidenceRead }] }
effects:
  - type: adapterQuery
    adapterId: external-kb.primary
    strategy: hybrid
    filters:
      workspaceId: { var: policy.workspaceId }
      dataClassMax: { var: policy.maxDataClass }
    projection:
      mode: evidencePack
      includeFields: [title, snippet, citations, sourceTrace, scoreReasons]
      cachePurpose: search-result-window
      ttlSeconds: 900
decision:
  action: allow
  reason: Query should stay on the external knowledge base and return governed projections.
```

文档解析规则示例：

```yaml
ruleId: route-scanned-pdf-to-ocr
label: Scanned PDF uses OCR parser
priority: 90
target:
  stages: [parser.route]
  types: [source]
  mediaTypes: [application/pdf]
match:
  op: all
  args:
    - { op: eq, args: [{ var: target.mediaType }, { literal: application/pdf }] }
    - { op: lt, args: [{ var: target.readableTextRatio }, { literal: 0.15 }] }
effects:
  - type: route
    parserId: pact.ocr.pdf
    profile: preserve-layout
decision:
  action: allow
  reason: PDF has too little readable text and should route through OCR.
```

邮件事务归并规则示例：

```yaml
ruleId: merge-mail-thread-by-subject-and-participants
priority: 70
target:
  stages: [transaction.merge]
  types: [mail.thread]
match:
  op: all
  args:
    - { op: gte, args: [{ var: metrics.subjectSimilarity }, { literal: 0.32 }] }
    - { op: lte, args: [{ var: metrics.gapDays }, { literal: 60 }] }
effects:
  - type: merge
    targetType: transaction
    by: [normalizedSubject, participantOverlap, timeWindow]
decision:
  action: allow
```

执行器契约：

- 每个阶段只执行 `scope.stages` 匹配的规则包。
- 执行器必须先把目标对象投影为通用事实模型，再运行规则。
- 执行器不能让规则直接调用上游知识库。所有上游访问必须通过 `adapterQuery`、`external.evidence.read` 或 stage capability，并绑定当前 subject、workspace、egress、budget 和 audit context。
- 执行器不能让规则直接调用文件系统、数据库、模型、网络、parser、OCR、export renderer、workflow 或 queue；规则只能返回 typed effects，由当前 stage capability allowlist 决定是否执行。
- 执行器返回给下游的是授权投影，不是外部知识库裸结果；投影必须携带 `externalRef`、`sourceTrace`、`projectionHash` 和权限摘要。
- 本地缓存只服务性能、审计、导出或离线评估，必须有 ttl、purpose 和撤销策略；缓存命中也要重新执行权限裁决。
- 执行器返回 `decisionTrace`，包含 matched rule ids、effects、inputRefs、confidence、warnings 和 audit refs。
- 所有 `effects` 必须经过当前阶段的 capability allowlist。比如 `parser.route` 不能执行 `export.render`，`retrieval.rank` 不能写 source file。
- 规则包发布前必须通过结构校验、样例测试、权限校验和回滚计划校验。
- 运行时不得加载旧规则 JSON 或旧规则协议版本，不得保留旧规则兼容 compiler，不得让旧规则 endpoint 或旧 panel 绕过统一规则包模型。
- 规则协议升级不得引入运行时多版本解释分支；旧版本只能被迁移队列读取、转换和退休，不能作为执行器输入。
- 新版本字段查询 fallback 只能存在于 Migration Path Config 驱动的迁移读投影或 dry-run 结果中，不能进入规则执行器的正常决策路径。

## Markdown 基线

Markdown 文档进入知识库必须使用 `markdown-section-v1`：

- 标题树为第一边界。
- `sectionId`
- `sectionTitle`
- `sourceRange`
- `sourceStartLine`
- `sourceEndLine`
- 表格、代码块、列表按结构块保存。

## Dossier

同一事件、同一邮件往来、同一版本线索或同一主题材料，必须先能形成可人工阅读的 unified dossier。

第一版算法可以简单：

- 按 `capturedAt / sourceUpdatedAt / sourceCreatedAt / sourceCollectedAt` 从新到旧排序。
- 直接串联多封邮件、多次往来、多版文档或多份相关材料。
- 先保证可下载、可审计、可人工阅读。
- 之后再做摘要、去重、结构化索引、embedding 和关系抽取。

## 外部知识库适配

外部知识库是生产事实源和索引源；Pact 适配器是治理封装和能力扩展层，不是替代上游知识库的新内部知识库。公开协议仍然是 Pact 的 AgentLibrary / `v0.0.1:knowledge:core-1` 治理入口，下游不能绕过该入口直接持有上游 token 或私有对象路径。

当前实现入口：

- `server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs`

首批后端：

- `PostgreSQL + pgvector`
- `Qdrant`
- `OpenSearch`
- 可选 `Weaviate`

配置：

- `PACT_SERVER_KNOWLEDGE_BASE_MODULE`
- `PACT_EXTERNAL_KB_PROVIDER`
- `PACT_EXTERNAL_KB_URL`
- `PACT_EXTERNAL_KB_COLLECTION`
- `PACT_EXTERNAL_KB_CONNECTION_STRING`

生产一致性必须覆盖：

```text
external register / governed ingest
  -> external search through Pact adapter
  -> evidence read
  -> asset read
  -> export DOCX
  -> delete/tombstone
  -> sync/reindex
  -> search no longer returns deleted objects
```

## 知识维护闭环

知识维护不应主要依靠后台人工整理，而应来自使用过程：

- 检索冲突
- 用户指出回答错误
- evidence 缺失
- source 过期
- 文档解析质量低
- 同一实体被拆成多个名字
- 蒸馏结果过期
- 某个结论没有足够证据

这些都应生成 maintenance issue，进入 review / repair / reindex / distill / archive 流程。

## 外部知识蒸馏验收流程

知识蒸馏唯一维护面是 `external.knowledge.distillation`。内部 `knowledge.distillation.*` 模块只保留迁移报文，不再承接算法、解析或导出增强。

`external.knowledge.distillation` 的所有 run、evidence、artifact、下载、导出、compare、delete 和 archive 操作都必须先进入外部服务上游网关切面。网关切面统一裁决 subject、tenant、workspace、source scope、artifact export、egress 和 audit receipt；兼容工作台 `knowledge.distillation.workbench.*` 只能返回迁移报文，不能绕过网关继续访问旧内部产物或旧下载路径。

参考框架：

- RAGFlow
- MinerU
- Docling
- LlamaIndex
- Marker
- GraphRAG
- Haystack
- Unstructured

验收重点：

- 外部知识蒸馏服务部署门禁：required-auth、业务 API bearer gate、非 root 容器、Tika checksum、healthcheck 和密钥外置。
- route-first 文件分流。
- 大文件 streaming/windowing。
- 分类蒸馏与 project convergence。
- `human-agent-response-profile-separation.v1`。
- `office-document-professional-adaptation.v1`。
- Graph evidence、reference gap report 和 external service API 注册。

验证入口：

```bash
npm run server:verify:knowledge-architecture-governance
npm run server:verify:knowledge-industrial-distillation
npm run server:verify:external-knowledge-distillation-service-gates
npm run server:verify:external-knowledge-distillation
npm run server:verify:external-knowledge-distillation-container
npm run server:verify:external-knowledge-distillation-references
```

`server:verify:external-knowledge-distillation-service-gates` 是前置门禁。未通过时，不继续推进外部知识蒸馏的新解析器、格式路由、导出或模型蒸馏能力。

### 外部知识蒸馏当前状态（2026-06-04）

- `npm run server:verify:external-knowledge-distillation-service-gates` 通过。
- `npm run server:verify:external-knowledge-distillation` 通过。
- `npm run server:verify:external-service-api-registration` 通过。
- `npm run server:verify:knowledge-industrial-distillation` 通过。
- `sharedspace.drive.*` 兼容 shim 仍保留 `deprecated` + `compatibility-shim-only` 生命周期，但不再以平台核心方式出现在 Tool Management 中；相关能力已收敛到上游网关和外部服务切面。

## 与工作空间的关系

知识治理服务于 workspace state：

- Evidence 是公共空间可引用事实。
- Distillation 是上下文背景和交付物。
- Memory 是运行时辅助，不等于事实。
- Decision 是经过确认的团队事实。
- Maintenance issue 是知识演化入口。

智能体可以加载 knowledge context，但不能直接污染 canonical knowledge。
