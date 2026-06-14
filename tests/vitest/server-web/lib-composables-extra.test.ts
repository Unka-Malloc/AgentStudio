// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  adminSectionToSlug,
  isExternalServiceRouteTab,
  isKnowledgeRouteTab,
  knowledgeRouteTabToViewTab,
  slugToAdminView,
  viewToPath,
} from "../../../server-web/router/routes";
import {
  browserLocationOrigin,
  browserUrlBase,
  navigateBrowserHashRoute,
  normalizeBrowserHashRoute,
  openBrowserPopup,
  parseBrowserRelativeUrl,
  readBrowserLocalStorageItem,
  writeBrowserLocalStorageItem,
} from "../../../server-web/lib/browser-window";
import {
  readBrowserJsonRecord,
  readBrowserJsonStorage,
  writeBrowserJsonStorage,
} from "../../../server-web/lib/browser-storage";
import {
  analysisExecutionModeLabel,
  analysisModuleDescriptionForModule,
  backgroundProcessLabel,
  backgroundProcessTone,
  clientRuntimeCoolingLabel,
  clientRuntimeCoolingTone,
  clientRuntimeHeatStyle,
  clientRuntimeReasonLabel,
  clientRuntimeSurfaceText,
  clientRuntimeTaskText,
  maintenanceAgentRiskLabel,
  maintenanceAgentStatusLabel,
  maintenanceAgentStatusTone,
  monitorAlertSeverityLabel,
  monitorAlertSeverityTone,
  processRelationText,
  processTypeLabel,
  queueLifecycleLabel,
  queueLifecycleTone,
  queueMonitorDetail,
  queueSourceLabel,
  migrationProgress,
  migrationTone,
} from "../../../server-web/composables/console-status-utils";
import { moduleCapabilityText, moduleStatusText } from "../../../server-web/composables/console-runtime-module-display-utils";
import { compactLogDetail, genericStatusTone, stateProgressPercent } from "../../../server-web/composables/console-system-log-row-utils";
import { jobElapsed, splitJobStatusLabel } from "../../../server-web/composables/console-job-display-utils";
import {
  autoAbsorbWordCloudTerms,
  cloneWordCloudSet,
  createDefaultWordCloudSet,
  findWordCloudInTree,
  flattenWordCloudCards,
  formatWordCloudThreshold,
  isWordCloudTailCard,
  normalizeWordCloudCorpusPathForUi,
  normalizeWordCloudCorpusPathsForUi,
  normalizeWordCloudSetForUi,
  normalizeWordCloudTermForUi,
  normalizeWordCloudThreshold,
  wordCloudTermIdentity,
} from "../../../server-web/composables/console-word-cloud-utils";
import * as rendering from "../../../server-web/lib/rendering";
import { errorMessage } from "../../../server-web/lib/errors";

describe("server-web route helpers", () => {
  it("normalizes route maps and slugs", () => {
    expect(isKnowledgeRouteTab("distillation")).toBe(true);
    expect(isKnowledgeRouteTab("chunking")).toBe(true);
    expect(isKnowledgeRouteTab("random")).toBe(false);
    expect(knowledgeRouteTabToViewTab("maintenance")).toBe("maintenance");
    expect(knowledgeRouteTabToViewTab("distillation")).toBe("management");
    expect(knowledgeRouteTabToViewTab("missing")).toBeNull();

    expect(isExternalServiceRouteTab("list")).toBe(true);
    expect(isExternalServiceRouteTab("other")).toBe(false);

    expect(viewToPath("admin", { adminSection: "toolList" })).toBe("/admin/tool-list");
    expect(viewToPath("debug", { tab: "agentRetrieval" })).toBe("/debug/agentRetrieval");
    expect(viewToPath("externalServices")).toBe("/external-services/list");
    expect(viewToPath("knowledge", { tab: "" })).toBe("/knowledge/");
  });

  it("maps admin slugs in both directions with safe fallbacks", () => {
    expect(adminSectionToSlug("toolList")).toBe("tool-list");
    expect(adminSectionToSlug("agentPermissions")).toBe("agent-permissions");
    expect(adminSectionToSlug("missing")).toBe("storage");

    expect(slugToAdminView("tool-stats")).toBe("toolStats");
    expect(slugToAdminView("agent-permissions")).toBe("agentPermissions");
    expect(slugToAdminView("unknown")).toBe("storage");
  });
});

