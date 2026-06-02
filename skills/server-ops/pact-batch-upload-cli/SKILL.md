---
name: pact-batch-upload-cli
description: Use when files or folders need to be uploaded to a running Pact server via upload sessions, checkpoints, chunked transfer, and job polling from the command line.
---

# Pact Batch Upload CLI

## Purpose

Exercise the same upload session and checkpoint path used by the Flutter client without opening the client UI.

## Workflow

1. Start the server.
2. Run:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/server-ops/pact-batch-upload-cli/scripts/pact-batch-upload.mjs \
  --server-url http://127.0.0.1:8787 \
  --input ./mail-folder \
  --wait \
  --output-result result.json
```

## Behavior

- Recursively walks input folders.
- Hashes each file and creates a manifest digest.
- Creates or resumes `/api/upload-sessions`.
- Uploads by chunks with offset checks.
- Creates `/api/jobs` with `uploadSessionId`.
- With `--wait`, polls until completed and can save the result JSON.

Use this when debugging upload, checkpoint, or server ingest behavior.
