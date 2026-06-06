import { describe, expect, it, vi } from "vitest";
import { createSystemControllerKnowledgeRuntimeHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs";

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function callByOperationId(sendConsoleDomainOperation, operationId) {
  return sendConsoleDomainOperation.mock.calls
    .map((call) => call[0])
    .find((call) => call.operationId === operationId);
}

describe("system controller knowledge runtime handlers final extra coverage", () => {
  it("routes all knowledge runtime thin handlers with default ids, inputs, and contexts", async () => {
    const sendConsoleDomainOperation = vi.fn(async () => undefined);
    const parseJsonBody = vi.fn((requestBody) =>
      JSON.parse(Buffer.from(requestBody || Buffer.alloc(0)).toString("utf8") || "{}")
    );
    const protocolPayload = vi.fn((requestBody, url) => ({
      protocol: Object.fromEntries(url.searchParams.entries()),
      bodyBytes: Buffer.byteLength(requestBody || Buffer.alloc(0))
    }));
    const queryPayload = vi.fn((url) => ({
      query: Object.fromEntries(url.searchParams.entries())
    }));
    const knowledgeDomainContext = vi.fn((authSession) => ({ scope: "domain", authSession }));
    const knowledgeWorkflowContext = vi.fn((authSession) => ({ scope: "workflow", authSession }));
    const accessControlContext = vi.fn((authSession, extra) => ({ scope: "access", authSession, ...extra }));
    const runtime = { id: "runtime" };
    const metadataStore = { id: "metadata" };
    const clientRuntimeAllocator = { id: "client-runtime" };
    const modelDecisionRuntime = { id: "model-decision" };
    const strategyManagementProvider = { id: "strategy" };
    const agentWorkspace = { id: "workspace" };
    const handlers = createSystemControllerKnowledgeRuntimeHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      protocolPayload,
      queryPayload,
      knowledgeDomainContext,
      knowledgeWorkflowContext,
      runtime,
      jobWorkflowProvider: { id: "jobs" },
      knowledgeSourceService: { id: "sources" },
      metadataStore,
      clientRuntimeAllocator,
      modelDecisionRuntime,
      strategyManagementProvider,
      agentWorkspace,
      accessControlContext,
      consoleDomainServices: { id: "domain-services" }
    });

    const common = {
      requestBody: jsonBody({ flag: true, reason: "unit" }),
      url: new URL("http://localhost/api?limit=7&format=short"),
      response: { id: "response" },
      authSession: { userId: "owner" },
      sourceId: "source-1",
      packageId: "package-1",
      reviewId: "review-1",
      runId: "run-1",
      projectId: "project-1",
      artifactId: "artifact-1",
      stageId: "stage-1",
      suggestionId: "suggestion-1",
      skillId: "skill-1",
      deploymentId: "deployment-1",
      documentId: "document-1",
      itemId: "item-1",
      evidenceId: "evidence-1",
      assetId: "asset-1"
    };

    for (const name of Object.keys(handlers).sort()) {
      await handlers[name](common);
    }

    expect(sendConsoleDomainOperation).toHaveBeenCalledTimes(Object.keys(handlers).length);
    expect(callByOperationId(sendConsoleDomainOperation, "knowledge.sources.update")).toMatchObject({
      input: { flag: true, reason: "unit", sourceId: "source-1" },
      context: { knowledgeSourceService: { id: "sources" } }
    });
    expect(callByOperationId(sendConsoleDomainOperation, "knowledge.golden_rules.publish")).toMatchObject({
      input: { flag: true, reason: "unit", packageId: "package-1" },
      context: { scope: "workflow", authSession: common.authSession }
    });
    expect(callByOperationId(sendConsoleDomainOperation, "external.knowledge.distillation.artifacts.export")).toMatchObject({
      input: {
        protocol: { limit: "7", format: "short" },
        bodyBytes: 0,
        runId: "run-1",
        artifactId: "artifact-1"
      }
    });
    expect(callByOperationId(sendConsoleDomainOperation, "knowledge.search")).toMatchObject({
      input: {
        protocol: { limit: "7", format: "short" },
        bodyBytes: common.requestBody.length
      },
      context: {
        runtime,
        metadataStore,
        clientRuntimeAllocator,
        modelDecisionRuntime,
        strategyManagementProvider,
        agentWorkspace,
        authSession: common.authSession
      }
    });
    expect(callByOperationId(sendConsoleDomainOperation, "knowledge.evidence")).toMatchObject({
      input: { evidenceId: "evidence-1" },
      context: { scope: "access", runtime, authSession: common.authSession }
    });
    expect(callByOperationId(sendConsoleDomainOperation, "search.query")).toMatchObject({
      input: { query: { limit: "7", format: "short" } },
      context: { scope: "workflow", authSession: common.authSession }
    });
    expect(parseJsonBody).toHaveBeenCalled();
    expect(protocolPayload).toHaveBeenCalled();
    expect(queryPayload).toHaveBeenCalledWith(common.url);
    expect(knowledgeDomainContext).toHaveBeenCalledWith(common.authSession);
    expect(knowledgeWorkflowContext).toHaveBeenCalledWith(common.authSession);
  });
});
