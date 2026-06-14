function layer({
  id,
  label,
  capability,
  queueStatus,
  queueLabel = "",
  taskType = "",
  runtimeOwner,
  description
}) {
  return Object.freeze({
    id,
    label,
    capability,
    queueStatus,
    queueLabel,
    taskType,
    runtimeOwner,
    description,
    aspect: `knowledge-layer:${id}`,
    capabilityAspect: `knowledge-capability:${capability}`
  });
}

export const KNOWLEDGE_CAPABILITY_LAYERS = Object.freeze({
  CORPUS_INGESTION: layer({
    id: "corpus-ingestion",
    label: "Corpus ingestion",
    capability: "parse-and-index",
    queueStatus: "work-queue-connected",
    queueLabel: "pact.jobs.import-parse",
    taskType: "import_parse_job",
    runtimeOwner: "JobManager + Pact Work Queue",
    description: "Parse uploads, files, source refreshes, and reparse requests into normalized knowledge records."
  }),
  KNOWLEDGE_RUNTIME: layer({
    id: "knowledge-runtime",
    label: "Knowledge runtime",
    capability: "search-evidence-maintenance",
    queueStatus: "not-queue-candidate",
    runtimeOwner: "KnowledgeCore or external knowledge-base adapter",
    description: "Serve search, evidence, assets, graph, health, export, sync, maintenance, and reindex surfaces."
  }),
  CORPUS_ORGANIZATION: layer({
    id: "corpus-organization",
    label: "Corpus organization",
    capability: "word-clouds-and-word-bags",
    queueStatus: "not-queue-candidate",
    runtimeOwner: "Metadata store",
    description: "Maintain manual word-cloud and word-bag organization artifacts from indexed vocabulary."
  }),
  RETRIEVAL_LEARNING: layer({
    id: "retrieval-learning",
    label: "Retrieval learning",
    capability: "feedback-to-retrieval-profile",
    queueStatus: "not-connected",
    runtimeOwner: "KnowledgeCore + LearningRuntime",
    description: "Convert feedback into retrieval profile candidates and reviewable learning suggestions."
  }),
  EVALUATION_GATES: layer({
    id: "evaluation-gates",
    label: "Evaluation and gates",
    capability: "offline-quality-gates",
    queueStatus: "not-connected",
    runtimeOwner: "AgentEvaluationRuntime + KnowledgeSkill runtime",
    description: "Replay cases and compute retrieval, skill, and evidence quality gates."
  }),
  EVOLUTION_GOVERNANCE: layer({
    id: "evolution-governance",
    label: "Evolution governance",
    capability: "closed-loop-governance",
    queueStatus: "compound-not-connected",
    runtimeOwner: "KnowledgeEvolutionRuntime",
    description: "Orchestrate feedback attribution, candidate proposals, evaluation, canary publication, and rollback."
  }),
  AGENT_PRODUCTION: layer({
    id: "agent-production",
    label: "Agent production",
    capability: "agent-runs-and-artifacts",
    queueStatus: "local-or-sync",
    runtimeOwner: "AgentWorkspace + ContextRuntime + agent runtimes",
    description: "Create exploration answers, summaries, KnowledgeSkills, rule drafts, and reviewable artifacts."
  }),
  EXTERNAL_DISTILLATION: layer({
    id: "external-distillation",
    label: "External distillation",
    capability: "external-route-classify-distill",
    queueStatus: "external-service",
    runtimeOwner: "external.knowledge.distillation service",
    description: "Call the external distillation service for classification, convergence, grounding, graph evidence, and artifacts."
  })
});

export const KNOWLEDGE_CAPABILITY_LAYER_ORDER = Object.freeze([
  KNOWLEDGE_CAPABILITY_LAYERS.CORPUS_INGESTION,
  KNOWLEDGE_CAPABILITY_LAYERS.KNOWLEDGE_RUNTIME,
  KNOWLEDGE_CAPABILITY_LAYERS.CORPUS_ORGANIZATION,
  KNOWLEDGE_CAPABILITY_LAYERS.RETRIEVAL_LEARNING,
  KNOWLEDGE_CAPABILITY_LAYERS.EVALUATION_GATES,
  KNOWLEDGE_CAPABILITY_LAYERS.EVOLUTION_GOVERNANCE,
  KNOWLEDGE_CAPABILITY_LAYERS.AGENT_PRODUCTION,
  KNOWLEDGE_CAPABILITY_LAYERS.EXTERNAL_DISTILLATION
]);

const KNOWLEDGE_RUNTIME_OPERATION_IDS = new Set([
  "knowledge.affair_taxonomy",
  "knowledge.console",
  "knowledge.config_schema",
  "knowledge.capabilities",
  "knowledge.export_docx",
  "knowledge.health",
  "knowledge.maintenance.get",
  "knowledge.maintenance.set",
  "knowledge.reindex",
  "knowledge.maintenance.run",
  "knowledge.sync",
  "knowledge.changes",
  "knowledge.review_items",
  "knowledge.review_resolve",
  "knowledge.evidence_gate.evaluate",
  "knowledge.search",
  "knowledge.search.get",
  "knowledge.document_parse",
  "knowledge.document_structure",
  "knowledge.item",
  "knowledge.evidence",
  "knowledge.asset",
  "knowledge.render_markdown",
  "knowledge.graph"
]);

const CORPUS_INGESTION_OPERATION_IDS = new Set([
  "jobs.create",
  "jobs.list",
  "jobs.get",
  "jobs.result",
  "jobs.delete",
  "jobs.reparse",
  "jobs.normalized_docs",
  "jobs.normalized_doc",
  "raw_objects.get"
]);

