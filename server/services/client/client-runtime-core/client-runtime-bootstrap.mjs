import { createHash } from "node:crypto";

export const CLIENT_RUNTIME_BOOTSTRAP_PROTOCOL_VERSION = "v0.0.1:agent:client-runtime-bootstrap-1";

export const INLINE_TEXT_MAX_BYTES = 256 * 1024;
export const SCP_SMALL_FILE_MAX_BYTES = 8 * 1024 * 1024;

const FRAMEWORK_VERSION = "0.1.0";
const MODULE_ARTIFACT_MEDIA_TYPE = "application/vnd.pact.client-runtime-module+json";

const MODULES = Object.freeze({
  "runtime-framework": {
    moduleId: "runtime-framework",
    title: "Pact Client Runtime Framework",
    layer: "framework",
    required: true,
    capabilities: ["client.bootstrap", "client.module.install", "client.module.verify"],
    dependencies: []
  },
  "pact-client-cli": {
    moduleId: "pact-client-cli",
    title: "Pact Client CLI",
    layer: "framework",
    required: true,
    capabilities: ["client.cli", "client.rpc", "client.config"],
    dependencies: ["runtime-framework"]
  },
  clientd: {
    moduleId: "clientd",
    title: "Pact Client Daemon",
    layer: "framework",
    required: false,
    capabilities: ["client.daemon", "client.events", "upload.queue.worker"],
    dependencies: ["pact-client-cli"]
  },
  "checkpoint-http-upload": {
    moduleId: "checkpoint-http-upload",
    title: "HTTP Upload Session Checkpoint Transport",
    layer: "transport",
    required: true,
    capabilities: ["upload.session", "upload.chunk", "upload.checkpoint", "upload.resume"],
    dependencies: ["pact-client-cli"]
  },
  "upload-queue": {
    moduleId: "upload-queue",
    title: "Upload Queue",
    layer: "workflow",
    required: false,
    capabilities: ["upload.queue", "upload.pause", "upload.resume", "upload.retry"],
    dependencies: ["clientd", "checkpoint-http-upload"]
  },
  "mcp-local-bridge": {
    moduleId: "mcp-local-bridge",
    title: "Local MCP Bridge",
    layer: "integration",
    required: false,
    capabilities: ["mcp.local", "workspace.file.local-upload"],
    dependencies: ["upload-queue"]
  },
  "transport-local-copy": {
    moduleId: "transport-local-copy",
    title: "Local Shared Filesystem Transport",
    layer: "transport",
    required: false,
    capabilities: ["transport.local-copy"],
    dependencies: ["pact-client-cli"]
  },
  "transport-rsync": {
    moduleId: "transport-rsync",
    title: "rsync over SSH Transport",
    layer: "transport",
    required: false,
    capabilities: ["transport.rsync", "upload.incremental", "upload.directory"],
    dependencies: ["pact-client-cli"]
  },
  "transport-sftp": {
    moduleId: "transport-sftp",
    title: "SFTP Transport",
    layer: "transport",
    required: false,
    capabilities: ["transport.sftp", "upload.large-file"],
    dependencies: ["pact-client-cli"]
  },
  "transport-scp": {
    moduleId: "transport-scp",
    title: "SCP Transport",
    layer: "transport",
    required: false,
    capabilities: ["transport.scp", "upload.small-file"],
    dependencies: ["pact-client-cli"]
  },
  "transport-mcp-inline": {
    moduleId: "transport-mcp-inline",
    title: "MCP Inline Text Upload",
    layer: "transport",
    required: false,
    capabilities: ["transport.mcp-inline", "upload.small-text"],
    dependencies: ["mcp-local-bridge"]
  },
  "knowledge-cache": {
    moduleId: "knowledge-cache",
    title: "Local Knowledge Cache",
    layer: "cache",
    required: false,
    capabilities: ["knowledge.cache", "knowledge.search.local"],
    dependencies: ["pact-client-cli"]
  },
  connectors: {
    moduleId: "connectors",
    title: "Client Data Connectors",
    layer: "connector",
    required: false,
    capabilities: ["connector.install", "connector.sync", "connector.cache"],
    dependencies: ["pact-client-cli", "upload-queue"]
  },
  "mail-import": {
    moduleId: "mail-import",
    title: "Mail Import",
    layer: "connector",
    required: false,
    capabilities: ["mail.import", "mail.index"],
    dependencies: ["connectors"]
  }
});

