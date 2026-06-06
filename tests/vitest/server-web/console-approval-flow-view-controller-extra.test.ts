// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useApprovalFlowViewController } from "../../../server-web/composables/console-approval-flow-view-controller";

const shellContextMock = vi.hoisted(() => ({
  useServerConsoleShellContext: vi.fn(),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: shellContextMock.useServerConsoleShellContext,
}));

function makeAuthorization(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "auth-1",
    clientName: "Codex CLI",
    reason: "需要读取知识库",
    status: "pending",
    requestedTools: ["knowledge.search"],
    requestedScopes: ["knowledge:read"],
    ...overrides,
  } as any;
}

function makeReview(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: "review-1",
    entityId: "entity-1",
    title: "",
    summary: "",
    status: "pending",
    reason: "source_path_content_conflict",
    severity: "high",
    currentRecord: {
      document: {
        title: "旧文档",
        sourcePath: "/docs/a.md",
        sourceHash: "same-hash",
        text: "same text",
      },
    },
    incomingRecord: {
      document: {
        title: "新文档",
        sourcePath: "/docs/a.md",
        sourceHash: "same-hash",
        text: "same text",
      },
    },
    ...overrides,
  } as any;
}

function createShell() {
  const busyKey = ref("");
  const mcpAuthorizationStatus = ref("all");
  const knowledgeReviewStatus = ref("all");
  const mcpAuthorizationRequests = ref([
    makeAuthorization(),
    makeAuthorization({
      requestId: "auth-2",
      clientName: "",
      reason: "",
      status: "approved",
      requestedTools: [],
      requestedScopes: [],
    }),
  ]);
  const knowledgeReviewItems = ref([makeReview()]);
  const refreshMcpAuthorizationRequests = vi.fn(async () => undefined);
  const refreshKnowledgeConflicts = vi.fn(async () => undefined);
  const resolveMcpAuthorizationRequest = vi.fn(async () => undefined);
  const resolveKnowledgeReview = vi.fn(async () => undefined);
  const fuseKnowledgeReview = vi.fn(async () => undefined);

  return {
    approvalFlowConsole: {
      busyKey,
      fuseKnowledgeReview,
      knowledgeReviewItems,
      knowledgeReviewStatus,
      mcpAuthorizationRequests,
      mcpAuthorizationStatus,
      mcpAuthorizationStatusOptionBarOptions: computed(() => [
        { value: "pending", label: "待审批" },
      ]),
      refreshKnowledgeConflicts,
      refreshMcpAuthorizationRequests,
      resolveKnowledgeReview,
      resolveMcpAuthorizationRequest,
      selectedKnowledgeReviewFusionModel: computed(() => ({
        enabled: true,
        label: "Fusion Agent",
        value: "fusion-agent",
      })),
    },
  } as any;
}

function mountController(shell = createShell()) {
  let controller: ReturnType<typeof useApprovalFlowViewController> | null = null;
  shellContextMock.useServerConsoleShellContext.mockReturnValue(shell);
  const wrapper = mount(defineComponent({
    setup() {
      controller = useApprovalFlowViewController();
      return () => h("div");
    },
  }));
  return {
    controller: controller as NonNullable<typeof controller>,
    shell,
    wrapper,
  };
}

