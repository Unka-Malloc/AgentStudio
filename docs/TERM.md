# Pactium Terms

This glossary is a maintained release document and package documentation authority.

## Language

**Operation Ledger**:
A cryptographically verifiable fact ledger for operation records. It is the source used to prove that an operation was recorded and that later ledger states remain valid continuations of earlier states.
_Avoid_: SQLite-backed operation record store, operation table, audit log

**Ledger Authority**:
The Operation Ledger's role as the global ordering authority for Pactium protocol facts. Checkpoint Tree and Merkle State facts can be independently verified, but their cross-structure ordering is interpreted through the Operation Ledger.
_Avoid_: checkpoint authority, state authority, multiple timelines

**Workspace Projection**:
A verifiable workspace-scoped projection index derived from the global Operation Ledger and related Pactium facts. The current package projects Operation Intents and Operation Outcomes without replacing Ledger Authority. Repair Facts are reserved for a future repair executor.
_Avoid_: workspace ledger, separate authority, filtered database view

**Workspace Order Index**:
The Workspace Projection index that maps workspace-local order to ledger event references. It supports verifiable workspace-scoped ordering and pagination.
_Avoid_: global ledger order view, UI sort, timestamp order

**Workspace Membership Index**:
The Workspace Projection index that maps ledger event identifiers to workspace-local membership material. It supports verifiable answers to whether a global ledger event belongs to a workspace projection.
_Avoid_: filtered lookup, secondary database index, unverified membership check

**Workspace Projection Lane**:
The logical per-workspace sequence represented by Workspace Projection ordinal assignment. The current package updates this projection synchronously during operation commits; it does not expose a separate per-workspace queue.
_Avoid_: asynchronous projection, global workspace lock, UI pagination counter

**Workspace Lane Queue**:
Reserved name for a possible future write-path FIFO queue that would serialize protocol commits for one Workspace Projection Lane while allowing different workspaces to proceed independently. It is not a current runtime surface.
_Avoid_: daemon queue, host retry loop, global write lock

**Ledger Transparency Log**:
The append-only Merkle log algorithm used by the Operation Ledger to prove entry inclusion and ledger consistency across Ledger Heads. It is separate from the Verifiable Index Engine because it owns ordered append history rather than ordered key/value state.
_Avoid_: Prolly ledger, index-backed ledger, key-value ledger

**Ledger Append Lane**:
The single commit lane that assigns global Ledger leaf order. It may accept ordered batches, but Pactium does not sort concurrent appends after the fact.
_Avoid_: concurrent ledger append, post-hoc ordering, timestamp ordering

**Ledger Head**:
The verifiable summary of an Operation Ledger state at a specific size. It identifies the ledger root that receipts and continuity checks can verify against.
_Avoid_: database snapshot, latest row, checkpoint

**Last Trusted Head**:
A Ledger Head retained by a verifier as its local trust anchor for later consistency checks. It lets clients detect ledger histories that do not continue from what they previously verified.
_Avoid_: latest server head, cached response, checkpoint file

**Signed Ledger Head**:
A Ledger Head endorsed by a verifier manifest signer. Current core can sign Ledger Heads with Ed25519, embed the verifier manifest on the head, and verify manifest-bound signatures during envelope or trusted-head verification.
_Avoid_: required key, Pactium identity, global trust root

**Signing Authority**:
A host-provided or local Pactium authority capable of signing Pactium Proof Envelopes or Ledger Heads. LicoLite envelope signing can use HMAC or Ed25519; Ledger Head signing uses Ed25519 verifier manifests.
_Avoid_: built-in product key, mandatory secret, Pactium account

**Witness Extension Point**:
The Pactium boundary for exporting and verifying Ledger Heads with external observers. Pactium core supports the data needed for witnessing, but does not run a witness or gossip network.
_Avoid_: built-in gossip service, mandatory witness, network daemon

**Host Declaration Profile**:
A host-declared integration profile that activates optional adapters without changing Pactium's core protocol vocabulary. Profiles are declared by the host rather than inferred by Pactium.
_Avoid_: auto-detection, hidden product mode, core dependency

**LicoLite Support Mandate**:
Pactium's product relationship to LicoLite: Pactium exists to provide the protocol substrate and integration surface LicoLite needs. LicoLite is the primary host, and Pactium may include complete LicoLite adapters when LicoLite declares itself.
_Avoid_: neutral host-only library, third-party-first package, LicoLite external plugin

**LicoLite Aspect**:
The first-class Pactium package surface that adapts Pactium's protocol substrate to LicoLite. It covers LicoLite-facing protocol substrate integration while leaving LicoLite runtime, policy decisions, operation dispatching, side effects, and UI ownership outside Pactium.
_Avoid_: ordinary plugin, external adapter, unofficial integration layer

