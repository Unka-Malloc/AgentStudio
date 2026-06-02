import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { saveMountConfig } from "../platform/common/module-manager/mount-config.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${rawText}`);
  }

  return JSON.parse(rawText);
}

async function fetchJsonResponse(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

async function waitForCompletedJob(baseUrl, jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = await fetchJson(`${baseUrl}/api/jobs/${jobId}`);

    if (job.status === "completed") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(job.error || "任务失败");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("等待任务完成超时。");
}

function buildUploadedFile(name, relativePath, data, mediaType) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  return {
    name,
    relativePath,
    mediaType,
    dataBase64: buffer.toString("base64"),
    byteSize: buffer.length
  };
}

function buildUploadedEmail(email, relativePath = `mailbox/${email.fileName}`) {
  return buildUploadedFile(email.fileName, relativePath, email.content, "message/rfc822");
}

function buildMinimalPdfBuffer(lines) {
  const escapePdfText = (value) => String(value).replace(/[\\()]/g, "\\$&");
  const textCommands = lines
    .map((line, index) => `${index === 0 ? "100 700 Td" : "0 -24 Td"} (${escapePdfText(line)}) Tj`)
    .join("\n");
  const stream = `BT\n/F1 16 Tf\n${textCommands}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, objectBody] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-server-"));
const mailDir = path.join(userDataPath, "mailbox");
const documentsDir = path.join(userDataPath, "documents");
const incrementalDir = path.join(userDataPath, "mailbox-incremental");
const zipPath = path.join(userDataPath, "mail-archive.zip");
const migrationActiveDataPath = path.join(userDataPath, "migration-active");
const migrationBootstrapDataPath = path.join(userDataPath, "migration-bootstrap");
const mockDocumentParserModulePath = fileURLToPath(
  new URL("../../tests/server/mock-structured-document-parser.mjs", import.meta.url)
);
const mockDocumentParserModuleV2Path = fileURLToPath(
  new URL("../../tests/server/mock-structured-document-parser-v2.mjs", import.meta.url)
);
const mockMultimodalParserModulePath = fileURLToPath(
  new URL("../../tests/server/mock-multimodal-parser.mjs", import.meta.url)
);
const mockSourceCodeAgentModulePath = fileURLToPath(
  new URL("../../tests/server/mock-source-code-agent-parser.mjs", import.meta.url)
);
const mockAnalysisModulePath = fileURLToPath(
  new URL("../../tests/server/mock-analysis-engine.mjs", import.meta.url)
);
const pactCliPath = fileURLToPath(new URL("./pact.mjs", import.meta.url));
const pactServer = await startHttpServer({
  userDataPath,
  host: "127.0.0.1",
  port: 0,
  runtimeOptions: {
    mountModules: {
      documentParser: mockDocumentParserModulePath,
      multimodalParser: mockMultimodalParserModulePath,
      sourceCodeAgent: mockSourceCodeAgentModulePath,
      analysis: mockAnalysisModulePath
    }
  }
});
const pactAuth = await installAuthenticatedFetch(pactServer);
let minimalServer = null;
let migrationActiveServer = null;
let migrationBootstrapServer = null;

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pactCliPath, ...args], {
      cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8").trim();
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`CLI failed: ${stderrText || stdoutText}`));
        return;
      }
      resolve(stdoutText);
    });
  });
}

try {
  await fs.mkdir(mailDir, { recursive: true });
  await fs.mkdir(documentsDir, { recursive: true });
  await fs.mkdir(incrementalDir, { recursive: true });

  const emails = [
    {
      fileName: "contract-kickoff.eml",
      mtime: "2025-12-11T09:00:00.000Z",
      content: [
        "From: Alice Chen <alice@contoso.com>",
        "To: Bob Li <bob@contoso.com>, Cathy Wu <cathy@vendor.io>",
        "Cc: Finance Desk <finance@contoso.com>",
        "Subject: 合同续签推进",
        "Date: Fri, 11 Dec 2025 09:00:00 +0000",
        "Message-ID: <contract-kickoff@contoso.com>",
        "",
        "我们需要在本周内完成供应商合同续签。",
        "请 Bob 核对预算条目，Cathy 补充最新报价。",
        "当前待确认事项包括盖章顺序和发票抬头。"
      ].join("\n")
    },
    {
      fileName: "contract-decision.eml",
      mtime: "2026-04-18T10:30:00.000Z",
      content: [
        "From: Bob Li <bob@contoso.com>",
        "To: Alice Chen <alice@contoso.com>, Cathy Wu <cathy@vendor.io>",
        "Cc: Finance Desk <finance@contoso.com>",
        "Subject: Re: 合同续签推进",
        "Date: Sat, 18 Apr 2026 10:30:00 +0000",
        "Message-ID: <contract-decision@contoso.com>",
        "In-Reply-To: <contract-kickoff@contoso.com>",
        "References: <contract-kickoff@contoso.com>",
        "",
        "预算已经确认，按最新报价执行。",
        "决定由 Finance Desk 先走审批，然后 Alice 安排盖章。",
        "合同条款没有争议，但发票抬头还需要 Cathy 最终确认。"
      ].join("\n")
    },
    {
      fileName: "invoice-check.eml",
      mtime: "2026-04-18T12:00:00.000Z",
      content: [
        "From: Cathy Wu <cathy@vendor.io>",
        "To: Alice Chen <alice@contoso.com>, Finance Desk <finance@contoso.com>",
        "Subject: 开票信息核对",
        "Date: Sat, 18 Apr 2026 12:00:00 +0000",
        "",
        "关于供应商续约，目前还差开票信息最终核对。",
        "请 Finance Desk 确认抬头字段，Alice 收到后继续推进合同盖章。"
      ].join("\n")
    },
    {
      fileName: "archive-followup.eml",
      mtime: "2024-01-15T08:10:00.000Z",
      content: [
        "From: Dana Xu <dana@contoso.com>",
        "To: Emily Sun <emily@contoso.com>",
        "Subject: 培训资料归档",
        "Date: Mon, 15 Jan 2024 08:10:00 +0000",
        "",
        "培训资料已经归档到共享盘。",
        "旧版本仅供历史参考，后续如需对外分发，请先核对目录和版本号。"
      ].join("\n")
    },
    {
      fileName: "legal-seal-schedule.eml",
      mtime: "2026-04-19T09:15:00.000Z",
      content: [
        "From: Alice Chen <alice@contoso.com>",
        "To: Legal Desk <legal@contoso.com>",
        "Cc: Finance Desk <finance@contoso.com>",
        "Subject: 法务盖章排期确认",
        "Date: Sun, 19 Apr 2026 09:15:00 +0000",
        "",
        "合同盖章需要和法务排期确认。",
        "Finance Desk 需要同步审批完成时间，避免和用印窗口冲突。",
        "这条线和合同续签事务前后相接，但属于独立排期事项。"
      ].join("\n")
    },
    {
      fileName: "weekly-report.eml",
      mtime: "2026-04-17T08:00:00.000Z",
      content: [
        "From: PMO Team <pmo@contoso.com>",
        "To: Alice Chen <alice@contoso.com>, Bob Li <bob@contoso.com>",
        "Cc: Steering Group <steering@contoso.com>",
        "Subject: 供应商整治周报",
        "Date: Fri, 17 Apr 2026 08:00:00 +0000",
        "",
        "本周供应商整治周报：",
        "1. 合同续签已推进到审批环节。",
        "2. 报价确认已完成。",
        "3. 仍待 Cathy 确认发票抬头。"
      ].join("\n")
    }
  ];
  const bundledWeeklyEmail = emails.find((item) => item.fileName === "weekly-report.eml");
  assert.ok(bundledWeeklyEmail);
  const mailDirEmails = emails.filter((item) => item.fileName !== "weekly-report.eml");

  for (const email of mailDirEmails) {
    const filePath = path.join(mailDir, email.fileName);
    await fs.writeFile(filePath, email.content, "utf8");
    await fs.utimes(filePath, new Date(email.mtime), new Date(email.mtime));
  }

  await fs.writeFile(
    zipPath,
    Buffer.from(
      zipSync({
        "reports/weekly-report.eml": strToU8(bundledWeeklyEmail.content)
      })
    )
  );
  await fs.utimes(
    zipPath,
    new Date("2026-04-17T08:00:00.000Z"),
    new Date("2026-04-17T08:00:00.000Z")
  );
  const initialUploadedFiles = [
    ...mailDirEmails.map((email) => buildUploadedEmail(email)),
    buildUploadedEmail(bundledWeeklyEmail, "reports/weekly-report.eml")
  ];

  const roadmapPath = path.join(documentsDir, "product-roadmap.pptx");
  const whitepaperPath = path.join(documentsDir, "security-whitepaper.pdf");
  const kbPagePath = path.join(documentsDir, "kb-page.html");
  const notePath = path.join(documentsDir, "general-note.docx");
  const roadmapBuffer = Buffer.from(
    zipSync({
      "ppt/slides/slide1.xml": strToU8([
        "Slide 1",
        "产品路线图",
        "第一阶段完成客户导入。",
        "",
        "Slide 2",
        "目录",
        "1. 账号体系",
        "2. 数据归一化",
        "",
        "Slide 3",
        "数据归一化",
        "PPT 转 DOCX 多颗粒度覆盖。"
      ].join("\n"))
    })
  );
  await fs.writeFile(roadmapPath, roadmapBuffer);
  const whitepaperBuffer = buildMinimalPdfBuffer([
    "Page 1 Security Whitepaper",
    "Permission model",
    "Page 2 Audit Log",
    "Page 3 Retrieval Policy"
  ]);
  await fs.writeFile(whitepaperPath, whitepaperBuffer);
  await fs.writeFile(
    kbPagePath,
    [
      "<html><head><title>知识库页面</title></head><body>",
      "<h1>知识库页面</h1>",
      "<h2>接入步骤</h2>",
      "<p>第一步上传原始材料。</p>",
      "<h2>归一化输出</h2>",
      "<p>第二步生成多颗粒度 DOCX。</p>",
      "</body></html>"
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    notePath,
    [
      "通用说明文档",
      "",
      "这份文档用于验证非 PPT/PDF/HTML 材料会生成 document 粒度。"
    ].join("\n"),
    "utf8"
  );
  const mixedDocumentUploadedFiles = [
    buildUploadedFile(
      "product-roadmap.pptx",
      "documents/product-roadmap.pptx",
      await fs.readFile(roadmapPath),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ),
    buildUploadedFile(
      "security-whitepaper.pdf",
      "documents/security-whitepaper.pdf",
      await fs.readFile(whitepaperPath),
      "application/pdf"
    ),
    buildUploadedFile(
      "kb-page.html",
      "documents/kb-page.html",
      await fs.readFile(kbPagePath),
      "text/html"
    ),
    buildUploadedFile(
      "general-note.docx",
      "documents/general-note.docx",
      await fs.readFile(notePath),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
  ];

  const health = await fetchJson(`${pactServer.url}/api/healthz`);
  assert.equal(health.ok, true);

  const rootInfo = await fetchJson(`${pactServer.url}/`);
  assert.equal(rootInfo.service, "Pact Server");

  const cliHealth = JSON.parse(
    await runCli(["--server-url", pactServer.url, "health"])
  );
  assert.equal(cliHealth.ok, true);
  const cliRpcHealth = JSON.parse(
    await runCli([
      "rpc",
      "--server-url",
      pactServer.url,
      "--method",
      "GET",
      "--path",
      "/api/healthz"
    ])
  );
  assert.equal(cliRpcHealth.ok, true);
  const interfaceCatalog = await fetchJson(`${pactServer.url}/api/interfaces`);
  assert.equal(interfaceCatalog.transport.rpc, "POST /api/rpc");
  assert.ok(interfaceCatalog.interfaces.some((item) => item.id === "jobs.create"));
  assert.equal(interfaceCatalog.interfaces.some((item) => item.id === "exports.create"), false);
  const legacyExportEndpoint = await fetch(`${pactServer.url}/api/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(legacyExportEndpoint.status, 404);
  const rpcHealth = await fetchJson(`${pactServer.url}/api/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "health",
      method: "system.health",
      params: {}
    })
  });
  assert.equal(rpcHealth.id, "health");
  assert.equal(rpcHealth.result.ok, true);
  const cliServerRpcHealth = JSON.parse(
    await runCli([
      "rpc-call",
      "--server-url",
      pactServer.url,
      "system.health"
    ])
  );
  assert.equal(cliServerRpcHealth.result.ok, true);
  const cliRpcJobs = JSON.parse(
    await runCli([
      "rpc-call",
      "--server-url",
      pactServer.url,
      "jobs.list",
      "--params",
      JSON.stringify({ limit: 5 })
    ])
  );
  assert.ok(Array.isArray(cliRpcJobs.result.items));

  const cliUploadPath = path.join(userDataPath, "cli-upload.eml");
  const cliResultPath = path.join(userDataPath, "cli-upload-result.json");
  await fs.writeFile(
    cliUploadPath,
    [
      "From: CLI Runner <cli@contoso.com>",
      "To: Ops Desk <ops@contoso.com>",
      "Subject: CLI 上传验证",
      "Date: Mon, 27 Apr 2026 10:00:00 +0000",
      "Message-ID: <cli-upload@contoso.com>",
      "",
      "这封邮件用于验证 pact --file 能通过上传会话提交任务。"
    ].join("\n"),
    "utf8"
  );
  await runCli([
    "--server-url",
    pactServer.url,
    "--file",
    cliUploadPath,
    "--wait",
    "--output-result",
    cliResultPath,
    "--settings",
    JSON.stringify({
      retrievalHalfLifeDays: 45,
      staleAfterDays: 180,
      transactionWindowDays: 45,
      ocrEnabled: false
    })
  ]);
  const cliUploadedResult = JSON.parse(await fs.readFile(cliResultPath, "utf8"));
  assert.equal(cliUploadedResult.sourceFiles.length, 1);
  assert.equal(cliUploadedResult.sourceFiles[0].kind, "email");

  const rulesInfo = await fetchJson(`${pactServer.url}/api/email-rules`);
  assert.ok(rulesInfo.path.endsWith("rules/email-rules.json"));
  assert.ok(rulesInfo.rules.reportSeries.length >= 2);
  await fs.access(rulesInfo.path);

  const vocabularyInfo = await fetchJson(`${pactServer.url}/api/expert-vocabulary`);
  assert.ok(vocabularyInfo.path.endsWith("rules/expert-vocabulary.json"));
  assert.ok(vocabularyInfo.vocabulary.version >= 1);
  assert.ok(vocabularyInfo.vocabulary.entries.length >= 20);
  assert.ok(vocabularyInfo.vocabulary.checksum);
  await fs.access(vocabularyInfo.path);

  const taxonomyInfo = await fetchJson(`${pactServer.url}/api/knowledge-taxonomy`);
  assert.ok(taxonomyInfo.path.endsWith("rules/knowledge-taxonomy.json"));
  assert.ok(taxonomyInfo.taxonomy.version >= 1);
  assert.ok(taxonomyInfo.taxonomy.categories.length >= 20);
  assert.ok(taxonomyInfo.taxonomy.checksum);
  assert.ok(taxonomyInfo.guidance.categoryCount >= taxonomyInfo.taxonomy.categories.length);
  assert.ok(taxonomyInfo.guidance.expertVocabularyPath.endsWith("rules/expert-vocabulary.json"));
  assert.ok(taxonomyInfo.guidance.emailRulesPath.endsWith("rules/email-rules.json"));
  await fs.access(taxonomyInfo.path);

  const consoleState = await fetchJson(`${pactServer.url}/api/console/state`);
  assert.equal(consoleState.server.url, pactServer.url);
  assert.equal(consoleState.runtime.profile, "default");
  assert.ok(consoleState.settings.path.endsWith("settings.json"));
  assert.ok(consoleState.discovery.path.endsWith("discovery.json"));
  assert.ok(consoleState.emailRules.path.endsWith("rules/email-rules.json"));
  assert.ok(consoleState.expertVocabulary.path.endsWith("rules/expert-vocabulary.json"));
  assert.ok(consoleState.knowledgeTaxonomy.path.endsWith("rules/knowledge-taxonomy.json"));
  assert.equal(
    consoleState.expertVocabulary.vocabulary.checksum,
    vocabularyInfo.vocabulary.checksum
  );
  assert.equal(
    consoleState.knowledgeTaxonomy.taxonomy.checksum,
    taxonomyInfo.taxonomy.checksum
  );
  assert.equal(
    consoleState.knowledgeTaxonomy.guidance.checksum,
    taxonomyInfo.guidance.checksum
  );
  assert.ok(Array.isArray(consoleState.runtime.mounts));
  assert.ok(Array.isArray(consoleState.runtime.analysisModules));
  assert.ok(
    consoleState.runtime.analysisModules.some((item) => item.id === "mock:hybrid-module")
  );
  assert.ok(Array.isArray(consoleState.jobs.items));
  assert.ok(Array.isArray(consoleState.clients.items));

  const runtimeMountsBeforeSwitch = await fetchJson(`${pactServer.url}/api/runtime/mounts`);
  assert.ok(runtimeMountsBeforeSwitch.path.endsWith("mount-modules.json"));
  assert.ok(runtimeMountsBeforeSwitch.paths.modulesPath.endsWith("mount-modules.json"));
  assert.ok(runtimeMountsBeforeSwitch.paths.routingPath.endsWith("mount-routing.json"));
  assert.equal(
    runtimeMountsBeforeSwitch.runtime.mounts.find((item) => item.name === "documentParser")?.id,
    "test/mock-structured-document-parser"
  );

  const rejectedMountSwitch = await fetchJsonResponse(`${pactServer.url}/api/runtime/mounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mountModules: {
        documentParser: path.join(userDataPath, "missing-document-parser.mjs")
      }
    })
  });
  assert.equal(rejectedMountSwitch.status, 400);
  assert.equal(rejectedMountSwitch.payload.ok, false);
  const runtimeMountsAfterRejectedSwitch = await fetchJson(`${pactServer.url}/api/runtime/mounts`);
  assert.equal(
    runtimeMountsAfterRejectedSwitch.runtime.mounts.find((item) => item.name === "documentParser")?.id,
    "test/mock-structured-document-parser"
  );
  assert.notEqual(
    runtimeMountsAfterRejectedSwitch.value.mountModules.documentParser,
    path.join(userDataPath, "missing-document-parser.mjs")
  );

  const acceptedMountSwitch = await fetchJson(`${pactServer.url}/api/runtime/mounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mountModules: {
        documentParser: mockDocumentParserModuleV2Path
      }
    })
  });
  assert.equal(acceptedMountSwitch.value.mountModules.documentParser, mockDocumentParserModuleV2Path);

  await saveMountConfig(userDataPath, {
    mountModules: {
      documentParser: mockDocumentParserModuleV2Path,
      multimodalParser: mockMultimodalParserModulePath,
      analysis: mockAnalysisModulePath
    }
  });
  const switchedMounts = await fetchJson(`${pactServer.url}/api/runtime/mounts/reload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(switchedMounts.value.mountModules.documentParser, mockDocumentParserModuleV2Path);

  const runtimeMountsAfterSwitch = await fetchJson(`${pactServer.url}/api/runtime/mounts`);
  assert.equal(
    runtimeMountsAfterSwitch.runtime.mounts.find((item) => item.name === "documentParser")?.id,
    "test/mock-structured-document-parser-v2"
  );
  assert.ok((runtimeMountsAfterSwitch.runtime.mountGeneration || 0) >= 2);

  const switchedParserMail = [
    "From: Alice Chen <alice@contoso.com>",
    "To: Bob Li <bob@contoso.com>",
    "Subject: 挂载切换验证",
    "Date: Fri, 18 Apr 2026 08:00:00 +0000",
    "",
    "需要确认 documentParser 热切换后，新任务立即走新挂载。"
  ].join("\n");
  const switchedParserJob = await fetchJson(`${pactServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uploadedFiles: [
        {
          name: "switch-check.eml",
          relativePath: "mailbox/switch-check.eml",
          mediaType: "message/rfc822",
          dataBase64: Buffer.from(switchedParserMail, "utf8").toString("base64"),
          byteSize: Buffer.byteLength(switchedParserMail, "utf8")
        }
      ],
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });
  await waitForCompletedJob(pactServer.url, switchedParserJob.id);
  const switchedParserResult = await fetchJson(
    `${pactServer.url}/api/jobs/${switchedParserJob.id}/result`
  );
  assert.equal(
    switchedParserResult.sourceFiles[0].documentParserId,
    "test/mock-structured-document-parser-v2"
  );

  const reloadedMounts = await fetchJson(`${pactServer.url}/api/runtime/mounts/reload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(reloadedMounts.ok, true);

  const imageRouteSwitch = await fetchJson(`${pactServer.url}/api/runtime/mounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mountRouting: {
        extensionRoutes: {
          ".png": {
            mountName: "multimodalParser",
            action: "extractDocument"
          }
        }
      }
    })
  });
  assert.equal(
    imageRouteSwitch.runtime.mountRouting.extensionRoutes[".png"].mountName,
    "multimodalParser"
  );

  const imageRouteInfo = await fetchJson(`${pactServer.url}/api/runtime/info`);
  assert.equal(
    imageRouteInfo.runtime.mountRouting.extensionRoutes[".png"].mountName,
    "multimodalParser"
  );

  const rejectedRouteSwitch = await fetchJsonResponse(`${pactServer.url}/api/runtime/mounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mountRouting: {
        extensionRoutes: {
          ".badroute": {
            mountName: "multimodalParser",
            action: "missingCapability"
          }
        }
      }
    })
  });
  assert.equal(rejectedRouteSwitch.status, 400);
  assert.equal(rejectedRouteSwitch.payload.ok, false);
  const runtimeMountsAfterRejectedRoute = await fetchJson(`${pactServer.url}/api/runtime/mounts`);
  assert.equal(runtimeMountsAfterRejectedRoute.runtime.mountRouting.extensionRoutes[".badroute"], undefined);
  assert.equal(runtimeMountsAfterRejectedRoute.value.mountRouting.extensionRoutes[".badroute"], undefined);

  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0x04]);
  const imageJob = await fetchJson(`${pactServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uploadedFiles: [
        {
          name: "route-check.png",
          relativePath: "images/route-check.png",
          mediaType: "image/png",
          dataBase64: imageBytes.toString("base64"),
          byteSize: imageBytes.length
        }
      ],
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });
  await waitForCompletedJob(pactServer.url, imageJob.id);
  const imageResult = await fetchJson(`${pactServer.url}/api/jobs/${imageJob.id}/result`);
  assert.equal(imageResult.sourceFiles[0].kind, "image");
  assert.equal(imageResult.sourceFiles[0].documentParserId, "test/mock-multimodal-parser");
  assert.match(imageResult.sourceFiles[0].text, /^\[multimodal\]/);

  await saveMountConfig(userDataPath, {
    mountModules: {
      sourceCodeAgent: mockSourceCodeAgentModulePath
    },
    mountRouting: {
      extensionRoutes: {
        ".py": {
          mountName: "sourceCodeAgent",
          action: "extractDocument"
        }
      }
    }
  });
  const customMountSwitch = await fetchJson(`${pactServer.url}/api/runtime/mounts/reload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(
    customMountSwitch.runtime.mountModules.sourceCodeAgent,
    mockSourceCodeAgentModulePath
  );
  assert.equal(
    customMountSwitch.runtime.mountRouting.extensionRoutes[".py"].mountName,
    "sourceCodeAgent"
  );

  const runtimeMountsWithCustomAgent = await fetchJson(`${pactServer.url}/api/runtime/mounts`);
  assert.equal(
    runtimeMountsWithCustomAgent.runtime.mounts.find((item) => item.name === "sourceCodeAgent")?.id,
    "test/mock-source-code-agent-parser"
  );

  const pythonScript = [
    "def parse_contract_status(records):",
    "    pending = [item for item in records if item.get('status') != 'done']",
    "    return pending"
  ].join("\n");
  const pythonJob = await fetchJson(`${pactServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uploadedFiles: [
        {
          name: "sample.py",
          relativePath: "scripts/sample.py",
          mediaType: "text/x-python",
          dataBase64: Buffer.from(pythonScript, "utf8").toString("base64"),
          byteSize: Buffer.byteLength(pythonScript, "utf8")
        }
      ],
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });
  await waitForCompletedJob(pactServer.url, pythonJob.id);
  const pythonResult = await fetchJson(`${pactServer.url}/api/jobs/${pythonJob.id}/result`);
  assert.equal(pythonResult.sourceFiles[0].kind, "text");
  assert.equal(
    pythonResult.sourceFiles[0].documentParserId,
    "test/mock-source-code-agent-parser"
  );
  assert.match(pythonResult.sourceFiles[0].text, /^\[agent-code\]/);

  const savedRulesInfo = await fetchJson(`${pactServer.url}/api/email-rules`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      rules: {
        synonymDictionary: [
          {
            canonical: "合同续签",
            terms: ["合同续签", "合同续约", "续签", "续约", "供应商续约"]
          },
          {
            canonical: "开票信息",
            terms: ["开票信息", "发票抬头", "发票信息", "开票抬头"]
          },
          {
            canonical: "盖章",
            terms: ["盖章", "用印", "印章", "印章流转"]
          }
        ],
        departmentDictionary: [
          {
            department: "财务部",
            keywords: ["Finance Desk"],
            emailKeywords: ["finance@contoso.com"]
          }
        ]
      }
    })
  });
  assert.ok(
    savedRulesInfo.rules.departmentDictionary.some(
      (item) => item.department === "财务部"
    )
  );
  const savedVocabularyInfo = await fetchJson(`${pactServer.url}/api/expert-vocabulary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vocabulary: {
        entries: [
          ...vocabularyInfo.vocabulary.entries,
          {
            pathSegments: ["测试", "专家", "人工校验"],
            keywords: ["human review", "专家校验"],
            domains: ["example.org"],
            status: "active",
            notes: "verification seed"
          }
        ]
      }
    })
  });
  assert.equal(savedVocabularyInfo.vocabulary.version, vocabularyInfo.vocabulary.version + 1);
  assert.notEqual(savedVocabularyInfo.vocabulary.checksum, vocabularyInfo.vocabulary.checksum);
  assert.ok(
    savedVocabularyInfo.vocabulary.entries.some(
      (item) => item.pathSegments.join("/") === "测试/专家/人工校验"
    )
  );
  const vocabularyVersions = await fetchJson(`${pactServer.url}/api/expert-vocabulary/versions`);
  assert.ok(
    vocabularyVersions.history.some((item) => item.version === vocabularyInfo.vocabulary.version)
  );
  const savedSettings = await fetchJson(`${pactServer.url}/api/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      analysisModuleId: "mock:agent-only-module"
    })
  });
  assert.equal(savedSettings.analysisModuleId, "mock:agent-only-module");

  const createdJob = await fetchJson(`${pactServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: "",
      filePaths: [],
      uploadedFiles: initialUploadedFiles,
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });

  assert.equal(typeof createdJob.id, "string");
  assert.equal(typeof createdJob.archiveBatchId, "string");

  const completedJob = await waitForCompletedJob(pactServer.url, createdJob.id);
  assert.equal(completedJob.status, "completed");

  const result = await fetchJson(
    `${pactServer.url}/api/jobs/${createdJob.id}/result`
  );
  assert.equal(result.analysisRuntime.moduleId, "mock:agent-only-module");
  assert.equal(result.analysisRuntime.moduleSource, "tests/server/mock-analysis-engine");
  assert.equal(result.analysisRuntime.executionMode, "agent-only");
  assert.ok(
    result.analysisRuntime.availableModules.some(
      (item) => item.id === "builtin:heuristic-hybrid-v1"
    )
  );
  assert.ok(result.overview.summary.includes("[mock:agent-only-module]"));

  assert.equal(result.batchId, createdJob.archiveBatchId);
  assert.equal(result.jobId, createdJob.id);
  assert.equal(Object.hasOwn(result, "cloudParsing"), false);
  assert.equal(Object.hasOwn(result, "chunks"), false);
  assert.equal(result.overview.emailCount, 6);
  assert.equal(result.emails.length, 6);
  assert.ok(result.threads.length >= 2);
  assert.ok(result.transactions.length >= 2);
  assert.ok(result.people.length >= 4);
  assert.ok(result.timeline.length >= 3);
  assert.ok(result.network.nodes.length > 0);
  assert.ok(result.network.edges.length > 0);
  assert.ok(result.associations.summary.totalCount > 0);
  assert.ok(result.associations.items.length > 0);
  assert.ok(
    result.associations.items.some(
      (item) => item.relationTypes.includes("same-topic") || item.relationTypes.includes("same-people")
    )
  );
  assert.ok(result.retrieval.items.length > 0);
  assert.ok(result.retrieval.reviewQueue.length > 0);
  assert.ok(result.overview.currentCount > 0);
  assert.ok(result.overview.historicalCount > 0);
  assert.ok(result.lifecycle.newCount > 0);
  assert.equal(result.normalizedDocuments.packageType, "pact.normalized-documents");
  assert.ok(
    result.normalizedDocuments.documents.some((item) => item.granularity === "message")
  );
  assert.ok(
    result.normalizedDocuments.documents.some((item) => item.granularity === "thread")
  );
  assert.ok(
    result.normalizedDocuments.documents.some((item) => item.granularity === "transaction")
  );
  assert.equal(
    result.normalizedDocuments.sourceMaterials.some((item) => item.relativePath.endsWith(".eml")),
    false
  );
  assert.equal(
    result.normalizedDocuments.documents.some((item) => item.relativePath.endsWith(".md")),
    false
  );

  const contractTransaction = result.transactions.find((item) =>
    item.title.includes("合同续签")
  );
  assert.ok(contractTransaction);
  assert.ok(contractTransaction.pendingItems.length > 0);
  assert.ok(contractTransaction.categories.includes("multi-source"));
  assert.ok(contractTransaction.categories.includes("ongoing"));
  assert.ok(contractTransaction.threadIds.length >= 2);
  assert.ok(contractTransaction.sourceDepartments.includes("财务部"));

  const alice = result.people.find((item) => item.name.includes("Alice"));
  assert.ok(alice);
  assert.ok(alice.transactionCount > 0);

  const financeDesk = result.people.find((item) => item.name.includes("Finance Desk"));
  assert.ok(financeDesk);
  assert.equal(financeDesk.primaryDepartment, "财务部");

  const weeklyTransaction = result.transactions.find(
    (item) =>
      item.cadence === "weekly" &&
      item.normalizedSubject === "供应商整治周报"
  );
  assert.ok(weeklyTransaction);
  assert.equal(typeof weeklyTransaction.lineageId, "string");
  assert.ok(weeklyTransaction.lineageId.length > 0);
  assert.equal(weeklyTransaction.lifecycle.stage, "new");

  const nextWeeklyEmail = {
    fileName: "weekly-report-next.eml",
    mtime: "2026-04-24T08:00:00.000Z",
    content: [
      "From: PMO Team <pmo@contoso.com>",
      "To: Alice Chen <alice@contoso.com>, Bob Li <bob@contoso.com>",
      "Cc: Steering Group <steering@contoso.com>",
      "Subject: 供应商整治周报",
      "Date: Fri, 24 Apr 2026 08:00:00 +0000",
      "",
      "本周供应商整治周报：",
      "1. 财务审批已经完成。",
      "2. Cathy 已补充开票信息，合同进入盖章排期。",
      "3. 下周继续跟踪合同回传。"
    ].join("\n")
  };
  const nextWeeklyPath = path.join(incrementalDir, nextWeeklyEmail.fileName);
  await fs.writeFile(nextWeeklyPath, nextWeeklyEmail.content, "utf8");
  await fs.utimes(
    nextWeeklyPath,
    new Date(nextWeeklyEmail.mtime),
    new Date(nextWeeklyEmail.mtime)
  );
  const switchedBackSettings = await fetchJson(`${pactServer.url}/api/settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      analysisModuleId: "builtin:heuristic-hybrid-v1"
    })
  });
  assert.equal(switchedBackSettings.analysisModuleId, "builtin:heuristic-hybrid-v1");

  const followupJob = await fetchJson(`${pactServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: "",
      filePaths: [],
      uploadedFiles: [buildUploadedEmail(nextWeeklyEmail, `incremental/${nextWeeklyEmail.fileName}`)],
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });
  const followupCompletedJob = await waitForCompletedJob(
    pactServer.url,
    followupJob.id
  );
  assert.equal(followupCompletedJob.status, "completed");
  const followupResult = await fetchJson(
    `${pactServer.url}/api/jobs/${followupJob.id}/result`
  );
  assert.equal(followupResult.analysisRuntime.moduleId, "builtin:heuristic-hybrid-v1");
  assert.equal(followupResult.analysisRuntime.moduleSource, "builtin");
  assert.equal(followupResult.analysisRuntime.executionMode, "hybrid");
  const resumedWeeklyTransaction = followupResult.transactions.find(
    (item) =>
      item.cadence === "weekly" &&
      item.normalizedSubject === "供应商整治周报"
  );
  assert.ok(resumedWeeklyTransaction);
  assert.equal(resumedWeeklyTransaction.lineageId, weeklyTransaction.lineageId);
  assert.ok(["matched", "recovered"].includes(resumedWeeklyTransaction.lifecycle.stage));
  assert.equal(resumedWeeklyTransaction.lifecycle.matchedBatchId, createdJob.archiveBatchId);
  assert.ok(resumedWeeklyTransaction.lifecycle.pulledEventCount > 0);
  assert.ok(followupResult.lifecycle.pulledEventCount > 0);
  assert.ok(
    (followupResult.lifecycle.matchedCount || 0) +
      (followupResult.lifecycle.recoveredCount || 0) >
      0
  );
  assert.ok(
    followupResult.timeline.some(
      (event) =>
        event.timelinePhase === "history" &&
        event.originBatchId === createdJob.archiveBatchId &&
        event.lineageId === weeklyTransaction.lineageId
    )
  );
  assert.ok(
    followupResult.timeline.some(
      (event) =>
        event.timelinePhase === "current" &&
        event.lineageId === weeklyTransaction.lineageId
    )
  );

  const latestTimeline = [...result.timeline].sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp)
  )[0];
  assert.equal(latestTimeline.timestamp, "2026-04-19T09:15:00.000Z");

  const historicalEmail = result.emails.find(
    (item) => item.subject === "培训资料归档"
  );
  const currentEmail = result.emails.find((item) =>
    item.subject.includes("合同续签")
  );
  assert.ok(historicalEmail);
  assert.ok(currentEmail);
  assert.ok(currentEmail.timeWeight > historicalEmail.timeWeight);
  assert.ok(
    result.emails.some((item) => item.previousMessageIds.length > 0)
  );
  assert.ok(
    result.emails.every((item) => typeof item.rawObjectId === "string" && item.rawObjectId.length > 0)
  );
  assert.ok(
    result.emails.every(
      (item) => typeof item.rawObjectSha256 === "string" && item.rawObjectSha256.length === 64
    )
  );
  assert.ok(
    result.sourceFiles.every(
      (item) =>
        typeof item.rawObjectSha256 === "string" &&
        item.rawObjectSha256.length === 64 &&
        typeof item.documentParserId === "string" &&
        item.documentParserId.length > 0 &&
        typeof item.rawObjectByteSize === "number" &&
        item.rawObjectByteSize > 0
    )
  );
  assert.ok(
    result.retrieval.searchPreview.every(
      (item) => item.entityType === "transaction" || item.entityType === "person"
    )
  );

  const storageSummary = await fetchJson(`${pactServer.url}/api/storage/summary`);
  assert.ok(storageSummary.databasePath.endsWith("metadata/pact.sqlite"));
  assert.ok(storageSummary.objectRootPath.endsWith("objects"));
  assert.ok(storageSummary.batchCount >= 2);
  assert.ok(storageSummary.rawObjectCount >= 7);
  assert.ok(storageSummary.lineageCount >= 2);
  assert.ok(storageSummary.lineageRunCount >= result.transactions.length + 1);
  await fs.access(storageSummary.databasePath);

  const searchResult = await fetchJson(
    `${pactServer.url}/api/search?q=${encodeURIComponent("开票信息")}&limit=5&formalOnly=1`
  );
  assert.ok(searchResult.items.length > 0);
  assert.ok(
    searchResult.items.some(
      (item) =>
        item.entityType === "message" &&
        item.title.includes("开票信息")
    )
  );

  const weeklyEmail = result.emails.find((item) => item.subject.includes("周报"));
  assert.ok(weeklyEmail);
  const weeklyDownload = await fetch(
    `${pactServer.url}/api/raw-objects/${encodeURIComponent(weeklyEmail.rawObjectId)}`
  );
  assert.equal(weeklyDownload.ok, true);
  assert.match(
    weeklyDownload.headers.get("content-disposition") || "",
    /^attachment; filename="weekly-report\.eml"(?:; filename\*=UTF-8''weekly-report\.eml)?$/
  );
  assert.equal(await weeklyDownload.text(), bundledWeeklyEmail.content);

  const mixedDocumentJob = await fetchJson(`${pactServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: "",
      filePaths: [],
      uploadedFiles: mixedDocumentUploadedFiles,
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });
  await waitForCompletedJob(pactServer.url, mixedDocumentJob.id);
  const mixedDocumentResult = await fetchJson(
    `${pactServer.url}/api/jobs/${mixedDocumentJob.id}/result`
  );
  assert.equal(Object.hasOwn(mixedDocumentResult, "cloudParsing"), false);
  assert.equal(Object.hasOwn(mixedDocumentResult, "chunks"), false);
  const normalizedManifest = mixedDocumentResult.normalizedDocuments;
  assert.equal(normalizedManifest.packageType, "pact.normalized-documents");
  assert.ok(normalizedManifest.documents.some((item) => item.granularity === "deck"));
  assert.ok(normalizedManifest.documents.some((item) => item.granularity === "slide"));
  assert.ok(normalizedManifest.documents.some((item) => item.granularity === "section"));
  assert.ok(normalizedManifest.documents.some((item) => item.granularity === "page"));
  assert.ok(normalizedManifest.documents.some((item) => item.granularity === "block"));
  assert.ok(normalizedManifest.documents.some((item) => item.granularity === "source"));
  assert.equal(normalizedManifest.documents.some((item) => item.relativePath.endsWith(".md")), false);
  assert.ok(normalizedManifest.sourceMaterials.length >= 2);
  assert.ok(normalizedManifest.sourceMaterials.some((item) => item.relativePath.endsWith(".pptx")));
  assert.equal(
    normalizedManifest.sourceMaterials.some((item) => item.relativePath.endsWith(".eml")),
    false
  );
  await fs.access(
    path.join(userDataPath, "jobs", mixedDocumentJob.id, "normalized-documents", "manifest.json")
  );

  const normalizedList = await fetchJson(
    `${pactServer.url}/api/jobs/${mixedDocumentJob.id}/normalized-documents`
  );
  assert.equal(normalizedList.documents.length, normalizedManifest.documents.length);
  const firstDocxDocument = normalizedList.documents.find((item) => item.relativePath.endsWith(".docx"));
  assert.ok(firstDocxDocument);
  const normalizedDownload = await fetch(
    `${pactServer.url}/api/jobs/${mixedDocumentJob.id}/normalized-documents/${encodeURIComponent(
      firstDocxDocument.documentId
    )}`
  );
  assert.equal(normalizedDownload.ok, true);
  assert.ok(
    (normalizedDownload.headers.get("content-type") || "").includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
  );
  const normalizedDownloadBuffer = Buffer.from(await normalizedDownload.arrayBuffer());
  assert.equal(createHash("sha256").update(normalizedDownloadBuffer).digest("hex"), firstDocxDocument.sha256);
  assert.ok(normalizedDownloadBuffer.length > 0);

  const firstSourceMaterial = normalizedList.sourceMaterials[0];
  assert.ok(firstSourceMaterial);
  const sourceMaterialDownload = await fetch(
    `${pactServer.url}/api/jobs/${mixedDocumentJob.id}/normalized-documents/${encodeURIComponent(
      firstSourceMaterial.documentId
    )}`
  );
  assert.equal(sourceMaterialDownload.ok, true);
  assert.ok((sourceMaterialDownload.headers.get("content-type") || "").length > 0);

  const normalizedRpcList = await fetchJson(`${pactServer.url}/api/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "normalized-list",
      method: "jobs.normalized_documents",
      params: { jobId: mixedDocumentJob.id }
    })
  });
  assert.equal(normalizedRpcList.id, "normalized-list");
  assert.equal(normalizedRpcList.result.documents.length, normalizedManifest.documents.length);
  const normalizedRpcDownload = await fetchJson(`${pactServer.url}/api/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "normalized-download",
      method: "jobs.normalized_document.get",
      params: {
        jobId: mixedDocumentJob.id,
        documentId: firstDocxDocument.documentId
      }
    })
  });
  assert.equal(normalizedRpcDownload.id, "normalized-download");
  assert.equal(normalizedRpcDownload.result.byteLength, firstDocxDocument.byteSize);
  assert.ok(normalizedRpcDownload.result.base64.length > 0);

  const cliNormalizedList = JSON.parse(
    await runCli([
      "--server-url",
      pactServer.url,
      "jobs",
      "normalized-docs",
      "--id",
      mixedDocumentJob.id
    ])
  );
  assert.equal(cliNormalizedList.documents.length, normalizedManifest.documents.length);
  const cliNormalizedOutputPath = path.join(userDataPath, "normalized-cli-download.docx");
  await runCli([
    "--server-url",
    pactServer.url,
    "jobs",
    "normalized-doc",
    "--id",
    mixedDocumentJob.id,
    "--document-id",
    firstDocxDocument.documentId,
    "--output",
    cliNormalizedOutputPath
  ]);
  const cliNormalizedOutput = await fs.readFile(cliNormalizedOutputPath);
  assert.equal(createHash("sha256").update(cliNormalizedOutput).digest("hex"), firstDocxDocument.sha256);

  minimalServer = await startHttpServer({
    userDataPath,
    host: "127.0.0.1",
    port: 0,
    runtimeOptions: {
      profile: "minimal",
      mountModules: {
        documentParser: mockDocumentParserModulePath
      }
    }
  });
  await installAuthenticatedFetch(minimalServer, { auth: pactAuth });
  const minimalJob = await fetchJson(`${minimalServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: "",
      filePaths: [],
      uploadedFiles: initialUploadedFiles,
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });
  const minimalCompletedJob = await waitForCompletedJob(minimalServer.url, minimalJob.id);
  assert.equal(minimalCompletedJob.status, "completed");
  const minimalResult = await fetchJson(
    `${minimalServer.url}/api/jobs/${minimalJob.id}/result`
  );
  assert.equal(minimalResult.emails.length, initialUploadedFiles.length);
  assert.ok(minimalResult.transactions.length >= 1);

  migrationActiveServer = await startHttpServer({
    userDataPath: migrationActiveDataPath,
    host: "127.0.0.1",
    port: 0,
    runtimeOptions: {
      mountModules: {
        documentParser: mockDocumentParserModulePath
      }
    },
    discoveryOptions: {
      serverId: "active-node",
      configVersion: "cutover-v2"
    }
  });
  const migrationAuth = await installAuthenticatedFetch(migrationActiveServer);
  await fs.mkdir(migrationBootstrapDataPath, { recursive: true });
  await fs.cp(
    path.join(migrationActiveDataPath, "auth"),
    path.join(migrationBootstrapDataPath, "auth"),
    { recursive: true }
  );
  migrationBootstrapServer = await startHttpServer({
    userDataPath: migrationBootstrapDataPath,
    host: "127.0.0.1",
    port: 0,
    runtimeOptions: {
      mountModules: {
        documentParser: mockDocumentParserModulePath
      }
    },
    discoveryOptions: {
      serverId: "bootstrap-node",
      mode: "forward",
      activeServiceUrl: migrationActiveServer.url,
      forwardBaseUrl: migrationActiveServer.url,
      configVersion: "cutover-v2"
    }
  });
  await installAuthenticatedFetch(migrationBootstrapServer, { auth: migrationAuth });

  const bootstrapInfo = await fetchJson(`${migrationBootstrapServer.url}/api/bootstrap`);
  assert.equal(bootstrapInfo.activeServiceUrl, migrationActiveServer.url);
  assert.equal(bootstrapInfo.mode, "forward");

  const outdatedCheckIn = await fetchJson(
    `${migrationBootstrapServer.url}/api/discovery/check-in`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "client-alpha",
        clientLabel: "Alpha",
        appVersion: "0.0.1",
        platform: "darwin-arm64",
        hostname: "alpha-mac",
        bootstrapUrl: migrationBootstrapServer.url,
        currentServiceUrl: migrationBootstrapServer.url,
        currentJobServiceUrl: "",
        configVersion: bootstrapInfo.configVersion,
        busy: false
      })
    }
  );
  assert.equal(outdatedCheckIn.client.migrationState, "outdated");

  const discoveryClientsAfterOutdated = await fetchJson(
    `${migrationBootstrapServer.url}/api/discovery/clients`
  );
  assert.equal(discoveryClientsAfterOutdated.summary.outdatedCount, 1);
  const outdatedClient = discoveryClientsAfterOutdated.items[0];
  assert.equal(outdatedClient.appVersion, "0.0.1");
  assert.equal(outdatedClient.configVersion, "cutover-v2");
  const migrationCommand = await fetchJson(
    `${migrationBootstrapServer.url}/api/discovery/clients/${encodeURIComponent(outdatedClient.clientId)}/migration`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: "verify"
      })
    }
  );
  assert.equal(migrationCommand.ok, true);
  assert.equal(migrationCommand.command.clientId, outdatedClient.clientId);
  assert.equal(migrationCommand.command.configVersion, "cutover-v2");
  assert.equal(
    migrationCommand.event.topic,
    `discovery.client.migration.${outdatedClient.clientId}`
  );

  const migrationMailDir = path.join(userDataPath, "migration-mailbox");
  await fs.mkdir(migrationMailDir, { recursive: true });
  const migrationMailPath = path.join(migrationMailDir, "cutover-weekly.eml");
  const migrationMailContent = [
      "From: PMO Team <pmo@contoso.com>",
      "To: Alice Chen <alice@contoso.com>",
      "Subject: 切换期周报",
      "Date: Fri, 24 Apr 2026 09:00:00 +0000",
      "",
      "这是服务切换窗口里的事务周报。",
      "本周需要验证旧服务端是否会把任务自动转发到新服务端。"
    ].join("\n");
  await fs.writeFile(
    migrationMailPath,
    migrationMailContent,
    "utf8"
  );

  const proxiedJob = await fetchJson(`${migrationBootstrapServer.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: "",
      filePaths: [],
      uploadedFiles: [
        buildUploadedFile(
          "cutover-weekly.eml",
          "migration-mailbox/cutover-weekly.eml",
          migrationMailContent,
          "message/rfc822"
        )
      ],
      settings: {
        retrievalHalfLifeDays: 45,
        staleAfterDays: 180,
        transactionWindowDays: 45,
        ocrEnabled: false
      }
    })
  });
  const proxiedCompleted = await waitForCompletedJob(
    migrationBootstrapServer.url,
    proxiedJob.id
  );
  assert.equal(proxiedCompleted.status, "completed");
  const proxiedResult = await fetchJson(
    `${migrationBootstrapServer.url}/api/jobs/${proxiedJob.id}/result`
  );
  assert.equal(proxiedResult.emails.length, 1);

  const activeStorageSummary = await fetchJson(
    `${migrationActiveServer.url}/api/storage/summary`
  );
  assert.ok(activeStorageSummary.batchCount >= 1);
  assert.ok(activeStorageSummary.emailCount >= 1);

  const alignedCheckIn = await fetchJson(
    `${migrationBootstrapServer.url}/api/discovery/check-in`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientId: "client-alpha",
        clientLabel: "Alpha",
        appVersion: "0.0.1",
        platform: "darwin-arm64",
        hostname: "alpha-mac",
        bootstrapUrl: migrationBootstrapServer.url,
        currentServiceUrl: migrationActiveServer.url,
        currentJobServiceUrl: "",
        configVersion: bootstrapInfo.configVersion,
        busy: false
      })
    }
  );
  assert.equal(alignedCheckIn.client.migrationState, "aligned");

  const discoveryClientsAfterAligned = await fetchJson(
    `${migrationBootstrapServer.url}/api/discovery/clients`
  );
  assert.equal(discoveryClientsAfterAligned.summary.alignedCount, 1);

  const missingResponse = await fetch(`${pactServer.url}/missing`);
  assert.equal(missingResponse.status, 404);

  console.log("Headless server verification passed.");
  console.log(`Server URL: ${pactServer.url}`);
  console.log(`User data dir: ${userDataPath}`);
} finally {
  if (migrationBootstrapServer) {
    await migrationBootstrapServer.close();
  }
  if (migrationActiveServer) {
    await migrationActiveServer.close();
  }
  if (minimalServer) {
    await minimalServer.close();
  }
  await pactServer.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
