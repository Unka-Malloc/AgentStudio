<script setup lang="ts">
import OptionBar from "../OptionBar.vue";
import { formatCompactDate } from "../../composables/console-format-utils";
import { useServerConsoleShellContext } from "../../composables/serverConsoleShellContext";

const {
  authAudit,
  authRoleOptionBarOptions,
  authSessions,
  authUsers,
  busyKey,
  canAdminAuth,
  enabledBooleanOptionBarOptions,
  oidcAllowedDomainsText,
  oidcDraft,
  oidcRoleMappingText,
  revokeConsoleSession,
  saveOidcConfig,
  updateConsoleUser,
  updateConsoleUserRole,
} = useServerConsoleShellContext();
</script>

<template>
  <section class="drawer-panel">
    <div class="panel-header">
      <h4>用户与执行日志</h4>
      <p>用户创建和密码修改仅允许在服务端命令行执行。</p>
    </div>

    <template v-if="canAdminAuth">
      <section class="module-panel">
        <div class="module-panel-heading">
          <strong>控制台用户</strong>
          <span>{{ authUsers.length }} 个账号</span>
        </div>
        <div class="job-table compact-job-table drawer-auth-table">
          <div class="job-table-header">
            <span>用户</span>
            <span>角色</span>
            <span>状态</span>
          </div>
          <div v-for="user in authUsers" :key="user.userId" class="job-row">
            <span>{{ user.displayName }} / {{ user.username }}</span>
            <OptionBar
              :model-value="user.roleId"
              :options="authRoleOptionBarOptions"
              @change="updateConsoleUserRole(user, String($event))"
            />
            <button
              class="table-action"
              type="button"
              :disabled="busyKey === `auth:user:${user.userId}`"
              @click="updateConsoleUser(user, { enabled: !user.enabled })"
            >
              {{ user.enabled ? "停用" : "启用" }}
            </button>
          </div>
        </div>
      </section>

      <section class="module-panel">
        <div class="module-panel-heading">
          <strong>OIDC 配置</strong>
          <span>{{ oidcDraft.enabled ? "已启用" : "未启用" }}</span>
        </div>
        <div class="form-grid compact-form-grid">
          <OptionBar
            v-model="oidcDraft.enabled"
            label="启用"
            :options="enabledBooleanOptionBarOptions"
          />
          <label>
            <span>Issuer</span>
            <input v-model="oidcDraft.issuer" autocomplete="off" />
          </label>
          <label>
            <span>Client ID</span>
            <input v-model="oidcDraft.clientId" autocomplete="off" />
          </label>
          <label>
            <span>Client Secret</span>
            <input v-model="oidcDraft.clientSecret" type="password" autocomplete="off" placeholder="只写不读" />
          </label>
          <label>
            <span>Redirect URI</span>
            <input v-model="oidcDraft.redirectUri" autocomplete="off" />
          </label>
        </div>
        <label class="json-editor">
          <span>Allowed Domains</span>
          <textarea v-model="oidcAllowedDomainsText" rows="3"></textarea>
        </label>
        <label class="json-editor">
          <span>Role Mapping JSON</span>
          <textarea v-model="oidcRoleMappingText" rows="4" spellcheck="false"></textarea>
        </label>
        <button
          class="tool-button"
          type="button"
          :disabled="busyKey === 'auth:oidc'"
          @click="saveOidcConfig"
        >
          {{ busyKey === "auth:oidc" ? "保存中" : "保存 OIDC" }}
        </button>
      </section>

      <section class="module-panel">
        <div class="module-panel-heading">
          <strong>会话与操作记录</strong>
          <span>{{ authSessions.length }} 个会话 / {{ authAudit.length }} 条记录</span>
        </div>
        <div class="job-table compact-job-table drawer-auth-table">
          <div class="job-table-header">
            <span>会话</span>
            <span>用户</span>
            <span>操作</span>
          </div>
          <div v-for="session in authSessions" :key="String(session.sessionId)" class="job-row">
            <span>{{ session.sessionId }}</span>
            <span>{{ session.username }} / {{ session.roleId }}</span>
            <button
              class="table-action"
              type="button"
              :disabled="busyKey === `auth:session:${session.sessionId}`"
              @click="revokeConsoleSession(String(session.sessionId))"
            >
              撤销
            </button>
          </div>
        </div>
        <div class="job-table compact-job-table audit-table">
          <div class="job-table-header">
            <span>时间</span>
            <span>操作</span>
            <span>结果</span>
          </div>
          <div v-for="item in authAudit" :key="item.auditId" class="job-row">
            <span>{{ formatCompactDate(item.createdAt) }}</span>
            <span>{{ item.username || "system" }} / {{ item.operationId || item.action }}</span>
            <span>{{ item.status }} {{ item.error }}</span>
          </div>
        </div>
      </section>
    </template>

    <div v-else class="empty-state">
      <strong>权限不足</strong>
      <span>需要 auth:admin 权限才能管理用户、OIDC、会话和操作记录。</span>
    </div>
  </section>
</template>
