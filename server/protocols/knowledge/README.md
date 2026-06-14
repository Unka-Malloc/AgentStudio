# Pact Knowledge Protocol

Protocol version: `v0.0.1:knowledge:core-1`

The application layer talks to a knowledge module through this method protocol. It must not depend on the module's database, vector index, embedding runtime, or storage layout.

This protocol is intentionally independent from HTTP, JSON-RPC, CLI, SQLite, and the built-in `KnowledgeCore` implementation. Public interfaces map requests into `knowledge.*` methods through the operation registry; they do not call KnowledgeCore internals.

## Knowledge Capability Layers

This table is the canonical grouping for knowledge-related business capabilities. Keep new knowledge tasks in one of these layers instead of documenting them as unrelated ad hoc jobs.
Runtime classification is defined in `server/platform/common/operation-dispatcher/knowledge-capability-layers.mjs` and is applied to operation registry entries before Tool Management catalog generation.

| Layer | Capability | Main operations | Runtime ownership | Queue status |
| --- | --- | --- | --- | --- |
| Corpus ingestion | Parse uploads, local files, knowledge source refreshes, and reparse requests into normalized documents, evidence, assets, and indexes. | `import_parse_job`, `pact.jobs.import-parse`, `jobs.create`, `jobs.reparse`, `knowledge.ingest.batch` | JobManager owns business history and results; Pact Work Queue owns new scheduling facts. | Connected to Pact Work Queue through `pact.jobs.import-parse`. |
| Knowledge runtime | Serve search, evidence packs, assets, graph expansion, health, export, sync, maintenance, and reindex surfaces over the active knowledge backend. | `knowledge.search`, `knowledge.evidence`, `knowledge.asset`, `knowledge.graph`, `knowledge.health`, `knowledge.reindex`, `knowledge.maintenance.*` | KnowledgeCore or the configured external knowledge-base adapter owns retrieval, evidence, asset, and maintenance behavior. | Not a queue candidate by itself; these are runtime APIs used by higher-level workflows. |
| Corpus organization | Build and maintain human-facing corpus organization artifacts such as word clouds and word bags from indexed vocabulary. | `knowledge.word_clouds.get`, `knowledge.word_clouds.save`, `knowledge.word_bags.*` | Metadata store owns word-cloud sets and word-bag JSONL snapshots. | Not connected to Pact Work Queue; word-cloud and word-bag organization is manual metadata maintenance. |
| Retrieval learning | Turn search and evidence feedback into retrieval profile candidates and reviewable ranking/retrieval suggestions. | `knowledge.feedback`, `knowledge.suggestions`, `knowledge.suggestion_resolve`, `knowledge.learning.jobs`, `knowledge.learning.health` | KnowledgeCore and LearningRuntime own feedback, learning runs, profile candidates, and suggestions. | Not connected to Pact Work Queue. |
| Evaluation and gates | Replay maintained or generated cases against the knowledge agent and calculate retrieval quality gates. | `knowledge.evaluation.runs.create`, `knowledge.evaluation.runs.list`, `knowledge.evaluation.runs.get`, `knowledge.skills.evaluation.runs.create` | AgentEvaluationRuntime and KnowledgeSkill runtime own run storage and metrics. | Not connected to Pact Work Queue. |
| Evolution governance | Run the closed loop that collects feedback, attributes failures, proposes candidates, evaluates regressions, publishes canaries, and supports rollback. | `knowledge.evolution.runs.create`, `knowledge.evolution.deployments.*`, `knowledge.hierarchy.audit` | KnowledgeEvolutionRuntime orchestrates KnowledgeCore, evaluation, model decision, distillation, GoldenRule, and Skill runtimes. | Not connected to Pact Work Queue; it is a compound workflow that may call learning, evaluation, and distillation. |
| Agent production | Use the knowledge base to create answer, exploration, or summary artifacts while preserving evidence refs and review boundaries. | `knowledge.agent_explore.runs.create`, `knowledge.summarization.runs.create`, `knowledge.summarization.runs.approve`, `knowledge.agent_skill.*`, `knowledge.skills.*` | AgentWorkspace, ContextRuntime, Agent Exploration, SummarizationRuntime, and KnowledgeSkillRuntime own runs, artifacts, private state, and proposals. | Not connected to Pact Work Queue; some calls can run local async/background modes. |
| External distillation | Call the independently deployed distillation service for document, corpus, or project-level route-first parsing, classification, convergence, grounding, graph evidence, and portable artifacts. | `external.knowledge.distillation.runs.create`, `external.knowledge.distillation.runs.get`, `external.knowledge.distillation.evidence.query`, `external.knowledge.distillation.artifacts.export` | External knowledge distillation service owns distillation runtime and artifacts; Pact owns registration, client calls, and protocol adaptation. | Not connected to Pact Work Queue; availability and throughput depend on the external service. |

