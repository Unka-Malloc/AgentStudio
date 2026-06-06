import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { loadSettings } from "../../../../common/platform-core/settings.mjs";
import { createToolCatalog } from "../tool-management-core/catalog.mjs";
import { createToolManagementStore } from "../tool-management-core/store.mjs";

export const AGENT_EXPLORATION_PROTOCOL_VERSION = "pact.agent-exploration.v1";

const EXPLORER_AGENT_ID = "knowledge-explorer";
const DEFAULT_MAX_ITERATIONS = 4;

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const item = normalizeText(value);
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    output.push(item);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function normalizeThinkingMode(value) {
  const mode = normalizeText(value || "default").toLowerCase();
  return ["enabled", "disabled", "default"].includes(mode) ? mode : "default";
}

function thinkingParametersForMode(modeValue) {
  const mode = normalizeThinkingMode(modeValue);
  if (mode === "enabled") {
    return {
      pact_thinking_mode: "enabled"
    };
  }
  if (mode === "disabled") {
    return {
      pact_thinking_mode: "disabled"
    };
  }
  return {};
}

function truncateText(value, maxLength = 2400) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 20)).trim()}...[truncated]`;
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

const LOCAL_COMMAND_TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.-]*)\s*\}\}/g;

function collectLocalCommandTemplateVariables(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLocalCommandTemplateVariables(item, output);
    }
    return output;
  }
  const text = String(value ?? "");
  for (const match of text.matchAll(LOCAL_COMMAND_TEMPLATE_VARIABLE_PATTERN)) {
    output.add(match[1]);
  }
  return output;
}

function normalizeLocalCommandVariableDefinition(value = {}) {
  const definition = asObject(value);
  const name = normalizeText(definition.name || definition.key || "");
  if (!name) {
    return null;
  }
  const hasDefault = Object.hasOwn(definition, "defaultValue") || Object.hasOwn(definition, "default");
  return {
    name,
    required: definition.required === true,
    ...(hasDefault
      ? { defaultValue: String(definition.defaultValue ?? definition.default ?? "") }
      : {}),
    allowedValues: uniqueStrings(definition.allowedValues || definition.enum || definition.options || [], 100)
  };
}

function replaceLocalCommandTemplateVariables(value, variables = {}) {
  return String(value ?? "").replace(
    LOCAL_COMMAND_TEMPLATE_VARIABLE_PATTERN,
    (_match, name) => String(variables[name] ?? "")
  );
}

function resolveLocalCommandTemplate(template = {}, args = {}) {
  const commandTemplate = asObject(template);
  const suppliedVariables = asObject(args.variables || args.params || args.templateVariables);
  const definitions = asArray(commandTemplate.variables)
    .map((item) => normalizeLocalCommandVariableDefinition(item))
    .filter(Boolean);
  const definitionByName = new Map(definitions.map((item) => [item.name, item]));
  const placeholderNames = collectLocalCommandTemplateVariables([
    commandTemplate.command,
    commandTemplate.args,
    commandTemplate.cwd,
    commandTemplate.stdin
  ]);
  const requiredNames = new Set([
    ...placeholderNames,
    ...definitions.filter((item) => item.required).map((item) => item.name)
  ]);
  const resolvedVariables = {};

  for (const name of requiredNames) {
    const definition = definitionByName.get(name);
    if (!definition) {
      return {
        ok: false,
        error: "local_command_variable_not_declared",
        variable: name,
        commandId: normalizeText(commandTemplate.commandId || commandTemplate.id || "")
      };
    }
    const supplied = Object.hasOwn(suppliedVariables, name);
    const hasDefault = Object.hasOwn(definition, "defaultValue");
    if (!supplied && !hasDefault) {
      return {
        ok: false,
        error: "local_command_variable_required",
        variable: name,
        commandId: normalizeText(commandTemplate.commandId || commandTemplate.id || "")
      };
    }
    const rawValue = supplied ? suppliedVariables[name] : definition.defaultValue;
    const value = String(rawValue ?? "");
    if (definition.allowedValues.length > 0 && !definition.allowedValues.includes(value)) {
      return {
        ok: false,
        error: "local_command_variable_not_allowed",
        variable: name,
        allowedValues: definition.allowedValues,
        commandId: normalizeText(commandTemplate.commandId || commandTemplate.id || "")
      };
    }
    resolvedVariables[name] = value;
  }

  return {
    ok: true,
    command: replaceLocalCommandTemplateVariables(commandTemplate.command, resolvedVariables),
    args: asArray(commandTemplate.args).map((item) =>
      replaceLocalCommandTemplateVariables(item, resolvedVariables)
    ),
    cwd: replaceLocalCommandTemplateVariables(commandTemplate.cwd, resolvedVariables),
    stdin: commandTemplate.stdin === undefined
      ? undefined
      : replaceLocalCommandTemplateVariables(commandTemplate.stdin, resolvedVariables),
    allowExtraArgs: commandTemplate.allowExtraArgs === true,
    allowedVariables: definitions.map((item) => item.name),
    variables: resolvedVariables
  };
}

function stableHash(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\n"))
    .digest("hex");
}

function stableId(prefix, ...parts) {
  return `${prefix}_${stableHash(prefix, ...parts).slice(0, 24)}`;
}

function getKnowledgeCore(runtime) {
  const mount = runtime?.mounts?.knowledgeBase;
  if (!mount || mount.enabled === false) {
    return null;
  }
  return mount;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function toolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "knowledge_skill_search",
        description:
          "Search published Pact KnowledgeSkills before raw evidence recall. Use this first for broad topics so the agent can apply reusable concepts, heuristics, anti-patterns, and honest boundaries.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              description: "User topic or task to match against published KnowledgeSkills."
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Maximum number of skills to return."
            },
            status: {
              type: "string",
              enum: ["published", "pending_review", "draft"],
              description: "Skill status filter. Defaults to published."
            }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "keyword_search",
        description:
          "Use Pact local knowledge recall over the knowledge base. It follows the active retrieval profile, learning switch, and coarse-to-fine hierarchy before opening detailed evidence.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              description: "A focused keyword query. Prefer concrete nouns, entities, dates, amounts, document titles, or user terms."
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              description: "Maximum number of search results."
            },
            batchId: {
              type: "string",
              description: "Optional batch id. Leave empty for global search."
            },
            retrievalMode: {
              type: "string",
              enum: ["hybrid", "keyword", "lexical"],
              description: "Use hybrid for normal recall. Use keyword/lexical only for exact keyword debugging."
            },
            keywordOnly: {
              type: "boolean",
              description: "Force lexical-only recall. Leave false unless exact keyword debugging is required."
            },
            learningEnabled: {
              type: "boolean",
              description: "Whether to allow active learning/canary retrieval profiles. Defaults to true."
            }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "knowledge_aggregate",
        description:
          "Use Pact local knowledge aggregation for counting, ranking, totals, and 'which has the most' questions. Use this before keyword_search when the user asks for counts such as which sender mailbox has the most advertising emails.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            metric: {
              type: "string",
              enum: ["email_advertising_by_sender", "email_count_by_sender"],
              description:
                "Aggregation metric. email_advertising_by_sender counts advertising-like email documents; email_count_by_sender counts email documents without a category filter."
            },
            groupBy: {
              type: "string",
              enum: ["senderEmail", "senderDomain", "recipientEmail", "recipientDomain", "documentType"],
              description: "Dimension to group counts by. Use senderEmail for 发件邮箱; recipientEmail for 收件箱/你的邮箱."
            },
            query: {
              type: "string",
              description: "Optional keyword filter applied before aggregation."
            },
            batchId: {
              type: "string",
              description: "Optional batch id. Leave empty for global aggregation."
            },
            categoryId: {
              type: "string",
              description:
                "Optional taxonomy category id used for the aggregate filter. Defaults to the configured marketing category for advertising metrics."
            },
            categoryPath: {
              type: "string",
              description: "Optional taxonomy category path used for the aggregate filter."
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              description: "Maximum number of groups to return."
            }
          },
          required: ["metric"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "open_evidence",
        description:
          "Open a specific evidence pack returned by keyword_search or knowledge_aggregate when the title/snippet is insufficient.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            evidenceId: {
              type: "string",
              description: "The evidenceId returned by keyword_search or a knowledge_aggregate example."
            }
          },
          required: ["evidenceId"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "knowledge_skill_propose",
        description:
          "Create a pending-review Pact KnowledgeSkill from reusable, evidence-backed reasoning discovered during this run. Use only after local evidence exists; this does not publish or mutate canonical facts.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            sourceQuery: {
              type: "string",
              description: "The user query or reusable topic this Skill should serve."
            },
            summary: {
              type: "string",
              description: "Short reusable summary of what the Skill helps decide."
            },
            applicability: {
              type: "object",
              properties: {
                useWhen: { type: "array", items: { type: "string" } },
                avoidWhen: { type: "array", items: { type: "string" } }
              }
            },
            coreConcepts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  term: { type: "string" },
                  weight: { type: "number" },
                  evidenceRefs: { type: "array", items: { type: "string" } }
                }
              }
            },
            decisionHeuristics: { type: "array", items: { type: "string" } },
            antiPatterns: { type: "array", items: { type: "string" } },
            honestBoundaries: { type: "array", items: { type: "string" } },
            verificationQuestions: { type: "array", items: { type: "string" } },
            evidenceRefs: {
              type: "array",
              items: { type: "string" },
              description: "Evidence IDs that directly support the Skill. Required."
            },
            reuseReason: {
              type: "string",
              description: "Why this should become a reusable Skill instead of only a one-off answer."
            },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          },
          required: ["title", "summary", "decisionHeuristics", "honestBoundaries", "evidenceRefs"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "golden_rule_authoring",
        description:
          "Create a draft GoldenRulePackage from a configured JSON template after intent recognition and gate validation. Use when the user asks to create a reusable rule, review rule, golden rule, deduplication rule, or agent-operable policy. This only submits a draft for human confirmation; it does not publish automatically.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            message: {
              type: "string",
              description: "Natural-language rule requirement from the user or this run."
            },
            modelEnabled: {
              type: "boolean",
              description:
                "Whether the rule authoring runtime may use the selected model for intent/template variable hints. Defaults to false."
            }
          },
          required: ["message"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "http_request",
        description:
          "Call an allowlisted HTTP endpoint. Supports GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS. Use only when a configured HTTP tool endpoint is needed.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
            },
            url: { type: "string" },
            headers: { type: "object" },
            query: { type: "object" },
            body: {},
            timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }
          },
          required: ["method", "url"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "local_command",
        description:
          "Run a permission-governed allowlisted local command template using Node.js spawn with shell=false. Direct commands are not accepted.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            commandId: { type: "string" },
            command: { type: "string" },
            args: {
              type: "array",
              items: { type: "string" }
            },
            variables: {
              type: "object",
              description:
                "Template variables declared by the selected commandId. Values replace {{variableName}} placeholders in command, args, cwd, or stdin."
            },
            cwd: { type: "string" },
            stdin: { type: "string" },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 }
          }
        }
      }
    }
  ];
}

function normalizeToolCall(call, index = 0) {
  if (!call || typeof call !== "object") {
    return null;
  }
  const rawFunction = asObject(call.function || call.function_call);
  const name = normalizeText(
    call.name ||
      rawFunction.name ||
      call.toolName ||
      call.tool_name ||
      call.functionName ||
      call.function_name ||
      ""
  );
  if (!name) {
    return null;
  }
  const rawArguments =
    rawFunction.arguments ??
    call.arguments ??
    call.args ??
    call.parameters ??
    call.params ??
    {};
  const parsedArguments =
    typeof rawArguments === "string" ? safeJsonParse(rawArguments, {}) : asObject(rawArguments);
  return {
    id: normalizeText(call.id || call.tool_call_id || `call_${index + 1}`),
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(parsedArguments)
    },
    name,
    arguments: parsedArguments
  };
}

function toolCallsFromParsedValue(parsed) {
  if (!parsed) {
    return [];
  }
  const rawCalls = Array.isArray(parsed)
    ? parsed
    : asArray(parsed.tool_calls).length
      ? parsed.tool_calls
      : asArray(parsed.toolCalls).length
        ? parsed.toolCalls
        : parsed.function_call
          ? [parsed.function_call]
          : parsed.name || parsed.toolName || parsed.tool_name
            ? [parsed]
            : [];
  return rawCalls.map(normalizeToolCall).filter(Boolean);
}

function parseToolCallCandidate(candidate) {
  const parsed = safeJsonParse(candidate);
  return toolCallsFromParsedValue(parsed);
}

function extractTaggedToolCallTexts(text) {
  const source = String(text || "");
  const results = [];
  for (const pattern of [
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi,
    /<tool_calls>\s*([\s\S]*?)\s*<\/tool_calls>/gi
  ]) {
    let match = pattern.exec(source);
    while (match) {
      const content = String(match[1] || "").trim();
      if (content) {
        results.push(content);
      }
      match = pattern.exec(source);
    }
  }
  return results;
}

function extractJsonToolCallsFromText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return [];
  }
  const taggedCalls = extractTaggedToolCallTexts(trimmed)
    .flatMap((candidate) => parseToolCallCandidate(candidate))
    .filter(Boolean);
  if (taggedCalls.length) {
    return taggedCalls;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [trimmed, fenced].filter(Boolean);
  for (const candidate of candidates) {
    const calls = parseToolCallCandidate(candidate);
    if (calls.length) {
      return calls;
    }
  }
  return [];
}

function extractToolCalls(agentResult = {}) {
  const direct = asArray(agentResult.toolCalls || agentResult.tool_calls)
    .map(normalizeToolCall)
    .filter(Boolean);
  if (direct.length) {
    return {
      calls: direct,
      source: "native_tool_calls"
    };
  }

  const payload = agentResult.payload;
  const payloadCalls = asArray(payload?.choices)
    .flatMap((choice) => {
      const message = asObject(choice?.message);
      return [
        ...asArray(message.tool_calls || message.toolCalls),
        ...(message.function_call ? [message.function_call] : [])
      ];
    })
    .map(normalizeToolCall)
    .filter(Boolean);
  if (payloadCalls.length) {
    return {
      calls: payloadCalls,
      source: "native_payload_tool_calls"
    };
  }

  const textCalls = extractJsonToolCallsFromText(agentResult.answer || agentResult.text || "");
  return {
    calls: textCalls,
    source: textCalls.length ? "json_text_tool_call" : "none"
  };
}

function assistantToolCallMessage(toolCalls, reasoningContent = "") {
  const message = {
    role: "assistant",
    content: "",
    tool_calls: asArray(toolCalls).map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.arguments || {})
      }
    }))
  };
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }
  return message;
}

function reasoningContentFromAgentResult(agentResult = {}) {
  return firstNonEmpty(
    asArray(agentResult.chunks?.reasoning).join(""),
    agentResult.reasoning_content,
    agentResult.reasoning,
    agentResult.thinking
  );
}

function functionCallMessage(toolCall) {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments || {})
        }
      }
    ]
  };
}

function toolResultMessage(toolCall, result) {
  return {
    role: "tool",
    tool_call_id: toolCall.id,
    name: toolCall.name,
    content: JSON.stringify(result)
  };
}

function compactSearchItems(result = {}, limit = 10) {
  return asArray(result.items || result.results)
    .slice(0, Math.max(1, Math.min(Number(limit || 10), 20)))
    .map((item, index) => ({
      rank: index + 1,
      evidenceId: item.evidenceId || "",
      documentId: item.documentId || item.itemId || "",
      title: item.title || "",
      snippet: truncateText(item.snippet || item.summary || "", 900),
      score: Number(item.score || item.finalScore || item.relevanceScore || 0),
      hierarchy: item.hierarchy || null,
      modalities: item.modalities || [],
      assetCount: asArray(item.assets).length,
      source: item.source || item.sourceLocator || null,
      reasons: asArray(item.reasons).slice(0, 4)
    }));
}

function compactEvidence(evidence = {}) {
  const payload = asObject(evidence.payload);
  const document = asObject(payload.document || evidence.document);
  const section = asObject(payload.section || evidence.section);
  const blocks = asArray(payload.blocks || evidence.blocks).slice(0, 4).map((block) => ({
    blockId: block.blockId || block.block_id || "",
    title: block.title || block.blockType || "",
    text: truncateText(firstNonEmpty(block.text, block.snippet, block.summary), 2600)
  }));
  const assets = asArray(payload.assets || evidence.assets).slice(0, 12).map((asset) => ({
    assetId: asset.assetId || asset.asset_id || "",
    mediaType: asset.mediaType || asset.media_type || "",
    title: asset.title || "",
    caption: truncateText(asset.caption || "", 600),
    ocrText: truncateText(asset.ocrText || asset.ocr_text || "", 600),
    sourceLocator: asset.sourceLocator || null
  }));
  return {
    evidenceId: evidence.evidenceId || "",
    title: evidence.title || document.title || "",
    snippet: truncateText(evidence.snippet || "", 1200),
    score: Number(evidence.score || 0),
    document: {
      documentId: document.documentId || "",
      title: document.title || "",
      documentType: document.documentType || "",
      sourcePath: document.sourcePath || "",
      batchId: document.batchId || evidence.batchId || ""
    },
    section: {
      sectionId: section.sectionId || "",
      title: section.title || ""
    },
    blocks,
    assets,
    locator: evidence.locator || evidence.sourceLocator || null,
    markdown: truncateText(evidence.markdown || "", 5000)
  };
}

function evidenceItemsForContext(toolResults = []) {
  return toolResults.flatMap((entry) => {
    if (entry.tool === "keyword_search") {
      return asArray(entry.result?.items).map((item) => ({
        evidenceId: item.evidenceId,
        title: item.title,
        snippet: item.snippet,
        sourceLocator: item.source || item.hierarchy || null
      }));
    }
    if (entry.tool === "knowledge_aggregate") {
      return asArray(entry.result?.groups)
        .flatMap((group) => asArray(group.examples).map((example) => ({
          evidenceId: example.evidenceId,
          title: `${group.label || group.key} (${group.count}) - ${example.title || ""}`,
          snippet: entry.result?.methodology || "",
          sourceLocator: { aggregateGroup: group.key, metric: entry.result?.metric }
        })))
        .filter((item) => item.evidenceId);
    }
    if (entry.tool === "open_evidence") {
      return [
        {
          evidenceId: entry.result?.evidence?.evidenceId,
          title: entry.result?.evidence?.title,
          snippet: entry.result?.evidence?.snippet || asArray(entry.result?.evidence?.blocks)[0]?.text || "",
          sourceLocator: entry.result?.evidence?.locator || null
        }
      ].filter((item) => item.evidenceId);
    }
    if (entry.tool === "knowledge_skill_propose") {
      return asArray(entry.result?.evidenceRefs).map((evidenceId) => ({
        evidenceId,
        title: entry.result?.title || "",
        snippet: entry.result?.summary || "",
        sourceLocator: { skillId: entry.result?.skillId || "" }
      }));
    }
    if (entry.tool === "golden_rule_authoring") {
      return asArray(entry.result?.gate?.scenarios)
        .flatMap((scenario) => asArray(scenario.result?.context?.candidate?.evidenceRefs))
        .map((evidenceId) => ({
          evidenceId,
          title: entry.result?.package?.rules?.[0]?.label || "GoldenRule draft",
          snippet: entry.result?.package?.rules?.[0]?.reason || "",
          sourceLocator: { packageId: entry.result?.confirmation?.packageId || "" }
        }));
    }
    return [];
  });
}

const DEFAULT_EXPLORATION_PROMPT = {
  systemPrompt:
    "You are Pact Knowledge Explorer. You are stateless; use the supplied ContextPack as your only memory.",
  toolPolicyPrompt:
    "Always search from coarse to fine. For broad topic questions, first inspect KnowledgeSkillContext or call knowledge_skill_search. For counts, totals, rankings, frequency, or 'which has the most' questions, first call knowledge_aggregate. For normal evidence recall, call keyword_search with broad but meaningful keywords, then open_evidence only for promising evidenceId values. If the user asks to create a golden/review/deduplication rule, call golden_rule_authoring. If the run discovers a reusable evidence-backed procedure, call knowledge_skill_propose to create a pending-review Skill.",
  continuationPrompt:
    "Continue from the tool results. Call another tool only if more local evidence is needed; otherwise give the final answer with evidenceId citations.",
  answerTemplate:
    [
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
      "要求：证据 ID 必须保持原样；不要写不存在的 evidenceId；证据不足时添加“不确定项”小节。"
    ].join("\n"),
  temperature: 0.2,
  maxTokens: 1800,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  limit: 8,
  toolChoice: "auto"
};

function buildSystemMemory({ query, contextPack, toolPolicy, config = {} }) {
  const explorationConfig = {
    ...DEFAULT_EXPLORATION_PROMPT,
    ...asObject(config)
  };
  return [
    explorationConfig.systemPrompt,
    "You must use native function calls when you need local data. Do not invent documents, evidence ids, dates, amounts, or claims.",
    "Before raw evidence recall, inspect the supplied KnowledgeSkillContext. If it contains a matching published Skill, apply its heuristics and boundaries first, then cite original evidence.",
    explorationConfig.toolPolicyPrompt,
    "For broad topic questions, prefer knowledge_skill_search before keyword_search. KnowledgeSkills are guidance, not canonical facts; evidenceId citations still decide final claims.",
    "Only call knowledge_skill_propose when the result is reusable beyond this one answer, includes real evidenceRefs, and does not propose canonical fact/entity/relation/raw evidence changes.",
    "Only call golden_rule_authoring when the user asks for a reusable rule or the run clearly needs a reviewable rule. Generated rules must stay draft/pending human confirmation.",
    "For quantity questions, do not estimate from a small search result set. Use knowledge_aggregate and cite its example evidence ids.",
    "If the current evidence is insufficient, call keyword_search again with a better query. If it is sufficient, answer with cited evidence ids.",
    "Return a concise human answer in Chinese unless the user asked otherwise.",
    `Answer template:\n${explorationConfig.answerTemplate}`,
    `User task: ${query}`,
    `Tool policy: ${JSON.stringify(toolPolicy)}`,
    `KnowledgeSkillContext: ${JSON.stringify(contextPack?.knowledgeSkillContext || {})}`,
    formatContextPackForPrompt(contextPack)
  ].join("\n\n");
}

function compactJson(value, maxLength = 12000) {
  const text = JSON.stringify(value || {}, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...<truncated>` : text;
}

