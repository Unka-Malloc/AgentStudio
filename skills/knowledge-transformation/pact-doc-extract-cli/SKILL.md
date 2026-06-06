---
name: pact-doc-extract-cli
description: Use when Pact documents need to be extracted from PDF, DOCX, XLSX, PPTX, EML, MSG, or other Tika-backed files through a command line instead of the full client or server UI.
---

# Pact Doc Extract CLI

## Purpose

Expose the platform's existing Tika-backed document extraction path as a repeatable CLI workflow.

This is extraction, not arbitrary format conversion. It calls `server/platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs` and emits `json`, `txt`, or `md`.

## Workflow

1. Confirm the repo path, normally `/Users/unka/DevSpace/Unka-Malloc/Pact`.
2. Ensure runtime exists with `npm run server:setup-runtime` or use `$pact-runtime-doctor`.
3. Run the bundled script:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/knowledge-transformation/pact-doc-extract-cli/scripts/pact-doc-extract.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --input sample.pdf \
  --format json \
  --output sample.extract.json
```

## Notes

- Use `--format txt` for raw text.
- Use `--format md` when a human-readable artifact is needed.
- Use `--tika-jar` or `--java-bin` only for one-off overrides.
- If the user asks for DOCX output from an analysis job, use `$pact-result-export-cli` instead.
