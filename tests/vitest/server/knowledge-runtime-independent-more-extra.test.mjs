import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createKnowledgeAgentSkillRuntime,
  KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION
} from "../../../server/platform/specialized/knowledge/invocation/knowledge-agent-skill-runtime/index.mjs";
import {
  createSystemControllerKnowledgeRuntimeHandlers
} from "../../../server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs";
import {
  DEFAULT_FEATURE_EDITION,
  FEATURE_MANIFEST,
  activeClientModuleIds,
  buildClientPackagingConfig,
  collectPackagePlan,
  decorateOperationsWithFeatures,
  diffFeaturePlans,
  filterOperationsForFeatures,
  getFeatureEntries,
  getFeatureMap,
  loadFeatureProfile,
  operationFeatureId,
  publicFeatureRuntime,
  resolveFeatureRuntime,
  resolveFeatureRuntimeFromEnv,
  validateFeatureManifest,
  writeFeaturePlanArtifacts
} from "../../../server/platform/interactive/features/feature-manifest.mjs";
import {
  recoverBackgroundSupervisor,
  recoverSystemInspection,
  supervisorLaunchAgentTargets,
  systemInspectionLaunchAgentTargets
} from "../../../server/platform/common/devops/supervisor-recovery/supervisor-recovery.mjs";

const tempDirs = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function createKnowledgeHarness(overrides = {}) {
  const searchCalls = [];
  const decisionCalls = [];
  const evidenceGate = overrides.evidenceGate || {
    evaluate: vi.fn((input) => ({
      ok: overrides.gateOk ?? true,
      decision: overrides.gateDecision || (overrides.gateOk === false ? "needs_more_evidence" : "pass"),
      recommendations: overrides.recommendations || ["need more evidence"],
      input
    }))
  };
  const knowledgeCore = overrides.knowledgeCore || {
    enabled: true,
    search: vi.fn(async (input) => {
      searchCalls.push(input);
      return {
        query: input.query,
        protocolVersion: "v0.0.1:knowledge:core-1",
        items: overrides.searchItems || [
          {
            evidenceId: "ev-1",
            itemId: "item-1",
            score: 0.91,
            title: "result one",
            snippet: "first"
          },
          {
            evidenceId: "ev-1",
            itemId: "item-1",
            score: 0.98,
            title: "result one",
            snippet: "first-high"
          }
        ],
        explain: { candidateCount: 2 }
      };
    })
  };
  const runtime = overrides.runtime || {
    mounts: {
      knowledgeBase: knowledgeCore
    }
  };
  const modelDecisionRuntime = overrides.modelDecisionRuntime || {
    protocolVersion: "v0.0.1:strategy:model-decision-1",
    describe: vi.fn(() => ({
      roles: [
        { roleId: "query_rewriter", fallback: "mock-query-rewriter" },
        { roleId: "evidence_entailment_judge", fallback: "mock-evidence-judge" },
        { roleId: "failure_attributor", fallback: "mock-failure-attributor" }
      ]
    })),
    decide: vi.fn(async (input) => {
      decisionCalls.push(input);
      if (input.roleId === "query_rewriter") {
        return { decision: { queryRewrites: ["deterministic rewrite"] } };
      }
      if (input.roleId === "evidence_entailment_judge") {
        return { decision: { verdict: "supported" } };
      }
      return { decision: { cause: "too little evidence" } };
    })
  };

  const runtimeSkill = createKnowledgeAgentSkillRuntime({
    runtime,
    evidenceGate,
    modelDecisionRuntime
  });

  return {
    decisionCalls,
    evidenceGate,
    knowledgeCore,
    modelDecisionRuntime,
    runtime,
    runtimeSkill,
    searchCalls
  };
}

