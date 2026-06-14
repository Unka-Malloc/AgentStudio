import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

const vmModuleSupportAvailable =
  typeof vm.SourceTextModule === "function" &&
  typeof vm.SyntheticModule === "function";
const describeWithVmModuleSupport = vmModuleSupportAvailable ? describe : describe.skip;
const modulePromise = vmModuleSupportAvailable ? loadInstrumentedModule() : Promise.resolve(null);

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function loadInstrumentedModule() {
  const sourcePath = path.resolve("server/platform/specialized/agent/agent-workspace/index.mjs");
  let source = await fs.readFile(sourcePath, "utf8");
  source = source.replace(
    /function canAccessWorkspace\(workspace, input = \{\}\) \{\n    if \(!workspace\) \{\n      return false;\n    \}\n    workspaceAccess\(input\);\n    return true;\n  \}/,
    `function canAccessWorkspace(workspace, input = {}) {\n    const hook = __agentWorkspaceTestHooks.canAccessWorkspace;\n    if (typeof hook === "function") return hook(workspace, input);\n    if (!workspace) return false;\n    workspaceAccess(input);\n    return true;\n  }`
  );
  const context = vm.createContext({
    Buffer,
    console,
    clearInterval,
    clearTimeout,
    process,
    queueMicrotask,
    setInterval,
    setTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams
  });
  const cache = new Map();
  const link = async (specifier) => {
    if (cache.has(specifier)) {
      return cache.get(specifier);
    }
    if (specifier === "../../../common/observability/runtime-logger.mjs") {
      const module = new vm.SyntheticModule(["getRuntimeLogger"], function evaluate() {
        this.setExport("getRuntimeLogger", () => ({
          debug() {},
          error() {},
          info() {},
          warn() {}
        }));
      }, { context, identifier: specifier });
      cache.set(specifier, module);
      return module;
    }
    const imported = await import(specifier);
    const exportNames = new Set(Object.keys(imported));
    if (Object.prototype.hasOwnProperty.call(imported, "default")) {
      exportNames.add("default");
    }
    const module = new vm.SyntheticModule([...exportNames], function evaluate() {
      for (const name of exportNames) {
        this.setExport(name, name === "default" ? imported.default : imported[name]);
      }
    }, { context, identifier: specifier });
    cache.set(specifier, module);
    return module;
  };
  const module = new vm.SourceTextModule(`${source}\nexport {\n  asArray,\n  asObject,\n  uniqueStrings,\n  parseJson,\n  stringifyJson,\n  stableHash,\n  stableJson,\n  stableId,\n  normalizeWorkspaceRelativePath,\n  joinWorkspaceRelativePath,\n  sha256Buffer,\n  normalizeSha256,\n  splitPatchTextLines,\n  parseUnifiedPatch,\n  assertPatchLineMatches,\n  applyUnifiedPatchText,\n  applyReplacementHunks,\n  optionalLimit,\n  normalizeText,\n  boundedInteger,\n  truncateText,\n  normalizeEvidenceRefs,\n  submissionSummary,\n  compactWorkspaceLayer,\n  compactRun,\n  compactSubmission,\n  compactArtifact,\n  compactIssue,\n  compactDecision,\n  compactPrivateState,\n  compactSessionEvent,\n  buildWorkspaceHandoffMarkdown,\n  decodeWorkspaceContextBundle,\n  hydrateWorkspace,\n  hydrateRun,\n  hydrateSubmission,\n  hydratePrivateState,\n  hydrateArtifact,\n  hydrateIssue,\n  hydrateDecision,\n  hydrateLock,\n  hydrateSession,\n  hydrateSessionEvent,\n  fileMetadataFromStat,\n  gateSubmission\n};\n\nconst __agentWorkspaceTestHooks = globalThis.__agentWorkspaceTestHooks || (globalThis.__agentWorkspaceTestHooks = {});\nexport function __setAgentWorkspaceTestHooks(hooks = {}) {\n  __agentWorkspaceTestHooks.canAccessWorkspace = hooks.canAccessWorkspace;\n}\n\nexport function __resetAgentWorkspaceTestHooks() {\n  delete __agentWorkspaceTestHooks.canAccessWorkspace;\n}\n`, {
    context,
    identifier: sourcePath,
    initializeImportMeta(meta) {
      meta.url = pathToFileURL(sourcePath).href;
    }
  });
  await module.link(link);
  await module.evaluate();
  return module.namespace;
}

