import {
  checkpointTreeId,
  checkpointTreeSummary,
  deleteCheckpointTree,
  diffCheckpointTree,
  finishCheckpointTree,
  listCheckpointTrees,
  loadCheckpointTree,
  previewCheckpointRestore,
  queryCheckpointScope,
  restoreCheckpointTree,
  startCheckpointTree,
  upsertCheckpointNode
} from "./checkpoint-tree-store.mjs";
import {
  clamp,
  clampLimit,
  escapeRegExp,
  normalizeWhitespace,
  truncateText,
  uniqueNormalizedStrings
} from "./text-normalization.mjs";
import { createMerkleStateSubstrate } from "./merkle-state-substrate.mjs";

export const DATA_STRUCTURE_PROTOCOL_VERSION = "v0.0.1:storage:data-structure-1";

function withUserDataPath(userDataPath, input = {}) {
  const next = input || {};
  return {
    ...next,
    userDataPath
  };
}

export function createDataStructureProvider({ userDataPath = "" } = {}) {
  const checkpointTree = Object.freeze({
    checkpointTreeId,
    checkpointTreeSummary,
    deleteCheckpointTree(input = {}) {
      return deleteCheckpointTree(withUserDataPath(userDataPath, input));
    },
    diffCheckpointTree(input = {}) {
      return diffCheckpointTree(withUserDataPath(userDataPath, input));
    },
    finishCheckpointTree(input = {}) {
      return finishCheckpointTree(withUserDataPath(userDataPath, input));
    },
    listCheckpointTrees(input = {}) {
      return listCheckpointTrees(withUserDataPath(userDataPath, input));
    },
    loadCheckpointTree(input = {}) {
      return loadCheckpointTree(withUserDataPath(userDataPath, input));
    },
    previewCheckpointRestore(input = {}) {
      return previewCheckpointRestore(withUserDataPath(userDataPath, input));
    },
    queryCheckpointScope(input = {}) {
      return queryCheckpointScope(withUserDataPath(userDataPath, input));
    },
    restoreCheckpointTree(input = {}) {
      return restoreCheckpointTree(withUserDataPath(userDataPath, input));
    },
    startCheckpointTree(input = {}) {
      return startCheckpointTree(withUserDataPath(userDataPath, input));
    },
    upsertCheckpointNode(input = {}) {
      return upsertCheckpointNode(withUserDataPath(userDataPath, input));
    }
  });

  const textNormalization = Object.freeze({
    clamp,
    clampLimit,
    escapeRegExp,
    normalizeWhitespace,
    truncateText,
    uniqueNormalizedStrings
  });

  const merkleState = createMerkleStateSubstrate({ userDataPath });

  return Object.freeze({
    protocolVersion: DATA_STRUCTURE_PROTOCOL_VERSION,
    checkpointTree,
    merkleState,
    textNormalization,
    listCapabilities() {
      return {
        protocolVersion: DATA_STRUCTURE_PROTOCOL_VERSION,
        capabilities: [
          {
            id: "checkpoint-tree",
            kind: "projection",
            operations: [
              "checkpointTreeId",
              "startCheckpointTree",
              "upsertCheckpointNode",
              "finishCheckpointTree",
              "listCheckpointTrees",
              "loadCheckpointTree",
              "diffCheckpointTree",
              "queryCheckpointScope",
              "previewCheckpointRestore",
              "restoreCheckpointTree",
              "deleteCheckpointTree"
            ]
          },
          {
            id: "merkle-state-substrate",
            kind: "algorithm-substrate",
            operations: [
              "canonicalCodec",
              "cas",
              "merkleDag",
              "merkleIndex",
              "eventLog",
              "stateCommit",
              "lsmIngest"
            ]
          },
          {
            id: "text-normalization",
            kind: "pure-algorithm",
            operations: [
              "normalizeWhitespace",
              "truncateText",
              "clamp",
              "clampLimit",
              "escapeRegExp",
              "uniqueNormalizedStrings"
            ]
          }
        ]
      };
    }
  });
}
