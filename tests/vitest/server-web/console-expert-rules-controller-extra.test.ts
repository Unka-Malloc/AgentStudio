// @vitest-environment jsdom
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyExpertVocabulary } from "../../../server-web/composables/console-defaults";
import { createConsoleExpertEmailRulesController } from "../../../server-web/composables/console-expert-email-rules-controller";
import { createConsoleExpertVocabularyController } from "../../../server-web/composables/console-expert-vocabulary-controller";
import type { EmailRuleSet, ExpertVocabulary } from "../../../server-web/lib/types";

const knowledgeRulesClientMock = vi.hoisted(() => ({
  getEmailRules: vi.fn(),
  getExpertVocabulary: vi.fn(),
  saveEmailRules: vi.fn(),
  saveExpertVocabulary: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-rules-client", () => ({
  getEmailRules: knowledgeRulesClientMock.getEmailRules,
  getExpertVocabulary: knowledgeRulesClientMock.getExpertVocabulary,
  saveEmailRules: knowledgeRulesClientMock.saveEmailRules,
  saveExpertVocabulary: knowledgeRulesClientMock.saveExpertVocabulary,
}));

function makeEmailRules(overrides: Partial<EmailRuleSet> = {}): EmailRuleSet {
  return {
    schemaVersion: 1,
    updatedAt: "2026-06-04T00:00:00.000Z",
    reportSeries: [
      {
        id: "report-1",
        label: "财务日报",
        enabled: true,
        cadence: "weekly",
        keywords: ["finance", "daily"],
      },
    ],
    synonymDictionary: [
      {
        canonical: "付款",
        enabled: true,
        terms: ["支付", "打款"],
      },
    ],
    departmentDictionary: [
      {
        department: "财务",
        enabled: true,
        keywords: ["finance"],
        emailKeywords: ["billing"],
      },
    ],
    keywordStopwords: ["the", "and"],
    transactionMergeRules: {
      highSimilarity: 0.91,
      mediumSimilarity: 0.42,
      mediumParticipantOverlap: 0.35,
      highParticipantOverlap: 0.73,
    },
    ...overrides,
  };
}

function makeVocabularyEntry(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `v-${index}`,
    pathSegments: [`组${index}`, `子项${index}`],
    label: `词条 ${index}`,
    keywords: [`keyword-${index}`],
    domains: [`domain-${index}`],
    status: index % 3 === 0 ? "draft" : "active",
    notes: index === 2 ? "special note" : `note-${index}`,
    ...overrides,
  };
}

function makeVocabulary(overrides: Partial<ExpertVocabulary> = {}): ExpertVocabulary {
  return {
    ...emptyExpertVocabulary,
    schemaVersion: 1,
    version: 7,
    updatedAt: "2026-06-04T00:00:00.000Z",
    publishedAt: "",
    source: "seed",
    checksum: "checksum-1",
    entries: [],
    ...overrides,
  };
}

function createDraftUpdateHarness() {
  const error = ref("");
  const remoteDraftsActive = ref(false);
  const applyRemoteConsoleDraftUpdate = vi.fn((update: () => void) => {
    remoteDraftsActive.value = true;
    try {
      update();
    } finally {
      remoteDraftsActive.value = false;
    }
  });

  return {
    applyRemoteConsoleDraftUpdate,
    clearAllBusy: vi.fn(),
    error,
    isApplyingRemoteConsoleDrafts: () => remoteDraftsActive.value,
    refreshState: vi.fn().mockResolvedValue(undefined),
    setBusy: vi.fn(),
  };
}

function createEmailFixture() {
  const harness = createDraftUpdateHarness();
  const controller = createConsoleExpertEmailRulesController(harness);
  return {
    ...harness,
    controller,
  };
}

function createVocabularyFixture() {
  const harness = createDraftUpdateHarness();
  const controller = createConsoleExpertVocabularyController(harness);
  return {
    ...harness,
    controller,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  knowledgeRulesClientMock.getEmailRules.mockResolvedValue({
    rules: makeEmailRules(),
  });
  knowledgeRulesClientMock.getExpertVocabulary.mockResolvedValue({
    vocabulary: makeVocabulary(),
  });
  knowledgeRulesClientMock.saveEmailRules.mockResolvedValue({
    rules: makeEmailRules(),
  });
  knowledgeRulesClientMock.saveExpertVocabulary.mockResolvedValue({
    vocabulary: makeVocabulary(),
  });
});

