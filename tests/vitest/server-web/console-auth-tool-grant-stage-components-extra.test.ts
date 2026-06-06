// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsoleAuthUsersPanel from "../../../server-web/components/shell/ConsoleAuthUsersPanel.vue";
import ToolGrantCreateCard from "../../../server-web/components/admin/agent-permissions/ToolGrantCreateCard.vue";
import KnowledgeDistillationStageCard from "../../../server-web/components/knowledge-distillation/KnowledgeDistillationStageCard.vue";

const formatCompactDateMock = vi.hoisted(() => vi.fn((value: string) => `formatted:${value.slice(0, 10)}`));

const shellContext = vi.hoisted(() => ({} as any));

const permissionsContext = vi.hoisted(() => ({} as any));

vi.mock("../../../server-web/composables/console-format-utils", () => ({
  formatCompactDate: formatCompactDateMock,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => shellContext,
}));

vi.mock("../../../server-web/composables/agentPermissionsViewContext", () => ({
  useAgentPermissionsViewContext: () => permissionsContext,
}));

shellContext.authAudit = ref<any[]>([]);
shellContext.authRoleOptionBarOptions = ref([{ label: "管理员", value: "admin" }]);
shellContext.authSessions = ref<any[]>([]);
shellContext.authUsers = ref<any[]>([]);
shellContext.busyKey = ref("");
shellContext.canAdminAuth = ref(false);
shellContext.enabledBooleanOptionBarOptions = ref([
  { label: "启用", value: true },
  { label: "停用", value: false },
]);
shellContext.oidcAllowedDomainsText = ref("");
shellContext.oidcDraft = reactive({
  enabled: false,
  issuer: "",
  clientId: "",
  clientSecret: "",
  redirectUri: "",
});
shellContext.oidcRoleMappingText = ref("");
shellContext.revokeConsoleSession = vi.fn();
shellContext.saveOidcConfig = vi.fn();
shellContext.updateConsoleUser = vi.fn();
shellContext.updateConsoleUserRole = vi.fn();

permissionsContext.busyKey = ref("");
permissionsContext.copyIssuedToolToken = vi.fn();
permissionsContext.createGrant = vi.fn();
permissionsContext.issuedToolToken = ref("");
permissionsContext.newGrantLabel = ref("");
permissionsContext.newGrantScopes = ref<string[]>([]);
permissionsContext.newGrantToolsets = ref<string[]>([]);
permissionsContext.toggleNewGrantToolset = vi.fn();
permissionsContext.toolManagementToolsets = ref<any[]>([]);
permissionsContext.toolScopes = ref<any[]>([]);

const mounted: VueWrapper[] = [];

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    modelValue: { type: [String, Number, Boolean, Array], default: undefined },
    label: { type: String, default: "" },
    options: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          class: "option-bar-stub",
          "data-label": props.label || "",
          onClick: () => {
            if (typeof props.modelValue === "boolean") {
              emit("update:modelValue", !props.modelValue);
              return;
            }
            const nextValue = (props.options as Array<{ value?: unknown }>)?.[0]?.value ?? "role:updated";
            emit("change", nextValue);
          },
        },
        props.label || String(props.modelValue ?? "option-bar"),
      );
  },
});

const ScopeSelectorStub = defineComponent({
  name: "ScopeSelector",
  props: {
    modelValue: { type: Array, default: () => [] },
    scopes: { type: Array, default: () => [] },
    compact: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("div", { class: "scope-selector-stub", "data-compact": props.compact ? "true" : "false" }, [
        h(
          "button",
          {
            type: "button",
            class: "scope-selector-stub-add",
            onClick: () => {
              const scopeList = props.scopes as Array<{ id?: string }>;
              const firstScope = scopeList?.[1]?.id ?? scopeList?.[0]?.id ?? "scope-added";
              emit("update:modelValue", [...new Set([...(props.modelValue as string[]), firstScope])]);
            },
          },
          "添加范围",
        ),
      ]);
  },
});

const BridgeDownloadButtonStub = defineComponent({
  name: "BridgeDownloadButton",
  props: {
    href: { type: String, default: "#" },
    label: { type: String, default: "" },
    buttonClass: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  setup(props) {
    return () =>
      h(
        "a",
        {
          class: ["download-stub", props.buttonClass],
          href: props.href,
          "data-disabled": props.disabled ? "true" : "false",
        },
        props.label,
      );
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: { type: String, default: "" },
    label: { type: [String, Number], default: "" },
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone }, String(props.label));
  },
});

