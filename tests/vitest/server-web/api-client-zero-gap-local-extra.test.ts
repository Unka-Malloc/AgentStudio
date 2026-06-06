import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  putBinaryJson: vi.fn(),
}));

vi.mock("../../../server-web/lib/bridge-http", () => bridgeMocks);

import {
  callAgentGateway,
  getAgentGatewayConfig,
  saveAgentGatewayConfig,
} from "../../../server-web/lib/agent-gateway-client";
import {
  getSettings,
  probeModel,
  saveSettings,
} from "../../../server-web/lib/agent-settings-client";
import {
  getDiscoveryClients,
  getDiscoveryConfig,
  saveDiscoveryConfig,
} from "../../../server-web/lib/discovery-client";
import {
  createUploadSession,
  getUploadSession,
  uploadSessionChunk,
} from "../../../server-web/lib/upload-session-client";
import {
  getCodexOAuthStatus,
  startCodexOAuthLogin,
} from "../../../server-web/lib/codex-oauth-client";
import {
  listKnowledgeReviewItems,
  resolveKnowledgeReviewItem,
} from "../../../server-web/lib/knowledge-review-client";
import {
  getProductionHealth,
  getV001BaselineStatus,
} from "../../../server-web/lib/production-health-client";
import {
  browseServerPath,
  getRuntimeInfo,
} from "../../../server-web/lib/runtime-info-client";
import {
  reloadRuntimeMounts,
  saveRuntimeMounts,
} from "../../../server-web/lib/runtime-mounts-client";
import { listAgents } from "../../../server-web/lib/agent-registry-client";
import { getServerConsoleState } from "../../../server-web/lib/console-state-client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("server-web zero-gap API clients", () => {
  it("builds agent gateway and settings requests", () => {
    getAgentGatewayConfig();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/agent-gateway/config");

    saveAgentGatewayConfig({ enabled: true } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/agent-gateway/config",
      { config: { enabled: true } },
      { safetyConfirm: true },
    );

    callAgentGateway({ prompt: "hello" } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/agent-gateway/call",
      { prompt: "hello" },
    );

    getSettings();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/settings");

    saveSettings({ modelProviders: [] } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/settings",
      { modelProviders: [] },
      { safetyConfirm: true },
    );

    probeModel({ provider: "openai", modelAlias: "fast" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/settings/model-probe",
      { provider: "openai", modelAlias: "fast" },
    );
  });

  it("builds discovery, upload-session and oauth requests", () => {
    getDiscoveryConfig();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/discovery/config");

    saveDiscoveryConfig({ mode: "standalone" } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/discovery/config",
      { value: { mode: "standalone" } },
      { safetyConfirm: true },
    );

    getDiscoveryClients();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/discovery/clients");

    createUploadSession({ files: [{ name: "a.txt" }] });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/upload-sessions",
      { files: [{ name: "a.txt" }] },
    );

    uploadSessionChunk("session/1", 2, 128, new Blob(["chunk"]));
    expect(bridgeMocks.putBinaryJson).toHaveBeenLastCalledWith(
      "/api/upload-sessions/session%2F1/files/2?offset=128",
      expect.any(Blob),
    );

    getUploadSession("session/1");
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/upload-sessions/session%2F1");

    getCodexOAuthStatus();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/oauth/codex/status");

    startCodexOAuthLogin();
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith("/api/oauth/codex/login", {});
  });

  it("builds review, runtime, production and registry requests", () => {
    listKnowledgeReviewItems({ status: "needs review", limit: 7 });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/review-items?status=needs%20review&limit=7",
    );

    listKnowledgeReviewItems();
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/review-items?status=pending&limit=100",
    );

    resolveKnowledgeReviewItem("review/1", { resolution: "accepted" });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/knowledge/review-items/review%2F1/resolve",
      { resolution: "accepted" },
      { safetyConfirm: true },
    );

    getProductionHealth();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/production/health");

    getV001BaselineStatus();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/v001/baseline/status");

    getRuntimeInfo();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/runtime/info");

    browseServerPath({ path: "/tmp/pact", mode: "directory", includeHidden: true });
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/runtime/path-browse",
      { path: "/tmp/pact", mode: "directory", includeHidden: true },
    );

    saveRuntimeMounts({ mounts: [] } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/runtime/mounts",
      { value: { mounts: [] } },
      { safetyConfirm: true },
    );

    reloadRuntimeMounts({ modelProviders: [] } as any);
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/runtime/mounts/reload",
      { settings: { modelProviders: [] } },
      { safetyConfirm: true },
    );

    reloadRuntimeMounts();
    expect(bridgeMocks.postJson).toHaveBeenLastCalledWith(
      "/api/runtime/mounts/reload",
      {},
      { safetyConfirm: true },
    );

    listAgents();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/agents");

    getServerConsoleState();
    expect(bridgeMocks.getJson).toHaveBeenLastCalledWith("/api/console/state");
  });
});