describe("console expert email rules controller extra coverage", () => {
  it("parses fallback data, replaces server drafts, and respects dirty refresh guards", async () => {
    const { applyRemoteConsoleDraftUpdate, controller } = createEmailFixture();
    const remoteRules = makeEmailRules({
      reportSeries: [
        {
          id: "report-2",
          label: "销售周报",
          enabled: false,
          cadence: "monthly",
          keywords: ["sales"],
        },
      ],
      synonymDictionary: [
        {
          canonical: "收款",
          enabled: false,
          terms: ["到账", "入账"],
        },
      ],
      departmentDictionary: [
        {
          department: "销售",
          enabled: true,
          keywords: ["sales"],
          emailKeywords: ["invoice"],
        },
      ],
      keywordStopwords: ["only"],
    });

    controller.rulesText.value = "{";
    expect(controller.parseEmailRulesDraft()).toEqual({
      schemaVersion: 1,
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
    });
    expect(controller.emailReportSeriesRules.value).toEqual([]);
    expect(controller.emailSynonymRules.value).toEqual([]);
    expect(controller.emailDepartmentRules.value).toEqual([]);

    controller.replaceRulesDraftFromServer(remoteRules);
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);
    expect(controller.rulesDraftDirty.value).toBe(false);
    expect(controller.rulesText.value).toBe(JSON.stringify(remoteRules, null, 2));
    expect(controller.emailReportSeriesRules.value).toEqual([
      {
        rule: remoteRules.reportSeries[0],
        index: 0,
      },
    ]);
    expect(controller.emailSynonymRules.value).toEqual([
      {
        rule: remoteRules.synonymDictionary[0],
        index: 0,
      },
    ]);
    expect(controller.emailDepartmentRules.value).toEqual([
      {
        rule: remoteRules.departmentDictionary[0],
        index: 0,
      },
    ]);

    controller.replaceRulesDraftFromServer(remoteRules);
    expect(controller.rulesDraftDirty.value).toBe(false);
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);

    controller.rulesText.value = JSON.stringify(
      makeEmailRules({
        reportSeries: remoteRules.reportSeries,
        synonymDictionary: remoteRules.synonymDictionary,
        departmentDictionary: remoteRules.departmentDictionary,
        keywordStopwords: ["local"],
      }),
      null,
      2,
    );
    expect(controller.rulesDraftDirty.value).toBe(true);

    controller.replaceRulesDraftFromServer(
      makeEmailRules({
        reportSeries: remoteRules.reportSeries,
        synonymDictionary: remoteRules.synonymDictionary,
        departmentDictionary: remoteRules.departmentDictionary,
        keywordStopwords: ["local"],
      }),
      { markClean: false },
    );
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);
    expect(controller.rulesDraftDirty.value).toBe(true);

    await controller.loadEmailRules(false);
    expect(knowledgeRulesClientMock.getEmailRules).toHaveBeenCalledTimes(1);
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);

    await controller.loadEmailRules(true);
    expect(knowledgeRulesClientMock.getEmailRules).toHaveBeenCalledTimes(2);
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(2);
    expect(controller.rulesDraftDirty.value).toBe(false);
  });

  it("updates rule entries, saves drafts, and surfaces both backend and parse failures", async () => {
    const { clearAllBusy, controller, error, refreshState, setBusy } = createEmailFixture();
    controller.rulesText.value = JSON.stringify(makeEmailRules(), null, 2);
    controller.rulesDraftDirty.value = true;

    controller.setEmailRuleEntryEnabled("reportSeries", 0, false);
    expect(controller.emailRulesDraft.value.reportSeries[0]).toMatchObject({
      id: "report-1",
      label: "财务日报",
      enabled: false,
      cadence: "weekly",
      keywords: ["finance", "daily"],
    });

    controller.setEmailRuleEntryEnabled("synonymDictionary", 2, true);
    expect(controller.emailRulesDraft.value.synonymDictionary[2]).toEqual({
      enabled: true,
    });

    knowledgeRulesClientMock.saveEmailRules.mockResolvedValueOnce({
      rules: makeEmailRules(),
    });
    await controller.saveRules();

    expect(setBusy).toHaveBeenCalledWith("rules");
    expect(knowledgeRulesClientMock.saveEmailRules).toHaveBeenCalledWith(expect.objectContaining({
      reportSeries: expect.any(Array),
      synonymDictionary: expect.any(Array),
      departmentDictionary: expect.any(Array),
    }));
    expect(controller.rulesDraftDirty.value).toBe(false);
    expect(refreshState).toHaveBeenCalledWith({ forceDrafts: false });
    expect(clearAllBusy).not.toHaveBeenCalled();

    controller.rulesText.value = JSON.stringify(makeEmailRules({ keywordStopwords: ["local"] }), null, 2);
    controller.rulesDraftDirty.value = true;
    knowledgeRulesClientMock.saveEmailRules.mockRejectedValueOnce(new Error("save failed"));
    await controller.saveRules();
    expect(error.value).toBe("save failed");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);

    controller.rulesText.value = JSON.stringify(makeEmailRules({ keywordStopwords: ["local-2"] }), null, 2);
    controller.rulesDraftDirty.value = true;
    knowledgeRulesClientMock.saveEmailRules.mockRejectedValueOnce("bad json");
    await controller.saveRules();
    expect(error.value).toBe("保存规则库失败。");
    expect(clearAllBusy).toHaveBeenCalledTimes(2);
  });
});

