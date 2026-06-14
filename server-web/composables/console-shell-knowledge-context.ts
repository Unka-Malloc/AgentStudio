import type { useConsole } from "./useConsole";

type ConsoleContext = ReturnType<typeof useConsole>;

const knowledgeShellPageKeys = [
  "canMaintainKnowledge",
  "canReadKnowledge",
  "hasFeature",
  "infoFeedModelOptions",
  "ingestJob",
  "knowledgeManagementPanel",
  "knowledgeManagementPanelOptionBarOptions",
  "normalizedManifest",
] as const satisfies readonly (keyof ConsoleContext)[];

const knowledgeShellViewStateKeys = [
  "collapsedWordBagIds",
  "knowledgeManagementPanel",
  "knowledgeTab",
  "toggleWordCloudCollapsed",
] as const satisfies readonly (keyof ConsoleContext)[];

const knowledgeShellLibraryKeys = [
  "canMaintainKnowledge",
  "ingestJob",
  "knowledgeIngestExternalProvider",
  "knowledgeIngestExternalRefs",
  "knowledgeIngestExternalTargetLabels",
  "knowledgeIngestTargets",
  "knowledgeIngestTeamRefs",
  "knowledgeIngestUserRefs",
  "refreshExpertRules",
  "refreshIngestJob",
] as const satisfies readonly (keyof ConsoleContext)[];

const knowledgeShellIngestKeys = [
  "busyKey",
  "canSubmitKnowledgeIngest",
  "canWriteJobs",
  "ingestFiles",
  "ingestJob",
  "ingestProgress",
  "knowledgeIngestTargetValidationMessage",
  "normalizedManifest",
  "onIngestFilesSelected",
  "uploadFilesToKnowledge",
] as const satisfies readonly (keyof ConsoleContext)[];

const knowledgeShellMaintenanceKeys = [
  "canAdminKnowledge",
  "canMaintainKnowledge",
  "enabledStringOptionBarOptions",
  "knowledgeConfigGroupDescription",
  "knowledgeConsole",
  "knowledgeSchema",
  "maintenanceFieldValue",
  "maintenanceJson",
  "saveKnowledgeMaintenance",
  "setMaintenanceFieldFromEvent",
  "setMaintenanceFieldValue",
] as const satisfies readonly (keyof ConsoleContext)[];

const knowledgeShellRulesKeys = [
  "addVocabularyEntry",
  "busyKey",
  "canAdminKnowledge",
  "deleteVocabularyEntry",
  "displayedVocabularyEntries",
  "emailReportSeriesRules",
  "emailSynonymRules",
  "expertRuleEnabled",
  "expertVocabularyDraft",
  "goldenRuleItems",
  "goldenRulePackageTitle",
  "goldenRulePackages",
  "hiddenVocabularyEntryCount",
  "highlightedConfigTarget",
  "publishRuleAuthoringPackage",
  "ruleActionOptionBarOptions",
  "ruleAuthoringCanSubmit",
  "ruleAuthoringForm",
  "ruleAuthoringModelOptions",
  "ruleAuthoringResult",
  "ruleCreationMode",
  "ruleMatchStrategyOptionBarOptions",
  "ruleScopeOptionBarOptions",
  "rulesText",
  "runRuleAuthoringChat",
  "saveExpertVocabulary",
  "saveRules",
  "setEmailRuleEntryEnabled",
  "setVocabularyEntryEnabled",
  "showAllVocabularyEntries",
  "toggleGoldenRuleEnabled",
  "updateVocabularyDomains",
  "updateVocabularyKeywords",
  "updateVocabularyPath",
  "vocabularyEntryPath",
  "vocabularySearch",
] as const satisfies readonly (keyof ConsoleContext)[];

const knowledgeShellWordCloudKeys = [
  "addChildWordCloud",
  "addManualWordCloud",
  "addTermActionToCloud",
  "addTermInputToCloud",
  "busyKey",
  "canBrowseServerPaths",
  "canWriteKnowledge",
  "clearRemovedTermsFromCloud",
  "clearWordCloudCorpusPaths",
  "collapsedWordBagIds",
  "openWordCloudCorpusDirectoryPicker",
  "openWordCloudCorpusFilePicker",
  "pinWordCloud",
  "pinnedWordBagIds",
  "removeTermFromCloud",
  "removeWordCloudCorpusPath",
  "saveWordCloud",
  "selectWordCloud",
  "selectedWordCloud",
  "setWordCloudTermInput",
  "toggleWordCloudActionMenu",
  "toggleWordCloudCollapsed",
  "updateWordCloudField",
  "wordBagActionMenuId",
  "wordCloudCardRows",
  "wordCloudCardStyle",
  "wordCloudCorpusPathLabel",
  "wordCloudCorpusPathSummary",
  "wordCloudCorpusPaths",
  "wordCloudDraft",
  "wordCloudMessages",
  "wordCloudModelAlias",
  "wordCloudState",
  "wordCloudTermInputs",
  "wordCloudTerms",
  "wordCloudVisibleTerms",
] as const satisfies readonly (keyof ConsoleContext)[];

export type KnowledgeShellKey =
  | (typeof knowledgeShellPageKeys)[number]
  | (typeof knowledgeShellViewStateKeys)[number]
  | (typeof knowledgeShellLibraryKeys)[number]
  | (typeof knowledgeShellIngestKeys)[number]
  | (typeof knowledgeShellMaintenanceKeys)[number]
  | (typeof knowledgeShellRulesKeys)[number]
  | (typeof knowledgeShellWordCloudKeys)[number];

type KnowledgeShellPick<TKeys extends readonly (keyof ConsoleContext)[]> =
  Pick<ConsoleContext, TKeys[number]>;

export type KnowledgeShellContext = {
  ingest: KnowledgeShellPick<typeof knowledgeShellIngestKeys>;
  libraryRuntime: KnowledgeShellPick<typeof knowledgeShellLibraryKeys>;
  maintenance: KnowledgeShellPick<typeof knowledgeShellMaintenanceKeys>;
  page: KnowledgeShellPick<typeof knowledgeShellPageKeys>;
  rules: KnowledgeShellPick<typeof knowledgeShellRulesKeys>;
  viewState: KnowledgeShellPick<typeof knowledgeShellViewStateKeys>;
  wordCloud: KnowledgeShellPick<typeof knowledgeShellWordCloudKeys>;
};

function pickConsoleKeys<TKeys extends readonly (keyof ConsoleContext)[]>(
  context: ConsoleContext,
  keys: TKeys,
): KnowledgeShellPick<TKeys> {
  return Object.fromEntries(keys.map((key) => [key, context[key]])) as KnowledgeShellPick<TKeys>;
}

export function pickKnowledgeShellContext(context: ConsoleContext): KnowledgeShellContext {
  return {
    ingest: pickConsoleKeys(context, knowledgeShellIngestKeys),
    libraryRuntime: pickConsoleKeys(context, knowledgeShellLibraryKeys),
    maintenance: pickConsoleKeys(context, knowledgeShellMaintenanceKeys),
    page: pickConsoleKeys(context, knowledgeShellPageKeys),
    rules: pickConsoleKeys(context, knowledgeShellRulesKeys),
    viewState: pickConsoleKeys(context, knowledgeShellViewStateKeys),
    wordCloud: pickConsoleKeys(context, knowledgeShellWordCloudKeys),
  };
}
