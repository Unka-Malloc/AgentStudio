import type {
  AgentSettings,
  ClientMigrationState,
  DiscoveryConfig,
  ExpertVocabulary,
  SplitJobStatus,
} from "../lib/types";
import type { AdminView, AppView, CloudProvider, DebugTab, ExternalServiceTab, KnowledgeTab } from "../types/app";

export const modelLibraryProviderDefinitions: Array<{
  id: CloudProvider;
  label: string;
  description: string;
}> = [
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "OpenAI-compatible Chat Completions，API Key 由服务端代理使用。",
  },
  {
    id: "google-gemini",
    label: "Google Gemini",
    description: "Google Generative Language API Key 与 Gemini 模型。",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter API Key、Base URL 与模型 ID。",
  },
  {
    id: "openai-chatgpt",
    label: "ChatGPT OAuth",
    description: "使用 Codex ChatGPT OAuth，不在页面维护 API Key。",
  },
  {
    id: "copilot",
    label: "Copilot / 企业代理",
    description: "企业代理或兼容 Chat Completions 的内部模型服务。",
  },
  {
    id: "custom-http",
    label: "自定义 HTTP Adapter",
    description: "Pact agent 报文格式的外部智能体网关。",
  },
  {
    id: "local-model",
    label: "本地模型服务",
    description: "本机或局域网内的模型服务 Endpoint。",
  },
];

export type IntelligentModuleDefinition = {
  id: string;
  label: string;
  designedModule: string;
  description: string;
  alertRequired?: boolean;
};

export const intelligentModuleDefinitions: IntelligentModuleDefinition[] = [
  {
    id: "knowledgeTaxonomy",
    label: "文档分类智能体",
    designedModule: "知识分类管线",
    description: "邮件和文档进入图谱前的领域、关键词和意图分类。",
    alertRequired: false,
  },
  {
    id: "graphInsight",
    label: "知识图谱智能体",
    designedModule: "图谱洞察管线",
    description: "节点聚合、关系解释和高频实体抽象。",
  },
  {
    id: "timelineDistillation",
    label: "时序提炼智能体",
    designedModule: "时间线提炼管线",
    description: "围绕具体事务提炼阶段、事件和关键节点。",
  },
  {
    id: "agentTools",
    label: "智能体工具调用",
    designedModule: "工具调用权限模块",
    description: "智能体可使用服务端工具的权限范围，不需要单独绑定智能体。",
    alertRequired: false,
  },
  {
    id: "localOcr",
    label: "本地 OCR",
    designedModule: "OCR 多模态解释模块",
    description: "默认不需要大模型，只有开启多模态解释时才分配模型。",
  },
];

