<script setup lang="ts">
import ApprovalFlowCardList from '../components/approval/ApprovalFlowCardList.vue';
import SegmentedToggle from '../components/SegmentedToggle.vue';
import { provideApprovalFlowView } from '../composables/approvalFlowViewContext';
import { useApprovalFlowViewController } from '../composables/console-approval-flow-view-controller';

const approvalFlow = useApprovalFlowViewController();
provideApprovalFlowView(approvalFlow);
const {
  approvalFlowStatus,
  mcpAuthorizationStatusOptionBarOptions,
} = approvalFlow;
</script>

<template>
  <section class="dashboard-view approval-flow-view">
    <article class="surface-card configuration-alert-card">
      <div class="section-header">
        <div>
          <h3>全平台审批流</h3>
          <p>统一处理需要人工决策的事项。</p>
        </div>
        <div class="source-actions">
          <SegmentedToggle
            v-model="approvalFlowStatus"
            :options="mcpAuthorizationStatusOptionBarOptions"
            aria-label="审批流状态"
            size="small"
          />
        </div>
      </div>

      <ApprovalFlowCardList />
    </article>
  </section>
</template>
