import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  describe,
  expect,
  it,
  afterEach,
  beforeAll,
  beforeEach,
  vi
} from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const executeGerritCommonOperationMock = vi.hoisted(() => vi.fn(async ({ mode, input } = {}) => ({
  mode,
  action: input.action,
  input,
  ok: true
})));

vi.mock("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs");
  return {
    ...actual,
    executeGerritCommonOperation: executeGerritCommonOperationMock
  };
});

let executeRepoOperation;
let REPO_OPERATION_IDS;
const originalPath = process.env.PATH;

function runGit(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function writeTextFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function installFakeCommand(root, name, body) {
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const commandPath = path.join(binDir, name);
  await fs.writeFile(commandPath, `#!/bin/sh\n${body}\n`, "utf8");
  await fs.chmod(commandPath, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ""}`;
  return commandPath;
}

async function withTempRepo(testCase, { secondCommit = true } = {}) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-repo-operations-"));
  try {
    runGit(repoRoot, ["init"]);
    runGit(repoRoot, ["config", "user.name", "Unit Test"]);
    runGit(repoRoot, ["config", "user.email", "unit-test@example.test"]);

    await writeTextFile(path.join(repoRoot, "README.md"), "initial\n");
    await writeTextFile(path.join(repoRoot, "notes.txt"), "revision-1\n");
    runGit(repoRoot, ["add", "README.md", "notes.txt"]);
    runGit(repoRoot, ["commit", "-m", "initial commit"]);
    runGit(repoRoot, ["branch", "-M", "main"]);

    if (secondCommit) {
      await writeTextFile(path.join(repoRoot, "notes.txt"), "revision-2\n");
      runGit(repoRoot, ["add", "notes.txt"]);
      runGit(repoRoot, ["commit", "-m", "update notes"]);
    }

    return await testCase(repoRoot);
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
}

describe("repo-operations coverage", () => {
  beforeAll(async () => {
    ({ executeRepoOperation, REPO_OPERATION_IDS } = await import(
      "../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs"
    ));
  });

  beforeEach(() => {
    executeGerritCommonOperationMock.mockClear();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it("rejects unsupported operations with the exact reason and allowed list", async () => {
    const result = await executeRepoOperation({ operationId: "repo.invalid", input: {} });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "unsupported_repo_operation" }
    });
    expect(result.error.details.allowedOperations).toEqual(expect.arrayContaining(REPO_OPERATION_IDS));
  });

  it("supports operationId fallback from input.action", async () => {
    await withTempRepo(async (repoRoot) => {
      const result = await executeRepoOperation({
        input: {
          action: "repo.status",
          repoId: repoRoot
        }
      });

      expect(result).toMatchObject({
        ok: true,
        operationId: "repo.status"
      });
    });
  });

  it("returns repo resolution errors for invalid repo paths", async () => {
    const result = await executeRepoOperation({
      operationId: "repo.status",
      input: { repoId: path.join(process.cwd(), "does-not-exist") }
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "repo_operation_failed" }
    });
    expect(result.error.message).toContain("repoId does not resolve to a git worktree");
  });

  it("reads repo status for worktree, branch, remote and change targets", async () => {
    await withTempRepo(async (repoRoot) => {
      const worktree = await executeRepoOperation({
        operationId: "repo.status",
        input: { repoId: repoRoot, targetType: "worktree" }
      });

      expect(worktree).toMatchObject({
        ok: true,
        operationId: "repo.status",
        data: { targetType: "worktree", dirty: false, branch: "main", head: expect.any(String) }
      });

      const branch = await executeRepoOperation({
        operationId: "repo.status",
        input: { repoId: repoRoot, targetType: "branch", targetId: "main" }
      });
      expect(branch.data).toMatchObject({
        targetType: "branch",
        targetId: "main",
        exists: true,
        commit: expect.any(String)
      });

      const remote = await executeRepoOperation({
        operationId: "repo.status",
        input: { repoId: repoRoot, targetType: "remote", targetId: "origin" }
      });
      expect(remote.data).toMatchObject({
        targetType: "remote",
        targetId: "origin",
        exists: false,
        url: "",
        refs: ""
      });

      const gerritChange = await executeRepoOperation({
        operationId: "repo.status",
        input: { repoId: repoRoot, targetType: "change", targetId: "I123" }
      });
      expect(gerritChange.data).toMatchObject({
        targetType: "change",
        targetId: "I123",
        gerrit: { mode: "read", action: "changes.detail", input: expect.objectContaining({ changeId: "I123" }) }
      });
    });
  });

  it("reads files from disk and from a commit ref", async () => {
    await withTempRepo(async (repoRoot) => {
      const latest = await executeRepoOperation({
        operationId: "repo.file.read",
        input: { repoId: repoRoot, path: "notes.txt" }
      });
      expect(latest.data).toMatchObject({
        path: "notes.txt",
        ref: "",
        content: "revision-2\n",
        encoding: "utf8"
      });

      const fromHistory = await executeRepoOperation({
        operationId: "repo.file.read",
        input: { repoId: repoRoot, path: "notes.txt", ref: "HEAD~1" }
      });
      expect(fromHistory.data.content).toBe("revision-1\n");
    });
  });

  it("lists tree by filesystem and git tree metadata", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeTextFile(path.join(repoRoot, "src", "nested", "a.txt"), "value\n");

      const working = await executeRepoOperation({
        operationId: "repo.tree.list",
        input: { repoId: repoRoot, path: "src" }
      });

      expect(working.data.path).toBe("src");
      expect(working.data.entries).toContainEqual({
        path: "src/nested",
        type: "tree"
      });

      const fromRef = await executeRepoOperation({
        operationId: "repo.tree.list",
        input: { repoId: repoRoot, path: "", ref: "HEAD" }
      });

      expect(fromRef.data.ref).toBe("HEAD");
      expect(fromRef.data.entries.some((entry) => entry.path === "notes.txt" && entry.type === "blob")).toBe(true);
      expect(fromRef.data.entries.some((entry) => typeof entry.size === "number" || entry.size === null)).toBe(true);
    });
  });

  it("reads diffs and commit metadata", async () => {
    await withTempRepo(async (repoRoot) => {
      const diff = await executeRepoOperation({
        operationId: "repo.diff.read",
        input: { repoId: repoRoot, baseRef: "HEAD~1", headRef: "HEAD" }
      });

      expect(diff.data.baseRef).toBe("HEAD~1");
      expect(diff.data.headRef).toBe("HEAD");
      expect(diff.data.diff).toContain("diff --git");

      const commit = await executeRepoOperation({
        operationId: "repo.commit.read",
        input: { repoId: repoRoot, commitRef: "HEAD" }
      });

      expect(commit.data).toMatchObject({
        commitRef: "HEAD",
        hash: expect.any(String),
        shortHash: expect.any(String),
        authorEmail: "unit-test@example.test",
        subject: "update notes"
      });
    });
  });

  it("enforces path safety and supports create/update/move/delete in one commit", async () => {
    await withTempRepo(async (repoRoot) => {
      const created = await executeRepoOperation({
        operationId: "repo.file.create",
        input: {
          repoId: repoRoot,
          path: "artifacts/new.txt",
          content: "hello\n",
          contentBase64: Buffer.from("should-ignore").toString("base64")
        }
      });
      expect(created.data).toMatchObject({ action: "create", path: "artifacts/new.txt", bytes: 13 });

      const updated = await executeRepoOperation({
        operationId: "repo.file.update",
        input: {
          repoId: repoRoot,
          path: "artifacts/new.txt",
          content: "hello-updated\n"
        }
      });
      expect(updated.data).toMatchObject({ action: "update", path: "artifacts/new.txt" });

      const moved = await executeRepoOperation({
        operationId: "repo.file.move",
        input: {
          repoId: repoRoot,
          fromPath: "artifacts/new.txt",
          toPath: "artifacts/renamed.txt"
        }
      });
      expect(moved.data).toMatchObject({ action: "move", fromPath: "artifacts/new.txt", toPath: "artifacts/renamed.txt" });

      const deleted = await executeRepoOperation({
        operationId: "repo.file.delete",
        input: {
          repoId: repoRoot,
          path: "artifacts/renamed.txt"
        }
      });
      expect(deleted.data).toMatchObject({ action: "delete", path: "artifacts/renamed.txt" });

      const escaped = await executeRepoOperation({
        operationId: "repo.file.read",
        input: { repoId: repoRoot, path: "../outside" }
      });
      expect(escaped).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "repo_operation_failed", message: expect.stringContaining("Path escapes repository root") }
      });
    }, { secondCommit: false });
  });

  it("applies empty changes as no commit, and applies object-form updates through commit.create", async () => {
    await withTempRepo(async (repoRoot, second) => {
      const noChanges = await executeRepoOperation({
        operationId: "repo.commit.create",
        input: { repoId: repoRoot, message: "empty commit" }
      });

      expect(noChanges).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "no_changes" }
      });

      const withObjectChanges = await executeRepoOperation({
        operationId: "repo.commit.create",
        input: {
          repoId: repoRoot,
          message: "second commit via object map",
          changes: {
            "notes.txt": "object path update\n"
          },
          allowEmpty: true
        }
      });

      expect(withObjectChanges.data).toMatchObject({
        branch: "main",
        appliedChanges: [
          {
            action: "update",
            path: "notes.txt"
          }
        ]
      });
    }, { secondCommit: true });
  });

  it("creates then checks out a branch", async () => {
    await withTempRepo(async (repoRoot) => {
      const created = await executeRepoOperation({
        operationId: "repo.branch.create",
        input: { repoId: repoRoot, branchName: "feature/coverage", baseRef: "main" }
      });

      expect(created.data).toMatchObject({
        branchName: "feature/coverage",
        baseRef: "main"
      });

      const checked = await executeRepoOperation({
        operationId: "repo.branch.checkout",
        input: { repoId: repoRoot, branchName: "feature/coverage" }
      });

      expect(checked.data).toMatchObject({
        branchName: "feature/coverage",
        head: expect.any(String)
      });
    });
  });

  it("enforces confirmation and scope requirements for pushes", async () => {
    await withTempRepo(async (repoRoot) => {
      const forbidden = await executeRepoOperation({
        operationId: "repo.push",
        input: {
          repoId: repoRoot,
          remote: "origin",
          sourceRef: "main",
          targetRef: "main",
          force: true
        },
        authSession: { user: { scopes: ["repo:write"] } }
      });
      expect(forbidden).toMatchObject({
        ok: false,
        status: 403,
        error: { code: "repo_scope_required" }
      });

      const confirmation = await executeRepoOperation({
        operationId: "repo.push",
        input: {
          repoId: repoRoot,
          remote: "origin",
          sourceRef: "main",
          targetRef: "main",
          force: true
        },
        authSession: { scopes: ["repo:maintain"] }
      });
      expect(confirmation).toMatchObject({
        ok: false,
        status: 409,
        error: { code: "confirmation_required" }
      });

      const draft = await executeRepoOperation({
        operationId: "repo.push",
        input: {
          repoId: repoRoot,
          remote: "origin",
          sourceRef: "main",
          targetRef: "main",
          force: true,
          confirm: true,
          dryRun: true
        },
        authSession: { scopes: ["repo:maintain"] }
      });

      expect(draft).toMatchObject({
        ok: true,
        data: {
          dryRun: true,
          command: "git",
          args: ["push", "--force-with-lease", "origin", "main:main"],
          cwd: expect.any(String)
        }
      });
    });
  });

  it("covers proposal creation for gerrit/github/gitlab and unsupported providers", async () => {
    await withTempRepo(async (repoRoot) => {
      const gerrit = await executeRepoOperation({
        operationId: "repo.proposal.create",
        input: {
          repoId: repoRoot,
          sourceRef: "main",
          targetRef: "release",
          title: "coverage path",
          hashtags: ["backend", "ops"],
          body: "hello",
          dryRun: true
        }
      });
      expect(gerrit.data).toMatchObject({ dryRun: true, provider: "gerrit" });

      const github = await executeRepoOperation({
        operationId: "repo.proposal.create",
        input: {
          repoId: repoRoot,
          sourceRef: "main",
          targetRef: "release",
          title: "coverage path",
          provider: "github",
          dryRun: true
        }
      });
      expect(github.data).toMatchObject({ dryRun: true, provider: "github", command: "gh" });

      const gitlab = await executeRepoOperation({
        operationId: "repo.proposal.create",
        input: {
          repoId: repoRoot,
          sourceRef: "main",
          targetRef: "release",
          title: "coverage path",
          provider: "gitlab",
          dryRun: true
        }
      });
      expect(gitlab.data).toMatchObject({ dryRun: true, provider: "gitlab", command: "glab" });

      const unsupported = await executeRepoOperation({
        operationId: "repo.proposal.create",
        input: {
          repoId: repoRoot,
          sourceRef: "main",
          targetRef: "release",
          title: "coverage path",
          provider: "bitbucket",
          dryRun: true
        }
      });

      expect(unsupported).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "unsupported_provider" }
      });
    }, { secondCommit: false });
  });

  it("reviews change comments with gerrit and github review dry-runs", async () => {
    await withTempRepo(async (repoRoot, ) => {
      const comment = await executeRepoOperation({
        operationId: "repo.review.comment",
        input: {
          repoId: repoRoot,
          reviewTarget: "I-123",
          body: "Please check",
          reviewSystem: "gerrit"
        }
      });
      expect(comment).toMatchObject({
        ok: true,
        data: { provider: "gerrit", result: { mode: "write", action: "revisions.review.set", input: expect.objectContaining({ changeId: "I-123" }) } }
      });

      const github = await executeRepoOperation({
        operationId: "repo.review.approve",
        input: {
          repoId: repoRoot,
          reviewTarget: "111",
          body: "Looks good",
          provider: "github",
          dryRun: true
        }
      });
      expect(github.data).toMatchObject({
        dryRun: true,
        provider: "github",
        command: "gh",
        args: ["pr", "review", "111", "--approve", "--body", "Looks good"]
      });

      const requestChanges = await executeRepoOperation({
        operationId: "repo.review.requestChanges",
        input: {
          repoId: repoRoot,
          reviewTarget: "111",
          provider: "github",
          body: "needs fix",
          dryRun: true
        }
      });
      expect(requestChanges.data.args).toContain("--request-changes");
    });
  });

  it("handles merge/revert/rebase/submit/abandon/proposal-close branches", async () => {
    await withTempRepo(async (repoRoot) => {
      const mergeNeedConfirm = await executeRepoOperation({
        operationId: "repo.merge",
        input: { repoId: repoRoot, targetRef: "main" }
      });
      expect(mergeNeedConfirm).toMatchObject({ ok: false, status: 409, error: { code: "confirmation_required" } });

      const mergeLocal = await executeRepoOperation({
        operationId: "repo.merge",
        input: {
          repoId: repoRoot,
          reviewTarget: "main",
          strategy: "squash",
          confirm: true,
          dryRun: true
        }
      });
      expect(mergeLocal.data.args).toContain("--squash");

      const submitNoConfirm = await executeRepoOperation({
        operationId: "repo.submit",
        input: { repoId: repoRoot, changeId: "I-111" }
      });
      expect(submitNoConfirm).toMatchObject({ ok: false, status: 409, error: { code: "confirmation_required" } });

      const submit = await executeRepoOperation({
        operationId: "repo.submit",
        input: { repoId: repoRoot, changeId: "I-111", confirm: true, dryRun: true }
      });
      expect(submit.data).toMatchObject({ dryRun: true, provider: "gerrit", action: "changes.submit", changeId: "I-111" });

      const rebaseGerrit = await executeRepoOperation({
        operationId: "repo.rebase",
        input: { repoId: repoRoot, changeId: "I-222", baseRef: "main", targetRef: "main", confirm: true, dryRun: true }
      });
      expect(rebaseGerrit.data).toMatchObject({
        dryRun: true,
        provider: "gerrit",
        action: "changes.rebase",
        changeId: "I-222"
      });

      const revertLocal = await executeRepoOperation({
        operationId: "repo.revert",
        input: { repoId: repoRoot, targetRef: "HEAD~1", confirm: true, dryRun: true }
      });
      expect(revertLocal.data).toMatchObject({ dryRun: true, provider: "local", command: "git", args: ["revert", "--no-edit", "HEAD~1"] });

      const closeProposal = await executeRepoOperation({
        operationId: "repo.proposal.close",
        input: { repoId: repoRoot, reviewTarget: "I-333", confirm: true, dryRun: true }
      });
      expect(closeProposal.data).toMatchObject({ dryRun: true, provider: "gerrit", action: "changes.abandon" });

      const abandon = await executeRepoOperation({
        operationId: "repo.change.abandon",
        input: { repoId: repoRoot, changeId: "I-444", confirm: true, dryRun: true }
      });
      expect(abandon.data).toMatchObject({ dryRun: true, provider: "gerrit", action: "changes.abandon" });
    });
  });

  it("covers github settings helpers with confirmation, slug resolution and dry-run mode", async () => {
    await withTempRepo(async (repoRoot, ) => {
      const noConfirm = await executeRepoOperation({
        operationId: "repo.protection.set",
        input: { repoId: repoRoot, branchPattern: "main", rules: {} }
      });
      expect(noConfirm).toMatchObject({ ok: false, status: 409, error: { code: "confirmation_required" } });

      const missingSlug = await executeRepoOperation({
        operationId: "repo.protection.set",
        input: {
          repoId: repoRoot,
          branchPattern: "main",
          rules: {},
          confirm: true,
          dryRun: true
        }
      });
      expect(missingSlug).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "missing_repository_slug" }
      });

      const unsupportedProtection = await executeRepoOperation({
        operationId: "repo.protection.set",
        input: {
          repoId: repoRoot,
          provider: "bitbucket",
          branchPattern: "main",
          rules: {},
          confirm: true
        }
      });
      expect(unsupportedProtection).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "unsupported_provider" }
      });

      const missingWebhookSlug = await executeRepoOperation({
        operationId: "repo.webhook.set",
        input: {
          repoId: repoRoot,
          confirm: true,
          payload: { url: "https://example.com/webhook" }
        }
      });
      expect(missingWebhookSlug).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "missing_repository_slug" }
      });

      const webhookUnsupported = await executeRepoOperation({
        operationId: "repo.webhook.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          provider: "gerrit",
          confirm: true,
          payload: { url: "https://example.com/webhook" },
          dryRun: true
        }
      });
      expect(webhookUnsupported).toMatchObject({ ok: false, status: 400, error: { code: "unsupported_provider" } });

      const missingMemberSlug = await executeRepoOperation({
        operationId: "repo.member.set",
        input: {
          repoId: repoRoot,
          confirm: true,
          subjectId: "dev-1",
          role: "maintain"
        }
      });
      expect(missingMemberSlug).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "missing_repository_slug" }
      });

      const unsupportedMember = await executeRepoOperation({
        operationId: "repo.member.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          subjectId: "dev-1",
          role: "maintain",
          provider: "gerrit",
          confirm: true
        }
      });
      expect(unsupportedMember).toMatchObject({ ok: false, status: 400, error: { code: "unsupported_provider" } });

      runGit(repoRoot, ["remote", "add", "origin", "https://github.com/unit/test.git"]);

      const setProtection = await executeRepoOperation({
        operationId: "repo.protection.set",
        input: {
          repoId: repoRoot,
          branchPattern: "main",
          rules: { required_status_checks: { strict: true } },
          confirm: true,
          dryRun: true
        }
      });
      expect(setProtection.data).toMatchObject({
        dryRun: true,
        provider: "github",
        command: "gh",
        args: ["api", "-X", "PUT", "repos/unit/test/branches/main/protection", "--input", "-"]
      });

      const setWebhook = await executeRepoOperation({
        operationId: "repo.webhook.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          confirm: true,
          payload: { url: "https://example.com/webhook" },
          webhookId: "42",
          dryRun: true
        }
      });
      expect(setWebhook.data.args).toContain("repos/unit/test/hooks/42");

      const setMember = await executeRepoOperation({
        operationId: "repo.member.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          subjectId: "dev-1",
          role: "maintain",
          confirm: true,
          dryRun: true
        }
      });
      expect(setMember.data).toMatchObject({
        dryRun: true,
        provider: "github",
        command: "gh",
        args: ["api", "-X", "PUT", "repos/unit/test/collaborators/dev-1", "-f", "permission=maintain"]
      });
    }, { secondCommit: false });
  }, 20000);

  it("supports merge to GitHub dry-run and create-file overwrite behavior", async () => {
    await withTempRepo(async (repoRoot) => {
      const githubMerge = await executeRepoOperation({
        operationId: "repo.merge",
        input: {
          repoId: repoRoot,
          reviewTarget: "99",
          provider: "github",
          strategy: "ff-only",
          confirm: true,
          dryRun: true
        }
      });
      expect(githubMerge.data).toMatchObject({
        dryRun: true,
        provider: "github",
        command: "gh",
        args: ["pr", "merge", "99", "--ff-only"]
      });

      const createExisting = await executeRepoOperation({
        operationId: "repo.file.create",
        input: {
          repoId: repoRoot,
          path: "notes.txt",
          content: "bad"
        }
      });
      expect(createExisting).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "repo_operation_failed", message: expect.stringContaining("EEXIST: file already exists") }
      });
    }, { secondCommit: false });
  });

  it("covers additional dry-run and validation branches for write operations", async () => {
    await withTempRepo(async (repoRoot) => {
      const unsupportedChange = await executeRepoOperation({
        operationId: "repo.commit.create",
        input: {
          repoId: repoRoot,
          message: "bad action",
          changes: [
            {
              action: "chmod",
              path: "notes.txt",
              content: "ignored"
            }
          ]
        }
      });
      expect(unsupportedChange).toMatchObject({
        ok: false,
        status: 400,
        error: {
          code: "repo_operation_failed",
          message: expect.stringContaining("Unsupported file change action: chmod")
        }
      });

      const updateMissing = await executeRepoOperation({
        operationId: "repo.file.update",
        input: {
          repoId: repoRoot,
          path: "missing.txt",
          content: "missing"
        }
      });
      expect(updateMissing).toMatchObject({
        ok: false,
        status: 400,
        error: {
          code: "repo_operation_failed",
          message: expect.stringContaining("ENOENT")
        }
      });

      const reviewUnsupported = await executeRepoOperation({
        operationId: "repo.review.comment",
        input: {
          repoId: repoRoot,
          reviewTarget: "42",
          provider: "bitbucket",
          body: "unsupported"
        }
      });
      expect(reviewUnsupported).toMatchObject({
        ok: false,
        status: 400,
        error: { code: "unsupported_provider" }
      });

      const localRebase = await executeRepoOperation({
        operationId: "repo.rebase",
        input: {
          repoId: repoRoot,
          targetRef: "main",
          baseRef: "HEAD",
          provider: "local",
          confirm: true,
          dryRun: true
        }
      });
      expect(localRebase.data).toMatchObject({
        dryRun: true,
        provider: "local",
        command: "git",
        args: ["rebase", "HEAD"]
      });

      const gerritRevert = await executeRepoOperation({
        operationId: "repo.revert",
        input: {
          repoId: repoRoot,
          changeId: "I-555",
          reason: "rollback",
          confirm: true,
          dryRun: true
        }
      });
      expect(gerritRevert.data).toMatchObject({
        dryRun: true,
        provider: "gerrit",
        action: "changes.revert",
        changeId: "I-555"
      });

      const githubClose = await executeRepoOperation({
        operationId: "repo.proposal.close",
        input: {
          repoId: repoRoot,
          reviewTarget: "77",
          provider: "github",
          reason: "stale",
          confirm: true,
          dryRun: true
        }
      });
      expect(githubClose.data).toMatchObject({
        dryRun: true,
        provider: "github",
        command: "gh",
        args: ["pr", "close", "77", "--comment", "stale"]
      });
    }, { secondCommit: false });
  });

  it("uses fake GitHub CLI output for PR and CI status targets", async () => {
    await withTempRepo(async (repoRoot) => {
      await installFakeCommand(repoRoot, "gh", `
case "$*" in
  *"pr view"*) printf '%s\\n' '{"number":42,"title":"Unit PR","state":"OPEN","url":"https://github.com/unit/test/pull/42","headRefName":"feature","baseRefName":"main","mergeStateStatus":"CLEAN","statusCheckRollup":[]}' ;;
  *"run list"*) printf '%s\\n' '[{"databaseId":7,"name":"ci","status":"completed","conclusion":"success","headBranch":"main","headSha":"abc123","url":"https://github.com/unit/test/actions/runs/7"}]' ;;
  *) printf '%s\\n' ok ;;
