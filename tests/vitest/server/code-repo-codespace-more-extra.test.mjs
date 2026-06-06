import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  files: new Map()
}));

const spawnPlan = vi.hoisted(() => []);
const executeGerritCommonOperationMock = vi.hoisted(() => vi.fn());
const executeRepoOperationMock = vi.hoisted(() => vi.fn());
const serverConfigMock = vi.hoisted(() => ({
  getDataDir: vi.fn(() => "/virtual/server-data")
}));

function createSpawnChild({ code = 0, stdout = "", stderr = "" } = {}) {
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

function setSpawnPlan(entries) {
  spawnPlan.length = 0;
  spawnPlan.push(...entries);
}

function queueRepoResolution({ candidate, repoRoot = "/virtual/worktree", head = "abc123", branch = "main" }) {
  spawnPlan.push(
    {
      match: (command, args) => command === "git" && args[0] === "-C" && args[1] === candidate && args[2] === "rev-parse" && args[3] === "--show-toplevel",
      response: { code: 0, stdout: `${repoRoot}\n` }
    },
    {
      match: (command, args, options) => command === "git" && args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD" && options?.cwd === repoRoot,
      response: { code: 0, stdout: `${head}\n` }
    },
    {
      match: (command, args, options) => command === "git" && args[0] === "branch" && args[1] === "--show-current" && options?.cwd === repoRoot,
      response: { code: 0, stdout: `${branch}\n` }
    }
  );
}

function queueSpawnResponse(match, response) {
  spawnPlan.push({ match, response });
}

function readJson(filePath) {
  return JSON.parse(fsState.files.get(filePath));
}

function setJson(filePath, value) {
  fsState.files.set(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    spawn: vi.fn((command, args, options = {}) => {
      const index = spawnPlan.findIndex((entry) => entry.match(command, args, options));
      if (index < 0) {
        throw new Error(`Unexpected spawn call: ${command} ${args.join(" ")}`);
      }
      const [entry] = spawnPlan.splice(index, 1);
      return createSpawnChild(entry.response);
    })
  };
});

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async (filePath) => {
      if (!fsState.files.has(filePath)) {
        const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        error.code = "ENOENT";
        throw error;
      }
      return fsState.files.get(filePath);
    }),
    writeFile: vi.fn(async (filePath, data) => {
      fsState.files.set(filePath, Buffer.isBuffer(data) ? Buffer.from(data).toString("utf8") : String(data));
    })
  },
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(async (filePath) => {
    if (!fsState.files.has(filePath)) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      error.code = "ENOENT";
      throw error;
    }
    return fsState.files.get(filePath);
  }),
  writeFile: vi.fn(async (filePath, data) => {
    fsState.files.set(filePath, Buffer.isBuffer(data) ? Buffer.from(data).toString("utf8") : String(data));
  })
}));

vi.mock("../../../server/platform/common/config/ServerConfig.mjs", () => ({
  ServerConfig: serverConfigMock
}));

vi.mock("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs");
  return {
    ...actual,
    executeGerritCommonOperation: executeGerritCommonOperationMock
  };
});

let CODESPACE_PROTOCOL_VERSION;
let createCodespaceRegistry;
let executeRepoOperation;

beforeAll(async () => {
  ({
    CODESPACE_PROTOCOL_VERSION,
    createCodespaceRegistry
  } = await import("../../../server/platform/specialized/capabilities/code-management/codespace/index.mjs"));
  ({ executeRepoOperation } = await import("../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs"));
});

