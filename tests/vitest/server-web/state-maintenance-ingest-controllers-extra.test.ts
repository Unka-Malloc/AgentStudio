// @vitest-environment jsdom
import { computed, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConsoleKnowledgeIngestController,
} from "../../../server-web/composables/console-knowledge-ingest-controller";
import {
  createConsoleMaintenanceAgentController,
} from "../../../server-web/composables/console-maintenance-agent-controller";
import {
  baseServerEventTopics,
  createConsoleStateEventReducerController,
} from "../../../server-web/composables/console-state-event-reducer-controller";
import type {
  AgentModelConfig,
  MaintenanceAgentConfig,
  MaintenanceAgentRun,
  ProtocolEvent,
  ServerConsoleState,
  SplitJob,
} from "../../../server-web/lib/types";

const mockKnowledgeUpload = vi.hoisted(() => ({
  createKnowledgeUploadSession: vi.fn(),
}));

const mockJobsClient = vi.hoisted(() => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
}));

const mockKnowledgeDocumentsClient = vi.hoisted(() => ({
  getNormalizedDocuments: vi.fn(),
}));

const mockMaintenanceClient = vi.hoisted(() => ({
  getMaintenanceAgentConfig: vi.fn(),
  listMaintenanceAgentRuns: vi.fn(),
  saveMaintenanceAgentConfig: vi.fn(),
  chatMaintenanceAgent: vi.fn(),
  startMaintenanceAgentRun: vi.fn(),
  approveMaintenanceAgentRun: vi.fn(),
  cancelMaintenanceAgentRun: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-upload-session", () => ({
  createKnowledgeUploadSession: mockKnowledgeUpload.createKnowledgeUploadSession,
}));

vi.mock("../../../server-web/lib/jobs-client", () => ({
  createJob: mockJobsClient.createJob,
  getJob: mockJobsClient.getJob,
}));

vi.mock("../../../server-web/lib/knowledge-documents-client", () => ({
  getNormalizedDocuments: mockKnowledgeDocumentsClient.getNormalizedDocuments,
}));

vi.mock("../../../server-web/lib/maintenance-agent-client", () => ({
  getMaintenanceAgentConfig: mockMaintenanceClient.getMaintenanceAgentConfig,
  listMaintenanceAgentRuns: mockMaintenanceClient.listMaintenanceAgentRuns,
  saveMaintenanceAgentConfig: mockMaintenanceClient.saveMaintenanceAgentConfig,
  chatMaintenanceAgent: mockMaintenanceClient.chatMaintenanceAgent,
  startMaintenanceAgentRun: mockMaintenanceClient.startMaintenanceAgentRun,
  approveMaintenanceAgentRun: mockMaintenanceClient.approveMaintenanceAgentRun,
  cancelMaintenanceAgentRun: mockMaintenanceClient.cancelMaintenanceAgentRun,
}));

afterEach(() => {
  vi.clearAllMocks();
});

function makeServerState(overrides: Record<string, unknown> = {}) {
  return {
    server: { runtimeId: "runtime-01" },
    runtime: { mountModules: { local: "v1" }, info: "x", pid: "123" },
    settings: {
      path: "/etc/settings",
      value: { schemaVersion: 1, openAiModel: "gpt", deepSeekApiBaseUrl: "https://deepseek.example" },
    },
    discovery: { path: "/etc/discovery", value: { items: [] }, bootstrap: { default: true } },
    emailRules: { path: "/etc/email-rules", rules: {} },
    expertVocabulary: { path: "/etc/vocab", vocabulary: {} },
    knowledgeTaxonomy: { schemaVersion: 1, topics: [] },
    storage: { summary: {} },
    jobs: {
      summary: {
        totalCount: 0,
        queuedCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
      },
      items: [],
    },
    clients: {},
    maintenanceAgent: null,
    knowledgeConsole: { available: true, health: null, capabilities: null, maintenance: null, recentJobs: [] },
    ...overrides,
  } as unknown as ServerConsoleState;
}

function makeMaintenanceConfig(): MaintenanceAgentConfig {
  return {
    schemaVersion: 1,
    enabled: true,
    plannerMode: "gateway",
    autoApproveRisk: "safe_write",
    scheduler: { tickSeconds: 60 },
    concurrency: { maxActiveRuns: 1 },
    schedules: [
      { id: "s-1", label: "主计划", enabled: true, nextRunAt: "2026-06-04T01:00:00.000Z", runbook: "rb-1", intervalMinutes: 15 },
      { id: "s-2", label: "备份", enabled: false, nextRunAt: "2026-06-04T00:00:00.000Z", runbook: "rb-2", intervalMinutes: 30 },
    ],
    runbooks: {
      "health_smoke": { id: "health_smoke", label: "健康巡检" },
      "knowledge_maintenance_review": { id: "knowledge_maintenance_review", label: "知识复核巡检" },
    },
  } as MaintenanceAgentConfig;
}

