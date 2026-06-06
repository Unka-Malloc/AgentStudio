import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const executeRepoOperationMock = vi.hoisted(() => vi.fn());
const executeGerritCommonOperationMock = vi.hoisted(() => vi.fn());
const uploadGerritGitChangeMock = vi.hoisted(() => vi.fn());

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

function createFetchResponse({
  status = 200,
  statusText = "OK",
  headers = {},
  text = ""
} = {}) {
  const headerMap = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
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

function createCodespaceRuntime(userDataPath) {
  return createCodespaceRegistry({
    userDataPath,
    executeRepoOperation: executeRepoOperationMock,
    executeGerritCommonOperation: executeGerritCommonOperationMock,
    uploadGerritGitChange: uploadGerritGitChangeMock
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  executeRepoOperationMock.mockReset();
  executeGerritCommonOperationMock.mockReset();
  uploadGerritGitChangeMock.mockReset();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gerrit, repo-operations, and codespace final extra coverage 3", () => {
  it("parses Gerrit JSON payloads, auth headers, and request metadata on success", async () => {
    process.env.PACT_GERRIT_USERNAME = "alice";
    process.env.PACT_GERRIT_HTTP_PASSWORD = "secret";

    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-gerrit-trace": "trace-7"
        },
        text: JSON.stringify({
          id: "I123",
          change_id: "I123",
          status: "NEW",
          _number: 123,
          current_revision: "deadbeef"
        })
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: {
        baseUrl: "http://gerrit.example/",
        action: "projects.get",
        project: "my project"
      }
    });

    expect(response).toMatchObject({
      ok: true,
      action: "projects.get",
      mode: "read",
      gerrit: {
        status: 200,
        traceId: "trace-7",
        authenticated: true,
        url: "http://gerrit.example/a/projects/my%20project"
      },
      result: {
        id: "I123",
        change_id: "I123",
        status: "NEW",
        _number: 123,
        current_revision: "deadbeef"
      }
    });

    const request = fetchMock.mock.calls[0];
    expect(String(request[0])).toBe("http://gerrit.example/a/projects/my%20project?pp=0");
    expect(request[1].headers).toMatchObject({
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`
    });
  });

  it("falls back to the raw body when Gerrit returns invalid JSON text", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8"
        },
        text: "not-json"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: {
        baseUrl: "http://gerrit.example/",
        action: "server.info"
      }
    });

    expect(response).toMatchObject({
      ok: true,
      action: "server.info",
      mode: "read",
      result: "not-json"
    });
  });

  it("confirms Gerrit uploads through revision detail fallback when current_revision is absent", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "https://review.example/org/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "feedface\n" },
      { code: 0, stdout: "remote:   https://review.example/+/7788 old\n" }
    );

    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: "[]"
      })
    );
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: "[]"
      })
    );
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-gerrit-trace": "trace-confirmed"
        },
        text: JSON.stringify({
          id: "I1234567890",
          _number: 7788,
          number: "7788",
          status: "NEW",
          project: "org/repo",
          branch: "main",
          revisions: {
            feedface: {
              _number: 1,
              commit: {
                commit: "feedface"
              }
            }
          }
        })
      })
    );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true,
      confirmationTimeoutMs: 0
    });

    expect(response).toMatchObject({
      ok: true,
      status: 200,
      worktreePath: "/tmp/repo",
      remote: "origin",
      remoteUrl: "https://review.example/org/repo.git",
      targetRef: "I1234567890",
      head: "feedface",
      status: "completed",
      changeId: "I1234567890",
      changeNumber: "7788",
      project: "org/repo",
      branch: "main",
      reviewUrl: "https://review.example/c/org/repo/+/7788"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("/changes/7788/detail");
  });

  it("treats diff, checkout, and empty commit paths as no-op boundaries", async () => {
    const repoRoot = "/virtual/repo";
    const head = "abc123";

    queueSpawnResponses(
      { code: 0, stdout: `${repoRoot}\n` },
      { code: 0, stdout: `${head}\n` },
      { code: 0, stdout: "main\n" },
      { code: 0, stdout: "" },
      { code: 0, stdout: `${repoRoot}\n` },
      { code: 0, stdout: `${head}\n` },
      { code: 0, stdout: "main\n" },
      { code: 0, stdout: "Already on 'main'\n" },
      { code: 0, stdout: `${repoRoot}\n` },
      { code: 0, stdout: `${head}\n` },
      { code: 0, stdout: "main\n" },
      { code: 0, stdout: `${repoRoot}\n` },
      { code: 0, stdout: `${head}\n` },
      { code: 0, stdout: "main\n" },
      { code: 0, stdout: "Already on 'main'\n" },
      { code: 0, stdout: "" },
      { code: 0, stdout: "" },
      { code: 0, stdout: "" },
      { code: 0, stdout: "c0ffee\n" }
    );

    const diff = await executeRepoOperation({
      operationId: "repo.diff.read",
      input: {
        repoId: repoRoot,
        baseRef: "HEAD",
        headRef: "HEAD"
      }
    });
    expect(diff).toMatchObject({
      ok: true,
      operationId: "repo.diff.read",
      data: {
        baseRef: "HEAD",
        headRef: "HEAD",
        diff: ""
      }
    });

    const checkout = await executeRepoOperation({
      operationId: "repo.branch.checkout",
      input: {
        repoId: repoRoot,
        branchName: "main"
      }
    });
    expect(checkout).toMatchObject({
      ok: true,
      operationId: "repo.branch.checkout",
      data: {
        branchName: "main",
        head
      }
    });

    const commit = await executeRepoOperation({
      operationId: "repo.commit.create",
      input: {
        repoId: repoRoot,
        branch: "main",
        allowEmpty: true,
        message: "no-op commit"
      }
    });
    expect(commit).toMatchObject({
      ok: true,
      operationId: "repo.commit.create",
      data: {
        branch: "main",
        commit: "c0ffee",
        appliedChanges: []
      }
    });
  });

  it("routes proposal fallbacks and records the fallback audit event", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codespace-final-extra-3-eval-"));
    try {
      const runtime = createCodespaceRuntime(root);

      const evaluated = await runtime.evaluateTarget({
        workspaceId: "ws-1",
        targetId: "target-fallback",
        routeDecision: "proposalFallback",
        fallbackReason: "needs human approval",
        repositoryRef: "owner/repo",
        branch: "feature/fallback",
        targetProvider: "workspace"
      });

      expect(evaluated).toMatchObject({
        ok: true,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        accepted: true,
        routeDecision: "proposalFallback",
        fallbackReason: "needs human approval",
        fallback: {
          targetKind: "workspaceProposal",
          operationId: "workspace.proposal.create",
          reason: "needs human approval"
        },
        compatibleTargets: [
          {
            targetKind: "workspaceProposal",
            targetProvider: "workspace",
            repositoryRef: "owner/repo",
            branch: "feature/fallback"
          }
        ]
      });

      const registry = JSON.parse(
        await fs.readFile(path.join(root, "code-management", "codespace-registry.json"), "utf8")
      );
      expect(registry.events.map((event) => event.type)).toEqual([
        "code.route.evaluated",
        "code.change.fallback.created"
      ]);
      expect(registry.targets["target-fallback"]).toMatchObject({
        targetKind: "workspaceProposal",
        routeDecision: "proposalFallback",
        fallbackReason: "needs human approval"
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prepares changes from fileChanges and syncs status from nested provider receipts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codespace-final-extra-3-sync-"));
    try {
      const runtime = createCodespaceRuntime(root);

      const evaluated = await runtime.evaluateTarget({
        workspaceId: "ws-2",
        targetId: "target-sync",
        routeDecision: "gerritChange",
        repositoryRef: "owner/repo",
        branch: "feature/sync",
        targetProvider: "gerrit",
        payloadKind: "sourceCode"
      });

      const prepared = await runtime.prepareChange({
        targetId: evaluated.target.targetId,
        workspaceId: "ws-2",
        repositoryRef: "owner/repo",
        branch: "feature/sync",
        payloadKind: "repositoryChange",
        fileChanges: [
          {
            action: "update",
            path: "src/app.ts",
            content: "console.log('hi')\n"
          }
        ],
        commitPlan: ["Bundle updates"]
      });

      expect(prepared).toMatchObject({
        ok: true,
        prepared: true,
        targetId: "target-sync",
        reviewStatus: "draft",
        submitStatus: "notSubmitted",
        changeSet: {
          payloadKind: "repositoryChange",
          fileCount: 1,
          commitPlan: [{ message: "Bundle updates" }]
        }
      });

      const synced = await runtime.syncStatus({
        codeChangeId: prepared.codeChangeId,
        providerReceipt: {
          change: {
            status: "MERGED",
            submitStatus: "submitted",
            change_id: "I77",
            _number: 77,
            current_revision: "cafecafe"
          }
        }
      });

      expect(synced).toMatchObject({
        ok: true,
        synced: true,
        codeChangeId: prepared.codeChangeId,
        reviewStatus: "merged",
        submitStatus: "submitted",
        changeId: "I77",
        changeNumber: "77"
      });
      expect(synced.providerReceipt).toMatchObject({
        change: {
          status: "MERGED",
          submitStatus: "submitted",
          change_id: "I77",
          _number: 77,
          current_revision: "cafecafe"
        }
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
