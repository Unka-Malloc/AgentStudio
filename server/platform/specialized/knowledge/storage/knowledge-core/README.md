# KnowledgeCore

`KnowledgeCore` is the built-in implementation of `v0.0.1:knowledge:core-1`.

It is intentionally separate from the application layer. The server registers public HTTP/RPC/CLI operations, but those handlers call the `knowledgeBase` mount protocol instead of directly using a database or retrieval algorithm.

## Responsibilities

- Ingest completed job results from `onBatchCompleted`.
- Convert source files, normalized DOCX manifest entries, transactions, and messages into a common object model.
- Store text blocks and image assets as first-class knowledge objects.
- Maintain local embeddings through a replaceable vector protocol boundary.
- Return evidence packs that combine text, image assets, source locators, scores, and retrieval reasons.
- Render evidence packs as Markdown with local image references and machine-readable metadata.
- Expose maintenance settings, health, and reindex operations.
- Record feedback, maintain versioned retrieval profiles, and generate auditable suggestions for self-evolution.

## Internal Modules

- `index.mjs`: mount factory and KnowledgeCore orchestration. It owns database transactions, protocol methods, and runtime composition.
- `core-utils.mjs`: deterministic value normalization, JSON handling, hashes, text truncation, and bounded array helpers.
- `retrieval-scoring.mjs`: query tokenization, intent terms, lexical overlap, temporal source extraction, and recency scoring.
- `local-mirror-fusion.mjs`: local mirror hit normalization, dedupe keys, and server-index plus localQuery fusion.
- `row-hydrators.mjs`: SQLite row-to-protocol object mapping.
- `runtime-config.mjs`: default runtime settings and license manifest.
- `outline-runtime-loader.mjs` / `DocumentOutlineRuntime.mjs`: optional long-document outline construction and fallback loading.

New retrieval helpers should go into these modules unless they must directly own SQLite statements or protocol side effects.

## Storage

The built-in storage is local and offline:

- `knowledge-core/knowledge.sqlite`: collections, documents, sections, blocks, assets, embeddings, evidence, relationships, settings, and maintenance runs.
- `knowledge-core/assets/`: binary assets addressed by SHA-256.

The current vector implementation uses `sqlite-vec` as the primary local KNN backend and also stores JSON vectors for deterministic fallback. The `v0.0.1:knowledge:vector-1` boundary stays stable for later LanceDB or Qdrant adapters.

## Learning Runtime

`KnowledgeCore` includes a `v0.0.1:knowledge:learning-1` boundary. The bundled runtime is deterministic and offline-safe: it can auto-apply retrieval profile tuning after feedback replay passes its metric gate, but it never mutates canonical facts, relations, entity merges, or taxonomy entries without creating a reviewable suggestion first.

Optional LlamaIndex + LanceDB support is exposed through JavaScript adapters or external services behind `server/platform/specialized/knowledge/retrieval/learning-runtime` and the LanceDB vector adapter. Operators must install and configure those external components explicitly; startup must not download model weights implicitly.

## License Policy

The repository is licensed as GPL-3.0-only. This module also enforces a stricter production-bundle policy for third-party knowledge dependencies: bundled dependencies must be MIT, Apache-2.0, project-internal, or explicitly compatible with the offline server package policy. Unknown model weights, GPL/AGPL components, cloud-only runtimes, and implicit downloads are not acceptable for offline server packages until that policy is deliberately changed. LlamaIndex, LanceDB, and reranker/embedding models remain license-gated optional runtime components until explicitly configured.
