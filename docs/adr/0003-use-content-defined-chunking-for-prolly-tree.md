# Use Content-Defined Chunking for the Prolly Tree

Pactium's Canonical Prolly Tree uses protocol-defined content-defined chunking rather than fixed fanout or host-configurable fanout. Pactium needs stable roots, structural sharing, membership and non-membership proofs, and efficient diffs across hosts, so chunking, encoding, hashing, and proof format are fixed as protocol constants rather than treated as storage tuning.
