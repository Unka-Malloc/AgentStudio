import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../../common/config/ServerConfig.mjs";

export const CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION = "pact.capability-package-lifecycle.v1";
export const TOOL_PACKAGE_PROTOCOL_VERSION = "pact.tool-package.v1";
export const SKILL_REGISTRY_PROTOCOL_VERSION = "pact.skill-registry.v1";

const REGISTRY_FILE = path.join("capability-packages", "registry.json");
const SKILL_LIBRARY_DIR = path.join("capability-packages", "skill-library");
const MAX_SKILL_BUNDLE_FILES = 64;
const MAX_SKILL_BUNDLE_FILE_BYTES = 512 * 1024;
const KIND_PROTOCOL = Object.freeze({
  tool: TOOL_PACKAGE_PROTOCOL_VERSION,
  skill: SKILL_REGISTRY_PROTOCOL_VERSION
});
const VALID_KINDS = new Set(Object.keys(KIND_PROTOCOL));
const VALID_RISKS = new Set(["read_only", "safe_write", "repair_write", "destructive"]);
const VALID_SANDBOXES = new Set(["none", "knowledge-only", "document-runtime", "server-runtime", "server-admin", "remote-token"]);
const VALID_STATUSES = new Set(["submitted", "approved", "rejected", "installed", "active", "deprecated", "rolled_back", "archived"]);

function nowIso() {
  return new Date().toISOString();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => normalizeText(item)).filter(Boolean))];
  }
  if (typeof value === "string") {
    return normalizeStringList(value.split(","));
  }
  return [];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function capabilityPackageSignedPayload(manifest = {}) {
  const value = asObject(manifest);
  return {
    kind: normalizeText(value.kind),
    name: normalizeText(value.name),
    version: normalizeText(value.version),
    capabilities: normalizeStringList(value.capabilities),
    risk: normalizeText(value.risk || "read_only"),
    inputSchema: asObject(value.inputSchema, { type: "object" }),
    outputSchema: asObject(value.outputSchema, { type: "object" }),
    secretRefs: normalizeStringList(value.secretRefs),
    dependencies: asArray(value.dependencies).map(normalizeDependency).filter((item) => item.name),
    compatibility: normalizeCompatibility(value.compatibility),
    sandbox: normalizeSandbox(value.sandbox),
    license: normalizeText(value.license),
    source: normalizeText(value.source),
    owner: normalizeText(value.owner)
  };
}

export function capabilityPackageDigest(manifest = {}) {
  return sha256(stableJson(capabilityPackageSignedPayload(manifest)));
}

function registryPath(userDataPath = "") {
  return path.join(userDataPath || ServerConfig.getDataDir(), REGISTRY_FILE);
}

