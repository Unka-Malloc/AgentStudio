<script setup lang="ts">
import { computed } from "vue";
import type { ProductionHealthResponse } from "../../../lib/production-health";
import { formatDateTime } from "../../../lib/production-health";

const props = defineProps<{
  health: ProductionHealthResponse | null;
  loadError: string;
}>();

const reportGeneratedAt = computed(() =>
  formatDateTime(props.health?.latestReport?.generatedAt || props.health?.generatedAt || ""),
);
const latestCommit = computed(() => {
  const commit = props.health?.latestReport?.git?.commit || "";
  return commit ? commit.slice(0, 12) : "unknown";
});
const capabilityKernel = computed(() => props.health?.capabilityKernel || null);
const capabilityBindingGuard = computed(() => props.health?.capabilityBindingGuard || null);
</script>

<template>
  <article class="surface-card production-health-hero">
    <div class="section-header">
      <div>
        <h3>生产健康</h3>
        <p>汇总生产准入报告、质量门禁、运行时治理、权限安全、备份恢复和发版连续性状态。</p>
      </div>
      <div class="section-tags">
        <span>{{ health?.latestReport?.runId || "无报告" }}</span>
        <span>{{ reportGeneratedAt }}</span>
      </div>
    </div>

    <div v-if="loadError" class="status-strip danger">
      <strong>读取失败</strong>
      <span>{{ loadError }}</span>
    </div>

    <div class="detail-metrics production-health-metrics">
      <div>
        <span>通过门禁</span>
        <strong>{{ health?.summary.pass || 0 }}</strong>
      </div>
      <div>
        <span>失败门禁</span>
        <strong>{{ health?.summary.fail || 0 }}</strong>
      </div>
      <div>
        <span>超时门禁</span>
        <strong>{{ health?.summary.timeout || 0 }}</strong>
      </div>
      <div>
        <span>P0 阻塞</span>
        <strong>{{ health?.summary.blockedP0 || 0 }}</strong>
      </div>
    </div>

    <div v-if="capabilityKernel" :class="['status-strip', capabilityKernel.degraded ? 'warning' : capabilityKernel.ok ? 'success' : 'danger']">
      <strong>Capability Kernel</strong>
      <span>{{ capabilityKernel.securityMode || capabilityKernel.status }} · {{ capabilityKernel.message }}</span>
    </div>

    <div v-if="capabilityBindingGuard" :class="['status-strip', capabilityBindingGuard.degraded ? 'warning' : capabilityBindingGuard.ok ? 'success' : 'danger']">
      <strong>Binding Guard</strong>
      <span>{{ capabilityBindingGuard.securityMode || capabilityBindingGuard.status }} · {{ capabilityBindingGuard.message }}</span>
    </div>

    <dl class="module-status-list production-health-meta">
      <div>
        <dt>报告目录</dt>
        <dd>{{ health?.reportRoot || "docs/reports/history/production-readiness" }}</dd>
      </div>
      <div>
        <dt>分支</dt>
        <dd>{{ health?.latestReport?.git.branch || "unknown" }}</dd>
      </div>
      <div>
        <dt>提交</dt>
        <dd>{{ latestCommit }}</dd>
      </div>
      <div>
        <dt>脏文件</dt>
        <dd>{{ health?.latestReport?.git.dirtyFileCount ?? 0 }}</dd>
      </div>
      <div>
        <dt>权限内核</dt>
        <dd>{{ capabilityKernel?.provider || "unknown" }} / {{ capabilityKernel?.securityMode || "unknown" }}</dd>
      </div>
      <div>
        <dt>权限状态</dt>
        <dd>{{ capabilityKernel?.degraded ? "degraded" : capabilityKernel?.status || "unknown" }}</dd>
      </div>
      <div>
        <dt>权限绑定</dt>
        <dd>{{ capabilityKernel?.bindingCount ?? 0 }} keys / {{ capabilityKernel?.permissionBindingCount ?? 0 }} bindings</dd>
      </div>
      <div>
        <dt>恢复能力</dt>
        <dd>{{ capabilityKernel?.recoverySupported ? "recovery package" : "unavailable" }}</dd>
      </div>
      <div>
        <dt>绑定守卫</dt>
        <dd>{{ capabilityBindingGuard?.provider || "unknown" }} / {{ capabilityBindingGuard?.securityMode || "unknown" }}</dd>
      </div>
      <div>
        <dt>绑定状态</dt>
        <dd>{{ capabilityBindingGuard?.activeBindingCount ?? 0 }} active / {{ capabilityBindingGuard?.bindingCount ?? 0 }} total</dd>
      </div>
    </dl>
  </article>
</template>

<style scoped>
.production-health-hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.production-health-metrics,
.production-health-meta {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 1120px) {
  .production-health-metrics,
  .production-health-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .production-health-metrics,
  .production-health-meta {
    grid-template-columns: 1fr;
  }
}
</style>
