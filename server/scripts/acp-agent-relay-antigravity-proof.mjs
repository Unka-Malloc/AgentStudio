function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

export const ANTIGRAVITY_RELAY_PROOF_LEVEL_RANK = Object.freeze({
  none: 0,
  local_marker_observation: 1,
  conversation_file: 2,
  conversation_file_and_local_marker_observation: 3
});

const ANTIGRAVITY_RELAY_PROOF_LEVEL_ALIASES = Object.freeze({
  none: "none",
  marker: "local_marker_observation",
  marker_only: "local_marker_observation",
  local_marker: "local_marker_observation",
  local_marker_observation: "local_marker_observation",
  conversation_file: "conversation_file",
  file: "conversation_file",
  conversation: "conversation_file",
  both: "conversation_file_and_local_marker_observation",
  full: "conversation_file_and_local_marker_observation",
  conversation_file_and_marker: "conversation_file_and_local_marker_observation",
  conversation_file_and_local_marker_observation: "conversation_file_and_local_marker_observation"
});

export function normalizeAntigravityRelayProofLevel(value = "", fallback = "local_marker_observation") {
  const normalized = asText(value).toLowerCase().replaceAll("-", "_");
  return ANTIGRAVITY_RELAY_PROOF_LEVEL_ALIASES[normalized] ||
    ANTIGRAVITY_RELAY_PROOF_LEVEL_ALIASES[asText(fallback).toLowerCase().replaceAll("-", "_")] ||
    "local_marker_observation";
}

export function antigravityRelayProofLevel({ fileChanged = false, markerObserved = false } = {}) {
  if (fileChanged && markerObserved) {
    return "conversation_file_and_local_marker_observation";
  }
  if (fileChanged) {
    return "conversation_file";
  }
  if (markerObserved) {
    return "local_marker_observation";
  }
  return "none";
}

export function antigravityRelayProofMeetsMinimum(proofLevel = "", minimumLevel = "local_marker_observation") {
  const proof = normalizeAntigravityRelayProofLevel(proofLevel, "none");
  const minimum = normalizeAntigravityRelayProofLevel(minimumLevel);
  return (ANTIGRAVITY_RELAY_PROOF_LEVEL_RANK[proof] || 0) >=
    (ANTIGRAVITY_RELAY_PROOF_LEVEL_RANK[minimum] || 0);
}

export function buildAntigravityRelayProof({
  before = null,
  changedConversation = null,
  localObservation = null,
  metadataProbe = null,
  minimumProofLevel = "local_marker_observation"
} = {}) {
  const previous = asObject(before, null);
  const changed = asObject(changedConversation, null);
  const observation = asObject(localObservation, null);
  const fileChanged = Boolean(
    changed &&
      (
        !previous ||
          changed.mtimeMs > previous.mtimeMs ||
          changed.size > previous.size
      )
  );
  const markerObserved = observation.markerMessageObserved === true || observation.markerObserved === true;
  const proofParts = [
    fileChanged ? "conversation-file" : "",
    markerObserved ? "local-marker-observation" : ""
  ].filter(Boolean);
  const proofLevel = antigravityRelayProofLevel({ fileChanged, markerObserved });
  const normalizedMinimumProofLevel = normalizeAntigravityRelayProofLevel(minimumProofLevel);
  return {
    ok: fileChanged || markerObserved,
    proof: proofParts.join("+"),
    proofLevel,
    minimumProofLevel: normalizedMinimumProofLevel,
    proofMeetsMinimum: antigravityRelayProofMeetsMinimum(proofLevel, normalizedMinimumProofLevel),
    fileChanged,
    markerObserved,
    metadataProbeDiagnostic: metadataProbe ? "ok" : null
  };
}
