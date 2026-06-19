import { PACTIUM_PACKAGE_VERSION, PACTIUM_PROOF_TYPES, PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { protocolHash } from "../protocol/hashing.js";
import { createPactium } from "../core/pactium-core.js";
import { createVerifiableIndexEngine } from "../index-engine/snapshot-merkle-index.js";
import { verifyProofBundle } from "../proof/bundle.js";
import { createStoragePort } from "../storage/local-json-storage-port.js";

function percentile(samples, ratio, fallback) {
  if (samples.length === 0) return fallback;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function emitProgress(onProgress, event) {
  if (typeof onProgress === "function") {
    onProgress({
      protocol: PACTIUM_PROTOCOL,
      packageVersion: PACTIUM_PACKAGE_VERSION,
      ...event
    });
  }
}

function shouldReportProgress(completed, total, interval) {
  return completed === total || (interval > 0 && completed % interval === 0);
}

function shouldCompactPressure(completed, total, interval) {
  return completed > 0 && (completed === total || (interval > 0 && completed % interval === 0));
}

function createPressureCore(pactium) {
  if (pactium) return { core: pactium, owned: false };
  const storage = createStoragePort({ inMemory: true });
  return {
    core: createPactium({ storage }),
    storage,
    owned: true
  };
}

function addCompactionDetails(details, compaction) {
  if (!compaction?.inMemory) return;
  for (const field of ["prunedBlocks", "prunedProtocolObjects", "prunedNodes", "prunedRoots", "prunedSnapshots"]) {
    details[field] = Number(details[field] || 0) + Number(compaction[field] || 0);
  }
  details.retainedRoots = compaction.retainedRoots;
  details.retainedNodeRoots = compaction.retainedNodeRoots;
}

async function compactPressureCore(context, details) {
  if (!context?.owned || typeof context.core?._compactInMemoryCaches !== "function") return;
  addCompactionDetails(details, await context.core._compactInMemoryCaches());
}

export async function runPactiumQualityGateProfile({
  profile = "api:index-engine",
  operations = 1000,
  pactium = null,
  membershipProofs = Math.min(1000, operations),
  nonMembershipProofs = 0,
  requireDiff = false,
  onProgress = null,
  progressInterval = 1000,
  compactionInterval = 100
} = {}) {
  const started = performance.now();
  const memoryStart = process.memoryUsage().rss;
  const samples = [];
  const details = {};
  let completed = 0;
  if (profile === "api:index-engine") {
    const storage = createStoragePort({ inMemory: true });
    const engine = createVerifiableIndexEngine({ storage, domain: "pressure" });
    const entries = Array.from({ length: operations }, (_, index) => ({
      key: `key:${String(index).padStart(8, "0")}`,
      valueRef: `ref:${index}`,
      valueHash: protocolHash("block", index)
    }));
    emitProgress(onProgress, { profile, phase: "create-index:start", completed: 0, total: operations });
    const index = await engine.createIndex(entries);
    emitProgress(onProgress, { profile, phase: "create-index:end", completed: operations, total: operations });
    const membershipCount = Math.min(Number(membershipProofs || 0), operations);
    for (let indexNumber = 0; indexNumber < membershipCount; indexNumber += 1) {
      const operationStarted = performance.now();
      const proof = await engine.prove(index.root, `key:${String(indexNumber).padStart(8, "0")}`);
      if (!engine.verifyProof(proof)) throw new Error("Pressure membership proof failed.");
      samples.push(performance.now() - operationStarted);
      if (shouldReportProgress(indexNumber + 1, membershipCount, progressInterval)) {
        emitProgress(onProgress, {
          profile,
          phase: "membership-proofs",
          completed: indexNumber + 1,
          total: membershipCount
        });
      }
    }
    const nonMembershipCount = Math.min(Number(nonMembershipProofs || 0), operations);
    for (let indexNumber = 0; indexNumber < nonMembershipCount; indexNumber += 1) {
      const operationStarted = performance.now();
      const proof = await engine.prove(index.root, `missing:${String(indexNumber).padStart(8, "0")}`);
      if (!engine.verifyProof(proof) || proof.proofType !== PACTIUM_PROOF_TYPES.indexNonMembership) {
        throw new Error("Pressure non-membership proof failed.");
      }
      samples.push(performance.now() - operationStarted);
      if (shouldReportProgress(indexNumber + 1, nonMembershipCount, progressInterval)) {
        emitProgress(onProgress, {
          profile,
          phase: "non-membership-proofs",
          completed: indexNumber + 1,
          total: nonMembershipCount
        });
      }
    }
    if (requireDiff) {
      emitProgress(onProgress, { profile, phase: "diff:start", completed: 0, total: 1 });
      const diffStarted = performance.now();
      const created = await engine.put(index.root, `key:${String(operations + 1).padStart(8, "0")}`, {
        valueRef: `ref:${operations + 1}`,
        valueHash: protocolHash("block", operations + 1)
      });
      const deletedKey = `key:${String(Math.floor(operations / 2)).padStart(8, "0")}`;
      const changed = await engine.delete(created.root, deletedKey);
      const changes = await engine.diff(index.root, changed.root);
      samples.push(performance.now() - diffStarted);
      if (!changes.some((entry) => entry.action === "create") ||
        !changes.some((entry) => entry.action === "delete")) {
        throw new Error("Pressure root-to-root diff failed.");
      }
      details.diffChanges = changes.length;
      emitProgress(onProgress, { profile, phase: "diff:end", completed: 1, total: 1 });
    }
    details.indexKeys = operations;
    details.membershipProofs = membershipCount;
    details.nonMembershipProofs = nonMembershipCount;
    completed = operations;
  } else if (profile === "api:proof-bundle") {
    const context = createPressureCore(pactium);
    const { core } = context;
    for (let index = 0; index < operations; index += 1) {
      const operationStarted = performance.now();
      const envelope = await core.recordOperation({
        operationId: "pressure.bundle",
        workspaceId: `workspace-${index % 10}`,
        idempotencyKey: `bundle-intent-${index}`,
        outcomeIdempotencyKey: `bundle-outcome-${index}`,
        input: { index }
      });
      const bundle = await core.exportProofBundle(envelope);
      const verified = await verifyProofBundle(bundle);
      if (!verified.ok) throw new Error("Pressure Proof Bundle verification failed.");
      samples.push(performance.now() - operationStarted);
      completed += 1;
      if (shouldCompactPressure(completed, operations, compactionInterval)) {
        await compactPressureCore(context, details);
      }
      if (shouldReportProgress(completed, operations, progressInterval)) {
        emitProgress(onProgress, { profile, phase: "operations", completed, total: operations });
      }
    }
  } else if (profile === "api:recovery") {
    const context = createPressureCore(pactium);
    const { core } = context;
    const intents = [];
    const workspaceCounts = new Map();
    const intentWorkspaces = new Map();
    const sampleOutcomes = [];
    for (let index = 0; index < operations; index += 1) {
      const workspaceId = `workspace-${index % 10}`;
      workspaceCounts.set(workspaceId, (workspaceCounts.get(workspaceId) || 0) + 1);
      const intent = await core.beginOperationIntent({
        operationId: "pressure.recovery",
        workspaceId,
        idempotencyKey: `recovery-intent-${index}`,
        input: { index }
      });
      intentWorkspaces.set(intent.factId, workspaceId);
      intents.push(intent);
      if (shouldCompactPressure(index + 1, operations, compactionInterval)) {
        await compactPressureCore(context, details);
      }
      if (shouldReportProgress(index + 1, operations, progressInterval)) {
        emitProgress(onProgress, { profile, phase: "open-intents", completed: index + 1, total: operations });
      }
    }
    for (const [index, intent] of intents.entries()) {
      const operationStarted = performance.now();
      const outcome = await core.appendOperationOutcome({
        intentId: intent.factId,
        outcomeIdempotencyKey: `recovery-outcome-${index}`,
        status: "recovered"
      });
      const lookup = await core.lookupOutcome(intent.factId);
      if (!lookup.exists) throw new Error("Pressure recovery outcome lookup failed.");
      if (sampleOutcomes.length < 10) {
        sampleOutcomes.push({
          workspaceId: intentWorkspaces.get(intent.factId) || "default",
          ledgerEventId: outcome.factRef.ledgerEventId
        });
      }
      samples.push(performance.now() - operationStarted);
      completed += 1;
      if (shouldCompactPressure(completed, operations, compactionInterval)) {
        await compactPressureCore(context, details);
      }
      if (shouldReportProgress(completed, operations, progressInterval)) {
        emitProgress(onProgress, { profile, phase: "recovered-outcomes", completed, total: operations });
      }
    }
    for (const [workspaceId, count] of workspaceCounts) {
      const projection = await core.getWorkspaceProjection(workspaceId);
      if (projection.nextOrdinal !== count * 2) {
        throw new Error("Pressure recovery workspace projection consistency failed.");
      }
    }
    for (const outcome of sampleOutcomes) {
      const membership = await core.proveWorkspaceMembership({
        workspaceId: outcome.workspaceId,
        ledgerEventId: outcome.ledgerEventId
      });
      if (!membership.member || !core.indexEngine.verifyProof(membership.proof)) {
        throw new Error("Pressure recovery workspace membership proof failed.");
      }
    }
  } else if (profile === "api:licolite-record") {
    const { createLicoLiteAspect } = await import("../aspects/licolite/index.js");
    const context = createPressureCore(pactium);
    const { core } = context;
    const aspect = createLicoLiteAspect({ pactium: core, evidencePolicy: "production" });
    for (let index = 0; index < operations; index += 1) {
      const operationStarted = performance.now();
      const envelope = await aspect.recordWorkspaceOperation({
        operationId: "pressure.licolite",
        workspaceId: `workspace-${index % 10}`,
        idempotencyKey: `licolite-intent-${index}`,
        outcomeIdempotencyKey: `licolite-outcome-${index}`,
        input: { index },
        policyEvidence: { decision: "allow", index },
        workspaceEffectEvidence: { effect: "record", index }
      });
      const verified = await aspect.verifyEnvelope(envelope);
      if (!verified.ok) throw new Error("Pressure LicoLite verification failed.");
      samples.push(performance.now() - operationStarted);
      completed += 1;
      if (shouldCompactPressure(completed, operations, compactionInterval)) {
        await compactPressureCore(context, details);
      }
      if (shouldReportProgress(completed, operations, progressInterval)) {
        emitProgress(onProgress, { profile, phase: "operations", completed, total: operations });
      }
    }
  } else {
    const context = createPressureCore(pactium);
    const { core } = context;
    for (let index = 0; index < operations; index += 1) {
      const operationStarted = performance.now();
      await core.recordOperation({
        operationId: `${profile}.operation`,
        workspaceId: `workspace-${index % 10}`,
        idempotencyKey: `intent-${index}`,
        outcomeIdempotencyKey: `outcome-${index}`,
        input: { index }
      });
      samples.push(performance.now() - operationStarted);
      completed += 1;
      if (shouldCompactPressure(completed, operations, compactionInterval)) {
        await compactPressureCore(context, details);
      }
      if (shouldReportProgress(completed, operations, progressInterval)) {
        emitProgress(onProgress, { profile, phase: "operations", completed, total: operations });
      }
    }
  }
  const durationMs = Math.max(1, performance.now() - started);
  const memoryHighWaterMark = Math.max(memoryStart, process.memoryUsage().rss);
  const averageMs = durationMs / Math.max(1, completed);
  return {
    protocol: PACTIUM_PROTOCOL,
    packageVersion: PACTIUM_PACKAGE_VERSION,
    profile,
    operationCount: completed,
    durationMs,
    throughputPerSecond: completed / (durationMs / 1000),
    p50Ms: percentile(samples, 0.5, averageMs),
    p95Ms: percentile(samples, 0.95, averageMs),
    p99Ms: percentile(samples, 0.99, averageMs),
    memoryHighWaterMark,
    details
  };
}
