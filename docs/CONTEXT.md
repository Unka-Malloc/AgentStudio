# Pact

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: Pact.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

Pact is the governed collaboration context for agents, tools, workspaces, knowledge, and external capabilities. Its language emphasizes policy-mediated access, operation traceability, and auditable delegation.

## Language

**Appearance Preset / 外观方案**:
A local frontend display preset loaded from a JSON config file that selects the active semantic color token set for Pact UI across supported clients. The selected id is stored by each client as a local preference; Web server-imported preset files are persisted as local server data under `.pact-server-data/appearance-presets/`. It is not a server policy, account setting, tenant configuration, permission rule, or audited governance decision.
_Avoid_: theme mode, palette, server setting, account preference, tenant theme

**Source Agent**:
The ACP-capable agent that asks Pact to delegate work to another agent.
_Avoid_: requester, caller agent, main agent

**Target Agent**:
The agent that receives delegated work from Pact through a governed outbound connection.
_Avoid_: downstream bot, sub-agent

**Virtual Inbound Agent**:
A source-visible agent projection published by Pact that represents a target capability profile, including its modes, modalities, data-source envelope, tool class, and policy.
_Avoid_: generic relay endpoint, target alias

**Concrete Target**:
The actual local or remote agent runtime behind one or more virtual inbound agents.
_Avoid_: virtual agent, provider name

**Downstream Client Aspect**:
The client-facing aspect that owns agent framework MCP/ACP adapter layers, discovery/configuration projection, bootstrap manifest inputs, secretRef projection metadata, and protocol-to-platform route translation.
_Avoid_: downstream agent gateway, raw agent proxy

**Communication Service**:
The platform capability that owns ACP Relay and MCP Server Side as executable communication services reached through route policy and operation/security/audit gates.
_Avoid_: downstream adapter, raw socket proxy

**MCP Outlet**:
A stable top-level Pact MCP tool name that routes an intent operation envelope into a product capability family. It is the public agent-facing navigation surface, not a direct listing of every internal operation or upstream tool.
_Avoid_: operation id, raw tool name, compatibility alias

**AgentLibrary**:
The public Pact capability where agents discover, read, borrow, contribute, and reuse governed team assets from external knowledge sources and Pact-managed projections under auditable access rules. It owns access, transformation, and governance semantics for evidence, files, rules, expert input, and reusable agent-facing assets; `knowledgeBase` and `KnowledgeCore` are internal compatibility names, not product terms.
_Avoid_: Knowledge, knowledge base, knowledge processing, internal knowledge base, asset bucket

**AgentLibrary Native Capability Set**:
The five capabilities AgentLibrary owns as a product boundary: Library Access, Governed Projection, Rule Decision, Delivery Ledger, and Contribution Intake. Parsers, OCR, vector stores, graph stores, distillation services, export renderers, word bags, taxonomy, source sync, and maintenance jobs are adapters, stage workers, or projection helpers rather than native AgentLibrary capabilities.
_Avoid_: parser capability, index capability, distillation capability, word-cloud capability, taxonomy capability

**AgentLibrary Source Authority Policy**:
The rule that external knowledge sources remain the authoritative source of facts, indexes, and assets while Pact stores only governed projections, caches, receipts, ledgers, configuration, rule packages, and contributions. Local `KnowledgeCore` data is a development backend, compatibility wrapper, or cache sidecar, and conflicts with upstream authority create review items or contribution proposals rather than local fact overwrites.
_Avoid_: canonical KnowledgeCore, local fact source, mirrored internal knowledge base

**Governed Projection Boundary**:
The AgentLibrary boundary that wraps external objects or stage-worker outputs into governed document, section, block, evidence, and asset views with permission overlay, source trace, projection hash, TTL, and revocation policy. It does not perform parsing, OCR, embedding, graph merge, taxonomy inference, distillation summarization, or export rendering.
_Avoid_: projection engine, internal parser, indexing engine, distillation engine, export renderer

**Delivery Ledger Event**:
The AgentLibrary audit record for every governed information delivery or attempted delivery across search result, evidence read, citation, context injection, artifact write, export, checkout, distillation, memory write, tool passthrough, trace, and evaluation sample paths. It is a full-chain governance event with required identity, source, projection, permission, egress, receipt, revocation, and audit fields plus scenario-specific optional fields.
_Avoid_: search log, download log, best-effort audit event, minimal delivery record

**Contribution Intake Boundary**:
The AgentLibrary boundary where expert opinions, rule drafts, Skills, curated documents, and agent-generated materials enter as proposals or contributions rather than facts. Promotion can make them accepted governed evidence, active rule packages, or reusable assets, but it cannot make them external authoritative facts.
_Avoid_: direct fact write, trusted expert fact, promoted upstream fact, unreviewed agent knowledge

**Rule Decision Boundary**:
The AgentLibrary boundary where rule packages read projected facts, produce decisions, and emit typed effects for stage executors. Rules do not call filesystems, databases, external knowledge bases, models, networks, parsers, OCR, export renderers, workflows, or queues directly.
_Avoid_: workflow engine, scripting runtime, direct side-effect rule, rule-owned adapter

**Knowledge Processing**:
An internal implementation description for parsing, projection, indexing, distillation, and export work that supports AgentLibrary. It is not a product capability, MCP outlet, or internal replacement for an external knowledge base.
_Avoid_: knowledge product, internal knowledge base, agent-facing knowledge outlet

**AgentLibrary Delivery Chain**:
The single canonical processing chain for AgentLibrary: intent, external adapter query or hydration, governed projection, rule decision, and delivery or egress ledger. Source sync, parsing, distillation, export, taxonomy, word bags, maintenance, and rule authoring are stage capabilities attached to this chain, not independent product chains.
_Avoid_: knowledge pipeline, parsing pipeline, distillation pipeline, source pipeline, rule pipeline

**AgentLibrary Core Boundary**:
The responsibility boundary where Pact Core owns adapter contracts, governed projections and evidence packs, rule decisions, and delivery or egress ledger records. Heavy parsing, OCR, vector or graph indexing, distillation, source sync, word bags, taxonomy, export rendering, and local storage are adapter, stage worker, compatibility, or development-backend responsibilities.
_Avoid_: KnowledgeCore product boundary, built-in knowledge engine, internal knowledge base core

**AgentLibrary Public Surface**:
The user-facing and agent-facing navigation surface for AgentLibrary, organized around the AgentLibrary Delivery Chain rather than raw `knowledge.*` operation names. Non-rule operations such as `knowledge.search`, `knowledge.sources.*`, `knowledge.export.*`, and `knowledge.maintenance.*` may remain internal operation ids during migration, but they are not product menu names, MCP tool names, or capability categories; legacy rule operations are removed by AgentLibrary Legacy Rule Cleanup.
_Avoid_: knowledge management page, knowledge tool list, public knowledge operation catalog

**AgentLibrary Rule Package**:
The single user-facing and runtime rule model for AgentLibrary decisions, expressed directly as `v0.0.1:knowledge:rule-1` and attached to stages of the AgentLibrary Delivery Chain. Former email rules, expert vocabulary, golden rules, and rule-authoring output may enter only through AgentLibrary Rule Migration; their legacy APIs, stores, panels, and runtimes are removed after cutover rather than kept as compatibility rule models.
_Avoid_: email rule product, vocabulary rule product, golden-rule product, separate rule engines, legacy rule compatibility

**AgentLibrary Rule Migration**:
The AgentLibrary instance of Platform Managed Migration for Rule Package model changes, including legacy rule imports and future `pact.knowledge-rule.vN` to `vN+1` upgrades. It owns queue definition, migrator identity, progress, retry, dry-run, checkpoint, audit, completion verification, version retirement, and recovery evidence; if these pieces are not implemented, rule data or protocol migration is incomplete rather than handled by an ad hoc script.
_Avoid_: one-time migration tool, runtime compatibility compiler, manual JSON conversion, release note migration

**AgentLibrary Legacy Rule Cleanup**:
The one-time cleanup that removes legacy rule APIs, stores, panels, event topics, and runtime branches after AgentLibrary Rule Packages become the only rule model. It is a code and compatibility removal task, not a Platform Managed Migration, because it does not define a reusable versioned state-transition capability.
_Avoid_: rule cutover gate, platform migration, legacy rule compatibility, parallel rule model

**Agent Relay**:
The agent-to-agent communication capability where Pact mediates sessions, turns, target selection, and relay-scoped tool access between a source agent and a target agent.
_Avoid_: Agent Call, model gateway, raw agent proxy

**ServiceHub**:
The MCP outlet for invoking governed external services that have already been registered with Pact, including upstream MCP passthrough and compiled HTTP, OpenAPI, or RPC tools.
_Avoid_: external service registry, admin gateway, raw upstream proxy

