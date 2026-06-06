function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function requirement({
  id,
  label,
  required = true,
  proven = false,
  unsupported = false,
  notRequired = false,
  evidence = {},
  caveat = ""
}) {
  const status = notRequired
    ? "not_required"
    : unsupported
      ? "unsupported"
      : proven
        ? "proven"
        : "failed";
  return {
    id,
    label,
    required: Boolean(required && !notRequired),
    status,
    evidence,
    caveat: asText(caveat)
  };
}

function isCommunicationSummarySourceSafe(summary = {}) {
  const input = asObject(summary, null);
  if (!input) {
    return false;
  }
  return Boolean(
    asText(input.relaySessionId) &&
      asText(input.relayTurnId) &&
      asText(input.virtualAgentId) &&
      asText(input.targetId) &&
      asText(input.stopReason) &&
      input.reasoningIncluded === false
  );
}

function responseKindMatchesSummary(responseKind = "", summary = {}) {
  const input = asObject(summary, null);
  return Boolean(input && asText(responseKind) && asText(responseKind) === asText(input.summaryKind));
}

function isTurnObservationSourceSafe(observeResult = {}) {
  const input = asObject(observeResult, null);
  if (!input || input.observed !== true) {
    return false;
  }
  const targetObservation = asObject(input.targetObservation, null);
  const serialized = JSON.stringify(input);
  const hasObservationEvidence = Boolean(
    targetObservation?.markerObserved === true ||
      targetObservation?.markerMessageObserved === true ||
      targetObservation?.markerTranscriptObserved === true ||
      targetObservation?.transcriptAdvanced === true ||
      targetObservation?.progressAvailable === true ||
      targetObservation?.finalResponseAvailable === true ||
      targetObservation?.errorAvailable === true ||
      targetObservation?.knownErrorAvailable === true
  );
  return Boolean(
    asText(input.relaySessionId) &&
      asText(input.relayTurnId) &&
      isCommunicationSummarySourceSafe(input.communicationSummary) &&
      responseKindMatchesSummary(input.responseKind, input.communicationSummary) &&
      asText(input.communicationSummary?.relayTurnId) === asText(input.relayTurnId) &&
      hasObservationEvidence &&
      !serialized.includes("transcriptPath") &&
      !serialized.includes("messagesDir") &&
      !serialized.includes('"content":') &&
      !serialized.includes('"text":')
  );
}

function isSourceIdentityIsolationProven(proof = {}) {
  const input = asObject(proof, null);
  if (!input) {
    return false;
  }
  return Boolean(
    asText(input.ownerSourceId) &&
      asText(input.foreignSourceId) &&
      asText(input.ownerSourceId) !== asText(input.foreignSourceId) &&
      asText(input.relaySessionId) &&
      asText(input.foreignInitializeSourceId) === asText(input.foreignSourceId) &&
      asText(input.spoofedLoadErrorCode) === "relay_session_not_found" &&
      input.requestBodyOverrideRejected === true &&
      input.sessionEnumerationIsolated === true &&
      input.spoofedSessionListOwnerVisible === false
  );
}

function isSourceSessionCloseProofProven(proof = {}) {
  const input = asObject(proof, null);
  if (!input) {
    return false;
  }
  const sessionId = asText(input.relaySessionId || input.sessionId);
  return Boolean(
    sessionId &&
      asText(input.closedSessionId) === sessionId &&
      asText(input.closeLifecycleState) === "closed" &&
      input.closeOk === true &&
      asText(input.promptAfterCloseErrorCode) === "relay_session_closed" &&
      asText(input.closedSessionLoadAfterRestartLifecycleState) === "closed" &&
      asText(input.resumeAfterCloseRestartErrorCode) === "relay_session_closed" &&
      asText(input.promptAfterCloseRestartErrorCode) === "relay_session_closed"
  );
}