beforeEach(() => {
  fsState.files.clear();
  setSpawnPlan([]);
  executeGerritCommonOperationMock.mockReset();
  executeRepoOperationMock.mockReset();
  serverConfigMock.getDataDir.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("repo-operations mocked branches", () => {
  it("normalizes repo and path inputs, covers status fallback, and exercises diff/branch/commit mock branches", async () => {
    const repoCandidate = path.resolve(process.cwd(), "fixtures", "repo");
    const repoRoot = "/virtual/worktree";
    const filePath = path.join(repoRoot, "src", "file.txt");
    fsState.files.set(filePath, "hello from mock repo\n");

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "aaa111",
      branch: "feature/mock"
    });

    const file = await executeRepoOperation({
      operationId: "repo.file.read",
      input: {
        repoId: "fixtures/repo",
        path: "\\src//nested/../file.txt"
      }
    });

    expect(file).toMatchObject({
      ok: true,
      operationId: "repo.file.read",
      repo: {
        repoId: "fixtures/repo",
        root: repoRoot,
        branch: "feature/mock",
        head: "aaa111"
      },
      data: {
        path: "src/file.txt",
        ref: "",
        content: "hello from mock repo\n",
        encoding: "utf8"
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "aaa111",
      branch: "feature/mock"
    });
    executeGerritCommonOperationMock.mockResolvedValueOnce({
      ok: true,
      mode: "read",
      action: "changes.get",
      input: { changeId: "I123" },
      result: { change_id: "I123" }
    });

    const changeStatus = await executeRepoOperation({
      operationId: "repo.status",
      input: {
        repoId: "fixtures/repo",
        targetType: "change",
        targetId: "I123",
        detail: false
      }
    });
    expect(executeGerritCommonOperationMock).toHaveBeenCalledWith({
      mode: "read",
      input: {
        repoId: "fixtures/repo",
        targetType: "change",
        targetId: "I123",
        detail: false,
        action: "changes.get",
        changeId: "I123"
      }
    });
    expect(changeStatus).toMatchObject({
      ok: true,
      operationId: "repo.status",
      data: {
        targetType: "change",
        targetId: "I123",
        gerrit: {
          ok: true,
          mode: "read",
          action: "changes.get"
        }
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "aaa111",
      branch: "feature/mock"
    });
    queueSpawnResponse(
      (command, args) => command === "/bin/sh" && args[0] === "-lc" && String(args[1] || "").includes("command -v"),
      { code: 1, stdout: "", stderr: "" }
    );

    const prStatus = await executeRepoOperation({
      operationId: "repo.status",
      input: {
        repoId: "fixtures/repo",
        targetType: "pr",
        targetId: "99"
      }
    });
    expect(prStatus).toMatchObject({
      ok: true,
      operationId: "repo.status",
      data: {
        targetType: "pr",
        available: false,
        reason: "No local adapter is available for this status target."
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "aaa111",
      branch: "feature/mock"
    });
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "diff" && args[1] === "--no-ext-diff",
      { code: 1, stdout: "", stderr: "diff exploded\n" }
    );

    const diffFailure = await executeRepoOperation({
      operationId: "repo.diff.read",
      input: {
        repoId: "fixtures/repo",
        baseRef: "HEAD~1",
        headRef: "HEAD"
      }
    });
    expect(diffFailure).toMatchObject({
      ok: false,
      status: 502,
      error: {
        code: "repo_operation_failed",
        message: "diff exploded\n",
        details: {
          command: "git",
          args: ["diff", "--no-ext-diff", "HEAD~1..HEAD"],
          stderr: "diff exploded\n"
        }
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "aaa111",
      branch: "feature/mock"
    });
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "show" && args[1] === "--no-patch",
      {
        code: 0,
        stdout: [
          "hash123",
          "short12",
          "Ada Lovelace",
          "ada@example.test",
          "2026-06-05T00:00:00.000Z",
          "Mock commit subject",
          "Body line 1",
          "Body line 2"
        ].join("\n")
      }
    );
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "show" && args[1] === "--stat",
      { code: 0, stdout: " file.txt | 2 ++\n" }
    );

    const commit = await executeRepoOperation({
      operationId: "repo.commit.read",
      input: {
        repoId: "fixtures/repo",
        commitRef: "HEAD"
      }
    });
    expect(commit).toMatchObject({
      ok: true,
      operationId: "repo.commit.read",
      data: {
        commitRef: "HEAD",
        hash: "hash123",
        shortHash: "short12",
        authorName: "Ada Lovelace",
        authorEmail: "ada@example.test",
        subject: "Mock commit subject",
        body: "Body line 1\nBody line 2",
        stat: " file.txt | 2 ++\n"
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "aaa111",
      branch: "feature/mock"
    });
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "branch" && args[1] && args[1].startsWith("feature/"),
      { code: 0, stdout: "" }
    );
    const createdBranch = await executeRepoOperation({
      operationId: "repo.branch.create",
      input: {
        repoId: "fixtures/repo",
        branchName: "feature/new",
        baseRef: "main"
      }
    });
    expect(createdBranch).toMatchObject({
      ok: true,
      data: {
        branchName: "feature/new",
        baseRef: "main"
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "bbb222",
      branch: "feature/new"
    });
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "checkout" && args[1] === "feature/new",
      { code: 0, stdout: "" }
    );
    queueRepoResolution({
      candidate: repoRoot,
      repoRoot,
      head: "ccc333",
      branch: "feature/new"
    });
    const checkedOut = await executeRepoOperation({
      operationId: "repo.branch.checkout",
      input: {
        repoId: "fixtures/repo",
        branchName: "feature/new"
      }
    });
    expect(checkedOut).toMatchObject({
      ok: true,
      data: {
        branchName: "feature/new",
        head: "ccc333"
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "ccc333",
      branch: "feature/new"
    });
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "add" && args[1] === "-A",
      { code: 0, stdout: "" }
    );
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "diff" && args[1] === "--cached" && args[2] === "--quiet",
      { code: 0, stdout: "" }
    );
    const noChanges = await executeRepoOperation({
      operationId: "repo.commit.create",
      input: {
        repoId: "fixtures/repo",
        message: "empty commit"
      }
    });
    expect(noChanges).toMatchObject({
      ok: false,
      status: 409,
      error: {
        code: "no_changes",
        message: "No staged changes are available for commit."
      }
    });

    queueRepoResolution({
      candidate: repoCandidate,
      repoRoot,
      head: "ccc333",
      branch: "feature/new"
    });
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "add" && args[1] === "-A",
      { code: 0, stdout: "" }
    );
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "diff" && args[1] === "--cached" && args[2] === "--quiet",
      { code: 0, stdout: "" }
    );
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "commit" && args.includes("--allow-empty"),
      { code: 0, stdout: "" }
    );
    queueSpawnResponse(
      (command, args) => command === "git" && args[0] === "rev-parse" && args[1] === "HEAD",
      { code: 0, stdout: "ddd444\n" }
    );
    const emptyCommit = await executeRepoOperation({
      operationId: "repo.commit.create",
      input: {
        repoId: "fixtures/repo",
        message: "allow empty",
        allowEmpty: true
      }
    });
    expect(emptyCommit).toMatchObject({
      ok: true,
      operationId: "repo.commit.create",
      data: {
        branch: "feature/new",
        commit: "ddd444",
        appliedChanges: []
      }
    });
  });
});

