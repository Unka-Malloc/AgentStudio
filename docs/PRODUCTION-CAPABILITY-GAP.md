# Pact 生产级能力差距清单

审计日期：2026-05-20（本地环境）。本文用于决策，不用于宣传。

## 目录 / Table of Contents

- [总结](#总结)
- [对标依据](#对标依据)
- [当前已有能力](#当前已有能力)
- [优先级定义](#优先级定义)
- [P0 生产阻塞项](#p0-生产阻塞项)
  - [P0-00 智能体知识源头权限门禁缺失](#p0-00-智能体知识源头权限门禁缺失)
  - [P0-00-02 终端贡献型资产治理缺失](#p0-00-02-终端贡献型资产治理缺失)
  - [P0-01 生产级验收门禁缺失](#p0-01-生产级验收门禁缺失)
  - [P0-02 内部 Trace 与可观测性不足](#p0-02-内部-trace-与可观测性不足)
  - [P0-03 长任务缺少 durable execution 级别保证](#p0-03-长任务缺少-durable-execution-级别保证)
  - [P0-04 外部检索引擎后端一致性仍不够硬](#p0-04-外部检索引擎后端一致性仍不够硬)
  - [P0-05 文档解析质量没有真实业务基准](#p0-05-文档解析质量没有真实业务基准)
  - [P0-06 评估体系没有覆盖 RAG、蒸馏、Agent 和工具调用全链路](#p0-06-评估体系没有覆盖-rag蒸馏agent-和工具调用全链路)
  - [P0-07 安全、租户、权限和密钥边界未达到生产审计标准](#p0-07-安全租户权限和密钥边界未达到生产审计标准)
  - [P0-08 备份、恢复、迁移和升级策略不足](#p0-08-备份恢复迁移和升级策略不足)
- [P1 试点阻塞项](#p1-试点阻塞项)
  - [P1-01 会话线程还缺 merge、compare 和冲突治理](#p1-01-会话线程还缺-mergecompare-和冲突治理)
  - [P1-02 前端治理界面还不够"生产操作台"](#p1-02-前端治理界面还不够生产操作台)
  - [P1-03 模型网关缺少生产成本与降级策略](#p1-03-模型网关缺少生产成本与降级策略)
  - [P1-04 外部工具与技能缺少生命周期治理](#p1-04-外部工具与技能缺少生命周期治理)
  - [P1-05 数据连接器和本地镜像同步还不完整](#p1-05-数据连接器和本地镜像同步还不完整)
  - [P1-06 性能和容量基准不足](#p1-06-性能和容量基准不足)
- [P2 规模化缺口](#p2-规模化缺口)
  - [P2-01 知识蒸馏需要从"评估脚本"升级为"持续优化系统"](#p2-01-知识蒸馏需要从评估脚本升级为持续优化系统)
  - [P2-02 插件/模块生态还缺 SDK 和模板](#p2-02-插件模块生态还缺-sdk-和模板)
  - [P2-03 工作空间共享还缺组织级治理](#p2-03-工作空间共享还缺组织级治理)
  - [P2-04 多模态资产治理不足](#p2-04-多模态资产治理不足)
- [P3 竞争力增强项](#p3-竞争力增强项)
  - [P3-01 提供资产价值管理驾驶舱和 executive report](#p3-01-提供资产价值管理驾驶舱和-executive-report)
  - [P3-02 提供架构图和运行状态联动](#p3-02-提供架构图和运行状态联动)
  - [P3-03 提供样例业务包](#p3-03-提供样例业务包)
- [建议决策顺序](#建议决策顺序)
- [当前上生产判断](#当前上生产判断)

## 总结

当前项目已经形成了清晰的目标架构：管理层、服务层、应用层、基建层；应用层拆为知识转化、智能体、通用工具与技能；知识转化拆为原始语料、知识索引、知识蒸馏；智能体以会话线程、上下文、工作空间和记忆切换工作状态。项目也已经有不少验证脚本、协议文档和本地默认实现。

最新定位已经收敛为中间狭窄地带：

- 上游知识库太粗，AgentLibrary 必须提供权限精加工、信息切分、再授权、借阅登记和拒绝带走能力。
- 下游本地智能体太细，Workspace Asset Governance 必须提供共享工作空间、终端贡献、排行榜、授权复用和撤销能力。
- 框架核心卖点不是替代上游知识库或替代下游智能体，而是在两者中间把“谁能看、谁能借、谁能贡献、谁能复用、怎么撤回”做成可验证系统。

对外口径固定为“两个问题，一个能力，三个兼容”：

- 两个问题：知识库缺少面向智能体的权限管控；本地智能体相对独立，难以协同。
- 一个能力：工作空间管理，覆盖权限控制、统一 Checkpoint Tree、Operation Ledger、回溯、恢复、审计和资产贡献统计报表。
- 三个兼容：智能体兼容、信息源兼容、工作空间环境兼容。

生产验收必须证明：不论接入的是哪种智能体、哪种信息源、哪种工作空间运行环境，只要通过 Pact MCP service / Workspace API 和 Pact 管理软件进入公共空间，就会被统一权限管控、统一快照、统一审计和统一恢复。

但如果按“真实业务场景、可上生产、可向管理层汇报”的标准判断，当前仍不能视为生产就绪。它更接近“架构基线明确、局部闭环可验证的工程原型”。最大差距不是某个按钮或某个算法，而是缺少一套能证明系统在真实数据、真实故障、真实权限、真实成本和真实外部依赖下仍然可靠的生产级框架能力。

一句话结论：

- 可以继续作为内部工程基线和真实样例试点。
- 不建议直接承诺生产可用。
- P0 未关闭前，不建议对外宣称“工业领先”或“正式生产可用”。

## 2026-05-25 协议化重构校准

本文的“差距”口径只用于生产级能力判断，不再用于表示架构分层是否完成。协议化重构的架构节点状态以 `docs/SUBSYSTEM-REFACTOR-CHECKLIST.md` 为准；截至 2026-05-25，管理层、服务层、应用层六个模块、基建层五个模块和启动装配边界均已有 provider / operation / domain service 边界和 `server:verify:*` 门禁。

后续生产缺口使用四级完成度描述：

- `verified-complete`：已有实现、协议边界和验证脚本，且纳入全量 `npm run server:verify`。
- `implemented-needs-production-evidence`：已有实现或局部闭环，但还缺真实数据、真实外部依赖、容量、安全或运维证据。
- `planned-contract`：已有协议或设计合同，但实现仍需补齐。
- `not-started`：尚未形成稳定协议或实现入口。

因此，本文中已完成协议化的能力不再列为“未实现”；若仍保留在 P0/P1/P2/P3 中，是因为它们还需要生产证据、真实环境覆盖或规模化治理，而不是因为子系统之间仍直接耦合。

## 对标依据

本文用下列公开成熟框架和官方文档作为参照，而不是只按项目内部想象判断：

- LangGraph：用 checkpoint 支持 replay、fork 和原历史保留；fork 不回滚原 thread，而是从指定 checkpoint 产生新分支。参考：<https://docs.langchain.com/oss/python/langgraph/use-time-travel>
- LlamaIndex：把 ingestion 做成 transformation pipeline，支持缓存、远端 vector store、docstore 和基于 document hash 的去重/重处理。参考：<https://developers.llamaindex.ai/python/framework/module_guides/loading/ingestion_pipeline/>
- Haystack：用可组合、可分支、可序列化的 pipeline 表达索引、查询、预处理、agent 等多类流程。参考：<https://docs.haystack.deepset.ai/docs/pipelines>
- Dify：知识库检索测试和生产检索共享同一 API endpoint，并记录测试与生产检索事件。参考：<https://docs.dify.ai/en/use-dify/knowledge/test-retrieval>
- OpenTelemetry：作为 Pact 内部 Trace 的可选导出目标，提供 vendor/tool agnostic traces、metrics、logs 对接能力。参考：<https://opentelemetry.io/docs/what-is-opentelemetry/>
- LlamaIndex Observability：RAG、Agent、LLM 等事件可导出为 OpenTelemetry trace，说明内部事件模型可以映射到外部观测协议。参考：<https://developers.llamaindex.ai/python/framework/module_guides/observability/>
- Arize Phoenix：评估不仅给分，还记录输入、judge prompt、模型推理、最终分数和耗时，支持生产流量上的持续评估思路。参考：<https://arize.com/docs/phoenix/evaluation/llm-evals>
- Temporal：长任务用 durable workflow / activity / retry / task queue / signal / timer 保存执行状态并恢复，而不是只靠进程内 job。参考：<https://temporal.io/>
- Ragas：RAG 和 Agent 评估指标覆盖 context precision/recall、faithfulness、response relevancy、tool call accuracy、agent goal accuracy 等。参考：<https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/>
- OpenSearch：生产 hybrid search 通过 search pipeline 对 keyword 和 semantic score 做归一化/融合。参考：<https://docs.opensearch.org/docs/3.0/vector-search/ai-search/hybrid-search/index/>
- Qdrant：payload index / strict mode / filter / rate limit 等能力用于避免低效检索和过载。参考：<https://qdrant.tech/documentation/overview/>

## 当前已有能力

这些能力可以作为继续推进的基础：

- 总架构基线已收敛到 `docs/Architecture.md`。
- 公共工作空间资产治理已落到 `docs/WORKSPACE-ASSET-GOVERNANCE.md`。
- 三层知识管理边界已收敛到 `docs/KNOWLEDGE-GOVERNANCE.md` 和 `docs/PROTOCOLS.md`。
- 设计与实现偏差审计已并入本文，后续不再维护独立审计设计文档。
- 会话线程已作为工作状态入口：`agent_sessions.list/get/context/events.append/fork`。
- `agent-workspace` 已提供团队共享工作空间、上下文解析、context bundle、会话分叉。
- `tool-management-core` 已有 catalog、grant、policy、audit 的基础形态。
- `external-knowledge-base` 已有 pgvector、Qdrant、OpenSearch 方向的实现入口。
- 已有一批本地 verify 脚本，例如 `server:verify:agent-workspace`、`server:verify:tool-management`、`server:verify:knowledge-architecture-governance`、`server:verify:knowledge-industrial-distillation`。

这些是必要基础，但不是生产充分条件。

## 优先级定义

- P0：不补齐就不能对外承诺生产可用，属于汇报和上线阻塞项。
- P1：可以进入受控试点，但会明显影响业务落地、运维效率或客户信任。
- P2：规模化、生态化、跨团队复用需要补齐。
- P3：增强体验和竞争力，不阻塞早期生产门禁。

## P0 生产阻塞项

### P0-00 智能体知识源头权限门禁缺失

当前状态：传统知识库倾向于把已经存进去的内容按召回和排序结果提供给智能体，重点放在优化切分、召回、排序和摘要。Pact 的路线不同：知识能力应命名和治理为 `AgentLibrary / 图书馆`，必须从 source / asset 入库开始治理智能体是否能发现、读取、引用、复制进上下文、导出、下载或写入长期 memory。当前代码已具备 `pact.knowledge-access.v1`、`pact.agent-library.v1`、accessMode / checkoutPolicy / loanRecord 裁决实现，并已通过 specialized console operation executor 绑定 `knowledge.access.*` 协议入口；v0.0.1 已把 Dify/RAGFlow contract-mode `KnowledgeBasePort` 的检索、evidence 回读和 export gate 接入同一裁决链。剩余差距是把真实上游凭据环境、上下文编译、蒸馏、memory 写入和更多外部 adapter 的所有出口继续强制接入该裁决，而不是只在验证脚本和控制台入口中证明能力存在。

为什么重要：随着大模型基座智力、上下文窗口和注意力能力提升，知识库不应主要承担“有限信息投喂器”的角色，而应成为一栋权限严密、分类清楚、索引完备的团队知识图书馆。智能体有门禁卡才能进入，有楼层权限才能访问 source group，有图书权限才能读具体内容，有借阅权限才能带走。高敏感资产可以只允许受控读取，不允许导出、下载、写 artifact、写 memory 或送入未授权模型上下文。

外部知识库接入也必须受这条原则约束。Pact 不做外部知识库的同型复制或裸代理，而是在中间形成 `derivedKnowledgeSpace` 和 `authorizationOverlay`：上游知识库里存在的内容，不代表下游某个人、某个 workspace 或某个智能体可见。某些智能体应永远访问不到最上游知识库，只能访问 Pact 重新切分、脱敏、授权后的派生 evidence 或只读阅览会话。

上游知识库的信息和资源权限再分配是 AgentLibrary 的核心功能，不是外部知识库 adapter 的附属能力。生产实现必须证明同一份上游资源可以被拆成不同下游视图，并对不同 subject / workspace / agent profile 应用不同发现、阅读、引用、上下文注入、导出和借阅策略。

能否补全：可以，是优先级最高的生产安全能力。

怎么补：

- 继续完善 `pact.knowledge-access.v1` 和 `pact.agent-library.v1` 在所有知识出口的强制接入。
- 增加 `libraryCardId`、`knowledgeAccessReceipt`、`loanRecord`、`requestedEgress`、`canRetain`、`canShare`、`revocationPolicy`。
- 定义外部知识库再授权模型：`upstreamKnowledgeRef`、`upstreamPolicyRef`、`derivedKnowledgeSpace`、`authorizationOverlay`、`upstreamAccessDenied`。
- 支持同一 `upstreamKnowledgeRef` 映射多个 `derivedViewRef`，并按 subject / workspace / agent profile 分配不同权限。
- 资产入库时写入 `dataClass`、`sensitivity`、`workspaceScope`、`sourceScope`、`owner`、`allowedSubjects`、`allowedAgentProfiles`、`allowedActions`、`checkoutPolicy`。
- 权限颗粒度覆盖 source、document、section、block、field、table cell、image、attachment、evidence pack、asset rendition。
- 检索、上下文编译、evidence 回读、导出、蒸馏、memory 写入和 artifact 生成都必须先做权限裁决。
- 支持 `deny`、`discoverOnly`、`metadataOnly`、`controlledView`、`citeOnly`、`copyToContext`、`exportAllowed`、`checkoutAllowed`。
- 没有权限的内容不能进入 retrieval candidate、rerank hint、hidden context、distillation input、memory summary 或评估样本。
- 下游智能体不能持有上游知识库 token，不能看到上游私有对象路径，不能绕过 Pact 直接查上游索引。
- 所有出馆信息必须产生 receipt；所有允许保留、导出、复制或跨 workspace 使用的信息必须产生 loan record；所有拒绝带走的请求必须进入 denied request audit。
- 建立上游知识库 A/B 权限再授权演示：Pact 从上游知识库获取文件后在本地配置权限，管控台设置 A 可以访问、B 不可以访问；对话页面中 A 能获取该文件并产生 receipt / loan record，B 返回权限错误并产生 denied request audit。

当前实现入口：

- `server/platform/specialized/knowledge/agent-library/access-policy.mjs` 实现 `pact.knowledge-access.v1` 和 `pact.agent-library.v1` 的源头裁决、标准 `accessMode`、`requestedEgress`、`authorizationOverlay`、`knowledgeAccessReceipt`、`loanRecord` 和 denied request audit；`server/platform/specialized/console/console-domain-operation-executor.mjs` 负责控制台协议入口绑定，`common/console` 不再直接持有 access policy。
- `server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs` 实现 v0.0.1 Dify/RAGFlow `pact.knowledge-backend-port.v1` contract-mode：运行配置写入 `ServerConfig.getDataDir()/knowledge/knowledge-backends.json`，只保存 `secretRef` / `endpointRef`；safe discovery 不返回正文、snippet、上游裸 ID 或私有路径；授权 evidence 读取写 receipt/loan record，拒绝读取和拒绝导出写 denied request audit。缺少真实 Dify/RAGFlow 凭据时只能标记 `contractVerified`。
- `server/platform/specialized/agent/cloud-drive-port/index.mjs` 实现 v0.0.1 `pact.cloud-drive-port.v1`：运行连接配置写入 `ServerConfig.getDataDir()/agent-workspaces/cloud-drive-connections.json`，ledger 写入 `agent-workspaces/cloud-drive-ledger.json`；iCloud local adapter 对 `.pact-data/<client>` 默认空间实读实写，对 `.pact-data/public` 和高级暴露目录默认只读，公开响应不暴露本机绝对路径；OneDrive、Google Drive、Dropbox 无真实 OAuth 凭据时只能标记 `contractVerified`，并通过 transfer receipt、access receipt、checkpoint 和 operation audit 证明合同链路。
- `npm run server:verify:agent-library-access` 验证 A/B 再授权：A 获取授权范围并产生 receipt / loan record，B 在所有出口 `searchResult`、`evidenceRead`、`contextBundle`、`artifactWrite`、`exportFile`、`distillationInput`、`distillationOutput`、`memoryWrite`、`toolCall`、`evaluationSample` 都被同一套裁决拒绝。
- `npm run server:verify:production-readiness` 已把该能力纳入 P0 门禁。

补全效果：Pact 从“知识库能查什么”升级为“智能体在团队知识大楼里能进哪一层、能读哪本书、能不能借走”。同时，外部知识库成为上游资产源，Pact 成为下游工作空间的再授权与资产治理层。这是本项目区别于普通知识库和普通 Agent 工具接入的第一安全边界。

### P0-00-02 终端贡献型资产治理缺失

当前状态：信息源不只来自上游知识库，很多高价值资产来自终端贡献：人类或本地智能体过滤、验证、精加工后的知识、Skills、工具、脚本、文件、黄金规则和专家意见。当前系统已具备 `pact.workspace-contribution.v1` 的持久贡献注册表、固定 workspace asset bucket、贡献状态机、发布审核流、跨 workspace adoption、贡献排行榜、统计面板、贡献授权和 usage / loan / audit 记录，并已通过 specialized console operation executor 绑定 `workspace.contribution.*` 与 `workspace.skill.*` 协议入口。剩余生产硬化方向是把更多真实客户端、真实组织策略和真实资产规模纳入持续门禁，而不是停留在控制台 runtime 内存注册表。

为什么重要：人过滤和精加工的信息往往最有效。过去如果只用知识库视角看这些材料，会把专家意见、黄金规则、Skills、脚本、文件和工具都压成“知识条目”，失去可操作性。AgentLibrary 应允许下游智能体向上提交资产，并让贡献资产在公共工作空间中被发现、授权、复用和审计。

能否补全：可以，是 AgentLibrary 的第二个核心生产能力。

怎么补：

- 继续完善 `pact.workspace-contribution.v1` 的持久化资产、跨 workspace 复用和发布审核闭环。
- 每个 workspace 固定提供 `skills/`、`tools/`、`scripts/`、`files/`、`knowledge/`、`rules/`、`expert-opinions/` 存放位置。
- 允许下游智能体选择一个或多个可访问 workspace 上传贡献。
- 贡献类型覆盖 `knowledge`、`skill`、`tool`、`script`、`file`、`goldenRule`、`expertOpinion`。
- 建立贡献状态机：submitted -> scanned -> reviewed -> published / rejected / needs_changes -> adopted -> deprecated / revoked。内容到达服务器并完成最小留档后才可进入 scan/review，审核和权限确认后才是 published。
- 建立排行榜和统计面板：贡献次数、审核通过次数、使用次数、跨 workspace 采用次数、Skills / 工具 / 脚本调用次数、授权请求和授权通过次数、复用成功率、回滚次数、维护新鲜度。
- 建立资产贡献统计报表：按 workspace、贡献者、资产类型、时间窗口、使用动作、授权流、风险和维护状态汇总，让管理者看到公共空间的资产沉淀质量和复用价值。
- 贡献资产被下载、安装、复制、执行、写入上下文或跨 workspace 使用时，必须生成 grant、loan record、usage event 和 audit。
- 其它智能体或人可以请求贡献者、workspace owner 或资产管理员授权，让贡献资产给其它智能体下载或安装。
- 建立 OpenClaw 文档互通演示：两个 OpenClaw 都通过 Pact MCP service 接入同一 workspace，A 上传本地文档，B 在授权范围内查询并下载，证明文档互通发生在公共工作空间而不是 agent 直连。
- 建立 Skill 贡献排行榜演示：A 上传默认公开的 Skill，B 在面板或 MCP skill list 中发现、下载并使用，系统按 `rankScoreV0 = usageCount * successRate + uniqueWorkspaceAdoptions - rollbackCount` 刷新贡献值，`acceptedCount` 只作为报表维度。

当前实现入口：

- `server/platform/specialized/agent/workspace-contribution/index.mjs` 实现 `pact.workspace-contribution.v1` 的持久贡献注册表、固定 workspace asset bucket 物化、submitted -> scanned -> reviewed -> preview -> published/adopted/revoked 发布审核状态机、贡献授权、loan record、usage event、audit event、排行榜和资产贡献统计报表；`server/platform/specialized/console/console-domain-operation-executor.mjs` 负责控制台协议入口绑定，`common/console` 不再直接持有 contribution registry。
- `npm run server:verify:workspace-contribution-governance` 验证 Skill 贡献从 submitted -> scanned -> reviewed -> preview -> published，随后授权 B 下载/安装/执行，跨 workspace adoption 生成目标 workspace asset，重载 registry 后仍可读取持久资产记录，并按 `rankScoreV0 = usageCount * successRate + uniqueWorkspaceAdoptions - rollbackCount` 生成排行榜；`acceptedCount` 只作为报表维度。
- `npm run server:verify:production-readiness` 已把该能力纳入 P0 门禁。

补全效果：Pact 不再只从上游知识库拿信息，而是形成“终端贡献 -> 公共空间资产 -> 排行榜发现 -> 授权复用 -> 审计和撤销”的资产贡献闭环。

### P0-01 生产级验收门禁缺失

当前差距：项目有很多 verify 脚本，但还没有统一的 release gate，把架构、功能、数据质量、权限、性能、兼容、部署、备份、回滚、可观测、成本和安全串成一个可汇报的生产验收报告。

对标依据：Phoenix 把 evaluation 用于捕获回归、比较模型或 prompt 变化并建立发布信心；Dify 把测试检索和生产检索放到同一记录体系中。成熟框架不会只证明“脚本能跑”，而是证明“变化不会悄悄降低质量”。

为什么缺：当前门禁是按功能散落的，缺少“生产发布报告”的聚合层，也缺少 P0/P1 的强制阻断策略。

能否补全：可以。

怎么补：

- 增加 `npm run server:verify:production-readiness`。
- 输出 `reports/production-readiness/<run-id>/report.md` 和 `report.json`。
- 汇总运行：架构门禁、文档解析真实样例、外部知识库一致性、RAG 评估、蒸馏评估、会话线程、工具权限、备份恢复、升级迁移、端到端 UI smoke、离线包 license gate。
- 每个 gate 输出：状态、证据文件、阻塞级别、负责人、下一步、`verificationMode=verified|mocked`。mocked 只能证明接口合同，不计入真实完成率。

当前实现入口：

- `server/scripts/production-readiness-gate.mjs` 聚合上述门禁并写出 Markdown / JSON 报告。
- `npm run server:verify:production-readiness` 作为 release gate；存在 P0 未通过或必需覆盖缺失时，报告状态为 `blocked`，默认以非零退出码阻断发布。
- 该 gate 只能证明被覆盖项，不会把单点 verify 的通过误判为整体生产就绪。
- `server/scripts/verify-v001.mjs` 作为 v0.0.1 单机 release 收口门禁，聚合 Phase 0-4 verifier、迁移保留报告、MCP/Tool/Policy 注册和 renderer raw build，并输出 `reports/v001-readiness/<run-id>/report.{json,md}`。
- v0.0.1 readiness 报告把 GitHub、Gerrit、Dify、RAGFlow、OneDrive、Google Drive 和 Dropbox 缺少真实凭据的状态标为 `contractVerified`；这只证明接口合同，不计为真实外部 E2E 或 production ready。

补全效果：项目从“功能验证”升级为“可汇报验收”；每次决策可以基于同一份报告，而不是临时问当前能不能用。

### P0-02 内部 Trace 与可观测性不足

当前差距：项目有日志、审计和若干状态接口，但还没有统一的 `pact.trace.v1` 内部 Trace schema；模型调用、检索、文档解析、外部知识库、工具调用、会话分叉、队列任务之间无法用同一个 trace 串起来。OpenTelemetry 应作为导出映射，不是内部事实源。

对标依据：OpenTelemetry 是 vendor/tool agnostic 的 traces、metrics、logs 标准；LlamaIndex 已把 LLM、Agent、RAG pipeline 事件导出为 OpenTelemetry；Phoenix 的 evaluator traces 会记录输入、judge prompt、推理、分数和耗时。

为什么缺：当前系统按模块记录状态，缺少跨模块 `traceId/spanId`、成本、token、模型、检索命中、证据覆盖、工具调用和 artifact 之间的标准关联。

能否补全：可以。

怎么补：

- 定义 `pact.trace.v1`：trace/span 命名、属性、敏感字段脱敏、采样、成本、token、权限裁决、asset/evidence/checkpoint 引用。
- 定义 `pact.trace.v1 -> OpenTelemetry` 映射：内部 Trace 是事实源，OTel/OTLP 是可选导出目标。
- 为这些路径打 span：upload、parse、normalize、ingest、search、evidence、distill、agent gateway、tool execution、session fork、workspace context load。
- 接入可选 OTLP exporter，默认本地可关闭，生产可接 Jaeger、Tempo、Phoenix 或其它 OTel backend。
- 服务端提供 trace drill-down 数据：一个回答或操作可以追溯文档、检索、证据、模型、工具、成本。

当前实现入口：

- `server/platform/common/observability/trace-context.mjs` 提供 `traceId/spanId/parentSpanId/operationId/actor` 上下文，并由 operation dispatcher、HTTP 请求和审计链路继承。
- `server/platform/common/observability/runtime-logger.mjs` 提供 JSONL 运行日志、trace 字段、敏感字段脱敏、路径脱敏和日志保留策略。
- `/api/observability/traces/:traceId`、`observability.trace.get` 和 `auth audit export --trace-id` 提供基于 operation audit 与 authorization decisions 的 trace drill-down；导出内容默认只包含脱敏输入、输出摘要和引用字段。
- `server/scripts/verify-trace-context.mjs` 验证 HTTP header、operation audit、runtime log 和事件流都携带同一 trace。
- `server/scripts/verify-security-hardening.mjs` 验证真实启动后的 trace drill-down API、脱敏审计导出和 trace 过滤。
- `server/scripts/verify-runtime-logging.mjs` 验证日志文件生成、字段摘要和 token/secret 不落盘。
- `npm run server:verify:production-readiness` 已把 `trace-observability` 纳入 P0 门禁。

补全效果：生产问题可以定位到具体步骤；汇报时能展示“为什么这次回答用了这些证据、花了多少钱、慢在哪里、失败在哪里”。

### P0-03 长任务缺少 durable execution 级别保证

当前差距：当前任务、后台 worker、队列、checkpoint 已有基础，但还没有 Temporal 这类 durable workflow 的语义：确定性编排、activity 重试、信号、timer、可恢复状态、可观察执行历史和幂等边界。

对标依据：Temporal 的核心设计是 Workflow 运行状态默认持久、可恢复、可 replay、可暂停；失败易发逻辑放在 Activity 中自动重试；服务保存 task queue、signal、timer 等状态。

为什么缺：当前任务更像应用内 job manager。它能跑本地流程，但对进程崩溃、部署重启、worker 丢失、长时间模型调用、人工审批等待、外部库写入半成功等生产问题的语义不够硬。

能否补全：可以，但工作量大。

怎么补：

- 定义 `pact.workflow.v1`，先不强依赖 Temporal，但协议语义向 durable workflow 对齐。
- 将高风险长任务拆成 workflow + activity：文档解析、外部 KB ingest、蒸馏、批量邮件整理、导出、重建索引。
- activity 必须幂等，写入幂等 key、输入 hash、输出 hash、补偿动作。
- 后续可接 Temporal / BullMQ / 自研 durable runner，但接口先稳定。

当前实现入口：

- `docs/PROTOCOLS.md` 已定义 `pact.workflow.v1` 和 `pact.checkpoint-tree.v1` 的协议边界。
- `server/platform/common/workflow/durable-workflow-store.mjs` 实现单机 `pact.workflow.v1` durable workflow store：workflow/activity/signal/timer/human review/external partial write 都写入 hash-chain execution history，支持重启恢复、活动幂等复用和 partial write 补偿语义。
- `server/services/client/work-queue-core/jobs/job-manager.mjs` 已把导入解析 job 接入 durable workflow：创建 job 时写入 workflow，worker-run 作为 activity 记录 heartbeat、完成、失败和恢复信号。
- `server/platform/common/data-structure/checkpoint-tree-store.mjs` 提供 checkpoint tree 持久化、节点状态、事件追加、tree lock 和恢复查询基础。
- `server/scripts/verify-durable-workflow.mjs` 验证 activity 幂等、hash-chain history、模拟崩溃恢复、timer、human review、external partial write commit 和最终 workflow completion。
- `server/scripts/verify-checkpoint-lifecycle.mjs` 验证 upload/job checkpoint、重复提交、恢复、重启恢复、checkpoint tree 查询和失败回收。
- `server/scripts/verify-state-coordination.mjs` 验证队列、状态和监控注册的一致性。
- `server/scripts/verify-transaction-continuity.mjs` 验证业务事务连续性模型。
- `npm run server:verify:production-readiness` 已把 `durable-workflow` 纳入 P0 门禁，并运行 `server:verify:durable-workflow`、`server:verify:continuity`、`server:verify:checkpoints` 和 `server:verify:state-coordination`。

补全效果：服务重启、部署、超时、部分失败后不会丢任务；可以向生产运维解释“任务如何恢复、如何补偿、如何人工介入”。

### P0-04 外部检索引擎后端一致性仍不够硬

当前差距：已有 pgvector、Qdrant、OpenSearch 方向和协议说明，但针对系统底层检索引擎（用于索引本工作空间内的知识，而非实时代理的上游知识库），还没有成熟的 conformance fixture 覆盖真实 Docker 服务、权限预过滤、增量更新、删除/tombstone、重建、资产/evidence 回读、混合检索和性能退化。

对标依据：OpenSearch hybrid search 需要 ingest pipeline、index、search pipeline 和 score 融合；Qdrant 通过 payload index、strict mode、filter 和 rate limit 防止低效查询与过载。生产检索引擎不是“能连上”，而是要证明检索、过滤、删除和回读语义一致。

为什么缺：当前检索后端适配器更偏“连接能力”，缺少跨不同数据库后端同一 corpus 的行为等价测试和性能/权限基准。

能否补全：可以。

怎么补：

- 增加 `npm run server:verify:external-search-backend-conformance`。
- docker compose 启动 pgvector、Qdrant、OpenSearch。
- 固定 normalized corpus：文本、表格、图片资产、邮件线程、多租户 source scope。
- 测试链路：ingest (针对本地/共享资产) -> search -> evidence read -> asset read -> hybrid/fusion -> delete/tombstone -> sync -> reindex -> permission prefilter。
- 输出每个 backend 的能力矩阵和阻塞缺口。

当前实现入口：

- `server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs` 定义 `pact.external-knowledge-adapter.v1`，支持 `qdrant`、`opensearch`、`pgvector/postgres` 外部后端和本地 fallback。
- adapter 覆盖 upsert、search、deleteBatch、health、permission/sourceIds 过滤、backendTrace、evidence pack 和混合检索能力声明。
- `server/scripts/verify-external-knowledge-base.mjs` 验证 Qdrant/OpenSearch/pgvector 语义、batch 删除、回读、provider health 和 source 过滤。
- `server/scripts/verify-knowledge-retrieval-quality.mjs` 与 `server/scripts/verify-source-evidence-preview.mjs` 验证检索质量和 evidence 回读。
- `npm run server:verify:production-readiness` 已把 `external-knowledge-base-consistency` 和 `rag-evaluation` 纳入 P0 门禁。

补全效果：底层检索引擎从“可配置连接”升级为“可替换生产后端”；业务现场已有数据库团队时可以有明确接入合同。

### P0-05 文档解析质量没有真实业务基准

当前差距：项目已改为结构吸附切分、动态参数文档解析策略和 DOCX 导出方向，但对 PDF/PPT/图片表格/扫描件/邮件线程/目录项目的真实样例基准仍不足。尤其是“PPT + 图片转 PDF”这类文件，生产上不能只依赖文本层。

对标依据：LlamaIndex ingestion pipeline 把 transformation、cache、docstore/hash、vector store 写成可复跑 pipeline；Haystack 允许用 branching pipeline 按文件类型路由不同 converter，并能序列化 pipeline。成熟系统把解析视为可配置、可复跑、可审计 pipeline，而不是临时 fallback。

为什么缺：当前已有解析入口和策略，但真实世界里的视觉 OCR、表格结构、图片顺序、PDF 页面坐标、PPT 版式恢复、邮件附件关系还没有统一黄金集和准确率指标。

能否补全：可以，部分能力需要云端视觉模型或外部 OCR。

怎么补：

- 建立 `fixtures/real-documents/` 或外部大文件 fixture registry，覆盖 PDF/PPTX/DOCX/XLSX/EML/MSG/Markdown/图片扫描件。
- 每个样例维护 expected structure：标题树、页序、图片序、表格数、表头、关键单元格、引用锚点。
- 增加 parser score：structure recall、table accuracy、image order accuracy、text coverage、source anchor accuracy。
- 对扫描件和图片型 PDF 引入 cloud multimodal parser mount；本地 OCR 只做可选 fallback。

当前实现入口：

- `server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs` 提供动态解析策略、结构吸附参数和 dry-run 入口。
- `server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs` 处理 PDF/PPTX/DOCX/XLSX/EML/MSG/Markdown 等多文件入口和归一化。
- `server/platform/specialized/knowledge/assets/asset-lineage/index.mjs` 记录 raw object、page/slide、bbox、parser/model/OCR 版本和重解析计划。
- `server/platform/common/production-readiness/sample-business-pack.mjs` 提供 EML、PDF、PPTX、Markdown 项目和外部知识库 compose 的可物化样例包。
- `server/scripts/verify-dynamic-document-parsing.mjs`、`server/scripts/verify-document-preview-consistency.mjs`、`server/scripts/verify-document-parser-dry-run.mjs`、`server/scripts/verify-knowledge-docx-export.mjs` 和 `server/scripts/verify-sample-business-pack.mjs` 共同覆盖真实样例、预览一致性、导出和样例物化。
- `npm run server:verify:production-readiness` 已把 `document-parsing-real-sample` 纳入 P0 门禁。

补全效果：文档切分和知识蒸馏有可量化输入质量；可以向业务方说明哪些文件类型已达标，哪些仍需要人工复核或云端解析。

### P0-06 评估体系没有覆盖 RAG、蒸馏、Agent 和工具调用全链路

当前差距：已有 `evaluateIndustrialDistillationGap()` 和若干验证脚本，但还没有统一评估平台覆盖 RAG 检索、证据忠实度、答案正确性、蒸馏覆盖率、同一事项合并、时间线顺序、工具调用准确率、Agent 目标达成和安全拒答。

对标依据：Ragas 指标覆盖 RAG 的 context precision/recall、faithfulness、response relevancy，以及 Agent/tool use 的 tool call accuracy、agent goal accuracy；Phoenix 支持 code-based evaluator 和 LLM-as-judge，并记录评估 trace。

为什么缺：目前评估更像局部脚本，不是数据集驱动、版本化、可比较的 evaluation registry。

能否补全：可以。

怎么补：

- 定义 `pact.evaluation.v1`：dataset、case、expected、rubric、judge model、deterministic metric、result、trace。
- 建立真实业务基准集：项目 Markdown、邮件线程、合同/发票/审批、PDF 表格、图文 PPT。
- 每个模型/profile/tool grant 变更必须跑离线评估。
- 生产流量抽样进入 shadow eval，不直接影响用户但生成质量趋势。

当前实现入口：

- `server/platform/specialized/knowledge/retrieval/evidence-sufficiency-gate/index.mjs` 和 `retrieval-scoring.mjs` 提供 evidence sufficiency、score reason 和检索质量基础。
- `external-services/knowledge-distillation-service/`、`server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs` 和 `knowledge-evolution-runtime/index.mjs` 提供外部蒸馏基准、服务调用、错误归因、趋势和候选改进闭环。
- `server/platform/specialized/knowledge/invocation/golden-rule-runtime/index.mjs` 支持黄金规则、测试场景和规则命中评估。
- `server/scripts/verify-knowledge-retrieval-quality.mjs`、`verify-knowledge-distillation-workbench.mjs`、`verify-knowledge-industrial-distillation.mjs`、`verify-knowledge-distillation-optimization.mjs`、`verify-knowledge-evolution-loop.mjs`、`verify-knowledge-rule-authoring.mjs` 和 `verify-business-scenarios.mjs` 覆盖 RAG、蒸馏、Agent/工具业务流和回归趋势。
- `npm run server:verify:production-readiness` 已把 `rag-evaluation`、`distillation-evaluation` 和 `business-scenarios` 纳入门禁。

补全效果：模型切换、解析算法、检索参数和蒸馏 prompt 的改动可以量化比较；“工业领先”有证据而不是感觉。

### P0-07 安全、租户、权限和密钥边界未达到生产审计标准

当前差距：已有 console auth、CSRF、session token rotation、Tool Management grant、scope、policy、tenant/resource ABAC 基础裁决、审计保留和脱敏导出，但生产还需要更完整的 secret management、工具沙箱、外部连接器真实 OAuth、外部 connector token rotation、OTel 导出、跨真实外部系统的权限证据，以及不依赖普通业务数据库的 Capability Key 内核边界。

对标依据：OpenTelemetry 和 Phoenix 都强调 trace/评估中的输入输出可见性，但这也要求敏感信息治理；企业生产中工具调用和知识检索必须能证明谁在何时访问了哪些数据、通过哪个 grant、输出给了谁。密钥设计参考 OAuth opaque token / introspection、Vault service token、Linux kernel key retention service、OS Keychain / KMS / HSM，以及 Macaroons、Biscuit、UCAN、SD-JWT、Merkle proof、cryptographic accumulator 和 ZK set membership 等主流授权凭据方案的取舍。

为什么缺：当前实现偏本地团队共享和研发验证，尚未把企业安全审计作为一级能力建模。更关键的是，Pact 后续会提供智能巡检、维护 worker 和运维智能体；这些智能体极可能运行在用户部署设备上，并具备检查、修复、写文件或写运行态数据的能力。因此普通 SQLite、JSON 状态文件、业务数据库和智能体可写 data dir 都必须按可见、可泄漏、可篡改处理，不能作为权限最终事实源。

能否补全：可以。

怎么补：

- 定义 `pact.security.v1`：tenant、workspace、subject、role、grant、data class、secret ref、audit event。
- 所有 trace/eval/export 必须走 redaction policy。
- 工具执行必须按风险等级分层：read、write、repair、external side effect、shell/process。
- 密钥只保存 secret ref，不进入 settings JSON、trace、export、bundle。
- 增加安全门禁：越权检索、越权导出、工具越权、secret leak、trace leak。
- 建立 Capability Key Kernel：调用者只持有一个 opaque key；内核只接受 `opaqueKey + requestedCapability` 并返回 allow/deny；普通业务 DB 只能做审计投影、展示、申请单或缓存，不能参与最终裁决。

#### Capability Key 设计要求

上层安全边界固定为两条：

1. 客户端 MCP 入口。
2. 服务端 API 出口。

环境固定为三个：

- 终端智能体。
- 平台运行时。
- 应用服务器。

两条边界共用五个对象：

| 对象 | 终端智能体 -> 平台运行时（客户端 MCP 入口） | 平台运行时 -> 应用服务器（服务端 API 出口） |
| --- | --- | --- |
| 身份与准入认证 | client、agent、user、device、MCP grant、opaque key 绑定 | provider account、OAuth、API key、service account、secretRef、tenant 映射 |
| 权限与行为策略 | operation、tool、skill、workspace、dataClass、egress、高风险确认 | provider scope、读写删同步权限、外部副作用审批、Capability 到 provider scope 映射 |
| 数据与状态语义 | 上传、下载、context、memory、export、asset 状态、client lifecycle、路径安全 | import、export、sync、mirror、credential lifecycle、connector lifecycle、etag/version、durable id、真实持久化状态 |
| 流量与资源管理 | QPS、并发、上传速率、队列、quota、上下文大小 | provider 限流、重试、熔断、模型 token 成本、API 成本、同步频率 |
| 审计与事实验证 | receipt、loan、denied request、trace、checkpoint、recovery evidence | provider receipt、webhook 证据、external failure evidence、合规保留 |

生命周期状态归入“数据与状态语义”，不作为第五类对象。审计与事实验证只负责证明状态迁移、权限裁决、外部副作用和拒绝结果。

已确认硬约束：

- 调用者只拿一个密钥。密钥不是 JWT，不是 `header.payload.signature`，不暴露 capability 列表，不携带用户、组织、角色或智能体身份。
- 内核只验证指定 Capability。调用形态固定为 `verify(opaqueKey, requestedCapability)`，默认只返回 allow/deny、reasonCode 和最小 credential 摘要；不提供“列出这个 key 的全部权限”接口，也不在默认裁决响应中暴露 keyHash、capabilitySetHash、完整 capability 数量、metadata 或 constraints。授权审计落盘时同样必须脱敏：decision 和直接 denied request 入口都不能保存原始 opaque key、keyHash、capabilitySetHash、lookup key 或完整 subject capability 集合。
- `ock_` 密钥不能被当成 legacy bearer token 使用。只要请求携带 opaque capability key，执行路径必须进入 Capability Kernel；Kernel provider 不可用或不支持 `verify()` 时必须拒绝并返回 `capability_kernel_unavailable`，不能回退到 token hash、scope、toolset 或普通 grant 策略。
- denied request 审计必须可精确取证。存储和控制台/RPC 查询至少支持按 `reasonCode`、`operationId`、`toolId`、`subjectId`、`tenantId` 和 `workspaceId` 组合过滤，避免只能靠最新记录或全文扫描判断拒绝原因。
- 权限内核只认 Capability。组织、用户、Owner、智能体、角色和 namespace binding 都不能进入内核权限模型；这些只能由内核外的绑定层验证。
- Capability 必须细粒度、稳定、写死到内核 manifest。调用凭据只和 Capability 关联，不能和业务身份字段混用。
- Capability manifest 是强约束，不是提示列表。签发、轮换或 Tool Management grant 中出现未知 Capability 必须拒绝；不能静默过滤，也不能降级为 legacy token、scope 或业务 DB 裁决。
- 普通数据库不是安全边界。业务 DB、可见 DB、智能体可写 DB、JSON 运行态文件都不能作为权限事实源。
- 权限事实源必须被封装在 Capability Kernel 和 OS Keychain、Secure Enclave、TPM、DPAPI/CNG、KMS、HSM、TEE 或远端权限服务边界内。默认个人版不创建独立系统用户；增强模式才启用独立 helper / service user。
- 不允许 Root 权限密钥、Owner 万能密钥或业务级内核万能 key。内核可以有本地 cryptographic secret，但它只能用于索引、完整性或 sealed state，不代表任何权限主体。

不可满足性边界：

```text
如果只有一个随机 opaque key，
且 key 本身不携带权限证明，
且内核没有任何可信状态，
那么 verify(key, requestedCapability) 无法区分 allow / deny。
```

因此可行路线只能二选一：

1. 有可信封装状态：key 本身只是随机句柄，权限关系在 Capability Kernel 的 sealed state 中。
2. 无状态凭据：key/token 自带权限声明、权限承诺或成员证明。

Pact 的当前硬约束排除了普通 DB 状态，也排除了暴露权限列表；因此推荐基线是第一类，但状态必须封装在智能体不可直接读写的安全边界内，而不是普通业务数据库。

#### 推荐基线方案

```text
caller
  -> opaqueKey
  -> namespace/user/agent binding guard
  -> requestedCapability
  -> Capability Kernel verify(opaqueKey, requestedCapability)
  -> allow / deny
```

Capability Kernel 内部可以使用如下结构，但这些结构不得出现在普通业务 DB 中：

```text
keyIndex        = HMAC(kernelIndexSecret, opaqueKey)
bindingIndex    = HMAC(kernelIndexSecret, opaqueKey || requestedCapability || epoch)
recordStatus    = valid | invalid
stateRoot       = hash-chain / Merkle root / sealed epoch
```

验证时只计算当前 `requestedCapability` 的绑定索引，不读取、不返回、不暴露该 key 的完整 capability 集合。轮换时生成新 opaque key 并把旧 key 置为 invalid；撤销只产生 invalid 状态，不引入 active / verify-only / signing 等多重业务状态。

`kernelIndexSecret` / runtime lookup key 只用于本地 HMAC 索引，不是 Root key，也不代表任何权限。因为内核不保存明文 opaque key，已有 Capability binding 后不能单独轮换 runtime lookup key；否则无法重算旧 key 的索引。密钥滚动必须发生在调用密钥层：`rotateCapabilityKey` 新发 `ock_`，旧 key 立即置为 invalid，Capability 集合按新签发记录写入 sealed state。

Binding Guard 是内核外层，不属于权限内核模型。它的输入是 `opaqueKey + namespace + userId + agentId + clientId`，输出也是 allow/deny；它不能返回某个 key 绑定了哪些用户或智能体。内部只保存 HMAC 后的 key/user/agent/client/namespace 索引和 `valid | invalid` 状态，普通 Tool Management DB 里的 grant metadata 只能作为展示、申请单和审计投影，不能作为错绑放行依据。这样可以满足：

- 同一个 Capability Key 仍然只和 Capability Kernel 内的 Capability 关联。
- 用户、智能体和 namespace 不进入 Capability Kernel。
- 如果请求报文声称的 user/agent 与签发时 sealed binding 不一致，即使普通 DB metadata 被改成匹配，也必须拒绝。
- 未迁移的旧 key 没有 sealed binding 时可按兼容策略标记 `capability_binding_not_registered`，不把普通 DB 提升为事实源。

默认存储模型：

```text
OS keyring:
  pact.capability.kernel.state = AEAD({
    epoch,
    validKeyIndexes,
    validBindingIndexes,
    revokedKeyIndexes,
    stateRoot
  })

fallback file:
  <dataDir>/security/capability-kernel/state.sealed
  仅在 OS keyring 不可用时使用；必须在 UI/doctor/audit 中标记为 degraded。

  <dataDir>/security/capability-binding-guard/state.sealed
  保存 key/user/agent/client/namespace 的 HMAC binding；同样只能作为 degraded fallback。

process memory:
  validKeyIndexes
  validBindingIndexes
  revokedKeyIndexes
  epoch
```

默认模式下，Capability Kernel 启动时优先从 OS keyring 读取 sealed state blob，解密校验后构建内存索引；高频 `verify(opaqueKey, requestedCapability)` 只查内存，不在每次请求中访问 keyring。`issue/revoke/rotate` 修改内存后，重新封装 state blob 并写回当前后端。

可用性优先。OS keyring 不可用时允许降级到本机文件后端，使用 `ServerConfig.getDataDir()/security/capability-kernel/*.sealed.json` 这类路径保存 sealed state，并把本机 sealing key 拆到同目录 `*.sealing-key` sidecar。两个文件都必须在私有目录下以 `0600` 权限原子写入；主状态文件不得嵌入 sealing key、明文 capability、opaque key、userId 或 agentId。文件后端不是生产安全边界，不能伪装成 keyring-backed；doctor、控制台和审计必须标记 `securityMode=degraded_file_fallback`。文件后端仍然不能使用业务 DB、Tool Management DB 或普通配置 JSON 作为权限事实源。

sealed state 写入必须串行化。Capability Kernel 和 Binding Guard 都维护内部 mutation queue；跨 helper / CLI / server 进程再使用 data dir 下的私有 lock file。并发签发、绑定、撤销、恢复导入和调用密钥轮换按顺序提交，首次 runtime lookup key 初始化也必须在锁内完成并持久化；读路径在当前写入完成后再返回裁决或 recovery package。这样保证 file fallback 和 keyring-backed 模式不会在高并发本机调用下出现后写覆盖先写的权限状态丢失。

增强模式的第一步是命令级安全 helper，而不是立即要求用户安装长期驻留 daemon 或独立系统用户。`pact.capability-security-helper.v1` 接收一次 JSON 请求，在独立子进程内加载 Capability Kernel 与 Binding Guard，完成 `issueCapabilityKey`、`verifyCapability`、`verifyBinding`、`verifyCapabilityAndBinding` 和撤销操作，只返回当前请求的 allow/deny、reasonCode 与必要 credential 摘要；它不提供列出某个 key 全部 Capability 或绑定身份集合的接口。这个模式仍然继承当前后端的安全边界：keyring-backed 时可防普通业务 DB 和 grant projection 篡改，file fallback 时只保证可用和语义一致，不承诺同 OS 用户恶意进程隔离。

恢复和迁移必须支持 recovery package：

```text
pact security recovery export
pact security recovery import
```

recovery package 用于换机器、重装系统、keyring 损坏或从 file fallback 升级到 keyring。导出必须有用户确认，默认加密，可包含 sealed state、epoch、stateRoot、后端类型和迁移元数据；不得进入普通 trace、bundle、checkpoint node 或审计导出。

`pact security recovery export` 输出统一安全恢复包 `pact.security-recovery.v1`，其中包含两个互相独立的加密组件：

- `capabilityKernel`：恢复 opaque key 与 Capability 的 sealed binding。
- `capabilityBindingGuard`：恢复 opaque key 与 namespace/user/agent/client 的 sealed binding。

两个组件都使用 recovery passphrase 单独派生密钥并 AEAD 封装；包外只暴露 protocol、alias、epoch 和 stateRoot 摘要，不暴露 runtime lookup key、binding lookup key、明文 capability、opaque key、userId 或 agentId。`import` 必须同时恢复两个组件；为兼容早期本地包，也允许导入旧的 kernel-only recovery package，但导入结果必须明确只恢复了 `capabilityKernel`。

Linux 后端按可用性从高到低探测，实际 `auto` 只会选择当前实现可读写的后端：

1. TPM2 / systemd-creds / systemd-cryptenroll 可用时，作为增强本机版候选；当前默认 `auto` 不会选择未实现的 systemd/TPM 路径。
2. Linux kernel keyring 可用时，使用 `keyctl` 把 sealed state 写入用户 keyring。
3. Secret Service / libsecret 可用时，使用 `secret-tool` 把 sealed state 写入桌面密钥环。
4. pass / GnuPG 用户密钥仓库可用时，使用 `pass` 作为用户态兼容后端。
5. 本机文件后端作为最后兜底，必须标记 degraded。

Windows 默认使用 DPAPI / CNG 保护的本机文件后端：`windows-dpapi` 会把 Capability Kernel 和 Binding Guard 的 sealed record 先通过当前 Windows 用户的 DPAPI `ProtectedData` 加密，再写入 data dir 下的 `.dpapi` 文件。该文件不是普通明文 fallback；迁移、备份和恢复仍应使用统一 recovery package，而不是直接复制 DPAPI 文件到其它用户或其它机器。

部署档位：

- 默认个人版 / 本机版：优先 OS keyring-backed Capability Kernel，keyring 不可用时自动降级到 file fallback。不创建独立系统用户，不安装额外私有权限数据库；最多在 `pact security init` 时触发一次系统钥匙串授权。适合推广、个人和小团队本机使用。
- 增强本机版：先提供命令级安全 helper，把签发、Capability 裁决和 Binding Guard 裁决移出业务进程；后续再演进为长期驻留 `capabilityd`、可选独立 OS 用户、私有 sealed state 文件、Keychain/TPM/DPAPI 只保存 sealing key 和回滚锚点。适合高敏感本机部署。
- 企业 / 云端版：远端权限服务、KMS/HSM 或可远程证明的 TEE。AWS Nitro Enclaves、Google Confidential Space、Azure Secure Key Release 这类方案可把关键材料只释放给 attested workload。

默认模式安全边界必须标注清楚：keyring-backed 可以防普通业务 DB 泄漏、业务 DB 篡改和智能体直接改运行态文件提权；file fallback 只保证系统可用和权限模型语义一致，不承诺强安全隔离。同一 OS 用户下的恶意本机进程、恶意插件、已获得 keyring 访问授权的代码或可直接改 fallback 文件的代码不在个人版强防范围内。需要该级别隔离时必须启用增强本机版或企业 / 云端版。

#### 算法和方案调研矩阵

| 方案 | 核心做法 | 满足项 | 不满足或风险 | Pact 结论 |
| --- | --- | --- | --- | --- |
| Opaque random token + sealed kernel store | key 是高熵随机句柄；权限关系在安全服务内部状态。类似 OAuth opaque token introspection、Vault service token。 | 单 key、不暴露权限、可验证指定 capability、可即时撤销、可滚动。 | 必须有可信封装状态；普通 DB 不能当状态源。 | 推荐基线。 |
| 远端授权服务 / KMS / HSM 状态 | 本机只转发 verify 请求，权限事实源在远端安全服务。 | 避免本机运维智能体改权限状态，支持集中轮换和审计。 | 离线能力差，部署复杂度高。 | 企业/云部署推荐。 |
| Opaque token + 普通 DB + HMAC 索引 | DB 存 HMAC 后的 key/capability 索引。 | 防只读泄漏，查询快。 | 智能体能写 DB 时可回滚、删改、拒绝服务或干扰裁决；不是最终边界。 | 只能作为原型、缓存或审计投影，不能生产裁决。 |
| JWT / PASETO public claims | token 内含 claims / scope / exp，并签名。 | 无状态、跨服务验证容易。 | 暴露权限集合；服务端能解出全部权限；撤销困难。 | 排除为主凭据。 |
| JWE / PASETO local / Vault batch-like encrypted blob | token 内加密携带权限和有效期。 | 调用者看不到明文权限，可无状态。 | 内核解密后仍得到权限集合；即时撤销弱；token 变成自包含授权包。 | 不符合“内核不解出全部权限”。 |
| Macaroons | HMAC 链和 caveats 支持委派、衰减和上下文限制。 | 细粒度、可衰减、适合分布式授权。 | caveats/限制通常随凭据暴露；验证仍要解释授权内容；撤销需要状态。 | 可参考 caveat 思想，不作为主凭据。 |
| Biscuit | 公钥签名 bearer token，Datalog 表达权限和检查，支持 offline attenuation。 | 表达力强，适合工具/资源策略。 | token 携带 facts/rules；验证会解释权限逻辑；不满足隐藏全部权限。 | 可参考策略语言，不作为主凭据。 |
| UCAN / ZCAP-LD | 基于 capability chain 的签名授权和委派。 | 去中心化委派强，能力模型清晰。 | capability 链、controller、target 和 caveat 是显式结构；身份和委派关系进入凭据。 | 不符合 Pact 内核只认 Capability 的简化目标。 |
| SD-JWT / selective disclosure | token 含 claim digest，调用时只披露指定 claim。 | 可选择性披露，不必暴露全部 claims。 | 需要 `token + disclosure/proof`，不是单 opaque key；撤销仍需状态。 | 只有放宽“只用一个 key”时才考虑。 |
| Merkle commitment + inclusion proof | token 或内核持有 capability set root；调用者提交 requestedCapability 的 inclusion proof。 | 可隐藏完整集合，只证明单项成员关系。 | 需要额外 proof；动态撤销和 witness 更新复杂；proof 泄漏结构信息。 | 可作为远期研究，不进 v0.0.1。 |
| Cryptographic accumulator / ZK set membership | 用 accumulator 承诺集合，用 ZK proof 证明 capability 在集合中。 | 理论上可证明单项成员且隐藏集合。 | 实现复杂、审计难、依赖曲线/配对/ZK 库，撤销和 witness 更新成本高；仍需要 proof。 | 研究项，不作为近期实现。 |
| 单 Capability 单 key / 派生子密钥 | 每个能力发一个 key，或由 master 派生 capability-specific key。 | 服务端只验这个 key 是否对应该 capability。 | 违反“一个密钥承载多个能力”的使用诉求；key 管理爆炸。 | 仅适合极高风险单能力，不作为默认。 |
| 硬件绑定 possession key | 私钥在 Secure Enclave/TPM/HSM，调用时签 challenge。 | 防止 key 被复制，适合高价值凭据。 | 只证明持有私钥，不证明 capability；仍需要 sealed state 或签名授权声明。 | 作为增强项，不替代授权模型。 |

#### 外部绑定层边界

用户、智能体和 namespace 绑定必须在权限内核外做，但“内核外”不等于“普通业务 DB”。如果绑定错误会导致越权，则绑定层本身也必须是受控服务或 sealed policy：

```text
request(userId, agentId, namespace, operation, opaqueKey)
  -> Binding Guard 验证 key 是否允许被该 user/agent/namespace 使用
  -> operation 映射为 requestedCapability
  -> Capability Kernel 验证 opaqueKey 是否允许 requestedCapability
```

绑定层可以引用业务 DB 作为展示或申请单来源，但最终 allow/deny 必须由受控绑定状态、签名配置、审批事件链或 Capability Kernel API 决定。

#### 参考资料

- OAuth 2.0 Token Introspection, RFC 7662: <https://datatracker.ietf.org/doc/html/rfc7662>
- OAuth 2.0 Token Revocation, RFC 7009: <https://www.rfc-editor.org/rfc/rfc7009>
- JSON Web Token Best Current Practices, RFC 8725: <https://www.rfc-editor.org/rfc/rfc8725>
- SD-JWT selective disclosure, RFC 9901: <https://www.ietf.org/ietf-ftp/rfc/rfc9901.html>
- PASETO specification: <https://github.com/paseto-standard/paseto-spec>
- HashiCorp Vault tokens: <https://developer.hashicorp.com/vault/docs/concepts/tokens>
- Macaroons paper: <https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/>
- Biscuit specification: <https://doc.biscuitsec.org/reference/specifications>
- UCAN specification: <https://github.com/ucan-wg/spec>
- Linux Kernel Key Retention Service: <https://www.kernel.org/doc/html/v4.20/security/keys/core.html>
- Apple Secure Enclave keys: <https://developer.apple.com/documentation/Security/protecting-keys-with-the-secure-enclave>
- Microsoft DPAPI: <https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata>
- Microsoft TPM usage: <https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/how-windows-uses-the-tpm>
- AWS KMS cryptographic attestation for Nitro Enclaves: <https://docs.aws.amazon.com/kms/latest/developerguide/cryptographic-attestation.html>
- Google Confidential Space security overview: <https://docs.cloud.google.com/docs/security/confidential-space>

当前实现入口：

- `server/platform/common/security/auth/console-auth.mjs` 和 `server/scripts/console-auth.mjs` 提供 owner/admin/operator/viewer、登录、session、token rotation、审计和初始凭据治理。
- `auth.sessions.rotate` / `POST /api/auth/sessions/rotate` / `auth sessions rotate` 提供当前控制台 session token rotation；轮换后旧 session token 立即失效，新 CSRF token 由 session token HMAC 派生，并写入审计。
- `server/platform/common/security/authorization/organization-model.mjs` 提供独立组织模型 `pact.organization-model.v1`：根节点固定为 `Pact Root`，组织可以挂 Root 或其它组织，用户可以挂 Root 或组织，Owner 默认挂 Root；该模型只提供身份归属和治理上下文，不提供 Root 权限，也不进入 Capability Kernel。
- `server/platform/common/security/authorization/authorization-engine.mjs` 维护硬编码 Capability manifest，支持 subject/tool grant 的 `tenantId`、workspace allowlist、dataClass allowlist 和 egress allowlist；tenant mismatch、workspace/dataClass/egress 越界会写入 authorization decision 与 denied request audit；未知 Capability 在签发和 grant 创建时会被拒绝，不能静默降级。
- `server/platform/common/security/authorization/opaque-capability-key.mjs` 提供 Capability Key Kernel 的本机封装：新发 key 为 `ock_` opaque key；验证只接受 `opaqueKey + requestedCapability`；sealed state 优先走 OS keyring，keyring 不可用时可用 file fallback 并标记 degraded；macOS 使用 Keychain，Linux 已实现 `keyctl`、`secret-tool` 和 `pass` 三类后端，Windows 已实现 DPAPI-protected file 后端；支持 recovery package 导出/导入。
- `server/platform/common/security/authorization/capability-binding-guard.mjs` 提供内核外 Binding Guard：签发时把 `opaqueKey + namespace/user/agent/client` 写入 sealed binding；执行时只验证当前请求上下文是否匹配，不返回、不暴露绑定身份集合；普通 grant metadata 被篡改后不能改变 sealed binding 裁决；Linux 与 Capability Kernel 共用 `keyctl`、`secret-tool`、`pass` 后端排序，Windows 共用 DPAPI-protected file 后端。
- `server/scripts/pact-capability-security-helper.mjs` 和 `server/platform/common/security/authorization/capability-security-helper-client.mjs` 提供 `pact.capability-security-helper.v1` 命令级 helper：调用方可以把 opaque key 签发、指定 Capability 验证、Binding Guard 验证和 credential 撤销交给独立子进程完成；Tool Management 可通过 `PACT_TOOL_GRANT_CAPABILITY_SECURITY_HELPER=1` 进入该路径；helper 响应不包含完整 capability 列表、metadata、constraints、runtime lookup key、binding lookup key 或明文身份集合。
- `server/platform/common/security/authorization/capability-kernel-status.mjs` 把 provider、securityMode、degraded、stateRoot、bindingCount 和 recoverySupported 汇总为脱敏状态；`server/scripts/doctor.mjs` 和 production health console 都会显示 `degraded_file_fallback`，避免文件降级被静默隐藏。
- `server/scripts/pact.mjs` 提供 `pact security capability-kernel status`、`pact security binding-guard status`、`pact security recovery export` 和 `pact security recovery import`；recovery package 写出文件默认 `0600`，统一包同时包含 Capability Kernel 与 Binding Guard 两个加密组件，CLI 输出只返回 epoch、stateRoot、路径和状态摘要，不输出 passphrase、runtime lookup key、binding lookup key、明文 key、明文 capability 或明文身份。
- `server/platform/common/security/operation-audit.mjs` 支持 tenant/trace 查询、审计保留策略、过期清理和脱敏 JSONL 导出，导出前统一调用 redaction policy，避免 secret、token、cookie、API key 和本机绝对路径进入审计包。
- `/api/auth/audit/export`、`/api/auth/audit/retention`、`/api/auth/audit/prune` 和 `/api/observability/traces/:traceId` 提供 API/RPC/CLI 可达的内审、保留和 trace drill-down 路径。
- `server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs` 与 Tool Management runtime 提供 tool catalog、scope、toolset、grant、policy preview/evaluate、execute、audit 和 metrics；新 grant 默认发放 opaque capability key，Tool Management DB 只保存 credential 摘要，工具执行前按 `cap:tool:<toolId>:execute` 进入 Capability Key Kernel 裁决；携带 `ock_` 凭据但 Kernel provider 不可用或缺少 `verify()` 时拒绝为 `capability_kernel_unavailable`，不退回 legacy grant。
- `server/platform/common/operation-dispatcher/operation-decorators.mjs`、operation policy 和 safety-confirm 约束写操作、风险等级、CSRF 和审批边界。
- `server/platform/specialized/knowledge/agent-library/access-policy.mjs` 提供 source-level knowledge access、checkoutPolicy、receipt、loanRecord、export/context injection 裁决。
- `server/platform/common/observability/runtime-logger.mjs` 对 token、password、secret、API key、cookie 和绝对路径做摘要/脱敏。
- `server/scripts/verify-console-auth.mjs`、`verify-security-hardening.mjs`、`verify-tool-management-platform.mjs`、`verify-organization-model.mjs`、`verify-authorization-governance.mjs`、`verify-authorization-capabilities.mjs`、`verify-opaque-capability-key.mjs`、`verify-capability-binding-guard.mjs`、`verify-capability-security-helper.mjs`、`verify-production-health-console.mjs`、`verify-operation-policy.mjs`、`verify-agent-library-access.mjs` 和 `verify-runtime-logging.mjs` 覆盖越权、工具风险、组织树边界、用户/智能体治理、知识权限、tenant/ABAC、opaque key 发放/验证/轮换/撤销、Binding Guard 错绑拒绝、helper 子进程内联合裁决、grant projection 篡改不提权、统一 security recovery 导出/导入并同时恢复 Capability Kernel 与 Binding Guard、doctor/production health 降级可见性、审计脱敏导出、trace drill-down、CSRF/safety 和 secret leak。
- `npm run server:verify:production-readiness` 已把 `tool-permission`、`agent-library-access`、`capability-kernel-security` 和 `trace-observability` 纳入 P0 门禁，其中 `capability-kernel-security` 固定运行 Capability manifest、opaque key、Binding Guard、security helper、Linux backend 和 Windows backend 验收。

补全效果：能面向企业内审、安全团队和运维团队说明权限共享的边界；团队共享不是无审计共享。

### P0-08 备份、恢复、迁移和升级策略不足

当前差距：有 SQLite、对象存储、jobs、upload session、knowledge-core 等多处状态，但缺少面向独立备份服务器/灾备目标的统一 backup manifest、restore drill、schema migration report、外部知识库重放策略、版本兼容策略。这里的 backup 不是 v0.0.1 上传留档、Checkpoint Restore 或 cloud sync 的同义词。

更关键的是，任务和队列层面的 checkpoint tree 还不够。系统必须把所有访问请求、文件变动、知识贡献、技能调用、权限裁决、上下文暴露和恢复动作都纳入统一 Checkpoint Tree。否则只能恢复部分任务或文件状态，不能真正回答智能体在公共空间里读过什么、带走过什么、调用过什么、贡献过什么、被拒绝过什么，也就不能做到真正不怕智能体乱搞。

对标依据：Temporal、OpenSearch、Qdrant 等生产系统都把状态恢复和可重放作为核心能力之一；LlamaIndex ingestion cache/docstore/hash 也说明输入和派生产物要可判定是否需要重处理。

为什么缺：当前状态边界多，文档中描述清楚，但没有一个生产级恢复演练入口。

能否补全：可以。

怎么补：

- 增加 `pact.backup.v1`：metadata DB、knowledge DB、raw objects、assets、jobs、settings、mount configs、model configs、auth DB 的 manifest。
- 增加 `server:backup`、`server:restore --dry-run`、`server:verify:restore-drill`。
- 增加 `pact.checkpoint-tree.v1`：统一 Checkpoint Tree，覆盖访问请求、文件变动、知识贡献、技能调用、权限裁决、上下文暴露、diff、restore preview、restore commit 和按 operation scope 回撤。
- 访问请求也必须进入树：search、evidence read、asset download、context bundle、export、checkout、memory write、tool call input 都会改变 receipt、loan record、usage event、denied request audit 或上下文暴露状态。
- 建立 Checkpoint Tree 安全恢复演示：A 逐个删除工作空间很多文件，管控台下滑找到 A 操作前节点，点击“恢复到此节点”，系统以新的 restore operation 回到目标状态，同时保留 A 的删除历史和恢复审计。
- 每次 schema migration 输出 migration report。
- 外部知识库只作为可重建索引，必须能由 canonical evidence 重放。
- 可以复用 git worktree 的 tree / diff / commit graph / checkout-like restore 能力，但生产语义必须覆盖 workspace 元数据、权限、knowledge evidence、loan record、contribution 引用和 audit record，不能只恢复文件树。

当前实现入口：

- `server/platform/common/storage/backup-restore.mjs` 定义 `pact.backup-restore.v1`，支持服务端数据目录备份、`backup-manifest.json`、文件 hash、分类汇总、restore preview 和受控恢复报告。
- `GET /api/storage/backups`、`POST /api/storage/backups`、`POST /api/storage/backups/restore-preview`、`POST /api/storage/backups/restore` 提供服务端调用面；Tool Management 暴露 `pact.storageBackups.*`。
- `server/platform/common/data-structure/checkpoint-tree-store.mjs` 和 `/api/system/checkpoint-trees` 提供长任务 checkpoint tree 查询、节点状态和事件链。
- `server/platform/common/storage/rebuild-metadata.mjs`、`ops-tools.mjs` 和 `sqlite-migrations.mjs` 覆盖元数据重建、存储 doctor/reconcile 和 SQLite schema migration。
- `server/scripts/verify-backup-restore.mjs` 验证备份 manifest、日志排除、文件恢复预览、确认恢复、恢复报告和路径约束。
- `npm run server:verify:production-readiness` 已把 `backup-restore`、`upgrade-migration` 和 `offline-license` 纳入生产硬化门禁；这不是 v0.0.1 上传留档主链路的前置条件。

补全效果：生产事故后有恢复路径；升级时能解释哪些状态是权威、哪些可以重建。

## P1 试点阻塞项

### P1-01 会话线程还缺 merge、compare 和冲突治理

当前差距：已支持 list/load/fork/append-only，但 fork 后如何比较两条路径、如何合并工作空间产物、如何标记胜出版本、如何归档不活跃会话还未定义。

对标依据：LangGraph fork 保留原历史，但成熟使用还需要 state history、checkpoint 对比和 resume 语义；否则 fork 只能分裂，不能治理。

补全方式：增加 `agent_sessions.compare`、`agent_sessions.merge_proposal`、`agent_sessions.archive`。注意 archive 也应只增不删，以事件形式标记。

当前实现入口：

- `server/platform/specialized/agent/agent-workspace/index.mjs` 在 `pact.agent-session-thread.v1` 内补齐 `compareSessions()`、`createSessionMergeProposal()` 和 `archiveSession()`。
- `compareSessions()` 只读比较两条线程，按 cloned source event 识别共同历史，输出 left-only / right-only / divergence 和同一 artifact/asset/document/path 的冲突。
- `createSessionMergeProposal()` 只向目标 session 追加 `session_merge_proposal` 事件，`autoMergeApplied=false`，所有冲突进入人工或上层 decision，不自动写最终决策。
- `archiveSession()` 追加 `session_archived` 事件并把 session 状态标记为 `archived`，不删除历史事件。
- 新增 `agent_sessions.compare`、`agent_sessions.merge_proposal`、`agent_sessions.archive` 操作和 Tool Management 工具暴露；`npm run server:verify:agent-session-governance` 验证 fork 后比较、冲突提案、归档事件、操作注册和工具目录。

效果：团队可以并行探索，再把有效路径合并为工作空间遗产。

### P1-02 前端治理界面还不够“生产操作台”

当前差距：控制台已有页面，但生产需要 dashboard：任务失败、解析质量、检索质量、外部库健康、模型成本、权限事件、待审批工具调用、会话分叉图、备份状态。

对标依据：Dify 的知识库检索测试强调记录测试与生产检索事件；Temporal/Phoenix 都把执行/评估状态可视化作为生产排障核心。

补全方式：新增“生产健康”页面，读取 production readiness、telemetry、eval、workflow、backup 状态。

当前实现入口：

- `server/platform/common/production-readiness/report-reader.mjs` 读取 `reports/production-readiness/<run-id>/report.json`，输出 `pact.production-health.v1`，按生产准入、知识质量、智能体运行时、权限安全、可观测性、连续性聚合状态。
- `GET /api/production/health` / `production.health` 提供控制台和外部调用可复用的生产健康摘要，权限要求为 `console:read`。
- `server-web/views/admin/ProductionHealthView.vue` 提供 `/admin/production-health` 管理页，展示最新 release gate、覆盖缺口、门禁明细、报告历史和执行入口。
- `npm run server:verify:production-health-console` 验证报告读取、操作注册、前端路由、桥接方法和 feature registry 是否闭环。

效果：业务汇报和运维排障不再依赖命令行和零散日志。

### P1-03 模型网关缺少生产成本与降级策略

当前差距：已有 AgentGateway 和 alias/profile，但还需要预算、速率限制、fallback、熔断、模型版本锁定、成本归因、prompt/version 关联。

对标依据：Phoenix 评估和 traces 会记录模型、prompt、score、耗时；生产 Agent 需要知道改了哪个模型或 prompt 后质量/成本如何变化。

补全方式：`pact.model-routing.v1` 增加 budget、circuit breaker、fallback chain、prompt version、cost ledger。

当前实现入口：

- `server/platform/specialized/agent/agent-gateway/model-routing/index.mjs` 实现 `pact.model-routing.v1`，覆盖预算估算、fallback chain、熔断状态、prompt version、成本估算和 JSONL 成本台账。
- `callAgentGateway()` 在请求携带 `modelRouting` 或全局 `settings.modelRouting` 时启用模型路由；同一次调用先做上下文压缩和客户端运行时分配，再按候选模型执行降级链。
- `model-decision-runtime` 已把知识库模型角色调用接入模型路由，按角色生成 `model-decision.<roleId>` 路由、prompt version 和预算约束。
- `GET /api/model-routing/health` / `model_routing.health` 读取模型路由熔断状态、最近台账、状态分布和估算成本。
- `npm run server:verify:model-routing` 验证 primary 失败后 fallback 成功、熔断跳过、预算拒绝、成本台账和操作注册。

效果：模型切换不再是配置变更，而是可观测、可回滚、可计费的运行策略。

### P1-04 外部工具与技能缺少生命周期治理

当前差距：工具管理和技能管理已作为通用能力，但缺少安装、签名、版本、依赖、兼容性、沙箱、审批、回滚、废弃策略。

对标依据：Haystack/LlamaIndex 的组件化和 pipeline 生态强调可替换组件；企业生产中可替换组件必须带版本和治理。

补全方式：定义 `pact.skill-registry.v1` 和 `pact.tool-package.v1`，所有外部工具/技能必须声明 capability、risk、input schema、secret refs、version、license。

当前实现入口：

- `server/platform/specialized/capabilities/package-lifecycle/index.mjs` 实现 `pact.capability-package-lifecycle.v1`，并定义 `pact.tool-package.v1` 与 `pact.skill-registry.v1` 的统一 manifest 校验。
- 能力包 manifest 必须声明 `kind`、`name`、`version`、`capabilities`、`risk`、`inputSchema`、`secretRefs`、`dependencies`、`compatibility`、`sandbox`、`license` 和签名摘要；写能力包不能使用 `none` sandbox。
- 新增 `/api/capability-packages`、`/api/capability-packages/plan`、`/api/capability-packages/:packageId/lifecycle`，覆盖预检、提交、审批、安装、激活、回滚、废弃。
- Tool Management catalog 已暴露 `pact.capabilityPackages.*` 工具入口，外部智能体必须通过 grant 和 policy 调用。
- `npm run server:verify:capability-package-lifecycle` 验证签名/字段校验、依赖、审批、安装、激活、版本回滚、技能包注册、操作注册和 Tool Management 暴露。

效果：外部团队能运营工具和技能，而不会把不受控代码塞进智能体上下文。

### P1-05 数据连接器和本地镜像同步还不完整

当前差距：架构描述了多源连接器，但生产还需要 OAuth refresh、增量 cursor、冲突处理、卸载、mirror cache 清理、localQuery 与服务端 evidence 去重。

对标依据：LlamaIndex ingestion pipeline 的 docstore/hash 处理体现了重复文档、变更文档和跳过未变更节点的重要性。

补全方式：为连接器增加 conformance fixture：OAuth、sync、localQuery、uninstall、mirror cleanup、hash collision、rate limit。

当前实现入口：

- `server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs` 定义 `pact.data-connector-governance.v1`、`pact.data-connector.v1` 和 `pact.local-mirror.v1`，只治理服务端连接器合同，不实现客户端连接器。
- 连接器 manifest 预检覆盖 provider/source 命名、capability、OAuth refresh、增量 cursor、冲突策略、hash collision 策略、rate limit、localQuery 禁远程、mirror dedupe 和卸载保留策略。
- `GET /api/data-connectors/governance`、`POST /api/data-connectors/governance/plan`、`POST /api/data-connectors/governance/conformance` 提供服务端治理调用面；Tool Management catalog 暴露 `pact.dataConnectors.governance*`。
- `npm run server:verify:data-connector-governance` 验证 manifest、OAuth refresh 策略、增量 cursor、未变更跳过、冲突更新、hash collision quarantine、rate limit、localQuery 禁远程、mirror cleanup、uninstall policy、操作注册和 Tool Management 暴露。

效果：邮件、文档库、网盘、聊天记录进入系统后可持续更新，而不是一次性导入。

### P1-06 性能和容量基准不足

当前差距：没有明确的文档数量、页数、图片数量、并发上传、检索 QPS、蒸馏吞吐、外部库同步延迟和成本目标。

对标依据：Qdrant strict mode 和 OpenSearch pipeline 都体现了生产检索必须对 query complexity、payload index、score fusion 和资源消耗有边界。

补全方式：定义容量目标，增加 benchmark runner：小/中/大 corpus、冷/热 cache、单机/外部库、多并发、失败注入。

当前实现入口：

- `server/platform/specialized/knowledge/performance/capacity-benchmark/index.mjs` 定义 `pact.performance-capacity.v1`，内置 `smoke`、`pilot`、`production` 容量目标档位。
- benchmark runner 使用合成 corpus 实际走 `KnowledgeCore.ingestSources()` 和 `knowledgeCore.search()`，记录 ingest latency、search p50/p95/QPS、命中数和缺失查询恢复。
- runner 复用 `data-connector-governance` 模拟外部 mirror sync，覆盖外部同步延迟、cursor 和 rate limit 失败注入；蒸馏吞吐以确定性摘要模拟记录，不触发模型成本。
- `GET /api/performance/capacity/targets` 和 `POST /api/performance/capacity/benchmark` 提供服务端调用面；Tool Management catalog 暴露 `pact.performance.capacity.*`。
- `npm run server:verify:performance-capacity` 验证容量目标、benchmark 输出、阈值门禁、失败注入、操作注册和 Tool Management 暴露。

效果：能回答“这个版本能支撑多少业务量”，而不是只回答“能跑”。

## P2 规模化缺口

### P2-01 知识蒸馏需要从“评估脚本”升级为“持续优化系统”

当前差距：已有工业蒸馏基准方向，但还需要版本化 prompt、技能 baseline、评估数据集、错误归因、回归趋势和人工审核闭环。

补全方式：把 `evaluateIndustrialDistillationGap()` 输出接入 `knowledge.evolution`，形成候选改进、人工批准、canary、promote/rollback。

当前实现入口：

- `server/platform/specialized/knowledge/invocation/knowledge-evolution-runtime/index.mjs` 在 `knowledgeSkillSet` 目标中输出 `pact.knowledge-distillation-optimization.v1` 优化报告。
- 优化报告记录 `promptVersion`、baseline skill/model/framework、候选 skill IDs、评估数据集版本和 case IDs、错误归因、历史指标趋势、canary deployment，以及是否需要人工审核。
- 失败评估会生成 `humanReview.status=queued` 和 review reasons；通过评估并发布 canary 时记录 `humanReview.required=false`，仍保留 promote/rollback 路径。
- `npm run server:verify:knowledge-distillation-optimization` 验证失败->人工审核、第二轮通过->canary、趋势对比、prompt/dataset 版本和持久化运行记录。

效果：蒸馏质量可以持续变好，而不是靠一次性调参。

### P2-02 插件/模块生态还缺 SDK 和模板

当前差距：mount 机制存在，但外部团队要写 parser、knowledgeBase、tool、skill 仍需要读很多内部代码。

补全方式：提供 `pact create-module`、contract test、示例模块、CI 模板、schema docs。

当前实现入口：

- `server/platform/common/module-manager/module-ecosystem/index.mjs` 定义 `pact.module-ecosystem.v1`，提供 `documentParser`、`analysis`、`knowledgeBase`、`vectorStore`、`graphStore`、`customMount`、`toolPackage`、`skillPackage` 模板。
- `node server/scripts/pact-create-module.mjs --template ...` 生成服务端模块脚手架，包含 manifest、示例 `index.mjs`、sample、contract test 脚本和 GitHub Actions CI 模板。
- `node server/scripts/pact-module-contract-test.mjs` 验证 mount factory、`reload/close`、sample extraction、postcommit hook 或 capability package manifest。
- `GET /api/modules/templates`、`POST /api/modules/plan`、`POST /api/modules/scaffold`、`POST /api/modules/contract-test` 提供服务端调用面；Tool Management 暴露 `pact.modules.*`。
- `npm run server:verify:module-ecosystem` 验证模板清单、脚手架生成、合同测试 CLI、能力包 manifest、操作注册和 Tool Management 暴露。

效果：外部知识库、工具、技能团队能按合同接入，减少核心团队重复造轮子。

### P2-03 工作空间共享还缺组织级治理

当前差距：设计强调团队共享，但企业内需要部门、项目、保密级别、外部协作者、复制/派生权限、保留期限。

补全方式：在共享模型中加入 organization/project/dataClass/retention/legalHold。

当前实现入口：

- `server/platform/specialized/agent/workspace-governance/index.mjs` 定义 `pact.workspace-governance.v1`，持久化 workspace policy、share grant 和 audit events。
- 工作空间策略包含 `organizationId`、`projectId`、`departmentId`、`dataClass`、`ownerSubjectIds`、`allowedSubjectIds`、`externalCollaboratorIds`、`allowedActions`、`copyPolicy`、`retention` 和 `legalHold`。
- 策略评估覆盖组织不匹配、外部协作者未列名、主体不在授权范围、dataClass clearance 不足、export/checkout 禁止、legalHold 阻断删除/清理、跨 workspace copy/share 的项目和审批约束。
- `GET /api/workspace-governance`、`POST /api/workspace-governance/policies`、`POST /api/workspace-governance/evaluate`、`POST /api/workspace-governance/share-grants` 提供服务端调用面；Tool Management 暴露 `pact.workspaceGovernance.*`。
- `workspace-contribution` 贡献模型也补齐 organization/project/dataClass/retention/legalHold/externalCollaboratorIds/copyPolicy 字段，使贡献资产可被组织治理策略约束。
- `npm run server:verify:workspace-governance` 验证策略持久化、跨组织拒绝、外部协作者拒绝、密级 clearance、legalHold、retention obligation、跨项目复制审批、共享授权、操作注册和 Tool Management 暴露。

效果：既保持共享协作，又能满足企业数据治理。

### P2-04 多模态资产治理不足

当前差距：图片、表格、OCR、视觉模型、图文流导出已有方向，但缺少统一 asset lineage、视觉模型版本、坐标锚点和重解析策略。

补全方式：定义 `pact.asset-lineage.v1`，资产必须能追溯 raw object、page/slide、bbox、parser/model/version。

当前实现入口：

- `server/platform/specialized/knowledge/assets/asset-lineage/index.mjs` 定义 `pact.asset-lineage.v1`，持久化多模态资产血缘记录、派生链、重解析计划和审计事件。
- lineage record 覆盖 `assetId`、`assetType`、`rawObject.objectId/uri/contentHash/mediaType`、`sourceAnchor.page/slideIndex/bbox/sourceRange`、`parser.id/version`、`visualModel.id/version/promptVersion`、`ocr.id/version`、`derivedFromAssetIds`、`producedBy` 和 `reparsePolicy`。
- `GET /api/asset-lineage`、`POST /api/asset-lineage/records`、`POST /api/asset-lineage/trace`、`POST /api/asset-lineage/reparse-plan` 提供服务端调用面；Tool Management 暴露 `pact.assetLineage.*`。
- `npm run server:verify:asset-lineage` 验证 image/table lineage、raw object/page/bbox/parser/model/OCR 字段、派生链 trace、parser/model/source hash 变化触发重解析候选、操作注册和 Tool Management 暴露。

效果：图文穿插蒸馏和 PDF/PPT 还原可以被审计和重放。

## P3 竞争力增强项

### P3-01 提供资产价值管理驾驶舱和 executive report

补全方式：管理驾驶舱优先，第一版突出资产价值：资产沉淀、贡献者、复用路径、授权请求、使用成功率、回滚热点和高价值受限资产。随后从 production readiness、eval、trace、benchmark 自动生成管理层报告。

当前实现入口：

- `server/platform/common/production-readiness/executive-report.mjs` 定义 `pact.executive-report.v1`，生成并持久化服务端管理层报告。
- 报告聚合 production health、workspace contribution reports、capacity summary、evaluation summary 和 trace summary，输出 `executiveSummary`、`productionReadiness`、`assetValue`、`qualityAndEvaluation`、`capacityAndCost`、`traceAndSecurity` 和 `risks`。
- 资产价值统计覆盖 accepted/usage/unique workspace adoption、permission request/grant、rollback、asset type、contributor、top reusable assets、high-demand restricted assets、rollback hotspots 和 under-maintained assets。
- `GET /api/executive-report`、`POST /api/executive-report/preview`、`POST /api/executive-report/generate` 提供服务端调用面；Tool Management 暴露 `pact.executiveReport.*`。
- `npm run server:verify:executive-report` 验证生产健康输入、资产贡献报告聚合、风险生成、报告持久化、操作注册和 Tool Management 暴露。

效果：让管理者看到公共空间创造了什么价值、哪些资产值得推广、哪些资产需要治理，并减少阶段评审的人工汇总。

### P3-02 提供架构图和运行状态联动

补全方式：让 `docs/Architecture.md`、`docs/WORKSPACE-ASSET-GOVERNANCE.md` 和 `docs/KNOWLEDGE-GOVERNANCE.md` 中的核心节点能链接到当前实现路径、健康状态、门禁结果。

当前实现入口：

- `server/platform/common/production-readiness/architecture-live-map.mjs` 定义 `pact.architecture-live-map.v1`，把核心架构节点映射到设计文档、服务端实现路径和 production readiness gate。
- 节点覆盖 workspace asset governance、AgentLibrary access、knowledge core、module ecosystem、asset lineage 和 production readiness。
- `GET /api/architecture/live-map` 提供服务端调用面；Tool Management 暴露 `pact.architecture.liveMap`。
- `npm run server:verify:architecture-live-map` 验证文档/实现路径存在、门禁状态联动、操作注册和 Tool Management 暴露。

效果：架构图从静态设计变成活文档。

### P3-03 提供样例业务包

补全方式：准备邮件、PDF、PPT、Markdown 项目、外部知识库 docker compose 的示例包。

当前实现入口：

- `server/platform/common/production-readiness/sample-business-pack.mjs` 定义 `pact.sample-business-pack.v1`，内置 `enterprise-knowledge-pilot` 样例业务包。
- 样例包可物化 EML 邮件线程、PDF 安全评审、PPTX 路线图、Markdown 项目文档和外部知识库 `docker-compose.yml`。
- manifest 提供 `assets`、`ingestPlan`、`externalServices`、内容 `sha256` 和 parser route，便于新成员直接对照导入链路。
- `GET /api/sample-business-packs`、`GET /api/sample-business-packs/:packId`、`POST /api/sample-business-packs/materialize` 提供服务端调用面；Tool Management 暴露 `pact.sampleBusinessPack.*`。
- `npm run server:verify:sample-business-pack` 验证样例包 manifest、真实文件物化、PDF/PPTX/compose 内容、路径约束、操作注册和 Tool Management 暴露。

效果：新成员和业务方可以快速理解系统能力边界。

## 建议决策顺序

1. 先决策 P0-01：是否建立统一生产验收门禁。没有这个，其它 P0 很难持续证明。
2. 再决策 P0-02 / P0-06：是否把可观测和评估作为生产底座，而不是后补工具。
3. 决策 P0-03：是否引入 durable workflow 语义，或者先用自研 runner 对齐语义。
4. 决策 P0-04 / P0-05：先把外部知识库和真实文档解析跑成硬基准。
5. 决策 P0-07 / P0-08：安全审计与恢复演练是否作为上线阻断项。
6. P1 之后才适合扩展更多工具、技能、连接器和高级 UI。

## 当前上生产判断

如果“生产”指内部单人或小团队试用、可接受人工修复、数据可重建：可以试点，但必须标注 alpha/beta。

如果“生产”指企业内多团队协作、真实敏感文档、外部知识库接入、可审计汇报、可恢复升级：当前不满足。至少 P0-01 到 P0-08 需要关闭，且必须有一份生产验收报告。

如果“工业领先”指在项目 Markdown、邮件全量、PDF/PPT 图文材料、外部知识库一致性、RAG/蒸馏/Agent 评估上稳定优于或不弱于成熟 baseline：当前不能宣称。必须用真实基准和持续评估证明。
