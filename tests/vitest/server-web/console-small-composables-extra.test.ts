// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleBusyController } from "../../../server-web/composables/console-busy-controller";
import {
  createConsoleKnowledgeSearchPanelStateController,
  createConsoleKnowledgeSearchStateController,
} from "../../../server-web/composables/console-knowledge-search-state-controller";
import { useConsoleDocumentDismissController } from "../../../server-web/composables/console-document-dismiss-controller";
import { ruleAuthoringStatusLabel } from "../../../server-web/composables/console-rule-authoring-display-utils";

const mountedWrappers = [];

function mountDismissHarness(options: {
  active?: { value: boolean };
  root?: { value: HTMLElement | null };
  onDismiss?: () => void;
} = {}) {
  const active = options.active ?? ref(true);
  const root = options.root ?? ref<HTMLElement | null>(null);
  const onDismiss = options.onDismiss ?? vi.fn();

  const Harness = defineComponent({
    name: "DismissHarness",
    setup() {
      useConsoleDocumentDismissController({ active, root, onDismiss });
      return () =>
        h("div", { ref: root, class: "dismiss-harness" }, [
          h("button", { type: "button", class: "dismiss-harness-button" }, "inside"),
        ]);
    },
  });

  const wrapper = mount(Harness, { attachTo: document.body });
  mountedWrappers.push(wrapper);
  return { active, onDismiss, root, wrapper };
}

afterEach(() => {
  while (mountedWrappers.length > 0) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("console small composables extra coverage", () => {
  it("dismisses document interactions only when active and outside the root", async () => {
    const onDismiss = vi.fn();
    const { active, root, wrapper } = mountDismissHarness({ onDismiss });
    const insideButton = wrapper.get(".dismiss-harness-button").element;

    insideButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(2);

    active.value = false;
    await nextTick();

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(2);

    expect(root.value).toBe(wrapper.get(".dismiss-harness").element);
  });

  it("tracks busy keys, prefixes, and computed tail state across mutations", () => {
    const controller = createConsoleBusyController();

    expect(controller.busyKey.value).toBe("");
    expect(controller.isBusy("alpha")).toBe(false);
    expect(controller.isBusyPrefix("alpha")).toBe(false);

    controller.setBusy("alpha");
    expect(controller.isBusy("alpha")).toBe(true);
    expect(controller.isBusyPrefix("a")).toBe(true);
    expect(controller.busyKey.value).toBe("alpha");

    controller.setBusy("beta");
    expect(controller.isBusy("beta")).toBe(true);
    expect(controller.isBusyPrefix("b")).toBe(true);
    expect(controller.busyKey.value).toBe("beta");

    controller.clearBusy("missing");
    expect(controller.busyKey.value).toBe("beta");

    controller.clearBusy("beta");
    expect(controller.isBusy("beta")).toBe(false);
    expect(controller.busyKey.value).toBe("alpha");

    controller.clearBusy("alpha");
    expect(controller.busyKey.value).toBe("");
    expect(controller.isBusyPrefix("a")).toBe(false);

    controller.setBusy("gamma");
    controller.setBusy("delta");
    controller.clearAllBusy();
    expect(controller.busyKey.value).toBe("");
    expect(controller.isBusy("gamma")).toBe(false);
    expect(controller.isBusyPrefix("d")).toBe(false);
  });

  it("initializes knowledge search state and expands or empties responsively", async () => {
    const first = createConsoleKnowledgeSearchStateController();
    const second = createConsoleKnowledgeSearchStateController();

    expect(first.knowledgeSearchForm.value).toEqual({ query: "" });
    expect(first.knowledgeSearchResults.value).toEqual([]);
    expect(first.knowledgeSearchResponse.value).toBeNull();
    expect(first.lastKnowledgeSearchQuery.value).toBe("");

    first.knowledgeSearchForm.value.query = "alpha";
    first.knowledgeSearchResults.value = [{ id: "result-1" } as any];
    first.knowledgeSearchResponse.value = { results: [] } as any;
    first.lastKnowledgeSearchQuery.value = "alpha";

    expect(second.knowledgeSearchForm.value).toEqual({ query: "" });
    expect(second.knowledgeSearchResults.value).toEqual([]);

    const busyKey = ref("");
    const debugTab = ref("overview" as any);
    const selectedEvidence = ref<unknown | null>(null);
    const panel = createConsoleKnowledgeSearchPanelStateController({
      busyKey,
      debugTab,
      knowledgeSearchResults: first.knowledgeSearchResults,
      lastKnowledgeSearchQuery: first.lastKnowledgeSearchQuery,
      selectedEvidence,
    });

    expect(panel.knowledgeSearchExpanded.value).toBe(false);
    expect(panel.knowledgeSearchEmpty.value).toBe(false);

    debugTab.value = "knowledgeRecall";
    expect(panel.knowledgeSearchExpanded.value).toBe(true);
    expect(panel.knowledgeSearchEmpty.value).toBe(false);

    first.knowledgeSearchResults.value = [];
    await nextTick();
    expect(panel.knowledgeSearchEmpty.value).toBe(true);
    expect(panel.knowledgeSearchExpanded.value).toBe(true);

    busyKey.value = "knowledge:search";
    await nextTick();
    expect(panel.knowledgeSearchEmpty.value).toBe(false);
    expect(panel.knowledgeSearchExpanded.value).toBe(true);

    busyKey.value = "";
    first.knowledgeSearchResults.value = [{ id: "result-1" } as any];
    selectedEvidence.value = { id: "evidence-1" };
    await nextTick();
    expect(panel.knowledgeSearchEmpty.value).toBe(false);
    expect(panel.knowledgeSearchExpanded.value).toBe(true);

    debugTab.value = "overview" as any;
    await nextTick();
    expect(panel.knowledgeSearchExpanded.value).toBe(false);
  });

  it("maps rule authoring status labels and falls back for unknown values", () => {
    expect(ruleAuthoringStatusLabel("pending_human_confirmation")).toBe("待人类确认");
    expect(ruleAuthoringStatusLabel("no_rule_needed")).toBe("未触发规则");
    expect(ruleAuthoringStatusLabel("gate_failed")).toBe("门禁未通过");
    expect(ruleAuthoringStatusLabel("template_unavailable")).toBe("模板不可用");
    expect(ruleAuthoringStatusLabel("invalid_input")).toBe("输入无效");
    expect(ruleAuthoringStatusLabel("runtime_unavailable")).toBe("运行时不可用");
    expect(ruleAuthoringStatusLabel("published")).toBe("已发布");

    expect(ruleAuthoringStatusLabel("custom_state")).toBe("custom_state");
    expect(ruleAuthoringStatusLabel("")).toBe("未知");
    expect(ruleAuthoringStatusLabel(null)).toBe("未知");
    expect(ruleAuthoringStatusLabel(0)).toBe("未知");
  });
});