**LicoLite Verifier**:
The LicoLite Aspect verifier for Pactium Proof Envelopes that checks core Pactium proofs plus LicoLite signing, workspace projection, policy extension, and workspace effect extension requirements. It verifies bindings and required evidence, not product policy correctness.
_Avoid_: writer-only adapter, LicoLite-owned duplicate verifier, policy evaluator

**Verification Failure**:
A structured verifier result item that names the failed verification layer, code, severity, and evidence reference. Pactium verifiers do not collapse proof failures into a single boolean.
_Avoid_: boolean-only verification, generic invalid receipt, unclassified error

**Repair Planner**:
The Pactium surface that translates structured Verification Failures into deterministic repair tasks. It proposes repairs; hosts decide whether and when to execute them.
_Avoid_: automatic repair, host policy executor, silent mutation

**Repair Fact**:
A reserved Ledger-bound Pactium fact for recording the result of rebuilding or repairing derived protocol material. The current package plans repair tasks but does not execute them or append Repair Facts.
_Avoid_: silent rebuild, hidden maintenance mutation, unrecorded repair

**LicoLite Workspace Projection Priority**:
The LicoLite Aspect's first priority: workspace-scoped verifiable projections are enabled by default and are the standard path for LicoLite workspace proof and view needs.
_Avoid_: optional projection, UI filtering first, global-ledger-only workspace view

**LicoLite Signing Policy**:
The LicoLite Aspect's signing behavior for Pactium Proof Envelopes. Signing is enabled by default for LicoLite envelopes, while LicoLite policy decides whether missing signing material fails closed or falls back to opportunistic signing.
_Avoid_: unsigned-by-default LicoLite, Pactium-mandated production policy, hidden key fallback

**LicoLite Policy Extension**:
A critical Proof Extension that binds LicoLite policy decision and evidence material into a Pactium Proof Envelope. Pactium carries and verifies the binding but does not decide whether the policy decision was correct.
_Avoid_: Pactium policy engine, unbound policy field, optional LicoLite governance metadata

**LicoLite Workspace Effect Extension**:
A critical Proof Extension that binds LicoLite workspace side-effect or asset evidence into a Pactium Proof Envelope. Pactium carries and verifies the binding but does not execute or validate the side effect itself.
_Avoid_: Pactium side-effect executor, unbound asset evidence, optional workspace evidence

**LicoLite Evidence Policy**:
The LicoLite Aspect's behavior when required LicoLite critical extensions are missing. LicoLite production defaults to failing closed, while other profiles may choose opportunistic behavior.
_Avoid_: silent downgrade, plain receipt fallback, Pactium-owned product policy

**New Data Directory Boundary**:
The LicoLite Aspect accepts Pactium-format data directories created under the current schema. Historical LicoLite protocol data is not read or migrated by Pactium.
_Avoid_: in-place migration, historical data acceptance, automatic upgrade

**Latest Schema Boundary**:
Pactium accepts the latest verifiable protocol schema only. Earlier experimental Pactium data formats are rejected.
_Avoid_: migration promise, experimental schema support, historical format acceptance

**Verifiable Core Rewrite**:
The current implementation that builds Pactium around proof-first protocol modules.
_Avoid_: incremental storage patch, storage-first carryover, weak proof model

**Proof Model Build Order**:
The current implementation dependency order: canonical encoding and hashing, storage, ledger, index engine, lifecycle indexes, workspace projection, state, checkpoint, proof envelopes, LicoLite Aspect, and maintenance/repair.
_Avoid_: aspect-first implementation, proof-later implementation, weak interim model

**Protocol Profile**:
The versioned parameter matrix that fixes Pactium's proof algorithms, data structures, API shape, LicoLite aspect behavior, and verification expectations for one protocol release.
_Avoid_: configuration preset, implementation checklist, tuning guide

**Pactium Receipt**:
A protocol fact receipt proving that declared Pactium facts were recorded and can be verified against Pactium history. It does not prove that host-owned business side effects completed unless the host includes its own evidence.
_Avoid_: business effect proof, external side-effect proof, completion certificate

**Operation Intent**:
An append-only Pactium fact declaring the operation that a host intends to record. It is not mutated into completion state.
_Avoid_: mutable started row, pending update, draft ledger entry

**Operation Outcome**:
An append-only Pactium fact declaring the result of an Operation Intent. Successful and failed outcomes are both recorded as new Ledger facts.
_Avoid_: row update, completion patch, overwritten status

