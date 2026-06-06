// @vitest-environment jsdom
import { defineComponent, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createConsoleSystemLogRowController } from "../../../server-web/composables/console-system-log-row-controller";

const shellState = vi.hoisted(() => {
  const { ref } = require("vue");
  return {
    agentEvidencePreviewOpen: ref(false),
    busyKey: ref(""),
    closeAgentEvidencePreview: vi.fn(),
    evidenceLoadError: ref(""),
    evidenceReadableHtml: ref(""),
    evidenceReadableKind: ref("文本"),
    evidenceSourceDetails: vi.fn(() => [] as Array<{ label: string; value: string }>),
    openAgentEvidencePreview: vi.fn(),
    selectedEvidence: ref(null as any),
    selectedEvidenceDisplayTitle: ref("来源详情"),
    selectedEvidenceId: ref(""),
  };
});

const sideNavState = vi.hoisted(() => {
  const { reactive, ref } = require("vue");
  return {
    activeRouteAdminView: ref("storage"),
    activeRouteView: ref("admin"),
    hasFeature: vi.fn(() => true),
    msg: reactive({
      nav: {
        system: "系统",
        overview: "概览",
        modules: "模块",
        runtimeDownloads: "运行时下载",
        productionHealth: "生产健康",
        logs: "日志",
        operations: "运维",
        jobs: "任务",
        opsMonitor: "监控",
        maintenanceAgent: "维护智能体",
      },
    }),
    openAdmin: vi.fn(),
  };
});

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => shellState,
}));

vi.mock("../../../server-web/composables/consoleSideNavContext", () => ({
  useConsoleSideNavContext: () => sideNavState,
}));

vi.mock("../../../server-web/components/ConfigFoldCard.vue", () => ({
  default: defineComponent({
    name: "ConfigFoldCardStub",
    props: { title: { type: String, default: "" } },
    template: '<section class="config-fold-card-stub"><slot /></section>',
  }),
}));

vi.mock("../../../server-web/components/SafeHtmlBlock.vue", () => ({
  default: defineComponent({
    name: "SafeHtmlBlockStub",
    props: {
      html: { type: String, default: "" },
      source: { type: String, default: "" },
    },
    template: '<div class="safe-html-block-stub" :data-source="source" v-html="html"></div>',
  }),
}));

import AgentEvidencePreviewDialog from "../../../server-web/components/shell/AgentEvidencePreviewDialog.vue";
import ConsoleSideNavSystemSection from "../../../server-web/components/shell/side-nav/ConsoleSideNavSystemSection.vue";
import { compactLogDetail, genericStatusTone, stateProgressPercent } from "../../../server-web/composables/console-system-log-row-utils";

function createSystemLogFixture() {
  const activeKnowledgeSources = ref<any[]>([
    {
      sourceId: "source-a",
      label: "Source A",
      directoryPath: "/source/a",
      status: "active",
      lastJobStatus: "completed",
      lastJobUpdatedAt: "2026-06-04T07:30:00.000Z",
      createdAt: "2026-06-04T07:00:00.000Z",
    },
  ]);
  const agentSelectionReferenceLogs = ref<any[]>([
    {
      logId: "ref-only",
      kindLabel: "引用",
      displayId: "ref-only",
      target: "reference-a",
      status: "info",
      statusLabel: "引用",
      tone: "info",
      stage: "reference",
      occurredAt: "2026-06-04T08:00:00.000Z",
      createdAt: "2026-06-04T08:00:00.000Z",
      progressPercent: 50,
      detail: "reference only row",
      error: "",
    },
  ]);
  const knowledgeRecentJobs = ref<any[]>([
    {
      id: "job-shared",
      status: "completed",
      createdAt: "2026-06-04T09:00:00.000Z",
      updatedAt: "2026-06-04T12:00:00.000Z",
      stage: "base-shared",
    },
    {
      id: "job-base-only",
      status: "failed",
      createdAt: "2026-06-04T10:00:00.000Z",
      updatedAt: "2026-06-04T11:00:00.000Z",
      stage: "base-only",
      error: "base failed",
    },
  ]);
  const uploadTraceEvents = ref<any[]>([]);

  const activeMonitorAlerts = ref<any[]>([]);
  const agentConfigurationAlerts = ref<any[]>([]);
  const authAudit = ref<any[]>([]);
  const backgroundProcesses = ref<any[]>([]);
  const backgroundProcessStatus = ref<any>(null);
  const recentJobs = ref<any[]>([
    {
      id: "job-shared",
      status: "failed",
      createdAt: "2026-06-04T09:30:00.000Z",
      updatedAt: "2026-06-04T12:30:00.000Z",
      stage: "status-shared",
      error: "status failure",
    },
  ]);
  const recentMonitorAlertHistory = ref<any[]>([]);
  const toolManagementAuditItems = ref<any[]>([]);
  const workQueueRows = ref<any[]>([
    {
      rowId: "queue-1",
      queueId: "queue-1",
      status: "pending",
      lifecycleStatus: "pending",
      updatedAt: "2026-06-04T11:30:00.000Z",
      startedAt: "2026-06-04T11:00:00.000Z",
      sourceLabel: "scheduler",
      phase: "run",
      label: "Queue 1",
    },
  ]);

  const controller = createConsoleSystemLogRowController({
    activeKnowledgeSources,
    activeMonitorAlerts,
    agentConfigurationAlerts,
    agentSelectionReferenceLogs,
    authAudit,
    backgroundProcesses,
    backgroundProcessStatus,
    knowledgeRecentJobs,
    recentJobs,
    recentMonitorAlertHistory,
    toolManagementAuditItems,
    uploadTraceEvents,
    workQueueRows,
  });

  return {
    activeKnowledgeSources,
    controller,
    knowledgeRecentJobs,
    recentJobs,
  };
}

