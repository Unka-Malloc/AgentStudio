import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION = "v0.0.1:storage:data-connector-governance-1";
export const DATA_CONNECTOR_MANIFEST_PROTOCOL_VERSION = "v0.0.1:storage:data-connector-1";
export const LOCAL_MIRROR_PROTOCOL_VERSION = "v0.0.1:storage:local-mirror-1";

const STATE_DIR = "data-connector-governance";
const STATE_FILE = "registry.json";
const DEFAULT_CAPABILITIES = ["sync", "localQuery"];
const VALID_AUTH_TYPES = new Set(["none", "oauth2", "apiKey", "custom"]);
const VALID_SYNC_MODES = new Set(["incrementalCursor", "snapshot", "appendOnly"]);
const VALID_CONFLICT_POLICIES = new Set(["newerCapturedAtWins", "revisionWins", "manualReview"]);
const VALID_HASH_COLLISION_POLICIES = new Set(["quarantine", "manualReview", "reject"]);

function nowIso() {
  return new Date().toISOString();
}

function asObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value = []) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeKebab(value = "") {
  return String(value || "")
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();
}

function isKebabId(value = "") {
  return /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function stableJson(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function statePath(userDataPath) {
  return path.join(userDataPath, STATE_DIR, STATE_FILE);
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, filePath);
}

function sourceIdentity({ providerId = "", sourceType = "", externalId = "" } = {}) {
  return [providerId, sourceType, externalId].map((item) => String(item || "").trim().toLowerCase()).join("::");
}

function contentSignature(item = {}) {
  const source = {
    title: item.title || item.name || "",
    text: item.text || item.snippet || item.body || "",
    sourceMetadata: asObject(item.sourceMetadata),
    capturedAt: item.capturedAt || item.timestamp || ""
  };
  return digest(source);
}

function normalizeConnectorAuth(auth = {}) {
  const value = asObject(auth);
  const type = String(value.type || "none").trim() || "none";
  return {
    type,
    refreshRequired: Boolean(value.refreshRequired ?? (type === "oauth2")),
    tokenStorage: String(value.tokenStorage || (type === "none" ? "none" : "secret-store")).trim(),
    scopes: uniqueStrings(value.scopes || [])
  };
}

function normalizeConnectorSync(sync = {}) {
  const value = asObject(sync);
  return {
    mode: String(value.mode || "incrementalCursor").trim(),
    cursorField: String(value.cursorField || "cursor").trim(),
    conflictPolicy: String(value.conflictPolicy || "newerCapturedAtWins").trim(),
    hashCollisionPolicy: String(value.hashCollisionPolicy || "quarantine").trim(),
    rateLimit: {
      maxItemsPerSync: Math.max(1, Math.min(100000, Number(value.rateLimit?.maxItemsPerSync || 5000))),
      maxBytesPerSync: Math.max(1024, Math.min(10 * 1024 * 1024 * 1024, Number(value.rateLimit?.maxBytesPerSync || 256 * 1024 * 1024)))
    }
  };
}

function normalizeLocalQuery(localQuery = {}) {
  const value = asObject(localQuery);
  return {
    enabled: value.enabled !== false,
    remoteCallsAllowed: false,
    dedupeWithServerEvidence: value.dedupeWithServerEvidence !== false,
    maxLocalHits: Math.max(1, Math.min(500, Number(value.maxLocalHits || 50)))
  };
}

function normalizeMirrorPolicy(mirror = {}) {
  const value = asObject(mirror);
  return {
    mode: String(value.mode || "localMirror").trim(),
    cleanupRequired: value.cleanupRequired !== false,
    dedupeKeys: uniqueStrings(value.dedupeKeys || ["providerId", "sourceType", "externalId", "contentHash"]),
    retainIngestedKnowledgeOnUninstall: value.retainIngestedKnowledgeOnUninstall !== false
  };
}

export function normalizeDataConnectorManifest(input = {}) {
  const manifest = asObject(input);
  const providerId = normalizeKebab(manifest.providerId || manifest.id || "");
  const sourceType = normalizeKebab(manifest.sourceType || "source");
  return {
    protocolVersion: DATA_CONNECTOR_MANIFEST_PROTOCOL_VERSION,
    providerId,
    sourceType,
    displayName: String(manifest.displayName || manifest.name || providerId || "Data Connector").trim(),
    version: String(manifest.version || "0.0.0").trim(),
    capabilities: uniqueStrings(manifest.capabilities || DEFAULT_CAPABILITIES),
    auth: normalizeConnectorAuth(manifest.auth || manifest.oauth),
    sync: normalizeConnectorSync(manifest.sync || manifest.syncPolicy),
    localQuery: normalizeLocalQuery(manifest.localQuery),
    mirror: normalizeMirrorPolicy(manifest.mirror || manifest.mirrorPolicy),
    uninstall: {
      removeMirrorDefault: Boolean(manifest.uninstall?.removeMirrorDefault ?? manifest.uninstallPolicy?.removeLocalMirror ?? false),
      retainIngestedKnowledge: Boolean(manifest.uninstall?.retainIngestedKnowledge ?? manifest.uninstallPolicy?.retainIngestedKnowledge ?? true)
    },
    security: {
      secretRefs: uniqueStrings(manifest.security?.secretRefs || manifest.secretRefs || []),
      dataClasses: uniqueStrings(manifest.security?.dataClasses || manifest.dataClasses || [])
    },
    metadata: asObject(manifest.metadata)
  };
}

export function validateDataConnectorManifest(input = {}) {
  const manifest = normalizeDataConnectorManifest(input);
  const errors = [];
  const warnings = [];
  if (!isKebabId(manifest.providerId)) errors.push("providerId must be kebab-case and start with a letter.");
  if (!isKebabId(manifest.sourceType)) errors.push("sourceType must be kebab-case and start with a letter.");
  if (!manifest.version || manifest.version === "0.0.0") warnings.push("connector version should be explicit.");
  if (manifest.capabilities.length === 0) errors.push("capabilities must not be empty.");
  if (!VALID_AUTH_TYPES.has(manifest.auth.type)) errors.push(`auth.type is not supported: ${manifest.auth.type}`);
  if (manifest.auth.type === "oauth2" && manifest.auth.refreshRequired !== true) {
    errors.push("oauth2 connectors must declare refreshRequired=true.");
  }
  if (!VALID_SYNC_MODES.has(manifest.sync.mode)) errors.push(`sync.mode is not supported: ${manifest.sync.mode}`);
  if (!VALID_CONFLICT_POLICIES.has(manifest.sync.conflictPolicy)) {
    errors.push(`sync.conflictPolicy is not supported: ${manifest.sync.conflictPolicy}`);
  }
  if (!VALID_HASH_COLLISION_POLICIES.has(manifest.sync.hashCollisionPolicy)) {
    errors.push(`sync.hashCollisionPolicy is not supported: ${manifest.sync.hashCollisionPolicy}`);
  }
  if (manifest.capabilities.includes("localQuery") && manifest.localQuery.remoteCallsAllowed !== false) {
    errors.push("localQuery must be local-mirror only; remoteCallsAllowed must be false.");
  }
  if (!manifest.mirror.dedupeKeys.includes("externalId") || !manifest.mirror.dedupeKeys.includes("contentHash")) {
    errors.push("mirror.dedupeKeys must include externalId and contentHash.");
  }
  return {
    ok: errors.length === 0,
    protocolVersion: DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION,
    manifest,
    manifestDigest: digest(manifest),
    errors,
    warnings,
    contract: {
      oauthRefresh: manifest.auth.type === "oauth2" ? "required" : "not_required",
      syncMode: manifest.sync.mode,
      cursorField: manifest.sync.cursorField,
      localQueryRemoteCallsAllowed: false,
      mirrorProtocolVersion: LOCAL_MIRROR_PROTOCOL_VERSION,
      requiredConformance: [
        "manifest-validation",
        "oauth-refresh-policy",
        "incremental-cursor",
        "conflict-resolution",
        "hash-collision-detection",
        "rate-limit",
        "local-query-no-remote",
        "mirror-cleanup",
        "uninstall-policy"
      ]
    }
  };
}

function defaultState() {
  return {
    protocolVersion: DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    connectors: {},
    mirror: {},
    syncRuns: [],
    auditEvents: []
  };
}

function publicState(state = defaultState()) {
  const connectors = Object.values(state.connectors || {});
  return {
    ok: true,
    protocolVersion: DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION,
    updatedAt: state.updatedAt || "",
    summary: {
      connectorCount: connectors.length,
      activeConnectorCount: connectors.filter((item) => item.status !== "uninstalled").length,
      mirrorProviderCount: Object.keys(state.mirror || {}).length,
      syncRunCount: asArray(state.syncRuns).length,
      auditEventCount: asArray(state.auditEvents).length
    },
    connectors,
    recentSyncRuns: asArray(state.syncRuns).slice(-20).reverse(),
    recentAuditEvents: asArray(state.auditEvents).slice(-50).reverse()
  };
}

export function createDataConnectorGovernance({ userDataPath } = {}) {
  if (!userDataPath) {
    throw new Error("userDataPath is required.");
  }

  async function loadState() {
    const state = await readJsonIfExists(statePath(userDataPath), defaultState());
    return {
      ...defaultState(),
      ...state,
      connectors: asObject(state.connectors),
      mirror: asObject(state.mirror),
      syncRuns: asArray(state.syncRuns),
      auditEvents: asArray(state.auditEvents)
    };
  }

  async function saveState(state) {
    state.updatedAt = nowIso();
    await writeJsonAtomic(statePath(userDataPath), state);
    return state;
  }

  function appendAudit(state, type, payload = {}) {
    state.auditEvents.push({
      eventId: `dcg_${crypto.randomUUID()}`,
      type,
      at: nowIso(),
      payload
    });
  }

  async function describe() {
    return publicState(await loadState());
  }

  async function plan(manifestInput = {}) {
    return validateDataConnectorManifest(manifestInput);
  }

  async function register(manifestInput = {}, { actor = "system" } = {}) {
    const planned = validateDataConnectorManifest(manifestInput);
    if (!planned.ok) {
      const error = new Error("data connector manifest is invalid.");
      error.details = planned.errors;
      throw error;
    }
    const state = await loadState();
    const previous = state.connectors[planned.manifest.providerId] || {};
    state.connectors[planned.manifest.providerId] = {
      ...previous,
      ...planned.manifest,
      status: "registered",
      manifestDigest: planned.manifestDigest,
      registeredAt: previous.registeredAt || nowIso(),
      updatedAt: nowIso()
    };
    state.mirror[planned.manifest.providerId] = state.mirror[planned.manifest.providerId] || {
      providerId: planned.manifest.providerId,
      protocolVersion: LOCAL_MIRROR_PROTOCOL_VERSION,
      records: {},
      quarantine: []
    };
    appendAudit(state, "connector.registered", { providerId: planned.manifest.providerId, actor });
    await saveState(state);
    return {
      ok: true,
      connector: state.connectors[planned.manifest.providerId],
      plan: planned
    };
  }

  async function applySyncBatch({
    providerId,
    sourceType = "",
    syncBatchId = "",
    previousCursor = "",
    nextCursor = "",
    items = []
  } = {}) {
    const normalizedProviderId = normalizeKebab(providerId);
    const state = await loadState();
    const connector = state.connectors[normalizedProviderId];
    if (!connector || connector.status === "uninstalled") {
      throw new Error(`unknown or inactive data connector: ${providerId}`);
    }
    const safeItems = asArray(items).filter((item) => item && typeof item === "object");
    const maxItems = Number(connector.sync?.rateLimit?.maxItemsPerSync || 5000);
    if (safeItems.length > maxItems) {
      const run = {
        runId: `dcs_${crypto.randomUUID()}`,
        providerId: normalizedProviderId,
        syncBatchId: syncBatchId || `sync_${crypto.randomUUID()}`,
        status: "rate_limited",
        itemCount: safeItems.length,
        maxItemsPerSync: maxItems,
        completedAt: nowIso()
      };
      state.syncRuns.push(run);
      appendAudit(state, "connector.sync.rate_limited", run);
      await saveState(state);
      return { ok: false, run };
    }
    const mirror = state.mirror[normalizedProviderId] || {
      providerId: normalizedProviderId,
      protocolVersion: LOCAL_MIRROR_PROTOCOL_VERSION,
      records: {},
      quarantine: []
    };
    const summary = {
      insertedCount: 0,
      updatedCount: 0,
      skippedUnchangedCount: 0,
      conflictCount: 0,
      hashCollisionCount: 0,
      quarantinedCount: 0
    };
    const byHash = new Map(
      Object.values(mirror.records || {}).map((record) => [String(record.contentHash || ""), record]).filter(([key]) => key)
    );
    for (const rawItem of safeItems) {
      const externalId = String(rawItem.externalId || rawItem.id || "").trim();
      if (!externalId) continue;
      const recordSourceType = normalizeKebab(rawItem.sourceType || sourceType || connector.sourceType || "source");
      const identity = sourceIdentity({ providerId: normalizedProviderId, sourceType: recordSourceType, externalId });
      const itemSignature = contentSignature(rawItem);
      const contentHash = String(rawItem.contentHash || rawItem.sha256 || itemSignature).trim();
      const previous = mirror.records[identity];
      const hashPeer = byHash.get(contentHash);
      if (hashPeer && hashPeer.identity !== identity && hashPeer.contentSignature !== itemSignature) {
        summary.hashCollisionCount += 1;
        if (connector.sync.hashCollisionPolicy === "quarantine") {
          summary.quarantinedCount += 1;
          mirror.quarantine.push({
            identity,
            providerId: normalizedProviderId,
            externalId,
            contentHash,
            detectedAt: nowIso(),
            reason: "content_hash_collision"
          });
          continue;
        }
      }
      if (previous && previous.contentHash === contentHash && previous.contentSignature === itemSignature) {
        summary.skippedUnchangedCount += 1;
        continue;
      }
      if (previous && previous.contentHash !== contentHash) {
        summary.conflictCount += 1;
        if (connector.sync.conflictPolicy === "manualReview") {
          mirror.quarantine.push({
            identity,
            providerId: normalizedProviderId,
            externalId,
            contentHash,
            detectedAt: nowIso(),
            reason: "manual_conflict_review"
          });
          summary.quarantinedCount += 1;
          continue;
        }
        summary.updatedCount += 1;
      } else {
        summary.insertedCount += 1;
      }
      const record = {
        identity,
        providerId: normalizedProviderId,
        sourceType: recordSourceType,
        externalId,
        syncBatchId: syncBatchId || "",
        contentHash,
        contentSignature: itemSignature,
        capturedAt: String(rawItem.capturedAt || rawItem.timestamp || nowIso()),
        title: String(rawItem.title || rawItem.name || ""),
        snippet: String(rawItem.snippet || rawItem.text || "").slice(0, 1000),
        updatedAt: nowIso()
      };
      mirror.records[identity] = record;
      byHash.set(contentHash, record);
    }
    mirror.lastCursor = nextCursor || previousCursor || mirror.lastCursor || "";
    mirror.updatedAt = nowIso();
    state.mirror[normalizedProviderId] = mirror;
    const run = {
      runId: `dcs_${crypto.randomUUID()}`,
      providerId: normalizedProviderId,
      syncBatchId: syncBatchId || `sync_${crypto.randomUUID()}`,
      status: "completed",
      previousCursor,
      nextCursor: mirror.lastCursor,
      itemCount: safeItems.length,
      ...summary,
      completedAt: nowIso()
    };
    state.syncRuns.push(run);
    appendAudit(state, "connector.sync.completed", run);
    await saveState(state);
    return { ok: true, run, mirror: mirrorSummary(mirror) };
  }

  function mirrorSummary(mirror = {}) {
    return {
      providerId: mirror.providerId || "",
      protocolVersion: LOCAL_MIRROR_PROTOCOL_VERSION,
      recordCount: Object.keys(mirror.records || {}).length,
      quarantineCount: asArray(mirror.quarantine).length,
      lastCursor: mirror.lastCursor || "",
      updatedAt: mirror.updatedAt || ""
    };
  }

  async function cleanupMirror({ providerId, retainExternalIds = [], dryRun = true } = {}) {
    const normalizedProviderId = normalizeKebab(providerId);
    const state = await loadState();
    const mirror = state.mirror[normalizedProviderId];
    if (!mirror) {
      return { ok: true, providerId: normalizedProviderId, dryRun: Boolean(dryRun), removedCount: 0, plannedExternalIds: [] };
    }
    const retain = new Set(uniqueStrings(retainExternalIds).map((item) => item.toLowerCase()));
    const planned = Object.entries(mirror.records || {})
      .filter(([, record]) => retain.size === 0 || !retain.has(String(record.externalId || "").toLowerCase()))
      .map(([identity, record]) => ({ identity, externalId: record.externalId || "" }));
    if (!dryRun) {
      for (const item of planned) {
        delete mirror.records[item.identity];
      }
      mirror.updatedAt = nowIso();
      appendAudit(state, "connector.mirror.cleaned", { providerId: normalizedProviderId, removedCount: planned.length });
      await saveState(state);
    }
    return {
      ok: true,
      providerId: normalizedProviderId,
      dryRun: Boolean(dryRun),
      removedCount: planned.length,
      plannedExternalIds: planned.map((item) => item.externalId).filter(Boolean),
      mirror: mirrorSummary(mirror)
    };
  }

  async function enforceLocalQueryPolicy({ providerId, requestedRemoteCallsAllowed = false } = {}) {
    const state = await loadState();
    const connector = state.connectors[normalizeKebab(providerId)] || {};
    return {
      ok: requestedRemoteCallsAllowed !== true,
      providerId: connector.providerId || normalizeKebab(providerId),
      remoteCallsAllowed: false,
      requestedRemoteCallsAllowed: Boolean(requestedRemoteCallsAllowed),
      policy: "local-query-must-not-call-remote"
    };
  }

  async function uninstall({ providerId, removeMirror = false, actor = "system" } = {}) {
    const normalizedProviderId = normalizeKebab(providerId);
    const state = await loadState();
    const connector = state.connectors[normalizedProviderId];
    if (!connector) throw new Error(`unknown data connector: ${providerId}`);
    state.connectors[normalizedProviderId] = {
      ...connector,
      status: "uninstalled",
      uninstalledAt: nowIso()
    };
    const removedMirror = Boolean(removeMirror);
    if (removedMirror) {
      delete state.mirror[normalizedProviderId];
    }
    appendAudit(state, "connector.uninstalled", { providerId: normalizedProviderId, actor, removedMirror });
    await saveState(state);
    return { ok: true, providerId: normalizedProviderId, removedMirror, connector: state.connectors[normalizedProviderId] };
  }

  async function runConformance(manifestInput = {}) {
    const planned = await plan(manifestInput);
    if (!planned.ok) {
      return { ok: false, status: "failed", plan: planned, checks: [{ id: "manifest-validation", status: "fail", errors: planned.errors }] };
    }
    const checks = [];
    const registered = await register(planned.manifest, { actor: "conformance" });
    checks.push({ id: "manifest-validation", status: "pass", digest: planned.manifestDigest });
    checks.push({
      id: "oauth-refresh-policy",
      status: planned.contract.oauthRefresh === "required" || planned.manifest.auth.type === "none" ? "pass" : "fail"
    });
    const first = await applySyncBatch({
      providerId: planned.manifest.providerId,
      syncBatchId: "conformance-1",
      previousCursor: "",
      nextCursor: "cursor-1",
      items: [
        { externalId: "doc-1", title: "First", text: "alpha", contentHash: "hash-alpha", capturedAt: "2026-05-21T00:00:00.000Z" },
        { externalId: "doc-2", title: "Second", text: "beta", contentHash: "hash-beta", capturedAt: "2026-05-21T00:01:00.000Z" }
      ]
    });
    checks.push({ id: "incremental-cursor", status: first.run.nextCursor === "cursor-1" ? "pass" : "fail", run: first.run });
    const second = await applySyncBatch({
      providerId: planned.manifest.providerId,
      syncBatchId: "conformance-2",
      previousCursor: "cursor-1",
      nextCursor: "cursor-2",
      items: [
        { externalId: "doc-1", title: "First", text: "alpha", contentHash: "hash-alpha", capturedAt: "2026-05-21T00:00:00.000Z" },
        { externalId: "doc-2", title: "Second", text: "beta changed", contentHash: "hash-beta-2", capturedAt: "2026-05-21T00:02:00.000Z" }
      ]
    });
    checks.push({ id: "conflict-resolution", status: second.run.conflictCount >= 1 && second.run.updatedCount >= 1 ? "pass" : "fail", run: second.run });
    const collision = await applySyncBatch({
      providerId: planned.manifest.providerId,
      syncBatchId: "conformance-3",
      previousCursor: "cursor-2",
      nextCursor: "cursor-3",
      items: [
        { externalId: "doc-3", title: "Third", text: "not alpha", contentHash: "hash-alpha", capturedAt: "2026-05-21T00:03:00.000Z" }
      ]
    });
    checks.push({ id: "hash-collision-detection", status: collision.run.hashCollisionCount >= 1 && collision.run.quarantinedCount >= 1 ? "pass" : "fail", run: collision.run });
    const rate = await applySyncBatch({
      providerId: planned.manifest.providerId,
      syncBatchId: "conformance-rate",
      items: Array.from({ length: Number(planned.manifest.sync.rateLimit.maxItemsPerSync) + 1 }, (_, index) => ({
        externalId: `rate-${index}`,
        text: `rate item ${index}`
      }))
    });
    checks.push({ id: "rate-limit", status: rate.ok === false && rate.run.status === "rate_limited" ? "pass" : "fail", run: rate.run });
    const localPolicy = await enforceLocalQueryPolicy({
      providerId: planned.manifest.providerId,
      requestedRemoteCallsAllowed: true
    });
    checks.push({ id: "local-query-no-remote", status: localPolicy.ok === false && localPolicy.remoteCallsAllowed === false ? "pass" : "fail", policy: localPolicy });
    const cleanup = await cleanupMirror({
      providerId: planned.manifest.providerId,
      retainExternalIds: ["doc-1"],
      dryRun: true
    });
    checks.push({ id: "mirror-cleanup", status: cleanup.removedCount >= 1 && cleanup.dryRun === true ? "pass" : "fail", cleanup });
    const uninstalled = await uninstall({
      providerId: planned.manifest.providerId,
      removeMirror: planned.manifest.uninstall.removeMirrorDefault,
      actor: "conformance"
    });
    checks.push({ id: "uninstall-policy", status: uninstalled.connector.status === "uninstalled" ? "pass" : "fail", uninstalled });
    return {
      ok: checks.every((check) => check.status === "pass"),
      status: checks.every((check) => check.status === "pass") ? "pass" : "failed",
      protocolVersion: DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION,
      connector: registered.connector,
      checks
    };
  }

  return {
    describe,
    plan,
    register,
    applySyncBatch,
    cleanupMirror,
    enforceLocalQueryPolicy,
    uninstall,
    runConformance
  };
}
