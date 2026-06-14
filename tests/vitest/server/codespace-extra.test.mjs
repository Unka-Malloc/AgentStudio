import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  files: new Map(),
  mkdirs: [],
}));

const serverConfigMock = vi.hoisted(() => ({
  getDataDir: vi.fn(() => "/virtual/pact-server-data"),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(async (dir) => {
      fsState.mkdirs.push(dir);
    }),
    readFile: vi.fn(async (filePath) => {
      if (!fsState.files.has(filePath)) {
        const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        error.code = "ENOENT";
        throw error;
      }
      return fsState.files.get(filePath);
    }),
    writeFile: vi.fn(async (filePath, data) => {
      fsState.files.set(filePath, String(data));
    }),
  },
  mkdir: vi.fn(async (dir) => {
    fsState.mkdirs.push(dir);
  }),
  readFile: vi.fn(async (filePath) => {
    if (!fsState.files.has(filePath)) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      error.code = "ENOENT";
      throw error;
    }
    return fsState.files.get(filePath);
  }),
  writeFile: vi.fn(async (filePath, data) => {
    fsState.files.set(filePath, String(data));
  }),
}));

vi.mock("../../../server/platform/common/config/ServerConfig.mjs", () => ({
  ServerConfig: serverConfigMock,
}));

import {
  CODESPACE_PROTOCOL_VERSION,
  createCodespaceRegistry,
} from "../../../server/platform/specialized/capabilities/code-management/codespace/index.mjs";

const executeRepoOperationMock = vi.fn();
const executeGerritCommonOperationMock = vi.fn();
const uploadGerritGitChangeMock = vi.fn();

function providerConfigPath(baseDir) {
  return path.join(baseDir, "code-management", "codespace-providers.json");
}

function registryPath(baseDir) {
  return path.join(baseDir, "code-management", "codespace-registry.json");
}

function setJson(filePath, value) {
  fsState.files.set(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fsState.files.get(filePath));
}

function resetState() {
  fsState.files.clear();
  fsState.mkdirs.length = 0;
  serverConfigMock.getDataDir.mockClear();
  executeRepoOperationMock.mockReset();
  executeGerritCommonOperationMock.mockReset();
  uploadGerritGitChangeMock.mockReset();
}

function createRuntime(options = {}) {
  return createCodespaceRegistry({
    userDataPath: options.userDataPath,
    executeRepoOperation: executeRepoOperationMock,
    executeGerritCommonOperation: executeGerritCommonOperationMock,
    uploadGerritGitChange: uploadGerritGitChangeMock,
  });
}