function makeMaintenanceRun(id: string, status: MaintenanceAgentRun["status"], overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: id,
    status,
    trigger: "manual",
    source: "user",
    intent: "inspection",
    summary: "inspection summary",
    risk: "safe_write",
    requiresApproval: false,
    approvalReason: "",
    planHash: "h1",
    plan: {
      schemaVersion: 1,
      source: "planner",
      intent: "intent",
      summary: "summary",
      risk: "safe_write",
      requiresApproval: false,
      approvalReason: "",
      steps: [],
    },
    steps: [],
    actor: null,
    input: {},
    createdAt: "2026-06-04T01:00:00.000Z",
    updatedAt: "2026-06-04T01:00:00.000Z",
    startedAt: "2026-06-04T01:01:00.000Z",
    completedAt: "2026-06-04T01:02:00.000Z",
    approvedAt: "",
    cancelRequested: false,
    error: "",
    ...overrides,
  } as unknown as MaintenanceAgentRun;
}

function makeSplitJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-a",
    status: "running",
    createdAt: "2026-06-04T01:00:00.000Z",
    updatedAt: "2026-06-04T01:00:00.000Z",
    progressPercent: 0,
    stage: "queued",
    ...overrides,
  } as unknown as SplitJob;
}

function eventOf(topic: string, payload: unknown, id = "evt") {
  return { id, topic, payload } as ProtocolEvent;
}

