import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import {
  executeGerritCommonOperation,
  uploadGerritGitChange
} from "../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs";

const ENV_KEYS = [
  "PACT_GERRIT_BASE_URL",
  "PACT_GERRIT_USERNAME",
  "PACT_GERRIT_HTTP_PASSWORD",
  "PACT_GERRIT_BEARER_TOKEN",
  "PACT_GERRIT_AUTH_MODE"
];

function createFetchResponse({ status = 200, statusText = "OK", headers = {}, text = "" }) {
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
  spawnMock.mockReset();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("code-review.gerrit focused coverage extras", () => {
  it("builds authenticated dry-run plans for read actions without issuing fetches", async () => {
    const dryRun = await executeGerritCommonOperation({
      mode: "read",
      input: {
        dryRun: true,
        baseUrl: "http://gerrit.local/",
        action: "changes.drafts.list",
        changeId: "I123456"
      }
    });

    expect(dryRun).toMatchObject({
      ok: true,
      dryRun: true,
      mode: "read",
      action: "changes.drafts.list",
      gerrit: {
        authenticated: true,
        baseUrl: "http://gerrit.local"
      },
      result: {
        method: "GET",
        path: "/changes/I123456/drafts",
        authenticated: true
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends repeated query params, bearer auth, and parses XSSI-prefixed JSON", async () => {
    process.env.PACT_GERRIT_BEARER_TOKEN = "token-abc";
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "text/plain; charset=UTF-8",
          "x-gerrit-trace": "trace-123"
        },
        text: ")]}'\n[{\"id\":\"I1\",\"status\":\"NEW\"}]"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: {
        baseUrl: "http://gerrit.local/",
        action: "changes.query",
        query: "status:open",
        limit: 5,
        options: ["CURRENT_REVISION", "CURRENT_COMMIT"]
      }
    });

    expect(response).toMatchObject({
      ok: true,
      action: "changes.query",
      mode: "read",
      gerrit: {
        authenticated: true,
        status: 200,
        traceId: "trace-123",
        url: "http://gerrit.local/a/changes/"
      },
      result: [{ id: "I1", status: "NEW" }]
    });

    const request = fetchMock.mock.calls[0];
    expect(String(request[0])).toBe(
      "http://gerrit.local/a/changes/?pp=0&q=status%3Aopen&n=5&o=CURRENT_REVISION&o=CURRENT_COMMIT"
    );
    expect(request[1].headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer token-abc"
    });
  });

  it("maps non-2xx JSON payloads to statusText errors instead of raw objects", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 404,
        statusText: "Not Found",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-gerrit-trace": "trace-json"
        },
        text: "{\"message\":\"missing\"}"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: {
        baseUrl: "http://gerrit.local",
        action: "projects.get",
        project: "missing-project"
      }
    });

    expect(response).toMatchObject({
      ok: false,
      error: "Not Found",
      gerrit: {
        status: 404,
        traceId: "trace-json",
        authenticated: false,
        url: "http://gerrit.local/projects/missing-project"
      }
    });
  });

  it("returns git command failures before attempting upload confirmation", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "ssh://review.example/org/repo.git\n" },
      { code: 1, stderr: "status failed\n" }
    );

    const statusFailure = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin"
    });

    expect(statusFailure).toMatchObject({
      ok: false,
      status: 400,
      worktreePath: "/tmp/repo",
      error: "status failed\n"
    });

    queueSpawnResponses(
      { code: 0, stdout: "ssh://review.example/org/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 1, stderr: "head failed\n" }
    );

    const headFailure = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true
    });

    expect(headFailure).toMatchObject({
      ok: false,
      status: 400,
      worktreePath: "/tmp/repo",
      error: "head failed\n"
    });
  });
});
