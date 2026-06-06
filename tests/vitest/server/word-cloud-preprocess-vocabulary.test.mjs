import { describe, expect, it } from "vitest";
import { preprocessWordCloudVocabulary } from "../../../server/platform/specialized/knowledge/preprocessing/word-cloud/preprocess.mjs";

describe("word cloud vocabulary preprocess", () => {
  it("从提示词提取意图词并过滤无效词项、重复项及长度边界", () => {
    const result = preprocessWordCloudVocabulary({
      prompt: "请根据 广告 和 推广 做词云分组。把明显噪声去掉。",
      rawTerms: [
        { term: "广告", frequency: 12 },
        { term: "广告", frequency: 8 },
        { term: "ad", frequency: 5 },
        { term: "推广", frequency: 7 },
        { term: "$$$", frequency: 6 },
        { term: "a", frequency: 100 },
        { term: "x".repeat(70), frequency: 4 }
      ],
      termStats: [
        { term: "广告", frequency: 20, documentFrequency: 3, bm25Weight: 0.9 },
        { term: "ad", frequency: 6, documentFrequency: 1, bm25Weight: 0.3 },
        { term: "$$$", frequency: 6, documentFrequency: 0, bm25Weight: 0 }
      ],
      limit: 4,
      modelTermLimit: 3,
      minFrequency: 5
    });

    expect(result.ok).toBe(true);
    expect(result.intentTerms).toEqual(expect.arrayContaining(["广告", "推广"]));
    expect(result.summary.sourceCount).toBe(4);
    expect(result.summary.allCount).toBe(4);
    expect(result.allTerms).toHaveLength(4);
    expect(result.allTerms.map((item) => item.term)).toEqual(
      expect.arrayContaining(["广告", "ad", "$$$"])
    );
    expect(result.lowQualityTerms.map((item) => item.term)).toEqual(
      expect.arrayContaining(["$$$"])
    );
    expect(result.targetTerms.length).toBeGreaterThan(0);
    expect(result.summary.modelCount).toBe(3);
    expect(result.summary.limitApplied).toBe(4);
  });

  it("在高频过滤和边界参数下返回空结果且保持可验证字段", () => {
    const result = preprocessWordCloudVocabulary({
      prompt: "",
      rawTerms: [
        { term: "alpha", frequency: 1 },
        { term: "beta", frequency: 3 },
        { term: "gamma", frequency: 4 }
      ],
      termStats: [
        { term: "alpha", frequency: 1, documentFrequency: 1, bm25Weight: 0.1 },
        { term: "beta", frequency: 2, documentFrequency: 1, bm25Weight: 0.1 },
        { term: "gamma", frequency: 3, documentFrequency: 1, bm25Weight: 0.1 }
      ],
      limit: 0,
      modelTermLimit: 0,
      minFrequency: 10
    });

    expect(result.ok).toBe(true);
    expect(result.summary.limitApplied).toBe(120000);
    expect(result.summary.sourceCount).toBe(0);
    expect(result.summary.allCount).toBe(0);
    expect(result.summary.modelCount).toBe(0);
    expect(result.targetTerms).toEqual([]);
    expect(result.lowQualityTerms).toEqual([]);
  });
});
