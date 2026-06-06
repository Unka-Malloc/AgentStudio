function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

export const SOURCE_CONNECT_PROOF_LEVEL_RANK = Object.freeze({
  none: 0,
  connect_marker_only: 1,
  connect_progress: 2,
  connect_target_error: 3,
  connect_pending_interaction: 4,
  connect_formal_deny: 5,
  connect_final_response: 6
});

const SOURCE_CONNECT_PROOF_LEVEL_ALIASES = Object.freeze({
  none: "none",
  marker: "connect_marker_only",
  marker_only: "connect_marker_only",
  connect_marker_only: "connect_marker_only",
  progress: "connect_progress",
  connect_progress: "connect_progress",
  target_error: "connect_target_error",
  connect_target_error: "connect_target_error",
  pending_interaction: "connect_pending_interaction",
  connect_pending_interaction: "connect_pending_interaction",
  formal_deny: "connect_formal_deny",
  command_deny: "connect_formal_deny",
  connect_formal_deny: "connect_formal_deny",
  final: "connect_final_response",
  final_response: "connect_final_response",
  connect_final_response: "connect_final_response"
});

export function normalizeSourceConnectProofLevel(value = "", fallback = "none") {
  const normalized = asText(value).toLowerCase().replaceAll("-", "_");
  return SOURCE_CONNECT_PROOF_LEVEL_ALIASES[normalized] ||
    SOURCE_CONNECT_PROOF_LEVEL_ALIASES[asText(fallback).toLowerCase().replaceAll("-", "_")] ||
    "none";
}

export function sourceConnectProofFromPromptResult(promptResult = {}, label = "") {
  const targetEvidence = asObject(promptResult?.targetEvidence);
  const connect = asObject(targetEvidence.connectConversationObservation, null);
  const targetError = asObject(targetEvidence.targetError, null);
  const receipts = Array.isArray(targetEvidence.targetInteractionReceipts)
    ? targetEvidence.targetInteractionReceipts
    : [];
  const terminalDenyReceipt = receipts.some((receipt) =>
    receipt?.status === "denied" &&
      receipt?.externalInteraction?.provider === "antigravity-connect" &&
      (receipt?.action === "terminal" || receipt?.targetAction === "command")
  );
  const proof = {
    label,
    turnId: asText(promptResult?.turnId),
    stopReason: asText(promptResult?.stopReason),
    externalCompletionState: asText(targetEvidence.externalCompletionState),
    finalResponsePolicy: asText(targetEvidence.finalResponsePolicy),
    connectObserved: Boolean(connect),
    markerObserved: connect?.markerObserved === true,
    trajectoryAdvanced: connect?.trajectoryAdvanced === true,
    progressAvailable: connect?.progressAvailable === true,
    finalResponseAvailable: connect?.finalResponseAvailable === true || targetEvidence.finalResponseAvailable === true,
    pendingInteraction: connect?.pendingInteraction === true || connect?.blockedByPendingInteraction === true,
    knownErrorAvailable: Boolean(connect?.latestError || connect?.latestKnownError || targetError?.code || targetError?.message),
    terminalDenyReceipt,
    targetErrorCode: asText(targetError?.code)
  };
  if (!proof.connectObserved || !proof.markerObserved) {
    return { ...proof, proofLevel: "none" };
  }
  if (proof.finalResponseAvailable && proof.finalResponsePolicy === "connect_trajectory") {
    return { ...proof, proofLevel: "connect_final_response" };
  }
  if (proof.terminalDenyReceipt) {
    return { ...proof, proofLevel: "connect_formal_deny" };
  }
  if (proof.pendingInteraction) {
    return { ...proof, proofLevel: "connect_pending_interaction" };
  }
  if (proof.knownErrorAvailable) {
    return { ...proof, proofLevel: "connect_target_error" };
  }
  if (proof.trajectoryAdvanced || proof.progressAvailable) {
    return { ...proof, proofLevel: "connect_progress" };
  }
  return { ...proof, proofLevel: "connect_marker_only" };
}

export function strongestSourceConnectProof(proofs = []) {
  return [...proofs].sort((a, b) =>
    (SOURCE_CONNECT_PROOF_LEVEL_RANK[b?.proofLevel] || 0) -
      (SOURCE_CONNECT_PROOF_LEVEL_RANK[a?.proofLevel] || 0)
  )[0] || null;
}

export function sourceConnectProofMeetsMinimum(proofLevel = "", minimumLevel = "none") {
  const proof = normalizeSourceConnectProofLevel(proofLevel);
  const minimum = normalizeSourceConnectProofLevel(minimumLevel);
  return (SOURCE_CONNECT_PROOF_LEVEL_RANK[proof] || 0) >=
    (SOURCE_CONNECT_PROOF_LEVEL_RANK[minimum] || 0);
}

export function defaultSourceConnectMinimumProofLevel({
  connectRequired = false,
  finalRequired = false,
  denyPendingCommandsRequired = false,
  envMinimum = ""
} = {}) {
  if (envMinimum) {
    return normalizeSourceConnectProofLevel(envMinimum, "connect_target_error");
  }
  if (finalRequired) {
    return "connect_final_response";
  }
  if (denyPendingCommandsRequired) {
    return "connect_formal_deny";
  }
  return connectRequired ? "connect_target_error" : "none";
}
