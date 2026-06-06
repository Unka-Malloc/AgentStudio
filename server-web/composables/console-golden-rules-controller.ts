import { computed, ref, type Ref } from "vue";
import {
  getGoldenRules,
  publishGoldenRules,
  saveGoldenRules,
} from "../lib/knowledge-rules-client";
import { asRecord } from "./console-model-utils";

type ConsoleGoldenRulesControllerOptions = {
  clearAllBusy: () => void;
  error: Ref<string>;
  setBusy: (key: string) => void;
};

export function createConsoleGoldenRulesController(
  options: ConsoleGoldenRulesControllerOptions,
) {
  const goldenRulesState = ref<Record<string, unknown> | null>(null);

  const goldenRulePackages = computed(() => {
    const state = asRecord(goldenRulesState.value) || {};
    const packages = Array.isArray(state.packages) ? state.packages : [];
    return packages
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  });

  function expertRuleEnabled(value: unknown) {
    return (asRecord(value)?.enabled as boolean | undefined) !== false;
  }

  function goldenRulePackageTitle(pkg: Record<string, unknown>) {
    return `${String(pkg.packageId || "golden-rules")} v${String(pkg.version || "0")}`;
  }

  function goldenRuleItems(pkg: Record<string, unknown>) {
    return (Array.isArray(pkg.rules) ? pkg.rules : [])
      .map((rule, index) => ({
        rule: asRecord(rule) || {},
        index,
      }));
  }

  async function loadGoldenRules() {
    goldenRulesState.value = await getGoldenRules();
  }

  async function toggleGoldenRuleEnabled(pkg: Record<string, unknown>, ruleIndex: number, enabled: boolean) {
    const packageId = String(pkg.packageId || "");
    if (!packageId) {
      return;
    }
    options.setBusy(`golden-rule:${packageId}:${ruleIndex}`);
    options.error.value = "";

    try {
      const nextRules = goldenRuleItems(pkg).map(({ rule, index }) =>
        index === ruleIndex
          ? {
              ...rule,
              enabled,
            }
          : rule,
      );
      const saved = await saveGoldenRules({
        ...pkg,
        version: undefined,
        status: "draft",
        rules: nextRules,
      });
      const savedPackage = asRecord(saved.package) || {};
      await publishGoldenRules(packageId, {
        version: Number(savedPackage.version || 0),
      });
      await loadGoldenRules();
    } catch (nextError) {
      options.error.value = nextError instanceof Error ? nextError.message : "更新黄金规则失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  return {
    expertRuleEnabled,
    goldenRuleItems,
    goldenRulePackageTitle,
    goldenRulePackages,
    goldenRulesState,
    loadGoldenRules,
    toggleGoldenRuleEnabled,
  };
}
