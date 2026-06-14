import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION = "v0.0.1:knowledge:rule-authoring-1";
export const GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION = "v0.0.1:knowledge:golden-rule-templates-1";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE_PATH = path.resolve(MODULE_DIR, "../../../../../config/golden-rule-templates.json");

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(value, length = 24) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function safePackageId(value) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `agent-rule-${stableHash(value || Date.now(), 16)}`;
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
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

function replaceTemplateValue(value, variables = {}) {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
      const direct = variables[key];
      return direct === undefined || direct === null ? "" : String(direct);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceTemplateValue(item, variables));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceTemplateValue(item, variables)])
    );
  }
  return value;
}

function mergeTemplates(defaultTemplates = [], overrideTemplates = []) {
  const byId = new Map();
  for (const template of [...asArray(defaultTemplates), ...asArray(overrideTemplates)]) {
    const templateId = normalizeText(template?.templateId || template?.id);
    if (!templateId) {
      continue;
    }
    const current = byId.get(templateId) || {};
    byId.set(templateId, {
      ...current,
      ...template,
      templateId,
      variables: {
        ...asObject(current.variables),
        ...asObject(template.variables)
      },
      gate: {
        ...asObject(current.gate),
        ...asObject(template.gate)
      }
    });
  }
  return [...byId.values()];
}

function scoreTemplateForMessage(template = {}, message = "") {
  const text = normalizeText(message).toLowerCase();
  let score = 0;
  for (const keyword of asArray(template.intentKeywords)) {
    const normalized = normalizeText(keyword).toLowerCase();
    if (!normalized) {
      continue;
    }
    if (text.includes(normalized)) {
      score += Math.max(1, Math.min(6, Math.ceil(normalized.length / 2)));
    }
  }
  return score;
}

function deterministicIntent({ message = "", templates = [] } = {}) {
  const scored = asArray(templates)
    .map((template) => ({
      templateId: normalizeText(template.templateId),
      score: scoreTemplateForMessage(template, message)
    }))
    .filter((item) => item.templateId)
    .sort((left, right) => right.score - left.score);
  const best = scored[0] || null;
  const needsRule = Boolean(best && best.score > 0);
  return {
    needsRule,
    intent: needsRule ? "golden_rule_authoring" : "none",
    confidence: needsRule ? Math.min(0.95, 0.45 + best.score * 0.08) : 0.35,
    templateId: needsRule ? best.templateId : "",
    reason: needsRule ? "命中规则模板意图关键词。" : "没有命中可用规则模板。"
  };
}

function normalizeIntentDecision(rawDecision = {}, fallbackDecision = {}) {
  const decision = asObject(rawDecision.decision || rawDecision);
  const needsRule =
    decision.needsRule === true ||
    decision.intent === "golden_rule_authoring" ||
    decision.intent === "golden_rule" ||
    decision.target === "GoldenRulePackage";
  return {
    ...fallbackDecision,
    ...decision,
    needsRule: needsRule || fallbackDecision.needsRule === true,
    templateId: normalizeText(decision.templateId || decision.template || fallbackDecision.templateId || ""),
    intent: normalizeText(decision.intent || fallbackDecision.intent || ""),
    confidence: Number(decision.confidence || fallbackDecision.confidence || 0),
    reason: normalizeText(decision.reason || fallbackDecision.reason || "")
  };
}

function normalizeGenerationDecision(rawDecision = {}) {
  const decision = asObject(rawDecision.decision || rawDecision);
  return {
    templateId: normalizeText(decision.templateId || decision.template || ""),
    variables: asObject(decision.variables),
    notes: asArray(decision.notes).map(String).filter(Boolean)
  };
}

function templateSummary(template = {}) {
  return {
    templateId: normalizeText(template.templateId),
    label: normalizeText(template.label),
    description: normalizeText(template.description),
    intentKeywords: asArray(template.intentKeywords).slice(0, 12)
  };
}

function buildTemplateVariables({ template = {}, message = "", intent = {}, generation = {} } = {}) {
  const base = asObject(template.variables);
  const generated = asObject(generation.variables);
  const packageSeed = [
    template.templateId,
    message,
    intent.intent,
    generated.packageId || base.packageId || ""
  ].join("\n");
  return {
    ...base,
    packageId: safePackageId(generated.packageId || base.packageId || `agent-rule-${stableHash(packageSeed, 16)}`),
    ruleId: normalizeText(generated.ruleId || base.ruleId || `golden_rule_${stableHash(packageSeed, 16)}`),
    label: normalizeText(generated.label || base.label || template.label || "智能体生成黄金规则"),
    description: normalizeText(generated.description || base.description || template.description || ""),
    source: normalizeText(generated.source || base.source || "agent-rule-authoring"),
    userMessage: message
  };
}