function mountAuthPanel() {
  const wrapper = mount(ConsoleAuthUsersPanel, {
    global: {
      stubs: {
        OptionBar: OptionBarStub,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

function mountGrantCard() {
  const wrapper = mount(ToolGrantCreateCard, {
    global: {
      stubs: {
        ScopeSelector: ScopeSelectorStub,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

function mountStageCard(props: Record<string, unknown>) {
  const wrapper = mount(KnowledgeDistillationStageCard, {
    props,
    global: {
      stubs: {
        BridgeDownloadButton: BridgeDownloadButtonStub,
        StatusPill: StatusPillStub,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

function resetShellContext() {
  shellContext.authAudit.value = [];
  shellContext.authSessions.value = [];
  shellContext.authUsers.value = [];
  shellContext.busyKey.value = "";
  shellContext.canAdminAuth.value = false;
  shellContext.oidcAllowedDomainsText.value = "";
  shellContext.oidcDraft.enabled = false;
  shellContext.oidcDraft.issuer = "";
  shellContext.oidcDraft.clientId = "";
  shellContext.oidcDraft.clientSecret = "";
  shellContext.oidcDraft.redirectUri = "";
  shellContext.oidcRoleMappingText.value = "";
}

function resetPermissionsContext() {
  permissionsContext.busyKey.value = "";
  permissionsContext.issuedToolToken.value = "";
  permissionsContext.newGrantLabel.value = "";
  permissionsContext.newGrantScopes.value = [];
  permissionsContext.newGrantToolsets.value = [];
  permissionsContext.toolManagementToolsets.value = [];
  permissionsContext.toolScopes.value = [];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetShellContext();
  resetPermissionsContext();
  formatCompactDateMock.mockClear();
});

afterEach(() => {
  while (mounted.length) {
    mounted.pop()?.unmount();
  }
  document.body.innerHTML = "";
});

describe("ConsoleAuthUsersPanel", () => {
  it("renders the admin workspace, binds editable fields, and dispatches row actions", async () => {
    shellContext.canAdminAuth.value = true;
    shellContext.busyKey.value = "auth:session:s-2";
    shellContext.authUsers.value = [
      { userId: "u-1", displayName: "Alice", username: "alice", roleId: "admin", enabled: true },
      { userId: "u-2", displayName: "Bob", username: "bob", roleId: "viewer", enabled: false },
    ];
    shellContext.authSessions.value = [
      { sessionId: "s-1", username: "alice", roleId: "admin" },
      { sessionId: "s-2", username: "bob", roleId: "viewer" },
    ];
    shellContext.authAudit.value = [
      {
        auditId: "a-1",
        createdAt: "2026-06-01T08:30:00.000Z",
        username: "alice",
        operationId: "grant:create",
        action: "create",
        status: "ok",
        error: "",
      },
    ];
    shellContext.oidcAllowedDomainsText.value = "example.com";
    shellContext.oidcRoleMappingText.value = "{\"admin\":\"owner\"}";
    shellContext.oidcDraft.enabled = true;
    shellContext.oidcDraft.issuer = "https://issuer.example";
    shellContext.oidcDraft.clientId = "client-1";
    shellContext.oidcDraft.clientSecret = "secret-1";
    shellContext.oidcDraft.redirectUri = "https://app.example/callback";

    const wrapper = mountAuthPanel();
    await nextTick();

    expect(wrapper.text()).toContain("用户与执行日志");
    expect(wrapper.text()).toContain("2 个账号");
    expect(wrapper.text()).toContain("2 个会话 / 1 条记录");
    expect(wrapper.text()).toContain("Alice / alice");
    expect(wrapper.text()).toContain("Bob / bob");
    expect(wrapper.text()).toContain("formatted:2026-06-01");
    expect(wrapper.text()).toContain("alice / grant:create");
    expect(wrapper.text()).toContain("ok");
    expect(wrapper.text()).toContain("已启用");

    const inputs = wrapper.findAll("input");
    expect(inputs.map((input) => input.element.value)).toEqual([
      "https://issuer.example",
      "client-1",
      "secret-1",
      "https://app.example/callback",
    ]);

    const textareas = wrapper.findAll("textarea");
    expect(textareas[0].element.value).toBe("example.com");
    expect(textareas[1].element.value).toBe("{\"admin\":\"owner\"}");

    await inputs[0].setValue("https://issuer.changed");
    await inputs[1].setValue("client-2");
    await inputs[2].setValue("secret-2");
    await inputs[3].setValue("https://app.changed/callback");
    await textareas[0].setValue("example.org");
    await textareas[1].setValue("{\"viewer\":\"read\"}");
    expect(shellContext.oidcDraft.issuer).toBe("https://issuer.changed");
    expect(shellContext.oidcDraft.clientId).toBe("client-2");
    expect(shellContext.oidcDraft.clientSecret).toBe("secret-2");
    expect(shellContext.oidcDraft.redirectUri).toBe("https://app.changed/callback");
    expect(shellContext.oidcAllowedDomainsText.value).toBe("example.org");
    expect(shellContext.oidcRoleMappingText.value).toBe("{\"viewer\":\"read\"}");

    await wrapper.find('.option-bar-stub[data-label="启用"]').trigger("click");
    expect(shellContext.oidcDraft.enabled).toBe(false);
    await wrapper.find('.option-bar-stub[data-label=""]').trigger("click");
    expect(shellContext.updateConsoleUserRole).toHaveBeenCalledWith(
      shellContext.authUsers.value[0],
      "admin",
    );

    const userButtons = wrapper
      .findAll("button.table-action")
      .filter((button) => button.text().trim() === "停用" || button.text().trim() === "启用");
    await userButtons[0].trigger("click");
    expect(shellContext.updateConsoleUser).toHaveBeenCalledWith(shellContext.authUsers.value[0], { enabled: false });

    const saveButton = wrapper.find("button.tool-button");
    await saveButton.trigger("click");
    expect(shellContext.saveOidcConfig).toHaveBeenCalledTimes(1);

    const revokeButtons = wrapper
      .findAll("button.table-action")
      .filter((button) => button.text().trim() === "撤销");
    expect(revokeButtons[1].attributes("disabled")).toBeDefined();
    await revokeButtons[0].trigger("click");
    expect(shellContext.revokeConsoleSession).toHaveBeenCalledWith("s-1");
  });

  it("shows the permission empty state when admin auth is not available", () => {
    const wrapper = mountAuthPanel();

    expect(wrapper.text()).toContain("权限不足");
    expect(wrapper.text()).toContain("需要 auth:admin 权限才能管理用户、OIDC、会话和操作记录。");
    expect(wrapper.findAll(".module-panel")).toHaveLength(0);
  });
});

describe("ToolGrantCreateCard", () => {
  it("renders empty counts and no token panel when nothing is selected", () => {
    const wrapper = mountGrantCard();

    expect(wrapper.text()).toContain("创建工具令牌");
    expect(wrapper.text()).toContain("范围 0");
    expect(wrapper.text()).toContain("工具集 0");
    expect(wrapper.find(".token-panel").exists()).toBe(false);
    expect(wrapper.findAll(".scope-chip")).toHaveLength(0);
  });

  it("submits the grant form, toggles toolsets, and copies the issued token", async () => {
    permissionsContext.newGrantLabel.value = "本地维护令牌";
    permissionsContext.newGrantScopes.value = ["knowledge:read"];
    permissionsContext.newGrantToolsets.value = ["toolset.read"];
    permissionsContext.issuedToolToken.value = "token-123";
    permissionsContext.toolScopes.value = [
      { id: "knowledge:read", label: "知识读取", description: "查看知识库" },
      { id: "workspace:read", label: "工作空间读取", description: "读取工作空间" },
    ];
    permissionsContext.toolManagementToolsets.value = [
      { id: "toolset.read", label: "安全只读工具", maxRisk: "read_only", grantable: true },
      { id: "toolset.safe", label: "安全写入工具", maxRisk: "safe_write", grantable: true },
      { id: "toolset.hidden", label: "隐藏工具集", maxRisk: "high", grantable: false },
    ];

    const wrapper = mountGrantCard();
    await nextTick();

    expect(wrapper.text()).toContain("范围 1");
    expect(wrapper.text()).toContain("工具集 1");
    expect(wrapper.text()).toContain("已选 1");
    expect(wrapper.text()).toContain("已选 1");
    expect(wrapper.text()).toContain("安全只读工具");
    expect(wrapper.text()).toContain("安全写入");
    expect(wrapper.find(".token-panel p").text()).toBe("token-123");
    expect(wrapper.text()).not.toContain("隐藏工具集");

    await wrapper.find("input").setValue("本地维护令牌-2");
    expect(permissionsContext.newGrantLabel.value).toBe("本地维护令牌-2");

    await wrapper.find("form").trigger("submit");
    expect(permissionsContext.createGrant).toHaveBeenCalledTimes(1);

    const scopeSelectorButton = wrapper.find(".scope-selector-stub-add");
    await scopeSelectorButton.trigger("click");
    expect(permissionsContext.newGrantScopes.value).toContain("workspace:read");

    const toolsetButtons = wrapper.findAll(".scope-chip");
    await toolsetButtons[1].trigger("click");
    expect(permissionsContext.toggleNewGrantToolset).toHaveBeenCalledWith("toolset.safe");

    await wrapper.find(".token-panel .tool-button").trigger("click");
    expect(permissionsContext.copyIssuedToolToken).toHaveBeenCalledTimes(1);
  });
});

describe("KnowledgeDistillationStageCard", () => {
  it("renders the fallback preview and default export controls for a non-completed stage", () => {
    const wrapper = mountStageCard({
      busy: "",
      canMaintainKnowledge: false,
      index: 0,
      runId: "",
      runStatus: "running",
      stage: {
        stageId: "stage-1",
        title: "准备阶段",
        actionLabel: "准备",
        description: "整理输入资料",
        status: "running",
        progressPercent: 33,
      },
    });

    expect(wrapper.classes()).toContain("running");
    expect(wrapper.text()).toContain("准备阶段");
    expect(wrapper.text()).toContain("33%");
    expect(wrapper.text()).toContain("等待阶段完成后展示结果预览。");
    expect(wrapper.text()).toContain("0 个");
    expect(wrapper.findAll(".download-stub")).toHaveLength(4);
    expect(wrapper.findAll(".download-stub")[0].attributes("href")).toBe("#");
    expect(wrapper.find("button.tool-button-ghost").attributes("disabled")).toBeDefined();
  });

  it("renders completed stage details and emits rerun when enabled", async () => {
    const stage = {
      stageId: "stage-2",
      title: "汇总阶段",
      actionLabel: "汇总",
      description: "生成最终摘要",
      status: "completed",
      progressPercent: 100,
      preview: "最终摘要文本",
      exportFormats: ["markdown", "json"],
      metrics: { documents: 4 },
      versions: [
        { versionId: "v1", status: "archived", markdownLength: 120 },
        { versionId: "v2", status: "active", markdownLength: 80 },
      ],
      checkpoint: { durable: true, resumable: false },
      error: "已完成但存在告警",
      tone: "success",
    };

    const wrapper = mountStageCard({
      busy: "",
      canMaintainKnowledge: true,
      index: 1,
      runId: "run-9",
      runStatus: "completed",
      stage,
    });

    expect(wrapper.classes()).toContain("completed");
    expect(wrapper.find(".status-pill-stub").attributes("data-tone")).toBe("success");
    expect(wrapper.text()).toContain("结果预览");
    expect(wrapper.text()).toContain("最终摘要文本");
    expect(wrapper.text()).toContain("已持久化 · 不可恢复");
    expect(wrapper.text()).toContain(JSON.stringify({ documents: 4 }));
    expect(wrapper.text()).toContain("v1 · archived · 120 字");
    expect(wrapper.text()).toContain("v2 · active · 80 字");
    expect(wrapper.text()).toContain("已完成但存在告警");

    const downloadStubs = wrapper.findAll(".download-stub");
    expect(downloadStubs).toHaveLength(2);
    expect(downloadStubs[0].attributes("href")).toBe(
      "/api/knowledge/distillation/workbench/runs/run-9/exports/stage-2?format=markdown",
    );
    expect(downloadStubs[1].attributes("href")).toBe(
      "/api/knowledge/distillation/workbench/runs/run-9/exports/stage-2?format=json",
    );
    expect(downloadStubs[0].text()).toBe("导出 MARKDOWN");

    await wrapper.find("button.tool-button-ghost").trigger("click");
    expect(wrapper.emitted("rerun")).toEqual([[stage]]);
  });

  it("disables rerun while busy or when the run is already running", () => {
    const wrapper = mountStageCard({
      busy: "rerun:stage-3",
      canMaintainKnowledge: true,
      index: 0,
      runId: "run-3",
      runStatus: "running",
      stage: {
        stageId: "stage-3",
        title: "校验阶段",
        actionLabel: "校验",
        description: "检查输出",
        status: "completed",
        progressPercent: 100,
      },
    });

    const rerunButton = wrapper.find("button.tool-button-ghost");
    expect(rerunButton.text()).toBe("重跑中");
    expect(rerunButton.attributes("disabled")).toBeDefined();
  });
});
