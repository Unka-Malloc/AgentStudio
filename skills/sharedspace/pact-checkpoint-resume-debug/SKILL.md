---
name: pact-checkpoint-resume-debug
description: Use when debugging Pact upload checkpoint, upload session, chunk offset mismatch, manifest digest mismatch, retry, resume, or duplicate job creation behavior.
---

# Pact Checkpoint Resume Debug

## Purpose

Diagnose upload/resume failures across Flutter client state and server upload sessions.

## Workflow

1. Read `references/checkpoint-map.md`.
2. Compare local checkpoint id with server session id.
3. Fetch the server upload session and compare file offsets.
4. Resume from server `expectedOffset` after an offset mismatch.
5. Do not reuse a checkpoint id for a changed manifest.

For command line reproduction, use `$pact-batch-upload-cli`.