**ServiceHub Registration Boundary**:
The rule that `pact.serviceHub` is an invocation and discovery outlet for already registered services, not a registration control plane. Creating, updating, refreshing, deleting, or binding secrets for external service registrations requires an operator/admin path, explicit authorization, and audit.
_Avoid_: agent self-registration, arbitrary URL tool, MCP registration proxy

**External Service Registration Template**:
A server-authored typed template that helps an operator or assisting agent turn a specific upstream service family into a complete `pact.external-service.config` manifest before registration. Templates may be exposed through read-only discovery as sanitized drafts and validation plans; they are not runtime shortcuts around the registration control plane.
_Avoid_: bare URL registration, sample JSON, agent-created connector

**ServiceHub Registration Draft**:
The minimal operator-facing external service configuration produced from a selected or inferable template before persistence. It contains only the stable service identity, upstream endpoint, and any protocol-required tool mapping fields; schema/kind/template identity, ServiceHub binding, policy preset, and production safety defaults are defaulted or materialized rather than hand-authored.
_Avoid_: full production manifest, policy dump, arbitrary URL form

**ServiceHub Materialized Manifest**:
The persisted external service manifest after ServiceHub applies template defaults, policy presets, secret binding status, lint results, verification evidence, and promotion metadata. It is the runtime contract, not the form shape humans are expected to hand-write.
_Avoid_: draft JSON, copied template, unchecked registration

**Static Registration Dry Run**:
A read-only external service registration check that evaluates a manifest draft without contacting the upstream service. It returns lint results, missing fields, egress policy plans, secretRef gaps, and contract verification steps.
_Avoid_: live probe, smoke test, hidden registration

**External Service Contract Verification**:
An operator/admin-controlled verification that may contact an upstream service through preapproved, audited, read-only probes before or after registration. It proves a contract boundary, not general network reachability.
_Avoid_: agent dry-run, arbitrary scanner, live registration

**Manifest-Bound Request Mapping**:
The ServiceHub invocation rule that an agent's input can only populate business fields declared by a registered manifest's schema and request mapping. Transport controls such as URL, method, path, authorization, and arbitrary headers belong to the manifest and server-side secretRef injection, not to per-call agent input.
_Avoid_: generic HTTP proxy, caller-supplied headers, dynamic URL forwarding

**ServiceHub Secret Binding Contract**:
The credential boundary for external service registrations. Templates and agent-visible drafts may produce secret slots and missing-secret diagnostics, but real secret values and secretRef binding changes are operator/admin control-plane actions stored in SecretStore and injected server-side at runtime.
_Avoid_: agent-submitted token, manifest secret value, tool-output credential

**Pact Local Stdio Interface Lockdown**:
The security hardening rule that Pact public interfaces do not expose local stdio. ServiceHub, external-service registration, raw MCP passthrough, ACP external-service registration, active composition presets, package scripts, and MCP discovery payloads must not register, start, forward, advertise, or package stdio processes, command transports, cwd/env launch descriptors, or local-process bridges. Historical stdio artifacts may remain only as retired audit records or disabled stubs. See `docs/security/design/0001-local-stdio-interface-lockdown.md`.
_Avoid_: stdio MCP forwarding, source-facing ACP stdio, local command bridge, inherited shell environment

**ServiceHub MCP Capability Firewall**:
The passthrough rule that ServiceHub bridges only upstream MCP tools into Pact tools. Upstream resources, prompts, roots, sampling, elicitation, logging, notifications, and client callbacks are blocked from direct downstream exposure.
_Avoid_: MCP resource passthrough, upstream prompt injection, reverse client callback

**ServiceHub Egress Policy**:
The default-deny network boundary for registered external service calls. A service may call only explicitly allowed protocol, host, port, and resolved address classes; private, loopback, link-local, metadata, container, and management networks require explicit operator/admin allowance.
_Avoid_: implicit network access, URL allowlist only, best-effort SSRF check

**ServiceHub MCP Session Isolation**:
The forwarding rule that external MCP passthrough session state is scoped to the Pact service, grant or subject, workspace or tenant, and auth binding. Pact may reuse low-level connection pools, but initialized MCP sessions, cursors, pagination tokens, conversation ids, and upstream auth context cannot be shared across agent authorization boundaries.
_Avoid_: shared upstream session, cross-agent cursor reuse, leaked MCP session id

**ServiceHub Tool Adoption Gate**:
The governance step that turns upstream-discovered tools into Pact virtual operations only after namespacing, metadata sanitization, schema validation, risk classification, fingerprinting, and authorization policy checks.
_Avoid_: raw tools/list mirror, trusted upstream prompt, auto-publish

**ServiceHub Versioned Promotion Contract**:
The release rule that external service registration, endpoint, secret, egress, schema, metadata, and tool changes enter a candidate catalog version before affecting production. Operator/admin promotion or rollback controls which version is active.
_Avoid_: live refresh, cache overwrite, direct schema mutation

**ServiceHub Grant Projection Contract**:
The visibility and authorization rule that exposes external service tools only when the current grant satisfies service, operation, risk, tenant, workspace, egress, data class, and secret-binding constraints. Tool listing is a filtered projection, not an execution permit.
_Avoid_: adopted means visible, tools/list as auth cache, cross-tenant service grant

**ServiceHub Health And Circuit Breaker**:
The runtime availability boundary for registered external services. Tool visibility comes from the adopted catalog, while health state controls invocation behavior, fail-fast protection, recovery probes, and standardized upstream-unavailable errors.
_Avoid_: disappearing tools, health-driven catalog rewrite, retry storm

**ServiceHub Deadline And Cancellation Contract**:
The execution boundary that gives every external service call a server-enforced deadline, concurrency lease, and orphan cleanup path. Cancellation may be propagated upstream, but side-effecting calls are not considered cancelled unless Pact can prove the upstream outcome.
_Avoid_: caller-controlled timeout, leaked in-flight call, cancel-as-success

**ServiceHub Outbound Payload Governance**:
The request-shaping boundary for data sent from Pact to an upstream external service. It limits outbound fields, data classes, size, depth, asset references, hidden prompts, workspace content, AgentLibrary content, and secret-like values before egress.
_Avoid_: external data exfiltration, raw workspace dump, prompt leakage

**ServiceHub Mapping Sandbox Contract**:
The deterministic sandbox for request mapping, response mapping, body templates, error mapping, and transforms in external-service manifests. It allows only a declarative safe subset with strict resource limits and no eval, script execution, filesystem, network, environment, process, or dynamic auth/header/URL override.
_Avoid_: mapping as code execution, env leak, dynamic proxy escape

**ServiceHub Output Governance**:
The result-shaping boundary for external service calls before data reaches an agent. It normalizes allowed response types, limits size, redacts sensitive content, strips upstream transport metadata, and converts large or binary outputs into governed asset references.
_Avoid_: raw upstream response, header passthrough, inline binary dump

**ServiceHub Streaming And Backpressure Contract**:
The runtime boundary for upstream streaming responses and events. It prevents raw stream passthrough by enforcing chunk-level output governance, event allowlists, byte/time/rate limits, bounded buffers, cancellation, partial-result policy, and backpressure before data reaches agents.
_Avoid_: raw SSE passthrough, unbounded stream, chunk bypass

**ServiceHub Quota And Bulkhead Contract**:
The resource-isolation boundary for ServiceHub external calls. It enforces per service, operation, tenant, workspace, grant, subject, auth-binding, stream, byte, connection, worker, retry, queue, token, and cost budgets so one upstream or agent cannot exhaust global ServiceHub capacity.
_Avoid_: noisy upstream, shared worker exhaustion, runaway model bill

**ServiceHub Error Taxonomy And Retry Hint Contract**:
The stable error language for ServiceHub external calls. It normalizes policy, mapping, egress, quota, stream, output, upstream, cancellation, and unknown-outcome failures into agent-safe categories with retry guidance and audit linkage.
_Avoid_: provider error passthrough, stack trace leak, blind retry advice

**ServiceHub External Call Receipt**:
The redacted audit receipt emitted for every ServiceHub invocation. It records service, catalog version, operation, grant, policy, egress, outbound governance, mapping sandbox, quota/bulkhead, error taxonomy, reconciliation, secret fingerprint, deadline, retry, circuit, streaming/backpressure, output governance, and outcome evidence without storing secrets, raw headers, raw URL queries, request bodies, provider debug data, or response bodies.
_Avoid_: raw request log, provider debug dump, missing external side-effect audit

**ServiceHub Production Verification Matrix**:
The machine-verifiable release gate for ServiceHub MCP wrapping and forwarding. It blocks production promotion unless outlet, legacy-removal, template dry-run, HTTP/HTTPS-only raw MCP, outbound payload, mapping sandbox, egress, secret, adoption, grant projection, capability firewall, quota/bulkhead, error taxonomy, reconciliation, deadline, circuit, streaming/backpressure, promotion, output governance, and external-call receipt contracts all pass.
_Avoid_: checklist-only readiness, docs-only security, unverified wrapper

