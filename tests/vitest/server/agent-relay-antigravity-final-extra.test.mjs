import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMock.execFile
}));

import {
  AntigravityAgentApiClient,
  createAntigravityAgentApiCapabilitySnapshot,
  discoverAntigravityAgentApiEndpoint,
  extractAntigravityConversationId,
  normalizeAntigravityAgentApiResponse,
  readAntigravityConversationMessages,
  readAntigravityTranscriptEntries,
  resolveAntigravityConversationBrainPath,
  resolveAntigravityMessagesDir,
  resolveAntigravityTranscriptPath
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import {
  antigravityRelayProofMeetsMinimum,
  buildAntigravityRelayProof
} from "../../../server/scripts/acp-agent-relay-antigravity-proof.mjs";
import {
  defaultSourceConnectMinimumProofLevel,
  normalizeSourceConnectProofLevel,
  sourceConnectProofFromPromptResult,
  sourceConnectProofMeetsMinimum,
  strongestSourceConnectProof
} from "../../../server/scripts/acp-agent-relay-codex-antigravity-proof-level.mjs";
import {
  buildCodexCliRelayProof,
  selectCodexAntigravityVerifierResult
} from "../../../server/scripts/acp-agent-relay-codex-cli-proof.mjs";
import {
  buildSourceAgentProof,
  codexCliSupportsAcpClientHelp,
  codexCliSupportsMcpServerHelp
} from "../../../server/scripts/acp-agent-relay-source-agent-proof.mjs";
import { buildAcpAgentRelayProofMatrix } from "../../../server/scripts/acp-agent-relay-proof-matrix.mjs";
import {
  buildRealRelayProofBundle,
  parseJsonObjects,
  selectVerifierResult
} from "../../../server/scripts/acp-agent-relay-real-proof-bundle.mjs";

const tempRoots = [];

async function makeTempRoot(prefix = "pact-acp-agent-relay-antigravity-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  childProcessMock.execFile.mockReset();
  const roots = tempRoots.splice(0);
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

function sourceTurnObserveFixture({
  relaySessionId = "relay-session-1",
  relayTurnId = "relay-turn-1",
  stopReason = "target_error"
} = {}) {
  const responseKind = stopReason === "accepted" ? "acknowledgement" : stopReason;
  return {
    relaySessionId,
    relayTurnId,
    observed: true,
    refreshed: true,
    stopReason,
    responseKind,
    communicationSummary: {
      relaySessionId,
      relayTurnId,
      virtualAgentId: "antigravity.repo-analysis",
      targetId: "antigravity.agentapi",
      stopReason,
      summaryKind: responseKind,
      reasoningIncluded: false,
      finalResponseAvailable: false,
      targetErrorCode: "accepted_only"
    },
    targetObservation: {
      markerObserved: true,
      knownErrorAvailable: true
    }
  };
}

function communicationSummaryFixture({
  relaySessionId = "relay-session-1",
  relayTurnId = "relay-turn-1",
  virtualAgentId = "antigravity.repo-analysis",
  targetId = "antigravity.agentapi",
  stopReason = "target_error",
  responseKind = stopReason === "accepted" ? "acknowledgement" : stopReason,
  targetSessionId = "antigravity-conversation-1",
  targetResumeRef = "antigravity-conversation-1"
} = {}) {
  return {
    relaySessionId,
    relayTurnId,
    virtualAgentId,
    targetId,
    stopReason,
    summaryKind: responseKind,
    targetSessionId,
    targetResumeRef,
    reasoningIncluded: false
  };
}

function sourceIdentityIsolationFixture({
  ownerSourceId = "codex-source",
  foreignSourceId = "codex-source.foreign",
  relaySessionId = "relay-session-1"
} = {}) {
  return {
    ownerSourceId,
    foreignSourceId,
    relaySessionId,
    foreignInitializeSourceId: foreignSourceId,
    spoofedLoadErrorCode: "relay_session_not_found",
    requestBodyOverrideRejected: true,
    sessionEnumerationIsolated: true,
    spoofedSessionListOwnerVisible: false
  };
}

function sourceSessionCloseProofFixture({
  relaySessionId = "relay-session-1",
  closedSessionId = relaySessionId,
  closeLifecycleState = "closed",
  closeOk = true,
  promptAfterCloseErrorCode = "relay_session_closed",
  closedSessionLoadAfterRestartLifecycleState = "closed",
  resumeAfterCloseRestartErrorCode = "relay_session_closed",
  promptAfterCloseRestartErrorCode = "relay_session_closed"
} = {}) {
  return {
    relaySessionId,
    closedSessionId,
    closeLifecycleState,
    closeOk,
    promptAfterCloseErrorCode,
    closedSessionLoadAfterRestartLifecycleState,
    resumeAfterCloseRestartErrorCode,
    promptAfterCloseRestartErrorCode
  };
}

function antigravityIdeCliFixture() {
  return {
    provider: "antigravity-ide-cli",
    found: true,
    cliPath: "/Users/unka/.antigravity-ide/antigravity-ide/bin/antigravity-ide",
    version: "1.107.0",
    checkedCommands: ["--help", "chat --help"],
    subcommands: ["chat", "serve-web", "tunnel"],
    chatCommandSupported: true,
    chatReadsStdin: true,
    chatIsAcpTransport: false,
    mcpConfigSupported: true,
    nativeAcpCommandNames: [],
    nativeAcpTransportSupported: false,
    nativeAcpTargetVerified: false,
    nativeAcpSourceVerified: false,
    reasonCode: "native_acp_command_not_advertised"
  };
}

function targetCallbackApprovalFixture() {
  return {
    ok: true,
    verifier: "acp-agent-relay-target-callback-approval",
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    targetTransportType: "stdio",
    targetCallbackApprovalProofAcceptable: true,
    sameTurn: true,
    usedSessionResume: true,
    storedRequestStatus: "completed",
    relaySessionId: "relay-session-callback",
    relayTurnId: "relay-turn-callback",
    requestId: "relay-perm-callback",
    targetToolCallId: "target-callback-write-tool",
    pendingProof: {
      stopReason: "approval_pending",
      responseKind: "approval_pending",
      summaryKind: "approval_pending",
      pendingPermissionRequestCount: 1,
      persistedAfterRestart: true
    },
    pendingTurnObservationProof: {
      observed: false,
      reasonCode: "target_observation_unsupported",
      relayTurnId: "relay-turn-callback",
      responseKind: "approval_pending",
      summaryKind: "approval_pending",
      requestId: "relay-perm-callback"
    },
    resolveProof: {
      stopReason: "completed",
      responseKind: "final_response",
      summaryKind: "final_response",
      sameTurn: true,
      receiptCompleted: true,
      fileWritten: true
    },
    denialProof: {
      stopReason: "approval_denied",
      responseKind: "approval_denied",
      summaryKind: "approval_denied",
      sameTurn: true,
      pendingResponseKind: "approval_pending",
      pendingSummaryKind: "approval_pending",
      pendingPersistedAfterRestart: true,
      sessionResumedAfterRestart: true,
      permissionRequestStatus: "denied",
      storedRequestStatus: "denied",
      receiptReasonCode: "approval_denied",
      fileWritten: false,
      noContentLeak: true,
      deniedFilePath: "notes/target-callback-denied.txt",
      callbackRequestObserved: true,
      denialNotificationObserved: true,
      completionNotificationObserved: true
    },
    restartProof: {
      sessionLoaded: true,
      pendingPermissionRequestCount: 0,
      turnRecovered: true,
      responseKind: "final_response",
      summaryKind: "final_response",
      storedRequestStatus: "completed"
    },
    parentBindingProof: {
      parentRequestIdsBound: true,
      ambiguousRejected: true,
      ambiguousErrorCode: -32601,
      ambiguousReasonCode: "target_callback_parent_ambiguous",
      notFoundRejected: true,
      notFoundErrorCode: -32601,
      notFoundReasonCode: "target_callback_parent_not_found",
      staleParentRequestId: "stale-parent-request-not-found",
      rejectedFileWritten: false,
      callbackHandlerInvoked: false,
      noRelaySideEffect: true,
      permissionRequestCountAfterRejectedCallbacks: 2,
      expectedPermissionRequestCount: 2,
      proof: "pact-source-acp-to-stdio-target-callback-parent-binding-fail-closed"
    },
    sourceCancelProof: {
      relaySessionId: "relay_session_cancel",
      relayTurnId: "relay_turn_cancel",
      sourceAcpCancelMethod: "session/cancel",
      sourceCancelResponseOk: true,
      sourceCancelLifecycleState: "dormant",
      targetCancelObserved: true,
      targetCancelTargetSessionId: "target-callback-approval-session",
      cancelledTurnsCount: 1,
      cancelledTurnStopReason: "cancelled",
      cancelledTurnResponseKind: "cancelled",
      promptStopReason: "cancelled",
      promptResponseKind: "cancelled",
      promptSummaryKind: "cancelled",
      promptReasoningIncluded: false,
      lateTargetCompletionSuppressed: true,
      pendingPermissionRequestCountAfterCancel: 0,
      storedTurnStatus: "cancelled",
      storedTurnStopReason: "cancelled",
      permissionRequestCountAfterCancel: 2,
      expectedPermissionRequestCountAfterCancel: 2,
      proof: "pact-source-acp-to-stdio-target-session-cancel-running-prompt"
    },
    targetMethodProof: {
      methods: [
        "initialize",
        "session/new",
        "session/prompt",
        "fs/write_text_file:request",
        "initialize",
        "session/resume",
        "session/prompt",
        "fs/write_text_file:response",
        "session/new",
        "session/prompt",
        "fs/write_text_file:request",
        "session/cancel"
      ],
      usedSessionResume: true,
      usedSessionCancel: true,
      promptCount: 3,
      parentRequestIdsBound: true,
      callbackResponseCompleted: true,
      callbackRequestCount: 2,
      targetCancelCount: 1,
      denialCallbackRequested: true
    },
    proof: "pact-source-acp-to-stdio-target-callback-approval-resume-and-denial"
  };
}

function targetReconnectFixture() {
  return {
    ok: true,
    verifier: "acp-agent-relay-target-reconnect",
    marker: "PACT_TARGET_RECONNECT_VERIFY_1780000000000",
    relaySessionId: "relay-session-target-reconnect",
    firstRelayTurnId: "relay-turn-target-reconnect-1",
    secondRelayTurnId: "relay-turn-target-reconnect-2",
    virtualAgentId: "stdio.target-reconnect",
    targetId: "stdio.target:reconnect",
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    sourceAcpReady: "pact.acp.source_stdio.ready",
    sourceAcpMethods: ["initialize", "session/new", "session/prompt", "session/load", "_pact/session/get", "session/close"],
    targetTransportType: "stdio",
    targetCommunicationMode: "native_acp_stdio",
    nativeAcpTargetSupported: true,
    nativeAcpTargetVerified: true,
    targetReconnectProofAcceptable: true,
    firstPromptProof: {
      responseKind: "final_response",
      summaryKind: "final_response",
      targetSessionId: "target-reconnect-session-1",
      targetResumeRef: "target-reconnect-resume-1",
      finalResponseAvailable: true,
      reasoningIncluded: false
    },
    reconnectProof: {
      targetProcessRestartObserved: true,
      firstTargetProcessPid: 101,
      secondTargetProcessPid: 202,
      distinctTargetProcesses: true,
      firstTargetExitObserved: true,
      targetResumeRefPersistedBeforeReconnect: true,
      targetSessionResumeUsed: true,
      resumeTargetResumeRefMatchedFirst: true,
      secondPromptDeliveredAfterResume: true,
      sourceRelaySessionStable: true,
      distinctRelayTurns: true,
      firstTargetSessionId: "target-reconnect-session-1",
      secondTargetSessionId: "target-reconnect-session-2",
      targetSessionChangedAfterReconnect: true,
      firstTargetResumeRef: "target-reconnect-resume-1",
      secondTargetResumeRef: "target-reconnect-resume-2",
      targetResumeRefRefreshedAfterReconnect: true,
      responseKind: "final_response",
      summaryKind: "final_response",
      finalResponseAvailable: true,
      reasoningIncluded: false,
      sessionLoadAfterReconnectVerified: true,
      sessionGetAfterReconnectVerified: true,
      reasoningTraceReplaySuppressed: true
    },
    targetMethodProof: {
      methods: [
        "target_process_started",
        "initialize",
        "session/new",
        "session/prompt",
        "target_process_exit_after_first_prompt",
        "target_process_exit",
        "target_process_started",
        "initialize",
        "session/resume",
        "session/prompt"
      ],
      initializeCount: 2,
      targetProcessStartCount: 2,
      targetProcessPids: [101, 202],
      sessionNewCount: 1,
      sessionResumeCount: 1,
      promptCount: 2,
      usedSessionNew: true,
      usedSessionResumeAfterTargetRestart: true,
      targetPromptCountAfterReconnect: 2
    },
    proof: "pact-source-acp-to-stdio-target-reconnect-resume"
  };
}

function targetLoadReconnectFixture() {
  return {
    ok: true,
    verifier: "acp-agent-relay-target-load-reconnect",
    marker: "PACT_TARGET_LOAD_RECONNECT_VERIFY_1780000000000",
    relaySessionId: "relay-session-target-load-reconnect",
    firstRelayTurnId: "relay-turn-target-load-reconnect-1",
    secondRelayTurnId: "relay-turn-target-load-reconnect-2",
    virtualAgentId: "stdio.target-load-reconnect",
    targetId: "stdio.target:load-reconnect",
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    sourceAcpReady: "pact.acp.source_stdio.ready",
    sourceAcpMethods: ["initialize", "session/new", "session/prompt", "session/load", "_pact/session/get", "session/close"],
    targetTransportType: "stdio",
    targetCommunicationMode: "native_acp_stdio",
    nativeAcpTargetSupported: true,
    nativeAcpTargetVerified: true,
    targetLoadReconnectProofAcceptable: true,
    firstPromptProof: {
      responseKind: "final_response",
      summaryKind: "final_response",
      targetSessionId: "target-load-reconnect-session-1",
      targetResumeRef: "target-load-reconnect-resume-1",
      finalResponseAvailable: true,
      reasoningIncluded: false
    },
    loadReconnectProof: {
      targetProcessRestartObserved: true,
      firstTargetProcessPid: 303,
      secondTargetProcessPid: 404,
      distinctTargetProcesses: true,
      firstTargetExitObserved: true,
      targetResumeRefPersistedBeforeReconnect: true,
      targetSessionLoadUsed: true,
      targetSessionResumeNotUsed: true,
      loadTargetResumeRefMatchedFirst: true,
      secondPromptDeliveredAfterLoad: true,
      sourceRelaySessionStable: true,
      distinctRelayTurns: true,
      firstTargetSessionId: "target-load-reconnect-session-1",
      secondTargetSessionId: "target-load-reconnect-session-2",
      targetSessionChangedAfterReconnect: true,
      firstTargetResumeRef: "target-load-reconnect-resume-1",
      secondTargetResumeRef: "target-load-reconnect-resume-2",
      targetResumeRefRefreshedAfterReconnect: true,
      responseKind: "final_response",
      summaryKind: "final_response",
      finalResponseAvailable: true,
      reasoningIncluded: false,
      sessionLoadAfterReconnectVerified: true,
      sessionGetAfterReconnectVerified: true,
      reasoningTraceReplaySuppressed: true
    },
    targetMethodProof: {
      methods: [
        "target_process_started",
        "initialize",
        "session/new",
        "session/prompt",
        "target_process_exit_after_first_prompt",
        "target_process_exit",
        "target_process_started",
        "initialize",
        "session/load",
        "session/prompt"
      ],
      initializeCount: 2,
      targetProcessStartCount: 2,
      targetProcessPids: [303, 404],
      sessionNewCount: 1,
      sessionLoadCount: 1,
      sessionResumeCount: 0,
      promptCount: 2,
      usedSessionNew: true,
      usedSessionLoadAfterTargetRestart: true,
      usedSessionResumeAfterTargetRestart: false,
      targetPromptCountAfterReconnect: 2
    },
    proof: "pact-source-acp-to-stdio-target-reconnect-load"
  };
}

function idempotencyFixture() {
  return {
    ok: true,
    verifier: "acp-agent-relay-idempotency",
    marker: "PACT_ACP_IDEMPOTENCY_VERIFY_1780000000000",
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    targetTransportType: "stdio",
    relaySessionId: "relay-session-idempotency",
    relayTurnId: "relay-turn-idempotency",
    idempotencyKey: "idempotency-key",
    idempotencyProofAcceptable: true,
    firstProof: {
      stopReason: "completed",
      responseKind: "final_response",
      summaryKind: "final_response",
      idempotencyReplay: false,
      targetPromptCount: 1,
      turnCount: 1,
      reasoningIncluded: false
    },
    replayProof: {
      idempotencyReplay: true,
      sameTurn: true,
      responseKind: "final_response",
      summaryKind: "final_response",
      targetPromptCountAfterReplay: 1,
      turnCountAfterReplay: 1,
      newEventsCount: 0,
      usedSourceRestart: true
    },
    conflictProof: {
      conflictRejected: true,
      errorCode: "idempotency_key_conflict",
      targetPromptCountAfterConflict: 1,
      turnCountAfterConflict: 1
    },
    targetMethodProof: {
      promptCount: 1,
      methods: ["initialize", "session/new", "session/prompt"],
      targetNotReawakenedForReplay: true,
      targetNotReawakenedForConflict: true
    },
    proof: "pact-source-acp-stdio-idempotency-replay-and-conflict"
  };
}

function codexAcpTargetFixture() {
  return {
    ok: true,
    verifier: "acp-agent-relay-codex-acp-target",
    codexCliPath: "/opt/homebrew/bin/codex",
    codexCliVersion: "codex-cli 0.130.0",
    adapterExecutable: "npx",
    adapterArgs: ["--yes", "@zed-industries/codex-acp"],
    adapterInvocation: "npx-codex-acp",
    adapterInstallPackage: "@zed-industries/codex-acp",
    adapterPackageVersion: "0.15.0",
    relaySessionId: "relay-session-codex-acp-target",
    relayTurnId: "relay-turn-codex-acp-target",
    virtualAgentId: "codex.acp-real",
    targetId: "codex.acp:real",
    transportType: "stdio",
    codexAcpTargetProcessVerified: true,
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    sourceAcpMethods: ["initialize", "session/new", "session/prompt", "_pact/target/list", "_pact/session/list", "_pact/session/get", "_pact/turn/list", "_pact/turn/observe", "session/load", "session/close"],
    responseKind: "final_response",
    summaryKind: "final_response",
    sourceAcpResponseKindProjected: true,
    sourceAcpFinalResponseProjected: true,
    sourceAcpOperationalMethodsVerified: true,
    sourceAcpSessionLoadAfterRestartVerified: true,
    operationalDiscoveryProof: {
      targetListed: true,
      sessionListed: true,
      sessionGetMatchedTurn: true,
      turnListed: true,
      turnObserveReasonCode: "target_observation_unsupported",
      targetDescriptorCommandRedacted: true,
      targetCommunicationMode: "native_acp_stdio",
      nativeAcpTargetSupported: true,
      nativeAcpTargetVerifiedByDiscovery: false
    },
    restartSessionLoadProof: {
      sourceAcpReady: "pact.acp.source_stdio.ready",
      relaySessionId: "relay-session-codex-acp-target",
      targetResumeRef: "target-resume-codex-acp",
      replayedUpdateCount: 1,
      replayNotificationCount: 1,
      sessionListedAfterRestart: true,
      pendingPermissionRequestCount: 0,
      requestReasoning: false,
      reasoningTraceReplaySuppressed: true
    },
    finalResponseAvailable: true,
    targetCommunicationMode: "codex_acp_stdio",
    nativeAcpTargetSupported: true,
    nativeAcpTargetVerified: true,
    nativeCodexCliAcpSource: false,
    proof: "pact-relay-to-real-codex-acp-stdio-target"
  };
}

function downstreamCodexAcpTargetFixture() {
  return {
    ...codexAcpTargetFixture(),
    verifier: "acp-agent-relay-downstream-codex-acp-target",
    relaySessionId: "relay-session-downstream-codex-acp-target",
    relayTurnId: "relay-turn-downstream-codex-acp-target",
    virtualAgentId: "codex.acp-agent",
    targetId: "codex.acp:default",
    downstreamClientAspectStarted: true,
    downstreamClientAspectAssemblyUsed: true,
    downstreamClientAspectProofAcceptable: true,
    agentDiscoveryProof: {
      agentListed: true,
      targetId: "codex.acp:default",
      fromAspect: "downstream-client-aspect",
      frameworkId: "codex",
      adapterId: "codex-acp-stdio",
      toolListed: true
    },
    targetDiscoveryProof: {
      targetListed: true,
      targetDescriptorCommandRedacted: true,
      fromAspect: "downstream-client-aspect",
      frameworkId: "codex",
      adapterId: "codex-acp-stdio",
      transportType: "stdio",
      protocolStyle: "agent-client-protocol-v1",
      targetCommunicationMode: "native_acp_stdio",
      nativeAcpTargetSupported: true,
      nativeAcpTargetVerifiedByDiscovery: false
    },
    proof: "pact-downstream-client-aspect-to-real-codex-acp-stdio-target"
  };
}

describe("agent relay antigravity client edge coverage", () => {
  it("extracts metadata and parsed-text fallbacks for conversation ids", () => {
    assert.equal(
      extractAntigravityConversationId({
        response: {
          sendMessage: {
            recipientId: "recipient-from-response"
          }
        }
      }),
      "recipient-from-response"
    );

    assert.equal(
      extractAntigravityConversationId({
        response: {
          conversationMetadata: {
            metadata: {
              conversationId: "conversation-from-metadata"
            }
          }
        }
      }),
      "conversation-from-metadata"
    );

    assert.equal(
      extractAntigravityConversationId({
        response: {
          text: "update: conversation_id=metadata-text-id"
        }
      }),
      "metadata-text-id"
    );
  });

  it("normalizes Agent API responses with fallback text and computed status fields", () => {
    const normalized = normalizeAntigravityAgentApiResponse(
      {
        stop_reason: "workflow-complete",
        conversation_id: "normalized-cid",
        recipient: "normalized-recipient"
      },
      {
        stdout: `conversation_id: normalized-cid\nrecipient_id: normalized-recipient`
      }
    );

    assert.equal(normalized.conversationId, "normalized-cid");
    assert.equal(normalized.recipientId, "normalized-recipient");
    assert.equal(normalized.stopReason, "workflow-complete");
    assert.equal(normalized.stdout.includes("conversation_id"), true);
  });

  it("reads transcript entries and preserves parse errors from malformed lines", async () => {
    const tempRoot = await makeTempRoot();
    const conversationId = "conv-transcript-stream";
    const brainRoot = tempRoot;
    const transcriptPath = resolveAntigravityTranscriptPath(conversationId, { brainRoot });
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    const entries = [
      JSON.stringify({
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        step_index: 1,
        created_at: "2026-06-04T10:00:00Z",
        content: "已开始处理"
      }),
      "this line is not json",
      JSON.stringify({
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        step_index: 2,
        created_at: "2026-06-04T10:00:01Z",
        content: "测试通过，补充完成。"
      })
    ];
    await fs.writeFile(transcriptPath, `${entries.join("\n")}\n`, "utf8");

    const transcript = await readAntigravityTranscriptEntries({
      conversationId,
      brainRoot
    });

    assert.equal(transcript.transcriptPath, transcriptPath);
    assert.equal(transcript.lineCount, 3);
    assert.equal(transcript.entries.length, 3);
    assert.equal(transcript.entries[1].parseError.includes("Unexpected token"), true);
    assert.equal(transcript.entries[2].content, "测试通过，补充完成。");

    const lastOne = await readAntigravityTranscriptEntries({
      conversationId,
      brainRoot,
      maxEntries: 1
    });

    assert.equal(lastOne.entries.length, 1);
    assert.equal(lastOne.entries[0].lineIndex, 2);
  });

  it("reads conversation message files while skipping non-message artifacts", async () => {
    const tempRoot = await makeTempRoot();
    const conversationId = "conv-messages-probe";
    const messagesDir = resolveAntigravityMessagesDir(conversationId, { brainRoot: tempRoot });
    await fs.mkdir(messagesDir, { recursive: true });

    await fs.writeFile(path.join(messagesDir, "read.json"), "{}", "utf8");
    await fs.writeFile(path.join(messagesDir, "cursor.json"), "{}", "utf8");
    await fs.writeFile(path.join(messagesDir, "note.txt"), "ignore", "utf8");
    await fs.writeFile(
      path.join(messagesDir, "message-earlier.json"),
      JSON.stringify({
        id: "message-earlier",
        sender: "agent",
        recipient: conversationId,
        timestamp: "2026-06-04T10:00:00Z",
        content: "早期记录"
      }),
      "utf8"
    );
    const earlierPath = path.join(messagesDir, "message-earlier.json");
    const laterPath = path.join(messagesDir, "message-latest.json");
    await fs.utimes(earlierPath, new Date("2026-06-04T10:00:00Z"), new Date("2026-06-04T10:00:00Z"));
    await fs.writeFile(
      laterPath,
      JSON.stringify({
        id: "message-latest",
        sender: "system",
        recipient: conversationId,
        timestamp: "2026-06-04T10:00:10Z",
        content: "最新记录"
      }),
      "utf8"
    );
    await fs.utimes(laterPath, new Date("2026-06-04T10:00:10Z"), new Date("2026-06-04T10:00:10Z"));

    const messages = await readAntigravityConversationMessages({
      conversationId,
      brainRoot: tempRoot,
      maxEntries: 1
    });

    assert.equal(messages.messagesDir, messagesDir);
    assert.equal(messages.messageCount, 2);
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.messages[0].id, "message-latest");
    assert.match(messages.messages[0].contentPreview, /最新记录/);
  });

  it("does not treat metadata-only Agent API reachability as relay proof", () => {
    const metadataOnly = buildAntigravityRelayProof({
      before: { id: "conversation-proof", mtimeMs: 1000, size: 100 },
      changedConversation: null,
      localObservation: {
        markerObserved: false,
        markerMessageObserved: false
      },
      metadataProbe: {
        response: {
          conversationMetadata: {}
        }
      }
    });

    assert.equal(metadataOnly.ok, false);
    assert.equal(metadataOnly.proof, "");
    assert.equal(metadataOnly.proofLevel, "none");
    assert.equal(metadataOnly.proofMeetsMinimum, false);
    assert.equal(metadataOnly.metadataProbeDiagnostic, "ok");

    const fileChanged = buildAntigravityRelayProof({
      before: { id: "conversation-proof", mtimeMs: 1000, size: 100 },
      changedConversation: { id: "conversation-proof", mtimeMs: 1100, size: 100 },
      localObservation: {}
    });
    assert.equal(fileChanged.ok, true);
    assert.equal(fileChanged.proof, "conversation-file");
    assert.equal(fileChanged.proofLevel, "conversation_file");
    assert.equal(fileChanged.proofMeetsMinimum, true);
    assert.equal(antigravityRelayProofMeetsMinimum(fileChanged.proofLevel, "local_marker_observation"), true);
    assert.equal(antigravityRelayProofMeetsMinimum(fileChanged.proofLevel, "conversation_file_and_local_marker_observation"), false);

    const markerObserved = buildAntigravityRelayProof({
      before: { id: "conversation-proof", mtimeMs: 1000, size: 100 },
      changedConversation: null,
      localObservation: {
        markerMessageObserved: true
      },
      metadataProbe: {
        response: {
          conversationMetadata: {}
        }
      }
    });
    assert.equal(markerObserved.ok, true);
    assert.equal(markerObserved.proof, "local-marker-observation");
    assert.equal(markerObserved.proofLevel, "local_marker_observation");
    assert.equal(markerObserved.proofMeetsMinimum, true);
    assert.equal(markerObserved.metadataProbeDiagnostic, "ok");

    const markerBelowStrictFile = buildAntigravityRelayProof({
      before: { id: "conversation-proof", mtimeMs: 1000, size: 100 },
      changedConversation: null,
      localObservation: {
        markerMessageObserved: true
      },
      minimumProofLevel: "conversation_file"
    });
    assert.equal(markerBelowStrictFile.ok, true);
    assert.equal(markerBelowStrictFile.proofLevel, "local_marker_observation");
    assert.equal(markerBelowStrictFile.minimumProofLevel, "conversation_file");
    assert.equal(markerBelowStrictFile.proofMeetsMinimum, false);

    const fullProof = buildAntigravityRelayProof({
      before: { id: "conversation-proof", mtimeMs: 1000, size: 100 },
      changedConversation: { id: "conversation-proof", mtimeMs: 1200, size: 130 },
      localObservation: {
        markerMessageObserved: true
      },
      minimumProofLevel: "full"
    });
    assert.equal(fullProof.proofLevel, "conversation_file_and_local_marker_observation");
    assert.equal(fullProof.minimumProofLevel, "conversation_file_and_local_marker_observation");
    assert.equal(fullProof.proofMeetsMinimum, true);
  });

  it("classifies source-facing Antigravity Connect proof levels with explicit minimum gates", () => {
    const markerOnly = sourceConnectProofFromPromptResult({
      turnId: "turn-marker",
      stopReason: "accepted",
      targetEvidence: {
        connectConversationObservation: {
          markerObserved: true
        }
      }
    }, "markerOnly");
    assert.equal(markerOnly.proofLevel, "connect_marker_only");

    const targetError = sourceConnectProofFromPromptResult({
      turnId: "turn-error",
      stopReason: "target_error",
      targetEvidence: {
        finalResponsePolicy: "target_error",
        targetError: { code: "antigravity_connect_failed", message: "target failed after marker" },
        connectConversationObservation: {
          markerObserved: true,
          trajectoryAdvanced: true
        }
      }
    }, "targetError");
    assert.equal(targetError.proofLevel, "connect_target_error");
    assert.equal(sourceConnectProofMeetsMinimum(targetError.proofLevel, "connect_target_error"), true);
    assert.equal(sourceConnectProofMeetsMinimum(targetError.proofLevel, "connect_formal_deny"), false);
    assert.equal(sourceConnectProofMeetsMinimum(targetError.proofLevel, "connect_final_response"), false);

    const finalResponse = sourceConnectProofFromPromptResult({
      turnId: "turn-final",
      stopReason: "completed",
      targetEvidence: {
        finalResponsePolicy: "connect_trajectory",
        finalResponseAvailable: true,
        connectConversationObservation: {
          markerObserved: true,
          finalResponseAvailable: true
        }
      }
    }, "finalResponse");
    assert.equal(finalResponse.proofLevel, "connect_final_response");
    assert.equal(strongestSourceConnectProof([markerOnly, targetError, finalResponse]).label, "finalResponse");

    assert.equal(normalizeSourceConnectProofLevel("target-error"), "connect_target_error");
    assert.equal(normalizeSourceConnectProofLevel("final_response"), "connect_final_response");
    assert.equal(defaultSourceConnectMinimumProofLevel({ connectRequired: true }), "connect_target_error");
    assert.equal(defaultSourceConnectMinimumProofLevel({ connectRequired: true, finalRequired: true }), "connect_final_response");
    assert.equal(
      defaultSourceConnectMinimumProofLevel({
        connectRequired: true,
        denyPendingCommandsRequired: true
      }),
      "connect_formal_deny"
    );
    assert.equal(
      defaultSourceConnectMinimumProofLevel({
        connectRequired: true,
        envMinimum: "progress"
      }),
      "connect_progress"
    );
  });

  it("keeps Codex source provenance separate from the Pact stdio verifier harness", () => {
    const currentCodexHelp = `
Usage: codex [OPTIONS] [PROMPT]

Commands:
  exec        Run Codex non-interactively
  review      Review code
  mcp         Manage MCP servers
  mcp-server  Start Codex as an MCP server
`;
    const currentExecHelp = `
Usage: codex exec [OPTIONS] [PROMPT]

Options:
  --config <key=value>
  --model <MODEL>
`;

    assert.equal(codexCliSupportsAcpClientHelp(currentCodexHelp, currentExecHelp), false);
    assert.equal(codexCliSupportsMcpServerHelp(currentCodexHelp), true);

    const orchestrated = buildSourceAgentProof({
      actualSourceProcess: "/opt/homebrew/bin/node /repo/server/scripts/acp-agent-relay-source-stdio.mjs",
      actualSourceTransport: "pact-source-facing-acp-stdio",
      codexCliPath: "/opt/homebrew/bin/codex",
      codexCliVersion: "codex-cli 0.130.0",
      codexHelpText: currentCodexHelp,
      codexExecHelpText: currentExecHelp
    });
    assert.equal(orchestrated.sourceAgentKind, "pact-source-acp-stdio-verifier");
    assert.equal(orchestrated.sourceMode, "orchestrated_harness");
    assert.equal(orchestrated.directCodexCliAcpSourceVerified, false);
    assert.equal(orchestrated.codexCliAcpClientSupported, false);
    assert.equal(orchestrated.proofLevel, "codex-orchestrated-source-acp-stdio");

    const futureHelp = `${currentCodexHelp}\n  acp         Start Codex in ACP source mode\n`;
    const supportedButNotUsed = buildSourceAgentProof({
      actualSourceProcess: "/opt/homebrew/bin/node /repo/server/scripts/acp-agent-relay-source-stdio.mjs",
      actualSourceTransport: "pact-source-facing-acp-stdio",
      codexHelpText: futureHelp
    });
    assert.equal(supportedButNotUsed.codexCliAcpClientSupported, true);
    assert.equal(supportedButNotUsed.directCodexCliAcpSourceVerified, false);
    assert.equal(supportedButNotUsed.sourceAgentKind, "pact-source-acp-stdio-verifier");
    assert.equal(supportedButNotUsed.proofLevel, "codex-cli-acp-source-supported-but-not-used");

    const direct = buildSourceAgentProof({
      actualSourceProcess: "/opt/homebrew/bin/codex --acp",
      actualSourceTransport: "codex-cli-acp-stdio",
      codexHelpText: futureHelp
    });
    assert.equal(direct.sourceAgentKind, "codex-cli-acp-source");
    assert.equal(direct.sourceMode, "native");
    assert.equal(direct.directCodexCliAcpSourceVerified, true);

    const matrix = buildAcpAgentRelayProofMatrix({
      sourceAgentProof: orchestrated,
      sourceImplementation: "pact-source-stdio-server",
      sourceMode: orchestrated.sourceMode,
      sessionId: "relay-session-1",
      loadedSessionId: "relay-session-1",
      resumedSessionId: "relay-session-1",
      persistedTargetSessionId: "antigravity-conversation-1",
      persistedTargetResumeRef: "antigravity-conversation-1",
      agentCatalogCount: 1,
      antigravityProofLevel: "conversation_file",
      minimumAntigravityProofLevel: "conversation_file",
      antigravityProofMeetsMinimum: true,
      firstResponseKind: "acknowledgement",
      secondResponseKind: "acknowledgement",
      responseKind: "acknowledgement",
      firstCommunicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-0",
        stopReason: "accepted"
      }),
      secondCommunicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-1",
        stopReason: "accepted"
      }),
      communicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-1",
        stopReason: "accepted"
      }),
      sourceTurnObserve: sourceTurnObserveFixture({ stopReason: "accepted" }),
      sourceIdentityIsolationProof: sourceIdentityIsolationFixture(),
      sourceSessionCloseProof: sourceSessionCloseProofFixture(),
      antigravityIdeCliCapabilitySnapshot: antigravityIdeCliFixture()
    });
    assert.equal(matrix.allRequiredProofsMet, true);
    assert.equal(matrix.requirements.find((item) => item.id === "source_facing_multi_turn_continuity")?.status, "proven");
    assert.equal(matrix.requirements.find((item) => item.id === "source_identity_isolation")?.status, "proven");
    assert.equal(matrix.requirements.find((item) => item.id === "source_facing_session_close_terminal")?.status, "proven");
    assert.equal(matrix.requirements.find((item) => item.id === "codex_cli_participation")?.status, "not_required");
    assert.equal(matrix.requirements.find((item) => item.id === "native_codex_cli_acp_source")?.status, "unsupported");
    assert.equal(matrix.requirements.find((item) => item.id === "native_antigravity_ide_cli_acp_source")?.status, "unsupported");
    assert.equal(matrix.requirements.find((item) => item.id === "native_antigravity_ide_cli_acp_source")?.evidence.chatIsAcpTransport, false);
  });

  it("fails the relay proof matrix when the resumed prompt is not a distinct second turn", () => {
    const sourceAgentProof = buildSourceAgentProof({
      actualSourceProcess: "/opt/homebrew/bin/node /repo/server/scripts/acp-agent-relay-source-stdio.mjs",
      actualSourceTransport: "pact-source-facing-acp-stdio",
      codexHelpText: "Commands:\n  exec\n  mcp-server\n",
      codexExecHelpText: "Usage: codex exec [OPTIONS]"
    });
    const matrix = buildAcpAgentRelayProofMatrix({
      sourceAgentProof,
      sourceImplementation: "pact-source-stdio-server",
      sourceMode: "orchestrated_harness",
      sessionId: "relay-session-1",
      loadedSessionId: "relay-session-1",
      resumedSessionId: "relay-session-1",
      persistedTargetSessionId: "antigravity-conversation-1",
      persistedTargetResumeRef: "antigravity-conversation-1",
      agentCatalogCount: 1,
      antigravityProofLevel: "conversation_file",
      minimumAntigravityProofLevel: "conversation_file",
      antigravityProofMeetsMinimum: true,
      firstResponseKind: "target_error",
      secondResponseKind: "target_error",
      responseKind: "target_error",
      firstCommunicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      secondCommunicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      communicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      sourceTurnObserve: sourceTurnObserveFixture(),
      sourceIdentityIsolationProof: sourceIdentityIsolationFixture(),
      sourceSessionCloseProof: sourceSessionCloseProofFixture(),
      antigravityIdeCliCapabilitySnapshot: antigravityIdeCliFixture()
    });
    assert.equal(matrix.allRequiredProofsMet, false);
    assert.equal(matrix.failedRequiredIds.includes("source_facing_multi_turn_continuity"), true);
    assert.equal(matrix.requirements.find((item) => item.id === "source_facing_multi_turn_continuity")?.status, "failed");
    assert.equal(matrix.requirements.find((item) => item.id === "source_facing_multi_turn_continuity")?.evidence.distinctRelayTurns, false);
  });

  it("fails the relay proof matrix when source session close is not terminal", () => {
    const sourceAgentProof = buildSourceAgentProof({
      actualSourceProcess: "/opt/homebrew/bin/node /repo/server/scripts/acp-agent-relay-source-stdio.mjs",
      actualSourceTransport: "pact-source-facing-acp-stdio",
      codexHelpText: "Commands:\n  exec\n  mcp-server\n",
      codexExecHelpText: "Usage: codex exec [OPTIONS]"
    });
    const matrix = buildAcpAgentRelayProofMatrix({
      sourceAgentProof,
      sourceImplementation: "pact-source-stdio-server",
      sourceMode: "orchestrated_harness",
      sessionId: "relay-session-1",
      loadedSessionId: "relay-session-1",
      resumedSessionId: "relay-session-1",
      persistedTargetSessionId: "antigravity-conversation-1",
      persistedTargetResumeRef: "antigravity-conversation-1",
      agentCatalogCount: 1,
      antigravityProofLevel: "conversation_file",
      minimumAntigravityProofLevel: "conversation_file",
      antigravityProofMeetsMinimum: true,
      firstResponseKind: "acknowledgement",
      secondResponseKind: "acknowledgement",
      responseKind: "acknowledgement",
      firstCommunicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-0",
        stopReason: "accepted"
      }),
      secondCommunicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-1",
        stopReason: "accepted"
      }),
      communicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-1",
        stopReason: "accepted"
      }),
      sourceTurnObserve: sourceTurnObserveFixture({ stopReason: "accepted" }),
      sourceIdentityIsolationProof: sourceIdentityIsolationFixture(),
      sourceSessionCloseProof: sourceSessionCloseProofFixture({
        promptAfterCloseRestartErrorCode: ""
      }),
      antigravityIdeCliCapabilitySnapshot: antigravityIdeCliFixture()
    });
    assert.equal(matrix.allRequiredProofsMet, false);
    assert.equal(matrix.failedRequiredIds.includes("source_facing_session_close_terminal"), true);
    assert.equal(matrix.requirements.find((item) => item.id === "source_facing_session_close_terminal")?.status, "failed");
    assert.equal(
      matrix.requirements.find((item) => item.id === "source_facing_session_close_terminal")
        ?.evidence.promptAfterCloseRestartErrorCode,
      ""
    );
  });

  it("classifies Codex CLI participation proof without claiming native ACP source mode", () => {
    const marker = "PACT_CODEX_CLI_ACP_RELAY_VERIFY_1780000000000";
    const markerPreview = "PACT_CODEX_CLI_ACP_RELAY_VERIFY_17…";
    const relayJson = {
      ok: true,
      verifier: "acp-agent-relay-codex-antigravity",
      proof: "codex-orchestrated-source-acp-stdio-process-restart-and-conversation-file",
      sourceMode: "orchestrated_harness",
      sourceAgentProof: {
        sourceAgentKind: "pact-source-acp-stdio-verifier",
        directCodexCliAcpSourceVerified: false
      },
      sourceImplementation: "pact-source-stdio-server",
      sessionId: "relay-session-1",
      loadedSessionId: "relay-session-1",
      resumedSessionId: "relay-session-1",
      persistedTargetSessionId: "antigravity-conversation-1",
      persistedTargetResumeRef: "antigravity-conversation-1",
      agentCatalogCount: 1,
      antigravityProofLevel: "conversation_file",
      minimumAntigravityProofLevel: "conversation_file",
      antigravityProofMeetsMinimum: true,
      sourceConnectProofLevel: "connect_target_error",
      sourceConnectMinimumProofLevel: "connect_target_error",
      sourceConnectProofAcceptable: true,
      firstResponseKind: "acknowledgement",
      secondResponseKind: "target_error",
      responseKind: "target_error",
      firstCommunicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-0",
        stopReason: "accepted"
      }),
      secondCommunicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      communicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      sourceTurnObserve: sourceTurnObserveFixture(),
      sourceIdentityIsolationProof: sourceIdentityIsolationFixture(),
      sourceSessionCloseProof: sourceSessionCloseProofFixture(),
      ideCliCapabilitySnapshot: antigravityIdeCliFixture(),
      antigravityObservation: {
        latestMarkerMessage: {
          contentPreview: markerPreview
        }
      }
    };
    const rawRelayOutput = `log before\n${JSON.stringify(relayJson, null, 2)}\nlog after`;
    const parsed = selectCodexAntigravityVerifierResult(rawRelayOutput);
    assert.equal(parsed?.verifier, "acp-agent-relay-codex-antigravity");
    assert.equal(parsed?.sourceMode, "orchestrated_harness");

    const proof = buildCodexCliRelayProof({
      marker,
      codexCliPath: "/opt/homebrew/bin/codex",
      codexCliVersion: "codex-cli 0.130.0",
      codexExitCode: 0,
      relayResult: parsed,
      rawRelayOutput,
      connectRequired: true
    });
    assert.equal(proof.ok, true);
    assert.equal(proof.codexCliProcessVerified, true);
    assert.equal(proof.codexCliRanRelayJob, true);
    assert.equal(proof.markerObservedInRelayOutput, true);
    assert.equal(proof.markerFamilyObserved, true);
    assert.equal(proof.relaySourceMode, "orchestrated_harness");
    assert.equal(proof.relayDirectCodexCliAcpSourceVerified, false);
    assert.equal(proof.relaySecondResponseKind, "target_error");
    assert.equal(proof.relaySecondSummaryKind, "target_error");
    assert.equal(proof.relaySourceSessionCloseLifecycleState, "closed");
    assert.equal(proof.relaySourceSessionClosePromptAfterRestartErrorCode, "relay_session_closed");
    assert.equal(proof.proofMatrix.allRequiredProofsMet, true);
    assert.equal(proof.proofMatrix.requirements.find((item) => item.id === "source_facing_multi_turn_continuity")?.status, "proven");
    assert.equal(proof.proofMatrix.requirements.find((item) => item.id === "source_facing_session_close_terminal")?.status, "proven");
    assert.equal(proof.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.status, "proven");
    assert.equal(proof.proofMatrix.requirements.find((item) => item.id === "native_codex_cli_acp_source")?.status, "unsupported");

    const weakConnect = buildCodexCliRelayProof({
      marker,
      codexExitCode: 0,
      relayResult: {
        ...parsed,
        sourceConnectProofAcceptable: false
      },
      rawRelayOutput,
      connectRequired: true
    });
    assert.equal(weakConnect.ok, false);
    assert.equal(weakConnect.connectProofAcceptable, false);
  });

  it("builds a stable real-gate proof bundle from verifier JSON output", () => {
    const sourceAgentProof = buildSourceAgentProof({
      actualSourceProcess: "/opt/homebrew/bin/node /repo/server/scripts/acp-agent-relay-source-stdio.mjs",
      actualSourceTransport: "pact-source-facing-acp-stdio",
      codexCliPath: "/opt/homebrew/bin/codex",
      codexCliVersion: "codex-cli 0.130.0",
      codexHelpText: "Commands:\n  exec\n  mcp-server\n",
      codexExecHelpText: "Usage: codex exec [OPTIONS]"
    });
    const proofMatrix = buildAcpAgentRelayProofMatrix({
      sourceAgentProof,
      sourceImplementation: "pact-source-stdio-server",
      sourceMode: "orchestrated_harness",
      sessionId: "relay-session-1",
      loadedSessionId: "relay-session-1",
      resumedSessionId: "relay-session-1",
      persistedTargetSessionId: "antigravity-conversation-1",
      persistedTargetResumeRef: "antigravity-conversation-1",
      agentCatalogCount: 1,
      antigravityProofLevel: "conversation_file_and_local_marker_observation",
      minimumAntigravityProofLevel: "conversation_file",
      antigravityProofMeetsMinimum: true,
      firstResponseKind: "acknowledgement",
      secondResponseKind: "target_error",
      responseKind: "target_error",
      firstCommunicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-0",
        stopReason: "accepted"
      }),
      secondCommunicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      communicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      sourceTurnObserve: sourceTurnObserveFixture(),
      sourceIdentityIsolationProof: sourceIdentityIsolationFixture(),
      sourceSessionCloseProof: sourceSessionCloseProofFixture(),
      antigravityIdeCliCapabilitySnapshot: antigravityIdeCliFixture(),
      connectRequired: true,
      sourceConnectProofLevel: "connect_target_error",
      sourceConnectMinimumProofLevel: "connect_target_error",
      sourceConnectProofAcceptable: true
    });
    const antigravityResult = {
      ok: true,
      verifier: "acp-agent-relay-antigravity",
      conversationId: "antigravity-conversation-1",
      endpointSource: "pid:123",
      proof: "conversation-file+local-marker-observation",
      proofLevel: "conversation_file_and_local_marker_observation",
      minimumProofLevel: "conversation_file",
      proofMeetsMinimum: true,
      changedConversationFile: "/tmp/conversation.pb",
      localObservation: {
        markerMessageObserved: true
      }
    };
    const codexAntigravityResult = {
      ok: true,
      verifier: "acp-agent-relay-codex-antigravity",
      proof: "codex-orchestrated-source-acp-stdio-process-restart-and-conversation-file+local-marker-observation",
      sourceImplementation: "pact-source-stdio-server",
      sourceMode: "orchestrated_harness",
      sourceAgentProof,
      sessionId: "relay-session-1",
      loadedSessionId: "relay-session-1",
      resumedSessionId: "relay-session-1",
      persistedTargetSessionId: "antigravity-conversation-1",
      persistedTargetResumeRef: "antigravity-conversation-1",
      agentCatalogCount: 1,
      antigravityProofLevel: "conversation_file_and_local_marker_observation",
      minimumAntigravityProofLevel: "conversation_file",
      antigravityProofMeetsMinimum: true,
      sourceConnectProofLevel: "connect_target_error",
      sourceConnectMinimumProofLevel: "connect_target_error",
      sourceConnectProofAcceptable: true,
      firstResponseKind: "acknowledgement",
      secondResponseKind: "target_error",
      responseKind: "target_error",
      firstCommunicationSummary: communicationSummaryFixture({
        relayTurnId: "relay-turn-0",
        stopReason: "accepted"
      }),
      secondCommunicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      communicationSummary: communicationSummaryFixture({ relayTurnId: "relay-turn-1" }),
      sourceTurnObserve: sourceTurnObserveFixture(),
      sourceIdentityIsolationProof: sourceIdentityIsolationFixture(),
      sourceSessionCloseProof: sourceSessionCloseProofFixture(),
      ideCliCapabilitySnapshot: antigravityIdeCliFixture(),
      proofMatrix
    };
    const mixedOutput = [
      "log before",
      JSON.stringify(antigravityResult, null, 2),
      "middle log",
      JSON.stringify(codexAntigravityResult, null, 2)
    ].join("\n");

    assert.equal(parseJsonObjects(mixedOutput).length, 2);
    assert.equal(selectVerifierResult(mixedOutput, "acp-agent-relay-codex-antigravity")?.verifier, "acp-agent-relay-codex-antigravity");

    const bundle = buildRealRelayProofBundle({
      connectRequired: true,
      antigravityResult,
      codexAntigravityResult,
      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: idempotencyFixture(),
      generatedAt: "2026-06-05T00:00:00.000Z",
      runResults: [
        { scriptPath: "server/scripts/verify-acp-agent-relay-antigravity.mjs", exitCode: 0, outputBytes: 120 },
        { scriptPath: "server/scripts/verify-acp-agent-relay-codex-antigravity.mjs", exitCode: 0, outputBytes: 240 }
      ]
    });
    assert.equal(bundle.ok, true);
    assert.equal(bundle.relayRequiredProofsMet, true);
    assert.equal(bundle.allRequiredProofsMet, true);
    assert.equal(bundle.verifier, "acp-agent-relay-real");
    assert.equal(bundle.antigravity.markerObserved, true);
    assert.equal(bundle.codexAntigravity.proofMatrixAllRequiredProofsMet, true);
    assert.equal(bundle.codexAntigravity.sourceIdentityIsolationProof.requestBodyOverrideRejected, true);
    assert.equal(bundle.codexAntigravity.sourceSessionCloseProof.closeLifecycleState, "closed");
    assert.equal(bundle.codexAntigravity.sourceSessionCloseProof.promptAfterCloseRestartErrorCode, "relay_session_closed");
    assert.deepEqual(
      bundle.codexAntigravity.proofMatrixUnsupportedIds,
      ["native_codex_cli_acp_source", "native_antigravity_ide_cli_acp_source"]
    );
    assert.equal(bundle.proofMatrix.schemaVersion, "v0.0.1:agent:acp-agent-relay-real-proof-matrix-1");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.status, "not_required");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.required, false);
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.status, "not_required");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.required, false);
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "native_codex_cli_acp_source")?.status, "unsupported");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "native_antigravity_ide_cli_acp_source")?.status, "unsupported");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "native_antigravity_ide_cli_acp_source")?.evidence.chatIsAcpTransport, false);
    assert.equal(bundle.relayProofMatrix.schemaVersion, "v0.0.1:agent:acp-agent-relay-proof-matrix-1");
    assert.equal(bundle.relayProofMatrix.requirements.find((item) => item.id === "source_facing_multi_turn_continuity")?.status, "proven");
    assert.equal(bundle.relayProofMatrix.requirements.find((item) => item.id === "source_facing_session_close_terminal")?.status, "proven");
    assert.equal(bundle.relayProofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.status, "not_required");
    assert.equal(bundle.targetCallbackApprovalProofAcceptable, true);
    assert.equal(bundle.targetCallbackApprovalResumeProofAcceptable, true);
    assert.equal(bundle.targetCallbackApprovalDenialProofAcceptable, true);
    assert.equal(bundle.targetCallbackParentBindingProofAcceptable, true);
    assert.equal(bundle.sourceFacingCancelProofAcceptable, true);
    assert.equal(bundle.targetReconnectProofAcceptable, true);
    assert.equal(bundle.targetLoadReconnectProofAcceptable, true);
    assert.equal(bundle.targetCallbackApproval.denialProof.responseKind, "approval_denied");
    assert.equal(bundle.targetCallbackApproval.denialProof.fileWritten, false);
    assert.equal(bundle.targetCallbackApproval.denialProof.noContentLeak, true);
    assert.equal(bundle.targetCallbackApproval.parentBindingProof.notFoundReasonCode, "target_callback_parent_not_found");
    assert.equal(bundle.targetCallbackApproval.parentBindingProof.noRelaySideEffect, true);
    assert.equal(bundle.targetCallbackApproval.sourceCancelProof.promptResponseKind, "cancelled");
    assert.equal(bundle.targetCallbackApproval.sourceCancelProof.lateTargetCompletionSuppressed, true);
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "target_callback_approval_resume")?.status, "proven");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "target_callback_approval_denial")?.status, "proven");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "target_callback_parent_binding")?.status, "proven");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "source_facing_session_cancel_running_prompt")?.status, "proven");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_resume_after_process_restart")?.status, "proven");
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_load_only_after_process_restart")?.status, "proven");
    assert.equal(
      bundle.proofMatrix.requirements.find((item) => item.id === "target_callback_parent_binding")?.evidence.noRelaySideEffect,
      true
    );
    assert.equal(
      bundle.proofMatrix.requirements.find((item) => item.id === "source_facing_session_cancel_running_prompt")?.evidence.targetCancelObserved,
      true
    );
    assert.equal(
      bundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_resume_after_process_restart")?.evidence.resumeTargetResumeRefMatchedFirst,
      true
    );
    assert.equal(
      bundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_load_only_after_process_restart")?.evidence.targetSessionLoadUsed,
      true
    );
    assert.equal(
      bundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_load_only_after_process_restart")?.evidence.targetSessionResumeNotUsed,
      true
    );
    assert.equal(
      bundle.proofMatrix.requirements.find((item) => item.id === "target_callback_approval_denial")?.evidence.responseKind,
      "approval_denied"
    );
    assert.equal(bundle.idempotencyProofAcceptable, true);
    assert.equal(bundle.idempotency.replayProof.idempotencyReplay, true);
    assert.equal(bundle.idempotency.replayProof.targetPromptCountAfterReplay, 1);
    assert.equal(bundle.idempotency.conflictProof.errorCode, "idempotency_key_conflict");
    assert.equal(bundle.idempotency.conflictProof.targetPromptCountAfterConflict, 1);
    assert.equal(bundle.proofMatrix.requirements.find((item) => item.id === "source_facing_idempotency_replay_conflict")?.status, "proven");
    assert.equal(
      bundle.proofMatrix.requirements.find((item) => item.id === "source_facing_idempotency_replay_conflict")?.evidence.targetNotReawakenedForReplay,
      true
    );

    const codexCliResult = buildCodexCliRelayProof({
      marker: "PACT_CODEX_CLI_ACP_RELAY_VERIFY_1780000000000",
      codexCliPath: "/opt/homebrew/bin/codex",
      codexCliVersion: "codex-cli 0.130.0",
      codexExitCode: 0,
      relayResult: codexAntigravityResult,
      rawRelayOutput: "PACT_CODEX_CLI_ACP_RELAY_VERIFY_1780000000000",
      connectRequired: true
    });
    const codexCliTargetResult = {
      ok: true,
      verifier: "acp-agent-relay-codex-cli-target",
      marker: "PACT_CODEX_CLI_TARGET_RELAY_VERIFY_1780000000000",
      codexCliPath: "/opt/homebrew/bin/codex",
      codexCliVersion: "codex-cli 0.130.0",
      codexCliSha256: "sha256-codex-cli-target",
      relaySessionId: "relay-session-codex-target",
      relayTurnId: "relay-turn-codex-target",
      virtualAgentId: "codex.cli-exec-real",
      targetId: "codex.cli:exec-real",
      transportType: "codex-cli-exec",
      codexCliTargetProcessVerified: true,
      sourceAcpProtocolVerified: true,
      sourceAcpTransport: "pact-source-facing-acp-stdio",
      sourceAcpMethods: ["initialize", "session/new", "session/prompt", "_pact/target/list", "_pact/session/list", "_pact/session/get", "_pact/turn/list", "_pact/turn/observe", "session/load", "session/close"],
      responseKind: "final_response",
      summaryKind: "final_response",
      sourceAcpResponseKindProjected: true,
      sourceAcpFinalResponseProjected: true,
      sourceAcpOperationalMethodsVerified: true,
      sourceAcpSessionLoadAfterRestartVerified: true,
      operationalDiscoveryProof: {
        targetListed: true,
        sessionListed: true,
        sessionGetMatchedTurn: true,
        turnListed: true,
        turnObserveReasonCode: "target_observation_unsupported",
        targetDescriptorCommandRedacted: true,
        targetCommunicationMode: "codex_cli_exec_proxy",
        nativeAcpTargetSupported: false,
        nativeAcpTargetVerifiedByDiscovery: false
      },
      restartSessionLoadProof: {
        sourceAcpReady: "pact.acp.source_stdio.ready",
        relaySessionId: "relay-session-codex-target",
        targetResumeRef: "codex-cli-exec-relay-session-codex-target",
        replayedUpdateCount: 1,
        replayNotificationCount: 1,
        sessionListedAfterRestart: true,
        sessionGetMatchedTurnAfterRestart: true,
        turnListedAfterRestart: true,
        turnObserveReasonCodeAfterRestart: "target_observation_unsupported",
        pendingPermissionRequestCount: 0,
        requestReasoning: false,
        reasoningTraceReplaySuppressed: true
      },
      externalResponseProjectedAsKeys: ["provider", "executable", "exitCode", "signal", "durationMs", "outputPath", "eventLogPath"],
      finalResponseAvailable: true,
      targetCommunicationMode: "codex_cli_exec_proxy",
      nativeAcpTargetSupported: false,
      nativeAcpTargetVerified: false,
      nativeCodexCliAcpSource: false,
      proof: "pact-relay-to-real-codex-cli-exec-target"
    };
    const codexCliBundle = buildRealRelayProofBundle({
      connectRequired: true,
      codexCliRequired: true,
      antigravityResult,
      codexAntigravityResult,
      codexCliResult,
      codexCliTargetResult,
      codexAcpTargetResult: codexAcpTargetFixture(),
      downstreamCodexAcpTargetResult: downstreamCodexAcpTargetFixture(),
      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: idempotencyFixture(),
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    assert.equal(codexCliBundle.ok, true);
    assert.equal(codexCliBundle.codexCliRequired, true);
    assert.equal(codexCliBundle.codexCliTargetRequired, true);
    assert.equal(codexCliBundle.relayRequiredProofsMet, true);
    assert.equal(codexCliBundle.allRequiredProofsMet, true);
    assert.equal(codexCliBundle.codexCliProofAcceptable, true);
    assert.equal(codexCliBundle.codexCliTargetProofAcceptable, true);
    assert.equal(codexCliBundle.downstreamCodexAcpTargetProofAcceptable, true);
    assert.equal(codexCliBundle.codexCli.codexCliProcessVerified, true);
    assert.equal(codexCliBundle.codexCli.relaySecondResponseKind, "target_error");
    assert.equal(codexCliBundle.codexCli.relaySourceSessionCloseLifecycleState, "closed");
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.evidence.relaySecondResponseKind, "target_error");
    assert.equal(
      codexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")
        ?.evidence.relaySourceSessionClosePromptAfterRestartErrorCode,
      "relay_session_closed"
    );
    assert.equal(codexCliBundle.codexCliTarget.codexCliTargetProcessVerified, true);
    assert.equal(codexCliBundle.codexCliTarget.sourceAcpProtocolVerified, true);
    assert.equal(codexCliBundle.codexCliTarget.sourceAcpFinalResponseProjected, true);
    assert.equal(codexCliBundle.codexCliTarget.sourceAcpOperationalMethodsVerified, true);
    assert.equal(codexCliBundle.codexCliTarget.sourceAcpSessionLoadAfterRestartVerified, true);
    assert.equal(codexCliBundle.codexCliTarget.operationalDiscoveryProof.targetCommunicationMode, "codex_cli_exec_proxy");
    assert.equal(codexCliBundle.codexCliTarget.restartSessionLoadProof.sessionListedAfterRestart, true);
    assert.equal(codexCliBundle.codexCliTarget.restartSessionLoadProof.reasoningTraceReplaySuppressed, true);
    assert.equal(codexCliBundle.codexCli.proofMatrixAllRequiredProofsMet, true);
    assert.equal(codexCliBundle.proofMatrix.schemaVersion, "v0.0.1:agent:acp-agent-relay-real-proof-matrix-1");
    assert.equal(codexCliBundle.proofMatrix.allRequiredProofsMet, true);
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.required, true);
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.status, "proven");
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.required, true);
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.status, "proven");
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "downstream_client_aspect_codex_acp_target_communication")?.required, true);
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "downstream_client_aspect_codex_acp_target_communication")?.status, "proven");
    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.evidence.restartSessionLoadProof.sessionGetMatchedTurnAfterRestart, true);
    assert.equal(
      codexCliBundle.proofMatrix.requirements.find((item) => item.id === "downstream_client_aspect_codex_acp_target_communication")?.evidence.agentDiscoveryProof.fromAspect,
      "downstream-client-aspect"
    );
	    assert.equal(codexCliBundle.targetCallbackApprovalDenialProofAcceptable, true);
	    assert.equal(codexCliBundle.targetCallbackParentBindingProofAcceptable, true);
	    assert.equal(codexCliBundle.sourceFacingCancelProofAcceptable, true);
	    assert.equal(codexCliBundle.targetReconnectProofAcceptable, true);
	    assert.equal(codexCliBundle.targetLoadReconnectProofAcceptable, true);
	    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "target_callback_approval_denial")?.status, "proven");
	    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "target_callback_parent_binding")?.status, "proven");
	    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "source_facing_session_cancel_running_prompt")?.status, "proven");
	    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_resume_after_process_restart")?.status, "proven");
	    assert.equal(codexCliBundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_load_only_after_process_restart")?.status, "proven");
	    assert.equal(codexCliBundle.relayProofMatrix.requirements.find((item) => item.id === "source_facing_multi_turn_continuity")?.status, "proven");
    assert.equal(codexCliBundle.relayProofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.status, "not_required");

    const weakTargetCallbackDenialFixture = targetCallbackApprovalFixture();
    weakTargetCallbackDenialFixture.denialProof = {
      ...weakTargetCallbackDenialFixture.denialProof,
      responseKind: "",
      noContentLeak: false
    };
    const weakTargetCallbackDenialBundle = buildRealRelayProofBundle({
      connectRequired: true,
      antigravityResult,
      codexAntigravityResult,
      targetCallbackApprovalResult: weakTargetCallbackDenialFixture,
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: idempotencyFixture(),
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    assert.equal(weakTargetCallbackDenialBundle.ok, false);
    assert.equal(weakTargetCallbackDenialBundle.targetCallbackApprovalResumeProofAcceptable, true);
    assert.equal(weakTargetCallbackDenialBundle.targetCallbackApprovalDenialProofAcceptable, false);
    assert.equal(
      weakTargetCallbackDenialBundle.proofMatrix.requirements.find((item) => item.id === "target_callback_approval_resume")?.status,
      "proven"
    );
    assert.equal(
      weakTargetCallbackDenialBundle.proofMatrix.requirements.find((item) => item.id === "target_callback_approval_denial")?.status,
      "failed"
    );
    assert.equal(weakTargetCallbackDenialBundle.proofMatrix.failedRequiredIds.includes("target_callback_approval_denial"), true);

    const weakTargetCallbackParentBindingFixture = targetCallbackApprovalFixture();
    weakTargetCallbackParentBindingFixture.parentBindingProof = {
      ...weakTargetCallbackParentBindingFixture.parentBindingProof,
      notFoundRejected: false,
      noRelaySideEffect: false
    };
    const weakTargetCallbackParentBindingBundle = buildRealRelayProofBundle({
      connectRequired: true,
      antigravityResult,
      codexAntigravityResult,
      targetCallbackApprovalResult: weakTargetCallbackParentBindingFixture,
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: idempotencyFixture(),
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    assert.equal(weakTargetCallbackParentBindingBundle.ok, false);
    assert.equal(weakTargetCallbackParentBindingBundle.targetCallbackApprovalResumeProofAcceptable, true);
    assert.equal(weakTargetCallbackParentBindingBundle.targetCallbackApprovalDenialProofAcceptable, true);
    assert.equal(weakTargetCallbackParentBindingBundle.targetCallbackParentBindingProofAcceptable, false);
	    assert.equal(
	      weakTargetCallbackParentBindingBundle.proofMatrix.requirements.find((item) => item.id === "target_callback_parent_binding")?.status,
	      "failed"
	    );
	    assert.equal(weakTargetCallbackParentBindingBundle.proofMatrix.failedRequiredIds.includes("target_callback_parent_binding"), true);

	    const weakSourceFacingCancelFixture = targetCallbackApprovalFixture();
	    weakSourceFacingCancelFixture.sourceCancelProof = {
	      ...weakSourceFacingCancelFixture.sourceCancelProof,
	      targetCancelObserved: false,
	      lateTargetCompletionSuppressed: false
	    };
	    const weakSourceFacingCancelBundle = buildRealRelayProofBundle({
	      connectRequired: true,
	      antigravityResult,
	      codexAntigravityResult,
	      targetCallbackApprovalResult: weakSourceFacingCancelFixture,
	      targetReconnectResult: targetReconnectFixture(),
	      targetLoadReconnectResult: targetLoadReconnectFixture(),
	      idempotencyResult: idempotencyFixture(),
	      generatedAt: "2026-06-05T00:00:00.000Z"
	    });
	    assert.equal(weakSourceFacingCancelBundle.ok, false);
	    assert.equal(weakSourceFacingCancelBundle.targetCallbackApprovalResumeProofAcceptable, true);
	    assert.equal(weakSourceFacingCancelBundle.targetCallbackApprovalDenialProofAcceptable, true);
	    assert.equal(weakSourceFacingCancelBundle.targetCallbackParentBindingProofAcceptable, true);
	    assert.equal(weakSourceFacingCancelBundle.sourceFacingCancelProofAcceptable, false);
	    assert.equal(
	      weakSourceFacingCancelBundle.proofMatrix.requirements.find((item) => item.id === "source_facing_session_cancel_running_prompt")?.status,
	      "failed"
	    );
	    assert.equal(
	      weakSourceFacingCancelBundle.proofMatrix.failedRequiredIds.includes("source_facing_session_cancel_running_prompt"),
	      true
	    );

	    const weakTargetReconnectFixture = targetReconnectFixture();
	    weakTargetReconnectFixture.reconnectProof = {
	      ...weakTargetReconnectFixture.reconnectProof,
	      targetProcessRestartObserved: false,
	      resumeTargetResumeRefMatchedFirst: false
	    };
	    const weakTargetReconnectBundle = buildRealRelayProofBundle({
	      connectRequired: true,
	      antigravityResult,
	      codexAntigravityResult,
	      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
	      targetReconnectResult: weakTargetReconnectFixture,
	      targetLoadReconnectResult: targetLoadReconnectFixture(),
	      idempotencyResult: idempotencyFixture(),
	      generatedAt: "2026-06-05T00:00:00.000Z"
	    });
	    assert.equal(weakTargetReconnectBundle.ok, false);
	    assert.equal(weakTargetReconnectBundle.targetCallbackApprovalResumeProofAcceptable, true);
	    assert.equal(weakTargetReconnectBundle.targetCallbackApprovalDenialProofAcceptable, true);
	    assert.equal(weakTargetReconnectBundle.targetCallbackParentBindingProofAcceptable, true);
	    assert.equal(weakTargetReconnectBundle.sourceFacingCancelProofAcceptable, true);
	    assert.equal(weakTargetReconnectBundle.targetReconnectProofAcceptable, false);
	    assert.equal(
	      weakTargetReconnectBundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_resume_after_process_restart")?.status,
	      "failed"
	    );
	    assert.equal(
	      weakTargetReconnectBundle.proofMatrix.failedRequiredIds.includes("target_reconnect_resume_after_process_restart"),
	      true
	    );

	    const weakTargetLoadReconnectFixture = targetLoadReconnectFixture();
	    weakTargetLoadReconnectFixture.loadReconnectProof = {
	      ...weakTargetLoadReconnectFixture.loadReconnectProof,
	      targetSessionLoadUsed: false,
	      targetSessionResumeNotUsed: false
	    };
	    weakTargetLoadReconnectFixture.targetMethodProof = {
	      ...weakTargetLoadReconnectFixture.targetMethodProof,
	      sessionLoadCount: 0,
	      sessionResumeCount: 1,
	      usedSessionLoadAfterTargetRestart: false,
	      usedSessionResumeAfterTargetRestart: true
	    };
	    const weakTargetLoadReconnectBundle = buildRealRelayProofBundle({
	      connectRequired: true,
	      antigravityResult,
	      codexAntigravityResult,
	      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
	      targetReconnectResult: targetReconnectFixture(),
	      targetLoadReconnectResult: weakTargetLoadReconnectFixture,
	      idempotencyResult: idempotencyFixture(),
	      generatedAt: "2026-06-05T00:00:00.000Z"
	    });
	    assert.equal(weakTargetLoadReconnectBundle.ok, false);
	    assert.equal(weakTargetLoadReconnectBundle.targetCallbackApprovalResumeProofAcceptable, true);
	    assert.equal(weakTargetLoadReconnectBundle.targetCallbackApprovalDenialProofAcceptable, true);
	    assert.equal(weakTargetLoadReconnectBundle.targetCallbackParentBindingProofAcceptable, true);
	    assert.equal(weakTargetLoadReconnectBundle.sourceFacingCancelProofAcceptable, true);
	    assert.equal(weakTargetLoadReconnectBundle.targetReconnectProofAcceptable, true);
	    assert.equal(weakTargetLoadReconnectBundle.targetLoadReconnectProofAcceptable, false);
	    assert.equal(
	      weakTargetLoadReconnectBundle.proofMatrix.requirements.find((item) => item.id === "target_reconnect_load_only_after_process_restart")?.status,
	      "failed"
	    );
	    assert.equal(
	      weakTargetLoadReconnectBundle.proofMatrix.failedRequiredIds.includes("target_reconnect_load_only_after_process_restart"),
	      true
	    );

	    const weakIdempotencyFixture = idempotencyFixture();
    weakIdempotencyFixture.replayProof = {
      ...weakIdempotencyFixture.replayProof,
      targetPromptCountAfterReplay: 2
    };
    weakIdempotencyFixture.targetMethodProof = {
      ...weakIdempotencyFixture.targetMethodProof,
      targetNotReawakenedForReplay: false
    };
    const weakIdempotencyBundle = buildRealRelayProofBundle({
      connectRequired: true,
      antigravityResult,
      codexAntigravityResult,
      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: weakIdempotencyFixture,
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    assert.equal(weakIdempotencyBundle.ok, false);
    assert.equal(weakIdempotencyBundle.idempotencyProofAcceptable, false);
    assert.equal(
      weakIdempotencyBundle.proofMatrix.requirements.find((item) => item.id === "source_facing_idempotency_replay_conflict")?.status,
      "failed"
    );
    assert.equal(weakIdempotencyBundle.proofMatrix.failedRequiredIds.includes("source_facing_idempotency_replay_conflict"), true);

    const weakCodexCliTargetBundle = buildRealRelayProofBundle({
      connectRequired: true,
      codexCliRequired: true,
      antigravityResult,
      codexAntigravityResult,
      codexCliResult,
      codexCliTargetResult: {
        ...codexCliTargetResult,
        restartSessionLoadProof: {
          ...codexCliTargetResult.restartSessionLoadProof,
          sessionListedAfterRestart: false
        }
      },
      codexAcpTargetResult: codexAcpTargetFixture(),
      downstreamCodexAcpTargetResult: downstreamCodexAcpTargetFixture(),
      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: idempotencyFixture(),
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    assert.equal(weakCodexCliTargetBundle.codexCliTargetProofAcceptable, false);
    assert.equal(weakCodexCliTargetBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.status, "failed");

    const weakDownstreamCodexAcpTarget = downstreamCodexAcpTargetFixture();
    weakDownstreamCodexAcpTarget.agentDiscoveryProof = {
      ...weakDownstreamCodexAcpTarget.agentDiscoveryProof,
      fromAspect: ""
    };
    weakDownstreamCodexAcpTarget.targetDiscoveryProof = {
      ...weakDownstreamCodexAcpTarget.targetDiscoveryProof,
      targetDescriptorCommandRedacted: false
    };
    const weakDownstreamCodexAcpTargetBundle = buildRealRelayProofBundle({
      connectRequired: true,
      codexCliRequired: true,
      antigravityResult,
      codexAntigravityResult,
      codexCliResult,
      codexCliTargetResult,
      codexAcpTargetResult: codexAcpTargetFixture(),
      downstreamCodexAcpTargetResult: weakDownstreamCodexAcpTarget,
      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: idempotencyFixture(),
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    assert.equal(weakDownstreamCodexAcpTargetBundle.downstreamCodexAcpTargetProofAcceptable, false);
    assert.equal(
      weakDownstreamCodexAcpTargetBundle.proofMatrix.requirements.find((item) =>
        item.id === "downstream_client_aspect_codex_acp_target_communication"
      )?.status,
      "failed"
    );

    const missingCodexCliBundle = buildRealRelayProofBundle({
      connectRequired: true,
      codexCliRequired: true,
      antigravityResult,
      codexAntigravityResult,
      targetCallbackApprovalResult: targetCallbackApprovalFixture(),
      targetReconnectResult: targetReconnectFixture(),
      targetLoadReconnectResult: targetLoadReconnectFixture(),
      idempotencyResult: idempotencyFixture(),
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    assert.equal(missingCodexCliBundle.ok, false);
    assert.equal(missingCodexCliBundle.relayRequiredProofsMet, true);
    assert.equal(missingCodexCliBundle.allRequiredProofsMet, false);
    assert.equal(missingCodexCliBundle.codexCliProofAcceptable, false);
    assert.equal(missingCodexCliBundle.codexCliTargetProofAcceptable, false);
    assert.equal(missingCodexCliBundle.proofMatrix.allRequiredProofsMet, false);
    assert.equal(missingCodexCliBundle.proofMatrix.failedRequiredIds.includes("codex_cli_participation"), true);
    assert.equal(missingCodexCliBundle.proofMatrix.failedRequiredIds.includes("codex_cli_target_communication"), true);
    assert.equal(missingCodexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.required, true);
    assert.equal(missingCodexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_participation")?.status, "failed");
    assert.equal(missingCodexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.required, true);
    assert.equal(missingCodexCliBundle.proofMatrix.requirements.find((item) => item.id === "codex_cli_target_communication")?.status, "failed");
  });

  it("resolves file-path helpers without ambiguity", () => {
    const tempRoot = path.join("/tmp", "antigravity-relay-helper", "unit");
    const conversationId = "conv-path";
    assert.equal(
      resolveAntigravityConversationBrainPath(conversationId, { brainRoot: tempRoot }),
      path.join(tempRoot, conversationId)
    );
    assert.equal(
      resolveAntigravityTranscriptPath(conversationId, { brainRoot: tempRoot }),
      path.join(tempRoot, conversationId, ".system_generated", "logs", "transcript.jsonl")
    );
    assert.equal(
      resolveAntigravityMessagesDir(conversationId, { brainRoot: tempRoot }),
      path.join(tempRoot, conversationId, ".system_generated", "messages")
    );
  });

  it("parses Agent API stream-like JSON payloads and reports wrapped JSON failures with stderr", async () => {
    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });

    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      callback(null, {
        stdout: '[{"text":"first"}, {"text":"second"}]',
        stderr: ""
      });
    });
    const streamPayload = await client.runAgentApi(["get-conversation-metadata", "conversation-stream"]);
    assert.equal(typeof streamPayload.response, "object");
    assert.equal(streamPayload.response.text.includes("\"first\""), true);
    assert.equal(streamPayload.rawText.includes("first"), true);

    const failureError = new Error("agentapi failed");
    failureError.stdout = "{\"error\":\"wrapped\"}";
    failureError.stderr = "stderr trace";
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      callback(failureError);
    });

    await assert.rejects(
      () => client.getConversationMetadata("conversation-fail"),
      (error) => {
        assert.equal(error.message, "wrapped");
        assert.equal(error.stdout, "{\"error\":\"wrapped\"}");
        assert.equal(error.stderr, "stderr trace");
        return true;
      }
    );
  });

  it("returns commandUsage text when Agent API command errors before JSON parsing", async () => {
    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });

    const usageError = new Error("agentapi command failed");
    usageError.stdout = "";
    usageError.stderr = "Usage: agentapi <command>";
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      callback(usageError);
    });

    const usage = await client.commandUsage();
    assert.equal(usage, "Usage: agentapi <command>");
  });

  it("maps final-response policy to pull-or-stream when terminal command is supported", () => {
    const snapshot = createAntigravityAgentApiCapabilitySnapshot({
      availableCommands: [
        "get-conversation-metadata",
        "new-conversation",
        "send-message",
        "get-conversation",
        "stream-conversation"
      ],
      finalResponseCapabilityProbe: [
        { command: "get-conversation", supported: true, elapsedMs: 10, error: "" },
        { command: "stream-conversation", supported: false, elapsedMs: 2, error: "unsupported" }
      ]
    });

    assert.equal(snapshot.finalResponseReadSupported, true);
    assert.equal(snapshot.finalResponsePolicy, "pull_or_stream");
    assert.equal(snapshot.commands.getConversation, true);
    assert.equal(snapshot.commands.streamConversation, true);
  });

  it("discovers agent API endpoint from env and from candidate server scan", async () => {
    const conversationId = "conv-discovery";
    const tempRoot = await makeTempRoot("pact-acp-agent-relay-discovery-");
    const workspaceFlag = `file_${tempRoot.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/g, "")}`;

    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      if (command === "pgrep") {
        callback(null, {
          stdout: `1111 /tmp/${workspaceFlag}-language-server --csrf_token=discovered-token\n`,
          stderr: ""
        });
        return;
      }

      if (command === "lsof") {
        callback(null, {
          stdout: "127.0.0.1:8443 (LISTEN)\n",
          stderr: ""
        });
        return;
      }

      callback(null, {
        stdout: JSON.stringify({
          response: {
            conversationMetadata: {
              metadata: {
                workspaces: [{ workspaceFolderAbsoluteUri: tempRoot }]
              }
            }
          }
        }),
        stderr: ""
      });
    });

    const fromEnv = await discoverAntigravityAgentApiEndpoint({
      conversationId,
      binaryPath: process.execPath,
      workspaceRoot: tempRoot,
      env: {
        PACT_ACP_RELAY_ANTIGRAVITY_LS_ADDRESS: "127.0.0.1:7000",
        PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN: "env-token"
      }
    });

    assert.equal(fromEnv.source, "env");
    assert.equal(fromEnv.address, "127.0.0.1:7000");
    assert.equal(fromEnv.csrfToken, "env-token");

    const discovered = await discoverAntigravityAgentApiEndpoint({
      conversationId,
      binaryPath: process.execPath,
      workspaceRoot: tempRoot,
      env: {}
    });

    assert.equal(discovered.source, "pid:1111");
    assert.equal(discovered.address, "127.0.0.1:8443");
    assert.equal(discovered.csrfToken, "discovered-token");
  });

  it("surfaces timeout-like process errors from Agent API command execution", async () => {
    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });
    const timeoutError = new Error("ETIMEDOUT");
    timeoutError.code = "ETIMEDOUT";

    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      callback(timeoutError);
    });

    await assert.rejects(
      () => client.getConversationMetadata("timeout-conversation"),
      (error) => {
        assert.equal(error.code, "ETIMEDOUT");
        return true;
      }
    );
  });
});
