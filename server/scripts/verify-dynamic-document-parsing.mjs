import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindDynamicDocumentParsingInvocation,
  dispatchDynamicDocumentParsingAlgorithm,
  DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID
} from "../platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs";
import { createDocumentParsingRuntime } from "../platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function assertFragments(result, expectedAlgorithm, expectedGranularity) {
  assert.equal(result.algorithmId, expectedAlgorithm);
  assert.ok(result.fragments.length > 0, `${expectedAlgorithm} should emit fragments`);
  for (const fragment of result.fragments) {
    assert.ok(fragment.parentArtifactId, "fragment must keep parentArtifactId");
    assert.equal(fragment.granularity, expectedGranularity);
    assert.ok(fragment.fragmentRange && typeof fragment.fragmentRange === "object");
    assert.ok(fragment.order > 0);
    assert.equal(fragment.fragmentationTrace.policy, "dynamic-parameter-document-parsing-policy");
    assert.equal(fragment.fragmentationTrace.algorithm, expectedAlgorithm);
  }
}

function artifact(overrides = {}) {
  return {
    artifactId: "artifact::source::block",
    sourceId: "source",
    sourceName: "source.md",
    blockId: "block",
    artifactType: "paragraph",
    text: "第一句用于测试。第二句用于测试。第三句用于测试。第四句用于测试。",
    tokenCount: 48,
    charCount: 42,
    byteLength: 126,
    order: 1,
    headingPath: ["测试"],
    titlePath: ["测试"],
    sourceRange: { startLine: 1, endLine: 4 },
    ...overrides
  };
}

function assertDispatcherAlgorithms() {
  assertFragments(
    dispatchDynamicDocumentParsingAlgorithm({
      artifact: artifact(),
      artifactType: "paragraph",
      algorithmId: "paragraph-sentence-v1",
      granularity: { secondaryParse: { enabled: true, targetTokens: 16, targetChars: 80 } }
    }),
    "paragraph-sentence-v1",
    "paragraph-sentence"
  );

  assertFragments(
    dispatchDynamicDocumentParsingAlgorithm({
      artifact: artifact({
        artifactType: "table",
        text: "| 字段 | 说明 |\n| --- | --- |\n| sourceRange | 原文范围 |\n| parentArtifactId | 父结构 |"
      }),
      artifactType: "table",
      algorithmId: "table-row-window-v1",
      granularity: { secondaryParse: { enabled: true, targetTokens: 16, targetChars: 120 } }
    }),
    "table-row-window-v1",
    "table-row-window"
  );

  assertFragments(
    dispatchDynamicDocumentParsingAlgorithm({
      artifact: artifact({
        artifactType: "table",
        text: "| 字段 | 说明 |\n| --- | --- |\n| sourceRange | 原文范围 |\n| parentArtifactId | 父结构 |"
      }),
      artifactType: "table",
      algorithmId: "table-cell-window-v1",
      granularity: { secondaryParse: { enabled: true, targetTokens: 16, targetChars: 120 } }
    }),
    "table-cell-window-v1",
    "table-cell-window"
  );

  assertFragments(
    dispatchDynamicDocumentParsingAlgorithm({
      artifact: artifact({
        artifactType: "code",
        text: "function parse() {\n  return true;\n}\nparse();"
      }),
      artifactType: "code",
      algorithmId: "code-line-window-v1",
      granularity: { secondaryParse: { enabled: true, targetTokens: 16, targetChars: 80 } }
    }),
    "code-line-window-v1",
    "code-line-window"
  );

  assertFragments(
    dispatchDynamicDocumentParsingAlgorithm({
      artifact: artifact({
        artifactType: "paragraph",
        text: "A".repeat(500)
      }),
      artifactType: "paragraph",
      algorithmId: "token-window-fallback-v1",
      granularity: { secondaryParse: { enabled: true, targetTokens: 16, targetChars: 80 } }
    }),
    "token-window-fallback-v1",
    "token-window"
  );
}

function assertInvocationBudgeting() {
  const blocks = [
    {
      id: "block-1",
      sourceId: "source",
      sourceName: "source.md",
      kind: "paragraph",
      text: Array.from({ length: 900 }, (_, index) => `预算句子 ${index + 1} 用于制造多个片段并超过响应预算。`).join(" "),
      sourceStartLine: 1,
      sourceEndLine: 90,
      headingPath: ["预算"]
    }
  ];
  const binding = bindDynamicDocumentParsingInvocation({
    sources: [{ id: "source", name: "source.md", mediaType: "text/markdown" }],
    blocks,
    contextBudget: { knowledgeTokens: 32 },
    payloadBudget: { maxResponseBytes: 4096, maxEvidenceBytes: 2048 },
    granularity: {
      secondaryParse: { enabled: true, algorithm: "auto", targetTokens: 12, targetChars: 96 }
    }
  });

  assert.ok(binding.structureArtifacts.length === 1);
  assert.ok(binding.granularityFragments.length >= 1);
  assert.equal(binding.payload.truncated, true, "small payload budget should truncate returned fragments");
  assert.ok(binding.payload.nextContinuationToken);
  assert.equal(binding.chunks.length, binding.granularityFragments.length);
}