async function flushPending() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("console state event reducer controller", () => {
  it("filters event topics by feature flags", () => {
    const controller = createConsoleStateEventReducerController({
      applyAgentExploreDefaultsFromSettings: vi.fn(),
      applyMaintenanceAgentConfigFromEvent: vi.fn(() => true),
      applyMaintenanceAgentStateFromConsoleState: vi.fn(),
      applyWordCloudEvent: vi.fn(),
      consoleState: ref(null),
      discoveryDraftDirty: ref(false),
      expertVocabularyDraftDirty: ref(false),
      hasFeature: (featureId: string) => featureId === "knowledge-core",
      knowledgeConsole: ref(null),
      knowledgeSourceState: ref(null),
      mountDraftDirty: ref(false),
      normalizedSettingsFromServer: (value) => value as Record<string, unknown>,
      refreshExpertRules: vi.fn(),
      refreshKnowledgeConflicts: vi.fn(),
      refreshMaintenanceAgent: vi.fn(),
      removeJobFromEvent: vi.fn(),
      replaceDiscoveryDraftFromServer: vi.fn(),
      replaceExpertVocabularyDraftFromServer: vi.fn(),
      replaceMountDraftFromServer: vi.fn(),
      replaceRulesDraftFromServer: vi.fn(),
      replaceSettingsDraftFromServer: vi.fn(),
      rulesDraftDirty: ref(false),
      settingsDraftDirty: ref(false),
      upsertJobFromEvent: vi.fn(),
    });

    const currentTopics = controller.currentServerEventTopics().split(",");
    expect(currentTopics).toContain("knowledge.changes");
    expect(currentTopics).not.toContain("maintenance.agent.run.completed");
    expect(currentTopics).not.toContain("agent_sync.config");
    expect(baseServerEventTopics).toContain("knowledge.changes");
  });

  it("applies full console state with draft synchronization control", () => {
    const draftState = {
      applySettingsDraft: vi.fn(),
      applyDiscoveryDraft: vi.fn(),
      applyMountDraft: vi.fn(),
      applyRulesDraft: vi.fn(),
      applyVocabularyDraft: vi.fn(),
    };
    const consoleState = ref<ServerConsoleState | null>(makeServerState());
    const controller = createConsoleStateEventReducerController({
      applyAgentExploreDefaultsFromSettings: vi.fn(),
      applyMaintenanceAgentConfigFromEvent: vi.fn(),
      applyMaintenanceAgentStateFromConsoleState: vi.fn(),
      applyWordCloudEvent: vi.fn(),
      consoleState,
      discoveryDraftDirty: ref(false),
      expertVocabularyDraftDirty: ref(true),
      hasFeature: () => true,
      knowledgeConsole: ref(null),
      knowledgeSourceState: ref(null),
      mountDraftDirty: ref(false),
      normalizedSettingsFromServer: (value) => ({ ...value, normalized: true }),
      refreshExpertRules: vi.fn(),
      refreshKnowledgeConflicts: vi.fn(),
      refreshMaintenanceAgent: vi.fn(),
      removeJobFromEvent: vi.fn(),
      replaceDiscoveryDraftFromServer: draftState.applyDiscoveryDraft,
      replaceExpertVocabularyDraftFromServer: draftState.applyVocabularyDraft,
      replaceMountDraftFromServer: draftState.applyMountDraft,
      replaceRulesDraftFromServer: draftState.applyRulesDraft,
      replaceSettingsDraftFromServer: draftState.applySettingsDraft,
      rulesDraftDirty: ref(true),
      settingsDraftDirty: ref(false),
      upsertJobFromEvent: vi.fn(),
    });

    controller.applyConsoleState({
      ...makeServerState(),
      settings: { ...makeServerState().settings, value: { schemaVersion: 2, openAiModel: "x" } },
    } as ServerConsoleState, { forceDrafts: true });

    expect(consoleState.value?.settings.value).toMatchObject({ openAiModel: "x", normalized: true });
    expect(draftState.applySettingsDraft).toHaveBeenCalledTimes(1);
    expect(draftState.applyMountDraft).toHaveBeenCalledTimes(1);
    expect(draftState.applyDiscoveryDraft).toHaveBeenCalledTimes(1);
    expect(draftState.applyRulesDraft).toHaveBeenCalledTimes(1);
    expect(draftState.applyVocabularyDraft).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid payloads and returns false", () => {
    const applyMaintenanceAgentConfigFromEvent = vi.fn();
    const controller = createConsoleStateEventReducerController({
      applyAgentExploreDefaultsFromSettings: vi.fn(),
      applyMaintenanceAgentConfigFromEvent,
      applyMaintenanceAgentStateFromConsoleState: vi.fn(),
      applyWordCloudEvent: vi.fn(),
      consoleState: ref(makeServerState()),
      discoveryDraftDirty: ref(false),
      expertVocabularyDraftDirty: ref(false),
      hasFeature: () => true,
      knowledgeConsole: ref(null),
      knowledgeSourceState: ref(null),
      mountDraftDirty: ref(false),
      normalizedSettingsFromServer: (value) => value,
      refreshExpertRules: vi.fn(),
      refreshKnowledgeConflicts: vi.fn(),
      refreshMaintenanceAgent: vi.fn(),
      removeJobFromEvent: vi.fn(),
      replaceDiscoveryDraftFromServer: vi.fn(),
      replaceExpertVocabularyDraftFromServer: vi.fn(),
      replaceMountDraftFromServer: vi.fn(),
      replaceRulesDraftFromServer: vi.fn(),
      replaceSettingsDraftFromServer: vi.fn(),
      rulesDraftDirty: ref(false),
      settingsDraftDirty: ref(false),
      upsertJobFromEvent: vi.fn(),
    });

    expect(controller.applyServerEvent({ id: "1", topic: "system.console_state", payload: "bad" } as any)).toBe(false);
    expect(controller.applyServerEvent({ id: "2", topic: "jobs.job", payload: "bad" } as any)).toBe(false);
    expect(controller.applyServerEvent(eventOf("maintenance.agent.config", { value: "bad" }))).toBe(false);
    expect(applyMaintenanceAgentConfigFromEvent).toHaveBeenCalledTimes(1);
  });

  it("tracks upload trace events without duplicating by id and caps count", () => {
    const controller = createConsoleStateEventReducerController({
      applyAgentExploreDefaultsFromSettings: vi.fn(),
      applyMaintenanceAgentConfigFromEvent: vi.fn(),
      applyMaintenanceAgentStateFromConsoleState: vi.fn(),
      applyWordCloudEvent: vi.fn(),
      consoleState: ref(makeServerState()),
      discoveryDraftDirty: ref(false),
      expertVocabularyDraftDirty: ref(false),
      hasFeature: () => true,
      knowledgeConsole: ref(null),
      knowledgeSourceState: ref(null),
      mountDraftDirty: ref(false),
      normalizedSettingsFromServer: (value) => value,
      refreshExpertRules: vi.fn(),
      refreshKnowledgeConflicts: vi.fn(),
      refreshMaintenanceAgent: vi.fn(),
      removeJobFromEvent: vi.fn(),
      replaceDiscoveryDraftFromServer: vi.fn(),
      replaceExpertVocabularyDraftFromServer: vi.fn(),
      replaceMountDraftFromServer: vi.fn(),
      replaceRulesDraftFromServer: vi.fn(),
      replaceSettingsDraftFromServer: vi.fn(),
      rulesDraftDirty: ref(false),
      settingsDraftDirty: ref(false),
      upsertJobFromEvent: vi.fn(),
    });

    const first = eventOf("uploads.trace", { file: "a" }, "trace-1");
    expect(controller.applyServerEvent(first)).toBe(true);
    expect(controller.uploadTraceEvents.value.map((item) => item.id)).toEqual(["trace-1"]);

    expect(controller.applyServerEvent(eventOf("uploads.trace", { file: "again" }, "trace-1"))).toBe(true);
    expect(controller.uploadTraceEvents.value).toHaveLength(1);
  });

  it("processes knowledge/job related events and triggers refresh hooks", async () => {
    const refreshKnowledgeConflicts = vi.fn();
    const removeJobFromEvent = vi.fn();
    const upsertJobFromEvent = vi.fn().mockReturnValue(true);
    const applyWordCloudEvent = vi.fn().mockReturnValue(true);
    const refreshMaintenanceAgent = vi.fn();
    const replaceSettingsDraftFromServer = vi.fn();
    const replaceRulesDraftFromServer = vi.fn();
    const replaceVocabularyDraftFromServer = vi.fn();
    const replaceDiscoveryDraftFromServer = vi.fn();
    const replaceMountDraftFromServer = vi.fn();
    const applyMaintenanceAgentStateFromConsoleState = vi.fn();
    const knowledgeSourceState = ref(null as any);
    const consoleState = ref(
      makeServerState({
        maintenanceAgent: null,
        jobs: { summary: { totalCount: 1, queuedCount: 0, runningCount: 1, completedCount: 0, failedCount: 0 }, items: [] },
        discovery: { path: "/etc/discovery", value: { foo: "bar" }, bootstrap: { from: "server" } },
      }),
    );
    const knowledgeConsole = ref({ available: true, health: null, capabilities: null, maintenance: null, recentJobs: [] } as any);

    const controller = createConsoleStateEventReducerController({
      applyAgentExploreDefaultsFromSettings: vi.fn(),
      applyMaintenanceAgentConfigFromEvent: vi.fn(),
      applyMaintenanceAgentStateFromConsoleState,
      applyWordCloudEvent,
      consoleState,
      discoveryDraftDirty: ref(false),
      expertVocabularyDraftDirty: ref(false),
      hasFeature: () => true,
      knowledgeConsole,
      knowledgeSourceState,
      mountDraftDirty: ref(false),
      normalizedSettingsFromServer: (value) => value,
      refreshExpertRules: vi.fn(),
      refreshKnowledgeConflicts,
      refreshMaintenanceAgent,
      removeJobFromEvent,
      replaceDiscoveryDraftFromServer,
      replaceExpertVocabularyDraftFromServer: replaceVocabularyDraftFromServer,
      replaceMountDraftFromServer,
      replaceRulesDraftFromServer,
      replaceSettingsDraftFromServer,
      rulesDraftDirty: ref(false),
      settingsDraftDirty: ref(false),
      upsertJobFromEvent,
    });

    expect(controller.applyServerEvent(eventOf("jobs.job", { job: makeSplitJob({ id: "job-a", status: "completed" }) }))).toBe(true);
    expect(upsertJobFromEvent).toHaveBeenCalledTimes(1);
    expect(refreshKnowledgeConflicts).toHaveBeenCalledWith({ silent: true });

    expect(
      controller.applyServerEvent(
        eventOf("jobs.deleted", { job: makeSplitJob({ id: "job-removed" }), batchId: "batch-1" }),
      ),
    ).toBeFalsy();
    expect(removeJobFromEvent).toHaveBeenCalledWith("job-removed");

    expect(
      controller.applyServerEvent(
        eventOf("knowledge.sources", {
          state: { sourceCount: 3, available: true },
        }),
      ),
    ).toBe(true);
    expect(knowledgeSourceState.value).toMatchObject({ sourceCount: 3, available: true });
    expect(knowledgeConsole.value).toMatchObject({ sources: { sourceCount: 3, available: true } });

    expect(
      controller.applyServerEvent(
        eventOf("knowledge.word_clouds", { wordBagSet: { words: ["a", "b"] } }),
      ),
    ).toBe(true);
    expect(applyWordCloudEvent).toHaveBeenCalledWith({ words: ["a", "b"] });

    expect(controller.applyServerEvent(eventOf("knowledge.review_items", {} as any))).toBe(true);
    expect(refreshKnowledgeConflicts).toHaveBeenCalledWith({ silent: true });

    expect(
      controller.applyServerEvent(
        eventOf("settings.current", { openAiModel: "x", schemaVersion: 3 }),
      ),
    ).toBe(true);
    expect(replaceSettingsDraftFromServer).toHaveBeenCalled();

    expect(controller.applyServerEvent(eventOf("discovery.config", { value: { items: ["a"] }, bootstrap: { updated: "now" } }))).toBe(true);
    expect(replaceDiscoveryDraftFromServer).toHaveBeenCalled();

    expect(
      controller.applyServerEvent(
        eventOf("runtime.mounts", { runtime: { mountModules: { remote: "v2" }, name: "runtime-x" } }),
      ),
    ).toBe(true);
    expect(replaceMountDraftFromServer).toHaveBeenCalledWith({ remote: "v2" });
    expect(consoleState.value?.runtime.mountModules).toEqual({ remote: "v2" });

    expect(
      controller.applyServerEvent(
        eventOf("email_rules.current", { path: "/rules", rules: { allow: true } }),
      ),
    ).toBe(true);
    expect(knowledgeConsole.value).toMatchObject({ sources: { sourceCount: 3, available: true } });
    expect(consoleState.value?.emailRules).toMatchObject({ path: "/rules", rules: { allow: true } });

    expect(
      controller.applyServerEvent(
        eventOf("expert_vocabulary.current", { vocabulary: { words: ["x", "y"] } }),
      ),
    ).toBe(true);
    expect(replaceVocabularyDraftFromServer).toHaveBeenCalled();

    expect(
      controller.applyServerEvent(
        eventOf("maintenance.agent.run.completed", { run: makeMaintenanceRun("run-1", "completed") }),
      ),
    ).toBe(true);
    expect(refreshKnowledgeConflicts).toHaveBeenCalledWith({ silent: true });

    expect(controller.applyServerEvent(eventOf("storage.summary", { summary: { usage: 99 } }))).toBe(true);
    expect(consoleState.value?.storage).toEqual({ summary: { usage: 99 } });
    expect(refreshMaintenanceAgent).toHaveBeenCalled();
    await flushPending();
  });
});

