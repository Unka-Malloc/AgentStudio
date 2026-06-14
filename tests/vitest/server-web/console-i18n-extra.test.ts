// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { consoleDynamicCountPatternPairs } from "../../../server-web/i18n/console-dynamic-count-patterns";
import { applyConsolePattern } from "../../../server-web/i18n/console-dynamic-patterns";
import type { ConsolePatternContext } from "../../../server-web/i18n/console-dynamic-pattern-types";
import { consoleDynamicStatusPatternPairs } from "../../../server-web/i18n/console-dynamic-status-patterns";
import { installConsoleDomLocalizer } from "../../../server-web/i18n/console-dom-localizer";
import { currentConsoleLocale, setConsoleLocaleState } from "../../../server-web/i18n/console-locale-state";
import { localizeConsoleText } from "../../../server-web/i18n/console-text-localizer";

const patternContext: ConsolePatternContext = {
  translateDynamicConsoleName(value, locale) {
    if (locale === "en" && value === "知识库") {
      return "Knowledge Base";
    }
    if (locale === "zh-CN" && value === "Knowledge Base") {
      return "知识库";
    }
    return value;
  },
  localizeConsoleText(text, locale) {
    return localizeConsoleText(text, locale);
  },
};

const fakeMatch = [
  "",
  "知识库",
  "7",
  "2",
  "2026-06-04 18:00",
] as unknown as RegExpMatchArray;

const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