**ServiceHub Retry Semantics**:
The execution rule that external service retries are opt-in and tied to operation risk, idempotency, and ledger evidence. Non-read operations default to no automatic retry; timeout outcomes are treated as unknown until recovered through a governed status or recovery path.
_Avoid_: blind retry, at-least-once write, timeout as failure

**Unknown External Outcome**:
The state of an external service call when Pact cannot prove whether the upstream side effect happened, commonly after timeout, connection loss, or ambiguous upstream failure. It blocks automatic replay and requires status reconciliation, recovery, or operator/agent-visible handling.
_Avoid_: failed write, safe retry, ignored timeout

**ServiceHub Reconciliation And Recovery Contract**:
The governed closure path for side-effecting ServiceHub calls that may leave an unknown external outcome. It requires manifest-declared idempotency, status query, reconciliation, compensation, or operator recovery paths before risky tools are promoted.
_Avoid_: stuck unknown outcome, blind replay, manual log archaeology

**Risk Control Model**:
The top-level model Pact uses to control admission, identity, permission, behavior, keys, credentials, and risk across agent, platform, and external-service boundaries.
Also called: 风控模型
_Avoid_: security governance model, permission model, security settings

**Risk Control Module**:
The Pact module boundary that owns Risk Control Model definitions and their validated projections.
_Avoid_: security governance module, control-map source, console permission module, risk-control-owned version manager

**Risk Control Migration Completion Verifier**:
The Risk Control domain verifier that proves a platform-managed migration has fully moved risk-control authority to the new model.
_Avoid_: standalone acceptance gate, standalone migrator, compatibility facade, partial migration, parallel governance module

**Risk Control Migration Source**:
A legacy label or source artifact retained only to explain where a Risk Control concept came from during migration.
_Avoid_: control identity, Registry fact, migration unit

**Risk Ownership Axis**:
The classification axis in the Risk Control Model that assigns each control to a boundary, environment, and object from the 2-3-5 model so risk ownership is explicit.
_Avoid_: UI grouping, module category

**Risk Control Lifecycle**:
The execution axis in the Risk Control Model that places controls along admit, bind, authorize, approve, execute, and audit/recover.
_Avoid_: permission flow, API sequence

**Risk Control Point**:
A governed check or transition in the Risk Control Model that declares its risk owner, lifecycle gate, fact source, failure semantics, and audit evidence.
_Avoid_: ad hoc check, permission flag

**Atomic Risk Control Point**:
A Risk Control Point with one primary lifecycle gate, one primary enforcement component, and one verifiable risk-control responsibility.
_Avoid_: workflow umbrella, multi-gate control, feature flag

**Risk Control Path**:
A named Registry projection that composes active Atomic Risk Control Points into an end-to-end risk-control flow for trace, doctor, console, and documentation use. It does not execute authorization or replace atomic controls.
_Avoid_: workflow engine, umbrella control, runtime policy

**Risk Control Operation Envelope**:
The request-scoped risk-control section of Pact's existing Intent Operation envelope. It carries append-only Risk Control Gate Records across admit, bind, authorize, approve, execute, and audit/recover without replacing the enforcing components.
_Avoid_: second operation protocol, centralized authorization engine, client-authored control proof

**Risk Control Gate Record**:
An append-only request evidence record for one Risk Control Lifecycle gate. Later gates cannot mutate earlier records.
_Avoid_: mutable gate state, overwritten audit field, cross-gate patch

**Risk Control Evidence Reference**:
A digest-bound reference from a Risk Control Gate Record to a registered evidence entry.
_Avoid_: free evidence field, raw provider receipt in trace, unverified evidence pointer

**Risk Control Evidence Governance**:
The classification, redaction, retention, and recovery policy adopted for an evidence item in a Gate Record.
_Avoid_: locator identity, UI label, evidence body checksum

**Risk Control Evidence Governance Profile**:
A registered classification, redaction policy, or retention profile that gives evidence-governance values stable meaning.
_Avoid_: free classification label, ad hoc redaction mode, retention text

**Risk Control Evidence Governance Profile Lifecycle**:
The state model that governs whether an Evidence Governance Profile may be selected for new gate records while preserving historical meaning.
_Avoid_: UI visibility, policy toggle, profile enabled flag

**Risk Control Evidence Governance Profile Version**:
A domain version identity attached to an Evidence Governance Profile registration. Platform-governed version strings use the Version Governance Prefix before their domain-native segments.
_Avoid_: release version, display revision, policy rollout number, profile-owned migration framework

**Risk Control Evidence Governance Profile Digest**:
The digest of a canonicalized Evidence Governance Profile registration. It proves the referenced classification, redaction, or retention meaning has not drifted after a gate record recorded a profile reference.
_Avoid_: display checksum, policy label hash, release tag

**Risk Control Evidence Locator**:
A structured, resolvable identity payload for a Risk Control evidence entry.
_Avoid_: raw URL, file path, opaque hash only

**Risk Control Evidence Locator ID**:
The global unified ID derived from a canonical Risk Control Evidence Locator digest.
_Avoid_: global sequence, database primary key, locator without payload

**Risk Control Evidence Locator Index**:
A rebuildable projection from Risk Control Gate Records for evidence lookup and recovery.
_Avoid_: evidence registry, source of truth, mutable audit table

**Risk Control Evidence Store**:
A registered authority that owns or resolves Risk Control evidence entries for gate records.
_Avoid_: free URL, raw file path, ad hoc inline evidence

**Risk Control Evidence Store Identity**:
The stable `storeId` identity of an Evidence Store. It cannot be reused for a different authority, evidence-reference namespace, or incompatible resolution meaning; incompatible replacement requires a new `storeId`.
_Avoid_: storage alias, mutable backend name, reused bucket key

**Risk Control Evidence Store Catalog**:
The registered catalog of Risk Control Evidence Stores available to gate records.
_Avoid_: evidence URL allowlist, implicit storage backend, per-control evidence config

**Risk Control Evidence Store Lifecycle**:
The state model that governs whether an Evidence Store may be selected for new gate records while preserving historical resolution and recovery meaning.
_Avoid_: storage health status, backend availability flag, disabled store

**Risk Control Evidence Store Version**:
A domain version identity attached to an Evidence Store registration. Platform-governed version strings use the Version Governance Prefix before their domain-native segments.
_Avoid_: package version, bucket version, migration number, store-owned migration framework

**Risk Control Evidence Store Digest**:
The digest of a canonicalized Evidence Store registration. It proves the referenced store contract has not drifted after a gate record recorded `storeId@storeVersion`.
_Avoid_: evidence body digest, storage checksum, deployment hash

**Risk Control Gate Record Hash Chain**:
The strict operation-local integrity chain over Risk Control Gate Records.
_Avoid_: best-effort checksum, trace decoration, mutable evidence list

**Risk Control Digest Canonicalization**:
The canonicalization rule used before computing Risk Control digests.
_Avoid_: JSON.stringify hash, pretty JSON hash, locale-dependent digest

**Risk Control Identity**:
The stable dotted `controlId` identity of a Risk Control Point. It is not the display name, legacy control-map string, or source of other Registry semantics.
_Avoid_: display name, mutable slug, reused permission key, legacy control string, parsed namespace

**Risk Control Definition Lifecycle**:
The state model for a Risk Control Point's Registry definition. It does not describe a single request's allow, deny, approval, or degraded execution result.
_Avoid_: request execution state, authorization decision status, audit event status

**Risk Control Definition Version**:
A domain version identity attached to a Risk Control Point definition. Platform-governed version strings use the Version Governance Prefix before their domain-native segments.
_Avoid_: integer revision, package version, release tag, control-owned migration framework

**Risk Control Definition Digest**:
The digest of a canonicalized Risk Control Point definition. It proves the referenced definition has not drifted or been silently rewritten after audit, doctor, trace, or recovery evidence was recorded.
_Avoid_: display checksum, file mtime, git commit

**Risk Control Digest Boundary**:
The boundary that decides which canonical Risk Control Point fields contribute to the definition digest. It covers fields that affect risk-control semantics or evidence interpretation, not display text, documentation links, UI grouping, or sort order.
_Avoid_: full file hash, display-field checksum, UI projection digest

**Risk Control Registry**:
The authoritative catalog of Risk Control Points and their domain relationships.
_Avoid_: documentation table, console menu, permission list

**Risk Control Projection**:
A derived view exported from the Risk Control Registry for compatibility, console display, documentation, or API responses. Projections must not become independent fact sources for controls.
_Avoid_: source registry, hand-written control map, UI-owned permission model

**Risk Control Validation Gate**:
The validation boundary that proves the Risk Control Registry is coherent before risk-controlled capabilities are considered available. It does not perform per-request authorization.
_Avoid_: runtime authorization engine, best-effort doc check, warning-only validation

**Risk Control Reference**:
A Registry value that must resolve to a known Risk Control concept before it can carry risk-control semantics.
_Avoid_: free-form control field, documentation-only reference, implied component name

