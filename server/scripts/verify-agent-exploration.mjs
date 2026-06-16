import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createAgentWorkspace } from "../platform/specialized/agent/agent-workspace/index.mjs";
import { createContextRuntime } from "../platform/specialized/agent/agent-context/interface/index.mjs";
import { createAgentExplorationRuntime } from "../platform/specialized/capabilities/tools/agent-exploration-runtime/index.mjs";
import { saveSettings } from "../platform/common/platform-core/settings.mjs";
import { evaluateAuthorizationPolicy } from "../platform/common/security/authorization/authorization-engine.mjs";
import { createToolManagementStore } from "../platform/specialized/capabilities/tools/tool-management-core/store.mjs";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-explore-"));
const actor = {
  actorUserId: "verify-owner",
  userId: "verify-owner",
  subjectId: "verify-owner",
  username: "verify-owner"
};
const previousCapabilityEnv = {
  PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER,
  PACT_CAPABILITY_BINDING_GUARD_PROVIDER: process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER,
  PACT_TOOL_GRANT_CAPABILITY_KEY_ALIAS: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_ALIAS,
  PACT_TOOL_GRANT_BINDING_GUARD_ALIAS: process.env.PACT_TOOL_GRANT_BINDING_GUARD_ALIAS
};
const capabilityAlias = `pact-agent-explore-${path.basename(tempRoot)}`;
process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER || "local-file";
process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER = process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER || "local-file";
process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_ALIAS = process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_ALIAS || capabilityAlias;
process.env.PACT_TOOL_GRANT_BINDING_GUARD_ALIAS = process.env.PACT_TOOL_GRANT_BINDING_GUARD_ALIAS || `${capabilityAlias}-binding`;
const toolServer = await new Promise((resolve, reject) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, method: request.method, url: request.url }));
  });
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.removeListener("error", reject);
    const address = server.address();
    resolve({
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise((done) => server.close(done))
    });
  });
});

const fixtureKnowledgeCore = {
  enabled: true,
  async search(input = {}) {
    assert.equal(input.retrievalMode, "hybrid");
    assert.equal(input.keywordOnly, false);
    assert.equal(input.learningEnabled, true);
    return {
      protocolVersion: "v0.0.1:knowledge:core-1",
      query: input.query,
      retrievalMode: "hybrid",
      retrievalProfileId: "balanced",
      retrievalProfileKey: "balanced@1",
      profileRoute: { routedBy: "active" },
      hierarchy: {
        enabled: true,
        policy: "coarse_to_fine",
        selected: {
          documents: [{ title: "部署记录", documentId: "doc_1" }]
        }
      },
      items: [
        {
          evidenceId: "ev_1",
          documentId: "doc_1",
          title: "Atlas 模块部署记录.md",
          snippet: "部署版本 v1.2.3，回滚窗口 30 分钟。",
          score: 0.91,
          hierarchy: { path: "collection:mail > document:doc_1" },
          modalities: ["text", "image"],
          assets: [{ assetId: "asset_1" }],
          reasons: [{ kind: "bm25", score: 1, weight: 1 }]
        }
      ],
      explain: {
        candidateCount: 1,
        generatedCandidateCount: 1,
        dedupedCandidateCount: 1,
        hierarchyCandidateCount: 1
      }
    };
  },
  async aggregate(input = {}) {
    assert.equal(input.metric, "email_advertising_by_sender");
    assert.equal(input.groupBy, "senderEmail");
    return {
      protocolVersion: "v0.0.1:knowledge:core-1",
      ok: true,
      metric: input.metric,
      groupBy: input.groupBy,
      filters: { documentType: "email", classification: "advertising" },
      scannedDocumentCount: 3,
      matchedDocumentCount: 3,
      topGroup: {
        key: "offers@example.com",
        label: "offers@example.com",
        count: 2,
        evidenceRefs: ["ev_1"],
        examples: [{ documentId: "doc_1", evidenceId: "ev_1", title: "广告邮件.eml" }]
      },
      groups: [
        {
          key: "offers@example.com",
          label: "offers@example.com",
          count: 2,
          evidenceRefs: ["ev_1"],
          examples: [{ documentId: "doc_1", evidenceId: "ev_1", title: "广告邮件.eml" }]
        },
        {
          key: "news@example.com",
          label: "news@example.com",
          count: 1,
          evidenceRefs: ["ev_2"],
          examples: [{ documentId: "doc_2", evidenceId: "ev_2", title: "促销邮件.eml" }]
        }
      ],
      methodology: "mock aggregate"
    };
  },
  async getEvidence({ evidenceId }) {
    assert.equal(evidenceId, "ev_1");
    return {
      evidenceId,
      title: "Atlas 模块部署记录.md",
      snippet: "部署版本 v1.2.3，回滚窗口 30 分钟。",
      score: 0.91,
      locator: { sourcePath: "/fixtures/bill.eml" },
      payload: {
        document: {
          documentId: "doc_1",
          title: "Atlas 模块部署记录.md",
          documentType: "email",
          sourcePath: "/fixtures/bill.eml",
          batchId: "batch_1"
        },
        blocks: [
          {
            blockId: "block_1",
            title: "正文",
            text: "部署时间 2026-04-20，部署版本 v1.2.3，回滚窗口 30 分钟。"
          }
        ],
        assets: [{ assetId: "asset_1", mediaType: "image/png", title: "部署截图" }]
      },
      markdown: "# Atlas 模块部署记录\n\n部署版本 v1.2.3，回滚窗口 30 分钟。"
    };
  }
};