function isMultiTurnContinuityProven({
  sessionId = "",
  loadedSessionId = "",
  resumedSessionId = "",
  firstResponseKind = "",
  secondResponseKind = "",
  firstCommunicationSummary = null,
  secondCommunicationSummary = null
} = {}) {
  const first = asObject(firstCommunicationSummary, null);
  const second = asObject(secondCommunicationSummary, null);
  const firstTargetSessionId = asText(first?.targetSessionId);
  const secondTargetSessionId = asText(second?.targetSessionId);
  const firstTargetResumeRef = asText(first?.targetResumeRef);
  const secondTargetResumeRef = asText(second?.targetResumeRef);
  return Boolean(
    asText(sessionId) &&
      asText(loadedSessionId) === asText(sessionId) &&
      asText(resumedSessionId) === asText(sessionId) &&
      isCommunicationSummarySourceSafe(first) &&
      isCommunicationSummarySourceSafe(second) &&
      responseKindMatchesSummary(firstResponseKind, first) &&
      responseKindMatchesSummary(secondResponseKind, second) &&
      asText(first.relaySessionId) === asText(sessionId) &&
      asText(second.relaySessionId) === asText(sessionId) &&
      asText(first.relaySessionId) === asText(second.relaySessionId) &&
      asText(first.relayTurnId) &&
      asText(second.relayTurnId) &&
      asText(first.relayTurnId) !== asText(second.relayTurnId) &&
      asText(first.virtualAgentId) === asText(second.virtualAgentId) &&
      asText(first.targetId) === asText(second.targetId) &&
      (!firstTargetSessionId || !secondTargetSessionId || firstTargetSessionId === secondTargetSessionId) &&
      (!firstTargetResumeRef || !secondTargetResumeRef || firstTargetResumeRef === secondTargetResumeRef)
  );
}

