// @vitest-environment jsdom
import { ref, type Ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApprovalFlowView from "../../../server-web/views/ApprovalFlowView.vue";
import { setConsoleLocaleState } from "../../../server-web/i18n/console";

const approvalFlowControllerMock = vi.hoisted(() => ({
  current: null as any,
}));

vi.mock("../../../server-web/composables/console-approval-flow-view-controller", () => ({
  useApprovalFlowViewController: () => approvalFlowControllerMock.current,
}));

vi.mock("../../../server-web/composables/console-knowledge-review-utils", () => ({
  knowledgeReviewCanResolveWithDocument: vi.fn(() => false),
}));

const mountedWrappers: VueWrapper[] = [];

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
  document.documentElement.lang = "";
  setConsoleLocaleState("zh-CN");
});

function makeApprovalFlowController(overrides: { approvalFlowCards?: Ref<any[]> } = {}) {
  return {
    acceptKnowledgeReview: vi.fn(),
    approvalFlowCards: overrides.approvalFlowCards ?? ref([]),
    approvalFlowStatus: ref("pending"),
    approveAuthorization: vi.fn(),
    authorizationBusy: vi.fn(() => false),
    fuseKnowledgeReviewItem: vi.fn(),
    keepBothKnowledgeReview: vi.fn(),
    mcpAuthorizationStatusOptionBarOptions: [
      { value: "pending", label: "Pending Approval" },
      { value: "approved", label: "Approved" },
      { value: "rejected", label: "Rejected" },
      { value: "all", label: "All" },
    ],
    rejectAuthorization: vi.fn(),
    rejectKnowledgeReview: vi.fn(),
    replaceKnowledgeReview: vi.fn(),
    reviewBusy: vi.fn(() => false),
    reviewFusionDisabled: vi.fn(() => false),
    reviewKeepBothDisabled: vi.fn(() => false),
  };
}

describe("ApprovalFlowView", () => {
  it("renders page and empty approval copy in English", () => {
    setConsoleLocaleState("en");
    approvalFlowControllerMock.current = makeApprovalFlowController();

    const wrapper = mount(ApprovalFlowView);

    mountedWrappers.push(wrapper);

    expect(wrapper.get(".section-header h3").text()).toBe("Platform Approvals");
    expect(wrapper.get(".section-header p").text()).toBe("Handle items that need manual decisions in one place.");
    expect(wrapper.get(".approval-request-empty-card strong").text()).toBe("No Pending Authorization Requests");
    expect(wrapper.get(".approval-request-empty-card span").text()).toBe("No approval items require manual review.");
  });

  it("uses document language when the global locale state has not caught up", () => {
    document.documentElement.lang = "en";
    setConsoleLocaleState("zh-CN");
    approvalFlowControllerMock.current = makeApprovalFlowController();

    const wrapper = mount(ApprovalFlowView);

    mountedWrappers.push(wrapper);

    expect(wrapper.get(".section-header h3").text()).toBe("Platform Approvals");
    expect(wrapper.get(".section-header p").text()).toBe("Handle items that need manual decisions in one place.");
    expect(wrapper.get(".approval-request-empty-card span").text()).toBe("No approval items require manual review.");
  });
});