These layers are intentionally not equal-cost queue candidates. Corpus ingestion is the only knowledge-related business type currently scheduled through Pact Work Queue. Evolution, summarization, exploration, and external distillation are heavier compound or model/service-backed workflows and need their own queue admission policies before mixed-load capacity claims can be made.

## Methods

| Method | Purpose |
| --- | --- |
| `knowledge.capabilities` | Return supported modalities, storage backends, output formats, internal protocol versions, and license policy. |
| `knowledge.ingest.batch` | Ingest a completed Pact job result into the knowledge module. |
| `knowledge.upsert.documents` | Upsert already-normalized knowledge documents. |
| `knowledge.delete.batch` | Remove all knowledge objects derived from a batch/job. |
| `knowledge.search` | Return evidence packs, not bare chunks. Evidence may include text blocks and image assets. |
| `knowledge.get.evidence` | Read a previously materialized evidence pack. |
| `knowledge.asset` | Read an image or binary asset referenced by an evidence pack. |
| `knowledge.render.markdown` | Render an evidence pack as Markdown with local image references and machine-readable metadata. |
| `knowledge.export.docx` | Export accepted knowledge documents, sections, blocks, assets, and evidence locators as a standard DOCX corpus for external knowledge bases. |
| `knowledge.sync` | Return downstream synchronization changes. Default scope is summary; `scope=mirror` returns client mirror objects. |
| `knowledge.reindex` | Rebuild embeddings/indexes for the active module implementation. |
| `knowledge.maintenance.get` | Read adjustable retrieval, embedding, Markdown, and maintenance parameters. |
| `knowledge.maintenance.set` | Update maintenance parameters without changing application code. |
| `knowledge.health` | Return counts, missing assets, active providers, and capability status. |
| `knowledge.feedback` | Record user/search/evidence feedback as auditable learning signals. |
| `knowledge.suggestions` | List system-generated knowledge evolution suggestions. |
| `knowledge.suggestion_resolve` | Accept, reject, or manually merge a suggestion. |
| `knowledge.learning.jobs` | Run a bounded learning/evaluation task. |
| `knowledge.learning.health` | Report LearningRuntime, current retrieval profile, and degradation status. |

## Public Interface Mapping

| Surface | Boundary |
| --- | --- |
| HTTP | Routes such as `POST /api/knowledge/search`, `GET /api/knowledge/evidence/:evidenceId`, `GET /api/knowledge/assets/:assetId`, `POST /api/knowledge/render/markdown`, and `GET /api/knowledge/export/docx` map into protocol methods. |
| JSON-RPC | Methods keep the same protocol names, for example `knowledge.search`, `knowledge.get.evidence`, `knowledge.asset`, `knowledge.render.markdown`, and `knowledge.export.docx`. |
| CLI | `pact knowledge ...` commands call the registered HTTP/RPC surfaces; they do not read module storage. |
| Module/RPC adapter | An external knowledge module may call a local or remote service internally, but it must adapt the result back to this method protocol. |

The application layer owns orchestration. The knowledge module owns knowledge storage, retrieval, asset, embedding, and rendering details. Neither side reaches across the boundary through private imports, SQLite table reads, or asset path concatenation.

## Three-Layer Knowledge Boundary

Pact separates knowledge management into three layers:

| Layer | Responsibility |
| --- | --- |
| `raw-corpus-construction` | Provide format-conversion-only tools first: every supported raw input format must be exportable to DOCX without chunking, filing, or indexing. Supported inputs include Markdown, HTML, PDF, PPT/PPTX, DOC/DOCX, XLS/XLSX, mail, image-based documents, and plain text; Markdown is only one supported input type. Then parse raw files, mail, attachments, chats, local mirrors, and directories into structure-preserving `sources`, normalized DOCX packages, source ranges, timelines, transaction chains, and raw object references. User-facing export is `raw-corpus.format.convert`, selected by `targetFormat`. |
| `knowledge-index-construction` | Continue the same corpus-filing business line by filing normalized corpus into callable documents, roughly concatenating multiple sources about the same matter into newest-to-oldest unified dossiers, then parsing and mapping them into the built-in `KnowledgeCore` or an external knowledge-base adapter. This layer owns document/section/block/asset/evidence/embedding/relationship indexing, exposes RAG-safe evidence through `v0.0.1:knowledge:core-1`, and exports same-matter timeline dossiers through `knowledge.dossier.export`. |
| `knowledge-distillation` | Read first-layer raw corpus full text first, cover long sources through batches/steps, then generate self-contained Markdown/DOCX/HTML/PDF-style portable documents. Second-layer evidence is used for validation, citations, remediation, and audit; distillation must not replace `knowledge.search` as the full-query surface. All distillation is now handled by the independently deployed `external.knowledge.distillation` service. Legacy `knowledge.distillation.export` has been removed; use `external.knowledge.distillation.artifacts.export` instead. |

