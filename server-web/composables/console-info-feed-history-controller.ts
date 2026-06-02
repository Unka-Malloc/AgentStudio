import { computed, type Ref } from "vue";
import type {
  HistorySessionPanelItem,
  InfoFeedAttachment,
  InfoFeedRunState,
  InfoFeedStageStatus,
  InfoFeedTurnSnapshot,
} from "../types/app";
import {
  isStorageRecord,
  readBrowserJsonStorage,
  writeBrowserJsonStorage,
} from "../lib/browser-storage";
import {
  appendInfoFeedTurnSnapshotCore,
  compactInfoFeedRunForStorage as compactInfoFeedRunForStorageCore,
  createInfoFeedRunState,
  createInitialInfoFeedAgentState,
  createInitialInfoFeedKeywordState,
  createInitialInfoFeedSummaryState,
  isReadableInfoFeedAttachment,
  makeInfoFeedId,
  normalizeInfoFeedHistoryCore,
  resetInfoFeedRunForContinuationCore,
  sanitizeInfoFeedRunModelReferences as sanitizeInfoFeedRunModelReferencesCore,
  snapshotInfoFeedAttachments as snapshotInfoFeedAttachmentsCore,
  snapshotInfoFeedTurnCore,
  truncateInfoFeedText,
  type InfoFeedSummaryDefaults,
} from "./console-info-feed-utils";
import { asRecord } from "./console-model-utils";
import { formatCompactDate } from "./console-format-utils";

const INFO_FEED_HISTORY_STORAGE_VERSION = 1;

export type ConsoleInfoFeedHistoryControllerOptions = {
  infoFeedAttachments: Ref<InfoFeedAttachment[]>;
  infoFeedCurrentRun: Ref<InfoFeedRunState | null>;
  infoFeedForm: Ref<{
    query: string;
    modelAlias: string;
    contextProfileId: string;
    temperature: number;
    maxTokens: number;
  }>;
  infoFeedHistory: Ref<InfoFeedRunState[]>;
  infoFeedParentRunSnapshot?: Ref<InfoFeedRunState | null>;
  storageKey: string;
  evidenceRefs: (run: InfoFeedRunState) => string[];
  hasAgentModelOption: (value?: string) => boolean;
  summaryDefaults: () => InfoFeedSummaryDefaults;
  validAgentModelAlias: (value?: string) => string;
};

