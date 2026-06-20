# Return Proof Refs and Export Proof Bundles

`recordOperation` synchronously returns a complete Pactium Proof Envelope with proof material references rather than inlining every proof byte on the write path. Pactium provides explicit proof bundle export for offline or cross-system verification, preserving proof-first semantics without forcing large portable proofs into every normal write response.
