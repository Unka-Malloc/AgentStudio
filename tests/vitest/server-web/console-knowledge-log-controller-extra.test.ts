// @vitest-environment jsdom
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleKnowledgeLogController } from "../../../server-web/composables/console-knowledge-log-controller";
import type { KnowledgeLogRow } from "../../../server-web/types/app";

const downloadTextFileMock = vi.hoisted(() => vi.fn());
const pointerDragControllerMock = vi.hoisted(() => ({
  startPointerDrag: vi.fn(),
  stopPointerDrag: vi.fn(),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  downloadTextFile: downloadTextFileMock,
}));

vi.mock("../../../server-web/composables/console-pointer-drag-controller", () => ({
  createConsolePointerDragController: vi.fn(() => pointerDragControllerMock),
}));

function makeRow(overrides: Partial<KnowledgeLogRow> = {}): KnowledgeLogRow {
  return {
    logId: "log-1",
    kindLabel: "任务",
    displayId: "display-1",
    target: "source-1",
    status: "done",
    statusLabel: "完成",
    tone: "success",
    stage: "ingest",
    occurredAt: "2026-06-04T02:03:04.000Z",
    createdAt: "2026-06-04T01:02:03.000Z",
    progressPercent: 66,
    detail: "initial detail",
    error: "",
    ...overrides,
  };
}

