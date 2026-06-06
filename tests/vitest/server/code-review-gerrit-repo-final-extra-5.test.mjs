import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    spawn: spawnMock
  };
});

vi.stubGlobal("fetch", fetchMock);

import {
  executeGerritCommonOperation
} from "../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs";
import {
  executeRepoOperation
} from "../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs";

function createSpawnResult({ code = 0, stdout = "", stderr = "", onStdin } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  if (typeof onStdin === "function") {
    const chunks = [];
    child.stdin.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      onStdin(Buffer.concat(chunks).toString("utf8"));
    });
  }
  setImmediate(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  });
  return child;
}

function createSpawnErrorResult(message = "spawn failed") {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  setImmediate(() => {
    child.emit("error", new Error(message));
  });
  return child;
}

function installRepoSpawn({
  root = "/virtual/repo",
  head = "abc123",
  branch = "main"
} = {}) {
  spawnMock.mockImplementation((command, args = []) => {
    if (command === "git" && args[0] === "-C") {
      return createSpawnResult({ stdout: `${root}\n` });
    }
    if (command === "git" && args[0] === "rev-parse") {
      return createSpawnResult({ stdout: `${head}\n` });
    }
    if (command === "git" && args[0] === "branch") {
      return createSpawnResult({ stdout: `${branch}\n` });
    }
    if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
      return createSpawnResult({ stdout: "https://gerrit.example/platform/repo.git\n" });
    }
    if (command === "git" && args[0] === "push") {
      return createSpawnResult({ stdout: "pushed\n" });
    }
    if (command === "git" && args[0] === "status") {
      return createSpawnResult({ stdout: "## main\n" });
    }
    if (command === "gh") {
      return createSpawnResult({
        stdout: args[0] === "pr" ? "https://github.example/owner/repo/pull/42\n" : "{\"ok\":true}\n",
        onStdin: (value) => {
          spawnMock.stdinPayload = value;
        }
      });
    }
    if (command === "glab") {
      return createSpawnResult({ stdout: "https://gitlab.example/group/project/-/merge_requests/7\n" });
    }
    if (command === "/bin/sh") {
      return createSpawnResult({ stdout: "gh\n" });
    }
    return createSpawnResult({ stdout: `${command} ${args.join(" ")}\n` });
  });
}

async function repo(operationId, input = {}, authSession = { user: { scopes: ["repo:admin"] } }) {
  return executeRepoOperation({
    operationId,
    input: {
      repoId: "/virtual/repo",
      ...input
    },
    authSession
  });
}

beforeEach(() => {
  spawnMock.mockReset();
  fetchMock.mockReset();
  delete spawnMock.stdinPayload;
  installRepoSpawn();
});

