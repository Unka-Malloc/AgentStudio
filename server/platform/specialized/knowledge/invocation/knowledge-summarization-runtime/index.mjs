import { loadSettings } from "../../../../common/platform-core/settings.mjs";
import { callAgentGateway } from "../../../agent/agent-gateway/index.mjs";
import {
  createMultiAgentCoordinator,
  DEFAULT_SUMMARIZATION_ROLES,
  MULTI_AGENT_COORDINATOR_PROTOCOL_VERSION
} from "../../../agent/agent-gateway/multi-agent-coordinator/index.mjs";

export const SUMMARIZATION_PROTOCOL_VERSION = "v0.0.1:knowledge:summarization-1";

// Summarization is an externally callable knowledge workflow, not context-window compaction.
const DEFAULT_QUERY = "总结 摘要 关键事项 时间 金额 风险 责任 决策";

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  const items = Array.isArray(values) ? values : [values];
  for (const value of items) {
    const item = normalizeText(value);
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    output.push(item);
  }
  return output;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value, maxLength = 280) {
  const text = normalizeText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function safeIdPart(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function artifactIdForRun(runId, level) {
  return `artifact_${safeIdPart(runId)}_${safeIdPart(level) || "summary"}`;
}

function roleProfile(roleId, overrides = []) {
  return (
    asArray(overrides).find((item) => item?.roleId === roleId) ||
    DEFAULT_SUMMARIZATION_ROLES.find((item) => item.roleId === roleId) ||
    {
      roleId,
      modelAlias: "",
      contextProfileId: "balanced",
      allowedTools: [],
      writePolicy: {}
    }
  );
}

function roleModelAlias(roleId, input = {}) {
  const aliases = asObject(input.modelAliases || input.roleModelAliases);
  if (aliases[roleId]) {
    return aliases[roleId];
  }
  const profile = roleProfile(roleId, input.roleProfiles);
  if (input.modelAlias) {
    return input.modelAlias;
  }
  if (/deepseek/i.test(profile.modelAlias || "")) {
    return input.deepSeekAlias || "deepseek";
  }
  return profile.modelAlias || "";
}

function getKnowledgeCore(runtime) {
  const mount = runtime?.mounts?.knowledgeBase;
  if (!mount || mount.enabled === false) {
    return null;
  }
  return mount;
}

function sourceLocatorText(item = {}) {
  const source = item.source || item.locator || {};
  const hierarchy = item.hierarchy || {};
  const parts = [
    source.sourcePath,
    source.batchId || item.batchId,
    source.documentId || item.documentId || hierarchy.documentId,
    source.sectionId || hierarchy.sectionId,
    source.blockId || source.assetId
  ].filter(Boolean);
  return parts.length ? parts.join(" > ") : item.documentId || item.itemId || "";
}

function extractDate(text) {
  const match = String(text || "").match(
    /\b(20\d{2}[-/.年](?:0?[1-9]|1[0-2])[-/.月](?:0?[1-9]|[12]\d|3[01])日?|20\d{2}[-/.年](?:0?[1-9]|1[0-2])月?)\b/u
  );
  return match?.[1] || "";
}

function extractAmount(text) {
  const match = String(text || "").match(
    /(?:[$¥￥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:万元|元|美元|人民币|RMB|USD))/iu
  );
  return match?.[0] || "";
}

function evidenceCardFromItem(item = {}, index = 0) {
  const text = [item.title, item.snippet].filter(Boolean).join("：");
  const evidenceId = String(item.evidenceId || item.id || `evidence-${index + 1}`);
  return {
    evidenceId,
    claim: truncateText(text || evidenceId, 360),
    who: "",
    what: truncateText(item.title || item.snippet || evidenceId, 160),
    when: extractDate(text),
    amount: extractAmount(text),
    sourceLocator: sourceLocatorText(item),
    itemId: item.itemId || item.documentId || "",
    documentId: item.documentId || item.hierarchy?.documentId || "",
    batchId: item.batchId || item.source?.batchId || "",
    hierarchy: item.hierarchy || null,
    confidence: Math.max(0.45, Math.min(0.98, Number(item.score || 0.6))),
    snippet: item.snippet || "",
    title: item.title || "",
    score: Number(item.score || 0)
  };
}

function groupEvidenceByTopic(evidenceCards = []) {
  const groups = new Map();
  for (const card of evidenceCards) {
    const key =
      card.hierarchy?.documentId ||
      card.documentId ||
      card.batchId ||
      card.sourceLocator ||
      "general";
    const current = groups.get(key) || {
      topicId: key,
      title: card.title || card.what || "综合主题",
      evidenceIds: [],
      evidenceCount: 0,
      highConfidenceCount: 0
    };
    current.evidenceIds.push(card.evidenceId);
    current.evidenceCount += 1;
    if (Number(card.confidence || 0) >= 0.7) {
      current.highConfidenceCount += 1;
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => right.evidenceCount - left.evidenceCount);
}

function citationsFromCards(cards = []) {
  return asArray(cards).map((card) => ({
    evidenceId: card.evidenceId,
    title: card.title || card.what || card.claim,
    sourceLocator: card.sourceLocator
  }));
}

function buildEvidenceUnitSummary(cards = []) {
  if (!cards.length) {
    return "未检索到可用于总结的证据。";
  }
  return cards
    .map((card, index) => {
      const fields = [
        card.when ? `时间：${card.when}` : "",
        card.amount ? `金额：${card.amount}` : "",
        card.sourceLocator ? `来源：${card.sourceLocator}` : ""
      ].filter(Boolean);
      return `${index + 1}. ${card.claim} [${card.evidenceId}]${fields.length ? `\n   ${fields.join("；")}` : ""}`;
    })
    .join("\n");
}

function buildTopicSummary(topics = [], cards = []) {
  const cardById = new Map(cards.map((card) => [card.evidenceId, card]));
  if (!topics.length) {
    return "暂无主题分组。";
  }
  return topics
    .map((topic, index) => {
      const topicCards = topic.evidenceIds.map((id) => cardById.get(id)).filter(Boolean);
      const cited = topicCards.slice(0, 4).map((card) => `[${card.evidenceId}]`).join(" ");
      return `${index + 1}. ${topic.title || topic.topicId}：覆盖 ${topic.evidenceCount} 条证据。${cited}`;
    })
    .join("\n");
}

function buildAnalystOutputs(cards = [], topics = []) {
  const highConfidence = cards.filter((card) => Number(card.confidence || 0) >= 0.7);
  const dated = cards.filter((card) => card.when);
  const amounts = cards.filter((card) => card.amount);
  return [
    {
      analystId: "business-focus",
      title: "业务重点",
      summary: highConfidence.length
        ? highConfidence.slice(0, 6).map((card) => `${card.claim} [${card.evidenceId}]`).join("\n")
        : cards.slice(0, 6).map((card) => `${card.claim} [${card.evidenceId}]`).join("\n")
    },
    {
      analystId: "risk-gap",
      title: "风险与缺口",
      summary: [
        cards.length === 0 ? "没有可引用证据，不能形成可靠结论。" : "",
        topics.length > 6 ? `主题分散，共 ${topics.length} 组，需要人工关注跨文档一致性。` : "",
        cards.some((card) => !card.sourceLocator) ? "部分证据缺少来源定位。" : ""
      ].filter(Boolean).join("\n") || "未发现显著证据缺口。"
    },
    {
      analystId: "timeline-money",
      title: "时间与金额",
      summary: [
        dated.length ? `发现 ${dated.length} 条带时间证据：${dated.slice(0, 4).map((card) => `${card.when} [${card.evidenceId}]`).join("；")}` : "未发现明确日期证据。",
        amounts.length ? `发现 ${amounts.length} 条带金额证据：${amounts.slice(0, 4).map((card) => `${card.amount} [${card.evidenceId}]`).join("；")}` : "未发现明确金额证据。"
      ].join("\n")
    }
  ];
}

function buildExecutiveSummary({ query, cards, topics, analystOutputs }) {
  const title = query ? `围绕“${query}”的多智能体总结` : "多智能体知识库总结";
  const citedCards = cards.slice(0, 12);
  const evidenceLines = citedCards.map((card) => `- ${card.claim} [${card.evidenceId}]`);
  const topicLines = topics.slice(0, 8).map((topic) => `- ${topic.title || topic.topicId}：${topic.evidenceCount} 条证据`);
  const analystLines = analystOutputs.map((item) => `### ${item.title}\n${item.summary || "暂无结论。"}`);
  return [
    `# ${title}`,
    "",
    "## 核心证据",
    evidenceLines.length ? evidenceLines.join("\n") : "- 未检索到可引用证据。",
    "",
    "## 主题结构",
    topicLines.length ? topicLines.join("\n") : "- 暂无主题结构。",
    "",
    analystLines.join("\n\n")
  ].join("\n");
}

function detectConflicts(cards = []) {
  const byClaim = new Map();
  const conflicts = [];
  for (const card of cards) {
    const normalized = normalizeText(card.claim).toLowerCase();
    const base = normalized
      .replace(/不|未|没有|否认|取消|failed|fail|not|no/gi, "")
      .slice(0, 80);
    const negative = /不|未|没有|否认|取消|failed|fail|not|no/i.test(card.claim);
    const current = byClaim.get(base);
    if (current && current.negative !== negative) {
      conflicts.push({
        evidenceIds: [current.evidenceId, card.evidenceId],
        claimA: current.claim,
        claimB: card.claim
      });
    }
    if (!current) {
      byClaim.set(base, { evidenceId: card.evidenceId, claim: card.claim, negative });
    }
  }
  return conflicts;
}

export function computeCoverage(evidenceCards = [], content = "") {
  const cards = asArray(evidenceCards);
  const text = String(content || "");
  const coveredEvidence = cards.filter((card) => text.includes(card.evidenceId)).length;
  const missingImportantEvidence = cards
    .filter((card) => Number(card.confidence || 0) >= 0.7 && !text.includes(card.evidenceId))
    .map((card) => ({
      evidenceId: card.evidenceId,
      claim: card.claim,
      confidence: card.confidence
    }));
  const uncitedClaims = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !/\[[^\]]+\]/.test(line))
    .slice(0, 50);
  const conflicts = detectConflicts(cards);
  const score = cards.length ? coveredEvidence / cards.length : 0;
  return {
    totalEvidence: cards.length,
    coveredEvidence,
    missingImportantEvidence,
    uncitedClaims,
    conflicts,
    score: Number(score.toFixed(4))
  };
}

function runStepsWithStatus(stepNames = [], currentName = "") {
  const seen = new Set();
  const timestamp = nowIso();
  const result = [];
  for (const name of stepNames) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push({
      node: name,
      status: name === currentName ? "running" : "pending",
      at: timestamp
    });
  }
  return result;
}

