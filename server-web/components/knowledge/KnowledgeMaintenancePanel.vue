<script setup lang="ts">
import ConfigFoldCard from "../ConfigFoldCard.vue";
import OptionBar from "../OptionBar.vue";
import SplitToggleCard from "../SplitToggleCard.vue";
import StatusPill from "../StatusPill.vue";
import { useKnowledgeMaintenanceContext } from "../../composables/knowledgeViewContext";

const {
  canAdminKnowledge,
  canMaintainKnowledge,
  connectKnowledgeBackendProvider,
  enabledStringOptionBarOptions,
  knowledgeBackendModeOptions,
  knowledgeBackendProviderCards,
  knowledgeBackendProviderForms,
  knowledgeConfigGroupDescription,
  knowledgeConsole,
  knowledgeLibraryBusy,
  knowledgeLibraryError,
  knowledgeSchema,
  maintenanceFieldValue,
  maintenanceJson,
  saveKnowledgeMaintenance,
  setMaintenanceFieldFromEvent,
  setMaintenanceFieldValue,
  isKnowledgeBackendCardExpanded,
  toggleKnowledgeBackendCard,
} = useKnowledgeMaintenanceContext();
</script>

<template>
  <section class="knowledge-maintenance">
    <p v-if="knowledgeLibraryError" class="module-note warning-note">{{ knowledgeLibraryError }}</p>

    <div class="knowledge-backend-config-list">
      <SplitToggleCard
        class="knowledge-backend-config-card"
        :expanded="isKnowledgeBackendCardExpanded('builtin')"
        expanded-label="收起内建知识库配置"
        collapsed-label="展开内建知识库配置"
        @toggle="toggleKnowledgeBackendCard('builtin')"
      >
        <template #summary>
          <div class="knowledge-card-toggle-content">
            <span class="knowledge-library-card-main">
              <strong>Pact Native</strong>
              <small>KnowledgeCore</small>
              <span class="knowledge-library-card-meta">
                <span>Pact</span>
                <span>internal</span>
                <span>{{ knowledgeConsole?.available ? "available" : "unavailable" }}</span>
              </span>
            </span>
            <span class="knowledge-library-card-status">
              <StatusPill tone="info" label="内建" />
              <StatusPill :tone="knowledgeConsole?.available ? 'success' : 'danger'" :label="knowledgeConsole?.available ? '可用' : '不可用'" />
            </span>
          </div>
        </template>
        <div v-for="group in knowledgeSchema?.groups || []" :key="group.id" class="config-group">
          <div class="config-group-header">
            <h4>{{ group.label }}</h4>
            <p v-if="knowledgeConfigGroupDescription(group.id)">{{ knowledgeConfigGroupDescription(group.id) }}</p>
          </div>
          <div class="form-grid compact-form-grid">
            <label v-for="field in group.fields" :key="field.name">
              <span
                class="field-label-with-tooltip"
                :class="{ 'has-tooltip': field.description }"
                :title="field.description || undefined"
              >
                {{ field.label }}
              </span>
              <input
                v-if="field.type === 'number'"
                :value="maintenanceFieldValue(field.name, field.defaultValue)"
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.step || 1"
                @input="setMaintenanceFieldFromEvent(field.name, $event, 'number')"
              />
              <OptionBar
                v-else-if="field.type === 'boolean'"
                :model-value="maintenanceFieldValue(field.name, field.defaultValue) ? 'true' : 'false'"
                :options="enabledStringOptionBarOptions"
                @update:model-value="setMaintenanceFieldValue(field.name, $event === 'true')"
              />
              <input
                v-else
                :value="String(maintenanceFieldValue(field.name, field.defaultValue) ?? '')"
                type="text"
                @input="setMaintenanceFieldFromEvent(field.name, $event, 'string')"
              />
            </label>
          </div>
        </div>
        <ConfigFoldCard title="高级 JSON Diff">
          <label class="json-editor">
            <span>只在需要精确修改服务端配置对象时展开</span>
            <textarea v-model="maintenanceJson" rows="10" spellcheck="false" />
          </label>
        </ConfigFoldCard>
        <div class="source-actions">
          <button class="primary-action" type="button" :disabled="!canAdminKnowledge" @click="saveKnowledgeMaintenance">
            保存配置
          </button>
        </div>
      </SplitToggleCard>

      <SplitToggleCard
        v-for="backend in knowledgeBackendProviderCards"
        :key="backend.provider"
        class="knowledge-backend-config-card"
        :expanded="isKnowledgeBackendCardExpanded(backend.provider)"
        :expanded-label="`收起 ${backend.title}`"
        :collapsed-label="`展开 ${backend.title}`"
        @toggle="toggleKnowledgeBackendCard(backend.provider)"
      >
        <template #summary>
          <div class="knowledge-card-toggle-content">
            <span class="knowledge-library-card-main">
              <strong>{{ backend.title }}</strong>
              <small>{{ backend.description }}</small>
              <span class="knowledge-library-card-meta">
                <span v-for="item in backend.meta" :key="`${backend.provider}:${item}`">{{ item }}</span>
              </span>
            </span>
            <span class="knowledge-library-card-status">
              <StatusPill tone="warning" label="外部" />
              <StatusPill :tone="backend.statusTone" :label="backend.statusLabel" />
            </span>
          </div>
        </template>
        <div class="knowledge-library-detail-grid">
          <div
            v-for="detail in backend.details"
            :key="`${backend.provider}:${detail.label}`"
          >
            <span>{{ detail.label }}</span>
            <strong>{{ detail.value }}</strong>
          </div>
        </div>
        <div class="form-grid compact-form-grid knowledge-backend-provider-form">
          <OptionBar
            label="连接模式"
            :model-value="knowledgeBackendProviderForms[backend.provider].mode"
            :options="knowledgeBackendModeOptions"
            @update:model-value="knowledgeBackendProviderForms[backend.provider].mode = String($event)"
          />
          <label>
            <span>Secret Ref</span>
            <input
              v-model="knowledgeBackendProviderForms[backend.provider].secretRef"
              autocomplete="off"
              placeholder="secret://pact/knowledge/provider-api-key"
            />
          </label>
          <label>
            <span>Endpoint Ref</span>
            <input
              v-model="knowledgeBackendProviderForms[backend.provider].endpointRef"
              autocomplete="off"
              placeholder="config://pact/knowledge/provider-endpoint"
            />
          </label>
        </div>
        <div class="source-actions">
          <button
            class="primary-action"
            type="button"
            :disabled="!canMaintainKnowledge || knowledgeLibraryBusy !== ''"
            @click="connectKnowledgeBackendProvider(backend.provider)"
          >
            {{ knowledgeLibraryBusy === `backend:${backend.provider}` ? "连接中" : "保存配置" }}
          </button>
        </div>
      </SplitToggleCard>
    </div>
  </section>
</template>
