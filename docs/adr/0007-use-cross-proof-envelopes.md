# Use Cross-Proof Envelopes

Pactium receipts are cross-proof envelopes that bind the Operation Ledger proof to related Checkpoint Tree and Merkle State proofs for the same protocol fact. Returning independently valid proof fragments would allow host code to accidentally or intentionally mis-associate a ledger entry, checkpoint node, and state commit, so the Ledger-anchored envelope is the stable receipt shape.