const CAPABILITY_TO_MODULE = Object.freeze({
  upload: "upload-queue",
  "upload.queue": "upload-queue",
  "upload-queue": "upload-queue",
  "upload.session": "checkpoint-http-upload",
  "workspace-file-upload": "mcp-local-bridge",
  "workspace.file.upload": "mcp-local-bridge",
  mcp: "mcp-local-bridge",
  "mcp-local": "mcp-local-bridge",
  "mcp-local-bridge": "mcp-local-bridge",
  "knowledge-cache": "knowledge-cache",
  knowledge: "knowledge-cache",
  connectors: "connectors",
  connector: "connectors",
  mail: "mail-import",
  "mail-import": "mail-import",
  daemon: "clientd",
  clientd: "clientd",
  "pact-client-cli": "pact-client-cli",
  cli: "pact-client-cli"
});

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.split(",");
  }
  return [];
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeId(value = "") {
  return normalizeText(value).toLowerCase();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function commandSet(input = {}) {
  const raw = asObject(input.client || input.runtimeClient || input);
  const commands = new Set();
  for (const item of asArray(raw.availableCommands || raw.commands || input.availableCommands)) {
    const command = normalizeId(item);
    if (command) {
      commands.add(command);
    }
  }
  const commandMap = asObject(raw.commandAvailability || raw.commands || input.commandAvailability);
  for (const [name, available] of Object.entries(commandMap)) {
    if (available === true) {
      commands.add(normalizeId(name));
    }
  }
  return commands;
}

function hasCommand(commands, name) {
  return commands.has(normalizeId(name));
}

function requestedModules(input = {}) {
  const source = [
    ...asArray(input.modules),
    ...asArray(input.requestedModules),
    ...asArray(input.needs),
    ...asArray(input.capabilities),
    ...asArray(asObject(input.client).modules),
    ...asArray(asObject(input.client).needs)
  ];
  const requested = new Set(["pact-client-cli"]);
  for (const item of source) {
    const key = normalizeId(item);
    if (!key) {
      continue;
    }
    requested.add(MODULES[key] ? key : CAPABILITY_TO_MODULE[key] || key);
  }
  if (requested.has("mcp-local-bridge")) {
    requested.add("upload-queue");
  }
  return [...requested].filter((id) => MODULES[id]);
}

function transferProfile(input = {}) {
  const transfer = asObject(input.transfer || input.fileTransfer || input.upload);
  const totalBytes = Number(
    transfer.totalBytes ??
      transfer.sizeBytes ??
      input.totalBytes ??
      input.sizeBytes ??
      0
  );
  const fileCount = Number(
    transfer.fileCount ??
      input.fileCount ??
      (Array.isArray(input.files) ? input.files.length : 0)
  );
  return {
    totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0,
    fileCount: Number.isFinite(fileCount) && fileCount > 0 ? fileCount : 0,
    directory: transfer.directory === true || transfer.kind === "directory" || input.directory === true,
    incremental: transfer.incremental === true || input.incremental === true,
    sharedFilesystem: transfer.sharedFilesystem === true || input.sharedFilesystem === true
  };
}

function serverCapabilities(input = {}) {
  const value = asObject(input.serverCapabilities || input.server || input.serverTransportCapabilities);
  return {
    localCopy: value.localCopy === true || value.sharedFilesystem === true,
    ssh: value.ssh === true,
    rsync: value.rsync === true,
    sftp: value.sftp === true,
    scp: value.scp === true
  };
}

function candidate(id, available, blockedBy = [], details = {}) {
  return {
    id,
    available: available === true,
    blockedBy: available === true ? [] : uniqueStrings(blockedBy),
    ...details
  };
}

export function planClientRuntimeTransports(input = {}) {
  const commands = commandSet(input);
  const server = serverCapabilities(input);
  const transfer = transferProfile(input);
  const smallSingleFile =
    transfer.fileCount <= 1 &&
    !transfer.directory &&
    transfer.totalBytes > 0 &&
    transfer.totalBytes <= SCP_SMALL_FILE_MAX_BYTES;
  const inlineEligible =
    transfer.fileCount <= 4 &&
    !transfer.directory &&
    transfer.totalBytes > 0 &&
    transfer.totalBytes <= INLINE_TEXT_MAX_BYTES;

  const candidates = [
    candidate(
      "local-copy",
      transfer.sharedFilesystem && server.localCopy,
      [
        transfer.sharedFilesystem ? "" : "client-shared-filesystem-not-declared",
        server.localCopy ? "" : "server-local-copy-not-declared"
      ],
      { moduleId: "transport-local-copy" }
    ),
    candidate(
      "rsync-over-ssh",
      hasCommand(commands, "rsync") && hasCommand(commands, "ssh") && server.rsync && server.ssh,
      [
        hasCommand(commands, "rsync") ? "" : "client-rsync-missing",
        hasCommand(commands, "ssh") ? "" : "client-ssh-missing",
        server.rsync ? "" : "server-rsync-not-declared",
        server.ssh ? "" : "server-ssh-not-declared"
      ],
      { moduleId: "transport-rsync", native: true }
    ),
    candidate(
      "scp",
      smallSingleFile && hasCommand(commands, "scp") && hasCommand(commands, "ssh") && server.scp && server.ssh,
      [
        smallSingleFile ? "" : "not-small-single-file",
        hasCommand(commands, "scp") ? "" : "client-scp-missing",
        hasCommand(commands, "ssh") ? "" : "client-ssh-missing",
        server.scp ? "" : "server-scp-not-declared",
        server.ssh ? "" : "server-ssh-not-declared"
      ],
      { moduleId: "transport-scp", native: true }
    ),
    candidate(
      "sftp",
      hasCommand(commands, "sftp") && hasCommand(commands, "ssh") && server.sftp && server.ssh,
      [
        hasCommand(commands, "sftp") ? "" : "client-sftp-missing",
        hasCommand(commands, "ssh") ? "" : "client-ssh-missing",
        server.sftp ? "" : "server-sftp-not-declared",
        server.ssh ? "" : "server-ssh-not-declared"
      ],
      { moduleId: "transport-sftp", native: true }
    ),
    candidate(
      "pact-http-upload-session",
      true,
      [],
      { moduleId: "checkpoint-http-upload", portable: true }
    ),
    candidate(
      "mcp-inline-content",
      inlineEligible,
      [inlineEligible ? "" : "not-inline-eligible"],
      { moduleId: "transport-mcp-inline", portable: true }
    )
  ];

  const fallbackOrder = candidates.filter((item) => item.available).map((item) => item.id);
  const selected = fallbackOrder[0] || "pact-http-upload-session";
  return {
    selected,
    fallbackOrder,
    candidates,
    transfer,
    thresholds: {
      inlineTextMaxBytes: INLINE_TEXT_MAX_BYTES,
      scpSmallFileMaxBytes: SCP_SMALL_FILE_MAX_BYTES
    }
  };
}

function addModuleWithDependencies(moduleIds, moduleId) {
  const module = MODULES[moduleId];
  if (!module || moduleIds.has(moduleId)) {
    return;
  }
  for (const dependency of module.dependencies || []) {
    addModuleWithDependencies(moduleIds, dependency);
  }
  moduleIds.add(moduleId);
}

function plannedModule(moduleId, requestedSet, transportPlan) {
  const module = MODULES[moduleId];
  return {
    ...module,
    required: module.required === true || requestedSet.has(moduleId),
    selectedTransport: transportPlan.candidates.some((item) => item.moduleId === moduleId && item.id === transportPlan.selected),
    delivery: {
      mode: "client-pull",
      artifactId: `pact-client-runtime/${moduleId}`,
      status: "manifest-only",
      digestSha256: "",
      downloadUrl: ""
    }
  };
}

export function buildClientRuntimeBootstrapPlan(input = {}) {
  const transportPlan = planClientRuntimeTransports(input);
  const requested = requestedModules(input);
  const requestedSet = new Set(requested);
  const moduleIds = new Set();
  addModuleWithDependencies(moduleIds, "runtime-framework");
  for (const moduleId of requested) {
    addModuleWithDependencies(moduleIds, moduleId);
  }
  const selectedTransport = transportPlan.candidates.find((item) => item.id === transportPlan.selected);
  if (selectedTransport?.moduleId) {
    addModuleWithDependencies(moduleIds, selectedTransport.moduleId);
  }
  addModuleWithDependencies(moduleIds, "checkpoint-http-upload");
  if (transportPlan.fallbackOrder.includes("mcp-inline-content")) {
    addModuleWithDependencies(moduleIds, "transport-mcp-inline");
  }

  const modules = [...moduleIds].map((moduleId) => plannedModule(moduleId, requestedSet, transportPlan));
  const client = asObject(input.client || input.runtimeClient);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CLIENT_RUNTIME_BOOTSTRAP_PROTOCOL_VERSION,
    frameworkVersion: FRAMEWORK_VERSION,
    generatedAt: new Date().toISOString(),
    client: {
      clientUid: normalizeText(input.clientUid || client.clientUid || client.uid),
      os: normalizeText(input.os || client.os || client.platform || process.platform),
      arch: normalizeText(input.arch || client.arch || process.arch),
      libc: normalizeText(input.libc || client.libc || ""),
      commands: [...commandSet(input)].sort(),
      requestedModules: requested
    },
    installation: {
      strategy: "client-pull-signed-runtime-modules",
      rootHint: "~/.pact/client-runtime",
      requiresSignatureVerification: true,
      requiresProcessIdentityProvisioning: true,
      processIdentity: {
        protocolVersion: "v0.0.1:risk-control:process-identity-1",
        claimEndpoint: "/api/process-identity/bootstrap/claim",
        rotationEndpoint: "/api/process-identity/package/rotate",
        revocationEndpoint: "/api/process-identity/package/revoke",
        privateKeySource: "client-generated-ed25519",
        serverBinding: "server-signed-client-identity-package",
        claimTokenTransport: "0600-local-file-or-equivalent-supervisor-secret",
        defaultIdentityReplacement: true
      },
      requiresUserApproval: modules.some((module) => module.capabilities.some((capability) => capability.startsWith("transport."))),
      artifactStatus: "manifest-only",
      note: "This endpoint resolves the trimmed client runtime plan. Binary artifact download URLs are filled by the release/package publisher."
    },
    transportPlan,
    modules
  };
}

