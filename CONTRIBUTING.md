# Contributing

Pactium changes should keep the active repository focused on the protocol core:

- Operation Ledger
- Checkpoint Tree
- Merkle State Substrate
- Pactium kernel
- Thin CLI and HTTP facades

Before submitting a change, run:

```bash
npm run verify
npm run pack:dry-run
```

Do not add old product-system code back into active Pactium modules. Product-level features belong in the host system that embeds Pactium.
