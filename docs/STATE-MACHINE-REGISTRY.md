# State Machine Registry and Verification Specification

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: State Machine Registry and Verification Specification.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

This registry describes all machine-readable state machines in the Pact system, along with the verification properties validated by the static State Machine Verifier.

## Registered State Machines

Pact registers and enforces the following state machine lifecycles:

1. **`contribution.lifecycle`**
   - **Entity Type**: `workspace_contribution`
   - **Description**: Governs asset contributions across workspaces.
   - **Path**: `server/platform/common/state-machine/definitions/contribution.lifecycle.json`
   - **Initial State**: `submitted`
   - **Terminal States**: `rejected`, `revoked`

2. **`agentlibrary.loan`**
   - **Entity Type**: `knowledge_loan`
   - **Description**: Governs knowledge loan record lifecycles in the AgentLibrary.
   - **Path**: `server/platform/common/state-machine/definitions/agentlibrary.loan.json`
   - **Initial State**: `loan_requested`
   - **Terminal States**: `expired`, `revoked`, `returned`

3. **`checkpoint.restore`**
   - **Entity Type**: `checkpoint_restore`
   - **Description**: Governs request, preview, approval, and append-only recording lifecycle of restorations.
   - **Path**: `server/platform/common/state-machine/definitions/checkpoint.restore.json`
   - **Initial State**: `restore_requested`
   - **Terminal States**: `rejected`, `expired`, `completed`, `failed`

4. **`operation.narrow`**
   - **Entity Type**: `operation`
   - **Description**: Narrow path state machine for Pact operations, enforcing policy-before-side-effect ordering.
   - **Path**: `server/platform/common/state-machine/definitions/operation.narrow.json`
   - **Initial State**: `received`
   - **Terminal States**: `policy_denied`, `completed`, `failed`

5. **`production.readiness.lifecycle`**
   - **Entity Type**: `production_readiness_gate`
   - **Description**: Production Readiness Gate State Machine governing evidence collection, checks, waivers, and release candidate declaration.
   - **Path**: `server/platform/common/state-machine/definitions/production.readiness.lifecycle.json`
   - **Initial State**: `not_started`
   - **Terminal States**: `passed`, `failed`, `blocked`, `waiver_rejected`, `release_candidate`

6. **`version.artifact.lifecycle`**
   - **Entity Type**: `versioned_artifact`
   - **Description**: Governs Version Registry artifact lifecycle from draft through candidate, active, deprecated, and retired.
   - **Path**: `server/platform/common/state-machine/definitions/version.artifact.lifecycle.json`
   - **Initial State**: `draft`
   - **Terminal States**: `retired`

7. **`version.transition.lifecycle`**
   - **Entity Type**: `version_transition`
   - **Description**: Governs Version Transition migration actions from planning through dry-run, checkpoint, execution, verification, completion, recovery, rollback, or abandonment.
   - **Path**: `server/platform/common/state-machine/definitions/version.transition.lifecycle.json`
   - **Initial State**: `planned`
   - **Terminal States**: `completed`, `rolled_back`, `abandoned`

---

## Verifier Checks and Specifications

The state machine verifier (`server/platform/common/state-machine/state-machine-verifier.mjs`) validates definitions against the following criteria:

### C1: Schema Validation
- Ensures all definitions are valid JSON objects conforming to the type specifications.
- Validates the presence of required fields (`machineId`, `entityType`, `version`, `description`, `initialState`, `states`, `events`, `totalMatrix`, `invariants`, `proofObligations`).

### C2: Core Verification
- Validates that the initial state is defined in the states list.
- Validates that all states and events have unique IDs.
- Ensures all transitions list valid `from` and `to` states and valid `event` IDs.

### C2: Matrix Totality Check
- Scans all possible combinations of `State × Event`.
- Fails if any combination is omitted. Every transition must explicitly state its outcome (e.g. `legal_transition`, `illegal_transition`, `ignored_idempotent_event`, `requires_policy`, `requires_approval`, `requires_external_receipt`, or `deferred_async_transition`).

### C3: Reachability Analysis
- Uses a Breadth-First Search (BFS) graph traversal from the `initialState`.
- Asserts that all states defined in `states` are reachable.
- States that are designed to be entered via external systems/channels may bypass this check by declaring `"externalEntryState": true`.

### C3: Outgoing Transition Safety
- **Non-terminal States**: Every non-terminal state must have at least one outgoing legal/deferred transition that allows the state machine to progress (i.e. transitions to a different state). If a state is designed to wait indefinitely for external logic without standard outgoing transitions, it must declare `"passiveState": true` or `"waitingStateWithTimeout": true`.
- **Terminal States**: Outgoing cells in the transition matrix of a terminal state must only resolve to `illegal_transition` or `ignored_idempotent_event`. Reopening transitions are prohibited unless explicitly flagged with `"allowedReopenTransition": true` or `"allowedTerminalEvents"`.

### C3: High-Risk Transitions
- Any event declared with `"riskLevel": "high"` must have guards defined on its transition cell (using either `guards`, `requiredGuards`, or resolving directly to `requires_policy` / `requires_approval`).

### C3: Secret Hygiene and Absolute Paths
- Recursively scans the definition object for sensitive text patterns (e.g. API keys, secrets, tokens, cookie, Bearer authorization, SSH/SSL header boundaries, etc.).
- Excludes descriptive and label properties from scans.
- Permits standard redaction placeholding markers (e.g., prefixing with `<redacted-` or `redacted-`).
- Rejects any values matching local absolute directory paths (`/Users/`, `/home/`, `C:\`).

### C3: Invariants & Proof Mapping
- Asserts that invariants conform to the naming specification (`SM-GOV-xxx` or `SM-<MACHINE_PREFIX>-xxx`).
- Requires that every declared proof obligation matches a concrete checking entry inside the `proofMappings` array.

---

## Definition Versioning Policy

Definitions are versioned independently of Pact. The following rules govern version increments:
- **Patch (e.g. `1.0.0` -> `1.0.1`)**: Text revisions to descriptions/labels, testing metadata updates, or appending proof obligation mappings without altering execution semantics.
- **Minor (e.g. `1.0.0` -> `1.1.0`)**: Appending non-breaking events, or adding new recoverable/passive states.
- **Major (e.g. `1.0.0` -> `2.0.0`)**: Deleting states/events, modifying existing transition matrix cells (e.g., from `illegal` to `legal`), or relaxing terminal-state boundary conditions.
