# Use Content-Defined Chunking for the Prolly Tree

Pactium's Canonical Prolly Tree will use protocol-defined content-defined chunking rather than fixed fanout or host-configurable fanout. Pactium needs stable roots, structural sharing, membership and non-membership proofs, and efficient diffs across hosts, so chunking, encoding, hashing, and proof format must be fixed as protocol constants rather than treated as storage tuning.
