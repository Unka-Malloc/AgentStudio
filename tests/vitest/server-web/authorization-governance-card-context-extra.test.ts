// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import {
  createAuthorizationGovernanceCardContext,
  provideAuthorizationGovernanceCardContext,
  useAuthorizationGovernanceCardContext,
} from "../../../server-web/composables/authorizationGovernanceCardContext";

function makePermissionsContext() {
  return {
    authorizationGovernance: { roles: [] },
    authorizationGovernanceEditorBody: "{}",
    authorizationGovernanceEditorKind: "role",
    authorizationGovernanceEditorKinds: [{ label: "Role", value: "role" }],
    authorizationGovernanceEditorStatus: "ready",
    authorizationGovernanceError: "",
    authorizationGovernanceMetrics: { roles: 1 },
    authorizationGovernanceSaving: false,
    ignored: "ignore",
    itemText: (item: unknown) => JSON.stringify(item),
    policyCount: (items: unknown[]) => items.length,
    resetAuthorizationGovernanceEditor: () => undefined,
    saveAuthorizationGovernanceEditor: () => undefined,
    shortList: (items: unknown[]) => items.slice(0, 2),
  } as any;
}

describe("authorization governance card context extra coverage", () => {
  it("creates a narrow card context and provides it", () => {
    const source = makePermissionsContext();
    const context = createAuthorizationGovernanceCardContext(source);
    const observed: Record<string, unknown> = {};
    const Consumer = defineComponent({
      setup() {
        observed.context = useAuthorizationGovernanceCardContext();
        return () => h("span", "governance consumer");
      },
    });
    const Host = defineComponent({
      setup() {
        provideAuthorizationGovernanceCardContext(context);
        return () => h(Consumer);
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.text()).toBe("governance consumer");
    expect(observed.context).toBe(context);
    expect(context.authorizationGovernance).toBe(source.authorizationGovernance);
    expect(context.authorizationGovernanceEditorKinds).toBe(source.authorizationGovernanceEditorKinds);
    expect(context.itemText({ id: "role-a" })).toBe("{\"id\":\"role-a\"}");
    expect(context.policyCount([1, 2, 3])).toBe(3);
    expect(context.shortList([1, 2, 3])).toEqual([1, 2]);
    expect("ignored" in context).toBe(false);
  });

  it("throws an explicit error without a provider", () => {
    expect(() => useAuthorizationGovernanceCardContext()).toThrow(
      "Authorization governance card context is not available",
    );
  });
});
