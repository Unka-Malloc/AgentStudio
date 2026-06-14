import { computed, ref, watch, type Ref } from "vue";
import { getEmailRules, saveEmailRules } from "../lib/knowledge-rules-client";
import type { EmailRuleSet } from "../lib/types";
import { asRecord } from "./console-model-utils";

type ConsoleExpertEmailRulesControllerOptions = {
  applyRemoteConsoleDraftUpdate: (update: () => void) => void;
  clearAllBusy: () => void;
  error: Ref<string>;
  isApplyingRemoteConsoleDrafts: () => boolean;
  refreshState: (options?: { forceDrafts?: boolean }) => Promise<void>;
  setBusy: (key: string) => void;
};

function parseFallbackEmailRules(): EmailRuleSet {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt: "",
    reportSeries: [],
    synonymDictionary: [],
    departmentDictionary: [],
    keywordStopwords: [],
    transactionMergeRules: {
      highSimilarity: 0.32,
      mediumSimilarity: 0.18,
      mediumParticipantOverlap: 0.34,
      highParticipantOverlap: 0.6,
    },
  };
}

export function createConsoleExpertEmailRulesController(
  options: ConsoleExpertEmailRulesControllerOptions,
) {
  const rulesText = ref("");
  const rulesDraftDirty = ref(false);

  watch(
    rulesText,
    () => {
      if (!options.isApplyingRemoteConsoleDrafts()) {
        rulesDraftDirty.value = true;
      }
    },
    { flush: "sync" },
  );

  function replaceRulesDraftFromServer(
    rules: EmailRuleSet,
    optionsForReplace: { markClean?: boolean } = {},
  ) {
    const nextText = JSON.stringify(rules, null, 2);
    if (rulesText.value === nextText) {
      if (optionsForReplace.markClean !== false) {
        rulesDraftDirty.value = false;
      }
      return;
    }
    options.applyRemoteConsoleDraftUpdate(() => {
      rulesText.value = nextText;
      if (optionsForReplace.markClean !== false) {
        rulesDraftDirty.value = false;
      }
    });
  }

  function parseEmailRulesDraft(): EmailRuleSet {
    try {
      return JSON.parse(rulesText.value || "{}") as EmailRuleSet;
    } catch {
      return parseFallbackEmailRules();
    }
  }

  const emailRulesDraft = computed(() => parseEmailRulesDraft());
  const emailReportSeriesRules = computed(() =>
    (emailRulesDraft.value.reportSeries || []).map((rule, index) => ({ rule, index })),
  );
  const emailSynonymRules = computed(() =>
    (emailRulesDraft.value.synonymDictionary || []).map((rule, index) => ({ rule, index })),
  );
  const emailDepartmentRules = computed(() =>
    (emailRulesDraft.value.departmentDictionary || []).map((rule, index) => ({ rule, index })),
  );

  function setEmailRuleEntryEnabled(
    collection: "reportSeries" | "synonymDictionary" | "departmentDictionary",
    index: number,
    enabled: boolean,
  ) {
    const rules = parseEmailRulesDraft() as EmailRuleSet & Record<string, unknown>;
    const list = Array.isArray(rules[collection]) ? [...(rules[collection] as unknown[])] : [];
    const current = asRecord(list[index]) || {};
    list[index] = {
      ...current,
      enabled,
    };
    (rules as unknown as Record<string, unknown[]>)[collection] = list;
    rulesText.value = JSON.stringify(rules, null, 2);
  }

  async function loadEmailRules(forceDrafts: boolean) {
    const emailRulesResult = await getEmailRules();
    if (forceDrafts || !rulesDraftDirty.value) {
      replaceRulesDraftFromServer(emailRulesResult.rules);
    }
  }

  async function saveRules() {
    options.setBusy("rules");
    options.error.value = "";

    try {
      await saveEmailRules(JSON.parse(rulesText.value) as EmailRuleSet);
      rulesDraftDirty.value = false;
      await options.refreshState({ forceDrafts: false });
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "保存规则库失败。";
      options.clearAllBusy();
    }
  }

  return {
    emailDepartmentRules,
    emailReportSeriesRules,
    emailRulesDraft,
    emailSynonymRules,
    loadEmailRules,
    parseEmailRulesDraft,
    replaceRulesDraftFromServer,
    rulesDraftDirty,
    rulesText,
    saveRules,
    setEmailRuleEntryEnabled,
  };
}