function createFixture(rows: KnowledgeLogRow[] = []) {
  const serverLogRows = ref(rows);
  const controller = createConsoleKnowledgeLogController({
    serverLogRows,
  });

  return {
    controller,
    serverLogRows,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("console knowledge log controller extra coverage", () => {
  it("derives status options, filters rows, and clears filters back to the full set", () => {
    const { controller, serverLogRows } = createFixture();

    expect(controller.filteredKnowledgeLogRows.value).toEqual([]);
    expect(controller.knowledgeLogStatusOptions.value).toEqual([]);

    const rows = [
      makeRow({
        logId: "log-1",
        displayId: "DISPLAY-1",
        target: "source-2",
        status: "done",
        statusLabel: "完成",
        stage: "ingest",
        occurredAt: "2026-06-04T03:04:05.000Z",
        createdAt: "2026-06-04T03:04:05.000Z",
        detail: "ready for export",
        error: "timeout",
      }),
      makeRow({
        logId: "log-2",
        displayId: "DISPLAY-2",
        target: "source-3",
        status: "failed",
        statusLabel: "失败",
        stage: "review",
        occurredAt: "2026-06-03T12:00:00.000Z",
        createdAt: "2026-06-03T12:00:00.000Z",
        detail: "outside date range",
        error: "network",
      }),
      makeRow({
        logId: "log-3",
        displayId: "DISPLAY-3",
        target: "source-4",
        status: "done",
        statusLabel: "完成",
        stage: "ingest",
        occurredAt: "",
        createdAt: "2026-06-04T06:00:00.000Z",
        detail: "missing timestamp",
        error: "",
      }),
      makeRow({
        logId: "log-4",
        displayId: "DISPLAY-4",
        target: "source-5",
        status: "done",
        statusLabel: "",
        stage: "draft",
        occurredAt: "2026-06-04T08:00:00.000Z",
        createdAt: "2026-06-04T08:00:00.000Z",
        detail: "ignored status label",
        error: "",
      }),
    ];

    serverLogRows.value = rows;

    expect(controller.knowledgeLogStatusOptions.value).toEqual(["完成", "失败"]);
    expect(controller.knowledgeLogStatusOptionBarOptions.value).toEqual([
      { value: "", label: "全部状态" },
      { value: "完成", label: "完成" },
      { value: "失败", label: "失败" },
    ]);

    controller.knowledgeLogFilters.value = {
      id: " display-1 ",
      status: "done",
      stage: "timeout",
      from: "2026-06-04",
      to: "2026-06-04",
    };

    expect(controller.filteredKnowledgeLogRows.value).toEqual([rows[0]]);

    controller.knowledgeLogFilters.value = {
      id: "",
      status: "",
      stage: "",
      from: "",
      to: "",
    };

    expect(controller.filteredKnowledgeLogRows.value).toEqual(rows);

    controller.knowledgeLogFilters.value = {
      id: "source-5",
      status: "",
      stage: "ignored",
      from: "",
      to: "",
    };

    expect(controller.filteredKnowledgeLogRows.value).toEqual([rows[3]]);
  });

  it("syncs scroll position, adjusts column widths, and exports the filtered CSV", () => {
    const { controller } = createFixture([
      makeRow({
        logId: "log-1",
        displayId: "DISPLAY-1",
        target: "source-2",
        status: "done",
        statusLabel: "完成",
        stage: "ingest",
        occurredAt: "2026-06-04T03:04:05.000Z",
        createdAt: "2026-06-04T03:04:05.000Z",
        detail: "ready for export",
        error: "timeout",
      }),
    ]);

    const tableWrap = { scrollLeft: 37 };
    controller.knowledgeLogTableShellRef.value = {
      querySelector: vi.fn(() => tableWrap),
    } as any;

    controller.syncKnowledgeLogTableScrollLeft({ scrollLeft: -18 });
    expect(controller.knowledgeLogTableScrollLeft.value).toBe(0);

    controller.handleKnowledgeLogTableScroll({ scrollLeft: 21 });
    expect(controller.knowledgeLogTableScrollLeft.value).toBe(21);

    controller.syncKnowledgeLogTableScrollLeft();
    expect(controller.knowledgeLogTableScrollLeft.value).toBe(37);

    controller.knowledgeLogTableScrollLeft.value = 10;
    controller.knowledgeLogResizing.value = {
      key: "target",
      startX: 100,
      startWidth: 220,
    };

    expect(controller.knowledgeLogColumnDividers.value.find((item) => item.key === "target")).toMatchObject({
      left: 330,
      active: true,
    });
    expect(controller.knowledgeLogColumnDividers.value[0]).toMatchObject({
      key: "kind",
      left: 110,
      active: false,
    });

    controller.handleKnowledgeLogColumnPointerMove({ clientX: 83 } as PointerEvent);
    expect(controller.knowledgeLogColumnWidths.value.target).toBe(220);

    controller.knowledgeLogResizing.value = {
      key: "kind",
      startX: 50,
      startWidth: 120,
    };
    controller.handleKnowledgeLogColumnPointerMove({ clientX: 73 } as PointerEvent);
    expect(controller.knowledgeLogColumnWidths.value.kind).toBe(143);

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const pointerEvent = {
      clientX: 111,
      currentTarget: document.createElement("div"),
      preventDefault,
      stopPropagation,
    } as unknown as PointerEvent;

    controller.startKnowledgeLogColumnResize(pointerEvent, "progress");

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(controller.knowledgeLogResizing.value).toEqual({
      key: "progress",
      startX: 111,
      startWidth: 80,
    });
    expect(pointerDragControllerMock.startPointerDrag).toHaveBeenCalledWith(pointerEvent);
    expect(pointerDragControllerMock.stopPointerDrag).toHaveBeenCalled();

    controller.handleKnowledgeLogColumnDividerKeydown({ key: "Enter" } as KeyboardEvent, "progress");
    expect(controller.knowledgeLogColumnWidths.value.progress).toBe(80);

    controller.handleKnowledgeLogColumnDividerKeydown(
      { key: "ArrowLeft", preventDefault: vi.fn() } as KeyboardEvent,
      "progress",
    );
    expect(controller.knowledgeLogColumnWidths.value.progress).toBe(80);

    controller.handleKnowledgeLogColumnDividerKeydown(
      { key: "ArrowRight", shiftKey: true, preventDefault: vi.fn() } as KeyboardEvent,
      "progress",
    );
    expect(controller.knowledgeLogColumnWidths.value.progress).toBe(104);

    controller.stopKnowledgeLogColumnResize();
    expect(controller.knowledgeLogResizing.value).toBeNull();
    expect(pointerDragControllerMock.stopPointerDrag).toHaveBeenCalledTimes(2);

    controller.exportKnowledgeLogRows();

    expect(downloadTextFileMock).toHaveBeenCalledTimes(1);
    const [fileName, csv, contentType] = downloadTextFileMock.mock.calls[0];
    expect(fileName).toBe("system-logs-2026-06-04-20-00-00.csv");
    expect(contentType).toBe("text/csv;charset=utf-8");
    expect(csv).toContain('"type","id","target","status","stage","createdAt","updatedAt","progressPercent","detail","error"');
    expect(csv).toContain('"任务","log-1","source-2","完成","ingest","2026-06-04 11:04:05","2026-06-04 11:04:05","66","ready for export","timeout"');
    expect(csv.split("\n")).toHaveLength(2);
  });
});
