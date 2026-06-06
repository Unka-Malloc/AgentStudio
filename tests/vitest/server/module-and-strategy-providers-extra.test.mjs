import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMountConfigPathMock = vi.hoisted(() => vi.fn());
const getMountConfigPathsMock = vi.hoisted(() => vi.fn());
const loadMountConfigMock = vi.hoisted(() => vi.fn());
const mergeMountRoutingMock = vi.hoisted(() => vi.fn());
const saveMountConfigMock = vi.hoisted(() => vi.fn());
const loadSettingsMock = vi.hoisted(() => vi.fn());
const saveSettingsMock = vi.hoisted(() => vi.fn());
const listModuleTemplatesMock = vi.hoisted(() => vi.fn());
const planModuleScaffoldMock = vi.hoisted(() => vi.fn());
const scaffoldModuleMock = vi.hoisted(() => vi.fn());
const runModuleContractTestMock = vi.hoisted(() => vi.fn());
const validateCapabilityPackageScaffoldManifestMock = vi.hoisted(() => vi.fn());
const runModelRoutingMock = vi.hoisted(() => vi.fn());
const inspectModelRoutingMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/module-manager/mount-config.mjs", () => ({
  getMountConfigPath: getMountConfigPathMock,
  getMountConfigPaths: getMountConfigPathsMock,
  loadMountConfig: loadMountConfigMock,
  mergeMountRouting: mergeMountRoutingMock,
  saveMountConfig: saveMountConfigMock
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock,
  saveSettings: saveSettingsMock
}));

vi.mock("../../../server/platform/common/module-manager/module-ecosystem/index.mjs", () => ({
  listModuleTemplates: listModuleTemplatesMock,
  planModuleScaffold: planModuleScaffoldMock,
  scaffoldModule: scaffoldModuleMock,
  runModuleContractTest: runModuleContractTestMock,
  validateCapabilityPackageScaffoldManifest: validateCapabilityPackageScaffoldManifestMock
}));

vi.mock("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs", () => ({
  runModelRouting: runModelRoutingMock,
  inspectModelRouting: inspectModelRoutingMock
}));

import {
  createModuleManagementProvider
} from "../../../server/platform/common/module-manager/module-management-provider.mjs";
import {
  STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION,
  STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
  STRATEGY_MANAGEMENT_MODEL_ROUTING_PROTOCOL_VERSION,
  createStrategyManagementProvider
} from "../../../server/platform/specialized/capabilities/strategy-management/strategy-management-provider.mjs";

function resetCommonMocks() {
  getMountConfigPathMock.mockImplementation((userDataPath = "") => path.join(userDataPath, "mount-modules.json"));
  getMountConfigPathsMock.mockImplementation((userDataPath = "") => ({
    modulesPath: path.join(userDataPath, "mount-modules.json"),
    routingPath: path.join(userDataPath, "mount-routing.json")
  }));
  loadMountConfigMock.mockResolvedValue({
    mountModules: {
      documentParser: "./saved-document-parser.mjs"
    },
    mountRouting: {
      kindRoutes: {
        document: { mountName: "documentParser", action: "extractDocument" }
      },
      extensionRoutes: {
        ".md": { mountName: "documentParser", action: "extractDocument" }
      },
      mediaTypeRoutes: {}
    }
  });
  mergeMountRoutingMock.mockImplementation((base = {}, patch = {}) => ({
    merged: true,
    base,
    patch
  }));
  saveMountConfigMock.mockImplementation(async (_userDataPath, value) => ({
    ...value,
    saved: true
  }));
  loadSettingsMock.mockResolvedValue({
    analysisModules: undefined,
    analysisModuleId: "analysis.current",
    runtimeProfile: "minimal"
  });
  saveSettingsMock.mockImplementation(async (_userDataPath, value) => value);
  listModuleTemplatesMock.mockReturnValue({
    protocolVersion: "pact.module-ecosystem.v1",
    templates: [{ templateId: "documentParser" }]
  });
  planModuleScaffoldMock.mockImplementation(async (input = {}, options = {}) => ({
    input,
    options,
    step: "plan"
  }));
  scaffoldModuleMock.mockImplementation(async (input = {}, options = {}) => ({
    input,
    options,
    step: "scaffold"
  }));
  runModuleContractTestMock.mockImplementation(async (input = {}, options = {}) => ({
    input,
    options,
    step: "contract-test"
  }));
  validateCapabilityPackageScaffoldManifestMock.mockImplementation((input = {}) => ({
    ok: true,
    input
  }));
  runModelRoutingMock.mockResolvedValue({
    result: { answer: "mocked routing result" },
    routing: { selectedAlias: "fallback" }
  });
  inspectModelRoutingMock.mockResolvedValue({
    protocolVersion: STRATEGY_MANAGEMENT_MODEL_ROUTING_PROTOCOL_VERSION,
    inspected: true
  });
}

