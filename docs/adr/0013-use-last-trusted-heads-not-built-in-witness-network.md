# Use Last Trusted Heads, Not a Built-In Witness Network

Pactium core supports last-trusted-head verification and ledger consistency proofs so clients can detect histories that do not continue from previously verified heads. External witnesses and gossip are extension points, not built-in network services, because hosts own process topology and observer infrastructure.
