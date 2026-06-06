// @vitest-environment jsdom
import { computed, defineComponent, h, isRef, nextTick, reactive, ref, type ComputedRef, type Ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";
import type { CloudDriveExposureForm } from "../../../server-web/types/workspaces";

type CloudDriveConnection = {
  driveRef: string;
  provider: string;
  mode: string;
  directoryMappingCount?: number;
  contractVerified?: boolean;
  label?: string;
};

type WorkspaceContextMock = {
  selected: Ref<{ title: string } | null>;
  busyKey: Ref<string>;
  panel: Ref<"list" | "cloudDrive" | string>;
  cloudDriveData: Ref<{
    connectedProviderCount?: number;
    providerCount?: number;
    connections?: CloudDriveConnection[];
  } | null>;
  cloudDriveResult: Ref<Record<string, unknown> | null>;
  cloudDriveForm: {
    provider: string;
    rootPath: string;
    driveRef: string;
    clientId: string;
    managedFolderRoot: string;
    publicFolder: string;
    allowedClients: string;
    advancedMode: boolean;
    exposedDirectories: CloudDriveExposureForm[];
    path: string;
    uploadPath: string;
    uploadContent: string;
    targetPath: string;
  };
  cloudDriveConnectionOptions: ComputedRef<Array<{ value: string; label: string }>>;
  addCloudDriveExposure: ReturnType<typeof vi.fn>;
  applyCloudDriveSync: ReturnType<typeof vi.fn>;
  connectCloudDrive: ReturnType<typeof vi.fn>;
  downloadCloudDriveFile: ReturnType<typeof vi.fn>;
  listCloudDriveItems: ReturnType<typeof vi.fn>;
  listCloudDrivePermissions: ReturnType<typeof vi.fn>;
  planCloudDriveSync: ReturnType<typeof vi.fn>;
  removeCloudDriveExposure: ReturnType<typeof vi.fn>;
  uploadCloudDriveFile: ReturnType<typeof vi.fn>;
};

type WorkspaceContextOverrides = {
  selected?: { title: string } | Ref<{ title: string } | null>;
  busyKey?: string | Ref<string>;
  panel?: string | Ref<string>;
  cloudDriveData?: WorkspaceContextMock["cloudDriveData"]["value"] | Ref<WorkspaceContextMock["cloudDriveData"]["value"]>;
  cloudDriveResult?: Record<string, unknown> | null | Ref<Record<string, unknown> | null>;
  cloudDriveForm?: Partial<WorkspaceContextMock["cloudDriveForm"]>;
};

const workspacesViewContextMock = vi.hoisted(() => ({
  current: null as WorkspaceContextMock | null,
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: () => {
    if (!workspacesViewContextMock.current) {
      throw new Error("workspaces view context mock is not initialized");
    }
    return workspacesViewContextMock.current;
  },
}));

const mountedWrappers: VueWrapper[] = [];

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    modelValue: {
      type: [String, Number, Boolean, Array, Object],
      default: "",
    },
    label: {
      type: String,
      default: "",
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    options: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "mock-option-bar" }, [
        props.label ? h("span", { class: "mock-option-bar-label" }, String(props.label)) : null,
        h(
          "select",
          {
            class: "mock-option-bar-select",
            disabled: props.disabled,
            value: String(props.modelValue ?? ""),
            onChange: (event: Event) => {
              const value = (event.target as HTMLSelectElement).value;
              emit("update:modelValue", value);
              emit("update:model-value", value);
              emit("change", value);
            },
          },
          (props.options as Array<{ value: string | number | boolean; label: string; disabled?: boolean }>).map((option) =>
            h(
              "option",
              {
                value: String(option.value),
                disabled: !!option.disabled,
              },
              option.label,
            ),
          ),
        ),
      ]);
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    label: {
      type: String,
      default: "",
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "mock-binary-checkbox",
          type: "button",
          disabled: props.disabled,
          "data-checked": String(props.modelValue),
          onClick: () => {
            if (props.disabled) return;
            const nextValue = !props.modelValue;
            emit("update:modelValue", nextValue);
            emit("update:model-value", nextValue);
            emit("change", nextValue);
          },
        },
        props.label,
      );
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: {
      type: String,
      default: "",
    },
    label: {
      type: String,
      default: "",
    },
  },
  setup(props) {
    return () =>
      h(
        "span",
        {
          class: "mock-status-pill",
          "data-tone": props.tone,
        },
        props.label,
      );
  },
});

