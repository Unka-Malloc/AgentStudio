import { computed, ref, type Ref } from "vue";
import {
  getContextProfiles,
  listContextBuildRecords,
  previewContextPack,
  runContextEvaluation,
} from "../lib/context-compiler-client";
import { downloadTextFile } from "./console-browser-effects";
import { formatMachineDate } from "./console-format-utils";
import { asRecord } from "./console-model-utils";

type ConsoleContextCompilerControllerOptions = {
  clearAllBusy: () => void;
  error: Ref<string>;
  recentTurns: () => unknown[];
  selectedContextProfileId: () => string;
  setBusy: (key: string) => void;
};

function parseRequiredEvidenceIds(value: string) {
  return value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isDeprecatedContextProfile(profile: Record<string, unknown>) {
  const profileId = String(profile.profileId || profile.id || "").trim();
  const label = String(profile.label || "").trim();
  return (
    ["balanced", "small-context", "deepseek-v3-671b"].includes(profileId) ||
    ["Balanced Context", "Small Context", "DeepSeek V3 671B"].includes(label)
  );
}

export function createConsoleContextCompilerController(
  options: ConsoleContextCompilerControllerOptions,
) {
  const contextProfilesResponse = ref<Record<string, unknown> | null>(null);
  const contextBuildRecordsResponse = ref<Record<string, unknown> | null>(null);
  const contextPreviewTask = ref("Summarize billing risks in emails from the last month; preserve evidence IDs.");
  const contextPreviewRequiredEvidence = ref("");
  const contextPreviewResult = ref<Record<string, unknown> | null>(null);
  const contextEvaluationResult = ref<Record<string, unknown> | null>(null);

  const contextProfileRows = computed(() =>
    ((asRecord(contextProfilesResponse.value)?.profiles || []) as Array<Record<string, unknown>>)
      .filter((profile) => !isDeprecatedContextProfile(profile))
      .map((profile) => ({
        profileId: String(profile.profileId || profile.id || ""),
        label: String(profile.label || profile.profileId || ""),
        contextWindowTokens: Number(profile.contextWindowTokens || 0),
        compressionMode: String(asRecord(profile.compression)?.mode || "deterministic"),
        strategy: String(asRecord(profile.compression)?.strategy || ""),
        knowledgeBudget: Number(profile.knowledgeBudget || 0),
        historyBudget: Number(profile.historyBudget || 0),
        recentTurnBudget: Number(profile.recentTurnBudget || 0),
        expertGuidanceRatio: Number(asRecord(profile.budgetPolicy)?.expertGuidanceRatio || 0),
        protectedEvidenceFields: ((profile.protectedEvidenceFields || []) as unknown[]).map((item) => String(item)),
        modelCompressionAlias: String(asRecord(profile.modelCompression)?.alias || ""),
        modelCompressionEnabled: asRecord(profile.modelCompression)?.enabled === true,
      }))
      .sort((left, right) => {
        const tokenCompare = left.contextWindowTokens - right.contextWindowTokens;
        if (tokenCompare !== 0) return tokenCompare;
        return left.profileId.localeCompare(right.profileId);
      }),
  );

  const contextBuildRecordRows = computed(() =>
    ((asRecord(contextBuildRecordsResponse.value)?.records || []) as Array<Record<string, unknown>>).map((record) => ({
      recordId: String(record.recordId || ""),
      createdAt: String(record.createdAt || ""),
      profileId: String(record.profileId || ""),
      totalTokens: Number(record.totalTokens || 0),
      sourceTokens: Number(record.sourceTokens || 0),
      triggerReason: String(record.triggerReason || ""),
      compressionMode: String(record.compressionMode || ""),
      preservedEvidenceIds: ((record.preservedEvidenceIds || []) as unknown[]).map((item) => String(item)),
      droppedKnowledgeCount: Number(record.droppedKnowledgeCount || 0),
      humanExpertGuidanceCount: Number(record.humanExpertGuidanceCount || 0),
    })),
  );

  async function refreshContextCompiler(optionsOverride: { silent?: boolean } = {}) {
    const showBusy = !optionsOverride.silent;
    if (showBusy) {
      options.setBusy("context:refresh");
    }
    try {
      const [profiles, records] = await Promise.all([
        getContextProfiles(),
        listContextBuildRecords(20),
      ]);
      contextProfilesResponse.value = profiles;
      contextBuildRecordsResponse.value = records;
    } catch (nextError) {
      if (!optionsOverride.silent) {
        options.error.value =
          nextError instanceof Error ? nextError.message : "加载上下文编译器状态失败。";
      }
    } finally {
      if (showBusy) {
        options.clearAllBusy();
      }
    }
  }

  function contextPreviewPayload() {
    const requiredEvidenceIds = parseRequiredEvidenceIds(contextPreviewRequiredEvidence.value);
    return {
      contextProfileId: options.selectedContextProfileId(),
      inputSource: "server-console-context-preview",
      taskBrief: contextPreviewTask.value,
      systemMemory: "Pact server console preview. Preserve evidence ids and human expert guidance.",
      expertGuidance: [
        {
          feedbackId: "preview-human-guidance",
          label: "人类专家意见",
              instruction: "证据编号、来源定位、时间、版本和冲突信息必须保留。",
          evidenceRefs: requiredEvidenceIds,
          context: {
            gold: true,
            humanExpert: true,
          },
        },
      ],
      retrievedEvidence: requiredEvidenceIds.length
        ? requiredEvidenceIds.map((evidenceId, index) => ({
            evidenceId,
            title: `预览证据 ${index + 1}`,
            snippet: `用于验证上下文编译器证据保护的片段：${evidenceId}，时间 2026-04-${String(index + 1).padStart(2, "0")}，版本 v1.${index + 1}.0。`,
            sourceLocator: `preview/${evidenceId}`,
            confidence: 0.9,
            humanExpert: true,
          }))
        : [
            {
              evidenceId: "preview-evidence-1",
              title: "预览部署证据",
              snippet: "2026-04-20 部署版本 v1.2.3，需要保留 evidenceId、时间和版本。",
              sourceLocator: "preview/ops/deployment.md",
              confidence: 0.9,
              humanExpert: true,
            },
          ],
      history: "上一轮用户要求先确认部署对象，再输出风险结论。".repeat(20),
      recentTurns: options.recentTurns(),
      toolState: {
        iteration: 1,
        previousToolResults: [
          {
            tool: "keyword_search",
            ok: true,
            count: 3,
            evidenceId: requiredEvidenceIds[0] || "preview-evidence-1",
          },
        ],
      },
    };
  }

  async function previewContextCompiler() {
    options.setBusy("context:preview");
    options.error.value = "";
    try {
      contextPreviewResult.value = await previewContextPack(contextPreviewPayload());
      await refreshContextCompiler({ silent: true });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "上下文预览失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function runContextReplayEvaluation() {
    options.setBusy("context:evaluation");
    options.error.value = "";
    try {
      const payload = contextPreviewPayload();
      const requiredEvidenceIds = parseRequiredEvidenceIds(contextPreviewRequiredEvidence.value);
      contextEvaluationResult.value = await runContextEvaluation({
        profiles: [options.selectedContextProfileId()],
        cases: [
          {
            caseId: `console-preview-${Date.now()}`,
            ...payload,
            requiredEvidenceIds: requiredEvidenceIds.length ? requiredEvidenceIds : ["preview-evidence-1"],
          },
        ],
      });
      await refreshContextCompiler({ silent: true });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "上下文 replay 评估失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  function exportContextBuildRecords() {
    const payload = contextBuildRecordsResponse.value || { records: [] };
    downloadTextFile(
      `context-build-records-${formatMachineDate(new Date().toISOString(), "full").replace(/[: ]/g, "-")}.json`,
      `${JSON.stringify(payload, null, 2)}\n`,
      "application/json;charset=utf-8",
    );
  }

  return {
    contextBuildRecordRows,
    contextBuildRecordsResponse,
    contextEvaluationResult,
    contextPreviewPayload,
    contextPreviewRequiredEvidence,
    contextPreviewResult,
    contextPreviewTask,
    contextProfileRows,
    contextProfilesResponse,
    exportContextBuildRecords,
    previewContextCompiler,
    refreshContextCompiler,
    runContextReplayEvaluation,
  };
}
