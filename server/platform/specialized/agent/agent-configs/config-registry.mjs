import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MODEL_LIST_DIR = path.join(CONFIG_ROOT, "model-list");
const AGENT_LIST_DIR = path.join(CONFIG_ROOT, "agent-list");
const MANIFEST_FILE = "manifest.json";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value || "").trim();
}

function safeFileId(value, fallbackPrefix) {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (normalized) {
    return normalized;
  }
  const digest = crypto.randomBytes(8).toString("hex");
  return `${fallbackPrefix}-${digest}`;
}

function stableDigest(parts = []) {
  return crypto
    .createHash("sha256")
    .update(parts.map((item) => text(item)).join("\n"))
    .digest("hex")
    .slice(0, 16);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function manifestPath(directory) {
  return path.join(directory, MANIFEST_FILE);
}

function defaultManifest(kind) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind,
    updatedAt: nowIso(),
    entries: []
  };
}

function normalizeManifest(kind, value = {}) {
  return {
    ...defaultManifest(kind),
    ...value,
    kind,
    entries: Array.isArray(value.entries)
      ? value.entries
          .map((entry) => ({
            id: text(entry.id),
            file: text(entry.file),
            label: text(entry.label),
            enabled: entry.enabled !== false
          }))
          .filter((entry) => entry.id && entry.file)
      : []
  };
}

function agentIdentity(entry = {}) {
  return text(entry.uid || entry.instanceId || entry.alias || entry.id);
}

function modelIdentity(entry = {}) {
  return text(entry.modelUid || entry.uid || entry.id || entry.alias || entry.model || entry.engine);
}

function modelFromAgent(agent = {}, index = 0) {
  const provider = text(agent.provider || "deepseek") || "deepseek";
  const model = text(agent.model || agent.engine);
  const identity = agentIdentity(agent);
  const id = text(agent.modelUid) || `model_${stableDigest([
    provider,
    model,
    agent.baseUrl || agent.url || "",
    identity || index
  ])}`;
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    id,
    agentUid: identity,
    provider,
    label: text(agent.modelLabel || `${provider} ${model}`.trim()) || id,
    model,
    engine: text(agent.engine || model),
    baseUrl: text(agent.baseUrl),
    url: text(agent.url),
    apiKey: "",
    apiKeyConfigured: false,
    token: "",
    tokenConfigured: false,
    tokenHeader: text(agent.tokenHeader),
    tokenPrefix: String(agent.tokenPrefix || ""),
    timeoutMs: Number(agent.timeoutMs || 120000),
    parameters: agent.parameters && typeof agent.parameters === "object" ? agent.parameters : {}
  };
}

function sameModelEndpoint(left = {}, right = {}) {
  const leftUrl = text(left.baseUrl || left.url);
  const rightUrl = text(right.baseUrl || right.url);
  return !leftUrl || !rightUrl || leftUrl === rightUrl;
}

function mergeModelSecretFromSettings(model = {}, settingsAgents = []) {
  const provider = text(model.provider);
  const modelName = text(model.model || model.engine);
  const modelAgentIdentity = text(model.agentUid || model.agentId || model.ownerAgentId);
  const match = settingsAgents.find((agent = {}) => {
    if (modelAgentIdentity) {
      return agentIdentity(agent) === modelAgentIdentity;
    }
    if (text(agent.modelUid) && text(agent.modelUid) === text(model.id)) {
      return true;
    }
    return text(agent.provider) === provider &&
      text(agent.model || agent.engine) === modelName &&
      sameModelEndpoint(model, agent);
  });
  if (!match) {
    return model;
  }
  const apiKey = text(model.apiKey || match.apiKey);
  const token = text(model.token || match.token);
  return {
    ...model,
    apiKey,
    apiKeyConfigured: Boolean(apiKey || model.apiKeyConfigured || match.apiKeyConfigured),
    token,
    tokenConfigured: Boolean(token || model.tokenConfigured || match.tokenConfigured)
  };
}

