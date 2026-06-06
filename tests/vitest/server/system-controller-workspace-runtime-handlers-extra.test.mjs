import { afterEach, describe, expect, it, vi } from "vitest";

import { createSystemControllerWorkspaceRuntimeHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-workspace-runtime-handlers.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function queryPayload(url = null) {
  return url ? Object.fromEntries(url.searchParams.entries()) : {};
}

function createHarness(overrides = {}) {
  const contextRuntime = overrides.contextRuntime || { name: "context-runtime" };
  const agentWorkspace = overrides.agentWorkspace || { name: "agent-workspace" };
  const clientRuntimeAllocator = overrides.clientRuntimeAllocator || { name: "client-runtime-allocator" };
  const clientRuntimeBootstrap = overrides.clientRuntimeBootstrap || { name: "client-runtime-bootstrap" };

  const parseJsonBody =
    overrides.parseJsonBody ||
    vi.fn((requestBody) => JSON.parse(requestBody.toString("utf8")));
  const protocolPayload = overrides.protocolPayload || vi.fn((_requestBody, url) => queryPayload(url));
  const sendConsoleDomainOperation =
    overrides.sendConsoleDomainOperation ||
    vi.fn(async (payload) => ({ ok: true, payload }));

  const handlers = createSystemControllerWorkspaceRuntimeHandlers({
    sendConsoleDomainOperation,
    parseJsonBody,
    protocolPayload,
    contextRuntime,
    agentWorkspace,
    clientRuntimeAllocator,
    clientRuntimeBootstrap
  });

  return {
    agentWorkspace,
    clientRuntimeAllocator,
    clientRuntimeBootstrap,
    contextRuntime,
    handlers,
    parseJsonBody,
    protocolPayload,
    sendConsoleDomainOperation
  };
}

const handlerExpectations = [
  ["handleContextProfiles", "context.profiles.set"],
  ["handleClientRuntimeProfiles", "client_runtime.profiles.set"],
  ["handleClientRuntimeResolve", "client_runtime.resolve"],
  ["handleClientRuntimeBootstrapPlan", "client_runtime.bootstrap.plan"],
  ["handleClientRuntimeBootstrapPull", "client_runtime.bootstrap.pull"],
  ["handleClientRuntimeStatus", "client_runtime.status"],
  ["handleContextPreview", "context.preview"],
  ["handleContextCompactionPreview", "context.compaction.preview"],
  ["handleContextCompactionRun", "context.compaction.run"],
  ["handleContextCompactionRecords", "context.compaction.records"],
  ["handleContextSessionMemory", "context.session_memory.get"],
  ["handleContextSessionMemoryClear", "context.session_memory.clear"],
  ["handleContextBuildRecords", "context.build_records"],
  ["handleContextEvaluationRuns", "context.evaluation.runs.create"],
  ["handleAgentWorkspaces", "agent_workspaces.list"],
  ["handleAgentWorkspace", "agent_workspaces.get"],
  ["handleAgentSessions", "agent_sessions.list"],
  ["handleAgentSession", "agent_sessions.get"],
  ["handleGetAgentSessionContext", "agent_sessions.context.get"],
  ["handleAppendAgentSessionEvent", "agent_sessions.events.append"],
  ["handleForkAgentSession", "agent_sessions.fork"],
  ["handleCompareAgentSessions", "agent_sessions.compare"],
  ["handleAgentSessionMergeProposal", "agent_sessions.merge_proposal"],
  ["handleArchiveAgentSession", "agent_sessions.archive"],
  ["handleResolveAgentWorkspaceSubmission", "agent_workspaces.submissions.resolve"],
  ["handleResolveAgentWorkspaceIssue", "agent_workspaces.issues.resolve"],
  ["handleCreateAgentWorkspace", "agent_workspaces.create"],
  ["handleDeleteAgentWorkspace", "agent_workspaces.delete"],
  ["handleAgentWorkspaceLocks", "agent_workspaces.locks.list"],
  ["handleAgentWorkspaceLock", "agent_workspaces.locks.write"],
  ["handleGetWorkspaceContext", "agent_workspaces.context.get"],
  ["handleExportWorkspaceContextBundle", "agent_workspaces.context_bundle.export"],
  ["handleRestoreWorkspaceContextBundle", "agent_workspaces.context_bundle.restore"],
  ["handleGetWorkspaceChain", "agent_workspaces.chain.get"],
  ["handleSetWorkspaceParent", "agent_workspaces.parent.set"],
  ["handleHotSwapWorkspaceProfile", "agent_workspaces.profile.hotswap"],
  ["handleSetWorkspaceOwnedSources", "agent_workspaces.sources.set"],
  ["handleShareWorkspace", "agent_workspaces.share"],
  ["handleUnshareWorkspace", "agent_workspaces.unshare"],
  ["handleCreateWorkspaceFolder", "agent_workspaces.folder.create"],
  ["handleListWorkspaceFiles", "agent_workspaces.files.list"],
  ["handleGetWorkspaceFile", "agent_workspaces.file.stat"],
  ["handleDownloadWorkspaceFile", "agent_workspaces.file.download"],
  ["handleUploadWorkspaceFile", "agent_workspaces.file.upload"],
  ["handleWriteWorkspaceFile", "agent_workspaces.file.write"],
  ["handleDeleteWorkspaceFile", "agent_workspaces.file.delete"],
  ["handleConnectWorkspaceLocalDirectory", "sharedspace.localDir.connect"],
  ["handleListWorkspaceLocalDirectories", "sharedspace.localDir.list"],
  ["handleMoveWorkspaceFile", "agent_workspaces.file.move"],
  ["handlePlanWorkspaceLocalDirSync", "sharedspace.sync.plan"],
  ["handleApplyWorkspaceLocalDirSync", "sharedspace.sync.apply"],
  ["handleSharedspaceDriveConnect", "sharedspace.drive.connect"],
  ["handleSharedspaceDriveStatus", "sharedspace.drive.status"],
  ["handleSharedspaceDriveItemList", "sharedspace.drive.item.list"],
  ["handleSharedspaceDriveFileDownload", "sharedspace.drive.file.download"],
  ["handleSharedspaceDriveFileUpload", "sharedspace.drive.file.upload"],
  ["handleSharedspaceDriveSyncPlan", "sharedspace.drive.sync.plan"],
  ["handleSharedspaceDriveSyncApply", "sharedspace.drive.sync.apply"],
  ["handleSharedspaceDrivePermissionList", "sharedspace.drive.permission.list"]
];

function argsFor(name) {
  return {
    authSession: { sessionId: "session-1" },
    issueId: "issue-1",
    requestBody: jsonBody({ value: name }),
    response: { tag: "response" },
    sessionId: "session-1",
    submissionId: "submission-1",
    targetWorkspaceId: "workspace-target",
    url: new URL("http://example.test/console?path=/docs/readme.md&limit=3"),
    workspaceId: "workspace-1"
  };
}

describe("system controller workspace runtime handlers", () => {
  it("registers every expected workspace runtime handler", () => {
    const { handlers } = createHarness();

    expect(Object.keys(handlers).sort()).toEqual(handlerExpectations.map(([name]) => name).sort());
  });

  it("forwards all handlers to their fallback operation ids", async () => {
    const harness = createHarness();

    for (const [name] of handlerExpectations) {
      await harness.handlers[name](argsFor(name));
    }

    expect(harness.sendConsoleDomainOperation).toHaveBeenCalledTimes(handlerExpectations.length);
    expect(harness.sendConsoleDomainOperation.mock.calls.map(([payload]) => payload.operationId)).toEqual(
      handlerExpectations.map(([, operationId]) => operationId)
    );
  });

  it("selects get/set operation ids for empty and non-empty profile bodies", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-2" };

    await harness.handlers.handleContextProfiles({
      requestBody: Buffer.alloc(0),
      response,
      authSession
    });
    await harness.handlers.handleClientRuntimeProfiles({
      requestBody: Buffer.alloc(0),
      response
    });
    await harness.handlers.handleContextProfiles({
      requestBody: jsonBody({ profiles: [{ id: "developer" }] }),
      response,
      authSession
    });

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "context.profiles.get",
      input: {},
      response,
      context: {
        contextRuntime: harness.contextRuntime,
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "上下文 profile 操作失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "client_runtime.profiles.get",
      input: {},
      response,
      context: {
        clientRuntimeAllocator: harness.clientRuntimeAllocator
      },
      errorMessage: "客户端运行时分配 profile 失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, {
      operationId: "context.profiles.set",
      input: {
        profiles: [{ id: "developer" }]
      },
      response,
      context: {
        contextRuntime: harness.contextRuntime,
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "上下文 profile 操作失败。"
    });
  });

  it("merges url payloads and route identifiers into workspace and session operations", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-3" };
    const url = new URL("http://example.test/console?path=/notes/a.md&recursive=true");

    await harness.handlers.handleAgentWorkspace({
      operation: { id: "agent_workspaces.get.custom" },
      workspaceId: "workspace-route",
      url,
      response,
      authSession
    });
    await harness.handlers.handleAgentSession({
      sessionId: "session-route",
      url,
      response,
      authSession
    });
    await harness.handlers.handleResolveAgentWorkspaceSubmission({
      workspaceId: "workspace-route",
      submissionId: "submission-route",
      requestBody: jsonBody({ decision: "accept" }),
      response,
      authSession
    });
    await harness.handlers.handleResolveAgentWorkspaceIssue({
      workspaceId: "workspace-route",
      issueId: "issue-route",
      requestBody: jsonBody({ status: "resolved" }),
      response,
      authSession
    });
    await harness.handlers.handleShareWorkspace({
      workspaceId: "workspace-route",
      targetWorkspaceId: "workspace-target",
      requestBody: jsonBody({ mode: "read" }),
      response,
      authSession
    });
    await harness.handlers.handleUnshareWorkspace({
      workspaceId: "workspace-route",
      requestBody: jsonBody({ reason: "cleanup" }),
      response,
      authSession
    });

    expect(harness.protocolPayload).toHaveBeenCalledWith(expect.any(Buffer), url);
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "agent_workspaces.get.custom",
      input: {
        path: "/notes/a.md",
        recursive: "true",
        workspaceId: "workspace-route"
      },
      response,
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "读取智能体工作空间失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "agent_sessions.get",
      input: {
        path: "/notes/a.md",
        recursive: "true",
        sessionId: "session-route"
      },
      response,
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "读取会话线程失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, {
      operationId: "agent_workspaces.submissions.resolve",
      input: {
        decision: "accept",
        workspaceId: "workspace-route",
        submissionId: "submission-route"
      },
      response,
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "审核共享提交失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(4, {
      operationId: "agent_workspaces.issues.resolve",
      input: {
        status: "resolved",
        workspaceId: "workspace-route",
        issueId: "issue-route"
      },
      response,
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "解决共享空间 issue 失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(5, {
      operationId: "agent_workspaces.share",
      input: {
        mode: "read",
        targetWorkspaceId: "workspace-target",
        workspaceId: "workspace-route"
      },
      response,
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "共享工作空间失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(6, {
      operationId: "agent_workspaces.unshare",
      input: {
        reason: "cleanup",
        workspaceId: "workspace-route"
      },
      response,
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      },
      errorMessage: "撤销工作空间共享失败。"
    });
  });

  it("uses the expected dependency context groups", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-4" };

    await harness.handlers.handleClientRuntimeResolve({
      requestBody: jsonBody({ clientId: "client-1" }),
      response
    });
    await harness.handlers.handleClientRuntimeBootstrapPlan({
      requestBody: jsonBody({ clientId: "client-1" }),
      response
    });
    await harness.handlers.handleContextPreview({
      requestBody: jsonBody({ prompt: "hello" }),
      response,
      authSession
    });
    await harness.handlers.handleSharedspaceDrivePermissionList({
      url: new URL("http://example.test/drive?driveId=drive-1"),
      response,
      authSession
    });

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operationId: "client_runtime.resolve",
      context: {
        clientRuntimeAllocator: harness.clientRuntimeAllocator
      }
    }));
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operationId: "client_runtime.bootstrap.plan",
      context: {
        clientRuntimeBootstrap: harness.clientRuntimeBootstrap
      }
    }));
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, expect.objectContaining({
      operationId: "context.preview",
      context: {
        contextRuntime: harness.contextRuntime,
        agentWorkspace: harness.agentWorkspace,
        authSession
      }
    }));
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(4, expect.objectContaining({
      operationId: "sharedspace.drive.permission.list",
      context: {
        agentWorkspace: harness.agentWorkspace,
        authSession
      }
    }));
  });

  it("propagates sendConsoleDomainOperation failures", async () => {
    const error = new Error("workspace runtime boom");
    const sendConsoleDomainOperation = vi.fn(async () => {
      throw error;
    });
    const harness = createHarness({ sendConsoleDomainOperation });

    await expect(harness.handlers.handleWriteWorkspaceFile({
      workspaceId: "workspace-1",
      requestBody: jsonBody({ path: "a.txt", content: "A" }),
      response: {},
      authSession: { sessionId: "session-5" }
    })).rejects.toThrow("workspace runtime boom");

    expect(sendConsoleDomainOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "agent_workspaces.file.write",
      input: {
        path: "a.txt",
        content: "A",
        workspaceId: "workspace-1"
      },
      errorMessage: "写入工作空间文件失败。"
    }));
  });
});
