import {
  callAgentGateway,
  loadSettings,
  publicAgentGatewayConfig
} from "../../../platform/interactive/product-api.mjs";
import { maxRisk } from "./config.mjs";

function asPlainObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function normalizeStep(step, toolRegistry) {
  const value = asPlainObject(step);
  const toolId = String(value.toolId || value.tool || "").trim();
  const tool = toolRegistry.getTool(toolId);
  if (!tool) {
    throw new Error(`维护计划包含未知工具：${toolId || "<empty>"}`);
  }
  const risk = maxRisk(tool.risk, value.risk || tool.risk);
  return {
    toolId,
    input: asPlainObject(value.input),
    risk,
    reason: String(value.reason || "").trim() || `执行 ${toolId}`
  };
}

export function normalizeMaintenancePlan(plan, toolRegistry, fallback = {}) {
  const value = asPlainObject(plan);
  const steps = Array.isArray(value.steps)
    ? value.steps.map((step) => normalizeStep(step, toolRegistry))
    : [];
  if (steps.length === 0) {
    throw new Error("维护计划至少需要一个工具步骤。");
  }
  const risk = maxRisk(value.risk, ...steps.map((step) => step.risk));
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    source: String(value.source || fallback.source || "runbook"),
    intent: String(value.intent || fallback.intent || "health_smoke").trim(),
    summary: String(value.summary || fallback.summary || "执行维护巡检。").trim(),
    steps,
    risk,
    requiresApproval: value.requiresApproval === true || risk === "repair_write",
    approvalReason: String(value.approvalReason || "").trim()
  };
}

function buildHealthSmokePlan() {
  return {
    source: "runbook",
    intent: "health_smoke",
    summary: "执行服务端健康、运行时、存储、任务和知识库冒烟巡检。",
    steps: [
      { toolId: "system.health", input: {}, risk: "read_only", reason: "确认服务进程和服务发现状态。" },
      { toolId: "runtime.info", input: {}, risk: "read_only", reason: "采集运行时 profile 和挂载状态。" },
      { toolId: "storage.summary", input: {}, risk: "read_only", reason: "读取服务端存储摘要。" },
      { toolId: "jobs.list", input: { limit: 20 }, risk: "read_only", reason: "检查最近任务状态。" },
      { toolId: "knowledge.health", input: {}, risk: "read_only", reason: "检查知识库协议健康。" }
    ],
    risk: "read_only"
  };
}

function buildDailyStorageAndKnowledgePlan() {
  const base = buildHealthSmokePlan();
  return {
    source: "runbook",
    intent: "daily_storage_and_knowledge",
    summary: "执行每日存储与知识库安全维护，包含健康巡检和轻量派生数据校验。",
    steps: [
      ...base.steps,
      { toolId: "storage.doctor", input: {}, risk: "read_only", reason: "诊断存储文件与元数据一致性。" },
      {
        toolId: "knowledge.maintenance.run",
        input: { taskType: "validate_assets", limit: 200 },
        risk: "safe_write",
        reason: "校验知识库资产引用。"
      },
      {
        toolId: "knowledge.maintenance.run",
        input: { taskType: "validate_quality", limit: 200 },
        risk: "safe_write",
        reason: "运行知识库轻量质量断言。"
      }
    ],
    risk: "safe_write"
  };
}

function buildFailedJobsReviewPlan() {
  return {
    source: "runbook",
    intent: "failed_jobs_review",
    summary: "扫描近期失败任务并生成复盘建议，不自动重跑任务。",
    steps: [
      { toolId: "jobs.list", input: { limit: 50 }, risk: "read_only", reason: "读取近期任务。" },
      { toolId: "jobs.failed_review", input: { limit: 50 }, risk: "read_only", reason: "提取失败任务和建议。" }
    ],
    risk: "read_only"
  };
}

function buildKnowledgeMaintenanceReviewPlan({ includeReindex = false } = {}) {
  const steps = [
    { toolId: "knowledge.health", input: {}, risk: "read_only", reason: "检查知识库健康。" },
    {
      toolId: "knowledge.maintenance.settings",
      input: {},
      risk: "read_only",
      reason: "读取当前知识库维护参数。"
    },
    {
      toolId: "knowledge.maintenance.run",
      input: { taskType: "validate_assets", limit: 200 },
      risk: "safe_write",
      reason: "先执行安全资产校验。"
    }
  ];
  if (includeReindex) {
    steps.push({
      toolId: "knowledge.reindex",
      input: { confirm: true, reason: "maintenance_agent" },
      risk: "repair_write",
      reason: "用户要求或巡检判断需要重建知识库索引。"
    });
  }
  return {
    source: "runbook",
    intent: "knowledge_maintenance_review",
    summary: includeReindex
      ? "检查知识库维护状态，并生成需要审批的索引重建计划。"
      : "检查知识库维护状态并运行安全校验。",
    steps,
    risk: includeReindex ? "repair_write" : "safe_write",
    requiresApproval: includeReindex,
    approvalReason: includeReindex ? "knowledge.reindex 属于 repair_write，必须管理员审批。" : ""
  };
}

