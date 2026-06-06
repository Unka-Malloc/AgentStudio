<script setup lang="ts">
import { ref } from "vue";
import AgentModelOptionBar from "../AgentModelOptionBar.vue";
import BrowseSelectButton from "../BrowseSelectButton.vue";
import ConfigFoldCard from "../ConfigFoldCard.vue";
import OptionBar from "../OptionBar.vue";
import { infoFeedStatusLabel, infoFeedStatusTone } from "../../composables/console-info-feed-shared-utils";
import { useFeedViewContext } from "../../composables/feedViewContext";

const {
  agentSelectorOptions,
  busyKey,
  contextWindowOptionBarOptions,
  handleInfoFeedAttachmentFiles,
  infoFeedAttachments,
  infoFeedCurrentRun,
  infoFeedForm,
  infoFeedInputPlaceholder,
  infoFeedModelOptions,
  infoFeedSubmitLabel,
  removeInfoFeedAttachment,
  runInfoFeed,
  saveSettings,
  selectedInfoFeedModel,
  settingsDraft,
  thinkingModeOptionBarOptions,
} = useFeedViewContext();

const advancedOptionsOpen = ref(false);
</script>

<template>
  <div class="info-feed-input-stack">
    <form class="info-feed-input-dock" @submit.prevent="runInfoFeed">
      <div v-if="infoFeedAttachments.length" class="info-feed-attachment-chips">
        <span
          v-for="attachment in infoFeedAttachments"
          :key="attachment.id"
          class="info-feed-attachment-chip"
          :data-tone="infoFeedStatusTone(attachment.status)"
        >
          {{ attachment.name }}
          <small>{{ infoFeedStatusLabel(attachment.status) }}</small>
          <button type="button" @click="removeInfoFeedAttachment(attachment.id)">×</button>
        </span>
      </div>
      <textarea
        v-model="infoFeedForm.query"
        rows="4"
        :placeholder="infoFeedInputPlaceholder"
      ></textarea>
      <div class="info-feed-input-actions">
        <BrowseSelectButton
          kind="local-files"
          button-class="tool-button tool-button-ghost info-feed-attachment-button"
          button-text="附件"
          :multiple="true"
          @select="handleInfoFeedAttachmentFiles"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          附件
        </BrowseSelectButton>
        <button
          class="tool-button tool-button-ghost info-feed-advanced-button"
          type="button"
          @click="advancedOptionsOpen = true"
        >
          高级选项
        </button>
        <AgentModelOptionBar
          v-model="infoFeedForm.modelAlias"
          label="智能体"
          placeholder="未分配智能体"
          :options="infoFeedModelOptions"
        />
        <button
          class="primary-action"
          type="submit"
          :disabled="!infoFeedForm.query.trim() || !selectedInfoFeedModel.enabled || infoFeedCurrentRun?.summary.status === 'running'"
        >
          {{ infoFeedSubmitLabel }}
        </button>
      </div>
    </form>
  </div>

  <div
    v-if="advancedOptionsOpen"
    class="info-feed-advanced-backdrop"
    @click.self="advancedOptionsOpen = false"
  >
    <section
      class="info-feed-advanced-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-feed-advanced-title"
    >
      <header class="info-feed-advanced-header">
        <div>
          <h3 id="info-feed-advanced-title">高级选项</h3>
          <span>配置用于信息流智能检索、知识融合和总结前置检索的默认参数。</span>
        </div>
        <button
          class="dialog-close-button"
          type="button"
          aria-label="关闭"
          title="关闭"
          @click="advancedOptionsOpen = false"
        >
          ×
        </button>
      </header>
      <form class="drawer-panel info-feed-advanced-form" @submit.prevent="saveSettings">
        <label>
          <span>系统提示词</span>
          <textarea v-model="settingsDraft.agentExploreDefaults.systemPrompt" rows="5" spellcheck="false"></textarea>
        </label>
        <label>
          <span>工具策略提示词</span>
          <textarea v-model="settingsDraft.agentExploreDefaults.toolPolicyPrompt" rows="4" spellcheck="false"></textarea>
        </label>
        <label>
          <span>继续轮次提示词</span>
          <textarea v-model="settingsDraft.agentExploreDefaults.continuationPrompt" rows="3" spellcheck="false"></textarea>
        </label>
        <label>
          <span>答案模板</span>
          <textarea v-model="settingsDraft.agentExploreDefaults.answerTemplate" rows="14" spellcheck="false"></textarea>
        </label>
        <div class="form-grid compact-form-grid">
          <OptionBar
            v-model="settingsDraft.agentExploreDefaults.contextProfileId"
            label="上下文窗口"
            :options="contextWindowOptionBarOptions"
          />
          <OptionBar
            v-model="settingsDraft.agentExploreDefaults.thinkingMode"
            label="Thinking"
            :options="thinkingModeOptionBarOptions"
          />
          <label>
            <span>temperature</span>
            <input v-model.number="settingsDraft.agentExploreDefaults.temperature" type="number" min="0" max="2" step="0.1" />
          </label>
          <label>
            <span>max_tokens</span>
            <input v-model.number="settingsDraft.agentExploreDefaults.maxTokens" type="number" min="128" step="128" />
          </label>
          <label>
            <span>默认循环轮数</span>
            <input v-model.number="settingsDraft.agentExploreDefaults.maxIterations" type="number" min="1" max="8" />
          </label>
          <label>
            <span>默认每次召回</span>
            <input v-model.number="settingsDraft.agentExploreDefaults.limit" type="number" min="1" max="20" />
          </label>
          <label>
            <span>tool_choice</span>
            <input v-model="settingsDraft.agentExploreDefaults.toolChoice" autocomplete="off" />
          </label>
        </div>
        <ConfigFoldCard title="知识融合智能体" open>
          <div class="form-grid compact-form-grid">
            <AgentModelOptionBar
              v-model="settingsDraft.agentExploreDefaults.reviewFusionModelAlias"
              label="智能体"
              placeholder="未分配智能体"
              include-empty
              :options="agentSelectorOptions"
            />
            <label>
              <span>temperature</span>
              <input
                v-model.number="settingsDraft.agentExploreDefaults.reviewFusionTemperature"
                type="number"
                min="0"
                max="2"
                step="0.1"
              />
            </label>
            <label>
              <span>max_tokens</span>
              <input
                v-model.number="settingsDraft.agentExploreDefaults.reviewFusionMaxTokens"
                type="number"
                min="128"
                step="128"
              />
            </label>
          </div>
          <label>
            <span>融合提示词</span>
            <textarea
              v-model="settingsDraft.agentExploreDefaults.reviewFusionSystemPrompt"
              rows="4"
              spellcheck="false"
            ></textarea>
          </label>
        </ConfigFoldCard>
        <div class="source-actions">
          <button class="tool-button" type="submit" :disabled="busyKey === 'settings'">
            {{ busyKey === "settings" ? "保存中" : "保存高级选项" }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
