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

async function expectDryRun(input, expected) {
  const response = await executeGerritCommonOperation({ mode: expected.mode, input });
  expect(response).toMatchObject({
    ok: true,
    dryRun: true,
    mode: expected.mode,
    action: input.action,
    gerrit: {
      authenticated: expected.authenticated ?? false
    }
  });
  expect(response.result).toMatchObject(expected.result);
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

describe("code-review.gerrit more extra coverage", () => {
  it("covers representative dry-run request construction across read, write, and maintain actions", async () => {
    await expectDryRun(
      {
        dryRun: true,
        action: "branches.list",
        project: "org/repo",
        match: "rel-*",
        limit: 5,
        start: 2
      },
      {
        mode: "read",
        result: {
          method: "GET",
          path: "/projects/org%2Frepo/branches/",
          query: { m: "rel-*", n: 5, s: 2 }
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "reviewers.suggest",
        changeId: "I123",
        query: "Ada",
        reviewerState: "REVIEWER",
        excludeGroups: true
      },
      {
        mode: "read",
        result: {
          method: "GET",
          path: "/changes/I123/suggest_reviewers",
          query: {
            q: "Ada",
            "reviewer-state": "REVIEWER",
            "exclude-groups": true
          }
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "revisions.file.diff",
        changeId: "I123",
        revision: "7",
        fileId: "src/app.ts",
        base: "base-1",
        context: 10,
        intraline: true
      },
      {
        mode: "read",
        result: {
          method: "GET",
          path: "/changes/I123/revisions/7/files/src%2Fapp.ts/diff",
          query: { base: "base-1", context: 10, intraline: true }
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "changes.hashtags.set",
        changeId: "I456",
        hashtags: ["alpha", "beta"]
      },
      {
        mode: "write",
        authenticated: true,
        result: {
          method: "POST",
          path: "/changes/I456/hashtags",
          bodyKeys: ["add"]
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "changes.custom_keyed_values.set",
        changeId: "I456",
        values: { app: "pact", level: "high" }
      },
      {
        mode: "write",
        authenticated: true,
        result: {
          method: "POST",
          path: "/changes/I456/custom_keyed_values",
          bodyKeys: ["app", "level"]
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "reviewers.vote.delete",
        changeId: "I456",
        accountId: "1001",
        labelId: "Code-Review",
        reason: "cleanup",
        notify: "OWNER"
      },
      {
        mode: "write",
        authenticated: true,
        result: {
          method: "POST",
          path: "/changes/I456/reviewers/1001/votes/Code-Review/delete",
          bodyKeys: ["notify", "reason"]
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "edit.file.put",
        changeId: "I456",
        fileId: "README.md",
        contentBase64: Buffer.from("hello").toString("base64")
      },
      {
        mode: "write",
        authenticated: true,
        result: {
          method: "PUT",
          path: "/changes/I456/edit/README.md",
          rawBody: {
            byteLength: 5,
            contentType: "text/plain; charset=UTF-8"
          }
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "attention_set.remove",
        changeId: "I456",
        accountId: "user@example.com",
        reason: "handoff"
      },
      {
        mode: "write",
        authenticated: true,
        result: {
          method: "POST",
          path: "/changes/I456/attention/user%40example.com/delete",
          bodyKeys: ["reason"]
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "projects.create",
        project: "org/repo",
        body: {
          description: "New repo",
          owners: ["admins"]
        }
      },
      {
        mode: "maintain",
        authenticated: true,
        result: {
          method: "PUT",
          path: "/projects/org%2Frepo",
          bodyKeys: ["description", "owners"]
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "comments.delete",
        changeId: "I789",
        revision: "2",
        commentId: "c1",
        reason: "spam"
      },
      {
        mode: "maintain",
        authenticated: true,
        result: {
          method: "POST",
          path: "/changes/I789/revisions/2/comments/c1/delete",
          bodyKeys: ["reason"]
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "changes.fix",
        changeId: "I789",
        delete_patch_set_if_commit_missing: true,
        expect_merged_as: "MERGED"
      },
      {
        mode: "maintain",
        authenticated: true,
        result: {
          method: "POST",
          path: "/changes/I789/fix",
          bodyKeys: ["delete_patch_set_if_commit_missing", "expect_merged_as"]
        }
      }
    );

    await expectDryRun(
      {
        dryRun: true,
        action: "revisions.cherrypick",
        changeId: "I789",
        revision: "current",
        destination: "stable",
        base: "deadbeef",
        message: "Backport",
        topic: "hotfix",
        allow_conflicts: true,
        notify: "NONE"
      },
      {
        mode: "maintain",
        authenticated: true,
        result: {
          method: "POST",
          path: "/changes/I789/revisions/current/cherrypick",
          bodyKeys: ["allow_conflicts", "base", "destination", "message", "notify", "topic"]
        }
      }
    );
  });

  it("treats authMode=basic as authenticated and prefixes requests without credentials", async () => {
    process.env.PACT_GERRIT_AUTH_MODE = "basic";
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-gerrit-trace": "trace-basic"
        },
        text: "{\"version\":\"3.13.0\"}"
      })
    );

    const response = await executeGerritCommonOperation({
      mode: "read",
      input: {
        action: "server.version",
        baseUrl: "http://gerrit.local/"
      }
    });

    expect(response).toMatchObject({
      ok: true,
      gerrit: {
        authenticated: true,
        traceId: "trace-basic",
        url: "http://gerrit.local/a/config/server/version"
      },
      result: { version: "3.13.0" }
    });

    const request = fetchMock.mock.calls[0];
    expect(String(request[0])).toBe("http://gerrit.local/a/config/server/version?pp=0");
    expect(request[1].headers).toEqual({
      Accept: "application/json"
    });
  });

  it("uses project/branch confirmation queries for scp-style remotes", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "git@review.example:org/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "cafebabe\n" },
      { code: 0, stdout: "remote: uploaded\n" }
    );

    fetchMock
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json; charset=UTF-8" },
          text: "[]"
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json; charset=UTF-8" },
          text: JSON.stringify([
            {
              id: "I9001",
              _number: 9001,
              project: "org/repo",
              branch: "main",
              status: "NEW",
              current_revision: "cafebabe",
              revisions: { cafebabe: { _number: 1 } }
            }
          ])
        })
      );

    const response = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true,
      baseUrl: "http://gerrit.local/"
    });

    expect(response).toMatchObject({
      ok: true,
      status: "completed",
      changeId: "I9001",
      changeNumber: "9001",
      project: "org/repo",
      branch: "main",
      reviewUrl: "http://gerrit.local/c/org/repo/+/9001"
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("q=commit%3Acafebabe");
    expect(String(fetchMock.mock.calls[1][0])).toContain("project%3Aorg%2Frepo");
    expect(String(fetchMock.mock.calls[1][0])).toContain("branch%3Amain");
  });

  it("falls back to q-style review URLs when Gerrit omits project metadata", async () => {
    queueSpawnResponses(
      { code: 1, stdout: "", stderr: "" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "deadbeef\n" },
      { code: 0, stdout: "remote: uploaded\n" }
    );

    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
        text: JSON.stringify([
          {
            id: "I42",
            _number: 42,
            number: 42,
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
      baseUrl: "http://gerrit.local/"
    });

    expect(response).toMatchObject({
      ok: true,
      status: "completed",
      changeId: "I42",
      changeNumber: "42",
      project: "",
      reviewUrl: "http://gerrit.local/q/42"
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("q=commit%3Adeadbeef");
  });
});