esac
`);

      const pr = await executeRepoOperation({
        operationId: "repo.status",
        input: { repoId: repoRoot, targetType: "pr", targetId: "42" }
      });
      expect(pr.data).toMatchObject({
        targetType: "pr",
        provider: "github",
        data: {
          number: 42,
          title: "Unit PR",
          mergeStateStatus: "CLEAN"
        }
      });

      const ci = await executeRepoOperation({
        operationId: "repo.status",
        input: { repoId: repoRoot, targetType: "ci", limit: 1 }
      });
      expect(ci.data).toMatchObject({
        targetType: "ci",
        provider: "github",
        data: [
          {
            databaseId: 7,
            name: "ci",
            conclusion: "success"
          }
        ]
      });
    }, { secondCommit: false });
  });

  it("executes non-dry-run review, merge, proposal close, and settings GitHub paths with a fake CLI", async () => {
    await withTempRepo(async (repoRoot) => {
      await installFakeCommand(repoRoot, "gh", `
printf '%s\\n' "gh ok $*"
`);

      const review = await executeRepoOperation({
        operationId: "repo.review.comment",
        input: {
          repoId: repoRoot,
          reviewTarget: "42",
          provider: "github",
          body: "ready"
        }
      });
      expect(review.data).toMatchObject({ provider: "github", stdout: expect.stringContaining("pr review 42 --comment") });

      const merge = await executeRepoOperation({
        operationId: "repo.merge",
        input: {
          repoId: repoRoot,
          reviewTarget: "42",
          provider: "github",
          strategy: "squash",
          confirm: true
        }
      });
      expect(merge.data).toMatchObject({ provider: "github", stdout: expect.stringContaining("pr merge 42 --squash") });

      const close = await executeRepoOperation({
        operationId: "repo.proposal.close",
        input: {
          repoId: repoRoot,
          reviewTarget: "42",
          provider: "github",
          reason: "stale",
          confirm: true
        }
      });
      expect(close.data).toMatchObject({ provider: "github", stdout: expect.stringContaining("pr close 42 --comment stale") });

      const protection = await executeRepoOperation({
        operationId: "repo.protection.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          branchPattern: "main",
          rules: { enforce_admins: null },
          confirm: true
        }
      });
      expect(protection.data).toMatchObject({
        provider: "github",
        stdout: expect.stringContaining("api -X PUT repos/unit/test/branches/main/protection --input -")
      });

      const webhook = await executeRepoOperation({
        operationId: "repo.webhook.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          payload: { url: "https://example.com/hook" },
          confirm: true
        }
      });
      expect(webhook.data.stdout).toContain("api -X POST repos/unit/test/hooks --input -");

      const member = await executeRepoOperation({
        operationId: "repo.member.set",
        input: {
          repoId: repoRoot,
          repositorySlug: "unit/test",
          subjectId: "dev-1",
          role: "maintain",
          confirm: true
        }
      });
      expect(member.data.stdout).toContain("api -X PUT repos/unit/test/collaborators/dev-1 -f permission=maintain");
    }, { secondCommit: false });
  });

  it("executes Gerrit label and maintenance paths through the operation adapter", async () => {
    await withTempRepo(async (repoRoot) => {
      const approveObjectLabel = await executeRepoOperation({
        operationId: "repo.review.approve",
        input: {
          repoId: repoRoot,
          reviewTarget: "I-approve",
          label: { Verified: 1 },
          body: "verified"
        }
      });
      expect(approveObjectLabel.data.result.input.review.labels).toEqual({ Verified: 1 });

      const approveDefaultLabel = await executeRepoOperation({
        operationId: "repo.review.approve",
        input: {
          repoId: repoRoot,
          reviewTarget: "I-approve-default",
          value: 2
        }
      });
      expect(approveDefaultLabel.data.result.input.review.labels).toEqual({ "Code-Review": 2 });

      const requestStringLabel = await executeRepoOperation({
        operationId: "repo.review.requestChanges",
        input: {
          repoId: repoRoot,
          reviewTarget: "I-request",
          label: "Code-Review=-2"
        }
      });
      expect(requestStringLabel.data.result.input.review.labels).toEqual({ "Code-Review": -2 });

      const requestDefaultLabel = await executeRepoOperation({
        operationId: "repo.review.requestChanges",
        input: {
          repoId: repoRoot,
          reviewTarget: "I-request-default"
        }
      });
      expect(requestDefaultLabel.data.result.input.review.labels).toEqual({ "Code-Review": -1 });

      const submit = await executeRepoOperation({
        operationId: "repo.submit",
        input: { repoId: repoRoot, changeId: "I-submit", confirm: true }
      });
      expect(submit.data).toMatchObject({ mode: "maintain", action: "changes.submit" });

      const rebase = await executeRepoOperation({
        operationId: "repo.rebase",
        input: { repoId: repoRoot, changeId: "I-rebase", baseRef: "main", confirm: true }
      });
      expect(rebase.data).toMatchObject({ mode: "maintain", action: "changes.rebase" });

      const revert = await executeRepoOperation({
        operationId: "repo.revert",
        input: { repoId: repoRoot, changeId: "I-revert", reason: "rollback", confirm: true }
      });
      expect(revert.data).toMatchObject({ mode: "maintain", action: "changes.revert" });

      const close = await executeRepoOperation({
        operationId: "repo.proposal.close",
        input: { repoId: repoRoot, reviewTarget: "I-close", reason: "stale", confirm: true }
      });
      expect(close.data).toMatchObject({ mode: "maintain", action: "changes.abandon" });

      const abandon = await executeRepoOperation({
        operationId: "repo.change.abandon",
        input: { repoId: repoRoot, changeId: "I-abandon", reason: "stale", confirm: true }
      });
      expect(abandon.data).toMatchObject({ mode: "maintain", action: "changes.abandon" });
    }, { secondCommit: false });
  });

  it("executes local push, merge, rebase, and revert paths in disposable repositories", async () => {
    await withTempRepo(async (repoRoot) => {
      const remoteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-repo-operations-remote-"));
      try {
        runGit(remoteRoot, ["init", "--bare"]);
        runGit(repoRoot, ["remote", "add", "unit", remoteRoot]);

        const push = await executeRepoOperation({
          operationId: "repo.push",
          input: {
            repoId: repoRoot,
            remote: "unit",
            sourceRef: "main",
            targetRef: "main"
          }
        });
        expect(push.data).toMatchObject({ remote: "unit", sourceRef: "main", targetRef: "main", forced: false });
      } finally {
        await fs.rm(remoteRoot, { recursive: true, force: true });
      }

      runGit(repoRoot, ["checkout", "-b", "feature/merge-source", "main"]);
      await writeTextFile(path.join(repoRoot, "merge-source.txt"), "merge me\n");
      runGit(repoRoot, ["add", "merge-source.txt"]);
      runGit(repoRoot, ["commit", "-m", "add merge source"]);

      runGit(repoRoot, ["checkout", "-b", "feature/merge-target", "main"]);
      const ffOnlyPreview = await executeRepoOperation({
        operationId: "repo.merge",
        input: { repoId: repoRoot, reviewTarget: "feature/merge-source", provider: "local", strategy: "ff-only", confirm: true, dryRun: true }
      });
      expect(ffOnlyPreview.data.args).toContain("--ff-only");

      const noFfPreview = await executeRepoOperation({
        operationId: "repo.merge",
        input: { repoId: repoRoot, reviewTarget: "feature/merge-source", provider: "local", confirm: true, dryRun: true }
      });
      expect(noFfPreview.data.args).toContain("--no-ff");

      const merge = await executeRepoOperation({
        operationId: "repo.merge",
        input: { repoId: repoRoot, reviewTarget: "feature/merge-source", provider: "local", strategy: "ff-only", confirm: true }
      });
      expect(merge.data).toMatchObject({ provider: "local", target: "feature/merge-source" });

      runGit(repoRoot, ["checkout", "main"]);
      runGit(repoRoot, ["checkout", "-b", "feature/rebase"]);
      await writeTextFile(path.join(repoRoot, "rebase.txt"), "before rebase\n");
      runGit(repoRoot, ["add", "rebase.txt"]);
      runGit(repoRoot, ["commit", "-m", "add rebase file"]);
      runGit(repoRoot, ["checkout", "main"]);
      await writeTextFile(path.join(repoRoot, "main-only.txt"), "main branch\n");
      runGit(repoRoot, ["add", "main-only.txt"]);
      runGit(repoRoot, ["commit", "-m", "advance main"]);

      const rebase = await executeRepoOperation({
        operationId: "repo.rebase",
        input: {
          repoId: repoRoot,
          targetRef: "feature/rebase",
          baseRef: "main",
          provider: "local",
          confirm: true
        }
      });
      expect(rebase.data).toMatchObject({ provider: "local" });

      const headBeforeRevert = runGit(repoRoot, ["rev-parse", "HEAD"]).trim();
      const revert = await executeRepoOperation({
        operationId: "repo.revert",
        input: {
          repoId: repoRoot,
          targetRef: headBeforeRevert,
          provider: "local",
          confirm: true
        }
      });
      expect(revert.data).toMatchObject({ provider: "local" });
    });
  }, 30000);
});
