# ADR 0009: Risk Control Registry and DSL

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: ADR 0009 - Risk Control Registry and DSL.
- Staleness check: Checked against current consolidated docs layout and referenced implementation evidence on 2026-06-16.

## Status
Accepted

## Context
The existing 2-3-5 control maps list control names by object, but they do not require each control to declare lifecycle gates, fact sources, fail-closed behavior, audit evidence, or verification coverage. That makes the model useful as documentation but too weak as a production risk-control contract.

## Decision
Every Risk Control Point must be explicitly registered in a **Risk Control Registry** and described through a small **Risk Control DSL**. The DSL is a JS/ESM declarative object or builder API with schema validation and JSON projection export, not a text DSL, YAML policy file, custom parser, or runtime scripting language.

The first core primitive set is:

| Primitive | Meaning |
| --- | --- |
| `control` | Declares the stable control point ID. |
| `owner` | Declares boundary, environment, and object ownership. |
| `gate` | Declares the lifecycle gate. |
| `enforcedBy` | Declares the component that actually enforces the control. |
| `factSource` | Declares the authoritative security fact source. |
| `binds` | Declares subject, credential, resource, or context binding. |
| `decision` | Declares decision shape such as allow, deny, needsApproval, or degraded. |
| `failsClosed` | Declares failure semantics and reason code. |
| `evidence` | Declares required audit or trace evidence and minimum evidence governance. |
| `verifiedBy` | Declares the registered verifier contract that proves the control definition and evidence obligations are covered. |

`projection` is deliberately not a core primitive in the first version. Console, documentation, and API projections are derived from validated Registry entries instead of shaping the DSL itself.

Existing `security/governance/*/controls.mjs`, `control-map.mjs`, and `controlsByObject` authoring surfaces are superseded by generated projections over the Registry. They may inform the migration inventory, but they must not remain as hand-written compatibility facades.

Legacy control-map strings such as `"Capability Kernel verify"`, `"risk policy"`, or `"destructive operation policy"` are **Risk Control Migration Sources** and optional display names only. They must not become `controlId` values. New controls use stable dotted IDs that encode the durable risk-control responsibility rather than the old human label, for example `platform.capability.verify.authorize`, `external.provider.scope.authorize`, or `client.identity.admit`.

Migration is not one-to-one from old strings to new controls. A single legacy control-map string may split into multiple Atomic Risk Control Points when it spans more than one lifecycle gate, enforcing component, fact source, or verifiable responsibility. The migration inventory records the legacy source label for traceability, but the new Registry is shaped by atomic risk-control responsibilities.

Legacy labels that name components or stores are classified into catalogs before controls are authored. Labels such as `"Operation Ledger"`, `"Checkpoint Tree"`, `"Tool Management"`, and `"Capability Kernel verify"` usually answer who enforces a control or where trusted facts come from; they migrate to `enforcedBy` or `factSource` catalog entries as appropriate, not to `controlId`. A new `controlId` names the governed responsibility, while `enforcedBy` and `factSource` name the component and authority used by that responsibility.

The canonical implementation home is `server/platform/common/security/risk-control`. It owns:

```text
model/
registry/
catalogs/
controls/
paths/
projections/
```

Risk Control versioning and migration are not standalone subsystems. `definitionVersion`, `storeVersion`, `profileVersion`, adopted component, fact-source, and verifier contract versions, plus their digests, are domain identity and evidence fields emitted from validated registries. Version advancement, adjacent migration, retirement, dry-run, checkpoint, retry, audit, recovery, and compatibility projection behavior are governed by Pact platform versioning, **Platform Managed Migration**, and **Migration Path Config**. Risk Control contributes `domainMapping`, validators, verifier evidence, and completion criteria; it must not introduce a domain-specific migration runner or parallel version registry.

