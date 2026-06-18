import fs from "node:fs/promises";
import { createCheckpointTreeStore } from "./checkpoint-tree.js";
import { createOperationLedger } from "./ledger.js";
import { createMerkleStateSubstrate } from "./merkle-state.js";
import { PACTIUM_PROTOCOL_VERSION, resolveDataDir } from "./paths.js";

export const PACTIUM_KERNEL_PROTOCOL_VERSION = "v0.1.0:pactium:kernel-1";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(Object(object), key);
}

function text(value, fallback = "") {
  const output = String(value ?? "").trim();
  return output || fallback;
}

export function createProtocolCatalog() {
  return {
    protocolVersion: PACTIUM_PROTOCOL_VERSION,
    name: "Pactium",
    packageName: "pactium",
    capabilities: [
      {
        id: "operation-ledger",
        version: "v0.1.0:pactium:operation-ledger-1",
        operations: ["startEntry", "completeEntry", "failEntry", "getEntry", "listEntries"]
      },
      {
        id: "checkpoint-tree",
        version: "v0.1.0:pactium:checkpoint-tree-1",
        operations: ["startTree", "upsertNode", "finishTree", "diffTree", "queryScope", "previewRestore", "restore"]
      },
      {
        id: "merkle-state-substrate",
        version: "v0.1.0:pactium:merkle-state-substrate-1",
        operations: ["cas", "merkleDag", "merkleIndex", "eventLog", "stateCommit", "lsmIngest"]
      },
      {
        id: "pactium-kernel",
        version: PACTIUM_KERNEL_PROTOCOL_VERSION,
        operations: ["recordOperation", "doctor", "protocolCatalog"]
      }
    ]
  };
}

async function materializeStateMutations(substrate, mutations = [], inheritedContentRefs = []) {
  const nextMutations = [];
  const contentRefs = [...asArray(inheritedContentRefs).map((value) => String(value || "").trim()).filter(Boolean)];
  for (const mutation of asArray(mutations)) {
    const action = text(mutation.action, "put");
    if (action === "delete") {
      nextMutations.push({
        action,
        key: text(mutation.key),
        metadata: asObject(mutation.metadata)
      });
      continue;
    }
    let valueRef = text(mutation.valueRef);
    if (!valueRef && hasOwn(mutation, "value")) {
      const block = await substrate.cas.putBlock(mutation.value, {
        codec: mutation.codec || "dag-json",
        refs: mutation.refs || [],
        metadata: {
          kind: "state-value",
          key: text(mutation.key),
          ...asObject(mutation.metadata)
        }
      });
      valueRef = block.cid;
    }
    if (valueRef) contentRefs.push(valueRef);
    nextMutations.push({
      action,
      key: text(mutation.key),
      valueRef,
      metadata: asObject(mutation.metadata)
    });
  }
  return {
    mutations: nextMutations,
    contentRefs: [...new Set(contentRefs)]
  };
}

