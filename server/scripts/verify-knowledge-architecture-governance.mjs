import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function assertIncludes(text, needle, message) {
  assert.equal(text.includes(needle), true, message);
}

function assertAllIncludes(text, needles, file) {
  for (const needle of needles) {
    assertIncludes(text, needle, `${file} must include ${needle}`);
  }
}

async function assertGovernanceDoc() {
  const file = "docs/KNOWLEDGE-GOVERNANCE.md";
  const text = await read(file);

  assertAllIncludes(text, [
    "Evidence Pack",
    "AgentLibrary",
    "中间层治理",
    "上游知识库太粗",
    "下游本地智能体太细",
    "权限精加工",
    "共享的知识",
    "图书馆",
    "借阅登记",
    "终端贡献与专家知识",
    "goldenRule",
    "expertOpinion",
    "贡献排行榜",
    "knowledgeAccessReceipt",
    "loanRecord",
    "智能体知识权限第一原则",
    "知识权限",
    "动态解析与预算",
    "知识维护闭环",
    "source-level governance",
    "门禁卡",
    "楼层",
    "书架",
    "controlledView",
    "checkoutAllowed",
    "不能合并成一个“可访问”布尔值",
    "外部知识库再授权",
    "演示场景：上游知识库 A/B 权限再授权",
    "管控台",
    "对话页面",
    "权限错误",
    "上游知识库的信息和资源权限再分配",
    "upstream knowledge base",
    "authorizationOverlay",
    "derivedKnowledgeSpace",
    "knowledgeBase",
    "pact.knowledge.v1",
    "npm run server:verify:knowledge-architecture-governance",
    "npm run server:verify:external-knowledge-distillation",
    "npm run server:verify:external-knowledge-distillation-container",
    "npm run server:verify:external-knowledge-distillation-references",
    "raw-corpus-construction",
    "knowledge-index-construction",
    "knowledge-distillation",
    "knowledge.export.docx",
    "GET /api/knowledge/export/docx",
    "format-conversion-only",
    "unified dossier",
    "raw-corpus.format.convert",
    "knowledge.dossier.export",
    "knowledge.distillation.export",
    "outputFormat",
    "targetFormat",
    "所有受支持原始输入格式都必须能导出为 DOCX",
    "从新到旧",
    "markdown-section-v1",
    "sectionId",
    "sourceRange",
    "contextBudget.knowledgeTokens",
    "payloadBudget.maxResponseBytes",
    "payload.nextContinuationToken",
    "structureArtifacts",
    "granularityFragments",
    "dispatchDynamicDocumentParsingAlgorithm",
    "bindDynamicDocumentParsingInvocation",
    "外部知识蒸馏验收流程",
    "external.knowledge.distillation",
    "RAGFlow",
    "MinerU",
    "Docling",
    "GraphRAG",
    "human-agent-response-profile-separation.v1",
    "office-document-professional-adaptation.v1",
    "npm run server:verify:knowledge-industrial-distillation"
  ], file);
}

