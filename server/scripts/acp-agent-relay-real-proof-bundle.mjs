function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value = "", maxLength = 1000) {
  const text = asText(value).replace(/\s+/g, " ");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function summarizeCommunicationSummary(summary = null) {
  const input = asObject(summary, null);
  return input
    ? {
        relaySessionId: asText(input.relaySessionId),
        relayTurnId: asText(input.relayTurnId),
        virtualAgentId: asText(input.virtualAgentId),
        targetId: asText(input.targetId),
        stopReason: asText(input.stopReason),
        outputAvailable: input.outputAvailable === true,
        outputSummary: compactText(input.outputSummary),
        summaryKind: asText(input.summaryKind),
        finalResponseSummary: compactText(input.finalResponseSummary),
        acknowledgementSummary: compactText(input.acknowledgementSummary),
        externalCompletionState: asText(input.externalCompletionState),
        finalResponseAvailable: input.finalResponseAvailable === true,
        finalResponsePolicy: asText(input.finalResponsePolicy),
        targetErrorCode: asText(input.targetErrorCode),
        targetErrorMessage: compactText(input.targetErrorMessage, 500),
        reasoningIncluded: input.reasoningIncluded === true,
        eventCount: Number(input.eventCount || 0),
        progressEventCount: Number(input.progressEventCount || 0),
        reasoningEventCount: Number(input.reasoningEventCount || 0)
      }
    : null;
}

function normalizeRequirement(value = {}) {
  const input = asObject(value, {});
  const status = ["proven", "failed", "not_required", "unsupported"].includes(input.status)
    ? input.status
    : "failed";
  return {
    id: asText(input.id),
    label: asText(input.label),
    required: input.required === true,
    status,
    evidence: asObject(input.evidence, {}),
    caveat: asText(input.caveat)
  };
}

export function parseJsonObjects(text = "") {
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
          // Ignore log fragments that only look like JSON.
        }
        start = -1;
      }
    }
  }
  return objects;
}

export function selectVerifierResult(text = "", verifier = "") {
  const verifierName = asText(verifier);
  if (!verifierName) {
    return null;
  }
  return parseJsonObjects(text)
    .reverse()
    .find((object) => object?.verifier === verifierName) || null;
}

function summarizeAntigravity(result = null) {
  const input = asObject(result, null);
  return input
	    ? {
	        ok: input.ok === true,
	        verifier: asText(input.verifier),
	        marker: asText(input.marker),
	        targetCommunicationMode: asText(input.targetCommunicationMode, "agent_api_proxy"),
	        nativeAcpTargetSupported: input.nativeAcpTargetSupported === true,
	        nativeAcpTargetVerified: input.nativeAcpTargetVerified === true,
        conversationId: asText(input.conversationId),
        endpointSource: asText(input.endpointSource),
        proof: asText(input.proof),
        proofLevel: asText(input.proofLevel),
        minimumProofLevel: asText(input.minimumProofLevel),
        proofMeetsMinimum: input.proofMeetsMinimum === true,
        changedConversationFile: asText(input.changedConversationFile),
        markerObserved: input.localObservation?.markerObserved === true ||
          input.localObservation?.markerMessageObserved === true,
        ideCliCapabilitySnapshot: asObject(
          input.ideCliCapabilitySnapshot ||
            input.agentApiCapabilitySnapshot?.ideCli ||
            input.targetEvidence?.agentApiCapabilitySnapshot?.ideCli,
          null
        )
      }
    : null;
}

function summarizeCodexAntigravity(result = null) {
  const input = asObject(result, null);
  const proofMatrix = asObject(input?.proofMatrix, null);
  return input
	    ? {
	        ok: input.ok === true,
	        verifier: asText(input.verifier),
	        marker: asText(input.marker),
	        conversationId: asText(input.conversationId),
	        endpointSource: asText(input.endpointSource),
	        proof: asText(input.proof),
	        targetCommunicationMode: asText(input.targetCommunicationMode, "agent_api_proxy"),
        nativeAcpTargetSupported: input.nativeAcpTargetSupported === true,
        nativeAcpTargetVerified: input.nativeAcpTargetVerified === true,
        sourceImplementation: asText(input.sourceImplementation),
        sourceMode: asText(input.sourceMode),
        sourceAgentKind: asText(input.sourceAgentProof?.sourceAgentKind),
        directCodexCliAcpSourceVerified: input.sourceAgentProof?.directCodexCliAcpSourceVerified === true,
        antigravityProofLevel: asText(input.antigravityProofLevel),
        minimumAntigravityProofLevel: asText(input.minimumAntigravityProofLevel),
        antigravityProofMeetsMinimum: input.antigravityProofMeetsMinimum === true,
        sourceConnectProofLevel: asText(input.sourceConnectProofLevel || "none"),
        sourceConnectMinimumProofLevel: asText(input.sourceConnectMinimumProofLevel || "none"),
        sourceConnectProofAcceptable: input.sourceConnectProofAcceptable === true,
        ideCliCapabilitySnapshot: asObject(
          input.ideCliCapabilitySnapshot ||
            input.agentApiCapabilitySnapshot?.ideCli ||
            input.targetEvidence?.agentApiCapabilitySnapshot?.ideCli,
          null
        ),
        sourceTurnObserveProofLevel: asText(input.sourceTurnObserveProofLevel || "none"),
        sourceTurnObserveProofAcceptable: input.sourceTurnObserveProofAcceptable === true,
        responseKind: asText(input.responseKind),
        firstResponseKind: asText(input.firstResponseKind),
        secondResponseKind: asText(input.secondResponseKind),
        communicationSummary: summarizeCommunicationSummary(input.communicationSummary),
        firstCommunicationSummary: summarizeCommunicationSummary(input.firstCommunicationSummary),
        secondCommunicationSummary: summarizeCommunicationSummary(input.secondCommunicationSummary),
        sourceTurnObserve: input.sourceTurnObserve
          ? {
              relaySessionId: asText(input.sourceTurnObserve.relaySessionId),
              relayTurnId: asText(input.sourceTurnObserve.relayTurnId),
              observed: input.sourceTurnObserve.observed === true,
              refreshed: input.sourceTurnObserve.refreshed === true,
              stopReason: asText(input.sourceTurnObserve.stopReason),
              responseKind: asText(input.sourceTurnObserve.responseKind),
              communicationSummary: summarizeCommunicationSummary(input.sourceTurnObserve.communicationSummary),
              finalResponseAvailable: input.sourceTurnObserve.communicationSummary?.finalResponseAvailable === true ||
                input.sourceTurnObserve.targetObservation?.finalResponseAvailable === true,
              markerObserved: input.sourceTurnObserve.targetObservation?.markerObserved === true ||
                input.sourceTurnObserve.targetObservation?.markerMessageObserved === true ||
                input.sourceTurnObserve.targetObservation?.markerTranscriptObserved === true
            }
          : null,
        sourceIdentityIsolationProof: input.sourceIdentityIsolationProof
          ? {
              ownerSourceId: asText(input.sourceIdentityIsolationProof.ownerSourceId),
              foreignSourceId: asText(input.sourceIdentityIsolationProof.foreignSourceId),
              relaySessionId: asText(input.sourceIdentityIsolationProof.relaySessionId),
              foreignInitializeSourceId: asText(input.sourceIdentityIsolationProof.foreignInitializeSourceId),
              spoofedLoadErrorCode: asText(input.sourceIdentityIsolationProof.spoofedLoadErrorCode),
              requestBodyOverrideRejected: input.sourceIdentityIsolationProof.requestBodyOverrideRejected === true,
              sessionEnumerationIsolated: input.sourceIdentityIsolationProof.sessionEnumerationIsolated === true,
              spoofedSessionListOwnerVisible: input.sourceIdentityIsolationProof.spoofedSessionListOwnerVisible === true
            }
          : null,
        sourceSessionCloseProof: input.sourceSessionCloseProof
          ? {
              relaySessionId: asText(input.sourceSessionCloseProof.relaySessionId || input.sourceSessionCloseProof.sessionId),
              closedSessionId: asText(input.sourceSessionCloseProof.closedSessionId),
              closeLifecycleState: asText(input.sourceSessionCloseProof.closeLifecycleState),
              closeOk: input.sourceSessionCloseProof.closeOk === true,
              promptAfterCloseErrorCode: asText(input.sourceSessionCloseProof.promptAfterCloseErrorCode),
              closedSessionLoadAfterRestartLifecycleState: asText(
                input.sourceSessionCloseProof.closedSessionLoadAfterRestartLifecycleState
              ),
              resumeAfterCloseRestartErrorCode: asText(input.sourceSessionCloseProof.resumeAfterCloseRestartErrorCode),
              promptAfterCloseRestartErrorCode: asText(input.sourceSessionCloseProof.promptAfterCloseRestartErrorCode)
            }
          : null,
        proofMatrixSchemaVersion: asText(proofMatrix?.schemaVersion),
        proofMatrixAllRequiredProofsMet: proofMatrix?.allRequiredProofsMet === true,
        proofMatrixFailedRequiredIds: Array.isArray(proofMatrix?.failedRequiredIds)
          ? proofMatrix.failedRequiredIds
          : [],
        proofMatrixUnsupportedIds: Array.isArray(proofMatrix?.unsupportedIds)
          ? proofMatrix.unsupportedIds
          : []
      }
    : null;
}

function summarizeCodexCli(result = null) {
  const input = asObject(result, null);
  const proofMatrix = asObject(input?.proofMatrix, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        codexCliPath: asText(input.codexCliPath),
        codexCliVersion: asText(input.codexCliVersion),
        codexCliSha256: asText(input.codexCliSha256),
        codexCliProcessVerified: input.codexCliProcessVerified === true,
        codexCliRanRelayJob: input.codexCliRanRelayJob === true,
        markerObservedInRelayOutput: input.markerObservedInRelayOutput === true,
        connectRequired: input.connectRequired === true,
        antigravityProofAcceptable: input.antigravityProofAcceptable === true,
        connectProofAcceptable: input.connectProofAcceptable === true,
        relaySourceMode: asText(input.relaySourceMode),
        relaySourceAgentKind: asText(input.relaySourceAgentKind),
        relayDirectCodexCliAcpSourceVerified: input.relayDirectCodexCliAcpSourceVerified === true,
        relayAntigravityProofLevel: asText(input.relayAntigravityProofLevel),
        relaySourceConnectProofLevel: asText(input.relaySourceConnectProofLevel || "none"),
        relaySourceTurnObserveProofLevel: asText(input.relaySourceTurnObserveProofLevel || "none"),
        relaySourceTurnObserveProofAcceptable: input.relaySourceTurnObserveProofAcceptable === true,
        relayResponseKind: asText(input.relayResponseKind),
        relaySummaryKind: asText(input.relaySummaryKind),
        relayFirstResponseKind: asText(input.relayFirstResponseKind),
        relayFirstSummaryKind: asText(input.relayFirstSummaryKind),
        relaySecondResponseKind: asText(input.relaySecondResponseKind),
        relaySecondSummaryKind: asText(input.relaySecondSummaryKind),
        relaySourceTurnObserveResponseKind: asText(input.relaySourceTurnObserveResponseKind),
        relaySourceTurnObserveSummaryKind: asText(input.relaySourceTurnObserveSummaryKind),
        relaySourceSessionCloseLifecycleState: asText(input.relaySourceSessionCloseLifecycleState),
        relaySourceSessionClosePromptAfterCloseErrorCode: asText(input.relaySourceSessionClosePromptAfterCloseErrorCode),
        relaySourceSessionCloseResumeAfterRestartErrorCode: asText(input.relaySourceSessionCloseResumeAfterRestartErrorCode),
        relaySourceSessionClosePromptAfterRestartErrorCode: asText(input.relaySourceSessionClosePromptAfterRestartErrorCode),
        proofMatrixSchemaVersion: asText(proofMatrix?.schemaVersion),
        proofMatrixAllRequiredProofsMet: proofMatrix?.allRequiredProofsMet === true,
        proofMatrixFailedRequiredIds: Array.isArray(proofMatrix?.failedRequiredIds)
          ? proofMatrix.failedRequiredIds
          : [],
        proofMatrixUnsupportedIds: Array.isArray(proofMatrix?.unsupportedIds)
          ? proofMatrix.unsupportedIds
          : []
      }
    : null;
}

function summarizeCodexCliTarget(result = null) {
  const input = asObject(result, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        marker: asText(input.marker),
        codexCliPath: asText(input.codexCliPath),
        codexCliVersion: asText(input.codexCliVersion),
        codexCliSha256: asText(input.codexCliSha256),
        relaySessionId: asText(input.relaySessionId),
        relayTurnId: asText(input.relayTurnId),
        virtualAgentId: asText(input.virtualAgentId),
        targetId: asText(input.targetId),
        transportType: asText(input.transportType),
        codexCliTargetProcessVerified: input.codexCliTargetProcessVerified === true,
        sourceAcpProtocolVerified: input.sourceAcpProtocolVerified === true,
        sourceAcpTransport: asText(input.sourceAcpTransport),
        sourceAcpReady: asText(input.sourceAcpReady),
        sourceAcpMethods: asArray(input.sourceAcpMethods).map((item) => asText(item)),
        responseKind: asText(input.responseKind),
        summaryKind: asText(input.summaryKind),
        communicationSummary: summarizeCommunicationSummary(input.communicationSummary),
        sourceAcpResponseKindProjected: input.sourceAcpResponseKindProjected === true,
        sourceAcpFinalResponseProjected: input.sourceAcpFinalResponseProjected === true,
        sourceAcpOperationalMethodsVerified: input.sourceAcpOperationalMethodsVerified === true,
        sourceAcpSessionLoadAfterRestartVerified: input.sourceAcpSessionLoadAfterRestartVerified === true,
        operationalDiscoveryProof: {
          targetListed: input.operationalDiscoveryProof?.targetListed === true,
          sessionListed: input.operationalDiscoveryProof?.sessionListed === true,
          sessionGetMatchedTurn: input.operationalDiscoveryProof?.sessionGetMatchedTurn === true,
          turnListed: input.operationalDiscoveryProof?.turnListed === true,
          turnObserveReasonCode: asText(input.operationalDiscoveryProof?.turnObserveReasonCode),
          targetDescriptorCommandRedacted: input.operationalDiscoveryProof?.targetDescriptorCommandRedacted === true,
          targetCommunicationMode: asText(input.operationalDiscoveryProof?.targetCommunicationMode),
          nativeAcpTargetSupported: input.operationalDiscoveryProof?.nativeAcpTargetSupported === true,
          nativeAcpTargetVerifiedByDiscovery: input.operationalDiscoveryProof?.nativeAcpTargetVerifiedByDiscovery === true
        },
        restartSessionLoadProof: {
          sourceAcpReady: asText(input.restartSessionLoadProof?.sourceAcpReady),
          relaySessionId: asText(input.restartSessionLoadProof?.relaySessionId),
          targetResumeRef: asText(input.restartSessionLoadProof?.targetResumeRef),
          replayedUpdateCount: Number(input.restartSessionLoadProof?.replayedUpdateCount || 0),
          replayNotificationCount: Number(input.restartSessionLoadProof?.replayNotificationCount || 0),
          sessionListedAfterRestart: input.restartSessionLoadProof?.sessionListedAfterRestart === true,
          sessionGetMatchedTurnAfterRestart: input.restartSessionLoadProof?.sessionGetMatchedTurnAfterRestart === true,
          turnListedAfterRestart: input.restartSessionLoadProof?.turnListedAfterRestart === true,
          turnObserveReasonCodeAfterRestart: asText(input.restartSessionLoadProof?.turnObserveReasonCodeAfterRestart),
          pendingPermissionRequestCount: Number(input.restartSessionLoadProof?.pendingPermissionRequestCount || 0),
          requestReasoning: input.restartSessionLoadProof?.requestReasoning === true,
          reasoningTraceReplaySuppressed: input.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true
        },
        finalResponseAvailable: input.finalResponseAvailable === true,
        nativeCodexCliAcpSource: input.nativeCodexCliAcpSource === true,
        proof: asText(input.proof),
        targetCommunicationMode: asText(input.targetCommunicationMode, "codex_cli_exec_proxy"),
        nativeAcpTargetSupported: input.nativeAcpTargetSupported === true,
        nativeAcpTargetVerified: input.nativeAcpTargetVerified === true,
        externalResponseProjectedAsKeys: asArray(input.externalResponseProjectedAsKeys).map((item) => asText(item))
      }
    : null;
}

