// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductionHealthView from "../../../server-web/views/admin/ProductionHealthView.vue";

const productionHealthMock = vi.hoisted(() => ({
  loadProductionHealthSnapshot: vi.fn(),
}));

const pageRefreshMock = vi.hoisted(() => ({
  handlers: [] as Array<{
    handler: (detail: Record<string, unknown>) => unknown;
    predicate: (detail: Record<string, unknown>) => boolean;
  }>,
}));

vi.mock("../../../server-web/lib/production-health", () => ({
  loadProductionHealthSnapshot: productionHealthMock.loadProductionHealthSnapshot,
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: vi.fn((predicate, handler) => {
    pageRefreshMock.handlers.push({ predicate, handler });
  }),
}));

const ProductionHealthHeroCardStub = defineComponent({
  name: "ProductionHealthHeroCard",
  props: {
    health: Object,
    loadError: String,
  },
  setup(props) {
    return () =>
      h(
        "section",
        {
          class: "production-health-hero-stub",
          "data-error": props.loadError || "",
          "data-run": (props.health as Record<string, any> | null)?.latestReport?.runId || "",
          "data-status": (props.health as Record<string, any> | null)?.status || "none",
        },
        props.loadError || "hero",
      );
  },
});

const ProductionBaselineCardStub = defineComponent({
  name: "ProductionBaselineCard",
  props: {
    baseline: Object,
    baselineError: String,
  },
  setup(props) {
    return () =>
      h(
        "section",
        {
          class: "production-baseline-stub",
          "data-error": props.baselineError || "",
          "data-status": (props.baseline as Record<string, any> | null)?.status || "none",
        },
        props.baselineError || "baseline",
      );
  },
});

const ProductionCoverageWarningStub = defineComponent({
  name: "ProductionCoverageWarning",
  props: {
    missing: Array,
  },
  setup(props) {
    return () =>
      h(
        "section",
        {
          class: "production-coverage-warning-stub",
          "data-missing": (props.missing || []).join(","),
        },
        "coverage warning",
      );
  },
});

function countStub(name: string, propName: string) {
  return defineComponent({
    name,
    props: {
      [propName]: Array,
    },
    setup(props) {
      return () =>
        h(
          "section",
          {
            class: `${name}-stub`,
            "data-count": String(((props as Record<string, any>)[propName] || []).length),
          },
          name,
        );
    },
  });
}

const ProductionSectionGridStub = countStub("ProductionSectionGrid", "sections");
const ProductionGateTableStub = countStub("ProductionGateTable", "gates");

const ProductionHealthBottomGridStub = defineComponent({
  name: "ProductionHealthBottomGrid",
  props: {
    actions: Array,
    history: Array,
  },
  setup(props) {
    return () =>
      h(
        "section",
        {
          class: "ProductionHealthBottomGrid-stub",
          "data-actions": String((props.actions || []).length),
          "data-history": String((props.history || []).length),
        },
        "ProductionHealthBottomGrid",
      );
  },
});

const mounted: VueWrapper[] = [];

function makeHealth(overrides: Record<string, unknown> = {}) {
  return {
    actions: [{ command: "npm run test:unit-coverage:scan", id: "coverage", label: "Coverage" }],
    coverage: { missing: ["server", "server-web"] },
    gates: [{ id: "coverage.unit-threshold" }],
    generatedAt: "2026-06-04T10:00:00.000Z",
    history: [{ generatedAt: "2026-06-04T09:00:00.000Z", runId: "previous", status: "pass" }],
    latestReport: {
      git: { branch: "main", commit: "abcdef1234567890", dirtyFileCount: 2 },
      generatedAt: "2026-06-04T10:00:00.000Z",
      runId: "run-a",
    },
    sections: [{ id: "unit", label: "Unit" }],
    status: "fail",
    summary: { blockedP0: 1, fail: 1, pass: 2, timeout: 0 },
    ...overrides,
  };
}

function makeBaseline(overrides: Record<string, unknown> = {}) {
  return {
    boundaries: { externalState: "contract-mode adapters" },
    mcpOutlets: ["documentParser"],
    ports: [{ implementation: "local", port: "SecretStorePort", verificationMode: "sealed" }],
    protocolVersion: "v0.0.1:platform:baseline-1",
    rootPath: "/tmp/pact-baseline",
    status: "ready",
    storageStates: ["configured"],
    verificationMode: "contract",
    ...overrides,
  };
}