export function createPactiumKernel({ dataDir = "" } = {}) {
  const resolvedDataDir = resolveDataDir(dataDir);
  const ledger = createOperationLedger({ dataDir: resolvedDataDir });
  const checkpointTree = createCheckpointTreeStore({ dataDir: resolvedDataDir });
  const merkleState = createMerkleStateSubstrate({ dataDir: resolvedDataDir });

  async function recordOperation(input = {}) {
    const operationId = text(input.operationId);
    if (!operationId) {
      throw new Error("operationId is required.");
    }
    const workspaceId = text(input.workspaceId || input.scope, "default");
    const checkpoint = asObject(input.checkpoint);
    const state = asObject(input.state);
    let ledgerEntry = null;
    try {
      ledgerEntry = ledger.startEntry({
        operationId,
        workspaceId,
        semantic: input.semantic || checkpoint.semantic || "",
        assetRef: input.assetRef || "",
        targetKind: input.targetKind || "",
        targetRef: input.targetRef || {},
        subject: input.subject || {},
        risk: input.risk || "",
        status: "started",
        idempotencyKey: input.idempotencyKey || "",
        input: input.input || input,
        policyDecision: input.policyDecision || {},
        warnings: input.warnings || [],
        receiptRefs: input.receiptRefs || []
      });

      const treeId = text(checkpoint.treeId, checkpointTree.id("workspace", workspaceId));
      const rootNodeId = text(checkpoint.rootNodeId, "root");
      await checkpointTree.startTree({
        treeId,
        kind: checkpoint.kind || "operation-log",
        ownerId: workspaceId,
        inputHash: checkpoint.inputHash || "",
        rootNodeId,
        rootLabel: checkpoint.rootLabel || "Operations",
        metadata: checkpoint.treeMetadata || {},
        resumePolicy: checkpoint.resumePolicy || {},
        resetOnInputHashChange: checkpoint.resetOnInputHashChange === true
      });

      const checkpointNode = await checkpointTree.upsertNode({
        treeId,
        nodeId: checkpoint.nodeId || checkpoint.checkpointNodeId || `operation:${ledgerEntry.ledgerEventId}`,
        parentId: checkpoint.parentId || rootNodeId,
        label: checkpoint.label || operationId,
        status: checkpoint.status || input.status || "completed",
        cursor: checkpoint.cursor || {},
        totals: checkpoint.totals || {},
        metadata: {
          operationId,
          ledgerEventId: ledgerEntry.ledgerEventId,
          effectKind: input.effectKind || checkpoint.effectKind || "",
          ...asObject(checkpoint.metadata)
        },
        eventType: checkpoint.eventType || "pactium.operation.recorded"
      });

      let stateCommit = null;
      if (asArray(state.mutations).length > 0 || state.afterRoot) {
        const materialized = await materializeStateMutations(merkleState, state.mutations, state.contentRefs);
        stateCommit = await merkleState.stateCommit.commit({
          scope: state.scope || workspaceId,
          operationId,
          mutations: materialized.mutations,
          afterRoot: state.afterRoot || "",
          contentRefs: materialized.contentRefs,
          payload: {
            ledgerEventId: ledgerEntry.ledgerEventId,
            checkpointNodeId: checkpointNode.nodeId,
            ...asObject(state.payload)
          }
        });
      }

      const receiptRefs = [
        `ledger:${ledgerEntry.ledgerEventId}`,
        `checkpoint:${treeId}/${checkpointNode.nodeId}`,
        stateCommit?.commitId ? `state:${stateCommit.commitId}` : ""
      ].filter(Boolean);
      const completedLedgerEntry = ledger.completeEntry(ledgerEntry.ledgerEventId, {
        status: input.status || "succeeded",
        assetRef: input.assetRef || "",
        receiptRefs,
        warnings: input.warnings || []
      });
      return {
        protocolVersion: PACTIUM_KERNEL_PROTOCOL_VERSION,
        ledgerEventId: ledgerEntry.ledgerEventId,
        checkpointTreeId: treeId,
        checkpointNodeId: checkpointNode.nodeId,
        stateCommitId: stateCommit?.commitId || "",
        ledgerEntry: completedLedgerEntry,
        checkpointNode,
        stateCommit
      };
    } catch (error) {
      if (ledgerEntry?.ledgerEventId) {
        ledger.failEntry(ledgerEntry.ledgerEventId, {
          error: {
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
      throw error;
    }
  }

  async function doctor() {
    await fs.mkdir(resolvedDataDir, { recursive: true });
    return {
      protocolVersion: PACTIUM_KERNEL_PROTOCOL_VERSION,
      ok: true,
      dataDir: resolvedDataDir,
      ledgerPath: ledger.filePath,
      protocols: createProtocolCatalog(),
      merkleCapabilities: merkleState.listCapabilities()
    };
  }

  return Object.freeze({
    protocolVersion: PACTIUM_KERNEL_PROTOCOL_VERSION,
    dataDir: resolvedDataDir,
    ledger,
    checkpointTree,
    merkleState,
    recordOperation,
    doctor,
    protocolCatalog: createProtocolCatalog
  });
}
