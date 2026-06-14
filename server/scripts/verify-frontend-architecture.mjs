import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const allowedBridgeFiles = new Set([
  "server-web/components/BridgeDownloadButton.vue",
]);

const allowedHtmlRenderFiles = new Set([
  "server-web/components/SafeHtmlBlock.vue",
]);

const allowedUseConsoleFiles = new Set([
  "server-web/composables/useServerConsoleShell.ts",
]);

function normalizePosix(input) {
  return input.split(path.sep).join("/");
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listSourceFiles(rootDir, predicate) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(absolutePath, predicate));
      continue;
    }
    if (entry.isFile() && predicate(absolutePath)) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function readRelativeFiles(relativeRoots, predicate) {
  const files = [];
  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = path.join(repoRoot, relativeRoot);
    files.push(...await listSourceFiles(absoluteRoot, predicate));
  }
  return Promise.all(files.map(async (absolutePath) => ({
    absolutePath,
    relativePath: normalizePosix(path.relative(repoRoot, absolutePath)),
    text: await fs.readFile(absolutePath, "utf8"),
  })));
}

async function readRequiredFile(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function assertAllowedOnly({
  files,
  allowedFiles,
  predicate,
  message,
}) {
  const violations = files
    .filter((file) => predicate(file.text))
    .map((file) => file.relativePath)
    .filter((relativePath) => !allowedFiles.has(relativePath))
    .sort();
  assert.deepEqual(violations, [], message);
}

function assertNoMissingAllowlistEntries({
  files,
  allowedFiles,
  predicate,
  message,
}) {
  const actualFiles = new Set(
    files
      .filter((file) => predicate(file.text))
      .map((file) => file.relativePath),
  );
  const staleEntries = [...allowedFiles]
    .filter((relativePath) => !actualFiles.has(relativePath))
    .sort();
  assert.deepEqual(staleEntries, [], message);
}

function destructuredKeysFromBlock(block) {
  return block
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim().replace(/,$/, "").trim())
    .filter(Boolean)
    .map((line) => line.split(":")[0].trim())
    .filter((key) => /^[A-Za-z_$][\w$]*$/.test(key));
}

function destructuredKeysFromCall(text, callName) {
  const keys = [];
  const callPattern = new RegExp(
    `const\\s*\\{([\\s\\S]*?)\\}\\s*=\\s*${escapeRegex(callName)}\\s*\\(\\s*\\)`,
    "g",
  );
  for (const match of text.matchAll(callPattern)) {
    keys.push(...destructuredKeysFromBlock(match[1]));
  }
  return keys;
}

function destructuredKeysFromAssignment(text, assignmentName) {
  const keys = [];
  const assignmentPattern = new RegExp(
    `const\\s*\\{([\\s\\S]*?)\\}\\s*=\\s*${escapeRegex(assignmentName)}\\s*;`,
    "g",
  );
  for (const match of text.matchAll(assignmentPattern)) {
    keys.push(...destructuredKeysFromBlock(match[1]));
  }
  return keys;
}

