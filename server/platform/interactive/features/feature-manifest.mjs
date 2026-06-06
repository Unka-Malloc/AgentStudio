import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_FEATURE_EDITION = "enterprise";

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function objectFromEntries(entries = []) {
  const result = {};
  for (const [key, value] of entries) {
    result[key] = value;
  }
  return result;
}

const CORE_CLIENT_REQUIRED_MODULE_IDS = new Set([
  "client-gui",
  "client-cli",
  "portable-data",
  "target-adapters",
  "mcp-plugins",
  "skill-hub",
  "model-forwarding",
  "activity-snapshots",
  "settings"
]);

function isLegacyDevOnlyClientModule(module = {}) {
  return module?.legacyDevOnly === true || module?.profile === "legacy/dev-only";
}

export const FEATURE_MANIFEST = Object.freeze({
  schemaVersion: 1,
  label: "Pact FeatureManifest",
  groups: Object.freeze([
    "core",
    "security",
    "module-management",
    "data-structure",
    "storage",
    "devops",
    "capabilities",
    "agent",
    "agent-ingress",
    "client",
    "modules",
    "knowledge",
    "connectors",
    "industry",
    "embedded-server"
  ]),
  editions: Object.freeze({
    community: Object.freeze({
      label: "Community",
      includes: Object.freeze([
        "core-platform",
        "tool-management-core",
        "strategy-management",
        "work-queue-core",
        "client-runtime-core",
        "agent-memory",
        "document-parser",
        "analysis-runtime",
        "knowledge-core"
      ])
    }),
    pro: Object.freeze({
      label: "Pro",
      includes: Object.freeze([
        "core-platform",
        "tool-management-core",
        "strategy-management",
        "work-queue-core",
        "client-runtime-core",
        "agent-memory",
        "document-parser",
        "pdf-processor",
        "analysis-runtime",
        "knowledge-core",
        "external-knowledge-distillation",
        "knowledge-distillation",
        "agent-gateway",
        "agent-management",
        "agent-exploration",
        "code-repository-operations",
        "codespace-management",
        "gerrit-service",
        "macos-mail"
      ])
    }),
    enterprise: Object.freeze({
      label: "Enterprise",
      includes: Object.freeze([
        "core-platform",
        "tool-management-core",
        "strategy-management",
        "work-queue-core",
        "client-runtime-core",
        "agent-memory",
        "document-parser",
        "pdf-processor",
        "ocr",
        "multimodal-parser",
        "analysis-runtime",
        "knowledge-core",
        "external-knowledge-distillation",
        "knowledge-distillation",
        "knowledge-evolution",
        "knowledge-outline-reasoning",
        "agent-gateway",
        "agent-management",
        "agent-exploration",
        "code-repository-operations",
        "codespace-management",
        "gerrit-service",
        "maintenance-agent-runbooks",
        "data-connectors",
        "gmail",
        "outlook",
        "google-drive",
        "onedrive",
        "slack",
        "teams",
        "macos-mail",
        "graph-ui",
        "vector-store-external",
        "graph-store-external",
        "embedded-server"
      ])
    }),
    custom: Object.freeze({
      label: "Custom",
      includes: Object.freeze(["core-platform", "tool-management-core", "work-queue-core", "client-runtime-core", "agent-memory"])
    })
  }),
  features: Object.freeze([
    {
      featureId: "core-platform",
      label: "Core platform",
      group: "core",
      required: true,
      defaultEnabled: true,
      server: {
        operationFeatures: ["discovery", "events", "runtime", "settings", "system"],
        operations: ["raw_objects.get"],
        webPanels: ["console-shell", "settings-core", "storage", "clients"],
        eventTopics: [
          "server.lifecycle",
          "system.interfaces",
          "system.console_state",
          "discovery.config",
          "discovery.clients",
          "runtime.mounts",
          "settings.current",
          "storage.summary"
        ]
      },
      web: {
        navItems: ["dashboard", "approval", "admin.storage", "admin.clients", "drawer.discovery", "drawer.users", "drawer.modules"],
        panels: ["ConsoleShell", "StoragePanel", "ClientPanel", "SettingsDrawer", "ModulesDrawer"]
      },
      package: {
        includePaths: ["server", "server-web", "docs/Architecture.md", "docs/SERVER_WEB.md"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:core"] }
    },
    {
      featureId: "security-permissions",
      label: "Security and permissions foundation",
      group: "security",
      required: true,
      defaultEnabled: true,
      server: {
        operationFeatures: ["auth"],
        eventTopics: ["auth.audit"]
      },
      package: {
        includePaths: ["server/platform/common/security"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:console-auth", "server:verify:security-hardening", "server:verify:operation-policy"] }
    },
    {
      featureId: "operation-dispatcher",
      label: "Operation dispatcher",
      group: "core",
      required: true,
      defaultEnabled: true,
      package: {
        includePaths: ["server/platform/common/operation-dispatcher"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:dispatcher-unified"] }
    },
    {
      featureId: "console-shell",
      label: "Console shell and HTTP controller core",
      group: "core",
      required: true,
      defaultEnabled: true,
      package: {
        includePaths: [
          "server/platform/common/console",
          "server/platform/common/platform-core",
          "server/platform/common/observability"
        ],
        excludePaths: []
      },
      tests: { suites: ["server:verify:console-auth"] }
    },
    {
      featureId: "storage-core",
      label: "Storage platform core",
      group: "storage",
      required: true,
      defaultEnabled: true,
      package: {
        includePaths: ["server/platform/common/storage"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:storage"] }
    },
    {
      featureId: "module-management-core",
      label: "External module mount manager core",
      group: "module-management",
      required: true,
      defaultEnabled: true,
      package: {
        includePaths: ["server/platform/common/module-manager"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:mount-manager"] }
    },
    {
      featureId: "data-structure-core",
      label: "Shared data structure foundation",
      group: "data-structure",
      required: true,
      defaultEnabled: true,
      package: {
        includePaths: ["server/platform/common/data-structure"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:state-coordination"] }
    },
    {
      featureId: "devops-core",
      label: "Devops foundation",
      group: "devops",
      required: true,
      defaultEnabled: true,
      server: {
        webPanels: ["logs", "production-health"]
      },
      web: {
        navItems: ["admin.logs", "admin.productionHealth"],
        panels: ["LogPanel", "ProductionHealthPanel"]
      },
      package: {
        includePaths: ["server/platform/common/devops"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:ops", "server:verify:monitor-alerts", "server:verify:unified-registration"] }
    },
    {
      featureId: "tool-management-core",
      label: "Tool Management policy, grants, audit, and catalog core",
      group: "capabilities",
      required: true,
      defaultEnabled: true,
      server: {
        operationFeatures: ["tool_management"],
        eventTopics: ["tool_management.events"],
        webPanels: ["tool-management-core"]
      },
      web: {
        navItems: ["admin.toolList", "admin.toolStats", "admin.agentPermissions"],
        panels: ["ToolManagementPanel", "AgentPermissionPanel"]
      },
      package: {
        includePaths: ["server/platform/specialized/capabilities/tools/tool-management-core", "server/config/entity-config/tools"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:tool-management"] }
    },
    {
      featureId: "strategy-management",
      label: "Workflow and agent invocation strategy management",
      group: "capabilities",
      dependsOn: ["tool-management-core"],
      defaultEnabled: true,
      server: {
        operationFeatures: ["strategy_management"],
        operationPrefixes: ["strategy."],
        modules: ["StrategyManagementProvider"],
        webPanels: ["strategy-management"]
      },
      package: {
        includePaths: ["server/platform/specialized/capabilities/strategy-management", "docs/PROTOCOLS.md"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:strategy-management"] }
    },
    {
      featureId: "work-queue-core",
      label: "Upload sessions, checkpoints, raw object store, and work queue",
      group: "client",
      required: true,
      defaultEnabled: true,
      server: {
        operationFeatures: ["jobs", "uploads", "raw_objects"],
        eventTopics: ["uploads.session", "uploads.trace", "jobs.job", "jobs.deleted"],
        webPanels: ["work-queue"]
      },
      web: {
        navItems: ["admin.jobs"],
        panels: ["WorkQueuePanel"]
      },
      package: {
        includePaths: [
          "server/services/client/work-queue-core",
          "server/platform/specialized/knowledge/preprocessing/chunking",
          "server/platform/specialized/knowledge/preprocessing/domain",
          "server/protocols/checkpoint/upload-session-store.mjs"
        ],
        excludePaths: []
      },
      tests: { suites: ["server:verify:uploads", "server:verify:jobs"] }
    },
    {
      featureId: "client-runtime-core",
      label: "Client runtime allocator and context workspace routing",
      group: "client",
      required: true,
      defaultEnabled: true,
      dependsOn: ["agent-memory"],
      server: {
        operationFeatures: ["client_runtime_allocator", "context_runtime"],
        eventTopics: ["client_runtime.status"],
        webPanels: ["client-runtime-allocator"]
      },
      web: {
        navItems: ["workspaces", "admin.opsMonitor"],
        panels: ["WorkspacesPanel", "OpsMonitorPanel", "ClientRuntimeHeatmap"]
      },
      package: {
        includePaths: ["server/services/client/client-runtime-core", "server/protocols/context-core"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:client-runtime"] }
    },
    {
      featureId: "agent-memory",
      label: "Agent memory session store",
      group: "agent",
      required: true,
      defaultEnabled: true,
      server: {
        operationFeatures: ["agent_memory"],
        eventTopics: ["agent_memory.session"]
      },
      package: {
        includePaths: ["server/platform/specialized/agent/agent-memory"],
        excludePaths: []
      },
      tests: { suites: ["server:verify:agent-memory"] }
    },
    {
      featureId: "document-parser",
      label: "Document parser protocol and base document extraction",
      group: "modules",
      defaultEnabled: true,
      server: {
        mounts: ["documentParser"],
        modules: ["FileProcessor"],
        operationFeatures: [],
        webPanels: ["document-parser"]
      },
      package: {
        includePaths: [
          "server/platform/specialized/knowledge/preprocessing/file-processor",
          "server/platform/modules/knowledge/file-processor/FileNormalizer/Tika",
          "server/platform/modules/knowledge/tika",
          "server/platform/modules/knowledge/runtime/jre",
          "docs/PROTOCOLS.md"
        ],
        removePaths: [
          "server/platform/specialized/knowledge/preprocessing/file-processor",
          "server/platform/modules/knowledge/file-processor/FileNormalizer/Tika",
          "server/platform/modules/knowledge/tika",
          "server/platform/modules/knowledge/runtime/jre"
        ]
      },
      tests: { suites: ["server:verify:file-processor"] }
    },
    {
      featureId: "pdf-processor",
      label: "PDF processor resources",
      group: "modules",
      dependsOn: ["document-parser"],
      defaultEnabled: true,
      package: {
        includePaths: ["server/platform/modules/knowledge/file-processor/FileNormalizer/PDFProcessor"],
        removePaths: ["server/platform/modules/knowledge/file-processor/FileNormalizer/PDFProcessor"]
      }
    },
    {
      featureId: "ocr",
      label: "OCR runtime",
      group: "modules",
      dependsOn: ["document-parser"],
      defaultEnabled: false,
      server: {
        mounts: ["ocr"],
        modules: ["OCRRuntime"]
      },
      package: {
        includePaths: ["server/platform/modules/knowledge/ocr"],
        removePaths: [
          "server/platform/modules/knowledge/file-processor/FileNormalizer/OCR",
          "server/platform/modules/knowledge/ocr",
          "server/platform/modules/knowledge/file-processor/FileNormalizer/OCR/index.mjs",
          "server/scripts/paddleocr_extract.py"
        ]
      },
      tests: { suites: ["server:verify:ocr"] }
    },
    {
      featureId: "multimodal-parser",
      label: "Multimodal parser runtime",
      group: "modules",
      dependsOn: ["document-parser"],
      defaultEnabled: false,
      server: {
        mounts: ["multimodalParser"]
      },
      package: {
        includePaths: ["docs/PROTOCOLS.md"],
        excludePaths: []
      }
    },
    {
      featureId: "analysis-runtime",
      label: "Analysis runtime and module management",
      group: "modules",
      defaultEnabled: true,
      server: {
        mounts: ["analysis"],
        modules: ["AnalysisRuntime"],
        webPanels: ["modules"]
      },
      web: {
        navItems: ["admin.modules"],
        panels: ["ModuleManagementPanel"]
      },
      package: {
        includePaths: ["server/platform/specialized/knowledge/preprocessing/analysis-engine-registry.mjs", "docs/ENTITY-CONFIG-LAYOUT.md"],
        excludePaths: []
      }
    },
    {
      featureId: "knowledge-core",
      label: "KnowledgeCore search, sources, evidence, rules, and graph shell",
      group: "knowledge",
      dependsOn: ["document-parser", "analysis-runtime"],
      defaultEnabled: true,
      server: {
        operationFeatures: ["knowledge", "knowledge_taxonomy", "email_rules", "expert_vocabulary", "search"],
        operations: [
          "knowledge.affair_taxonomy",
          "knowledge.console",
          "knowledge.sources.list",
          "knowledge.sources.create",
          "knowledge.sources.update",
          "knowledge.sources.delete",
          "knowledge.sources.refresh",
          "knowledge.sources.refresh_all",
          "knowledge.config_schema",
          "knowledge.capabilities",
          "knowledge.health",
          "knowledge.maintenance.get",
          "knowledge.maintenance.settings",
          "knowledge.maintenance.set",
          "knowledge.reindex",
          "knowledge.maintenance.run",
          "knowledge.sync",
          "knowledge.changes",
          "knowledge.corpus.significant_terms",
          "knowledge.word_clouds.get",
          "knowledge.word_clouds.save",
          "knowledge.word_clouds.propose",
          "knowledge.review_items",
          "knowledge.review_resolve",
          "knowledge.feedback",
          "knowledge.suggestions",
          "knowledge.suggestion_resolve",
          "knowledge.search",
          "knowledge.search.get",
          "knowledge.item",
          "knowledge.evidence",
          "knowledge.asset",
          "knowledge.render_markdown",
          "knowledge.graph",
          "search.query"
        ],
        eventTopics: [
          "email_rules.current",
          "expert_vocabulary.current",
          "knowledge.golden_rules",
          "knowledge.changes",
          "knowledge.review_items",
          "knowledge.sources",
          "knowledge.word_clouds"
        ],
        webPanels: ["knowledge-core-ui", "knowledge-word-cloud", "knowledge-recall-debug"]
      },
      web: {
        navItems: ["sources", "knowledge.management", "knowledge.wordCloud", "knowledge.logs", "knowledge.maintenance", "debug.knowledgeRecall"],
        panels: ["KnowledgeSourcesPanel", "KnowledgeManagementPanel", "KnowledgeWordCloudPanel", "KnowledgeRecallDebugPanel"]
      },
      client: { modules: ["knowledge-mirror", "expert-vocabulary"] },
      package: {
        includePaths: [
          "server/platform/specialized/knowledge/preprocessing/chunking",
          "server/platform/specialized/knowledge/preprocessing/domain",
          "server/platform/specialized/knowledge/storage/knowledge-core",
          "server/protocols/knowledge/README.md",
          "docs/PROTOCOLS.md"
        ],
        removePaths: [
          "server/platform/specialized/knowledge/preprocessing/chunking",
          "server/platform/specialized/knowledge/preprocessing/domain",
          "server/platform/specialized/knowledge/storage/knowledge-core",
          "server/platform/specialized/knowledge/retrieval/embedding-runtime",
          "server/platform/specialized/knowledge/retrieval/learning-runtime",
          "server/platform/specialized/knowledge/retrieval/vector-store",
          "server/platform/specialized/knowledge/storage/knowledge-source-service.mjs",
          "server/services/client/work-queue-core/background-workers/source-watcher-worker.mjs",
          "server/protocols/knowledge"
        ]
      },
      tests: { suites: ["server:verify:knowledge"] }
    },
    {
      featureId: "external-knowledge-distillation",
      label: "External knowledge distillation service proxy",
      group: "knowledge",
      dependsOn: [
        "core-platform",
        "security-permissions",
        "operation-dispatcher",
        "console-shell",
        "tool-management-core",
        "work-queue-core",
        "agent-gateway"
      ],
      defaultEnabled: false,
      server: {
        operationPrefixes: ["external.knowledge.distillation."],
        modules: ["ExternalKnowledgeDistillationService"],
        webPanels: ["external-knowledge-distillation"]
      },
      lifecycle: {
        serviceName: "external.knowledge.distillation",
        deploymentBoundary: "standalone-external-service",
        platformRole: "configuration, authorization, operation proxy, upload receipt and queue orchestration, model gateway invocation",
        algorithmSurface: "external-service-only",
        internalWorkflowPolicy: "not-required",
        modelGatewayPolicy: "required-real-model-call",
        uploadPolicy: "reuse-platform-upload-sessions-and-checkpoints"
      },
      web: {
        navItems: ["knowledge.distillation"],
        panels: ["KnowledgeDistillationWorkbench"]
      },
      package: {
        includePaths: [
          "external-services/knowledge-distillation-service",
          "server/platform/specialized/knowledge/invocation/external-distillation-service",
          "server/platform/specialized/agent/agent-gateway",
          "server/protocols/agent-sync",
          "server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs",
          "server/platform/common/operation-dispatcher/operation-registry.mjs",
          "server/platform/specialized/console/console-domain-operation-executor.mjs"
        ],
        removePaths: []
      },
      tests: { suites: ["server:verify:knowledge-distillation-standalone-service"] }
    },
    {
      featureId: "knowledge-distillation",
      label: "Deprecated internal knowledge distillation workflow migration shims",
      group: "knowledge",
      dependsOn: ["external-knowledge-distillation", "knowledge-core", "agent-gateway"],
      defaultEnabled: false,
      server: {
        operationPrefixes: [
          "knowledge.agent_skill.",
          "knowledge.skills.",
          "knowledge.golden_rules.",
          "knowledge.rule_authoring.",
          "knowledge.gold_cases.",
          "knowledge.summarization.",
          "knowledge.training_sets.",
          "knowledge.evaluation.",
          "knowledge.model_roles",
          "knowledge.model_decision"
        ],
        operations: ["knowledge.evidence_gate.evaluate"],
        modules: ["ExternalKnowledgeDistillationService", "KnowledgeSkillRuntime", "SummarizationRuntime"],
        webPanels: ["knowledge-distillation", "knowledge-distillation-workbench"]
      },
      lifecycle: {
        status: "must-migrate",
        internalKnowledgeDistillation: "removed-from-runtime",
        replacementService: "external.knowledge.distillation",
        replacementFeature: "external-knowledge-distillation",
        maintenancePolicy: "migration-shim-only",
        internalWorkflows: [
          { id: "knowledge.agent_skill", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.skills", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.golden_rules", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.rule_authoring", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.gold_cases", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.summarization", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.training_sets", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.evaluation", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.model_roles", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.model_decision", status: "must-migrate", target: "external.knowledge.distillation" },
          { id: "knowledge.evidence_gate.evaluate", status: "must-migrate", target: "external.knowledge.distillation" }
        ]
      },
      web: {
        navItems: ["knowledge.distillation", "debug.knowledgeDistillation"],
        panels: ["KnowledgeDistillationWorkbench", "KnowledgeDistillationDebugPanel"]
      },
      package: {
        includePaths: ["server/platform/specialized/knowledge/storage/knowledge-core"],
        removePaths: [
          "server/platform/specialized/capabilities/tools/agent-evaluation-runtime",
          "server/platform/specialized/knowledge/retrieval/evidence-sufficiency-gate",
          "server/platform/specialized/knowledge/invocation/golden-rule-runtime",
          "server/platform/specialized/knowledge/invocation/knowledge-agent-skill-runtime",
          "server/platform/specialized/knowledge/invocation/knowledge-rule-authoring-runtime",
          "server/platform/specialized/knowledge/invocation/knowledge-skill-runtime",
          "server/platform/specialized/agent/agent-gateway/multi-agent-coordinator",
          "server/platform/specialized/knowledge/invocation/knowledge-summarization-runtime",
          "server/scripts/distill-existing-knowledge-skills.mjs",
          "server/scripts/verify-knowledge-golden-distillation.mjs",
          "server/scripts/verify-knowledge-rule-authoring.mjs",
          "server/scripts/verify-knowledge-skillization.mjs",
          "server/scripts/verify-multi-agent-summarization.mjs",
          "server/scripts/verify-multi-source-connectors.mjs"
        ]
      },
      tests: { suites: ["server:verify:knowledge-distillation"] }
    },
    {
      featureId: "knowledge-evolution",
      label: "Knowledge evolution, learning jobs, evaluation deployments",
      group: "knowledge",
      dependsOn: ["knowledge-core", "knowledge-distillation"],
      defaultEnabled: false,
      server: {
        operationPrefixes: [
          "knowledge.learning.",
          "knowledge.evolution.",
          "knowledge.skills.evaluation.",
          "knowledge.skills.deployments."
        ],
        modules: ["KnowledgeEvolutionRuntime"],
        webPanels: ["knowledge-evolution"]
      },
      package: {
        includePaths: ["server/platform/specialized/knowledge/storage/knowledge-core", "docs/PROTOCOLS.md"],
        removePaths: [
          "server/platform/specialized/knowledge/invocation/knowledge-evolution-runtime",
          "server/scripts/verify-knowledge-distillation-optimization.mjs"
        ]
      },
      tests: { suites: ["server:verify:knowledge-evolution"] }
    },
    {
      featureId: "knowledge-outline-reasoning",
      label: "Document outline and optional hierarchy tree reasoning",
      group: "knowledge",
      dependsOn: ["knowledge-core"],
      defaultEnabled: false,
      server: {
        operations: ["knowledge.document_structure", "knowledge.hierarchy.audit"],
        modules: ["DocumentOutlineRuntime"],
        webPanels: ["knowledge-outline"]
      },
      package: {
        includePaths: ["server/protocols/knowledge/README.md"],
        removePaths: ["server/platform/specialized/knowledge/storage/knowledge-core/DocumentOutlineRuntime.mjs"]
      },
      tests: { suites: ["server:verify:knowledge-outline"] }
    },
    {
      featureId: "agent-gateway",
      label: "Agent gateway and model adapter runtime",
      group: "agent",
      defaultEnabled: false,
      server: {
        operationFeatures: ["agent_gateway", "custom_http_adapter", "oauth", "agent_sync"],
        operationPrefixes: ["agent_sync.", "agent_gateway.", "oauth."],
        modules: ["AgentGateway"],
        eventTopics: ["agent_sync.config"],
        webPanels: ["agent-config"]
      },
      web: {
        navItems: ["admin.agentConfig", "admin.contextManagement"],
        panels: ["AgentConfigPanel", "ContextManagementPanel"]
      },
      client: { modules: ["knowledge-agent"] },
      package: {
        includePaths: ["server/platform/specialized/agent/agent-gateway", "server/protocols/agent-sync"],
        removePaths: [
          "server/platform/specialized/agent/agent-gateway",
          "server/platform/specialized/agent/agent-gateway/model-probe",
          "server/protocols/agent-sync",
          "server/scripts/verify-agent-gateway.mjs",
          "server/scripts/verify-agent-gateway-compaction.mjs",
          "server/scripts/verify-model-routing.mjs",
          "server/scripts/verify-agent-sync.mjs"
        ]
      },
      tests: { suites: ["server:verify:agent-gateway"] }
    },
    {
      featureId: "agent-traffic-gateway",
      label: "Optional agent traffic gateway ingress adapters",
      group: "agent-ingress",
      dependsOn: ["core-platform"],
      defaultEnabled: false,
      package: {
        includePaths: [
          "server/platform/specialized/capabilities/agent-ingress/traffic-gateway",
          "server/scripts/gateway-ingress.mjs",
          "server/scripts/verify-gateway-ingress.mjs",
          "docs/Architecture.md",
          "docs/PROTOCOLS.md",
          "docs/SERVER.md"
        ],
        removePaths: []
      },
      tests: { suites: ["server:verify:gateway-ingress"] }
    },
    {
      featureId: "code-repository-operations",
      label: "Code repository operations",
      group: "capabilities",
      dependsOn: ["tool-management-core"],
      defaultEnabled: false,
      server: {
        operationPrefixes: ["repo."],
        modules: ["RepoOperationsCompatibilityRoute"]
      },
      package: {
        includePaths: [
          "server/platform/specialized/capabilities/code-repository/repo-operations",
          "docs/PROTOCOLS.md"
        ]
      },
      tests: { suites: ["server:verify:resource-operations"] }
    },
    {
      featureId: "codespace-management",
      label: "Codespace management",
      group: "capabilities",
      dependsOn: ["code-repository-operations"],
      defaultEnabled: false,
      server: {
        operationPrefixes: ["codespace.", "workspace.code."],
        modules: ["CodespaceManagement"]
      },
      package: {
        includePaths: [
          "server/platform/specialized/capabilities/code-management/codespace",
          "docs/PROTOCOLS.md"
        ]
      },
      tests: { suites: ["server:verify:codespace", "server:verify:v001-codespace-e2e"] }
    },
    {
      featureId: "gerrit-service",
      label: "Gerrit service integration",
      group: "capabilities",
      dependsOn: ["codespace-management", "tool-management-core"],
      defaultEnabled: false,
      server: {
        operationPrefixes: ["gerrit.", "runtime.dependencies."],
        modules: ["GerritCodeReviewRoute", "RuntimeDependencies"],
        webPanels: ["runtime-dependencies"]
      },
      web: {
        navItems: ["admin.runtimeDownloads"],
        panels: ["RuntimeDownloadsPanel"]
      },
      package: {
        includePaths: [
          "server/platform/specialized/capabilities/code-review/gerrit",
          "server/platform/specialized/capabilities/runtime-dependencies",
          "server/scripts/gerrit-local.mjs",
          "docs/PROTOCOLS.md"
        ]
      },
      tests: { suites: ["server:verify:gerrit-mcp", "server:verify:runtime-dependency-downloads"] }
    },
    {
      featureId: "agent-management",
      label: "Agent management",
      group: "agent",
      dependsOn: ["agent-gateway", "tool-management-core"],
      defaultEnabled: false,
      server: {
        operations: ["agents.list", "agents.create", "agents.update", "agents.delete"]
      },
      client: { modules: ["agent-registry"] },
      tests: { suites: ["server:verify:agent-management"] }
    },
    {
      featureId: "agent-exploration",
      label: "Agent exploration workspaces and debug retrieval",
      group: "agent",
      dependsOn: ["agent-gateway", "knowledge-core"],
      defaultEnabled: false,
      server: {
        operationFeatures: ["agent_workspace"],
        operationPrefixes: ["knowledge.agent_explore.", "agent_workspaces."],
        modules: ["AgentExplorationRuntime"],
        webPanels: ["agent-exploration"]
      },
      web: {
        navItems: ["intelligence", "debug.agentRetrieval"],
        panels: ["AgentExplorePanel", "AgentRetrievalDebugPanel"]
      },
      package: {
        includePaths: ["server/platform/specialized/capabilities/tools/agent-exploration-runtime"],
        removePaths: [
          "server/platform/specialized/capabilities/tools/agent-exploration-runtime",
          "server/scripts/verify-agent-exploration.mjs",
          "server/scripts/verify-agent-knowledge-tools.mjs"
        ]
      },
      tests: { suites: ["server:verify:agent-exploration"] }
    },
    {
      featureId: "maintenance-agent-runbooks",
      label: "Maintenance agent runbooks and smart inspection",
      group: "core",
      dependsOn: ["agent-gateway", "tool-management-core", "work-queue-core"],
      defaultEnabled: false,
      server: {
        operationFeatures: ["maintenance_agent"],
        operationPrefixes: ["maintenance_agent."],
        modules: ["MaintenanceAgent"],
        eventTopics: [
          "maintenance.agent.config",
          "maintenance.agent.plan.created",
          "maintenance.agent.approval.required",
          "maintenance.agent.run.started",
          "maintenance.agent.tool.started",
          "maintenance.agent.tool.completed",
          "maintenance.agent.tool.failed",
          "maintenance.agent.run.completed"
        ],
        webPanels: ["maintenance-agent-runbooks"]
      },
      web: {
        navItems: ["admin.maintenanceAgent"],
        panels: ["MaintenanceAgentPanel"]
      },
      package: {
        includePaths: ["server/services/agent/maintenance-agent"],
        removePaths: [
          "server/services/agent/maintenance-agent",
          "server/services/client/work-queue-core/background-workers/maintenance-worker.mjs",
          "server/scripts/verify-maintenance-agent.mjs",
          "server/scripts/verify-maintenance-agent-compaction.mjs"
        ]
      },
      tests: { suites: ["server:verify:maintenance-agent"] }
    },
    {
      featureId: "data-connectors",
      label: "Data connector runtime and local mirror framework",
      group: "connectors",
      defaultEnabled: false,
      client: {
        modules: ["data-connectors"],
        portableDirs: ["portable-data/connectors/modules", "portable-data/connectors/state", "portable-data/connectors/cache"]
      },
      package: {
        includePaths: ["client-gui/portable-data/connectors"],
        excludePaths: []
      },
      tests: { suites: ["client:verify:connectors"] }
    },
    {
      featureId: "gmail",
      label: "Gmail connector",
      group: "connectors",
      dependsOn: ["data-connectors"],
      defaultEnabled: false,
      client: { modules: ["gmail-connector"] }
    },
    {
      featureId: "outlook",
      label: "Outlook Mail connector",
      group: "connectors",
      dependsOn: ["data-connectors"],
      defaultEnabled: false,
      client: { modules: ["outlook-mail-connector"] }
    },
    {
      featureId: "google-drive",
      label: "Google Drive connector",
      group: "connectors",
      dependsOn: ["data-connectors"],
      defaultEnabled: false,
      client: { modules: ["google-drive-connector"] }
    },
    {
      featureId: "onedrive",
      label: "OneDrive connector",
      group: "connectors",
      dependsOn: ["data-connectors"],
      defaultEnabled: false,
      client: { modules: ["onedrive-connector"] }
    },
    {
      featureId: "slack",
      label: "Slack connector",
      group: "connectors",
      dependsOn: ["data-connectors"],
      defaultEnabled: false,
      client: { modules: ["slack-connector"] }
    },
    {
      featureId: "teams",
      label: "Teams connector",
      group: "connectors",
      dependsOn: ["data-connectors"],
      defaultEnabled: false,
      client: { modules: ["teams-connector"] }
    },
    {
      featureId: "macos-mail",
      label: "macOS Mail connector and local mail mirror",
      group: "connectors",
      dependsOn: ["knowledge-core"],
      defaultEnabled: false,
      client: { modules: ["macos-mail-import", "mail-index"] },
      package: {
        includePaths: ["client-gui/portable-data/mail-index"],
        excludePaths: []
      },
      tests: { suites: ["client:verify:macos-mail"] }
    },
    {
      featureId: "graph-ui",
      label: "Knowledge graph UI",
      group: "knowledge",
      dependsOn: ["knowledge-core"],
      defaultEnabled: false,
      client: { modules: ["knowledge-graph-ui"] },
      web: {
        panels: ["KnowledgeGraphPanel"]
      }
    },
    {
      featureId: "vector-store-external",
      label: "External vector store mount adapters",
      group: "knowledge",
      dependsOn: ["knowledge-core"],
      defaultEnabled: false,
      server: { mounts: ["vectorStore"] },
      client: { modules: ["server.VectorStore"] },
      package: {
        includePaths: ["docs/PROTOCOLS.md"],
        excludePaths: []
      }
    },
    {
      featureId: "graph-store-external",
      label: "External graph store mount adapters",
      group: "knowledge",
      dependsOn: ["knowledge-core"],
      defaultEnabled: false,
      server: { mounts: ["graphStore"] },
      package: {
        includePaths: ["docs/PROTOCOLS.md"],
        excludePaths: []
      }
    },
    {
      featureId: "embedded-server",
      label: "Embedded server resources for client package",
      group: "embedded-server",
      defaultEnabled: false,
      dependsOn: ["document-parser", "knowledge-core", "agent-gateway"],
      client: {
        modules: [
          "server.FileProcessor",
          "server.KnowledgeCore",
          "server.EmbeddingRuntime",
          "server.VectorStore",
          "server.AgentGateway",
          "server.LearningRuntime",
          "server.MaintenanceAgent"
        ]
      },
      package: {
        includePaths: ["server", "scripts"],
        excludePaths: []
      }
    }
  ])
});

export function getFeatureEntries() {
  return FEATURE_MANIFEST.features.map((feature) => ({ ...feature }));
}

export function getFeatureMap() {
  return new Map(FEATURE_MANIFEST.features.map((feature) => [feature.featureId, feature]));
}

function splitFeatureList(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }
  return uniqueStrings(String(value || "").split(","));
}

async function readJsonFileIfPresent(filePath) {
  if (!filePath) {
    return null;
  }
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function loadFeatureProfile(profilePath) {
  return readJsonFileIfPresent(profilePath);
}

function normalizeProfileInput(profile = {}) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return {};
  }
  return profile;
}

export function resolveFeatureRuntime({
  edition = DEFAULT_FEATURE_EDITION,
  profile = {},
  enableFeatures = [],
  disableFeatures = [],
  now = new Date()
} = {}) {
  const normalizedProfile = normalizeProfileInput(profile);
  const selectedEdition = String(normalizedProfile.edition || edition || DEFAULT_FEATURE_EDITION).trim() || DEFAULT_FEATURE_EDITION;
  if (!FEATURE_MANIFEST.editions[selectedEdition]) {
    throw new Error(`Unknown feature edition: ${selectedEdition}`);
  }

  const featureMap = getFeatureMap();
  const required = FEATURE_MANIFEST.features
    .filter((feature) => feature.required)
    .map((feature) => feature.featureId);
  const baseIncludes = [
    ...required,
    ...(FEATURE_MANIFEST.editions[selectedEdition]?.includes || []),
    ...splitFeatureList(normalizedProfile.features),
    ...splitFeatureList(normalizedProfile.enableFeatures),
    ...splitFeatureList(enableFeatures)
  ];
  const disabled = new Set([
    ...splitFeatureList(normalizedProfile.disableFeatures),
    ...splitFeatureList(disableFeatures)
  ]);

  for (const featureId of disabled) {
    const feature = featureMap.get(featureId);
    if (feature?.required) {
      throw new Error(`Required feature cannot be disabled: ${featureId}`);
    }
  }

  const active = new Set();
  const reasons = {};

  function addFeature(featureId, reason = "selected", requiredBy = "") {
    if (!featureId) {
      return;
    }
    if (disabled.has(featureId)) {
      if (requiredBy) {
        throw new Error(`Feature dependency cannot be disabled: ${requiredBy} depends on ${featureId}`);
      }
      return;
    }
    const feature = featureMap.get(featureId);
    if (!feature) {
      throw new Error(`Unknown feature: ${featureId}`);
    }
    if (active.has(featureId)) {
      return;
    }
    active.add(featureId);
    reasons[featureId] = reasons[featureId] || reason;
    for (const dependencyId of feature.dependsOn || []) {
      addFeature(dependencyId, `dependency of ${featureId}`, featureId);
    }
  }

  for (const featureId of baseIncludes) {
    addFeature(featureId, "edition/profile");
  }

  for (const featureId of required) {
    addFeature(featureId, "required core");
  }

  for (const featureId of active) {
    const feature = featureMap.get(featureId);
    for (const conflictId of feature?.conflictsWith || []) {
      if (active.has(conflictId)) {
        throw new Error(`Feature conflict: ${featureId} conflicts with ${conflictId}`);
      }
    }
  }

  const activeFeatureIds = [...active].sort();
  const disabledFeatureIds = FEATURE_MANIFEST.features
    .map((feature) => feature.featureId)
    .filter((featureId) => !active.has(featureId))
    .sort();
  const disabledReasons = objectFromEntries(disabledFeatureIds.map((featureId) => [
    featureId,
    disabled.has(featureId) ? "disabled by profile" : "not included in edition/profile"
  ]));

  return {
    schemaVersion: 1,
    edition: selectedEdition,
    profileName: String(normalizedProfile.name || selectedEdition),
    generatedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    activeFeatureIds,
    disabledFeatureIds,
    requiredFeatureIds: required.sort(),
    activeFeatures: activeFeatureIds.map((featureId) => publicFeatureDefinition(featureMap.get(featureId), reasons[featureId])),
    disabledFeatures: disabledFeatureIds.map((featureId) => publicFeatureDefinition(featureMap.get(featureId), disabledReasons[featureId])),
    reasons,
    disabledReasons,
    groups: summarizeFeatureGroups(activeFeatureIds, disabledFeatureIds, featureMap)
  };
}

function summarizeFeatureGroups(activeFeatureIds, disabledFeatureIds, featureMap) {
  const groups = {};
  for (const group of FEATURE_MANIFEST.groups) {
    groups[group] = { active: [], disabled: [] };
  }
  for (const featureId of activeFeatureIds) {
    const group = featureMap.get(featureId)?.group || "custom";
    groups[group] = groups[group] || { active: [], disabled: [] };
    groups[group].active.push(featureId);
  }
  for (const featureId of disabledFeatureIds) {
    const group = featureMap.get(featureId)?.group || "custom";
    groups[group] = groups[group] || { active: [], disabled: [] };
    groups[group].disabled.push(featureId);
  }
  return groups;
}

function publicFeatureDefinition(feature = {}, reason = "") {
  return {
    featureId: feature.featureId,
    label: feature.label || feature.featureId,
    group: feature.group || "custom",
    required: feature.required === true,
    defaultEnabled: feature.defaultEnabled === true,
    dependsOn: [...(feature.dependsOn || [])],
    conflictsWith: [...(feature.conflictsWith || [])],
    lifecycle: feature.lifecycle || null,
    reason
  };
}

export async function resolveFeatureRuntimeFromEnv({
  args = {},
  runtimeOptions = {},
  env = process.env
} = {}) {
  const profilePath =
    args["feature-profile"] ||
    args.featureProfile ||
    runtimeOptions.featureProfile ||
    env.PACT_FEATURE_PROFILE ||
    "";
  const profile = await loadFeatureProfile(profilePath);
  return resolveFeatureRuntime({
    edition:
      args.edition ||
      args.featureEdition ||
      runtimeOptions.featureEdition ||
      env.PACT_FEATURE_EDITION ||
      DEFAULT_FEATURE_EDITION,
    profile: profile || {},
    enableFeatures: [
      ...splitFeatureList(args.features),
      ...splitFeatureList(args.enableFeatures),
      ...splitFeatureList(env.PACT_FEATURES)
    ],
    disableFeatures: [
      ...splitFeatureList(args["without-features"]),
      ...splitFeatureList(args.disableFeatures),
      ...splitFeatureList(env.PACT_DISABLED_FEATURES)
    ]
  });
}

export function operationFeatureId(operation = {}) {
  const operationId = String(operation.id || "");
  const operationFeature = String(operation.feature || "");

  if (operationId === "knowledge.document_structure" || operationId === "knowledge.hierarchy.audit") {
    return "knowledge-outline-reasoning";
  }
  if (
    operationId.startsWith("knowledge.learning.") ||
    operationId.startsWith("knowledge.evolution.") ||
    operationId.startsWith("knowledge.skills.evaluation.") ||
    operationId.startsWith("knowledge.skills.deployments.")
  ) {
    return "knowledge-evolution";
  }
  if (
    operationId.startsWith("external.knowledge.distillation.")
  ) {
    return "external-knowledge-distillation";
  }
  if (
    operationId.startsWith("knowledge.agent_skill.") ||
    operationId.startsWith("knowledge.skills.") ||
    operationId.startsWith("knowledge.golden_rules.") ||
    operationId.startsWith("knowledge.rule_authoring.") ||
    operationId.startsWith("knowledge.gold_cases.") ||
    operationId.startsWith("knowledge.distillation.") ||
    operationId.startsWith("knowledge.summarization.") ||
    operationId.startsWith("knowledge.training_sets.") ||
    operationId.startsWith("knowledge.evaluation.") ||
    operationId === "knowledge.evidence_gate.evaluate" ||
    operationId === "knowledge.model_roles" ||
    operationId === "knowledge.model_decision"
  ) {
    return "knowledge-distillation";
  }
  if (operationId.startsWith("knowledge.agent_explore.") || operationId.startsWith("agent_workspaces.")) {
    return "agent-exploration";
  }
  if (operationId.startsWith("context.session_memory.") || operationId.startsWith("agent_memory.")) {
    return "agent-memory";
  }
  if (operationId.startsWith("maintenance_agent.")) {
    return "maintenance-agent-runbooks";
  }
  if (["agents.list", "agents.create", "agents.update", "agents.delete"].includes(operationId)) {
    return "agent-management";
  }
  if (operationId === "settings.model_probe") {
    return "agent-gateway";
  }
  if (operationId.startsWith("agent_gateway.") || operationId.startsWith("agent_sync.") || operationId.startsWith("oauth.")) {
    return "agent-gateway";
  }
  if (operationId.startsWith("repo.")) {
    return "code-repository-operations";
  }
  if (operationId.startsWith("codespace.") || operationId.startsWith("workspace.code.")) {
    return "codespace-management";
  }
  if (operationId.startsWith("gerrit.") || operationId.startsWith("runtime.dependencies.")) {
    return "gerrit-service";
  }

  const featureByRegistryFeature = {
    auth: "security-permissions",
    discovery: "core-platform",
    events: "core-platform",
    runtime: "core-platform",
    settings: "core-platform",
    storage: "storage-core",
    system: "core-platform",
    raw_objects: "storage-core",
    jobs: "work-queue-core",
    uploads: "work-queue-core",
    tool_management: "tool-management-core",
    strategy_management: "strategy-management",
    agent_memory: "agent-memory",
    client_runtime_allocator: "client-runtime-core",
    context_runtime: "client-runtime-core",
    knowledge: "knowledge-core",
    knowledge_taxonomy: "knowledge-core",
    email_rules: "knowledge-core",
    expert_vocabulary: "knowledge-core",
    search: "knowledge-core",
    custom_http_adapter: "agent-gateway",
    agent_gateway: "agent-gateway",
    agent_sync: "agent-gateway",
    oauth: "agent-gateway",
    agent_workspace: "agent-exploration",
    maintenance_agent: "maintenance-agent-runbooks"
  };
  return featureByRegistryFeature[operationFeature] || "core-platform";
}

export function decorateOperationsWithFeatures(operations = []) {
  return operations.map((operation) => ({
    ...operation,
    featureId: operationFeatureId(operation)
  }));
}

export function filterOperationsForFeatures(operations = [], featureRuntime = null) {
  if (!featureRuntime?.activeFeatureIds?.length) {
    return decorateOperationsWithFeatures(operations);
  }
  const active = new Set(featureRuntime.activeFeatureIds);
  return decorateOperationsWithFeatures(operations)
    .filter((operation) => active.has(operation.featureId));
}

export function publicFeatureRuntime(featureRuntime, operations = []) {
  const activeOperations = filterOperationsForFeatures(operations, featureRuntime);
  return {
    schemaVersion: featureRuntime?.schemaVersion || 1,
    edition: featureRuntime?.edition || DEFAULT_FEATURE_EDITION,
    profileName: featureRuntime?.profileName || "",
    generatedAt: featureRuntime?.generatedAt || "",
    activeFeatureIds: [...(featureRuntime?.activeFeatureIds || [])],
    disabledFeatureIds: [...(featureRuntime?.disabledFeatureIds || [])],
    activeFeatures: [...(featureRuntime?.activeFeatures || [])],
    disabledFeatures: [...(featureRuntime?.disabledFeatures || [])],
    groups: featureRuntime?.groups || {},
    operations: {
      total: operations.length,
      active: activeOperations.length,
      disabled: Math.max(0, operations.length - activeOperations.length)
    }
  };
}

export function validateFeatureManifest({ operations = [], clientModules = [], validateClientModules = true } = {}) {
  const featureMap = getFeatureMap();
  const errors = [];
  for (const feature of FEATURE_MANIFEST.features) {
    if (!feature.featureId) {
      errors.push("Feature is missing featureId.");
    }
    if (feature.dependsOn) {
      for (const dependencyId of feature.dependsOn) {
        if (!featureMap.has(dependencyId)) {
          errors.push(`Feature ${feature.featureId} depends on unknown feature ${dependencyId}.`);
        }
      }
    }
    if (feature.conflictsWith) {
      for (const conflictId of feature.conflictsWith) {
        if (!featureMap.has(conflictId)) {
          errors.push(`Feature ${feature.featureId} conflicts with unknown feature ${conflictId}.`);
        }
      }
    }
  }

  const featureIds = new Set(FEATURE_MANIFEST.features.map((feature) => feature.featureId));
  const operationCoverage = decorateOperationsWithFeatures(operations);
  for (const operation of operationCoverage) {
    if (!featureIds.has(operation.featureId)) {
      errors.push(`Operation ${operation.id} resolved to unknown feature ${operation.featureId}.`);
    }
  }

  const normalizedClientModules = Array.isArray(clientModules)
    ? clientModules
    : Object.entries(clientModules || {}).map(([id, module]) => ({ id, ...(module || {}) }));
  if (validateClientModules) {
    const clientModuleIds = new Set(normalizedClientModules.map((module) => module.id));
    for (const feature of FEATURE_MANIFEST.features) {
      for (const moduleId of feature.client?.modules || []) {
        if (!clientModuleIds.has(moduleId)) {
          errors.push(`Feature ${feature.featureId} references unknown client module ${moduleId}.`);
        }
      }
    }
  }

  for (const [editionId, edition] of Object.entries(FEATURE_MANIFEST.editions)) {
    for (const featureId of edition.includes || []) {
      if (!featureMap.has(featureId)) {
        errors.push(`Edition ${editionId} includes unknown feature ${featureId}.`);
      }
    }
  }

  if (errors.length) {
    const error = new Error(`FeatureManifest validation failed:\n${errors.map((item) => `- ${item}`).join("\n")}`);
    error.errors = errors;
    throw error;
  }
  return {
    ok: true,
    operationCount: operations.length,
    clientModuleCount: normalizedClientModules.length,
    featureCount: FEATURE_MANIFEST.features.length
  };
}

export function activeClientModuleIds(featureRuntime = {}) {
  const featureMap = getFeatureMap();
  const moduleIds = new Set();
  for (const featureId of featureRuntime.activeFeatureIds || []) {
    for (const moduleId of featureMap.get(featureId)?.client?.modules || []) {
      moduleIds.add(moduleId);
    }
  }
  return [...moduleIds].sort();
}

export function buildClientPackagingConfig(baseConfig = {}, featureRuntime = {}) {
  const selectedModuleIds = new Set(activeClientModuleIds(featureRuntime));
  const activeFeatures = new Set(featureRuntime.activeFeatureIds || []);
  const normalizeGeneratedClientModule = (id, module = {}) => {
    const legacyDevOnly = isLegacyDevOnlyClientModule(module);
    const next = {
      ...(module || {}),
      required: !legacyDevOnly && module?.required === true && CORE_CLIENT_REQUIRED_MODULE_IDS.has(id),
      enabled: !legacyDevOnly && (CORE_CLIENT_REQUIRED_MODULE_IDS.has(id) || selectedModuleIds.has(id))
    };
    if (id === "portable-data" && Array.isArray(next.portableDirectories)) {
      next.portableDirectories = next.portableDirectories.filter((directory) => {
        const value = String(directory || "");
        if (value.startsWith("connectors/") || value === "chat-index") {
          return activeFeatures.has("data-connectors");
        }
        if (value === "mail-imports") {
          return activeFeatures.has("macos-mail");
        }
        if (value === "knowledge") {
          return activeFeatures.has("knowledge-core");
        }
        return true;
      });
    }
    return next;
  };
  const modules = baseConfig.modules && typeof baseConfig.modules === "object" ? baseConfig.modules : {};
  const nextModules = Array.isArray(modules)
    ? modules.map((module) => ({
        ...module,
        ...normalizeGeneratedClientModule(module.id, module)
      }))
    : objectFromEntries(Object.entries(modules).map(([id, module]) => [
        id,
        normalizeGeneratedClientModule(id, module)
      ]));
  return {
    ...baseConfig,
    featureProfile: {
      edition: featureRuntime.edition,
      activeFeatureIds: [...(featureRuntime.activeFeatureIds || [])],
      disabledFeatureIds: [...(featureRuntime.disabledFeatureIds || [])],
      generatedAt: featureRuntime.generatedAt
    },
    modules: nextModules
  };
}

export function collectPackagePlan(featureRuntime = {}, options = {}) {
  const featureMap = getFeatureMap();
  const surface = String(options.surface || "all").trim() || "all";
  const includeClientSurface = surface !== "server";
  const includeWebSurface = surface !== "server";
  const includePaths = new Set();
  const excludePaths = new Set();
  const removePaths = new Set();
  const tests = new Set();
  const serverModules = new Set();
  const mounts = new Set();
  const webPanels = new Set();
  const webNavItems = new Set();
  const eventTopics = new Set();
  const clientModules = new Set(includeClientSurface ? activeClientModuleIds(featureRuntime) : []);

  for (const featureId of featureRuntime.activeFeatureIds || []) {
    const feature = featureMap.get(featureId);
    for (const item of feature?.package?.includePaths || []) includePaths.add(item);
    for (const item of feature?.package?.excludePaths || []) excludePaths.add(item);
    for (const item of feature?.tests?.suites || []) tests.add(item);
    for (const item of feature?.server?.modules || []) serverModules.add(item);
    for (const item of feature?.server?.mounts || []) mounts.add(item);
    for (const item of feature?.server?.eventTopics || []) eventTopics.add(item);
    if (includeWebSurface) {
      for (const item of feature?.server?.webPanels || []) webPanels.add(item);
      for (const item of feature?.web?.panels || []) webPanels.add(item);
      for (const item of feature?.web?.navItems || []) webNavItems.add(item);
    }
  }
  for (const featureId of featureRuntime.disabledFeatureIds || []) {
    const feature = featureMap.get(featureId);
    for (const item of feature?.package?.removePaths || feature?.package?.excludePaths || []) {
      removePaths.add(item);
    }
  }

  return {
    edition: featureRuntime.edition,
    surface,
    activeFeatureIds: [...(featureRuntime.activeFeatureIds || [])],
    includePaths: [...includePaths].sort(),
    excludePaths: [...excludePaths].sort(),
    removePaths: [...removePaths].sort(),
    tests: [...tests].sort(),
    serverModules: [...serverModules].sort(),
    mounts: [...mounts].sort(),
    webPanels: [...webPanels].sort(),
    webNavItems: [...webNavItems].sort(),
    eventTopics: [...eventTopics].sort(),
    clientModules: [...clientModules].sort()
  };
}

export async function writeFeaturePlanArtifacts({
  outputDir,
  featureRuntime,
  packagePlan,
  clientPackagingConfig = null,
  verificationReport = null
}) {
  await fs.mkdir(outputDir, { recursive: true });
  const files = {
    "feature-manifest.json": FEATURE_MANIFEST,
    "active-features.json": {
      edition: featureRuntime.edition,
      activeFeatureIds: featureRuntime.activeFeatureIds,
      activeFeatures: featureRuntime.activeFeatures
    },
    "disabled-features.json": {
      edition: featureRuntime.edition,
      disabledFeatureIds: featureRuntime.disabledFeatureIds,
      disabledFeatures: featureRuntime.disabledFeatures
    },
    "package-manifest.json": packagePlan,
    "license-manifest.json": {
      edition: featureRuntime.edition,
      generatedAt: featureRuntime.generatedAt,
      policy: "feature-manifest-driven",
      notices: []
    }
  };
  if (clientPackagingConfig) {
    files["client-packaging.modules.json"] = clientPackagingConfig;
  }
  if (verificationReport) {
    files["verification-report.json"] = verificationReport;
  }

  const written = [];
  for (const [fileName, payload] of Object.entries(files)) {
    const filePath = path.join(outputDir, fileName);
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    written.push(filePath);
  }
  return written;
}

export function diffFeaturePlans(leftRuntime, rightRuntime) {
  const left = new Set(leftRuntime.activeFeatureIds || []);
  const right = new Set(rightRuntime.activeFeatureIds || []);
  return {
    from: leftRuntime.edition,
    to: rightRuntime.edition,
    added: [...right].filter((featureId) => !left.has(featureId)).sort(),
    onlyInFrom: [...left].filter((featureId) => !right.has(featureId)).sort(),
    unchanged: [...right].filter((featureId) => left.has(featureId)).sort()
  };
}
