#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const threshold = Number(process.env.PACT_UNIT_COVERAGE_THRESHOLD || 95);
const gateScopeMode = process.env.PACT_UNIT_COVERAGE_SCOPE || "all";
const allowMissingReports = process.env.PACT_UNIT_COVERAGE_ALLOW_MISSING === "1";

const scopedGates = [
  {
    id: "scope:maintenance-agent-config",
    label: "server/services/agent/maintenance-agent/config.mjs",
    file: "server/services/agent/maintenance-agent/config.mjs",
    area: "server",
  },
  {
    id: "scope:server-web-routes",
    label: "server-web/router/routes.ts",
    file: "server-web/router/routes.ts",
    area: "server-web",
  },
  {
    id: "scope:console-format-utils",
    label: "server-web/composables/console-format-utils.ts",
    file: "server-web/composables/console-format-utils.ts",
    area: "server-web",
  },
];

function firstExistingCoverageReport(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(repoRoot, candidate))) {
      return candidate;
    }
  }
  return candidates[0];
}

const reports = {
  nodeVue: process.env.PACT_UNIT_COVERAGE_NODE_VUE_REPORT || firstExistingCoverageReport([
    "build/coverage/node-vue/lcov.info",
    "build/coverage/node-vue-non-acp-strict/lcov.info",
    "build/coverage/node-vue-non-acp/lcov.info",
  ]),
  clientGui: process.env.PACT_UNIT_COVERAGE_CLIENT_GUI_REPORT || "build/coverage/client-gui/lcov.info",
  clientCli: process.env.PACT_UNIT_COVERAGE_CLIENT_CLI_REPORT || "build/coverage/client-cli/lcov.info",
};

function normalizeCoveragePath(value) {
  return path.posix.normalize(value.replace(/^\.\//u, ""));
}

function isScopedFileMatch(sourceFile, scopedFile) {
  const normalizedSource = normalizeCoveragePath(sourceFile);
  const normalizedScoped = normalizeCoveragePath(scopedFile);
  return (
    normalizedSource === normalizedScoped ||
    normalizedSource.endsWith(`/${normalizedScoped}`)
  );
}

function scopedTargetsForSource(sourceFile) {
  return scopedGates.filter((scope) => isScopedFileMatch(sourceFile, scope.file));
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing coverage report: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function emptyMetric() {
  return { hit: 0, found: 0 };
}

function addLine(metric, line) {
  if (line.startsWith("LF:")) {
    metric.found += Number(line.slice(3)) || 0;
  } else if (line.startsWith("LH:")) {
    metric.hit += Number(line.slice(3)) || 0;
  }
}

function percentage(metric) {
  return metric.found > 0 ? (metric.hit / metric.found) * 100 : 0;
}

function parseSingleReport(relativePath) {
  const metric = emptyMetric();
  for (const line of readText(relativePath).split(/\r?\n/u)) {
    addLine(metric, line);
  }
  return metric;
}

function parseNodeVueReport(relativePath) {
  const scopedMetrics = Object.fromEntries(
    scopedGates.map((scope) => [scope.id, emptyMetric()]),
  );
  const metrics = {
    server: emptyMetric(),
    "server-web": emptyMetric(),
  };
  const scopedSources = [];
  let currentArea = "";
  let currentScopes = [];

  for (const line of readText(relativePath).split(/\r?\n/u)) {
    if (line.startsWith("SF:")) {
      const sourceFile = line.slice(3);
      const normalizedSourceFile = normalizeCoveragePath(sourceFile);
      if (normalizedSourceFile.startsWith("server/")) {
        currentArea = "server";
      } else if (normalizedSourceFile.startsWith("server-web/")) {
        currentArea = "server-web";
      } else {
        currentArea = "";
      }

      currentScopes = scopedTargetsForSource(normalizedSourceFile);
      for (const scope of currentScopes) {
        if (!scopedSources.includes(scope.id)) {
          scopedSources.push(scope.id);
        }
      }
      continue;
    }
    if (currentArea) {
      addLine(metrics[currentArea], line);
      for (const scope of currentScopes) {
        addLine(scopedMetrics[scope.id], line);
      }
    }
  }

  return {
    areas: metrics,
    scoped: scopedMetrics,
  };
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function main() {
  const missingReports = Array.from(new Set([
    reports.nodeVue,
    reports.clientGui,
    reports.clientCli,
  ])).filter((report) => !fs.existsSync(path.join(repoRoot, report)));
  if (missingReports.length > 0 && allowMissingReports) {
    console.log("Unit coverage gate skipped because coverage reports are unavailable in this job.");
    for (const report of missingReports) {
      console.log(`- Missing coverage report: ${report}`);
    }
    return;
  }

  const nodeVueMetrics = parseNodeVueReport(reports.nodeVue);
  const checks = [
    {
      id: "server",
      report: reports.nodeVue,
      metric: nodeVueMetrics.areas.server,
    },
    {
      id: "server-web",
      report: reports.nodeVue,
      metric: nodeVueMetrics.areas["server-web"],
    },
    {
      id: "client-gui",
      report: reports.clientGui,
      metric: parseSingleReport(reports.clientGui),
    },
    {
      id: "client-cli",
      report: reports.clientCli,
      metric: parseSingleReport(reports.clientCli),
    },
  ];

  const scopedChecks = scopedGates.map((scope) => ({
    ...scope,
    metric: nodeVueMetrics.scoped[scope.id] || emptyMetric(),
    report: reports.nodeVue,
  }));

  console.log(`Unit coverage gate: ${gateScopeMode} scope, threshold ${formatPercent(threshold)}`);
  console.log("Area          Coverage   Covered / Total   Report");
  console.log("------------  ---------  ----------------  ------------------------------");

  const failures = [];
  for (const check of checks) {
    const actual = percentage(check.metric);
    const passed = actual > threshold;
    const ratio = `${check.metric.hit} / ${check.metric.found}`;
    console.log(
      `${check.id.padEnd(12)}  ${formatPercent(actual).padStart(9)}  ${ratio.padStart(16)}  ${check.report}`
    );
    if (!passed) {
      failures.push({ ...check, actual });
    }
  }

  const scopedFailures = [];
  for (const check of scopedChecks) {
    const actual = percentage(check.metric);
    const passed = actual > threshold;
    const ratio = `${check.metric.hit} / ${check.metric.found}`;
    const scopeLabel = check.label;
    console.log(
      `${check.id.padEnd(24)}  ${formatPercent(actual).padStart(9)}  ${ratio.padStart(16)}  ${scopeLabel}`
    );
    if (!passed) {
      scopedFailures.push({ ...check, actual, ratio });
    }
  }

  const scopeBacklog = scopedChecks.filter((check) => check.metric.found > 0 && percentage(check.metric) <= threshold);
  if (scopeBacklog.length) {
    console.log("\nScoped pilot backlog (real coverage to reach 95%):");
    for (const backlog of scopeBacklog) {
      const need = backlog.metric.found - backlog.metric.hit;
      console.log(`- ${backlog.label}: short ${need.toFixed(0)} lines/functions`);
    }
  }

  const enforcedFailures = gateScopeMode === "pilot" ? scopedFailures : failures;

  if (enforcedFailures.length) {
    console.error("");
    const failed = enforcedFailures
      .map((item) => `${item.id} ${formatPercent(item.actual || percentage(item.metric))}`)
      .join(", ");
    console.error(`Coverage gate failed (${gateScopeMode} mode): ${failed}`);
    process.exit(1);
  }

  console.log("");
  console.log("Coverage gate passed.");
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
