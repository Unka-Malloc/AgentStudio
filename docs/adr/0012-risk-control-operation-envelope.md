# ADR 0012: Risk Control Operation Envelope

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Accepted
- Scope: Risk-control operation envelope, gate records, evidence locators, digest canonicalization, and verification responsibilities.
- Staleness check: Scanned on 2026-06-14; risk-control contract claims are tracked by current operation-envelope and audit/recovery verification gates.

## Status
Accepted

Pact will represent runtime risk-control evidence through a **Risk Control Operation Envelope** attached to the existing Intent Operation envelope. It is not a second operation protocol and not a centralized authorization engine: Capability Kernel, Binding Guard, Policy, Approval, Execution, Audit, and Recovery keep their enforcement responsibilities, while the envelope carries append-only gate records across `admit -> bind -> authorize -> approve -> execute -> audit/recover`.

External callers do not author trusted risk-control proof. If a client submits `riskControl`, `controlRef`, version, or digest fields, those values are hints at most and must be ignored, rejected, or replaced by server-appended records. Trusted `controlId@definitionVersion` plus `definitionDigest` values come from the validated Risk Control Registry and the enforcing components that append gate evidence.

The envelope records adopted version and digest references; it does not own version advancement or migration. `definitionVersion`, `storeVersion`, `profileVersion`, and their digests are domain identities from platform-managed registries. Rollout, adjacent migration, retirement, and compatibility behavior for those identities use Pact platform versioning, Platform Managed Migration, and Migration Path Config, including Capability Kernel contract or sealed-state changes referenced by risk-control records.

Each enforcing component can append only its own **Risk Control Gate Record**. A record includes the gate, `controlId@definitionVersion`, `definitionDigest`, decision, reason code, one or more **Risk Control Evidence References**, `enforcedBy`, `factSource`, timestamp, and execution component identity. No component may rewrite, delete, or reinterpret an earlier gate record; corrections, revocations, compensations, and recovery steps are expressed as later `audit/recover` records.

Gate records form a strict operation-local **Risk Control Gate Record Hash Chain**. The chain starts from an `operationAnchorDigest` over the canonical operation identity and input boundary, including `operationId`, `traceId`, `idempotencyKey`, API version, operation name, subject, operator, agent profile, workspace, intent, requested scopes, and input hash. The first record uses `recordSeq=0` and `previousRecordDigest=operationAnchorDigest`; every later record must increment `recordSeq` by one and set `previousRecordDigest` to the immediately preceding `recordDigest`.

`recordDigest` is calculated over the canonical gate record fields except `recordDigest` itself, including `recordSeq`, `previousRecordDigest`, gate, `controlId@definitionVersion`, `definitionDigest`, decision, reason code, evidence reference descriptors, optional inline evidence projections, `enforcedBy`, `factSource`, timestamp, and execution component identity. Missing records, duplicate sequence numbers, sequence gaps, forks, reordered records, anchor mismatch, digest mismatch, unresolved control references, or unresolved evidence references are hard validation failures. An operation with an invalid gate-record hash chain cannot be treated as risk-control complete; recovery must create a new `audit/recover` record or a separate recovery operation that references the invalid chain without rewriting it.

All Risk Control digests used by the operation envelope use the same **Risk Control Digest Canonicalization**: canonical JSON, SHA-256, and a domain-separated prefix. The digest input is the UTF-8 bytes of `<domain>\n<canonical-json>`, and the displayed digest format is `sha256:<domain>:<hex>`. The first domains are:

- `v0.0.1:strategy:risk-control-evidence-store-1`
- `v0.0.1:strategy:risk-control-evidence-governance-profile-1`
- `v0.0.1:strategy:risk-control-evidence-locator-1`
- `v0.0.1:strategy:risk-control-operation-anchor-1`
- `v0.0.1:strategy:risk-control-gate-record-1`
- `v0.0.1:strategy:risk-control-evidence-1`

Canonical JSON uses the JSON data model after domain normalization: object keys are sorted lexicographically, arrays preserve order, insignificant whitespace is forbidden, optional absent fields are omitted, `null` is used only when semantically present, timestamps are UTC ISO-8601 strings with `Z`, and non-finite numbers are rejected. Implementations must not hash JS object insertion order, pretty-printed JSON, locale-formatted values, process-specific serialization, or display/projection fields outside the declared digest boundary.

Gate-record evidence has one rule: every evidence item, regardless of size, sensitivity, or weight, must be registered and resolved. Each evidence item carries a full **Risk Control Evidence Locator**, the matching `evidenceLocatorId`, an adopted `classificationProfile`, an adopted `redactionPolicyProfile`, and an adopted `retentionProfile`. Each adopted profile reference includes `profileId@profileVersion` plus `profileDigest`, where `profileVersion` is formatted as `p<schema>.l<lifecycle>.c<contract>.r<revision>`.

```text
locatorVersion = v0.0.1:strategy:risk-control-evidence-locator-1
storeId
storeVersion
storeDigest
evidenceRef
evidenceDigest
```