**Risk Control Enforcement Component**:
A versioned catalog identity for the component that actually enforces a Risk Control Point.
_Avoid_: fact source, UI module, documentation owner, code path, display name

**Risk Control Fact Source**:
A versioned catalog identity for the authoritative source of security or risk-control facts.
_Avoid_: enforcement component, display projection, cache, code path, display name

**Risk Control Verifier**:
A versioned catalog identity for the verifier that proves a Risk Control definition, catalog entry, migration result, or evidence contract is valid.
_Avoid_: script path, test path, CI job name, ad hoc check

**Risk Control Catalog Entry Lifecycle**:
The state model governing whether a Risk Control catalog entry may be selected for new definitions or records while remaining explainable for history.
_Avoid_: runtime health, availability status, disabled flag

**Risk Control DSL**:
The small declarative language Pact uses to describe Risk Control Points and their proof obligations.
_Avoid_: policy engine, scripting language, UI config format, YAML policy

**Risk Control Primitive**:
A minimal vocabulary element in the Risk Control DSL.
_Avoid_: plugin hook, arbitrary callback, business rule

**Permission Decision Model**:
The request-time model that decides whether a subject may perform a specific operation against a specific resource under current policy, risk, binding, and approval context.
_Avoid_: risk control model, ACL check

**Capability Kernel**:
The narrow authority boundary that answers whether a capability credential may exercise a named platform capability. It does not model identity, roles, organizations, or business resource policy.
_Avoid_: RBAC engine, permission database, permission-kernel migration subsystem

**Pact Work Queue**:
The platform-owned queue of governed asynchronous work items shared across Pact capabilities. It names the scheduling boundary, not a particular worker runtime or external middleware.
_Avoid_: import job queue, background task list, NATS clone

**Work Queue Resource Module**:
The platform infrastructure module that owns Pact Work Queue primitives as resource-management capability. Upper-layer job managers, workflow activities, and business services adapt to it instead of owning queue scheduling semantics.
_Avoid_: application job manager, workflow engine, capability-specific queue core

**Legacy Job History Compatibility**:
The migration boundary for existing JobManager records. Historical job metadata and results remain queryable as upper-layer business history, but they are not forced into the new queue transition journal or treated as new queue scheduling facts.
_Avoid_: forced journal migration, legacy job as work item, queue-owned job history

**Pact Work Queue Store**:
The durable store that is the source of truth for Pact Work Queue scheduling state. It is linked to operation facts for governance and audit, but operation ledgers do not replace the queue store's lease, retry, delay, acknowledgement, or dead-letter indexes.
_Avoid_: operation ledger table, job result store, workflow history store

**Work Queue Store Database**:
The dedicated durable database and migration set owned by the Work Queue Resource Module for queue scheduling state. It replaces application-specific file metadata as the queue fact source and must not reuse upper-layer job result or payload stores as queue state.
_Avoid_: JobManager meta store, result file store, shared business database table

**Work Queue Schema Migration**:
The governed migration process for queue store schema, projection, snapshot, and journal compatibility. Migrations must prove that queue projections can still be rebuilt from the journal and verified snapshots before and after the change.
_Avoid_: ad hoc ALTER script, projection-only migration, unverified store upgrade

**Version Governance Module**:
The platform infrastructure module that owns Pact version governance across platform, protocol, schema, capability package, runtime dependency, migration path, compatibility projection, retirement state, and version evidence references. It is not git/source control and not release-readiness governance; release pages and production gates consume its facts but do not own them.
_Avoid_: Version Control Module, release page, production gate, git source control, domain-owned version registry, startup compatibility branch

**Versioned Artifact**:
A Pact-governed version identity for one independently versioned platform artifact, such as a platform capability, protocol, schema/store, capability package, runtime dependency, configuration policy, or compatibility projection. A platform version is an assembly view over versioned artifacts, not the only version fact.
_Avoid_: global version number, release tag, git commit, deployment build, feature flag

**Version Artifact ID**:
The stable dotted identity of a Versioned Artifact, independent of any specific version value.
_Avoid_: display name, file path, package name, runtime provider id, feature flag

**Version Artifact Reference**:
The canonical reference to one Versioned Artifact at one version, written as `artifactId@version`. It identifies a governed version fact without implying payload location, release status, or production readiness.
_Avoid_: git tag, release claim, latest pointer, artifact path, build number

**Governed Version String**:
A parseable Pact version value written as `v<platform-version>:<domain>:<subsection>-<version>` with optional additional `<axis>-<version>` segments. The first segment is the platform version baseline, the second segment is the stable governance domain, and the remaining segments identify the governed subsection or axis.
_Avoid_: bare DSL version, protocol family name, semver-only value, per-domain prefix, release tag

**Version Governance Prefix**:
The leading platform version segment of a Governed Version String, such as `v0.0.1`. It is shared by all governed platform, protocol, schema, state-machine, storage, workspace, and risk-control versions in the same platform baseline.
_Avoid_: per-domain version prefix, bare version, DSL-only prefix, semver-only version, protocol family name

**Version Artifact Lifecycle**:
The shared lifecycle for Versioned Artifacts in the Version Registry: draft, candidate, active, deprecated, and retired. It governs whether a version fact can be verified, selected, newly bound, historically interpreted, or only retained for migration and recovery.
_Avoid_: release lifecycle, deployment status, health status, feature flag state, domain runtime state

**Version Transition**:
A governed migration action that moves one Versioned Artifact from one Version Artifact Reference to another. It owns dry-run, checkpoint, execution, verification, retry, rollback, abandonment, audit, recovery, and acceptance evidence for that migration action.
_Avoid_: startup migration runner, release step, compatibility branch, domain-owned migration script

**Version Transition Lifecycle**:
The shared lifecycle for Version Transitions: planned, dry-run passed, checkpointed, running, verified, completed, failed, rolled back, and abandoned. It governs the migration action itself; it does not replace Version Artifact Lifecycle or decide which version fact is active.
_Avoid_: artifact lifecycle, deployment status, release approval state, runtime health state

**Version Registry**:
The source-controlled singleton catalog that is the authoritative configuration for Pact version governance. It records versioned artifact identities, lifecycle state, compatibility, migration paths, and evidence references; it does not store artifact payloads or replace domain runtime state.
_Avoid_: runtime database, artifact store, release page, per-domain registry, generated report

**Version Registry Schema**:
The governed shape of the Version Registry. It defines which version facts, lifecycle states, transition paths, compatibility projections, artifact references, and evidence references can be registered, while keeping payload bodies and runtime state outside the registry.
_Avoid_: runtime database schema, artifact store layout, release report format, domain-private config schema

**Version Compatibility Table**:
The Version Registry table that records whether one Version Artifact Reference can consume, depend on, interpret, or bind another Version Artifact Reference. It is the compatibility fact table, not a semver range rule or release-readiness result.
_Avoid_: semver range, release compatibility claim, runtime health matrix, inferred dependency graph

**Version Artifact Store**:
The runtime artifact store for materialized versioned payloads, bundles, manifests, reports, and evidence bodies referenced by the Version Registry. It can store versioned artifact content, but it is not the authority for version-governance configuration.
_Avoid_: Version Registry, source of truth, release directory, git tag

**Platform Managed Migration**:
The platform capability for governed versioned state transformations across Pact domains. It is not a release note, startup conversion, or domain-owned compatibility branch.
_Avoid_: one-off migration script, runtime compatibility shim, best-effort startup upgrade, manual cutover checklist

**Runtime Retention Report**:
A release-readiness artifact that inventories an existing Pact runtime data directory and records retained areas, hashes, warnings, and recovery references without changing source data or advancing any protocol, model, store, or projection version. Secret values, sealing keys, CSRF HMAC secrets, and sensitive payload stores can be recorded only as manifest evidence, not copied into ordinary recovery files; this report is not a Platform Managed Migration or evidence of version cutover.
_Avoid_: migration, data migration, platform migration, runtime upgrade

**Migration Path Config**:
The platform-level description of how one protocol, model, store, or projection version moves to the next.
_Avoid_: domain-specific migration schema, implicit field fallback, hard-coded migration branch, undocumented rename, release-note-only upgrade

**Adjacent Version Migration**:
The Platform Managed Migration rule that version changes move through ordered neighboring versions instead of arbitrary jumps.
_Avoid_: direct version jump, skip-level migration, multi-hop migrator

**Queue Definition ID**:
The globally unique trusted identity of a Pact Work Queue definition. Policy, quota, authorization, observability, dedupe, and replay binding use the queue definition identity rather than a business-provided queue name.
_Avoid_: queue label, business-provided name, subject name

**Queue Definition Registry**:
The platform or capability registry that resolves business-provided queue names or intents to trusted queue definition identities. Enqueue must force a registry lookup and reject unresolved inputs instead of creating queue definitions from untrusted names on the fly.
_Avoid_: implicit queue creation, name-as-identity, caller-owned queue definition

