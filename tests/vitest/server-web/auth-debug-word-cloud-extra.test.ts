// @vitest-environment jsdom
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
} from "../../../server-web/lib/auth-client";
import { createConsoleAuthController } from "../../../server-web/composables/console-auth-controller";
import { getSettings } from "../../../server-web/lib/agent-settings-client";
import { createJob, getJob } from "../../../server-web/lib/jobs-client";
import {
  createKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRunArtifacts,
} from "../../../server-web/lib/knowledge-distillation-workbench";
import { createKnowledgeUploadSession } from "../../../server-web/lib/knowledge-upload-session";
import { createDebugDistillationRunner } from "../../../server-web/composables/console-debug-distillation-runner";
import { createConsoleWordCloudEditorController } from "../../../server-web/composables/console-word-cloud-editor-controller";
import type { ConsoleAuthSummary, ConsoleUser } from "../../../server-web/lib/auth-types";
import type {
  KnowledgeWordCloudSet,
  KnowledgeWordCloudState,
} from "../../../server-web/lib/types";

vi.mock("../../../server-web/lib/auth-client", () => ({
  getAuthOidc: vi.fn(),
  getAuthSession: vi.fn(),
  listAuthAudit: vi.fn(),
  listAuthSessions: vi.fn(),
  listAuthUsers: vi.fn(),
  loginAuth: vi.fn(),
  logoutAuth: vi.fn(),
  revokeAuthSession: vi.fn(),
  saveAuthOidc: vi.fn(),
  updateAuthUser: vi.fn(),
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  getSettings: vi.fn(),
}));

vi.mock("../../../server-web/lib/jobs-client", () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-distillation-workbench", () => ({
  createKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRunArtifacts: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-upload-session", () => ({
  createKnowledgeUploadSession: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  waitForConsoleDelay: vi.fn(async () => undefined),
}));

const mockedGetAuthOidc = vi.mocked(getAuthOidc);
const mockedGetAuthSession = vi.mocked(getAuthSession);
const mockedListAuthAudit = vi.mocked(listAuthAudit);
const mockedListAuthSessions = vi.mocked(listAuthSessions);
const mockedListAuthUsers = vi.mocked(listAuthUsers);
const mockedLoginAuth = vi.mocked(loginAuth);
const mockedLogoutAuth = vi.mocked(logoutAuth);
const mockedRevokeAuthSession = vi.mocked(revokeAuthSession);
const mockedSaveAuthOidc = vi.mocked(saveAuthOidc);
const mockedUpdateAuthUser = vi.mocked(updateAuthUser);
const mockedGetSettings = vi.mocked(getSettings);
const mockedCreateJob = vi.mocked(createJob);
const mockedGetJob = vi.mocked(getJob);
const mockedCreateKnowledgeDistillationWorkbenchRun = vi.mocked(createKnowledgeDistillationWorkbenchRun);
const mockedGetKnowledgeDistillationWorkbenchRun = vi.mocked(getKnowledgeDistillationWorkbenchRun);
const mockedGetKnowledgeDistillationWorkbenchRunArtifacts = vi.mocked(getKnowledgeDistillationWorkbenchRunArtifacts);
const mockedCreateKnowledgeUploadSession = vi.mocked(createKnowledgeUploadSession);

beforeEach(() => {
  vi.clearAllMocks();
});

function authUser(overrides: Partial<ConsoleUser> = {}): ConsoleUser {
  return {
    userId: "user-1",
    username: "alice",
    displayName: "Alice",
    roleId: "admin",
    roleLabel: "Admin",
    scopes: ["auth:admin", "knowledge:read", "knowledge:write", "runtime:admin"],
    enabled: true,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    lastLoginAt: "",
    ...overrides,
  };
}

