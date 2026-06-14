#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKnowledgeCoreMount } from "../platform/specialized/knowledge/storage/knowledge-core/index.mjs";
import {
  persistRawMailObject,
  resolveStoredObjectPath
} from "../platform/common/storage/raw-object-store.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-multi-source-"));
try {
  const originalBytes = Buffer.from("3 月巡检记录原始文件，不允许服务端追加检索字段。\n", "utf8");
  const rawObject = await persistRawMailObject({
    userDataPath,
    batchId: "client-batch-2026-03",
    buffer: originalBytes,
    originalRelativePath: "inspection-march.txt",
    mediaType: "text/plain",
    ingestOrigin: "connector-mirror",
    clientUid: "client-a",
    sourceType: "file",
    providerId: "google-drive",
    externalId: "drive-file-1",
    syncBatchId: "client-batch-2026-03",
    capturedAt: "2026-03-18T09:00:00.000Z",
    sourceMetadata: {
      originalPath: "/Ops/inspection-march.txt",
      owner: "ops@example.test"
    }
  });
  assert.match(rawObject.storageRelativePath, /^objects\/client-a\/file\//);
  assert.equal(rawObject.originalFileName, "inspection-march.txt");
  assert.deepEqual(
    await fs.readFile(resolveStoredObjectPath(userDataPath, rawObject.storageRelativePath)),
    originalBytes
  );

  const knowledgeCore = await createKnowledgeCoreMount({ userDataPath });
  try {
    const ingest = await knowledgeCore.ingestSources({
      batchId: "client-batch-2026-03",
      generatedAt: "2026-03-18T09:30:00.000Z",
      sources: [
        {
          id: "gmail-message-1",
          name: "Gmail 3 月巡检提醒",
          path: "gmail://message/gmail-message-1",
          kind: "mail",
          text: "3 月巡检记录已经发送，请查看 Drive 中的 inspection-march.txt。",
          clientUid: "client-a",
          sourceType: "mail",
          providerId: "gmail",
          externalId: "gmail-message-1",
          syncBatchId: "client-batch-2026-03",
          capturedAt: "2026-03-18T08:00:00.000Z",
          sourceMetadata: {
            mailbox: "INBOX"
          }
        },
        {
          id: "drive-file-1",
          name: "inspection-march.txt",
          path: "drive://files/drive-file-1",
          kind: "file",
          text: "3 月巡检记录包含 12 个检查项，复核截止日期为 2026-03-31。",
          rawObject,
          clientUid: "client-a",
          sourceType: "file",
          providerId: "google-drive",
          externalId: "drive-file-1",
          syncBatchId: "client-batch-2026-03",
          capturedAt: "2026-03-18T09:00:00.000Z",
          sourceMetadata: {
            originalPath: "/Ops/inspection-march.txt"
          }
        },
        {
          id: "slack-message-1",
          name: "Ops channel",
          path: "slack://workspace-a/ops/slack-message-1",
          kind: "chat",
          text: "Operator 在频道里确认：3 月巡检记录已经归档到 Google Drive。",
          clientUid: "client-a",
          sourceType: "chat",
          providerId: "slack",
          externalId: "slack-message-1",
          syncBatchId: "client-batch-2026-03",
          capturedAt: "2026-03-18T10:00:00.000Z",
          sourceMetadata: {
            workspaceId: "workspace-a",
            conversationId: "ops"
          }
        }
      ]
    });
    assert.equal(ingest.documentCount, 3);

    const result = knowledgeCore.search({
      query: "3 月巡检记录",
      limit: 10,
      keywordOnly: true
    });
    const providers = new Set(result.items.map((item) => item.source?.providerId).filter(Boolean));
    assert.equal(providers.has("gmail"), true);
    assert.equal(providers.has("google-drive"), true);
    assert.equal(providers.has("slack"), true);

    const slackHit = result.items.find((item) => item.source?.providerId === "slack");
    assert.equal(slackHit.source.sourceType, "chat");
    assert.equal(slackHit.source.chatRef.externalId, "slack-message-1");
    assert.equal(slackHit.source.syncBatchId, "client-batch-2026-03");

    const driveHit = result.items.find((item) => item.source?.providerId === "google-drive");
    assert.equal(driveHit.source.fileRef.originalFileName, "inspection-march.txt");
    assert.equal(driveHit.source.fileRef.storageRelativePath, rawObject.storageRelativePath);

    const evidence = knowledgeCore.getEvidence({ evidenceId: slackHit.evidenceId });
    assert.equal(evidence.locator.providerId, "slack");
    assert.equal(evidence.locator.chatRef.syncBatchId, "client-batch-2026-03");

    const fusedSearch = knowledgeCore.search({
      query: "3 月巡检记录",
      limit: 10,
      keywordOnly: true,
      explain: true,
      localQuery: {
        ok: true,
        source: "local-data-connectors",
        items: [
          {
            sourceType: "chat",
            providerId: "teams",
            externalId: "teams-message-1",
            title: "Teams 运维提醒",
            snippet: "3 月巡检记录的复核任务暂存在 Teams，本地 mirror 尚未上传服务端。",
            timestamp: "2026-03-18T11:00:00.000Z",
            chatRef: {
              workspaceId: "tenant-a",
              conversationId: "ops",
              messageId: "teams-message-1",
              syncBatchId: "client-batch-2026-03"
            },
            score: 0.99
          },
          {
            sourceType: "chat",
            providerId: "slack",
            externalId: "slack-message-1",
            title: "Slack duplicate",
            snippet: "这是已经入库的 Slack 消息本地 mirror 副本。",
            timestamp: "2026-03-18T10:00:00.000Z",
            chatRef: {
              workspaceId: "workspace-a",
              conversationId: "ops",
              messageId: "slack-message-1",
              syncBatchId: "client-batch-2026-03"
            },
            score: 0.95
          }
        ]
      }
    });
    assert.equal(fusedSearch.fusion.mode, "server-index-plus-local-mirror");
    assert.equal(fusedSearch.fusion.localQueryRemoteCalls, false);
    assert.equal(fusedSearch.fusion.localHitCount, 2);
    assert.equal(fusedSearch.fusion.localMergedCount, 1);
    assert.equal(fusedSearch.fusion.localAppendedCount, 1);
    const teamsLocalHit = fusedSearch.items.find((item) => item.localMirror?.providerId === "teams");
    assert.ok(teamsLocalHit, "local-only Teams mirror hit should be returned");
    assert.equal(Boolean(teamsLocalHit.evidenceId), false);
    assert.equal(teamsLocalHit.localMirror.openable, false);
    assert.equal(teamsLocalHit.localMirror.status, "local_mirror_not_yet_ingested");
    const mergedSlackHit = fusedSearch.items.find((item) => item.source?.providerId === "slack");
    assert.equal(mergedSlackHit.localMirror.status, "local_mirror_duplicate_of_indexed_evidence");
    const scores = fusedSearch.items.map((item) => Number(item.finalScore || item.score || 0));
    assert.deepEqual(scores, [...scores].sort((left, right) => right - left));
  } finally {
    await knowledgeCore.close();
  }

  console.log("verify-multi-source-connectors: ok");
} finally {
  if (process.env.PACT_KEEP_TEST_DATA !== "1") {
    await fs.rm(userDataPath, { recursive: true, force: true });
  } else {
    console.log(`kept test data: ${userDataPath}`);
  }
}
