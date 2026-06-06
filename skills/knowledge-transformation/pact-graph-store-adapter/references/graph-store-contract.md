# Graph Store Adapter Contract

Use a `graphStore` mount to sync people, threads, transactions, timeline, and association edges to a graph database.

Implement `onBatchCompleted` and treat `result` as the source of truth for one batch:

- `people` become person nodes.
- `transactions` become affair or transaction nodes.
- `threads` become conversation nodes.
- `timeline` becomes event nodes.
- `network.nodes` and `network.edges` can be imported directly if the target graph model is generic.
- `associations.items` become typed edges between transactions.

The adapter must be idempotent. Use `batchId` plus entity id as the external upsert key.
