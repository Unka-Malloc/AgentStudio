# Use Pactium Canonical JSON Values

Pactium uses one package-specific canonical JSON encoding boundary for every hashed protocol value. Object keys are sorted, strings are NFC-normalized, numbers are finite safe integers, binary values use the reserved `$bytes` representation, and unsupported JavaScript values are rejected. The format is not RFC 8785 JCS, DAG-CBOR, or an IPLD wire-format claim; ledger leaves, index nodes, checkpoints, state commits, Proof Envelopes, extensions, and Proof Bundles all hash the same Pactium Canonical Value bytes.