function mountView() {
  const wrapper = mount(ProductionHealthView, {
    global: {
      stubs: {
        ProductionBaselineCard: ProductionBaselineCardStub,
        ProductionCoverageWarning: ProductionCoverageWarningStub,
        ProductionGateTable: ProductionGateTableStub,
        ProductionHealthBottomGrid: ProductionHealthBottomGridStub,
        ProductionHealthHeroCard: ProductionHealthHeroCardStub,
        ProductionSectionGrid: ProductionSectionGridStub,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  productionHealthMock.loadProductionHealthSnapshot.mockReset();
  pageRefreshMock.handlers = [];
});

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.unmount();
  }
});

describe("ProductionHealthView extra coverage", () => {
  it("loads the production snapshot on mount and registers the matching refresh handler", async () => {
    productionHealthMock.loadProductionHealthSnapshot.mockResolvedValueOnce({
      baseline: makeBaseline(),
      baselineError: "baseline stale",
      health: makeHealth(),
      loadError: "health stale",
    });

    const wrapper = mountView();
    await flushPromises();

    expect(productionHealthMock.loadProductionHealthSnapshot).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".production-health-hero-stub").attributes()).toMatchObject({
      "data-error": "health stale",
      "data-run": "run-a",
      "data-status": "fail",
    });
    expect(wrapper.find(".production-baseline-stub").attributes()).toMatchObject({
      "data-error": "baseline stale",
      "data-status": "ready",
    });
    expect(wrapper.find(".production-coverage-warning-stub").attributes("data-missing")).toBe("server,server-web");
    expect(wrapper.find(".ProductionSectionGrid-stub").attributes("data-count")).toBe("1");
    expect(wrapper.find(".ProductionGateTable-stub").attributes("data-count")).toBe("1");
    expect(wrapper.find(".ProductionHealthBottomGrid-stub").attributes()).toMatchObject({
      "data-actions": "1",
      "data-history": "1",
    });

    expect(pageRefreshMock.handlers).toHaveLength(1);
    expect(pageRefreshMock.handlers[0].predicate({
      adminView: "productionHealth",
      routePath: "/admin/production-health",
      viewId: "admin",
    })).toBe(true);
    expect(pageRefreshMock.handlers[0].predicate({
      adminView: "tools",
      routePath: "/admin/tools",
      viewId: "admin",
    })).toBe(false);
  });

  it("refreshes from the page handler and hides the coverage warning when there are no missing items", async () => {
    productionHealthMock.loadProductionHealthSnapshot
      .mockResolvedValueOnce({
        baseline: makeBaseline(),
        health: makeHealth(),
      })
      .mockResolvedValueOnce({
        baseline: makeBaseline({ status: "missing" }),
        baselineError: "",
        health: makeHealth({
          actions: [],
          coverage: { missing: [] },
          gates: [],
          history: [],
          sections: [],
          status: "pass",
        }),
        loadError: "",
      });

    const wrapper = mountView();
    await flushPromises();
    await pageRefreshMock.handlers[0].handler({
      adminView: "productionHealth",
      routePath: "/admin/production-health",
      viewId: "admin",
    });
    await flushPromises();

    expect(productionHealthMock.loadProductionHealthSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".production-health-hero-stub").attributes("data-status")).toBe("pass");
    expect(wrapper.find(".production-baseline-stub").attributes("data-status")).toBe("missing");
    expect(wrapper.find(".production-coverage-warning-stub").exists()).toBe(false);
    expect(wrapper.find(".ProductionSectionGrid-stub").attributes("data-count")).toBe("0");
    expect(wrapper.find(".ProductionGateTable-stub").attributes("data-count")).toBe("0");
    expect(wrapper.find(".ProductionHealthBottomGrid-stub").attributes()).toMatchObject({
      "data-actions": "0",
      "data-history": "0",
    });
  });

  it("keeps the previous health and baseline when a refresh only returns errors", async () => {
    productionHealthMock.loadProductionHealthSnapshot
      .mockResolvedValueOnce({
        baseline: makeBaseline(),
        health: makeHealth(),
      })
      .mockResolvedValueOnce({
        baselineError: "baseline offline",
        loadError: "health offline",
      });

    const wrapper = mountView();
    await flushPromises();
    await pageRefreshMock.handlers[0].handler({
      adminView: "productionHealth",
      routePath: "/admin/production-health",
      viewId: "admin",
    });
    await flushPromises();

    expect(wrapper.find(".production-health-hero-stub").attributes()).toMatchObject({
      "data-error": "health offline",
      "data-run": "run-a",
    });
    expect(wrapper.find(".production-baseline-stub").attributes()).toMatchObject({
      "data-error": "baseline offline",
      "data-status": "ready",
    });
    expect(wrapper.find(".production-coverage-warning-stub").exists()).toBe(true);
  });
});
