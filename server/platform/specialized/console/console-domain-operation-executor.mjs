import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceGovernanceRegistry } from "../agent/workspace-governance/index.mjs";
import { createContributionRegistry } from "../agent/workspace-contribution/index.mjs";
import { createCodespaceRegistry } from "../capabilities/code-management/codespace/index.mjs";
import { createCapabilityPackageRegistry } from "../capabilities/package-lifecycle/index.mjs";
import { createCloudDrivePort } from "../agent/cloud-drive-port/index.mjs";
import { createAssetLineageRegistry } from "../knowledge/assets/asset-lineage/index.mjs";
import { evaluateKnowledgeAccess } from "../knowledge/agent-library/access-policy.mjs";
import {
  createKnowledgeBackendPort,
  isKnowledgeBackendEvidenceId
} from "../knowledge/storage/knowledge-backend-port/index.mjs";
import {
  GERRIT_ACTIONS,
  executeGerritCommonOperation,
  uploadGerritGitChange
} from "../capabilities/code-review/gerrit/index.mjs";
import { executeRepoOperation } from "../capabilities/code-repository/repo-operations/index.mjs";
import { createDataConnectorGovernance } from "../knowledge/connectors/data-connector-governance/index.mjs";
import {
  listCapacityBenchmarkTargets,
  runPerformanceCapacityBenchmark
} from "../knowledge/performance/capacity-benchmark/index.mjs";
import {
  downloadRuntimeDependency,
  listRuntimeDependencies
} from "../capabilities/runtime-dependencies/index.mjs";
import {
  getSourceFileEvidence,
  isSourceEvidenceId,
  searchSourceFiles
} from "../knowledge/retrieval/source-file-search-service.mjs";
import { createKnowledgeTransformationProvider } from "../knowledge/transformation/knowledge-transformation-provider.mjs";
import {
  createExternalKnowledgeDistillationClient,
  resolveExternalKnowledgeDistillationConfig
} from "../knowledge/invocation/external-distillation-service/index.mjs";
import { executeKnowledgeWordCloudOperation } from "./knowledge-word-cloud-operation-executor.mjs";
import { getCodexOAuthStatus, startCodexDeviceLogin } from "../../common/security/auth/codex-oauth-service.mjs";
import { buildProductionHealthReport } from "../../common/production-readiness/report-reader.mjs";
import {
  buildExecutiveReport,
  createExecutiveReportStore
} from "../../common/production-readiness/executive-report.mjs";
import { buildArchitectureLiveMap } from "../../common/production-readiness/architecture-live-map.mjs";
import { createSampleBusinessPackStore } from "../../common/production-readiness/sample-business-pack.mjs";
import {
  buildClientConnectionList,
  buildConsoleState,
  buildRuntimeInfo
} from "../../common/console/http/api-facade.mjs";
import { createV001BaselineProvider } from "../../common/v001/baseline-provider.mjs";
import { hashClientString, serverToken } from "../../common/security/client-strings.mjs";
import {
  loadSettings,
  normalizeSettings,
  saveSettings
} from "../../common/platform-core/settings.mjs";
import {
  buildBootstrapPayload,
  getDiscoveryConfigPath,
  saveDiscoveryConfig
} from "../../common/platform-core/discovery/config.mjs";
import { AUTHORIZATION_PROTOCOL_VERSION } from "../../common/security/authorization/authorization-engine.mjs";
import { SECURITY_PERMISSIONS_PROTOCOL_VERSION } from "../../common/security/security-permissions-provider.mjs";

const contributionRegistries = new Map();
const codespaceRegistries = new Map();
const cloudDrivePorts = new Map();
const knowledgeBackendPorts = new Map();
const knowledgeDistillationWorkbenchInstances = new Map();
const PATH_BROWSER_MAX_ENTRIES = 600;
const EXTERNAL_KNOWLEDGE_DISTILLATION_SERVICE_ID = "external.knowledge.distillation";
const EXTERNAL_KNOWLEDGE_DISTILLATION_OPERATION_PREFIX = "external.knowledge.distillation.";
const PATH_BROWSER_IGNORED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__"
]);

function result(status, payload) {
  return { status, payload };
}

function internalKnowledgeDistillationRemovedPayload(operationId = "") {
  return {
    ok: false,
    status: 410,
    error: "内部知识蒸馏实现已废弃并停止维护，请改用独立部署的 external.knowledge.distillation 服务。",
    code: "INTERNAL_KNOWLEDGE_DISTILLATION_REMOVED",
    deprecated: true,
    removedFromMaintenance: true,
    operationId,
    replacementService: EXTERNAL_KNOWLEDGE_DISTILLATION_SERVICE_ID,
    replacementOperationPrefix: EXTERNAL_KNOWLEDGE_DISTILLATION_OPERATION_PREFIX,
    migration: {
      health: "external.knowledge.distillation.service.health",
      capabilities: "external.knowledge.distillation.service.capabilities",
      createRun: "external.knowledge.distillation.runs.create",
      getRun: "external.knowledge.distillation.runs.get",
      listRuns: "external.knowledge.distillation.runs.list",
      evidenceQuery: "external.knowledge.distillation.evidence.query",
      projectEvidenceQuery: "external.knowledge.distillation.projects.evidence.query",
      artifactExport: "external.knowledge.distillation.artifacts.export"
    },
    maintenancePolicy: "external-service-only"
  };
}

function requireStorageProvider(context = {}) {
  if (!context.storageProvider) {
    return { error: result(503, { error: "存储 provider 不可用。" }) };
  }
  return { storageProvider: context.storageProvider };
}

function requireDevopsProvider(context = {}) {
  if (!context.devopsProvider) {
    return { error: result(503, { error: "运维 provider 不可用。" }) };
  }
  return { devopsProvider: context.devopsProvider };
}

function requireStrategyManagementProvider(context = {}) {
  if (!context.strategyManagementProvider) {
    return { error: result(503, { error: "策略管理 provider 不可用。" }) };
  }
  return { strategyManagementProvider: context.strategyManagementProvider };
}

function protocolPayload(payload = {}) {
  return {
    schemaVersion: 1,
    ok: true,
    ...payload
  };
}

function actorFrom(authSession = null, input = {}) {
  return authSession?.user?.username || authSession?.userId || input.actor || "console";
}

function plainObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function firstProtocolInputValue(input = {}, keys = [], fallback = "") {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue;
    }
    const value = input[key];
    if (Array.isArray(value)) {
      const selected = value.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
      if (selected !== undefined) {
        return selected;
      }
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

function inputValueList(input = {}, keys = []) {
  const values = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue;
    }
    const value = input[key];
    if (Array.isArray(value)) {
      values.push(...value);
    } else {
      values.push(value);
    }
  }
  return values;
}

function normalizeDelimitedInputList(input = {}, keys = [], { lowercase = false } = {}) {
  return inputValueList(input, keys)
    .flatMap((value) => String(value || "").split(","))
    .map((value) => {
      const trimmed = value.trim();
      return lowercase ? trimmed.toLowerCase() : trimmed;
    })
    .filter(Boolean);
}

function normalizeAgentSubscriptionInput(input = {}) {
  return {
    ...input,
    cursor: Number(firstProtocolInputValue(input, ["cursor"], 0)),
    topics: normalizeDelimitedInputList(input, ["topic", "topics"]),
    timeoutMs: Number(firstProtocolInputValue(input, ["timeoutMs", "timeout-ms", "timeout"], 0)),
    limit: Number(firstProtocolInputValue(input, ["limit"], 100)),
    includeSnapshot: parseBooleanFlag(
      firstProtocolInputValue(input, ["includeSnapshot", "include-snapshot", "snapshot"], ""),
      false
    )
  };
}

function normalizeSearchQueryInput(input = {}) {
  return {
    ...input,
    query: String(firstProtocolInputValue(input, ["query", "q"], "") || ""),
    batchId: String(firstProtocolInputValue(input, ["batchId", "batch-id"], "") || ""),
    entityTypes: normalizeDelimitedInputList(input, ["entityType", "entityTypes", "entity-type", "entity-types"], {
      lowercase: true
    }),
    formalOnly: parseBooleanFlag(firstProtocolInputValue(input, ["formalOnly", "formal-only"], ""), false),
    limit: Number(firstProtocolInputValue(input, ["limit"], 20))
  };
}

function parseOptionalBooleanFlag(input = {}, keys = [], fallback = undefined) {
  for (const key of keys) {
    if (hasInputKey(input, key)) {
      return parseBooleanFlag(input[key], fallback === undefined ? false : fallback);
    }
  }
  return fallback;
}

function normalizePathBrowserMode(value) {
  return value === "file" ? "file" : "directory";
}

function normalizePathBrowserExtensions(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith(".") ? item : `.${item}`));
}

function createPathBrowserRoots({ userDataPath, distPath } = {}) {
  const roots = new Map();
  const addRoot = (label, value) => {
    const nextPath = String(value || "").trim();
    if (!nextPath) {
      return;
    }
    roots.set(path.resolve(nextPath), label);
  };

  addRoot("当前项目", process.cwd());
  addRoot("Pact 数据目录", userDataPath);
  addRoot("Pact 前端构建", distPath);
  addRoot("当前用户", os.homedir());
  const rootPath = path.parse(process.cwd()).root;
  addRoot(rootPath === "/" ? "根目录" : rootPath, rootPath);

  const cloudStoragePath = path.join(os.homedir(), "Library", "CloudStorage");
  try {
    for (const entry of fsSync.readdirSync(cloudStoragePath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const label = /^OneDrive/i.test(entry.name)
          ? `OneDrive · ${entry.name.replace(/^OneDrive[- ]?/i, "") || "本机"}`
          : `云盘 · ${entry.name}`;
        addRoot(label, path.join(cloudStoragePath, entry.name));
      }
    }
  } catch {
    // CloudStorage is platform/user dependent; absence should not affect path browsing.
  }
  try {
    for (const entry of fsSync.readdirSync(os.homedir(), { withFileTypes: true })) {
      if (entry.isDirectory() && /^OneDrive/i.test(entry.name)) {
        addRoot(`OneDrive · ${entry.name.replace(/^OneDrive[- ]?/i, "") || "本机"}`, path.join(os.homedir(), entry.name));
      }
    }
  } catch {
    // Ignore unreadable home entries.
  }

  if (process.platform === "darwin") {
    try {
      for (const entry of fsSync.readdirSync("/Volumes", { withFileTypes: true })) {
        if (entry.isDirectory()) {
          addRoot(`磁盘 · ${entry.name}`, path.join("/Volumes", entry.name));
        }
      }
    } catch {
      // Mounted volumes are platform/user dependent.
    }
  }

  return [...roots.entries()].map(([rootPathValue, label]) => ({
    label,
    path: rootPathValue
  }));
}

async function resolvePathBrowserDirectory(inputPath) {
  const requestedPath = String(inputPath || "").trim();
  const absolutePath = path.resolve(requestedPath || process.cwd());
  try {
    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) {
      return absolutePath;
    }
    return path.dirname(absolutePath);
  } catch {
    return path.dirname(absolutePath);
  }
}

async function statPathBrowserEntry({ absolutePath, name, mode, extensions }) {
  const stats = await fs.stat(absolutePath);
  const type = stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other";
  const extension = path.extname(name).toLowerCase();
  const fileAllowed = extensions.length === 0 || extensions.includes(extension);
  return {
    name,
    path: absolutePath,
    type,
    byteSize: stats.isFile() ? stats.size : 0,
    modifiedAt: stats.mtime.toISOString(),
    hidden: name.startsWith("."),
    selectable:
      (mode === "directory" && type === "directory") ||
      (mode === "file" && type === "file" && fileAllowed),
    browsable: type === "directory"
  };
}

async function browseServerPath({
  requestedPath,
  mode,
  extensions,
  includeHidden,
  userDataPath,
  distPath
}) {
  const currentPath = await resolvePathBrowserDirectory(requestedPath);
  const roots = createPathBrowserRoots({ userDataPath, distPath });
  const parentPath = path.dirname(currentPath);
  let entries = [];
  let error = "";

  try {
    const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });
    const names = directoryEntries
      .map((entry) => entry.name)
      .filter((name) => includeHidden || !name.startsWith("."))
      .filter((name) => !PATH_BROWSER_IGNORED_NAMES.has(name))
      .sort((left, right) => left.localeCompare(right, "zh-CN"));

    const listed = [];
    for (const name of names) {
      const absolutePath = path.join(currentPath, name);
      try {
        listed.push(await statPathBrowserEntry({ absolutePath, name, mode, extensions }));
      } catch {
        // Ignore unreadable entries; the browser is for choosing paths, not diagnostics.
      }
      if (listed.length >= PATH_BROWSER_MAX_ENTRIES) {
        break;
      }
    }

    entries = listed.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });
  } catch (browseError) {
    error = browseError instanceof Error ? browseError.message : "无法读取目录。";
  }

  return {
    currentPath,
    parentPath: parentPath === currentPath ? "" : parentPath,
    mode,
    extensions,
    roots,
    entries,
    truncated: entries.length >= PATH_BROWSER_MAX_ENTRIES,
    error
  };
}

function hasInputKey(input = {}, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function firstInputValue(input = {}, keys = [], fallback = "") {
  for (const key of keys) {
    if (!hasInputKey(input, key)) {
      continue;
    }
    const value = input[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return fallback;
}

function normalizeKnowledgeSearchInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const filters =
    source.filters && typeof source.filters === "object" && !Array.isArray(source.filters)
      ? { ...source.filters }
      : {};
  delete filters.modality;
  delete filters.modalities;
  delete filters.mediaType;
  delete filters.mediaTypes;

  const limit = Number(firstInputValue(source, ["limit"], 20));
  const normalized = {
    ...source,
    query: firstInputValue(source, ["query", "q"], ""),
    limit: Number.isFinite(limit) ? limit : 20,
    batchId: firstInputValue(source, ["batchId", "batch-id"], ""),
    retrievalProfileId: firstInputValue(source, ["retrievalProfileId", "retrieval-profile-id", "profile-id", "profile"], ""),
    profileKey: firstInputValue(source, ["profileKey", "profile-key", "retrievalProfileKey", "retrieval-profile-key"], ""),
    clientId: firstInputValue(source, ["clientId", "client-id"], ""),
    clientUid: firstInputValue(source, ["clientUid", "client-uid"], ""),
    workspaceId: firstInputValue(source, ["workspaceId", "workspace-id", "workspace_id"], ""),
    requestSurface: firstInputValue(source, ["requestSurface", "request-surface", "surface"], ""),
    responseProfile: firstInputValue(source, ["responseProfile", "response-profile", "outputProfile", "output-profile"], ""),
    modalityPolicy: "multimodal"
  };

  const learningEnabled = parseOptionalBooleanFlag(source, ["learningEnabled", "learning-enabled", "learning"], undefined);
  if (learningEnabled !== undefined) {
    normalized.learningEnabled = learningEnabled;
  }
  const hierarchyReasoning = parseOptionalBooleanFlag(source, ["hierarchyReasoning", "hierarchy-reasoning"], undefined);
  if (hierarchyReasoning !== undefined) {
    normalized.hierarchyReasoning = hierarchyReasoning;
  }
  const modelEnabled = parseOptionalBooleanFlag(source, ["modelEnabled", "model-enabled", "useModel", "use-model"], undefined);
  if (modelEnabled !== undefined) {
    normalized.modelEnabled = modelEnabled;
  }
  const explain = parseOptionalBooleanFlag(source, ["explain"], undefined);
  if (explain !== undefined) {
    normalized.explain = explain;
  }
  const machineReadable = parseOptionalBooleanFlag(
    source,
    ["machineReadable", "machine-readable", "agentMessage", "agent-message"],
    undefined
  );
  if (machineReadable !== undefined) {
    normalized.machineReadable = machineReadable;
    normalized.agentMessage = machineReadable;
  }

  if (Object.keys(filters).length > 0) {
    normalized.filters = filters;
  } else {
    delete normalized.filters;
  }
  delete normalized.modality;
  delete normalized.modalities;
  delete normalized.mediaType;
  delete normalized.mediaTypes;
  return normalized;
}

function normalizeKnowledgeSearchResponseProfile(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["agent", "mcp", "tool", "tool-grant", "machine", "machine-readable"].includes(normalized)) {
    return "agent";
  }
  if (["api", "http", "rpc", "cli", "integration", "service"].includes(normalized)) {
    return "api";
  }
  if (["console", "ui", "human", "control-plane", "management-console"].includes(normalized)) {
    return "console";
  }
  return "";
}

function knowledgeSearchFromToolGrant(context = {}) {
  const user = context.authSession?.user || {};
  return user.roleId === "tool-grant" || user.type === "tool-grant";
}

function resolveKnowledgeSearchResponseProfile(payload = {}, context = {}) {
  const explicit = normalizeKnowledgeSearchResponseProfile(
    payload.responseProfile || payload.requestSurface || payload.surface || payload.outputProfile || ""
  );
  if (explicit) {
    return explicit;
  }
  if (payload.machineReadable === true || payload.agentMessage === true || knowledgeSearchFromToolGrant(context)) {
    return "agent";
  }
  return "api";
}

function subjectFromAuthSession(authSession = null) {
  const user = authSession?.user || {};
  return {
    type: user.userId ? "console-user" : "anonymous",
    subjectId: user.userId || user.username || "",
    username: user.username || "",
    roleId: user.roleId || "",
    scopes: Array.isArray(user.scopes) ? user.scopes : []
  };
}

function workspaceIdFrom(input = {}, fallback = "") {
  return String(input.workspaceId || input.workspace || fallback || "default").trim() || "default";
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function workspaceAccessOptions(authSession = null) {
  const user = authSession?.user || {};
  return {
    actorUserId: String(user.userId || ""),
    canAccessAll: true,
    sharingMode: "team-shared"
  };
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function workspaceFileSnapshotFromCheckpointPlan(plan = {}, input = {}) {
  const target = objectOrNull(plan.target) || {};
  const metadata = objectOrNull(target.metadata) || {};
  const workspaceMetadata = objectOrNull(metadata.workspace) || {};
  const snapshot =
    objectOrNull(input.workspaceFileSnapshot) ||
    objectOrNull(input.fileSnapshot) ||
    objectOrNull(input.snapshot) ||
    objectOrNull(metadata.workspaceFileSnapshot) ||
    objectOrNull(metadata.fileSnapshot) ||
    objectOrNull(workspaceMetadata.fileSnapshot) ||
    null;
  if (!snapshot) {
    return null;
  }
  const files = Array.isArray(snapshot.files)
    ? snapshot.files
    : Array.isArray(snapshot.entries)
      ? snapshot.entries
      : Array.isArray(input.files)
        ? input.files
        : [];
  if (files.length === 0) {
    return null;
  }
  return {
    workspaceId: String(
      input.workspaceId ||
        input.workspace ||
        snapshot.workspaceId ||
        snapshot.workspace ||
        metadata.workspaceId ||
        workspaceMetadata.workspaceId ||
        ""
    ).trim(),
    snapshot: {
      ...snapshot,
      files,
      basePath: snapshot.basePath || snapshot.rootPath || input.basePath || "",
      deleteExtraneous: snapshot.deleteExtraneous === true || input.deleteExtraneous === true
    }
  };
}

async function runCheckpointWorkspaceFileRestore({ plan, input = {}, context = {}, dryRun }) {
  const restoreTarget = workspaceFileSnapshotFromCheckpointPlan(plan, input);
  if (!restoreTarget) {
    return null;
  }
  if (!restoreTarget.workspaceId) {
    return result(400, { error: "checkpoint 文件快照缺少 workspaceId。" });
  }
  const { method, error } = requireAgentWorkspaceMethod(
    context.agentWorkspace,
    "restoreWorkspaceFiles",
    "工作空间文件恢复接口不可用。"
  );
  if (error) {
    return error;
  }
  const operationResult = await method({
    ...input,
    workspaceId: restoreTarget.workspaceId,
    snapshot: restoreTarget.snapshot,
    dryRun,
    operationId: input.operationId || "workspace.checkpoint.restore",
    reason: input.reason || "",
    actor: actorFrom(context.authSession, input),
    ...workspaceAccessOptions(context.authSession)
  });
  return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
}

function applyWorkspaceRuntimeContext(payload = {}, agentWorkspace = null, options = {}) {
  const agentSessionId = String(
    payload.agentSessionId ||
      payload.agent_session_id ||
      payload.sessionThreadId ||
      payload.session_thread_id ||
      payload.workspaceSessionId ||
      payload.workspace_session_id ||
      ""
  ).trim();
  const workspaceId = String(
    payload.workspaceId ||
      payload.workspace_id ||
      payload.sessionWorkspaceId ||
      ""
  ).trim();
  if (agentSessionId && agentWorkspace && typeof agentWorkspace.getSessionContext === "function") {
    const sessionContext = agentWorkspace.getSessionContext(agentSessionId, options);
    if (!sessionContext) {
      return {
        input: payload,
        workspaceContext: null,
        workspaceError: {
          status: 404,
          error: "会话线程不存在或不可访问。"
        }
      };
    }
    const next = {
      ...payload,
      agentSessionId,
      workspaceId: sessionContext.workspaceId,
      workspaceContext: sessionContext,
      agentSessionContext: sessionContext
    };
    if (!next.contextProfileId && sessionContext.contextProfileId) {
      next.contextProfileId = sessionContext.contextProfileId;
    }
    if (!next.modelAlias && !next.alias && !next.model && sessionContext.modelAlias) {
      next.modelAlias = sessionContext.modelAlias;
      next.alias = sessionContext.modelAlias;
    }
    if (!next.toolGrantId && !next.grantId && sessionContext.toolGrantId) {
      next.toolGrantId = sessionContext.toolGrantId;
    }
    const explicitSourceIds = [
      ...arrayOfStrings(next.scopeSourceIds),
      ...arrayOfStrings(next.sourceIds)
    ];
    if (explicitSourceIds.length === 0 && sessionContext.knowledgeSourceIds?.length) {
      next.scopeSourceIds = sessionContext.knowledgeSourceIds;
    }
    return {
      input: next,
      workspaceContext: sessionContext
    };
  }
  if (!workspaceId || !agentWorkspace || typeof agentWorkspace.getWorkspaceContext !== "function") {
    return {
      input: payload,
      workspaceContext: null,
      workspaceError: workspaceId
        ? {
            status: 503,
            error: "工作空间上下文不可用。"
          }
        : null
    };
  }

  const workspaceContext = agentWorkspace.getWorkspaceContext(workspaceId, options);
  if (!workspaceContext) {
    return {
      input: payload,
      workspaceContext: null,
      workspaceError: {
        status: 404,
        error: "工作空间不存在或不可访问。"
      }
    };
  }

  const next = {
    ...payload,
    workspaceId,
    workspaceContext
  };
  if (!next.contextProfileId && workspaceContext.contextProfileId) {
    next.contextProfileId = workspaceContext.contextProfileId;
  }
  if (!next.modelAlias && !next.alias && !next.model && workspaceContext.modelAlias) {
    next.modelAlias = workspaceContext.modelAlias;
    next.alias = workspaceContext.modelAlias;
  }
  if (!next.toolGrantId && !next.grantId && workspaceContext.toolGrantId) {
    next.toolGrantId = workspaceContext.toolGrantId;
  }

  const explicitSourceIds = [
    ...arrayOfStrings(next.scopeSourceIds),
    ...arrayOfStrings(next.sourceIds)
  ];
  if (explicitSourceIds.length === 0 && workspaceContext.knowledgeSourceIds?.length) {
    next.scopeSourceIds = workspaceContext.knowledgeSourceIds;
  }

  return {
    input: next,
    workspaceContext
  };
}

function contributionRegistryFor(input = {}, context = {}) {
  const registryWorkspaceId = workspaceIdFrom(
    {
      workspaceId: input.registryWorkspaceId || input.contributionRegistryWorkspaceId
    },
    context.contributionRegistryWorkspaceId || "default"
  );
  const registryKey = `${context.userDataPath || "runtime"}::${registryWorkspaceId}`;
  if (!contributionRegistries.has(registryKey)) {
    contributionRegistries.set(registryKey, createContributionRegistry({
      workspaceId: registryWorkspaceId,
      userDataPath: context.userDataPath || ""
    }));
  }
  return contributionRegistries.get(registryKey);
}

function codespaceRegistryFor(context = {}) {
  const key = context.userDataPath || "default";
  if (!codespaceRegistries.has(key)) {
    codespaceRegistries.set(key, createCodespaceRegistry({
      userDataPath: context.userDataPath,
      executeGerritCommonOperation,
      uploadGerritGitChange,
      executeRepoOperation
    }));
  }
  return codespaceRegistries.get(key);
}

function knowledgeBackendPortFor(context = {}) {
  const key = context.userDataPath || "default";
  if (!knowledgeBackendPorts.has(key)) {
    knowledgeBackendPorts.set(key, createKnowledgeBackendPort({
      userDataPath: context.userDataPath
    }));
  }
  return knowledgeBackendPorts.get(key);
}

function cloudDrivePortFor(context = {}) {
  const key = context.userDataPath || "default";
  if (!cloudDrivePorts.has(key)) {
    cloudDrivePorts.set(key, createCloudDrivePort({
      userDataPath: context.userDataPath
    }));
  }
  return cloudDrivePorts.get(key);
}

function requireRuntimeMethod(runtime, methodName, message) {
  if (!runtime || typeof runtime[methodName] !== "function") {
    return { error: result(503, { error: message }) };
  }
  return { method: runtime[methodName].bind(runtime) };
}

function requireAgentWorkspaceMethod(agentWorkspace, methodName, message) {
  return requireRuntimeMethod(agentWorkspace, methodName, message);
}

function getKnowledgeCore(runtime) {
  const mount = runtime?.mounts?.knowledgeBase;
  if (!mount || mount.enabled === false) {
    return null;
  }
  return mount;
}

function getKnowledgeDistillationWorkbench(context = {}) {
  if (context.knowledgeDistillationWorkbench) {
    return context.knowledgeDistillationWorkbench;
  }
  if (typeof context.createKnowledgeDistillationWorkbench !== "function") {
    return null;
  }
  const key = context.userDataPath || "default";
  if (!knowledgeDistillationWorkbenchInstances.has(key)) {
    knowledgeDistillationWorkbenchInstances.set(
      key,
      context.createKnowledgeDistillationWorkbench({
        userDataPath: context.userDataPath,
        jobManager: context.jobWorkflowProvider,
        knowledgeDistillationRuntime: context.knowledgeDistillationRuntime,
        queueMonitor: context.queueMonitor
      })
    );
  }
  return knowledgeDistillationWorkbenchInstances.get(key);
}

async function publishProtocolEvent(protocolEventBus, topic, payload, options = {}) {
  if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
    return null;
  }
  return protocolEventBus.publish(topic, payload, options);
}

function defaultAgentSyncPolicy() {
  return {
    async loadAgentSyncConfig() {
      return { topics: [] };
    },
    async saveAgentSyncConfig() {
      return { topics: [] };
    },
    normalizeAgentSyncTopic(value) {
      return String(value || "").trim();
    },
    filterRequestedSubscriptionTopics(_config, requestedTopics = []) {
      const requested = requestedTopics.map((topic) => String(topic || "").trim()).filter(Boolean);
      return {
        denyAll: false,
        requested,
        topics: requested
      };
    },
    filterAgentSyncSubscriptionResult(_config, result = {}) {
      return result;
    },
    async publishAgentSyncEvent() {
      return {
        ok: false,
        status: 404,
        error: "agent_sync feature is not active in this feature edition."
      };
    }
  };
}

async function loadAgentSyncPolicy(context = {}) {
  if (!context.agentSyncFeatureActive) {
    return defaultAgentSyncPolicy();
  }
  return import("../../../protocols/agent-sync/policy.mjs");
}

async function authorizeToolSkillScopes({ provider, request, scopes }) {
  if (!provider?.authorizeRequest) {
    return {
      ok: false,
      status: 503,
      error: "Tool/Skill management provider is unavailable."
    };
  }
  return provider.authorizeRequest({
    request,
    requiredScopes: scopes
  });
}

function errorPayload(error, fallbackMessage, extra = {}) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallbackMessage,
    ...extra
  };
}

function loginInputSummary(input = {}, request = null) {
  const username = String(input.username || "").trim().toLowerCase();
  return {
    usernameHash: username ? hashClientString(username, "console.auth.username") : "",
    usernameLength: username.length,
    host: String(request?.headers?.host || ""),
    origin: String(request?.headers?.origin || ""),
    remoteAddressHash: request?.socket?.remoteAddress
      ? hashClientString(request.socket.remoteAddress, "console.auth.remote")
      : "",
    userAgentHash: request?.headers?.["user-agent"]
      ? hashClientString(request.headers["user-agent"], "console.auth.user_agent")
      : ""
  };
}