export const emptySettings: AgentSettings = {
  tikaJarPath: "",
  javaBinPath: "",
  tikaTimeoutMs: 30 * 60 * 1000,
  modelIntelligenceEnabled: false,
  googleApiKey: "",
  googleApiKeyConfigured: false,
  googleModel: "gemini-flash-lite-latest",
  openAiModel: "gpt-5.4-mini",
  defaultModelProvider: "",
  defaultModel: "",
  modelLibraryEntries: [],
  modelLibraryAgents: [],
  agentPermissionGroups: [],
  agentExploreDefaults: {
    systemPrompt:
      "You are Pact Knowledge Explorer. You are stateless; use the supplied ContextPack as your only memory.",
    toolPolicyPrompt:
      "Always search from coarse to fine. For counts, totals, rankings, frequency, or 'which has the most' questions, first call knowledge_aggregate. For normal evidence recall, first call keyword_search with broad but meaningful keywords, then open_evidence only for promising evidenceId values.",
    continuationPrompt:
      "Continue from the tool results. Call another tool only if more local evidence is needed; otherwise give the final answer with evidenceId citations.",
    answerTemplate: [
      "默认使用以下 Markdown 报告格式输出，除非用户明确要求其他格式。必须保留分割线。",
      "如果用户问题不是风险分析，把“风险”自然替换成“发现 / 事项 / 结论”，但保留同样结构。",
      "",
      "根据对【分析范围】的分析，发现以下【数量】项【风险/发现】：",
      "",
      "---",
      "",
      "1. 【风险图标】 【标题】",
      "",
      "【一段可读说明：写清事实、时间、影响和风险。关键日期、金额、IP、账号、服务名称用加粗突出。不要编造证据中没有的信息。】",
      "",
      "📎 证据来源：evidence::xxxx, evidence::yyyy",
      "",
      "---",
      "",
      "2. 【风险图标】 【标题】",
      "",
      "【说明】",
      "",
      "📎 证据来源：evidence::zzzz",
      "",
      "---",
      "",
      "建议行动：",
      "",
      "- 【行动 1】",
      "- 【行动 2】",
      "- 【行动 3】",
      "",
      "要求：证据 ID 必须保持原样；不要写不存在的 evidenceId；证据不足时添加“不确定项”小节。",
    ].join("\n"),
    contextProfileId: "context-128k",
    thinkingMode: "default",
    temperature: 0.2,
    maxTokens: 1800,
    maxIterations: 4,
    limit: 8,
    toolChoice: "auto",
    infoFeedSummaryModelAlias: "",
    agentRetrievalModelAlias: "",
    ruleAuthoringModelAlias: "",
    reviewFusionModelAlias: "",
    reviewFusionSystemPrompt:
      "你是 Pact 知识冲突融合智能体。你只能基于输入的原始记录、新录入记录、冲突原因和证据字段进行分析。请判断两份知识是完全重合、部分重合还是明显不同；给出相似度、应采取的审核动作和可复核理由。不得改写原始证据，不得编造未提供的信息。",
    reviewFusionTemperature: 0.1,
    reviewFusionMaxTokens: 1200,
  },
  agentToolExecution: {
    functionCallSchema: {
      http_request: {
        method: "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS",
        url: "http://127.0.0.1:7228/api/tool-management/v1/execute",
        headers: {},
        query: {},
        body: {},
        timeoutMs: 30000,
      },
      local_command: {
        commandId: "node-version",
        variables: {
          flag: "--version",
        },
        args: [],
        cwd: "",
        stdin: "",
        timeoutMs: 30000,
      },
    },
    http: {
      enabled: true,
      allowedHosts: ["127.0.0.1", "localhost"],
      timeoutMs: 30000,
      maxResponseBytes: 65536,
    },
    local: {
      enabled: true,
      allowDirectCommands: false,
      timeoutMs: 30000,
      maxOutputBytes: 65536,
      nodeCommand: "",
      commands: [
        {
          commandId: "node-version",
          label: "Node.js version",
          command: "node",
          args: ["{{flag}}"],
          cwd: "",
          description: "跨平台 Node 运行时探测命令。",
          variables: [
            {
              name: "flag",
              label: "版本参数",
              required: false,
              defaultValue: "--version",
              allowedValues: ["--version"],
              description: "智能体通过 function call variables 填入的 Node.js 版本探测参数。",
            },
          ],
          allowExtraArgs: false,
        },
      ],
    },
  },
  moduleModelAssignments: {},
  moduleAgentProfiles: {},
  moduleIntelligence: {
    knowledgeTaxonomy: false,
    graphInsight: true,
    timelineDistillation: true,
    agentTools: false,
    localOcr: false,
  },
  openRouterApiKey: "",
  openRouterApiKeyConfigured: false,
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  openRouterModel: "openai/gpt-4.1-mini",
  deepSeekApiKey: "",
  deepSeekApiKeyConfigured: false,
  deepSeekBaseUrl: "https://api.deepseek.com",
  deepSeekModel: "deepseek-v4-pro",
  deepSeekTimeoutMs: 120000,
  copilotEndpoint: "",
  copilotApiKey: "",
  copilotApiKeyConfigured: false,
  copilotModel: "copilot-default",
  localModelEndpoint: "",
  localModelName: "local-default",
  customModelAlias: "external-agent",
  customModelLabel: "自定义 HTTP 模型",
  customModelApiKey: "",
  customModelApiKeyConfigured: false,
  customHttpAdapter: {
    alias: "external-agent",
    url: "",
    token: "",
    tokenConfigured: false,
    tokenHeader: "token",
    tokenPrefix: "",
    agentName: "",
    pluginList: [],
    engine: "",
    parameters: {},
    timeoutMs: 120000,
  },
  customHttpAdapters: [],
  analysisModuleId: "builtin:heuristic-hybrid-v1",
  ocrEnabled: true,
  ocrPythonPath: "",
  ocrLanguage: "ch",
  retrievalHalfLifeDays: 45,
  staleAfterDays: 180,
  transactionWindowDays: 30,
};