function summarizeCodexAcpTarget(result = null) {
  const input = asObject(result, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        marker: asText(input.marker),
        codexCliPath: asText(input.codexCliPath),
        codexCliVersion: asText(input.codexCliVersion),
        adapterExecutable: asText(input.adapterExecutable),
        adapterArgs: asArray(input.adapterArgs).map((item) => asText(item)),
        adapterInvocation: asText(input.adapterInvocation),
        adapterInstalled: input.adapterInstalled === true,
        adapterInstallPackage: asText(input.adapterInstallPackage),
        adapterPackageVersion: asText(input.adapterPackageVersion),
        relaySessionId: asText(input.relaySessionId),
        relayTurnId: asText(input.relayTurnId),
        virtualAgentId: asText(input.virtualAgentId),
        targetId: asText(input.targetId),
        transportType: asText(input.transportType),
        codexAcpTargetProcessVerified: input.codexAcpTargetProcessVerified === true,
        sourceAcpProtocolVerified: input.sourceAcpProtocolVerified === true,
        sourceAcpTransport: asText(input.sourceAcpTransport),
        sourceAcpReady: asText(input.sourceAcpReady),
        sourceAcpMethods: asArray(input.sourceAcpMethods).map((item) => asText(item)),
        responseKind: asText(input.responseKind),
        summaryKind: asText(input.summaryKind),
        communicationSummary: summarizeCommunicationSummary(input.communicationSummary),
        sourceAcpResponseKindProjected: input.sourceAcpResponseKindProjected === true,
        sourceAcpFinalResponseProjected: input.sourceAcpFinalResponseProjected === true,
        sourceAcpOperationalMethodsVerified: input.sourceAcpOperationalMethodsVerified === true,
        sourceAcpSessionLoadAfterRestartVerified: input.sourceAcpSessionLoadAfterRestartVerified === true,
        operationalDiscoveryProof: {
          targetListed: input.operationalDiscoveryProof?.targetListed === true,
          sessionListed: input.operationalDiscoveryProof?.sessionListed === true,
          sessionGetMatchedTurn: input.operationalDiscoveryProof?.sessionGetMatchedTurn === true,
          turnListed: input.operationalDiscoveryProof?.turnListed === true,
          turnObserveReasonCode: asText(input.operationalDiscoveryProof?.turnObserveReasonCode),
          targetDescriptorCommandRedacted: input.operationalDiscoveryProof?.targetDescriptorCommandRedacted === true,
          targetCommunicationMode: asText(input.operationalDiscoveryProof?.targetCommunicationMode),
          nativeAcpTargetSupported: input.operationalDiscoveryProof?.nativeAcpTargetSupported === true,
          nativeAcpTargetVerifiedByDiscovery: input.operationalDiscoveryProof?.nativeAcpTargetVerifiedByDiscovery === true
        },
        restartSessionLoadProof: {
          sourceAcpReady: asText(input.restartSessionLoadProof?.sourceAcpReady),
          relaySessionId: asText(input.restartSessionLoadProof?.relaySessionId),
          targetResumeRef: asText(input.restartSessionLoadProof?.targetResumeRef),
          replayedUpdateCount: Number(input.restartSessionLoadProof?.replayedUpdateCount || 0),
          replayNotificationCount: Number(input.restartSessionLoadProof?.replayNotificationCount || 0),
          sessionListedAfterRestart: input.restartSessionLoadProof?.sessionListedAfterRestart === true,
          pendingPermissionRequestCount: Number(input.restartSessionLoadProof?.pendingPermissionRequestCount || 0),
          requestReasoning: input.restartSessionLoadProof?.requestReasoning === true,
          reasoningTraceReplaySuppressed: input.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true
        },
        finalResponseAvailable: input.finalResponseAvailable === true,
        nativeCodexCliAcpSource: input.nativeCodexCliAcpSource === true,
        targetCommunicationMode: asText(input.targetCommunicationMode),
        nativeAcpTargetSupported: input.nativeAcpTargetSupported === true,
        nativeAcpTargetVerified: input.nativeAcpTargetVerified === true,
        proof: asText(input.proof)
      }
    : null;
}

function summarizeDownstreamCodexAcpTarget(result = null) {
  const input = asObject(result, null);
  const base = summarizeCodexAcpTarget(result);
  return base
    ? {
        ...base,
        restartSourceAcpReady: asText(input.restartSourceAcpReady),
        downstreamClientAspectStarted: input.downstreamClientAspectStarted === true,
        downstreamClientAspectAssemblyUsed: input.downstreamClientAspectAssemblyUsed === true,
        downstreamClientAspectProofAcceptable: input.downstreamClientAspectProofAcceptable === true,
        agentDiscoveryProof: {
          agentListed: input.agentDiscoveryProof?.agentListed === true,
          targetId: asText(input.agentDiscoveryProof?.targetId),
          fromAspect: asText(input.agentDiscoveryProof?.fromAspect),
          frameworkId: asText(input.agentDiscoveryProof?.frameworkId),
          adapterId: asText(input.agentDiscoveryProof?.adapterId),
          toolListed: input.agentDiscoveryProof?.toolListed === true
        },
        targetDiscoveryProof: {
          targetListed: input.targetDiscoveryProof?.targetListed === true,
          targetDescriptorCommandRedacted: input.targetDiscoveryProof?.targetDescriptorCommandRedacted === true,
          fromAspect: asText(input.targetDiscoveryProof?.fromAspect),
          frameworkId: asText(input.targetDiscoveryProof?.frameworkId),
          adapterId: asText(input.targetDiscoveryProof?.adapterId),
          transportType: asText(input.targetDiscoveryProof?.transportType),
          protocolStyle: asText(input.targetDiscoveryProof?.protocolStyle),
          targetCommunicationMode: asText(input.targetDiscoveryProof?.targetCommunicationMode),
          nativeAcpTargetSupported: input.targetDiscoveryProof?.nativeAcpTargetSupported === true,
          nativeAcpTargetVerifiedByDiscovery: input.targetDiscoveryProof?.nativeAcpTargetVerifiedByDiscovery === true
        }
      }
	    : null;
}

function summarizeAntigravityAcpWrapperTarget(result = null) {
  const input = asObject(result, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        marker: asText(input.marker),
        conversationId: asText(input.conversationId),
        endpointSource: asText(input.endpointSource),
        sourceAcpProtocolVerified: input.sourceAcpProtocolVerified === true,
        sourceAcpTransport: asText(input.sourceAcpTransport),
        sourceAcpReady: asText(input.sourceAcpReady),
        restartSourceAcpReady: asText(input.restartSourceAcpReady),
        downstreamClientAspectAssemblyUsed: input.downstreamClientAspectAssemblyUsed === true,
        outboundAcpWrapperProcessVerified: input.outboundAcpWrapperProcessVerified === true,
        adapterScriptPath: asText(input.adapterScriptPath),
        relaySessionId: asText(input.relaySessionId),
        relayTurnId: asText(input.relayTurnId),
        virtualAgentId: asText(input.virtualAgentId),
        targetId: asText(input.targetId),
        targetCommunicationMode: asText(input.targetCommunicationMode),
        sourceFacingTargetCommunicationMode: asText(input.sourceFacingTargetCommunicationMode),
        nativeAcpTargetSupported: input.nativeAcpTargetSupported === true,
        nativeAcpTargetVerified: input.nativeAcpTargetVerified === true,
        nativeAntigravityAcp: input.nativeAntigravityAcp === true,
        antigravityAgentApiReached: input.antigravityAgentApiReached === true,
        proofLevel: asText(input.proofLevel),
        minimumProofLevel: asText(input.minimumProofLevel),
        proofMeetsMinimum: input.proofMeetsMinimum === true,
        fileChanged: input.fileChanged === true,
        markerObserved: input.markerObserved === true,
        metadataProbe: asText(input.metadataProbe),
        responseKind: asText(input.responseKind),
        summaryKind: asText(input.summaryKind),
        targetDescriptorCommandRedacted: input.targetDescriptorCommandRedacted === true,
        agentDiscoveryProof: input.agentDiscoveryProof || null,
        targetDiscoveryProof: input.targetDiscoveryProof || null,
        restartSessionLoadProof: {
          sourceAcpReady: asText(input.restartSessionLoadProof?.sourceAcpReady),
          relaySessionId: asText(input.restartSessionLoadProof?.relaySessionId),
          replayedUpdateCount: Number(input.restartSessionLoadProof?.replayedUpdateCount || 0),
          replayNotificationCount: Number(input.restartSessionLoadProof?.replayNotificationCount || 0),
          requestReasoning: input.restartSessionLoadProof?.requestReasoning === true,
          reasoningTraceReplaySuppressed: input.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true
        },
        ideCliCapabilitySnapshot: asObject(input.ideCliCapabilitySnapshot, null),
        proof: asText(input.proof)
      }
    : null;
}

function summarizeTargetCallbackApproval(result = null) {
  const input = asObject(result, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        marker: asText(input.marker),
        sourceAcpProtocolVerified: input.sourceAcpProtocolVerified === true,
        sourceAcpTransport: asText(input.sourceAcpTransport),
        targetTransportType: asText(input.targetTransportType),
        targetCallbackApprovalProofAcceptable: input.targetCallbackApprovalProofAcceptable === true,
        sameTurn: input.sameTurn === true,
        usedSessionResume: input.usedSessionResume === true,
        storedRequestStatus: asText(input.storedRequestStatus),
        relaySessionId: asText(input.relaySessionId),
        relayTurnId: asText(input.relayTurnId),
        requestId: asText(input.requestId),
        targetToolCallId: asText(input.targetToolCallId),
        pendingProof: {
          stopReason: asText(input.pendingProof?.stopReason),
          responseKind: asText(input.pendingProof?.responseKind),
          summaryKind: asText(input.pendingProof?.summaryKind),
          pendingPermissionRequestCount: Number(input.pendingProof?.pendingPermissionRequestCount || 0),
          persistedAfterRestart: input.pendingProof?.persistedAfterRestart === true
        },
        pendingTurnObservationProof: {
          observed: input.pendingTurnObservationProof?.observed === true,
          reasonCode: asText(input.pendingTurnObservationProof?.reasonCode),
          relayTurnId: asText(input.pendingTurnObservationProof?.relayTurnId),
          responseKind: asText(input.pendingTurnObservationProof?.responseKind),
          summaryKind: asText(input.pendingTurnObservationProof?.summaryKind),
          requestId: asText(input.pendingTurnObservationProof?.requestId)
        },
        resolveProof: {
          stopReason: asText(input.resolveProof?.stopReason),
          responseKind: asText(input.resolveProof?.responseKind),
          summaryKind: asText(input.resolveProof?.summaryKind),
          sameTurn: input.resolveProof?.sameTurn === true,
          receiptCompleted: input.resolveProof?.receiptCompleted === true,
          fileWritten: input.resolveProof?.fileWritten === true
        },
        denialProof: {
          stopReason: asText(input.denialProof?.stopReason),
          responseKind: asText(input.denialProof?.responseKind),
          summaryKind: asText(input.denialProof?.summaryKind),
          sameTurn: input.denialProof?.sameTurn === true,
          pendingResponseKind: asText(input.denialProof?.pendingResponseKind),
          pendingSummaryKind: asText(input.denialProof?.pendingSummaryKind),
          pendingPersistedAfterRestart: input.denialProof?.pendingPersistedAfterRestart === true,
          sessionResumedAfterRestart: input.denialProof?.sessionResumedAfterRestart === true,
          permissionRequestStatus: asText(input.denialProof?.permissionRequestStatus),
          storedRequestStatus: asText(input.denialProof?.storedRequestStatus),
          receiptReasonCode: asText(input.denialProof?.receiptReasonCode),
          fileWritten: input.denialProof?.fileWritten === true,
          noContentLeak: input.denialProof?.noContentLeak === true,
          deniedFilePath: asText(input.denialProof?.deniedFilePath),
          callbackRequestObserved: input.denialProof?.callbackRequestObserved === true,
          denialNotificationObserved: input.denialProof?.denialNotificationObserved === true,
          completionNotificationObserved: input.denialProof?.completionNotificationObserved === true
        },
        restartProof: {
          sessionLoaded: input.restartProof?.sessionLoaded === true,
          pendingPermissionRequestCount: Number(input.restartProof?.pendingPermissionRequestCount || 0),
          turnRecovered: input.restartProof?.turnRecovered === true,
          responseKind: asText(input.restartProof?.responseKind),
          summaryKind: asText(input.restartProof?.summaryKind),
          storedRequestStatus: asText(input.restartProof?.storedRequestStatus)
        },
	        parentBindingProof: {
	          parentRequestIdsBound: input.parentBindingProof?.parentRequestIdsBound === true,
          ambiguousRejected: input.parentBindingProof?.ambiguousRejected === true,
          ambiguousErrorCode: Number(input.parentBindingProof?.ambiguousErrorCode || 0),
          ambiguousReasonCode: asText(input.parentBindingProof?.ambiguousReasonCode),
          notFoundRejected: input.parentBindingProof?.notFoundRejected === true,
          notFoundErrorCode: Number(input.parentBindingProof?.notFoundErrorCode || 0),
          notFoundReasonCode: asText(input.parentBindingProof?.notFoundReasonCode),
          staleParentRequestId: asText(input.parentBindingProof?.staleParentRequestId),
          rejectedFileWritten: input.parentBindingProof?.rejectedFileWritten === true,
          callbackHandlerInvoked: input.parentBindingProof?.callbackHandlerInvoked === true,
          noRelaySideEffect: input.parentBindingProof?.noRelaySideEffect === true,
          permissionRequestCountAfterRejectedCallbacks:
            Number(input.parentBindingProof?.permissionRequestCountAfterRejectedCallbacks || 0),
	          expectedPermissionRequestCount: Number(input.parentBindingProof?.expectedPermissionRequestCount || 0),
	          proof: asText(input.parentBindingProof?.proof)
	        },
	        sourceCancelProof: {
	          relaySessionId: asText(input.sourceCancelProof?.relaySessionId),
	          relayTurnId: asText(input.sourceCancelProof?.relayTurnId),
	          sourceAcpCancelMethod: asText(input.sourceCancelProof?.sourceAcpCancelMethod),
	          sourceCancelResponseOk: input.sourceCancelProof?.sourceCancelResponseOk === true,
	          sourceCancelLifecycleState: asText(input.sourceCancelProof?.sourceCancelLifecycleState),
	          targetCancelObserved: input.sourceCancelProof?.targetCancelObserved === true,
	          targetCancelTargetSessionId: asText(input.sourceCancelProof?.targetCancelTargetSessionId),
	          cancelledTurnsCount: Number(input.sourceCancelProof?.cancelledTurnsCount || 0),
	          cancelledTurnStopReason: asText(input.sourceCancelProof?.cancelledTurnStopReason),
	          cancelledTurnResponseKind: asText(input.sourceCancelProof?.cancelledTurnResponseKind),
	          promptStopReason: asText(input.sourceCancelProof?.promptStopReason),
	          promptResponseKind: asText(input.sourceCancelProof?.promptResponseKind),
	          promptSummaryKind: asText(input.sourceCancelProof?.promptSummaryKind),
	          promptReasoningIncluded: input.sourceCancelProof?.promptReasoningIncluded === true,
	          lateTargetCompletionSuppressed: input.sourceCancelProof?.lateTargetCompletionSuppressed === true,
	          pendingPermissionRequestCountAfterCancel:
	            Number(input.sourceCancelProof?.pendingPermissionRequestCountAfterCancel || 0),
	          storedTurnStatus: asText(input.sourceCancelProof?.storedTurnStatus),
	          storedTurnStopReason: asText(input.sourceCancelProof?.storedTurnStopReason),
	          permissionRequestCountAfterCancel: Number(input.sourceCancelProof?.permissionRequestCountAfterCancel || 0),
	          expectedPermissionRequestCountAfterCancel:
	            Number(input.sourceCancelProof?.expectedPermissionRequestCountAfterCancel || 0),
	          proof: asText(input.sourceCancelProof?.proof)
	        },
	        targetMethodProof: {
	          methods: asArray(input.targetMethodProof?.methods).map((item) => asText(item)),
	          usedSessionResume: input.targetMethodProof?.usedSessionResume === true,
	          usedSessionCancel: input.targetMethodProof?.usedSessionCancel === true,
	          promptCount: Number(input.targetMethodProof?.promptCount || 0),
	          parentRequestIdsBound: input.targetMethodProof?.parentRequestIdsBound === true,
	          callbackResponseCompleted: input.targetMethodProof?.callbackResponseCompleted === true,
	          callbackRequestCount: Number(input.targetMethodProof?.callbackRequestCount || 0),
	          targetCancelCount: Number(input.targetMethodProof?.targetCancelCount || 0),
	          denialCallbackRequested: input.targetMethodProof?.denialCallbackRequested === true
	        },
        proof: asText(input.proof)
      }
    : null;
}

