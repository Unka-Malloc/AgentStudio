import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { executeGerritCommonOperation } from "../../code-review/gerrit/index.mjs";
import { pathIsWithinRoot } from "../../../../common/security/local-path-boundary.mjs";

export const REPO_OPERATION_IDS = Object.freeze([
  "repo.status",
  "repo.file.read",
  "repo.tree.list",
  "repo.diff.read",
  "repo.commit.read",
  "repo.file.create",
  "repo.file.update",
  "repo.file.delete",
  "repo.file.move",
  "repo.branch.create",
  "repo.branch.checkout",
  "repo.commit.create",
  "repo.push",
  "repo.proposal.create",
  "repo.review.comment",
  "repo.review.requestChanges",
  "repo.review.approve",
  "repo.merge",
  "repo.submit",
  "repo.rebase",
  "repo.revert",
  "repo.proposal.close",
  "repo.change.abandon",
  "repo.protection.set",
  "repo.webhook.set",
  "repo.member.set"
]);

const WRITE_CHANGE_ACTIONS = new Set(["create", "update", "delete", "move"]);
const GERRIT_PROVIDER_NAMES = new Set(["gerrit", "gerrit-change"]);
const GITHUB_PROVIDER_NAMES = new Set(["github", "gh", "github-pr"]);
const GITLAB_PROVIDER_NAMES = new Set(["gitlab", "glab", "gitlab-mr"]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value || "").trim();
}

function requireString(input, key) {
  const value = text(input[key]);
  if (!value) {
    throw new Error(`Repo operation requires input.${key}.`);
  }
  return value;
}

function actorScopes(authSession = null) {
  return [
    ...(authSession?.user?.scopes || []),
    ...(authSession?.scopes || [])
  ].map((scope) => String(scope || "").trim()).filter(Boolean);
}

function hasRepoScope(scopes = [], scope) {
  return scopes.includes(scope) || scopes.includes("repo:admin");
}

function requireDynamicScope({ scopes, scope, reason }) {
  if (!hasRepoScope(scopes, scope)) {
    return {
      ok: false,
      status: 403,
      error: {
        code: "repo_scope_required",
        message: `${reason} requires ${scope}.`,
        details: { requiredScope: scope }
      }
    };
  }
  return null;
}

function requireConfirmation(input, reason) {
  if (input.confirm === true || input.confirmed === true) {
    return null;
  }
  return {
    ok: false,
    status: 409,
    error: {
      code: "confirmation_required",
      message: `${reason} requires confirm=true.`
    }
  };
}

function ok(operationId, repo, data) {
  return {
    ok: true,
    status: 200,
    operationId,
    repo,
    data
  };
}

function fail(status, code, message, details = {}) {
  return {
    ok: false,
    status,
    error: {
      code,
      message,
      details
    }
  };
}

async function runProcess(command, args = [], { cwd = process.cwd(), input = undefined, allowFailure = false } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT || "0"
      }
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        command,
        args
      };
      if (code !== 0 && !allowFailure) {
        const error = new Error(result.stderr || result.stdout || `${command} failed with exit code ${code}.`);
        error.result = result;
        reject(error);
        return;
      }
      resolve(result);
    });
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

async function runGit(repoRoot, args, options = {}) {
  return runProcess("git", args, { cwd: repoRoot, ...options });
}

async function commandExists(command) {
  const result = await runProcess("/bin/sh", ["-lc", `command -v ${JSON.stringify(command)}`], {
    cwd: process.cwd(),
    allowFailure: true
  }).catch(() => ({ code: 1 }));
  return result.code === 0;
}