describe("browser window helpers", () => {
  it("normalizes routes and hash navigation", () => {
    expect(normalizeBrowserHashRoute("")).toBe("/");
    expect(normalizeBrowserHashRoute("#/runtime")).toBe("/runtime");
    expect(normalizeBrowserHashRoute("runtime")).toBe("/runtime");

    const ok = navigateBrowserHashRoute("/runtime");
    expect(ok).toBe(true);
    expect(window.location.hash).toBe("#/runtime");
  });

  it("parses and formats browser URL helpers", () => {
    expect(browserLocationOrigin("https://fallback")).toContain("http://localhost:");
    expect(browserUrlBase("https://fallback")).toContain("http://localhost:");

    const parsed = parseBrowserRelativeUrl("dashboard");
    expect(parsed.toString()).toContain("/dashboard");
    expect(parsed.origin).toContain("http://localhost:");
  });

  it("reads and writes browser localStorage and popup", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue("popup" as unknown as Window);

    expect(readBrowserLocalStorageItem("none")).toBeNull();
    expect(writeBrowserLocalStorageItem("route-helper", "value")).toBe(true);
    expect(readBrowserLocalStorageItem("route-helper")).toBe("value");
    expect(openBrowserPopup("https://example.com", "console")).toBe("popup");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "console", undefined);

    expect(openBrowserPopup("", "_blank")).toBeNull();
  });
});

describe("browser json storage helpers", () => {
  it("reads, normalizes and writes json entries", () => {
    window.localStorage.clear();
    window.localStorage.setItem("record", JSON.stringify({ name: "Alice", nested: { score: 10 } }));
    window.localStorage.setItem("primitive", JSON.stringify(7));

    expect(readBrowserJsonRecord("record")).toEqual({ name: "Alice", nested: { score: 10 } });
    expect(readBrowserJsonRecord("primitive")).toEqual({});
    expect(readBrowserJsonStorage("broken", {}, () => null)).toEqual({});
    window.localStorage.setItem("broken", "{not json");
    expect(readBrowserJsonStorage("broken", { fallback: true }, () => ({ fallback: true }))).toEqual({
      fallback: true,
    });

    expect(writeBrowserJsonStorage("record", { enabled: true })).toBe(true);
    expect(window.localStorage.getItem("record")).toBe('{"enabled":true}');
  });

  it("returns false when json write fails", () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("no-storage");
      },
    };
    expect(writeBrowserJsonStorage("x", { value: 1 }, throwingStorage as any)).toBe(false);
  });
});

