import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const routerFile = path.join(repoRoot, "server-web", "router", "index.ts");
const routerRoutesFile = path.join(repoRoot, "server-web", "router", "routes.ts");
const registryFile = path.join(repoRoot, "server", "config", "frontend-feature-registry.yaml");
const architectureFile = path.join(repoRoot, "docs", "Architecture.md");
const commonComponentsFile = path.join(repoRoot, "server-web", "components", "common.ts");
const drawerHostDefaultFile = "server-web/ServerConsoleApp.vue";

function normalizePosix(input) {
  return input.split(path.sep).join("/");
}

function sanitizeScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function parseRegistryYaml(text) {
  const lines = text.split(/\r?\n/);
  const routes = [];
  const systemConfigTabs = [];

  let version = null;
  let owner = null;
  let activeSection = "";
  let currentRoute = null;
  let currentSystemTab = null;
  let currentFeature = null;
  let inActions = false;

  function finalizeRoute() {
    if (currentRoute) {
      routes.push(currentRoute);
      currentRoute = null;
    }
  }

  function finalizeSystemTab() {
    if (currentSystemTab) {
      systemConfigTabs.push(currentSystemTab);
      currentSystemTab = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (line.startsWith("version:")) {
      version = Number(sanitizeScalar(line.slice("version:".length)));
      continue;
    }
    if (line.startsWith("owner:")) {
      owner = sanitizeScalar(line.slice("owner:".length));
      continue;
    }
    if (line.startsWith("routes:")) {
      finalizeRoute();
      finalizeSystemTab();
      activeSection = "routes";
      continue;
    }
    if (line.startsWith("systemConfigTabs:")) {
      finalizeRoute();
      finalizeSystemTab();
      activeSection = "systemConfigTabs";
      continue;
    }

    if (activeSection === "routes" && line.startsWith("  - routePath:")) {
      finalizeRoute();
      finalizeSystemTab();
      currentRoute = {
        routePath: sanitizeScalar(line.slice("  - routePath:".length)),
        viewFile: "",
        features: []
      };
      currentFeature = null;
      inActions = false;
      continue;
    }

    if (activeSection === "systemConfigTabs" && line.startsWith("  - tabId:")) {
      finalizeRoute();
      finalizeSystemTab();
      currentSystemTab = {
        tabId: sanitizeScalar(line.slice("  - tabId:".length)),
        hostFile: "",
        features: []
      };
      currentFeature = null;
      inActions = false;
      continue;
    }

    const currentEntry = activeSection === "routes" ? currentRoute : activeSection === "systemConfigTabs" ? currentSystemTab : null;
    if (!currentEntry) {
      continue;
    }

    if (activeSection === "routes" && line.startsWith("    viewFile:")) {
      currentEntry.viewFile = sanitizeScalar(line.slice("    viewFile:".length));
      inActions = false;
      continue;
    }

    if (activeSection === "systemConfigTabs" && line.startsWith("    hostFile:")) {
      currentEntry.hostFile = sanitizeScalar(line.slice("    hostFile:".length));
      inActions = false;
      continue;
    }

    if (line.startsWith("    features:")) {
      currentFeature = null;
      inActions = false;
      continue;
    }

    if (line.startsWith("      - featureId:")) {
      currentFeature = {
        featureId: sanitizeScalar(line.slice("      - featureId:".length)),
        actions: []
      };
      currentEntry.features.push(currentFeature);
      inActions = false;
      continue;
    }

    if (line.startsWith("        actions:")) {
      inActions = true;
      continue;
    }

    if (inActions && currentFeature && line.startsWith("          - ")) {
      const value = sanitizeScalar(line.slice("          - ".length));
      if (value) {
        currentFeature.actions.push(value);
      }
    }
  }

  finalizeRoute();
  finalizeSystemTab();

  return { version, owner, routes, systemConfigTabs };
}

function parseSystemConfigDrawerTabs(text) {
  const tabIds = new Set();
  const regex = /openDrawer\('([A-Za-z0-9_-]+)'\)/g;
  for (const match of text.matchAll(regex)) {
    tabIds.add(match[1]);
  }
  return tabIds;
}

async function readVueFileWithLocalImports(relativeFile, seen = new Set()) {
  const normalizedFile = normalizePosix(relativeFile);
  if (seen.has(normalizedFile)) {
    return "";
  }
  seen.add(normalizedFile);

  const absoluteFile = path.join(repoRoot, normalizedFile);
  const text = await fs.readFile(absoluteFile, "utf8");
  const importedTexts = [];
  const importRegex = /^import\s+[^;]+?\s+from\s+["'](\.{1,2}\/[^"']+\.vue)["'];?/gm;
  for (const match of text.matchAll(importRegex)) {
    const importedRelative = normalizePosix(
      path.posix.normalize(path.posix.join(path.posix.dirname(normalizedFile), match[1]))
    );
    importedTexts.push(await readVueFileWithLocalImports(importedRelative, seen));
  }

  return [text, ...importedTexts].join("\n");
}

async function listFiles(rootDir, predicate) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, predicate));
      continue;
    }
    if (entry.isFile() && predicate(absolutePath)) {
      files.push(absolutePath);
    }
  }
  return files;
}

