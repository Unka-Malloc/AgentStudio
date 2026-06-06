// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

const bridgeMocks = vi.hoisted(() => ({
  deleteJson: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock("../../../server-web/lib/bridge-http", () => bridgeMocks);

import {
  createAgentRetrievalViewContext,
  provideAgentRetrievalView,
  useAgentRetrievalViewContext,
} from "../../../server-web/composables/agentRetrievalViewContext";
import {
  provideAgentPermissionsView,
  useAgentPermissionsViewContext,
} from "../../../server-web/composables/agentPermissionsViewContext";
import {
  provideApprovalFlowView,
  useApprovalFlowViewContext,
} from "../../../server-web/composables/approvalFlowViewContext";
import {
  createDebugViewContext,
  provideDebugView,
  useDebugViewContext,
} from "../../../server-web/composables/debugViewContext";
import {
  createFeedViewContext,
  provideFeedView,
  useFeedViewContext,
} from "../../../server-web/composables/feedViewContext";
import {
  provideKnowledgeView,
  useKnowledgeIngestContext,
  useKnowledgeLibraryContext,
  useKnowledgeMaintenanceContext,
  useKnowledgeRulesContext,
  useKnowledgeViewContext,
  useKnowledgeWordCloudContext,
} from "../../../server-web/composables/knowledgeViewContext";
import {
  provideMaintenanceAgentView,
  useMaintenanceAgentViewContext,
} from "../../../server-web/composables/maintenanceAgentViewContext";
import {
  provideModulesView,
  useModulesViewContext,
} from "../../../server-web/composables/modulesViewContext";
import {
  provideOpsMonitorView,
  useOpsMonitorViewContext,
} from "../../../server-web/composables/opsMonitorViewContext";
import {
  provideRuntimeDownloadsView,
  useRuntimeDownloadsViewContext,
} from "../../../server-web/composables/runtimeDownloadsViewContext";
import {
  createSourcesViewContext,
  provideSourcesView,
  useSourcesViewContext,
} from "../../../server-web/composables/sourcesViewContext";
import {
  provideStorageView,
  useStorageViewContext,
} from "../../../server-web/composables/storageViewContext";
import {
  provideWorkspacesView,
  useWorkspacesViewContext,
} from "../../../server-web/composables/workspacesViewContext";
import {
  createJob,
  deleteJob,
  getJob,
  getJobResult,
  listJobs,
  reparseJob,
} from "../../../server-web/lib/jobs-client";
import {
  approveMaintenanceAgentRun,
  cancelMaintenanceAgentRun,
  chatMaintenanceAgent,
  getMaintenanceAgentConfig,
  getMaintenanceAgentRun,
  listMaintenanceAgentRuns,
  saveMaintenanceAgentConfig,
  startMaintenanceAgentRun,
} from "../../../server-web/lib/maintenance-agent-client";
import {
  getKnowledgeConfigSchema,
  getKnowledgeConsole,
  getKnowledgeMaintenance,
  reindexKnowledge,
  runKnowledgeMaintenance,
  saveKnowledgeMaintenance,
} from "../../../server-web/lib/knowledge-maintenance-client";
import {
  archiveKnowledgeDistillationWorkbenchRun,
  cancelKnowledgeDistillationWorkbenchRun,
  compareKnowledgeDistillationWorkbenchRuns,
  createKnowledgeDistillationWorkbenchRun,
  deleteKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRunArtifacts,
  knowledgeDistillationWorkbenchExportUrl,
  knowledgeDistillationWorkbenchPackageUrl,
  listKnowledgeDistillationWorkbenchRuns,
  rerunKnowledgeDistillationWorkbenchStage,
  resumeKnowledgeDistillationWorkbenchRun,
} from "../../../server-web/lib/knowledge-distillation-workbench-client";

function proxyContext(label: string) {
  return new Proxy({ extra: `${label}:extra` } as Record<string, unknown>, {
    get(target, property) {
      if (typeof property === "string" && !(property in target)) {
        return `${label}:${property}`;
      }
      return Reflect.get(target, property);
    },
  });
}

function expectProvidedContext<T>(
  provideContext: (context: T) => void,
  useContext: () => T,
  context: T,
) {
  let received: T | undefined;
  const Child = defineComponent({
    setup() {
      received = useContext();
      return () => h("span", "ok");
    },
  });
  const Parent = defineComponent({
    setup() {
      provideContext(context);
      return () => h(Child);
    },
  });

  mount(Parent);
  expect(received).toBe(context);
}

function expectMissingContext(useContext: () => unknown, message: string) {
  const Probe = defineComponent({
    setup() {
      useContext();
      return () => h("span", "missing");
    },
  });

  expect(() => mount(Probe)).toThrow(message);
}

describe("server-web view contexts final extra coverage", () => {
  it("creates narrowed feed, debug, agent retrieval, and sources contexts", () => {
    const feed = createFeedViewContext(proxyContext("feed") as any);
    expect(feed.busyKey).toBe("feed:busyKey");
    expect(feed.runInfoFeed).toBe("feed:runInfoFeed");
    expect(feed.infoFeedSummaryMarkdown).toBe("feed:infoFeedSummaryMarkdown");
    expect("extra" in feed).toBe(false);

    const debug = createDebugViewContext(proxyContext("debug") as any);
    expect(debug.distillationBusy).toBe("debug:distillationBusy");
    expect(debug.runKnowledgeRecallDebugBatch).toBe("debug:runKnowledgeRecallDebugBatch");
    expect("extra" in debug).toBe(false);

    const retrieval = createAgentRetrievalViewContext(proxyContext("retrieval") as any);
    expect(retrieval.agentRetrievalAnswer).toBe("retrieval:agentRetrievalAnswer");
    expect(retrieval.agentRetrievalTrace).toBe("retrieval:agentRetrievalTrace");
    expect("extra" in retrieval).toBe(false);

    const sources = createSourcesViewContext(proxyContext("sources") as any);
    expect(sources.activeKnowledgeSources).toBe("sources:activeKnowledgeSources");
    expect(sources.openLocalSourceDirectoryPicker).toBe("sources:openLocalSourceDirectoryPicker");
    expect("extra" in sources).toBe(false);
  });

  it("provides and requires all simple view contexts", () => {
    expectProvidedContext(provideFeedView, useFeedViewContext, { busyKey: "feed" } as any);
    expectProvidedContext(provideSourcesView, useSourcesViewContext, { busyKey: "sources" } as any);
    expectProvidedContext(provideAgentRetrievalView, useAgentRetrievalViewContext, { agentRetrievalPage: 1 } as any);
    expectProvidedContext(provideDebugView, useDebugViewContext, { busyKey: "debug" } as any);
    expectProvidedContext(provideAgentPermissionsView, useAgentPermissionsViewContext, { busyKey: "permissions" } as any);
    expectProvidedContext(provideApprovalFlowView, useApprovalFlowViewContext, { busyKey: "approval" } as any);
    expectProvidedContext(provideMaintenanceAgentView, useMaintenanceAgentViewContext, { busyKey: "maintenance" } as any);
    expectProvidedContext(provideModulesView, useModulesViewContext, { busyKey: "modules" } as any);
    expectProvidedContext(provideOpsMonitorView, useOpsMonitorViewContext, { busyKey: "ops" } as any);
    expectProvidedContext(provideRuntimeDownloadsView, useRuntimeDownloadsViewContext, { busyKey: "downloads" } as any);
    expectProvidedContext(provideStorageView, useStorageViewContext, { busyKey: "storage" } as any);
    expectProvidedContext(provideWorkspacesView, useWorkspacesViewContext, { busyKey: "workspaces" } as any);
  });

  it("throws clear errors when required simple contexts are absent", () => {
    expectMissingContext(useFeedViewContext, "Feed view context is not available");
    expectMissingContext(useSourcesViewContext, "Sources view context is not available");
    expectMissingContext(useAgentRetrievalViewContext, "Agent retrieval view context is not available");
    expectMissingContext(useDebugViewContext, "Debug view context is not available");
    expectMissingContext(useAgentPermissionsViewContext, "Agent permissions view context is not available");
    expectMissingContext(useApprovalFlowViewContext, "Approval flow view context is not available");
    expectMissingContext(useMaintenanceAgentViewContext, "Maintenance agent view context is not available");
    expectMissingContext(useModulesViewContext, "Modules view context is not available");
    expectMissingContext(useOpsMonitorViewContext, "Ops monitor view context is not available");
    expectMissingContext(useRuntimeDownloadsViewContext, "Runtime downloads view context is not available");
    expectMissingContext(useStorageViewContext, "Storage view context is not available");
    expectMissingContext(useWorkspacesViewContext, "Workspaces view context is not available");
  });

  it("provides knowledge view and all nested knowledge contexts", () => {
    const knowledge = {
      ingest: { id: "ingest" },
      library: { id: "library" },
      maintenance: { id: "maintenance" },
      rules: { id: "rules" },
      wordCloud: { id: "wordCloud" },
    } as any;
    const received: Record<string, unknown> = {};
    const Child = defineComponent({
      setup() {
        received.view = useKnowledgeViewContext();
        received.ingest = useKnowledgeIngestContext();
        received.library = useKnowledgeLibraryContext();
        received.maintenance = useKnowledgeMaintenanceContext();
        received.rules = useKnowledgeRulesContext();
        received.wordCloud = useKnowledgeWordCloudContext();
        return () => h("span", "knowledge");
      },
    });
    const Parent = defineComponent({
      setup() {
        provideKnowledgeView(knowledge);
        return () => h(Child);
      },
    });

    mount(Parent);
    expect(received).toMatchObject({
      view: knowledge,
      ingest: knowledge.ingest,
      library: knowledge.library,
      maintenance: knowledge.maintenance,
      rules: knowledge.rules,
      wordCloud: knowledge.wordCloud,
    });
  });

  it("throws clear errors when knowledge contexts are absent", () => {
    expectMissingContext(useKnowledgeViewContext, "Knowledge view context is not available");
    expectMissingContext(useKnowledgeIngestContext, "Knowledge ingest context is not available");
    expectMissingContext(useKnowledgeLibraryContext, "Knowledge library context is not available");
    expectMissingContext(useKnowledgeMaintenanceContext, "Knowledge maintenance context is not available");
    expectMissingContext(useKnowledgeRulesContext, "Knowledge rules context is not available");
    expectMissingContext(useKnowledgeWordCloudContext, "Knowledge word-cloud context is not available");
  });
});

describe("server-web thin API clients final extra coverage", () => {
  it("builds jobs client requests with encoded ids and safety confirmation", () => {
    createJob({ files: [] } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith("/api/jobs", { files: [] });

    reparseJob("job/one", { settings: { modelAlias: "m" } } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/jobs/job%2Fone/reparse",
      { settings: { modelAlias: "m" } },
    );

    listJobs();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/jobs?limit=50");
    listJobs(7);
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/jobs?limit=7");

    getJob("job two");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/jobs/job%20two");
    getJobResult("job/result");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/jobs/job%2Fresult/result");
    deleteJob("job/delete");
    expect(bridgeMocks.deleteJson).toHaveBeenLastCalledWith(
      "/api/jobs/job%2Fdelete",
      { safetyConfirm: true },
    );
  });

  it("builds maintenance agent client requests", () => {
    getMaintenanceAgentConfig();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/maintenance-agent/config");
    saveMaintenanceAgentConfig({ enabled: true } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/maintenance-agent/config",
      { config: { enabled: true } },
      { safetyConfirm: true },
    );
    chatMaintenanceAgent({ message: "hello", wait: true });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/maintenance-agent/chat",
      { message: "hello", wait: true },
    );
    startMaintenanceAgentRun({ runbook: "rb" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith("/api/maintenance-agent/runs", { runbook: "rb" });
    listMaintenanceAgentRuns(3);
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/maintenance-agent/runs?limit=3");
    getMaintenanceAgentRun("run/1");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/maintenance-agent/runs/run%2F1");
    approveMaintenanceAgentRun("run/1", { planHash: "hash", wait: true });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/maintenance-agent/runs/run%2F1/approve",
      { planHash: "hash", wait: true },
    );
    cancelMaintenanceAgentRun("run/1");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/maintenance-agent/runs/run%2F1/cancel",
      {},
    );
  });

  it("builds knowledge maintenance client requests and safety flags", () => {
    getKnowledgeConsole();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/knowledge/console");
    getKnowledgeConfigSchema();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/knowledge/config-schema");
    getKnowledgeMaintenance();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/knowledge/maintenance");
    saveKnowledgeMaintenance({ enabled: true } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/maintenance",
      { value: { enabled: true } },
      { safetyConfirm: true },
    );
    runKnowledgeMaintenance({ taskType: "compact" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith("/api/knowledge/maintenance/run", { taskType: "compact" });
    reindexKnowledge();
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/reindex",
      { confirm: true },
      { safetyConfirm: true },
    );
  });

  it("builds distillation workbench client requests and export urls", () => {
    listKnowledgeDistillationWorkbenchRuns(4);
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/knowledge/distillation/workbench/runs?limit=4");
    createKnowledgeDistillationWorkbenchRun({ workflowScope: "project", name: "Run" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/distillation/workbench/runs",
      { workflowScope: "project", name: "Run" },
      { safetyConfirm: true },
    );
    getKnowledgeDistillationWorkbenchRun("run/1");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/knowledge/distillation/workbench/runs/run%2F1");
    resumeKnowledgeDistillationWorkbenchRun("run/1");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/distillation/workbench/runs/run%2F1/resume",
      {},
      { safetyConfirm: true },
    );
    cancelKnowledgeDistillationWorkbenchRun("run/1", "stop");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/distillation/workbench/runs/run%2F1/cancel",
      { reason: "stop" },
      { safetyConfirm: true },
    );
    archiveKnowledgeDistillationWorkbenchRun("run/1");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/distillation/workbench/runs/run%2F1/archive",
      {},
      { safetyConfirm: true },
    );
    deleteKnowledgeDistillationWorkbenchRun("run/1");
    expect(bridgeMocks.deleteJson).toHaveBeenLastCalledWith(
      "/api/knowledge/distillation/workbench/runs/run%2F1",
      { safetyConfirm: true },
    );
    rerunKnowledgeDistillationWorkbenchStage("run/1", "stage/a");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/distillation/workbench/runs/run%2F1/stages/stage%2Fa/rerun",
      {},
      { safetyConfirm: true },
    );
    getKnowledgeDistillationWorkbenchRunArtifacts("run/1");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/knowledge/distillation/workbench/runs/run%2F1/artifacts");
    compareKnowledgeDistillationWorkbenchRuns("left/1", "right/2");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith(
      "/api/knowledge/distillation/workbench/runs/left%2F1/compare?rightRunId=right%2F2",
    );
    expect(knowledgeDistillationWorkbenchExportUrl("run/1", "stage/a", "json")).toBe(
      "/api/knowledge/distillation/workbench/runs/run%2F1/exports/stage%2Fa?format=json",
    );
    expect(knowledgeDistillationWorkbenchPackageUrl("run/1")).toBe(
      "/api/knowledge/distillation/workbench/runs/run%2F1/package",
    );
  });
});