The first and second layers are one business workflow: format conversion, corpus filing, same-matter dossier aggregation, then indexing. The second layer is the external knowledge-base integration point. For that reason raw document parsing is shared across the first two layers: the first layer preserves and normalizes original structure; the second layer parses normalized packages, manifests, source metadata, and asset locators into whichever index backend is active. Same-matter dossier aggregation must work before advanced simplification: emails, back-and-forth messages, document revisions, or related files are first sorted by `capturedAt`, `sourceUpdatedAt`, `sourceCreatedAt`, or `sourceCollectedAt` from newest to oldest and concatenated into an auditable unified document. The protocol has three user-facing export semantics: `raw-corpus.format.convert` for raw format conversion without persistence side effects, `knowledge.dossier.export` for timeline-concatenated documents, and `external.knowledge.distillation.artifacts.export` for refined portable knowledge documents via the external distillation service. Export and distillation responses record `outputFormat` so clients can distinguish portable Markdown, DOCX, HTML, PDF-style, and machine-readable JSON artifacts without inferring from filenames. Export support does not replace the local knowledge-base runtime shape: the local `KnowledgeCore` or external-backend mapping must still retain documents, sections, blocks, structure artifacts, fragments, evidence, assets, hierarchy, embeddings, dossiers, and distillation runs for local agent retrieval. External knowledge-base adapters may call remote ingestion/search APIs internally, but public search, evidence, asset, export, and render behavior must adapt back to this protocol.

## Industrial Distillation Benchmark Protocol

Industrial knowledge distillation is tracked by `v0.0.1:knowledge:distillation-industrial-1`. It is a benchmark and gate protocol, not a new persistence backend.

| Stage | Contract |
| --- | --- |
| Markdown project digest | `buildMarkdownProjectDigest()` scans all Markdown files under a project, excludes dependency/build/cache folders, and preserves directory tree, relative path, heading outline, file order, and full source text. External baseline tools include Repomix and Gitingest. |
| Email thread digest | `buildEmailThreadDigest()` scans `.eml` files, groups same-matter messages through RFC 5322 `Message-ID`, `In-Reply-To`, and `References`, follows the RFC 5256 `REFERENCES` threading semantics where applicable, and sorts each thread from oldest to newest. |
| Framework run | Pact passes the generated digest documents as first-layer `rawDocuments`; the default industrial model alias is `deepseek-v4-flash`, while actual model calls still require `modelEnabled=true`. |
| Gap evaluation | `evaluateIndustrialDistillationGap()` compares external mature skill output and Pact framework output by `coverage`, `same-matter merge`, `timeline order`, `source trace`, and `unsupported claims`. |

CLI entry:

```bash
npm run server:knowledge:industrial-distill-plan -- --project-dir <project> --email-dir <emails> --output <report.json>
```

Regression gate:

```bash
npm run server:verify:knowledge-industrial-distillation
```

## 动态参数文档解析策略

Policy id: `dynamic-parameter-document-parsing-policy`.

Document chunking is structure-adhesive by default. Its first responsibility is preserving document structure and information, not producing chunks of a default size. The parser must anchor to headings, page/slide order, paragraphs, lists, tables, images, attachments, mail threads, and transaction timelines before it derives retrieval fragments. Token or character size limits only constrain derived fragments, response budgets, payload continuation, or explicitly requested secondary parsing.

Long paragraphs, tables, lists, and code blocks use a two-track materialization model:

1. The first layer records the original structural unit as a `structureArtifact`. It preserves source order, heading path, page/line coordinates, table headers, row/column ranges, sourceRange, textDigest, asset references, and parent-child links.
2. The parsing/chunking pipeline may derive smaller `granularityFragments` from that artifact. Examples include sentence-level paragraph fragments, row-window tables, cell-window tables, line-preserving code windows, and token-window fallback fragments.
3. Every fragment must keep `parentArtifactId`, `granularity`, `fragmentRange`, `order`, and `fragmentationTrace`. A fragment is retrieval material, not the canonical replacement for the original artifact.

The strategy has two required function boundaries:

- `dispatchDynamicDocumentParsingAlgorithm(input)` is the algorithm dispatcher. It maps `algorithmId`, `artifactType`, `granularity`, `contextBudget`, and `payloadBudget` to a concrete function. Concrete algorithms such as `parseParagraphSentenceV1`, `parseTableRowWindowV1`, `parseTableCellWindowV1`, `parseCodeLineWindowV1`, and `parseTokenWindowFallbackV1` must stay in separate functions; the dispatcher must not contain splitting logic.
- `bindDynamicDocumentParsingInvocation(request, runtimeState)` is the per-call binding function. It normalizes request parameters, reads the current hot-reloaded algorithm registry and policy defaults, binds them to one invocation, then calls the dispatcher. Bound parameters apply only to the current interface call.

