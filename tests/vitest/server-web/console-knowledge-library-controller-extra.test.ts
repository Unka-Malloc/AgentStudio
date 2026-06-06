import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleKnowledgeLibraryController } from "../../../server-web/composables/console-knowledge-library-controller";
import type { SplitJob, KnowledgeIngestTargetKind } from "../../../server-web/lib/types";

const knowledgeSearchClient = vi.hoisted(() => ({
  connectKnowledgeBackend: vi.fn(),
  listKnowledgeSpaces: vi.fn(),
}));

const pageRefreshHandler = vi.hoisted(() => ({
  capturedHandler: null as null | ((detail: {
    viewId: string;
    adminView: string;
    knowledgeTab: string;
    debugTab: string;
    routePath: string;
    addTask: (task: Promise<unknown> | unknown) => void;
  }) => Promise<unknown>[]),
  capturedPredicate: null as null | ((detail: {
    viewId: string;
    adminView: string;
    knowledgeTab: string;
    debugTab: string;
    routePath: string;
  }) => boolean),
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: vi.fn((predicate, handler) => {
    pageRefreshHandler.capturedPredicate = predicate;
    pageRefreshHandler.capturedHandler = (detail) => {
      if (!predicate(detail)) {
        return [];
      }
      detail.addTask(handler(detail));
      return [];
    };
  }),
}));

vi.mock("../../../server-web/lib/knowledge-search-client", () => ({
  connectKnowledgeBackend: knowledgeSearchClient.connectKnowledgeBackend,
  listKnowledgeSpaces: knowledgeSearchClient.listKnowledgeSpaces,
}));

function makeSplitJob(overrides: Partial<SplitJob> = {}) {
  return {
    id: "job-1",
    status: "running",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    progressPercent: 0,
    stage: "running",
    ...overrides,
  } as SplitJob;
}

const baseSpace = {
  provider: "dify",
  spaceId: "dify-space-a",
  title: "Dify Alpha",
};

function createFixture(overrides: {
  canMaintainKnowledge?: boolean;
  ingestJob?: SplitJob | null;
  isManagementRulesPanel?: boolean;
  listSpacesResult?: Array<Record<string, unknown>> | null;
} = {}) {
  const canMaintainKnowledge = ref(overrides.canMaintainKnowledge ?? true);
  const ingestJob = ref(overrides.ingestJob ?? makeSplitJob());
  const isManagementRulesPanel = ref(overrides.isManagementRulesPanel ?? false);
  const knowledgeIngestExternalProvider = ref("dify");
  const knowledgeIngestExternalRefs = ref("dify:dify-space-a,dify:missing");
  const knowledgeIngestExternalTargetLabels = ref<Record<string, string>>({});
  const knowledgeIngestTargets = ref<Record<KnowledgeIngestTargetKind, boolean>>({
    global: false,
    external: true,
    team: false,
    user: false,
  });
  const knowledgeIngestTeamRefs = ref("team-1");
  const knowledgeIngestUserRefs = ref("user-1");
  const refreshExpertRules = vi.fn(async () => undefined);
  const refreshIngestJob = vi.fn(async () => undefined);

  const controller = createConsoleKnowledgeLibraryController({
    canMaintainKnowledge,
    ingestJob,
    isManagementRulesPanel,
    knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets,
    knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs,
    refreshExpertRules,
    refreshIngestJob,
  });

  const listSpacesResult = Object.hasOwn(overrides, "listSpacesResult")
    ? overrides.listSpacesResult
    : [baseSpace];
  if (listSpacesResult === null) {
    knowledgeSearchClient.listKnowledgeSpaces.mockReset();
    knowledgeSearchClient.listKnowledgeSpaces.mockRejectedValue(new Error("list failed"));
  } else if (Array.isArray(listSpacesResult)) {
    knowledgeSearchClient.listKnowledgeSpaces.mockResolvedValue({ spaces: listSpacesResult });
  }

  return {
    canMaintainKnowledge,
    controller,
    ingestJob,
    isManagementRulesPanel,
    knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets,
    knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs,
    refreshExpertRules,
    refreshIngestJob,
  };
}