function quotedKeysFromConstArray(text, constName) {
  const match = text.match(new RegExp(`const\\s+${escapeRegex(constName)}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `${constName} must be declared as a const key array`);
  return [...match[1].matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((item) => item[1]);
}

function returnObjectShorthandKeys(text, functionName) {
  const match = text.match(new RegExp(`function\\s+${escapeRegex(functionName)}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?return\\s*\\{([\\s\\S]*?)\\n\\s*\\};\\n\\}`));
  assert.ok(match, `${functionName} must return an object literal`);
  return [...match[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/gm)].map((item) => item[1]);
}

async function main() {
  const viewAndComponentFiles = await readRelativeFiles(
    ["server-web/views", "server-web/components"],
    (absolutePath) => absolutePath.endsWith(".vue") || absolutePath.endsWith(".ts"),
  );
  const viewAndComposableFiles = await readRelativeFiles(
    ["server-web/views", "server-web/composables"],
    (absolutePath) => (absolutePath.endsWith(".vue") || absolutePath.endsWith(".ts")) &&
      !absolutePath.endsWith(path.join("server-web", "composables", "useConsole.ts")),
  );
  const shellContextConsumerFiles = await readRelativeFiles(
    ["server-web/views", "server-web/components", "server-web/composables"],
    (absolutePath) => absolutePath.endsWith(".vue") || absolutePath.endsWith(".ts"),
  );

  assertAllowedOnly({
    files: viewAndComponentFiles,
    allowedFiles: allowedBridgeFiles,
    predicate: (text) => /from\s+["'][^"']*\/lib\/bridge["']/.test(text),
    message: "view/component files must not import the global bridge facade outside the allowlisted download boundary",
  });
  assertNoMissingAllowlistEntries({
    files: viewAndComponentFiles,
    allowedFiles: allowedBridgeFiles,
    predicate: (text) => /from\s+["'][^"']*\/lib\/bridge["']/.test(text),
    message: "bridge import allowlist contains stale entries",
  });

  assertAllowedOnly({
    files: viewAndComponentFiles,
    allowedFiles: allowedBridgeFiles,
    predicate: (text) => /\bbridge\s*\./.test(text),
    message: "view/component files must not call bridge.* directly outside the allowlisted download boundary",
  });
  assertNoMissingAllowlistEntries({
    files: viewAndComponentFiles,
    allowedFiles: allowedBridgeFiles,
    predicate: (text) => /\bbridge\s*\./.test(text),
    message: "bridge boundary allowlist contains stale entries",
  });

  assertAllowedOnly({
    files: viewAndComponentFiles,
    allowedFiles: new Set(),
    predicate: (text) => /\bfetch\s*\(/.test(text),
    message: "view/component files must not call fetch() directly; use a domain client and controller",
  });

  assertAllowedOnly({
    files: viewAndComponentFiles,
    allowedFiles: new Set(),
    predicate: (text) => /["'`]\/api(?:\/|\?|["'`])/.test(text),
    message: "view/component files must not hard-code backend /api URLs; keep endpoint paths in server-web/lib/*-client.ts",
  });

  assertAllowedOnly({
    files: viewAndComponentFiles,
    allowedFiles: allowedHtmlRenderFiles,
    predicate: (text) => /\bv-html\b/.test(text),
    message: "v-html must stay centralized in SafeHtmlBlock",
  });
  assertNoMissingAllowlistEntries({
    files: viewAndComponentFiles,
    allowedFiles: allowedHtmlRenderFiles,
    predicate: (text) => /\bv-html\b/.test(text),
    message: "safe-html allowlist contains stale entries",
  });

  assertAllowedOnly({
    files: viewAndComposableFiles,
    allowedFiles: allowedUseConsoleFiles,
    predicate: (text) => /=\s*useConsole\s*\(/.test(text),
    message: "new direct useConsole() callers must use route/domain contexts instead",
  });
  assertNoMissingAllowlistEntries({
    files: viewAndComposableFiles,
    allowedFiles: allowedUseConsoleFiles,
    predicate: (text) => /=\s*useConsole\s*\(/.test(text),
    message: "useConsole() allowlist contains stale entries; remove entries as callers are migrated",
  });

  const bridgeText = await readRequiredFile("server-web/lib/bridge.ts");
  const bridgeTypesText = await readRequiredFile("server-web/lib/bridge-types.ts");
  const bridgeHttpText = await readRequiredFile("server-web/lib/bridge-http.ts");
  const authClientText = await readRequiredFile("server-web/lib/auth-client.ts");
  const authTypesText = await readRequiredFile("server-web/lib/auth-types.ts");
  const rootTypesText = await readRequiredFile("server-web/lib/types.ts");
  const agentTypesText = await readRequiredFile("server-web/lib/types/agent.ts");
  const runtimeTypesText = await readRequiredFile("server-web/lib/types/runtime.ts");
  const splitTypesText = await readRequiredFile("server-web/lib/types/split.ts");
  const splitEntitiesTypesText = await readRequiredFile("server-web/lib/types/split/entities.ts");
  const splitDocumentsTypesText = await readRequiredFile("server-web/lib/types/split/documents.ts");
  const splitJobsTypesText = await readRequiredFile("server-web/lib/types/split/jobs.ts");
  const splitPayloadTypesText = await readRequiredFile("server-web/lib/types/split/payload.ts");
  const splitResultTypesText = await readRequiredFile("server-web/lib/types/split/result.ts");
  const knowledgeTypesText = await readRequiredFile("server-web/lib/types/knowledge.ts");
  const knowledgeConsoleTypesText = await readRequiredFile("server-web/lib/types/knowledge/console.ts");
  const knowledgeReviewTypesText = await readRequiredFile("server-web/lib/types/knowledge/review.ts");
  const knowledgeRulesTypesText = await readRequiredFile("server-web/lib/types/knowledge/rules.ts");
  const knowledgeSearchTypesText = await readRequiredFile("server-web/lib/types/knowledge/search.ts");
  const knowledgeSourcesTypesText = await readRequiredFile("server-web/lib/types/knowledge/sources.ts");
  const knowledgeUploadTypesText = await readRequiredFile("server-web/lib/types/knowledge/upload.ts");
  const knowledgeWordCloudTypesText = await readRequiredFile("server-web/lib/types/knowledge/word-cloud.ts");
  const toolManagementTypesText = await readRequiredFile("server-web/lib/types/tool-management.ts");
  const maintenanceTypesText = await readRequiredFile("server-web/lib/types/maintenance.ts");
  const opsTypesText = await readRequiredFile("server-web/lib/types/ops.ts");
  const productionHealthTypesText = await readRequiredFile("server-web/lib/types/production-health.ts");
  const consoleStateTypesText = await readRequiredFile("server-web/lib/types/console-state.ts");
  const consoleI18nText = await readRequiredFile("server-web/i18n/console.ts");
  const consoleLocaleStateText = await readRequiredFile("server-web/i18n/console-locale-state.ts");
  const consoleTextLocalizerText = await readRequiredFile("server-web/i18n/console-text-localizer.ts");
  const consoleDynamicPatternTypesText = await readRequiredFile(
    "server-web/i18n/console-dynamic-pattern-types.ts",
  );
  const consoleDynamicPatternsText = await readRequiredFile("server-web/i18n/console-dynamic-patterns.ts");
  const consoleDynamicCountPatternsText = await readRequiredFile(
    "server-web/i18n/console-dynamic-count-patterns.ts",
  );
  const consoleDynamicStatusPatternsText = await readRequiredFile(
    "server-web/i18n/console-dynamic-status-patterns.ts",
  );
  const consoleMessagesText = await readRequiredFile("server-web/i18n/console-messages.ts");
  const consolePhrasesText = await readRequiredFile("server-web/i18n/console-phrases.ts");
  const consolePhraseTypesText = await readRequiredFile("server-web/i18n/console-phrase-types.ts");
  const consolePhraseShellCoreText = await readRequiredFile("server-web/i18n/console-phrases/shell-core.ts");
  const consolePhraseDebugText = await readRequiredFile("server-web/i18n/console-phrases/debug.ts");
  const consolePhraseKnowledgeText = await readRequiredFile("server-web/i18n/console-phrases/knowledge.ts");
  const consolePhraseGovernanceWorkspacesFeedText = await readRequiredFile(
    "server-web/i18n/console-phrases/governance-workspaces-feed.ts",
  );
  const consolePhraseOpsProductionText = await readRequiredFile(
    "server-web/i18n/console-phrases/ops-production.ts",
  );
  const consolePhraseSegmentsText = await readRequiredFile("server-web/i18n/console-phrases/segments.ts");
  const featuresCssText = await readRequiredFile("server-web/styles/features.css");
  const featureBaseCssText = await readRequiredFile("server-web/styles/features/base.css");
  const featureShellCssText = await readRequiredFile("server-web/styles/features/shell.css");
  const featureControlsCssText = await readRequiredFile("server-web/styles/features/controls.css");
  const featureTablesCssText = await readRequiredFile("server-web/styles/features/tables.css");
  const featurePanelsCssText = await readRequiredFile("server-web/styles/features/panels.css");
  const featureDashboardProgressCssText = await readRequiredFile("server-web/styles/features/dashboard-progress.css");
  const featureResponsiveCssText = await readRequiredFile("server-web/styles/features/responsive.css");
  const componentsCssText = await readRequiredFile("server-web/styles/components.css");
  const componentDashboardAlertsCssText = await readRequiredFile(
    "server-web/styles/components/dashboard-alerts.css",
  );
  const componentDashboardMetricsCssText = await readRequiredFile(
    "server-web/styles/components/dashboard-metrics.css",
  );
  const componentTablesFormsCssText = await readRequiredFile("server-web/styles/components/tables-forms.css");
  const componentSystemDetailsCssText = await readRequiredFile("server-web/styles/components/system-details.css");
  const componentRuntimeModulesCssText = await readRequiredFile("server-web/styles/components/runtime-modules.css");
  const componentModelLibraryCssText = await readRequiredFile("server-web/styles/components/model-library.css");
  const themesCssText = await readRequiredFile("server-web/styles/themes.css");
  const themeSystemDarkTokensCssText = await readRequiredFile("server-web/styles/themes/system-dark-tokens.css");
  const themeSystemDarkElementPlusCssText = await readRequiredFile(
    "server-web/styles/themes/system-dark-element-plus.css",
  );
  const themeSystemDarkApplicationCssText = await readRequiredFile(
    "server-web/styles/themes/system-dark-application.css",
  );
  const themeAppearancePresetsCssText = await readRequiredFile(
    "server-web/styles/themes/appearance-presets.css",
  );
  const appearancePresetConfigTexts = new Map([
    ["default-system", await readRequiredFile("server-web/appearance-presets/default-system.json")],
    ["geek-light-blue", await readRequiredFile("server-web/appearance-presets/geek-light-blue.json")],
    ["sunset-ember", await readRequiredFile("server-web/appearance-presets/sunset-ember.json")],
    ["tokyo-night", await readRequiredFile("server-web/appearance-presets/tokyo-night.json")],
    ["monokai", await readRequiredFile("server-web/appearance-presets/monokai.json")],
    ["cyberpunk", await readRequiredFile("server-web/appearance-presets/cyberpunk.json")],
    ["cappuccino-dark", await readRequiredFile("server-web/appearance-presets/cappuccino-dark.json")],
  ]);
  const layoutCssText = await readRequiredFile("server-web/styles/layout.css");
  const layoutShellSidebarCssText = await readRequiredFile("server-web/styles/layout/shell-sidebar.css");
  const layoutActionsCssText = await readRequiredFile("server-web/styles/layout/actions.css");
  const layoutCanvasTopbarStatusCssText = await readRequiredFile(
    "server-web/styles/layout/canvas-topbar-status.css",
  );
  const layoutTopbarAuthBrandCssText = await readRequiredFile(
    "server-web/styles/layout/topbar-auth-brand.css",
  );
  const layoutSidebarCollapseCssText = await readRequiredFile(
    "server-web/styles/layout/sidebar-collapse.css",
  );
  const layoutAuthTransitionScrollbarCssText = await readRequiredFile(
    "server-web/styles/layout/auth-transition-scrollbar.css",
  );
  const wordCloudCssText = await readRequiredFile("server-web/styles/views/word-cloud.css");
  const wordCloudStageCorpusCssText = await readRequiredFile(
    "server-web/styles/views/word-cloud/stage-corpus.css",
  );
  const wordCloudClassCardsCssText = await readRequiredFile(
    "server-web/styles/views/word-cloud/class-cards.css",
  );
  const wordCloudTermsLoadingCssText = await readRequiredFile(
    "server-web/styles/views/word-cloud/terms-loading.css",
  );
  const wordCloudEditorDialogsCssText = await readRequiredFile(
    "server-web/styles/views/word-cloud/editor-dialogs.css",
  );
  const debugAgentExploreCssText = await readRequiredFile("server-web/styles/views/debug-agent-explore.css");
  const debugAgentExploreDebugDistillationCssText = await readRequiredFile(
    "server-web/styles/views/debug-agent-explore/debug-distillation.css",
  );
  const debugAgentExploreExploreFormCssText = await readRequiredFile(
    "server-web/styles/views/debug-agent-explore/explore-form.css",
  );
  const debugAgentExploreRuleAuthoringCssText = await readRequiredFile(
    "server-web/styles/views/debug-agent-explore/rule-authoring.css",
  );
  const debugAgentExploreProgressHistoryCssText = await readRequiredFile(
    "server-web/styles/views/debug-agent-explore/progress-history.css",
  );
  const debugAgentExploreWorkspaceCssText = await readRequiredFile(
    "server-web/styles/views/debug-agent-explore/workspace.css",
  );
  const debugAgentExploreTraceResultsCssText = await readRequiredFile(
    "server-web/styles/views/debug-agent-explore/trace-results.css",
  );
  const knowledgeSourcesCssText = await readRequiredFile("server-web/styles/views/knowledge-sources.css");
  const knowledgeSourcesSourceOverviewCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-sources/source-overview.css",
  );
  const knowledgeSourcesLibraryBackendsCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-sources/library-backends.css",
  );
  const knowledgeSourcesImportExportCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-sources/import-export.css",
  );
  const knowledgeSourcesPreviewAuditCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-sources/preview-audit.css",
  );
  const infoFeedFlowCssText = await readRequiredFile("server-web/styles/views/info-feed-flow.css");
  const infoFeedFlowShellHistoryCssText = await readRequiredFile(
    "server-web/styles/views/info-feed-flow/shell-history.css",
  );
  const infoFeedFlowTrackResultsCssText = await readRequiredFile(
    "server-web/styles/views/info-feed-flow/track-results.css",
  );
  const infoFeedFlowContextAnswerCssText = await readRequiredFile(
    "server-web/styles/views/info-feed-flow/context-answer.css",
  );
  const infoFeedFlowConversationClarificationCssText = await readRequiredFile(
    "server-web/styles/views/info-feed-flow/conversation-clarification.css",
  );
  const infoFeedFlowFeedbackSummaryCssText = await readRequiredFile(
    "server-web/styles/views/info-feed-flow/feedback-summary.css",
  );
  const knowledgeMaintenanceCssText = await readRequiredFile("server-web/styles/views/knowledge-maintenance.css");
  const knowledgeMaintenanceRulesConfigCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-maintenance/rules-config.css",
  );
  const knowledgeMaintenanceSourcesLayoutCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-maintenance/sources-layout.css",
  );
  const knowledgeMaintenanceApprovalEmptyCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-maintenance/approval-empty.css",
  );
  const knowledgeMaintenanceDataSourceDialogCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-maintenance/data-source-dialog.css",
  );
  const knowledgeMaintenanceCompactMetricsCssText = await readRequiredFile(
    "server-web/styles/views/knowledge-maintenance/compact-metrics.css",
  );
  const adminRuntimeToolsCssText = await readRequiredFile("server-web/styles/views/admin-runtime-tools.css");
  const adminRuntimeToolsTablesCssText = await readRequiredFile(
    "server-web/styles/views/admin-runtime-tools/tables.css",
  );
  const adminRuntimeToolsRuntimeMetricsCssText = await readRequiredFile(
    "server-web/styles/views/admin-runtime-tools/runtime-metrics.css",
  );
  const adminRuntimeToolsMonitorMaintenanceCssText = await readRequiredFile(
    "server-web/styles/views/admin-runtime-tools/monitor-maintenance.css",
  );
  const adminRuntimeToolsAdminToolShellCssText = await readRequiredFile(
    "server-web/styles/views/admin-runtime-tools/admin-tool-shell.css",
  );
  const adminRuntimeToolsPermissionCardsCssText = await readRequiredFile(
    "server-web/styles/views/admin-runtime-tools/permission-cards.css",
  );
  const drawerPathDialogsCssText = await readRequiredFile("server-web/styles/views/drawer-path-dialogs.css");
  const drawerPathDialogsDrawerSettingsCssText = await readRequiredFile(
    "server-web/styles/views/drawer-path-dialogs/drawer-settings.css",
  );
  const drawerPathDialogsVocabularyRulesCssText = await readRequiredFile(
    "server-web/styles/views/drawer-path-dialogs/vocabulary-rules.css",
  );
  const drawerPathDialogsDialogShellsCssText = await readRequiredFile(
    "server-web/styles/views/drawer-path-dialogs/dialog-shells.css",
  );
  const drawerPathDialogsPathPickerControlsCssText = await readRequiredFile(
    "server-web/styles/views/drawer-path-dialogs/path-picker-controls.css",
  );
  const adminMaintenanceCssText = await readRequiredFile("server-web/styles/views/admin-maintenance.css");
  const adminMaintenanceMaintenancePermissionsCssText = await readRequiredFile(
    "server-web/styles/views/admin-maintenance/maintenance-permissions.css",
  );
  const adminMaintenanceChunkingShellCssText = await readRequiredFile(
    "server-web/styles/views/admin-maintenance/chunking-shell.css",
  );
  const adminMaintenanceChunkingInputsCssText = await readRequiredFile(
    "server-web/styles/views/admin-maintenance/chunking-inputs.css",
  );
  const adminMaintenanceChunkingBlockEditorCssText = await readRequiredFile(
    "server-web/styles/views/admin-maintenance/chunking-block-editor.css",
  );
  const adminMaintenanceChunkingListDetailCssText = await readRequiredFile(
    "server-web/styles/views/admin-maintenance/chunking-list-detail.css",
  );
  const shellKnowledgeSearchCssText = await readRequiredFile("server-web/styles/views/shell-and-knowledge-search.css");
  const shellKnowledgeSearchSearchWorkspaceCssText = await readRequiredFile(
    "server-web/styles/views/shell-and-knowledge-search/search-workspace.css",
  );
  const shellKnowledgeSearchLogReportCssText = await readRequiredFile(
    "server-web/styles/views/shell-and-knowledge-search/log-report.css",
  );
  const shellKnowledgeSearchConflictReviewCssText = await readRequiredFile(
    "server-web/styles/views/shell-and-knowledge-search/conflict-review.css",
  );
  const shellKnowledgeSearchResultListCssText = await readRequiredFile(
    "server-web/styles/views/shell-and-knowledge-search/result-list.css",
  );
  const responsiveSharedCssText = await readRequiredFile("server-web/styles/views/responsive-shared.css");
  const responsiveSharedWideLayoutCssText = await readRequiredFile(
    "server-web/styles/views/responsive-shared/wide-layout.css",
  );
  const responsiveSharedShellKnowledgeCssText = await readRequiredFile(
    "server-web/styles/views/responsive-shared/shell-knowledge.css",
  );
  const responsiveSharedAgentExploreCssText = await readRequiredFile(
    "server-web/styles/views/responsive-shared/agent-explore.css",
  );
  const responsiveSharedCompact720CssText = await readRequiredFile(
    "server-web/styles/views/responsive-shared/compact-720.css",
  );
  const responsiveSharedLogFilterA11yCssText = await readRequiredFile(
    "server-web/styles/views/responsive-shared/log-filter-a11y.css",
  );
  const infoFeedUtilsText = await readRequiredFile("server-web/composables/console-info-feed-utils.ts");
  const infoFeedStateUtilsText = await readRequiredFile("server-web/composables/console-info-feed-state-utils.ts");
  const infoFeedSharedUtilsText = await readRequiredFile("server-web/composables/console-info-feed-shared-utils.ts");
  const infoFeedAttachmentUtilsText = await readRequiredFile(
    "server-web/composables/console-info-feed-attachment-utils.ts",
  );
  const infoFeedRunStateUtilsText = await readRequiredFile(
    "server-web/composables/console-info-feed-run-state-utils.ts",
  );
  const infoFeedHistoryUtilsText = await readRequiredFile("server-web/composables/console-info-feed-history-utils.ts");
  const infoFeedAgentQueryUtilsText = await readRequiredFile(
    "server-web/composables/console-info-feed-agent-query-utils.ts",
  );
  const infoFeedSummaryUtilsText = await readRequiredFile("server-web/composables/console-info-feed-summary-utils.ts");
  const infoFeedSourceContextUtilsText = await readRequiredFile(
    "server-web/composables/console-info-feed-source-context-utils.ts",
  );
  const infoFeedSourceSummaryUtilsText = await readRequiredFile(
    "server-web/composables/console-info-feed-source-summary-utils.ts",
  );
  const infoFeedSummaryQuestionUtilsText = await readRequiredFile(
    "server-web/composables/console-info-feed-summary-question-utils.ts",
  );
  const infoFeedClarificationUtilsText = await readRequiredFile(
    "server-web/composables/console-info-feed-clarification-utils.ts",
  );
  const infoFeedDerivationControllerText = await readRequiredFile(
    "server-web/composables/console-info-feed-derivation-controller.ts",
  );
  const infoFeedControllerText = await readRequiredFile("server-web/composables/console-info-feed-controller.ts");
  const infoFeedComposerPanelText = await readRequiredFile(
    "server-web/components/feed/InfoFeedComposerPanel.vue",
  );
  const infoFeedTrackGridText = await readRequiredFile(
    "server-web/components/feed/InfoFeedTrackGrid.vue",
  );
  const infoFeedCurrentUserCardText = await readRequiredFile(
    "server-web/components/feed/InfoFeedCurrentUserCard.vue",
  );
  const infoFeedSummaryPanelsText = await readRequiredFile(
    "server-web/components/feed/InfoFeedSummaryPanels.vue",
  );
  const infoFeedTurnCardsText = await readRequiredFile(
    "server-web/components/feed/InfoFeedTurnCards.vue",
  );
  const infoFeedKeywordControllerText = await readRequiredFile(
    "server-web/composables/console-info-feed-keyword-controller.ts",
  );
  const infoFeedModelControllerText = await readRequiredFile(
    "server-web/composables/console-info-feed-model-controller.ts",
  );
  const agentRegistryClientText = await readRequiredFile("server-web/lib/agent-registry-client.ts");
  const agentSyncClientText = await readRequiredFile("server-web/lib/agent-sync-client.ts");
  const agentSettingsClientText = await readRequiredFile("server-web/lib/agent-settings-client.ts");
  const codexOAuthClientText = await readRequiredFile("server-web/lib/codex-oauth-client.ts");
  const consoleStateClientText = await readRequiredFile("server-web/lib/console-state-client.ts");
  const discoveryClientText = await readRequiredFile("server-web/lib/discovery-client.ts");
  const maintenanceAgentClientText = await readRequiredFile("server-web/lib/maintenance-agent-client.ts");
  const runtimeDependenciesText = await readRequiredFile("server-web/lib/runtime-dependencies.ts");
  const runtimeDependenciesClientText = await readRequiredFile("server-web/lib/runtime-dependencies-client.ts");
  const runtimeInfoClientText = await readRequiredFile("server-web/lib/runtime-info-client.ts");
  const runtimeMountsClientText = await readRequiredFile("server-web/lib/runtime-mounts-client.ts");
  const serverEventsClientText = await readRequiredFile("server-web/lib/server-events-client.ts");
  const knowledgeDocumentsText = await readRequiredFile("server-web/lib/knowledge-documents.ts");
  const knowledgeDocumentsClientText = await readRequiredFile("server-web/lib/knowledge-documents-client.ts");
  const knowledgeDistillationWorkbenchText = await readRequiredFile("server-web/lib/knowledge-distillation-workbench.ts");
  const knowledgeUploadSessionText = await readRequiredFile("server-web/lib/knowledge-upload-session.ts");
  const uploadSessionClientText = await readRequiredFile("server-web/lib/upload-session-client.ts");
  const jobsClientText = await readRequiredFile("server-web/lib/jobs-client.ts");
  const productionHealthText = await readRequiredFile("server-web/lib/production-health.ts");
  const productionHealthClientText = await readRequiredFile("server-web/lib/production-health-client.ts");
  const opsMonitorClientText = await readRequiredFile("server-web/lib/ops-monitor-client.ts");
  const contextCompilerClientText = await readRequiredFile("server-web/lib/context-compiler-client.ts");
  const authorizationGovernanceClientText = await readRequiredFile("server-web/lib/authorization-governance-client.ts");
  const toolManagementClientText = await readRequiredFile("server-web/lib/tool-management-client.ts");
  const agentGatewayClientText = await readRequiredFile("server-web/lib/agent-gateway-client.ts");
  const knowledgeSourcesClientText = await readRequiredFile("server-web/lib/knowledge-sources-client.ts");
  const knowledgeSearchClientText = await readRequiredFile("server-web/lib/knowledge-search-client.ts");
  const knowledgeReviewClientText = await readRequiredFile("server-web/lib/knowledge-review-client.ts");
  const knowledgeWordCloudClientText = await readRequiredFile("server-web/lib/knowledge-word-cloud-client.ts");
  const knowledgeMaintenanceClientText = await readRequiredFile("server-web/lib/knowledge-maintenance-client.ts");
  const knowledgeRulesClientText = await readRequiredFile("server-web/lib/knowledge-rules-client.ts");
  const agentExploreClientText = await readRequiredFile("server-web/lib/agent-explore-client.ts");
  const workspacesClientText = await readRequiredFile("server-web/lib/workspaces-client.ts");
  const authControllerText = await readRequiredFile("server-web/composables/console-auth-controller.ts");
  const systemLogRowControllerText = await readRequiredFile(
    "server-web/composables/console-system-log-row-controller.ts",
  );
  const systemLogBaseRowControllerText = await readRequiredFile(
    "server-web/composables/console-system-log-base-row-controller.ts",
  );
  const systemLogStatusRowControllerText = await readRequiredFile(
    "server-web/composables/console-system-log-status-row-controller.ts",
  );
  const systemLogRowUtilsText = await readRequiredFile(
    "server-web/composables/console-system-log-row-utils.ts",
  );
  const jobControllerText = await readRequiredFile(
    "server-web/composables/console-job-controller.ts",
  );
  const jobDisplayUtilsText = await readRequiredFile(
    "server-web/composables/console-job-display-utils.ts",
  );
  const clientControllerText = await readRequiredFile(
    "server-web/composables/console-client-controller.ts",
  );
  const clientDisplayUtilsText = await readRequiredFile(
    "server-web/composables/console-client-display-utils.ts",
  );
  const clientsViewText = await readRequiredFile(
    "server-web/views/admin/ClientsView.vue",
  );
  const optionBarControllerText = await readRequiredFile(
    "server-web/composables/console-option-bar-controller.ts",
  );
  const busyControllerText = await readRequiredFile(
    "server-web/composables/console-busy-controller.ts",
  );
  const knowledgeMaintenanceControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-maintenance-controller.ts",
  );
  const maintenanceAgentControllerText = await readRequiredFile(
    "server-web/composables/console-maintenance-agent-controller.ts",
  );
  const maintenanceAgentViewControllerText = await readRequiredFile(
    "server-web/composables/console-maintenance-agent-view-controller.ts",
  );
  const maintenanceAgentViewContextText = await readRequiredFile(
    "server-web/composables/maintenanceAgentViewContext.ts",
  );
  const settingsBridgeControllerText = await readRequiredFile(
    "server-web/composables/console-settings-bridge-controller.ts",
  );
  const settingsPersistenceControllerText = await readRequiredFile(
    "server-web/composables/console-settings-persistence-controller.ts",
  );
  const modelProbeControllerText = await readRequiredFile(
    "server-web/composables/console-model-probe-controller.ts",
  );
  const modelLibraryControllerText = await readRequiredFile(
    "server-web/composables/console-model-library-controller.ts",
  );
  const modelEntryBindingControllerText = await readRequiredFile(
    "server-web/composables/console-model-entry-binding-controller.ts",
  );
  const modelUtilsText = await readRequiredFile(
    "server-web/composables/console-model-utils.ts",
  );
  const agentModelOptionBarText = await readRequiredFile(
    "server-web/components/AgentModelOptionBar.vue",
  );
  const agentModelOptionBarControllerText = await readRequiredFile(
    "server-web/composables/agentModelOptionBarController.ts",
  );
  const agentModelOptionBarStyleText = await readRequiredFile(
    "server-web/components/agent-model-option-bar/AgentModelOptionBar.css",
  );
  const modelRepositoryControllerText = await readRequiredFile(
    "server-web/composables/console-model-repository-controller.ts",
  );
  const agentConfigViewText = await readRequiredFile(
    "server-web/views/admin/AgentConfigView.vue",
  );
  const agentModelLibraryPanelText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelLibraryPanel.vue",
  );
  const agentModelEntryCardText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelEntryCard.vue",
  );
  const agentModelEntryCardContextText = await readRequiredFile(
    "server-web/composables/agentModelEntryCardContext.ts",
  );
  const agentModelEntryHeaderText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelEntryHeader.vue",
  );
  const agentModelEntrySummaryActionsText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelEntrySummaryActions.vue",
  );
  const agentModelProviderFieldsText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelProviderFields.vue",
  );
  const agentModelAccessPanelText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelAccessPanel.vue",
  );
  const agentModelBindingsPanelText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelBindingsPanel.vue",
  );
  const agentModelPromptPanelText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentModelPromptPanel.vue",
  );
  const agentInvocationSettingsPanelText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentInvocationSettingsPanel.vue",
  );
  const agentConfigInvocationToggleText = await readRequiredFile(
    "server-web/components/admin/agent-config/AgentConfigInvocationToggle.vue",
  );
  const agentPermissionsViewText = await readRequiredFile(
    "server-web/views/admin/AgentPermissionsView.vue",
  );
  const authorizationGovernanceCardText = await readRequiredFile(
    "server-web/components/admin/AuthorizationGovernanceCard.vue",
  );
  const authorizationGovernanceCardContextText = await readRequiredFile(
    "server-web/composables/authorizationGovernanceCardContext.ts",
  );
  const authorizationGovernanceMetricsText = await readRequiredFile(
    "server-web/components/admin/authorization-governance/AuthorizationGovernanceMetrics.vue",
  );
  const authorizationGovernanceEditorText = await readRequiredFile(
    "server-web/components/admin/authorization-governance/AuthorizationGovernanceEditor.vue",
  );
  const authorizationGovernanceGridText = await readRequiredFile(
    "server-web/components/admin/authorization-governance/AuthorizationGovernanceGrid.vue",
  );
  const authorizationGovernancePanelText = await readRequiredFile(
    "server-web/components/admin/authorization-governance/AuthorizationGovernancePanel.vue",
  );
  const authorizationGovernancePanelRowsText = await readRequiredFile(
    "server-web/components/admin/authorization-governance/authorization-governance-panel-rows.ts",
  );
  const authorizationGovernanceCardStyleText = await readRequiredFile(
    "server-web/components/admin/authorization-governance/AuthorizationGovernanceCard.css",
  );
  const agentPermissionGroupsPanelText = await readRequiredFile(
    "server-web/components/admin/agent-permissions/AgentPermissionGroupsPanel.vue",
  );
  const agentPermissionGroupCardText = await readRequiredFile(
    "server-web/components/admin/agent-permissions/AgentPermissionGroupCard.vue",
  );
  const toolGrantCreateCardText = await readRequiredFile(
    "server-web/components/admin/agent-permissions/ToolGrantCreateCard.vue",
  );
  const toolGrantListCardText = await readRequiredFile(
    "server-web/components/admin/agent-permissions/ToolGrantListCard.vue",
  );
  const grantToolRulePanelText = await readRequiredFile(
    "server-web/components/admin/agent-permissions/GrantToolRulePanel.vue",
  );
  const toolPolicyPreviewPanelText = await readRequiredFile(
    "server-web/components/admin/agent-permissions/ToolPolicyPreviewPanel.vue",
  );
  const storageViewText = await readRequiredFile(
    "server-web/views/admin/StorageView.vue",
  );
  const storageViewControllerText = await readRequiredFile(
    "server-web/composables/console-storage-view-controller.ts",
  );
  const storageViewContextText = await readRequiredFile(
    "server-web/composables/storageViewContext.ts",
  );
  const storageOverviewCardText = await readRequiredFile(
    "server-web/components/admin/storage/StorageOverviewCard.vue",
  );
  const storageRuntimeCardText = await readRequiredFile(
    "server-web/components/admin/storage/StorageRuntimeCard.vue",
  );
  const storageDiscoveryCardText = await readRequiredFile(
    "server-web/components/admin/storage/StorageDiscoveryCard.vue",
  );
  const storageSessionCardText = await readRequiredFile(
    "server-web/components/admin/storage/StorageSessionCard.vue",
  );
  const maintenanceAgentViewText = await readRequiredFile(
    "server-web/views/admin/MaintenanceAgentView.vue",
  );
  const maintenanceAgentSummaryCardText = await readRequiredFile(
    "server-web/components/admin/maintenance-agent/MaintenanceAgentSummaryCard.vue",
  );
  const maintenanceAgentPolicyPanelText = await readRequiredFile(
    "server-web/components/admin/maintenance-agent/MaintenanceAgentPolicyPanel.vue",
  );
  const maintenanceAgentActionGridText = await readRequiredFile(
    "server-web/components/admin/maintenance-agent/MaintenanceAgentActionGrid.vue",
  );
  const maintenanceAgentRunListText = await readRequiredFile(
    "server-web/components/admin/maintenance-agent/MaintenanceAgentRunList.vue",
  );
  const maintenanceAgentRunDetailText = await readRequiredFile(
    "server-web/components/admin/maintenance-agent/MaintenanceAgentRunDetail.vue",
  );
  const opsMonitorViewText = await readRequiredFile(
    "server-web/views/admin/OpsMonitorView.vue",
  );
  const jobsViewText = await readRequiredFile(
    "server-web/views/admin/JobsView.vue",
  );
  const sourceCardText = await readRequiredFile(
    "server-web/components/sources/SourceCard.vue",
  );
  const opsMonitorViewControllerText = await readRequiredFile(
    "server-web/composables/console-ops-monitor-view-controller.ts",
  );
  const opsMonitorViewContextText = await readRequiredFile(
    "server-web/composables/opsMonitorViewContext.ts",
  );
  const opsMonitorSummaryCardText = await readRequiredFile(
    "server-web/components/admin/ops-monitor/OpsMonitorSummaryCard.vue",
  );
  const opsMonitorClientRuntimeCardText = await readRequiredFile(
    "server-web/components/admin/ops-monitor/OpsMonitorClientRuntimeCard.vue",
  );
  const opsMonitorProcessTableText = await readRequiredFile(
    "server-web/components/admin/ops-monitor/OpsMonitorProcessTable.vue",
  );
  const opsMonitorAlertsPanelText = await readRequiredFile(
    "server-web/components/admin/ops-monitor/OpsMonitorAlertsPanel.vue",
  );
  const historySessionPanelText = await readRequiredFile(
    "server-web/components/HistorySessionPanel.vue",
  );
  const historySessionPanelStyleText = await readRequiredFile(
    "server-web/components/HistorySessionPanel.css",
  );
  const pathPickerControllerText = await readRequiredFile(
    "server-web/composables/console-path-picker-controller.ts",
  );
  const pathPickerActionControllerText = await readRequiredFile(
    "server-web/composables/console-path-picker-action-controller.ts",
  );
  const refreshStateControllerText = await readRequiredFile(
    "server-web/composables/console-refresh-state-controller.ts",
  );
  const serverEventControllerText = await readRequiredFile(
    "server-web/composables/console-server-event-controller.ts",
  );
  const stateEventReducerControllerText = await readRequiredFile(
    "server-web/composables/console-state-event-reducer-controller.ts",
  );
  const codexOAuthControllerText = await readRequiredFile(
    "server-web/composables/console-codex-oauth-controller.ts",
  );
  const featureAccessControllerText = await readRequiredFile(
    "server-web/composables/console-feature-access-controller.ts",
  );
  const navigationControllerText = await readRequiredFile(
    "server-web/composables/console-navigation-controller.ts",
  );
  const runtimeLifecycleControllerText = await readRequiredFile(
    "server-web/composables/console-runtime-lifecycle-controller.ts",
  );
  const discoveryControllerText = await readRequiredFile(
    "server-web/composables/console-discovery-controller.ts",
  );
  const runtimeMountControllerText = await readRequiredFile(
    "server-web/composables/console-runtime-mount-controller.ts",
  );
  const runtimeModuleDisplayUtilsText = await readRequiredFile(
    "server-web/composables/console-runtime-module-display-utils.ts",
  );
  const consoleRuntimeModulesPanelText = await readRequiredFile(
    "server-web/components/shell/ConsoleRuntimeModulesPanel.vue",
  );
  const modulesViewText = await readRequiredFile(
    "server-web/views/admin/ModulesView.vue",
  );
  const modulesViewControllerText = await readRequiredFile(
    "server-web/composables/console-modules-view-controller.ts",
  );
  const modulesViewContextText = await readRequiredFile(
    "server-web/composables/modulesViewContext.ts",
  );
  const runtimeModulesPanelText = await readRequiredFile(
    "server-web/components/admin/modules/RuntimeModulesPanel.vue",
  );
  const runtimeModuleGroupText = await readRequiredFile(
    "server-web/components/admin/modules/RuntimeModuleGroup.vue",
  );
  const runtimeModuleConfigItemText = await readRequiredFile(
    "server-web/components/admin/modules/RuntimeModuleConfigItem.vue",
  );
  const runtimeDownloadsViewText = await readRequiredFile(
    "server-web/views/admin/RuntimeDownloadsView.vue",
  );
  const runtimeDownloadsViewControllerText = await readRequiredFile(
    "server-web/composables/console-runtime-downloads-view-controller.ts",
  );
  const runtimeDownloadsViewContextText = await readRequiredFile(
    "server-web/composables/runtimeDownloadsViewContext.ts",
  );
  const runtimeDownloadsPanelText = await readRequiredFile(
    "server-web/components/admin/runtime-downloads/RuntimeDownloadsPanel.vue",
  );
  const runtimeDownloadsSummaryCardText = await readRequiredFile(
    "server-web/components/admin/runtime-downloads/RuntimeDownloadsSummaryCard.vue",
  );
  const runtimeDependencyListCardText = await readRequiredFile(
    "server-web/components/admin/runtime-downloads/RuntimeDependencyListCard.vue",
  );
  const runtimeDependencyResultCardText = await readRequiredFile(
    "server-web/components/admin/runtime-downloads/RuntimeDependencyResultCard.vue",
  );
  const opsMonitorControllerText = await readRequiredFile(
    "server-web/composables/console-ops-monitor-controller.ts",
  );
  const dashboardAlertControllerText = await readRequiredFile(
    "server-web/composables/console-dashboard-alert-controller.ts",
  );
  const dashboardConfigurationAlertControllerText = await readRequiredFile(
    "server-web/composables/console-dashboard-configuration-alert-controller.ts",
  );
  const dashboardAlertInboxControllerText = await readRequiredFile(
    "server-web/composables/console-dashboard-alert-inbox-controller.ts",
  );
  const contextCompilerControllerText = await readRequiredFile(
    "server-web/composables/console-context-compiler-controller.ts",
  );
  const agentPermissionsControllerText = await readRequiredFile(
    "server-web/composables/console-agent-permissions-view-controller.ts",
  );
  const mcpAuthorizationControllerText = await readRequiredFile(
    "server-web/composables/console-mcp-authorization-controller.ts",
  );
  const approvalFlowControllerText = await readRequiredFile(
    "server-web/composables/console-approval-flow-view-controller.ts",
  );
  const approvalFlowCardListText = await readRequiredFile(
    "server-web/components/approval/ApprovalFlowCardList.vue",
  );
  const toolManagementControllerText = await readRequiredFile(
    "server-web/composables/console-tool-management-controller.ts",
  );
  const toolDisplayUtilsText = await readRequiredFile(
    "server-web/composables/console-tool-display-utils.ts",
  );
  const toolsViewText = await readRequiredFile(
    "server-web/views/admin/ToolsView.vue",
  );
  const toolGrantsControllerText = await readRequiredFile(
    "server-web/composables/console-tool-grants-controller.ts",
  );
  const knowledgeSourceControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-source-controller.ts",
  );
  const knowledgeEvidenceControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-evidence-controller.ts",
  );
  const knowledgeEvidenceRenderControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-evidence-render-controller.ts",
  );
  const knowledgeEvidenceLoaderControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-evidence-loader-controller.ts",
  );
  const knowledgeFeedbackControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-feedback-controller.ts",
  );
  const knowledgeReviewControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-review-controller.ts",
  );
  const knowledgeRecallControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-recall-controller.ts",
  );
  const knowledgeRecallTargetControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-recall-target-controller.ts",
  );
  const knowledgeRecallRunnerControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-recall-runner-controller.ts",
  );
  const knowledgeSearchStateControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-search-state-controller.ts",
  );
  const knowledgeRecallTypesText = await readRequiredFile(
    "server-web/composables/console-knowledge-recall-types.ts",
  );
  const knowledgeViewConsoleText = await readRequiredFile("server-web/composables/useKnowledgeViewConsole.ts");
  const useDebugViewConsoleText = await readRequiredFile("server-web/composables/useDebugViewConsole.ts");
  const agentRetrievalViewContextText = await readRequiredFile(
    "server-web/composables/agentRetrievalViewContext.ts",
  );
  const agentRetrievalDebugPanelText = await readRequiredFile(
    "server-web/components/debug/AgentRetrievalDebugPanel.vue",
  );
  const agentRetrievalFormText = await readRequiredFile(
    "server-web/components/debug/AgentRetrievalForm.vue",
  );
  const agentRetrievalProgressAndHistoryText = await readRequiredFile(
    "server-web/components/debug/AgentRetrievalProgressAndHistory.vue",
  );
  const agentRetrievalTabStripText = await readRequiredFile(
    "server-web/components/debug/AgentRetrievalTabStrip.vue",
  );
  const agentRetrievalWorkspaceText = await readRequiredFile(
    "server-web/components/debug/AgentRetrievalWorkspace.vue",
  );
  const agentRetrievalTraceCardText = await readRequiredFile(
    "server-web/components/debug/AgentRetrievalTraceCard.vue",
  );
  const agentRetrievalAnswerPanelText = await readRequiredFile(
    "server-web/components/debug/AgentRetrievalAnswerPanel.vue",
  );
  const knowledgeViewContextText = await readRequiredFile("server-web/composables/knowledgeViewContext.ts");
  const knowledgeViewText = await readRequiredFile("server-web/views/KnowledgeView.vue");
  const knowledgeViewStateControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-view-state-controller.ts",
  );
  const knowledgeLibraryControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-library-controller.ts",
  );
  const knowledgeLibraryProjectionControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-library-projection-controller.ts",
  );
  const knowledgeIngestTargetControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-ingest-target-controller.ts",
  );
  const wordCloudCorpusControllerText = await readRequiredFile(
    "server-web/composables/console-word-cloud-corpus-controller.ts",
  );
  const wordCloudEditorControllerText = await readRequiredFile(
    "server-web/composables/console-word-cloud-editor-controller.ts",
  );
  const wordCloudCardControllerText = await readRequiredFile(
    "server-web/composables/console-word-cloud-card-controller.ts",
  );
  const wordCloudTermControllerText = await readRequiredFile(
    "server-web/composables/console-word-cloud-term-controller.ts",
  );
  const wordCloudWorkflowControllerText = await readRequiredFile(
    "server-web/composables/console-word-cloud-workflow-controller.ts",
  );
  const knowledgeWordCloudPanelText = await readRequiredFile(
    "server-web/components/knowledge/KnowledgeWordCloudPanel.vue",
  );
  const wordCloudStageText = await readRequiredFile(
    "server-web/components/knowledge/word-cloud/WordCloudStage.vue",
  );
  const wordCloudStageHeaderText = await readRequiredFile(
    "server-web/components/knowledge/word-cloud/WordCloudStageHeader.vue",
  );
  const wordCloudCardListText = await readRequiredFile(
    "server-web/components/knowledge/word-cloud/WordCloudCardList.vue",
  );
  const wordCloudClassCardText = await readRequiredFile(
    "server-web/components/knowledge/word-cloud/WordCloudClassCard.vue",
  );
  const wordCloudCardBodyText = await readRequiredFile(
    "server-web/components/knowledge/word-cloud/WordCloudCardBody.vue",
  );
  const knowledgeRulesPanelText = await readRequiredFile(
    "server-web/components/knowledge/KnowledgeRulesPanel.vue",
  );
  const knowledgeIngestPanelText = await readRequiredFile(
    "server-web/components/knowledge/KnowledgeIngestPanel.vue",
  );
  const knowledgeMaintenancePanelText = await readRequiredFile(
    "server-web/components/knowledge/KnowledgeMaintenancePanel.vue",
  );
  const knowledgeLibraryBoardText = await readRequiredFile(
    "server-web/components/knowledge/KnowledgeLibraryBoard.vue",
  );
  const goldenRulesPanelText = await readRequiredFile(
    "server-web/components/knowledge/rules/GoldenRulesPanel.vue",
  );
  const expertVocabularyPanelText = await readRequiredFile(
    "server-web/components/knowledge/rules/ExpertVocabularyPanel.vue",
  );
  const ruleAuthoringPanelText = await readRequiredFile(
    "server-web/components/knowledge/rules/RuleAuthoringPanel.vue",
  );
  const ruleAuthoringResultPanelText = await readRequiredFile(
    "server-web/components/knowledge/rules/RuleAuthoringResultPanel.vue",
  );
  const emailExpertRulesPanelText = await readRequiredFile(
    "server-web/components/knowledge/rules/EmailExpertRulesPanel.vue",
  );
  const ruleAuthoringControllerText = await readRequiredFile(
    "server-web/composables/console-rule-authoring-controller.ts",
  );
  const ruleAuthoringDisplayUtilsText = await readRequiredFile(
    "server-web/composables/console-rule-authoring-display-utils.ts",
  );
  const expertRulesControllerText = await readRequiredFile(
    "server-web/composables/console-expert-rules-controller.ts",
  );
  const expertEmailRulesControllerText = await readRequiredFile(
    "server-web/composables/console-expert-email-rules-controller.ts",
  );
  const expertVocabularyControllerText = await readRequiredFile(
    "server-web/composables/console-expert-vocabulary-controller.ts",
  );
  const goldenRulesControllerText = await readRequiredFile(
    "server-web/composables/console-golden-rules-controller.ts",
  );
  const infoFeedExecutionControllerText = await readRequiredFile(
    "server-web/composables/console-info-feed-execution-controller.ts",
  );
  const infoFeedExpertFeedbackControllerText = await readRequiredFile(
    "server-web/composables/console-info-feed-expert-feedback-controller.ts",
  );
  const infoFeedSummaryRunnerControllerText = await readRequiredFile(
    "server-web/composables/console-info-feed-summary-runner-controller.ts",
  );
  const infoFeedTrackControllerText = await readRequiredFile(
    "server-web/composables/console-info-feed-track-controller.ts",
  );
  const agentExploreSessionControllerText = await readRequiredFile(
    "server-web/composables/console-agent-explore-session-controller.ts",
  );
  const agentExploreHistoryControllerText = await readRequiredFile(
    "server-web/composables/console-agent-explore-history-controller.ts",
  );
  const agentExplorePollingControllerText = await readRequiredFile(
    "server-web/composables/console-agent-explore-polling-controller.ts",
  );
  const agentExploreUtilsText = await readRequiredFile(
    "server-web/composables/console-agent-explore-utils.ts",
  );
  const agentExploreFormTypesText = await readRequiredFile(
    "server-web/composables/console-agent-explore-form-types.ts",
  );
  const agentExploreRunNormalizationText = await readRequiredFile(
    "server-web/composables/console-agent-explore-run-normalization.ts",
  );
  const agentExploreSessionUtilsText = await readRequiredFile(
    "server-web/composables/console-agent-explore-session-utils.ts",
  );
  const agentExploreStateUtilsText = await readRequiredFile(
    "server-web/composables/console-agent-explore-state-utils.ts",
  );
  const agentExplorePersistenceText = await readRequiredFile(
    "server-web/composables/console-agent-explore-persistence.ts",
  );
  const knowledgeIngestControllerText = await readRequiredFile(
    "server-web/composables/console-knowledge-ingest-controller.ts",
  );
  const debugDistillationControllerText = await readRequiredFile(
    "server-web/composables/console-debug-distillation-controller.ts",
  );
  const debugDistillationRunnerText = await readRequiredFile(
    "server-web/composables/console-debug-distillation-runner.ts",
  );
  const knowledgeDistillationDebugPanelText = await readRequiredFile(
    "server-web/components/debug/KnowledgeDistillationDebugPanel.vue",
  );
  const useConsoleText = await readRequiredFile("server-web/composables/useConsole.ts");
  const useServerConsoleShellText = await readRequiredFile("server-web/composables/useServerConsoleShell.ts");
  const shellPublicContextText = await readRequiredFile(
    "server-web/composables/console-shell-public-context.ts",
  );
  const agentRetrievalShellContextText = await readRequiredFile(
    "server-web/composables/console-shell-agent-retrieval-context.ts",
  );
  const approvalFlowShellContextText = await readRequiredFile(
    "server-web/composables/console-shell-approval-flow-context.ts",
  );
  const debugShellContextText = await readRequiredFile("server-web/composables/console-shell-debug-context.ts");
  const feedShellContextText = await readRequiredFile("server-web/composables/console-shell-feed-context.ts");
  const debugViewContextText = await readRequiredFile("server-web/composables/debugViewContext.ts");
  const feedViewContextText = await readRequiredFile("server-web/composables/feedViewContext.ts");
  const sourcesViewContextText = await readRequiredFile("server-web/composables/sourcesViewContext.ts");
  const knowledgeShellContextText = await readRequiredFile(
    "server-web/composables/console-shell-knowledge-context.ts",
  );
  const toolManagementShellContextText = await readRequiredFile(
    "server-web/composables/console-shell-tool-management-context.ts",
  );
  const serverConsoleAppText = await readRequiredFile("server-web/ServerConsoleApp.vue");
  const consoleSideNavText = await readRequiredFile(
    "server-web/components/shell/ConsoleSideNav.vue",
  );
  const consoleSideNavContextText = await readRequiredFile(
    "server-web/composables/consoleSideNavContext.ts",
  );
  const consoleSideNavLinkText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavLink.vue",
  );
  const consoleSideNavBrandText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavBrand.vue",
  );
  const consoleSideNavPrimaryLinksText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavPrimaryLinks.vue",
  );
  const consoleSideNavKnowledgeSectionText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavKnowledgeSection.vue",
  );
  const consoleSideNavAgentSectionText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavAgentSection.vue",
  );
  const consoleSideNavSkillHubSectionText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavSkillHubSection.vue",
  );
  const consoleSideNavExternalServiceSectionText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavExternalServiceSection.vue",
  );
  const consoleSideNavSystemSectionText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavSystemSection.vue",
  );
  const consoleSideNavVersionSectionText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavVersionSection.vue",
  );
  const consoleSideNavDebugSectionText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavDebugSection.vue",
  );
  const consoleSideNavDirectoryText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavDirectory.vue",
  );
  const consoleSideNavFooterText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavFooter.vue",
  );
  const consoleSideNavBackdropText = await readRequiredFile(
    "server-web/components/shell/side-nav/ConsoleSideNavBackdrop.vue",
  );
  const useWorkspacesConsoleText = await readRequiredFile("server-web/composables/useWorkspacesConsole.ts");
  const workspaceCloudDriveControllerText = await readRequiredFile(
    "server-web/composables/console-workspace-cloud-drive-controller.ts",
  );
  const workspaceCheckpointControllerText = await readRequiredFile(
    "server-web/composables/console-workspace-checkpoint-controller.ts",
  );
  const workspaceLocalDirectoryControllerText = await readRequiredFile(
    "server-web/composables/console-workspace-local-directory-controller.ts",
  );
  const workspaceCodespaceControllerText = await readRequiredFile(
    "server-web/composables/console-workspace-codespace-controller.ts",
  );
  const workspaceSessionControllerText = await readRequiredFile(
    "server-web/composables/console-workspace-session-controller.ts",
  );
  const workspaceManagementControllerText = await readRequiredFile(
    "server-web/composables/console-workspace-management-controller.ts",
  );
  const workspaceDetailPanelText = await readRequiredFile(
    "server-web/components/workspaces/WorkspaceDetailPanel.vue",
  );
  const workspaceCreatePanelText = await readRequiredFile(
    "server-web/components/workspaces/detail/WorkspaceCreatePanel.vue",
  );
  const workspaceProfilePanelText = await readRequiredFile(
    "server-web/components/workspaces/detail/WorkspaceProfilePanel.vue",
  );
  const workspaceParentPanelText = await readRequiredFile(
    "server-web/components/workspaces/detail/WorkspaceParentPanel.vue",
  );
  const workspaceSharePanelText = await readRequiredFile(
    "server-web/components/workspaces/detail/WorkspaceSharePanel.vue",
  );
  const workspaceLocalDirectoryPanelText = await readRequiredFile(
    "server-web/components/workspaces/detail/WorkspaceLocalDirectoryPanel.vue",
  );
  const workspaceCodespacePanelText = await readRequiredFile(
    "server-web/components/workspaces/detail/WorkspaceCodespacePanel.vue",
  );

  const shellPublicKeys = new Set(quotedKeysFromConstArray(shellPublicContextText, "serverConsoleShellPublicKeys"));
  const knowledgeShellContextKeys = [
    "knowledgeShellPageKeys",
    "knowledgeShellViewStateKeys",
    "knowledgeShellLibraryKeys",
    "knowledgeShellIngestKeys",
    "knowledgeShellMaintenanceKeys",
    "knowledgeShellRulesKeys",
    "knowledgeShellWordCloudKeys",
  ].flatMap((constName) => quotedKeysFromConstArray(knowledgeShellContextText, constName));
  const uniqueKnowledgeShellContextKeys = [...new Set(knowledgeShellContextKeys)];
  const agentRetrievalShellContextKeys = [
    "agentRetrievalShellPageKeys",
    "agentRetrievalShellFormKeys",
    "agentRetrievalShellTabKeys",
    "agentRetrievalShellProgressKeys",
    "agentRetrievalShellWorkspaceKeys",
    "agentRetrievalShellTraceKeys",
    "agentRetrievalShellAnswerKeys",
  ].flatMap((constName) => quotedKeysFromConstArray(agentRetrievalShellContextText, constName));
  const uniqueAgentRetrievalShellContextKeys = [...new Set(agentRetrievalShellContextKeys)];
  const shellComputedKeys = new Set([
    "activeRouteAdminView",
    "activeRouteDebugTab",
    "activeRouteKnowledgeTab",
    "activeRouteView",
    "agentRetrievalConsole",
    "appearanceCycleScheme",
    "appearanceCycleSchemeOptions",
    "appearancePresetId",
    "appearancePresetCatalogMessage",
    "appearancePresetImporting",
    "appearancePresetLabel",
    "appearancePresetOptions",
    "appearancePresetOptionsForCycleScheme",
    "appearancePresetSelectionId",
    "approvalFlowConsole",
    "applyAppearancePreset",
    "applyLanguage",
    "cycleAppearancePreset",
    "debugConsole",
    "feedConsole",
    "importAppearancePresetFileToServer",
    "knowledgeDomainConsole",
    "languageMode",
    "languageOptionBarOptions",
    "localizedDebugTabLabel",
    "localizedKnowledgeTabLabel",
    "localizedViewTitle",
    "msg",
    "pageRefreshAriaLabel",
    "pageRefreshBusy",
    "pageRefreshTitle",
    "refreshCurrentPage",
    "refreshAppearancePresetConfigs",
    "serviceStatusLabel",
    "serviceUrl",
    "setAppearanceCycleScheme",
    "setAppearancePreset",
    "setLanguage",
    "toggleLanguage",
    "toolManagementConsole",
    "tt",
    "workspacesConsole",
  ]);
  const shellConsumerKeys = new Map();
  for (const file of shellContextConsumerFiles) {
    for (const key of destructuredKeysFromCall(file.text, "useServerConsoleShellContext")) {
      if (!shellConsumerKeys.has(key)) {
        shellConsumerKeys.set(key, []);
      }
      shellConsumerKeys.get(key).push(file.relativePath);
    }
  }
  const missingShellContextKeys = [...shellConsumerKeys.keys()]
    .filter((key) => !shellPublicKeys.has(key) && !shellComputedKeys.has(key))
    .sort()
    .map((key) => `${key} (${[...new Set(shellConsumerKeys.get(key))].join(", ")})`);
  assert.deepEqual(
    missingShellContextKeys,
    [],
    "useServerConsoleShellContext() consumers must be covered by the explicit shell public context key list",
  );
  assert.match(
    shellPublicContextText,
    /satisfies readonly \(keyof ConsoleContext\)\[\]/,
    "console-shell-public-context.ts must type-check shell keys against useConsole()",
  );
  assert.match(
    useServerConsoleShellText,
    /pickServerConsoleShellPublicContext\(consoleContext\)/,
    "useServerConsoleShell.ts must pick an explicit shell public context instead of hand-copying fields",
  );
  assert.match(
    useServerConsoleShellText,
    /\.\.\.publicConsoleContext/,
    "useServerConsoleShell.ts must spread the explicit shell public context into the provided shell",
  );
  assert.doesNotMatch(
    useServerConsoleShellText,
    /\.\.\.consoleContext/,
    "useServerConsoleShell.ts must not expose the full useConsole() singleton by spread",
  );
  for (const key of [
    "clientSearchQuery",
    "contextPreviewTask",
    "maintenanceAgentConfig",
    "recentJobs",
    "serverLogRows",
    "visibleModelEntries",
    "workQueueRows",
  ]) {
    assert.ok(shellPublicKeys.has(key), `shell public context must expose ${key} through the audited key list`);
  }
  assert.ok(
    serverConsoleAppText.trimEnd().split(/\r?\n/).length <= 140,
    "ServerConsoleApp.vue must stay a focused shell composition boundary",
  );
  assert.match(
    serverConsoleAppText,
    /createConsoleSideNavContext[\s\S]*provideConsoleSideNavContext[\s\S]*ConsoleSideNav[\s\S]*ConsoleSideNavDirectory/,
    "ServerConsoleApp.vue must provide the side-nav context and compose the primary nav with the page directory",
  );
  assert.ok(
    consoleSideNavText.trimEnd().split(/\r?\n/).length <= 130,
    "ConsoleSideNav.vue must stay a focused authenticated side-nav composition boundary",
  );
  assert.match(
    consoleSideNavText,
    /useConsoleSideNavContext[\s\S]*ConsoleSideNavBrand[\s\S]*ConsoleSideNavPrimaryLinks[\s\S]*ConsoleSideNavKnowledgeSection[\s\S]*ConsoleSideNavAgentSection[\s\S]*ConsoleSideNavSkillHubSection[\s\S]*ConsoleSideNavExternalServiceSection[\s\S]*ConsoleSideNavSystemSection[\s\S]*ConsoleSideNavVersionSection[\s\S]*ConsoleSideNavDebugSection[\s\S]*ConsoleSideNavFooter[\s\S]*side-nav-resize[\s\S]*ConsoleSideNavBackdrop/,
    "ConsoleSideNav.vue must compose the focused side-nav sections and resize handle through the local context",
  );
  assert.doesNotMatch(
    consoleSideNavText,
    /switchView|openAdmin|openKnowledgeTab|openDebugTab|hasAnyFeature|hasFeature|v-for="tab|side-link-subtle|brand-loading-label/,
    "ConsoleSideNav.vue must not own individual navigation buttons, feature gates, dynamic tab loops, or brand internals",
  );
  assert.ok(
    consoleSideNavContextText.trimEnd().split(/\r?\n/).length <= 215,
    "consoleSideNavContext.ts must stay a small side-nav shell projection",
  );
  assert.match(
    consoleSideNavContextText,
    /consoleSideNavContextKeys[\s\S]*createConsoleSideNavContext[\s\S]*provideConsoleSideNavContext[\s\S]*useConsoleSideNavContext/,
    "consoleSideNavContext.ts must own the side-nav local context key list and provide/inject helpers",
  );
  assert.doesNotMatch(
    consoleSideNavContextText,
    /<template>|class="side-link"|switchView\(|openAdmin\(/,
    "consoleSideNavContext.ts must not own rendered side-nav markup or navigation side effects",
  );
  const consoleSideNavChildTexts = [
    consoleSideNavLinkText,
    consoleSideNavBrandText,
    consoleSideNavPrimaryLinksText,
    consoleSideNavKnowledgeSectionText,
    consoleSideNavAgentSectionText,
    consoleSideNavSkillHubSectionText,
    consoleSideNavExternalServiceSectionText,
    consoleSideNavSystemSectionText,
    consoleSideNavVersionSectionText,
    consoleSideNavDebugSectionText,
    consoleSideNavDirectoryText,
    consoleSideNavFooterText,
    consoleSideNavBackdropText,
  ];
  assert.doesNotMatch(
    consoleSideNavChildTexts.join("\n"),
    /useServerConsoleShellContext/,
    "side-nav child components must consume consoleSideNavContext instead of the full shell context",
  );
  [
    ["ConsoleSideNavLink.vue", consoleSideNavLinkText, 35, /class="side-link"[\s\S]*side-link-label/],
    ["ConsoleSideNavBrand.vue", consoleSideNavBrandText, 45, /brand-block[\s\S]*brand-loading-label[\s\S]*brand-progress-bar/],
    ["ConsoleSideNavPrimaryLinks.vue", consoleSideNavPrimaryLinksText, 95, /switchView\('dashboard'\)[\s\S]*switchView\('feed'\)[\s\S]*switchView\('approval'\)[\s\S]*openAdmin\('agentPermissions'\)[\s\S]*switchView\('workspaces'\)[\s\S]*switchView\('sources'\)/],
    ["ConsoleSideNavKnowledgeSection.vue", consoleSideNavKnowledgeSectionText, 60, /hasFeature\('knowledge-core'\)[\s\S]*jumpToKnowledgeFileImport[\s\S]*openDebugTab\('knowledgeDistillation'\)[\s\S]*openKnowledgeManagementPanel\('rules'\)[\s\S]*openKnowledgeTab\('wordCloud'\)[\s\S]*openKnowledgeTab\('maintenance'\)/],
    ["ConsoleSideNavAgentSection.vue", consoleSideNavAgentSectionText, 45, /hasAnyFeature\(\['agent-gateway', 'agent-exploration'\]\)[\s\S]*openAdmin\('agentConfig'\)[\s\S]*openAdmin\('contextManagement'\)/],
    ["ConsoleSideNavSkillHubSection.vue", consoleSideNavSkillHubSectionText, 45, /hasFeature\('agent-gateway'\)[\s\S]*openAdmin\('toolList'\)[\s\S]*openAdmin\('toolStats'\)/],
    ["ConsoleSideNavExternalServiceSection.vue", consoleSideNavExternalServiceSectionText, 45, /v-for="tab[\s\S]*openExternalServiceTab\(tab\.id\)[\s\S]*openAdmin\('clients'\)/],
    ["ConsoleSideNavSystemSection.vue", consoleSideNavSystemSectionText, 75, /openAdmin\('storage'\)[\s\S]*openAdmin\('modules'\)[\s\S]*openAdmin\('runtimeDownloads'\)[\s\S]*openAdmin\('strategyManagement'\)[\s\S]*openAdmin\('logs'\)[\s\S]*openAdmin\('jobs'\)[\s\S]*openAdmin\('opsMonitor'\)[\s\S]*openAdmin\('maintenanceAgent'\)/],
    ["ConsoleSideNavVersionSection.vue", consoleSideNavVersionSectionText, 45, /openAdmin\('versionRelease'\)[\s\S]*openAdmin\('productionHealth'\)[\s\S]*openAdmin\('versionAssembly'\)/],
    ["ConsoleSideNavDebugSection.vue", consoleSideNavDebugSectionText, 40, /v-for="tab[\s\S]*localizedDebugTabLabel\(tab\)[\s\S]*openDebugTab\(tab\.id\)/],
    ["ConsoleSideNavDirectory.vue", consoleSideNavDirectoryText, 435, /activeSideNavDirectory[\s\S]*returnToPrimarySideNav[\s\S]*side-nav-directory/],
    ["ConsoleSideNavFooter.vue", consoleSideNavFooterText, 160, /appearanceCycleScheme[\s\S]*cycleAppearancePreset[\s\S]*toggleLanguage[\s\S]*openDrawer\("preferences"\)[\s\S]*side-global-action[\s\S]*msg\.nav\.systemConfig/],
    ["ConsoleSideNavBackdrop.vue", consoleSideNavBackdropText, 20, /sideNavOpen\.value\s*=\s*false[\s\S]*side-nav-backdrop/],
  ].forEach(([fileName, text, maxLines, sentinel]) => {
    assert.ok(
      text.trimEnd().split(/\r?\n/).length <= maxLines,
      `${fileName} must stay within its focused side-nav responsibility`,
    );
    assert.match(text, sentinel, `${fileName} must own its expected side-nav slice`);
  });
  const allowedUseConsoleReturnKeys = new Set([
    ...shellPublicKeys,
    ...uniqueAgentRetrievalShellContextKeys,
    ...quotedKeysFromConstArray(approvalFlowShellContextText, "approvalFlowShellKeys"),
    ...quotedKeysFromConstArray(debugShellContextText, "debugShellKeys"),
    ...quotedKeysFromConstArray(feedShellContextText, "feedShellKeys"),
    ...uniqueKnowledgeShellContextKeys,
    ...quotedKeysFromConstArray(toolManagementShellContextText, "toolManagementShellKeys"),
  ]);
  const useConsoleReturnKeys = returnObjectShorthandKeys(useConsoleText, "useConsole");
  assert.deepEqual(
    useConsoleReturnKeys.filter((key) => !allowedUseConsoleReturnKeys.has(key)).sort(),
    [],
    "useConsole() must only return fields consumed by audited shell/domain contexts",
  );
  assert.ok(
    useConsoleReturnKeys.length <= 560,
    `useConsole() compatibility return surface must stay capped; found ${useConsoleReturnKeys.length} keys`,
  );
  assert.equal(
    useConsoleReturnKeys.includes("jsonPreview"),
    false,
    "useConsole() must not expose stateless JSON preview formatting through shell/domain contexts",
  );
  const statelessDisplayHelpers = [
    "formatBytes",
    "formatCompactDate",
    "formatFileSize",
    "formatMachineDate",
    "formatWordCloudThreshold",
    "currentModulePathPlaceholder",
    "clientConnectionDetail",
    "clientConnectionMethodLabel",
    "clientStatusLabel",
    "clientStatusTone",
    "jobElapsed",
    "jobStatusLabels",
    "jobStatusTone",
    "moduleAvailabilityLabel",
    "moduleCapabilityText",
    "moduleStatusText",
    "sourceDownloadStatusLabel",
    "sourceIndexStatusLabel",
    "sourceJobProgress",
    "sourceSyncLabel",
    "sourceSyncTone",
    "splitJobStatusLabel",
    "scopeLabel",
    "ruleAuthoringStatusLabel",
    "infoFeedStatusLabel",
    "infoFeedStatusTone",
    "toolRiskLabel",
    "toolStatusLabel",
    "toolsetLabel",
    "truncateInfoFeedText",
  ];
  statelessDisplayHelpers.forEach((key) => {
    assert.equal(
      useConsoleReturnKeys.includes(key),
      false,
      `useConsole() must not expose stateless display helper ${key} through shell/domain contexts`,
    );
  });
  [
    ["console-shell-public-context.ts", [...shellPublicKeys]],
    ["console-shell-feed-context.ts", quotedKeysFromConstArray(feedShellContextText, "feedShellKeys")],
    ["feedViewContext.ts", quotedKeysFromConstArray(feedViewContextText, "feedViewContextKeys")],
    ["debugViewContext.ts", quotedKeysFromConstArray(debugViewContextText, "debugViewContextKeys")],
    ["sourcesViewContext.ts", quotedKeysFromConstArray(sourcesViewContextText, "sourcesViewContextKeys")],
    [
      "console-shell-approval-flow-context.ts",
      quotedKeysFromConstArray(approvalFlowShellContextText, "approvalFlowShellKeys"),
    ],
    ["console-shell-knowledge-context.ts", uniqueKnowledgeShellContextKeys],
    [
      "console-shell-tool-management-context.ts",
      quotedKeysFromConstArray(toolManagementShellContextText, "toolManagementShellKeys"),
    ],
  ].forEach(([fileName, keys]) => {
    assert.deepEqual(
      keys.filter((key) => statelessDisplayHelpers.includes(key)),
      [],
      `${fileName} must not forward stateless display helpers through route/domain contexts`,
    );
  });
  const statelessKnowledgeReviewHelpers = [
    "jaccardSimilarity",
    "knowledgeReviewCanResolveWithDocument",
    "knowledgeReviewCurrentDocuments",
    "knowledgeReviewDetailText",
    "knowledgeReviewDocumentLine",
    "knowledgeReviewFusionPrompt",
    "knowledgeReviewIncomingDocument",
    "knowledgeReviewPrimaryCurrentDocument",
    "knowledgeReviewReasonLabel",
    "knowledgeReviewRecordPreview",
    "knowledgeReviewResolvedAction",
    "knowledgeReviewSimilarity",
    "knowledgeReviewSourceLabel",
    "knowledgeReviewStatusLabel",
    "knowledgeReviewTitle",
    "knowledgeReviewTone",
    "tokenizeKnowledgeReviewText",
  ];
  statelessKnowledgeReviewHelpers.forEach((key) => {
    assert.equal(
      useConsoleReturnKeys.includes(key),
      false,
      `useConsole() must not expose stateless knowledge-review helper ${key} through shell/domain contexts`,
    );
  });
  [
    [
      "console-shell-approval-flow-context.ts",
      quotedKeysFromConstArray(approvalFlowShellContextText, "approvalFlowShellKeys"),
    ],
    ["console-shell-knowledge-context.ts", uniqueKnowledgeShellContextKeys],
  ].forEach(([fileName, keys]) => {
    assert.deepEqual(
      keys.filter((key) => statelessKnowledgeReviewHelpers.includes(key)),
      [],
      `${fileName} must not forward stateless knowledge-review helpers through route/domain contexts`,
    );
  });
  assert.doesNotMatch(
    knowledgeReviewControllerText,
    /\n\s*(?:jaccardSimilarity|knowledgeReviewCanResolveWithDocument|knowledgeReviewCurrentDocuments|knowledgeReviewDetailText|knowledgeReviewDocumentLine|knowledgeReviewFusionPrompt|knowledgeReviewIncomingDocument|knowledgeReviewPrimaryCurrentDocument|knowledgeReviewReasonLabel|knowledgeReviewRecordPreview|knowledgeReviewResolvedAction|knowledgeReviewSimilarity|knowledgeReviewSourceLabel|knowledgeReviewStatusLabel|knowledgeReviewTitle|knowledgeReviewTone|tokenizeKnowledgeReviewText),/,
    "console-knowledge-review-controller.ts must not re-export stateless knowledge-review helpers",
  );
  assert.match(
    knowledgeReviewControllerText,
    /import\s+\{[^}]*knowledgeReviewFusionPrompt[^}]*\}\s+from\s+["']\.\/console-knowledge-review-utils["'][\s\S]*question:\s*knowledgeReviewFusionPrompt\(item\)/,
    "console-knowledge-review-controller.ts must import and use the fusion prompt internally",
  );
  assert.match(
    approvalFlowControllerText,
    /from\s+["']\.\/console-knowledge-review-utils["']/,
    "console-approval-flow-view-controller.ts must import knowledge-review display helpers directly",
  );
  assert.deepEqual(
    destructuredKeysFromAssignment(
      approvalFlowControllerText,
      "approvalFlowConsole",
    ).filter((key) => statelessKnowledgeReviewHelpers.includes(key)),
    [],
    "console-approval-flow-view-controller.ts must not receive stateless knowledge-review helpers through approvalFlowConsole",
  );
  assert.match(
    approvalFlowCardListText,
    /from\s+["']\.\.\/\.\.\/composables\/console-knowledge-review-utils["']/,
    "ApprovalFlowCardList.vue must import knowledge-review resolve helper directly",
  );
  assert.equal(
    destructuredKeysFromCall(approvalFlowCardListText, "useApprovalFlowViewContext").includes("knowledgeReviewCanResolveWithDocument"),
    false,
    "ApprovalFlowCardList.vue must not receive knowledgeReviewCanResolveWithDocument through approval flow context",
  );
  const statelessStatusDisplayHelpers = [
    "backgroundProcessLabel",
    "backgroundProcessTone",
    "clientRuntimeCoolingLabel",
    "clientRuntimeCoolingTone",
    "clientRuntimeHeatStyle",
    "clientRuntimeReasonLabel",
    "clientRuntimeSurfaceText",
    "clientRuntimeTaskText",
    "maintenanceAgentRiskLabel",
    "maintenanceAgentStatusLabel",
    "maintenanceAgentStatusTone",
    "monitorAlertSeverityLabel",
    "monitorAlertSeverityTone",
    "processRelationText",
    "processTypeLabel",
    "queueLifecycleLabel",
  ];
  statelessStatusDisplayHelpers.forEach((key) => {
    assert.equal(
      useConsoleReturnKeys.includes(key),
      false,
      `useConsole() must not expose stateless status display helper ${key} through shell/domain contexts`,
    );
  });
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["']\.\/(?:console-client-display-utils|console-format-utils|console-job-display-utils|console-knowledge-source-utils|console-rule-authoring-display-utils|console-status-utils|console-tool-display-utils)["']/,
    "useConsole.ts must not import stateless formatting, status, or source display helper modules; focused controllers and renderers should import them directly",
  );
  assert.match(
    opsMonitorViewControllerText,
    /from\s+["']\.\/console-status-utils["']/,
    "console-ops-monitor-view-controller.ts must import ops status display helpers directly",
  );
  assert.deepEqual(
    destructuredKeysFromCall(
      opsMonitorViewControllerText,
      "useServerConsoleShellContext",
    ).filter((key) => statelessStatusDisplayHelpers.includes(key)),
    [],
    "console-ops-monitor-view-controller.ts must not receive stateless status display helpers through shell context",
  );
  assert.match(
    maintenanceAgentViewControllerText,
    /from\s+["']\.\/console-status-utils["']/,
    "console-maintenance-agent-view-controller.ts must import maintenance status display helpers directly",
  );
  assert.deepEqual(
    destructuredKeysFromCall(
      maintenanceAgentViewControllerText,
      "useServerConsoleShellContext",
    ).filter((key) => statelessStatusDisplayHelpers.includes(key)),
    [],
    "console-maintenance-agent-view-controller.ts must not receive stateless status display helpers through shell context",
  );
  assert.match(
    jobsViewText,
    /from\s+["']\.\.\/\.\.\/composables\/console-status-utils["']/,
    "JobsView.vue must import queue lifecycle display helpers directly",
  );
  assert.match(
    jobsViewText,
    /from\s+["']\.\.\/\.\.\/composables\/console-job-display-utils["']/,
    "JobsView.vue must import job elapsed display helpers directly",
  );
  assert.equal(
    destructuredKeysFromCall(jobsViewText, "useServerConsoleShellContext").includes("queueLifecycleLabel"),
    false,
    "JobsView.vue must not receive queueLifecycleLabel through shell context",
  );
  assert.equal(
    destructuredKeysFromCall(jobsViewText, "useServerConsoleShellContext").includes("jobElapsed"),
    false,
    "JobsView.vue must not receive jobElapsed through shell context",
  );
  assert.match(
    sourceCardText,
    /from\s+["']\.\.\/\.\.\/composables\/console-job-display-utils["']/,
    "SourceCard.vue must import job status display helpers directly",
  );
  assert.equal(
    destructuredKeysFromCall(sourceCardText, "useSourcesViewContext").includes("splitJobStatusLabel"),
    false,
    "SourceCard.vue must not receive splitJobStatusLabel through sources context",
  );
  [
    ["InfoFeedTrackGrid.vue", infoFeedTrackGridText],
    ["InfoFeedCurrentUserCard.vue", infoFeedCurrentUserCardText],
    ["InfoFeedTurnCards.vue", infoFeedTurnCardsText],
  ].forEach(([fileName, text]) => {
    assert.match(
      text,
      /from\s+["']\.\.\/\.\.\/composables\/console-info-feed-shared-utils["']/,
      `${fileName} must import info-feed file-size formatting directly`,
    );
    assert.equal(
      destructuredKeysFromCall(text, "useFeedViewContext").includes("formatFileSize"),
      false,
      `${fileName} must not receive formatFileSize through feed context`,
    );
  });
  assert.match(
    infoFeedTrackGridText,
    /import\s+\{[^}]*truncateInfoFeedText[^}]*\}\s+from\s+["']\.\.\/\.\.\/composables\/console-info-feed-shared-utils["']/,
    "InfoFeedTrackGrid.vue must import info-feed text truncation directly",
  );
  assert.equal(
    destructuredKeysFromCall(infoFeedTrackGridText, "useFeedViewContext").includes("truncateInfoFeedText"),
    false,
    "InfoFeedTrackGrid.vue must not receive truncateInfoFeedText through feed context",
  );
  [
    ["InfoFeedComposerPanel.vue", infoFeedComposerPanelText],
    ["InfoFeedCurrentUserCard.vue", infoFeedCurrentUserCardText],
    ["InfoFeedTrackGrid.vue", infoFeedTrackGridText],
    ["InfoFeedSummaryPanels.vue", infoFeedSummaryPanelsText],
    ["InfoFeedTurnCards.vue", infoFeedTurnCardsText],
  ].forEach(([fileName, text]) => {
    assert.match(
      text,
      /import\s+\{[^}]*infoFeedStatusLabel[^}]*infoFeedStatusTone[^}]*\}\s+from\s+["']\.\.\/\.\.\/composables\/console-info-feed-shared-utils["']/,
      `${fileName} must import info-feed status display helpers directly`,
    );
    assert.deepEqual(
      destructuredKeysFromCall(text, "useFeedViewContext").filter((key) =>
        ["infoFeedStatusLabel", "infoFeedStatusTone"].includes(key),
      ),
      [],
      `${fileName} must not receive info-feed status display helpers through feed context`,
    );
  });
  assert.doesNotMatch(
    infoFeedControllerText,
    /\n\s*truncateInfoFeedText,\n\s*upsertInfoFeedHistory/,
    "console-info-feed-controller.ts must not re-export stateless info-feed text truncation",
  );
  assert.doesNotMatch(
    infoFeedControllerText,
    /\n\s*(?:infoFeedStatusLabel|infoFeedStatusTone),/,
    "console-info-feed-controller.ts must not re-export stateless info-feed status display helpers",
  );
  assert.match(
    knowledgeDistillationDebugPanelText,
    /from\s+["']\.\.\/\.\.\/composables\/console-debug-distillation-utils["']/,
    "KnowledgeDistillationDebugPanel.vue must import distillation file-size formatting directly",
  );
  assert.equal(
    destructuredKeysFromCall(knowledgeDistillationDebugPanelText, "useDebugViewContext").includes("formatFileSize"),
    false,
    "KnowledgeDistillationDebugPanel.vue must not receive formatFileSize through debug context",
  );
  assert.doesNotMatch(
    infoFeedControllerText,
    /\bformatFileSize\b/,
    "console-info-feed-controller.ts must not re-export stateless file-size formatting",
  );
  assert.doesNotMatch(
    debugDistillationControllerText,
    /\n\s*formatFileSize,\n\s*handleDebugDistillationFileSelected/,
    "console-debug-distillation-controller.ts must not return stateless file-size formatting",
  );
  assert.match(
    toolDisplayUtilsText,
    /scopeLabel[\s\S]*toolRiskLabel[\s\S]*toolStatusLabel[\s\S]*toolsetLabel/,
    "console-tool-display-utils.ts must own tool-management label display helpers",
  );
  assert.doesNotMatch(
    toolManagementControllerText,
    /function\s+(?:scopeLabel|toolRiskLabel|toolStatusLabel|toolsetLabel)|maintenanceAgentRiskLabel/,
    "console-tool-management-controller.ts must not own stateless tool display helpers",
  );
  assert.match(
    toolsViewText,
    /from\s+["']\.\.\/\.\.\/composables\/console-tool-display-utils["']/,
    "ToolsView.vue must import tool label display helpers directly",
  );
  assert.deepEqual(
    destructuredKeysFromAssignment(
      toolsViewText,
      "toolManagementConsole",
    ).filter((key) => ["scopeLabel", "toolRiskLabel", "toolStatusLabel", "toolsetLabel"].includes(key)),
    [],
    "ToolsView.vue must not receive tool label helpers through toolManagementConsole",
  );
  assert.deepEqual(
    returnObjectShorthandKeys(
      agentPermissionsControllerText,
      "useAgentPermissionsViewConsole",
    ).filter((key) => ["toolRiskLabel", "toolsetLabel"].includes(key)),
    [],
    "console-agent-permissions-view-controller.ts must not forward tool label helpers through agent permissions context",
  );
  assert.deepEqual(
    destructuredKeysFromAssignment(
      agentPermissionsControllerText,
      "toolManagementConsole",
    ).filter((key) => ["toolRiskLabel", "toolsetLabel"].includes(key)),
    [],
    "console-agent-permissions-view-controller.ts must not receive tool label helpers through toolManagementConsole",
  );
  [
    ["AgentPermissionGroupCard.vue", agentPermissionGroupCardText, "toolRiskLabel"],
    ["ToolGrantCreateCard.vue", toolGrantCreateCardText, "toolRiskLabel"],
    ["ToolGrantListCard.vue", toolGrantListCardText, "toolsetLabel"],
  ].forEach(([fileName, text, helperName]) => {
    assert.match(
      text,
      /from\s+["']\.\.\/\.\.\/\.\.\/composables\/console-tool-display-utils["']/,
      `${fileName} must import tool label display helpers directly`,
    );
    assert.equal(
      destructuredKeysFromCall(text, "useAgentPermissionsViewContext").includes(helperName),
      false,
      `${fileName} must not receive ${helperName} through agent permissions context`,
    );
  });
  assert.match(
    systemLogStatusRowControllerText,
    /from\s+["']\.\/console-tool-display-utils["']/,
    "console-system-log-status-row-controller.ts must import tool risk display helpers directly",
  );
  assert.doesNotMatch(
    systemLogStatusRowControllerText,
    /toolRiskLabel\s*:\s*\([^)]*\)\s*=>|options\.toolRiskLabel/,
    "console-system-log-status-row-controller.ts must not receive toolRiskLabel through controller options",
  );
  [
    ["console-maintenance-agent-controller.ts", maintenanceAgentControllerText],
    ["console-ops-monitor-controller.ts", opsMonitorControllerText],
    ["console-system-log-status-row-controller.ts", systemLogStatusRowControllerText],
  ].forEach(([fileName, text]) => {
    assert.match(
      text,
      /from\s+["']\.\/console-format-utils["']/,
      `${fileName} must import JSON preview formatting directly instead of receiving it from useConsole.ts`,
    );
    assert.doesNotMatch(
      text,
      /jsonPreview\s*:\s*\([^)]*\)\s*=>|options\.jsonPreview/,
      `${fileName} must not receive jsonPreview through controller options`,
    );
  });
  assert.match(
    pathPickerControllerText,
    /from\s+["']\.\/console-format-utils["']/,
    "console-path-picker-controller.ts must import path metadata formatters directly instead of receiving them from useConsole.ts",
  );
  assert.doesNotMatch(
    pathPickerControllerText,
    /formatBytes\s*:\s*\([^)]*\)\s*=>|formatCompactDate\s*:\s*\([^)]*\)\s*=>|options\.formatBytes|options\.formatCompactDate/,
    "console-path-picker-controller.ts must not receive stateless path metadata formatters through controller options",
  );
  assert.ok(
    useConsoleText.split("\n").length <= 2450,
    "useConsole.ts must keep shrinking toward a compatibility shell; move new public surface into domain contexts",
  );
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["'](?:\.\.\/lib\/rendering|\.\/console-knowledge-search-utils|\.\/console-evidence-utils)["']/,
    "useConsole.ts must not import stateless rendering, evidence, or search display helpers; route contexts/components should depend on focused helper modules directly",
  );

  assert.match(
    bridgeText,
    /from\s+["']\.\/bridge-http["']/,
    "bridge.ts must use the shared bridge-http request boundary",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/bridge-types["']/,
    "bridge.ts must import the compatibility facade contract from bridge-types.ts",
  );
  assert.doesNotMatch(
    bridgeText,
    /type\s+Bridge\s*=/,
    "bridge.ts must not own the large compatibility facade type contract",
  );
  assert.match(
    bridgeTypesText,
    /export\s+type\s+Bridge\s*=/,
    "bridge-types.ts must own the compatibility facade type contract",
  );
  assert.match(
    bridgeTypesText,
    /searchKnowledge:\s*\(payload:\s*Record<string,\s*unknown>\)\s*=>\s*Promise<KnowledgeSearchResponse>/,
    "bridge-types.ts must preserve knowledge search compatibility typing",
  );
  assert.doesNotMatch(
    bridgeText,
    /\bfetch\s*\(/,
    "bridge.ts must not own raw fetch calls; keep HTTP mechanics in bridge-http.ts",
  );
  assert.doesNotMatch(
    bridgeText,
    /\btriggerBrowserDownload\b|\bparseBrowserRelativeUrl\b/,
    "bridge.ts must not own browser download or URL parsing primitives",
  );
  assert.doesNotMatch(
    bridgeText,
    /["'`]\/api\//,
    "bridge.ts must not own API endpoint strings; keep endpoint ownership in focused domain clients",
  );
  assert.match(
    bridgeHttpText,
    /export\s+async\s+function\s+(getJson|postJson|deleteJson|putBinaryJson|downloadFile)\b/,
    "bridge-http.ts must expose the shared bridge request/download helpers",
  );
  assert.match(
    bridgeHttpText,
    /\bfetch\s*\(/,
    "bridge-http.ts should be the frontend HTTP implementation boundary",
  );
  assert.match(
    agentRegistryClientText,
    /\/api\/agents/,
    "agent-registry-client.ts must own agent registry endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/agent-registry-client["']/,
    "bridge.ts compatibility facade must re-export agent registry behavior from the domain client",
  );
  assert.match(
    agentSyncClientText,
    /\/api\/agent-sync\/config/,
    "agent-sync-client.ts must own agent sync config endpoints",
  );
  assert.match(
    agentSyncClientText,
    /\/api\/agent-sync\/(?:publish|events)/,
    "agent-sync-client.ts must own agent sync publish/event endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/agent-sync-client["']/,
    "bridge.ts compatibility facade must re-export agent sync behavior from the domain client",
  );
  assert.match(
    codexOAuthClientText,
    /\/api\/oauth\/codex\/(?:status|login)/,
    "codex-oauth-client.ts must own Codex OAuth endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/codex-oauth-client["']/,
    "bridge.ts compatibility facade must re-export Codex OAuth behavior from the domain client",
  );
  assert.match(
    consoleStateClientText,
    /\/api\/console\/state/,
    "console-state-client.ts must own the server console state endpoint",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/console-state-client["']/,
    "bridge.ts compatibility facade must re-export console state behavior from the domain client",
  );
  assert.match(
    discoveryClientText,
    /\/api\/discovery\/(?:config|clients)/,
    "discovery-client.ts must own discovery config/client endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/discovery-client["']/,
    "bridge.ts compatibility facade must re-export discovery behavior from the domain client",
  );
  assert.match(
    runtimeInfoClientText,
    /\/api\/runtime\/(?:info|path-browse)/,
    "runtime-info-client.ts must own runtime info and path browse endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/runtime-info-client["']/,
    "bridge.ts compatibility facade must re-export runtime info/path behavior from the domain client",
  );
  assert.match(
    serverEventsClientText,
    /\/api\/events/,
    "server-events-client.ts must own protocol event subscription endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/server-events-client["']/,
    "bridge.ts compatibility facade must re-export server event subscription behavior from the domain client",
  );
  [
    ["useConsole.ts", useConsoleText],
    ["console-path-picker-controller.ts", pathPickerControllerText],
    ["console-path-picker-action-controller.ts", pathPickerActionControllerText],
    ["console-server-event-controller.ts", serverEventControllerText],
    ["console-codex-oauth-controller.ts", codexOAuthControllerText],
    ["console-discovery-controller.ts", discoveryControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on focused API clients, not the global bridge facade`,
    );
  });
  assert.doesNotMatch(
    useConsoleText,
    /\bbridge\s*\.\s*(getServerConsoleState|saveDiscoveryConfig)\b/,
    "useConsole.ts must use console-state-client.ts and discovery-client.ts for state/discovery APIs",
  );
  assert.match(
    refreshStateControllerText,
    /from\s+["']\.\.\/lib\/console-state-client["']/,
    "console-refresh-state-controller.ts must own console state refresh API access",
  );
  assert.match(
    refreshStateControllerText,
    /\bgetServerConsoleState\s*\(/,
    "console-refresh-state-controller.ts must fetch server console state",
  );
  assert.match(
    refreshStateControllerText,
    /serverAvailable\.value\s*=\s*true/,
    "console-refresh-state-controller.ts must own server availability updates during refresh",
  );
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["']\.\.\/lib\/console-state-client["']|function\s+executeRefreshState\b|\bgetServerConsoleState\s*\(|serverAvailable\.value\s*=/,
    "useConsole.ts must delegate console state refresh execution to console-refresh-state-controller.ts",
  );
  assert.match(
    featureAccessControllerText,
    /const\s+activeConsoleFeatureIds\s*=\s*computed/,
    "console-feature-access-controller.ts must own active feature projection",
  );
  assert.match(
    featureAccessControllerText,
    /function\s+isAdminViewEnabled/,
    "console-feature-access-controller.ts must own admin feature gating",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+activeConsoleFeatureIds\s*=\s*computed|function\s+hasFeature|function\s+hasAnyFeature|const\s+visibleKnowledgeTabs\s*=\s*computed|const\s+visibleDebugTabs\s*=\s*computed|function\s+isAdminViewEnabled/,
    "useConsole.ts must delegate feature and admin route gating to console-feature-access-controller.ts",
  );
  assert.match(
    navigationControllerText,
    /const\s+currentView\s*=\s*ref/,
    "console-navigation-controller.ts must own route-level current view state",
  );
  assert.match(
    navigationControllerText,
    /function\s+syncNavigationStateFromRoute/,
    "console-navigation-controller.ts must own URL-to-navigation state sync",
  );
  assert.match(
    navigationControllerText,
    /function\s+switchView/,
    "console-navigation-controller.ts must own primary view switching behavior",
  );
  assert.match(
    navigationControllerText,
    /function\s+openAdmin/,
    "console-navigation-controller.ts must own admin route switching behavior",
  );
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["']\.\.\/router\/routes["']|_appRouter|const\s+(?:debugTab|knowledgeTab|knowledgeManagementPanel|drawerOpen|drawerTab|sideNavOpen|currentView|adminView)\s*=\s*ref|const\s+viewTitle\s*=\s*computed|function\s+(?:ensureKnowledgeTabState|isKnownDebugRouteTab|syncNavigationStateFromRoute|closeSideNavOverlay|switchView|openDebugTab|openKnowledgeTab|refreshSystemStatusLogs|jumpToKnowledgeFileImport|openAdmin|openAgentConfigurationAlert|openDrawer|closeDrawer)\b/,
    "useConsole.ts must delegate navigation state, route sync, and route-triggered refresh dispatch to console-navigation-controller.ts",
  );
  assert.match(
    runtimeLifecycleControllerText,
    /let\s+consoleLifecycleRefCount\s*=\s*0/,
    "console-runtime-lifecycle-controller.ts must own console runtime lifecycle reference counting",
  );
  assert.match(
    runtimeLifecycleControllerText,
    /async\s+function\s+bootstrapConsoleRuntime/,
    "console-runtime-lifecycle-controller.ts must own console runtime bootstrap workflow",
  );
  assert.match(
    runtimeLifecycleControllerText,
    /function\s+cleanupConsoleRuntime/,
    "console-runtime-lifecycle-controller.ts must own console runtime cleanup workflow",
  );
  assert.doesNotMatch(
    useConsoleText,
    /let\s+consoleLifecycleRefCount|let\s+consoleLifecycleInitInProgress|let\s+consoleLifecycleInitialized|async\s+function\s+bootstrapConsoleRuntime|function\s+ensureConsoleRuntimeInitialized|function\s+cleanupConsoleRuntime/,
    "useConsole.ts must delegate runtime bootstrap, cleanup, and lifecycle ref-counting to console-runtime-lifecycle-controller.ts",
  );
  assert.doesNotMatch(
    pathPickerControllerText,
    /\bbridge\s*\.\s*browseServerPath\b/,
    "console-path-picker-controller.ts must use runtime-info-client.ts for path browsing",
  );
  assert.match(
    pathPickerActionControllerText,
    /function\s+openLocalSourceDirectoryPicker/,
    "console-path-picker-action-controller.ts must own local source path-picker wiring",
  );
  assert.match(
    pathPickerActionControllerText,
    /function\s+openWordCloudCorpusDirectoryPicker/,
    "console-path-picker-action-controller.ts must own word-cloud directory path-picker wiring",
  );
  assert.match(
    pathPickerActionControllerText,
    /function\s+openSettingsPathPicker/,
    "console-path-picker-action-controller.ts must own settings path-picker field wiring",
  );
  assert.doesNotMatch(
    useConsoleText,
    /function\s+(?:openLocalSourceDirectoryPicker|openWordCloudCorpusDirectoryPicker|openWordCloudCorpusFilePicker|openSettingsPathPicker)\b|title:\s*["']选择(?:本地目录|词云语料目录|词云语料文件)["']/,
    "useConsole.ts must delegate feature-specific path-picker actions to console-path-picker-action-controller.ts",
  );
  assert.doesNotMatch(
    serverEventControllerText,
    /\bbridge\s*\.\s*subscribeEvents\b/,
    "console-server-event-controller.ts must use server-events-client.ts for event subscriptions",
  );
  assert.match(
    stateEventReducerControllerText,
    /export\s+const\s+baseServerEventTopics\s*=\s*\[/,
    "console-state-event-reducer-controller.ts must own server event topic registration",
  );
  assert.match(
    stateEventReducerControllerText,
    /const\s+uploadTraceEvents\s*=\s*ref/,
    "console-state-event-reducer-controller.ts must own upload trace event cache state",
  );
  assert.match(
    stateEventReducerControllerText,
    /function\s+applyConsoleState/,
    "console-state-event-reducer-controller.ts must own server console state reduction",
  );
  assert.match(
    stateEventReducerControllerText,
    /function\s+applyServerEvent/,
    "console-state-event-reducer-controller.ts must own protocol-event reduction",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+baseServerEventTopics\s*=\s*\[|function\s+currentServerEventTopics|const\s+uploadTraceEvents\s*=\s*ref|function\s+applyConsoleState|function\s+applyServerEvent|event\.topic\s*===\s*["'](?:settings\.current|uploads\.trace|knowledge\.word_clouds)["']/,
    "useConsole.ts must delegate server state snapshots, event topics, upload trace cache, and protocol-event reducers to console-state-event-reducer-controller.ts",
  );
  assert.doesNotMatch(
    codexOAuthControllerText,
    /\bbridge\s*\.\s*(getCodexOAuthStatus|startCodexOAuthLogin)\b/,
    "console-codex-oauth-controller.ts must use codex-oauth-client.ts for OAuth APIs",
  );
  assert.match(
    discoveryControllerText,
    /from\s+["']\.\.\/lib\/discovery-client["']/,
    "console-discovery-controller.ts must depend on discovery-client.ts for discovery persistence",
  );
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["']\.\.\/lib\/discovery-client["']|saveDiscoveryConfig/,
    "useConsole.ts must delegate discovery persistence to console-discovery-controller.ts",
  );
  assert.match(
    runtimeMountControllerText,
    /const\s+mountDraft\s*=\s*ref/,
    "console-runtime-mount-controller.ts must own runtime mount draft state",
  );
  assert.match(
    runtimeMountControllerText,
    /function\s+replaceMountDraftFromServer/,
    "console-runtime-mount-controller.ts must own remote runtime mount draft replacement",
  );
  assert.match(
    runtimeMountControllerText,
    /isApplyingRemoteConsoleDrafts/,
    "console-runtime-mount-controller.ts must own runtime mount dirty tracking around remote draft application",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+mountDraft\s*=\s*ref|const\s+mountDraftDirty\s*=\s*ref|watch\(\s*mountDraft|function\s+replaceMountDraftFromServer/,
    "useConsole.ts must delegate runtime mount draft ownership to console-runtime-mount-controller.ts",
  );
  assert.match(
    runtimeModuleDisplayUtilsText,
    /export\s+function\s+moduleCapabilityText[\s\S]*export\s+function\s+moduleStatusText[\s\S]*export\s+function\s+moduleAvailabilityLabel[\s\S]*export\s+function\s+currentModulePathPlaceholder/,
    "console-runtime-module-display-utils.ts must own runtime module display helpers",
  );
  assert.doesNotMatch(
    runtimeMountControllerText,
    /function\s+(?:moduleCapabilityText|moduleStatusText|moduleAvailabilityLabel|currentModulePathPlaceholder|moduleEnabledLabel)|\n\s*(?:moduleCapabilityText|moduleStatusText|moduleAvailabilityLabel|currentModulePathPlaceholder|moduleEnabledLabel),/,
    "console-runtime-mount-controller.ts must not own or re-export stateless runtime module display helpers",
  );
  assert.ok(
    modulesViewText.trimEnd().split(/\r?\n/).length <= 20,
    "ModulesView.vue must stay a route-local provider, not own runtime module rendering",
  );
  assert.match(
    modulesViewText,
    /useModulesViewConsole[\s\S]*provideModulesView[\s\S]*<RuntimeModulesPanel/,
    "ModulesView.vue must provide modules view context and render the runtime modules panel",
  );
  assert.doesNotMatch(
    modulesViewText,
    /useServerConsoleShellContext|console-runtime-module-display-utils|moduleGroups|mountDraft|FeatureToggle|BrowseSelectButton/,
    "ModulesView.vue must not consume shell state, display helpers, or module-row controls directly",
  );
  assert.match(
    modulesViewControllerText,
    /useServerConsoleShellContext[\s\S]*busyKey[\s\S]*moduleGroups[\s\S]*mountDraft[\s\S]*openMountPathPicker/,
    "console-modules-view-controller.ts must own the focused shell projection for the Modules route",
  );
  assert.doesNotMatch(
    modulesViewControllerText,
    /adminView|currentView|hasFeature|isAuthenticated|isMountPathEditing|toggleMountPathEdit/,
    "console-modules-view-controller.ts must not expose unrelated shell/admin state or drawer-only edit controls",
  );
  assert.match(
    modulesViewContextText,
    /provideModulesView[\s\S]*useModulesViewContext/,
    "modulesViewContext.ts must provide the route-local modules context",
  );
  [
    ["RuntimeModulesPanel.vue", runtimeModulesPanelText, 60, /RuntimeModuleGroup[\s\S]*moduleGroups/],
    ["RuntimeModuleGroup.vue", runtimeModuleGroupText, 35, /RuntimeModuleConfigItem[\s\S]*group\.rows/],
    ["RuntimeModuleConfigItem.vue", runtimeModuleConfigItemText, 100, /FeatureToggle[\s\S]*openMountPathPicker[\s\S]*enableMountModule[\s\S]*disableMountModule/],
  ].forEach(([fileName, text, maxLines, sentinel]) => {
    assert.ok(
      text.trimEnd().split(/\r?\n/).length <= maxLines,
      `${fileName} must stay within its focused runtime module rendering responsibility`,
    );
    assert.match(text, sentinel, `${fileName} must own its expected runtime module slice`);
  });
  [
    ["ConsoleRuntimeModulesPanel.vue", consoleRuntimeModulesPanelText],
    ["RuntimeModuleConfigItem.vue", runtimeModuleConfigItemText],
  ].forEach(([fileName, text]) => {
    assert.match(
      text,
      /from\s+["'](?:\.\.\/\.\.\/|\.\.\/\.\.\/\.\.\/)composables\/console-runtime-module-display-utils["']/,
      `${fileName} must import runtime module display helpers directly`,
    );
    assert.deepEqual(
      destructuredKeysFromCall(text, "useServerConsoleShellContext").filter((key) =>
        [
          "currentModulePathPlaceholder",
          "moduleAvailabilityLabel",
          "moduleCapabilityText",
          "moduleStatusText",
        ].includes(key),
      ),
      [],
      `${fileName} must not receive runtime module display helpers through shell context`,
    );
  });
  assert.ok(
    runtimeDownloadsViewText.trimEnd().split(/\r?\n/).length <= 20,
    "RuntimeDownloadsView.vue must stay a route-local provider, not own runtime dependency rendering",
  );
  assert.match(
    runtimeDownloadsViewText,
    /useRuntimeDownloadsViewController[\s\S]*provideRuntimeDownloadsView[\s\S]*<RuntimeDownloadsPanel/,
    "RuntimeDownloadsView.vue must provide runtime downloads context and render the focused panel",
  );
  assert.doesNotMatch(
    runtimeDownloadsViewText,
    /computed|onMounted|ref|usePageRefreshHandler|listRuntimeDependencies|downloadRuntimeDependency|StatusPill|runtime-dependency-row|<style/,
    "RuntimeDownloadsView.vue must not own runtime dependency state, bridge loading, list rendering, or styles directly",
  );
  assert.ok(
    runtimeDownloadsViewControllerText.trimEnd().split(/\r?\n/).length <= 300,
    "console-runtime-downloads-view-controller.ts must stay a focused runtime dependency state owner",
  );
  assert.match(
    runtimeDownloadsViewControllerText,
    /(?=[\s\S]*listRuntimeDependencies)(?=[\s\S]*downloadRuntimeDependency)(?=[\s\S]*prepareDependency)(?=[\s\S]*usePageRefreshHandler)/,
    "console-runtime-downloads-view-controller.ts must own dependency loading, install action state, and page refresh wiring",
  );
  assert.doesNotMatch(
    runtimeDownloadsViewControllerText,
    /<template>|StatusPill|runtime-dependency-row|surface-card/,
    "console-runtime-downloads-view-controller.ts must not own rendered runtime dependency markup",
  );
  assert.ok(
    runtimeDownloadsViewContextText.trimEnd().split(/\r?\n/).length <= 25,
    "runtimeDownloadsViewContext.ts must stay a small provide/inject boundary",
  );
  assert.match(
    runtimeDownloadsViewContextText,
    /RuntimeDownloadsViewContext[\s\S]*provideRuntimeDownloadsView[\s\S]*useRuntimeDownloadsViewContext/,
    "runtimeDownloadsViewContext.ts must own runtime downloads provide/inject context",
  );
  assert.ok(
    runtimeDownloadsPanelText.trimEnd().split(/\r?\n/).length <= 25,
    "RuntimeDownloadsPanel.vue must stay a small runtime downloads composition panel",
  );
  assert.match(
    runtimeDownloadsPanelText,
    /RuntimeDownloadsSummaryCard[\s\S]*RuntimeDependencyListCard[\s\S]*RuntimeDependencyResultCard/,
    "RuntimeDownloadsPanel.vue must compose the summary, dependency list, and latest result cards",
  );
  assert.doesNotMatch(
    runtimeDownloadsPanelText,
    /useRuntimeDownloadsViewContext|listRuntimeDependencies|downloadRuntimeDependency|StatusPill|runtime-dependency-row/,
    "RuntimeDownloadsPanel.vue must not own context state, bridge loading, or dependency row rendering",
  );
  assert.ok(
    runtimeDownloadsSummaryCardText.trimEnd().split(/\r?\n/).length <= 70,
    "RuntimeDownloadsSummaryCard.vue must stay focused on runtime download summary metadata",
  );
  assert.match(
    runtimeDownloadsSummaryCardText,
    /readyCount[\s\S]*installedCount[\s\S]*failedCount[\s\S]*generatedAtLabel[\s\S]*cacheRoot[\s\S]*sourceConfigPath/,
    "RuntimeDownloadsSummaryCard.vue must own summary counts and local source metadata rendering",
  );
  assert.doesNotMatch(
    runtimeDownloadsSummaryCardText,
    /dependencies|prepareDependency|actionResult|StatusPill|v-for="item/,
    "RuntimeDownloadsSummaryCard.vue must not own dependency rows or install result rendering",
  );
  assert.ok(
    runtimeDependencyListCardText.trimEnd().split(/\r?\n/).length <= 180,
    "RuntimeDependencyListCard.vue must stay focused on runtime dependency row rendering",
  );
  assert.match(
    runtimeDependencyListCardText,
    /StatusPill[\s\S]*dependencies[\s\S]*prepareDependency[\s\S]*runtime-dependency-row/,
    "RuntimeDependencyListCard.vue must own dependency status rows and install trigger buttons",
  );
  assert.match(
    runtimeDependencyListCardText,
    /from\s+["']\.\.\/\.\.\/\.\.\/lib\/runtime-dependencies["']/,
    "RuntimeDependencyListCard.vue must import runtime dependency display helpers directly",
  );
  assert.deepEqual(
    destructuredKeysFromCall(runtimeDependencyListCardText, "useRuntimeDownloadsViewContext").filter((key) =>
      ["canTrigger", "childSummary", "sourceHint", "statusLabel", "statusTone"].includes(key),
    ),
    [],
    "RuntimeDependencyListCard.vue must not receive stateless runtime dependency display helpers through context",
  );
  assert.doesNotMatch(
    runtimeDependencyListCardText,
    /listRuntimeDependencies|downloadRuntimeDependency|usePageRefreshHandler|cacheRoot|sourceConfigPath|actionResult/,
    "RuntimeDependencyListCard.vue must not own bridge loading, refresh wiring, summary metadata, or result rendering",
  );
  assert.ok(
    runtimeDependencyResultCardText.trimEnd().split(/\r?\n/).length <= 50,
    "RuntimeDependencyResultCard.vue must stay focused on latest runtime dependency result rendering",
  );
  assert.match(
    runtimeDependencyResultCardText,
    /(?=[\s\S]*actionResult)(?=[\s\S]*actionError)(?=[\s\S]*statusLabel)(?=[\s\S]*statusTone)/,
    "RuntimeDependencyResultCard.vue must own latest result and action error rendering",
  );
  assert.match(
    runtimeDependencyResultCardText,
    /from\s+["']\.\.\/\.\.\/\.\.\/lib\/runtime-dependencies["']/,
    "RuntimeDependencyResultCard.vue must import runtime dependency status helpers directly",
  );
  assert.deepEqual(
    destructuredKeysFromCall(runtimeDependencyResultCardText, "useRuntimeDownloadsViewContext").filter((key) =>
      ["statusLabel", "statusTone"].includes(key),
    ),
    [],
    "RuntimeDependencyResultCard.vue must not receive stateless runtime dependency status helpers through context",
  );
  assert.doesNotMatch(
    runtimeDependencyResultCardText,
    /v-for="item|prepareDependency|runtime-dependency-row|cacheRoot|sourceConfigPath/,
    "RuntimeDependencyResultCard.vue must not own dependency rows, install triggers, or summary metadata",
  );
  assert.match(
    authClientText,
    /\/api\/auth\/session/,
    "auth-client.ts must own console auth session endpoints",
  );
  assert.match(
    authClientText,
    /\/api\/auth\/users/,
    "auth-client.ts must own console auth user endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/auth-client["']/,
    "bridge.ts compatibility facade must re-export auth behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/auth(?:\/|[?"'`])/,
    "bridge.ts must not own console auth endpoints",
  );
  assert.match(
    authTypesText,
    /export\s+type\s+ConsoleAuthSummary/,
    "auth-types.ts must own console auth summary contracts",
  );
  const rootTypesLineCount = rootTypesText.trimEnd().split(/\r?\n/).length;
  assert.ok(
    rootTypesLineCount <= 60,
    "types.ts must stay a thin compatibility facade over domain type modules",
  );
  assert.doesNotMatch(
    rootTypesText,
    /export\s+type\s+(AgentSettings|ServerConsoleState|KnowledgeSearchResponse|SplitJob)\s*=/,
    "types.ts must not grow domain contracts back into the compatibility facade",
  );
  [
    ["agent", agentTypesText, [/export\s+type\s+AgentSettings/, /export\s+type\s+AgentGatewayCallResponse/]],
    ["runtime", runtimeTypesText, [/export\s+type\s+RuntimeInfoResponse/, /export\s+type\s+ServerPathBrowseResponse/]],
    ["split", splitTypesText, [/\.\/split\/entities/, /\.\/split\/documents/, /\.\/split\/jobs/, /\.\/split\/payload/]],
    ["knowledge", knowledgeTypesText, [/\.\/knowledge\/search/, /\.\/knowledge\/word-cloud/]],
    ["tool-management", toolManagementTypesText, [/export\s+type\s+ToolManagementCatalog/, /export\s+type\s+ToolManagementGrant/]],
    ["maintenance", maintenanceTypesText, [/export\s+type\s+MaintenanceAgentSummary/, /export\s+type\s+MaintenanceAgentRun/]],
    ["ops", opsTypesText, [/export\s+type\s+MonitorAlertState/, /export\s+type\s+UnifiedRegistrationRecord/]],
    ["production-health", productionHealthTypesText, [/export\s+type\s+ProductionHealthResponse/, /export\s+type\s+V001BaselineStatus/]],
    ["console-state", consoleStateTypesText, [/export\s+type\s+ServerConsoleState/]],
  ].forEach(([moduleName, text, sentinels]) => {
    assert.match(
      rootTypesText,
      new RegExp(`export\\s+type\\s+\\*\\s+from\\s+["']\\.\\/types\\/${escapeRegex(moduleName)}["'];?`),
      `types.ts must re-export ${moduleName} domain contracts for compatibility`,
    );
    sentinels.forEach((sentinel) => {
      assert.match(
        text,
        sentinel,
        `${moduleName} type module must own its expected domain contracts`,
      );
    });
  });
  assert.ok(
    splitTypesText.trimEnd().split(/\r?\n/).length <= 20,
    "types/split.ts must stay a small compatibility facade over focused split type slices",
  );
  assert.doesNotMatch(
    splitTypesText,
    /export\s+type\s+(SplitJob|DocumentParseResponse|EmailMessage|SplitPayload)\s*=/,
    "types/split.ts must not grow split domain contracts back into the facade",
  );
  [
    ["split/entities.ts", splitEntitiesTypesText, [/export\s+type\s+EmailMessage/, /export\s+type\s+TimeWeightedRetrieval/]],
    ["split/documents.ts", splitDocumentsTypesText, [/export\s+type\s+NormalizedDocumentsManifest/, /export\s+type\s+DocumentParseResponse/]],
    ["split/jobs.ts", splitJobsTypesText, [/export\s+type\s+SplitJob/, /export\s+type\s+SplitJobListResponse/]],
    ["split/payload.ts", splitPayloadTypesText, [/export\s+type\s+SplitPayload/, /export\s+type\s+UploadedFilePayload/]],
    ["split/result.ts", splitResultTypesText, [/export\s+type\s+SplitOverview/, /export\s+type\s+SplitResult/]],
  ].forEach(([label, text, sentinels]) => {
    sentinels.forEach((sentinel) => {
      assert.match(
        text,
        sentinel,
        `${label} must own its expected split type contracts`,
      );
    });
  });
  assert.ok(
    knowledgeTypesText.trimEnd().split(/\r?\n/).length <= 30,
    "types/knowledge.ts must stay a small compatibility facade over focused knowledge type slices",
  );
  assert.doesNotMatch(
    knowledgeTypesText,
    /export\s+type\s+(KnowledgeSearchResponse|KnowledgeWordBagSet|KnowledgeSourceState|KnowledgeReviewItem|UploadSessionResponse)\s*=/,
    "types/knowledge.ts must not own broad knowledge contracts directly",
  );
  [
    ["knowledge/console.ts", knowledgeConsoleTypesText, [/export\s+type\s+KnowledgeConsoleState/, /export\s+type\s+KnowledgeConfigSchema/]],
    ["knowledge/sources.ts", knowledgeSourcesTypesText, [/export\s+type\s+KnowledgeSourceState/, /export\s+type\s+KnowledgeSourceMutationResponse/]],
    ["knowledge/review.ts", knowledgeReviewTypesText, [/export\s+type\s+KnowledgeReviewItem/, /export\s+type\s+KnowledgeReviewItemsResponse/]],
    ["knowledge/rules.ts", knowledgeRulesTypesText, [/export\s+type\s+EmailRuleSet/, /export\s+type\s+KnowledgeRuleAuthoringResponse/]],
    ["knowledge/word-cloud.ts", knowledgeWordCloudTypesText, [/export\s+type\s+KnowledgeWordBagSet/, /export\s+type\s+KnowledgeWordBagTermsResponse/]],
    ["knowledge/search.ts", knowledgeSearchTypesText, [/export\s+type\s+KnowledgeSearchResponse/, /export\s+type\s+EvidencePack/]],
    ["knowledge/upload.ts", knowledgeUploadTypesText, [/export\s+type\s+UploadSessionResponse/]],
  ].forEach(([label, text, sentinels]) => {
    sentinels.forEach((sentinel) => {
      assert.match(
        text,
        sentinel,
        `types/${label} must own its expected knowledge contracts`,
      );
    });
  });
  const consoleI18nLineCount = consoleI18nText.trimEnd().split(/\r?\n/).length;
  assert.ok(
    consoleI18nLineCount <= 40,
    "i18n/console.ts must stay a small public facade and not absorb locale runtime or catalog data again",
  );
  assert.match(
    consoleI18nText,
    /from\s+["']\.\/console-messages["']/,
    "i18n/console.ts must import the message catalog from console-messages.ts",
  );
  assert.match(
    consoleI18nText,
    /from\s+["']\.\/console-locale-state["']/,
    "i18n/console.ts must re-export locale state from console-locale-state.ts",
  );
  assert.match(
    consoleI18nText,
    /from\s+["']\.\/console-text-localizer["']/,
    "i18n/console.ts must re-export text localization from console-text-localizer.ts",
  );
  assert.doesNotMatch(
    consoleI18nText,
    /readonly\(|ref<|const\s+consolePhrasePairs|const\s+consoleSegmentPairs|export\s+const\s+consoleMessages\s*=\s*\{|zh:\s*\/\^/,
    "i18n/console.ts must not own locale refs, static catalogs, or dynamic localization patterns",
  );
  assert.match(
    consoleLocaleStateText,
    /export\s+type\s+ConsoleLocale\s*=\s*["']en["']\s*\|\s*["']zh-CN["']/,
    "console-locale-state.ts must own the shared locale union",
  );
  assert.match(
    consoleLocaleStateText,
    /readonly\(consoleLocaleState\)/,
    "console-locale-state.ts must own the readonly locale state export",
  );
  assert.match(
    consoleTextLocalizerText,
    /from\s+["']\.\/console-phrases["']/,
    "console-text-localizer.ts must consume phrase catalogs from console-phrases.ts",
  );
  assert.match(
    consoleTextLocalizerText,
    /applyConsolePattern/,
    "console-text-localizer.ts must delegate dynamic regex matching to console-dynamic-patterns.ts",
  );
  assert.doesNotMatch(
    consoleTextLocalizerText,
    /zh:\s*\/\^|export\s+const\s+consoleDynamicPatternPairs/,
    "console-text-localizer.ts must not own dynamic regex pattern catalog data",
  );
  assert.match(
    consoleDynamicPatternTypesText,
    /export\s+type\s+ConsolePatternContext\b/,
    "console-dynamic-pattern-types.ts must own the dynamic pattern dependency contract",
  );
  assert.match(
    consoleDynamicPatternsText,
    /from\s+["']\.\/console-dynamic-count-patterns["']/,
    "console-dynamic-patterns.ts must import the count/metric dynamic pattern slice",
  );
  assert.match(
    consoleDynamicPatternsText,
    /from\s+["']\.\/console-dynamic-status-patterns["']/,
    "console-dynamic-patterns.ts must import the status/message dynamic pattern slice",
  );
  assert.ok(
    consoleDynamicPatternsText.trimEnd().split(/\r?\n/).length <= 60,
    "console-dynamic-patterns.ts must stay a small dynamic-pattern facade",
  );
  assert.match(
    consoleDynamicCountPatternsText,
    /个账号|Generation/,
    "console-dynamic-count-patterns.ts must own count and metric localization patterns",
  );
  assert.ok(
    consoleDynamicCountPatternsText.trimEnd().split(/\r?\n/).length <= 280,
    "console-dynamic-count-patterns.ts must stay a focused count/metric pattern slice",
  );
  assert.match(
    consoleDynamicStatusPatternsText,
    /is not running normally|Background Worker Manager|Catalog fingerprint/,
    "console-dynamic-status-patterns.ts must own status and compound-message localization patterns",
  );
  assert.ok(
    consoleDynamicStatusPatternsText.trimEnd().split(/\r?\n/).length <= 220,
    "console-dynamic-status-patterns.ts must stay a focused status/message pattern slice",
  );
  assert.match(
    consoleMessagesText,
    /export\s+const\s+consoleMessages\s*=\s*\{/,
    "console-messages.ts must own the structured console message catalog",
  );
  assert.match(
    consolePhraseTypesText,
    /export\s+type\s+ConsolePhrasePair\b/,
    "console-phrase-types.ts must own the shared phrase-pair type",
  );
  assert.match(
    consolePhrasesText,
    /from\s+["']\.\/console-phrases\/shell-core["']/,
    "console-phrases.ts must import the shell/core phrase catalog slice",
  );
  assert.match(
    consolePhrasesText,
    /from\s+["']\.\/console-phrases\/segments["']/,
    "console-phrases.ts must re-export the segment replacement catalog",
  );
  assert.ok(
    consolePhrasesText.trimEnd().split(/\r?\n/).length <= 40,
    "console-phrases.ts must stay a small import facade over phrase catalog slices",
  );
  assert.doesNotMatch(
    consolePhrasesText,
    /^\s+\[/m,
    "console-phrases.ts must not own static phrase entries directly",
  );
  [
    ["shell-core.ts", consolePhraseShellCoreText, [/服务端控制台/, /工具调用配置/]],
    ["debug.ts", consolePhraseDebugText, [/知识召回/, /智能检索/]],
    ["knowledge.ts", consolePhraseKnowledgeText, [/知识入库/, /邮件专家规则/]],
    ["governance-workspaces-feed.ts", consolePhraseGovernanceWorkspacesFeedText, [/统一权限治理/, /工作空间详情/, /信息流/]],
    ["ops-production.ts", consolePhraseOpsProductionText, [/运维监控/, /生产准入/, /工具管理平台/]],
    ["segments.ts", consolePhraseSegmentsText, [/运行代次/, /未命名/]],
  ].forEach(([label, text, sentinels]) => {
    sentinels.forEach((sentinel) => {
      assert.match(
        text,
        sentinel,
        `console phrase slice ${label} must own its expected catalog entries`,
      );
    });
  });
  assert.ok(
    featuresCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/features.css must stay a small import facade over feature CSS modules",
  );
  assert.doesNotMatch(
    featuresCssText,
    /\.(dashboard-shell|side-nav|surface-card|jobs-table|config-drawer)\b/,
    "styles/features.css must not own feature selectors directly",
  );
  [
    ["base.css", featureBaseCssText, /Reset & base improvements|Typography refinements/],
    ["shell.css", featureShellCssText, /\.dashboard-shell|\.side-nav|\.topbar/],
    ["controls.css", featureControlsCssText, /\.surface-card|\.tool-button|\.form-group/],
    ["tables.css", featureTablesCssText, /\.jobs-table|\.empty-state/],
    ["panels.css", featurePanelsCssText, /\.module-card|\.config-drawer|\.path-picker-modal/],
    ["dashboard-progress.css", featureDashboardProgressCssText, /\.metric-grid|\.progress-list|\.skeleton-card/],
    ["responsive.css", featureResponsiveCssText, /@media\s+\(max-width:\s*860px\)|@media\s+print/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      featuresCssText,
      new RegExp(`@import\\s+["']\\.\\/features\\/${escapeRegex(fileName)}["'];`),
      `styles/features.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected feature CSS slice`,
    );
  });
  assert.ok(
    componentsCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/components.css must stay a small import facade over component CSS modules",
  );
  assert.doesNotMatch(
    componentsCssText,
    /\.(configuration-alert-card|metric-card|jobs-table|module-panel|model-library-card)\b/,
    "styles/components.css must not own component selectors directly",
  );
  [
    ["dashboard-alerts.css", componentDashboardAlertsCssText, /\.configuration-alert-card|\.pact-copy-bubble/],
    ["dashboard-metrics.css", componentDashboardMetricsCssText, /\.metric-grid|\.dashboard-grid/],
    ["tables-forms.css", componentTablesFormsCssText, /\.table-toolbar|\.field-label-with-tooltip/],
    ["system-details.css", componentSystemDetailsCssText, /\.system-overview-card|\.mount-list/],
    ["runtime-modules.css", componentRuntimeModulesCssText, /\.modules-layout|\.oauth-panel/],
    ["model-library.css", componentModelLibraryCssText, /\.model-library-card|\.model-probe-result/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      componentsCssText,
      new RegExp(`@import\\s+["']\\.\\/components\\/${escapeRegex(fileName)}["'];`),
      `styles/components.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected component CSS slice`,
    );
  });
  assert.ok(
    themesCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/themes.css must stay a small import facade over theme CSS modules",
  );
  assert.doesNotMatch(
    themesCssText,
    /html\.theme-(?:dark|light)|@media\s+\(prefers-color-scheme:\s*dark\)/,
    "styles/themes.css must not own theme selectors directly",
  );
  [
    ["system-dark-tokens.css", themeSystemDarkTokensCssText, /@media\s+\(prefers-color-scheme:\s*dark\)[\s\S]*--bg-base:\s*#0b0c10/],
    ["system-dark-element-plus.css", themeSystemDarkElementPlusCssText, /@media\s+\(prefers-color-scheme:\s*dark\)[\s\S]*--el-bg-color/],
    ["system-dark-application.css", themeSystemDarkApplicationCssText, /@media\s+\(prefers-color-scheme:\s*dark\)[\s\S]*\.auth-card/],
    ["appearance-presets.css", themeAppearancePresetsCssText, /--el-color-primary:\s*var\(--brand\)/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      themesCssText,
      new RegExp(`@import\\s+["']\\.\\/themes\\/${escapeRegex(fileName)}["'];`),
      `styles/themes.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected theme CSS slice`,
    );
  });
  [
    "default-system",
    "geek-light-blue",
    "sunset-ember",
    "tokyo-night",
    "monokai",
    "cyberpunk",
    "cappuccino-dark",
  ].forEach((presetId) => {
    assert.match(
      appearancePresetConfigTexts.get(presetId) || "",
      new RegExp(`"id"\\s*:\\s*"${escapeRegex(presetId)}"`),
      `appearance preset config must define ${presetId}`,
    );
  });
  assert.ok(
    layoutCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/layout.css must stay a small import facade over layout CSS modules",
  );
  assert.doesNotMatch(
    layoutCssText,
    /\.(dashboard-shell|side-nav|auth-gate|topbar|sidebar-collapse-toggle)\b/,
    "styles/layout.css must not own layout selectors directly",
  );
  [
    ["shell-sidebar.css", layoutShellSidebarCssText, /\.dashboard-shell|\.side-nav|\.side-link/],
    ["actions.css", layoutActionsCssText, /\.tool-button|\.primary-action|@keyframes\s+spin/],
    ["canvas-topbar-status.css", layoutCanvasTopbarStatusCssText, /\.dashboard-canvas|\.topbar|\.status-strip/],
    ["topbar-auth-brand.css", layoutTopbarAuthBrandCssText, /\.topbar-hamburger|\.auth-brand/],
    ["sidebar-collapse.css", layoutSidebarCollapseCssText, /\.side-nav\.is-collapsed|\.sidebar-collapse-toggle/],
    ["auth-transition-scrollbar.css", layoutAuthTransitionScrollbarCssText, /\.auth-gate|\.view-fade-enter-active|::-webkit-scrollbar/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      layoutCssText,
      new RegExp(`@import\\s+["']\\.\\/layout\\/${escapeRegex(fileName)}["'];`),
      `styles/layout.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected layout CSS slice`,
    );
  });
  assert.ok(
    wordCloudCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/word-cloud.css must stay a small import facade over word-cloud CSS modules",
  );
  assert.doesNotMatch(
    wordCloudCssText,
    /\.(word-cloud-stage|word-cloud-class-card|word-cloud-term-grid|word-cloud-editor)\b/,
    "styles/views/word-cloud.css must not own word-cloud selectors directly",
  );
  [
    ["stage-corpus.css", wordCloudStageCorpusCssText, /\.word-cloud-stage|\.word-cloud-corpus-scope/],
    ["class-cards.css", wordCloudClassCardsCssText, /\.word-cloud-class-card|\.word-cloud-card-actions|\.word-cloud-action-popover/],
    ["terms-loading.css", wordCloudTermsLoadingCssText, /\.word-cloud-term-grid|\.word-cloud-term-row|\.word-cloud-loading/],
    ["editor-dialogs.css", wordCloudEditorDialogsCssText, /\.word-cloud-editor|\.word-cloud-dialog|\.maintenance-run-table/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      wordCloudCssText,
      new RegExp(`@import\\s+["']\\.\\/word-cloud\\/${escapeRegex(fileName)}["'];`),
      `styles/views/word-cloud.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected word-cloud CSS slice`,
    );
  });
  assert.ok(
    debugAgentExploreCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/debug-agent-explore.css must stay a small import facade over debug/agent-explore CSS modules",
  );
  assert.doesNotMatch(
    debugAgentExploreCssText,
    /\.(agent-explore-card|distillation-debug-form|agent-explore-form|rule-authoring-card|agent-explore-history|agent-function-call)\b/,
    "styles/views/debug-agent-explore.css must not own debug/agent-explore selectors directly",
  );
  [
    ["debug-distillation.css", debugAgentExploreDebugDistillationCssText, /\.agent-explore-card|\.distillation-debug-form|\.debug-result-list/],
    ["explore-form.css", debugAgentExploreExploreFormCssText, /\.agent-debug-parameter-grid|\.agent-explore-tab-strip|\.agent-explore-form/],
    ["rule-authoring.css", debugAgentExploreRuleAuthoringCssText, /\.rule-authoring-card|\.rule-authoring-form|\.rule-authoring-pipeline/],
    ["progress-history.css", debugAgentExploreProgressHistoryCssText, /\.agent-explore-progress|\.agent-explore-history|\.agent-explore-history-list/],
    ["workspace.css", debugAgentExploreWorkspaceCssText, /\.agent-explore-workspace|\.agent-explore-answer|\.agent-explore-split-resizer/],
    ["trace-results.css", debugAgentExploreTraceResultsCssText, /\.agent-function-call|\.agent-tool-result|\.agent-state-timeline/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      debugAgentExploreCssText,
      new RegExp(`@import\\s+["']\\.\\/debug-agent-explore\\/${escapeRegex(fileName)}["'];`),
      `styles/views/debug-agent-explore.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected debug/agent-explore CSS slice`,
    );
  });
  assert.ok(
    knowledgeSourcesCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/knowledge-sources.css must stay a small import facade over knowledge-source CSS modules",
  );
  assert.doesNotMatch(
    knowledgeSourcesCssText,
    /\.(knowledge-source-form|knowledge-library-board|knowledge-import-card|knowledge-document-preview-panel)\b/,
    "styles/views/knowledge-sources.css must not own knowledge-source selectors directly",
  );
  [
    ["source-overview.css", knowledgeSourcesSourceOverviewCssText, /\.knowledge-source-form|\.knowledge-source-card|\.ingest-choice/],
    ["library-backends.css", knowledgeSourcesLibraryBackendsCssText, /\.knowledge-library-board|\.knowledge-backend-config-card|\.knowledge-ingest-target-select-panel/],
    ["import-export.css", knowledgeSourcesImportExportCssText, /\.knowledge-import-card|\.knowledge-import-dropzone|\.knowledge-export-select/],
    ["preview-audit.css", knowledgeSourcesPreviewAuditCssText, /\.knowledge-document-preview-panel|\.json-editor|\.audit-table/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      knowledgeSourcesCssText,
      new RegExp(`@import\\s+["']\\.\\/knowledge-sources\\/${escapeRegex(fileName)}["'];`),
      `styles/views/knowledge-sources.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected knowledge-source CSS slice`,
    );
  });
  assert.ok(
    infoFeedFlowCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/info-feed-flow.css must stay a small import facade over info-feed flow CSS modules",
  );
  assert.doesNotMatch(
    infoFeedFlowCssText,
    /\.(info-feed-shell|info-feed-flow|info-feed-context-gate-card|info-feed-turn-card|info-feed-expert-feedback)\b/,
    "styles/views/info-feed-flow.css must not own info-feed selectors directly",
  );
  [
    ["shell-history.css", infoFeedFlowShellHistoryCssText, /\.info-feed-shell|\.info-feed-history|\.info-feed-empty/],
    ["track-results.css", infoFeedFlowTrackResultsCssText, /\.info-feed-flow|\.info-feed-track-grid|\.info-feed-result-row/],
    ["context-answer.css", infoFeedFlowContextAnswerCssText, /\.info-feed-context-gate-card|\.info-feed-low-relevance-panel|\.info-feed-agent-answer/],
    ["conversation-clarification.css", infoFeedFlowConversationClarificationCssText, /\.info-feed-summary-filter|\.info-feed-turn-card|\.info-feed-clarification-option/],
    ["feedback-summary.css", infoFeedFlowFeedbackSummaryCssText, /\.info-feed-expert-feedback|\.info-feed-summary-header/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      infoFeedFlowCssText,
      new RegExp(`@import\\s+["']\\.\\/info-feed-flow\\/${escapeRegex(fileName)}["'];`),
      `styles/views/info-feed-flow.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected info-feed flow CSS slice`,
    );
  });
  assert.ok(
    knowledgeMaintenanceCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/knowledge-maintenance.css must stay a small import facade over knowledge-maintenance CSS modules",
  );
  assert.doesNotMatch(
    knowledgeMaintenanceCssText,
    /\.(knowledge-maintenance|mount-config-list|source-card|approval-request-card|data-source-dialog)\b/,
    "styles/views/knowledge-maintenance.css must not own knowledge-maintenance selectors directly",
  );
  [
    ["rules-config.css", knowledgeMaintenanceRulesConfigCssText, /\.knowledge-maintenance|\.expert-rule-card|\.mount-config-list/],
    ["sources-layout.css", knowledgeMaintenanceSourcesLayoutCssText, /\.sources-layout|\.source-card|\.source-progress/],
    ["approval-empty.css", knowledgeMaintenanceApprovalEmptyCssText, /\.approval-request-card|\.approval-request-empty-card|\.source-empty-card/],
    ["data-source-dialog.css", knowledgeMaintenanceDataSourceDialogCssText, /\.data-source-dialog-backdrop|\.data-source-dialog|\.data-source-config-panel/],
    ["compact-metrics.css", knowledgeMaintenanceCompactMetricsCssText, /\.compact-select|\.compact-metrics|\.knowledge-entry/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      knowledgeMaintenanceCssText,
      new RegExp(`@import\\s+["']\\.\\/knowledge-maintenance\\/${escapeRegex(fileName)}["'];`),
      `styles/views/knowledge-maintenance.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected knowledge-maintenance CSS slice`,
    );
  });
  assert.ok(
    adminRuntimeToolsCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/admin-runtime-tools.css must stay a small import facade over admin/runtime/tool CSS modules",
  );
  assert.doesNotMatch(
    adminRuntimeToolsCssText,
    /\.(client-runtime-card|source-client-request-chart|monitor-alert-table|admin-shell|tool-management-card)\b/,
    "styles/views/admin-runtime-tools.css must not own admin/runtime/tool selectors directly",
  );
  [
    ["tables.css", adminRuntimeToolsTablesCssText, /\.ops-process-table|\.tool-list-table|\.permission-tool-rule-table/],
    ["runtime-metrics.css", adminRuntimeToolsRuntimeMetricsCssText, /\.client-runtime-card|\.client-runtime-heatmap|\.source-client-request-chart/],
    ["monitor-maintenance.css", adminRuntimeToolsMonitorMaintenanceCssText, /\.monitor-alert-table|\.monitor-alert-detail|\.maintenance-agent-quick-actions/],
    ["admin-tool-shell.css", adminRuntimeToolsAdminToolShellCssText, /\.admin-shell|\.tool-catalog-management-grid|\.tool-editor-panel/],
    ["permission-cards.css", adminRuntimeToolsPermissionCardsCssText, /\.tool-management-card|\.permission-card|\.scope-chip/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      adminRuntimeToolsCssText,
      new RegExp(`@import\\s+["']\\.\\/admin-runtime-tools\\/${escapeRegex(fileName)}["'];`),
      `styles/views/admin-runtime-tools.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected admin/runtime/tool CSS slice`,
    );
  });
  assert.ok(
    drawerPathDialogsCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/drawer-path-dialogs.css must stay a small import facade over drawer/dialog CSS modules",
  );
  assert.doesNotMatch(
    drawerPathDialogsCssText,
    /\.(drawer-backdrop|vocabulary-table|path-picker-dialog|path-picker-entry)\b/,
    "styles/views/drawer-path-dialogs.css must not own drawer/dialog selectors directly",
  );
  [
    ["drawer-settings.css", drawerPathDialogsDrawerSettingsCssText, /\.drawer-backdrop|\.config-drawer|\.settings-sub-card/],
    ["vocabulary-rules.css", drawerPathDialogsVocabularyRulesCssText, /\.vocabulary-meta|\.vocabulary-table|\.rules-json-panel/],
    ["dialog-shells.css", drawerPathDialogsDialogShellsCssText, /\.path-picker-backdrop|\.path-picker-dialog|\.agent-evidence-preview-dialog/],
    ["path-picker-controls.css", drawerPathDialogsPathPickerControlsCssText, /\.path-picker-header|\.path-picker-list|\.path-picker-entry/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      drawerPathDialogsCssText,
      new RegExp(`@import\\s+["']\\.\\/drawer-path-dialogs\\/${escapeRegex(fileName)}["'];`),
      `styles/views/drawer-path-dialogs.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected drawer/dialog CSS slice`,
    );
  });
  assert.ok(
    adminMaintenanceCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/admin-maintenance.css must stay a small import facade over admin-maintenance CSS modules",
  );
  assert.doesNotMatch(
    adminMaintenanceCssText,
    /\.(maintenance-agent-layout|document-chunking-console|document-chunking-attachment-row|document-chunk-block|document-chunk-card)\b/,
    "styles/views/admin-maintenance.css must not own admin-maintenance selectors directly",
  );
  [
    ["maintenance-permissions.css", adminMaintenanceMaintenancePermissionsCssText, /\.maintenance-agent-layout|\.agent-permission-group-card/],
    ["chunking-shell.css", adminMaintenanceChunkingShellCssText, /\.document-chunking-console|\.document-chunking-header|\.document-chunking-dropzone/],
    ["chunking-inputs.css", adminMaintenanceChunkingInputsCssText, /\.document-chunking-attachment-row|\.document-chunking-controls|\.document-chunking-pipeline/],
    ["chunking-block-editor.css", adminMaintenanceChunkingBlockEditorCssText, /\.document-chunk-block-section|\.document-chunk-block|\.document-chunking-rendered/],
    ["chunking-list-detail.css", adminMaintenanceChunkingListDetailCssText, /\.document-chunking-list|\.document-chunk-card|\.document-chunking-detail/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      adminMaintenanceCssText,
      new RegExp(`@import\\s+["']\\.\\/admin-maintenance\\/${escapeRegex(fileName)}["'];`),
      `styles/views/admin-maintenance.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected admin-maintenance CSS slice`,
    );
  });
  assert.ok(
    shellKnowledgeSearchCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/shell-and-knowledge-search.css must stay a small import facade over knowledge-search CSS modules",
  );
  assert.doesNotMatch(
    shellKnowledgeSearchCssText,
    /\.(knowledge-page-search|knowledge-log-report|knowledge-review-decision-card|knowledge-result)\b/,
    "styles/views/shell-and-knowledge-search.css must not own knowledge-search selectors directly",
  );
  [
    ["search-workspace.css", shellKnowledgeSearchSearchWorkspaceCssText, /\.knowledge-page-search|\.knowledge-search-workspace|\.knowledge-evidence-card/],
    ["log-report.css", shellKnowledgeSearchLogReportCssText, /\.knowledge-log-report|\.knowledge-log-table-shell|\.knowledge-log-status/],
    ["conflict-review.css", shellKnowledgeSearchConflictReviewCssText, /\.knowledge-conflict-table|\.knowledge-review-decision-card|\.knowledge-conflict-expanded/],
    ["result-list.css", shellKnowledgeSearchResultListCssText, /\.knowledge-result-list|\.knowledge-result|\.empty-note/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      shellKnowledgeSearchCssText,
      new RegExp(`@import\\s+["']\\.\\/shell-and-knowledge-search\\/${escapeRegex(fileName)}["'];`),
      `styles/views/shell-and-knowledge-search.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected knowledge-search CSS slice`,
    );
  });
  assert.ok(
    responsiveSharedCssText.trimEnd().split(/\r?\n/).length <= 30,
    "styles/views/responsive-shared.css must stay a small import facade over responsive CSS modules",
  );
  assert.doesNotMatch(
    responsiveSharedCssText,
    /@media\s+\(max-width:|\.visually-hidden/,
    "styles/views/responsive-shared.css must not own responsive rules directly",
  );
  [
    ["wide-layout.css", responsiveSharedWideLayoutCssText, /@media\s+\(max-width:\s*1280px\)[\s\S]*\.metric-grid/],
    ["shell-knowledge.css", responsiveSharedShellKnowledgeCssText, /@media\s+\(max-width:\s*860px\)[\s\S]*\.dashboard-shell[\s\S]*\.knowledge-search-workspace/],
    ["agent-explore.css", responsiveSharedAgentExploreCssText, /@media\s+\(max-width:\s*960px\)[\s\S]*\.agent-explore-form[\s\S]*@media\s+\(max-width:\s*860px\)/],
    ["compact-720.css", responsiveSharedCompact720CssText, /@media\s+\(max-width:\s*720px\)[\s\S]*\.topbar[\s\S]*\.path-picker-toolbar/],
    ["log-filter-a11y.css", responsiveSharedLogFilterA11yCssText, /\.knowledge-log-filters[\s\S]*\.visually-hidden/],
  ].forEach(([fileName, text, sentinel]) => {
    assert.match(
      responsiveSharedCssText,
      new RegExp(`@import\\s+["']\\.\\/responsive-shared\\/${escapeRegex(fileName)}["'];`),
      `styles/views/responsive-shared.css must import ${fileName}`,
    );
    assert.match(
      text,
      sentinel,
      `${fileName} must own its expected responsive CSS slice`,
    );
  });
  assert.ok(
    infoFeedUtilsText.trimEnd().split(/\r?\n/).length <= 20,
    "console-info-feed-utils.ts must stay a thin compatibility facade over focused info-feed utility modules",
  );
  assert.match(
    infoFeedUtilsText,
    /export\s+\*\s+from\s+["']\.\/console-info-feed-state-utils["']/,
    "console-info-feed-utils.ts must re-export run/history utility ownership",
  );
  assert.match(
    infoFeedUtilsText,
    /export\s+\*\s+from\s+["']\.\/console-info-feed-summary-utils["']/,
    "console-info-feed-utils.ts must re-export source/summary utility ownership",
  );
  assert.doesNotMatch(
    infoFeedUtilsText,
    /function\s+|const\s+INFO_FEED_CONTEXT_CHARS_PER_TOKEN|interface\s+InfoFeed/,
    "console-info-feed-utils.ts must not own info-feed utility implementations directly",
  );
  assert.match(
    infoFeedStateUtilsText,
    /export\s+\*\s+from\s+["']\.\/console-info-feed-shared-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-info-feed-attachment-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-info-feed-run-state-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-info-feed-history-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-info-feed-agent-query-utils["']/,
    "console-info-feed-state-utils.ts must re-export focused info-feed state utility owners",
  );
  assert.ok(
    infoFeedStateUtilsText.trimEnd().split(/\r?\n/).length <= 10,
    "console-info-feed-state-utils.ts must stay a thin compatibility facade",
  );
  assert.doesNotMatch(
    infoFeedStateUtilsText,
    /function\s+|interface\s+InfoFeed|const\s+INFO_FEED_CONTEXT_CHARS_PER_TOKEN/,
    "console-info-feed-state-utils.ts must not own info-feed utility implementations directly",
  );
  assert.match(
    infoFeedSharedUtilsText,
    /INFO_FEED_CONTEXT_CHARS_PER_TOKEN[\s\S]*makeInfoFeedId[\s\S]*truncateInfoFeedText[\s\S]*infoFeedStatusLabel/,
    "console-info-feed-shared-utils.ts must own shared info-feed constants, ids, text, and status labels",
  );
  assert.ok(
    infoFeedSharedUtilsText.trimEnd().split(/\r?\n/).length <= 70,
    "console-info-feed-shared-utils.ts must stay a focused shared-helper module",
  );
  assert.match(
    infoFeedAttachmentUtilsText,
    /isReadableInfoFeedAttachment[\s\S]*compactInfoFeedAttachment[\s\S]*snapshotInfoFeedAttachments/,
    "console-info-feed-attachment-utils.ts must own attachment readability and compaction helpers",
  );
  assert.ok(
    infoFeedAttachmentUtilsText.trimEnd().split(/\r?\n/).length <= 60,
    "console-info-feed-attachment-utils.ts must stay a focused attachment-helper module",
  );
  assert.doesNotMatch(
    infoFeedAttachmentUtilsText,
    /InfoFeedRunState|KnowledgeSearchResult|extractEvidenceRefsFromText/,
    "console-info-feed-attachment-utils.ts must not own run, history, or evidence projection logic",
  );
  assert.match(
    infoFeedRunStateUtilsText,
    /createInfoFeedFollowUpContext[\s\S]*createInfoFeedRunState[\s\S]*resetInfoFeedRunForContinuationCore/,
    "console-info-feed-run-state-utils.ts must own run creation, follow-up, turn snapshot, and continuation reset helpers",
  );
  assert.ok(
    infoFeedRunStateUtilsText.trimEnd().split(/\r?\n/).length <= 190,
    "console-info-feed-run-state-utils.ts must stay below the focused run-state threshold",
  );
  assert.doesNotMatch(
    infoFeedRunStateUtilsText,
    /normalizeInfoFeedHistoryCore|buildInfoFeedAgentQueryCore|infoFeedAgentRecentTurnsCore/,
    "console-info-feed-run-state-utils.ts must not own history normalization or agent-query projection",
  );
  assert.match(
    infoFeedHistoryUtilsText,
    /compactInfoFeedRunForStorage[\s\S]*sanitizeInfoFeedRunModelReferences[\s\S]*normalizeInfoFeedHistoryCore/,
    "console-info-feed-history-utils.ts must own persisted history compaction, model-reference sanitation, and normalization",
  );
  assert.ok(
    infoFeedHistoryUtilsText.trimEnd().split(/\r?\n/).length <= 160,
    "console-info-feed-history-utils.ts must stay below the focused history-helper threshold",
  );
  assert.doesNotMatch(
    infoFeedHistoryUtilsText,
    /createInfoFeedRunState|buildInfoFeedAgentQueryCore|extractEvidenceRefsFromText/,
    "console-info-feed-history-utils.ts must not own run creation, agent-query projection, or evidence extraction",
  );
  assert.match(
    infoFeedAgentQueryUtilsText,
    /buildInfoFeedSourceSearchQueryCore[\s\S]*buildInfoFeedAgentQueryCore[\s\S]*infoFeedAgentRecentTurnsCore[\s\S]*infoFeedAgentExpertGuidanceCore/,
    "console-info-feed-agent-query-utils.ts must own source search and agent-query projection helpers",
  );
  assert.ok(
    infoFeedAgentQueryUtilsText.trimEnd().split(/\r?\n/).length <= 100,
    "console-info-feed-agent-query-utils.ts must stay below the focused agent-query threshold",
  );
  assert.doesNotMatch(
    infoFeedAgentQueryUtilsText,
    /createInfoFeedRunState|normalizeInfoFeedHistoryCore|snapshotInfoFeedAttachments|KnowledgeSearchResult/,
    "console-info-feed-agent-query-utils.ts must not own run creation, history normalization, attachment compaction, or keyword result contracts",
  );
  assert.match(
    infoFeedSummaryUtilsText,
    /export\s+\*\s+from\s+["']\.\/console-info-feed-source-context-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-info-feed-source-summary-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-info-feed-summary-question-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-info-feed-clarification-utils["']/,
    "console-info-feed-summary-utils.ts must re-export focused source context, source summary, summary question, and clarification owners",
  );
  assert.ok(
    infoFeedSummaryUtilsText.trimEnd().split(/\r?\n/).length <= 10,
    "console-info-feed-summary-utils.ts must stay a thin compatibility facade",
  );
  assert.doesNotMatch(
    infoFeedSummaryUtilsText,
    /function\s+|KnowledgeSearchResult|InfoFeedClarification|asRecord|modelAgentUid/,
    "console-info-feed-summary-utils.ts must not own source, summary, or clarification implementations directly",
  );
  assert.match(
    infoFeedSourceContextUtilsText,
    /isLowRelevanceSourceResult[\s\S]*infoFeedSourceResultLine[\s\S]*infoFeedSourceContextBudgetChars[\s\S]*buildInfoFeedSourceContextCore/,
    "console-info-feed-source-context-utils.ts must own source relevance, result lines, context budget, and source-context assembly",
  );
  assert.ok(
    infoFeedSourceContextUtilsText.trimEnd().split(/\r?\n/).length <= 170,
    "console-info-feed-source-context-utils.ts must stay below the focused source-context threshold",
  );
  assert.doesNotMatch(
    infoFeedSourceContextUtilsText,
    /buildInfoFeedSummaryQuestionCore|fallbackInfoFeedSummaryCore|extractInfoFeedClarificationCore|archiveInfoFeedExpertFeedbackCore|modelAgentUid/,
    "console-info-feed-source-context-utils.ts must not own summary prompt, fallback summary, or clarification feedback logic",
  );
  assert.match(
    infoFeedSourceSummaryUtilsText,
    /buildInfoFeedSourceSummaryCore[\s\S]*infoFeedRunEvidenceRefsCore/,
    "console-info-feed-source-summary-utils.ts must own source summary assembly and evidence-ref extraction",
  );
  assert.ok(
    infoFeedSourceSummaryUtilsText.trimEnd().split(/\r?\n/).length <= 90,
    "console-info-feed-source-summary-utils.ts must stay below the focused source-summary threshold",
  );
  assert.doesNotMatch(
    infoFeedSourceSummaryUtilsText,
    /buildInfoFeedSourceContextCore|buildInfoFeedSummaryQuestionCore|extractInfoFeedClarificationCore|archiveInfoFeedExpertFeedbackCore/,
    "console-info-feed-source-summary-utils.ts must not own context budgeting, prompt assembly, or clarification feedback logic",
  );
  assert.match(
    infoFeedSummaryQuestionUtilsText,
    /buildInfoFeedSummaryQuestionCore[\s\S]*fallbackInfoFeedSummaryCore/,
    "console-info-feed-summary-question-utils.ts must own summary prompt and fallback summary text",
  );
  assert.ok(
    infoFeedSummaryQuestionUtilsText.trimEnd().split(/\r?\n/).length <= 70,
    "console-info-feed-summary-question-utils.ts must stay below the focused summary-question threshold",
  );
  assert.doesNotMatch(
    infoFeedSummaryQuestionUtilsText,
    /buildInfoFeedSourceContextCore|infoFeedRunEvidenceRefsCore|extractInfoFeedClarificationCore|archiveInfoFeedExpertFeedbackCore|modelAgentUid/,
    "console-info-feed-summary-question-utils.ts must not own source context, evidence extraction, or clarification feedback logic",
  );
  assert.match(
    infoFeedClarificationUtilsText,
    /archiveInfoFeedExpertFeedbackCore[\s\S]*normalizeInfoFeedClarificationOptionCore[\s\S]*extractInfoFeedClarificationCore[\s\S]*buildFallbackInfoFeedClarificationCore[\s\S]*applyInfoFeedSummaryAnswerCore/,
    "console-info-feed-clarification-utils.ts must own clarification parsing, fallback choices, answer application, and feedback archiving",
  );
  assert.ok(
    infoFeedClarificationUtilsText.trimEnd().split(/\r?\n/).length <= 170,
    "console-info-feed-clarification-utils.ts must stay below the focused clarification threshold",
  );
  assert.doesNotMatch(
    infoFeedClarificationUtilsText,
    /buildInfoFeedSourceContextCore|buildInfoFeedSourceSummaryCore|buildInfoFeedSummaryQuestionCore|fallbackInfoFeedSummaryCore|KnowledgeSearchResult/,
    "console-info-feed-clarification-utils.ts must not own source context, source summary, prompt, fallback summary, or keyword result contracts",
  );
  assert.match(
    infoFeedDerivationControllerText,
    /createConsoleInfoFeedDerivationController[\s\S]*buildInfoFeedSourceContextCore[\s\S]*infoFeedRunEvidenceRefsCore/,
    "console-info-feed-derivation-controller.ts must own info-feed source, summary, evidence, and clarification derivations",
  );
  assert.ok(
    infoFeedDerivationControllerText.trimEnd().split(/\r?\n/).length <= 180,
    "console-info-feed-derivation-controller.ts must stay a focused pure-derivation boundary",
  );
  assert.doesNotMatch(
    infoFeedDerivationControllerText,
    /from\s+["']vue["']|\bref\s*\(|\bcomputed\s*\(/,
    "console-info-feed-derivation-controller.ts must not own Vue state or computed projections",
  );
  assert.ok(
    infoFeedControllerText.trimEnd().split(/\r?\n/).length <= 430,
    "console-info-feed-controller.ts must stay below the composition-boundary threshold after derivation/model/keyword splits",
  );
  assert.match(
    infoFeedControllerText,
    /createConsoleInfoFeedDerivationController/,
    "console-info-feed-controller.ts must delegate source/summary/evidence derivations to the focused derivation controller",
  );
  assert.match(
    infoFeedControllerText,
    /createConsoleInfoFeedModelController/,
    "console-info-feed-controller.ts must delegate model/context selection to the focused model controller",
  );
  assert.match(
    infoFeedControllerText,
    /createConsoleInfoFeedKeywordController/,
    "console-info-feed-controller.ts must delegate keyword/result projections to the focused keyword controller",
  );
  assert.match(
    infoFeedModelControllerText,
    /selectedInfoFeedModel|infoFeedSummaryDefaults|agentExploreThinkingParameters/,
    "console-info-feed-model-controller.ts must own feed model, context, and thinking-mode selection",
  );
  assert.match(
    infoFeedKeywordControllerText,
    /infoFeedKeywordScanExplain|infoFeedContextGateNotice|infoFeedParentRunForCurrent/,
    "console-info-feed-keyword-controller.ts must own feed keyword/result UI projections",
  );
  assert.ok(
    infoFeedExecutionControllerText.trimEnd().split(/\r?\n/).length <= 320,
    "console-info-feed-execution-controller.ts must stay below the execution facade threshold after track, summary-runner, and expert-feedback extraction",
  );
  assert.match(
    infoFeedExecutionControllerText,
    /createConsoleInfoFeedTrackController/,
    "console-info-feed-execution-controller.ts must delegate keyword and agent track execution to the track controller",
  );
  assert.match(
    infoFeedExecutionControllerText,
    /createConsoleInfoFeedSummaryRunnerController/,
    "console-info-feed-execution-controller.ts must delegate summary agent execution to the summary runner controller",
  );
  assert.match(
    infoFeedExecutionControllerText,
    /createConsoleInfoFeedExpertFeedbackController/,
    "console-info-feed-execution-controller.ts must delegate expert feedback sync to the expert feedback controller",
  );
  assert.doesNotMatch(
    infoFeedExecutionControllerText,
    /\brunKnowledgeAgentExplore\b|\bgetKnowledgeAgentExploreRun\b|\bsearchKnowledge\s*\(|\bcallAgentGateway\b|\brecordKnowledgeFeedback\b|\bwithInfoFeedFetchRetry\b|\bisModelConfigurationError\b|\bisInfoFeedRetryExhaustedError\b|\binfoFeedSearchCacheKey\b|\bagentExploreRunStatus\b|\bnormalizeAgentExploreRun\b/,
    "console-info-feed-execution-controller.ts must not own keyword search, agent-run, summary-agent, feedback-sync, or retry network logic",
  );
  assert.ok(
    infoFeedSummaryRunnerControllerText.trimEnd().split(/\r?\n/).length <= 160,
    "console-info-feed-summary-runner-controller.ts must stay below the focused summary-runner threshold",
  );
  assert.match(
    infoFeedSummaryRunnerControllerText,
    /callAgentGateway[\s\S]*withInfoFeedFetchRetry[\s\S]*isModelConfigurationError[\s\S]*isInfoFeedRetryExhaustedError[\s\S]*runInfoFeedSummaryAgent/,
    "console-info-feed-summary-runner-controller.ts must own summary agent calls, retry/model-selection handling, and summary completion updates",
  );
  assert.doesNotMatch(
    infoFeedSummaryRunnerControllerText,
    /recordKnowledgeFeedback|runInfoFeedKeywordTrack|runInfoFeedAgentTrack|searchKnowledge\s*\(|runKnowledgeAgentExplore|getKnowledgeAgentExploreRun/,
    "console-info-feed-summary-runner-controller.ts must not own feedback sync, keyword track, or agent track logic",
  );
  assert.ok(
    infoFeedExpertFeedbackControllerText.trimEnd().split(/\r?\n/).length <= 90,
    "console-info-feed-expert-feedback-controller.ts must stay below the focused expert-feedback threshold",
  );
  assert.match(
    infoFeedExpertFeedbackControllerText,
    /recordKnowledgeFeedback[\s\S]*syncInfoFeedExpertFeedback/,
    "console-info-feed-expert-feedback-controller.ts must own expert feedback persistence sync",
  );
  assert.doesNotMatch(
    infoFeedExpertFeedbackControllerText,
    /callAgentGateway|withInfoFeedFetchRetry|runInfoFeedKeywordTrack|runInfoFeedAgentTrack|searchKnowledge\s*\(|runKnowledgeAgentExplore|getKnowledgeAgentExploreRun/,
    "console-info-feed-expert-feedback-controller.ts must not own summary, keyword, or agent track execution",
  );
  assert.ok(
    infoFeedTrackControllerText.trimEnd().split(/\r?\n/).length <= 230,
    "console-info-feed-track-controller.ts must stay a focused keyword/agent track runner",
  );
  assert.match(
    infoFeedTrackControllerText,
    /export\s+function\s+createConsoleInfoFeedTrackController\b/,
    "console-info-feed-track-controller.ts must expose the info-feed track runner boundary",
  );
  assert.match(
    infoFeedTrackControllerText,
    /\bsearchKnowledge\s*\([\s\S]*\brunKnowledgeAgentExplore\s*\([\s\S]*\bgetKnowledgeAgentExploreRun\s*\(/,
    "console-info-feed-track-controller.ts must own keyword search, agent run start, and agent run polling",
  );
  assert.doesNotMatch(
    infoFeedTrackControllerText,
    /\brecordKnowledgeFeedback\b|\bcallAgentGateway\b/,
    "console-info-feed-track-controller.ts must not own summary or expert-feedback side effects",
  );
  assert.doesNotMatch(
    infoFeedControllerText,
    /function\s+inactiveInfoFeedAgentOption|function\s+selectedInfoFeedAgentFromOptions|const\s+infoFeedKeywordScanExplain\s*=\s*computed|const\s+infoFeedAgentAnswer\s*=\s*computed|buildInfoFeedSourceContextCore|infoFeedRunEvidenceRefsCore|function\s+buildInfoFeedSourceContext|function\s+infoFeedSourceSummary|function\s+archiveInfoFeedExpertFeedback/,
    "console-info-feed-controller.ts must not own model-selection helpers, keyword computeds, or source/summary/evidence derivations directly",
  );
  assert.ok(
    systemLogRowControllerText.trimEnd().split(/\r?\n/).length <= 90,
    "console-system-log-row-controller.ts must stay a thin facade after base/status row extraction",
  );
  assert.match(
    systemLogRowControllerText,
    /buildBaseServerLogRows[\s\S]*buildSystemStatusLogRows/,
    "console-system-log-row-controller.ts must compose the focused system-log row builders",
  );
  assert.doesNotMatch(
    systemLogRowControllerText,
    /kindLabel:\s*["']|uploadTraceTone|sourceJobProgress|queueLifecycleLabel|monitorAlertSeverityLabel|backgroundProcessLabel|asRecord\s*\(/,
    "console-system-log-row-controller.ts must not own source-specific log row projections directly",
  );
  assert.ok(
    systemLogBaseRowControllerText.trimEnd().split(/\r?\n/).length <= 140,
    "console-system-log-base-row-controller.ts must stay focused on upload, ingest job, source, and reference rows",
  );
  assert.match(
    systemLogBaseRowControllerText,
    /uploadTraceEvents[\s\S]*knowledgeRecentJobs[\s\S]*activeKnowledgeSources[\s\S]*agentSelectionReferenceLogs/,
    "console-system-log-base-row-controller.ts must own base server log row projections",
  );
  assert.doesNotMatch(
    systemLogBaseRowControllerText,
    /activeMonitorAlerts|authAudit|backgroundProcesses|toolManagementAuditItems|WorkQueueRow|ConsoleAuditItem/,
    "console-system-log-base-row-controller.ts must not own system status, alert, or audit row projections",
  );
  assert.ok(
    systemLogStatusRowControllerText.trimEnd().split(/\r?\n/).length <= 250,
    "console-system-log-status-row-controller.ts must stay focused on queue, process, alert, tool, and audit rows",
  );
  assert.match(
    systemLogStatusRowControllerText,
    /workQueueRows[\s\S]*recentJobs[\s\S]*backgroundProcesses[\s\S]*activeMonitorAlerts[\s\S]*toolManagementAuditItems[\s\S]*authAudit/,
    "console-system-log-status-row-controller.ts must own system status log row projections",
  );
  assert.doesNotMatch(
    systemLogStatusRowControllerText,
    /uploadTraceEvents|activeKnowledgeSources|agentSelectionReferenceLogs|sourceJobProgress|uploadTraceTone/,
    "console-system-log-status-row-controller.ts must not own base ingest/source row projections",
  );
  assert.ok(
    systemLogRowUtilsText.trimEnd().split(/\r?\n/).length <= 50,
    "console-system-log-row-utils.ts must stay a small shared row helper module",
  );
  assert.match(
    systemLogRowUtilsText,
    /compactLogDetail[\s\S]*genericStatusTone[\s\S]*stateProgressPercent/,
    "console-system-log-row-utils.ts must own compact detail, generic tone, and progress helpers",
  );
  assert.doesNotMatch(
    systemLogRowUtilsText,
    /KnowledgeLogRow|computed\s*\(|asRecord\s*\(/,
    "console-system-log-row-utils.ts must not own row projection or Vue state",
  );
  assert.doesNotMatch(
    bridgeText,
    /import\s+type\s+\{[^}]*Console(?:AuditItem|AuthSummary|AuthSession|OidcConfig|Role|User)[^}]*\}\s+from\s+["']\.\/types["']/,
    "bridge.ts must import console auth contracts from auth-types.ts, not the cross-domain types.ts facade",
  );
  [
    ["auth-client.ts", authClientText],
    ["console-auth-controller.ts", authControllerText],
    ["console-system-log-row-controller.ts", systemLogRowControllerText],
    ["console-system-log-status-row-controller.ts", systemLogStatusRowControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /import\s+type\s+\{[^}]*Console(?:AuditItem|AuthSummary|AuthSession|OidcConfig|Role|User)[^}]*\}\s+from\s+["'](?:\.\/|\.\.\/lib\/)types["']/,
      `${label} must import console auth contracts from auth-types.ts, not the cross-domain types.ts facade`,
    );
  });
  assert.match(
    systemLogStatusRowControllerText,
    /from\s+["']\.\.\/lib\/auth-types["']/,
    "console-system-log-status-row-controller.ts must import console auth contracts from auth-types.ts",
  );
  assert.doesNotMatch(
    useConsoleText,
    /\bConsole(?:AuditItem|AuthSummary|AuthSession|OidcConfig|Role|User)\b/,
    "useConsole.ts must not directly depend on console auth domain types",
  );
  assert.doesNotMatch(
    authControllerText,
    /from\s+["']\.\.\/lib\/bridge["']/,
    "console-auth-controller.ts must depend on auth-client.ts, not the global bridge facade",
  );
  assert.doesNotMatch(
    authControllerText,
    /\bbridge\s*\.\s*(getAuthSession|loginAuth|logoutAuth|listAuthUsers|updateAuthUser|getAuthOidc|saveAuthOidc|listAuthAudit|listAuthSessions|revokeAuthSession)\b/,
    "console-auth-controller.ts must not call console auth APIs through bridge",
  );
  assert.match(
    authControllerText,
    /const\s+authState\s*=\s*ref/,
    "console-auth-controller.ts must own auth session state",
  );
  assert.match(
    authControllerText,
    /function\s+hasScope/,
    "console-auth-controller.ts must own auth scope projection",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+(?:authState|authBootstrapping|loginForm|authUsers|authAudit|authSessions|oidcDraft|oidcAllowedDomainsText|oidcRoleMappingText)\s*=\s*ref|const\s+(?:currentUser|isAuthenticated|currentUserScopes|canAdminAuth|canReadKnowledge|canWriteKnowledge|canMaintainKnowledge|canAdminKnowledge|canWriteJobs|canBrowseServerPaths|canAdminRuntime|canReadMaintenanceAgent|canRunMaintenanceAgent|canApproveMaintenanceAgent|canAdminMaintenanceAgent)\s*=\s*computed|function\s+hasScope/,
    "useConsole.ts must delegate auth state and permission projection to console-auth-controller.ts",
  );
  assert.match(
    busyControllerText,
    /const\s+busyKeys\s*=\s*ref/,
    "console-busy-controller.ts must own the global busy key set",
  );
  assert.match(
    busyControllerText,
    /function\s+isBusyPrefix/,
    "console-busy-controller.ts must own busy prefix projection",
  );
  assert.match(
    busyControllerText,
    /const\s+busyKey\s*=\s*computed/,
    "console-busy-controller.ts must own string-compatible busy projection",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+_?busyKeys\s*=\s*ref|function\s+isBusy\s*\(|function\s+isBusyPrefix\s*\(|function\s+setBusy\s*\(|function\s+clearBusy\s*\(|const\s+busyKey\s*=\s*computed|function\s+clearAllBusy\s*\(/,
    "useConsole.ts must delegate global busy state to console-busy-controller.ts",
  );
  assert.doesNotMatch(
    productionHealthText,
    /from\s+["']\.\/bridge["']/,
    "production-health.ts must depend on its domain client, not the global bridge facade",
  );
  assert.match(
    productionHealthClientText,
    /\/api\/production\/health/,
    "production-health-client.ts must own the production health endpoint",
  );
  assert.match(
    opsMonitorClientText,
    /\/api\/system\/background-processes/,
    "ops-monitor-client.ts must own background process endpoints",
  );
  assert.match(
    opsMonitorClientText,
    /\/api\/client-runtime\/status/,
    "ops-monitor-client.ts must own client runtime status endpoints",
  );
  assert.match(
    opsMonitorClientText,
    /\/api\/system\/monitor-alerts/,
    "ops-monitor-client.ts must own monitor alert endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/ops-monitor-client["']/,
    "bridge.ts compatibility facade must re-export ops monitor behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/system\/(?:background-processes|monitor-alerts)|\/api\/client-runtime\/status/,
    "bridge.ts must not own ops monitor endpoints",
  );
  assert.doesNotMatch(
    opsMonitorControllerText,
    /from\s+["']\.\.\/lib\/bridge["']/,
    "console-ops-monitor-controller.ts must depend on ops-monitor-client.ts, not the global bridge facade",
  );
  assert.doesNotMatch(
    opsMonitorControllerText,
    /\bbridge\s*\.\s*(getBackgroundProcesses|getClientRuntimeStatus|getMonitorAlerts|saveMonitorAlertConfig|acknowledgeMonitorAlert)\b/,
    "console-ops-monitor-controller.ts must not call ops monitor APIs through bridge",
  );
  assert.ok(
    dashboardAlertControllerText.trimEnd().split(/\r?\n/).length <= 90,
    "console-dashboard-alert-controller.ts must stay a thin facade after configuration-alert and inbox extraction",
  );
  assert.match(
    dashboardAlertControllerText,
    /createConsoleDashboardConfigurationAlertController[\s\S]*createConsoleDashboardAlertInboxController/,
    "console-dashboard-alert-controller.ts must compose the focused dashboard alert subcontrollers",
  );
  assert.doesNotMatch(
    dashboardAlertControllerText,
    /\bref\s*\(|\bcomputed\s*\(|\bintelligentModuleDefinitions\b|\bmonitorAlertSeverityLabel\b|\bdashboardAlertInbox\s*=\s*ref|\bagentSelectionAlert\b|\bshouldDropResolvedDashboardAlert\b|\bdismissedDashboardAlertIds\s*=\s*ref/,
    "console-dashboard-alert-controller.ts must not own dashboard alert projection or inbox state",
  );
  assert.ok(
    dashboardConfigurationAlertControllerText.trimEnd().split(/\r?\n/).length <= 200,
    "console-dashboard-configuration-alert-controller.ts must stay below the focused configuration-alert threshold",
  );
  assert.match(
    dashboardConfigurationAlertControllerText,
    /intelligentModuleDefinitions[\s\S]*agentSelectionAlert[\s\S]*agentConfigurationAlerts[\s\S]*agentConfigurationAlertSummary/,
    "console-dashboard-configuration-alert-controller.ts must own missing-agent configuration alert projection",
  );
  assert.doesNotMatch(
    dashboardConfigurationAlertControllerText,
    /\bmonitorAlertSeverityLabel\b|\bdashboardAlertInbox\b|\bdismissDashboardAlert\b|\backnowledgeMonitorAlert\b|\brefreshMonitorAlerts\b/,
    "console-dashboard-configuration-alert-controller.ts must not own monitor alert inbox behavior",
  );
  assert.ok(
    dashboardAlertInboxControllerText.trimEnd().split(/\r?\n/).length <= 240,
    "console-dashboard-alert-inbox-controller.ts must stay below the focused dashboard inbox threshold",
  );
  assert.match(
    dashboardAlertInboxControllerText,
    /monitorAlertSeverityLabel[\s\S]*dashboardAlertInbox[\s\S]*syncDashboardAlertInbox[\s\S]*dismissDashboardAlert/,
    "console-dashboard-alert-inbox-controller.ts must own monitor alert projection, inbox lifecycle, and dismissal",
  );
  assert.doesNotMatch(
    dashboardAlertInboxControllerText,
    /\bintelligentModuleDefinitions\b|\bagentSelectionAlert\b|\bmoduleNeedsIntelligence\b|\bmoduleModelRef\b|\bvisibleModelEntries\b/,
    "console-dashboard-alert-inbox-controller.ts must not own missing-agent configuration alert rules",
  );
  assert.match(
    contextCompilerClientText,
    /\/api\/context\/profiles/,
    "context-compiler-client.ts must own context profile endpoints",
  );
  assert.match(
    contextCompilerClientText,
    /\/api\/context\/preview/,
    "context-compiler-client.ts must own context preview endpoints",
  );
  assert.match(
    contextCompilerClientText,
    /\/api\/context\/build-records/,
    "context-compiler-client.ts must own context build record endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/context-compiler-client["']/,
    "bridge.ts compatibility facade must re-export context compiler behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/context\/(?:profiles|preview|build-records|evaluation\/runs)/,
    "bridge.ts must not own context compiler endpoints",
  );
  assert.doesNotMatch(
    contextCompilerControllerText,
    /from\s+["']\.\.\/lib\/bridge["']/,
    "console-context-compiler-controller.ts must depend on context-compiler-client.ts, not the global bridge facade",
  );
  assert.doesNotMatch(
    contextCompilerControllerText,
    /\bbridge\s*\.\s*(getContextProfiles|previewContextPack|listContextBuildRecords|runContextEvaluation)\b/,
    "console-context-compiler-controller.ts must not call context compiler APIs through bridge",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/production-health-client["']/,
    "bridge.ts compatibility facade must re-export production health behavior from the domain client",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/agent-settings-client["']/,
    "bridge.ts compatibility facade must delegate settings/model probe APIs to agent-settings-client.ts",
  );
  assert.match(
    agentSettingsClientText,
    /\/api\/settings/,
    "agent-settings-client.ts must own settings endpoints",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/settings(?:\/model-probe)?/,
    "bridge.ts must not own settings/model-probe endpoints",
  );
  assert.match(
    runtimeMountsClientText,
    /\/api\/runtime\/mounts/,
    "runtime-mounts-client.ts must own runtime mount endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/runtime-mounts-client["']/,
    "bridge.ts compatibility facade must re-export runtime mount behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/runtime\/mounts/,
    "bridge.ts must not own runtime mount endpoints",
  );
  assert.match(
    settingsBridgeControllerText,
    /function\s+bindSettingsDraftActions/,
    "console-settings-bridge-controller.ts must own settings draft delayed binding",
  );
  assert.match(
    settingsBridgeControllerText,
    /function\s+bindSettingsPersistenceActions/,
    "console-settings-bridge-controller.ts must own settings persistence delayed binding",
  );
  assert.match(
    settingsBridgeControllerText,
    /function\s+applyRemoteConsoleDraftUpdate/,
    "console-settings-bridge-controller.ts must own remote console draft update gating",
  );
  assert.match(
    settingsBridgeControllerText,
    /async\s+function\s+saveModelLibrarySettings/,
    "console-settings-bridge-controller.ts must own settings persistence compatibility wrappers",
  );
  assert.doesNotMatch(
    useConsoleText,
    /let\s+(?:settingsDraftActions|settingsPersistenceActions|applyingRemoteConsoleDrafts)\b|function\s+(?:settingsDraftController|settingsPersistenceController|applyRemoteConsoleDraftUpdate|saveModuleSettings|saveMountModules|reloadModules|enableMountModule|disableMountModule|saveSettings|saveModelLibrarySettings|saveAgentPermissionSettings)\b/,
    "useConsole.ts must delegate settings controller binding, remote draft gating, and persistence compatibility wrappers to console-settings-bridge-controller.ts",
  );
  [
    ["console-settings-persistence-controller.ts", settingsPersistenceControllerText],
    ["console-model-probe-controller.ts", modelProbeControllerText],
    ["console-model-repository-controller.ts", modelRepositoryControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on settings/runtime domain clients, not the global bridge facade`,
    );
  });
  assert.doesNotMatch(
    settingsPersistenceControllerText,
    /\bbridge\s*\.\s*(saveSettings|saveRuntimeMounts|reloadRuntimeMounts)\b/,
    "console-settings-persistence-controller.ts must not call settings or runtime mount APIs through bridge",
  );
  assert.doesNotMatch(
    modelProbeControllerText,
    /\bbridge\s*\.\s*probeModel\b/,
    "console-model-probe-controller.ts must not call model probe APIs through bridge",
  );
  assert.match(
    modelProbeControllerText,
    /async\s+function\s+probeModelProvider/,
    "console-model-probe-controller.ts must own provider-level model probe side effects",
  );
  assert.doesNotMatch(
    modelRepositoryControllerText,
    /\bbridge\s*\.\s*saveSettings\b/,
    "console-model-repository-controller.ts must not call settings APIs through bridge",
  );
  assert.match(
    modelLibraryControllerText,
    /function\s+exportAgentModelEntryConfig/,
    "console-model-library-controller.ts must own model entry config export",
  );
  assert.match(
    modelUtilsText,
    /function\s+normalizeAgentModelEntry/,
    "console-model-utils.ts must own model-entry normalization details",
  );
  assert.match(
    modelUtilsText,
    /function\s+modelProviderLabel/,
    "console-model-utils.ts must own shared model provider labels",
  );
  assert.match(
    modelLibraryControllerText,
    /const\s+providerLabel\s*=\s*modelProviderLabel/,
    "console-model-library-controller.ts must reuse shared model provider labels",
  );
  assert.ok(
    modelLibraryControllerText.trimEnd().split(/\r?\n/).length <= 380,
    "console-model-library-controller.ts must stay below the composition-boundary threshold after binding extraction",
  );
  assert.ok(
    modelEntryBindingControllerText.trimEnd().split(/\r?\n/).length <= 180,
    "console-model-entry-binding-controller.ts must stay a focused cross-feature binding boundary",
  );
  assert.match(
    modelLibraryControllerText,
    /createConsoleModelEntryBindingController/,
    "console-model-library-controller.ts must delegate cross-feature model binding scans",
  );
  assert.doesNotMatch(
    modelLibraryControllerText,
    /intelligentModuleDefinitions|function\s+(?:addModelEntryBinding|collectModelEntryBindings|modelEntryBindings|modelEntryIsBound|modelEntryBindingSummary)\b|const\s+modelEntryBindingsByKey\s*=\s*computed/,
    "console-model-library-controller.ts must not re-own cross-feature model binding scans",
  );
  assert.match(
    modelEntryBindingControllerText,
    /info-feed:form[\s\S]*knowledge-review:fusion[\s\S]*module-profile/,
    "console-model-entry-binding-controller.ts must own feed, knowledge-review, and module-profile binding detection",
  );
  assert.doesNotMatch(
    modelEntryBindingControllerText,
    /downloadTextFile|probeModel|saveSettings|modelLibraryExpandedCards/,
    "console-model-entry-binding-controller.ts must not own export, probe, persistence, or card expansion side effects",
  );
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["']\.\.\/lib\/agent-settings-client["']|async\s+function\s+probeModel\s*\(|function\s+exportAgentModelEntryConfig\s*\(|\bbridge\s*\.\s*probeModel\b/,
    "useConsole.ts must delegate model probe/export side effects to model controllers",
  );
  assert.doesNotMatch(
    useConsoleText,
    /function\s+normalizeModelEntry\s*\(|const\s+provider\s*=\s*String\(entry\.provider|modelEntryStringField\(entry|modelAgentUid\(provider|normalizeAgentModuleAccess\(entry\.moduleAccess/,
    "useConsole.ts must delegate model-entry normalization internals to console-model-utils.ts",
  );
  assert.ok(
    agentModelOptionBarText.trimEnd().split(/\r?\n/).length <= 95,
    "AgentModelOptionBar.vue must stay a small option-bar render boundary",
  );
  assert.match(
    agentModelOptionBarText,
    /(?=[\s\S]*useAgentModelOptionBarController)(?=[\s\S]*EMPTY_MODEL_LIBRARY_ACTION)(?=[\s\S]*agent-option-shell)(?=[\s\S]*style scoped src="\.\/agent-model-option-bar\/AgentModelOptionBar\.css")/,
    "AgentModelOptionBar.vue must compose the option-bar controller and external scoped style slice",
  );
  assert.doesNotMatch(
    agentModelOptionBarText,
    /function\s+(?:normalizedValue|optionDisabled|normalizedLabel|navigateToModelLibrary|handleChange|handleSelectClick|handleSelectKeydown)\b|navigateBrowserHashRoute|<style scoped>\s*\.agent-option/s,
    "AgentModelOptionBar.vue must not own option normalization, empty-library navigation, event handlers, or inline styles",
  );
  assert.ok(
    agentModelOptionBarControllerText.trimEnd().split(/\r?\n/).length <= 150,
    "agentModelOptionBarController.ts must stay a focused option-bar controller",
  );
  assert.match(
    agentModelOptionBarControllerText,
    /AgentModelOptionBarProps[\s\S]*EMPTY_MODEL_LIBRARY_ACTION[\s\S]*normalizedValue[\s\S]*optionDisabled[\s\S]*navigateBrowserHashRoute[\s\S]*handleSelectKeydown/,
    "agentModelOptionBarController.ts must own option normalization, empty-library routing, and select event handlers",
  );
  assert.doesNotMatch(
    agentModelOptionBarControllerText,
    /<template>|class="agent-option|\.agent-option/,
    "agentModelOptionBarController.ts must not own rendered option-bar markup or styles",
  );
  assert.ok(
    agentModelOptionBarStyleText.trimEnd().split(/\r?\n/).length <= 120,
    "AgentModelOptionBar.css must stay a focused option-bar style slice",
  );
  assert.match(
    agentModelOptionBarStyleText,
    /\.agent-option-bar[\s\S]*\.agent-option-shell[\s\S]*\.agent-option-select[\s\S]*\.agent-option-empty-action[\s\S]*\.agent-option-chevron/,
    "AgentModelOptionBar.css must own the agent option-bar selector family",
  );
  assert.doesNotMatch(
    agentModelOptionBarStyleText,
    /<script|<template|defineProps|navigateBrowserHashRoute|EMPTY_MODEL_LIBRARY_ACTION/,
    "AgentModelOptionBar.css must not own scripted option-bar behavior",
  );
  assert.ok(
    agentConfigViewText.trimEnd().split(/\r?\n/).length <= 40,
    "AgentConfigView.vue must stay a small route composition boundary",
  );
  assert.match(
    agentConfigViewText,
    /AgentModelLibraryPanel[\s\S]*AgentInvocationSettingsPanel/,
    "AgentConfigView.vue must compose the model-library and invocation settings panels",
  );
  assert.doesNotMatch(
    agentConfigViewText,
    /useServerConsoleShellContext|JsonConfigFileEditor|v-for="entry in visibleModelEntries"|settingsDraft\.agentToolExecution|saveLocalCommandTemplates|saveFunctionCallSchema/,
    "AgentConfigView.vue must not own shell context, model-entry rendering, or invocation settings save logic directly",
  );
  assert.ok(
    agentModelLibraryPanelText.trimEnd().split(/\r?\n/).length <= 90,
    "AgentModelLibraryPanel.vue must stay focused on model-library toolbar, list, and save orchestration",
  );
  assert.match(
    agentModelLibraryPanelText,
    /addModelProvider[\s\S]*saveModelLibrarySettings[\s\S]*visibleModelEntries[\s\S]*AgentModelEntryCard/,
    "AgentModelLibraryPanel.vue must own the model-library toolbar/list/save shell",
  );
  assert.doesNotMatch(
    agentModelLibraryPanelText,
    /entry\.provider|beginCodexOAuthLogin|agentToolExecution|JsonConfigFileEditor|modelEntryBindings/,
    "AgentModelLibraryPanel.vue must not own provider-specific entry fields, invocation settings, or binding details",
  );
  assert.ok(
    agentModelEntryCardText.trimEnd().split(/\r?\n/).length <= 90,
    "AgentModelEntryCard.vue must stay a small model-entry composition boundary",
  );
  assert.match(
    agentModelEntryCardText,
    /provideAgentModelEntryCardContext[\s\S]*AgentModelEntryHeader[\s\S]*AgentModelEntrySummaryActions[\s\S]*AgentModelProviderFields[\s\S]*AgentModelAccessPanel[\s\S]*AgentModelBindingsPanel[\s\S]*AgentModelPromptPanel/,
    "AgentModelEntryCard.vue must compose the focused model-entry subpanels through a local context",
  );
  assert.doesNotMatch(
    agentModelEntryCardText,
    /visibleModelEntries|saveModelLibrarySettings|agentToolExecution|JsonConfigFileEditor|entry\.provider|modelEntryBindings|modelEntryModuleAccess|probeModelEntry|removeModelProvider/,
    "AgentModelEntryCard.vue must not own model-list save orchestration, provider fields, actions, module access, bindings, or invocation settings",
  );
  assert.ok(
    agentModelEntryCardContextText.trimEnd().split(/\r?\n/).length <= 90,
    "agentModelEntryCardContext.ts must stay a small local model-entry context boundary",
  );
  assert.match(
    agentModelEntryCardContextText,
    /AgentModelEntryCardContext[\s\S]*createAgentModelEntryCardContext[\s\S]*provideAgentModelEntryCardContext[\s\S]*useAgentModelEntryCardContext/,
    "agentModelEntryCardContext.ts must own the focused provide/inject bridge for model-entry panels",
  );
  assert.doesNotMatch(
    agentModelEntryCardContextText,
    /<template>|defineProps|entry\.provider|modelProbeResults\.value/,
    "agentModelEntryCardContext.ts must not own rendered model-entry behavior",
  );
  assert.ok(
    agentModelEntryHeaderText.trimEnd().split(/\r?\n/).length <= 75,
    "AgentModelEntryHeader.vue must stay focused on entry title, status, and expand/collapse",
  );
  assert.match(
    agentModelEntryHeaderText,
    /(?=[\s\S]*modelEntryStatusKey)(?=[\s\S]*modelProviderDefinition)(?=[\s\S]*modelEntryIsBound)(?=[\s\S]*modelEntryProbeResult)(?=[\s\S]*toggleModelLibraryCard)/,
    "AgentModelEntryHeader.vue must own entry heading, status pills, and card toggle rendering",
  );
  assert.doesNotMatch(
    agentModelEntryHeaderText,
    /google-gemini|openai-chatgpt|settingsDraft|probeModelEntry|removeModelProvider|modelEntryModuleAccess|modelEntryBindings|parametersText/,
    "AgentModelEntryHeader.vue must not own provider fields, actions, module access, bindings, or prompts",
  );
  assert.ok(
    agentModelEntrySummaryActionsText.trimEnd().split(/\r?\n/).length <= 85,
    "AgentModelEntrySummaryActions.vue must stay focused on per-entry actions and probe result rendering",
  );
  assert.match(
    agentModelEntrySummaryActionsText,
    /(?=[\s\S]*probeModelEntry)(?=[\s\S]*exportAgentModelEntryConfig)(?=[\s\S]*duplicateModelEntry)(?=[\s\S]*removeModelProvider)(?=[\s\S]*modelProbeResults)/,
    "AgentModelEntrySummaryActions.vue must own probe/export/duplicate/remove controls and probe result presentation",
  );
  assert.doesNotMatch(
    agentModelEntrySummaryActionsText,
    /entry\.provider|settingsDraft|modelEntryModuleAccess|modelEntryBindings|parametersText/,
    "AgentModelEntrySummaryActions.vue must not own provider fields, module access, bindings, or prompts",
  );
  assert.ok(
    agentModelProviderFieldsText.trimEnd().split(/\r?\n/).length <= 125,
    "AgentModelProviderFields.vue must stay focused on provider-specific connection fields",
  );
  assert.match(
    agentModelProviderFieldsText,
    /google-gemini[\s\S]*openai-chatgpt[\s\S]*openrouter[\s\S]*deepseek[\s\S]*copilot[\s\S]*local-model[\s\S]*custom-http/,
    "AgentModelProviderFields.vue must own provider-specific connection form rendering",
  );
  assert.doesNotMatch(
    agentModelProviderFieldsText,
    /modelEntryModuleAccess|modelEntryBindings|probeModelEntry|removeModelProvider|parametersText/,
    "AgentModelProviderFields.vue must not own module access, bindings, actions, or prompts",
  );
  assert.ok(
    agentModelAccessPanelText.trimEnd().split(/\r?\n/).length <= 70,
    "AgentModelAccessPanel.vue must stay focused on model-entry permission and module access",
  );
  assert.match(
    agentModelAccessPanelText,
    /(?=[\s\S]*setModelEntryPermissionGroup)(?=[\s\S]*modelEntryModuleAccess)(?=[\s\S]*setModelEntryModuleAccessMode)(?=[\s\S]*toggleModelEntryModuleAccess)/,
    "AgentModelAccessPanel.vue must own permission group and module-access controls",
  );
  assert.doesNotMatch(
    agentModelAccessPanelText,
    /entry\.provider|modelEntryBindings|probeModelEntry|removeModelProvider|parametersText/,
    "AgentModelAccessPanel.vue must not own provider fields, bindings, actions, or prompts",
  );
  assert.ok(
    agentModelBindingsPanelText.trimEnd().split(/\r?\n/).length <= 50,
    "AgentModelBindingsPanel.vue must stay focused on model-entry binding details",
  );
  assert.match(
    agentModelBindingsPanelText,
    /(?=[\s\S]*modelEntryIsBound)(?=[\s\S]*modelEntryBindings)(?=[\s\S]*binding\.detail)/,
    "AgentModelBindingsPanel.vue must own model-entry binding list rendering",
  );
  assert.doesNotMatch(
    agentModelBindingsPanelText,
    /entry\.provider|modelEntryModuleAccess|probeModelEntry|removeModelProvider|parametersText/,
    "AgentModelBindingsPanel.vue must not own provider fields, module access, actions, or prompts",
  );
  assert.ok(
    agentModelPromptPanelText.trimEnd().split(/\r?\n/).length <= 35,
    "AgentModelPromptPanel.vue must stay focused on prompt and parameters editing",
  );
  assert.match(
    agentModelPromptPanelText,
    /systemPrompt[\s\S]*parametersText/,
    "AgentModelPromptPanel.vue must own prompt and parameter textarea rendering",
  );
  assert.doesNotMatch(
    agentModelPromptPanelText,
    /entry\.provider|modelEntryModuleAccess|modelEntryBindings|probeModelEntry|removeModelProvider/,
    "AgentModelPromptPanel.vue must not own provider fields, module access, bindings, or actions",
  );
  assert.ok(
    agentInvocationSettingsPanelText.trimEnd().split(/\r?\n/).length <= 130,
    "AgentInvocationSettingsPanel.vue must stay focused on invocation settings",
  );
  assert.match(
    agentInvocationSettingsPanelText,
    /saveLocalCommandTemplates[\s\S]*saveFunctionCallSchema[\s\S]*agentToolExecution\.http[\s\S]*agentToolExecution\.local[\s\S]*JsonConfigFileEditor/,
    "AgentInvocationSettingsPanel.vue must own invocation toggles and JSON editor save validation",
  );
  assert.doesNotMatch(
    agentInvocationSettingsPanelText,
    /visibleModelEntries|modelEntryStatusKey|probeModelEntry|modelEntryBindings|saveModelLibrarySettings/,
    "AgentInvocationSettingsPanel.vue must not own model-library entry rendering or save orchestration",
  );
  assert.ok(
    agentConfigInvocationToggleText.trimEnd().split(/\r?\n/).length <= 45,
    "AgentConfigInvocationToggle.vue must stay a small binary-toggle wrapper",
  );
  assert.ok(
    agentPermissionsViewText.trimEnd().split(/\r?\n/).length <= 50,
    "AgentPermissionsView.vue must stay a small route composition boundary",
  );
  assert.match(
    agentPermissionsViewText,
    /AuthorizationGovernanceCard[\s\S]*AgentPermissionGroupsPanel[\s\S]*ToolGrantCreateCard[\s\S]*ToolGrantListCard[\s\S]*GrantToolRulePanel[\s\S]*ToolPolicyPreviewPanel/,
    "AgentPermissionsView.vue must compose the governance, group, grant, rule, and policy-preview panels",
  );
  assert.doesNotMatch(
    agentPermissionsViewText,
    /ConfigFoldCard|FeatureToggle|OptionBar|ScopeSelector|settingsDraft\.agentPermissionGroups|toolGrants|createGrant|previewToolPolicy|selectedToolManagementTool/,
    "AgentPermissionsView.vue must not own permission-group, grant, tool-rule, or policy-preview rendering directly",
  );
  assert.ok(
    authorizationGovernanceCardText.trimEnd().split(/\r?\n/).length <= 50,
    "AuthorizationGovernanceCard.vue must stay a small governance card composition boundary",
  );
  assert.match(
    authorizationGovernanceCardText,
    /createAuthorizationGovernanceCardContext[\s\S]*provideAuthorizationGovernanceCardContext[\s\S]*AuthorizationGovernanceMetrics[\s\S]*AuthorizationGovernanceEditor[\s\S]*AuthorizationGovernanceGrid/,
    "AuthorizationGovernanceCard.vue must compose metrics, editor, and grid through a local governance context",
  );
  assert.doesNotMatch(
    authorizationGovernanceCardText,
    /v-for="role|v-for="team|v-for="policy|v-for="binding|v-for="group|v-for="approval|textarea|select v-model|authorization-governance-panel|governance-row|<style/,
    "AuthorizationGovernanceCard.vue must not own governance list rows, editor fields, panel markup, or local styles",
  );
  assert.ok(
    authorizationGovernanceCardContextText.trimEnd().split(/\r?\n/).length <= 65,
    "authorizationGovernanceCardContext.ts must stay a focused local governance context boundary",
  );
  assert.match(
    authorizationGovernanceCardContextText,
    /AuthorizationGovernanceCardContext[\s\S]*createAuthorizationGovernanceCardContext[\s\S]*provideAuthorizationGovernanceCardContext[\s\S]*useAuthorizationGovernanceCardContext/,
    "authorizationGovernanceCardContext.ts must own the governance card provide/inject bridge",
  );
  assert.doesNotMatch(
    authorizationGovernanceCardContextText,
    /<template>|defineProps|v-for|textarea|authorization-governance-panel/,
    "authorizationGovernanceCardContext.ts must not own rendered governance behavior",
  );
  assert.ok(
    authorizationGovernanceMetricsText.trimEnd().split(/\r?\n/).length <= 25,
    "AuthorizationGovernanceMetrics.vue must stay focused on governance metric rendering",
  );
  assert.match(
    authorizationGovernanceMetricsText,
    /authorizationGovernanceMetrics[\s\S]*metric\.label[\s\S]*metric\.value/,
    "AuthorizationGovernanceMetrics.vue must own governance metric rendering",
  );
  assert.doesNotMatch(
    authorizationGovernanceMetricsText,
    /authorizationGovernanceEditor|createAuthorizationGovernancePanels|governance-row|textarea/,
    "AuthorizationGovernanceMetrics.vue must not own editor fields or governance row projection",
  );
  assert.ok(
    authorizationGovernanceEditorText.trimEnd().split(/\r?\n/).length <= 60,
    "AuthorizationGovernanceEditor.vue must stay focused on governance editor controls",
  );
  assert.match(
    authorizationGovernanceEditorText,
    /authorizationGovernanceEditorKind[\s\S]*authorizationGovernanceEditorBody[\s\S]*resetAuthorizationGovernanceEditor[\s\S]*saveAuthorizationGovernanceEditor/,
    "AuthorizationGovernanceEditor.vue must own governance editor kind/body/reset/save controls",
  );
  assert.doesNotMatch(
    authorizationGovernanceEditorText,
    /authorizationGovernanceMetrics|createAuthorizationGovernancePanels|governance-row|v-for="row/,
    "AuthorizationGovernanceEditor.vue must not own metrics or governance list projection",
  );
  assert.ok(
    authorizationGovernanceGridText.trimEnd().split(/\r?\n/).length <= 45,
    "AuthorizationGovernanceGrid.vue must stay focused on panel projection composition",
  );
  assert.match(
    authorizationGovernanceGridText,
    /createAuthorizationGovernancePanels[\s\S]*AuthorizationGovernancePanel[\s\S]*v-for="panel/,
    "AuthorizationGovernanceGrid.vue must compose projected governance panels",
  );
  assert.doesNotMatch(
    authorizationGovernanceGridText,
    /textarea|authorizationGovernanceEditor|governance-row|metric\.value/,
    "AuthorizationGovernanceGrid.vue must not own editor fields, row markup, or metrics",
  );
  assert.ok(
    authorizationGovernancePanelText.trimEnd().split(/\r?\n/).length <= 35,
    "AuthorizationGovernancePanel.vue must stay focused on one projected governance panel",
  );
  assert.match(
    authorizationGovernancePanelText,
    /panel\.title[\s\S]*panel\.count[\s\S]*v-for="row[\s\S]*row\.detail[\s\S]*row\.meta/,
    "AuthorizationGovernancePanel.vue must own generic projected governance row rendering",
  );
  assert.doesNotMatch(
    authorizationGovernancePanelText,
    /authorizationGovernanceEditor|authorizationGovernanceMetrics|createAuthorizationGovernancePanels|roleId|teamId|agentId/,
    "AuthorizationGovernancePanel.vue must not own editor fields, metrics, or domain-specific row projection",
  );
  assert.ok(
    authorizationGovernancePanelRowsText.trimEnd().split(/\r?\n/).length <= 105,
    "authorization-governance-panel-rows.ts must stay focused on governance panel row projection",
  );
  assert.match(
    authorizationGovernancePanelRowsText,
    /createAuthorizationGovernancePanels[\s\S]*角色[\s\S]*团队[\s\S]*用户策略[\s\S]*智能体[\s\S]*智能体分组[\s\S]*审批/,
    "authorization-governance-panel-rows.ts must own the six governance panel row projections",
  );
  assert.doesNotMatch(
    authorizationGovernancePanelRowsText,
    /<template>|useAuthorizationGovernanceCardContext|textarea|source-actions|authorization-governance-editor/,
    "authorization-governance-panel-rows.ts must not own rendered editor or context behavior",
  );
  assert.ok(
    authorizationGovernanceCardStyleText.trimEnd().split(/\r?\n/).length <= 140,
    "AuthorizationGovernanceCard.css must stay a focused governance-card style slice",
  );
  assert.match(
    authorizationGovernanceCardStyleText,
    /\.authorization-governance-card[\s\S]*\.authorization-governance-editor[\s\S]*\.authorization-governance-panel[\s\S]*\.governance-row/,
    "AuthorizationGovernanceCard.css must own the authorization-governance selector family",
  );
  assert.doesNotMatch(
    authorizationGovernanceCardStyleText,
    /<script|<template|useAuthorizationGovernanceCardContext/,
    "AuthorizationGovernanceCard.css must not own rendered or scripted behavior",
  );
  assert.ok(
    storageViewText.trimEnd().split(/\r?\n/).length <= 35,
    "StorageView.vue must stay a small route composition boundary",
  );
  assert.match(
    storageViewText,
    /useStorageViewConsole[\s\S]*provideStorageView[\s\S]*StorageOverviewCard[\s\S]*StorageRuntimeCard[\s\S]*StorageDiscoveryCard[\s\S]*StorageSessionCard/,
    "StorageView.vue must compose the storage overview, runtime, discovery, and session cards",
  );
  assert.doesNotMatch(
    storageViewText,
    /useServerConsoleShellContext|consoleState|enabledMountCount|activeJobCount|attentionClientCount|openAdmin|openDrawer|logoutConsole|metric-card|meta-list/,
    "StorageView.vue must not own shell context, storage metrics, runtime, discovery, or session rendering directly",
  );
  assert.ok(
    storageViewControllerText.trimEnd().split(/\r?\n/).length <= 50,
    "console-storage-view-controller.ts must stay a focused storage shell projection",
  );
  assert.match(
    storageViewControllerText,
    /(?=[\s\S]*useServerConsoleShellContext)(?=[\s\S]*enabledMountPercent)(?=[\s\S]*activeJobCount)(?=[\s\S]*attentionClientCount)(?=[\s\S]*openAdmin)(?=[\s\S]*openDrawer)(?=[\s\S]*logoutConsole)/,
    "console-storage-view-controller.ts must own storage view shell projection and mount percentage derivation",
  );
  assert.doesNotMatch(
    storageViewControllerText,
    /<template>|metric-card|surface-card|StorageOverviewCard/,
    "console-storage-view-controller.ts must not own rendered storage markup",
  );
  assert.ok(
    storageViewContextText.trimEnd().split(/\r?\n/).length <= 25,
    "storageViewContext.ts must stay a small provide/inject boundary",
  );
  assert.match(
    storageViewContextText,
    /StorageViewContext[\s\S]*provideStorageView[\s\S]*useStorageViewContext/,
    "storageViewContext.ts must own storage view provide/inject context",
  );
  assert.ok(
    storageOverviewCardText.trimEnd().split(/\r?\n/).length <= 115,
    "StorageOverviewCard.vue must stay focused on storage overview metrics",
  );
  assert.match(
    storageOverviewCardText,
    /(?=[\s\S]*enabledMountPercent)(?=[\s\S]*activeJobCount)(?=[\s\S]*attentionClientCount)(?=[\s\S]*rawObjectCount)(?=[\s\S]*retrievalCount)/,
    "StorageOverviewCard.vue must own storage overview, job, client, and object metrics",
  );
  assert.doesNotMatch(
    storageOverviewCardText,
    /openAdmin|openDrawer|logoutConsole|currentUser|mountGeneration|activeServiceUrl/,
    "StorageOverviewCard.vue must not own runtime navigation, discovery editing, or session logout",
  );
  assert.ok(
    storageRuntimeCardText.trimEnd().split(/\r?\n/).length <= 55,
    "StorageRuntimeCard.vue must stay focused on runtime mount status",
  );
  assert.match(
    storageRuntimeCardText,
    /(?=[\s\S]*openAdmin\('modules'\))(?=[\s\S]*runtime\?\.profile)(?=[\s\S]*mountGeneration)(?=[\s\S]*enabledMountCount)/,
    "StorageRuntimeCard.vue must own runtime status and module navigation",
  );
  assert.doesNotMatch(
    storageRuntimeCardText,
    /rawObjectCount|activeServiceUrl|currentUser|logoutConsole/,
    "StorageRuntimeCard.vue must not own storage object metrics, discovery fields, or session logout",
  );
  assert.ok(
    storageDiscoveryCardText.trimEnd().split(/\r?\n/).length <= 60,
    "StorageDiscoveryCard.vue must stay focused on discovery network state",
  );
  assert.match(
    storageDiscoveryCardText,
    /(?=[\s\S]*openDrawer\('discovery'\))(?=[\s\S]*serverId)(?=[\s\S]*advertisedBaseUrl)(?=[\s\S]*activeServiceUrl)(?=[\s\S]*configVersion)/,
    "StorageDiscoveryCard.vue must own discovery editing link and network metadata",
  );
  assert.doesNotMatch(
    storageDiscoveryCardText,
    /rawObjectCount|mountGeneration|currentUser|logoutConsole/,
    "StorageDiscoveryCard.vue must not own storage object metrics, runtime state, or session logout",
  );
  assert.ok(
    storageSessionCardText.trimEnd().split(/\r?\n/).length <= 50,
    "StorageSessionCard.vue must stay focused on current session display and logout",
  );
  assert.match(
    storageSessionCardText,
    /currentUser[\s\S]*displayName[\s\S]*roleLabel[\s\S]*logoutConsole/,
    "StorageSessionCard.vue must own current session display and logout action",
  );
  assert.doesNotMatch(
    storageSessionCardText,
    /consoleState|openAdmin|openDrawer|rawObjectCount|mountGeneration/,
    "StorageSessionCard.vue must not own storage metrics, runtime, or discovery state",
  );
  assert.ok(
    agentPermissionGroupsPanelText.trimEnd().split(/\r?\n/).length <= 130,
    "AgentPermissionGroupsPanel.vue must stay focused on permission-group summary and list orchestration",
  );
  assert.match(
    agentPermissionGroupsPanelText,
    /ensureAgentPermissionGroupsDraft[\s\S]*addAgentPermissionGroup[\s\S]*saveAgentPermissionSettings[\s\S]*AgentPermissionGroupCard/,
    "AgentPermissionGroupsPanel.vue must own the permission-group toolbar, metrics, and group-card list",
  );
  assert.doesNotMatch(
    agentPermissionGroupsPanelText,
    /createGrant|toolGrants|policyPreview|selectedToolManagementTool|setGrantToolRule/,
    "AgentPermissionGroupsPanel.vue must not own grant creation, grant lists, tool-rule editing, or policy previews",
  );
  assert.ok(
    agentPermissionGroupCardText.trimEnd().split(/\r?\n/).length <= 310,
    "AgentPermissionGroupCard.vue must stay a focused permission-group editor",
  );
  assert.match(
    agentPermissionGroupCardText,
    /ScopeSelector[\s\S]*togglePermissionGroupToolset[\s\S]*availableExceptionTools[\s\S]*addToolException[\s\S]*setPermissionGroupToolRule/,
    "AgentPermissionGroupCard.vue must own per-group scope, toolset, and tool-rule editing",
  );
  assert.doesNotMatch(
    agentPermissionGroupCardText,
    /settingsDraft\.agentPermissionGroups|createGrant|toolGrants|policyPreview|selectedToolManagementTool/,
    "AgentPermissionGroupCard.vue must not own group-list orchestration, grant workflows, or policy previews",
  );
  assert.ok(
    toolGrantCreateCardText.trimEnd().split(/\r?\n/).length <= 100,
    "ToolGrantCreateCard.vue must stay focused on grant creation",
  );
  assert.match(
    toolGrantCreateCardText,
    /createGrant[\s\S]*newGrantLabel[\s\S]*newGrantScopes[\s\S]*newGrantToolsets[\s\S]*issuedToolToken/,
    "ToolGrantCreateCard.vue must own the grant create form and one-time token panel",
  );
  assert.doesNotMatch(
    toolGrantCreateCardText,
    /toolGrants|updateGrant|rotateGrant|deleteGrant|policyPreview|settingsDraft\.agentPermissionGroups|selectedToolManagementTool/,
    "ToolGrantCreateCard.vue must not own grant lists, policy previews, group drafts, or tool-rule editing",
  );
  assert.ok(
    toolGrantListCardText.trimEnd().split(/\r?\n/).length <= 160,
    "ToolGrantListCard.vue must stay focused on existing grant list management",
  );
  assert.match(
    toolGrantListCardText,
    /enabledToolGrantCount[\s\S]*toolGrants[\s\S]*updateGrant[\s\S]*rotateGrant[\s\S]*deleteGrant/,
    "ToolGrantListCard.vue must own existing grant list status and grant-level actions",
  );
  assert.doesNotMatch(
    toolGrantListCardText,
    /createGrant|newGrantLabel|policyPreview|settingsDraft\.agentPermissionGroups|selectedToolManagementTool|setGrantToolRule/,
    "ToolGrantListCard.vue must not own grant creation, policy previews, permission groups, or selected-tool rule editing",
  );
  assert.ok(
    grantToolRulePanelText.trimEnd().split(/\r?\n/).length <= 240,
    "GrantToolRulePanel.vue must stay focused on selected-tool grant rule editing",
  );
  assert.match(
    grantToolRulePanelText,
    /selectedGrant[\s\S]*selectedToolId[\s\S]*addGrantToolRule[\s\S]*setGrantToolRule/,
    "GrantToolRulePanel.vue must own selected-tool grant rule editing",
  );
  assert.doesNotMatch(
    grantToolRulePanelText,
    /createGrant|newGrantLabel|policyPreview|settingsDraft\.agentPermissionGroups|permissionGroupToolRuleState/,
    "GrantToolRulePanel.vue must not own grant creation, policy previews, group drafts, or permission-group tool rules",
  );
  assert.ok(
    toolPolicyPreviewPanelText.trimEnd().split(/\r?\n/).length <= 70,
    "ToolPolicyPreviewPanel.vue must stay focused on policy preview controls and result rendering",
  );
  assert.match(
    toolPolicyPreviewPanelText,
    /policyPreviewToolId[\s\S]*policyPreviewProfileId[\s\S]*previewToolPolicy[\s\S]*policyPreviewResult/,
    "ToolPolicyPreviewPanel.vue must own policy-preview controls and result rendering",
  );
  assert.doesNotMatch(
    toolPolicyPreviewPanelText,
    /createGrant|toolGrants|updateGrant|settingsDraft\.agentPermissionGroups|selectedToolManagementTool|setGrantToolRule/,
    "ToolPolicyPreviewPanel.vue must not own grant workflows, group drafts, or selected-tool rule editing",
  );
  assert.ok(
    opsMonitorViewText.trimEnd().split(/\r?\n/).length <= 35,
    "OpsMonitorView.vue must stay a small route composition boundary",
  );
  assert.match(
    opsMonitorViewText,
    /useOpsMonitorViewConsole[\s\S]*provideOpsMonitorView[\s\S]*OpsMonitorSummaryCard[\s\S]*OpsMonitorProcessTable[\s\S]*OpsMonitorAlertsPanel/,
    "OpsMonitorView.vue must compose the ops monitor context and three focused panels",
  );
  assert.doesNotMatch(
    opsMonitorViewText,
    /useServerConsoleShellContext|StatusPill|ConfigFoldCard|clientRuntimeHeatRows|backgroundProcesses|monitorAlertConfigText|monitorAlertDetailBullets|v-for="row|v-for="alert/,
    "OpsMonitorView.vue must not own shell context, table rendering, alert rendering, or alert config editing directly",
  );
  assert.ok(
    opsMonitorViewControllerText.trimEnd().split(/\r?\n/).length <= 190,
    "console-ops-monitor-view-controller.ts must stay a focused ops monitor view boundary",
  );
  assert.match(
    opsMonitorViewControllerText,
    /useServerConsoleShellContext[\s\S]*monitorAlertRows[\s\S]*monitorAlertDetailBullets[\s\S]*monitorAlertMergeKey[\s\S]*shouldIncludeMonitorAlertLifecycle/,
    "console-ops-monitor-view-controller.ts must own the ops monitor shell projection and alert presentation helpers",
  );
  assert.doesNotMatch(
    opsMonitorViewControllerText,
    /StatusPill|ConfigFoldCard|<template>|class="job-row"/,
    "console-ops-monitor-view-controller.ts must not own rendered component markup",
  );
  assert.ok(
    opsMonitorViewContextText.trimEnd().split(/\r?\n/).length <= 25,
    "opsMonitorViewContext.ts must stay a small provide/inject boundary",
  );
  assert.ok(
    opsMonitorSummaryCardText.trimEnd().split(/\r?\n/).length <= 35,
    "OpsMonitorSummaryCard.vue must stay focused on ops monitor summary tags",
  );
  assert.match(
    opsMonitorSummaryCardText,
    /backgroundSupervisorLabel[\s\S]*backgroundRunningCount[\s\S]*monitorAlertSummary/,
    "OpsMonitorSummaryCard.vue must own the ops monitor summary header",
  );
  assert.doesNotMatch(
    opsMonitorSummaryCardText,
    /clientRuntimeHeatRows|backgroundProcessStatus|monitorAlertConfigText|saveMonitorAlertConfig/,
    "OpsMonitorSummaryCard.vue must not own runtime heatmap, process table, or alert config editing",
  );
  assert.ok(
    opsMonitorClientRuntimeCardText.trimEnd().split(/\r?\n/).length <= 95,
    "OpsMonitorClientRuntimeCard.vue must stay focused on client runtime heatmap rendering",
  );
  assert.match(
    opsMonitorClientRuntimeCardText,
    /clientRuntimeSummary[\s\S]*clientRuntimeHeatRows[\s\S]*clientRuntimeHeatStyle[\s\S]*clientRuntimeTaskText/,
    "OpsMonitorClientRuntimeCard.vue must own client runtime summary and heatmap rows",
  );
  assert.doesNotMatch(
    opsMonitorClientRuntimeCardText,
    /backgroundProcesses|monitorAlertConfigText|saveMonitorAlertConfig|acknowledgeMonitorAlert/,
    "OpsMonitorClientRuntimeCard.vue must not own process rows or alert workflows",
  );
  assert.ok(
    opsMonitorProcessTableText.trimEnd().split(/\r?\n/).length <= 80,
    "OpsMonitorProcessTable.vue must stay focused on background process rendering",
  );
  assert.match(
    opsMonitorProcessTableText,
    /backgroundProcessStatus[\s\S]*backgroundProcesses[\s\S]*processTypeLabel[\s\S]*processRelationText/,
    "OpsMonitorProcessTable.vue must own background process status rows",
  );
  assert.doesNotMatch(
    opsMonitorProcessTableText,
    /clientRuntimeHeatRows|monitorAlertConfigText|saveMonitorAlertConfig|acknowledgeMonitorAlert/,
    "OpsMonitorProcessTable.vue must not own client runtime or alert workflows",
  );
  assert.ok(
    opsMonitorAlertsPanelText.trimEnd().split(/\r?\n/).length <= 160,
    "OpsMonitorAlertsPanel.vue must stay focused on alert list and config editing",
  );
  assert.match(
    opsMonitorAlertsPanelText,
    /ConfigFoldCard[\s\S]*acknowledgeMonitorAlert[\s\S]*monitorAlertHistoryRows[\s\S]*monitorAlertSummary[\s\S]*saveMonitorAlertConfig[\s\S]*visibleMonitorAlerts/,
    "OpsMonitorAlertsPanel.vue must own alert list, acknowledgement, and config editor rendering",
  );
  assert.doesNotMatch(
    opsMonitorAlertsPanelText,
    /clientRuntimeHeatRows|backgroundProcesses|processTypeLabel|clientRuntimeHeatStyle/,
    "OpsMonitorAlertsPanel.vue must not own client runtime heatmap or process rows",
  );
  assert.ok(
    historySessionPanelText.trimEnd().split(/\r?\n/).length <= 100,
    "HistorySessionPanel.vue must stay a lightweight history/session renderer",
  );
  assert.match(
    historySessionPanelText,
    /import\s+["']\.\/HistorySessionPanel\.css["'][\s\S]*itemTitle[\s\S]*itemMeta[\s\S]*selectItem[\s\S]*runItemAction/,
    "HistorySessionPanel.vue must import its dedicated style slice and own only item projection plus emits",
  );
  assert.doesNotMatch(
    historySessionPanelText,
    /<style|box-shadow|transition:|border-color|history-session-action:hover/,
    "HistorySessionPanel.vue must not absorb the history-session CSS slice again",
  );
  assert.ok(
    historySessionPanelStyleText.trimEnd().split(/\r?\n/).length <= 230,
    "HistorySessionPanel.css must stay a focused component style slice",
  );
  assert.match(
    historySessionPanelStyleText,
    /\.history-session-panel[\s\S]*\.history-session-list[\s\S]*\.history-session-item[\s\S]*\.history-session-action/,
    "HistorySessionPanel.css must own only the history-session panel selectors",
  );
  assert.ok(
    maintenanceAgentViewText.trimEnd().split(/\r?\n/).length <= 35,
    "MaintenanceAgentView.vue must stay a small route composition boundary",
  );
  assert.match(
    maintenanceAgentViewText,
    /useMaintenanceAgentViewConsole[\s\S]*provideMaintenanceAgentView[\s\S]*MaintenanceAgentSummaryCard[\s\S]*MaintenanceAgentPolicyPanel[\s\S]*MaintenanceAgentActionGrid[\s\S]*MaintenanceAgentRunList[\s\S]*MaintenanceAgentRunDetail/,
    "MaintenanceAgentView.vue must compose the maintenance-agent context and focused panels",
  );
  assert.doesNotMatch(
    maintenanceAgentViewText,
    /useServerConsoleShellContext|AgentModelOptionBar|OptionBar|StatusPill|ConfigFoldCard|maintenanceAgentConfig|displayedMaintenanceAgentRuns|selectedMaintenanceAgentRun|v-for="run|v-for="schedule/,
    "MaintenanceAgentView.vue must not own shell context, policy forms, action forms, run tables, or run details directly",
  );
  assert.ok(
    maintenanceAgentViewControllerText.trimEnd().split(/\r?\n/).length <= 95,
    "console-maintenance-agent-view-controller.ts must stay a focused maintenance-agent view projection boundary",
  );
  assert.match(
    maintenanceAgentViewControllerText,
    /useServerConsoleShellContext[\s\S]*maintenanceAgentConfig[\s\S]*displayedMaintenanceAgentRuns[\s\S]*selectedMaintenanceAgentRun/,
    "console-maintenance-agent-view-controller.ts must own the maintenance-agent shell projection",
  );
  assert.doesNotMatch(
    maintenanceAgentViewControllerText,
    /<template>|from\s+["'][^"']*(AgentModelOptionBar|OptionBar|StatusPill)|<\s*(AgentModelOptionBar|OptionBar|StatusPill)\b|class="job-row"/,
    "console-maintenance-agent-view-controller.ts must not own rendered component markup",
  );
  assert.ok(
    maintenanceAgentViewContextText.trimEnd().split(/\r?\n/).length <= 25,
    "maintenanceAgentViewContext.ts must stay a small provide/inject boundary",
  );
  assert.ok(
    maintenanceAgentSummaryCardText.trimEnd().split(/\r?\n/).length <= 65,
    "MaintenanceAgentSummaryCard.vue must stay focused on maintenance summary metrics",
  );
  assert.match(
    maintenanceAgentSummaryCardText,
    /maintenanceAgentConfig[\s\S]*pendingMaintenanceApprovalCount[\s\S]*latestMaintenanceAgentRun[\s\S]*maintenanceAgentSummary/,
    "MaintenanceAgentSummaryCard.vue must own summary tags and metrics",
  );
  assert.doesNotMatch(
    maintenanceAgentSummaryCardText,
    /OptionBar|AgentModelOptionBar|displayedMaintenanceAgentRuns|selectedMaintenanceAgentRun|saveMaintenanceAgentConfig/,
    "MaintenanceAgentSummaryCard.vue must not own policy, action, run-list, or detail workflows",
  );
  assert.ok(
    maintenanceAgentPolicyPanelText.trimEnd().split(/\r?\n/).length <= 95,
    "MaintenanceAgentPolicyPanel.vue must stay focused on scheduler policy editing",
  );
  assert.match(
    maintenanceAgentPolicyPanelText,
    /maintenanceAgentConfig[\s\S]*enabledBooleanOptionBarOptions[\s\S]*plannerModeOptionBarOptions[\s\S]*autoApproveRiskOptionBarOptions[\s\S]*saveMaintenanceAgentConfig/,
    "MaintenanceAgentPolicyPanel.vue must own scheduler policy controls and save action",
  );
  assert.doesNotMatch(
    maintenanceAgentPolicyPanelText,
    /AgentModelOptionBar|chatMaintenanceAgent|runMaintenanceAgentRunbook|displayedMaintenanceAgentRuns|selectedMaintenanceAgentRun/,
    "MaintenanceAgentPolicyPanel.vue must not own agent chat, runbook execution, run list, or detail rendering",
  );
  assert.ok(
    maintenanceAgentActionGridText.trimEnd().split(/\r?\n/).length <= 105,
    "MaintenanceAgentActionGrid.vue must stay focused on runbook execution entry points",
  );
  assert.match(
    maintenanceAgentActionGridText,
    /OptionBar[\s\S]*maintenanceAgentRunbook[\s\S]*runMaintenanceAgentRunbook[\s\S]*runMaintenanceAgentKnowledgeMaintenance/,
    "MaintenanceAgentActionGrid.vue must own the runbook action forms",
  );
  assert.doesNotMatch(
    maintenanceAgentActionGridText,
    /saveMaintenanceAgentConfig|displayedMaintenanceAgentRuns|selectedMaintenanceAgentRun|approveMaintenanceAgentRun|cancelMaintenanceAgentRun/,
    "MaintenanceAgentActionGrid.vue must not own policy save, run lists, approvals, cancellations, or detail rendering",
  );
  assert.ok(
    maintenanceAgentRunListText.trimEnd().split(/\r?\n/).length <= 95,
    "MaintenanceAgentRunList.vue must stay focused on run-list selection and row actions",
  );
  assert.match(
    maintenanceAgentRunListText,
    /displayedMaintenanceAgentRuns[\s\S]*selectedMaintenanceAgentRun[\s\S]*approveMaintenanceAgentRun[\s\S]*cancelMaintenanceAgentRun/,
    "MaintenanceAgentRunList.vue must own run selection, approval, and cancellation row actions",
  );
  assert.doesNotMatch(
    maintenanceAgentRunListText,
    /maintenanceAgentConfig|saveMaintenanceAgentConfig|AgentModelOptionBar|chatMaintenanceAgent|maintenanceAgentResultJson/,
    "MaintenanceAgentRunList.vue must not own policy editing, action forms, or run detail output",
  );
  assert.ok(
    maintenanceAgentRunDetailText.trimEnd().split(/\r?\n/).length <= 65,
    "MaintenanceAgentRunDetail.vue must stay focused on selected run details",
  );
  assert.match(
    maintenanceAgentRunDetailText,
    /selectedMaintenanceAgentRun[\s\S]*steps[\s\S]*maintenanceAgentResultJson[\s\S]*jsonPreview|jsonPreview[\s\S]*maintenanceAgentResultJson[\s\S]*selectedMaintenanceAgentRun[\s\S]*steps/,
    "MaintenanceAgentRunDetail.vue must own selected run step and output rendering",
  );
  assert.doesNotMatch(
    maintenanceAgentRunDetailText,
    /maintenanceAgentConfig|saveMaintenanceAgentConfig|AgentModelOptionBar|chatMaintenanceAgent|displayedMaintenanceAgentRuns|approveMaintenanceAgentRun|cancelMaintenanceAgentRun/,
    "MaintenanceAgentRunDetail.vue must not own policy editing, action forms, run-list selection, approvals, or cancellations",
  );
  assert.match(
    maintenanceAgentClientText,
    /\/api\/maintenance-agent\/config/,
    "maintenance-agent-client.ts must own maintenance agent config endpoints",
  );
  assert.match(
    maintenanceAgentClientText,
    /\/api\/maintenance-agent\/chat/,
    "maintenance-agent-client.ts must own maintenance agent chat endpoint",
  );
  assert.match(
    maintenanceAgentClientText,
    /\/api\/maintenance-agent\/runs/,
    "maintenance-agent-client.ts must own maintenance agent run endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/maintenance-agent-client["']/,
    "bridge.ts compatibility facade must re-export maintenance agent behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/maintenance-agent/,
    "bridge.ts must not own maintenance agent endpoints",
  );
  assert.doesNotMatch(
    maintenanceAgentControllerText,
    /from\s+["']\.\.\/lib\/bridge["']/,
    "console-maintenance-agent-controller.ts must depend on maintenance-agent-client.ts, not the global bridge facade",
  );
  assert.doesNotMatch(
    maintenanceAgentControllerText,
    /\bbridge\s*\.\s*(getMaintenanceAgentConfig|saveMaintenanceAgentConfig|chatMaintenanceAgent|startMaintenanceAgentRun|listMaintenanceAgentRuns|getMaintenanceAgentRun|approveMaintenanceAgentRun|cancelMaintenanceAgentRun)\b/,
    "console-maintenance-agent-controller.ts must not call maintenance agent APIs through bridge",
  );
  assert.doesNotMatch(
    runtimeDependenciesText,
    /from\s+["']\.\/bridge["']/,
    "runtime-dependencies.ts must depend on its domain client, not the global bridge facade",
  );
  assert.match(
    runtimeDependenciesClientText,
    /\/api\/runtime\/dependencies/,
    "runtime-dependencies-client.ts must own runtime dependency endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/runtime-dependencies-client["']/,
    "bridge.ts compatibility facade must re-export runtime dependency behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/runtime\/dependencies/,
    "bridge.ts must not own runtime dependency endpoints",
  );
  assert.doesNotMatch(
    knowledgeDocumentsText,
    /from\s+["']\.\/bridge["']/,
    "knowledge-documents.ts must depend on its domain client, not the global bridge facade",
  );
  assert.match(
    knowledgeDocumentsClientText,
    /\/api\/knowledge\/document-parser\/parse/,
    "knowledge-documents-client.ts must own document parser preview endpoint",
  );
  assert.match(
    knowledgeDocumentsClientText,
    /\/api\/knowledge\/export\/docx/,
    "knowledge-documents-client.ts must own knowledge document export URLs",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/knowledge-documents-client["']/,
    "bridge.ts compatibility facade must re-export knowledge document behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/document-parser\/parse|\/api\/knowledge\/export\/docx/,
    "bridge.ts must not own knowledge document parser/export endpoints",
  );
  assert.doesNotMatch(
    knowledgeDistillationWorkbenchText,
    /from\s+["']\.\/bridge["']/,
    "knowledge-distillation-workbench.ts must depend on domain clients, not the global bridge facade",
  );
  assert.doesNotMatch(
    knowledgeDistillationWorkbenchText,
    /\/api\/knowledge\/distillation\/workbench/,
    "knowledge-distillation-workbench.ts must not retain legacy workbench endpoints after external service extraction",
  );
  assert.doesNotMatch(
    bridgeText,
    /from\s+["']\.\/knowledge-distillation-workbench-client["']/,
    "bridge.ts must not re-export removed workbench client behavior",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/distillation\/workbench/,
    "bridge.ts must not own knowledge distillation workbench endpoints",
  );
  assert.doesNotMatch(
    knowledgeUploadSessionText,
    /from\s+["']\.\/bridge["']/,
    "knowledge-upload-session.ts must depend on its domain client, not the global bridge facade",
  );
  assert.match(
    uploadSessionClientText,
    /\/api\/upload-sessions/,
    "upload-session-client.ts must own upload session endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/upload-session-client["']/,
    "bridge.ts compatibility facade must re-export upload session behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/upload-sessions/,
    "bridge.ts must not own upload session endpoints",
  );
  assert.match(
    jobsClientText,
    /\/api\/jobs/,
    "jobs-client.ts must own job lifecycle endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/jobs-client["']/,
    "bridge.ts compatibility facade must re-export job lifecycle behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/jobs/,
    "bridge.ts must not own job lifecycle endpoints",
  );
  assert.match(
    jobControllerText,
    /from\s+["']\.\.\/lib\/jobs-client["']/,
    "console-job-controller.ts must own job lifecycle actions through jobs-client.ts",
  );
  assert.match(
    jobControllerText,
    /function\s+upsertJobFromEvent/,
    "console-job-controller.ts must own job event merge behavior",
  );
  assert.match(
    jobControllerText,
    /const\s+filteredJobs\s*=\s*computed/,
    "console-job-controller.ts must own job list projection",
  );
  assert.match(
    jobDisplayUtilsText,
    /function\s+jobElapsed/,
    "console-job-display-utils.ts must own job elapsed display formatting",
  );
  assert.match(
    jobDisplayUtilsText,
    /function\s+splitJobStatusLabel/,
    "console-job-display-utils.ts must own job status labels",
  );
  assert.doesNotMatch(
    jobControllerText,
    /function\s+(?:jobElapsed|splitJobStatusLabel)|jobStatusLabels|formatDuration/,
    "console-job-controller.ts must not own stateless job display helpers",
  );
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["']\.\.\/lib\/jobs-client["']|function\s+recalculateJobSummary|function\s+upsertJobFromEvent|function\s+removeJobFromEvent|async\s+function\s+deleteJob|const\s+filteredJobs\s*=\s*computed|const\s+recentJobs\s*=\s*computed|const\s+activeJobCount\s*=\s*computed|function\s+jobElapsed|function\s+splitJobStatusLabel/,
    "useConsole.ts must delegate job lifecycle actions and projections to console-job-controller.ts",
  );
  assert.match(
    clientControllerText,
    /const\s+clientSearchQuery\s*=\s*ref/,
    "console-client-controller.ts must own client search/filter state",
  );
  assert.match(
    clientDisplayUtilsText,
    /clientConnectionMethodLabel[\s\S]*clientConnectionDetail[\s\S]*clientStatusLabel[\s\S]*clientStatusTone/,
    "console-client-display-utils.ts must own client connection/status display helpers",
  );
  assert.match(
    clientControllerText,
    /from\s+["']\.\/console-client-display-utils["']/,
    "console-client-controller.ts must import client display helpers for search projection",
  );
  assert.match(
    clientControllerText,
    /const\s+filteredClientList\s*=\s*computed/,
    "console-client-controller.ts must own filtered client projections",
  );
  assert.doesNotMatch(
    clientControllerText,
    /function\s+(?:clientConnectionMethodLabel|clientConnectionDetail|clientStatusLabel|clientStatusTone)/,
    "console-client-controller.ts must not own stateless client display helpers",
  );
  assert.match(
    clientsViewText,
    /from\s+["']\.\.\/\.\.\/composables\/console-client-display-utils["']/,
    "ClientsView.vue must import client display helpers directly",
  );
  assert.deepEqual(
    destructuredKeysFromCall(
      clientsViewText,
      "useServerConsoleShellContext",
    ).filter((key) => [
      "clientConnectionDetail",
      "clientConnectionMethodLabel",
      "clientStatusLabel",
      "clientStatusTone",
    ].includes(key)),
    [],
    "ClientsView.vue must not receive client display helpers through shell context",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+clientSearchQuery\s*=\s*ref|const\s+clientStateFilter\s*=\s*ref|type\s+ClientConnectionRow|function\s+clientConnectionMethodLabel|function\s+clientConnectionDetail|function\s+clientStatusLabel|function\s+clientStatusTone|const\s+filteredClients\s*=\s*computed|const\s+filteredClientList\s*=\s*computed|const\s+displayedClients\s*=\s*computed|const\s+clientStateFilterOptionBarOptions\s*=\s*computed|const\s+attentionClientCount\s*=\s*computed|const\s+latestClient\s*=\s*computed/,
    "useConsole.ts must delegate client search, labels, and projections to console-client-controller.ts",
  );
  assert.match(
    optionBarControllerText,
    /const\s+enabledBooleanOptionBarOptions\s*:\s*OptionBarOption\[\]/,
    "console-option-bar-controller.ts must own shared enabled/disabled option-bar values",
  );
  assert.match(
    optionBarControllerText,
    /const\s+analysisModuleOptionBarOptions\s*=\s*computed/,
    "console-option-bar-controller.ts must own runtime analysis module option projection",
  );
  assert.match(
    optionBarControllerText,
    /function\s+moduleModelAssignmentSelectOptions/,
    "console-option-bar-controller.ts must own module model assignment select options",
  );
  assert.match(
    optionBarControllerText,
    /const\s+authRoleOptionBarOptions\s*=\s*computed/,
    "console-option-bar-controller.ts must own auth role option projection",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+(?:enabledBooleanOptionBarOptions|enabledStringOptionBarOptions|vocabularyStatusOptionBarOptions|plannerModeOptionBarOptions|autoApproveRiskOptionBarOptions|discoveryModeOptionBarOptions|contextWindowOptionBarOptions|thinkingModeOptionBarOptions|moduleAccessModeOptionBarOptions|analysisModuleOptionBarOptions|addableModelProviderOptionBarOptions|authRoleOptionBarOptions)\b|function\s+moduleModelAssignmentSelectOptions\b/,
    "useConsole.ts must delegate shared option-bar values and projections to console-option-bar-controller.ts",
  );
  assert.match(
    knowledgeMaintenanceControllerText,
    /from\s+["']\.\.\/lib\/knowledge-maintenance-client["']/,
    "console-knowledge-maintenance-controller.ts must own knowledge maintenance API calls through the domain client",
  );
  assert.match(
    knowledgeMaintenanceControllerText,
    /async\s+function\s+refreshKnowledgeConsole/,
    "console-knowledge-maintenance-controller.ts must own knowledge console refresh workflow",
  );
  assert.match(
    knowledgeMaintenanceControllerText,
    /function\s+setMaintenanceFieldValue/,
    "console-knowledge-maintenance-controller.ts must own maintenance draft field mutation",
  );
  assert.match(
    knowledgeMaintenanceControllerText,
    /const\s+knowledgeModules\s*=\s*computed/,
    "console-knowledge-maintenance-controller.ts must own knowledge status/module projection",
  );
  assert.match(
    knowledgeMaintenanceControllerText,
    /from\s+["']\.\/console-format-utils["']/,
    "console-knowledge-maintenance-controller.ts must use shared formatting helpers instead of owning JSON preview formatting",
  );
  assert.equal(
    returnObjectShorthandKeys(
      knowledgeMaintenanceControllerText,
      "createConsoleKnowledgeMaintenanceController",
    ).includes("jsonPreview"),
    false,
    "console-knowledge-maintenance-controller.ts must not expose jsonPreview as route/domain context state",
  );
  assert.doesNotMatch(
    knowledgeMaintenanceControllerText,
    /function\s+jsonPreview/,
    "console-knowledge-maintenance-controller.ts must not redeclare jsonPreview locally",
  );
  assert.doesNotMatch(
    useConsoleText,
    /from\s+["']\.\.\/lib\/knowledge-maintenance-client["']|from\s+["']\.\.\/lib\/knowledge-sources-client["']|const\s+knowledgeConsole\s*=\s*ref|const\s+knowledgeSchema\s*=\s*ref|const\s+knowledgeSourceState\s*=\s*ref|const\s+knowledgeMaintenanceDraft\s*=\s*ref|const\s+maintenanceJson\s*=\s*ref|function\s+readNestedValue|function\s+writeNestedValue|function\s+maintenanceFieldValue|function\s+setMaintenanceFieldValue|function\s+setMaintenanceFieldFromEvent|async\s+function\s+refreshKnowledgeConsole|async\s+function\s+saveKnowledgeMaintenance|const\s+knowledgeStatus\s*=\s*computed|const\s+knowledgeModules\s*=\s*computed|const\s+knowledgeRecentJobs\s*=\s*computed|function\s+knowledgeConfigGroupDescription/,
    "useConsole.ts must delegate knowledge maintenance state, field mutation, refresh, save, and projections to console-knowledge-maintenance-controller.ts",
  );
  [
    ["console-knowledge-ingest-controller.ts", knowledgeIngestControllerText],
    ["console-debug-distillation-runner.ts", debugDistillationRunnerText],
    ["console-job-controller.ts", jobControllerText],
    ["console-knowledge-maintenance-controller.ts", knowledgeMaintenanceControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on jobs-client.ts and focused domain clients, not the global bridge facade`,
    );
  });
  [
    ["console-knowledge-ingest-controller.ts", knowledgeIngestControllerText],
    ["console-debug-distillation-runner.ts", debugDistillationRunnerText],
    ["useConsole.ts", useConsoleText],
    ["console-job-controller.ts", jobControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /\bbridge\s*\.\s*(createJob|reparseJob|listJobs|deleteJob|getJob|getJobResult|getNormalizedDocuments)\b/,
      `${label} must not call job lifecycle APIs through bridge`,
    );
  });
  assert.match(
    authorizationGovernanceClientText,
    /\/api\/authorization\/governance/,
    "authorization-governance-client.ts must own authorization governance endpoints",
  );
  assert.match(
    authorizationGovernanceClientText,
    /\/api\/console\/mcp\/authorization\/requests/,
    "authorization-governance-client.ts must own MCP authorization request endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/authorization-governance-client["']/,
    "bridge.ts compatibility facade must re-export authorization governance behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/authorization\/(?:governance|roles|teams|users\/policy|agent-groups|agents\/binding|approvals)|\/api\/console\/mcp\/authorization\/requests/,
    "bridge.ts must not own authorization governance or MCP authorization endpoints",
  );
  [
    ["console-agent-permissions-view-controller.ts", agentPermissionsControllerText],
    ["console-mcp-authorization-controller.ts", mcpAuthorizationControllerText],
    ["console-approval-flow-view-controller.ts", approvalFlowControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on authorization-governance-client.ts, not the global bridge facade`,
    );
  });
  assert.match(
    toolManagementClientText,
    /\/api\/tool-management\/v1\/catalog/,
    "tool-management-client.ts must own tool management catalog endpoints",
  );
  assert.match(
    toolManagementClientText,
    /\/api\/tool-management\/v1\/grants/,
    "tool-management-client.ts must own tool grant endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/tool-management-client["']/,
    "bridge.ts compatibility facade must re-export tool management behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/tool-management\/v1/,
    "bridge.ts must not own tool management endpoints",
  );
  [
    ["console-tool-management-controller.ts", toolManagementControllerText],
    ["console-tool-grants-controller.ts", toolGrantsControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on tool-management-client.ts, not the global bridge facade`,
    );
  });
  assert.match(
    agentGatewayClientText,
    /\/api\/agent-gateway\/call/,
    "agent-gateway-client.ts must own agent gateway call endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/agent-gateway-client["']/,
    "bridge.ts compatibility facade must re-export agent gateway behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/agent-gateway/,
    "bridge.ts must not own agent gateway endpoints",
  );
  assert.match(
    knowledgeSourcesClientText,
    /\/api\/knowledge\/sources/,
    "knowledge-sources-client.ts must own knowledge source endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/knowledge-sources-client["']/,
    "bridge.ts compatibility facade must re-export knowledge source behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/sources(?:\b|\/|-refresh)/,
    "bridge.ts must not own knowledge source endpoints",
  );
  assert.match(
    knowledgeSearchClientText,
    /\/api\/knowledge\/search/,
    "knowledge-search-client.ts must own knowledge search endpoints",
  );
  assert.match(
    knowledgeSearchClientText,
    /\/api\/knowledge\/evidence/,
    "knowledge-search-client.ts must own knowledge evidence endpoints",
  );
  assert.match(
    knowledgeSearchClientText,
    /\/api\/knowledge\/(?:export\/request|permission\/request|render\/markdown)/,
    "knowledge-search-client.ts must own knowledge export, permission, and markdown render request endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/knowledge-search-client["']/,
    "bridge.ts compatibility facade must re-export knowledge search/evidence behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/(?:search|backend\/connect|spaces|feedback|evidence|assets|export\/request|permission\/request|render\/markdown)/,
    "bridge.ts must not own knowledge search, backend, feedback, evidence, asset, export, permission, or render endpoints",
  );
  assert.match(
    knowledgeReviewClientText,
    /\/api\/knowledge\/review-items/,
    "knowledge-review-client.ts must own knowledge review endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/knowledge-review-client["']/,
    "bridge.ts compatibility facade must re-export knowledge review behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/review-items/,
    "bridge.ts must not own knowledge review endpoints",
  );
  assert.match(
    knowledgeWordCloudClientText,
    /\/api\/knowledge\/word-clouds/,
    "knowledge-word-cloud-client.ts must own word-cloud endpoints",
  );
  assert.match(
    knowledgeWordCloudClientText,
    /\/api\/storage\/source-vocabulary\/rebuild/,
    "knowledge-word-cloud-client.ts must own source vocabulary rebuild endpoint used by word-cloud refresh",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/knowledge-word-cloud-client["']/,
    "bridge.ts compatibility facade must re-export word-cloud behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/word-clouds|\/api\/storage\/source-vocabulary\/rebuild/,
    "bridge.ts must not own knowledge word-cloud endpoints",
  );
  [
    ["console-word-cloud-corpus-controller.ts", wordCloudCorpusControllerText],
    ["console-word-cloud-workflow-controller.ts", wordCloudWorkflowControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on knowledge-word-cloud-client.ts, not the global bridge facade`,
    );
    assert.doesNotMatch(
      text,
      /\bbridge\s*\.\s*(getKnowledgeWordClouds|saveKnowledgeWordClouds|exportKnowledgeWordClouds|importKnowledgeWordClouds|addKnowledgeWordBag|updateKnowledgeWordBag|deleteKnowledgeWordBag|getKnowledgeWordBagTerms|rebuildSourceVocabulary)\b/,
      `${label} must not call word-cloud APIs through bridge`,
    );
  });
  assert.ok(
    wordCloudEditorControllerText.trimEnd().split(/\r?\n/).length <= 340,
    "console-word-cloud-editor-controller.ts must stay a focused draft lifecycle boundary after card/term extraction",
  );
  assert.ok(
    wordCloudCardControllerText.trimEnd().split(/\r?\n/).length <= 150,
    "console-word-cloud-card-controller.ts must stay a focused card projection and UI-state boundary",
  );
  assert.ok(
    wordCloudTermControllerText.trimEnd().split(/\r?\n/).length <= 150,
    "console-word-cloud-term-controller.ts must stay a focused word-cloud term editing boundary",
  );
  assert.match(
    wordCloudEditorControllerText,
    /createConsoleWordCloudCardController[\s\S]*createConsoleWordCloudTermController/,
    "console-word-cloud-editor-controller.ts must delegate card projection and term editing to focused controllers",
  );
  assert.doesNotMatch(
    wordCloudEditorControllerText,
    /const\s+wordCloudPalette|isWordCloudTailCard|function\s+(?:wordCloudCardStyle|toggleWordCloudCollapsed|pinWordCloud|toggleWordCloudActionMenu|wordCloudVisibleTerms|addTermToCloud|addTermInputToCloud|setWordCloudTermInput|removeTermFromCloud|clearRemovedTermsFromCloud|addTermActionToCloud)\b/,
    "console-word-cloud-editor-controller.ts must not re-own card UI projection or term editing actions",
  );
  assert.match(
    wordCloudCardControllerText,
    /const\s+wordCloudPalette[\s\S]*function\s+wordCloudCardStyle[\s\S]*function\s+toggleWordCloudCollapsed/,
    "console-word-cloud-card-controller.ts must own word-cloud card palette, style, and collapse state",
  );
  assert.doesNotMatch(
    wordCloudCardControllerText,
    /mutateWordCloudDraft|normalizeWordCloudSetForUi|addTermToCloud|removeTermFromCloud/,
    "console-word-cloud-card-controller.ts must not own draft mutation or term editing",
  );
  assert.match(
    wordCloudTermControllerText,
    /function\s+addTermToCloud[\s\S]*function\s+addTermInputToCloud[\s\S]*function\s+removeTermFromCloud/,
    "console-word-cloud-term-controller.ts must own word-cloud term add, input, and removal actions",
  );
  assert.doesNotMatch(
    wordCloudTermControllerText,
    /wordCloudPalette|isWordCloudTailCard|wordCloudCardStyle/,
    "console-word-cloud-term-controller.ts must not own card UI projection",
  );
  assert.ok(
    knowledgeWordCloudPanelText.trimEnd().split(/\r?\n/).length <= 30,
    "KnowledgeWordCloudPanel.vue must stay a small word-cloud composition boundary",
  );
  assert.match(
    knowledgeWordCloudPanelText,
    /WordCloudStage/,
    "KnowledgeWordCloudPanel.vue must compose the word-cloud stage",
  );
  assert.doesNotMatch(
    knowledgeWordCloudPanelText,
    /BrowseSelectButton|AgentModelOptionBar|wordCloudCardRows|wordCloudCorpusPaths|wordCloudVisibleTerms|wordCloudPrompt|wordCloudMessages/,
    "KnowledgeWordCloudPanel.vue must not own corpus controls, card rendering, terms, or deleted agent proposal state",
  );
  assert.ok(
    wordCloudStageText.trimEnd().split(/\r?\n/).length <= 40,
    "WordCloudStage.vue must stay a small word-cloud stage shell",
  );
  assert.match(
    wordCloudStageText,
    /WordCloudStageHeader[\s\S]*WordCloudCardList/,
    "WordCloudStage.vue must compose the stage header and card list",
  );
  assert.doesNotMatch(
    wordCloudStageText,
    /BrowseSelectButton|AgentModelOptionBar|wordCloudVisibleTerms|wordCloudPrompt|wordCloudMessages|setWordCloudTermInput/,
    "WordCloudStage.vue must not own corpus controls, term editing, or deleted agent proposal rendering",
  );
  assert.ok(
    wordCloudStageHeaderText.trimEnd().split(/\r?\n/).length <= 100,
    "WordCloudStageHeader.vue must stay focused on corpus scope and stage actions",
  );
  assert.match(
    wordCloudStageHeaderText,
    /BrowseSelectButton[\s\S]*wordCloudCorpusPaths[\s\S]*addManualWordCloud[\s\S]*saveWordCloud/,
    "WordCloudStageHeader.vue must own corpus scope controls and stage save/add actions",
  );
  assert.doesNotMatch(
    wordCloudStageHeaderText,
    /wordCloudVisibleTerms|wordCloudMessages|proposeWordCloud|setWordCloudTermInput|toggleWordCloudActionMenu/,
    "WordCloudStageHeader.vue must not own card-body term editing or deleted agent proposal workflow",
  );
  assert.ok(
    wordCloudCardListText.trimEnd().split(/\r?\n/).length <= 50,
    "WordCloudCardList.vue must stay focused on list, loading, and empty states",
  );
  assert.match(
    wordCloudCardListText,
    /WordCloudClassCard[\s\S]*wordCloudCardRows[\s\S]*wordCloudState/,
    "WordCloudCardList.vue must own card list rendering and loading/empty states",
  );
  assert.doesNotMatch(
    wordCloudCardListText,
    /wordCloudCorpusPaths|wordCloudMessages|formatWordCloudThreshold|setWordCloudTermInput|proposeWordCloud/,
    "WordCloudCardList.vue must not own corpus controls, card-body fields, or deleted agent proposal workflow",
  );
  assert.ok(
    wordCloudClassCardText.trimEnd().split(/\r?\n/).length <= 170,
    "WordCloudClassCard.vue must stay focused on one word-cloud card header and hierarchy controls",
  );
  assert.match(
    wordCloudClassCardText,
    /WordCloudCardBody[\s\S]*pinWordCloud[\s\S]*toggleWordCloudActionMenu[\s\S]*wordCloudCardStyle/,
    "WordCloudClassCard.vue must own card shell, title, hierarchy, and pin/collapse actions",
  );
  assert.doesNotMatch(
    wordCloudClassCardText,
    /wordCloudCorpusPaths|wordCloudMessages|proposeWordCloud|wordCloudVisibleTerms|formatWordCloudThreshold|setWordCloudTermInput/,
    "WordCloudClassCard.vue must not own corpus scope, deleted agent proposal workflow, or card-body term editing",
  );
  assert.ok(
    wordCloudCardBodyText.trimEnd().split(/\r?\n/).length <= 140,
    "WordCloudCardBody.vue must stay focused on one card's advanced fields and terms",
  );
  assert.match(
    wordCloudCardBodyText,
    /formatWordCloudThreshold[\s\S]*wordCloudVisibleTerms[\s\S]*setWordCloudTermInput[\s\S]*clearRemovedTermsFromCloud/,
    "WordCloudCardBody.vue must own per-card advanced fields, summary, visible terms, and inline term input",
  );
  assert.match(
    wordCloudCardBodyText,
    /from\s+["']\.\.\/\.\.\/\.\.\/composables\/console-word-cloud-utils["']/,
    "WordCloudCardBody.vue must import word-cloud display formatting directly",
  );
  assert.equal(
    destructuredKeysFromCall(wordCloudCardBodyText, "useKnowledgeViewContext").includes("formatWordCloudThreshold"),
    false,
    "WordCloudCardBody.vue must not receive formatWordCloudThreshold through knowledge context",
  );
  assert.doesNotMatch(
    wordCloudCardBodyText,
    /wordCloudCardStyle|toggleWordCloudActionMenu|pinWordCloud|wordCloudMessages|proposeWordCloud|wordCloudCorpusPaths/,
    "WordCloudCardBody.vue must not own card shell controls, deleted agent proposal workflow, or corpus scope",
  );
  assert.ok(
    knowledgeRulesPanelText.trimEnd().split(/\r?\n/).length <= 30,
    "KnowledgeRulesPanel.vue must stay a small rules composition boundary",
  );
  assert.match(
    knowledgeRulesPanelText,
    /GoldenRulesPanel[\s\S]*ExpertVocabularyPanel[\s\S]*RuleAuthoringPanel[\s\S]*EmailExpertRulesPanel/,
    "KnowledgeRulesPanel.vue must compose the golden-rule, vocabulary, authoring, and email-rule panels",
  );
  assert.doesNotMatch(
    knowledgeRulesPanelText,
    /ConfigFoldCard|FeatureToggle|AgentModelOptionBar|SegmentedToggle|goldenRulePackages|expertVocabularyDraft|ruleAuthoringForm|emailReportSeriesRules|rulesText/,
    "KnowledgeRulesPanel.vue must not own rule package, vocabulary, authoring, or email-rule rendering directly",
  );
  assert.ok(
    goldenRulesPanelText.trimEnd().split(/\r?\n/).length <= 100,
    "GoldenRulesPanel.vue must stay focused on golden-rule packages",
  );
  assert.match(
    goldenRulesPanelText,
    /goldenRulePackages[\s\S]*goldenRuleItems[\s\S]*toggleGoldenRuleEnabled[\s\S]*ConfigFoldCard/,
    "GoldenRulesPanel.vue must own golden-rule package rendering and toggles",
  );
  assert.doesNotMatch(
    goldenRulesPanelText,
    /expertVocabularyDraft|vocabularySearch|ruleAuthoringForm|emailReportSeriesRules|emailSynonymRules|rulesText|saveRules/,
    "GoldenRulesPanel.vue must not own vocabulary, authoring, or email-rule state",
  );
  assert.ok(
    expertVocabularyPanelText.trimEnd().split(/\r?\n/).length <= 135,
    "ExpertVocabularyPanel.vue must stay focused on expert vocabulary editing",
  );
  assert.match(
    expertVocabularyPanelText,
    /displayedVocabularyEntries[\s\S]*addVocabularyEntry[\s\S]*saveExpertVocabulary[\s\S]*updateVocabularyPath[\s\S]*setVocabularyEntryEnabled/,
    "ExpertVocabularyPanel.vue must own vocabulary filtering, table editing, and publish actions",
  );
  assert.doesNotMatch(
    expertVocabularyPanelText,
    /goldenRulePackages|ruleAuthoringForm|emailReportSeriesRules|emailSynonymRules|rulesText|saveRules/,
    "ExpertVocabularyPanel.vue must not own golden-rule, authoring, or email-rule state",
  );
  assert.ok(
    ruleAuthoringPanelText.trimEnd().split(/\r?\n/).length <= 160,
    "RuleAuthoringPanel.vue must stay focused on the rule authoring form",
  );
  assert.match(
    ruleAuthoringPanelText,
    /SegmentedToggle[\s\S]*ruleCreationMode[\s\S]*runRuleAuthoringChat[\s\S]*ruleAuthoringForm[\s\S]*AgentModelOptionBar[\s\S]*RuleAuthoringResultPanel/,
    "RuleAuthoringPanel.vue must own authoring mode, form controls, model selector, submit, and result panel composition",
  );
  assert.doesNotMatch(
    ruleAuthoringPanelText,
    /goldenRulePackages|expertVocabularyDraft|emailReportSeriesRules|emailSynonymRules|rulesText|publishRuleAuthoringPackage/,
    "RuleAuthoringPanel.vue must not own golden-rule, vocabulary, email-rule, or publish-result state",
  );
  assert.ok(
    ruleAuthoringResultPanelText.trimEnd().split(/\r?\n/).length <= 70,
    "RuleAuthoringResultPanel.vue must stay focused on authoring result rendering and publish confirmation",
  );
  assert.match(
    ruleAuthoringDisplayUtilsText,
    /function\s+ruleAuthoringStatusLabel/,
    "console-rule-authoring-display-utils.ts must own rule-authoring status display labels",
  );
  assert.doesNotMatch(
    ruleAuthoringControllerText,
    /function\s+ruleAuthoringStatusLabel|\n\s*ruleAuthoringStatusLabel,\n\s*ruleCreationMode/,
    "console-rule-authoring-controller.ts must not own or return stateless rule-authoring status labels",
  );
  assert.match(
    ruleAuthoringResultPanelText,
    /from\s+["']\.\.\/\.\.\/\.\.\/composables\/console-rule-authoring-display-utils["']/,
    "RuleAuthoringResultPanel.vue must import rule-authoring status labels directly",
  );
  assert.equal(
    destructuredKeysFromCall(ruleAuthoringResultPanelText, "useKnowledgeViewContext").includes("ruleAuthoringStatusLabel"),
    false,
    "RuleAuthoringResultPanel.vue must not receive ruleAuthoringStatusLabel through knowledge context",
  );
  assert.match(
    ruleAuthoringResultPanelText,
    /ruleAuthoringStatusLabel[\s\S]*shortId[\s\S]*publishRuleAuthoringPackage[\s\S]*ConfigFoldCard/,
    "RuleAuthoringResultPanel.vue must own authoring status, pipeline, publish confirmation, and JSON result rendering",
  );
  assert.doesNotMatch(
    ruleAuthoringResultPanelText,
    /ruleAuthoringForm|AgentModelOptionBar|SegmentedToggle|goldenRulePackages|expertVocabularyDraft|emailReportSeriesRules|rulesText|saveRules/,
    "RuleAuthoringResultPanel.vue must not own authoring form controls, golden-rule, vocabulary, or email-rule state",
  );
  assert.ok(
    emailExpertRulesPanelText.trimEnd().split(/\r?\n/).length <= 100,
    "EmailExpertRulesPanel.vue must stay focused on email expert rules and raw JSON save",
  );
  assert.match(
    emailExpertRulesPanelText,
    /emailReportSeriesRules[\s\S]*emailSynonymRules[\s\S]*setEmailRuleEntryEnabled[\s\S]*rulesText[\s\S]*saveRules/,
    "EmailExpertRulesPanel.vue must own email report-series/synonym toggles and raw rules JSON save",
  );
  assert.doesNotMatch(
    emailExpertRulesPanelText,
    /goldenRulePackages|expertVocabularyDraft|vocabularySearch|ruleAuthoringForm|AgentModelOptionBar|publishRuleAuthoringPackage/,
    "EmailExpertRulesPanel.vue must not own golden-rule packages, vocabulary editing, or rule authoring",
  );
  assert.match(
    knowledgeMaintenanceClientText,
    /\/api\/knowledge\/console/,
    "knowledge-maintenance-client.ts must own knowledge console endpoint",
  );
  assert.match(
    knowledgeMaintenanceClientText,
    /\/api\/knowledge\/config-schema/,
    "knowledge-maintenance-client.ts must own knowledge config schema endpoint",
  );
  assert.match(
    knowledgeMaintenanceClientText,
    /\/api\/knowledge\/maintenance/,
    "knowledge-maintenance-client.ts must own knowledge maintenance endpoints",
  );
  assert.match(
    knowledgeMaintenanceClientText,
    /\/api\/knowledge\/reindex/,
    "knowledge-maintenance-client.ts must own knowledge reindex endpoint",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/knowledge-maintenance-client["']/,
    "bridge.ts compatibility facade must re-export knowledge maintenance behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/(?:console|config-schema|maintenance|reindex)/,
    "bridge.ts must not own knowledge console, config, maintenance, or reindex endpoints",
  );
  assert.doesNotMatch(
    useConsoleText,
    /\bbridge\s*\.\s*(getKnowledgeConsole|getKnowledgeConfigSchema|getKnowledgeMaintenance|getKnowledgeSources|saveKnowledgeMaintenance|runKnowledgeMaintenance|reindexKnowledge)\b/,
    "useConsole.ts must depend on knowledge maintenance/source clients instead of the global bridge facade",
  );
  assert.match(
    knowledgeRulesClientText,
    /\/api\/email-rules/,
    "knowledge-rules-client.ts must own email rule endpoints",
  );
  assert.match(
    knowledgeRulesClientText,
    /\/api\/expert-vocabulary/,
    "knowledge-rules-client.ts must own expert vocabulary endpoints",
  );
  assert.match(
    knowledgeRulesClientText,
    /\/api\/knowledge\/golden-rules/,
    "knowledge-rules-client.ts must own golden rule endpoints",
  );
  assert.match(
    knowledgeRulesClientText,
    /\/api\/knowledge\/rule-authoring\/chat/,
    "knowledge-rules-client.ts must own rule-authoring endpoints",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/knowledge-rules-client["']/,
    "bridge.ts compatibility facade must re-export knowledge rules behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/(?:email-rules|expert-vocabulary)|\/api\/knowledge\/(?:golden-rules|rule-authoring)/,
    "bridge.ts must not own knowledge rule-authoring, golden rule, email rule, or expert vocabulary endpoints",
  );
  [
    ["console-rule-authoring-controller.ts", ruleAuthoringControllerText],
    ["console-expert-rules-controller.ts", expertRulesControllerText],
    ["console-expert-email-rules-controller.ts", expertEmailRulesControllerText],
    ["console-expert-vocabulary-controller.ts", expertVocabularyControllerText],
    ["console-golden-rules-controller.ts", goldenRulesControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on knowledge-rules-client.ts, not the global bridge facade`,
    );
    assert.doesNotMatch(
      text,
      /\bbridge\s*\.\s*(getEmailRules|saveEmailRules|getGoldenRules|saveGoldenRules|getExpertVocabulary|saveExpertVocabulary|getExpertVocabularyVersions|chatKnowledgeRuleAuthoring|publishGoldenRules)\b/,
      `${label} must not call knowledge rule APIs through bridge`,
    );
  });
  assert.ok(
    expertRulesControllerText.trimEnd().split(/\r?\n/).length <= 80,
    "console-expert-rules-controller.ts must stay a thin facade after email, vocabulary, and golden-rule extraction",
  );
  assert.match(
    expertRulesControllerText,
    /createConsoleExpertEmailRulesController[\s\S]*createConsoleExpertVocabularyController[\s\S]*createConsoleGoldenRulesController/,
    "console-expert-rules-controller.ts must compose the focused expert-rule subcontrollers",
  );
  assert.doesNotMatch(
    expertRulesControllerText,
    /\bref\s*\(|\bcomputed\s*\(|\bwatch\s*\(|\bgetEmailRules\b|\bsaveEmailRules\b|\bgetExpertVocabulary\b|\bsaveExpertVocabulary\b|\bgetGoldenRules\b|\bsaveGoldenRules\b|\bpublishGoldenRules\b|\bJSON\.parse\s*\(\s*rulesText\.value/,
    "console-expert-rules-controller.ts must not own email, vocabulary, or golden-rule state/API details",
  );
  assert.ok(
    expertEmailRulesControllerText.trimEnd().split(/\r?\n/).length <= 150,
    "console-expert-email-rules-controller.ts must stay below the focused email-rule threshold",
  );
  assert.match(
    expertEmailRulesControllerText,
    /getEmailRules[\s\S]*saveEmailRules[\s\S]*rulesDraftDirty[\s\S]*setEmailRuleEntryEnabled/,
    "console-expert-email-rules-controller.ts must own email-rule loading, draft state, toggles, and saving",
  );
  assert.doesNotMatch(
    expertEmailRulesControllerText,
    /\bgetExpertVocabulary\b|\bsaveExpertVocabulary\b|\bgetGoldenRules\b|\bsaveGoldenRules\b|\bpublishGoldenRules\b|\bvocabularySearch\b|\bgoldenRulePackages\b/,
    "console-expert-email-rules-controller.ts must not own vocabulary or golden-rule behavior",
  );
  assert.ok(
    expertVocabularyControllerText.trimEnd().split(/\r?\n/).length <= 230,
    "console-expert-vocabulary-controller.ts must stay below the focused vocabulary threshold",
  );
  assert.match(
    expertVocabularyControllerText,
    /getExpertVocabulary[\s\S]*saveExpertVocabularyRequest[\s\S]*displayedVocabularyEntries[\s\S]*updateVocabularyEntry/,
    "console-expert-vocabulary-controller.ts must own expert vocabulary loading, projection, edits, and saving",
  );
  assert.doesNotMatch(
    expertVocabularyControllerText,
    /\bgetEmailRules\b|\bsaveEmailRules\b|\bgetGoldenRules\b|\bsaveGoldenRules\b|\bpublishGoldenRules\b|\brulesText\b|\bgoldenRulePackages\b/,
    "console-expert-vocabulary-controller.ts must not own email-rule or golden-rule behavior",
  );
  assert.ok(
    goldenRulesControllerText.trimEnd().split(/\r?\n/).length <= 110,
    "console-golden-rules-controller.ts must stay below the focused golden-rule threshold",
  );
  assert.match(
    goldenRulesControllerText,
    /getGoldenRules[\s\S]*saveGoldenRules[\s\S]*publishGoldenRules[\s\S]*toggleGoldenRuleEnabled/,
    "console-golden-rules-controller.ts must own golden-rule loading, publication, and enable toggles",
  );
  assert.doesNotMatch(
    goldenRulesControllerText,
    /\bgetEmailRules\b|\bsaveEmailRules\b|\bgetExpertVocabulary\b|\bsaveExpertVocabulary\b|\brulesText\b|\bvocabularySearch\b/,
    "console-golden-rules-controller.ts must not own email-rule or vocabulary behavior",
  );
  [
    ["console-knowledge-source-controller.ts", knowledgeSourceControllerText],
    ["console-knowledge-evidence-controller.ts", knowledgeEvidenceControllerText],
    ["console-knowledge-evidence-render-controller.ts", knowledgeEvidenceRenderControllerText],
    ["console-knowledge-evidence-loader-controller.ts", knowledgeEvidenceLoaderControllerText],
    ["console-knowledge-feedback-controller.ts", knowledgeFeedbackControllerText],
    ["console-knowledge-review-controller.ts", knowledgeReviewControllerText],
    ["console-knowledge-recall-controller.ts", knowledgeRecallControllerText],
    ["console-knowledge-recall-target-controller.ts", knowledgeRecallTargetControllerText],
    ["console-knowledge-recall-runner-controller.ts", knowledgeRecallRunnerControllerText],
    ["console-knowledge-search-state-controller.ts", knowledgeSearchStateControllerText],
    ["console-knowledge-view-state-controller.ts", knowledgeViewStateControllerText],
    ["console-knowledge-library-controller.ts", knowledgeLibraryControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on focused knowledge clients, not the global bridge facade`,
    );
  });
  assert.ok(
    knowledgeRecallControllerText.trimEnd().split(/\r?\n/).length <= 90,
    "console-knowledge-recall-controller.ts must stay a thin facade after target and runner extraction",
  );
  assert.match(
    knowledgeRecallControllerText,
    /createConsoleKnowledgeRecallTargetController[\s\S]*createConsoleKnowledgeRecallRunnerController/,
    "console-knowledge-recall-controller.ts must compose the focused recall target and runner controllers",
  );
  assert.doesNotMatch(
    knowledgeRecallControllerText,
    /\bref\s*\(|\bcomputed\s*\(|\bwatch\s*\(|\blistKnowledgeSpaces\b|\bsearchKnowledgeApi\b|\bnormalizeSearchResults\b|\basRecord\s*\(/,
    "console-knowledge-recall-controller.ts must not own target state, backend loading, search execution, or payload projection directly",
  );
  assert.ok(
    knowledgeSearchStateControllerText.trimEnd().split(/\r?\n/).length <= 70,
    "console-knowledge-search-state-controller.ts must stay a focused recall search state slice",
  );
  assert.match(
    knowledgeSearchStateControllerText,
    /createConsoleKnowledgeSearchStateController[\s\S]*knowledgeSearchForm[\s\S]*knowledgeSearchResponse[\s\S]*knowledgeSearchResults[\s\S]*lastKnowledgeSearchQuery[\s\S]*createConsoleKnowledgeSearchPanelStateController[\s\S]*knowledgeSearchExpanded[\s\S]*knowledgeSearchEmpty/,
    "console-knowledge-search-state-controller.ts must own recall search state and panel expansion projection",
  );
  assert.doesNotMatch(
    knowledgeSearchStateControllerText,
    /searchKnowledgeApi|loadEvidence|openDebugTab|clearAllBusy|normalizeSearchResults|listKnowledgeSpaces/,
    "console-knowledge-search-state-controller.ts must not own search execution, evidence loading, backend loading, or payload normalization",
  );
  assert.match(
    useConsoleText,
    /createConsoleKnowledgeSearchStateController[\s\S]*createConsoleKnowledgeSearchPanelStateController/,
    "useConsole.ts must compose the focused knowledge search state controller",
  );
  assert.doesNotMatch(
    useConsoleText,
    /const\s+(?:knowledgeSearchForm|knowledgeSearchResponse|knowledgeSearchResults|lastKnowledgeSearchQuery)\s*=\s*ref\b|const\s+(?:knowledgeSearchExpanded|knowledgeSearchEmpty)\s*=\s*computed\b/,
    "useConsole.ts must not directly own knowledge recall search refs or panel computeds",
  );
  assert.ok(
    knowledgeRecallTargetControllerText.trimEnd().split(/\r?\n/).length <= 190,
    "console-knowledge-recall-target-controller.ts must stay focused on target and mode selection",
  );
  assert.match(
    knowledgeRecallTargetControllerText,
    /listKnowledgeSpaces[\s\S]*knowledgeRecallBackendSpaces[\s\S]*knowledgeRecallDebugTargets[\s\S]*ensureKnowledgeRecallDebugSelection/,
    "console-knowledge-recall-target-controller.ts must own external-space loading, target projection, and selection repair",
  );
  assert.doesNotMatch(
    knowledgeRecallTargetControllerText,
    /\bsearchKnowledgeApi\b|KnowledgeRecallDebugRun|knowledgeSearchResponse|normalizeSearchResults|buildKnowledgeRecallSearchPayload|currentKnowledgeRetrievalSettings/,
    "console-knowledge-recall-target-controller.ts must not own search execution, run rows, or retrieval payload assembly",
  );
  assert.ok(
    knowledgeRecallRunnerControllerText.trimEnd().split(/\r?\n/).length <= 240,
    "console-knowledge-recall-runner-controller.ts must stay focused on search payload and execution",
  );
  assert.match(
    knowledgeRecallRunnerControllerText,
    /currentKnowledgeRetrievalSettings[\s\S]*searchKnowledge[\s\S]*buildKnowledgeRecallSearchPayload[\s\S]*runKnowledgeRecallDebugBatch/,
    "console-knowledge-recall-runner-controller.ts must own retrieval settings, payload assembly, normal search, and debug batch execution",
  );
  assert.doesNotMatch(
    knowledgeRecallRunnerControllerText,
    /\blistKnowledgeSpaces\b|knowledgeRecallBackendSpacesResult|knowledgeRecallDebugTargets|ensureKnowledgeRecallDebugSelection|watch\s*\(/,
    "console-knowledge-recall-runner-controller.ts must not own backend-space loading or target selection repair",
  );
  assert.ok(
    knowledgeRecallTypesText.trimEnd().split(/\r?\n/).length <= 40,
    "console-knowledge-recall-types.ts must stay a focused recall type module",
  );
  assert.doesNotMatch(
    knowledgeRecallTypesText,
    /\bfunction\b|\bref\s*\(|\bcomputed\s*\(|\bwatch\s*\(/,
    "console-knowledge-recall-types.ts must not own runtime logic",
  );
  assert.ok(
    knowledgeEvidenceControllerText.trimEnd().split(/\r?\n/).length <= 90,
    "console-knowledge-evidence-controller.ts must stay a thin facade after render and loader extraction",
  );
  assert.match(
    knowledgeEvidenceControllerText,
    /createConsoleKnowledgeEvidenceRenderController[\s\S]*createConsoleKnowledgeEvidenceLoaderController/,
    "console-knowledge-evidence-controller.ts must compose the focused evidence render and loader controllers",
  );
  assert.doesNotMatch(
    knowledgeEvidenceControllerText,
    /\bgetKnowledgeEvidence\b|\bevidenceIdFromHref\b|\bbrowserLocationOrigin\b|\bknowledgeAssetUrl\b|\brenderEvidenceReadableHtmlCore\b|\bsafeEmailImageSrcCore\b|\bcomputed\s*\(/,
    "console-knowledge-evidence-controller.ts must not own evidence API loading or HTML/asset rendering details",
  );
  assert.ok(
    knowledgeEvidenceRenderControllerText.trimEnd().split(/\r?\n/).length <= 270,
    "console-knowledge-evidence-render-controller.ts must stay below the focused evidence-render threshold",
  );
  assert.match(
    knowledgeEvidenceRenderControllerText,
    /renderEvidenceReadableHtmlCore[\s\S]*evidenceRenderContext[\s\S]*evidenceReadableKindLabel[\s\S]*selectedEvidenceDisplayTitle/,
    "console-knowledge-evidence-render-controller.ts must own evidence readable HTML, asset context, kind labels, and source projection",
  );
  assert.doesNotMatch(
    knowledgeEvidenceRenderControllerText,
    /\bgetKnowledgeEvidence\b|\bevidenceIdFromHref\b|\brecordFeedback\b|\bopenDebugTab\b|\bevidenceLoadSequence\b|\bsetBusy\b/,
    "console-knowledge-evidence-render-controller.ts must not own evidence loading or preview side effects",
  );
  assert.ok(
    knowledgeEvidenceLoaderControllerText.trimEnd().split(/\r?\n/).length <= 170,
    "console-knowledge-evidence-loader-controller.ts must stay below the focused evidence-loader threshold",
  );
  assert.match(
    knowledgeEvidenceLoaderControllerText,
    /getKnowledgeEvidence[\s\S]*evidenceIdFromHref[\s\S]*hydrateSearchResultPreview[\s\S]*openAgentEvidencePreview/,
    "console-knowledge-evidence-loader-controller.ts must own evidence API loading, link extraction, result hydration, and preview feedback",
  );
  assert.doesNotMatch(
    knowledgeEvidenceLoaderControllerText,
    /\bbrowserLocationOrigin\b|\bknowledgeAssetUrl\b|\brenderEvidenceReadableHtmlCore\b|\bsafeEmailImageSrcCore\b|\bevidenceReadableKindLabel\b|\bselectedEvidenceDisplayTitle\b/,
    "console-knowledge-evidence-loader-controller.ts must not own evidence rendering projection",
  );
  assert.ok(
    knowledgeViewConsoleText.trimEnd().split(/\r?\n/).length <= 220,
    "useKnowledgeViewConsole.ts must stay a bounded composition boundary over focused knowledge page contexts",
  );
  assert.match(
    knowledgeViewConsoleText,
    /createConsoleKnowledgeViewStateController/,
    "useKnowledgeViewConsole.ts must delegate route tab, expansion state, and dynamic parsing preview state",
  );
  assert.match(
    knowledgeViewConsoleText,
    /createConsoleKnowledgeLibraryController/,
    "useKnowledgeViewConsole.ts must keep external knowledge library state behind its focused controller",
  );
  assert.match(
    knowledgeViewConsoleText,
    /const\s+page\s*=\s*\{[\s\S]*const\s+ingest\s*=\s*\{[\s\S]*const\s+library\s*=\s*\{[\s\S]*const\s+maintenance\s*=\s*\{[\s\S]*const\s+rules\s*=\s*\{[\s\S]*const\s+wordCloud\s*=\s*\{/,
    "useKnowledgeViewConsole.ts must expose focused page, ingest, library, maintenance, rules, and word-cloud context groups",
  );
  assert.doesNotMatch(
    knowledgeViewConsoleText,
    /\.\.\.knowledgeDomainConsole\b|\.\.\.viewState\s*[,}]|\.\.\.knowledgeLibrary\s*[,}]/,
    "useKnowledgeViewConsole.ts must not re-expose full knowledge domain, view-state, or library controllers",
  );
  assert.doesNotMatch(
    knowledgeViewConsoleText,
    /knowledgeDomainConsole\.[A-Za-z_$]/,
    "useKnowledgeViewConsole.ts must consume grouped knowledge shell context instead of flat knowledgeDomainConsole fields",
  );
  assert.match(
    agentRetrievalShellContextText,
    /agentRetrievalShellPageKeys[\s\S]*agentRetrievalShellFormKeys[\s\S]*agentRetrievalShellTabKeys[\s\S]*agentRetrievalShellProgressKeys[\s\S]*agentRetrievalShellWorkspaceKeys[\s\S]*agentRetrievalShellTraceKeys[\s\S]*agentRetrievalShellAnswerKeys[\s\S]*AgentRetrievalShellContext[\s\S]*answer:[\s\S]*form:[\s\S]*page:[\s\S]*progress:[\s\S]*tabs:[\s\S]*trace:[\s\S]*workspace:/,
    "console-shell-agent-retrieval-context.ts must keep agent retrieval shell keys grouped by page, form, tabs, progress/history, workspace layout, trace, and answer responsibility",
  );
  assert.deepEqual(
    uniqueAgentRetrievalShellContextKeys.filter((key) => key === "agentExploreHistory"),
    [],
    "console-shell-agent-retrieval-context.ts must not expose raw agentExploreHistory when the view only needs projected history panel items",
  );
  assert.match(
    useDebugViewConsoleText,
    /const\s+agentRetrievalAnswer\s*=\s*\{[\s\S]*const\s+agentRetrievalForm\s*=\s*\{[\s\S]*const\s+agentRetrievalPage\s*=\s*\{[\s\S]*const\s+agentRetrievalProgress\s*=\s*\{[\s\S]*const\s+agentRetrievalTabs\s*=\s*\{[\s\S]*const\s+agentRetrievalTrace\s*=\s*\{[\s\S]*const\s+agentRetrievalWorkspace\s*=\s*\{/,
    "useDebugViewConsole.ts must expose focused agent retrieval context groups instead of flat agent-explore fields",
  );
  assert.doesNotMatch(
    useDebugViewConsoleText,
    /agentRetrievalConsole\.[A-Za-z_$]/,
    "useDebugViewConsole.ts must consume grouped agent retrieval shell context instead of flat agentRetrievalConsole fields",
  );
  assert.deepEqual(
    quotedKeysFromConstArray(agentRetrievalViewContextText, "agentRetrievalViewContextKeys"),
    [
      "agentRetrievalAnswer",
      "agentRetrievalForm",
      "agentRetrievalPage",
      "agentRetrievalProgress",
      "agentRetrievalTabs",
      "agentRetrievalTrace",
      "agentRetrievalWorkspace",
    ],
    "agentRetrievalViewContext.ts must only provide focused agent retrieval context groups",
  );
  [
    ["AgentRetrievalAnswerPanel.vue", agentRetrievalAnswerPanelText, "agentRetrievalAnswer"],
    ["AgentRetrievalDebugPanel.vue", agentRetrievalDebugPanelText, "agentRetrievalPage"],
    ["AgentRetrievalForm.vue", agentRetrievalFormText, "agentRetrievalForm"],
    ["AgentRetrievalProgressAndHistory.vue", agentRetrievalProgressAndHistoryText, "agentRetrievalProgress"],
    ["AgentRetrievalTabStrip.vue", agentRetrievalTabStripText, "agentRetrievalTabs"],
    ["AgentRetrievalTraceCard.vue", agentRetrievalTraceCardText, "agentRetrievalTrace"],
    ["AgentRetrievalWorkspace.vue", agentRetrievalWorkspaceText, "agentRetrievalWorkspace"],
  ].forEach(([fileName, text, contextGroup]) => {
    assert.match(
      text,
      new RegExp(`${contextGroup}\\s*:`),
      `${fileName} must consume its focused agent retrieval context group`,
    );
    assert.doesNotMatch(
      text,
      /const\s+\{\s*(agentExplore|busyKey|resetKnowledgeAgentExplore|runKnowledgeAgentExplore|selectedAgentExploreModel)\b[\s\S]*\}\s*=\s*useAgentRetrievalViewContext\s*\(\s*\)/,
      `${fileName} must not destructure flat fields directly from useAgentRetrievalViewContext()`,
    );
  });
  assert.match(
    knowledgeShellContextText,
    /knowledgeShellPageKeys[\s\S]*knowledgeShellViewStateKeys[\s\S]*knowledgeShellLibraryKeys[\s\S]*knowledgeShellIngestKeys[\s\S]*knowledgeShellMaintenanceKeys[\s\S]*knowledgeShellRulesKeys[\s\S]*knowledgeShellWordCloudKeys[\s\S]*libraryRuntime/,
    "console-shell-knowledge-context.ts must keep knowledge shell keys grouped by page, view-state, runtime library, ingest, maintenance, rules, and word-cloud responsibility",
  );
  assert.deepEqual(
    uniqueKnowledgeShellContextKeys.filter((key) =>
      [
        "currentView",
        "error",
        "filter",
        "fuseKnowledgeReview",
        "isAuthenticated",
        "knowledgeReviewItems",
        "knowledgeReviewRowClassName",
        "knowledgeReviewStatus",
        "knowledgeReviewStatusOptionBarOptions",
        "refreshKnowledgeConflicts",
        "resolveKnowledgeReview",
        "ruleAuthoringDraftPayload",
        "selectKnowledgeManagementPanel",
        "selectKnowledgeReviewItem",
        "selectedKnowledgeReviewFusionModel",
        "selectedKnowledgeReviewItem",
        "syncLocalSourceLabelFromPath",
      ].includes(key),
    ),
    [],
    "console-shell-knowledge-context.ts must not keep approval-flow, source-form, auth, global error, or unused management helpers",
  );
  assert.match(
    knowledgeViewContextText,
    /knowledgeIngestKey[\s\S]*knowledgeLibraryKey[\s\S]*knowledgeMaintenanceKey[\s\S]*knowledgeRulesKey[\s\S]*knowledgeWordCloudKey[\s\S]*useKnowledgeIngestContext[\s\S]*useKnowledgeWordCloudContext/,
    "knowledgeViewContext.ts must provide focused knowledge sub-context injections",
  );
  assert.doesNotMatch(
    knowledgeViewContextText,
    /useKnowledgeViewContext\s*\(/,
    "knowledgeViewContext.ts must not expose a broad all-fields knowledge view context",
  );
  assert.match(
    knowledgeViewText,
    /const\s+\{\s*page\s*\}\s*=\s*knowledgeView[\s\S]*\}\s*=\s*page;/,
    "KnowledgeView.vue must consume only the page context group directly",
  );
  assert.doesNotMatch(
    knowledgeViewText,
    /KnowledgeLibraryBoard/,
    "KnowledgeView.vue must not render the redundant knowledge-library summary above knowledge ingest",
  );
  assert.doesNotMatch(
    knowledgeIngestControllerText,
    /global:\s*true|Pact Native 知识库/,
    "console-knowledge-ingest-controller.ts must not default to a synthetic Pact Native ingest target",
  );
  assert.doesNotMatch(
    knowledgeIngestTargetControllerText,
    /value:\s*["']global["']|Pact Native 知识库/,
    "console-knowledge-ingest-target-controller.ts must only expose detected real knowledge spaces",
  );
  [
    ["KnowledgeIngestPanel.vue", knowledgeIngestPanelText, "useKnowledgeIngestContext"],
    ["KnowledgeLibraryBoard.vue", knowledgeLibraryBoardText, "useKnowledgeLibraryContext"],
    ["KnowledgeMaintenancePanel.vue", knowledgeMaintenancePanelText, "useKnowledgeMaintenanceContext"],
  ].forEach(([fileName, text, hook]) => {
    assert.match(text, new RegExp(`\\b${hook}\\s*\\(`), `${fileName} must use its focused knowledge context`);
    assert.doesNotMatch(
      text,
      /useKnowledgeViewContext\s*\(/,
      `${fileName} must not consume the broad knowledge view context`,
    );
  });
  [
    ["GoldenRulesPanel.vue", goldenRulesPanelText],
    ["ExpertVocabularyPanel.vue", expertVocabularyPanelText],
    ["RuleAuthoringPanel.vue", ruleAuthoringPanelText],
    ["RuleAuthoringResultPanel.vue", ruleAuthoringResultPanelText],
    ["EmailExpertRulesPanel.vue", emailExpertRulesPanelText],
  ].forEach(([fileName, text]) => {
    assert.match(text, /\buseKnowledgeRulesContext\s*\(/, `${fileName} must use the focused rules context`);
    assert.doesNotMatch(
      text,
      /useKnowledgeViewContext\s*\(/,
      `${fileName} must not consume the broad knowledge view context`,
    );
  });
  [
    ["WordCloudStage.vue", wordCloudStageText],
    ["WordCloudStageHeader.vue", wordCloudStageHeaderText],
    ["WordCloudCardList.vue", wordCloudCardListText],
    ["WordCloudClassCard.vue", wordCloudClassCardText],
    ["WordCloudCardBody.vue", wordCloudCardBodyText],
  ].forEach(([fileName, text]) => {
    assert.match(text, /\buseKnowledgeWordCloudContext\s*\(/, `${fileName} must use the focused word-cloud context`);
    assert.doesNotMatch(
      text,
      /useKnowledgeViewContext\s*\(/,
      `${fileName} must not consume the broad knowledge view context`,
    );
  });
  assert.ok(
    knowledgeLibraryControllerText.trimEnd().split(/\r?\n/).length <= 240,
    "console-knowledge-library-controller.ts must stay a focused backend connection and refresh coordinator",
  );
  assert.ok(
    knowledgeLibraryProjectionControllerText.trimEnd().split(/\r?\n/).length <= 220,
    "console-knowledge-library-projection-controller.ts must stay a focused knowledge-library projection boundary",
  );
  assert.ok(
    knowledgeIngestTargetControllerText.trimEnd().split(/\r?\n/).length <= 180,
    "console-knowledge-ingest-target-controller.ts must stay a focused ingest-target mapping boundary",
  );
  assert.match(
    knowledgeLibraryControllerText,
    /createConsoleKnowledgeLibraryProjectionController[\s\S]*createConsoleKnowledgeIngestTargetController/,
    "console-knowledge-library-controller.ts must delegate library projections and ingest-target mapping",
  );
  assert.doesNotMatch(
    knowledgeLibraryControllerText,
    /function\s+(?:textField|isContractFixtureKnowledgeSpace|externalProviderLabel|knowledgeLibraryDisplayTitle|knowledgeBackendSpaceDisplayName|knowledgeIngestExternalValue|parseKnowledgeIngestExternalValue|parseKnowledgeIngestExternalRef|metadataPolicyLabel|setKnowledgeIngestTargetValues)\b|const\s+(?:knowledgeBackendSpaces|realKnowledgeBackendSpaces|knowledgeIngestTargetOptions|knowledgeIngestTargetValues|knowledgeIngestTargetDisplaySummary|knowledgeLibraryCards|knowledgeBackendProviderCards)\s*=\s*computed/,
    "console-knowledge-library-controller.ts must not re-own card projections or ingest-target mapping",
  );
  assert.match(
    knowledgeLibraryProjectionControllerText,
    /isContractFixtureKnowledgeSpace[\s\S]*knowledgeLibraryCards[\s\S]*knowledgeBackendProviderCards/,
    "console-knowledge-library-projection-controller.ts must own library cards, backend provider cards, and fixture filtering",
  );
  assert.doesNotMatch(
    knowledgeLibraryProjectionControllerText,
    /connectKnowledgeBackend|listKnowledgeSpaces|knowledgeIngestTargets|usePageRefreshHandler/,
    "console-knowledge-library-projection-controller.ts must not own backend connection, fetching, ingest state, or page refresh",
  );
  assert.match(
    knowledgeIngestTargetControllerText,
    /knowledgeIngestExternalValue[\s\S]*parseKnowledgeIngestExternalValue[\s\S]*knowledgeIngestTargetValues/,
    "console-knowledge-ingest-target-controller.ts must own external ingest value parsing and selection mapping",
  );
  assert.doesNotMatch(
    knowledgeIngestTargetControllerText,
    /connectKnowledgeBackend|listKnowledgeSpaces|knowledgeLibraryCards|knowledgeBackendProviderCards|usePageRefreshHandler/,
    "console-knowledge-ingest-target-controller.ts must not own backend connection, fetching, card projections, or page refresh",
  );
  assert.doesNotMatch(
    knowledgeViewConsoleText,
    /from\s+["']vue["']|useRoute|knowledgeRouteTabToViewTab|const\s+dynamicParsingPreviewConfig|scrollDataAttributeElementIntoView|documentPreviewResult\s*=\s*ref|const\s+\{[\s\S]{500,}\}\s*=\s*knowledgeDomainConsole/,
    "useKnowledgeViewConsole.ts must not own Vue refs, route tab mapping, dynamic parsing preview state, DOM scrolling, or giant domain destructuring",
  );
  assert.match(
    knowledgeViewStateControllerText,
    /createConsoleKnowledgeViewStateController[\s\S]*activeKnowledgeTab[\s\S]*dynamicParsingPreviewConfig[\s\S]*documentPreviewResult[\s\S]*jumpToCloud/,
    "console-knowledge-view-state-controller.ts must own knowledge route tab, local expansion, dynamic parsing preview, and jump-to-cloud state",
  );
  assert.ok(
    knowledgeViewStateControllerText.trimEnd().split(/\r?\n/).length <= 140,
    "console-knowledge-view-state-controller.ts must stay a focused knowledge view-state boundary",
  );
  assert.doesNotMatch(
    infoFeedExecutionControllerText,
    /\bbridge\s*\.\s*(searchKnowledge|recordKnowledgeFeedback|callAgentGateway)\b/,
    "console-info-feed-execution-controller.ts must not call knowledge search/feedback or agent gateway through bridge",
  );
  assert.match(
    agentExploreClientText,
    /\/api\/knowledge\/agent-explore\/runs/,
    "agent-explore-client.ts must own knowledge agent exploration run endpoints",
  );
  assert.match(
    agentExploreClientText,
    /\/api\/agent-workspaces/,
    "agent-explore-client.ts must own agent workspace endpoints used by exploration history",
  );
  assert.match(
    bridgeText,
    /from\s+["']\.\/agent-explore-client["']/,
    "bridge.ts compatibility facade must re-export agent exploration behavior from the domain client",
  );
  assert.doesNotMatch(
    bridgeText,
    /\/api\/knowledge\/agent-explore|\/api\/agent-workspaces/,
    "bridge.ts must not own agent exploration run or workspace endpoints",
  );
  assert.match(
    workspacesClientText,
    /\/api\/agent-workspaces/,
    "workspaces-client.ts must own workspace endpoints used by the Workspaces page",
  );
  assert.match(
    workspacesClientText,
    /\/api\/agent-sessions/,
    "workspaces-client.ts must own workspace session endpoints used by the Workspaces page",
  );
  assert.match(
    workspacesClientText,
    /\/api\/workspace\/checkpoints/,
    "workspaces-client.ts must own workspace checkpoint endpoints used by the Workspaces page",
  );
  assert.match(
    workspacesClientText,
    /\/api\/external\/cloud-drive/,
    "workspaces-client.ts must own upstream cloud drive endpoints used by the Workspaces page",
  );
  assert.match(
    workspacesClientText,
    /\/api\/codespace/,
    "workspaces-client.ts must own Codespace endpoints used by the Workspaces page",
  );
  assert.match(
    useWorkspacesConsoleText,
    /from\s+["']\.\.\/lib\/workspaces-client["']/,
    "useWorkspacesConsole.ts must depend on the focused workspaces client",
  );
  assert.doesNotMatch(
    useWorkspacesConsoleText,
    /\/api\/(?:agent-workspaces|agent-sessions|workspace\/checkpoints|external\/cloud-drive|codespace)/,
    "useWorkspacesConsole.ts must not own workspace API endpoint strings directly",
  );
  assert.doesNotMatch(
    useWorkspacesConsoleText,
    /\bfetch\s*\(|RequestInit|Headers\s*\(|x-pact-csrf|csrfToken/,
    "useWorkspacesConsole.ts must not own raw HTTP or CSRF mechanics",
  );
  assert.match(
    useWorkspacesConsoleText,
    /useWorkspaceCloudDriveController/,
    "useWorkspacesConsole.ts must delegate Cloud Drive state/actions to the focused controller",
  );
  assert.match(
    workspaceCloudDriveControllerText,
    /export\s+function\s+useWorkspaceCloudDriveController\b/,
    "console-workspace-cloud-drive-controller.ts must expose the Cloud Drive controller boundary",
  );
  assert.match(
    workspaceCloudDriveControllerText,
    /from\s+["']\.\.\/lib\/workspaces-client["']/,
    "console-workspace-cloud-drive-controller.ts must use the focused workspaces client",
  );
  assert.doesNotMatch(
    useWorkspacesConsoleText,
    /workspacesClient\s*\.\s*(?:getWorkspaceCloudDriveStatus|connectWorkspaceCloudDrive|listWorkspaceCloudDriveItems|downloadWorkspaceCloudDriveFile|uploadWorkspaceCloudDriveFile|planWorkspaceCloudDriveSync|applyWorkspaceCloudDriveSync|listWorkspaceCloudDrivePermissions)\b|cloudDriveQuery|cloudDriveExposurePayload/,
    "useWorkspacesConsole.ts must not own Cloud Drive request assembly or workspaces client calls",
  );
  assert.ok(
    useWorkspacesConsoleText.split("\n").length <= 390,
    "useWorkspacesConsole.ts must stay below the workspace facade threshold after management workflow extraction",
  );
  assert.match(
    useWorkspacesConsoleText,
    /useWorkspaceManagementController/,
    "useWorkspacesConsole.ts must delegate create/profile/parent/share/delete workflows to the management controller",
  );
  [
    ["checkpoint", "useWorkspaceCheckpointController"],
    ["local directory", "useWorkspaceLocalDirectoryController"],
    ["codespace", "useWorkspaceCodespaceController"],
    ["session", "useWorkspaceSessionController"],
  ].forEach(([label, factoryName]) => {
    assert.match(
      useWorkspacesConsoleText,
      new RegExp(`${factoryName}\\b`),
      `useWorkspacesConsole.ts must delegate ${label} workflow state/actions to a focused controller`,
    );
  });
  [
    ["console-workspace-checkpoint-controller.ts", workspaceCheckpointControllerText, "useWorkspaceCheckpointController"],
    ["console-workspace-local-directory-controller.ts", workspaceLocalDirectoryControllerText, "useWorkspaceLocalDirectoryController"],
    ["console-workspace-codespace-controller.ts", workspaceCodespaceControllerText, "useWorkspaceCodespaceController"],
    ["console-workspace-session-controller.ts", workspaceSessionControllerText, "useWorkspaceSessionController"],
    ["console-workspace-management-controller.ts", workspaceManagementControllerText, "useWorkspaceManagementController"],
  ].forEach(([label, text, factoryName]) => {
    assert.match(
      text,
      new RegExp(`export\\s+function\\s+${factoryName}\\b`),
      `${label} must expose its workspace controller boundary`,
    );
    assert.match(
      text,
      /from\s+["']\.\.\/lib\/workspaces-client["']/,
      `${label} must use the focused workspaces client`,
    );
  });
  assert.doesNotMatch(
    useWorkspacesConsoleText,
    /workspacesClient\s*\.\s*(?:listWorkspaceCheckpointTrees|getWorkspaceCheckpointTree|previewWorkspaceCheckpointRestoreRequest|restoreWorkspaceCheckpointRequest|getWorkspaceSessionBundle|forkWorkspaceSession|connectWorkspaceLocalDirectory|syncWorkspaceLocalDirectory|inspectCodespaceRepositoryStatus|prepareCodespaceChangeRequest|uploadCodespaceChangeRequest)\b/,
    "useWorkspacesConsole.ts must not own checkpoint, session, local-directory, or Codespace client calls",
  );
  assert.doesNotMatch(
    useWorkspacesConsoleText,
    /workspacesClient\s*\.\s*(?:createWorkspace|deleteWorkspace|setWorkspaceParent|updateWorkspaceProfile|setWorkspaceSources|updateWorkspaceShare)\b/,
    "useWorkspacesConsole.ts must not own workspace management client calls",
  );
  assert.doesNotMatch(
    useWorkspacesConsoleText,
    /const\s+(?:workspaceCheckpointTrees|workspaceCheckpointDetail|workspaceCheckpointPreview|workspaceCheckpointError|selectedCheckpointTreeId|selectedCheckpointNodeId|localDirForm|codespaceForm|selectedSession|sessionContextData|createForm|profileForm|parentForm|shareForm|showDeleteModal|deleteFolderChecked)\s*=/,
    "useWorkspacesConsole.ts must not own extracted workspace workflow state refs/forms",
  );
  assert.match(
    workspaceCheckpointControllerText,
    /resetWorkspaceCheckpoints[\s\S]*loadWorkspaceCheckpoints[\s\S]*previewWorkspaceCheckpointRestore[\s\S]*restoreWorkspaceCheckpoint/,
    "checkpoint controller must own checkpoint reset, loading, preview, and restore workflow",
  );
  assert.match(
    workspaceLocalDirectoryControllerText,
    /localDirForm[\s\S]*connectLocalDirectory[\s\S]*syncLocalDirectory/,
    "local-directory controller must own local directory form, connect, and sync workflow",
  );
  assert.match(
    workspaceCodespaceControllerText,
    /codespaceForm[\s\S]*inspectCodespaceStatus[\s\S]*prepareCodespaceChange[\s\S]*uploadCodespaceChange/,
    "codespace controller must own Codespace form, inspection, prepare, and upload workflow",
  );
  assert.match(
    workspaceSessionControllerText,
    /sessionItems[\s\S]*selectSession[\s\S]*forkSession/,
    "workspace session controller must own session projection, selection, and fork workflow",
  );
  assert.match(
    workspaceManagementControllerText,
    /createForm[\s\S]*createWorkspace[\s\S]*deleteWorkspace[\s\S]*hotSwapProfile[\s\S]*shareOrUnshare/,
    "workspace management controller must own create, delete, profile, parent, and share workflows",
  );
  assert.ok(
    workspaceDetailPanelText.trimEnd().split(/\r?\n/).length <= 130,
    "WorkspaceDetailPanel.vue must stay a small workspace detail composition boundary",
  );
  assert.match(
    workspaceDetailPanelText,
    /WorkspaceCreatePanel[\s\S]*WorkspaceProfilePanel[\s\S]*WorkspaceParentPanel[\s\S]*WorkspaceSharePanel[\s\S]*WorkspaceLocalDirectoryPanel[\s\S]*WorkspaceCloudDrivePanel[\s\S]*WorkspaceCodespacePanel[\s\S]*WorkspaceExpandedDetail/,
    "WorkspaceDetailPanel.vue must compose the workspace detail form panels and expanded detail panel",
  );
  assert.doesNotMatch(
    workspaceDetailPanelText,
    /createForm|profileForm|parentForm|shareForm|localDirForm|codespaceForm|createWorkspace|hotSwapProfile|setParent|shareOrUnshare|connectLocalDirectory|inspectCodespaceStatus|prepareCodespaceChange|uploadCodespaceChange/,
    "WorkspaceDetailPanel.vue must not own create, profile, parent, share, local-directory, or Codespace form logic directly",
  );
  assert.ok(
    workspaceCreatePanelText.trimEnd().split(/\r?\n/).length <= 45,
    "WorkspaceCreatePanel.vue must stay focused on workspace creation",
  );
  assert.match(
    workspaceCreatePanelText,
    /createForm[\s\S]*createWorkspace[\s\S]*panel\s*=\s*'list'/,
    "WorkspaceCreatePanel.vue must own create-form rendering and submit/cancel actions",
  );
  assert.doesNotMatch(
    workspaceCreatePanelText,
    /profileForm|parentForm|shareForm|localDirForm|codespaceForm|hotSwapProfile|setParent|shareOrUnshare|connectLocalDirectory|inspectCodespaceStatus/,
    "WorkspaceCreatePanel.vue must not own non-create workspace workflows",
  );
  assert.ok(
    workspaceProfilePanelText.trimEnd().split(/\r?\n/).length <= 65,
    "WorkspaceProfilePanel.vue must stay focused on hot-swapping workspace profile fields",
  );
  assert.match(
    workspaceProfilePanelText,
    /selected[\s\S]*profileForm[\s\S]*hotSwapProfile[\s\S]*panel\s*=\s*'list'/,
    "WorkspaceProfilePanel.vue must own profile-form rendering and hot-swap/cancel actions",
  );
  assert.doesNotMatch(
    workspaceProfilePanelText,
    /createForm|parentForm|shareForm|localDirForm|codespaceForm|createWorkspace|setParent|shareOrUnshare|connectLocalDirectory|inspectCodespaceStatus/,
    "WorkspaceProfilePanel.vue must not own non-profile workspace workflows",
  );
  assert.ok(
    workspaceParentPanelText.trimEnd().split(/\r?\n/).length <= 60,
    "WorkspaceParentPanel.vue must stay focused on parent workspace inheritance",
  );
  assert.match(
    workspaceParentPanelText,
    /parentForm[\s\S]*workspaces[\s\S]*selectedId[\s\S]*setParent/,
    "WorkspaceParentPanel.vue must own parent form, candidate workspace list, and parent-save action",
  );
  assert.doesNotMatch(
    workspaceParentPanelText,
    /createForm|profileForm|shareForm|localDirForm|codespaceForm|createWorkspace|hotSwapProfile|shareOrUnshare|connectLocalDirectory|inspectCodespaceStatus/,
    "WorkspaceParentPanel.vue must not own non-parent workspace workflows",
  );
  assert.ok(
    workspaceSharePanelText.trimEnd().split(/\r?\n/).length <= 60,
    "WorkspaceSharePanel.vue must stay focused on workspace knowledge sharing",
  );
  assert.match(
    workspaceSharePanelText,
    /shareForm[\s\S]*shareOrUnshare[\s\S]*accessibleWorkspaceIds/,
    "WorkspaceSharePanel.vue must own share action selection, target input, current access list, and submit action",
  );
  assert.doesNotMatch(
    workspaceSharePanelText,
    /createForm|profileForm|parentForm|localDirForm|codespaceForm|createWorkspace|hotSwapProfile|setParent|connectLocalDirectory|inspectCodespaceStatus/,
    "WorkspaceSharePanel.vue must not own non-share workspace workflows",
  );
  assert.ok(
    workspaceLocalDirectoryPanelText.trimEnd().split(/\r?\n/).length <= 70,
    "WorkspaceLocalDirectoryPanel.vue must stay focused on local-directory connect and sync",
  );
  assert.match(
    workspaceLocalDirectoryPanelText,
    /localDirForm[\s\S]*connectLocalDirectory[\s\S]*localDirMountData[\s\S]*syncLocalDirectory/,
    "WorkspaceLocalDirectoryPanel.vue must own local-directory form, connected mounts, and sync actions",
  );
  assert.doesNotMatch(
    workspaceLocalDirectoryPanelText,
    /createForm|profileForm|parentForm|shareForm|codespaceForm|createWorkspace|hotSwapProfile|setParent|shareOrUnshare|inspectCodespaceStatus/,
    "WorkspaceLocalDirectoryPanel.vue must not own non-local-directory workspace workflows",
  );
  assert.ok(
    workspaceCodespacePanelText.trimEnd().split(/\r?\n/).length <= 75,
    "WorkspaceCodespacePanel.vue must stay focused on Codespace provider and ChangeSet workflow",
  );
  assert.match(
    workspaceCodespacePanelText,
    /codespaceForm[\s\S]*inspectCodespaceStatus[\s\S]*prepareCodespaceChange[\s\S]*uploadCodespaceChange[\s\S]*codespaceResult/,
    "WorkspaceCodespacePanel.vue must own Codespace form, inspect/prepare/upload actions, and result preview",
  );
  assert.doesNotMatch(
    workspaceCodespacePanelText,
    /createForm|profileForm|parentForm|shareForm|localDirForm|createWorkspace|hotSwapProfile|setParent|shareOrUnshare|connectLocalDirectory/,
    "WorkspaceCodespacePanel.vue must not own non-Codespace workspace workflows",
  );
  assert.match(
    agentExploreUtilsText,
    /export\s+\*\s+from\s+["']\.\/console-agent-explore-form-types["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-agent-explore-run-normalization["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-agent-explore-session-utils["'][\s\S]*export\s+\*\s+from\s+["']\.\/console-agent-explore-state-utils["']/,
    "console-agent-explore-utils.ts must re-export focused agent-explore utility owners",
  );
  assert.ok(
    agentExploreUtilsText.trimEnd().split(/\r?\n/).length <= 10,
    "console-agent-explore-utils.ts must stay a thin compatibility facade",
  );
  assert.doesNotMatch(
    agentExploreUtilsText,
    /function\s+|interface\s+AgentExploreFormState|BrowserStorageLike|readBrowserJsonStorage|writeBrowserJsonStorage|AGENT_EXPLORE_STORAGE_KEY|agentExplorePersistencePayloadCore|agentExploreFormFromPersistenceCore|boundedStorageIdList/,
    "console-agent-explore-utils.ts must not own implementations, browser persistence, or cache payload hydration",
  );
  assert.match(
    agentExploreFormTypesText,
    /interface\s+AgentExploreFormState[\s\S]*interface\s+AgentExploreFormDefaults/,
    "console-agent-explore-form-types.ts must own agent-explore form contracts",
  );
  assert.ok(
    agentExploreFormTypesText.trimEnd().split(/\r?\n/).length <= 40,
    "console-agent-explore-form-types.ts must stay a focused form contract module",
  );
  assert.doesNotMatch(
    agentExploreFormTypesText,
    /function\s+|from\s+["']/,
    "console-agent-explore-form-types.ts must not own implementations or runtime imports",
  );
  assert.match(
    agentExploreRunNormalizationText,
    /agentExploreRunStatus[\s\S]*normalizeAgentExploreRun/,
    "console-agent-explore-run-normalization.ts must own run status and response normalization",
  );
  assert.ok(
    agentExploreRunNormalizationText.trimEnd().split(/\r?\n/).length <= 50,
    "console-agent-explore-run-normalization.ts must stay a focused run normalization module",
  );
  assert.doesNotMatch(
    agentExploreRunNormalizationText,
    /AgentExploreSession|normalizeAgentExploreHistoryListCore|upsertAgentExploreHistoryCore|BrowserStorageLike/,
    "console-agent-explore-run-normalization.ts must not own session history, state transitions, or persistence",
  );
  assert.match(
    agentExploreSessionUtilsText,
    /isAgentExploreDraftSession[\s\S]*normalizeAgentExploreHistoryListCore[\s\S]*agentExploreSessionFromResultCore[\s\S]*createAgentExploreDraftSession[\s\S]*agentExploreFormFromSession[\s\S]*agentExploreSessionsFromWorkspaceDetailsCore/,
    "console-agent-explore-session-utils.ts must own session history normalization and result/form/session mapping",
  );
  assert.ok(
    agentExploreSessionUtilsText.trimEnd().split(/\r?\n/).length <= 220,
    "console-agent-explore-session-utils.ts must stay below the focused session-helper threshold",
  );
  assert.doesNotMatch(
    agentExploreSessionUtilsText,
    /clearInvalidAgentExploreModelReferencesCore|syncActiveAgentExploreDraftFromFormCore|upsertAgentExploreHistoryCore|removeAgentExploreSessionStateCore|closeAgentExploreTabStateCore|BrowserStorageLike/,
    "console-agent-explore-session-utils.ts must not own tab/history state transitions or persistence",
  );
  assert.match(
    agentExploreStateUtilsText,
    /clearInvalidAgentExploreModelReferencesCore[\s\S]*syncActiveAgentExploreDraftFromFormCore[\s\S]*upsertAgentExploreHistoryCore[\s\S]*removeAgentExploreSessionStateCore[\s\S]*closeAgentExploreTabStateCore/,
    "console-agent-explore-state-utils.ts must own pure tab/history state transitions",
  );
  assert.ok(
    agentExploreStateUtilsText.trimEnd().split(/\r?\n/).length <= 190,
    "console-agent-explore-state-utils.ts must stay below the focused state-transition threshold",
  );
  assert.doesNotMatch(
    agentExploreStateUtilsText,
    /normalizeAgentExploreRun|agentExploreSessionFromResultCore|agentExploreFormFromSession|agentExploreSessionsFromWorkspaceDetailsCore|BrowserStorageLike|readBrowserJsonStorage|writeBrowserJsonStorage/,
    "console-agent-explore-state-utils.ts must not own run normalization, session mapping, workspace extraction, or persistence",
  );
  assert.ok(
    agentExplorePersistenceText.trimEnd().split(/\r?\n/).length <= 140,
    "console-agent-explore-persistence.ts must stay a focused persistence adapter",
  );
  assert.match(
    agentExplorePersistenceText,
    /AGENT_EXPLORE_STORAGE_VERSION[\s\S]*readAgentExplorePersistence[\s\S]*writeAgentExplorePersistence[\s\S]*agentExplorePersistencePayloadCore[\s\S]*agentExploreFormFromPersistenceCore/,
    "console-agent-explore-persistence.ts must own versioned storage read/write plus payload/form hydration",
  );
  assert.match(
    agentExplorePersistenceText,
    /from\s+["']\.\.\/lib\/browser-storage["']/,
    "console-agent-explore-persistence.ts must use the shared browser-storage boundary",
  );
  assert.match(
    agentExploreHistoryControllerText,
    /from\s+["']\.\/console-agent-explore-persistence["']/,
    "console-agent-explore-history-controller.ts must delegate persistence read/write and hydrate helpers",
  );
  [
    ["console-agent-explore-session-controller.ts", agentExploreSessionControllerText],
    ["console-agent-explore-history-controller.ts", agentExploreHistoryControllerText],
    ["console-agent-explore-polling-controller.ts", agentExplorePollingControllerText],
  ].forEach(([label, text]) => {
    assert.doesNotMatch(
      text,
      /from\s+["']\.\.\/lib\/bridge["']/,
      `${label} must depend on agent-explore-client.ts, not the global bridge facade`,
    );
  });
  assert.doesNotMatch(
    infoFeedExecutionControllerText,
    /from\s+["']\.\.\/lib\/bridge["']/,
    "console-info-feed-execution-controller.ts must use focused clients instead of the global bridge facade",
  );

  console.log([
    "frontend architecture check passed:",
    `${allowedBridgeFiles.size} bridge boundary,`,
    `${allowedHtmlRenderFiles.size} safe-html boundary,`,
    `${allowedUseConsoleFiles.size} useConsole compatibility callers,`,
    "view/component API calls blocked,",
    "1 bridge-http boundary,",
    "30 domain API clients",
  ].join(" "));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
