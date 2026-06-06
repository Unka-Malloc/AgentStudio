---
name: pact-result-export-cli
description: Use when a completed Pact job result needs to be saved as JSON or Markdown from the command line, or when choosing the current Pact DOCX export path for canonical knowledge or normalized job documents.
---

# Pact Result Export CLI

## Purpose

Save a Pact job result as a portable JSON or Markdown artifact, and route DOCX needs through the current Pact CLI surfaces.

## Workflow

Export a local `result.json` to Markdown:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/storage/pact-result-export-cli/scripts/pact-result-export.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --result-json $PACT_SERVER_DATA_DIR/jobs/JOB/result.json \
  --format md \
  --output pact-result.md
```

Export a live server job result:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/storage/pact-result-export-cli/scripts/pact-result-export.mjs \
  --server-url http://127.0.0.1:8787 \
  --job-id JOB \
  --format json \
  --output pact-result.json
```

Export canonical accepted knowledge as DOCX through the live Pact server:

```bash
npm --prefix /Users/unka/DevSpace/Unka-Malloc/Pact run cli -- \
  knowledge export-docx \
  --output pact-knowledge.docx
```

Download a normalized per-job source document as DOCX:

```bash
npm --prefix /Users/unka/DevSpace/Unka-Malloc/Pact run cli -- \
  jobs normalized-doc \
  --id JOB \
  --document-id DOCUMENT_ID \
  --output out.docx
```

## Rules

- The bundled script supports `json` and `md`.
- Use `knowledge export-docx` for canonical KnowledgeCore DOCX export.
- Use `jobs normalized-docs` to list per-job normalized documents, then `jobs normalized-doc` to download one DOCX.
- Do not call the removed legacy result-export endpoint; current Pact returns 404 for it.
- For raw document extraction, use `$pact-doc-extract-cli`.