function createModuleRuntime(overrides = {}) {
  const runtime = {
    runtimeOptions: {
      profile: "runtime-profile",
      cwd: "/workspace/runtime",
      mountModules: {
        analysis: "./analysis-runtime.mjs",
        documentParser: "./document-parser.mjs"
      },
      mountRouting: {
        kindRoutes: {
          document: { mountName: "documentParser", action: "extractDocument" }
        },
        extensionRoutes: {
          ".md": { mountName: "documentParser", action: "extractDocument" }
        },
        mediaTypeRoutes: {
          "text/markdown": { mountName: "documentParser", action: "extractDocument" }
        }
      },
      ...overrides.runtimeOptions
    },
    mountGeneration: overrides.mountGeneration ?? 7,
    mounts: {
      analysis: {
        id: "analysis-mount",
        kind: "analysis",
        enabled: true,
        reason: "",
        extractDocument: () => ({ ok: true })
      },
      broken: {
        id: "",
        kind: "",
        enabled: false,
        reason: "offline"
      },
      ...overrides.mounts
    },
    appliedConfigs: [],
    refreshedWith: null,
    createExecutionView: vi.fn(() => ({ view: "execution", mountGeneration: runtime.mountGeneration })),
    applyMountConfig: vi.fn(async (config, options = {}) => {
      runtime.appliedConfigs.push({ config, options });
      runtime.runtimeOptions = {
        ...runtime.runtimeOptions,
        ...config
      };
      runtime.mountGeneration += 1;
      return { ok: true, config };
    }),
    refreshMounts: vi.fn(async ({ settings } = {}) => {
      runtime.refreshedWith = settings || null;
      runtime.mountGeneration += 1;
      return { ok: true, settings };
    }),
    ...overrides
  };

  runtime.createExecutionView.mockImplementation(() => ({
    view: "execution",
    mountGeneration: runtime.mountGeneration
  }));

  return runtime;
}

