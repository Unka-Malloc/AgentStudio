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
  spawnMock.mockImplementation(() => {
    const response = responses.shift() ?? { code: 0, stdout: "", stderr: "" };
    return createSpawnResult(response);
  });
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

describe("code-review.gerrit.final-extra: action validation and payloads", () => {
  it("rejects missing required fields for read actions", async () => {
    await expect(
      executeGerritCommonOperation({
        mode: "read",
        input: { action: "changes.get" }
      })
    ).rejects.toThrow("Gerrit action requires input.changeId.");
  });

  it("builds review action request and sends review body", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: JSON.stringify({ labels: { CodeReview: 2 } })
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "write",
      input: {
        action: "revisions.review.set",
        changeId: "Irev-1",
        revision: "3",
        review: {
          labels: { Verified: 1 },
          message: "Looks good"
        }
      }
    });

    expect(response.ok).toBe(true);
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestUrl).toBe("http://127.0.0.1:18080/a/changes/Irev-1/revisions/3/review?pp=0");

    const request = fetchMock.mock.calls[0][1];
    expect(request.method).toBe("POST");
    expect(request.body).toBe(
      JSON.stringify({ labels: { Verified: 1 }, message: "Looks good" })
    );
  });

  it("builds comment action request for draft comments", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: JSON.stringify({ ok: true })
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "write",
      input: {
        action: "drafts.create",
        changeId: "Ichange-9",
        revision: "current",
        fileId: "src/main.ts",
        comment: {
          message: "nit: spacing",
          line: 9,
          side: "RIGHT",
          unresolved: true
        }
      }
    });

    expect(response.ok).toBe(true);
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestUrl).toBe(
      "http://127.0.0.1:18080/a/changes/Ichange-9/revisions/current/drafts/src%2Fmain.ts?pp=0"
    );

    const request = fetchMock.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      message: "nit: spacing",
      line: 9,
      side: "RIGHT",
      unresolved: true
    });
  });

  it("builds change action request for commit message update", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: JSON.stringify({ ok: true })
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "write",
      input: {
        action: "changes.commit_message.set",
        changeId: "Ichange-7",
        message: "Updated subject"
      }
    });

    expect(response.ok).toBe(true);
    const request = fetchMock.mock.calls[0][1];
    expect(request.method).toBe("PUT");
    expect(request.body).toBe(
      JSON.stringify({ message: "Updated subject" })
    );
  });
});

describe("code-review.gerrit.final-extra: parsing and config fallback", () => {
  it("returns raw payload when JSON parsing fails in HTTP response", async () => {
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: "{not-json"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: {
        action: "changes.get",
        changeId: "Ibroken"
      }
    });

    expect(response.ok).toBe(true);
    expect(response.result).toBe("{not-json");
    expect(response.gerrit.error).toBeUndefined();
  });

  it("falls back through HTTP detail query when change search response is not ok", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "" },
      { code: 0, stdout: "" },
      { code: 0, stdout: "cafebabe" },
      { code: 0, stdout: "remote:   https://review.example/+/901 old" }
    );

    fetchMock
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json; charset=UTF-8" },
          text: "[]"
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json; charset=UTF-8" },
          text: JSON.stringify({
            id: "I901",
            _number: 901,
            project: "org/repo",
            branch: "main",
            status: "NEW",
            current_revision: "cafebabe",
            revisions: { cafebabe: { _number: 1 } }
          })
        })
      );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true
    });

    expect(response.ok).toBe(true);
    expect(response.reviewUrl).toBe("http://127.0.0.1:18080/c/org/repo/+/901");
    expect(response.branch).toBe("main");
    const firstRequest = String(fetchMock.mock.calls[0][0]);
    const secondRequest = String(fetchMock.mock.calls[1][0]);
    expect(firstRequest).toContain("http://127.0.0.1:18080/changes/?pp=0");
    expect(firstRequest).toContain("q=commit%3Acafebabe");
    expect(secondRequest).toContain("/changes/901/detail");
    expect(secondRequest).toContain("o=CURRENT_REVISION");
  });
});

describe("code-review.gerrit.final-extra: exceptional command path", () => {
  it("returns command failure when git status cannot be queried", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "ssh://review.internal/org/repo.git" },
      { code: 2, stdout: "", stderr: "fatal: not a git repository" }
    );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin"
    });

    expect(response).toMatchObject({
      ok: false,
      status: 400,
      error: "fatal: not a git repository",
      worktreePath: "/tmp/repo"
    });
  });

  it("uses configured base URL and normalizes its trailing slash when confirming upload", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "https://review.example/a/org/repo.git" },
      { code: 0, stdout: "" },
      { code: 0, stdout: "deadbeef" },
      { code: 0, stdout: "" }
    );

    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: JSON.stringify([
          {
            id: "I901",
            _number: 901,
            project: "org/repo",
            branch: "main",
            status: "NEW",
            current_revision: "deadbeef",
            revisions: { deadbeef: { _number: 1 } }
          }
        ])
      })
    );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true,
      baseUrl: "http://configured-gerrit:8080/"
    });

    expect(response.ok).toBe(true);
    expect(response.changeId).toBe("I901");
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestUrl).toBe(
      "http://configured-gerrit:8080/changes/?pp=0&q=commit%3Adeadbeef&n=10&o=CURRENT_REVISION&o=CURRENT_COMMIT"
    );
  });
});
