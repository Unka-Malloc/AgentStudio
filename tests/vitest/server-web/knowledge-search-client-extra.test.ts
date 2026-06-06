import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectKnowledgeBackend,
  getKnowledgeEvidence,
  knowledgeAssetUrl,
  listKnowledgeSpaces,
  recordKnowledgeFeedback,
  renderKnowledgeMarkdown,
  requestKnowledgeExport,
  requestKnowledgePermission,
  searchKnowledge,
} from "../../../server-web/lib/knowledge-search-client";

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

describe("knowledge search client extra coverage", () => {
  it("posts search, feedback, and markdown render payloads", async () => {
    const searchPayload = { query: "alpha", limit: 3 };
    const feedbackPayload = { evidenceId: "ev-1", rating: "up" };
    const markdownPayload = { evidenceId: "ev-1", format: "markdown" };

    await searchKnowledge(searchPayload);
    await recordKnowledgeFeedback(feedbackPayload);
    await renderKnowledgeMarkdown(markdownPayload);

    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      1,
      "/api/knowledge/search",
      searchPayload,
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      2,
      "/api/knowledge/feedback",
      feedbackPayload,
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      3,
      "/api/knowledge/render/markdown",
      markdownPayload,
    );
  });

  it("posts safety-confirmed backend, export, and permission requests", async () => {
    const backendPayload = { provider: "local", spaceId: "space-a" };
    const exportPayload = { evidenceId: "ev-2" };
    const permissionPayload = { evidenceId: "ev-3", reason: "review" };

    await connectKnowledgeBackend(backendPayload);
    await requestKnowledgeExport(exportPayload);
    await requestKnowledgePermission(permissionPayload);

    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      1,
      "/api/knowledge/backend/connect",
      backendPayload,
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      2,
      "/api/knowledge/export/request",
      exportPayload,
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenNthCalledWith(
      3,
      "/api/knowledge/permission/request",
      permissionPayload,
      { safetyConfirm: true },
    );
  });

  it("lists spaces with optional provider filters", async () => {
    await listKnowledgeSpaces();
    await listKnowledgeSpaces({ provider: "local backend" });

    expect(bridgeHttpMock.getJson).toHaveBeenNthCalledWith(1, "/api/knowledge/spaces");
    expect(bridgeHttpMock.getJson).toHaveBeenNthCalledWith(
      2,
      "/api/knowledge/spaces?provider=local+backend",
    );
  });

  it("encodes evidence and asset identifiers", async () => {
    await getKnowledgeEvidence("evidence / alpha");

    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/knowledge/evidence/evidence%20%2F%20alpha",
    );
    expect(knowledgeAssetUrl("asset / 1")).toBe("/api/knowledge/assets/asset%20%2F%201");
  });
});
