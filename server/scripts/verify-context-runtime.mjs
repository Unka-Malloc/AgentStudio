import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTEXT_RUNTIME_PROTOCOL_VERSION,
  callAgentContextMethod,
  createContextRuntime,
  estimateTokens,
  getAgentContextInterface
} from "../platform/specialized/agent/agent-context/interface/index.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const agentContextRoot = "server/platform/specialized/agent/agent-context/";
const agentContextInternalRoots = [
  "server/platform/specialized/agent/agent-context/context-core",
  "server/platform/specialized/agent/agent-context/context-compact"
];
const scanRoots = ["server/services", "server/platform", "server/scripts", "tests"];
const skippedScanRoots = ["server/platform/modules/knowledge/runtime", "tests/email-corpus"];

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(relativePath) {
  if (skippedScanRoots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))) {
    return [];
  }
  if (!(await pathExists(relativePath))) {
    return [];
  }
  const root = path.join(repoRoot, relativePath);
  const out = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const childRelative = normalize(path.join(relativePath, entry.name));
    if (entry.isDirectory()) {
      out.push(...(await walk(childRelative)));
    } else if (entry.isFile() && childRelative.endsWith(".mjs")) {
      out.push(childRelative);
    }
  }
  return out;
}

function specifierTarget(fileRelativePath, specifier) {
  const base = path.resolve(path.join(repoRoot, path.dirname(fileRelativePath)), specifier);
  const candidates = [base, `${base}.mjs`, `${base}.js`, path.join(base, "index.mjs")];
  return candidates.find((candidate) => candidate.startsWith(repoRoot)) || base;
}

function isAgentContextInternalTarget(target) {
  const relativePath = normalize(path.relative(repoRoot, target));
  return agentContextInternalRoots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));
}

async function assertAgentContextInterfaceBoundary() {
  const contextInterface = getAgentContextInterface();
  for (const methodName of [
    "context.createRuntime",
    "context.estimateTokens",
    "context.compaction.createRuntime",
    "context.compaction.createStrategyAdapter",
    "context.compaction.listStrategies",
    "context.compaction.computeBudget",
    "context.compaction.normalizePolicy",
    "context.compaction.buildMessageGraph",
    "context.compaction.chooseCutPoint",
    "context.compaction.estimateTokens",
    "context.compaction.redactValue"
  ]) {
    assert.equal(contextInterface.has(methodName), true, `agent-context interface must register ${methodName}`);
  }
  assert.equal(
    contextInterface.listMethods().every((methodName) => methodName === "context.createRuntime" || methodName.startsWith("context.compaction.") || methodName === "context.estimateTokens"),
    true,
    "agent-context interface must only expose context runtime and internal compaction methods"
  );
  assert.throws(
    () => callAgentContextMethod("context.internal.unregistered"),
    /agent_context_interface_method_unregistered/,
    "agent-context interface must reject unregistered methods"
  );

  const importPattern =
    /(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])|(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g;
  const violations = [];
  for (const root of scanRoots) {
    for (const file of await walk(root)) {
      if (file.startsWith(agentContextRoot)) {
        continue;
      }
      const text = await fs.readFile(path.join(repoRoot, file), "utf8");
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[2] || match[5];
        if (isAgentContextInternalTarget(specifierTarget(file, specifier))) {
          violations.push({ file, specifier });
        }
      }
    }
  }
  assert.deepEqual(violations, [], "external agent-context calls must go through agent-context/interface");
}

await assertAgentContextInterfaceBoundary();

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-context-core-"));
const runtime = createContextRuntime({ userDataPath });