Capability Kernel follows the same platform rule. Risk Control may reference Capability Kernel through `enforcedBy` or `factSource`, but Capability Kernel contract versions, sealed-state migrations, retirement, and recovery are owned by platform versioning and Platform Managed Migration rather than by a permission-kernel-specific migration framework.

`catalogs/` includes resolvable directories for `enforcedBy`, `factSource`, `verifiedBy`, **Risk Control Evidence Stores**, and **Risk Control Evidence Governance Profiles**. Evidence governance profiles include `classificationProfile`, `redactionPolicyProfile`, and `retentionProfile`; they are registered references, not free strings.

`enforcedBy` and `factSource` entries use stable catalog IDs, not code paths, module names, or display labels. Examples include `component.capability-kernel`, `component.tool-management`, `fact.operation-ledger`, and `fact.checkpoint-tree`. File moves, module splits, UI renames, or implementation refactors may update catalog metadata, but they must not change the catalog ID used by control definitions or Gate Records.

`verifiedBy` entries use stable verifier catalog IDs, not script paths, test names, CI job names, or display labels. Examples include `verifier.risk-control.registry-integrity`, `verifier.risk-control.evidence-locator`, and `verifier.platform-managed-migration.completion`. File paths, commands, test filters, CI jobs, run IDs, and output digests are catalog metadata or execution evidence; they are not the semantic verifier identity.

`enforcedBy` and `factSource` references are adopted versioned catalog references, not bare IDs. Control definitions and Gate Records record `enforcedById@componentContractVersion + componentDigest` and `factSourceId@factContractVersion + factSourceDigest`. Historical records resolve against the adopted catalog version and digest even after the current component or fact-source catalog entry advances.

`verifiedBy` references are adopted versioned catalog references, not bare verifier names. Control definitions, validation evidence, and migration-completion evidence record `verifierId@verifierContractVersion + verifierDigest`. Historical definitions resolve against the adopted verifier version and digest even after the current script path, test suite, or CI job advances.

Component, fact-source, and verifier catalog versions, digests, retirement, and migration use Pact platform versioning, **Platform Managed Migration**, and **Migration Path Config**. Risk Control records and verifies the adopted references; it does not own a separate component, fact-source, or verifier version manager.

`enforcedBy`, `factSource`, and `verifiedBy` catalog entries use the shared **Risk Control Catalog Entry Lifecycle**: `candidate`, `active`, `deprecated`, and `retired`. `candidate` entries may be validated but cannot be selected by production control definitions, Gate Records, or verifier evidence. `active` entries may be selected for new definitions, records, and verification evidence. `deprecated` and `retired` entries remain resolvable for historical audit, trace, doctor, and recovery, but they cannot be selected for new records or new proof obligations. `disabled` is not a catalog lifecycle state; runtime outage or unavailability is represented as health, degraded, or blocked capability state.

Each Evidence Governance Profile registration declares `profileId`, `profileVersion`, `profileDigest`, profile kind, lifecycle state, comparable governance semantics, verification coverage, and any profile-specific enforcement metadata. Profile references use `profileId@profileVersion` plus `profileDigest`. `profileDigest` uses the shared **Risk Control Digest Canonicalization** with the domain-separated prefix `v0.0.1:strategy:risk-control-evidence-governance-profile-1`.

Every Evidence Governance Profile registration carries a four-segment **Risk Control Evidence Governance Profile Version**:

```text
p<schema>.l<lifecycle>.c<contract>.r<revision>
```

The segments mean:

| Segment | Meaning |
| --- | --- |
| `p` | Evidence Governance Profile schema and digest-boundary version. |
| `l` | Evidence Governance Profile lifecycle state-machine version. |
| `c` | Compatible comparable-governance semantics contract version. |
| `r` | Immutable profile revision under that compatible contract. |

The versioning rules are:

- Profile schema or profile-digest-boundary changes bump `p`.
- Profile lifecycle state-machine or transition changes bump `l`.
- Compatible comparable-governance semantics or enforcement metadata refinements bump `c`.
- Profile revisions such as verifier additions, documentation corrections, display/projection changes, or non-contract metadata corrections bump `r`.

Evidence Governance Profile registrations use the simplified lifecycle `candidate`, `active`, `deprecated`, and `retired`. `candidate` profiles may be validated but cannot be selected by production gate records. `active` profiles may be used by Evidence Store defaults, Control Definition minimums, and new Gate Records. `deprecated` profiles remain resolvable for historical verification and recovery, but should not be selected for new records. `retired` is terminal and remains only for historical explanation. `disabled` is not a profile state.

Evidence stores are not free URLs or paths; each store registration declares `storeId`, structured `storeVersion`, `storeDigest`, lifecycle state, authority, allowed classification profile references, allowed retention profile references, allowed redaction-policy profile references, default evidence-governance profile references, resolver, verifier, and recovery behavior.

`storeId` is a permanent **Risk Control Evidence Store Identity**. The same `storeId` may only be reused while the evidence authority, `evidenceRef` namespace, and resolution meaning remain compatible. If a store changes authority, changes the reference namespace, or changes resolver, verifier, redaction, retention, or recovery semantics incompatibly, Pact must register a new `storeId`; the old store moves through the Evidence Store lifecycle so historical gate records remain explainable.

Risk Control Evidence Store registrations have a simplified lifecycle: `candidate`, `active`, `deprecated`, and `retired`. `candidate` registrations may be validated but cannot be selected by production gate records. `active` registrations may be selected for new gate records. `deprecated` registrations remain resolvable for historical verification and recovery, but are not selected for new gate records. `retired` is terminal: the catalog entry remains available to explain historical references and declared recovery or retention behavior, but it cannot be selected for new evidence. `disabled` is not a store state; backend outage or storage unavailability must be represented as degraded or blocked capability state, not as a mutable catalog definition.

Every Evidence Store registration carries a **Risk Control Evidence Store Version**. The version is a four-segment structured value:

```text
s<schema>.l<lifecycle>.c<contract>.r<revision>
```

The segments mean:

| Segment | Meaning |
| --- | --- |
| `s` | Evidence Store catalog schema and digest-boundary version. |
| `l` | Evidence Store lifecycle state-machine version. |
| `c` | Compatible store contract version for resolver, verifier, redaction, retention, and recovery behavior. |
| `r` | Immutable registration revision under that compatible contract. |

The versioning rules are:

- Evidence Store catalog schema or store-digest-boundary changes bump `s`.
- Evidence Store lifecycle state-machine or transition changes bump `l`.
- Compatible resolver, verifier, redaction, retention, or recovery contract refinements bump `c`.
- Registration revisions such as verifier additions, documentation corrections, display/projection changes, or non-contract metadata corrections bump `r`.
- Incompatible evidence authority, `evidenceRef` namespace, resolver, verifier, redaction, retention, or recovery changes require a new `storeId`, not just a `storeVersion` bump.

Gate-record evidence references bind through a **Risk Control Evidence Locator**. The locator is the structured payload that makes the global evidence ID traceable:

```text
locatorVersion = v0.0.1:strategy:risk-control-evidence-locator-1
storeId
storeVersion
storeDigest
evidenceRef
evidenceDigest
```

The global `evidenceLocatorId` is the canonical digest of that locator, displayed as `sha256:v0.0.1:strategy:risk-control-evidence-locator-1:<hex>`. Gate records must store both the full locator payload and the `evidenceLocatorId`; storing only the ID is invalid because it cannot be resolved without an external fact source. `storeDigest` uses `v0.0.1:strategy:risk-control-evidence-store-1`, and `evidenceDigest` uses `v0.0.1:strategy:risk-control-evidence-1`.

