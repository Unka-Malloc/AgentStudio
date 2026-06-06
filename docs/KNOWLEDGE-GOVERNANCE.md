# AgentLibrary Governance

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: AgentLibrary Governance.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 Pact 的 `AgentLibrary / 图书馆` 治理边界。图书馆不是资产后台，也不是智能体私有记忆；它是公共工作空间可安全引用、可共享、可借阅、可登记、可管控的 evidence runtime。

## 目录 / Table of Contents

- [定位](#定位)
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
- [Markdown 基线](#markdown-基线)
- [Dossier](#dossier)
- [外部知识库适配](#外部知识库适配)
- [知识维护闭环](#知识维护闭环)
- [工业级蒸馏验收流程](#工业级蒸馏验收流程)
- [与工作空间的关系](#与工作空间的关系)

## 定位

> Pact 把资产型知识库转化为 AgentLibrary：面向智能体的受控图书馆。

AgentLibrary 的核心卖点是中间层治理：

- 上游知识库太粗，AgentLibrary 做信息切分、权限精加工、脱敏、借阅登记和再授权。
- 下游本地智能体太细，AgentLibrary 给它们提供共享的知识、Skills、专家意见、黄金规则和可复用贡献入口。
- 智能体不直接面对最上游知识库，也不只在自己的本地小空间里互相复制资料；它们通过 AgentLibrary 使用被治理过的公共资产。

命名边界：

- `AgentLibrary / 图书馆` 是产品概念和用户心智。
- `knowledgeBase` / `pact.knowledge.v1` 是当前内部 mount 和兼容协议名。
- 新设计、控制台文案和后续能力命名应优先使用 AgentLibrary；底层协议可在兼容期继续保留 knowledge 命名。

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

贡献型知识仍然要被治理：

- `goldenRule` 可以作为高优先级工作约束，但必须有来源、适用范围和复核周期。
- `expertOpinion` 可以作为人工判断，但必须与 evidence / decision 分层，不能自动覆盖事实。
- `skill` 可以被其它智能体复用，但必须声明权限、风险、版本、输入输出和可撤销授权。
- `script` 和 `tool` 必须进入 Tool Management / Policy 裁决，不能因为贡献者排名高就自动执行。
- `knowledge` 贡献可以进入 AgentLibrary，但是否成为 canonical evidence 仍需 review。

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

### 外部知识库再授权

Pact 的知识空间不是外部知识库的同型复制，也不是外部知识库的裸代理。外部知识库可以作为上游资产源进入 Pact，但下游智能体看到的只能是 Pact 重新治理后的派生知识空间。

上游知识库的信息和资源权限再分配是 AgentLibrary 的核心功能。AgentLibrary 不只转发上游检索结果，而是把上游知识资源重新切分为 workspace、source group、document、section、block、field、asset rendition、evidence pack 等下游可治理单元，并为每个 subject / workspace / agent profile 生成独立的 `authorizationOverlay`。

流程必须是：

```text
upstream knowledge base
  -> upstream connector / adapter
  -> Pact on-demand fetching / live proxying
  -> information slicing
  -> authorizationOverlay
  -> derivedKnowledgeSpace
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

下游智能体不需要、也不应该直接访问最上游知识库。它们不能持有上游 API token，不能知道上游私有对象路径，不能绕过 Pact 的 `authorizationOverlay` 直接查上游索引。这样上游知识库仍然是资产源，Pact 则是面向 workspace 的再切分、再授权和证据治理层。

live proxy 允许用于受控 `controlledView` 和即时查看，但它不是 Pact evidence 入库。凡是要进入 Pact evidence、context bundle、receipt、cache、export、artifact 或可复用知识资产的内容，必须把真实返回内容或授权派生视图写入 Pact 内容存储，并记录上游 result id、source metadata hash 和 content root。

### 演示场景：上游知识库 A/B 权限再授权

目标：证明 Pact 可以把上游知识库里的同一份文件重新授权给不同下游主体，并且对话页、检索、上下文编译和导出都执行同一个权限裁决。

流程：

1. Pact 通过上游知识库 adapter 获取某个文件，只把上游对象登记为 `upstreamKnowledgeRef`，不把上游 token、对象路径、collection id 或裸 source id 暴露给下游。
2. Pact 对文件执行信息切分，生成下游可治理的 document、section、block、field、asset rendition 和 evidence pack，并写入 `derivedKnowledgeSpace`。
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

该导出由 `pact.knowledge-transformation.v1` provider 执行，返回 portable export package，并在导出前写入 AgentLibrary access receipt/loan 或 denied request。

### 2. Knowledge Index Construction

`knowledge-index-construction` 负责 canonical evidence/index：

- `knowledgeBase`
- `pact.knowledge.v1`
- `KnowledgeCore`
- external knowledge-base adapter
- evidence pack
- asset protocol
- hierarchy
- embedding
- dossier
- relationship
- sourceTrace

正式检索入口：

- `knowledge.search`
- `knowledge.get.evidence`
- `knowledge.asset`
- `knowledge.document.structure`
- `knowledge.export.docx`
- `GET /api/knowledge/export/docx`

用户可见导出：

- `knowledge.dossier.export`
- 参数使用 `outputFormat`

`knowledge.export.docx` 是第二层 canonical knowledge 的 DOCX 语料导出，不能替代 raw format convert、dossier export 或 distillation export。

`knowledge.dossier.export` 由 `pact.knowledge-transformation.v1` provider 把 evidence/search/request 文档汇总成 unified dossier，再按目标格式渲染为 portable export package；导出前必须经 AgentLibrary access decision 裁决。

### 3. Knowledge Distillation

`knowledge-distillation` 负责有损知识蒸馏：

- 从第一层原始语料全文开始。
- 必要时分批、多轮、按项目或线程 digest 读取。
- 生成自包含 Markdown / DOCX / HTML / PDF 风格交付文档。
- 第二层 evidence 只负责校验、引用、补证和审计。
- 蒸馏输出只能作为上下文背景或交付文档，不能替代 canonical evidence。

用户可见导出：

- `knowledge.distillation.export`
- 参数使用 `outputFormat`

`knowledge.distillation.export` 由 `pact.knowledge-transformation.v1` provider 读取蒸馏 run、candidate 或 portable document，渲染为 portable export package；导出前必须经 AgentLibrary access decision 裁决。

portable 输出协议：

- `portable.knowledge-distillation.v1`
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

外部知识库只是第二层适配器，不是公开协议。

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
ingest
  -> search
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
