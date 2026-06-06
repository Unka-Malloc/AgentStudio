import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callCodexChatGptJson: vi.fn(),
  getCodexOAuthStatus: vi.fn(),
  resolveModelForModule: vi.fn(),
  loadKnowledgeGuidance: vi.fn(),
  classifyTextByKnowledgeTaxonomy: vi.fn(),
  loadBundledKnowledgeTaxonomy: vi.fn(),
  taxonomyPaths: vi.fn()
}));

vi.mock("../../../server/platform/common/security/auth/codex-oauth-service.mjs", () => ({
  callCodexChatGptJson: mocks.callCodexChatGptJson,
  getCodexOAuthStatus: mocks.getCodexOAuthStatus
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  resolveModelForModule: mocks.resolveModelForModule
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  loadKnowledgeGuidance: mocks.loadKnowledgeGuidance
}));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/default-taxonomy.mjs", () => ({
  classifyTextByKnowledgeTaxonomy: mocks.classifyTextByKnowledgeTaxonomy,
  loadBundledKnowledgeTaxonomy: mocks.loadBundledKnowledgeTaxonomy,
  taxonomyPaths: mocks.taxonomyPaths
}));

import { enhanceAffairTaxonomy } from "../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/service.mjs";

const originalFetch = globalThis.fetch;

function taxonomyFixture() {
  return {
    fallbackPath: "general/fallback",
    defaultIntent: "general",
    keywordStopwords: ["the", "and", "from"],
    fallbackIntents: [
      { terms: ["renewal", "invoice"], intent: "renewal-review" },
      { terms: ["contract"], intent: "contract-review" }
    ],
    classifierPrompt: {
      role: "Classify business mail.",
      rules: ["Return one item per document."],
      outputSchema: "{\"items\":[{\"id\":\"string\"}]}"
    },
    categories: [
      { path: "finance/billing" },
      { path: "legal/contracts" }
    ]
  };
}

function sampleDocument(overrides = {}) {
  return {
    id: "doc-a",
    messageKey: "msg-a",
    docId: 7,
    title: "Invoice renewal terms invoice",
    sender: "Acme Billing <billing@acme.example>",
    recipients: "ops@example.test",
    mailboxPath: "Inbox/Finance",
    localTaxonomyPath: "finance/billing",
    localKeywords: ["Renewal", "renewal", "Contract"],
    date: "2026-06-04",
    ...overrides
  };
}

