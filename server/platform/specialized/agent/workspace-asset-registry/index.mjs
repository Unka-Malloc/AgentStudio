import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ServerConfig } from "../../../common/config/ServerConfig.mjs";

export const WORKSPACE_ASSET_REGISTRY_PROTOCOL_VERSION = "v0.0.1:workspace:asset-registry-1";
export const WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION = "v0.0.1:workspace:asset-operation-1";

function nowIso() {
  return new Date().toISOString();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function text(value) {
  return String(value ?? "").trim();
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Buffer.isBuffer(value)) {
    return JSON.stringify({
      type: "buffer",
      byteLength: value.length,
      sha256: crypto.createHash("sha256").update(value).digest("hex")
    });
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function stableId(prefix, value, length = 24) {
  return `${prefix}_${crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, length)}`;
}

function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function uniqueStrings(values = []) {
  return [...new Set(asArray(values).map(text).filter(Boolean))];
}

function dbPathFor(userDataPath = "") {
  const root = userDataPath || ServerConfig.getDataDir();
  return path.join(root, "workspace-assets", "workspace-assets.sqlite");
}

function normalizeWorkspaceId(input = {}) {
  return text(input.workspaceId || input.workspaceRef || input.workspace || "default");
}

function normalizeAssetKind(value = "") {
  const normalized = text(value || "file");
  if (normalized === "code" || normalized === "code_change" || normalized === "codeChange") return "codeChange";
  if (normalized === "contribution") return "workspaceContribution";
  return normalized;
}

function normalizeCanonicalState(value = "") {
  const normalized = text(value || "canonical");
  if (["canonical", "pending", "review", "projected", "source", "archived"].includes(normalized)) return normalized;
  return "canonical";
}

function targetKey({ workspaceId, assetKind, targetKind, targetRef, sourceRef, displayName }) {
  return {
    workspaceId,
    assetKind,
    targetKind: text(targetKind || asObject(targetRef).kind || asObject(sourceRef).kind),
    targetRef: asObject(targetRef),
    sourceRef: asObject(sourceRef),
    displayName: text(displayName)
  };
}

function assetRefFrom(input = {}) {
  const provided = text(input.assetRef || input.assetId);
  if (provided) return provided;
  return stableId("workspace_asset", targetKey(input));
}

function contentRefFrom(input = {}) {
  const content = asObject(input.content);
  return {
    contentRef: text(content.contentRef || input.contentRef || ""),
    contentHash: text(content.contentHash || content.sha256 || input.contentHash || input.sha256 || ""),
    byteSize: Number(content.byteSize ?? content.sizeBytes ?? input.byteSize ?? input.sizeBytes ?? 0) || 0,
    mediaType: text(content.mediaType || content.mimeType || input.mediaType || input.contentType || "")
  };
}

function receiptRefFrom(input = {}) {
  return stableId("workspace_asset_receipt", {
    assetRef: input.assetRef,
    ledgerEventId: input.ledgerEventId,
    downstreamOperationId: input.downstreamOperationId,
    receiptType: input.receiptType,
    receipt: input.receipt,
    nonce: input.nonce || ""
  });
}

function revisionRefFrom(input = {}) {
  return stableId("workspace_asset_revision", {
    assetRef: input.assetRef,
    ledgerEventId: input.ledgerEventId,
    checkpointRef: input.checkpointRef,
    contentHash: input.contentHash,
    state: input.state,
    nonce: input.nonce || crypto.randomUUID()
  });
}

function projectionRefFrom(input = {}) {
  return stableId("workspace_asset_projection", {
    assetRef: input.assetRef,
    targetKind: input.targetKind,
    targetRef: input.targetRef,
    externalRef: input.externalRef
  });
}

function linkRefFrom(input = {}) {
  return stableId("workspace_asset_link", {
    assetRef: input.assetRef,
    linkedRef: input.linkedRef,
    linkType: input.linkType
  });
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS workspace_assets (
      asset_ref TEXT PRIMARY KEY,
      protocol_version TEXT NOT NULL DEFAULT '${WORKSPACE_ASSET_REGISTRY_PROTOCOL_VERSION}',
      workspace_id TEXT NOT NULL,
      asset_kind TEXT NOT NULL,
      canonical_state TEXT NOT NULL,
      data_class TEXT NOT NULL DEFAULT 'internal',
      display_name TEXT NOT NULL DEFAULT '',
      current_revision_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS workspace_asset_revisions (
      revision_ref TEXT PRIMARY KEY,
      asset_ref TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      source_ref_json TEXT NOT NULL DEFAULT '{}',
      content_ref_json TEXT NOT NULL DEFAULT '{}',
      target_ref_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL DEFAULT '',
      byte_size INTEGER NOT NULL DEFAULT 0,
      media_type TEXT NOT NULL DEFAULT '',
      ledger_event_id TEXT NOT NULL DEFAULT '',
      checkpoint_ref TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_asset_projections (
      projection_ref TEXT PRIMARY KEY,
      asset_ref TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      target_kind TEXT NOT NULL DEFAULT '',
      target_ref_json TEXT NOT NULL DEFAULT '{}',
      external_ref_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT '',
      receipt_refs_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_asset_receipts (
      receipt_ref TEXT PRIMARY KEY,
      asset_ref TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      ledger_event_id TEXT NOT NULL DEFAULT '',
      downstream_operation_id TEXT NOT NULL DEFAULT '',
      receipt_type TEXT NOT NULL DEFAULT '',
      receipt_json TEXT NOT NULL DEFAULT '{}',
      audit_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_asset_links (
      link_ref TEXT PRIMARY KEY,
      asset_ref TEXT NOT NULL,
      linked_ref TEXT NOT NULL,
      link_type TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_assets_workspace ON workspace_assets(workspace_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_assets_kind ON workspace_assets(workspace_id, asset_kind, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_revisions_asset ON workspace_asset_revisions(asset_ref, created_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_projections_asset ON workspace_asset_projections(asset_ref, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_receipts_asset ON workspace_asset_receipts(asset_ref, created_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_links_asset ON workspace_asset_links(asset_ref, created_at);
  `);
}

function hydrateAsset(row) {
  if (!row) return null;
  return {
    protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
    registryProtocolVersion: row.protocol_version || WORKSPACE_ASSET_REGISTRY_PROTOCOL_VERSION,
    assetRef: row.asset_ref,
    workspaceId: row.workspace_id,
    assetKind: row.asset_kind,
    canonicalState: row.canonical_state,
    dataClass: row.data_class,
    displayName: row.display_name || "",
    currentRevisionRef: row.current_revision_ref || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseJson(row.metadata_json, {})
  };
}

function hydrateRevision(row) {
  if (!row) return null;
  return {
    revisionRef: row.revision_ref,
    assetRef: row.asset_ref,
    workspaceId: row.workspace_id,
    sourceRef: parseJson(row.source_ref_json, {}),
    contentRef: parseJson(row.content_ref_json, {}),
    targetRef: parseJson(row.target_ref_json, {}),
    contentHash: row.content_hash || "",
    byteSize: row.byte_size || 0,
    mediaType: row.media_type || "",
    ledgerEventId: row.ledger_event_id || "",
    checkpointRef: row.checkpoint_ref || "",
    state: row.state || "",
    createdAt: row.created_at
  };
}

function hydrateProjection(row) {
  if (!row) return null;
  return {
    projectionRef: row.projection_ref,
    assetRef: row.asset_ref,
    workspaceId: row.workspace_id,
    targetKind: row.target_kind || "",
    targetRef: parseJson(row.target_ref_json, {}),
    externalRef: parseJson(row.external_ref_json, {}),
    status: row.status || "",
    receiptRefs: parseJson(row.receipt_refs_json, []),
    updatedAt: row.updated_at
  };
}

function hydrateReceipt(row) {
  if (!row) return null;
  return {
    receiptRef: row.receipt_ref,
    assetRef: row.asset_ref,
    workspaceId: row.workspace_id,
    ledgerEventId: row.ledger_event_id || "",
    downstreamOperationId: row.downstream_operation_id || "",
    receiptType: row.receipt_type || "",
    receipt: parseJson(row.receipt_json, {}),
    auditId: row.audit_id || "",
    createdAt: row.created_at
  };
}

function hydrateLink(row) {
  if (!row) return null;
  return {
    linkRef: row.link_ref,
    assetRef: row.asset_ref,
    linkedRef: row.linked_ref,
    linkType: row.link_type,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at
  };
}

function firstString(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function displayNameFrom(input = {}) {
  const targetRef = asObject(input.targetRef);
  const sourceRef = asObject(input.sourceRef);
  return firstString(
    input.displayName,
    targetRef.path,
    targetRef.filePath,
    targetRef.targetPath,
    sourceRef.path,
    sourceRef.filePath,
    input.assetKind
  );
}

function receiptItemsFrom(input = {}) {
  const receipts = asArray(input.receipts);
  const normalized = receipts
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      if ("receiptType" in item || "type" in item || "receipt" in item) return [item];
      return Object.entries(item)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([key, value]) => ({
          receiptType: key,
          receipt: value
        }));
    })
    .filter((item) => item && typeof item === "object");
  return normalized;
}

async function maybeCall(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function normalizedFileItems(payload = {}) {
  const items = asArray(payload.files || payload.items || payload.entries);
  return items
    .filter((item) => item && typeof item === "object" && item.isDirectory !== true && item.type !== "directory")
    .map((item) => ({
      workspaceId: normalizeWorkspaceId(item),
      path: firstString(item.path, item.relativePath, item.filePath),
      contentHash: firstString(item.contentSha256, item.sha256, item.contentHash),
      byteSize: Number(item.sizeBytes ?? item.byteSize ?? item.size ?? 0) || 0,
      mediaType: firstString(item.mediaType, item.contentType)
    }))
    .filter((item) => item.path);
}

export function createWorkspaceAssetRegistry({ userDataPath = "" } = {}) {
  const filePath = dbPathFor(userDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  ensureSchema(db);

  const upsertAssetStmt = db.prepare(`
    INSERT INTO workspace_assets (
      asset_ref, workspace_id, asset_kind, canonical_state, data_class,
      display_name, current_revision_ref, created_at, updated_at, metadata_json
    )
    VALUES (
      @assetRef, @workspaceId, @assetKind, @canonicalState, @dataClass,
      @displayName, @currentRevisionRef, @createdAt, @updatedAt, @metadataJson
    )
    ON CONFLICT(asset_ref) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      asset_kind = excluded.asset_kind,
      canonical_state = excluded.canonical_state,
      data_class = excluded.data_class,
      display_name = excluded.display_name,
      current_revision_ref = excluded.current_revision_ref,
      updated_at = excluded.updated_at,
      metadata_json = excluded.metadata_json
  `);
  const insertRevisionStmt = db.prepare(`
    INSERT INTO workspace_asset_revisions (
      revision_ref, asset_ref, workspace_id, source_ref_json, content_ref_json,
      target_ref_json, content_hash, byte_size, media_type, ledger_event_id,
      checkpoint_ref, state, created_at
    )
    VALUES (
      @revisionRef, @assetRef, @workspaceId, @sourceRefJson, @contentRefJson,
      @targetRefJson, @contentHash, @byteSize, @mediaType, @ledgerEventId,
      @checkpointRef, @state, @createdAt
    )
  `);
  const upsertProjectionStmt = db.prepare(`
    INSERT INTO workspace_asset_projections (
      projection_ref, asset_ref, workspace_id, target_kind, target_ref_json,
      external_ref_json, status, receipt_refs_json, updated_at
    )
    VALUES (
      @projectionRef, @assetRef, @workspaceId, @targetKind, @targetRefJson,
      @externalRefJson, @status, @receiptRefsJson, @updatedAt
    )
    ON CONFLICT(projection_ref) DO UPDATE SET
      target_ref_json = excluded.target_ref_json,
      external_ref_json = excluded.external_ref_json,
      status = excluded.status,
      receipt_refs_json = excluded.receipt_refs_json,
      updated_at = excluded.updated_at
  `);
  const insertReceiptStmt = db.prepare(`
    INSERT OR IGNORE INTO workspace_asset_receipts (
      receipt_ref, asset_ref, workspace_id, ledger_event_id, downstream_operation_id,
      receipt_type, receipt_json, audit_id, created_at
    )
    VALUES (
      @receiptRef, @assetRef, @workspaceId, @ledgerEventId, @downstreamOperationId,
      @receiptType, @receiptJson, @auditId, @createdAt
    )
  `);
  const insertLinkStmt = db.prepare(`
    INSERT OR IGNORE INTO workspace_asset_links (
      link_ref, asset_ref, linked_ref, link_type, metadata_json, created_at
    )
    VALUES (@linkRef, @assetRef, @linkedRef, @linkType, @metadataJson, @createdAt)
  `);
  const selectAssetStmt = db.prepare("SELECT * FROM workspace_assets WHERE asset_ref = ?");
  const selectRevisionStmt = db.prepare("SELECT * FROM workspace_asset_revisions WHERE revision_ref = ?");
  const listAssetRevisionsStmt = db.prepare(`
    SELECT * FROM workspace_asset_revisions
    WHERE asset_ref = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const listAssetProjectionsStmt = db.prepare(`
    SELECT * FROM workspace_asset_projections
    WHERE asset_ref = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const listAssetReceiptsStmt = db.prepare(`
    SELECT * FROM workspace_asset_receipts
    WHERE asset_ref = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const listAssetLinksStmt = db.prepare(`
    SELECT * FROM workspace_asset_links
    WHERE asset_ref = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const listAssetsStmt = db.prepare(`
    SELECT * FROM workspace_assets
    WHERE (@workspaceId = '' OR workspace_id = @workspaceId)
      AND (@assetKind = '' OR asset_kind = @assetKind)
      AND (@canonicalState = '' OR canonical_state = @canonicalState)
      AND (
        @targetKind = ''
        OR asset_ref IN (
          SELECT asset_ref FROM workspace_asset_projections WHERE target_kind = @targetKind
        )
      )
    ORDER BY updated_at DESC
    LIMIT @limit
  `);

  const mutationTx = db.transaction((input = {}) => {
    const workspaceId = normalizeWorkspaceId(input);
    const assetKind = normalizeAssetKind(input.assetKind || input.kind);
    const canonicalState = normalizeCanonicalState(input.canonicalState || input.state);
    const dataClass = text(input.dataClass || input.policy?.dataClass || "internal") || "internal";
    const targetRef = asObject(input.targetRef || input.target);
    const sourceRef = asObject(input.sourceRef || input.source);
    const contentRef = contentRefFrom(input);
    const targetKind = text(input.targetKind || targetRef.kind || sourceRef.kind || assetKind);
    const assetRef = assetRefFrom({
      ...input,
      workspaceId,
      assetKind,
      targetKind,
      targetRef,
      sourceRef
    });
    const ledgerEventId = text(input.ledgerEventId || input.ledgerId);
    const checkpointRef = text(input.checkpointRef || input.checkpoint?.checkpointId || input.checkpoint?.nodeId || input.checkpoint?.checkpointNodeId || "");
    const revisionRef = text(input.revisionRef) || revisionRefFrom({
      assetRef,
      ledgerEventId,
      checkpointRef,
      contentHash: contentRef.contentHash,
      state: canonicalState
    });
    const timestamp = nowIso();
    const displayName = displayNameFrom({ ...input, assetKind, targetRef, sourceRef });
    const metadata = asObject(input.metadata);
    upsertAssetStmt.run({
      assetRef,
      workspaceId,
      assetKind,
      canonicalState,
      dataClass,
      displayName,
      currentRevisionRef: revisionRef,
      createdAt: text(input.createdAt || timestamp),
      updatedAt: timestamp,
      metadataJson: stringifyJson(metadata)
    });
    insertRevisionStmt.run({
      revisionRef,
      assetRef,
      workspaceId,
      sourceRefJson: stringifyJson(sourceRef),
      contentRefJson: stringifyJson(contentRef),
      targetRefJson: stringifyJson(targetRef),
      contentHash: contentRef.contentHash,
      byteSize: contentRef.byteSize,
      mediaType: contentRef.mediaType,
      ledgerEventId,
      checkpointRef,
      state: canonicalState,
      createdAt: timestamp
    });

    const receiptRefs = [];
    for (const item of receiptItemsFrom(input)) {
      const receiptType = text(item.receiptType || item.type || "receipt") || "receipt";
      const receipt = item.receipt !== undefined ? item.receipt : item;
      const receiptRef = text(item.receiptRef) || receiptRefFrom({
        assetRef,
        ledgerEventId,
        downstreamOperationId: input.downstreamOperationId,
        receiptType,
        receipt,
        nonce: stableJson(receipt)
      });
      insertReceiptStmt.run({
        receiptRef,
        assetRef,
        workspaceId,
        ledgerEventId,
        downstreamOperationId: text(input.downstreamOperationId || ""),
        receiptType,
        receiptJson: stringifyJson(receipt),
        auditId: text(input.auditId || item.auditId || ""),
        createdAt: timestamp
      });
      receiptRefs.push(receiptRef);
    }

    const projectionRef = text(input.projectionRef) || projectionRefFrom({
      assetRef,
      targetKind,
      targetRef,
      externalRef: input.externalRef || {}
    });
    upsertProjectionStmt.run({
      projectionRef,
      assetRef,
      workspaceId,
      targetKind,
      targetRefJson: stringifyJson(targetRef),
      externalRefJson: stringifyJson(asObject(input.externalRef)),
      status: text(input.projectionStatus || canonicalState || "active"),
      receiptRefsJson: stringifyJson(receiptRefs),
      updatedAt: timestamp
    });

    for (const link of asArray(input.links)) {
      if (!link || typeof link !== "object") continue;
      const linkedRef = text(link.linkedRef || link.assetRef || link.sourceRef || link.targetRef || "");
      const linkType = text(link.linkType || link.type || "lineage");
      if (!linkedRef || !linkType) continue;
      insertLinkStmt.run({
        linkRef: text(link.linkRef) || linkRefFrom({ assetRef, linkedRef, linkType }),
        assetRef,
        linkedRef,
        linkType,
        metadataJson: stringifyJson(asObject(link.metadata)),
        createdAt: timestamp
      });
    }

    return {
      protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
      registryProtocolVersion: WORKSPACE_ASSET_REGISTRY_PROTOCOL_VERSION,
      assetRef,
      revisionRef,
      canonicalState,
      ledgerEventId,
      receiptRefs,
      routeDecision: asObject(input.routeDecision),
      asset: hydrateAsset(selectAssetStmt.get(assetRef)),
      revision: hydrateRevision(selectRevisionStmt.get(revisionRef)),
      projectionRef
    };
  });

  function recordAssetMutation(input = {}) {
    return mutationTx(input);
  }

  function getAsset(input = {}) {
    const assetRef = text(input.assetRef || input.assetId || input.id || input);
    const asset = hydrateAsset(selectAssetStmt.get(assetRef));
    if (!asset) return null;
    const revisionLimit = Math.max(1, Math.min(Number(input.revisionLimit || 20), 100));
    const projectionLimit = Math.max(1, Math.min(Number(input.projectionLimit || 20), 100));
    return {
      ...asset,
      revisions: listAssetRevisionsStmt.all(assetRef, revisionLimit).map(hydrateRevision),
      projections: listAssetProjectionsStmt.all(assetRef, projectionLimit).map(hydrateProjection),
      receipts: listAssetReceiptsStmt.all(assetRef, Math.max(1, Math.min(Number(input.receiptLimit || 20), 100))).map(hydrateReceipt),
      lineageLinks: listAssetLinksStmt.all(assetRef, 100).map(hydrateLink)
    };
  }

  function listAssets(input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 500));
    const items = listAssetsStmt.all({
      workspaceId: normalizeWorkspaceId(input),
      assetKind: text(input.assetKind || ""),
      canonicalState: text(input.canonicalState || ""),
      targetKind: text(input.targetKind || ""),
      limit
    }).map(hydrateAsset);
    return {
      protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
      registryProtocolVersion: WORKSPACE_ASSET_REGISTRY_PROTOCOL_VERSION,
      items,
      count: items.length
    };
  }

  function listReceipts(input = {}) {
    const assetRef = text(input.assetRef || input.assetId || input.id || "");
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 500));
    if (assetRef) {
      const items = listAssetReceiptsStmt.all(assetRef, limit).map(hydrateReceipt);
      return {
        protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
        items,
        count: items.length
      };
    }
    const workspaceId = normalizeWorkspaceId(input);
    const stmt = db.prepare(`
      SELECT * FROM workspace_asset_receipts
      WHERE (@workspaceId = '' OR workspace_id = @workspaceId)
      ORDER BY created_at DESC
      LIMIT @limit
    `);
    const items = stmt.all({ workspaceId, limit }).map(hydrateReceipt);
    return {
      protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
      items,
      count: items.length
    };
  }

  function listLineage(input = {}) {
    const assetRef = text(input.assetRef || input.assetId || input.id || "");
    if (!assetRef) {
      return {
        protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
        items: [],
        count: 0
      };
    }
    const items = listAssetLinksStmt.all(assetRef, Math.max(1, Math.min(Number(input.limit || 100), 500))).map(hydrateLink);
    return {
      protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
      items,
      count: items.length
    };
  }

  async function backfill(input = {}) {
    const agentWorkspace = input.agentWorkspace;
    const contributionRegistry = input.contributionRegistry;
    const workspaceIdFilter = text(input.workspaceId || "");
    const limit = Math.max(1, Math.min(Number(input.limit || 500), 5000));
    const timestamp = nowIso();
    const accessibleWorkspaceIds = new Set();
    const summary = {
      protocolVersion: WORKSPACE_ASSET_OPERATION_PROTOCOL_VERSION,
      registryProtocolVersion: WORKSPACE_ASSET_REGISTRY_PROTOCOL_VERSION,
      ok: true,
      backfilledAt: timestamp,
      files: 0,
      contributions: 0,
      codeChanges: 0,
      assets: []
    };

    if (agentWorkspace && typeof agentWorkspace.listWorkspaces === "function" && typeof agentWorkspace.listWorkspaceFiles === "function") {
      const workspaceList = await maybeCall(() => agentWorkspace.listWorkspaces({
        actorUserId: input.actorUserId,
        userId: input.userId,
        subjectId: input.subjectId,
        username: input.username,
        roleId: input.roleId,
        scopes: input.scopes,
        allowedWorkspaceIds: input.allowedWorkspaceIds,
        canAccessAll: input.canAccessAll === true,
        limit: Math.min(limit, 500),
        includeSummary: false
      }), { workspaces: [] });
      const workspaces = asArray(workspaceList?.workspaces)
        .filter((workspace) => !workspaceIdFilter || workspace.workspaceId === workspaceIdFilter);
      for (const workspace of workspaces) {
        if (workspace?.workspaceId) {
          accessibleWorkspaceIds.add(workspace.workspaceId);
        }
      }
      for (const workspace of workspaces) {
        const filePayload = await maybeCall(() => agentWorkspace.listWorkspaceFiles({
          actorUserId: input.actorUserId,
          userId: input.userId,
          subjectId: input.subjectId,
          username: input.username,
          roleId: input.roleId,
          scopes: input.scopes,
          allowedWorkspaceIds: input.allowedWorkspaceIds,
          canAccessAll: input.canAccessAll === true,
          workspaceId: workspace.workspaceId,
          recursive: true,
          includeDirectories: false,
          includeFiles: true,
          includeHash: true,
          limit
        }), { files: [] });
        for (const file of normalizedFileItems(filePayload)) {
          const registered = recordAssetMutation({
            workspaceId: workspace.workspaceId,
            assetKind: "file",
            canonicalState: "canonical",
            dataClass: "internal",
            displayName: file.path,
            targetKind: "workspaceFolder",
            targetRef: {
              kind: "workspaceFolder",
              path: file.path
            },
            sourceRef: {
              kind: "backfill",
              sourceType: "workspaceFile"
            },
            content: {
              contentHash: file.contentHash,
              byteSize: file.byteSize,
              mediaType: file.mediaType
            },
            ledgerEventId: "",
            downstreamOperationId: "workspace.asset.backfill",
            receipts: [{
              receiptType: "backfill",
              receipt: {
                kind: "workspace_file_backfill",
                path: file.path,
                capturedAt: timestamp
              }
            }],
            metadata: {
              backfill: true
            }
          });
          summary.files += 1;
          summary.assets.push(registered.workspaceAsset || registered.assetRef);
        }
      }
    }

    if (contributionRegistry && typeof contributionRegistry.listContributions === "function") {
      const contributions = asArray(await maybeCall(() => contributionRegistry.listContributions(), []))
        .filter((item) => {
          const contributionWorkspaceId = normalizeWorkspaceId(item);
          if (!contributionWorkspaceId) {
            return false;
          }
          if (workspaceIdFilter && contributionWorkspaceId !== workspaceIdFilter) {
            return false;
          }
          return input.canAccessAll === true || accessibleWorkspaceIds.has(contributionWorkspaceId);
        })
        .slice(0, limit);
      for (const contribution of contributions) {
        const contributionId = firstString(contribution.contributionId, contribution.id, contribution.assetId);
        if (!contributionId) continue;
        recordAssetMutation({
          workspaceId: normalizeWorkspaceId(contribution),
          assetKind: "workspaceContribution",
          canonicalState: contribution.status === "published" || contribution.status === "adopted" ? "canonical" : "pending",
          dataClass: firstString(contribution.dataClass, "internal"),
          displayName: firstString(contribution.title, contribution.name, contributionId),
          targetKind: "workspaceContribution",
          targetRef: {
            kind: "workspaceContribution",
            contributionId
          },
          sourceRef: {
            kind: "backfill",
            sourceType: "workspaceContribution"
          },
          downstreamOperationId: "workspace.asset.backfill",
          receipts: [{
            receiptType: "backfill",
            receipt: {
              kind: "workspace_contribution_backfill",
              contributionId,
              status: contribution.status || "",
              capturedAt: timestamp
            }
          }],
          metadata: {
            backfill: true
          }
        });
        summary.contributions += 1;
      }
    }

    summary.count = summary.files + summary.contributions + summary.codeChanges;
    return summary;
  }

  return {
    protocolVersion: WORKSPACE_ASSET_REGISTRY_PROTOCOL_VERSION,
    filePath,
    recordAssetMutation,
    getAsset,
    listAssets,
    listReceipts,
    listLineage,
    backfill
  };
}
