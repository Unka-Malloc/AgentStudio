import { describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  deleteJson: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock("../../../server-web/lib/bridge-http", () => bridgeMocks);

import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSources,
  refreshAllKnowledgeSources,
  refreshKnowledgeSource,
  updateKnowledgeSource,
} from "../../../server-web/lib/knowledge-sources-client";
import {
  acknowledgeMonitorAlert,
  getBackgroundProcesses,
  getClientRuntimeStatus,
  getMonitorAlerts,
  recoverBackgroundSupervisor,
  saveMonitorAlertConfig,
} from "../../../server-web/lib/ops-monitor-client";
import {
  getAuthorizationGovernance,
  listMcpAuthorizationRequests,
  resolveMcpAuthorizationRequest,
  revokeAuthorizationApproval,
  upsertAuthorizationGovernance,
} from "../../../server-web/lib/authorization-governance-client";
import {
  getContextProfiles,
  listContextBuildRecords,
  previewContextPack,
  runContextEvaluation,
  saveContextProfiles,
} from "../../../server-web/lib/context-compiler-client";
import {
  externalServiceBindingModeOptions,
  externalServiceCloudDriveModeOptions,
  externalServiceCloudDriveProviderOptions,
  externalServiceHealthCheckTypeOptions,
  externalServiceMcpTransportOptions,
  externalServiceModeOptions,
  externalServiceModelProtocolOptions,
  externalServiceRiskOptions,
  externalServiceStartupPolicyOptions,
  externalServiceUpstreamTypeOptions,
  getExternalServiceConfig,
  getExternalServices,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceConfig,
} from "../../../server-web/lib/external-services-client";

describe("server-web small API clients final extra coverage", () => {
  it("builds knowledge source requests with encoded source ids and safety flags", () => {
    getKnowledgeSources();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/knowledge/sources");

    createKnowledgeSource({ label: "Inbox" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/sources",
      { label: "Inbox" },
      { safetyConfirm: true },
    );

    updateKnowledgeSource("source/a", { enabled: false });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/sources/source%2Fa",
      { enabled: false },
      { safetyConfirm: true },
    );

    deleteKnowledgeSource("source/a");
    expect(bridgeMocks.deleteJson).toHaveBeenLastCalledWith(
      "/api/knowledge/sources/source%2Fa",
      { safetyConfirm: true },
    );

    refreshKnowledgeSource("source/a", { force: true });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/sources/source%2Fa/refresh",
      { force: true },
    );

    refreshAllKnowledgeSources();
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/sources-refresh",
      {},
    );
  });

  it("builds ops monitor requests and destructive safety flags", () => {
    getBackgroundProcesses();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/system/background-processes");
    getClientRuntimeStatus();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/client-runtime/status");
    getMonitorAlerts();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/system/monitor-alerts");

    saveMonitorAlertConfig({ enabled: true } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/system/monitor-alerts/config",
      { config: { enabled: true } },
      { safetyConfirm: true },
    );

    acknowledgeMonitorAlert("alert/1");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/system/monitor-alerts/alert%2F1/ack",
      {},
      { safetyConfirm: true },
    );

    recoverBackgroundSupervisor();
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/system/background-supervisor/recover",
      {},
      { safetyConfirm: true },
    );
  });

  it("builds authorization governance and MCP authorization requests", () => {
    getAuthorizationGovernance();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/authorization/governance");

    upsertAuthorizationGovernance("role", { roleId: "admin" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/authorization/roles",
      { roleId: "admin" },
      { safetyConfirm: true },
    );
    upsertAuthorizationGovernance("team", { teamId: "team-a" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/authorization/teams",
      { teamId: "team-a" },
      { safetyConfirm: true },
    );
    upsertAuthorizationGovernance("userPolicy", { userId: "user-a" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/authorization/users/policy",
      { userId: "user-a" },
      { safetyConfirm: true },
    );
    upsertAuthorizationGovernance("agentGroup", { groupId: "group-a" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/authorization/agent-groups",
      { groupId: "group-a" },
      { safetyConfirm: true },
    );
    upsertAuthorizationGovernance("agentBinding", { agentId: "agent-a" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/authorization/agents/binding",
      { agentId: "agent-a" },
      { safetyConfirm: true },
    );
    upsertAuthorizationGovernance("approval", { approvalId: "approval-a" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/authorization/approvals",
      { approvalId: "approval-a" },
      { safetyConfirm: true },
    );

    revokeAuthorizationApproval("approval/1", "cleanup");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/authorization/approvals/approval%2F1/revoke",
      { reason: "cleanup" },
      { safetyConfirm: true },
    );

    listMcpAuthorizationRequests("approved");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith(
      "/api/console/mcp/authorization/requests?status=approved",
    );

    resolveMcpAuthorizationRequest("request/1", { resolution: "rejected" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/console/mcp/authorization/requests/request%2F1/resolve",
      { resolution: "rejected" },
      { safetyConfirm: true },
    );
  });

  it("builds context compiler client requests", () => {
    getContextProfiles();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/context/profiles");
    saveContextProfiles({ profiles: [] });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith("/api/context/profiles", { profiles: [] });
    previewContextPack({ workspaceId: "ws-1" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith("/api/context/preview", { workspaceId: "ws-1" });
    listContextBuildRecords();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/context/build-records?limit=50");
    listContextBuildRecords(8);
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/context/build-records?limit=8");
    runContextEvaluation({ profileId: "profile-1" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith("/api/context/evaluation/runs", { profileId: "profile-1" });
  });

  it("builds external service requests and exposes option vocabularies", () => {
    expect(externalServiceModeOptions.map((option) => option.value)).toEqual(["managed", "connected", "on-demand"]);
    expect(externalServiceStartupPolicyOptions.at(-1)?.value).toBe("external-only");
    expect(externalServiceUpstreamTypeOptions.map((option) => option.value)).toContain("openapi");
    expect(externalServiceCloudDriveProviderOptions.map((option) => option.value)).toContain("dropbox");
    expect(externalServiceCloudDriveModeOptions.map((option) => option.value)).toContain("remote-live");
    expect(externalServiceModelProtocolOptions.map((option) => option.value)).toEqual(["openai-compatible", "openai-responses"]);
    expect(externalServiceMcpTransportOptions.map((option) => option.value)).toEqual(["streamable-http", "sse"]);
    expect(externalServiceBindingModeOptions.map((option) => option.value)).toEqual(["passthrough", "compile"]);
    expect(externalServiceRiskOptions.map((option) => option.value)).toContain("destructive");
    expect(externalServiceHealthCheckTypeOptions.map((option) => option.value)).toEqual(["none", "http"]);

    getExternalServices();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/external-services");
    getExternalServiceConfig();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/external-services/config");
    verifyExternalServiceConfig("service: test", true);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/external-services/verify",
      { configText: "service: test", requireKnownPaths: true },
    );
    saveExternalServiceConfig("service: test");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/external-services/config",
      { configText: "service: test" },
      { safetyConfirm: true },
    );
    refreshExternalServiceRuntime();
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/external-services/refresh",
      {},
      { safetyConfirm: true },
    );
    refreshExternalServiceRuntime("svc/1");
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/external-services/refresh",
      { serviceId: "svc/1" },
      { safetyConfirm: true },
    );
  });
});