beforeEach(() => {
  resetState();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("codespace provider config and path handling", () => {
  it("writes default provider config to the configured data dir and merges existing providers", async () => {
    const runtime = createRuntime();
    const manifest = await runtime.providerManifest();

    const defaultConfigPath = providerConfigPath("/virtual/pact-server-data");
    expect(manifest).toMatchObject({
      ok: true,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      configPath: defaultConfigPath,
      providerCount: 2,
      enabledProviderCount: 2,
      secretPolicy: "secretRefOnly",
      contractMode: true,
    });
    expect(manifest.providers.github).toMatchObject({
      provider: "github",
      enabled: true,
      mode: "contract",
      authType: "githubApp",
      repositoryPort: true,
      reviewPort: true,
    });
    expect(fsState.files.has(defaultConfigPath)).toBe(true);

    const customRoot = "/tmp/codespace-custom-root";
    const customConfigPath = providerConfigPath(customRoot);
    setJson(customConfigPath, {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:codespace-1",
      updatedAt: "2026-06-04T00:10:00.000Z",
      providers: {
        github: {
          provider: "github",
          enabled: false,
          mode: "live",
          authType: "githubApp",
          secretRef: "secret://custom/github",
          repositoryPort: true,
          reviewPort: false,
          capabilities: ["repo.status", "repo.status"],
        },
        gitlab: {
          provider: "gitlab",
          enabled: true,
          mode: "contract",
          authType: "token",
          secretRef: "secret://custom/gitlab",
          repositoryPort: false,
          reviewPort: true,
          capabilities: ["repo.status"],
        },
      },
    });

    const merged = await createRuntime({ userDataPath: customRoot }).providerManifest();
    expect(merged.configPath).toBe(customConfigPath);
    expect(merged.providerCount).toBe(3);
    expect(merged.enabledProviderCount).toBe(2);
    expect(merged.providers.github).toMatchObject({
      enabled: false,
      mode: "live",
      authType: "githubApp",
      secretRef: "secret://custom/github",
      reviewPort: false,
      capabilities: ["repo.status"],
    });
    expect(merged.providers.gitlab).toMatchObject({
      provider: "gitlab",
      enabled: true,
      mode: "contract",
      authType: "token",
      secretRef: "secret://custom/gitlab",
      repositoryPort: false,
      reviewPort: true,
    });
  });
});

describe("codespace repo port routing", () => {
  it("maps repo operations, preserves contract receipts, and blocks disabled providers", async () => {
    const root = "/tmp/codespace-repo-root";
    setJson(providerConfigPath(root), {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      updatedAt: "2026-06-04T00:00:00.000Z",
      providers: {
        github: {
          provider: "github",
          enabled: true,
          mode: "contract",
          authType: "githubApp",
          secretRef: "secret://pact/codespace/github-app",
          repositoryPort: true,
          reviewPort: true,
          capabilities: ["repository.status", "tree.list"],
        },
        gerrit: {
          provider: "gerrit",
          enabled: true,
          mode: "contract",
          authType: "serviceAccount",
          secretRef: "secret://pact/codespace/gerrit-service-account",
          repositoryPort: true,
          reviewPort: true,
          capabilities: ["repository.status", "tree.list"],
        },
      },
    });

    executeRepoOperationMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      repo: { repoId: "repo-1", branch: "feature/refactor" },
      data: { files: ["src/app.mjs"] },
    });

    const runtime = createRuntime({ userDataPath: root });
    const contractStatus = await runtime.repositoryStatus({
      provider: "gerrit",
      repositoryRef: "owner/repo",
    });

    expect(contractStatus).toMatchObject({
      ok: true,
      status: 200,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      operationId: "codespace.repository.status",
      provider: "gerrit",
      adapter: "RepositoryPort",
      repositoryRef: "owner/repo",
      branch: "main",
      data: {},
      receipt: {
        contractVerified: true,
        provider: "gerrit",
        providerMode: "contract",
        uploadState: "contract",
        secretRef: "secret://pact/codespace/gerrit-service-account",
        operationId: "codespace.repository.status",
        repositoryRef: "owner/repo",
        branch: "main",
      },
    });

    const treeResult = await runtime.listTree(
      {
        provider: "github",
        repoId: "repo-1",
        branchHint: "feature/refactor",
      },
      { authSession: { userId: "agent-1" } },
    );

    expect(executeRepoOperationMock).toHaveBeenCalledWith({
      operationId: "repo.tree.list",
      input: {
        provider: "github",
        repoId: "repo-1",
        branchHint: "feature/refactor",
      },
      authSession: { userId: "agent-1" },
    });
    expect(treeResult).toMatchObject({
      ok: true,
      status: 200,
      operationId: "codespace.tree.list",
      provider: "github",
      repositoryRef: "repo-1",
      branch: "feature/refactor",
      repo: { repoId: "repo-1", branch: "feature/refactor" },
      data: { files: ["src/app.mjs"] },
      receipt: {
        contractVerified: true,
        provider: "github",
        secretRef: "secret://pact/codespace/github-app",
        operationId: "codespace.tree.list",
        repoOperationId: "repo.tree.list",
      },
    });

    setJson(providerConfigPath(root), {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      updatedAt: "2026-06-04T00:20:00.000Z",
      providers: {
        github: {
          provider: "github",
          enabled: true,
          mode: "contract",
          authType: "githubApp",
          secretRef: "secret://pact/codespace/github-app",
          repositoryPort: true,
          reviewPort: true,
          capabilities: [],
        },
        gerrit: {
          provider: "gerrit",
          enabled: false,
          mode: "contract",
          authType: "serviceAccount",
          secretRef: "secret://pact/codespace/gerrit-service-account",
          repositoryPort: true,
          reviewPort: true,
          capabilities: [],
        },
      },
    });

    const disabledRuntime = createRuntime({ userDataPath: root });
    const disabled = await disabledRuntime.repositoryStatus({ provider: "gerrit" });
    expect(disabled).toMatchObject({
      ok: false,
      status: 409,
      error: "Codespace provider is disabled: gerrit",
    });
  });
});

