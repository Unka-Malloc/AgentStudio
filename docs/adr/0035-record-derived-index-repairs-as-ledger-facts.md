# Record Derived Index Repairs as Ledger Facts

Pactium currently provides a Repair Planner that turns repairable verification failures into deterministic host-executable task descriptions. The planner can mark derived-index repair tasks with `recordsRepairFact: true`, but the current package does not execute those tasks and does not append Ledger-bound Repair Facts.

If Pactium later provides a repair executor, rebuilding derived indexes such as Workspace Projection or Checkpoint Node indexes from authoritative facts must record the repair result as a new Ledger-bound Repair Fact. Original facts and missing content must not be invented during repair; only derived material can be recomputed from existing authority.
