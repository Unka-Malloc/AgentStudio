# 0060. Normalize Runtime State and Add Terminal Receipts

Date: 2026-07-21

Status: Implemented

## Context

The previous runtime state still grew with operation history and was republished several times per lifecycle phase. Read-only host operations also paid the full Intent/Outcome cost even when they only needed a terminal audit receipt. This caused protocol-object write amplification, repeated serialization, and unbounded hot maps.

## Decision

- `core/runtime-state` is a fixed-size generation manifest containing only current index roots.
- Workspaces, lifecycle locators, replay claims, change claims, envelope locators, and causality locators are domain-separated records addressed by protocol hashes.
- SQLite publishes the records and manifest in one transaction. JSON writes each record to the slot opposite its latest published value and ignores records newer than the published manifest.
- A lifecycle phase publishes state exactly once. SQLite creates no lifecycle markers; successful JSON mutations delete their one finalized in-flight marker instead of retaining a completion history.
- Lookup paths load locator → ledger fact lazily; runtime maps are bounded to one call/publication boundary.
- `recordOperationReceipt` records one terminal `operation.receipt` fact and proof. `receipt` is idempotent; `on-change` performs an atomic digest comparison and writes nothing for an unchanged value.
- Receipt replay and unchanged responses do not call the final envelope hook and do not write blocks or protocol objects.
- The current layout is the only supported layout. Older aggregate runtime-state records are rejected; there is no dual reader.

## Consequences

The manifest write size is O(1), per-operation state publication is O(number of changed logical records), and cold lookup is O(1) protocol-object reads plus one ledger fact read. Read-only hosts can use one terminal receipt instead of two lifecycle facts. JSON retains crash detectability without overwriting the last published generation; SQLite relies on its transaction boundary.

This supersedes ADR-0059's CID map inside the aggregate state object. Envelope IDs now use independent locator records.