function flush() {
  return nextTick().then(() => nextTick());
}

function getLabeledControl(root: any, labelText: string, selector: string) {
  const label = root.findAll("label").find((entry: any) => entry.text().includes(labelText));
  expect(label, `expected control label containing ${labelText}`).toBeDefined();
  return label!.get(selector);
}

function makeConnection(overrides: Partial<CloudDriveConnection> & Pick<CloudDriveConnection, "driveRef" | "provider" | "mode">): CloudDriveConnection {
  return {
    directoryMappingCount: 0,
    contractVerified: false,
    ...overrides,
  };
}

function readMaybeRef<T>(value: T | Ref<T> | undefined, fallback: T): T {
  if (isRef(value)) {
    return value.value;
  }
  return value ?? fallback;
}

function makeContext(overrides: WorkspaceContextOverrides = {}) {
  const selected = ref<{ title: string } | null>(
    readMaybeRef(overrides.selected, { title: "主工作区" }),
  );
  const busyKey = ref<string>(readMaybeRef(overrides.busyKey, ""));
  const panel = ref<string>(readMaybeRef(overrides.panel, "cloudDrive"));
  const cloudDriveData = ref<WorkspaceContextMock["cloudDriveData"]["value"]>(
    readMaybeRef(overrides.cloudDriveData, null),
  );
  const cloudDriveResult = ref<Record<string, unknown> | null>(
    readMaybeRef(overrides.cloudDriveResult, null),
  );
  const cloudDriveForm = reactive({
    provider: overrides.cloudDriveForm?.provider ?? "onedrive",
    rootPath: overrides.cloudDriveForm?.rootPath ?? "",
    driveRef: overrides.cloudDriveForm?.driveRef ?? "",
    clientId: overrides.cloudDriveForm?.clientId ?? "owner",
    managedFolderRoot: overrides.cloudDriveForm?.managedFolderRoot ?? ".pact-data",
    publicFolder: overrides.cloudDriveForm?.publicFolder ?? "public",
    allowedClients: overrides.cloudDriveForm?.allowedClients ?? "owner, codex",
    advancedMode: overrides.cloudDriveForm?.advancedMode ?? false,
    exposedDirectories: (overrides.cloudDriveForm?.exposedDirectories ?? []) as CloudDriveExposureForm[],
    path: overrides.cloudDriveForm?.path ?? "",
    uploadPath: overrides.cloudDriveForm?.uploadPath ?? "",
    uploadContent: overrides.cloudDriveForm?.uploadContent ?? "Pact cloud drive console upload\n",
    targetPath: overrides.cloudDriveForm?.targetPath ?? "cloud-drive",
  });

  const cloudDriveConnectionOptions = computed(() => {
    const connections = Array.isArray(cloudDriveData.value?.connections) ? cloudDriveData.value.connections : [];
    return connections.map((drive) => ({
      value: String(drive.driveRef || ""),
      label: `${drive.label || drive.provider} · ${String(drive.driveRef || "").slice(0, 18)}`,
    }));
  });

  const addCloudDriveExposure = vi.fn();

  const removeCloudDriveExposure = vi.fn((index: number) => {
    cloudDriveForm.exposedDirectories.splice(index, 1);
  });

  const connectCloudDrive = vi.fn(async () => {
    cloudDriveResult.value = { action: "connect" };
  });
  const listCloudDriveItems = vi.fn(async () => {
    cloudDriveResult.value = { action: "list" };
  });
  const downloadCloudDriveFile = vi.fn(async () => {
    cloudDriveResult.value = { action: "download" };
  });
  const uploadCloudDriveFile = vi.fn(async () => {
    cloudDriveResult.value = { action: "upload" };
  });
  const planCloudDriveSync = vi.fn(async () => {
    cloudDriveResult.value = { action: "plan" };
  });
  const applyCloudDriveSync = vi.fn(async () => {
    cloudDriveResult.value = { action: "apply" };
  });
  const listCloudDrivePermissions = vi.fn(async () => {
    cloudDriveResult.value = { action: "permissions" };
  });

  const context: WorkspaceContextMock = {
    selected,
    busyKey,
    panel,
    cloudDriveData,
    cloudDriveResult,
    cloudDriveForm,
    cloudDriveConnectionOptions,
    addCloudDriveExposure,
    applyCloudDriveSync,
    connectCloudDrive,
    downloadCloudDriveFile,
    listCloudDriveItems,
    listCloudDrivePermissions,
    planCloudDriveSync,
    removeCloudDriveExposure,
    uploadCloudDriveFile,
  };

  return {
    context,
    refs: {
      selected,
      busyKey,
      panel,
      cloudDriveData,
      cloudDriveResult,
      cloudDriveConnectionOptions,
    },
  };
}

