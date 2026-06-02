---
name: pact-storage-ops
description: Use when inspecting, repairing, reconciling, rebuilding, or documenting Pact server storage, SQLite metadata, raw objects, job artifacts, and upload session state.
---

# Pact Storage Ops

## Purpose

Operate server storage without guessing which script is safe to run.

## Workflow

1. Read `references/storage-ops-map.md`.
2. Start with read-only inspection.
3. Use reconcile only when file and SQLite state disagree.
4. Use rebuild metadata only when the SQLite index is stale or damaged.
5. Preserve raw objects unless coordinated deletion is explicitly intended.

Prefer package scripts over direct file edits.