function runPageRefresh(detail: {
  viewId: string;
  adminView: string;
  knowledgeTab: string;
  debugTab: string;
  routePath: string;
}): Array<Promise<unknown>> {
  const tasks: Array<Promise<unknown>> = [];
  pageRefreshHandler.capturedHandler?.({
    ...detail,
    addTask: (task) => {
      tasks.push(Promise.resolve(task));
    },
  });
  return tasks;
}

async function flushTasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("console knowledge library controller extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    knowledgeSearchClient.listKnowledgeSpaces.mockReset();
    knowledgeSearchClient.connectKnowledgeBackend.mockReset();
    pageRefreshHandler.capturedHandler = null;
    pageRefreshHandler.capturedPredicate = null;
  });

  it("loads spaces on refresh and synchronizes selected targets", async () => {
    const fixture = createFixture({
      listSpacesResult: [
        { provider: "dify", spaceId: "dify-space-a", label: "Dify Alpha", accessMode: "read" },
        { provider: "ragflow", spaceId: "ragflow-space-b", title: "RAGFlow Beta", description: "desc", accessMode: "write" },
      ],
    });

    await fixture.controller.refreshKnowledgeLibrarySpaces();
    await flushTasks();

    expect(fixture.controller.knowledgeLibraryBusy.value).toBe("");
    expect(fixture.controller.knowledgeLibraryError.value).toBe("");
    expect(knowledgeSearchClient.listKnowledgeSpaces).toHaveBeenCalledTimes(1);
    expect(fixture.controller.knowledgeLibraryCards.value).toHaveLength(2);
    expect(fixture.knowledgeIngestExternalRefs.value).toBe("dify:dify-space-a");
    expect(fixture.controller.knowledgeIngestTargetDisplaySummary.value).toBe("将入库到：Dify Alpha");
    expect(fixture.controller.isKnowledgeLibraryCardExpanded("external:dify-space-a")).toBe(false);
    fixture.controller.toggleKnowledgeLibraryCard("external:dify-space-a");
    expect(fixture.controller.isKnowledgeLibraryCardExpanded("external:dify-space-a")).toBe(true);
    expect(fixture.controller.isKnowledgeBackendCardExpanded("builtin")).toBe(true);
    fixture.controller.toggleKnowledgeBackendCard("builtin");
    expect(fixture.controller.isKnowledgeBackendCardExpanded("builtin")).toBe(false);
  });

  it("handles refresh error and fallback to empty results", async () => {
    const fixture = createFixture({
      listSpacesResult: null,
    });

    await fixture.controller.refreshKnowledgeLibrarySpaces();

    expect(fixture.controller.knowledgeLibraryBusy.value).toBe("");
    expect(fixture.controller.knowledgeLibraryError.value).toBe("list failed");
    expect(fixture.controller.knowledgeLibraryCards.value).toHaveLength(0);
    expect(fixture.knowledgeIngestExternalRefs.value).toBe("");
  });

  it("connects backend and refreshes spaces on success", async () => {
    const fixture = createFixture();
    knowledgeSearchClient.connectKnowledgeBackend.mockResolvedValue({
      provider: {
        mode: "live",
        secretRef: "secret://dify-updated",
        endpointRef: "endpoint://dify-updated",
      },
    });
    await fixture.controller.refreshKnowledgeLibrarySpaces();
    knowledgeSearchClient.listKnowledgeSpaces.mockResolvedValueOnce({
      spaces: [
        { provider: "dify", spaceId: "dify-space-a", label: "Dify Alpha" },
        { provider: "ragflow", spaceId: "ragflow-space-b", title: "RAGFlow Beta", accessMode: "read" },
      ],
    });

    const refresh = fixture.controller.connectKnowledgeBackendProvider("dify");
    expect(fixture.controller.knowledgeLibraryBusy.value).toBe("backend:dify");
    expect(knowledgeSearchClient.connectKnowledgeBackend).toHaveBeenCalledWith({
      provider: "dify",
      mode: "contract",
      secretRef: "secret://pact/knowledge/dify-api-key",
      endpointRef: "config://pact/knowledge/dify-endpoint",
    });

    await refresh;
    await flushTasks();

    expect(fixture.controller.knowledgeLibraryBusy.value).toBe("");
    expect(fixture.controller.knowledgeBackendProviderForms.value.dify).toEqual({
      mode: "live",
      secretRef: "secret://dify-updated",
      endpointRef: "endpoint://dify-updated",
    });
    expect(knowledgeSearchClient.listKnowledgeSpaces).toHaveBeenCalledTimes(2);
    expect(fixture.controller.knowledgeLibraryCards.value).toHaveLength(2);
  });

  it("rejects backend connect when permission is missing", async () => {
    const fixture = createFixture({
      canMaintainKnowledge: false,
    });

    await fixture.controller.connectKnowledgeBackendProvider("dify");
    expect(fixture.controller.knowledgeLibraryError.value).toBe("当前账号没有知识库维护权限。");
    expect(knowledgeSearchClient.connectKnowledgeBackend).not.toHaveBeenCalled();
  });

  it("ignores unknown backend names", async () => {
    const fixture = createFixture();

    await fixture.controller.connectKnowledgeBackendProvider("unknown");
    expect(knowledgeSearchClient.connectKnowledgeBackend).not.toHaveBeenCalled();
    expect(fixture.controller.knowledgeLibraryError.value).toBe("");
  });

  it("captures connect failure from backend", async () => {
    const fixture = createFixture();
    knowledgeSearchClient.connectKnowledgeBackend.mockRejectedValueOnce(new Error("connect failed"));

    await fixture.controller.connectKnowledgeBackendProvider("dify");
    expect(fixture.controller.knowledgeLibraryError.value).toBe("connect failed");
    expect(fixture.controller.knowledgeLibraryBusy.value).toBe("");
  });

  it("registers page-refresh handling only on knowledge management", async () => {
    const fixture = createFixture({
      isManagementRulesPanel: true,
      ingestJob: makeSplitJob(),
      listSpacesResult: [baseSpace],
    });

    expect(pageRefreshHandler.capturedPredicate?.({
      viewId: "knowledge",
      adminView: "",
      knowledgeTab: "wordCloud",
      debugTab: "",
      routePath: "/knowledge/word-cloud",
    })).toBe(false);
    expect(pageRefreshHandler.capturedPredicate?.({
      viewId: "knowledge",
      adminView: "",
      knowledgeTab: "management",
      debugTab: "",
      routePath: "/knowledge/management",
    })).toBe(true);
    const tasksForManagement = runPageRefresh({
      viewId: "knowledge",
      adminView: "",
      knowledgeTab: "management",
      debugTab: "",
      routePath: "/knowledge/management",
    });
    expect(tasksForManagement.length).toBe(1);
    await Promise.all(tasksForManagement);
    expect(fixture.refreshExpertRules).toHaveBeenCalledWith({ forceDrafts: true });
    expect(fixture.refreshIngestJob).toHaveBeenCalledWith({ silent: true });
    expect(pageRefreshHandler.capturedPredicate?.({
      viewId: "knowledge",
      adminView: "",
      knowledgeTab: "wordCloud",
      debugTab: "",
      routePath: "/knowledge/word-cloud",
    })).toBe(false);
  });

  it("supports manual selection updates through ingest helper methods", async () => {
    const fixture = createFixture({
      listSpacesResult: [baseSpace],
    });
    await fixture.controller.refreshKnowledgeLibrarySpaces();

    fixture.controller.setKnowledgeIngestTargetValues([
      "global",
      "external:dify:dify-space-a",
      1,
    ]);
    expect(fixture.knowledgeIngestTargets.value).toEqual({
      global: false,
      external: true,
      team: false,
      user: false,
    });
    expect(fixture.knowledgeIngestExternalRefs.value).toBe("dify:dify-space-a");
    expect(fixture.controller.knowledgeIngestTargetDisplaySummary.value).toBe("将入库到：Dify Alpha");

    fixture.controller.setKnowledgeIngestTargetValues([
      "external:dify:missing",
      1,
    ]);
    expect(fixture.knowledgeIngestTargets.value).toEqual({
      global: false,
      external: true,
      team: false,
      user: false,
    });
    expect(fixture.knowledgeIngestExternalRefs.value).toBe("dify:missing");
    expect(fixture.controller.knowledgeIngestTargetDisplaySummary.value).toBe("请选择入库目标");
    fixture.controller.setKnowledgeIngestTargetValues([]);
    expect(fixture.knowledgeIngestTargets.value).toEqual({
      global: false,
      external: false,
      team: false,
      user: false,
    });
  });
});
