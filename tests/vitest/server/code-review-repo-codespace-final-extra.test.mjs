import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const executeRepoOperationMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    spawn: spawnMock
  };
});

import {
  executeGerritCommonOperation,
  uploadGerritGitChange
} from "../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs";
import {
  executeRepoOperation
} from "../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs";
import {
  CODESPACE_PROTOCOL_VERSION,
  createCodespaceRegistry
} from "../../../server/platform/specialized/capabilities/code-management/codespace/index.mjs";

const ENV_KEYS = [
  "PACT_GERRIT_BASE_URL",
  "PACT_GERRIT_USERNAME",
  "PACT_GERRIT_HTTP_PASSWORD",
  "PACT_GERRIT_BEARER_TOKEN",
  "PACT_GERRIT_AUTH_MODE"
];

function createSpawnResult({
  code = 0,
  stdout = "",
  stderr = ""
} = {}) {
  const child = new EventEmitter();
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  const stdinStream = new PassThrough();
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.stdin = stdinStream;
  setImmediate(() => {
    if (stdout !== "") {
      stdoutStream.write(String(stdout));
    }
    if (stderr !== "") {
      stderrStream.write(String(stderr));
    }
    stdoutStream.end();
    stderrStream.end();
    child.emit("close", code);
  });
  return child;
}

function queueSpawnResponses(...responses) {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => createSpawnResult(responses.shift() || { code: 0, stdout: "", stderr: "" }));
}

function queueResolvedRepo({
  root = "/virtual/repo",
  head = "deadbeef",
  branch = "main"
} = {}) {
  queueSpawnResponses(
    { code: 0, stdout: `${root}\n` },
    { code: 0, stdout: `${head}\n` },
    { code: 0, stdout: `${branch}\n` }
  );
}

