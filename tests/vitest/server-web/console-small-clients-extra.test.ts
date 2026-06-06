// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function textResponse(text: string, init: ResponseInit = {}) {
  return new Response(text, {
    status: init.status || 200,
    headers: init.headers,
  });
}

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

async function loadAuthClient() {
  vi.resetModules();
  return import("../../../server-web/lib/auth-client");
}

async function loadServerEventsClient() {
  vi.resetModules();
  return import("../../../server-web/lib/server-events-client");
}

async function loadKnowledgeRulesClient() {
  vi.resetModules();
  return import("../../../server-web/lib/knowledge-rules-client");
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  globalThis.EventSource = vi.fn() as unknown as typeof EventSource;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
});

describe("server-web small clients extra coverage", () => {
  it("auth client serializes requests, encodes identifiers, and surfaces request failures", async () => {
    const {
      getAuthOidc,
      getAuthSession,
      listAuthAudit,
      listAuthSessions,
      listAuthUsers,
      loginAuth,
      logoutAuth,
      revokeAuthSession,
      saveAuthOidc,
      updateAuthUser,
    } = await loadAuthClient();

    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ session: { authenticated: true } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, csrfToken: "csrf-1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ users: [], roles: [] }))
      .mockResolvedValueOnce(jsonResponse({ user: { userId: "u-1" }, users: [] }))
      .mockResolvedValueOnce(jsonResponse({ oidc: { enabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ oidc: { enabled: false } }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ auditId: "a-1" }] }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [{ sessionId: "s-1" }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, { status: 404 }));

    await expect(getAuthSession()).resolves.toEqual({ session: { authenticated: true } });
    await expect(loginAuth({ username: "alice", password: "secret" })).resolves.toEqual({
      ok: true,
      csrfToken: "csrf-1",
    });
    await expect(logoutAuth()).resolves.toEqual({ ok: true });
    await expect(listAuthUsers()).resolves.toEqual({ users: [], roles: [] });
    await expect(
      updateAuthUser("user / 1", {
        displayName: "Alice",
        enabled: false,
      }),
    ).resolves.toEqual({ user: { userId: "u-1" }, users: [] });
    await expect(getAuthOidc()).resolves.toEqual({ oidc: { enabled: true } });
    await expect(saveAuthOidc({ enabled: false, clientSecret: "top-secret" })).resolves.toEqual({
      oidc: { enabled: false },
    });
    await expect(listAuthAudit(0)).resolves.toEqual({ items: [{ auditId: "a-1" }] });
    await expect(listAuthSessions()).resolves.toEqual({ sessions: [{ sessionId: "s-1" }] });
    await expect(revokeAuthSession("session / 9")).resolves.toEqual({ ok: true });
    await expect(
      updateAuthUser("missing-user", { displayName: "Missing" }),
    ).rejects.toThrow("not found");

    expect(fetchMock().mock.calls).toHaveLength(11);
    expect(fetchMock().mock.calls[0]).toEqual([
      "/api/auth/session",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }),
    ]);
    expect(fetchMock().mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ username: "alice", password: "secret" }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(fetchMock().mock.calls[4]).toEqual([
      "/api/auth/users/user%20%2F%201",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ displayName: "Alice", enabled: false }),
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-pact-safety-confirm": "true",
        }),
      }),
    ]);
    expect(fetchMock().mock.calls[7][0]).toBe("/api/auth/audit?limit=0");
    expect(fetchMock().mock.calls[9][0]).toBe("/api/auth/sessions/session%20%2F%209/revoke");
  });

  it("server event subscriptions serialize query parameters and forward request options", async () => {
    const { subscribeEvents } = await loadServerEventsClient();

    const signal = new AbortController().signal;
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ cursor: 1, nextCursor: 1, topics: [], events: [] }))
      .mockResolvedValueOnce(jsonResponse({ cursor: 2, nextCursor: 2, topics: [], events: [] }))
      .mockResolvedValueOnce(textResponse("temporary failure", { status: 500 }));

    await expect(subscribeEvents()).resolves.toEqual({
      cursor: 1,
      nextCursor: 1,
      topics: [],
      events: [],
    });
    await expect(
      subscribeEvents(
        {
          cursor: 0,
          topic: "knowledge events",
          timeoutMs: 0,
          includeSnapshot: false,
        },
        { signal },
      ),
    ).resolves.toEqual({
      cursor: 2,
      nextCursor: 2,
      topics: [],
      events: [],
    });
    await expect(
      subscribeEvents({
        cursor: 7,
        topic: "",
        timeoutMs: 2500,
        includeSnapshot: true,
      }),
    ).rejects.toThrow("temporary failure");

    expect(fetchMock().mock.calls[0]).toEqual([
      "/api/events",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
      }),
    ]);
    expect(fetchMock().mock.calls[1][0]).toBe(
      "/api/events?cursor=0&topic=knowledge+events&timeoutMs=0&includeSnapshot=0",
    );
    expect(fetchMock().mock.calls[1][1]).toMatchObject({
      method: "GET",
      signal,
    });
    expect(fetchMock().mock.calls[2][0]).toBe(
      "/api/events?cursor=7&timeoutMs=2500&includeSnapshot=1",
    );
  });

  it("knowledge rules client sends the expected endpoints and safety-confirmed payloads", async () => {
    const {
      chatKnowledgeRuleAuthoring,
      getEmailRules,
      getExpertVocabulary,
      getExpertVocabularyVersions,
      getGoldenRules,
      publishGoldenRules,
      saveEmailRules,
      saveExpertVocabulary,
      saveGoldenRules,
    } = await loadKnowledgeRulesClient();

    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ rules: [] }))
      .mockResolvedValueOnce(jsonResponse({ rules: [] }))
      .mockResolvedValueOnce(jsonResponse({ includeRules: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ vocabulary: [] }))
      .mockResolvedValueOnce(jsonResponse({ vocabulary: [] }))
      .mockResolvedValueOnce(jsonResponse({ versions: [] }))
      .mockResolvedValueOnce(jsonResponse({ draft: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "service unavailable" }, { status: 503 }));

    await expect(getEmailRules()).resolves.toEqual({ rules: [] });
    await expect(saveEmailRules({ items: [{ pattern: "alpha" }] } as never)).resolves.toEqual({
      rules: [],
    });
    await expect(getGoldenRules()).resolves.toEqual({ includeRules: true });
    await expect(saveGoldenRules({ enabled: true })).resolves.toEqual({ ok: true });
    await expect(publishGoldenRules("package / 1", { published: true })).resolves.toEqual({
      ok: true,
    });
    await expect(getExpertVocabulary()).resolves.toEqual({ vocabulary: [] });
    await expect(saveExpertVocabulary({ words: ["alpha"] } as never)).resolves.toEqual({
      vocabulary: [],
    });
    await expect(getExpertVocabularyVersions()).resolves.toEqual({ versions: [] });
    await expect(chatKnowledgeRuleAuthoring({ prompt: "draft a rule" })).resolves.toEqual({
      draft: true,
    });
    await expect(saveGoldenRules({ enabled: false })).rejects.toThrow("service unavailable");

    expect(fetchMock().mock.calls).toHaveLength(10);
    expect(fetchMock().mock.calls[0][0]).toBe("/api/email-rules");
    expect(fetchMock().mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ rules: { items: [{ pattern: "alpha" }] } }),
      headers: expect.objectContaining({
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-pact-safety-confirm": "true",
      }),
    });
    expect(fetchMock().mock.calls[2][0]).toBe("/api/knowledge/golden-rules?includeRules=true");
    expect(fetchMock().mock.calls[4][0]).toBe("/api/knowledge/golden-rules/package%20%2F%201/publish");
    expect(fetchMock().mock.calls[6][0]).toBe("/api/expert-vocabulary");
    expect(fetchMock().mock.calls[6][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ vocabulary: { words: ["alpha"] } }),
      headers: expect.objectContaining({
        "x-pact-safety-confirm": "true",
      }),
    });
    expect(fetchMock().mock.calls[7][0]).toBe("/api/expert-vocabulary/versions");
    expect(fetchMock().mock.calls[8][0]).toBe("/api/knowledge/rule-authoring/chat");
  });
});