function appendStep(state, node, patch = {}) {
  const steps = asArray(state.steps).filter((item) => item.node !== node);
  return [
    ...steps,
    {
      node,
      status: patch.status || "completed",
      at: nowIso(),
      ...patch
    }
  ];
}

async function publishProtocolEvent(protocolEventBus, topic, payload, options = {}) {
  if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
    return null;
  }
  return protocolEventBus.publish(topic, payload, options);
}

export function createSummarizationRuntime({
  userDataPath,
  runtime,
  agentWorkspace,
  contextRuntime,
  protocolEventBus = null,
  clientRuntimeAllocator = null
}) {
  if (!agentWorkspace) {
    throw new Error("SummarizationRuntime requires AgentWorkspace.");
  }
  if (!contextRuntime) {
    throw new Error("SummarizationRuntime requires ContextRuntime.");
  }

  async function maybeCallRoleModel({ roleId, input, contextPack, prompt }) {
    const useModel = input.useModel === true || input.modelEnabled === true;
    if (!useModel) {
      return null;
    }
    const settings = await loadSettings(userDataPath);
    const modelAlias = roleModelAlias(roleId, input);
    try {
      const result = await callAgentGateway({
        settings,
        input: {
          alias: modelAlias,
          modelAlias,
          contextProfileId: input.contextProfileId || "",
          toolGrantId: input.toolGrantId || input.grantId || "",
          workspaceId: input.workspaceId || "",
          workspaceContext: input.workspaceContext || null,
          clientRuntimeAllocation: input.clientRuntimeAllocation || null,
          question: prompt,
          contextCompaction: {
            force: true,
            persist: true
          },
          parameters: {
            roleId,
            contextPack,
            runType: "knowledge_summarization"
          }
        },
        userDataPath,
        contextRuntime,
        contextCompactionSource: "summarization-runtime",
        clientRuntimeAllocator
      });
      return {
        degraded: false,
        result
      };
    } catch (error) {
      return {
        degraded: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function createRoleContext({ roleId, workspaceId, runId, input, evidenceCards = [], toolState = {} }) {
    const workspaceState = agentWorkspace.getWorkspace({
      workspaceId,
      includePrivate: false
    });
    const profile = roleProfile(roleId, input.roleProfiles);
    return contextRuntime.assemble({
      contextProfileId: input.contextProfileId || profile.contextProfileId,
      modelAlias: roleModelAlias(roleId, input),
      clientUid: input.clientUid || "",
      clientRuntimeAllocation: input.clientRuntimeAllocation || null,
      workspaceContext: input.workspaceContext || null,
      knowledgeSourceIds: uniqueStrings(input.scopeSourceIds || input.sourceIds || []),
      roleId,
      agentId: roleId,
      sessionId: workspaceId,
      workspaceId,
      taskBrief: input.query || input.title || DEFAULT_QUERY,
      workspaceState,
      retrievedEvidence: evidenceCards,
      toolState: {
        allowedTools: profile.allowedTools,
        runId,
        ...toolState
      },
      systemMemory: [
        "Agent is stateless. Use only this ContextPack, cited evidence, and allowed tools.",
        "Do not write canonical knowledge directly; propose structured submissions only."
      ].join("\n")
    });
  }

  async function startRun(input = {}) {
    const callerInput = asObject(input);
    const allocationResult = typeof clientRuntimeAllocator?.apply === "function"
      ? await clientRuntimeAllocator.apply(callerInput, {
          taskType: callerInput.taskType || "knowledge.summarization",
          surface: "summarization-runtime"
        })
      : null;
    input = allocationResult?.input ? asObject(allocationResult.input) : callerInput;
    const query = normalizeText(input.query || input.q || input.title || DEFAULT_QUERY) || DEFAULT_QUERY;
    const requestedWorkspaceId = normalizeText(input.workspaceId || "");
    const callerSelectedWorkspace = Boolean(normalizeText(callerInput.workspaceId || ""));
    const existingWorkspace = requestedWorkspaceId
      ? agentWorkspace.getWorkspace({
          workspaceId: requestedWorkspaceId,
          includePrivate: true
        })
      : null;
    const workspaceResult = existingWorkspace || agentWorkspace.createWorkspace({
      workspaceId: requestedWorkspaceId,
      title: input.title || `Knowledge summarization: ${truncateText(query, 80)}`,
      objective: query,
      metadata: {
        source: "knowledge.summarization",
        batchId: input.batchId || "",
        jobId: input.jobId || "",
        collectionId: input.collectionId || "",
        documentIds: asArray(input.documentIds),
        clientRuntimeAllocation: allocationResult?.allocation || input.clientRuntimeAllocation || null
      }
    });
    const workspace = workspaceResult.workspace || workspaceResult;
    const workspaceContext = typeof agentWorkspace.getWorkspaceContext === "function"
      ? agentWorkspace.getWorkspaceContext(workspace.workspaceId) || null
      : null;
    const explicitModelAlias = normalizeText(callerInput.modelAlias || callerInput.alias || "");
    const allocatedModelAlias = normalizeText(input.modelAlias || input.alias || "");
    const workspaceModelAlias = normalizeText(workspaceContext?.modelAlias || "");
    const explicitContextProfileId = normalizeText(callerInput.contextProfileId || callerInput.profileId || "");
    const allocatedContextProfileId = normalizeText(input.contextProfileId || input.profileId || "");
    const workspaceContextProfileId = normalizeText(workspaceContext?.contextProfileId || "");
    const explicitToolGrantId = normalizeText(callerInput.toolGrantId || callerInput.grantId || "");
    const allocatedToolGrantId = normalizeText(input.toolGrantId || input.grantId || "");
    const workspaceToolGrantId = normalizeText(workspaceContext?.toolGrantId || "");
    const explicitSourceIds = uniqueStrings([
      ...uniqueStrings(callerInput.scopeSourceIds || []),
      ...uniqueStrings(callerInput.sourceIds || [])
    ]);
    const allocatedSourceIds = uniqueStrings([
      ...uniqueStrings(input.scopeSourceIds || []),
      ...uniqueStrings(input.sourceIds || [])
    ]);
    const workspaceSourceIds = uniqueStrings(workspaceContext?.knowledgeSourceIds || []);
    const effectiveSourceIds = explicitSourceIds.length
      ? explicitSourceIds
      : callerSelectedWorkspace
        ? workspaceSourceIds.length ? workspaceSourceIds : allocatedSourceIds
        : allocatedSourceIds.length ? allocatedSourceIds : workspaceSourceIds;
    input = {
      ...asObject(input),
      query,
      workspaceId: workspace.workspaceId,
      modelAlias: explicitModelAlias ||
        (callerSelectedWorkspace ? workspaceModelAlias || allocatedModelAlias : allocatedModelAlias || workspaceModelAlias),
      contextProfileId: explicitContextProfileId ||
        (callerSelectedWorkspace
          ? workspaceContextProfileId || allocatedContextProfileId
          : allocatedContextProfileId || workspaceContextProfileId),
      toolGrantId: explicitToolGrantId ||
        (callerSelectedWorkspace ? workspaceToolGrantId || allocatedToolGrantId : allocatedToolGrantId || workspaceToolGrantId),
      scopeSourceIds: effectiveSourceIds,
      workspaceContext,
      clientRuntimeAllocation: allocationResult?.allocation || input.clientRuntimeAllocation || null
    };
    const stepNames = [
      "Plan",
      "Retrieve",
      "ExtractEvidence",
      "OrganizeTopics",
      "ParallelAnalysts",
      "Writer",
      "Reviewer",
      "Merger",
      "PublishArtifact"
    ];
    const runResult = agentWorkspace.createRun({
      workspaceId: workspace.workspaceId,
      runType: "knowledge_summarization",
      status: "running",
      input: {
        ...asObject(input),
        query,
        clientRuntimeAllocation: input.clientRuntimeAllocation || null
      },
      steps: runStepsWithStatus(stepNames, "Plan"),
      startedAt: nowIso()
    });
    const run = runResult.run;

    const updateRunStep = (state, node, patch = {}) => {
      agentWorkspace.updateRun(run.runId, {
        status: "running",
        steps: appendStep(state, node, patch),
        degraded: Boolean(state.degraded || patch.degraded)
      });
    };

    const nodes = {
      Plan: async (state) => {
        const contextPack = await createRoleContext({
          roleId: "Merger",
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          input
        });
        agentWorkspace.savePrivateState({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "Coordinator",
          summary: `Plan for query: ${query}`,
          state: {
            query,
            stepNames,
            contextBudget: contextPack.budgetReport
          }
        });
        const next = {
          contextPack,
          steps: appendStep(state, "Plan", { status: "completed" })
        };
        updateRunStep({ ...state, ...next }, "Plan", { status: "completed" });
        return next;
      },
      Retrieve: async (state) => {
        const knowledgeCore = getKnowledgeCore(runtime);
        let searchResult = {
          protocolVersion: "v0.0.1:knowledge:core-1",
          query,
          items: [],
          degraded: true
        };
        const errors = [...asArray(state.errors)];
        if (knowledgeCore && typeof knowledgeCore.search === "function") {
          try {
            searchResult = await knowledgeCore.search({
              query,
              limit: Math.max(1, Math.min(Number(input.limit || 24), 80)),
              batchId: input.batchId || "",
              retrievalProfileId: input.retrievalProfileId || "",
              learningEnabled: input.learningEnabled !== false,
              explain: input.explain !== false,
              scopeSourceIds: uniqueStrings(input.scopeSourceIds || input.sourceIds || [])
            });
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        } else {
          errors.push("KnowledgeCore search is unavailable.");
        }
        const degraded = Boolean(state.degraded || searchResult.degraded || errors.length);
        const next = {
          searchResult,
          degraded,
          errors,
          steps: appendStep(state, "Retrieve", {
            status: "completed",
            itemCount: asArray(searchResult.items).length,
            degraded
          })
        };
        updateRunStep({ ...state, ...next }, "Retrieve", next.steps.at(-1));
        return next;
      },
      ExtractEvidence: async (state) => {
        const evidenceCards = asArray(state.searchResult?.items)
          .slice(0, Math.max(1, Math.min(Number(input.evidenceLimit || input.limit || 24), 80)))
          .map(evidenceCardFromItem);
        for (const card of evidenceCards) {
          agentWorkspace.submit({
            workspaceId: workspace.workspaceId,
            runId: run.runId,
            agentId: "Extractor",
            type: "evidenceCard",
            payload: card,
            evidenceRefs: [card.evidenceId],
            confidence: card.confidence,
            writePolicy: roleProfile("Extractor", input.roleProfiles).writePolicy
          });
        }
        const contextPack = await createRoleContext({
          roleId: "Extractor",
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          input,
          evidenceCards
        });
        agentWorkspace.savePrivateState({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "Extractor",
          summary: `Extracted ${evidenceCards.length} evidence cards.`,
          state: {
            evidenceCardCount: evidenceCards.length,
            citations: contextPack.citations
          }
        });
        const modelResult = await maybeCallRoleModel({
          roleId: "Extractor",
          input,
          contextPack,
          prompt: `Extract evidence cards for: ${query}`
        });
        const degraded = Boolean(state.degraded || modelResult?.degraded);
        const errors = [...asArray(state.errors), ...(modelResult?.error ? [modelResult.error] : [])];
        const next = {
          evidenceCards,
          contextPack,
          degraded,
          errors,
          steps: appendStep(state, "ExtractEvidence", {
            status: "completed",
            evidenceCardCount: evidenceCards.length,
            degraded
          })
        };
        updateRunStep({ ...state, ...next }, "ExtractEvidence", next.steps.at(-1));
        return next;
      },
      OrganizeTopics: async (state) => {
        const topics = groupEvidenceByTopic(state.evidenceCards);
        agentWorkspace.submit({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "TopicOrganizer",
          type: "contextSummary",
          payload: {
            summary: `Organized ${asArray(state.evidenceCards).length} evidence cards into ${topics.length} topics.`,
            topics
          },
          evidenceRefs: asArray(state.evidenceCards).map((card) => card.evidenceId),
          confidence: 0.72,
          writePolicy: roleProfile("TopicOrganizer", input.roleProfiles).writePolicy
        });
        agentWorkspace.savePrivateState({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "TopicOrganizer",
          summary: `Organized ${topics.length} topics.`,
          state: {
            topics
          }
        });
        const next = {
          topics,
          steps: appendStep(state, "OrganizeTopics", {
            status: "completed",
            topicCount: topics.length
          })
        };
        updateRunStep({ ...state, ...next }, "OrganizeTopics", next.steps.at(-1));
        return next;
      },
      ParallelAnalysts: async (state) => {
        const contextPack = await createRoleContext({
          roleId: "DomainAnalyst",
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          input,
          evidenceCards: state.evidenceCards,
          toolState: {
            topics: state.topics
          }
        });
        const analystOutputs = buildAnalystOutputs(state.evidenceCards, state.topics);
        const modelResult = await maybeCallRoleModel({
          roleId: "DomainAnalyst",
          input,
          contextPack,
          prompt: `Analyze the evidence and produce concise findings for: ${query}`
        });
        if (modelResult?.result?.answer || modelResult?.result?.text) {
          analystOutputs.push({
            analystId: "model-assisted",
            title: "模型辅助分析",
            summary: String(modelResult.result.answer || modelResult.result.text || "").slice(0, 6000)
          });
        }
        for (const output of analystOutputs) {
          agentWorkspace.savePrivateState({
            workspaceId: workspace.workspaceId,
            runId: run.runId,
            agentId: `DomainAnalyst:${output.analystId}`,
            summary: output.title,
            state: output
          });
        }
        const degraded = Boolean(state.degraded || modelResult?.degraded);
        const errors = [...asArray(state.errors), ...(modelResult?.error ? [modelResult.error] : [])];
        const next = {
          analystOutputs,
          degraded,
          errors,
          steps: appendStep(state, "ParallelAnalysts", {
            status: "completed",
            analystCount: analystOutputs.length,
            degraded
          })
        };
        updateRunStep({ ...state, ...next }, "ParallelAnalysts", next.steps.at(-1));
        return next;
      },
      Writer: async (state) => {
        const content = buildExecutiveSummary({
          query,
          cards: state.evidenceCards,
          topics: state.topics,
          analystOutputs: state.analystOutputs
        });
        const draftArtifact = {
          level: "ExecutiveSummary",
          title: query,
          content,
          citations: citationsFromCards(state.evidenceCards),
          revision: 1
        };
        agentWorkspace.submit({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "Writer",
          type: "artifact",
          payload: {
            level: draftArtifact.level,
            title: draftArtifact.title,
            summary: truncateText(draftArtifact.content, 800)
          },
          evidenceRefs: draftArtifact.citations.map((item) => item.evidenceId),
          confidence: 0.72,
          writePolicy: roleProfile("Writer", input.roleProfiles).writePolicy
        });
        agentWorkspace.savePrivateState({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "Writer",
          summary: `Drafted summary with ${draftArtifact.citations.length} citations.`,
          state: draftArtifact
        });
        const next = {
          draftArtifact,
          steps: appendStep(state, "Writer", {
            status: "completed",
            citationCount: draftArtifact.citations.length
          })
        };
        updateRunStep({ ...state, ...next }, "Writer", next.steps.at(-1));
        return next;
      },
      Reviewer: async (state) => {
        const reviewReport = computeCoverage(state.evidenceCards, state.draftArtifact?.content || "");
        for (const item of reviewReport.missingImportantEvidence) {
          agentWorkspace.createIssue({
            workspaceId: workspace.workspaceId,
            runId: run.runId,
            type: "missing_important_evidence",
            severity: "high",
            title: `重要证据未覆盖：${truncateText(item.claim, 80)}`,
            payload: item,
            evidenceRefs: [item.evidenceId],
            createdBy: "Reviewer"
          });
        }
        for (const conflict of reviewReport.conflicts) {
          agentWorkspace.createIssue({
            workspaceId: workspace.workspaceId,
            runId: run.runId,
            type: "conflicting_claims",
            severity: "medium",
            title: "疑似冲突结论",
            payload: conflict,
            evidenceRefs: conflict.evidenceIds,
            createdBy: "Reviewer"
          });
        }
        agentWorkspace.savePrivateState({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "Reviewer",
          summary: `Coverage score ${reviewReport.score}.`,
          state: reviewReport
        });
        const next = {
          reviewReport,
          steps: appendStep(state, "Reviewer", {
            status: "completed",
            coverageScore: reviewReport.score,
            missingImportantEvidence: reviewReport.missingImportantEvidence.length,
            conflictCount: reviewReport.conflicts.length
          })
        };
        updateRunStep({ ...state, ...next }, "Reviewer", next.steps.at(-1));
        return next;
      },
      Merger: async (state) => {
        let content = state.draftArtifact?.content || "";
        const missing = asArray(state.reviewReport?.missingImportantEvidence);
        if (missing.length) {
          content = [
            content,
            "",
            "## 审核补充",
            ...missing.map((item) => `- 补充重要证据：${item.claim} [${item.evidenceId}]`)
          ].join("\n");
        }
        const finalCoverage = computeCoverage(state.evidenceCards, content);
        const finalArtifact = {
          ...(state.draftArtifact || {}),
          level: "ExecutiveSummary",
          title: state.draftArtifact?.title || query,
          content,
          citations: citationsFromCards(state.evidenceCards),
          coverageReport: finalCoverage,
          revision: 1
        };
        agentWorkspace.savePrivateState({
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          agentId: "Merger",
          summary: `Merged final summary with coverage ${finalCoverage.score}.`,
          state: finalArtifact
        });
        const next = {
          finalArtifact,
          reviewReport: finalCoverage,
          steps: appendStep(state, "Merger", {
            status: "completed",
            coverageScore: finalCoverage.score
          })
        };
        updateRunStep({ ...state, ...next }, "Merger", next.steps.at(-1));
        return next;
      },
      PublishArtifact: async (state) => {
        const cards = asArray(state.evidenceCards);
        const topics = asArray(state.topics);
        const coverage = state.finalArtifact?.coverageReport || computeCoverage(cards, state.finalArtifact?.content || "");
        const artifactInputs = [
          {
            level: "EvidenceUnitSummary",
            title: `${query} - evidence units`,
            content: buildEvidenceUnitSummary(cards),
            citations: citationsFromCards(cards),
            coverageReport: coverage
          },
          {
            level: "TopicSummary",
            title: `${query} - topics`,
            content: buildTopicSummary(topics, cards),
            citations: citationsFromCards(cards),
            coverageReport: coverage
          },
          {
            level: "ExecutiveSummary",
            title: query,
            content: state.finalArtifact?.content || "",
            citations: citationsFromCards(cards),
            coverageReport: coverage
          },
          {
            level: "ReviewReport",
            title: `${query} - review`,
            content: JSON.stringify(coverage, null, 2),
            citations: citationsFromCards(cards),
            coverageReport: coverage
          }
        ];
        const artifacts = artifactInputs.map((artifact) =>
          agentWorkspace.createArtifact({
            artifactId: artifactIdForRun(run.runId, artifact.level),
            workspaceId: workspace.workspaceId,
            runId: run.runId,
            ...artifact,
            status: "draft",
            createdBy: "Merger"
          }).artifact
        );
        const artifactIds = artifacts.map((artifact) => artifact.artifactId);
        const completedAt = nowIso();
        agentWorkspace.updateRun(run.runId, {
          status: "completed",
          steps: appendStep(state, "PublishArtifact", {
            status: "completed",
            artifactCount: artifacts.length
          }),
          coverage,
          artifactIds,
          degraded: Boolean(state.degraded),
          error: asArray(state.errors).join("\n"),
          completedAt
        });
        await publishProtocolEvent(
          protocolEventBus,
          "knowledge.summarization",
          {
            runId: run.runId,
            workspaceId: workspace.workspaceId,
            artifactIds,
            coverage
          },
          { type: "knowledge.summarization.completed" }
        );
        return {
          artifactIds,
          reviewReport: coverage,
          steps: appendStep(state, "PublishArtifact", {
            status: "completed",
            artifactCount: artifacts.length
          })
        };
      }
    };

    let graphResult;
    try {
      const coordinator = createMultiAgentCoordinator({
        workflowName: "knowledge-summarization-v1",
        nodes
      });
      graphResult = await coordinator.run(
        {
          input: {
            ...asObject(input),
            query
          },
          workspaceId: workspace.workspaceId,
          runId: run.runId,
          steps: run.steps,
          degraded: false,
          errors: [],
          metadata: {
            protocolVersion: SUMMARIZATION_PROTOCOL_VERSION,
            coordinatorProtocolVersion: MULTI_AGENT_COORDINATOR_PROTOCOL_VERSION
          }
        },
        {
          threadId: run.runId
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      agentWorkspace.updateRun(run.runId, {
        status: "failed",
        error: message,
        degraded: true,
        completedAt: nowIso()
      });
      graphResult = {
        protocolVersion: MULTI_AGENT_COORDINATOR_PROTOCOL_VERSION,
        graphRuntime: "langgraph-js",
        error: message,
        state: {
          degraded: true,
          errors: [message]
        }
      };
    }

    const currentRun = agentWorkspace.getRun(run.runId);
    const artifacts = agentWorkspace.listRunArtifacts(run.runId);
    const workspaceState = agentWorkspace.getWorkspace({
      workspaceId: workspace.workspaceId,
      includePrivate: Boolean(input.includePrivate)
    });
    return {
      protocolVersion: SUMMARIZATION_PROTOCOL_VERSION,
      coordinatorProtocolVersion: MULTI_AGENT_COORDINATOR_PROTOCOL_VERSION,
      graphRuntime: graphResult.graphRuntime || "langgraph-js",
      run: currentRun,
      workspace: workspaceState?.workspace || workspace,
      workspaceContext: input.workspaceContext || null,
      workspaceSummary: workspaceState?.summary || {},
      artifacts,
      coverage: currentRun?.coverage || graphResult.state?.reviewReport || {},
      degraded: Boolean(currentRun?.degraded || graphResult.state?.degraded),
      errors: asArray(graphResult.state?.errors),
      state: input.includeState ? graphResult.state : undefined
    };
  }

  function getRun(runId, options = {}) {
    const run = agentWorkspace.getRun(runId);
    if (!run) {
      return null;
    }
    const artifacts = agentWorkspace.listRunArtifacts(runId);
    const workspace = agentWorkspace.getWorkspace({
      workspaceId: run.workspaceId,
      includePrivate: Boolean(options.includePrivate)
    });
    return {
      protocolVersion: SUMMARIZATION_PROTOCOL_VERSION,
      run,
      workspace: workspace?.workspace || null,
      workspaceContext: typeof agentWorkspace.getWorkspaceContext === "function"
        ? agentWorkspace.getWorkspaceContext(run.workspaceId) || null
        : null,
      workspaceSummary: workspace?.summary || {},
      artifacts,
      coverage: run.coverage || {}
    };
  }

  async function approveRun(input = {}) {
    const runId = String(input.runId || "").trim();
    const run = agentWorkspace.getRun(runId);
    if (!run) {
      return null;
    }
    const action = String(input.action || input.resolution || "approve").trim();
    const approved = action === "approve" || action === "accept" || action === "publish";
    const status = approved ? "approved" : "needs_review";
    const artifacts = agentWorkspace.updateArtifactsStatus(runId, status);
    const updated = agentWorkspace.updateRun(runId, {
      status,
      completedAt: run.completedAt || nowIso()
    })?.run;
    await publishProtocolEvent(
      protocolEventBus,
      "knowledge.summarization",
      {
        runId,
        status,
        artifactIds: artifacts.map((artifact) => artifact.artifactId)
      },
      { type: approved ? "knowledge.summarization.approved" : "knowledge.summarization.needs_review" }
    );
    return {
      protocolVersion: SUMMARIZATION_PROTOCOL_VERSION,
      run: updated,
      artifacts,
      status
    };
  }

  return {
    protocolVersion: SUMMARIZATION_PROTOCOL_VERSION,
    startRun,
    getRun,
    approveRun,
    computeCoverage
  };
}

export default createSummarizationRuntime;
