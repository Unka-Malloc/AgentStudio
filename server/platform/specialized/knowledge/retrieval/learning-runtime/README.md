# LearningRuntime

`LearningRuntime` implements the `v0.0.1:knowledge:learning-1` boundary used by `KnowledgeCore`.

The bundled runtime is deterministic and offline-safe. It performs reciprocal-rank style candidate fusion, aggregates feedback, proposes retrieval profile updates, and emits reviewable suggestions. It may auto-apply retrieval profile versions only after the configured metric gate passes.

Canonical facts, relations, taxonomy changes, and entity merges are never auto-applied by this runtime. They must remain suggestions/review items until a user accepts or merges them.

## External Components

Server-bundled code for this module is JavaScript only. External learning, reranking, or vector frameworks may use any implementation language, but they must be called through a JavaScript adapter, JSON-RPC/HTTP boundary, or an external service wrapper.

Default deployments continue to use the deterministic fallback. Optional LlamaIndex, LanceDB, embedding models, and rerankers must be installed and configured explicitly outside the core server bundle; startup must not download model weights implicitly.
