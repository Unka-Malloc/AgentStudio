# Pact 知识蒸馏进展台账

状态：当前进展记录
日期：2026-06-02
范围：`external.knowledge.distillation` 独立服务、平台代理、管控台工作台、内部旧实现迁移、验证门禁

---

## 1. 文档定位

本文只记录当前知识蒸馏工作的完成度，不替代设计方案。

事实源：

- 设计主线：`docs/KNOWLEDGE-DISTILLATION-EVOLUTION-PLAN.md`
- 历史审计：`docs/KNOWLEDGE-DISTILLATION-AUDIT.md`
- 实现基线：`docs/KNOWLEDGE-DISTILLATION-IMPLEMENTATION-BASELINE.md`
- 外部服务：`external-services/knowledge-distillation-service/`
- 验证门禁：`server/scripts/verify-*knowledge*distillation*.mjs`

---

## 2. 总体状态

| 事项 | 当前状态 | 说明 |
| --- | --- | --- |
| 维护面 | 已迁移 | 唯一维护面为 `external.knowledge.distillation`。旧 `knowledge.distillation.*` 和 `knowledge.distillation.workbench.*` 不再承接算法优化。 |
| 内部旧实现 | 已下线到迁移壳 | 内部 runtime/workbench 目录已从维护路径移除；旧操作只保留 `410` 迁移报文，且不暴露给 Tool Management 或授权 kernel。 |
| 独立服务 | 已落地 baseline | `external-services/knowledge-distillation-service/server.mjs` 提供 HTTP API、容器镜像、运行时健康检查、任务队列和导出。 |
| 文件路由 | 已配置化 | 路由表来自 `format-routes.json`，当前 24 类格式族、141 个扩展名、132 个 MIME 类型。 |
| 解析策略 | 已配置化 | 策略表来自 `parser-strategies.json`，当前 146 个策略。 |
| 格式转换 | 已配置化 | `format-conversion-profiles.json` 覆盖 PDF、Word、PowerPoint、Visio、Excel、Markdown、OpenDocument 7 类专业转换 profile。 |
| 模型蒸馏 | 已强制真实模型入口 | `model-distillation-profiles.json` 当前 1 个 profile；成功蒸馏要求真实 Agent Gateway 和 `modelAlias`，不再生成伪成功 fallback。 |
| 业界参考 | 已建立本地对标 | 参考 RAGFlow、MinerU、Docling、LlamaIndex、Marker、GraphRAG、Haystack、Unstructured 共 8 个框架。 |
| 人类/智能体响应 | 已分离 | `console-summary-json` 面向管控台，`agent-message-json`、evidence、format manifest 等面向智能体/API。 |
| 大文件 | 部分落地 | 已支持 file ref、JSONL manifest、归档递归、结构包选择读取、后台队列；断点续传上传链路仍需复用成熟组件补齐。 |
| 全格式专业解析 | 部分落地 | 常见办公文档 baseline 已有，但 PDF 视觉版面、多模态图片理解、iWork 专业解析仍未完成。 |
| 工业领先算法 | 部分落地 | 已有分类、grounding、图证据、项目收敛、增量计划；embedding、评估闭环、热插拔组件、学习型 ranker 仍需增强。 |

---

## 3. 已完成事项

### 3.1 服务边界和命名

| 完成项 | 落地位置 | 结果 |
| --- | --- | --- |
| 外部能力统一命名 | `external.knowledge.distillation` | 与 `external.*` 命名约定一致，可与 `external.icloud`、`external.mail` 等未来能力并列。 |
| 外部 HTTP API | `external-services/knowledge-distillation-service/server.mjs` | 暴露 health、capabilities、runtime health、runs、cancel、evidence query、project evidence query、artifact export。 |
| 平台 API 代理 | `/api/external/knowledge/distillation/...` | 平台通过外部服务 API 注册和 Tool Management 暴露能力。 |
| 智能体可访问 | Tool Management catalog、authorization kernel | 外部操作暴露给工具目录；内部废弃操作不再暴露给智能体。 |
| 内部旧入口迁移 | operation registry、console operation executor | 旧操作返回机器可读迁移报文，指向 `external.knowledge.distillation`。 |

### 3.2 独立部署和脱水

