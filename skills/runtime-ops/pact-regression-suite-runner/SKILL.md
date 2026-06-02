---
name: pact-regression-suite-runner
description: Use when choosing and running targeted Pact regression checks for server runtime, uploads, checkpoints, storage operations, metadata rebuild, Flutter analysis, Flutter tests, or mount changes.
---

# Pact Regression Suite Runner

## Purpose

Run the smallest verification set that covers the changed behavior.

## Workflow

1. Read `references/regression-map.md`.
2. Identify changed area: runtime, API, upload, storage, client, or mount.
3. Run the matching package script or bundled Skill script.
4. Report command, result, and any skipped checks.

For mount changes, combine this with `$pact-module-contract-test` and `$pact-mount-routing-lab`.