function createControllerHarness(overrides = {}) {
  const sendConsoleDomainOperation =
    overrides.sendConsoleDomainOperation ||
    vi.fn(async (payload) => ({ ok: true, payload }));
  const parseJsonBody =
    overrides.parseJsonBody ||
    vi.fn((requestBody) => {
      if (!requestBody || requestBody.length === 0) {
        return {};
      }
      return JSON.parse(requestBody.toString("utf8"));
    });
  const protocolPayload =
    overrides.protocolPayload ||
    vi.fn((requestBody, url) => {
      if (requestBody?.length > 0) {
        return JSON.parse(requestBody.toString("utf8"));
      }
      return url ? Object.fromEntries(url.searchParams.entries()) : {};
    });
  const queryPayload =
    overrides.queryPayload ||
    vi.fn((url) => (url ? Object.fromEntries(url.searchParams.entries()) : {}));
  const knowledgeDomainContext =
    overrides.knowledgeDomainContext ||
    vi.fn((authSession) => ({ scope: "knowledge-domain", authSession }));
  const knowledgeWorkflowContext =
    overrides.knowledgeWorkflowContext ||
    vi.fn((authSession) => ({ scope: "knowledge-workflow", authSession }));
  const accessControlContext =
    overrides.accessControlContext ||
    vi.fn((authSession, extra = {}) => ({ scope: "access-control", authSession, ...extra }));

  const handlers = createSystemControllerKnowledgeRuntimeHandlers({
    sendConsoleDomainOperation,
    parseJsonBody,
    protocolPayload,
    queryPayload,
    knowledgeDomainContext,
    knowledgeWorkflowContext,
    runtime: overrides.runtime || { name: "runtime" },
    jobWorkflowProvider: overrides.jobWorkflowProvider || { name: "job-workflow" },
    knowledgeSourceService: overrides.knowledgeSourceService || { name: "knowledge-source" },
    metadataStore: overrides.metadataStore || { name: "metadata-store" },
    clientRuntimeAllocator: overrides.clientRuntimeAllocator || { name: "client-runtime-allocator" },
    modelDecisionRuntime: overrides.modelDecisionRuntime || { name: "model-decision-runtime" },
    strategyManagementProvider: overrides.strategyManagementProvider || { name: "strategy-management" },
    agentWorkspace: overrides.agentWorkspace || { name: "agent-workspace" },
    accessControlContext,
    consoleDomainServices: overrides.consoleDomainServices || { name: "console-domain-services" }
  });

  return {
    accessControlContext,
    handlers,
    knowledgeDomainContext,
    knowledgeWorkflowContext,
    parseJsonBody,
    protocolPayload,
    queryPayload,
    sendConsoleDomainOperation
  };
}

