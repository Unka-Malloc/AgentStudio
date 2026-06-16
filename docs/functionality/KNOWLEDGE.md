# Knowledge

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Knowledge storage, retrieval, evidence, rules, maintenance, evolution, Playbooks, Skills aliases, and exports.
- Staleness check: Checked against `server/platform/specialized/knowledge/`, `server/protocols/knowledge/README.md`, knowledge operations, Tool Management knowledge tools, and verification scripts on 2026-06-16.

## 模块边界

本模块负责 KnowledgeCore、检索、证据、资产、规则、维护、演化、Playbook/Skill 运行态和知识导出。原始上传与 job 归 `INGESTION-JOBS`，外部知识蒸馏服务归 `EXTERNAL-SERVICES`。

## 治理口径

Knowledge 是 Pact 的中间层治理：上游知识库太粗，下游本地智能体太细，因此需要权限精加工。AgentLibrary 像图书馆，source-level governance 像门禁卡，层级像楼层和书架；共享的知识以 Evidence Pack、evidence pack、knowledgeAccessReceipt、loanRecord 和借阅登记表达。终端贡献与专家知识包括 `goldenRule`、`expertOpinion` 和贡献排行榜。智能体知识权限第一原则要求知识权限不能合并成一个“可访问”布尔值，必须区分 `controlledView`、`checkoutAllowed`、动态解析与预算、外部知识库再授权和知识维护闭环。演示场景：上游知识库 A/B 权限再授权必须在管控台、对话页面和权限错误中保持一致。

## 功能项 KN-01 KnowledgeCore 存储

| 项 | 设计 |
| --- | --- |
| 目标 | 保存 canonical knowledge records、assets、evidence、graph、chunks 和 source metadata。 |
| 输入 | 解析结果、人工整理、外部知识后端 mirror、维护任务。 |
| 处理 | KnowledgeCore 是默认本地事实源；外部后端只能作为 mount 或 adapter，不替代授权边界。 |
| 输出 | source list、asset refs、evidence packs、graph、Markdown render 和 DOCX export。 |
| 错误 | raw evidence 不被 agent 直接改写；结构化变更必须有 review 或 scoped tool。 |
| 验证 | `npm run server:verify:knowledge`, `npm run server:verify:source-evidence`。 |

## 功能项 KN-02 分层检索

| 项 | 设计 |
| --- | --- |
| 目标 | 智能体检索先选层级分支，再取 item/evidence/graph，避免盲搜碎片。 |
| 输入 | query、filters、learningEnabled、explain、tool grant。 |
| 处理 | `knowledge.agent_skill.plan` 或 Tool Management `pact.agentLibrary.search` 生成计划和 branch。 |
| 输出 | hierarchy.selected、items、evidenceRefs、Markdown 或 graph expansion。 |
| 错误 | branch 过窄先扩大层级，不直接跳到任意 chunk。 |
| 验证 | `npm run server:verify:knowledge-hierarchy`, `npm run server:verify:agent-knowledge-tools`。 |

## 功能项 KN-03 证据与导出

| 项 | 设计 |
| --- | --- |
| 目标 | 提供 evidence pack、asset、Markdown render、DOCX export 和 dossier export。 |
| 输入 | evidence id、asset id、job/document id、export format、access decision。 |
| 处理 | 读取前经过 AgentLibrary access 或 knowledge scope 裁决；导出物生成受管 artifact/ref。 |
| 输出 | Markdown、DOCX、HTML/PDF 目标格式、asset URL 或 export artifact。 |
| 错误 | 未授权 evidence 不泄露存在性；二进制或大响应写为 asset/ref。 |
| 验证 | `npm run server:verify:knowledge-docx-export`, `npm run server:verify:knowledge-transformation`。 |

## 功能项 KN-04 知识规则

| 项 | 设计 |
| --- | --- |
| 目标 | 管理 email rules、taxonomy、expert vocabulary、golden rules、source search rules 和 import file types。 |
| 输入 | 控制台 JSON、规则版本、维护任务、默认配置。 |
| 处理 | 写入前校验 schema 和版本；敏感业务规则不在对话或日志中泄露原始 secret。 |
| 输出 | 生效规则、版本列表、规则作者反馈和维护结果。 |
| 错误 | 规则变更导致解析/合并行为变化时必须保留 before/after 样本。 |
| 验证 | `npm run server:verify:knowledge-rule-authoring`, `npm run server:verify:import-file-types`。 |

## 功能项 KN-05 维护、学习与演化

| 项 | 设计 |
| --- | --- |
| 目标 | 支持 learning jobs、quality validation、retrieval profile tuning、suggestion review、deployment/canary/rollback。 |
| 输入 | feedback、evaluation cases、quality gates、deployment policy。 |
| 处理 | Evolution runtime 协调 KnowledgeCore、evaluation、distillation、GoldenRule 和 Playbook runtime。 |
| 输出 | suggestions、evaluation runs、deployments、rollback records、learning health。 |
| 错误 | 高影响 reindex、reembed、orphan deletion 需要 maintain/admin scope 和确认。 |
| 验证 | `npm run server:verify:knowledge-learning`, `npm run server:verify:knowledge-evolution-loop`。 |

## 功能项 KN-06 外部知识蒸馏验收流程

| 项 | 设计 |
| --- | --- |
| 目标 | 对 `external.knowledge.distillation` 的工业化输出建立验收口径。 |
| 输入 | RAGFlow、MinerU、Docling、LlamaIndex、GraphRAG 等参考框架能力矩阵与服务输出。 |
| 处理 | 验收 routePlan、graphEvidence、`human-agent-response-profile-separation.v1` 和 `office-document-professional-adaptation.v1`。 |
| 输出 | benchmark report、framework comparison、professional adaptation evidence。 |
| 错误 | 内置 knowledge-distillation-runtime 不再作为当前实现入口。 |
| 验证 | `npm run server:verify:knowledge-industrial-distillation`。 |

## 功能项 KN-07 Playbook / KnowledgeSkill

| 项 | 设计 |
| --- | --- |
| 目标 | 将 reusable evidence-backed guidance 作为运行态 Playbook/KnowledgeSkill 管理。 |
| 输入 | corpus-backed generation、proposal、framework config、deployment action。 |
| 处理 | Published skill/playbook 需要质量门禁和 review；legacy `knowledge.skills.*` 可作为 alias。 |
| 输出 | list/get/generate/propose/resolve/evaluation/deployment/rollback。 |
| 错误 | Skill 不保存 canonical fact；事实仍在 knowledge/evidence/graph/asset 中。 |
| 验证 | `npm run server:verify:knowledge-skillization`, `npm run server:verify:tool-skill-management`。 |