function mountEvidenceDialog() {
  return mount(AgentEvidencePreviewDialog);
}

function mountSystemSection() {
  return mount(ConsoleSideNavSystemSection);
}

beforeEach(() => {
  vi.clearAllMocks();
  shellState.agentEvidencePreviewOpen.value = false;
  shellState.busyKey.value = "";
  shellState.evidenceLoadError.value = "";
  shellState.evidenceReadableHtml.value = "";
  shellState.evidenceReadableKind.value = "文本";
  shellState.selectedEvidence.value = null;
  shellState.selectedEvidenceDisplayTitle.value = "来源详情";
  shellState.selectedEvidenceId.value = "";

  sideNavState.activeRouteAdminView.value = "storage";
  sideNavState.activeRouteView.value = "admin";
  sideNavState.hasFeature.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentEvidencePreviewDialog extra coverage", () => {
  it("stays hidden when closed", () => {
    const wrapper = mountEvidenceDialog();

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).toBe("");
  });

  it("renders the loaded evidence branch and closes from the backdrop and button", async () => {
    shellState.agentEvidencePreviewOpen.value = true;
    shellState.selectedEvidence.value = {
      evidenceId: "evidence-1",
      title: "证据标题",
    } as any;
    shellState.selectedEvidenceDisplayTitle.value = "证据标题";
    shellState.selectedEvidenceId.value = "evidence-1";
    shellState.evidenceReadableKind.value = "HTML";
    shellState.evidenceReadableHtml.value = "<p>正文</p>";
    shellState.evidenceSourceDetails.mockReturnValue([
      { label: "文档", value: "source.doc" },
      { label: "章节", value: "第 1 章" },
    ]);

    const wrapper = mountEvidenceDialog();

    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("证据预览");
    expect(wrapper.text()).toContain("证据标题");
    expect(wrapper.text()).toContain("evidence-1");
    expect(wrapper.text()).toContain("HTML");
    expect(wrapper.text()).toContain("source.doc");
    expect(wrapper.text()).toContain("第 1 章");
    expect(wrapper.get(".safe-html-block-stub").attributes("data-source")).toBe("renderEvidenceReadableHtml");
    expect(wrapper.get(".safe-html-block-stub").html()).toContain("<p>正文</p>");

    await wrapper.get(".dialog-close-button").trigger("click");
    expect(shellState.closeAgentEvidencePreview).toHaveBeenCalledTimes(1);

    await wrapper.get(".agent-evidence-preview-backdrop").trigger("click");
    expect(shellState.closeAgentEvidencePreview).toHaveBeenCalledTimes(2);
  });

  it("shows loading and error branches, and retries with the selected evidence id", async () => {
    shellState.agentEvidencePreviewOpen.value = true;
    shellState.busyKey.value = "knowledge:evidence:loading";

    const loadingWrapper = mountEvidenceDialog();
    expect(loadingWrapper.text()).toContain("正在加载证据");
    expect(loadingWrapper.text()).toContain("正在打开来源");

    shellState.busyKey.value = "";
    shellState.evidenceLoadError.value = "加载失败";
    shellState.selectedEvidenceId.value = "evidence-2";
    shellState.openAgentEvidencePreview.mockClear();

    const errorWrapper = mountEvidenceDialog();
    expect(errorWrapper.text()).toContain("证据无法打开");
    expect(errorWrapper.text()).toContain("加载失败");

    await errorWrapper.get(".compact-action").trigger("click");
    expect(shellState.openAgentEvidencePreview).toHaveBeenCalledWith("evidence-2");

    shellState.busyKey.value = "knowledge:evidence:evidence-2";
    const disabledWrapper = mountEvidenceDialog();
    expect(disabledWrapper.get(".compact-action").attributes("disabled")).toBeDefined();
  });
});