describe("code review Gerrit final extra coverage", () => {
  it("builds dry-run request plans for less common read, write, and maintain actions", async () => {
    await expect(executeGerritCommonOperation({
      mode: "read",
      input: {
        dryRun: true,
        action: "reviewers.suggest",
        changeId: "Iabc",
        query: "alice",
        limit: 3,
        reviewerState: "CC",
        excludeGroups: true
      }
    })).resolves.toMatchObject({
      ok: true,
      result: {
        method: "GET",
        path: "/changes/Iabc/suggest_reviewers",
        query: {
          q: "alice",
          n: 3,
          "reviewer-state": "CC",
          "exclude-groups": true
        }
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "read",
      input: {
        dryRun: true,
        action: "revisions.file.blame",
        changeId: "Iabc",
        revision: "current",
        fileId: "src/main.js",
        base: true
      }
    })).resolves.toMatchObject({
      result: {
        path: "/changes/Iabc/revisions/current/files/src%2Fmain.js/blame",
        query: { base: true }
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "write",
      input: {
        dryRun: true,
        action: "changes.hashtags.set",
        changeId: "Iabc",
        hashtags: { add: ["ready"], remove: ["old"] }
      }
    })).resolves.toMatchObject({
      result: {
        method: "POST",
        path: "/changes/Iabc/hashtags",
        authenticated: true,
        bodyKeys: ["add", "remove"]
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "write",
      input: {
        dryRun: true,
        action: "edit.file.put",
        changeId: "Iabc",
        fileId: "src/main.js",
        contentBase64: Buffer.from("hello").toString("base64"),
        contentType: "text/javascript"
      }
    })).resolves.toMatchObject({
      result: {
        method: "PUT",
        path: "/changes/Iabc/edit/src%2Fmain.js",
        authenticated: true,
        rawBody: {
          byteLength: 5,
          contentType: "text/javascript"
        }
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "maintain",
      input: {
        dryRun: true,
        action: "revisions.cherrypick",
        changeId: "Iabc",
        revision: "current",
        destination: "release",
        allow_conflicts: true,
        notify: "OWNER"
      }
    })).resolves.toMatchObject({
      result: {
        method: "POST",
        path: "/changes/Iabc/revisions/current/cherrypick",
        authenticated: true,
        bodyKeys: ["allow_conflicts", "destination", "notify"]
      }
    });
  });

  it("covers live Gerrit request parsing, auth, and request-plan body normalization", async () => {
    const previousPassword = process.env.PACT_GERRIT_HTTP_PASSWORD;
    const previousUsername = process.env.PACT_GERRIT_USERNAME;
    process.env.PACT_GERRIT_HTTP_PASSWORD = "secret";
    process.env.PACT_GERRIT_USERNAME = "alice";
    fetchMock.mockImplementation(async (requestUrl, init = {}) => {
      expect(String(requestUrl)).toContain("/a/changes/Iabc/suggest_reviewers");
      expect(String(requestUrl)).toContain("exclude-groups=true");
      expect(init.headers.Authorization).toBe("Basic " + Buffer.from("alice:secret").toString("base64"));
      expect(init.headers.Accept).toBe("application/json");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get(name) {
            if (name === "content-type") return "application/json; charset=utf-8";
            if (name === "x-gerrit-trace") return "trace-123";
            if (name === "x-gerrit-updatedref") return "refs/changes/01/1/1";
            return null;
          }
        },
        text: async () => ")]}'\n[{\"_number\":1,\"id\":\"Iabc\",\"project\":\"platform/repo\",\"branch\":\"main\",\"status\":\"OPEN\",\"current_revision\":\"deadbeef\",\"revisions\":{\"deadbeef\":{\"_number\":\"5\",\"commit\":{\"commit\":\"deadbeef\"}}}}]"
      };
    });

    await expect(executeGerritCommonOperation({
      mode: "read",
      input: {
        action: "reviewers.suggest",
        changeId: "Iabc",
        query: "alice",
        limit: 2,
        reviewerState: "CC",
        excludeGroups: true,
        baseUrl: "https://gerrit.example",
        username: "alice",
        password: "secret"
      }
    })).resolves.toMatchObject({
      ok: true,
      action: "reviewers.suggest",
      gerrit: {
        authenticated: true,
        status: 200,
        traceId: "trace-123",
        url: "https://gerrit.example/a/changes/Iabc/suggest_reviewers"
      },
      result: [
        {
          _number: 1,
          id: "Iabc",
          project: "platform/repo",
          branch: "main"
        }
      ]
    });

    process.env.PACT_GERRIT_HTTP_PASSWORD = previousPassword;
    process.env.PACT_GERRIT_USERNAME = previousUsername;

    await expect(executeGerritCommonOperation({
      mode: "write",
      input: {
        dryRun: true,
        action: "changes.create",
        body: { project: "platform/repo", branch: "main", subject: "new change" }
      }
    })).resolves.toMatchObject({
      result: {
        method: "POST",
        path: "/changes/",
        authenticated: true,
        bodyKeys: ["branch", "project", "subject"]
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "read",
      input: {
        dryRun: true,
        action: "changes.hashtags.get",
        changeId: "Iabc"
      }
    })).resolves.toMatchObject({
      result: {
        method: "GET",
        path: "/changes/Iabc/hashtags"
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "write",
      input: {
        dryRun: true,
        action: "edit.file.put",
        changeId: "Iabc",
        fileId: "src/main.js",
        contentBase64: Buffer.from("hello").toString("base64"),
        contentType: "text/javascript"
      }
    })).resolves.toMatchObject({
      result: {
        method: "PUT",
        path: "/changes/Iabc/edit/src%2Fmain.js",
        rawBody: {
          byteLength: 5,
          contentType: "text/javascript"
        }
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "maintain",
      input: {
        dryRun: true,
        action: "projects.create",
        project: "platform/repo",
        projectConfig: {
          description: "Platform repo",
          parent: "All-Projects"
        }
      }
    })).resolves.toMatchObject({
      result: {
        method: "PUT",
        path: "/projects/platform%2Frepo",
        bodyKeys: ["description", "parent"]
      }
    });

    await expect(executeGerritCommonOperation({
      mode: "maintain",
      input: {
        dryRun: true,
        action: "changes.submission.revert",
        changeId: "Iabc",
        message: "rollback",
        topic: "release",
        work_in_progress: true,
        validation_options: { strict: true }
      }
    })).resolves.toMatchObject({
      result: {
        method: "POST",
        path: "/changes/Iabc/revert_submission",
        bodyKeys: ["message", "topic", "validation_options", "work_in_progress"]
      }
    });
  });
});