**Queue Definition Registration**:
The controlled creation or update of queue definitions through the Queue Definition Registry. Registration is not hard-limited to platform deployment code, but any platform, capability, or business-initiated registration must create a versioned trusted queue definition before enqueue can target it.
_Avoid_: enqueue-time queue creation, unversioned queue config, source-hardcoded registration privilege

**Queue Dynamic Registration Policy**:
The deployment or policy setting that decides whether business-initiated queue definition registration is allowed. Disabling dynamic registration limits registration to preconfigured or governed paths without changing the Work Queue Primitive Contract.
_Avoid_: primitive-level registration ban, implicit enqueue creation, environment-hidden queue behavior

**Queue Label Uniqueness**:
The registry rule that human-readable queue labels must not conflict, even though labels are not trusted identities. A later registration with a conflicting label must be rejected and renamed so operators, logs, and management surfaces remain unambiguous.
_Avoid_: duplicate queue label, label-as-identity, silent label alias

**Queue Definition Version**:
The immutable version of a queue definition, including trusted identity, owner capability, allowed structured scopes, default policies, retention, and delivery routes. Queue decisions that depend on definition metadata must record the adopted definition version.
_Avoid_: mutable queue definition, current-definition replay, unversioned routing metadata

**Queue Definition Lifecycle**:
The lifecycle states for queue definitions, such as active, disabled, and deprecated. Queue definitions are not physically deleted while non-terminal work items, retained journal history, snapshots, or audit requirements still reference them.
_Avoid_: hard delete definition, orphan work item, historical label reuse

**Disabled Queue Definition**:
A queue definition lifecycle state that rejects new enqueue and new subscription or route changes while existing work items remain governed by pause, drain, retry, and management policy.
_Avoid_: work item deletion, implicit drain, hidden route mutation

**Deprecated Queue Definition**:
A queue definition lifecycle state that continues to process existing work items but rejects new enqueue by default unless an explicit compatibility policy allows it.
_Avoid_: disabled queue, automatic migration, silent new intake

**Queue Label Rename**:
A versioned queue definition change that updates the human-readable label while preserving historical alias or rename records. Replay and policy verification continue to use queue definition identity and adopted definition version, not the current label.
_Avoid_: label-only mutation, historical relabeling, replay by current name

**Unresolved Queue Admission**:
The fail-closed enqueue outcome when a business-provided queue name or intent cannot be resolved to a registered queue definition. The rejection is recorded in Operation or Authorization audit, but no Queue Transition Journal entry is written because no legal queue scheduling transition exists.
_Avoid_: implicit queue creation, orphan journal entry, unresolved queue work item

**Queue Name**:
A human-readable label or routing hint for a queue definition. Queue names may come from business inputs and are not trusted for policy, quota, authorization, or replay binding; the Queue Definition ID is the authoritative identity.
_Avoid_: trusted queue id, policy key, authorization binding

**Queue Scope**:
The structured governance and fairness boundary inside a queue, such as tenant id, workspace id, project id, or private-cloud deployment id. Scope is not free text; policy uses normalized scope fields for authorization, quota, and fairness.
_Avoid_: business owner, ACL rule, database shard, free-form scope string

**Work Queue Store Adapter**:
The replaceable storage implementation behind the Pact Work Queue Store contract. Adapters must preserve the same queue state machine and atomic scheduling semantics, so changing storage backends does not change upper-layer queue behavior.
_Avoid_: queue engine, external broker, database-specific queue API

**External Broker Queue Adapter**:
An adapter that uses NATS JetStream or another external broker as implementation detail for the Work Queue Store Adapter or delivery adapter contract. It must preserve Pact queue primitives, journal/projection/replay obligations, and broker-neutral upper-layer APIs.
_Avoid_: broker-native Pact API, JetStream consumer contract, broker-owned state machine

**Work Queue Conformance Suite**:
The shared verification suite every queue store adapter and delivery adapter must pass. It covers state transitions, illegal-transition fail-closed behavior, journal replay, projection rebuild, concurrent claim, lease fencing, crash recovery, and randomized smoke testing.
_Avoid_: adapter-specific test, happy-path smoke test, manual backend certification

**Work Queue Primitive Contract**:
The stable internal operation and state-transition contract for Pact Work Queue. Storage backends may change, but enqueue, claim, lease, ack, nack, progress, terminate, recover, and dead-letter semantics must remain consistent except for lightweight adapter-level mapping.
_Avoid_: broker-native API contract, database-shaped queue semantics, backend-specific behavior

**Queue Management Operation**:
A governed operational action that inspects or changes queue scheduling through the Work Queue Primitive Contract. Pause, resume, drain, requeue, move-to-dead-letter, archive, and retry-dead-letter operations must produce legal journaled transitions instead of directly mutating queue projections.
_Avoid_: projection table edit, manual status patch, hidden repair script

**Queue Requeue Operation**:
The governed management operation that moves eligible work back to a schedulable state through legal queue transitions. Requeue does not claim work directly; subsequent execution still happens through Queue Worker Runtime claim.
_Avoid_: management claim, direct worker handoff, projection status patch

**Queue Operation Governance**:
The authorization and policy boundary for queue operations. Enqueue, delivery subscription changes, and management operations pass through Operation, Authorization, and Policy governance, while worker acknowledgement operations are accepted only through lease fencing and Queue Worker Runtime binding rather than exposed as unrestricted business APIs.
_Avoid_: public ack API, unaudited enqueue, direct subscription mutation

**Queue Pause**:
A governed queue management state that prevents new pull claims and push dispatch for a queue, scope, or subscription. Pause does not preempt existing leases or block valid acknowledgement, negative acknowledgement, progress, or termination from already leased work; if leased work later fails, expires, or becomes retryable, pause prevents the next delivery until resume.
_Avoid_: worker cancellation, business stop signal, lease revocation

**Queue Drain**:
A governed queue management operation that stops new delivery for a queue, scope, or subscription and waits for existing leases to finish or reach an explicit timeout outcome. Drain is not task cancellation; timeout handling such as termination, dead-lettering, or remaining paused must be explicitly selected and journaled.
_Avoid_: kill running work, implicit termination, hidden maintenance reset

**Queue Error Explanation Adapter**:
An optional assembled capability that uses business-registered error metadata and queue diagnostics to return advisory explanations for retry, exhaustion, or termination outcomes. It is off by default and does not make the queue store own upper-layer business state.
_Avoid_: mandatory business classifier, queue-owned failure reason, hidden business state machine

**Queue Retry Hint**:
A structured, deterministic advisory value that an assembled error explanation or policy hook may return to influence retry scheduling. Retry hints can suggest retryability, delay, attempt limits, or termination, but the queue policy must record the adopted decision in the transition journal and must not treat free-form explanation text as state-machine input.
_Avoid_: natural-language retry policy, hidden classifier decision, business exception state

**Queue Retry Backoff**:
The deterministic retry delay policy for failed or expired work items. The default uses capped exponential backoff; any enabled jitter must be recorded as the adopted delay so replay verifies the selected delay instead of recomputing randomness.
_Avoid_: unbounded retry delay, replay-time jitter, worker-chosen backoff

**Broker-Neutral Queue API**:
The Pact-owned queue API that exposes Work Queue Primitive Contract operations rather than backend-native concepts. NATS JetStream streams, consumers, subjects, ack subjects, or deliver policies may inform an adapter, but they are not Pact queue vocabulary or upper-layer contracts.
_Avoid_: JetStream-compatible API, stream/consumer API, subject-based application contract

**Queue API Facade**:
A governed HTTP, MCP, RPC, Tool, or Console surface over Pact Work Queue primitives. External surfaces may expose queue operations to authorized callers, but they do not create separate queue semantics or bypass operation governance, lease fencing, or the transition journal.
_Avoid_: public broker protocol, unmanaged REST queue, direct store API

**At-Least-Once Work Delivery**:
The Pact Work Queue delivery guarantee that allows a work item to be claimed more than once after lease expiry, worker crash, retry, or recovery. Upper-layer capabilities must use idempotency keys, operation identifiers, checkpoints, or business state machines to prevent duplicate side effects.
_Avoid_: exactly-once queue, single execution guarantee, business idempotency

**Dead-Letter State**:
The queue-owned scheduling exhaustion state for a work item that can no longer be automatically retried. It does not mean the owning capability's business object has failed; the owning capability decides whether to mark failure, compensate, review, or enqueue follow-up work.
_Avoid_: business failure, workflow failure, failed import state

**Dead-Letter Retry**:
The explicit governed operation that moves or recreates exhausted work for scheduling after review. Retrying dead-letter work must be journaled with actor, reason, policy version, and adopted scheduling decision; dead-letter work must not be silently retried automatically.
_Avoid_: automatic DLQ replay, hidden redrive, business retry button without queue transition

