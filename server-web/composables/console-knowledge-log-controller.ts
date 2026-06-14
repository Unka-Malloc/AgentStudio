import { computed, ref, watch } from "vue";
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
  fuzzy: string;
  kind: string;
  status: string;
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
  pagination?: Partial<KnowledgeLogPaginationConfig>;
};

type KnowledgeLogPaginationConfig = {
  defaultPageSize: number;
  maxPageSize: number;
  pageSizeOptions: number[];
};

const knowledgeLogDisplayStatusOrder = [
  "运行中",
  "待处理",
  "成功",
  "需关注",
  "失败",
];

const fallbackKnowledgeLogPaginationConfig: KnowledgeLogPaginationConfig = {
  defaultPageSize: 20,
  maxPageSize: 100,
  pageSizeOptions: [10, 20, 50, 100],
};

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function sortDisplayStatuses(statuses: string[]) {
  const order = new Map(knowledgeLogDisplayStatusOrder.map((status, index) => [status, index]));
  return [...statuses].sort((left, right) => {
    const leftIndex = order.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right, "zh-CN");
  });
}

function sortFilterLabels(labels: string[]) {
  return [...labels].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePageSize(value: unknown, fallback: number, maxPageSize: number) {
  return Math.min(normalizePositiveInteger(value, fallback), maxPageSize);
}

function normalizePageSizeOptions(config: KnowledgeLogPaginationConfig) {
  const maxPageSize = normalizePositiveInteger(config.maxPageSize, fallbackKnowledgeLogPaginationConfig.maxPageSize);
  const defaultPageSize = normalizePageSize(config.defaultPageSize, maxPageSize, maxPageSize);
  const options = [defaultPageSize, ...config.pageSizeOptions]
    .map((value) => normalizePageSize(value, defaultPageSize, maxPageSize))
    .filter((value) => value > 0);
  return [...new Set(options)].sort((left, right) => left - right);
}

function knowledgeLogDisplayStatusLabel(row: KnowledgeLogRow) {
  const raw = `${row.status || ""} ${row.statusLabel || ""}`.toLowerCase();
  const label = String(row.statusLabel || row.status || "").trim();
  if (
    includesAny(raw, [
      "cancel",
      "critical",
      "denied",
      "deny",
      "error",
      "exited",
      "failed",
      "interrupted",
      "missing",
      "rejected",
      "reject",
      "stopped",
    ]) ||
    /取消|拒绝|失败|严重|中断|缺失|停止|退出/u.test(label)
  ) {
    return "失败";
  }
  if (includesAny(raw, ["running", "active", "open"]) || /运行中/u.test(label)) {
    return "运行中";
  }
  if (includesAny(raw, ["awaiting", "pending", "queued", "standby", "starting"]) || /待审批|排队|待接管|启动/u.test(label)) {
    return "待处理";
  }
  if (
    includesAny(raw, ["allow", "available", "closed", "completed", "ok", "recover", "success"]) ||
    /允许|成功|通过|正常|可用|关闭|完成|恢复/u.test(label) ||
    row.tone === "success"
  ) {
    return "成功";
  }
  if (includesAny(raw, ["warning", "warn", "stale", "degraded"]) || /警告|降级|超时|有错误/u.test(label) || row.tone === "warning") {
    return "需关注";
  }
  return "需关注";
}

export function createConsoleKnowledgeLogController(options: ConsoleKnowledgeLogControllerOptions) {
  const paginationConfig: KnowledgeLogPaginationConfig = {
    ...fallbackKnowledgeLogPaginationConfig,
    ...(options.pagination || {}),
  };
  const knowledgeLogPageSizeOptions = normalizePageSizeOptions(paginationConfig);
  const knowledgeLogInitialPageSize =
    knowledgeLogPageSizeOptions.find((value) => value === normalizePageSize(
      paginationConfig.defaultPageSize,
      fallbackKnowledgeLogPaginationConfig.defaultPageSize,
      normalizePositiveInteger(paginationConfig.maxPageSize, fallbackKnowledgeLogPaginationConfig.maxPageSize),
    )) || knowledgeLogPageSizeOptions[knowledgeLogPageSizeOptions.length - 1] || fallbackKnowledgeLogPaginationConfig.defaultPageSize;
  const knowledgeLogAdvancedOpen = ref(false);
  const knowledgeLogCurrentPage = ref(1);
  const knowledgeLogPageSize = ref(knowledgeLogInitialPageSize);
  const knowledgeLogFilters = ref<KnowledgeLogFilters>({
    fuzzy: "",
    kind: "",
    status: "",
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
    time: 190,
    detail: 220,
    error: 180,
  };
  const knowledgeLogColumnWidths = ref<Record<KnowledgeLogColumnKey, number>>({
    kind: 120,
    target: 220,
    status: 112,
    stage: 150,
    progress: 80,
    time: 190,
    detail: 220,
    error: 180,
  });
  const knowledgeLogResizing = ref<{
    key: KnowledgeLogColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  const knowledgeLogStatusOptions = computed(() =>
    sortDisplayStatuses(Array.from(new Set(options.serverLogRows.value.map((row) => knowledgeLogDisplayStatusLabel(row))))),
  );
  const knowledgeLogStatusOptionBarOptions = computed<OptionBarOption[]>(() => [
    { value: "", label: "全部状态" },
    ...knowledgeLogStatusOptions.value.map((status) => ({ value: status, label: status })),
  ]);
  const knowledgeLogKindOptions = computed(() =>
    sortFilterLabels(Array.from(new Set(options.serverLogRows.value.map((row) => row.kindLabel).filter(Boolean)))),
  );
  const knowledgeLogKindOptionBarOptions = computed<OptionBarOption[]>(() => [
    { value: "", label: "全部类型" },
    ...knowledgeLogKindOptions.value.map((kind) => ({ value: kind, label: kind })),
  ]);
  const knowledgeLogPageSizeOptionBarOptions = computed<OptionBarOption[]>(() =>
    knowledgeLogPageSizeOptions.map((pageSize) => ({
      value: pageSize,
      label: `${pageSize} 条`,
    })),
  );

  const filteredKnowledgeLogRows = computed(() => {
    const filters = knowledgeLogFilters.value;
    const fuzzyQuery = filters.fuzzy.trim().toLowerCase();
    const fromTime = parseFilterDate(filters.from, "start");
    const toTime = parseFilterDate(filters.to, "end");
    return options.serverLogRows.value.filter((row) => {
      const fuzzy = [
        row.kindLabel,
        row.logId,
        row.displayId,
        row.target,
        row.status,
        row.statusLabel,
        knowledgeLogDisplayStatusLabel(row),
        row.stage,
        row.detail,
        row.error,
      ].join(" ").toLowerCase();
      const updatedAt = parseTime(row.occurredAt || row.createdAt);
      if (fuzzyQuery && !fuzzy.includes(fuzzyQuery)) {
        return false;
      }
      if (filters.kind && row.kindLabel !== filters.kind) {
        return false;
      }
      if (filters.status && knowledgeLogDisplayStatusLabel(row) !== filters.status) {
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
  const knowledgeLogPageTotal = computed(() => filteredKnowledgeLogRows.value.length);
  const knowledgeLogPageCount = computed(() =>
    Math.max(1, Math.ceil(knowledgeLogPageTotal.value / Math.max(1, knowledgeLogPageSize.value))),
  );
  const paginatedKnowledgeLogRows = computed(() => {
    const pageSize = Math.max(1, knowledgeLogPageSize.value);
    const start = (Math.min(knowledgeLogCurrentPage.value, knowledgeLogPageCount.value) - 1) * pageSize;
    return filteredKnowledgeLogRows.value.slice(start, start + pageSize);
  });
  const knowledgeLogPageRange = computed(() => {
    if (!knowledgeLogPageTotal.value) {
      return { start: 0, end: 0 };
    }
    const start = (knowledgeLogCurrentPage.value - 1) * knowledgeLogPageSize.value + 1;
    const end = Math.min(knowledgeLogPageTotal.value, start + knowledgeLogPageSize.value - 1);
    return { start, end };
  });

  function setKnowledgeLogPage(page: number) {
    knowledgeLogCurrentPage.value = Math.min(
      Math.max(1, Math.floor(Number(page) || 1)),
      knowledgeLogPageCount.value,
    );
  }

  function goToKnowledgeLogPreviousPage() {
    setKnowledgeLogPage(knowledgeLogCurrentPage.value - 1);
  }

  function goToKnowledgeLogNextPage() {
    setKnowledgeLogPage(knowledgeLogCurrentPage.value + 1);
  }

  watch(
    knowledgeLogFilters,
    () => {
      knowledgeLogCurrentPage.value = 1;
    },
    { deep: true },
  );

  watch(knowledgeLogPageSize, (pageSize) => {
    const normalized = knowledgeLogPageSizeOptions.includes(Number(pageSize))
      ? Number(pageSize)
      : knowledgeLogInitialPageSize;
    if (normalized !== pageSize) {
      knowledgeLogPageSize.value = normalized;
    }
    knowledgeLogCurrentPage.value = 1;
  });

  watch(knowledgeLogPageCount, (pageCount) => {
    if (knowledgeLogCurrentPage.value > pageCount) {
      knowledgeLogCurrentPage.value = pageCount;
    }
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
          knowledgeLogDisplayStatusLabel(row),
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
    goToKnowledgeLogNextPage,
    goToKnowledgeLogPreviousPage,
    handleKnowledgeLogColumnDividerKeydown,
    handleKnowledgeLogColumnPointerMove,
    handleKnowledgeLogTableScroll,
    knowledgeLogAdvancedOpen,
    knowledgeLogColumnDividers,
    knowledgeLogColumnLabels,
    knowledgeLogColumnMinWidths,
    knowledgeLogColumnOrder,
    knowledgeLogColumnWidths,
    knowledgeLogCurrentPage,
    knowledgeLogDisplayStatusLabel,
    knowledgeLogFilters,
    knowledgeLogKindOptionBarOptions,
    knowledgeLogKindOptions,
    knowledgeLogPageCount,
    knowledgeLogPageRange,
    knowledgeLogPageSize,
    knowledgeLogPageSizeOptionBarOptions,
    knowledgeLogPageTotal,
    knowledgeLogResizing,
    knowledgeLogStatusOptionBarOptions,
    knowledgeLogStatusOptions,
    knowledgeLogTableScrollLeft,
    knowledgeLogTableShellRef,
    paginatedKnowledgeLogRows,
    setKnowledgeLogPage,
    startKnowledgeLogColumnResize,
    stopKnowledgeLogColumnResize,
    syncKnowledgeLogTableScrollLeft,
  };
}
