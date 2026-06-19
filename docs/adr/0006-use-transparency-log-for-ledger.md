# Use a Transparency Log for the Ledger

Pactium's Operation Ledger will use a dedicated transparency-log algorithm for append-only ordering, inclusion proofs, and consistency proofs rather than the Prolly-based Verifiable Index Engine. Ledger history and state indexes solve different proof problems, so they share canonical encoding and hash-domain utilities but not the tree algorithm.
