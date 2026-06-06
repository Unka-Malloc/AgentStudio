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

function createSpawnErrorResult(message = "spawn failed") {
  const child = new EventEmitter();
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  setImmediate(() => {
    child.emit("error", new Error(message));
  });
  return child;
}

function queueSpawnResponses(...responses) {
  const queue = [...responses];
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    const next = queue.shift() || {};
    if (next.errorMessage) {
      return createSpawnErrorResult(next.errorMessage);
    }
    return createSpawnResult(next);
  });
}

async function expectDryRunCase(mode, input, expected) {
  const response = await executeGerritCommonOperation({
    mode,
    input: {
      baseUrl: "http://gerrit.local/",
      dryRun: true,
      ...input
    }
  });

  expect(response).toMatchObject({
    ok: true,
    dryRun: true,
    mode,
    action: input.action,
    gerrit: {
      authenticated: expected.authenticated ?? mode !== "read",
      baseUrl: "http://gerrit.local"
    }
  });
  expect(response.result).toMatchObject(expected.result);
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

describe("code-review.gerrit final extra coverage 6", () => {
  it("covers remaining read request builders and request-plan shapes", async () => {
    const cases = [
      {
        action: "branches.get",
        input: { project: "org/repo", branch: "release/x" },
        result: { method: "GET", path: "/projects/org%2Frepo/branches/release%2Fx" }
      },
      {
        action: "changes.detail",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/detail" }
      },
      {
        action: "changes.commit_message.get",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/message" }
      },
      {
        action: "changes.topic.get",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/topic" }
      },
      {
        action: "changes.custom_keyed_values.get",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/custom_keyed_values" }
      },
      {
        action: "changes.messages.list",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/messages" }
      },
      {
        action: "changes.comments.list",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/comments" }
      },
      {
        action: "changes.submitted_together",
        input: { changeId: "I123", options: ["CURRENT_REVISION", "CURRENT_COMMIT"] },
        result: {
          method: "GET",
          path: "/changes/I123/submitted_together",
          query: { o: ["CURRENT_REVISION", "CURRENT_COMMIT"] }
        }
      },
      {
        action: "reviewers.list",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/reviewers/" }
      },
      {
        action: "reviewers.get",
        input: { changeId: "I123", accountId: "1001" },
        result: { method: "GET", path: "/changes/I123/reviewers/1001" }
      },
      {
        action: "reviewers.votes.list",
        input: { changeId: "I123", accountId: "1001" },
        result: { method: "GET", path: "/changes/I123/reviewers/1001/votes/" }
      },
      {
        action: "changes.included_in",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/in" }
      },
      {
        action: "revisions.get",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7" }
      },
      {
        action: "revisions.commit.get",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/commit" }
      },
      {
        action: "revisions.description.get",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/description" }
      },
      {
        action: "revisions.actions.get",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/actions" }
      },
      {
        action: "revisions.files.list",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/files/" }
      },
      {
        action: "revisions.file.content",
        input: { changeId: "I123", revision: "7", fileId: "src/main.js" },
        result: { method: "GET", path: "/changes/I123/revisions/7/files/src%2Fmain.js/content" }
      },
      {
        action: "revisions.file.diff",
        input: {
          changeId: "I123",
          revision: "7",
          fileId: "src/main.js",
          base: "base-1",
          context: 10,
          intraline: true
        },
        result: {
          method: "GET",
          path: "/changes/I123/revisions/7/files/src%2Fmain.js/diff",
          query: { base: "base-1", context: 10, intraline: true }
        }
      },
      {
        action: "revisions.file.blame",
        input: { changeId: "I123", revision: "7", fileId: "src/main.js", base: true },
        result: {
          method: "GET",
          path: "/changes/I123/revisions/7/files/src%2Fmain.js/blame",
          query: { base: true }
        }
      },
      {
        action: "revisions.patch.get",
        input: { changeId: "I123", revision: "7", zip: true, download: true },
        result: {
          method: "GET",
          path: "/changes/I123/revisions/7/patch",
          query: { zip: true, download: true }
        }
      },
      {
        action: "revisions.related",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/related" }
      },
      {
        action: "revisions.review.get",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/review" }
      },
      {
        action: "revisions.mergeable.get",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/mergeable" }
      },
      {
        action: "revisions.submit_type.get",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/submit_type" }
      },
      {
        action: "revisions.comments.list",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/comments/" }
      },
      {
        action: "revisions.comment.get",
        input: { changeId: "I123", revision: "7", commentId: "c1" },
        result: { method: "GET", path: "/changes/I123/revisions/7/comments/c1" }
      },
      {
        action: "revisions.drafts.list",
        input: { changeId: "I123", revision: "7" },
        authenticated: true,
        result: { method: "GET", path: "/changes/I123/revisions/7/drafts/", authenticated: true }
      },
      {
        action: "revisions.draft.get",
        input: { changeId: "I123", revision: "7", draftId: "d1" },
        authenticated: true,
        result: { method: "GET", path: "/changes/I123/revisions/7/drafts/d1", authenticated: true }
      },
      {
        action: "revisions.reviewers.list",
        input: { changeId: "I123", revision: "7" },
        result: { method: "GET", path: "/changes/I123/revisions/7/reviewers/" }
      },
      {
        action: "revisions.reviewers.votes.list",
        input: { changeId: "I123", revision: "7", accountId: "1001" },
        result: { method: "GET", path: "/changes/I123/revisions/7/reviewers/1001/votes/" }
      },
      {
        action: "attention_set.get",
        input: { changeId: "I123" },
        result: { method: "GET", path: "/changes/I123/attention" }
      }
    ];

    for (const testCase of cases) {
      await expectDryRunCase("read", { action: testCase.action, ...testCase.input }, testCase);
    }
  });

  it("covers remaining write request builders and body fallbacks", async () => {
    const cases = [
      {
        action: "changes.commit_message.set",
        input: { changeId: "I123", message: "Update" },
        result: {
          method: "PUT",
          path: "/changes/I123/message",
          bodyKeys: ["message"]
        }
      },
      {
        action: "changes.topic.set",
        input: { changeId: "I123", topic: "topic-1" },
        result: {
          method: "PUT",
          path: "/changes/I123/topic",
          bodyKeys: ["topic"]
        }
      },
      {
        action: "changes.topic.delete",
        input: { changeId: "I123" },
        result: {
          method: "DELETE",
          path: "/changes/I123/topic"
        }
      },
      {
        action: "changes.wip.set",
        input: { changeId: "I123", message: "Mark wip" },
        result: {
          method: "POST",
          path: "/changes/I123/wip",
          bodyKeys: ["message"]
        }
      },
      {
        action: "changes.ready.set",
        input: { changeId: "I123", message: "Ready" },
        result: {
          method: "POST",
          path: "/changes/I123/ready",
          bodyKeys: ["message"]
        }
      },
      {
        action: "changes.private.set",
        input: { changeId: "I123", message: "Private" },
        result: {
          method: "POST",
          path: "/changes/I123/private",
          bodyKeys: ["message"]
        }
      },
      {
        action: "changes.private.delete",
        input: { changeId: "I123" },
        result: {
          method: "DELETE",
          path: "/changes/I123/private"
        }
      },
      {
        action: "changes.hashtags.set",
        input: { changeId: "I123", hashtags: { add: ["alpha"], remove: ["beta"] } },
        result: {
          method: "POST",
          path: "/changes/I123/hashtags",
          bodyKeys: ["add", "remove"]
        }
      },
      {
        action: "changes.hashtags.set",
        input: { changeId: "I123", add: ["alpha"], remove: ["beta"] },
        result: {
          method: "POST",
          path: "/changes/I123/hashtags",
          bodyKeys: ["add", "remove"]
        }
      },
      {
        action: "changes.custom_keyed_values.set",
        input: { changeId: "I123", values: { app: "pact", level: "high" } },
        result: {
          method: "POST",
          path: "/changes/I123/custom_keyed_values",
          bodyKeys: ["app", "level"]
        }
      },
      {
        action: "changes.custom_keyed_values.set",
        input: { changeId: "I123", add: ["alpha"], remove: ["beta"] },
        result: {
          method: "POST",
          path: "/changes/I123/custom_keyed_values",
          bodyKeys: ["add", "remove"]
        }
      },
      {
        action: "reviewers.add",
        input: { changeId: "I123", reviewer: "alice@example.com", state: "REVIEWER" },
        result: {
          method: "POST",
          path: "/changes/I123/reviewers",
          bodyKeys: ["reviewer", "state"]
        }
      },
      {
        action: "reviewers.delete",
        input: { changeId: "I123", accountId: "1001", reason: "cleanup" },
        result: {
          method: "DELETE",
          path: "/changes/I123/reviewers/1001",
          bodyKeys: ["reason"]
        }
      },
      {
        action: "reviewers.vote.delete",
        input: { changeId: "I123", accountId: "1001", labelId: "Code-Review", reason: "reset" },
        result: {
          method: "POST",
          path: "/changes/I123/reviewers/1001/votes/Code-Review/delete",
          bodyKeys: ["reason"]
        }
      },
      {
        action: "revisions.description.set",
        input: { changeId: "I123", revision: "7", description: "Updated" },
        result: {
          method: "PUT",
          path: "/changes/I123/revisions/7/description",
          bodyKeys: ["description"]
        }
      },
      {
        action: "revisions.review.set",
        input: {
          changeId: "I123",
          revision: "7",
          review: { message: "Looks good", labels: { "Code-Review": 1 } }
        },
        result: {
          method: "POST",
          path: "/changes/I123/revisions/7/review",
          bodyKeys: ["labels", "message"]
        }
      },
      {
        action: "revisions.review.set",
        input: {
          changeId: "I123",
          revision: "7",
          message: "Looks good",
          labels: { "Code-Review": 1 }
        },
        result: {
          method: "POST",
          path: "/changes/I123/revisions/7/review",
          bodyKeys: ["labels", "message"]
        }
      },
      {
        action: "revisions.reviewed.set",
        input: { changeId: "I123", revision: "7", fileId: "src/main.js" },
        result: {
          method: "PUT",
          path: "/changes/I123/revisions/7/files/src%2Fmain.js/reviewed"
        }
      },
      {
        action: "revisions.reviewed.delete",
        input: { changeId: "I123", revision: "7", fileId: "src/main.js" },
        result: {
          method: "DELETE",
          path: "/changes/I123/revisions/7/files/src%2Fmain.js/reviewed"
        }
      },
      {
        action: "drafts.create",
        input: { changeId: "I123", revision: "7", fileId: "src/main.js", line: 10, message: "note" },
        result: {
          method: "PUT",
          path: "/changes/I123/revisions/7/drafts/src%2Fmain.js",
          bodyKeys: ["line", "message"]
        }
      },
      {
        action: "drafts.update",
        input: { changeId: "I123", revision: "7", draftId: "d1", line: 10, message: "note" },
        result: {
          method: "PUT",
          path: "/changes/I123/revisions/7/drafts/d1",
          bodyKeys: ["line", "message"]
        }
      },
      {
        action: "drafts.delete",
        input: { changeId: "I123", revision: "7", draftId: "d1" },
        result: {
          method: "DELETE",
          path: "/changes/I123/revisions/7/drafts/d1"
        }
      },
      {
        action: "edit.get",
        input: { changeId: "I123" },
        result: {
          method: "GET",
          path: "/changes/I123/edit"
        }
      },
      {
        action: "edit.file.put",
        input: {
          changeId: "I123",
          fileId: "src/main.js",
          content: "console.log('hi');",
          contentType: "text/javascript"
        },
        result: {
          method: "PUT",
          path: "/changes/I123/edit/src%2Fmain.js",
          rawBody: {
            byteLength: 18,
            contentType: "text/javascript"
          }
        }
      },
      {
        action: "edit.file.delete",
        input: { changeId: "I123", fileId: "src/main.js" },
        result: {
          method: "DELETE",
          path: "/changes/I123/edit/src%2Fmain.js"
        }
      },
      {
        action: "edit.publish",
        input: { changeId: "I123", notify: "OWNER" },
        result: {
          method: "POST",
          path: "/changes/I123/edit:publish",
          bodyKeys: ["notify"]
        }
      },
      {
        action: "edit.rebase",
        input: { changeId: "I123" },
        result: {
          method: "POST",
          path: "/changes/I123/edit:rebase"
        }
      },
      {
        action: "edit.delete",
        input: { changeId: "I123" },
        result: {
          method: "DELETE",
          path: "/changes/I123/edit"
        }
      },
      {
        action: "attention_set.add",
        input: { changeId: "I123", user: "alice@example.com", reason: "handoff", notify: "OWNER" },
        result: {
          method: "POST",
          path: "/changes/I123/attention",
          bodyKeys: ["notify", "reason", "user"]
        }
      },
      {
        action: "attention_set.remove",
        input: { changeId: "I123", accountId: "alice@example.com", reason: "handoff" },
        result: {
          method: "POST",
          path: "/changes/I123/attention/alice%40example.com/delete",
          bodyKeys: ["reason"]
        }
      }
    ];

    for (const testCase of cases) {
      await expectDryRunCase("write", { action: testCase.action, ...testCase.input }, testCase);
    }
  });

  it("covers remaining maintain request builders and dry-run bodies", async () => {
    const cases = [
      {
        action: "projects.create",
        input: {
          project: "org/repo",
          projectConfig: {
            description: "Repo",
            permissions_only: true
          }
        },
        result: {
          method: "PUT",
          path: "/projects/org%2Frepo",
          bodyKeys: ["description", "permissions_only"]
        }
      },
      {
        action: "projects.create",
        input: {
          project: "org/repo",
          config: {
            description: "Config body",
            create_empty_commit: true
          }
        },
        result: {
          method: "PUT",
          path: "/projects/org%2Frepo",
          bodyKeys: ["create_empty_commit", "description"]
        }
      },
      {
        action: "projects.create",
        input: {
          project: "org/repo",
          description: "Fallback",
          parent: "All-Projects",
          owners: ["admins"],
          branches: ["main"],
          create_empty_commit: true,
          permissions_only: false
        },
        result: {
          method: "PUT",
          path: "/projects/org%2Frepo",
          bodyKeys: ["branches", "create_empty_commit", "description", "owners", "parent", "permissions_only"]
        }
      },
      {
        action: "branches.create",
        input: { project: "org/repo", branch: "release/x", revision: "deadbeef" },
        result: {
          method: "PUT",
          path: "/projects/org%2Frepo/branches/release%2Fx",
          bodyKeys: ["revision"]
        }
      },
      {
        action: "branches.delete",
        input: { project: "org/repo", branch: "release/x" },
        result: {
          method: "DELETE",
          path: "/projects/org%2Frepo/branches/release%2Fx"
        }
      },
      {
        action: "changes.abandon",
        input: { changeId: "I123", message: "not needed" },
        result: {
          method: "POST",
          path: "/changes/I123/abandon",
          bodyKeys: ["message"]
        }
      },
      {
        action: "changes.restore",
        input: { changeId: "I123", message: "restore" },
        result: {
          method: "POST",
          path: "/changes/I123/restore",
          bodyKeys: ["message"]
        }
      },
      {
        action: "changes.rebase",
        input: { changeId: "I123", base: "deadbeef", allow_conflicts: true },
        result: {
          method: "POST",
          path: "/changes/I123/rebase",
          bodyKeys: ["allow_conflicts", "base"]
        }
      },
      {
        action: "changes.rebase_chain",
        input: { changeId: "I123", base: "deadbeef", validation_options: { validate: true } },
        result: {
          method: "POST",
          path: "/changes/I123/rebase:chain",
          bodyKeys: ["base", "validation_options"]
        }
      },
      {
        action: "changes.move",
        input: { changeId: "I123", destination_branch: "release/x", keep_all_votes: true },
        result: {
          method: "POST",
          path: "/changes/I123/move",
          bodyKeys: ["destination_branch", "keep_all_votes"]
        }
      },
      {
        action: "changes.submit",
        input: { changeId: "I123", wait_for_merge: true },
        result: {
          method: "POST",
          path: "/changes/I123/submit",
          bodyKeys: ["wait_for_merge"]
        }
      },
      {
        action: "changes.revert",
        input: { changeId: "I123", message: "revert", validation_options: { verify: true } },
        result: {
          method: "POST",
          path: "/changes/I123/revert",
          bodyKeys: ["message", "validation_options"]
        }
      },
      {
        action: "changes.submission.revert",
        input: { changeId: "I123", topic: "topic-1", work_in_progress: true },
        result: {
          method: "POST",
          path: "/changes/I123/revert_submission",
          bodyKeys: ["topic", "work_in_progress"]
        }
      },
      {
        action: "changes.delete",
        input: { changeId: "I123" },
        result: {
          method: "DELETE",
          path: "/changes/I123"
        }
      },
      {
        action: "changes.index",
        input: { changeId: "I123" },
        result: {
          method: "POST",
          path: "/changes/I123/index"
        }
      },
      {
        action: "changes.check",
        input: { changeId: "I123", fix: true },
        result: {
          method: "POST",
          path: "/changes/I123/check",
          bodyKeys: ["fix"]
        }
      },
      {
        action: "changes.fix",
        input: { changeId: "I123", delete_patch_set_if_commit_missing: true, expect_merged_as: "1234" },
        result: {
          method: "POST",
          path: "/changes/I123/fix",
          bodyKeys: ["delete_patch_set_if_commit_missing", "expect_merged_as"]
        }
      },
      {
        action: "comments.delete",
        input: { changeId: "I123", revision: "7", commentId: "c1", reason: "cleanup" },
        result: {
          method: "POST",
          path: "/changes/I123/revisions/7/comments/c1/delete",
          bodyKeys: ["reason"]
        }
      },
      {
        action: "revisions.rebase",
        input: { changeId: "I123", revision: "7", base: "deadbeef" },
        result: {
          method: "POST",
          path: "/changes/I123/revisions/7/rebase",
          bodyKeys: ["base"]
        }
      },
      {
        action: "revisions.submit",
        input: { changeId: "I123", revision: "7", wait_for_merge: true },
        result: {
          method: "POST",
          path: "/changes/I123/revisions/7/submit",
          bodyKeys: ["wait_for_merge"]
        }
      },
      {
        action: "revisions.cherrypick",
        input: {
          changeId: "I123",
          revision: "7",
          destination: "release/x",
          allow_conflicts: true,
          notify: "OWNER"
        },
        result: {
          method: "POST",
          path: "/changes/I123/revisions/7/cherrypick",
          bodyKeys: ["allow_conflicts", "destination", "notify"]
        }
      }
    ];

    for (const testCase of cases) {
      await expectDryRunCase("maintain", { action: testCase.action, ...testCase.input }, testCase);
    }
  });

  it("covers git review ref generation, remote URL fallbacks, and confirmation branches", async () => {
    queueSpawnResponses(
      { errorMessage: "remote lookup failed" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "cafebabe\n" }
    );

    const dryRun = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      dryRun: true,
      branch: "feature-x",
      topic: "topic",
      hashtags: ["alpha", "", "beta"],
      reviewer: ["alice", "bob"],
      cc: "carol,dave,,",
      notifyTo: ["team-1", "team-2"],
      notifyCc: "security",
      notifyBcc: ["audit"],
      notify: "OWNER",
      traceId: "trace-1",
      workInProgress: true,
      ready: true,
      isPrivate: true
    });

    expect(dryRun).toMatchObject({
      ok: true,
      dryRun: true,
      worktreePath: "/tmp/repo",
      remote: "origin",
      remoteUrl: "",
      targetRef:
        "HEAD:refs/for/feature-x%topic=topic,hashtag=alpha,hashtag=beta,r=alice,r=bob,cc=carol,cc=dave,notify-to=team-1,notify-to=team-2,notify-cc=security,notify-bcc=audit,notify=OWNER,trace=trace-1,wip,ready,private"
    });

    queueSpawnResponses(
      { code: 0, stdout: "https://alice:secret@gerrit.example/a/platform/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "feedface\n" },
      { code: 0, stdout: "To https://gerrit.example/a/platform/repo.git\n" }
    );
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json", "x-gerrit-trace": "trace-success" },
        text: JSON.stringify([
          {
            id: "I1234567890",
            _number: 7777,
            number: "7777",
            status: "NEW",
            project: "platform/repo",
            branch: "main",
            current_revision: "otherrev",
            revisions: {
              otherrev: { _number: 3 },
              feedface: { _number: 5, commit: { commit: "feedface" } }
            }
          }
        ])
      })
    );

    const confirmed = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true,
      branch: "feature/x"
    });

    expect(confirmed).toMatchObject({
      ok: true,
      remote: "origin",
      worktreePath: "/tmp/repo",
      provider: "gerrit",
      targetProvider: "gerrit",
      targetKind: "codespace",
      status: "completed",
      remoteUrl: "https://%3Credacted%3E:%3Credacted%3E@gerrit.example/a/platform/repo.git",
      changeId: "I1234567890",
      changeNumber: "7777",
      project: "platform/repo",
      branch: "main",
      reviewUrl: "https://gerrit.example/c/platform/repo/+/7777"
    });
    expect(confirmed.completion).toMatchObject({
      confirmed: true,
      query: "commit:feedface",
      attempts: 1,
      changeId: "I1234567890"
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/changes/?pp=0&q=commit%3Afeedface");

    queueSpawnResponses(
      { code: 0, stdout: "git@example.com:org/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "deadbeef\n" },
      { code: 0, stdout: "remote:   https://gerrit.example/+/6543 old\n" }
    );
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json" },
          text: "[]"
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json" },
          text: "[]"
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json" },
          text: "[]"
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          status: 200,
          headers: { "content-type": "application/json" },
          text: JSON.stringify({
            id: "I999999999",
            _number: 6543,
            number: "6543",
            status: "NEW",
            project: "org/repo",
            branch: "release/x",
            current_revision: "deadbeef",
            revisions: {
              deadbeef: { _number: 8 }
            }
          })
        })
      );

    const fallback = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true,
      branch: "refs/heads/release/x",
      topic: "topic-7",
      confirmationTimeoutMs: 0
    });

    expect(fallback).toMatchObject({
      ok: true,
      remote: "origin",
      worktreePath: "/tmp/repo",
      provider: "gerrit",
      targetProvider: "gerrit",
      targetKind: "codespace",
      status: "completed",
      remoteUrl: "git@example.com:org/repo.git",
      project: "org/repo",
      branch: "release/x",
      reviewUrl: "http://127.0.0.1:18080/c/org/repo/+/6543"
    });
    expect(fallback.completion).toMatchObject({
      confirmed: true,
      query: "change:6543",
      attempts: 1,
      changeId: "I999999999"
    });
    expect(String(fetchMock.mock.calls[3][0])).toContain("/changes/6543/detail?");
  });

  it("covers upload failure and timeout branches", async () => {
    queueSpawnResponses(
      { code: 0, stdout: "https://gerrit.example/a/platform/repo.git\n" },
      { code: 1, stderr: "status failed\n" }
    );

    await expect(
      uploadGerritGitChange({
        worktreePath: "/tmp/repo",
        remote: "origin"
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: "status failed\n",
      worktreePath: "/tmp/repo"
    });

    queueSpawnResponses(
      { code: 0, stdout: "https://gerrit.example/a/platform/repo.git\n" },
      { code: 0, stdout: "M src/main.js\n" }
    );

    await expect(
      uploadGerritGitChange({
        worktreePath: "/tmp/repo",
        remote: "origin"
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: "Worktree has uncommitted changes. Commit first or pass allowDirty=true.",
      worktreePath: "/tmp/repo"
    });

    queueSpawnResponses(
      { code: 0, stdout: "https://gerrit.example/a/platform/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 1, stderr: "head failed\n" }
    );

    await expect(
      uploadGerritGitChange({
        worktreePath: "/tmp/repo",
        remote: "origin",
        allowDirty: true
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: "head failed\n",
      worktreePath: "/tmp/repo"
    });

    queueSpawnResponses(
      { code: 0, stdout: "https://gerrit.example/a/platform/repo.git\n" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "deadbeef\n" },
      { code: 1, stderr: "push failed\n" }
    );

    await expect(
      uploadGerritGitChange({
        worktreePath: "/tmp/repo",
        remote: "origin",
        allowDirty: true
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 502,
      error: "push failed\n",
      head: "deadbeef"
    });

    vi.useFakeTimers();
    try {
      queueSpawnResponses(
        { code: 0, stdout: "https://gerrit.example/a/platform/repo.git\n" },
        { code: 0, stdout: "\n" },
        { code: 0, stdout: "cafebabe\n" },
        { code: 0, stdout: "To https://gerrit.example/a/platform/repo.git\n" }
      );
      fetchMock
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 404,
            statusText: "Not Found",
            headers: { "content-type": "application/json" },
            text: "{\"message\":\"missing\"}"
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 200,
            headers: { "content-type": "application/json" },
            text: JSON.stringify([
              {
                id: "I-no-match",
                status: "NEW",
                project: "platform/repo",
                branch: "main",
                current_revision: "otherrev",
                revisions: {
                  otherrev: { _number: 1, commit: { commit: "otherrev" } }
                }
              }
            ])
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 404,
            statusText: "Not Found",
            headers: { "content-type": "application/json" },
            text: "{\"message\":\"missing\"}"
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 404,
            statusText: "Not Found",
            headers: { "content-type": "application/json" },
            text: "{\"message\":\"missing\"}"
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 200,
            headers: { "content-type": "application/json" },
            text: JSON.stringify([
              {
                id: "I-no-match",
                status: "NEW",
                project: "platform/repo",
                branch: "main",
                current_revision: "otherrev",
                revisions: {
                  otherrev: { _number: 1, commit: { commit: "otherrev" } }
                }
              }
            ])
          })
        )
        .mockResolvedValueOnce(
          createFetchResponse({
            status: 404,
            statusText: "Not Found",
            headers: { "content-type": "application/json" },
            text: "{\"message\":\"missing\"}"
          })
        );

      const timeoutPromise = uploadGerritGitChange({
        worktreePath: "/tmp/repo",
        remote: "origin",
        allowDirty: true,
        confirmationTimeoutMs: 1
      });
      await vi.runAllTimersAsync();
      const timeoutResponse = await timeoutPromise;

      expect(timeoutResponse).toMatchObject({
        ok: false,
        status: 502,
        head: "cafebabe",
        completion: {
          confirmed: false,
          attempts: 2,
          confirmationMethod: "gerrit_rest_change_query"
        }
      });
    } finally {
      vi.useRealTimers();
    }

    queueSpawnResponses(
      { errorMessage: "remote lookup failed" },
      { code: 0, stdout: "\n" },
      { code: 0, stdout: "feedface\n" },
      { code: 0, stdout: "To https://gerrit.example/+/1234\n" }
    );
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      createFetchResponse({
        status: 200,
        headers: { "content-type": "application/json" },
        text: JSON.stringify([
          {
            id: "I123",
            status: "NEW",
            project: "",
            branch: "main",
            current_revision: "feedface",
            revisions: {
              feedface: { _number: 1, commit: { commit: "feedface" } }
            }
          }
        ])
      })
    );

    const unresolvedRemote = await uploadGerritGitChange({
      worktreePath: "/tmp/repo",
      remote: "origin",
      allowDirty: true,
      baseUrl: "https://gerrit.example"
    });

    expect(unresolvedRemote).toMatchObject({
      ok: true,
      project: "",
      reviewUrl: "",
      completion: {
        confirmed: true,
        query: "commit:feedface"
      }
    });
  });
});
