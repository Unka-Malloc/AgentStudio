---
name: pact-ocr-doctor
description: Use when diagnosing Pact OCR setup, PaddleOCR Python runtime, OCR script packaging, OCR language settings, or image and scanned PDF extraction failures.
---

# Pact OCR Doctor

## Purpose

Validate the OCR runtime before changing ingestion, mount routing, or client code.

## Workflow

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/server-knowledge/pact-ocr-doctor/scripts/pact-ocr-doctor.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact
```

With a sample image or scanned PDF:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/server-knowledge/pact-ocr-doctor/scripts/pact-ocr-doctor.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --sample scan.png
```

## Checks

- `server/platform/modules/knowledge/file-processor/FileNormalizer/OCR/paddle-ocr.mjs` exists.
- `ocr/paddle_ocr_extract.py` exists.
- Python runtime is callable.
- Optional sample call reaches `extractTextWithPaddleOcr`.
