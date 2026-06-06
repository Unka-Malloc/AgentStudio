// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import InfoFeedComposerPanel from "../../../server-web/components/feed/InfoFeedComposerPanel.vue";
import RuleAuthoringResultPanel from "../../../server-web/components/knowledge/rules/RuleAuthoringResultPanel.vue";
import EmailExpertRulesPanel from "../../../server-web/components/knowledge/rules/EmailExpertRulesPanel.vue";
import WordCloudStageHeader from "../../../server-web/components/knowledge/word-cloud/WordCloudStageHeader.vue";
import UploadFileListRow from "../../../server-web/components/upload/UploadFileListRow.vue";
import WorkspaceCloudDrivePanel from "../../../server-web/components/workspaces/WorkspaceCloudDrivePanel.vue";

const feedContextMock = vi.hoisted(() => vi.fn());
const knowledgeRulesContextMock = vi.hoisted(() => vi.fn());
const knowledgeWordCloudContextMock = vi.hoisted(() => vi.fn());
const workspacesContextMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/feedViewContext", () => ({
  useFeedViewContext: feedContextMock
}));

vi.mock("../../../server-web/composables/knowledgeViewContext", () => ({
  useKnowledgeRulesContext: knowledgeRulesContextMock,
  useKnowledgeWordCloudContext: knowledgeWordCloudContextMock
}));

vi.mock("../../../server-web/composables/workspacesViewContext", () => ({
  useWorkspacesViewContext: workspacesContextMock
}));

vi.mock("../../../server-web/composables/console-format-utils", () => ({
  jsonPreview: vi.fn((value: unknown) => `json:${JSON.stringify(value)}`)
}));

vi.mock("../../../server-web/composables/console-agent-explore-presentation", () => ({
  shortId: vi.fn((value: string) => `short:${value}`)
}));

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: ["disabled", "buttonText"],
  emits: ["browse", "select"],
  setup(props, { emit, slots }) {
    return () => h("button", {
      class: "browse-select-stub",
      type: "button",
      disabled: Boolean(props.disabled),
      onClick: () => {
        if (!props.disabled) {
          emit("browse");
          emit("select", [new File(["x"], "fixture.txt")]);
        }
      }
    }, slots.default?.() || String(props.buttonText || "browse"));
  }
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: ["modelValue", "options", "label"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "option-bar-stub",
      type: "button",
      "data-label": String(props.label || ""),
      onClick: () => {
        const next = (props.options as Array<{ value: string }> | undefined)?.[1]?.value || "next";
        emit("update:model-value", next);
        emit("update:modelValue", next);
      }
    }, String(props.modelValue ?? ""));
  }
});

const AgentModelOptionBarStub = defineComponent({
  name: "AgentModelOptionBar",
  props: ["modelValue", "label"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "agent-model-option-bar-stub",
      type: "button",
      onClick: () => {
        emit("update:model-value", "agent-next");
        emit("update:modelValue", "agent-next");
      }
    }, `${props.label}:${props.modelValue || ""}`);
  }
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: ["modelValue", "label"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "binary-checkbox-stub",
      type: "button",
      onClick: () => {
        emit("update:model-value", !props.modelValue);
        emit("update:modelValue", !props.modelValue);
      }
    }, String(props.label || ""));
  }
});

const FeatureToggleStub = defineComponent({
  name: "FeatureToggle",
  props: ["modelValue"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "feature-toggle-stub",
      type: "button",
      onClick: () => {
        emit("update:model-value", !props.modelValue);
        emit("update:modelValue", !props.modelValue);
      }
    }, String(props.modelValue));
  }
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: ["title"],
  setup(props, { slots }) {
    return () => h("section", { class: "config-fold-card-stub" }, [
      h("h4", String(props.title || "")),
      slots.default?.()
    ]);
  }
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: ["tone", "label"],
  setup(props) {
    return () => h("span", { class: ["status-pill-stub", props.tone] }, String(props.label || ""));
  }
});

const BridgeDownloadButtonStub = defineComponent({
  name: "BridgeDownloadButton",
  props: ["href", "label"],
  setup(props) {
    return () => h("a", { class: "bridge-download-button-stub", href: String(props.href || "#") }, String(props.label || ""));
  }
});

