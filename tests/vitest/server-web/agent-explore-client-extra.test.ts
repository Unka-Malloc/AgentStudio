import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAgentWorkspace,
  getKnowledgeAgentExploreRun,
  listAgentWorkspaces,
  runKnowledgeAgentExplore,
} from "../../../server-web/lib/agent-explore-client";

const bridgeHttpMock = vi.hoisted(() => ({
  postJson: vi.fn(),
}));

vi.mock("../../../server-web/lib/bridge-http", () => ({
  postJson: bridgeHttpMock.postJson,
}));

beforeEach(() => {
  vi.clearAllMocks();
  bridgeHttpMock.postJson.mockReset();
  bridgeHttpMock.postJson.mockResolvedValue({ ok: true });
});

describe("agent explore client extra coverage", () => {
  it("posts knowledge agent explore runs with the original payload", async () => {
    const payload = {
      query: "find evidence",
      workspaceId: "workspace-a",
    };

    await expect(runKnowledgeAgentExplore(payload)).resolves.toEqual({ ok: true });

    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/agent-explore/runs",
      payload,
    );
  });

  it("loads agent explore runs with encoded ids and optional workspace query", async () => {
    await getKnowledgeAgentExploreRun("run / 1", {
      workspaceId: "workspace & alpha",
    });
    await getKnowledgeAgentExploreRun("run-plain");

    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      1,
      "/api/knowledge/agent-explore/runs/run%20%2F%201?workspaceId=workspace+%26+alpha",
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      2,
      "/api/knowledge/agent-explore/runs/run-plain",
    );
  });

  it("lists agent workspaces with optional limit and summary flags", async () => {
    await listAgentWorkspaces({ includeSummary: false, limit: 0 });
    await listAgentWorkspaces({ includeSummary: true, limit: 25 });
    await listAgentWorkspaces();

    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      1,
      "/api/agent-workspaces?limit=0&includeSummary=false",
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      2,
      "/api/agent-workspaces?limit=25&includeSummary=true",
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      3,
      "/api/agent-workspaces",
    );
  });

  it("loads one workspace with encoded ids and optional private fields", async () => {
    await getAgentWorkspace("workspace / alpha", { includePrivate: true });
    await getAgentWorkspace("workspace-beta", { includePrivate: false });
    await getAgentWorkspace("workspace-gamma");

    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      1,
      "/api/agent-workspaces/workspace%20%2F%20alpha?includePrivate=true",
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      2,
      "/api/agent-workspaces/workspace-beta?includePrivate=false",
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      3,
      "/api/agent-workspaces/workspace-gamma",
    );
  });
});