function summarizeTargetReconnect(result = null) {
  const input = asObject(result, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        marker: asText(input.marker),
        relaySessionId: asText(input.relaySessionId),
        firstRelayTurnId: asText(input.firstRelayTurnId),
        secondRelayTurnId: asText(input.secondRelayTurnId),
        virtualAgentId: asText(input.virtualAgentId),
        targetId: asText(input.targetId),
        sourceAcpProtocolVerified: input.sourceAcpProtocolVerified === true,
        sourceAcpTransport: asText(input.sourceAcpTransport),
        sourceAcpReady: asText(input.sourceAcpReady),
        sourceAcpMethods: asArray(input.sourceAcpMethods).map((item) => asText(item)),
        targetTransportType: asText(input.targetTransportType),
        targetCommunicationMode: asText(input.targetCommunicationMode),
        nativeAcpTargetSupported: input.nativeAcpTargetSupported === true,
        nativeAcpTargetVerified: input.nativeAcpTargetVerified === true,
        targetReconnectProofAcceptable: input.targetReconnectProofAcceptable === true,
        firstPromptProof: {
          responseKind: asText(input.firstPromptProof?.responseKind),
          summaryKind: asText(input.firstPromptProof?.summaryKind),
          targetSessionId: asText(input.firstPromptProof?.targetSessionId),
          targetResumeRef: asText(input.firstPromptProof?.targetResumeRef),
          finalResponseAvailable: input.firstPromptProof?.finalResponseAvailable === true,
          reasoningIncluded: input.firstPromptProof?.reasoningIncluded === true
        },
        reconnectProof: {
          targetProcessRestartObserved: input.reconnectProof?.targetProcessRestartObserved === true,
          firstTargetProcessPid: Number(input.reconnectProof?.firstTargetProcessPid || 0),
          secondTargetProcessPid: Number(input.reconnectProof?.secondTargetProcessPid || 0),
          distinctTargetProcesses: input.reconnectProof?.distinctTargetProcesses === true,
          firstTargetExitObserved: input.reconnectProof?.firstTargetExitObserved === true,
          targetResumeRefPersistedBeforeReconnect:
            input.reconnectProof?.targetResumeRefPersistedBeforeReconnect === true,
          targetSessionResumeUsed: input.reconnectProof?.targetSessionResumeUsed === true,
          resumeTargetResumeRefMatchedFirst: input.reconnectProof?.resumeTargetResumeRefMatchedFirst === true,
          secondPromptDeliveredAfterResume: input.reconnectProof?.secondPromptDeliveredAfterResume === true,
          sourceRelaySessionStable: input.reconnectProof?.sourceRelaySessionStable === true,
          distinctRelayTurns: input.reconnectProof?.distinctRelayTurns === true,
          firstTargetSessionId: asText(input.reconnectProof?.firstTargetSessionId),
          secondTargetSessionId: asText(input.reconnectProof?.secondTargetSessionId),
          targetSessionChangedAfterReconnect: input.reconnectProof?.targetSessionChangedAfterReconnect === true,
          firstTargetResumeRef: asText(input.reconnectProof?.firstTargetResumeRef),
          secondTargetResumeRef: asText(input.reconnectProof?.secondTargetResumeRef),
          targetResumeRefRefreshedAfterReconnect:
            input.reconnectProof?.targetResumeRefRefreshedAfterReconnect === true,
          responseKind: asText(input.reconnectProof?.responseKind),
          summaryKind: asText(input.reconnectProof?.summaryKind),
          finalResponseAvailable: input.reconnectProof?.finalResponseAvailable === true,
          reasoningIncluded: input.reconnectProof?.reasoningIncluded === true,
          sessionLoadAfterReconnectVerified: input.reconnectProof?.sessionLoadAfterReconnectVerified === true,
          sessionGetAfterReconnectVerified: input.reconnectProof?.sessionGetAfterReconnectVerified === true,
          reasoningTraceReplaySuppressed: input.reconnectProof?.reasoningTraceReplaySuppressed === true
        },
        targetMethodProof: {
          methods: asArray(input.targetMethodProof?.methods).map((item) => asText(item)),
          initializeCount: Number(input.targetMethodProof?.initializeCount || 0),
          targetProcessStartCount: Number(input.targetMethodProof?.targetProcessStartCount || 0),
          targetProcessPids: asArray(input.targetMethodProof?.targetProcessPids).map((item) => Number(item || 0)),
          sessionNewCount: Number(input.targetMethodProof?.sessionNewCount || 0),
          sessionResumeCount: Number(input.targetMethodProof?.sessionResumeCount || 0),
          promptCount: Number(input.targetMethodProof?.promptCount || 0),
          usedSessionNew: input.targetMethodProof?.usedSessionNew === true,
          usedSessionResumeAfterTargetRestart: input.targetMethodProof?.usedSessionResumeAfterTargetRestart === true,
          targetPromptCountAfterReconnect: Number(input.targetMethodProof?.targetPromptCountAfterReconnect || 0)
        },
        proof: asText(input.proof)
      }
    : null;
}

function summarizeTargetLoadReconnect(result = null) {
  const input = asObject(result, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        marker: asText(input.marker),
        relaySessionId: asText(input.relaySessionId),
        firstRelayTurnId: asText(input.firstRelayTurnId),
        secondRelayTurnId: asText(input.secondRelayTurnId),
        virtualAgentId: asText(input.virtualAgentId),
        targetId: asText(input.targetId),
        sourceAcpProtocolVerified: input.sourceAcpProtocolVerified === true,
        sourceAcpTransport: asText(input.sourceAcpTransport),
        sourceAcpReady: asText(input.sourceAcpReady),
        sourceAcpMethods: asArray(input.sourceAcpMethods).map((item) => asText(item)),
        targetTransportType: asText(input.targetTransportType),
        targetCommunicationMode: asText(input.targetCommunicationMode),
        nativeAcpTargetSupported: input.nativeAcpTargetSupported === true,
        nativeAcpTargetVerified: input.nativeAcpTargetVerified === true,
        targetLoadReconnectProofAcceptable: input.targetLoadReconnectProofAcceptable === true,
        firstPromptProof: {
          responseKind: asText(input.firstPromptProof?.responseKind),
          summaryKind: asText(input.firstPromptProof?.summaryKind),
          targetSessionId: asText(input.firstPromptProof?.targetSessionId),
          targetResumeRef: asText(input.firstPromptProof?.targetResumeRef),
          finalResponseAvailable: input.firstPromptProof?.finalResponseAvailable === true,
          reasoningIncluded: input.firstPromptProof?.reasoningIncluded === true
        },
        loadReconnectProof: {
          targetProcessRestartObserved: input.loadReconnectProof?.targetProcessRestartObserved === true,
          firstTargetProcessPid: Number(input.loadReconnectProof?.firstTargetProcessPid || 0),
          secondTargetProcessPid: Number(input.loadReconnectProof?.secondTargetProcessPid || 0),
          distinctTargetProcesses: input.loadReconnectProof?.distinctTargetProcesses === true,
          firstTargetExitObserved: input.loadReconnectProof?.firstTargetExitObserved === true,
          targetResumeRefPersistedBeforeReconnect:
            input.loadReconnectProof?.targetResumeRefPersistedBeforeReconnect === true,
          targetSessionLoadUsed: input.loadReconnectProof?.targetSessionLoadUsed === true,
          targetSessionResumeNotUsed: input.loadReconnectProof?.targetSessionResumeNotUsed === true,
          loadTargetResumeRefMatchedFirst: input.loadReconnectProof?.loadTargetResumeRefMatchedFirst === true,
          secondPromptDeliveredAfterLoad: input.loadReconnectProof?.secondPromptDeliveredAfterLoad === true,
          sourceRelaySessionStable: input.loadReconnectProof?.sourceRelaySessionStable === true,
          distinctRelayTurns: input.loadReconnectProof?.distinctRelayTurns === true,
          firstTargetSessionId: asText(input.loadReconnectProof?.firstTargetSessionId),
          secondTargetSessionId: asText(input.loadReconnectProof?.secondTargetSessionId),
          targetSessionChangedAfterReconnect: input.loadReconnectProof?.targetSessionChangedAfterReconnect === true,
          firstTargetResumeRef: asText(input.loadReconnectProof?.firstTargetResumeRef),
          secondTargetResumeRef: asText(input.loadReconnectProof?.secondTargetResumeRef),
          targetResumeRefRefreshedAfterReconnect:
            input.loadReconnectProof?.targetResumeRefRefreshedAfterReconnect === true,
          responseKind: asText(input.loadReconnectProof?.responseKind),
          summaryKind: asText(input.loadReconnectProof?.summaryKind),
          finalResponseAvailable: input.loadReconnectProof?.finalResponseAvailable === true,
          reasoningIncluded: input.loadReconnectProof?.reasoningIncluded === true,
          sessionLoadAfterReconnectVerified: input.loadReconnectProof?.sessionLoadAfterReconnectVerified === true,
          sessionGetAfterReconnectVerified: input.loadReconnectProof?.sessionGetAfterReconnectVerified === true,
          reasoningTraceReplaySuppressed: input.loadReconnectProof?.reasoningTraceReplaySuppressed === true
        },
        targetMethodProof: {
          methods: asArray(input.targetMethodProof?.methods).map((item) => asText(item)),
          initializeCount: Number(input.targetMethodProof?.initializeCount || 0),
          targetProcessStartCount: Number(input.targetMethodProof?.targetProcessStartCount || 0),
          targetProcessPids: asArray(input.targetMethodProof?.targetProcessPids).map((item) => Number(item || 0)),
          sessionNewCount: Number(input.targetMethodProof?.sessionNewCount || 0),
          sessionLoadCount: Number(input.targetMethodProof?.sessionLoadCount || 0),
          sessionResumeCount: Number(input.targetMethodProof?.sessionResumeCount || 0),
          promptCount: Number(input.targetMethodProof?.promptCount || 0),
          usedSessionNew: input.targetMethodProof?.usedSessionNew === true,
          usedSessionLoadAfterTargetRestart: input.targetMethodProof?.usedSessionLoadAfterTargetRestart === true,
          usedSessionResumeAfterTargetRestart: input.targetMethodProof?.usedSessionResumeAfterTargetRestart === true,
          targetPromptCountAfterReconnect: Number(input.targetMethodProof?.targetPromptCountAfterReconnect || 0)
        },
        proof: asText(input.proof)
      }
    : null;
}

function summarizeIdempotency(result = null) {
  const input = asObject(result, null);
  return input
    ? {
        ok: input.ok === true,
        verifier: asText(input.verifier),
        marker: asText(input.marker),
        sourceAcpProtocolVerified: input.sourceAcpProtocolVerified === true,
        sourceAcpTransport: asText(input.sourceAcpTransport),
        targetTransportType: asText(input.targetTransportType),
        relaySessionId: asText(input.relaySessionId),
        relayTurnId: asText(input.relayTurnId),
        idempotencyKey: asText(input.idempotencyKey),
        idempotencyProofAcceptable: input.idempotencyProofAcceptable === true,
        firstProof: {
          stopReason: asText(input.firstProof?.stopReason),
          responseKind: asText(input.firstProof?.responseKind),
          summaryKind: asText(input.firstProof?.summaryKind),
          idempotencyReplay: input.firstProof?.idempotencyReplay === true,
          targetPromptCount: Number(input.firstProof?.targetPromptCount || 0),
          turnCount: Number(input.firstProof?.turnCount || 0),
          reasoningIncluded: input.firstProof?.reasoningIncluded === true
        },
        replayProof: {
          idempotencyReplay: input.replayProof?.idempotencyReplay === true,
          sameTurn: input.replayProof?.sameTurn === true,
          responseKind: asText(input.replayProof?.responseKind),
          summaryKind: asText(input.replayProof?.summaryKind),
          targetPromptCountAfterReplay: Number(input.replayProof?.targetPromptCountAfterReplay || 0),
          turnCountAfterReplay: Number(input.replayProof?.turnCountAfterReplay || 0),
          newEventsCount: Number(input.replayProof?.newEventsCount || 0),
          usedSourceRestart: input.replayProof?.usedSourceRestart === true
        },
        conflictProof: {
          conflictRejected: input.conflictProof?.conflictRejected === true,
          errorCode: asText(input.conflictProof?.errorCode),
          targetPromptCountAfterConflict: Number(input.conflictProof?.targetPromptCountAfterConflict || 0),
          turnCountAfterConflict: Number(input.conflictProof?.turnCountAfterConflict || 0)
        },
        targetMethodProof: {
          promptCount: Number(input.targetMethodProof?.promptCount || 0),
          methods: asArray(input.targetMethodProof?.methods).map((item) => asText(item)),
          targetNotReawakenedForReplay: input.targetMethodProof?.targetNotReawakenedForReplay === true,
          targetNotReawakenedForConflict: input.targetMethodProof?.targetNotReawakenedForConflict === true
        },
        proof: asText(input.proof)
      }
    : null;
}

function buildCodexCliRequirement({
  codexCliRequired = false,
  codexCliProofAcceptable = false,
  codexCli = null,
  connectRequired = false
} = {}) {
  const required = Boolean(codexCliRequired);
  return {
    id: "codex_cli_participation",
    label: "A real Codex CLI process participated in invoking the relay verification job.",
    required,
    status: required
      ? codexCliProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      codexCliPath: asText(codexCli?.codexCliPath),
      codexCliVersion: asText(codexCli?.codexCliVersion),
      codexCliSha256: asText(codexCli?.codexCliSha256),
      codexCliProcessVerified: codexCli?.codexCliProcessVerified === true,
      codexCliRanRelayJob: codexCli?.codexCliRanRelayJob === true,
      markerObservedInRelayOutput: codexCli?.markerObservedInRelayOutput === true,
      antigravityProofAcceptable: codexCli?.antigravityProofAcceptable === true,
      connectRequired: Boolean(connectRequired),
      connectProofAcceptable: codexCli?.connectProofAcceptable === true,
      proofMatrixAllRequiredProofsMet: codexCli?.proofMatrixAllRequiredProofsMet === true,
      proofMatrixFailedRequiredIds: asArray(codexCli?.proofMatrixFailedRequiredIds),
      proofMatrixUnsupportedIds: asArray(codexCli?.proofMatrixUnsupportedIds),
      relaySourceMode: asText(codexCli?.relaySourceMode),
      relaySourceAgentKind: asText(codexCli?.relaySourceAgentKind),
      relayDirectCodexCliAcpSourceVerified: codexCli?.relayDirectCodexCliAcpSourceVerified === true,
      relayResponseKind: asText(codexCli?.relayResponseKind),
      relaySummaryKind: asText(codexCli?.relaySummaryKind),
      relayFirstResponseKind: asText(codexCli?.relayFirstResponseKind),
      relayFirstSummaryKind: asText(codexCli?.relayFirstSummaryKind),
      relaySecondResponseKind: asText(codexCli?.relaySecondResponseKind),
      relaySecondSummaryKind: asText(codexCli?.relaySecondSummaryKind),
      relaySourceTurnObserveResponseKind: asText(codexCli?.relaySourceTurnObserveResponseKind),
      relaySourceTurnObserveSummaryKind: asText(codexCli?.relaySourceTurnObserveSummaryKind),
      relaySourceSessionCloseLifecycleState: asText(codexCli?.relaySourceSessionCloseLifecycleState),
      relaySourceSessionClosePromptAfterCloseErrorCode: asText(codexCli?.relaySourceSessionClosePromptAfterCloseErrorCode),
      relaySourceSessionCloseResumeAfterRestartErrorCode: asText(codexCli?.relaySourceSessionCloseResumeAfterRestartErrorCode),
      relaySourceSessionClosePromptAfterRestartErrorCode: asText(codexCli?.relaySourceSessionClosePromptAfterRestartErrorCode)
    },
    caveat: required
      ? ""
      : "Codex CLI participation was not requested by this top-level real gate run."
  };
}