Search and evidence reads must be budget-aware. Callers pass `contextBudget.knowledgeTokens` as the dynamic budget reserved for this knowledge load. This is not the model's full context window and must not be inferred only from the model alias. If the budget can fit the complete original structure, `knowledge.search` should return the `structureArtifact`; if not, it may return selected `granularityFragments` and expose `completeOriginalAvailable=true` plus the parent locator. A caller may explicitly set `granularity.secondaryParse.enabled=true` to request slower on-demand splitting with a named algorithm and target size. Adapters that cannot do live secondary parsing may use precomputed fragments, but they must report that limitation in capabilities or backendTrace.

Payload size is a separate budget from knowledge tokens. Requests may pass `payloadBudget.maxResponseBytes`, `payloadBudget.maxEvidenceBytes`, and `continuationToken`. If a long paragraph, table, or multimodal evidence pack cannot fit the response payload, the adapter must return `payload.truncated=true`, `payload.nextContinuationToken`, returned ranges, and parent locators instead of overfilling the response. Continuation tokens must be bound to tenant, workspace/source scope, query hash, artifact id, range cursor, and expiration time.

## External Knowledge-Base Adapter Protocol

External knowledge-base adapters implement the `knowledgeBase` mount behind `v0.0.1:knowledge:core-1`. The first conformance target is mature open-source knowledge-base backends only: PostgreSQL + pgvector, Qdrant, OpenSearch, and optional Weaviate. Product-level RAG apps, orchestration frameworks, proprietary services, and experimental graph/RAG stacks stay outside the required adapter matrix until the mature OSS fixture is stable.

Reference conformance backends:

| Backend | Test purpose | First-pass status |
| --- | --- | --- |
| PostgreSQL + pgvector | Baseline relational knowledge store: Pact ids, sourceTrace, permission scopes, tombstones, DOCX export state, and vector retrieval live in one auditable database. | Required |
| Qdrant | Vector backend with payload filters: validates tenant/workspace/source-scope prefiltering and sidecar evidence/asset mapping. | Required |
| OpenSearch | Full-text + vector hybrid search backend: validates lexical retrieval, semantic retrieval, score fusion, and production-style filtering. | Required |
| Weaviate | Object-oriented vector/hybrid backend: useful when testing collection schema and object properties, but not required for the first fixture. | Optional |

Implemented mount:

```text
server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs
```

The mount keeps `KnowledgeCore` as the canonical evidence, asset, DOCX export, and maintenance store, then mirrors searchable records into the external backend. It currently implements `qdrant`, `opensearch`, and `pgvector`; Weaviate remains an optional future backend.

Minimum conformance set:

| Operation class | Public method | Adapter responsibility | Required |
| --- | --- | --- | --- |
| Capabilities and health | `knowledge.capabilities`, `knowledge.health` | Report backend identity, supported modalities, indexing features, license/deployment status, freshness, degraded modes, and missing dependencies. | Yes |
| Ingest normalized corpus | `knowledge.ingest.batch`, `knowledge.upsert.documents` | Parse first-layer normalized packages, manifests, source metadata, assets, and chunk/section boundaries into backend-native index objects. | Yes |
| Search | `knowledge.search` | Return ranked evidence packs with hierarchy, citations, sourceTrace, score reasons, and backend trace metadata. | Yes |
| Evidence read | `knowledge.get.evidence` | Rehydrate a materialized evidence pack without requiring callers to know backend ids or storage paths. | Yes |
| Asset read | `knowledge.asset` | Resolve opaque `assetId` to bytes, stream metadata, or a missing-asset status without exposing filesystem or backend private paths. | Conditional: required when evidence can reference assets |
| Export | `knowledge.export.docx` | Export accepted knowledge objects from the active mount as a standard DOCX corpus with evidence locators. | Yes |
| Lifecycle | `knowledge.delete.batch`, `knowledge.reindex`, `knowledge.sync` | Delete, rebuild, and mirror index state while preserving Pact ids and tombstones. | Required for production adapters |
| Governance | `knowledge.feedback`, `knowledge.suggestions`, `knowledge.suggestion_resolve`, `knowledge.learning.*` | Accept feedback and expose reviewable evolution suggestions without mutating canonical facts directly. | Optional unless advertised in capabilities |

### Adapter Capability Shape

`knowledge.capabilities` must include enough information for routing, packaging, and conformance checks:

