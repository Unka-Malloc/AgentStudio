import { getJson, postJson } from "./bridge-http";

export type StrategyManagementPolicy = {
  id: string;
  label: string;
  summary: string;
  state: string;
  owner: string;
  source: string;
  route: string;
  routeLabel: string;
  signals: string[];
};

export type StrategyManagementGroup = {
  id: string;
  label: string;
  description: string;
  policies: StrategyManagementPolicy[];
};

export type StrategyDescription = {
  protocolVersion: string;
  capabilities: string[];
  delegatedProtocols?: Record<string, string>;
};

export type StrategyPolicyDecision = {
  protocolVersion?: string;
  strategyProtocolVersion?: string;
  policyType?: string;
  effect?: string;
  reasonCode?: string;
  decisionId?: string;
  [key: string]: unknown;
};

export type StrategyRuntimeProbe = {
  id: string;
  label: string;
  decision: StrategyPolicyDecision | null;
  error: string;
};

export type StrategyManagementRuntime = {
  description: StrategyDescription | null;
  probes: StrategyRuntimeProbe[];
};

export const strategyManagementGroups: StrategyManagementGroup[] = [
  {
    id: "queue",
    label: "队列调度",
    description: "统一收口入队、派发、暂停、恢复、排空和中断告警策略。",
    policies: [
      {
        id: "work-queue-dispatch",
        label: "工作队列调度策略",
        summary: "控制任务入队、分发信用、暂停恢复和排空操作。",
        state: "运行时策略",
        owner: "work-queue-core",
        source: "server/platform/specialized/console/queued-job-workflow-provider.mjs",
        route: "#/admin/jobs",
        routeLabel: "工作队列",
        signals: ["jobs.work-queue.dispatch", "pause/resume", "drain"],
      },
      {
        id: "queue-interruption-alerts",
        label: "队列中断告警策略",
        summary: "定义队列心跳超时、中断闭环和恢复状态的监控阈值。",
        state: "配置文件",
        owner: "ops-monitor",
        source: "server/config/default-monitor-alerts.json",
        route: "#/admin/ops-monitor",
        routeLabel: "运维监控",
        signals: ["queueHeartbeatStaleMs", "queueInterrupted"],
      },
      {
        id: "maintenance-runbook-dispatch",
        label: "智能巡检运行策略",
        summary: "约束巡检 runbook 的触发、执行状态和队列监控登记。",
        state: "运行时策略",
        owner: "maintenance-agent",
        source: "server/platform/interactive/features/feature-manifest.mjs",
        route: "#/admin/maintenance-agent",
        routeLabel: "智能巡检",
        signals: ["maintenance-agent-runbooks", "work-queue-core"],
      },
    ],
  },
  {
    id: "risk",
    label: "风险治理",
    description: "统一查看工具风险、外部服务风险标签、权限裁决和生产门禁风险。",
    policies: [
      {
        id: "tool-risk",
        label: "工具风险分级策略",
        summary: "按只读、可授予、安全写入、修复写入等层级限制工具暴露和调用。",
        state: "目录策略",
        owner: "tool-management-core",
        source: "server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs",
        route: "#/admin/tool-list",
        routeLabel: "工具列表",
        signals: ["risk", "requiredScopes", "toolsets"],
      },
      {
        id: "external-service-risk",
        label: "外部服务风险策略",
        summary: "外部服务配置保存 MCP outlet、权限范围和风险标签。",
        state: "配置策略",
        owner: "external-services",
        source: "server-web/views/ExternalServicesView.vue",
        route: "#/external-services/list",
        routeLabel: "服务列表",
        signals: ["safe_write", "risk", "startupPolicy"],
      },
      {
        id: "production-gates",
        label: "生产门禁风险策略",
        summary: "把质量门禁、权限安全、备份恢复和连续性风险汇总到发布判断。",
        state: "准入策略",
        owner: "production-health",
        source: "server/scripts/production-readiness-gate.mjs",
        route: "#/admin/production-health",
        routeLabel: "交付门禁",
        signals: ["blockedP0", "coverage", "gates"],
      },
    ],
  },
  {
    id: "corpus",
    label: "语料处理",
    description: "统一收口导入、解析、邮件规则、词云和检索 profile 的处理策略。",
    policies: [
      {
        id: "import-file-types",
        label: "导入文件类型策略",
        summary: "定义可导入文件类型、扩展名和文件名白名单。",
        state: "配置文件",
        owner: "knowledge-core",
        source: "server/config/default-import-file-types.json",
        route: "#/knowledge/management",
        routeLabel: "知识归档",
        signals: ["extensions", "fileNames", "mediaType"],
      },
      {
        id: "email-rules",
        label: "邮件处理规则策略",
        summary: "维护邮件分析、专家规则、黄金规则和发布审核边界。",
        state: "规则配置",
        owner: "knowledge-rules",
        source: "server/config/default-email-rules.json",
        route: "#/knowledge/management",
        routeLabel: "处理规则",
        signals: ["expertRules", "goldenRules", "publish"],
      },
      {
        id: "corpus-word-cloud",
        label: "语料词云生成策略",
        summary: "控制语料显著词计算、词袋生成、修复写入和队列登记。",
        state: "运行时策略",
        owner: "knowledge-word-cloud",
        source: "server/platform/specialized/console/knowledge-word-cloud-operation-executor.mjs",
        route: "#/knowledge/wordCloud",
        routeLabel: "语料分析",
        signals: ["significant_terms", "word_clouds", "repair_write"],
      },
      {
        id: "retrieval-profile-rollout",
        label: "检索 profile 灰度策略",
        summary: "约束候选生成、评估、灰度部署、自动发布和回滚。",
        state: "学习策略",
        owner: "knowledge-learning",
        source: "server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs",
        route: "#/knowledge/maintenance",
        routeLabel: "参数配置",
        signals: ["deployments", "promote", "rollback"],
      },
    ],
  },
  {
    id: "authorization",
    label: "权限授权",
    description: "统一查看团队权限上限、用户策略、工具授权令牌和策略预览。",
    policies: [
      {
        id: "authorization-governance",
        label: "统一授权裁决策略",
        summary: "团队权限、用户策略、审批和智能体绑定共同形成最终裁决。",
        state: "治理策略",
        owner: "authorization",
        source: "server/platform/common/console/http/controllers/system-controller-foundation-handlers.mjs",
        route: "#/admin/agent-permissions",
        routeLabel: "权限组",
        signals: ["authorization.policy.evaluate", "teams", "users"],
      },
      {
        id: "tool-grants",
        label: "工具令牌授权策略",
        summary: "管理工具授权令牌、授权例外、策略修订和审计记录。",
        state: "授权策略",
        owner: "tool-management-core",
        source: "server/platform/specialized/capabilities/tools/tool-management-core/store.mjs",
        route: "#/admin/agent-permissions",
        routeLabel: "工具令牌",
        signals: ["grantPolicyRevision", "audit", "policyDecisionId"],
      },
      {
        id: "tool-policy-preview",
        label: "工具策略验证",
        summary: "模拟智能体档案、工具和授权上下文，预览实际裁决结果。",
        state: "验证策略",
        owner: "tool-management-core",
        source: "server/platform/specialized/capabilities/tools/tool-management-core/policy.mjs",
        route: "#/admin/agent-permissions",
        routeLabel: "策略验证",
        signals: ["preview", "effectivePolicySnapshot", "runtime_safety_policy"],
      },
    ],
  },
  {
    id: "context",
    label: "上下文检索",
    description: "统一查看上下文预算、证据排序、保护字段和召回调试策略。",
    policies: [
      {
        id: "context-budget",
        label: "上下文预算策略",
        summary: "按模型窗口分配知识、历史、近期回合和固定记忆预算。",
        state: "配置策略",
        owner: "agent-context",
        source: "server/config/context-profiles",
        route: "#/admin/context-management",
        routeLabel: "上下文管理",
        signals: ["knowledgeBudget", "historyBudget", "recentTurnBudget"],
      },
      {
        id: "evidence-ranking",
        label: "证据排序与保护策略",
        summary: "控制关键证据前置、保护字段、压缩预算和排序权重。",
        state: "运行时策略",
        owner: "agent-context",
        source: "server/platform/specialized/agent/agent-context/context-core/index.mjs",
        route: "#/admin/context-management",
        routeLabel: "上下文管理",
        signals: ["rankingWeights", "placementPolicy", "protectedEvidenceFields"],
      },
      {
        id: "knowledge-recall-debug",
        label: "知识召回调试策略",
        summary: "调试融合策略、学习开关、证据可读性和召回 profile。",
        state: "调试策略",
        owner: "knowledge-core",
        source: "server-web/components/debug/KnowledgeRecallDebugPanel.vue",
        route: "#/debug/knowledgeRecall",
        routeLabel: "知识召回",
        signals: ["retrievalProfile", "learning", "evidence"],
      },
    ],
  },
  {
    id: "release",
    label: "发布封装",
    description: "统一查看发布前基线、运行时依赖、生产准入和迁移封装策略。",
    policies: [
      {
        id: "v001-baseline",
        label: "v0.0.1 基线封装策略",
        summary: "聚合单机运行基线、MCP 出口、本地通用切面和 Secret 模式。",
        state: "发布基线",
        owner: "version-release",
        source: "server/platform/common/v001/baseline-provider.mjs",
        route: "#/admin/version-release",
        routeLabel: "版本发布",
        signals: ["v0.0.1:platform:baseline-1", "mcpOutlets", "ports"],
      },
      {
        id: "runtime-dependencies",
        label: "运行时依赖准备策略",
        summary: "集中检查 Java、Node.js、Python、Docker、网关和智能体后端依赖。",
        state: "环境策略",
        owner: "runtime-dependencies",
        source: "server/config/runtime-downloads.example.json",
        route: "#/admin/runtime-downloads",
        routeLabel: "环境配置",
        signals: ["prepare", "source", "installation"],
      },
      {
        id: "migration-package",
        label: "迁移与回滚封装策略",
        summary: "生成 v0.0.1 迁移报告、回滚辅助脚本和发布证据。",
        state: "发布策略",
        owner: "release-readiness",
        source: "server/scripts/migrate-v001.mjs",
        route: "#/admin/version-release",
        routeLabel: "版本发布",
        signals: ["migration-report", "rollback", "readiness"],
      },
    ],
  },
];