function formatContextPackForPrompt(contextPack = {}) {
  const budget = contextPack.budgetReport || {};
  const sections = [
    "ContextPack is compiled locally. Treat it as the only memory for this stateless call.",
    `Context build: ${contextPack.contextBuildRecordId || "unrecorded"} / profile ${contextPack.profileId || "unknown"} / ${budget.totalTokens || 0} tokens.`,
    "",
    "## Task Brief",
    contextPack.taskBrief || "",
    "",
    "## Memory Blocks",
    compactJson(contextPack.memoryBlocks || [], 5000),
    "",
    "## Human Expert Guidance",
    compactJson(contextPack.expertGuidance || [], 5000),
    "",
    "## Critical Evidence Index",
    compactJson(contextPack.criticalEvidenceIndex || [], 7000),
    "",
    "## Evidence Pack",
    compactJson(contextPack.evidencePack || contextPack.retrievedKnowledge || [], 12000),
    "",
    "## Tool State Summary",
    compactJson(contextPack.toolStateSummary || contextPack.toolState || {}, 5000),
    "",
    "## Compressed History",
    String(contextPack.compressedHistory || "").slice(0, 6000),
    "",
    "## Recent Turns",
    compactJson(contextPack.recentTurns || [], 7000),
    "",
    "## Tail Checklist",
    compactJson(contextPack.tailChecklist || {}, 4000)
  ];
  return sections.join("\n");
}

