import { describe, expect, it } from "vitest";
import {
  applyKnowledgeAccessToEvidencePack,
  createAuthorizationOverlay,
  createDerivedKnowledgeView,
  createLibraryCard,
  enforceKnowledgeAccess,
  evaluateKnowledgeAccess
} from "../../../server/platform/specialized/knowledge/agent-library/access-policy.mjs";

describe("knowledge agent library access policy extra", () => {
  it("creates checkout decisions with receipts, loans, and allowed evidence projections", () => {
    const view = createDerivedKnowledgeView({
      upstreamRef: "knowledge-source-a",
      workspaceId: "workspace-a",
      allowedSubjects: "subject-a",
      allowedAgentProfiles: "profile-a",
      allowedActions: "read",
      checkoutPolicy: {
        allowRetain: true,
        allowShare: true,
        expiresInSeconds: 60,
        revocationPolicy: "manual"
      },
      refs: ["evidence-a", { ref: "asset-a", refType: "asset" }]
    });
    const overlay = createAuthorizationOverlay({
      derivedViewRef: view.derivedViewRef,
      defaultAccessMode: "checkoutAllowed",
      defaultEgress: ["memoryWrite", "not-supported"],
      rules: []
    });

    expect(overlay.defaultEgress).toEqual(["memoryWrite"]);

    const decision = evaluateKnowledgeAccess({
      libraryCardId: "card-a",
      subject: { subjectId: "subject-a" },
      agentProfile: { profileId: "profile-a" },
      workspaceId: "workspace-a",
      taskId: "task-a",
      requestedAction: "read",
      requestedAccessMode: "checkoutAllowed",
      requestedEgress: "memoryWrite"
    }, {
      view,
      authorizationOverlay: overlay
    });

    expect(decision.allowed).toBe(true);
    expect(decision.accessMode).toBe("checkoutAllowed");
    expect(decision.allowedRefs.map((ref) => ref.ref)).toEqual(["evidence-a", "asset-a"]);
    expect(decision.knowledgeAccessReceipt).toMatchObject({
      libraryCardId: "card-a",
      workspaceId: "workspace-a",
      requestedEgress: "memoryWrite"
    });
    expect(decision.loanRecord).toMatchObject({
      canRetain: true,
      canShare: true,
      revocationPolicy: "manual"
    });
    expect(enforceKnowledgeAccess({
      subject: { subjectId: "subject-a" },
      agentProfile: { profileId: "profile-a" },
      workspaceId: "workspace-a",
      requestedAction: "read",
      requestedEgress: "searchResult"
    }, {
      view,
      authorizationOverlay: overlay
    }).allowed).toBe(true);

    const evidencePack = applyKnowledgeAccessToEvidencePack({
      evidenceRefs: ["evidence-a", "evidence-b"],
      assetRefs: [{ ref: "asset-a" }, { ref: "asset-b" }],
      citations: [{ id: "citation-a" }],
      backendTrace: { source: "unit" }
    }, decision);

    expect(evidencePack).toMatchObject({
      permissionScope: "agent-library",
      accessMode: "checkoutAllowed",
      evidenceRefs: ["evidence-a"],
      assetRefs: [{ ref: "asset-a" }],
      citations: [{ id: "citation-a" }],
      backendTrace: {
        source: "unit",
        agentLibraryDecisionId: decision.decisionId,
        auditId: decision.auditId
      }
    });

    const card = createLibraryCard({
      libraryCardId: "card-custom",
      subject: { subjectId: "subject-a" },
      workspaceId: "workspace-a",
      agentProfile: { profileId: "profile-a" },
      scopes: "knowledge:read"
    });
    expect(card).toMatchObject({
      libraryCardId: "card-custom",
      workspaceId: "workspace-a",
      scopes: ["knowledge:read"]
    });
  });

  it("denies by subject profile workspace action and rule filters evidence packs", () => {
    const view = createDerivedKnowledgeView({
      upstreamKnowledgeRef: "knowledge-source-b",
      workspaceScope: ["workspace-a"],
      allowedSubjects: ["subject-a"],
      allowedAgentProfiles: ["profile-a"],
      allowedActions: ["read"],
      authorizationOverlay: {
        defaultAccessMode: "controlledView",
        rules: [
          {
            ruleId: "rule-deny-secret",
            effect: "deny",
            subjects: ["subject-b"],
            targetRefs: ["evidence-secret"],
            reason: "sensitive_target"
          }
        ]
      },
      refs: [{ ref: "evidence-secret" }]
    });

    const request = {
      subject: "subject-b",
      agentProfile: "profile-b",
      workspaceId: "workspace-b",
      requestedAction: "export",
      requestedEgress: "unknown-egress",
      targetRefs: ["evidence-secret"]
    };
    const decision = evaluateKnowledgeAccess(request, { view });

    expect(decision.allowed).toBe(false);
    expect(decision.filteredReason).toContain("subject_not_allowed");
    expect(decision.filteredReason).toContain("agent_profile_not_allowed");
    expect(decision.filteredReason).toContain("workspace_not_allowed");
    expect(decision.filteredReason).toContain("action_not_allowed");
    expect(decision.filteredReason).toContain("sensitive_target");
    expect(decision.deniedRequestAudit).toMatchObject({
      upstreamAccessDenied: true,
      withheldCounts: { refs: 1 }
    });

    expect(() => enforceKnowledgeAccess(request, { view })).toThrow(/AgentLibrary access denied/);

    const filtered = applyKnowledgeAccessToEvidencePack({
      evidenceRefs: ["evidence-secret"],
      citations: [{ id: "citation-secret" }],
      assetRefs: ["asset-secret"],
      backendTrace: { source: "unit" }
    }, decision);

    expect(filtered).toMatchObject({
      evidenceRefs: [],
      citations: [],
      assetRefs: [],
      permissionScope: "denied",
      accessMode: "deny",
      withheldCounts: { refs: 1 },
      backendTrace: {
        source: "unit",
        agentLibraryDecisionId: decision.decisionId,
        auditId: decision.auditId
      }
    });
  });
});