The Evidence Locator digest boundary is intentionally narrow. `classificationProfile`, `redactionPolicyProfile`, `retentionProfile`, inline projection, and gate-specific recovery handling are not part of `evidenceLocatorId`; they describe how a specific gate governs the evidence. Those fields must be covered by the Risk Control Gate Record `recordDigest`.

Evidence governance has three layers:

- The Evidence Store registration declares allowed `classificationProfile`, `redactionPolicyProfile`, and `retentionProfile` references plus default profile references, each resolved as `profileId@profileVersion` plus `profileDigest`.
- The Control Definition `evidence` primitive declares the minimum required `classificationProfile`, `redactionPolicyProfile`, and `retentionProfile` references for that control point.
- The Gate Record records the actual adopted `classificationProfile`, `redactionPolicyProfile`, `retentionProfile`, and recovery handling for each evidence item, including profile version and digest.

Defaults may be applied before a Gate Record is appended, but the persisted Gate Record must contain the actual adopted profile references and digests. A Gate Record is valid only when all adopted profiles resolve, their digests match, the profile versions were eligible for that record context, they are allowed by the Evidence Store, and they satisfy the Control Definition's minimum evidence-governance requirements according to the registered profile semantics.

The **Risk Control Migration Completion Verifier** is the Risk Control domain verifier set for the relevant **Platform Managed Migration**. It requires full internal migration to `server/platform/common/security/risk-control` and removal of legacy `server/platform/common/security/governance` implementation paths. Compatibility facades, independent model constants, hand-written control maps, and parallel authoring surfaces are not acceptable completion states.

`server/scripts/verify-risk-control-model.mjs` is the hard verifier for that platform-managed completion verifier. It verifies migration evidence; it is not an ad hoc migrator and must not become the owner of version advancement. The migration is incomplete if any of these checks fail:

- Any production import still targets `server/platform/common/security/governance`.
- Any old `security-governance-*` implementation file remains as an internal dependency.
- `server/scripts/verify-2-3-5-security-model.mjs` remains the authoritative verifier instead of being removed or replaced.
- Any Risk Control Point is authored outside `risk-control/controls`.
- Any console, doctor, docs, API, or `controlsByObject` view is hand-written instead of generated from the Registry.
- Any migrated control preserves a legacy control-map string as the `controlId` instead of a stable dotted ID.
- Any legacy control-map string that spans multiple verifiable responsibilities is forced into one umbrella control instead of being split into Atomic Risk Control Points.
- Any legacy component or store label is promoted to `controlId` instead of being classified into `enforcedBy` or `factSource`.
- Any `enforcedBy` or `factSource` value is a code path, module name, UI label, or display string instead of a stable catalog ID.
- Any `enforcedBy` or `factSource` reference omits the adopted contract version or digest, or has a digest mismatch against its catalog entry.
- Any `verifiedBy` value is a script path, test name, CI job name, UI label, or display string instead of a stable verifier catalog ID.
- Any `verifiedBy` reference omits the adopted verifier contract version or digest, or has a digest mismatch against its catalog entry.
- Any new control definition or Gate Record selects a non-active `enforcedBy` or `factSource` catalog entry.
- Any new control definition, validation evidence, or migration-completion evidence selects a non-active `verifiedBy` catalog entry.
- Any `enforcedBy`, `factSource`, or `verifiedBy` catalog entry uses `disabled` as a lifecycle state instead of representing runtime unavailability through health, degraded, or blocked capability state.
- Any semantic Registry reference, including `controlId@definitionVersion` and `definitionDigest`, cannot be resolved.
- Any gate-record evidence reference omits the full Evidence Locator payload, has a mismatched `evidenceLocatorId`, points to an unregistered `storeId@storeVersion`, mismatched `storeDigest`, store version that was not eligible for that record context, uses an unresolved `profileId@profileVersion`, has a mismatched `profileDigest`, uses a profile version that was not eligible for that record context, violates that store's evidence-governance contract, or fails the Control Definition's minimum evidence-governance requirements.
- Any old control map or compatibility facade can still be used as a source of risk-control truth.