describe("console maintenance agent controller", () => {
  it("derives runbook and schedule computed state from in-memory config", () => {
    const options = {
      canReadMaintenanceAgent: computed(() => true),
      clearAllBusy: vi.fn(),
      consoleState: ref(makeServerState()),
      error: ref(""),
      modelEntryStatusKey: vi.fn((entry: AgentModelConfig) => entry.agentName || entry.uid),
      setBusy: vi.fn(),
      visibleModelEntries: computed(() => [] as AgentModelConfig[]),
    };
    const controller = createConsoleMaintenanceAgentController(options);
    controller.maintenanceAgentConfig.value = makeMaintenanceConfig();
    controller.maintenanceAgentRuns.value = [
      makeMaintenanceRun("run-2", "queued", { status: "awaiting_approval" }),
      makeMaintenanceRun("run-3", "completed", { status: "completed" }),
    ];

    expect(controller.maintenanceAgentRunbooks.value).toHaveLength(2);
    expect(controller.maintenanceAgentRunbookOptionBarOptions.value[0]).toEqual({
      value: "health_smoke",
      label: "健康巡检 / health_smoke",
    });
    expect(controller.maintenanceAgentSchedules.value).toEqual(controller.maintenanceAgentConfig.value?.schedules || []);
    expect(controller.pendingMaintenanceApprovalCount.value).toBe(1);
    expect(controller.nextMaintenanceAgentRunAt.value).toBe("2026-06-04T01:00:00.000Z");
    expect(controller.displayedMaintenanceAgentRuns.value[0].runId).toBe("run-2");
    expect(controller.latestMaintenanceAgentRun.value?.runId).toBe("run-2");
  });

  it("applies maintenance state from console snapshot and retains compatible selected run", () => {
    const options = {
      canReadMaintenanceAgent: computed(() => true),
      clearAllBusy: vi.fn(),
      consoleState: ref(makeServerState()),
      error: ref(""),
      modelEntryStatusKey: vi.fn((entry: AgentModelConfig) => entry.uid),
      setBusy: vi.fn(),
      visibleModelEntries: computed(() => [] as AgentModelConfig[]),
    };
    const controller = createConsoleMaintenanceAgentController(options);
    controller.selectedMaintenanceAgentRun.value = makeMaintenanceRun("run-2", "completed");
    controller.applyMaintenanceAgentStateFromConsoleState({
      ...makeServerState(),
      maintenanceAgent: {
        config: makeMaintenanceConfig(),
        tools: [],
        runs: [makeMaintenanceRun("run-1", "completed"), makeMaintenanceRun("run-2", "running")],
        activeRunId: "run-2",
        queuedRunIds: [],
        pendingApprovalCount: 1,
        latestRun: null,
        nextRunAt: "",
        auditPath: "/a",
        runsPath: "/r",
      },
    },
    );

    expect(controller.maintenanceAgentConfig.value).toMatchObject({ enabled: true, runbooks: expect.any(Object) });
    expect(controller.maintenanceAgentRuns.value).toHaveLength(2);
    expect(controller.selectedMaintenanceAgentRun.value?.runId).toBe("run-2");
  });

  it("refreshes maintenance data and handles API errors", async () => {
    const setBusy = vi.fn();
    const clearAllBusy = vi.fn();
    const refreshError = ref("");
    const consoleState = ref(makeServerState());
    mockMaintenanceClient.getMaintenanceAgentConfig.mockResolvedValue({ config: makeMaintenanceConfig(), path: "/cfg" });
    mockMaintenanceClient.listMaintenanceAgentRuns.mockResolvedValue({
      items: [makeMaintenanceRun("run-refresh", "queued")],
      activeRunId: "run-refresh",
      queuedRunIds: ["run-q"],
    });

    const controller = createConsoleMaintenanceAgentController({
      canReadMaintenanceAgent: computed(() => true),
      clearAllBusy,
      consoleState,
      error: ref(""),
      modelEntryStatusKey: vi.fn((entry: AgentModelConfig) => entry.uid),
      setBusy,
      visibleModelEntries: computed(() => [] as AgentModelConfig[]),
    });
    await controller.refreshMaintenanceAgent();

    expect(setBusy).toHaveBeenCalledWith("maintenance-agent:refresh");
    expect(mockMaintenanceClient.getMaintenanceAgentConfig).toHaveBeenCalledTimes(1);
    expect(mockMaintenanceClient.listMaintenanceAgentRuns).toHaveBeenCalledWith(30);
    expect(controller.maintenanceAgentConfig.value?.runbooks).toHaveProperty("health_smoke");
    expect(controller.maintenanceAgentRuns.value[0].runId).toBe("run-refresh");
    expect(controller.latestMaintenanceAgentRun.value?.runId).toBe("run-refresh");
    expect(clearAllBusy).toHaveBeenCalled();
    expect(consoleState.value?.maintenanceAgent?.latestRun?.runId).toBe("run-refresh");
    expect(consoleState.value?.maintenanceAgent?.pendingApprovalCount).toBe(0);

    mockMaintenanceClient.getMaintenanceAgentConfig.mockRejectedValueOnce(new Error("config load failed"));
    mockMaintenanceClient.listMaintenanceAgentRuns.mockRejectedValueOnce(new Error("run list failed"));
    const controllerWithFail = createConsoleMaintenanceAgentController({
      canReadMaintenanceAgent: computed(() => true),
      clearAllBusy,
      consoleState,
      error: refreshError,
      modelEntryStatusKey: vi.fn((entry: AgentModelConfig) => entry.uid),
      setBusy,
      visibleModelEntries: computed(() => [] as AgentModelConfig[]),
    });
    await controllerWithFail.refreshMaintenanceAgent({ silent: false });
    expect(refreshError.value).toContain("config load failed");
    expect(clearAllBusy).toHaveBeenCalled();
  });

  it("runs, saves, chats, approves and cancels maintenance run actions with clear error handling", async () => {
    mockMaintenanceClient.getMaintenanceAgentConfig.mockResolvedValue({ config: makeMaintenanceConfig(), path: "/cfg" });
    mockMaintenanceClient.listMaintenanceAgentRuns.mockResolvedValue({
      items: [makeMaintenanceRun("run-active", "queued", { runId: "run-active" })],
      activeRunId: "run-active",
      queuedRunIds: [],
    });
    mockMaintenanceClient.saveMaintenanceAgentConfig.mockResolvedValue({ config: makeMaintenanceConfig() });
    mockMaintenanceClient.startMaintenanceAgentRun.mockResolvedValue(
      makeMaintenanceRun("run-started", "running", { runId: "run-started" }),
    );
    mockMaintenanceClient.chatMaintenanceAgent.mockResolvedValue({
      plan: makeMaintenanceRun("plan-run", "queued", { runId: "plan-run", planHash: "p1", plan: { schemaVersion: 1, source: "planner", intent: "x", summary: "x", risk: "safe_write", requiresApproval: false, approvalReason: "", steps: [] } }),
      run: makeMaintenanceRun("run-chat", "running"),
    });
    mockMaintenanceClient.approveMaintenanceAgentRun.mockResolvedValue({
      run: makeMaintenanceRun("run-approved", "awaiting_approval", { planHash: "ph-approve" }),
    });
    mockMaintenanceClient.cancelMaintenanceAgentRun.mockResolvedValue({
      run: makeMaintenanceRun("run-cancel", "cancelled", { planHash: "ph-cancel" }),
    });

    const actionError = ref("");
    const controller = createConsoleMaintenanceAgentController({
      canReadMaintenanceAgent: computed(() => true),
      clearAllBusy: vi.fn(),
      consoleState: ref(makeServerState()),
      error: actionError,
      modelEntryStatusKey: vi.fn((entry: AgentModelConfig) => entry.uid),
      setBusy: vi.fn(),
      visibleModelEntries: computed(() => [
        { uid: "alias-1", instanceId: "alias-1", provider: "openai-chatgpt", alias: "alias-1", label: "Alpha", agentName: "agent-alpha" },
      ] as AgentModelConfig[]),
    });

    controller.maintenanceAgentConfig.value = makeMaintenanceConfig();
    await controller.saveMaintenanceAgentConfig();
    await controller.refreshMaintenanceAgent();

    await controller.runMaintenanceAgentRunbook();
    expect(mockMaintenanceClient.startMaintenanceAgentRun).toHaveBeenCalledWith({
      runbook: "health_smoke",
      wait: true,
    });
    await controller.runMaintenanceAgentKnowledgeMaintenance();
    expect(mockMaintenanceClient.startMaintenanceAgentRun).toHaveBeenCalledWith({
      runbook: "knowledge_maintenance_review",
      wait: true,
    });

    await controller.approveMaintenanceAgentRun(makeMaintenanceRun("approve", "awaiting_approval", { runId: "approve" }));
    await controller.cancelMaintenanceAgentRun(makeMaintenanceRun("cancel", "queued", { runId: "cancel" }));
    expect(mockMaintenanceClient.approveMaintenanceAgentRun).toHaveBeenCalledWith("approve", {
      planHash: "h1",
      wait: true,
    });
    expect(mockMaintenanceClient.cancelMaintenanceAgentRun).toHaveBeenCalledWith("cancel", { reason: "console" });

    controller.maintenanceAgentConfig.value = makeMaintenanceConfig();
    controller.maintenanceAgentMessage.value = "";
    await controller.chatMaintenanceAgent();
    expect(actionError.value).toBe("请输入维护指令。");

    controller.maintenanceAgentMessage.value = "请执行巡检";
    await controller.chatMaintenanceAgent();
    expect(mockMaintenanceClient.chatMaintenanceAgent).toHaveBeenCalledWith({
      message: "请执行巡检",
      modelAlias: undefined,
      agentName: undefined,
      wait: true,
    });
  });

  it("handles maintenance action failure messages", async () => {
    mockMaintenanceClient.saveMaintenanceAgentConfig.mockRejectedValue({});
    mockMaintenanceClient.chatMaintenanceAgent.mockRejectedValue({});
    mockMaintenanceClient.startMaintenanceAgentRun.mockRejectedValue({});
    const error = ref("");
    const controller = createConsoleMaintenanceAgentController({
      canReadMaintenanceAgent: computed(() => true),
      clearAllBusy: vi.fn(),
      consoleState: ref(makeServerState()),
      error,
      modelEntryStatusKey: vi.fn((entry: AgentModelConfig) => entry.uid),
      setBusy: vi.fn(),
      visibleModelEntries: computed(() => [] as AgentModelConfig[]),
    });
    controller.maintenanceAgentConfig.value = makeMaintenanceConfig();
    await controller.saveMaintenanceAgentConfig();
    expect(error.value).toBe("保存智能巡检配置失败。");

    controller.maintenanceAgentMessage.value = "run";
    await controller.chatMaintenanceAgent();
    expect(error.value).toBe("智能巡检对话执行失败。");

    await controller.runMaintenanceAgentRunbook();
    expect(error.value).toBe("维护 runbook 执行失败。");
  });
});

