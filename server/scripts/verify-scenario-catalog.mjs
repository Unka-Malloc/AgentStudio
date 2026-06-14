#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const scenarioRoot = path.join(repoRoot, "docs", "scenarios");
const catalogPath = path.join(scenarioRoot, "scenario-catalog.json");
const readmePath = path.join(scenarioRoot, "README.md");
const implementationGapsPath = path.join(
  repoRoot,
  "docs",
  "reports",
  "history",
  "SCENARIO-IMPLEMENTATION-GAPS.md"
);

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const readme = await fs.readFile(readmePath, "utf8");
const implementationGaps = await fs.readFile(implementationGapsPath, "utf8");

assert.equal(catalog.schemaVersion, "v0.0.1:schema:definition-1", "unexpected scenario catalog schema version");
assert.equal(catalog.originalDesignScenarioCount, 16, "original design scenario count must remain 16");
assert.equal(catalog.confirmedScenarioCount, 8, "confirmed scenario count must be 8");
assert.equal(catalog.confirmedScenarios.length, catalog.confirmedScenarioCount, "confirmed scenario list count mismatch");
assert.deepEqual(catalog.unconfirmedScenarioSlots, [9, 10, 11, 12, 13, 14, 15, 16], "unconfirmed slots must remain 9-16");

const expectedIds = [
  "agent-code-submission",
  "knowledge-distillation",
  "permission-configuration",
  "workspace-file-transfer",
  "skill-management",
  "cloud-drive-sharing",
  "operation-logging",
  "risk-approval-flow"
];

const actualIds = catalog.confirmedScenarios.map((entry) => entry.id);
assert.deepEqual(actualIds, expectedIds, "confirmed scenario order changed");
assert.equal(readme.includes("SCENARIO-IMPLEMENTATION-GAPS.md"), true, "README missing scenario implementation gaps document");
assert.equal(implementationGaps.includes("# 八个已确认场景实现差距清单"), true, "implementation gaps document missing title");
for (const priority of ["## P0", "## P1", "## P2"]) {
  assert.equal(implementationGaps.includes(priority), true, `implementation gaps document missing ${priority}`);
}

const requiredModuleHeadings = [
  "#### 接入层",
  "#### 调度层",
  "#### 安全治理层",
  "#### 业务能力层",
  "#### 数据与观测层"
];

function sectionBetween(content, startHeading, endHeading) {
  const start = content.indexOf(startHeading);
  if (start < 0) {
    return "";
  }
  const afterStart = start + startHeading.length;
  const end = endHeading ? content.indexOf(endHeading, afterStart) : -1;
  return content.slice(afterStart, end >= 0 ? end : undefined).trim();
}

const numbers = new Set();
for (const entry of catalog.confirmedScenarios) {
  assert.equal(typeof entry.number, "number", `scenario ${entry.id} number missing`);
  assert.equal(numbers.has(entry.number), false, `duplicate scenario number ${entry.number}`);
  numbers.add(entry.number);
  assert.equal(entry.number >= 1 && entry.number <= 8, true, `scenario ${entry.id} number out of confirmed range`);
  assert.ok(entry.title, `scenario ${entry.id} title missing`);
  assert.ok(entry.entry, `scenario ${entry.id} entry missing`);
  assert.ok(entry.endpoint, `scenario ${entry.id} endpoint missing`);
  assert.ok(entry.document, `scenario ${entry.id} document missing`);
  assert.equal(readme.includes(entry.document), true, `README missing scenario document ${entry.document}`);
  const documentPath = path.join(scenarioRoot, entry.document);
  const content = await fs.readFile(documentPath, "utf8");
  assert.equal(content.includes(`# Scenario ${String(entry.number).padStart(2, "0")}:`), true, `${entry.document} missing title`);
  assert.equal(content.includes("状态：已确认场景草案"), true, `${entry.document} must be marked confirmed draft`);
  assert.equal(content.includes("## 元数据"), true, `${entry.document} missing metadata section`);
  assert.equal(content.includes("### 执行路线"), true, `${entry.document} missing execution route`);
  assert.equal(content.includes("### 涉及模块"), true, `${entry.document} missing module section`);
  const metadata = sectionBetween(content, "## 元数据", "## 场景目标");
  assert.ok(metadata, `${entry.document} metadata must appear before scenario goal`);
  const route = sectionBetween(metadata, "### 执行路线", "### 涉及模块");
  assert.equal(route.includes("->"), true, `${entry.document} execution route must use A -> B -> C format`);
  for (const heading of requiredModuleHeadings) {
    assert.equal(metadata.includes(heading), true, `${entry.document} missing module heading ${heading}`);
    const headingContent = sectionBetween(metadata, heading, requiredModuleHeadings[requiredModuleHeadings.indexOf(heading) + 1] || "## 场景目标");
    assert.equal(
      headingContent.includes("- ") || headingContent.includes("| --- |"),
      true,
      `${entry.document} ${heading} must list modules`
    );
  }
  assert.equal(content.includes("```text"), true, `${entry.document} missing chain block`);
  assert.equal(Array.isArray(entry.chain) && entry.chain.length >= 5, true, `scenario ${entry.id} chain too short`);
}

const files = await fs.readdir(scenarioRoot);
for (const fileName of files) {
  const match = fileName.match(/^(\d{2})-/);
  if (!match) continue;
  const number = Number(match[1]);
  assert.equal(number <= 8, true, `unconfirmed scenario slot has document: ${fileName}`);
}

console.log("[verify-scenario-catalog] ok");