function authSummary(authenticated = true, overrides: Partial<ConsoleAuthSummary> = {}): ConsoleAuthSummary {
  const user = authenticated ? authUser() : null;
  return {
    enabled: true,
    bootstrap: {
      required: false,
      tokenPrefix: "pact",
      tokenFilePath: "",
    },
    session: {
      authenticated,
      csrfToken: authenticated ? "csrf" : "",
      expiresAt: "2026-06-05T00:00:00.000Z",
      user,
    },
    roles: [
      {
        roleId: "admin",
        label: "Admin",
        scopes: user?.scopes || [],
      },
    ],
    oidc: {
      enabled: false,
      issuer: "",
      clientId: "",
      clientSecretConfigured: false,
      redirectUri: "",
      allowedDomains: [],
      roleMapping: {},
      updatedAt: "",
    },
    ...overrides,
  };
}

function createAuthHarness() {
  const busy = ref("");
  const controller = createConsoleAuthController({
    consoleState: ref({ authenticated: true } as never),
    error: ref(""),
    clearAllBusy: vi.fn(() => {
      busy.value = "";
    }),
    refreshState: vi.fn(async () => ({ ok: true })),
    resetServerEventCursor: vi.fn(),
    setBusy: vi.fn((key: string) => {
      busy.value = key;
    }),
    startServerEventSubscription: vi.fn(),
    stopServerEventSubscription: vi.fn(),
  });
  return { busy, controller };
}

function createWordCloudSet(overrides: Partial<KnowledgeWordCloudSet> = {}): KnowledgeWordCloudSet {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    wordBagSetId: "set-1",
    title: "Terms",
    status: "draft",
    wordBagCount: 1,
    termsSnapshot: [
      { term: "alpha", frequency: 4 },
      { term: "beta", frequency: 2 },
    ],
    wordBags: [
      {
        wordBagId: "bag-1",
        label: "Bag 1",
        summary: "Original",
        relation: "overlap",
        absorbThreshold: 0.6,
        terms: [{ term: "alpha", frequency: 1 }],
        removedTerms: [],
        children: [],
      },
    ],
    unassignedTerms: [{ term: "beta", frequency: 2 }],
    corpusPaths: [{ path: "docs", type: "directory" }],
    modelAlias: "model-a",
    ...overrides,
  };
}

