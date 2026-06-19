# Scope Workspace Lane Queues Out Of Current Runtime

The current Pactium package uses a single Ledger Append Lane inside the Ledger Transparency Log and updates Workspace Projection synchronously during operation commits. It does not expose or implement a separate per-workspace FIFO Workspace Lane Queue.

Per-workspace queueing remains a possible future concurrency design, but it is not current behavior. Adding it requires implementation, targeted concurrent write tests, and updates to the Protocol Profile before maintained docs may describe it as part of current behavior.
