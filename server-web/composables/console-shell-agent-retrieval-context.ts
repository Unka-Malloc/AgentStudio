import type { useConsole } from "./useConsole";

type ConsoleContext = ReturnType<typeof useConsole>;

const agentRetrievalShellPageKeys = [
  "resetKnowledgeAgentExplore",
] as const satisfies readonly (keyof ConsoleContext)[];

const agentRetrievalShellFormKeys = [
  "agentExploreAgentOptions",
  "agentExploreForm",
  "contextWindowOptionBarOptions",
  "highlightedConfigTarget",
  "runKnowledgeAgentExplore",
  "selectedAgentExploreModel",
  "thinkingModeOptionBarOptions",
] as const satisfies readonly (keyof ConsoleContext)[];

const agentRetrievalShellTabKeys = [
  "agentExploreActiveTabId",
  "agentExploreTabBusy",
  "agentExploreTabs",
  "closeAgentExploreTab",
  "isAgentExploreDraftSession",
  "switchAgentExploreTab",
] as const satisfies readonly (keyof ConsoleContext)[];

const agentRetrievalShellProgressKeys = [
  "agentExploreHistoryPanelItems",
  "agentExploreProgress",
  "agentExploreProgressVisible",
  "deleteAgentExploreHistoryItem",
  "selectAgentExploreHistoryItem",
] as const satisfies readonly (keyof ConsoleContext)[];

const agentRetrievalShellWorkspaceKeys = [
  "agentExploreResult",
  "agentExploreSplitDragging",
  "agentExploreSplitLeftPercent",
  "agentExploreSplitRef",
  "agentExploreSplitStyle",
  "handleAgentExploreSplitKeydown",
  "startAgentExploreSplitResize",
] as const satisfies readonly (keyof ConsoleContext)[];

const agentRetrievalShellTraceKeys = [
  "agentExploreEventTime",
  "agentExploreStepOpen",
  "agentExploreSteps",
  "agentExploreTraceOpen",
  "agentExploreWorkspaceId",
  "handleAgentExploreTraceToggle",
] as const satisfies readonly (keyof ConsoleContext)[];

const agentRetrievalShellAnswerKeys = [
  "agentExploreAnswerHtml",
  "agentExploreDocumentMarkdown",
  "agentExploreLinkedEvidenceRefs",
  "agentExploreResult",
  "copyAgentExploreDocument",
  "exportAgentExploreDocument",
  "handleAgentAnswerClick",
] as const satisfies readonly (keyof ConsoleContext)[];

export type AgentRetrievalShellKey =
  | (typeof agentRetrievalShellPageKeys)[number]
  | (typeof agentRetrievalShellFormKeys)[number]
  | (typeof agentRetrievalShellTabKeys)[number]
  | (typeof agentRetrievalShellProgressKeys)[number]
  | (typeof agentRetrievalShellWorkspaceKeys)[number]
  | (typeof agentRetrievalShellTraceKeys)[number]
  | (typeof agentRetrievalShellAnswerKeys)[number];

type AgentRetrievalShellPick<TKeys extends readonly (keyof ConsoleContext)[]> =
  Pick<ConsoleContext, TKeys[number]>;

export type AgentRetrievalShellContext = {
  answer: AgentRetrievalShellPick<typeof agentRetrievalShellAnswerKeys>;
  form: AgentRetrievalShellPick<typeof agentRetrievalShellFormKeys>;
  page: AgentRetrievalShellPick<typeof agentRetrievalShellPageKeys>;
  progress: AgentRetrievalShellPick<typeof agentRetrievalShellProgressKeys>;
  tabs: AgentRetrievalShellPick<typeof agentRetrievalShellTabKeys>;
  trace: AgentRetrievalShellPick<typeof agentRetrievalShellTraceKeys>;
  workspace: AgentRetrievalShellPick<typeof agentRetrievalShellWorkspaceKeys>;
};

function pickConsoleKeys<TKeys extends readonly (keyof ConsoleContext)[]>(
  context: ConsoleContext,
  keys: TKeys,
): AgentRetrievalShellPick<TKeys> {
  return Object.fromEntries(keys.map((key) => [key, context[key]])) as AgentRetrievalShellPick<TKeys>;
}

export function pickAgentRetrievalShellContext(context: ConsoleContext): AgentRetrievalShellContext {
  return {
    answer: pickConsoleKeys(context, agentRetrievalShellAnswerKeys),
    form: pickConsoleKeys(context, agentRetrievalShellFormKeys),
    page: pickConsoleKeys(context, agentRetrievalShellPageKeys),
    progress: pickConsoleKeys(context, agentRetrievalShellProgressKeys),
    tabs: pickConsoleKeys(context, agentRetrievalShellTabKeys),
    trace: pickConsoleKeys(context, agentRetrievalShellTraceKeys),
    workspace: pickConsoleKeys(context, agentRetrievalShellWorkspaceKeys),
  };
}
