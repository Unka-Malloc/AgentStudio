// @vitest-environment jsdom
import { defineComponent, h, nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RuntimeDependencyConfigButton from "../../../server-web/components/admin/runtime-downloads/RuntimeDependencyConfigButton.vue";
import type {
  RuntimeDependency,
  RuntimeDependencyConfigurationEntry,
} from "../../../server-web/lib/runtime-dependencies";

const {
  mockLoadError,
  mockLoading,
  mockRefreshRuntimeDependencies,
  mockSaveRuntimeDependencyConfiguration,
  mockDependencyStatusForRow,
} = vi.hoisted(() => {
  const mockLoadError = { value: "" };
  const mockLoading = { value: false };
  const mockRefreshRuntimeDependencies = vi.fn(async () => undefined);
  const mockSaveRuntimeDependencyConfiguration = vi.fn(async () => ({ ok: true }));
  const mockDependencyStatusForRow = vi.fn((item: RuntimeDependency) => item.status);

  return {
    mockLoadError,
    mockLoading,
    mockRefreshRuntimeDependencies,
    mockSaveRuntimeDependencyConfiguration,
    mockDependencyStatusForRow,
  };
});

vi.mock("../../../server-web/composables/runtimeDownloadsViewContext", () => ({
  useRuntimeDownloadsViewContext: () => ({
    dependencyStatusForRow: mockDependencyStatusForRow,
    loadError: mockLoadError,
    loading: mockLoading.value,
    refreshRuntimeDependencies: mockRefreshRuntimeDependencies,
  }),
}));

vi.mock("../../../server-web/lib/runtime-dependencies", async () => {
  const actual = await vi.importActual<typeof import("../../../server-web/lib/runtime-dependencies")>(
    "../../../server-web/lib/runtime-dependencies",
  );

  return {
    ...actual,
    saveRuntimeDependencyConfiguration: mockSaveRuntimeDependencyConfiguration,
  };
});

const mountedWrappers: VueWrapper[] = [];

const ConfigListSummaryBubbleStub = defineComponent({
  name: "ConfigListSummaryBubble",
  props: {
    buttonLabel: String,
    title: String,
  },
  setup(props) {
    return () =>
      h(
        "button",
        {
          class: "config-list-summary-bubble-stub",
          type: "button",
        },
        props.buttonLabel || props.title || "概览",
      );
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: String,
    tone: String,
  },
  setup(props) {
    return () =>
      h(
        "span",
        {
          class: "status-pill-stub",
          "data-tone": props.tone || "",
        },
        props.label || "",
      );
  },
});

function buildEntry(overrides: Partial<RuntimeDependencyConfigurationEntry> & Pick<RuntimeDependencyConfigurationEntry, "key" | "label">) {
  return {
    configured: true,
    editable: true,
    inputType: "text",
    value: "",
    ...overrides,
  };
}

function buildItem(overrides: Partial<RuntimeDependency> = {}): RuntimeDependency {
  return {
    id: "jdk",
    label: "JDK",
    status: "present",
    configuration: [
      {
        kind: "source",
        title: "平台配置",
        entries: [
          buildEntry({
            key: "JAVA_HOME",
            label: "Java 路径",
            inputType: "url",
            value: "https://example.com/jdk",
          }),
          buildEntry({
            key: "MODE",
            label: "模式",
            options: [
              { label: "自动", value: "auto" },
              { label: "手动", value: "manual" },
            ],
            value: "auto",
          }),
          buildEntry({
            key: "NOTES",
            label: "备注",
            inputType: "textarea",
            value: "原始备注",
          }),
          buildEntry({
            key: "REQUIRED",
            label: "必填项",
            configured: false,
            required: true,
            value: "",
          }),
        ],
      },
    ],
    ...overrides,
  };
}

function mountButton(item: RuntimeDependency = buildItem()) {
  const wrapper = mount(RuntimeDependencyConfigButton, {
    attachTo: document.body,
    props: { item },
    global: {
      stubs: {
        ConfigListSummaryBubble: ConfigListSummaryBubbleStub,
        Setting: { template: "<svg aria-hidden=\"true\" />" },
        StatusPill: StatusPillStub,
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

async function flush() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function panel() {
  return document.body.querySelector<HTMLElement>(".config-floating-panel");
}

function buttonByText(text: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

function fieldValue(selector: string) {
  return document.body.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value;
}

async function setFieldValue(selector: string, value: string, eventName = "input") {
  const element = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  expect(element).not.toBeNull();
  if (!element) return;
  element.value = value;
  element.dispatchEvent(new Event(eventName, { bubbles: true }));
  await flush();
}

beforeEach(() => {
  mockLoadError.value = "";
  mockLoading.value = false;
  mockRefreshRuntimeDependencies.mockReset();
  mockRefreshRuntimeDependencies.mockResolvedValue(undefined);
  mockSaveRuntimeDependencyConfiguration.mockReset();
  mockSaveRuntimeDependencyConfiguration.mockResolvedValue({ ok: true });
  mockDependencyStatusForRow.mockReset();
  mockDependencyStatusForRow.mockImplementation((item: RuntimeDependency) => item.status);
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("RuntimeDependencyConfigButton", () => {
  it("opens and closes the panel, and shows the verify loading state", async () => {
    mockLoading.value = true;
    const wrapper = mountButton();

    await wrapper.get(".runtime-dependency-config-button").trigger("click");
    await flush();

    expect(panel()).not.toBeNull();
    expect(panel()?.getAttribute("aria-label")).toBe("JDK 配置");
    expect(panel()?.textContent).toContain("修改平台本地源配置");
    expect(panel()?.textContent).toContain("平台配置");
    expect(panel()?.textContent).toContain("概览");
    expect(panel()?.textContent).toContain("JDK");
    expect(panel()?.textContent).toContain("已存在");
    expect(buttonByText("检测中")?.disabled).toBe(true);

    document.body.querySelector<HTMLButtonElement>(".config-floating-panel-close")?.click();
    await flush();

    expect(panel()).toBeNull();
  });

  it("edits fields, saves them, and resets the draft when reopened", async () => {
    const wrapper = mountButton();

    await wrapper.get(".runtime-dependency-config-button").trigger("click");
    await flush();

    await setFieldValue("#runtime-config-jdk-JAVA_HOME", "https://example.com/new-jdk", "input");
    await setFieldValue("#runtime-config-jdk-MODE", "manual", "change");
    await setFieldValue("#runtime-config-jdk-NOTES", "新的备注", "input");

    const submit = document.body.querySelector<HTMLFormElement>(".runtime-config-form");
    expect(submit).not.toBeNull();
    submit?.requestSubmit();
    await flush();

    expect(mockSaveRuntimeDependencyConfiguration).toHaveBeenCalledWith("jdk", [
      { key: "JAVA_HOME", value: "https://example.com/new-jdk" },
      { key: "MODE", value: "manual" },
      { key: "NOTES", value: "新的备注" },
      { key: "REQUIRED", value: "" },
    ]);
    expect(mockRefreshRuntimeDependencies).toHaveBeenCalledWith({ silent: true });
    expect(panel()?.textContent).toContain("配置已保存。");
    expect(buttonByText("保存配置")).not.toBeNull();

    document.body.querySelector<HTMLButtonElement>(".config-floating-panel-close")?.click();
    await flush();
    expect(panel()).toBeNull();

    await wrapper.get(".runtime-dependency-config-button").trigger("click");
    await flush();

    expect(fieldValue("#runtime-config-jdk-JAVA_HOME")).toBe("https://example.com/jdk");
    expect(fieldValue("#runtime-config-jdk-MODE")).toBe("auto");
    expect(fieldValue("#runtime-config-jdk-NOTES")).toBe("原始备注");
  });

  it("shows save failures and recovers from them after a later success", async () => {
    const saveError = new Error("保存失败");
    mockSaveRuntimeDependencyConfiguration.mockRejectedValueOnce(saveError);

    const wrapper = mountButton();

    await wrapper.get(".runtime-dependency-config-button").trigger("click");
    await flush();

    await setFieldValue("#runtime-config-jdk-MODE", "manual", "change");
    document.body.querySelector<HTMLFormElement>(".runtime-config-form")?.requestSubmit();
    await flush();

    expect(mockSaveRuntimeDependencyConfiguration).toHaveBeenCalledTimes(1);
    expect(panel()?.textContent).toContain("保存失败");
    expect(buttonByText("保存中")).toBeUndefined();

    mockLoadError.value = "检测失败";
    await wrapper.get(".runtime-dependency-config-button").trigger("click");
    await flush();

    buttonByText("重新检测")?.click();
    await flush();

    expect(mockRefreshRuntimeDependencies).toHaveBeenCalledWith({ silent: true });
    expect(panel()?.textContent).toContain("检测失败");

    mockLoadError.value = "";
    buttonByText("重新检测")?.click();
    await flush();

    expect(panel()?.textContent).toContain("已重新检测运行时配置。");
  });

  it("renders the empty state and disables save when there are no editable entries", async () => {
    const wrapper = mountButton(
      buildItem({
        configuration: [],
      }),
    );

    await wrapper.get(".runtime-dependency-config-button").trigger("click");
    await flush();

    expect(panel()?.textContent).toContain("暂无配置项");
    expect(panel()?.textContent).toContain("当前运行时未返回配置字段。");
    expect(buttonByText("保存配置")?.disabled).toBe(true);
  });
});