function assertDefaultInvocationDoesNotSecondaryParse() {
  const text = Array.from({ length: 120 }, (_, index) =>
    `默认关闭句子 ${index + 1} 用于确认预算不足时也不会自动派生二次解析片段。`
  ).join(" ");
  const binding = bindDynamicDocumentParsingInvocation({
    sources: [{ id: "source", name: "source.md", mediaType: "text/markdown" }],
    blocks: [{
      id: "block-1",
      sourceId: "source",
      sourceName: "source.md",
      kind: "paragraph",
      text,
      sourceStartLine: 1,
      sourceEndLine: 120,
      headingPath: ["默认关闭"]
    }],
    contextBudget: { knowledgeTokens: 32 },
    payloadBudget: { maxResponseBytes: 262144, maxEvidenceBytes: 2048 },
    granularity: {
      preferOriginalStructure: true,
      targetTokens: 16,
      targetChars: 96
    }
  });

  assert.equal(binding.backendTrace.secondaryParse.enabled, false);
  assert.equal(binding.backendTrace.secondaryParse.materialization, "complete-original");
  assert.equal(binding.backendTrace.algorithms[0]?.algorithm, "original-structure-v1");
  assert.equal(binding.granularityFragments.length, 1);
  assert.equal(binding.granularityFragments[0].granularity, "original-structure");
  assert.equal(binding.granularityFragments[0].text, text);
  assert.equal(binding.chunks.length, 1);
  assert.equal(binding.chunks[0].metadata?.materialization?.mode, "structure");
  assert.equal(binding.chunks[0].metadata?.fragmentationTrace?.algorithm, "original-structure-v1");
}

function assertRuntimeDefaultsCannotEnableSecondaryParse() {
  const text = Array.from({ length: 80 }, (_, index) =>
    `运行时默认句子 ${index + 1} 用于确认 runtimeState 不能替接口默认开启二次解析。`
  ).join(" ");
  const binding = bindDynamicDocumentParsingInvocation({
    sources: [{ id: "source", name: "source.md", mediaType: "text/markdown" }],
    blocks: [{
      id: "block-1",
      sourceId: "source",
      sourceName: "source.md",
      kind: "paragraph",
      text,
      sourceStartLine: 1,
      sourceEndLine: 80,
      headingPath: ["运行时默认"]
    }],
    contextBudget: { knowledgeTokens: 32 },
    payloadBudget: { maxResponseBytes: 262144, maxEvidenceBytes: 2048 }
  }, {
    granularity: {
      secondaryParse: { enabled: true, algorithm: "paragraph-sentence-v1", targetTokens: 8, targetChars: 80 }
    }
  });

  assert.equal(binding.backendTrace.secondaryParse.enabled, false);
  assert.equal(binding.granularityFragments.length, 1);
  assert.equal(binding.granularityFragments[0].granularity, "original-structure");
  assert.equal(binding.granularityFragments[0].text, text);
}