`evidenceLocatorId` is the canonical digest of the locator, displayed as `sha256:v0.0.1:strategy:risk-control-evidence-locator-1:<hex>`. Gate records must store both the full locator payload and the locator ID. The locator ID is the global unified evidence ID for lookup, but it is not sufficient for trusted resolution without the payload. `classificationProfile`, `redactionPolicyProfile`, `retentionProfile`, and inline projection are not part of the locator digest; they are gate-record evidence governance fields. The Evidence Store supplies allowed profile references and defaults; the Control Definition supplies minimum evidence-governance profile requirements; the Gate Record records the actual adopted profile references and digests. Defaults may be applied before append, but persisted Gate Records must not depend on recalculating defaults later. `recordDigest` covers the full locator payload, the locator ID, evidence governance profile references and digests, and any allowed inline projection; verifiers must reject records where the locator ID does not match the canonical locator digest or the adopted profiles are unresolved, have digest mismatches, are disallowed by the Store, or are below the Control requirements.

Small, non-sensitive, structured evidence may additionally include a bounded inline projection, but that projection is a cache or display copy of the registered evidence entry, not an independent evidence source. Large evidence, sensitive evidence, provider receipts, raw request/response fragments, files, logs, screenshots, recovery packages, or secret-adjacent material must omit inline projection. The gate record digest must not require storing sensitive evidence bodies in the hash chain.

Each Risk Control Evidence Store registration declares its `storeId`, structured `storeVersion` formatted as `s<schema>.l<lifecycle>.c<contract>.r<revision>`, `storeDigest`, lifecycle state, authority, allowed `classificationProfile`, `retentionProfile`, and `redactionPolicyProfile` references, resolver, verifier, recovery behavior, and default evidence-governance profile references. Each Evidence Governance Profile registration declares `profileId`, structured `profileVersion` formatted as `p<schema>.l<lifecycle>.c<contract>.r<revision>`, `profileDigest`, profile kind, lifecycle state, comparable governance semantics, verification coverage, and profile-specific enforcement metadata. Only `active` store and profile versions may be selected for new gate records. `deprecated` and `retired` store or profile versions remain resolvable for historical verification and recovery, but they cannot be selected for new evidence. A newly appended gate record with an unknown `storeId@storeVersion`, mismatched `storeDigest`, non-active store version, unresolved `evidenceRef`, evidence digest mismatch, unresolved `profileId@profileVersion`, mismatched `profileDigest`, non-active profile version, disallowed profile, unsupported resolver, missing verifier, undefined recovery behavior, or adopted profiles below the Control Definition's minimum requirements is invalid. Historical gate records remain valid only if the referenced store and profile versions were eligible when the record was appended and remain resolvable under their contracts.

`storeVersion` does not cover incompatible identity changes. A new evidence authority, new `evidenceRef` namespace, or incompatible resolver, verifier, redaction, retention, or recovery meaning requires a new `storeId`; otherwise historical evidence would appear to resolve through the same store while carrying different semantics.

Evidence resolution follows one path: read the locator and adopted governance profile references from the gate record, recompute `evidenceLocatorId`, resolve `storeId@storeVersion` through the Evidence Store Catalog, resolve `profileId@profileVersion` references through the Evidence Governance Profile catalog, recompute and compare `storeDigest` and each `profileDigest`, invoke that store version's resolver with `evidenceRef`, recompute and compare `evidenceDigest`, verify that the adopted profiles satisfy both the Store contract and the Control Definition requirements, then enforce classification, redaction, retention, and recovery behavior before returning original evidence, a redacted projection, a recovery package, or an explicit unreadable reason.

Pact may build a **Risk Control Evidence Locator Index** as a projection from Operation Ledger and Gate Records. The index maps `evidenceLocatorId` to operation, gate record, control reference, and timestamp, and maps `evidenceDigest` to all locators referencing the same evidence body. This index is rebuildable and must not become a source of evidence truth.

## Considered Options

- **Per-component audit shapes only**: keeps local components simple, but makes doctor, recovery, and cross-gate trace reconstruction depend on ad hoc log joins.
- **Single risk-control authorization engine**: centralizes the flow, but collapses Capability Kernel, Binding Guard, Policy, Approval, Execution, Audit, and Recovery into one overpowered runtime layer.
- **Risk-control section on the existing Intent Operation envelope with append-only gate records**: preserves the existing operation protocol while giving every lifecycle gate a shared evidence carrier.

## Consequences

- Runtime control evidence must resolve to Registry definitions, including `controlId@definitionVersion` and `definitionDigest`, and to Evidence Store registrations through a full Evidence Locator plus matching `evidenceLocatorId`.
- Runtime control evidence records platform-managed version identities; the Risk Control Operation Envelope must not introduce a risk-control-specific or permission-kernel-specific migration mechanism.
- Gate-record integrity is strict: chain validation failures are not warnings and must block risk-control completion.
- Digest canonicalization is shared across verifier, doctor, audit, and recovery; any implementation that cannot reproduce the canonical digest cannot author trusted gate records.
- All evidence is referenced by registered, digest-bound Evidence Locators; gate records must not become secret, provider-receipt, file, screenshot, or raw log containers.
- Components append gate records through the envelope, but they do not execute DSL code as policy logic and cannot mutate records from earlier gates.
- Pending approval, audit, recovery, doctor, and trace can reconstruct the same risk-control chain from the operation record.
- Client-authored control references are never authoritative.
