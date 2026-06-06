import type { ComputedRef, Ref } from "vue";
import { getKnowledgeAgentExploreRun } from "../lib/agent-explore-client";
import type { AgentExploreRunResponse } from "../lib/types";
import {
  agentExploreRunStatus,
  normalizeAgentExploreRun,
} from "./console-agent-explore-utils";
import { createConsoleIntervalController } from "./console-timer-controller";

type ConsoleAgentExplorePollingControllerOptions = {
  agentExploreResult: Ref<AgentExploreRunResponse | null>;
  busyKey: ComputedRef<string>;
  clearAllBusy: () => void;
  error: Ref<string>;
  persistAgentExploreState: () => void;
};

export function createConsoleAgentExplorePollingController(
  options: ConsoleAgentExplorePollingControllerOptions,
) {
  const agentExplorePolling = createConsoleIntervalController();

  function stopAgentExplorePolling() {
    agentExplorePolling.stop();
  }

  function startAgentExplorePolling(runId: string, workspaceId: string) {
    stopAgentExplorePolling();
    const poll = async () => {
      try {
        const result = normalizeAgentExploreRun(
          await getKnowledgeAgentExploreRun(runId, {
            workspaceId,
          }),
        );
        options.agentExploreResult.value = result;
        options.persistAgentExploreState();
        const status = agentExploreRunStatus(result);
        if (!["queued", "running"].includes(status)) {
          stopAgentExplorePolling();
          if (options.busyKey.value === "knowledge:agent-explore") {
            options.clearAllBusy();
          }
          if (result.ok === false && result.error) {
            options.error.value = result.error;
          }
        }
      } catch (nextError) {
        stopAgentExplorePolling();
        if (options.busyKey.value === "knowledge:agent-explore") {
          options.clearAllBusy();
        }
        options.error.value = nextError instanceof Error ? nextError.message : "智能检索状态刷新失败。";
      }
    };
    void poll();
    agentExplorePolling.start(() => {
      void poll();
    }, 750);
  }

  function currentAgentExplorePollTimer() {
    return agentExplorePolling.current();
  }

  return {
    currentAgentExplorePollTimer,
    startAgentExplorePolling,
    stopAgentExplorePolling,
  };
}
