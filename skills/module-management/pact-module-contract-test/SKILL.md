---
name: pact-module-contract-test
description: Use when validating a Pact external mount module shape, capabilities, reload and close behavior, sample document extraction, analysis execution, or postcommit hooks.
---

# Pact Module Contract Test

## Purpose

Catch broken mount modules before registering them in `mount-modules.json`.

## Workflow

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/module-management/pact-module-contract-test/scripts/pact-module-contract-test.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --module ./my-mount.mjs \
  --mount-name documentParser \
  --sample sample.pdf
```

For postcommit mounts:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/module-management/pact-module-contract-test/scripts/pact-module-contract-test.mjs \
  --module ./vector-store.mjs \
  --mount-name vectorStore \
  --action postCommit
```

## Checks

- Module import and factory shape.
- Supported capabilities.
- Optional `reload` and `close`.
- Sample `extractDocument` or `extractText`.
- Optional analysis or postcommit execution.
