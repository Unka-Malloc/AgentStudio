import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const serverConfigMock = vi.hoisted(() => ({
  getDataDir: vi.fn(() => "/virtual/pact-data")
}));
const fsState = vi.hoisted(() => ({
  files: new Map(),
  dirs: new Set(),
  spawnPlan: []
}));

function normalizeFsPath(value) {
  return path.resolve(String(value));
}

function ensureDir(dirPath) {
  let current = normalizeFsPath(dirPath);
  while (true) {
    fsState.dirs.add(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

function seedFile(filePath, content) {
  const absolute = normalizeFsPath(filePath);
  ensureDir(path.dirname(absolute));
  fsState.files.set(absolute, String(content));
}

function clearFsState() {
  fsState.files.clear();
  fsState.dirs.clear();
  ensureDir("/");
  fsState.spawnPlan = [];
}

function dirEntries(dirPath) {
  const absolute = normalizeFsPath(dirPath);
  if (!fsState.dirs.has(absolute) && ![...fsState.files.keys()].some((filePath) => filePath.startsWith(`${absolute}${path.sep}`))) {
    const error = new Error(`ENOENT: no such file or directory, scandir '${absolute}'`);
    error.code = "ENOENT";
    throw error;
  }
  const seen = new Map();
  const prefix = absolute === "/" ? "/" : `${absolute}${path.sep}`;
  for (const filePath of fsState.files.keys()) {
    if (!filePath.startsWith(prefix)) {
      continue;
    }
    const remainder = filePath.slice(prefix.length);
    const [head] = remainder.split(path.sep);
    if (head) {
      seen.set(head, "file");
    }
  }
  for (const dir of fsState.dirs) {
    if (!dir.startsWith(prefix) || dir === absolute) {
      continue;
    }
    const remainder = dir.slice(prefix.length);
    const [head] = remainder.split(path.sep);
    if (head) {
      seen.set(head, "dir");
    }
  }
  return [...seen.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, kind]) => ({
    name,
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
    isSymbolicLink: () => false
  }));
}

function createSpawnResult({ code = 0, stdout = "", stderr = "" } = {}) {
  const child = new EventEmitter();
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  const stdinStream = new PassThrough();
  child.stdout = stdoutStream;
  child.stderr = stderrStream;
  child.stdin = stdinStream;
  setImmediate(() => {
    if (stdout) {
      stdoutStream.write(String(stdout));
    }
    if (stderr) {
      stderrStream.write(String(stderr));
    }
    stdoutStream.end();
    stderrStream.end();
    child.emit("close", code);
  });
  return child;
}

function setSpawnPlan(entries) {
  fsState.spawnPlan = [...entries];
}

function spawnResponder(command, args, options) {
  const index = fsState.spawnPlan.findIndex((entry) => entry.match(command, args, options));
  const entry = index >= 0 ? fsState.spawnPlan.splice(index, 1)[0] : null;
  if (!entry) {
    return { code: 0, stdout: "", stderr: "" };
  }
  return typeof entry.response === "function"
    ? entry.response(command, args, options)
    : entry.response;
}

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(async (dirPath) => {
      ensureDir(dirPath);
    }),
    readFile: vi.fn(async (filePath) => {
      const absolute = normalizeFsPath(filePath);
      if (!fsState.files.has(absolute)) {
        const error = new Error(`ENOENT: no such file or directory, open '${absolute}'`);
        error.code = "ENOENT";
        throw error;
      }
      return fsState.files.get(absolute);
    }),
    writeFile: vi.fn(async (filePath, data, options = {}) => {
      const absolute = normalizeFsPath(filePath);
      ensureDir(path.dirname(absolute));
      if (options?.flag === "wx" && fsState.files.has(absolute)) {
        const error = new Error(`EEXIST: file already exists, open '${absolute}'`);
        error.code = "EEXIST";
        throw error;
      }
      fsState.files.set(absolute, Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    }),
    readdir: vi.fn(async (dirPath, options = {}) => {
      const entries = dirEntries(dirPath);
      if (options?.withFileTypes) {
        return entries;
      }
      return entries.map((entry) => entry.name);
    }),
    stat: vi.fn(async (filePath) => {
      const absolute = normalizeFsPath(filePath);
      if (!fsState.files.has(absolute) && !fsState.dirs.has(absolute)) {
        const error = new Error(`ENOENT: no such file or directory, stat '${absolute}'`);
        error.code = "ENOENT";
        throw error;
      }
      return {};
    }),
    rm: vi.fn(async (filePath) => {
      const absolute = normalizeFsPath(filePath);
      if (!fsState.files.delete(absolute)) {
        const error = new Error(`ENOENT: no such file or directory, rm '${absolute}'`);
        error.code = "ENOENT";
        throw error;
      }
    }),
    rename: vi.fn(async (fromPath, toPath) => {
      const from = normalizeFsPath(fromPath);
      const to = normalizeFsPath(toPath);
      if (!fsState.files.has(from)) {
        const error = new Error(`ENOENT: no such file or directory, rename '${from}' -> '${to}'`);
        error.code = "ENOENT";
        throw error;
      }
      fsState.files.set(to, fsState.files.get(from));
      fsState.files.delete(from);
      ensureDir(path.dirname(to));
    })
  },
  mkdir: vi.fn(async (dirPath) => {
    ensureDir(dirPath);
  }),
  readFile: vi.fn(async (filePath) => {
    const absolute = normalizeFsPath(filePath);
    if (!fsState.files.has(absolute)) {
      const error = new Error(`ENOENT: no such file or directory, open '${absolute}'`);
      error.code = "ENOENT";
      throw error;
    }
    return fsState.files.get(absolute);
  }),
  writeFile: vi.fn(async (filePath, data, options = {}) => {
    const absolute = normalizeFsPath(filePath);
    ensureDir(path.dirname(absolute));
    if (options?.flag === "wx" && fsState.files.has(absolute)) {
      const error = new Error(`EEXIST: file already exists, open '${absolute}'`);
      error.code = "EEXIST";
      throw error;
    }
    fsState.files.set(absolute, Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  }),
  readdir: vi.fn(async (dirPath, options = {}) => {
    const entries = dirEntries(dirPath);
    if (options?.withFileTypes) {
      return entries;
    }
    return entries.map((entry) => entry.name);
  }),
  stat: vi.fn(async (filePath) => {
    const absolute = normalizeFsPath(filePath);
    if (!fsState.files.has(absolute) && !fsState.dirs.has(absolute)) {
      const error = new Error(`ENOENT: no such file or directory, stat '${absolute}'`);
      error.code = "ENOENT";
      throw error;
    }
    return {};
  }),
  rm: vi.fn(async (filePath) => {
    const absolute = normalizeFsPath(filePath);
    if (!fsState.files.delete(absolute)) {
      const error = new Error(`ENOENT: no such file or directory, rm '${absolute}'`);
      error.code = "ENOENT";
      throw error;
    }
  }),
  rename: vi.fn(async (fromPath, toPath) => {
    const from = normalizeFsPath(fromPath);
    const to = normalizeFsPath(toPath);
    if (!fsState.files.has(from)) {
      const error = new Error(`ENOENT: no such file or directory, rename '${from}' -> '${to}'`);
      error.code = "ENOENT";
      throw error;
    }
    fsState.files.set(to, fsState.files.get(from));
    fsState.files.delete(from);
    ensureDir(path.dirname(to));
  })
}));