```json
{
  "protocolVersion": "v0.0.1:knowledge:core-1",
  "adapterProtocolVersion": "v0.0.1:external-service:knowledge-adapter-1",
  "backend": {
    "adapterId": "enterprise-search",
    "backendKind": "external",
    "vendor": "example",
    "deployment": "remote",
    "profileId": "default"
  },
  "supports": {
    "ingestNormalizedDocuments": true,
    "search": true,
    "evidenceRead": true,
    "assetRead": true,
    "docxExport": true,
    "hierarchy": true,
    "relationships": true,
    "vectorSearch": true,
    "lexicalSearch": true,
    "hybridSearch": true,
    "metadataFilters": true,
    "structureArtifacts": true,
    "granularityFragments": true,
    "dynamicContextBudget": true,
    "secondaryParse": false,
    "rerank": false,
    "syncMirror": true,
    "deleteBatch": true,
    "reindex": true
  },
  "objectModel": {
    "externalIdsStable": true,
    "storesSourceTrace": true,
    "storesCitations": true,
    "storesAssetLocators": true,
    "opaqueAssetIds": true,
    "storesStructureArtifacts": true,
    "storesFragmentParentLinks": true
  },
  "limits": {
    "maxBatchDocuments": 10000,
    "maxBlockBytes": 65536,
    "maxTopK": 200,
    "maxAssetBytes": 52428800
  },
  "license": {
    "runtimeClass": "external-service",
    "status": "operator-configured"
  }
}
```

`knowledge.health` must report `ok`, `degraded`, `generation`, `lastIngestAt`, `lastSearchAt`, object counts when available, backend reachability, configured index names, and actionable missing-dependency messages. Health output must not include credentials.

### Ingest Contract

Adapters ingest first-layer corpus packages through `knowledge.ingest.batch` or `knowledge.upsert.documents`. The input is a normalized object graph, not a backend-specific payload:

```json
{
  "protocolVersion": "v0.0.1:knowledge:core-1",
  "batchId": "job-123",
  "corpus": {
    "packageType": "pact.normalized-documents",
    "manifestId": "manifest::job-123",
    "generatedAt": "2026-05-17T00:00:00.000Z"
  },
  "documents": [
    {
      "documentId": "document::job-123::message-1",
      "kind": "message",
      "title": "Customer escalation thread",
      "mediaType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "sourceTrace": {
        "clientUid": "client-a",
        "sourceType": "mail",
        "providerId": "macos-mail",
        "externalId": "message-id",
        "syncBatchId": "sync-1",
        "contentHash": "sha256:...",
        "capturedAt": "2026-05-17T00:00:00.000Z"
      },
      "sections": [
        {
          "sectionId": "section::1",
          "headingPath": ["Thread", "Timeline"],
          "sourceRange": {"startLine": 1, "endLine": 42}
        }
      ],
      "blocks": [
        {
          "blockId": "block::1",
          "sectionId": "section::1",
          "text": "Normalized content...",
          "blockType": "paragraph",
          "sourceRange": {"startLine": 8, "endLine": 12},
          "metadata": {"threadId": "thread-1", "transactionId": "tx-1"}
        }
      ],
      "structureArtifacts": [
        {
          "artifactId": "artifact::block::1",
          "artifactType": "paragraph",
          "blockId": "block::1",
          "textDigest": "sha256:...",
          "sourceRange": {"startLine": 8, "endLine": 12},
          "order": 1
        }
      ],
      "granularityFragments": [
        {
          "fragmentId": "fragment::block::1::1",
          "parentArtifactId": "artifact::block::1",
          "granularity": "paragraph-sentence",
          "fragmentRange": {"sentenceStart": 1, "sentenceEnd": 3},
          "text": "Normalized content...",
          "order": 1,
          "fragmentationTrace": {"policy": "dynamic-parameter-document-parsing-policy", "algorithm": "paragraph-sentence-v1"}
        }
      ],
      "assets": [
        {
          "assetId": "asset::sha256:...",
          "mediaType": "image/png",
          "sha256": "...",
          "sourceLocator": {"documentId": "document::job-123::message-1", "blockId": "block::1"}
        }
      ],
      "relationships": [
        {
          "relationshipId": "relationship::tx-1",
          "type": "transaction_member",
          "fromId": "document::job-123::message-1",
          "toId": "transaction::tx-1",
          "sourceBlockIds": ["block::1"]
        }
      ]
    }
  ],
  "policy": {
    "tenantId": "local",
    "remoteCallsAllowed": true,
    "visibility": "private",
    "requiredScopes": ["knowledge:maintain"]
  }
}
```

Ingest response:

```json
{
  "protocolVersion": "v0.0.1:knowledge:core-1",
  "batchId": "job-123",
  "backend": {"adapterId": "enterprise-search", "generation": 17},
  "indexedCounts": {"documents": 1, "sections": 1, "blocks": 1, "assets": 1, "relationships": 1},
  "mappings": [
    {
      "pactId": "document::job-123::message-1",
      "externalId": "kb-doc-987",
      "kind": "document"
    }
  ],
  "warnings": [],
  "cursor": "17"
}
```

Adapters must persist or reconstruct mappings from Pact ids to backend ids. Mapping loss is a health issue because evidence, asset reads, delete, sync, and export all depend on stable ids.

### Search Contract

`knowledge.search` is the only full-query surface for RAG callers. It must accept backend-neutral query controls:

