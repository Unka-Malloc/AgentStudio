---
name: pact-console-operator-guide
description: Use when writing or updating operator documentation for the Pact server console, including settings, runtime modules, routing, storage, jobs, and client migration.
---

# Pact Console Operator Guide

## Purpose

Turn the server console from an implicit admin UI into an operator-facing runbook.

## Workflow

1. Read `references/console-map.md`.
2. Trace the UI control through `ServerConsoleApp.vue`, `bridge.ts`, and the HTTP controller.
3. Document what the control changes, where it persists, and how to verify it.
4. Include rollback or reset guidance for risky operations.

Prefer concrete API endpoints and file paths over prose-only descriptions.
