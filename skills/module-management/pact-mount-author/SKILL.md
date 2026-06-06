---
name: pact-mount-author
description: Use when creating or reviewing a Pact external mount module for documentParser, ocr, multimodalParser, analysis, knowledgeBase, vectorStore, graphStore, or a custom named mount.
---

# Pact Mount Author

## Purpose

Create mount modules that match `server/platform/common/module-manager/mount-manager.mjs`.

## Contract

A mount module may export `createMount`, `default`, or `createMountNameMount`. The factory receives `{ mountName, userDataPath, runtimeOptions }`.

Useful methods:

- `supports({ extension, mediaTypeHint, sourceKind })`
- `extractDocument(input)`
- `extractText(input)`
- `onBatchCompleted({ batchId, jobId, result, settings })`
- `reload({ settings, mountName, runtimeOptions })`
- `close()`

## Template

Start from:

```text
/Users/unka/DevSpace/Unka-Malloc/Pact/skills/module-management/pact-mount-author/assets/mount-template.mjs
```

Validate with `$pact-module-contract-test` before wiring it into `mount-modules.json`.
