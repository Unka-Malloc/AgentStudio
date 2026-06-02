---
name: pact-document-parser-mount
description: Use when implementing a Pact custom document parser mount that returns parserId, metadata, text, embedded documents, and stable failure behavior for routed document formats.
---

# Pact Document Parser Mount

## Purpose

Build a custom parser for formats that Tika does not handle well, or route specific formats to a specialized parser.

## Workflow

1. Read `references/document-parser-contract.md`.
2. Implement `createMount`.
3. Route the target extensions in `mount-routing.json`.
4. Test with `$pact-module-contract-test`.
5. Test route resolution with `$pact-mount-routing-lab`.

## Guardrails

- Return text and metadata separately.
- Keep `parserId` stable.
- Preserve embedded documents where available.
- Throw on unsupported lossy cases instead of silently flattening content.
