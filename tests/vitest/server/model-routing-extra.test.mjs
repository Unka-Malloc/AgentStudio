import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  MODEL_ROUTING_PROTOCOL_VERSION,
  inspectModelRouting,
  normalizeModelRoutingPolicy,
  readModelRoutingState,
  runModelRouting,
  shouldUseModelRouting
} from "../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs";

async function withTempUserData(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-model-routing-extra-"));
  try {
    await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

describe("model routing policy normalization", () => {
  it("detects routing usage and normalizes policy inputs", () => {
    expect(shouldUseModelRouting()).toBe(false);
    expect(shouldUseModelRouting({ modelRouting: { fallbackChain: ["primary"] } })).toBe(true);
    expect(shouldUseModelRouting({}, { modelRouting: { enabled: true } })).toBe(true);

    const policy = normalizeModelRoutingPolicy({
      settings: {
        modelRouting: {
          fallbackAliases: [" secondary ", " primary "],
          maxAttempts: "2",
          budget: {
            maxInputTokens: "12",
            maxOutputTokens: "18",
            maxEstimatedTotalTokens: "30",
            maxEstimatedUsd: "1.25",
            currency: " cny "
          },
          rateLimit: {
            windowMs: "1500",
            maxCalls: "4"
          },
          circuitBreaker: {
            failureThreshold: "5",
            openMs: "4500"
          },
          metadata: {
            scope: "unit"
          }
        }
      },
      input: {
        modelRouting: {
          enabled: true
        },
        modelAlias: " primary ",
        routeId: " route-17 ",
        userId: " user-7 ",
        workspaceId: " ws-9 ",
        promptVersion: " v3 "
      },
      defaultAlias: " backup "
    });

    expect(policy).toMatchObject({
      protocolVersion: MODEL_ROUTING_PROTOCOL_VERSION,
      enabled: true,
      routeId: "route-17",
      subjectId: "user-7",
      workspaceId: "ws-9",
      promptVersion: "v3",
      fallbackChain: ["primary", "secondary"],
      budget: {
        maxInputTokens: 12,
        maxOutputTokens: 18,
        maxEstimatedTotalTokens: 30,
        maxEstimatedUsd: 1.25,
        currency: "cny"
      },
      rateLimit: {
        windowMs: 1500,
        maxCalls: 4
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        openMs: 4500
      },
      metadata: {
        scope: "unit"
      }
    });

    const circuitDisabled = normalizeModelRoutingPolicy({
      settings: {
        modelRouting: {
          circuitBreaker: false
        }
      },
      input: {}
    });

    expect(circuitDisabled.circuitBreaker).toEqual({
      enabled: false,
      failureThreshold: 2,
      openMs: 60000
    });
  });
});

describe("model routing storage reads", () => {
  it("reads missing state and ledger files as an empty snapshot", async () => {
    await withTempUserData(async (userDataPath) => {
      const state = await readModelRoutingState({ userDataPath });
      expect(state).toEqual({
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: MODEL_ROUTING_PROTOCOL_VERSION,
        updatedAt: "",
        circuits: {}
      });

      const snapshot = await inspectModelRouting({ userDataPath, limit: 5 });
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot.protocolVersion).toBe(MODEL_ROUTING_PROTOCOL_VERSION);
      expect(snapshot.state).toEqual(state);
      expect(snapshot.statePath).toBe("state/model-routing-state.json");
      expect(snapshot.ledgerPath).toBe("logs/model-routing-ledger.jsonl");
      expect(snapshot.ledgerSummary).toEqual({
        total: 0,
        byStatus: {},
        byAlias: {},
        estimatedUsdTotal: 0
      });
      expect(snapshot.recentLedger).toEqual([]);
    });
  });
});

describe("model routing execution", () => {
  it("skips a budget-violating candidate and falls back to the next candidate", async () => {
    await withTempUserData(async (userDataPath) => {
      const executeCandidate = vi.fn(async ({ alias, dryRun }) => {
        if (dryRun) {
          return {
            config: {
              alias,
              provider: "custom-http",
              model: `${alias}-model`,
              engine: `${alias}-engine`
            }
          };
        }

        return {
          config: {
            alias,
            provider: "custom-http",
            model: `${alias}-model`,
            engine: `${alias}-engine`
          },
          result: {
            ok: true,
            answer: `${alias}-answer`,
            usage: {
              prompt_tokens: 4,
              completion_tokens: 2,
              total_tokens: 6
            },
            upstream: {
              provider: "custom-http",
              model: `${alias}-model`
            }
          }
        };
      });

      const result = await runModelRouting({
        settings: {
          modelRouting: {
            enabled: true,
            fallbackAliases: ["secondary", " primary "],
            maxAttempts: "2",
            routeId: "route-budget",
            promptVersion: "v9",
            budget: {
              maxEstimatedUsd: "0.0001"
            },
            priceTable: {
              primary: {
                inputUsdPer1MTokens: 1000000,
                outputUsdPer1MTokens: 0
              },
              secondary: {
                inputUsdPer1MTokens: 0,
                outputUsdPer1MTokens: 0
              }
            }
          }
        },
        input: {
          question: "hello",
          modelAlias: "primary",
          userId: "user-1",
          workspaceId: "workspace-1",
          parameters: {
            max_tokens: 3
          }
        },
        userDataPath,
        registry: [
          { alias: "primary" },
          { alias: "secondary" }
        ],
        executeCandidate
      });

      expect(result.result.answer).toBe("secondary-answer");
      expect(result.routing).toMatchObject({
        selectedAlias: "secondary",
        fallbackUsed: true
      });
      expect(result.routing.attempts).toEqual([
        expect.objectContaining({
          alias: "primary",
          status: "skipped",
          reason: "budget_violation"
        }),
        expect.objectContaining({
          alias: "secondary",
          status: "success"
        })
      ]);
      expect(executeCandidate.mock.calls.map(([call]) => [call.alias, call.dryRun])).toEqual([
        ["primary", true],
        ["secondary", true],
        ["secondary", false]
      ]);

      const snapshot = await inspectModelRouting({ userDataPath, limit: 10 });
      expect(snapshot.ledgerSummary.total).toBe(2);
      expect(snapshot.ledgerSummary.byStatus).toEqual({
        skipped: 1,
        success: 1
      });
      expect(snapshot.ledgerSummary.byAlias).toEqual({
        primary: 1,
        secondary: 1
      });
      expect(snapshot.ledgerSummary.estimatedUsdTotal).toBeGreaterThan(0);
      expect(snapshot.state.circuits.secondary).toMatchObject({
        state: "closed",
        failureCount: 0
      });
    });
  });

  it("skips an open circuit and continues with the next candidate", async () => {
    await withTempUserData(async (userDataPath) => {
      const blockedUntil = new Date(Date.now() + 60_000).toISOString();
      await writeJson(path.join(userDataPath, "state", "model-routing-state.json"), {
        circuits: {
          blocked: {
            state: "open",
            failureCount: 3,
            openedAt: new Date(Date.now() - 30_000).toISOString(),
            openUntil: blockedUntil,
            lastFailureAt: new Date(Date.now() - 30_000).toISOString(),
            lastError: "downstream unavailable"
          }
        }
      });

      const executeCandidate = vi.fn(async ({ alias, dryRun }) => {
        if (dryRun) {
          return {
            config: {
              alias,
              provider: "custom-http",
              model: `${alias}-model`
            }
          };
        }

        return {
          config: {
            alias,
            provider: "custom-http",
            model: `${alias}-model`
          },
          result: {
            ok: true,
            answer: `${alias}-answer`,
            usage: {
              prompt_tokens: 2,
              completion_tokens: 1,
              total_tokens: 3
            },
            upstream: {
              provider: "custom-http",
              model: `${alias}-model`
            }
          }
        };
      });

      const result = await runModelRouting({
        settings: {
          modelRouting: {
            enabled: true,
            fallbackAliases: ["blocked", "backup"],
            maxAttempts: 2,
            routeId: "route-circuit",
            promptVersion: "v2",
            circuitBreaker: {
              enabled: true,
              failureThreshold: 1,
              openMs: 60000
            }
          }
        },
        input: {
          question: "route with circuit",
          modelAlias: "blocked"
        },
        userDataPath,
        registry: [
          { alias: "blocked" },
          { alias: "backup" }
        ],
        executeCandidate
      });

      expect(result.result.answer).toBe("backup-answer");
      expect(result.routing).toMatchObject({
        selectedAlias: "backup",
        fallbackUsed: true
      });
      expect(result.routing.attempts[0]).toMatchObject({
        alias: "blocked",
        status: "skipped",
        reason: "circuit_open"
      });
      expect(result.routing.attempts[1]).toMatchObject({
        alias: "backup",
        status: "success"
      });
      expect(executeCandidate.mock.calls.map(([call]) => [call.alias, call.dryRun])).toEqual([
        ["backup", true],
        ["backup", false]
      ]);

      const snapshot = await inspectModelRouting({ userDataPath, limit: 10 });
      expect(snapshot.state.circuits.blocked.state).toBe("open");
      expect(snapshot.state.circuits.backup).toMatchObject({
        state: "closed",
        failureCount: 0
      });
    });
  });

  it("reports configuration and final-failure paths clearly", async () => {
    await expect(
      runModelRouting({
        settings: {},
        input: {},
        registry: [],
        executeCandidate: vi.fn()
      })
    ).rejects.toThrow("Model routing policy is not enabled.");

    await expect(
      runModelRouting({
        settings: {
          modelRouting: {
            enabled: true
          }
        },
        input: {
          modelRouting: {
            fallbackChain: []
          }
        },
        registry: [],
        executeCandidate: vi.fn()
      })
    ).rejects.toThrow("Model routing has no fallback candidates.");

    await withTempUserData(async (userDataPath) => {
      const executeCandidate = vi.fn(async ({ alias, dryRun }) => {
        if (dryRun) {
          return {
            config: {
              alias,
              provider: "custom-http",
              model: `${alias}-model`
            }
          };
        }

        throw new Error(`${alias} unavailable`);
      });

      const promise = runModelRouting({
        settings: {
          modelRouting: {
            enabled: true,
            fallbackAliases: ["first", "second"],
            maxAttempts: 2,
            routeId: "route-failure",
            promptVersion: "v1"
          }
        },
        input: {
          question: "no available candidate",
          modelAlias: "first"
        },
        userDataPath,
        registry: [
          { alias: "first" },
          { alias: "second" }
        ],
        executeCandidate
      });

      let error;
      try {
        await promise;
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Model routing found no available candidate.");
      expect(error.modelRouting).toMatchObject({
        protocolVersion: MODEL_ROUTING_PROTOCOL_VERSION,
        routeId: "route-failure",
        promptVersion: "v1"
      });
      expect(error.modelRouting.attempts).toEqual([
        expect.objectContaining({
          alias: "first",
          status: "failed",
          error: "first unavailable"
        }),
        expect.objectContaining({
          alias: "second",
          status: "failed",
          error: "second unavailable"
        })
      ]);
      expect(executeCandidate.mock.calls.map(([call]) => [call.alias, call.dryRun])).toEqual([
        ["first", true],
        ["first", false],
        ["second", true],
        ["second", false]
      ]);

      const snapshot = await inspectModelRouting({ userDataPath, limit: 10 });
      expect(snapshot.ledgerSummary.byStatus).toEqual({
        failed: 2
      });
      expect(snapshot.ledgerSummary.byAlias).toEqual({
        first: 1,
        second: 1
      });
    });
  });
});