async function withWorkspaceRuntime(testCase, options = {}) {
  const { createAgentWorkspace } = await modulePromise;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-focused-extra-2-"));
  const runtime = createAgentWorkspace({
    userDataPath: root,
    ...options
  });
  try {
    await testCase(runtime, root);
  } finally {
    runtime.close();
    await fs.rm(root, { force: true, recursive: true });
  }
}

describeWithVmModuleSupport("agent workspace helper branches", () => {
  it("covers helper fallbacks, patch application, and compactors", async () => {
    const helpers = await modulePromise;

    expect(helpers.asArray([1, 2])).toEqual([1, 2]);
    expect(helpers.asArray("not-an-array")).toEqual([]);
    expect(helpers.asObject({ a: 1 })).toEqual({ a: 1 });
    expect(helpers.asObject(["not", "object"])).toEqual({});

    expect(helpers.uniqueStrings([" a ", "a", "", "b", "b"])).toEqual(["a", "b"]);
    expect(helpers.parseJson("{\"a\":1}", { fallback: true })).toEqual({ a: 1 });
    expect(helpers.parseJson("not-json", { fallback: true })).toEqual({ fallback: true });
    expect(helpers.stringifyJson(undefined, { fallback: true })).toBe("{\"fallback\":true}");
    expect(helpers.stringifyJson(null, { fallback: true })).toBe("null");

    expect(helpers.stableJson({ b: 2, a: [3, { c: 4 }] })).toBe("{\"a\":[3,{\"c\":4}],\"b\":2}");
    expect(helpers.stableId("prefix", "left", "right")).toMatch(/^prefix_[a-f0-9]{24}$/);

    expect(helpers.normalizeWorkspaceRelativePath("foo/./bar/../baz")).toBe("foo/baz");
    expect(helpers.normalizeWorkspaceRelativePath("", { allowEmpty: true })).toBe("");
    expect(() => helpers.normalizeWorkspaceRelativePath("")).toThrow("路径不能为空。");
    expect(() => helpers.normalizeWorkspaceRelativePath("/absolute")).toThrow("路径必须是工作空间相对路径。");
    expect(() => helpers.normalizeWorkspaceRelativePath("C:/absolute")).toThrow("路径必须是工作空间相对路径。");
    expect(() => helpers.normalizeWorkspaceRelativePath("../escape")).toThrow("路径不能跳出工作空间。");
    expect(helpers.joinWorkspaceRelativePath(" foo ", "bar", "baz ")).toBe("foo/bar/baz");

    expect(helpers.optionalLimit(undefined)).toBeNull();
    expect(helpers.optionalLimit(false)).toBeNull();
    expect(helpers.optionalLimit("0")).toBeNull();
    expect(helpers.optionalLimit("9", 4)).toBe(4);
    expect(helpers.boundedInteger("not-a-number", 7, 1, 10)).toBe(7);
    expect(helpers.boundedInteger(-3, 7, 1, 10)).toBe(1);
    expect(helpers.boundedInteger(99, 7, 1, 10)).toBe(10);

    expect(helpers.truncateText("  spaced   text  ", 100)).toBe("spaced text");
    expect(helpers.truncateText("abcdefghijklmno", 10)).toBe("...<truncated>");
    expect(helpers.truncateText("abcdef", 0)).toBe("abcdef");

    expect(helpers.normalizeEvidenceRefs([
      " a ",
      { evidenceId: "b" },
      { id: "c" },
      { ref: "d" }
    ], {
      evidenceRefs: ["b"],
      sourceEvidenceId: "e"
    })).toEqual(["a", "b", "c", "d", "e"]);

    expect(helpers.submissionSummary("claim", { claim: "  keep me  " })).toBe("keep me");
    expect(helpers.submissionSummary("claim", { summary: " summary text " })).toBe("summary text");
    expect(helpers.submissionSummary("claim", {})).toBe("claim");

    expect(helpers.splitPatchTextLines("a\r\nb\r\n")).toEqual({ lines: ["a", "b"], finalNewline: true });
    expect(helpers.parseUnifiedPatch("@@ -1,2 +1,2 @@\n-a\n+b\n")).toEqual([
      {
        oldStart: 1,
        lines: ["-a", "+b"]
      }
    ]);
    expect(() => helpers.parseUnifiedPatch("not-a-patch")).toThrow("patch 必须包含至少一个 unified diff hunk。");
    expect(helpers.applyUnifiedPatchText("a\nb\n", "@@ -1,2 +1,2 @@\n a\n-b\n+c\n")).toBe("a\nc\n");
    expect(helpers.applyUnifiedPatchText("a\nb", "@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file\n")).toBe("a\nb");
    expect(() => helpers.applyUnifiedPatchText("a\nb\n", "@@ -1,1 +1,1 @@\n-x\n+y\n")).toThrow("patch hunk 与当前文件不匹配：第 1 行。");
    expect(() => helpers.applyUnifiedPatchText("a\nb\n", "@@ -1,1 +1,1 @@\n-a\n+b\n@@ -1,1 +1,1 @@\n-b\n+c\n")).toThrow("patch hunk 顺序重叠或倒退。");

    expect(helpers.applyReplacementHunks("alpha beta", [
      { oldText: "alpha", newText: "ALPHA" }
    ])).toBe("ALPHA beta");
    expect(helpers.applyReplacementHunks("alpha alpha", [
      { oldText: "alpha", newText: "beta", replaceAll: true }
    ])).toBe("beta beta");
    expect(() => helpers.applyReplacementHunks("alpha", [{ newText: "beta" }])).toThrow("replacement hunk 必须提供 oldText/search。");
    expect(() => helpers.applyReplacementHunks("alpha", [{ oldText: "zzz", newText: "beta" }])).toThrow("replacement hunk 与当前文件不匹配。");
    expect(() => helpers.applyReplacementHunks("alpha", [{ oldText: "alpha", newText: "alpha", replaceAll: true }])).toThrow("没有可应用的 replacement hunk。");

    expect(helpers.compactWorkspaceLayer({
      workspaceId: "ws-1",
      ownerUserId: "owner",
      title: "Workspace",
      objective: "Long objective ".repeat(40),
      status: "active",
      parentWorkspaceId: "",
      profile: { mode: "test" },
      ownedSourceIds: ["s1"],
      accessibleWorkspaceIds: ["w2"],
      currentGeneration: 7,
      updatedAt: "2026-06-05T00:00:00.000Z"
    })).toMatchObject({
      ownerUserId: "owner",
      parentWorkspaceId: null,
      currentGeneration: 7
    });

    expect(helpers.compactRun({
      runId: "run-1",
      runType: "analysis",
      status: "done",
      degraded: 1,
      artifactIds: ["a1"],
      error: "error".repeat(120),
      startedAt: "start",
      completedAt: "done",
      updatedAt: "updated"
    })).toMatchObject({
      degraded: true,
      artifactIds: ["a1"],
      startedAt: "start"
    });

    expect(helpers.compactSubmission({
      submissionId: "sub-1",
      runId: "run-1",
      agentId: "agent-1",
      type: "claim",
      status: "accepted",
      confidence: 0.9,
      payload: { claim: "claim text" },
      evidenceRefs: ["ev-1"],
      gate: { reasons: ["ok"] },
      updatedAt: "updated"
    })).toMatchObject({
      summary: "claim text",
      gateReasons: ["ok"]
    });

    expect(helpers.compactArtifact({
      artifactId: "art-1",
      runId: "run-1",
      level: "Artifact",
      title: "Artifact title",
      status: "draft",
      revision: "2",
      content: "content text",
      citations: ["cite"],
      coverageReport: { foo: true },
      updatedAt: "updated"
    }, { contentPreviewChars: 10 })).toMatchObject({
      revision: 2,
      coverageKeys: ["foo"]
    });

    expect(helpers.compactIssue({
      issueId: "issue-1",
      runId: "run-1",
      type: "bug",
      status: "open",
      severity: "high",
      title: "Issue title",
      evidenceRefs: ["ev-1"],
      updatedAt: "updated"
    })).toMatchObject({
      severity: "high",
      evidenceRefs: ["ev-1"]
    });

    expect(helpers.compactDecision({
      decisionId: "decision-1",
      runId: "run-1",
      status: "pending",
      title: "Decision",
      payload: { a: 1, b: 2 },
      updatedAt: "updated"
    })).toMatchObject({
      payloadKeys: ["a", "b"]
    });

    expect(helpers.compactPrivateState({
      id: "private-1",
      runId: "run-1",
      agentId: "agent-1",
      summary: " private summary ",
      state: { a: true, b: true },
      updatedAt: "updated"
    })).toMatchObject({
      summary: "private summary",
      stateKeys: ["a", "b"]
    });

    expect(helpers.compactSessionEvent({
      eventId: "event-1",
      sequence: "4",
      type: "session_event",
      title: "Event title",
      summary: "summary text",
      createdBy: "agent-1",
      createdAt: "created"
    })).toMatchObject({
      sequence: 4,
      createdBy: "agent-1"
    });

    const markdown = helpers.buildWorkspaceHandoffMarkdown({
      workspace: { workspaceId: "ws-1" },
      context: {
        currentGeneration: 3,
        contextFingerprint: "fingerprint",
        contextProfileId: "profile",
        modelAlias: "model",
        toolGrantId: "grant",
        knowledgeSourceIds: ["k1", "k2"],
        chainGenerations: [{ workspaceId: "root", generation: 1 }]
      },
      summary: {
        runCount: 2,
        submissionCount: 3,
        acceptedSubmissionCount: 1,
        openIssueCount: 1,
        artifactCount: 4
      },
      recent: {
        runs: [{ runId: "run-1", runType: "analysis", status: "done" }],
        artifacts: [{ artifactId: "art-1", status: "draft", title: "Artifact" }],
        issues: [
          { issueId: "issue-1", status: "open", severity: "high", title: "Open issue" },
          { issueId: "issue-2", status: "resolved", severity: "low", title: "Resolved issue" }
        ]
      }
    });
    expect(markdown).toContain("workspaceId: ws-1");
    expect(markdown).toContain("chain: root@1");
    expect(markdown).toContain("- issue-1 high Open issue");
    expect(markdown).not.toContain("issue-2");
  });

  it("covers context bundle decoding, hydration, file metadata, and gate decisions", async () => {
    const helpers = await modulePromise;
    const bundle = {
      bundleVersion: "v0.0.1:workspace:context-bundle-1",
      context: {
        workspaceId: "ws-1"
      }
    };
    const compressedPayload = gzipSync(Buffer.from(JSON.stringify(bundle), "utf8")).toString("base64");

    expect(helpers.decodeWorkspaceContextBundle({
      contextBundle: {
        bundle
      }
    })).toBe(bundle);

    expect(helpers.decodeWorkspaceContextBundle({
      bundleVersion: "v0.0.1:workspace:context-bundle-1",
      context: { workspaceId: "ws-1" }
    })).toMatchObject({ context: { workspaceId: "ws-1" } });

    expect(helpers.decodeWorkspaceContextBundle({
      compressed: {
        encoding: "gzip+base64",
        payload: compressedPayload
      }
    })).toMatchObject({ context: { workspaceId: "ws-1" } });

    expect(() => helpers.decodeWorkspaceContextBundle({
      compressed: {
        encoding: "brotli",
        payload: "abc"
      }
    })).toThrow("工作空间上下文压缩包编码不受支持。");
    expect(() => helpers.decodeWorkspaceContextBundle({
      compressed: {
        encoding: "gzip+base64",
        payload: ""
      }
    })).toThrow("缺少工作空间上下文压缩包。");

    expect(helpers.hydrateWorkspace(null)).toBeNull();
    expect(helpers.hydrateWorkspace({
      workspace_id: "ws-1",
      title: "Workspace",
      objective: "Objective",
      status: "active",
      owner_user_id: "owner",
      metadata_json: "{\"key\":true}",
      created_at: "created",
      updated_at: "updated",
      parent_workspace_id: "",
      profile_json: "{\"profile\":1}",
      owned_source_ids_json: "[\"s1\"]",
      accessible_workspace_ids_json: "[\"w2\"]",
      current_generation: 4,
      fs_path: "/tmp/ws"
    })).toMatchObject({
      workspaceId: "ws-1",
      metadata: { key: true },
      ownedSourceIds: ["s1"],
      accessibleWorkspaceIds: ["w2"],
      currentGeneration: 4
    });

    expect(helpers.hydrateRun(null)).toBeNull();
    expect(helpers.hydrateRun({
      run_id: "run-1",
      workspace_id: "ws-1",
      run_type: "analysis",
      status: "done",
      input_json: "{\"x\":1}",
      steps_json: "[{\"step\":1}]",
      coverage_json: "{\"cov\":true}",
      artifact_ids_json: "[\"a1\"]",
      error: "none",
      degraded: 1,
      created_at: "created",
      updated_at: "updated",
      started_at: "started",
      completed_at: "completed"
    }, { includeDetails: false })).toMatchObject({
      steps: [],
      coverage: {},
      artifactIds: ["a1"],
      degraded: true
    });

    expect(helpers.hydrateSubmission(null)).toBeNull();
    expect(helpers.hydrateSubmission({
      submission_id: "sub-1",
      workspace_id: "ws-1",
      run_id: "run-1",
      agent_id: "agent-1",
      type: "claim",
      status: "accepted",
      confidence: 0.95,
      payload_json: "{\"claim\":\"text\"}",
      evidence_refs_json: "[\"e1\"]",
      gate_json: "{\"reasons\":[\"ok\"]}",
      created_at: "created",
      updated_at: "updated"
    })).toMatchObject({
      payload: { claim: "text" },
      evidenceRefs: ["e1"],
      gate: { reasons: ["ok"] }
    });

    expect(helpers.hydratePrivateState(null)).toBeNull();
    expect(helpers.hydratePrivateState({
      id: "private-1",
      workspace_id: "ws-1",
      run_id: "run-1",
      agent_id: "agent-1",
      summary: "summary",
      state_json: "{\"a\":1}",
      updated_at: "updated"
    })).toMatchObject({
      state: { a: 1 }
    });

    expect(helpers.hydrateArtifact(null)).toBeNull();
    expect(helpers.hydrateArtifact({
      artifact_id: "art-1",
      workspace_id: "ws-1",
      run_id: "run-1",
      level: "Artifact",
      title: "Artifact",
      content: "body",
      citations_json: "[\"c1\"]",
      coverage_json: "{\"branch\":true}",
      revision: 2,
      status: "draft",
      created_by: "agent-1",
      created_at: "created",
      updated_at: "updated"
    })).toMatchObject({
      citations: ["c1"],
      coverageReport: { branch: true },
      revision: 2
    });

    expect(helpers.hydrateIssue(null)).toBeNull();
    expect(helpers.hydrateIssue({
      issue_id: "issue-1",
      workspace_id: "ws-1",
      run_id: "run-1",
      type: "bug",
      status: "open",
      severity: "high",
      title: "Issue",
      payload_json: "{\"x\":1}",
      evidence_refs_json: "[\"e1\"]",
      created_by: "agent-1",
      created_at: "created",
      updated_at: "updated"
    })).toMatchObject({
      payload: { x: 1 },
      evidenceRefs: ["e1"]
    });

    expect(helpers.hydrateDecision(null)).toBeNull();
    expect(helpers.hydrateDecision({
      decision_id: "decision-1",
      workspace_id: "ws-1",
      run_id: "run-1",
      status: "pending",
      title: "Decision",
      payload_json: "{\"a\":1}",
      created_by: "agent-1",
      created_at: "created",
      updated_at: "updated"
    })).toMatchObject({
      payload: { a: 1 }
    });

    expect(helpers.hydrateLock(null)).toBeNull();
    expect(helpers.hydrateLock({
      lock_id: "lock-1",
      workspace_id: "ws-1",
      target_type: "artifact",
      target_id: "artifact-1",
      owner_agent_id: "agent-1",
      expires_at: "later",
      created_at: "created"
    })).toMatchObject({
      lockId: "lock-1",
      targetId: "artifact-1"
    });

    expect(helpers.hydrateSession(null)).toBeNull();
    expect(helpers.hydrateSession({
      session_id: "session-1",
      workspace_id: "ws-1",
      title: "Session",
      objective: "Objective",
      status: "",
      parent_session_id: "",
      forked_from_event_id: "",
      branch_index: 2,
      lineage_json: "[\"ws-root\"]",
      context_json: "{\"profile\":1}",
      metadata_json: "{\"appendOnly\":true}",
      created_by: "agent-1",
      created_at: "created",
      updated_at: "updated",
      last_event_id: "",
      event_count: 5,
      append_only: 0
    })).toMatchObject({
      status: "active",
      branchIndex: 2,
      appendOnly: false,
      lineage: ["ws-root"],
      metadata: { appendOnly: true }
    });

    expect(helpers.hydrateSessionEvent(null)).toBeNull();
    expect(helpers.hydrateSessionEvent({
      event_id: "event-1",
      session_id: "session-1",
      workspace_id: "ws-1",
      parent_event_id: "",
      event_type: "note",
      title: "",
      summary: "",
      payload_json: "{\"note\":true}",
      created_by: "agent-1",
      created_at: "created",
      sequence: 3
    })).toMatchObject({
      sequence: 3,
      payload: { note: true }
    });

    const metadataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-metadata-"));
    const metadataFile = path.join(metadataRoot, "readme.md");
    await fs.writeFile(metadataFile, "hello world", "utf8");

    const fileStat = {
      isFile: () => true,
      isDirectory: () => false,
      birthtime: new Date("2026-06-05T00:00:00.000Z"),
      mtime: new Date("2026-06-05T01:00:00.000Z"),
      size: 11
    };
    const dirStat = {
      isFile: () => false,
      isDirectory: () => true,
      birthtime: new Date("2026-06-05T00:00:00.000Z"),
      mtime: new Date("2026-06-05T01:00:00.000Z"),
      size: 99
    };

    expect(helpers.fileMetadataFromStat({
      workspaceId: "ws-1",
      relativePath: "docs/readme.md",
      absolutePath: metadataFile,
      stat: fileStat,
      includeHash: true
    })).toMatchObject({
      type: "file",
      sizeBytes: 11,
      contentSha256: sha256("hello world")
    });
    expect(helpers.fileMetadataFromStat({
      workspaceId: "ws-1",
      relativePath: "docs",
      absolutePath: "/tmp/docs",
      stat: dirStat,
      includeHash: true
    })).toMatchObject({
      type: "directory",
      sizeBytes: 0,
      contentSha256: ""
    });

    expect(helpers.gateSubmission({
      submission: { type: "claim", payload: {}, confidence: 0.1, evidenceRefs: [] }
    })).toMatchObject({
      status: "needs_review",
      reasons: expect.arrayContaining(["missing_evidence", "low_confidence"])
    });

    expect(helpers.gateSubmission({
      submission: { type: "evidenceRef", payload: {}, evidenceRefs: ["ev-1"], confidence: 0.8 }
    })).toMatchObject({
      status: "accepted",
      acceptedByGate: true
    });

    expect(helpers.gateSubmission({
      submission: { type: "artifact", payload: {} }
    })).toMatchObject({
      status: "accepted"
    });

    expect(helpers.gateSubmission({
      submission: { type: "canonicalChange", payload: {} }
    })).toMatchObject({
      status: "needs_review",
      reviewedRequired: true,
      reasons: ["canonical_change_requires_review"]
    });

    expect(helpers.gateSubmission({
      submission: { type: "issue", payload: {} }
    })).toMatchObject({
      status: "proposed"
    });

    expect(helpers.gateSubmission({
      submission: { type: "decisionProposal", payload: {} }
    })).toMatchObject({
      status: "proposed"
    });

    expect(helpers.gateSubmission({
      existingDuplicate: { submission_id: "sub-dup" },
      submission: { type: "evidenceRef", payload: {}, evidenceRefs: ["ev-1"] }
    })).toMatchObject({
      status: "rejected",
      duplicateOf: "sub-dup"
    });

    expect(helpers.gateSubmission({
      submission: { type: "claim", payload: {}, evidenceRefs: ["ev-1"] },
      writePolicy: { allowedTypes: ["artifact"] }
    })).toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["role_not_allowed"])
    });

    expect(helpers.gateSubmission({
      submission: { type: "totally-unknown", payload: {} }
    })).toMatchObject({
      status: "rejected",
      reasons: ["unsupported_type"]
    });

    await fs.rm(metadataRoot, { recursive: true, force: true });
  });
});

