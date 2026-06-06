import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildTransactionContinuityModel } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/transaction-continuity-model.mjs";

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tx-boundary-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeMail(root, fileName, value) {
  await fs.writeFile(path.join(root, fileName), value, "utf8");
}

function emlFixture({
  from = "Sender <sender@example.test>",
  to = "user@example.local",
  subject = "Subject",
  date = "Mon, 05 Jun 2026 10:00:00 +0000",
  messageId,
  listId = "",
  extraHeaders = [],
  body = ""
}) {
  const lines = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${date}`, `Message-ID: <${messageId}>`];
  if (listId) {
    lines.push(`List-ID: ${listId}`);
  }
  lines.push(...extraHeaders, "Content-Type: text/plain; charset=utf-8", "", body);
  return lines.join("\n");
}

function summaryByFile(result, fileName) {
  return result.summaries.find((summary) =>
    (summary.messages || []).some((message) => message.filePath === fileName)
  );
}

describe("transaction continuity boundary coverage", () => {
  it("decodes folded MIME headers, invalid dates, and no-body messages", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "folded-mime.eml",
        [
          "From: =?utf-8?B?T3BzIFRlYW0=?= <admin@service.example.co.uk>",
          "To: user@example.local",
          "Subject: =?iso-8859-1?Q?Ol=E1?=",
          "  =?utf-8?B?5rWL6K+V?=",
          "This is not a valid header line",
          "Date: not-a-real-date",
          "Message-ID: <folded-mime>"
        ].join("\n")
      );

      await writeMail(
        mailRoot,
        "unknown-charset.eml",
        emlFixture({
          from: "Alerts <alerts@service.example>",
          subject: "=?x-unknown?Q?Fallback=20Title?=",
          messageId: "unknown-charset",
          body: "Encoded body=20text with a soft=\nline break."
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath: path.join(root, "out"),
        rebuild: true,
        maxDocs: 0
      });

      const folded = summaryByFile(result, "folded-mime.eml");
      const unknown = summaryByFile(result, "unknown-charset.eml");

      expect(result.manifest.stats.failedFiles).toBe(0);
      expect(folded.messages[0].subject).toContain("Ol\u00e1");
      expect(folded.messages[0].subject).toContain("\u6d4b\u8bd5");
      expect(folded.messages[0].bodyText).toBe("");
      expect(folded.messages[0].sentAt).toMatch(/T/);
      expect(folded.senderOrg).toBe("example.co.uk");

      expect(unknown.messages[0].subject).toBe("Fallback Title");
      expect(unknown.messages[0].bodyText).toContain("Encoded body text with a softline break.");
    });
  });

  it("filters weak business identifiers while keeping valid order and contract IDs", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "business-filters.eml",
        emlFixture({
          from: "Legal <legal@vendor.example>",
          subject: "Contract and order boundary review",
          messageId: "business-filters",
          body: [
            "Please review contract CN-2026-7788.",
            "Contract number: ABCDEFGHIJKLMNOPQRSTUVWXY12",
            "Invoice No: inv2026",
            "Order number: PO1234",
            "Order number: AB-12",
            "Order number: PO-12345678901234567890123456789012345"
          ].join("\n")
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath: path.join(root, "out"),
        rebuild: true,
        maxDocs: 0
      });
      const summary = summaryByFile(result, "business-filters.eml");

      expect(summary.businessEntities.contractIds).toContain("cn-2026-7788");
      expect(summary.businessEntities.contractIds).not.toContain("abcdefghijklmnopqrstuvwxy12");
      expect(summary.businessEntities.invoiceIds).not.toContain("inv2026");
      expect(summary.businessEntities.orderIds).toContain("po1234");
      expect(summary.businessEntities.orderIds).not.toContain("ab-12");
      expect(summary.businessEntities.orderIds).not.toContain("po-12345678901234567890123456789012345");
    });
  });

  it("links valid normalized attachment refs and ignores malformed manifest entries", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      await fs.mkdir(mailRoot, { recursive: true });
      const manifestPath = path.join(root, "normalized-manifest.json");
      const attachmentHash = "c".repeat(64);

      await fs.writeFile(
        manifestPath,
        JSON.stringify({
          documents: [
            { documentId: "", title: "", relativePath: "", sourceMaterialRelativePath: "" },
            {
              documentId: "report-doc",
              adapterId: "fixture",
              granularity: "document",
              title: "Quarterly Report",
              relativePath: "docs/report.pdf",
              sourceMaterialRelativePath: "uploads/report.pdf",
              sha256: attachmentHash
            }
          ],
          sourceMaterials: [
            {
              documentId: "report-doc",
              adapterId: "fixture",
              granularity: "document",
              title: "Quarterly Report",
              relativePath: "docs/report.pdf",
              sourceMaterialRelativePath: "uploads/report.pdf",
              sha256: attachmentHash
            }
          ]
        }),
        "utf8"
      );

      await writeMail(
        mailRoot,
        "attachments.eml",
        emlFixture({
          from: "Reports <reports@vendor.example>",
          subject: "Monthly report attachments",
          messageId: "attachments",
          body: [
            'Content-Disposition: attachment; filename="report.pdf"',
            "Content-Disposition: attachment; filename*=UTF-8''bad%name.pdf",
            'Content-Disposition: attachment; filename="ignored.exe"'
          ].join("\n")
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath: path.join(root, "out"),
        rebuild: true,
        maxDocs: 0,
        normalizedManifestPaths: ["", path.join(root, "missing.json"), manifestPath]
      });
      const summary = summaryByFile(result, "attachments.eml");

      expect(summary.attachmentHashes).toContain(attachmentHash);
      expect(summary.attachmentTitles).toEqual(expect.arrayContaining(["Quarterly Report", "report", "bad%name"]));
      expect(summary.attachmentTitles).not.toContain("ignored");
    });
  });

  it("keeps conflicting strong business entities in separate lineages", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "contract-a.eml",
        emlFixture({
          from: "Contracts <contracts@vendor.example>",
          subject: "Monthly contract status",
          date: "Mon, 05 Jun 2026 10:00:00 +0000",
          messageId: "contract-a",
          body: "Status update for contract CN-2026-1001 and Project Atlas."
        })
      );
      await writeMail(
        mailRoot,
        "contract-b.eml",
        emlFixture({
          from: "Contracts <contracts@vendor.example>",
          subject: "Monthly contract status",
          date: "Tue, 06 Jun 2026 10:00:00 +0000",
          messageId: "contract-b",
          body: "Status update for contract CN-2026-2002 and Project Atlas."
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath: path.join(root, "out"),
        rebuild: true,
        maxDocs: 0
      });

      const contractSummaries = result.summaries.filter((summary) => summary.senderOrg === "vendor.example");
      expect(contractSummaries).toHaveLength(2);
      expect(contractSummaries.map((summary) => summary.businessEntities.contractIds[0]).sort()).toEqual([
        "cn-2026-1001",
        "cn-2026-2002"
      ]);
    });
  });
});