**Terminal Work Item Retention**:
The retention policy for terminal queue projections such as acknowledged or terminated work items. Terminal projections may be archived or cleaned according to policy, but journal traceability follows Queue Journal Retention, and non-terminal work items must not be reduced to projection-only or snapshot-only history.
_Avoid_: terminal projection as audit, non-terminal cleanup, result retention policy

**Work Item**:
The smallest scheduling unit owned by Pact Work Queue. A work item carries queue metadata and references to its owning capability, operation, job, or workflow activity, but it is not itself the business job or workflow activity.
_Avoid_: queue job, workflow activity, business task

**Work Item Envelope**:
The lightweight queue-owned record for a work item. It contains scheduling metadata and stable references, while large payloads, files, business results, checkpoints, and workflow history remain in their owning stores.
_Avoid_: embedded payload, file content, business result record

**Payload Reference**:
A stable reference from a work item envelope to capability-owned input data or artifacts. The queue may preserve and audit the reference, but it does not parse or own the payload's business meaning.
_Avoid_: inline payload, queue-owned document, parsed result

**Payload Resolution Boundary**:
The rule that Queue Worker Runtime resolves payload references through the owning capability or service. The queue layer stores and passes references but does not directly read business files, business databases, or payload internals.
_Avoid_: queue file reader, direct business DB lookup, payload parser in queue core

**Payload Reference Admission**:
The enqueue-time validation boundary for payload references. Enqueue validates payload reference shape, owning capability, and caller authority, but it does not read the payload; payload availability and content are resolved later by Queue Worker Runtime through the owning service.
_Avoid_: enqueue-time payload read, queue-owned payload validation, direct file probe

**Queue Persistence Daemon**:
The platform process that supervises durable queue storage, recovery scans, lease expiry, WAL checkpointing, compaction, and persistence health. Queue state reported as successful must survive process crash and must not depend only on volatile memory waiting for a later best-effort flush.
_Avoid_: business worker, in-memory flush timer, result writer

**Queue Background Write Aspect**:
The unified outbound write aspect or port used by queue background components to persist coordinator state, fallback state, snapshots, compaction progress, and other background storage updates. It may execute asynchronously where semantics allow, but queue components must not implement scattered direct writes that bypass the aspect or weaken durable commit guarantees.
_Avoid_: per-daemon database writer, ad hoc file write, hidden async persistence

**Queue Background Write Ordering**:
The ordering guarantee that background writes for the same work item are serialized according to journal or transition order. Fallback, snapshot, compaction, and coordinator writes must not reorder state for a work item.
_Avoid_: out-of-order fallback write, unordered compaction side effect, cross-task write race

**Queue Background Write Retry**:
The versioned retry policy for asynchronous background write failures. Background writes may retry silently up to the adopted policy limit, but exhausted retries must enter observable queue internal health or review state instead of being discarded.
_Avoid_: infinite silent retry, dropped async write, unversioned storage retry

**Queue Internal Health State**:
The queue infrastructure health state for store, background write aspect, daemon, fallback coordinator, replay, snapshot, and compaction behavior. It may gate scheduling, trigger protective pause, or expose read-only inspection, but it is not work item scheduling state and must not write business state.
_Avoid_: business health, work item status, application failure state

**Protective Queue Pause**:
The automatic protective gate triggered by queue internal health policy when persistence, replay, fallback, or background writes become unsafe. It prevents new unsafe queue mutations such as enqueue, claim, dispatch, or non-recovery management changes while preserving inspection and recovery paths.
_Avoid_: business pause, manual-only pause, silent mutation block

**Queue Automatic Recovery**:
The queue-owned recovery flow attempted before manual governance when queue internal health degrades. It may retry background writes, rebuild projections, resume safe coordinator tasks, checkpoint or recover WAL state, shed load, and keep protective pause active until the store is safe; manual governance is reserved for exhausted automatic recovery.
_Avoid_: human-first recovery, memory-only backlog, unmanaged retry loop

**Queue Recovery Memory Guard**:
The hard memory and backlog protection used during automatic recovery. When recovery pressure exceeds adopted thresholds, the queue rejects new enqueue or escalates protective pause instead of accumulating unbounded in-memory work.
_Avoid_: recovery memory growth, unbounded backlog, best-effort enqueue under pressure

**Queue Recovery Success Proof**:
The verification required before automatic recovery can clear protective pause. It must prove background writes are healthy, projections validate against journal and snapshots, fallback coordinator tasks are accounted for, and the journal can continue appending safely.
_Avoid_: optimistic resume, log-only success, unchecked projection

**Queue Recovery Report**:
The structured output produced when automatic recovery exhausts. It records affected queue definitions, scopes, subscriptions, last successful journal offset, failed component, error summaries, adopted policy versions, and recommended governed actions.
_Avoid_: log-only failure, unstructured operator note, hidden recovery exhaustion

**Queue Storage Adapter Boundary**:
The migration boundary for queue persistence. Replacing SQLite with another database changes Work Queue Store Adapter and Queue Background Write Aspect implementations only; fallback, worker runtime, management, policy, and upper-layer code must not adapt directly to a concrete database.
_Avoid_: database-specific fallback code, worker SQL path, management store bypass

**Queue Time Source**:
The mandatory unified, injectable clock used by Pact Work Queue for adopted times, availability, lease expiry, delay maturity, retry scheduling, and journal timestamps. Queue code must not scatter direct wall-clock calls such as `Date.now()` outside this time source.
_Avoid_: local wall-clock call, replay-time clock, untestable timer

**Queue Identity Generator**:
The queue-owned generator for work item, lease, journal entry, subscription, and related queue identities. Identifiers must be globally unique, use at least UUIDv7 semantics, and may combine a distributed uniqueness algorithm; tests may inject deterministic generators without changing production identity guarantees.
_Avoid_: ad hoc random id, per-worker local counter, database-row identity contract

**Durable Queue Commit**:
The requirement that queue state changes are durably committed before the corresponding queue operation reports success. Enqueue, claim, acknowledge, negative acknowledge, terminate, and dead-letter transitions must survive process crash once accepted.
_Avoid_: eventual queue flush, success before fsync boundary, memory-only accepted state

**Queue Acknowledgement**:
The lease-bound queue primitive that marks scheduling complete for the current work item lease. Acknowledgement moves the work item into terminal queue projection subject to retention, but it does not delete or rewrite committed journal history and does not define business success.
_Avoid_: business success, result write, journal deletion

**Queue Negative Acknowledgement**:
The lease-bound queue primitive that releases or fails the current delivery attempt. Negative acknowledgement accepts structured retry hints, but queue policy decides whether the work item becomes pending, delayed, or dead-lettered.
_Avoid_: worker-selected final state, business failure, direct DLQ write

**Queue Termination**:
The lease-bound queue primitive that explicitly ends scheduling for a work item without marking business success or failure. Termination may carry a reason and is journaled as terminal scheduling state.
_Avoid_: business completion, business failure, forced worker kill

**Scheduling State**:
The queue-owned state that determines whether a work item is pending, leased, delayed, retryable, acknowledged, or exhausted. Business results, workflow history, checkpoints, and domain status remain with the owning capability or application service.
_Avoid_: business status, workflow result, capability-owned job state

**Provable Queue State Machine**:
The explicit, finite scheduling state machine for Pact Work Queue. Its allowed transitions, terminal states, transaction boundaries, invariants, transition traceability, replay behavior, and randomized smoke tests must be documented and mechanically verified before being treated as production queue semantics.
_Avoid_: implicit worker lifecycle, ad hoc status flags, business success/failure state machine

**Queue Transition Journal**:
The complete append-only trace of Pact Work Queue scheduling state transitions. It records enough metadata to audit and replay enqueue, claim, lease refresh, acknowledgement, negative acknowledgement, delay, retry, termination, recovery, and dead-letter decisions without owning business payloads or results.
_Avoid_: debug log, worker log, business event stream

**Queue Journal Data Minimization**:
The rule that queue journal entries record scheduling fields, stable references, structured error codes, adopted policy decisions, operation identifiers, actor metadata, and redacted diagnostics only. They must not store large payloads, raw file content, full business results, unredacted exception stacks, or sensitive business data.
_Avoid_: payload log, raw exception archive, business data journal

**Queue Failure Diagnostic Reference**:
The minimized queue-side diagnostic record for handler or delivery failure. Queue journal entries keep structured error codes, error classes, retry hints, and redacted messages, while full exceptions and business diagnostics remain in the owning capability's logs or result stores and are linked by reference.
_Avoid_: full exception in journal, business failure report in queue, raw diagnostic payload

**Queue State Projection**:
The current indexed scheduling view derived from queue transitions and committed with the corresponding journal entries. It serves high-performance claim, inspection, metrics, and management queries, but it must be rebuildable from the Queue Transition Journal and verified snapshots.
_Avoid_: independent queue truth, business status projection, unverifiable cache