| 完成项 | 落地位置 | 结果 |
| --- | --- | --- |
| 独立服务目录 | `external-services/knowledge-distillation-service/` | 包含 `server.mjs`、`Dockerfile`、README 和四类配置表。 |
| 单机后台任务队列 | `single-node-background-run-queue.v1` | 支持 `queued`、`running`、`completed`、`failed`、`canceled`。 |
| 大输入自动排队 | `large-input-auto-queue.v1` | 对大请求体、大 file ref、目录、manifest 自动转异步。 |
| 容器运行时 | Dockerfile | 安装 Poppler、Tesseract、Java/Tika、7zip，覆盖 PDF、OCR、legacy Office 和归档基线。 |
| 独立服务门禁 | `verify-knowledge-distillation-standalone-service.mjs` | 检查服务端独立门禁、配置注册表、workflow 函数、server-only package，不读取 `client-gui`。 |

### 3.3 文件输入和路由

| 完成项 | 当前能力 |
| --- | --- |
| 输入方式 | direct text、base64、mounted file ref、JSONL manifest、目录、归档包、Office/OpenDocument/EPUB 结构包。 |
| 路由顺序 | 先 content signature、扩展名、MIME、source kind、text fallback，再选择 parser chain。 |
| 路由配置 | `format-routes.json` 是单例路由表，避免硬编码格式分流。 |
| 支持格式族 | PDF、Word、PowerPoint、Visio、Spreadsheet、OpenDocument、EPUB、Email、Image、Markdown、Plain Text、Markup、Config、JSON、Notebook、Diff、Calendar、Transcript、Financial Report、Audio、Source Code、Diagram、Archive、Directory。 |
| PDF 子类型 | 可输出 text/scanned/font-broken/image-heavy/encrypted/empty-or-unknown 等 subtype 和风险标记。 |
| iWork | 已明确不做主线优化；暂按目录/包递归路由，后续 TODO。 |

### 3.4 解析策略和文档模型

| 完成项 | 当前能力 |
| --- | --- |
| 策略注册表 | `parser-strategies.json` 管理 146 个 parser strategy，包含 route binding、运行时依赖和输入输出合同。 |
| 解析输出合同 | `pact.normalized-distillation-documents.v1` 作为解析模块输出。 |
| 算法输入合同 | `external-kd.algorithm-input.normalized-documents.v1` 作为蒸馏算法唯一输入。 |
| Parser trace | 每个文档记录 parser stages、可用/不可用运行时、fallback 和风险。 |
| Element model | `document-element-model.v1` 保留 heading、table、cell、code、link、image、chart、comment、form、shape 等元素引用。 |
| By-title windowing | `element-aware-by-title-windowing.v1` 保留章节、表格、代码和结构单元边界。 |

### 3.5 办公文档专业适配

| 格式 | 已落地 profile | 已保留的关键证据 |
| --- | --- | --- |
| PDF | `pdf.text-layout-ocr-route` | 页序、基础文本几何、URI link、outline/bookmark、AcroForm/widget、OCR/Tika 降级状态。 |
| Word | `wordprocessingml-paragraph-style-route` | 标题/段落样式、编号、表格、页眉页脚、content controls、bookmarks、超链接、图片、图表、批注、脚注、尾注、修订。 |
| PowerPoint | `presentationml-slide-route` | slide 顺序、layout/master、shape id/name、placeholder、bbox、表格、超链接、图片、图表、speaker notes、评论。 |
| Visio | `visio-opc-page-shape-route` | page、shape、connector、文本和几何引用；legacy VSD 走 Tika fallback。 |
| Excel | `spreadsheetml-sheet-row-cell-route` | sheet、defined name、named range、print area、单元格坐标、merged cell、comment、date serial、formula、hyperlink、chart。 |
| Markdown | `markdown-block-element-route` | frontmatter、heading tree、table、code fence、blockquote、link、image。 |
| OpenDocument | `opendocument-content-xml-route` | content order、table cell、hyperlink。 |

### 3.6 蒸馏工作流

当前统一入口是：

| 顺序 | 函数 | 作用 |
| ---: | --- | --- |
| 1 | `runKnowledgeDistillationWorkflow` | 统一工作流入口。 |
| 2 | `runDistillationWorkflow` | 执行 DistillationWorkflow。 |
| 3 | `evaluateDistillationWorkflow` | 对工作流结果做质量和失败评估。 |
| 4 | `composeDistillationResult` | 组合人类/智能体/API 结果和导出引用。 |

`runDistillationWorkflow` 当前分为：