function appendConsoleLog(context = {}, entry = {}) {
  if (typeof context.appendConsoleOperationLog === "function") {
    context.appendConsoleOperationLog(entry);
  }
}

function agentRuntimeProviderFrom(context = {}) {
  return context.agentRuntimeProvider || null;
}

function agentConfigRegistryFrom(context = {}) {
  const provider = agentRuntimeProviderFrom(context);
  if (typeof provider?.getAgentConfigRegistry === "function") {
    return provider.getAgentConfigRegistry();
  }
  return null;
}

function normalizeModelLibraryAgentAuditAgent(entry = {}) {
  const provider = String(entry.provider || "").trim();
  const model = String(entry.model || entry.engine || "").trim();
  const alias = String(entry.alias || entry.uid || entry.instanceId || "").trim();
  const agentName = String(entry.agentName || entry.label || alias || "").trim();
  return {
    uid: alias,
    provider,
    model,
    agentName,
    baseUrl: String(entry.baseUrl || entry.url || "").trim(),
    timeoutMs: Number(entry.timeoutMs || 0),
    apiKeyConfigured: Boolean(entry.apiKey || entry.token || entry.apiKeyConfigured || entry.tokenConfigured)
  };
}

function normalizeModelLibraryAuditList(models = []) {
  const normalized = [];
  for (const model of Array.isArray(models) ? models : []) {
    const item = normalizeModelLibraryAgentAuditAgent(model);
    if (!item.provider && !item.model && !item.uid) {
      continue;
    }
    normalized.push(item);
  }
  normalized.sort((left, right) => {
    const providerSort = String(left.provider || "").localeCompare(String(right.provider || ""));
    if (providerSort !== 0) {
      return providerSort;
    }
    const modelSort = String(left.model || "").localeCompare(String(right.model || ""));
    if (modelSort !== 0) {
      return modelSort;
    }
    return String(left.uid || "").localeCompare(String(right.uid || ""));
  });
  return {
    total: normalized.length,
    providers: [...new Set(normalized.map((item) => String(item.provider || "").trim()).filter(Boolean))],
    items: normalized
  };
}

function modelLibraryAgentAuditKey(entry = {}) {
  const uid = String(entry.uid || "").trim();
  const provider = String(entry.provider || "").trim();
  const model = String(entry.model || entry.engine || "").trim();
  const alias = String(entry.alias || entry.agentName || entry.label || "").trim();
  if (uid) {
    return uid;
  }
  return `${provider}::${model}::${alias}`;
}

function diffModelLibraryAgents(before = [], after = []) {
  const beforeMap = new Map(
    (Array.isArray(before) ? before : [])
      .map((agent) => [modelLibraryAgentAuditKey(agent), normalizeModelLibraryAgentAuditAgent(agent)])
      .filter(([key]) => String(key).trim().length > 0)
  );
  const afterMap = new Map(
    (Array.isArray(after) ? after : [])
      .map((agent) => [modelLibraryAgentAuditKey(agent), normalizeModelLibraryAgentAuditAgent(agent)])
      .filter(([key]) => String(key).trim().length > 0)
  );
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, next] of afterMap.entries()) {
    const previous = beforeMap.get(key) || null;
    if (!previous) {
      added.push(next);
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changed.push({ before: previous, after: next, key });
    }
  }
  for (const [key, item] of beforeMap.entries()) {
    if (!afterMap.has(key)) {
      removed.push(item);
    }
  }
  return {
    beforeCount: beforeMap.size,
    afterCount: afterMap.size,
    added,
    removed,
    changed
  };
}

function modelForProbeProvider(settings = {}, provider = "") {
  switch (provider) {
    case "google-gemini":
      return settings.googleModel;
    case "openai-chatgpt":
      return settings.openAiModel;
    case "deepseek":
      return settings.deepSeekModel;
    case "openrouter":
      return settings.openRouterModel;
    case "copilot":
      return settings.copilotModel;
    case "local-model":
      return settings.localModelName;
    case "custom-http":
      return settings.customModelAlias || settings.customHttpAdapter?.alias;
    default:
      return "";
  }
}

function findModelLibraryAgentForProbe(settings = {}, modelAlias = "", provider = "") {
  const normalizedAlias = String(modelAlias || "").trim();
  const normalizedProvider = String(provider || "").trim();
  const models = Array.isArray(settings.modelLibraryAgents) ? settings.modelLibraryAgents : [];
  if (normalizedAlias) {
    const byAlias = models.find((model) =>
      [model?.uid, model?.instanceId, model?.alias]
        .map((value) => String(value || "").trim())
        .includes(normalizedAlias)
    );
    if (byAlias) {
      return byAlias;
    }
  }
  const targetModel = String(modelForProbeProvider(settings, normalizedProvider) || "").trim();
  return models.find((model) => {
    if (normalizedProvider && String(model?.provider || "").trim() !== normalizedProvider) {
      return false;
    }
    if (!targetModel) {
      return true;
    }
    return [model?.model, model?.engine].map((value) => String(value || "").trim()).includes(targetModel);
  });
}

function preserveModelLibrarySecretsForProbe(incomingModels, currentSettings = {}) {
  if (!Array.isArray(incomingModels)) {
    return incomingModels;
  }
  const currentModels = Array.isArray(currentSettings.modelLibraryAgents)
    ? currentSettings.modelLibraryAgents
    : [];
  const currentByKey = new Map();
  for (const model of currentModels) {
    for (const key of [model?.uid, model?.instanceId, model?.alias].filter(Boolean)) {
      currentByKey.set(String(key).trim(), model);
    }
  }
  return incomingModels.map((model) => {
    const key = String(model?.uid || model?.instanceId || model?.alias || "").trim();
    const current = currentByKey.get(key);
    if (!current) {
      return model;
    }
    const next = { ...model };
    if (!String(next.apiKey || "").trim() && current.apiKey) {
      next.apiKey = current.apiKey;
    }
    if (!String(next.token || "").trim() && current.token) {
      next.token = current.token;
    }
    return next;
  });
}

function applySelectedModelSecretForProbe(settings = {}, provider = "", modelAlias = "") {
  if (!modelAlias) {
    return settings;
  }
  const selected = findModelLibraryAgentForProbe(settings, modelAlias, provider);
  if (!selected) {
    return settings;
  }
  if (provider === "deepseek") {
    settings.deepSeekApiKey = String(selected.apiKey || "").trim();
    settings.deepSeekApiKeyConfigured = Boolean(selected.apiKey);
    settings.deepSeekBaseUrl = String(selected.baseUrl || settings.deepSeekBaseUrl || "").trim();
    settings.deepSeekModel = String(selected.model || selected.engine || settings.deepSeekModel || "").trim();
  }
  if (provider === "custom-http") {
    const token = String(selected.token || selected.apiKey || "").trim();
    const selectedAdapter = {
      ...(settings.customHttpAdapter || {}),
      ...selected,
      alias: String(selected.uid || selected.instanceId || selected.alias || modelAlias).trim(),
      token,
      tokenConfigured: Boolean(token),
      url: String(selected.url || settings.customHttpAdapter?.url || "").trim(),
      engine: String(selected.engine || selected.model || "").trim()
    };
    settings.customHttpAdapter = selectedAdapter;
    settings.customHttpAdapters = [selectedAdapter];
  }
  return settings;
}

function mergeSettingsForModelProbe(currentSettings = {}, incomingSettings = {}, provider = "", options = {}) {
  const current = normalizeSettings(currentSettings);
  const incoming = incomingSettings && typeof incomingSettings === "object" ? incomingSettings : {};
  const nextSettings = {
    ...current,
    ...incoming
  };

  for (const key of [
    "googleApiKey",
    "openRouterApiKey",
    "deepSeekApiKey",
    "copilotApiKey",
    "customModelApiKey"
  ]) {
    if (!String(incoming?.[key] || "").trim() && current[key]) {
      nextSettings[key] = current[key];
    }
  }

  if (
    !String(incoming?.customHttpAdapter?.token || "").trim() &&
    current.customHttpAdapter?.token
  ) {
    nextSettings.customHttpAdapter = {
      ...(nextSettings.customHttpAdapter || {}),
      token: current.customHttpAdapter.token
    };
  }
  if (Array.isArray(incoming?.modelLibraryAgents)) {
    nextSettings.modelLibraryAgents = preserveModelLibrarySecretsForProbe(
      incoming.modelLibraryAgents,
      current
    );
  }

  if (nextSettings.customHttpAdapter) {
    const mergedAdapter = {
      ...(nextSettings.customHttpAdapter || {}),
      ...(incoming.customHttpAdapter || {})
    };
    nextSettings.customHttpAdapter = mergedAdapter;
  }

  return normalizeSettings(
    applySelectedModelSecretForProbe(
      nextSettings,
      String(provider || "").trim(),
      String(options.modelAlias || "").trim()
    )
  );
}

function normalizeAgentStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeAgentParameters(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeAgentModelPayload(payload = {}) {
  const source = payload?.agent || payload?.value || payload?.config || payload || {};
  const patch = {};
  const assignString = (target, keys) => {
    for (const key of keys) {
      if (Object.hasOwn(source, key)) {
        const value = source[key];
        patch[target] = String(value ?? "").trim();
        return;
      }
    }
  };

  assignString("uid", ["uid", "agentId"]);
  assignString("provider", ["provider", "modelProvider"]);
  assignString("label", ["name", "label", "agentName"]);
  assignString("model", ["model", "modelId", "engine"]);
  assignString("baseUrl", ["baseUrl", "base_url"]);
  assignString("url", ["url", "endpoint"]);
  assignString("apiKey", ["apiKey", "api_key", "key"]);
  assignString("token", ["token"]);
  assignString("tokenHeader", ["tokenHeader", "token_header"]);
  assignString("tokenPrefix", ["tokenPrefix", "token_prefix"]);
  assignString("systemPrompt", ["systemPrompt", "prompt"]);

  if (Object.hasOwn(patch, "label") && !Object.hasOwn(patch, "agentName")) {
    patch.agentName = patch.label;
  }
  if (Object.hasOwn(patch, "model") && !Object.hasOwn(patch, "engine")) {
    patch.engine = patch.model;
  }
  if (source.parameters !== undefined || source.parametersText !== undefined) {
    patch.parameters = normalizeAgentParameters(source.parameters ?? source.parametersText);
  }
  if (source.pluginList !== undefined || source.plugins !== undefined) {
    patch.pluginList = normalizeAgentStringList(source.pluginList ?? source.plugins);
  }
  if (source.timeoutMs !== undefined && source.timeoutMs !== null && source.timeoutMs !== "") {
    const timeoutMs = Number(source.timeoutMs);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      patch.timeoutMs = timeoutMs;
    }
  }
  return patch;
}

