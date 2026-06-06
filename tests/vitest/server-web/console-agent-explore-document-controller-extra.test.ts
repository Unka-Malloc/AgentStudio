// @vitest-environment jsdom
import { ref } from "vue";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createConsoleAgentExploreDocumentController } from "../../../server-web/composables/console-agent-explore-document-controller";

const copyTextToClipboardMock = vi.hoisted(() => vi.fn());
const downloadTextFileMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyTextToClipboard: copyTextToClipboardMock,
  downloadTextFile: downloadTextFileMock,
}));

function createController(overrides: Record<string, unknown> = {}) {
  const agentExploreEvidenceRefs = ref(["ev-alpha", "ev-beta"]);
  const agentExploreForm = ref({
    query: "form fallback query",
    modelAlias: "form-model",
    contextProfileId: "context-32k",
    thinkingMode: "default",
    temperature: 0.2,
    maxTokens: 1000,
    maxIterations: 3,
    limit: 8,
    toolChoice: "auto",
    workspaceId: "",
  });
  const agentExploreResult = ref({
    answer: "结论正文",
    workspace: { workspaceId: "workspace-1" },
    run: {
      runId: "run-1",
      status: "completed",
      completedAt: "2026-06-04T10:11:12+08:00",
      input: {
        query: "run query",
        modelAlias: "spark",
        contextProfileId: "context-128k",
      },
    },
  });
  const agentExploreRunInput = ref({ query: "export query" });
  const error = ref("previous error");
  const recordFeedback = vi.fn();

  const merged = {
    agentExploreEvidenceRefs,
    agentExploreForm,
    agentExploreResult,
    agentExploreRunInput,
    error,
    recordFeedback,
    agentExploreContextBuildRecordId: () => "context-build-1",
    currentAgentExploreQuery: () => "current query",
    ...overrides,
  } as any;

  return {
    ...merged,
    controller: createConsoleAgentExploreDocumentController(merged),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T10:20:30+08:00"));
  copyTextToClipboardMock.mockReset();
  downloadTextFileMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("console agent explore document controller extra coverage", () => {
  it("builds markdown from run metadata, workspace, answer, and evidence refs", () => {
    const { controller } = createController();

    expect(controller.agentExploreDocumentMarkdown.value).toContain("# 智能检索结果");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 问题：run query");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 模型：spark");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 上下文：context-128k");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 状态：completed");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- Run：run-1");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- Workspace：workspace-1");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 生成时间：2026-06-04 10:11:12");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("结论正文");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("1. `ev-alpha`");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("2. `ev-beta`");
  });

  it("falls back to form fields, generated timestamps, unknown status, and empty citations", () => {
    const { controller } = createController({
      agentExploreEvidenceRefs: ref([]),
      agentExploreResult: ref({
        answer: "fallback answer",
        run: {
          input: {},
        },
      }),
    });

    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 问题：form fallback query");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 模型：form-model");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 上下文：context-32k");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 状态：unknown");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("- 生成时间：2026-06-04 10:20:30");
    expect(controller.agentExploreDocumentMarkdown.value).toContain("## 引用证据\n\n无");
    expect(controller.agentExploreDocumentMarkdown.value).not.toContain("- Run：");
    expect(controller.agentExploreDocumentMarkdown.value).not.toContain("- Workspace：");
  });

  it("copies markdown and records copy feedback context", async () => {
    copyTextToClipboardMock.mockResolvedValue(undefined);
    const harness = createController();

    await harness.controller.copyAgentExploreDocument();

    expect(copyTextToClipboardMock).toHaveBeenCalledWith(expect.stringContaining("结论正文"));
    expect(harness.recordFeedback).toHaveBeenCalledWith("copy", {
      surface: "agent_explore",
      query: "current query",
      evidenceRefs: ["ev-alpha", "ev-beta"],
      contextBuildRecordId: "context-build-1",
    });
    expect(harness.error.value).toBe("");
  });

  it("reports empty and copy failure states without recording feedback", async () => {
    const emptyHarness = createController({
      agentExploreResult: ref({ answer: "   " }),
    });

    await emptyHarness.controller.copyAgentExploreDocument();

    expect(emptyHarness.error.value).toBe("暂无可复制的智能检索结果。");
    expect(copyTextToClipboardMock).not.toHaveBeenCalled();
    expect(emptyHarness.recordFeedback).not.toHaveBeenCalled();

    copyTextToClipboardMock.mockRejectedValue(new Error("clipboard denied"));
    const failingHarness = createController();

    await failingHarness.controller.copyAgentExploreDocument();

    expect(failingHarness.error.value).toBe("clipboard denied");
    expect(failingHarness.recordFeedback).not.toHaveBeenCalled();
  });

  it("exports markdown with a safe filename and reports empty export states", () => {
    const harness = createController({
      agentExploreRunInput: ref({ query: "Agent / query?" }),
    });

    harness.controller.exportAgentExploreDocument();

    expect(downloadTextFileMock).toHaveBeenCalledWith(
      "Agent-query--2026-06-04-10-20-30.md",
      expect.stringContaining("结论正文\n"),
      "text/markdown;charset=utf-8",
    );
    expect(harness.recordFeedback).toHaveBeenCalledWith("export", {
      surface: "agent_explore",
      query: "Agent / query?",
      evidenceRefs: ["ev-alpha", "ev-beta"],
      contextBuildRecordId: "context-build-1",
    });
    expect(harness.error.value).toBe("");

    const emptyHarness = createController({
      agentExploreResult: ref(null),
    });

    emptyHarness.controller.exportAgentExploreDocument();

    expect(emptyHarness.error.value).toBe("暂无可导出的智能检索结果。");
  });
});
