// @vitest-environment jsdom
import { defineComponent, h, reactive, ref, nextTick, type Ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import KnowledgeIngestPanel from "../../../server-web/components/knowledge/KnowledgeIngestPanel.vue";
import KnowledgeLibraryBoard from "../../../server-web/components/knowledge/KnowledgeLibraryBoard.vue";
import KnowledgeMaintenancePanel from "../../../server-web/components/knowledge/KnowledgeMaintenancePanel.vue";

const knowledgeViewContextMock = vi.hoisted(() => ({
  ingest: null as null | Record<string, unknown>,
  library: null as null | Record<string, unknown>,
  maintenance: null as null | Record<string, unknown>,
  view: null as null | { ingest: { dynamicParsingPreviewConfig: Record<string, unknown> } },
}));

const knowledgeDocumentsMock = vi.hoisted(() => ({
  previewKnowledgeDocuments: vi.fn(),
  normalizedKnowledgeDocumentUrl: vi.fn((batchId: string, documentId: string) => `/normalized/${batchId}/${documentId}`),
}));

vi.mock("../../../server-web/composables/knowledgeViewContext", () => ({
  useKnowledgeIngestContext: () => knowledgeViewContextMock.ingest,
  useKnowledgeLibraryContext: () => knowledgeViewContextMock.library,
  useKnowledgeMaintenanceContext: () => knowledgeViewContextMock.maintenance,
  useKnowledgeViewContext: () => knowledgeViewContextMock.view,
}));

vi.mock("../../../server-web/lib/knowledge-documents", () => ({
  normalizedKnowledgeDocumentUrl: knowledgeDocumentsMock.normalizedKnowledgeDocumentUrl,
  previewKnowledgeDocuments: knowledgeDocumentsMock.previewKnowledgeDocuments,
}));

const mountedWrappers: VueWrapper[] = [];

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    label: { type: String, default: "" },
    modelValue: { type: [String, Number, Boolean, Array], default: undefined },
    options: { type: Array, default: () => [] },
    multiple: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    placeholder: { type: String, default: "" },
  },
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          class: "option-bar-stub",
          "data-label": props.label || "",
          "data-placeholder": props.placeholder || "",
          disabled: props.disabled,
          onClick: () => {
            if (props.disabled) {
              return;
            }
            const options = props.options as Array<{ value: string | number | boolean }>;
            if (props.multiple) {
              const nextValue = Array.isArray(props.modelValue) && props.modelValue.length > 0 ? [] : [options[0]?.value ?? "selected"];
              emit("update:modelValue", nextValue);
              emit("update:model-value", nextValue);
              emit("change", nextValue);
              return;
            }
            const current = props.modelValue;
            const nextValue = options.length > 1 && current === options[0]?.value ? options[1].value : options[0]?.value ?? "selected";
            emit("update:modelValue", nextValue);
            emit("update:model-value", nextValue);
            emit("change", nextValue);
          },
        },
        props.label || String(props.modelValue ?? "option"),
      );
  },
});

const UploadFileListCardStub = defineComponent({
  name: "UploadFileListCard",
  props: {
    files: { type: Array, default: () => [] },
    canSubmit: { type: Boolean, default: false },
    canWriteJobs: { type: Boolean, default: false },
    busyKey: { type: String, default: "" },
    ingestJob: { type: Object, default: null },
    ingestProgress: { type: String, default: "" },
    jobStatusLabels: { type: Object, default: () => ({}) },
    jobStatusTone: { type: Function, default: () => "neutral" },
    formatBytes: { type: Function, default: (bytes: number) => `${bytes} B` },
  },
  emits: ["preview", "select", "upload"],
  setup(props, { emit }) {
    return () =>
      h("section", { class: "upload-file-list-card-stub" }, [
        h("div", { class: "upload-file-list-card-stub__meta" }, [
          h("span", { class: "upload-file-list-card-stub__count" }, `files:${(props.files as Array<unknown>).length}`),
          h("span", { class: "upload-file-list-card-stub__progress" }, props.ingestJob ? `job:${String((props.ingestJob as { id?: string } | null)?.id ?? "")}` : props.ingestProgress),
        ]),
        h(
          "button",
          {
            type: "button",
            class: "upload-file-list-card-stub__select",
            onClick: () => emit("select", [new File(["selected"], "selected.txt", { type: "text/plain" })]),
          },
          "选择文件",
        ),
        h(
          "button",
          {
            type: "button",
            class: "upload-file-list-card-stub__preview",
            disabled: !props.canWriteJobs || (props.files as Array<unknown>).length === 0,
            onClick: () => emit("preview"),
          },
          "预览解析",
        ),
        h(
          "button",
          {
            type: "button",
            class: "upload-file-list-card-stub__upload",
            disabled: !props.canSubmit || !props.canWriteJobs || (props.files as Array<unknown>).length === 0,
            onClick: () => emit("upload"),
          },
          "开始入库",
        ),
      ]);
  },
});

