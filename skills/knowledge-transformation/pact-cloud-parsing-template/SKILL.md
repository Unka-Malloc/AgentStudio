---
name: pact-cloud-parsing-template
description: Use when configuring Pact cloud document parsing, custom HTTP parsing headers and bodies, provider selection, model settings, source limits, or prompt template variables.
---

# Pact Cloud Parsing Template

## Purpose

Make cloud document intelligence configuration repeatable and auditable.

## Workflow

1. Read `references/cloud-parsing-template.md`.
2. Confirm provider and model settings.
3. Set source count and char limits before testing.
4. Put secrets in headers, not prompt text.
5. Validate response shape on a small document set before enabling broadly.

Use `$pact-server-config-index` when documenting how the setting appears in the console.
