import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleKnowledgeSourceController, directoryNameFromPath } from "../../../server-web/composables/console-knowledge-source-controller";
import type { KnowledgeConsoleState, KnowledgeSource, KnowledgeSourceState, SplitJob } from "../../../server-web/lib/types";

const knowledgeSourcesClientMock = vi.hoisted(() => ({
  getKnowledgeSources: vi.fn(),
  createKnowledgeSource: vi.fn(),
  updateKnowledgeSource: vi.fn(),
  deleteKnowledgeSource: vi.fn(),
  refreshKnowledgeSource: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-sources-client", () => ({
  createKnowledgeSource: knowledgeSourcesClientMock.createKnowledgeSource,
  deleteKnowledgeSource: knowledgeSourcesClientMock.deleteKnowledgeSource,
  getKnowledgeSources: knowledgeSourcesClientMock.getKnowledgeSources,
  refreshKnowledgeSource: knowledgeSourcesClientMock.refreshKnowledgeSource,
  updateKnowledgeSource: knowledgeSourcesClientMock.updateKnowledgeSource,
}));

function makeJob(overrides: Partial<SplitJob> = {}): SplitJob {
  return {
    id: "job-1",
    status: "running",
    createdAt: "2026-06-04T01:00:00.000Z",
    updatedAt: "2026-06-04T01:10:00.000Z",
    progressPercent: 37,
    stage: "syncing",
    ...overrides,
  };
}

function makeSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    sourceId: "source-1",
    label: "Source 1",
    directoryPath: "/srv/source-1",
    enabled: true,
    autoSync: true,
    recursive: true,
    debounceMs: 1000,
    status: "idle",
    watcherStatus: "watching",
    watcherCount: 1,
    lastFileCount: 0,
    lastTotalBytes: 0,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

function makeSourcesState(overrides: Partial<KnowledgeSourceState> = {}): KnowledgeSourceState {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt: "2026-06-04T00:00:00.000Z",
    summary: {
      totalCount: 1,
      enabledCount: 1,
      watchingCount: 1,
      syncingCount: 0,
      errorCount: 0,
    },
    sources: [makeSource()],
    ...overrides,
  };
}

function makeConsoleState(overrides: Partial<KnowledgeConsoleState> = {}): KnowledgeConsoleState {
  return {
    available: true,
    health: null,
    capabilities: null,
    maintenance: null,
    recentJobs: [],
    ...overrides,
  };
}

