import fs from "node:fs/promises";
import path from "node:path";

const UI_ROUTE_RULES = Object.freeze([
  {
    routeId: "workspaces",
    chunkPrefix: "WorkspacesView",
    navItems: ["workspaces"],
    panels: ["WorkspacesPanel"]
  },
  {
    routeId: "dashboard",
    chunkPrefix: "DashboardView",
    navItems: ["dashboard"],
    panels: ["DashboardPanel"]
  },
  {
    routeId: "feed",
    chunkPrefix: "FeedView",
    navItems: ["feed"],
    panels: ["InfoFeedPanel"]
  },
  {
    routeId: "approval",
    chunkPrefix: "ApprovalFlowView",
    navItems: ["approval"],
    panels: ["ApprovalFlowPanel"]
  },
  {
    routeId: "sources",
    chunkPrefix: "SourcesView",
    navItems: ["sources"],
    panels: ["KnowledgeSourcesPanel"]
  },
  {
    routeId: "knowledge",
    chunkPrefix: "KnowledgeView",
    navItems: [
      "knowledge.management",
      "knowledge.wordCloud",
      "knowledge.logs",
      "knowledge.maintenance",
      "knowledge.distillation"
    ],
    panels: [
      "KnowledgeManagementPanel",
      "KnowledgeWordCloudPanel",
      "KnowledgeDistillationWorkbench"
    ]
  },
  {
    routeId: "debug",
    chunkPrefix: "DebugView",
    navItems: [
      "debug.knowledgeRecall",
      "debug.agentRetrieval",
      "debug.knowledgeDistillation"
    ],
    panels: [
      "KnowledgeRecallDebugPanel",
      "AgentRetrievalDebugPanel",
      "KnowledgeDistillationDebugPanel"
    ]
  },
  {
    routeId: "admin.storage",
    chunkPrefix: "StorageView",
    navItems: ["admin.storage"],
    panels: ["StoragePanel"]
  },
  {
    routeId: "admin.jobs",
    chunkPrefix: "JobsView",
    navItems: ["admin.jobs"],
    panels: ["WorkQueuePanel"]
  },
  {
    routeId: "admin.logs",
    chunkPrefix: "LogsView",
    navItems: ["admin.logs"],
    panels: ["LogPanel"]
  },
  {
    routeId: "admin.opsMonitor",
    chunkPrefix: "OpsMonitorView",
    navItems: ["admin.opsMonitor"],
    panels: ["OpsMonitorPanel", "ClientRuntimeHeatmap"]
  },
  {
    routeId: "admin.runtimeDownloads",
    chunkPrefix: "RuntimeDownloadsView",
    navItems: ["admin.runtimeDownloads"],
    panels: ["RuntimeDownloadsPanel"]
  },
  {
    routeId: "admin.productionHealth",
    chunkPrefix: "ProductionHealthView",
    navItems: ["admin.productionHealth"],
    panels: ["ProductionHealthPanel"]
  },
  {
    routeId: "admin.clients",
    chunkPrefix: "ClientsView",
    navItems: ["admin.clients"],
    panels: ["ClientPanel"]
  },
  {
    routeId: "admin.tools",
    chunkPrefix: "ToolsView",
    navItems: ["admin.toolList", "admin.toolStats"],
    panels: ["ToolManagementPanel"]
  },
  {
    routeId: "admin.modules",
    chunkPrefix: "ModulesView",
    navItems: ["admin.modules"],
    panels: ["ModuleManagementPanel"]
  },
  {
    routeId: "admin.agentPermissions",
    chunkPrefix: "AgentPermissionsView",
    navItems: ["admin.agentPermissions"],
    panels: ["AgentPermissionPanel"]
  },
  {
    routeId: "admin.agentConfig",
    chunkPrefix: "AgentConfigView",
    navItems: ["admin.agentConfig"],
    panels: ["AgentConfigPanel"]
  },
  {
    routeId: "admin.contextManagement",
    chunkPrefix: "ContextManagementView",
    navItems: ["admin.contextManagement"],
    panels: ["ContextManagementPanel"]
  },
  {
    routeId: "admin.maintenanceAgent",
    chunkPrefix: "MaintenanceAgentView",
    navItems: ["admin.maintenanceAgent"],
    panels: ["MaintenanceAgentPanel"]
  }
]);

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root, relativeRoot = "") {
  const absoluteRoot = path.join(root, relativeRoot);
  const entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function parseViteDependencyMap(indexText) {
  const match = indexText.match(/m\.f\|\|\(m\.f=(\[[\s\S]*?\])\)\)\)/);
  if (!match) {
    return [];
  }
  return JSON.parse(match[1]).map((item) => String(item || "").replace(/^\//, ""));
}

function parseViteRouteDeps(indexText, dependencyMap) {
  const routeDeps = new Map();
  const regex = /import\("\.\/([^"]+?\.js)"\),__vite__mapDeps\(\[([0-9,\s]*)\]\)/g;
  let match;
  while ((match = regex.exec(indexText)) !== null) {
    const importAsset = `assets/${match[1]}`;
    const indexes = match[2]
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item >= 0);
    routeDeps.set(importAsset, uniqueStrings([
      importAsset,
      ...indexes.map((index) => dependencyMap[index]).filter(Boolean)
    ]));
  }
  return routeDeps;
}

