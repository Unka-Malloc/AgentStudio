import type { Ref } from "vue";
import type { AgentExploreRunResponse } from "../lib/types";
import { createConsoleAgentExploreDocumentController } from "./console-agent-explore-document-controller";
import { createConsoleAgentExploreResultController } from "./console-agent-explore-result-controller";
import {
  type AgentExploreFormState,
} from "./console-agent-explore-utils";
import { createConsoleKnowledgeFeedbackController } from "./console-knowledge-feedback-controller";

type ReadonlyRef<T> = {
  readonly value: T;
};

type ConsoleAgentExploreOutputControllerOptions = {
  agentExploreForm: Ref<AgentExploreFormState>;
  agentExploreResult: Ref<AgentExploreRunResponse | null>;
  busyKey: ReadonlyRef<string>;
  error: Ref<string>;
  infoFeedQuery: () => string;
  infoFeedRunId: () => string;
  knowledgeSearchQuery: () => string;
};

export function createConsoleAgentExploreOutputController(
  options: ConsoleAgentExploreOutputControllerOptions,
) {
  const result = createConsoleAgentExploreResultController({
    agentExploreForm: options.agentExploreForm,
    agentExploreResult: options.agentExploreResult,
    busyKey: options.busyKey,
  });
  const feedback = createConsoleKnowledgeFeedbackController({
    agentExploreResult: options.agentExploreResult,
    currentAgentExploreQuery: result.currentAgentExploreQuery,
    infoFeedQuery: options.infoFeedQuery,
    infoFeedRunId: options.infoFeedRunId,
    knowledgeSearchQuery: options.knowledgeSearchQuery,
  });
  const document = createConsoleAgentExploreDocumentController({
    agentExploreEvidenceRefs: result.agentExploreEvidenceRefs,
    agentExploreForm: options.agentExploreForm,
    agentExploreResult: options.agentExploreResult,
    agentExploreRunInput: result.agentExploreRunInput,
    error: options.error,
    agentExploreContextBuildRecordId: result.agentExploreContextBuildRecordId,
    currentAgentExploreQuery: result.currentAgentExploreQuery,
    recordFeedback: feedback.recordConsoleKnowledgeFeedback,
  });

  return {
    ...result,
    ...feedback,
    ...document,
  };
}
