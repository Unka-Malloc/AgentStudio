import { buildAcpAgentRelayProofMatrix } from "./acp-agent-relay-proof-matrix.mjs";

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function parseJsonObjects(text = "") {
  const objects = [];
  const source = asText(text);
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(start, index + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // Ignore non-JSON brace blocks from logs.
        }
        start = -1;
      }
    }
  }
  return objects;
}

export function selectCodexAntigravityVerifierResult(text = "") {
  return parseJsonObjects(text)
    .reverse()
    .find((object) => object?.verifier === "acp-agent-relay-codex-antigravity") || null;
}

export function buildCodexCliRelayProof({
  marker = "",
  codexCliPath = "",
  codexCliVersion = "",
  codexExitCode = null,
  codexSignal = "",
  relayResult = null,
  rawRelayOutput = "",
  lastMessage = "",
  connectRequired = false
} = {}) {
  const markerText = asText(marker);
  const rawText = asText(rawRelayOutput);
  const relay = relayResult && typeof relayResult === "object" ? relayResult : null;
  const markerFamily = markerText.replace(/_[0-9]+$/u, "_");
  const markerNeedles = [
    markerText,
    markerFamily.length < markerText.length ? markerFamily : ""
  ].filter((needle) => needle.length > 0);
  const relayText = JSON.stringify(relay || {});
  const markerObserved = markerNeedles.length > 0 &&
    markerNeedles.some((needle) => rawText.includes(needle) || relayText.includes(needle));
  const antigravityProofAcceptable = relay?.ok === true && relay?.antigravityProofMeetsMinimum === true;
  const connectProofAcceptable = connectRequired ? relay?.sourceConnectProofAcceptable === true : true;
  const codexCliProcessVerified = codexExitCode === 0 && !codexSignal;
  const baseProof = {
    ok: Boolean(codexCliProcessVerified && markerObserved && antigravityProofAcceptable && connectProofAcceptable),
    verifier: "acp-agent-relay-codex-cli-antigravity",
    marker: markerText,
    codexCliPath: asText(codexCliPath),
    codexCliVersion: asText(codexCliVersion),
    codexCliProcessVerified,
    codexExitCode,
    codexSignal: asText(codexSignal),
    codexCliRanRelayJob: Boolean(relay),
    markerObservedInRelayOutput: markerObserved,
    markerFamilyObserved: markerObserved && markerFamily.length < markerText.length,
    connectRequired: Boolean(connectRequired),
    antigravityProofAcceptable,
    connectProofAcceptable,
    relayVerifier: relay?.verifier || "",
    relayProof: relay?.proof || "",
    relaySourceMode: relay?.sourceMode || "",
    relaySourceAgentKind: relay?.sourceAgentProof?.sourceAgentKind || "",
    relayDirectCodexCliAcpSourceVerified: relay?.sourceAgentProof?.directCodexCliAcpSourceVerified === true,
    relayAntigravityProofLevel: relay?.antigravityProofLevel || "",
    relayMinimumAntigravityProofLevel: relay?.minimumAntigravityProofLevel || "",
    relaySourceConnectProofLevel: relay?.sourceConnectProofLevel || "",
    relaySourceConnectMinimumProofLevel: relay?.sourceConnectMinimumProofLevel || "",
    relaySourceTurnObserveProofLevel: relay?.sourceTurnObserveProofLevel || "",
    relaySourceTurnObserveProofAcceptable: relay?.sourceTurnObserveProofAcceptable === true,
    relayResponseKind: relay?.responseKind || "",
    relaySummaryKind: relay?.communicationSummary?.summaryKind || "",
    relayFirstResponseKind: relay?.firstResponseKind || "",
    relayFirstSummaryKind: relay?.firstCommunicationSummary?.summaryKind || "",
    relaySecondResponseKind: relay?.secondResponseKind || "",
    relaySecondSummaryKind: relay?.secondCommunicationSummary?.summaryKind || "",
    relaySourceTurnObserveResponseKind: relay?.sourceTurnObserve?.responseKind || "",
    relaySourceTurnObserveSummaryKind: relay?.sourceTurnObserve?.communicationSummary?.summaryKind || "",
    relaySourceSessionCloseLifecycleState: relay?.sourceSessionCloseProof?.closeLifecycleState || "",
    relaySourceSessionClosePromptAfterCloseErrorCode: relay?.sourceSessionCloseProof?.promptAfterCloseErrorCode || "",
    relaySourceSessionCloseResumeAfterRestartErrorCode: relay?.sourceSessionCloseProof?.resumeAfterCloseRestartErrorCode || "",
    relaySourceSessionClosePromptAfterRestartErrorCode: relay?.sourceSessionCloseProof?.promptAfterCloseRestartErrorCode || "",
    lastMessagePreview: asText(lastMessage).replace(/\s+/g, " ").slice(0, 500)
  };
  return {
    ...baseProof,
    proofMatrix: buildAcpAgentRelayProofMatrix({
      sourceAgentProof: relay?.sourceAgentProof,
      sourceImplementation: relay?.sourceImplementation,
      sourceMode: relay?.sourceMode,
      sessionId: relay?.sessionId,
      loadedSessionId: relay?.loadedSessionId,
      resumedSessionId: relay?.resumedSessionId,
      persistedTargetSessionId: relay?.persistedTargetSessionId,
      persistedTargetResumeRef: relay?.persistedTargetResumeRef,
      agentCatalogCount: relay?.agentCatalogCount,
      antigravityProofLevel: relay?.antigravityProofLevel,
      minimumAntigravityProofLevel: relay?.minimumAntigravityProofLevel,
      antigravityProofMeetsMinimum: relay?.antigravityProofMeetsMinimum === true,
      responseKind: relay?.responseKind,
      firstResponseKind: relay?.firstResponseKind,
      secondResponseKind: relay?.secondResponseKind,
      communicationSummary: relay?.communicationSummary,
      firstCommunicationSummary: relay?.firstCommunicationSummary,
      secondCommunicationSummary: relay?.secondCommunicationSummary,
      sourceTurnObserve: relay?.sourceTurnObserve,
      sourceIdentityIsolationProof: relay?.sourceIdentityIsolationProof,
      sourceSessionCloseProof: relay?.sourceSessionCloseProof,
      antigravityIdeCliCapabilitySnapshot: relay?.ideCliCapabilitySnapshot,
      connectRequired,
      sourceConnectProofLevel: relay?.sourceConnectProofLevel,
      sourceConnectMinimumProofLevel: relay?.sourceConnectMinimumProofLevel,
      sourceConnectProofAcceptable: relay?.sourceConnectProofAcceptable === true,
      codexCliParticipationProof: baseProof
    })
  };
}