```json
{
  "query": "Which customer escalations are still unresolved?",
  "topK": 12,
  "filters": {
    "sourceTypes": ["mail"],
    "batchIds": ["job-123"],
    "timeRange": {"from": "2026-01-01T00:00:00.000Z", "to": "2026-05-17T00:00:00.000Z"},
    "metadata": {"transactionStatus": "open"}
  },
  "retrieval": {
    "mode": "hybrid",
    "hierarchyReasoning": true,
    "rerank": true,
    "includeRelationships": true,
    "includeAssets": true
  },
  "contextBudget": {
    "knowledgeTokens": 4096,
    "budgetScope": "knowledge-recall-only"
  },
  "payloadBudget": {
    "maxResponseBytes": 262144,
    "maxEvidenceBytes": 65536
  },
  "granularity": {
    "preferOriginalStructure": true,
    "allowPartialEvidence": true,
    "secondaryParse": {
      "enabled": true,
      "algorithm": "table-row-window-v1",
      "targetTokens": 512
    }
  },
  "continuationToken": "",
  "policy": {
    "tenantId": "local",
    "requiredScopes": ["knowledge:read"]
  }
}
```

Search response must be evidence-first:

```json
{
  "protocolVersion": "v0.0.1:knowledge:core-1",
  "queryId": "query-1",
  "backend": {"adapterId": "enterprise-search", "generation": 17},
  "evidence": [
    {
      "evidenceId": "evidence::query-1::1",
      "score": 0.91,
      "scoreReasons": ["metadata_filter", "hybrid_match", "relationship_boost"],
      "document": {"documentId": "document::job-123::message-1", "title": "Customer escalation thread"},
      "section": {"sectionId": "section::1", "headingPath": ["Thread", "Timeline"]},
      "blocks": [
        {
          "blockId": "block::1",
          "artifactId": "artifact::block::1",
          "materialization": {
            "mode": "fragment",
            "parentArtifactId": "artifact::block::1",
            "granularity": "paragraph-sentence",
            "completeOriginalAvailable": true
          },
          "text": "Normalized content...",
          "sourceRange": {"startLine": 8, "endLine": 12}
        }
      ],
      "assets": [{"assetId": "asset::sha256:...", "mediaType": "image/png"}],
      "citations": [
        {
          "citationId": "citation::1",
          "documentId": "document::job-123::message-1",
          "blockId": "block::1",
          "sourceRange": {"startLine": 8, "endLine": 12}
        }
      ],
      "sourceTrace": {
        "sourceType": "mail",
        "providerId": "macos-mail",
        "externalId": "message-id",
        "capturedAt": "2026-05-17T00:00:00.000Z"
      },
      "backendTrace": {
        "externalDocumentId": "kb-doc-987",
        "retrievalMode": "hybrid"
      }
    }
  ],
  "hierarchy": {
    "enforced": true,
    "selected": {"documentIds": ["document::job-123::message-1"], "sectionIds": ["section::1"]}
  },
  "payload": {
    "truncated": false,
    "returnedBytes": 4096,
    "maxResponseBytes": 262144,
    "nextContinuationToken": ""
  },
  "warnings": []
}
```

Adapters may return backend-specific diagnostics under `backendTrace`, but callers must not depend on those fields for correctness. When `granularity.secondaryParse.enabled=true` is honored, `backendTrace.secondaryParse` must record the algorithm, target size, source artifact id, generated fragment count, elapsed time, and whether precomputed or on-demand fragments were used.

### Evidence, Asset, Export, And Delete Semantics

- `knowledge.get.evidence` accepts `evidenceId` plus optional `includeBlocks`, `includeAssets`, `renderMarkdown`, `contextBudget`, `payloadBudget`, and `continuationToken` fields. It returns the same evidence shape as search and must work after the original query response has been cached.
- When evidence payload is too large, search and evidence reads must support resumable reads with `payload.nextContinuationToken`. The token is opaque to callers and must be rechecked against tenant, workspace/source scope, query hash, artifact id, range cursor, and expiration before returning the next range.
- `knowledge.asset` accepts only opaque `assetId`. It returns `{ found, mediaType, byteLength, sha256, stream|bytes|url, missingReason }`. If the external backend owns the asset, the adapter must proxy or sign access without exposing private backend paths.
- `knowledge.export.docx` exports from the active mount. External adapters may regenerate DOCX from their backend objects, but exports must preserve Pact ids, evidence locators, citations, sourceTrace, and asset references.
- `knowledge.delete.batch` must remove or tombstone every object derived from a batch. If the backend only supports soft delete, search and sync must hide tombstoned objects.
- `knowledge.reindex` may rebuild backend indexes, embeddings, graph projections, or payload indexes, but must not change Pact ids or evidence locators.

### Failure And Consistency Semantics

