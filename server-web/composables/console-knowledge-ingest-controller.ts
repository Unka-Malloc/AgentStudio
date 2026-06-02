import { computed, ref, type Ref } from "vue";
import { getNormalizedDocuments } from "../lib/knowledge-documents-client";
import { createKnowledgeUploadSession } from "../lib/knowledge-upload-session";
import { createJob, getJob } from "../lib/jobs-client";
import type {
  AgentSettings,
  KnowledgeIngestTarget,
  KnowledgeIngestTargetKind,
  NormalizedDocumentsManifest,
  SplitJob,
} from "../lib/types";

type ConsoleKnowledgeIngestControllerOptions = {
  clearAllBusy: () => void;
  error: Ref<string>;
  refreshKnowledgeConsole: () => Promise<void>;
  refreshState: (options?: { silent?: boolean }) => Promise<void>;
  setBusy: (key: string) => void;
  settingsDraft: Ref<AgentSettings>;
};

function splitKnowledgeIngestRefs(value: string) {
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function knowledgeIngestProviderLabel(provider: string) {
  const normalized = provider.toLowerCase();
  if (normalized === "ragflow") {
    return "RAG Flow";
  }
  if (normalized === "dify") {
    return "Dify";
  }
  return provider || "外部知识库";
}

export function createConsoleKnowledgeIngestController(
  options: ConsoleKnowledgeIngestControllerOptions,
) {
  const ingestFiles = ref<File[]>([]);
  const ingestProgress = ref("");
  const ingestJob = ref<SplitJob | null>(null);
  const knowledgeIngestTargets = ref<Record<KnowledgeIngestTargetKind, boolean>>({
    global: true,
    external: false,
    team: false,
    user: false,
  });
  const knowledgeIngestExternalProvider = ref("dify");
  const knowledgeIngestExternalRefs = ref("");
  const knowledgeIngestExternalTargetLabels = ref<Record<string, string>>({});
  const knowledgeIngestTeamRefs = ref("");
  const knowledgeIngestUserRefs = ref("");
  const normalizedManifest = ref<NormalizedDocumentsManifest | null>(null);

  function onIngestFilesSelected(files: File[]) {
    ingestFiles.value = files;
    ingestProgress.value = ingestFiles.value.length
      ? `已选择 ${ingestFiles.value.length} 个文件`
      : "";
  }

  function parseKnowledgeIngestExternalRef(ref: string) {
    const separatorIndex = ref.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === ref.length - 1) {
      return {
        provider: knowledgeIngestExternalProvider.value || "dify",
        ref,
      };
    }
    return {
      provider: ref.slice(0, separatorIndex),
      ref: ref.slice(separatorIndex + 1),
    };
  }

  const selectedKnowledgeIngestTargets = computed<KnowledgeIngestTarget[]>(() => {
    const targets: KnowledgeIngestTarget[] = [];
    if (knowledgeIngestTargets.value.global) {
      targets.push({
        kind: "global",
        label: "Pact Native 知识库",
      });
    }
    if (knowledgeIngestTargets.value.external) {
      const refsByProvider = new Map<string, string[]>();
      const labelsByProvider = new Map<string, string[]>();
      for (const item of splitKnowledgeIngestRefs(knowledgeIngestExternalRefs.value)) {
        const parsed = parseKnowledgeIngestExternalRef(item);
        if (!parsed.ref) {
          continue;
        }
        const refs = refsByProvider.get(parsed.provider) || [];
        refs.push(parsed.ref);
        refsByProvider.set(parsed.provider, refs);
        const label = knowledgeIngestExternalTargetLabels.value[`${parsed.provider}:${parsed.ref}`];
        if (label) {
          const labels = labelsByProvider.get(parsed.provider) || [];
          labels.push(label);
          labelsByProvider.set(parsed.provider, labels);
        }
      }
      for (const [provider, refs] of refsByProvider) {
        const labels = labelsByProvider.get(provider) || [];
        targets.push({
          kind: "external",
          label: `${knowledgeIngestProviderLabel(provider)}：${labels.length ? labels.join("、") : refs.join("、")}`,
          provider,
          refs,
        });
      }
    }
    if (knowledgeIngestTargets.value.team) {
      targets.push({
        kind: "team",
        label: "团队空间",
        refs: splitKnowledgeIngestRefs(knowledgeIngestTeamRefs.value),
      });
    }
    if (knowledgeIngestTargets.value.user) {
      targets.push({
        kind: "user",
        label: "用户私有空间",
        refs: splitKnowledgeIngestRefs(knowledgeIngestUserRefs.value),
      });
    }
    return targets;
  });

  const knowledgeIngestTargetValidationMessage = computed(() => {
    if (selectedKnowledgeIngestTargets.value.length === 0) {
      return "请至少选择一个知识入库目标。";
    }
    if (knowledgeIngestTargets.value.external && splitKnowledgeIngestRefs(knowledgeIngestExternalRefs.value).length === 0) {
      return "请选择外部知识库时，需要填写至少一个库或空间 ID。";
    }
    if (knowledgeIngestTargets.value.team && splitKnowledgeIngestRefs(knowledgeIngestTeamRefs.value).length === 0) {
      return "请选择团队空间时，需要填写至少一个团队。";
    }
    if (knowledgeIngestTargets.value.user && splitKnowledgeIngestRefs(knowledgeIngestUserRefs.value).length === 0) {
      return "请选择用户私有空间时，需要填写至少一个用户。";
    }
    return "";
  });

  const canSubmitKnowledgeIngest = computed(() => knowledgeIngestTargetValidationMessage.value === "");

  const knowledgeIngestTargetSummary = computed(() => {
    if (!selectedKnowledgeIngestTargets.value.length) {
      return "请选择入库目标";
    }
    return `将入库到：${selectedKnowledgeIngestTargets.value.map((target) => target.label).join("、")}`;
  });

  async function uploadFilesToKnowledge() {
    if (ingestFiles.value.length === 0) {
      options.error.value = "请先选择需要入库的文件。";
      return;
    }
    if (!canSubmitKnowledgeIngest.value) {
      options.error.value = knowledgeIngestTargetValidationMessage.value;
      return;
    }
    options.setBusy("knowledge:ingest");
    options.error.value = "";
    ingestProgress.value = "准备上传会话…";
    ingestJob.value = null;
    normalizedManifest.value = null;
    try {
      const filesToUpload = [...ingestFiles.value];
      const { session } = await createKnowledgeUploadSession(filesToUpload, {
        onProgress: (progress) => {
          ingestProgress.value = progress.message;
        },
      });
      ingestProgress.value = "创建入库任务…";
      const job = await createJob({
        inputText: "",
        filePaths: [],
        uploadedFiles: [],
        uploadSessionId: session.sessionId,
        settings: {
          ...options.settingsDraft.value,
          knowledgeIngestTargets: selectedKnowledgeIngestTargets.value,
        },
      });
      ingestJob.value = job;
      ingestProgress.value = `已进入处理队列，${knowledgeIngestTargetSummary.value}。`;
      await options.refreshState({ silent: true });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "上传入库失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function refreshIngestJob(refreshOptions: { silent?: boolean } = {}) {
    if (!ingestJob.value?.id) {
      return;
    }
    if (!refreshOptions.silent) {
      options.setBusy(`knowledge:ingest:${ingestJob.value.id}`);
    }
    options.error.value = "";
    try {
      const job = await getJob(ingestJob.value.id);
      ingestJob.value = job;
      if (job?.status === "completed") {
        normalizedManifest.value = (await getNormalizedDocuments(job.id)) || null;
        ingestProgress.value = "处理完成，生成的知识文档可以下载查看。";
        await options.refreshKnowledgeConsole();
      }
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "刷新入库任务失败。";
    } finally {
      if (!refreshOptions.silent) {
        options.clearAllBusy();
      }
    }
  }

  function applyIngestJobFromEvent(job: SplitJob) {
    if (ingestJob.value?.id !== job.id) {
      return false;
    }
    ingestJob.value = job;
    if (job.status === "completed") {
      void refreshIngestJob({ silent: true });
    }
    return true;
  }

  return {
    applyIngestJobFromEvent,
    canSubmitKnowledgeIngest,
    ingestFiles,
    ingestJob,
    ingestProgress,
    knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets,
    knowledgeIngestTargetSummary,
    knowledgeIngestTargetValidationMessage,
    knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs,
    normalizedManifest,
    onIngestFilesSelected,
    refreshIngestJob,
    uploadFilesToKnowledge,
  };
}