function buildCodexCliTargetRequirement({
  codexCliTargetRequired = false,
  codexCliTargetProofAcceptable = false,
  codexCliTarget = null
} = {}) {
  const required = Boolean(codexCliTargetRequired);
  return {
    id: "codex_cli_target_communication",
    label: "Pact routed a delegated relay turn to a real Codex CLI target agent.",
    required,
    status: required
      ? codexCliTargetProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      codexCliPath: asText(codexCliTarget?.codexCliPath),
      codexCliVersion: asText(codexCliTarget?.codexCliVersion),
      codexCliSha256: asText(codexCliTarget?.codexCliSha256),
      relaySessionId: asText(codexCliTarget?.relaySessionId),
      relayTurnId: asText(codexCliTarget?.relayTurnId),
      virtualAgentId: asText(codexCliTarget?.virtualAgentId),
      targetId: asText(codexCliTarget?.targetId),
      transportType: asText(codexCliTarget?.transportType),
      codexCliTargetProcessVerified: codexCliTarget?.codexCliTargetProcessVerified === true,
      sourceAcpProtocolVerified: codexCliTarget?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(codexCliTarget?.sourceAcpTransport),
      sourceAcpMethods: asArray(codexCliTarget?.sourceAcpMethods),
      responseKind: asText(codexCliTarget?.responseKind),
      summaryKind: asText(codexCliTarget?.summaryKind),
      sourceAcpResponseKindProjected: codexCliTarget?.sourceAcpResponseKindProjected === true,
      sourceAcpFinalResponseProjected: codexCliTarget?.sourceAcpFinalResponseProjected === true,
      sourceAcpOperationalMethodsVerified: codexCliTarget?.sourceAcpOperationalMethodsVerified === true,
      sourceAcpSessionLoadAfterRestartVerified: codexCliTarget?.sourceAcpSessionLoadAfterRestartVerified === true,
      operationalDiscoveryProof: codexCliTarget?.operationalDiscoveryProof || null,
      restartSessionLoadProof: codexCliTarget?.restartSessionLoadProof || null,
      finalResponseAvailable: codexCliTarget?.finalResponseAvailable === true,
      targetCommunicationMode: asText(codexCliTarget?.targetCommunicationMode),
      nativeAcpTargetSupported: codexCliTarget?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: codexCliTarget?.nativeAcpTargetVerified === true,
      externalResponseProjectedAsKeys: asArray(codexCliTarget?.externalResponseProjectedAsKeys),
      nativeCodexCliAcpSource: codexCliTarget?.nativeCodexCliAcpSource === true,
      proof: asText(codexCliTarget?.proof)
    },
    caveat: required
      ? ""
      : "Codex CLI target communication was not requested by this top-level real gate run."
  };
}

function buildCodexAcpTargetRequirement({
  codexAcpTargetRequired = false,
  codexAcpTargetProofAcceptable = false,
  codexAcpTarget = null
} = {}) {
  const required = Boolean(codexAcpTargetRequired);
  return {
    id: "codex_acp_target_communication",
    label: "Pact routed a delegated relay turn to the real Codex ACP stdio adapter target.",
    required,
    status: required
      ? codexAcpTargetProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      codexCliPath: asText(codexAcpTarget?.codexCliPath),
      codexCliVersion: asText(codexAcpTarget?.codexCliVersion),
      adapterExecutable: asText(codexAcpTarget?.adapterExecutable),
      adapterArgs: asArray(codexAcpTarget?.adapterArgs),
      adapterInvocation: asText(codexAcpTarget?.adapterInvocation),
      adapterInstalled: codexAcpTarget?.adapterInstalled === true,
      adapterInstallPackage: asText(codexAcpTarget?.adapterInstallPackage),
      adapterPackageVersion: asText(codexAcpTarget?.adapterPackageVersion),
      relaySessionId: asText(codexAcpTarget?.relaySessionId),
      relayTurnId: asText(codexAcpTarget?.relayTurnId),
      virtualAgentId: asText(codexAcpTarget?.virtualAgentId),
      targetId: asText(codexAcpTarget?.targetId),
      transportType: asText(codexAcpTarget?.transportType),
      codexAcpTargetProcessVerified: codexAcpTarget?.codexAcpTargetProcessVerified === true,
      sourceAcpProtocolVerified: codexAcpTarget?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(codexAcpTarget?.sourceAcpTransport),
      sourceAcpMethods: asArray(codexAcpTarget?.sourceAcpMethods),
      responseKind: asText(codexAcpTarget?.responseKind),
      summaryKind: asText(codexAcpTarget?.summaryKind),
      sourceAcpResponseKindProjected: codexAcpTarget?.sourceAcpResponseKindProjected === true,
      sourceAcpFinalResponseProjected: codexAcpTarget?.sourceAcpFinalResponseProjected === true,
      sourceAcpOperationalMethodsVerified: codexAcpTarget?.sourceAcpOperationalMethodsVerified === true,
      sourceAcpSessionLoadAfterRestartVerified: codexAcpTarget?.sourceAcpSessionLoadAfterRestartVerified === true,
      operationalDiscoveryProof: {
        targetListed: codexAcpTarget?.operationalDiscoveryProof?.targetListed === true,
        sessionListed: codexAcpTarget?.operationalDiscoveryProof?.sessionListed === true,
        sessionGetMatchedTurn: codexAcpTarget?.operationalDiscoveryProof?.sessionGetMatchedTurn === true,
        turnListed: codexAcpTarget?.operationalDiscoveryProof?.turnListed === true,
        turnObserveReasonCode: asText(codexAcpTarget?.operationalDiscoveryProof?.turnObserveReasonCode),
        targetDescriptorCommandRedacted: codexAcpTarget?.operationalDiscoveryProof?.targetDescriptorCommandRedacted === true,
        targetCommunicationMode: asText(codexAcpTarget?.operationalDiscoveryProof?.targetCommunicationMode),
        nativeAcpTargetSupported: codexAcpTarget?.operationalDiscoveryProof?.nativeAcpTargetSupported === true,
        nativeAcpTargetVerifiedByDiscovery: codexAcpTarget?.operationalDiscoveryProof?.nativeAcpTargetVerifiedByDiscovery === true
      },
      restartSessionLoadProof: {
        sourceAcpReady: asText(codexAcpTarget?.restartSessionLoadProof?.sourceAcpReady),
        relaySessionId: asText(codexAcpTarget?.restartSessionLoadProof?.relaySessionId),
        targetResumeRef: asText(codexAcpTarget?.restartSessionLoadProof?.targetResumeRef),
        replayedUpdateCount: Number(codexAcpTarget?.restartSessionLoadProof?.replayedUpdateCount || 0),
        replayNotificationCount: Number(codexAcpTarget?.restartSessionLoadProof?.replayNotificationCount || 0),
        sessionListedAfterRestart: codexAcpTarget?.restartSessionLoadProof?.sessionListedAfterRestart === true,
        pendingPermissionRequestCount: Number(codexAcpTarget?.restartSessionLoadProof?.pendingPermissionRequestCount || 0),
        requestReasoning: codexAcpTarget?.restartSessionLoadProof?.requestReasoning === true,
        reasoningTraceReplaySuppressed: codexAcpTarget?.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true
      },
      finalResponseAvailable: codexAcpTarget?.finalResponseAvailable === true,
      targetCommunicationMode: asText(codexAcpTarget?.targetCommunicationMode),
      nativeAcpTargetSupported: codexAcpTarget?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: codexAcpTarget?.nativeAcpTargetVerified === true,
      nativeCodexCliAcpSource: codexAcpTarget?.nativeCodexCliAcpSource === true,
      proof: asText(codexAcpTarget?.proof)
    },
    caveat: required
      ? ""
      : "Codex ACP stdio target communication was not requested by this top-level real gate run."
  };
}

function buildDownstreamCodexAcpTargetRequirement({
  downstreamCodexAcpTargetRequired = false,
  downstreamCodexAcpTargetProofAcceptable = false,
  downstreamCodexAcpTarget = null
} = {}) {
  const required = Boolean(downstreamCodexAcpTargetRequired);
  return {
    id: "downstream_client_aspect_codex_acp_target_communication",
    label: "Pact downstream-client-aspect assembled a Codex ACP target that source ACP could discover, invoke, and restore.",
    required,
    status: required
      ? downstreamCodexAcpTargetProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      codexCliPath: asText(downstreamCodexAcpTarget?.codexCliPath),
      codexCliVersion: asText(downstreamCodexAcpTarget?.codexCliVersion),
      adapterExecutable: asText(downstreamCodexAcpTarget?.adapterExecutable),
      adapterInvocation: asText(downstreamCodexAcpTarget?.adapterInvocation),
      adapterPackageVersion: asText(downstreamCodexAcpTarget?.adapterPackageVersion),
      relaySessionId: asText(downstreamCodexAcpTarget?.relaySessionId),
      relayTurnId: asText(downstreamCodexAcpTarget?.relayTurnId),
      virtualAgentId: asText(downstreamCodexAcpTarget?.virtualAgentId),
      targetId: asText(downstreamCodexAcpTarget?.targetId),
      downstreamClientAspectStarted: downstreamCodexAcpTarget?.downstreamClientAspectStarted === true,
      downstreamClientAspectAssemblyUsed: downstreamCodexAcpTarget?.downstreamClientAspectAssemblyUsed === true,
      agentDiscoveryProof: downstreamCodexAcpTarget?.agentDiscoveryProof || null,
      targetDiscoveryProof: downstreamCodexAcpTarget?.targetDiscoveryProof || null,
      sourceAcpProtocolVerified: downstreamCodexAcpTarget?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(downstreamCodexAcpTarget?.sourceAcpTransport),
      responseKind: asText(downstreamCodexAcpTarget?.responseKind),
      summaryKind: asText(downstreamCodexAcpTarget?.summaryKind),
      sourceAcpResponseKindProjected: downstreamCodexAcpTarget?.sourceAcpResponseKindProjected === true,
      sourceAcpFinalResponseProjected: downstreamCodexAcpTarget?.sourceAcpFinalResponseProjected === true,
      restartSessionLoadProof: downstreamCodexAcpTarget?.restartSessionLoadProof || null,
      finalResponseAvailable: downstreamCodexAcpTarget?.finalResponseAvailable === true,
      targetCommunicationMode: asText(downstreamCodexAcpTarget?.targetCommunicationMode),
      nativeAcpTargetSupported: downstreamCodexAcpTarget?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: downstreamCodexAcpTarget?.nativeAcpTargetVerified === true,
      proof: asText(downstreamCodexAcpTarget?.proof)
    },
    caveat: required
      ? ""
      : "Downstream client aspect Codex ACP target communication was not requested by this top-level real gate run."
	  };
}

function buildAntigravityAcpWrapperTargetRequirement({
  antigravityAcpWrapperTargetRequired = false,
  antigravityAcpWrapperTargetProofAcceptable = false,
  antigravityAcpWrapperTarget = null
} = {}) {
  const required = Boolean(antigravityAcpWrapperTargetRequired);
  return {
    id: "antigravity_agentapi_acp_wrapper_target_communication",
    label: "Pact routed source ACP through an outbound ACP stdio wrapper that reached Antigravity Agent API.",
    required,
    status: required
      ? antigravityAcpWrapperTargetProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      relaySessionId: asText(antigravityAcpWrapperTarget?.relaySessionId),
      relayTurnId: asText(antigravityAcpWrapperTarget?.relayTurnId),
      virtualAgentId: asText(antigravityAcpWrapperTarget?.virtualAgentId),
      targetId: asText(antigravityAcpWrapperTarget?.targetId),
      conversationId: asText(antigravityAcpWrapperTarget?.conversationId),
      endpointSource: asText(antigravityAcpWrapperTarget?.endpointSource),
      sourceAcpProtocolVerified: antigravityAcpWrapperTarget?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(antigravityAcpWrapperTarget?.sourceAcpTransport),
      downstreamClientAspectAssemblyUsed:
        antigravityAcpWrapperTarget?.downstreamClientAspectAssemblyUsed === true,
      outboundAcpWrapperProcessVerified:
        antigravityAcpWrapperTarget?.outboundAcpWrapperProcessVerified === true,
      targetCommunicationMode: asText(antigravityAcpWrapperTarget?.targetCommunicationMode),
      sourceFacingTargetCommunicationMode: asText(
        antigravityAcpWrapperTarget?.sourceFacingTargetCommunicationMode
      ),
      nativeAcpTargetSupported: antigravityAcpWrapperTarget?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: antigravityAcpWrapperTarget?.nativeAcpTargetVerified === true,
      nativeAntigravityAcp: antigravityAcpWrapperTarget?.nativeAntigravityAcp === true,
      antigravityAgentApiReached: antigravityAcpWrapperTarget?.antigravityAgentApiReached === true,
      proofLevel: asText(antigravityAcpWrapperTarget?.proofLevel),
      minimumProofLevel: asText(antigravityAcpWrapperTarget?.minimumProofLevel),
      proofMeetsMinimum: antigravityAcpWrapperTarget?.proofMeetsMinimum === true,
      fileChanged: antigravityAcpWrapperTarget?.fileChanged === true,
      markerObserved: antigravityAcpWrapperTarget?.markerObserved === true,
      metadataProbe: asText(antigravityAcpWrapperTarget?.metadataProbe),
      responseKind: asText(antigravityAcpWrapperTarget?.responseKind),
      summaryKind: asText(antigravityAcpWrapperTarget?.summaryKind),
      targetDescriptorCommandRedacted:
        antigravityAcpWrapperTarget?.targetDescriptorCommandRedacted === true,
      agentDiscoveryProof: antigravityAcpWrapperTarget?.agentDiscoveryProof || null,
      targetDiscoveryProof: antigravityAcpWrapperTarget?.targetDiscoveryProof || null,
      restartSessionLoadProof: antigravityAcpWrapperTarget?.restartSessionLoadProof || null,
      proof: asText(antigravityAcpWrapperTarget?.proof)
    },
    caveat: required
      ? "This proves Pact-to-wrapper ACP stdio plus wrapper-to-Antigravity Agent API, not native Antigravity ACP."
      : "Antigravity ACP wrapper target communication was not requested by this top-level real gate run."
	  };
}

function buildAntigravityCrossRunBindingRequirement({
  antigravity = null,
  codexAntigravity = null,
  antigravityAcpWrapperTarget = null,
  antigravityAcpWrapperTargetRequired = false
} = {}) {
  const conversationIds = [
    asText(antigravity?.conversationId),
    asText(codexAntigravity?.conversationId),
    ...(antigravityAcpWrapperTargetRequired || antigravityAcpWrapperTarget
      ? [asText(antigravityAcpWrapperTarget?.conversationId)]
      : [])
  ].filter(Boolean);
  const endpointSources = [
    asText(antigravity?.endpointSource),
    asText(codexAntigravity?.endpointSource),
    ...(antigravityAcpWrapperTargetRequired || antigravityAcpWrapperTarget
      ? [asText(antigravityAcpWrapperTarget?.endpointSource)]
      : [])
  ].filter(Boolean);
  const requiredBindingCount = antigravityAcpWrapperTargetRequired || antigravityAcpWrapperTarget ? 3 : 2;
  const sameConversationId = conversationIds.length === requiredBindingCount && new Set(conversationIds).size === 1;
  const sameEndpointSource = endpointSources.length === requiredBindingCount && new Set(endpointSources).size === 1;
  return {
    id: "antigravity_cross_run_binding",
    label: "All real Antigravity communication proofs bind to the same live conversation and endpoint.",
    required: true,
    status: sameConversationId && sameEndpointSource ? "proven" : "failed",
    evidence: {
      antigravityConversationId: asText(antigravity?.conversationId),
      codexAntigravityConversationId: asText(codexAntigravity?.conversationId),
      wrapperConversationId: asText(antigravityAcpWrapperTarget?.conversationId),
      sameConversationId,
      antigravityEndpointSource: asText(antigravity?.endpointSource),
      codexAntigravityEndpointSource: asText(codexAntigravity?.endpointSource),
      wrapperEndpointSource: asText(antigravityAcpWrapperTarget?.endpointSource),
      sameEndpointSource,
      antigravityMarker: asText(antigravity?.marker),
      codexAntigravityMarker: asText(codexAntigravity?.marker),
      wrapperMarker: asText(antigravityAcpWrapperTarget?.marker)
    },
    caveat: antigravityAcpWrapperTargetRequired || antigravityAcpWrapperTarget
      ? "Markers are intentionally distinct per proof run; the invariant binds the live Antigravity conversation and endpoint across the requested wrapper proof."
      : "Markers are intentionally distinct per proof run; optional Antigravity ACP wrapper binding is skipped unless explicitly requested."
  };
}