function routeEnabled(rule, activeNavItems, activePanels) {
  return (
    rule.navItems.some((item) => activeNavItems.has(item)) ||
    rule.panels.some((item) => activePanels.has(item))
  );
}

function matchingRouteEntry(routeDeps, chunkPrefix) {
  for (const [asset, deps] of routeDeps.entries()) {
    const basename = path.basename(asset);
    if (basename.startsWith(`${chunkPrefix}-`) && basename.endsWith(".js")) {
      return { asset, deps };
    }
  }
  return null;
}

function matchingAssets(files, chunkPrefix) {
  return files
    .filter((file) => file.startsWith("assets/"))
    .filter((file) => path.basename(file).startsWith(`${chunkPrefix}-`))
    .sort();
}

function assetsReferencedByHtml(indexHtml) {
  const assets = [];
  const regex = /(?:src|href)="\/?(assets\/[^"]+)"/g;
  let match;
  while ((match = regex.exec(indexHtml)) !== null) {
    assets.push(match[1]);
  }
  return uniqueStrings(assets);
}

function coreAsset(file) {
  const basename = path.basename(file);
  return (
    basename.startsWith("index-") ||
    basename.startsWith("vendor-") ||
    basename.startsWith("vue-") ||
    basename.startsWith("element-plus-") ||
    basename.startsWith("favicon-")
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patchInactiveRouteImports(indexJsText, inactiveRouteReports) {
  let nextText = indexJsText;
  const patchedRoutes = [];
  const unpatchedRoutes = [];
  for (const route of inactiveRouteReports) {
    const routeJsAsset = (route.assets || []).find((asset) => {
      const basename = path.basename(asset);
      return basename.startsWith(`${route.chunkPrefix}-`) && basename.endsWith(".js");
    });
    if (!routeJsAsset) {
      continue;
    }
    const basename = path.basename(routeJsAsset);
    const pattern = new RegExp(
      `component:\\(\\)=>ae\\(\\(\\)=>import\\("\\./${escapeRegExp(basename)}"\\),__vite__mapDeps\\(\\[[^\\]]*\\]\\)\\)`,
      "g"
    );
    let patched = false;
    nextText = nextText.replace(pattern, () => {
      patched = true;
      return 'redirect:"/"';
    });
    if (patched) {
      patchedRoutes.push(route.routeId);
    } else {
      unpatchedRoutes.push({
        routeId: route.routeId,
        asset: routeJsAsset
      });
    }
  }
  return {
    text: nextText,
    patchedRoutes: uniqueStrings(patchedRoutes),
    unpatchedRoutes
  };
}

async function readDistGraph(distRoot) {
  const indexHtmlPath = path.join(distRoot, "index.html");
  const indexHtml = await fs.readFile(indexHtmlPath, "utf8");
  const files = await listFiles(distRoot);
  const indexJsAsset = files
    .filter((file) => file.startsWith("assets/"))
    .find((file) => /^index-[^/]+\.js$/.test(path.basename(file)));
  if (!indexJsAsset) {
    throw new Error(`No Vite index JS asset found in ${distRoot}`);
  }
  const indexJsText = await fs.readFile(path.join(distRoot, indexJsAsset), "utf8");
  const dependencyMap = parseViteDependencyMap(indexJsText);
  const routeDeps = parseViteRouteDeps(indexJsText, dependencyMap);
  return {
    files,
    indexHtml,
    indexJsAsset,
    indexJsText,
    dependencyMap,
    routeDeps
  };
}

export async function applyFeatureUiPlan(targetRoot, packagingPlan = {}) {
  const distRoot = path.join(targetRoot, "build", "dist");
  const featureProfileDir = path.join(targetRoot, "feature-profile");
  await fs.mkdir(featureProfileDir, { recursive: true });

  if (!(await pathExists(path.join(distRoot, "index.html")))) {
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      trimSkipped: true,
      reason: "build/dist/index.html is missing",
      ok: false
    };
    await fs.writeFile(
      path.join(featureProfileDir, "ui-layout-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
    return report;
  }

  const packagePlan = packagingPlan.featurePackagePlan || {};
  const activeNavItems = new Set(uniqueStrings(packagePlan.webNavItems || []));
  const activePanels = new Set(uniqueStrings(packagePlan.webPanels || []));
  const activeFeatureIds = uniqueStrings(packagingPlan.featureProfile?.activeFeatureIds || []);
  const graph = await readDistGraph(distRoot);
  const filesBefore = graph.files;
  const keepAssets = new Set([
    ...assetsReferencedByHtml(graph.indexHtml),
    ...filesBefore.filter(coreAsset)
  ]);
  const routeAssetUniverse = new Set();

  const routeReports = UI_ROUTE_RULES.map((rule) => {
    const enabled = routeEnabled(rule, activeNavItems, activePanels);
    const routeEntry = matchingRouteEntry(graph.routeDeps, rule.chunkPrefix);
    const fallbackAssets = matchingAssets(filesBefore, rule.chunkPrefix);
    const assets = uniqueStrings(routeEntry?.deps?.length ? routeEntry.deps : fallbackAssets);
    for (const asset of assets) {
      routeAssetUniverse.add(asset);
    }
    if (enabled) {
      for (const asset of assets) {
        keepAssets.add(asset);
      }
    }
    return {
      routeId: rule.routeId,
      chunkPrefix: rule.chunkPrefix,
      enabled,
      navItems: rule.navItems,
      panels: rule.panels,
      assets
    };
  });

  const removedAssets = [];
  const inactiveRouteReports = routeReports.filter((route) => !route.enabled);
  const routeImportPatch = patchInactiveRouteImports(graph.indexJsText, inactiveRouteReports);
  await fs.writeFile(path.join(distRoot, graph.indexJsAsset), routeImportPatch.text, "utf8");

  for (const asset of [...routeAssetUniverse].sort()) {
    if (keepAssets.has(asset)) {
      continue;
    }
    const absolutePath = path.join(distRoot, asset);
    if (await pathExists(absolutePath)) {
      await fs.rm(absolutePath, { force: true });
      removedAssets.push(asset);
    }
  }

  const filesAfter = await listFiles(distRoot);
  const filesAfterSet = new Set(filesAfter);
  const missingActiveRouteAssets = [];
  const inactiveRouteAssetsRemaining = [];
  for (const route of routeReports) {
    const directAssets = matchingAssets(filesAfter, route.chunkPrefix);
    if (route.enabled && directAssets.length === 0) {
      missingActiveRouteAssets.push({
        routeId: route.routeId,
        chunkPrefix: route.chunkPrefix,
        expectedAssets: route.assets
      });
    }
    if (!route.enabled && directAssets.length > 0) {
      inactiveRouteAssetsRemaining.push({
        routeId: route.routeId,
        chunkPrefix: route.chunkPrefix,
        assets: directAssets
      });
    }
  }

  const missingKeptAssets = [...keepAssets]
    .filter((asset) => asset.startsWith("assets/"))
    .filter((asset) => !filesAfterSet.has(asset));
  const activeRoutes = routeReports.filter((route) => route.enabled).map((route) => route.routeId).sort();
  const inactiveRoutes = routeReports.filter((route) => !route.enabled).map((route) => route.routeId).sort();
  const uiManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activeFeatureIds,
    activeWebNavItems: [...activeNavItems].sort(),
    activeWebPanels: [...activePanels].sort(),
    activeRoutes,
    inactiveRoutes,
    keptAssets: [...keepAssets].sort(),
    removedAssets,
    patchedRoutes: routeImportPatch.patchedRoutes
  };
  await fs.writeFile(
    path.join(distRoot, "composition-ui-manifest.json"),
    `${JSON.stringify(uiManifest, null, 2)}\n`,
    "utf8"
  );

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    trimSkipped: false,
    ok:
      missingActiveRouteAssets.length === 0 &&
      inactiveRouteAssetsRemaining.length === 0 &&
      missingKeptAssets.length === 0,
    activeFeatureIds,
    activeWebNavItems: [...activeNavItems].sort(),
    activeWebPanels: [...activePanels].sort(),
    activeRoutes,
    inactiveRoutes,
    routeAssets: routeReports,
    removedAssets,
    keptAssetCount: keepAssets.size,
    removedAssetCount: removedAssets.length,
    assetCountBefore: filesBefore.filter((file) => file.startsWith("assets/")).length,
    assetCountAfter: filesAfter.filter((file) => file.startsWith("assets/")).length,
    patchedRoutes: routeImportPatch.patchedRoutes,
    unpatchedRoutes: routeImportPatch.unpatchedRoutes,
    missingActiveRouteAssets,
    inactiveRouteAssetsRemaining,
    missingKeptAssets
  };
  await fs.writeFile(
    path.join(featureProfileDir, "ui-layout-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  return report;
}