export function buildRunbookPlan(runbook, options = {}) {
  const id = String(runbook || "health_smoke").trim();
  if (id === "daily_storage_and_knowledge") {
    return buildDailyStorageAndKnowledgePlan();
  }
  if (id === "failed_jobs_review") {
    return buildFailedJobsReviewPlan();
  }
  if (id === "knowledge_maintenance_review") {
    return buildKnowledgeMaintenanceReviewPlan(options);
  }
  return buildHealthSmokePlan();
}

function chooseRunbookFromMessage(message) {
  const text = String(message || "").toLowerCase();
  if (/failed|failure|失败|报错|错误/.test(text)) {
    return { runbook: "failed_jobs_review" };
  }
  if (/reindex|重建|重算|修复索引|重新索引/.test(text)) {
    return { runbook: "knowledge_maintenance_review", options: { includeReindex: true } };
  }
  if (/knowledge|知识|索引|维护/.test(text)) {
    return { runbook: "knowledge_maintenance_review" };
  }
  if (/storage|存储|doctor|一致性|reconcile/.test(text)) {
    return { runbook: "daily_storage_and_knowledge" };
  }
  return { runbook: "health_smoke" };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function buildPlannerPrompt({ message, toolRegistry }) {
  const tools = toolRegistry.listTools().map((tool) => ({
    id: tool.id,
    risk: tool.risk,
    scopes: tool.scopes,
    timeoutMs: tool.timeoutMs
  }));
  return [
    "你是 Pact 服务端维护智能体的 planner。",
    "只输出 JSON 对象，不输出 Markdown，不解释。",
    "你不能直接调用 API，只能从 tools 中选择工具并生成结构化 plan。",
    "destructive 风险禁止使用。repair_write 必须 requiresApproval=true。",
    "输出结构：{ \"intent\": string, \"summary\": string, \"risk\": \"read_only|safe_write|repair_write\", \"requiresApproval\": boolean, \"approvalReason\": string, \"steps\": [{ \"toolId\": string, \"input\": object, \"risk\": string, \"reason\": string }] }。",
    `tools=${JSON.stringify(tools)}`,
    `管理员请求：${String(message || "")}`
  ].join("\n");
}

function plannerCompactionMessages(input = {}) {
  if (Array.isArray(input.transcript)) {
    return input.transcript;
  }
  if (Array.isArray(input.messages)) {
    return input.messages;
  }
  const messages = [];
  if (input.history) {
    messages.push({
      id: "maintenance-history",
      role: "system",
      apiRoundId: "maintenance-history",
      content: input.history
    });
  }
  for (const [index, turn] of (Array.isArray(input.recentTurns) ? input.recentTurns : []).entries()) {
    messages.push({
      ...(turn && typeof turn === "object" ? turn : { content: String(turn || "") }),
      id: turn?.id || turn?.messageId || `maintenance-turn-${index + 1}`,
      apiRoundId: turn?.apiRoundId || turn?.roundId || `maintenance-turn-round-${Math.floor(index / 2) + 1}`
    });
  }
  const message = String(input.message || input.intent || "").trim();
  if (message) {
    messages.push({
      id: "maintenance-current-message",
      role: "user",
      apiRoundId: "maintenance-current",
      content: message
    });
  }
  return messages;
}

async function compactPlannerInput({ input = {}, config = {}, contextRuntime = null, toolRegistry }) {
  if (!contextRuntime || typeof contextRuntime.runCompaction !== "function") {
    return { input, compaction: null };
  }
  const messages = plannerCompactionMessages(input);
  if (!messages.length || input.contextCompaction === false) {
    return { input, compaction: null };
  }
  const options = asPlainObject(input.contextCompaction);
  const shouldCompact =
    options.force === true ||
    input.forceContextCompaction === true ||
    Array.isArray(input.messages) ||
    Array.isArray(input.transcript) ||
    Boolean(input.history) ||
    messages.length > 1;
  if (!shouldCompact) {
    return { input, compaction: null };
  }
  const compaction = await contextRuntime.runCompaction({
    contextProfileId:
      input.contextProfileId ||
      input.compactionProfileId ||
      config.contextProfileId ||
      options.contextProfileId ||
      "balanced",
    sessionId: input.sessionId || input.runId || "maintenance-agent",
    messages,
    taskBrief: input.message || input.intent || "maintenance-agent",
    inputSource: "maintenance-agent-planner",
    force: true,
    compactionPolicy: {
      recentMessageProtectionCount:
        options.recentMessageProtectionCount === undefined ? 1 : options.recentMessageProtectionCount,
      recentTurnProtectionCount:
        options.recentTurnProtectionCount === undefined ? 1 : options.recentTurnProtectionCount
    },
    persist: options.persist !== false,
    runtimeState: {
      maintenanceRun: input.maintenanceRun || null,
      enabledTools: toolRegistry.listTools().map((tool) => ({
        id: tool.id,
        risk: tool.risk,
        scopes: tool.scopes
      })),
      userConstraints: [
        "destructive operations are forbidden",
        "repair_write operations require approval"
      ]
    }
  });
  if (!compaction?.compacted) {
    return { input, compaction };
  }
  const message = [
    "以下是维护智能体对话上下文压缩摘要。该摘要只作为辅助上下文，不是原始证据。",
    compaction.summary || "",
    compaction.reinjection?.items?.length
      ? `运行时状态：${JSON.stringify(compaction.reinjection.items.map((item) => ({
          key: item.key,
          value: item.value
        })))}`
      : "",
    input.message ? `当前管理员请求：${input.message}` : ""
  ].filter(Boolean).join("\n\n");
  return {
    input: {
      ...input,
      message,
      contextCompactionResult: {
        compacted: true,
        boundaryId: compaction.boundary?.boundaryId || "",
        strategy: compaction.strategy || "",
        tokenReport: compaction.tokenReport || null
      }
    },
    compaction
  };
}

export function createMaintenancePlanner({ userDataPath, toolRegistry, contextRuntime = null }) {
  async function fallbackPlan(input = {}, fallbackReason = "") {
    const selected =
      input.runbook
        ? { runbook: input.runbook, options: input.options || {} }
        : chooseRunbookFromMessage(input.message || input.intent || "");
    const rawPlan = buildRunbookPlan(selected.runbook, selected.options || {});
    if (fallbackReason) {
      rawPlan.summary = `${rawPlan.summary}（已使用固定 runbook：${fallbackReason}）`;
    }
    return normalizeMaintenancePlan(rawPlan, toolRegistry, {
      source: "runbook"
    });
  }

  async function plan(input = {}, config = {}) {
    const prepared = await compactPlannerInput({ input, config, contextRuntime, toolRegistry });
    const effectiveInput = prepared.input;
    if (effectiveInput.runbook || config.plannerMode === "fixed_runbook") {
      return fallbackPlan(effectiveInput);
    }

    if (config.plannerMode === "gateway" || config.plannerMode === "gateway_fallback") {
      try {
        const settings = await loadSettings(userDataPath);
        const publicConfig = await publicAgentGatewayConfig(settings);
        if (!publicConfig.urlConfigured) {
          throw new Error("agent-gateway 未配置。");
        }
        const gatewayResult = await callAgentGateway({
          settings,
          input: {
            question: buildPlannerPrompt({
              message: effectiveInput.message || effectiveInput.intent || "",
              toolRegistry
            }),
            contextCompaction: false,
            modelAlias: effectiveInput.modelAlias || effectiveInput.alias || "",
            alias: effectiveInput.modelAlias || effectiveInput.alias || "",
            agentName: effectiveInput.agentName || publicConfig.agentName || "",
            sessionId: effectiveInput.sessionId || "",
            userId: effectiveInput.userId || ""
          },
          userDataPath,
          contextCompactionSource: "maintenance-agent.planner"
        });
        const parsed = extractJsonObject(gatewayResult.answer || gatewayResult.text);
        if (!parsed) {
          throw new Error("agent-gateway 未返回有效 JSON 计划。");
        }
        return normalizeMaintenancePlan(
          {
            ...parsed,
            source: "agent_gateway"
          },
          toolRegistry,
          { source: "agent_gateway" }
        );
      } catch (error) {
        if (config.plannerMode === "gateway") {
          throw error;
        }
        return fallbackPlan(input, error instanceof Error ? error.message : "planner 失败");
      }
    }

    return fallbackPlan(effectiveInput);
  }

  return {
    plan,
    fallbackPlan
  };
}
