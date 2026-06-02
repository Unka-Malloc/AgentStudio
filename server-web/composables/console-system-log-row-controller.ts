import { computed } from "vue";
import type { KnowledgeLogRow } from "../types/app";
import {
  buildBaseServerLogRows,
  type ConsoleBaseServerLogRowOptions,
} from "./console-system-log-base-row-controller";
import {
  buildSystemStatusLogRows,
  type ConsoleSystemStatusLogRowOptions,
} from "./console-system-log-status-row-controller";
import {
  compactLogDetail,
  genericStatusTone,
  stateProgressPercent,
} from "./console-system-log-row-utils";
import { parseTime } from "./console-format-utils";

type ConsoleSystemLogRowControllerOptions = ConsoleBaseServerLogRowOptions &
  ConsoleSystemStatusLogRowOptions;

function dedupeLogRows(rows: KnowledgeLogRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.logId)) {
      return false;
    }
    seen.add(row.logId);
    return true;
  });
}

export function createConsoleSystemLogRowController(
  options: ConsoleSystemLogRowControllerOptions,
) {
  const baseServerLogRows = computed<KnowledgeLogRow[]>(() => buildBaseServerLogRows(options));

  function collectSystemStatusLogRows() {
    return buildSystemStatusLogRows(options);
  }

  const serverLogRows = computed<KnowledgeLogRow[]>(() =>
    dedupeLogRows([...collectSystemStatusLogRows(), ...baseServerLogRows.value]).sort(
      (left, right) => parseTime(right.occurredAt) - parseTime(left.occurredAt),
    ),
  );

  return {
    baseServerLogRows,
    collectSystemStatusLogRows,
    compactLogDetail,
    genericStatusTone,
    serverLogRows,
    stateProgressPercent,
  };
}
