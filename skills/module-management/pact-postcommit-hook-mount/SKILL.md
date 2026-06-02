---
name: pact-postcommit-hook-mount
description: Use when implementing a Pact knowledgeBase, vectorStore, graphStore, or custom mount that synchronizes completed job results through onBatchCompleted after persistence.
---

# Pact Postcommit Hook Mount

## Purpose

Attach external stores after Pact has persisted a completed batch.

## Contract

Implement:

```js
async onBatchCompleted({ batchId, jobId, result, settings }) {}
```

The hook is discovered by `server/platform/common/module-manager/mount-manager.mjs` and executed from the job pipeline after result persistence.

## Template

```text
/Users/unka/DevSpace/Unka-Malloc/Pact/skills/module-management/pact-postcommit-hook-mount/assets/postcommit-template.mjs
```

## Rules

- Make writes idempotent by `batchId` and entity id.
- Treat failed sync as operationally visible; do not swallow errors unless there is retry telemetry.
- Keep secret configuration out of committed module files.
