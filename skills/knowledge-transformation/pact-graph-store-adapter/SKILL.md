---
name: pact-graph-store-adapter
description: Use when connecting Pact people, transactions, threads, timeline events, and associations to an external graph database through a graphStore mount.
---

# Pact Graph Store Adapter

## Purpose

Sync Pact's affair graph into a graph database after a batch completes.

## Workflow

1. Read `references/graph-store-contract.md`.
2. Implement a `graphStore` mount with `onBatchCompleted`.
3. Map people, transactions, threads, timeline events, and association edges.
4. Upsert idempotently by `batchId` plus entity id.
5. Validate with `$pact-module-contract-test --action postCommit`.
