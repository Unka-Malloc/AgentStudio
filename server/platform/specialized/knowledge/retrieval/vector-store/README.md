# VectorStore

可分离的 `v0.0.1:knowledge:vector-1` 向量存储模块。

该模块遵循与 FileProcessor 相同的结构规则：

- 模块内声明组件、依赖、路由和打包选项。
- 具体向量数据库适配器按使用场景加载。
- 未被路由、配置或引用的适配器可以在打包时移除。
- 对外保持 `vectorStore` mount 或模块入口，不把具体数据库实现散落到 application 层。

## Local sqlite-vec backend

`LocalVectorStore` 是当前内置离线向量存储：

- 入口：`./LocalVectorStore/index.mjs`
- 工厂：`createLocalVectorStore({ db, embeddingRuntime, ...options })`
- 协议：`v0.0.1:knowledge:vector-1`
- provider：`sqlite-vec`
- 主路径：通过 `sqlite-vec` npm 包加载平台原生 `vec0` SQLite 扩展，创建 `kc_embedding_vec_<dimension>` 虚拟表做 KNN 召回。
- 元数据：复用 `better-sqlite3` 传入的 `kc_embeddings` 表保存 target、provider、modality、hash、JSON metadata。
- fallback：所有向量仍写入 `vector_json`，当原生扩展不可用、维度不匹配或查询失败时回退到进程内 cosine scan。

API：

- `ensureSchema()`
- `upsert(record | record[] | { items })`
- `search({ query, vector, modality, provider, targetType, targetIds, limit })`
- `deleteByTargetIds({ targetIds, targetType, modality, provider })`
- `reindexTargets({ targets, targetIds, resolveTarget, embedTarget })`
- `capabilities()`
- `health()`

该实现适合封闭局域网部署。Linux 离线包会捆绑 `sqlite-vec` 及目标平台 optional native package；license manifest 必须把 `sqlite-vec` 和平台包判定为 allowlist 后才允许发布。

## JSON fallback 边界

JSON fallback 是协议安全网，不是主索引：

适配边界：

- 保持 `v0.0.1:knowledge:vector-1` 方法形状不变。
- 保持 `provider` 字段作为 embedding provider/model 版本边界，允许同一 target 存多套向量。
- 不让 HTTP controller、job pipeline 或 KnowledgeCore 直接依赖 `sqlite-vec` API。
- 如果接入 LanceDB、Qdrant 等外部向量库，也应在本目录提供兼容适配器，而不是绕过协议层。

## LanceDB adapter

`./LanceDB/index.mjs` 提供 license-gated 的 `vectorStore` mount/adapter：

- 协议：`v0.0.1:knowledge:vector-1`
- provider：`lancedb`
- 入口：`createLanceDbVectorStore({ userDataPath, settings })`
- post-commit：`onBatchCompleted({ batchId, jobId, result, settings })` 按 `batchId + chunkId` 生成稳定外部 id 并幂等 upsert。
- 默认行为：没有显式 LanceDB URI 和模型配置时，只写入本地 spool，用于验证协议形状；生产接入必须显式配置外部 LanceDB/Python runtime，且不得隐式下载 embedding/reranker 模型。