async function assertProtocolDocs() {
  const protocols = await read("docs/PROTOCOLS.md");
  const server = await read("docs/SERVER.md");
  const architecture = await read("docs/Architecture.md");
  const workspace = await read("docs/WORKSPACE-ASSET-GOVERNANCE.md");
  const knowledgeProtocol = await read("server/protocols/knowledge/README.md");

  assertAllIncludes(protocols, [
    "pact.knowledge.v1",
    "pact.workspace.v1",
    "pact.operation.v1",
    "pact.context-bundle.v1",
    "pact.knowledge-access.v1",
    "pact.agent-library.v1",
    "pact.workspace-contribution.v1",
    "Middle Layer Strategy",
    "上游资源经过 Pact 后变细",
    "下游本地智能体经过 Pact 后能共享部分资产和能力",
    "knowledgeBase",
    "knowledge.search",
    "knowledge.export.docx",
    "knowledge.document.structure",
    "GET /api/knowledge/export/docx",
    "Tool Management v1",
    "dynamic-parameter-document-parsing-policy",
    "contextBudget.knowledgeTokens",
    "granularity.secondaryParse.enabled",
    "structureArtifacts",
    "granularityFragments",
    "dispatchDynamicDocumentParsingAlgorithm",
    "bindDynamicDocumentParsingInvocation",
    "payloadBudget.maxResponseBytes",
    "payload.nextContinuationToken",
    "portable.knowledge-distillation.v1",
    "contentBlocks",
    "format-conversion-only",
    "unified dossier",
    "所有受支持原始输入格式都必须能以 DOCX 作为目标格式导出",
    "raw-corpus.format.convert",
    "knowledge.dossier.export",
    "knowledge.distillation.export",
    "outputFormat",
    "targetFormat",
    "Workspace API",
    "Operation Protocol",
    "Context Bundle Protocol",
    "Workspace Contribution Protocol",
    "Compatibility Strategy",
    "两个问题，一个能力，三个兼容",
    "agent-client-mcp-compatibility",
    "external-service-compatibility",
    "pact-internal-compatibility",
    "Pact 管理软件",
    "assetContributionReportV0",
    "workspaceId/contributions/report",
    "contributionGrant",
    "rankScore",
    "pact.checkpoint-tree.v1",
    "Unified Checkpoint Tree Protocol",
    "checkpointNodeId",
    "effectKind",
    "access.requested",
    "access.denied",
    "file.changed",
    "skill.invoked",
    "workspace.checkpoint.restore.preview",
    "workspace.operation.revert.scope",
    "checkpoint.restored",
    "git worktree",
    "MCP Demo Flows",
    "Pact MCP service",
    "OpenClaw 文档互通演示",
    "Skill 贡献排行榜演示",
    "workspace.skill.usage.report",
    "rankScoreV0",
    "usageCount * successRate",
    "skillExecutionCount",
    "Knowledge Access Protocol",
    "libraryCardId",
    "knowledgeAccessReceipt",
    "loanRecord",
    "requestedEgress",
    "denied request audit",
    "checkoutPolicy",
    "controlledView",
    "checkoutAllowed",
    "canCopyToContext",
    "不能作为 hidden context",
    "upstreamKnowledgeRef",
    "derivedViewRef",
    "authorizationOverlay",
    "upstreamAccessDenied",
    "Upstream Permission Demo Flow",
    "上游知识库 A/B 权限再授权演示",
    "requestedEgress=exportFile",
    "权限错误",
    "denied request audit",
    "下游智能体",
    "toolGrantId",
    "原始语料全文",
    "校验、引用、补证",
    "pact.external-knowledge-distillation.industrial-benchmark.v1",
    "external.knowledge.distillation",
    "RAGFlow",
    "MinerU",
    "Docling",
    "GraphRAG",
    "human/agent",
    "Office"
  ], "docs/PROTOCOLS.md");

  assertAllIncludes(protocols, [
    "server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs",
    "qdrant",
    "opensearch",
    "pgvector",
    "PACT_EXTERNAL_KB_PROVIDER"
  ], "docs/PROTOCOLS.md");

  assertAllIncludes(server, [
    "knowledgeBase",
    "KnowledgeCore",
    "pact.knowledge.v1",
    "mount-modules.json",
    "热插拔",
    "热切换",
    "热重载",
    "knowledge-core/knowledge.sqlite",
    "knowledge-core/assets/",
    "GET /api/knowledge/assets/:assetId",
    "GET /api/knowledge/export/docx",
    "knowledge export-docx --output knowledge.docx",
    "evidence pack",
    "DocumentOutlineRuntime",
    "POST /api/knowledge/document-parser/parse",
    "动态参数文档解析策略",
    "结构吸附切分原则",
    "文档切分无关粗细",
    "contextBudget.knowledgeTokens",
    "dispatchDynamicDocumentParsingAlgorithm",
    "bindDynamicDocumentParsingInvocation",
    "payloadBudget.maxResponseBytes",
    "payload.nextContinuationToken",
    "pact.external-knowledge-distillation.industrial-benchmark.v1",
    "external.knowledge.distillation",
    "route-first",
    "Office 专业适配",
    "server:verify:knowledge-industrial-distillation"
  ], "docs/SERVER.md");

  assertAllIncludes(server, [
    "server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs",
    "PACT_SERVER_KNOWLEDGE_BASE_MODULE",
    "PACT_EXTERNAL_KB_PROVIDER",
    "PACT_EXTERNAL_KB_CONNECTION_STRING"
  ], "docs/SERVER.md");

  assertAllIncludes(architecture, [
    "Team Workspace Asset Governance System",
    "中间狭窄地带",
    "两个问题，一个能力，三个兼容",
    "知识库缺少面向智能体的权限管控",
    "本地智能体相对独立，难以协同",
    "工作空间管理",
    "agent-client-mcp-compatibility",
    "external-service-compatibility",
    "pact-internal-compatibility",
    "资产贡献统计报表",
    "上游知识库太粗",
    "下游本地智能体太细",
    "公共工作空间",
    "权限从源头治理",
    "derivedKnowledgeSpace",
    "上游知识库的信息和资源权限再分配",
    "authorizationOverlay",
    "上游知识库 A/B 权限再授权演示",
    "对话页面",
    "权限错误",
    "Knowledge Evidence API",
    "Context Compiler",
    "终端贡献是第二信息源",
    "OpenClaw 文档互通演示",
    "Skill 贡献排行榜演示",
    "Pact MCP service",
    "rankScoreV0",
    "ContributionRegistry",
    "LeaderboardRuntime",
    "Operation Ledger",
    "Checkpoint Tree",
    "统一 Checkpoint Tree",
    "所有访问请求",
    "所有文件变动",
    "所有知识贡献",
    "所有技能调用",
    "checkpointNodeId",
    "effectKind",
    "恢复到此节点",
    "git worktree",
    "raw-corpus-construction",
    "knowledge-index-construction",
    "knowledge-distillation",
    "Tool Management"
  ], "docs/Architecture.md");

  assertAllIncludes(workspace, [
    "Workspace Asset Governance System",
    "两个问题，一个能力，三个兼容",
    "知识库缺少面向智能体的权限管控",
    "本地智能体相对独立，难以协同",
    "agent-client-mcp-compatibility",
    "external-service-compatibility",
    "pact-internal-compatibility",
    "终端贡献型资产",
    "排行榜与统计面板",
    "资产贡献统计报表",
    "assetContributionReportV0",
    "贡献授权",
    "演示场景：OpenClaw 文档互通",
    "演示场景：Skill 贡献排行榜",
    "workspace.contribution.submit",
    "workspace.skill.list",
    "rankScoreV0",
    "Operation Ledger",
    "统一 Checkpoint Tree",
    "所有的一切都必须进入同一棵树",
    "访问请求",
    "文件变动",
    "知识贡献",
    "技能调用",
    "checkpointNode",
    "effectKind",
    "Snapshot Boundary",
    "演示场景：Checkpoint Tree 安全恢复",
    "workspace.checkpoint.restore",
    "恢复到此节点",
    "git worktree",
    "Proposal To Decision",
    "资产门禁模型",
    "knowledgeAccessReceipt",
    "loanRecord",
    "上游知识库隔离",
    "上游知识库的信息和资源权限再分配",
    "upstreamKnowledgeRef",
    "authorizationOverlay",
    "演示场景：上游知识库 A/B 权限再授权",
    "管控台",
    "权限错误",
    "controlledView",
    "checkoutAllowed",
    "Context Compiler",
    "evidence",
    "decision",
    "智能体不能直接覆盖 canonical state"
  ], "docs/WORKSPACE-ASSET-GOVERNANCE.md");

  assertAllIncludes(knowledgeProtocol, [
    "动态参数文档解析策略",
    "structure-adhesive",
    "default size",
    "dynamic-parameter-document-parsing-policy",
    "contextBudget.knowledgeTokens",
    "granularity.secondaryParse.enabled",
    "structureArtifacts",
    "granularityFragments",
    "parentArtifactId",
    "fragmentationTrace",
    "completeOriginalAvailable",
    "dispatchDynamicDocumentParsingAlgorithm",
    "bindDynamicDocumentParsingInvocation",
    "payloadBudget.maxResponseBytes",
    "payload.nextContinuationToken",
    "continuationToken",
    "format-conversion-only",
    "every supported raw input format must be exportable to DOCX",
    "newest-to-oldest unified dossiers",
    "raw corpus full text first",
    "raw-corpus.format.convert",
    "knowledge.dossier.export",
    "knowledge.distillation.export",
    "targetFormat",
    "outputFormat",
    "Export support does not replace the local knowledge-base runtime shape",
    "local agent retrieval",
    "self-contained Markdown/DOCX/HTML/PDF-style portable documents",
    "External Knowledge Distillation",
    "external.knowledge.distillation",
    "external.knowledge.distillation.runs.create",
    "external.knowledge.distillation.evidence.query",
    "external.knowledge.distillation.artifacts.export"
  ], "server/protocols/knowledge/README.md");

}

