import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const fetchMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const executeGerritCommonOperationMock = vi.hoisted(() => vi.fn(async ({ mode, input } = {}) => ({
  ok: true,
  mode,
  action: input?.action,
  input
})));
const spawnState = vi.hoisted(() => ({
  realSpawn: null,
  plans: []
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  spawnState.realSpawn = actual.spawn;
  return {
    ...actual,
    spawn: (...args) => spawnMock(...args)
  };
});

vi.mock("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs");
  return {
    ...actual,
    executeGerritCommonOperation: executeGerritCommonOperationMock
  };
});

let executeGerritCommonOperation;
let uploadGerritGitChange;
let executeRepoOperation;
let executeGerritCommonOperationActual;
let uploadGerritGitChangeActual;

const ENV_KEYS = [
  "PACT_GERRIT_BASE_URL",
  "PACT_GERRIT_USERNAME",
  "PACT_GERRIT_HTTP_PASSWORD",
  "PACT_GERRIT_BEARER_TOKEN",
  "PACT_GERRIT_AUTH_MODE"
];

function createFetchResponse({
  status = 200,
  statusText = "OK",
  headers = {},
  text = ""
}) {
  const headerMap = new Map();
  for (const [key, value] of Object.entries(headers)) {
    headerMap.set(String(key).toLowerCase(), String(value));
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get(name) {
        return headerMap.get(String(name).toLowerCase()) || null;
      }
    },
    text: vi.fn(async () => text)
  };
}