function buildTargetCallbackApprovalRequirement({
  targetCallbackApprovalRequired = false,
  targetCallbackApprovalProofAcceptable = false,
  targetCallbackApproval = null
} = {}) {
  const required = Boolean(targetCallbackApprovalRequired);
  return {
    id: "target_callback_approval_resume",
    label: "Pact suspends, persists, observes, and resumes a target-originated ACP write callback approval on the same relay turn.",
    required,
    status: required
      ? targetCallbackApprovalProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      sourceAcpProtocolVerified: targetCallbackApproval?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(targetCallbackApproval?.sourceAcpTransport),
      targetTransportType: asText(targetCallbackApproval?.targetTransportType),
      targetCallbackApprovalProofAcceptable: targetCallbackApproval?.targetCallbackApprovalProofAcceptable === true,
      sameTurn: targetCallbackApproval?.sameTurn === true,
      usedSessionResume: targetCallbackApproval?.usedSessionResume === true,
      storedRequestStatus: asText(targetCallbackApproval?.storedRequestStatus),
      relaySessionId: asText(targetCallbackApproval?.relaySessionId),
      relayTurnId: asText(targetCallbackApproval?.relayTurnId),
      requestId: asText(targetCallbackApproval?.requestId),
      targetToolCallId: asText(targetCallbackApproval?.targetToolCallId),
      pendingResponseKind: asText(targetCallbackApproval?.pendingProof?.responseKind),
      pendingSummaryKind: asText(targetCallbackApproval?.pendingProof?.summaryKind),
      pendingPersistedAfterRestart: targetCallbackApproval?.pendingProof?.persistedAfterRestart === true,
      pendingObserveReasonCode: asText(targetCallbackApproval?.pendingTurnObservationProof?.reasonCode),
      pendingObserveResponseKind: asText(targetCallbackApproval?.pendingTurnObservationProof?.responseKind),
      resolveResponseKind: asText(targetCallbackApproval?.resolveProof?.responseKind),
      resolveSummaryKind: asText(targetCallbackApproval?.resolveProof?.summaryKind),
      fileWritten: targetCallbackApproval?.resolveProof?.fileWritten === true,
      denialResponseKind: asText(targetCallbackApproval?.denialProof?.responseKind),
      denialSummaryKind: asText(targetCallbackApproval?.denialProof?.summaryKind),
      denialSameTurn: targetCallbackApproval?.denialProof?.sameTurn === true,
      denialPendingResponseKind: asText(targetCallbackApproval?.denialProof?.pendingResponseKind),
      denialPendingPersistedAfterRestart: targetCallbackApproval?.denialProof?.pendingPersistedAfterRestart === true,
      denialSessionResumedAfterRestart: targetCallbackApproval?.denialProof?.sessionResumedAfterRestart === true,
      denialPermissionRequestStatus: asText(targetCallbackApproval?.denialProof?.permissionRequestStatus),
      denialStoredRequestStatus: asText(targetCallbackApproval?.denialProof?.storedRequestStatus),
      denialReceiptReasonCode: asText(targetCallbackApproval?.denialProof?.receiptReasonCode),
      denialFileWritten: targetCallbackApproval?.denialProof?.fileWritten === true,
      denialNoContentLeak: targetCallbackApproval?.denialProof?.noContentLeak === true,
      denialCallbackRequestObserved: targetCallbackApproval?.denialProof?.callbackRequestObserved === true,
      denialNotificationObserved: targetCallbackApproval?.denialProof?.denialNotificationObserved === true,
      denialCompletionNotificationObserved: targetCallbackApproval?.denialProof?.completionNotificationObserved === true,
      restartTurnRecovered: targetCallbackApproval?.restartProof?.turnRecovered === true,
      targetMethodProof: asArray(targetCallbackApproval?.targetMethodProof?.methods),
      proof: asText(targetCallbackApproval?.proof)
    },
    caveat: required
      ? ""
      : "Target callback approval resume proof was not requested by this top-level real gate run."
  };
}

function buildTargetCallbackApprovalDenialRequirement({
  targetCallbackApprovalRequired = false,
  targetCallbackApprovalDenialProofAcceptable = false,
  targetCallbackApproval = null
} = {}) {
  const required = Boolean(targetCallbackApprovalRequired);
  return {
    id: "target_callback_approval_denial",
    label: "Pact denies a target-originated ACP write callback through source approval without writing files or leaking guarded content.",
    required,
    status: required
      ? targetCallbackApprovalDenialProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      sourceAcpProtocolVerified: targetCallbackApproval?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(targetCallbackApproval?.sourceAcpTransport),
      targetTransportType: asText(targetCallbackApproval?.targetTransportType),
      stopReason: asText(targetCallbackApproval?.denialProof?.stopReason),
      responseKind: asText(targetCallbackApproval?.denialProof?.responseKind),
      summaryKind: asText(targetCallbackApproval?.denialProof?.summaryKind),
      sameTurn: targetCallbackApproval?.denialProof?.sameTurn === true,
      pendingResponseKind: asText(targetCallbackApproval?.denialProof?.pendingResponseKind),
      pendingSummaryKind: asText(targetCallbackApproval?.denialProof?.pendingSummaryKind),
      pendingPersistedAfterRestart: targetCallbackApproval?.denialProof?.pendingPersistedAfterRestart === true,
      sessionResumedAfterRestart: targetCallbackApproval?.denialProof?.sessionResumedAfterRestart === true,
      permissionRequestStatus: asText(targetCallbackApproval?.denialProof?.permissionRequestStatus),
      storedRequestStatus: asText(targetCallbackApproval?.denialProof?.storedRequestStatus),
      receiptReasonCode: asText(targetCallbackApproval?.denialProof?.receiptReasonCode),
      fileWritten: targetCallbackApproval?.denialProof?.fileWritten === true,
      noContentLeak: targetCallbackApproval?.denialProof?.noContentLeak === true,
      deniedFilePath: asText(targetCallbackApproval?.denialProof?.deniedFilePath),
      callbackRequestObserved: targetCallbackApproval?.denialProof?.callbackRequestObserved === true,
      denialNotificationObserved: targetCallbackApproval?.denialProof?.denialNotificationObserved === true,
      completionNotificationObserved: targetCallbackApproval?.denialProof?.completionNotificationObserved === true,
      targetMethodProof: asArray(targetCallbackApproval?.targetMethodProof?.methods),
      proof: asText(targetCallbackApproval?.proof)
    },
    caveat: required
      ? ""
      : "Target callback approval denial proof was not requested by this top-level real gate run."
  };
}

function buildTargetCallbackParentBindingRequirement({
  targetCallbackApprovalRequired = false,
  targetCallbackParentBindingProofAcceptable = false,
  targetCallbackApproval = null
} = {}) {
  const required = Boolean(targetCallbackApprovalRequired);
  return {
    id: "target_callback_parent_binding",
    label: "Target-originated ACP callbacks are bound to a unique parent request and fail closed without relay side effects.",
    required,
    status: required
      ? targetCallbackParentBindingProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      sourceAcpProtocolVerified: targetCallbackApproval?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(targetCallbackApproval?.sourceAcpTransport),
      targetTransportType: asText(targetCallbackApproval?.targetTransportType),
      parentRequestIdsBound: targetCallbackApproval?.parentBindingProof?.parentRequestIdsBound === true,
      ambiguousRejected: targetCallbackApproval?.parentBindingProof?.ambiguousRejected === true,
      ambiguousErrorCode: Number(targetCallbackApproval?.parentBindingProof?.ambiguousErrorCode || 0),
      ambiguousReasonCode: asText(targetCallbackApproval?.parentBindingProof?.ambiguousReasonCode),
      notFoundRejected: targetCallbackApproval?.parentBindingProof?.notFoundRejected === true,
      notFoundErrorCode: Number(targetCallbackApproval?.parentBindingProof?.notFoundErrorCode || 0),
      notFoundReasonCode: asText(targetCallbackApproval?.parentBindingProof?.notFoundReasonCode),
      staleParentRequestId: asText(targetCallbackApproval?.parentBindingProof?.staleParentRequestId),
      rejectedFileWritten: targetCallbackApproval?.parentBindingProof?.rejectedFileWritten === true,
      callbackHandlerInvoked: targetCallbackApproval?.parentBindingProof?.callbackHandlerInvoked === true,
      noRelaySideEffect: targetCallbackApproval?.parentBindingProof?.noRelaySideEffect === true,
      permissionRequestCountAfterRejectedCallbacks:
        Number(targetCallbackApproval?.parentBindingProof?.permissionRequestCountAfterRejectedCallbacks || 0),
      expectedPermissionRequestCount: Number(targetCallbackApproval?.parentBindingProof?.expectedPermissionRequestCount || 0),
      proof: asText(targetCallbackApproval?.parentBindingProof?.proof)
    },
    caveat: required
      ? ""
      : "Target callback parent-binding fail-closed proof was not requested by this top-level real gate run."
  };
}

function buildSourceFacingCancelRequirement({
  targetCallbackApprovalRequired = false,
  sourceFacingCancelProofAcceptable = false,
  targetCallbackApproval = null
} = {}) {
  const required = Boolean(targetCallbackApprovalRequired);
  const proof = targetCallbackApproval?.sourceCancelProof || {};
  return {
    id: "source_facing_session_cancel_running_prompt",
    label: "Source-facing ACP session/cancel cancels a running delegated prompt, reaches the target, and suppresses late target completion.",
    required,
    status: required
      ? sourceFacingCancelProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      sourceAcpProtocolVerified: targetCallbackApproval?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(targetCallbackApproval?.sourceAcpTransport),
      targetTransportType: asText(targetCallbackApproval?.targetTransportType),
      relaySessionId: asText(proof.relaySessionId),
      relayTurnId: asText(proof.relayTurnId),
      sourceAcpCancelMethod: asText(proof.sourceAcpCancelMethod),
      sourceCancelResponseOk: proof.sourceCancelResponseOk === true,
      sourceCancelLifecycleState: asText(proof.sourceCancelLifecycleState),
      targetCancelObserved: proof.targetCancelObserved === true,
      targetCancelTargetSessionId: asText(proof.targetCancelTargetSessionId),
      cancelledTurnsCount: Number(proof.cancelledTurnsCount || 0),
      cancelledTurnStopReason: asText(proof.cancelledTurnStopReason),
      cancelledTurnResponseKind: asText(proof.cancelledTurnResponseKind),
      promptStopReason: asText(proof.promptStopReason),
      promptResponseKind: asText(proof.promptResponseKind),
      promptSummaryKind: asText(proof.promptSummaryKind),
      promptReasoningIncluded: proof.promptReasoningIncluded === true,
      lateTargetCompletionSuppressed: proof.lateTargetCompletionSuppressed === true,
      pendingPermissionRequestCountAfterCancel: Number(proof.pendingPermissionRequestCountAfterCancel || 0),
      storedTurnStatus: asText(proof.storedTurnStatus),
      storedTurnStopReason: asText(proof.storedTurnStopReason),
      permissionRequestCountAfterCancel: Number(proof.permissionRequestCountAfterCancel || 0),
      expectedPermissionRequestCountAfterCancel: Number(proof.expectedPermissionRequestCountAfterCancel || 0),
      targetMethodProof: asArray(targetCallbackApproval?.targetMethodProof?.methods),
      proof: asText(proof.proof)
    },
    caveat: required
      ? ""
      : "Source-facing session/cancel proof was not requested by this top-level real gate run."
  };
}

function buildTargetReconnectRequirement({
  targetReconnectProofRequired = false,
  targetReconnectProofAcceptable = false,
  targetReconnect = null
} = {}) {
  const required = Boolean(targetReconnectProofRequired);
  const proof = targetReconnect?.reconnectProof || {};
  return {
    id: "target_reconnect_resume_after_process_restart",
    label: "Pact reconnects to a restarted ACP stdio target with session/resume and preserves the source relay session.",
    required,
    status: required
      ? targetReconnectProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      sourceAcpProtocolVerified: targetReconnect?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(targetReconnect?.sourceAcpTransport),
      targetTransportType: asText(targetReconnect?.targetTransportType),
      targetCommunicationMode: asText(targetReconnect?.targetCommunicationMode),
      nativeAcpTargetSupported: targetReconnect?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: targetReconnect?.nativeAcpTargetVerified === true,
      relaySessionId: asText(targetReconnect?.relaySessionId),
      firstRelayTurnId: asText(targetReconnect?.firstRelayTurnId),
      secondRelayTurnId: asText(targetReconnect?.secondRelayTurnId),
      targetProcessRestartObserved: proof.targetProcessRestartObserved === true,
      distinctTargetProcesses: proof.distinctTargetProcesses === true,
      firstTargetExitObserved: proof.firstTargetExitObserved === true,
      targetResumeRefPersistedBeforeReconnect: proof.targetResumeRefPersistedBeforeReconnect === true,
      targetSessionResumeUsed: proof.targetSessionResumeUsed === true,
      resumeTargetResumeRefMatchedFirst: proof.resumeTargetResumeRefMatchedFirst === true,
      secondPromptDeliveredAfterResume: proof.secondPromptDeliveredAfterResume === true,
      sourceRelaySessionStable: proof.sourceRelaySessionStable === true,
      distinctRelayTurns: proof.distinctRelayTurns === true,
      targetSessionChangedAfterReconnect: proof.targetSessionChangedAfterReconnect === true,
      targetResumeRefRefreshedAfterReconnect: proof.targetResumeRefRefreshedAfterReconnect === true,
      responseKind: asText(proof.responseKind),
      summaryKind: asText(proof.summaryKind),
      finalResponseAvailable: proof.finalResponseAvailable === true,
      reasoningIncluded: proof.reasoningIncluded === true,
      sessionLoadAfterReconnectVerified: proof.sessionLoadAfterReconnectVerified === true,
      sessionGetAfterReconnectVerified: proof.sessionGetAfterReconnectVerified === true,
      reasoningTraceReplaySuppressed: proof.reasoningTraceReplaySuppressed === true,
      targetMethodProof: asArray(targetReconnect?.targetMethodProof?.methods),
      proof: asText(targetReconnect?.proof)
    },
    caveat: required
      ? ""
      : "Target reconnect proof was not requested by this top-level real gate run."
  };
}

function buildTargetLoadReconnectRequirement({
  targetLoadReconnectProofRequired = false,
  targetLoadReconnectProofAcceptable = false,
  targetLoadReconnect = null
} = {}) {
  const required = Boolean(targetLoadReconnectProofRequired);
  const proof = targetLoadReconnect?.loadReconnectProof || {};
  return {
    id: "target_reconnect_load_only_after_process_restart",
    label: "Pact reconnects to a restarted load-only ACP stdio target with session/load and does not call session/resume.",
    required,
    status: required
      ? targetLoadReconnectProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      sourceAcpProtocolVerified: targetLoadReconnect?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(targetLoadReconnect?.sourceAcpTransport),
      targetTransportType: asText(targetLoadReconnect?.targetTransportType),
      targetCommunicationMode: asText(targetLoadReconnect?.targetCommunicationMode),
      nativeAcpTargetSupported: targetLoadReconnect?.nativeAcpTargetSupported === true,
      nativeAcpTargetVerified: targetLoadReconnect?.nativeAcpTargetVerified === true,
      relaySessionId: asText(targetLoadReconnect?.relaySessionId),
      firstRelayTurnId: asText(targetLoadReconnect?.firstRelayTurnId),
      secondRelayTurnId: asText(targetLoadReconnect?.secondRelayTurnId),
      targetProcessRestartObserved: proof.targetProcessRestartObserved === true,
      distinctTargetProcesses: proof.distinctTargetProcesses === true,
      firstTargetExitObserved: proof.firstTargetExitObserved === true,
      targetResumeRefPersistedBeforeReconnect: proof.targetResumeRefPersistedBeforeReconnect === true,
      targetSessionLoadUsed: proof.targetSessionLoadUsed === true,
      targetSessionResumeNotUsed: proof.targetSessionResumeNotUsed === true,
      loadTargetResumeRefMatchedFirst: proof.loadTargetResumeRefMatchedFirst === true,
      secondPromptDeliveredAfterLoad: proof.secondPromptDeliveredAfterLoad === true,
      sourceRelaySessionStable: proof.sourceRelaySessionStable === true,
      distinctRelayTurns: proof.distinctRelayTurns === true,
      targetSessionChangedAfterReconnect: proof.targetSessionChangedAfterReconnect === true,
      targetResumeRefRefreshedAfterReconnect: proof.targetResumeRefRefreshedAfterReconnect === true,
      responseKind: asText(proof.responseKind),
      summaryKind: asText(proof.summaryKind),
      finalResponseAvailable: proof.finalResponseAvailable === true,
      reasoningIncluded: proof.reasoningIncluded === true,
      sessionLoadAfterReconnectVerified: proof.sessionLoadAfterReconnectVerified === true,
      sessionGetAfterReconnectVerified: proof.sessionGetAfterReconnectVerified === true,
      reasoningTraceReplaySuppressed: proof.reasoningTraceReplaySuppressed === true,
      targetMethodProof: asArray(targetLoadReconnect?.targetMethodProof?.methods),
      proof: asText(targetLoadReconnect?.proof)
    },
    caveat: required
      ? ""
      : "Target load-only reconnect proof was not requested by this top-level real gate run."
  };
}

