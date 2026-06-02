---
name: pact-analysis-module-author
description: Use when creating or reviewing a Pact external analysis module that lists analysis modules or algorithms and runs custom analysis over sources and chunks.
---

# Pact Analysis Module Author

## Purpose

Implement external analysis engines compatible with `server/platform/specialized/knowledge/preprocessing/analysis-engine-registry.mjs`.

## Contract

The mount should provide one or more of:

- `listModules()`
- `listAlgorithms()`
- `runModule(input)`
- `runAnalysis(input)`

`runModule` receives sources, chunks, settings, and module identifiers. It should return fields compatible with the server result model: emails, threads, transactions, people, timeline, network, associations, and warnings.

## Template

Start from:

```text
/Users/unka/DevSpace/Unka-Malloc/Pact/skills/server-knowledge/pact-analysis-module-author/assets/analysis-module-template.mjs
```

Validate with:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/server-ops/pact-module-contract-test/scripts/pact-module-contract-test.mjs \
  --module ./analysis-module.mjs \
  --mount-name analysis \
  --action analysis
```