**Queue Snapshot**:
A verified replay acceleration artifact for Pact Work Queue scheduling state. Snapshots may reduce recovery time, but they cannot bypass the Provable Queue State Machine or replace transition journal correctness.
_Avoid_: backup-only dump, cache checkpoint, business restore point

**Queue Snapshot Verification**:
The proof boundary for queue snapshots. A snapshot records its journal range, schema version, policy version set, and digest, and must be verified by replay; recovery may use it as an acceleration point but must continue validating later journal entries.
_Avoid_: unchecked snapshot restore, projection dump, replay bypass

**Queue Journal Retention**:
The governance policy for keeping, compacting, tiering, or archiving Queue Transition Journal segments. Retention may move cold history to lower-cost storage, but snapshots or current projections cannot replace required traceability, especially for non-terminal work items.
_Avoid_: projection-only audit, snapshot-as-history, silent journal deletion

**Queue Ledger Link**:
The relationship between queue scheduling facts and governed operation facts. Queue Transition Journal is the replay source for queue state, while Operation Ledger records operation intent, authorization, actor, and governance context; they link through operation identifiers without replacing each other.
_Avoid_: operation ledger as queue journal, queue journal as governance ledger, duplicated fact source

**Lease Fencing**:
The queue invariant that every lease-bound operation must present the current valid lease identity for the work item. Stale workers, expired leases, and previously delivered attempts must fail closed instead of acknowledging or mutating a work item after it has been redelivered or terminated.
_Avoid_: worker-trust ack, best-effort ack, workerId authorization

**Queue Progress Heartbeat**:
The lease-bound queue primitive that refreshes or records current lease liveness. It may carry lightweight diagnostics, but it is not a business progress percentage, checkpoint, or completion signal.
_Avoid_: business progress update, checkpoint write, partial success state

**Queue Lease Timeout**:
The policy-selected acknowledgement wait for a leased work item. Pact may use the JetStream-style 30 second baseline as the default, but the adopted timeout can be overridden by queue policy, delivery subscription, or enqueue options and must be recorded with the claim decision.
_Avoid_: hard-coded ack wait, unrecorded timeout, worker-defined lease duration

**Queue Max Attempts**:
The policy-selected maximum delivery attempts for a work item before scheduling exhaustion. Pact must use a safe finite default rather than infinite retry, while queue policy may override the value and the adopted limit must be journaled before dead-letter decisions depend on it.
_Avoid_: infinite retry default, business failure count, unbounded redelivery

**Queue Replay**:
The deterministic reconstruction of queue scheduling state from the Queue Transition Journal and any verified snapshots. Replay must not produce states outside the Provable Queue State Machine.
_Avoid_: best-effort recovery, log parsing, business result replay

**Adopted Queue Decision**:
A structured decision selected during original queue execution and recorded in the transition journal so replay can verify and rebuild without recomputing non-deterministic behavior. Adopted decisions include actual time boundaries, jittered delays, selected delivery routes, worker group selection, retry hint adoption, and policy version.
_Avoid_: replay-time random choice, live classifier call during replay, recomputed routing decision

**Queue Policy Version**:
The immutable identity of the scheduling policy used for a queue decision, including retry, backoff, lease, route, concurrency, and related scheduling rules. Policy updates affect future decisions only; historical replay validates recorded adopted decisions against the policy version captured in the transition journal.
_Avoid_: mutable live policy, retroactive retry rule, current-config replay

**Queue Scheduling Policy**:
The versioned policy that turns queue metadata, scope, resource limits, worker capacity, and registered business semantics into deterministic scheduling decisions. Pact provides a default fairness policy, while custom policies must be assembled through the project's policy management module and recorded as structured adopted decisions.
_Avoid_: hard-coded business priority, queue-owned business semantics, unversioned scheduler plugin

**Lazy Queue Time Transition**:
A time-driven scheduling transition, such as lease expiry or delay maturity, that may be materialized when claim, push dispatch, recovery, or the persistence daemon observes it instead of at the exact wall-clock instant. Once materialized, the adopted time, reason, and policy version must be journaled; replay must not create historical time transitions from the current clock.
_Avoid_: timer-only correctness, unjournaled expiry, current-time replay

**Automatic Safe Fallback**:
The queue-state-machine rule that failure, timeout, crash, interruption, and delivery loss must first resolve automatically into a safe scheduling state before external intervention is allowed. External actors cannot manually steer the fallback while it is in progress; they may act only afterward through governed management operations.
_Avoid_: manual crash recovery, external timeout override, operator-controlled fallback transition

**Queue Safe Intervention State**:
The queue states where external governed management may intervene after automatic fallback has settled: pending, delayed, dead-letter, fallback-review, acknowledged, or terminated. Leased work is not manually rewritten while fallback is still resolving it.
_Avoid_: leased-state patch, in-flight manual recovery, external fallback steering

**Queue Fallback Journal Entry**:
The required journal record for an automatic fallback transition. It records fallback reason, trigger source, adopted time, policy version, and adopted target state so replay can verify failure, timeout, crash, interruption, and delivery-loss recovery.
_Avoid_: untracked recovery, worker crash note only, replay-time fallback decision

**Queue Fallback Subtask**:
The independent lightweight async task or coroutine that executes one automatic fallback flow. A fallback coordinator owns state outside the coroutine, prevents duplicate or overlapping fallback attempts, and records completion or failure so fallback itself can be recovered safely.
_Avoid_: global fallback batch, unmanaged coroutine, hidden recovery loop

**Fallback Coordinator State**:
The durable coordinator record for an automatic fallback flow, including fallback task identity, work item identity, source transition, state, attempts, lock or fencing token, and last error. It lets the queue recover fallback execution after process restart.
_Avoid_: memory-only fallback task, lost coroutine state, untracked fallback retry

**Fallback Review State**:
The queue-internal safe state used when a fallback subtask cannot complete after bounded retries. It prevents a work item from remaining leased forever and allows later governed inspection or recovery without classifying the business task as failed.
_Avoid_: stuck leased state, business failure, silent fallback loss

**Fallback Review Operation**:
The governed operation set allowed from fallback-review state, such as inspect, retry fallback, move to dead-letter, terminate scheduling, or requeue through legal transitions. Workers cannot directly claim fallback-review work.
_Avoid_: worker claim from review, manual leased patch, business failure rewrite

**Fallback Retry Policy**:
The queue policy that controls fallback subtask retry attempts, backoff, adopted delay, and exhaustion behavior. Fallback retry decisions must record policy version, attempts, and adopted timing before they affect fallback coordinator state.
_Avoid_: infinite fallback retry, unversioned recovery loop, hard-coded fallback delay

**Fallback Fencing Lock**:
The per-work-item lock or fencing token that ensures only one fallback subtask can mutate a work item at a time. It prevents lease expiry, worker crash, dispatch failure, and interruption handlers from racing on the same work item.
_Avoid_: duplicate fallback coroutine, competing fallback transition, best-effort lock

**Randomized Queue Smoke Test**:
A lightweight randomized test that exercises legal and illegal queue operations against the Provable Queue State Machine. Random inputs may explore any behavior the state machine can contain, but successful execution must never accept or produce an impossible scheduling state.
_Avoid_: manual happy-path test, worker integration smoke test, uncontrolled fuzzing

**Queue Random Coverage Surface**:
The required behavior surface for randomized queue smoke tests, including pull, push, pause, drain, peer backpressure, lease expiry, delay maturity, dedupe, concurrency keys, and illegal acknowledgement operations. Random testing is not limited to enqueue, claim, and acknowledge happy paths.
_Avoid_: narrow queue smoke, ack-only random test, delivery-mode blind test

**Scheduling Order**:
The deterministic ordering Pact Work Queue uses when claiming available work, normally based on priority, availability time, creation time, and work item identity. It is not a global FIFO completion guarantee, because concurrency, retry, delay, and lease expiry can change execution and completion order.
_Avoid_: strict FIFO, completion order, serial queue guarantee

**Concurrency Key**:
A queue-level key that allows the Pact Work Queue to prevent concurrent claims for work items that must not run in parallel. It provides local serialization for a named lane without forcing the whole queue into global serial execution.
_Avoid_: business lock, workflow lock, global queue mutex

**Concurrency Key Fairness**:
The scheduling policy that prevents one concurrency key from monopolizing queue capacity. Default fairness may use per-key in-flight limits, age boost, scope fairness, or policy-defined weights while preserving local serialization for keys that require it.
_Avoid_: key starvation, priority monopoly, global serial fallback

**Queue Dedupe Scope**:
The idempotent enqueue boundary for Pact Work Queue, defined by queue definition id, structured queue scope, and dedupe key. It prevents duplicate scheduling records in the same trusted queue context, but it does not provide exactly-once business side effects.
_Avoid_: business idempotency scope, global dedupe key, queue-name binding, payload hash contract