function compactContextPackForStorage(contextPack = null) {
  if (!contextPack || typeof contextPack !== "object") {
    return null;
  }
  return {
    profileId: contextPack.profileId || "",
    contextBuildRecordId: contextPack.contextBuildRecordId || "",
    budgetReport: contextPack.budgetReport || null,
    criticalEvidenceIndex: asArray(contextPack.criticalEvidenceIndex).slice(0, 24),
    toolStateSummary: contextPack.toolStateSummary || contextPack.toolState || null,
    compressedHistory: truncateText(contextPack.compressedHistory || "", 3000),
    recentTurns: asArray(contextPack.recentTurns).slice(-6),
    tailChecklist: contextPack.tailChecklist || null,
    compaction: contextPack.compaction || contextPack.compactionResult || null
  };
}

function compactToolResultForStorage(entry = {}) {
  const result = asObject(entry.result);
  const tool = String(entry.tool || "");
  if (tool === "keyword_search") {
    return {
      ...entry,
      result: {
        ok: result.ok !== false,
        query: result.query || "",
        retrievalMode: result.retrievalMode || "",
        count: result.count,
        hierarchy: result.hierarchy || null,
        queryIntent: result.queryIntent || null,
        items: asArray(result.items).slice(0, 10),
        explain: result.explain || null
      }
    };
  }
  if (tool === "open_evidence") {
    return {
      ...entry,
      result: {
        ok: result.ok !== false,
        evidence: compactEvidence(result.evidence || {}),
        error: result.error || ""
      }
    };
  }
  if (tool === "knowledge_aggregate") {
    return {
      ...entry,
      result: {
        ok: result.ok !== false,
        metric: result.metric || "",
        groupBy: result.groupBy || "",
        methodology: truncateText(result.methodology || "", 1200),
        topGroup: result.topGroup || null,
        groups: asArray(result.groups).slice(0, 12).map((group) => ({
          ...group,
          evidenceRefs: asArray(group.evidenceRefs).slice(0, 12),
          examples: asArray(group.examples).slice(0, 5)
        })),
        error: result.error || ""
      }
    };
  }
  if (tool === "knowledge_skill_search") {
    return {
      ...entry,
      result: {
        ok: result.ok !== false,
        query: result.query || "",
        count: result.count,
        skills: asArray(result.skills).slice(0, 8),
        error: result.error || ""
      }
    };
  }
  const text = JSON.stringify(result || {});
  return {
    ...entry,
    result: text.length > 50000
      ? {
          ok: result.ok !== false,
          error: result.error || "",
          truncated: true,
          originalChars: text.length,
          preview: truncateText(text, 8000)
        }
      : result
  };
}

function compactToolResultsForStorage(toolResults = []) {
  return asArray(toolResults).slice(-24).map(compactToolResultForStorage);
}

function compactAgentResponse(agentResult = {}) {
  return {
    ok: agentResult.ok !== false,
    answer: truncateText(agentResult.answer || agentResult.text || "", 3000),
    dialogId: agentResult.dialogId || "",
    finish: agentResult.finish !== false,
    upstream: agentResult.upstream || null,
    request: agentResult.request
      ? {
          agentName: agentResult.request.agentName || "",
          engine: agentResult.request.engine || ""
        }
      : null
  };
}

function normalizeToolName(value) {
  const name = normalizeText(value).replace(/^pact[._-]/i, "");
  if (["keyword_search", "keywordSearch", "search", "knowledge_search"].includes(name)) {
    return "keyword_search";
  }
  if (["knowledge_skill_search", "knowledgeSkillSearch", "skill_search", "skills"].includes(name)) {
    return "knowledge_skill_search";
  }
  if (["knowledge_skill_propose", "knowledgeSkillPropose", "skill_propose", "create_skill"].includes(name)) {
    return "knowledge_skill_propose";
  }
  if (["golden_rule_authoring", "goldenRuleAuthoring", "rule_authoring", "create_rule", "golden_rule"].includes(name)) {
    return "golden_rule_authoring";
  }
  if (["knowledge_aggregate", "knowledgeAggregate", "aggregate", "count", "stats", "statistics"].includes(name)) {
    return "knowledge_aggregate";
  }
  if (["open_evidence", "openEvidence", "get_evidence", "evidence"].includes(name)) {
    return "open_evidence";
  }
  if (["http_request", "httpRequest", "http", "request"].includes(name)) {
    return "http_request";
  }
  if (["local_command", "localCommand", "command", "shell", "skill"].includes(name)) {
    return "local_command";
  }
  return name;
}

const AGENT_EXPLORATION_TOOL_CATALOG = createToolCatalog({
  activeFeatureIds: ["agent-exploration"]
});
const AGENT_EXPLORATION_CATALOG_TOOLS_BY_NAME = new Map(
  AGENT_EXPLORATION_TOOL_CATALOG.tools
    .filter((tool) => String(tool.id || "").startsWith("agent-exploration."))
    .map((tool) => [
      normalizeToolName(String(tool.id || "").replace(/^agent-exploration\./, "")),
      {
        ...tool,
        status: tool.status === "internal" ? "active" : tool.status
      }
    ])
);
const MANAGED_GRANT_REQUIRED_TOOLS = new Set([
  "knowledge_skill_propose",
  "golden_rule_authoring",
  "http_request",
  "local_command"
]);

function catalogToolForAgentExplorationTool(toolName) {
  return AGENT_EXPLORATION_CATALOG_TOOLS_BY_NAME.get(normalizeToolName(toolName)) || null;
}

function inferToolRequestedAction(toolName, args = {}, tool = null) {
  return firstNonEmpty(
    args.requestedAction,
    args.action,
    args.operationId,
    tool?.operationId,
    tool?.id,
    toolName
  );
}

function inferToolResourceType(args = {}, context = {}) {
  const resource = asObject(args.resource);
  if (args.resourceType || args["resource-type"] || resource.resourceType || resource.type) {
    return firstNonEmpty(args.resourceType, args["resource-type"], resource.resourceType, resource.type);
  }
  if (args.repoId || args.repository || args.repositoryRef || context.repoId) {
    return "repo";
  }
  if (args.codespaceId || args.workspaceId || context.workspaceId) {
    return "codespace";
  }
  return "";
}

function inferToolResourceId(args = {}, context = {}) {
  const resource = asObject(args.resource);
  return firstNonEmpty(
    args.resourceId,
    args.repoId,
    args.repositoryRef,
    args.repository,
    resource.resourceId,
    resource.id,
    args.codespaceId,
    args.workspaceId,
    context.repoId,
    context.workspaceId,
    args.commandId,
    args.id,
    args.url,
    "*"
  );
}

function inferToolTargetProvider(args = {}) {
  const resource = asObject(args.resource);
  return firstNonEmpty(
    args.targetProvider,
    args.provider,
    args.reviewProvider,
    resource.targetProvider,
    String(args.url || "").startsWith("http") ? "http" : ""
  );
}

function inferRequestedEgress(args = {}) {
  if (!args.url) {
    return "";
  }
  try {
    const url = new URL(String(args.url));
    return url.hostname;
  } catch {
    return "";
  }
}

function toolRequiresManagedGrant(toolName, args = {}, tool = null) {
  const name = normalizeToolName(toolName);
  if (MANAGED_GRANT_REQUIRED_TOOLS.has(name)) {
    return true;
  }
  const resourceType = inferToolResourceType(args);
  return resourceType === "repo" || resourceType === "codespace" || Boolean(tool?.destructive);
}