const SplitToggleCardStub = defineComponent({
  name: "SplitToggleCard",
  props: {
    expanded: { type: Boolean, default: false },
    expandedLabel: { type: String, default: "" },
    collapsedLabel: { type: String, default: "" },
  },
  emits: ["toggle"],
  setup(props, { emit, slots }) {
    return () =>
      h("section", { class: "split-toggle-card-stub", "data-open": props.expanded ? "true" : "false" }, [
        h(
          "button",
          {
            type: "button",
            class: "split-toggle-card-stub__toggle",
            onClick: () => emit("toggle"),
          },
          props.expanded ? props.expandedLabel : props.collapsedLabel,
        ),
        h("div", { class: "split-toggle-card-stub__summary" }, slots.summary?.()),
        props.expanded ? h("div", { class: "split-toggle-card-stub__body" }, slots.default?.()) : null,
      ]);
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
  },
  setup(props, { slots }) {
    return () =>
      h("section", { class: "config-fold-card-stub" }, [
        h("div", { class: "config-fold-card-stub__summary" }, [
          h("strong", props.title),
          props.subtitle ? h("small", props.subtitle) : null,
        ]),
        h("div", { class: "config-fold-card-stub__body" }, slots.default?.()),
      ]);
  },
});

const BridgeDownloadButtonStub = defineComponent({
  name: "BridgeDownloadButton",
  props: {
    href: { type: String, default: "" },
    label: { type: String, default: "" },
    buttonClass: { type: String, default: "" },
  },
  setup(props) {
    return () => h("a", { class: ["bridge-download-stub", props.buttonClass], href: props.href }, props.label);
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: { type: String, default: "" },
    label: { type: [String, Number], default: "" },
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone }, String(props.label ?? ""));
  },
});

function flush() {
  return nextTick().then(() => nextTick());
}

function asRef<T>(value: T) {
  return ref(value) as Ref<T>;
}

function makeIngestContext(overrides: Record<string, unknown> = {}) {
  const context = {
    busyKey: asRef(""),
    canSubmitKnowledgeIngest: asRef(true),
    canWriteJobs: asRef(true),
    documentPreviewResult: asRef<unknown | null>(null),
    ingestFiles: asRef<File[]>([]),
    ingestJob: asRef<null | { id: string; status?: string }>(null),
    ingestProgress: asRef("等待开始"),
    knowledgeIngestTargetDisplaySummary: asRef("将入库到：默认知识库"),
    knowledgeIngestTargetOptions: asRef<Array<{ label: string; value: string }>>([
      { label: "主知识库", value: "primary" },
      { label: "归档知识库", value: "archive" },
    ]),
    knowledgeIngestTargetValidationMessage: asRef(""),
    knowledgeIngestTargetValues: asRef<string[]>([]),
    knowledgeLibraryBusy: asRef(""),
    normalizedManifest: asRef<null | {
      batchId: string;
      documents: Array<{ documentId: string; title: string; granularity: string; byteSize: number }>;
      sourceMaterials: Array<{ documentId: string; title: string; granularity: string; byteSize: number }>;
    }>(null),
    onIngestFilesSelected: vi.fn((files: File[]) => {
      context.ingestFiles.value = files;
    }),
    setKnowledgeIngestTargetValues: vi.fn((values: string[]) => {
      context.knowledgeIngestTargetValues.value = values;
      context.knowledgeIngestTargetDisplaySummary.value = values.length ? `将入库到：${values.join("、")}` : "将入库到：默认知识库";
    }),
    uploadFilesToKnowledge: vi.fn(),
    ...overrides,
  };

  return context;
}