function createToolPlatform({
  securityPermissions = null,
  tool = {
    id: "tool.demo",
    requiredScopes: ["knowledge:read"],
    toolsets: ["pact.knowledge.read"],
    safety: { risk: "read_only" }
  }
} = {}) {
  const appendedDecisions = [];
  return {
    registry: {
      getTool: vi.fn((toolId) => (toolId === tool.id ? tool : null)),
      listProfiles: vi.fn(() => [
        { id: "profile.default", toolsets: ["pact.knowledge.read"] }
      ])
    },
    store: {
      getRawGrant: vi.fn((grantId) => ({
        id: grantId,
        scopes: ["knowledge:read"],
        toolsets: ["pact.knowledge.read"]
      })),
      appendPolicyDecision: vi.fn((decision) => {
        appendedDecisions.push(decision);
      })
    },
    securityPermissions,
    appendedDecisions
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
  vi.clearAllMocks();
  resetCommonMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("module management provider extra coverage", () => {
  it("throws when runtime is missing", () => {
    expect(() => createModuleManagementProvider()).toThrow("module-management provider requires a server runtime.");
  });

  it("surfaces runtime, mount, and scaffold operations with normalized snapshots", async () => {
    const runtime = createModuleRuntime();
    const provider = createModuleManagementProvider({
      runtime,
      userDataPath: "/tmp/module-provider"
    });

    expect(provider.getRuntimeState()).toEqual({
      profile: "runtime-profile",
      cwd: "/workspace/runtime",
      mountGeneration: 7,
      mountModules: {
        analysis: "./analysis-runtime.mjs",
        documentParser: "./document-parser.mjs"
      },
      mountRouting: {
        kindRoutes: {
          document: { mountName: "documentParser", action: "extractDocument" }
        },
        extensionRoutes: {
          ".md": { mountName: "documentParser", action: "extractDocument" }
        },
        mediaTypeRoutes: {
          "text/markdown": { mountName: "documentParser", action: "extractDocument" }
        }
      }
    });
    expect(provider.getMountState()).toEqual({
      mountGeneration: 7,
      mountModules: {
        analysis: "./analysis-runtime.mjs",
        documentParser: "./document-parser.mjs"
      },
      mountRouting: {
        kindRoutes: {
          document: { mountName: "documentParser", action: "extractDocument" }
        },
        extensionRoutes: {
          ".md": { mountName: "documentParser", action: "extractDocument" }
        },
        mediaTypeRoutes: {
          "text/markdown": { mountName: "documentParser", action: "extractDocument" }
        }
      }
    });
    expect(provider.getMountConfigPath()).toBe("/tmp/module-provider/mount-modules.json");
    expect(provider.getMountConfigPaths()).toEqual({
      modulesPath: "/tmp/module-provider/mount-modules.json",
      routingPath: "/tmp/module-provider/mount-routing.json"
    });
    await expect(provider.getSavedMountConfig()).resolves.toEqual({
      mountModules: {
        documentParser: "./saved-document-parser.mjs"
      },
      mountRouting: {
        kindRoutes: {
          document: { mountName: "documentParser", action: "extractDocument" }
        },
        extensionRoutes: {
          ".md": { mountName: "documentParser", action: "extractDocument" }
        },
        mediaTypeRoutes: {}
      }
    });
    expect(provider.listMounts()).toEqual([
      {
        name: "analysis",
        id: "analysis-mount",
        kind: "analysis",
        enabled: true,
        reason: "",
        supportsStructuredDocument: true,
        supportsTextExtraction: false,
        supportsBatchHook: false
      },
      {
        name: "broken",
        id: "",
        kind: "broken",
        enabled: false,
        reason: "offline",
        supportsStructuredDocument: false,
        supportsTextExtraction: false,
        supportsBatchHook: false
      }
    ]);
    expect(provider.createExecutionView()).toEqual({ view: "execution", mountGeneration: 7 });

    const summaryWithoutAnalysis = await provider.buildRuntimeConsoleSummary({
      settings: { analysisModuleId: "analysis.current" },
      features: { activeFeatureIds: ["other-feature"] },
      listAvailableAnalysisModules: vi.fn()
    });
    expect(summaryWithoutAnalysis.analysisModules).toEqual([]);
    expect(summaryWithoutAnalysis.currentAnalysisModuleId).toBe("analysis.current");
    expect(summaryWithoutAnalysis.mountConfigPath).toBe("/tmp/module-provider/mount-modules.json");
    expect(summaryWithoutAnalysis.mountConfigPaths).toEqual({
      modulesPath: "/tmp/module-provider/mount-modules.json",
      routingPath: "/tmp/module-provider/mount-routing.json"
    });

    const listAvailableAnalysisModules = vi.fn().mockResolvedValue([
      { id: "analysis-text", label: "Text analysis" }
    ]);
    const summaryWithAnalysis = await provider.buildRuntimeConsoleSummary({
      settings: { analysisModuleId: "analysis.current" },
      features: { activeFeatureIds: ["analysis-runtime"] },
      listAvailableAnalysisModules
    });
    expect(listAvailableAnalysisModules).toHaveBeenCalledOnce();
    expect(listAvailableAnalysisModules).toHaveBeenCalledWith(runtime, { analysisModuleId: "analysis.current" });
    expect(summaryWithAnalysis.analysisModules).toEqual([
      { id: "analysis-text", label: "Text analysis" }
    ]);

    const snapshot = await provider.getMountsSnapshot({
      features: { activeFeatureIds: ["analysis-runtime"] },
      listAvailableAnalysisModules
    });
    expect(loadSettingsMock).toHaveBeenCalledWith("/tmp/module-provider", { redactSecrets: true });
    expect(loadMountConfigMock).toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      path: "/tmp/module-provider/mount-modules.json",
      paths: {
        modulesPath: "/tmp/module-provider/mount-modules.json",
        routingPath: "/tmp/module-provider/mount-routing.json"
      },
      value: {
        mountModules: {
          documentParser: "./saved-document-parser.mjs"
        }
      },
      runtime: {
        mountGeneration: 7,
        mounts: [
          {
            name: "analysis",
            id: "analysis-mount",
            kind: "analysis",
            enabled: true,
            reason: ""
          },
          {
            name: "broken",
            id: "",
            kind: "broken",
            enabled: false,
            reason: "offline"
          }
        ]
      },
      analysisModules: [
        { id: "analysis-text", label: "Text analysis" }
      ],
      currentAnalysisModuleId: "analysis.current"
    });

    const setResult = await provider.setMounts({
      value: {
        mountModules: {
          documentParser: "./next-document-parser.mjs",
          analysis: "./next-analysis.mjs"
        },
        mountRouting: {
          kindRoutes: {
            document: { mountName: "documentParser", action: "extractText" }
          },
          extensionRoutes: {
            ".txt": { mountName: "documentParser", action: "extractText" }
          }
        }
      }
    });
    const mountRoutingAfterSuccess = runtime.runtimeOptions.mountRouting;
    expect(mergeMountRoutingMock).toHaveBeenCalledWith(
      {
        kindRoutes: {
          document: { mountName: "documentParser", action: "extractDocument" }
        },
        extensionRoutes: {
          ".md": { mountName: "documentParser", action: "extractDocument" }
        },
        mediaTypeRoutes: {
          "text/markdown": { mountName: "documentParser", action: "extractDocument" }
        }
      },
      {
        kindRoutes: {
          document: { mountName: "documentParser", action: "extractText" }
        },
        extensionRoutes: {
          ".txt": { mountName: "documentParser", action: "extractText" }
        }
      }
    );
    expect(runtime.applyMountConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mountModules: {
          analysis: "./next-analysis.mjs",
          documentParser: "./next-document-parser.mjs"
        },
        mountRouting: expect.objectContaining({
          merged: true,
          patch: expect.objectContaining({
            kindRoutes: {
              document: { mountName: "documentParser", action: "extractText" }
            },
            extensionRoutes: {
              ".txt": { mountName: "documentParser", action: "extractText" }
            }
          })
        })
      }),
      {
        settings: {
          analysisModules: undefined,
          analysisModuleId: "analysis.current",
          runtimeProfile: "minimal"
        }
      }
    );
    expect(saveMountConfigMock).toHaveBeenCalledOnce();
    expect(setResult).toMatchObject({
      ok: true,
      path: "/tmp/module-provider/mount-modules.json",
      value: {
        mountModules: {
          analysis: "./next-analysis.mjs",
          documentParser: "./next-document-parser.mjs"
        },
        mountRouting: {
          merged: true
        },
        saved: true
      },
      runtime: {
        mountGeneration: 8
      }
    });

    loadMountConfigMock.mockResolvedValue({
      mountModules: {
        documentParser: "./current-document-parser.mjs"
      },
      mountRouting: {}
    });
    runtime.applyMountConfig.mockRejectedValueOnce(new Error("invalid mount patch"));
    const validationFailure = await provider.setMounts({
      value: {
        mountModules: { documentParser: "./broken.mjs" }
      }
    });
    expect(validationFailure).toEqual({
      ok: false,
      statusCode: 400,
      error: "invalid mount patch",
      value: {
        mountModules: {
          documentParser: "./current-document-parser.mjs"
        },
        mountRouting: {}
      },
      runtime: {
        mountGeneration: 8,
        mountModules: {
          analysis: "./next-analysis.mjs",
          documentParser: "./next-document-parser.mjs"
        },
        mountRouting: {
          kindRoutes: {},
          extensionRoutes: {},
          mediaTypeRoutes: {}
        }
      }
    });

    saveMountConfigMock.mockRejectedValueOnce(new Error("save failed"));
    runtime.applyMountConfig.mockResolvedValueOnce({ ok: true, config: { mountModules: {}, mountRouting: {} } });
    runtime.applyMountConfig.mockResolvedValueOnce({ ok: true, config: { mountModules: {}, mountRouting: {} } });
    loadMountConfigMock.mockResolvedValueOnce({
      mountModules: { documentParser: "./previous-document-parser.mjs" },
      mountRouting: {}
    });
    const persistenceFailure = await provider.setMounts({
      value: {
        mountModules: { documentParser: "./persist-failure.mjs" }
      }
    });
    expect(runtime.applyMountConfig).toHaveBeenNthCalledWith(2, {
      mountModules: {
        analysis: "./next-analysis.mjs",
        documentParser: "./broken.mjs"
      },
      mountRouting: {
        merged: true,
        base: mountRoutingAfterSuccess,
        patch: {}
      }
    }, {
      settings: {
        analysisModules: undefined,
        analysisModuleId: "analysis.current",
        runtimeProfile: "minimal"
      }
    });
    expect(runtime.applyMountConfig).toHaveBeenNthCalledWith(3, {
      mountModules: {
        analysis: "./next-analysis.mjs",
        documentParser: "./persist-failure.mjs"
      },
      mountRouting: {
        merged: true,
        base: mountRoutingAfterSuccess,
        patch: {}
      }
    }, {
      settings: {
        analysisModules: undefined,
        analysisModuleId: "analysis.current",
        runtimeProfile: "minimal"
      }
    });
    expect(runtime.applyMountConfig).toHaveBeenLastCalledWith({
      mountModules: {
        documentParser: "./previous-document-parser.mjs"
      },
      mountRouting: {}
    }, {
      settings: {
        analysisModules: undefined,
        analysisModuleId: "analysis.current",
        runtimeProfile: "minimal"
      }
    });
    expect(persistenceFailure).toEqual({
      ok: false,
      statusCode: 500,
      error: "save failed",
      value: {
        mountModules: {
          documentParser: "./previous-document-parser.mjs"
        },
        mountRouting: {}
      },
      runtime: {
        mountGeneration: 8,
        mountModules: {
          analysis: "./next-analysis.mjs",
          documentParser: "./next-document-parser.mjs"
        },
        mountRouting: {
          kindRoutes: {},
          extensionRoutes: {},
          mediaTypeRoutes: {}
        }
      }
    });

    loadSettingsMock.mockResolvedValueOnce({ runtimeProfile: "reload-profile" });
    loadMountConfigMock.mockResolvedValueOnce({
      mountModules: { documentParser: "./reloaded-document-parser.mjs" },
      mountRouting: {}
    });
    const reloadResult = await provider.reloadMounts({
      settings: {
        runtimeProfile: "saved-profile"
      }
    });
    expect(saveSettingsMock).toHaveBeenCalledWith("/tmp/module-provider", {
      runtimeProfile: "saved-profile"
    }, { redactSecrets: false });
    expect(reloadResult).toMatchObject({
      ok: true,
      path: "/tmp/module-provider/mount-modules.json",
      value: {
        mountModules: {
          documentParser: "./reloaded-document-parser.mjs"
        },
        mountRouting: {}
      },
      runtime: {
        mountGeneration: 9,
        mountModules: {
          documentParser: "./reloaded-document-parser.mjs"
        },
        mountRouting: {
          kindRoutes: {},
          extensionRoutes: {},
          mediaTypeRoutes: {}
        }
      }
    });

    runtime.applyMountConfig.mockRejectedValueOnce(new Error("reload failed"));
    const reloadFailure = await provider.reloadMounts();
    expect(reloadFailure).toEqual({
      ok: false,
      statusCode: 400,
      error: "reload failed",
      value: {
        mountModules: {
          documentParser: "./current-document-parser.mjs"
        },
        mountRouting: {}
      },
      mountGeneration: 9,
      mountModules: {
        documentParser: "./reloaded-document-parser.mjs"
      },
      mountRouting: {
        kindRoutes: {},
        extensionRoutes: {},
        mediaTypeRoutes: {}
      },
      runtime: {
        mountGeneration: 9,
        mountModules: {
          documentParser: "./reloaded-document-parser.mjs"
        },
        mountRouting: {
          kindRoutes: {},
          extensionRoutes: {},
          mediaTypeRoutes: {}
        }
      }
    });

    const refreshed = await provider.refreshMounts({ settings: { runtimeProfile: "refresh" } });
    expect(runtime.refreshMounts).toHaveBeenCalledWith({ settings: { runtimeProfile: "refresh" } });
    expect(refreshed).toEqual({ ok: true, settings: { runtimeProfile: "refresh" } });

    expect(provider.listModuleTemplates()).toEqual({
      protocolVersion: "pact.module-ecosystem.v1",
      templates: [{ templateId: "documentParser" }]
    });
    await expect(provider.planModuleScaffold({ templateId: "documentParser" })).resolves.toMatchObject({
      input: { templateId: "documentParser" },
      options: { userDataPath: "/tmp/module-provider" }
    });
    await expect(provider.scaffoldModule({ templateId: "documentParser" })).resolves.toMatchObject({
      input: { templateId: "documentParser" },
      options: { userDataPath: "/tmp/module-provider" }
    });
    await expect(provider.runModuleContractTest({ templateId: "documentParser" })).resolves.toMatchObject({
      input: { templateId: "documentParser" },
      options: { userDataPath: "/tmp/module-provider" }
    });
    expect(provider.validateCapabilityPackageScaffoldManifest({ name: "package-a" })).toEqual({
      ok: true,
      input: { name: "package-a" }
    });
  });
});