try {
  const defaults = await runtime.listProfiles();
  assert.equal(defaults.protocolVersion, CONTEXT_RUNTIME_PROTOCOL_VERSION);
  assert.deepEqual(
    defaults.profiles.map((profile) => profile.profileId),
    ["context-32k", "context-128k", "context-1m"]
  );
  assert.equal(defaults.profiles.some((profile) => profile.profileId === "balanced"), false);
  assert.equal(defaults.profiles.some((profile) => profile.profileId === "small-context"), false);
  assert.equal(defaults.profiles.some((profile) => profile.profileId === "deepseek-v3-671b"), false);

  const saved = await runtime.saveProfiles({
    profiles: [
      {
        profileId: "verify-small",
        label: "Verify Compact Context",
        modelAlias: "qwen-v3-32b",
        contextWindowTokens: 4096,
        outputReserveTokens: 256,
        toolReserveTokens: 0,
        fixedMemoryBudget: 256,
        knowledgeBudget: 2200,
        historyBudget: 1800,
        recentTurnBudget: 600,
        compression: {
          enabled: true,
          mode: "deterministic-extractive",
          threshold: 0.1,
          targetRatio: 0.1,
          protectLastNTurns: 2,
          summaryMaxTokens: 900,
          strategy: "deterministic-extractive"
        },
        rankingWeights: {
          queryRelevance: 0.35,
          humanExpertBoost: 0.25
        },
        protectedEvidenceFields: ["evidenceId", "sourceLocator", "snippet", "when", "amount"]
      }
    ]
  });
  assert.equal(saved.profiles.some((profile) => profile.profileId === "verify-small"), true);
  assert.equal(saved.profiles.some((profile) => profile.profileId === "context-32k"), false);

  const evidence = Array.from({ length: 80 }, (_, index) => ({
    evidenceId: `ev-${index}`,
    title: `合同证据 ${index}`,
    claim: `第 ${index} 条证据涉及合同、金额、日期、负责人和风险。`,
    snippet: "这是一个较长的证据片段，用来验证上下文预算压缩和引用保留。".repeat(20),
    sourceLocator: `document-${index}`,
    confidence: index === 2 ? 0.99 : 0.4,
    humanExpert: index === 2,
    updatedAt: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`
  }));
  const pack = await runtime.assemble({
    contextProfileId: "verify-small",
    inputSource: "verify-context-core",
    roleId: "Reviewer",
    taskBrief: "总结合同金额和日期风险",
    systemMemory: "本地记忆规则：必须保护证据编号和来源定位。",
    retrievedEvidence: evidence,
    expertGuidance: [
      {
        feedbackId: "gold-1",
        label: "优先检查合同金额",
        instruction: "先保留有人类确认的金额和日期证据。",
        evidenceRefs: ["ev-2"],
        context: { gold: true, humanExpert: true }
      }
    ],
    history: "历史消息包含很多无关信息。\n".repeat(500),
    recentTurns: Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `recent turn ${index} ` + "内容 ".repeat(80)
    })),
    workspaceState: {
      submissions: [
        {
          status: "accepted",
          type: "evidenceCard",
          confidence: 0.9,
          payload: {
            claim: "accepted claim"
          },
          evidenceRefs: ["ev-1"]
        }
      ]
    }
  });
  assert.equal(pack.profileId, "verify-small");
  assert.equal(pack.budgetReport.compressed, true);
  assert.ok(pack.budgetReport.droppedKnowledgeCount > 0);
  assert.ok(pack.citations.length > 0);
  assert.ok(pack.retrievedKnowledge.length < evidence.length);
  assert.ok(pack.contextBuildRecordId);
  assert.ok(pack.memoryBlocks.length > 0);
  assert.equal(pack.expertGuidance.length, 1);
  assert.ok(pack.criticalEvidenceIndex.length > 0);
  assert.ok(pack.evidencePack.some((item) => item.evidenceId === "ev-2"), "human-confirmed evidence should survive compression");
  assert.ok(pack.tailChecklist.evidenceIds.includes("ev-2"));
  assert.equal(pack.budgetReport.compressionMode, "deterministic-extractive");

  const protectedEvidence = [
    ...Array.from({ length: 60 }, (_, index) => ({
      evidenceId: `ev-priority-${index}`,
      title: `高分但非必需证据 ${index}`,
      claim: "预算压缩时这些证据可以被淘汰。",
      snippet: "高分证据片段。".repeat(30),
      sourceLocator: `priority-${index}`,
      confidence: 0.98,
      updatedAt: "2026-05-01T00:00:00.000Z"
    })),
    {
      evidenceId: "ev-required-low",
      title: "低分但显式必需证据",
      claim: "这条证据虽然低分，但被调用方声明为必须保留。",
      snippet: "低分必需证据片段。".repeat(30),
      sourceLocator: "required-low",
      confidence: 0.01,
      updatedAt: "2020-01-01T00:00:00.000Z"
    }
  ];
  const protectedPack = await runtime.assemble({
    contextProfileId: "verify-small",
    inputSource: "verify-context-core-protected-evidence",
    taskBrief: "验证显式 requiredEvidenceIds 不会被预算压缩淘汰",
    requiredEvidenceIds: ["ev-required-low"],
    retrievedEvidence: protectedEvidence,
    history: "触发压缩。\n".repeat(400),
    record: false
  });
  assert.equal(protectedPack.budgetReport.compressed, true);
  assert.ok(
    protectedPack.evidencePack.some((item) => item.evidenceId === "ev-required-low" && item.protectedEvidence),
    "required evidence should survive both ranking and second-pass compression"
  );
  assert.ok(protectedPack.tailChecklist.requiredEvidenceIds.includes("ev-required-low"));
  assert.equal(protectedPack.budgetReport.protectedEvidenceCount, 1);

  const records = await runtime.listBuildRecords({ limit: 5 });
  assert.equal(records.protocolVersion, CONTEXT_RUNTIME_PROTOCOL_VERSION);
  assert.ok(records.records.some((record) => record.recordId === pack.contextBuildRecordId));

  const preview = await runtime.preview({
    contextProfileId: "verify-small",
    taskBrief: "预览上下文",
    retrievedEvidence: evidence.slice(0, 3)
  });
  assert.equal(preview.protocolVersion, CONTEXT_RUNTIME_PROTOCOL_VERSION);
  assert.ok(preview.contextPack.budgetReport);

  const evaluation = await runtime.runEvaluation({
    profiles: ["verify-small"],
    cases: [
      {
        caseId: "contract-risk",
        taskBrief: "总结合同金额和日期风险",
        retrievedEvidence: evidence,
        requiredEvidenceIds: ["ev-2"]
      }
    ]
  });
  assert.equal(evaluation.protocolVersion, CONTEXT_RUNTIME_PROTOCOL_VERSION);
  assert.equal(evaluation.results[0].requiredEvidenceRecall, 1);

  const compacted = await runtime.compact({
    contextProfileId: "verify-small",
    text: [
      "普通背景信息。",
      "关键证据：合同需要预算审批。",
      "风险：发票抬头未确认。",
      "负责人：财务团队。"
    ].join("\n").repeat(120),
    targetTokens: 300
  });
  assert.equal(compacted.protocolVersion, CONTEXT_RUNTIME_PROTOCOL_VERSION);
  assert.ok(compacted.summaryTokens <= compacted.sourceTokens);
  assert.ok(estimateTokens(compacted.summary) <= 900);

  const modelRuntime = createContextRuntime({
    userDataPath: path.join(userDataPath, "model-assisted"),
    modelCompressor: async ({ text, citations }) => ({
      summary: `模型压缩摘要，保留引用 ${citations.join(", ")}。\n${String(text).slice(0, 240)}`
    })
  });
  await modelRuntime.saveProfiles({
    profiles: [
      {
        profileId: "verify-model-assisted",
        contextWindowTokens: 4096,
        outputReserveTokens: 256,
        toolReserveTokens: 0,
        knowledgeBudget: 1200,
        historyBudget: 1200,
        compression: {
          enabled: true,
          mode: "model-assisted",
          threshold: 0.1,
          targetRatio: 0.2,
          summaryMaxTokens: 900,
          strategy: "model-assisted"
        },
        modelCompression: {
          enabled: true,
          alias: "mock-compressor",
          maxOutputTokens: 400
        }
      }
    ]
  });
  const modelPack = await modelRuntime.assemble({
    contextProfileId: "verify-model-assisted",
    taskBrief: "验证模型辅助压缩",
    history: "evidence::ev-2 这是一段很长的历史。".repeat(300),
    retrievedEvidence: evidence.slice(0, 5)
  });
  assert.equal(modelPack.budgetReport.modelCompression.used, true);
  assert.equal(modelPack.budgetReport.modelCompression.degraded, false);
  assert.match(modelPack.compressedHistory, /ev-2/);
} finally {
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Context runtime verification passed.");