const SegmentedProgressBarStub = defineComponent({
  name: "SegmentedProgressBar",
  props: ["completedSteps", "totalSteps"],
  setup(props) {
    return () => h("div", { class: "segmented-progress-stub" }, `${props.completedSteps}/${props.totalSteps}`);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("content small component local extra coverage", () => {
  it("drives info feed composer attachments, advanced dialog, settings save, and disabled submit", async () => {
    const removeInfoFeedAttachment = vi.fn();
    const handleInfoFeedAttachmentFiles = vi.fn();
    const runInfoFeed = vi.fn();
    const saveSettings = vi.fn();
    const settingsDraft = ref({
      agentExploreDefaults: {
        systemPrompt: "system",
        toolPolicyPrompt: "tool",
        continuationPrompt: "continue",
        answerTemplate: "answer",
        contextProfileId: "default",
        thinkingMode: "auto",
        temperature: 0.2,
        maxTokens: 512,
        maxIterations: 3,
        limit: 5,
        toolChoice: "auto",
        reviewFusionModelAlias: "fusion",
        reviewFusionTemperature: 0.1,
        reviewFusionMaxTokens: 256,
        reviewFusionSystemPrompt: "fusion prompt"
      }
    });
    feedContextMock.mockReturnValue({
      agentSelectorOptions: [{ value: "fusion" }, { value: "fusion-next" }],
      busyKey: "",
      contextWindowOptionBarOptions: [{ value: "default" }, { value: "wide" }],
      handleInfoFeedAttachmentFiles,
      infoFeedAttachments: [{ id: "att-1", name: "mail.eml", status: "ready" }],
      infoFeedCurrentRun: { summary: { status: "idle" } },
      infoFeedForm: ref({ query: "hello", modelAlias: "agent-a" }).value,
      infoFeedInputPlaceholder: "Ask",
      infoFeedModelOptions: [{ value: "agent-a" }, { value: "agent-b" }],
      infoFeedSubmitLabel: "Run",
      removeInfoFeedAttachment,
      runInfoFeed,
      saveSettings,
      selectedInfoFeedModel: { enabled: true },
      settingsDraft: settingsDraft.value,
      thinkingModeOptionBarOptions: [{ value: "auto" }, { value: "manual" }]
    });
    const wrapper = mount(InfoFeedComposerPanel, {
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          BrowseSelectButton: BrowseSelectButtonStub,
          ConfigFoldCard: ConfigFoldCardStub,
          OptionBar: OptionBarStub
        }
      }
    });
    expect(wrapper.text()).toContain("mail.eml");
    await wrapper.find(".info-feed-attachment-chip button").trigger("click");
    expect(removeInfoFeedAttachment).toHaveBeenCalledWith("att-1");
    await wrapper.find(".browse-select-stub").trigger("click");
    expect(handleInfoFeedAttachmentFiles).toHaveBeenCalled();
    await wrapper.find("form.info-feed-input-dock").trigger("submit");
    expect(runInfoFeed).toHaveBeenCalledTimes(1);

    await wrapper.find(".info-feed-advanced-button").trigger("click");
    expect(wrapper.find(".info-feed-advanced-dialog").exists()).toBe(true);
    await wrapper.find(".info-feed-advanced-form").trigger("submit");
    expect(saveSettings).toHaveBeenCalledTimes(1);
    await wrapper.find(".dialog-close-button").trigger("click");
    expect(wrapper.find(".info-feed-advanced-dialog").exists()).toBe(false);

    feedContextMock.mockReturnValueOnce({
      agentSelectorOptions: [],
      busyKey: "settings",
      contextWindowOptionBarOptions: [],
      handleInfoFeedAttachmentFiles: vi.fn(),
      infoFeedAttachments: [],
      infoFeedCurrentRun: { summary: { status: "running" } },
      infoFeedForm: { query: "busy", modelAlias: "" },
      infoFeedInputPlaceholder: "Ask",
      infoFeedModelOptions: [],
      infoFeedSubmitLabel: "Busy",
      removeInfoFeedAttachment: vi.fn(),
      runInfoFeed: vi.fn(),
      saveSettings: vi.fn(),
      selectedInfoFeedModel: { enabled: false },
      settingsDraft: settingsDraft.value,
      thinkingModeOptionBarOptions: []
    });
    const disabled = mount(InfoFeedComposerPanel, {
      global: {
        stubs: {
          AgentModelOptionBar: AgentModelOptionBarStub,
          BrowseSelectButton: BrowseSelectButtonStub,
          ConfigFoldCard: ConfigFoldCardStub,
          OptionBar: OptionBarStub
        }
      }
    });
    expect(disabled.find(".primary-action").attributes("disabled")).toBeDefined();
  });

  it("drives cloud drive panel advanced mode, actions, and result rendering", async () => {
    const calls = {
      addCloudDriveExposure: vi.fn(),
      applyCloudDriveSync: vi.fn(),
      connectCloudDrive: vi.fn(),
      downloadCloudDriveFile: vi.fn(),
      listCloudDriveItems: vi.fn(),
      listCloudDrivePermissions: vi.fn(),
      planCloudDriveSync: vi.fn(),
      removeCloudDriveExposure: vi.fn(),
      uploadCloudDriveFile: vi.fn()
    };
    const panel = ref("cloud");
    const cloudDriveForm = reactive({
      provider: "icloud",
      driveRef: "",
      rootPath: "/icloud",
      managedFolderRoot: "Pact",
      publicFolder: "Public",
      clientId: "client-a",
      allowedClients: "client-a",
      path: "default/readme.md",
      uploadPath: "default/write.md",
      targetPath: "/tmp/sync",
      advancedMode: true,
      exposedDirectories: [{
        id: "dir-1",
        name: "Public docs",
        path: "/docs",
        showPermissions: false,
        permissionMode: "allowlist",
        subjects: "client-a"
      }],
      uploadContent: "hello"
    });
    workspacesContextMock.mockReturnValue({
      ...calls,
      busyKey: "",
      cloudDriveConnectionOptions: [{ value: "drive-1", label: "Drive 1" }],
      cloudDriveData: {
        connections: [{
          driveRef: "drive-reference-123456789",
          provider: "icloud",
          mode: "local",
          directoryMappingCount: 2,
          contractVerified: true
        }]
      },
      cloudDriveForm,
      cloudDriveResult: { ok: true },
      panel,
      selected: { title: "Workspace A" }
    });
    const wrapper = mount(WorkspaceCloudDrivePanel, {
      global: {
        stubs: {
          BinaryCheckbox: BinaryCheckboxStub,
          OptionBar: OptionBarStub,
          StatusPill: StatusPillStub
        }
      }
    });
    expect(wrapper.text()).toContain("Workspace A");
    expect(wrapper.text()).toContain("已连接云盘");
    await wrapper.findAll(".table-action")[0].trigger("click");
    expect(calls.addCloudDriveExposure).toHaveBeenCalledTimes(1);

    const tableButtons = wrapper.findAll(".table-action");
    await tableButtons[1].trigger("click");
    await nextTick();
    expect(wrapper.text()).toContain("客户端列表");
    await tableButtons[2].trigger("click");
    expect(calls.removeCloudDriveExposure).toHaveBeenCalledWith(0);
    await wrapper.find(".binary-checkbox-stub").trigger("click");
    expect(cloudDriveForm.advancedMode).toBe(false);

    const actionButtons = wrapper.findAll(".module-actions .tool-button");
    await actionButtons[0].trigger("click");
    await actionButtons[1].trigger("click");
    await actionButtons[2].trigger("click");
    await actionButtons[3].trigger("click");
    await actionButtons[4].trigger("click");
    await actionButtons[5].trigger("click");
    await actionButtons[6].trigger("click");
    await actionButtons[7].trigger("click");
    expect(calls.connectCloudDrive).toHaveBeenCalledTimes(1);
    expect(calls.listCloudDriveItems).toHaveBeenCalledTimes(1);
    expect(calls.downloadCloudDriveFile).toHaveBeenCalledTimes(1);
    expect(calls.uploadCloudDriveFile).toHaveBeenCalledTimes(1);
    expect(calls.planCloudDriveSync).toHaveBeenCalledTimes(1);
    expect(calls.applyCloudDriveSync).toHaveBeenCalledTimes(1);
    expect(calls.listCloudDrivePermissions).toHaveBeenCalledTimes(1);
  });

  it("renders rule, word-cloud, and upload branch components", async () => {
    const publishRuleAuthoringPackage = vi.fn();
    const saveRules = vi.fn();
    const setEmailRuleEntryEnabled = vi.fn();
    knowledgeRulesContextMock.mockReturnValue({
      busyKey: "",
      emailReportSeriesRules: [{
        index: 0,
        rule: { id: "daily", label: "Daily", cadence: "daily", keywords: ["report"], enabled: true }
      }],
      emailSynonymRules: [{
        index: 0,
        rule: { canonical: "contract", terms: ["agreement"], enabled: false }
      }],
      expertRuleEnabled: vi.fn((rule) => rule.enabled !== false),
      publishRuleAuthoringPackage,
      ruleAuthoringResult: {
        status: "ready",
        runId: "run-123456",
        steps: [{ stage: "draft", status: "pass" }],
        confirmation: { packageId: "pkg-1", version: 2 },
        gate: { ok: true },
        package: { id: "pkg-1" }
      },
      rulesText: "rules json",
      saveRules,
      setEmailRuleEntryEnabled
    });
    const expert = mount(EmailExpertRulesPanel, {
      global: { stubs: { ConfigFoldCard: ConfigFoldCardStub, FeatureToggle: FeatureToggleStub } }
    });
    expect(expert.text()).toContain("Daily");
    await expert.find(".feature-toggle-stub").trigger("click");
    expect(setEmailRuleEntryEnabled).toHaveBeenCalledWith("reportSeries", 0, false);
    await expert.find(".tool-button").trigger("click");
    expect(saveRules).toHaveBeenCalledTimes(1);

    const result = mount(RuleAuthoringResultPanel, {
      global: { stubs: { ConfigFoldCard: ConfigFoldCardStub } }
    });
    expect(result.text()).toContain("short:run-123456");
    await result.find("button").trigger("click");
    expect(publishRuleAuthoringPackage).toHaveBeenCalledTimes(1);

    const addManualWordCloud = vi.fn();
    const clearWordCloudCorpusPaths = vi.fn();
    const openWordCloudCorpusDirectoryPicker = vi.fn();
    const openWordCloudCorpusFilePicker = vi.fn();
    const removeWordCloudCorpusPath = vi.fn();
    const saveWordCloud = vi.fn();
    knowledgeWordCloudContextMock.mockReturnValue({
      addManualWordCloud,
      busyKey: "",
      canBrowseServerPaths: true,
      canWriteKnowledge: true,
      clearWordCloudCorpusPaths,
      openWordCloudCorpusDirectoryPicker,
      openWordCloudCorpusFilePicker,
      removeWordCloudCorpusPath,
      saveWordCloud,
      wordCloudCardRows: [{ id: "card-1" }],
      wordCloudCorpusPathLabel: vi.fn((item) => `label:${item.type}`),
      wordCloudCorpusPathSummary: "2 paths",
      wordCloudCorpusPaths: [{ type: "file", path: "/tmp/a.txt" }],
      wordCloudDraft: { title: "Cloud" },
      wordCloudTerms: ["alpha", "beta"]
    });
    const wordCloud = mount(WordCloudStageHeader, {
      global: { stubs: { BrowseSelectButton: BrowseSelectButtonStub } }
    });
    expect(wordCloud.text()).toContain("Cloud");
    await wordCloud.findAll(".browse-select-stub")[0].trigger("click");
    await wordCloud.findAll(".browse-select-stub")[1].trigger("click");
    await wordCloud.findAll("button").find((button) => button.text().includes("新增词云"))!.trigger("click");
    await wordCloud.findAll("button").find((button) => button.text().includes("保存"))!.trigger("click");
    await wordCloud.find("button[aria-label='移除语料路径']").trigger("click");
    await wordCloud.find(".inline-link").trigger("click");
    expect(openWordCloudCorpusDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(openWordCloudCorpusFilePicker).toHaveBeenCalledTimes(1);
    expect(addManualWordCloud).toHaveBeenCalledTimes(1);
    expect(saveWordCloud).toHaveBeenCalledTimes(1);
    expect(removeWordCloudCorpusPath).toHaveBeenCalledWith(0);
    expect(clearWordCloudCorpusPaths).toHaveBeenCalledTimes(1);

    const upload = mount(UploadFileListRow, {
      props: {
        entry: { name: "mail.eml", relativePath: "inbox/mail.eml", extension: ".eml", size: 128 },
        progressState: { completedSteps: 2, detail: "Processing", tone: "info", label: "Running" },
        totalProgressSteps: 4,
        progressStepLabels: ["queued", "parse", "index", "done"]
      } as any,
      global: { stubs: { SegmentedProgressBar: SegmentedProgressBarStub, StatusPill: StatusPillStub } }
    });
    expect(upload.text()).toContain("Processing");
    expect(upload.text()).toContain("parse");

    const download = mount(UploadFileListRow, {
      props: {
        mode: "download",
        entry: {
          name: "report.md",
          relativePath: "report.md",
          extension: ".md",
          size: 256,
          href: "/download/report.md",
          downloadName: "report.md",
          actionLabel: "下载报告",
          detail: "Ready"
        },
        progressState: { completedSteps: 0, detail: "", tone: "neutral", label: "" }
      } as any,
      global: { stubs: { BridgeDownloadButton: BridgeDownloadButtonStub, StatusPill: StatusPillStub } }
    });
    expect(download.text()).toContain("Ready");
    expect(download.find(".bridge-download-button-stub").text()).toBe("下载报告");
  });
});