function buildInlineModuleArtifact({ module, plan, input }) {
  const artifactManifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CLIENT_RUNTIME_BOOTSTRAP_PROTOCOL_VERSION,
    artifactKind: "client-runtime-module-descriptor",
    module: {
      moduleId: module.moduleId,
      title: module.title,
      layer: module.layer,
      version: FRAMEWORK_VERSION,
      capabilities: module.capabilities,
      dependencies: module.dependencies,
      selectedTransport: module.selectedTransport === true
    },
    client: plan.client,
    transportPlan: {
      selected: plan.transportPlan.selected,
      fallbackOrder: plan.transportPlan.fallbackOrder,
      thresholds: plan.transportPlan.thresholds
    },
    constraints: {
      completeClient: false,
      includesServerRepository: false,
      trimmedByRequestedModules: true
    }
  };
  const payload = stableJson(artifactManifest);
  const digestSha256 = sha256Hex(payload);
  return {
    artifactId: module.delivery.artifactId,
    moduleId: module.moduleId,
    version: FRAMEWORK_VERSION,
    fileName: `${module.moduleId}-${FRAMEWORK_VERSION}.pact-client-runtime-module.json`,
    mediaType: MODULE_ARTIFACT_MEDIA_TYPE,
    byteSize: Buffer.byteLength(payload, "utf8"),
    digestSha256,
    downloadUrl: normalizeText(asObject(input.artifactUrls)[module.moduleId]),
    status: "inline-manifest",
    packageKind: "module-descriptor",
    signature: {
      required: true,
      algorithm: "ed25519",
      status: "unsigned-preview",
      value: "",
      reason: "runtime-module-publisher-not-configured"
    },
    inlineManifest: artifactManifest
  };
}