describe("knowledge agent skill runtime independent coverage", () => {
  it("exposes the protocol version, plans empty input, and falls back when knowledge core is missing", async () => {
    expect(KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION).toBe("v0.0.1:knowledge:agent-skill-1");

    const harness = createKnowledgeHarness({
      runtime: { mounts: { knowledgeBase: null } }
    });

    const description = harness.runtimeSkill.describe();
    expect(description.protocolVersion).toBe(KNOWLEDGE_AGENT_SKILL_PROTOCOL_VERSION);
    expect(description.toolPolicy).toMatchObject({
      coarseToFineRequired: true,
      canonicalWritesAllowed: false,
      rawEvidenceRewriteAllowed: false
    });
    expect(description.modelRoles).toEqual([
      { roleId: "query_rewriter", fallback: "mock-query-rewriter" },
      { roleId: "evidence_entailment_judge", fallback: "mock-evidence-judge" },
      { roleId: "failure_attributor", fallback: "mock-failure-attributor" }
    ]);

    const planned = harness.runtimeSkill.plan({ query: "   " });
    expect(planned.plan).toMatchObject({
      query: "",
      intent: "explore",
      coarseIndexFirst: true,
      retrieval: {
        endpoint: "/api/knowledge/search",
        method: "POST"
      }
    });
    expect(planned.plan.queryRewrites).toEqual([" 证据 时间 人物 金额 来源"]);

    const result = await harness.runtimeSkill.run({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("knowledge_core_unavailable");
    expect(result.plan.intent).toBe("explore");
  });

  it("runs rewrite, merge, and gate branches with deterministic mocks", async () => {
    const harness = createKnowledgeHarness({
      gateOk: false,
      gateDecision: "needs_more_evidence"
    });

    const result = await harness.runtimeSkill.run({
      query: "请总结 alpha",
      answer: "结论: alpha is ready",
      semanticSupportRequired: true,
      modelEnabled: true,
      thresholds: {
        minEvidence: 1,
        minSources: 1,
        requireHierarchy: true,
        requireCitationsForAnswer: true
      }
    });

    expect(harness.modelDecisionRuntime.decide).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "query_rewriter"
    }));
    expect(harness.modelDecisionRuntime.decide).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "evidence_entailment_judge"
    }));
    expect(harness.modelDecisionRuntime.decide).toHaveBeenCalledWith(expect.objectContaining({
      roleId: "failure_attributor"
    }));
    expect(harness.searchCalls.map((call) => call.query)).toEqual([
      "请总结 alpha",
      "请总结 alpha 关键事项 风险 时间 金额 责任 决策",
      "deterministic rewrite"
    ]);
    expect(result.ok).toBe(false);
    expect(result.searchResult.items).toHaveLength(1);
    expect(result.answerPolicy).toBe("retrieve_more_or_report_insufficient_evidence");
    expect(result.nextActions).toEqual(["need more evidence"]);
    expect(harness.evidenceGate.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      query: "请总结 alpha",
      semanticJudgement: expect.any(Object)
    }));
  });
});

describe("system controller knowledge runtime handlers independent coverage", () => {
  it("uses fallback operation ids and tolerates empty request bodies", async () => {
    const harness = createControllerHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-1" };

    await harness.handlers.handleKnowledgeConsole({
      operation: null,
      response
    });
    await harness.handlers.handleCreateKnowledgeSource({
      operation: {},
      requestBody: undefined,
      response
    });
    await harness.handlers.handleKnowledgeSync({
      operation: { id: "" },
      url: new URL("http://example.test/console?source=alpha"),
      response,
      authSession
    });
    await harness.handlers.handleSearch({
      operation: null,
      url: new URL("http://example.test/console?query=alpha&limit=2"),
      response,
      authSession
    });

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operationId: "knowledge.console",
      response,
      errorMessage: "读取知识库控制台状态失败。"
    }));
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operationId: "knowledge.sources.create",
      input: {},
      response,
      errorMessage: "创建知识库目录失败。"
    }));
    expect(harness.protocolPayload).toHaveBeenCalledWith(Buffer.alloc(0), expect.any(URL));
    expect(harness.knowledgeDomainContext).toHaveBeenCalledWith(authSession);
    expect(harness.knowledgeWorkflowContext).toHaveBeenCalledWith(authSession);
  });
});

