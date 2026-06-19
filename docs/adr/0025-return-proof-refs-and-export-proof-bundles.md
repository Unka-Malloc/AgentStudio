# Return Proof Refs and Export Proof Bundles

`recordOperation` will synchronously return a complete Pactium Proof Envelope with proof material references rather than inlining every proof byte on the write path. Pactium will provide explicit proof bundle export for offline or cross-system verification, preserving proof-first semantics without forcing large portable proofs into every normal write response.