beforeEach(() => {
  document.body.innerHTML = "";
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn() as typeof window.cancelAnimationFrame;
  setConsoleLocaleState("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
  window.requestAnimationFrame = originalRequestAnimationFrame;
  window.cancelAnimationFrame = originalCancelAnimationFrame;
  setConsoleLocaleState("zh-CN");
});

describe("console dynamic i18n patterns", () => {
  it("executes every count pattern in both directions", () => {
    expect(consoleDynamicCountPatternPairs.length).toBeGreaterThan(30);

    for (const pair of consoleDynamicCountPatternPairs) {
      expect(pair.en(fakeMatch, patternContext)).toEqual(expect.any(String));
      expect(pair.zhBack(fakeMatch, patternContext)).toEqual(expect.any(String));
    }

    expect(applyConsolePattern("12 个账号", "en", patternContext)).toBe("12 accounts");
    expect(applyConsolePattern("3 sessions / 9 records", "zh-CN", patternContext)).toBe("3 个会话 / 9 条记录");
    expect(applyConsolePattern("没有匹配", "en", patternContext)).toBe("没有匹配");
  });

  it("executes every status pattern in both directions", () => {
    expect(consoleDynamicStatusPatternPairs.length).toBeGreaterThan(20);

    for (const pair of consoleDynamicStatusPatternPairs) {
      expect(pair.en(fakeMatch, patternContext)).toEqual(expect.any(String));
      expect(pair.zhBack(fakeMatch, patternContext)).toEqual(expect.any(String));
    }

    expect(applyConsolePattern("知识库 未正常运行", "en", patternContext)).toBe(
      "Knowledge Base is not running normally",
    );
    expect(applyConsolePattern("Knowledge Base recovered", "zh-CN", patternContext)).toBe("知识库 已恢复");
    expect(applyConsolePattern("活跃 · 刷新中", "en", patternContext)).toBe("Active · Refreshing");
  });

  it("localizes exact phrases, dynamic text, segments, and preserves whitespace", () => {
    expect(localizeConsoleText("  刷新  ", "en")).toBe("  Refresh  ");
    expect(localizeConsoleText("Pending Approval", "zh-CN")).toBe("待审批");
    expect(localizeConsoleText("待审批 5", "en")).toBe("Pending approvals 5");
    expect(localizeConsoleText("已恢复", "en")).toBe("Recovered");
    expect(localizeConsoleText("警告", "en")).toBe("Warning");
    expect(localizeConsoleText("2 项严重", "en")).toBe("2 critical");
    expect(localizeConsoleText("1 项警告", "en")).toBe("1 warning");
    expect(localizeConsoleText("2 项已恢复待确认", "en")).toBe("2 recovered pending acknowledgment");
    expect(localizeConsoleText("智能对话", "en")).toBe("AI Chat");
    expect(localizeConsoleText("人工配置", "en")).toBe("Manual Config");
    expect(localizeConsoleText("展开全部", "en")).toBe("Show All");
    expect(localizeConsoleText("已隐藏 15 条低频维护项。", "en")).toBe(
      "15 low-frequency maintenance items hidden.",
    );
    expect(localizeConsoleText("已隐藏 15 条低频维护项.", "en")).toBe(
      "15 low-frequency maintenance items hidden.",
    );
    expect(localizeConsoleText("当前没有需要人工处理的审批事项。", "en")).toBe(
      "No approval items require manual review.",
    );
    expect(localizeConsoleText("输入问题，信息流会并行对比原文检索和智能规划。", "en")).toBe(
      "Enter a question. Feed will compare source retrieval and intelligent planning in parallel.",
    );
    expect(localizeConsoleText("继续追问当前信息流结果。", "en")).toBe(
      "Ask a follow-up about the current feed result.",
    );
    expect(localizeConsoleText("production claim 维持阻断状态。", "en")).toBe(
      "production claim remains blocked.",
    );
    expect(localizeConsoleText("missing · 未生成", "en")).toBe("missing · Not Generated");
    expect(localizeConsoleText("未加载协议能力", "en")).toBe("Protocol capabilities not loaded");
    expect(localizeConsoleText("Running 4, queued 2", "zh-CN")).toBe("运行中 4，排队 2");
    expect(localizeConsoleText("知识库配置：刷新中。", "en")).toBe("Knowledge Settings: 刷新中.");
    expect(localizeConsoleText("Already English", "zh-CN")).toBe("Already English");

    setConsoleLocaleState("en");
    expect(currentConsoleLocale.value).toBe("en");
    setConsoleLocaleState("zh-CN");
    expect(currentConsoleLocale.value).toBe("zh-CN");
  });
});

describe("console DOM localizer", () => {
  it("returns a no-op localizer when DOM observation is unavailable", () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("MutationObserver", undefined);

    const localizer = installConsoleDomLocalizer(() => "en");
    expect(() => localizer.refresh()).not.toThrow();
    expect(() => localizer.disconnect()).not.toThrow();

    vi.stubGlobal("document", originalDocument);
    vi.stubGlobal("MutationObserver", originalMutationObserver);
  });

  it("refreshes text nodes and translatable attributes while skipping raw content", () => {
    document.body.innerHTML = `
      <main>
        <button title="刷新" aria-label="保存" data-tooltip="待审批 2" data-label="状态">刷新中</button>
        <img alt="知识库" />
        <input placeholder="添加目录" />
        <pre>刷新</pre>
        <code>保存</code>
        <textarea placeholder="例如：生成一个黄金规则，完全一样的知识直接跳过">待审批</textarea>
        <div data-i18n-skip>知识库</div>
        <p class="markdown-body">保存</p>
      </main>
    `;

    const localizer = installConsoleDomLocalizer(() => "en");
    localizer.refresh();

    const button = document.querySelector("button")!;
    expect(button.textContent).toBe("Refreshing");
    expect(button.getAttribute("title")).toBe("Refresh");
    expect(button.getAttribute("aria-label")).toBe("Save");
    expect(button.getAttribute("data-tooltip")).toBe("Pending approvals 2");
    expect(button.getAttribute("data-label")).toBe("Status");
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("Knowledge Base");
    expect(document.querySelector("input")?.getAttribute("placeholder")).toBe("Add Directory");
    expect(document.querySelector("pre")?.textContent).toBe("刷新");
    expect(document.querySelector("code")?.textContent).toBe("保存");
    expect(document.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      "Example: create a golden rule that skips identical knowledge.",
    );
    expect(document.querySelector("textarea")?.textContent).toBe("待审批");
    expect(document.querySelector("[data-i18n-skip]")?.textContent).toBe("知识库");
    expect(document.querySelector(".markdown-body")?.textContent).toBe("保存");

    localizer.disconnect();
  });

  it("guards overlapping refreshes and ignores skipped root or non-element nodes", async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof window.requestAnimationFrame;
    document.body.innerHTML = "<section><button>刷新</button></section>";

    const localizer = installConsoleDomLocalizer(() => "en");
    localizer.refresh();
    document.body.appendChild(document.createComment("刷新"));
    await Promise.resolve();

    expect(rafCallbacks).toHaveLength(1);
    expect(document.querySelector("button")?.textContent).toBe("刷新");

    rafCallbacks.splice(0).forEach((callback) => callback(0));
    expect(document.querySelector("button")?.textContent).toBe("Refresh");

    const pre = document.createElement("pre");
    pre.textContent = "保存";
    document.body.appendChild(pre);
    document.body.appendChild(document.createComment("待审批"));
    await Promise.resolve();

    expect(pre.textContent).toBe("保存");
    localizer.disconnect();
  });

  it("localizes added nodes, character data, and attributes through the observer", async () => {
    document.body.innerHTML = "<section></section>";
    const localizer = installConsoleDomLocalizer(() => "en");
    const section = document.querySelector("section")!;
    const paragraph = document.createElement("p");

    section.appendChild(paragraph);
    paragraph.textContent = "待审批 3";
    paragraph.setAttribute("title", "刷新");
    await Promise.resolve();

    expect(paragraph.textContent).toBe("Pending approvals 3");
    expect(paragraph.getAttribute("title")).toBe("Refresh");

    paragraph.firstChild!.nodeValue = "知识库 未正常运行";
    await Promise.resolve();
    expect(paragraph.textContent).toBe("Knowledge Base is not running normally");

    localizer.disconnect();
  });
});