describe("console auth controller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes auth state, logs in, loads admin data, and saves OIDC config", async () => {
    mockedGetAuthSession
      .mockResolvedValueOnce(authSummary(false))
      .mockResolvedValue(authSummary(true));
    mockedLoginAuth.mockResolvedValue({ ok: true } as never);
    mockedListAuthUsers.mockResolvedValue({ users: [authUser()] });
    mockedListAuthAudit.mockResolvedValue({ items: [{ auditId: "audit-1", operationId: "auth.login", status: "ok", error: "", createdAt: "" }] });
    mockedListAuthSessions.mockResolvedValue({ sessions: [{ sessionId: "session-1" }] });
    mockedGetAuthOidc.mockResolvedValue({
      oidc: {
        enabled: true,
        issuer: "https://issuer.example",
        clientId: "client",
        clientSecretConfigured: true,
        redirectUri: "https://console.example/callback",
        allowedDomains: ["example.com", "corp.example"],
        roleMapping: { admin: "admin" },
        updatedAt: "2026-06-04T00:00:00.000Z",
      },
    });
    mockedSaveAuthOidc.mockResolvedValue({
      oidc: {
        enabled: true,
        issuer: "https://issuer.example",
        clientId: "client",
        clientSecretConfigured: true,
        redirectUri: "https://console.example/callback",
        allowedDomains: ["example.com", "corp.example"],
        roleMapping: { viewer: "viewer" },
        updatedAt: "2026-06-04T01:00:00.000Z",
      },
    });
    const harness = createAuthHarness();

    await harness.controller.refreshAuthState();
    expect(harness.controller.isAuthenticated.value).toBe(false);
    expect(harness.controller.authBootstrapping.value).toBe(false);

    harness.controller.loginForm.value = { username: "alice", password: "secret" };
    await harness.controller.submitLoginAuth();
    expect(mockedLoginAuth).toHaveBeenCalledWith({ username: "alice", password: "secret" });
    expect(harness.controller.isAuthenticated.value).toBe(true);
    expect(harness.controller.canAdminAuth.value).toBe(true);

    await harness.controller.refreshAuthAdmin();
    expect(mockedListAuthAudit).toHaveBeenCalledWith(80);
    expect(harness.controller.authUsers.value[0].username).toBe("alice");
    expect(harness.controller.oidcAllowedDomainsText.value).toBe("example.com\ncorp.example");
    expect(harness.controller.oidcRoleMappingText.value).toContain("\"admin\"");

    harness.controller.oidcAllowedDomainsText.value = "example.com, corp.example";
    harness.controller.oidcRoleMappingText.value = "{\"viewer\":\"viewer\"}";
    await harness.controller.saveOidcConfig();
    expect(mockedSaveAuthOidc).toHaveBeenCalledWith(expect.objectContaining({
      allowedDomains: ["example.com", "corp.example"],
      roleMapping: { viewer: "viewer" },
    }));
    expect(harness.controller.oidcDraft.value.clientSecret).toBe("");
  });

  it("updates users, revokes sessions, logs out, and reports admin errors", async () => {
    mockedGetAuthSession.mockResolvedValue(authSummary(true));
    mockedUpdateAuthUser.mockResolvedValue({ users: [authUser({ roleId: "viewer" })] });
    mockedRevokeAuthSession.mockResolvedValue({ ok: true } as never);
    mockedListAuthUsers.mockRejectedValueOnce(new Error("admin failed")).mockResolvedValue({ users: [authUser()] });
    mockedListAuthAudit.mockResolvedValue({ items: [] });
    mockedListAuthSessions.mockResolvedValue({ sessions: [] });
    mockedGetAuthOidc.mockResolvedValue({ oidc: authSummary(true).oidc });
    mockedLogoutAuth.mockResolvedValue({ ok: true } as never);
    const harness = createAuthHarness();
    await harness.controller.refreshAuthState();

    await harness.controller.updateConsoleUser(authUser(), { roleId: "viewer" });
    expect(harness.controller.authUsers.value[0].roleId).toBe("viewer");

    await harness.controller.refreshAuthAdmin();
    expect(harness.controller.authUsers.value[0].roleId).toBe("viewer");
    expect((harness.controller as never as { error: { value: string } }).error).toBeUndefined();

    await harness.controller.revokeConsoleSession("session-1");
    expect(mockedRevokeAuthSession).toHaveBeenCalledWith("session-1");

    harness.controller.oidcRoleMappingText.value = "{broken";
    await harness.controller.saveOidcConfig();
    expect(mockedSaveAuthOidc).toHaveBeenCalledTimes(0);

    await harness.controller.logoutConsole();
    expect(mockedLogoutAuth).toHaveBeenCalled();
    expect(harness.controller.authState.value?.session.authenticated).toBe(true);
  });
});

