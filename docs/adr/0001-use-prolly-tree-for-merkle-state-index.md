# Use Prolly Tree for the Merkle State Index

Pactium will use a Prolly Tree as the canonical Merkle State index instead of treating the current sorted-array index as a proof-capable structure. This follows the Dolt/Noms model because Pactium needs one stable algorithm for ordered-key lookup, membership and non-membership proofs, structural sharing, and efficient diffs from the first verifiable-state release; exposing a weaker interim proof shape would create receipts that cannot carry the long-term trust semantics of the library.