describe("console knowledge ingest controller", () => {
  it("builds validated target payloads for form state", () => {
    const controller = createConsoleKnowledgeIngestController({
      clearAllBusy: vi.fn(),
      error: ref(""),
      refreshKnowledgeConsole: vi.fn(),
      refreshState: vi.fn(),
      setBusy: vi.fn(),
      settingsDraft: ref({ schemaVersion: 1 } as any),
    });

    expect(controller.canSubmitKnowledgeIngest.value).toBe(false);
    expect(controller.knowledgeIngestTargetValidationMessage.value).toBe("请至少选择一个知识入库目标。");
    expect(controller.knowledgeIngestTargetSummary.value).toBe("请选择入库目标");

    controller.knowledgeIngestTargets.value = { global: false, external: true, team: true, user: true };
    controller.knowledgeIngestExternalRefs.value = "dify:space-a\nragflow:team-b,invalid:";
    controller.knowledgeIngestTeamRefs.value = "team-x, team-y";
    controller.knowledgeIngestUserRefs.value = "";
    controller.knowledgeIngestExternalTargetLabels.value = {
      "dify:space-a": "A空间",
      "ragflow:team-b": "RAG团队",
    };

    expect(controller.canSubmitKnowledgeIngest.value).toBe(false);
    expect(controller.knowledgeIngestTargetValidationMessage.value).toBe("请选择用户私有空间时，需要填写至少一个用户。");
    controller.knowledgeIngestUserRefs.value = "u-1";

    expect(controller.canSubmitKnowledgeIngest.value).toBe(true);
    expect(controller.knowledgeIngestTargetSummary.value).toContain("Dify：A空间");
    expect(controller.knowledgeIngestTargetSummary.value).toContain("RAG Flow：RAG团队");
    expect(controller.knowledgeIngestTargetSummary.value).toContain("团队空间");
    expect(controller.knowledgeIngestTargetSummary.value).toContain("用户私有空间");
    expect(controller.knowledgeIngestTargetSummary.value).toContain("将入库到：");
  });

  it("validates ingest action inputs and updates progress for file selection", async () => {
    const refreshKnowledgeConsole = vi.fn();
    const refreshState = vi.fn();
    const setBusy = vi.fn();
    const clearAllBusy = vi.fn();
    const error = ref("");
    const controller = createConsoleKnowledgeIngestController({
      clearAllBusy,
      error,
      refreshKnowledgeConsole,
      refreshState,
      setBusy,
      settingsDraft: ref({} as any),
    });

    await controller.uploadFilesToKnowledge();
    expect(error.value).toBe("请先选择需要入库的文件。");
    expect(setBusy).toHaveBeenCalledTimes(0);

    const files = [new File(["a"], "a.txt"), new File(["bb"], "b.txt")];
    controller.onIngestFilesSelected(files);
    expect(controller.ingestProgress.value).toBe("已选择 2 个文件");

    controller.knowledgeIngestTargets.value = { global: false, external: true, team: true, user: false };
    controller.knowledgeIngestTeamRefs.value = "team-1";
    await controller.uploadFilesToKnowledge();
    expect(error.value).toBe("请选择外部知识库时，需要填写至少一个库或空间 ID。");

    controller.knowledgeIngestExternalRefs.value = "dify:a";
    mockKnowledgeUpload.createKnowledgeUploadSession.mockResolvedValueOnce({ session: { sessionId: "sess-1" } } as any);
    mockJobsClient.createJob.mockResolvedValueOnce({
      id: "job-1",
      status: "queued",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      progressPercent: 0,
      stage: "queued",
    } as any);
    await controller.uploadFilesToKnowledge();

    expect(setBusy).toHaveBeenCalledWith("knowledge:ingest");
    expect(mockKnowledgeUpload.createKnowledgeUploadSession).toHaveBeenCalledWith(files, expect.any(Object));
    expect(mockJobsClient.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ uploadSessionId: "sess-1", settings: expect.objectContaining({ knowledgeIngestTargets: expect.any(Array) }) }),
    );
    expect(controller.ingestJob.value?.id).toBe("job-1");
    expect(controller.ingestProgress.value).toContain("已进入处理队列");
    expect(refreshState).toHaveBeenCalledWith({ silent: true });
    expect(clearAllBusy).toHaveBeenCalled();
  });

  it("surfaces upload failures and job refresh failures deterministically", async () => {
    const error = ref("");
    const refreshState = vi.fn();
    const controller = createConsoleKnowledgeIngestController({
      clearAllBusy: vi.fn(),
      error,
      refreshKnowledgeConsole: vi.fn(),
      refreshState,
      setBusy: vi.fn(),
      settingsDraft: ref({} as any),
    });
    const files = [new File(["1"], "one.txt")];
    controller.onIngestFilesSelected(files);
    controller.knowledgeIngestTargets.value = { global: false, external: true, team: false, user: false };
    controller.knowledgeIngestExternalRefs.value = "dify:a";
    mockKnowledgeUpload.createKnowledgeUploadSession.mockRejectedValueOnce({});

    await controller.uploadFilesToKnowledge();
    expect(error.value).toBe("上传入库失败。");
    expect(refreshState).toHaveBeenCalledTimes(0);
  });

  it("refreshes ingest job and fetches normalized manifest on completion", async () => {
    const error = ref("");
    const refreshKnowledgeConsole = vi.fn();
    const refreshState = vi.fn();
    const clearAllBusy = vi.fn();
    const controller = createConsoleKnowledgeIngestController({
      clearAllBusy,
      error,
      refreshKnowledgeConsole,
      refreshState,
      setBusy: vi.fn(),
      settingsDraft: ref({} as any),
    });

    controller.ingestJob.value = makeSplitJob({ id: "job-1", status: "running" });
    mockJobsClient.getJob.mockResolvedValueOnce(makeSplitJob({ id: "job-1", status: "completed" }));
    mockKnowledgeDocumentsClient.getNormalizedDocuments.mockResolvedValueOnce({ documents: ["x"] } as any);
    await controller.refreshIngestJob();

    expect(mockJobsClient.getJob).toHaveBeenCalledWith("job-1");
    expect(mockKnowledgeDocumentsClient.getNormalizedDocuments).toHaveBeenCalledWith("job-1");
    expect(controller.normalizedManifest.value).toEqual({ documents: ["x"] });
    expect(controller.ingestProgress.value).toBe("处理完成，生成的知识文档可以下载查看。");
    expect(refreshKnowledgeConsole).toHaveBeenCalled();
    expect(clearAllBusy).toHaveBeenCalled();

    mockJobsClient.getJob.mockRejectedValueOnce(new Error("missing"));
    await controller.refreshIngestJob({ silent: true });
    expect(error.value).toBe("missing");
  });

  it("updates ingest job from event and triggers refresh on completion", async () => {
    const refreshState = vi.fn();
    const controller = createConsoleKnowledgeIngestController({
      clearAllBusy: vi.fn(),
      error: ref(""),
      refreshKnowledgeConsole: vi.fn(),
      refreshState,
      setBusy: vi.fn(),
      settingsDraft: ref({} as any),
    });
    controller.ingestJob.value = makeSplitJob({ id: "job-1", status: "running" });
    mockJobsClient.getJob.mockResolvedValueOnce({
      id: "job-1",
      status: "completed",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      progressPercent: 100,
      stage: "done",
    } as any);

    expect(controller.applyIngestJobFromEvent(makeSplitJob({ id: "other", status: "running" }))).toBe(false);
    expect(controller.applyIngestJobFromEvent(makeSplitJob({ id: "job-1", status: "completed" }))).toBe(true);
    expect(controller.ingestJob.value?.status).toBe("completed");

    await flushPending();
    expect(mockJobsClient.getJob).toHaveBeenCalledWith("job-1");
    expect(refreshState).toHaveBeenCalledTimes(0);
  });
});
