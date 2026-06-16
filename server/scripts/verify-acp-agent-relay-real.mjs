#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRealRelayProofBundle,
  selectVerifierResult
} from "./acp-agent-relay-real-proof-bundle.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const connectRequired = process.argv.includes("--connect") ||
  process.env.PACT_ACP_RELAY_REAL_CONNECT === "1";
const codexCliRequired = process.argv.includes("--codex-cli") ||
  process.env.PACT_ACP_RELAY_REAL_CODEX_CLI === "1";
const antigravityAcpWrapperRequested = process.argv.includes("--antigravity-acp-wrapper") ||
  process.env.PACT_ACP_RELAY_REAL_ANTIGRAVITY_ACP_WRAPPER === "1";
const targetLifecycleProofsRequested = process.argv.includes("--target-lifecycle") ||
  process.env.PACT_ACP_RELAY_REAL_TARGET_LIFECYCLE === "1";
const maxCapturedOutputBytes = Number(process.env.PACT_ACP_RELAY_REAL_CAPTURE_MAX_BYTES || 8 * 1024 * 1024);

function appendCaptured(buffer = "", chunk = "") {
  const next = `${buffer}${chunk}`;
  const maxBytes = Number.isFinite(maxCapturedOutputBytes) && maxCapturedOutputBytes > 0
    ? maxCapturedOutputBytes
    : 8 * 1024 * 1024;
  if (Buffer.byteLength(next, "utf8") <= maxBytes) {
    return next;
  }
  return next.slice(Math.max(0, next.length - maxBytes));
}

function runNodeScript(scriptPath, envPatch = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...envPatch
      }
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      output = appendCaptured(output, text);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      output = appendCaptured(output, text);
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({
          scriptPath,
          exitCode: code,
          signal: signal || "",
          output,
          outputBytes: Buffer.byteLength(output, "utf8")
        });
        return;
      }
      reject(new Error(`${scriptPath} exited with ${signal || code}`));
    });
  });
}

const baseRequiredEnv = {
  PACT_ACP_RELAY_ANTIGRAVITY_REQUIRED: "1",
  PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL:
  process.env.PACT_ACP_RELAY_ANTIGRAVITY_MIN_PROOF_LEVEL || "conversation_file_and_local_marker_observation"
};

const antigravityRun = await runNodeScript("server/scripts/verify-acp-agent-relay-antigravity.mjs", baseRequiredEnv);

const codexAntigravityRun = await runNodeScript("server/scripts/verify-acp-agent-relay-codex-antigravity.mjs", {
  ...baseRequiredEnv,
  ...(connectRequired
    ? {
        PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_REQUIRED: "1",
        PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ENABLED: "1",
        PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_MIN_PROOF_LEVEL:
          process.env.PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_MIN_PROOF_LEVEL || "connect_target_error"
      }
    : {})
});
const codexCliRun = codexCliRequired
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-codex-cli-antigravity.mjs", {
      ...(connectRequired
        ? {
            PACT_ACP_RELAY_REAL_CONNECT: "1",
            PACT_ACP_RELAY_CODEX_CLI_CONNECT: "1"
          }
        : {})
    })
  : null;
const codexCliTargetRun = codexCliRequired
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-codex-cli-target.mjs")
  : null;
const codexAcpTargetRun = codexCliRequired
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-codex-acp-target.mjs")
  : null;
const downstreamCodexAcpTargetRun = codexCliRequired
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-downstream-codex-acp-target.mjs")
  : null;
const antigravityAcpWrapperTargetRun = antigravityAcpWrapperRequested
  ? await runNodeScript(
      "server/scripts/verify-acp-agent-relay-antigravity-acp-wrapper-target.mjs",
      {
        ...baseRequiredEnv,
        PACT_ACP_RELAY_ANTIGRAVITY_WRAPPER_DOWNSTREAM_ASPECT: "1"
      }
    )
  : null;
const targetCallbackApprovalRun = targetLifecycleProofsRequested
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-target-callback-approval.mjs")
  : null;
const targetReconnectRun = targetLifecycleProofsRequested
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-target-reconnect.mjs")
  : null;
const targetLoadReconnectRun = targetLifecycleProofsRequested
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-target-load-reconnect.mjs")
  : null;
const idempotencyRun = targetLifecycleProofsRequested
  ? await runNodeScript("server/scripts/verify-acp-agent-relay-idempotency.mjs")
  : null;