function createSpawnResult({ code = 0, stdout = "", stderr = "" } = {}) {
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

function queueSpawnResponse(match, response) {
  spawnState.plans.push({ match, response });
}

function gitArgs(...parts) {
  return (command, args = []) => command === "git" && args.length === parts.length && parts.every((part, index) => String(args[index]) === part);
}

function shellCommandContains(text) {
  return (command, args = []) =>
    command === "/bin/sh" &&
    String(args[0] || "") === "-lc" &&
    String(args[1] || "").includes(text);
}

function spawnPlanMatches(command, args, options) {
  const index = spawnState.plans.findIndex((plan) => plan.match(command, args, options));
  if (index >= 0) {
    const [plan] = spawnState.plans.splice(index, 1);
    return plan.response;
  }
  return null;
}

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function writeTextFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function withTempRepo(testCase) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-gerrit-repo-ops-"));
  try {
    runGit(repoRoot, ["init"]);
    runGit(repoRoot, ["config", "user.name", "Unit Test"]);
    runGit(repoRoot, ["config", "user.email", "unit-test@example.test"]);

    await writeTextFile(path.join(repoRoot, "README.md"), "initial\n");
    runGit(repoRoot, ["add", "README.md"]);
    runGit(repoRoot, ["commit", "-m", "initial commit"]);
    runGit(repoRoot, ["branch", "-M", "main"]);

    return await testCase(repoRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  ({
    executeGerritCommonOperation: executeGerritCommonOperationActual,
    uploadGerritGitChange: uploadGerritGitChangeActual
  } = await vi.importActual("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs"));
  executeGerritCommonOperation = executeGerritCommonOperationActual;
  uploadGerritGitChange = uploadGerritGitChangeActual;
  ({ executeRepoOperation } = await import(
    "../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs"
  ));
});

beforeEach(() => {
  fetchMock.mockReset();
  executeGerritCommonOperationMock.mockClear();
  spawnMock.mockClear();
  spawnState.plans.length = 0;
  vi.stubGlobal("fetch", fetchMock);
  spawnMock.mockImplementation((command, args = [], options = {}) => {
    const response = spawnPlanMatches(command, args, options);
    if (response) {
      return createSpawnResult(response);
    }
    if (!spawnState.realSpawn) {
      throw new Error("real spawn implementation is not available");
    }
    return spawnState.realSpawn(command, args, options);
  });
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("code-review.gerrit and repo-operations final extra coverage", () => {
  it("builds Gerrit dry-run bodies from array, object, and review payload inputs", async () => {
    const hashtags = await executeGerritCommonOperationActual({
      mode: "write",
      input: {
        dryRun: true,
        action: "changes.hashtags.set",
        changeId: "I123",
        hashtags: ["alpha", "beta"]
      }
    });
    expect(hashtags).toMatchObject({
      ok: true,
      dryRun: true,
      mode: "write",
      action: "changes.hashtags.set",
      result: {
        method: "POST",
        path: "/changes/I123/hashtags",
        bodyKeys: ["add"]
      }
    });

    const keyedValues = await executeGerritCommonOperationActual({
      mode: "write",
      input: {
        dryRun: true,
        action: "changes.custom_keyed_values.set",
        changeId: "I123",
        values: {
          owner: "team-a",
          priority: "high"
        }
      }
    });
    expect(keyedValues.result).toMatchObject({
      method: "POST",
      path: "/changes/I123/custom_keyed_values",
      bodyKeys: ["owner", "priority"]
    });

    const review = await executeGerritCommonOperationActual({
      mode: "write",
      input: {
        dryRun: true,
        action: "revisions.review.set",
        changeId: "I123",
        revision: "deadbeef",
        review: {
          message: "Looks good",
          labels: { "Code-Review": 2 },
          notify: "OWNER"
        }
      }
    });
    expect(review.result).toMatchObject({
      method: "POST",
      path: "/changes/I123/revisions/deadbeef/review",
      bodyKeys: ["labels", "message", "notify"]
    });
  });

  it("returns plain-text Gerrit errors after stripping XSSI prefixes", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "content-type": "text/plain; charset=UTF-8"
        },
        text: ")]}'\nbackend exploded"
      })
    );

    const response = await executeGerritCommonOperationActual({
      mode: "read",
      input: {
        action: "server.info",
        baseUrl: "http://gerrit.local"
      }
    });

    expect(response).toMatchObject({
      ok: false,
      error: "backend exploded",
      gerrit: {
        status: 503,
        authenticated: false,
        url: "http://gerrit.local/config/server/info"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://gerrit.local/config/server/info?pp=0");
  });

  it("falls back to change detail confirmation after a failed Gerrit query", async () => {
    await withTempRepo(async (repoRoot) => {
      runGit(repoRoot, ["remote", "add", "origin", "git@review.example:org/repo.git"]);

      queueSpawnResponse(gitArgs("remote", "get-url", "origin"), {
        code: 0,
        stdout: "git@review.example:org/repo.git\n",
        stderr: ""
      });
      queueSpawnResponse(gitArgs("status", "--short"), {
        code: 0,
        stdout: "\n",
        stderr: ""
      });
      queueSpawnResponse(gitArgs("rev-parse", "HEAD"), {
        code: 0,
        stdout: "feedface\n",
        stderr: ""
      });
      queueSpawnResponse(gitArgs("push", "origin", "HEAD:refs/for/main"), {
        code: 0,
        stdout: "remote:   https://review.example/+/321 new change\n",
        stderr: ""
      });

      fetchMock
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 500,
            statusText: "Server Error",
            headers: {
              "content-type": "text/plain"
            },
            text: "query failed"
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 200,
            headers: {
              "content-type": "application/json"
            },
            text: "[]"
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-gerrit-trace": "trace-detail"
            },
            text: JSON.stringify({
              id: "I1234567890",
              _number: 321,
              number: "321",
              status: "NEW",
              project: "org/repo",
              branch: "main",
              current_revision: "feedface",
              revisions: {
                feedface: { _number: 1 }
              }
            })
          })
        );

      const response = await uploadGerritGitChangeActual({
        worktreePath: repoRoot,
        remote: "origin",
        baseUrl: "https://review.example",
        allowDirty: true
      });

      expect(response).toMatchObject({
        ok: true,
        status: "completed",
        provider: "gerrit",
        targetProvider: "gerrit",
        targetKind: "codespace",
        remote: "origin",
        remoteUrl: "git@review.example:org/repo.git",
        head: "feedface",
        changeId: "I1234567890",
        changeNumber: "321",
        project: "org/repo",
        branch: "main",
        reviewUrl: "https://review.example/c/org/repo/+/321",
        completion: {
          confirmed: true,
          confirmationMethod: "gerrit_rest_change_query",
          query: "change:321",
          attempts: 1
        }
      });

      expect(String(fetchMock.mock.calls[0][0])).toContain("q=commit%3Afeedface");
      expect(String(fetchMock.mock.calls[0][0])).toContain("o=CURRENT_REVISION");
      expect(String(fetchMock.mock.calls[0][0])).toContain("o=CURRENT_COMMIT");
      expect(String(fetchMock.mock.calls[2][0])).toContain("/changes/321/detail");
    });
  });

  it("covers unavailable PR/CI status adapters and missing-file fs errors", async () => {
    await withTempRepo(async (repoRoot) => {
      queueSpawnResponse(shellCommandContains("command -v"), {
        code: 1,
        stdout: "",
        stderr: ""
      });
      queueSpawnResponse(shellCommandContains("command -v"), {
        code: 1,
        stdout: "",
        stderr: ""
      });

      const pr = await executeRepoOperation({
        operationId: "repo.status",
        input: {
          repoId: repoRoot,
          targetType: "pr",
          targetId: "123"
        }
      });
      expect(pr).toMatchObject({
        ok: true,
        data: {
          targetType: "pr",
          available: false,
          reason: "No local adapter is available for this status target."
        }
      });

      const ci = await executeRepoOperation({
        operationId: "repo.status",
        input: {
          repoId: repoRoot,
          targetType: "ci",
          limit: 2
        }
      });
      expect(ci).toMatchObject({
        ok: true,
        data: {
          targetType: "ci",
          available: false,
          reason: "No local adapter is available for this status target."
        }
      });

      const missingFile = await executeRepoOperation({
        operationId: "repo.file.read",
        input: {
          repoId: repoRoot,
          path: "missing.txt"
        }
      });
      expect(missingFile).toMatchObject({
        ok: false,
        status: 400,
        error: {
          code: "repo_operation_failed",
          message: expect.stringContaining("ENOENT")
        }
      });
    });
  });

  it("tracks Gerrit label parsing, protected pushes, webhook creation, and checkout transport failures", async () => {
    await withTempRepo(async (repoRoot) => {
      const approve = await executeRepoOperation({
        operationId: "repo.review.approve",
        input: {
          repoId: repoRoot,
          reviewTarget: "I-1",
          label: "Verified=2",
          body: "LGTM"
        }
      });
      expect(approve).toMatchObject({
        ok: true,
        data: {
          provider: "gerrit"
        }
      });
      expect(executeGerritCommonOperationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "write",
          input: expect.objectContaining({
            action: "revisions.review.set",
            changeId: "I-1",
            review: expect.objectContaining({
              labels: { Verified: 2 },
              message: "LGTM"
            })
          })
        })
      );

      executeGerritCommonOperationMock.mockClear();

      const requestChanges = await executeRepoOperation({
        operationId: "repo.review.requestChanges",
        input: {
          repoId: repoRoot,
          reviewTarget: "I-2",
          labels: { "Code-Review": -2 },
          body: "Please fix"
        }
      });
      expect(requestChanges).toMatchObject({
        ok: true,
        data: {
          provider: "gerrit"
        }
      });
      expect(executeGerritCommonOperationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "write",
          input: expect.objectContaining({
            action: "revisions.review.set",
            changeId: "I-2",
            review: expect.objectContaining({
              labels: { "Code-Review": -2 },
              message: "Please fix"
            })
          })
        })
      );

      const push = await executeRepoOperation({
        operationId: "repo.push",
        input: {
          repoId: repoRoot,
          remote: "origin",
          sourceRef: "main",
          targetRef: "main",
          force: true,
          forceMode: "force",
          protected: true,
          confirm: true,
          dryRun: true
        },
        authSession: {
          scopes: ["repo:maintain"]
        }
      });
      expect(push).toMatchObject({
        ok: true,
        data: {
          dryRun: true,
          command: "git",
          args: ["push", "--force", "origin", "main:main"]
        }
      });

      const webhook = await executeRepoOperation({
        operationId: "repo.webhook.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          confirm: true,
          payload: { url: "https://example.com/webhook" },
          dryRun: true
        }
      });
      expect(webhook).toMatchObject({
        ok: true,
        data: {
          dryRun: true,
          provider: "github",
          command: "gh",
          args: ["api", "-X", "POST", "repos/unit/test/hooks", "--input", "-"]
        }
      });
    });
  });

  it("maps git checkout failures into repo_operation_failed transport errors", async () => {
    await withTempRepo(async (repoRoot) => {
      queueSpawnResponse(gitArgs("checkout", "missing-branch"), {
        code: 1,
        stdout: "",
        stderr: "error: pathspec 'missing-branch' did not match any file(s) known to git\n"
      });

      const response = await executeRepoOperation({
        operationId: "repo.branch.checkout",
        input: {
          repoId: repoRoot,
          branchName: "missing-branch"
        }
      });

      expect(response).toMatchObject({
        ok: false,
        status: 502,
        error: {
          code: "repo_operation_failed",
          message: expect.stringContaining("pathspec")
        }
      });
      expect(response.error.details).toMatchObject({
        command: "git"
      });
      expect(response.error.details.args).toContain("checkout");
    });
  });
});
