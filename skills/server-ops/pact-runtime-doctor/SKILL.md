---
name: pact-runtime-doctor
description: Use when diagnosing Pact server document runtime setup, including data dir, settings, Java, Tika jar, and optional sample extraction.
---

# Pact Runtime Doctor

## Purpose

Validate the server-side document parsing runtime before debugging higher-level ingestion behavior.

## Workflow

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/server-ops/pact-runtime-doctor/scripts/pact-runtime-doctor.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --data-dir /Users/unka/DevSpace/Unka-Malloc/Pact/$PACT_SERVER_DATA_DIR
```

With sample extraction:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/server-ops/pact-runtime-doctor/scripts/pact-runtime-doctor.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --sample sample.pdf
```

## Checks

- Repo shape and server modules.
- Persisted settings with secrets redacted.
- Tika jar discovery.
- Java runtime availability.
- Optional sample extraction through `extractDocumentWithTika`.