**Dedupe Key Normalization**:
The enqueue-time canonicalization of business-provided idempotency input into a queue-safe dedupe key. The owning capability or idempotency contract must normalize or hash the input so malformed, inconsistent, or sensitive business identifiers are not written directly into queue storage or journals.
_Avoid_: raw business id as dedupe key, caller-trusted idempotency input, sensitive journal key

**Dedupe Conflict Resolution**:
The enqueue behavior when a normalized dedupe key already maps to a non-terminal work item in the same queue definition and structured scope. Pact returns the existing work item identity and scheduling summary instead of creating a duplicate work item or treating the conflict as an error.
_Avoid_: duplicate enqueue, conflict as failure, hidden replacement

**Queue Delivery Mode**:
The delivery shape Pact Work Queue uses to expose available work to workers. Pact supports both pull claim and push dispatch semantics, but both modes must use the same work item envelope, lease fencing, acknowledgement, retry, and dead-letter state machine.
_Avoid_: pull-only queue, push-only queue, broker-shaped consumer contract

**Queue Worker Runtime**:
The lightweight adapter between Pact Work Queue delivery and business handlers. It receives leased work item envelopes, resolves payload references through owning services, invokes handlers, and converts handler outcomes into queue primitives without giving handlers direct access to the queue store or transition journal.
_Avoid_: business job framework, workflow engine, direct queue store access

**Worker Runtime Claim Boundary**:
The rule that all pull and push claims originate from Queue Worker Runtime worker context. Business handlers, Tool or Console management surfaces, and arbitrary services cannot directly call the queue store claim path or impersonate workers.
_Avoid_: direct store claim, anonymous worker, management claim API

**Queue Worker Identity**:
The identity registered or issued by Queue Worker Runtime for a worker instance or capacity peer. Worker identity supports observation, capacity, binding, and audit, but acknowledgement authority still depends on lease fencing rather than self-reported worker identifiers.
_Avoid_: self-declared worker id, workerId authorization, anonymous queue worker

**Queue Worker Registration**:
The runtime record for worker lifecycle, heartbeat, capacity snapshot, and push or peer eligibility. It supports dispatch decisions and observability, but it is not the source of truth for work item state and must not be required to replay queue scheduling history.
_Avoid_: work item state source, replay dependency, worker-owned queue truth

**Worker Binding Revocation**:
The removal or invalidation of a worker runtime binding. Revocation blocks new claims and dispatch, while existing lease-bound operations are evaluated by lease fencing and revocation policy instead of being blindly accepted or rejected.
_Avoid_: unconditional ack denial, registry-owned lease state, silent worker impersonation

**Worker Capacity Expiry**:
The condition where a worker heartbeat or capacity snapshot is too old to support new dispatch or peer eligibility. Capacity expiry affects future delivery decisions only and does not cancel or negative-acknowledge already leased work, which remains governed by lease timeout and progress.
_Avoid_: heartbeat loss as nack, capacity expiry as cancellation, worker registry as lease source

**Queue Handler Outcome**:
The small structured result vocabulary returned by business handlers to the Queue Worker Runtime. Outcomes such as complete, retry, defer, terminate, and progress are translated by the runtime into queue primitives, while thrown errors are classified through queue policy and optional error explanation adapters.
_Avoid_: direct ack from handler, raw exception as queue state, handler-owned lease mutation

**Queue Worker Cancellation**:
The cooperative cancellation signal a Queue Worker Runtime may pass to business handlers for timeout, manual cancellation, service shutdown, or runtime policy. Pause and drain do not imply cancellation; termination is a scheduling transition and only becomes handler cancellation when the runtime explicitly supports and journals that cooperative path.
_Avoid_: pause-as-cancel, drain-as-kill, implicit worker termination

**Delivery Subscription**:
The durable Pact Work Queue configuration that binds push dispatch behavior to a queue, scope selector, worker group, delivery mode, in-flight limit, acknowledgement wait, filters, and backpressure policy. It is a Pact scheduling configuration, not a NATS consumer or application business state.
_Avoid_: NATS consumer, business subscription, callback registration

**Delivery Route Version**:
The immutable version of delivery route, subscription, or worker group configuration used for claim and dispatch decisions. Route changes affect future delivery decisions only and do not mutate already leased work items.
_Avoid_: live route mutation, current-route replay, leased-work rerouting

**Worker Group**:
A competing-consumer group for Pact Work Queue delivery. Workers in the same group share load, and a work item can be leased to at most one worker in the group at a time; queue delivery does not imply broadcast fanout.
_Avoid_: broadcast subscriber, event listener group, business audience

**Queue Peer**:
A compatible queue runtime or delivery capacity peer that can share scheduling pressure under the same Work Queue Primitive Contract and policy version. Peer load sharing is a delivery-capacity decision and does not imply NATS-style cluster replication or a separate queue state machine.
_Avoid_: replication node, independent broker, second queue owner

**Queue Single-Writer Path**:
The default SQLite WAL implementation boundary where durable queue mutations flow through one queue engine write path. Peers may contribute delivery or execution capacity, but they do not directly write queue projections or journals unless a future store adapter proves equivalent multi-writer atomicity.
_Avoid_: peer direct write, many-writer SQLite queue, projection bypass

**Controlled Queue Store Optimization**:
The performance discipline for queue store adapters, especially SQLite WAL. Prepared statements, batch transactions, short transactions, covering indexes, checkpointing, and compaction are allowed, but control, durable commit, and state-machine proof take priority over optimizations that acknowledge success before persistence or bypass queue primitives.
_Avoid_: memory-confirmed write, delayed durability, unproven fast path

**Queue Peer Eligibility**:
The rule that a peer can receive scheduling pressure only when it matches the same queue definition id, structured queue scope, delivery route, worker group or equivalent capacity pool, primitive contract version, policy version, authorization boundary, health status, and capacity checks. Peer selection must be recorded as an adopted queue decision and must not route work into an independent queue owner.
_Avoid_: opportunistic worker handoff, unverified peer, replay-time peer selection

**Queue Backpressure Gate**:
The scheduling gate that checks local and eligible peer delivery capacity before creating a durable lease. Push dispatch should prefer peer load sharing when a route or worker group is saturated; if no eligible capacity exists, it should avoid claiming new work rather than holding leased work in an in-memory dispatch buffer.
_Avoid_: claim-before-capacity, memory-only dispatch backlog, silent pressure drop

**Route Unavailable Scheduling**:
The scheduling condition where a work item is otherwise eligible but no valid delivery route or worker capacity is available. The work remains pending or delayed with diagnostics and must not be dead-lettered solely because route capacity is temporarily unavailable.
_Avoid_: route outage as DLQ, capacity failure as business failure, forced retry exhaustion

**Route Recovery Scheduling**:
The rule that work items left pending or delayed because routes were unavailable naturally re-enter claim or dispatch when a valid route and capacity return. Route recovery does not require a special work item migration.
_Avoid_: route recovery migration, manual requeue after capacity return, hidden dead-letter replay

**Queue Scheduling Observability**:
The queue-owned metrics and inspection data for scheduling behavior, including pending, leased, delayed, dead-letter, claim latency, acknowledgement latency, redelivery, lease expiry, backpressure, and peer handoff. Business success rates, business failure reasons, and domain execution duration remain with the owning capability.
_Avoid_: business KPI, handler success metric, domain failure dashboard

**Delivery Route Uniqueness**:
The rule that a work item must resolve to at most one active delivery route unless fanout is explicitly modeled by creating separate work items or a dedicated fanout primitive. Overlapping push subscriptions must be rejected or proven non-overlapping so acknowledgement, retry, and dead-letter ownership stay unambiguous.
_Avoid_: implicit fanout, overlapping consumers, ambiguous ack owner

**Push Dispatch Claim**:
The push delivery rule that the queue engine must perform the same durable claim and lease transition before dispatching a work item to a worker. Push delivery changes how leased work reaches a worker, not the queue state machine used to lease, acknowledge, retry, or dead-letter it.
_Avoid_: direct push without lease, dispatcher-owned state machine, callback-only delivery

**Push Dispatch Failure Transition**:
The journaled recovery transition used when a durable push claim succeeds but the worker dispatch fails before delivery is accepted. The work item must be legally returned to pending or delayed immediately instead of waiting for lease timeout.
_Avoid_: silent dispatch loss, timeout-only recovery, memory-only delivery failure

**Relay Session**:
A durable Pact-owned session that preserves source-facing continuity for a selected virtual inbound agent.
_Avoid_: target session, chat window

**Relay Turn**:
One governed delegated prompt exchange inside a relay session.
_Avoid_: message, raw prompt

**Delegation Grant**:
The effective permission envelope Pact computes for a delegated relay turn or session.
_Avoid_: source token, target token

**Relay-Scoped Tool Projection**:
The tool catalog Pact exposes to a target agent for a relay turn or session after policy filtering.
_Avoid_: source MCP config, full tool environment