function createCodespaceRuntime(userDataPath) {
  return createCodespaceRegistry({
    userDataPath,
    executeRepoOperation: executeRepoOperationMock
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  executeRepoOperationMock.mockReset();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gerrit, repo-operations, and codespace final extra coverage", () => {
  it("covers Gerrit validation, patch boundaries, and git status failure handling", async () => {
    await expect(
      executeGerritCommonOperation({
        mode: "write",
        input: {
          action: "revisions.review.set",
          revision: "current"
        }
      })
    ).rejects.toThrow("Gerrit action requires input.changeId.");

    const patch = await executeGerritCommonOperation({
      mode: "read",
      input: {
        dryRun: true,
        action: "revisions.patch.get",
        changeId: "I123",
        revision: "7",
        zip: true,
        download: true
      }
    });

    expect(patch).toMatchObject({
      ok: true,
      dryRun: true,
      mode: "read",
      action: "revisions.patch.get",
      result: {
        method: "GET",
        path: "/changes/I123/revisions/7/patch",
        query: {
          zip: true,
          download: true
        }
      }
    });

    queueSpawnResponses(
      { code: 0, stdout: "https://review.example/internal/repo.git\n" },
      { code: 1, stderr: "" }
    );

    const upload = await uploadGerritGitChange({
      worktreePath: "/virtual/worktree",
      remote: "origin"
    });

    expect(upload).toMatchObject({
      ok: false,
      status: 400,
      worktreePath: "/virtual/worktree",
      error: "Unable to read git status."
    });
  });

  it("covers repo operation input gaps, branch/review edges, and diff command failure", async () => {
    const unsupported = await executeRepoOperation({
      operationId: "repo.invalid",
      input: {}
    });
    expect(unsupported).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "unsupported_repo_operation" }
    });
    expect(unsupported.error.details.allowedOperations).toEqual(
      expect.arrayContaining(["repo.diff.read", "repo.branch.create", "repo.review.approve"])
    );

    queueResolvedRepo();
    const missingPath = await executeRepoOperation({
      operationId: "repo.file.read",
      input: { repoId: "/virtual/repo" }
    });
    expect(missingPath).toMatchObject({
      ok: false,
      status: 400,
      error: {
        code: "repo_operation_failed",
        message: "Repo operation requires input.path."
      }
    });

    queueResolvedRepo();
    const missingBaseRef = await executeRepoOperation({
      operationId: "repo.branch.create",
      input: {
        repoId: "/virtual/repo",
        branchName: "feature/edge"
      }
    });
    expect(missingBaseRef).toMatchObject({
      ok: false,
      status: 400,
      error: {
        code: "repo_operation_failed",
        message: "Repo operation requires input.baseRef."
      }
    });

    queueResolvedRepo();
    const missingReviewTarget = await executeRepoOperation({
      operationId: "repo.review.approve",
      input: {
        repoId: "/virtual/repo"
      }
    });
    expect(missingReviewTarget).toMatchObject({
      ok: false,
      status: 400,
      error: {
        code: "repo_operation_failed",
        message: "Repo operation requires input.reviewTarget."
      }
    });

    queueSpawnResponses(
      { code: 0, stdout: "/virtual/repo\n" },
      { code: 0, stdout: "deadbeef\n" },
      { code: 0, stdout: "main\n" },
      { code: 1, stderr: "diff failed\n" }
    );
    const diffFailure = await executeRepoOperation({
      operationId: "repo.diff.read",
      input: {
        repoId: "/virtual/repo",
        baseRef: "HEAD~1",
        headRef: "HEAD"
      }
    });
    expect(diffFailure).toMatchObject({
      ok: false,
      status: 502,
      error: {
        code: "repo_operation_failed",
        message: "diff failed\n",
        details: {
          command: "git",
          stderr: "diff failed\n"
        }
      }
    });
  });

  it("creates codespace defaults without prior config and falls back to contract receipts when no local path exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codespace-final-extra-"));
    try {
      const runtime = createCodespaceRuntime(root);
      const manifest = await runtime.providerManifest();

      expect(manifest).toMatchObject({
        ok: true,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        configPath: path.join(root, "code-management", "codespace-providers.json"),
        providerCount: 2,
        enabledProviderCount: 2
      });

      const providerFile = JSON.parse(
        await fs.readFile(path.join(root, "code-management", "codespace-providers.json"), "utf8")
      );
      expect(providerFile.providers.github).toMatchObject({
        provider: "github",
        enabled: true
      });
      expect(providerFile.providers.gerrit).toMatchObject({
        provider: "gerrit",
        enabled: true
      });

      const repositoryStatus = await runtime.repositoryStatus({
        provider: "gerrit",
        repositoryRef: "owner/repo",
        branch: "feature/no-local"
      });
      expect(repositoryStatus).toMatchObject({
        ok: true,
        status: 200,
        operationId: "codespace.repository.status",
        adapter: "RepositoryPort",
        provider: "gerrit",
        data: {},
        receipt: {
          contractVerified: true,
          provider: "gerrit",
          operationId: "codespace.repository.status"
        }
      });
      expect(executeRepoOperationMock).not.toHaveBeenCalled();

      const prepared = await runtime.prepareChange({
        workspaceId: "ws-1",
        repositoryRef: "owner/repo",
        branch: "feature/patch",
        payloadKind: "patch",
        patch: "diff --git a/src/app.mjs b/src/app.mjs\n",
        commitPlan: [{ message: "Update app" }]
      });
      expect(prepared).toMatchObject({
        ok: true,
        prepared: true
      });
      expect(prepared.changeSet).toMatchObject({
        payloadKind: "patch",
        diff: "diff --git a/src/app.mjs b/src/app.mjs",
        fileCount: 0,
        commitPlan: [{ message: "Update app" }]
      });

      const review = await runtime.reviewApprove({
        provider: "gerrit",
        reviewTarget: "I123",
        repositoryRef: "owner/repo",
        branch: "main"
      });
      expect(review).toMatchObject({
        ok: true,
        status: 200,
        operationId: "codespace.review.approve",
        provider: "gerrit",
        reviewAction: "approve"
      });
      expect(review.providerReceipt).toMatchObject({
        contractVerified: true,
        provider: "gerrit",
        operationId: "codespace.review.approve"
      });
      expect(review.providerReceipt.reason).toContain("contract receipt");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("propagates codespace repo-port failures when the local repo path is present but the command fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codespace-failure-extra-"));
    try {
      const runtime = createCodespaceRuntime(root);
      executeRepoOperationMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        error: "git failed"
      });

      const result = await runtime.reviewApprove({
        provider: "gerrit",
        repoId: "/virtual/worktree",
        reviewTarget: "I456",
        repositoryRef: "owner/repo",
        branch: "main"
      });

      expect(executeRepoOperationMock).toHaveBeenCalledWith({
        operationId: "repo.review.approve",
        input: {
          provider: "gerrit",
          repoId: "/virtual/worktree",
          reviewTarget: "I456",
          repositoryRef: "owner/repo",
          branch: "main",
          dryRun: true
        },
        authSession: undefined
      });
      expect(result).toMatchObject({
        ok: false,
        status: 502,
        operationId: "codespace.review.approve",
        error: "git failed"
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