async function assertDynamicParsingImplementation() {
  const module = await read("server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs");
  const runtime = await read("server/platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs");
  const preprocessResult = await read("server/platform/specialized/knowledge/preprocessing/preprocess-result.mjs");
  const knowledgeViewStateController = await read("server-web/composables/console-knowledge-view-state-controller.ts");
  const splitDocumentTypes = await read("server-web/lib/types/split/documents.ts");
  const packageJson = await read("package.json");

  assertAllIncludes(module, [
    "dynamic-parameter-document-parsing-policy",
    "dispatchDynamicDocumentParsingAlgorithm",
    "bindDynamicDocumentParsingInvocation",
    "parseParagraphSentenceV1",
    "parseTableRowWindowV1",
    "parseTableCellWindowV1",
    "parseCodeLineWindowV1",
    "parseTokenWindowFallbackV1",
    "structureArtifacts",
    "granularityFragments",
    "fragmentationTrace",
    "completeOriginalAvailable"
  ], "server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs");

  assertAllIncludes(runtime, [
    "DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID",
    "unified-knowledge-ingest-v1",
    "bindDynamicDocumentParsingInvocation",
    "structureArtifacts",
    "granularityFragments",
    "backendTrace",
    "payload"
  ], "server/platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs");

  assertAllIncludes(preprocessResult, [
    "sanitizeStructureArtifact",
    "sanitizeGranularityFragment",
    "structureArtifacts",
    "granularityFragments"
  ], "server/platform/specialized/knowledge/preprocessing/preprocess-result.mjs");

  assertAllIncludes(knowledgeViewStateController, [
    "dynamicParsingPreviewConfig",
    "dynamic-parameter-v1",
    "unified-knowledge-ingest-v1",
    "contextBudget",
    "payloadBudget",
    "secondaryParse",
    "structureArtifacts",
    "granularityFragments",
    "parentArtifactId"
  ], "server-web/composables/console-knowledge-view-state-controller.ts");

  assertAllIncludes(splitDocumentTypes, [
    "contextBudget",
    "payloadBudget",
    "granularity",
    "dynamicParsing",
    "structureArtifacts",
    "granularityFragments"
  ], "server-web/lib/types/split/documents.ts");

  assertIncludes(packageJson, "server:verify:dynamic-document-parsing", "package.json must expose dynamic parsing verifier");
  assertIncludes(packageJson, "server:knowledge:industrial-distill-plan", "package.json must expose industrial distillation benchmark CLI");
  assertIncludes(packageJson, "server:verify:knowledge-industrial-distillation", "package.json must expose industrial distillation verifier");
}

