<script setup lang="ts">
import { useServerConsoleShellContext } from '../../composables/serverConsoleShellContext';
import { formatCompactDate } from '../../composables/console-format-utils';
import {
  clientConfigReportLabel,
  clientConfigReportTone,
  clientConnectionDetail,
  clientConnectionMethodLabel,
  clientStatusLabel,
  clientStatusTone,
} from '../../composables/console-client-display-utils';
import OptionBar from '../../components/OptionBar.vue';
import StatusPill from '../../components/StatusPill.vue';
const {
  clientSearchQuery,
  clientStateFilter,
  clientStateFilterOptionBarOptions,
  consoleState,
  exportClients,
  filteredClientList,
  importClients,
} = useServerConsoleShellContext();
</script>

<template>
          <section id="clients-list" class="surface-card clients-card">
              <div class="section-header">
                <div>
                  <h3>客户端列表</h3>
              </div>
              <div class="section-tags">
                <span
                  >总计
                  {{ consoleState?.clients?.summary?.totalCount || 0 }}</span
                >
                <span
                  >在线
                    {{
                    (consoleState?.clients?.summary?.totalCount || 0) -
                    (consoleState?.clients?.summary?.offlineCount || 0)
                  }}</span
                >
              </div>
            </div>

            <div class="table-toolbar">
              <div class="toolbar-left">
                <input
                  v-model="clientSearchQuery"
                  class="search-input"
                  placeholder="搜索 标签、ID、主机或系统…"
                />
                <OptionBar
                  v-model="clientStateFilter"
                  class="filter-select"
                  :options="clientStateFilterOptionBarOptions"
                />
              </div>
              <div class="toolbar-actions">
                <button
                  class="tool-button tool-button-ghost"
                  type="button"
                  @click="importClients"
                >
                  导入
                </button>
                <button
                  class="tool-button tool-button-ghost"
                  type="button"
                  @click="exportClients"
                >
                  导出
                </button>
              </div>
            </div>

            <div class="table-shell">
              <table class="jobs-table clients-table">
                <colgroup>
                  <col class="clients-table-client-col" />
                  <col class="clients-table-version-col" />
                  <col class="clients-table-status-col" />
                  <col class="clients-table-config-col" />
                  <col class="clients-table-connection-col" />
                  <col class="clients-table-seen-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th>客户端信息</th>
                    <th>版本</th>
                    <th>状态</th>
                    <th>配置上报</th>
                    <th>连接方式</th>
                    <th>最近活跃</th>
                  </tr>
                </thead>
                <tbody v-if="filteredClientList.length > 0">
                  <tr
                    v-for="item in filteredClientList"
                    :key="item.clientId"
                  >
                    <td>
                      <div class="primary-cell">
                        <strong>{{ item.clientLabel || item.clientId }}</strong>
                        <span>{{ item.clientId }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="primary-cell">
                        <strong>{{ item.appVersion || "未上报" }}</strong>
                      </div>
                    </td>
                    <td>
                      <div class="client-status-stack">
                        <StatusPill
                          :tone="clientStatusTone(item)"
                          :label="clientStatusLabel(item)"
                        />
                      </div>
                    </td>
                    <td>
                      <StatusPill
                        :tone="clientConfigReportTone(item)"
                        :label="clientConfigReportLabel(item)"
                      />
                    </td>
                    <td>
                      <div class="primary-cell">
                        <strong>{{ clientConnectionMethodLabel(item) }}</strong>
                        <span v-if="clientConnectionDetail(item)">{{ clientConnectionDetail(item) }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="time-cell">
                        <strong>{{ formatCompactDate(item.lastSeenAt) }}</strong>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div
                v-if="filteredClientList.length === 0"
                class="empty-state"
              >
                <strong>暂无匹配客户端</strong>
                <span>请尝试更换搜索条件或检查网络连接。</span>
              </div>
            </div>
          </section>

</template>