function normalizeRepoId(repoId) {
  const raw = text(repoId);
  if (!raw || raw === "." || raw === "current" || raw === "pact") {
    return process.cwd();
  }
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function taggedError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function configuredRepoOperationRoots() {
  return text(process.env.PACT_REPO_OPERATION_ROOTS)
    .split(path.delimiter)
    .map((item) => text(item))
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

async function gitToplevel(candidatePath) {
  const result = await runProcess("git", ["-C", candidatePath, "rev-parse", "--show-toplevel"], {
    allowFailure: true
  });
  return result.code === 0 ? path.resolve(result.stdout.trim()) : "";
}

async function allowedRepoOperationRoots() {
  const roots = [];
  const currentRoot = await gitToplevel(process.cwd()).catch(() => "");
  if (currentRoot) {
    roots.push(currentRoot);
  }
  for (const configuredRoot of configuredRepoOperationRoots()) {
    const repoRoot = await gitToplevel(configuredRoot).catch(() => "");
    roots.push(repoRoot || configuredRoot);
  }
  return [...new Set(roots.map((item) => path.resolve(item)))];
}

async function realpathOrResolved(candidatePath) {
  try {
    return await fs.realpath(candidatePath);
  } catch {
    return path.resolve(candidatePath);
  }
}

async function assertRepoRootAllowed(repoRoot) {
  const repoRealPath = await realpathOrResolved(repoRoot);
  const allowedRoots = await allowedRepoOperationRoots();
  for (const allowedRoot of allowedRoots) {
    const allowedRealPath = await realpathOrResolved(allowedRoot);
    if (pathIsWithinRoot(repoRealPath, allowedRealPath)) {
      return;
    }
  }
  throw taggedError(
    "REPO_ROOT_DENIED",
    "repoId is outside allowed repository roots.",
    403
  );
}

async function resolveRepo(input = {}) {
  const candidate = normalizeRepoId(input.repoId || input.repository || input.worktreePath);
  const root = await runProcess("git", ["-C", candidate, "rev-parse", "--show-toplevel"], {
    allowFailure: true
  });
  if (root.code !== 0) {
    throw new Error(`repoId does not resolve to a git worktree: ${candidate}`);
  }
  const repoRoot = root.stdout.trim();
  await assertRepoRootAllowed(repoRoot);
  const head = await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  const branch = await runGit(repoRoot, ["branch", "--show-current"], { allowFailure: true });
  return {
    repoId: text(input.repoId) || "current",
    root: repoRoot,
    head: head.code === 0 ? head.stdout.trim() : "",
    branch: branch.code === 0 ? branch.stdout.trim() : ""
  };
}

function publicRepo(repo) {
  return {
    repoId: repo.repoId,
    root: repo.root,
    branch: repo.branch,
    head: repo.head
  };
}

function normalizeRepoPath(value) {
  const raw = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(raw || ".");
  return normalized === "." ? "" : normalized;
}

function resolveRepoPath(repoRoot, value) {
  const relativePath = normalizeRepoPath(value);
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relativeFromRoot = path.relative(repoRoot, absolutePath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Path escapes repository root: ${value}`);
  }
  return { relativePath, absolutePath };
}

async function assertExistingRepoPath(repoRoot, target, {
  label = "Repository path",
  expectedType = ""
} = {}) {
  const stat = await fs.lstat(target.absolutePath);
  if (stat.isSymbolicLink()) {
    throw taggedError("REPO_PATH_DENIED", `${label} cannot be a symbolic link.`);
  }
  if (expectedType === "file" && !stat.isFile()) {
    throw taggedError("REPO_PATH_DENIED", `${label} must be a file.`);
  }
  if (expectedType === "directory" && !stat.isDirectory()) {
    throw taggedError("REPO_PATH_DENIED", `${label} must be a directory.`);
  }
  const rootRealPath = await fs.realpath(repoRoot);
  const realPath = await fs.realpath(target.absolutePath);
  if (!pathIsWithinRoot(realPath, rootRealPath)) {
    throw taggedError("REPO_PATH_DENIED", `${label} real path escapes repository root.`);
  }
  return stat;
}

async function assertWritableRepoPath(repoRoot, target, { label = "Repository write path" } = {}) {
  const root = path.resolve(repoRoot);
  const rootRealPath = await fs.realpath(root);
  const relative = path.relative(root, target.absolutePath);
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw taggedError("REPO_PATH_DENIED", `${label} cannot pass through a symbolic link directory.`);
      }
      if (!stat.isDirectory()) {
        throw taggedError("REPO_PATH_DENIED", `${label} parent path must be a directory.`);
      }
      const realPath = await fs.realpath(current);
      if (!pathIsWithinRoot(realPath, rootRealPath)) {
        throw taggedError("REPO_PATH_DENIED", `${label} parent real path escapes repository root.`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  let existingParent = path.dirname(target.absolutePath);
  while (true) {
    try {
      const stat = await fs.lstat(existingParent);
      if (stat.isSymbolicLink()) {
        throw taggedError("REPO_PATH_DENIED", `${label} parent cannot be a symbolic link.`);
      }
      if (!stat.isDirectory()) {
        throw taggedError("REPO_PATH_DENIED", `${label} parent path must be a directory.`);
      }
      const realPath = await fs.realpath(existingParent);
      if (!pathIsWithinRoot(realPath, rootRealPath)) {
        throw taggedError("REPO_PATH_DENIED", `${label} parent real path escapes repository root.`);
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      const nextParent = path.dirname(existingParent);
      if (nextParent === existingParent || !pathIsWithinRoot(nextParent, root)) {
        throw taggedError("REPO_PATH_DENIED", `${label} parent path escapes repository root.`);
      }
      existingParent = nextParent;
    }
  }
  try {
    await assertExistingRepoPath(repoRoot, target, { label });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function ensureBranch(repoRoot, branch) {
  const branchName = text(branch);
  if (!branchName) {
    return null;
  }
  await runGit(repoRoot, ["checkout", branchName]);
  return branchName;
}

function contentFromInput(input = {}) {
  if (input.contentBase64) {
    return Buffer.from(String(input.contentBase64), "base64");
  }
  return Buffer.from(String(input.content ?? ""), input.encoding === "base64" ? "base64" : "utf8");
}

async function applyFileChange(repo, change) {
  const payload = asObject(change);
  const action = text(payload.action || payload.type || (payload.fromPath ? "move" : "update"));
  if (!WRITE_CHANGE_ACTIONS.has(action)) {
    throw new Error(`Unsupported file change action: ${action || "(empty)"}`);
  }
  if (action === "move") {
    const from = resolveRepoPath(repo.root, requireString(payload, "fromPath"));
    const to = resolveRepoPath(repo.root, requireString(payload, "toPath"));
    await assertExistingRepoPath(repo.root, from, { label: "Repository move source" });
    await assertWritableRepoPath(repo.root, to, { label: "Repository move target" });
    await fs.mkdir(path.dirname(to.absolutePath), { recursive: true });
    await fs.rename(from.absolutePath, to.absolutePath);
    return { action, fromPath: from.relativePath, toPath: to.relativePath };
  }
  const target = resolveRepoPath(repo.root, requireString(payload, "path"));
  if (action === "delete") {
    await assertExistingRepoPath(repo.root, target, { label: "Repository delete path" });
    await fs.rm(target.absolutePath, { force: false });
    return { action, path: target.relativePath };
  }
  const content = contentFromInput(payload);
  await assertWritableRepoPath(repo.root, target, { label: "Repository write path" });
  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
  if (action === "create") {
    await fs.writeFile(target.absolutePath, content, { flag: "wx" });
  } else {
    await fs.stat(target.absolutePath);
    await fs.writeFile(target.absolutePath, content);
  }
  return { action, path: target.relativePath, bytes: content.length };
}

function normalizeChanges(input = {}) {
  if (Array.isArray(input.changes)) {
    return input.changes;
  }
  if (input.changes && typeof input.changes === "object") {
    return Object.entries(input.changes).map(([filePath, content]) => ({
      action: "update",
      path: filePath,
      content
    }));
  }
  return [];
}

function parseLsTreeLine(line) {
  const tabIndex = line.indexOf("\t");
  const meta = tabIndex >= 0 ? line.slice(0, tabIndex) : line;
  const filePath = tabIndex >= 0 ? line.slice(tabIndex + 1) : "";
  const [mode, type, object, size = ""] = meta.split(/\s+/);
  return { mode, type, object, size: size === "-" ? null : Number(size) || null, path: filePath };
}

async function readRepoStatus(repo, input) {
  const targetType = text(input.targetType || "worktree");
  if (targetType === "worktree") {
    const status = await runGit(repo.root, ["status", "--short", "--branch"]);
    const remotes = await runGit(repo.root, ["remote", "-v"], { allowFailure: true });
    return {
      targetType,
      branch: repo.branch,
      head: repo.head,
      dirty: status.stdout.split("\n").some((line) => line && !line.startsWith("##")),
      status: status.stdout,
      remotes: remotes.stdout
    };
  }
  if (targetType === "branch") {
    const branchName = text(input.targetId || input.ref || repo.branch);
    const commit = await runGit(repo.root, ["rev-parse", "--verify", branchName], { allowFailure: true });
    return {
      targetType,
      targetId: branchName,
      exists: commit.code === 0,
      commit: commit.code === 0 ? commit.stdout.trim() : ""
    };
  }
  if (targetType === "remote") {
    const remote = text(input.targetId || "origin");
    const url = await runGit(repo.root, ["remote", "get-url", remote], { allowFailure: true });
    const refs = await runGit(repo.root, ["ls-remote", remote], { allowFailure: true });
    return {
      targetType,
      targetId: remote,
      exists: url.code === 0,
      url: url.stdout.trim(),
      refs: refs.stdout
    };
  }
  if (targetType === "change") {
    const changeId = requireString(input, "targetId");
    const detail = await executeGerritCommonOperation({
      mode: "read",
      input: { ...input, action: input.detail === false ? "changes.get" : "changes.detail", changeId }
    });
    return { targetType, targetId: changeId, gerrit: detail };
  }
  if (targetType === "pr" && await commandExists("gh")) {
    const pr = await runProcess("gh", ["pr", "view", requireString(input, "targetId"), "--json", "number,title,state,url,headRefName,baseRefName,mergeStateStatus,statusCheckRollup"], {
      cwd: repo.root
    });
    return { targetType, provider: "github", data: JSON.parse(pr.stdout) };
  }
  if (targetType === "ci" && await commandExists("gh")) {
    const runs = await runProcess("gh", ["run", "list", "--limit", String(input.limit || 10), "--json", "databaseId,name,status,conclusion,headBranch,headSha,url"], {
      cwd: repo.root
    });
    return { targetType, provider: "github", data: JSON.parse(runs.stdout) };
  }
  return {
    targetType,
    available: false,
    reason: "No local adapter is available for this status target."
  };
}

async function readFile(repo, input) {
  const target = resolveRepoPath(repo.root, requireString(input, "path"));
  const ref = text(input.ref);
  if (ref) {
    const content = await runGit(repo.root, ["show", `${ref}:${target.relativePath}`]);
    return { path: target.relativePath, ref, content: content.stdout, encoding: "utf8" };
  }
  await assertExistingRepoPath(repo.root, target, { label: "Repository read path", expectedType: "file" });
  const content = await fs.readFile(target.absolutePath, "utf8");
  return { path: target.relativePath, ref: "", content, encoding: "utf8" };
}

async function listTree(repo, input) {
  const target = resolveRepoPath(repo.root, input.path || "");
  const ref = text(input.ref);
  if (ref) {
    const result = await runGit(repo.root, ["ls-tree", "-l", ref, "--", target.relativePath || "."]);
    return {
      path: target.relativePath,
      ref,
      entries: result.stdout.split("\n").filter(Boolean).map(parseLsTreeLine)
    };
  }
  await assertExistingRepoPath(repo.root, target, { label: "Repository tree path", expectedType: "directory" });
  const entries = await fs.readdir(target.absolutePath, { withFileTypes: true });
  return {
    path: target.relativePath,
    ref: "",
    entries: entries.map((entry) => ({
      path: target.relativePath ? `${target.relativePath}/${entry.name}` : entry.name,
      type: entry.isDirectory() ? "tree" : entry.isFile() ? "blob" : "other"
    }))
  };
}

async function readDiff(repo, input) {
  const baseRef = requireString(input, "baseRef");
  const headRef = requireString(input, "headRef");
  const diff = await runGit(repo.root, ["diff", "--no-ext-diff", `${baseRef}..${headRef}`]);
  return { baseRef, headRef, diff: diff.stdout };
}

async function readCommit(repo, input) {
  const commitRef = requireString(input, "commitRef");
  const format = "%H%n%h%n%an%n%ae%n%aI%n%s%n%b";
  const commit = await runGit(repo.root, ["show", "--no-patch", `--format=${format}`, commitRef]);
  const [hash, shortHash, authorName, authorEmail, authoredAt, subject, ...body] = commit.stdout.split("\n");
  const stat = await runGit(repo.root, ["show", "--stat", "--oneline", "--no-renames", commitRef]);
  return {
    commitRef,
    hash,
    shortHash,
    authorName,
    authorEmail,
    authoredAt,
    subject,
    body: body.join("\n").trim(),
    stat: stat.stdout
  };
}

async function writeFileAction(repo, input, action) {
  await ensureBranch(repo.root, input.branch);
  const change =
    action === "move"
      ? { action, fromPath: input.fromPath, toPath: input.toPath }
      : { action, path: input.path, content: input.content, contentBase64: input.contentBase64, encoding: input.encoding };
  return applyFileChange(repo, change);
}

async function createBranch(repo, input) {
  const branchName = requireString(input, "branchName");
  const baseRef = requireString(input, "baseRef");
  await runGit(repo.root, ["branch", branchName, baseRef]);
  return { branchName, baseRef };
}

async function checkoutBranch(repo, input) {
  const branchName = requireString(input, "branchName");
  await runGit(repo.root, ["checkout", branchName]);
  const refreshed = await resolveRepo({ repoId: repo.root });
  return { branchName, head: refreshed.head };
}

async function createCommit(repo, input) {
  await ensureBranch(repo.root, input.branch);
  const appliedChanges = [];
  for (const change of normalizeChanges(input)) {
    appliedChanges.push(await applyFileChange(repo, change));
  }
  await runGit(repo.root, ["add", "-A"]);
  const diffCheck = await runGit(repo.root, ["diff", "--cached", "--quiet"], { allowFailure: true });
  if (diffCheck.code === 0 && input.allowEmpty !== true) {
    return fail(409, "no_changes", "No staged changes are available for commit.");
  }
  const args = ["commit", "-m", requireString(input, "message")];
  if (input.allowEmpty === true) {
    args.splice(1, 0, "--allow-empty");
  }
  await runGit(repo.root, args);
  const head = await runGit(repo.root, ["rev-parse", "HEAD"]);
  return {
    branch: text(input.branch) || repo.branch,
    commit: head.stdout.trim(),
    changeSetId: text(input.changeSetId),
    appliedChanges
  };
}

function targetLooksProtected(input = {}) {
  return input.protected === true || input.targetProtected === true;
}

async function pushRepo(repo, input, scopes) {
  const remote = requireString(input, "remote");
  const sourceRef = requireString(input, "sourceRef");
  const targetRef = requireString(input, "targetRef");
  const force = input.force === true;
  if (force || targetLooksProtected(input)) {
    const denied = requireDynamicScope({
      scopes,
      scope: "repo:maintain",
      reason: force ? "Force push" : "Protected target push"
    });
    if (denied) return denied;
    const confirmation = requireConfirmation(input, force ? "Force push" : "Protected target push");
    if (confirmation) return confirmation;
  }
  const args = ["push"];
  if (force) {
    args.push(input.forceMode === "force" ? "--force" : "--force-with-lease");
  }
  args.push(remote, `${sourceRef}:${targetRef}`);
  if (input.dryRun === true) {
    return { dryRun: true, command: "git", args, cwd: repo.root };
  }
  const result = await runGit(repo.root, args);
  return { remote, sourceRef, targetRef, forced: force, stdout: result.stdout, stderr: result.stderr };
}

function providerName(input = {}, fallback = "") {
  return text(input.provider || input.reviewSystem || fallback).toLowerCase();
}

function stripRefPrefix(value) {
  return String(value || "").replace(/^refs\/heads\//, "").replace(/^refs\/for\//, "");
}

function parseGithubSlug(remoteUrl = "") {
  const value = String(remoteUrl || "").trim();
  const match = value.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : "";
}

async function detectGithubSlug(repo) {
  const remote = await runGit(repo.root, ["remote", "get-url", "origin"], { allowFailure: true });
  return remote.code === 0 ? parseGithubSlug(remote.stdout.trim()) : "";
}

function gitPushOption(name, value) {
  const normalized = text(value);
  return normalized ? `${name}=${encodeURIComponent(normalized)}` : "";
}

function buildGerritPushRef(input = {}) {
  const branch = stripRefPrefix(input.targetRef || input.branch || "main");
  const params = [];
  const topic = gitPushOption("topic", input.topic || input.title);
  if (topic) params.push(topic);
  const hashtags = Array.isArray(input.hashtags) ? input.hashtags : String(input.hashtags || "").split(",");
  for (const hashtag of hashtags.map(text).filter(Boolean)) {
    params.push(gitPushOption("hashtag", hashtag));
  }
  return `refs/for/${branch}${params.length ? `%${params.join(",")}` : ""}`;
}

async function createProposal(repo, input) {
  const provider = providerName(input, "gerrit");
  const sourceRef = requireString(input, "sourceRef");
  const targetRef = requireString(input, "targetRef");
  const title = requireString(input, "title");
  if (GERRIT_PROVIDER_NAMES.has(provider) || provider === "") {
    const remote = text(input.remote || "origin");
    const reviewRef = text(input.reviewRef) || buildGerritPushRef({ ...input, title });
    const args = ["push", remote, `${sourceRef}:${reviewRef}`];
    if (input.dryRun === true) {
      return { dryRun: true, provider: "gerrit", command: "git", args, cwd: repo.root };
    }
    const result = await runGit(repo.root, args);
    return { provider: "gerrit", remote, sourceRef, reviewRef, stdout: result.stdout, stderr: result.stderr };
  }
  if (GITHUB_PROVIDER_NAMES.has(provider)) {
    const args = ["pr", "create", "--base", stripRefPrefix(targetRef), "--head", stripRefPrefix(sourceRef), "--title", title];
    if (input.body) args.push("--body", String(input.body));
    if (input.dryRun === true) return { dryRun: true, provider: "github", command: "gh", args, cwd: repo.root };
    const result = await runProcess("gh", args, { cwd: repo.root });
    return { provider: "github", stdout: result.stdout, stderr: result.stderr };
  }
  if (GITLAB_PROVIDER_NAMES.has(provider)) {
    const args = ["mr", "create", "--source-branch", stripRefPrefix(sourceRef), "--target-branch", stripRefPrefix(targetRef), "--title", title];
    if (input.body) args.push("--description", String(input.body));
    if (input.dryRun === true) return { dryRun: true, provider: "gitlab", command: "glab", args, cwd: repo.root };
    const result = await runProcess("glab", args, { cwd: repo.root });
    return { provider: "gitlab", stdout: result.stdout, stderr: result.stderr };
  }
  return fail(400, "unsupported_provider", `Unsupported proposal provider: ${provider}`);
}

function reviewLabelsFor(kind, input = {}) {
  if (input.labels && typeof input.labels === "object") {
    return input.labels;
  }
  if (input.label && typeof input.label === "object") {
    return input.label;
  }
  if (typeof input.label === "string" && input.label.includes("=")) {
    const [name, rawValue] = input.label.split("=");
    return { [name.trim()]: Number(rawValue) || rawValue.trim() };
  }
  if (kind === "approve") {
    return { [text(input.label) || "Code-Review"]: Number(input.value || 1) };
  }
  if (kind === "requestChanges") {
    return { [text(input.label) || "Code-Review"]: Number(input.value || -1) };
  }
  return undefined;
}

async function reviewRepo(repo, input, kind) {
  const provider = providerName(input, "gerrit");
  const reviewTarget = requireString(input, "reviewTarget");
  if (GERRIT_PROVIDER_NAMES.has(provider) || provider === "") {
    const review = {
      message: String(input.body || ""),
      comments: input.comments,
      labels: reviewLabelsFor(kind, input),
      notify: input.notify,
      tag: input.tag
    };
    if (input.dryRun === true) {
      return { dryRun: true, provider: "gerrit", action: "revisions.review.set", changeId: reviewTarget, review };
    }
    const result = await executeGerritCommonOperation({
      mode: "write",
      input: { ...input, action: "revisions.review.set", changeId: reviewTarget, revision: input.revision || "current", review }
    });
    return { provider: "gerrit", result };
  }
  if (GITHUB_PROVIDER_NAMES.has(provider)) {
    const args = ["pr", "review", reviewTarget];
    if (kind === "approve") args.push("--approve");
    else if (kind === "requestChanges") args.push("--request-changes");
    else args.push("--comment");
    if (input.body) args.push("--body", String(input.body));
    if (input.dryRun === true) return { dryRun: true, provider: "github", command: "gh", args, cwd: repo.root };
    const result = await runProcess("gh", args, { cwd: repo.root });
    return { provider: "github", stdout: result.stdout, stderr: result.stderr };
  }
  return fail(400, "unsupported_provider", `Unsupported review provider: ${provider}`);
}

async function mergeRepo(repo, input) {
  const confirmation = requireConfirmation(input, "Merge");
  if (confirmation) return confirmation;
  const provider = providerName(input, input.reviewTarget ? "github" : "local");
  if (GITHUB_PROVIDER_NAMES.has(provider)) {
    const args = ["pr", "merge", requireString(input, "reviewTarget")];
    if (input.strategy) args.push(`--${String(input.strategy)}`);
    if (input.dryRun === true) return { dryRun: true, provider: "github", command: "gh", args, cwd: repo.root };
    const result = await runProcess("gh", args, { cwd: repo.root });
    return { provider: "github", stdout: result.stdout, stderr: result.stderr };
  }
  const target = requireString(input, "reviewTarget");
  const args = ["merge"];
  if (input.strategy === "squash") args.push("--squash");
  else if (input.strategy === "ff-only") args.push("--ff-only");
  else args.push("--no-ff");
  args.push(target);
  if (input.dryRun === true) return { dryRun: true, provider: "local", command: "git", args, cwd: repo.root };
  const result = await runGit(repo.root, args);
  return { provider: "local", target, stdout: result.stdout, stderr: result.stderr };
}

async function submitRepo(input) {
  const confirmation = requireConfirmation(input, "Gerrit submit");
  if (confirmation) return confirmation;
  const changeId = requireString(input, "changeId");
  if (input.dryRun === true) return { dryRun: true, provider: "gerrit", action: "changes.submit", changeId };
  return executeGerritCommonOperation({
    mode: "maintain",
    input: { ...input, action: "changes.submit", changeId }
  });
}

async function rebaseRepo(repo, input) {
  const confirmation = requireConfirmation(input, "Rebase");
  if (confirmation) return confirmation;
  const provider = providerName(input, input.changeId ? "gerrit" : "local");
  if (GERRIT_PROVIDER_NAMES.has(provider)) {
    const changeId = text(input.changeId || input.targetRef);
    if (input.dryRun === true) return { dryRun: true, provider: "gerrit", action: "changes.rebase", changeId, base: input.baseRef };
    return executeGerritCommonOperation({
      mode: "maintain",
      input: { ...input, action: "changes.rebase", changeId, base: input.baseRef }
    });
  }
  await runGit(repo.root, ["checkout", requireString(input, "targetRef")]);
  const args = ["rebase", requireString(input, "baseRef")];
  if (input.dryRun === true) return { dryRun: true, provider: "local", command: "git", args, cwd: repo.root };
  const result = await runGit(repo.root, args);
  return { provider: "local", stdout: result.stdout, stderr: result.stderr };
}

async function revertRepo(repo, input) {
  const confirmation = requireConfirmation(input, "Revert");
  if (confirmation) return confirmation;
  const provider = providerName(input, input.changeId ? "gerrit" : "local");
  if (GERRIT_PROVIDER_NAMES.has(provider)) {
    const changeId = text(input.changeId || input.targetRef);
    if (input.dryRun === true) return { dryRun: true, provider: "gerrit", action: "changes.revert", changeId };
    return executeGerritCommonOperation({
      mode: "maintain",
      input: { ...input, action: "changes.revert", changeId, message: input.reason || input.message }
    });
  }
  const args = ["revert", "--no-edit", requireString(input, "targetRef")];
  if (input.dryRun === true) return { dryRun: true, provider: "local", command: "git", args, cwd: repo.root };
  const result = await runGit(repo.root, args);
  return { provider: "local", stdout: result.stdout, stderr: result.stderr };
}

async function closeProposal(repo, input) {
  const confirmation = requireConfirmation(input, "Proposal close");
  if (confirmation) return confirmation;
  const provider = providerName(input, "gerrit");
  const reviewTarget = requireString(input, "reviewTarget");
  if (GERRIT_PROVIDER_NAMES.has(provider) || provider === "") {
    if (input.dryRun === true) return { dryRun: true, provider: "gerrit", action: "changes.abandon", changeId: reviewTarget };
    return executeGerritCommonOperation({
      mode: "maintain",
      input: { ...input, action: "changes.abandon", changeId: reviewTarget, message: input.reason || input.message }
    });
  }
  if (GITHUB_PROVIDER_NAMES.has(provider)) {
    const args = ["pr", "close", reviewTarget];
    if (input.reason) args.push("--comment", String(input.reason));
    if (input.dryRun === true) return { dryRun: true, provider: "github", command: "gh", args, cwd: repo.root };
    const result = await runProcess("gh", args, { cwd: repo.root });
    return { provider: "github", stdout: result.stdout, stderr: result.stderr };
  }
  return fail(400, "unsupported_provider", `Unsupported proposal provider: ${provider}`);
}

async function abandonChange(input) {
  const confirmation = requireConfirmation(input, "Gerrit abandon");
  if (confirmation) return confirmation;
  const changeId = requireString(input, "changeId");
  if (input.dryRun === true) return { dryRun: true, provider: "gerrit", action: "changes.abandon", changeId };
  return executeGerritCommonOperation({
    mode: "maintain",
    input: { ...input, action: "changes.abandon", changeId, message: input.reason || input.message }
  });
}

async function githubApi(repo, args, payload, input) {
  if (input.dryRun === true) {
    return { dryRun: true, provider: "github", command: "gh", args, payload };
  }
  const result = await runProcess("gh", args, {
    cwd: repo.root,
    input: payload === undefined ? undefined : JSON.stringify(payload)
  });
  return { provider: "github", stdout: result.stdout, stderr: result.stderr };
}

async function setProtection(repo, input) {
  const confirmation = requireConfirmation(input, "Branch protection update");
  if (confirmation) return confirmation;
  const provider = providerName(input, "github");
  if (!GITHUB_PROVIDER_NAMES.has(provider)) {
    return fail(400, "unsupported_provider", `Unsupported protection provider: ${provider}`);
  }
  const slug = text(input.githubRepo || input.repositorySlug) || await detectGithubSlug(repo);
  if (!slug) return fail(400, "missing_repository_slug", "GitHub repository slug is required.");
  const branchPattern = requireString(input, "branchPattern");
  return githubApi(repo, ["api", "-X", "PUT", `repos/${slug}/branches/${branchPattern}/protection`, "--input", "-"], input.rules || {}, input);
}

async function setWebhook(repo, input) {
  const confirmation = requireConfirmation(input, "Webhook update");
  if (confirmation) return confirmation;
  const provider = providerName(input, "github");
  if (!GITHUB_PROVIDER_NAMES.has(provider)) {
    return fail(400, "unsupported_provider", `Unsupported webhook provider: ${provider}`);
  }
  const slug = text(input.githubRepo || input.repositorySlug) || await detectGithubSlug(repo);
  if (!slug) return fail(400, "missing_repository_slug", "GitHub repository slug is required.");
  const webhookId = text(input.webhookId);
  const method = webhookId ? "PATCH" : "POST";
  const pathPart = webhookId ? `repos/${slug}/hooks/${webhookId}` : `repos/${slug}/hooks`;
  return githubApi(repo, ["api", "-X", method, pathPart, "--input", "-"], input.payload || {}, input);
}

async function setMember(repo, input) {
  const confirmation = requireConfirmation(input, "Repository member update");
  if (confirmation) return confirmation;
  const provider = providerName(input, "github");
  if (!GITHUB_PROVIDER_NAMES.has(provider)) {
    return fail(400, "unsupported_provider", `Unsupported member provider: ${provider}`);
  }
  const slug = text(input.githubRepo || input.repositorySlug) || await detectGithubSlug(repo);
  if (!slug) return fail(400, "missing_repository_slug", "GitHub repository slug is required.");
  const subjectId = requireString(input, "subjectId");
  const role = requireString(input, "role");
  return githubApi(repo, ["api", "-X", "PUT", `repos/${slug}/collaborators/${subjectId}`, "-f", `permission=${role}`], undefined, input);
}

async function executeRepoOperationData(operationId, repo, input, scopes) {
  switch (operationId) {
    case "repo.status":
      return readRepoStatus(repo, input);
    case "repo.file.read":
      return readFile(repo, input);
    case "repo.tree.list":
      return listTree(repo, input);
    case "repo.diff.read":
      return readDiff(repo, input);
    case "repo.commit.read":
      return readCommit(repo, input);
    case "repo.file.create":
      return writeFileAction(repo, input, "create");
    case "repo.file.update":
      return writeFileAction(repo, input, "update");
    case "repo.file.delete":
      return writeFileAction(repo, input, "delete");
    case "repo.file.move":
      return writeFileAction(repo, input, "move");
    case "repo.branch.create":
      return createBranch(repo, input);
    case "repo.branch.checkout":
      return checkoutBranch(repo, input);
    case "repo.commit.create":
      return createCommit(repo, input);
    case "repo.push":
      return pushRepo(repo, input, scopes);
    case "repo.proposal.create":
      return createProposal(repo, input);
    case "repo.review.comment":
      return reviewRepo(repo, input, "comment");
    case "repo.review.requestChanges":
      return reviewRepo(repo, input, "requestChanges");
    case "repo.review.approve":
      return reviewRepo(repo, input, "approve");
    case "repo.merge":
      return mergeRepo(repo, input);
    case "repo.submit":
      return submitRepo(input);
    case "repo.rebase":
      return rebaseRepo(repo, input);
    case "repo.revert":
      return revertRepo(repo, input);
    case "repo.proposal.close":
      return closeProposal(repo, input);
    case "repo.change.abandon":
      return abandonChange(input);
    case "repo.protection.set":
      return setProtection(repo, input);
    case "repo.webhook.set":
      return setWebhook(repo, input);
    case "repo.member.set":
      return setMember(repo, input);
    default:
      return fail(400, "unsupported_repo_operation", `Unsupported repo operation: ${operationId}`);
  }
}

export async function executeRepoOperation({ operationId, input = {}, authSession = null } = {}) {
  const payload = asObject(input);
  const normalizedOperationId = text(operationId || payload.action || payload.operationId);
  if (!REPO_OPERATION_IDS.includes(normalizedOperationId)) {
    return fail(400, "unsupported_repo_operation", `Unsupported repo operation: ${normalizedOperationId || "(empty)"}`, {
      allowedOperations: REPO_OPERATION_IDS
    });
  }
  try {
    const repo = await resolveRepo(payload);
    const data = await executeRepoOperationData(normalizedOperationId, repo, payload, actorScopes(authSession));
    if (data?.ok === false && data?.status) {
      return {
        ...data,
        operationId: normalizedOperationId,
        repo: publicRepo(repo)
      };
    }
    return ok(normalizedOperationId, publicRepo(repo), data);
  } catch (error) {
    if (error?.code === "REPO_ROOT_DENIED") {
      return fail(error.status || 403, "repo_root_denied", error instanceof Error ? error.message : "Repository root denied.");
    }
    if (error?.code === "REPO_PATH_DENIED") {
      return fail(error.status || 400, "path_denied", error instanceof Error ? error.message : "Repository path denied.");
    }
    return fail(error?.result?.code ? 502 : 400, "repo_operation_failed", error instanceof Error ? error.message : "Repo operation failed.", {
      command: error?.result?.command,
      args: error?.result?.args,
      stderr: error?.result?.stderr,
      stdout: error?.result?.stdout
    });
  }
}
