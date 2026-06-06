import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import {
  GERRIT_ACTIONS,
  executeGerritCommonOperation,
  uploadGerritGitChange
} from "../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs";

const gerritModuleManifestPath = path.resolve(
  process.cwd(),
  "server/platform/specialized/capabilities/code-review/gerrit/module.json"
);

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

function createSpawnResult({
  code = 0,
  stdout = "",
  stderr = ""
} = {}) {
  const child = new EventEmitter();
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
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

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("code-review.gerrit: manifest registration", () => {
  it("exports the expected operations/tools and keeps action lists", async () => {
    const manifest = JSON.parse(await fs.readFile(gerritModuleManifestPath, "utf8"));
    const operations = manifest.components.gerritMcpRoute.operations || [];
    const tools = manifest.components.gerritMcpRoute.tools || [];

    expect(operations).toEqual([
      "gerrit.read",
      "gerrit.write",
      "gerrit.maintain",
      "gerrit.git_upload"
    ]);
    expect(tools).toEqual([
      "pact.gerrit.read",
      "pact.gerrit.write",
      "pact.gerrit.maintain",
      "pact.gerrit.gitUpload"
    ]);
    expect(GERRIT_ACTIONS.read).toContain("server.info");
    expect(GERRIT_ACTIONS.write).toContain("changes.create");
    expect(GERRIT_ACTIONS.maintain).toContain("changes.submit");
    expect(GERRIT_ACTIONS.read).toEqual([...GERRIT_ACTIONS.read].sort());
    expect(GERRIT_ACTIONS.write).toEqual([...GERRIT_ACTIONS.write].sort());
    expect(GERRIT_ACTIONS.maintain).toEqual([...GERRIT_ACTIONS.maintain].sort());
  });
});

describe("code-review.gerrit: executeGerritCommonOperation", () => {
  it("validates mode and action before request execution", async () => {
    const unsupportedAction = await executeGerritCommonOperation({
      mode: "read",
      input: { action: "does.not.exist" }
    });
    expect(unsupportedAction).toMatchObject({
      ok: false,
      status: 400,
      error: "Unsupported Gerrit read action: does.not.exist",
      allowedActions: GERRIT_ACTIONS.read
    });

    const invalidMode = await executeGerritCommonOperation({ mode: "invalid", input: {} });
    expect(invalidMode).toMatchObject({
      ok: false,
      status: 400,
      error: "Unsupported Gerrit invalid action: (empty)",
      allowedActions: []
    });
  });

  it("builds read request plans in dry-run mode with query flags", async () => {
    const dryRun = await executeGerritCommonOperation({
      mode: "read",
      input: {
        dryRun: true,
        action: "projects.list",
        description: true,
        prefix: "main/",
        state: "active",
        type: "CODE",
        limit: 8,
        start: 4,
        match: "my-*"
      }
    });

    expect(dryRun).toMatchObject({
      ok: true,
      dryRun: true,
      mode: "read",
      action: "projects.list",
      gerrit: { authenticated: false, baseUrl: "http://127.0.0.1:18080" },
      result: {
        method: "GET",
        path: "/projects/",
        query: expect.objectContaining({
          d: true,
          p: "main/",
          m: "my-*",
          state: "active",
          type: "CODE",
          limit: 8,
          start: 4
        })
      }
    });
  });

  it("validates required input fields for write actions", async () => {
    await expect(
      executeGerritCommonOperation({
        mode: "write",
        input: { action: "revisions.review.set", dryRun: true }
      })
    ).rejects.toThrow("Gerrit action requires input.changeId.");
  });

  it("generates write dry-run payload plan with sorted body keys", async () => {
    const dryRun = await executeGerritCommonOperation({
      mode: "write",
      input: {
        dryRun: true,
        action: "changes.create",
        project: "repo",
        branch: "main",
        subject: "Fix CI",
        topic: "topic-1",
        status: "NEW",
        is_private: true
      }
    });

    expect(dryRun.result).toMatchObject({
      method: "POST",
      path: "/changes/",
      bodyKeys: ["branch", "is_private", "project", "status", "subject", "topic"]
    });
  });

  it("builds edit-file write request with raw body plan in dry-run", async () => {
    const dryRun = await executeGerritCommonOperation({
      mode: "write",
      input: {
        dryRun: true,
        action: "edit.file.put",
        changeId: "Iabc123",
        fileId: "README.md",
        contentBase64: Buffer.from("hello from gerrit").toString("base64"),
        contentType: "text/plain; charset=UTF-8"
      }
    });

    expect(dryRun.result).toMatchObject({
      method: "PUT",
      path: "/changes/Iabc123/edit/README.md",
      rawBody: {
        byteLength: Buffer.from("hello from gerrit", "utf8").byteLength,
        contentType: "text/plain; charset=UTF-8"
      }
    });
  });

  it("builds maintain dry-run payload for Gerrit-admin actions", async () => {
    const dryRun = await executeGerritCommonOperation({
      mode: "maintain",
      input: {
        dryRun: true,
        action: "projects.create",
        project: "org/repo",
        description: "New repo",
        parents: [],
        create_empty_commit: true
      }
    });

    expect(dryRun.result).toMatchObject({
      method: "PUT",
      path: "/projects/org%2Frepo",
      bodyKeys: ["create_empty_commit", "description"]
    });
  });

  it("attaches authentication and parses rejected JSON responses", async () => {
    process.env.PACT_GERRIT_USERNAME = "alice";
    process.env.PACT_GERRIT_HTTP_PASSWORD = "secret";
    process.env.PACT_GERRIT_BASE_URL = "http://custom.internal/gerrit/";
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 404,
        statusText: "Not Found",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-gerrit-trace": "trace-123",
          "x-gerrit-updatedref": "refs/heads/main"
        },
        text: "{\"message\":\"missing\"}"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: {
        action: "projects.get",
        project: "my project"
      }
    });

    expect(response.ok).toBe(false);
    expect(response.gerrit.status).toBe(404);
    expect(response.gerrit.authenticated).toBe(true);
    expect(response.gerrit.traceId).toBe("trace-123");
    expect(response.gerrit.url).toBe("http://custom.internal/gerrit/a/projects/my%20project");
    expect(response.error).toBe("Not Found");

    const request = fetchMock.mock.calls[0];
    expect(String(request[0])).toBe("http://custom.internal/a/projects/my%20project?pp=0");
    expect(request[1].headers).toMatchObject({
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`
    });
  });

  it("parses XSSI-prefixed JSON responses and preserves request auth mode", async () => {
    process.env.PACT_GERRIT_BEARER_TOKEN = "token-abc";
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "text/plain; charset=UTF-8",
          "x-gerrit-trace": "trace-bearer"
        },
        text: ")]}'\n{\"status\":\"ok\",\"x\":1}"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: { action: "server.version", baseUrl: "http://localhost:18080/" }
    });

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ status: "ok", x: 1 });
    expect(response.gerrit.authenticated).toBe(true);
    expect(response.gerrit.traceId).toBe("trace-bearer");
    expect(response.gerrit.url).toBe("http://localhost:18080/a/config/server/version");
    expect((await fetchMock.mock.calls[0][1].headers.Authorization)).toMatch(/^Bearer /);
  });

  it("returns plain text payload when response is non-json", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "text/plain"
        },
        text: "simple-gerrit-text"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: { action: "server.info", baseUrl: "http://localhost:18080/" }
    });

    expect(response.ok).toBe(true);
    expect(response.result).toBe("simple-gerrit-text");
  });
});

describe("code-review.gerrit: uploadGerritGitChange", () => {
  it("supports dry-run mode and redacts remote credentials", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "https://alice:secret@review.example/a/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "deadbeef\n" }
    );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      dryRun: true
    });

    expect(response).toMatchObject({
      ok: true,
      dryRun: true,
      worktreePath: "/tmp/repo",
      remote: "origin",
      targetRef: "HEAD:refs/for/main",
      head: "deadbeef",
      remoteUrl: "https://%3Credacted%3E:%3Credacted%3E@review.example/a/repo.git",
      gitStatus: "\n"
    });
  });

  it("blocks dirty worktrees when allowDirty is not enabled", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "ssh://review.example/org/repo.git\n" },
      { code: 0, stdout: "M file1.js\n" }
    );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin"
    });

    expect(response).toMatchObject({
      ok: false,
      status: 409,
      worktreePath: "/tmp/repo",
      error: "Worktree has uncommitted changes. Commit first or pass allowDirty=true."
    });
  });

  it("maps git push failure into transport error response", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "ssh://review.example/org/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "deadbeef\n" },
      { code: 1, stderr: "remote rejected\\n" }
    );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true
    });

    expect(response).toMatchObject({
      ok: false,
      status: 502,
      worktreePath: "/tmp/repo",
      remote: "origin",
      error: "remote rejected\\n",
      targetRef: "HEAD:refs/for/main",
      head: "deadbeef"
    });
    expect(response.uploadId).toMatch(/^gerrit_git_upload_/);
  });

  it("confirms successful upload using REST query path", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "https://gerrit.example:29418/a/org/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "beefcafe\n" },
      { code: 0, stdout: "remote:   https://gerrit.example:29418/+/6543 old\n" }
    );
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-gerrit-trace": "trace-success"
        },
        text: JSON.stringify([{
          id: "I1234567890",
          _number: 6543,
          number: "6543",
          status: "NEW",
          project: "org/repo",
          branch: "main",
          current_revision: "beefcafe",
          revisions: { beefcafe: { _number: 1 } }
        }])
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
      head: "beefcafe",
      status: "completed",
      changeId: "I1234567890",
      changeNumber: "6543",
      project: "org/repo",
      branch: "main",
      reviewUrl: "https://gerrit.example:29418/c/org/repo/+/6543"
    });
    const request = String(fetchMock.mock.calls[0][0]);
    expect(request.startsWith("https://gerrit.example:29418/changes/") || request.startsWith("https://gerrit.example:29418/a/changes/")).toBe(true);
    expect(request).toContain("pp=0");
    expect(request).toContain("o=CURRENT_REVISION");
    expect(request).toContain("o=CURRENT_COMMIT");
    expect(request).toContain("q=commit%3Abeefcafe");
  });

  it("returns confirmed=false when uploaded change is not visible before timeout", async () => {
    vi.useFakeTimers();
    try {
      queueSpawnResponses(
        { code: 0, stdout: "ssh://review.example/org/repo.git\n" },
        { code: 0, stdout: "\n" },
        { code: 0, stdout: "cafebabe\n" },
        { code: 0, stdout: "done\n" }
      );
      fetchMock.mockResolvedValue(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json" },
          text: "[]"
        })
      );

      const responsePromise = uploadGerritGitChange({
        worktreePath: "/tmp/repo",
        remote: "origin",
        allowDirty: true,
        confirmationTimeoutMs: 1
      });
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response).toMatchObject({
        ok: false,
        status: 502,
        worktreePath: "/tmp/repo",
        remote: "origin",
        head: "cafebabe",
        completion: {
          confirmed: false,
          attempts: 2,
          error: "Gerrit accepted git push, but the uploaded commit was not visible through Gerrit REST before the confirmation timeout."
        }
      });
      expect(response.uploadId).toMatch(/^gerrit_git_upload_/);
    } finally {
      vi.useRealTimers();
    }
  });
});
