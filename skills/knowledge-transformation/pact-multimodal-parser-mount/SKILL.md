---
name: pact-multimodal-parser-mount
description: Use when implementing or configuring a Pact multimodal parser mount for images, screenshots, scanned PDFs, forms, figures, and visual document extraction.
---

# Pact Multimodal Parser Mount

## Purpose

Route visual documents to a richer parser than plain OCR.

## Workflow

1. Read `references/multimodal-contract.md`.
2. Implement `extractDocument` for layout-aware text, tables, forms, and figures.
3. Route `kindRoutes.image` or image extensions to `multimodalParser`.
4. Validate with `$pact-module-contract-test`.
5. Confirm route selection with `$pact-mount-routing-lab`.

## Rule

Do not return only image captions when visible document text exists.
