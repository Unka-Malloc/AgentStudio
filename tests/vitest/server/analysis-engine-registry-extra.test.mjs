import { beforeEach, describe, expect, it, vi } from "vitest";

const runEmailAnalysisMock = vi.hoisted(() => vi.fn(() => ({ builtin: true })));

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/rules/email-analysis.mjs", () => ({
  runEmailAnalysis: runEmailAnalysisMock
}));

const {
  listAvailableAnalysisModules,
  runConfiguredAnalysisModule
} = await import("../../../server/platform/specialized/knowledge/preprocessing/analysis-engine-registry.mjs");

beforeEach(() => {
  runEmailAnalysisMock.mockClear();
});

describe("analysis engine registry", () => {
  it("lists builtin and normalized external modules from listModules", async () => {
    const mount = {
      id: "analysis-mount",
      reload: vi.fn(async () => null),
      listModules: vi.fn(async () => [
        {
          id: " external.one ",
          label: "",
          description: " First ",
          mode: "remote"
        },
        {
          id: "",
          label: "ignored"
        }
      ])
    };

    const modules = await listAvailableAnalysisModules({ mounts: { analysis: mount } }, { mirror: true });

    expect(mount.reload).toHaveBeenCalledWith({ settings: { mirror: true } });
    expect(modules).toEqual([
      expect.objectContaining({
        id: "builtin:heuristic-hybrid-v1",
        executionMode: "hybrid"
      }),
      {
        id: "external.one",
        label: "external.one",
        description: "First",
        executionMode: "remote"
      }
    ]);
  });

  it("falls back to builtin analysis when external mount is absent or disabled", async () => {
    const result = await runConfiguredAnalysisModule({
      runtime: { mounts: { analysis: { enabled: false } } },
      sources: [{ id: "source-1" }],
      chunks: [{ id: "chunk-1" }],
      settings: { analysisModuleId: "unknown-external" },
      generatedAt: "2026-06-05T00:00:00.000Z",
      rules: { keywordStopwords: ["the"] }
    });

    expect(runEmailAnalysisMock).toHaveBeenCalledWith({
      sources: [{ id: "source-1" }],
      chunks: [{ id: "chunk-1" }],
      settings: { analysisModuleId: "unknown-external" },
      generatedAt: "2026-06-05T00:00:00.000Z",
      rules: { keywordStopwords: ["the"] }
    });
    expect(result).toEqual({
      analysis: { builtin: true },
      runtimeInfo: {
        moduleId: "builtin:heuristic-hybrid-v1",
        moduleLabel: "Heuristic Hybrid v1",
        moduleSource: "builtin",
        executionMode: "hybrid"
      }
    });
  });

  it("runs configured external modules through runModule", async () => {
    const mount = {
      id: "external-runtime",
      reload: vi.fn(async () => null),
      listAlgorithms: vi.fn(async () => [
        {
          id: "external.selected",
          label: "Selected External",
          executionMode: "batch"
        }
      ]),
      runModule: vi.fn(async (input) => ({ ok: true, moduleId: input.moduleId }))
    };

    const result = await runConfiguredAnalysisModule({
      runtime: { mounts: { analysis: mount } },
      sources: [{ id: "source-1" }],
      chunks: [],
      settings: { analysisAlgorithmId: "external.selected" },
      generatedAt: "2026-06-05T01:00:00.000Z",
      rules: {}
    });

    expect(mount.listAlgorithms).toHaveBeenCalledWith({ settings: { analysisAlgorithmId: "external.selected" } });
    expect(mount.runModule).toHaveBeenCalledWith(expect.objectContaining({
      moduleId: "external.selected",
      sources: [{ id: "source-1" }],
      generatedAt: "2026-06-05T01:00:00.000Z"
    }));
    expect(result).toEqual({
      analysis: { ok: true, moduleId: "external.selected" },
      runtimeInfo: {
        moduleId: "external.selected",
        moduleLabel: "Selected External",
        moduleSource: "external-runtime",
        executionMode: "batch"
      }
    });
  });

  it("uses external fallback ids, validates output shape, and rejects unavailable modules", async () => {
    const fallbackMount = {
      id: "fallback-runtime",
      defaultAlgorithmId: "default.algorithm",
      algorithm: {
        id: "other.algorithm",
        label: "Other Algorithm"
      },
      runAnalysis: vi.fn(async (input) => ({ selected: input.algorithmId }))
    };

    const fallback = await runConfiguredAnalysisModule({
      runtime: { mounts: { analysis: fallbackMount } },
      sources: [],
      chunks: [],
      settings: { analysisModuleId: "missing.algorithm" },
      generatedAt: "2026-06-05T02:00:00.000Z",
      rules: {}
    });

    expect(fallbackMount.runAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      algorithmId: "other.algorithm",
      moduleId: "other.algorithm"
    }));
    expect(fallback.runtimeInfo).toEqual({
      moduleId: "other.algorithm",
      moduleLabel: "Other Algorithm",
      moduleSource: "fallback-runtime",
      executionMode: "custom"
    });

    await expect(runConfiguredAnalysisModule({
      runtime: { mounts: { analysis: {} } },
      sources: [],
      chunks: [],
      settings: { analysisModuleId: "missing" },
      generatedAt: "2026-06-05T02:00:00.000Z",
      rules: {}
    })).rejects.toThrow("分析模块不可用：missing");

    await expect(runConfiguredAnalysisModule({
      runtime: { mounts: { analysis: { id: "bad-runner", module: { id: "bad" } } } },
      sources: [],
      chunks: [],
      settings: { analysisModuleId: "bad" },
      generatedAt: "2026-06-05T02:00:00.000Z",
      rules: {}
    })).rejects.toThrow("分析模块不可执行：bad");

    await expect(runConfiguredAnalysisModule({
      runtime: {
        mounts: {
          analysis: {
            id: "bad-output",
            module: { id: "bad-output" },
            runModule: vi.fn(async () => null)
          }
        }
      },
      sources: [],
      chunks: [],
      settings: { analysisModuleId: "bad-output" },
      generatedAt: "2026-06-05T02:00:00.000Z",
      rules: {}
    })).rejects.toThrow("分析模块返回结果无效：bad-output");
  });
});
