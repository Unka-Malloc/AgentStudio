<script setup lang="ts">
import { onMounted, ref } from "vue";
import ProductionBaselineCard from "../../components/admin/production-health/ProductionBaselineCard.vue";
import ProductionCoverageWarning from "../../components/admin/production-health/ProductionCoverageWarning.vue";
import ProductionGateTable from "../../components/admin/production-health/ProductionGateTable.vue";
import ProductionHealthBottomGrid from "../../components/admin/production-health/ProductionHealthBottomGrid.vue";
import ProductionHealthHeroCard from "../../components/admin/production-health/ProductionHealthHeroCard.vue";
import ProductionSectionGrid from "../../components/admin/production-health/ProductionSectionGrid.vue";
import { usePageRefreshHandler } from "../../composables/usePageRefresh";
import {
  loadProductionHealthSnapshot,
  type ProductionHealthResponse,
  type V001BaselineStatus,
} from "../../lib/production-health";

const health = ref<ProductionHealthResponse | null>(null);
const baseline = ref<V001BaselineStatus | null>(null);
const loading = ref(false);
const loadError = ref("");
const baselineError = ref("");

async function refreshProductionHealth() {
  loading.value = true;
  loadError.value = "";
  baselineError.value = "";
  try {
    const snapshot = await loadProductionHealthSnapshot();
    if (snapshot.health !== undefined) {
      health.value = snapshot.health;
    }
    if (snapshot.baseline !== undefined) {
      baseline.value = snapshot.baseline;
    }
    loadError.value = snapshot.loadError || "";
    baselineError.value = snapshot.baselineError || "";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refreshProductionHealth();
});

usePageRefreshHandler(
  (detail) => detail.viewId === "admin" && detail.adminView === "productionHealth",
  refreshProductionHealth,
);
</script>

<template>
  <section class="production-health-layout">
    <ProductionHealthHeroCard :health="health" :load-error="loadError" />
    <ProductionBaselineCard :baseline="baseline" :baseline-error="baselineError" />
    <ProductionCoverageWarning
      v-if="health?.coverage.missing.length"
      :missing="health.coverage.missing"
    />
    <ProductionSectionGrid :sections="health?.sections || []" />
    <ProductionGateTable :gates="health?.gates || []" />
    <ProductionHealthBottomGrid
      :actions="health?.actions || []"
      :history="health?.history || []"
    />
  </section>
</template>

<style scoped>
.production-health-layout {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
