#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { buildTransactionContinuityModel } from "../platform/specialized/knowledge/preprocessing/domain/rules/transaction-continuity-model.mjs";

function eml({ from, to = "user@example.test", subject, date, messageId, listId = "", body }) {
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

async function docxDocumentXml(filePath) {
  const zip = unzipSync(new Uint8Array(await fs.readFile(filePath)));
  const documentXml = zip["word/document.xml"];
  return documentXml ? strFromU8(documentXml) : "";
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-continuity-"));
  const mailRoot = path.join(root, "mail");
  const outputPath = path.join(root, "out");
  const normalizedManifestPath = path.join(root, "normalized-manifest.json");
  await fs.mkdir(mailRoot, { recursive: true });
  const fixtures = [
    [
      "bank-jan.eml",
      eml({
        from: "Statements <statements@bank.example>",
        subject: "Your January statement is ready",
        date: "Mon, 01 Jan 2024 10:00:00 +0000",
        messageId: "bank-jan@example",
        body: "Your monthly account statement is ready."
      })
    ],
    [
      "bank-feb.eml",
      eml({
        from: "Statements <statements@bank.example>",
        subject: "Your February statement is ready",
        date: "Thu, 01 Feb 2024 10:00:00 +0000",
        messageId: "bank-feb@example",
        body: "Your monthly account statement is ready."
      })
    ],
    [
      "bank-mar.eml",
      eml({
        from: "Statements <statements@bank.example>",
        subject: "Your March statement is ready",
        date: "Fri, 01 Mar 2024 10:00:00 +0000",
        messageId: "bank-mar@example",
        body: "Your monthly account statement is ready."
      })
    ],
    [
      "shop-one.eml",
      eml({
        from: "Offers <news@shop.example>",
        subject: "Spring sale starts now",
        date: "Fri, 12 Apr 2024 10:00:00 +0000",
        messageId: "shop-one@example",
        listId: "offers.shop.example",
        body: "Selected products are on sale."
      })
    ],
    [
      "shop-two.eml",
      eml({
        from: "Offers <news@shop.example>",
        subject: "Last chance to save this weekend",
        date: "Fri, 19 Apr 2024 10:00:00 +0000",
        messageId: "shop-two@example",
        listId: "offers.shop.example",
        body: "The same sale newsletter continues this week."
      })
    ],
    [
      "security.eml",
      eml({
        from: "Security <alerts@bank.example>",
        subject: "New login to your account",
        date: "Fri, 19 Apr 2024 11:00:00 +0000",
        messageId: "security@example",
        body: "A new device signed in."
      })
    ],
    [
      "contract-legal.eml",
      eml({
        from: "Legal Desk <legal@company.example>",
        to: "finance@company.example",
          subject: "Contract CN-2024-7788 review for Project Atlas v2.1",
          date: "Mon, 22 Apr 2024 09:00:00 +0000",
          messageId: "contract-legal@example",
          body: [
            "Please review contract CN-2024-7788 for Project Atlas. Attachment: Atlas-SOW-v2.1.pdf",
            "Content-Disposition: attachment; filename=\"Atlas-SOW-v2.1.pdf\""
          ].join("\n")
        })
      ],
    [
      "contract-finance.eml",
      eml({
        from: "Finance Desk <finance@company.example>",
        to: "legal@company.example",
        subject: "Payment approval for CN-2024-7788",
        date: "Tue, 23 Apr 2024 09:30:00 +0000",
        messageId: "contract-finance@example",
        body: "Approval requested for contract CN-2024-7788. Amount USD 12,400. Version v2.1."
      })
    ],
    [
      "project-other.eml",
      eml({
        from: "Finance Desk <finance@company.example>",
        to: "legal@company.example",
        subject: "Payment approval for Project Beacon",
        date: "Tue, 23 Apr 2024 10:30:00 +0000",
        messageId: "project-other@example",
        body: "Approval requested for Project Beacon. No contract id is provided."
      })
    ],
    [
      "patreon-elrelator-one.eml",
      eml({
        from: "Patreon <bingo@patreon.com>",
        subject: "ElRelator 刚刚与订阅会员分享了 Thursday New Episode of Beautiful Body Guard",
        date: "Wed, 24 Apr 2024 10:00:00 +0000",
        messageId: "patreon-elrelator-one@example",
        body: "ElRelator shared a new members-only post with paid subscribers."
      })
    ],
    [
      "patreon-elrelator-two.eml",
      eml({
        from: "Patreon <bingo@patreon.com>",
        subject: "ElRelator 刚刚与订阅会员分享了 Friday Bonus Chapter",
        date: "Thu, 25 Apr 2024 10:00:00 +0000",
        messageId: "patreon-elrelator-two@example",
        body: "ElRelator shared another post with subscribers."
      })
    ],
    [
      "patreon-harafung-one.eml",
      eml({
        from: "Patreon <bingo@patreon.com>",
        subject: "harafung 刚刚与订阅会员分享了 New Character Set",
        date: "Thu, 25 Apr 2024 11:00:00 +0000",
        messageId: "patreon-harafung-one@example",
        body: "harafung shared a new members-only post with paid subscribers."
      })
    ],
    [
      "patreon-harafung-two.eml",
      eml({
        from: "Patreon <bingo@patreon.com>",
        subject: "harafung 刚刚与订阅会员分享了 Weekend Preview",
        date: "Fri, 26 Apr 2024 11:00:00 +0000",
        messageId: "patreon-harafung-two@example",
        body: "harafung shared another post with subscribers."
      })
    ],
    [
      "steam-sale-one.eml",
      eml({
        from: "Steam <noreply@steampowered.com>",
        subject: "Wishlist item is on sale",
        date: "Fri, 26 Apr 2024 10:00:00 +0000",
        messageId: "steam-sale-one@example",
        body: "A game from your Steam wishlist is on sale with a discount."
      })
    ],
    [
      "steam-sale-two.eml",
      eml({
        from: "Steam <noreply@steampowered.com>",
        subject: "Steam Spring Sale discount reminder",
        date: "Sat, 27 Apr 2024 10:00:00 +0000",
        messageId: "steam-sale-two@example",
        body: "Steam sale deals end soon."
      })
    ],
    [
      "ledger-bank-statement-one.eml",
      eml({
        from: "Example Bank <statements@ledger-bank.example>",
        subject: "Your monthly statement is ready",
        date: "Mon, 01 Apr 2024 08:00:00 +0000",
        messageId: "ledger-bank-statement-one@example",
        body: "Your monthly account statement is ready."
      })
    ],
    [
      "ledger-bank-statement-two.eml",
      eml({
        from: "Example Bank <statements@ledger-bank.example>",
        subject: "Your monthly statement is ready",
        date: "Wed, 01 May 2024 08:00:00 +0000",
        messageId: "ledger-bank-statement-two@example",
        body: "Your monthly account statement is ready."
      })
    ],
    [
      "service-offer-one.eml",
      eml({
        from: "Service Updates <hello@updates.example>",
        subject: "A new service offer",
        date: "Mon, 06 May 2024 08:00:00 +0000",
        messageId: "service-offer-one@example",
        body: "New service offer and promotion for customers."
      })
    ],
    [
      "service-offer-two.eml",
      eml({
        from: "Service Updates <hello@updates.example>",
        subject: "Save with this service offer",
        date: "Tue, 07 May 2024 08:00:00 +0000",
        messageId: "service-offer-two@example",
        body: "Service promotional offer continues."
      })
    ]
  ];

  for (const [fileName, content] of fixtures) {
    await fs.writeFile(path.join(mailRoot, fileName), content, "utf8");
  }
  await fs.writeFile(
    normalizedManifestPath,
    JSON.stringify(
      {
        schemaVersion: "v0.0.1:schema:definition-1",
        packageType: "pact.normalized-documents",
        documents: [
          {
            documentId: "doc-atlas-sow-v21",
            adapterId: "pdfAdapter",
            granularity: "document",
            title: "Atlas SOW v2.1",
            relativePath: "sources/atlas/document.docx",
            sha256: "a".repeat(64),
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

  const first = await buildTransactionContinuityModel({
    roots: [mailRoot],
    outputPath,
    rebuild: true,
    maxDocs: 12,
    normalizedManifestPaths: [normalizedManifestPath]
  });
  const transactions = first.summaries;
  const bank = transactions.find(
    (item) => item.senderOrg === "bank.example" && item.subjectTokens.includes("statement")
  );
  assert.ok(bank, "bank statement lineage should exist");
  assert.equal(bank.occurrenceCount, 3);
  assert.equal(bank.cadence, "monthly");
  const shop = transactions.find(
    (item) => item.senderOrg === "shop.example" && item.category === "marketing-series"
  );
  assert.ok(shop, "shop marketing lineage should exist");
  assert.equal(shop.occurrenceCount, 2);
  const security = transactions.find(
    (item) => item.senderOrg === "bank.example" && item.category === "security-alert"
  );
  assert.ok(security, "security alert lineage should remain separate");
  assert.equal(security.occurrenceCount, 1);
  const contract = transactions.find(
    (item) =>
      item.businessEntities?.contractIds?.some((value) => value.toLowerCase() === "cn-2024-7788")
  );
  assert.ok(contract, "contract lineage should be driven by business entity");
  assert.equal(contract.occurrenceCount, 2);
  assert.ok(contract.actionCategories.includes("approval") || contract.actionCategories.includes("request"));
  assert.ok(contract.attachmentTitles.includes("Atlas SOW v2.1"));
  assert.ok(contract.attachmentHashes.includes("a".repeat(64)));
  assert.equal(contract.messages.length, 2);
  assert.ok(contract.messages.some((message) => /Please review contract/.test(message.bodyText)));
  const beacon = transactions.find((item) =>
    item.businessEntities?.projectNames?.some((value) => /beacon/i.test(value))
  );
  assert.ok(beacon, "same participants but different project should remain separate");
  assert.equal(beacon.occurrenceCount, 1);
  const patreon = transactions.find((item) => item.title === "ElRelator 的 Patreon 订阅及发布通知");
  assert.ok(patreon, "Patreon creator publication should use actor + source + behavior title");
  assert.equal(patreon.occurrenceCount, 2);
  assert.equal(patreon.attention.actorBehaviorTitle, "ElRelator 的 Patreon 订阅及发布通知");
  assert.equal(patreon.attention.sourceBehaviorTitle, "Patreon 订阅及发布通知");
  assert.equal(
    patreon.attention.keys.some((key) => key.includes("harafung")),
    false,
    "different Patreon creators should not leak into the same transaction"
  );
  const patreonHarafung = transactions.find((item) => item.title === "harafung 的 Patreon 订阅及发布通知");
  assert.ok(patreonHarafung, "second Patreon creator should get its own actor transaction");
  assert.equal(patreonHarafung.occurrenceCount, 2);
  assert.equal(
    patreonHarafung.attention.keys.some((key) => key.includes("elrelator")),
    false,
    "Patreon actor boundary should be a hard merge guard"
  );
  const steamPromotion = transactions.find((item) => item.title === "Steam 促销活动");
  assert.ok(steamPromotion, "Steam sale should use source + behavior title");
  assert.equal(steamPromotion.occurrenceCount, 2);
  const ledgerBankStatement = transactions.find(
    (item) => item.senderOrg === "ledger-bank.example" && item.category === "financial-statement"
  );
  assert.ok(ledgerBankStatement, "generic bank statement lineage should exist");
  assert.equal(ledgerBankStatement.occurrenceCount, 2);
  const servicePromotion = transactions.find(
    (item) => item.senderOrg === "updates.example" && item.category === "marketing-series"
  );
  assert.ok(servicePromotion, "generic service promotion should stay separate from bank statements");
  assert.equal(servicePromotion.occurrenceCount, 2);

  await fs.writeFile(
    path.join(mailRoot, "bank-apr.eml"),
    eml({
      from: "Statements <statements@bank.example>",
      subject: "Your April statement is ready",
      date: "Mon, 01 Apr 2024 10:00:00 +0000",
      messageId: "bank-apr@example",
      body: "Your monthly account statement is ready."
    }),
    "utf8"
  );
  const second = await buildTransactionContinuityModel({
    roots: [mailRoot],
    outputPath,
    rebuild: false,
    maxDocs: 12,
    normalizedManifestPaths: [normalizedManifestPath]
  });
  const nextBank = second.summaries.find((item) => item.lineageId === bank.lineageId);
  assert.ok(nextBank, "incremental run should preserve the lineage id");
  assert.equal(nextBank.occurrenceCount, 4);
  assert.equal(second.manifest.stats.skippedUnchanged, fixtures.length);
  assert.ok(second.manifest.stats.transactionCount >= 3);
  await fs.access(path.join(outputPath, "transaction-overview.docx"));
  await fs.access(path.join(outputPath, "transactions.json"));
  const jsonFiles = await fs.readdir(path.join(outputPath, "transactions-json"));
  assert.ok(jsonFiles.some((fileName) => fileName.endsWith(".json")), "transaction JSON sidecars should exist");
  const jsonPayloads = await Promise.all(
    jsonFiles.map(async (fileName) =>
      JSON.parse(await fs.readFile(path.join(outputPath, "transactions-json", fileName), "utf8"))
    )
  );
  const contractPayload = jsonPayloads.find((payload) =>
    payload.businessEntities?.contractIds?.some((value) => value.toLowerCase() === "cn-2024-7788")
  );
  assert.ok(contractPayload, "contract machine-readable payload should exist");
  assert.equal(contractPayload.schemaVersion, "v0.0.1:knowledge:transaction-knowledge-2");
  assert.equal(contractPayload.overview.schemaVersion, "v0.0.1:transaction:transaction-overview-1");
  assert.equal(contractPayload.overview.occurrence.emailCount, 2);
  assert.equal(contractPayload.messages.length, 2);
  assert.ok(contractPayload.messages.some((message) => /Atlas-SOW-v2.1\.pdf/.test(message.bodyText)));
  const docxFiles = await fs.readdir(path.join(outputPath, "transactions"));
  const docxXmls = await Promise.all(
    docxFiles
      .filter((fileName) => fileName.endsWith(".docx"))
      .map((fileName) => docxDocumentXml(path.join(outputPath, "transactions", fileName)))
  );
  const contractDocxXml = docxXmls.find((xml) => xml.includes("CN-2024-7788") || xml.includes("Atlas SOW v2.1"));
  assert.ok(contractDocxXml, "contract DOCX should contain business content");
  assert.ok(contractDocxXml.includes("事务概览 YAML"), "DOCX should include YAML overview section");
  assert.ok(contractDocxXml.includes("v0.0.1:transaction:transaction-overview-1"), "DOCX should include machine-readable YAML overview");
  assert.equal(contractDocxXml.includes("这是一个"), false, "DOCX overview should not use natural-language template");
  assert.ok(contractDocxXml.includes("机器可读 JSON"), "DOCX should include machine-readable JSON appendix");
  process.stdout.write("Transaction continuity verification passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
