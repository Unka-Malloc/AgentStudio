import { type Ref } from "vue";
import { createConsoleExpertEmailRulesController } from "./console-expert-email-rules-controller";
import { createConsoleExpertVocabularyController } from "./console-expert-vocabulary-controller";
import { createConsoleGoldenRulesController } from "./console-golden-rules-controller";

type ConsoleExpertRulesControllerOptions = {
  applyRemoteConsoleDraftUpdate: (update: () => void) => void;
  clearAllBusy: () => void;
  error: Ref<string>;
  isApplyingRemoteConsoleDrafts: () => boolean;
  refreshState: (options?: { forceDrafts?: boolean }) => Promise<void>;
  setBusy: (key: string) => void;
};

export function createConsoleExpertRulesController(
  options: ConsoleExpertRulesControllerOptions,
) {
  const emailRules = createConsoleExpertEmailRulesController(options);
  const expertVocabulary = createConsoleExpertVocabularyController(options);
  const goldenRules = createConsoleGoldenRulesController({
    clearAllBusy: options.clearAllBusy,
    error: options.error,
    setBusy: options.setBusy,
  });

  async function refreshExpertRules(optionsForRefresh: { silent?: boolean; forceDrafts?: boolean } = {}) {
    const showBusy = !optionsForRefresh.silent;
    const forceDrafts = optionsForRefresh.forceDrafts === true;
    if (showBusy) {
      options.setBusy("expert-rules:refresh");
    }
    options.error.value = "";

    try {
      await Promise.all([
        emailRules.loadEmailRules(forceDrafts),
        expertVocabulary.loadExpertVocabulary(forceDrafts),
        goldenRules.loadGoldenRules(),
      ]);
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "加载专家规则失败。";
    } finally {
      if (showBusy) {
        options.clearAllBusy();
      }
    }
  }

  return {
    refreshExpertRules,
    ...emailRules,
    ...expertVocabulary,
    ...goldenRules,
  };
}
