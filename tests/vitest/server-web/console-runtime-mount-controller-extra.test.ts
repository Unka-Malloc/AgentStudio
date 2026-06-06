// @vitest-environment jsdom
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisModuleInfo,
  RuntimeMountInfo,
} from "../../../server-web/lib/types/runtime";
import type { AgentSettings, ServerConsoleState } from "../../../server-web/lib/types";
import { emptySettings, moduleGroupDefinitions, moduleNameLabels } from "../../../server-web/composables/console-defaults";
import { createConsoleRuntimeMountController } from "../../../server-web/composables/console-runtime-mount-controller";

function makeRuntimeMount(name: string, overrides: Partial<RuntimeMountInfo> = {}): RuntimeMountInfo {
  return {
    name,
    id: `${name}-id`,
    kind: "analysis",
    enabled: true,
    reason: "",
    supportsStructuredDocument: false,
    supportsTextExtraction: false,
    supportsBatchHook: false,
    ...overrides,
  };
}

function makeAnalysisModule(id: string, overrides: Partial<AnalysisModuleInfo> = {}): AnalysisModuleInfo {
  return {
    id,
    label: id,
    description: `${id} 描述`,
    executionMode: "external",
    ...overrides,
  };
}

function makeConsoleState(
  runtimeOverrides: Partial<NonNullable<ServerConsoleState["runtime"]>> = {},
): ServerConsoleState | null {
  return {
    server: {
      url: "http://127.0.0.1:7228",
      userDataPath: "/tmp/user-data",
      distPath: "/tmp/dist",
      hostname: "localhost",
    },
    runtime: {
      profile: "test",
      cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
      mountModules: {},
      mountRouting: {
        kindRoutes: {},
        extensionRoutes: {},
        mediaTypeRoutes: {},
      },
      mountGeneration: 1,
      mounts: [],
      analysisModules: [],
      ...runtimeOverrides,
    },
    settings: {
      path: "/tmp/settings.json",
      value: { ...emptySettings },
    },
    discovery: {
      path: "/tmp/discovery.json",
      value: {
        serverId: "server-1",
        serverLabel: "Pact",
        bootstrapBaseUrl: "http://127.0.0.1:7228",
        advertisedBaseUrl: "http://127.0.0.1:7228",
        activeServiceUrl: "http://127.0.0.1:7228",
        forwardBaseUrl: "http://127.0.0.1:7228",
        mode: "active",
        configVersion: "1",
        refreshIntervalSeconds: 30,
        checkInIntervalSeconds: 60,
        offlineAfterSeconds: 300,
      },
      bootstrap: {
        ok: true,
        serverId: "server-1",
        serverLabel: "Pact",
        bootstrapBaseUrl: "http://127.0.0.1:7228",
        advertisedBaseUrl: "http://127.0.0.1:7228",
        activeServiceUrl: "http://127.0.0.1:7228",
        forwardBaseUrl: "http://127.0.0.1:7228",
        mode: "active",
        configVersion: "1",
        refreshIntervalSeconds: 30,
        checkInIntervalSeconds: 60,
        offlineAfterSeconds: 300,
        migrationRequired: false,
      },
    },
    emailRules: { items: [] } as any,
    expertVocabulary: { items: [] } as any,
    knowledgeTaxonomy: { items: [] } as any,
    storage: {
      databasePath: "/tmp/database.sqlite",
      objectRootPath: "/tmp/objects",
      batchCount: 0,
      rawObjectCount: 0,
      sourceCount: 0,
      emailCount: 0,
      threadCount: 0,
      transactionCount: 0,
      lineageCount: 0,
      lineageRunCount: 0,
      clientCount: 0,
      peopleCount: 0,
      retrievalCount: 0,
    },
    jobs: { items: [], total: 0 } as any,
    clients: { summary: {} as any, items: [] } as any,
  } as ServerConsoleState;
}

