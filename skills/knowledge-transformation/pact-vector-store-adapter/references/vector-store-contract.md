# Vector Store Adapter Contract

Use a `vectorStore` mount when Pact should sync chunks to an external vector database after a job completes.

Implement `onBatchCompleted`:

```js
async onBatchCompleted({ batchId, jobId, result, settings }) {
  for (const chunk of result.chunks || []) {
    // upsert chunk.id, chunk.text, source ids, timestamps, entity links
  }
}
```

Recommended vector payload:

- `id`: stable chunk id
- `text`: chunk text
- `sourceFileId`, `sourceName`, `sourcePath`
- `transactionIds`, `personIds`, `threadIds` when available
- `generatedAt`, source timestamps, and retrieval weights

The hook runs after metadata persistence. It must be idempotent by `batchId` and `chunk.id`.
