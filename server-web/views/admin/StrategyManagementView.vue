<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import PactTabs, { type PactTab } from "../../components/PactTabs.vue";
import { usePageRefreshHandler } from "../../composables/usePageRefresh";
import {
  loadStrategyManagementRuntime,
  strategyManagementGroups,
  strategyManagementTotals,
  type StrategyManagementRuntime,
} from "../../lib/strategy-management";

const activeGroupId = ref(strategyManagementGroups[0]?.id || "queue");
const runtime = ref<StrategyManagementRuntime | null>(null);
const runtimeLoading = ref(false);
const runtimeError = ref("");
const activeGroup = computed(
  () => strategyManagementGroups.find((group) => group.id === activeGroupId.value) || strategyManagementGroups[0],
);
const sectionTabs = computed<PactTab[]>(() =>
  strategyManagementGroups.map((group) => ({
    key: group.id,
    label: group.label,
    meta: String(group.policies.length),
  })),
);
const totals = computed(() => strategyManagementTotals());
const activePolicies = computed(() => activeGroup.value?.policies || []);
const runtimeCapabilityCount = computed(() => runtime.value?.description?.capabilities?.length || 0);
const runtimeHealthyProbeCount = computed(
  () => runtime.value?.probes.filter((probe) => !probe.error && probe.decision).length || 0,
);

async function refreshStrategyManagement() {
  runtimeLoading.value = true;
  runtimeError.value = "";
  try {
    runtime.value = await loadStrategyManagementRuntime();
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : "策略运行时加载失败。";
  } finally {
    runtimeLoading.value = false;
  }
}

onMounted(() => {
  void refreshStrategyManagement();
});

usePageRefreshHandler(
  (detail) => detail.viewId === "admin" && detail.adminView === "strategyManagement",
  refreshStrategyManagement,
);
</script>

<template>
  <section class="strategy-management-layout">
    <header class="strategy-management-header">
      <PactTabs
        v-model="activeGroupId"
        :tabs="sectionTabs"
        variant="line"
        size="default"
        scrollable
        aria-label="策略管理"
      />
    </header>

    <section class="surface-card strategy-summary-card">
      <div class="strategy-summary-metrics">
        <div>
          <span>策略域</span>
          <strong>{{ totals.groups }}</strong>
        </div>
        <div>
          <span>策略项</span>
          <strong>{{ totals.policies }}</strong>
        </div>
        <div>
          <span>运行能力</span>
          <strong>{{ runtimeCapabilityCount }}</strong>
        </div>
        <div>
          <span>评估样例</span>
          <strong>{{ runtimeHealthyProbeCount }}</strong>
        </div>
      </div>
    </section>

    <section class="surface-card strategy-runtime-card">
      <div class="section-header">
        <div>
          <h3>策略运行时</h3>
          <p>{{ runtime?.description?.protocolVersion || "未加载协议能力" }}</p>
        </div>
        <button class="table-action" type="button" :disabled="runtimeLoading" @click="refreshStrategyManagement">
          {{ runtimeLoading ? "刷新中" : "刷新" }}
        </button>
      </div>
      <div v-if="runtimeError" class="inline-alert">{{ runtimeError }}</div>
      <div class="strategy-runtime-probes">
        <div v-for="probe in runtime?.probes || []" :key="probe.id">
          <span>{{ probe.label }}</span>
          <strong>{{ probe.error || probe.decision?.effect || "未评估" }}</strong>
          <small>{{ probe.decision?.policyType || probe.decision?.reasonCode || probe.error }}</small>
        </div>
      </div>
      <div class="strategy-runtime-capabilities">
        <span v-for="capability in runtime?.description?.capabilities || []" :key="capability">
          {{ capability }}
        </span>
      </div>
    </section>

    <section class="strategy-group-intro">
      <h3>{{ activeGroup?.label }}</h3>
      <p>{{ activeGroup?.description }}</p>
    </section>

    <section class="strategy-policy-grid">
      <article
        v-for="policy in activePolicies"
        :key="policy.id"
        class="surface-card strategy-policy-card"
      >
        <div class="strategy-policy-card-header">
          <div>
            <h4>{{ policy.label }}</h4>
            <p>{{ policy.summary }}</p>
          </div>
          <span>{{ policy.state }}</span>
        </div>
        <dl class="strategy-policy-meta">
          <div>
            <dt>归属</dt>
            <dd>{{ policy.owner }}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{{ policy.source }}</dd>
          </div>
        </dl>
        <div class="strategy-policy-signals">
          <span v-for="signal in policy.signals" :key="signal">{{ signal }}</span>
        </div>
        <a class="table-action strategy-policy-link" :href="policy.route">
          {{ policy.routeLabel }}
        </a>
      </article>
    </section>
  </section>
</template>

<style scoped>
.strategy-management-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.strategy-management-header {
  border-bottom: 1px solid var(--border-subtle);
}

.strategy-summary-card {
  padding: var(--space-4);
}

.strategy-summary-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

.strategy-summary-metrics > div {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.strategy-summary-metrics span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.strategy-summary-metrics strong {
  color: var(--text-primary);
  font-size: var(--text-lg);
}

.strategy-runtime-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.strategy-runtime-card > .section-header {
  margin-bottom: 0;
}

.strategy-runtime-probes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.strategy-runtime-probes > div {
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.strategy-runtime-probes span,
.strategy-runtime-probes small {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.strategy-runtime-probes strong {
  display: block;
  margin: var(--space-1) 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
}

.strategy-runtime-capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.strategy-runtime-capabilities span {
  min-height: 24px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

.strategy-group-intro h3 {
  margin: 0;
  color: var(--brand);
  font-size: var(--text-xl);
}

.strategy-group-intro p {
  margin: var(--space-1) 0 0;
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
}

.strategy-policy-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
}

.strategy-policy-grid > .strategy-policy-card {
  margin-top: 0;
}

.strategy-policy-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 240px;
}

.strategy-policy-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.strategy-policy-card-header h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
}

.strategy-policy-card-header p {
  margin: var(--space-1) 0 0;
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
}

.strategy-policy-card-header > span {
  flex: 0 0 auto;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

.strategy-policy-meta {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}

.strategy-policy-meta div {
  min-width: 0;
}

.strategy-policy-meta dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

.strategy-policy-meta dd {
  margin: var(--space-0-5) 0 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.strategy-policy-signals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.strategy-policy-signals span {
  min-height: 24px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

.strategy-policy-link {
  align-self: flex-start;
  margin-top: auto;
}

@media (max-width: 1180px) {
  .strategy-policy-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .strategy-summary-metrics,
  .strategy-runtime-probes,
  .strategy-policy-grid {
    grid-template-columns: 1fr;
  }

  .strategy-policy-card-header {
    flex-direction: column;
  }
}
</style>