function skillLibraryRoot(userDataPath = "", packageId = "") {
  return path.join(userDataPath || ServerConfig.getDataDir(), SKILL_LIBRARY_DIR, normalizeText(packageId));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function packageKey(kind, name) {
  return `${normalizeText(kind)}:${normalizeText(name)}`;
}

function packageIdFor(manifest = {}) {
  return `${normalizeText(manifest.kind)}_${sha256(`${manifest.kind}:${manifest.name}:${manifest.version}`).slice(0, 16)}`;
}

function manifestInputFromPackageInput(input = {}) {
  const value = asObject(input);
  return asObject(value.manifest || value.skillManifest || value.packageManifest || value);
}

function safeBundlePath(value = "") {
  const normalized = String(value || "").replace(/\\/g, "/").trim();
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || normalized.startsWith("/") || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Invalid skill bundle file path: ${value}`);
  }
  return parts.join("/");
}

function decodeBundleFileContent(file = {}) {
  if (file.contentBase64 !== undefined) {
    return Buffer.from(String(file.contentBase64 || ""), "base64");
  }
  return Buffer.from(String(file.content || ""), "utf8");
}

function normalizeSkillBundleFiles(input = {}) {
  const value = asObject(input);
  const rawFiles = asArray(value.files || value.bundle?.files || value.artifacts?.files).slice(0, MAX_SKILL_BUNDLE_FILES);
  return rawFiles.map((file) => {
    const source = asObject(file);
    const relativePath = safeBundlePath(source.path || source.filePath || source.name);
    const content = decodeBundleFileContent(source);
    if (content.byteLength > MAX_SKILL_BUNDLE_FILE_BYTES) {
      throw new Error(`Skill bundle file is too large: ${relativePath}`);
    }
    return {
      path: relativePath,
      content,
      byteLength: content.byteLength,
      digestSha256: sha256Buffer(content)
    };
  });
}

async function writeSkillLibraryBundle({ userDataPath = "", manifest = {}, files = [], actor = "" } = {}) {
  const root = skillLibraryRoot(userDataPath, manifest.packageId);
  const filesRoot = path.join(root, "files");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(filesRoot, { recursive: true });
  await writeJson(path.join(root, "manifest.json"), manifest);
  for (const file of files) {
    const targetPath = path.join(filesRoot, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content);
  }
  const publicFiles = files.map((file) => ({
    path: file.path,
    byteLength: file.byteLength,
    digestSha256: file.digestSha256
  }));
  const totalBytes = publicFiles.reduce((sum, file) => sum + file.byteLength, 0);
  const descriptor = {
    schemaVersion: 1,
    protocolVersion: SKILL_REGISTRY_PROTOCOL_VERSION,
    storage: "server-skill-library",
    packageId: manifest.packageId,
    actor: normalizeText(actor),
    root: path.join(SKILL_LIBRARY_DIR, manifest.packageId),
    manifestPath: path.join(SKILL_LIBRARY_DIR, manifest.packageId, "manifest.json"),
    filesRoot: path.join(SKILL_LIBRARY_DIR, manifest.packageId, "files"),
    fileCount: publicFiles.length,
    totalBytes,
    artifactDigestSha256: sha256(stableJson(publicFiles)),
    files: publicFiles,
    createdAt: nowIso()
  };
  await writeJson(path.join(root, "library.json"), descriptor);
  return descriptor;
}

function normalizeDependency(value = {}) {
  const dependency = asObject(value);
  return {
    kind: normalizeText(dependency.kind || "tool"),
    name: normalizeText(dependency.name),
    versionRange: normalizeText(dependency.versionRange || dependency.version || "*"),
    optional: dependency.optional === true
  };
}

function normalizeCompatibility(value = {}) {
  const compatibility = asObject(value);
  return {
    minServerVersion: normalizeText(compatibility.minServerVersion || ""),
    maxServerVersion: normalizeText(compatibility.maxServerVersion || ""),
    featureIds: normalizeStringList(compatibility.featureIds || compatibility.features),
    platforms: normalizeStringList(compatibility.platforms)
  };
}

function normalizeSandbox(value = {}) {
  const sandbox = asObject(value);
  const policy = normalizeText(sandbox.policy || value || "none");
  return {
    policy: VALID_SANDBOXES.has(policy) ? policy : "none",
    network: sandbox.network === true,
    filesystem: normalizeText(sandbox.filesystem || "none"),
    commands: normalizeStringList(sandbox.commands)
  };
}

export function normalizeCapabilityPackageManifest(input = {}) {
  const value = asObject(input);
  const kind = normalizeText(value.kind || value.packageKind);
  const name = normalizeText(value.name || value.packageName);
  const version = normalizeText(value.version);
  const risk = normalizeText(value.risk || "read_only");
  const manifest = {
    schemaVersion: 1,
    protocolVersion: KIND_PROTOCOL[kind] || "",
    lifecycleProtocolVersion: CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION,
    packageId: normalizeText(value.packageId || "") || packageIdFor({ kind, name, version }),
    kind,
    name,
    version,
    title: normalizeText(value.title || value.label || name),
    description: normalizeText(value.description),
    owner: normalizeText(value.owner || "external"),
    source: normalizeText(value.source || "external"),
    capabilities: normalizeStringList(value.capabilities),
    risk,
    inputSchema: asObject(value.inputSchema, { type: "object" }),
    outputSchema: asObject(value.outputSchema, { type: "object" }),
    secretRefs: normalizeStringList(value.secretRefs),
    dependencies: asArray(value.dependencies).map(normalizeDependency).filter((item) => item.name),
    compatibility: normalizeCompatibility(value.compatibility),
    sandbox: normalizeSandbox(value.sandbox),
    license: normalizeText(value.license),
    signature: {
      required: value.signature?.required !== false,
      algorithm: normalizeText(value.signature?.algorithm || "sha256"),
      digestSha256: normalizeText(value.signature?.digestSha256 || value.digestSha256 || "")
    },
    metadata: asObject(value.metadata)
  };
  return manifest;
}

function validateManifest(manifest = {}) {
  const issues = [];
  const requireField = (field, message) => {
    if (!manifest[field] || (Array.isArray(manifest[field]) && manifest[field].length === 0)) {
      issues.push({ field, message });
    }
  };
  if (!VALID_KINDS.has(manifest.kind)) {
    issues.push({ field: "kind", message: "kind must be tool or skill" });
  }
  requireField("name", "name is required");
  requireField("version", "version is required");
  requireField("capabilities", "capabilities are required");
  requireField("license", "license is required");
  if (!VALID_RISKS.has(manifest.risk)) {
    issues.push({ field: "risk", message: "risk is invalid" });
  }
  if (!manifest.inputSchema || manifest.inputSchema.type !== "object") {
    issues.push({ field: "inputSchema", message: "inputSchema.type must be object" });
  }
  if (!VALID_SANDBOXES.has(manifest.sandbox.policy)) {
    issues.push({ field: "sandbox.policy", message: "sandbox policy is invalid" });
  }
  if (manifest.risk !== "read_only" && manifest.sandbox.policy === "none") {
    issues.push({ field: "sandbox.policy", message: "write-capable packages require a sandbox policy" });
  }
  if (manifest.secretRefs.length > 0 && manifest.sandbox.policy === "server-admin") {
    issues.push({ field: "sandbox.policy", message: "secret-using packages cannot default to server-admin sandbox" });
  }
  const expectedDigest = capabilityPackageDigest(manifest);
  if (manifest.signature.required && manifest.signature.digestSha256 !== expectedDigest) {
    issues.push({ field: "signature.digestSha256", message: "signature digest does not match manifest payload" });
  }
  return {
    ok: issues.length === 0,
    issues,
    expectedDigest
  };
}

function normalizeRecord(record = {}) {
  return {
    manifest: normalizeCapabilityPackageManifest(record.manifest || record),
    status: VALID_STATUSES.has(record.status) ? record.status : "submitted",
    submittedBy: normalizeText(record.submittedBy),
    reviewedBy: normalizeText(record.reviewedBy),
    installedAt: normalizeText(record.installedAt),
    activatedAt: normalizeText(record.activatedAt),
    deprecatedAt: normalizeText(record.deprecatedAt),
    rollbackOf: normalizeText(record.rollbackOf),
    library: asObject(record.library),
    createdAt: normalizeText(record.createdAt || nowIso()),
    updatedAt: normalizeText(record.updatedAt || nowIso()),
    lifecycleEvents: asArray(record.lifecycleEvents)
  };
}

function emptyRegistry() {
  return {
    schemaVersion: 1,
    protocolVersion: CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    packages: {},
    activeByKey: {},
    auditEvents: []
  };
}

function publicRecord(record = {}) {
  const normalized = normalizeRecord(record);
  return {
    ...normalized,
    manifest: {
      ...normalized.manifest,
      signature: {
        ...normalized.manifest.signature,
        digestSha256: normalized.manifest.signature.digestSha256
      }
    }
  };
}

function packageSummary(registry = {}) {
  const records = Object.values(asObject(registry.packages)).map(publicRecord);
  const byStatus = {};
  const byKind = {};
  for (const record of records) {
    byStatus[record.status] = Number(byStatus[record.status] || 0) + 1;
    byKind[record.manifest.kind] = Number(byKind[record.manifest.kind] || 0) + 1;
  }
  return {
    total: records.length,
    byStatus,
    byKind,
    activeCount: Object.keys(asObject(registry.activeByKey)).length
  };
}

function addAudit(registry = {}, event = {}) {
  const nextEvent = {
    eventId: `cap_pkg_evt_${crypto.randomUUID()}`,
    createdAt: nowIso(),
    ...event
  };
  return {
    ...registry,
    auditEvents: [...asArray(registry.auditEvents), nextEvent].slice(-1000)
  };
}

function appendLifecycle(record = {}, event = {}) {
  return {
    ...record,
    updatedAt: nowIso(),
    lifecycleEvents: [
      ...asArray(record.lifecycleEvents),
      {
        eventId: `cap_pkg_lifecycle_${crypto.randomUUID()}`,
        createdAt: nowIso(),
        ...event
      }
    ]
  };
}

function compareVersion(left = "", right = "") {
  const leftParts = String(left).split(".").map((item) => Number(item) || 0);
  const rightParts = String(right).split(".").map((item) => Number(item) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function dependencySatisfied(dependency = {}, records = []) {
  const matches = records.filter((record) =>
    record.manifest.kind === dependency.kind &&
    record.manifest.name === dependency.name &&
    ["installed", "active"].includes(record.status)
  );
  if (dependency.versionRange === "*" || !dependency.versionRange) {
    return matches.length > 0;
  }
  if (dependency.versionRange.startsWith(">=")) {
    const min = dependency.versionRange.slice(2).trim();
    return matches.some((record) => compareVersion(record.manifest.version, min) >= 0);
  }
  return matches.some((record) => record.manifest.version === dependency.versionRange);
}

function buildInstallPlan(manifest = {}, registry = emptyRegistry()) {
  const validation = validateManifest(manifest);
  const records = Object.values(asObject(registry.packages)).map(publicRecord);
  const dependencyChecks = manifest.dependencies.map((dependency) => ({
    ...dependency,
    satisfied: dependency.optional || dependencySatisfied(dependency, records)
  }));
  const missingDependencies = dependencyChecks.filter((item) => !item.satisfied);
  const approvalRequired = manifest.risk === "repair_write" || manifest.risk === "destructive" || manifest.secretRefs.length > 0;
  return {
    protocolVersion: CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION,
    packageId: manifest.packageId,
    ok: validation.ok && missingDependencies.length === 0,
    validation,
    checks: {
      signature: {
        ok: !validation.issues.some((issue) => issue.field === "signature.digestSha256"),
        expectedDigest: validation.expectedDigest,
        declaredDigest: manifest.signature.digestSha256
      },
      license: { ok: Boolean(manifest.license), value: manifest.license },
      sandbox: { ok: !validation.issues.some((issue) => issue.field === "sandbox.policy"), policy: manifest.sandbox.policy },
      compatibility: { ok: true, ...manifest.compatibility },
      dependencies: dependencyChecks
    },
    approvalRequired,
    missingDependencies,
    secretRefs: manifest.secretRefs,
    risk: manifest.risk
  };
}

function transitionRecord(record = {}, action = "", payload = {}) {
  const actor = normalizeText(payload.actor || payload.reviewedBy || payload.submittedBy || "system");
  const reason = normalizeText(payload.reason);
  const current = normalizeRecord(record);
  if (action === "approve") {
    if (!["submitted", "rejected"].includes(current.status)) {
      throw new Error(`Cannot approve package from status ${current.status}.`);
    }
    return appendLifecycle({
      ...current,
      status: "approved",
      reviewedBy: actor
    }, { action, actor, reason });
  }
  if (action === "reject") {
    if (!["submitted", "approved"].includes(current.status)) {
      throw new Error(`Cannot reject package from status ${current.status}.`);
    }
    return appendLifecycle({
      ...current,
      status: "rejected",
      reviewedBy: actor
    }, { action, actor, reason });
  }
  if (action === "install") {
    if (!["approved", "installed", "active"].includes(current.status)) {
      throw new Error(`Cannot install package from status ${current.status}.`);
    }
    return appendLifecycle({
      ...current,
      status: "installed",
      installedAt: current.installedAt || nowIso()
    }, { action, actor, reason });
  }
  if (action === "activate") {
    if (!["installed", "active"].includes(current.status)) {
      throw new Error(`Cannot activate package from status ${current.status}.`);
    }
    return appendLifecycle({
      ...current,
      status: "active",
      activatedAt: nowIso()
    }, { action, actor, reason });
  }
  if (action === "deprecate") {
    if (!["installed", "active"].includes(current.status)) {
      throw new Error(`Cannot deprecate package from status ${current.status}.`);
    }
    return appendLifecycle({
      ...current,
      status: "deprecated",
      deprecatedAt: nowIso()
    }, { action, actor, reason });
  }
  if (action === "archive") {
    return appendLifecycle({
      ...current,
      status: "archived"
    }, { action, actor, reason });
  }
  throw new Error(`Unsupported package lifecycle action: ${action}.`);
}

export function createCapabilityPackageRegistry({ userDataPath = "" } = {}) {
  async function loadRegistry() {
    const loaded = await readJson(registryPath(userDataPath), emptyRegistry());
    return {
      ...emptyRegistry(),
      ...loaded,
      packages: asObject(loaded.packages),
      activeByKey: asObject(loaded.activeByKey),
      auditEvents: asArray(loaded.auditEvents)
    };
  }

  async function saveRegistry(registry) {
    const next = {
      ...registry,
      protocolVersion: CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION,
      updatedAt: nowIso()
    };
    await writeJson(registryPath(userDataPath), next);
    return next;
  }

  async function describe() {
    const registry = await loadRegistry();
    const records = Object.values(registry.packages).map(publicRecord);
    return {
      schemaVersion: 1,
      protocolVersion: CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION,
      toolPackageProtocolVersion: TOOL_PACKAGE_PROTOCOL_VERSION,
      skillRegistryProtocolVersion: SKILL_REGISTRY_PROTOCOL_VERSION,
      registryPath: REGISTRY_FILE,
      updatedAt: registry.updatedAt,
      summary: packageSummary(registry),
      activeByKey: registry.activeByKey,
      packages: records,
      auditEvents: registry.auditEvents.slice(-100)
    };
  }

  async function plan(manifestInput = {}) {
    const registry = await loadRegistry();
    const manifest = normalizeCapabilityPackageManifest(manifestInputFromPackageInput(manifestInput));
    return buildInstallPlan(manifest, registry);
  }

  async function submit(manifestInput = {}, options = {}) {
    const registry = await loadRegistry();
    const manifest = normalizeCapabilityPackageManifest(manifestInputFromPackageInput(manifestInput));
    const installPlan = buildInstallPlan(manifest, registry);
    if (!installPlan.validation.ok) {
      const error = new Error("Capability package manifest is invalid.");
      error.details = installPlan.validation.issues;
      throw error;
    }
    if (installPlan.missingDependencies.length > 0) {
      const error = new Error("Capability package dependencies are not satisfied.");
      error.details = installPlan.missingDependencies;
      throw error;
    }
    const actor = normalizeText(options.submittedBy || options.actor || "system");
    const files = manifest.kind === "skill" ? normalizeSkillBundleFiles(manifestInput) : [];
    const library = manifest.kind === "skill"
      ? await writeSkillLibraryBundle({ userDataPath, manifest, files, actor })
      : {};
    const record = appendLifecycle({
      manifest,
      status: "submitted",
      submittedBy: actor,
      reviewedBy: "",
      installedAt: "",
      activatedAt: "",
      deprecatedAt: "",
      rollbackOf: "",
      library,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lifecycleEvents: []
    }, { action: "submit", actor });
    const nextRegistry = addAudit({
      ...registry,
      packages: {
        ...registry.packages,
        [manifest.packageId]: record
      }
    }, {
      action: "submit",
      packageId: manifest.packageId,
      actor: record.submittedBy,
      status: record.status
    });
    await saveRegistry(nextRegistry);
    return { record: publicRecord(record), installPlan };
  }

  async function lifecycle(packageId, payload = {}) {
    const registry = await loadRegistry();
    const current = registry.packages[packageId];
    if (!current) {
      throw new Error(`Capability package not found: ${packageId}`);
    }
    const action = normalizeText(payload.action);
    let nextRecord = transitionRecord(current, action, payload);
    const activeByKey = { ...registry.activeByKey };
    const key = packageKey(nextRecord.manifest.kind, nextRecord.manifest.name);
    const packages = { ...registry.packages };
    if (action === "activate") {
      for (const [id, record] of Object.entries(packages)) {
        const normalized = normalizeRecord(record);
        if (id !== packageId && packageKey(normalized.manifest.kind, normalized.manifest.name) === key && normalized.status === "active") {
          packages[id] = appendLifecycle({
            ...normalized,
            status: "installed"
          }, { action: "superseded", actor: normalizeText(payload.actor || "system"), reason: `superseded_by:${packageId}` });
        }
      }
      activeByKey[key] = packageId;
    }
    if (["deprecate", "archive"].includes(action) && activeByKey[key] === packageId) {
      delete activeByKey[key];
    }
    packages[packageId] = nextRecord;
    const nextRegistry = addAudit({
      ...registry,
      packages,
      activeByKey
    }, {
      action,
      packageId,
      actor: normalizeText(payload.actor || "system"),
      status: nextRecord.status
    });
    await saveRegistry(nextRegistry);
    return { record: publicRecord(nextRecord), registry: await describe() };
  }

  async function rollback({ kind, name, actor = "system", reason = "" } = {}) {
    const registry = await loadRegistry();
    const key = packageKey(kind, name);
    const activePackageId = registry.activeByKey[key];
    const records = Object.entries(registry.packages)
      .map(([id, record]) => [id, normalizeRecord(record)])
      .filter(([, record]) => packageKey(record.manifest.kind, record.manifest.name) === key)
      .sort((left, right) => compareVersion(right[1].manifest.version, left[1].manifest.version));
    const target = records.find(([id, record]) => id !== activePackageId && ["installed", "active"].includes(record.status));
    if (!target) {
      throw new Error(`No rollback target for capability package ${key}.`);
    }
    const [targetId] = target;
    return lifecycle(targetId, { action: "activate", actor, reason: reason || `rollback_from:${activePackageId}` });
  }

  return {
    protocolVersion: CAPABILITY_PACKAGE_LIFECYCLE_PROTOCOL_VERSION,
    describe,
    plan,
    submit,
    lifecycle,
    rollback
  };
}