describe("feature manifest independent coverage", () => {
  it("exposes stable manifest data and clones feature entries", async () => {
    expect(DEFAULT_FEATURE_EDITION).toBe("enterprise");
    expect(FEATURE_MANIFEST.schemaVersion).toBe(1);
    expect(FEATURE_MANIFEST.groups).toContain("knowledge");

    const entries = getFeatureEntries();
    const featureMap = getFeatureMap();
    expect(entries).toHaveLength(FEATURE_MANIFEST.features.length);
    expect(featureMap.get("knowledge-core")).toMatchObject({
      featureId: "knowledge-core",
      label: "KnowledgeCore search, sources, evidence, rules, and graph shell"
    });

    entries[0].label = "mutated";
    expect(getFeatureMap().get("core-platform").label).toBe("Core platform");

    expect(await loadFeatureProfile("")).toBeNull();
  });

  it("resolves runtime defaults, env inputs, and feature mappings", async () => {
    const runtime = resolveFeatureRuntime({
      profile: null,
      now: "2024-01-02T03:04:05.678Z"
    });
    const fromEnv = await resolveFeatureRuntimeFromEnv({
      env: {
        PACT_FEATURES: "knowledge-core, agent-gateway",
        PACT_DISABLED_FEATURES: "macos-mail"
      }
    });

    expect(runtime.edition).toBe(DEFAULT_FEATURE_EDITION);
    expect(runtime.profileName).toBe(DEFAULT_FEATURE_EDITION);
    expect(runtime.generatedAt).toBe("2024-01-02T03:04:05.678Z");
    expect(runtime.activeFeatureIds).toContain("core-platform");
    expect(fromEnv.activeFeatureIds).toContain("knowledge-core");
    expect(operationFeatureId({})).toBe("core-platform");
    expect(operationFeatureId({ id: "knowledge.evidence_gate.evaluate" })).toBe("knowledge-distillation");
    expect(decorateOperationsWithFeatures([{ id: "settings.model_probe" }])).toEqual([
      { id: "settings.model_probe", featureId: "agent-gateway" }
    ]);
    expect(filterOperationsForFeatures([{ id: "agents.list" }], null)).toEqual([
      { id: "agents.list", featureId: "agent-management" }
    ]);
    expect(publicFeatureRuntime({}, [{ id: "agents.list" }])).toMatchObject({
      edition: DEFAULT_FEATURE_EDITION,
      operations: {
        total: 1,
        active: 1,
        disabled: 0
      }
    });
  });

  it("validates, packages, writes, and diffs feature plans", async () => {
    const runtime = resolveFeatureRuntime({
      edition: "custom",
      profile: {
        name: "tmp-profile",
        features: ["knowledge-core", "agent-gateway"]
      },
      now: "2024-01-02T03:04:05.678Z"
    });

    expect(activeClientModuleIds(runtime)).toContain("knowledge-agent");
    expect(() =>
      validateFeatureManifest({
        operations: [{ id: "knowledge.search" }],
        clientModules: [],
        validateClientModules: true
      })
    ).toThrow(/references unknown client module/);

    expect(
      validateFeatureManifest({
        operations: [{ id: "knowledge.search" }],
        clientModules: {},
        validateClientModules: false
      })
    ).toMatchObject({
      ok: true,
      operationCount: 1
    });

    const packagingConfig = buildClientPackagingConfig(
      {
        modules: {
          "portable-data": {
            portableDirectories: ["connectors/chat", "mail-imports", "knowledge", "other"]
          },
          legacyOnly: {
            legacyDevOnly: true,
            required: true
          }
        }
      },
      runtime
    );
    expect(packagingConfig.featureProfile.activeFeatureIds).toContain("knowledge-core");
    expect(packagingConfig.modules["portable-data"].portableDirectories).toEqual(["knowledge", "other"]);
    expect(packagingConfig.modules.legacyOnly.enabled).toBe(false);
    expect(packagingConfig.modules.legacyOnly.required).toBe(false);

    const packagePlan = collectPackagePlan(runtime, { surface: "server" });
    expect(packagePlan.surface).toBe("server");
    expect(packagePlan.webPanels).toEqual([]);
    expect(packagePlan.includePaths).toEqual([...packagePlan.includePaths].sort());

    const outputDir = await makeTempDir("pact-feature-plan-");
    const written = await writeFeaturePlanArtifacts({
      outputDir,
      featureRuntime: runtime,
      packagePlan,
      clientPackagingConfig: packagingConfig,
      verificationReport: { ok: true }
    });
    expect(written).toHaveLength(7);
    await expect(fs.readFile(path.join(outputDir, "package-manifest.json"), "utf8")).resolves.toContain(
      '"surface": "server"'
    );

    expect(diffFeaturePlans(
      { edition: "left", activeFeatureIds: ["core-platform", "knowledge-core"] },
      { edition: "right", activeFeatureIds: ["core-platform", "agent-gateway"] }
    )).toEqual({
      from: "left",
      to: "right",
      added: ["agent-gateway"],
      onlyInFrom: ["knowledge-core"],
      unchanged: ["core-platform"]
    });
  });
});