describe("debug distillation runner", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createDistillationHarness() {
    const runner = createDebugDistillationRunner({
      distillationFile: ref<File | null>(null),
      distillationStep: ref("idle"),
      distillationUploadPercent: ref(0),
      distillationJob: ref(null),
      distillationRun: ref(null),
      distillationArtifactSizes: ref({}),
      distillationError: ref(""),
      distillationStatusMessage: ref(""),
      distillationModelAlias: ref("model-a"),
      distillationModelReady: vi.fn(() => true),
      selectedDistillationModel: vi.fn(() => ({ value: "model-a", enabled: true })),
    });
    return runner;
  }

  it("validates input and completes a successful upload-parse-distill flow", async () => {
    mockedCreateKnowledgeUploadSession.mockImplementation(async (_files, options) => {
      options?.onProgress?.({ percent: 80, message: "上传中" });
      return { session: { sessionId: "upload-1" } } as never;
    });
    mockedGetSettings.mockResolvedValue({ settings: true } as never);
    mockedCreateJob.mockResolvedValue({ id: "job-1", status: "queued", stage: "queued" } as never);
    mockedGetJob.mockResolvedValue({ id: "job-1", status: "completed", stage: "done" } as never);
    mockedCreateKnowledgeDistillationWorkbenchRun.mockResolvedValue({ runId: "run-1", status: "running", stages: [] } as never);
    mockedGetKnowledgeDistillationWorkbenchRun.mockResolvedValue({
      runId: "run-1",
      status: "completed",
      stages: [
        {
          stageId: "knowledge-distillation",
          status: "completed",
          output: {
            markdown: "# Done",
            markdownLength: 6,
          },
        },
      ],
    } as never);
    mockedGetKnowledgeDistillationWorkbenchRunArtifacts.mockResolvedValue({
      items: [
        { artifactId: "markdown-artifact", stageId: "knowledge-distillation", format: "markdown", byteSize: 128 },
      ],
    } as never);
    const runner = createDistillationHarness();

    await runner.startDebugKnowledgeDistillation();
    expect((runner as never as { distillationError?: unknown }).distillationError).toBeUndefined();

    runner.handleDebugDistillationFileSelected([
      new File(["hello"], "sample.md", { type: "text/markdown" }),
    ]);
    await runner.startDebugKnowledgeDistillation();

    expect(mockedCreateKnowledgeUploadSession).toHaveBeenCalledWith(
      [expect.any(File)],
      expect.objectContaining({
        checkpointPrefix: "knowledge-distillation-debug",
      }),
    );
    expect(mockedCreateKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith(expect.objectContaining({
      modelAlias: "model-a",
      workflowScope: "document",
      maxRounds: 3,
    }));
  });

  it("surfaces model and terminal run failures", async () => {
    const runner = createDebugDistillationRunner({
      distillationFile: ref<File | null>(new File(["hello"], "sample.md")),
      distillationStep: ref("idle"),
      distillationUploadPercent: ref(0),
      distillationJob: ref(null),
      distillationRun: ref(null),
      distillationArtifactSizes: ref({}),
      distillationError: ref(""),
      distillationStatusMessage: ref(""),
      distillationModelAlias: ref(""),
      distillationModelReady: vi.fn(() => false),
      selectedDistillationModel: vi.fn(() => ({ reason: "模型不可用" })),
    });

    await runner.startDebugKnowledgeDistillation();
    expect(mockedCreateKnowledgeUploadSession).not.toHaveBeenCalled();

    mockedCreateKnowledgeUploadSession.mockResolvedValue({ session: { sessionId: "upload-1" } } as never);
    mockedGetSettings.mockResolvedValue({} as never);
    mockedCreateJob.mockResolvedValue({ id: "job-1", status: "completed" } as never);
    mockedGetJob.mockResolvedValue({ id: "job-1", status: "completed" } as never);
    mockedCreateKnowledgeDistillationWorkbenchRun.mockResolvedValue({ runId: "run-1", status: "running", stages: [] } as never);
    mockedGetKnowledgeDistillationWorkbenchRun.mockResolvedValue({
      runId: "run-1",
      status: "failed",
      error: "distill failed",
      stages: [],
    } as never);
    const failingRunner = createDebugDistillationRunner({
      distillationFile: ref<File | null>(new File(["hello"], "sample.md")),
      distillationStep: ref("idle"),
      distillationUploadPercent: ref(0),
      distillationJob: ref(null),
      distillationRun: ref(null),
      distillationArtifactSizes: ref({}),
      distillationError: ref(""),
      distillationStatusMessage: ref(""),
      distillationModelAlias: ref("model-a"),
      distillationModelReady: vi.fn(() => true),
      selectedDistillationModel: vi.fn(() => ({ value: "model-a", enabled: true })),
    });

    await failingRunner.startDebugKnowledgeDistillation();
    expect(mockedGetKnowledgeDistillationWorkbenchRun).toHaveBeenCalled();
  });
});