function createController(options: {
  consoleState?: ServerConsoleState | null;
  editingMountPaths?: Record<string, boolean>;
  settingsDraft?: AgentSettings;
  remoteDraftEquals?: (left: unknown, right: unknown) => boolean;
  applyingRemoteDrafts?: boolean;
} = {}) {
  const consoleState = ref<ServerConsoleState | null>(options.consoleState ?? null);
  const editingMountPaths = ref<Record<string, boolean>>(options.editingMountPaths ?? {});
  const settingsDraft = ref<AgentSettings>(options.settingsDraft ?? { ...emptySettings });
  const openServerPathPicker = vi.fn();
  const saveMountModules = vi.fn(() => Promise.resolve({ ok: true }));
  const remoteDraftEquals = vi.fn(
    options.remoteDraftEquals || ((left, right) => JSON.stringify(left) === JSON.stringify(right)),
  );
  let applyingRemoteDrafts = options.applyingRemoteDrafts ?? false;

  const applyRemoteConsoleDraftUpdate = vi.fn((update: () => void) => {
    applyingRemoteDrafts = true;
    try {
      update();
    } finally {
      applyingRemoteDrafts = false;
    }
  });

  const controller = createConsoleRuntimeMountController({
    applyRemoteConsoleDraftUpdate,
    consoleState,
    editingMountPaths,
    isApplyingRemoteConsoleDrafts: () => applyingRemoteDrafts,
    remoteDraftEquals,
    settingsDraft,
    openServerPathPicker,
    saveMountModules,
  });

  return {
    controller,
    applyRemoteConsoleDraftUpdate,
    consoleState,
    editingMountPaths,
    openServerPathPicker,
    remoteDraftEquals,
    saveMountModules,
    settingsDraft,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("console runtime mount controller extra coverage", () => {
  it("derives stable defaults when no runtime state is present", () => {
    const { controller } = createController();

    expect(controller.enabledMountCount.value).toBe(0);
    expect(controller.totalMountCount.value).toBe(0);
    expect(controller.mountDraftDirty.value).toBe(false);
    expect(controller.isMountPathEditing("analysis")).toBe(false);
    expect(controller.currentAnalysisModule.value).toBeNull();
    expect(controller.analysisModuleDescription()).toBe(
      "未发现可用分析模块，将使用内置启发式分析。",
    );

    expect(controller.moduleRows.value).toHaveLength(Object.keys(moduleNameLabels).length);

    const analysisRow = controller.moduleRows.value.find((row) => row.name === "analysis");
    expect(analysisRow).toMatchObject({
      name: "analysis",
      label: moduleNameLabels.analysis,
      description: "事务、人物、时间线和检索网络的核心分析管线。",
      modulePath: "",
      configuredPath: "",
      externalEnabled: false,
      pathHint: "填写外置模块 .mjs 路径",
    });

    expect(controller.moduleGroups.value.map((group) => group.id)).toEqual(
      moduleGroupDefinitions.map((group) => group.id),
    );

    controller.mountDraft.value.analysis = "/tmp/local-analysis.mjs";
    expect(controller.mountDraftDirty.value).toBe(true);
  });

  it("derives rows, groups, and current analysis module precedence from runtime state", () => {
    const runtimeState = makeConsoleState({
      mountModules: {
        analysis: "",
        ocr: "",
        customMount: "  /opt/custom-mount.mjs  ",
        emptyCustom: "   ",
      },
      mounts: [
        makeRuntimeMount("analysis", {
          id: "builtin-analysis",
          supportsStructuredDocument: true,
          supportsTextExtraction: true,
          supportsBatchHook: true,
        }),
        makeRuntimeMount("ocr", {
          enabled: false,
          reason: "disabled",
        }),
        makeRuntimeMount("customMount", {
          id: "custom-runtime",
          enabled: false,
          kind: "custom",
        }),
        makeRuntimeMount("emptyCustom", {
          id: "empty-runtime",
          enabled: false,
          kind: "custom",
        }),
        makeRuntimeMount("fallbackMount", {
          id: "",
          enabled: true,
          kind: "custom",
        }),
      ],
      analysisModules: [
        makeAnalysisModule("runtime-current", {
          description: "runtime current 描述",
          executionMode: "builtin",
        }),
        makeAnalysisModule("settings-selected", {
          description: "settings selected 描述",
          executionMode: "external",
        }),
      ],
      currentAnalysisModuleId: "runtime-current",
    });

    const { controller, settingsDraft } = createController({
      consoleState: runtimeState,
    });

    settingsDraft.value.analysisModuleId = "";

    expect(controller.enabledMountCount.value).toBe(2);
    expect(controller.totalMountCount.value).toBe(5);

    const analysisRow = controller.moduleRows.value.find((row) => row.name === "analysis");
    const customRow = controller.moduleRows.value.find((row) => row.name === "customMount");
    const emptyCustomRow = controller.moduleRows.value.find((row) => row.name === "emptyCustom");
    const ocrRow = controller.moduleRows.value.find((row) => row.name === "ocr");

    expect(analysisRow).toMatchObject({
      name: "analysis",
      modulePath: "",
      configuredPath: "",
      externalEnabled: true,
      pathHint: "当前使用内置模块：builtin-analysis",
      runtimeMount: expect.objectContaining({
        id: "builtin-analysis",
        enabled: true,
      }),
    });
    expect(ocrRow).toMatchObject({
      name: "ocr",
      configuredPath: "",
      externalEnabled: false,
      pathHint: "填写外置模块 .mjs 路径",
      runtimeMount: expect.objectContaining({
        enabled: false,
        reason: "disabled",
      }),
    });
    expect(customRow).toMatchObject({
      name: "customMount",
      label: "customMount",
      description: "自定义外置能力模块，可通过路径接入。",
      modulePath: "  /opt/custom-mount.mjs  ",
      configuredPath: "/opt/custom-mount.mjs",
      externalEnabled: true,
      pathHint: "/opt/custom-mount.mjs",
    });
    expect(emptyCustomRow).toMatchObject({
      name: "emptyCustom",
      configuredPath: "",
      externalEnabled: false,
      pathHint: "填写外置模块 .mjs 路径",
    });
    expect(controller.moduleRows.value.find((row) => row.name === "fallbackMount")).toMatchObject({
      name: "fallbackMount",
      configuredPath: "",
      externalEnabled: true,
      pathHint: "当前使用内置模块：fallbackMount",
    });

    expect(controller.moduleGroups.value.at(-1)).toMatchObject({
      id: "custom",
      label: "自定义模块",
      description: "运行时发现的自定义外置能力模块。",
      names: ["customMount", "emptyCustom", "fallbackMount"],
    });

    expect(controller.currentAnalysisModule.value).toMatchObject({
      id: "runtime-current",
      description: "runtime current 描述",
    });
    expect(controller.analysisModuleDescription()).toBe("runtime current 描述");

    settingsDraft.value.analysisModuleId = "settings-selected";
    expect(controller.currentAnalysisModule.value).toMatchObject({
      id: "settings-selected",
      description: "settings selected 描述",
    });
    expect(controller.analysisModuleDescription()).toBe("settings selected 描述");

    settingsDraft.value.analysisModuleId = "builtin:heuristic-hybrid-v1";
    runtimeState.runtime.analysisModules = [
      ...runtimeState.runtime.analysisModules,
      makeAnalysisModule("builtin:heuristic-hybrid-v1"),
    ];
    expect(controller.currentAnalysisModule.value).toMatchObject({
      id: "builtin:heuristic-hybrid-v1",
    });
    expect(controller.analysisModuleDescription()).toBe(
      "内置启发式分析管线，用于事务、人物、时间线和关联网络生成。",
    );

    settingsDraft.value.analysisModuleId = "missing-module";
    expect(controller.currentAnalysisModule.value).toBeNull();
    expect(controller.analysisModuleDescription()).toBe(
      "未发现可用分析模块，将使用内置启发式分析。",
    );
  });

  it("toggles editing state, opens the path picker, and accepts picked paths", async () => {
    const runtimeState = makeConsoleState({
      mountModules: {
        analysis: "",
      },
      mounts: [
        makeRuntimeMount("analysis", {
          id: "builtin-analysis",
          supportsStructuredDocument: true,
        }),
      ],
    });
    const { controller, editingMountPaths, openServerPathPicker, saveMountModules } = createController({
      consoleState: runtimeState,
    });

    const row = controller.moduleRows.value.find((item) => item.name === "analysis");
    expect(row).toBeTruthy();

    await controller.toggleMountPathEdit(row!);
    expect(editingMountPaths.value.analysis).toBe(true);
    expect(saveMountModules).not.toHaveBeenCalled();

    await controller.toggleMountPathEdit(row!);
    expect(saveMountModules).toHaveBeenCalledWith("mount:analysis");
    expect(editingMountPaths.value.analysis).toBe(false);

    controller.mountDraft.value.ocr = "/existing-ocr.mjs";

    controller.openMountPathPicker("ocr");
    expect(editingMountPaths.value.ocr).toBe(true);
    expect(openServerPathPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "选择OCR 识别模块文件",
        mode: "file",
        value: "/existing-ocr.mjs",
        extensions: [".mjs", ".js", ".cjs"],
        applyPath: expect.any(Function),
      }),
    );

    const pickerOptions = openServerPathPicker.mock.calls[0][0] as {
      applyPath: (nextPath: string) => void;
    };
    pickerOptions.applyPath("/tmp/ocr.mjs");

    expect(controller.mountDraft.value.ocr).toBe("/tmp/ocr.mjs");
    expect(controller.mountDraftDirty.value).toBe(true);
  });

  it("replaces drafts from the server, including nullish input, equality short-circuiting, and clean reset", () => {
    const { controller, applyRemoteConsoleDraftUpdate, remoteDraftEquals } = createController();

    controller.replaceMountDraftFromServer({ analysis: "/srv/analysis.mjs" }, { markClean: false });
    expect(remoteDraftEquals).toHaveBeenCalledWith({}, { analysis: "/srv/analysis.mjs" });
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);
    expect(controller.mountDraft.value).toEqual({ analysis: "/srv/analysis.mjs" });
    expect(controller.mountDraftDirty.value).toBe(false);

    controller.mountDraft.value.analysis = "/local/analysis.mjs";
    expect(controller.mountDraftDirty.value).toBe(true);

    controller.replaceMountDraftFromServer({ analysis: "/local/analysis.mjs" });
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);
    expect(controller.mountDraftDirty.value).toBe(false);

    controller.mountDraft.value.analysis = "/local/analysis-2.mjs";
    expect(controller.mountDraftDirty.value).toBe(true);

    controller.replaceMountDraftFromServer({ analysis: "/local/analysis-2.mjs" }, { markClean: false });
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);
    expect(controller.mountDraftDirty.value).toBe(true);

    controller.replaceMountDraftFromServer(undefined);
    expect(remoteDraftEquals).toHaveBeenLastCalledWith(
      { analysis: "/local/analysis-2.mjs" },
      {},
    );
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(2);
    expect(controller.mountDraft.value).toEqual({});
    expect(controller.mountDraftDirty.value).toBe(false);

    controller.mountDraft.value.analysis = "/another-local.mjs";
    expect(controller.mountDraftDirty.value).toBe(true);

    controller.replaceMountDraftFromServer(null);
    expect(remoteDraftEquals).toHaveBeenLastCalledWith(
      { analysis: "/another-local.mjs" },
      {},
    );
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(3);
    expect(controller.mountDraft.value).toEqual({});
    expect(controller.mountDraftDirty.value).toBe(false);
  });
});
