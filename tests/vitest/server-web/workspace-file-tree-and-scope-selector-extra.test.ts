// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import ScopeSelector from "../../../server-web/components/ScopeSelector.vue";
import WorkspaceFileTree from "../../../server-web/components/WorkspaceFileTree.vue";
import type { ToolManagementScope } from "../../../server-web/lib/types/tool-management";

type MountedWrapper = VueWrapper;
const mounted: MountedWrapper[] = [];

afterEach(() => {
  while (mounted.length) {
    mounted.pop()?.unmount();
  }
});

function nodeName(node: MountedWrapper): string {
  return node.find(".tree-node-name").text();
}

function rowByName(wrapper: MountedWrapper, name: string): MountedWrapper | undefined {
  return wrapper.findAll(".tree-node").find((node) => nodeName(node) === name);
}

function nodeSizeText(wrapper: MountedWrapper, name: string): string {
  return rowByName(wrapper, name)?.find(".tree-node-size").text() ?? "";
}

describe("WorkspaceFileTree", () => {
  it("renders empty state when files are empty", () => {
    const wrapper = mount(WorkspaceFileTree, {
      props: {
        files: [],
      },
    });
    mounted.push(wrapper);

    expect(wrapper.find(".empty-tree").exists()).toBe(true);
    expect(wrapper.text()).toContain("该工作空间没有文件。");
    expect(wrapper.findAll(".tree-node").length).toBe(0);
  });

  it("builds tree nodes, formats size, and expands/collapses folders", async () => {
    const wrapper = mount(WorkspaceFileTree, {
      props: {
        files: [
          { relativePath: "src", name: "src", type: "directory", sizeBytes: 0 },
          { relativePath: "src/app.ts", name: "app.ts", type: "file", sizeBytes: 1200 },
          { relativePath: "src/components", name: "components", type: "directory", sizeBytes: 0 },
          { relativePath: "src/components/index.ts", name: "index.ts", type: "file", sizeBytes: 2048 * 2 },
          { relativePath: "docs", name: "docs", type: "directory", sizeBytes: 0 },
          { relativePath: "docs/old/guide.md", name: "guide.md", type: "file", sizeBytes: 1536 },
          { relativePath: "assets", name: "assets", type: "directory", sizeBytes: 0 },
          { relativePath: "assets/logo.png", name: "logo.png", type: "file", sizeBytes: 256 },
          { relativePath: "CHANGELOG.md", name: "CHANGELOG.md", type: "file", sizeBytes: 0 },
        ],
      },
    });
    mounted.push(wrapper);

    const allRows = () => wrapper.findAll(".tree-node").map(nodeName);

    expect(allRows()).toEqual([
      "assets",
      "logo.png",
      "docs",
      "old",
      "src",
      "components",
      "app.ts",
      "CHANGELOG.md",
    ]);

    expect(wrapper.findAll(".tree-node.is-dir").length).toBe(5);
    expect(nodeSizeText(wrapper, "assets")).toBe("");
    expect(nodeSizeText(wrapper, "logo.png")).toBe("256 B");
    expect(nodeSizeText(wrapper, "app.ts")).toBe("1.2 KB");

    const srcRow = rowByName(wrapper, "src");
    const oldRow = rowByName(wrapper, "old");
    expect(srcRow).toBeDefined();
    expect(oldRow).toBeDefined();

    await srcRow!.trigger("click");
    expect(allRows()).toEqual([
      "assets",
      "logo.png",
      "docs",
      "old",
      "src",
      "CHANGELOG.md",
    ]);

    await srcRow!.trigger("click");
    expect(allRows().includes("components")).toBe(true);
    expect(allRows().includes("app.ts")).toBe(true);

    await oldRow!.trigger("click");
    expect(allRows().includes("guide.md")).toBe(true);
  });

  it("orders directories before files and keeps size units consistent", async () => {
    const wrapper = mount(WorkspaceFileTree, {
      props: {
        files: [
          { relativePath: "alpha", name: "alpha", type: "directory", sizeBytes: 0 },
          { relativePath: "alpha/readme.txt", name: "readme.txt", type: "file", sizeBytes: 12 },
          { relativePath: "alpha/zeta", name: "zeta", type: "directory", sizeBytes: 0 },
          { relativePath: "alpha/zeta/info.txt", name: "info.txt", type: "file", sizeBytes: 1024 },
          { relativePath: "alpha/file-root.txt", name: "file-root.txt", type: "file", sizeBytes: 1024 * 1024 + 1 },
        ],
      },
    });
    mounted.push(wrapper);

    const rows = wrapper.findAll(".tree-node").map(nodeName);
    const alphaIndex = rows.indexOf("alpha");
    const zetaIndex = rows.indexOf("zeta");
    const readmeIndex = rows.indexOf("readme.txt");
    const rootFileIndex = rows.indexOf("file-root.txt");

    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zetaIndex).toBeGreaterThan(alphaIndex);
    expect(readmeIndex).toBeGreaterThan(alphaIndex);
    expect(zetaIndex).toBeLessThan(readmeIndex);
    expect(rootFileIndex).toBeGreaterThanOrEqual(0);

    expect(nodeSizeText(wrapper, "readme.txt")).toBe("12 B");
    expect(nodeSizeText(wrapper, "file-root.txt")).toBe("1.0 MB");

    const zetaRow = rowByName(wrapper, "zeta");
    expect(zetaRow).toBeDefined();
    await zetaRow!.trigger("click");
    expect(nodeSizeText(wrapper, "info.txt")).toBe("1.0 KB");
  });
});