function sanitizeAgentPatchForLog(patch = {}) {
  const safe = {};
  const entries = Object.entries(patch || {});
  for (const [key, value] of entries) {
    if (["apiKey", "token", "apiKeyConfigured", "tokenConfigured"].includes(key)) {
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

function createAgentUid(entry = {}) {
  const digest = crypto
    .createHash("sha256")
    .update(
      [
        entry.provider || "deepseek",
        entry.label || entry.agentName || "",
        entry.model || entry.engine || "",
        entry.baseUrl || entry.url || "",
        crypto.randomUUID()
      ].join("\n")
    )
    .digest("hex")
    .slice(0, 16);
  return `agent_${digest}`;
}

function agentModelIdentity(entry = {}) {
  return [entry.uid, entry.instanceId, entry.alias, entry.id]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function findAgentModelIndex(models = [], agentId = "") {
  const id = String(agentId || "").trim();
  if (!id) {
    return -1;
  }
  const directIndex = models.findIndex((entry) => agentModelIdentity(entry).includes(id));
  if (directIndex >= 0) {
    return directIndex;
  }
  const nameMatches = models
    .map((entry, index) => ({
      index,
      name: String(entry.label || entry.agentName || "").trim()
    }))
    .filter((entry) => entry.name && entry.name === id);
  return nameMatches.length === 1 ? nameMatches[0].index : -1;
}

function agentModelProviders(models = []) {
  return [
    ...new Set(
      models
        .map((entry) => String(entry.provider || "").trim())
        .filter(Boolean)
    )
  ];
}

async function loadAgentRuntimeSettings(context = {}, options = {}) {
  const registry = agentConfigRegistryFrom(context);
  if (!registry) {
    throw new Error("Agent config registry provider is not configured.");
  }
  const settings = await loadSettings(context.userDataPath, options);
  const fallbackSettings = options.redactSecrets
    ? await loadSettings(context.userDataPath)
    : settings;
  await registry.refresh({ settingsFallback: fallbackSettings });
  return {
    ...settings,
    modelLibraryEntries: registry.getModelLibraryEntries(),
    modelLibraryAgentIds: registry.getModelLibraryAgents().map((agent) => agent.uid).filter(Boolean),
    modelLibraryAgents: registry.getModelLibraryAgents({
      redactSecrets: options.redactSecrets === true
    })
  };
}

async function saveAgentModelLibrary(context = {}, current, models) {
  const registry = agentConfigRegistryFrom(context);
  if (!registry) {
    throw new Error("Agent config registry provider is not configured.");
  }
  const agentRuntimeProvider = agentRuntimeProviderFrom(context);
  if (!agentRuntimeProvider || typeof agentRuntimeProvider.publicAgentGatewayRegistry !== "function") {
    throw new Error("Agent gateway runtime provider is not configured.");
  }
  await registry.replaceFromModelLibraryAgents(models);
  const savedBase = await saveSettings(context.userDataPath, {
    ...current,
    modelLibraryAgents: models,
    modelLibraryEntries: agentModelProviders(models),
    modelLibraryAgentIds: models.map((model) => model.uid || model.instanceId || model.alias).filter(Boolean)
  });
  await registry.refresh({ settingsFallback: savedBase });
  const saved = {
    ...savedBase,
    modelLibraryAgents: registry.getModelLibraryAgents(),
    modelLibraryEntries: registry.getModelLibraryEntries()
  };
  const redactedSettings = await loadAgentRuntimeSettings(context, { redactSecrets: true });
  await publishProtocolEvent(
    context.protocolEventBus,
    "settings.current",
    redactedSettings,
    { type: "settings.updated" }
  );
  return {
    saved,
    registry: await agentRuntimeProvider.publicAgentGatewayRegistry(saved)
  };
}

function appendAuthorizationArtifact(securityPermissions, methodName, artifact, metadata = {}) {
  if (!artifact || typeof securityPermissions?.[methodName] !== "function") {
    return;
  }
  securityPermissions[methodName](artifact, metadata);
}

function filterContributionsForWorkspace(items = [], input = {}) {
  const workspaceId = String(input.workspaceId || input.workspace || "").trim();
  if (!workspaceId || !items.some((item) => Object.hasOwn(item, "workspaceId"))) {
    return items;
  }
  return items.filter((item) => item.workspaceId === workspaceId);
}

async function executeWorkspaceContributionOperation({ operationId, input, context }) {
  if (
    !String(operationId || "").startsWith("workspace.contribution.") &&
    operationId !== "knowledge.contribution.submit" &&
    !String(operationId || "").startsWith("workspace.skill.")
  ) {
    return null;
  }
  const registry = contributionRegistryFor(input, context);
  const authSubject = subjectFromAuthSession(context.authSession);
  const runtimeSubject = objectOrNull(context.subject) || {};
  const subject = {
    ...authSubject,
    ...runtimeSubject,
    subjectId: runtimeSubject.subjectId || runtimeSubject.id || authSubject.subjectId || "",
    username: runtimeSubject.username || authSubject.username || runtimeSubject.label || "",
    scopes: Array.isArray(runtimeSubject.scopes) ? runtimeSubject.scopes : authSubject.scopes
  };
  const securityPermissions = context.securityPermissions;
  try {
    if (operationId === "workspace.contribution.submit" || operationId === "knowledge.contribution.submit") {
      const resultPayload = registry.submitContribution({
        ...input,
        workspaceId: workspaceIdFrom(input),
        contributorId: input.contributorId || subject.subjectId || subject.username || "anonymous",
        contributorKind: input.contributorKind || subject.type || "agent",
        contributionType: input.contributionType ||
          (operationId === "knowledge.contribution.submit" ? "knowledge" : undefined) ||
          (input.skillManifestRef ? "skill" : undefined)
      });
      return result(201, protocolPayload(resultPayload));
    }
    if (operationId === "workspace.contribution.list") {
      const items = filterContributionsForWorkspace(registry.listContributions(), input);
      return result(200, protocolPayload({ items, count: items.length }));
    }
    if (operationId === "workspace.contribution.assets.list") {
      return result(200, protocolPayload(registry.listWorkspaceAssets(input)));
    }
    if (operationId === "workspace.contribution.leaderboard") {
      const items = filterContributionsForWorkspace(registry.getLeaderboard(), input);
      return result(200, protocolPayload({ items, count: items.length }));
    }
    if (operationId === "workspace.contribution.stats") {
      return result(200, protocolPayload(registry.getStats()));
    }
    if (operationId === "workspace.contribution.report") {
      return result(200, protocolPayload(registry.getContributionReport(input)));
    }
    if (operationId === "workspace.contribution.permission.request") {
      const resultPayload = registry.requestPermission(context.contributionId || input.contributionId, {
        ...input,
        requesterId: input.requesterId || subject.subjectId || subject.username
      });
      return result(201, protocolPayload(resultPayload));
    }
    if (operationId === "workspace.contribution.permission.grant") {
      const resultPayload = registry.grantPermission(context.contributionId || input.contributionId, {
        ...input,
        granteeId: input.granteeId || subject.subjectId || subject.username
      });
      appendAuthorizationArtifact(securityPermissions, "appendLoanRecord", resultPayload.loanRecord);
      return result(200, protocolPayload(resultPayload));
    }
    if (operationId === "workspace.contribution.scan") {
      return result(200, protocolPayload(registry.scanContribution(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.contribution.review") {
      return result(200, protocolPayload(registry.reviewContribution(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username,
        reviewerId: input.reviewerId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.contribution.preview") {
      return result(200, protocolPayload(registry.previewContribution(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.contribution.publish") {
      return result(200, protocolPayload(registry.publishContribution(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.contribution.adopt") {
      return result(200, protocolPayload(registry.adoptContribution(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.contribution.reject") {
      return result(200, protocolPayload(registry.rejectContribution(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.contribution.request_changes") {
      return result(200, protocolPayload(registry.requestChanges(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.contribution.revoke") {
      return result(200, protocolPayload(registry.revokeContribution(context.contributionId || input.contributionId, {
        ...input,
        actorId: input.actorId || subject.subjectId || subject.username
      })));
    }
    if (operationId === "workspace.skill.upload") {
      const resultPayload = registry.submitContribution({
        ...input,
        workspaceId: workspaceIdFrom(input),
        contributorId: input.contributorId || subject.subjectId || subject.username || "anonymous",
        contributorKind: input.contributorKind || subject.type || "agent",
        contributionType: "skill",
        title: input.title || input.skillId || "workspace skill"
      });
      return result(201, protocolPayload(resultPayload));
    }
    if (operationId === "workspace.skill.list") {
      const items = filterContributionsForWorkspace(registry.listContributions(), input)
        .filter((item) => item.contributionType === "skill");
      return result(200, protocolPayload({ items, count: items.length }));
    }
    if (operationId === "workspace.skill.download") {
      const skillId = String(input.skillId || input["skill-id"] || input.id || "").trim();
      const item = registry.listContributions().find((candidate) =>
        candidate.contributionType === "skill" &&
        (candidate.contributionId === skillId || candidate.skillManifestRef === skillId || candidate.title === skillId)
      );
      if (!item) {
        return result(404, { error: "workspace skill 不存在。" });
      }
      return result(200, protocolPayload({ skill: item }));
    }
    if (operationId === "workspace.skill.usage.report") {
      const resultPayload = registry.recordUsage(input.contributionId || input.skillId, {
        ...input,
        action: input.action || "skill.used",
        actorId: input.actorId || subject.subjectId || subject.username
      });
      return result(200, protocolPayload(resultPayload));
    }
  } catch (error) {
    return result(400, errorPayload(error, "Workspace contribution operation failed."));
  }
  return null;
}

async function executeKnowledgeAccessOperation({ operationId, input, context }) {
  if (!String(operationId || "").startsWith("knowledge.access.")) {
    return null;
  }
  const securityPermissions = context.securityPermissions;
  if (operationId === "knowledge.access.evaluate") {
    try {
      const subject = subjectFromAuthSession(context.authSession);
      const requestPayload = {
        subject,
        operatorId: subject.subjectId,
        ...((input.request && typeof input.request === "object") ? input.request : input)
      };
      const policyPayload = input.policy || input.authorizationPolicy || input;
      const decision = evaluateKnowledgeAccess(requestPayload, policyPayload);
      appendAuthorizationArtifact(securityPermissions, "appendReceipt", decision.knowledgeAccessReceipt, {
        decisionId: decision.decisionId,
        subjectId: subject.subjectId
      });
      appendAuthorizationArtifact(securityPermissions, "appendLoanRecord", decision.loanRecord, {
        decisionId: decision.decisionId,
        subjectId: subject.subjectId
      });
      if (decision.deniedRequestAudit && typeof securityPermissions?.appendDeniedRequest === "function") {
        securityPermissions.appendDeniedRequest({
          decisionId: decision.decisionId,
          subjectId: subject.subjectId,
          operationId: "knowledge.access.evaluate",
          reasonCode: decision.filteredReason || "knowledge_access_denied",
          deniedRequest: decision.deniedRequestAudit
        });
      }
      return result(200, protocolPayload({ decision }));
    } catch (error) {
      return result(400, errorPayload(error, "知识访问裁决失败。"));
    }
  }
  if (!securityPermissions) {
    return result(503, { error: "授权记录存储不可用。" });
  }
  const listInput = {
    limit: input.limit || 100,
    subjectId: input.subjectId || input["subject-id"] || ""
  };
  if (operationId === "knowledge.access.receipt.list" && typeof securityPermissions.listReceipts === "function") {
    const items = securityPermissions.listReceipts(listInput);
    return result(200, protocolPayload({ items, count: items.length }));
  }
  if (operationId === "knowledge.access.loan_record.list" && typeof securityPermissions.listLoanRecords === "function") {
    const items = securityPermissions.listLoanRecords(listInput);
    return result(200, protocolPayload({ items, count: items.length }));
  }
  if (operationId === "knowledge.access.denied_request.list" && typeof securityPermissions.listDeniedRequests === "function") {
    const items = securityPermissions.listDeniedRequests(listInput);
    return result(200, protocolPayload({ items, count: items.length }));
  }
  return null;
}

async function executeKnowledgeManagementOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.config_schema",
    "knowledge.capabilities",
    "knowledge.export_docx",
    "knowledge.export_markdown",
    "knowledge.export_html",
    "knowledge.health",
    "knowledge.maintenance.get",
    "knowledge.maintenance.settings",
    "knowledge.maintenance.set",
    "knowledge.reindex",
    "knowledge.maintenance.run",
    "knowledge.sync",
    "knowledge.changes",
    "knowledge.review_items",
    "knowledge.review_resolve",
    "knowledge.feedback",
    "knowledge.suggestions",
    "knowledge.suggestion_resolve",
    "knowledge.learning.jobs",
    "knowledge.learning.health"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const knowledgeCore = getKnowledgeCore(context.runtime);
  const metadataStore = context.metadataStore;

  if (id === "knowledge.config_schema") {
    return result(200, {
      schemaVersion: 1,
      groups: [
        {
          id: "retrieval",
          label: "检索融合",
          fields: [
            { name: "retrieval.topK", type: "number", min: 1, max: 100, defaultValue: 20, label: "Top K" },
            { name: "retrieval.bm25Weight", type: "number", min: 0, max: 1, step: 0.05, defaultValue: 0.55, label: "BM25 权重" },
            { name: "retrieval.vectorWeight", type: "number", min: 0, max: 1, step: 0.05, defaultValue: 0.3, label: "向量权重" },
            { name: "retrieval.imageWeight", type: "number", min: 0, max: 1, step: 0.05, defaultValue: 0.15, label: "图片权重" },
            { name: "retrieval.graphWeight", type: "number", min: 0, max: 1, step: 0.05, defaultValue: 0.05, label: "图谱提示权重" },
            { name: "retrieval.feedbackBoost", type: "number", min: 0, max: 1, step: 0.05, defaultValue: 0.08, label: "反馈提升权重" },
            { name: "retrieval.recencyWeight", type: "number", min: 0, max: 1, step: 0.01, defaultValue: 0.08, label: "时间新鲜度权重", description: "按指数半衰期为更近的资料提供轻量排序加成，0 表示关闭。" },
            { name: "retrieval.recencyHalfLifeDays", type: "number", min: 1, max: 3650, defaultValue: 45, label: "时间新鲜度半衰期（天）", description: "指数衰减参数：资料年龄达到该天数时，新鲜度分约降为 50%。" },
            { name: "retrieval.recencyFloor", type: "number", min: 0, max: 1, step: 0.01, defaultValue: 0.05, label: "新鲜度最低保留", description: "避免旧资料被时间因子完全压制，只影响排序，不删除或屏蔽知识。" },
            { name: "retrieval.parentExpansionDepth", type: "number", min: 0, max: 5, defaultValue: 1, label: "父级扩展深度" },
            { name: "retrieval.hierarchicalIndexEnabled", type: "boolean", defaultValue: true, label: "启用分层索引" },
            { name: "retrieval.hierarchyWeight", type: "number", min: 0, max: 1, step: 0.05, defaultValue: 0.18, label: "分层路径权重" },
            { name: "retrieval.hierarchyBranchTopK", type: "number", min: 3, max: 50, defaultValue: 12, label: "粗层候选分支数" },
            { name: "retrieval.hierarchyBackoffLimit", type: "number", min: 1, max: 80, defaultValue: 16, label: "分层回退片段数" },
            { name: "retrieval.hierarchyMinBranchCandidates", type: "number", min: 1, max: 20, defaultValue: 3, label: "分支最少细候选数" }
          ]
        },
        {
          id: "learning",
          label: "进化学习",
          fields: [
            { name: "learning.enabled", type: "boolean", defaultValue: true, label: "启用学习闭环" },
            { name: "learning.autoApplyRetrievalProfiles", type: "boolean", defaultValue: true, label: "自动发布检索 profile" },
            { name: "learning.feedbackWindowHours", type: "number", min: 1, max: 8760, defaultValue: 168, label: "反馈窗口小时数" },
            { name: "learning.minFeedbackForAutoTune", type: "number", min: 1, max: 10000, defaultValue: 1, label: "自动调参最少反馈数" },
            { name: "learning.requireEvaluationBeforeProfileActivation", type: "boolean", defaultValue: true, label: "激活前必须离线评估" },
            { name: "learning.canaryEnabled", type: "boolean", defaultValue: true, label: "启用检索策略灰度" },
            { name: "learning.canaryTrafficPercent", type: "number", min: 1, max: 100, defaultValue: 10, label: "默认灰度流量百分比" }
          ]
        },
        {
          id: "maintenance",
          label: "维护策略",
          fields: [
            { name: "maintenance.reindexBatchSize", type: "number", min: 1, max: 5000, defaultValue: 500, label: "重建批大小" },
            { name: "maintenance.staleIndexHours", type: "number", min: 1, max: 8760, defaultValue: 72, label: "过期索引小时数" },
            { name: "maintenance.requireOcrOrCaption", type: "boolean", defaultValue: true, label: "图片必须带 OCR 或说明" }
          ]
        },
        {
          id: "embeddingModel",
          label: "Embedding",
          fields: [
            { name: "embeddingModel.version", type: "string", defaultValue: "", label: "模型版本" },
            { name: "embeddingModel.text", type: "string", defaultValue: "builtin:hashing-multilingual-v1", label: "文本 provider" },
            { name: "embeddingModel.image", type: "string", defaultValue: "builtin:asset-ocr-caption-v1", label: "图片 provider" }
          ]
        }
      ],
      maintenanceTasks: [
        { id: "validate_assets", label: "校验资产", danger: "low", requiresConfirm: false },
        { id: "repair_missing_thumbnails", label: "修复缩略图", danger: "low", requiresConfirm: false },
        { id: "delete_orphan_objects", label: "删除孤立对象", danger: "high", requiresConfirm: true },
        { id: "garbage_cleanup", label: "垃圾清理", danger: "high", requiresConfirm: true, supportsDryRun: true },
        { id: "compare_retrieval_profiles", label: "比较检索参数", danger: "low", requiresConfirm: false },
        { id: "learning_run", label: "执行学习调参", danger: "low", requiresConfirm: false },
        { id: "validate_quality", label: "质量断言", danger: "low", requiresConfirm: false },
        { id: "reembed_by_model_version", label: "按模型重算 embedding", danger: "medium", requiresConfirm: true },
        { id: "reindex", label: "重建索引", danger: "medium", requiresConfirm: true }
      ]
    });
  }

  if (id === "knowledge.capabilities") {
    if (knowledgeCore && typeof knowledgeCore.capabilities === "function") {
      return result(200, await knowledgeCore.capabilities());
    }
    return result(503, { error: "知识库协议模块不可用。" });
  }

  const exportMethods = {
    "knowledge.export_docx": { methodName: "exportDocx", label: "docx", unavailable: "知识库 DOCX 导出模块不可用。" },
    "knowledge.export_markdown": { methodName: "exportMarkdown", label: "markdown", unavailable: "知识库 Markdown 导出模块不可用。" },
    "knowledge.export_html": { methodName: "exportHtml", label: "html", unavailable: "知识库 HTML 导出模块不可用。" }
  };
  if (exportMethods[id]) {
    const { methodName, label, unavailable } = exportMethods[id];
    if (!knowledgeCore || typeof knowledgeCore[methodName] !== "function") {
      return result(503, { error: unavailable });
    }
    const operationResult = await knowledgeCore[methodName]({
      documentId: input.documentId || input["document-id"] || "",
      batchId: input.batchId || input["batch-id"] || "",
      sourceId: input.sourceId || input["source-id"] || "",
      limit: Number(input.limit || 500),
      ...(id === "knowledge.export_docx"
        ? {
            includeMachineReadable: parseBooleanFlag(
              input.includeMachineReadable ?? input["include-machine-readable"],
              false
            )
          }
        : {})
    });
    return result(200, {
      __binaryResponse: true,
      contentType: operationResult.contentType,
      disposition: "attachment",
      fileName: operationResult.fileName,
      buffer: operationResult.buffer,
      headers: { "X-Pact-Knowledge-Export": label }
    });
  }

  if (id === "knowledge.health") {
    if (knowledgeCore && typeof knowledgeCore.health === "function") {
      return result(200, await knowledgeCore.health());
    }
    return result(503, { ok: false, error: "知识库协议模块不可用。" });
  }

  if (id === "knowledge.maintenance.get" || id === "knowledge.maintenance.settings") {
    if (knowledgeCore && typeof knowledgeCore.getMaintenance === "function") {
      return result(200, await knowledgeCore.getMaintenance());
    }
    return result(503, { error: "知识库维护模块不可用。" });
  }

  if (id === "knowledge.maintenance.set") {
    if (knowledgeCore && typeof knowledgeCore.setMaintenance === "function") {
      const operationResult = await knowledgeCore.setMaintenance(input.value || input);
      const recencyHalfLifeDays = Number(operationResult?.retrieval?.recencyHalfLifeDays);
      if (
        Number.isFinite(recencyHalfLifeDays) &&
        recencyHalfLifeDays > 0 &&
        typeof context.saveSettings === "function"
      ) {
        await context.saveSettings(context.userDataPath, { retrievalHalfLifeDays: recencyHalfLifeDays });
      }
      return result(200, operationResult);
    }
    return result(503, { error: "知识库维护模块不可用。" });
  }

  if (id === "knowledge.reindex") {
    if (input.confirm !== true) {
      return result(400, { error: "重建知识库索引需要 confirm=true。" });
    }
    if (knowledgeCore && typeof knowledgeCore.reindex === "function") {
      return result(200, await knowledgeCore.reindex(input));
    }
    return result(503, { error: "知识库重建模块不可用。" });
  }

  if (id === "knowledge.maintenance.run") {
    const taskType = String(input.taskType || input.task || "")
      .trim()
      .replace(/-/g, "_");
    if (
      [
        "delete_orphan_objects",
        "garbage_cleanup",
        "cleanup_garbage",
        "gc",
        "compact_storage",
        "reembed_by_model_version",
        "reindex",
        "rebuild_index"
      ].includes(taskType) &&
      input.dryRun !== true &&
      input.dry_run !== true &&
      input.confirm !== true
    ) {
      return result(400, { error: `维护任务 ${taskType} 需要 confirm=true。` });
    }
    if (knowledgeCore && typeof knowledgeCore.runMaintenance === "function") {
      return result(200, await knowledgeCore.runMaintenance(input));
    }
    return result(503, { error: "知识库维护任务模块不可用。" });
  }

  if (id === "knowledge.sync") {
    const scope = String(input.scope || "").trim().toLowerCase();
    if (scope === "mirror" && knowledgeCore && typeof knowledgeCore.syncMirror === "function") {
      return result(200, await knowledgeCore.syncMirror({
        since: Number(input.since || 0),
        limit: Number(input.limit || 500)
      }));
    }
    return result(200, metadataStore.syncKnowledge({
      since: Number(input.since || 0),
      limit: Number(input.limit || 500),
      scope
    }));
  }

  if (id === "knowledge.changes") {
    const operationResult = metadataStore.submitKnowledgeChanges({
      changes: Array.isArray(input.changes)
        ? input.changes
        : Array.isArray(input.outbox)
          ? input.outbox
          : []
    });
    await publishProtocolEvent(context.protocolEventBus, "knowledge.changes", operationResult, {
      type: "knowledge.changes.submitted"
    });
    return result(200, operationResult);
  }

  if (id === "knowledge.review_items") {
    const requestedStatus = input.status || "pending";
    const status = requestedStatus === "all" ? "" : requestedStatus;
    const limit = Number(input.limit || 100);
    const metadataItems = metadataStore.listKnowledgeReviewItems({ status, limit });
    const coreItems =
      knowledgeCore && typeof knowledgeCore.listReviewItems === "function"
        ? await knowledgeCore.listReviewItems({ status, limit })
        : { items: [] };
    const items = [
      ...(metadataItems.items || []).map((item) => ({
        ...item,
        source: item.source || "metadata-store"
      })),
      ...(coreItems.items || []).map((item) => ({
        ...item,
        source: item.source || "knowledge-core"
      }))
    ]
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .slice(0, Math.max(1, Math.min(limit, 500)));
    return result(200, {
      status: requestedStatus,
      items,
      count: items.length,
      sources: {
        metadataStore: (metadataItems.items || []).length,
        knowledgeCore: (coreItems.items || []).length
      }
    });
  }

  if (id === "knowledge.review_resolve") {
    let operationResult = metadataStore.resolveKnowledgeReviewItem({
      reviewId: input.reviewId || input["review-id"] || input.id || "",
      resolution: input.resolution || input.action || "reject",
      patch: input.patch || input.fieldPatch || {}
    });
    if (!operationResult && knowledgeCore && typeof knowledgeCore.resolveReviewItem === "function") {
      operationResult = await knowledgeCore.resolveReviewItem({
        reviewId: input.reviewId || input["review-id"] || input.id || "",
        resolution: input.resolution || input.action || "reject",
        patch: input.patch || input.fieldPatch || {}
      });
    }
    if (!operationResult) {
      return result(404, { error: "审核项不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.review_items", operationResult, {
      type: "knowledge.review_item.resolved"
    });
    return result(200, operationResult);
  }

  if (id === "knowledge.feedback") {
    if (knowledgeCore && typeof knowledgeCore.recordFeedback === "function") {
      const operationResult = await knowledgeCore.recordFeedback(input || {});
      await publishProtocolEvent(context.protocolEventBus, "knowledge.feedback", operationResult, {
        type: "knowledge.feedback.recorded"
      });
      return result(200, operationResult);
    }
    return result(503, { error: "知识库学习反馈模块不可用。" });
  }

  if (id === "knowledge.suggestions") {
    if (knowledgeCore && typeof knowledgeCore.listSuggestions === "function") {
      return result(200, await knowledgeCore.listSuggestions({
        status: input.status || "pending",
        limit: Number(input.limit || 100)
      }));
    }
    return result(503, { error: "知识库建议模块不可用。" });
  }

  if (id === "knowledge.suggestion_resolve") {
    if (knowledgeCore && typeof knowledgeCore.resolveSuggestion === "function") {
      const operationResult = await knowledgeCore.resolveSuggestion({
        suggestionId: input.suggestionId || input["suggestion-id"] || input.id || "",
        resolution: input.resolution || input.action || "reject",
        patch: input.patch || input.fieldPatch || {}
      });
      if (!operationResult) {
        return result(404, { error: "知识库建议不存在。" });
      }
      await publishProtocolEvent(context.protocolEventBus, "knowledge.suggestions", operationResult, {
        type: "knowledge.suggestion.resolved"
      });
      return result(200, operationResult);
    }
    return result(503, { error: "知识库建议模块不可用。" });
  }

  if (id === "knowledge.learning.jobs") {
    if (knowledgeCore && typeof knowledgeCore.runLearningJob === "function") {
      const operationResult = await knowledgeCore.runLearningJob(input || {});
      await publishProtocolEvent(context.protocolEventBus, "knowledge.learning", operationResult, {
        type: "knowledge.learning.completed"
      });
      return result(200, operationResult);
    }
    return result(503, { error: "知识库学习任务模块不可用。" });
  }

  if (id === "knowledge.learning.health") {
    if (knowledgeCore && typeof knowledgeCore.learningHealth === "function") {
      return result(200, await knowledgeCore.learningHealth());
    }
    return result(503, { ok: false, error: "知识库学习运行时不可用。" });
  }

  return null;
}

async function executeKnowledgePreprocessingRulesOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "email_rules.get",
    "email_rules.set",
    "expert_vocabulary.summary",
    "expert_vocabulary.get",
    "expert_vocabulary.set",
    "expert_vocabulary.versions",
    "knowledge.guidance.summary",
    "knowledge_taxonomy.get",
    "knowledge_taxonomy.set",
    "knowledge_taxonomy.versions"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const userDataPath = context.userDataPath;
  if (id === "email_rules.get") {
    const rules = await context.loadEmailRules(userDataPath);
    return result(200, {
      path: context.getEmailRulesPath(userDataPath),
      rules
    });
  }
  if (id === "email_rules.set") {
    const saved = await context.saveEmailRules(userDataPath, input?.rules || input);
    const payload = {
      path: context.getEmailRulesPath(userDataPath),
      rules: saved
    };
    await publishProtocolEvent(context.protocolEventBus, "email_rules.current", payload, {
      type: "email_rules.updated"
    });
    return result(200, payload);
  }
  if (id === "expert_vocabulary.summary") {
    if (typeof context.getExpertVocabularySummary !== "function") {
      return result(503, { error: "专家词汇库摘要模块不可用。" });
    }
    return result(200, await context.getExpertVocabularySummary(userDataPath));
  }
  if (id === "expert_vocabulary.get") {
    const vocabulary = await context.loadExpertVocabulary(userDataPath);
    return result(200, {
      path: context.getExpertVocabularyPath(userDataPath),
      vocabulary
    });
  }
  if (id === "expert_vocabulary.set") {
    const saved = await context.saveExpertVocabulary(userDataPath, input?.vocabulary || input);
    const payload = {
      path: context.getExpertVocabularyPath(userDataPath),
      vocabulary: saved
    };
    await publishProtocolEvent(context.protocolEventBus, "expert_vocabulary.current", payload, {
      type: "expert_vocabulary.updated"
    });
    return result(200, payload);
  }
  if (id === "expert_vocabulary.versions") {
    return result(200, await context.listExpertVocabularyVersions(userDataPath));
  }
  if (id === "knowledge.guidance.summary") {
    if (typeof context.getKnowledgeGuidanceSummary !== "function") {
      return result(503, { error: "知识治理摘要模块不可用。" });
    }
    return result(200, await context.getKnowledgeGuidanceSummary(userDataPath));
  }
  if (id === "knowledge_taxonomy.get") {
    const taxonomy = await context.loadKnowledgeTaxonomy(userDataPath);
    return result(200, {
      path: context.getKnowledgeTaxonomyPath(userDataPath),
      taxonomy,
      guidance: await context.getKnowledgeGuidanceSummary(userDataPath)
    });
  }
  if (id === "knowledge_taxonomy.set") {
    const saved = await context.saveKnowledgeTaxonomy(userDataPath, input?.taxonomy || input);
    await publishProtocolEvent(
      context.protocolEventBus,
      "knowledge_taxonomy.current",
      {
        path: context.getKnowledgeTaxonomyPath(userDataPath),
        taxonomy: saved
      },
      { type: "knowledge_taxonomy.updated" }
    );
    return result(200, {
      path: context.getKnowledgeTaxonomyPath(userDataPath),
      taxonomy: saved,
      guidance: await context.getKnowledgeGuidanceSummary(userDataPath)
    });
  }
  if (id === "knowledge_taxonomy.versions") {
    return result(200, await context.listKnowledgeTaxonomyVersions(userDataPath));
  }

  return null;
}

async function executeKnowledgeDocumentParsingOperation({ operationId, input, context }) {
  if (String(operationId || "") !== "knowledge.document_parse") {
    return null;
  }
  const runtime = typeof context.createDocumentParsingRuntime === "function"
    ? context.createDocumentParsingRuntime()
    : null;
  if (!runtime || typeof runtime.parseDocuments !== "function") {
    return result(503, { error: "文档解析运行时不可用。" });
  }
  const payload = input || {};
  const settings = payload.settings || await context.loadSettings(context.userDataPath);
  const uploadSessionId = String(payload.uploadSessionId || "").trim();
  const cleanupUploadSession = Boolean(uploadSessionId && payload.dryRun === true && payload.cleanupUploadSession === true);
  try {
    const uploadedFiles = uploadSessionId
      ? await context.resolveUploadSessionFiles(context.userDataPath, uploadSessionId)
      : Array.isArray(payload.uploadedFiles)
        ? payload.uploadedFiles
        : [];
    const documentParsing = payload.documentParsing && typeof payload.documentParsing === "object"
      ? payload.documentParsing
      : {};
    const operationResult = await runtime.parseDocuments({
      ...payload,
      sources: uploadSessionId ? [] : payload.sources,
      uploadedFiles,
      settings,
      userDataPath: context.userDataPath,
      runtime: context.runtime,
      expectedOutput:
        payload.expectedOutput ||
        payload.expectedOutputs ||
        documentParsing.expectedOutput ||
        documentParsing.expectedOutputs ||
        "chunks",
      dryRun: true
    });
    const publicResult = typeof context.toPublicDocumentParsingResult === "function"
      ? context.toPublicDocumentParsingResult(operationResult)
      : operationResult;
    return result(200, publicResult);
  } finally {
    if (cleanupUploadSession && typeof context.deleteUploadSession === "function") {
      await context.deleteUploadSession(context.userDataPath, uploadSessionId).catch(() => null);
    }
  }
}

async function executeKnowledgeCorpusOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "storage.source_vocabulary.rebuild",
    "knowledge.corpus.significant_terms",
    "knowledge.affair_taxonomy",
    "search.query"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const { storageProvider, error } = requireStorageProvider(context);
  if (error) {
    return error;
  }
  if (id === "storage.source_vocabulary.rebuild") {
    const operationResult = storageProvider.rebuildSourceVocabulary({
      rules: await context.loadEmailRules(context.userDataPath)
    });
    await publishProtocolEvent(context.protocolEventBus, "storage.summary", storageProvider.getStorageSummary(), {
      type: "storage.summary.snapshot"
    });
    return result(200, operationResult);
  }
  if (id === "knowledge.corpus.significant_terms") {
    return result(200, storageProvider.getSignificantSourceTerms(input || {}));
  }
  if (id === "knowledge.affair_taxonomy") {
    if (typeof context.enhanceAffairTaxonomy !== "function") {
      return result(503, { error: "事务分类增强模块不可用。" });
    }
    return result(200, await context.enhanceAffairTaxonomy({
      documents: Array.isArray(input?.documents) ? input.documents : [],
      settings: await context.loadSettings(context.userDataPath),
      userDataPath: context.userDataPath
    }));
  }
  if (id === "search.query") {
    const searchInput = normalizeSearchQueryInput(input);
    return result(200, storageProvider.search({
      query: searchInput.query,
      limit: searchInput.limit || 20,
      batchId: searchInput.batchId,
      entityTypes: searchInput.entityTypes,
      formalOnly: searchInput.formalOnly,
      rules: await context.loadEmailRules(context.userDataPath)
    }));
  }
  return null;
}

async function executeKnowledgeSourceOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.console",
    "knowledge.sources.list",
    "knowledge.sources.create",
    "knowledge.sources.update",
    "knowledge.sources.delete",
    "knowledge.sources.refresh",
    "knowledge.sources.refresh_all"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  if (id === "knowledge.console") {
    if (typeof context.consoleDomainServices?.buildKnowledgeConsoleSummary !== "function") {
      return result(503, { error: "知识库控制台摘要 provider 未配置。" });
    }
    const summary = await context.consoleDomainServices.buildKnowledgeConsoleSummary(context.runtime, context.jobWorkflowProvider);
    if (!context.knowledgeSourceService) {
      return result(200, summary);
    }
    return result(200, {
      ...summary,
      sources: await context.knowledgeSourceService.listSources()
    });
  }

  const knowledgeSourceService = context.knowledgeSourceService;
  if (!knowledgeSourceService) {
    return result(503, { error: "知识库目录同步服务不可用。" });
  }
  if (id === "knowledge.sources.list") {
    return result(200, await knowledgeSourceService.listSources());
  }
  if (id === "knowledge.sources.create") {
    return result(200, await knowledgeSourceService.createSource(input));
  }
  if (id === "knowledge.sources.update") {
    const sourceId = String(input.sourceId || input["source-id"] || input.id || "").trim();
    const operationResult = await knowledgeSourceService.updateSource(sourceId, input);
    if (!operationResult) {
      return result(404, { error: "知识库目录不存在。" });
    }
    return result(200, operationResult);
  }
  if (id === "knowledge.sources.delete") {
    const sourceId = String(input.sourceId || input["source-id"] || input.id || "").trim();
    const operationResult = await knowledgeSourceService.deleteSource(sourceId);
    if (!operationResult) {
      return result(404, { error: "知识库目录不存在。" });
    }
    return result(200, operationResult);
  }
  if (id === "knowledge.sources.refresh") {
    const sourceId = String(input.sourceId || input["source-id"] || input.id || "").trim();
    return result(200, await knowledgeSourceService.refreshSource(sourceId, input));
  }
  if (id === "knowledge.sources.refresh_all") {
    return result(200, await knowledgeSourceService.refreshAll(input));
  }

  return null;
}

async function executeStorageOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "storage.summary",
    "storage.doctor",
    "storage.reconcile",
    "storage.backups.list",
    "storage.backups.create",
    "storage.backups.restore_preview",
    "storage.backups.restore"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const { storageProvider, error } = requireStorageProvider(context);
  if (error) {
    return error;
  }

  if (id === "storage.summary") {
    return result(200, storageProvider.getStorageSummary());
  }
  if (id === "storage.doctor") {
    return result(200, await storageProvider.runDoctor());
  }
  if (id === "storage.reconcile") {
    return result(200, await storageProvider.reconcile(input || {}));
  }
  if (id === "storage.backups.list") {
    return result(200, await storageProvider.listBackups());
  }
  if (id === "storage.backups.create") {
    try {
      return result(200, await storageProvider.createBackup(input || {}));
    } catch (error) {
      return result(400, errorPayload(error, "Storage backup creation failed."));
    }
  }
  if (id === "storage.backups.restore_preview") {
    try {
      return result(200, await storageProvider.restoreBackupPreview(input || {}));
    } catch (error) {
      return result(400, errorPayload(error, "Storage restore preview failed."));
    }
  }
  if (id === "storage.backups.restore") {
    try {
      return result(200, await storageProvider.restoreBackup(input || {}));
    } catch (error) {
      return result(400, errorPayload(error, "Storage restore failed."));
    }
  }

  return null;
}

async function executeClientRuntimeOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "client_runtime.profiles.get",
    "client_runtime.profiles.set",
    "client_runtime.resolve",
    "client_runtime.bootstrap.plan",
    "client_runtime.bootstrap.pull",
    "client_runtime.status"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const allocator = context.clientRuntimeAllocator;
  const bootstrap = context.clientRuntimeBootstrap;
  if (id === "client_runtime.profiles.get") {
    if (!allocator || typeof allocator.listProfiles !== "function") {
      return result(503, { error: "客户端运行时分配器不可用。" });
    }
    return result(200, await allocator.listProfiles());
  }
  if (id === "client_runtime.profiles.set") {
    if (!allocator || typeof allocator.saveProfiles !== "function") {
      return result(503, { error: "客户端运行时分配器不可用。" });
    }
    return result(200, await allocator.saveProfiles(input));
  }
  if (id === "client_runtime.resolve") {
    if (!allocator || typeof allocator.resolve !== "function") {
      return result(503, { error: "客户端运行时分配器不可用。" });
    }
    return result(200, await allocator.resolve(input));
  }
  if (id === "client_runtime.bootstrap.plan") {
    if (!bootstrap || typeof bootstrap.buildPlan !== "function") {
      return result(503, { error: "客户端运行时 bootstrap 不可用。" });
    }
    return result(200, bootstrap.buildPlan(input));
  }
  if (id === "client_runtime.bootstrap.pull") {
    if (!bootstrap || typeof bootstrap.buildPull !== "function") {
      return result(503, { error: "客户端运行时 bootstrap 不可用。" });
    }
    return result(200, bootstrap.buildPull(input));
  }
  if (id === "client_runtime.status") {
    if (!allocator || typeof allocator.getStatus !== "function") {
      return result(503, { error: "客户端运行时分配器不可用。" });
    }
    return result(200, await allocator.getStatus());
  }

  return null;
}

async function executeMonitorAlertOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "system.monitor_alerts.get",
    "system.monitor_alerts.set",
    "system.monitor_alerts.ack"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const { devopsProvider, error } = requireDevopsProvider(context);
  if (error) {
    return error;
  }
  if (id === "system.monitor_alerts.get") {
    if (typeof devopsProvider.getMonitorAlertState !== "function") {
      return result(503, { error: "监控报警状态接口不可用。" });
    }
    return result(200, await devopsProvider.getMonitorAlertState({ ...(input || {}), queueMonitor: context.queueMonitor }));
  }
  if (id === "system.monitor_alerts.set") {
    if (typeof devopsProvider.saveMonitorAlertConfig !== "function" || typeof devopsProvider.getMonitorAlertState !== "function") {
      return result(503, { error: "监控报警配置接口不可用。" });
    }
    const config = await devopsProvider.saveMonitorAlertConfig(input.config || input);
    const state = await devopsProvider.getMonitorAlertState({ ...(input || {}), queueMonitor: context.queueMonitor });
    return result(200, {
      ...state,
      config
    });
  }
  if (id === "system.monitor_alerts.ack") {
    if (typeof devopsProvider.acknowledgeMonitorAlert !== "function") {
      return result(503, { error: "监控报警确认接口不可用。" });
    }
    const alertId = String(input.alertId || input["alert-id"] || input.id || "").trim();
    return result(200, await devopsProvider.acknowledgeMonitorAlert({ ...input, alertId, queueMonitor: context.queueMonitor }));
  }

  return null;
}

async function executeSystemObservationOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "system.background_processes",
    "system.checkpoint_trees.list",
    "system.checkpoint_trees.get",
    "workspace.checkpoint.tree.list",
    "workspace.checkpoint.node.get",
    "workspace.checkpoint.diff",
    "workspace.checkpoint.restore.preview",
    "workspace.checkpoint.restore",
    "workspace.checkpoint.scope.query"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  if (id === "system.background_processes") {
    const { devopsProvider, error } = requireDevopsProvider(context);
    if (error) {
      return error;
    }
    return result(200, await devopsProvider.getBackgroundProcessStatus({ userDataPath: context.userDataPath }));
  }

  const checkpointTreeApi = context.checkpointTreeApi;
  if (!checkpointTreeApi) {
    return result(503, { error: "工作队列 checkpoint 接口未注册。" });
  }
  if (id === "system.checkpoint_trees.list" || id === "workspace.checkpoint.tree.list") {
    const trees = await checkpointTreeApi.listCheckpointTrees({
      userDataPath: context.userDataPath,
      ownerId: input.ownerId || input["owner-id"] || input.workspaceId || input["workspace-id"] || input.workspaceRef || input["workspace-ref"] || "",
      kind: input.kind || "",
      limit: Number(input.limit || 100)
    });
    return result(200, {
      schemaVersion: 1,
      count: trees.length,
      items: trees.map((tree) => checkpointTreeApi.checkpointTreeSummary(tree))
    });
  }
  if (id === "system.checkpoint_trees.get" || id === "workspace.checkpoint.node.get") {
    const treeId = String(input.treeId || input["tree-id"] || input.id || "").trim();
    const tree = await checkpointTreeApi.loadCheckpointTree({
      userDataPath: context.userDataPath,
      treeId
    });
    if (!tree) {
      return result(404, {
        error: "checkpoint tree 不存在。"
      });
    }
    return result(200, tree);
  }
  if (id === "workspace.checkpoint.diff") {
    if (typeof checkpointTreeApi.diffCheckpointTree !== "function") {
      return result(503, { error: "checkpoint diff 接口不可用。" });
    }
    try {
      return result(200, protocolPayload(await checkpointTreeApi.diffCheckpointTree({
        userDataPath: context.userDataPath,
        treeId: input.treeId || input["tree-id"] || input.id || "",
        fromTreeId: input.fromTreeId || input["from-tree-id"] || "",
        toTreeId: input.toTreeId || input["to-tree-id"] || "",
        fromNodeId: input.fromNodeId || input["from-node-id"] || "",
        toNodeId: input.toNodeId || input["to-node-id"] || ""
      })));
    } catch (error) {
      return result(404, errorPayload(error, "checkpoint diff 失败。"));
    }
  }
  if (id === "workspace.checkpoint.scope.query") {
    if (typeof checkpointTreeApi.queryCheckpointScope !== "function") {
      return result(503, { error: "checkpoint scope 接口不可用。" });
    }
    try {
      return result(200, protocolPayload(await checkpointTreeApi.queryCheckpointScope({
        userDataPath: context.userDataPath,
        treeId: input.treeId || input["tree-id"] || input.id || "",
        nodeId: input.nodeId || input["node-id"] || input.checkpointNodeId || ""
      })));
    } catch (error) {
      return result(404, errorPayload(error, "checkpoint scope 查询失败。"));
    }
  }
  if (id === "workspace.checkpoint.restore.preview") {
    if (typeof checkpointTreeApi.previewCheckpointRestore !== "function") {
      return result(503, { error: "checkpoint restore preview 接口不可用。" });
    }
    try {
      const restorePlan = await checkpointTreeApi.previewCheckpointRestore({
        userDataPath: context.userDataPath,
        treeId: input.treeId || input["tree-id"] || input.id || "",
        nodeId: input.nodeId || input["node-id"] || input.checkpointNodeId || "",
        mode: input.mode || "",
        reason: input.reason || ""
      });
      const fileRestore = await runCheckpointWorkspaceFileRestore({
        plan: restorePlan,
        input,
        context,
        dryRun: true
      });
      if (fileRestore && fileRestore.payload?.ok !== true) {
        return fileRestore;
      }
      return result(200, protocolPayload({
        ...restorePlan,
        actions: fileRestore
          ? [
              ...restorePlan.actions,
              {
                action: "restore_workspace_files",
                workspaceId: fileRestore.payload.workspaceId,
                dryRun: true
              }
            ]
          : restorePlan.actions,
        workspaceFileRestore: fileRestore?.payload
      }));
    } catch (error) {
      return result(404, errorPayload(error, "checkpoint restore preview 失败。"));
    }
  }
  if (id === "workspace.checkpoint.restore") {
    if (typeof checkpointTreeApi.restoreCheckpointTree !== "function") {
      return result(503, { error: "checkpoint restore 接口不可用。" });
    }
    try {
      const restorePlan = typeof checkpointTreeApi.previewCheckpointRestore === "function"
        ? await checkpointTreeApi.previewCheckpointRestore({
            userDataPath: context.userDataPath,
            treeId: input.treeId || input["tree-id"] || input.id || "",
            nodeId: input.nodeId || input["node-id"] || input.checkpointNodeId || "",
            mode: input.mode || "",
            reason: input.reason || ""
          })
        : null;
      const fileRestore = restorePlan
        ? await runCheckpointWorkspaceFileRestore({
            plan: restorePlan,
            input,
            context,
            dryRun: false
          })
        : null;
      if (fileRestore && fileRestore.payload?.ok !== true) {
        return fileRestore;
      }
      const markerRestore = await checkpointTreeApi.restoreCheckpointTree({
        userDataPath: context.userDataPath,
        treeId: input.treeId || input["tree-id"] || input.id || "",
        nodeId: input.nodeId || input["node-id"] || input.checkpointNodeId || "",
        actor: actorFrom(context.authSession, input),
        mode: input.mode || "",
        reason: input.reason || ""
      });
      return result(200, protocolPayload({
        ...markerRestore,
        actions: fileRestore
          ? [
              ...markerRestore.actions,
              {
                action: "restore_workspace_files",
                workspaceId: fileRestore.payload.workspaceId,
                dryRun: false
              }
            ]
          : markerRestore.actions,
        workspaceFileRestore: fileRestore?.payload
      }));
    } catch (error) {
      return result(404, errorPayload(error, "checkpoint restore 失败。"));
    }
  }

  return null;
}

async function executeJobObservationOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  if (id !== "jobs.failed_review") {
    return null;
  }
  const jobWorkflowProvider = context.jobWorkflowProvider;
  if (!jobWorkflowProvider || typeof jobWorkflowProvider.listJobs !== "function") {
    return result(503, { error: "任务工作流 provider 不可用。" });
  }
  const jobs = await jobWorkflowProvider.listJobs({
    limit: Number(input.limit || 50)
  });
  const failed = (jobs.items || []).filter((job) => job.status === "failed");
  return result(200, {
    ok: true,
    summary: jobs.summary,
    failedCount: failed.length,
    failedJobs: failed.map((job) => ({
      id: job.id,
      stage: job.stage || "",
      error: job.error || "",
      createdAt: job.createdAt || "",
      updatedAt: job.updatedAt || ""
    })),
    suggestions:
      failed.length > 0
        ? [
            "查看失败任务的输入来源与解析器路由。",
            "确认外部挂载、Tika、OCR 与模型配置是否可用。",
            "需要重跑时由管理员在任务面板或 CLI 明确触发。"
          ]
        : ["最近任务未发现失败项。"]
  });
}

async function executeSystemCoreOperation({ operationId, context }) {
  const id = String(operationId || "");
  if (!["system.health", "system.bootstrap"].includes(id)) {
    return null;
  }

  const discoveryState = context.discoveryState || {};
  if (id === "system.health") {
    return result(200, {
      ok: true,
      serverId: discoveryState.serverId,
      mode: discoveryState.mode,
      activeServiceUrl: discoveryState.activeServiceUrl
    });
  }

  const [expertVocabulary, knowledgeGuidance] = await Promise.all([
    executeKnowledgePreprocessingRulesOperation({
      operationId: "expert_vocabulary.summary",
      input: {},
      context
    }),
    executeKnowledgePreprocessingRulesOperation({
      operationId: "knowledge.guidance.summary",
      input: {},
      context
    })
  ]);
  return result(200, {
    ...buildBootstrapPayload(discoveryState),
    expertVocabulary: expertVocabulary?.payload,
    knowledgeGuidance: knowledgeGuidance?.payload,
    resolvedAt: new Date().toISOString()
  });
}

async function executeConsoleStateOperation({ operationId, context }) {
  if (operationId === "v001.baseline.status") {
    const provider = createV001BaselineProvider({ userDataPath: context.userDataPath });
    return result(200, await provider.status());
  }

  if (operationId === "runtime.info") {
    return result(200, await buildRuntimeInfo({
      userDataPath: context.userDataPath,
      distPath: context.distPath,
      runtime: context.runtime,
      moduleManagement: context.moduleManagement,
      discoveryState: context.discoveryState,
      storageProvider: context.storageProvider,
      serverUrl: context.serverUrl,
      securityPermissions: context.securityPermissions,
      request: context.request,
      features: context.features,
      consoleDomainServices: context.consoleDomainServices
    }));
  }

  if (operationId === "system.console_state") {
    return result(200, await buildConsoleState({
      userDataPath: context.userDataPath,
      distPath: context.distPath,
      runtime: context.runtime,
      moduleManagement: context.moduleManagement,
      discoveryState: context.discoveryState,
      jobWorkflowProvider: context.jobWorkflowProvider,
      storageProvider: context.storageProvider,
      serverUrl: context.serverUrl,
      securityPermissions: context.securityPermissions,
      request: context.request,
      maintenanceAgent: context.maintenanceAgent,
      clientRuntimeAllocator: context.clientRuntimeAllocator,
      features: context.features,
      toolSkillManagementProvider: context.toolSkillManagementProvider,
      consoleDomainServices: context.consoleDomainServices
    }));
  }

  return null;
}

async function executeSystemInterfaceOperation({ operationId, context }) {
  if (operationId !== "system.interfaces") {
    return null;
  }
  if (context.coreProvider && typeof context.coreProvider.buildSystemInterfaces === "function") {
    return result(200, context.coreProvider.buildSystemInterfaces({
      controllers: typeof context.getControllers === "function" ? context.getControllers() : null,
      features: typeof context.getFeatureEntries === "function" ? context.getFeatureEntries() : null
    }));
  }
  const getFeatureEntries = typeof context.getFeatureEntries === "function"
    ? context.getFeatureEntries
    : null;
  const getInterfaceCatalog = typeof context.getInterfaceCatalog === "function"
    ? context.getInterfaceCatalog
    : () => [];
  return result(200, {
    transport: {
      http: "direct",
      rpc: "POST /api/rpc",
      events: "GET /api/events"
    },
    interfaces: getInterfaceCatalog(),
    features: getFeatureEntries ? getFeatureEntries() : null
  });
}

async function executeRuntimePathBrowseOperation({ operationId, input = {}, context }) {
  if (operationId !== "runtime.path_browse") {
    return null;
  }
  const mode = normalizePathBrowserMode(input.mode);
  return result(200, await browseServerPath({
    requestedPath: input.path || input.currentPath || "",
    mode,
    extensions: normalizePathBrowserExtensions(input.extensions),
    includeHidden: Boolean(input.includeHidden),
    userDataPath: context.userDataPath,
    distPath: context.distPath
  }));
}

async function executeProductionReadinessOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "production.health",
    "architecture.live_map",
    "executive_report.list",
    "executive_report.preview",
    "executive_report.generate",
    "sample_business_pack.list",
    "sample_business_pack.get",
    "sample_business_pack.materialize"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  if (id === "production.health") {
    return result(200, await buildProductionHealthReport({
      userDataPath: context.userDataPath
    }));
  }
  if (id === "architecture.live_map") {
    return result(200, await buildArchitectureLiveMap());
  }

  if (id.startsWith("executive_report.")) {
    try {
      if (id === "executive_report.preview") {
        return result(200, await buildExecutiveReport(input));
      }
      const store = createExecutiveReportStore({ userDataPath: context.userDataPath });
      if (id === "executive_report.list") {
        return result(200, await store.list());
      }
      if (id === "executive_report.generate") {
        return result(200, await store.generate(input));
      }
    } catch (error) {
      return result(400, errorPayload(error, id === "executive_report.generate"
        ? "Executive report generation failed."
        : "Executive report preview failed."));
    }
  }

  if (id.startsWith("sample_business_pack.")) {
    const store = createSampleBusinessPackStore({ userDataPath: context.userDataPath });
    if (id === "sample_business_pack.list") {
      return result(200, store.list());
    }
    if (id === "sample_business_pack.get") {
      const pack = store.get(input.packId || input["pack-id"] || input.id || "");
      if (!pack) {
        return result(404, { ok: false, error: "Sample business pack not found." });
      }
      return result(200, pack);
    }
    if (id === "sample_business_pack.materialize") {
      try {
        return result(200, await store.materialize(input));
      } catch (error) {
        return result(400, errorPayload(error, "Sample business pack materialization failed."));
      }
    }
  }

  return null;
}

async function executeModuleEcosystemOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "module_ecosystem.templates",
    "module_ecosystem.plan",
    "module_ecosystem.scaffold",
    "module_ecosystem.contract_test"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const moduleManagement = context.moduleManagement;
  if (!moduleManagement) {
    return result(503, { error: "模块管理 provider 不可用。" });
  }

  if (id === "module_ecosystem.templates") {
    return result(200, moduleManagement.listModuleTemplates());
  }
  if (id === "module_ecosystem.plan") {
    try {
      return result(200, await moduleManagement.planModuleScaffold(input));
    } catch (error) {
      return result(400, errorPayload(error, "Module scaffold plan failed.", {
        details: error?.details || []
      }));
    }
  }
  if (id === "module_ecosystem.scaffold") {
    try {
      return result(200, await moduleManagement.scaffoldModule(input));
    } catch (error) {
      return result(400, errorPayload(error, "Module scaffold failed.", {
        details: error?.details || []
      }));
    }
  }
  if (id === "module_ecosystem.contract_test") {
    try {
      const contractResult = input.manifest
        ? moduleManagement.validateCapabilityPackageScaffoldManifest(input)
        : await moduleManagement.runModuleContractTest(input);
      return result(contractResult.ok === false ? 422 : 200, contractResult);
    } catch (error) {
      return result(400, errorPayload(error, "Module contract test failed."));
    }
  }

  return null;
}

async function executeCodexOAuthOperation({ operationId }) {
  const id = String(operationId || "");
  if (!["oauth.codex_status", "oauth.codex_login", "oauth.codex_return"].includes(id)) {
    return null;
  }
  if (id === "oauth.codex_status") {
    return result(200, await getCodexOAuthStatus());
  }
  if (id === "oauth.codex_login") {
    return result(200, await startCodexDeviceLogin());
  }
  return result(200, {
    __htmlResponse: true,
    body: `<!doctype html>
<html lang="zh-CN" translate="no" class="notranslate">
  <head><meta charset="utf-8"><meta name="google" content="notranslate"><title>Codex OAuth 验证</title></head>
  <body translate="no" class="notranslate">
    <p>Codex OAuth 验证已返回。可以关闭此页，Pact 控制台会自动刷新状态。</p>
    <script>setTimeout(() => window.close(), 800);</script>
  </body>
</html>`
  });
}

async function executeSettingsAgentGatewayOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "settings.get",
    "settings.set",
    "settings.model_probe",
    "agent_gateway.config.get",
    "agent_gateway.config.set",
    "agent_gateway.call",
    "model_routing.health",
    "agents.list",
    "agents.create",
    "agents.update",
    "agents.delete"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const settingsInput = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const agentRuntimeProvider = agentRuntimeProviderFrom(context);
  if (!agentRuntimeProvider) {
    return result(503, { error: "Agent runtime provider is not configured." });
  }
  const registry = agentConfigRegistryFrom(context);
  const requiresRegistry = id !== "model_routing.health";
  if (requiresRegistry && !registry) {
    return result(503, { error: "Agent config registry provider is not configured." });
  }

  if (id === "settings.get") {
    return result(200, await loadAgentRuntimeSettings(context, { redactSecrets: true }));
  }

  if (id === "settings.set") {
    const shouldAuditModelLibrary =
      Object.hasOwn(settingsInput, "modelLibraryAgents") ||
      Object.hasOwn(settingsInput, "modelLibraryEntries");
    const explicitModelLibraryEntries = Object.hasOwn(settingsInput, "modelLibraryEntries")
      ? new Set(
          (Array.isArray(settingsInput.modelLibraryEntries) ? settingsInput.modelLibraryEntries : [])
            .map((entry) => String(entry || "").trim())
            .filter(Boolean)
        )
      : null;
    const incomingModelLibraryAgents =
      Array.isArray(settingsInput.modelLibraryAgents) && explicitModelLibraryEntries
        ? settingsInput.modelLibraryAgents.filter((agent) =>
            explicitModelLibraryEntries.has(String(agent?.provider || "").trim())
          )
        : settingsInput.modelLibraryAgents;
    const beforeSettings = shouldAuditModelLibrary
      ? await loadAgentRuntimeSettings(context, { redactSecrets: true })
      : null;
    const beforeModelLibrarySummary = shouldAuditModelLibrary
      ? normalizeModelLibraryAuditList((beforeSettings?.modelLibraryAgents || []).concat())
      : null;
    if (Array.isArray(incomingModelLibraryAgents)) {
      await registry.replaceFromModelLibraryAgents(incomingModelLibraryAgents);
    }
    const modelLibraryAgents = Array.isArray(incomingModelLibraryAgents)
      ? incomingModelLibraryAgents
      : registry.getModelLibraryAgents();
    const settingsToSave = { ...settingsInput };
    if (shouldAuditModelLibrary) {
      settingsToSave.modelLibraryAgents = modelLibraryAgents;
      settingsToSave.modelLibraryEntries = registry.getModelLibraryEntries();
      settingsToSave.modelLibraryAgentIds = registry.getModelLibraryAgents().map((agent) => agent.uid).filter(Boolean);
    }
    const saved = await saveSettings(context.userDataPath, settingsToSave, {
      redactSecrets: false
    });
    await registry.refresh({ settingsFallback: saved });
    const runtimeSettings = shouldAuditModelLibrary
      ? {
          ...saved,
          modelLibraryAgents: registry.getModelLibraryAgents(),
          modelLibraryEntries: registry.getModelLibraryEntries()
        }
      : saved;
    if (typeof context.moduleManagement?.refreshMounts === "function") {
      await context.moduleManagement.refreshMounts({ settings: runtimeSettings });
    }
    const redactedSettings = await loadAgentRuntimeSettings(context, { redactSecrets: true });
    await publishProtocolEvent(
      context.protocolEventBus,
      "settings.current",
      redactedSettings,
      { type: "settings.updated" }
    );
    if (shouldAuditModelLibrary) {
      const afterModelLibrarySummary = normalizeModelLibraryAuditList(modelLibraryAgents);
      const modelLibraryDiff = diffModelLibraryAgents(
        (beforeModelLibrarySummary?.items || []),
        afterModelLibrarySummary.items || []
      );
      appendConsoleLog(context, {
        operationId: "settings.model_library.save",
        event: "console.settings.model_library.saved",
        authSession: context.authSession,
        status: "ok",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          path: "/api/settings",
          method: "POST",
          settingsModelLibrary: {
            before: beforeModelLibrarySummary || normalizeModelLibraryAuditList([]),
            after: afterModelLibrarySummary,
            diff: modelLibraryDiff
          }
        },
        output: {
          operation: "settings.set",
          modelLibrarySaved: true,
          savedCount: afterModelLibrarySummary.total,
          addedCount: modelLibraryDiff.added.length,
          removedCount: modelLibraryDiff.removed.length,
          changedCount: modelLibraryDiff.changed.length
        },
        actor: context.authSession
      });
    }
    return result(200, redactedSettings);
  }

  if (id === "settings.model_probe") {
    const provider = String(settingsInput.provider || settingsInput.modelProvider || "").trim();
    const modelAlias = String(
      settingsInput.modelAlias || settingsInput.agentAlias || settingsInput.agentId || settingsInput.uid || ""
    ).trim();
    const startedAt = Date.now();
    let probeResult;
    let status = "ok";
    let message = "";
    try {
      const current = await loadAgentRuntimeSettings(context);
      const candidateSettings = mergeSettingsForModelProbe(
        current,
        settingsInput.settings || settingsInput.value || {},
        provider,
        { modelAlias }
      );
      probeResult = await agentRuntimeProvider.probeModelConnection({
        provider,
        settings: candidateSettings,
        modelAlias,
        userDataPath: context.userDataPath
      });
    } catch (error) {
      status = "failed";
      message = error instanceof Error ? error.message : "模型探测失败。";
      probeResult = {
        ok: false,
        configured: false,
        provider,
        model: modelAlias,
        statusCode: 0,
        latencyMs: 0,
        checkedAt: new Date().toISOString(),
        message
      };
    }
    appendConsoleLog(context, {
      operationId: "settings.model_library.probe",
      event: "console.settings.model_library.probe",
      authSession: context.authSession,
      status,
      input: {
        actor: {
          userId: context.authSession?.user?.userId || "",
          username: context.authSession?.user?.username || ""
        },
        method: "POST",
        path: "/api/settings/model-probe",
        provider,
        modelAlias,
        modelLibraryModelCount: normalizeModelLibraryAuditList((
          settingsInput.settings?.modelLibraryAgents || []
        )).total
      },
      output: {
        provider,
        modelAlias,
        ok: Boolean(probeResult?.ok),
        configured: Boolean(probeResult?.configured),
        latencyMs: Number(probeResult?.latencyMs || 0),
        statusCode: Number(probeResult?.statusCode || 0),
        message: probeResult?.message || message || "",
        checkedAt: probeResult?.checkedAt || new Date().toISOString()
      },
      durationMs: Date.now() - startedAt,
      actor: context.authSession
    });
    return result(200, probeResult);
  }

  if (id === "agent_gateway.config.get" || id === "agent_gateway.config.set") {
    if (typeof agentRuntimeProvider.publicAgentGatewayConfig !== "function") {
      return result(503, { error: "Agent gateway runtime provider is not configured." });
    }
    if (id === "agent_gateway.config.get") {
      const settings = await loadAgentRuntimeSettings(context);
      return result(200, {
        config: await agentRuntimeProvider.publicAgentGatewayConfig(settings)
      });
    }

    const current = await loadAgentRuntimeSettings(context);
    const adapterPatch = settingsInput.value || settingsInput.config || settingsInput;
    const nextAdapter = {
      ...(current.customHttpAdapter || {}),
      ...adapterPatch
    };
    const saved = await saveSettings(context.userDataPath, {
      ...current,
      modelLibraryEntries: [
        ...new Set([...(current.modelLibraryEntries || []), "custom-http"])
      ],
      customModelAlias:
        adapterPatch.alias || adapterPatch.modelAlias || current.customModelAlias,
      customHttpAdapter: nextAdapter
    });
    const redactedSettings = await loadAgentRuntimeSettings(context, { redactSecrets: true });
    await publishProtocolEvent(
      context.protocolEventBus,
      "settings.current",
      redactedSettings,
      { type: "settings.updated" }
    );
    return result(200, {
      config: await agentRuntimeProvider.publicAgentGatewayConfig({
        ...saved,
        modelLibraryAgents: registry.getModelLibraryAgents(),
        modelLibraryEntries: registry.getModelLibraryEntries()
      })
    });
  }

  if (id === "agent_gateway.call") {
    if (typeof agentRuntimeProvider.callAgentGateway !== "function") {
      return result(503, { error: "Agent gateway runtime provider is not configured." });
    }
    const workspaceApplied = applyWorkspaceRuntimeContext(
      settingsInput,
      context.agentWorkspace,
      workspaceAccessOptions(context.authSession)
    );
    if (workspaceApplied.workspaceError) {
      return result(workspaceApplied.workspaceError.status, {
        error: workspaceApplied.workspaceError.error
      });
    }
    const settings = await loadAgentRuntimeSettings(context);
    const gatewayResult = await agentRuntimeProvider.callAgentGateway({
      settings,
      input: workspaceApplied.input,
      userDataPath: context.userDataPath,
      contextRuntime: context.contextRuntime,
      contextCompactionSource: "api.agent_gateway.call",
      clientRuntimeAllocator: context.clientRuntimeAllocator
    });
    return result(
      200,
      workspaceApplied.workspaceContext
        ? {
            ...gatewayResult,
            workspaceContext: workspaceApplied.workspaceContext
          }
        : gatewayResult
    );
  }

  if (id === "agents.list") {
    if (typeof agentRuntimeProvider.publicAgentGatewayRegistry !== "function") {
      return result(503, { error: "Agent gateway runtime provider is not configured." });
    }
    const settings = await loadAgentRuntimeSettings(context);
    return result(200, await agentRuntimeProvider.publicAgentGatewayRegistry(settings));
  }

  if (id === "model_routing.health") {
    if (typeof agentRuntimeProvider.inspectAgentModelRouting !== "function") {
      return result(503, { error: "Agent gateway runtime provider is not configured." });
    }
    return result(200, await agentRuntimeProvider.inspectAgentModelRouting({
      userDataPath: context.userDataPath,
      limit: Number(settingsInput.limit || 50)
    }));
  }

  if (id === "agents.create") {
    const startedAt = Date.now();
    const patch = normalizeAgentModelPayload(settingsInput);
    const provider = patch.provider || "deepseek";
    const model = patch.model || patch.engine || "";
    const current = await loadAgentRuntimeSettings(context);
    const fallbackLabel = `${provider} ${model}`.trim();
    const entry = {
      provider,
      ...patch,
      uid: patch.uid || createAgentUid({ ...patch, provider, model }),
      label: Object.hasOwn(patch, "label") ? patch.label : fallbackLabel,
      agentName: Object.hasOwn(patch, "agentName")
        ? patch.agentName
        : (Object.hasOwn(patch, "label") ? patch.label : fallbackLabel),
      model,
      engine: Object.hasOwn(patch, "engine") ? patch.engine : model
    };
    const models = [entry, ...(current.modelLibraryAgents || [])];
    try {
      const { registry: gatewayRegistry } = await saveAgentModelLibrary(context, current, models);
      const agent = gatewayRegistry.agents.find((item) => item.alias === entry.uid) || null;
      appendConsoleLog(context, {
        operationId: "settings.model_library.create",
        event: "console.settings.model_library.created",
        authSession: context.authSession,
        status: "ok",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "POST",
          path: "/api/agents",
          agent: {
            uid: entry.uid,
            provider: entry.provider,
            model: entry.model,
            baseUrl: entry.baseUrl || entry.url || "",
            label: entry.label || entry.agentName || ""
          }
        },
        output: {
          ok: true,
          action: "created",
          agentId: entry.uid,
          registryVersion: gatewayRegistry.version || null,
          savedCount: gatewayRegistry.agents?.length || 0
        },
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(200, {
        ok: true,
        action: "created",
        agentId: entry.uid,
        agent,
        registry: gatewayRegistry
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建智能体模型配置失败。";
      appendConsoleLog(context, {
        operationId: "settings.model_library.create",
        event: "console.settings.model_library.create_failed",
        authSession: context.authSession,
        status: "failed",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "POST",
          path: "/api/agents",
          agent: {
            provider,
            model,
            label: entry.label || entry.agentName || ""
          }
        },
        error: message,
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(500, { error: message });
    }
  }

  if (id === "agents.update") {
    const startedAt = Date.now();
    const agentId = settingsInput.agentId;
    const patch = normalizeAgentModelPayload(settingsInput);
    const current = await loadAgentRuntimeSettings(context);
    const models = [...(current.modelLibraryAgents || [])];
    const index = findAgentModelIndex(models, agentId);
    if (index < 0) {
      const message = "智能体模型配置不存在。";
      appendConsoleLog(context, {
        operationId: "settings.model_library.update",
        event: "console.settings.model_library.update_failed",
        authSession: context.authSession,
        status: "failed",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "POST",
          path: `/api/agents/${String(agentId || "")}`,
          agentId: String(agentId || "")
        },
        error: message,
        output: { notFound: true },
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(404, { error: message });
    }
    const previous = models[index];
    const next = {
      ...previous,
      ...patch,
      uid: previous.uid || previous.instanceId || previous.alias || String(agentId || ""),
      instanceId: previous.instanceId || previous.uid || previous.alias || String(agentId || ""),
      alias: previous.alias || previous.uid || previous.instanceId || String(agentId || "")
    };
    if (Object.hasOwn(patch, "label") && !Object.hasOwn(patch, "agentName")) {
      next.agentName = patch.label;
    }
    if (Object.hasOwn(patch, "model") && !Object.hasOwn(patch, "engine")) {
      next.engine = patch.model;
    }
    models[index] = next;
    try {
      const { registry: gatewayRegistry } = await saveAgentModelLibrary(context, current, models);
      const agent = gatewayRegistry.agents.find((item) => item.alias === next.uid) || null;
      appendConsoleLog(context, {
        operationId: "settings.model_library.update",
        event: "console.settings.model_library.updated",
        authSession: context.authSession,
        status: "ok",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "POST",
          path: `/api/agents/${String(agentId || "")}`,
          previous: normalizeModelLibraryAgentAuditAgent(previous),
          patch: sanitizeAgentPatchForLog(patch),
          next: {
            uid: next.uid,
            provider: next.provider,
            model: next.model || next.engine,
            modelAlias: next.agentName || next.label || "",
            baseUrl: next.baseUrl || next.url || ""
          }
        },
        output: {
          ok: true,
          action: "updated",
          agentId: next.uid,
          registryVersion: gatewayRegistry.version || null,
          savedCount: gatewayRegistry.agents?.length || 0
        },
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(200, {
        ok: true,
        action: "updated",
        agentId: next.uid,
        agent,
        registry: gatewayRegistry
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新智能体模型配置失败。";
      appendConsoleLog(context, {
        operationId: "settings.model_library.update",
        event: "console.settings.model_library.update_failed",
        authSession: context.authSession,
        status: "failed",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "POST",
          path: `/api/agents/${String(agentId || "")}`,
          patch: sanitizeAgentPatchForLog(patch),
          agentId: next.uid
        },
        output: {
          ok: false,
          action: "updated",
          agentId: next.uid
        },
        error: message,
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(500, { error: message });
    }
  }

  if (id === "agents.delete") {
    const startedAt = Date.now();
    const agentId = settingsInput.agentId;
    const current = await loadAgentRuntimeSettings(context);
    const models = [...(current.modelLibraryAgents || [])];
    const index = findAgentModelIndex(models, agentId);
    const normalizedAgentId = String(agentId || "").trim();
    if (index < 0) {
      const message = "智能体模型配置不存在。";
      appendConsoleLog(context, {
        operationId: "settings.model_library.delete",
        event: "console.settings.model_library.delete_failed",
        authSession: context.authSession,
        status: "failed",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "DELETE",
          path: `/api/agents/${normalizedAgentId}`,
          agentId: normalizedAgentId
        },
        error: message,
        output: { notFound: true },
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(404, { error: message });
    }
    const [removed] = models.splice(index, 1);
    try {
      const { registry: gatewayRegistry } = await saveAgentModelLibrary(context, current, models);
      appendConsoleLog(context, {
        operationId: "settings.model_library.delete",
        event: "console.settings.model_library.deleted",
        authSession: context.authSession,
        status: "ok",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "DELETE",
          path: `/api/agents/${normalizedAgentId}`,
          agent: normalizeModelLibraryAgentAuditAgent(removed)
        },
        output: {
          ok: true,
          action: "deleted",
          agentId: removed.uid || removed.instanceId || removed.alias || normalizedAgentId,
          registryVersion: gatewayRegistry.version || null,
          savedCount: gatewayRegistry.agents?.length || 0
        },
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(200, {
        ok: true,
        action: "deleted",
        agentId: removed.uid || removed.instanceId || removed.alias || String(agentId || ""),
        registry: gatewayRegistry
      });
    } catch (error) {
      const removedAgentId = removed.uid || removed.instanceId || removed.alias || normalizedAgentId;
      const message = error instanceof Error ? error.message : "删除智能体模型配置失败。";
      appendConsoleLog(context, {
        operationId: "settings.model_library.delete",
        event: "console.settings.model_library.delete_failed",
        authSession: context.authSession,
        status: "failed",
        risk: "content_write",
        input: {
          actor: {
            userId: context.authSession?.user?.userId || "",
            username: context.authSession?.user?.username || ""
          },
          method: "DELETE",
          path: `/api/agents/${normalizedAgentId}`,
          agentId: removedAgentId
        },
        output: {
          ok: false,
          action: "deleted",
          agentId: removedAgentId
        },
        error: message,
        durationMs: Date.now() - startedAt,
        actor: context.authSession
      });
      return result(500, { error: message });
    }
  }

  return null;
}

async function executeConsoleAuthOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "auth.session",
    "auth.login",
    "auth.logout",
    "auth.users",
    "auth.users.create",
    "auth.users.update",
    "auth.roles.get",
    "auth.oidc.get",
    "auth.oidc.set",
    "auth.audit",
    "auth.audit.export",
    "auth.audit.retention.get",
    "auth.audit.retention.set",
    "auth.audit.prune",
    "auth.sessions",
    "auth.sessions.rotate",
    "auth.sessions.revoke",
    "observability.trace.get"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const authProvider = context.securityPermissions;
  if (!authProvider) {
    return result(503, { error: "控制台认证模块不可用。" });
  }
  const request = context.request || null;
  const authSession = context.authSession || null;

  if (id === "auth.session") {
    return result(200, authProvider.getConsoleSummary
      ? authProvider.getConsoleSummary(request)
      : authProvider.getSummary(request));
  }
  if (id === "auth.login") {
    const inputSummary = loginInputSummary(input, request);
    try {
      const login = await authProvider.login(input, request);
      authProvider.audit({
        user: login.session?.user,
        operationId: "auth.login",
        action: "login",
        method: "POST",
        path: "/api/auth/login",
        status: "ok"
      });
      appendConsoleLog(context, {
        operationId: "auth.login.session",
        event: "console.auth.login.succeeded",
        authSession: login.session,
        status: "ok",
        input: inputSummary,
        output: {
          userId: login.session?.user?.userId || "",
          username: login.session?.user?.username || "",
          roleId: login.session?.user?.roleId || "",
          expiresAt: login.session?.expiresAt || ""
        }
      });
      return result(200, {
        __headers: { "Set-Cookie": login.cookies },
        ok: true,
        session: login.session,
        csrfToken: login.csrfToken,
        roles: authProvider.roleList()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败。";
      authProvider.audit({
        operationId: "auth.login",
        action: "login",
        method: "POST",
        path: "/api/auth/login",
        status: "failed",
        target: inputSummary,
        error: message
      });
      appendConsoleLog(context, {
        operationId: "auth.login.session",
        event: "console.auth.login.failed",
        status: "failed",
        input: inputSummary,
        error: message
      });
      return result(401, { error: message });
    }
  }
  if (id === "auth.logout") {
    const operationResult = authProvider.logout(request);
    authProvider.audit({
      user: authSession?.user,
      operationId: "auth.logout",
      action: "logout",
      method: "POST",
      path: "/api/auth/logout",
      status: "ok"
    });
    appendConsoleLog(context, {
      operationId: "auth.logout.session",
      event: "console.auth.logout.succeeded",
      authSession,
      status: "ok",
      input: {
        userId: authSession?.user?.userId || "",
        username: authSession?.user?.username || "",
        roleId: authSession?.user?.roleId || ""
      }
    });
    return result(200, {
      __headers: { "Set-Cookie": operationResult.cookies },
      ok: true
    });
  }
  if (id === "auth.users") {
    return result(200, {
      users: authProvider.listUsers(),
      roles: authProvider.roleList()
    });
  }
  if (id === "auth.users.create") {
    return result(405, {
      error: "用户创建和初始密码设置仅允许在服务端命令行执行。"
    });
  }
  if (id === "auth.users.update") {
    try {
      if (input.password || input.newPassword) {
        return result(405, {
          error: "密码修改仅允许在服务端命令行执行。"
        });
      }
      const userId = String(input.userId || input["user-id"] || input.id || "").trim();
      const user = await authProvider.updateUser(userId, input);
      if (!user) {
        return result(404, { error: "用户不存在。" });
      }
      authProvider.audit({
        user: authSession?.user,
        operationId: "auth.users.update",
        action: "update-user",
        method: "POST",
        path: `/api/auth/users/${userId}`,
        status: "ok",
        target: { userId: user.userId, roleId: user.roleId, enabled: user.enabled }
      });
      return result(200, { user, users: authProvider.listUsers() });
    } catch (error) {
      return result(400, {
        error: error instanceof Error ? error.message : "更新用户失败。"
      });
    }
  }
  if (id === "auth.roles.get") {
    const roleId = String(input.roleId || input["role-id"] || input.id || "").trim();
    const role = authProvider.roleList().find((item) => item.roleId === roleId);
    if (!role) {
      return result(404, { error: "角色不存在。" });
    }
    return result(200, { role });
  }
  if (id === "auth.oidc.get") {
    return result(200, { oidc: authProvider.getOidcConfig() });
  }
  if (id === "auth.oidc.set") {
    const oidc = authProvider.setOidcConfig(input);
    authProvider.audit({
      user: authSession?.user,
      operationId: "auth.oidc",
      action: "set-oidc",
      method: "POST",
      path: "/api/auth/oidc",
      status: "ok",
      target: { enabled: oidc.enabled, issuer: oidc.issuer, clientId: oidc.clientId }
    });
    return result(200, { oidc });
  }
  if (id === "auth.audit") {
    const query = {
      limit: Number(input.limit || 100),
      operationId: input.operationId || input["operation-id"] || "",
      userId: input.userId || input["user-id"] || "",
      status: input.status || "",
      traceId: input.traceId || input["trace-id"] || "",
      tenantId: input.tenantId || input["tenant-id"] || "",
      createdFrom: input.createdFrom || input["created-from"] || "",
      createdTo: input.createdTo || input["created-to"] || ""
    };
    if (context.operationAuditStore) {
      return result(200, {
        items: context.operationAuditStore.list(query)
      });
    }
    return result(200, {
      items: authProvider.listAudit({
        limit: query.limit,
        userId: query.userId,
        status: query.status
      })
    });
  }
  if (id === "auth.audit.export") {
    if (!context.operationAuditStore?.exportRedacted) {
      return result(503, { error: "系统审计导出接口不可用。" });
    }
    const exportResult = context.operationAuditStore.exportRedacted({
      limit: Number(input.limit || 100),
      operationId: input.operationId || input["operation-id"] || "",
      userId: input.userId || input["user-id"] || "",
      status: input.status || "",
      traceId: input.traceId || input["trace-id"] || "",
      tenantId: input.tenantId || input["tenant-id"] || "",
      createdFrom: input.createdFrom || input["created-from"] || "",
      createdTo: input.createdTo || input["created-to"] || ""
    });
    authProvider.audit({
      user: authSession?.user,
      operationId: "auth.audit.export",
      action: "export-audit",
      method: "GET",
      path: "/api/auth/audit/export",
      status: "ok",
      target: exportResult.manifest
    });
    return result(200, {
      export: {
        manifest: exportResult.manifest,
        items: exportResult.items,
        jsonl: exportResult.jsonl
      }
    });
  }
  if (id === "auth.audit.retention.get") {
    if (!context.operationAuditStore?.getRetentionPolicy) {
      return result(503, { error: "系统审计保留策略接口不可用。" });
    }
    return result(200, { policy: context.operationAuditStore.getRetentionPolicy() });
  }
  if (id === "auth.audit.retention.set") {
    if (!context.operationAuditStore?.setRetentionPolicy) {
      return result(503, { error: "系统审计保留策略接口不可用。" });
    }
    const policy = context.operationAuditStore.setRetentionPolicy({
      retentionDays: input.retentionDays || input["retention-days"],
      maxExportItems: input.maxExportItems || input["max-export-items"],
      updatedBy: authSession?.user || {}
    });
    authProvider.audit({
      user: authSession?.user,
      operationId: "auth.audit.retention.set",
      action: "set-audit-retention",
      method: "POST",
      path: "/api/auth/audit/retention",
      status: "ok",
      target: policy
    });
    return result(200, { policy });
  }
  if (id === "auth.audit.prune") {
    if (!context.operationAuditStore?.pruneExpired) {
      return result(503, { error: "系统审计清理接口不可用。" });
    }
    const prune = context.operationAuditStore.pruneExpired({
      retentionDays: input.retentionDays || input["retention-days"]
    });
    authProvider.audit({
      user: authSession?.user,
      operationId: "auth.audit.prune",
      action: "prune-audit",
      method: "POST",
      path: "/api/auth/audit/prune",
      status: "ok",
      target: prune
    });
    return result(200, { prune });
  }
  if (id === "observability.trace.get") {
    if (!context.operationAuditStore?.getTrace) {
      return result(503, { error: "trace 查询接口不可用。" });
    }
    const traceId = String(input.traceId || input["trace-id"] || input.id || "").trim();
    const trace = context.operationAuditStore.getTrace(traceId, {
      limit: Number(input.limit || 200),
      tenantId: input.tenantId || input["tenant-id"] || ""
    });
    const authorizationDecisions = authProvider.listDecisions
      ? authProvider.listDecisions({
          traceId,
          limit: Number(input.limit || 200),
          tenantId: input.tenantId || input["tenant-id"] || ""
        })
      : [];
    return result(200, {
      ...trace,
      authorizationDecisions,
      authorizationDecisionCount: authorizationDecisions.length
    });
  }
  if (id === "auth.sessions") {
    return result(200, { sessions: authProvider.listSessions() });
  }
  if (id === "auth.sessions.rotate") {
    const operationResult = authProvider.rotateSession(request);
    if (!operationResult.ok) {
      return result(operationResult.status || 401, { error: operationResult.error || "会话轮换失败。" });
    }
    authProvider.audit({
      user: operationResult.session?.user || authSession?.user,
      operationId: "auth.sessions.rotate",
      action: "rotate-session",
      method: "POST",
      path: "/api/auth/sessions/rotate",
      status: "ok",
      target: {
        sessionId: operationResult.session?.sessionId || "",
        rotatedAt: operationResult.rotatedAt || ""
      }
    });
    appendConsoleLog(context, {
      operationId: "auth.sessions.rotate",
      event: "console.auth.session.rotated",
      authSession: operationResult.session,
      status: "ok",
      input: {
        sessionId: operationResult.session?.sessionId || ""
      }
    });
    return result(200, {
      __headers: { "Set-Cookie": operationResult.cookies },
      ok: true,
      session: operationResult.session,
      csrfToken: operationResult.csrfToken,
      rotatedAt: operationResult.rotatedAt
    });
  }
  if (id === "auth.sessions.revoke") {
    const sessionId = String(input.sessionId || input["session-id"] || input.id || "").trim();
    const operationResult = authProvider.revokeSession(sessionId);
    authProvider.audit({
      user: authSession?.user,
      operationId: "auth.sessions.revoke",
      action: "revoke-session",
      method: "POST",
      path: `/api/auth/sessions/${sessionId}/revoke`,
      status: operationResult.ok ? "ok" : "not_found",
      target: { sessionId }
    });
    return result(operationResult.ok ? 200 : 404, operationResult.ok ? operationResult : { error: "会话不存在。" });
  }

  return null;
}

async function executeWorkspaceAuditOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  if (!["workspace.audit.query", "workspace.operation.history", "workspace.operation.revert.scope"].includes(id)) {
    return null;
  }

  const items = context.operationAuditStore?.list
    ? context.operationAuditStore.list({
        limit: Number(input.limit || 100),
        operationId: input.operationId || input["operation-id"] || "",
        status: input.status || ""
      })
    : [];
  if (id === "workspace.operation.revert.scope") {
    const auditId = String(input.auditId || input["audit-id"] || "").trim();
    const selectedItems = auditId
      ? items.filter((item) => item.auditId === auditId)
      : items.slice(0, Math.max(1, Math.min(Number(input.limit || 20), 100)));
    const reversibleItems = selectedItems.filter((item) =>
      item.readOnly !== true &&
      !["denied", "failed", "error"].includes(String(item.status || "").toLowerCase())
    );
    return result(200, protocolPayload({
      protocolVersion: "pact.workspace-operation-revert-scope.v1",
      requestedAuditId: auditId,
      operationId: input.operationId || input["operation-id"] || "",
      candidateCount: selectedItems.length,
      reversibleCount: reversibleItems.length,
      canApply: reversibleItems.length > 0,
      mode: "preview",
      scope: reversibleItems.map((item) => ({
        auditId: item.auditId,
        operationId: item.operationId,
        transport: item.transport,
        risk: item.risk,
        status: item.status,
        createdAt: item.createdAt,
        inputHash: item.inputHash,
        actor: item.actor || {}
      })),
      actions: reversibleItems.map((item) => ({
        action: "manual_revert_required",
        auditId: item.auditId,
        operationId: item.operationId,
        reason: "Operation audit log records scope and input hash, but domain-specific rollback must execute through the owning protocol."
      }))
    }));
  }
  return result(200, protocolPayload({ items, count: items.length }));
}

async function executeAuthorizationFacadeOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "authorization.subject.resolve",
    "authorization.policy.evaluate",
    "authorization.governance.summary",
    "authorization.roles.list",
    "authorization.roles.upsert",
    "authorization.teams.list",
    "authorization.teams.upsert",
    "authorization.users.policies.list",
    "authorization.users.policy.upsert",
    "authorization.agent_groups.list",
    "authorization.agent_groups.upsert",
    "authorization.agents.bindings.list",
    "authorization.agents.binding.upsert",
    "authorization.approvals.list",
    "authorization.approvals.upsert",
    "authorization.approvals.revoke",
    "authorization.receipts.list",
    "authorization.loan_records.list",
    "authorization.denied_requests.list",
    "workspace.asset.policy.set",
    "workspace.asset.permission.check"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const securityPermissions = context.securityPermissions;

  if (id === "authorization.subject.resolve") {
    if (!securityPermissions || typeof securityPermissions.resolveSubject !== "function") {
      return result(503, { error: "授权主体解析接口不可用。" });
    }
    const subject = securityPermissions.resolveSubject({
      subject: input.subject,
      actor: input.actor,
      authSession: context.authSession
    });
    return result(200, protocolPayload({
      protocolVersion: AUTHORIZATION_PROTOCOL_VERSION,
      subject
    }));
  }

  if (id === "authorization.policy.evaluate") {
    if (!securityPermissions || typeof securityPermissions.evaluatePolicy !== "function") {
      return result(503, { error: "授权策略裁决接口不可用。" });
    }
    const decision = securityPermissions.evaluatePolicy({
      operation: input.operation || {
        id: input.operationId || id,
        requiredScopes: input.requiredScopes || [],
        safety: input.safety || { risk: input.risk || "read_only" },
        readOnly: input.readOnly !== false
      },
      tool: input.tool || null,
      grant: input.grant || null,
      profile: input.profile || null,
      subject: input.subject || null,
      authSession: context.authSession,
      request: context.request,
      input,
      governanceRequired: input.governanceRequired === true,
      context: {
        resource: input.resource,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        repoId: input.repoId,
        targetProvider: input.targetProvider || input.provider,
        agentId: input.agentId,
        profileId: input.profileId || input.agentProfileId,
        agentProfileId: input.agentProfileId || input.profileId,
        boundUserId: input.boundUserId,
        userId: input.userId,
        teamIds: input.teamIds,
        requestedAction: input.requestedAction,
        requestedEgress: input.requestedEgress
      }
    });
    return result(200, protocolPayload({
      protocolVersion: AUTHORIZATION_PROTOCOL_VERSION,
      decision
    }));
  }

  if (id === "authorization.governance.summary") {
    if (!securityPermissions || typeof securityPermissions.getGovernanceSummary !== "function") {
      return result(503, { error: "统一权限治理存储不可用。" });
    }
    return result(200, protocolPayload({
      protocolVersion: SECURITY_PERMISSIONS_PROTOCOL_VERSION,
      governance: securityPermissions.getGovernanceSummary()
    }));
  }

  if (id === "authorization.roles.list") {
    const items = securityPermissions?.listGovernanceRoles?.() || [];
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.roles.upsert") {
    if (!securityPermissions?.upsertGovernanceRole) {
      return result(503, { error: "权限角色存储不可用。" });
    }
    const role = securityPermissions.upsertGovernanceRole(input);
    return result(200, protocolPayload({ role }));
  }

  if (id === "authorization.teams.list") {
    const items = securityPermissions?.listGovernanceTeams?.() || [];
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.teams.upsert") {
    if (!securityPermissions?.upsertGovernanceTeam) {
      return result(503, { error: "权限团队存储不可用。" });
    }
    const team = securityPermissions.upsertGovernanceTeam(input);
    return result(200, protocolPayload({ team }));
  }

  if (id === "authorization.users.policies.list") {
    const items = securityPermissions?.listGovernanceUserPolicies?.() || [];
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.users.policy.upsert") {
    if (!securityPermissions?.upsertGovernanceUserPolicy) {
      return result(503, { error: "用户授权策略存储不可用。" });
    }
    const userPolicy = securityPermissions.upsertGovernanceUserPolicy(input);
    return result(200, protocolPayload({ userPolicy }));
  }

  if (id === "authorization.agent_groups.list") {
    const items = securityPermissions?.listGovernanceAgentGroups?.() || [];
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.agent_groups.upsert") {
    if (!securityPermissions?.upsertGovernanceAgentGroup) {
      return result(503, { error: "智能体分组存储不可用。" });
    }
    const agentGroup = securityPermissions.upsertGovernanceAgentGroup(input);
    return result(200, protocolPayload({ agentGroup }));
  }

  if (id === "authorization.agents.bindings.list") {
    const items = securityPermissions?.listGovernanceAgentBindings?.() || [];
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.agents.binding.upsert") {
    if (!securityPermissions?.upsertGovernanceAgentBinding) {
      return result(503, { error: "智能体绑定存储不可用。" });
    }
    const agentBinding = securityPermissions.upsertGovernanceAgentBinding(input);
    return result(200, protocolPayload({ agentBinding }));
  }

  if (id === "authorization.approvals.list") {
    const items = securityPermissions?.listGovernanceApprovals?.({
      userId: input.userId || input["user-id"] || "",
      agentId: input.agentId || input["agent-id"] || "",
      includeRevoked: input.includeRevoked === true || input.includeRevoked === "true" || input["include-revoked"] === "true"
    }) || [];
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.approvals.upsert") {
    if (!securityPermissions?.upsertGovernanceApproval) {
      return result(503, { error: "审批授权存储不可用。" });
    }
    const approval = securityPermissions.upsertGovernanceApproval(input);
    return result(200, protocolPayload({ approval }));
  }

  if (id === "authorization.approvals.revoke") {
    if (!securityPermissions?.revokeGovernanceApproval) {
      return result(503, { error: "审批授权存储不可用。" });
    }
    const approval = securityPermissions.revokeGovernanceApproval(input.approvalId || input.id, input.reason || "");
    return approval
      ? result(200, protocolPayload({ approval }))
      : result(404, { error: "审批授权不存在。" });
  }

  if (id === "authorization.receipts.list") {
    if (!securityPermissions || typeof securityPermissions.listReceipts !== "function") {
      return result(503, { error: "授权回执存储不可用。" });
    }
    const items = securityPermissions.listReceipts({
      limit: input.limit || 100,
      subjectId: input.subjectId || input["subject-id"] || ""
    });
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.loan_records.list") {
    if (!securityPermissions || typeof securityPermissions.listLoanRecords !== "function") {
      return result(503, { error: "授权借用记录存储不可用。" });
    }
    const items = securityPermissions.listLoanRecords({
      limit: input.limit || 100,
      subjectId: input.subjectId || input["subject-id"] || ""
    });
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "authorization.denied_requests.list") {
    if (!securityPermissions || typeof securityPermissions.listDeniedRequests !== "function") {
      return result(503, { error: "授权拒绝请求存储不可用。" });
    }
    const items = securityPermissions.listDeniedRequests({
      limit: input.limit || 100,
      subjectId: input.subjectId || input["subject-id"] || "",
      tenantId: input.tenantId || input["tenant-id"] || "",
      workspaceId: input.workspaceId || input["workspace-id"] || "",
      operationId: input.operationId || input["operation-id"] || "",
      toolId: input.toolId || input["tool-id"] || "",
      reasonCode: input.reasonCode || input["reason-code"] || ""
    });
    return result(200, protocolPayload({ items, count: items.length }));
  }

  if (id === "workspace.asset.policy.set") {
    if (!securityPermissions || typeof securityPermissions.setWorkspaceAssetPolicy !== "function") {
      return result(503, { error: "工作空间资产策略 provider 不可用。" });
    }
    const policy = securityPermissions.setWorkspaceAssetPolicy({
      ...input,
      workspaceId: workspaceIdFrom(input)
    });
    return result(200, protocolPayload({ policy }));
  }

  if (id === "workspace.asset.permission.check") {
    if (!securityPermissions || typeof securityPermissions.checkWorkspaceAssetPermission !== "function") {
      return result(503, { error: "授权策略裁决接口不可用。" });
    }
    const decision = securityPermissions.checkWorkspaceAssetPermission({
      ...input,
      request: context.request,
      authSession: context.authSession
    });
    return result(200, protocolPayload({ decision }));
  }

  return null;
}

async function executeAgentSyncOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "events.subscribe",
    "agent_sync.config.get",
    "agent_sync.config.set",
    "agent_sync.publish",
    "agent_sync.subscribe"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const policy = await loadAgentSyncPolicy(context);
  const protocolEventBus = context.protocolEventBus;

  if (id === "agent_sync.config.get") {
    return result(200, {
      config: await policy.loadAgentSyncConfig(context.userDataPath)
    });
  }

  if (id === "agent_sync.config.set") {
    const saved = await policy.saveAgentSyncConfig(
      context.userDataPath,
      input.value || input.config || input
    );
    await publishProtocolEvent(
      protocolEventBus,
      "agent_sync.config",
      saved,
      { type: "agent_sync.config.updated" }
    );
    return result(200, { config: saved });
  }

  if (id === "agent_sync.publish") {
    const authorization = await authorizeToolSkillScopes({
      provider: context.toolSkillManagementProvider,
      request: context.request,
      scopes: ["agent_sync:publish"]
    });
    if (!authorization.ok) {
      return result(authorization.status || 403, {
        error: authorization.error || "工具权限不足。"
      });
    }
    const publishResult = await policy.publishAgentSyncEvent({
      userDataPath: context.userDataPath,
      protocolEventBus,
      input,
      grant: authorization.grant
    });
    if (!publishResult.ok) {
      return result(publishResult.status || 400, {
        error: publishResult.error || "发布智能体同步事件失败。"
      });
    }
    return result(200, publishResult);
  }

  if (!protocolEventBus || typeof protocolEventBus.subscribe !== "function") {
    return result(503, { error: "事件总线不可用。" });
  }

  const subscriptionInput = normalizeAgentSubscriptionInput(input);
  const config = await policy.loadAgentSyncConfig(context.userDataPath);
  const cursor = subscriptionInput.cursor;
  const includeSnapshot = subscriptionInput.includeSnapshot;
  const timeoutMs = subscriptionInput.timeoutMs;
  const limit = subscriptionInput.limit;

  if (id === "events.subscribe") {
    const topicFilter = policy.filterRequestedSubscriptionTopics(config, subscriptionInput.topics || []);
    if (topicFilter.denyAll) {
      return result(200, {
        cursor,
        nextCursor: cursor,
        topics: topicFilter.topics,
        requestedTopics: topicFilter.requested,
        events: [],
        snapshots: includeSnapshot ? [] : undefined
      });
    }
    const abortController = new AbortController();
    context.response?.once?.("close", () => abortController.abort());
    const subscriptionResult = await protocolEventBus.subscribe({
      cursor,
      topics: topicFilter.topics,
      timeoutMs,
      limit,
      includeSnapshot,
      signal: context.request?.aborted ? AbortSignal.abort() : abortController.signal
    });
    if (context.response?.destroyed) {
      return result(200, { __responseHandled: true });
    }
    return result(200, {
      ...policy.filterAgentSyncSubscriptionResult(config, subscriptionResult),
      requestedTopics: topicFilter.requested
    });
  }

  const requested = (subscriptionInput.topics || []).map((topic) => policy.normalizeAgentSyncTopic(topic));
  const topicFilter = policy.filterRequestedSubscriptionTopics(config, requested);
  if (topicFilter.denyAll) {
    return result(200, {
      cursor,
      nextCursor: cursor,
      topics: [],
      requestedTopics: topicFilter.requested,
      events: [],
      snapshots: includeSnapshot ? [] : undefined
    });
  }
  const abortController = new AbortController();
  context.response?.once?.("close", () => abortController.abort());
  const subscriptionResult = await protocolEventBus.subscribe({
    cursor,
    topics: topicFilter.topics.length > 0
      ? topicFilter.topics
      : config.topics.filter((topic) => topic.enabled).map((topic) => topic.topic),
    timeoutMs,
    limit,
    includeSnapshot,
    signal: context.request?.aborted ? AbortSignal.abort() : undefined
  });
  if (context.response?.destroyed) {
    return result(200, { __responseHandled: true });
  }
  return result(200, {
    ...policy.filterAgentSyncSubscriptionResult(config, subscriptionResult),
    requestedTopics: topicFilter.requested
  });
}

async function executeToolManagementAuthorizationOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "authorization.grants.create",
    "authorization.grants.revoke",
    "tool_management.mcp.request_authorization",
    "tool_management.mcp.list_requests",
    "tool_management.mcp.resolve_request"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const provider = context.toolSkillManagementProvider;
  if (!provider) {
    return result(503, { error: "Tool/Skill management provider is unavailable." });
  }

  if (id === "authorization.grants.create") {
    const grantResult = await provider.createAuthorizationGrant(input);
    return result(201, protocolPayload({
      protocolVersion: AUTHORIZATION_PROTOCOL_VERSION,
      grant: grantResult.grant,
      token: grantResult.token
    }));
  }

  if (id === "authorization.grants.revoke") {
    const grant = await provider.revokeAuthorizationGrant(input);
    if (!grant) {
      return result(404, { error: "授权 grant 不存在。" });
    }
    return result(200, protocolPayload({
      protocolVersion: AUTHORIZATION_PROTOCOL_VERSION,
      grant
    }));
  }

  if (id === "tool_management.mcp.request_authorization") {
    return result(200, provider.createMcpAuthorizationRequest(input, {
      request: context.request || null
    }));
  }

  if (id === "tool_management.mcp.list_requests") {
    return result(200, {
      requests: provider.listMcpAuthorizationRequests(input)
    });
  }

  if (id === "tool_management.mcp.resolve_request") {
    const { success, grantId } = await provider.resolveMcpAuthorizationRequest(input);
    if (!success) {
      return result(404, { error: "Request not found or already resolved." });
    }
    return result(200, { ok: true, grantId });
  }

  return null;
}

async function executeToolManagementPassthroughOperation({ operationId, context }) {
  const id = String(operationId || "tool_management.http.passthrough");
  if (id !== "tool_management.http.passthrough" && !id.startsWith("tool_management.")) {
    return null;
  }

  const provider = context.toolSkillManagementProvider;
  if (!provider?.handleToolManagementHttpRequest) {
    return result(503, { error: "Tool/Skill management provider is unavailable." });
  }

  const handled = await provider.handleToolManagementHttpRequest({
    request: context.request,
    response: context.response,
    requestBody: context.requestBody,
    url: context.url,
    method: context.method || context.request?.method || "GET",
    dispatched: true
  });
  if (!handled) {
    return result(404, { error: "Tool Management API route not found." });
  }
  return result(200, { __responseHandled: true });
}

async function executeStrategyManagementOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "strategy.describe",
    "strategy.workflow_policy.evaluate",
    "strategy.agent_policy.evaluate",
    "strategy.tool_policy.preview"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const { strategyManagementProvider, error } = requireStrategyManagementProvider(context);
  if (error) {
    return error;
  }
  if (id === "strategy.describe") {
    return result(200, strategyManagementProvider.describe());
  }
  if (id === "strategy.workflow_policy.evaluate") {
    return result(200, strategyManagementProvider.evaluateWorkflowPolicy(input));
  }
  if (id === "strategy.agent_policy.evaluate") {
    return result(200, strategyManagementProvider.evaluateAgentPolicy(input));
  }
  if (id === "strategy.tool_policy.preview") {
    return result(200, {
      schemaVersion: 1,
      decision: strategyManagementProvider.evaluateToolPolicy(input)
    });
  }
  return null;
}

async function executeKnowledgeGraphOperation({ operationId, input = {}, context }) {
  if (operationId !== "knowledge.graph") {
    return null;
  }
  if (!context.metadataStore?.getKnowledgeGraph) {
    return result(503, { error: "知识图谱存储不可用。" });
  }
  return result(200, context.metadataStore.getKnowledgeGraph({
    seed: input.seed || input.id || "",
    depth: Number(input.depth || 1),
    limit: Number(input.limit || 120)
  }));
}

async function executeRuntimeMountOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "runtime.mounts",
    "runtime.set_mounts",
    "runtime.reload_mounts"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const moduleManagement = context.moduleManagement;
  if (!moduleManagement) {
    return result(503, { error: "模块管理 provider 不可用。" });
  }

  if (id === "runtime.mounts") {
    return result(200, await moduleManagement.getMountsSnapshot({
      features: context.features,
      listAvailableAnalysisModules: context.consoleDomainServices?.listAvailableAnalysisModules
    }));
  }

  if (id === "runtime.set_mounts") {
    const operationResult = await moduleManagement.setMounts(input?.value || input);
    if (operationResult.ok === false) {
      const { statusCode = 400, ...payload } = operationResult;
      return result(statusCode, payload);
    }
    await publishProtocolEvent(
      context.protocolEventBus,
      "runtime.mounts",
      operationResult,
      { type: "runtime.mounts.updated" }
    );
    return result(200, operationResult);
  }

  if (id === "runtime.reload_mounts") {
    const operationResult = await moduleManagement.reloadMounts(input);
    if (operationResult.ok === false) {
      const { statusCode = 400, ...payload } = operationResult;
      return result(statusCode, payload);
    }
    await publishProtocolEvent(
      context.protocolEventBus,
      "runtime.mounts",
      operationResult,
      { type: "runtime.mounts.reloaded" }
    );
    return result(200, operationResult);
  }

  return null;
}

function hasClientSuppliedString(value, keys) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return keys.some((key) => typeof value[key] === "string" && value[key].trim());
}

function clientVersionString(value) {
  const text = String(value || "").trim().slice(0, 80);
  return /^[A-Za-z0-9._:@+ -]*$/.test(text) ? text : hashClientString(text, "client.version");
}

function stripClientDiscoveryStrings(value = {}) {
  return {
    mode: value.mode === "forward" ? "forward" : "active",
    refreshIntervalSeconds: value.refreshIntervalSeconds,
    checkInIntervalSeconds: value.checkInIntervalSeconds,
    offlineAfterSeconds: value.offlineAfterSeconds
  };
}

async function executeDiscoveryOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "discovery.check_in",
    "discovery.clients",
    "discovery.clients.migration",
    "discovery.get_config",
    "discovery.set_config"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const discoveryState = context.discoveryState || {};

  if (id === "discovery.check_in") {
    const { storageProvider, error } = requireStorageProvider(context);
    if (error) {
      return error;
    }
    if (typeof storageProvider.recordClientCheckIn !== "function") {
      return result(503, { error: "客户端登记存储不可用。" });
    }
    const clientId = serverToken(
      "client",
      input.clientId || input.hostname || input.currentServiceUrl || "anonymous"
    );
    const record = storageProvider.recordClientCheckIn({
      clientId,
      clientLabel: hashClientString(input.clientLabel || input.hostname || clientId, "client.label"),
      appVersion: clientVersionString(input.appVersion || ""),
      platform: hashClientString(input.platform || "", "client.platform"),
      hostname: hashClientString(input.hostname || "", "client.hostname"),
      bootstrapUrl: "",
      currentServiceUrl: hashClientString(input.currentServiceUrl || "", "service.url"),
      desiredServiceUrl: hashClientString(discoveryState.activeServiceUrl || "", "service.url"),
      currentJobServiceUrl: input.currentJobServiceUrl
        ? hashClientString(input.currentJobServiceUrl || "", "service.url")
        : "",
      configVersion: clientVersionString(input.configVersion || ""),
      busy: Boolean(input.busy),
      lastJobId: hashClientString(input.lastJobId || "", "client.last_job_id"),
      lastError: hashClientString(input.lastError || "", "client.last_error"),
      serverId: discoveryState.serverId,
      offlineAfterSeconds: discoveryState.offlineAfterSeconds
    });
    await publishProtocolEvent(
      context.protocolEventBus,
      "discovery.clients",
      {
        client: record,
        serverId: discoveryState.serverId
      },
      { type: "discovery.client.checked_in" }
    );
    const [expertVocabulary, knowledgeGuidance] = await Promise.all([
      executeKnowledgePreprocessingRulesOperation({
        operationId: "expert_vocabulary.summary",
        input: {},
        context
      }),
      executeKnowledgePreprocessingRulesOperation({
        operationId: "knowledge.guidance.summary",
        input: {},
        context
      })
    ]);
    return result(200, {
      ok: true,
      client: record,
      bootstrap: {
        ...buildBootstrapPayload(discoveryState),
        expertVocabulary: expertVocabulary?.payload || {},
        knowledgeGuidance: knowledgeGuidance?.payload || {}
      }
    });
  }

  if (id === "discovery.clients") {
    const { storageProvider, error } = requireStorageProvider(context);
    if (error) {
      return error;
    }
    if (typeof storageProvider.listClientRegistrations !== "function") {
      return result(503, { error: "客户端登记存储不可用。" });
    }
    const domainServices = context.consoleDomainServices || {};
    return result(200, buildClientConnectionList(
      storageProvider.listClientRegistrations({
        offlineAfterSeconds: discoveryState.offlineAfterSeconds
      }),
      typeof domainServices.buildToolManagementClientConnectionRows === "function"
        ? await domainServices.buildToolManagementClientConnectionRows(context.toolSkillManagementProvider, {
            offlineAfterSeconds: discoveryState.offlineAfterSeconds
          })
        : []
    ));
  }

  if (id === "discovery.clients.migration") {
    const { storageProvider, error } = requireStorageProvider(context);
    if (error) {
      return error;
    }
    if (typeof storageProvider.findClientRegistration !== "function") {
      return result(503, { error: "客户端登记存储不可用。" });
    }
    const targetClientId = String(input.clientId || input["client-id"] || input.id || "").trim();
    if (!targetClientId) {
      return result(400, { error: "缺少客户端 ID。" });
    }
    const client = storageProvider.findClientRegistration({
      clientId: targetClientId,
      offlineAfterSeconds: discoveryState.offlineAfterSeconds
    });
    if (!client) {
      return result(404, { error: "未找到目标客户端。" });
    }
    const command = {
      schemaVersion: 1,
      command: "migrate_to_active_service",
      clientId: targetClientId,
      desiredServiceUrl: discoveryState.activeServiceUrl || "",
      configVersion: discoveryState.configVersion || "",
      serverId: discoveryState.serverId || "",
      requestedAt: new Date().toISOString(),
      reason: String(input.reason || "console").trim() || "console",
      requestedBy: context.authSession?.user?.username || "console"
    };
    const event = await publishProtocolEvent(
      context.protocolEventBus,
      `discovery.client.migration.${targetClientId}`,
      { client, command },
      {
        type: "discovery.client.migration.requested",
        publisher: "console",
        retain: true
      }
    );
    await publishProtocolEvent(
      context.protocolEventBus,
      "discovery.client.migration",
      {
        clientId: targetClientId,
        command
      },
      {
        type: "discovery.client.migration.requested",
        publisher: "console",
        retain: true
      }
    );
    return result(200, {
      ok: true,
      client,
      command,
      event
    });
  }

  if (id === "discovery.get_config") {
    return result(200, {
      path: getDiscoveryConfigPath(context.userDataPath),
      value: discoveryState,
      bootstrap: buildBootstrapPayload(discoveryState)
    });
  }

  if (id === "discovery.set_config") {
    const value = input?.value || input;
    if (
      hasClientSuppliedString(value, [
        "bootstrapBaseUrl",
        "advertisedBaseUrl",
        "activeServiceUrl",
        "forwardBaseUrl",
        "serverId",
        "serverLabel",
        "configVersion"
      ])
    ) {
      return result(400, {
        error: "discovery 配置不接受客户端传入的 URL、服务标识或标签字符串。"
      });
    }
    const nextDiscoveryState = await saveDiscoveryConfig(
      context.userDataPath,
      stripClientDiscoveryStrings(value),
      {
        listenUrl: context.listenUrl,
        serverLabel: context.serverLabel
      }
    );
    if (typeof context.setDiscoveryState === "function") {
      context.setDiscoveryState(nextDiscoveryState);
    }
    await publishProtocolEvent(
      context.protocolEventBus,
      "discovery.config",
      {
        value: nextDiscoveryState,
        bootstrap: buildBootstrapPayload(nextDiscoveryState)
      },
      { type: "discovery.config.updated" }
    );
    return result(200, {
      path: getDiscoveryConfigPath(context.userDataPath),
      value: nextDiscoveryState,
      bootstrap: buildBootstrapPayload(nextDiscoveryState)
    });
  }

  return null;
}

async function executeMaintenanceAgentOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "maintenance_agent.config.get",
    "maintenance_agent.config.set",
    "maintenance_agent.chat",
    "maintenance_agent.runs.create",
    "maintenance_agent.runs.list",
    "maintenance_agent.runs.get",
    "maintenance_agent.runs.approve",
    "maintenance_agent.runs.cancel"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const maintenanceAgent = context.maintenanceAgent;
  if (!maintenanceAgent) {
    return result(503, { error: "维护智能体模块不可用。" });
  }
  const authSession = context.authSession || null;
  try {
    if (id === "maintenance_agent.config.get") {
      return result(200, await maintenanceAgent.getConfig());
    }
    if (id === "maintenance_agent.config.set") {
      return result(200, await maintenanceAgent.setConfig(input.config || input.value || input, {
        authSession
      }));
    }
    if (id === "maintenance_agent.chat") {
      return result(200, await maintenanceAgent.chat(input, { authSession }));
    }
    if (id === "maintenance_agent.runs.list") {
      return result(200, await maintenanceAgent.listRuns({
        limit: Number(input.limit || 50)
      }));
    }
    if (id === "maintenance_agent.runs.create") {
      return result(200, await maintenanceAgent.startRun(input, { authSession }));
    }
    if (id === "maintenance_agent.runs.get") {
      const runId = String(input.runId || input["run-id"] || input.id || "").trim();
      const run = await maintenanceAgent.getRun(runId);
      if (!run) {
        return result(404, { error: "维护运行不存在。" });
      }
      return result(200, { run });
    }
    if (id === "maintenance_agent.runs.approve") {
      const runId = String(input.runId || input["run-id"] || input.id || "").trim();
      const run = await maintenanceAgent.approveRun(runId, input, { authSession });
      if (!run) {
        return result(404, { error: "维护运行不存在。" });
      }
      return result(200, { run });
    }
    if (id === "maintenance_agent.runs.cancel") {
      const runId = String(input.runId || input["run-id"] || input.id || "").trim();
      const run = await maintenanceAgent.cancelRun(runId, input, { authSession });
      if (!run) {
        return result(404, { error: "维护运行不存在。" });
      }
      return result(200, { run });
    }
  } catch (error) {
    const status = id === "maintenance_agent.runs.approve" ? 409 : 400;
    const fallbackByOperation = {
      "maintenance_agent.config.set": "维护智能体配置保存失败。",
      "maintenance_agent.chat": "维护智能体对话失败。",
      "maintenance_agent.runs.create": "维护智能体运行创建失败。",
      "maintenance_agent.runs.approve": "维护运行审批失败。",
      "maintenance_agent.runs.cancel": "维护运行取消失败。"
    };
    return result(status, errorPayload(error, fallbackByOperation[id] || "维护智能体操作失败。"));
  }

  return null;
}

async function executeGoldenRuleOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.golden_rules.list",
    "knowledge.golden_rules.save",
    "knowledge.golden_rules.publish",
    "knowledge.golden_rules.rollback",
    "knowledge.rule_authoring.chat",
    "knowledge.rule_authoring.runs.get",
    "knowledge.gold_cases.list",
    "knowledge.gold_cases.save",
    "knowledge.training_sets.export"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  if (id.startsWith("knowledge.rule_authoring.")) {
    const runtime = context.knowledgeRuleAuthoringRuntime;
    if (!runtime) {
      return result(503, { error: "规则生成智能体运行时不可用。" });
    }
    if (id === "knowledge.rule_authoring.chat") {
      const operationResult = await runtime.chat(input);
      await publishProtocolEvent(context.protocolEventBus, "knowledge.rule_authoring", operationResult, {
        type: "knowledge.rule_authoring.completed"
      });
      return result(200, operationResult);
    }
    if (id === "knowledge.rule_authoring.runs.get") {
      const operationResult = await runtime.getRun({ runId: input.runId || input["run-id"] || input.id || "" });
      if (!operationResult) {
        return result(404, { error: "规则生成运行不存在。" });
      }
      return result(200, operationResult);
    }
  }

  const runtime = context.goldenRuleRuntime;
  if (!runtime) {
    const unavailable = id.startsWith("knowledge.gold_cases.")
      ? "黄金样本运行时不可用。"
      : id === "knowledge.training_sets.export"
        ? "训练集导出运行时不可用。"
        : "黄金规则运行时不可用。";
    return result(503, { error: unavailable });
  }

  if (id === "knowledge.golden_rules.list") {
    const operationResult = await runtime.listRulePackages();
    if (parseBooleanFlag(input.includeRules ?? input["include-rules"], false)) {
      const packages = [];
      for (const item of Array.isArray(operationResult.items) ? operationResult.items : []) {
        const rulePackage = await runtime.getRulePackage({
          packageId: item.packageId,
          version: item.activeVersion
        });
        if (rulePackage) {
          packages.push(rulePackage);
        }
      }
      return result(200, {
        ...operationResult,
        packages
      });
    }
    return result(200, operationResult);
  }

  if (id === "knowledge.golden_rules.save") {
    return result(200, await runtime.saveRulePackage(input));
  }

  if (id === "knowledge.golden_rules.publish") {
    const operationResult = await runtime.publishRulePackage({
      ...input,
      packageId: input.packageId || input["package-id"] || input.id || ""
    });
    if (!operationResult) {
      return result(404, { error: "黄金规则包不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.golden_rules", operationResult, {
      type: "knowledge.golden_rules.published"
    });
    return result(200, operationResult);
  }

  if (id === "knowledge.golden_rules.rollback") {
    const operationResult = await runtime.rollbackRulePackage({
      ...input,
      packageId: input.packageId || input["package-id"] || input.id || ""
    });
    if (!operationResult) {
      return result(404, { error: "黄金规则包不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.golden_rules", operationResult, {
      type: "knowledge.golden_rules.rollback"
    });
    return result(200, operationResult);
  }

  if (id === "knowledge.gold_cases.list") {
    return result(200, await runtime.listGoldCases({
      limit: Number(input.limit || 100),
      tag: input.tag || ""
    }));
  }

  if (id === "knowledge.gold_cases.save") {
    const operationResult = await runtime.saveGoldCase(input);
    await publishProtocolEvent(context.protocolEventBus, "knowledge.gold_cases", operationResult, {
      type: "knowledge.gold_case.saved"
    });
    return result(200, operationResult);
  }

  if (id === "knowledge.training_sets.export") {
    return result(200, await runtime.exportTrainingSet(input));
  }

  return null;
}

async function executeKnowledgeSkillOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.skills.list",
    "knowledge.skills.get",
    "knowledge.skills.generate",
    "knowledge.skills.propose",
    "knowledge.skills.resolve",
    "knowledge.skills.framework",
    "knowledge.skills.framework_save",
    "knowledge.skills.evaluation.runs.create",
    "knowledge.skills.deployments.create",
    "knowledge.skills.deployments.rollback"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const runtime = context.knowledgeSkillRuntime;
  if (!runtime) {
    return result(503, { error: "知识 Skill 运行时不可用。" });
  }

  if (id === "knowledge.skills.list") {
    return result(200, runtime.listSkills({
      status: input.status || "",
      query: input.query || input.q || "",
      limit: Number(input.limit || 50)
    }));
  }

  if (id === "knowledge.skills.get") {
    const skill = runtime.getSkill(input.skillId || input["skill-id"] || input.id || "");
    if (!skill) {
      return result(404, { error: "知识 Skill 不存在。" });
    }
    return result(200, skill);
  }

  if (id === "knowledge.skills.generate") {
    return result(201, await runtime.generateSkill(input));
  }

  if (id === "knowledge.skills.propose") {
    return result(201, await runtime.proposeSkill(input));
  }

  if (id === "knowledge.skills.resolve") {
    const operationResult = runtime.resolveSkill({
      ...input,
      skillId: input.skillId || input["skill-id"] || input.id || ""
    });
    if (!operationResult) {
      return result(404, { error: "知识 Skill 不存在。" });
    }
    if (
      operationResult.ok !== false &&
      context.goldenRuleRuntime &&
      ["publish", "accept", "published", "reject", "rejected"].includes(String(operationResult.action || "").trim())
    ) {
      try {
        await context.goldenRuleRuntime.saveGoldCaseFromSkillResolution({
          skill: operationResult.skill,
          action: operationResult.action
        });
      } catch {
        // Gold-case creation must not block the human review action.
      }
    }
    return result(operationResult.ok === false ? 409 : 200, operationResult);
  }

  if (id === "knowledge.skills.framework") {
    return result(200, {
      protocolVersion: runtime.protocolVersion,
      framework: await runtime.loadFramework()
    });
  }

  if (id === "knowledge.skills.framework_save") {
    return result(200, await runtime.saveFramework(input));
  }

  if (id === "knowledge.skills.evaluation.runs.create") {
    return result(201, await runtime.runSkillEvaluation(input));
  }

  if (id === "knowledge.skills.deployments.create") {
    const operationResult = await runtime.createSkillDeployment(input);
    await publishProtocolEvent(context.protocolEventBus, "knowledge.skill_deployments", operationResult, {
      type: "knowledge.skill_deployment.created"
    });
    return result(operationResult?.ok === false ? 409 : 201, operationResult);
  }

  if (id === "knowledge.skills.deployments.rollback") {
    const operationResult = await runtime.rollbackSkillDeployment({
      ...input,
      deploymentId: input.deploymentId || input["deployment-id"] || input.id || ""
    });
    if (!operationResult) {
      return result(404, { error: "SkillSet 部署不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.skill_deployments", operationResult, {
      type: "knowledge.skill_deployment.rollback"
    });
    return result(200, operationResult);
  }

  return null;
}

async function executeKnowledgeAgentSupportOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.evidence_gate.evaluate",
    "knowledge.agent_skill.describe",
    "knowledge.agent_skill.plan",
    "knowledge.agent_skill.run"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  if (id === "knowledge.evidence_gate.evaluate") {
    const gate = context.evidenceSufficiencyGate;
    if (!gate || typeof gate.evaluate !== "function") {
      return result(503, { error: "证据充分性门禁不可用。" });
    }
    return result(200, gate.evaluate(input));
  }

  const runtime = context.knowledgeAgentSkill;
  if (!runtime) {
    return result(503, { error: "知识库智能体技能不可用。" });
  }
  if (id === "knowledge.agent_skill.describe") {
    return result(200, runtime.describe());
  }
  if (id === "knowledge.agent_skill.plan") {
    return result(200, runtime.plan(input));
  }
  if (id === "knowledge.agent_skill.run") {
    return result(200, await runtime.run(input));
  }
  return null;
}

function knowledgeBackendSubject(context = {}, input = {}) {
  const authSubject = subjectFromAuthSession(context.authSession);
  const requestedSubject = input.subject && typeof input.subject === "object" && !Array.isArray(input.subject)
    ? input.subject
    : (input.subjectId || input["subject-id"] || input.username)
      ? {
          subjectId: input.subjectId || input["subject-id"] || input.username,
          username: input.username || input.subjectId || input["subject-id"] || ""
        }
    : null;
  if (!requestedSubject) {
    return authSubject;
  }
  return {
    ...authSubject,
    ...requestedSubject,
    subjectId: requestedSubject.subjectId || requestedSubject.id || requestedSubject.username || authSubject.subjectId,
    username: requestedSubject.username || authSubject.username,
    type: requestedSubject.type || authSubject.type
  };
}

function knowledgeBackendProviderRequested(input = {}) {
  const provider = String(input.provider || input.backend || input.knowledgeBackendProvider || "").trim().toLowerCase();
  return provider === "dify" || provider === "ragflow" || provider === "rag-flow";
}

function knowledgeBackendSearchRequested(input = {}) {
  return Boolean(
    input.knowledgeBackend === true ||
    input.externalKnowledgeBase === true ||
    input.backendRef ||
    input.spaceId ||
    input.derivedKnowledgeSpace ||
    knowledgeBackendProviderRequested(input)
  );
}

async function executeKnowledgeBackendOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.backend.connect",
    "knowledge.space.list",
    "knowledge.export.request",
    "knowledge.permission.request"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const port = knowledgeBackendPortFor(context);
  const subject = knowledgeBackendSubject(context, input);
  const workspaceId = workspaceIdFrom(input);
  try {
    if (id === "knowledge.backend.connect") {
      return result(200, await port.connect(input));
    }
    if (id === "knowledge.space.list") {
      return result(200, await port.listSpaces(input));
    }
    if (id === "knowledge.export.request") {
      const operationResult = await port.requestExport(input, { subject, workspaceId });
      appendKnowledgeAccessDecisionArtifacts(context, operationResult.accessDecision, id);
      return result(operationResult.httpStatus || 200, operationResult);
    }
    if (id === "knowledge.permission.request") {
      return result(201, await port.requestPermission(input, { subject, workspaceId }));
    }
  } catch (error) {
    const status = error?.code === "UNSUPPORTED_PROVIDER" ? 404 : 400;
    return result(status, errorPayload(error, "Knowledge backend operation failed."));
  }
  return null;
}

async function executeCloudDriveOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "sharedspace.drive.connect",
    "sharedspace.drive.status",
    "sharedspace.drive.item.list",
    "sharedspace.drive.file.download",
    "sharedspace.drive.file.upload",
    "sharedspace.drive.sync.plan",
    "sharedspace.drive.sync.apply",
    "sharedspace.drive.permission.list"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const port = cloudDrivePortFor(context);
  const operationInput = {
    ...input,
    workspaceId: workspaceIdFrom(input),
    operationId: id
  };
  try {
    if (id === "sharedspace.drive.connect") {
      return result(200, await port.connect(operationInput));
    }
    if (id === "sharedspace.drive.status") {
      return result(200, await port.status(operationInput));
    }
    if (id === "sharedspace.drive.item.list") {
      return result(200, await port.listItems(operationInput));
    }
    if (id === "sharedspace.drive.file.download") {
      return result(200, await port.downloadFile(operationInput));
    }
    if (id === "sharedspace.drive.file.upload") {
      return result(201, await port.uploadFile(operationInput));
    }
    if (id === "sharedspace.drive.sync.plan") {
      return result(200, await port.syncPlan(operationInput));
    }
    if (id === "sharedspace.drive.sync.apply") {
      return result(200, await port.syncApply(operationInput));
    }
    if (id === "sharedspace.drive.permission.list") {
      return result(200, await port.permissionList(operationInput));
    }
  } catch (error) {
    const status = error?.code === "UNSUPPORTED_PROVIDER" || error?.code === "DRIVE_CONNECTION_NOT_FOUND" ? 404 : 400;
    return result(status, errorPayload(error, "Cloud drive operation failed."));
  }
  return null;
}

async function executeKnowledgeEvaluationOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.evaluation.runs.create",
    "knowledge.evaluation.runs.list",
    "knowledge.evaluation.runs.get",
    "knowledge.model_roles",
    "knowledge.model_decision"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  if (id === "knowledge.model_roles" || id === "knowledge.model_decision") {
    const runtime = typeof context.strategyManagementProvider?.createModelDecisionRuntimePort === "function"
      ? context.strategyManagementProvider.createModelDecisionRuntimePort()
      : context.modelDecisionRuntime;
    if (!runtime) {
      return result(503, { error: "模型决策运行时不可用。" });
    }
    if (id === "knowledge.model_roles") {
      return result(200, runtime.describe());
    }
    return result(200, await runtime.decide(input));
  }

  const runtime = context.agentEvaluationRuntime;
  if (!runtime) {
    return result(503, { error: "智能体评估运行时不可用。" });
  }
  if (id === "knowledge.evaluation.runs.create") {
    return result(201, await runtime.runEvaluation(input));
  }
  if (id === "knowledge.evaluation.runs.list") {
    return result(200, await runtime.listRuns({ limit: Number(input.limit || 50) }));
  }
  if (id === "knowledge.evaluation.runs.get") {
    const operationResult = await runtime.getRun(input.runId || input["run-id"] || input.id || "");
    if (!operationResult) {
      return result(404, { error: "智能体评估任务不存在。" });
    }
    return result(200, operationResult);
  }
  return null;
}

async function executeKnowledgeEvolutionOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.evolution.describe",
    "knowledge.evolution.runs.create",
    "knowledge.evolution.runs.list",
    "knowledge.evolution.runs.get",
    "knowledge.hierarchy.audit",
    "knowledge.evolution.deployments.list",
    "knowledge.evolution.deployments.promote",
    "knowledge.evolution.deployments.rollback"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const runtime = context.knowledgeEvolutionRuntime;
  if (!runtime) {
    return result(503, { error: "知识进化运行时不可用。" });
  }
  if (id === "knowledge.evolution.describe") {
    return result(200, runtime.describe());
  }
  if (id === "knowledge.evolution.runs.create") {
    return result(201, await runtime.runEvolution(input));
  }
  if (id === "knowledge.evolution.runs.list") {
    return result(200, await runtime.listRuns({ limit: Number(input.limit || 50) }));
  }
  if (id === "knowledge.evolution.runs.get") {
    const operationResult = await runtime.getRun(input.runId || input["run-id"] || input.id || "");
    if (!operationResult) {
      return result(404, { error: "知识进化任务不存在。" });
    }
    return result(200, operationResult);
  }
  if (id === "knowledge.hierarchy.audit") {
    return result(200, await runtime.auditHierarchy(input));
  }
  if (id === "knowledge.evolution.deployments.list") {
    return result(200, runtime.listDeployments({
      status: input.status || "",
      limit: Number(input.limit || 50)
    }));
  }
  if (id === "knowledge.evolution.deployments.promote") {
    return result(200, await runtime.promote({
      ...input,
      deploymentId: input.deploymentId || input["deployment-id"] || input.id || ""
    }));
  }
  if (id === "knowledge.evolution.deployments.rollback") {
    return result(200, await runtime.rollback({
      ...input,
      deploymentId: input.deploymentId || input["deployment-id"] || input.id || ""
    }));
  }
  return null;
}

async function executeKnowledgeSummarizationOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.summarization.runs.create",
    "knowledge.summarization.runs.get",
    "knowledge.summarization.runs.approve"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const runtime = context.summarizationRuntime;
  if (!runtime) {
    return result(503, { error: "多智能体总结运行时不可用。" });
  }
  const runId = input.runId || input["run-id"] || input.id || "";
  if (id === "knowledge.summarization.runs.create") {
    const operationResult = await runtime.startRun(input);
    return result(operationResult?.run?.status === "failed" ? 500 : 201, operationResult);
  }
  if (id === "knowledge.summarization.runs.get") {
    const operationResult = runtime.getRun(runId, {
      includePrivate: parseBooleanFlag(input.includePrivate ?? input["include-private"] ?? input.private, false)
    });
    if (!operationResult) {
      return result(404, { error: "总结任务不存在。" });
    }
    return result(200, operationResult);
  }
  if (id === "knowledge.summarization.runs.approve") {
    const operationResult = await runtime.approveRun({
      ...input,
      runId
    });
    if (!operationResult) {
      return result(404, { error: "总结任务不存在。" });
    }
    return result(200, operationResult);
  }
  return null;
}

async function externalKnowledgeDistillationClient({ input = {}, context = {} } = {}) {
  const settings = await loadSettings(context.userDataPath);
  const config = resolveExternalKnowledgeDistillationConfig({
    input,
    settings
  });
  return createExternalKnowledgeDistillationClient(config);
}

async function executeExternalKnowledgeDistillationOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "external.knowledge.distillation.service.health",
    "external.knowledge.distillation.service.capabilities",
    "external.knowledge.distillation.service.runtime_health",
    "external.knowledge.distillation.runs.list",
    "external.knowledge.distillation.runs.create",
    "external.knowledge.distillation.runs.get",
    "external.knowledge.distillation.runs.cancel",
    "external.knowledge.distillation.evidence.query",
    "external.knowledge.distillation.projects.evidence.query",
    "external.knowledge.distillation.artifacts.export"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  try {
    const client = await externalKnowledgeDistillationClient({ input, context });
    if (id === "external.knowledge.distillation.service.health") {
      const operationResult = await client.health();
      return result(200, {
        ...operationResult,
        pactRegistration: {
          namespace: "external.knowledge.distillation",
          baseUrl: client.baseUrl
        }
      });
    }
    if (id === "external.knowledge.distillation.service.capabilities") {
      const operationResult = await client.capabilities();
      return result(200, {
        ...operationResult,
        pactRegistration: {
          namespace: "external.knowledge.distillation",
          baseUrl: client.baseUrl
        }
      });
    }
    if (id === "external.knowledge.distillation.service.runtime_health") {
      const operationResult = await client.runtimeHealth();
      return result(200, {
        ...operationResult,
        pactRegistration: {
          namespace: "external.knowledge.distillation",
          baseUrl: client.baseUrl
        }
      });
    }
    if (id === "external.knowledge.distillation.runs.list") {
      return result(200, await client.listRuns(input));
    }
    if (id === "external.knowledge.distillation.runs.create") {
      const operationResult = await client.createRun(input);
      await publishProtocolEvent(context.protocolEventBus, "external.knowledge.distillation", operationResult, {
        type: "external.knowledge.distillation.created"
      });
      return result(201, operationResult);
    }
    if (id === "external.knowledge.distillation.runs.get") {
      return result(200, await client.getRun(input));
    }
    if (id === "external.knowledge.distillation.runs.cancel") {
      const operationResult = await client.cancelRun(input);
      await publishProtocolEvent(context.protocolEventBus, "external.knowledge.distillation", operationResult, {
        type: "external.knowledge.distillation.canceled"
      });
      return result(202, operationResult);
    }
    if (id === "external.knowledge.distillation.evidence.query") {
      return result(200, await client.queryEvidence(input));
    }
    if (id === "external.knowledge.distillation.projects.evidence.query") {
      return result(200, await client.queryProjectEvidence(input));
    }
    if (id === "external.knowledge.distillation.artifacts.export") {
      const operationResult = await client.exportArtifact(input);
      const externalCall = operationResult.pactExternalServiceCall || {};
      return result(200, {
        __binaryResponse: true,
        contentType: operationResult.contentType,
        disposition: "attachment",
        fileName: operationResult.fileName,
        buffer: operationResult.buffer,
        headers: {
          "X-Pact-External-Service": "external.knowledge.distillation",
          "X-Pact-External-Service-Duration-Ms": String(externalCall.durationMs || 0),
          "X-Pact-External-Service-Transfer-Bytes": String(externalCall.transferBytes || 0),
          "X-Pact-External-Service-Bytes-Per-Second": String(externalCall.bytesPerSecond || 0)
        }
      });
    }
  } catch (error) {
    const status = Number(error?.statusCode || 502);
    return result(status >= 400 && status < 600 ? status : 502, errorPayload(error, "外部知识蒸馏服务调用失败。", {
      service: "external.knowledge.distillation",
      pactExternalServiceCall: error?.externalServiceCall || null
    }));
  }

  return null;
}

async function executeKnowledgeDistillationWorkflowOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.distillation.runs.create",
    "knowledge.distillation.runs.get",
    "knowledge.distillation.workbench.runs.list",
    "knowledge.distillation.workbench.runs.create",
    "knowledge.distillation.workbench.runs.get",
    "knowledge.distillation.workbench.runs.resume",
    "knowledge.distillation.workbench.runs.cancel",
    "knowledge.distillation.workbench.runs.archive",
    "knowledge.distillation.workbench.runs.delete",
    "knowledge.distillation.workbench.stage.rerun",
    "knowledge.distillation.workbench.stage.export",
    "knowledge.distillation.workbench.runs.package",
    "knowledge.distillation.workbench.runs.compare"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  return result(410, internalKnowledgeDistillationRemovedPayload(id));

  if (id === "knowledge.distillation.runs.create" || id === "knowledge.distillation.runs.get") {
    const runtime = context.knowledgeDistillationRuntime;
    if (!runtime) {
      return result(503, { error: "知识蒸馏运行时不可用。" });
    }
    if (id === "knowledge.distillation.runs.create") {
      const operationResult = await runtime.runDistillation(input);
      await publishProtocolEvent(context.protocolEventBus, "knowledge.distillation", operationResult, {
        type: "knowledge.distillation.completed"
      });
      return result(201, operationResult);
    }
    const operationResult = await runtime.getRun({ runId: input.runId || input["run-id"] || input.id || "" });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏任务不存在。" });
    }
    return result(200, operationResult);
  }

  const workbench = getKnowledgeDistillationWorkbench(context);
  if (!workbench) {
    return result(503, { error: "知识蒸馏工作台运行时不可用。" });
  }
  const runId = input.runId || input["run-id"] || input.id || "";

  if (id === "knowledge.distillation.workbench.runs.list") {
    return result(200, await workbench.listRuns({
      limit: Number(input.limit || 50),
      includeArchived: parseBooleanFlag(input.includeArchived ?? input["include-archived"], false)
    }));
  }

  if (id === "knowledge.distillation.workbench.runs.create") {
    const operationResult = await workbench.createRun(input);
    await publishProtocolEvent(context.protocolEventBus, "knowledge.distillation.workbench", operationResult, {
      type: "knowledge.distillation.workbench.created"
    });
    return result(202, operationResult);
  }

  if (id === "knowledge.distillation.workbench.runs.get") {
    const operationResult = await workbench.getRun({ runId });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台任务不存在。" });
    }
    return result(200, operationResult);
  }

  if (id === "knowledge.distillation.workbench.runs.resume") {
    const operationResult = await workbench.resumeRun({ runId });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台任务不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.distillation.workbench", operationResult, {
      type: "knowledge.distillation.workbench.resumed"
    });
    return result(202, operationResult);
  }

  if (id === "knowledge.distillation.workbench.runs.cancel") {
    const operationResult = await workbench.cancelRun({
      runId,
      reason: input.reason || input.message || ""
    });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台任务不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.distillation.workbench", operationResult, {
      type: "knowledge.distillation.workbench.canceled"
    });
    return result(202, operationResult);
  }

  if (id === "knowledge.distillation.workbench.runs.archive") {
    const operationResult = await workbench.archiveRun({ runId });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台任务不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.distillation.workbench", operationResult, {
      type: "knowledge.distillation.workbench.archived"
    });
    return result(202, operationResult);
  }

  if (id === "knowledge.distillation.workbench.runs.delete") {
    const operationResult = await workbench.deleteRun({ runId });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台任务不存在。" });
    }
    await publishProtocolEvent(context.protocolEventBus, "knowledge.distillation.workbench", operationResult, {
      type: "knowledge.distillation.workbench.deleted"
    });
    return result(200, operationResult);
  }

  if (id === "knowledge.distillation.workbench.stage.rerun") {
    try {
      const operationResult = await workbench.rerunStage({
        runId,
        stageId: input.stageId || input["stage-id"] || input.stage || ""
      });
      if (!operationResult) {
        return result(404, { error: "知识蒸馏工作台任务不存在。" });
      }
      await publishProtocolEvent(context.protocolEventBus, "knowledge.distillation.workbench", operationResult, {
        type: "knowledge.distillation.workbench.stage.rerun"
      });
      return result(202, operationResult);
    } catch (error) {
      return result(error?.code === "UNKNOWN_STAGE" ? 400 : 500, {
        error: error instanceof Error ? error.message : "重跑知识蒸馏阶段失败。"
      });
    }
  }

  if (id === "knowledge.distillation.workbench.stage.export") {
    const operationResult = await workbench.exportStage({
      runId,
      stageId: input.stageId || input["stage-id"] || input.stage || "",
      format: input.format || "markdown"
    });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台阶段导出不存在。" });
    }
    return result(200, {
      __binaryResponse: true,
      contentType: operationResult.contentType,
      disposition: "attachment",
      fileName: operationResult.fileName,
      buffer: operationResult.buffer,
      headers: { "X-Pact-Knowledge-Export": "distillation-workbench" }
    });
  }

  if (id === "knowledge.distillation.workbench.runs.artifacts") {
    const operationResult = await workbench.listRunArtifacts({ runId });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台产物信息不存在。" });
    }
    return result(200, operationResult);
  }

  if (id === "knowledge.distillation.workbench.runs.package") {
    const operationResult = await workbench.exportRunPackage({ runId });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台整包导出不存在。" });
    }
    return result(200, {
      __binaryResponse: true,
      contentType: operationResult.contentType,
      disposition: "attachment",
      fileName: operationResult.fileName,
      buffer: operationResult.buffer,
      headers: { "X-Pact-Knowledge-Export": "distillation-workbench-package" }
    });
  }

  if (id === "knowledge.distillation.workbench.runs.compare") {
    const operationResult = await workbench.compareRuns({
      leftRunId: runId,
      rightRunId: input.rightRunId || input["right-run-id"] || input.right || ""
    });
    if (!operationResult) {
      return result(404, { error: "知识蒸馏工作台比较对象不存在。" });
    }
    return result(200, operationResult);
  }

  return null;
}

async function executeAgentExplorationOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  if (id !== "knowledge.agent_explore.runs.create" && id !== "knowledge.agent_explore.runs.get") {
    return null;
  }
  const runtime = context.agentExplorationRuntime;
  if (!runtime) {
    return result(503, { error: "智能探索运行时不可用。" });
  }
  if (id === "knowledge.agent_explore.runs.create") {
    const operationResult = await runtime.run({
      ...input,
      authSession: context.authSession || null,
      boundUserId: context.authSession?.user?.userId || input.boundUserId || input.userId || "",
      userId: context.authSession?.user?.userId || input.userId || input.boundUserId || "",
      teamIds: context.authSession?.user?.teamIds || input.teamIds || []
    });
    return result(operationResult?.ok === false ? operationResult.status || 500 : 201, operationResult);
  }
  const operationResult = runtime.getRun({
    runId: input.runId || input["run-id"] || input.id || "",
    workspaceId: input.workspaceId || input["workspace-id"] || "",
    includePrivate: parseBooleanFlag(input.includePrivate ?? input["include-private"] ?? input.private, false)
  });
  if (!operationResult) {
    return result(404, { error: "智能探索任务不存在。" });
  }
  return result(200, operationResult);
}

async function executeKnowledgeRetrievalOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.search",
    "knowledge.search.get",
    "knowledge.document_structure",
    "knowledge.item",
    "knowledge.evidence",
    "knowledge.evidence.get",
    "knowledge.asset",
    "knowledge.render_markdown"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const knowledgeCore = getKnowledgeCore(context.runtime);
  const metadataStore = context.metadataStore;

  if (id === "knowledge.search" || id === "knowledge.search.get") {
    let payload = normalizeKnowledgeSearchInput(input);
    if (payload.rawSourceSearch === true || payload.sourceSearch === true) {
      return result(200, await searchSourceFiles({
        userDataPath: context.userDataPath,
        query: payload.query || payload.q || "",
        limit: payload.limit || 20,
        returnAll: payload.returnAll === true || payload.all === true
      }));
    }
    if (knowledgeBackendSearchRequested(payload)) {
      const port = knowledgeBackendPortFor(context);
      const operationResult = await port.search(payload, {
        subject: knowledgeBackendSubject(context, payload),
        workspaceId: workspaceIdFrom(payload)
      });
      return result(200, operationResult);
    }
    if (knowledgeCore && typeof knowledgeCore.search === "function") {
      const allocationResult = typeof context.clientRuntimeAllocator?.apply === "function"
        ? await context.clientRuntimeAllocator.apply(payload, {
            taskType: "knowledge.search",
            surface: "api.knowledge.search"
          })
        : null;
      payload = normalizeKnowledgeSearchInput(allocationResult?.input || payload);
      const workspaceApplied = applyWorkspaceRuntimeContext(
        payload,
        context.agentWorkspace,
        workspaceAccessOptions(context.authSession)
      );
      if (workspaceApplied.workspaceError) {
        return result(workspaceApplied.workspaceError.status, {
          error: workspaceApplied.workspaceError.error
        });
      }
      payload = workspaceApplied.input;
      const responseProfile = resolveKnowledgeSearchResponseProfile(payload, context);
      const agentMessageEnabled =
        responseProfile === "agent" &&
        payload.machineReadable !== false &&
        payload.agentMessage !== false;
      const query = payload.query || payload.q || "";
      const hierarchyReasoning =
        payload.hierarchyReasoning === true ||
        payload.retrievalProfile?.hierarchyReasoningEnabled === true ||
        payload.retrieval?.hierarchyReasoningEnabled === true ||
        payload.profile?.retrieval?.hierarchyReasoningEnabled === true;
      const hierarchyReasoningDecision =
        hierarchyReasoning && typeof knowledgeCore.prepareHierarchyReasoning === "function"
          ? await knowledgeCore.prepareHierarchyReasoning({
              query,
              batchId: payload.batchId || "",
              sourceIds: payload.scopeSourceIds || payload.sourceIds || [],
              limit: payload.limit || 20,
              modelEnabled: payload.modelEnabled === true,
              modelDecisionRuntime: context.modelDecisionRuntime
            })
          : null;
      const operationResult = await knowledgeCore.search({
        query,
        limit: payload.limit || 20,
        itemTypes: payload.itemTypes || payload.types || [],
        batchId: payload.batchId || "",
        retrievalMode: payload.retrievalMode || payload.mode || "",
        keywordOnly: payload.keywordOnly === true,
        requestSurface: responseProfile,
        responseProfile,
        machineReadable: agentMessageEnabled,
        agentMessage: agentMessageEnabled,
        retrievalProfileId: payload.retrievalProfileId || payload.profileId || "",
        profileKey: payload.profileKey || payload.retrievalProfileKey || "",
        retrievalProfile:
          payload.retrievalProfile ||
          payload.retrieval ||
          payload.profile?.retrieval ||
          {},
        profile: payload.profile || null,
        hierarchyReasoning,
        modelEnabled: payload.modelEnabled === true,
        hierarchyReasoningDecision,
        localQuery: payload.localQuery || payload.localQueryResult || payload.localQueryResults || null,
        localHits: payload.localHits || payload.localMirrorHits || payload.sourceHits || [],
        clientId: payload.clientId || payload.client_id || "",
        scopeSourceIds: payload.scopeSourceIds || payload.sourceIds || [],
        learningEnabled: payload.learningEnabled !== false,
        explain: agentMessageEnabled || Boolean(payload.explain),
        modalityPolicy: "multimodal"
      });
      if (allocationResult?.allocation) {
        operationResult.clientRuntimeAllocation = allocationResult.allocation;
      }
      if (workspaceApplied.workspaceContext) {
        operationResult.workspaceContext = workspaceApplied.workspaceContext;
      }
      if (
        String(payload.format || "").toLowerCase() === "markdown" &&
        typeof knowledgeCore.renderMarkdown === "function" &&
        operationResult.items?.[0]?.evidenceId
      ) {
        const rendered = await knowledgeCore.renderMarkdown({
          evidenceId: operationResult.items[0].evidenceId,
          format: "markdown"
        });
        return result(200, {
          ...operationResult,
          rendered
        });
      }
      return result(200, operationResult);
    }
    const fallbackResult = metadataStore?.searchKnowledge
      ? metadataStore.searchKnowledge({
          query: payload.query || payload.q || "",
          limit: payload.limit || 20,
          itemTypes: payload.itemTypes || payload.types || [],
          batchId: payload.batchId || ""
        })
      : { items: [], count: 0 };
    return result(200, {
      ...fallbackResult,
      modalityPolicy: {
        mode: "multimodal",
        text: true,
        image: true,
        filtersAllowed: false
      }
    });
  }

  if (id === "knowledge.document_structure") {
    if (!knowledgeCore || typeof knowledgeCore.getDocumentStructure !== "function") {
      return result(503, { error: "知识库结构读取不可用。" });
    }
    const operationResult = knowledgeCore.getDocumentStructure({
      documentId: input.documentId || input["document-id"] || input.id || "",
      maxNodes: Number(input.maxNodes || input["max-nodes"] || 120)
    });
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "知识文档不存在。" });
  }

  if (id === "knowledge.item") {
    if (knowledgeCore && typeof knowledgeCore.getItem === "function") {
      const item = await knowledgeCore.getItem({
        itemId: input.itemId || input["item-id"] || input.id || ""
      });
      if (item) {
        return result(200, item);
      }
    }
    const operationResult = metadataStore?.getKnowledgeItem
      ? metadataStore.getKnowledgeItem({
          itemId: input.itemId || input["item-id"] || input.id || ""
        })
      : null;
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "知识对象不存在。" });
  }

  if (id === "knowledge.evidence" || id === "knowledge.evidence.get") {
    const evidenceId = input.evidenceId || input["evidence-id"] || input.id || "";
    if (isKnowledgeBackendEvidenceId(evidenceId) || knowledgeBackendProviderRequested(input)) {
      const port = knowledgeBackendPortFor(context);
      const operationResult = await port.getEvidence({ ...input, evidenceId }, {
        subject: knowledgeBackendSubject(context, input),
        workspaceId: workspaceIdFrom(input)
      });
      if (operationResult) {
        appendKnowledgeAccessDecisionArtifacts(context, operationResult.accessDecision, id);
        return result(operationResult.httpStatus || 200, operationResult);
      }
      if (isKnowledgeBackendEvidenceId(evidenceId)) {
        return result(404, { error: "外部知识库 evidence 不存在。" });
      }
    }
    if (isSourceEvidenceId(evidenceId)) {
      const operationResult = await getSourceFileEvidence({
        userDataPath: context.userDataPath,
        evidenceId
      });
      if (operationResult) {
        return result(200, operationResult);
      }
    }
    if (knowledgeCore && typeof knowledgeCore.getEvidence === "function") {
      const operationResult = await knowledgeCore.getEvidence({ evidenceId });
      if (operationResult) {
        return result(200, operationResult);
      }
    }
    return result(404, { error: "知识证据不存在。" });
  }

  if (id === "knowledge.asset") {
    if (knowledgeCore && typeof knowledgeCore.getAssetContent === "function") {
      const operationResult = await knowledgeCore.getAssetContent({
        assetId: input.assetId || input["asset-id"] || input.id || ""
      });
      if (operationResult) {
        return result(200, {
          __binaryResponse: true,
          contentType: operationResult.contentType || "application/octet-stream",
          fileName: operationResult.fileName || "asset.bin",
          buffer: operationResult.buffer
        });
      }
    }
    return result(404, { error: "知识库资产不存在。" });
  }

  if (id === "knowledge.render_markdown") {
    if (knowledgeCore && typeof knowledgeCore.renderMarkdown === "function") {
      const operationResult = await knowledgeCore.renderMarkdown(input);
      if (operationResult) {
        return result(200, operationResult);
      }
    }
    return result(404, { error: "知识证据不存在，无法渲染 Markdown。" });
  }
  return null;
}

async function executeAgentWorkspaceFileOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "agent_workspaces.folder.create",
    "agent_workspaces.files.list",
    "agent_workspaces.file.stat",
    "agent_workspaces.file.download",
    "agent_workspaces.file.upload",
    "agent_workspaces.file.write",
    "agent_workspaces.file.delete",
    "agent_workspaces.file.move",
    "sharedspace.localDir.connect",
    "sharedspace.localDir.list",
    "sharedspace.item.list",
    "sharedspace.file.read",
    "sharedspace.file.write",
    "sharedspace.item.delete",
    "sharedspace.sync.plan",
    "sharedspace.sync.apply",
    "workspace.file.upload",
    "workspace.file.list",
    "workspace.file.download",
    "workspace.file.read",
    "workspace.file.write",
    "workspace.file.patch"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const agentWorkspace = context.agentWorkspace;
  const workspaceId = workspaceIdFrom(input);
  const access = workspaceAccessOptions(context.authSession);
  const actorId = context.authSession?.user?.username || context.authSession?.user?.userId || "";
  if (id === "sharedspace.localDir.connect") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "connectLocalDirectory", "本机目录连接接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const operationResult = method({
      workspaceId,
      ...input,
      operationId: id,
      createdBy: actorId || input.createdBy || "",
      ...access
    });
    return result(operationResult.ok ? 201 : operationResult.status || 400, operationResult);
  }
  if (id === "sharedspace.localDir.list") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "listLocalDirectoryMounts", "本机目录 mount 列表接口不可用。");
    if (error) return error;
    const operationResult = method({
      workspaceId,
      ...input,
      operationId: id,
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.folder.create") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "createWorkspaceFolder", "工作空间文件夹接口不可用。");
    if (error) return error;
    const operationResult = await method({
      workspaceId,
      ...input,
      operationId: id,
      ...access
    });
    return result(operationResult.ok ? 201 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.files.list" || id === "workspace.file.list" || id === "sharedspace.item.list") {
    if (id === "sharedspace.item.list" && (input.mountRef || input.mountId || input.localDirMountRef || input.sourcePath)) {
      const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "listLocalDirectoryItems", "本机目录条目列表接口不可用。");
      if (error) return error;
      const operationResult = method({
        workspaceId,
        ...input,
        operationId: id,
        recursive: ["1", "true", "yes"].includes(String(input.recursive ?? "false").toLowerCase()),
        includeDirectories: !["0", "false", "no"].includes(String(input.includeDirectories ?? input["include-directories"] ?? "true").toLowerCase()),
        includeFiles: !["0", "false", "no"].includes(String(input.includeFiles ?? input["include-files"] ?? "true").toLowerCase()),
        includeHash: ["1", "true", "yes"].includes(String(input.includeHash ?? input["include-hash"] ?? "false").toLowerCase()),
        limit: Number(input.limit || 200),
        ...access
      });
      return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
    }
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "listWorkspaceFiles", "工作空间文件列表接口不可用。");
    if (error) return error;
    const operationResult = await method({
      workspaceId,
      path: input.path || "",
      folderPath: input.folderPath || input["folder-path"] || "",
      recursive: !["0", "false", "no"].includes(String(input.recursive ?? "true").toLowerCase()),
      includeDirectories: !["0", "false", "no"].includes(String(input.includeDirectories ?? input["include-directories"] ?? "true").toLowerCase()),
      includeFiles: !["0", "false", "no"].includes(String(input.includeFiles ?? input["include-files"] ?? "true").toLowerCase()),
      limit: Number(input.limit || 500),
      operationId: id,
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.file.stat") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "workspaceFileMetadata", "工作空间文件查询接口不可用。");
    if (error) return error;
    const operationResult = await method({
      workspaceId,
      path: input.path || input.filePath || input["file-path"] || "",
      includeHash: !["0", "false", "no"].includes(String(input.includeHash ?? input["include-hash"] ?? "true").toLowerCase()),
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.file.download" || id === "workspace.file.download" || id === "workspace.file.read" || id === "sharedspace.file.read") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "downloadWorkspaceFile", "工作空间文件下载接口不可用。");
    if (error) return error;
    const operationResult = await method({
      workspaceId,
      path: input.path || input.filePath || input["file-path"] || "",
      includeText: !["0", "false", "no"].includes(String(input.includeText ?? input["include-text"] ?? "true").toLowerCase()),
      encoding: input.encoding || "utf8",
      operationId: id,
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.file.upload" || id === "workspace.file.upload" || id === "sharedspace.file.write") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "uploadWorkspaceFile", "工作空间存储接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const operationResult = await method({
      workspaceId,
      ...input,
      operationId: id,
      createdBy: actorId || input.createdBy || "",
      ...access
    });
    return result(operationResult.ok ? 201 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.file.write" || id === "workspace.file.write") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "writeWorkspaceFile", "工作空间存储接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const operationResult = await method({
      workspaceId,
      ...input,
      operationId: id,
      createdBy: actorId || input.createdBy || "",
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "workspace.file.patch") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "patchWorkspaceFile", "工作空间补丁接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const operationResult = await method({
      workspaceId,
      ...input,
      operationId: id,
      createdBy: actorId || input.createdBy || "",
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.file.delete" || id === "sharedspace.item.delete") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "deleteWorkspaceFile", "工作空间存储接口不可用。");
    if (error) return error;
    const operationResult = await method({
      workspaceId,
      path: input.path || input.filePath || input["file-path"] || "",
      operationId: id,
      recursive: hasInputKey(input, "recursive"),
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "agent_workspaces.file.move") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "moveWorkspaceFile", "工作空间存储接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const operationResult = await method({
      workspaceId,
      ...input,
      operationId: id,
      createdBy: actorId || input.createdBy || "",
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "sharedspace.sync.plan") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "localDirectorySyncPlan", "本机目录同步计划接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const operationResult = method({
      workspaceId,
      ...input,
      operationId: id,
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  if (id === "sharedspace.sync.apply") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "applyLocalDirectorySync", "本机目录同步应用接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const operationResult = await method({
      workspaceId,
      ...input,
      operationId: id,
      createdBy: actorId || input.createdBy || "",
      ...access
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  }
  return null;
}

async function executeAgentWorkspaceManagementOperation({ operationId, input, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "workspace.info",
    "agent_workspaces.create",
    "agent_workspaces.list",
    "agent_workspaces.get",
    "agent_workspaces.delete",
    "agent_sessions.list",
    "agent_sessions.get",
    "agent_sessions.context.get",
    "agent_sessions.events.append",
    "agent_sessions.fork",
    "agent_sessions.compare",
    "agent_sessions.merge_proposal",
    "agent_sessions.archive",
    "agent_workspaces.submissions.resolve",
    "agent_workspaces.issues.resolve",
    "agent_workspaces.locks.list",
    "agent_workspaces.locks.write",
    "agent_workspaces.context.get",
    "agent_workspaces.context_bundle.export",
    "agent_workspaces.context_bundle.restore",
    "agent_workspaces.chain.get",
    "agent_workspaces.parent.set",
    "agent_workspaces.profile.hotswap",
    "agent_workspaces.sources.set",
    "agent_workspaces.share",
    "agent_workspaces.unshare",
    "workspace.proposal.create",
    "workspace.proposal.apply"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const agentWorkspace = context.agentWorkspace;
  const access = workspaceAccessOptions(context.authSession);
  const actorId = actorFrom(context.authSession, input);
  const workspaceId = workspaceIdFrom(input);
  const sessionId = String(input.sessionId || input["session-id"] || input.id || "").trim();

  if (id === "workspace.info") {
    const hasExplicitWorkspaceId = ["workspaceId", "workspace_id", "workspace-id", "workspace", "id"]
      .some((key) => hasInputKey(input, key));
    if (!hasExplicitWorkspaceId) {
      const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "listWorkspaces", "智能体工作空间不可用。");
      if (error) return error;
      return result(200, method({
        status: input.status || "",
        limit: Number(input.limit || 50),
        includeSummary: parseBooleanFlag(input.includeSummary ?? input["include-summary"], true),
        ...access
      }));
    }
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "getWorkspace", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method({
      workspaceId,
      includePrivate: parseBooleanFlag(input.includePrivate ?? input["include-private"] ?? input.private, false),
      ...access
    });
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "智能体工作空间不存在。" });
  }

  if (id === "agent_workspaces.list") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "listWorkspaces", "智能体工作空间不可用。");
    if (error) return error;
    return result(200, method({
      status: input.status || "",
      limit: Number(input.limit || 50),
      includeSummary: parseBooleanFlag(input.includeSummary ?? input["include-summary"], true),
      ...access
    }));
  }
  if (id === "agent_workspaces.get") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "getWorkspace", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method({
      workspaceId,
      includePrivate: parseBooleanFlag(input.includePrivate ?? input["include-private"] ?? input.private, false),
      ...access
    });
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "智能体工作空间不存在。" });
  }
  if (id === "agent_workspaces.create") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "createWorkspace", "智能体工作空间不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    if (!input.title) {
      return result(400, { error: "title 不能为空" });
    }
    const operationResult = method({
      title: String(input.title || "").trim(),
      objective: String(input.objective || "").trim(),
      status: "active",
      ownerUserId: access.actorUserId || input.ownerUserId || "",
      metadata: input.metadata || {}
    });
    if (input.parentWorkspaceId && operationResult.workspace?.workspaceId) {
      const { method: setParent, error: parentError } = requireAgentWorkspaceMethod(
        agentWorkspace,
        "setWorkspaceParent",
        "工作空间继承接口不可用。"
      );
      if (parentError) return parentError;
      const parentResult = setParent(operationResult.workspace.workspaceId, input.parentWorkspaceId, access);
      if (!parentResult.ok) {
        return result(400, { error: parentResult.error });
      }
      operationResult.workspace = parentResult.workspace;
    }
    return result(201, operationResult);
  }
  if (id === "agent_workspaces.delete") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "deleteWorkspace", "智能体工作空间删除不可用。");
    if (error) return error;
    const operationResult = method(workspaceId, {
      deleteFolder: parseBooleanFlag(input.deleteFolder ?? input["delete-folder"], false),
      ...access
    });
    return operationResult?.ok
      ? result(200, operationResult)
      : result(404, { error: operationResult?.error || "工作空间不存在或无权限。" });
  }

  if (id === "agent_sessions.list") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "listSessions", "会话线程不可用。");
    if (error) return error;
    return result(200, method({
      status: input.status || "",
      workspaceId: input.workspaceId || input["workspace-id"] || "",
      limit: Number(input.limit || 100),
      includeLastEvent: parseBooleanFlag(input.includeLastEvent ?? input["include-last-event"], true),
      ...access
    }));
  }
  if (id === "agent_sessions.get") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "getSession", "会话线程不可用。");
    if (error) return error;
    const operationResult = method({
      sessionId,
      includeEvents: parseBooleanFlag(input.includeEvents ?? input["include-events"], true),
      eventLimit: Number(input.eventLimit || input["event-limit"] || input.limit || 200),
      ...access
    });
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "会话线程不存在。" });
  }
  if (id === "agent_sessions.context.get") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "getSessionContext", "会话线程上下文不可用。");
    if (error) return error;
    const operationResult = method(sessionId, access);
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "会话线程不存在。" });
  }
  if (id === "agent_sessions.events.append") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "appendSessionEvent", "会话线程不可用。");
    if (error) return error;
    const operationResult = method({
      sessionId,
      ...input,
      ...access
    });
    return operationResult
      ? result(201, operationResult)
      : result(404, { error: "会话线程不存在。" });
  }
  if (id === "agent_sessions.fork") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "forkSession", "会话线程不可用。");
    if (error) return error;
    const operationResult = method({
      sessionId,
      ...input,
      ...access
    });
    return operationResult?.ok
      ? result(201, operationResult)
      : result(operationResult?.error === "会话不存在" ? 404 : 400, operationResult || { ok: false, error: "会话分叉失败。" });
  }
  if (id === "agent_sessions.compare") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "compareSessions", "会话线程不可用。");
    if (error) return error;
    const operationResult = method({
      ...input,
      leftSessionId: sessionId || input.leftSessionId || input.sessionId,
      ...access
    });
    return operationResult?.ok
      ? result(200, operationResult)
      : result(operationResult?.error === "会话不存在" ? 404 : 400, operationResult || { ok: false, error: "会话比较失败。" });
  }
  if (id === "agent_sessions.merge_proposal") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "createSessionMergeProposal", "会话线程不可用。");
    if (error) return error;
    const operationResult = method({
      ...input,
      targetSessionId: sessionId || input.targetSessionId || input.sessionId,
      ...access
    });
    return operationResult?.ok
      ? result(201, operationResult)
      : result(operationResult?.error === "会话不存在" ? 404 : 400, operationResult || { ok: false, error: "会话合并提案失败。" });
  }
  if (id === "agent_sessions.archive") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "archiveSession", "会话线程不可用。");
    if (error) return error;
    const operationResult = method({
      sessionId,
      ...input,
      ...access
    });
    return operationResult?.ok
      ? result(200, operationResult)
      : result(operationResult?.error === "会话不存在" ? 404 : 400, operationResult || { ok: false, error: "会话归档失败。" });
  }

  if (id === "agent_workspaces.submissions.resolve") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "resolveSubmission", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method({
      workspaceId,
      submissionId: input.submissionId || input["submission-id"] || input.id || "",
      ...input,
      ...access
    });
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "共享提交不存在。" });
  }
  if (id === "agent_workspaces.issues.resolve") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "updateIssue", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method({
      workspaceId,
      issueId: input.issueId || input["issue-id"] || input.id || "",
      ...input,
      ...access
    });
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "共享空间 issue 不存在。" });
  }

  if (id === "agent_workspaces.locks.list") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "listLocks", "智能体工作空间不可用。");
    if (error) return error;
    return result(200, {
      protocolVersion: agentWorkspace.protocolVersion,
      locks: method({
        workspaceId,
        limit: Number(input.limit || 100),
        includeExpired: parseBooleanFlag(input.includeExpired ?? input["include-expired"], false),
        ...access
      })
    });
  }
  if (id === "agent_workspaces.locks.write") {
    const action = String(input.action || input.operation || "acquire").trim();
    const methodName = action === "release" ? "releaseLock" : "acquireLock";
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, methodName, "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method({
      workspaceId,
      ...input,
      ...access
    });
    return operationResult?.ok === false
      ? result(operationResult.error === "lock_held" ? 409 : 400, operationResult)
      : result(200, operationResult);
  }

  if (id === "workspace.proposal.create") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "submit", "workspace 提案接口不可用。");
    if (error) return error;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return result(400, { error: "请求体必须是 JSON 对象。" });
    }
    const proposalPayload = plainObject(input.proposal || input.payload, {});
    const title = String(input.title || proposalPayload.title || proposalPayload.summary || "").trim();
    if (!workspaceId) {
      return result(400, { error: "workspaceId 不能为空。" });
    }
    if (!title) {
      return result(400, { error: "title 不能为空。" });
    }
    const operationResult = method({
      workspaceId,
      runId: input.runId || input["run-id"] || proposalPayload.runId || "",
      agentId: actorId || input.agentId || input["agent-id"] || "workspace-proposal",
      type: "decisionProposal",
      confidence: input.confidence ?? proposalPayload.confidence ?? 0.8,
      evidenceRefs: input.evidenceRefs || proposalPayload.evidenceRefs || [],
      writePolicy: input.writePolicy || {},
      payload: {
        ...proposalPayload,
        proposalId: input.proposalId || input["proposal-id"] || proposalPayload.proposalId || "",
        title,
        summary: String(input.summary || proposalPayload.summary || "").trim(),
        proposedAction: input.proposedAction || input["proposed-action"] || proposalPayload.proposedAction || ""
      }
    });
    return result(201, protocolPayload({
      protocolVersion: "pact.workspace-proposal.v1",
      created: true,
      proposal: operationResult.submission,
      submission: operationResult.submission
    }));
  }

  if (id === "workspace.proposal.apply") {
    const resolveSubmission = requireAgentWorkspaceMethod(agentWorkspace, "resolveSubmission", "workspace 提案审核接口不可用。");
    if (resolveSubmission.error) return resolveSubmission.error;
    const createDecision = requireAgentWorkspaceMethod(agentWorkspace, "createDecision", "workspace decision 接口不可用。");
    if (createDecision.error) return createDecision.error;
    const proposalId = String(input.proposalId || input["proposal-id"] || input.submissionId || input["submission-id"] || input.id || "").trim();
    if (!workspaceId) {
      return result(400, { error: "workspaceId 不能为空。" });
    }
    if (!proposalId) {
      return result(400, { error: "proposalId 不能为空。" });
    }
    const resolutionResult = resolveSubmission.method({
      workspaceId,
      submissionId: proposalId,
      resolution: input.resolution || input.action || "accept",
      reviewerId: actorId || input.reviewerId || input["reviewer-id"] || "",
      note: input.note || input.reason || "",
      ...access
    });
    if (!resolutionResult?.submission) {
      return result(404, { error: "workspace 提案不存在。" });
    }
    const proposal = resolutionResult.submission;
    const accepted = proposal.status === "accepted";
    let decision = null;
    if (accepted) {
      const proposalPayload = plainObject(proposal.payload, {});
      const decisionPayload = {
        ...proposalPayload,
        ...plainObject(input.decision || input.decisionPayload || input["decision-payload"], {}),
        sourceProposalId: proposal.submissionId
      };
      const decisionResult = createDecision.method({
        workspaceId,
        runId: proposal.runId || input.runId || input["run-id"] || "",
        title: input.title || decisionPayload.title || decisionPayload.summary || "Workspace proposal decision",
        status: input.decisionStatus || input["decision-status"] || "accepted",
        payload: decisionPayload,
        createdBy: actorId || input.reviewerId || input["reviewer-id"] || ""
      });
      decision = decisionResult.decision;
    }
    return result(200, protocolPayload({
      protocolVersion: "pact.workspace-proposal.v1",
      applied: accepted,
      status: proposal.status,
      proposal,
      submission: proposal,
      decision
    }));
  }

  if (id === "agent_workspaces.context.get") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "getWorkspaceContext", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method(workspaceId, access);
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "工作空间不存在。" });
  }
  if (id === "agent_workspaces.context_bundle.export") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "exportWorkspaceContextBundle", "工作空间上下文打包不可用。");
    if (error) return error;
    const format = String(input.format || "").trim().toLowerCase();
    const compressedOnly =
      format === "compressed" ||
      parseBooleanFlag(input.compressedOnly ?? input["compressed-only"], false);
    const operationResult = method(workspaceId, {
      ...access,
      compress: !["0", "false", "none"].includes(String(input.compress ?? "true").toLowerCase()),
      includeBundle: !compressedOnly,
      includePrivate: parseBooleanFlag(input.includePrivate ?? input["include-private"] ?? input.private, false),
      maxItems: Number(input.maxItems || input["max-items"] || input.limit || 12),
      contentPreviewChars: Number(input.contentPreviewChars || input["content-preview-chars"] || 600)
    });
    return operationResult
      ? result(200, operationResult)
      : result(404, { error: "工作空间不存在。" });
  }
  if (id === "agent_workspaces.context_bundle.restore") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "restoreWorkspaceContextBundle", "工作空间上下文恢复不可用。");
    if (error) return error;
    const operationResult = method(workspaceId, input, access);
    return result(operationResult.ok ? 200 : 400, operationResult);
  }
  if (id === "agent_workspaces.chain.get") {
    const getWorkspace = requireAgentWorkspaceMethod(agentWorkspace, "getWorkspace", "智能体工作空间不可用。");
    if (getWorkspace.error) return getWorkspace.error;
    const resolveChain = requireAgentWorkspaceMethod(agentWorkspace, "resolveWorkspaceChain", "工作空间继承链接口不可用。");
    if (resolveChain.error) return resolveChain.error;
    const resolveSourceIds = requireAgentWorkspaceMethod(agentWorkspace, "resolveWorkspaceSourceIds", "工作空间继承链接口不可用。");
    if (resolveSourceIds.error) return resolveSourceIds.error;
    const resolveProfile = requireAgentWorkspaceMethod(agentWorkspace, "resolveWorkspaceProfile", "工作空间继承链接口不可用。");
    if (resolveProfile.error) return resolveProfile.error;
    try {
      if (!getWorkspace.method({ workspaceId, includeRuns: false, ...access })) {
        return result(404, { error: "工作空间不存在。" });
      }
      const chain = resolveChain.method(workspaceId);
      if (!chain.length) {
        return result(404, { error: "工作空间不存在。" });
      }
      return result(200, {
        chain,
        resolvedSourceIds: resolveSourceIds.method(workspaceId),
        resolvedProfile: resolveProfile.method(workspaceId)
      });
    } catch (error) {
      return result(400, { error: error instanceof Error ? error.message : "工作空间继承链读取失败。" });
    }
  }
  if (id === "agent_workspaces.parent.set") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "setWorkspaceParent", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method(
      workspaceId,
      input.parentWorkspaceId || input["parent-workspace-id"] || null,
      access
    );
    return result(operationResult.ok ? 200 : 400, operationResult);
  }
  if (id === "agent_workspaces.profile.hotswap") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "hotSwapProfile", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method(workspaceId, input, access);
    return result(operationResult.ok ? 200 : 400, operationResult);
  }
  if (id === "agent_workspaces.sources.set") {
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, "setOwnedSourceIds", "智能体工作空间不可用。");
    if (error) return error;
    const operationResult = method(workspaceId, input.sourceIds || [], access);
    return result(operationResult.ok ? 200 : 400, operationResult);
  }
  if (id === "agent_workspaces.share" || id === "agent_workspaces.unshare") {
    const methodName = id === "agent_workspaces.share" ? "shareWorkspace" : "unshareWorkspace";
    const { method, error } = requireAgentWorkspaceMethod(agentWorkspace, methodName, "智能体工作空间不可用。");
    if (error) return error;
    const target = input.targetWorkspaceId || input.targetWorkspace || input.target || "";
    if (!target) {
      return result(400, { error: "缺少 targetWorkspaceId" });
    }
    const operationResult = method(workspaceId, target, access);
    return result(operationResult.ok ? 200 : 400, operationResult);
  }
  return null;
}

