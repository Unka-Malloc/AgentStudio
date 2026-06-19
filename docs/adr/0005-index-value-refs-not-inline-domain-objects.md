# Index Value Refs, Not Inline Domain Objects

Pactium's Verifiable Index Engine will index canonical value references rather than embedding full State or Checkpoint domain objects in tree leaves. This keeps chunking, proofs, and diffs independent of domain payload size and shape while still binding each key to separately verifiable content-addressed value material.