describe("console approval flow view controller extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes both approval sources on mount and when status changes", async () => {
    const { controller, shell } = mountController();
    await nextTick();

    expect(shell.approvalFlowConsole.mcpAuthorizationStatus.value).toBe("pending");
    expect(shell.approvalFlowConsole.knowledgeReviewStatus.value).toBe("pending");
    expect(shell.approvalFlowConsole.refreshMcpAuthorizationRequests).toHaveBeenCalledTimes(1);
    expect(shell.approvalFlowConsole.refreshKnowledgeConflicts).toHaveBeenCalledTimes(1);

    controller.approvalFlowStatus.value = "approved";

    expect(shell.approvalFlowConsole.mcpAuthorizationStatus.value).toBe("approved");
    expect(shell.approvalFlowConsole.knowledgeReviewStatus.value).toBe("resolved");
    expect(shell.approvalFlowConsole.refreshMcpAuthorizationRequests).toHaveBeenCalledTimes(2);
    expect(shell.approvalFlowConsole.refreshKnowledgeConflicts).toHaveBeenCalledTimes(2);

    controller.approvalFlowStatus.value = "rejected";
    expect(shell.approvalFlowConsole.knowledgeReviewStatus.value).toBe("rejected");
  });

  it("projects authorization and knowledge review cards with labels, tone, and metadata", () => {
    const { controller } = mountController();

    expect(controller.approvalFlowCards.value).toHaveLength(3);
    expect(controller.approvalFlowCards.value[0]).toMatchObject({
      key: "authorization:auth-1",
      kind: "authorization",
      tone: "warning",
      label: "MCP 客户端授权",
      title: "Codex CLI",
      summary: "用途说明：需要读取知识库",
      meta: ["待审批", "工具 1 个", "权限域 1 个"],
    });
    expect(controller.approvalFlowCards.value[1]).toMatchObject({
      key: "authorization:auth-2",
      tone: "success",
      title: "Unknown Client",
      summary: "用途说明：无",
      meta: ["已批准", "工具 0 个", "权限域 0 个"],
    });
    expect(controller.approvalFlowCards.value[2]).toMatchObject({
      key: "review:review-1",
      kind: "review",
      tone: "danger",
      label: "知识入库冲突",
      title: "新文档",
      summary: "系统检测到该记录需要人工确认。",
      meta: ["待决策", "同路径内容冲突", "完全重合"],
    });
  });

  it("delegates approve/reject and review resolution actions to shell handlers", () => {
    const { controller, shell } = mountController();
    const auth = shell.approvalFlowConsole.mcpAuthorizationRequests.value[0];
    const review = shell.approvalFlowConsole.knowledgeReviewItems.value[0];

    controller.approveAuthorization(auth);
    controller.rejectAuthorization(auth);
    controller.replaceKnowledgeReview(review);
    controller.keepBothKnowledgeReview(review);
    controller.acceptKnowledgeReview(review);
    controller.rejectKnowledgeReview(review);
    controller.fuseKnowledgeReviewItem(review);

    expect(shell.approvalFlowConsole.resolveMcpAuthorizationRequest).toHaveBeenCalledWith("auth-1", "approved");
    expect(shell.approvalFlowConsole.resolveMcpAuthorizationRequest).toHaveBeenCalledWith("auth-1", "rejected");
    expect(shell.approvalFlowConsole.resolveKnowledgeReview).toHaveBeenCalledWith(review, "replace");
    expect(shell.approvalFlowConsole.resolveKnowledgeReview).toHaveBeenCalledWith(review, "keep_both");
    expect(shell.approvalFlowConsole.resolveKnowledgeReview).toHaveBeenCalledWith(review, "accept");
    expect(shell.approvalFlowConsole.resolveKnowledgeReview).toHaveBeenCalledWith(review, "reject");
    expect(shell.approvalFlowConsole.fuseKnowledgeReview).toHaveBeenCalledWith(review);
  });

  it("derives busy and disabled states from busy key, similarity, and fusion model", () => {
    const shell = createShell();
    const { controller } = mountController(shell);
    const auth = shell.approvalFlowConsole.mcpAuthorizationRequests.value[0];
    const review = shell.approvalFlowConsole.knowledgeReviewItems.value[0];

    expect(controller.authorizationBusy(auth)).toBe(false);
    shell.approvalFlowConsole.busyKey.value = "mcp-authorization-requests:resolve:auth-1";
    expect(controller.authorizationBusy(auth)).toBe(true);

    expect(controller.reviewBusy(review)).toBe(false);
    shell.approvalFlowConsole.busyKey.value = "knowledge:review:review-1:accept";
    expect(controller.reviewBusy(review)).toBe(true);
    expect(controller.reviewKeepBothDisabled(review)).toBe(true);
    expect(controller.reviewFusionDisabled(review)).toBe(true);

    shell.approvalFlowConsole.busyKey.value = "";
    expect(controller.reviewKeepBothDisabled(review)).toBe(true);
    expect(controller.reviewFusionDisabled(review)).toBe(false);

    shell.approvalFlowConsole.selectedKnowledgeReviewFusionModel = computed(() => ({
      enabled: false,
      label: "Missing",
      value: "",
    }));
    const disabledHarness = mountController(shell);
    expect(disabledHarness.controller.reviewFusionDisabled(review)).toBe(true);
  });
});