| 顺序 | 函数 | 作用 |
| ---: | --- | --- |
| 1 | `initializeDistillationWorkflow` | 归一化 run、query、response profile、workflowScope。 |
| 2 | `prepareDistillationAlgorithmInput` | 调用文档解析模块并绑定算法输入合同。 |
| 3 | `runDistillationAlgorithmWorkflow` | 执行分类、收敛、grounding、增量和图证据。 |
| 4 | `runModelDistillationModule` | 调用真实模型网关并校验机器可读输出。 |

`runDistillationAlgorithmWorkflow` 当前分为：

| 顺序 | 函数 | 作用 |
| ---: | --- | --- |
| 1 | `assertDistillationAlgorithmInputContract` | 禁止 parser payload 泄漏进算法核心。 |
| 2 | `filterDistillationInputByTime` | 按时间条件过滤证据。 |
| 3 | `selectDistillationWorkflowScope` | 根据 `document/corpus/project` enum 选择工作流范围。 |
| 4 | `buildDistillationCorpusPlan` | 构建 corpus、窗口和统计信息。 |
| 5 | `buildDistillationRoutePlan` | 汇总 route plan。 |
| 6 | `buildDistillationDocumentSet` | 形成算法可处理文档集合。 |
| 7 | `buildDistillationClassification` | 做多主题分类和垃圾池隔离。 |
| 8 | `buildDistillationConvergence` | 做项目级层级收敛。 |
| 9 | `buildDistillationGrounding` | 做 claim-evidence top-k 和冲突检查。 |
| 10 | `buildDistillationIncrementalPlan` | 生成项目快照和增量复用计划。 |
| 11 | `buildDistillationGraphEvidence` | 生成 graph-lite evidence pack。 |
| 12 | `composeDistillationWorkflowState` | 组合算法工作流状态。 |

### 3.7 算法和证据

| 完成项 | 当前能力 |
| --- | --- |
| 分类蒸馏 | `hashing_embedding_window_community_classification_v3`，可区分多主题、弱证据垃圾池、低耦合高内聚指标。 |
| 项目收敛 | `hierarchical-domain-topic-project-convergence.v3`，包含 domain reports、community reports、cross-domain links、agent query index。 |
| Grounding | `claim-evidence-topk-conflict-gating.v2`，每个候选 claim 绑定 top-k evidence 和冲突证据。 |
| 图证据 | `graph-lite-entity-relationship-evidence-pack.v1`，输出 text units、entities、relationships、covariates、communities、community reports。 |
| 增量计划 | `project-snapshot-incremental-convergence.v1`，按 project/workspace/repository 生成快照和复用计划。 |
| 时间过滤 | 支持 `timeFilter.from/to/timeField/confidenceMin/excludeWeakEvidence/includeUnknownTime`。 |

### 3.8 响应和导出

| Artifact | 面向对象 | 当前状态 |
| --- | --- | --- |
| `portable-markdown` | 人类 | 已支持。 |
| `portable-docx` | 人类 | 已支持 OpenXML 包结构、自检和基本可打开性门禁。 |
| `console-summary-json` | 管控台 | 已支持，隐藏 parser trace 和窗口噪声。 |
| `agent-message-json` | 智能体 | 已支持机器可读分类、证据、时间过滤、模型蒸馏和重试信息。 |
| `result-json` | API | 已支持完整 run record。 |
| `project-snapshot-json` | 智能体/API | 已支持项目快照和增量 diff。 |
| `evidence-pack-json` | 智能体 | 已支持 graph-lite 证据包。 |
| `format-conversion-plan-json` | 智能体/API | 已支持专业格式转换计划。 |
| `professional-format-manifest-json` | 智能体 | 已支持格式适配 manifest。 |
| `reference-gap-report-json` | API/审计 | 已支持参考框架吸收情况和 open gaps。 |
| `component-pipeline-graph-json` | 智能体/API | 本地已落地，待提交；暴露组件图、配置源、模块边界、节点、边和 ranker。 |
| `workspace-package-zip` | 交付包 | 已支持 Markdown、DOCX、JSON、snapshot、evidence、manifest、hash/size 校验。 |

### 3.9 管控台和下载链路