describe("ScopeSelector", () => {
  const scopes: ToolManagementScope[] = [
    {
      id: "knowledge:read",
      label: "Knowledge Read",
      description: "Read knowledge records",
    },
    {
      id: "knowledge:write",
      label: "Knowledge Write",
      description: "Write knowledge records",
    },
    {
      id: "workspace:read",
      label: "Workspace Read",
      description: "Read workspace metadata",
    },
    {
      id: "agent:operate",
      label: "Agent Operate",
      description: "Operate agent tools",
    },
    {
      id: "other:admin",
      label: "Other Admin",
      description: "Administration actions",
    },
    {
      id: ":orphan",
      label: "Orphan Scope",
      description: "No explicit category",
    },
  ];

  it("renders groups in deterministic order with expected category labels", () => {
    const wrapper = mount(ScopeSelector, {
      props: {
        modelValue: [],
        scopes,
      },
    });
    mounted.push(wrapper);

    const categoryHeaders = wrapper.findAll(".config-fold-title").map((title) => title.text());
    expect(categoryHeaders).toEqual([
      "智能体 (Agent)",
      "知识库 (Knowledge)",
      "Other",
      "工作空间 (Workspace)",
      "其它",
    ]);
  });

  it("toggles a single scope chip and emits the updated model", async () => {
    const wrapper = mount(ScopeSelector, {
      props: {
        modelValue: ["knowledge:read"],
        scopes,
      },
    });
    mounted.push(wrapper);

    const writeChip = wrapper
      .findAll(".scope-chip")
      .find((chip) => chip.find("strong").text() === "Knowledge Write");
    expect(writeChip).toBeDefined();
    await writeChip!.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["knowledge:read", "knowledge:write"]]);

    await wrapper.setProps({ modelValue: ["knowledge:read", "knowledge:write"] });
    await writeChip!.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[1]).toEqual([["knowledge:read"]]);
  });

  it("toggles an entire category with one-click select/clear actions", async () => {
    const wrapper = mount(ScopeSelector, {
      props: {
        modelValue: ["knowledge:read"],
        scopes,
      },
    });
    mounted.push(wrapper);

    const categoryHeaders = wrapper.findAll(".config-fold-title").map((title) => title.text());
    const knowledgeCategoryIndex = categoryHeaders.findIndex((title) => title === "知识库 (Knowledge)");
    const knowledgeAction = wrapper.findAll(".tool-button-ghost")[knowledgeCategoryIndex];
    expect(knowledgeAction.text()).toBe("一键全选");

    await knowledgeAction.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["knowledge:read", "knowledge:write"]]);

    await wrapper.setProps({
      modelValue: ["knowledge:read", "knowledge:write"],
    });

    const clearLabel = wrapper.findAll(".tool-button-ghost")[knowledgeCategoryIndex];
    expect(clearLabel.text()).toBe("取消全选");

    await clearLabel.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[1]).toEqual([[]]);
  });

  it("does not emit when disabled and still renders disabled controls", async () => {
    const wrapper = mount(ScopeSelector, {
      props: {
        modelValue: ["knowledge:read"],
        scopes,
        disabled: true,
      },
    });
    mounted.push(wrapper);

    const writeChip = wrapper.findAll(".scope-chip").find((chip) => chip.find("strong").text() === "Knowledge Write");
    const categoryButton = wrapper.find(".scope-selector .tool-button-ghost");

    await writeChip!.trigger("click");
    await categoryButton.trigger("click");

    expect(writeChip!.attributes("disabled")).toBeDefined();
    expect(categoryButton.attributes("disabled")).toBeDefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("shows id instead of description in compact mode", () => {
    const wrapper = mount(ScopeSelector, {
      props: {
        modelValue: ["knowledge:read", "knowledge:write"],
        compact: true,
        scopes,
      },
    });
    mounted.push(wrapper);

    const knowledgeChip = wrapper
      .findAll(".scope-chip")
      .find((chip) => chip.find("strong").text() === "Knowledge Read");
    expect(knowledgeChip).toBeDefined();
    expect(knowledgeChip!.text()).toContain("knowledge:read");
    expect(knowledgeChip!.text()).not.toContain("Read knowledge records");
    expect(knowledgeChip!.classes("active")).toBe(true);
  });
});