beforeEach(() => {
  const taxonomy = taxonomyFixture();
  mocks.loadBundledKnowledgeTaxonomy.mockReturnValue(taxonomy);
  mocks.loadKnowledgeGuidance.mockResolvedValue(taxonomy);
  mocks.taxonomyPaths.mockImplementation((value = taxonomy) => [
    ...(value.categories || []).map((entry) => entry.path),
    value.fallbackPath
  ]);
  mocks.classifyTextByKnowledgeTaxonomy.mockImplementation((text, { fallbackPath = "" } = {}) => {
    const normalized = String(text || "").toLowerCase();
    if (normalized.includes("invoice") || normalized.includes("billing")) {
      return {
        path: "finance/billing",
        positiveHits: ["invoice", "billing"],
        intentLabel: "renewal-review",
        confidence: 0.88
      };
    }
    return {
      path: fallbackPath || "general/fallback",
      positiveHits: [],
      intentLabel: "general",
      confidence: 0.35
    };
  });
  mocks.resolveModelForModule.mockReturnValue({
    provider: "google-gemini",
    model: "gemini-test",
    enabled: false
  });
  mocks.getCodexOAuthStatus.mockResolvedValue({ valid: true });
  mocks.callCodexChatGptJson.mockResolvedValue({ items: [] });
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

describe("knowledge taxonomy service extra coverage", () => {
  it("uses local fallback when cloud enhancement is disabled or no valid documents are selected", async () => {
    const disabled = await enhanceAffairTaxonomy({
      documents: [null, {}, sampleDocument()],
      settings: {},
      userDataPath: ""
    });

    expect(disabled).toMatchObject({
      provider: "local-fallback",
      executed: false,
      model: "",
      warnings: ["云端语义增强未启用。"]
    });
    expect(disabled.items).toHaveLength(1);
    expect(disabled.items[0]).toMatchObject({
      id: "doc-a",
      messageKey: "msg-a",
      docId: 7,
      taxonomyPath: "finance/billing",
      entity: "Acme Billing",
      intent: "renewal-review",
      confidence: 0.88,
      provider: "local-fallback"
    });
    expect(disabled.items[0].keywords).toEqual(expect.arrayContaining(["invoice", "renewal", "Contract"]));

    mocks.resolveModelForModule.mockReturnValue({ provider: "google-gemini", model: "gemini-test", enabled: true });
    const empty = await enhanceAffairTaxonomy({ documents: [], settings: {}, userDataPath: "" });
    expect(empty).toMatchObject({
      provider: "local-fallback",
      executed: false,
      warnings: []
    });
    expect(empty.items).toEqual([]);
  });

  it("falls back when ChatGPT OAuth is unavailable and normalizes successful ChatGPT responses", async () => {
    mocks.resolveModelForModule.mockReturnValue({
      provider: "openai-chatgpt",
      model: "gpt-test",
      enabled: true
    });
    mocks.getCodexOAuthStatus.mockResolvedValueOnce({ valid: false, reason: "expired" });

    const authRequired = await enhanceAffairTaxonomy({
      documents: [sampleDocument()],
      settings: {},
      userDataPath: "/tmp/pact-taxonomy-guidance"
    });

    expect(mocks.loadKnowledgeGuidance).toHaveBeenCalledWith("/tmp/pact-taxonomy-guidance");
    expect(authRequired).toMatchObject({
      provider: "local-fallback",
      executed: false,
      model: "gpt-test",
      authRequired: true,
      authStatus: { valid: false, reason: "expired" }
    });
    expect(authRequired.warnings[0]).toContain("expired");

    mocks.getCodexOAuthStatus.mockResolvedValueOnce({ valid: true });
    mocks.callCodexChatGptJson.mockResolvedValueOnce({
      items: [
        {
          id: "msg-a",
          taxonomyPath: "legal/contracts",
          keywords: ["Contract", "contract", "renewal"],
          entity: "Acme Cloud Contracting Unit With A Very Long Name",
          intent: "contract-review",
          confidence: 1.4
        }
      ]
    });

    const enhanced = await enhanceAffairTaxonomy({
      documents: [sampleDocument()],
      settings: {},
      userDataPath: ""
    });

    expect(enhanced).toMatchObject({
      provider: "openai-chatgpt",
      executed: true,
      model: "gpt-test",
      warnings: []
    });
    expect(mocks.callCodexChatGptJson.mock.calls[0][0]).toMatchObject({ model: "gpt-test" });
    expect(mocks.callCodexChatGptJson.mock.calls[0][0].prompt).toContain("msg-a");
    expect(enhanced.items[0]).toMatchObject({
      taxonomyPath: "legal/contracts",
      provider: "openai-chatgpt",
      confidence: 1
    });
    expect(enhanced.items[0].keywords).toEqual(["Contract", "renewal"]);
  });

  it("marks ChatGPT cloud failures as local-after-cloud-error fallbacks", async () => {
    mocks.resolveModelForModule.mockReturnValue({
      provider: "openai-chatgpt",
      model: "gpt-test",
      enabled: true
    });
    const error = new Error("OAuth required");
    error.code = "CODEX_OAUTH_REQUIRED";
    mocks.callCodexChatGptJson.mockRejectedValueOnce(error);

    const result = await enhanceAffairTaxonomy({
      documents: [sampleDocument()],
      settings: {},
      userDataPath: ""
    });

    expect(result).toMatchObject({
      provider: "local-fallback",
      executed: false,
      model: "gpt-test",
      authRequired: true
    });
    expect(result.warnings[0]).toContain("OAuth required");
    expect(result.items[0].provider).toBe("local-after-cloud-error");
  });

  it("handles Gemini missing API keys, successful fenced JSON responses, and HTTP failures", async () => {
    mocks.resolveModelForModule.mockReturnValue({
      provider: "google-gemini",
      model: "gemini-test",
      enabled: true
    });

    const missingKey = await enhanceAffairTaxonomy({
      documents: [sampleDocument()],
      settings: {},
      userDataPath: ""
    });
    expect(missingKey).toMatchObject({
      provider: "local-fallback",
      executed: false,
      model: "gemini-test"
    });
    expect(missingKey.warnings).toEqual(["Google Gemini API Key 未配置。"]);

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "```json\n{\"items\":[{\"id\":\"msg-a\",\"taxonomyPath\":\"unknown/path\",\"keywords\":[\"Gemini\",\"gemini\"],\"entity\":\"Gemini Entity\",\"intent\":\"renewal\",\"confidence\":0.44}]}\n```"
                }
              ]
            }
          }
        ]
      })
    }));

    const enhanced = await enhanceAffairTaxonomy({
      documents: [sampleDocument()],
      settings: { googleApiKey: "key-1" },
      userDataPath: ""
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/models/gemini-test:generateContent"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "key-1" })
      })
    );
    expect(enhanced).toMatchObject({
      provider: "google-gemini",
      executed: true,
      model: "gemini-test",
      warnings: []
    });
    expect(enhanced.items[0]).toMatchObject({
      taxonomyPath: "finance/billing",
      keywords: ["Gemini"],
      entity: "Gemini Entity",
      intent: "renewal",
      confidence: 0.44,
      provider: "google-gemini"
    });

    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "rate limited" } })
    }));

    const failed = await enhanceAffairTaxonomy({
      documents: [sampleDocument({ id: "", messageKey: "msg-b", localTaxonomyPath: "legal/contracts" })],
      settings: { googleApiKey: "key-1" },
      userDataPath: ""
    });
    expect(failed).toMatchObject({
      provider: "local-fallback",
      executed: false,
      model: "gemini-test"
    });
    expect(failed.warnings[0]).toContain("rate limited");
    expect(failed.items[0]).toMatchObject({
      messageKey: "msg-b",
      taxonomyPath: "finance/billing",
      provider: "local-after-cloud-error"
    });
  });
});