| 完成项 | 当前能力 |
| --- | --- |
| 窄屏结果卡片 | 已调整为随外部容器伸缩。 |
| 下载链接 | 已改为普通 `/api/...` 链路，不走 bridge fetch 下载。 |
| 文件大小显示 | 蒸馏结果列表显示下载文件大小。 |
| 进度条 | 下方状态卡片已取消，步骤名称直接标注到线段下方。 |
| workflowScope | 管控台创建任务必须显式传 `document/corpus/project`，避免单文件和项目工作流混用。 |

### 3.10 业界参考和吸收门禁

| 完成项 | 当前能力 |
| --- | --- |
| 本地参考仓库 | `build/reference-frameworks/knowledge-distillation/`。 |
| 参考 manifest | `reference-frameworks.json` 固定 8 个框架和 commit。 |
| 同步/审计命令 | `server:external-kd:references`、`server:external-kd:sync-references`、`server:verify:external-knowledge-distillation-references`。 |
| 工业 benchmark | `pact.external-knowledge-distillation.industrial-benchmark.v1`。 |
| 已吸收模式 | route-first、chunk/window、GraphRAG-style evidence、LlamaIndex node metadata、Haystack pipeline traces、Docling/Unstructured element families、Marker-style Markdown/JSON/DOCX packaging。 |
| 本地新增待提交 | Haystack/LlamaIndex 风格 component pipeline graph、component registry、ranker 节点和配置源证据。 |

---

## 4. 尚未完成和 TODO

### 4.1 P0：主线仍需补齐

| TODO | 原因 | 目标 |
| --- | --- | --- |
| 上传链路复用成熟开源组件 | 当前服务已支持 file ref/manifest/队列，但上传本身仍未按成熟断点续传组件落地。 | 文件上传到独立临时目录，后端立即创建待解析任务并进入队列；尽量复用平台上传能力。 |
| 全尺寸文件闭环 | 当前是大文件 baseline，不等于所有文件大小都已被压力证明。 | 建立分块上传、流式解析、窗口蒸馏、资源上限、超大样本回归。 |
| 格式 openability 回归集 | DOCX/ZIP 已有自检，但需要扩大到真实 Word、macOS Quick Look、Office/LibreOffice 打开性样本。 | 每类导出产物都有真实打开性门禁。 |
| PDF 视觉版面解析 | 当前基础文本、链接、outline、表单和 OCR baseline 已有。 | 接入版面阅读顺序、bbox、图表/表格结构、扫描件多模态 fallback。 |
| 多模态图片理解 | 当前 OCR baseline 已有，但不等于图片语义理解。 | 对图表、截图、流程图和表单图片建立 multimodal parser。 |
| 真实评估闭环 | 当前有 deterministic quality report 和 reference benchmark。 | 引入 DeepEval/G-Eval/Ragas/Phoenix 类评估思路或同等真实模型评估闭环。 |

### 4.2 P1：算法增强

| TODO | 当前 baseline | 目标 |
| --- | --- | --- |
| embedding 质量升级 | 128 维 hashing semantic baseline。 | 接入可配置 embedding provider、cosine 聚类、近邻索引和漂移监控。 |
| 分类蒸馏增强 | 已支持多组、垃圾池、cohesion/separation。 | 对多主题/弱相关资料建立更强主题树、跨主题冲突和重叠主题处理。 |
| learned evidence ranker | 当前是语义/词法/极性组合 ranker。 | 引入可评估、可配置、可替换的 ranker，支持热插拔。 |
| 项目级长期记忆 | 当前有 project snapshot 和 multi-run evidence query。 | 增加持久图存储 adapter、长期 domain graph、跨 run 学习型排序。 |
| 模型输出使用 | 当前模型输出进入 `modelDistillation`。 | 把模型输出纳入 claim 改写、候选排序、风险解释，但不能替代 evidence gate。 |

### 4.3 P1：解析和格式转换

| TODO | 当前 baseline | 目标 |
| --- | --- | --- |
| legacy Office 深度结构 | DOC/PPT/XLS 主要依赖 Tika fallback。 | 如业务需要，接入更强 legacy parser 或转换链。 |
| 表格语义理解 | 已保留 sheet/cell/formula/date/chart refs。 | 增加表头推断、区域语义、透视表/公式依赖和财务时间线。 |
| PowerPoint 视觉阅读顺序 | 已保留 slide/shape/layout 等结构 refs。 | 增加视觉排序、层级遮挡、组合形状和图表文本语义。 |
| 邮件专业解析 | 已有 EML/MSG/MBOX 和附件递归。 | 强化 MIME/RFC 2047、quoted-printable/base64、charset、threading 和权限字段。 |
| iWork | 当前明确跳过优化。 | TODO：如纳入主线，单独建立 `.pages/.numbers/.key` 专业策略和样本门禁。 |

