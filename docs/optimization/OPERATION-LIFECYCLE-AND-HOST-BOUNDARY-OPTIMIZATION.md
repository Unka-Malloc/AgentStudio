# Operation Lifecycle And Host Boundary Optimization

## Objective

Strengthen Pactium's operation lifecycle without moving host responsibilities into Pactium. The target is better replay, recovery, and concurrency semantics for LicoLite hosts while preserving Pactium as a proof substrate.

## Baseline State

At the start of this optimization pass, Pactium already had a useful lifecycle model:

- Operation Intent is recorded by `beginOperationIntent` (`src/core/pactium-core.js:224`).
- Operation Outcome is recorded by `appendOperationOutcome` (`src/core/pactium-core.js:327`).
- `recordOperation` composes intent and outcome (`src/core/pactium-core.js:494`).
- Intent idempotency and outcome idempotency are separate (`src/core/pactium-core.js:36`, `src/core/pactium-core.js:45`).
- Exactly one terminal outcome per intent is enforced (`src/core/pactium-core.js:346`).
- Workspace projection is updated synchronously with ledger append (`src/core/pactium-core.js:109`).

The baseline model was good for proof receipts, but hosts still needed clearer recovery cursors, append conditions, and durable effect boundaries. The lifecycle/cursor pieces are now implemented; host side effects remain intentionally outside Pactium.

## Reference Signals

| Reference | Relevant code | Takeaway |
| --- | --- | --- |
| Axon EventStorageEngine | `EventStorageEngine.java:71`, `EventStorageEngine.java:95`, `EventStorageEngine.java:119`, `EventStorageEngine.java:134` | Separate append, finite source, infinite stream, and tracking token APIs. |
| Axon DefaultEventStoreTransaction | `DefaultEventStoreTransaction.java:98`, `DefaultEventStoreTransaction.java:201`, `DefaultEventStoreTransaction.java:225` | Append conditions are derived from sourcing and resolved at commit time. |
| Axon GapAwareTrackingToken | `GapAwareTrackingToken.java:61`, `GapAwareTrackingToken.java:120`, `GapAwareTrackingToken.java:208`, `GapAwareTrackingToken.java:284` | Recovery cursors need to model gaps, advancement, coverage, and position. |
| Rekor/Trillian | Rekor `pkg/verify/verify.go:40`, Trillian `client/log_verifier.go:57` | Trusted-head advancement should be explicit, not implied by "latest local state". |

## Target Concepts

### Append Condition

Add a protocol object that lets a host declare what it believes before appending:

```js
{
  conditionType: "pactium.append-condition",
  workspaceId,
  requiredLedgerHead,
  requiredWorkspaceOrderRoot,
  requiredOpenIntentState,
  requiredOutcomeState,
  expectedCausalityRefs
}
```

This is not a lock. It is a verifiable precondition. If the current ledger/projection does not satisfy it, Pactium rejects the append with a structured failure before writing a new fact.

### Tracking Cursor

Add a cursor for workspace projection and global ledger consumption:

```js
{
  cursorType: "pactium.tracking-cursor",
  scope: "ledger" | "workspace",
  workspaceId,
  position,
  gaps,
  headRef,
  orderRoot
}
```

For Pactium, `gaps` should be rare because the local ledger append lane is ordered. It is still useful when hosts import bundles, resume from partial proof material, or process workspace projections asynchronously.

### Trusted Head Store

Hosts should be able to store and advance trusted heads:

```js
{
  trustStoreType: "pactium.trusted-head-store",
  ledgerId,
  lastTrustedHead,
  verifierManifestRef,
  updatedAt
}
```

The store belongs to the host or embedding application. Pactium provides verification and advancement helpers.

## API Additions