async function assertIndustrialDistillationBenchmark() {
  const service = await read("external-services/knowledge-distillation-service/server.mjs");
  const references = await read("external-services/knowledge-distillation-service/reference-frameworks.json");
  const cli = await read("server/scripts/knowledge-distillation-industrial-benchmark.mjs");
  const verify = await read("server/scripts/verify-knowledge-industrial-distillation.mjs");
  const docs = await read("docs/KNOWLEDGE-GOVERNANCE.md");

  assertAllIncludes(service, [
    "external-service.route-window-community-claim-gated-graph-incremental-distillation.v5",
    "referenceGapReport",
    "hashing_embedding_window_community_classification_v3",
    "hierarchical-domain-topic-project-convergence.v3",
    "human-agent-response-profile-separation.v1",
    "office-document-professional-adaptation.v1",
    "professional-format-manifest-json"
  ], "external-services/knowledge-distillation-service/server.mjs");

  assertAllIncludes(references, [
    "ragflow",
    "mineru",
    "docling",
    "llama-index",
    "marker",
    "graphrag",
    "haystack",
    "unstructured"
  ], "external-services/knowledge-distillation-service/reference-frameworks.json");

  assertAllIncludes(cli, [
    "--output",
    "--compact",
    "reference-frameworks.json",
    "external.knowledge.distillation",
    "buildExternalIndustrialBenchmark",
    "external knowledge distillation industrial benchmark written"
  ], "server/scripts/knowledge-distillation-industrial-benchmark.mjs");

  assertAllIncludes(verify, [
    "reference-frameworks.json",
    "external.knowledge.distillation",
    "internal knowledge-distillation-runtime directory must be removed",
    "routePlan",
    "graphEvidence",
    "professionalOfficeAdaptation",
    "pact.external-knowledge-distillation.industrial-benchmark.v1"
  ], "server/scripts/verify-knowledge-industrial-distillation.mjs");

  assertAllIncludes(docs, [
    "外部知识蒸馏验收流程",
    "external.knowledge.distillation",
    "RAGFlow",
    "MinerU",
    "Docling",
    "LlamaIndex",
    "GraphRAG",
    "human-agent-response-profile-separation.v1",
    "office-document-professional-adaptation.v1"
  ], "docs/KNOWLEDGE-GOVERNANCE.md");
}

