import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertServerToken, resolveWithin, serverToken } from "../security/client-strings.mjs";

const CHECKPOINT_TREE_SCHEMA_VERSION = 1;
const MAX_EVENTS = 500;
const TERMINAL_STATUSES = new Set(["completed", "failed", "skipped", "canceled"]);
const VALID_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "paused",
  "canceled"
]);

const treeLocks = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(value, fallback = "pending") {
  const text = String(value || "").trim().toLowerCase();
  return VALID_STATUSES.has(text) ? text : fallback;
}

function normalizeNodeId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "root";
}

function asPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function clonePlain(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch {
    return fallback;
  }
}

function checkpointTreeRoot(userDataPath) {
  return resolveWithin(userDataPath, "checkpoint-trees");
}

function checkpointTreePath(userDataPath, treeId) {
  assertServerToken(treeId, "checkpoint_tree");
  return resolveWithin(checkpointTreeRoot(userDataPath), `${treeId}.json`);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function withTreeLock(treeId, action) {
  const previous = treeLocks.get(treeId) || Promise.resolve();
  const run = previous.catch(() => null).then(action);
  const cleanup = run.finally(() => {
    if (treeLocks.get(treeId) === cleanup) {
      treeLocks.delete(treeId);
    }
  });
  cleanup.catch(() => null);
  treeLocks.set(treeId, cleanup);
  return run;
}

function createEmptyTree({
  treeId,
  kind = "long_task",
  ownerId = "",
  inputHash = "",
  rootNodeId = "root",
  rootLabel = "root",
  metadata = {},
  resumePolicy = {}
}) {
  const timestamp = nowIso();
  const normalizedRootNodeId = normalizeNodeId(rootNodeId);
  return {
    schemaVersion: CHECKPOINT_TREE_SCHEMA_VERSION,
    treeId,
    kind: String(kind || "long_task"),
    ownerId: String(ownerId || ""),
    status: "running",
    inputHash: String(inputHash || ""),
    resumePolicy: asPlainObject(resumePolicy),
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: "",
    failedAt: "",
    attempt: 0,
    rootNodeId: normalizedRootNodeId,
    metadata: asPlainObject(metadata),
    nodes: {
      [normalizedRootNodeId]: {
        nodeId: normalizedRootNodeId,
        parentId: "",
        label: String(rootLabel || normalizedRootNodeId),
        status: "running",
        cursor: {},
        totals: {},
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        completedAt: "",
        error: ""
      }
    },
    events: []
  };
}

function appendTreeEvent(tree, event) {
  const timestamp = nowIso();
  tree.events = [
    ...(Array.isArray(tree.events) ? tree.events : []),
    {
      eventId: `event_${randomUUID()}`,
      at: timestamp,
      type: String(event.type || "checkpoint.event"),
      nodeId: event.nodeId ? normalizeNodeId(event.nodeId) : "",
      message: String(event.message || ""),
      data: asPlainObject(event.data)
    }
  ].slice(-MAX_EVENTS);
}

async function mutateCheckpointTree({ userDataPath, treeId, createInput = {}, mutator }) {
  assertServerToken(treeId, "checkpoint_tree");
  return withTreeLock(treeId, async () => {
    const filePath = checkpointTreePath(userDataPath, treeId);
    let tree = await readJson(filePath);
    if (!tree || tree.schemaVersion !== CHECKPOINT_TREE_SCHEMA_VERSION) {
      tree = createEmptyTree({
        treeId,
        ...createInput
      });
      appendTreeEvent(tree, {
        type: "checkpoint.tree.created",
        nodeId: tree.rootNodeId,
        message: "Checkpoint tree created."
      });
    }
    const result = await mutator(tree);
    tree.updatedAt = nowIso();
    await writeJsonAtomic(filePath, tree);
    return result === undefined ? tree : result;
  });
}

export function checkpointTreeId(kind, ...parts) {
  return serverToken("checkpoint_tree", kind, ...parts);
}

export function getCheckpointTreePath(userDataPath, treeId) {
  return checkpointTreePath(userDataPath, treeId);
}

export async function loadCheckpointTree({ userDataPath, treeId } = {}) {
  try {
    const tree = await readJson(checkpointTreePath(userDataPath, treeId));
    return tree?.schemaVersion === CHECKPOINT_TREE_SCHEMA_VERSION ? tree : null;
  } catch (error) {
    if (/token 格式无效/.test(String(error?.message || ""))) {
      return null;
    }
    throw error;
  }
}

export async function listCheckpointTrees({ userDataPath, ownerId = "", kind = "", limit = 100 } = {}) {
  const rootPath = checkpointTreeRoot(userDataPath);
  await fs.mkdir(rootPath, { recursive: true });
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const trees = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^checkpoint_tree_[a-f0-9]{32}\.json$/.test(entry.name)) {
      continue;
    }
    const tree = await readJson(path.join(rootPath, entry.name));
    if (!tree || tree.schemaVersion !== CHECKPOINT_TREE_SCHEMA_VERSION) {
      continue;
    }
    if (ownerId && tree.ownerId !== ownerId) {
      continue;
    }
    if (kind && tree.kind !== kind) {
      continue;
    }
    trees.push(tree);
  }
  return trees
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, Math.max(1, Math.min(500, Number(limit || 100))));
}

