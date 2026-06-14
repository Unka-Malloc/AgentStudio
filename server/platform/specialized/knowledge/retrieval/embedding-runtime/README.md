# EmbeddingRuntime

可分离的 `v0.0.1:knowledge:embedding-1` embedding runtime 模块。

当前默认实现是 `builtin:hashing-vector-runtime`，使用确定性 hashing 生成归一化向量。它只作为离线 fallback，目的是让封闭部署和协议测试不依赖云服务或外部模型权重。

## API

- `createEmbeddingRuntime(options)`
- `embedText(textOrEvidence, options)`
- `embedImageEvidence(assetEvidence, options)`
- `embedJointEvidence(evidence, options)`
- `capabilities()`
- `health()`
- `validateLicenseManifest(manifest)`

`options.settings` 或 `options.manifest` 可以提供 `providerId`、`dimension`、`license` 和 `status`。KnowledgeCore 现有的 `settings.embeddingModel.text/image/joint` 也会被识别为各 modality 的 provider id。