describe("word cloud editor controller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createWordCloudHarness(state: KnowledgeWordCloudState | null = null) {
    const wordCloudState = ref<KnowledgeWordCloudState | null>(state);
    const wordCloudDraft = ref<KnowledgeWordCloudSet | null>(null);
    const controller = createConsoleWordCloudEditorController({
      collapsedWordBagIds: ref(new Set<string>()),
      pinnedWordBagIds: ref(new Set<string>()),
      selectedWordBagId: ref(""),
      wordBagActionMenuId: ref(""),
      wordCloudCorpusPaths: ref([{ path: "fallback", type: "directory" }]),
      wordCloudDraft,
      wordCloudModelAlias: ref("model-a"),
      wordCloudState,
      wordCloudTermInputs: ref({}),
    });
    return { controller, wordCloudDraft, wordCloudState };
  }

  it("creates drafts from state, edits clouds, and manages term assignments", () => {
    const state: KnowledgeWordCloudState = {
      ok: true,
      terms: [
        { term: "alpha", frequency: 8 },
        { term: "gamma", frequency: 3 },
      ],
      corpusPaths: [{ path: "docs", type: "directory" }],
      wordBagSet: createWordCloudSet(),
      wordBagSets: [],
    };
    const harness = createWordCloudHarness(state);

    harness.controller.setWordCloudDraftFromState(state);
    expect(harness.controller.wordCloudTermWithFrequency({ term: "alpha", frequency: 1 }).frequency).toBe(8);
    expect(harness.controller.wordCloudCardRows.value[0].cloud.wordBagId).toBe("bag-1");

    harness.controller.selectWordCloud(harness.wordCloudDraft.value!.wordBags[0]);
    harness.controller.updateSelectedWordCloudField("label", "Renamed");
    expect(harness.controller.selectedWordCloud.value?.label).toBe("Renamed");

    harness.controller.addChildWordCloud("bag-1");
    const child = harness.controller.selectedWordCloud.value!;
    expect(child.parentWordBagId).toBe("bag-1");
    harness.controller.setWordCloudTermInput(child.wordBagId, "gamma");
    harness.controller.addTermInputToCloud(child.wordBagId);
    expect(harness.controller.selectedWordCloud.value?.terms.some((term) => term.term === "gamma")).toBe(true);

    harness.controller.removeTermFromCloud(child.wordBagId, { term: "gamma", frequency: 1 });
    expect(harness.controller.selectedWordCloud.value?.removedTerms?.[0]).toMatchObject({
      term: "gamma",
      removed: true,
    });
    harness.controller.clearRemovedTermsFromCloud(child.wordBagId);
    expect(harness.controller.selectedWordCloud.value?.removedTerms).toEqual([]);

    harness.controller.toggleWordCloudCollapsed("bag-1");
    expect(harness.controller.wordCloudCardRows.value).toHaveLength(1);
    harness.controller.pinWordCloud("bag-1");
    harness.controller.toggleWordCloudActionMenu("bag-1");
    expect(harness.controller.wordCloudCardStyle(harness.controller.wordCloudCardRows.value[0], 0)).toMatchObject({
      "--word-cloud-accent": expect.any(String),
    });
  });

  it("adds and removes manual clouds and applies saved sets into state", () => {
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
    const harness = createWordCloudHarness({
      ok: true,
      terms: [{ term: "delta", frequency: 5 }],
      corpusPaths: [],
      wordBagSet: null,
      wordBagSets: [],
    });

    const defaultSet = harness.controller.createDefaultWordCloudSet([{ term: "delta", frequency: 5 }]);
    expect(defaultSet.unassignedTerms?.[0].term).toBe("delta");

    harness.controller.addManualWordCloud();
    expect(harness.wordCloudDraft.value?.wordBags[0].label).toBe("词云 1");
    harness.controller.updateWordCloudField(harness.wordCloudDraft.value!.wordBags[0].wordBagId, "absorbThreshold", "0.9");
    expect(harness.wordCloudDraft.value?.wordBags[0].absorbThreshold).toBe(0.9);
    harness.controller.removeSelectedWordCloud();
    expect(harness.wordCloudDraft.value?.wordBags).toEqual([]);

    const saved = createWordCloudSet({ wordBagSetId: "saved-set", title: "Saved" });
    harness.controller.applySavedWordCloudSet(saved, {
      fallbackCorpusPaths: [{ path: "saved-docs", type: "directory" }],
    });
    expect(harness.wordCloudState.value?.wordBagSet?.wordBagSetId).toBe("saved-set");
    expect(harness.wordCloudState.value?.wordBagSets?.[0].wordBagSetId).toBe("saved-set");
    expect(harness.wordCloudDraft.value?.corpusPaths?.[0].path).toBe("docs");
  });
});