function assertOperationRegistry() {
  const byId = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  const requiredIds = [
    "knowledge.capabilities",
    "knowledge.console",
    "knowledge.health",
    "knowledge.search",
    "knowledge.search.get",
    "knowledge.document_parse",
    "knowledge.export_docx",
    "knowledge.document_structure",
    "knowledge.evidence",
    "knowledge.asset",
    "knowledge.render_markdown",
    "knowledge.maintenance.get",
    "knowledge.maintenance.run",
    "knowledge.review_items",
    "knowledge.review_resolve",
    "knowledge.feedback",
    "knowledge.learning.health",
    "knowledge.evidence_gate.evaluate",
    "knowledge.summarization.runs.create",
    "knowledge.agent_explore.runs.create",
    "agent_sessions.list",
    "agent_sessions.get",
    "agent_sessions.context.get",
    "agent_sessions.events.append",
    "agent_sessions.fork",
    "runtime.mounts",
    "runtime.set_mounts",
    "runtime.reload_mounts",
    "tool_management.catalog",
    "tool_management.policy_preview",
    "tool_management.execute",
    "tool_management.audit",
    "tool_management.metrics_summary"
  ];

  for (const id of requiredIds) {
    assert.ok(byId.has(id), `operation registry must include ${id}`);
    const operation = byId.get(id);
    assert.ok(operation.http || operation.rpc || operation.cli, `${id} must expose at least one public surface`);
  }

  const knowledgeOperations = SERVER_API_OPERATIONS.filter((operation) => operation.id.startsWith("knowledge."));
  assert.ok(knowledgeOperations.length >= 50, "operation registry must expose a broad knowledge capability surface");

  for (const operation of knowledgeOperations) {
    assert.equal(operation.feature, "knowledge", `${operation.id} must be owned by the knowledge feature`);
    assert.ok(operation.http || operation.rpc || operation.cli, `${operation.id} must expose HTTP, RPC, or CLI`);
    assert.ok(
      Array.isArray(operation.requiredScopes) && operation.requiredScopes.length > 0,
      `${operation.id} must declare requiredScopes`
    );
  }

  assert.deepEqual(byId.get("runtime.set_mounts")?.requiredScopes, ["runtime:admin"]);
  assert.deepEqual(byId.get("runtime.reload_mounts")?.requiredScopes, ["runtime:admin"]);
  assert.equal(byId.get("knowledge.asset")?.binary, true, "knowledge.asset must keep binary asset semantics");
  assert.equal(byId.get("knowledge.export_docx")?.binary, true, "knowledge.export_docx must keep DOCX binary semantics");
  assert.equal(byId.get("knowledge.export_docx")?.http?.path, "/api/knowledge/export/docx");
  assert.equal(byId.get("knowledge.export_docx")?.rpc?.method, "knowledge.export.docx");
  assert.equal(byId.get("agent_sessions.list")?.http?.path, "/api/agent-sessions");
  assert.equal(byId.get("agent_sessions.context.get")?.http?.path, "/api/agent-sessions/:sessionId/context");
  assert.deepEqual(byId.get("agent_sessions.fork")?.requiredScopes, ["workspace:write"]);
  assert.equal(byId.get("tool_management.execute")?.http?.path, "/api/tool-management/v1/execute");
  assert.equal(byId.get("tool_management.execute")?.safety?.risk, "safe_write");
}

