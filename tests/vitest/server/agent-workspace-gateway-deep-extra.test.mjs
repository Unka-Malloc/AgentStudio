import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SESSION_THREAD_VERSION,
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";
import {
  buildAgentGatewayPayload,
  callAgentGateway,
  createAgentStreamAccumulator,
  inspectAgentModelRouting,
  parseAgentGatewayStreamText,
  parseDeepSeekStreamText,
  publicAgentGatewayConfig,
  publicAgentGatewayRegistry,
  resolveAgentGatewayConfig,
  resolveAgentGatewayRegistry
} from "../../../server/platform/specialized/agent/agent-gateway/index.mjs";
import {
  buildMessageGraph,
  chooseCompactionCutPoint,
  computeCompactionBudget,
  CONTEXT_COMPACTION_PROTOCOL_VERSION,
  createContextCompactionRuntime,
  createContextCompactionStrategyAdapter,
  estimateContextTokens,
  listContextCompactionStrategies,
  normalizeCompactionPolicy,
  redactCompactionValue
} from "../../../server/platform/specialized/agent/agent-context/interface/index.mjs";
import {
  AGENT_MEMORY_PROTOCOL_VERSION,
  createAgentMemory,
  redactAgentMemoryValue
} from "../../../server/platform/specialized/agent/agent-memory/index.mjs";

const runModelRoutingMock = vi.hoisted(() => vi.fn());
const inspectModelRoutingMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs");
  return {
    ...actual,
    runModelRouting: (...args) => runModelRoutingMock(...args),
    inspectModelRouting: (...args) => inspectModelRoutingMock(...args)
  };
});

const tempRoots = [];