function assertCommonComponentGovernance(commonText, architectureText) {
  for (const snippet of [
    "commonComponentReusePolicy",
    "能用通用组件就用通用组件",
    "能继承就继承",
    "commonComponentRegistry"
  ]) {
    assert.ok(commonText.includes(snippet), `server-web/components/common.ts must document common component reuse policy: ${snippet}`);
  }

  for (const snippet of [
    "server-web/components/common.ts",
    "能用通用组件就用通用组件",
    "能继承就继承",
    "先扩展通用组件"
  ]) {
    assert.ok(architectureText.includes(snippet), `docs/Architecture.md must document frontend reuse/inheritance rule: ${snippet}`);
  }

  for (const componentName of [
    "BinaryCheckbox",
    "OptionBar",
    "AgentModelOptionBar",
    "FeatureToggle",
    "StatusPill",
    "BrowseSelectButton",
    "ConfigFoldCard",
    "HistorySessionPanel",
    "InfoFeedResultRow"
  ]) {
    assert.ok(
      new RegExp(`name:\\s*"${componentName}"[\\s\\S]*?usageRule:\\s*"`).test(commonText),
      `common component registry must keep a usageRule for ${componentName}`
    );
  }
}

async function assertNoNativeCheckboxControls() {
  const vueFiles = await listFiles(
    path.join(repoRoot, "server-web"),
    (absolutePath) => absolutePath.endsWith(".vue")
  );
  const nativeCheckboxPattern = /<input\b(?=[^>]*\btype\s*=\s*["']checkbox["'])[^>]*>/i;
  const violations = [];
  for (const file of vueFiles) {
    const text = await fs.readFile(file, "utf8");
    if (nativeCheckboxPattern.test(text)) {
      violations.push(normalizePosix(path.relative(repoRoot, file)));
    }
  }
  assert.deepEqual(
    violations,
    [],
    "server-web pages must use BinaryCheckbox instead of native checkbox inputs"
  );
}

function validateFeatureTree(entry, {
  entryLabel,
  seenFeatureIds,
  seenActionIds,
}) {
  assert.ok(Array.isArray(entry.features) && entry.features.length > 0, `registry features must not be empty for ${entryLabel}`);
  for (const feature of entry.features) {
    assert.ok(feature.featureId, `featureId must not be empty for ${entryLabel}`);
    assert.ok(!seenFeatureIds.has(feature.featureId), `duplicate frontend feature id: ${feature.featureId}`);
    seenFeatureIds.add(feature.featureId);

    assert.ok(Array.isArray(feature.actions) && feature.actions.length > 0, `actions must not be empty for feature ${feature.featureId}`);
    for (const actionId of feature.actions) {
      assert.ok(actionId, `actionId must not be empty for feature ${feature.featureId}`);
      assert.ok(!seenActionIds.has(actionId), `duplicate frontend action id: ${actionId}`);
      seenActionIds.add(actionId);
    }
  }
}

function parseRouterMap(text) {
  assert.ok(
    !/^import\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from\s+"(\.\.\/views\/[^"]+\.vue)";$/m.test(text),
    "router views must be lazy-loaded instead of statically imported"
  );

  const componentMap = new Map();
  const importRegex = /^import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+"(\.\.\/views\/[^"]+\.vue)";$/gm;
  for (const match of text.matchAll(importRegex)) {
    const symbol = match[1];
    const relativeImport = match[2].replace(/^\.\.\//, "");
    componentMap.set(symbol, normalizePosix(path.join("server-web", relativeImport)));
  }

  const lazyConstRegex = /^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\(\)\s*=>\s*import\("(\.\.\/views\/[^"]+\.vue)"\);$/gm;
  for (const match of text.matchAll(lazyConstRegex)) {
    const symbol = match[1];
    const relativeImport = match[2].replace(/^\.\.\//, "");
    componentMap.set(symbol, normalizePosix(path.join("server-web", relativeImport)));
  }

  const routeComponentMap = new Map();
  const routesStart = text.indexOf("const routes:");
  const routesEnd = text.indexOf("];", routesStart);
  assert.ok(routesStart >= 0 && routesEnd > routesStart, "unable to locate routes array in router file");
  const routesText = text.slice(routesStart, routesEnd);

  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < routesText.length; i += 1) {
    const ch = routesText[i];
    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(routesText.slice(start, i + 1));
        start = -1;
      }
    }
  }

  for (const block of blocks) {
    if (!/\bcomponent\s*:/.test(block)) {
      continue;
    }
    const pathMatch = block.match(/\bpath\s*:\s*"([^"]+)"/);
    if (!pathMatch) {
      continue;
    }
    const routePath = pathMatch[1];
    const inlineLazyMatch = block.match(/\bcomponent\s*:\s*\(\)\s*=>\s*import\("(\.\.\/views\/[^"]+\.vue)"\)/);
    const componentMatch = block.match(/\bcomponent\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/);
    const viewFile = inlineLazyMatch
      ? normalizePosix(path.join("server-web", inlineLazyMatch[1].replace(/^\.\.\//, "")))
      : componentMatch
        ? componentMap.get(componentMatch[1])
        : null;
    if (viewFile) {
      routeComponentMap.set(routePath, viewFile);
    }
  }

  return routeComponentMap;
}

function assertKnowledgeTabRegistryMatchesRouter(registry, routerRoutesText) {
  const knowledgeRoute = registry.routes.find((entry) => entry.routePath === "/knowledge/:tab");
  assert.ok(knowledgeRoute, "registry must keep /knowledge/:tab route");
  const tabFeature = knowledgeRoute.features.find((feature) => feature.featureId === "knowledge.tab-navigation");
  assert.ok(tabFeature, "knowledge route must keep knowledge.tab-navigation feature");
  const actionTabs = tabFeature.actions
    .filter((actionId) => actionId.startsWith("knowledge.tab."))
    .map((actionId) => actionId.slice("knowledge.tab.".length))
    .map((tab) => tab === "word-cloud" ? "wordCloud" : tab)
    .sort();
  const routeTabs = [...routerRoutesText.matchAll(/"([A-Za-z][A-Za-z0-9-]*)"/g)]
    .map((match) => match[1])
    .filter((value) => ["management", "wordCloud", "maintenance", "chunking", "distillation"].includes(value))
    .sort();
  assert.deepEqual(
    [...new Set(actionTabs)],
    [...new Set(routeTabs)],
    "knowledge.tab.* registry actions must match supported knowledge route tabs"
  );
  assert.ok(
    routerRoutesText.includes("knowledgeRouteTabToViewTab") &&
      routerRoutesText.includes('value === "chunking"') &&
      routerRoutesText.includes('value === "distillation"'),
    "knowledge route aliases must map chunking and distillation back to a concrete view tab"
  );
}

async function main() {
  const [routerText, routerRoutesText, registryText, architectureText, commonText] = await Promise.all([
    fs.readFile(routerFile, "utf8"),
    fs.readFile(routerRoutesFile, "utf8"),
    fs.readFile(registryFile, "utf8"),
    fs.readFile(architectureFile, "utf8"),
    fs.readFile(commonComponentsFile, "utf8")
  ]);

  assertCommonComponentGovernance(commonText, architectureText);
  await assertNoNativeCheckboxControls();

  const routerMap = parseRouterMap(routerText);
  const registry = parseRegistryYaml(registryText);
  assertKnowledgeTabRegistryMatchesRouter(registry, routerRoutesText);

  assert.equal(registry.version, 1, "frontend feature registry version must be 1");
  assert.equal(registry.owner, "server-web", "frontend feature registry owner must be server-web");
  assert.ok(Array.isArray(registry.routes) && registry.routes.length > 0, "frontend feature registry routes must not be empty");

  const seenRoutePaths = new Set();
  const seenFeatureIds = new Set();
  const seenActionIds = new Set();
  const seenSystemTabs = new Set();

  for (const entry of registry.routes) {
    assert.ok(entry.routePath, "registry routePath must not be empty");
    assert.ok(entry.viewFile, `registry viewFile must not be empty for route ${entry.routePath}`);

    assert.ok(!seenRoutePaths.has(entry.routePath), `duplicate registry routePath: ${entry.routePath}`);
    seenRoutePaths.add(entry.routePath);

    validateFeatureTree(entry, {
      entryLabel: `route ${entry.routePath}`,
      seenFeatureIds,
      seenActionIds,
    });

    const expectedView = routerMap.get(entry.routePath);
    assert.ok(expectedView, `registry route not found in router: ${entry.routePath}`);
    assert.equal(entry.viewFile, expectedView, `registry view file mismatch for route ${entry.routePath}`);

    const absoluteViewPath = path.join(repoRoot, entry.viewFile);
    await fs.access(absoluteViewPath);
  }

  for (const [routePath] of routerMap.entries()) {
    assert.ok(seenRoutePaths.has(routePath), `frontend route is missing from registry: ${routePath}`);
  }

  assert.ok(Array.isArray(registry.systemConfigTabs) && registry.systemConfigTabs.length > 0, "systemConfigTabs must not be empty");
  const drawerHostText = await readVueFileWithLocalImports(drawerHostDefaultFile);
  const drawerTabIds = parseSystemConfigDrawerTabs(drawerHostText);

  for (const entry of registry.systemConfigTabs) {
    assert.ok(entry.tabId, "registry tabId must not be empty for systemConfigTabs entry");
    assert.ok(entry.hostFile, `registry hostFile must not be empty for system tab ${entry.tabId}`);
    assert.ok(!seenSystemTabs.has(entry.tabId), `duplicate system config tab id: ${entry.tabId}`);
    seenSystemTabs.add(entry.tabId);

    validateFeatureTree(entry, {
      entryLabel: `system tab ${entry.tabId}`,
      seenFeatureIds,
      seenActionIds,
    });

    const hostAbsolutePath = path.join(repoRoot, entry.hostFile);
    await fs.access(hostAbsolutePath);

    if (normalizePosix(entry.hostFile) === drawerHostDefaultFile) {
      assert.ok(drawerTabIds.has(entry.tabId), `system config tab is missing from drawer UI: ${entry.tabId}`);
    }
  }

  console.log(`frontend feature registry check passed: ${seenRoutePaths.size} routes, ${seenSystemTabs.size} system tabs, ${seenFeatureIds.size} features, ${seenActionIds.size} actions`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