function makeMaintenanceContext(overrides: Record<string, unknown> = {}) {
  const expanded = reactive<Record<string, boolean>>({ builtin: true, dify: false });
  const context = {
    canAdminKnowledge: asRef(true),
    canMaintainKnowledge: asRef(true),
    connectKnowledgeBackendProvider: vi.fn(async () => undefined),
    enabledStringOptionBarOptions: [
      { label: "启用", value: "true" },
      { label: "停用", value: "false" },
    ],
    knowledgeBackendModeOptions: [
      { label: "contract", value: "contract" },
      { label: "live", value: "live" },
    ],
    knowledgeBackendProviderCards: asRef<Array<{
      provider: string;
      title: string;
      description: string;
      meta: string[];
      statusTone: string;
      statusLabel: string;
      details: Array<{ label: string; value: string }>;
    }>>([
      {
        provider: "dify",
        title: "Dify",
        description: "外部知识后端",
        meta: ["cloud", "multi-tenant"],
        statusTone: "success",
        statusLabel: "可连接",
        details: [
          { label: "端点", value: "https://dify.example" },
          { label: "Secret", value: "secret://dify" },
        ],
      },
    ]),
    knowledgeBackendProviderForms: reactive({
      dify: {
        mode: "contract",
        secretRef: "secret://pact/knowledge/dify-api-key",
        endpointRef: "config://pact/knowledge/dify-endpoint",
      },
    }) as Record<string, { mode: string; secretRef: string; endpointRef: string }>,
    knowledgeConfigGroupDescription: vi.fn((id: string) => (id === "retrieval" ? "检索配置" : "")),
    knowledgeConsole: asRef({ available: true }),
    knowledgeLibraryBusy: asRef(""),
    knowledgeLibraryError: asRef(""),
    knowledgeSchema: asRef({
      groups: [
        {
          id: "retrieval",
          label: "检索",
          fields: [
            { name: "retrieval.topK", type: "number", label: "Top K", defaultValue: 12, min: 1, max: 100, step: 1, description: "召回数量" },
            { name: "retrieval.enabled", type: "boolean", label: "启用检索", defaultValue: false, description: "是否打开" },
            { name: "retrieval.name", type: "string", label: "名称", defaultValue: "默认", description: "显示名称" },
          ],
        },
      ],
    }),
    maintenanceFieldValue: vi.fn((name: string, defaultValue: unknown) => {
      if (name === "retrieval.topK") return 12;
      if (name === "retrieval.enabled") return false;
      if (name === "retrieval.name") return "知识维护";
      return defaultValue;
    }),
    maintenanceJson: asRef('{"schemaVersion": "v0.0.1:schema:definition-1"}'),
    saveKnowledgeMaintenance: vi.fn(),
    setMaintenanceFieldFromEvent: vi.fn(),
    setMaintenanceFieldValue: vi.fn(),
    isKnowledgeBackendCardExpanded: vi.fn((provider: string) => expanded[provider] ?? false),
    toggleKnowledgeBackendCard: vi.fn((provider: string) => {
      expanded[provider] = !expanded[provider];
    }),
    ...overrides,
  };

  return context;
}

function makeLibraryContext(overrides: Record<string, unknown> = {}) {
  const expanded = reactive<Record<string, boolean>>({ libA: true });
  const context = {
    isKnowledgeLibraryCardExpanded: vi.fn((id: string) => expanded[id] ?? false),
    knowledgeLibraryCards: asRef<Array<{
      id: string;
      title: string;
      displayTitle: string;
      providerLabel: string;
      boundaryTone: string;
      boundaryLabel: string;
      statusTone: string;
      statusLabel: string;
      details: Array<{ label: string; value: string }>;
    }>>([
      {
        id: "libA",
        title: "库 A",
        displayTitle: "知识库 A",
        providerLabel: "Pact Native",
        boundaryTone: "info",
        boundaryLabel: "内建",
        statusTone: "success",
        statusLabel: "可用",
        details: [
          { label: "空间", value: "main" },
          { label: "索引", value: "ready" },
        ],
      },
    ]),
    knowledgeLibraryError: asRef(""),
    toggleKnowledgeLibraryCard: vi.fn((id: string) => {
      expanded[id] = !expanded[id];
    }),
    ...overrides,
  };

  return context;
}

