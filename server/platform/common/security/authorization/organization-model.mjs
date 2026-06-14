import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ServerConfig } from "../../config/ServerConfig.mjs";

export const ORGANIZATION_MODEL_PROTOCOL_VERSION = "v0.0.1:platform:organization-model-1";
export const PACT_ROOT_ORGANIZATION_ID = "pact-root";
export const PACT_ROOT_ORGANIZATION_LABEL = "Pact Root";

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

function normalizeNodeId(value, fallbackPrefix) {
  const text = String(value || "").trim();
  if (text) {
    return text.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160);
  }
  return `${fallbackPrefix}_${crypto.randomUUID()}`;
}

function normalizeParentId(value) {
  return String(value || PACT_ROOT_ORGANIZATION_ID).trim() || PACT_ROOT_ORGANIZATION_ID;
}

function nodeFromRow(row) {
  if (!row) return null;
  return {
    protocolVersion: ORGANIZATION_MODEL_PROTOCOL_VERSION,
    nodeId: row.node_id,
    nodeType: row.node_type,
    parentId: row.parent_id || "",
    label: row.label || row.node_id,
    username: row.username || "",
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS organization_tree_nodes (
      node_id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      parent_id TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_organization_tree_parent ON organization_tree_nodes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_organization_tree_type ON organization_tree_nodes(node_type);
  `);
}

export function createOrganizationModelStore({ userDataPath = "", rootPath = "" } = {}) {
  const resolvedRoot = rootPath ||
    path.join(userDataPath || ServerConfig.getDataDir(), "security", "organization-model");
  fs.mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(resolvedRoot, "organization-model.sqlite"));
  ensureSchema(db);

  const upsertNodeStmt = db.prepare(`
    INSERT INTO organization_tree_nodes (
      node_id, node_type, parent_id, label, username, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      node_type = excluded.node_type,
      parent_id = excluded.parent_id,
      label = excluded.label,
      username = excluded.username,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);

  function getNode(nodeId) {
    return nodeFromRow(db.prepare("SELECT * FROM organization_tree_nodes WHERE node_id = ?").get(String(nodeId || "")));
  }

  function seedRoot() {
    const existing = getNode(PACT_ROOT_ORGANIZATION_ID);
    const timestamp = nowIso();
    upsertNodeStmt.run(
      PACT_ROOT_ORGANIZATION_ID,
      "root",
      "",
      PACT_ROOT_ORGANIZATION_LABEL,
      "",
      stringifyJson({ authorizationBoundary: false }, {}),
      existing?.createdAt || timestamp,
      timestamp
    );
  }

  function assertKnownParent(parentId, childType, childId = "") {
    const parent = getNode(parentId);
    if (!parent) {
      throw new Error(`Unknown organization parent: ${parentId}`);
    }
    if (parent.nodeType === "user") {
      throw new Error("Users cannot have child organizations or users.");
    }
    if (childType === "root") {
      throw new Error("Pact Root cannot have a parent.");
    }
    if (childId && parent.nodeId === childId) {
      throw new Error("Organization tree cannot parent a node to itself.");
    }
    if (childType === "organization" && childId) {
      let cursor = parent;
      while (cursor?.parentId) {
        if (cursor.parentId === childId) {
          throw new Error("Organization tree cannot contain cycles.");
        }
        cursor = getNode(cursor.parentId);
      }
    }
  }

  function upsertNode({ nodeId, nodeType, parentId = PACT_ROOT_ORGANIZATION_ID, label = "", username = "", metadata = {} } = {}) {
    const normalizedType = String(nodeType || "").trim();
    if (!["root", "organization", "user"].includes(normalizedType)) {
      throw new Error(`Unsupported organization node type: ${normalizedType || "(empty)"}`);
    }
    const id = normalizeNodeId(nodeId, normalizedType);
    if (id === PACT_ROOT_ORGANIZATION_ID && normalizedType !== "root") {
      throw new Error("Pact Root id is reserved.");
    }
    if (normalizedType === "root" && id !== PACT_ROOT_ORGANIZATION_ID) {
      throw new Error("Only Pact Root may use node type root.");
    }
    const parent = normalizedType === "root" ? "" : normalizeParentId(parentId);
    if (normalizedType !== "root") {
      assertKnownParent(parent, normalizedType, id);
    }
    const existing = getNode(id);
    if (existing?.nodeType === "root") {
      throw new Error("Pact Root is immutable.");
    }
    const timestamp = nowIso();
    upsertNodeStmt.run(
      id,
      normalizedType,
      parent,
      String(label || username || id).trim(),
      String(username || "").trim(),
      stringifyJson(metadata && typeof metadata === "object" ? metadata : {}, {}),
      existing?.createdAt || timestamp,
      timestamp
    );
    return getNode(id);
  }

  function upsertOrganization(input = {}) {
    return upsertNode({
      nodeId: input.organizationId || input.orgId || input.nodeId || input.id,
      nodeType: "organization",
      parentId: input.parentId || input.parentOrganizationId || PACT_ROOT_ORGANIZATION_ID,
      label: input.label || input.name,
      metadata: input.metadata
    });
  }

  function attachUser(input = {}) {
    return upsertNode({
      nodeId: input.userId || input.nodeId || input.id,
      nodeType: "user",
      parentId: input.parentId || input.organizationId || input.orgId || PACT_ROOT_ORGANIZATION_ID,
      label: input.label || input.displayName || input.username,
      username: input.username,
      metadata: input.metadata
    });
  }

  function moveNode(nodeId, parentId = PACT_ROOT_ORGANIZATION_ID) {
    const node = getNode(nodeId);
    if (!node) {
      throw new Error(`Unknown organization node: ${nodeId}`);
    }
    if (node.nodeType === "root") {
      throw new Error("Pact Root cannot be moved.");
    }
    return upsertNode({
      nodeId: node.nodeId,
      nodeType: node.nodeType,
      parentId,
      label: node.label,
      username: node.username,
      metadata: node.metadata
    });
  }

  function listNodes() {
    return db.prepare("SELECT * FROM organization_tree_nodes ORDER BY node_type ASC, node_id ASC").all().map(nodeFromRow);
  }

  function listChildren(parentId = PACT_ROOT_ORGANIZATION_ID) {
    return db.prepare("SELECT * FROM organization_tree_nodes WHERE parent_id = ? ORDER BY node_type ASC, node_id ASC")
      .all(String(parentId || ""))
      .map(nodeFromRow);
  }

  function pathForNode(nodeId) {
    const output = [];
    let cursor = getNode(nodeId);
    const seen = new Set();
    while (cursor) {
      if (seen.has(cursor.nodeId)) {
        throw new Error("Organization tree contains a cycle.");
      }
      seen.add(cursor.nodeId);
      output.unshift(cursor);
      if (!cursor.parentId) break;
      cursor = getNode(cursor.parentId);
    }
    return output;
  }

  function describeModel() {
    const nodes = listNodes();
    return {
      protocolVersion: ORGANIZATION_MODEL_PROTOCOL_VERSION,
      root: getNode(PACT_ROOT_ORGANIZATION_ID),
      nodeCount: nodes.length,
      organizationCount: nodes.filter((node) => node.nodeType === "organization").length,
      userCount: nodes.filter((node) => node.nodeType === "user").length,
      authorizationBoundary: false,
      capabilityKernelBoundary: "excluded"
    };
  }

  seedRoot();

  return {
    close() {
      db.close();
    },
    getNode,
    listNodes,
    listChildren,
    pathForNode,
    upsertOrganization,
    attachUser,
    moveNode,
    describeModel
  };
}