describe("console-status-utils", () => {
  it("maps queue lifecycle status and details", () => {
    expect(queueLifecycleTone("Running")).toBe("running");
    expect(queueLifecycleTone("FAILED")).toBe("danger");
    expect(queueLifecycleTone("unknown")).toBe("neutral");

    expect(queueLifecycleLabel("running")).toBe("运行中");
    expect(queueLifecycleLabel("cancelled")).toBe("已取消");
    expect(queueLifecycleLabel("missing")).toBe("missing");
    expect(queueLifecycleLabel("")).toBe("未知");

    expect(queueSourceLabel("function-self-check")).toBe("功能自检");
    expect(queueSourceLabel("")).toBe("队列监控");

    expect(queueMonitorDetail({ kind: "队列", interruptedReason: "", recoveryStatus: "已恢复", metadata: { stage: "导入" } }))
      .toBe("恢复状态 已恢复 · 阶段 导入");
  });

  it("maps maintenance, process, and runtime health statuses", () => {
    expect(maintenanceAgentStatusTone("awaiting_approval")).toBe("queued");
    expect(maintenanceAgentStatusTone("completed_with_errors")).toBe("queued");
    expect(maintenanceAgentStatusTone("running")).toBe("running");
    expect(maintenanceAgentStatusTone("other")).toBe("failed");

    expect(maintenanceAgentStatusLabel("completed_with_errors")).toBe("有错误");
    expect(maintenanceAgentStatusLabel("")).toBe("未知");

    expect(processTypeLabel("daemon")).toBe("守护进程");
    expect(processTypeLabel("other")).toBe("服务进程");

    expect(backgroundProcessTone("degraded")).toBe("warning");
    expect(backgroundProcessTone("running")).toBe("running");
    expect(backgroundProcessTone("standby")).toBe("queued");
    expect(backgroundProcessTone("missing")).toBe("failed");
    expect(backgroundProcessLabel("stale")).toBe("心跳超时");
    expect(backgroundProcessLabel("")).toBe("未知");

    expect(clientRuntimeCoolingTone("hot")).toBe("running");
    expect(clientRuntimeCoolingTone("cooled")).toBe("warning");
    expect(clientRuntimeCoolingTone("warm")).toBe("info");
    expect(clientRuntimeCoolingLabel("cooled")).toBe("已冷却");
    expect(clientRuntimeCoolingLabel("missing")).toBe("missing");
    expect(clientRuntimeReasonLabel("outside-warm-client-limit")).toBe("超出保温上限");
    expect(clientRuntimeReasonLabel("")).toBe("无冷却原因");
    expect(clientRuntimeReasonLabel("unknown")).toBe("unknown");

    expect(clientRuntimeTaskText({ taskTypes: [{ taskType: "search", count: 2 }, { taskType: "summarize", count: 1 }] })).toBe(
      "search×2 / summarize×1",
    );
    expect(clientRuntimeTaskText({ taskTypes: [] })).toBe("无任务记录");
    expect(clientRuntimeSurfaceText({ surfaces: [{ surface: "api", count: 3 }] })).toBe("api×3");
    expect(clientRuntimeSurfaceText({})).toBe("无调用面记录");

    expect(clientRuntimeHeatStyle({ heatPercent: 240 })).toEqual({ "--heat": "100%" });
    expect(clientRuntimeHeatStyle({ heatPercent: 1 })).toEqual({ "--heat": "4%" });
    expect(monitorAlertSeverityTone("warning")).toBe("warning");
    expect(monitorAlertSeverityTone("info")).toBe("running");
    expect(monitorAlertSeverityLabel("warning")).toBe("警告");
    expect(maintenanceAgentRiskLabel("destructive")).toBe("破坏性");
    expect(maintenanceAgentRiskLabel("")).toBe("未知");
    expect(migrationTone("draining")).toBe("draining");
    expect(migrationTone("outdated")).toBe("attention");
    expect(migrationProgress("aligned")).toBe(100);
    expect(migrationProgress("draining")).toBe(68);
    expect(migrationProgress("outdated")).toBe(28);
    expect(migrationProgress("offline")).toBe(0);
    expect(migrationProgress("unknown" as any)).toBe(8);
  });

  it("describes process relations and analysis modes", () => {
    expect(
      processRelationText({
        services: ["svc-a", "svc-b"],
        monitors: ["m1"],
        alerts: ["alert-a", "alert-b"],
        description: "fallback",
      }),
    ).toBe("服务：svc-a / svc-b；监控：m1；报警：alert-a / alert-b");

    expect(analysisExecutionModeLabel("builtIn")).toBe("内置模块");
    expect(analysisExecutionModeLabel("external")).toBe("外置模块");
    expect(analysisExecutionModeLabel("hybrid")).toBe("混合分析");
    expect(analysisExecutionModeLabel("unknown")).toBe("unknown");

    expect(analysisModuleDescriptionForModule(null)).toBe(
      "未发现可用分析模块，将使用内置启发式分析。",
    );
    expect(analysisModuleDescriptionForModule({ id: "builtin:heuristic-hybrid-v1" })).toContain("内置启发式");
    expect(analysisModuleDescriptionForModule({ id: "custom", description: "用户模块" })).toBe("用户模块");
  });
});