### 4.4 P1：平台解耦和迁移

| TODO | 当前状态 | 目标 |
| --- | --- | --- |
| 迁移壳最终移除 | 旧内部 operation 仍保留 deprecated shim。 | 所有调用方迁移后删除 shim，只保留外部服务。 |
| 上传能力和 KD 任务队列统一 | KD 服务已有队列，平台上传能力另有链路。 | 通过成熟上传组件或平台 upload session 统一进入临时目录和 parse queue。 |
| Feature Profile 依赖收敛 | 已有 standalone service gate。 | 独立服务创建门禁必须证明平台核心组件和 KD 所需组件均可剥离，不携带 client/web 模块。 |
| 外部组件热插拔 | 当前是配置化 registry 和 component graph。 | 解析器、ranker、format converter 支持外部 mount/adapter 热切换。 |

### 4.5 P2：产品和可观测性

| TODO | 当前状态 | 目标 |
| --- | --- | --- |
| 任务进度细化 | UI 已有阶段显示。 | 队列、上传、解析、蒸馏、转换、导出都输出稳定进度事件和耗时指标。 |
| 错误解释 | 已有机器可读错误码。 | 管控台显示人类可理解的原因、建议动作和可重试路径。 |
| 成本和模型调用指标 | 已记录模型网关调用摘要。 | token、延迟、失败率、分组调用、重试、修复调用进入审计和优化报告。 |
| 样本集治理 | 有验证脚本和参考框架。 | 建立真实 PDF/Office/邮件/项目目录样本集，按格式和故障类型分层。 |

---

## 5. 当前验证门禁

| 门禁 | 覆盖内容 | 当前状态 |
| --- | --- | --- |
| `npm run server:verify:external-knowledge-distillation` | 外部服务 API、真实模型调用、路由、解析、导出、workspace package、agent/console 分离。 | 本地已通过。 |
| `npm run server:verify:external-knowledge-distillation-container` | Docker 镜像、Poppler/Tesseract/Tika/7z、容器内格式解析和导出。 | 本地已通过。 |
| `npm run server:verify:knowledge-distillation-standalone-service` | 独立服务门禁、配置表、workflow 函数、server-only 脱水、不读 `client-gui`。 | 本地已通过。 |
| `npm run server:verify:knowledge-industrial-distillation` | 业界参考吸收矩阵、内部旧目录移除、工业 benchmark。 | 本地已通过。 |
| `npm run server:external-kd:references -- --json --require-present --require-commit-match` | 本地参考框架存在且 commit 匹配。 | 本地已通过。 |
| `npm run server:verify:external-service-api-registration` | 外部服务操作注册、Tool Management 暴露、内部旧能力不暴露。 | 本地已通过。 |

---

## 6. 下一步批次建议

| 批次 | 内容 | 退出条件 |
| --- | --- | --- |
| A | 提交 component pipeline graph 批次 | `component-pipeline-graph-json` 进入 artifacts、workspace package、capabilities、benchmark 和容器门禁。 |
| B | 上传链路主线 | 成熟上传组件或平台 upload session 到临时目录，后端立即创建 queued parse/distill job。 |
| C | PDF/Office 样本集 | 增加真实 PDF、DOCX、PPTX、XLSX、邮件、目录项目样本，验证 openability 和证据保真。 |
| D | Embedding 和评估升级 | 可配置 embedding provider、评估数据集、LLM judge 或同等模型评估闭环。 |
| E | 内部迁移壳删除 | 确认所有调用方迁移到 `external.knowledge.distillation` 后移除 deprecated shims。 |

---

## 7. 当前结论

知识蒸馏已经从旧的内部“解析加总结”迁移为外部独立服务 baseline：文件先路由再解析，解析与算法核心通过合同隔离，模型蒸馏必须真实调用，结果区分管控台和智能体，并提供项目收敛、图证据和专业格式导出。

尚未完成的关键部分集中在四处：成熟上传链路、全尺寸压力验证、PDF/多模态/legacy 文档深度解析、以及真实评估和更强 embedding/ranker。后续优化应继续只进入 `external.knowledge.distillation`，内部旧实现只做迁移和删除。