function assertToolManagementCatalog() {
  const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
  const tool = catalog.tools.find((item) => item.id === "pact.knowledge.exportDocx");
  assert.ok(tool, "Tool Management catalog must include pact.knowledge.exportDocx");
  assert.equal(tool.operationId, "knowledge.export_docx");
  assert.deepEqual(tool.requiredScopes, ["knowledge:read"]);
  assert.equal(tool.outputSchema?.type, "binary");
  assert.equal(tool.transport?.http?.path, "/api/knowledge/export/docx");
  const sessionForkTool = catalog.tools.find((item) => item.id === "pact.agentSession.fork");
  assert.ok(sessionForkTool, "Tool Management catalog must include pact.agentSession.fork");
  assert.equal(sessionForkTool.operationId, "agent_sessions.fork");
  assert.deepEqual(sessionForkTool.requiredScopes, ["workspace:write"]);
}

async function assertFrontendCoverage() {
  const registry = await read("server/config/frontend-feature-registry.yaml");
  const router = await read("server-web/router/index.ts");
  const bridge = await read("server-web/lib/bridge.ts");
  const jobsClient = await read("server-web/lib/jobs-client.ts");
  const knowledgeDocuments = await read("server-web/lib/knowledge-documents.ts");
  const knowledgeDocumentsClient = await read("server-web/lib/knowledge-documents-client.ts");
  const knowledgeView = await read("server-web/views/KnowledgeView.vue");
  const knowledgeIngestPanel = await read("server-web/components/knowledge/KnowledgeIngestPanel.vue");
  const approvalFlowView = await read("server-web/views/ApprovalFlowView.vue");
  const approvalFlowController = await read("server-web/composables/console-approval-flow-view-controller.ts");
  const knowledgeImportCard = await read("server-web/components/KnowledgeImportCard.vue");
  const workspacesView = await read("server-web/views/WorkspacesView.vue");
  const debugView = await read("server-web/views/DebugView.vue");
  const knowledgeRecallDebugPanel = await read("server-web/components/debug/KnowledgeRecallDebugPanel.vue");
  const agentRetrievalForm = await read("server-web/components/debug/AgentRetrievalForm.vue");
  const knowledgeRecallController = await read("server-web/composables/console-knowledge-recall-controller.ts");
  const agentExploreSessionController = await read("server-web/composables/console-agent-explore-session-controller.ts");
  const agentExploreClient = await read("server-web/lib/agent-explore-client.ts");
  const debugDistillationRunner = await read("server-web/composables/console-debug-distillation-runner.ts");
  const debugViewContext = await read("server-web/composables/debugViewContext.ts");
  const knowledgeIngestController = await read("server-web/composables/console-knowledge-ingest-controller.ts");
  const jobController = await read("server-web/composables/console-job-controller.ts");
  const toolsView = await read("server-web/views/admin/ToolsView.vue");
  const modulesView = await read("server-web/views/admin/ModulesView.vue");
  const consoleComposable = await read("server-web/composables/useConsole.ts");

  assertAllIncludes(registry, [
    "workspace.knowledge-context",
    "knowledge.governance-console",
    "approval.workflow",
    "debug.knowledge-governance",
    "admin.tool-management-governance",
    "admin.knowledge-mount-governance",
    "knowledge.tab.chunking",
    "knowledge.document-chunking",
    "knowledge.docx-export.download",
    "knowledge.normalized-docx.download",
    "approval.knowledge-conflict.review",
    "approval.mcp-authorize.review",
    "knowledge.console.inspect",
    "debug.knowledge-recall.compare",
    "admin.tools.policy.evaluate",
    "admin.modules.knowledge-mount.configure"
  ], "server/config/frontend-feature-registry.yaml");

  assertAllIncludes(router, [
    'path: "/knowledge/:tab"',
    'path: "/approval"',
    'path: "/workspaces"',
    'path: "/debug/:tab"',
    'path: "/admin/tools"',
    'path: "/admin/modules"'
  ], "server-web/router/index.ts");

  assertAllIncludes(bridge, [
    "searchKnowledge",
    "getKnowledgeEvidence",
    "knowledgeAssetUrl",
    "knowledgeDocxExportUrl",
    "saveRuntimeMounts",
    "reloadRuntimeMounts",
    "getToolManagementCatalog",
    "getClientRuntimeStatus"
  ], "server-web/lib/bridge.ts");

  assertAllIncludes(knowledgeDocumentsClient, [
    "/api/knowledge/export/docx",
    "knowledgeDocxExportUrl",
    "normalizedDocumentUrl"
  ], "server-web/lib/knowledge-documents-client.ts");

  assertAllIncludes(jobsClient, [
    "createJob",
    "reparseJob",
    "listJobs",
    "deleteJob",
    "getJob",
    "getJobResult",
    "/api/jobs",
    "/reparse",
    "/result"
  ], "server-web/lib/jobs-client.ts");
  assert.equal(bridge.includes("/api/jobs"), false, "server-web/lib/bridge.ts must delegate job lifecycle endpoints to jobs-client.ts");

  assertAllIncludes(knowledgeView, [
    "activeKnowledgeTab === 'management'",
    "activeKnowledgeTab === 'wordCloud'",
    "activeKnowledgeTab === 'maintenance'",
    "knowledgeManagementPanel.value === \"knowledge\"",
    "knowledgeManagementPanel.value === \"rules\"",
    "KnowledgeIngestPanel",
    "dynamicParsingPolicySignature"
  ], "server-web/views/KnowledgeView.vue");

  assertAllIncludes(knowledgeIngestPanel, [
    "useKnowledgeViewContext",
    "previewKnowledgeDocuments",
    "normalizedKnowledgeDocumentUrl",
    "dynamicParsingPreviewConfig",
    "uploadFilesToKnowledge",
    "onIngestFilesSelected"
  ], "server-web/components/knowledge/KnowledgeIngestPanel.vue");

  assertAllIncludes(approvalFlowView, [
    "全平台审批流",
    "ApprovalFlowCardList",
    "useApprovalFlowViewController"
  ], "server-web/views/ApprovalFlowView.vue");

  assertAllIncludes(approvalFlowController, [
    "MCP 客户端授权",
    "知识入库冲突",
    "refreshMcpAuthorizationRequests",
    "refreshKnowledgeConflicts",
    "resolveMcpAuthorizationRequest",
    "resolveKnowledgeReview"
  ], "server-web/composables/console-approval-flow-view-controller.ts");

  assertAllIncludes(knowledgeImportCard, [
    "knowledgeExportUrl",
    "normalizedKnowledgeDocumentUrl",
    "开始解析",
    "DOCX",
    "生成文档",
    "Number(ingestJob.progressPercent || 0)"
  ], "server-web/components/KnowledgeImportCard.vue");

  assertAllIncludes(knowledgeDocuments, [
    "knowledgeDocxExportUrl",
    "normalizedDocumentUrl"
  ], "server-web/lib/knowledge-documents.ts");

  assertAllIncludes(workspacesView, [
    "knowledgeScope",
    "knowledgeSourceIds",
    "/api/agent-workspaces",
    "/context",
    "HistorySessionPanel",
    "/api/agent-sessions",
    "agentSessionId",
    "分叉"
  ], "server-web/views/WorkspacesView.vue");

  assertAllIncludes(debugView, [
    "knowledgeRecall",
    "agentRetrieval",
    "KnowledgeRecallDebugPanel",
    "AgentRetrievalDebugPanel"
  ], "server-web/views/DebugView.vue");

  assertAllIncludes(knowledgeRecallDebugPanel, [
    "runKnowledgeRecallDebugBatch",
    "openAgentEvidencePreview"
  ], "server-web/components/debug/KnowledgeRecallDebugPanel.vue");

  assertAllIncludes(knowledgeRecallController, [
    "runKnowledgeRecallDebugBatch",
    "buildKnowledgeRecallSearchPayload"
  ], "server-web/composables/console-knowledge-recall-controller.ts");

  assertAllIncludes(agentRetrievalForm, [
    "runKnowledgeAgentExplore"
  ], "server-web/components/debug/AgentRetrievalForm.vue");

  assertAllIncludes(agentExploreSessionController, [
    "runKnowledgeAgentExplore",
    "runKnowledgeAgentExploreApi",
    "getKnowledgeAgentExploreRun"
  ], "server-web/composables/console-agent-explore-session-controller.ts");
  assertAllIncludes(agentExploreClient, [
    "/api/knowledge/agent-explore/runs",
    "/api/agent-workspaces"
  ], "server-web/lib/agent-explore-client.ts");

  assertAllIncludes(debugDistillationRunner, [
    "from \"../lib/jobs-client\"",
    "createJob({",
    "getJob(jobId)"
  ], "server-web/composables/console-debug-distillation-runner.ts");

  assertAllIncludes(debugViewContext, [
    "openAgentEvidencePreview"
  ], "server-web/composables/debugViewContext.ts");

  assertAllIncludes(knowledgeIngestController, [
    "from \"../lib/jobs-client\"",
    "createKnowledgeUploadSession(filesToUpload",
    "createJob({",
    "getJob(ingestJob.value.id)",
    "getNormalizedDocuments(job.id)"
  ], "server-web/composables/console-knowledge-ingest-controller.ts");

  assertAllIncludes(jobController, [
    "from \"../lib/jobs-client\"",
    "deleteJobRequest(jobId)",
    "function upsertJobFromEvent",
    "const filteredJobs = computed"
  ], "server-web/composables/console-job-controller.ts");

  assertAllIncludes(toolsView, [
    "toolManagementCatalogState",
    "toolManagementTools",
    "toolManagementProfiles",
    "tool-policy-preview",
    "toolGrants"
  ], "server-web/views/admin/ToolsView.vue");

  assertAllIncludes(modulesView, [
    "mountDraft",
    "moduleGroups",
    "enableMountModule",
    "disableMountModule",
    "mountGeneration"
  ], "server-web/views/admin/ModulesView.vue");

  assertAllIncludes(consoleComposable, [
    "knowledgeBase",
    "saveRuntimeMounts",
    "reloadRuntimeMounts",
    "enableMountModule",
    "disableMountModule",
    "async function uploadFilesToKnowledge()",
    "createKnowledgeUploadSession(filesToUpload",
    "jobs-client.createJob({"
  ], "server-web/composables/useConsole.ts");
}

