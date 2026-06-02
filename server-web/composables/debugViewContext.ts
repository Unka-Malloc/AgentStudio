import { inject, provide, type InjectionKey } from "vue";
import type { useDebugViewConsole } from "./useDebugViewConsole";

type DebugViewConsole = ReturnType<typeof useDebugViewConsole>;

const debugViewContextKeys = [
  "busyKey",
  "distillationBusy",
  "distillationError",
  "distillationFile",
  "distillationFileLabel",
  "distillationModelAlias",
  "distillationModelLabel",
  "distillationModelOptions",
  "distillationModelReady",
  "distillationProgressSegments",
  "distillationProgressSummary",
  "distillationResultFiles",
  "distillationRunId",
  "distillationStatusMessage",
  "distillationStep",
  "handleDebugDistillationFileSelected",
  "knowledgeConsole",
  "knowledgeRecallDebugForm",
  "knowledgeRecallDebugGridStyle",
  "knowledgeRecallDebugModeOptionBarOptions",
  "knowledgeRecallDebugRuns",
  "knowledgeRecallDebugTargetOptions",
  "knowledgeSourceState",
  "knowledgeStatus",
  "openAgentEvidencePreview",
  "runKnowledgeRecallDebugBatch",
  "startDebugKnowledgeDistillation",
] as const satisfies readonly (keyof DebugViewConsole)[];

type DebugViewContextKey = (typeof debugViewContextKeys)[number];

export type DebugViewContext = Pick<DebugViewConsole, DebugViewContextKey>;

export function createDebugViewContext(debugView: DebugViewConsole): DebugViewContext {
  return Object.fromEntries(debugViewContextKeys.map((key) => [key, debugView[key]])) as DebugViewContext;
}

const debugViewKey = Symbol("debug-view") as InjectionKey<DebugViewContext>;

export function provideDebugView(context: DebugViewContext) {
  provide(debugViewKey, context);
}

export function useDebugViewContext() {
  const context = inject(debugViewKey);
  if (!context) {
    throw new Error("Debug view context is not available");
  }
  return context;
}
