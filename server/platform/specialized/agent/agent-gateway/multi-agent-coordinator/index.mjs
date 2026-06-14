import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

export const MULTI_AGENT_COORDINATOR_PROTOCOL_VERSION = "v0.0.1:agent:multi-agent-1";

export const DEFAULT_SUMMARIZATION_ROLES = [
  {
    roleId: "Extractor",
    modelAlias: "qwen-v3-32b",
    contextProfileId: "small-context",
    allowedTools: ["knowledge.search", "knowledge.evidence"],
    writePolicy: {
      allowedTypes: ["evidenceCard", "evidenceRef", "taskState"]
    }
  },
  {
    roleId: "TopicOrganizer",
    modelAlias: "qwen-v3-32b",
    contextProfileId: "small-context",
    allowedTools: ["workspace.read"],
    writePolicy: {
      allowedTypes: ["taskState", "contextSummary"]
    }
  },
  {
    roleId: "DomainAnalyst",
    modelAlias: "deepseek-v3-671b",
    contextProfileId: "balanced",
    allowedTools: ["workspace.read", "knowledge.search"],
    writePolicy: {
      allowedTypes: ["claim", "decisionProposal", "contextSummary"]
    }
  },
  {
    roleId: "Writer",
    modelAlias: "deepseek-v3-671b",
    contextProfileId: "balanced",
    allowedTools: ["workspace.read"],
    writePolicy: {
      allowedTypes: ["artifact", "contextSummary"]
    }
  },
  {
    roleId: "Reviewer",
    modelAlias: "deepseek-v3-671b",
    contextProfileId: "balanced",
    allowedTools: ["workspace.read", "knowledge.evidence"],
    writePolicy: {
      allowedTypes: ["issue", "contextSummary"]
    }
  },
  {
    roleId: "Merger",
    modelAlias: "deepseek-v3-671b",
    contextProfileId: "balanced",
    allowedTools: ["workspace.read"],
    writePolicy: {
      allowedTypes: ["artifact", "decisionProposal"]
    }
  }
];

const DEFAULT_SUMMARIZATION_EDGES = [
  ["Plan", "Retrieve"],
  ["Retrieve", "ExtractEvidence"],
  ["ExtractEvidence", "OrganizeTopics"],
  ["OrganizeTopics", "ParallelAnalysts"],
  ["ParallelAnalysts", "Writer"],
  ["Writer", "Reviewer"],
  ["Reviewer", "Merger"],
  ["Merger", "PublishArtifact"]
];

function overwriteAnnotation(defaultValue) {
  return Annotation({
    reducer: (_current, incoming) => incoming,
    default: () => (typeof defaultValue === "function" ? defaultValue() : defaultValue)
  });
}

const CoordinatorState = Annotation.Root({
  input: overwriteAnnotation({}),
  workspaceId: overwriteAnnotation(""),
  runId: overwriteAnnotation(""),
  steps: overwriteAnnotation(() => []),
  contextPack: overwriteAnnotation(null),
  searchResult: overwriteAnnotation(null),
  evidenceCards: overwriteAnnotation(() => []),
  topics: overwriteAnnotation(() => []),
  analystOutputs: overwriteAnnotation(() => []),
  draftArtifact: overwriteAnnotation(null),
  reviewReport: overwriteAnnotation(null),
  finalArtifact: overwriteAnnotation(null),
  artifactIds: overwriteAnnotation(() => []),
  degraded: overwriteAnnotation(false),
  errors: overwriteAnnotation(() => []),
  metadata: overwriteAnnotation({})
});

function normalizeNodes(nodes = {}) {
  if (nodes instanceof Map) {
    return Object.fromEntries(nodes.entries());
  }
  return nodes && typeof nodes === "object" && !Array.isArray(nodes) ? nodes : {};
}

function normalizeEdges(edges = DEFAULT_SUMMARIZATION_EDGES) {
  return (Array.isArray(edges) && edges.length ? edges : DEFAULT_SUMMARIZATION_EDGES)
    .map((edge) => (Array.isArray(edge) ? edge : [edge?.from, edge?.to]))
    .filter(([from, to]) => from && to);
}

export function createMultiAgentCoordinator({
  workflowName = "knowledge-summarization-v1",
  nodes = {},
  edges = DEFAULT_SUMMARIZATION_EDGES,
  checkpointer = new MemorySaver()
} = {}) {
  const nodeMap = normalizeNodes(nodes);
  const normalizedEdges = normalizeEdges(edges);
  const startNode = normalizedEdges[0]?.[0];
  const terminalNode = normalizedEdges.at(-1)?.[1];
  const graph = new StateGraph(CoordinatorState);
  const nodeNames = new Set(normalizedEdges.flat());

  for (const nodeName of nodeNames) {
    const handler = nodeMap[nodeName];
    graph.addNode(
      nodeName,
      typeof handler === "function"
        ? handler
        : async (state) => ({
            steps: [
              ...(Array.isArray(state.steps) ? state.steps : []),
              {
                node: nodeName,
                status: "skipped",
                at: new Date().toISOString()
              }
            ]
          })
    );
  }

  if (!startNode || !terminalNode) {
    throw new Error("MultiAgentCoordinator requires at least one edge.");
  }

  graph.addEdge(START, startNode);
  for (const [from, to] of normalizedEdges) {
    graph.addEdge(from, to);
  }
  graph.addEdge(terminalNode, END);

  const compiled = graph.compile({ checkpointer });

  async function run(initialState = {}, options = {}) {
    const threadId =
      String(options.threadId || initialState.runId || initialState.workspaceId || workflowName).trim() ||
      workflowName;
    const startedAt = new Date().toISOString();
    const result = await compiled.invoke(
      {
        ...initialState,
        metadata: {
          ...(initialState.metadata || {}),
          workflowName,
          graphRuntime: "langgraph-js",
          startedAt
        }
      },
      {
        configurable: {
          thread_id: threadId
        }
      }
    );
    return {
      protocolVersion: MULTI_AGENT_COORDINATOR_PROTOCOL_VERSION,
      workflowName,
      threadId,
      graphRuntime: "langgraph-js",
      roles: DEFAULT_SUMMARIZATION_ROLES,
      state: result
    };
  }

  return {
    protocolVersion: MULTI_AGENT_COORDINATOR_PROTOCOL_VERSION,
    workflowName,
    graphRuntime: "langgraph-js",
    roles: DEFAULT_SUMMARIZATION_ROLES,
    edges: normalizedEdges.map(([from, to]) => ({ from, to })),
    run
  };
}

export default createMultiAgentCoordinator;