afterEach(async () => {
  vi.clearAllMocks();
  while (tempRoots.length) {
    const root = tempRoots.pop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function withWorkspaceRuntime(fn) {
  const root = await tempDir("pact-agent-workspace-deep-");
  const runtime = createAgentWorkspace({ userDataPath: root });
  try {
    return await fn(runtime, root);
  } finally {
    runtime.close();
  }
}

async function withContextRuntime(fn, options = {}) {
  const root = await tempDir("pact-context-compact-deep-");
  const memory = options.agentMemory || createAgentMemory({ userDataPath: root });
  const runtime = createContextCompactionRuntime({
    userDataPath: root,
    agentMemory: memory,
    modelCompressor: options.modelCompressor || null
  });
  try {
    return await fn(runtime, root, memory);
  } finally {
    if (typeof runtime.agentMemory?.close === "function") {
      runtime.agentMemory.close();
    }
  }
}

function jsonResponse(body, {
  ok = true,
  status = 200,
  contentType = "application/json; charset=utf-8"
} = {}) {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    headers: {
      get(key) {
        return String(key || "").toLowerCase() === "content-type" ? contentType : "";
      }
    },
    text: async () => bodyText
  };
}

function textResponse(bodyText, {
  ok = true,
  status = 200,
  contentType = "text/plain; charset=utf-8"
} = {}) {
  return {
    ok,
    status,
    headers: {
      get(key) {
        return String(key || "").toLowerCase() === "content-type" ? contentType : "";
      }
    },
    text: async () => bodyText
  };
}

function compactProfile(patch = {}) {
  return {
    profileId: "unit-compact",
    contextWindowTokens: 4096,
    outputReserveTokens: 256,
    modelCompression: {
      enabled: true,
      alias: "compact-model"
    },
    compactionPolicy: {
      strategy: {
        id: "workbench-reconstruction",
        params: { preserveFacts: true }
      },
      summaryReserveTokens: 512,
      reservedBufferTokens: 512,
      warningBufferTokens: 900,
      recentMessageProtectionCount: 2,
      recentTurnProtectionCount: 1,
      deterministicTargetRatio: 0.3,
      maxToolResultTokens: 90,
      maxAttachmentTokens: 80,
      reinjectionBudgetTokens: 220,
      persistSessionMemory: true,
      ...patch.compactionPolicy
    },
    ...patch
  };
}

function sampleMessages() {
  return [
    {
      id: "m1",
      role: "user",
      apiRoundId: "round-1",
      content: "Keep evidence:ev-critical and token=abc123 out of the transcript."
    },
    {
      id: "m2",
      role: "assistant",
      apiRoundId: "round-1",
      content: "Acknowledged.",
      toolCalls: [{ id: "tool-1", name: "knowledge.search" }]
    },
    {
      id: "m3",
      role: "tool",
      apiRoundId: "round-1",
      toolUseId: "tool-1",
      content: "tool-result ".repeat(120)
    },
    {
      id: "m4",
      role: "user",
      apiRoundId: "round-2",
      content: "Next turn with attachment and /Users/unka/private/file.md.",
      attachments: [
        {
          name: "huge-log.txt",
          text: "RAW_ATTACHMENT_PAYLOAD ".repeat(90)
        }
      ]
    }
  ];
}

describe("agent workspace deep coverage", () => {
  it("covers create/list/session/file/submission/lock/share/profile/context paths", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({
        title: " Source Workspace ",
        ownerUserId: "owner-1",
        defaultAdminUserId: "admin-1",
        metadata: {
          administrators: ["ops-1"]
        }
      }).workspace;
      const target = runtime.createWorkspace({ title: "Target Workspace" }).workspace;
      const child = runtime.createWorkspace({ title: "Child Workspace" }).workspace;
      const archived = runtime.createWorkspace({ title: "Archived Workspace", status: "archived" }).workspace;

      const workspaces = runtime.listWorkspaces({ status: "active", includeSummary: false });
      expect(workspaces.protocolVersion).toBe(runtime.protocolVersion);
      expect(workspaces.workspaces.map((workspace) => workspace.workspaceId)).toEqual(
        expect.arrayContaining([source.workspaceId, target.workspaceId, child.workspaceId])
      );
      expect(workspaces.workspaces.find((workspace) => workspace.workspaceId === source.workspaceId).summary).toBeUndefined();
      expect(runtime.listWorkspaces({ status: "archived" }).workspaces[0].workspaceId).toBe(archived.workspaceId);

      const sessionWithEvent = runtime.createSession({
        workspaceId: source.workspaceId,
        title: "Kickoff Session",
        objective: "Plan the next step",
        context: {
          contextProfileId: "session-profile",
          knowledgeSourceIds: ["session-source-1"]
        }
      });
      expect(sessionWithEvent.ok).toBe(true);
      expect(sessionWithEvent.event).toMatchObject({
        type: "session_created",
        summary: "Plan the next step"
      });

      const sessionWithoutEvent = runtime.createSession({
        workspaceId: source.workspaceId,
        title: "Seed Session",
        objective: "Silent seed",
        initialEvent: false
      });
      expect(sessionWithoutEvent.session).toMatchObject({
        title: "Seed Session",
        metadata: expect.objectContaining({ appendOnly: true })
      });
      expect(sessionWithoutEvent.event).toBeNull();

      expect(runtime.createSession({ workspaceId: "missing", title: "bad" })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });

      const sessionList = runtime.listSessions({
        workspaceId: source.workspaceId,
        includeLastEvent: true
      });
      expect(sessionList.protocolVersion).toBe(runtime.protocolVersion);
      expect(sessionList.sessionProtocolVersion).toBe(AGENT_SESSION_THREAD_VERSION);
      expect(sessionList.sessions.map((item) => item.sessionId)).toEqual(
        expect.arrayContaining([sessionWithEvent.session.sessionId, sessionWithoutEvent.session.sessionId])
      );

      const sessionDetail = runtime.getSession({
        sessionId: sessionWithEvent.session.sessionId,
        includeEvents: false
      });
      expect(sessionDetail.events).toEqual([]);
      expect(sessionDetail.workspace.workspaceId).toBe(source.workspaceId);
      expect(runtime.getSession("missing-session")).toBeNull();

      const forked = runtime.forkSession({
        sessionId: sessionWithEvent.session.sessionId,
        fromEventId: sessionWithEvent.event.eventId,
        title: "Forked Session"
      });
      expect(forked.ok).toBe(true);
      expect(forked.fork.copiedEventCount).toBeGreaterThan(0);
      expect(runtime.forkSession({
        sessionId: sessionWithEvent.session.sessionId,
        fromEventId: "missing-event"
      })).toMatchObject({
        ok: false,
        error: "分叉事件不属于该会话"
      });

      const comparison = runtime.compareSessions({
        leftSessionId: sessionWithEvent.session.sessionId,
        rightSessionId: forked.session.sessionId
      });
      expect(comparison.ok).toBe(true);
      expect(comparison.summary.commonEventCount).toBeGreaterThan(0);

      const mergeProposal = runtime.createSessionMergeProposal({
        targetSessionId: sessionWithEvent.session.sessionId,
        sourceSessionId: forked.session.sessionId,
        resolutionHints: { manual: true }
      });
      expect(mergeProposal.ok).toBe(true);
      expect(mergeProposal.proposal).toMatchObject({
        requiresDecision: true,
        autoMergeApplied: false
      });

      const archivedSession = runtime.archiveSession({ sessionId: sessionWithoutEvent.session.sessionId });
      expect(archivedSession.ok).toBe(true);
      expect(archivedSession.session.status).toBe("archived");

      await fs.mkdir(path.join(source.fsPath, "docs", "nested"), { recursive: true });
      await fs.writeFile(path.join(source.fsPath, "docs", "readme.md"), "hello", "utf8");
      await fs.writeFile(path.join(source.fsPath, "docs", "nested", "deep.md"), "deep", "utf8");
      await fs.writeFile(path.join(source.fsPath, "note.txt"), "v1", "utf8");

      const listing = await runtime.listWorkspaceFiles({
        workspaceId: source.workspaceId,
        folderPath: "docs",
        recursive: true,
        includeHash: true
      });
      expect(listing.ok).toBe(true);
      expect(listing.paths).toEqual(expect.arrayContaining(["docs/readme.md", "docs/nested/deep.md"]));

      const metadata = await runtime.workspaceFileMetadata({
        workspaceId: source.workspaceId,
        path: "docs/readme.md",
        includeHash: true
      });
      expect(metadata).toMatchObject({
        ok: true,
        exists: true,
        file: {
          type: "file",
          relativePath: "docs/readme.md"
        }
      });

      expect(await runtime.downloadWorkspaceFile({
        workspaceId: source.workspaceId,
        path: "docs"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "目标路径不是文件。"
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: source.workspaceId,
        path: "",
        content: "new"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "path 不能为空。"
      });

      const patched = await runtime.patchWorkspaceFile({
        workspaceId: source.workspaceId,
        path: "note.txt",
        expectedSha256: sha256("v1"),
        hunks: [{ oldText: "v1", newText: "v2" }]
      });
      expect(patched).toMatchObject({
        ok: true,
        patched: true,
        beforeSha256: sha256("v1")
      });
      expect(await fs.readFile(path.join(source.fsPath, "note.txt"), "utf8")).toBe("v2");

      expect(await runtime.patchWorkspaceFile({
        workspaceId: source.workspaceId,
        path: "note.txt",
        expectedSha256: "0".repeat(64),
        hunks: [{ oldText: "v2", newText: "v3" }]
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "文件内容与 expectedSha256 不匹配。"
      });

      expect(await runtime.moveWorkspaceFile({
        workspaceId: source.workspaceId,
        sourcePath: "note.txt",
        targetPath: "docs/readme.md"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "目标路径已存在。设置 overwrite: true 以覆盖。"
      });

      const missingEvidence = runtime.submit({
        workspaceId: source.workspaceId,
        type: "claim",
        payload: { claim: "needs evidence" }
      });
      expect(missingEvidence.submission.status).toBe("needs_review");
      expect(missingEvidence.submission.gate.reasons).toEqual(expect.arrayContaining(["missing_evidence", "low_confidence"]));

      const rejectedType = runtime.submit({
        workspaceId: source.workspaceId,
        type: "mystery",
        payload: { title: "mystery" }
      });
      expect(rejectedType.submission.status).toBe("rejected");
      expect(rejectedType.submission.gate.reasons).toContain("unsupported_type");

      const accepted = runtime.submit({
        workspaceId: source.workspaceId,
        type: "artifact",
        payload: { title: "artifact-1" }
      });
      expect(accepted.submission.status).toBe("accepted");
      const duplicated = runtime.submit({
        workspaceId: source.workspaceId,
        type: "artifact",
        payload: { title: "artifact-1" }
      });
      expect(duplicated.submission.status).toBe("rejected");
      expect(duplicated.submission.gate.reasons).toContain("duplicate_submission");

      const resolvedAccepted = runtime.resolveSubmission({
        submissionId: missingEvidence.submission.submissionId,
        workspaceId: source.workspaceId,
        action: "accept",
        reviewerId: "reviewer-1",
        note: "approved"
      });
      expect(resolvedAccepted.submission.status).toBe("accepted");
      expect(resolvedAccepted.submission.gate.resolutionNote).toBe("approved");

      const resolvedRejected = runtime.resolveSubmission({
        submissionId: rejectedType.submission.submissionId,
        workspaceId: source.workspaceId,
        status: "reject",
        agentId: "review-bot"
      });
      expect(resolvedRejected.submission.status).toBe("rejected");

      const locked = runtime.acquireLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      });
      expect(locked.ok).toBe(true);
      expect(runtime.acquireLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        error: "lock_held"
      });
      expect(runtime.releaseLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        error: "lock_owner_mismatch"
      });
      expect(runtime.adminReleaseLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: true,
        released: true
      });

      expect(runtime.shareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({
        ok: true
      });
      expect(runtime.shareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({
        ok: true,
        alreadyShared: true
      });
      expect(runtime.unshareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({
        ok: true,
        wasShared: true
      });
      expect(runtime.unshareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({
        ok: true,
        wasShared: false
      });
      expect(runtime.shareWorkspace(source.workspaceId, source.workspaceId)).toMatchObject({
        ok: false,
        error: "不能共享给自身"
      });

      expect(runtime.setWorkspaceParent(child.workspaceId, source.workspaceId)).toMatchObject({
        ok: true
      });
      expect(runtime.setWorkspaceParent(source.workspaceId, child.workspaceId)).toMatchObject({
        ok: false,
        error: "设置会导致继承链循环"
      });

      runtime.setOwnedSourceIds(source.workspaceId, ["source-owned"]);
      runtime.setOwnedSourceIds(child.workspaceId, ["child-owned"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "root-profile",
        toolGrantId: "grant-root",
        modelAlias: "root-model",
        knowledgeScope: {
          includeSourceIds: ["root-scope"],
          excludeSourceIds: ["blocked-root"]
        }
      });
      runtime.hotSwapProfile(child.workspaceId, {
        modelAlias: "child-model",
        knowledgeScope: {
          includeSourceIds: ["child-scope"],
          excludeSourceIds: ["blocked-child"]
        }
      });

      const context = runtime.getWorkspaceContext(child.workspaceId);
      expect(context).toMatchObject({
        protocolVersion: runtime.protocolVersion,
        workspaceId: child.workspaceId,
        contextProfileId: "root-profile",
        modelAlias: "child-model",
        knowledgeSourceIds: expect.arrayContaining(["source-owned", "child-owned", "root-scope", "child-scope"])
      });
      expect(context.contextFingerprint).toEqual(expect.any(String));

      const sessionContext = runtime.getSessionContext(sessionWithEvent.session.sessionId);
      expect(sessionContext).toMatchObject({
        sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
        sessionId: sessionWithEvent.session.sessionId,
        workspaceContext: expect.objectContaining({
          workspaceId: source.workspaceId
        }),
        sessionContext: expect.objectContaining({
          contextProfileId: "session-profile",
          knowledgeSourceIds: ["session-source-1"]
        }),
        contextProfileId: "session-profile",
        knowledgeSourceIds: ["session-source-1"]
      });

      const bundle = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: true,
        maxItems: 3,
        compress: true,
        actorUserId: "auditor"
      });
      expect(bundle).toMatchObject({
        protocolVersion: runtime.protocolVersion,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        compressed: expect.objectContaining({
          encoding: "gzip+base64"
        })
      });
      expect(bundle.bundle.inheritanceChain.map((item) => item.workspaceId)).toEqual(
        expect.arrayContaining([source.workspaceId])
      );

      const restoreFailed = runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        ...bundle,
        bundleHash: "deadbeef"
      }, {
        actorUserId: "auditor"
      });
      expect(restoreFailed).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包 hash 校验失败。"
      });

      const restored = runtime.restoreWorkspaceContextBundle(target.workspaceId, bundle, {
        actorUserId: "auditor"
      });
      expect(restored).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        bundleHash: bundle.bundleHash
      });
      expect(restored.restoredContext).toMatchObject({
        workspaceId: target.workspaceId
      });

      const workspaceView = runtime.getWorkspace({
        workspaceId: source.workspaceId,
        includeRuns: false,
        includeSubmissions: false,
        includeArtifacts: false,
        includeIssues: false,
        includeDecisions: false,
        includeLocks: false
      });
      expect(workspaceView.runs).toEqual([]);
      expect(workspaceView.submissions).toEqual([]);
      expect(workspaceView.artifacts).toEqual([]);
      expect(workspaceView.issues).toEqual([]);
      expect(workspaceView.decisions).toEqual([]);
      expect(workspaceView.locks).toEqual([]);
    });
  });

  it("returns consistent error surfaces for missing workspaces and forbidden access", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      expect(runtime.getWorkspace({ workspaceId: "missing" })).toBeNull();
      expect(runtime.getSession({ sessionId: "missing" })).toBeNull();
      await expect(runtime.createWorkspaceFolder({ workspaceId: "missing", folderPath: "docs" })).resolves.toMatchObject({
        ok: false,
        error: "工作空间不存在或不可访问。"
      });
      expect(runtime.submit({ workspaceId: "missing", type: "artifact", payload: {} })).toMatchObject({
        submission: expect.objectContaining({
          workspaceId: "missing",
          status: "accepted"
        })
      });
      expect(runtime.acquireLock({
        workspaceId: "missing",
        targetType: "artifact",
        targetId: "t1",
        ownerAgentId: "agent-1"
      })).toMatchObject({
        ok: false,
        error: "workspace_forbidden"
      });
      expect(runtime.listLocks({ workspaceId: "missing" })).toEqual([]);
    });
  });
});

