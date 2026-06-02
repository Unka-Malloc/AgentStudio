<script setup lang="ts">
import { computed } from "vue";
import StatusPill from "../../StatusPill.vue";
import { statusTone, type V001BaselineStatus } from "../../../lib/production-health";

const props = defineProps<{
  baseline: V001BaselineStatus | null;
  baselineError: string;
}>();

const baselinePortLabels = computed(() => (props.baseline?.ports || []).map((port) => ({
  id: port.port,
  label: port.port,
  value: port.verificationMode || port.implementation,
})));
</script>

<template>
  <article class="surface-card production-baseline-card">
    <div class="section-header">
      <div>
        <h3>v0.0.1 基线</h3>
        <p>展示单机运行基线、五类 MCP 出口和本地通用切面状态。</p>
      </div>
    </div>
    <div class="production-baseline-summary">
      <div class="production-baseline-status">
        <span>基线状态</span>
        <StatusPill :tone="statusTone(baseline?.status === 'ready' ? 'pass' : 'missing')" :label="baseline?.status || '未读取'" />
      </div>
      <dl>
        <div>
          <dt>协议版本</dt>
          <dd>{{ baseline?.protocolVersion || "pact.v001.baseline.v1" }}</dd>
        </div>
        <div>
          <dt>验证模式</dt>
          <dd>{{ baseline?.verificationMode || "等待加载" }}</dd>
        </div>
      </dl>
    </div>
    <div v-if="baselineError" class="status-strip danger">
      <strong>读取失败</strong>
      <span>{{ baselineError }}</span>
    </div>
    <div class="detail-metrics production-health-metrics">
      <div>
        <span>MCP 出口</span>
        <strong>{{ baseline?.mcpOutlets.length || 0 }}</strong>
      </div>
      <div>
        <span>通用切面</span>
        <strong>{{ baseline?.ports.length || 0 }}</strong>
      </div>
      <div>
        <span>状态语义</span>
        <strong>{{ baseline?.storageStates.length || 0 }}</strong>
      </div>
      <div>
        <span>Secret 模式</span>
        <strong>{{ baseline?.ports.find((port) => port.port === 'SecretStorePort')?.verificationMode || "unknown" }}</strong>
      </div>
    </div>
    <div class="production-token-list">
      <span v-for="outlet in baseline?.mcpOutlets || []" :key="outlet">{{ outlet }}</span>
    </div>
    <div class="production-token-list">
      <span v-for="port in baselinePortLabels" :key="port.id">{{ port.label }} · {{ port.value }}</span>
    </div>
    <dl class="module-status-list production-health-meta">
      <div>
        <dt>运行配置</dt>
        <dd>{{ baseline?.rootPath || "ServerConfig.getDataDir()/v001-baseline" }}</dd>
      </div>
      <div>
        <dt>外部状态</dt>
        <dd>{{ baseline?.boundaries.externalState || "contract-mode adapters" }}</dd>
      </div>
    </dl>
  </article>
</template>

<style scoped>
.production-baseline-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.production-baseline-card > .section-header {
  margin-bottom: 0;
}

.production-baseline-summary {
  display: grid;
  grid-template-columns: minmax(180px, 0.45fr) minmax(0, 1fr);
  gap: var(--space-3);
  align-items: stretch;
}

.production-baseline-status,
.production-baseline-summary dl {
  min-width: 0;
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.production-baseline-status {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3);
}

.production-baseline-status > span,
.production-baseline-summary dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.production-baseline-summary dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, 0.42fr);
  overflow: hidden;
}

.production-baseline-summary dl > div {
  min-width: 0;
  padding: var(--space-3);
}

.production-baseline-summary dl > div + div {
  border-inline-start: 1px solid var(--border-subtle);
}

.production-baseline-summary dd {
  min-width: 0;
  margin: var(--space-1) 0 0;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.production-health-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.production-health-meta {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.production-token-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.production-token-list span {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

@media (max-width: 1120px) {
  .production-health-metrics,
  .production-health-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .production-baseline-summary {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .production-health-metrics,
  .production-health-meta,
  .production-baseline-summary dl {
    grid-template-columns: 1fr;
  }

  .production-baseline-summary dl > div + div {
    border-inline-start: 0;
    border-top: 1px solid var(--border-subtle);
  }
}
</style>