function buildIdempotencyRequirement({
  idempotencyProofRequired = false,
  idempotencyProofAcceptable = false,
  idempotency = null
} = {}) {
  const required = Boolean(idempotencyProofRequired);
  return {
    id: "source_facing_idempotency_replay_conflict",
    label: "Source-facing ACP idempotency replays completed prompts without waking the target and rejects same-key conflicts.",
    required,
    status: required
      ? idempotencyProofAcceptable
        ? "proven"
        : "failed"
      : "not_required",
    evidence: {
      sourceAcpProtocolVerified: idempotency?.sourceAcpProtocolVerified === true,
      sourceAcpTransport: asText(idempotency?.sourceAcpTransport),
      targetTransportType: asText(idempotency?.targetTransportType),
      relaySessionId: asText(idempotency?.relaySessionId),
      relayTurnId: asText(idempotency?.relayTurnId),
      firstResponseKind: asText(idempotency?.firstProof?.responseKind),
      firstSummaryKind: asText(idempotency?.firstProof?.summaryKind),
      firstTargetPromptCount: Number(idempotency?.firstProof?.targetPromptCount || 0),
      firstTurnCount: Number(idempotency?.firstProof?.turnCount || 0),
      firstReasoningIncluded: idempotency?.firstProof?.reasoningIncluded === true,
      replayMarked: idempotency?.replayProof?.idempotencyReplay === true,
      replaySameTurn: idempotency?.replayProof?.sameTurn === true,
      replayResponseKind: asText(idempotency?.replayProof?.responseKind),
      replaySummaryKind: asText(idempotency?.replayProof?.summaryKind),
      replayUsedSourceRestart: idempotency?.replayProof?.usedSourceRestart === true,
      replayNewEventsCount: Number(idempotency?.replayProof?.newEventsCount || 0),
      targetPromptCountAfterReplay: Number(idempotency?.replayProof?.targetPromptCountAfterReplay || 0),
      turnCountAfterReplay: Number(idempotency?.replayProof?.turnCountAfterReplay || 0),
      conflictRejected: idempotency?.conflictProof?.conflictRejected === true,
      conflictErrorCode: asText(idempotency?.conflictProof?.errorCode),
      targetPromptCountAfterConflict: Number(idempotency?.conflictProof?.targetPromptCountAfterConflict || 0),
      turnCountAfterConflict: Number(idempotency?.conflictProof?.turnCountAfterConflict || 0),
      targetNotReawakenedForReplay: idempotency?.targetMethodProof?.targetNotReawakenedForReplay === true,
      targetNotReawakenedForConflict: idempotency?.targetMethodProof?.targetNotReawakenedForConflict === true,
      proof: asText(idempotency?.proof)
    },
    caveat: required
      ? ""
      : "Source-facing idempotency replay/conflict proof was not requested by this top-level real gate run."
  };
}

