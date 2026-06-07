#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_OUTPUT_ROOT = "docs/reports/history/production-readiness";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const REQUIRED_COVERAGE = [
  "architecture",
  "agent-library-access",
  "capability-kernel-security",
  "workspace-contribution-governance",
  "document-parsing-real-sample",
  "external-knowledge-base-consistency",
  "external-service-api-registration",
  "capability-kernel-api-capability",
  "key-management-storage-distribution",
  "permission-management-auth-config",
  "mcp-gateway-client-push",
  "rag-evaluation",
  "distillation-evaluation",
  "session-thread",
  "tool-permission",
  "trace-observability",
  "durable-workflow",
  "backup-restore",
  "upgrade-migration",
  "ui-smoke",
  "offline-license"
];

const GATES = [
  {
    id: "architecture",
    title: "架构门禁",
    blockerLevel: "P0",
    owner: "platform-architecture",
    coverage: ["architecture"],
    commands: [
      ["npm", "run", "server:verify:architecture-patterns"],
      ["npm", "run", "server:verify:knowledge-architecture-governance"],
      ["npm", "run", "server:verify:platform-layout"]
    ],
    nextStep: "修复架构治理、平台分层或核心文档与实现偏差。"
  },
  {
    id: "agent-library-access",
    title: "AgentLibrary 源头权限",
    blockerLevel: "P0",
    owner: "knowledge-security",
    coverage: ["agent-library-access"],
    commands: [["npm", "run", "server:verify:agent-library-access"]],
    nextStep: "补齐 knowledgeAccessReceipt、loanRecord、authorizationOverlay 和所有知识出口的统一裁决。"
  },
  {
    id: "workspace-contribution-governance",
    title: "终端贡献资产治理",
    blockerLevel: "P0",
    owner: "workspace-governance",
    coverage: ["workspace-contribution-governance"],
    commands: [["npm", "run", "server:verify:workspace-contribution-governance"]],
    nextStep: "补齐贡献状态机、贡献授权、usage event、排行榜和资产贡献统计报表。"
  },
  {
    id: "document-parsing-real-sample",
    title: "文档解析真实样例",
    blockerLevel: "P0",
    owner: "knowledge-ingestion",
    coverage: ["document-parsing-real-sample"],
    commands: [
      ["npm", "run", "server:verify:dynamic-document-parsing"],
      ["npm", "run", "server:verify:document-preview-consistency"],
      ["npm", "run", "server:verify:document-parser-dry-run"],
      ["npm", "run", "server:verify:knowledge-docx-export"]
    ],
    nextStep: "补齐真实文档解析 fixture、结构锚点、动态切分和 DOCX 导出基准。"
  },
  {
    id: "external-knowledge-base-consistency",
    title: "外部知识库一致性",
    blockerLevel: "P0",
    owner: "knowledge-storage",
    coverage: ["external-knowledge-base-consistency"],
    commands: [["npm", "run", "server:verify:external-knowledge-base"]],
    nextStep: "补齐外部知识库 conformance：权限预过滤、删除/tombstone、回读和重建语义。"
  },
  {
    id: "external-service-api-registration",
    title: "外部服务 API 注册治理",
    blockerLevel: "P0",
    owner: "external-service-governance",
    coverage: ["external-service-api-registration"],
    commands: [
      ["npm", "run", "server:verify:external-service-api-registration"],
      ["npm", "run", "server:verify:external-knowledge-distillation"]
    ],
    nextStep: "所有服务必须通过 external.* operation 和 /api/external/* 中介 API 注册；Tool Management 不得暴露平台内部算法能力。"
  },
  {
    id: "rag-evaluation",
    title: "RAG 检索评估",
    blockerLevel: "P0",
    owner: "knowledge-quality",
    coverage: ["rag-evaluation"],
    commands: [
      ["npm", "run", "server:verify:knowledge-retrieval-quality"],
      ["npm", "run", "server:verify:source-evidence"]
    ],
    nextStep: "补齐检索质量、证据忠实度、权限过滤和 evidence pack 的持续评估。"
  },
  {
    id: "distillation-evaluation",
    title: "知识蒸馏评估",
    blockerLevel: "P0",
    owner: "knowledge-distillation",
    coverage: ["distillation-evaluation"],
    commands: [
      ["npm", "run", "server:verify:knowledge-distillation-workbench"],
      ["npm", "run", "server:verify:knowledge-industrial-distillation"],
      ["npm", "run", "server:verify:knowledge-distillation-optimization"]
    ],
    nextStep: "补齐蒸馏覆盖率、同一事项合并、时间线顺序、unsupported claims、优化趋势和人工审核闭环。"
  },
  {
    id: "session-thread",
    title: "会话线程与上下文",
    blockerLevel: "P0",
    owner: "agent-runtime",
    coverage: ["session-thread"],
    commands: [
      ["npm", "run", "server:verify:agent-workspace"],
      ["npm", "run", "server:verify:agent-session-governance"],
      ["npm", "run", "server:verify:context-runtime"],
      ["npm", "run", "server:verify:agent-sync"]
    ],
    nextStep: "补齐 session fork/compare/merge proposal/archive、context bundle、workspace 状态和 agent sync 的端到端验收。"
  },
  {
    id: "tool-permission",
    title: "工具权限和安全策略",
    blockerLevel: "P0",
    owner: "security-tooling",
    coverage: ["tool-permission", "permission-management-auth-config"],
    commands: [
      ["npm", "run", "server:verify:2-3-5-security-model"],
      ["npm", "run", "server:verify:tool-management"],
      ["npm", "run", "server:verify:operation-policy"],
      ["npm", "run", "server:verify:console-auth"],
      ["npm", "run", "server:verify:organization-model"],
      ["npm", "run", "server:verify:authorization-governance"]
    ],
    nextStep: "补齐 2-3-5 安全治理架构、tool grant、risk policy、scope、CSRF/safety-confirm、组织模型和授权治理边界。"
  },
  {
    id: "capability-kernel-security",
    title: "Capability Kernel 与密钥边界",
    blockerLevel: "P0",
    owner: "security-kernel",
    coverage: ["capability-kernel-security", "capability-kernel-api-capability"],
    commands: [
      ["npm", "run", "server:verify:authorization-capabilities"],
      ["npm", "run", "server:verify:opaque-capability-key"],
      ["npm", "run", "server:verify:capability-binding-guard"],
      ["npm", "run", "server:verify:capability-security-helper"],
      ["npm", "run", "server:verify:linux-security-backends"],
      ["npm", "run", "server:verify:windows-security-backends"]
    ],
    nextStep: "补齐 Capability Kernel、opaque key、Binding Guard、helper、recovery 和 OS backend 的生产验收。"
  },
  {
    id: "key-management-storage-distribution",
    title: "密钥存储和下发",
    blockerLevel: "P0",
    owner: "security-kernel",
    coverage: ["key-management-storage-distribution"],
    commands: [
      ["npm", "run", "server:verify:secret-init"],
      ["npm", "run", "server:verify:opaque-capability-key"],
      ["npm", "run", "server:verify:tool-management"],
      ["npm", "run", "server:verify:mcp-http"]
    ],
    nextStep: "补齐密钥初始化、opaque capability key、grant 存储/轮换/撤销，以及 MCP local-grant 下发链路。"
  },
  {
    id: "mcp-gateway-client-push",
    title: "MCP 网关下游推送",
    blockerLevel: "P0",
    owner: "mcp-gateway",
    coverage: ["mcp-gateway-client-push"],
    commands: [
      ["npm", "run", "server:verify:mcp-http"],
      ["npm", "run", "server:verify:mcp-release"],
      ["npm", "run", "client:verify:mcp-plugins"],
      ["npm", "run", "server:verify:client-runtime-bootstrap"]
    ],
    nextStep: "补齐 MCP discovery、tools/list_changed、connector 版本发布、客户端 MCP 配置更新和密钥授权下发验收。"
  },
  {
    id: "model-routing",
    title: "模型路由成本和降级",
    blockerLevel: "P1",
    owner: "agent-runtime",
    coverage: [],
    commands: [["npm", "run", "server:verify:model-routing"]],
    nextStep: "补齐 pact.model-routing.v1、预算、fallback chain、熔断、prompt version 和成本台账。"
  },
  {
    id: "capability-package-lifecycle",
    title: "工具与技能包生命周期",
    blockerLevel: "P1",
    owner: "tooling-governance",
    coverage: [],
    commands: [["npm", "run", "server:verify:capability-package-lifecycle"]],
    nextStep: "补齐 pact.tool-package.v1、pact.skill-registry.v1、签名、依赖、审批、回滚和废弃策略。"
  },
  {
    id: "data-connector-governance",
    title: "数据连接器治理与本地镜像一致性",
    blockerLevel: "P1",
    owner: "knowledge-connectors",
    coverage: [],
    commands: [["npm", "run", "server:verify:data-connector-governance"]],
    nextStep: "补齐 pact.data-connector-governance.v1、OAuth refresh 策略、增量 cursor、mirror 冲突/清理、localQuery 禁远程和卸载策略。"
  },
  {
    id: "performance-capacity",
    title: "性能和容量基准",
    blockerLevel: "P1",
    owner: "production-readiness",
    coverage: [],
    commands: [["npm", "run", "server:verify:performance-capacity"]],
    nextStep: "补齐 pact.performance-capacity.v1、容量目标、benchmark runner、失败注入和报告阈值。"
  },
  {
    id: "module-ecosystem",
    title: "模块 SDK 与模板",
    blockerLevel: "P2",
    owner: "module-management",
    coverage: [],
    commands: [["npm", "run", "server:verify:module-ecosystem"]],
    nextStep: "补齐 pact.module-ecosystem.v1、create-module、contract test、示例模块、CI 模板和 schema docs。"
  },
  {
    id: "workspace-governance",
    title: "组织级工作空间治理",
    blockerLevel: "P2",
    owner: "workspace-governance",
    coverage: [],
    commands: [["npm", "run", "server:verify:workspace-governance"]],
    nextStep: "补齐 organization/project/dataClass/retention/legalHold、外部协作者、跨空间复制和共享授权治理。"
  },
  {
    id: "asset-lineage",
    title: "多模态资产血缘",
    blockerLevel: "P2",
    owner: "knowledge-ingestion",
    coverage: [],
    commands: [["npm", "run", "server:verify:asset-lineage"]],
    nextStep: "补齐 raw object、page/slide、bbox、parser/model/version、OCR、视觉模型和重解析计划。"
  },
  {
    id: "executive-report",
    title: "资产价值管理报告",
    blockerLevel: "P3",
    owner: "product-quality",
    coverage: [],
    commands: [["npm", "run", "server:verify:executive-report"]],
    nextStep: "补齐 asset contribution、production readiness、eval、trace、benchmark 的管理层报告汇总。"
  },
  {
    id: "architecture-live-map",
    title: "架构图运行状态联动",
    blockerLevel: "P3",
    owner: "platform-architecture",
    coverage: [],
    commands: [["npm", "run", "server:verify:architecture-live-map"]],
    nextStep: "补齐核心架构节点到文档、实现路径和生产门禁状态的联动映射。"
  },
  {
    id: "sample-business-pack",
    title: "样例业务包",
    blockerLevel: "P3",
    owner: "product-quality",
    coverage: [],
    commands: [["npm", "run", "server:verify:sample-business-pack"]],
    nextStep: "补齐邮件、PDF、PPT、Markdown 项目和外部知识库 compose 的可物化样例包。"
  },
  {
    id: "trace-observability",
    title: "内部 Trace 与日志脱敏",
    blockerLevel: "P0",
    owner: "observability",
    coverage: ["trace-observability"],
    commands: [
      ["npm", "run", "server:verify:trace-context"],
      ["npm", "run", "server:verify:runtime-logging"]
    ],
    nextStep: "补齐 pact.trace.v1、span 关联、权限裁决引用、成本字段和 OpenTelemetry 导出映射。"
  },
  {
    id: "durable-workflow",
    title: "长任务 Durable Workflow",
    blockerLevel: "P0",
    owner: "workflow-runtime",
    coverage: ["durable-workflow"],
    commands: [
      ["npm", "run", "server:verify:durable-workflow"],
      ["npm", "run", "server:verify:continuity"],
      ["npm", "run", "server:verify:checkpoints"],
      ["npm", "run", "server:verify:state-coordination"]
    ],
    nextStep: "继续把更多高风险长任务接入 pact.workflow.v1，并用真实外部服务演练 partial write 补偿。"
  },
  {
    id: "backup-restore",
    title: "备份恢复和 Checkpoint",
    blockerLevel: "P0",
    owner: "ops-runtime",
    coverage: ["backup-restore"],
    commands: [
      ["npm", "run", "server:verify:checkpoints"],
      ["npm", "run", "server:verify:backup-restore"],
      ["npm", "run", "server:verify:rebuild"],
      ["npm", "run", "server:verify:ops"]
    ],
    nextStep: "补齐 backup manifest、restore drill、checkpoint tree 和恢复审计演示。"
  },
  {
    id: "upgrade-migration",
    title: "升级迁移和配置兼容",
    blockerLevel: "P0",
    owner: "release-engineering",
    coverage: ["upgrade-migration"],
    commands: [
      ["npm", "run", "server:verify:feature-profiles"],
      ["npm", "run", "server:verify:unified-registration"],
      ["npm", "run", "server:verify:multi-source-connectors"]
    ],
    nextStep: "补齐 schema migration report、feature profile 构建和连接器迁移门禁。"
  },
  {
    id: "ui-smoke",
    title: "端到端 UI smoke",
    blockerLevel: "P0",
    owner: "console-frontend",
    coverage: ["ui-smoke"],
    commands: [
      ["npm", "run", "build:renderer:raw"],
      ["npm", "run", "server:verify:frontend-feature-registry"],
      ["npm", "run", "server:verify:knowledge-console"]
    ],
    nextStep: "补齐控制台生产健康页、关键路由 smoke、前端 feature registry 和页面验收。"
  },
  {
    id: "offline-license",
    title: "离线包和 License",
    blockerLevel: "P0",
    owner: "release-engineering",
    coverage: ["offline-license"],
    commands: [
      ["node", "server/scripts/verify-knowledge-license-manifest.mjs"],
      ["node", "server/scripts/pack-offline-server.mjs", "--dry-run", "--target", "linux-x64"]
    ],
    nextStep: "补齐离线包许可清单、第三方运行时声明和可复制打包报告。"
  },
  {
    id: "business-scenarios",
    title: "业务场景回归",
    blockerLevel: "P1",
    owner: "product-quality",
    coverage: [],
    commands: [["npm", "run", "server:verify:business-scenarios"]],
    nextStep: "补齐真实业务场景覆盖，避免只验证单点功能。"
  }
];

