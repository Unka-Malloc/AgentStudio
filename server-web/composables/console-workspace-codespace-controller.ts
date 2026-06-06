import { reactive, ref, type Ref } from "vue";
import { errorMessage } from "../lib/errors";
import * as workspacesClient from "../lib/workspaces-client";
import type { WorkspaceConsolePayload } from "../lib/workspaces-client";

type WorkspaceCodespaceControllerOptions = {
  selectedId: Ref<string>;
  selectedWorkspaceTitle: () => string;
  localError: Ref<string>;
  setBusy: (key: string) => void;
  clearBusy: () => void;
};

export function useWorkspaceCodespaceController(options: WorkspaceCodespaceControllerOptions) {
  const codespaceData = ref<WorkspaceConsolePayload | null>(null);
  const codespaceResult = ref<WorkspaceConsolePayload | null>(null);
  const codespaceForm = reactive({
    provider: "github",
    repoId: "",
    repositoryRef: "",
    branch: "main",
    path: "README.md",
    baseRef: "HEAD~1",
    headRef: "HEAD",
    diff: "diff --git a/README.md b/README.md\n",
    reviewTarget: "",
    codeChangeId: "",
  });

  function setCodespaceData(value: WorkspaceConsolePayload | null) {
    codespaceData.value = value;
  }

  function resetCodespaceState() {
    codespaceData.value = null;
    codespaceResult.value = null;
  }

  function openCodespace() {
    codespaceResult.value = null;
    if (!codespaceForm.repositoryRef && options.selectedWorkspaceTitle()) {
      codespaceForm.repositoryRef = options.selectedWorkspaceTitle();
    }
    return "codespace" as const;
  }

  async function inspectCodespaceStatus() {
    options.setBusy("ws:codespace-status");
    options.localError.value = "";
    try {
      codespaceResult.value = await workspacesClient.inspectCodespaceRepositoryStatus({
        provider: codespaceForm.provider,
        repoId: codespaceForm.repoId || undefined,
        repositoryRef: codespaceForm.repositoryRef,
        branch: codespaceForm.branch,
      });
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function prepareCodespaceChange() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:codespace-prepare");
    options.localError.value = "";
    try {
      const prepared = await workspacesClient.prepareCodespaceChangeRequest({
        workspaceId: options.selectedId.value,
        provider: codespaceForm.provider,
        repositoryRef: codespaceForm.repositoryRef || codespaceForm.repoId,
        branch: codespaceForm.branch,
        diff: codespaceForm.diff,
        dataClass: "codeChange",
        policy: { decision: "allow", source: "console" },
        checkpoint: { workspaceId: options.selectedId.value },
        commitPlan: [{ message: "Pact Codespace console change" }],
      });
      codespaceForm.codeChangeId = prepared.codeChangeId || prepared.codeChange?.codeChangeId || "";
      codespaceResult.value = prepared;
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  async function uploadCodespaceChange() {
    if (!options.selectedId.value) return;
    options.setBusy("ws:codespace-upload");
    options.localError.value = "";
    try {
      codespaceResult.value = await workspacesClient.uploadCodespaceChangeRequest({
        workspaceId: options.selectedId.value,
        codeChangeId: codespaceForm.codeChangeId || undefined,
        provider: codespaceForm.provider,
        repoId: codespaceForm.repoId || undefined,
        repositoryRef: codespaceForm.repositoryRef,
        branch: codespaceForm.branch,
        sourceRef: codespaceForm.headRef || "HEAD",
        targetRef: codespaceForm.branch || "main",
        title: "Pact Codespace console dry-run",
        dryRun: true,
        confirm: true,
      });
    } catch (e: unknown) { options.localError.value = errorMessage(e); }
    finally { options.clearBusy(); }
  }

  return {
    codespaceData,
    codespaceResult,
    codespaceForm,
    setCodespaceData,
    resetCodespaceState,
    openCodespace,
    inspectCodespaceStatus,
    prepareCodespaceChange,
    uploadCodespaceChange,
  };
}
