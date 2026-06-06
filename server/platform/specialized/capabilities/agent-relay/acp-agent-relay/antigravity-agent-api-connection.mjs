import {
  AntigravityAgentApiClient,
  createAntigravityAgentApiCapabilitySnapshot,
  extractAntigravityConversationId,
  normalizeAntigravityAgentApiConfig,
  normalizeAntigravityAgentApiResponse,
  observeAntigravityConversation,
  waitForAntigravityConversationObservation
} from "./antigravity-agent-api-client.mjs";

function nowIso() {
  return new Date().toISOString();
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function resolveConfiguredConversationId({ target = {}, relaySession = {}, config = {} } = {}) {
  const transport = asObject(target.transport);
  const metadata = asObject(target.metadata);
  const targetResumeRef = asText(relaySession.targetResumeRef);
  if (targetResumeRef && !targetResumeRef.startsWith("resume_")) {
    return targetResumeRef;
  }
  return asText(
    config.conversationId ||
      transport.conversationId ||
      transport.recipientId ||
      metadata.conversationId ||
      metadata.recipientId ||
      relaySession.targetSessionId
  );
}

function formatRelayPrompt(params = {}, { target = {}, relaySession = {}, route = {} } = {}) {
  const prompt = asText(params.prompt || params.text || params.message);
  const header = [
    "[Pact ACP Agent Relay]",
    `relaySessionId: ${asText(relaySession.relaySessionId, "unknown")}`,
    `virtualAgentId: ${asText(route.virtualAgent?.virtualAgentId || params.virtualAgentId, "unknown")}`,
    `targetId: ${asText(target.targetId || params.targetId, "unknown")}`,
    `mode: ${asText(route.effectiveMode || params.mode, "ask")}`
  ].join("\n");
  return `${header}\n\n${prompt}`;
}

function normalizeReasoning(response = {}) {
  const payload = asObject(response);
  const reasoning = payload.reasoning;
  if (Array.isArray(reasoning)) {
    return reasoning
      .map((entry) => (typeof entry === "string" ? { type: "reasoning_trace", text: entry } : asObject(entry)))
      .filter((entry) => Object.keys(entry).length > 0);
  }
  return [];
}

function normalizeEvents(response = {}) {
  const payload = asObject(response);
  const events = payload.events || payload.updates;
  if (Array.isArray(events)) {
    return events
      .map((entry) => {
        if (typeof entry === "string") {
          return {
            type: "progress",
            phase: "working",
            text: entry
          };
        }
        return asObject(entry);
      })
      .filter((entry) => Object.keys(entry).length > 0);
  }
  return [];
}

function redactedConversationObservation(observation = {}) {
  const input = asObject(observation);
  const latestProgress = asObject(input.latestProgress);
  const latestFinalResponse = asObject(input.latestFinalResponse);
  const latestError = asObject(input.latestError);
  const latestKnownError = asObject(input.latestKnownError);
  return {
    conversationId: asText(input.conversationId),
    transcriptPath: asText(input.transcriptPath),
    messagesDir: asText(input.messagesDir),
    transcriptLineCount: Number(input.transcriptLineCount || 0),
    messageCount: Number(input.messageCount || 0),
    afterTranscriptLineCount: Number(input.afterTranscriptLineCount || 0),
    afterMessageMtimeMs: Number(input.afterMessageMtimeMs || 0),
    markerObserved: input.markerObserved === true,
    markerMessageObserved: input.markerMessageObserved === true,
    markerTranscriptObserved: input.markerTranscriptObserved === true,
    markerMessageCount: Number(input.markerMessageCount || 0),
    transcriptAdvanced: input.transcriptAdvanced === true,
    progressAvailable: input.progressAvailable === true,
    finalResponseAvailable: input.finalResponseAvailable === true,
    errorAvailable: input.errorAvailable === true,
    knownErrorAvailable: input.knownErrorAvailable === true,
    latestMessage: asObject(input.latestMessage, null),
    latestProgress: Object.keys(latestProgress).length > 0
      ? {
          lineIndex: latestProgress.lineIndex,
          stepIndex: latestProgress.stepIndex,
          createdAt: asText(latestProgress.createdAt),
          textPreview: asText(latestProgress.textPreview || latestProgress.text)
        }
      : null,
    latestFinalResponse: Object.keys(latestFinalResponse).length > 0
      ? {
          lineIndex: latestFinalResponse.lineIndex,
          stepIndex: latestFinalResponse.stepIndex,
          createdAt: asText(latestFinalResponse.createdAt),
          textPreview: asText(latestFinalResponse.textPreview || latestFinalResponse.text)
        }
      : null,
    latestError: Object.keys(latestError).length > 0
      ? {
          lineIndex: latestError.lineIndex,
          stepIndex: latestError.stepIndex,
          source: asText(latestError.source),
          type: asText(latestError.type),
          status: asText(latestError.status),
          createdAt: asText(latestError.createdAt),
          errorPreview: asText(latestError.errorPreview || latestError.contentPreview),
          contentPreview: asText(latestError.contentPreview)
        }
      : null,
    latestKnownError: Object.keys(latestKnownError).length > 0
      ? {
          lineIndex: latestKnownError.lineIndex,
          stepIndex: latestKnownError.stepIndex,
          source: asText(latestKnownError.source),
          type: asText(latestKnownError.type),
          status: asText(latestKnownError.status),
          createdAt: asText(latestKnownError.createdAt),
          errorPreview: asText(latestKnownError.errorPreview || latestKnownError.contentPreview),
          contentPreview: asText(latestKnownError.contentPreview)
        }
      : null,
    latestTranscriptEntry: asObject(input.latestTranscriptEntry, null),
    latestMarkerMessage: asObject(input.latestMarkerMessage, null)
  };
}

function redactedConnectStep(step = {}) {
  const input = asObject(step);
  const diagnostics = asObject(input.diagnostics);
  const runCommand = asObject(input.runCommand);
  const requestedInteraction = asObject(input.requestedInteraction);
  const permission = asObject(requestedInteraction.permission);
  const redactedDiagnostics = Object.keys(diagnostics).length > 0
    ? {
        hasSystemMessage: diagnostics.hasSystemMessage === true,
        hasUserInput: diagnostics.hasUserInput === true,
        hasAddCascadeInput: diagnostics.hasAddCascadeInput === true,
        plannerResponseStopReason: asText(diagnostics.plannerResponseStopReason),
        contentSourcePath: asText(diagnostics.contentSourcePath),
        errorSourcePath: asText(diagnostics.errorSourcePath)
      }
    : null;
  return Object.keys(input).length > 0
    ? {
        ordinal: input.ordinal,
        stepIndex: input.stepIndex,
        metadataIndex: input.metadataIndex,
        trajectoryId: asText(input.trajectoryId),
        cascadeId: asText(input.cascadeId),
        type: asText(input.type),
        status: asText(input.status),
        source: asText(input.source),
        createdAt: asText(input.createdAt),
        completedAt: asText(input.completedAt),
        plannerResponseStopReason: asText(input.plannerResponseStopReason),
        diagnostics: redactedDiagnostics,
        toolCall: asObject(input.toolCall, null),
        runCommand: Object.keys(runCommand).length > 0
          ? {
              commandLinePreview: asText(runCommand.commandLine).replace(/\s+/g, " ").slice(0, 280),
              cwd: asText(runCommand.cwd),
              blocking: runCommand.blocking === true
            }
          : null,
        requestedInteraction: Object.keys(requestedInteraction).length > 0
          ? {
              kind: asText(requestedInteraction.kind),
              permission: Object.keys(permission).length > 0
                ? {
                    action: asText(permission.action),
                    targetPreview: asText(permission.target).replace(/\s+/g, " ").slice(0, 280),
                    persistSuggestionType: asText(permission.persistSuggestionType),
                    suggestedPersistPattern: asText(permission.suggestedPersistPattern)
                  }
                : null
            }
          : null,
        errorPreview: asText(input.errorPreview || input.error).replace(/\s+/g, " ").slice(0, 280),
        contentPreview: asText(input.contentPreview || input.content).replace(/\s+/g, " ").slice(0, 280)
      }
    : null;
}

function redactedConnectObservation(observation = {}, actions = [], { handledInteractionStep = null } = {}) {
  const input = asObject(observation);
  return {
    conversationId: asText(input.conversationId),
    endpoint: asObject(input.endpoint, null),
    runStatus: asText(input.runStatus),
    stepCount: Number(input.stepCount || 0),
    afterStepCount: Number(input.afterStepCount || 0),
    trajectoryAdvanced: input.trajectoryAdvanced === true,
    statusCounts: asObject(input.statusCounts),
    running: input.running === true,
    completed: input.completed === true,
    failed: input.failed === true,
    pendingInteraction: input.pendingInteraction === true,
    blockedByPendingInteraction: input.blockedByPendingInteraction === true,
    markerObserved: input.markerObserved === true,
    progressAvailable: input.progressAvailable === true,
    finalResponseAvailable: input.finalResponseAvailable === true,
    latestStep: redactedConnectStep(input.latestStep),
    waitingInteractionStep: redactedConnectStep(input.waitingInteractionStep),
    handledInteractionStep: redactedConnectStep(handledInteractionStep),
    latestError: redactedConnectStep(input.latestError),
    latestKnownError: redactedConnectStep(input.latestKnownError),
    latestProgress: redactedConnectStep(input.latestProgress),
    latestFinalResponse: redactedConnectStep(input.latestFinalResponse),
    actions: actions.map((action) => ({
      type: asText(action.type),
      ok: action.ok === true,
      statusCode: Number(action.statusCode || 0),
      error: asText(action.error),
      at: asText(action.at)
    }))
  };
}

function isCommandConnectInteractionStep(step = {}) {
  const input = asObject(step, null);
  if (!input) {
    return false;
  }
  const permission = asObject(input.requestedInteraction?.permission, null);
  return asText(permission?.action) === "command";
}

function connectFinalResponseText(observation = {}) {
  const finalResponse = asObject(observation?.latestFinalResponse, null);
  return asText(finalResponse?.content || finalResponse?.text || finalResponse?.contentPreview);
}

function observationErrorText(step = {}) {
  const input = asObject(step, null);
  return asText(input?.errorPreview || input?.error || input?.contentPreview || input?.content);
}

function isHighSignalAntigravityRuntimeError(text = "") {
  return /RESOURCE_EXHAUSTED|quota|rate.?limit|429|overage|overages/i.test(asText(text));
}

function conversationKnownErrorText(observation = {}) {
  const input = asObject(observation, null);
  const text = observationErrorText(input?.latestKnownError);
  return isHighSignalAntigravityRuntimeError(text) ? text : "";
}

function timeMs(value = "") {
  const parsed = Date.parse(asText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCurrentConnectError(connect = {}, latestError = {}, {
  connectBaselineReliable = true,
  sentAt = ""
} = {}) {
  if (connectBaselineReliable !== false) {
    return true;
  }
  const sentAtMs = timeMs(sentAt);
  if (!sentAtMs) {
    return true;
  }
  const latestErrorMs = timeMs(latestError?.createdAt);
  if (latestError && Object.keys(latestError).length > 0) {
    return latestErrorMs >= sentAtMs;
  }
  return connect?.failed === true && timeMs(connect?.latestStep?.createdAt) >= sentAtMs;
}

function targetErrorFromObservations({
  connectConversationObservation = null,
  localConversationObservation = null,
  connectObservationError = "",
  localObservationError = "",
  connectBaselineReliable = true,
  sentAt = ""
} = {}) {
  const connect = asObject(connectConversationObservation, null);
  if (connect?.latestError || connect?.failed === true) {
    const latestError = asObject(connect.latestError, null);
    if (!isCurrentConnectError(connect, latestError, { connectBaselineReliable, sentAt })) {
      return null;
    }
    const diagnosticMessage = conversationKnownErrorText(localConversationObservation);
    const readableErrorMessage = observationErrorText(latestError);
    if (connect.failed !== true && !readableErrorMessage && !diagnosticMessage) {
      return null;
    }
    const message = readableErrorMessage ||
      diagnosticMessage ||
      (connect.failed === true
        ? "Antigravity Connect reported a failed trajectory for the delegated prompt."
        : "Antigravity Connect reported an error step for the delegated prompt.");
    return {
      code: "antigravity_connect_error",
      message,
      provider: "antigravity-connect",
      conversationId: asText(connect.conversationId),
      stepIndex: latestError?.stepIndex,
      stepType: asText(latestError?.type),
      runStatus: asText(connect.runStatus),
      diagnosticMessage,
      observationError: asText(connectObservationError)
    };
  }

  const connectErrorMessage = asText(connectObservationError);
  if (connectErrorMessage) {
    return {
      code: "antigravity_connect_observation_error",
      message: connectErrorMessage,
      provider: "antigravity-connect",
      conversationId: asText(connect?.conversationId),
      runStatus: asText(connect?.runStatus),
      observationError: connectErrorMessage
    };
  }

  const local = asObject(localConversationObservation, null);
  if (local?.latestError || local?.errorAvailable === true) {
    const latestError = asObject(local.latestError, null);
    return {
      code: "antigravity_transcript_error",
      message: observationErrorText(latestError) || "Antigravity transcript reported an error for the delegated prompt.",
      provider: "antigravity-local-transcript",
      conversationId: asText(local.conversationId),
      stepIndex: latestError?.stepIndex,
      stepType: asText(latestError?.type),
      observationError: asText(localObservationError)
    };
  }

  return null;
}

export class AntigravityAgentApiConnection {
  constructor({ target = {}, relaySession = {}, route = {}, client = null, logger = null } = {}) {
    this.target = asObject(target);
    this.relaySession = asObject(relaySession);
    this.route = asObject(route);
    this.transport = asObject(this.target.transport);
    this.config = normalizeAntigravityAgentApiConfig({
      ...asObject(this.transport.agentApi),
      ...this.transport,
      ...asObject(this.target.metadata?.agentApi)
    });
    this.client = client || new AntigravityAgentApiClient({
      ...this.config,
      logger
    });
    this.logger = asObject(logger);
    this.initialized = false;
    this.closed = false;
    this.conversationId = resolveConfiguredConversationId({
      target: this.target,
      relaySession: this.relaySession,
      config: this.config
    });
    this.messages = [];
    this.capabilityProbe = null;
    this.ideCliCapabilitySnapshot = null;
    this.capabilitySnapshot = createAntigravityAgentApiCapabilitySnapshot();
  }

  async initialize(params = {}) {
    this.initialized = true;
    const metadata = this.conversationId
      ? await this.client.getConversationMetadata(this.conversationId).catch((error) => ({
          error: error.message,
          response: {}
        }))
      : null;
    const metadataConversationId = metadata && !metadata.error ? extractAntigravityConversationId(metadata) : "";
    if (metadataConversationId) {
      this.conversationId = metadataConversationId;
    }
    if (typeof this.client.probeCapabilities === "function") {
      const configuredTimeoutMs = Number(this.config.timeoutMs || 120000);
      this.capabilityProbe = await this.client.probeCapabilities({
        conversationId: this.conversationId,
        timeoutMs: Math.min(Number.isFinite(configuredTimeoutMs) ? configuredTimeoutMs : 120000, 8000)
      }).catch((error) => ({
        error: error.message,
        snapshot: createAntigravityAgentApiCapabilitySnapshot()
      }));
      this.capabilitySnapshot = asObject(
        this.capabilityProbe?.snapshot,
        createAntigravityAgentApiCapabilitySnapshot()
      );
    }
    if (typeof this.client.probeIdeCliCapabilities === "function") {
      this.ideCliCapabilitySnapshot = await this.client.probeIdeCliCapabilities({
        timeoutMs: 3000
      }).catch((error) => ({
        provider: "antigravity-ide-cli",
        found: false,
        cliPath: "",
        version: "",
        checkedCommands: ["--help", "chat --help"],
        subcommands: [],
        chatCommandSupported: false,
        chatReadsStdin: false,
        chatIsAcpTransport: false,
        mcpConfigSupported: false,
        nativeAcpCommandNames: [],
        nativeAcpTransportSupported: false,
        nativeAcpTargetVerified: false,
        nativeAcpSourceVerified: false,
        reasonCode: error.message || "antigravity_ide_cli_probe_failed"
      }));
    }
    this.messages.push({
      direction: "out",
      method: "agentapi.initialize",
      conversationId: this.conversationId,
      relaySessionId: asText(params.relaySessionId || this.relaySession.relaySessionId),
      at: nowIso()
    });
    return {
      ok: true,
      targetId: this.target.targetId || "",
      transportType: "antigravity-agentapi",
      capabilities: {
        session: ["new", "resume"],
        updates: ["accepted"],
        fs: [],
        terminal: false,
        mcp: false,
        agentApi: true
      },
      targetSessionId: this.conversationId,
      targetResumeRef: this.conversationId,
      initializedAt: nowIso(),
      conversation: metadata?.response || {},
      metadata: metadata?.response || {}
    };
  }

  async sendPrompt(params = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    const content = formatRelayPrompt(params, {
      target: this.target,
      relaySession: this.relaySession,
      route: this.route
    });
    const observationMarker = asText(params.localObservationMarker || params.observationMarker || params.marker || content);
    const sentAt = nowIso();
    const hadConversation = Boolean(this.conversationId);
    let beforeLocalObservation = null;
    let localObservationError = "";
    let beforeConnectObservation = null;
    let connectConversationObservation = null;
    let latestConnectObservation = null;
    let connectObservationError = "";
    let targetConnectObservationError = "";
    const connectActions = [];
    let handledConnectInteractionStep = null;
    if (this.config.localObservationEnabled && this.conversationId) {
      beforeLocalObservation = await observeAntigravityConversation({
        conversationId: this.conversationId,
        brainRoot: this.config.localObservationBrainRoot,
        maxTranscriptEntries: 1,
        maxMessageEntries: 1
      }).catch((error) => {
        localObservationError = error.message;
        return null;
      });
    }
    if (this.config.connectEnabled && this.conversationId && typeof this.client.observeConnectTrajectory === "function") {
      beforeConnectObservation = await this.client.observeConnectTrajectory({
        conversationId: this.conversationId,
        marker: observationMarker,
        afterStepCount: 0,
        timeoutMs: this.config.connectTimeoutMs
      }).catch((error) => {
        connectObservationError = error.message;
        return null;
      });
    }
    const response = this.conversationId
      ? await this.client.sendMessage({ recipientId: this.conversationId, content })
      : await this.client.newConversation({ prompt: content, model: this.config.model });
    const isSendMessageAck = Boolean(response?.response?.sendMessage || response?.sendMessage);
    const normalized = normalizeAntigravityAgentApiResponse(response, {
      stdout: response.stdout,
      stderr: response.stderr
    });
    const responseConversationId = normalized.conversationId || extractAntigravityConversationId(response);
    if (responseConversationId) {
      this.conversationId = responseConversationId;
    }
    let localConversationObservation = null;
    if (this.config.localObservationEnabled && this.conversationId) {
      const observed = await waitForAntigravityConversationObservation({
        conversationId: this.conversationId,
        brainRoot: this.config.localObservationBrainRoot,
        marker: observationMarker,
        afterTranscriptLineCount: beforeLocalObservation?.transcriptLineCount || 0,
        afterMessageMtimeMs: beforeLocalObservation?.latestMessageMtimeMs || 0,
        timeoutMs: this.config.localObservationTimeoutMs,
        pollIntervalMs: this.config.localObservationPollIntervalMs,
        until: "message"
      }).catch((error) => {
        localObservationError = error.message;
        return null;
      });
      localConversationObservation = observed ? redactedConversationObservation(observed) : null;
    }
    if (this.config.connectEnabled && this.conversationId && typeof this.client.observeConnectTrajectory === "function") {
      const afterStepCount = beforeConnectObservation?.stepCount || 0;
      let connectObservation = await this.client.observeConnectTrajectory({
        conversationId: this.conversationId,
        marker: observationMarker,
        afterStepCount,
        timeoutMs: this.config.connectTimeoutMs
      }).catch((error) => {
        connectObservationError = error.message;
        targetConnectObservationError = error.message;
        return null;
      });
      const waitForConnectFinalResponse = async (currentObservation) => {
        if (
          this.config.connectWaitForFinalResponse === false ||
          !isSendMessageAck ||
          !currentObservation ||
          currentObservation.finalResponseAvailable === true ||
          currentObservation.pendingInteraction === true ||
          currentObservation.blockedByPendingInteraction === true ||
          currentObservation.completed === true ||
          currentObservation.failed === true ||
          typeof this.client.waitForConnectTrajectoryObservation !== "function"
        ) {
          return currentObservation;
        }
        return this.client.waitForConnectTrajectoryObservation({
          conversationId: this.conversationId,
          marker: observationMarker,
          afterStepCount,
          timeoutMs: this.config.connectObservationTimeoutMs,
          pollIntervalMs: this.config.connectObservationPollIntervalMs,
          until: "idle"
        }).catch((error) => {
          connectObservationError = error.message;
          targetConnectObservationError = error.message;
          return currentObservation;
        });
      };
      connectObservation = await waitForConnectFinalResponse(connectObservation);
      if (
        connectObservation?.blockedByPendingInteraction === true &&
        this.config.connectDenyPendingCommandInteractions &&
        isCommandConnectInteractionStep(connectObservation.waitingInteractionStep) &&
        typeof this.client.denyCascadeUserInteraction === "function"
      ) {
        handledConnectInteractionStep = connectObservation.waitingInteractionStep || null;
        const action = {
          type: "handleCascadeUserInteraction.denyCommand",
          at: nowIso(),
          ok: false,
          statusCode: 0,
          error: ""
        };
        const denyResult = await this.client.denyCascadeUserInteraction({
          conversationId: this.conversationId,
          step: handledConnectInteractionStep,
          timeoutMs: this.config.connectTimeoutMs
        }).catch((error) => {
          action.error = error.message;
          return null;
        });
        if (denyResult) {
          action.ok = true;
          action.statusCode = denyResult.statusCode;
        }
        connectActions.push(action);
        connectObservation = await this.client.observeConnectTrajectory({
          conversationId: this.conversationId,
          marker: observationMarker,
          afterStepCount,
          timeoutMs: this.config.connectTimeoutMs
        }).catch((error) => {
          connectObservationError = error.message;
          targetConnectObservationError = error.message;
          return connectObservation;
        });
        connectObservation = await waitForConnectFinalResponse(connectObservation);
      }
      if (
        connectObservation?.blockedByPendingInteraction === true &&
        this.config.connectForceStopStuckCascade &&
        typeof this.client.forceStopCascadeTree === "function"
      ) {
        handledConnectInteractionStep = connectObservation.waitingInteractionStep || null;
        const action = {
          type: "forceStopCascadeTree",
          at: nowIso(),
          ok: false,
          statusCode: 0,
          error: ""
        };
        const forceStopResult = await this.client.forceStopCascadeTree({
          conversationId: this.conversationId,
          timeoutMs: this.config.connectTimeoutMs
        }).catch((error) => {
          action.error = error.message;
          return null;
        });
        if (forceStopResult) {
          action.ok = true;
          action.statusCode = forceStopResult.statusCode;
        }
        connectActions.push(action);
        connectObservation = await this.client.observeConnectTrajectory({
          conversationId: this.conversationId,
          marker: observationMarker,
          afterStepCount,
          timeoutMs: this.config.connectTimeoutMs
        }).catch((error) => {
          connectObservationError = error.message;
          targetConnectObservationError = error.message;
          return connectObservation;
        });
      }
      if (this.config.connectFlushQueuedMessages && typeof this.client.sendAllQueuedMessages === "function") {
        const action = {
          type: "sendAllQueuedMessages",
          at: nowIso(),
          ok: false,
          statusCode: 0,
          error: ""
        };
        const flushResult = await this.client.sendAllQueuedMessages({
          conversationId: this.conversationId,
          timeoutMs: this.config.connectTimeoutMs
        }).catch((error) => {
          action.error = error.message;
          return null;
        });
        if (flushResult) {
          action.ok = true;
          action.statusCode = flushResult.statusCode;
        }
        connectActions.push(action);
        if (flushResult && typeof this.client.waitForConnectTrajectoryObservation === "function") {
          connectObservation = await this.client.waitForConnectTrajectoryObservation({
            conversationId: this.conversationId,
            marker: observationMarker,
            afterStepCount,
            timeoutMs: this.config.connectObservationTimeoutMs,
            pollIntervalMs: this.config.connectObservationPollIntervalMs,
            until: this.config.connectWaitForFinalResponse === false ? "trajectory" : "idle"
          }).catch((error) => {
            connectObservationError = error.message;
            targetConnectObservationError = error.message;
            return connectObservation;
          });
        }
      }
      connectConversationObservation = connectObservation
        ? redactedConnectObservation(connectObservation, connectActions, {
            handledInteractionStep: handledConnectInteractionStep
          })
        : null;
      latestConnectObservation = connectObservation;
    }
    const conversation = {
      conversationId: this.conversationId,
      recipientId: normalized.recipientId || this.conversationId,
      model: normalized.model || this.config.model,
      summary: normalized.text || "",
      stopReason: isSendMessageAck ? "accepted" : normalized.stopReason || "completed"
    };
    this.messages.push({
      direction: "out",
      method: hadConversation ? "agentapi.send-message" : "agentapi.new-conversation",
      conversationId: this.conversationId,
      at: sentAt
    });
    const acceptedUpdate = {
      type: "progress",
      phase: "accepted",
      text: hadConversation
        ? "Antigravity Agent API accepted the delegated prompt on an existing conversation."
        : "Antigravity Agent API created a conversation and accepted the delegated prompt."
    };
    const connectFinalAvailable = connectConversationObservation?.finalResponseAvailable === true;
    const connectFinalText = connectFinalResponseText(latestConnectObservation);
    const connectBlocked = connectConversationObservation?.blockedByPendingInteraction === true;
    const connectBaselineReliable = !hadConversation ||
      !this.config.connectEnabled ||
      Boolean(beforeConnectObservation);
    const targetError = targetErrorFromObservations({
      connectConversationObservation,
      localConversationObservation,
      connectObservationError: targetConnectObservationError,
      localObservationError,
      connectBaselineReliable,
      sentAt
    });
    const completionText = isSendMessageAck
      ? targetError
        ? targetError.message
        : connectFinalAvailable
        ? connectFinalText || "Antigravity Connect trajectory exposed a final target response."
        : connectBlocked
          ? "Antigravity Agent API accepted the delegated prompt, but the target cascade is blocked by a pending interaction."
          : "Antigravity Agent API accepted the delegated prompt; final target response remains in the Antigravity conversation."
      : normalized.text || "Antigravity Agent API completed the delegated prompt.";
    const stopReason = isSendMessageAck
      ? targetError
        ? "target_error"
        : connectFinalAvailable
        ? "completed"
        : "accepted"
      : normalized.stopReason || "completed";
    const externalCompletionState = isSendMessageAck
      ? targetError
        ? "target_error"
        : connectFinalAvailable
        ? "completed"
        : "accepted_only"
      : "completed";
    const baseCapabilitySnapshot = createAntigravityAgentApiCapabilitySnapshot({
      availableCommands: this.capabilitySnapshot.availableCommands,
      finalResponseCapabilityProbe: this.capabilityProbe?.finalResponseCapabilityProbe,
      completionState: externalCompletionState
    });
    const capabilitySnapshot = {
      ...baseCapabilitySnapshot,
      finalResponsePolicy: connectFinalAvailable ? "connect_trajectory" : baseCapabilitySnapshot.finalResponsePolicy,
      ideCli: this.ideCliCapabilitySnapshot,
      connect: {
        enabled: this.config.connectEnabled === true,
        trajectoryReadSupported: Boolean(connectConversationObservation),
        waitForFinalResponseRequested: this.config.connectWaitForFinalResponse !== false,
        queueFlushRequested: this.config.connectFlushQueuedMessages === true,
        denyPendingCommandInteractionsRequested: this.config.connectDenyPendingCommandInteractions === true,
        forceStopRequested: this.config.connectForceStopStuckCascade === true
      }
    };
    this.capabilitySnapshot = capabilitySnapshot;
    return {
      ok: true,
      updates: [acceptedUpdate],
      reasoning: normalizeReasoning(normalized),
      stopReason,
      text: completionText,
      externalCompletionState,
      finalResponseAvailable: connectFinalAvailable || (!isSendMessageAck && externalCompletionState === "completed"),
      finalResponsePolicy: targetError ? "target_error" : capabilitySnapshot.finalResponsePolicy,
      targetError,
      agentApiCapabilitySnapshot: capabilitySnapshot,
      localConversationObservation,
      localObservationError,
      connectConversationObservation,
      connectObservationError,
      targetSessionId: this.conversationId,
      targetResumeRef: this.conversationId,
      conversation,
      events: [
        acceptedUpdate,
        ...normalizeEvents(normalized),
        {
          type: "completion",
          stopReason,
          text: completionText,
          conversationId: this.conversationId,
          recipientId: normalized.recipientId || this.conversationId,
          model: normalized.model || this.config.model,
          targetError,
          localConversationObservation,
          connectConversationObservation
        }
      ],
      externalResponse: response.response || response,
      normalizedResponse: normalized
    };
  }

  async cancel() {
    return {
      ok: true,
      cancelledAt: nowIso(),
      note: "Antigravity Agent API does not expose cancel through agentapi; relay session was cancelled locally."
    };
  }

  async close() {
    this.closed = true;
    return {
      ok: true,
      closedAt: nowIso(),
      note: "Antigravity Agent API conversation remains available for later resume."
    };
  }
}

export function createAntigravityAgentApiConnection(options = {}) {
  return new AntigravityAgentApiConnection(options);
}
