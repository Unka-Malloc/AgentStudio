import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../../../common/config/ServerConfig.mjs";
import { evaluateKnowledgeAccess } from "../../agent-library/access-policy.mjs";

export const KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION = "pact.knowledge-backend-port.v1";

const BACKEND_CONFIG_FILE = path.join("knowledge", "knowledge-backends.json");
const BACKEND_LEDGER_FILE = path.join("knowledge", "knowledge-backend-ledger.json");
const SUPPORTED_PROVIDERS = new Set(["dify", "ragflow"]);
const SECRET_VALUE_KEYS = new Set([
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "refreshToken",
  "password",
  "clientSecret",
  "authorization"
]);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function digest(value, length = 24) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, value) {
  return `${prefix}::${digest(stableJson(value), 24)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function uniqueStrings(value = []) {
  return [...new Set(asArray(value).map(text).filter(Boolean))];
}

function normalizeRetrievalModes(value = []) {
  return asArray(value)
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const modeValue = text(item.value || item.id || item.mode || item.name);
        if (!modeValue) return null;
        return {
          value: modeValue,
          label: text(item.label || item.title || modeValue)
        };
      }
      const modeValue = text(item);
      return modeValue ? { value: modeValue, label: modeValue } : null;
    })
    .filter(Boolean);
}

function normalizeProvider(value = "") {
  const provider = text(value).toLowerCase();
  if (provider === "dify") return "dify";
  if (provider === "ragflow" || provider === "rag-flow") return "ragflow";
  return provider || "dify";
}

function defaultRetrievalModesForProvider(providerId, provider = {}) {
  if (text(provider.mode || "contract").toLowerCase() === "contract") {
    return [{ value: "backendContract", label: "Backend Contract" }];
  }
  if (providerId === "dify") {
    return [
      { value: "semantic_search", label: "Semantic Search" },
      { value: "full_text_search", label: "Full Text Search" },
      { value: "hybrid_search", label: "Hybrid Search" }
    ];
  }
  if (providerId === "ragflow") {
    return [
      { value: "naive", label: "Naive" },
      { value: "keyword", label: "Keyword" },
      { value: "hybrid", label: "Hybrid" }
    ];
  }
  return [{ value: "backendContract", label: "Backend Contract" }];
}

function resolvedProviderRetrievalModes(providerId, provider = {}) {
  const configured = normalizeRetrievalModes(provider.retrievalModes || provider.searchModes || provider.modes);
  const modes = configured.length ? configured : defaultRetrievalModesForProvider(providerId, provider);
  return modes.filter((mode, index, list) =>
    list.findIndex((candidate) => candidate.value === mode.value) === index
  );
}

function dataRoot(userDataPath = "") {
  return userDataPath || ServerConfig.getDataDir();
}

export function knowledgeBackendConfigPath(userDataPath = "") {
  return path.join(dataRoot(userDataPath), BACKEND_CONFIG_FILE);
}

function ledgerPath(userDataPath = "") {
  return path.join(dataRoot(userDataPath), BACKEND_LEDGER_FILE);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return clone(fallback);
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function defaultProviderConfig() {
  return {
    schemaVersion: 1,
    protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    providers: {
      dify: {
        provider: "dify",
        enabled: true,
        mode: "contract",
        authType: "apiKey",
        secretRef: "secret://pact/knowledge/dify-api-key",
        endpointRef: "config://pact/knowledge/dify-endpoint",
        datasetPort: true,
        retrievalPort: true,
        evidencePort: true,
        exportPort: true,
        capabilities: [
          "backend.connect",
          "space.list",
          "search",
          "evidence.get",
          "export.request",
          "permission.request"
        ],
        contractSpaces: [
          {
            spaceRef: "dify-contract-handbook",
            label: "Dify Contract Handbook",
            description: "Contract metadata fixture for Dify knowledge retrieval.",
            dataClass: "internal",
            sensitivity: "normal"
          }
        ]
      },
      ragflow: {
        provider: "ragflow",
        enabled: true,
        mode: "contract",
        authType: "apiKey",
        secretRef: "secret://pact/knowledge/ragflow-api-key",
        endpointRef: "config://pact/knowledge/ragflow-endpoint",
        datasetPort: true,
        retrievalPort: true,
        evidencePort: true,
        exportPort: true,
        capabilities: [
          "backend.connect",
          "space.list",
          "search",
          "evidence.get",
          "export.request",
          "permission.request"
        ],
        contractSpaces: [
          {
            spaceRef: "ragflow-contract-handbook",
            label: "RAGFlow Contract Handbook",
            description: "Contract metadata fixture for RAGFlow knowledge retrieval.",
            dataClass: "internal",
            sensitivity: "normal"
          }
        ]
      }
    }
  };
}

function emptyLedger() {
  return {
    schemaVersion: 1,
    protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    evidence: {},
    permissionRequests: {},
    exportRequests: {},
    events: []
  };
}

function publicProvider(providerId, provider = {}) {
  return {
    provider: providerId,
    enabled: provider.enabled !== false,
    mode: text(provider.mode || "contract"),
    authType: text(provider.authType || "apiKey"),
    secretRef: text(provider.secretRef || ""),
    endpointRef: text(provider.endpointRef || ""),
    datasetPort: provider.datasetPort !== false,
    retrievalPort: provider.retrievalPort !== false,
    evidencePort: provider.evidencePort !== false,
    exportPort: provider.exportPort !== false,
    capabilities: uniqueStrings(provider.capabilities),
    retrievalModes: resolvedProviderRetrievalModes(providerId, provider),
    contractVerified: text(provider.mode || "contract") === "contract"
  };
}

function publicManifest(config = {}, configFilePath = "") {
  const providers = {};
  for (const [providerId, provider] of Object.entries(asObject(config.providers))) {
    if (!SUPPORTED_PROVIDERS.has(providerId)) continue;
    providers[providerId] = publicProvider(providerId, provider);
  }
  return {
    schemaVersion: Number(config.schemaVersion || 1),
    protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
    configPath: configFilePath,
    providers,
    providerCount: Object.keys(providers).length,
    enabledProviderCount: Object.values(providers).filter((provider) => provider.enabled).length,
    secretPolicy: "secretRefOnly",
    contractMode: Object.values(providers).some((provider) => provider.contractVerified),
    updatedAt: text(config.updatedAt || "")
  };
}

function providerSpaces(providerId, provider = {}) {
  return asArray(provider.contractSpaces).map((space, index) => {
    const spaceRef = text(space.spaceRef || `contract-space-${index + 1}`);
    const label = text(space.label || `${providerId} knowledge space`);
    const derivedKnowledgeSpace = stableId("derived_knowledge_space", { providerId, spaceRef });
    const derivedViewRef = stableId("derived_view", { providerId, spaceRef, view: "default" });
    const upstreamKnowledgeRef = stableId("upstream_knowledge_ref", { providerId, spaceRef });
    return {
      spaceId: stableId("knowledge_space", { providerId, spaceRef }),
      provider: providerId,
      label,
      description: text(space.description || ""),
      derivedKnowledgeSpace,
      derivedViewRef,
      upstreamKnowledgeRef,
      upstreamPolicyRef: stableId("upstream_policy_ref", { providerId, spaceRef }),
      dataClass: text(space.dataClass || "internal"),
      sensitivity: text(space.sensitivity || "normal"),
      accessMode: "metadataOnly",
      allowedEgress: ["searchResult"],
      retrievalModes: resolvedProviderRetrievalModes(providerId, provider),
      contractVerified: text(provider.mode || "contract") === "contract",
      metadataOnly: true
    };
  });
}

function sanitizeSpaces(spaces = []) {
  return spaces.map((space) => ({
    spaceId: space.spaceId,
    provider: space.provider,
    label: space.label,
    description: space.description,
    derivedKnowledgeSpace: space.derivedKnowledgeSpace,
    derivedViewRef: space.derivedViewRef,
    upstreamKnowledgeRef: space.upstreamKnowledgeRef,
    upstreamPolicyRef: space.upstreamPolicyRef,
    dataClass: space.dataClass,
    sensitivity: space.sensitivity,
    accessMode: space.accessMode,
    allowedEgress: space.allowedEgress,
    retrievalModes: space.retrievalModes,
    searchModes: space.retrievalModes,
    metadataOnly: true,
    contractVerified: space.contractVerified
  }));
}

function containsSecretValue(input = {}) {
  for (const [key, value] of Object.entries(asObject(input))) {
    if (SECRET_VALUE_KEYS.has(key) && text(value)) {
      return key;
    }
  }
  return "";
}

function subjectIds(subject = {}) {
  return uniqueStrings([
    subject.subjectId,
    subject.username,
    subject.id,
    subject.type === "anonymous" ? "" : "owner"
  ]);
}

function createViewForSpace({ space, subject, accessMode = "metadataOnly", egress = ["searchResult"] } = {}) {
  const subjects = subjectIds(subject);
  return {
    upstreamKnowledgeRef: space.upstreamKnowledgeRef,
    upstreamPolicyRef: space.upstreamPolicyRef,
    derivedViewRef: space.derivedViewRef,
    derivedKnowledgeSpace: space.derivedKnowledgeSpace,
    dataClass: space.dataClass,
    sensitivity: space.sensitivity,
    allowedSubjects: subjects,
    allowedActions: ["discover", "read", "export"],
    checkoutPolicy: {
      allowRetain: false,
      allowShare: false,
      expiresInSeconds: 3600,
      revocationPolicy: "revoke-on-policy-change"
    },
    refs: [
      {
        ref: space.derivedViewRef,
        refType: "derivedKnowledgeView"
      }
    ],
    authorizationOverlay: {
      defaultAccessMode: "deny",
      defaultEgress: [],
      rules: subjects.map((subjectId) => ({
        ruleId: `allow-${digest(subjectId, 10)}`,
        effect: "allow",
        subjects: [subjectId],
        actions: ["discover", "read", "export"],
        egress,
        targetRefs: [space.derivedViewRef],
        accessMode,
        reason: "v001-knowledge-backend-contract"
      }))
    }
  };
}

function accessRequest({ subject, workspaceId = "default", taskId = "", action = "discover", egress = "searchResult", accessMode = "metadataOnly", targetRef = "" } = {}) {
  return {
    subject,
    operatorId: subject?.subjectId || subject?.username || "",
    workspaceId,
    taskId,
    requestedAction: action,
    requestedEgress: egress,
    requestedAccessMode: accessMode,
    targetRefs: targetRef ? [{ ref: targetRef, refType: "derivedKnowledgeView" }] : []
  };
}

function appendEvent(ledger, type, payload = {}) {
  const event = {
    eventId: stableId("knowledge_backend_event", { type, payload, nonce: randomUUID() }),
    protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
    type,
    payload: clone(payload),
    createdAt: nowIso()
  };
  ledger.events.push(event);
  ledger.updatedAt = event.createdAt;
  return event;
}

function evidenceBody({ providerId, space, query }) {
  return [
    `Contract evidence from ${providerId.toUpperCase()} for query "${query || "knowledge"}".`,
    "This body is only returned after Pact authorization emits a receipt and loan record.",
    `Derived view: ${space.derivedViewRef}`
  ].join("\n");
}

function evidenceRecord({ providerId, provider, space, query, subject, workspaceId }) {
  const evidenceId = stableId("knowledge_backend_evidence", {
    providerId,
    spaceId: space.spaceId,
    query
  });
  const title = `${space.label}: ${query || "contract retrieval"}`;
  const view = createViewForSpace({
    space,
    subject,
    accessMode: "copyToContext",
    egress: ["searchResult", "evidenceRead", "contextBundle"]
  });
  return {
    evidenceId,
    provider: providerId,
    providerMode: text(provider.mode || "contract"),
    secretRef: text(provider.secretRef || ""),
    endpointRef: text(provider.endpointRef || ""),
    spaceId: space.spaceId,
    derivedKnowledgeSpace: space.derivedKnowledgeSpace,
    derivedViewRef: space.derivedViewRef,
    upstreamKnowledgeRef: space.upstreamKnowledgeRef,
    upstreamPolicyRef: space.upstreamPolicyRef,
    title,
    query,
    body: evidenceBody({ providerId, space, query }),
    citation: {
      evidenceId,
      derivedViewRef: space.derivedViewRef,
      upstreamKnowledgeRef: space.upstreamKnowledgeRef
    },
    view,
    workspaceId,
    contractVerified: text(provider.mode || "contract") === "contract",
    createdAt: nowIso()
  };
}

function publicSearchItem(record, score = 0.82) {
  return {
    evidenceId: record.evidenceId,
    itemId: record.derivedViewRef,
    itemType: "derivedKnowledgeView",
    provider: record.provider,
    title: record.title,
    score,
    derivedKnowledgeSpace: record.derivedKnowledgeSpace,
    derivedViewRef: record.derivedViewRef,
    upstreamKnowledgeRef: record.upstreamKnowledgeRef,
    source: {
      kind: "externalKnowledgeBackend",
      provider: record.provider,
      derivedViewRef: record.derivedViewRef
    },
    redactions: ["body", "snippet", "upstreamObjectId", "privatePath"],
    metadataOnly: true,
    contractVerified: record.contractVerified
  };
}

function explicitAuthorization(input = {}) {
  return input.confirm === true ||
    input.authorized === true ||
    input.authorization?.approved === true ||
    input.authorization?.decision === "approved";
}

export function isKnowledgeBackendEvidenceId(evidenceId = "") {
  return String(evidenceId || "").startsWith("knowledge_backend_evidence::");
}

export function createKnowledgeBackendPort({ userDataPath = "" } = {}) {
  const configFilePath = knowledgeBackendConfigPath(userDataPath);
  const ledgerFilePath = ledgerPath(userDataPath);

  async function loadConfig() {
    const defaults = defaultProviderConfig();
    const config = await readJson(configFilePath, defaults);
    let changed = false;
    for (const [providerId, provider] of Object.entries(defaults.providers)) {
      if (!config.providers?.[providerId]) {
        config.providers = {
          ...asObject(config.providers),
          [providerId]: provider
        };
        changed = true;
      }
    }
    if (changed) {
      config.updatedAt = nowIso();
      await writeJson(configFilePath, config);
    } else {
      await fs.mkdir(path.dirname(configFilePath), { recursive: true });
      await fs.access(configFilePath).catch(() => writeJson(configFilePath, config));
    }
    return config;
  }

  async function loadLedger() {
    const ledger = await readJson(ledgerFilePath, emptyLedger());
    await fs.mkdir(path.dirname(ledgerFilePath), { recursive: true });
    await fs.access(ledgerFilePath).catch(() => writeJson(ledgerFilePath, ledger));
    return ledger;
  }

  async function saveLedger(ledger) {
    ledger.updatedAt = nowIso();
    await writeJson(ledgerFilePath, ledger);
  }

  async function manifest() {
    const config = await loadConfig();
    return publicManifest(config, configFilePath);
  }

  async function connect(input = {}) {
    const leakedKey = containsSecretValue(input);
    if (leakedKey) {
      const error = new Error(`Knowledge backend secret value must be referenced by secretRef, not inline ${leakedKey}.`);
      error.code = "INLINE_SECRET_VALUE";
      throw error;
    }
    const config = await loadConfig();
    const providerId = normalizeProvider(input.provider || input.backend || "dify");
    if (!SUPPORTED_PROVIDERS.has(providerId) || !config.providers?.[providerId]) {
      const error = new Error(`Unsupported knowledge backend provider: ${providerId}`);
      error.code = "UNSUPPORTED_PROVIDER";
      throw error;
    }
    const provider = config.providers[providerId];
    const secretRef = text(input.secretRef || provider.secretRef || "");
    if (!secretRef.startsWith("secret://")) {
      const error = new Error("Knowledge backend connection requires a secret:// secretRef.");
      error.code = "SECRET_REF_REQUIRED";
      throw error;
    }
    config.providers[providerId] = {
      ...provider,
      secretRef,
      endpointRef: text(input.endpointRef || provider.endpointRef || ""),
      mode: text(input.mode || provider.mode || "contract"),
      lastConnectedAt: nowIso()
    };
    config.updatedAt = nowIso();
    await writeJson(configFilePath, config);
    const ledger = await loadLedger();
    appendEvent(ledger, "knowledge.backend.connect", {
      provider: providerId,
      mode: config.providers[providerId].mode,
      secretRef,
      contractVerified: config.providers[providerId].mode === "contract"
    });
    await saveLedger(ledger);
    return {
      ok: true,
      protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
      provider: publicProvider(providerId, config.providers[providerId]),
      manifest: publicManifest(config, configFilePath),
      secretPolicy: "secretRefOnly",
      contractVerified: config.providers[providerId].mode === "contract"
    };
  }

  async function listSpaces(input = {}) {
    const config = await loadConfig();
    const providerFilter = text(input.provider || input.backend || "");
    const providers = Object.entries(asObject(config.providers))
      .filter(([providerId, provider]) =>
        SUPPORTED_PROVIDERS.has(providerId) &&
        provider.enabled !== false &&
        (!providerFilter || normalizeProvider(providerFilter) === providerId)
      );
    const spaces = providers.flatMap(([providerId, provider]) => providerSpaces(providerId, provider));
    return {
      ok: true,
      protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
      spaces: sanitizeSpaces(spaces),
      count: spaces.length,
      metadataPolicy: "safeMetadataOnly",
      redactions: ["upstreamObjectId", "privatePath", "body", "snippet"],
      contractVerified: spaces.some((space) => space.contractVerified)
    };
  }

  async function search(input = {}, { subject = {}, workspaceId = "default" } = {}) {
    const config = await loadConfig();
    const ledger = await loadLedger();
    const query = text(input.query || input.q || "");
    const limitInput = input.limit === undefined || input.limit === null || input.limit === "" ? 10 : input.limit;
    const parsedLimit = Number(limitInput);
    const limit = Math.max(1, Math.min(20, Number.isFinite(parsedLimit) ? parsedLimit : 10));
    const providerFilter = text(input.provider || input.backend || "");
    const spaceFilter = text(input.spaceId || input.knowledgeSpaceId || input.space || "");
    const allSpaces = (await listSpaces({ provider: providerFilter })).spaces;
    const scopedSpaces = spaceFilter
      ? allSpaces.filter((space) =>
          [space.spaceId, space.derivedKnowledgeSpace, space.derivedViewRef, space.upstreamKnowledgeRef]
            .map(text)
            .includes(spaceFilter)
        )
      : allSpaces;
    const selectedSpaces = (scopedSpaces.length ? scopedSpaces : allSpaces).slice(0, limit);
    const requestedRetrievalMode = text(input.retrievalMode || input.mode || "");
    const firstModes = normalizeRetrievalModes(selectedSpaces[0]?.retrievalModes || selectedSpaces[0]?.searchModes || []);
    const effectiveRetrievalMode = firstModes.some((mode) => mode.value === requestedRetrievalMode)
      ? requestedRetrievalMode
      : firstModes[0]?.value || "backendContract";
    const items = [];
    const decisions = [];
    for (const space of selectedSpaces) {
      const provider = config.providers[space.provider];
      const view = createViewForSpace({
        space,
        subject,
        accessMode: "metadataOnly",
        egress: ["searchResult"]
      });
      const decision = evaluateKnowledgeAccess(
        accessRequest({
          subject,
          workspaceId,
          action: "discover",
          egress: "searchResult",
          accessMode: "metadataOnly",
          targetRef: space.derivedViewRef
        }),
        { view }
      );
      decisions.push(decision);
      if (!decision.allowed) continue;
      const record = evidenceRecord({
        providerId: space.provider,
        provider,
        space,
        query,
        subject,
        workspaceId
      });
      ledger.evidence[record.evidenceId] = record;
      items.push(publicSearchItem(record, Math.max(0.5, 0.92 - items.length * 0.04)));
    }
    appendEvent(ledger, "knowledge.search", {
      query,
      provider: providerFilter || "all",
      itemCount: items.length,
      metadataOnly: true
    });
    await saveLedger(ledger);
    return {
      ok: true,
      protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
      query,
      retrievalMode: effectiveRetrievalMode,
      backendPort: "KnowledgeBasePort",
      providers: providerFilter ? [normalizeProvider(providerFilter)] : [...SUPPORTED_PROVIDERS],
      spaceId: selectedSpaces[0]?.spaceId || "",
      metadataPolicy: "safeMetadataOnly",
      externalKnowledgeBase: {
        used: true,
        mode: "contract",
        contractVerified: true
      },
      accessDecisions: decisions.map((decision) => ({
        decisionId: decision.decisionId,
        allowed: decision.allowed,
        accessMode: decision.accessMode,
        upstreamAccessDenied: decision.upstreamAccessDenied,
        filteredReason: decision.filteredReason
      })),
      items,
      count: items.length
    };
  }

  async function getEvidence(input = {}, { subject = {}, workspaceId = "default" } = {}) {
    const evidenceId = text(input.evidenceId || input["evidence-id"] || input.id || "");
    if (!evidenceId) return null;
    const ledger = await loadLedger();
    const record = ledger.evidence[evidenceId];
    if (!record) return null;
    const decision = evaluateKnowledgeAccess(
      accessRequest({
        subject,
        workspaceId,
        action: "read",
        egress: "evidenceRead",
        accessMode: "copyToContext",
        targetRef: record.derivedViewRef
      }),
      { view: record.view }
    );
    appendEvent(ledger, decision.allowed ? "knowledge.evidence.get.allowed" : "knowledge.evidence.get.denied", {
      evidenceId,
      provider: record.provider,
      decisionId: decision.decisionId,
      filteredReason: decision.filteredReason
    });
    await saveLedger(ledger);
    if (!decision.allowed) {
      return {
        ok: false,
        httpStatus: 403,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        evidenceId,
        upstreamAccessDenied: true,
        filteredReason: decision.filteredReason || "knowledge_access_denied",
        accessDecision: decision
      };
    }
    return {
      ok: true,
      protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
      evidenceId,
      provider: record.provider,
      providerMode: record.providerMode,
      title: record.title,
      contentType: "text/markdown; charset=utf-8",
      markdown: record.body,
      body: record.body,
      citation: record.citation,
      derivedKnowledgeSpace: record.derivedKnowledgeSpace,
      derivedViewRef: record.derivedViewRef,
      upstreamKnowledgeRef: record.upstreamKnowledgeRef,
      contractVerified: record.contractVerified,
      accessDecision: decision,
      knowledgeAccessReceipt: decision.knowledgeAccessReceipt,
      loanRecord: decision.loanRecord
    };
  }

  async function requestExport(input = {}, { subject = {}, workspaceId = "default" } = {}) {
    const config = await loadConfig();
    const ledger = await loadLedger();
    const providerId = normalizeProvider(input.provider || input.backend || "dify");
    const provider = config.providers?.[providerId];
    if (!provider) {
      const error = new Error(`Unsupported knowledge backend provider: ${providerId}`);
      error.code = "UNSUPPORTED_PROVIDER";
      throw error;
    }
    const space = providerSpaces(providerId, provider)[0];
    const explicit = explicitAuthorization(input);
    const view = createViewForSpace({
      space,
      subject,
      accessMode: explicit ? "exportAllowed" : "metadataOnly",
      egress: explicit ? ["exportFile"] : ["searchResult"]
    });
    const decision = evaluateKnowledgeAccess(
      accessRequest({
        subject,
        workspaceId,
        action: "export",
        egress: "exportFile",
        accessMode: "exportAllowed",
        targetRef: space.derivedViewRef
      }),
      { view }
    );
    if (!decision.allowed) {
      appendEvent(ledger, "knowledge.export.request.denied", {
        provider: providerId,
        decisionId: decision.decisionId,
        explicitAuthorization: explicit,
        backendExportInvoked: false
      });
      await saveLedger(ledger);
      return {
        ok: false,
        httpStatus: 403,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        provider: providerId,
        explicitAuthorization: explicit,
        backendExportInvoked: false,
        filteredReason: decision.filteredReason || "export_requires_explicit_authorization",
        accessDecision: decision
      };
    }
    const exportRequestId = stableId("knowledge_export_request", {
      providerId,
      spaceId: space.spaceId,
      subject,
      nonce: randomUUID()
    });
    const request = {
      exportRequestId,
      provider: providerId,
      derivedKnowledgeSpace: space.derivedKnowledgeSpace,
      derivedViewRef: space.derivedViewRef,
      requestedFormat: text(input.format || "jsonl"),
      status: provider.mode === "contract" ? "contractVerified" : "queued",
      contractVerified: provider.mode === "contract",
      backendExportInvoked: provider.mode !== "contract",
      accessDecision: {
        decisionId: decision.decisionId,
        receiptId: decision.knowledgeAccessReceipt?.receiptId || "",
        loanRecordId: decision.loanRecord?.loanRecordId || ""
      },
      createdAt: nowIso()
    };
    ledger.exportRequests[exportRequestId] = request;
    appendEvent(ledger, "knowledge.export.request.allowed", request);
    await saveLedger(ledger);
    return {
      ok: true,
      protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
      ...request,
      accessDecision: decision,
      knowledgeAccessReceipt: decision.knowledgeAccessReceipt,
      loanRecord: decision.loanRecord
    };
  }

  async function requestPermission(input = {}, { subject = {}, workspaceId = "default" } = {}) {
    const config = await loadConfig();
    const ledger = await loadLedger();
    const providerId = normalizeProvider(input.provider || input.backend || "dify");
    const provider = config.providers?.[providerId];
    if (!provider) {
      const error = new Error(`Unsupported knowledge backend provider: ${providerId}`);
      error.code = "UNSUPPORTED_PROVIDER";
      throw error;
    }
    const request = {
      permissionRequestId: stableId("knowledge_permission_request", {
        providerId,
        subject,
        workspaceId,
        requestedEgress: input.requestedEgress || input.egress || "evidenceRead",
        nonce: randomUUID()
      }),
      protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
      provider: providerId,
      subject,
      workspaceId,
      requestedAccessMode: text(input.requestedAccessMode || input.accessMode || "copyToContext"),
      requestedEgress: text(input.requestedEgress || input.egress || "evidenceRead"),
      reason: text(input.reason || ""),
      status: "pending",
      contractVerified: provider.mode === "contract",
      createdAt: nowIso()
    };
    ledger.permissionRequests[request.permissionRequestId] = request;
    appendEvent(ledger, "knowledge.permission.request", {
      permissionRequestId: request.permissionRequestId,
      provider: providerId,
      requestedEgress: request.requestedEgress
    });
    await saveLedger(ledger);
    return {
      ok: true,
      ...request
    };
  }

  return {
    protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
    configPath: configFilePath,
    ledgerPath: ledgerFilePath,
    manifest,
    connect,
    listSpaces,
    search,
    getEvidence,
    requestExport,
    requestPermission
  };
}
