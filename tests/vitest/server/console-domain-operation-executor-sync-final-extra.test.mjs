import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-sync-final-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

function eventBus({ destroyedResponse = null } = {}) {
  return {
    publish: vi.fn(async (topic, _payload, options = {}) => ({
      id: `evt-${topic}`,
      offset: 1,
      topic,
      type: options.type || ""
    })),
    subscribe: vi.fn(async ({ cursor = 0, topics = [], includeSnapshot = false } = {}) => {
      if (destroyedResponse) {
        destroyedResponse.destroyed = true;
      }
      return {
        cursor,
        nextCursor: cursor + 1,
        topics,
        events: [
          { id: "evt-answer", topic: "agent.sync.answer" },
          { id: "evt-debug", topic: "agent.sync.debug" },
          { id: "evt-external", topic: "external.topic" }
        ],
        snapshots: includeSnapshot
          ? [{ id: "snapshot-debug", topic: "agent.sync.debug" }]
          : undefined
      };
    })
  };
}

describe("console-domain executor sync and runtime edge coverage", () => {
  it("covers agent sync authorization, publish, deny-all, fallback topics, and destroyed responses", async () => {
    await withTempDir(async (userDataPath) => {
      await expect(runOperation("agent_sync.publish", {
        input: { topic: "answer", payload: { text: "hi" } },
        context: { userDataPath, agentSyncFeatureActive: true }
      })).resolves.toMatchObject({
        status: 503,
        payload: { error: "Tool/Skill management provider is unavailable." }
      });

      const deniedProvider = {
        authorizeRequest: vi.fn(async () => ({ ok: false, status: 401, error: "denied" }))
      };
      await expect(runOperation("agent_sync.publish", {
        input: { topic: "answer" },
        context: { userDataPath, agentSyncFeatureActive: true, toolSkillManagementProvider: deniedProvider }
      })).resolves.toMatchObject({ status: 401, payload: { error: "denied" } });

      const authorizedProvider = {
        authorizeRequest: vi.fn(async () => ({ ok: true, grant: { id: "grant-1" } }))
      };
      await expect(runOperation("agent_sync.publish", {
        input: { topic: "debug" },
        context: {
          userDataPath,
          agentSyncFeatureActive: true,
          toolSkillManagementProvider: authorizedProvider,
          protocolEventBus: eventBus()
        }
      })).resolves.toMatchObject({
        status: 403,
        payload: { error: "智能体同步 topic 未启用：agent.sync.debug" }
      });

      const publishBus = eventBus();
      await expect(runOperation("agent_sync.publish", {
        input: { topic: "answer", payload: { text: "ok" }, type: "agent_sync.answer.delta" },
        context: {
          userDataPath,
          agentSyncFeatureActive: true,
          toolSkillManagementProvider: authorizedProvider,
          protocolEventBus: publishBus
        }
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          ok: true,
          event: { topic: "agent.sync.answer" },
          policy: { topic: "agent.sync.answer", retain: true }
        }
      });
      expect(publishBus.publish).toHaveBeenCalledWith(
        "agent.sync.answer",
        expect.objectContaining({
          source: "agent",
          grantId: "grant-1",
          payload: { text: "ok" }
        }),
        expect.objectContaining({
          type: "agent_sync.answer.delta",
          publisher: "agent:grant-1",
          retain: true
        })
      );

      await expect(runOperation("events.subscribe", {
        context: { userDataPath, agentSyncFeatureActive: true }
      })).resolves.toMatchObject({ status: 503, payload: { error: "事件总线不可用。" } });

      await expect(runOperation("events.subscribe", {
        input: { topics: "agent.sync.debug", cursor: "3", includeSnapshot: "true" },
        context: { userDataPath, agentSyncFeatureActive: true, protocolEventBus: eventBus() }
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          cursor: 3,
          nextCursor: 3,
          topics: [],
          requestedTopics: ["agent.sync.debug"],
          events: [],
          snapshots: []
        }
      });

      await expect(runOperation("agent_sync.subscribe", {
        input: { topics: "agent.sync.debug", cursor: "4", includeSnapshot: "true" },
        context: { userDataPath, agentSyncFeatureActive: true, protocolEventBus: eventBus() }
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          cursor: 4,
          nextCursor: 4,
          topics: [],
          requestedTopics: ["agent.sync.debug"],
          events: [],
          snapshots: []
        }
      });

      const responseForEvents = { destroyed: false, once: vi.fn() };
      await expect(runOperation("events.subscribe", {
        input: { topics: "external.topic", cursor: "7" },
        context: {
          userDataPath,
          agentSyncFeatureActive: true,
          protocolEventBus: eventBus({ destroyedResponse: responseForEvents }),
          response: responseForEvents,
          request: { aborted: false }
        }
      })).resolves.toMatchObject({ status: 200, payload: { __responseHandled: true } });

      const subscribeBus = eventBus();
      const fallbackSubscription = await runOperation("agent_sync.subscribe", {
        input: { cursor: "9", includeSnapshot: "true" },
        context: {
          userDataPath,
          agentSyncFeatureActive: true,
          protocolEventBus: subscribeBus,
          response: { destroyed: false, once: vi.fn() },
          request: { aborted: true }
        }
      });
      expect(fallbackSubscription).toMatchObject({
        status: 200,
        payload: {
          requestedTopics: []
        }
      });
      expect(fallbackSubscription.payload.events).toEqual(expect.arrayContaining([
        { id: "evt-answer", topic: "agent.sync.answer" }
      ]));
      expect(fallbackSubscription.payload.events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ topic: "agent.sync.debug" })
      ]));
      expect(subscribeBus.subscribe).toHaveBeenCalledWith(expect.objectContaining({
        topics: expect.arrayContaining(["agent.sync.answer", "agent.sync.status", "agent.sync.progress"])
      }));

      const responseForSync = { destroyed: false, once: vi.fn() };
      await expect(runOperation("agent_sync.subscribe", {
        input: { topics: "answer", cursor: "11" },
        context: {
          userDataPath,
          agentSyncFeatureActive: true,
          protocolEventBus: eventBus({ destroyedResponse: responseForSync }),
          response: responseForSync,
          request: { aborted: false }
        }
      })).resolves.toMatchObject({ status: 200, payload: { __responseHandled: true } });
    });
  });

  it("covers strategy, knowledge graph, runtime mount, and passthrough edge branches", async () => {
    await expect(runOperation("strategy.describe", { context: {} }))
      .resolves.toMatchObject({ status: 503, payload: { error: "策略管理 provider 不可用。" } });

    await expect(runOperation("knowledge.graph", { context: {} }))
      .resolves.toMatchObject({ status: 503, payload: { error: "知识图谱存储不可用。" } });
    const metadataStore = {
      getKnowledgeGraph: vi.fn(() => ({ nodes: [{ id: "seed-1" }], edges: [] }))
    };
    await expect(runOperation("knowledge.graph", {
      input: { id: "seed-1", depth: "2", limit: "5" },
      context: { metadataStore }
    })).resolves.toMatchObject({
      status: 200,
      payload: { nodes: [{ id: "seed-1" }], edges: [] }
    });
    expect(metadataStore.getKnowledgeGraph).toHaveBeenCalledWith({ seed: "seed-1", depth: 2, limit: 5 });

    await expect(runOperation("runtime.mounts", { context: {} }))
      .resolves.toMatchObject({ status: 503, payload: { error: "模块管理 provider 不可用。" } });
    const publish = vi.fn(async (topic, _payload, options = {}) => ({
      id: `evt-${options.type || topic}`,
      topic,
      offset: 1
    }));
    const moduleManagement = {
      getMountsSnapshot: vi.fn(async () => ({ mounts: [] })),
      setMounts: vi.fn(async (input) => (
        input.fail ? { ok: false, statusCode: 409, error: "bad mounts" } : { ok: true, mounts: input.mounts || [] }
      )),
      reloadMounts: vi.fn(async (input) => (
        input.fail ? { ok: false, statusCode: 422, error: "reload failed" } : { ok: true, reloaded: true }
      ))
    };
    const mountContext = {
      moduleManagement,
      protocolEventBus: { publish },
      features: { edition: "test" },
      consoleDomainServices: { listAvailableAnalysisModules: vi.fn(() => []) }
    };
    await expect(runOperation("runtime.mounts", { context: mountContext }))
      .resolves.toMatchObject({ status: 200, payload: { mounts: [] } });
    await expect(runOperation("runtime.set_mounts", {
      input: { fail: true },
      context: mountContext
    })).resolves.toMatchObject({ status: 409, payload: { ok: false, error: "bad mounts" } });
    await expect(runOperation("runtime.set_mounts", {
      input: { value: { mounts: [{ id: "m-1" }] } },
      context: mountContext
    })).resolves.toMatchObject({ status: 200, payload: { ok: true } });
    await expect(runOperation("runtime.reload_mounts", {
      input: { fail: true },
      context: mountContext
    })).resolves.toMatchObject({ status: 422, payload: { ok: false, error: "reload failed" } });
    await expect(runOperation("runtime.reload_mounts", {
      input: { reason: "test" },
      context: mountContext
    })).resolves.toMatchObject({ status: 200, payload: { ok: true, reloaded: true } });
    expect(publish).toHaveBeenCalledWith("runtime.mounts", expect.any(Object), {
      type: "runtime.mounts.updated"
    });
    expect(publish).toHaveBeenCalledWith("runtime.mounts", expect.any(Object), {
      type: "runtime.mounts.reloaded"
    });

    await expect(runOperation("tool_management.unhandled_operation", { context: {} }))
      .resolves.toMatchObject({ status: 503 });
    await expect(runOperation("not.console.runtime.edge", { context: {} }))
      .resolves.toMatchObject({ status: 501 });
  });
});