const antigravityResult = selectVerifierResult(
  antigravityRun.output,
  "acp-agent-relay-antigravity"
);
const codexAntigravityResult = selectVerifierResult(
  codexAntigravityRun.output,
  "acp-agent-relay-codex-antigravity"
);
const codexCliResult = codexCliRun
  ? selectVerifierResult(codexCliRun.output, "acp-agent-relay-codex-cli-antigravity")
  : null;
const codexCliTargetResult = codexCliTargetRun
  ? selectVerifierResult(codexCliTargetRun.output, "acp-agent-relay-codex-cli-target")
  : null;
const codexAcpTargetResult = codexAcpTargetRun
  ? selectVerifierResult(codexAcpTargetRun.output, "acp-agent-relay-codex-acp-target")
  : null;
const downstreamCodexAcpTargetResult = downstreamCodexAcpTargetRun
  ? selectVerifierResult(downstreamCodexAcpTargetRun.output, "acp-agent-relay-downstream-codex-acp-target")
  : null;
const antigravityAcpWrapperTargetResult = antigravityAcpWrapperTargetRun
  ? selectVerifierResult(
      antigravityAcpWrapperTargetRun.output,
      "acp-agent-relay-antigravity-acp-wrapper-target"
    )
  : null;
const targetCallbackApprovalResult = targetCallbackApprovalRun
  ? selectVerifierResult(
      targetCallbackApprovalRun.output,
      "acp-agent-relay-target-callback-approval"
    )
  : null;
const targetReconnectResult = targetReconnectRun
  ? selectVerifierResult(
      targetReconnectRun.output,
      "acp-agent-relay-target-reconnect"
    )
  : null;
const targetLoadReconnectResult = targetLoadReconnectRun
  ? selectVerifierResult(
      targetLoadReconnectRun.output,
      "acp-agent-relay-target-load-reconnect"
    )
  : null;
const idempotencyResult = idempotencyRun
  ? selectVerifierResult(
      idempotencyRun.output,
      "acp-agent-relay-idempotency"
    )
  : null;
