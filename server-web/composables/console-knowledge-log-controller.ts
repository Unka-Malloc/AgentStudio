import { computed, ref } from "vue";
import type { KnowledgeLogRow, OptionBarOption } from "../types/app";
import { downloadTextFile } from "./console-browser-effects";
import {
  csvCell,
  formatMachineDate,
  parseFilterDate,
  parseTime,
} from "./console-format-utils";
import { asRecord } from "./console-model-utils";
import { createConsolePointerDragController } from "./console-pointer-drag-controller";

type ReadonlyRef<T> = {
  readonly value: T;
};

type KnowledgeLogFilters = {
  id: string;
  status: string;
  stage: string;
  from: string;
  to: string;
};

type KnowledgeLogColumnKey =
  | "kind"
  | "target"
  | "status"
  | "stage"
  | "progress"
  | "time"
  | "detail"
  | "error";

type ConsoleKnowledgeLogControllerOptions = {
  serverLogRows: ReadonlyRef<KnowledgeLogRow[]>;
};

export function createConsoleKnowledgeLogController(options: ConsoleKnowledgeLogControllerOptions) {
  const knowledgeLogAdvancedOpen = ref(false);
  const knowledgeLogFilters = ref<KnowledgeLogFilters>({
    id: "",
    status: "",
    stage: "",
    from: "",
    to: "",
  });
  const knowledgeLogTableShellRef = ref<HTMLElement | null>(null);
  const knowledgeLogTableScrollLeft = ref(0);
  const knowledgeLogColumnOrder: KnowledgeLogColumnKey[] = [
    "kind",
    "target",
    "status",
    "stage",
    "progress",
    "time",
    "detail",
    "error",
  ];
  const knowledgeLogColumnLabels: Record<KnowledgeLogColumnKey, string> = {
    kind: "类型",
    target: "对象",
    status: "状态",
    stage: "阶段",
    progress: "进度",
    time: "时间",
    detail: "详情",
    error: "错误",
  };
  const knowledgeLogColumnMinWidths: Record<KnowledgeLogColumnKey, number> = {
    kind: 120,
    target: 220,
    status: 112,
    stage: 150,
    progress: 80,
    time: 122,
    detail: 220,
    error: 180,
  };
  const knowledgeLogColumnWidths = ref<Record<KnowledgeLogColumnKey, number>>({
    kind: 120,
    target: 220,
    status: 112,
    stage: 150,
    progress: 80,
    time: 122,
    detail: 220,
    error: 180,
  });
  const knowledgeLogResizing = ref<{
    key: KnowledgeLogColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  const knowledgeLogStatusOptions = computed(() =>
    Array.from(new Set(options.serverLogRows.value.map((row) => row.statusLabel).filter(Boolean))),
  );
  const knowledgeLogStatusOptionBarOptions = computed<OptionBarOption[]>(() => [
    { value: "", label: "全部状态" },
    ...knowledgeLogStatusOptions.value.map((status) => ({ value: status, label: status })),
  ]);

  const filteredKnowledgeLogRows = computed(() => {
    const filters = knowledgeLogFilters.value;
    const idQuery = filters.id.trim().toLowerCase();
    const stageQuery = filters.stage.trim().toLowerCase();
    const fromTime = parseFilterDate(filters.from, "start");
    const toTime = parseFilterDate(filters.to, "end");
    return options.serverLogRows.value.filter((row) => {
      const id = `${row.logId} ${row.target} ${row.displayId}`.toLowerCase();
      const stage = `${row.stage} ${row.detail} ${row.error}`.toLowerCase();
      const updatedAt = parseTime(row.occurredAt || row.createdAt);
      if (idQuery && !id.includes(idQuery)) {
        return false;
      }
      if (filters.status && row.statusLabel !== filters.status && row.status !== filters.status) {
        return false;
      }
      if (stageQuery && !stage.includes(stageQuery)) {
        return false;
      }
      if (fromTime && (!updatedAt || updatedAt < fromTime)) {
        return false;
      }
      if (toTime && (!updatedAt || updatedAt > toTime)) {
        return false;
      }
      return true;
    });
  });

  const knowledgeLogColumnDividers = computed(() => {
    let left = 0;
    return knowledgeLogColumnOrder.slice(0, -1).map((key) => {
      left += knowledgeLogColumnWidths.value[key];
      return {
        key,
        label: knowledgeLogColumnLabels[key],
        left: left - knowledgeLogTableScrollLeft.value,
        active: knowledgeLogResizing.value?.key === key,
      };
    });
  });

  function syncKnowledgeLogTableScrollLeft(fallback?: unknown) {
    const record = asRecord(fallback);
    const directValue = Number(record?.scrollLeft);
    if (Number.isFinite(directValue)) {
      knowledgeLogTableScrollLeft.value = Math.max(0, directValue);
      return;
    }
    const scrollWrap = knowledgeLogTableShellRef.value?.querySelector<HTMLElement>(".el-scrollbar__wrap");
    knowledgeLogTableScrollLeft.value = Math.max(0, Number(scrollWrap?.scrollLeft || 0));
  }

  function handleKnowledgeLogTableScroll(payload: unknown) {
    syncKnowledgeLogTableScrollLeft(payload);
  }

  function handleKnowledgeLogColumnPointerMove(event: PointerEvent) {
    const resizing = knowledgeLogResizing.value;
    if (!resizing) {
      return;
    }
    const minWidth = knowledgeLogColumnMinWidths[resizing.key];
    const nextWidth = Math.max(minWidth, resizing.startWidth + event.clientX - resizing.startX);
    knowledgeLogColumnWidths.value = {
      ...knowledgeLogColumnWidths.value,
      [resizing.key]: Math.round(nextWidth),
    };
  }

  const columnResizeDrag = createConsolePointerDragController({
    cursor: "col-resize",
    onMove: handleKnowledgeLogColumnPointerMove,
    onStop: () => {
      knowledgeLogResizing.value = null;
    },
  });

  function stopKnowledgeLogColumnResize() {
    columnResizeDrag.stopPointerDrag();
    knowledgeLogResizing.value = null;
  }

  function startKnowledgeLogColumnResize(event: PointerEvent, key: KnowledgeLogColumnKey) {
    event.preventDefault();
    event.stopPropagation();
    stopKnowledgeLogColumnResize();
    syncKnowledgeLogTableScrollLeft();
    knowledgeLogResizing.value = {
      key,
      startX: event.clientX,
      startWidth: knowledgeLogColumnWidths.value[key],
    };
    columnResizeDrag.startPointerDrag(event);
  }

  function handleKnowledgeLogColumnDividerKeydown(event: KeyboardEvent, key: KnowledgeLogColumnKey) {
    const step = event.shiftKey ? 24 : 8;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    knowledgeLogColumnWidths.value = {
      ...knowledgeLogColumnWidths.value,
      [key]: Math.max(
        knowledgeLogColumnMinWidths[key],
        knowledgeLogColumnWidths.value[key] + direction * step,
      ),
    };
  }

  function exportKnowledgeLogRows() {
    const rows = filteredKnowledgeLogRows.value;
    const csv = [
      ["type", "id", "target", "status", "stage", "createdAt", "updatedAt", "progressPercent", "detail", "error"].map(csvCell).join(","),
      ...rows.map((row) =>
        [
          row.kindLabel,
          row.logId,
          row.target,
          row.statusLabel,
          row.stage,
          formatMachineDate(row.createdAt, "full"),
          formatMachineDate(row.occurredAt, "full"),
          row.progressPercent,
          row.detail,
          row.error,
        ].map(csvCell).join(","),
      ),
    ].join("\n");
    downloadTextFile(
      `system-logs-${formatMachineDate(new Date().toISOString(), "full").replace(/[: ]/g, "-")}.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
  }

  return {
    exportKnowledgeLogRows,
    filteredKnowledgeLogRows,
    handleKnowledgeLogColumnDividerKeydown,
    handleKnowledgeLogColumnPointerMove,
    handleKnowledgeLogTableScroll,
    knowledgeLogAdvancedOpen,
    knowledgeLogColumnDividers,
    knowledgeLogColumnLabels,
    knowledgeLogColumnMinWidths,
    knowledgeLogColumnOrder,
    knowledgeLogColumnWidths,
    knowledgeLogFilters,
    knowledgeLogResizing,
    knowledgeLogStatusOptionBarOptions,
    knowledgeLogStatusOptions,
    knowledgeLogTableScrollLeft,
    knowledgeLogTableShellRef,
    startKnowledgeLogColumnResize,
    stopKnowledgeLogColumnResize,
    syncKnowledgeLogTableScrollLeft,
  };
}