export function strategyManagementTotals(groups = strategyManagementGroups) {
  const policies = groups.flatMap((group) => group.policies);
  return {
    groups: groups.length,
    policies: policies.length,
    sources: new Set(policies.map((policy) => policy.source)).size,
    routes: new Set(policies.map((policy) => policy.route)).size,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runtimeProbe(
  id: string,
  label: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<StrategyRuntimeProbe> {
  try {
    return {
      id,
      label,
      decision: await postJson<StrategyPolicyDecision>(path, payload),
      error: "",
    };
  } catch (error) {
    return {
      id,
      label,
      decision: null,
      error: errorMessage(error),
    };
  }
}

export async function loadStrategyManagementRuntime(): Promise<StrategyManagementRuntime> {
  let description: StrategyDescription | null = null;
  try {
    description = await getJson<StrategyDescription>("/api/strategy");
  } catch {
    description = null;
  }

  const probes = await Promise.all([
    runtimeProbe(
      "queue",
      "队列调度",
      "/api/strategy/queue-policy/evaluate",
      {
        queueDefinitionId: "pact.jobs",
        queueLabel: "Pact Work Queue",
        operationId: "jobs.create",
      },
    ),
    runtimeProbe(
      "workflow",
      "风险流程",
      "/api/strategy/workflow-policy/evaluate",
      {
        workflowId: "pact.release.write",
        risk: "repair_write",
      },
    ),
    runtimeProbe(
      "route",
      "切面路由",
      "/api/strategy/route-policy/evaluate",
      {
        routeId: "pact.downstream.mcp",
        fromAspect: "downstream-client-aspect",
        protocol: "mcp",
        internalCapabilityId: "mcp-server-side",
      },
    ),
  ]);

  return { description, probes };
}