describe("console-runtime-module-display-utils", () => {
  it("formats module capability and status texts", () => {
    expect(moduleCapabilityText({ name: "x", label: "x", description: "", modulePath: "", configuredPath: "", runtimeMount: undefined, externalEnabled: true, pathHint: "" })).toBe("未加载运行实例");
    expect(moduleCapabilityText({
      name: "x",
      label: "x",
      description: "",
      modulePath: "",
      configuredPath: "",
      runtimeMount: {
        name: "test",
        id: "id",
        kind: "analysis",
        enabled: true,
        reason: "",
        supportsStructuredDocument: true,
        supportsTextExtraction: false,
        supportsBatchHook: true,
      },
      externalEnabled: true,
      pathHint: "",
    })).toBe("结构化文档 / 批次回调");

    expect(moduleStatusText({
      name: "x",
      label: "x",
      description: "",
      modulePath: "",
      configuredPath: "",
      runtimeMount: undefined,
      externalEnabled: true,
      pathHint: "",
    })).toBe("未加载运行实例");
    expect(moduleStatusText({
      name: "x",
      label: "x",
      description: "",
      modulePath: "",
      configuredPath: "/path/module.mjs",
      runtimeMount: undefined,
      externalEnabled: true,
      pathHint: "",
    })).toBe("等待重载");
    expect(moduleStatusText({
      name: "x",
      label: "x",
      description: "",
      modulePath: "",
      configuredPath: "/path/module.mjs",
      runtimeMount: {
        name: "test",
        id: "id",
        kind: "analysis",
        enabled: false,
        reason: "network",
        supportsStructuredDocument: false,
        supportsTextExtraction: false,
        supportsBatchHook: false,
      },
      externalEnabled: true,
      pathHint: "",
    })).toBe("network");
    expect(moduleStatusText({
      name: "x",
      label: "x",
      description: "",
      modulePath: "",
      configuredPath: "",
      runtimeMount: {
        name: "test",
        id: "id",
        kind: "analysis",
        enabled: true,
        reason: "",
        supportsStructuredDocument: false,
        supportsTextExtraction: false,
        supportsBatchHook: false,
      },
      externalEnabled: false,
      pathHint: "",
    })).toBe("可用");
  });
});

describe("console-system-log-row-utils", () => {
  it("formats compact logs and status helpers", () => {
    expect(compactLogDetail(["", "a", 0, null, " b ", "a"])).toBe("a · 0 · b · a");
    expect(genericStatusTone("Task FAILED quickly")).toBe("danger");
    expect(genericStatusTone("warning-pending")).toBe("warning");
    expect(genericStatusTone("running")).toBe("success");
    expect(stateProgressPercent("queued and pending")).toBe(20);
    expect(stateProgressPercent("critical error")).toBe(0);
  });
});

describe("console-job-display-utils", () => {
  it("formats elapsed time and status labels", () => {
    expect(jobElapsed({
      name: "job",
      status: "running",
      startedAt: "2026-06-04T00:00:00Z",
      updatedAt: "2026-06-04T00:00:30Z",
    } as any)).toBe("30s");
    expect(jobElapsed({
      name: "job",
      status: "running",
      createdAt: "2026-06-04T00:00:00Z",
      updatedAt: "2026-06-04T00:04:00Z",
    } as any)).toBe("4m 0s");
    expect(splitJobStatusLabel("running")).toBe("运行中");
    expect(splitJobStatusLabel(undefined)).toBe("待处理");
  });
});

