// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import {
  provideKnowledgeView,
  useKnowledgeIngestContext,
  useKnowledgeLibraryContext,
  useKnowledgeMaintenanceContext,
  useKnowledgeRulesContext,
  useKnowledgeViewContext,
  useKnowledgeWordCloudContext,
} from "../../../server-web/composables/knowledgeViewContext";

function makeContext() {
  return {
    ingest: { id: "ingest" },
    library: { id: "library" },
    maintenance: { id: "maintenance" },
    rules: { id: "rules" },
    wordCloud: { id: "word-cloud" },
  } as any;
}

describe("knowledge view context extra coverage", () => {
  it("provides the view context and every scoped child context", () => {
    const context = makeContext();
    const observed: Record<string, unknown> = {};
    const Consumer = defineComponent({
      setup() {
        observed.view = useKnowledgeViewContext();
        observed.ingest = useKnowledgeIngestContext();
        observed.library = useKnowledgeLibraryContext();
        observed.maintenance = useKnowledgeMaintenanceContext();
        observed.rules = useKnowledgeRulesContext();
        observed.wordCloud = useKnowledgeWordCloudContext();
        return () => h("span", "consumer");
      },
    });
    const Host = defineComponent({
      setup() {
        provideKnowledgeView(context);
        return () => h(Consumer);
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.text()).toBe("consumer");
    expect(observed.view).toBe(context);
    expect(observed.ingest).toBe(context.ingest);
    expect(observed.library).toBe(context.library);
    expect(observed.maintenance).toBe(context.maintenance);
    expect(observed.rules).toBe(context.rules);
    expect(observed.wordCloud).toBe(context.wordCloud);
  });

  it("throws explicit errors when contexts are missing", () => {
    expect(() => useKnowledgeViewContext()).toThrow("Knowledge view context is not available");
    expect(() => useKnowledgeIngestContext()).toThrow("Knowledge ingest context is not available");
    expect(() => useKnowledgeLibraryContext()).toThrow("Knowledge library context is not available");
    expect(() => useKnowledgeMaintenanceContext()).toThrow("Knowledge maintenance context is not available");
    expect(() => useKnowledgeRulesContext()).toThrow("Knowledge rules context is not available");
    expect(() => useKnowledgeWordCloudContext()).toThrow("Knowledge word-cloud context is not available");
  });
});
