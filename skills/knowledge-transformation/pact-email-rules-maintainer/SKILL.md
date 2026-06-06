---
name: pact-email-rules-maintainer
description: Use when editing, validating, or documenting Pact email analysis rules, synonyms, department aliases, report series, stop words, transaction merge rules, and stale retrieval windows.
---

# Pact Email Rules Maintainer

## Purpose

Change email analysis rules without causing silent regressions in people, transaction, and association extraction.

## Workflow

1. Read `references/email-rules-map.md`.
2. Back up the current rules JSON.
3. Make one focused rule change.
4. Run a known mail sample through the server.
5. Compare result counts, warnings, and representative transaction summaries.

Rules that affect merge thresholds need before/after artifacts.