async function assertStandardDataDirectory() {
  const startServer = await read("server/scripts/start-server.mjs");
  const resolveDataDir = await read("server/scripts/resolve-server-data-dir.mjs");
  const rootHygiene = await read("tests/verify-root-hygiene.mjs");
  const docs = await read("docs/SERVER.md");
  assertIncludes(startServer, "ServerConfig.getDataDir()", "start-server must use ServerConfig.getDataDir()");
  assertIncludes(resolveDataDir, "ServerConfig.getDataDir()", "shell entrypoints must resolve data dir through ServerConfig");
  assertIncludes(rootHygiene, "Server data dir defaults must resolve through ServerConfig.getDataDir()", "repo hygiene must enforce data-dir policy");
  assertIncludes(docs, "ServerConfig.getDataDir()", "docs must document the standard data directory source");
  for (const text of [startServer, resolveDataDir, rootHygiene, docs]) {
    assert.equal(text.includes("build/server-data"), false, "server data dir policy must not mention build/server-data as a default");
  }
}

async function main() {
  await assertGovernanceDoc();
  await assertProtocolDocs();
  await assertDynamicParsingImplementation();
  await assertIndustrialDistillationBenchmark();
  assertOperationRegistry();
  assertToolManagementCatalog();
  await assertFrontendCoverage();
  await assertStandardDataDirectory();
}

await main();
console.log("knowledge architecture governance verification passed");