function buildTopLevelRealProofMatrix({
  relayProofMatrix = null,
  relayRequiredProofsMet = false,
  antigravity = null,
  codexAntigravity = null,
  codexCliRequired = false,
  codexCliProofAcceptable = false,
  codexCli = null,
  codexCliTargetRequired = false,
  codexCliTargetProofAcceptable = false,
  codexCliTarget = null,
  codexAcpTargetRequired = false,
  codexAcpTargetProofAcceptable = false,
  codexAcpTarget = null,
  downstreamCodexAcpTargetRequired = false,
  downstreamCodexAcpTargetProofAcceptable = false,
  downstreamCodexAcpTarget = null,
  antigravityAcpWrapperTargetRequired = false,
  antigravityAcpWrapperTargetProofAcceptable = false,
  antigravityAcpWrapperTarget = null,
  targetCallbackApprovalRequired = false,
  targetCallbackApprovalProofAcceptable = false,
  targetCallbackApprovalDenialProofAcceptable = false,
  targetCallbackParentBindingProofAcceptable = false,
  sourceFacingCancelProofAcceptable = false,
  targetCallbackApproval = null,
  targetReconnectProofRequired = false,
  targetReconnectProofAcceptable = false,
  targetReconnect = null,
  targetLoadReconnectProofRequired = false,
  targetLoadReconnectProofAcceptable = false,
  targetLoadReconnect = null,
  idempotencyProofRequired = false,
  idempotencyProofAcceptable = false,
  idempotency = null,
  connectRequired = false
} = {}) {
  const relayRequirements = asArray(relayProofMatrix?.requirements)
    .map((item) => normalizeRequirement(item))
    .filter((item) => item.id);
  const requirements = relayRequirements.length > 0
    ? relayRequirements
    : [
        {
          id: "relay_proof_matrix",
          label: "The Pact source relay verifier emitted a machine-readable proof matrix.",
          required: true,
          status: relayRequiredProofsMet ? "proven" : "failed",
          evidence: {
            relayProofMatrixSchemaVersion: asText(relayProofMatrix?.schemaVersion),
            relayRequiredProofsMet: relayRequiredProofsMet === true
          },
          caveat: ""
        }
      ];
  const codexCliRequirement = buildCodexCliRequirement({
    codexCliRequired,
    codexCliProofAcceptable,
    codexCli,
    connectRequired
  });
  const existingCodexRequirementIndex = requirements.findIndex((item) => item.id === "codex_cli_participation");
  if (existingCodexRequirementIndex >= 0) {
    requirements[existingCodexRequirementIndex] = codexCliRequirement;
  } else {
    requirements.push(codexCliRequirement);
  }
  const codexCliTargetRequirement = buildCodexCliTargetRequirement({
    codexCliTargetRequired,
    codexCliTargetProofAcceptable,
    codexCliTarget
  });
  const existingCodexTargetRequirementIndex = requirements.findIndex((item) => item.id === "codex_cli_target_communication");
  if (existingCodexTargetRequirementIndex >= 0) {
    requirements[existingCodexTargetRequirementIndex] = codexCliTargetRequirement;
  } else {
    requirements.push(codexCliTargetRequirement);
  }
  const codexAcpTargetRequirement = buildCodexAcpTargetRequirement({
    codexAcpTargetRequired,
    codexAcpTargetProofAcceptable,
    codexAcpTarget
  });
  const existingCodexAcpTargetRequirementIndex = requirements.findIndex((item) => item.id === "codex_acp_target_communication");
  if (existingCodexAcpTargetRequirementIndex >= 0) {
    requirements[existingCodexAcpTargetRequirementIndex] = codexAcpTargetRequirement;
  } else {
    requirements.push(codexAcpTargetRequirement);
  }
  const downstreamCodexAcpTargetRequirement = buildDownstreamCodexAcpTargetRequirement({
    downstreamCodexAcpTargetRequired,
    downstreamCodexAcpTargetProofAcceptable,
    downstreamCodexAcpTarget
  });
  const existingDownstreamCodexAcpTargetRequirementIndex = requirements.findIndex((item) =>
    item.id === "downstream_client_aspect_codex_acp_target_communication"
  );
  if (existingDownstreamCodexAcpTargetRequirementIndex >= 0) {
    requirements[existingDownstreamCodexAcpTargetRequirementIndex] = downstreamCodexAcpTargetRequirement;
  } else {
    requirements.push(downstreamCodexAcpTargetRequirement);
  }
  const antigravityAcpWrapperTargetRequirement = buildAntigravityAcpWrapperTargetRequirement({
    antigravityAcpWrapperTargetRequired,
    antigravityAcpWrapperTargetProofAcceptable,
    antigravityAcpWrapperTarget
  });
  const existingAntigravityAcpWrapperTargetRequirementIndex = requirements.findIndex((item) =>
    item.id === "antigravity_agentapi_acp_wrapper_target_communication"
  );
  if (existingAntigravityAcpWrapperTargetRequirementIndex >= 0) {
    requirements[existingAntigravityAcpWrapperTargetRequirementIndex] = antigravityAcpWrapperTargetRequirement;
  } else {
    requirements.push(antigravityAcpWrapperTargetRequirement);
  }
  const antigravityCrossRunBindingRequirement = buildAntigravityCrossRunBindingRequirement({
    antigravity,
    codexAntigravity,
    antigravityAcpWrapperTarget,
    antigravityAcpWrapperTargetRequired
  });
  const existingAntigravityCrossRunBindingRequirementIndex = requirements.findIndex((item) =>
    item.id === "antigravity_cross_run_binding"
  );
  if (existingAntigravityCrossRunBindingRequirementIndex >= 0) {
    requirements[existingAntigravityCrossRunBindingRequirementIndex] = antigravityCrossRunBindingRequirement;
  } else {
    requirements.push(antigravityCrossRunBindingRequirement);
  }
  const targetCallbackApprovalRequirement = buildTargetCallbackApprovalRequirement({
    targetCallbackApprovalRequired,
    targetCallbackApprovalProofAcceptable,
    targetCallbackApproval
  });
  const existingTargetCallbackRequirementIndex = requirements.findIndex((item) => item.id === "target_callback_approval_resume");
  if (existingTargetCallbackRequirementIndex >= 0) {
    requirements[existingTargetCallbackRequirementIndex] = targetCallbackApprovalRequirement;
  } else {
    requirements.push(targetCallbackApprovalRequirement);
  }
  const targetCallbackApprovalDenialRequirement = buildTargetCallbackApprovalDenialRequirement({
    targetCallbackApprovalRequired,
    targetCallbackApprovalDenialProofAcceptable,
    targetCallbackApproval
  });
  const existingTargetCallbackDenialRequirementIndex = requirements.findIndex((item) =>
    item.id === "target_callback_approval_denial"
  );
  if (existingTargetCallbackDenialRequirementIndex >= 0) {
    requirements[existingTargetCallbackDenialRequirementIndex] = targetCallbackApprovalDenialRequirement;
  } else {
    requirements.push(targetCallbackApprovalDenialRequirement);
  }
  const targetCallbackParentBindingRequirement = buildTargetCallbackParentBindingRequirement({
    targetCallbackApprovalRequired,
    targetCallbackParentBindingProofAcceptable,
    targetCallbackApproval
  });
  const existingTargetCallbackParentBindingRequirementIndex = requirements.findIndex((item) =>
    item.id === "target_callback_parent_binding"
  );
	  if (existingTargetCallbackParentBindingRequirementIndex >= 0) {
	    requirements[existingTargetCallbackParentBindingRequirementIndex] = targetCallbackParentBindingRequirement;
	  } else {
	    requirements.push(targetCallbackParentBindingRequirement);
	  }
	  const sourceFacingCancelRequirement = buildSourceFacingCancelRequirement({
	    targetCallbackApprovalRequired,
	    sourceFacingCancelProofAcceptable,
	    targetCallbackApproval
	  });
	  const existingSourceFacingCancelRequirementIndex = requirements.findIndex((item) =>
	    item.id === "source_facing_session_cancel_running_prompt"
	  );
  if (existingSourceFacingCancelRequirementIndex >= 0) {
    requirements[existingSourceFacingCancelRequirementIndex] = sourceFacingCancelRequirement;
  } else {
    requirements.push(sourceFacingCancelRequirement);
  }
  const targetReconnectRequirement = buildTargetReconnectRequirement({
    targetReconnectProofRequired,
    targetReconnectProofAcceptable,
    targetReconnect
  });
  const existingTargetReconnectRequirementIndex = requirements.findIndex((item) =>
    item.id === "target_reconnect_resume_after_process_restart"
  );
  if (existingTargetReconnectRequirementIndex >= 0) {
    requirements[existingTargetReconnectRequirementIndex] = targetReconnectRequirement;
  } else {
    requirements.push(targetReconnectRequirement);
  }
  const targetLoadReconnectRequirement = buildTargetLoadReconnectRequirement({
    targetLoadReconnectProofRequired,
    targetLoadReconnectProofAcceptable,
    targetLoadReconnect
  });
  const existingTargetLoadReconnectRequirementIndex = requirements.findIndex((item) =>
    item.id === "target_reconnect_load_only_after_process_restart"
  );
  if (existingTargetLoadReconnectRequirementIndex >= 0) {
    requirements[existingTargetLoadReconnectRequirementIndex] = targetLoadReconnectRequirement;
  } else {
    requirements.push(targetLoadReconnectRequirement);
  }
	  const idempotencyRequirement = buildIdempotencyRequirement({
    idempotencyProofRequired,
    idempotencyProofAcceptable,
    idempotency
  });
  const existingIdempotencyRequirementIndex = requirements.findIndex((item) =>
    item.id === "source_facing_idempotency_replay_conflict"
  );
  if (existingIdempotencyRequirementIndex >= 0) {
    requirements[existingIdempotencyRequirementIndex] = idempotencyRequirement;
  } else {
    requirements.push(idempotencyRequirement);
  }

  const requiredRequirements = requirements.filter((item) => item.required);
  const failedRequired = requiredRequirements.filter((item) => item.status !== "proven");
  return {
    schemaVersion: "v0.0.1:agent:acp-agent-relay-real-proof-matrix-1",
    relayProofMatrixSchemaVersion: asText(relayProofMatrix?.schemaVersion),
    relayRequiredProofsMet: relayRequiredProofsMet === true,
    codexCliRequired: Boolean(codexCliRequired),
    codexCliTargetRequired: Boolean(codexCliTargetRequired),
    codexAcpTargetRequired: Boolean(codexAcpTargetRequired),
    downstreamCodexAcpTargetRequired: Boolean(downstreamCodexAcpTargetRequired),
    antigravityAcpWrapperTargetRequired: Boolean(antigravityAcpWrapperTargetRequired),
    targetCallbackApprovalRequired: Boolean(targetCallbackApprovalRequired),
    targetReconnectProofRequired: Boolean(targetReconnectProofRequired),
    targetLoadReconnectProofRequired: Boolean(targetLoadReconnectProofRequired),
    idempotencyProofRequired: Boolean(idempotencyProofRequired),
    connectRequired: Boolean(connectRequired),
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

export function buildRealRelayProofBundle({
  connectRequired = false,
  codexCliRequired = false,
  codexCliTargetRequired = codexCliRequired,
  codexAcpTargetRequired = codexCliRequired,
  downstreamCodexAcpTargetRequired = codexCliRequired,
  antigravityAcpWrapperTargetRequired = false,
  targetCallbackApprovalRequired = false,
  targetReconnectProofRequired = false,
  targetLoadReconnectProofRequired = false,
  idempotencyProofRequired = false,
  antigravityResult = null,
  codexAntigravityResult = null,
  codexCliResult = null,
  codexCliTargetResult = null,
  codexAcpTargetResult = null,
  downstreamCodexAcpTargetResult = null,
  antigravityAcpWrapperTargetResult = null,
  targetCallbackApprovalResult = null,
  targetReconnectResult = null,
  targetLoadReconnectResult = null,
  idempotencyResult = null,
  runResults = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const antigravity = summarizeAntigravity(antigravityResult);
  const codexAntigravity = summarizeCodexAntigravity(codexAntigravityResult);
  const codexCli = summarizeCodexCli(codexCliResult);
  const codexCliTarget = summarizeCodexCliTarget(codexCliTargetResult);
  const codexAcpTarget = summarizeCodexAcpTarget(codexAcpTargetResult);
  const downstreamCodexAcpTarget = summarizeDownstreamCodexAcpTarget(downstreamCodexAcpTargetResult);
  const antigravityAcpWrapperTarget = summarizeAntigravityAcpWrapperTarget(antigravityAcpWrapperTargetResult);
  const targetCallbackApproval = summarizeTargetCallbackApproval(targetCallbackApprovalResult);
  const targetReconnect = summarizeTargetReconnect(targetReconnectResult);
  const targetLoadReconnect = summarizeTargetLoadReconnect(targetLoadReconnectResult);
  const idempotency = summarizeIdempotency(idempotencyResult);
  const relayProofMatrix = asObject(codexAntigravityResult?.proofMatrix, null);
  const relayRequiredProofsMet = relayProofMatrix?.allRequiredProofsMet === true;
  const codexCliProofAcceptable = !codexCliRequired || (
    codexCli?.ok === true &&
      codexCli.codexCliProcessVerified &&
      codexCli.codexCliRanRelayJob &&
      codexCli.markerObservedInRelayOutput &&
      codexCli.antigravityProofAcceptable &&
      (!connectRequired || codexCli.connectProofAcceptable) &&
      codexCli.proofMatrixAllRequiredProofsMet
  );
  const codexCliTargetProofAcceptable = !codexCliTargetRequired || (
    codexCliTarget?.ok === true &&
      codexCliTarget.codexCliTargetProcessVerified &&
      codexCliTarget.sourceAcpProtocolVerified &&
      codexCliTarget.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      codexCliTarget.sourceAcpResponseKindProjected &&
      codexCliTarget.responseKind === "final_response" &&
      codexCliTarget.summaryKind === "final_response" &&
      codexCliTarget.sourceAcpFinalResponseProjected &&
      codexCliTarget.sourceAcpOperationalMethodsVerified &&
      codexCliTarget.sourceAcpSessionLoadAfterRestartVerified &&
      codexCliTarget.operationalDiscoveryProof?.targetListed &&
      codexCliTarget.operationalDiscoveryProof?.sessionListed &&
      codexCliTarget.operationalDiscoveryProof?.sessionGetMatchedTurn &&
      codexCliTarget.operationalDiscoveryProof?.turnListed &&
      codexCliTarget.operationalDiscoveryProof?.turnObserveReasonCode === "target_observation_unsupported" &&
      codexCliTarget.operationalDiscoveryProof?.targetDescriptorCommandRedacted &&
      codexCliTarget.operationalDiscoveryProof?.targetCommunicationMode === "codex_cli_exec_proxy" &&
      codexCliTarget.operationalDiscoveryProof?.nativeAcpTargetSupported === false &&
      codexCliTarget.operationalDiscoveryProof?.nativeAcpTargetVerifiedByDiscovery === false &&
      codexCliTarget.restartSessionLoadProof?.sourceAcpReady === "pact.acp.source_stdio.ready" &&
      codexCliTarget.restartSessionLoadProof?.relaySessionId === codexCliTarget.relaySessionId &&
      codexCliTarget.restartSessionLoadProof?.sessionListedAfterRestart &&
      codexCliTarget.restartSessionLoadProof?.sessionGetMatchedTurnAfterRestart &&
      codexCliTarget.restartSessionLoadProof?.turnListedAfterRestart &&
      codexCliTarget.restartSessionLoadProof?.turnObserveReasonCodeAfterRestart === "target_observation_unsupported" &&
      (
        Number(codexCliTarget.restartSessionLoadProof?.replayedUpdateCount || 0) > 0 ||
        Number(codexCliTarget.restartSessionLoadProof?.replayNotificationCount || 0) > 0
      ) &&
      Number(codexCliTarget.restartSessionLoadProof?.pendingPermissionRequestCount || 0) === 0 &&
      codexCliTarget.restartSessionLoadProof?.requestReasoning === false &&
      codexCliTarget.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true &&
      codexCliTarget.finalResponseAvailable &&
      codexCliTarget.transportType === "codex-cli-exec" &&
      codexCliTarget.targetCommunicationMode === "codex_cli_exec_proxy" &&
      codexCliTarget.nativeAcpTargetSupported === false &&
      codexCliTarget.nativeAcpTargetVerified === false &&
      codexCliTarget.nativeCodexCliAcpSource === false &&
      codexCliTarget.proof === "pact-relay-to-real-codex-cli-exec-target"
  );
  const codexAcpTargetProofAcceptable = !codexAcpTargetRequired || (
    codexAcpTarget?.ok === true &&
      codexAcpTarget.codexAcpTargetProcessVerified &&
      codexAcpTarget.sourceAcpProtocolVerified &&
      codexAcpTarget.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      codexAcpTarget.sourceAcpResponseKindProjected &&
      codexAcpTarget.responseKind === "final_response" &&
      codexAcpTarget.summaryKind === "final_response" &&
      codexAcpTarget.sourceAcpFinalResponseProjected &&
      codexAcpTarget.sourceAcpOperationalMethodsVerified &&
      codexAcpTarget.sourceAcpSessionLoadAfterRestartVerified &&
      codexAcpTarget.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true &&
      codexAcpTarget.operationalDiscoveryProof?.targetListed &&
      codexAcpTarget.operationalDiscoveryProof?.sessionListed &&
      codexAcpTarget.operationalDiscoveryProof?.sessionGetMatchedTurn &&
      codexAcpTarget.operationalDiscoveryProof?.turnListed &&
      codexAcpTarget.operationalDiscoveryProof?.turnObserveReasonCode === "target_observation_unsupported" &&
      codexAcpTarget.operationalDiscoveryProof?.targetDescriptorCommandRedacted &&
      codexAcpTarget.operationalDiscoveryProof?.targetCommunicationMode === "native_acp_stdio" &&
      codexAcpTarget.operationalDiscoveryProof?.nativeAcpTargetSupported === true &&
      codexAcpTarget.operationalDiscoveryProof?.nativeAcpTargetVerifiedByDiscovery === false &&
      codexAcpTarget.restartSessionLoadProof?.sourceAcpReady === "pact.acp.source_stdio.ready" &&
      codexAcpTarget.restartSessionLoadProof?.sessionListedAfterRestart &&
      (
        Number(codexAcpTarget.restartSessionLoadProof?.replayedUpdateCount || 0) > 0 ||
        Number(codexAcpTarget.restartSessionLoadProof?.replayNotificationCount || 0) > 0
      ) &&
      Number(codexAcpTarget.restartSessionLoadProof?.pendingPermissionRequestCount || 0) === 0 &&
      codexAcpTarget.finalResponseAvailable &&
      codexAcpTarget.transportType === "stdio" &&
      codexAcpTarget.targetCommunicationMode === "codex_acp_stdio" &&
      codexAcpTarget.nativeAcpTargetSupported === true &&
      codexAcpTarget.nativeAcpTargetVerified === true &&
      codexAcpTarget.nativeCodexCliAcpSource === false &&
      codexAcpTarget.proof === "pact-relay-to-real-codex-acp-stdio-target"
  );
  const downstreamCodexAcpTargetProofAcceptable = !downstreamCodexAcpTargetRequired || (
    downstreamCodexAcpTarget?.ok === true &&
      downstreamCodexAcpTarget.downstreamClientAspectStarted === true &&
      downstreamCodexAcpTarget.downstreamClientAspectAssemblyUsed === true &&
      downstreamCodexAcpTarget.downstreamClientAspectProofAcceptable === true &&
      downstreamCodexAcpTarget.codexAcpTargetProcessVerified === true &&
      downstreamCodexAcpTarget.sourceAcpProtocolVerified === true &&
      downstreamCodexAcpTarget.sourceAcpTransport === "pact-source-facing-acp-http-loopback" &&
      downstreamCodexAcpTarget.agentDiscoveryProof?.agentListed === true &&
      downstreamCodexAcpTarget.agentDiscoveryProof?.targetId === "codex.acp:default" &&
      downstreamCodexAcpTarget.agentDiscoveryProof?.fromAspect === "downstream-client-aspect" &&
      downstreamCodexAcpTarget.agentDiscoveryProof?.frameworkId === "codex" &&
      downstreamCodexAcpTarget.agentDiscoveryProof?.adapterId === "codex-acp-stdio" &&
      downstreamCodexAcpTarget.agentDiscoveryProof?.toolListed === true &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.targetListed === true &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.targetDescriptorCommandRedacted === true &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.fromAspect === "downstream-client-aspect" &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.frameworkId === "codex" &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.adapterId === "codex-acp-stdio" &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.transportType === "stdio" &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.protocolStyle === "agent-client-protocol-v1" &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.targetCommunicationMode === "native_acp_stdio" &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.nativeAcpTargetSupported === true &&
      downstreamCodexAcpTarget.targetDiscoveryProof?.nativeAcpTargetVerifiedByDiscovery === false &&
      downstreamCodexAcpTarget.responseKind === "final_response" &&
      downstreamCodexAcpTarget.summaryKind === "final_response" &&
      downstreamCodexAcpTarget.sourceAcpResponseKindProjected === true &&
      downstreamCodexAcpTarget.sourceAcpFinalResponseProjected === true &&
      downstreamCodexAcpTarget.sourceAcpOperationalMethodsVerified === true &&
      downstreamCodexAcpTarget.sourceAcpSessionLoadAfterRestartVerified === true &&
      downstreamCodexAcpTarget.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true &&
      (
        Number(downstreamCodexAcpTarget.restartSessionLoadProof?.replayedUpdateCount || 0) > 0 ||
        Number(downstreamCodexAcpTarget.restartSessionLoadProof?.replayNotificationCount || 0) > 0
      ) &&
      Number(downstreamCodexAcpTarget.restartSessionLoadProof?.pendingPermissionRequestCount || 0) === 0 &&
      downstreamCodexAcpTarget.finalResponseAvailable === true &&
      downstreamCodexAcpTarget.targetCommunicationMode === "codex_acp_stdio" &&
      downstreamCodexAcpTarget.nativeAcpTargetSupported === true &&
      downstreamCodexAcpTarget.nativeAcpTargetVerified === true &&
      downstreamCodexAcpTarget.nativeCodexCliAcpSource === false &&
      downstreamCodexAcpTarget.proof === "pact-downstream-client-aspect-to-real-codex-acp-stdio-target"
  );
  const antigravityAcpWrapperTargetProofAcceptable = !antigravityAcpWrapperTargetRequired || (
    antigravityAcpWrapperTarget?.ok === true &&
      antigravityAcpWrapperTarget.sourceAcpProtocolVerified === true &&
      antigravityAcpWrapperTarget.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      antigravityAcpWrapperTarget.downstreamClientAspectAssemblyUsed === true &&
      antigravityAcpWrapperTarget.outboundAcpWrapperProcessVerified === true &&
      antigravityAcpWrapperTarget.targetCommunicationMode === "antigravity_agentapi_acp_stdio_wrapper" &&
      antigravityAcpWrapperTarget.sourceFacingTargetCommunicationMode === "native_acp_stdio" &&
      antigravityAcpWrapperTarget.nativeAcpTargetSupported === true &&
      antigravityAcpWrapperTarget.nativeAcpTargetVerified === true &&
      antigravityAcpWrapperTarget.nativeAntigravityAcp === false &&
      antigravityAcpWrapperTarget.antigravityAgentApiReached === true &&
      antigravityAcpWrapperTarget.proofMeetsMinimum === true &&
      antigravityAcpWrapperTarget.markerObserved === true &&
      antigravityAcpWrapperTarget.metadataProbe === "ok" &&
      antigravityAcpWrapperTarget.responseKind === "acknowledgement" &&
      antigravityAcpWrapperTarget.summaryKind === "acknowledgement" &&
      antigravityAcpWrapperTarget.targetDescriptorCommandRedacted === true &&
      antigravityAcpWrapperTarget.agentDiscoveryProof?.agentListed === true &&
      antigravityAcpWrapperTarget.agentDiscoveryProof?.fromAspect === "downstream-client-aspect" &&
      antigravityAcpWrapperTarget.agentDiscoveryProof?.frameworkId === "antigravity" &&
      antigravityAcpWrapperTarget.agentDiscoveryProof?.adapterId === "antigravity-agentapi-acp-stdio-wrapper" &&
      antigravityAcpWrapperTarget.targetDiscoveryProof?.targetListed === true &&
      antigravityAcpWrapperTarget.targetDiscoveryProof?.fromAspect === "downstream-client-aspect" &&
      antigravityAcpWrapperTarget.targetDiscoveryProof?.frameworkId === "antigravity" &&
      antigravityAcpWrapperTarget.targetDiscoveryProof?.adapterId === "antigravity-agentapi-acp-stdio-wrapper" &&
      antigravityAcpWrapperTarget.targetDiscoveryProof?.wrapper === "antigravity-agentapi-acp-stdio" &&
      antigravityAcpWrapperTarget.restartSessionLoadProof?.sourceAcpReady === "pact.acp.source_stdio.ready" &&
      antigravityAcpWrapperTarget.restartSessionLoadProof?.reasoningTraceReplaySuppressed === true &&
      antigravityAcpWrapperTarget.proof === "pact-downstream-client-aspect-to-antigravity-agentapi-acp-stdio-wrapper"
  );
  const targetCallbackApprovalResumeProofAcceptable = !targetCallbackApprovalRequired || (
    targetCallbackApproval?.ok === true &&
      targetCallbackApproval.sourceAcpProtocolVerified &&
      targetCallbackApproval.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      targetCallbackApproval.targetTransportType === "stdio" &&
      targetCallbackApproval.targetCallbackApprovalProofAcceptable &&
      targetCallbackApproval.sameTurn &&
      targetCallbackApproval.usedSessionResume &&
      targetCallbackApproval.storedRequestStatus === "completed" &&
      targetCallbackApproval.pendingProof?.responseKind === "approval_pending" &&
      targetCallbackApproval.pendingProof?.summaryKind === "approval_pending" &&
      targetCallbackApproval.pendingProof?.persistedAfterRestart &&
      targetCallbackApproval.pendingTurnObservationProof?.reasonCode === "target_observation_unsupported" &&
      targetCallbackApproval.pendingTurnObservationProof?.responseKind === "approval_pending" &&
      targetCallbackApproval.resolveProof?.responseKind === "final_response" &&
      targetCallbackApproval.resolveProof?.summaryKind === "final_response" &&
      targetCallbackApproval.resolveProof?.sameTurn &&
      targetCallbackApproval.resolveProof?.fileWritten &&
      targetCallbackApproval.restartProof?.turnRecovered &&
      targetCallbackApproval.restartProof?.storedRequestStatus === "completed" &&
      targetCallbackApproval.targetMethodProof?.usedSessionResume &&
      targetCallbackApproval.targetMethodProof?.parentRequestIdsBound &&
      targetCallbackApproval.targetMethodProof?.callbackResponseCompleted &&
      targetCallbackApproval.proof === "pact-source-acp-to-stdio-target-callback-approval-resume-and-denial"
  );
  const targetCallbackApprovalDenialProofAcceptable = !targetCallbackApprovalRequired || (
    targetCallbackApproval?.ok === true &&
      targetCallbackApproval.sourceAcpProtocolVerified &&
      targetCallbackApproval.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      targetCallbackApproval.targetTransportType === "stdio" &&
      targetCallbackApproval.targetCallbackApprovalProofAcceptable &&
      targetCallbackApproval.denialProof?.stopReason === "approval_denied" &&
      targetCallbackApproval.denialProof?.responseKind === "approval_denied" &&
      targetCallbackApproval.denialProof?.summaryKind === "approval_denied" &&
      targetCallbackApproval.denialProof?.sameTurn &&
      targetCallbackApproval.denialProof?.pendingResponseKind === "approval_pending" &&
      targetCallbackApproval.denialProof?.pendingSummaryKind === "approval_pending" &&
      targetCallbackApproval.denialProof?.pendingPersistedAfterRestart &&
      targetCallbackApproval.denialProof?.sessionResumedAfterRestart &&
      targetCallbackApproval.denialProof?.permissionRequestStatus === "denied" &&
      targetCallbackApproval.denialProof?.storedRequestStatus === "denied" &&
      targetCallbackApproval.denialProof?.receiptReasonCode === "approval_denied" &&
      targetCallbackApproval.denialProof?.fileWritten === false &&
      targetCallbackApproval.denialProof?.noContentLeak &&
      targetCallbackApproval.denialProof?.deniedFilePath === "notes/target-callback-denied.txt" &&
      targetCallbackApproval.denialProof?.callbackRequestObserved &&
      targetCallbackApproval.denialProof?.denialNotificationObserved &&
      targetCallbackApproval.denialProof?.completionNotificationObserved &&
      targetCallbackApproval.targetMethodProof?.denialCallbackRequested &&
      targetCallbackApproval.proof === "pact-source-acp-to-stdio-target-callback-approval-resume-and-denial"
  );
	  const targetCallbackParentBindingProofAcceptable = !targetCallbackApprovalRequired || (
	    targetCallbackApproval?.ok === true &&
      targetCallbackApproval.sourceAcpProtocolVerified &&
      targetCallbackApproval.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      targetCallbackApproval.targetTransportType === "stdio" &&
      targetCallbackApproval.parentBindingProof?.parentRequestIdsBound &&
      targetCallbackApproval.parentBindingProof?.ambiguousRejected &&
      targetCallbackApproval.parentBindingProof?.ambiguousErrorCode === -32601 &&
      targetCallbackApproval.parentBindingProof?.ambiguousReasonCode === "target_callback_parent_ambiguous" &&
      targetCallbackApproval.parentBindingProof?.notFoundRejected &&
      targetCallbackApproval.parentBindingProof?.notFoundErrorCode === -32601 &&
      targetCallbackApproval.parentBindingProof?.notFoundReasonCode === "target_callback_parent_not_found" &&
      targetCallbackApproval.parentBindingProof?.staleParentRequestId === "stale-parent-request-not-found" &&
      targetCallbackApproval.parentBindingProof?.rejectedFileWritten === false &&
      targetCallbackApproval.parentBindingProof?.callbackHandlerInvoked === false &&
      targetCallbackApproval.parentBindingProof?.noRelaySideEffect &&
      targetCallbackApproval.parentBindingProof?.permissionRequestCountAfterRejectedCallbacks ===
        targetCallbackApproval.parentBindingProof?.expectedPermissionRequestCount &&
	      targetCallbackApproval.parentBindingProof?.proof === "pact-source-acp-to-stdio-target-callback-parent-binding-fail-closed"
	  );
	  const sourceFacingCancelProofAcceptable = !targetCallbackApprovalRequired || (
	    targetCallbackApproval?.ok === true &&
	      targetCallbackApproval.sourceAcpProtocolVerified &&
	      targetCallbackApproval.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
	      targetCallbackApproval.targetTransportType === "stdio" &&
	      asText(targetCallbackApproval.sourceCancelProof?.relaySessionId) &&
	      asText(targetCallbackApproval.sourceCancelProof?.relayTurnId) &&
	      targetCallbackApproval.sourceCancelProof?.sourceAcpCancelMethod === "session/cancel" &&
	      targetCallbackApproval.sourceCancelProof?.sourceCancelResponseOk === true &&
	      targetCallbackApproval.sourceCancelProof?.sourceCancelLifecycleState === "dormant" &&
	      targetCallbackApproval.sourceCancelProof?.targetCancelObserved === true &&
	      asText(targetCallbackApproval.sourceCancelProof?.targetCancelTargetSessionId) &&
	      targetCallbackApproval.sourceCancelProof?.cancelledTurnsCount === 1 &&
	      targetCallbackApproval.sourceCancelProof?.cancelledTurnStopReason === "cancelled" &&
	      targetCallbackApproval.sourceCancelProof?.cancelledTurnResponseKind === "cancelled" &&
	      targetCallbackApproval.sourceCancelProof?.promptStopReason === "cancelled" &&
	      targetCallbackApproval.sourceCancelProof?.promptResponseKind === "cancelled" &&
	      targetCallbackApproval.sourceCancelProof?.promptSummaryKind === "cancelled" &&
	      targetCallbackApproval.sourceCancelProof?.promptReasoningIncluded === false &&
	      targetCallbackApproval.sourceCancelProof?.lateTargetCompletionSuppressed === true &&
	      targetCallbackApproval.sourceCancelProof?.pendingPermissionRequestCountAfterCancel === 0 &&
	      targetCallbackApproval.sourceCancelProof?.storedTurnStatus === "cancelled" &&
	      targetCallbackApproval.sourceCancelProof?.storedTurnStopReason === "cancelled" &&
	      targetCallbackApproval.sourceCancelProof?.permissionRequestCountAfterCancel ===
	        targetCallbackApproval.sourceCancelProof?.expectedPermissionRequestCountAfterCancel &&
	      targetCallbackApproval.targetMethodProof?.usedSessionCancel === true &&
	      Number(targetCallbackApproval.targetMethodProof?.targetCancelCount || 0) >= 1 &&
	      targetCallbackApproval.sourceCancelProof?.proof === "pact-source-acp-to-stdio-target-session-cancel-running-prompt"
	  );
	  const targetCallbackApprovalProofAcceptable = !targetCallbackApprovalRequired || (
	    targetCallbackApprovalResumeProofAcceptable &&
	      targetCallbackApprovalDenialProofAcceptable &&
	      targetCallbackParentBindingProofAcceptable &&
	      sourceFacingCancelProofAcceptable
	  );
  const targetReconnectProofAcceptable = !targetReconnectProofRequired || (
    targetReconnect?.ok === true &&
      targetReconnect.sourceAcpProtocolVerified &&
      targetReconnect.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      targetReconnect.targetTransportType === "stdio" &&
      targetReconnect.targetCommunicationMode === "native_acp_stdio" &&
      targetReconnect.nativeAcpTargetSupported === true &&
      targetReconnect.nativeAcpTargetVerified === true &&
      targetReconnect.targetReconnectProofAcceptable === true &&
      targetReconnect.firstPromptProof?.responseKind === "final_response" &&
      targetReconnect.firstPromptProof?.summaryKind === "final_response" &&
      targetReconnect.firstPromptProof?.finalResponseAvailable === true &&
      targetReconnect.firstPromptProof?.reasoningIncluded === false &&
      targetReconnect.reconnectProof?.targetProcessRestartObserved === true &&
      targetReconnect.reconnectProof?.distinctTargetProcesses === true &&
      targetReconnect.reconnectProof?.firstTargetExitObserved === true &&
      targetReconnect.reconnectProof?.targetResumeRefPersistedBeforeReconnect === true &&
      targetReconnect.reconnectProof?.targetSessionResumeUsed === true &&
      targetReconnect.reconnectProof?.resumeTargetResumeRefMatchedFirst === true &&
      targetReconnect.reconnectProof?.secondPromptDeliveredAfterResume === true &&
      targetReconnect.reconnectProof?.sourceRelaySessionStable === true &&
      targetReconnect.reconnectProof?.distinctRelayTurns === true &&
      targetReconnect.reconnectProof?.targetSessionChangedAfterReconnect === true &&
      targetReconnect.reconnectProof?.targetResumeRefRefreshedAfterReconnect === true &&
      targetReconnect.reconnectProof?.responseKind === "final_response" &&
      targetReconnect.reconnectProof?.summaryKind === "final_response" &&
      targetReconnect.reconnectProof?.finalResponseAvailable === true &&
      targetReconnect.reconnectProof?.reasoningIncluded === false &&
      targetReconnect.reconnectProof?.sessionLoadAfterReconnectVerified === true &&
      targetReconnect.reconnectProof?.sessionGetAfterReconnectVerified === true &&
      targetReconnect.reconnectProof?.reasoningTraceReplaySuppressed === true &&
      Number(targetReconnect.targetMethodProof?.initializeCount || 0) >= 2 &&
      Number(targetReconnect.targetMethodProof?.targetProcessStartCount || 0) >= 2 &&
      targetReconnect.targetMethodProof?.sessionNewCount === 1 &&
      targetReconnect.targetMethodProof?.sessionResumeCount === 1 &&
      targetReconnect.targetMethodProof?.promptCount === 2 &&
      targetReconnect.targetMethodProof?.usedSessionNew === true &&
      targetReconnect.targetMethodProof?.usedSessionResumeAfterTargetRestart === true &&
      targetReconnect.targetMethodProof?.targetPromptCountAfterReconnect === 2 &&
      targetReconnect.proof === "pact-source-acp-to-stdio-target-reconnect-resume"
  );
  const targetLoadReconnectProofAcceptable = !targetLoadReconnectProofRequired || (
    targetLoadReconnect?.ok === true &&
      targetLoadReconnect.sourceAcpProtocolVerified &&
      targetLoadReconnect.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      targetLoadReconnect.targetTransportType === "stdio" &&
      targetLoadReconnect.targetCommunicationMode === "native_acp_stdio" &&
      targetLoadReconnect.nativeAcpTargetSupported === true &&
      targetLoadReconnect.nativeAcpTargetVerified === true &&
      targetLoadReconnect.targetLoadReconnectProofAcceptable === true &&
      targetLoadReconnect.firstPromptProof?.responseKind === "final_response" &&
      targetLoadReconnect.firstPromptProof?.summaryKind === "final_response" &&
      targetLoadReconnect.firstPromptProof?.finalResponseAvailable === true &&
      targetLoadReconnect.firstPromptProof?.reasoningIncluded === false &&
      targetLoadReconnect.loadReconnectProof?.targetProcessRestartObserved === true &&
      targetLoadReconnect.loadReconnectProof?.distinctTargetProcesses === true &&
      targetLoadReconnect.loadReconnectProof?.firstTargetExitObserved === true &&
      targetLoadReconnect.loadReconnectProof?.targetResumeRefPersistedBeforeReconnect === true &&
      targetLoadReconnect.loadReconnectProof?.targetSessionLoadUsed === true &&
      targetLoadReconnect.loadReconnectProof?.targetSessionResumeNotUsed === true &&
      targetLoadReconnect.loadReconnectProof?.loadTargetResumeRefMatchedFirst === true &&
      targetLoadReconnect.loadReconnectProof?.secondPromptDeliveredAfterLoad === true &&
      targetLoadReconnect.loadReconnectProof?.sourceRelaySessionStable === true &&
      targetLoadReconnect.loadReconnectProof?.distinctRelayTurns === true &&
      targetLoadReconnect.loadReconnectProof?.targetSessionChangedAfterReconnect === true &&
      targetLoadReconnect.loadReconnectProof?.targetResumeRefRefreshedAfterReconnect === true &&
      targetLoadReconnect.loadReconnectProof?.responseKind === "final_response" &&
      targetLoadReconnect.loadReconnectProof?.summaryKind === "final_response" &&
      targetLoadReconnect.loadReconnectProof?.finalResponseAvailable === true &&
      targetLoadReconnect.loadReconnectProof?.reasoningIncluded === false &&
      targetLoadReconnect.loadReconnectProof?.sessionLoadAfterReconnectVerified === true &&
      targetLoadReconnect.loadReconnectProof?.sessionGetAfterReconnectVerified === true &&
      targetLoadReconnect.loadReconnectProof?.reasoningTraceReplaySuppressed === true &&
      Number(targetLoadReconnect.targetMethodProof?.initializeCount || 0) >= 2 &&
      Number(targetLoadReconnect.targetMethodProof?.targetProcessStartCount || 0) >= 2 &&
      targetLoadReconnect.targetMethodProof?.sessionNewCount === 1 &&
      targetLoadReconnect.targetMethodProof?.sessionLoadCount === 1 &&
      targetLoadReconnect.targetMethodProof?.sessionResumeCount === 0 &&
      targetLoadReconnect.targetMethodProof?.promptCount === 2 &&
      targetLoadReconnect.targetMethodProof?.usedSessionNew === true &&
      targetLoadReconnect.targetMethodProof?.usedSessionLoadAfterTargetRestart === true &&
      targetLoadReconnect.targetMethodProof?.usedSessionResumeAfterTargetRestart === false &&
      targetLoadReconnect.targetMethodProof?.targetPromptCountAfterReconnect === 2 &&
      targetLoadReconnect.proof === "pact-source-acp-to-stdio-target-reconnect-load"
  );
  const idempotencyProofAcceptable = !idempotencyProofRequired || (
    idempotency?.ok === true &&
      idempotency.sourceAcpProtocolVerified &&
      idempotency.sourceAcpTransport === "pact-source-facing-acp-stdio" &&
      idempotency.targetTransportType === "stdio" &&
      idempotency.idempotencyProofAcceptable &&
      idempotency.firstProof?.responseKind === "final_response" &&
      idempotency.firstProof?.summaryKind === "final_response" &&
      idempotency.firstProof?.idempotencyReplay === false &&
      idempotency.firstProof?.targetPromptCount === 1 &&
      idempotency.firstProof?.turnCount === 1 &&
      idempotency.firstProof?.reasoningIncluded === false &&
      idempotency.replayProof?.idempotencyReplay &&
      idempotency.replayProof?.sameTurn &&
      idempotency.replayProof?.responseKind === "final_response" &&
      idempotency.replayProof?.summaryKind === "final_response" &&
      idempotency.replayProof?.targetPromptCountAfterReplay === 1 &&
      idempotency.replayProof?.turnCountAfterReplay === 1 &&
      idempotency.replayProof?.newEventsCount === 0 &&
      idempotency.replayProof?.usedSourceRestart &&
      idempotency.conflictProof?.conflictRejected &&
      idempotency.conflictProof?.errorCode === "idempotency_key_conflict" &&
      idempotency.conflictProof?.targetPromptCountAfterConflict === 1 &&
      idempotency.conflictProof?.turnCountAfterConflict === 1 &&
      idempotency.targetMethodProof?.targetNotReawakenedForReplay &&
      idempotency.targetMethodProof?.targetNotReawakenedForConflict &&
      idempotency.proof === "pact-source-acp-stdio-idempotency-replay-and-conflict"
  );
	  const proofMatrix = buildTopLevelRealProofMatrix({
	    relayProofMatrix,
	    relayRequiredProofsMet,
    antigravity,
    codexAntigravity,
	    codexCliRequired,
    codexCliProofAcceptable,
    codexCli,
    codexCliTargetRequired,
    codexCliTargetProofAcceptable,
    codexCliTarget,
    codexAcpTargetRequired,
    codexAcpTargetProofAcceptable,
    codexAcpTarget,
    downstreamCodexAcpTargetRequired,
    downstreamCodexAcpTargetProofAcceptable,
    downstreamCodexAcpTarget,
    antigravityAcpWrapperTargetRequired,
    antigravityAcpWrapperTargetProofAcceptable,
    antigravityAcpWrapperTarget,
    targetCallbackApprovalRequired,
	    targetCallbackApprovalProofAcceptable: targetCallbackApprovalResumeProofAcceptable,
	    targetCallbackApprovalDenialProofAcceptable,
    targetCallbackParentBindingProofAcceptable,
    sourceFacingCancelProofAcceptable,
    targetCallbackApproval,
    targetReconnectProofRequired,
    targetReconnectProofAcceptable,
    targetReconnect,
    targetLoadReconnectProofRequired,
    targetLoadReconnectProofAcceptable,
    targetLoadReconnect,
    idempotencyProofRequired,
    idempotencyProofAcceptable,
    idempotency,
    connectRequired
  });
	  const allRequiredProofsMet = proofMatrix.allRequiredProofsMet;
  const antigravityCrossRunBindingProofAcceptable = proofMatrix.requirements?.find((item) =>
    item.id === "antigravity_cross_run_binding"
  )?.status === "proven";
  const ok = Boolean(
    antigravity?.ok &&
      antigravity.proofMeetsMinimum &&
      codexAntigravity?.ok &&
      codexAntigravity.antigravityProofMeetsMinimum &&
      (!connectRequired || codexAntigravity.sourceConnectProofAcceptable) &&
      allRequiredProofsMet
  );
  return {
    schemaVersion: "v0.0.1:agent:acp-agent-relay-real-proof-bundle-1",
    verifier: "acp-agent-relay-real",
    ok,
    generatedAt: asText(generatedAt),
    connectRequired: Boolean(connectRequired),
    codexCliRequired: Boolean(codexCliRequired),
    codexCliTargetRequired: Boolean(codexCliTargetRequired),
    codexAcpTargetRequired: Boolean(codexAcpTargetRequired),
    downstreamCodexAcpTargetRequired: Boolean(downstreamCodexAcpTargetRequired),
    antigravityAcpWrapperTargetRequired: Boolean(antigravityAcpWrapperTargetRequired),
    targetCallbackApprovalRequired: Boolean(targetCallbackApprovalRequired),
    targetReconnectProofRequired: Boolean(targetReconnectProofRequired),
    targetLoadReconnectProofRequired: Boolean(targetLoadReconnectProofRequired),
    idempotencyProofRequired: Boolean(idempotencyProofRequired),
    relayRequiredProofsMet,
    allRequiredProofsMet,
    codexCliProofAcceptable,
    codexCliTargetProofAcceptable,
    codexAcpTargetProofAcceptable,
    downstreamCodexAcpTargetProofAcceptable,
    antigravityAcpWrapperTargetProofAcceptable,
    antigravityCrossRunBindingProofAcceptable,
    targetCallbackApprovalProofAcceptable,
    targetCallbackApprovalResumeProofAcceptable,
	    targetCallbackApprovalDenialProofAcceptable,
    targetCallbackParentBindingProofAcceptable,
    sourceFacingCancelProofAcceptable,
    targetReconnectProofAcceptable,
    targetLoadReconnectProofAcceptable,
	    idempotencyProofAcceptable,
    antigravity,
    codexAntigravity,
    codexCli,
    codexCliTarget,
    codexAcpTarget,
    downstreamCodexAcpTarget,
    antigravityAcpWrapperTarget,
    targetCallbackApproval,
    targetReconnect,
    targetLoadReconnect,
    idempotency,
    proofMatrix,
    relayProofMatrix,
    runResults: runResults.map((result) => ({
      scriptPath: asText(result.scriptPath),
      exitCode: Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : null,
      signal: asText(result.signal),
      outputBytes: Number.isFinite(Number(result.outputBytes)) ? Number(result.outputBytes) : 0
    }))
  };
}
