# Synchronously Update Workspace Projections

Pactium updates Workspace Projection indexes during the same operation commit as the global Ledger append. The projection records workspace-local ordinals, order roots, and membership roots at `recordOperation` time.

The current package does not implement a separate per-workspace FIFO queue. Any future queue must be added as an implementation surface with concurrent write tests before documentation may describe it as current behavior.
