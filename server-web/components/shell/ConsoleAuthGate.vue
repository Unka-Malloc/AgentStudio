<script setup lang="ts">
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  authBootstrapping,
  busyKey,
  languageMode,
  loginForm,
  msg,
  submitLoginAuth,
  toggleLanguage,
  tt,
} = useServerConsoleShellContext();
</script>

<template>
  <section class="auth-gate">
    <article class="surface-card auth-card">
      <div class="auth-brand">
        <svg class="brand-mark" aria-hidden="true" viewBox="-150 -150 300 300" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ag-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#c9a96e"/><stop offset="50%" stop-color="#f0d28c"/><stop offset="100%" stop-color="#a8893a"/>
            </linearGradient>
            <linearGradient id="ag-silver" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#7a8ea8"/><stop offset="100%" stop-color="#b0c0d4"/>
            </linearGradient>
          </defs>
          <polygon fill="none" points="115.5,47.8 47.8,115.5 -47.8,115.5 -115.5,47.8 -115.5,-47.8 -47.8,-115.5 47.8,-115.5 115.5,-47.8" stroke="url(#ag-gold)" stroke-width="6" opacity="0.75"/>
          <circle r="113" fill="none" stroke="#d4c5a0" stroke-width="4" opacity="0.5"/>
          <circle cx="-16" cy="16" r="89" fill="none" stroke="url(#ag-silver)" stroke-width="3.5" opacity="0.45"/>
          <circle cx="13" cy="-10" r="63" fill="none" stroke="#a0b0c4" stroke-width="3.5" opacity="0.5"/>
          <circle r="36" fill="none" stroke="url(#ag-gold)" stroke-width="4" opacity="0.6"/>
          <circle r="6" fill="#c9a96e" opacity="0.6"/>
        </svg>
        <div>
          <h1 class="auth-brand-name">Pact</h1>
          <p class="brand-subtitle">{{ tt('知识管理控制台') }}</p>
        </div>
        <button
          class="tool-button tool-button-ghost tool-button-icon auth-language-button"
          type="button"
          :title="languageMode === 'en' ? msg.topbar.languageEnTitle : msg.topbar.languageZhTitle"
          :aria-label="languageMode === 'en' ? msg.topbar.languageEnLabel : msg.topbar.languageZhLabel"
          @click="toggleLanguage"
        >
          <span class="language-state-text" aria-hidden="true">{{ languageMode === 'en' ? 'EN' : '中' }}</span>
        </button>
        <div v-if="authBootstrapping" class="auth-connecting" :title="tt('正在连接服务端…')" :aria-label="tt('正在连接')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="auth-spinner-icon">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
      </div>
      <div class="section-header">
        <div>
          <h3>{{ tt(authBootstrapping ? '正在连接…' : '控制台登录') }}</h3>
          <p>{{ tt(authBootstrapping ? '正在确认登录状态，请稍候。' : '首次启动时服务端会自动创建 owner 并生成初始密码；账号创建和密码修改仅允许通过服务端命令行执行。') }}</p>
        </div>
      </div>

      <form class="form-grid auth-form" @submit.prevent="submitLoginAuth" :inert="authBootstrapping">
        <label>
          <span>{{ tt('用户名') }}</span>
          <input v-model="loginForm.username" type="text" autocomplete="username" :disabled="authBootstrapping" />
        </label>
        <label>
          <span>{{ tt('密码') }}</span>
          <input v-model="loginForm.password" type="password" autocomplete="current-password" :disabled="authBootstrapping" />
        </label>
        <button class="primary-action" type="submit" :disabled="authBootstrapping || busyKey === 'auth:login'">
          {{ tt(busyKey === "auth:login" ? "登录中" : "登录") }}
        </button>
      </form>
    </article>
  </section>
</template>
