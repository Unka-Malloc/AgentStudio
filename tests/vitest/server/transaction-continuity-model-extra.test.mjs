import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTransactionContinuityModel,
  transactionContinuityDefaults
} from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/transaction-continuity-model.mjs";

function emlFixture({
  from,
  to = "user@example.local",
  subject,
  date,
  messageId,
  listId = "",
  body = ""
}) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: <${messageId}>`
  ];
  if (listId) {
    lines.push(`List-ID: <${listId}>`);
  }
  lines.push("Content-Type: text/plain; charset=utf-8", "", body);
  return lines.join("\n");
}

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tx-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeMail(root, fileName, value) {
  await fs.writeFile(path.join(root, fileName), value, "utf8");
}

async function writeNormalizedManifest(root) {
  const manifestPath = path.join(root, "normalized-manifest.json");
  const manifestHash = "b".repeat(64);
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: "v0.0.1:schema:definition-1",
        packageType: "pact.normalized-documents",
        documents: [
          {
            documentId: "atlas-sow-v2-1",
            adapterId: "fixture-adapter",
            granularity: "document",
            title: "Atlas SOW v2.1",
            relativePath: "documents/atlas-sow-v2.1.docx",
            sha256: manifestHash,
            sourceMaterialRelativePath: "source-materials/atlas/Atlas-SOW-v2.1.pdf"
          }
        ],
        sourceMaterials: []
      },
      null,
      2
    ),
    "utf8"
  );
  return { manifestPath, manifestHash };
}

async function writeRuleMatchingFixture(root) {
  await writeMail(
    root,
    "bank-jan.eml",
    emlFixture({
      from: "Statements <statements@bank.example>",
      subject: "Your January statement is ready",
      date: "Mon, 01 Jan 2024 10:00:00 +0000",
      messageId: "bank-jan",
      body: "Your monthly account statement is ready."
    })
  );
  await writeMail(
    root,
    "bank-feb.eml",
    emlFixture({
      from: "Statements <statements@bank.example>",
      subject: "Your February statement is ready",
      date: "Thu, 01 Feb 2024 10:00:00 +0000",
      messageId: "bank-feb",
      body: "Your monthly account statement is ready."
    })
  );
  await writeMail(
    root,
    "shop-one.eml",
    emlFixture({
      from: "Offers <news@shop.example>",
      subject: "Spring sale starts now",
      date: "Fri, 12 Mar 2024 10:00:00 +0000",
      messageId: "shop-one",
      listId: "offers.shop.example",
      body: "Great sale event is now live. New discount offers today."
    })
  );
  await writeMail(
    root,
    "shop-two.eml",
    emlFixture({
      from: "Offers <news@shop.example>",
      subject: "Last chance to save this weekend",
      date: "Sat, 13 Mar 2024 10:00:00 +0000",
      messageId: "shop-two",
      listId: "offers.shop.example",
      body: "The same sale campaign continues this week."
    })
  );
  await writeMail(
    root,
    "security.eml",
    emlFixture({
      from: "Security <alerts@bank.example>",
      subject: "New login to your account",
      date: "Sun, 14 Mar 2024 11:00:00 +0000",
      messageId: "security-alert",
      body: "A suspicious login was detected and requires review."
    })
  );
  await writeMail(
    root,
    "contract-one.eml",
    emlFixture({
      from: "Legal Desk <legal@company.example>",
      subject: "Contract CN-2024-7788 review for Project Atlas",
      date: "Mon, 15 Apr 2024 09:00:00 +0000",
      messageId: "contract-one",
      to: "finance@company.example",
      body: [
        "Please review contract CN-2024-7788 for Project Atlas.",
        "Attachment: Atlas-SOW-v2.1.pdf",
        'Content-Disposition: attachment; filename="Atlas-SOW-v2.1.pdf"'
      ].join("\n")
    })
  );
  await writeMail(
    root,
    "contract-two.eml",
    emlFixture({
      from: "Finance Desk <finance@company.example>",
      subject: "Payment approval for CN-2024-7788",
      date: "Tue, 16 Apr 2024 09:30:00 +0000",
      messageId: "contract-two",
      to: "legal@company.example",
      body: "Approval requested for contract CN-2024-7788. Amount USD 12,400."
    })
  );
  await writeMail(
    root,
    "project-other.eml",
    emlFixture({
      from: "Finance Desk <finance@company.example>",
      subject: "Payment approval for Project Beacon",
      date: "Tue, 16 Apr 2024 10:30:00 +0000",
      messageId: "project-other",
      to: "legal@company.example",
      body: "Approval requested for Project Beacon. No project code is provided."
    })
  );

  return {
    bankSender: "bank.example",
    shopSender: "shop.example",
    contractSender: "company.example",
    bankCount: 3,
    shopCount: 2
  };
}

describe("transactionContinuityDefaults", () => {
  it("exports stable default knobs", () => {
    expect(transactionContinuityDefaults).toMatchObject({
      outputPath: "build/artifacts/transaction-continuity",
      maxReadBytes: 262144,
      maxDocs: 80,
      reviewEvery: 500
    });
  });
});

describe("transaction continuity model build", () => {
  it("classifies rule-matched categories and links related lineage via business entities", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      const { manifestPath, manifestHash } = await writeNormalizedManifest(root);
      await writeRuleMatchingFixture(mailRoot);

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: true,
        normalizedManifestPaths: [manifestPath]
      });

      expect(result.manifest.stats.processedFiles).toBe(8);
      expect(result.manifest.stats.failedFiles).toBe(0);

      const bankStatement = result.summaries.find(
        (item) => item.senderOrg === "bank.example" && item.category === "financial-statement"
      );
      const shopSeries = result.summaries.find(
        (item) => item.senderOrg === "shop.example" && item.category === "marketing-series"
      );
      const securityAlert = result.summaries.find(
        (item) => item.senderOrg === "bank.example" && item.category === "security-alert"
      );
      const contractSeries = result.summaries.find((item) =>
        item.businessEntities?.contractIds?.some((value) => value.toLowerCase() === "cn-2024-7788")
      );

      expect(bankStatement).toBeTruthy();
      expect(bankStatement.occurrenceCount).toBe(2);
      expect(bankStatement.cadence).toBe("monthly");

      expect(shopSeries).toBeTruthy();
      expect(shopSeries.occurrenceCount).toBe(2);

      expect(securityAlert).toBeTruthy();
      expect(securityAlert.lineageId).not.toEqual(bankStatement.lineageId);

      expect(contractSeries).toBeTruthy();
      expect(contractSeries.occurrenceCount).toBe(2);
      expect(contractSeries.attachmentHashes).toContain(manifestHash);
      expect(contractSeries.actionCategories.some((item) => item === "approval" || item === "request")).toBe(true);

      await fs.access(path.join(outputPath, "manifest.json"));
      await fs.access(path.join(outputPath, "transactions.json"));
      await fs.access(path.join(outputPath, "transactions.csv"));
      await fs.access(path.join(outputPath, "transaction-overview.docx"));
      expect(result.generatedDocCount).toBeGreaterThan(1);
    });
  });

  it("caps artifact generation by maxDocs boundary", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "bank-jan.eml",
        emlFixture({
          from: "Statements <statements@bank.example>",
          subject: "Your January statement is ready",
          date: "Mon, 01 Jan 2024 10:00:00 +0000",
          messageId: "bank-jan"
        })
      );
      await writeMail(
        mailRoot,
        "bank-feb.eml",
        emlFixture({
          from: "Statements <statements@bank.example>",
          subject: "Your February statement is ready",
          date: "Thu, 01 Feb 2024 10:00:00 +0000",
          messageId: "bank-feb"
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: true,
        maxDocs: 0,
        reviewEvery: 2
      });

      expect(result.generatedDocCount).toBe(1);
      expect(result.manifest.stats.processedFiles).toBe(2);

      const transactionFiles = await fs.readdir(path.join(outputPath, "transactions"));
      expect(transactionFiles.filter((entry) => entry.endsWith(".docx")).length).toBe(0);
    });
  });

  it("keeps boundary behavior for scan limit and incremental reuse", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "bank-jan.eml",
        emlFixture({
          from: "Statements <statements@bank.example>",
          subject: "Your January statement is ready",
          date: "Mon, 01 Jan 2024 10:00:00 +0000",
          messageId: "bank-jan"
        })
      );
      await writeMail(
        mailRoot,
        "bank-feb.eml",
        emlFixture({
          from: "Statements <statements@bank.example>",
          subject: "Your February statement is ready",
          date: "Thu, 01 Feb 2024 10:00:00 +0000",
          messageId: "bank-feb"
        })
      );

      const first = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: true,
        limit: 0
      });
      const firstBank = first.summaries.find((item) => item.senderOrg === "bank.example");
      expect(firstBank).toBeTruthy();
      expect(firstBank.occurrenceCount).toBe(2);

      await writeMail(
        mailRoot,
        "bank-mar.eml",
        emlFixture({
          from: "Statements <statements@bank.example>",
          subject: "Your March statement is ready",
          date: "Fri, 01 Mar 2024 10:00:00 +0000",
          messageId: "bank-mar"
        })
      );

      const second = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: false
      });
      const secondBank = second.summaries.find((item) => item.senderOrg === "bank.example");

      expect(second.manifest.stats.failedFiles).toBe(0);
      expect(second.manifest.stats.skippedUnchanged).toBe(2);
      expect(second.manifest.stats.processedFiles).toBe(1);
      expect(second.manifest.stats.reviewExecuted).toBe(false);
      expect(secondBank.lineageId).toBe(firstBank.lineageId);
      expect(secondBank.occurrenceCount).toBe(3);
    });
  });

  it("continues on malformed inputs and keeps producing summaries", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "good.eml",
        emlFixture({
          from: "Statements <statements@bank.example>",
          subject: "Monthly statement is ready",
          date: "Mon, 01 Jan 2024 10:00:00 +0000",
          messageId: "good-bank"
        })
      );
      await writeMail(
        mailRoot,
        "broken.eml",
        emlFixture({
          from: "Unknown <ops@example.local>",
          subject: "Unreadable source",
          date: "Mon, 02 Jan 2024 10:00:00 +0000",
          messageId: "broken-1"
        })
      );
      await fs.chmod(path.join(mailRoot, "broken.eml"), 0o000);

      const invalidManifestPath = path.join(root, "invalid-manifest.json");
      await fs.writeFile(invalidManifestPath, "{ not valid json", "utf8");

      try {
        const result = await buildTransactionContinuityModel({
          roots: [mailRoot],
          outputPath,
          rebuild: true,
          normalizedManifestPaths: [invalidManifestPath]
        });

        expect(result.manifest.stats.scannedFiles).toBe(2);
        expect(result.manifest.stats.failedFiles).toBe(1);
        expect(result.manifest.stats.processedFiles).toBe(1);
        expect(result.summaries).toHaveLength(1);
      } finally {
        await fs.chmod(path.join(mailRoot, "broken.eml"), 0o644);
      }
    });
  });
});