async function assertRuntimeBinding() {
  const runtime = createDocumentParsingRuntime();
  const longParagraph = Array.from({ length: 24 }, (_, index) =>
    `第 ${index + 1} 句描述知识库、工具链、上下文管理与证据锚点，需要被动态二次解析保留。`
  ).join(" ");
  const markdown = [
    "# 动态解析策略",
    "",
    "## 背景",
    longParagraph,
    "",
    "## 表格",
    "| 能力 | 作用 |",
    "| --- | --- |",
    "| structureArtifacts | 保存原始结构 |",
    "| granularityFragments | 生成检索粒度片段 |",
    "",
    "## 代码",
    "```ts",
    "export function bind() {",
    "  return 'dynamic';",
    "}",
    "```"
  ].join("\n");

  const result = await runtime.parseDocuments({
    pipelineId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
    expectedOutputs: ["chunks", "preprocessResult"],
    sources: [{
      id: "dynamic-source",
      name: "dynamic.md",
      path: "dynamic.md",
      kind: "text",
      mediaType: "text/markdown",
      text: markdown,
      contentHash: "sha256:dynamic-source-hash",
      sourceMetadata: {
        page: 2,
        slideIndex: 0,
        sheetName: "Sheet-A",
        bbox: [10, 20, 300, 180]
      },
      rawObject: {
        objectId: "raw-object-1",
        contentHash: "sha256:dynamic-source-hash",
        mediaType: "text/markdown"
      },
      documentMetadata: {
        parserVersion: "2026.06",
        modelId: "layout-model",
        modelVersion: "1.2.3",
        parserTrace: [
          {
            stage: "document-parser.route",
            status: "completed",
            parserId: "mock-markdown-parser",
            parserVersion: "2026.06"
          }
        ]
      },
      documentParserId: "mock-markdown-parser"
    }],
    chunking: { maxTokens: 64, maxChars: 320, sectionLevel: 2 },
    contextBudget: { knowledgeTokens: 64, budgetScope: "verify" },
    payloadBudget: { maxResponseBytes: 262144, maxEvidenceBytes: 1024 },
    granularity: {
      preferOriginalStructure: true,
      allowPartialEvidence: true,
      targetTokens: 64,
      targetChars: 320,
      secondaryParse: { enabled: true, algorithm: "auto", targetTokens: 64, targetChars: 320 }
    },
    documentParsing: {
      dynamicParsing: { enabled: true, preserveStructureArtifacts: true }
    }
  });

  assert.equal(result.pipelineId, DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID);
  assert.equal(result.dynamicParsing.policyId, "dynamic-parameter-document-parsing-policy");
  assert.ok(result.structureArtifacts.length >= 3, "runtime should expose structure artifacts");
  assert.ok(result.granularityFragments.length >= 3, "runtime should expose granularity fragments");
  assert.equal(result.chunks.length, result.granularityFragments.length);
  assert.equal(result.backendTrace.secondaryParse.enabled, true);
  assert.equal(result.payload.truncated, false);
  assert.ok(result.preprocessResult.structureArtifacts.length === result.structureArtifacts.length);
  assert.ok(result.preprocessResult.granularityFragments.length === result.granularityFragments.length);
  assert.ok(result.chunks.every((chunk) => chunk.metadata?.parentArtifactId));
  assert.ok(result.chunks.every((chunk) => chunk.metadata?.fragmentationTrace));
  assert.equal(result.sources[0].contentHash, "sha256:dynamic-source-hash");
  assert.deepEqual(result.sources[0].sourceMetadata?.bbox, [10, 20, 300, 180]);
  assert.equal(result.preprocessResult.sourceTrace["dynamic-source"].sourceMetadataHash.startsWith("sha256:"), true);
  assert.equal(result.preprocessResult.sourceTrace["dynamic-source"].parserTrace[0].stage, "document-parser.route");
  assert.equal(result.preprocessResult.sourceTrace["dynamic-source"].parserTrace[0].parserVersion, "2026.06");
  assert.equal(result.structureArtifacts[0].metadata?.rawObjectId, "raw-object-1");
  assert.equal(result.structureArtifacts[0].metadata?.sourceMetadataHash.startsWith("sha256:"), true);
  assert.deepEqual(result.structureArtifacts[0].metadata?.sourceLocator?.bbox, [10, 20, 300, 180]);
  assert.equal(result.structureArtifacts[0].metadata?.parserTraceRef?.modelVersion, "1.2.3");
}

async function assertRuntimeDefaultBinding() {
  const runtime = createDocumentParsingRuntime();
  const longParagraph = Array.from({ length: 36 }, (_, index) =>
    `第 ${index + 1} 句用于确认统一文档解析入口默认只保留原始结构，不自动触发二次解析。`
  ).join(" ");
  const result = await runtime.parseDocuments({
    pipelineId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
    expectedOutputs: ["chunks", "preprocessResult"],
    sources: [{
      id: "dynamic-source",
      name: "dynamic.md",
      path: "dynamic.md",
      kind: "text",
      mediaType: "text/markdown",
      text: ["# 默认关闭", "", longParagraph].join("\n")
    }],
    chunking: { maxTokens: 32, maxChars: 160, sectionLevel: 2 },
    contextBudget: { knowledgeTokens: 32, budgetScope: "verify" },
    payloadBudget: { maxResponseBytes: 262144, maxEvidenceBytes: 1024 },
    granularity: {
      preferOriginalStructure: true,
      allowPartialEvidence: true,
      targetTokens: 32,
      targetChars: 160
    },
    documentParsing: {
      dynamicParsing: { enabled: true, preserveStructureArtifacts: true }
    }
  });

  assert.equal(result.backendTrace.secondaryParse.enabled, false);
  assert.ok(result.structureArtifacts.length >= 1, "runtime should expose structure artifacts");
  assert.ok(result.granularityFragments.length >= 1, "runtime should expose original structure fragments");
  assert.ok(result.granularityFragments.every((fragment) => fragment.granularity === "original-structure"));
  assert.ok(result.chunks.every((chunk) => chunk.metadata?.materialization?.mode === "structure"));
  assert.ok(result.chunks.every((chunk) => chunk.metadata?.fragmentationTrace?.algorithm === "original-structure-v1"));
}