describe("codespace target evaluation and change persistence", () => {
  it("evaluates fallback targets, prepares changes, and lists them in update order", async () => {
    const root = "/tmp/codespace-target-root";
    const runtime = createRuntime({ userDataPath: root });

    const fallback = await runtime.evaluateTarget({
      workspaceId: "ws-1",
      requestedAction: "draft",
      fallbackReason: "needs proposal fallback",
      repositoryRef: "owner/repo",
      branch: "feature/fallback",
      payloadKind: "sourceCode",
    });

    expect(fallback).toMatchObject({
      ok: true,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      accepted: true,
      routeDecision: "proposalFallback",
      policyDecision: "allow",
      fallbackReason: "needs proposal fallback",
      fallback: {
        targetKind: "workspaceProposal",
        operationId: "workspace.proposal.create",
        reason: "needs proposal fallback",
      },
    });
    expect(fallback.compatibleTargets[0]).toMatchObject({
      targetKind: "workspaceProposal",
      repositoryRef: "owner/repo",
      branch: "feature/fallback",
      reason: "code route requires a workspace proposal fallback",
    });

    const preparedPrimary = await runtime.prepareChange({
      workspaceId: "ws-1",
      targetId: fallback.target.targetId,
      repositoryRef: "owner/repo",
      branch: "feature/fallback",
      payloadKind: "repositoryChange",
      diff: "diff --git a/src/app.mjs b/src/app.mjs\n",
      files: [{ path: "src/app.mjs", status: "modified" }],
      commitPlan: ["Update app"],
      reviewStatus: "NEW",
      submitStatus: "submitted",
      checkpointNodeId: "checkpoint-1",
    });

    expect(preparedPrimary).toMatchObject({
      ok: true,
      prepared: true,
      reviewStatus: "open",
      submitStatus: "submitted",
      targetId: fallback.target.targetId,
      workspaceId: "ws-1",
      repositoryRef: "owner/repo",
      branch: "feature/fallback",
    });
    expect(preparedPrimary.changeSet).toMatchObject({
      payloadKind: "repositoryChange",
      dataClass: "repositoryChange",
      fileCount: 1,
      diffSha256: expect.any(String),
      commitPlan: [{ message: "Update app" }],
      files: [{ path: "src/app.mjs", status: "modified" }],
    });

    await vi.advanceTimersByTimeAsync(1000);

    const preparedSecondary = await runtime.prepareChange({
      workspaceId: "ws-1",
      targetId: fallback.target.targetId,
      repositoryRef: "owner/repo",
      branch: "feature/fallback",
      payloadKind: "repositoryChange",
      idempotencyKey: "later-change",
      diff: "diff --git a/src/other.mjs b/src/other.mjs\n",
      files: [{ path: "src/other.mjs", status: "added" }],
      commitPlan: [{ message: "Add other" }],
    });

    const list = await runtime.listChanges({ workspaceId: "ws-1" });
    expect(list).toMatchObject({
      ok: true,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      count: 2,
    });
    expect(list.items[0].codeChangeId).toBe(preparedSecondary.codeChangeId);
    expect(list.items[1].codeChangeId).toBe(preparedPrimary.codeChangeId);

    const lookup = await runtime.getChange({ codeChangeId: preparedPrimary.codeChangeId });
    expect(lookup).toMatchObject({
      ok: true,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      codeChangeId: preparedPrimary.codeChangeId,
      workspaceId: "ws-1",
      reviewStatus: "open",
      submitStatus: "submitted",
      target: {
        targetKind: "workspaceProposal",
      },
    });

    const storedRegistry = readJson(registryPath(root));
    expect(storedRegistry.events.map((event) => event.type)).toEqual([
      "code.route.evaluated",
      "code.change.fallback.created",
      "code.change.prepared",
      "code.change.prepared",
    ]);
    expect(storedRegistry.changes[preparedPrimary.codeChangeId].statusHistory).toHaveLength(1);
    expect(storedRegistry.changes[preparedSecondary.codeChangeId].statusHistory).toHaveLength(1);
  });
});

