<script setup lang="ts">
import type { AgentModelConfig } from "../../../lib/types";
import { useAgentModelEntryCardContext } from "../../../composables/agentModelEntryCardContext";
import ConfigFoldCard from "../../ConfigFoldCard.vue";

defineProps<{
  entry: AgentModelConfig;
}>();

const {
  beginCodexOAuthLogin,
  busyKey,
  codexOAuthStatus,
  settingsDraft,
} = useAgentModelEntryCardContext();
</script>

<template>
  <template v-if="entry.provider === 'google-gemini'">
    <label>
      <span>Google API Key</span>
      <input v-model="settingsDraft.googleApiKey" type="password" autocomplete="off" placeholder="留空则保留当前已配置 Key" />
    </label>
  </template>

  <template v-else-if="entry.provider === 'openai-chatgpt'">
    <p class="form-hint">
      {{
        codexOAuthStatus?.valid
          ? `已连接 ${codexOAuthStatus.email || "ChatGPT"}`
          : codexOAuthStatus?.reason || "需要连接 Codex OAuth。"
      }}
    </p>
    <button class="tool-button tool-button-ghost compact-action" type="button" :disabled="busyKey === 'codex-oauth'" @click="beginCodexOAuthLogin">
      {{ busyKey === "codex-oauth" ? "等待中" : "连接 Codex" }}
    </button>
  </template>

  <template v-else-if="entry.provider === 'openrouter'">
    <label>
      <span>Base URL</span>
      <input v-model="settingsDraft.openRouterBaseUrl" autocomplete="off" />
    </label>
    <label>
      <span>API Key</span>
      <input v-model="settingsDraft.openRouterApiKey" type="password" autocomplete="off" placeholder="留空则保留当前已配置 Key" />
    </label>
  </template>

  <template v-else-if="entry.provider === 'deepseek'">
    <label>
      <span>Base URL</span>
      <input v-model="entry.baseUrl" autocomplete="off" />
    </label>
    <label>
      <span>API Key</span>
      <input v-model="entry.apiKey" type="password" autocomplete="off" placeholder="留空则保留当前已配置 Key" />
    </label>
    <label>
      <span>Timeout(ms)</span>
      <input v-model.number="entry.timeoutMs" type="number" min="1000" step="1000" />
    </label>
  </template>

  <template v-else-if="entry.provider === 'copilot'">
    <label>
      <span>Endpoint</span>
      <input v-model="settingsDraft.copilotEndpoint" autocomplete="off" />
    </label>
    <label>
      <span>Access Token</span>
      <input v-model="settingsDraft.copilotApiKey" type="password" autocomplete="off" placeholder="留空则保留当前已配置 Token" />
    </label>
  </template>

  <template v-else-if="entry.provider === 'local-model'">
    <label>
      <span>Endpoint</span>
      <input v-model="settingsDraft.localModelEndpoint" autocomplete="off" />
    </label>
  </template>

  <template v-else-if="entry.provider === 'custom-http'">
    <label>
      <span>URL</span>
      <input v-model="entry.url" autocomplete="off" />
    </label>
    <label>
      <span>Token</span>
      <input v-model="entry.token" autocomplete="off" type="password" placeholder="留空保持已保存 Token" />
    </label>
    <ConfigFoldCard title="高级连接参数">
      <div class="form-grid compact-form-grid">
        <label>
          <span>Token Header</span>
          <input v-model="entry.tokenHeader" autocomplete="off" />
        </label>
        <label>
          <span>Token Prefix</span>
          <input v-model="entry.tokenPrefix" autocomplete="off" />
        </label>
        <label>
          <span>Timeout(ms)</span>
          <input v-model.number="entry.timeoutMs" type="number" min="1000" step="1000" />
        </label>
      </div>
    </ConfigFoldCard>
  </template>
</template>
