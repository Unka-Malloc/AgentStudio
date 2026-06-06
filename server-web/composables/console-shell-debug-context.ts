import type { useConsole } from "./useConsole";

type ConsoleContext = ReturnType<typeof useConsole>;

const debugShellKeys = [
  "busyKey",
  "currentView",
  "debugTab",
  "error",
  "infoFeedModelOptions",
  "isAuthenticated",
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
  "visibleDebugTabs",
] as const satisfies readonly (keyof ConsoleContext)[];

export type DebugShellContext = Pick<ConsoleContext, (typeof debugShellKeys)[number]>;

export function pickDebugShellContext(context: ConsoleContext): DebugShellContext {
  return Object.fromEntries(debugShellKeys.map((key) => [key, context[key]])) as DebugShellContext;
}
