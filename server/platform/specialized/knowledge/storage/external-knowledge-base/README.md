# External Knowledge Base

`ExternalKnowledgeBase` is an optional `knowledgeBase` mount for `v0.0.1:knowledge:core-1`.

It keeps the built-in `KnowledgeCore` as the canonical evidence, asset, DOCX export, and maintenance store, then mirrors searchable second-layer records into an external backend. `knowledge.search` can use the external backend first and rehydrate Pact evidence from the local adapter sidecar, so callers still receive normal evidence packs instead of backend-native chunks.

Supported first-pass backends:

- `qdrant`: HTTP API, vector search with payload filters.
- `opensearch`: HTTP API, lexical and kNN queries with adapter-side score fusion.
- `pgvector`: PostgreSQL + pgvector through the optional `pg` Node.js driver.

Example:

```bash
PACT_SERVER_KNOWLEDGE_BASE_MODULE=server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs \
PACT_EXTERNAL_KB_PROVIDER=qdrant \
PACT_EXTERNAL_KB_URL=http://127.0.0.1:6333 \
PACT_EXTERNAL_KB_COLLECTION=pact_knowledge \
npm run server:start
```

Configuration:

| Environment variable | Meaning |
| --- | --- |
| `PACT_EXTERNAL_KB_PROVIDER` | `qdrant`, `opensearch`, or `pgvector`. |
| `PACT_EXTERNAL_KB_URL` | Qdrant/OpenSearch endpoint, or PostgreSQL connection string if `PACT_EXTERNAL_KB_CONNECTION_STRING` is not set. |
| `PACT_EXTERNAL_KB_CONNECTION_STRING` | PostgreSQL connection string for `pgvector`. |
| `PACT_EXTERNAL_KB_COLLECTION` | Qdrant collection, OpenSearch index, or logical adapter profile. |
| `PACT_EXTERNAL_KB_API_KEY` | Optional bearer/API key header. |
| `PACT_EXTERNAL_KB_USERNAME` / `PACT_EXTERNAL_KB_PASSWORD` | Optional basic auth for OpenSearch-compatible deployments. |
| `PACT_EXTERNAL_KB_DIMENSION` | Embedding dimension. Defaults to `128`. |

The mount is intentionally conservative:

- External backend failures degrade to local `KnowledgeCore` search instead of breaking the protocol.
- Tenant/workspace/source filters must be translated into backend filters before result ranking.
- `knowledge.asset`, `knowledge.export.docx`, `knowledge.get.evidence`, and maintenance calls stay protocol-compatible.
- The adapter stores Pact record id to backend id mappings in `external-knowledge-base/external-knowledge.sqlite`.