async function assertMachineReadableFailureReason() {
  const runtime = createDocumentParsingRuntime();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-dynamic-parse-failure-"));
  const pdfPath = path.join(tempRoot, "empty.pdf");
  await fs.writeFile(pdfPath, "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8");

  const emptyParserRuntime = {
    mounts: {
      documentParser: {
        enabled: true,
        id: "test/empty-document-parser",
        async extractDocument() {
          return {
            parserId: "test/empty-document-parser",
            text: "",
            metadata: {},
            warnings: []
          };
        }
      }
    },
    resolveDocumentRoute() {
      return {
        mountName: "documentParser",
        action: "extractDocument",
        matchedBy: "extension"
      };
    }
  };

  await assert.rejects(
    runtime.parseDocuments({
      filePaths: [pdfPath],
      userDataPath: tempRoot,
      runtime: emptyParserRuntime,
      expectedOutputs: ["sources"]
    }),
    (error) => {
      assert.equal(error.reasonCode, "document_parse_no_usable_content");
      assert.ok(Array.isArray(error.failureReasons));
      assert.ok(error.failureReasons.some((item) => item.reasonCode === "pdf_ocr_no_text_extracted"));
      assert.ok(error.failureReasons.every((item) => typeof item.message === "string" && item.message.length > 0));
      return true;
    }
  );
}

async function assertFrontendBinding() {
  const knowledgeView = await read("server-web/views/KnowledgeView.vue");
  const knowledgeIngestPanel = await read("server-web/components/knowledge/KnowledgeIngestPanel.vue");
  const knowledgeViewConsole = await read("server-web/composables/useKnowledgeViewConsole.ts");
  const types = await read("server-web/lib/types.ts");
  const bridge = await read("server-web/lib/bridge.ts");
  const registry = await read("server/platform/common/operation-dispatcher/operation-registry.mjs");
  const packageJson = await read("package.json");

  assert.ok(knowledgeView.includes("KnowledgeIngestPanel"), "KnowledgeView.vue must mount the ingest panel");
  assert.ok(knowledgeView.includes("dynamicParsingPolicySignature"), "KnowledgeView.vue must expose the dynamic parsing policy signature");

  for (const needle of [
    "dynamicParsingPreviewConfig",
    "contextBudget",
    "payloadBudget",
    "granularity",
    "dynamicParsing",
    "structureArtifacts",
    "granularityFragments"
  ]) {
    assert.ok(knowledgeIngestPanel.includes(needle), `KnowledgeIngestPanel.vue must bind ${needle}`);
  }

  for (const needle of [
    "dynamic-parameter-v1",
    "contextBudget",
    "payloadBudget",
    "granularity",
    "secondaryParse",
    "dynamicParsing",
    "structureArtifacts",
    "granularityFragments",
    "parentArtifactId"
  ]) {
    assert.ok(knowledgeViewConsole.includes(needle), `useKnowledgeViewConsole.ts must configure ${needle}`);
  }
  assert.match(
    knowledgeViewConsole,
    /secondaryParse:\s*{\s*enabled:\s*false/,
    "useKnowledgeViewConsole.ts must keep secondary parsing disabled by default"
  );

  for (const [file, text] of [
    ["server-web/lib/types.ts", types],
    ["server-web/lib/bridge.ts", bridge],
    ["server/platform/common/operation-dispatcher/operation-registry.mjs", registry]
  ]) {
    assert.ok(text.includes("contextBudget"), `${file} must expose contextBudget`);
    assert.ok(text.includes("payloadBudget"), `${file} must expose payloadBudget`);
    assert.ok(text.includes("dynamicParsing"), `${file} must expose dynamicParsing`);
  }

  assert.ok(packageJson.includes("server:verify:dynamic-document-parsing"));
}

async function main() {
  assertDispatcherAlgorithms();
  assertInvocationBudgeting();
  assertDefaultInvocationDoesNotSecondaryParse();
  assertRuntimeDefaultsCannotEnableSecondaryParse();
  await assertRuntimeBinding();
  await assertRuntimeDefaultBinding();
  await assertMachineReadableFailureReason();
  await assertFrontendBinding();
  console.log("dynamic document parsing verification passed");
}

await main();