function parseArgs(argv) {
  const options = {
    outputRoot: DEFAULT_OUTPUT_ROOT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    quick: false,
    noFailOnBlocker: false,
    list: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-root") {
      options.outputRoot = argv[index + 1] || options.outputRoot;
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Math.max(1000, Number(argv[index + 1] || options.timeoutMs));
      index += 1;
    } else if (arg === "--quick") {
      options.quick = true;
    } else if (arg === "--no-fail-on-blocker") {
      options.noFailOnBlocker = true;
    } else if (arg === "--list") {
      options.list = true;
    }
  }
  return options;
}

function runIdFromDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function commandLabel(command) {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function runCommand(command, { timeoutMs, stream = true }) {
  const startedAt = new Date();
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stream) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stream) {
        process.stderr.write(chunk);
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const finishedAt = new Date();
      resolve({
        command: commandLabel(command),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode: Number(code ?? 1),
        signal: signal || "",
        timedOut,
        stdout,
        stderr
      });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      const finishedAt = new Date();
      resolve({
        command: commandLabel(command),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: finishedAt.getTime() - startedAt.getTime(),
        exitCode: 127,
        signal: "",
        timedOut,
        stdout,
        stderr: error instanceof Error ? error.stack || error.message : String(error)
      });
    });
  });
}

