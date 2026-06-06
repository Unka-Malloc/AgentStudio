import { afterEach, describe, expect, it, vi } from "vitest";

import { createSystemControllerKnowledgeRuntimeHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function queryPayload(url = null) {
  if (!url) {
    return {};
  }
  const payload = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      payload[key] = Array.isArray(payload[key]) ? [...payload[key], value] : [payload[key], value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

function createHarness(overrides = {}) {
  const runtime = overrides.runtime || { name: "runtime" };
  const jobWorkflowProvider = overrides.jobWorkflowProvider || { name: "job-workflow" };
  const knowledgeSourceService = overrides.knowledgeSourceService || { name: "knowledge-source-service" };
  const metadataStore = overrides.metadataStore || { name: "metadata-store" };
  const clientRuntimeAllocator = overrides.clientRuntimeAllocator || { name: "client-runtime-allocator" };
  const modelDecisionRuntime = overrides.modelDecisionRuntime || { name: "model-decision-runtime" };
  const strategyManagementProvider = overrides.strategyManagementProvider || { name: "strategy-management-provider" };
  const agentWorkspace = overrides.agentWorkspace || { name: "agent-workspace" };
  const consoleDomainServices = overrides.consoleDomainServices || { name: "console-domain-services" };

  const parseJsonBody = overrides.parseJsonBody || vi.fn((requestBody) => JSON.parse(requestBody.toString("utf8")));
  const protocolPayload =
    overrides.protocolPayload ||
    vi.fn((requestBody, url) => {
      if (requestBody?.length > 0) {
        return JSON.parse(requestBody.toString("utf8"));
      }
      return url ? Object.fromEntries(url.searchParams.entries()) : {};
    });
  const queryPayloadFn = overrides.queryPayload || vi.fn(queryPayload);
  const knowledgeDomainContext =
    overrides.knowledgeDomainContext ||
    vi.fn((authSession) => ({ scope: "knowledge-domain", authSession }));
  const knowledgeWorkflowContext =
    overrides.knowledgeWorkflowContext ||
    vi.fn((authSession) => ({ scope: "knowledge-workflow", authSession }));
  const accessControlContext =
    overrides.accessControlContext ||
    vi.fn((authSession, extra = {}) => ({ scope: "access-control", authSession, ...extra }));
  const sendConsoleDomainOperation =
    overrides.sendConsoleDomainOperation ||
    vi.fn(async (payload) => ({ ok: true, payload }));

  const handlers = createSystemControllerKnowledgeRuntimeHandlers({
    sendConsoleDomainOperation,
    parseJsonBody,
    protocolPayload,
    queryPayload: queryPayloadFn,
    knowledgeDomainContext,
    knowledgeWorkflowContext,
    runtime,
    jobWorkflowProvider,
    knowledgeSourceService,
    metadataStore,
    clientRuntimeAllocator,
    modelDecisionRuntime,
    strategyManagementProvider,
    agentWorkspace,
    accessControlContext,
    consoleDomainServices
  });

  return {
    accessControlContext,
    agentWorkspace,
    clientRuntimeAllocator,
    consoleDomainServices,
    handlers,
    jobWorkflowProvider,
    knowledgeDomainContext,
    knowledgeSourceService,
    knowledgeWorkflowContext,
    metadataStore,
    modelDecisionRuntime,
    parseJsonBody,
    protocolPayload,
    queryPayload: queryPayloadFn,
    runtime,
    sendConsoleDomainOperation,
    strategyManagementProvider
  };
}

describe("system controller knowledge runtime handlers", () => {
  it("registers the expected handler methods", () => {
    const { handlers } = createHarness();

    expect(handlers).toEqual(expect.objectContaining({
      handleKnowledgeConsole: expect.any(Function),
      handleKnowledgeSources: expect.any(Function),
      handleCreateKnowledgeSource: expect.any(Function),
      handleUpdateKnowledgeSource: expect.any(Function),
      handleKnowledgeSearch: expect.any(Function),
      handleGetKnowledgeEvidence: expect.any(Function),
      handleSearch: expect.any(Function)
    }));
  });

  it("forwards success requests with explicit ids, fallback ids, and auth contexts", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-1" };

    await harness.handlers.handleKnowledgeConsole({
      operation: { id: "knowledge.console.custom" },
      response
    });
    await harness.handlers.handleKnowledgeSources({
      operation: { id: "" },
      response
    });
    await harness.handlers.handleKnowledgeHealth({
      response,
      authSession
    });
    await harness.handlers.handleGetKnowledgeEvidence({
      evidenceId: "evidence-1",
      response,
      authSession
    });

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "knowledge.console.custom",
      response,
      context: {
        runtime: harness.runtime,
        jobWorkflowProvider: harness.jobWorkflowProvider,
        knowledgeSourceService: harness.knowledgeSourceService,
        consoleDomainServices: harness.consoleDomainServices
      },
      errorMessage: "读取知识库控制台状态失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "knowledge.sources.list",
      response,
      context: {
        knowledgeSourceService: harness.knowledgeSourceService
      },
      errorMessage: "读取知识库目录失败。"
    });
    expect(harness.knowledgeDomainContext).toHaveBeenCalledWith(authSession);
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, {
      operationId: "knowledge.health",
      response,
      context: {
        scope: "knowledge-domain",
        authSession
      },
      errorMessage: "读取知识库健康状态失败。"
    });
    expect(harness.accessControlContext).toHaveBeenCalledWith(authSession, {
      runtime: harness.runtime
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(4, {
      operationId: "knowledge.evidence",
      input: {
        evidenceId: "evidence-1"
      },
      response,
      context: {
        scope: "access-control",
        authSession,
        runtime: harness.runtime
      },
      errorMessage: "读取知识证据失败。"
    });
  });

  it("parses request bodies, query payloads, and merged identifiers correctly", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-2" };
    const url = new URL("http://example.test/console?runId=url-run&limit=2&tag=a&tag=b");

    await harness.handlers.handleCreateKnowledgeSource({
      requestBody: jsonBody({ name: "documents", enabled: true }),
      response
    });
    await harness.handlers.handleUpdateKnowledgeSource({
      sourceId: "source-from-arg",
      requestBody: jsonBody({ sourceId: "source-from-body", name: "updated" }),
      response
    });
    await harness.handlers.handleKnowledgeSearch({
      requestBody: jsonBody({ query: "alpha", limit: 5 }),
      url,
      response,
      authSession
    });
    await harness.handlers.handleExternalKnowledgeDistillationRunGet({
      url,
      runId: "run-from-arg",
      response,
      authSession
    });
    await harness.handlers.handleSearch({
      url,
      response,
      authSession
    });

    expect(harness.parseJsonBody).toHaveBeenCalledWith(expect.any(Buffer));
    expect(harness.protocolPayload).toHaveBeenCalledWith(expect.any(Buffer), url);
    expect(harness.queryPayload).toHaveBeenCalledWith(url);

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "knowledge.sources.create",
      input: {
        name: "documents",
        enabled: true
      },
      response,
      context: {
        knowledgeSourceService: harness.knowledgeSourceService
      },
      errorMessage: "创建知识库目录失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "knowledge.sources.update",
      input: {
        sourceId: "source-from-arg",
        name: "updated"
      },
      response,
      context: {
        knowledgeSourceService: harness.knowledgeSourceService
      },
      errorMessage: "更新知识库目录失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, {
      operationId: "knowledge.search",
      input: {
        query: "alpha",
        limit: 5
      },
      response,
      context: {
        runtime: harness.runtime,
        metadataStore: harness.metadataStore,
        clientRuntimeAllocator: harness.clientRuntimeAllocator,
        modelDecisionRuntime: harness.modelDecisionRuntime,
        strategyManagementProvider: harness.strategyManagementProvider,
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "知识库检索失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(4, {
      operationId: "external.knowledge.distillation.runs.get",
      input: {
        runId: "run-from-arg",
        limit: "2",
        tag: "b"
      },
      response,
      context: {
        scope: "knowledge-workflow",
        authSession
      },
      errorMessage: "读取外部知识蒸馏任务失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(5, {
      operationId: "search.query",
      input: {
        runId: "url-run",
        limit: "2",
        tag: ["a", "b"]
      },
      response,
      context: {
        scope: "knowledge-workflow",
        authSession
      },
      errorMessage: "知识检索失败。"
    });
  });

  it("propagates handler failures from sendConsoleDomainOperation", async () => {
    const error = new Error("boom");
    const sendConsoleDomainOperation = vi.fn(async () => {
      throw error;
    });
    const harness = createHarness({ sendConsoleDomainOperation });

    await expect(harness.handlers.handleKnowledgeMaintenanceSet({
      requestBody: jsonBody({ mode: "reindex" }),
      response: {},
      authSession: { sessionId: "session-3" }
    })).rejects.toThrow("boom");

    expect(sendConsoleDomainOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "knowledge.maintenance.set",
      input: {
        mode: "reindex"
      },
      errorMessage: "设置知识库维护参数失败。"
    }));
  });

  it("forwards skill, evaluation, evolution, summarization, and graph runtime handlers", async () => {
    const harness = createHarness();
    const response = { tag: "matrix-response" };
    const authSession = { sessionId: "session-matrix" };
    const url = new URL("http://example.test/console?cursor=next&limit=5");
    const body = jsonBody({ status: "ready", approve: true });

    const cases = [
      {
        method: "handleEvidenceGateEvaluate",
        args: { requestBody: body },
        operationId: "knowledge.evidence_gate.evaluate",
        input: { status: "ready", approve: true },
        errorMessage: "评估证据充分性失败。"
      },
      {
        method: "handleKnowledgeAgentSkill",
        args: {},
        operationId: "knowledge.agent_skill.describe",
        errorMessage: "读取知识库智能体技能失败。"
      },
      {
        method: "handleKnowledgeAgentSkillPlan",
        args: { requestBody: body },
        operationId: "knowledge.agent_skill.plan",
        input: { status: "ready", approve: true },
        errorMessage: "规划知识库智能体查询失败。"
      },
      {
        method: "handleKnowledgeAgentSkillRun",
        args: { requestBody: body },
        operationId: "knowledge.agent_skill.run",
        input: { status: "ready", approve: true },
        errorMessage: "执行知识库智能体查询技能失败。"
      },
      {
        method: "handleKnowledgeSkills",
        args: { url },
        operationId: "knowledge.skills.list",
        input: { cursor: "next", limit: "5" },
        errorMessage: "读取知识 Skill 列表失败。"
      },
      {
        method: "handleKnowledgeSkillGet",
        args: { skillId: "skill-1" },
        operationId: "knowledge.skills.get",
        input: { skillId: "skill-1" },
        errorMessage: "读取知识 Skill 失败。"
      },
      {
        method: "handleKnowledgeSkillGenerate",
        args: { requestBody: body },
        operationId: "knowledge.skills.generate",
        input: { status: "ready", approve: true },
        errorMessage: "生成知识 Skill 失败。"
      },
      {
        method: "handleKnowledgeSkillPropose",
        args: { requestBody: body },
        operationId: "knowledge.skills.propose",
        input: { status: "ready", approve: true },
        errorMessage: "提交知识 Skill 提案失败。"
      },
      {
        method: "handleKnowledgeSkillResolve",
        args: { requestBody: body, skillId: "skill-2" },
        operationId: "knowledge.skills.resolve",
        input: { status: "ready", approve: true, skillId: "skill-2" },
        errorMessage: "解决知识 Skill 失败。"
      },
      {
        method: "handleKnowledgeSkillFramework",
        args: {},
        operationId: "knowledge.skills.framework",
        errorMessage: "读取知识 Skill 提炼框架失败。"
      },
      {
        method: "handleSaveKnowledgeSkillFramework",
        args: { requestBody: body },
        operationId: "knowledge.skills.framework_save",
        input: { status: "ready", approve: true },
        errorMessage: "保存知识 Skill 提炼框架失败。"
      },
      {
        method: "handleKnowledgeSkillEvaluationRuns",
        args: { requestBody: body },
        operationId: "knowledge.skills.evaluation.runs.create",
        input: { status: "ready", approve: true },
        errorMessage: "创建知识 SkillSet 离线评估失败。"
      },
      {
        method: "handleKnowledgeSkillDeployments",
        args: { requestBody: body },
        operationId: "knowledge.skills.deployments.create",
        input: { status: "ready", approve: true },
        errorMessage: "发布知识 SkillSet 部署失败。"
      },
      {
        method: "handleKnowledgeSkillDeploymentRollback",
        args: { requestBody: body, deploymentId: "deploy-1" },
        operationId: "knowledge.skills.deployments.rollback",
        input: { status: "ready", approve: true, deploymentId: "deploy-1" },
        errorMessage: "回滚知识 SkillSet 部署失败。"
      },
      {
        method: "handleKnowledgeTrainingSetExport",
        args: { requestBody: body },
        operationId: "knowledge.training_sets.export",
        input: { status: "ready", approve: true },
        errorMessage: "导出黄金训练集失败。"
      },
      {
        method: "handleAgentEvaluationRuns",
        args: { requestBody: body },
        operationId: "knowledge.evaluation.runs.create",
        input: { status: "ready", approve: true },
        errorMessage: "创建智能体知识评估运行失败。"
      },
      {
        method: "handleAgentEvaluationRunList",
        args: { url },
        operationId: "knowledge.evaluation.runs.list",
        input: { cursor: "next", limit: "5" },
        errorMessage: "列出智能体知识评估运行失败。"
      },
      {
        method: "handleAgentEvaluationRun",
        args: { runId: "eval-1" },
        operationId: "knowledge.evaluation.runs.get",
        input: { runId: "eval-1" },
        errorMessage: "读取智能体知识评估运行失败。"
      },
      {
        method: "handleModelDecisionRoles",
        args: {},
        operationId: "knowledge.model_roles",
        errorMessage: "读取知识库模型角色失败。"
      },
      {
        method: "handleModelDecisionDecide",
        args: { requestBody: body },
        operationId: "knowledge.model_decision",
        input: { status: "ready", approve: true },
        errorMessage: "执行知识库模型决策失败。"
      },
      {
        method: "handleKnowledgeEvolutionDescribe",
        args: {},
        operationId: "knowledge.evolution.describe",
        errorMessage: "读取知识进化闭环说明失败。"
      },
      {
        method: "handleKnowledgeEvolutionRun",
        args: { requestBody: body },
        operationId: "knowledge.evolution.runs.create",
        input: { status: "ready", approve: true },
        errorMessage: "执行知识进化闭环失败。"
      },
      {
        method: "handleKnowledgeEvolutionRuns",
        args: { url },
        operationId: "knowledge.evolution.runs.list",
        input: { cursor: "next", limit: "5" },
        errorMessage: "列出知识进化闭环运行失败。"
      },
      {
        method: "handleKnowledgeEvolutionRunGet",
        args: { runId: "evo-1" },
        operationId: "knowledge.evolution.runs.get",
        input: { runId: "evo-1" },
        errorMessage: "读取知识进化闭环运行失败。"
      },
      {
        method: "handleKnowledgeHierarchyAudit",
        args: { requestBody: body },
        operationId: "knowledge.hierarchy.audit",
        input: { status: "ready", approve: true },
        errorMessage: "索引质量透明度分析失败。"
      },
      {
        method: "handleKnowledgeEvolutionDeployments",
        args: { url },
        operationId: "knowledge.evolution.deployments.list",
        input: { cursor: "next", limit: "5" },
        errorMessage: "列出检索 profile 部署失败。"
      },
      {
        method: "handleKnowledgeEvolutionDeploymentPromote",
        args: { requestBody: body, deploymentId: "deploy-2" },
        operationId: "knowledge.evolution.deployments.promote",
        input: { status: "ready", approve: true, deploymentId: "deploy-2" },
        errorMessage: "提升检索 profile 灰度部署失败。"
      },
      {
        method: "handleKnowledgeEvolutionDeploymentRollback",
        args: { requestBody: body, deploymentId: "deploy-3" },
        operationId: "knowledge.evolution.deployments.rollback",
        input: { status: "ready", approve: true, deploymentId: "deploy-3" },
        errorMessage: "回滚检索 profile 部署失败。"
      },
      {
        method: "handleKnowledgeGraph",
        args: { url },
        operationId: "knowledge.graph",
        input: { cursor: "next", limit: "5" },
        context: { metadataStore: harness.metadataStore },
        errorMessage: "读取知识图谱失败。"
      }
    ];

    for (const testCase of cases) {
      await harness.handlers[testCase.method]({
        response,
        authSession,
        ...testCase.args
      });
      expect(harness.sendConsoleDomainOperation).toHaveBeenLastCalledWith(expect.objectContaining({
        operationId: testCase.operationId,
        ...(testCase.input ? { input: testCase.input } : {}),
        response,
        context: testCase.context || {
          scope: "knowledge-workflow",
          authSession
        },
        errorMessage: testCase.errorMessage
      }));
    }
  });
});