describe("console-word-cloud-utils", () => {
  it("normalizes terms, paths, and thresholds", () => {
    expect(wordCloudTermIdentity(" Test ")).toBe("test");
    expect(normalizeWordCloudTermForUi({ term: " Alpha ", frequency: -1 })).toEqual({
      term: "Alpha",
      frequency: 0,
      weight: undefined,
    });

    expect(normalizeWordCloudCorpusPathForUi("/tmp/a.txt")).toEqual({
      path: "/tmp/a.txt",
      type: "",
    });
    expect(normalizeWordCloudCorpusPathForUi({ path: "  b  ", type: "file" })).toEqual({
      path: "b",
      type: "file",
    });
    expect(normalizeWordCloudCorpusPathForUi({ path: "  " })).toBeNull();
    expect(normalizeWordCloudCorpusPathsForUi([" A ", { path: "A", type: "file" }, { path: "A", type: "file" }])).toEqual([
      { path: "A", type: "" },
      { path: "A", type: "file" },
    ]);

    expect(normalizeWordCloudThreshold(1.2)).toBe(1);
    expect(normalizeWordCloudThreshold(-0.3)).toBe(0);
    expect(formatWordCloudThreshold("0.333")).toBe("0.33");
  });

  it("clones structures and auto-absorbs compatible terms", () => {
    const source = {
      schemaVersion: "v0.0.1:schema:definition-1",
      wordBagSetId: "set",
      title: "set",
      status: "draft",
      wordBags: [
        {
          wordBagId: "parent",
          label: "Parent",
          relation: "contains",
          absorbThreshold: 0.7,
          terms: [{ term: "existing", frequency: 1 }],
          children: [
            {
              wordBagId: "child",
              label: "Child",
              relation: "overlap",
              terms: [{ term: "other", frequency: 1 }],
            },
          ],
        },
      ],
      unassignedTerms: [{ term: "parent-term", frequency: 2 }],
      corpusPaths: [{ path: "a", type: "file" }],
    };
    const cloned = cloneWordCloudSet(source as any);
    cloned.wordBags[0].label = "Changed";
    expect(source.wordBags[0].label).toBe("Parent");

    const absorbed = autoAbsorbWordCloudTerms(
      source as any,
      { termWithFrequency: (term) => ({ ...term, quality: "auto" }) },
    );
    expect(absorbed).toBe(1);
    expect(source.wordBags[0].terms).toEqual([
      { term: "existing", frequency: 1 },
      { term: "parent-term", frequency: 2, quality: "auto" },
    ]);
    expect(source.unassignedTerms).toEqual([]);
    expect(findWordCloudInTree(source.wordBags as any, "child")).toEqual({
      cloud: expect.objectContaining({ wordBagId: "child" }),
      parent: expect.objectContaining({ wordBagId: "parent" }),
      path: [
        expect.objectContaining({ wordBagId: "parent" }),
        expect.objectContaining({ wordBagId: "child" }),
      ],
    });
    expect(flattenWordCloudCards(source.wordBags as any)).toHaveLength(2);

    expect(
      isWordCloudTailCard({
        wordBagId: "x",
        label: "other",
        terms: [],
      }),
    ).toBe(false);
    expect(
      isWordCloudTailCard({
        wordBagId: "x",
        label: "Default",
        terms: [],
      }),
    ).toBe(true);
  });

  it("normalizes cloud sets with deterministic ids and defaults", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const result = createDefaultWordCloudSet([{ term: "x", frequency: 2, weight: 0.2 }], {
      corpusPaths: ["docs", { path: "file.txt", type: "file" }],
      modelAlias: "agent",
    });
    expect(result.wordBagSetId).toBe("word-cloud-rs");
    expect(result.termsSnapshot).toEqual([{ term: "x", frequency: 2, weight: 0.2 }]);
    expect(result.unassignedTerms).toEqual([{ term: "x", frequency: 2, weight: 0.2 }]);
    expect(normalizeWordCloudSetForUi(result)).toMatchObject({
      modelAlias: "agent",
      corpusPaths: [
        { path: "docs", type: "" },
        { path: "file.txt", type: "file" },
      ],
      termsSnapshot: [{ term: "x", frequency: 2, weight: 0.2 }],
    });
  });
});

describe("rendering helpers", () => {
  it("normalizes charset and decodes bytes safely", () => {
    expect(rendering.normalizeCharset(" UTF-8 ")).toBe("utf-8");
    expect(rendering.normalizeCharset("'us-ascii'")).toBe("windows-1252");
    expect(rendering.escapeRegexText("a+b(c)")).toBe("a\\+b\\(c\\)");
    expect(rendering.base64ToBytes(" YWJj\n")).toEqual([97, 98, 99]);
    expect(rendering.base64ToBytes("not-base64")).toEqual([]);
    expect(rendering.decodeBytes([101, 102, 103], "unknown")).toBe("efg");
  });

  it("formats plain text and headers robustly", () => {
    expect(rendering.plainTextToHtml("a\n\nb\nc")).toBe("<p>a</p>\n<p>b<br />c</p>");
    expect(rendering.emailHeaderValue([["Subject", "Hello"], ["From", "a@b.com"]], "subject")).toBe("Hello");
    expect(rendering.emailHeaderValue([["From", "a@b.com"]], "subject")).toBe("");

    const refMarkdown = "refs: [evidence::A1] and evidence::A1 again";
    expect(rendering.linkifyEvidenceRefsInMarkdown(refMarkdown, ["evidence::A1"])).toContain(
      "[evidence::A1](#pact-evidence-evidence%3A%3AA1)",
    );
    expect(rendering.safeLinkHref("ftp://example.com")).toBe("");
    expect(rendering.safeMediaSrc("/image.png")).toBe("/image.png");
    expect(rendering.safeMediaSrc("//cdn/example.png")).toBe("");
  });
});

describe("errors helper", () => {
  it("extracts message from multiple error shapes", () => {
    expect(errorMessage(new Error("failure"))).toBe("failure");
    expect(errorMessage(" custom ")).toBe(" custom ");
    expect(errorMessage({ message: "" }, "fallback")).toBe("fallback");
    expect(errorMessage({ message: "ok" }, "fallback")).toBe("ok");
    expect(errorMessage(42, "fallback")).toBe("fallback");
  });
});