describe("ConsoleSideNavSystemSection extra coverage", () => {
  it("renders the system and operations sections and activates routes", async () => {
    const wrapper = mountSystemSection();

    expect(wrapper.text()).toContain("系统");
    expect(wrapper.text()).toContain("运维");
    expect(wrapper.findAll("section")).toHaveLength(2);

    const buttons = wrapper.findAll("button");
    expect(buttons[0].classes()).toContain("active");
    expect(buttons[0].text()).toContain("概览");

    await buttons[4].trigger("click");
    expect(sideNavState.openAdmin).toHaveBeenCalledWith("logs");

    await buttons[5].trigger("click");
    expect(sideNavState.openAdmin).toHaveBeenCalledWith("jobs");

    sideNavState.activeRouteAdminView.value = "logs";
    await nextTick();
    expect(wrapper.findAll("button")[4].classes()).toContain("active");
  });

  it("hides the maintenance entry when the feature is unavailable", () => {
    sideNavState.hasFeature.mockReturnValue(false);

    const wrapper = mountSystemSection();
    expect(wrapper.text()).not.toContain("维护智能体");
    expect(sideNavState.hasFeature).toHaveBeenCalledWith("maintenance-agent-runbooks");
  });
});

describe("console-system-log-row-controller extra coverage", () => {
  it("dedupes shared rows, sorts by occurredAt, and reacts to source changes", () => {
    const { activeKnowledgeSources, controller, knowledgeRecentJobs, recentJobs } = createSystemLogFixture();

    expect(controller.collectSystemStatusLogRows().map((row) => row.logId)).toEqual([
      "queue:queue-1",
      "job:job-shared",
    ]);

    expect(controller.baseServerLogRows.value.map((row) => row.logId)).toEqual([
      "job:job-shared",
      "job:job-base-only",
      "ref-only",
      "source:source-a",
    ]);

    expect(controller.serverLogRows.value.map((row) => row.logId)).toEqual([
      "job:job-shared",
      "queue:queue-1",
      "job:job-base-only",
      "ref-only",
      "source:source-a",
    ]);

    expect(controller.compactLogDetail(["  a  ", "", true, null, 5])).toBe("a · true · 5");
    expect(controller.genericStatusTone("running")).toBe("success");
    expect(controller.stateProgressPercent("queued")).toBe(20);

    knowledgeRecentJobs.value = [
      {
        id: "job-updated",
        status: "completed",
        createdAt: "2026-06-04T13:00:00.000Z",
        updatedAt: "2026-06-04T13:30:00.000Z",
        stage: "updated",
      },
    ];
    activeKnowledgeSources.value = [
      {
        sourceId: "source-b",
        label: "Source B",
        directoryPath: "/source/b",
        status: "active",
        lastJobStatus: "completed",
        lastJobUpdatedAt: "2026-06-04T13:15:00.000Z",
        createdAt: "2026-06-04T13:00:00.000Z",
      },
    ];
    recentJobs.value = [];

    expect(controller.baseServerLogRows.value.map((row) => row.logId)).toEqual([
      "job:job-updated",
      "source:source-b",
      "ref-only",
    ]);
    expect(controller.serverLogRows.value[0].logId).toBe("job:job-updated");
    expect(controller.serverLogRows.value).toHaveLength(4);
  });
});