Registry validity is enforced by a **Risk Control Validation Gate** at build, verifier, doctor, and server-boot time. Unknown primitives, duplicate control IDs, invalid owners or gates, missing `verifiedBy`, missing fail-closed reason codes, unresolved enforcing components, unresolved verifier references, unresolved Evidence Store references, unresolved evidence-governance profiles, mismatched verifier, Evidence Store, or Evidence Governance Profile digests, invalid Evidence Locator shape, or unsatisfied evidence-governance requirements must fail closed. At server boot, invalid Registry state blocks risk-controlled capabilities or marks them explicitly `degraded` / `blocked`; it must not silently start with partial controls.

Each Registry entry must be an **Atomic Risk Control Point**: one primary lifecycle gate, one primary `enforcedBy`, and one verifiable risk-control responsibility. High-level flows such as tool grant security are represented as multiple control IDs, for example `tool.grant.admit`, `tool.grant.bind`, `tool.grant.authorize`, and `tool.grant.audit`, rather than one umbrella control covering every gate.

End-to-end flows may be described as **Risk Control Paths**. A Path is a named Registry projection that references active atomic controls in order, such as:

```text
path: tool-grant-request
controls:
  - tool.grant.admit
  - tool.grant.bind
  - tool.grant.authorize
  - tool.grant.audit
```

Paths are for trace, doctor, console display, and documentation explanation. They do not execute authorization, do not replace atomic controls, and cannot reference inactive, retired, or unresolved controls. Request execution may record both `pathId` and the actual `controlRef` values traversed.

Registry semantic fields must be **Risk Control References**, not free-form strings. The first required resolvable fields are:

- `controlId`: stable dotted ID, unique, and never reused for a different control.
- `owner`: resolves to known 2-3-5 boundary, environment, and object IDs.
- `gate`: resolves to a known Risk Control Lifecycle gate.
- `enforcedBy`: resolves to a registered enforcement component as `enforcedById@componentContractVersion` plus `componentDigest`.
- `factSource`: resolves to a registered authoritative fact source as `factSourceId@factContractVersion` plus `factSourceDigest`.
- `verifiedBy`: resolves to a registered verifier as `verifierId@verifierContractVersion` plus `verifierDigest`; script, test, command, or CI path is catalog metadata and execution evidence, not the semantic reference.
- `evidenceLocator`: resolves to a registered `storeId@storeVersion` plus `storeDigest` and a digest-bound `evidenceRef` whenever a gate record references evidence.

The dotted segments of `controlId` are not parsed into Registry semantics. They may make IDs readable to humans, but `owner`, `gate`, `enforcedBy`, `factSource`, `verifiedBy`, and evidence requirements must be explicit Registry fields. Validation must reject any implementation that infers those fields by splitting a `controlId`.

Display names, descriptions, notes, and legacy control-map strings may remain free text, but they cannot drive validation, authorization, projection grouping, or audit semantics.

`controlId` is a permanent **Risk Control Identity**. Once a control enters the Registry, the ID cannot be deleted and reused, and its meaning cannot be silently changed. If the control's semantics change, Pact must register a new `controlId`; the old entry moves through the control lifecycle with an explicit `deprecated`, `supersededBy`, or terminal relationship so historical audit, trace, doctor, and recovery evidence remain explainable. Renaming display text, correcting capitalization, or preserving a legacy source label does not change `controlId`.

The lifecycle under discussion is the **Risk Control Definition Lifecycle**: the Registry definition state for a control point. It is separate from request-time execution and does not replace allow/deny/needsApproval/degraded decisions produced by runtime enforcement components.

The first definition-state set is:

| State | Meaning |
| --- | --- |
| `draft` | Authoring state; not emitted into production projections. |
| `candidate` | Structurally complete and verifiable, but not active. |
| `active` | Current production risk-control definition. |
| `deprecated` | Still explains history or compatibility paths, but should not be referenced by new controls. |
| `superseded` | Replaced by a newer `controlId`; keeps explicit replacement metadata. |
| `retired` | Historical explanation only; not used in new projections. |

`disabled` is not part of the first definition-state set. A Risk Control Point should not become a casual safety toggle; removal or replacement is modeled through `deprecated`, `superseded`, or `retired`, and affected capabilities must become explicit `degraded` or `blocked` when required controls are unavailable.

The first legal transition table is:

| From | To | Constraint |
| --- | --- | --- |
| `draft` | `candidate` | Candidate validation must pass before promotion. |
| `draft` | `retired` | Abandoned drafts may be retained as historical authoring records. |
| `candidate` | `active` | Must pass Risk Control Validation Gate. |
| `candidate` | `draft` | Allowed for rework. |
| `candidate` | `retired` | Allowed when a candidate is abandoned. |
| `active` | `deprecated` | Marks the control unsuitable for new references while preserving compatibility and history. |
| `active` | `superseded` | Must include `supersededBy` pointing to the replacing `controlId`. |
| `deprecated` | `active` | Compatibility rollback only; must include a reason. |
| `deprecated` | `superseded` | Must include `supersededBy`. |
| `deprecated` | `retired` | Allowed when no new projections should include the control. |
| `superseded` | `retired` | Allowed after historical replacement metadata is stable. |
| `retired` | terminal | No outgoing transition. |

Direct `active -> retired` is not allowed; the control must first become `deprecated` or `superseded` so audit, trace, doctor, and recovery consumers can understand why it left active use.

For a given `controlId`, only one definition version may be `active` at a time. Historical definitions may be retained for audit and recovery explanation, but production projections must resolve a `controlId` to a single active definition.

Every control definition carries a **Risk Control Definition Version** and **Risk Control Definition Digest**. The version is a five-segment structured value:

```text
m<model>.d<dsl>.l<lifecycle>.c<control>.r<revision>
```

The segments mean:

| Segment | Meaning |
| --- | --- |
| `m` | Risk Control Model version. |
| `d` | Risk Control DSL/schema version. |
| `l` | Risk Control Definition Lifecycle state-machine version. |
| `c` | Compatible contract version for this `controlId`. |
| `r` | Immutable definition revision under that compatible contract. |

Trace, audit, doctor, and recovery references must record the full `controlId@definitionVersion` plus `definitionDigest`, for example `capability.kernel.verify@m1.d1.l1.c1.r3` with `sha256:...`.

This structured version is a Risk Control domain version identity consumed by platform versioning. Adjacent changes between model, DSL, lifecycle, control-contract, Store, and Profile versions must be represented as Migration Path Config entries with Risk Control `domainMapping`, then executed and retired through Platform Managed Migration.

The versioning rules are:

- Risk-control semantics that change what the control means require a new `controlId`, not just a version bump.
- DSL primitive or schema changes bump `d`.
- Definition lifecycle state-machine or transition changes bump `l`.
- Compatible contract refinements for the same `controlId` bump `c`.
- Definition revisions such as verifier additions, evidence-field additions, display/projection changes, or documentation corrections bump `r`.

The `definitionDigest` is calculated from the canonicalized Registry definition and is used to detect silent rewrites, projection drift, or recovery mismatch. It uses the shared **Risk Control Digest Canonicalization**: canonical JSON, SHA-256, and the domain-separated prefix `v0.0.1:strategy:risk-control-definition-1`, displayed as `sha256:v0.0.1:strategy:risk-control-definition-1:<hex>`.