- Partial ingest must return `warnings` and `failedItems` with Pact ids. Silent drop is invalid.
- Search degradation must set `warnings` and `backend.degraded=true`; callers can still use evidence if citations and sourceTrace are intact.
- Adapter retries must be idempotent by `batchId`, `documentId`, `sectionId`, `blockId`, and `assetId`.
- Remote backends must enforce tenant, workspace, and source-scope filters before returning evidence. Post-filtering after topK is not sufficient for permission boundaries.
- The adapter must expose a conformance fixture that ingests a small normalized corpus, searches it, reads evidence/assets, exports DOCX, deletes the batch, and proves the deleted objects no longer appear in search or sync.

## Object Model

The protocol normalizes all upstream files into these concepts:

| Object | Meaning |
| --- | --- |
| `collection` | A logical grouping, usually a job/batch or manually managed corpus. |
| `document` | A knowledge document such as a source file, transaction, message, or normalized DOCX manifest entry. |
| `section` | A document subdivision used for parent expansion and human-readable structure. |
| `block` | A retrievable text/table/event/image-reference unit. |
| `asset` | A first-class binary asset such as an image, with OCR/caption/source locator metadata. |
| `evidence` | A materialized retrieval result containing blocks, assets, source locator, score, and Markdown. |
| `embedding` | A provider-versioned vector for a block or asset. |
| `relationship` | A protocol-level link between documents, blocks, assets, people, transactions, or messages. |

## Downstream Mirror Sync

Clients that need offline browsing call:

```http
GET /api/knowledge/sync?since=0&limit=500&scope=mirror
```

Mirror responses use the same cursor envelope as summary sync but carry KnowledgeCore objects:

```json
{
  "protocolVersion": "v0.0.1:knowledge:core-1",
  "scope": "mirror",
  "cursor": "12",
  "latestCursor": "12",
  "hasMore": false,
  "cachePolicy": {
    "scope": "mirror",
    "storesFullEvidence": true,
    "storesNormalizedDocuments": true,
    "storesOriginalAttachments": false,
    "primaryReadableFormat": "markdown"
  },
  "changes": [
    {
      "cursor": "1",
      "kind": "document",
      "action": "upsert",
      "entityId": "document::...",
      "itemId": "document::...",
      "batchId": "job-id",
      "serverUpdatedAt": "2026-04-29T00:00:00.000Z",
      "record": {}
    }
  ]
}
```

Allowed mirror `kind` values are `document`, `section`, `block`, `asset`, `relationship`, `reviewItem`, `suggestion`, and `tombstone`.
`asset` records are metadata only; binary content is still read through `GET /api/knowledge/assets/:assetId`.
`tombstone` records use `record.targetKind` plus the target id, letting downstream caches remove stale local projections while keeping server authority.

## Knowledge Export Boundary

Pact keeps three user-facing export semantics plus one canonical corpus export for external knowledge bases. They may share renderers, but they must not share input scope or persistence side effects:

| Export | Interface | Use |
| --- | --- | --- |
| Raw corpus format conversion | `raw-corpus.format.convert`, `POST /api/knowledge/format-convert`, `knowledge convert --to <format>` | Convert original materials to a requested `targetFormat` such as DOCX, Markdown, HTML, or PDF without filing, chunking, indexing, or creating canonical evidence. |
| Timeline dossier export | `knowledge.dossier.export`, `POST /api/knowledge/dossiers/export`, `knowledge dossier-export --to <format>` | Export emails, message exchanges, document revisions, or related sources about the same matter as a timestamped newest-to-oldest document before deduplication or summarization. |
| Distillation result export | `external.knowledge.distillation.artifacts.export`, `GET /api/external/knowledge/distillation/runs/:runId/artifacts/:artifactId`, `external knowledge distillation export --id RUN_ID` | Export refined self-contained distillation results as Markdown, DOCX, HTML, PDF, or another supported format via the external knowledge distillation service; the document must be understandable outside Pact. |
| Canonical knowledge corpus export | `knowledge.export.docx`, `GET /api/knowledge/export/docx`, `knowledge export-docx --output knowledge.docx` | Export accepted knowledge objects from the active `knowledgeBase` mount as standard DOCX for external KB ingestion and audit without bypassing the protocol boundary. |

Offline exports are portable artifacts. Agents must still use `knowledge.search`, evidence packs, asset protocol, and configured workspace source scopes for live context assembly. Exported files are not a runtime index, and `knowledge.export.docx` must not be treated as a replacement for raw format conversion, timeline dossier export, or distillation result export.

## External Knowledge Distillation

Knowledge distillation is maintained as the independently deployed `external.knowledge.distillation` service. The embedded workbench/runtime implementation has been completely removed from the server runtime path. Legacy `knowledge.distillation.*` and `knowledge.distillation.workbench.*` operations no longer exist; all distillation requests must use `external.knowledge.distillation.*` operations.

