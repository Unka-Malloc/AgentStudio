<script setup lang="ts">
import SplitToggleCard from "../SplitToggleCard.vue";
import StatusPill from "../StatusPill.vue";
import { useKnowledgeLibraryContext } from "../../composables/knowledgeViewContext";

const {
  isKnowledgeLibraryCardExpanded,
  knowledgeLibraryCards,
  knowledgeLibraryError,
  toggleKnowledgeLibraryCard,
} = useKnowledgeLibraryContext();
</script>

<template>
  <article class="surface-card knowledge-library-board">
    <div class="section-header">
      <div>
        <h3>知识库</h3>
      </div>
    </div>
    <p v-if="knowledgeLibraryError" class="module-note warning-note">{{ knowledgeLibraryError }}</p>
    <div v-if="knowledgeLibraryCards.length" class="knowledge-library-list">
      <SplitToggleCard
        v-for="library in knowledgeLibraryCards"
        :key="library.id"
        class="knowledge-library-card"
        :expanded="isKnowledgeLibraryCardExpanded(library.id)"
        :expanded-label="`收起 ${library.title}`"
        :collapsed-label="`展开 ${library.title}`"
        @toggle="toggleKnowledgeLibraryCard(library.id)"
      >
        <template #summary>
          <div class="knowledge-card-toggle-content">
            <span class="knowledge-library-card-main">
              <strong>{{ library.displayTitle }}</strong>
              <span class="knowledge-library-card-kind">{{ library.providerLabel }}</span>
            </span>
            <span class="knowledge-library-card-status">
              <StatusPill :tone="library.boundaryTone" :label="library.boundaryLabel" />
              <StatusPill :tone="library.statusTone" :label="library.statusLabel" />
            </span>
          </div>
        </template>
        <div class="knowledge-library-detail-grid">
          <div
            v-for="detail in library.details"
            :key="`${library.id}:${detail.label}`"
          >
            <span>{{ detail.label }}</span>
            <strong>{{ detail.value }}</strong>
          </div>
        </div>
      </SplitToggleCard>
    </div>
    <div v-else-if="!knowledgeLibraryError" class="knowledge-library-empty">
      <strong>暂无可用知识库</strong>
      <span>选择入库目标后，这里会显示边界、后端和索引状态。</span>
    </div>
  </article>
</template>