const proofBundle = buildRealRelayProofBundle({
  connectRequired,
  codexCliRequired,
  antigravityAcpWrapperTargetRequired: antigravityAcpWrapperRequested,
  targetCallbackApprovalRequired: targetLifecycleProofsRequested,
  targetReconnectProofRequired: targetLifecycleProofsRequested,
  targetLoadReconnectProofRequired: targetLifecycleProofsRequested,
  idempotencyProofRequired: targetLifecycleProofsRequested,
  antigravityResult,
  codexAntigravityResult,
  codexCliResult,
  codexCliTargetResult,
  codexAcpTargetResult,
  downstreamCodexAcpTargetResult,
  antigravityAcpWrapperTargetResult,
  targetCallbackApprovalResult,
  targetReconnectResult,
  targetLoadReconnectResult,
  idempotencyResult,
  runResults: [
    antigravityRun,
    codexAntigravityRun,
    codexCliRun,
    codexCliTargetRun,
    codexAcpTargetRun,
    downstreamCodexAcpTargetRun,
    antigravityAcpWrapperTargetRun,
    targetCallbackApprovalRun,
    targetReconnectRun,
    targetLoadReconnectRun,
    idempotencyRun
  ].filter(Boolean)
});
assert.equal(
  proofBundle.ok,
  true,
  `ACP relay real proof bundle must satisfy every required proof. diagnostic=${JSON.stringify(proofBundle)}`
);
assert.equal(
  proofBundle.codexAntigravity?.responseKind,
  proofBundle.codexAntigravity?.communicationSummary?.summaryKind,
  "ACP relay real proof bundle must expose Codex/Antigravity responseKind and matching communicationSummary.summaryKind."
);
assert.equal(
  proofBundle.codexAntigravity?.sourceTurnObserve?.responseKind,
  proofBundle.codexAntigravity?.sourceTurnObserve?.communicationSummary?.summaryKind,
  "ACP relay real proof bundle must expose turn.observe responseKind and matching communicationSummary.summaryKind."
);
assert.equal(
  proofBundle.codexAntigravity?.sourceTurnObserveProofAcceptable,
  true,
  "ACP relay real proof bundle must preserve source-facing turn.observe proof acceptability."
);
assert.equal(
  ["local_marker_observation", "local_progress", "local_final_response", "local_target_error"].includes(
    proofBundle.codexAntigravity?.sourceTurnObserveProofLevel
  ),
  true,
  "ACP relay real proof bundle must expose a concrete source-facing turn.observe proof level."
);
assert.deepEqual(
  proofBundle.relayProofMatrix?.failedRequiredIds,
  [],
  "ACP relay real gate must fail if the relay proof matrix has any failed required proof."
);
assert.equal(
  proofBundle.codexAntigravity?.proofMatrixFailedRequiredIds?.length,
  0,
  "Codex/Antigravity verifier summary must not carry failed relay proof ids."
);
assert.equal(
  proofBundle.codexAntigravity?.sourceIdentityIsolationProof?.requestBodyOverrideRejected,
  true,
  "Codex/Antigravity real proof must reject foreign request-body source spoofing."
);
assert.equal(
  proofBundle.codexAntigravity?.sourceIdentityIsolationProof?.sessionEnumerationIsolated,
  true,
  "Codex/Antigravity real proof must isolate source-facing session enumeration by source identity."
);
assert.equal(
  proofBundle.relayProofMatrix?.requirements?.find((item) => item.id === "source_identity_isolation")?.status,
  "proven",
  "Relay proof matrix must include proven source identity isolation."
);
assert.equal(
  proofBundle.codexAntigravity?.sourceSessionCloseProof?.closeLifecycleState,
  "closed",
  "Codex/Antigravity real proof must close the source-facing relay session."
);
assert.equal(
  proofBundle.codexAntigravity?.sourceSessionCloseProof?.promptAfterCloseErrorCode,
  "relay_session_closed",
  "Codex/Antigravity real proof must reject source prompts after session/close."
);
assert.equal(
  proofBundle.codexAntigravity?.sourceSessionCloseProof?.resumeAfterCloseRestartErrorCode,
  "relay_session_closed",
  "Codex/Antigravity real proof must reject resume of a closed relay session after source restart."
);
assert.equal(
  proofBundle.relayProofMatrix?.requirements?.find((item) => item.id === "source_facing_session_close_terminal")?.status,
  "proven",
  "Relay proof matrix must include proven source-facing session close terminal behavior."
);
assert.equal(
  proofBundle.relayProofMatrix?.requirements?.find((item) => item.id === "source_facing_multi_turn_continuity")?.status,
  "proven",
  "Relay proof matrix must include proven source-facing multi-turn continuity across source restart."
);
assert.equal(
  proofBundle.relayProofMatrix?.requirements?.find((item) => item.id === "native_antigravity_ide_cli_acp_source")?.status,
  "unsupported",
  "Relay proof matrix must explicitly mark bare Antigravity IDE CLI ACP source mode as unsupported unless verified."
);
assert.equal(
  proofBundle.codexAntigravity?.ideCliCapabilitySnapshot?.chatCommandSupported,
  true,
  "Codex/Antigravity real proof must preserve Antigravity IDE CLI chat capability evidence."
);
assert.equal(
  proofBundle.codexAntigravity?.ideCliCapabilitySnapshot?.chatIsAcpTransport,
  false,
  "Antigravity IDE CLI chat must not be treated as an ACP transport."
);
assert.equal(
  proofBundle.codexAntigravity?.ideCliCapabilitySnapshot?.nativeAcpSourceVerified,
  false,
  "Antigravity IDE CLI must not be reported as a verified native ACP source."
);
assert.equal(
  proofBundle.antigravity?.targetCommunicationMode,
  "agent_api_proxy",
  "Antigravity real proof must remain classified as the Agent API proxy path."
);
assert.equal(
  proofBundle.antigravity?.nativeAcpTargetSupported,
  false,
  "Antigravity Agent API real proof must not advertise native ACP target support."
);
assert.equal(
  proofBundle.antigravity?.nativeAcpTargetVerified,
  false,
  "Antigravity Agent API real proof must not verify native ACP target support."
);
assert.equal(
  proofBundle.codexAntigravity?.targetCommunicationMode,
  "agent_api_proxy",
  "Codex-to-Antigravity real proof must remain classified as the Agent API proxy path."
);
assert.equal(
  proofBundle.codexAntigravity?.nativeAcpTargetSupported,
  false,
  "Codex-to-Antigravity real proof must not advertise native ACP target support."
);
assert.equal(
  proofBundle.codexAntigravity?.nativeAcpTargetVerified,
  false,
  "Codex-to-Antigravity real proof must not verify native ACP target support."
);
if (codexCliRequired) {
  assert.equal(
    proofBundle.codexCliTarget?.sourceAcpResponseKindProjected,
    true,
    "Codex CLI target real proof must project responseKind through source-facing ACP."
  );
  assert.equal(
    proofBundle.codexCliTarget?.responseKind,
    "final_response",
    "Codex CLI target real proof must expose responseKind=final_response."
  );
  assert.equal(
    proofBundle.codexCliTarget?.targetCommunicationMode,
    "codex_cli_exec_proxy",
    "Codex CLI target real proof must remain classified as a compatibility proxy."
  );
  assert.equal(
    proofBundle.codexCliTarget?.nativeAcpTargetSupported,
    false,
    "Codex CLI target real proof must not advertise native ACP target support."
  );
  assert.equal(
    proofBundle.codexCliTarget?.nativeAcpTargetVerified,
    false,
    "Codex CLI target real proof must not verify native ACP target support."
  );
  assert.equal(
    proofBundle.codexCliTarget?.communicationSummary?.summaryKind,
    "final_response",
    "Codex CLI target real proof must expose communicationSummary.summaryKind=final_response."
  );
  assert.equal(
    proofBundle.codexCliTarget?.sourceAcpOperationalMethodsVerified,
    true,
    "Codex CLI target real proof must verify source-facing operational discovery methods."
  );
  assert.equal(
    proofBundle.codexCliTarget?.sourceAcpSessionLoadAfterRestartVerified,
    true,
    "Codex CLI target real proof must verify session/load after source stdio restart."
  );
  assert.equal(
    proofBundle.codexCliTarget?.operationalDiscoveryProof?.targetCommunicationMode,
    "codex_cli_exec_proxy",
    "Codex CLI target operational discovery must remain classified as a compatibility proxy."
  );
  assert.equal(
    proofBundle.codexCliTarget?.operationalDiscoveryProof?.nativeAcpTargetSupported,
    false,
    "Codex CLI target operational discovery must not advertise native ACP target support."
  );
  assert.equal(
    proofBundle.codexCliTarget?.restartSessionLoadProof?.relaySessionId,
    proofBundle.codexCliTarget?.relaySessionId,
    "Codex CLI target restart-load proof must remain bound to the same relay session."
  );
  assert.equal(
    proofBundle.codexCliTarget?.restartSessionLoadProof?.sessionListedAfterRestart,
    true,
    "Codex CLI target source-facing session/list must find the durable session after restart."
  );
  assert.equal(
    proofBundle.codexCliTarget?.restartSessionLoadProof?.sessionGetMatchedTurnAfterRestart,
    true,
    "Codex CLI target source-facing session/get must recover the completed turn after restart."
  );
  assert.equal(
    proofBundle.codexCliTarget?.restartSessionLoadProof?.turnListedAfterRestart,
    true,
    "Codex CLI target source-facing turn/list must recover the completed turn after restart."
  );
  assert.equal(
    proofBundle.codexCliTarget?.restartSessionLoadProof?.reasoningTraceReplaySuppressed,
    true,
    "Codex CLI target session/load replay must suppress reasoning traces unless requested."
  );
  assert.equal(
    proofBundle.codexAcpTarget?.targetCommunicationMode,
    "codex_acp_stdio",
    "Codex ACP target real proof must expose the proof-specific Codex ACP stdio mode."
  );
  assert.equal(
    proofBundle.codexAcpTarget?.nativeAcpTargetSupported,
    true,
    "Codex ACP target real proof must advertise native ACP target support."
  );
  assert.equal(
    proofBundle.codexAcpTarget?.nativeAcpTargetVerified,
    true,
    "Codex ACP target real proof must verify a native ACP stdio target adapter."
  );
  assert.equal(
    proofBundle.codexAcpTarget?.responseKind,
    "final_response",
    "Codex ACP target real proof must expose responseKind=final_response."
  );
  assert.equal(
    proofBundle.codexAcpTarget?.communicationSummary?.summaryKind,
    "final_response",
    "Codex ACP target real proof must expose communicationSummary.summaryKind=final_response."
  );
  assert.equal(
    proofBundle.downstreamCodexAcpTargetProofAcceptable,
    true,
    "Downstream client aspect Codex ACP target proof must be acceptable when Codex CLI proof is requested."
  );
  assert.equal(
    proofBundle.downstreamCodexAcpTarget?.downstreamClientAspectAssemblyUsed,
    true,
    "Downstream Codex ACP target proof must use the downstream-client-aspect assembled descriptor."
  );
  assert.equal(
    proofBundle.downstreamCodexAcpTarget?.agentDiscoveryProof?.fromAspect,
    "downstream-client-aspect",
    "Downstream Codex ACP agent discovery must expose downstream-client-aspect ownership metadata."
  );
  assert.equal(
    proofBundle.downstreamCodexAcpTarget?.targetDiscoveryProof?.targetDescriptorCommandRedacted,
    true,
    "Downstream Codex ACP target discovery must redact launch command details."
  );
  assert.equal(
    proofBundle.downstreamCodexAcpTarget?.responseKind,
    "final_response",
    "Downstream Codex ACP target proof must produce a source-facing final_response."
  );
  assert.equal(
    proofBundle.downstreamCodexAcpTarget?.restartSessionLoadProof?.reasoningTraceReplaySuppressed,
    true,
    "Downstream Codex ACP target restart-load proof must suppress reasoning traces by default."
  );
  assert.equal(
    proofBundle.proofMatrix?.requirements?.find((item) =>
      item.id === "downstream_client_aspect_codex_acp_target_communication"
    )?.status,
    "proven",
    "Top-level real proof matrix must include proven downstream-client-aspect Codex ACP target communication."
	  );
}
if (antigravityAcpWrapperRequested) {
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.nativeAntigravityAcp,
    false,
    "Antigravity ACP wrapper proof must remain classified as a Pact wrapper, not native Antigravity ACP."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTargetProofAcceptable,
    true,
    "Requested Antigravity ACP wrapper proof must be acceptable."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.downstreamClientAspectAssemblyUsed,
    true,
    "Antigravity wrapper target proof must be assembled by downstream-client-aspect in the top-level real gate."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.agentDiscoveryProof?.fromAspect,
    "downstream-client-aspect",
    "Antigravity wrapper virtual-agent discovery must expose downstream-client-aspect provenance."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.targetDiscoveryProof?.adapterId,
    "antigravity-agentapi-acp-stdio-wrapper",
    "Antigravity wrapper target discovery must expose the wrapper adapter id."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.sourceFacingTargetCommunicationMode,
    "native_acp_stdio",
    "Antigravity wrapper target proof must expose Pact-to-wrapper ACP stdio as the source-facing target mode."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.targetCommunicationMode,
    "antigravity_agentapi_acp_stdio_wrapper",
    "Antigravity wrapper target proof must expose the proof-specific wrapper communication mode."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.antigravityAgentApiReached,
    true,
    "Antigravity wrapper proof must prove the wrapper reached Antigravity Agent API."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.responseKind,
    "acknowledgement",
    "Antigravity wrapper proof must stay accepted-only until a final response is independently observed."
  );
  assert.equal(
    proofBundle.antigravityAcpWrapperTarget?.restartSessionLoadProof?.reasoningTraceReplaySuppressed,
    true,
    "Antigravity wrapper restart-load proof must suppress reasoning traces by default."
  );
  assert.equal(
    proofBundle.proofMatrix?.requirements?.find((item) =>
      item.id === "antigravity_agentapi_acp_wrapper_target_communication"
    )?.status,
    "proven",
    "Top-level real proof matrix must include proven Antigravity Agent API ACP wrapper communication when requested."
  );
} else {
  assert.equal(
    proofBundle.antigravityAcpWrapperTargetRequired,
    false,
    "Antigravity ACP wrapper target proof must be optional unless explicitly requested."
  );
  assert.equal(
    proofBundle.proofMatrix?.requirements?.find((item) =>
      item.id === "antigravity_agentapi_acp_wrapper_target_communication"
    )?.status,
    "not_required",
    "Unrequested Antigravity ACP wrapper target proof must be skipped, not failed."
  );
}
assert.equal(
  proofBundle.antigravityCrossRunBindingProofAcceptable,
  true,
  "Top-level real proof matrix must prove requested Antigravity proofs are bound to the same live conversation and endpoint."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) =>
    item.id === "antigravity_cross_run_binding"
  )?.status,
  "proven",
  "Top-level real proof matrix must include proven Antigravity cross-run binding."
);
if (targetLifecycleProofsRequested) {
assert.equal(
  proofBundle.targetCallbackApprovalProofAcceptable,
  true,
  "ACP relay real proof must include target-originated callback approval suspend/resume evidence."
);
assert.equal(
  proofBundle.targetCallbackApproval?.sameTurn,
  true,
  "Target callback approval proof must resume the same relay turn."
);
assert.equal(
  proofBundle.targetCallbackApproval?.usedSessionResume,
  true,
  "Target callback approval proof must use target session/resume on approval resume."
);
assert.equal(
  proofBundle.targetCallbackApproval?.pendingProof?.responseKind,
  "approval_pending",
  "Target callback approval proof must project responseKind=approval_pending while suspended."
);
assert.equal(
  proofBundle.targetCallbackApproval?.resolveProof?.responseKind,
  "final_response",
  "Target callback approval proof must project responseKind=final_response after approval resume."
);
assert.equal(
  proofBundle.targetCallbackApprovalResumeProofAcceptable,
  true,
  "Target callback approval proof must keep the approval/resume branch acceptable."
);
assert.equal(
  proofBundle.targetCallbackApprovalDenialProofAcceptable,
  true,
  "Target callback approval proof must include the denial branch."
);
assert.equal(
  proofBundle.targetCallbackParentBindingProofAcceptable,
  true,
  "Target callback proof must include parent-binding fail-closed evidence."
);
assert.equal(
  proofBundle.targetCallbackApproval?.parentBindingProof?.ambiguousReasonCode,
  "target_callback_parent_ambiguous",
  "Target callback parent-binding proof must reject orphan callbacks without a unique parent."
);
assert.equal(
  proofBundle.targetCallbackApproval?.parentBindingProof?.notFoundReasonCode,
  "target_callback_parent_not_found",
  "Target callback parent-binding proof must reject stale explicit parent ids."
);
assert.equal(
  proofBundle.targetCallbackApproval?.parentBindingProof?.noRelaySideEffect,
  true,
  "Target callback parent-binding rejection must not create relay side effects."
);
assert.equal(
  proofBundle.sourceFacingCancelProofAcceptable,
  true,
  "ACP relay real proof must include source-facing session/cancel for a running delegated prompt."
);
assert.equal(
  proofBundle.targetCallbackApproval?.sourceCancelProof?.targetCancelObserved,
  true,
  "Source-facing session/cancel proof must show the target ACP process received session/cancel."
);
assert.equal(
  proofBundle.targetCallbackApproval?.sourceCancelProof?.promptResponseKind,
  "cancelled",
  "Source-facing session/cancel proof must project responseKind=cancelled."
);
assert.equal(
  proofBundle.targetCallbackApproval?.sourceCancelProof?.lateTargetCompletionSuppressed,
  true,
  "Source-facing session/cancel proof must suppress late target completion after cancellation."
);
assert.equal(
  proofBundle.targetReconnectProofAcceptable,
  true,
  "ACP relay real proof must include target process restart reconnect/resume evidence."
);
assert.equal(
  proofBundle.targetReconnect?.reconnectProof?.targetProcessRestartObserved,
  true,
  "Target reconnect proof must show the downstream ACP target process restarted."
);
assert.equal(
  proofBundle.targetReconnect?.reconnectProof?.resumeTargetResumeRefMatchedFirst,
  true,
  "Target reconnect proof must resume the restarted target with the previous targetResumeRef."
);
assert.equal(
  proofBundle.targetReconnect?.reconnectProof?.sourceRelaySessionStable,
  true,
  "Target reconnect proof must keep the source relay session stable across target restart."
);
assert.equal(
  proofBundle.targetReconnect?.reconnectProof?.reasoningTraceReplaySuppressed,
  true,
  "Target reconnect proof must keep default source restore free of target reasoning traces."
);
assert.equal(
  proofBundle.targetLoadReconnectProofAcceptable,
  true,
  "ACP relay real proof must include load-only target process restart reconnect/session-load evidence."
);
assert.equal(
  proofBundle.targetLoadReconnect?.loadReconnectProof?.targetProcessRestartObserved,
  true,
  "Target load-only reconnect proof must show the downstream ACP target process restarted."
);
assert.equal(
  proofBundle.targetLoadReconnect?.loadReconnectProof?.targetSessionLoadUsed,
  true,
  "Target load-only reconnect proof must load the restarted target with the previous targetResumeRef."
);
assert.equal(
  proofBundle.targetLoadReconnect?.loadReconnectProof?.targetSessionResumeNotUsed,
  true,
  "Target load-only reconnect proof must not call target session/resume."
);
assert.equal(
  proofBundle.targetLoadReconnect?.loadReconnectProof?.reasoningTraceReplaySuppressed,
  true,
  "Target load-only reconnect proof must keep default source restore free of target reasoning traces."
);
assert.equal(
  proofBundle.targetCallbackApproval?.denialProof?.responseKind,
  "approval_denied",
  "Target callback denial proof must project responseKind=approval_denied."
);
assert.equal(
  proofBundle.targetCallbackApproval?.denialProof?.summaryKind,
  "approval_denied",
  "Target callback denial proof must project communicationSummary.summaryKind=approval_denied."
);
assert.equal(
  proofBundle.targetCallbackApproval?.denialProof?.permissionRequestStatus,
  "denied",
  "Target callback denial proof must persist the permission request as denied."
);
assert.equal(
  proofBundle.targetCallbackApproval?.denialProof?.fileWritten,
  false,
  "Target callback denial proof must not write the denied target file."
);
assert.equal(
  proofBundle.targetCallbackApproval?.denialProof?.noContentLeak,
  true,
  "Target callback denial proof must not leak guarded target write content."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) => item.id === "target_callback_approval_resume")?.status,
  "proven",
  "Top-level real proof matrix must include proven target callback approval resume."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) => item.id === "target_callback_approval_denial")?.status,
  "proven",
  "Top-level real proof matrix must include proven target callback approval denial."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) => item.id === "target_callback_parent_binding")?.status,
  "proven",
  "Top-level real proof matrix must include proven target callback parent-binding fail-closed safety."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) => item.id === "source_facing_session_cancel_running_prompt")?.status,
  "proven",
  "Top-level real proof matrix must include proven source-facing session/cancel running prompt safety."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) => item.id === "target_reconnect_resume_after_process_restart")?.status,
  "proven",
  "Top-level real proof matrix must include proven target reconnect/resume after process restart."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) =>
    item.id === "target_reconnect_load_only_after_process_restart"
  )?.status,
  "proven",
  "Top-level real proof matrix must include proven target reconnect/load after process restart."
);
assert.equal(
  proofBundle.idempotencyProofAcceptable,
  true,
  "ACP relay real proof must include source-facing idempotency replay/conflict evidence."
);
assert.equal(
  proofBundle.idempotency?.replayProof?.idempotencyReplay,
  true,
  "Idempotency proof must mark the duplicate prompt as a replay."
);
assert.equal(
  proofBundle.idempotency?.replayProof?.sameTurn,
  true,
  "Idempotency proof must replay the same relay turn."
);
assert.equal(
  proofBundle.idempotency?.replayProof?.targetPromptCountAfterReplay,
  1,
  "Idempotency replay must not wake the target a second time."
);
assert.equal(
  proofBundle.idempotency?.conflictProof?.errorCode,
  "idempotency_key_conflict",
  "Idempotency proof must reject same-key different prompts."
);
assert.equal(
  proofBundle.idempotency?.conflictProof?.targetPromptCountAfterConflict,
  1,
  "Idempotency conflict must not wake the target."
);
assert.equal(
  proofBundle.proofMatrix?.requirements?.find((item) => item.id === "source_facing_idempotency_replay_conflict")?.status,
  "proven",
  "Top-level real proof matrix must include proven source-facing idempotency replay/conflict safety."
);
} else {
  for (const requirementId of [
    "target_callback_approval_resume",
    "target_callback_approval_denial",
    "target_callback_parent_binding",
    "source_facing_session_cancel_running_prompt",
    "target_reconnect_resume_after_process_restart",
    "target_reconnect_load_only_after_process_restart",
    "source_facing_idempotency_replay_conflict"
  ]) {
    assert.equal(
      proofBundle.proofMatrix?.requirements?.find((item) => item.id === requirementId)?.status,
      "not_required",
      `Unrequested target lifecycle proof ${requirementId} must be skipped, not failed.`
    );
  }
}

if (process.env.PACT_ACP_RELAY_REAL_PROOF_BUNDLE_PATH) {
  await fs.mkdir(path.dirname(process.env.PACT_ACP_RELAY_REAL_PROOF_BUNDLE_PATH), { recursive: true });
  await fs.writeFile(
    process.env.PACT_ACP_RELAY_REAL_PROOF_BUNDLE_PATH,
    `${JSON.stringify(proofBundle, null, 2)}\n`,
    "utf8"
  );
}

console.log(JSON.stringify(proofBundle, null, 2));