describe("agent gateway routing and compaction", () => {
  it("normalizes registry/config, compacts input, and routes through model routing and direct calls", async () => {
    const settings = {
      customHttpAdapter: {
        uid: "unit-http",
        model: "gateway-lite",
        url: "https://agent.local/call",
        token: "token-1",
        tokenHeader: "x-token",
        tokenPrefix: "Bearer ",
        pluginList: "alpha,beta",
        parameters: { temperature: 0.3 },
        systemPrompt: "Unit prompt"
      },
      modelLibraryAgents: [
        {
          provider: "deepseek",
          alias: "deepseek-lib",
          model: "deepseek-v4-pro",
          baseUrl: "https://deepseek.example",
          apiKey: "deepseek-token",
          pluginList: "r1,r2"
        },
        {
          provider: "openrouter",
          alias: "openrouter-lib",
          model: "gpt-4o-mini",
          apiKey: "openrouter-token",
          baseUrl: "https://openrouter.example"
        },
        {
          provider: "local-model",
          alias: "local-lib",
          model: "local-1",
          token: "local-token",
          baseUrl: "http://localhost:11434/v1"
        }
      ],
      modelRouting: {
        enabled: true,
        fallbackChain: ["unit-http"],
        budget: { maxInputTokens: 2048 }
      },
      moduleAgentProfiles: {
        module_x: {
          agents: {
            "unit-http": {
              enabled: true,
              role: "primary",
              contextProfileId: "module-profile",
              systemPrompt: "Module prompt",
              parameters: { priority: 1 },
              dependencyContext: { source: "module-x" }
            }
          }
        }
      }
    };

    const registry = resolveAgentGatewayRegistry(settings);
    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: "unit-http", provider: "custom-http", model: "gateway-lite" }),
      expect.objectContaining({ alias: "deepseek-lib", provider: "deepseek" }),
      expect.objectContaining({ alias: "openrouter-lib", provider: "openrouter" }),
      expect.objectContaining({ alias: "local-lib", provider: "local-model" })
    ]));
    expect(publicAgentGatewayRegistry(settings)).toMatchObject({
      schemaVersion: 1,
      provider: "agent-gateway",
      defaultAlias: "unit-http"
    });
    expect(publicAgentGatewayConfig(settings)).toMatchObject({
      alias: "unit-http",
      token: "",
      urlConfigured: true,
      tokenConfigured: true
    });
    expect(resolveAgentGatewayConfig(settings, { provider: "openrouter" })).toMatchObject({
      provider: "openrouter",
      alias: "openrouter-lib"
    });
    expect(resolveAgentGatewayConfig(settings, { alias: "unknown", model: "deepseek" })).toMatchObject({
      provider: "custom-http",
      alias: "unknown"
    });
    expect(buildAgentGatewayPayload({
      question: "  你好  ",
      pluginList: ["user-a"],
      sessionId: "  session-1  ",
      userId: "user-1",
      projectId: "p-1",
      parameters: { temperature: 0.2 },
      workspaceContext: {
        workspaceId: "workspace-1",
        currentGeneration: "12",
        contextFingerprint: "fp",
        modelAlias: "alias"
      }
    }, settings)).toMatchObject({
      question: "你好",
      sessionId: "session-1",
      engine: "gateway-lite",
      workspaceContext: {
        workspaceId: "workspace-1",
        currentGeneration: 12
      }
    });

    const accumulated = createAgentStreamAccumulator();
    accumulated.push({ type: "text", data: { content: "前置文本" } });
    accumulated.push({ type: "answer", data: { content: "最终答案" } });
    accumulated.push({ type: "finish", data: {} });
    expect(accumulated.result()).toMatchObject({
      answer: "最终答案",
      text: "最终答案",
      finish: true
    });
    expect(parseAgentGatewayStreamText([
      "event: ping",
      'data: {"type":"text","data":{"content":"a"}}',
      'data: {"type":"answer","data":{"content":"b"}}',
      "data: [DONE]",
      "data: invalid-json"
    ].join("\n"))).toMatchObject({
      answer: "b",
      dialogId: ""
    });
    expect(parseDeepSeekStreamText([
      'data: {"id":"evt-deep","model":"deepseek-chat","choices":[{"index":0,"delta":{"reasoning_content":"思路:"}}]}',
      'data: {"id":"evt-deep","model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hello "}}]}',
      'data: {"id":"evt-deep","model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"world","tool_calls":[{"index":0,"id":"tool-1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"query\\"}"}}]}}]}',
      "data: [DONE]"
    ].join("\n"))).toMatchObject({
      answer: "Hello world",
      finish: true,
      toolCalls: [
        expect.objectContaining({
          id: "tool-1",
          function: expect.objectContaining({
            name: "lookup"
          })
        })
      ]
    });

    runModelRoutingMock.mockImplementation(async (routingInput) => {
      const dryRun = await routingInput.executeCandidate({
        input: {
          ...routingInput.input,
          question: "dry route",
          moduleId: "module_x"
        },
        dryRun: true
      });
      return {
        routing: {
          routeId: "route-1",
          chosenAlias: dryRun.config.alias
        },
        result: {
          ok: true,
          answer: "routed-by-model-routing",
          dialogId: "routing-dialog"
        }
      };
    });
    inspectModelRoutingMock.mockResolvedValue({
      protocolVersion: "pact.model-routing.v1",
      entries: [{ routeId: "route-1" }],
      count: 1
    });

    const compactionRuntime = {
      runCompaction: vi.fn(async (input) => ({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        status: "completed",
        compacted: true,
        strategy: "workbench-reconstruction",
        triggerReason: "force",
        degraded: false,
        degradedReasons: [],
        boundary: { boundaryId: "boundary-1" },
        summary: "Model summary",
        reinjection: {
          items: [{ key: "activePlan", value: { step: "keep" } }]
        },
        messagesToKeep: [
          { role: "system", content: "kept summary" },
          { role: "user", content: "kept question" }
        ],
        tokenReport: { savedTokens: 12 },
        input
      }))
    };

    const allocator = {
      apply: vi.fn(async (input) => ({
        input: {
          ...input,
          sessionId: "allocated-session"
        },
        allocation: {
          runtime: "shared",
          priority: 7
        }
      }))
    };

    const fetchCalls = [];
    const responseBody = {
      ok: true,
      answer: "gateway answer",
      dialogId: "dialog-1",
      finish: true,
      payload: { echoed: true }
    };
    const fetchImpl = vi.fn(async (url, request) => {
      fetchCalls.push({ url, request });
      return jsonResponse(responseBody);
    });

    const routed = await callAgentGateway({
      settings,
      input: {
        moduleId: "module_x",
        alias: "unit-http",
        question: "  需要压缩后再调用  ",
        sessionId: "session-1",
        userId: "user-1",
        projectId: "project-1",
        pluginList: ["cli"],
        parameters: { temperature: 0.2 },
        runtimeState: {
          activePlan: { step: "plan" },
          enabledTools: ["search"]
        },
        contextCompaction: {
          force: true,
          persist: true,
          useSessionMemory: true
        }
      },
      fetchImpl,
      contextRuntime: compactionRuntime,
      clientRuntimeAllocator: allocator
    });
    expect(allocator.apply).toHaveBeenCalled();
    expect(compactionRuntime.runCompaction).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "allocated-session",
      force: true,
      inputSource: "agent-gateway"
    }));
    expect(routed).toMatchObject({
      ok: true,
      answer: "routed-by-model-routing",
      contextCompaction: {
        compacted: true,
        boundaryId: "boundary-1",
        strategy: "workbench-reconstruction",
        tokenReport: { savedTokens: 12 }
      },
      clientRuntimeAllocation: {
        runtime: "shared",
        priority: 7
      }
    });
    expect(routed.modelRouting).toEqual({
      routeId: "route-1",
      chosenAlias: "unit-http"
    });

    const direct = await callAgentGateway({
      settings: {
        ...settings,
        modelRouting: undefined
      },
      input: {
        moduleId: "module_x",
        alias: "unit-http",
        question: "  需要压缩后再调用  ",
        sessionId: "session-1",
        userId: "user-1",
        projectId: "project-1",
        pluginList: ["cli"],
        parameters: { temperature: 0.2 },
        runtimeState: {
          activePlan: { step: "plan" },
          enabledTools: ["search"]
        },
        contextCompaction: {
          force: true,
          persist: true,
          useSessionMemory: true
        }
      },
      fetchImpl,
      contextRuntime: compactionRuntime,
      clientRuntimeAllocator: allocator
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://agent.local/call");
    const requestBody = JSON.parse(fetchCalls[0].request.body);
    expect(requestBody).toMatchObject({
      question: expect.stringContaining("Pact compacted prior context before this agent call."),
      contextProfileId: "module-profile",
      parameters: {
        temperature: 0.2,
        priority: 1
      }
    });
    expect(requestBody.systemPrompt).toContain("Module prompt");
    expect(direct).toMatchObject({
      ok: true,
      answer: "gateway answer",
      contextCompaction: {
        compacted: true,
        boundaryId: "boundary-1",
        strategy: "workbench-reconstruction",
        tokenReport: { savedTokens: 12 }
      },
      clientRuntimeAllocation: {
        runtime: "shared",
        priority: 7
      }
    });

    const routedResult = await inspectAgentModelRouting({ userDataPath: await tempDir("pact-routing-inspect-"), limit: 1 });
    expect(routedResult).toMatchObject({
      protocolVersion: "pact.model-routing.v1",
      count: 1
    });

    await expect(callAgentGateway({
      settings: {
        customHttpAdapter: {
          uid: "missing-url",
          model: "gateway-lite"
        }
      },
      input: {
        question: "still needs url"
      },
      fetchImpl: vi.fn()
    })).rejects.toThrow("智能体 URL 未配置：missing-url");

    await expect(callAgentGateway({
      settings: {
        modelLibraryAgents: [
          {
            provider: "deepseek",
            alias: "deepseek-lib",
            model: "deepseek-v4-pro",
            url: "https://deepseek.example"
          }
        ]
      },
      input: {
        provider: "deepseek",
        alias: "deepseek-lib",
        question: "hello"
      },
      fetchImpl: vi.fn()
    })).rejects.toThrow("DeepSeek API Key 未配置。");

    await expect(callAgentGateway({
      settings: {
        ...settings,
        modelRouting: undefined
      },
      input: {
        alias: "unit-http"
      },
      fetchImpl: vi.fn()
    })).rejects.toThrow("question 不能为空。");
  });
});