const agentWorkspace = createAgentWorkspace({ userDataPath: tempRoot });
const contextRuntime = createContextRuntime({ userDataPath: tempRoot });
await saveSettings(tempRoot, {
  agentToolExecution: {
    http: {
      enabled: true,
      allowedHosts: ["127.0.0.1", "localhost"],
      allowLocalForDevelopment: true
    }
  }
});
let callCount = 0;
const runtime = createAgentExplorationRuntime({
  userDataPath: tempRoot,
  runtime: {
    mounts: {
      knowledgeBase: fixtureKnowledgeCore
    }
  },
  agentWorkspace,
  contextRuntime,
  agentGatewayCall: async (input = {}) => {
    callCount += 1;
    assert.ok(input.parameters?.tools?.length >= 4, "native function-call tools must be supplied");
    assert.ok(
      input.parameters.tools.some((tool) => tool.function?.name === "knowledge_aggregate"),
      "aggregation tool must be supplied for count/ranking questions"
    );
    assert.equal(input.parameters.tool_choice, "auto");
    assert.match(input.messages[0].content, /Answer template:/);
    assert.match(input.messages[0].content, /证据来源/);
    assert.match(input.messages[0].content, /Critical Evidence Index/);
    assert.doesNotMatch(input.messages[0].content, /ContextPack: \{/);
    if (callCount === 1) {
      return {
        ok: true,
        answer: "",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" },
        chunks: {
          reasoning: ["I should search local evidence first."]
        },
        toolCalls: [
          {
            id: "call_keyword",
            type: "function",
            function: {
              name: "keyword_search",
              arguments: JSON.stringify({ query: "部署记录", limit: 2 })
            }
          }
        ]
      };
    }
    if (callCount === 2) {
      const assistantToolCallMessage = input.messages.find(
        (message) => message.role === "assistant" && Array.isArray(message.tool_calls)
      );
      assert.ok(
        assistantToolCallMessage?.reasoning_content,
        "DeepSeek thinking mode requires prior assistant reasoning_content to be passed back with tool calls"
      );
      return {
        ok: true,
        answer: "",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" },
        toolCalls: [
          {
            id: "call_evidence",
            type: "function",
            function: {
              name: "open_evidence",
              arguments: JSON.stringify({ evidenceId: "ev_1" })
            }
          }
        ]
      };
    }
    if (callCount === 3) {
      return {
        ok: true,
        answer: "",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" },
        toolCalls: [
          {
            id: "call_local",
            type: "function",
            function: {
              name: "local_command",
              arguments: JSON.stringify({
                commandId: "node-version",
                variables: { flag: "--version" }
              })
            }
          }
        ]
      };
    }
    if (callCount === 4) {
      return {
        ok: true,
        answer: "",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" },
        toolCalls: [
          {
            id: "call_http",
            type: "function",
            function: {
              name: "http_request",
              arguments: JSON.stringify({
                method: "GET",
                url: `${toolServer.url}/ping`,
                query: { q: "ok" }
              })
            }
          }
        ]
      };
    }
    return {
      ok: true,
      answer: "找到了部署证据：Atlas 模块部署记录，版本 v1.2.3。[ev_1]",
      finish: true,
      upstream: { provider: "mock", status: 200, contentType: "application/json" }
    };
  }
});

try {
  const result = await runtime.run({
    ...actor,
    query: "帮我找部署记录",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 5,
    limit: 2
  });

  assert.equal(result.ok, true);
  assert.equal(result.degraded, false);
  assert.equal(result.toolResults[0].tool, "keyword_search");
  assert.equal(result.toolResults[1].tool, "open_evidence");
  assert.equal(result.toolResults[2].tool, "local_command");
  assert.equal(result.toolResults[2].result.ok, true);
  assert.deepEqual(result.toolResults[2].result.args, ["--version"]);
  assert.equal(result.toolResults[3].tool, "http_request");
  assert.equal(result.toolResults[3].result.status, 200);
  assert.match(result.answer, /v1\.2\.3/);
  assert.ok(result.evidenceRefs.includes("ev_1"));
  assert.equal(result.run.coverage.nativeFunctionCalling, true);
  assert.equal(result.contextPack.profileId, "context-128k");
  assert.ok(result.contextPack.contextBuildRecordId);
  assert.ok(result.contextPack.criticalEvidenceIndex);
  assert.ok(result.contextPack.toolStateSummary);
  assert.ok(result.steps[0].events.some((event) => event.type === "model_calling"));
  assert.ok(result.steps[0].events.some((event) => event.type === "tool_selected"));
  assert.ok(result.steps[0].events.some((event) => event.type === "tool_calling"));
  assert.ok(result.steps[0].events.some((event) => event.type === "tool_result"));
  assert.equal(result.steps[0].toolCalls[0].status, "completed");
  assert.equal(result.steps[0].toolResults[0].status, "completed");
  const auditLog = await fs.readFile(path.join(tempRoot, "logs", "agent-exploration.jsonl"), "utf8");
  assert.match(auditLog, /"event":"run_started"/);
  assert.match(auditLog, /"event":"model_response"/);
  assert.match(auditLog, /"reasoningContentReturned":true/);

  const loaded = runtime.getRun({
    ...actor,
    runId: result.run.runId,
    workspaceId: result.workspace.workspaceId
  });
  assert.equal(loaded.run.runId, result.run.runId);
  assert.equal(loaded.answer, result.answer);
  assert.ok(loaded.steps[0].events.some((event) => event.type === "tool_selected"));

  const scopedWorkspaceId = "verify-exploration-workspace-hot-swap";
  agentWorkspace.createWorkspace({
    ...actor,
    ownerUserId: actor.actorUserId,
    workspaceId: scopedWorkspaceId,
    title: "Workspace hot-swap exploration",
    objective: "Verify AgentExplorationRuntime applies workspace context"
  });
  agentWorkspace.hotSwapProfile(scopedWorkspaceId, {
    contextProfileId: "small-context",
    modelAlias: "workspace-model",
    toolGrantId: "workspace-tool-grant",
    knowledgeScope: {
      includeSourceIds: ["workspace-source-a"]
    }
  }, actor);
  let scopedCallCount = 0;
  let scopedAllocatorCallCount = 0;
  let scopedSearchInput = null;
  const scopedRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: {
          ...fixtureKnowledgeCore,
          async search(input = {}) {
            scopedSearchInput = input;
            assert.deepEqual(input.scopeSourceIds, ["workspace-source-a"]);
            return fixtureKnowledgeCore.search(input);
          }
        }
      }
    },
    agentWorkspace,
    contextRuntime,
    clientRuntimeAllocator: {
      async apply(input = {}, context = {}) {
        scopedAllocatorCallCount += 1;
        assert.equal(context.surface, "agent-exploration-runtime");
        assert.equal(input.workspaceId, scopedWorkspaceId);
        return {
          input: {
            ...input,
            modelAlias: "allocator-model",
            contextProfileId: "allocator-context",
            toolGrantId: "allocator-tool-grant",
            scopeSourceIds: ["allocator-source"]
          },
          allocation: {
            profileId: "allocator-defaults",
            modelAlias: "allocator-model"
          }
        };
      }
    },
    agentGatewayCall: async (input = {}) => {
      scopedCallCount += 1;
      assert.equal(input.alias, "workspace-model");
      assert.equal(input.modelAlias, "workspace-model");
      assert.equal(input.contextProfileId, "small-context");
      assert.equal(input.toolGrantId, "workspace-tool-grant");
      assert.equal(input.workspaceId, scopedWorkspaceId);
      assert.equal(input.sessionId, scopedWorkspaceId);
      assert.equal(input.workspaceContext.workspaceId, scopedWorkspaceId);
      assert.equal(input.workspaceContext.contextProfileId, "small-context");
      assert.equal(input.workspaceContext.modelAlias, "workspace-model");
      assert.equal(input.workspaceContext.toolGrantId, "workspace-tool-grant");
      assert.deepEqual(input.workspaceContext.knowledgeSourceIds, ["workspace-source-a"]);
      if (scopedCallCount === 1) {
        return {
          ok: true,
          answer: "",
          finish: true,
          upstream: { provider: "mock", status: 200, contentType: "application/json" },
          toolCalls: [
            {
              id: "call_scoped_keyword",
              type: "function",
              function: {
                name: "keyword_search",
                arguments: JSON.stringify({
                  query: "workspace scoped bill",
                  limit: 2
                })
              }
            }
          ]
        };
      }
      assert.match(JSON.stringify(input.messages), /workspace scoped bill/);
      return {
        ok: true,
        answer: "工作空间热切换检索已限定到 workspace-source-a。[ev_1]",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" }
      };
    }
  });
  const scopedResult = await scopedRuntime.run({
    ...actor,
    query: "workspace scoped bill",
    workspaceId: scopedWorkspaceId,
    maxIterations: 2,
    limit: 2
  });
  assert.equal(scopedAllocatorCallCount, 1);
  assert.equal(scopedCallCount, 2);
  assert.deepEqual(scopedSearchInput.scopeSourceIds, ["workspace-source-a"]);
  assert.equal(scopedResult.contextPack.profileId, "context-128k");
  assert.equal(scopedResult.workspaceContext.modelAlias, "workspace-model");
  assert.equal(scopedResult.workspaceContext.toolGrantId, "workspace-tool-grant");
  assert.equal(scopedResult.run.input.modelAlias, "workspace-model");
  assert.equal(scopedResult.run.input.toolGrantId, "workspace-tool-grant");
  assert.deepEqual(scopedResult.run.input.scopeSourceIds, ["workspace-source-a"]);
  assert.equal(scopedResult.run.input.clientRuntimeAllocation.profileId, "allocator-defaults");

  const grantProofStore = createToolManagementStore({ userDataPath: tempRoot });
  const callerControlledGrant = await grantProofStore.createGrant({
    id: "caller-controlled-agent-explore-grant",
    label: "caller-controlled-agent-explore-grant",
    toolsets: ["pact.agentLibrary.write"],
    scopes: ["knowledge:read", "knowledge:write"],
    metadata: {
      boundUserId: "verify-owner",
      agentId: "knowledge-explorer",
      maxRisk: "safe_write"
    }
  });
  grantProofStore.close();
  let grantProofCallCount = 0;
  const grantProofRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: fixtureKnowledgeCore
      }
    },
    agentWorkspace,
    contextRuntime,
    securityPermissions: {
      evaluatePolicy(input = {}) {
        return evaluateAuthorizationPolicy(input);
      }
    },
    agentGatewayCall: async (input = {}) => {
      grantProofCallCount += 1;
      if (grantProofCallCount === 1) {
        assert.equal(
          input.parameters.tools.some((tool) => tool.function?.name === "knowledge_skill_propose"),
          false,
          "caller-selected grant ids must not expose write tools"
        );
        return {
          ok: true,
          answer: "",
          finish: true,
          upstream: { provider: "mock", status: 200, contentType: "application/json" },
          toolCalls: [
            {
              id: "call_caller_grant_propose",
              type: "function",
              function: {
                name: "knowledge_skill_propose",
                arguments: JSON.stringify({
                  title: "Caller grant should not authorize this",
                  summary: "Attempted caller-controlled grant proof bypass.",
                  evidenceRefs: ["ev_1"],
                  decisionHeuristics: ["Do not trust caller supplied grant ids."],
                  honestBoundaries: ["Verifier-only proposal."]
                })
              }
            }
          ]
        };
      }
      assert.match(JSON.stringify(input.messages), /missing_grant|authorization_denied/);
      return {
        ok: true,
        answer: "caller-controlled grant id was rejected",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" }
      };
    }
  });
  const grantProofResult = await grantProofRuntime.run({
    ...actor,
    query: "attempt caller grant proof bypass",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 2,
    limit: 2,
    toolGrantId: callerControlledGrant.grant.id,
    authSession: {
      user: {
        userId: "verify-owner",
        username: "verify-owner",
        roleId: "viewer",
        scopes: ["knowledge:read"]
      }
    }
  });
  assert.equal(grantProofCallCount, 2);
  assert.equal(grantProofResult.toolResults[0].tool, "knowledge_skill_propose");
  assert.equal(grantProofResult.toolResults[0].result.ok, false);
  assert.equal(grantProofResult.toolResults[0].result.reasonCode, "missing_grant");

  let aggregateCallCount = 0;
  const aggregateRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: fixtureKnowledgeCore
      }
    },
    agentWorkspace,
    contextRuntime,
    agentGatewayCall: async (input = {}) => {
      aggregateCallCount += 1;
      assert.ok(
        input.parameters?.tools?.some((tool) => tool.function?.name === "knowledge_aggregate"),
        "native function-call aggregation tool must be supplied"
      );
      if (aggregateCallCount === 1) {
        assert.equal(input.parameters.tool_choice, "auto");
        assert.match(input.messages[0].content, /knowledge_aggregate/);
        return {
          ok: true,
          answer: "",
          finish: true,
          upstream: { provider: "mock", status: 200, contentType: "application/json" },
          toolCalls: [
            {
              id: "call_aggregate",
              type: "function",
              function: {
                name: "knowledge_aggregate",
                arguments: JSON.stringify({
                  metric: "email_advertising_by_sender",
                  groupBy: "senderEmail",
                  limit: 5
                })
              }
            }
          ]
        };
      }
      assert.equal(input.parameters.tool_choice, "auto");
      assert.match(JSON.stringify(input.messages), /offers@example\.com/);
      return {
        ok: true,
        answer: "广告数量最多的发件邮箱是 offers@example.com，共 2 封。\n\n📎 证据来源：evidence::ev_1",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" }
      };
    }
  });
  const aggregateResult = await aggregateRuntime.run({
    ...actor,
    query: "哪个邮箱的广告数量最多？",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 2,
    limit: 5
  });
  assert.equal(aggregateCallCount, 2);
  assert.equal(aggregateResult.toolResults[0].tool, "knowledge_aggregate");
  assert.equal(aggregateResult.toolResults[0].result.topGroup.key, "offers@example.com");
  assert.match(aggregateResult.answer, /offers@example\.com/);
  assert.ok(aggregateResult.evidenceRefs.includes("ev_1"));

  let hermesCallCount = 0;
  const hermesRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: fixtureKnowledgeCore
      }
    },
    agentWorkspace,
    contextRuntime,
    agentGatewayCall: async (input = {}) => {
      hermesCallCount += 1;
      if (hermesCallCount === 1) {
        assert.equal(input.parameters.tool_choice, "auto");
        return {
          ok: true,
          answer:
            '<tool_call>{"name":"keyword_search","arguments":{"query":"部署记录","limit":2}}</tool_call>',
          finish: true,
          upstream: { provider: "mock-qwen", status: 200, contentType: "application/json" }
        };
      }
      assert.match(JSON.stringify(input.messages), /tool_call/);
      return {
        ok: true,
        answer: "Hermes 兜底解析后找到部署证据。\n\n📎 证据来源：evidence::ev_1",
        finish: true,
        upstream: { provider: "mock-qwen", status: 200, contentType: "application/json" }
      };
    }
  });
  const hermesResult = await hermesRuntime.run({
    ...actor,
    query: "Qwen3 Hermes 工具调用兜底",
    modelAlias: "qwen3-32b",
    contextProfileId: "small-context",
    maxIterations: 2,
    limit: 2
  });
  assert.equal(hermesCallCount, 2);
  assert.equal(hermesResult.toolResults[0].tool, "keyword_search");
  assert.equal(hermesResult.steps[0].functionCallSource, "json_text_tool_call");
  assert.equal(hermesResult.degraded, true);
  assert.ok(hermesResult.evidenceRefs.includes("ev_1"));

  let synthesisCallCount = 0;
  const synthesisRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: fixtureKnowledgeCore
      }
    },
    agentWorkspace,
    contextRuntime,
    agentGatewayCall: async (input = {}) => {
      synthesisCallCount += 1;
      if (synthesisCallCount <= 2) {
        assert.equal(input.parameters.tool_choice, "auto");
        return {
          ok: true,
          answer: "",
          finish: true,
          upstream: { provider: "mock", status: 200, contentType: "application/json" },
          toolCalls: [
            {
              id: `call_keyword_${synthesisCallCount}`,
              type: "function",
              function: {
                name: "keyword_search",
                arguments: JSON.stringify({ query: "部署记录", limit: 2 })
              }
            }
          ]
        };
      }
      assert.equal(input.parameters.tool_choice, "none");
      assert.match(input.messages.at(-1).content, /不要再返回 function call/);
      return {
        ok: true,
        answer: "最终综合：找到部署证据，版本 v1.2.3。[ev_1]",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" }
      };
    }
  });
  const synthesisResult = await synthesisRuntime.run({
    ...actor,
    query: "循环耗尽后仍要综合",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 2,
    limit: 2
  });
  assert.equal(synthesisCallCount, 3);
  assert.match(synthesisResult.answer, /最终综合/);
  assert.doesNotMatch(synthesisResult.answer, /已完成本地关键词检索/);
  assert.equal(synthesisResult.run.coverage.finalSynthesis, true);
  assert.ok(synthesisResult.steps.at(-1).events.some((event) => event.type === "answer_ready"));

  let ruleAuthoringCallCount = 0;
  const ruleAuthoringRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: fixtureKnowledgeCore
      }
    },
    agentWorkspace,
    contextRuntime,
    knowledgeRuleAuthoringRuntime: {
      async chat(input = {}) {
        assert.match(input.message, /完全一样/);
        assert.equal(input.modelAlias, "deepseek");
        return {
          ok: true,
          status: "pending_human_confirmation",
          runId: "rule_authoring_verify",
          intent: { needsRule: true, templateId: "exact_duplicate_skip_existing" },
          template: { templateId: "exact_duplicate_skip_existing" },
          gate: {
            ok: true,
            scenarios: [
              {
                result: {
                  context: {
                    candidate: {
                      evidenceRefs: ["ev_1"]
                    }
                  }
                }
              }
            ]
          },
          confirmation: {
            packageId: "agent-rule-exact-duplicate-skip-existing",
            version: 1
          },
          package: {
            packageId: "agent-rule-exact-duplicate-skip-existing",
            version: 1,
            status: "draft",
            rules: [
              {
                label: "完全一样的知识直接跳过",
                action: "skip_existing",
                reason: "验证"
              }
            ]
          },
          humanConfirmationRequired: true
        };
      }
    },
    agentGatewayCall: async (input = {}) => {
      ruleAuthoringCallCount += 1;
      assert.ok(
        input.parameters?.tools?.some((tool) => tool.function?.name === "golden_rule_authoring"),
        "native function-call rule authoring tool must be supplied"
      );
      if (ruleAuthoringCallCount === 1) {
        return {
          ok: true,
          answer: "",
          finish: true,
          upstream: { provider: "mock", status: 200, contentType: "application/json" },
          toolCalls: [
            {
              id: "call_rule_authoring",
              type: "function",
              function: {
                name: "golden_rule_authoring",
                arguments: JSON.stringify({
                  message: "生成一个黄金规则：完全一样的知识直接跳过",
                  modelEnabled: false
                })
              }
            }
          ]
        };
      }
      assert.match(JSON.stringify(input.messages), /pending_human_confirmation/);
      return {
        ok: true,
        answer: "规则草稿已生成，等待人类确认发布。",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" }
      };
    }
  });
  const ruleAuthoringResult = await ruleAuthoringRuntime.run({
    ...actor,
    query: "请创建规则：完全一样的知识直接跳过",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 2,
    limit: 2
  });
  assert.equal(ruleAuthoringResult.toolResults[0].tool, "golden_rule_authoring");
  assert.equal(ruleAuthoringResult.toolResults[0].result.status, "pending_human_confirmation");
  assert.equal(ruleAuthoringResult.toolResults[0].result.humanConfirmationRequired, true);
  assert.ok(ruleAuthoringResult.evidenceRefs.includes("ev_1"));

  let deniedCallCount = 0;
  const deniedRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: fixtureKnowledgeCore
      }
    },
    agentWorkspace,
    contextRuntime,
    securityPermissions: {
      evaluatePolicy(input = {}) {
        if (input.tool?.id === "agent-exploration.local_command") {
          return {
            protocolVersion: "v0.0.1:risk-control:authorization-1",
            decisionId: "authz_verify_local_command_denied",
            auditId: "authz_audit_verify_local_command_denied",
            toolExecutionId: input.toolExecutionId || "",
            traceId: input.traceId || "",
            toolId: input.tool.id,
            grantId: input.grant?.id || "",
            subject: input.subject || null,
            effect: "deny",
            allowed: false,
            reasonCode: "risk_exceeds_policy",
            redactedReason: "Requested risk exceeds effective policy.",
            deniedLayer: "risk",
            missingScopes: [],
            missingToolsets: [],
            evaluatedLayers: ["tool_catalog_policy", "runtime_safety_policy"],
            createdAt: new Date().toISOString()
          };
        }
        return {
          protocolVersion: "v0.0.1:risk-control:authorization-1",
          decisionId: `authz_verify_allow_${input.tool?.id || "tool"}`,
          auditId: "authz_audit_verify_allow",
          toolExecutionId: input.toolExecutionId || "",
          traceId: input.traceId || "",
          toolId: input.tool?.id || "",
          grantId: input.grant?.id || "",
          subject: input.subject || null,
          effect: input.dryRun ? "dry_run_only" : "allow",
          allowed: true,
          reasonCode: input.dryRun ? "dry_run" : "allowed",
          missingScopes: [],
          missingToolsets: [],
          evaluatedLayers: ["tool_catalog_policy"],
          createdAt: new Date().toISOString()
        };
      }
    },
    agentGatewayCall: async (input = {}) => {
      deniedCallCount += 1;
      if (deniedCallCount === 1) {
        assert.equal(
          input.parameters.tools.some((tool) => tool.function?.name === "local_command"),
          false,
          "unauthorized function-call tools must not be exposed to the model"
        );
        return {
          ok: true,
          answer: "",
          finish: true,
          upstream: { provider: "mock", status: 200, contentType: "application/json" },
          toolCalls: [
            {
              id: "call_denied_local",
              type: "function",
              function: {
                name: "local_command",
                arguments: JSON.stringify({ commandId: "node-version" })
              }
            }
          ]
        };
      }
      assert.match(JSON.stringify(input.messages), /authorization_denied/);
      return {
        ok: true,
        answer: "本地命令调用已被统一权限治理拦截。",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" }
      };
    }
  });
  const deniedResult = await deniedRuntime.run({
    ...actor,
    query: "尝试执行本地命令",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 2,
    limit: 2,
    authSession: {
      user: {
        userId: "verify-owner",
        username: "verify-owner",
        roleId: "owner",
        scopes: ["knowledge:read", "knowledge:write", "knowledge:admin"]
      }
    }
  });
  assert.equal(deniedCallCount, 2);
  assert.equal(deniedResult.toolResults[0].tool, "local_command");
  assert.equal(deniedResult.toolResults[0].result.ok, false);
  assert.equal(deniedResult.toolResults[0].result.error, "authorization_denied");
  assert.equal(deniedResult.toolResults[0].result.reasonCode, "risk_exceeds_policy");
  assert.equal(deniedResult.steps[0].toolResults[0].status, "failed");

  let cwdOverrideCallCount = 0;
  const cwdOverrideRuntime = createAgentExplorationRuntime({
    userDataPath: tempRoot,
    runtime: {
      mounts: {
        knowledgeBase: fixtureKnowledgeCore
      }
    },
    agentWorkspace,
    contextRuntime,
    agentGatewayCall: async (input = {}) => {
      cwdOverrideCallCount += 1;
      if (cwdOverrideCallCount === 1) {
        return {
          ok: true,
          answer: "",
          finish: true,
          upstream: { provider: "mock", status: 200, contentType: "application/json" },
          toolCalls: [
            {
              id: "call_local_cwd_override",
              type: "function",
              function: {
                name: "local_command",
                arguments: JSON.stringify({
                  commandId: "node-version",
                  variables: { flag: "--version" },
                  cwd: "/tmp"
                })
              }
            }
          ]
        };
      }
      assert.match(
        JSON.stringify(input.messages),
        /local_command_cwd_override_not_allowed/,
        "local command cwd override denial must be returned to the model"
      );
      return {
        ok: true,
        answer: "cwd override rejected",
        finish: true,
        upstream: { provider: "mock", status: 200, contentType: "application/json" }
      };
    }
  });
  const cwdOverrideResult = await cwdOverrideRuntime.run({
    ...actor,
    query: "尝试覆盖本地命令 cwd",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 2,
    limit: 2
  });
  assert.equal(cwdOverrideCallCount, 2);
  assert.equal(cwdOverrideResult.toolResults[0].tool, "local_command");
  assert.equal(cwdOverrideResult.toolResults[0].result.ok, false);
  assert.equal(cwdOverrideResult.toolResults[0].result.error, "local_command_cwd_override_not_allowed");
  assert.equal(cwdOverrideResult.steps[0].toolResults[0].status, "failed");

  callCount = 0;
  const asyncResult = await runtime.run({
    ...actor,
    query: "帮我找部署记录 async",
    modelAlias: "deepseek",
    contextProfileId: "small-context",
    maxIterations: 5,
    limit: 2,
    async: true
  });
  assert.equal(asyncResult.pending, true);
  assert.equal(asyncResult.run.status, "running");
  let asyncLoaded = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    asyncLoaded = runtime.getRun({
      ...actor,
      runId: asyncResult.run.runId,
      workspaceId: asyncResult.workspace.workspaceId
    });
    if (asyncLoaded?.run?.status === "completed") {
      break;
    }
  }
  assert.equal(asyncLoaded.run.status, "completed");
  assert.equal(asyncLoaded.pending, false);
  assert.match(asyncLoaded.answer, /v1\.2\.3/);
  assert.ok(asyncLoaded.steps[0].events.some((event) => event.type === "tool_result"));

  console.log("agent exploration verification passed");
} finally {
  agentWorkspace.close();
  await toolServer.close();
  for (const [key, value] of Object.entries(previousCapabilityEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}