function agentFromLibraryEntry(agent = {}, modelId = "") {
  const id = agentIdentity(agent) || `agent_${stableDigest([agent.provider, agent.model, agent.label, agent.agentName])}`;
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    id,
    uid: id,
    instanceId: id,
    alias: id,
    modelUid: modelId || text(agent.modelUid),
    label: text(agent.label || agent.agentName || id),
    agentName: text(agent.agentName || agent.label || id),
    systemPrompt: text(agent.systemPrompt),
    pluginList: Array.isArray(agent.pluginList) ? agent.pluginList.map((item) => text(item)).filter(Boolean) : [],
    parameters: agent.parameters && typeof agent.parameters === "object" ? agent.parameters : {},
    permissionGroupId: text(agent.permissionGroupId),
    moduleAccess: agent.moduleAccess && typeof agent.moduleAccess === "object"
      ? agent.moduleAccess
      : { mode: "all", moduleIds: [] },
    timeoutMs: Number(agent.timeoutMs || 120000),
    enabled: agent.enabled !== false
  };
}

function combineAgentModel(agent = {}, model = {}) {
  const id = agentIdentity(agent);
  return {
    uid: id,
    instanceId: id,
    alias: id,
    provider: text(model.provider || agent.provider),
    label: text(agent.label || agent.agentName || id),
    baseUrl: text(model.baseUrl || agent.baseUrl),
    url: text(model.url || agent.url),
    model: text(model.model || agent.model),
    apiKey: text(model.apiKey || agent.apiKey),
    apiKeyConfigured: Boolean(model.apiKey || model.apiKeyConfigured || agent.apiKeyConfigured),
    token: text(model.token || agent.token),
    tokenConfigured: Boolean(model.token || model.tokenConfigured || agent.tokenConfigured),
    tokenHeader: text(model.tokenHeader || agent.tokenHeader),
    tokenPrefix: String(model.tokenPrefix ?? agent.tokenPrefix ?? ""),
    agentName: text(agent.agentName || agent.label || id),
    pluginList: Array.isArray(agent.pluginList) ? agent.pluginList : [],
    engine: text(model.engine || model.model || agent.engine || agent.model),
    systemPrompt: text(agent.systemPrompt),
    parameters: {
      ...(model.parameters && typeof model.parameters === "object" ? model.parameters : {}),
      ...(agent.parameters && typeof agent.parameters === "object" ? agent.parameters : {})
    },
    moduleAccess: agent.moduleAccess && typeof agent.moduleAccess === "object"
      ? agent.moduleAccess
      : { mode: "all", moduleIds: [] },
    permissionGroupId: text(agent.permissionGroupId),
    timeoutMs: Number(agent.timeoutMs || model.timeoutMs || 120000)
  };
}

function redactAgent(entry = {}) {
  const copy = { ...entry };
  if (copy.apiKey) {
    copy.apiKeyConfigured = true;
  }
  if (copy.token) {
    copy.tokenConfigured = true;
  }
  copy.apiKey = "";
  copy.token = "";
  return copy;
}

export class AgentConfigRegistry {
  constructor({ rootPath = CONFIG_ROOT } = {}) {
    this.rootPath = rootPath;
    this.modelListPath = path.join(rootPath, "model-list");
    this.agentListPath = path.join(rootPath, "agent-list");
    this.loaded = false;
    this.models = [];
    this.agents = [];
    this.modelManifest = defaultManifest("model-list");
    this.agentManifest = defaultManifest("agent-list");
  }

  async ensureLayout() {
    await fs.mkdir(this.modelListPath, { recursive: true });
    await fs.mkdir(this.agentListPath, { recursive: true });
    if (!fsSync.existsSync(manifestPath(this.modelListPath))) {
      await writeJson(manifestPath(this.modelListPath), defaultManifest("model-list"));
    }
    if (!fsSync.existsSync(manifestPath(this.agentListPath))) {
      await writeJson(manifestPath(this.agentListPath), defaultManifest("agent-list"));
    }
  }