async function executeContextRuntimeOperation({ operationId, input, context }) {
  if (!String(operationId || "").startsWith("context.")) {
    return null;
  }
  const contextRuntime = context.contextRuntime;
  if (operationId === "context.profiles.get") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "listProfiles", "上下文运行时不可用。");
    if (error) return error;
    return result(200, await method());
  }
  if (operationId === "context.profiles.set") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "saveProfiles", "上下文运行时不可用。");
    if (error) return error;
    return result(200, await method(input));
  }
  if (operationId === "context.preview") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "preview", "上下文预览运行时不可用。");
    if (error) return error;
    const workspaceApplied = applyWorkspaceRuntimeContext(
      input,
      context.agentWorkspace,
      workspaceAccessOptions(context.authSession)
    );
    if (workspaceApplied.workspaceError) {
      return result(workspaceApplied.workspaceError.status, {
        error: workspaceApplied.workspaceError.error
      });
    }
    return result(200, await method(workspaceApplied.input));
  }
  if (operationId === "context.compaction.preview") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "previewCompaction", "上下文压缩预览运行时不可用。");
    if (error) return error;
    return result(200, await method(input));
  }
  if (operationId === "context.compaction.run") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "runCompaction", "上下文压缩运行时不可用。");
    if (error) return error;
    return result(200, await method(input));
  }
  if (operationId === "context.compaction.records") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "listCompactionRecords", "上下文压缩记录不可用。");
    if (error) return error;
    return result(200, await method({
      limit: Number(input.limit || 50)
    }));
  }
  if (operationId === "context.session_memory.get") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "listSessionMemory", "上下文会话记忆不可用。");
    if (error) return error;
    return result(200, await method({
      limit: Number(input.limit || 50),
      sessionId: input.sessionId || input["session-id"] || "",
      profileId: input.profileId || input["profile-id"] || ""
    }));
  }
  if (operationId === "context.session_memory.clear") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "clearSessionMemory", "上下文会话记忆不可用。");
    if (error) return error;
    return result(200, await method(input));
  }
  if (operationId === "context.build_records") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "listBuildRecords", "上下文编译记录不可用。");
    if (error) return error;
    return result(200, await method({
      limit: Number(input.limit || 50)
    }));
  }
  if (operationId === "context.evaluation.runs.create") {
    const { method, error } = requireRuntimeMethod(contextRuntime, "runEvaluation", "上下文 replay 评估不可用。");
    if (error) return error;
    return result(201, await method(input));
  }
  return null;
}

