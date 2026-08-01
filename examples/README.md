# Pactium Examples

This directory contains runnable examples demonstrating Pactium's core capabilities. Each example is a standalone `.mjs` file that can be executed directly with Node.js.

## Running Examples

```bash
# From the project root
node examples/record-operation.mjs
node examples/verify-envelope.mjs
node examples/export-proof-bundle.mjs
node examples/workspace-projection.mjs
```

Examples create a `.pactium` data directory in the working directory. Remove it between runs for a fresh state: `rm -rf .pactium`.

## Learning Path

If you're new to Pactium, follow these examples in order:

### 1. Record an Operation

**File:** [`record-operation.mjs`](./record-operation.mjs)

The simplest end-to-end example. Records and verifies a workspace-scoped operation through the host-neutral Pactium core. It also shows how a caller can explicitly attach a portable copy as a Proof Extension.

**Concepts introduced:**
- `createPactium()` instance creation
- `recordOperation()` high-level API
- `verifyEnvelope()` verification
- Explicit host-owned copy material through `extensions`
- Proof Envelope structure

### 2. Two-Phase Operation Lifecycle

**File:** [`verify-envelope.mjs`](./verify-envelope.mjs)

Demonstrates the low-level two-phase operation lifecycle: first record an Operation Intent, then append an Operation Outcome. This is the pattern for operations where you need to track the "in-progress" state.

**Concepts introduced:**
- `beginOperationIntent()` -- declare intent before execution
- `appendOperationOutcome()` -- declare result after execution
- Two-envelope lifecycle (intent + outcome)
- Envelope verification with `checked` details

### 3. Export and Verify a Proof Bundle

**File:** [`export-proof-bundle.mjs`](./export-proof-bundle.mjs)

Shows how to export a recorded operation as a portable Proof Bundle and verify it independently -- without access to the original Pactium storage.

**Concepts introduced:**
- `exportProofBundle()` -- create portable proof material
- `verifyProofBundle()` -- standalone verification function
- Bundle structure (type, hash, content-addressed blocks)
- Portable/offline verification

### 4. Workspace Projection and Membership Proofs

**File:** [`workspace-projection.mjs`](./workspace-projection.mjs)

Records operations across multiple workspaces, queries workspace projections, and demonstrates verifiable workspace membership and non-membership proofs.

**Concepts introduced:**
- Multi-workspace operation recording
- `getWorkspaceProjection()` -- query workspace state
- `proveWorkspaceMembership()` -- prove event belongs to workspace
- Non-membership proofs -- prove event does NOT belong to workspace
- Workspace-scoped projection membership, not tenant or authorization isolation

## Key Patterns

### Idempotent Recording

All examples use `idempotencyKey` and `outcomeIdempotencyKey`. If you re-run an example without clearing the data directory, the second call returns an idempotency replay (existing proof) rather than creating duplicate ledger entries.

### Proof-First API

Every write operation returns a Proof Envelope. Core facts contain input and result digests, not business plaintext. A caller that needs portable content can explicitly attach a hash-bound Proof Extension; bundle export then includes that extension block.

### Error Handling

Verification results are returned as structured objects (`{ ok, failures, checked }`), not thrown exceptions. Verification failures include layer, code, severity, and repairability information.

## Next Steps

After working through these examples, consult:

- [API Reference](../docs/API.md) for complete API documentation
- [Protocol Specification](../docs/protocols/PROTOCOLS.md) for protocol behavior details
- [Architecture](../docs/architecture/ARCHITECTURE.md) for system design and data flow
- [FAQ](../docs/FAQ.md) for common questions