describe("codespace lifecycle and status mapping", () => {
  it("handles empty inputs, reject mappings, state transitions, and upload errors without a provider", async () => {
    const root = "/virtual/codespace-root";
    const registryPath = path.join(root, "code-management", "codespace-registry.json");
    const runtime = createCodespaceRegistry({
      userDataPath: root,
      executeRepoOperation: executeRepoOperationMock,
      executeGerritCommonOperation: executeGerritCommonOperationMock
    });

    const evaluated = await runtime.evaluateTarget({});
    expect(evaluated).toMatchObject({
      ok: true,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      routeDecision: "workspaceContribution",
      accepted: true,
      compatibleTargets: [
        {
          targetKind: "workspaceContribution",
          targetProvider: "workspace",
          repositoryRef: "",
          branch: "main",
          reason: "payload can remain a workspace contribution"
        }
      ]
    });

    const rejected = await runtime.evaluateTarget({
      routeDecision: "reject",
      policyDecision: "deny",
      fallbackReason: "manual rejection"
    });
    expect(rejected).toMatchObject({
      ok: true,
      routeDecision: "reject",
      accepted: false,
      policyDecision: "deny"
    });

    const prepared = await runtime.prepareChange({});
    expect(prepared).toMatchObject({
      ok: true,
      prepared: true,
      branch: "main",
      reviewStatus: "draft",
      submitStatus: "notSubmitted",
      changeSet: {
        payloadKind: "repositoryChange",
        dataClass: "codeChange",
        fileCount: 0,
        diff: "",
        commitPlan: []
      }
    });

    const syncedOpen = await runtime.syncStatus({
      providerReceipt: {
        reviewStatus: "NEW",
        submitStatus: "submitted",
        change_id: "I-open",
        _number: 7,
        current_revision: "rev-open"
      }
    });
    expect(syncedOpen).toMatchObject({
      ok: true,
      synced: true,
      reviewStatus: "open",
      submitStatus: "submitted",
      changeId: "I-open",
      changeNumber: "7"
    });

    const syncedAbandoned = await runtime.syncStatus({
      providerReceipt: {
        status: "ABANDONED",
        submitStatus: "failed",
        change_id: "I-abandoned",
        _number: 8,
        current_revision: "rev-abandoned"
      }
    });
    expect(syncedAbandoned).toMatchObject({
      ok: true,
      synced: true,
      reviewStatus: "abandoned",
      submitStatus: "failed",
      changeId: "I-abandoned",
      changeNumber: "8"
    });

    const syncedFailed = await runtime.syncStatus({
      providerReceipt: {
        reviewStatus: "failed",
        change_id: "I-failed",
        _number: 9,
        current_revision: "rev-failed"
      }
    });
    expect(syncedFailed).toMatchObject({
      ok: true,
      synced: true,
      reviewStatus: "failed",
      submitStatus: "failed",
      changeId: "I-failed",
      changeNumber: "9"
    });

    const uploadError = await runtime.uploadCodespaceChange({
      provider: "gerrit",
      repositoryRef: "owner/repo",
      branch: "main"
    });
    expect(uploadError).toMatchObject({
      ok: false,
      status: 503,
      error: "Gerrit upload provider is not registered."
    });

    expect(readJson(registryPath).events.map((event) => event.type)).toEqual([
      "code.route.evaluated",
      "code.route.evaluated",
      "code.change.prepared",
      "code.change.status.synced",
      "code.change.status.synced",
      "code.change.status.synced"
    ]);
  });
});