async function executeCapabilityPackageOperation({ operationId, input, context }) {
  if (!String(operationId || "").startsWith("capability_packages.")) {
    return null;
  }
  const registry = createCapabilityPackageRegistry({ userDataPath: context.userDataPath });
  if (operationId === "capability_packages.list") {
    return result(200, await registry.describe());
  }
  if (operationId === "capability_packages.plan") {
    return result(200, await registry.plan(input.manifest || input));
  }
  if (operationId === "capability_packages.submit") {
    try {
      return result(200, await registry.submit(input.manifest || input, {
        submittedBy: actorFrom(context.authSession, input)
      }));
    } catch (error) {
      return result(400, errorPayload(error, "能力包提交失败。", { details: error?.details || [] }));
    }
  }
  if (operationId === "capability_packages.lifecycle") {
    try {
      const action = String(input.action || "").trim();
      if (action === "rollback") {
        return result(200, await registry.rollback({
          kind: input.kind,
          name: input.name,
          actor: actorFrom(context.authSession, input),
          reason: input.reason || ""
        }));
      }
      return result(200, await registry.lifecycle(context.packageId || input.packageId || "", {
        ...input,
        actor: actorFrom(context.authSession, input)
      }));
    } catch (error) {
      return result(409, errorPayload(error, "能力包生命周期操作失败。"));
    }
  }
  return null;
}