  async loadList(directory, kind) {
    const manifest = normalizeManifest(
      kind,
      await readJson(manifestPath(directory), defaultManifest(kind))
    );
    const entries = [];
    const listed = manifest.entries.length > 0
      ? manifest.entries
      : (await fs.readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== MANIFEST_FILE)
          .map((entry) => ({
            id: entry.name.replace(/\.json$/i, ""),
            file: entry.name,
            label: "",
            enabled: true
          }));
    for (const item of listed) {
      if (item.enabled === false) {
        continue;
      }
      const config = await readJson(path.join(directory, item.file), null);
      if (config && typeof config === "object") {
        entries.push({
          ...config,
          id: text(config.id || item.id),
          enabled: config.enabled !== false
        });
      }
    }
    return { manifest, entries };
  }

  async refresh({ settingsFallback = null } = {}) {
    await this.ensureLayout();
    let models = await this.loadList(this.modelListPath, "model-list");
    let agents = await this.loadList(this.agentListPath, "agent-list");
    if (models.entries.length === 0 && agents.entries.length === 0) {
      await this.importFromSettings(settingsFallback);
      models = await this.loadList(this.modelListPath, "model-list");
      agents = await this.loadList(this.agentListPath, "agent-list");
    }
    const settingsAgents = Array.isArray(settingsFallback?.modelLibraryAgents)
      ? settingsFallback.modelLibraryAgents
      : [];
    this.models = models.entries.map((model) => mergeModelSecretFromSettings(model, settingsAgents));
    this.agents = agents.entries;
    this.modelManifest = models.manifest;
    this.agentManifest = agents.manifest;
    this.loaded = true;
    return this.getState();
  }

  async importFromSettings(settings = {}) {
    const settingsAgents = Array.isArray(settings?.modelLibraryAgents) ? settings.modelLibraryAgents : [];
    if (settingsAgents.length === 0) {
      return;
    }
    const modelManifest = defaultManifest("model-list");
    const agentManifest = defaultManifest("agent-list");
    for (let index = 0; index < settingsAgents.length; index += 1) {
      const entry = settingsAgents[index] || {};
      const model = modelFromAgent(entry, index);
      const agent = agentFromLibraryEntry(entry, model.id);
      const modelFile = `${safeFileId(model.id, "model")}.json`;
      const agentFile = `${safeFileId(agent.id, "agent")}.json`;
      await writeJson(path.join(this.modelListPath, modelFile), model);
      await writeJson(path.join(this.agentListPath, agentFile), agent);
      modelManifest.entries.push({
        id: model.id,
        file: modelFile,
        label: model.label,
        enabled: true
      });
      agentManifest.entries.push({
        id: agent.id,
        file: agentFile,
        label: agent.label,
        enabled: true
      });
    }
    modelManifest.updatedAt = nowIso();
    agentManifest.updatedAt = nowIso();
    await writeJson(manifestPath(this.modelListPath), modelManifest);
    await writeJson(manifestPath(this.agentListPath), agentManifest);
  }