function createFixture(overrides: {
  consoleState?: KnowledgeConsoleState | null;
  sourceState?: KnowledgeSourceState | null;
} = {}) {
  const error = ref("seed");
  const ingestJob = ref<SplitJob | null>(null);
  const knowledgeConsole = ref<KnowledgeConsoleState | null>(overrides.consoleState ?? makeConsoleState());
  const knowledgeSourceState = ref<KnowledgeSourceState | null>(overrides.sourceState ?? makeSourcesState());
  const clearAllBusy = vi.fn();
  const setBusy = vi.fn();

  const controller = createConsoleKnowledgeSourceController({
    clearAllBusy,
    error,
    ingestJob,
    knowledgeConsole,
    knowledgeSourceState,
    setBusy,
  });

  return {
    clearAllBusy,
    controller,
    error,
    ingestJob,
    knowledgeConsole,
    knowledgeSourceState,
    setBusy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  knowledgeSourcesClientMock.getKnowledgeSources.mockReset();
  knowledgeSourcesClientMock.createKnowledgeSource.mockReset();
  knowledgeSourcesClientMock.updateKnowledgeSource.mockReset();
  knowledgeSourcesClientMock.deleteKnowledgeSource.mockReset();
  knowledgeSourcesClientMock.refreshKnowledgeSource.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("console knowledge source controller extra coverage", () => {
  it("normalizes directory names from mixed paths and syncs the local label only when it should", () => {
    expect(directoryNameFromPath("")).toBe("");
    expect(directoryNameFromPath("  ")).toBe("");
    expect(directoryNameFromPath("/srv/data/")).toBe("data");
    expect(directoryNameFromPath("C:\\data\\sources\\")).toBe("sources");
    expect(directoryNameFromPath("relative/path")).toBe("path");

    const { controller } = createFixture();

    controller.localSourceForm.value = {
      label: "",
      directoryPath: "/srv/alpha",
      autoSync: true,
      recursive: true,
      hydrationEnabled: true,
    };

    controller.applyLocalSourceDirectoryPath("/srv/beta");
    expect(controller.localSourceForm.value.directoryPath).toBe("/srv/beta");
    expect(controller.localSourceForm.value.label).toBe("beta");

    controller.localSourceForm.value.label = "custom label";
    controller.applyLocalSourceDirectoryPath("/srv/gamma");
    expect(controller.localSourceForm.value.label).toBe("custom label");

    controller.localSourceForm.value.label = "";
    controller.localSourceForm.value.directoryPath = "/srv/delta";
    controller.syncLocalSourceLabelFromPath();
    expect(controller.localSourceForm.value.label).toBe("delta");

    controller.localSourceForm.value.label = "kept";
    controller.syncLocalSourceLabelFromPath();
    expect(controller.localSourceForm.value.label).toBe("kept");
  });

  it("loads sources, merges console state, and applies matching job updates", () => {
    const { controller, knowledgeConsole, knowledgeSourceState } = createFixture();
    const nextState = makeSourcesState({
      updatedAt: "2026-06-04T03:00:00.000Z",
      sources: [
        makeSource({
          sourceId: "source-1",
          lastJobId: "job-1",
          lastJobStatus: "queued",
          lastJobStage: "queued",
          lastJobProgressPercent: 12,
          lastJobUpdatedAt: "2026-06-04T02:00:00.000Z",
        }),
        makeSource({
          sourceId: "source-2",
          label: "Source 2",
          lastJobId: "job-2",
          lastJobStatus: "running",
          lastJobStage: "syncing",
          lastJobProgressPercent: 50,
          lastJobUpdatedAt: "2026-06-04T02:30:00.000Z",
        }),
      ],
    });

    controller.applyKnowledgeSourceState(null);
    expect(knowledgeSourceState.value).toMatchObject(makeSourcesState());

    controller.applyKnowledgeSourceState(nextState);
    expect(knowledgeSourceState.value).toEqual(nextState);
    expect(knowledgeConsole.value?.sources).toEqual(nextState);
    expect(controller.activeKnowledgeSources.value).toHaveLength(2);

    controller.applyJobToKnowledgeSources({});
    expect(knowledgeSourceState.value).toEqual(nextState);

    controller.applyJobToKnowledgeSources(
      makeJob({
        id: "job-1",
        status: "completed",
        stage: "done",
        progressPercent: 100,
        updatedAt: "2026-06-04T04:00:00.000Z",
      }),
    );

    expect(knowledgeSourceState.value?.sources[0]).toMatchObject({
      lastJobStatus: "completed",
      lastJobStage: "done",
      lastJobProgressPercent: 100,
      lastJobUpdatedAt: "2026-06-04T04:00:00.000Z",
    });
    expect(knowledgeSourceState.value?.sources[1]).toMatchObject({
      lastJobStatus: "running",
      lastJobStage: "syncing",
      lastJobProgressPercent: 50,
      lastJobUpdatedAt: "2026-06-04T02:30:00.000Z",
    });
  });

  it("refreshes sources and surfaces API failures with busy state cleanup", async () => {
    const { controller, clearAllBusy, error, ingestJob, setBusy } = createFixture();
    const initialState = makeSourcesState({
      updatedAt: "2026-06-04T05:00:00.000Z",
      sources: [makeSource({ sourceId: "source-a", label: "Source A" })],
    });
    const createdState = makeSourcesState({
      updatedAt: "2026-06-04T06:00:00.000Z",
      sources: [makeSource({ sourceId: "source-b", label: "Source B" })],
    });
    const refreshedState = makeSourcesState({
      updatedAt: "2026-06-04T07:00:00.000Z",
      sources: [makeSource({ sourceId: "source-c", label: "Source C" })],
    });
    const updatedState = makeSourcesState({
      updatedAt: "2026-06-04T08:00:00.000Z",
      sources: [makeSource({ sourceId: "source-d", label: "Source D" })],
    });
    const deletedState = makeSourcesState({
      updatedAt: "2026-06-04T09:00:00.000Z",
      sources: [],
    });

    knowledgeSourcesClientMock.getKnowledgeSources.mockResolvedValueOnce(initialState);
    await controller.refreshKnowledgeSources();
    expect(setBusy).toHaveBeenCalledWith("knowledge:sources");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
    expect(error.value).toBe("");
    expect(controller.activeKnowledgeSources.value).toEqual(initialState.sources);

    knowledgeSourcesClientMock.getKnowledgeSources.mockRejectedValueOnce(new Error("list failed"));
    await controller.refreshKnowledgeSources();
    expect(error.value).toBe("list failed");
    expect(clearAllBusy).toHaveBeenCalledTimes(2);

    controller.localSourceForm.value = {
      label: "  custom label  ",
      directoryPath: "/srv/new-source",
      autoSync: false,
      recursive: false,
      hydrationEnabled: false,
    };
    knowledgeSourcesClientMock.createKnowledgeSource.mockResolvedValueOnce({
      state: createdState,
      job: makeJob({ id: "job-create", progressPercent: 5 }),
    });
    await expect(controller.addKnowledgeSource()).resolves.toBe(true);
    expect(setBusy).toHaveBeenCalledWith("knowledge:sources:add");
    expect(knowledgeSourcesClientMock.createKnowledgeSource).toHaveBeenCalledWith({
      label: "custom label",
      directoryPath: "/srv/new-source",
      autoSync: false,
      recursive: false,
      hydrationEnabled: false,
      enabled: true,
      runNow: true,
    });
    expect(ingestJob.value?.id).toBe("job-create");
    expect(controller.localSourceForm.value).toEqual({
      label: "",
      directoryPath: "",
      autoSync: true,
      recursive: true,
      hydrationEnabled: true,
    });
    expect(error.value).toBe("");
    expect(clearAllBusy).toHaveBeenCalledTimes(3);

    controller.localSourceForm.value.directoryPath = "";
    await expect(controller.addKnowledgeSource()).resolves.toBe(false);
    expect(error.value).toBe("请填写服务端本地路径。");
    expect(knowledgeSourcesClientMock.createKnowledgeSource).toHaveBeenCalledTimes(1);

    controller.localSourceForm.value = {
      label: "",
      directoryPath: "/srv/error-source",
      autoSync: true,
      recursive: true,
      hydrationEnabled: true,
    };
    knowledgeSourcesClientMock.createKnowledgeSource.mockRejectedValueOnce(new Error("create failed"));
    await expect(controller.addKnowledgeSource()).resolves.toBe(false);
    expect(error.value).toBe("create failed");
    expect(clearAllBusy).toHaveBeenCalledTimes(4);

    const source = makeSource({ sourceId: "source-ops", label: "Source Ops" });
    knowledgeSourcesClientMock.updateKnowledgeSource.mockResolvedValueOnce({ state: updatedState });
    await controller.updateKnowledgeSource(source, { enabled: false });
    expect(setBusy).toHaveBeenCalledWith("knowledge:source:source-ops");
    expect(knowledgeSourcesClientMock.updateKnowledgeSource).toHaveBeenCalledWith("source-ops", { enabled: false });
    expect(controller.activeKnowledgeSources.value).toEqual(updatedState.sources);
    expect(error.value).toBe("");

    knowledgeSourcesClientMock.updateKnowledgeSource.mockRejectedValueOnce("bad update");
    await controller.updateKnowledgeSource(source, { enabled: true });
    expect(error.value).toBe("更新目录失败。");
    expect(clearAllBusy).toHaveBeenCalledTimes(6);

    knowledgeSourcesClientMock.refreshKnowledgeSource.mockResolvedValueOnce({
      state: refreshedState,
      job: makeJob({ id: "job-refresh", status: "queued", progressPercent: 0 }),
    });
    await controller.refreshKnowledgeSource(source);
    expect(knowledgeSourcesClientMock.refreshKnowledgeSource).toHaveBeenCalledWith("source-ops", { force: false });
    expect(ingestJob.value?.id).toBe("job-refresh");
    expect(controller.activeKnowledgeSources.value).toEqual(refreshedState.sources);
    expect(error.value).toBe("");

    knowledgeSourcesClientMock.refreshKnowledgeSource.mockRejectedValueOnce(new Error("refresh failed"));
    await controller.refreshKnowledgeSource(source, true);
    expect(knowledgeSourcesClientMock.refreshKnowledgeSource).toHaveBeenCalledWith("source-ops", { force: true });
    expect(error.value).toBe("refresh failed");
    expect(clearAllBusy).toHaveBeenCalledTimes(8);

    knowledgeSourcesClientMock.deleteKnowledgeSource.mockResolvedValueOnce({ state: deletedState });
    await controller.deleteKnowledgeSource(source);
    expect(knowledgeSourcesClientMock.deleteKnowledgeSource).toHaveBeenCalledWith("source-ops");
    expect(controller.activeKnowledgeSources.value).toEqual([]);
    expect(error.value).toBe("");

    knowledgeSourcesClientMock.deleteKnowledgeSource.mockRejectedValueOnce({});
    await controller.deleteKnowledgeSource(source);
    expect(error.value).toBe("删除目录失败。");
    expect(clearAllBusy).toHaveBeenCalledTimes(10);
  });
});