| Operation | HTTP | Purpose |
| --- | --- | --- |
| `external.knowledge.distillation.runs.create` | `POST /api/external/knowledge/distillation/runs` | Create an external distillation run with route-first parsing, classification, convergence, and artifact generation. |
| `external.knowledge.distillation.runs.get` | `GET /api/external/knowledge/distillation/runs/:runId` | Read run state and artifact metadata from the external service. |
| `external.knowledge.distillation.evidence.query` | `GET /api/external/knowledge/distillation/runs/:runId/evidence` | Query bounded graph evidence for agents without downloading full artifacts. |
| `external.knowledge.distillation.projects.evidence.query` | `GET /api/external/knowledge/distillation/projects/:projectId/evidence` | Query cross-run project evidence for large project convergence. |
| `external.knowledge.distillation.artifacts.export` | `GET /api/external/knowledge/distillation/runs/:runId/artifacts/:artifactId` | Export Markdown, DOCX, Agent JSON, professional manifests, or workspace packages. |

## Asset URL Policy

Assets are protocol objects, not static files.

| Rule | Requirement |
| --- | --- |
| Public URL | `GET /api/knowledge/assets/:assetId` is the only server URL shape for binary knowledge assets. |
| Export URL | Offline exports may rewrite assets to relative package paths, but the evidence pack must still preserve the original `assetId`. |
| Path safety | `assetId` is opaque and must not be interpreted as a filesystem path by callers. |
| Markdown | `knowledge.render.markdown` may include local image references, but those references must be produced by the module or export adapter. |
| Missing asset | Missing binary content is a recoverable evidence health issue; the protocol should return structured missing-asset metadata instead of exposing a raw path error. |

## Internal Protocol Boundaries

Knowledge modules may call internal modules through these protocol names:

| Protocol | Responsibility |
| --- | --- |
| `v0.0.1:knowledge:vector-1` | Vector upsert/search/delete. |
| `v0.0.1:knowledge:embedding-1` | Text, image, and joint embedding generation. |
| `v0.0.1:storage:asset-store-1` | Binary asset persistence, validation, and URL/path policy. |
| `v0.0.1:knowledge:retrieval-1` | Retrieval fusion, parent expansion, reranking, and evidence shaping. |
| `v0.0.1:knowledge:learning-1` | Feedback aggregation, retrieval profile tuning, suggestion generation, and audited self-evolution. |

The built-in module currently provides local SQLite/object-storage implementations for these protocols. External implementations can replace them if the method shapes remain compatible.

## Built-In Components

| Component | Protocol | Bundled status | Notes |
| --- | --- | --- | --- |
| `KnowledgeCore` | `v0.0.1:knowledge:core-1` | bundled by default | Owns `knowledge-core/knowledge.sqlite`, `knowledge-core/assets/`, evidence shaping, and Markdown rendering. |
| `EmbeddingRuntime` | `v0.0.1:knowledge:embedding-1` | bundled fallback | Uses project-internal deterministic text/image fallback; it must not download model files at startup. |
| `VectorStore` | `v0.0.1:knowledge:vector-1` | optional module plus KnowledgeCore fallback | Built-in local backend uses `sqlite-vec` when available and keeps JSON vectors as deterministic fallback. Native/vector DB adapters must remain behind this protocol. |
| `assetStore` | `v0.0.1:storage:asset-store-1` | bundled fallback | Stores assets by SHA-256 and enforces URL/path policy. |
| `retrieval` | `v0.0.1:knowledge:retrieval-1` | bundled fallback | Handles fusion, parent expansion, rerank, and evidence pack construction. |
| `LearningRuntime` | `v0.0.1:knowledge:learning-1` | bundled deterministic JavaScript fallback; external JS adapter optional | Uses feedback to tune retrieval profiles automatically and emits reviewable suggestions for canonical knowledge changes. Optional framework or store integrations must be called through JavaScript and must not download models implicitly. |

## Offline Package And License Gate

Offline server packages must include `license-manifest.json`. The manifest is generated by `server/scripts/pack-offline-server.mjs` and can be checked without Docker:

```bash
node server/scripts/verify-knowledge-license-manifest.mjs
node server/scripts/verify-knowledge-license-manifest.mjs --check-allowlist
node server/scripts/verify-knowledge-license-manifest.mjs --manifest path/to/license-manifest.json
```

The gate is part of this protocol boundary because a replacement knowledge module can change runtime and model obligations. Production dependencies must classify as allowed; `blocked` or `unknown` production dependency licenses fail packaging. Optional native/vector/model targets must be explicit:

| Optional target | Current package status |
| --- | --- |
| `sqlite-vec` | `allowed` when bundled through the npm package and platform optional dependency; otherwise `not-bundled-license-gated` |
| `llama-index` | `not-bundled-license-gated` until an operator installs an external component reachable through JavaScript |
| `lancedb` | `not-bundled-license-gated` until an operator installs an external component reachable through JavaScript or an external service |
| `onnxruntime-node` | `not-bundled-license-gated` |
| ONNX embedding model assets | `not-bundled-license-gated` |

Allowed licenses, allowed expressions, and blocked classes are written into the manifest. Unknown model weights, restricted models, cloud-only runtimes, and implicit downloads are not valid offline package contents.