**Terminal Outcome**:
The single Operation Outcome that closes an Operation Intent. Later retries, repairs, or compensations create new Operation Intents and link back through causality references.
_Avoid_: multiple completions, mutable final status, reopened intent

**Causality Reference**:
A reference from a Pactium fact to earlier intents, outcomes, or repair facts that explains why the new fact exists without reopening the earlier lifecycle.
_Avoid_: status rewrite, lifecycle mutation, hidden retry chain

**Operation Causality Index**:
The Verifiable Index Engine-backed index for querying causality relationships between Pactium facts such as retries, repairs, and compensations.
_Avoid_: payload traversal, UI-only relationship, unverified graph edge

**Canceled Outcome**:
An Operation Outcome that closes an Operation Intent by declaring cancellation. Cancellation is recorded as an outcome fact rather than deleting or mutating the intent.
_Avoid_: deleted intent, hidden close, canceled row update

**Open Intent**:
An Operation Intent that has been recorded without a corresponding Operation Outcome. It is a recoverable protocol state, not a hidden inconsistency.
_Avoid_: lost operation, partial row, failed transaction

**Open Intent Index**:
The Verifiable Index Engine-backed index of Operation Intents that do not yet have corresponding Operation Outcomes. It supports verified lookup and recovery of open operation lifecycles.
_Avoid_: ledger scan, in-memory pending map, unverified recovery list

**Outcome Index**:
The Verifiable Index Engine-backed index that maps Operation Intents to their Operation Outcomes. It supports verified lookup of an operation lifecycle result.
_Avoid_: status column, completion map, mutable lifecycle row

**Intent Idempotency Index**:
The Verifiable Index Engine-backed index that maps an intent idempotency key and input identity to an Operation Intent. It makes operation retries recover the same intent.
_Avoid_: hidden unique constraint, best-effort retry key, mutable pending row

**Outcome Idempotency Index**:
The Verifiable Index Engine-backed index that maps an outcome idempotency key and outcome identity to an Operation Outcome. It makes outcome retries recover the same result fact.
_Avoid_: duplicate completion guard, database-only uniqueness, retry cache

**Idempotency Replay**:
A retry result that returns an existing Operation Intent or Operation Outcome proof without appending a new Ledger fact. It is marked as a replay so callers can distinguish it from a new commit.
_Avoid_: duplicate ledger fact, hidden retry success, new operation attempt

**Pactium Proof Envelope**:
The cross-proof receipt shape that binds an Operation Ledger proof to related Checkpoint Tree and Merkle State proofs for the same protocol fact. It prevents independently valid proofs from being mis-associated.
_Avoid_: loose proof set, scattered receipt IDs, proof bundle

**Proof Material Ref**:
A content-addressed reference from a Pactium Proof Envelope to stored proof material needed for verification. It lets write paths return complete proof structure without inlining every proof byte while keeping proof material tamper-evident.
_Avoid_: missing proof, inline-only proof, opaque receipt ref

**Proof Bundle**:
A portable CAR-like export that contains a Pactium Proof Envelope, a Pactium manifest, and the content-addressed proof material needed for verification without local Pactium storage.
_Avoid_: receipt, local proof ref set, storage snapshot

**Proof Extension**:
A hash-bound host extension attached to a Pactium Proof Envelope without changing the core proof schema. Critical extensions require verifier support; non-critical extensions may be ignored but remain tamper-evident.
_Avoid_: arbitrary receipt field, unbound metadata, core schema fork

**Proof-First API**:
The public Pactium API style where write operations return verifiable proof envelopes or heads, and read operations expose verification-oriented proofs rather than storage-shaped records.
_Avoid_: storage-first API, proof hash API, loose identifier API

**Root Export**:
The default Pactium package API surface. It exposes the latest proof-first API only, not experimental historical APIs.
_Avoid_: mixed-version export, historical root API, versioned barrel

**Operation Lifecycle API**:
The proof-first API surface for beginning Operation Intents, appending Operation Outcomes, and recovering Open Intents. Higher-level operation recording APIs are conveniences over this lifecycle.
_Avoid_: mutable record API, start-complete row API, record-only lifecycle

**Host Evidence**:
Host-owned proof or artifact reference that supports a domain claim outside Pactium's protocol facts. Pactium may carry Host Evidence references but does not define their truth.
_Avoid_: Pactium proof, receipt, ledger fact

**Durable Host Evidence**:
Host Evidence that survives crashes before an Operation Outcome is recorded. Pactium binds its reference and hash, while the host owns storage and recovery of the evidence itself.
_Avoid_: transient callback result, Pactium-owned evidence store, inline side-effect result