describe("context compaction and memory boundaries", () => {
  it("covers helper edges, strategy adapters, and session memory state transitions", async () => {
    expect(estimateContextTokens("abcd中文")).toBeGreaterThan(1);
    expect(redactCompactionValue({
      token: "secret-token",
      nested: {
        message: "Bearer abc.def and /Users/unka/private/file.txt"
      },
      buffer: Buffer.from("abc")
    })).toMatchObject({
      token: "<redacted>",
      nested: {
        message: expect.stringContaining("<redacted-secret>")
      },
      buffer: {
        redacted: true,
        reason: "buffer",
        byteLength: 3
      }
    });
    expect(normalizeCompactionPolicy({
      compression: {
        protectLastNTurns: 2,
        summaryMaxTokens: 700,
        targetRatio: 0.2
      },
      compactionPolicy: {
        enabled: false,
        strategy: {
          id: "custom-strategy",
          params: { preserve: true }
        },
        hardThresholdRatio: 2,
        recentMessageProtectionCount: -1
      }
    })).toMatchObject({
      enabled: false,
      strategyId: "custom-strategy",
      hardThresholdRatio: 1,
      recentMessageProtectionCount: 0,
      deterministicTargetRatio: 0.24
    });
    expect(computeCompactionBudget({
      contextWindowTokens: 4096,
      outputReserveTokens: 256,
      compactionPolicy: {
        summaryReserveTokens: 512,
        reservedBufferTokens: 512,
        warningBufferTokens: 900
      }
    })).toMatchObject({
      contextWindowTokens: 4096,
      outputReserveTokens: 256,
      summaryReserveTokens: 512,
      effectiveWindowTokens: 3328,
      autoCompactThresholdTokens: 2816
    });

    const graph = buildMessageGraph([
      { id: "m1", role: "user", apiRoundId: "round-1", content: "start" },
      { id: "m2", role: "assistant", apiRoundId: "round-1", content: "call", toolCalls: [{ id: "tool-1" }] },
      { id: "m3", role: "tool", apiRoundId: "round-1", toolUseId: "tool-1", content: "result" },
      { id: "m4", role: "user", apiRoundId: "round-2", content: "tail" }
    ]);
    expect(graph.toolGroups[0]).toMatchObject({
      id: "tool-1",
      uses: [1, 2]
    });
    expect(chooseCompactionCutPoint([
      { id: "m1", role: "user", apiRoundId: "round-1", content: "start" },
      { id: "m2", role: "assistant", apiRoundId: "round-1", content: "call", toolCalls: [{ id: "tool-1" }] },
      { id: "m3", role: "tool", apiRoundId: "round-1", toolUseId: "tool-1", content: "result" },
      { id: "m4", role: "user", apiRoundId: "round-2", content: "tail" }
    ], {
      profile: {
        compactionPolicy: {
          recentMessageProtectionCount: 3
        }
      }
    })).toMatchObject({
      proposedCutIndex: 1,
      cutIndex: 0
    });
    expect(listContextCompactionStrategies([
      { id: "custom-a" },
      { id: "custom-a" },
      { strategyId: "custom-b" }
    ])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deterministic-extractive" }),
        expect.objectContaining({ id: "custom-a", custom: true }),
        expect.objectContaining({ id: "custom-b", custom: true })
      ])
    );
    expect(() => createContextCompactionStrategyAdapter({ id: "" })).toThrow("context_compaction_strategy_id_required");
    expect(() => createContextCompactionStrategyAdapter({ id: "custom" })).toThrow("context_compaction_strategy_run_required:custom");

    const adapter = createContextCompactionStrategyAdapter({
      id: "custom-adapter",
      label: "Custom adapter",
      inputAdapter: (context) => ({
        ids: context.compactedMessages.map((message) => message.id),
        limit: context.policy.strategy.params.limit
      }),
      run: async (input) => ({
        executionMode: "custom-mode",
        summary: `Custom summary for ${input.ids.join(",")} limit=${input.limit}`,
        structured: {
          ids: input.ids
        }
      })
    });
    const adapted = await adapter.run({
      compactedMessages: [{ id: "m1" }, { id: "m2" }],
      policy: {
        strategy: {
          id: "custom-adapter",
          params: {
            limit: 3
          }
        }
      },
      targetTokens: 100
    });
    expect(adapted).toMatchObject({
      executionMode: "custom-mode",
      summaryResult: {
        summary: expect.stringContaining("m1,m2"),
        structured: {
          ids: ["m1", "m2"]
        }
      }
    });

    await withContextRuntime(async (runtime, root, memoryStore) => {
      const messages = sampleMessages();
      const preview = await runtime.preview({
        profile: compactProfile(),
        sessionId: "session-1",
        messages,
        runtimeState: {
          activePlan: { step: "keep" }
        }
      });
      expect(preview).toMatchObject({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        preview: true,
        status: "skipped",
        compacted: false
      });

      const result = await runtime.run({
        profile: compactProfile(),
        sessionId: "session-1",
        messages,
        runtimeState: {
          activePlan: { step: "keep" },
          knowledgeReference: "ev-critical"
        }
      });
      expect(result).toMatchObject({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        status: "completed",
        compacted: true,
        executionMode: "workbench-reconstruction"
      });
      expect(result.modelEvents[0]).toMatchObject({
        used: true,
        degraded: false,
        promptCacheCompatible: true
      });
      expect(result.tokenReport.savedTokens).toBeGreaterThanOrEqual(0);
      expect(result.boundary.boundaryId).toEqual(expect.any(String));

      const latestMemory = await memoryStore.latestSessionMemory({
        sessionId: "session-1",
        profileId: "unit-compact"
      });
      expect(latestMemory).toMatchObject({
        protocolVersion: AGENT_MEMORY_PROTOCOL_VERSION,
        sessionId: "session-1",
        profileId: "unit-compact",
        boundaryId: result.boundary.boundaryId,
        summary: expect.stringContaining("Model summary")
      });

      const memoryList = await runtime.listSessionMemory({
        sessionId: "session-1",
        profileId: "unit-compact"
      });
      expect(memoryList.protocolVersion).toBe(AGENT_MEMORY_PROTOCOL_VERSION);
      expect(memoryList.records.length).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const cleared = await runtime.clearSessionMemory({
        sessionId: "session-1",
        profileId: "unit-compact",
        reason: "reset"
      });
      expect(cleared).toMatchObject({
        protocolVersion: AGENT_MEMORY_PROTOCOL_VERSION,
        ok: true,
        record: expect.objectContaining({
          status: "cleared"
        })
      });
      const afterClear = await runtime.listSessionMemory({
        sessionId: "session-1",
        profileId: "unit-compact"
      });
      expect(afterClear.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "cleared"
          })
        ])
      );

      const records = await runtime.listRecords({ limit: 10 });
      expect(records.protocolVersion).toBe(CONTEXT_COMPACTION_PROTOCOL_VERSION);
      expect(records.records.length).toBeGreaterThan(0);
      const boundaries = await runtime.listBoundaries({ limit: 10 });
      expect(boundaries.boundaries.length).toBeGreaterThan(0);
      expect(runtime.resumeTranscript({
        transcript: [
          { id: "x1", role: "user", content: "before" },
          {
            id: "boundary",
            role: "system",
            type: "compact_boundary",
            content: "summary",
            boundary: { boundaryId: "boundary-1" }
          },
          { id: "x2", role: "user", content: "after" }
        ]
      })).toMatchObject({
        resumed: true,
        skippedMessageCount: 1
      });
    }, {
      modelCompressor: async ({ prompt }) => ({
        summary: JSON.stringify({
          summary: "Model summary",
          promptLength: prompt.length,
          structured: true
        })
      })
    });
  });

  it("supports agent memory creation, redaction, and empty-store boundaries", async () => {
    expect(() => createAgentMemory({})).toThrow("agent_memory_user_data_path_required");

    const root = await tempDir("pact-agent-memory-deep-");
    const memory = createAgentMemory({ userDataPath: root });
    const record = await memory.appendSessionMemory({
      sessionId: "session-1",
      profileId: "profile-1",
      boundaryId: "boundary-1",
      sourceHash: "hash-1",
      summary: "Bearer sk-secret and /Users/unka/private/file.md",
      structured: {
        token: "abc",
        buffer: Buffer.from("abc")
      },
      sourceRange: {
        path: "/Users/unka/private/file.md"
      }
    });
    expect(record).toMatchObject({
      protocolVersion: AGENT_MEMORY_PROTOCOL_VERSION,
      sessionId: "session-1",
      profileId: "profile-1"
    });
    expect(record.summary).toContain("<redacted-secret>");
    expect(record.structured.buffer).toMatchObject({
      redacted: true,
      reason: "buffer",
      byteLength: 3
    });
    expect(redactAgentMemoryValue({
      token: "secret",
      nested: {
        path: "/Users/unka/private/file.md"
      }
    })).toMatchObject({
      token: "<redacted>",
      nested: {
        path: "<redacted-path>"
      }
    });

    const latest = await memory.latestSessionMemory({
      sessionId: "session-1",
      profileId: "profile-1",
      sourceHash: "hash-1"
    });
    expect(latest).toMatchObject({
      sessionId: "session-1",
      profileId: "profile-1",
      sourceHash: "hash-1"
    });
    expect(await memory.latestSessionMemory({
      sessionId: "session-1",
      profileId: "profile-1",
      sourceHash: "missing"
    })).toBeNull();

    const list = await memory.listSessionMemory({
      sessionId: "session-1",
      profileId: "profile-1"
    });
    expect(list.protocolVersion).toBe(AGENT_MEMORY_PROTOCOL_VERSION);
    expect(list.records).toHaveLength(1);

    const cleared = await memory.clearSessionMemory({
      sessionId: "session-1",
      profileId: "profile-1",
      reason: "manual"
    });
    expect(cleared).toMatchObject({
      ok: true,
      record: expect.objectContaining({
        status: "cleared"
      })
    });
    const afterClear = await memory.listSessionMemory({
      sessionId: "session-1",
      profileId: "profile-1"
    });
    expect(afterClear.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "cleared"
        })
      ])
    );
  });
});
