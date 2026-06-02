---
name: pact-mail-parser-mount
description: Use when implementing or reviewing a Pact EML or MSG parser mount that preserves mail metadata, thread evidence, body text, attachments, and tables for knowledge ingestion.
---

# Pact Mail Parser Mount

## Purpose

Create a mail parser mount for `.eml` and `.msg` when the default document parser is insufficient.

## Workflow

1. Read `references/mail-parser-contract.md`.
2. Preserve subject, sender, recipients, date, message ids, and attachments in metadata.
3. Keep body text in reading order.
4. Do not degrade HTML tables into vague prose.
5. Route `.eml` and `.msg` to the mount.
6. Validate with `$pact-module-contract-test`.

Use the existing `$email-to-kb-doc` skill when the output target is DOCX or Markdown rather than server ingestion.