export function createConsoleInfoFeedHistoryController(options: ConsoleInfoFeedHistoryControllerOptions) {
  async function readInfoFeedAttachment(file: File): Promise<InfoFeedAttachment> {
    const attachment: InfoFeedAttachment = {
      id: makeInfoFeedId("attachment"),
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      status: "running",
      progress: 10,
      text: "",
      error: "",
    };
    if (file.size > 2 * 1024 * 1024) {
      return {
        ...attachment,
        status: "failed",
        progress: 100,
        error: "附件超过 2MB，信息流输入暂不直接读取。",
      };
    }
    if (!isReadableInfoFeedAttachment(file)) {
      return {
        ...attachment,
        status: "failed",
        progress: 100,
        error: "当前格式无法在页面侧直接读取。",
      };
    }
    try {
      const text = await file.text();
      if (!text.trim() || text.includes("\u0000")) {
        return {
          ...attachment,
          status: "failed",
          progress: 100,
          error: "文件内容为空或疑似二进制内容。",
        };
      }
      return {
        ...attachment,
        status: "completed",
        progress: 100,
        text: text.slice(0, 20000),
      };
    } catch (nextError) {
      return {
        ...attachment,
        status: "failed",
        progress: 100,
        error: nextError instanceof Error ? nextError.message : "读取失败。",
      };
    }
  }

  async function handleInfoFeedAttachmentFiles(selectedFiles: File[]) {
    const files = Array.from(selectedFiles || []);
    if (!files.length) {
      return;
    }
    const pending = files.map((file) => ({
      id: makeInfoFeedId("attachment"),
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      status: "running" as InfoFeedStageStatus,
      progress: 5,
      text: "",
      error: "",
    }));
    options.infoFeedAttachments.value = [...options.infoFeedAttachments.value, ...pending];
    await Promise.all(files.map(async (file, index) => {
      const result = await readInfoFeedAttachment(file);
      const pendingId = pending[index].id;
      options.infoFeedAttachments.value = options.infoFeedAttachments.value.map((attachment) =>
        attachment.id === pendingId
          ? {
              ...result,
              id: pendingId,
            }
          : attachment,
      );
    }));
  }

  function removeInfoFeedAttachment(attachmentId: string) {
    options.infoFeedAttachments.value = options.infoFeedAttachments.value.filter(
      (attachment) => attachment.id !== attachmentId,
    );
  }

  function snapshotInfoFeedAttachments(attachments: InfoFeedAttachment[] = options.infoFeedAttachments.value) {
    return snapshotInfoFeedAttachmentsCore(attachments);
  }

  function createInfoFeedRun(query: string, followUp?: InfoFeedRunState["followUp"]): InfoFeedRunState {
    return createInfoFeedRunState(query, {
      attachments: options.infoFeedAttachments.value,
      summaryDefaults: options.summaryDefaults(),
      followUp,
    });
  }

  function initialInfoFeedKeywordState(): InfoFeedRunState["keyword"] {
    return createInitialInfoFeedKeywordState();
  }

  function initialInfoFeedAgentState(): InfoFeedRunState["agent"] {
    return createInitialInfoFeedAgentState();
  }

  function initialInfoFeedSummaryState(): InfoFeedRunState["summary"] {
    return createInitialInfoFeedSummaryState(options.summaryDefaults());
  }

  function snapshotInfoFeedTurn(run: InfoFeedRunState): InfoFeedTurnSnapshot | null {
    return snapshotInfoFeedTurnCore(run, {
      summaryModelAlias: options.summaryDefaults().modelAlias,
      evidenceRefs: options.evidenceRefs,
    });
  }

  function appendInfoFeedTurnSnapshot(run: InfoFeedRunState) {
    return appendInfoFeedTurnSnapshotCore(run, {
      summaryModelAlias: options.summaryDefaults().modelAlias,
      evidenceRefs: options.evidenceRefs,
    });
  }

  function resetInfoFeedRunForContinuation(run: InfoFeedRunState, question: string) {
    resetInfoFeedRunForContinuationCore(run, question, {
      attachments: options.infoFeedAttachments.value,
      summaryDefaults: options.summaryDefaults(),
      evidenceRefs: options.evidenceRefs,
    });
  }

  function compactInfoFeedRunForStorage(run: InfoFeedRunState): InfoFeedRunState {
    return compactInfoFeedRunForStorageCore(run, options.summaryDefaults());
  }

  function sanitizeInfoFeedRunModelReferences(run: InfoFeedRunState): InfoFeedRunState {
    return sanitizeInfoFeedRunModelReferencesCore(run, options.validAgentModelAlias);
  }

  function infoFeedRestorableModelAlias(run: InfoFeedRunState) {
    const agentRunInput = asRecord(asRecord(run.agent?.response?.run)?.input) || {};
    return (
      options.validAgentModelAlias(run.summary?.modelAlias) ||
      options.validAgentModelAlias(String(agentRunInput.modelAlias || ""))
    );
  }

  function clearInvalidInfoFeedModelReferences() {
    let historyChanged = false;
    const nextHistory = options.infoFeedHistory.value.map((run) => {
      const sanitized = sanitizeInfoFeedRunModelReferences(run);
      if (
        sanitized.summary.modelAlias !== run.summary?.modelAlias ||
        sanitized.turns.some((turn, index) => turn.summaryModelAlias !== run.turns?.[index]?.summaryModelAlias)
      ) {
        historyChanged = true;
      }
      return sanitized;
    });
    if (historyChanged) {
      options.infoFeedHistory.value = nextHistory;
      persistInfoFeedHistory();
    }
    if (
      options.infoFeedCurrentRun.value?.summary?.modelAlias &&
      !options.hasAgentModelOption(options.infoFeedCurrentRun.value.summary.modelAlias)
    ) {
      options.infoFeedCurrentRun.value = sanitizeInfoFeedRunModelReferences(options.infoFeedCurrentRun.value);
    }
  }

  function normalizeInfoFeedHistory(runs: InfoFeedRunState[]) {
    return normalizeInfoFeedHistoryCore(runs, {
      validAgentModelAlias: options.validAgentModelAlias,
      summaryDefaults: options.summaryDefaults(),
    });
  }

  function normalizeInfoFeedHistoryStoragePayload(value: unknown) {
    if (!isStorageRecord(value)) {
      return [];
    }
    const hasVersion = "version" in value;
    const isSupportedVersion = Number(value.version) === INFO_FEED_HISTORY_STORAGE_VERSION;
    if (hasVersion && !isSupportedVersion) {
      return [];
    }
    return Array.isArray(value.history) ? value.history : [];
  }

  function persistInfoFeedHistory() {
    const history = normalizeInfoFeedHistory(options.infoFeedHistory.value);
    writeBrowserJsonStorage(options.storageKey, {
      version: INFO_FEED_HISTORY_STORAGE_VERSION,
      history,
    });
  }

  function restoreInfoFeedHistory() {
    try {
      const history = readBrowserJsonStorage<unknown[]>(
        options.storageKey,
        [],
        normalizeInfoFeedHistoryStoragePayload,
      );
      options.infoFeedHistory.value = normalizeInfoFeedHistory(history as InfoFeedRunState[]);
      if (history.length > 0) {
        persistInfoFeedHistory();
      }
    } catch {
      options.infoFeedHistory.value = [];
    }
  }

  function upsertInfoFeedHistory(run: InfoFeedRunState | null) {
    if (!run) {
      return;
    }
    options.infoFeedHistory.value = normalizeInfoFeedHistory([
      compactInfoFeedRunForStorage(run),
      ...options.infoFeedHistory.value.filter((item) => item.runId !== run.runId),
    ]);
    persistInfoFeedHistory();
  }

  function deleteInfoFeedHistory(runId: string) {
    options.infoFeedHistory.value = options.infoFeedHistory.value.filter((run) => run.runId !== runId);
    if (options.infoFeedCurrentRun.value?.runId === runId) {
      options.infoFeedCurrentRun.value = null;
    }
    persistInfoFeedHistory();
  }

  const infoFeedHistoryPanelItems = computed<HistorySessionPanelItem[]>(() =>
    options.infoFeedHistory.value.map((run) => ({
      id: run.runId,
      title: run.query || "未命名问题",
      meta: `${formatCompactDate(run.completedAt || run.startedAt)} · ${run.summary.status || "unknown"}`,
      preview: truncateInfoFeedText(run.summary.answer || run.agent.response?.answer || "", 140),
      active: options.infoFeedCurrentRun.value?.runId === run.runId,
      deleteLabel: `删除历史记录 ${run.query || run.runId}`,
    })),
  );

  function selectInfoFeedHistoryItem(runId: string) {
    const run = options.infoFeedHistory.value.find((item) => item.runId === runId);
    if (run) {
      openInfoFeedHistoryRun(run);
    }
  }

  function deleteInfoFeedHistoryItem(runId: string) {
    deleteInfoFeedHistory(runId);
  }

  function openInfoFeedHistoryRun(run: InfoFeedRunState) {
    if (options.infoFeedParentRunSnapshot) {
      options.infoFeedParentRunSnapshot.value = null;
    }
    const sanitizedRun = sanitizeInfoFeedRunModelReferences(compactInfoFeedRunForStorage(run));
    options.infoFeedCurrentRun.value = sanitizedRun;
    options.infoFeedForm.value = {
      ...options.infoFeedForm.value,
      query: "",
      modelAlias: infoFeedRestorableModelAlias(sanitizedRun),
      contextProfileId: sanitizedRun.summary.contextProfileId || options.infoFeedForm.value.contextProfileId,
    };
  }

  return {
    appendInfoFeedTurnSnapshot,
    clearInvalidInfoFeedModelReferences,
    compactInfoFeedRunForStorage,
    createInfoFeedRun,
    deleteInfoFeedHistory,
    deleteInfoFeedHistoryItem,
    handleInfoFeedAttachmentFiles,
    infoFeedHistoryPanelItems,
    infoFeedRestorableModelAlias,
    initialInfoFeedAgentState,
    initialInfoFeedKeywordState,
    initialInfoFeedSummaryState,
    normalizeInfoFeedHistory,
    openInfoFeedHistoryRun,
    persistInfoFeedHistory,
    readInfoFeedAttachment,
    removeInfoFeedAttachment,
    resetInfoFeedRunForContinuation,
    restoreInfoFeedHistory,
    sanitizeInfoFeedRunModelReferences,
    selectInfoFeedHistoryItem,
    snapshotInfoFeedAttachments,
    snapshotInfoFeedTurn,
    upsertInfoFeedHistory,
  };
}