describe("codespace uploads, review actions, and sync status", () => {
  it("handles github uploads, review calls, upload validation errors, and gerrit syncs", async () => {
    const root = "/tmp/codespace-upload-root";
    setJson(providerConfigPath(root), {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      updatedAt: "2026-06-04T00:00:00.000Z",
      providers: {
        github: {
          provider: "github",
          enabled: true,
          mode: "contract",
          authType: "githubApp",
          secretRef: "secret://pact/codespace/github-app",
          repositoryPort: true,
          reviewPort: true,
          capabilities: ["change.upload", "review.approve"],
        },
        gerrit: {
          provider: "gerrit",
          enabled: true,
          mode: "contract",
          authType: "serviceAccount",
          secretRef: "secret://pact/codespace/gerrit-service-account",
          repositoryPort: true,
          reviewPort: true,
          capabilities: ["change.upload", "review.approve"],
        },
      },
    });

    const runtime = createRuntime({ userDataPath: root });

    const contractUpload = await runtime.uploadCodespaceChange({
      provider: "github",
      repositoryRef: "owner/repo",
      branch: "feature/github",
      title: "  New PR  ",
      dryRun: true,
    });
    expect(contractUpload).toMatchObject({
      ok: true,
      status: 200,
      operationId: "codespace.change.upload",
      provider: "github",
      contractVerified: true,
      providerMode: "contract",
      uploadState: "dry-run",
      dryRun: true,
      target: {
        targetKind: "codespace",
        targetProvider: "github",
        repositoryRef: "owner/repo",
        branch: "feature/github",
      },
      completion: {
        confirmed: false,
        dryRun: true,
        contractVerified: true,
        providerMode: "contract",
        uploadState: "dry-run",
        provider: "github",
        secretRef: "secret://pact/codespace/github-app",
      },
    });
    expect(executeRepoOperationMock).not.toHaveBeenCalled();

    executeRepoOperationMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        reviewUrl: "https://github.com/owner/repo/pull/77",
        changeNumber: "77",
        changeId: "github_pr_77",
        providerMode: "live",
      },
    });

    const liveUpload = await runtime.uploadCodespaceChange({
      provider: "github",
      repoId: "repo-77",
      worktreePath: "/worktrees/repo-77",
      repositoryRef: "owner/repo",
      branch: "feature/live",
      title: "Live upload",
      dryRun: false,
    });
    expect(executeRepoOperationMock).toHaveBeenCalledWith({
      operationId: "repo.proposal.create",
      input: {
        provider: "github",
        repoId: "repo-77",
        worktreePath: "/worktrees/repo-77",
        repositoryRef: "owner/repo",
        branch: "feature/live",
        title: "Live upload",
        dryRun: false,
        sourceRef: "feature/live",
        targetRef: "feature/live",
      },
      authSession: undefined,
    });
    expect(liveUpload).toMatchObject({
      ok: true,
      status: 200,
      provider: "github",
      contractVerified: false,
      providerMode: "live",
      uploadState: "remote-live",
      dryRun: false,
      target: {
        targetKind: "codespace",
        targetProvider: "github",
        repositoryRef: "owner/repo",
        branch: "feature/live",
        changeRef: "github_pr_77",
        reviewUrl: "https://github.com/owner/repo/pull/77",
      },
      completion: {
        confirmed: true,
        dryRun: false,
        contractVerified: false,
        providerMode: "live",
        uploadState: "remote-live",
        provider: "github",
        secretRef: "secret://pact/codespace/github-app",
      },
    });
    expect(liveUpload.codeChange.reviewStatus).toBe("open");
    expect(liveUpload.codeChange.submitStatus).toBe("notSubmitted");

    executeRepoOperationMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        providerMode: "live",
        uploadState: "remote-live",
      },
    });

    const invalidUpload = await runtime.uploadCodespaceChange({
      provider: "github",
      repoId: "repo-77",
      worktreePath: "/worktrees/repo-77",
      repositoryRef: "owner/repo",
      branch: "feature/live-missing-url",
      title: "Broken upload",
      dryRun: false,
    });
    expect(invalidUpload).toMatchObject({
      ok: false,
      status: 502,
      error: "GitHub live PR creation did not return a review URL; refusing to record it as a remote-live upload.",
      providerMode: "live",
      uploadState: "remote-live",
    });

    executeRepoOperationMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { reviewed: true },
    });

    const review = await runtime.reviewApprove({
      provider: "gerrit",
      repoId: "repo-77",
      reviewTarget: "I1234567890",
      repositoryRef: "owner/repo",
      branch: "feature/live",
    });
    expect(executeRepoOperationMock).toHaveBeenCalledWith({
      operationId: "repo.review.approve",
      input: {
        provider: "gerrit",
        repoId: "repo-77",
        reviewTarget: "I1234567890",
        repositoryRef: "owner/repo",
        branch: "feature/live",
        dryRun: true,
      },
      authSession: undefined,
    });
    expect(review).toMatchObject({
      ok: true,
      status: 200,
      operationId: "codespace.review.approve",
      provider: "gerrit",
      reviewAction: "approve",
      contractVerified: true,
      providerReceipt: { reviewed: true },
    });
    expect(review.codeChange.reviewStatus).toBe("reviewed");
    expect(review.codeChange.submitStatus).toBe("notSubmitted");
  });

  it("fetches and normalizes Gerrit status updates when requested", async () => {
    const root = "/tmp/codespace-sync-root";
    setJson(providerConfigPath(root), {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      updatedAt: "2026-06-04T00:00:00.000Z",
      providers: {
        gerrit: {
          provider: "gerrit",
          enabled: true,
          mode: "contract",
          authType: "serviceAccount",
          secretRef: "secret://pact/codespace/gerrit-service-account",
          repositoryPort: true,
          reviewPort: true,
          capabilities: ["review.status.sync"],
        },
      },
    });

    executeGerritCommonOperationMock.mockResolvedValueOnce({
      ok: true,
      action: "changes.detail",
      mode: "read",
      gerrit: { host: "gerrit.internal.invalid" },
      result: {
        status: "MERGED",
        submitStatus: "submitted",
        change_id: "123456",
        _number: 42,
        current_revision: "deadbeef",
      },
    });

    const runtime = createRuntime({ userDataPath: root });
    const synced = await runtime.syncStatus({
      provider: "gerrit",
      fetchFromGerrit: true,
      changeId: "Iabcdef123",
      repositoryRef: "owner/repo",
      branch: "main",
      checkpointNodeId: "checkpoint-sync-1",
    });

    expect(executeGerritCommonOperationMock).toHaveBeenCalledWith({
      mode: "read",
      input: {
        provider: "gerrit",
        fetchFromGerrit: true,
        changeId: "Iabcdef123",
        repositoryRef: "owner/repo",
        branch: "main",
        checkpointNodeId: "checkpoint-sync-1",
        action: "changes.detail",
      },
    });
    expect(synced).toMatchObject({
      ok: true,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      operationId: "workspace.code.change.status.sync",
      synced: true,
      reviewStatus: "merged",
      submitStatus: "submitted",
      changeId: "Iabcdef123",
      changeNumber: "42",
      changeRef: "Iabcdef123",
    });
    expect(synced.providerReceipt).toMatchObject({
      ok: true,
      action: "changes.detail",
      mode: "read",
      result: {
        status: "MERGED",
        submitStatus: "submitted",
        change_id: "123456",
        _number: 42,
        current_revision: "deadbeef",
      },
    });
    expect(synced.statusHistory.at(-1)).toMatchObject({
      status: "status_synced",
      reviewStatus: "merged",
      submitStatus: "submitted",
    });
  });
});