function runStorePath(rootPath) {
  return path.join(rootPath, "runs.json");
}

async function readRuns(rootPath) {
  const store = await readJson(runStorePath(rootPath), null);
  return asArray(store?.runs);
}

async function writeRuns(rootPath, runs = []) {
  await writeJson(runStorePath(rootPath), {
    protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
    runs: asArray(runs).slice(-1000)
  });
}

export function createKnowledgeRuleAuthoringRuntime({
  userDataPath,
  goldenRuleRuntime = null,
  modelDecisionRuntime = null,
  templatePath = DEFAULT_TEMPLATE_PATH
} = {}) {
  const rootPath = path.join(userDataPath, "knowledge-rule-authoring");
  const userTemplatePath = path.join(userDataPath, "knowledge-golden", "rule-templates.json");

  async function loadTemplates() {
    const defaults = await readJson(templatePath, { protocolVersion: GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION, templates: [] });
    const overrides = await readJson(userTemplatePath, { protocolVersion: GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION, templates: [] });
    const templates = mergeTemplates(defaults.templates, overrides.templates);
    return {
      protocolVersion: GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION,
      templatePath,
      userTemplatePath,
      templates
    };
  }

  async function decideIntent({ message, templates, modelAlias, modelEnabled }) {
    const fallback = deterministicIntent({ message, templates });
    if (!modelDecisionRuntime || typeof modelDecisionRuntime.decide !== "function") {
      return {
        decision: fallback,
        audit: { mode: "deterministic", fallbackReason: "model_decision_runtime_unavailable" }
      };
    }
    const result = await modelDecisionRuntime.decide({
      roleId: "rule_authoring_intent",
      modelAlias,
      modelEnabled: modelEnabled === true,
      input: {
        message,
        fallbackIntent: fallback,
        templates: templates.map(templateSummary)
      }
    });
    return {
      decision: normalizeIntentDecision(result, fallback),
      audit: result.audit || {}
    };
  }

  async function generateFromTemplate({ message, template, intent, modelAlias, modelEnabled }) {
    let generation = {};
    let audit = { mode: "deterministic" };
    if (modelDecisionRuntime && typeof modelDecisionRuntime.decide === "function") {
      const result = await modelDecisionRuntime.decide({
        roleId: "golden_rule_generator",
        modelAlias,
        modelEnabled: modelEnabled === true,
        input: {
          message,
          intent,
          template: templateSummary(template),
          allowedOutput: {
            templateId: "string",
            variables: {
              packageId: "string",
              ruleId: "string",
              label: "string",
              description: "string"
            }
          }
        }
      });
      generation = normalizeGenerationDecision(result);
      audit = result.audit || audit;
    }
    const variables = buildTemplateVariables({
      template,
      message,
      intent,
      generation
    });
    return {
      package: replaceTemplateValue(template.package || {}, variables),
      variables,
      generation,
      audit
    };
  }

  async function appendRun(run) {
    const runs = await readRuns(rootPath);
    const nextRuns = [...runs.filter((item) => item.runId !== run.runId), run];
    await writeRuns(rootPath, nextRuns);
    return run;
  }

  async function chat(input = {}) {
    const message = normalizeText(input.message || input.query || input.prompt || "");
    if (!message) {
      return {
        protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
        ok: false,
        status: "invalid_input",
        error: "message 不能为空。"
      };
    }
    if (!goldenRuleRuntime || typeof goldenRuleRuntime.validateRulePackage !== "function") {
      return {
        protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
        ok: false,
        status: "runtime_unavailable",
        error: "黄金规则门禁不可用。"
      };
    }

    const runId = `rule_authoring_${stableHash(`${message}\n${Date.now()}`, 18)}`;
    const startedAt = nowIso();
    const steps = [];
    const templatesPayload = await loadTemplates();
    const addStep = (step) => {
      const item = {
        startedAt: nowIso(),
        ...step,
        completedAt: nowIso()
      };
      steps.push(item);
      return item;
    };

    addStep({
      stage: "load_templates",
      status: "completed",
      templateCount: templatesPayload.templates.length
    });

    const intentResult = await decideIntent({
      message,
      templates: templatesPayload.templates,
      modelAlias: input.modelAlias || input.agentModelAlias || "",
      modelEnabled: input.modelEnabled === true
    });
    addStep({
      stage: "intent_recognition",
      status: "completed",
      decision: intentResult.decision,
      audit: intentResult.audit
    });

    if (!intentResult.decision.needsRule) {
      const run = await appendRun({
        protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
        runId,
        ok: true,
        status: "no_rule_needed",
        message,
        intent: intentResult.decision,
        steps,
        answer: "这条消息没有触发可用的黄金规则模板。",
        startedAt,
        completedAt: nowIso()
      });
      return run;
    }

    const template =
      templatesPayload.templates.find((item) => item.templateId === intentResult.decision.templateId) ||
      templatesPayload.templates
        .map((item) => ({ item, score: scoreTemplateForMessage(item, message) }))
        .sort((left, right) => right.score - left.score)[0]?.item ||
      templatesPayload.templates[0];
    if (!template) {
      const run = await appendRun({
        protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
        runId,
        ok: false,
        status: "template_unavailable",
        message,
        intent: intentResult.decision,
        steps,
        error: "没有可用黄金规则模板。",
        startedAt,
        completedAt: nowIso()
      });
      return run;
    }
    addStep({
      stage: "template_selection",
      status: "completed",
      template: templateSummary(template)
    });

    const generated = await generateFromTemplate({
      message,
      template,
      intent: intentResult.decision,
      modelAlias: input.modelAlias || input.agentModelAlias || "",
      modelEnabled: input.modelEnabled === true
    });
    addStep({
      stage: "template_generation",
      status: "completed",
      variables: generated.variables,
      audit: generated.audit
    });

    const gate = await goldenRuleRuntime.validateRulePackage({
      package: generated.package,
      testScenarios: asArray(template.gate?.testScenarios || template.gate?.scenarios)
    });
    addStep({
      stage: "golden_rule_gate",
      status: gate.ok ? "passed" : "failed",
      checks: gate.checks,
      scenarios: gate.scenarios,
      recommendations: gate.recommendations
    });

    if (!gate.ok) {
      const run = await appendRun({
        protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
        runId,
        ok: false,
        status: "gate_failed",
        message,
        intent: intentResult.decision,
        template: templateSummary(template),
        package: generated.package,
        gate,
        steps,
        startedAt,
        completedAt: nowIso()
      });
      return run;
    }

    const saved = await goldenRuleRuntime.saveRulePackage({
      ...gate.package,
      status: "draft",
      source: "agent-rule-authoring"
    });
    addStep({
      stage: "submit_for_human_confirmation",
      status: "completed",
      packageId: saved.package.packageId,
      version: saved.package.version
    });

    const run = await appendRun({
      protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
      runId,
      ok: true,
      status: "pending_human_confirmation",
      humanConfirmationRequired: true,
      message,
      intent: intentResult.decision,
      template: templateSummary(template),
      package: saved.package,
      manifest: saved.manifest,
      gate,
      steps,
      confirmation: {
        packageId: saved.package.packageId,
        version: saved.package.version,
        publishEndpoint: `/api/knowledge/golden-rules/${encodeURIComponent(saved.package.packageId)}/publish`,
        action: "publish_golden_rule_package"
      },
      startedAt,
      completedAt: nowIso()
    });
    return run;
  }

  async function getRun(input = {}) {
    const runId = normalizeText(input.runId || input.id || "");
    const runs = await readRuns(rootPath);
    return runs.find((run) => run.runId === runId) || null;
  }

  async function listRuns(input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 500));
    const runs = await readRuns(rootPath);
    return {
      protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
      items: runs
        .sort((left, right) => String(right.completedAt || right.startedAt || "").localeCompare(String(left.completedAt || left.startedAt || "")))
        .slice(0, limit)
    };
  }

  return {
    protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
    describe: async () => ({
      protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
      templateCatalog: await loadTemplates(),
      stages: [
        "load_templates",
        "intent_recognition",
        "template_selection",
        "template_generation",
        "golden_rule_gate",
        "submit_for_human_confirmation"
      ]
    }),
    chat,
    getRun,
    listRuns
  };
}

export default createKnowledgeRuleAuthoringRuntime;