export const emptyDiscovery: DiscoveryConfig = {
  serverId: "",
  serverLabel: "",
  bootstrapBaseUrl: "",
  advertisedBaseUrl: "",
  activeServiceUrl: "",
  forwardBaseUrl: "",
  mode: "active",
  configVersion: "",
  refreshIntervalSeconds: 30,
  checkInIntervalSeconds: 30,
  offlineAfterSeconds: 180,
};

export const emptyExpertVocabulary: ExpertVocabulary = {
  schemaVersion: 1,
  version: 0,
  updatedAt: "",
  publishedAt: "",
  source: "",
  checksum: "",
  entries: [],
};

export const jobStatusLabels: Record<SplitJobStatus, string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

export const migrationStateLabels: Record<ClientMigrationState, string> = {
  aligned: "已切换",
  outdated: "待切换",
  draining: "迁移中",
  "bootstrap-only": "仅引导",
  offline: "离线",
  unknown: "未知",
};

export const moduleNameLabels: Record<string, string> = {
  analysis: "分析引擎",
  ocr: "OCR 识别",
  multimodalParser: "多模态解析",
  documentParser: "文档解析",
  pdfProcessor: "PDF 处理",
  knowledgeBase: "知识库",
  vectorStore: "向量存储",
  graphStore: "图谱存储",
};

export const moduleNameDescriptions: Record<string, string> = {
  analysis: "事务、人物、时间线和检索网络的核心分析管线。",
  ocr: "图片、扫描件和不可复制文本的兜底识别模块。",
  multimodalParser: "图片、表格、版式等多模态文档理解入口。",
  documentParser: "Office、邮件和纯文本文件的结构化提取入口。",
  pdfProcessor: "PDF 专用处理流程，可以先转入 Tika，再按需要触发后续处理。",
  knowledgeBase: "批次提交后的知识沉淀与外部知识库同步。",
  vectorStore: "检索向量写入、召回和相似度计算适配器。",
  graphStore: "关系图谱写入、节点边同步和外部图数据库适配器。",
};

export const moduleGroupDefinitions = [
  {
    id: "analysis",
    label: "分析引擎",
    description: "面向事务、人物、时间线与关联网络的分析模块。",
    names: ["analysis"],
  },
  {
    id: "image",
    label: "图片处理",
    description: "扫描件、图片和多模态文档的识别与理解模块。",
    names: ["ocr", "multimodalParser"],
  },
  {
    id: "document",
    label: "文档处理",
    description: "PDF、Office、邮件和文本文件的结构化解析模块。",
    names: ["documentParser", "pdfProcessor"],
  },
  {
    id: "knowledge",
    label: "知识管理",
    description: "批次完成后的知识沉淀、同步和检索前置模块。",
    names: ["knowledgeBase"],
  },
  {
    id: "storage",
    label: "存储管理",
    description: "向量库与图数据库等外部存储适配模块。",
    names: ["vectorStore", "graphStore"],
  },
];

export const debugTabs: Array<{ id: DebugTab; label: string }> = [
  { id: "knowledgeDistillation", label: "知识蒸馏" },
  { id: "knowledgeRecall", label: "知识召回" },
  { id: "agentRetrieval", label: "智能检索" },
];

export const knowledgeTabs: Array<{ id: KnowledgeTab; label: string }> = [
  { id: "management", label: "知识归档" },
  { id: "wordCloud", label: "语料分析" },
  { id: "maintenance", label: "参数配置" },
];

export const externalServiceTabs: Array<{ id: ExternalServiceTab; label: string }> = [
  { id: "list", label: "服务列表" },
];

export const adminViewTitleMap: Partial<Record<AdminView, string>> = {
  jobs: "任务队列",
  logs: "日志记录",
  tools: "工具列表",
  toolList: "工具列表",
  toolStats: "工具统计",
  agentPermissions: "权限组",
  agentConfig: "大模型配置",
  agentAssignment: "智能体分配",
  contextManagement: "上下文管理",
  maintenanceAgent: "智能巡检",
  opsMonitor: "运维监控",
  runtimeDownloads: "运行时配置",
  clients: "客户端列表",
  storage: "系统概览",
  modules: "接入模块",
};

export const viewTitleMap: Record<AppView, string> = {
  dashboard: "工作台",
  feed: "信息流",
  approval: "审批流",
  sources: "数据源",
  externalServices: "服务",
  knowledge: "知识库",
  workspaces: "协作空间",
  debug: "调试",
  admin: "管理",
};
