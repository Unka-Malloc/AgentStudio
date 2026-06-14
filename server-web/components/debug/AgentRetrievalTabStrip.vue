<script setup lang="ts">
import { computed } from "vue";
import PactTabs, { type PactTab } from "../PactTabs.vue";
import { useAgentRetrievalViewContext } from "../../composables/agentRetrievalViewContext";
import {
  agentExploreTabMeta,
  agentExploreTabTitle,
} from "../../composables/console-agent-explore-presentation";

const {
  agentRetrievalTabs: {
    agentExploreActiveTabId,
    agentExploreTabBusy,
    agentExploreTabs,
    closeAgentExploreTab,
    isAgentExploreDraftSession,
    switchAgentExploreTab,
  },
} = useAgentRetrievalViewContext();

const tabs = computed<PactTab[]>(() =>
  agentExploreTabs.value.map((session) => ({
    key: session.runId,
    label: agentExploreTabTitle(session),
    meta: agentExploreTabMeta(session),
    closable: true,
    disabled: agentExploreTabBusy(session),
    draft: isAgentExploreDraftSession(session),
  })),
);

function handleChange(key: string) {
  const session = agentExploreTabs.value.find((s) => s.runId === key);
  if (session) switchAgentExploreTab(session);
}

function handleClose(key: string) {
  const session = agentExploreTabs.value.find((s) => s.runId === key);
  if (session) closeAgentExploreTab(session);
}
</script>

<template>
  <PactTabs
    v-if="agentExploreTabs.length"
    :model-value="agentExploreActiveTabId"
    :tabs="tabs"
    variant="card"
    size="small"
    :scrollable="true"
    aria-label="智能检索会话"
    @change="handleChange"
    @close="handleClose"
  />
</template>
