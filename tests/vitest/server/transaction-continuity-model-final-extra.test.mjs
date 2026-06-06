import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildTransactionContinuityModel } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/transaction-continuity-model.mjs";

function emlFixture({
  from = "Sender <sender@example.test>",
  to = "user@example.local",
  cc = "",
  subject,
  date = "Mon, 05 Jun 2026 10:00:00 +0000",
  messageId,
  listId = "",
  references = "",
  inReplyTo = "",
  extraHeaders = [],
  body = ""
}) {
  const lines = [`From: ${from}`, `To: ${to}`];
  if (cc) {
    lines.push(`Cc: ${cc}`);
  }
  if (subject !== undefined) {
    lines.push(`Subject: ${subject}`);
  }
  lines.push(`Date: ${date}`, `Message-ID: <${messageId}>`);
  if (listId) {
    lines.push(`List-ID: ${listId}`);
  }
  if (references) {
    lines.push(`References: ${references}`);
  }
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
  }
  for (const header of extraHeaders) {
    lines.push(header);
  }
  lines.push("Content-Type: text/plain; charset=utf-8", "", body);
  return lines.join("\n");
}

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tx-final-"));
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
        schemaVersion: 1,
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

describe("transaction continuity model final extra coverage", () => {
  it("handles fallback headers, long bodies, and business entity extraction edges", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      const { manifestPath, manifestHash } = await writeNormalizedManifest(root);

      await writeMail(
        mailRoot,
        "edge-entity.eml",
        emlFixture({
          from: "Ops Alerts <alerts@hsbc.com>",
          to: "alpha@example.local; alpha@example.local, beta@example.local",
          cc: "gamma@example.local, delta@example.local",
          subject: undefined,
          date: "Tue, 06 Jun 2026 09:00:00 +0000",
          messageId: "edge-entity",
          listId: "< Weekly.Updates.HSBC.com >",
          references: "<ref-1> <ref-2>",
          inReplyTo: "<reply-1>",
          extraHeaders: ["X-Campaign-ID: < Spring-2026 >"],
          body: [
            "Please review contract CN-2024-7788 for Project Atlas.",
            "Ticket ID: JIRA-1234",
            "Invoice No: INV-2024-9001",
            "Order Number: PO-998877",
            "Project code: AX-2024",
            "System: Atlas Platform",
            "Version: v1.2.3-beta",
            "Amount USD 12,400",
            "Acme Widgets Ltd",
            "in Shanghai",
            'Content-Disposition: attachment; filename="Atlas-SOW-v2.1.pdf"',
            "=?utf-8?Q?Qm9keQ==?=",
            "<p>Quoted HTML should be cleaned.</p>"
          ].join("\n")
        })
      );

      await writeMail(
        mailRoot,
        "digest-long.eml",
        emlFixture({
          from: "Digest <digest@news.example>",
          subject: "Daily digest for today",
          date: "Wed, 07 Jun 2026 09:00:00 +0000",
          messageId: "digest-long",
          listId: "<daily.news.example>",
          body: `${"Line with HTML <b>markup</b> and encoded =?utf-8?Q?words?=\n".repeat(120)}`
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: true,
        maxDocs: 0,
        normalizedManifestPaths: [manifestPath]
      });

      expect(result.manifest.stats.failedFiles).toBe(0);
      expect(result.summaries).toHaveLength(2);

      const summariesByFile = new Map(result.summaries.map((item) => [item.messages[0].filePath, item]));
      const edgeSummary = summariesByFile.get("edge-entity.eml");
      const digestSummary = summariesByFile.get("digest-long.eml");

      expect(edgeSummary).toBeTruthy();
      expect(edgeSummary.title).toContain("银行账单");
      expect(edgeSummary.senderOrg).toBe("hsbc.com");
      expect(edgeSummary.cadence).toBe("monthly");
      expect(edgeSummary.actionCategories).toEqual(["approval"]);
      expect(edgeSummary.listIds).toContain("hsbc.com");
      expect(edgeSummary.businessEntities.contractIds).toContain("cn-2024-7788");
      expect(edgeSummary.businessEntities.ticketIds).toContain("jira-1234");
      expect(edgeSummary.businessEntities.invoiceIds).toContain("inv-2024-9001");
      expect(edgeSummary.businessEntities.orderIds).toContain("po-998877");
      expect(edgeSummary.businessEntities.projectIds).toContain("ax-2024");
      expect(edgeSummary.businessEntities.versions).toContain("1.2.3-beta");
      expect(edgeSummary.businessEntities.amounts).toContain("12,400");
      expect(edgeSummary.businessEntities.organizations).toContain("acme widgets ltd");
      expect(edgeSummary.businessEntities.locations).toContain("shanghai");
      expect(edgeSummary.attachmentHashes).toContain(manifestHash);

      expect(edgeSummary.messages[0].recipients).toEqual([
        "alpha@example.local",
        "beta@example.local",
        "gamma@example.local",
        "delta@example.local"
      ]);
      expect(edgeSummary.messages[0].bodyTextTruncated).toBe(false);
      expect(edgeSummary.messages[0].bodyText).toContain("Quoted HTML should be cleaned.");
      expect(edgeSummary.messages[0].bodyText).not.toContain("<p>");

      expect(digestSummary).toBeTruthy();
      expect(digestSummary.cadence).toBe("daily");
      expect(digestSummary.messages[0].bodyTextTruncated).toBe(true);
      expect(digestSummary.messages[0].bodyText.length).toBe(2000);
    });
  });

  it("separates creator, bank, commerce, service, reminder, and notification behaviors", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "patreon-explicit.eml",
        emlFixture({
          from: "Patreon Creator <updates@patreon.com>",
          to: "fan@example.local",
          subject: "Alice shared a new episode",
          date: "Thu, 08 Jun 2026 09:00:00 +0000",
          messageId: "patreon-explicit",
          body: "creator: Alice\nAlice shared a new episode with subscribers."
        })
      );

      await writeMail(
        mailRoot,
        "patreon-fallback.eml",
        emlFixture({
          from: "Nova Creator <updates@patreon.com>",
          to: "fan@example.local",
          subject: "Bonus episode",
          date: "Thu, 08 Jun 2026 10:00:00 +0000",
          messageId: "patreon-fallback",
          body: "Supporter update with notes."
        })
      );

      await writeMail(
        mailRoot,
        "hsbc-statement.eml",
        emlFixture({
          from: "Statements <alerts@hsbc.com>",
          to: "user@example.local",
          subject: "Your monthly statement is ready",
          date: "Fri, 09 Jun 2026 09:00:00 +0000",
          messageId: "hsbc-statement",
          body: "Monthly account statement, bill, payment and receipt details."
        })
      );

      await writeMail(
        mailRoot,
        "amazon-order.eml",
        emlFixture({
          from: "Orders <orders@amazon.com>",
          to: "user@example.local",
          subject: "Your order has shipped",
          date: "Fri, 09 Jun 2026 10:00:00 +0000",
          messageId: "amazon-order",
          body: "Order number PO-998877 shipped from Shanghai with tracking details."
        })
      );

      await writeMail(
        mailRoot,
        "github-report.eml",
        emlFixture({
          from: "GitHub Notifications <notifications@github.com>",
          to: "user@example.local",
          subject: "Weekly report for your repo",
          date: "Sat, 10 Jun 2026 09:00:00 +0000",
          messageId: "github-report",
          body: "Weekly report, status update, and monthly usage summary."
        })
      );

      await writeMail(
        mailRoot,
        "blank-reminder.eml",
        emlFixture({
          from: "",
          to: "user@example.local",
          subject: undefined,
          date: "Sun, 11 Jun 2026 09:00:00 +0000",
          messageId: "blank-reminder",
          body: "Please confirm the request and verify the access details."
        })
      );

      await writeMail(
        mailRoot,
        "notification-digest.eml",
        emlFixture({
          from: "Digest <digest@news.example>",
          to: "user@example.local",
          subject: "Daily digest",
          date: "Sun, 11 Jun 2026 10:00:00 +0000",
          messageId: "notification-digest",
          body: "Digest summary for today."
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: true,
        maxDocs: 0
      });

      expect(result.summaries).toHaveLength(7);

      const byFile = new Map(result.summaries.map((item) => [item.messages[0].filePath, item]));
      const patreonExplicit = byFile.get("patreon-explicit.eml");
      const patreonFallback = byFile.get("patreon-fallback.eml");
      const hsbcStatement = byFile.get("hsbc-statement.eml");
      const amazonOrder = byFile.get("amazon-order.eml");
      const githubReport = byFile.get("github-report.eml");
      const blankReminder = byFile.get("blank-reminder.eml");
      const digest = byFile.get("notification-digest.eml");

      expect(patreonExplicit.attention.sourceType).toBe("creator-platform");
      expect(patreonExplicit.attention.behaviorId).toBe("creator-publishing");
      expect(patreonExplicit.attention.actorLabel).toBe("Alice");

      expect(patreonFallback.attention.sourceType).toBe("creator-platform");
      expect(patreonFallback.attention.behaviorId).toBe("creator-publishing");
      expect(patreonFallback.attention.actorLabel).toBe("Nova Creator");
      expect(patreonFallback.lineageId).not.toBe(patreonExplicit.lineageId);

      expect(hsbcStatement.attention.sourceType).toBe("bank");
      expect(hsbcStatement.attention.behaviorId).toBe("bank-statement");
      expect(hsbcStatement.cadence).toBe("monthly");
      expect(hsbcStatement.attention.sourceLabel).toBe("HSBC");

      expect(amazonOrder.attention.sourceType).toBe("commerce");
      expect(amazonOrder.attention.behaviorId).toBe("shopping-order");
      expect(amazonOrder.businessEntities.orderIds).toContain("998877");

      expect(githubReport.attention.sourceType).toBe("service");
      expect(githubReport.attention.behaviorId).toBe("report");
      expect(githubReport.cadence).toBe("weekly");

      expect(blankReminder.attention.sourceLabel).toBe("未知来源");
      expect(blankReminder.attention.behaviorId).toBe("reminder");
      expect(blankReminder.cadence).toBe("irregular");

      expect(digest.attention.behaviorId).toBe("notification");
      expect(digest.cadence).toBe("daily");
    });
  });

  it("ignores corrupt stored lineage rows and rebuilds message arrays from compacted snapshots", async () => {
    await withTempRoot(async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeMail(
        mailRoot,
        "bank-jan.eml",
        emlFixture({
          from: "Statements <alerts@hsbc.com>",
          to: "user@example.local",
          subject: "Your January statement is ready",
          date: "Mon, 12 Jun 2026 09:00:00 +0000",
          messageId: "bank-jan",
          body: "Monthly statement and payment summary."
        })
      );
      await writeMail(
        mailRoot,
        "bank-feb.eml",
        emlFixture({
          from: "Statements <alerts@hsbc.com>",
          to: "user@example.local",
          subject: "Your February statement is ready",
          date: "Thu, 13 Jun 2026 09:00:00 +0000",
          messageId: "bank-feb",
          body: "Monthly statement and payment summary."
        })
      );

      const first = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: true,
        maxDocs: 0
      });

      const db = new Database(first.dbPath);
      try {
        const rows = db.prepare("SELECT lineage_id, model_json FROM continuity_lineages").all();
        expect(rows.length).toBeGreaterThan(0);
        const [row] = rows;
        const lineage = JSON.parse(row.model_json);
        lineage.messages = null;
        lineage.sampleMessages = lineage.sampleMessages.slice(0, 1);
        lineage.recentMessages = lineage.recentMessages.slice(0, 1);

        db.prepare("UPDATE continuity_lineages SET model_json = ? WHERE lineage_id = ?").run(
          JSON.stringify(lineage),
          row.lineage_id
        );
        db.prepare(
          "INSERT INTO continuity_lineages (lineage_id, title, sender_org, category, cadence, first_seen_at, last_seen_at, occurrence_count, model_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          "corrupt-row",
          "Corrupt Row",
          "",
          "general",
          "irregular",
          "2026-06-12T00:00:00.000Z",
          "2026-06-12T00:00:00.000Z",
          0,
          "{ not valid json",
          "2026-06-12T00:00:00.000Z"
        );
      } finally {
        db.close();
      }

      const second = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: false,
        maxDocs: 0,
        reviewDaily: false,
        reviewEvery: 0
      });

      const bankSummary = second.summaries.find((item) => item.senderOrg === "hsbc.com");
      expect(second.manifest.stats.failedFiles).toBe(0);
      expect(second.summaries.length).toBeGreaterThan(0);
      expect(bankSummary.messages.length).toBeGreaterThan(0);
      expect(bankSummary.messages[0].subject).toContain("January");
      expect(bankSummary.occurrenceCount).toBe(2);
    });
  });
});
