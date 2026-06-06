import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAgentSyncConfig,
  publishAgentSync,
  saveAgentSyncConfig,
  subscribeAgentSync,
} from "../../../server-web/lib/agent-sync-client";

const bridgeHttpMock = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

vi.mock("../../../server-web/lib/bridge-http", () => ({
  getJson: bridgeHttpMock.getJson,
  postJson: bridgeHttpMock.postJson,
}));

beforeEach(() => {
  vi.clearAllMocks();
  bridgeHttpMock.getJson.mockReset();
  bridgeHttpMock.postJson.mockReset();
  bridgeHttpMock.getJson.mockResolvedValue({ ok: true });
  bridgeHttpMock.postJson.mockResolvedValue({ ok: true });
});

describe("agent sync client extra coverage", () => {
  it("loads and saves sync configuration with safety confirmation", async () => {
    const config = {
      enabled: true,
      topics: [{ pattern: "knowledge.*", target: "agent-a" }],
    } as any;

    await getAgentSyncConfig();
    await saveAgentSyncConfig(config);

    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/agent-sync/config");
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-sync/config",
      { config },
      { safetyConfirm: true },
    );
  });

  it("publishes sync payloads", async () => {
    const payload = {
      payload: { message: "changed" },
      topic: "knowledge.updated",
    } as any;

    await publishAgentSync(payload);

    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/agent-sync/publish",
      payload,
    );
  });

  it("subscribes with encoded optional query params", async () => {
    await subscribeAgentSync();
    await subscribeAgentSync({
      cursor: 0,
      includeSnapshot: false,
      timeoutMs: 0,
      topic: "knowledge updated",
    });
    await subscribeAgentSync({
      cursor: 42,
      includeSnapshot: true,
      timeoutMs: 1500,
      topic: "agent.sync",
    });

    expect(bridgeHttpMock.getJson).toHaveBeenNthCalledWith(
      1,
      "/api/agent-sync/events",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenNthCalledWith(
      2,
      "/api/agent-sync/events?cursor=0&topic=knowledge+updated&timeoutMs=0&includeSnapshot=0",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenNthCalledWith(
      3,
      "/api/agent-sync/events?cursor=42&topic=agent.sync&timeoutMs=1500&includeSnapshot=1",
    );
  });
});
