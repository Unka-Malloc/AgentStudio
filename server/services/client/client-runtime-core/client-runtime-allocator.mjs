import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson } from "../../../platform/interactive/product-api.mjs";

export const CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION = "v0.0.1:agent:client-runtime-allocator-1";

const DEFAULT_PROFILE = {
  profileId: "default",
  label: "Default Client Runtime",
  enabled: true,
  clientUid: "",
  clientKeys: [],
  taskTypes: [],
  priority: 0,
  modelAlias: "",
  contextProfileId: "balanced",
  retrievalProfileId: "balanced",
  retrievalProfileKey: "",
  workspaceStrategy: "client",
  workspaceId: "",
  workspacePrefix: "client-workspace",
  toolGrantId: "",
  metadata: {}
};

const DEFAULT_COOLING_POLICY = {
  enabled: true,
  strategy: "lru-lfu-v1",
  windowMs: 60 * 60 * 1000,
  bucketMs: 5 * 60 * 1000,
  maxBuckets: 288,
  coldAfterMs: 30 * 60 * 1000,
  minWarmCalls: 2,
  minHotCalls: 8,
  maxWarmClients: 24,
  coldContextProfileId: "small-context",
  coldWorkspaceStrategy: "client",
  heatScale: 100
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const result = [];
  const source = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(",")
      : [values];
  for (const value of source) {
    const item = normalizeText(value);
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function hashText(value, length = 12) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

function slug(value = "client") {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "client";
}

function firstText(...values) {
  for (const value of values) {
    const item = normalizeText(value);
    if (item) {
      return item;
    }
  }
  return "";
}

function normalizeProfile(profile = {}, fallback = DEFAULT_PROFILE) {
  const raw = asObject(profile);
  const profileId = normalizeText(raw.profileId || raw.id || fallback.profileId);
  return {
    ...fallback,
    ...raw,
    profileId,
    label: normalizeText(raw.label || raw.name || profileId || fallback.label),
    enabled: raw.enabled !== false,
    clientUid: normalizeText(raw.clientUid || ""),
    clientKeys: uniqueStrings([
      ...asArray(raw.clientKeys),
      raw.clientKey,
      raw.clientUid
    ]),
    taskTypes: uniqueStrings(raw.taskTypes || raw.tasks || raw.operationIds || []),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : Number(fallback.priority || 0),
    modelAlias: normalizeText(raw.modelAlias || raw.alias || raw.model || ""),
    contextProfileId: normalizeText(raw.contextProfileId || raw.contextProfile || fallback.contextProfileId || ""),
    retrievalProfileId: normalizeText(raw.retrievalProfileId || raw.retrievalProfile || fallback.retrievalProfileId || ""),
    retrievalProfileKey: normalizeText(raw.retrievalProfileKey || raw.profileKey || ""),
    workspaceStrategy: normalizeText(raw.workspaceStrategy || raw.workspaceMode || fallback.workspaceStrategy || "client"),
    workspaceId: normalizeText(raw.workspaceId || ""),
    workspacePrefix: normalizeText(raw.workspacePrefix || fallback.workspacePrefix || "client-workspace"),
    coolingEnabled: raw.coolingEnabled !== false,
    toolGrantId: normalizeText(raw.toolGrantId || raw.grantId || ""),
    metadata: asObject(raw.metadata)
  };
}

function normalizeCoolingPolicy(input = {}) {
  const raw = asObject(input);
  return {
    ...DEFAULT_COOLING_POLICY,
    ...raw,
    enabled: raw.enabled !== false,
    strategy: normalizeText(raw.strategy || DEFAULT_COOLING_POLICY.strategy),
    windowMs: clampNumber(raw.windowMs, DEFAULT_COOLING_POLICY.windowMs, 60_000, 7 * 24 * 60 * 60 * 1000),
    bucketMs: clampNumber(raw.bucketMs, DEFAULT_COOLING_POLICY.bucketMs, 10_000, 60 * 60 * 1000),
    maxBuckets: clampNumber(raw.maxBuckets, DEFAULT_COOLING_POLICY.maxBuckets, 12, 2016),
    coldAfterMs: clampNumber(raw.coldAfterMs, DEFAULT_COOLING_POLICY.coldAfterMs, 60_000, 30 * 24 * 60 * 60 * 1000),
    minWarmCalls: clampNumber(raw.minWarmCalls, DEFAULT_COOLING_POLICY.minWarmCalls, 0, 1_000_000),
    minHotCalls: clampNumber(raw.minHotCalls, DEFAULT_COOLING_POLICY.minHotCalls, 1, 1_000_000),
    maxWarmClients: clampNumber(raw.maxWarmClients, DEFAULT_COOLING_POLICY.maxWarmClients, 0, 100_000),
    coldContextProfileId: normalizeText(raw.coldContextProfileId || DEFAULT_COOLING_POLICY.coldContextProfileId),
    coldWorkspaceStrategy: normalizeText(raw.coldWorkspaceStrategy || DEFAULT_COOLING_POLICY.coldWorkspaceStrategy || "client"),
    heatScale: clampNumber(raw.heatScale, DEFAULT_COOLING_POLICY.heatScale, 1, 1000)
  };
}

export function normalizeClientRuntimeConfig(input = {}) {
  const raw = asObject(input);
  const defaultProfile = normalizeProfile(raw.defaultProfile || raw.default || {}, DEFAULT_PROFILE);
  const coolingPolicy = normalizeCoolingPolicy(raw.coolingPolicy || raw.cooling || {});
  const profiles = asArray(raw.profiles || raw.clients)
    .map((profile) => normalizeProfile(profile, defaultProfile))
    .filter((profile) => profile.profileId);
  profiles.sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
  return {
    protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
    version: Math.max(1, Number(raw.version || 1)),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    coolingPolicy,
    defaultProfile,
    profiles
  };
}

function requestIdentity(input = {}) {
  const runtimeClient = asObject(input.runtimeClient || input.clientRuntime || input.client);
  const clientUid = firstText(
    input.clientUid,
    runtimeClient.clientUid,
    runtimeClient.uid
  );
  const clientKey = firstText(clientUid, input.clientKey, runtimeClient.clientKey, "anonymous");
  return {
    clientUid,
    clientKey
  };
}

function requestTask(input = {}) {
  return firstText(
    input.taskType,
    input.operationId,
    input.runType,
    input.moduleId,
    input.featureId,
    input.functionId,
    input.runtimeTask
  );
}

function profileMatches(profile = {}, identity = {}, taskType = "") {
  if (profile.enabled === false) {
    return false;
  }
  const profileKeys = new Set([
    profile.clientUid,
    ...asArray(profile.clientKeys)
  ].map(normalizeText).filter(Boolean));
  const requestKeys = new Set([
    identity.clientUid,
    identity.clientKey
  ].map(normalizeText).filter(Boolean));
  const hasClientConstraint = profileKeys.size > 0;
  const clientMatched = !hasClientConstraint || [...requestKeys].some((key) => profileKeys.has(key));
  const taskTypes = new Set(asArray(profile.taskTypes).map(normalizeText).filter(Boolean));
  const taskMatched = !taskTypes.size || taskTypes.has(taskType);
  return clientMatched && taskMatched;
}

function stableWorkspaceId({ strategy, workspaceId, workspacePrefix, clientKey, taskType }) {
  if (workspaceId) {
    return workspaceId;
  }
  const prefix = slug(workspacePrefix || "client-workspace");
  const key = slug(clientKey || "anonymous");
  if (strategy === "provided") {
    return "";
  }
  if (strategy === "shared") {
    return `${prefix}-shared`;
  }
  if (strategy === "client-task") {
    const task = slug(taskType || "task");
    return `${prefix}-${key}-${task}-${hashText(`${clientKey}\u001f${taskType}`)}`;
  }
  return `${prefix}-${key}-${hashText(clientKey || "anonymous")}`;
}

function explicitInput(input = {}) {
  return {
    modelAlias: firstText(input.modelAlias, input.alias, input.model),
    contextProfileId: firstText(input.contextProfileId, input.contextProfile),
    retrievalProfileId: firstText(input.retrievalProfileId, input.retrievalProfile),
    retrievalProfileKey: firstText(input.retrievalProfileKey, input.profileKey),
    workspaceId: firstText(input.workspaceId),
    toolGrantId: firstText(input.toolGrantId, input.grantId)
  };
}

function publicProfile(profile = {}) {
  return {
    profileId: profile.profileId,
    label: profile.label,
    enabled: profile.enabled !== false,
    clientUid: profile.clientUid,
    clientKeys: profile.clientKeys,
    taskTypes: profile.taskTypes,
    priority: Number(profile.priority || 0),
    modelAlias: profile.modelAlias,
    contextProfileId: profile.contextProfileId,
    retrievalProfileId: profile.retrievalProfileId,
    retrievalProfileKey: profile.retrievalProfileKey,
    workspaceStrategy: profile.workspaceStrategy,
    workspaceId: profile.workspaceId,
    workspacePrefix: profile.workspacePrefix,
    coolingEnabled: profile.coolingEnabled !== false,
    toolGrantId: profile.toolGrantId,
    metadata: profile.metadata || {}
  };
}

function publicAllocation(allocation = {}) {
  return {
    protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
    clientUid: allocation.clientUid || "",
    clientKey: allocation.clientKey || "",
    taskType: allocation.taskType || "",
    profileId: allocation.profileId || "",
    matched: allocation.matched === true,
    modelAlias: allocation.modelAlias || "",
    contextProfileId: allocation.contextProfileId || "",
    retrievalProfileId: allocation.retrievalProfileId || "",
    retrievalProfileKey: allocation.retrievalProfileKey || "",
    workspaceStrategy: allocation.workspaceStrategy || "",
    workspaceId: allocation.workspaceId || "",
    toolGrantId: allocation.toolGrantId || "",
    cooling: allocation.cooling || {
      state: "warm",
      heatLevel: "warm",
      reason: "",
      contextCooled: false,
      workspaceCooled: false
    },
    overrides: allocation.overrides || {},
    applied: allocation.applied || {}
  };
}

function emptyUsageStats() {
  return {
    protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt: new Date().toISOString(),
    totalCalls: 0,
    clients: {},
    workspaces: {},
    contexts: {}
  };
}

function bucketStart(timestamp, bucketMs) {
  return Math.floor(Number(timestamp || Date.now()) / bucketMs) * bucketMs;
}

function compactBuckets(buckets = [], policy = DEFAULT_COOLING_POLICY, now = Date.now()) {
  const bucketMs = policy.bucketMs || DEFAULT_COOLING_POLICY.bucketMs;
  const maxBuckets = policy.maxBuckets || DEFAULT_COOLING_POLICY.maxBuckets;
  const minStart = bucketStart(now, bucketMs) - bucketMs * Math.max(maxBuckets - 1, 1);
  const byStart = new Map();
  for (const bucket of asArray(buckets)) {
    const start = Number(bucket.start || 0);
    const count = Number(bucket.count || 0);
    if (!Number.isFinite(start) || start < minStart || count <= 0) {
      continue;
    }
    byStart.set(start, (byStart.get(start) || 0) + count);
  }
  return [...byStart.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(-maxBuckets)
    .map(([start, count]) => ({ start, count }));
}

function recentBucketCount(buckets = [], policy = DEFAULT_COOLING_POLICY, now = Date.now()) {
  const minStart = now - policy.windowMs;
  return compactBuckets(buckets, policy, now)
    .filter((bucket) => Number(bucket.start || 0) >= minStart)
    .reduce((total, bucket) => total + Number(bucket.count || 0), 0);
}

function updateBuckets(buckets = [], policy = DEFAULT_COOLING_POLICY, now = Date.now()) {
  const start = bucketStart(now, policy.bucketMs);
  const next = compactBuckets(buckets, policy, now);
  const existing = next.find((bucket) => bucket.start === start);
  if (existing) {
    existing.count += 1;
  } else {
    next.push({ start, count: 1 });
  }
  return compactBuckets(next, policy, now);
}

function heatScoreForRecord(record = {}, policy = DEFAULT_COOLING_POLICY, now = Date.now()) {
  const recentCalls = recentBucketCount(record.buckets || [], policy, now);
  const totalCalls = Number(record.totalCalls || 0);
  const ageMs = record.lastSeenAt ? Math.max(0, now - Date.parse(record.lastSeenAt)) : Number.POSITIVE_INFINITY;
  const recencyBoost = Number.isFinite(ageMs)
    ? Math.max(0, policy.windowMs - Math.min(ageMs, policy.windowMs)) / Math.max(policy.windowMs, 1)
    : 0;
  const heatScore = recentCalls * 10 + Math.log10(totalCalls + 1) * 3 + recencyBoost * 5;
  return {
    recentCalls,
    totalCalls,
    ageMs,
    heatScore
  };
}

function classifyHeat({ record = null, policy = DEFAULT_COOLING_POLICY, rank = -1, maxHeatScore = 1, now = Date.now() } = {}) {
  if (!record) {
    return {
      state: "warm",
      heatLevel: "warm",
      reason: "new-client",
      recentCalls: 0,
      totalCalls: 0,
      ageMs: 0,
      heatScore: 0,
      heatPercent: 0
    };
  }
  const metrics = heatScoreForRecord(record, policy, now);
  const staleAndLowUse =
    metrics.ageMs >= policy.coldAfterMs &&
    metrics.recentCalls <= policy.minWarmCalls;
  const rankCooled = policy.maxWarmClients > 0 && rank >= policy.maxWarmClients;
  const cooled = policy.enabled && (staleAndLowUse || rankCooled);
  const hot = !cooled && metrics.recentCalls >= policy.minHotCalls;
  const heatPercentDenominator = Number(policy.heatScale || 0) > 0
    ? Number(policy.heatScale)
    : Math.max(maxHeatScore, 1);
  return {
    state: cooled ? "cooled" : hot ? "hot" : "warm",
    heatLevel: cooled ? "cold" : hot ? "hot" : "warm",
    reason: cooled
      ? rankCooled
        ? "outside-warm-client-limit"
        : "least-recently-used-and-low-frequency"
      : hot
        ? "frequent-client"
        : "normal",
    ...metrics,
    heatPercent: Math.max(
      0,
      Math.min(100, Math.round((metrics.heatScore / heatPercentDenominator) * 100))
    )
  };
}

function buildHeatRows(stats = emptyUsageStats(), policy = DEFAULT_COOLING_POLICY, now = Date.now()) {
  const records = Object.values(asObject(stats.clients));
  const scored = records
    .map((record) => ({
      record,
      metrics: heatScoreForRecord(record, policy, now)
    }))
    .sort((left, right) => {
      if (right.metrics.heatScore !== left.metrics.heatScore) {
        return right.metrics.heatScore - left.metrics.heatScore;
      }
      return String(right.record.lastSeenAt || "").localeCompare(String(left.record.lastSeenAt || ""));
    });
  const maxHeatScore = scored[0]?.metrics.heatScore || 1;
  return scored.map((entry, index) => {
    const heat = classifyHeat({
      record: entry.record,
      policy,
      rank: index,
      maxHeatScore,
      now
    });
    return {
      clientUid: entry.record.clientUid || "",
      clientKey: entry.record.clientKey || entry.record.clientUid || "",
      profileId: entry.record.profileId || "",
      matched: entry.record.matched === true,
      workspaceId: entry.record.workspaceId || "",
      contextProfileId: entry.record.contextProfileId || "",
      retrievalProfileId: entry.record.retrievalProfileId || "",
      modelAlias: entry.record.modelAlias || "",
      taskTypes: Object.entries(asObject(entry.record.callsByTask))
        .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
        .slice(0, 6)
        .map(([taskType, count]) => ({ taskType, count })),
      surfaces: Object.entries(asObject(entry.record.callsBySurface))
        .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
        .slice(0, 6)
        .map(([surface, count]) => ({ surface, count })),
      firstSeenAt: entry.record.firstSeenAt || "",
      lastSeenAt: entry.record.lastSeenAt || "",
      coolingState: heat.state,
      heatLevel: heat.heatLevel,
      coolingReason: heat.reason,
      totalCalls: heat.totalCalls,
      recentCalls: heat.recentCalls,
      heatScore: Number(heat.heatScore.toFixed(4)),
      heatPercent: heat.heatPercent,
      ageMs: Number.isFinite(heat.ageMs) ? heat.ageMs : 0
    };
  });
}

export function createClientRuntimeAllocator({ userDataPath }) {
  const rootPath = path.join(userDataPath, "client-runtime");
  const configPath = path.join(rootPath, "client-runtime-allocator.json");
  const usagePath = path.join(rootPath, "client-runtime-usage.json");
  let usageWriteQueue = Promise.resolve();

  async function readConfig() {
    try {
      return normalizeClientRuntimeConfig(JSON.parse(await fs.readFile(configPath, "utf8")));
    } catch {
      return normalizeClientRuntimeConfig({});
    }
  }

  async function readUsageStats() {
    try {
      return {
        ...emptyUsageStats(),
        ...asObject(JSON.parse(await fs.readFile(usagePath, "utf8")))
      };
    } catch {
      return emptyUsageStats();
    }
  }

  async function writeUsageStats(stats = {}) {
    await fs.mkdir(rootPath, { recursive: true });
    const next = {
      ...emptyUsageStats(),
      ...asObject(stats),
      updatedAt: new Date().toISOString()
    };
    await atomicWriteJson(usagePath, next);
    return next;
  }

  function enqueueUsageWrite(task) {
    usageWriteQueue = usageWriteQueue
      .catch(() => null)
      .then(task);
    return usageWriteQueue;
  }

  async function writeConfig(input = {}) {
    await fs.mkdir(rootPath, { recursive: true });
    const config = normalizeClientRuntimeConfig(input);
    await atomicWriteJson(configPath, config);
    return config;
  }

  async function listProfiles() {
    const config = await readConfig();
    return {
      protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
      configPath,
      usagePath,
      version: config.version,
      updatedAt: config.updatedAt,
      coolingPolicy: config.coolingPolicy,
      defaultProfile: publicProfile(config.defaultProfile),
      profiles: config.profiles.map(publicProfile)
    };
  }

  async function saveProfiles(input = {}) {
    const config = await writeConfig(input);
    return {
      protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
      configPath,
      usagePath,
      version: config.version,
      updatedAt: config.updatedAt,
      coolingPolicy: config.coolingPolicy,
      defaultProfile: publicProfile(config.defaultProfile),
      profiles: config.profiles.map(publicProfile)
    };
  }

  async function resolve(input = {}) {
    const config = await readConfig();
    const usageStats = await readUsageStats();
    const heatRows = buildHeatRows(usageStats, config.coolingPolicy);
    const identity = requestIdentity(input);
    const taskType = requestTask(input);
    const match = config.profiles.find((profile) => profileMatches(profile, identity, taskType));
    const profile = match || config.defaultProfile;
    const explicit = explicitInput(input);
    const existingHeatIndex = heatRows.findIndex((row) => row.clientUid === identity.clientUid);
    const existingRecord = identity.clientUid ? asObject(usageStats.clients)[identity.clientUid] || null : null;
    const heat = classifyHeat({
      record: existingRecord,
      policy: config.coolingPolicy,
      rank: existingHeatIndex,
      maxHeatScore: Math.max(1, ...heatRows.map((row) => Number(row.heatScore || 0)))
    });
    const coolingEnabled = profile.coolingEnabled !== false && heat.state === "cooled";
    const contextProfileId =
      explicit.contextProfileId ||
      (coolingEnabled && config.coolingPolicy.coldContextProfileId
        ? config.coolingPolicy.coldContextProfileId
        : profile.contextProfileId || config.defaultProfile.contextProfileId || "");
    const workspaceStrategy = explicit.workspaceId
      ? "provided"
      : coolingEnabled && config.coolingPolicy.coldWorkspaceStrategy
        ? config.coolingPolicy.coldWorkspaceStrategy
        : normalizeText(profile.workspaceStrategy || config.defaultProfile.workspaceStrategy || "client");
    const allocation = {
      protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
      clientUid: identity.clientUid,
      clientKey: identity.clientKey,
      taskType,
      profileId: profile.profileId || "default",
      matched: Boolean(match),
      modelAlias: explicit.modelAlias || profile.modelAlias || "",
      contextProfileId,
      retrievalProfileId: explicit.retrievalProfileId || profile.retrievalProfileId || config.defaultProfile.retrievalProfileId || "",
      retrievalProfileKey: explicit.retrievalProfileKey || profile.retrievalProfileKey || "",
      workspaceStrategy,
      workspaceId: explicit.workspaceId || stableWorkspaceId({
        strategy: workspaceStrategy,
        workspaceId: profile.workspaceId || "",
        workspacePrefix: profile.workspacePrefix || config.defaultProfile.workspacePrefix,
        clientKey: identity.clientKey,
        taskType
      }),
      toolGrantId: explicit.toolGrantId || profile.toolGrantId || "",
      cooling: {
        state: heat.state,
        heatLevel: heat.heatLevel,
        reason: heat.reason,
        strategy: config.coolingPolicy.strategy,
        recentCalls: heat.recentCalls,
        totalCalls: heat.totalCalls,
        heatScore: Number(heat.heatScore.toFixed(4)),
        heatPercent: heat.heatPercent,
        contextCooled: coolingEnabled && !explicit.contextProfileId && Boolean(config.coolingPolicy.coldContextProfileId),
        workspaceCooled: coolingEnabled && !explicit.workspaceId && Boolean(config.coolingPolicy.coldWorkspaceStrategy)
      },
      overrides: {
        modelAlias: Boolean(explicit.modelAlias),
        contextProfileId: Boolean(explicit.contextProfileId),
        retrievalProfileId: Boolean(explicit.retrievalProfileId),
        retrievalProfileKey: Boolean(explicit.retrievalProfileKey),
        workspaceId: Boolean(explicit.workspaceId),
        toolGrantId: Boolean(explicit.toolGrantId)
      },
      applied: {}
    };
    return publicAllocation(allocation);
  }

  async function apply(input = {}, { taskType = "", surface = "" } = {}) {
    const request = {
      ...asObject(input),
      taskType: taskType || input.taskType || input.operationId || input.runType || surface
    };
    const allocation = await resolve(request);
    const next = { ...request };
    const applied = {};
    const hasClientUid = Boolean(firstText(request.clientUid, asObject(request.runtimeClient).clientUid, asObject(request.clientRuntime).clientUid, asObject(request.client).clientUid));
    const shouldInjectDefaults = allocation.matched === true || hasClientUid;
    if (allocation.clientUid && !firstText(next.clientUid)) {
      next.clientUid = allocation.clientUid;
      applied.clientUid = true;
    }
    if (shouldInjectDefaults && allocation.modelAlias && !firstText(next.modelAlias, next.alias, next.model)) {
      next.modelAlias = allocation.modelAlias;
      next.alias = allocation.modelAlias;
      applied.modelAlias = true;
    }
    if (shouldInjectDefaults && allocation.contextProfileId && !firstText(next.contextProfileId, next.contextProfile)) {
      next.contextProfileId = allocation.contextProfileId;
      applied.contextProfileId = true;
    }
    if (shouldInjectDefaults && allocation.retrievalProfileId && !firstText(next.retrievalProfileId, next.retrievalProfile)) {
      next.retrievalProfileId = allocation.retrievalProfileId;
      applied.retrievalProfileId = true;
    }
    if (shouldInjectDefaults && allocation.retrievalProfileKey && !firstText(next.retrievalProfileKey, next.profileKey)) {
      next.retrievalProfileKey = allocation.retrievalProfileKey;
      next.profileKey = allocation.retrievalProfileKey;
      applied.retrievalProfileKey = true;
    }
    if (shouldInjectDefaults && allocation.workspaceId && !firstText(next.workspaceId)) {
      next.workspaceId = allocation.workspaceId;
      applied.workspaceId = true;
    }
    if (shouldInjectDefaults && allocation.workspaceId && !firstText(next.sessionId, next.conversationId, next.threadId)) {
      next.sessionId = allocation.workspaceId;
      applied.sessionId = true;
    }
    if (shouldInjectDefaults && allocation.toolGrantId && !firstText(next.toolGrantId, next.grantId)) {
      next.toolGrantId = allocation.toolGrantId;
      applied.toolGrantId = true;
    }
    next.clientRuntimeAllocation = {
      ...allocation,
      surface,
      applied
    };
    await recordUsage({
      input: next,
      allocation: {
        ...allocation,
        applied
      },
      surface
    });
    return {
      protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
      input: next,
      allocation: {
        ...allocation,
        applied
      }
    };
  }

  async function recordUsage({ input = {}, allocation = {}, surface = "" } = {}) {
    const clientUid = normalizeText(allocation.clientUid || input.clientUid || "");
    if (!clientUid) {
      return null;
    }
    return enqueueUsageWrite(async () => {
      const config = await readConfig();
      const policy = config.coolingPolicy;
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const stats = await readUsageStats();
      const clients = asObject(stats.clients);
      const workspaces = asObject(stats.workspaces);
      const contexts = asObject(stats.contexts);
      const client = {
        clientUid,
        clientKey: allocation.clientKey || clientUid,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        totalCalls: 0,
        callsByTask: {},
        callsBySurface: {},
        buckets: [],
        ...asObject(clients[clientUid])
      };
      const task = normalizeText(allocation.taskType || input.taskType || "unknown");
      const surfaceKey = normalizeText(surface || allocation.surface || "unknown");
      client.lastSeenAt = timestamp;
      client.totalCalls = Number(client.totalCalls || 0) + 1;
      client.profileId = allocation.profileId || client.profileId || "";
      client.matched = allocation.matched === true;
      client.workspaceId = input.workspaceId || allocation.workspaceId || client.workspaceId || "";
      client.contextProfileId = input.contextProfileId || allocation.contextProfileId || client.contextProfileId || "";
      client.retrievalProfileId = input.retrievalProfileId || allocation.retrievalProfileId || client.retrievalProfileId || "";
      client.modelAlias = input.modelAlias || allocation.modelAlias || client.modelAlias || "";
      client.coolingState = allocation.cooling?.state || client.coolingState || "warm";
      client.callsByTask = {
        ...asObject(client.callsByTask),
        [task]: Number(asObject(client.callsByTask)[task] || 0) + 1
      };
      client.callsBySurface = {
        ...asObject(client.callsBySurface),
        [surfaceKey]: Number(asObject(client.callsBySurface)[surfaceKey] || 0) + 1
      };
      client.buckets = updateBuckets(client.buckets, policy, now);
      clients[clientUid] = client;

      const workspaceId = client.workspaceId || "";
      if (workspaceId) {
        const workspace = {
          workspaceId,
          clientUid,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          totalCalls: 0,
          contextProfileId: client.contextProfileId,
          coolingState: allocation.cooling?.state || "warm",
          buckets: [],
          ...asObject(workspaces[workspaceId])
        };
        workspace.clientUid = clientUid;
        workspace.lastSeenAt = timestamp;
        workspace.totalCalls = Number(workspace.totalCalls || 0) + 1;
        workspace.contextProfileId = client.contextProfileId;
        workspace.coolingState = allocation.cooling?.state || workspace.coolingState || "warm";
        workspace.buckets = updateBuckets(workspace.buckets, policy, now);
        workspaces[workspaceId] = workspace;
      }

      const contextProfileId = client.contextProfileId || "";
      if (contextProfileId) {
        const context = {
          contextProfileId,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          totalCalls: 0,
          clients: {},
          coolingState: allocation.cooling?.state || "warm",
          buckets: [],
          ...asObject(contexts[contextProfileId])
        };
        context.lastSeenAt = timestamp;
        context.totalCalls = Number(context.totalCalls || 0) + 1;
        context.clients = {
          ...asObject(context.clients),
          [clientUid]: Number(asObject(context.clients)[clientUid] || 0) + 1
        };
        context.coolingState = allocation.cooling?.state || context.coolingState || "warm";
        context.buckets = updateBuckets(context.buckets, policy, now);
        contexts[contextProfileId] = context;
      }

      return writeUsageStats({
        ...stats,
        totalCalls: Number(stats.totalCalls || 0) + 1,
        clients,
        workspaces,
        contexts
      });
    });
  }

  async function getStatus() {
    const [config, stats] = await Promise.all([readConfig(), readUsageStats()]);
    const now = Date.now();
    const heatRows = buildHeatRows(stats, config.coolingPolicy, now);
    const workspaceRows = Object.values(asObject(stats.workspaces))
      .map((record) => ({
        workspaceId: record.workspaceId || "",
        clientUid: record.clientUid || "",
        contextProfileId: record.contextProfileId || "",
        coolingState: record.coolingState || "warm",
        totalCalls: Number(record.totalCalls || 0),
        recentCalls: recentBucketCount(record.buckets || [], config.coolingPolicy, now),
        firstSeenAt: record.firstSeenAt || "",
        lastSeenAt: record.lastSeenAt || ""
      }))
      .sort((left, right) => right.recentCalls - left.recentCalls || right.totalCalls - left.totalCalls)
      .slice(0, 100);
    const contextRows = Object.values(asObject(stats.contexts))
      .map((record) => ({
        contextProfileId: record.contextProfileId || "",
        coolingState: record.coolingState || "warm",
        totalCalls: Number(record.totalCalls || 0),
        recentCalls: recentBucketCount(record.buckets || [], config.coolingPolicy, now),
        clientCount: Object.keys(asObject(record.clients)).length,
        firstSeenAt: record.firstSeenAt || "",
        lastSeenAt: record.lastSeenAt || ""
      }))
      .sort((left, right) => right.recentCalls - left.recentCalls || right.totalCalls - left.totalCalls)
      .slice(0, 100);
    return {
      protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
      schemaVersion: "v0.0.1:schema:definition-1",
      updatedAt: new Date().toISOString(),
      configPath,
      usagePath,
      coolingPolicy: config.coolingPolicy,
      summary: {
        totalClients: heatRows.length,
        hotClients: heatRows.filter((row) => row.coolingState === "hot").length,
        warmClients: heatRows.filter((row) => row.coolingState === "warm").length,
        cooledClients: heatRows.filter((row) => row.coolingState === "cooled").length,
        totalCalls: Number(stats.totalCalls || 0),
        workspaceCount: workspaceRows.length,
        contextCount: contextRows.length
      },
      heatmap: {
        clients: heatRows,
        workspaces: workspaceRows,
        contexts: contextRows
      },
      cooledClients: heatRows.filter((row) => row.coolingState === "cooled")
    };
  }

  return {
    protocolVersion: CLIENT_RUNTIME_ALLOCATOR_PROTOCOL_VERSION,
    rootPath,
    configPath,
    listProfiles,
    saveProfiles,
    getStatus,
    resolve,
    apply
  };
}

export default createClientRuntimeAllocator;
