<script setup lang="ts">
import { computed } from "vue";
import { knowledgeReviewCanResolveWithDocument } from "../../composables/console-knowledge-review-utils";
import { useApprovalFlowViewContext } from "../../composables/approvalFlowViewContext";
import { currentConsoleLocale, localizeConsoleText, resolveEffectiveConsoleLocale } from "../../i18n/console";

const {
  acceptKnowledgeReview,
  approvalFlowCards,
  approveAuthorization,
  authorizationBusy,
  fuseKnowledgeReviewItem,
  keepBothKnowledgeReview,
  rejectAuthorization,
  rejectKnowledgeReview,
  replaceKnowledgeReview,
  reviewBusy,
  reviewFusionDisabled,
  reviewKeepBothDisabled,
} = useApprovalFlowViewContext();

const approvalFlowLocale = computed(() => resolveEffectiveConsoleLocale(currentConsoleLocale.value));
const emptyAuthorizationTitle = computed(() => localizeConsoleText("没有待处理的授权请求", approvalFlowLocale.value));
const emptyApprovalDescription = computed(() =>
  localizeConsoleText("当前没有需要人工处理的审批事项。", approvalFlowLocale.value),
);
</script>

<template>
  <div class="approval-card-list">
    <article
      v-for="card in approvalFlowCards"
      :key="card.key"
      :id="`approval-${card.key}`"
      class="approval-request-card"
      :data-tone="card.tone"
    >
      <header class="approval-request-card-header">
        <div>
          <span class="approval-request-card-label">{{ card.label }}</span>
          <strong>{{ card.title }}</strong>
        </div>
        <div class="approval-request-card-meta">
          <span v-for="item in card.meta" :key="`${card.key}:${item}`">{{ item }}</span>
        </div>
      </header>
      <p>{{ card.summary }}</p>

      <div
        v-if="card.kind === 'authorization' && card.request.status === 'pending'"
        class="approval-request-card-actions"
      >
        <button
          class="configuration-alert-action"
          type="button"
          :disabled="authorizationBusy(card.request)"
          @click="approveAuthorization(card.request)"
        >
          批准
        </button>
        <button
          class="configuration-alert-action danger-action"
          type="button"
          :disabled="authorizationBusy(card.request)"
          @click="rejectAuthorization(card.request)"
        >
          拒绝
        </button>
      </div>

      <div
        v-else-if="card.kind === 'review' && card.review.status === 'pending'"
        class="approval-request-card-actions"
      >
        <template v-if="knowledgeReviewCanResolveWithDocument(card.review)">
          <button
            v-if="card.review.reason === 'source_path_content_conflict'"
            class="configuration-alert-action"
            type="button"
            :disabled="reviewBusy(card.review)"
            @click="replaceKnowledgeReview(card.review)"
          >
            覆盖旧知识
          </button>
          <button
            class="configuration-alert-action"
            type="button"
            :disabled="reviewKeepBothDisabled(card.review)"
            @click="keepBothKnowledgeReview(card.review)"
          >
            保留两者
          </button>
          <button
            class="configuration-alert-action"
            type="button"
            :disabled="reviewFusionDisabled(card.review)"
            @click="fuseKnowledgeReviewItem(card.review)"
          >
            知识融合
          </button>
        </template>
        <button
          v-else
          class="configuration-alert-action"
          type="button"
          :disabled="reviewBusy(card.review)"
          @click="acceptKnowledgeReview(card.review)"
        >
          接受
        </button>
        <button
          class="configuration-alert-action danger-action"
          type="button"
          :disabled="reviewBusy(card.review)"
          @click="rejectKnowledgeReview(card.review)"
        >
          放弃
        </button>
      </div>
    </article>

    <article v-if="approvalFlowCards.length === 0" class="approval-request-card approval-request-empty-card">
      <strong>{{ emptyAuthorizationTitle }}</strong>
      <span>{{ emptyApprovalDescription }}</span>
    </article>
  </div>
</template>
