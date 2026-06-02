<script setup lang="ts">
import { useServerConsoleShellContext } from '../composables/serverConsoleShellContext';
import { createFeedViewContext, provideFeedView } from '../composables/feedViewContext';
import InfoFeedConversationPanel from '../components/feed/InfoFeedConversationPanel.vue';

const { feedConsole } = useServerConsoleShellContext();
const feedView = createFeedViewContext(feedConsole);
provideFeedView(feedView);
</script>

<template>
  <InfoFeedConversationPanel />
</template>
