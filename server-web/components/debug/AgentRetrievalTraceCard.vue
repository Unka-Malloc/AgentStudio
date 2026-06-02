<script setup lang="ts">
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";
import {
  agentExploreEventLabel,
  agentExploreEventStatus,
  agentExploreResultKey,
  agentExploreStepSummary,
  shortId,
} from "../../composables/console-agent-explore-presentation";
import { jsonPreview } from "../../composables/console-format-utils";

const {
  agentRetrievalTrace: {
    agentExploreEventTime,
    agentExploreStepOpen,
    agentExploreSteps,
    agentExploreTraceOpen,
    agentExploreWorkspaceId,
    busyKey,
    handleAgentExploreTraceToggle,
  },
} = useAgentRetrievalViewContext();
</script>

<template>
  <details
    class="agent-explore-trace-card"
    :open="agentExploreTraceOpen"
    @toggle="handleAgentExploreTraceToggle"
  >
    <summary>
      <span>工具轨迹</span>
      <small>
        {{ agentExploreSteps.length }} 轮<span v-if="agentExploreWorkspaceId"> · Workspace {{ shortId(agentExploreWorkspaceId) }}</span>
      </small>
    </summary>
    <div class="agent-explore-trace-list">
      <div v-if="busyKey === 'knowledge:agent-explore'" class="empty-note">模型正在选择本地工具。</div>
      <details
        v-for="step in agentExploreSteps"
        :key="`agent-explore-step-${step.iteration}`"
        class="agent-explore-step"
        :open="agentExploreStepOpen(step)"
      >
        <summary class="agent-explore-step-header">
          <strong>第 {{ step.iteration }} 轮</strong>
          <span>{{ agentExploreStepSummary(step) }}</span>
        </summary>
        <div
          v-if="step.events?.length || step.toolCalls?.length || step.toolResults?.length || step.contextBudget"
          class="agent-explore-step-body"
        >
          <div v-if="step.events?.length" class="agent-state-timeline">
            <div
              v-for="(eventItem, eventIndex) in step.events"
              :key="`agent-explore-event-${step.iteration}-${eventIndex}`"
              class="agent-state-event"
              :data-state="agentExploreEventStatus(eventItem)"
            >
              <span>{{ agentExploreEventLabel(eventItem) }}</span>
              <small>{{ agentExploreEventTime(eventItem) }}</small>
            </div>
          </div>
          <details
            v-for="call in step.toolCalls || []"
            :key="call.id"
            class="agent-function-call"
            :data-state="call.status || 'selected'"
          >
            <summary>
              <strong>{{ call.name }}</strong>
              <span>{{ call.status || "selected" }}</span>
            </summary>
            <pre>{{ jsonPreview(call.arguments || {}) }}</pre>
          </details>
          <details
            v-for="(toolResult, toolResultIndex) in step.toolResults || []"
            :key="agentExploreResultKey(step, toolResult, toolResultIndex)"
            class="agent-tool-result"
            :data-state="toolResult.status || 'completed'"
          >
            <summary>
              <strong>{{ toolResult.tool }}</strong>
              <span>{{ toolResult.status || "completed" }}</span>
            </summary>
            <pre v-if="toolResult.result">{{ jsonPreview(toolResult.result || {}) }}</pre>
            <div v-else class="empty-note">工具调用中，等待返回。</div>
          </details>
          <small v-if="step.contextBudget">
            上下文 {{ step.contextBudget.totalTokens || 0 }} /
            {{ step.contextBudget.contextWindowTokens || 0 }}
          </small>
        </div>
      </details>
    </div>
  </details>
</template>
