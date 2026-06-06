import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function listSourceFiles(relativeDir, extensions = new Set([".vue", ".ts", ".tsx", ".js", ".mjs"])) {
  const root = path.join(repoRoot, relativeDir);
  const output = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        output.push(path.relative(repoRoot, absolutePath));
      }
    }
  }
  await visit(root);
  return output.sort();
}

function assertIncludes(text, needle, message) {
  assert.ok(text.includes(needle), message || `Expected source to include ${needle}`);
}

function assertNotIncludes(text, needle, message) {
  assert.equal(text.includes(needle), false, message || `Expected source not to include ${needle}`);
}

function countLiteral(text, needle) {
  return text.split(needle).length - 1;
}

function assertOnlyOccurrences(files, needle, allowedRelativePaths, message) {
  const hits = [];
  for (const file of files) {
    const text = file.text;
    const count = countLiteral(text, needle);
    if (count > 0) {
      hits.push({ path: file.path, count });
    }
  }
  const unexpected = hits.filter((hit) => !allowedRelativePaths.includes(hit.path));
  assert.deepEqual(
    unexpected,
    [],
    `${message}\nUnexpected occurrences: ${unexpected.map((hit) => `${hit.path} x${hit.count}`).join(", ")}`
  );
  return hits;
}

const knowledgeView = await readText("server-web/views/KnowledgeView.vue");
const knowledgeIngestPanel = await readText("server-web/components/knowledge/KnowledgeIngestPanel.vue");
const knowledgeDocuments = await readText("server-web/lib/knowledge-documents.ts");
const knowledgeDocumentsClient = await readText("server-web/lib/knowledge-documents-client.ts");
const useConsole = await readText("server-web/composables/useConsole.ts");
const uploadSession = await readText("server-web/lib/knowledge-upload-session.ts");
const bridge = await readText("server-web/lib/bridge.ts");
const bridgeTypes = await readText("server-web/lib/bridge-types.ts");
const systemController = await readText("server/platform/common/console/http/controllers/system-controller.mjs");
const knowledgeOperationsHandlers = await readText(
  "server/platform/common/console/http/controllers/system-controller-knowledge-operations-handlers.mjs"
);
const consoleDomainExecutor = await readText("server/platform/specialized/console/console-domain-operation-executor.mjs");
const serverWebFiles = await Promise.all(
  (await listSourceFiles("server-web")).map(async (relativePath) => ({
    path: relativePath,
    text: await readText(relativePath)
  }))
);

const parseDocumentHits = assertOnlyOccurrences(
  serverWebFiles,
  "bridge.parseDocument(",
  [],
  "文档解析预览不得回穿全局 bridge；必须经知识文档 domain client。"
);
assert.equal(
  parseDocumentHits.reduce((sum, hit) => sum + hit.count, 0),
  0,
  "前端不得保留 bridge.parseDocument 预览调用点。"
);
assertOnlyOccurrences(
  serverWebFiles,
  "bridge.createUploadSession(",
  [],
  "前端不得回穿全局 bridge 创建上传会话；必须经统一上传模块和 upload-session client。"
);
assertOnlyOccurrences(
  serverWebFiles,
  "sources: [",
  [],
  "前端不得构造 document-parser sources 旁路真实文件解析链路。"
);
assertIncludes(
  knowledgeView,
  "<KnowledgeIngestPanel",
  "知识库文档切分页必须挂载统一入库面板。"
);
assertIncludes(
  knowledgeIngestPanel,
  "previewKnowledgeDocuments",
  "文档切分预览页面必须经统一 helper 进入后端解析运行时。"
);
assertNotIncludes(
  knowledgeIngestPanel,
  "bridge.parseDocument(",
  "文档切分页面组件不能直接调用 bridge.parseDocument。"
);
assertIncludes(
  knowledgeDocuments,
  "parseDocument({",
  "文档预览 helper 必须只通过知识文档 domain client 调用解析入口。"
);
assertIncludes(
  knowledgeDocuments,
  "from \"./knowledge-documents-client\"",
  "文档预览 helper 必须依赖知识文档 domain client。"
);
assertNotIncludes(
  knowledgeDocuments,
  "from \"./bridge\"",
  "文档预览 helper 不能再依赖全局 bridge facade。"
);
assertIncludes(
  knowledgeDocuments,
  "createKnowledgeUploadedFilesPayload",
  "文档切分预览 helper 必须用 uploadedFiles 进入后端解析运行时。"
);
assertNotIncludes(
  knowledgeDocuments,
  "uploadSessionId:",
  "文档切分预览 helper 不能使用持久化 upload session。"
);
assertIncludes(
  knowledgeDocuments,
  "dryRun: true",
  "文档预览必须显式声明 dryRun。"
);
assertIncludes(
  knowledgeDocuments,
  "uploadedFiles,",
  "文档预览必须把文件 payload 交给统一后端解析入口。"
);
assertIncludes(
  useConsole,
  "createKnowledgeUploadSession(filesToUpload",
  "正式入库必须继续使用统一 upload session 创建 job。"
);
assertIncludes(
  uploadSession,
  "createKnowledgeUploadSession",
  "正式入库 upload session 逻辑必须集中在共用模块。"
);
assertIncludes(
  uploadSession,
  "from \"./upload-session-client\"",
  "正式入库 upload session helper 必须依赖 upload-session domain client。"
);
assertNotIncludes(
  uploadSession,
  "from \"./bridge\"",
  "正式入库 upload session helper 不能再依赖全局 bridge facade。"
);
assertIncludes(
  uploadSession,
  "createUploadSession({",
  "正式入库必须继续通过统一 upload session client 创建会话。"
);
assertIncludes(
  uploadSession,
  "createKnowledgeUploadedFilesPayload",
  "预览文件 payload 逻辑必须集中在共用模块。"
);
assertIncludes(
  knowledgeDocumentsClient,
  'postJson<DocumentParseResponse>("/api/knowledge/document-parser/parse", payload)',
  "前端文档预览必须调用统一文档解析 HTTP 入口，且端点归属知识文档 client。"
);
assertIncludes(
  bridge,
  "parseDocument,",
  "bridge facade 必须保留 parseDocument 兼容导出。"
);
assertIncludes(
  bridge,
  "from \"./knowledge-documents-client\"",
  "bridge facade 必须从知识文档 domain client 取得 parseDocument。"
);
assertIncludes(
  bridgeTypes,
  "cleanupUploadSession?: boolean",
  "统一文档解析入口需要支持临时 upload session 清理。"
);
assertIncludes(
  systemController,
  "createSystemControllerKnowledgeOperationsHandlers",
  "后端文档 dry-run handler 必须由主 controller 通过知识操作 handler 模块组合。"
);
assertIncludes(
  knowledgeOperationsHandlers,
  'operationId: operation?.id || "knowledge.document_parse"',
  "后端文档 dry-run 必须通过统一 console domain operation 入口。"
);
assertIncludes(
  consoleDomainExecutor,
  "runtime.parseDocuments",
  "后端文档 dry-run 必须由 specialized executor 调用真实文档解析运行时。"
);
assertIncludes(
  consoleDomainExecutor,
  "dryRun: true",
  "后端文档 dry-run 入口必须强制 dryRun。"
);
assertIncludes(
  consoleDomainExecutor,
  "deleteUploadSession",
  "upload session 形式的 dry-run 预览必须支持清理暂存文件。"
);

console.log("Document preview gate passed.");
