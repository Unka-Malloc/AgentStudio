# Use IPLD-Style Canonical Values

Pactium uses a restricted IPLD/DAG-CBOR-style canonical value model for proof material instead of ordinary stable JSON. Ledger leaves, index nodes, checkpoint nodes, state commits, proof envelopes, and proof bundles all use one encoding boundary for bytes, links, maps, lists, strings, and finite numbers before hashing.