describe("console expert vocabulary controller extra coverage", () => {
  it("clones and mutates vocabulary drafts, including search, add, delete and helper normalization", () => {
    const { applyRemoteConsoleDraftUpdate, controller } = createVocabularyFixture();
    const source = makeVocabulary({
      entries: Array.from({ length: 10 }, (_, index) =>
        makeVocabularyEntry(index, index === 2
          ? {
              pathSegments: ["知识", "检索"],
              label: "检索线索",
              keywords: ["needle"],
              domains: ["special-domain"],
              status: "retired",
              notes: "special note",
            }
          : undefined,
        ),
      ),
    });

    const cloned = controller.cloneExpertVocabulary(source);
    expect(cloned).not.toBe(source);
    expect(cloned.entries[2]).not.toBe(source.entries[2]);
    cloned.entries[2].keywords.push("changed");
    expect(source.entries[2].keywords).toEqual(["needle"]);
    expect(controller.vocabularyEntryPath(source.entries[2] as any)).toBe("知识/检索");
    expect(controller.splitVocabularyList("a, b，c\n d")).toEqual(["a", "b", "c", "d"]);

    controller.replaceExpertVocabularyDraftFromServer(null);
    expect(controller.expertVocabularyDraft.value.entries).toEqual([]);

    controller.replaceExpertVocabularyDraftFromServer(source);
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);
    expect(controller.expertVocabularyDraftDirty.value).toBe(false);
    const replacedEntry = controller.expertVocabularyDraft.value.entries[2];
    expect(controller.displayedVocabularyEntries.value).toHaveLength(8);
    expect(controller.hiddenVocabularyEntryCount.value).toBe(2);

    controller.vocabularySearch.value = "special";
    expect(controller.displayedVocabularyEntries.value).toEqual([
      {
        entry: replacedEntry,
        index: 2,
      },
    ]);
    expect(controller.hiddenVocabularyEntryCount.value).toBe(0);

    controller.vocabularySearch.value = "";
    controller.showAllVocabularyEntries.value = true;
    expect(controller.displayedVocabularyEntries.value).toHaveLength(10);
    expect(controller.hiddenVocabularyEntryCount.value).toBe(0);

    controller.updateVocabularyPath(2, " /新/路径 / 归档 ");
    controller.updateVocabularyKeywords(2, "alpha, beta，gamma\n delta");
    controller.updateVocabularyDomains(2, "domain-a, domain-b");
    controller.updateVocabularyEntry(2, { notes: "updated note" });
    controller.setVocabularyEntryEnabled(2, false);
    expect(controller.expertVocabularyDraft.value.entries[2]).toMatchObject({
      pathSegments: ["新", "路径", "归档"],
      keywords: ["alpha", "beta", "gamma", "delta"],
      domains: ["domain-a", "domain-b"],
      notes: "updated note",
      status: "retired",
    });
    expect(controller.expertVocabularyDraftDirty.value).toBe(true);

    controller.addVocabularyEntry();
    expect(controller.showAllVocabularyEntries.value).toBe(true);
    expect(controller.expertVocabularyDraft.value.entries.at(-1)).toMatchObject({
      id: expect.stringMatching(/^draft-\d+$/),
      pathSegments: ["未分类"],
      label: "新词条",
      keywords: [],
      domains: [],
      status: "draft",
      notes: "",
    });

    controller.deleteVocabularyEntry(0);
    expect(controller.expertVocabularyDraft.value.entries).toHaveLength(10);
  });

  it("loads and saves vocabulary drafts with dirty protection and error handling", async () => {
    const {
      applyRemoteConsoleDraftUpdate,
      clearAllBusy,
      controller,
      error,
      refreshState,
      setBusy,
    } = createVocabularyFixture();
    const freshRemote = makeVocabulary({
      entries: [makeVocabularyEntry(0)],
    });
    const forcedRemote = makeVocabulary({
      entries: [
        makeVocabularyEntry(1, {
          id: "v-forced",
          label: "强制刷新",
        }),
      ],
    });

    knowledgeRulesClientMock.getExpertVocabulary
      .mockResolvedValueOnce({ vocabulary: freshRemote })
      .mockResolvedValueOnce({ vocabulary: freshRemote })
      .mockResolvedValueOnce({ vocabulary: forcedRemote });

    await controller.loadExpertVocabulary(false);
    expect(knowledgeRulesClientMock.getExpertVocabulary).toHaveBeenCalledTimes(1);
    expect(controller.expertVocabularyDraft.value.entries).toHaveLength(1);
    expect(controller.expertVocabularyDraftDirty.value).toBe(false);

    controller.expertVocabularyDraft.value.entries[0].label = "本地修改";
    expect(controller.expertVocabularyDraftDirty.value).toBe(true);

    await controller.loadExpertVocabulary(false);
    expect(knowledgeRulesClientMock.getExpertVocabulary).toHaveBeenCalledTimes(2);
    expect(applyRemoteConsoleDraftUpdate).toHaveBeenCalledTimes(1);
    expect(controller.expertVocabularyDraft.value.entries[0].label).toBe("本地修改");

    await controller.loadExpertVocabulary(true);
    expect(knowledgeRulesClientMock.getExpertVocabulary).toHaveBeenCalledTimes(3);
    expect(controller.expertVocabularyDraft.value.entries[0].label).toBe("强制刷新");
    expect(controller.expertVocabularyDraftDirty.value).toBe(false);

    controller.expertVocabularyDraft.value = makeVocabulary({
      entries: [makeVocabularyEntry(7, { id: "v-save" })],
    });
    controller.expertVocabularyDraftDirty.value = true;

    await controller.saveExpertVocabulary();
    expect(setBusy).toHaveBeenCalledWith("expert-vocabulary");
    expect(knowledgeRulesClientMock.saveExpertVocabulary).toHaveBeenCalledWith(expect.objectContaining({
      entries: expect.arrayContaining([expect.objectContaining({ id: "v-save" })]),
    }));
    expect(refreshState).toHaveBeenCalledWith({ forceDrafts: false });
    expect(controller.expertVocabularyDraftDirty.value).toBe(false);
    expect(clearAllBusy).not.toHaveBeenCalled();

    controller.expertVocabularyDraft.value.entries[0].label = "重新脏";
    knowledgeRulesClientMock.saveExpertVocabulary.mockRejectedValueOnce("save failed");
    await controller.saveExpertVocabulary();
    expect(error.value).toBe("保存专家词汇库失败。");
    expect(clearAllBusy).toHaveBeenCalledTimes(1);

    controller.expertVocabularyDraft.value.entries[0].label = "再一次脏";
    knowledgeRulesClientMock.saveExpertVocabulary.mockRejectedValueOnce(new Error("save error"));
    await controller.saveExpertVocabulary();
    expect(error.value).toBe("save error");
    expect(clearAllBusy).toHaveBeenCalledTimes(2);
  });
});