For `definitionDigest`, the digest input is the UTF-8 bytes of `v0.0.1:strategy:risk-control-definition-1\n<canonical-json>`. Canonical JSON uses the JSON data model after domain normalization: object keys are sorted lexicographically, arrays preserve order, insignificant whitespace is forbidden, optional absent fields are omitted, `null` is used only when semantically present, timestamps are UTC ISO-8601 strings with `Z`, and non-finite numbers are rejected. Verifiers must reject digests produced from JS object insertion order, pretty-printed JSON, locale-formatted values, process-specific serialization, or fields outside the declared digest boundary.

The first **Risk Control Digest Boundary** includes fields that affect risk-control semantics or evidence interpretation:

```text
controlId
definitionVersion
state
owner
gate
enforcedBy
factSource
binds
decision
failsClosed
evidence
verifiedBy
supersededBy
lifecycle constraints
```

The digest deliberately excludes display-only or projection-only fields:

```text
displayName
description
notes
docsUrl
UI grouping
sort order
```

This preserves historical integrity for control semantics while allowing copy, documentation, and presentation changes without invalidating prior audit, doctor, trace, or recovery references.

The first **Risk Control Evidence Store Digest Boundary** includes fields that affect evidence resolution, verification, redaction, retention, and recovery semantics:

```text
storeId
storeVersion
state
authority
evidenceRef namespace
resolution meaning
allowed classifications
retention capabilities
redaction-policy capabilities
resolver
verifier
recovery behavior
lifecycle constraints
```

The store digest deliberately excludes display-only and projection-only fields such as display name, description, documentation links, UI grouping, and sort order. Evidence body integrity remains covered by `evidenceDigest`; `storeDigest` covers the store contract that explains how the evidence is resolved and verified.

`enforcedBy`, `factSource`, and `verifiedBy` resolve through separate catalogs. `enforcedBy` names the component that performs or coordinates the control; `factSource` names the authoritative state used by that control; `verifiedBy` names the verifier contract that proves the control definition, catalog entry, migration result, or evidence contract is valid. All three values are adopted versioned catalog references with stable IDs, contract versions, and digests. The same underlying module may appear in more than one catalog only when it genuinely performs those distinct responsibilities, but the references must remain semantically separate.

The Registry describes and verifies the control surface. It must not become a single runtime authorization engine: Capability Kernel, Binding Guard, Policy/ABAC/Risk, Approval, Execution, Audit, and Recovery keep their separate enforcement responsibilities.

## Considered Options
- **JS/ESM declarative object DSL**: fits the existing governance modules, can be schema-checked in tests, and can export JSON for console/docs projections.
- **YAML or JSON DSL**: easy to read but pushes validation, constants, reuse, and migration into a separate parser/tooling path.
- **Custom text DSL**: concise but adds parser, editor, migration, and security-review burden without improving enforcement.

## Consequences
- A risk-control optimization is incomplete until it adds or updates Registry entries and verifier coverage.
- Console permission and safety screens become projections over registered controls, not the source of truth.
- The old string-only control maps are no longer an acceptable authoring surface; a control without Registry metadata is incomplete.
- Internal module paths should be broken and rewritten to converge on `risk-control`; this migration is not complete while legacy `security-governance` implementation paths or compatibility facades remain.
- Migration completion is mechanically verified as part of Platform Managed Migration; a green build without passing Risk Control completion verifiers is not a completed migration.
- Risk Control and Capability Kernel migrations must not introduce domain-specific migration runners, compatibility branches, or version registries outside Pact platform versioning, Platform Managed Migration, and Migration Path Config.
- Free-form strings in semantic fields are validation failures; the Registry must resolve IDs before it can emit projections.
- Audit and recovery can distinguish who enforced a control from which source supplied the trusted facts.
- The DSL must remain small and declarative; arbitrary callbacks or business logic hidden inside the DSL would recreate an unverifiable policy engine.
- Runtime evaluators consume the existing enforcement components and validated projections; they do not execute DSL code as policy logic.
- Request paths may record the `controlId` values exercised for audit and trace, but they do not call the Registry as an authorization decision engine.
