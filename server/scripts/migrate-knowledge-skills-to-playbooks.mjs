#!/usr/bin/env node
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";
import { createAgentLibraryPlaybookRuntime } from "../platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  const inline = process.argv.find((item) => item.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  return fallback;
}

const userDataPath = argValue("--user-data-path", process.env.PACT_USER_DATA_PATH || ServerConfig.getDataDir());
const runtime = createAgentLibraryPlaybookRuntime({
  userDataPath,
  runtime: { mounts: {} }
});

try {
  const result = runtime.migrateLegacySkillsToPlaybooks({
    writeBundles: !process.argv.includes("--no-bundles")
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  runtime.close();
}
