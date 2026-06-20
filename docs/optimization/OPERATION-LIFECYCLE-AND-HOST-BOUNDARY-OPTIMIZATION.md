# Operation Lifecycle And Host Boundary Optimization

## Objective

Document the current operation lifecycle implementation without moving host responsibilities into Pactium. Pactium provides replay, recovery, append-condition, cursor, and trusted-head semantics for LicoLite hosts while remaining a proof substrate.

## Current State

Pactium's current lifecycle model includes:

- Operation Intent recording through `beginOperationIntent`.
- Operation Outcome recording through `appendOperationOutcome`.
- `recordOperation` as a convenience composition of intent plus outcome.
- Separate Intent Idempotency and Outcome Idempotency indexes.
- Conflict rejection when an idempotency key is reused with different input or output identity.
- Exactly one terminal outcome per intent.
- Synchronous Workspace Projection updates during operation commits.
- Append conditions checked before ledger append.
- Tracking cursors for global ledger and workspace projection pages.
- Trusted-head advancement with ledger consistency and optional signed-head verification.
- Recovery planning that returns deterministic non-executing tasks.

Host side effects remain intentionally outside Pactium.

## Reference Signals

| Reference | Relevant code | Takeaway |
| --- | --- | --- |
| Axon EventStorageEngine | `EventStorageEngine.java:71`, `EventStorageEngine.java:95`, `EventStorageEngine.java:119`, `EventStorageEngine.java:134` | Separate append, finite source, infinite stream, and tracking token APIs. |
| Axon DefaultEventStoreTransaction | `DefaultEventStoreTransaction.java:98`, `DefaultEventStoreTransaction.java:201`, `DefaultEventStoreTransaction.java:225` | Append conditions are derived from sourcing and resolved at commit time. |
| Axon GapAwareTrackingToken | `GapAwareTrackingToken.java:61`, `GapAwareTrackingToken.java:120`, `GapAwareTrackingToken.java:208`, `GapAwareTrackingToken.java:284` | Recovery cursors need to model gaps, advancement, coverage, and position. |
| Rekor/Trillian | Rekor `pkg/verify/verify.go:40`, Trillian `client/log_verifier.go:57` | Trusted-head advancement should be explicit, not implied by "latest local state". |

## Current Concepts

### Append Condition

`createAppendCondition` creates a protocol object that lets a host declare what it believes before appending:

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

`createTrackingCursor` creates a cursor for workspace projection and global ledger consumption:

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

For Pactium, `gaps` are usually empty because the local ledger append lane is ordered. They remain part of the cursor shape for imported bundles, partial proof material, or asynchronous host projection workflows.

### Trusted Head Store

Hosts can store and advance trusted heads:

```js
{
  trustStoreType: "pactium.trusted-head-store",
  ledgerId,
  lastTrustedHead,
  verifierManifestRef,
  updatedAt
}
```

The store belongs to the host or embedding application. Pactium provides verification and advancement helpers through `advanceTrustedHead`.

## API Surface

| API | Owner | Purpose |
| --- | --- | --- |
| `createAppendCondition(input)` | Pactium | Canonicalizes host preconditions. |
| `recordOperation({ appendCondition, ... })` | Pactium | Rejects writes when lifecycle/projection state no longer matches the condition. |
| `getLedgerCursor({ fromCursor, position, limit })` | Pactium | Returns ordered ledger facts and next cursor. |
| `getWorkspaceCursor({ workspaceId, fromCursor, limit })` | Pactium | Returns workspace projection entries and next cursor. |
| `advanceTrustedHead({ oldHead, newHead, proof, manifest })` | Pactium | Verifies consistency/signature and returns a new trusted head. |
| `planRecovery({ cursor, failures })` | Pactium | Produces deterministic repair/replay tasks without executing host side effects. |

## Host Boundary Rules

| Boundary | Pactium owns | LicoLite/host owns |
| --- | --- | --- |
| Operation facts | Canonical Intent/Outcome facts, ids, hashes, proof envelopes. | Deciding what operation means and when to dispatch side effects. |
| Append condition | Verifying declared preconditions against current proofs. | Choosing which preconditions matter for the workflow. |
| Host evidence | Hash-binding and critical extension verification. | Durable storage, retention, authorization, and policy semantics. |
| Recovery | Proof-safe cursors and deterministic plans. | Re-running business workflows, restoring side-effect evidence, operator UX. |
| Repair | Structured failure classification and deterministic repair planning. | Deciding whether and when to execute repairs; any future repair executor. |

## Current Implementation

### Append Conditions

1. `src/core/append-condition.js` canonicalizes and hashes append condition payloads.
2. `beginOperationIntent` checks:
   - required ledger head equals current head when provided;
   - required open-intent state matches current `lookupOpenIntent`;
   - required workspace roots match current workspace projection.
3. `appendOperationOutcome` checks:
   - intent exists;
   - terminal outcome absent unless idempotency replay applies;
   - required outcome state matches current `lookupOutcome`;
   - required causality refs are known or explicitly allowed missing.
4. The append condition hash is bound into proof material and checked during envelope semantic verification.

Conflicting writes fail before ledger append and produce structured verification failures.

### Cursors

1. Ledger cursors page through `ledger.pageEntries({ start, limit })`.
2. Workspace cursors page through the `workspace-order` index with bounded `indexEngine.scan`.
3. Cursor pages include the current head and cursor `headRef`.
4. Workspace cursor pages include order proofs for returned entries.
5. `verifyTrackingCursor` validates cursor hash bindings against context.

Hosts can resume projection processing from a cursor without scanning the whole workspace index.

### Trusted Head Advancement

1. `advanceTrustedHead` verifies consistency proof from old to new head.
2. It verifies new head signatures if a manifest is provided.
3. It returns the advanced trusted head object for host storage.

Offline bundle verification and host sync can use explicit trust advancement rather than "latest local head".

### Recovery Planning

1. `createRepairPlanner` accepts cursor context and lifecycle state.
2. Tasks are deterministic and non-executing.
3. Plan types include:
   - `resume-open-intent`;
   - `restore-missing-proof-material`;
   - `rebuild-derived-index`;
   - `request-host-evidence`;
   - `manual-conflict-resolution`.
4. Repair Facts are not appended because no repair executor exists.

Recovery plans explain what is missing and who owns the next action without inventing facts.

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
