import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function assertIncludes(text, pattern, message) {
  assert.match(text, pattern, message);
}

function assertExcludes(text, pattern, message) {
  assert.doesNotMatch(text, pattern, message);
}

async function main() {
  const browserStorage = await read("server-web/lib/browser-storage.ts");
  const agentExploreUtils = await read("server-web/composables/console-agent-explore-utils.ts");
  const agentExplorePersistence = await read("server-web/composables/console-agent-explore-persistence.ts");
  const infoFeedHistory = await read("server-web/composables/console-info-feed-history-controller.ts");

  assertIncludes(
    browserStorage,
    /export type BrowserStorageLike = Pick<Storage, "getItem" \| "setItem">;/,
    "browser storage helper must keep injectable storage support for isolated cache migration tests",
  );
  assertIncludes(
    browserStorage,
    /catch\s*{\s*return fallbackValue;\s*}/,
    "browser JSON storage reads must fall back on malformed cached payloads",
  );
  assertIncludes(
    browserStorage,
    /catch\s*{\s*return false;\s*}/,
    "browser JSON storage writes must fail closed when serialization or storage fails",
  );

  assertIncludes(
    agentExplorePersistence,
    /export const AGENT_EXPLORE_STORAGE_VERSION = 1;/,
    "agent explore persistence must declare a versioned cache contract",
  );
  assertIncludes(
    agentExplorePersistence,
    /"version" in record[\s\S]*AGENT_EXPLORE_STORAGE_VERSION[\s\S]*return record;/,
    "agent explore persistence must read supported versioned payloads and legacy flat payloads",
  );
  assertIncludes(
    agentExplorePersistence,
    /version:\s*AGENT_EXPLORE_STORAGE_VERSION,[\s\S]*payload,/,
    "agent explore persistence writes must use a versioned envelope",
  );
  assertIncludes(
    agentExplorePersistence,
    /hiddenRunIds:\s*boundedStorageIdList\(options\.hiddenRunIds\)/,
    "agent explore persistence must cap hidden run id cache growth",
  );
  assertIncludes(
    agentExplorePersistence,
    /closedTabIds:\s*boundedStorageIdList\(options\.closedTabIds\)/,
    "agent explore persistence must cap closed tab id cache growth",
  );
  assertExcludes(
    agentExploreUtils,
    /AGENT_EXPLORE_STORAGE_VERSION|readAgentExplorePersistence|writeAgentExplorePersistence|boundedStorageIdList/,
    "agent explore utility helpers must delegate browser cache ownership to the persistence module",
  );
  assertExcludes(
    agentExplorePersistence,
    /globalThis\.localStorage|localStorage\.getItem|localStorage\.setItem/,
    "agent explore persistence must not use browser storage directly",
  );

  assertIncludes(
    infoFeedHistory,
    /const INFO_FEED_HISTORY_STORAGE_VERSION = 1;/,
    "info-feed history must declare a versioned cache contract",
  );
  assertIncludes(
    infoFeedHistory,
    /hasVersion && !isSupportedVersion[\s\S]*return \[\];/,
    "info-feed history must reject unsupported cache versions",
  );
  assertIncludes(
    infoFeedHistory,
    /version:\s*INFO_FEED_HISTORY_STORAGE_VERSION,[\s\S]*history,/,
    "info-feed history writes must include versioned payloads",
  );
  assertExcludes(
    infoFeedHistory,
    /window\.localStorage|localStorage\.getItem|localStorage\.setItem|JSON\.parse\([^)]*localStorage/,
    "info-feed history must not hand-roll localStorage JSON parsing",
  );

  console.log("frontend cache storage check passed: versioned browser JSON caches are centralized");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
