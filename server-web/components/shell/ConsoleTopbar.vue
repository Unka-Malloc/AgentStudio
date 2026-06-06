<script setup lang="ts">
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  currentUser,
  cycleTheme,
  isAuthenticated,
  languageMode,
  localizedViewTitle,
  msg,
  pageRefreshAriaLabel,
  pageRefreshBusy,
  pageRefreshTitle,
  refreshCurrentPage,
  serverAvailable,
  serviceStatusLabel,
  serviceUrl,
  sideNavOpen,
  themeMode,
  toggleLanguage,
} = useServerConsoleShellContext();
</script>

<template>
  <header v-if="isAuthenticated" class="topbar">
    <button
      class="topbar-hamburger"
      type="button"
      :aria-expanded="sideNavOpen"
      :aria-label="msg.topbar.toggleNav"
      @click="sideNavOpen = !sideNavOpen"
    >
      <span></span>
      <span></span>
      <span></span>
    </button>
    <div class="topbar-heading">
      <h2 class="topbar-page-title">{{ localizedViewTitle }}</h2>
      <div class="identity-row">
        <span
          class="url-badge service-url-badge"
          :class="serverAvailable ? 'is-available' : 'is-unavailable'"
          :title="serviceStatusLabel"
          :aria-label="`${serviceStatusLabel}: ${serviceUrl}`"
        >
          <span class="service-status-dot" aria-hidden="true"></span>
          <span class="service-url-text">{{ serviceUrl }}</span>
        </span>
      </div>
    </div>

    <div class="topbar-tools">
      <span v-if="currentUser" class="identity-chip">
        {{ currentUser.displayName }}
      </span>
      <button
        class="tool-button tool-button-ghost tool-button-icon"
        type="button"
        :title="pageRefreshTitle"
        :disabled="pageRefreshBusy"
        :aria-label="pageRefreshAriaLabel"
        @click="refreshCurrentPage"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :style="pageRefreshBusy ? 'animation:spin 1s linear infinite' : ''" aria-hidden="true">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
          <path d="M8 16H3v5"/>
        </svg>
      </button>
      <button
        class="tool-button tool-button-ghost tool-button-icon"
        type="button"
        :title="themeMode === 'dark' ? msg.topbar.themeDarkTitle : themeMode === 'light' ? msg.topbar.themeLightTitle : msg.topbar.themeSystemTitle"
        :aria-label="themeMode === 'dark' ? msg.topbar.themeDarkLabel : themeMode === 'light' ? msg.topbar.themeLightLabel : msg.topbar.themeSystemLabel"
        @click="cycleTheme"
      >
        <svg v-if="themeMode === 'dark'" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <svg v-else-if="themeMode === 'light'" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
      </button>
      <button
        class="tool-button tool-button-ghost tool-button-icon"
        type="button"
        :title="languageMode === 'en' ? msg.topbar.languageEnTitle : msg.topbar.languageZhTitle"
        :aria-label="languageMode === 'en' ? msg.topbar.languageEnLabel : msg.topbar.languageZhLabel"
        @click="toggleLanguage"
      >
        <span class="language-state-text" aria-hidden="true">{{ languageMode === 'en' ? 'EN' : '中' }}</span>
      </button>
    </div>
  </header>
</template>
