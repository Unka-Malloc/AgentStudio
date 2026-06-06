import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  knowledgeDistillationWorkbenchExportUrl,
  knowledgeDistillationWorkbenchPackageUrl,
} from "../lib/knowledge-distillation-workbench";
import type { SplitJob } from "../lib/types";
import { createDebugDistillationRunner } from "./console-debug-distillation-runner";
import {
  buildDistillationProgressSegments,
  buildDistillationResultFiles,
  debugModelOptionEnabled,
  debugModelOptionValue,
  distillationMarkdownLength,
  DISTILLATION_STAGE_ID,
  findDistillationCoreStage,
  formatFileSize,
  getDistillationCoreOutput,
  safeDownloadFileName,
  stripFileExtension,
  type DebugDistillationModelOption,
  type DistillationRun,
  type DistillationStep,
} from "./console-debug-distillation-utils";

type DebugDistillationControllerOptions = {
  infoFeedModelOptions: Readonly<Ref<DebugDistillationModelOption[]>>;
};

export function useDebugDistillationController(options: DebugDistillationControllerOptions) {
  const distillationFile = ref<File | null>(null);
  const distillationStep = ref<DistillationStep>("idle");
  const distillationUploadPercent = ref(0);
  const distillationJob = ref<SplitJob | null>(null);
  const distillationRun = ref<DistillationRun | null>(null);
  const distillationArtifactSizes = ref<Record<string, number>>({});
  const distillationError = ref("");
  const distillationStatusMessage = ref("等待文件");
  const distillationModelAlias = ref("");

  const distillationBusy = computed(() =>
    distillationStep.value === "uploading" ||
    distillationStep.value === "parsing" ||
    distillationStep.value === "distilling"
  );

  const distillationFileLabel = computed(() => {
    if (!distillationFile.value) return "未选择文件";
    return `${distillationFile.value.name} · ${formatFileSize(distillationFile.value.size)}`;
  });

  const distillationRunId = computed(() => String(distillationRun.value?.runId || ""));
  const distillationCoreStage = computed(() => findDistillationCoreStage(distillationRun.value));
  const distillationCoreOutput = computed<Record<string, unknown>>(() =>
    getDistillationCoreOutput(distillationCoreStage.value)
  );
  const distillationResultMarkdown = computed(() => String(distillationCoreOutput.value.markdown || ""));
  const distillationResultMarkdownLength = computed(() =>
    distillationMarkdownLength(distillationCoreOutput.value, distillationResultMarkdown.value)
  );
  const distillationDownloadUrl = computed(() => {
    if (
      !distillationRunId.value ||
      distillationCoreStage.value?.status !== "completed" ||
      distillationResultMarkdownLength.value <= 0
    ) return "";
    return knowledgeDistillationWorkbenchExportUrl(distillationRunId.value, DISTILLATION_STAGE_ID, "markdown");
  });
  const distillationPackageUrl = computed(() =>
    distillationRunId.value &&
      distillationRun.value?.status === "completed" &&
      distillationResultMarkdownLength.value > 0
      ? knowledgeDistillationWorkbenchPackageUrl(distillationRunId.value)
      : ""
  );
  const distillationResultBaseName = computed(() => {
    const sourceName = distillationFile.value?.name || String(distillationRun.value?.title || "知识蒸馏结果");
    return safeDownloadFileName(stripFileExtension(sourceName) || "知识蒸馏结果");
  });
  const distillationResultFiles = computed(() =>
    buildDistillationResultFiles({
      downloadUrl: distillationDownloadUrl.value,
      packageUrl: distillationPackageUrl.value,
      runId: distillationRunId.value,
      baseName: distillationResultBaseName.value,
      coreOutput: distillationCoreOutput.value,
      markdown: distillationResultMarkdown.value,
      artifactByteSize: distillationArtifactByteSize,
      exportUrl: knowledgeDistillationWorkbenchExportUrl,
    })
  );
  const distillationProgressSegments = computed(() =>
    buildDistillationProgressSegments({
      step: distillationStep.value,
      uploadPercent: distillationUploadPercent.value,
      jobStatus: String(distillationJob.value?.status || ""),
      runStatus: String(distillationRun.value?.status || ""),
      coreStatus: String(distillationCoreStage.value?.status || ""),
      markdownLength: distillationResultMarkdownLength.value,
    })
  );
  const distillationProgressSummary = computed(() => {
    const completed = distillationProgressSegments.value.filter((segment) => segment.state === "complete").length;
    return `${completed}/${distillationProgressSegments.value.length}`;
  });
  const distillationModelOptions = computed(() => options.infoFeedModelOptions.value || []);
  const selectedDistillationModel = computed(() =>
    distillationModelOptions.value.find((option) => debugModelOptionValue(option) === distillationModelAlias.value) || null,
  );
  const distillationModelReady = computed(() =>
    Boolean(selectedDistillationModel.value && debugModelOptionEnabled(selectedDistillationModel.value)),
  );
  const distillationModelLabel = computed(() => String(selectedDistillationModel.value?.label || "").trim());

  function distillationArtifactByteSize(...keys: string[]) {
    for (const key of keys) {
      const value = Number(distillationArtifactSizes.value[key] || 0);
      if (value > 0) return value;
    }
    return 0;
  }

  function normalizeDistillationModelSelection() {
    const current = String(distillationModelAlias.value || "").trim();
    if (current && distillationModelOptions.value.some((option) => debugModelOptionValue(option) === current)) {
      return;
    }
    const fallback = distillationModelOptions.value.find(debugModelOptionEnabled) || distillationModelOptions.value[0];
    distillationModelAlias.value = fallback ? debugModelOptionValue(fallback) : "";
  }

  const {
    cancelDebugKnowledgeDistillation,
    handleDebugDistillationFileSelected,
    startDebugKnowledgeDistillation,
  } = createDebugDistillationRunner({
    distillationFile,
    distillationStep,
    distillationUploadPercent,
    distillationJob,
    distillationRun,
    distillationArtifactSizes,
    distillationError,
    distillationStatusMessage,
    distillationModelAlias,
    distillationModelReady: () => distillationModelReady.value,
    selectedDistillationModel: () => selectedDistillationModel.value,
  });

  watch(distillationModelOptions, normalizeDistillationModelSelection, { immediate: true });

  onBeforeUnmount(cancelDebugKnowledgeDistillation);

  return {
    distillationFile,
    distillationStep,
    distillationUploadPercent,
    distillationJob,
    distillationRun,
    distillationArtifactSizes,
    distillationError,
    distillationStatusMessage,
    distillationModelAlias,
    distillationBusy,
    distillationFileLabel,
    distillationRunId,
    distillationCoreStage,
    distillationCoreOutput,
    distillationResultMarkdown,
    distillationResultMarkdownLength,
    distillationDownloadUrl,
    distillationPackageUrl,
    distillationResultBaseName,
    distillationResultFiles,
    distillationProgressSegments,
    distillationProgressSummary,
    distillationModelOptions,
    selectedDistillationModel,
    distillationModelReady,
    distillationModelLabel,
    handleDebugDistillationFileSelected,
    startDebugKnowledgeDistillation,
  };
}