async function executeWorkspaceGovernanceOperation({ operationId, input, context }) {
  if (!String(operationId || "").startsWith("workspace_governance.")) {
    return null;
  }
  const governance = createWorkspaceGovernanceRegistry({ userDataPath: context.userDataPath });
  if (operationId === "workspace_governance.describe") {
    return result(200, await governance.describe());
  }
  if (operationId === "workspace_governance.policy.set") {
    try {
      return result(200, await governance.upsertPolicy(input.policy || input));
    } catch (error) {
      return result(400, errorPayload(error, "Workspace governance policy update failed."));
    }
  }
  if (operationId === "workspace_governance.evaluate") {
    try {
      return result(200, await governance.evaluate(input));
    } catch (error) {
      return result(400, errorPayload(error, "Workspace governance evaluation failed."));
    }
  }
  if (operationId === "workspace_governance.share_grant") {
    try {
      return result(200, await governance.createShareGrant(input));
    } catch (error) {
      return result(400, errorPayload(error, "Workspace governance share grant failed."));
    }
  }
  return null;
}

async function executeCodeManagementOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "codespace.providers.manifest",
    "codespace.repository.status",
    "codespace.tree.list",
    "codespace.file.read",
    "codespace.diff.read",
    "codespace.change.prepare",
    "codespace.change.upload",
    "codespace.review.comment",
    "codespace.review.requestChanges",
    "codespace.review.approve",
    "codespace.review.status.sync",
    "workspace.code.target.evaluate",
    "workspace.code.change.prepare",
    "workspace.code.change.upload",
    "workspace.code.change.link",
    "workspace.code.change.status.sync"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const codespace = codespaceRegistryFor(context);
  try {
    if (id === "codespace.providers.manifest") {
      return result(200, protocolPayload(await codespace.providerManifest()));
    }
    if (id === "codespace.repository.status") {
      const operationResult = await codespace.repositoryStatus(input, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.tree.list") {
      const operationResult = await codespace.listTree(input, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.file.read") {
      const operationResult = await codespace.readFile(input, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.diff.read") {
      const operationResult = await codespace.readDiff(input, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.change.prepare") {
      return result(200, protocolPayload(await codespace.prepareChange({
        ...input,
        operationId: id,
        actorId: actorFrom(context.authSession, input)
      })));
    }
    if (id === "codespace.change.upload") {
      const operationResult = await codespace.uploadCodespaceChange({
        ...input,
        actorId: actorFrom(context.authSession, input)
      }, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.review.comment") {
      const operationResult = await codespace.reviewComment({
        ...input,
        actorId: actorFrom(context.authSession, input)
      }, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.review.requestChanges") {
      const operationResult = await codespace.reviewRequestChanges({
        ...input,
        actorId: actorFrom(context.authSession, input)
      }, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.review.approve") {
      const operationResult = await codespace.reviewApprove({
        ...input,
        actorId: actorFrom(context.authSession, input)
      }, { authSession: context.authSession });
      return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
    }
    if (id === "codespace.review.status.sync") {
      return result(200, protocolPayload(await codespace.syncStatus({
        ...input,
        operationId: id,
        actorId: actorFrom(context.authSession, input)
      })));
    }
    if (id === "workspace.code.target.evaluate") {
      return result(200, protocolPayload(await codespace.evaluateTarget({
        ...input,
        actorId: actorFrom(context.authSession, input)
      })));
    }
    if (id === "workspace.code.change.prepare") {
      return result(200, protocolPayload(await codespace.prepareChange({
        ...input,
        actorId: actorFrom(context.authSession, input)
      })));
    }
    if (id === "workspace.code.change.upload") {
      const operationResult = await codespace.uploadChange({
        ...input,
        actorId: actorFrom(context.authSession, input)
      });
      return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
    }
    if (id === "workspace.code.change.link") {
      return result(200, protocolPayload(await codespace.linkChange({
        ...input,
        actorId: actorFrom(context.authSession, input)
      })));
    }
    if (id === "workspace.code.change.status.sync") {
      return result(200, protocolPayload(await codespace.syncStatus({
        ...input,
        actorId: actorFrom(context.authSession, input)
      })));
    }
  } catch (error) {
    return result(400, errorPayload(error, "Codespace operation failed."));
  }
  return null;
}

function appendKnowledgeAccessDecisionArtifacts(context = {}, decision = null, operationId = "") {
  const securityPermissions = context.securityPermissions;
  if (!decision || !securityPermissions) {
    return;
  }
  const subjectId =
    decision.knowledgeAccessReceipt?.subject?.subjectId ||
    decision.loanRecord?.subject?.subjectId ||
    decision.knowledgeAccessReceipt?.subjectId ||
    decision.loanRecord?.subjectId ||
    "";
  appendAuthorizationArtifact(securityPermissions, "appendReceipt", decision.knowledgeAccessReceipt, {
    decisionId: decision.decisionId,
    subjectId
  });
  appendAuthorizationArtifact(securityPermissions, "appendLoanRecord", decision.loanRecord, {
    decisionId: decision.decisionId,
    subjectId
  });
  if (decision.deniedRequestAudit && typeof securityPermissions.appendDeniedRequest === "function") {
    securityPermissions.appendDeniedRequest({
      decisionId: decision.decisionId,
      subjectId,
      operationId,
      reasonCode: decision.filteredReason || "knowledge_access_denied",
      deniedRequest: decision.deniedRequestAudit
    });
  }
}

async function executeKnowledgeTransformationOperation({ operationId, input = {}, context }) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "raw-corpus.format.convert",
    "knowledge.dossier.export",
    "knowledge.distillation.export"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }
  const provider = createKnowledgeTransformationProvider({
    knowledgeCore: getKnowledgeCore(context.runtime),
    metadataStore: context.metadataStore,
    knowledgeDistillationRuntime: context.knowledgeDistillationRuntime
  });
  const subject = subjectFromAuthSession(context.authSession);
  try {
    const providerContext = { subject };
    const operationResult = id === "raw-corpus.format.convert"
      ? await provider.convertRawCorpus(input, providerContext)
      : id === "knowledge.dossier.export"
        ? await provider.exportDossier(input, providerContext)
        : await provider.exportDistillation(input, providerContext);
    appendKnowledgeAccessDecisionArtifacts(context, operationResult.knowledgeAccessDecision, id);
    return result(operationResult.ok ? 200 : operationResult.status || 400, protocolPayload(operationResult));
  } catch (error) {
    return result(400, errorPayload(error, "Knowledge transformation operation failed."));
  }
}

async function executeProtocolFacadeOperation({ operationId, input = {} }) {
  const id = String(operationId || "");
  void input;
  void id;
  return null;
}

async function executeGerritOperation({ operationId, input }) {
  const modes = {
    "gerrit.read": "read",
    "gerrit.write": "write",
    "gerrit.maintain": "maintain"
  };
  const mode = modes[operationId];
  if (mode) {
    try {
      const operationResult = await executeGerritCommonOperation({ mode, input });
      const { result: data, ...rest } = operationResult;
      return result(operationResult.ok ? 200 : operationResult.status || 400, {
        ...rest,
        data,
        allowedActions: GERRIT_ACTIONS[mode]
      });
    } catch (error) {
      return result(400, {
        ok: false,
        error: error instanceof Error ? error.message : `Gerrit ${mode} operation failed.`,
        allowedActions: GERRIT_ACTIONS[mode]
      });
    }
  }
  if (operationId === "gerrit.git_upload") {
    try {
      const operationResult = await uploadGerritGitChange(input);
      return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
    } catch (error) {
      return result(400, errorPayload(error, "Gerrit git upload failed."));
    }
  }
  if (operationId === "workspace.code.change.upload") {
    const operationResult = await uploadGerritGitChange(input);
    return result(operationResult.ok ? 200 : operationResult.status || 400, {
      schemaVersion: 1,
      operationId,
      ...operationResult
    });
  }
  return null;
}

async function executeRepoDomainOperation({ operationId, input, context }) {
  if (!String(operationId || "").startsWith("repo.")) {
    return null;
  }
  try {
    const operationResult = await executeRepoOperation({
      operationId,
      input,
      authSession: context.authSession
    });
    return result(operationResult.ok ? 200 : operationResult.status || 400, operationResult);
  } catch (error) {
    return result(400, {
      ok: false,
      operationId: operationId || "",
      error: {
        code: "repo_operation_failed",
        message: error instanceof Error ? error.message : "Repo operation failed."
      }
    });
  }
}

async function executeAssetLineageOperation({ operationId, input, context }) {
  if (!String(operationId || "").startsWith("asset_lineage.")) {
    return null;
  }
  const lineage = createAssetLineageRegistry({ userDataPath: context.userDataPath });
  if (operationId === "asset_lineage.describe") {
    return result(200, await lineage.describe());
  }
  if (operationId === "asset_lineage.record") {
    try {
      return result(200, await lineage.record(input.record || input));
    } catch (error) {
      return result(400, errorPayload(error, "Asset lineage record failed."));
    }
  }
  if (operationId === "asset_lineage.trace") {
    try {
      return result(200, await lineage.trace(input));
    } catch (error) {
      return result(400, errorPayload(error, "Asset lineage trace failed."));
    }
  }
  if (operationId === "asset_lineage.reparse_plan") {
    try {
      return result(200, await lineage.planReparse(input));
    } catch (error) {
      return result(400, errorPayload(error, "Asset lineage reparse plan failed."));
    }
  }
  return null;
}

async function executeDataConnectorOperation({ operationId, input, context }) {
  if (!String(operationId || "").startsWith("data_connectors.governance.")) {
    return null;
  }
  const governance = createDataConnectorGovernance({ userDataPath: context.userDataPath });
  if (operationId === "data_connectors.governance.describe") {
    return result(200, await governance.describe());
  }
  if (operationId === "data_connectors.governance.plan") {
    return result(200, await governance.plan(input.manifest || input));
  }
  if (operationId === "data_connectors.governance.conformance") {
    try {
      return result(200, await governance.runConformance(input.manifest || input));
    } catch (error) {
      return result(400, errorPayload(error, "Data connector conformance failed.", {
        details: error?.details || []
      }));
    }
  }
  return null;
}

async function executePerformanceCapacityOperation({ operationId, input, context }) {
  if (operationId === "performance.capacity.targets") {
    return result(200, listCapacityBenchmarkTargets());
  }
  if (operationId === "performance.capacity.benchmark") {
    try {
      return result(200, await runPerformanceCapacityBenchmark({
        userDataPath: context.userDataPath,
        profileId: input.profileId || input.profile || "smoke",
        targets: input.targets || {},
        failureInjection: input.failureInjection || {}
      }));
    } catch (error) {
      return result(400, errorPayload(error, "Performance capacity benchmark failed."));
    }
  }
  return null;
}

async function executeRuntimeDependencyOperation({ operationId, input, context }) {
  if (operationId === "runtime.dependencies.list") {
    return result(200, await listRuntimeDependencies({
      ...input,
      userDataPath: context.userDataPath
    }));
  }
  if (operationId === "runtime.dependencies.download") {
    try {
      const operationResult = await downloadRuntimeDependency({
        ...input,
        userDataPath: context.userDataPath
      });
      return result(operationResult.ok ? 200 : 400, operationResult);
    } catch (error) {
      return result(400, errorPayload(error, "Runtime dependency download failed."));
    }
  }
  return null;
}

export async function executeConsoleDomainOperation({ operationId, input = {}, context = {} } = {}) {
  for (const executor of [
    executeWorkspaceContributionOperation,
    executeKnowledgeAccessOperation,
    executeKnowledgeManagementOperation,
    executeKnowledgePreprocessingRulesOperation,
    executeKnowledgeDocumentParsingOperation,
    executeKnowledgeCorpusOperation,
    executeKnowledgeSourceOperation,
    executeKnowledgeWordCloudOperation,
    executeStorageOperation,
    executeClientRuntimeOperation,
    executeMonitorAlertOperation,
    executeSystemObservationOperation,
    executeJobObservationOperation,
    executeSystemCoreOperation,
    executeConsoleStateOperation,
    executeSystemInterfaceOperation,
    executeRuntimePathBrowseOperation,
    executeProductionReadinessOperation,
    executeModuleEcosystemOperation,
    executeCodexOAuthOperation,
    executeSettingsAgentGatewayOperation,
    executeAuthorizationFacadeOperation,
    executeWorkspaceAuditOperation,
    executeAgentSyncOperation,
    executeToolManagementAuthorizationOperation,
    executeStrategyManagementOperation,
    executeToolManagementPassthroughOperation,
    executeRuntimeMountOperation,
    executeDiscoveryOperation,
    executeConsoleAuthOperation,
    executeMaintenanceAgentOperation,
    executeGoldenRuleOperation,
    executeKnowledgeSkillOperation,
    executeKnowledgeAgentSupportOperation,
    executeKnowledgeEvaluationOperation,
    executeKnowledgeEvolutionOperation,
    executeKnowledgeSummarizationOperation,
    executeExternalKnowledgeDistillationOperation,
    executeKnowledgeDistillationWorkflowOperation,
    executeAgentExplorationOperation,
    executeKnowledgeBackendOperation,
    executeCloudDriveOperation,
    executeKnowledgeRetrievalOperation,
    executeKnowledgeGraphOperation,
    executeContextRuntimeOperation,
    executeAgentWorkspaceFileOperation,
    executeAgentWorkspaceManagementOperation,
    executeCapabilityPackageOperation,
    executeWorkspaceGovernanceOperation,
    executeCodeManagementOperation,
    executeKnowledgeTransformationOperation,
    executeProtocolFacadeOperation,
    executeGerritOperation,
    executeRepoDomainOperation,
    executeAssetLineageOperation,
    executeDataConnectorOperation,
    executePerformanceCapacityOperation,
    executeRuntimeDependencyOperation
  ]) {
    const operationResult = await executor({ operationId, input, context });
    if (operationResult) {
      return operationResult;
    }
  }
  return result(501, {
    ok: false,
    error: {
      code: "console_domain_operation_not_registered",
      message: "Console domain operation is not registered in the specialized executor.",
      details: { operationId: operationId || "" }
    }
  });
}