**Maintenance Task Engine**:
The deterministic Pactium task planning surface. The current package executes the `doctor` task when a Pactium instance is provided and returns planned-only results for other task names; it does not run a resident scheduler.
_Avoid_: daemon scheduler, background service, host job runner

**Storage Port**:
The persistence boundary for Pactium protocol material. Storage backends may change how bytes are stored and retrieved, but they do not change canonical encoding, hash roots, proofs, or verification semantics.
_Avoid_: proof plugin, schema authority, storage-defined hash

**Checkpoint Tree**:
A verifiable append-only recovery tree for operation, task, or workflow history. It proves checkpoint node membership and parent-child continuity without becoming the Operation Ledger's ordering authority.
_Avoid_: plain JSON tree, restore log, second ledger

**Checkpoint Tree Head**:
The verifiable summary of a Checkpoint Tree state. It identifies the checkpoint root that node membership and continuity checks can verify against.
_Avoid_: file timestamp, latest node, ledger head

**Intent Checkpoint**:
A checkpoint node associated with an Operation Intent. It represents operation lifecycle start or recoverable progress, not confirmed side effects.
_Avoid_: effect checkpoint, completed checkpoint, outcome node

**Outcome Checkpoint**:
A checkpoint node associated with an Operation Outcome. It represents declared operation result, effect evidence, or state transition material.
_Avoid_: start marker, pending node, intent checkpoint

**Merkle State Substrate**:
A verifiable state substrate whose state roots identify content-addressed state. It is responsible for state continuity, key membership, key non-membership, and efficient state diffs.
_Avoid_: content store only, hash wrapper, blob registry

**State Commit**:
A verifiable Merkle State fact bound to an Operation Outcome. It declares state transition material and is not attached to Operation Intent.
_Avoid_: intent state commit, planned state, mutable state row

**Prolly Tree State Index**:
The canonical ordered-key index for Merkle State. It provides stable state roots, structural sharing, key membership proofs, key non-membership proofs, and diffs (correct and canonical; Dolt-style skip-common-subtree optimization is P3 deferred).
_Avoid_: sorted-array index, proof hash, temporary state index

**Canonical Prolly Tree**:
Pactium's own protocol-defined Prolly Tree format. Its encoding, chunking, hash domains, and proof format are part of Pactium's trust semantics.
_Avoid_: external Prolly package, implementation detail, adapter tree

**Verifiable Index Engine**:
The shared algorithmic core used by Pactium indexes that need ordered keys, stable roots, membership proofs, non-membership proofs, structural sharing, and diffs (correct and canonical; Dolt-style skip-common-subtree optimization is P3 deferred). Domain indexes may use different protocol profiles, but they do not reimplement separate proof engines.
_Avoid_: duplicate index implementation, per-domain tree algorithm, ad hoc proof store

**Index Domain Adapter**:
A domain boundary that converts host or Pactium domain material into canonical index keys and values before it enters the Verifiable Index Engine. Merkle State, Checkpoint Node, and Workspace Projection indexes use domain adapters while sharing the same proof engine.
_Avoid_: separate index engine, storage plugin, proof adapter

**Index Key**:
A canonical ordered key consumed by the Verifiable Index Engine. State paths, checkpoint node identifiers, and future domain keys are normalized into Index Keys before indexing.
_Avoid_: raw path, raw node id, host key

**Index Value**:
A canonical value envelope consumed by the Verifiable Index Engine. Domain payloads are represented as stable value material before indexing so the proof engine can remain domain-independent.
_Avoid_: domain object, mutable payload, unencoded value

**Index Value Ref**:
An Index Value that binds an indexed key to content-addressed value material rather than embedding the full domain object in the index. It keeps the Verifiable Index Engine domain-independent while allowing payloads to be verified separately.
_Avoid_: inline domain object, raw payload, stored object

**Content-Defined Chunking**:
The protocol-defined boundary rule used by the Canonical Prolly Tree to form stable chunks from ordered key/value material. Its parameters are Pactium protocol constants, not host configuration.
_Avoid_: fixed fanout, configurable fanout, storage tuning

**Protocol Hash**:
The hash algorithm fixed by a Pactium protocol version. Hosts do not configure it; a hash algorithm change requires a new protocol version.
_Avoid_: host hash option, storage hash, configurable digest

**Pactium Canonical Value**:
The restricted IPLD/DAG-CBOR-style data model used for Pactium proof material. Ledger leaves, index nodes, checkpoint nodes, state commits, and proof envelopes are encoded through this model before hashing.
_Avoid_: ordinary JSON, runtime object, stringified payload