describeWithVmModuleSupport("agent workspace public API branches", () => {
  it("covers workspace, file, local-directory, and session error paths", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Focused Workspace" }).workspace;
      const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-source-"));
      const hiddenSource = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-hidden-"));
      const symlinkRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-symlink-"));
      const folderPath = path.join(workspace.fsPath, "docs");

      try {
        await fs.writeFile(path.join(workspace.fsPath, "existing.txt"), "body", "utf8");
        await fs.mkdir(folderPath, { recursive: true });
        await fs.writeFile(path.join(hiddenSource, ".secret"), "hidden", "utf8");

        expect(await runtime.createWorkspaceFolder({
          workspaceId: workspace.workspaceId,
          folderPath: "existing.txt"
        })).toMatchObject({
          ok: false,
          status: 409,
          error: "目标路径已存在且不是文件夹。"
        });

        expect(await runtime.listWorkspaceFiles({
          workspaceId: workspace.workspaceId,
          folderPath: "missing-folder"
        })).toMatchObject({
          ok: true,
          exists: false
        });

        expect(await runtime.workspaceFileMetadata({
          workspaceId: workspace.workspaceId,
          path: "missing.txt"
        })).toMatchObject({
          ok: true,
          exists: false
        });

        expect(await runtime.uploadWorkspaceFile({
          workspaceId: workspace.workspaceId,
          content: "body"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "fileName 不能为空。"
        });

        expect(await runtime.writeWorkspaceFile({
          workspaceId: workspace.workspaceId,
          content: "body"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "path 不能为空。"
        });

        const noChangePatch = await runtime.patchWorkspaceFile({
          workspaceId: workspace.workspaceId,
          path: "existing.txt",
          expectedSha256: sha256("body"),
          hunks: [
            { oldText: "body", newText: "body" }
          ]
        });
        expect(noChangePatch).toMatchObject({
          ok: false,
          status: 409,
          error: "patch 未改变文件内容。"
        });

        expect(await runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          path: "missing"
        })).toMatchObject({
          ok: true,
          exists: false
        });

        expect(await runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: "",
          targetPath: "local"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "sourcePath 不能为空。"
        });

        await fs.writeFile(path.join(sourceRoot, "visible.txt"), "visible", "utf8");
        const activeMount = await runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "local",
          createdBy: "agent-1"
        });
        expect(activeMount).toMatchObject({
          ok: true,
          mount: {
            status: "active"
          }
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: hiddenSource,
          targetPath: "local"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许同步以 . 开头的路径：.secret"
        });

        await fs.writeFile(path.join(sourceRoot, ".hidden.txt"), "hidden", "utf8");
        const symlinkOnlyMount = await runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: symlinkRoot,
          targetPath: "symlinked"
        });
        await fs.writeFile(path.join(symlinkRoot, "target.txt"), "target", "utf8");
        await fs.symlink(path.join(symlinkRoot, "target.txt"), path.join(symlinkRoot, "link.txt"));
        expect(await runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          mountRef: symlinkOnlyMount.mount.mountRef,
          path: ""
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许列出符号链接：link.txt"
        });

        const session = runtime.createSession({
          workspaceId: workspace.workspaceId,
          title: "Focused session",
          objective: "Session objective",
          initialEvent: false
        }).session;
        const event = runtime.appendSessionEvent({
          sessionId: session.sessionId,
          workspaceId: workspace.workspaceId,
          title: "first event",
          summary: "event summary",
          type: "note"
        }).event;

        expect(runtime.getSession({
          sessionId: session.sessionId,
          includeEvents: false
        })).toMatchObject({
          session: {
            sessionId: session.sessionId
          },
          events: []
        });

        expect(runtime.forkSession({
          sessionId: session.sessionId,
          fromEventId: "other-session-event"
        })).toMatchObject({
          ok: false,
          error: "分叉事件不属于该会话"
        });

        expect(runtime.compareSessions({
          leftSessionId: session.sessionId,
          rightSessionId: "missing-session"
        })).toMatchObject({
          ok: false,
          error: "会话不存在"
        });

        expect(runtime.archiveSession({
          sessionId: "missing-session"
        })).toMatchObject({
          ok: false,
          error: "会话不存在"
        });

        const listByWorkspace = runtime.listSessions({
          workspaceId: workspace.workspaceId,
          includeLastEvent: false
        });
        expect(listByWorkspace.count).toBeGreaterThanOrEqual(1);
        expect(listByWorkspace.sessions.some((item) => item.sessionId === session.sessionId)).toBe(true);
        expect(listByWorkspace.sessions.find((item) => item.sessionId === session.sessionId).lastEvent).toBeNull();
        expect(event.type).toBe("note");

        const parent = runtime.createWorkspace({ title: "Parent" }).workspace;
        const child = runtime.createWorkspace({ title: "Child" }).workspace;
        const source = runtime.createWorkspace({ title: "Source" }).workspace;
        const target = runtime.createWorkspace({ title: "Target" }).workspace;

        expect(runtime.setWorkspaceParent("missing-child", parent.workspaceId)).toMatchObject({
          ok: false,
          error: "子工作空间不存在"
        });

        expect(runtime.setWorkspaceParent(child.workspaceId, "missing-parent")).toMatchObject({
          ok: false,
          error: "父工作空间不存在"
        });

        expect(runtime.setWorkspaceParent(child.workspaceId, child.workspaceId)).toMatchObject({
          ok: false,
          error: "设置会导致继承链循环"
        });

        expect(runtime.hotSwapProfile("missing-workspace", { contextProfileId: "profile" })).toMatchObject({
          ok: false,
          error: "工作空间不存在"
        });

        expect(runtime.setOwnedSourceIds("missing-workspace", ["s1"])).toMatchObject({
          ok: false,
          error: "工作空间不存在"
        });

        expect(runtime.shareWorkspace("missing-source", target.workspaceId)).toMatchObject({
          ok: false,
          error: "来源工作空间不存在"
        });

        expect(runtime.shareWorkspace(source.workspaceId, "missing-target")).toMatchObject({
          ok: false,
          error: "目标工作空间不存在"
        });

        expect(runtime.shareWorkspace(source.workspaceId, source.workspaceId)).toMatchObject({
          ok: false,
          error: "不能共享给自身"
        });

        expect(runtime.unshareWorkspace(source.workspaceId, "missing-target")).toMatchObject({
          ok: false,
          error: "目标工作空间不存在"
        });

        const shared = runtime.shareWorkspace(source.workspaceId, target.workspaceId);
        expect(shared.ok).toBe(true);
        expect(runtime.unshareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({
          ok: true,
          wasShared: true
        });

        const deleteTarget = runtime.createWorkspace({ title: "Delete Target" }).workspace;
        await fs.writeFile(path.join(deleteTarget.fsPath, "remove.txt"), "remove", "utf8");
        expect(runtime.deleteWorkspace(deleteTarget.workspaceId, { deleteFolder: true })).toMatchObject({
          ok: true,
          deleted: true
        });
        expect(await fs.access(deleteTarget.fsPath).then(() => true).catch(() => false)).toBe(false);
      } finally {
        await fs.rm(sourceRoot, { recursive: true, force: true });
        await fs.rm(hiddenSource, { recursive: true, force: true });
        await fs.rm(symlinkRoot, { recursive: true, force: true });
      }
    });
  });

  it("covers access denied and missing-folder branches", async () => {
    const helpers = await modulePromise;
    helpers.__setAgentWorkspaceTestHooks({
      canAccessWorkspace(workspace, input = {}) {
        const deniedIds = new Set([
          input.denyWorkspaceId,
          input.denySourceId,
          input.denyTargetId,
          input.denyParentId
        ].filter(Boolean));
        return Boolean(workspace && !deniedIds.has(workspace.workspaceId));
      }
    });

    try {
      await withWorkspaceRuntime(async (runtime) => {
        const parent = runtime.createWorkspace({ title: "Parent" }).workspace;
        const child = runtime.createWorkspace({ title: "Child" }).workspace;
        const source = runtime.createWorkspace({ title: "Source" }).workspace;
        const target = runtime.createWorkspace({ title: "Target" }).workspace;

        expect(runtime.setWorkspaceParent(child.workspaceId, parent.workspaceId, {
          denyWorkspaceId: child.workspaceId
        })).toMatchObject({
          ok: false,
          error: "工作空间不可访问"
        });

        expect(runtime.setWorkspaceParent(child.workspaceId, parent.workspaceId, {
          denyParentId: parent.workspaceId
        })).toMatchObject({
          ok: false,
          error: "父工作空间不可访问"
        });

        expect(runtime.hotSwapProfile(source.workspaceId, { contextProfileId: "profile" }, {
          denyWorkspaceId: source.workspaceId
        })).toMatchObject({
          ok: false,
          error: "工作空间不可访问"
        });

        expect(runtime.setOwnedSourceIds(target.workspaceId, ["s1"], {
          denyWorkspaceId: target.workspaceId
        })).toMatchObject({
          ok: false,
          error: "工作空间不可访问"
        });

        expect(runtime.shareWorkspace(source.workspaceId, target.workspaceId, {
          denySourceId: source.workspaceId
        })).toMatchObject({
          ok: false,
          error: "工作空间不可访问"
        });

        expect(runtime.unshareWorkspace(source.workspaceId, target.workspaceId, {
          denyTargetId: target.workspaceId
        })).toMatchObject({
          ok: false,
          error: "工作空间不可访问"
        });

        const deleteTarget = runtime.createWorkspace({ title: "Delete Missing Folder" }).workspace;
        await fs.rm(deleteTarget.fsPath, { recursive: true, force: true });
        expect(runtime.deleteWorkspace(deleteTarget.workspaceId, { deleteFolder: true })).toMatchObject({
          ok: true,
          deleted: true
        });
      });
    } finally {
      helpers.__resetAgentWorkspaceTestHooks();
    }
  });
});