vi.mock("../../../server/platform/common/config/ServerConfig.mjs", () => ({
  ServerConfig: serverConfigMock
}));

vi.stubGlobal("fetch", fetchMock);

function createFetchResponse({
  status = 200,
  statusText = "OK",
  headers = {},
  text = ""
} = {}) {
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

function seedCodespaceConfig(root, providers) {
  seedFile(path.join(root, "code-management", "codespace-providers.json"), `${JSON.stringify({
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: "v0.0.1:platform:codespace-1",
    updatedAt: "2026-06-05T00:00:00.000Z",
    providers
  }, null, 2)}\n`);
}

spawnMock.mockImplementation((command, args, options) => {
  return createSpawnResult(spawnResponder(command, args, options));
});

let executeRepoOperation;
let executeGerritCommonOperation;
let uploadGerritGitChange;
let createCodespaceRegistry;

beforeEach(async () => {
  clearFsState();
  fetchMock.mockReset();
  spawnMock.mockClear();
  serverConfigMock.getDataDir.mockClear();
  serverConfigMock.getDataDir.mockReturnValue("/virtual/pact-data");
  process.env.PACT_GERRIT_BASE_URL = "";
  process.env.PACT_GERRIT_USERNAME = "";
  process.env.PACT_GERRIT_HTTP_PASSWORD = "";
  process.env.PACT_GERRIT_BEARER_TOKEN = "";
  process.env.PACT_GERRIT_AUTH_MODE = "";

  if (!executeRepoOperation) {
    ({ executeRepoOperation } = await import("../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs"));
    ({ executeGerritCommonOperation, uploadGerritGitChange } = await import("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs"));
    ({ createCodespaceRegistry } = await import("../../../server/platform/specialized/capabilities/code-management/codespace/index.mjs"));
  }
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("code capabilities extra coverage", () => {
  it("normalizes Gerrit upload branches and confirms the uploaded commit", async () => {
    setSpawnPlan([
      {
        match: (command, args) => command === "git" && args[0] === "remote" && args[1] === "get-url",
        response: { code: 0, stdout: "https://gerrit.example/a/org/repo.git\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "status" && args[1] === "--short",
        response: { code: 0, stdout: "\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "rev-parse" && args[1] === "HEAD",
        response: { code: 0, stdout: "cafebabe\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "push",
        response: { code: 0, stdout: "remote: uploaded\n", stderr: "" }
      }
    ]);
    fetchMock.mockResolvedValueOnce(createFetchResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      text: JSON.stringify([{
        id: "I1234567890",
        _number: 42,
        number: "42",
        status: "NEW",
        project: "org/repo",
        branch: "feature/new",
        current_revision: "cafebabe",
        revisions: {
          cafebabe: { _number: 1, commit: { commit: "cafebabe" } }
        }
      }])
    }));

    const response = await uploadGerritGitChange({
      worktreePath: "/virtual/repo",
      remote: "origin",
      allowDirty: true,
      branch: "refs/heads/feature/new",
      confirmationTimeoutMs: 0
    });

    expect(response).toMatchObject({
      ok: true,
      status: "completed",
      worktreePath: "/virtual/repo",
      remote: "origin",
      branch: "feature/new",
      project: "org/repo",
      reviewUrl: "https://gerrit.example/c/org/repo/+/42"
    });
    expect(response.targetRef).toBe("I1234567890");
    expect(response.changeNumber).toBe("42");
    expect(spawnMock.mock.calls.some((call) => call[1].includes("HEAD:refs/for/refs/heads/feature/new"))).toBe(true);
  });

  it("covers repo resolution failure, path normalization, dry-run push planning, and push error mapping", async () => {
    seedFile("/virtual/repo/src/file.txt", "hello from repo\n");

    setSpawnPlan([
      {
        match: (command, args) => command === "git" && args[0] === "-C" && args[1] === "/virtual/missing",
        response: { code: 1, stdout: "", stderr: "not a git repository\n" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "-C" && args[1] === "/virtual/repo" && args[2] === "rev-parse" && args[3] === "--show-toplevel",
        response: { code: 0, stdout: "/virtual/repo\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD",
        response: { code: 0, stdout: "abc123\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "branch" && args[1] === "--show-current",
        response: { code: 0, stdout: "feature/main\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "-C" && args[1] === "/virtual/repo" && args[2] === "rev-parse" && args[3] === "--show-toplevel",
        response: { code: 0, stdout: "/virtual/repo\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "push" && args[1] === "--force-with-lease",
        response: { code: 128, stdout: "", stderr: "fatal: rejected by remote\n" }
      }
    ]);

    const missingRepo = await executeRepoOperation({
      operationId: "repo.status",
      input: { repoId: "/virtual/missing", targetType: "worktree" }
    });
    expect(missingRepo).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "repo_operation_failed" }
    });
    expect(missingRepo.error.message).toContain("repoId does not resolve to a git worktree");

    const normalizedRead = await executeRepoOperation({
      operationId: "repo.file.read",
      input: {
        repoId: "/virtual/repo",
        path: "\\src//nested/../file.txt"
      }
    });
    expect(normalizedRead).toMatchObject({
      ok: true,
      data: {
        path: "src/file.txt",
        ref: "",
        content: "hello from repo\n"
      }
    });

    const pushDryRun = await executeRepoOperation({
      operationId: "repo.push",
      input: {
        repoId: "/virtual/repo",
        remote: "origin",
        sourceRef: "feature/main",
        targetRef: "main",
        force: true,
        confirm: true,
        dryRun: true
      },
      authSession: { scopes: ["repo:maintain"] }
    });
    expect(pushDryRun).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        command: "git",
        args: ["push", "--force-with-lease", "origin", "feature/main:main"],
        cwd: "/virtual/repo"
      }
    });

    const pushFailure = await executeRepoOperation({
      operationId: "repo.push",
      input: {
        repoId: "/virtual/repo",
        remote: "origin",
        sourceRef: "feature/main",
        targetRef: "main",
        force: true,
        confirm: true
      },
      authSession: { scopes: ["repo:maintain"] }
    });
    expect(pushFailure).toMatchObject({
      ok: false,
      status: 502,
      error: {
        code: "repo_operation_failed",
        message: "fatal: rejected by remote\n",
        details: {
          command: "git",
          args: ["push", "--force-with-lease", "origin", "feature/main:main"],
          stderr: "fatal: rejected by remote\n"
        }
      }
    });
  });

  it("covers codespace capability routing, disabled providers, missing local repos, and live GitHub uploads", async () => {
    const root = "/virtual/codespace";
    seedCodespaceConfig(root, {
      github: {
        provider: "github",
        enabled: true,
        mode: "live",
        authType: "githubApp",
        secretRef: "secret://pact/codespace/github-app",
        repositoryPort: true,
        reviewPort: true,
        capabilities: ["repository.status", "change.upload"]
      },
      gerrit: {
        provider: "gerrit",
        enabled: false,
        mode: "contract",
        authType: "serviceAccount",
        secretRef: "secret://pact/codespace/gerrit-service-account",
        repositoryPort: true,
        reviewPort: true,
        capabilities: ["repository.status", "change.upload"]
      }
    });
    seedFile(path.join(root, "code-management", "codespace-registry.json"), `${JSON.stringify({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:codespace-1",
      updatedAt: "2026-06-05T00:00:00.000Z",
      targets: {},
      changes: {},
      events: []
    }, null, 2)}\n`);

    const runtime = createCodespaceRegistry({ userDataPath: root });
    const manifest = await runtime.providerManifest();
    expect(manifest).toMatchObject({
      ok: true,
      configPath: path.join(root, "code-management", "codespace-providers.json"),
      providerCount: 2,
      enabledProviderCount: 1
    });
    expect(manifest.providers.github).toMatchObject({ enabled: true, mode: "live" });
    expect(manifest.providers.gerrit).toMatchObject({ enabled: false, mode: "contract" });

    const disabled = await runtime.repositoryStatus({
      provider: "gerrit",
      repositoryRef: "owner/repo"
    });
    expect(disabled).toMatchObject({
      ok: false,
      status: 409,
      provider: "gerrit",
      error: "Codespace provider is disabled: gerrit"
    });

    const contractRead = await runtime.repositoryStatus({
      provider: "github",
      repositoryRef: "owner/repo",
      branch: "main"
    });
    expect(contractRead).toMatchObject({
      ok: true,
      status: 200,
      protocolVersion: "v0.0.1:platform:codespace-1",
      operationId: "codespace.repository.status",
      provider: "github",
      adapter: "RepositoryPort",
      repositoryRef: "owner/repo",
      branch: "main",
      data: {},
      receipt: {
        contractVerified: true,
        provider: "github",
        secretRef: "secret://pact/codespace/github-app",
        operationId: "codespace.repository.status"
      }
    });

    setSpawnPlan([
      {
        match: (command, args) => command === "git" && args[0] === "-C" && args[1] === "/virtual/repo" && args[2] === "rev-parse" && args[3] === "--show-toplevel",
        response: { code: 0, stdout: "/virtual/repo\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD",
        response: { code: 0, stdout: "beefcafe\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "branch" && args[1] === "--show-current",
        response: { code: 0, stdout: "feature/live\n", stderr: "" }
      }
    ]);
    const dryRunUpload = await runtime.uploadCodespaceChange({
      provider: "github",
      repoId: "/virtual/repo",
      repositoryRef: "owner/repo",
      sourceRef: "feature/live",
      targetRef: "main",
      title: "Add feature",
      dryRun: true
    });
    expect(dryRunUpload).toMatchObject({
      ok: true,
      status: 200,
      provider: "github",
      dryRun: true,
      uploadState: "dry-run",
      contractVerified: true,
      codeChange: {
        repositoryRef: "owner/repo",
        branch: "main"
      }
    });

    setSpawnPlan([
      {
        match: (command, args) => command === "git" && args[0] === "-C" && args[1] === "/virtual/repo" && args[2] === "rev-parse" && args[3] === "--show-toplevel",
        response: { code: 0, stdout: "/virtual/repo\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "HEAD",
        response: { code: 0, stdout: "beefcafe\n", stderr: "" }
      },
      {
        match: (command, args) => command === "git" && args[0] === "branch" && args[1] === "--show-current",
        response: { code: 0, stdout: "feature/live\n", stderr: "" }
      },
      {
        match: (command, args) => command === "gh" && args[0] === "pr" && args[1] === "create",
        response: { code: 0, stdout: "https://github.com/acme/project/pull/77\n", stderr: "" }
      }
    ]);

    const liveUpload = await runtime.uploadCodespaceChange({
      provider: "github",
      repoId: "/virtual/repo",
      repositoryRef: "owner/repo",
      sourceRef: "feature/live",
      targetRef: "main",
      title: "Add feature",
      dryRun: false
    });
    expect(liveUpload).toMatchObject({
      ok: true,
      status: 200,
      provider: "github",
      dryRun: false,
      uploadState: "remote-live",
      contractVerified: false,
      codeChange: {
        reviewUrl: "https://github.com/acme/project/pull/77",
        reviewStatus: "open",
        target: {
          targetKind: "codespace",
          targetProvider: "github",
          repositoryRef: "owner/repo",
          branch: "main"
        }
      }
    });
    expect(liveUpload.completion).toMatchObject({
      provider: "github",
      uploadState: "remote-live",
      confirmed: true
    });
  });
});