function mountPanel(overrides: WorkspaceContextOverrides = {}) {
  const { context, refs } = makeContext(overrides);
  workspacesViewContextMock.current = context;

  const wrapper = mount(WorkspaceCloudDrivePanel, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxStub,
        OptionBar: OptionBarStub,
        StatusPill: StatusPillStub,
      },
    },
  });

  mountedWrappers.push(wrapper);

  return { wrapper, context, refs };
}

beforeEach(() => {
  workspacesViewContextMock.current = null;
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  workspacesViewContextMock.current = null;
});

describe("WorkspaceCloudDrivePanel extra coverage", () => {
  it("renders the selected workspace header and empty-state branches", () => {
    const { wrapper } = mountPanel({
      selected: ref({ title: "云盘工作区" }),
      cloudDriveData: ref(null),
      cloudDriveResult: ref(null),
      cloudDriveForm: {
        provider: "onedrive",
        path: "",
        uploadPath: "",
      } as Partial<WorkspaceContextMock["cloudDriveForm"]> as WorkspaceContextMock["cloudDriveForm"],
    });

    expect(wrapper.text()).toContain("云盘 — 云盘工作区");
    expect(wrapper.text()).toContain("云盘只作为 Sharedspace 的外部 adapter/projection");
    expect(wrapper.find(".module-panel-heading").text()).toContain("目录暴露");
    expect(wrapper.find(".mock-status-pill").exists()).toBe(false);
    expect(wrapper.find("pre.config-json-preview").exists()).toBe(false);
    expect(wrapper.find(".mock-option-bar-label").text()).toBe("Provider");
    expect(wrapper.text()).not.toContain("iCloud 受控目录");
    expect(wrapper.text()).not.toContain("暂无目录。");
  });

  it("switches provider state, exposes the iCloud path input, and keeps the busy labels in sync", async () => {
    const { wrapper, refs } = mountPanel({
      busyKey: ref("ws:drive-connect"),
      cloudDriveForm: {
        provider: "onedrive",
        path: "default",
        uploadPath: "upload.txt",
      } as Partial<WorkspaceContextMock["cloudDriveForm"]> as WorkspaceContextMock["cloudDriveForm"],
    });

    const actionButtons = wrapper.findAll(".module-actions > button");
    expect(actionButtons[0].text()).toBe("连接中…");
    expect(actionButtons[1].text()).toBe("列出");
    expect(actionButtons[2].text()).toBe("下载");
    expect(actionButtons[3].text()).toBe("上传");
    expect(actionButtons[4].text()).toBe("同步计划");
    expect(actionButtons[5].text()).toBe("应用同步");
    expect(actionButtons[6].text()).toBe("权限");
    expect(actionButtons.slice(0, 7).every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(actionButtons[7].attributes("disabled")).toBeUndefined();

    refs.busyKey.value = "ws:drive-list";
    await flush();

    expect(actionButtons[1].text()).toBe("读取中…");
    expect(actionButtons[0].text()).toBe("连接");

    refs.busyKey.value = "ws:drive-download";
    await flush();

    expect(actionButtons[2].text()).toBe("下载中…");

    refs.busyKey.value = "";
    await flush();

    const optionBar = wrapper.get(".mock-option-bar-select");
    await optionBar.setValue("icloud");
    await flush();

    expect(wrapper.text()).toContain("iCloud 受控目录");
    expect(wrapper.get('input[placeholder="留空使用系统 iCloud Drive 默认路径"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Pact 根目录");
    expect(wrapper.text()).toContain("公共目录");
    expect(wrapper.text()).toContain("当前客户端");
  });

  it("manages advanced directory exposure rows, permissions, and removal", async () => {
    const { wrapper, context, refs } = mountPanel({
      cloudDriveForm: {
        provider: "icloud",
        advancedMode: false,
        exposedDirectories: [],
        path: "default",
        uploadPath: "upload.txt",
      } as Partial<WorkspaceContextMock["cloudDriveForm"]> as WorkspaceContextMock["cloudDriveForm"],
    });

    expect(wrapper.find(".mock-binary-checkbox").attributes("data-checked")).toBe("false");
    await wrapper.get(".mock-binary-checkbox").trigger("click");
    await flush();

    refs.cloudDriveResult.value = null;
    await flush();

    expect(wrapper.text()).toContain("暂无目录。");

    await wrapper.find(".module-panel .table-action").trigger("click");
    expect(context.addCloudDriveExposure).toHaveBeenCalledTimes(1);

    context.cloudDriveForm.exposedDirectories.splice(0, 0, {
      id: "exposure-1",
      name: "",
      path: "/Users/unka/Documents",
      permissionMode: "allowlist",
      subjects: "client-a, client-b",
      showPermissions: false,
    });
    await flush();

    expect(wrapper.text()).toContain("目录 1");
    expect(wrapper.text()).toContain("绑定路径");
    expect(wrapper.text()).not.toContain("客户端列表");

    const permissionButton = wrapper
      .findAll(".table-action")
      .find((button) => button.text() === "权限配置");
    expect(permissionButton).toBeDefined();
    await permissionButton!.trigger("click");
    await flush();

    expect(wrapper.text()).toContain("访问模式");
    expect(wrapper.text()).toContain("白名单");
    expect(wrapper.text()).toContain("客户端列表");

    const removeButton = wrapper
      .findAll(".table-action")
      .find((button) => button.text() === "移除");
    expect(removeButton).toBeDefined();
    await removeButton!.trigger("click");
    expect(context.removeCloudDriveExposure).toHaveBeenCalledWith(0);
    expect(context.cloudDriveForm.exposedDirectories.length).toBe(0);
    expect(wrapper.text()).toContain("暂无目录。");
  });

  it("renders connection summaries, result JSON, and invokes action buttons", async () => {
    const connections = [
      makeConnection({
        driveRef: "drive-12345678901234567890",
        provider: "icloud",
        mode: "local",
        directoryMappingCount: 2,
        contractVerified: true,
        label: "iCloud 主盘",
      }),
      makeConnection({
        driveRef: "drive-abcdef",
        provider: "dropbox",
        mode: "contract",
        directoryMappingCount: 0,
        contractVerified: false,
      }),
    ];
    const { wrapper, context, refs } = mountPanel({
      cloudDriveData: {
        connectedProviderCount: 2,
        providerCount: 3,
        connections,
      },
      cloudDriveResult: {
        ok: true,
        action: "seed",
      },
      cloudDriveForm: {
        provider: "onedrive",
        path: "default/readme.md",
        uploadPath: "public/upload.txt",
        driveRef: "",
        clientId: "owner",
      } as Partial<WorkspaceContextMock["cloudDriveForm"]> as WorkspaceContextMock["cloudDriveForm"],
    });

    expect(wrapper.text()).toContain("已连接云盘");
    expect(wrapper.text()).toContain("2 个");
    expect(wrapper.text()).toContain("iCloud 主盘");
    expect(wrapper.text()).toContain("dropbox");
    expect(wrapper.findAll(".mock-status-pill").map((pill) => pill.attributes("data-tone"))).toEqual(["info", "success"]);
    expect(wrapper.find("pre.config-json-preview").text()).toContain('"action": "seed"');

    const actionButtons = wrapper.findAll(".module-actions > button");
    await actionButtons.find((button) => button.text() === "连接")!.trigger("click");
    await actionButtons.find((button) => button.text() === "列出")!.trigger("click");
    await actionButtons.find((button) => button.text() === "下载")!.trigger("click");
    await actionButtons.find((button) => button.text() === "上传")!.trigger("click");
    await actionButtons.find((button) => button.text() === "同步计划")!.trigger("click");
    await actionButtons.find((button) => button.text() === "应用同步")!.trigger("click");
    await actionButtons.find((button) => button.text() === "权限")!.trigger("click");
    await actionButtons.find((button) => button.text() === "取消")!.trigger("click");
    await flush();

    expect(context.connectCloudDrive).toHaveBeenCalledTimes(1);
    expect(context.listCloudDriveItems).toHaveBeenCalledTimes(1);
    expect(context.downloadCloudDriveFile).toHaveBeenCalledTimes(1);
    expect(context.uploadCloudDriveFile).toHaveBeenCalledTimes(1);
    expect(context.planCloudDriveSync).toHaveBeenCalledTimes(1);
    expect(context.applyCloudDriveSync).toHaveBeenCalledTimes(1);
    expect(context.listCloudDrivePermissions).toHaveBeenCalledTimes(1);
    expect(refs.panel.value).toBe("list");

    refs.cloudDriveResult.value = { ok: false, error: "failed" };
    await flush();
    expect(wrapper.find("pre.config-json-preview").text()).toContain('"error": "failed"');
  });

  it("covers drive selector, iCloud fields, and nested exposure permission inputs", async () => {
    const { wrapper, context } = mountPanel({
      cloudDriveData: {
        connectedProviderCount: 1,
        providerCount: 1,
        connections: [
          makeConnection({
            driveRef: "drive-icloud-1234567890",
            provider: "icloud",
            mode: "local",
            label: "iCloud 主盘",
          }),
        ],
      },
      cloudDriveForm: {
        provider: "icloud",
        rootPath: "",
        driveRef: "",
        clientId: "owner",
        managedFolderRoot: ".pact-data",
        publicFolder: "public",
        allowedClients: "owner, codex",
        advancedMode: true,
        exposedDirectories: [
          {
            id: "exposure-1",
            name: "公开目录",
            path: "/Users/unka/Documents",
            permissionMode: "allowlist",
            subjects: "owner, codex",
            showPermissions: false,
          },
        ],
        path: "default",
        uploadPath: "public/upload.txt",
        uploadContent: "upload body",
        targetPath: "cloud-drive",
      } as Partial<WorkspaceContextMock["cloudDriveForm"]> as WorkspaceContextMock["cloudDriveForm"],
    });

    await getLabeledControl(wrapper, "连接", "select").setValue("drive-icloud-1234567890");
    expect((context.cloudDriveForm as { driveRef: string }).driveRef).toBe("drive-icloud-1234567890");

    await getLabeledControl(wrapper, "iCloud 受控目录", "input").setValue("/Users/unka/Library/Mobile Documents");
    expect((context.cloudDriveForm as { rootPath: string }).rootPath).toBe("/Users/unka/Library/Mobile Documents");

    await getLabeledControl(wrapper, "Pact 根目录", "input").setValue(".pact-data-custom");
    expect((context.cloudDriveForm as { managedFolderRoot: string }).managedFolderRoot).toBe(".pact-data-custom");

    await getLabeledControl(wrapper, "公共目录", "input").setValue("public-assets");
    expect((context.cloudDriveForm as { publicFolder: string }).publicFolder).toBe("public-assets");

    await getLabeledControl(wrapper, "当前客户端", "input").setValue("owner-a");
    expect((context.cloudDriveForm as { clientId: string }).clientId).toBe("owner-a");

    await getLabeledControl(wrapper, "允许客户端", "input").setValue("owner-a, codex-a");
    expect((context.cloudDriveForm as { allowedClients: string }).allowedClients).toBe("owner-a, codex-a");

    await getLabeledControl(wrapper, "文件/文件夹路径", "input").setValue("public/example.txt");
    expect((context.cloudDriveForm as { path: string }).path).toBe("public/example.txt");

    await getLabeledControl(wrapper, "上传路径", "input").setValue("public/upload.md");
    expect((context.cloudDriveForm as { uploadPath: string }).uploadPath).toBe("public/upload.md");

    await getLabeledControl(wrapper, "同步目标路径", "input").setValue("cloud-drive-sync");
    expect((context.cloudDriveForm as { targetPath: string }).targetPath).toBe("cloud-drive-sync");

    const exposure = wrapper.get(".ws-id-list .module-panel");
    await exposure.get("button").trigger("click");
    await flush();

    await getLabeledControl(exposure, "名称", "input").setValue("公开目录 v2");
    expect(context.cloudDriveForm.exposedDirectories[0].name).toBe("公开目录 v2");

    await getLabeledControl(exposure, "绑定路径", "input").setValue("/Users/unka/Documents/shared");
    expect(context.cloudDriveForm.exposedDirectories[0].path).toBe("/Users/unka/Documents/shared");

    await getLabeledControl(exposure, "访问模式", "select").setValue("denylist");
    expect(context.cloudDriveForm.exposedDirectories[0].permissionMode).toBe("denylist");

    await getLabeledControl(exposure, "客户端列表", "input").setValue("owner-a");
    expect(context.cloudDriveForm.exposedDirectories[0].subjects).toBe("owner-a");
  });
});