export function buildAcpAgentRelayProofMatrix({
  sourceAgentProof = null,
  sourceImplementation = "",
  sourceMode = "",
  sessionId = "",
  loadedSessionId = "",
  resumedSessionId = "",
  persistedTargetSessionId = "",
  persistedTargetResumeRef = "",
  agentCatalogCount = 0,
  antigravityProofLevel = "",
  minimumAntigravityProofLevel = "",
  antigravityProofMeetsMinimum = false,
  responseKind = "",
  firstResponseKind = "",
  secondResponseKind = "",
  communicationSummary = null,
  firstCommunicationSummary = null,
  secondCommunicationSummary = null,
  sourceTurnObserve = null,
  sourceIdentityIsolationProof = null,
  sourceSessionCloseProof = null,
  antigravityIdeCliCapabilitySnapshot = null,
  connectRequired = false,
  sourceConnectProofLevel = "",
  sourceConnectMinimumProofLevel = "",
  sourceConnectProofAcceptable = false,
  codexCliParticipationProof = null
} = {}) {
  const sourceProof = asObject(sourceAgentProof, null);
  const codexCliProof = asObject(codexCliParticipationProof, null);
  const antigravityIdeCli = asObject(antigravityIdeCliCapabilitySnapshot, null);
  const effectiveSourceMode = asText(sourceMode || sourceProof?.sourceMode);
  const directNativeCodexSource = sourceProof?.directCodexCliAcpSourceVerified === true;
  const directNativeAntigravityIdeSource = antigravityIdeCli?.nativeAcpSourceVerified === true;
  const effectiveSecondCommunicationSummary = asObject(secondCommunicationSummary, null) || asObject(communicationSummary, null);
  const effectiveSecondResponseKind = asText(secondResponseKind || responseKind);
  const durableSessionProven = Boolean(
    asText(sessionId) &&
      asText(loadedSessionId) === asText(sessionId) &&
      asText(resumedSessionId) === asText(sessionId) &&
      asText(persistedTargetSessionId) &&
      asText(persistedTargetResumeRef)
  );
  const primarySummarySafe = isCommunicationSummarySourceSafe(communicationSummary) &&
    responseKindMatchesSummary(responseKind, communicationSummary);
  const firstSummarySafe = isCommunicationSummarySourceSafe(firstCommunicationSummary) &&
    responseKindMatchesSummary(firstResponseKind, firstCommunicationSummary);
  const sourceSummarySafe = primarySummarySafe || firstSummarySafe;
  const multiTurnContinuityProven = isMultiTurnContinuityProven({
    sessionId,
    loadedSessionId,
    resumedSessionId,
    firstResponseKind,
    secondResponseKind: effectiveSecondResponseKind,
    firstCommunicationSummary,
    secondCommunicationSummary: effectiveSecondCommunicationSummary
  });
  const sourceTurnObserveSafe = isTurnObservationSourceSafe(sourceTurnObserve);
  const sourceIdentityIsolationProven = isSourceIdentityIsolationProven(sourceIdentityIsolationProof);
  const sourceSessionCloseProofProven = isSourceSessionCloseProofProven(sourceSessionCloseProof);
  const codexCliParticipationRequested = Boolean(codexCliProof);
  const codexCliParticipationProven = Boolean(
    codexCliProof?.codexCliProcessVerified === true &&
      codexCliProof?.codexCliRanRelayJob === true &&
      codexCliProof?.markerObservedInRelayOutput === true
  );

  const requirements = [
    requirement({
      id: "pact_source_facing_acp_surface",
      label: "Pact exposes a source-facing ACP surface with virtual-agent capabilities.",
      proven: Boolean(
        asText(sourceImplementation || "pact-source-stdio-server") &&
          ["orchestrated_harness", "native"].includes(effectiveSourceMode) &&
          Number(agentCatalogCount || 0) > 0
      ),
      evidence: {
        sourceImplementation: asText(sourceImplementation),
        sourceMode: effectiveSourceMode,
        agentCatalogCount: Number(agentCatalogCount || 0)
      }
    }),
    requirement({
      id: "durable_relay_session_wake",
      label: "Relay session persists and wakes/resumes against the same target conversation.",
      proven: durableSessionProven,
      evidence: {
        sessionId: asText(sessionId),
        loadedSessionId: asText(loadedSessionId),
        resumedSessionId: asText(resumedSessionId),
        persistedTargetSessionId: asText(persistedTargetSessionId),
        persistedTargetResumeRef: asText(persistedTargetResumeRef)
      }
    }),
    requirement({
      id: "source_facing_multi_turn_continuity",
      label: "Source agent can continue the same relay session across restart and send a second delegated ACP turn.",
      proven: multiTurnContinuityProven,
      evidence: {
        sessionId: asText(sessionId),
        loadedSessionId: asText(loadedSessionId),
        resumedSessionId: asText(resumedSessionId),
        firstRelaySessionId: asText(asObject(firstCommunicationSummary, null)?.relaySessionId),
        secondRelaySessionId: asText(effectiveSecondCommunicationSummary?.relaySessionId),
        firstRelayTurnId: asText(asObject(firstCommunicationSummary, null)?.relayTurnId),
        secondRelayTurnId: asText(effectiveSecondCommunicationSummary?.relayTurnId),
        firstResponseKind: asText(firstResponseKind),
        secondResponseKind: effectiveSecondResponseKind,
        firstSummaryKind: asText(asObject(firstCommunicationSummary, null)?.summaryKind),
        secondSummaryKind: asText(effectiveSecondCommunicationSummary?.summaryKind),
        sameRelaySession: asText(asObject(firstCommunicationSummary, null)?.relaySessionId) ===
          asText(effectiveSecondCommunicationSummary?.relaySessionId),
        distinctRelayTurns: Boolean(
          asText(asObject(firstCommunicationSummary, null)?.relayTurnId) &&
            asText(effectiveSecondCommunicationSummary?.relayTurnId) &&
            asText(asObject(firstCommunicationSummary, null)?.relayTurnId) !==
              asText(effectiveSecondCommunicationSummary?.relayTurnId)
        ),
        sameVirtualAgent: asText(asObject(firstCommunicationSummary, null)?.virtualAgentId) ===
          asText(effectiveSecondCommunicationSummary?.virtualAgentId),
        sameTarget: asText(asObject(firstCommunicationSummary, null)?.targetId) ===
          asText(effectiveSecondCommunicationSummary?.targetId),
        firstReasoningIncluded: asObject(firstCommunicationSummary, null)?.reasoningIncluded === true,
        secondReasoningIncluded: effectiveSecondCommunicationSummary?.reasoningIncluded === true
      }
    }),
    requirement({
      id: "source_identity_isolation",
      label: "Source identity is locked per ACP transport and foreign request-body spoofing cannot access another source session.",
      proven: sourceIdentityIsolationProven,
      evidence: {
        ownerSourceId: asText(sourceIdentityIsolationProof?.ownerSourceId),
        foreignSourceId: asText(sourceIdentityIsolationProof?.foreignSourceId),
        relaySessionId: asText(sourceIdentityIsolationProof?.relaySessionId),
        foreignInitializeSourceId: asText(sourceIdentityIsolationProof?.foreignInitializeSourceId),
        spoofedLoadErrorCode: asText(sourceIdentityIsolationProof?.spoofedLoadErrorCode),
        requestBodyOverrideRejected: sourceIdentityIsolationProof?.requestBodyOverrideRejected === true,
        sessionEnumerationIsolated: sourceIdentityIsolationProof?.sessionEnumerationIsolated === true,
        spoofedSessionListOwnerVisible: sourceIdentityIsolationProof?.spoofedSessionListOwnerVisible === true
      }
    }),
    requirement({
      id: "source_facing_session_close_terminal",
      label: "Source agent can close a relay session and closed state survives restart without reopening target delegation.",
      proven: sourceSessionCloseProofProven,
      evidence: {
        relaySessionId: asText(sourceSessionCloseProof?.relaySessionId || sourceSessionCloseProof?.sessionId),
        closedSessionId: asText(sourceSessionCloseProof?.closedSessionId),
        closeLifecycleState: asText(sourceSessionCloseProof?.closeLifecycleState),
        closeOk: sourceSessionCloseProof?.closeOk === true,
        promptAfterCloseErrorCode: asText(sourceSessionCloseProof?.promptAfterCloseErrorCode),
        closedSessionLoadAfterRestartLifecycleState: asText(sourceSessionCloseProof?.closedSessionLoadAfterRestartLifecycleState),
        resumeAfterCloseRestartErrorCode: asText(sourceSessionCloseProof?.resumeAfterCloseRestartErrorCode),
        promptAfterCloseRestartErrorCode: asText(sourceSessionCloseProof?.promptAfterCloseRestartErrorCode)
      }
    }),
    requirement({
      id: "real_antigravity_target_communication",
      label: "Pact relay moves a real Antigravity target conversation.",
      proven: antigravityProofMeetsMinimum === true && asText(antigravityProofLevel) !== "none",
      evidence: {
        proofLevel: asText(antigravityProofLevel),
        minimumProofLevel: asText(minimumAntigravityProofLevel),
        proofMeetsMinimum: antigravityProofMeetsMinimum === true
      }
    }),
    requirement({
      id: "source_facing_progress_summary",
      label: "Source agent receives progress/summary evidence without target reasoning contamination.",
      proven: sourceSummarySafe,
      evidence: {
        responseKind: asText(responseKind),
        summaryKind: asText(asObject(communicationSummary, null)?.summaryKind),
        firstResponseKind: asText(firstResponseKind),
        firstSummaryKind: asText(asObject(firstCommunicationSummary, null)?.summaryKind),
        communicationSummaryTurnId: asText(asObject(communicationSummary, null)?.relayTurnId),
        firstCommunicationSummaryTurnId: asText(asObject(firstCommunicationSummary, null)?.relayTurnId),
        reasoningIncluded: asObject(communicationSummary, null)?.reasoningIncluded ??
          asObject(firstCommunicationSummary, null)?.reasoningIncluded
      }
    }),
    requirement({
      id: "source_facing_turn_observation",
      label: "Source agent can request a source-safe target turn observation refresh through Pact ACP.",
      proven: sourceTurnObserveSafe,
      evidence: {
        relaySessionId: asText(sourceTurnObserve?.relaySessionId),
        relayTurnId: asText(sourceTurnObserve?.relayTurnId),
        responseKind: asText(sourceTurnObserve?.responseKind),
        summaryKind: asText(sourceTurnObserve?.communicationSummary?.summaryKind),
        observed: sourceTurnObserve?.observed === true,
        refreshed: sourceTurnObserve?.refreshed === true,
        markerObserved: sourceTurnObserve?.targetObservation?.markerObserved === true ||
          sourceTurnObserve?.targetObservation?.markerMessageObserved === true ||
          sourceTurnObserve?.targetObservation?.markerTranscriptObserved === true,
        progressAvailable: sourceTurnObserve?.targetObservation?.progressAvailable === true,
        finalResponseAvailable: sourceTurnObserve?.targetObservation?.finalResponseAvailable === true ||
          sourceTurnObserve?.communicationSummary?.finalResponseAvailable === true,
        targetErrorAvailable: sourceTurnObserve?.targetObservation?.errorAvailable === true ||
          sourceTurnObserve?.targetObservation?.knownErrorAvailable === true ||
          Boolean(sourceTurnObserve?.communicationSummary?.targetErrorCode)
      }
    }),
    requirement({
      id: "antigravity_connect_observation",
      label: "Optional Antigravity Connect trajectory evidence meets the requested proof level.",
      required: Boolean(connectRequired),
      notRequired: !connectRequired,
      proven: sourceConnectProofAcceptable === true,
      evidence: {
        proofLevel: asText(sourceConnectProofLevel || "none"),
        minimumProofLevel: asText(sourceConnectMinimumProofLevel || "none"),
        proofAcceptable: sourceConnectProofAcceptable === true
      }
    }),
    requirement({
      id: "codex_cli_participation",
      label: "A real Codex CLI process participated in invoking the relay verification job.",
      required: codexCliParticipationRequested,
      notRequired: !codexCliParticipationRequested,
      proven: codexCliParticipationProven,
      evidence: {
        codexCliPath: asText(codexCliProof?.codexCliPath),
        codexCliVersion: asText(codexCliProof?.codexCliVersion),
        codexCliProcessVerified: codexCliProof?.codexCliProcessVerified === true,
        codexCliRanRelayJob: codexCliProof?.codexCliRanRelayJob === true,
        markerObservedInRelayOutput: codexCliProof?.markerObservedInRelayOutput === true
      }
    }),
    requirement({
      id: "native_codex_cli_acp_source",
      label: "Codex CLI itself is the source ACP client connected to Pact.",
      required: false,
      proven: directNativeCodexSource,
      unsupported: !directNativeCodexSource,
      evidence: {
        sourceAgentKind: asText(sourceProof?.sourceAgentKind),
        sourceMode: effectiveSourceMode,
        codexCliAcpClientSupported: sourceProof?.codexCliAcpClientSupported === true,
        directCodexCliAcpSourceVerified: directNativeCodexSource
      },
      caveat: directNativeCodexSource
        ? ""
        : "Current local Codex CLI proof is participation via codex exec, not native ACP source/client mode."
    }),
    requirement({
      id: "native_antigravity_ide_cli_acp_source",
      label: "Antigravity IDE CLI itself is a source ACP client connected to Pact.",
      required: false,
      proven: directNativeAntigravityIdeSource,
      unsupported: !directNativeAntigravityIdeSource,
      evidence: {
        provider: asText(antigravityIdeCli?.provider || "antigravity-ide-cli"),
        found: antigravityIdeCli?.found === true,
        cliPath: asText(antigravityIdeCli?.cliPath),
        version: asText(antigravityIdeCli?.version),
        subcommands: Array.isArray(antigravityIdeCli?.subcommands) ? antigravityIdeCli.subcommands : [],
        chatCommandSupported: antigravityIdeCli?.chatCommandSupported === true,
        chatReadsStdin: antigravityIdeCli?.chatReadsStdin === true,
        chatIsAcpTransport: antigravityIdeCli?.chatIsAcpTransport === true,
        mcpConfigSupported: antigravityIdeCli?.mcpConfigSupported === true,
        nativeAcpCommandNames: Array.isArray(antigravityIdeCli?.nativeAcpCommandNames)
          ? antigravityIdeCli.nativeAcpCommandNames
          : [],
        nativeAcpTransportSupported: antigravityIdeCli?.nativeAcpTransportSupported === true,
        nativeAcpTargetVerified: antigravityIdeCli?.nativeAcpTargetVerified === true,
        nativeAcpSourceVerified: directNativeAntigravityIdeSource,
        reasonCode: asText(antigravityIdeCli?.reasonCode)
      },
      caveat: directNativeAntigravityIdeSource
        ? ""
        : "Current Antigravity IDE CLI proof is Agent API target communication and CLI capability probing; chat is not verified as a native ACP source/client transport."
    })
  ];
  const requiredRequirements = requirements.filter((item) => item.required);
  const failedRequired = requiredRequirements.filter((item) => item.status !== "proven");
  return {
    schemaVersion: "pact.acp-agent-relay.proof-matrix.v1",
    allRequiredProofsMet: failedRequired.length === 0,
    requiredCount: requiredRequirements.length,
    provenRequiredCount: requiredRequirements.length - failedRequired.length,
    failedRequiredIds: failedRequired.map((item) => item.id),
    unsupportedIds: requirements
      .filter((item) => item.status === "unsupported")
      .map((item) => item.id),
    requirements
  };
}
