import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";
import {
  AGENT_SESSION_THREAD_VERSION,
  AGENT_WORKSPACE_PROTOCOL_VERSION,
  createAgentWorkspace
} from "../platform/specialized/agent/agent-workspace/index.mjs";

const mockDocumentParserModulePath = fileURLToPath(
  new URL("../../tests/server/mock-structured-document-parser.mjs", import.meta.url)
);
const consoleAuthCliPath = fileURLToPath(new URL("./console-auth.mjs", import.meta.url));

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  assert.ok(response.ok, `${url} failed: ${response.status} ${rawText}`);
  return payload;
}

async function fetchJsonResponse(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function cookieHeaderFrom(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response.headers.get("set-cookie") || "")
          .split(/,(?=\s*pact_)/)
          .filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function loginConsoleUser(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  assert.equal(response.status, 200, `login failed for ${username}: ${rawText}`);
  return {
    cookie: cookieHeaderFrom(response),
    csrf: payload.csrfToken,
    session: payload.session
  };
}

function createConsoleUser(dataDir, { username, password, role = "operator" }) {
  const result = spawnSync(
    process.execPath,
    [
      consoleAuthCliPath,
      "--data-dir",
      dataDir,
      "create-user",
      "--username",
      username,
      "--password",
      password,
      "--role",
      role
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout || `create-user failed: ${username}`);
}

async function waitForJob(baseUrl, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await fetchJson(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === "completed") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(job.error || "Job failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Job did not complete in time.");
}

function buildUploadedEmail(name, body) {
  const content = [
    "From: Workspace Verify <verify@example.com>",
    "To: Runtime Verify <runtime@example.com>",
    `Subject: ${name}`,
    "Date: Sun, 17 May 2026 08:00:00 +0000",
    "",
    body
  ].join("\n");
  const buffer = Buffer.from(content, "utf8");
  return {
    name,
    relativePath: `workspace/${name}`,
    mediaType: "message/rfc822",
    dataBase64: buffer.toString("base64"),
    byteSize: buffer.length
  };
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-"));
const workspace = createAgentWorkspace({ userDataPath });
const adminAccess = { actorUserId: "verify-owner", canAccessAll: true };

try {
  assert.equal(workspace.protocolVersion, AGENT_WORKSPACE_PROTOCOL_VERSION);
  const created = workspace.createWorkspace({
    ownerUserId: "verify-owner",
    title: "Verify workspace",
    objective: "Validate shared-space gate"
  }).workspace;
  assert.ok(created.workspaceId);

  const sessionList = workspace.listSessions({ ...adminAccess, workspaceId: created.workspaceId });
  assert.equal(sessionList.sessionProtocolVersion, AGENT_SESSION_THREAD_VERSION);
  assert.equal(sessionList.appendOnly, true);
  const rootSession = sessionList.sessions.find((item) => item.workspaceId === created.workspaceId);
  assert.ok(rootSession?.sessionId);

  const appendedSessionEvent = workspace.appendSessionEvent({
    ...adminAccess,
    sessionId: rootSession.sessionId,
    type: "task_note",
    title: "验证会话加载",
    summary: "会话线程以追加事件保存工作状态"
  });
  assert.equal(appendedSessionEvent.session.eventCount, 2);

  const forkedSession = workspace.forkSession({
    ...adminAccess,
    sessionId: rootSession.sessionId,
    title: "验证会话分叉"
  });
  assert.equal(forkedSession.ok, true);
  assert.equal(forkedSession.appendOnly, true);
  assert.equal(forkedSession.session.parentSessionId, rootSession.sessionId);
  assert.ok(forkedSession.session.eventCount >= appendedSessionEvent.session.eventCount);
  const parentAfterFork = workspace.getSession({ ...adminAccess, sessionId: rootSession.sessionId });
  assert.equal(parentAfterFork.session.eventCount, appendedSessionEvent.session.eventCount);
  const forkContext = workspace.getSessionContext(forkedSession.session.sessionId, adminAccess);
  assert.equal(forkContext.agentSessionId, forkedSession.session.sessionId);
  assert.equal(forkContext.workspaceId, created.workspaceId);
  assert.ok(forkContext.contextFingerprint);

  const run = workspace.createRun({
    workspaceId: created.workspaceId,
    runType: "verify",
    status: "running",
    input: {
      query: "verify"
    }
  }).run;
  assert.ok(run.runId);

  const missingEvidence = workspace.submit({
    workspaceId: created.workspaceId,
    runId: run.runId,
    agentId: "Extractor",
    type: "evidenceCard",
    payload: {
      claim: "A claim without evidence must be reviewed.",
      confidence: 0.9
    },
    confidence: 0.9
  }).submission;
  assert.equal(missingEvidence.status, "needs_review");
  assert.equal(missingEvidence.gate.reasons.includes("missing_evidence"), true);

  const duplicate = workspace.submit({
    workspaceId: created.workspaceId,
    runId: run.runId,
    agentId: "Extractor",
    type: "evidenceCard",
    payload: {
      claim: "A claim without evidence must be reviewed.",
      confidence: 0.9
    },
    confidence: 0.9
  }).submission;
  assert.equal(duplicate.status, "rejected");
  assert.equal(duplicate.gate.reasons.includes("duplicate_submission"), true);

  const evidenceRef = workspace.submit({
    workspaceId: created.workspaceId,
    runId: run.runId,
    agentId: "Extractor",
    type: "evidenceRef",
    payload: {
      summary: "accepted evidence ref",
      evidenceId: "ev-1"
    },
    evidenceRefs: ["ev-1"],
    confidence: 0.8
  }).submission;
  assert.equal(evidenceRef.status, "accepted");

  const canonicalChange = workspace.submit({
    workspaceId: created.workspaceId,
    runId: run.runId,
    agentId: "Analyst",
    type: "canonicalChange",
    payload: {
      summary: "canonical fact edits require review",
      evidenceId: "ev-1"
    },
    evidenceRefs: ["ev-1"],
    confidence: 0.95
  }).submission;
  assert.equal(canonicalChange.status, "needs_review");
  assert.equal(canonicalChange.gate.reviewedRequired, true);

  const denied = workspace.submit({
    workspaceId: created.workspaceId,
    runId: run.runId,
    agentId: "Writer",
    type: "claim",
    payload: {
      claim: "Writer is not allowed to submit claims in this policy.",
      evidenceId: "ev-1"
    },
    confidence: 0.9,
    writePolicy: {
      allowedTypes: ["artifact"]
    }
  }).submission;
  assert.equal(denied.status, "rejected");
  assert.equal(denied.gate.reasons.includes("role_not_allowed"), true);

  const privateState = workspace.savePrivateState({
    workspaceId: created.workspaceId,
    runId: run.runId,
    agentId: "Extractor",
    summary: "private scratch summary",
    state: {
      localOnly: true
    }
  });
  assert.equal(privateState.agentId, "Extractor");

  const artifact = workspace.createArtifact({
    workspaceId: created.workspaceId,
    runId: run.runId,
    level: "ExecutiveSummary",
    title: "Verify artifact",
    content: "Artifact content [ev-1]",
    citations: [{ evidenceId: "ev-1" }],
    coverageReport: {
      totalEvidence: 1,
      coveredEvidence: 1,
      score: 1
    },
    createdBy: "Merger"
  }).artifact;
  assert.equal(artifact.revision, 1);

  const issue = workspace.createIssue({
    workspaceId: created.workspaceId,
    runId: run.runId,
    type: "missing_important_evidence",
    title: "Missing important evidence",
    evidenceRefs: ["ev-1"],
    createdBy: "Reviewer"
  }).issue;
  assert.equal(issue.status, "open");

  const decision = workspace.createDecision({
    workspaceId: created.workspaceId,
    runId: run.runId,
    title: "Publish candidate",
    payload: {
      action: "publish"
    },
    createdBy: "Merger"
  }).decision;
  assert.equal(decision.status, "proposed");

  const full = workspace.getWorkspace({
    ...adminAccess,
    workspaceId: created.workspaceId,
    includePrivate: true
  });
  assert.equal(full.summary.runCount, 1);
  assert.equal(full.summary.artifactCount, 1);
  assert.equal(full.privateStates.length, 1);
  assert.equal(full.submissions.some((item) => item.status === "needs_review"), true);

  const publicBundle = workspace.exportWorkspaceContextBundle(created.workspaceId, {
    ...adminAccess,
    maxItems: 5,
    contentPreviewChars: 12,
    compress: true
  });
  assert.equal(publicBundle.bundleVersion, "v0.0.1:workspace:context-bundle-1");
  assert.equal(publicBundle.restoreEvidence.artifactCount, 1);
  assert.equal(publicBundle.restoreEvidence.privateStateCount, 0);
  assert.equal(publicBundle.compressed.encoding, "gzip+base64");
  const restoredBundle = JSON.parse(
    gunzipSync(Buffer.from(publicBundle.compressed.payload, "base64")).toString("utf8")
  );
  assert.equal(restoredBundle.workspace.workspaceId, created.workspaceId);
  assert.equal(restoredBundle.recent.artifacts[0].contentPreview.includes("<truncated>"), true);
  assert.equal(JSON.stringify(restoredBundle).includes("localOnly"), false);
  assert.ok(restoredBundle.handoffMarkdown.includes(created.workspaceId));

  const privateBundle = workspace.exportWorkspaceContextBundle(created.workspaceId, {
    ...adminAccess,
    includePrivate: true,
    compress: false
  });
  assert.equal(privateBundle.restoreEvidence.privateStateCount, 1);
  assert.deepEqual(privateBundle.bundle.recent.privateStates[0].stateKeys, ["localOnly"]);

  const listed = workspace.listWorkspaces({
    ...adminAccess,
    status: "active",
    includeSummary: true
  });
  assert.equal(listed.count, 1);
  assert.equal(listed.workspaces[0].summary.openIssueCount, 1);

  const tenantAlpha = workspace.createWorkspace({
    workspaceId: "verify-tenant-alpha-workspace",
    title: "Tenant Alpha",
    objective: "Team-shared workspace attribution",
    ownerUserId: "user-alpha"
  }).workspace;
  const tenantBeta = workspace.createWorkspace({
    workspaceId: "verify-tenant-beta-workspace",
    title: "Tenant Beta",
    objective: "Team-shared workspace attribution",
    ownerUserId: "user-beta"
  }).workspace;
  assert.equal(tenantAlpha.ownerUserId, "user-alpha");
  assert.equal(tenantBeta.ownerUserId, "user-beta");
  const alphaVisible = workspace.listWorkspaces({
    actorUserId: "user-alpha",
    includeSummary: false
  }).workspaces.map((item) => item.workspaceId);
  assert.ok(alphaVisible.includes("verify-tenant-alpha-workspace"));
  assert.equal(alphaVisible.includes("verify-tenant-beta-workspace"), false);
  assert.ok(workspace.getWorkspace({
    workspaceId: "verify-tenant-alpha-workspace",
    actorUserId: "user-alpha"
  }));
  assert.equal(workspace.getWorkspace({
    workspaceId: "verify-tenant-beta-workspace",
    actorUserId: "user-alpha"
  }), null);
  assert.equal(workspace.getWorkspaceContext("verify-tenant-beta-workspace", {
    actorUserId: "user-alpha"
  }), null);
  assert.equal(workspace.hotSwapProfile(
    "verify-tenant-beta-workspace",
    { modelAlias: "blocked-cross-tenant-model" },
    { actorUserId: "user-alpha" }
  ).ok, false);
  assert.equal(workspace.hotSwapProfile(
    "verify-tenant-beta-workspace",
    { modelAlias: "admin-approved-model" },
    { actorUserId: "owner-user", canAccessAll: true }
  ).ok, true);

  const resolvedSubmission = workspace.resolveSubmission({
    ...adminAccess,
    workspaceId: created.workspaceId,
    submissionId: canonicalChange.submissionId,
    resolution: "reject",
    reviewerId: "Reviewer",
    note: "canonical changes require human merge"
  }).submission;
  assert.equal(resolvedSubmission.status, "rejected");
  assert.equal(resolvedSubmission.gate.resolvedBy, "Reviewer");

  const resolvedIssue = workspace.updateIssue({
    ...adminAccess,
    workspaceId: created.workspaceId,
    issueId: issue.issueId,
    status: "resolved",
    reviewerId: "Reviewer",
    note: "verified in test"
  }).issue;
  assert.equal(resolvedIssue.status, "resolved");
  assert.equal(resolvedIssue.payload.resolution.resolvedBy, "Reviewer");

  const lock = workspace.acquireLock({
    ...adminAccess,
    workspaceId: created.workspaceId,
    targetType: "artifact",
    targetId: artifact.artifactId,
    ownerAgentId: "Merger",
    ttlMs: 60_000
  });
  assert.equal(lock.ok, true);
  assert.equal(lock.lock.ownerAgentId, "Merger");

  const deniedLock = workspace.acquireLock({
    ...adminAccess,
    workspaceId: created.workspaceId,
    targetType: "artifact",
    targetId: artifact.artifactId,
    ownerAgentId: "Reviewer",
    ttlMs: 60_000
  });
  assert.equal(deniedLock.ok, false);
  assert.equal(deniedLock.error, "lock_held");
  assert.equal(workspace.listLocks({ ...adminAccess, workspaceId: created.workspaceId }).length, 1);

  const released = workspace.releaseLock({
    ...adminAccess,
    workspaceId: created.workspaceId,
    targetType: "artifact",
    targetId: artifact.artifactId,
    ownerAgentId: "Merger"
  });
  assert.equal(released.released, true);
  assert.equal(workspace.listLocks({ ...adminAccess, workspaceId: created.workspaceId }).length, 0);

  const parentWorkspace = workspace.createWorkspace({
    workspaceId: "verify-parent-workspace",
    ownerUserId: "verify-owner",
    title: "Parent workspace",
    objective: "Shared base context"
  }).workspace;
  const childWorkspace = workspace.createWorkspace({
    workspaceId: "verify-child-workspace",
    ownerUserId: "verify-owner",
    title: "Child workspace",
    objective: "Hot swapped context"
  }).workspace;
  const sharedWorkspace = workspace.createWorkspace({
    workspaceId: "verify-shared-workspace",
    ownerUserId: "verify-owner",
    title: "Shared source workspace",
    objective: "Source sharing"
  }).workspace;
  const parentSources = workspace.setOwnedSourceIds(parentWorkspace.workspaceId, [
    "source-parent"
  ], adminAccess);
  const childSources = workspace.setOwnedSourceIds(childWorkspace.workspaceId, [
    "source-child"
  ], adminAccess);
  workspace.setOwnedSourceIds(sharedWorkspace.workspaceId, [
    "source-shared"
  ], adminAccess);
  assert.equal(parentSources.workspace.currentGeneration, parentWorkspace.currentGeneration + 1);
  assert.equal(childSources.workspace.currentGeneration, childWorkspace.currentGeneration + 1);

  const parentProfile = workspace.hotSwapProfile(parentWorkspace.workspaceId, {
    contextProfileId: "parent-context",
    modelAlias: "parent-model",
    knowledgeScope: {
      includeSourceIds: ["source-parent-profile"]
    }
  }, adminAccess);
  assert.equal(parentProfile.ok, true);
  assert.equal(parentProfile.newGeneration, parentSources.workspace.currentGeneration + 1);

  const parentResult = workspace.setWorkspaceParent(
    childWorkspace.workspaceId,
    parentWorkspace.workspaceId,
    adminAccess
  );
  assert.equal(parentResult.ok, true);
  assert.equal(parentResult.workspace.currentGeneration, childSources.workspace.currentGeneration + 1);
  const profileSwap = workspace.hotSwapProfile(childWorkspace.workspaceId, {
    contextProfileId: "child-context",
    toolGrantId: "child-tool-grant",
    modelAlias: "child-model",
    knowledgeScope: {
      includeSourceIds: ["source-child-profile"],
      excludeSourceIds: ["source-parent"]
    }
  }, adminAccess);
  assert.equal(profileSwap.ok, true);
  assert.equal(profileSwap.newGeneration, parentResult.workspace.currentGeneration + 1);

  const shared = workspace.shareWorkspace(
    sharedWorkspace.workspaceId,
    childWorkspace.workspaceId,
    adminAccess
  );
  assert.equal(shared.ok, true);
  assert.equal(shared.workspace.currentGeneration, profileSwap.newGeneration + 1);
  const resolvedContext = workspace.getWorkspaceContext(childWorkspace.workspaceId, adminAccess);
  assert.equal(resolvedContext.contextProfileId, "child-context");
  assert.equal(resolvedContext.toolGrantId, "child-tool-grant");
  assert.equal(resolvedContext.modelAlias, "child-model");
  assert.equal(resolvedContext.currentGeneration, shared.workspace.currentGeneration);
  assert.equal(resolvedContext.chainGenerations.length, 2);
  assert.ok(resolvedContext.contextFingerprint);
  assert.deepEqual(
    new Set(resolvedContext.knowledgeSourceIds),
    new Set(["source-parent-profile", "source-child", "source-child-profile", "source-shared"])
  );
  const childContextBundle = workspace.exportWorkspaceContextBundle(childWorkspace.workspaceId, {
    ...adminAccess,
    maxItems: 4,
    compress: true
  });
  const restoreTarget = workspace.createWorkspace({
    workspaceId: "verify-restored-workspace",
    ownerUserId: "verify-owner",
    title: "Restored workspace",
    objective: "Restore compressed context bundle"
  }).workspace;
  const restoreTargetBefore = workspace.getWorkspaceContext(restoreTarget.workspaceId, adminAccess);
  const rejectedRestore = workspace.restoreWorkspaceContextBundle(restoreTarget.workspaceId, {
    compressed: childContextBundle.compressed,
    bundleHash: "tampered-context-bundle-hash"
  }, adminAccess);
  assert.equal(rejectedRestore.ok, false);
  assert.match(rejectedRestore.error, /hash/);
  assert.equal(
    workspace.getWorkspaceContext(restoreTarget.workspaceId, adminAccess).contextFingerprint,
    restoreTargetBefore.contextFingerprint
  );
  const restoredContextBundle = workspace.restoreWorkspaceContextBundle(restoreTarget.workspaceId, {
    compressed: childContextBundle.compressed,
    bundleHash: childContextBundle.bundleHash
  }, adminAccess);
  assert.equal(restoredContextBundle.ok, true);
  assert.equal(restoredContextBundle.applied.contextProfileId, "child-context");
  assert.equal(restoredContextBundle.restoredContext.modelAlias, "child-model");
  assert.equal(restoredContextBundle.restoredContext.toolGrantId, "child-tool-grant");
  assert.deepEqual(
    new Set(restoredContextBundle.restoredContext.knowledgeSourceIds),
    new Set(resolvedContext.knowledgeSourceIds)
  );
  const restoredSnapshot = workspace.getWorkspace({
    ...adminAccess,
    workspaceId: restoreTarget.workspaceId
  });
  assert.equal(restoredSnapshot.summary.runCount, 1);
  assert.equal(restoredSnapshot.summary.artifactCount, 1);
  assert.ok(restoredSnapshot.artifacts[0].content.includes("Workspace Context Bundle"));

  const rejectedCycle = workspace.setWorkspaceParent(
    parentWorkspace.workspaceId,
    childWorkspace.workspaceId,
    adminAccess
  );
  assert.equal(rejectedCycle.ok, false);

  const unshared = workspace.unshareWorkspace(
    sharedWorkspace.workspaceId,
    childWorkspace.workspaceId,
    adminAccess
  );
  assert.equal(unshared.ok, true);
  const unsharedContext = workspace.getWorkspaceContext(childWorkspace.workspaceId, adminAccess);
  assert.equal(unsharedContext.knowledgeSourceIds.includes("source-shared"), false);
  assert.notEqual(unsharedContext.contextFingerprint, resolvedContext.contextFingerprint);

  const approvedArtifacts = workspace.updateArtifactsStatus(run.runId, "approved");
  assert.equal(approvedArtifacts.every((item) => item.status === "approved"), true);
} finally {
  workspace.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

async function verifyHttpWorkspaceRuntimeInjection() {
  const httpUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-http-"));
  const server = await startHttpServer({
    userDataPath: httpUserDataPath,
    runtimeOptions: {
      mountModules: {
        documentParser: mockDocumentParserModulePath
      }
    }
  });
  await installAuthenticatedFetch(server);
  try {
    await fetchJson(`${server.url}/api/context/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profiles: [
          {
            profileId: "http-workspace-context",
            label: "HTTP Workspace Context",
            contextWindowTokens: 16000,
            outputReserveTokens: 1000,
            toolReserveTokens: 1000,
            fixedMemoryBudget: 200,
            knowledgeBudget: 1200,
            historyBudget: 1200,
            recentTurnBudget: 800
          }
        ]
      })
    });

    const parent = await fetchJson(`${server.url}/api/agent-workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "HTTP Parent", objective: "Base workspace context" })
    });
    const child = await fetchJson(`${server.url}/api/agent-workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "HTTP Child", objective: "Hot swapped workspace context" })
    });
    const shared = await fetchJson(`${server.url}/api/agent-workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "HTTP Shared", objective: "Shared workspace context" })
    });
    const parentId = parent.workspace.workspaceId;
    const childId = child.workspace.workspaceId;
    const sharedId = shared.workspace.workspaceId;

    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(parentId)}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextProfileId: "parent-http-context",
        modelAlias: "parent-http-model",
        knowledgeScope: {
          includeSourceIds: ["source-parent-profile"]
        }
      })
    });
    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(childId)}/parent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentWorkspaceId: parentId })
    });
    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(childId)}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextProfileId: "http-workspace-context",
        modelAlias: "http-workspace-model",
        toolGrantId: "http-workspace-grant",
        knowledgeScope: {
          excludeSourceIds: ["source-parent-profile"]
        }
      })
    });
    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(sharedId)}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceIds: ["source-shared-empty"] })
    });
    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(sharedId)}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetWorkspaceId: childId })
    });

    const job = await fetchJson(`${server.url}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadedFiles: [
          buildUploadedEmail("Workspace Allowed.eml", "needleworkspace allowed source evidence"),
          buildUploadedEmail("Workspace Denied.eml", "needleworkspace denied source evidence")
        ],
        settings: {
          knowledgeCoreEnabled: true,
          ocrEnabled: false
        }
      })
    });
    await waitForJob(server.url, job.id);
    const result = await fetchJson(`${server.url}/api/jobs/${encodeURIComponent(job.id)}/result`);
    const allowedSource = result.sourceFiles.find((item) => item.originalFileName === "Workspace Allowed.eml");
    assert.ok(allowedSource?.id);
    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(childId)}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceIds: [allowedSource.id] })
    });

    const context = await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(childId)}/context`);
    assert.equal(context.contextProfileId, "http-workspace-context");
    assert.equal(context.modelAlias, "http-workspace-model");
    assert.equal(context.toolGrantId, "http-workspace-grant");
    assert.ok(context.knowledgeSourceIds.includes(allowedSource.id));
    assert.ok(context.knowledgeSourceIds.includes("source-shared-empty"));
    assert.ok(!context.knowledgeSourceIds.includes("source-parent-profile"));
    assert.ok(context.contextFingerprint);

    const httpSessions = await fetchJson(
      `${server.url}/api/agent-sessions?workspaceId=${encodeURIComponent(childId)}&limit=20`
    );
    assert.equal(httpSessions.sessionProtocolVersion, AGENT_SESSION_THREAD_VERSION);
    assert.equal(httpSessions.appendOnly, true);
    const httpRootSession = httpSessions.sessions.find((item) => item.workspaceId === childId);
    assert.ok(httpRootSession?.sessionId);
    const httpSessionEvent = await fetchJson(
      `${server.url}/api/agent-sessions/${encodeURIComponent(httpRootSession.sessionId)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "http_verify",
          title: "HTTP 会话事件",
          summary: "HTTP 入口只能追加会话事件"
        })
      }
    );
    assert.equal(httpSessionEvent.event.type, "http_verify");
    const httpFork = await fetchJson(
      `${server.url}/api/agent-sessions/${encodeURIComponent(httpRootSession.sessionId)}/fork`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "HTTP 会话分叉" })
      }
    );
    assert.equal(httpFork.ok, true);
    assert.equal(httpFork.session.parentSessionId, httpRootSession.sessionId);
    const httpForkContext = await fetchJson(
      `${server.url}/api/agent-sessions/${encodeURIComponent(httpFork.session.sessionId)}/context`
    );
    assert.equal(httpForkContext.agentSessionId, httpFork.session.sessionId);
    assert.equal(httpForkContext.workspaceId, childId);
    assert.equal(httpForkContext.contextProfileId, "http-workspace-context");
    const previewBySession = await fetchJson(`${server.url}/api/context/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentSessionId: httpFork.session.sessionId,
        taskBrief: "session context preview",
        record: false
      })
    });
    assert.equal(previewBySession.contextPack.workspaceContext.agentSessionId, httpFork.session.sessionId);
    assert.equal(previewBySession.contextPack.profileId, "http-workspace-context");

    const contextBundle = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(childId)}/context-bundle?maxItems=4&contentPreviewChars=64`
    );
    assert.equal(contextBundle.bundleVersion, "v0.0.1:workspace:context-bundle-1");
    assert.equal(contextBundle.contextFingerprint, context.contextFingerprint);
    assert.equal(contextBundle.bundle.context.workspaceId, childId);
    assert.equal(contextBundle.bundle.context.contextProfileId, "http-workspace-context");
    assert.equal(contextBundle.restoreEvidence.knowledgeSourceCount, context.knowledgeSourceIds.length);
    assert.equal(contextBundle.compressed.encoding, "gzip+base64");
    const restoredHttpBundle = JSON.parse(
      gunzipSync(Buffer.from(contextBundle.compressed.payload, "base64")).toString("utf8")
    );
    assert.equal(restoredHttpBundle.context.contextFingerprint, context.contextFingerprint);
    assert.ok(restoredHttpBundle.handoffMarkdown.includes("http-workspace-context"));

    const compressedOnly = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(childId)}/context-bundle?format=compressed`
    );
    assert.equal(compressedOnly.bundle, undefined);
    assert.equal(compressedOnly.compressed.encoding, "gzip+base64");

    const rpcBundle = await fetchJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "workspace-context-bundle",
        method: "agent_workspaces.context_bundle.export",
        params: {
          workspaceId: childId,
          format: "compressed"
        }
      })
    });
    assert.equal(rpcBundle.jsonrpc, "2.0");
    assert.equal(rpcBundle.result.contextFingerprint, context.contextFingerprint);
    assert.equal(rpcBundle.result.bundle, undefined);
    assert.equal(rpcBundle.result.compressed.encoding, "gzip+base64");

    const restoreTarget = await fetchJson(`${server.url}/api/agent-workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "HTTP Restored", objective: "Restore context bundle over HTTP" })
    });
    const restoreTargetBefore = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(restoreTarget.workspace.workspaceId)}/context`
    );
    const rejectedRestore = await fetchJsonResponse(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(restoreTarget.workspace.workspaceId)}/context-bundle/restore`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compressed: contextBundle.compressed,
          bundleHash: "tampered-context-bundle-hash"
        })
      }
    );
    assert.equal(rejectedRestore.status, 400);
    assert.match(rejectedRestore.payload.error, /hash/);
    const restoreTargetAfterRejected = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(restoreTarget.workspace.workspaceId)}/context`
    );
    assert.equal(restoreTargetAfterRejected.contextFingerprint, restoreTargetBefore.contextFingerprint);
    const restored = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(restoreTarget.workspace.workspaceId)}/context-bundle/restore`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compressed: contextBundle.compressed,
          bundleHash: contextBundle.bundleHash
        })
      }
    );
    assert.equal(restored.ok, true);
    assert.equal(restored.applied.contextProfileId, "http-workspace-context");
    assert.equal(restored.restoredContext.modelAlias, "http-workspace-model");
    assert.equal(restored.restoredContext.toolGrantId, "http-workspace-grant");
    assert.deepEqual(new Set(restored.restoredContext.knowledgeSourceIds), new Set(context.knowledgeSourceIds));
    const restoredSnapshot = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(restoreTarget.workspace.workspaceId)}`
    );
    assert.equal(restoredSnapshot.summary.runCount, 1);
    assert.equal(restoredSnapshot.summary.artifactCount, 1);

    const rpcRestoreTarget = await fetchJson(`${server.url}/api/agent-workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "RPC Restored", objective: "Restore context bundle over RPC" })
    });
    const rpcRestore = await fetchJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "workspace-context-bundle-restore",
        method: "agent_workspaces.context_bundle.restore",
        params: {
          workspaceId: rpcRestoreTarget.workspace.workspaceId,
          compressed: contextBundle.compressed,
          bundleHash: contextBundle.bundleHash
        }
      })
    });
    assert.equal(rpcRestore.jsonrpc, "2.0");
    assert.equal(rpcRestore.result.ok, true);
    assert.equal(rpcRestore.result.restoredContext.contextProfileId, "http-workspace-context");

    const preview = await fetchJson(`${server.url}/api/context/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: childId,
        taskBrief: "workspace context preview",
        record: false
      })
    });
    assert.equal(preview.contextPack.profileId, "http-workspace-context");
    assert.equal(preview.contextPack.workspaceContext.workspaceId, childId);
    assert.equal(preview.contextPack.workspaceGeneration, context.currentGeneration);

    const scopedSearch = await fetchJson(`${server.url}/api/knowledge/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: childId,
        query: "needleworkspace",
        learningEnabled: false,
        limit: 10,
        explain: true
      })
    });
    assert.equal(scopedSearch.workspaceContext.workspaceId, childId);
    assert.ok(scopedSearch.items.length > 0);
    assert.ok(scopedSearch.items.some((item) => /Workspace Allowed/.test(item.title)));
    assert.ok(scopedSearch.items.every((item) => !/Workspace Denied/.test(item.title)));

    createConsoleUser(httpUserDataPath, {
      username: "operator-a",
      password: "operator-a-password-123",
      role: "operator"
    });
    createConsoleUser(httpUserDataPath, {
      username: "operator-b",
      password: "operator-b-password-123",
      role: "operator"
    });
    const operatorA = await loginConsoleUser(server.url, "operator-a", "operator-a-password-123");
    const operatorB = await loginConsoleUser(server.url, "operator-b", "operator-b-password-123");

    const operatorAWorkspace = await fetchJson(`${server.url}/api/agent-workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(operatorA, { method: "POST" })
      },
      body: JSON.stringify({
        title: "Operator A Workspace",
        objective: "Tenant A working state"
      })
    });
    const operatorBWorkspace = await fetchJson(`${server.url}/api/agent-workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(operatorB, { method: "POST" })
      },
      body: JSON.stringify({
        title: "Operator B Workspace",
        objective: "Tenant B working state"
      })
    });
    const operatorAWorkspaceId = operatorAWorkspace.workspace.workspaceId;
    const operatorBWorkspaceId = operatorBWorkspace.workspace.workspaceId;
    assert.equal(operatorAWorkspace.workspace.ownerUserId, operatorA.session.user.userId);
    assert.equal(operatorBWorkspace.workspace.ownerUserId, operatorB.session.user.userId);

    const operatorAList = await fetchJson(`${server.url}/api/agent-workspaces`, {
      headers: authHeaders(operatorA)
    });
    const operatorAVisibleIds = operatorAList.workspaces.map((item) => item.workspaceId);
    assert.ok(operatorAVisibleIds.includes(operatorAWorkspaceId));
    assert.equal(operatorAVisibleIds.includes(operatorBWorkspaceId), false);
    assert.equal(operatorAVisibleIds.includes(childId), false);

    const operatorBOwnContext = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context`,
      { headers: authHeaders(operatorB) }
    );
    assert.equal(operatorBOwnContext.workspaceId, operatorBWorkspaceId);

    const ownerCanReadOperatorB = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context`
    );
    assert.equal(ownerCanReadOperatorB.workspaceId, operatorBWorkspaceId);

    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(operatorAWorkspaceId)}/profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(operatorA, { method: "POST" })
      },
      body: JSON.stringify({
        contextProfileId: "operator-a-context",
        modelAlias: "operator-a-model",
        toolGrantId: "operator-a-tools",
        knowledgeScope: {
          includeSourceIds: ["operator-a-profile-source"]
        }
      })
    });
    await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(operatorAWorkspaceId)}/sources`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(operatorA, { method: "POST" })
      },
      body: JSON.stringify({
        sourceIds: ["operator-a-owned-source"]
      })
    });
    const operatorABundle = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorAWorkspaceId)}/context-bundle?format=compressed`,
      { headers: authHeaders(operatorA) }
    );
    assert.equal(operatorABundle.bundle, undefined);
    assert.equal(operatorABundle.compressed.encoding, "gzip+base64");

    const deniedOtherOperatorContext = await fetchJsonResponse(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context`,
      { headers: authHeaders(operatorA) }
    );
    assert.equal(deniedOtherOperatorContext.status, 404);

    const deniedOwnerWorkspaceContext = await fetchJsonResponse(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(childId)}/context`,
      { headers: authHeaders(operatorA) }
    );
    assert.equal(deniedOwnerWorkspaceContext.status, 404);

    const deniedOtherOperatorBundle = await fetchJsonResponse(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context-bundle`,
      { headers: authHeaders(operatorA) }
    );
    assert.equal(deniedOtherOperatorBundle.status, 404);
    const deniedOperatorABundleToB = await fetchJsonResponse(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorAWorkspaceId)}/context-bundle`,
      { headers: authHeaders(operatorB) }
    );
    assert.equal(deniedOperatorABundleToB.status, 404);

    const operatorBBeforeRestore = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context`,
      { headers: authHeaders(operatorB) }
    );
    const rejectedOperatorBRestore = await fetchJsonResponse(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context-bundle/restore`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(operatorB, { method: "POST" })
        },
        body: JSON.stringify({
          compressed: operatorABundle.compressed,
          bundleHash: "tampered-context-bundle-hash"
        })
      }
    );
    assert.equal(rejectedOperatorBRestore.status, 400);
    assert.match(rejectedOperatorBRestore.payload.error, /hash/);
    const operatorBAfterRejectedRestore = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context`,
      { headers: authHeaders(operatorB) }
    );
    assert.equal(operatorBAfterRejectedRestore.contextFingerprint, operatorBBeforeRestore.contextFingerprint);

    const operatorBRestoredFromA = await fetchJson(
      `${server.url}/api/agent-workspaces/${encodeURIComponent(operatorBWorkspaceId)}/context-bundle/restore`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(operatorB, { method: "POST" })
        },
        body: JSON.stringify({
          compressed: operatorABundle.compressed,
          bundleHash: operatorABundle.bundleHash
        })
      }
    );
    assert.equal(operatorBRestoredFromA.ok, true);
    assert.equal(operatorBRestoredFromA.restoredContext.workspaceId, operatorBWorkspaceId);
    assert.equal(operatorBRestoredFromA.restoredContext.contextProfileId, "operator-a-context");
    assert.equal(operatorBRestoredFromA.restoredContext.modelAlias, "operator-a-model");
    assert.equal(operatorBRestoredFromA.restoredContext.toolGrantId, "operator-a-tools");
    assert.deepEqual(operatorBRestoredFromA.restoredContext.knowledgeSourceIds, []);
    assert.equal(operatorBRestoredFromA.applied.knowledgeSourceCount, 0);
    assert.equal(operatorBRestoredFromA.applied.skippedKnowledgeSourceCount, 2);

    const deniedOtherWorkspacePreview = await fetchJsonResponse(`${server.url}/api/context/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(operatorA, { method: "POST" })
      },
      body: JSON.stringify({
        workspaceId: operatorBWorkspaceId,
        taskBrief: "team-shared preview should load another workspace",
        record: false
      })
    });
    assert.equal(deniedOtherWorkspacePreview.status, 404);

    const deniedOtherWorkspaceSearch = await fetchJsonResponse(`${server.url}/api/knowledge/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(operatorA, { method: "POST" })
      },
      body: JSON.stringify({
        workspaceId: operatorBWorkspaceId,
        query: "needleworkspace",
        learningEnabled: false,
        limit: 10
      })
    });
    assert.equal(deniedOtherWorkspaceSearch.status, 404);
  } finally {
    await server.close();
    await fs.rm(httpUserDataPath, {
      recursive: true,
      force: true
    });
  }
}

await verifyHttpWorkspaceRuntimeInjection();

console.log("Agent workspace verification passed.");