describe("strategy management provider extra coverage", () => {
  it("describes policies and falls back when the model decision runtime is absent", async () => {
    const provider = createStrategyManagementProvider({
      userDataPath: "/tmp/strategy-provider"
    });

    expect(provider.describe()).toEqual({
      schemaVersion: 1,
      protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      capabilities: [
        "workflow-policy.evaluate",
        "agent-policy.evaluate",
        "route-policy.evaluate",
        "model-routing.run",
        "model-routing.inspect",
        "model-decision.decide",
        "tool-policy.evaluate"
      ],
      delegatedProtocols: {
        modelRouting: STRATEGY_MANAGEMENT_MODEL_ROUTING_PROTOCOL_VERSION,
        modelDecision: STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION,
        toolPolicy: "pact.authorization.v1"
      }
    });
    expect(provider.shouldUseModelRouting({})).toBe(false);
    expect(provider.shouldUseModelRouting({ input: true })).toBe(false);
    expect(provider.shouldUseModelRouting({ modelRouting: { enabled: true } })).toBe(true);
    expect(provider.shouldUseModelRouting({ routing: { enabled: true } })).toBe(true);

    const workflowBlocked = provider.evaluateWorkflowPolicy({
      workflowId: "  workflow.blocked  ",
      stage: "  review  ",
      blocked: true,
      risk: " destructive "
    });
    expect(workflowBlocked).toMatchObject({
      schemaVersion: 1,
      protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: "workflow-policy",
      workflowId: "workflow.blocked",
      stage: "review",
      risk: "destructive",
      effect: "deny",
      reasonCode: "workflow_blocked",
      requiresApproval: false
    });

    const workflowConfirmation = provider.evaluateWorkflowPolicy({
      operationId: "operation-1",
      action: "  confirm  ",
      operation: { safety: { risk: "repair_write" } }
    });
    expect(workflowConfirmation).toMatchObject({
      workflowId: "operation-1",
      stage: "confirm",
      risk: "repair_write",
      effect: "require_confirmation",
      reasonCode: "workflow_confirmation_required",
      requiresApproval: true
    });

    const workflowAllow = provider.evaluateWorkflowPolicy({});
    expect(workflowAllow).toMatchObject({
      workflowId: "workflow.default",
      stage: "evaluate",
      risk: "read_only",
      effect: "allow",
      reasonCode: "workflow_allowed",
      requiresApproval: false
    });

    const agentPolicy = provider.evaluateAgentPolicy({
      routeId: "  route.alpha  ",
      agentId: "agent-alpha"
    });
    expect(agentPolicy).toMatchObject({
      schemaVersion: 1,
      protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: "agent-policy",
      roleId: "route.alpha",
      routeId: "route.alpha",
      effect: "allow",
      reasonCode: "agent_policy_allowed"
    });

    const decisionPort = provider.createModelDecisionRuntimePort();
    expect(decisionPort.protocolVersion).toBe(STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION);
    expect(decisionPort.describe()).toMatchObject({
      protocolVersion: STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION,
      strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      roles: []
    });

    const runtimeDecision = await decisionPort.decide({ roleId: "writer" });
    expect(runtimeDecision).toMatchObject({
      protocolVersion: STRATEGY_MANAGEMENT_MODEL_DECISION_PROTOCOL_VERSION,
      strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      usedModel: false,
      roleId: "writer",
      fallbackReason: "model_decision_runtime_unavailable",
      strategyPolicyDecision: {
        policyType: "agent-policy"
      }
    });

    await expect(provider.runModelRouting({
      input: {
        routeId: "route.model"
      },
      baseRunModelRouting: vi.fn(async (input) => ({
        result: { answer: "base" },
        routing: {
          protocolVersion: "custom.routing",
          selectedAlias: "base-alias",
          input
        }
      }))
    })).resolves.toMatchObject({
      result: { answer: "base" },
      routing: {
        protocolVersion: "custom.routing",
        selectedAlias: "base-alias",
        strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
        strategyPolicyDecision: {
          policyType: "agent-policy"
        }
      }
    });

    const routed = await provider.runModelRouting({
      input: {
        routeId: "route.mocked"
      }
    });
    expect(runModelRoutingMock).toHaveBeenCalledOnce();
    expect(runModelRoutingMock).toHaveBeenCalledWith({
      input: {
        routeId: "route.mocked"
      }
    });
    expect(routed).toEqual({
      result: { answer: "mocked routing result" },
      routing: {
        selectedAlias: "fallback",
        strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
        strategyPolicyDecision: {
          schemaVersion: 1,
          protocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
          policyType: "agent-policy",
          decisionId: expect.any(String),
          roleId: "route.mocked",
          routeId: "route.mocked",
          effect: "allow",
          reasonCode: "agent_policy_allowed",
          createdAt: "2026-06-05T00:00:00.000Z"
        }
      }
    });

    const inspection = await provider.inspectModelRouting({ limit: "12" });
    expect(inspectModelRoutingMock).toHaveBeenCalledWith({
      userDataPath: "/tmp/strategy-provider",
      limit: 12
    });
    expect(inspection).toEqual({
      protocolVersion: STRATEGY_MANAGEMENT_MODEL_ROUTING_PROTOCOL_VERSION,
      inspected: true
    });
  });

  it("evaluates tool policy with and without platform authorization hooks", () => {
    const allowPlatform = createToolPlatform({
      securityPermissions: {
        evaluatePolicy: vi.fn(() => ({
          effect: "allow",
          allowed: true,
          reasonCode: "approved",
          missingScopes: ["knowledge:read", "knowledge:read"],
          missingToolsets: ["pact.knowledge.read", "pact.knowledge.read"],
          evaluatedLayers: ["security_permissions", "security_permissions"],
          createdAt: "2026-06-05T00:00:00.000Z"
        }))
      }
    });
    const provider = createStrategyManagementProvider({
      getToolManagementPlatform: () => allowPlatform
    });

    const decision = provider.evaluateToolPolicy({
      toolId: "tool.demo",
      grantId: "grant-1",
      profileId: "profile.default"
    });
    expect(allowPlatform.registry.getTool).toHaveBeenCalledWith("tool.demo");
    expect(allowPlatform.store.getRawGrant).toHaveBeenCalledWith("grant-1");
    expect(allowPlatform.registry.listProfiles).toHaveBeenCalledOnce();
    expect(allowPlatform.securityPermissions.evaluatePolicy).toHaveBeenCalledOnce();
    expect(allowPlatform.appendedDecisions).toHaveLength(1);
    expect(decision).toMatchObject({
      effect: "allow",
      allowed: true,
      reasonCode: "approved",
      strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: "tool-policy",
      toolId: "tool.demo",
      grantId: "grant-1",
      evaluatedLayers: [
        "security_permissions",
        "platform_default",
        "server_policy",
        "grant_policy",
        "agent_profile_policy",
        "session_task_policy",
        "runtime_safety_policy",
        "strategy_management"
      ],
      missingScopes: [
        "knowledge:read"
      ],
      missingToolsets: []
    });

    const fallbackPlatform = createToolPlatform();
    const fallbackProvider = createStrategyManagementProvider({
      getToolManagementPlatform: () => fallbackPlatform
    });
    const fallbackDecision = fallbackProvider.evaluateToolPolicy({
      toolId: "missing-tool",
      grantId: "missing-grant",
      profileId: "missing-profile"
    });
    expect(fallbackDecision).toMatchObject({
      effect: "deny",
      allowed: false,
      strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      policyType: "tool-policy",
      toolId: "",
      grantId: "missing-grant",
      redactedReason: "Security permissions provider is unavailable.",
      missingScopes: [],
      missingToolsets: [],
      createdAt: "2026-06-05T00:00:00.000Z"
    });
    expect(fallbackPlatform.appendedDecisions).toHaveLength(1);

    const customEvaluate = provider.evaluateToolPolicy({
      toolId: "tool.demo",
      baseEvaluate: (normalized) => ({
        effect: "deny",
        allowed: false,
        policyType: "custom-tool-policy",
        evaluatedLayers: ["custom", "custom"],
        normalized
      })
    });
    expect(customEvaluate).toMatchObject({
      effect: "deny",
      allowed: false,
      policyType: "custom-tool-policy",
      strategyProtocolVersion: STRATEGY_MANAGEMENT_PROTOCOL_VERSION,
      evaluatedLayers: ["custom", "strategy_management"]
    });
  });
});