function nodeFor(tree, nodeId = "") {
  const nodes = asPlainObject(tree?.nodes);
  const normalizedNodeId = normalizeNodeId(nodeId || tree?.rootNodeId || "root");
  return nodes[normalizedNodeId] || null;
}

function nodeChildren(tree, nodeId = "") {
  const normalizedNodeId = normalizeNodeId(nodeId || tree?.rootNodeId || "root");
  return Object.values(asPlainObject(tree?.nodes))
    .filter((node) => {
      const parentId = String(node?.parentId || "").trim();
      return parentId ? normalizeNodeId(parentId) === normalizedNodeId : false;
    })
    .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));
}

function nodePath(tree, nodeId = "") {
  const nodes = asPlainObject(tree?.nodes);
  const pathItems = [];
  let cursor = normalizeNodeId(nodeId || tree?.rootNodeId || "root");
  const seen = new Set();
  while (cursor && nodes[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    pathItems.unshift({
      nodeId: cursor,
      label: nodes[cursor].label || cursor,
      status: nodes[cursor].status || ""
    });
    cursor = normalizeNodeId(nodes[cursor].parentId || "");
  }
  return pathItems;
}

function collectNodeScope(tree, nodeId = "") {
  const normalizedNodeId = normalizeNodeId(nodeId || tree?.rootNodeId || "root");
  const nodes = asPlainObject(tree?.nodes);
  if (!nodes[normalizedNodeId]) {
    throw new Error("checkpoint node 不存在。");
  }
  const output = [];
  const stack = [normalizedNodeId];
  const seen = new Set();
  while (stack.length > 0) {
    const currentId = stack.shift();
    if (seen.has(currentId)) {
      continue;
    }
    seen.add(currentId);
    const node = nodes[currentId];
    if (!node) {
      continue;
    }
    output.push(node);
    for (const child of nodeChildren(tree, currentId)) {
      stack.push(child.nodeId);
    }
  }
  return output;
}

function countByStatus(nodes = []) {
  const byStatus = {};
  for (const node of nodes) {
    const status = String(node?.status || "pending");
    byStatus[status] = Number(byStatus[status] || 0) + 1;
  }
  return byStatus;
}

function comparableNode(node = null) {
  if (!node) {
    return {};
  }
  return {
    parentId: node.parentId || "",
    label: node.label || "",
    status: node.status || "",
    cursor: asPlainObject(node.cursor),
    totals: asPlainObject(node.totals),
    metadata: asPlainObject(node.metadata),
    error: node.error || ""
  };
}

function compareNodeSnapshots(left = {}, right = {}) {
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return fields
    .filter((field) => stableJson(left[field]) !== stableJson(right[field]))
    .map((field) => ({
      field,
      before: clonePlain(left[field], null),
      after: clonePlain(right[field], null)
    }));
}

async function requireCheckpointTree({ userDataPath, treeId }) {
  const tree = await loadCheckpointTree({ userDataPath, treeId });
  if (!tree) {
    throw new Error("checkpoint tree 不存在。");
  }
  return tree;
}

export async function diffCheckpointTree({
  userDataPath,
  treeId = "",
  fromTreeId = "",
  toTreeId = "",
  fromNodeId = "",
  toNodeId = ""
} = {}) {
  const leftTreeId = String(fromTreeId || treeId || "").trim();
  const rightTreeId = String(toTreeId || treeId || "").trim();
  const leftTree = await requireCheckpointTree({ userDataPath, treeId: leftTreeId });
  const rightTree = await requireCheckpointTree({ userDataPath, treeId: rightTreeId });
  const leftNodeId = normalizeNodeId(fromNodeId || leftTree.rootNodeId || "root");
  const rightNodeId = normalizeNodeId(
    (toNodeId || toTreeId)
      ? toNodeId || rightTree.rootNodeId || "root"
      : fromNodeId || rightTree.rootNodeId || "root"
  );
  const leftNode = nodeFor(leftTree, leftNodeId);
  const rightNode = nodeFor(rightTree, rightNodeId);
  if (!leftNode || !rightNode) {
    throw new Error("checkpoint diff 节点不存在。");
  }
  const leftScope = collectNodeScope(leftTree, leftNodeId);
  const rightScope = collectNodeScope(rightTree, rightNodeId);
  const changes = compareNodeSnapshots(comparableNode(leftNode), comparableNode(rightNode));
  return {
    protocolVersion: "pact.workspace-checkpoint.v1",
    treeId: rightTree.treeId,
    from: {
      treeId: leftTree.treeId,
      nodeId: leftNodeId,
      path: nodePath(leftTree, leftNodeId),
      status: leftNode.status || "",
      affectedNodeCount: leftScope.length,
      byStatus: countByStatus(leftScope)
    },
    to: {
      treeId: rightTree.treeId,
      nodeId: rightNodeId,
      path: nodePath(rightTree, rightNodeId),
      status: rightNode.status || "",
      affectedNodeCount: rightScope.length,
      byStatus: countByStatus(rightScope)
    },
    changes,
    changed: changes.length > 0 || leftScope.length !== rightScope.length,
    summary: {
      fieldChangeCount: changes.length,
      affectedNodeDelta: rightScope.length - leftScope.length
    }
  };
}

export async function queryCheckpointScope({ userDataPath, treeId = "", nodeId = "" } = {}) {
  const tree = await requireCheckpointTree({ userDataPath, treeId: String(treeId || "").trim() });
  const resolvedNodeId = normalizeNodeId(nodeId || tree.rootNodeId || "root");
  const scopeNodes = collectNodeScope(tree, resolvedNodeId);
  const eventItems = (Array.isArray(tree.events) ? tree.events : [])
    .filter((event) => !event.nodeId || scopeNodes.some((node) => node.nodeId === event.nodeId))
    .slice(-50);
  return {
    protocolVersion: "pact.workspace-checkpoint.v1",
    treeId: tree.treeId,
    nodeId: resolvedNodeId,
    path: nodePath(tree, resolvedNodeId),
    affectedNodeCount: scopeNodes.length,
    byStatus: countByStatus(scopeNodes),
    nodes: scopeNodes.map((node) => ({
      nodeId: node.nodeId,
      parentId: node.parentId || "",
      label: node.label || "",
      status: node.status || "",
      updatedAt: node.updatedAt || "",
      cursor: clonePlain(node.cursor),
      totals: clonePlain(node.totals),
      metadata: clonePlain(node.metadata)
    })),
    events: eventItems,
    resumePolicy: clonePlain(tree.resumePolicy),
    canRestore: true
  };
}

function checkpointRestorePlan(tree, nodeId = "", input = {}) {
  const resolvedNodeId = normalizeNodeId(nodeId || tree.rootNodeId || "root");
  const scopeNodes = collectNodeScope(tree, resolvedNodeId);
  const target = nodeFor(tree, resolvedNodeId);
  return {
    protocolVersion: "pact.workspace-checkpoint.v1",
    treeId: tree.treeId,
    nodeId: resolvedNodeId,
    mode: String(input.mode || "restore-marker"),
    reason: String(input.reason || ""),
    target: {
      nodeId: target.nodeId,
      label: target.label || "",
      status: target.status || "",
      cursor: clonePlain(target.cursor),
      totals: clonePlain(target.totals),
      metadata: clonePlain(target.metadata)
    },
    scope: {
      affectedNodeCount: scopeNodes.length,
      byStatus: countByStatus(scopeNodes),
      nodeIds: scopeNodes.map((node) => node.nodeId)
    },
    actions: [
      {
        action: "record_restore_marker",
        nodeId: resolvedNodeId
      },
      {
        action: "emit_checkpoint_restored_event",
        eventType: "checkpoint.restored"
      }
    ],
    canApply: true
  };
}

export async function previewCheckpointRestore({ userDataPath, treeId = "", nodeId = "", ...input } = {}) {
  const tree = await requireCheckpointTree({ userDataPath, treeId: String(treeId || "").trim() });
  return {
    ...checkpointRestorePlan(tree, nodeId, input),
    dryRun: true,
    applied: false
  };
}

export async function restoreCheckpointTree({
  userDataPath,
  treeId = "",
  nodeId = "",
  actor = "",
  reason = "",
  mode = "restore-marker"
} = {}) {
  const normalizedTreeId = String(treeId || "").trim();
  assertServerToken(normalizedTreeId, "checkpoint_tree");
  return withTreeLock(normalizedTreeId, async () => {
    const filePath = checkpointTreePath(userDataPath, normalizedTreeId);
    const tree = await readJson(filePath);
    if (!tree || tree.schemaVersion !== CHECKPOINT_TREE_SCHEMA_VERSION) {
      throw new Error("checkpoint tree 不存在。");
    }
    const plan = checkpointRestorePlan(tree, nodeId, { reason, mode });
    const timestamp = nowIso();
    const restoreId = `checkpoint_restore_${randomUUID()}`;
    const target = nodeFor(tree, plan.nodeId);
    const markerNodeId = normalizeNodeId(`restore:${plan.nodeId}:${restoreId}`);
    tree.nodes = asPlainObject(tree.nodes);
    tree.nodes[markerNodeId] = {
      nodeId: markerNodeId,
      parentId: plan.nodeId,
      label: "Checkpoint restore marker",
      status: "completed",
      cursor: clonePlain(target.cursor),
      totals: clonePlain(target.totals),
      metadata: {
        restoreId,
        restoredFromNodeId: plan.nodeId,
        mode,
        reason: String(reason || ""),
        actor: String(actor || "")
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      error: ""
    };
    tree.metadata = {
      ...asPlainObject(tree.metadata),
      lastRestore: {
        restoreId,
        restoredAt: timestamp,
        nodeId: plan.nodeId,
        markerNodeId,
        mode,
        reason: String(reason || ""),
        actor: String(actor || "")
      }
    };
    appendTreeEvent(tree, {
      type: "checkpoint.restored",
      nodeId: plan.nodeId,
      message: "Checkpoint restore marker recorded.",
      data: {
        restoreId,
        markerNodeId,
        mode,
        reason: String(reason || ""),
        actor: String(actor || "")
      }
    });
    tree.updatedAt = timestamp;
    await writeJsonAtomic(filePath, tree);
    return {
      ...plan,
      dryRun: false,
      applied: true,
      restoreId,
      markerNodeId,
      restoredAt: timestamp,
      summary: checkpointTreeSummary(tree)
    };
  });
}

export async function startCheckpointTree({
  userDataPath,
  treeId,
  kind = "long_task",
  ownerId = "",
  inputHash = "",
  rootNodeId = "root",
  rootLabel = "root",
  metadata = {},
  resumePolicy = {},
  resetOnInputHashChange = true
} = {}) {
  return mutateCheckpointTree({
    userDataPath,
    treeId,
    createInput: {
      kind,
      ownerId,
      inputHash,
      rootNodeId,
      rootLabel,
      metadata,
      resumePolicy
    },
    mutator(tree) {
      const normalizedInputHash = String(inputHash || "");
      if (
        resetOnInputHashChange &&
        normalizedInputHash &&
        tree.inputHash &&
        tree.inputHash !== normalizedInputHash
      ) {
        const replacement = createEmptyTree({
          treeId,
          kind,
          ownerId,
          inputHash: normalizedInputHash,
          rootNodeId,
          rootLabel,
          metadata,
          resumePolicy
        });
        replacement.createdAt = tree.createdAt || replacement.createdAt;
        replacement.attempt = Number(tree.attempt || 0);
        Object.assign(tree, replacement);
        appendTreeEvent(tree, {
          type: "checkpoint.tree.reset",
          nodeId: tree.rootNodeId,
          message: "Input hash changed; checkpoint tree was reset."
        });
      }
      const timestamp = nowIso();
      const normalizedRootNodeId = normalizeNodeId(rootNodeId || tree.rootNodeId || "root");
      tree.kind = String(kind || tree.kind || "long_task");
      tree.ownerId = String(ownerId || tree.ownerId || "");
      tree.inputHash = normalizedInputHash || tree.inputHash || "";
      tree.resumePolicy = {
        ...asPlainObject(tree.resumePolicy),
        ...asPlainObject(resumePolicy)
      };
      tree.metadata = {
        ...asPlainObject(tree.metadata),
        ...asPlainObject(metadata)
      };
      tree.status = "running";
      tree.startedAt = tree.startedAt || timestamp;
      tree.completedAt = "";
      tree.failedAt = "";
      tree.attempt = Number(tree.attempt || 0) + 1;
      tree.rootNodeId = normalizedRootNodeId;
      tree.nodes = asPlainObject(tree.nodes);
      tree.nodes[normalizedRootNodeId] = {
        ...(tree.nodes[normalizedRootNodeId] || {}),
        nodeId: normalizedRootNodeId,
        parentId: "",
        label: String(rootLabel || tree.nodes[normalizedRootNodeId]?.label || normalizedRootNodeId),
        status: "running",
        createdAt: tree.nodes[normalizedRootNodeId]?.createdAt || timestamp,
        updatedAt: timestamp,
        startedAt: tree.nodes[normalizedRootNodeId]?.startedAt || timestamp,
        completedAt: "",
        error: tree.nodes[normalizedRootNodeId]?.error || "",
        cursor: asPlainObject(tree.nodes[normalizedRootNodeId]?.cursor),
        totals: asPlainObject(tree.nodes[normalizedRootNodeId]?.totals),
        metadata: asPlainObject(tree.nodes[normalizedRootNodeId]?.metadata)
      };
      appendTreeEvent(tree, {
        type: tree.attempt > 1 ? "checkpoint.tree.resumed" : "checkpoint.tree.started",
        nodeId: normalizedRootNodeId,
        message: tree.attempt > 1 ? "Checkpoint tree resumed." : "Checkpoint tree started."
      });
      return tree;
    }
  });
}

export async function upsertCheckpointNode({
  userDataPath,
  treeId,
  nodeId,
  parentId = "root",
  label = "",
  status = "running",
  cursor = undefined,
  totals = undefined,
  metadata = undefined,
  error = "",
  eventType = ""
} = {}) {
  const normalizedNodeId = normalizeNodeId(nodeId);
  return mutateCheckpointTree({
    userDataPath,
    treeId,
    createInput: {
      rootNodeId: parentId || "root"
    },
    mutator(tree) {
      const timestamp = nowIso();
      const normalizedStatus = normalizeStatus(status, "running");
      const current = tree.nodes?.[normalizedNodeId] || {};
      tree.nodes = asPlainObject(tree.nodes);
      tree.nodes[normalizedNodeId] = {
        ...current,
        nodeId: normalizedNodeId,
        parentId: normalizeNodeId(parentId || current.parentId || tree.rootNodeId || "root"),
        label: String(label || current.label || normalizedNodeId),
        status: normalizedStatus,
        cursor: cursor === undefined ? asPlainObject(current.cursor) : asPlainObject(cursor),
        totals: totals === undefined ? asPlainObject(current.totals) : asPlainObject(totals),
        metadata: metadata === undefined ? asPlainObject(current.metadata) : asPlainObject(metadata),
        createdAt: current.createdAt || timestamp,
        updatedAt: timestamp,
        startedAt: current.startedAt || (normalizedStatus === "running" ? timestamp : ""),
        completedAt: TERMINAL_STATUSES.has(normalizedStatus) ? timestamp : current.completedAt || "",
        error: String(error || (normalizedStatus === "failed" ? current.error || "failed" : ""))
      };
      if (normalizedStatus === "failed") {
        tree.status = "failed";
        tree.failedAt = timestamp;
      } else if (tree.status !== "failed" && normalizedStatus === "running") {
        tree.status = "running";
      }
      if (eventType) {
        appendTreeEvent(tree, {
          type: eventType,
          nodeId: normalizedNodeId,
          message: label || normalizedNodeId,
          data: {
            status: normalizedStatus
          }
        });
      }
      return tree.nodes[normalizedNodeId];
    }
  });
}

export async function finishCheckpointTree({
  userDataPath,
  treeId,
  status = "completed",
  message = "",
  metadata = {}
} = {}) {
  return mutateCheckpointTree({
    userDataPath,
    treeId,
    mutator(tree) {
      const timestamp = nowIso();
      const normalizedStatus = normalizeStatus(status, "completed");
      tree.status = normalizedStatus;
      tree.metadata = {
        ...asPlainObject(tree.metadata),
        ...asPlainObject(metadata)
      };
      if (normalizedStatus === "failed") {
        tree.failedAt = timestamp;
      }
      if (TERMINAL_STATUSES.has(normalizedStatus)) {
        tree.completedAt = timestamp;
      }
      const rootNodeId = tree.rootNodeId || "root";
      if (tree.nodes?.[rootNodeId]) {
        tree.nodes[rootNodeId].status = normalizedStatus;
        tree.nodes[rootNodeId].updatedAt = timestamp;
        tree.nodes[rootNodeId].completedAt = timestamp;
      }
      appendTreeEvent(tree, {
        type: `checkpoint.tree.${normalizedStatus}`,
        nodeId: rootNodeId,
        message: message || `Checkpoint tree ${normalizedStatus}.`
      });
      return tree;
    }
  });
}

export async function deleteCheckpointTree({ userDataPath, treeId } = {}) {
  assertServerToken(treeId, "checkpoint_tree");
  await fs.rm(checkpointTreePath(userDataPath, treeId), {
    force: true
  });
}

export function checkpointTreeSummary(tree) {
  const nodes = Object.values(asPlainObject(tree?.nodes));
  const byStatus = {};
  for (const node of nodes) {
    const status = String(node?.status || "pending");
    byStatus[status] = Number(byStatus[status] || 0) + 1;
  }
  return {
    treeId: tree?.treeId || "",
    kind: tree?.kind || "",
    ownerId: tree?.ownerId || "",
    status: tree?.status || "",
    inputHash: tree?.inputHash || "",
    nodeCount: nodes.length,
    byStatus,
    updatedAt: tree?.updatedAt || "",
    completedAt: tree?.completedAt || ""
  };
}