function mountIngestPanel() {
  const wrapper = mount(KnowledgeIngestPanel, {
    global: {
      stubs: {
        BridgeDownloadButton: BridgeDownloadButtonStub,
        OptionBar: OptionBarStub,
        UploadFileListCard: UploadFileListCardStub,
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function mountMaintenancePanel() {
  const wrapper = mount(KnowledgeMaintenancePanel, {
    global: {
      stubs: {
        ConfigFoldCard: ConfigFoldCardStub,
        OptionBar: OptionBarStub,
        SplitToggleCard: SplitToggleCardStub,
        StatusPill: StatusPillStub,
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function mountLibraryBoard() {
  const wrapper = mount(KnowledgeLibraryBoard, {
    global: {
      stubs: {
        SplitToggleCard: SplitToggleCardStub,
        StatusPill: StatusPillStub,
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  knowledgeDocumentsMock.previewKnowledgeDocuments.mockReset();
  knowledgeDocumentsMock.previewKnowledgeDocuments.mockResolvedValue({ parsed: true });
  knowledgeViewContextMock.ingest = makeIngestContext();
  knowledgeViewContextMock.library = makeLibraryContext();
  knowledgeViewContextMock.maintenance = makeMaintenanceContext();
  knowledgeViewContextMock.view = {
    ingest: {
      dynamicParsingPreviewConfig: {
        pipelineId: "pipeline-1",
        contextBudget: 2048,
        payloadBudget: 4096,
        granularity: "document",
        dynamicParsing: true,
      },
    },
  };
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("KnowledgeIngestPanel extra coverage", () => {
  it("renders loading and empty target states without enabling submission", () => {
    knowledgeViewContextMock.ingest = makeIngestContext({
      knowledgeLibraryBusy: asRef("spaces"),
      knowledgeIngestTargetOptions: asRef([]),
      canSubmitKnowledgeIngest: asRef(false),
    });

    const wrapper = mountIngestPanel();

    expect(wrapper.text()).toContain("知识归档");
    expect(wrapper.text()).toContain("检测中");
    expect(wrapper.get(".option-bar-stub").attributes("data-placeholder")).toBe("正在检测知识库");
    expect(wrapper.find(".option-bar-stub").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".upload-file-list-card-stub__upload").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".upload-file-list-card-stub__preview").attributes("disabled")).toBeDefined();
  });

  it("forwards target selection, file selection, preview, upload, and normalized manifest links", async () => {
    const ingestContext = makeIngestContext({
      ingestFiles: asRef([new File(["alpha"], "alpha.txt", { type: "text/plain" })]),
      knowledgeIngestTargetDisplaySummary: asRef("将入库到：主知识库"),
      normalizedManifest: asRef({
        batchId: "batch-1",
        documents: [
          { documentId: "doc-1", title: "文档 A", granularity: "document", byteSize: 2048 },
        ],
        sourceMaterials: [
          { documentId: "src-1", title: "原文 A", granularity: "source", byteSize: 512 },
        ],
      }),
    });
    knowledgeViewContextMock.ingest = ingestContext;

    const wrapper = mountIngestPanel();

    await wrapper.get(".option-bar-stub").trigger("click");
    expect(ingestContext.setKnowledgeIngestTargetValues).toHaveBeenCalled();
    expect(ingestContext.setKnowledgeIngestTargetValues).toHaveBeenLastCalledWith(["primary"]);
    expect(ingestContext.knowledgeIngestTargetValues.value).toEqual(["primary"]);

    await wrapper.get(".upload-file-list-card-stub__select").trigger("click");
    expect(ingestContext.onIngestFilesSelected).toHaveBeenCalledWith([
      expect.objectContaining({ name: "selected.txt" }),
    ]);
    expect(ingestContext.ingestFiles.value).toHaveLength(1);

    await wrapper.get(".upload-file-list-card-stub__preview").trigger("click");
    await flush();
    expect(knowledgeDocumentsMock.previewKnowledgeDocuments).toHaveBeenCalledWith(
      ingestContext.ingestFiles.value,
      expect.objectContaining({
        pipelineId: "pipeline-1",
        expectedOutputs: ["preprocessResult", "chunks", "structureArtifacts", "granularityFragments"],
        contextBudget: 2048,
        payloadBudget: 4096,
        granularity: "document",
        dynamicParsing: true,
      }),
    );
    expect(ingestContext.documentPreviewResult.value).toEqual({ parsed: true });
    expect(wrapper.text()).toContain("\"parsed\": true");

    await wrapper.get(".upload-file-list-card-stub__upload").trigger("click");
    expect(ingestContext.uploadFilesToKnowledge).toHaveBeenCalledTimes(1);

    const links = wrapper.findAll("a.bridge-download-stub");
    expect(links.map((link) => link.attributes("href"))).toEqual([
      "/normalized/batch-1/doc-1",
      "/normalized/batch-1/src-1",
    ]);
    expect(links.map((link) => link.text())).toEqual(["文档 A", "原文 A"]);
  });
});

describe("KnowledgeMaintenancePanel extra coverage", () => {
  it("renders config groups, updates fields, toggles cards, and saves and connects providers", async () => {
    const maintenanceContext = makeMaintenanceContext();
    knowledgeViewContextMock.maintenance = maintenanceContext;
    maintenanceContext.canAdminKnowledge.value = true;
    maintenanceContext.canMaintainKnowledge.value = true;

    const wrapper = mountMaintenancePanel();

    expect(wrapper.text()).toContain("Pact Native");
    expect(wrapper.text()).toContain("检索配置");
    expect(wrapper.find(".status-pill-stub").text()).toContain("内建");
    expect(wrapper.find(".status-pill-stub[data-tone='success']").exists()).toBe(true);

    await wrapper.findAll(".option-bar-stub")[0].trigger("click");
    expect(maintenanceContext.setMaintenanceFieldValue).toHaveBeenCalledWith("retrieval.enabled", true);

    await wrapper.get("input[type='number']").setValue("24");
    expect(maintenanceContext.setMaintenanceFieldFromEvent).toHaveBeenCalledWith("retrieval.topK", expect.any(Object), "number");

    const textInputs = wrapper.findAll("input[type='text']");
    await textInputs[0].setValue("更新后的名称");
    expect(maintenanceContext.setMaintenanceFieldFromEvent).toHaveBeenCalledWith("retrieval.name", expect.any(Object), "string");

    const textarea = wrapper.get("textarea");
    await textarea.setValue('{"schemaVersion":2}');
    expect(maintenanceContext.maintenanceJson.value).toBe('{"schemaVersion":2}');

    await wrapper.get("button.primary-action").trigger("click");
    expect(maintenanceContext.saveKnowledgeMaintenance).toHaveBeenCalledTimes(1);

    await wrapper.findAll(".split-toggle-card-stub__toggle")[1].trigger("click");
    expect(maintenanceContext.toggleKnowledgeBackendCard).toHaveBeenCalledWith("dify");

    await wrapper.findAll(".split-toggle-card-stub__body .option-bar-stub")[1].trigger("click");
    expect(maintenanceContext.knowledgeBackendProviderForms.dify.mode).toBe("live");

    await wrapper.get(".knowledge-backend-provider-form input[placeholder='secret://pact/knowledge/provider-api-key']").setValue("secret://updated");
    expect(maintenanceContext.knowledgeBackendProviderForms.dify.secretRef).toBe("secret://updated");

    await wrapper.get(".knowledge-backend-provider-form input[placeholder='config://pact/knowledge/provider-endpoint']").setValue("config://updated");
    expect(maintenanceContext.knowledgeBackendProviderForms.dify.endpointRef).toBe("config://updated");

    await wrapper.findAll(".split-toggle-card-stub__body .primary-action")[1].trigger("click");
    expect(maintenanceContext.connectKnowledgeBackendProvider).toHaveBeenCalledWith("dify");
  });

  it("shows maintenance and backend busy states and blocks writes when permissions are missing", async () => {
    const maintenanceContext = makeMaintenanceContext({
      knowledgeLibraryError: asRef("知识库维护异常"),
      knowledgeLibraryBusy: asRef("backend:dify"),
    });
    maintenanceContext.canAdminKnowledge.value = false;
    maintenanceContext.canMaintainKnowledge.value = false;
    knowledgeViewContextMock.maintenance = maintenanceContext;

    const wrapper = mountMaintenancePanel();

    expect(wrapper.text()).toContain("知识库维护异常");
    await wrapper.findAll(".split-toggle-card-stub__toggle")[1].trigger("click");
    expect(wrapper.findAll(".split-toggle-card-stub__body .primary-action")[1].attributes("disabled")).toBeDefined();
    expect(wrapper.findAll(".split-toggle-card-stub__body .primary-action")[1].text()).toBe("连接中");
    expect(wrapper.get("button.primary-action").attributes("disabled")).toBeDefined();

    await wrapper.get("button.primary-action").trigger("click");
    await wrapper.get(".split-toggle-card-stub__body .primary-action").trigger("click");

    expect(maintenanceContext.saveKnowledgeMaintenance).not.toHaveBeenCalled();
    expect(maintenanceContext.connectKnowledgeBackendProvider).not.toHaveBeenCalled();
  });
});

describe("KnowledgeLibraryBoard extra coverage", () => {
  it("renders the empty state and error state correctly", () => {
    knowledgeViewContextMock.library = makeLibraryContext({
      knowledgeLibraryCards: asRef([]),
    });

    const emptyWrapper = mountLibraryBoard();
    expect(emptyWrapper.text()).toContain("暂无可用知识库");
    expect(emptyWrapper.text()).toContain("选择入库目标后，这里会显示边界、后端和索引状态。");

    emptyWrapper.unmount();
    knowledgeViewContextMock.library = makeLibraryContext({
      knowledgeLibraryCards: asRef([]),
      knowledgeLibraryError: asRef("知识库加载失败"),
    });

    const errorWrapper = mountLibraryBoard();
    expect(errorWrapper.text()).toContain("知识库加载失败");
    expect(errorWrapper.find(".knowledge-library-empty").exists()).toBe(false);
  });

  it("renders library cards and forwards toggle actions", async () => {
    const libraryContext = makeLibraryContext({
      knowledgeLibraryCards: asRef([
        {
          id: "libA",
          title: "库 A",
          displayTitle: "知识库 A",
          providerLabel: "Pact Native",
          boundaryTone: "info",
          boundaryLabel: "内建",
          statusTone: "success",
          statusLabel: "可用",
          details: [
            { label: "空间", value: "main" },
            { label: "索引", value: "ready" },
          ],
        },
        {
          id: "libB",
          title: "库 B",
          displayTitle: "知识库 B",
          providerLabel: "Dify",
          boundaryTone: "warning",
          boundaryLabel: "外部",
          statusTone: "info",
          statusLabel: "连接中",
          details: [
            { label: "空间", value: "sandbox" },
          ],
        },
      ]),
    });
    knowledgeViewContextMock.library = libraryContext;

    const wrapper = mountLibraryBoard();

    expect(wrapper.text()).toContain("知识库 A");
    expect(wrapper.text()).toContain("Pact Native");
    expect(wrapper.text()).toContain("main");
    expect(wrapper.text()).toContain("ready");
    expect(wrapper.findAll(".status-pill-stub[data-tone='success']").length).toBeGreaterThan(0);
    expect(wrapper.findAll(".split-toggle-card-stub__body").length).toBe(1);

    await wrapper.find(".split-toggle-card-stub__toggle").trigger("click");
    expect(libraryContext.toggleKnowledgeLibraryCard).toHaveBeenCalledWith("libA");

    await wrapper.findAll(".split-toggle-card-stub__toggle")[1].trigger("click");
    expect(libraryContext.toggleKnowledgeLibraryCard).toHaveBeenCalledWith("libB");
  });
});