| API | Owner | Purpose |
| --- | --- | --- |
| `createAppendCondition(input)` | Pactium | Canonicalizes host preconditions. |
| `recordOperation({ appendCondition, ... })` | Pactium | Rejects writes when lifecycle/projection state no longer matches the condition. |
| `getLedgerCursor({ fromHead, limit })` | Pactium | Returns ordered ledger facts and next cursor. |
| `getWorkspaceCursor({ workspaceId, fromCursor, limit })` | Pactium | Returns workspace projection entries and next cursor. |
| `advanceTrustedHead({ oldHead, newHead, proof, manifest })` | Pactium | Verifies consistency/signature and returns a new trusted head. |
| `planRecovery({ cursor, failures })` | Pactium | Produces deterministic repair/replay tasks without executing host side effects. |

## Host Boundary Rules

| Boundary | Pactium should own | LicoLite/host should own |
| --- | --- | --- |
| Operation facts | Canonical Intent/Outcome facts, ids, hashes, proof envelopes. | Deciding what operation means and when to dispatch side effects. |
| Append condition | Verifying declared preconditions against current proofs. | Choosing which preconditions matter for the workflow. |
| Host evidence | Hash-binding and critical extension verification. | Durable storage, retention, authorization, and policy semantics. |
| Recovery | Proof-safe cursors and deterministic plans. | Re-running business workflows, restoring side-effect evidence, operator UX. |
| Repair | Derived index rebuild proof and repair fact schema later. | Deciding whether and when to execute repairs. |

## Implementation Plan

### Phase 1: Append Conditions

1. Add `src/core/append-condition.js`.
2. Canonicalize and hash append condition payloads.
3. In `beginOperationIntent`, check:
   - required ledger head equals current head when provided;
   - required open-intent state matches current `lookupOpenIntent`;
   - required workspace roots match current workspace projection.
4. In `appendOperationOutcome`, check:
   - intent exists;
   - terminal outcome absent unless idempotency replay applies;
   - required outcome state matches current `lookupOutcome`;
   - required causality refs are known or explicitly allowed missing.
5. Bind the append condition hash into proof material.

Acceptance: conflicting writes fail before ledger append and produce structured verification failures.

### Phase 2: Cursors

1. Add ledger cursor read over `ledger/leaf/<index>` after the ledger storage optimization.
2. Add workspace cursor read over `workspace-order` index.
3. Include `headRef` and root proofs with every cursor page.
4. Add `covers`, `advanceTo`, and `samePositionAs` helpers inspired by Axon's tracking token behavior.

Acceptance: a host can resume projection processing from a cursor without scanning the whole workspace index.

### Phase 3: Trusted Head Advancement

1. Add `advanceTrustedHead`.
2. Verify consistency proof from old to new head.
3. Verify new head signature if a manifest is provided.
4. Return the advanced trusted head object for host storage.

Acceptance: offline bundle verification and host sync can use explicit trust advancement rather than "latest local head".

### Phase 4: Recovery Planning

1. Extend `createRepairPlanner` to accept cursor context and lifecycle state.
2. Keep tasks deterministic and non-executing.
3. Add plan types:
   - `resume-open-intent`;
   - `restore-missing-proof-material`;
   - `rebuild-derived-index`;
   - `request-host-evidence`;
   - `manual-conflict-resolution`.
4. Do not append repair facts until a separate repair executor exists.

Acceptance: recovery plans explain what is missing and who owns the next action without inventing facts.

## Tests

| Test | Purpose |
| --- | --- |
| Append condition success | Matching ledger/projection state allows append and binds condition hash. |
| Append condition conflict | Stale head/root/outcome state fails before ledger append. |
| Idempotency replay | Replay still returns existing envelope and does not append a fact. |
| Cursor paging | Ledger and workspace cursors page deterministically and resume exactly. |
| Cursor tamper | Cursor with wrong head/root/gaps fails verification. |
| Trusted head advancement | Valid consistency/signature advances; invalid proof/signature fails. |
| Recovery plan | Missing proof material and open intents produce deterministic non-executing tasks. |

## Non-Goals

- Do not add LicoLite side-effect execution to Pactium.
- Do not add a resident daemon.
- Do not implement a full Axon-style event framework.
- Do not append repair facts until the repair executor and proof schema are separately specified.