export function buildClientRuntimeBootstrapPull(input = {}) {
  const plan = buildClientRuntimeBootstrapPlan(input);
  const artifacts = plan.modules.map((module) => buildInlineModuleArtifact({ module, plan, input }));
  const artifactsByModuleId = new Map(artifacts.map((artifact) => [artifact.moduleId, artifact]));
  const bundleManifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CLIENT_RUNTIME_BOOTSTRAP_PROTOCOL_VERSION,
    artifactKind: "client-runtime-trimmed-bundle",
    frameworkVersion: FRAMEWORK_VERSION,
    client: plan.client,
    requestedModules: plan.client.requestedModules,
    modules: artifacts.map((artifact) => ({
      moduleId: artifact.moduleId,
      artifactId: artifact.artifactId,
      version: artifact.version,
      digestSha256: artifact.digestSha256,
      byteSize: artifact.byteSize,
      status: artifact.status
    })),
    constraints: {
      completeClient: false,
      includesServerRepository: false,
      trimmedByRequestedModules: true
    }
  };
  const bundleDigestSha256 = sha256Hex(stableJson(bundleManifest));

  return {
    ...plan,
    generatedAt: new Date().toISOString(),
    operation: "client_runtime.bootstrap.pull",
    installation: {
      ...plan.installation,
      artifactStatus: "inline-manifest",
      artifactMode: "selective-trimmed-client-runtime",
      pullMode: "inline-manifest-bundle",
      note: "This preview pull returns a trimmed client runtime manifest bundle. Binary module URLs are attached by the release/package publisher when available."
    },
    pull: {
      status: "inline-manifest",
      mode: "selective-trimmed-client-runtime",
      completeClient: false,
      includesServerRepository: false,
      moduleCount: artifacts.length,
      artifactCount: artifacts.length,
      warnings: ["binary-runtime-artifact-publisher-not-configured"]
    },
    bundle: {
      bundleId: `pact-client-runtime/trimmed/${bundleDigestSha256.slice(0, 16)}`,
      version: FRAMEWORK_VERSION,
      mediaType: "application/vnd.pact.client-runtime-bundle+json",
      digestSha256: bundleDigestSha256,
      manifest: bundleManifest
    },
    artifacts,
    modules: plan.modules.map((module) => {
      const artifact = artifactsByModuleId.get(module.moduleId);
      return {
        ...module,
        delivery: {
          ...module.delivery,
          status: artifact?.status || module.delivery.status,
          digestSha256: artifact?.digestSha256 || module.delivery.digestSha256,
          downloadUrl: artifact?.downloadUrl || module.delivery.downloadUrl,
          artifactRef: artifact?.artifactId || module.delivery.artifactId
        }
      };
    })
  };
}
