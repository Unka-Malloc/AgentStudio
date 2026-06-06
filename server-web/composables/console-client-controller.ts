import { computed, ref, type Ref } from "vue";
import type { ClientMigrationState, ServerConsoleState } from "../lib/types";
import type { OptionBarOption } from "../types/app";
import {
  clientConnectionDetail,
  clientConnectionMethodLabel,
  clientStatusLabel,
} from "./console-client-display-utils";
import { migrationStateLabels } from "./console-defaults";
import { parseTime } from "./console-format-utils";

type ConsoleClientControllerOptions = {
  consoleState: Ref<ServerConsoleState | null>;
};

export function createConsoleClientController(options: ConsoleClientControllerOptions) {
  const clientSearchQuery = ref("");
  const clientStateFilter = ref<ClientMigrationState | "all">("all");

  const filteredClients = computed(() =>
    [...(options.consoleState.value?.clients.items || [])].sort(
      (left, right) => parseTime(right.lastSeenAt) - parseTime(left.lastSeenAt),
    ),
  );

  const filteredClientList = computed(() => {
    const query = clientSearchQuery.value.trim().toLowerCase();
    const stateFilter = clientStateFilter.value;

    return filteredClients.value.filter((item) => {
      if (stateFilter !== "all" && item.migrationState !== stateFilter) {
        return false;
      }

      if (!query) {
        return true;
      }
      return (
        (item.clientLabel || "").toLowerCase().includes(query) ||
        (item.clientId || "").toLowerCase().includes(query) ||
        (item.hostname || "").toLowerCase().includes(query) ||
        (item.platform || "").toLowerCase().includes(query) ||
        (item.currentServiceUrl || "").toLowerCase().includes(query) ||
        clientConnectionMethodLabel(item).toLowerCase().includes(query) ||
        clientConnectionDetail(item).toLowerCase().includes(query) ||
        clientStatusLabel(item).toLowerCase().includes(query) ||
        (migrationStateLabels[item.migrationState as ClientMigrationState] || "").includes(query)
      );
    });
  });

  const displayedClients = computed(() => filteredClients.value.slice(0, 6));
  const clientStateFilterOptionBarOptions = computed<OptionBarOption[]>(() => [
    { value: "all", label: "所有状态" },
    ...Object.entries(migrationStateLabels).map(([value, label]) => ({ value, label })),
  ]);
  const attentionClientCount = computed(() => {
    const summary = options.consoleState.value?.clients.summary;

    if (!summary) {
      return 0;
    }

    return (
      summary.outdatedCount +
      summary.drainingCount +
      summary.bootstrapOnlyCount +
      summary.offlineCount +
      summary.unknownCount
    );
  });
  const latestClient = computed(() => filteredClients.value[0] || null);

  return {
    attentionClientCount,
    clientSearchQuery,
    clientStateFilter,
    clientStateFilterOptionBarOptions,
    displayedClients,
    filteredClientList,
    filteredClients,
    latestClient,
  };
}