describe("repo operations final extra coverage", () => {
  it("covers proposal providers, review labels, and local merge/rebase/revert dry-runs", async () => {
    await expect(repo("repo.proposal.create", {
      provider: "github",
      sourceRef: "refs/heads/feature",
      targetRef: "refs/heads/main",
      title: "Open PR",
      body: "details",
      dryRun: true
    })).resolves.toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        provider: "github",
        args: ["pr", "create", "--base", "main", "--head", "feature", "--title", "Open PR", "--body", "details"]
      }
    });

    await expect(repo("repo.proposal.create", {
      provider: "gitlab",
      sourceRef: "feature",
      targetRef: "main",
      title: "Open MR",
      body: "details",
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        dryRun: true,
        provider: "gitlab",
        args: ["mr", "create", "--source-branch", "feature", "--target-branch", "main", "--title", "Open MR", "--description", "details"]
      }
    });

    await expect(repo("repo.review.approve", {
      provider: "github",
      reviewTarget: "12",
      body: "looks good",
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        dryRun: true,
        provider: "github",
        args: ["pr", "review", "12", "--approve", "--body", "looks good"]
      }
    });

    await expect(repo("repo.review.requestChanges", {
      provider: "gerrit",
      reviewTarget: "Iabc",
      label: "Verified=-1",
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        dryRun: true,
        provider: "gerrit",
        action: "revisions.review.set",
        review: {
          labels: { Verified: -1 }
        }
      }
    });

    await expect(repo("repo.merge", {
      reviewTarget: "feature",
      provider: "local",
      strategy: "squash",
      confirm: true,
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        dryRun: true,
        provider: "local",
        command: "git",
        args: ["merge", "--squash", "feature"]
      }
    });

    await expect(repo("repo.rebase", {
      provider: "local",
      targetRef: "feature",
      baseRef: "main",
      confirm: true,
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        dryRun: true,
        provider: "local",
        command: "git",
        args: ["rebase", "main"]
      }
    });

    await expect(repo("repo.revert", {
      provider: "local",
      targetRef: "abc123",
      confirm: true,
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        dryRun: true,
        provider: "local",
        command: "git",
        args: ["revert", "--no-edit", "abc123"]
      }
    });
  });

  it("covers confirmation, dynamic scope, unsupported provider, and governance dry-runs", async () => {
    await expect(repo("repo.push", {
      remote: "origin",
      sourceRef: "feature",
      targetRef: "main",
      force: true
    }, { user: { scopes: ["repo:write"] } })).resolves.toMatchObject({
      ok: false,
      status: 403,
      error: { code: "repo_scope_required" }
    });

    await expect(repo("repo.merge", {
      reviewTarget: "feature",
      provider: "local"
    })).resolves.toMatchObject({
      ok: false,
      status: 409,
      error: { code: "confirmation_required" }
    });

    await expect(repo("repo.proposal.create", {
      provider: "unknown",
      sourceRef: "feature",
      targetRef: "main",
      title: "Unknown"
    })).resolves.toMatchObject({
      ok: false,
      status: 400,
      error: { code: "unsupported_provider" }
    });

    await expect(repo("repo.protection.set", {
      provider: "github",
      repositorySlug: "org/repo",
      branchPattern: "main",
      confirm: true,
      dryRun: true,
      rules: { required_status_checks: null }
    })).resolves.toMatchObject({
      data: {
        dryRun: true,
        provider: "github",
        command: "gh",
        args: ["api", "-X", "PUT", "repos/org/repo/branches/main/protection", "--input", "-"],
        payload: { required_status_checks: null }
      }
    });

    await expect(repo("repo.webhook.set", {
      provider: "github",
      repositorySlug: "org/repo",
      webhookId: "9",
      payload: { active: false },
      confirm: true,
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        args: ["api", "-X", "PATCH", "repos/org/repo/hooks/9", "--input", "-"],
        payload: { active: false }
      }
    });

    await expect(repo("repo.member.set", {
      provider: "github",
      repositorySlug: "org/repo",
      subjectId: "alice",
      role: "push",
      confirm: true,
      dryRun: true
    })).resolves.toMatchObject({
      data: {
        args: ["api", "-X", "PUT", "repos/org/repo/collaborators/alice", "-f", "permission=push"]
      }
    });
  });

  it("covers current-repo resolution, command existence failure, and live github/glab inputs", async () => {
    spawnMock.mockImplementation((command, args = []) => {
      if (command === "git" && args[0] === "-C") {
        return createSpawnResult({ stdout: `${process.cwd()}\n` });
      }
      if (command === "git" && args[0] === "rev-parse") {
        return createSpawnResult({ stdout: "abc123\n" });
      }
      if (command === "git" && args[0] === "branch") {
        return createSpawnResult({ stdout: "main\n" });
      }
      if (command === "/bin/sh") {
        return createSpawnErrorResult("command lookup failed");
      }
      return createSpawnResult({ stdout: `${command} ${args.join(" ")}\n` });
    });

    await expect(executeRepoOperation({
      operationId: "repo.status",
      input: {
        repoId: "current",
        targetType: "pr",
        targetId: "42"
      }
    })).resolves.toMatchObject({
      ok: true,
      data: {
        targetType: "pr",
        available: false,
        reason: "No local adapter is available for this status target."
      },
      repo: {
        repoId: "current",
        root: process.cwd(),
        head: "abc123",
        branch: "main"
      }
    });

    spawnMock.mockReset();
    delete spawnMock.stdinPayload;
    installRepoSpawn();

    await expect(executeRepoOperation({
      operationId: "repo.proposal.create",
      input: {
        repoId: "/virtual/repo",
        provider: "gerrit",
        sourceRef: "refs/heads/feature",
        targetRef: "refs/heads/main",
        title: "Gerrit proposal",
        hashtags: ["ready", "triage"],
        dryRun: false
      }
    })).resolves.toMatchObject({
      ok: true,
      data: {
        provider: "gerrit",
        remote: "origin",
        sourceRef: "refs/heads/feature",
        reviewRef: "refs/for/main%topic=Gerrit%20proposal,hashtag=ready,hashtag=triage"
      }
    });

    await expect(executeRepoOperation({
      operationId: "repo.proposal.create",
      input: {
        repoId: "/virtual/repo",
        provider: "gitlab",
        sourceRef: "feature",
        targetRef: "main",
        title: "GitLab proposal",
        body: "details",
        dryRun: false
      }
    })).resolves.toMatchObject({
      ok: true,
      data: {
        provider: "gitlab",
        stdout: "https://gitlab.example/group/project/-/merge_requests/7\n"
      }
    });

    await expect(executeRepoOperation({
      operationId: "repo.protection.set",
      input: {
        repoId: "/virtual/repo",
        provider: "github",
        repositorySlug: "org/repo",
        branchPattern: "main",
        rules: { required_status_checks: null },
        confirm: true,
        dryRun: false
      }
    })).resolves.toMatchObject({
      ok: true,
      data: {
        provider: "github",
        stdout: "{\"ok\":true}\n",
        stderr: ""
      }
    });
    expect(spawnMock.stdinPayload).toBe(JSON.stringify({ required_status_checks: null }));

    await expect(executeRepoOperation({
      operationId: "repo.webhook.set",
      input: {
        repoId: "/virtual/repo",
        provider: "github",
        repositorySlug: "org/repo",
        payload: { active: false },
        confirm: true,
        dryRun: false
      }
    })).resolves.toMatchObject({
      ok: true,
      data: {
        provider: "github",
        stdout: "{\"ok\":true}\n",
        stderr: ""
      }
    });
    expect(spawnMock.stdinPayload).toBe(JSON.stringify({ active: false }));

    await expect(executeRepoOperation({
      operationId: "repo.push",
      input: {
        repoId: "/virtual/repo",
        remote: "origin",
        sourceRef: "feature",
        targetRef: "main",
        protected: true,
        confirm: true,
        dryRun: true
      },
      authSession: { user: { scopes: ["repo:maintain"] } }
    })).resolves.toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        command: "git",
        args: ["push", "origin", "feature:main"]
      }
    });
  });
});
