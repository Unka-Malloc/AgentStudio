# Knowledge Distillation Audit

审计日期：2026-05-26
范围：已删除的内部知识蒸馏 runtime/workbench 历史审计；当前维护面已迁移到 `external.knowledge.distillation`

---

## 总体评价

该审计结论已用于下线内部实现。当前项目不再维护 `knowledge-distillation-runtime` 或 `knowledge-distillation-workbench`，后续算法、解析、分类、项目收敛和导出能力只进入 `external-services/knowledge-distillation-service/`。

---

## 一、模块清单

| 模块 | 文件 | 行数 | 职责 |
|------|------|------|------|
| Legacy Distillation Runtime | `knowledge-distillation-runtime/index.mjs` | removed | 已删除，不再维护 |
| Legacy Distillation Workbench | `knowledge-distillation-workbench/index.mjs` | removed | 已删除，不再维护 |
| External Service | `external-services/knowledge-distillation-service/server.mjs` | current | 独立部署知识蒸馏主线 |
| External Benchmark CLI | `scripts/knowledge-distillation-industrial-benchmark.mjs` | current | 外部服务参考框架对比入口 |

---

## 二、5 阶段管线实际行为

| 阶段 | 名称 | 实际做什么 | 是否调 LLM |
|------|------|-----------|-----------|
| 1 | Raw Format Conversion | 只报告已处理的文件，不做转换 | 否 |
| 2 | Normalized Corpus | 只列出已归一化的 DOCX/YAML，不处理 | 否 |
| 3 | Project Dossier | 所有文档按时间倒序字符串拼接成一个巨大 Markdown | 否 |
| 4 | Knowledge Index | 只读视图：列出 section→block→asset→evidence 映射 | 否 |
| 5 | Distillation | 4 次 model call：batch extract → cluster name → distill skill → review | 条件式 |

---

## 三、致命问题

### 3.1 模型未接入时输出不可信

`model-decision-runtime` 的三个确定性 fallback 极为简陋：

```
batch extraction:
  → 串联所有文档的 "title：前240字符"   (line 590-617)

skill distillation:
  → 原样返回 fallbackSkill，附注 "deterministic fallback; no model output was used"   (line 571-588)

cluster naming:
  → 取 top 4 关键词拼在一起   (line 653-664)
```

致命的是：**产物结构和真实 LLM 输出完全一样**。portable document、Skill candidate、quality report 在 fallback 模式下与模型输出模式拥有相同的 JSON schema，消费者无法区分"这是 LLM 提炼的"和"这是空壳拼接的"。虽然 `audit` 字段记录了 `usedModel: false`，但非技术用户不会看这个。

### 3.2 聚类算法是玩具级别

- 使用 raw Jaccard similarity + regex tokenizer（`/[\p{L}\p{N}_-]+/gu`），不做 embedding
- Raw corpus 模式下**所有文档强制归入一个 cluster**（`clusterRawCorpusItems`, line 850-866）
- 多主题项目产出单一巨无霸蒸馏文档，无法区分话题

### 3.3 分批策略只数"字符数"

- `buildRawCorpusBatchPlan`（line 388）固定 24K 字符上限
- 不考虑文档边界、token 数、语义连贯性
- 多文档批内按 `budget / docCount` 均分——随时在某句话中间切断

### 3.4 证据水合是 silent failure

`hydrateEvidenceItemsFromPacks`（line 1664）在 `getEvidence` 失败时悄悄跳过，不产生任何警告或指标。蒸馏管线无法知道"其实有一批证据没加载到"。

---

## 四、与 KNOWLEDGE-GOVERNANCE.md 的差距

| 文档承诺 | 实现状态 |
|---------|---------|
| Evidence Pack 含 permissionScope / accessMode / checkoutPolicy / withheldCounts / maintenanceHints / backendTrace | 全部缺失 |
| 借阅登记 knowledgeAccessReceipt / loanRecord | 零实现 |
| 权限颗粒度到 source / document / section / block / field / table cell / image / attachment | 无字段级控制 |
| 被禁止内容在所有出口（search / evidence / context bundle / export / artifact / distillation / memory write）被同一策略拦截 | 蒸馏路径无任何拦截逻辑 |
| 外部知识库再授权（upstream → derivedKnowledgeSpace → authorizationOverlay） | 蒸馏路径零实现 |
| 工业级评估参考 DeepEval / G-Eval rubric | 实际只做字符串 marker 匹配 |
| 蒸馏输出只能作为背景，不能替代 canonical evidence | 结构上有 `modelOutputIsCandidateOnly: true` 标记，但无强制机制 |

---

## 五、具体质量问题列表

| # | 位置 | 问题 |
|---|------|------|
| 1 | runtime line 850 | `clusterRawCorpusItems` 始终返回单 cluster |
| 2 | runtime line 388 | 分批计划仅按字符数，不按 token / 语义边界 |
| 3 | runtime line 678 | 批内文档均分配额，不考虑各文档长度差异 |
| 4 | runtime line 183 | tokenizer 是正则，无 BPE/SentencePiece |
| 5 | runtime line 1336 | `makeCandidateSkill` 始终生成恰好 1 个 rule + 1 个 entity relation，内容公式化 |
| 6 | runtime line 1664 | evidence 水合失败无声跳过 |
| 7 | runtime line 1626 | 最多保留 200 个 run，旧 run 被静默删除 |
| 8 | workbench line 382 | Markdown→HTML 转换器只处理 heading/list/paragraph |
| 9 | workbench line 635 | 质量检查 5 个 boolean check，`unsupportedConclusionCount` = `##` 标题数 - 2 |
| 10 | benchmark line 301 | 邮件头解析无 MIME/RFC 2047 支持 |
| 11 | benchmark line 446 | 邮件线程分组对无 Message-ID 的邮件用"同主题+同参与人"合并，不同线程可能被错误归并 |
| 12 | benchmark line 382 | 无 quoted-printable / base64 / charset 解码 |
| 13 | benchmark line 619 | 评估只是字符串 marker 覆盖检查，无 LLM judge |
| 14 | runtime line 6 | 模型 alias `deepseek-v4-flash` 硬编码在源码中 |

---

## 六、建议修复优先级

| 优先级 | 问题 | 理由 |
|--------|------|------|
| P0 | 确定性 fallback 产物应带显式 degraded 标记 | 防止下游误用空壳输出 |
| P0 | fallback 模式的 `content` 字段应为空或填 "unavailable" | 当前填的是格式化模板文本，易误导 |
| P1 | 分批策略改用 token-count 预算 | 字符数对 LLM 无意义 |
| P1 | 聚类改为至少支持多 cluster 的 raw corpus 模式 | 当前始终单 cluster，多主题项目完全无法用 |
| P1 | evidence 水合失败必须产生可观测指标 | 静默失败意味着蒸馏质量无法评估 |
| P2 | 引入 embedding-based 聚类 | 替代当前 Jaccard + regex 的玩具方案 |
| P2 | 补齐 Evidence Pack 的权限字段 | 与 KNOWLEDGE-GOVERNANCE 协议对齐 |
| P2 | 邮件处理添加 MIME 解码 | 非 UTF-8 邮件全乱码 |
| P3 | 质量检查从 5 个 boolean 升级为 LLM-judge | 与 DeepEval/G-Eval 对齐 |
| P3 | 移除硬编码模型 alias | 改为配置驱动 |