  async replaceFromModelLibraryAgents(agents = []) {
    await this.ensureLayout();
    for (const directory of [this.modelListPath, this.agentListPath]) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== MANIFEST_FILE) {
          await fs.unlink(path.join(directory, entry.name));
        }
      }
    }
    await writeJson(manifestPath(this.modelListPath), defaultManifest("model-list"));
    await writeJson(manifestPath(this.agentListPath), defaultManifest("agent-list"));
    await this.importFromSettings({ modelLibraryAgents: Array.isArray(agents) ? agents : [] });
    await this.refresh();
  }

  getState() {
    const modelById = new Map(this.models.map((model) => [text(model.id), model]));
    const combinedAgents = this.agents.map((agent) =>
      combineAgentModel(agent, modelById.get(text(agent.modelUid)) || {})
    );
    return {
      rootPath: this.rootPath,
      modelListPath: this.modelListPath,
      agentListPath: this.agentListPath,
      modelManifest: this.modelManifest,
      agentManifest: this.agentManifest,
      models: this.models,
      agents: this.agents,
      modelLibraryAgents: combinedAgents,
      modelLibraryEntries: [...new Set(combinedAgents.map((agent) => text(agent.provider)).filter(Boolean))]
    };
  }

  getModelLibraryAgents({ redactSecrets = false } = {}) {
    const agents = this.getState().modelLibraryAgents;
    return redactSecrets ? agents.map(redactAgent) : agents;
  }

  getModelLibraryEntries() {
    return this.getState().modelLibraryEntries;
  }

  async upsertFromModelLibraryEntry(entry = {}) {
    await this.refresh();
    const model = modelFromAgent(entry);
    const agent = agentFromLibraryEntry(entry, model.id);
    await this.upsertModel(model);
    await this.upsertAgent(agent);
    await this.refresh();
    return combineAgentModel(agent, model);
  }

  async upsertModel(model = {}) {
    await this.ensureLayout();
    const id = modelIdentity(model) || `model_${stableDigest([model.provider, model.model, model.baseUrl || model.url])}`;
    const file = `${safeFileId(id, "model")}.json`;
    const next = { ...model, id, schemaVersion: model.schemaVersion || "v0.0.1:schema:definition-1" };
    await writeJson(path.join(this.modelListPath, file), next);
    const manifest = normalizeManifest(
      "model-list",
      await readJson(manifestPath(this.modelListPath), defaultManifest("model-list"))
    );
    manifest.entries = [
      { id, file, label: text(next.label || id), enabled: next.enabled !== false },
      ...manifest.entries.filter((entry) => entry.id !== id)
    ];
    manifest.updatedAt = nowIso();
    await writeJson(manifestPath(this.modelListPath), manifest);
  }

  async upsertAgent(agent = {}) {
    await this.ensureLayout();
    const id = agentIdentity(agent) || `agent_${stableDigest([agent.label, agent.agentName, agent.modelUid])}`;
    const file = `${safeFileId(id, "agent")}.json`;
    const next = {
      ...agent,
      id,
      uid: id,
      instanceId: id,
      alias: id,
      schemaVersion: agent.schemaVersion || "v0.0.1:schema:definition-1"
    };
    await writeJson(path.join(this.agentListPath, file), next);
    const manifest = normalizeManifest(
      "agent-list",
      await readJson(manifestPath(this.agentListPath), defaultManifest("agent-list"))
    );
    manifest.entries = [
      { id, file, label: text(next.label || next.agentName || id), enabled: next.enabled !== false },
      ...manifest.entries.filter((entry) => entry.id !== id)
    ];
    manifest.updatedAt = nowIso();
    await writeJson(manifestPath(this.agentListPath), manifest);
  }

  async deleteAgent(agentId = "") {
    await this.ensureLayout();
    const id = text(agentId);
    const manifest = normalizeManifest(
      "agent-list",
      await readJson(manifestPath(this.agentListPath), defaultManifest("agent-list"))
    );
    const entry = manifest.entries.find((item) => item.id === id);
    if (!entry) {
      return false;
    }
    try {
      await fs.unlink(path.join(this.agentListPath, entry.file));
    } catch {
      // The manifest is authoritative; remove stale entries even when the file is already gone.
    }
    manifest.entries = manifest.entries.filter((item) => item.id !== id);
    manifest.updatedAt = nowIso();
    await writeJson(manifestPath(this.agentListPath), manifest);
    await this.refresh();
    return true;
  }
}

let registrySingleton = null;

export function getAgentConfigRegistry(options = {}) {
  if (!registrySingleton) {
    registrySingleton = new AgentConfigRegistry(options);
  }
  return registrySingleton;
}

export const agentConfigPaths = {
  rootPath: CONFIG_ROOT,
  modelListPath: MODEL_LIST_DIR,
  agentListPath: AGENT_LIST_DIR,
  modelManifestPath: manifestPath(MODEL_LIST_DIR),
  agentManifestPath: manifestPath(AGENT_LIST_DIR)
};
