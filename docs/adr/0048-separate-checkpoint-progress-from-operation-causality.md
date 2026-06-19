# Separate Checkpoint Progress From Operation Causality

Checkpoint Tree owns recovery and progress structure, while Operation Causality Index owns verifiable retry, repair, and compensation relationships between facts. A fact may appear in both structures, but neither structure replaces the other and the Operation Ledger remains the ordering authority.