describe("supervisor recovery independent coverage", () => {
  it("builds launch agent targets and handles already-running, unsupported, and missing paths", async () => {
    const supervisorTargets = supervisorLaunchAgentTargets({
      uid: 501,
      homeDir: "/Users/test",
      serviceLabel: "custom-supervisor"
    });
    const inspectionTargets = systemInspectionLaunchAgentTargets({
      uid: 502,
      homeDir: "/Users/test",
      plistPath: "/tmp/system-inspection.plist"
    });

    expect(supervisorTargets).toEqual({
      serviceLabel: "custom-supervisor",
      uid: 501,
      launchTarget: "gui/501",
      serviceTarget: "gui/501/custom-supervisor",
      plistPath: "/Users/test/Library/LaunchAgents/custom-supervisor.plist"
    });
    expect(inspectionTargets).toEqual({
      serviceLabel: "dev.pact.system-inspection",
      uid: 502,
      launchTarget: "gui/502",
      serviceTarget: "gui/502/dev.pact.system-inspection",
      plistPath: "/tmp/system-inspection.plist"
    });

    await expect(
      recoverBackgroundSupervisor({
        backgroundStatus: {
          supervisor: {
            alive: true
          }
        },
        platform: "darwin"
      })
    ).resolves.toMatchObject({
      ok: true,
      attempted: false,
      reason: "already_running"
    });

    await expect(
      recoverBackgroundSupervisor({
        platform: "linux"
      })
    ).resolves.toMatchObject({
      ok: false,
      attempted: false,
      reason: "unsupported_platform",
      platform: "linux"
    });

    await expect(
      recoverSystemInspection({
        platform: "darwin",
        fileExists: async () => false
      })
    ).resolves.toMatchObject({
      ok: false,
      attempted: false,
      reason: "plist_missing"
    });
  });

  it("covers kickstart, bootstrap retry, and bootstrap failure paths", async () => {
    const kickstartCommands = [];
    await expect(
      recoverBackgroundSupervisor({
        platform: "darwin",
        fileExists: async () => true,
        runCommand: async (_command, args) => {
          kickstartCommands.push(args);
          return { code: args[0] === "kickstart" ? 0 : 1, signal: "", stdout: "", stderr: "" };
        },
        plistPath: "/tmp/background.plist",
        uid: 400
      })
    ).resolves.toMatchObject({
      ok: true,
      attempted: true,
      action: "kickstart"
    });
    expect(kickstartCommands).toEqual([["kickstart", "-k", "gui/400/dev.pact.background-supervisor"]]);

    const bootstrapCommands = [];
    let systemInspectionKickstartCount = 0;
    await expect(
      recoverSystemInspection({
        platform: "darwin",
        fileExists: async () => true,
        runCommand: async (_command, args) => {
          bootstrapCommands.push(args);
          if (args[0] === "kickstart") {
            systemInspectionKickstartCount += 1;
            if (systemInspectionKickstartCount === 1) {
              return { code: 1, signal: "", stdout: "", stderr: "kickstart failed" };
            }
            return { code: 0, signal: "", stdout: "", stderr: "" };
          }
          return { code: 0, signal: "", stdout: "", stderr: "" };
        },
        plistPath: "/tmp/system-inspection.plist",
        uid: 401
      })
    ).resolves.toMatchObject({
      ok: true,
      attempted: true,
      action: "bootstrap_then_kickstart"
    });

    await expect(
      recoverBackgroundSupervisor({
        platform: "darwin",
        fileExists: async () => true,
        runCommand: async (_command, args) => {
          if (args[0] === "kickstart") {
            return { code: 1, signal: "", stdout: "", stderr: "kickstart failed" };
          }
          return { code: 1, signal: "", stdout: "", stderr: "bootstrap failed" };
        },
        plistPath: "/tmp/background.plist",
        uid: 402
      })
    ).resolves.toMatchObject({
      ok: false,
      attempted: true,
      reason: "bootstrap_failed"
    });
  });
});