const RETRIEVAL_LEARNING_OPERATION_IDS = new Set([
  "knowledge.feedback",
  "knowledge.suggestions",
  "knowledge.suggestion_resolve",
  "knowledge.learning.jobs",
  "knowledge.learning.health"
]);

const EVALUATION_GATE_OPERATION_IDS = new Set([
  "knowledge.skills.evaluation.runs.create",
  "knowledge.training_sets.export",
  "knowledge.evaluation.runs.create",
  "knowledge.evaluation.runs.list",
  "knowledge.evaluation.runs.get",
  "knowledge.gold_cases.list",
  "knowledge.gold_cases.save"
]);

const EVOLUTION_GOVERNANCE_OPERATION_IDS = new Set([
  "knowledge.model_roles",
  "knowledge.model_decision",
  "knowledge.evolution.describe",
  "knowledge.evolution.runs.create",
  "knowledge.evolution.runs.list",
  "knowledge.evolution.runs.get",
  "knowledge.hierarchy.audit",
  "knowledge.evolution.deployments.list",
  "knowledge.evolution.deployments.promote",
  "knowledge.evolution.deployments.rollback"
]);

const AGENT_PRODUCTION_OPERATION_IDS = new Set([
  "knowledge.agent_skill.describe",
  "knowledge.agent_skill.plan",
  "knowledge.agent_skill.run",
  "knowledge.skills.list",
  "knowledge.skills.get",
  "knowledge.skills.generate",
  "knowledge.skills.propose",
  "knowledge.skills.resolve",
  "knowledge.skills.deployments.create",
  "knowledge.skills.deployments.rollback",
  "knowledge.skills.framework",
  "knowledge.skills.framework_save",
  "knowledge.golden_rules.list",
  "knowledge.golden_rules.save",
  "knowledge.golden_rules.publish",
  "knowledge.golden_rules.rollback",
  "knowledge.rule_authoring.chat",
  "knowledge.rule_authoring.runs.get",
  "knowledge.summarization.runs.create",
  "knowledge.summarization.runs.get",
  "knowledge.summarization.runs.approve",
  "knowledge.agent_explore.runs.create",
  "knowledge.agent_explore.runs.get"
]);

function byPrefix(operationId) {
  if (operationId === "knowledge.word_clouds.propose") {
    return null;
  }
  if (operationId.startsWith("external.knowledge.distillation.")) {
    return KNOWLEDGE_CAPABILITY_LAYERS.EXTERNAL_DISTILLATION;
  }
  if (operationId.startsWith("knowledge.word_clouds.") || operationId.startsWith("knowledge.word_bags.")) {
    return KNOWLEDGE_CAPABILITY_LAYERS.CORPUS_ORGANIZATION;
  }
  if (operationId.startsWith("knowledge.agent_explore.") || operationId.startsWith("knowledge.summarization.")) {
    return KNOWLEDGE_CAPABILITY_LAYERS.AGENT_PRODUCTION;
  }
  if (operationId.startsWith("knowledge.evolution.")) {
    return KNOWLEDGE_CAPABILITY_LAYERS.EVOLUTION_GOVERNANCE;
  }
  if (operationId.startsWith("knowledge.evaluation.")) {
    return KNOWLEDGE_CAPABILITY_LAYERS.EVALUATION_GATES;
  }
  return null;
}

export function resolveKnowledgeCapabilityLayer(operationId = "") {
  const id = String(operationId || "").trim();
  if (!id) {
    return null;
  }
  if (CORPUS_INGESTION_OPERATION_IDS.has(id)) {
    return KNOWLEDGE_CAPABILITY_LAYERS.CORPUS_INGESTION;
  }
  if (RETRIEVAL_LEARNING_OPERATION_IDS.has(id)) {
    return KNOWLEDGE_CAPABILITY_LAYERS.RETRIEVAL_LEARNING;
  }
  if (EVALUATION_GATE_OPERATION_IDS.has(id)) {
    return KNOWLEDGE_CAPABILITY_LAYERS.EVALUATION_GATES;
  }
  if (EVOLUTION_GOVERNANCE_OPERATION_IDS.has(id)) {
    return KNOWLEDGE_CAPABILITY_LAYERS.EVOLUTION_GOVERNANCE;
  }
  if (AGENT_PRODUCTION_OPERATION_IDS.has(id)) {
    return KNOWLEDGE_CAPABILITY_LAYERS.AGENT_PRODUCTION;
  }
  if (KNOWLEDGE_RUNTIME_OPERATION_IDS.has(id)) {
    return KNOWLEDGE_CAPABILITY_LAYERS.KNOWLEDGE_RUNTIME;
  }
  return byPrefix(id);
}

export function knowledgeCapabilityTags(layerInfo = null) {
  if (!layerInfo) {
    return [];
  }
  return [
    "knowledge-capability",
    layerInfo.aspect,
    layerInfo.capabilityAspect,
    `knowledge-queue:${layerInfo.queueStatus}`
  ];
}

export function decorateKnowledgeCapabilityOperation(operation = {}) {
  const layerInfo = resolveKnowledgeCapabilityLayer(operation.id);
  if (!layerInfo) {
    return operation;
  }
  const aspects = new Set([
    ...(operation.aspects || []),
    "knowledge-capability",
    layerInfo.aspect,
    layerInfo.capabilityAspect,
    `knowledge-queue:${layerInfo.queueStatus}`
  ]);
  return {
    ...operation,
    aspects: [...aspects],
    knowledgeLayer: layerInfo.id,
    knowledgeCapability: layerInfo.capability,
    knowledgeCapabilityLayer: layerInfo,
    queueStatus: layerInfo.queueStatus,
    queueLabel: layerInfo.queueLabel || operation.queueLabel || "",
    taskType: layerInfo.taskType || operation.taskType || ""
  };
}