function limitTextBytes(value, maxBytes = 65536) {
  const text = String(value ?? "");
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return text;
  }
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n...[truncated ${buffer.byteLength} bytes]`;
}

function appendQuery(url, query = {}) {
  const parsed = new URL(String(url));
  for (const [key, value] of Object.entries(asObject(query))) {
    if (value === undefined || value === null) {
      continue;
    }
    parsed.searchParams.set(key, String(value));
  }
  return parsed;
}

function hostAllowed(hostname, allowedHosts = []) {
  const normalized = String(hostname || "").toLowerCase();
  return asArray(allowedHosts).some((host) => {
    const allowed = String(host || "").toLowerCase().trim();
    return allowed === "*" || allowed === normalized;
  });
}

function finalFallback({ query, toolResults }) {
  const searchItems = toolResults
    .filter((entry) => entry.tool === "keyword_search")
    .flatMap((entry) => asArray(entry.result?.items))
    .slice(0, 5);
  if (!searchItems.length) {
    return `没有找到足够证据回答“${query}”。`;
  }
  const lines = searchItems.map((item, index) => {
    const citation = item.evidenceId ? ` [${item.evidenceId}]` : "";
    return `${index + 1}. ${item.title || "未命名证据"}${citation}：${truncateText(item.snippet || "", 160)}`;
  });
  return [`已完成本地关键词检索，模型未给出最终整合回答。候选证据：`, ...lines].join("\n");
}

export function createAgentExplorationRuntime({
  userDataPath = "",
  runtime,
  agentWorkspace,
  contextRuntime,
  agentGatewayCall,
  knowledgeSkillRuntime = null,
  knowledgeRuleAuthoringRuntime = null,
  clientRuntimeAllocator = null,
  securityPermissions = null
} = {}) {
  const auditLogPath = userDataPath ? path.join(userDataPath, "logs", "agent-exploration.jsonl") : "";

  async function appendAuditLog(event = {}) {
    if (!auditLogPath) {
      return;
    }
    const payload = {
      schemaVersion: 1,
      protocolVersion: AGENT_EXPLORATION_PROTOCOL_VERSION,
      at: nowIso(),
      ...event
    };
    try {
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.appendFile(auditLogPath, `${JSON.stringify(payload)}\n`, "utf8");
    } catch {
      // Audit logging must not break exploration runs.
    }
  }

  function loadToolGrant(grantId = "") {
    const id = normalizeText(grantId);
    if (!id || !userDataPath) {
      return null;
    }
    const store = createToolManagementStore({ userDataPath });
    try {
      return store.getGrant(id) || null;
    } finally {
      store.close();
    }
  }

  function buildAuthorizationIdentity(options = {}, grant = null) {
    const authSession = options.authSession || null;
    const user = authSession?.user || {};
    const agentId = firstNonEmpty(
      options.agentId,
      options.agentProfileId,
      options.profileId,
      grant?.metadata?.agentId,
      grant?.metadata?.agentProfileId,
      EXPLORER_AGENT_ID
    );
    const boundUserId = firstNonEmpty(
      options.boundUserId,
      options.userId,
      user.userId,
      user.username,
      grant?.metadata?.boundUserId,
      grant?.metadata?.userId
    );
    return {
      subject: {
        type: "agent-profile",
        subjectId: agentId,
        username: agentId,
        roleId: user.roleId || "",
        scopes: uniqueStrings([
          ...asArray(options.scopes),
          ...asArray(grant?.scopes)
        ]),
        capabilities: asArray(options.capabilities),
        agentProfileId: agentId,
        maxRisk: firstNonEmpty(options.maxRisk, grant?.maxRisk, grant?.metadata?.maxRisk, user.maxRisk),
        tenantId: user.tenantId || grant?.tenantId || grant?.metadata?.tenantId || "",
        orgId: user.orgId || grant?.orgId || grant?.metadata?.orgId || "",
        teamIds: uniqueStrings([
          ...asArray(options.teamIds),
          ...asArray(options.workspaceContext?.teamIds),
          ...asArray(grant?.teamIds),
          ...asArray(grant?.metadata?.teamIds)
        ]),
        allowedWorkspaceIds: asArray(options.allowedWorkspaceIds),
        allowedDataClasses: asArray(options.allowedDataClasses),
        allowedEgress: asArray(options.allowedEgress),
        metadata: {
          boundUserId,
          userId: boundUserId,
          teamIds: uniqueStrings([
            ...asArray(options.teamIds),
            ...asArray(options.workspaceContext?.teamIds),
            ...asArray(grant?.metadata?.teamIds)
          ])
        }
      },
      agentId,
      boundUserId
    };
  }

  function buildAuthorizationInput(toolName, args = {}, options = {}, tool = null) {
    const resourceType = inferToolResourceType(args, options);
    const resourceId = inferToolResourceId(args, options);
    const targetProvider = inferToolTargetProvider(args);
    const requestedEgress = inferRequestedEgress(args);
    return {
      ...args,
      operationId: firstNonEmpty(args.operationId, tool?.operationId, tool?.id),
      requestedAction: inferToolRequestedAction(toolName, args, tool),
      resourceType,
      resourceId,
      targetProvider,
      requestedEgress
    };
  }

  function buildDeniedAuthorizationDecision({
    toolName,
    toolExecutionId = "",
    traceId = "",
    reasonCode = "authorization_denied",
    redactedReason = "Tool call is not authorized.",
    effect = "deny"
  } = {}) {
    return {
      protocolVersion: "pact.authorization.v1",
      decisionId: `authz_decision_${crypto.randomUUID()}`,
      auditId: `authz_audit_${crypto.randomUUID()}`,
      toolExecutionId,
      traceId,
      toolId: `agent-exploration.${normalizeToolName(toolName)}`,
      effect,
      allowed: false,
      reasonCode,
      redactedReason,
      deniedLayer: "tool",
      requiredApproval: null,
      missingScopes: [],
      missingToolsets: [],
      evaluatedLayers: ["agent_exploration_runtime", "tool_catalog_policy"],
      createdAt: nowIso()
    };
  }

  async function evaluateToolAuthorization({
    toolName,
    args = {},
    options = {},
    traceId = "",
    toolExecutionId = "",
    preflight = false
  } = {}) {
    const normalizedToolName = normalizeToolName(toolName);
    const tool = catalogToolForAgentExplorationTool(normalizedToolName);
    if (!tool) {
      const decision = buildDeniedAuthorizationDecision({
        toolName: normalizedToolName,
        toolExecutionId,
        traceId,
        reasonCode: "unknown_tool",
        redactedReason: "Tool is not registered in the unified tool catalog."
      });
      return { allowed: false, decision, tool: null, grant: null };
    }
    if (!securityPermissions || typeof securityPermissions.evaluatePolicy !== "function") {
      return { allowed: true, decision: null, tool, grant: null };
    }
    const requestedGrantId = firstNonEmpty(args.toolGrantId, options.toolGrantId, options.grantId);
    const grant = loadToolGrant(requestedGrantId);
    const { subject, agentId, boundUserId } = buildAuthorizationIdentity(options, grant);
    const authorizationInput = buildAuthorizationInput(normalizedToolName, args, options, tool);
    const grantRequired = toolRequiresManagedGrant(normalizedToolName, args, tool) || Boolean(requestedGrantId);
    try {
      const decision = await securityPermissions.evaluatePolicy({
        tool,
        grant,
        subject,
        authSession: options.authSession || null,
        input: authorizationInput,
        context: {
          surface: "agent-exploration-runtime",
          toolExpected: true,
          preflight,
          agentId,
          agentProfileId: agentId,
          profileId: agentId,
          boundUserId,
          userId: boundUserId,
          teamIds: uniqueStrings([
            ...asArray(options.teamIds),
            ...asArray(options.workspaceContext?.teamIds),
            ...asArray(grant?.metadata?.teamIds)
          ]),
          workspaceId: options.workspaceId || "",
          toolGrantId: requestedGrantId,
          resourceType: authorizationInput.resourceType,
          resourceId: authorizationInput.resourceId,
          repoId: authorizationInput.repoId,
          targetProvider: authorizationInput.targetProvider,
          requestedAction: authorizationInput.requestedAction,
          requestedEgress: authorizationInput.requestedEgress
        },
        dryRun: preflight,
        traceId,
        toolExecutionId,
        grantRequired,
        governanceRequired: true,
        enforceConfirmation: false
      });
      return {
        allowed: decision?.allowed === true,
        decision,
        tool,
        grant
      };
    } catch (error) {
      const decision = buildDeniedAuthorizationDecision({
        toolName: normalizedToolName,
        toolExecutionId,
        traceId,
        reasonCode: "authorization_evaluation_failed",
        redactedReason: error instanceof Error ? error.message : "Authorization evaluation failed."
      });
      return { allowed: false, decision, tool, grant };
    }
  }

  function deniedToolExecution(name, args = {}, decision = null) {
    const needsApproval = decision?.effect === "needsApproval";
    return {
      tool: name,
      arguments: args,
      result: {
        ok: false,
        error: needsApproval ? "authorization_needs_approval" : "authorization_denied",
        reasonCode: decision?.reasonCode || "authorization_denied",
        deniedLayer: decision?.deniedLayer || "tool",
        requiredApproval: decision?.requiredApproval || null,
        decisionId: decision?.decisionId || "",
        auditId: decision?.auditId || "",
        missingScopes: decision?.missingScopes || [],
        missingToolsets: decision?.missingToolsets || []
      }
    };
  }

  async function authorizedToolDefinitions(options = {}) {
    const definitions = toolDefinitions();
    if (!securityPermissions || typeof securityPermissions.evaluatePolicy !== "function") {
      return definitions;
    }
    const output = [];
    for (const definition of definitions) {
      const toolName = normalizeToolName(definition.function?.name);
      const authorization = await evaluateToolAuthorization({
        toolName,
        args: {},
        options,
        traceId: options.traceId || "",
        toolExecutionId: "",
        preflight: true
      });
      if (authorization.allowed) {
        output.push(definition);
      }
    }
    return output;
  }

  function appendToolManagementToolExecution({
    toolExecutionId,
    traceId,
    tool,
    input,
    result,
    status,
    errorCode,
    durationMs,
    authorizationDecision = null,
    toolDefinition = null,
    grant = null
  }) {
    if (!userDataPath) {
      return;
    }
    const store = createToolManagementStore({ userDataPath });
    const decisionEffect = authorizationDecision?.effect || (status === "ok" ? "allow" : "deny");
    const executionDecision = ["allow", "dry_run_only"].includes(decisionEffect)
      ? "allow"
      : decisionEffect === "needsApproval"
        ? "needsApproval"
        : "deny";
    const normalizedToolName = normalizeToolName(tool);
    const fallbackRisk = ["knowledge_skill_propose", "golden_rule_authoring", "http_request"].includes(normalizedToolName)
      ? "safe_write"
      : normalizedToolName === "local_command"
        ? "repair_write"
        : "read_only";
    try {
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: toolDefinition?.id || `agent-exploration.${normalizedToolName}`,
        toolVersion: toolDefinition?.version || AGENT_EXPLORATION_PROTOCOL_VERSION,
        toolsetIds: toolDefinition?.toolsets || ["pact.knowledge.read"],
        subjectType: authorizationDecision?.subject?.type || "agent-profile",
        subjectId: authorizationDecision?.subject?.subjectId || EXPLORER_AGENT_ID,
        grantId: authorizationDecision?.grantId || grant?.id || "",
        agentId: authorizationDecision?.subject?.agentProfileId || EXPLORER_AGENT_ID,
        profileId: authorizationDecision?.subject?.agentProfileId || "agent-exploration",
        operationId: toolDefinition?.operationId || authorizationDecision?.operationId || "",
        risk: toolDefinition?.risk || fallbackRisk,
        decision: executionDecision,
        input,
        result,
        status,
        errorCode,
        durationMs,
        policyDecisionId: authorizationDecision?.decisionId || "",
        startedAt: new Date(Date.now() - durationMs).toISOString(),
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: toolDefinition?.id || `agent-exploration.${normalizedToolName}`,
        profileId: authorizationDecision?.subject?.agentProfileId || "agent-exploration",
        status,
        risk: toolDefinition?.risk || fallbackRisk,
        durationMs,
        reasonCode: authorizationDecision?.reasonCode || errorCode || ""
      });
    } finally {
      store.close();
    }
  }

  async function executeKeywordSearch(args = {}, { limit: defaultLimit = 8, sourceIds = [] } = {}) {
    const knowledgeCore = getKnowledgeCore(runtime);
    if (!knowledgeCore || typeof knowledgeCore.search !== "function") {
      return {
        ok: false,
        error: "knowledge_core_unavailable"
      };
    }
    const query = normalizeText(args.query || args.q || "");
    if (!query) {
      return {
        ok: false,
        error: "query_required"
      };
    }
    const limit = Math.max(1, Math.min(Number(args.limit || defaultLimit), 20));
    const retrievalMode = normalizeText(args.retrievalMode || args.mode || "hybrid").toLowerCase();
    const keywordOnly =
      args.keywordOnly === true ||
      retrievalMode === "keyword" ||
      retrievalMode === "lexical";
    const result = await knowledgeCore.search({
      query,
      limit,
      batchId: args.batchId || "",
      retrievalMode: keywordOnly ? "keyword" : "hybrid",
      keywordOnly,
      learningEnabled: keywordOnly ? false : args.learningEnabled !== false,
      clientId: normalizeText(args.clientId || "agent-exploration"),
      requestSurface: "agent-exploration",
      responseProfile: "agent",
      machineReadable: true,
      agentMessage: true,
      explain: true,
      modalityPolicy: "multimodal",
      scopeSourceIds: uniqueStrings([
        ...asArray(args.scopeSourceIds || args.sourceIds),
        ...asArray(sourceIds)
      ])
    });
    return {
      ok: true,
      query,
      retrievalMode: result.retrievalMode || (keywordOnly ? "keyword" : "hybrid"),
      count: asArray(result.items || result.results).length,
      hierarchy: result.hierarchy || null,
      queryIntent: result.queryIntent || null,
      items: compactSearchItems(result, limit),
      agentMessage: result.agentMessage || null,
      explain: {
        candidateCount: result.explain?.candidateCount,
        generatedCandidateCount: result.explain?.generatedCandidateCount,
        dedupedCandidateCount: result.explain?.dedupedCandidateCount,
        hierarchyCandidateCount: result.explain?.hierarchyCandidateCount,
        retrievalProfileId: result.retrievalProfileId || "",
        retrievalProfileKey: result.retrievalProfileKey || "",
        routedBy: result.profileRoute?.routedBy || ""
      }
    };
  }

  async function executeKnowledgeSkillSearch(args = {}) {
    if (!knowledgeSkillRuntime || typeof knowledgeSkillRuntime.searchSkills !== "function") {
      return {
        ok: false,
        error: "knowledge_skill_runtime_unavailable"
      };
    }
    const query = normalizeText(args.query || args.q || "");
    if (!query) {
      return {
        ok: false,
        error: "query_required"
      };
    }
    const limit = Math.max(1, Math.min(Number(args.limit || 3), 10));
    const result = knowledgeSkillRuntime.searchSkills({
      query,
      limit,
      status: args.status || "published"
    });
    return {
      ok: true,
      query,
      count: asArray(result.items).length,
      skills: asArray(result.items).map((skill) => ({
        skillId: skill.skillId,
        title: skill.title,
        summary: skill.summary,
        matchScore: skill.matchScore,
        applicability: skill.skill?.applicability || {},
        coreConcepts: asArray(skill.skill?.coreConcepts).slice(0, 8),
        decisionHeuristics: asArray(skill.skill?.decisionHeuristics).slice(0, 8),
        antiPatterns: asArray(skill.skill?.antiPatterns).slice(0, 6),
        honestBoundaries: asArray(skill.skill?.honestBoundaries).slice(0, 6),
        evidenceRefs: asArray(skill.evidenceRefs).slice(0, 10),
        qualityScore: Number(skill.qualityReport?.score || 0)
      }))
    };
  }

  async function executeKnowledgeSkillPropose(args = {}, options = {}) {
    if (!knowledgeSkillRuntime || typeof knowledgeSkillRuntime.proposeSkill !== "function") {
      return {
        ok: false,
        error: "knowledge_skill_runtime_unavailable"
      };
    }
    const evidenceRefs = [
      ...new Set(
        asArray(args.evidenceRefs)
          .map((item) => normalizeText(item))
          .filter(Boolean)
      )
    ];
    if (!evidenceRefs.length) {
      return {
        ok: false,
        error: "evidence_refs_required"
      };
    }
    const result = await knowledgeSkillRuntime.proposeSkill({
      query: args.sourceQuery || args.query || options.query || "",
      sourceType: "agent_exploration",
      agentId: EXPLORER_AGENT_ID,
      runId: options.runId || "",
      proposal: {
        ...args,
        sourceQuery: args.sourceQuery || args.query || options.query || "",
        evidenceRefs
      },
      evidenceRefs,
      status: "pending_review",
      publish: false,
      confidence: args.confidence,
      reuseReason: args.reuseReason || ""
    });
    return {
      ok: result.ok !== false,
      skillId: result.skill?.skillId || "",
      status: result.skill?.status || "",
      title: result.skill?.title || "",
      summary: result.skill?.summary || "",
      evidenceRefs: asArray(result.skill?.evidenceRefs),
      qualityReport: result.qualityReport,
      statusReason: result.statusReason
    };
  }

  async function executeGoldenRuleAuthoring(args = {}, options = {}) {
    if (!knowledgeRuleAuthoringRuntime || typeof knowledgeRuleAuthoringRuntime.chat !== "function") {
      return {
        ok: false,
        error: "knowledge_rule_authoring_runtime_unavailable"
      };
    }
    const message = normalizeText(args.message || args.query || options.query || "");
    if (!message) {
      return {
        ok: false,
        error: "message_required"
      };
    }
    const result = await knowledgeRuleAuthoringRuntime.chat({
      message,
      modelAlias: options.modelAlias || args.modelAlias || "",
      modelEnabled: args.modelEnabled === true
    });
    return {
      ok: result.ok !== false,
      status: result.status || "",
      runId: result.runId || "",
      intent: result.intent || null,
      template: result.template || null,
      gate: result.gate || null,
      confirmation: result.confirmation || null,
      package: result.package
        ? {
            packageId: result.package.packageId || "",
            version: result.package.version || 0,
            status: result.package.status || "",
            rules: asArray(result.package.rules).slice(0, 5)
          }
        : null,
      humanConfirmationRequired: result.humanConfirmationRequired === true
    };
  }

  async function executeKnowledgeAggregate(args = {}, { sourceIds = [] } = {}) {
    const knowledgeCore = getKnowledgeCore(runtime);
    if (!knowledgeCore || typeof knowledgeCore.aggregate !== "function") {
      return {
        ok: false,
        error: "knowledge_aggregate_unavailable"
      };
    }
    const metric = normalizeText(args.metric || "email_advertising_by_sender");
    const groupBy = normalizeText(args.groupBy || args.group_by || "senderEmail") || "senderEmail";
    const limit = Math.max(1, Math.min(Number(args.limit || 10), 50));
    const result = await knowledgeCore.aggregate({
      metric,
      groupBy,
      query: args.query || args.q || "",
      batchId: args.batchId || "",
      limit,
      documentType: args.documentType || "email",
      classification: args.classification || (metric === "email_advertising_by_sender" ? "advertising" : ""),
      categoryId: args.categoryId || args.category_id || "",
      categoryPath: args.categoryPath || args.category_path || "",
      scopeSourceIds: uniqueStrings([
        ...asArray(args.scopeSourceIds || args.sourceIds),
        ...asArray(sourceIds)
      ])
    });
    return {
      ok: result?.ok !== false,
      metric: result?.metric || metric,
      groupBy: result?.groupBy || groupBy,
      filters: result?.filters || {},
      scannedDocumentCount: Number(result?.scannedDocumentCount || 0),
      matchedDocumentCount: Number(result?.matchedDocumentCount || 0),
      topGroup: result?.topGroup || null,
      groups: asArray(result?.groups).slice(0, limit).map((group) => ({
        key: group.key,
        label: group.label || group.key,
        count: Number(group.count || 0),
        evidenceRefs: asArray(group.evidenceRefs).slice(0, 8),
        examples: asArray(group.examples).slice(0, 5)
      })),
      methodology: truncateText(result?.methodology || "", 1200)
    };
  }

  async function executeOpenEvidence(args = {}) {
    const knowledgeCore = getKnowledgeCore(runtime);
    if (!knowledgeCore || typeof knowledgeCore.getEvidence !== "function") {
      return {
        ok: false,
        error: "knowledge_core_unavailable"
      };
    }
    const evidenceId = normalizeText(args.evidenceId || args.id || "");
    if (!evidenceId) {
      return {
        ok: false,
        error: "evidence_id_required"
      };
    }
    const evidence = await knowledgeCore.getEvidence({ evidenceId });
    if (!evidence) {
      return {
        ok: false,
        error: "evidence_not_found",
        evidenceId
      };
    }
    return {
      ok: true,
      evidence: compactEvidence(evidence)
    };
  }

  async function executeHttpRequest(args = {}, toolExecution = {}) {
    const config = asObject(toolExecution.http);
    if (config.enabled === false) {
      return { ok: false, error: "http_tools_disabled" };
    }
    const method = normalizeText(args.method || "GET").toUpperCase();
    const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
    if (!allowedMethods.has(method)) {
      return { ok: false, error: "http_method_not_allowed", method };
    }
    let url;
    try {
      url = appendQuery(args.url, args.query);
    } catch {
      return { ok: false, error: "invalid_url" };
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      return { ok: false, error: "unsupported_protocol", protocol: url.protocol };
    }
    if (!hostAllowed(url.hostname, config.allowedHosts || [])) {
      return {
        ok: false,
        error: "http_host_not_allowed",
        host: url.hostname,
        allowedHosts: config.allowedHosts || []
      };
    }
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Math.min(Number(args.timeoutMs || config.timeoutMs || 30000), 120000));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const hasBody = !["GET", "HEAD"].includes(method) && args.body !== undefined;
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...asObject(args.headers)
        },
        body: hasBody
          ? typeof args.body === "string"
            ? args.body
            : JSON.stringify(args.body)
          : undefined,
        signal: controller.signal
      });
      const raw = await response.text().catch(() => "");
      const maxBytes = Number(config.maxResponseBytes || 65536);
      return {
        ok: response.ok,
        method,
        url: `${url.origin}${url.pathname}${url.search}`,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        body: limitTextBytes(raw, maxBytes),
        json: safeJsonParse(raw, null)
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function executeLocalCommand(args = {}, toolExecution = {}) {
    const config = asObject(toolExecution.local);
    if (config.enabled === false) {
      return { ok: false, error: "local_tools_disabled" };
    }
    const commands = asArray(config.commands);
    const commandId = normalizeText(args.commandId || args.id || "");
    const template = commandId
      ? commands.find((item) => normalizeText(item.commandId || item.id) === commandId)
      : null;
    if (commandId && !template) {
      return { ok: false, error: "local_command_not_registered", commandId };
    }
    if (!template) {
      return {
        ok: false,
        error: "local_command_template_required",
        reasonCode: "permission_governed_template_required"
      };
    }
    const resolvedTemplate = template ? resolveLocalCommandTemplate(template, args) : null;
    if (resolvedTemplate?.ok === false) {
      return resolvedTemplate;
    }
    const command = normalizeText(resolvedTemplate?.command || args.command || "");
    if (!command) {
      return { ok: false, error: "local_command_required" };
    }
    const baseArgs = asArray(resolvedTemplate?.args).map((item) => String(item));
    const incomingArgs = asArray(args.args).map((item) => String(item));
    const allowExtraArgs = template ? resolvedTemplate.allowExtraArgs === true : true;
    if (template && incomingArgs.length > 0 && !allowExtraArgs) {
      return {
        ok: false,
        error: "local_command_extra_args_not_allowed",
        commandId,
        allowedVariables: resolvedTemplate.allowedVariables || []
      };
    }
    const finalArgs = template ? [...baseArgs, ...(allowExtraArgs ? incomingArgs : [])] : incomingArgs;
    const cwd = normalizeText(args.cwd || resolvedTemplate?.cwd || "") || process.cwd();
    const stdin = args.stdin === undefined && resolvedTemplate?.stdin !== undefined
      ? resolvedTemplate.stdin
      : args.stdin;
    const timeoutMs = Math.max(1000, Math.min(Number(args.timeoutMs || config.timeoutMs || 30000), 120000));
    const maxBytes = Number(config.maxOutputBytes || 65536);
    return new Promise((resolve) => {
      const child = spawn(command, finalArgs, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout = limitTextBytes(stdout + chunk.toString("utf8"), maxBytes);
      });
      child.stderr.on("data", (chunk) => {
        stderr = limitTextBytes(stderr + chunk.toString("utf8"), maxBytes);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message, commandId, command, args: finalArgs });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          commandId,
          command,
          args: finalArgs,
          cwd,
          exitCode: code,
          signal,
          stdout: limitTextBytes(stdout, maxBytes),
          stderr: limitTextBytes(stderr, maxBytes)
        });
      });
      if (stdin) {
        child.stdin.write(String(stdin));
      }
      child.stdin.end();
    });
  }

  async function runAgentExplorationTool(name, args, options = {}) {
    if (name === "knowledge_skill_search") {
      return {
        tool: name,
        arguments: args,
        result: await executeKnowledgeSkillSearch(args)
      };
    }
    if (name === "knowledge_skill_propose") {
      return {
        tool: name,
        arguments: args,
        result: await executeKnowledgeSkillPropose(args, options)
      };
    }
    if (name === "golden_rule_authoring") {
      return {
        tool: name,
        arguments: args,
        result: await executeGoldenRuleAuthoring(args, options)
      };
    }
    if (name === "keyword_search") {
      return {
        tool: name,
        arguments: args,
        result: await executeKeywordSearch(args, options)
      };
    }
    if (name === "knowledge_aggregate") {
      return {
        tool: name,
        arguments: args,
        result: await executeKnowledgeAggregate(args, options)
      };
    }
    if (name === "open_evidence") {
      if (options.keywordSearchAlreadyRun === false && options.aggregateAlreadyRun === false) {
        return {
          tool: name,
          arguments: args,
          result: {
            ok: false,
            error: "search_or_aggregate_required_first"
          }
        };
      }
      return {
        tool: name,
        arguments: args,
        result: await executeOpenEvidence(args)
      };
    }
    if (name === "http_request") {
      return {
        tool: name,
        arguments: args,
        result: await executeHttpRequest(args, options.toolExecution)
      };
    }
    if (name === "local_command") {
      return {
        tool: name,
        arguments: args,
        result: await executeLocalCommand(args, options.toolExecution)
      };
    }
    return {
      tool: name,
      arguments: args,
      result: {
        ok: false,
        error: "tool_not_allowed"
      }
    };
  }

  async function executeToolCall(toolCall, options = {}) {
    const name = normalizeToolName(toolCall.name || toolCall.function?.name);
    const args = asObject(toolCall.arguments || safeJsonParse(toolCall.function?.arguments, {}));
    const startedAtMs = Date.now();
    const traceId = options.traceId || `trace_${crypto.randomUUID()}`;
    const toolExecutionId = `tool_exec_${crypto.randomUUID()}`;
    try {
      const authorization = await evaluateToolAuthorization({
        toolName: name,
        args,
        options,
        traceId,
        toolExecutionId,
        preflight: false
      });
      if (!authorization.allowed) {
        const denied = deniedToolExecution(name, args, authorization.decision);
        appendToolManagementToolExecution({
          toolExecutionId,
          traceId,
          tool: name,
          input: args,
          result: denied.result,
          status: "denied",
          errorCode: denied.result.error,
          durationMs: Date.now() - startedAtMs,
          authorizationDecision: authorization.decision,
          toolDefinition: authorization.tool,
          grant: authorization.grant
        });
        return {
          ...denied,
          toolExecutionId,
          traceId,
          authorizationDecision: authorization.decision
        };
      }
      const executed = await runAgentExplorationTool(name, args, options);
      const status = executed?.result?.ok === false ? "failed" : "ok";
      const errorCode = status === "ok" ? "" : String(executed?.result?.error || "agent_exploration_tool_failed");
      appendToolManagementToolExecution({
        toolExecutionId,
        traceId,
        tool: name,
        input: args,
        result: executed?.result,
        status,
        errorCode,
        durationMs: Date.now() - startedAtMs,
        authorizationDecision: authorization.decision,
        toolDefinition: authorization.tool,
        grant: authorization.grant
      });
      return {
        ...executed,
        toolExecutionId,
        traceId,
        authorizationDecision: authorization.decision
      };
    } catch (error) {
      appendToolManagementToolExecution({
        toolExecutionId,
        traceId,
        tool: name,
        input: args,
        result: {},
        status: "failed",
        errorCode: "agent_exploration_tool_exception",
        durationMs: Date.now() - startedAtMs
      });
      throw error;
    }
  }

  function describe() {
    return {
      protocolVersion: AGENT_EXPLORATION_PROTOCOL_VERSION,
      name: "pact.knowledge.agent-exploration",
      purpose:
        "Let a stateless model use native JSON function calls to iteratively operate local knowledge recall tools.",
      modelInterface: "OpenAI-compatible chat/completions tools/function_call",
      defaultAgentId: EXPLORER_AGENT_ID,
      toolPolicy: {
        allowedTools: [
          "knowledge_skill_search",
          "knowledge_aggregate",
          "keyword_search",
          "open_evidence",
          "knowledge_skill_propose",
          "golden_rule_authoring"
        ],
        searchOrAggregateFirst: true,
        keywordSearchFirst: false,
        skillGuidanceFirst: true,
        agentSkillCreationAllowed: true,
        goldenRuleDraftCreationAllowed: true,
        canonicalWritesAllowed: false,
        rawEvidenceRewriteAllowed: false,
        memory: "AgentWorkspace private state + ContextRuntime ContextPack"
      },
      tools: toolDefinitions()
    };
  }

  async function run(input = {}) {
    if (!agentGatewayCall || typeof agentGatewayCall !== "function") {
      throw new Error("AgentExplorationRuntime requires agentGatewayCall.");
    }
    if (!agentWorkspace) {
      throw new Error("AgentExplorationRuntime requires AgentWorkspace.");
    }
    if (!contextRuntime) {
      throw new Error("AgentExplorationRuntime requires ContextRuntime.");
    }
    const callerInput = asObject(input);
    const allocationResult = typeof clientRuntimeAllocator?.apply === "function"
      ? await clientRuntimeAllocator.apply(callerInput, {
          taskType: callerInput.taskType || "knowledge.agent_exploration",
          surface: "agent-exploration-runtime"
        })
      : null;
    input = allocationResult?.input ? asObject(allocationResult.input) : callerInput;
    const query = normalizeText(input.query || input.question || input.q || "");
    if (!query) {
      throw new Error("智能探索缺少 query。");
    }

    let explorationDefaults = DEFAULT_EXPLORATION_PROMPT;
    let toolExecution = {};
    try {
      const settings = userDataPath ? await loadSettings(userDataPath) : {};
      explorationDefaults = {
        ...DEFAULT_EXPLORATION_PROMPT,
        ...asObject(settings.agentExploreDefaults)
      };
      toolExecution = asObject(settings.agentToolExecution);
    } catch {
      explorationDefaults = DEFAULT_EXPLORATION_PROMPT;
    }
    const maxIterations = Math.max(
      1,
      Math.min(Number(input.maxIterations || explorationDefaults.maxIterations || DEFAULT_MAX_ITERATIONS), 8)
    );
    const perSearchLimit = Math.max(1, Math.min(Number(input.limit || explorationDefaults.limit || 8), 20));
    const thinkingParameters = thinkingParametersForMode(input.thinkingMode || explorationDefaults.thinkingMode);
    const timestamp = nowIso();
    const workspaceId =
      normalizeText(input.workspaceId || "") ||
      stableId("workspace", "knowledge-agent-explore", query, timestamp);
    const workspaceResult = agentWorkspace.getWorkspace({ workspaceId, includePrivate: true }) ||
      agentWorkspace.createWorkspace({
        workspaceId,
        title: `智能探索：${query.slice(0, 42)}`,
        objective: query,
        metadata: {
          protocolVersion: AGENT_EXPLORATION_PROTOCOL_VERSION,
          createdBy: "knowledge.agent-explore",
          clientRuntimeAllocation: allocationResult?.allocation || input.clientRuntimeAllocation || null
        }
      });
    const workspace = workspaceResult.workspace || workspaceResult;
    const workspaceContext = typeof agentWorkspace.getWorkspaceContext === "function"
      ? agentWorkspace.getWorkspaceContext(workspaceId) || null
      : null;
    const callerSelectedWorkspace = Boolean(normalizeText(callerInput.workspaceId || ""));
    const explicitSourceIds = uniqueStrings([
      ...asArray(callerInput.scopeSourceIds),
      ...asArray(callerInput.sourceIds)
    ]);
    const allocatedSourceIds = uniqueStrings([
      ...asArray(input.scopeSourceIds),
      ...asArray(input.sourceIds)
    ]);
    const workspaceSourceIds = uniqueStrings(workspaceContext?.knowledgeSourceIds || []);
    const effectiveSourceIds = explicitSourceIds.length
      ? explicitSourceIds
      : callerSelectedWorkspace
        ? workspaceSourceIds.length ? workspaceSourceIds : allocatedSourceIds
        : allocatedSourceIds.length ? allocatedSourceIds : workspaceSourceIds;
    const explicitModelAlias = normalizeText(callerInput.modelAlias || callerInput.alias || "");
    const allocatedModelAlias = normalizeText(input.modelAlias || input.alias || "");
    const workspaceModelAlias = normalizeText(workspaceContext?.modelAlias || "");
    const effectiveModelAlias = explicitModelAlias ||
      (callerSelectedWorkspace ? workspaceModelAlias || allocatedModelAlias : allocatedModelAlias || workspaceModelAlias);
    const explicitContextProfileId = normalizeText(callerInput.contextProfileId || callerInput.profileId || "");
    const allocatedContextProfileId = normalizeText(input.contextProfileId || input.profileId || "");
    const workspaceContextProfileId = normalizeText(workspaceContext?.contextProfileId || "");
    const effectiveContextProfileId = normalizeText(
      explicitContextProfileId ||
        (callerSelectedWorkspace
          ? workspaceContextProfileId || allocatedContextProfileId
          : allocatedContextProfileId || workspaceContextProfileId) ||
        explorationDefaults.contextProfileId ||
        effectiveModelAlias ||
        ""
    );
    const explicitToolGrantId = normalizeText(callerInput.toolGrantId || callerInput.grantId || "");
    const allocatedToolGrantId = normalizeText(input.toolGrantId || input.grantId || "");
    const workspaceToolGrantId = normalizeText(workspaceContext?.toolGrantId || "");
    const effectiveToolGrantId = normalizeText(
      explicitToolGrantId ||
        (callerSelectedWorkspace ? workspaceToolGrantId || allocatedToolGrantId : allocatedToolGrantId || workspaceToolGrantId) ||
        ""
    );
    const effectiveAuthSession = input.authSession || callerInput.authSession || null;
    const effectiveAgentId = firstNonEmpty(
      callerInput.agentId,
      callerInput.agentProfileId,
      input.agentId,
      input.agentProfileId,
      EXPLORER_AGENT_ID
    );
    const effectiveBoundUserId = firstNonEmpty(
      callerInput.boundUserId,
      callerInput.userId,
      input.boundUserId,
      input.userId,
      effectiveAuthSession?.user?.userId,
      effectiveAuthSession?.user?.username
    );
    const effectiveTeamIds = uniqueStrings([
      ...asArray(callerInput.teamIds),
      ...asArray(input.teamIds),
      ...asArray(workspaceContext?.teamIds),
      ...asArray(effectiveAuthSession?.user?.teamIds)
    ]);
    const authorizationOptions = {
      authSession: effectiveAuthSession,
      agentId: effectiveAgentId,
      agentProfileId: effectiveAgentId,
      boundUserId: effectiveBoundUserId,
      userId: effectiveBoundUserId,
      teamIds: effectiveTeamIds,
      workspaceId,
      toolGrantId: effectiveToolGrantId,
      workspaceContext
    };
    const runResult = agentWorkspace.createRun({
      workspaceId,
      runType: "knowledge_agent_exploration",
      status: "running",
      input: {
        query,
        modelAlias: effectiveModelAlias,
        contextProfileId: effectiveContextProfileId,
        toolGrantId: effectiveToolGrantId,
        workspaceContext,
        scopeSourceIds: effectiveSourceIds,
        clientRuntimeAllocation: allocationResult?.allocation || input.clientRuntimeAllocation || null,
        thinkingMode: normalizeThinkingMode(input.thinkingMode || explorationDefaults.thinkingMode),
        maxIterations,
        limit: perSearchLimit
      },
      startedAt: timestamp
    });
    const runId = runResult.run.runId;
    await appendAuditLog({
      event: "run_started",
      runId,
      workspaceId,
      query,
      modelAlias: effectiveModelAlias,
      contextProfileId: effectiveContextProfileId,
      toolGrantId: effectiveToolGrantId,
      workspaceContext,
      maxIterations,
      limit: perSearchLimit
    });
    const steps = [];
    const messages = [];
    const toolResults = [];
    const recentTurns = asArray(input.recentTurns || input.history).slice(-12);
    let finalAnswer = "";
    let degraded = false;
    let contextPack = null;
    let knowledgeSkillContext = null;
    if (knowledgeSkillRuntime && typeof knowledgeSkillRuntime.buildContextForQuery === "function") {
      knowledgeSkillContext = knowledgeSkillRuntime.buildContextForQuery({
        query,
        limit: Number(input.skillLimit || 3),
        status: "published"
      });
    }

    const snapshotSteps = () => JSON.parse(JSON.stringify(steps));
    const snapshotToolResults = () => JSON.parse(JSON.stringify(compactToolResultsForStorage(toolResults)));
    const buildCoverage = (patch = {}) => ({
      answer: finalAnswer,
      evidenceRefs: asArray(patch.evidenceRefs),
      toolResults: snapshotToolResults(),
      contextPack: compactContextPackForStorage(contextPack),
      knowledgeSkillContext,
      contextProfileId: contextPack?.profileId || "",
      ...patch
    });
    const persistProgress = (patch = {}) => {
      agentWorkspace.updateRun(runId, {
        status: "running",
        steps: snapshotSteps(),
        coverage: buildCoverage(patch.coverage || {}),
        degraded,
        ...patch
      });
    };
    const currentRun = () => agentWorkspace.getRun(runId) || runResult.run;

    const buildResponse = ({
      ok = true,
      run = currentRun(),
      answer = finalAnswer,
      evidenceRefs = [],
      error = "",
      pending = false
    } = {}) => ({
      protocolVersion: AGENT_EXPLORATION_PROTOCOL_VERSION,
      ok,
      pending,
      workspace,
      run,
      answer: answer || run?.coverage?.answer || "",
      evidenceRefs: evidenceRefs.length ? evidenceRefs : asArray(run?.coverage?.evidenceRefs),
      toolResults: toolResults.length ? toolResults : asArray(run?.coverage?.toolResults),
      knowledgeSkillContext: knowledgeSkillContext || run?.coverage?.knowledgeSkillContext || null,
      contextPack: contextPack || run?.coverage?.contextPack || null,
      clientRuntimeAllocation: allocationResult?.allocation || input.clientRuntimeAllocation || null,
      workspaceContext,
      degraded: run?.degraded === true || degraded,
      steps: asArray(run?.steps),
      error: error || run?.error || ""
    });

    const synthesizeFinalAnswer = async () => {
      if (finalAnswer || !toolResults.length) {
        return false;
      }
      const synthesisIteration = maxIterations + 1;
      const step = {
        iteration: synthesisIteration,
        status: "model_calling",
        phase: "final_synthesis",
        contextBudget: contextPack?.budgetReport || null,
        model: null,
        functionCallSource: "",
        toolCalls: [],
        toolResults: [],
        events: [
          {
            type: "final_synthesis",
            status: "running",
            label: "工具循环结束，正在强制综合最终答案",
            createdAt: nowIso()
          }
        ]
      };
      steps.push(step);
      persistProgress({
        coverage: {
          activeIteration: synthesisIteration,
          activePhase: "final_synthesis",
          finalSynthesis: true
        }
      });
      try {
        const synthesisTools = await authorizedToolDefinitions({
          ...authorizationOptions,
          traceId: `trace_${runId}_final_synthesis`
        });
        const synthesisResult = await agentGatewayCall({
          alias: effectiveModelAlias,
          modelAlias: effectiveModelAlias,
          contextProfileId: effectiveContextProfileId,
          toolGrantId: effectiveToolGrantId,
          clientUid: input.clientUid || "",
          clientRuntimeAllocation: input.clientRuntimeAllocation || allocationResult?.allocation || null,
          moduleId: input.moduleId || "agentTools",
          taskId: runId,
          workspaceId,
          workspaceContext,
          sessionId: workspaceId,
          question: query,
          messages: [
            {
              role: "system",
              content: [
                buildSystemMemory({
                  query,
                  contextPack: contextPack || {},
                  toolPolicy: describe().toolPolicy,
                  config: explorationDefaults
                }),
                "Final synthesis mode: do not call any tool. Use only the local tool results already present in the conversation.",
                "If evidence is insufficient, say so clearly and cite the closest evidence ids. Do not return tool calls."
              ].join("\n\n")
            },
            ...messages,
            {
              role: "user",
              content:
                "请停止调用工具，基于上面的本地工具结果直接输出最终中文回答。必须引用 evidenceId；不要再返回 function call。"
            }
          ],
          parameters: {
            temperature: Number(input.temperature ?? explorationDefaults.temperature ?? 0.2),
            max_tokens: Number(input.maxTokens || explorationDefaults.maxTokens || 1800),
            stream: false,
            tools: synthesisTools,
            tool_choice: "none"
          }
        });
        const extracted = extractToolCalls(synthesisResult);
        step.model = compactAgentResponse(synthesisResult);
        step.functionCallSource = extracted.source;
        await appendAuditLog({
          event: "final_synthesis_response",
          runId,
          workspaceId,
          ok: synthesisResult.ok !== false,
          functionCallSource: extracted.source,
          toolCallCount: extracted.calls.length,
          answerLength: String(synthesisResult.answer || synthesisResult.text || "").length
        });
        if (extracted.calls.length) {
          degraded = true;
          step.status = "tool_selected";
          step.phase = "final_synthesis_rejected_tool_call";
          step.toolCalls = extracted.calls.slice(0, 3).map((call) => ({
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            status: "rejected",
            selectedAt: nowIso()
          }));
          step.events.push({
            type: "final_synthesis_rejected_tool_call",
            status: "failed",
            label: "最终综合阶段仍返回工具调用，已拒绝并进入兜底回答",
            toolCallIds: step.toolCalls.map((call) => call.id),
            createdAt: nowIso()
          });
          persistProgress({
            coverage: {
              activeIteration: synthesisIteration,
              activePhase: "final_synthesis_rejected_tool_call",
              finalSynthesis: true
            }
          });
          return false;
        }
        finalAnswer = String(synthesisResult.answer || synthesisResult.text || "").trim();
        if (!finalAnswer) {
          step.status = "empty";
          step.phase = "final_synthesis_empty";
          step.events.push({
            type: "final_synthesis_empty",
            status: "failed",
            label: "最终综合阶段没有返回可用答案，进入兜底回答",
            createdAt: nowIso()
          });
          persistProgress({
            coverage: {
              activeIteration: synthesisIteration,
              activePhase: "final_synthesis_empty",
              finalSynthesis: true
            }
          });
          return false;
        }
        step.status = "answer_ready";
        step.phase = "answer_ready";
        step.events.push({
          type: "answer_ready",
          status: "completed",
          label: "最终综合完成",
          createdAt: nowIso()
        });
        persistProgress({
          coverage: {
            activeIteration: synthesisIteration,
            activePhase: "answer_ready",
            finalSynthesis: true,
            answer: finalAnswer
          }
        });
        return true;
      } catch (error) {
        degraded = true;
        const message = error instanceof Error ? error.message : "final_synthesis_failed";
        step.status = "failed";
        step.phase = "final_synthesis_failed";
        step.events.push({
          type: "final_synthesis_failed",
          status: "failed",
          label: message,
          createdAt: nowIso()
        });
        await appendAuditLog({
          event: "final_synthesis_failed",
          runId,
          workspaceId,
          error: message
        });
        persistProgress({
          coverage: {
            activeIteration: synthesisIteration,
            activePhase: "final_synthesis_failed",
            finalSynthesis: true
          }
        });
        return false;
      }
    };

    const executeRun = async () => {
      try {
      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        const workspaceState = agentWorkspace.getWorkspace({
          workspaceId,
          includePrivate: true,
          includeRunDetails: false,
          runLimit: 8,
          submissionLimit: 120,
          artifactLimit: 30,
          issueLimit: 40,
          decisionLimit: 30,
          privateStateLimit: 8
        });
        const privateStates = asArray(workspaceState?.privateStates)
          .filter((state) => state.agentId === EXPLORER_AGENT_ID)
          .slice(0, 5);
        contextPack = await contextRuntime.assemble({
          contextProfileId: effectiveContextProfileId,
          modelAlias: effectiveModelAlias,
          clientUid: input.clientUid || "",
          clientRuntimeAllocation: input.clientRuntimeAllocation || allocationResult?.allocation || null,
          workspaceContext,
          knowledgeSourceIds: effectiveSourceIds,
          workspaceId,
          sessionId: workspaceId,
          inputSource: "knowledge-agent-exploration",
          roleId: "knowledge_explorer",
          agentId: EXPLORER_AGENT_ID,
          taskBrief: query,
          systemMemory:
            "Use tools to gather local evidence. Treat AgentWorkspace private state as memory only after ContextRuntime compresses it.",
          workspaceState,
          privateSummary: privateStates.map((state) => state.summary).join("\n"),
          recentTurns,
          expertGuidance: input.expertGuidance || input.humanFeedback || input.feedback || [],
          retrievedEvidence: evidenceItemsForContext(toolResults),
          toolState: {
            iteration,
            knowledgeSkillContext,
            previousToolResults: toolResults.map((entry) => ({
              tool: entry.tool,
              arguments: entry.arguments,
              ok: entry.result?.ok !== false,
              count: entry.result?.count,
              evidenceId: entry.result?.evidence?.evidenceId
            }))
          }
        });
        contextPack.knowledgeSkillContext = knowledgeSkillContext;
        const systemMessage = {
          role: "system",
          content: buildSystemMemory({
            query,
            contextPack,
            toolPolicy: describe().toolPolicy,
            config: explorationDefaults
          })
        };
        const userMessage = {
          role: "user",
          content:
            iteration === 1
              ? query
              : explorationDefaults.continuationPrompt
        };
        const callMessages = [systemMessage, ...messages, userMessage];
        const step = {
          iteration,
          status: "model_calling",
          phase: "model_calling",
          contextBudget: contextPack.budgetReport,
          model: null,
          functionCallSource: "",
          toolCalls: [],
          toolResults: [],
          events: [
            {
              type: "model_calling",
              status: "running",
              label: "模型正在选择工具",
              createdAt: nowIso()
            }
          ]
        };
        steps.push(step);
        persistProgress({
          coverage: {
            activeIteration: iteration,
            activePhase: "model_calling"
          }
        });
        const availableTools = await authorizedToolDefinitions({
          ...authorizationOptions,
          traceId: `trace_${runId}_${iteration}_tool_preflight`
        });
        const agentResult = await agentGatewayCall({
          alias: effectiveModelAlias,
          modelAlias: effectiveModelAlias,
          contextProfileId: effectiveContextProfileId,
          toolGrantId: effectiveToolGrantId,
          clientUid: input.clientUid || "",
          clientRuntimeAllocation: input.clientRuntimeAllocation || allocationResult?.allocation || null,
          moduleId: input.moduleId || "agentTools",
          taskId: runId,
          workspaceId,
          workspaceContext,
          sessionId: workspaceId,
          question: query,
          messages: callMessages,
          parameters: {
            ...thinkingParameters,
            temperature: Number(input.temperature ?? explorationDefaults.temperature ?? 0.2),
            max_tokens: Number(input.maxTokens || explorationDefaults.maxTokens || 1800),
            stream: false,
            tools: availableTools,
            tool_choice: input.toolChoice || explorationDefaults.toolChoice || "auto"
          }
        });
        const extracted = extractToolCalls(agentResult);
        const selectedCalls = extracted.calls.slice(0, 3);
        const reasoningContent = reasoningContentFromAgentResult(agentResult);
        step.status = selectedCalls.length ? "tool_selected" : "answer_ready";
        step.phase = step.status;
        step.model = compactAgentResponse(agentResult);
        step.functionCallSource = extracted.source;
        step.toolCalls = selectedCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          status: "selected",
          selectedAt: nowIso()
        }));
        step.events.push({
          type: selectedCalls.length ? "tool_selected" : "answer_ready",
          status: "completed",
          label: selectedCalls.length
            ? `模型选择工具：${selectedCalls.map((call) => call.name).join(", ")}`
            : "模型返回最终答案",
          toolCallIds: selectedCalls.map((call) => call.id),
          createdAt: nowIso()
        });
        await appendAuditLog({
          event: "model_response",
          runId,
          workspaceId,
          iteration,
          ok: agentResult.ok !== false,
          provider: agentResult.upstream?.provider || agentResult.upstream?.status || "",
          model: agentResult.upstream?.model || agentResult.request?.engine || "",
          functionCallSource: extracted.source,
          toolCallCount: selectedCalls.length,
          reasoningContentReturned: Boolean(reasoningContent),
          answerLength: String(agentResult.answer || agentResult.text || "").length
        });
        if (
          selectedCalls.length &&
          extracted.source !== "native_tool_calls" &&
          extracted.source !== "native_payload_tool_calls"
        ) {
          degraded = true;
        }
        if (!extracted.calls.length) {
          finalAnswer = String(agentResult.answer || agentResult.text || "").trim();
          persistProgress({
            coverage: {
              activeIteration: iteration,
              activePhase: "answer_ready",
              answer: finalAnswer
            }
          });
          break;
        }
        persistProgress({
          coverage: {
            activeIteration: iteration,
            activePhase: "tool_selected"
          }
        });

        messages.push(assistantToolCallMessage(selectedCalls, reasoningContent));
        for (const call of selectedCalls) {
          const toolResultEntry = {
            tool: call.name,
            arguments: call.arguments,
            status: "calling",
            startedAt: nowIso(),
            result: null
          };
          const callSummary = step.toolCalls.find((item) => item.id === call.id);
          if (callSummary) {
            callSummary.status = "calling";
            callSummary.startedAt = toolResultEntry.startedAt;
          }
          step.status = "tool_calling";
          step.phase = "tool_calling";
          step.toolResults.push(toolResultEntry);
          step.events.push({
            type: "tool_calling",
            status: "running",
            label: `正在调用工具：${call.name}`,
            toolCallId: call.id,
            tool: call.name,
            arguments: call.arguments,
            createdAt: toolResultEntry.startedAt
          });
          persistProgress({
            coverage: {
              activeIteration: iteration,
              activePhase: "tool_calling",
              activeTool: call.name
            }
          });
          const executed = await executeToolCall(call, {
            limit: perSearchLimit,
            sourceIds: effectiveSourceIds,
            query,
            runId,
            workspaceId,
            modelAlias: effectiveModelAlias,
            toolGrantId: effectiveToolGrantId,
            authSession: effectiveAuthSession,
            agentId: effectiveAgentId,
            agentProfileId: effectiveAgentId,
            boundUserId: effectiveBoundUserId,
            userId: effectiveBoundUserId,
            teamIds: effectiveTeamIds,
            workspaceContext,
            keywordSearchAlreadyRun: toolResults.some((entry) => entry.tool === "keyword_search"),
            aggregateAlreadyRun: toolResults.some((entry) => entry.tool === "knowledge_aggregate"),
            toolExecution
          });
          toolResultEntry.status = executed.result?.ok === false ? "failed" : "completed";
          toolResultEntry.completedAt = nowIso();
          toolResultEntry.result = executed.result;
          if (callSummary) {
            callSummary.status = toolResultEntry.status;
            callSummary.completedAt = toolResultEntry.completedAt;
          }
          step.status = "tool_result";
          step.phase = "tool_result";
          step.events.push({
            type: "tool_result",
            status: toolResultEntry.status,
            label: `工具返回结果：${executed.tool}`,
            toolCallId: call.id,
            tool: executed.tool,
            ok: executed.result?.ok !== false,
            count: executed.result?.count,
            evidenceId: executed.result?.evidence?.evidenceId || "",
            createdAt: toolResultEntry.completedAt
          });
          await appendAuditLog({
            event: "tool_result",
            runId,
            workspaceId,
            iteration,
            tool: executed.tool,
            ok: executed.result?.ok !== false,
            error: executed.result?.error || "",
            count: executed.result?.count,
            evidenceId: executed.result?.evidence?.evidenceId || "",
            query: executed.result?.query || executed.arguments?.query || ""
          });
          toolResults.push(executed);
          if (executed.tool === "keyword_search") {
            for (const item of asArray(executed.result?.items).slice(0, 8)) {
              if (item.evidenceId) {
                agentWorkspace.submit({
                  workspaceId,
                  runId,
                  agentId: EXPLORER_AGENT_ID,
                  type: "evidenceRef",
                  payload: {
                    title: item.title,
                    summary: item.snippet,
                    evidenceId: item.evidenceId,
                    sourceLocator: item.source || item.hierarchy || null
                  },
                  evidenceRefs: [item.evidenceId],
                  confidence: Math.max(0.1, Math.min(1, Number(item.score || 0)))
                });
              }
            }
          }
          if (executed.tool === "knowledge_aggregate") {
            for (const group of asArray(executed.result?.groups).slice(0, 8)) {
              for (const example of asArray(group.examples).slice(0, 3)) {
                if (example.evidenceId) {
                  agentWorkspace.submit({
                    workspaceId,
                    runId,
                    agentId: EXPLORER_AGENT_ID,
                    type: "evidenceRef",
                    payload: {
                      title: example.title,
                      summary: `${group.label || group.key}: ${group.count}`,
                      evidenceId: example.evidenceId,
                      sourceLocator: { aggregateGroup: group.key, metric: executed.result?.metric }
                    },
                    evidenceRefs: [example.evidenceId],
                    confidence: 0.75
                  });
                }
              }
            }
          }
          if (executed.tool === "knowledge_skill_search") {
            for (const skill of asArray(executed.result?.skills).slice(0, 5)) {
              agentWorkspace.submit({
                workspaceId,
                runId,
                agentId: EXPLORER_AGENT_ID,
                type: "contextSummary",
                payload: {
                  title: skill.title,
                  summary: skill.summary,
                  skillId: skill.skillId,
                  decisionHeuristics: skill.decisionHeuristics,
                  honestBoundaries: skill.honestBoundaries
                },
                evidenceRefs: asArray(skill.evidenceRefs),
                confidence: Math.max(0.3, Math.min(0.95, Number(skill.matchScore || 0.7)))
              });
            }
          }
          if (executed.tool === "knowledge_skill_propose" && executed.result?.skillId) {
            agentWorkspace.createDecision({
              workspaceId,
              runId,
              agentId: EXPLORER_AGENT_ID,
              title: `KnowledgeSkill proposal: ${executed.result.title || executed.result.skillId}`,
              payload: {
                skillId: executed.result.skillId,
                status: executed.result.status,
                summary: executed.result.summary,
                qualityReport: executed.result.qualityReport,
                statusReason: executed.result.statusReason
              },
              createdBy: EXPLORER_AGENT_ID
            });
          }
          messages.push(toolResultMessage(call, executed.result));
          persistProgress({
            coverage: {
              activeIteration: iteration,
              activePhase: "tool_result",
              activeTool: executed.tool
            }
          });
        }
      }

      await synthesizeFinalAnswer();
      if (!finalAnswer) {
        finalAnswer = finalFallback({ query, toolResults });
      }
      const evidenceRefs = [
        ...new Set(
          toolResults.flatMap((entry) => {
            if (entry.tool === "keyword_search") {
              return asArray(entry.result?.items).map((item) => item.evidenceId).filter(Boolean);
            }
            if (entry.tool === "open_evidence" && entry.result?.evidence?.evidenceId) {
              return [entry.result.evidence.evidenceId];
            }
            if (entry.tool === "knowledge_aggregate") {
              return asArray(entry.result?.groups)
                .flatMap((group) => [
                  ...asArray(group.evidenceRefs),
                  ...asArray(group.examples).map((example) => example.evidenceId)
                ])
                .filter(Boolean);
            }
            if (entry.tool === "knowledge_skill_search") {
              return asArray(entry.result?.skills)
                .flatMap((skill) => asArray(skill.evidenceRefs))
                .filter(Boolean);
            }
            if (entry.tool === "knowledge_skill_propose") {
              return asArray(entry.result?.evidenceRefs).filter(Boolean);
            }
            if (entry.tool === "golden_rule_authoring") {
              return asArray(entry.result?.gate?.scenarios)
                .flatMap((scenario) => asArray(scenario.result?.context?.candidate?.evidenceRefs))
                .filter(Boolean);
            }
            return [];
          })
        )
      ];
      const privateSummary = truncateText(
        [
          `query: ${query}`,
          `answer: ${finalAnswer}`,
          `evidence: ${evidenceRefs.slice(0, 12).join(", ")}`,
          `tools: ${toolResults.map((entry) => entry.tool).join(" -> ")}`
        ].join("\n"),
        4000
      );
      agentWorkspace.savePrivateState({
        workspaceId,
        runId,
        agentId: EXPLORER_AGENT_ID,
        summary: privateSummary,
        state: {
          query,
          answer: finalAnswer,
          evidenceRefs,
          toolResults: toolResults.map((entry) => ({
            tool: entry.tool,
            arguments: entry.arguments,
            ok: entry.result?.ok !== false,
            count: entry.result?.count
          }))
        }
      });
      agentWorkspace.submit({
        workspaceId,
        runId,
        agentId: EXPLORER_AGENT_ID,
        type: "contextSummary",
        payload: {
          title: `智能探索上下文：${query.slice(0, 60)}`,
          summary: privateSummary,
          contextProfileId: contextPack?.profileId || "",
          budgetReport: contextPack?.budgetReport || null
        },
        evidenceRefs,
        confidence: evidenceRefs.length ? 0.82 : 0.45
      });
      const completed = agentWorkspace.updateRun(runId, {
        status: "completed",
        steps: snapshotSteps().map((step) => ({
          ...step,
          status: step.status === "tool_result" ? "completed" : step.status,
          phase: step.phase === "tool_result" ? "completed" : step.phase
        })),
        coverage: {
          answer: finalAnswer,
          evidenceRefs,
          toolResults: snapshotToolResults(),
          contextPack: compactContextPackForStorage(contextPack),
          knowledgeSkillContext,
          evidenceRefCount: evidenceRefs.length,
          keywordSearchCalls: toolResults.filter((entry) => entry.tool === "keyword_search").length,
          openedEvidence: toolResults.filter((entry) => entry.tool === "open_evidence").length,
          contextProfileId: contextPack?.profileId || "",
          clientRuntimeAllocation: allocationResult?.allocation || input.clientRuntimeAllocation || null,
          finalSynthesis: steps.some((step) =>
            asArray(step.events).some((event) => event.type === "final_synthesis")
          ),
          nativeFunctionCalling: steps.some((step) =>
            ["native_tool_calls", "native_payload_tool_calls"].includes(step.functionCallSource)
          )
        },
        degraded,
        completedAt: nowIso()
      });
      await appendAuditLog({
        event: "run_completed",
        runId,
        workspaceId,
        degraded,
        evidenceRefCount: evidenceRefs.length,
        stepCount: steps.length
      });
      return buildResponse({
        ok: true,
        run: completed.run,
        answer: finalAnswer,
        evidenceRefs
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "智能探索失败。";
      await appendAuditLog({
        event: "run_failed",
        runId,
        workspaceId,
        error: message,
        stepCount: steps.length
      });
      const failed = agentWorkspace.updateRun(runId, {
        status: "failed",
        steps: snapshotSteps(),
        error: message,
        degraded: true,
        completedAt: nowIso()
      });
      return buildResponse({
        ok: false,
        run: failed?.run || runResult.run,
        answer: finalAnswer,
        error: message
      });
    }
    };

    if (input.async === true || input.background === true || input.realtime === true) {
      setTimeout(() => {
        executeRun().catch((error) => {
          const message = error instanceof Error ? error.message : "智能探索失败。";
          agentWorkspace.updateRun(runId, {
            status: "failed",
            steps: snapshotSteps(),
            error: message,
            degraded: true,
            completedAt: nowIso()
          });
          void appendAuditLog({
            event: "run_failed",
            runId,
            workspaceId,
            error: message,
            stepCount: steps.length
          });
        });
      }, 0);
      return buildResponse({
        ok: true,
        run: currentRun(),
        pending: true
      });
    }

    return executeRun();
  }

  function getRun(input = {}) {
    const runId = typeof input === "string" ? input : input.runId;
    const workspaceId = typeof input === "object" ? input.workspaceId : "";
    const workspace = workspaceId
      ? agentWorkspace?.getWorkspace({ workspaceId, includePrivate: Boolean(input.includePrivate) })
      : null;
    const run = workspace
      ? asArray(workspace.runs).find((item) => item.runId === runId)
      : agentWorkspace?.listWorkspaces({ limit: 200, includeSummary: false }).workspaces
          .map((item) => agentWorkspace.getWorkspace({ workspaceId: item.workspaceId, includePrivate: Boolean(input.includePrivate) }))
          .flatMap((item) => asArray(item?.runs).map((runItem) => ({ run: runItem, workspace: item?.workspace })))
          .find((item) => item.run.runId === runId);
    if (!run) {
      return null;
    }
    const enrich = ({ workspace: foundWorkspace, run: foundRun }) => ({
      protocolVersion: AGENT_EXPLORATION_PROTOCOL_VERSION,
      ok: foundRun.status !== "failed",
      pending: ["queued", "running"].includes(foundRun.status),
      workspace: foundWorkspace,
      run: foundRun,
      answer: String(foundRun.coverage?.answer || ""),
      evidenceRefs: asArray(foundRun.coverage?.evidenceRefs),
      toolResults: asArray(foundRun.coverage?.toolResults),
      contextPack: foundRun.coverage?.contextPack || null,
      degraded: foundRun.degraded === true,
      steps: asArray(foundRun.steps),
      error: foundRun.error || ""
    });
    if (run.run) {
      return enrich({ workspace: run.workspace, run: run.run });
    }
    return enrich({ workspace: workspace.workspace, run });
  }

  return {
    protocolVersion: AGENT_EXPLORATION_PROTOCOL_VERSION,
    describe,
    run,
    getRun,
    toolDefinitions
  };
}

export default createAgentExplorationRuntime;