async function gitValue(args) {
  const result = await runCommand(["git", ...args], { timeoutMs: 15000, stream: false });
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

async function writeGateEvidence(runDir, gateId, commandResults) {
  const evidencePath = path.join(runDir, `${gateId}.log`);
  const lines = [];
  for (const result of commandResults) {
    lines.push(`# ${result.command}`);
    lines.push(`startedAt=${result.startedAt}`);
    lines.push(`finishedAt=${result.finishedAt}`);
    lines.push(`elapsedMs=${result.elapsedMs}`);
    lines.push(`exitCode=${result.exitCode}`);
    if (result.signal) lines.push(`signal=${result.signal}`);
    if (result.timedOut) lines.push("timedOut=true");
    lines.push("");
    lines.push("## stdout");
    lines.push(result.stdout.trim() || "(empty)");
    lines.push("");
    lines.push("## stderr");
    lines.push(result.stderr.trim() || "(empty)");
    lines.push("");
  }
  await fs.writeFile(evidencePath, `${lines.join("\n")}\n`, "utf8");
  return evidencePath;
}

function statusForResults(results) {
  if (results.some((result) => result.timedOut)) return "timeout";
  if (results.some((result) => result.exitCode !== 0)) return "fail";
  return "pass";
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath);
}

function buildMarkdownReport(report) {
  const lines = [
    "# Production Readiness Report",
    "",
    `- Run ID: \`${report.runId}\``,
    `- Generated At: \`${report.generatedAt}\``,
    `- Branch: \`${report.git.branch || "unknown"}\``,
    `- Commit: \`${report.git.commit || "unknown"}\``,
    `- Dirty Files: \`${report.git.dirtyFileCount}\``,
    `- Overall Status: \`${report.overallStatus}\``,
    "",
    "## Summary",
    "",
    `- Passed: ${report.summary.pass}`,
    `- Failed: ${report.summary.fail}`,
    `- Timed Out: ${report.summary.timeout}`,
    `- Blocked P0: ${report.summary.blockedP0}`,
    `- Missing Coverage: ${report.coverage.missing.length ? report.coverage.missing.join(", ") : "none"}`,
    "",
    "## Gates",
    "",
    "| Gate | Status | Blocker | Owner | Evidence | Next Step |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const gate of report.gates) {
    lines.push([
      markdownEscape(gate.title),
      gate.status,
      gate.blockerLevel,
      markdownEscape(gate.owner),
      gate.evidencePath ? `\`${markdownEscape(gate.evidencePath)}\`` : "",
      markdownEscape(gate.nextStep)
    ].join(" | "));
  }
  lines.push("");
  lines.push("## Coverage Checklist");
  lines.push("");
  for (const item of REQUIRED_COVERAGE) {
    const coveredBy = report.coverage.byRequirement[item] || [];
    lines.push(`- ${coveredBy.length ? "[x]" : "[ ]"} \`${item}\`${coveredBy.length ? `: ${coveredBy.join(", ")}` : ""}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Passing this gate is required before claiming production readiness.");
  lines.push("- A passing command is only counted for the gate it explicitly covers; uncovered design requirements remain blockers.");
  lines.push("- Reports are append-only run artifacts under `docs/reports/history/production-readiness/<run-id>/`.");
  return `${lines.join("\n")}\n`;
}

async function runGate(gate, options, runDir) {
  console.log(`\n[production-readiness] ${gate.id}: ${gate.title}`);
  const commandResults = [];
  for (const command of gate.commands) {
    console.log(`[production-readiness] running ${commandLabel(command)}`);
    commandResults.push(await runCommand(command, { timeoutMs: options.timeoutMs }));
    if (commandResults[commandResults.length - 1].exitCode !== 0) {
      break;
    }
  }
  const evidencePath = await writeGateEvidence(runDir, gate.id, commandResults);
  return {
    id: gate.id,
    title: gate.title,
    blockerLevel: gate.blockerLevel,
    owner: gate.owner,
    coverage: gate.coverage,
    status: statusForResults(commandResults),
    evidencePath: relativePath(evidencePath),
    commands: commandResults.map((result) => ({
      command: result.command,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      elapsedMs: result.elapsedMs
    })),
    nextStep: gate.nextStep
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const gate of GATES) {
      console.log(`${gate.id}\t${gate.blockerLevel}\t${gate.title}`);
    }
    return;
  }

  const runId = runIdFromDate();
  const outputRoot = path.resolve(repoRoot, options.outputRoot);
  const runDir = path.join(outputRoot, runId);
  await ensureDir(runDir);

const QUICK_COVERAGE = ["architecture", "document-parsing-real-sample", "ui-smoke"];

  const selectedGates = options.quick
    ? GATES.filter((gate) => ["architecture", "document-parsing-real-sample", "ui-smoke"].includes(gate.id))
    : GATES;

  const gateResults = [];
  for (const gate of selectedGates) {
    gateResults.push(await runGate(gate, options, runDir));
  }

  const applicableCoverage = options.quick ? QUICK_COVERAGE : REQUIRED_COVERAGE;
  const byRequirement = Object.fromEntries(applicableCoverage.map((item) => [item, []]));
  for (const gate of gateResults) {
    if (gate.status !== "pass") continue;
    for (const requirement of gate.coverage) {
      if (byRequirement[requirement]) {
        byRequirement[requirement].push(gate.id);
      }
    }
  }
  const missing = applicableCoverage.filter((item) => byRequirement[item].length === 0);
  const summary = {
    pass: gateResults.filter((gate) => gate.status === "pass").length,
    fail: gateResults.filter((gate) => gate.status === "fail").length,
    timeout: gateResults.filter((gate) => gate.status === "timeout").length,
    blockedP0: gateResults.filter((gate) => gate.blockerLevel === "P0" && gate.status !== "pass").length
  };
  let overallStatus;
  if (options.quick) {
    overallStatus = summary.blockedP0 || missing.length ? "quick_blocked" : "quick_pass";
  } else {
    overallStatus = summary.blockedP0 || missing.length ? "blocked" : "pass";
  }
  const report = {
    schemaVersion: 1,
    reportType: "pact.production-readiness.v1",
    runId,
    generatedAt: new Date().toISOString(),
    mode: options.quick ? "quick" : "full",
    repository: "Unka-Malloc/Pact",
    repoRoot: { redacted: true, reason: "local_path" },
    git: {
      branch: await gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: await gitValue(["rev-parse", "HEAD"]),
      dirtyFileCount: Number((await gitValue(["status", "--short"])).split("\n").filter(Boolean).length)
    },
    overallStatus,
    summary,
    coverage: {
      required: REQUIRED_COVERAGE,
      byRequirement,
      missing
    },
    gates: gateResults
  };

  const jsonPath = path.join(runDir, "report.json");
  const mdPath = path.join(runDir, "report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, buildMarkdownReport(report), "utf8");

  console.log(`\nProduction readiness report written: ${relativePath(mdPath)}`);
  console.log(`Production readiness JSON written: ${relativePath(jsonPath)}`);
  console.log(`Production readiness status: ${overallStatus}`);

  if (overallStatus !== "pass" && !options.noFailOnBlocker) {
    process.exitCode = 1;
  }
}

await main();
