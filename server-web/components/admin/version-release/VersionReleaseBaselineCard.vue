<script setup lang="ts">
import { computed } from "vue";
import StatusPill from "../../StatusPill.vue";
import { statusTone } from "../../../lib/production-health";
import type { V001BaselineStatus } from "../../../lib/version-release";

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
  <article class="surface-card version-release-baseline-card">
    <div class="section-header">
      <div>
        <h3>v0.0.1 基线</h3>
        <p>展示单机运行基线、五类 MCP 出口和本地通用切面状态。</p>
      </div>
    </div>
    <div class="version-release-baseline-summary">
      <div class="version-release-baseline-status">
        <span>基线状态</span>
        <StatusPill :tone="statusTone(baseline?.status === 'ready' ? 'pass' : 'missing')" :label="baseline?.status || '未读取'" />
      </div>
      <dl>
        <div>
          <dt>协议版本</dt>
          <dd>{{ baseline?.protocolVersion || "v0.0.1:platform:baseline-1" }}</dd>
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
    <div class="detail-metrics version-release-metrics">
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
    <div class="version-release-token-list">
      <span v-for="outlet in baseline?.mcpOutlets || []" :key="outlet">{{ outlet }}</span>
    </div>
    <div class="version-release-token-list">
      <span v-for="port in baselinePortLabels" :key="port.id">{{ port.label }} · {{ port.value }}</span>
    </div>
    <dl class="module-status-list version-release-meta">
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
.version-release-baseline-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.version-release-baseline-card > .section-header {
  margin-bottom: 0;
}

.version-release-baseline-summary {
  display: grid;
  grid-template-columns: minmax(180px, 0.45fr) minmax(0, 1fr);
  gap: var(--space-3);
  align-items: stretch;
}

.version-release-baseline-status,
.version-release-baseline-summary dl {
  min-width: 0;
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.version-release-baseline-status {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3);
}

.version-release-baseline-status > span,
.version-release-baseline-summary dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.version-release-baseline-summary dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, 0.42fr);
  overflow: hidden;
}

.version-release-baseline-summary dl > div {
  min-width: 0;
  padding: var(--space-3);
}

.version-release-baseline-summary dl > div + div {
  border-inline-start: 1px solid var(--border-subtle);
}

.version-release-baseline-summary dd {
  min-width: 0;
  margin: var(--space-1) 0 0;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.version-release-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.version-release-meta {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.version-release-token-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.version-release-token-list span {
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
  .version-release-metrics,
  .version-release-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .version-release-baseline-summary {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .version-release-metrics,
  .version-release-meta,
  .version-release-baseline-summary dl {
    grid-template-columns: 1fr;
  }

  .version-release-baseline-summary dl > div + div {
    border-inline-start: 0;
    border-top: 1px solid var(--border-subtle);
  }
}
</style>
