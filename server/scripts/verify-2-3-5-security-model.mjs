import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECURITY_BOUNDARY_IDS,
  SECURITY_ENVIRONMENT_IDS,
  SECURITY_GOVERNANCE_OBJECT_IDS,
  SECURITY_GOVERNANCE_OBJECT_ORDER,
  SECURITY_GOVERNANCE_MODEL_VERSION,
  assertSecurityGovernanceModelComplete
} from "../platform/common/security/governance/security-governance-model.mjs";
import {
  CLIENT_BOUNDARY_GOVERNANCE_CONTROLS,
  describeClientBoundaryGovernance
} from "../platform/common/security/governance/client-boundary/index.mjs";
import {
  EXTERNAL_SERVICE_BOUNDARY_GOVERNANCE_CONTROLS,
  describeExternalServiceBoundaryGovernance
} from "../platform/common/security/governance/external-service-boundary/index.mjs";
import {
  PLATFORM_SELF_GOVERNANCE_CONTROLS,
  describePlatformSelfGovernance
} from "../platform/common/security/governance/platform-self-governance/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "../..");

async function readProjectFile(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

async function assertProjectFileExists(relativePath) {
  await fs.access(path.join(projectRoot, relativePath));
}

function assertEveryObjectCovered(profile, label) {
  assert.equal(profile.objects.length, 5, `${label} must expose five governance objects`);
  assert.equal(profile.controlsByObject.length, 5, `${label} must expose five control groups`);
  const objectIds = new Set(Object.values(SECURITY_GOVERNANCE_OBJECT_IDS));
  for (const entry of profile.controlsByObject) {
    assert.equal(objectIds.has(entry.objectId), true, `${label} has an unknown object ${entry.objectId}`);
    assert.equal(Array.isArray(entry.controls), true, `${label} ${entry.objectId} controls must be an array`);
    assert.ok(entry.controls.length > 0, `${label} ${entry.objectId} must list real governance controls`);
  }
}

function assertControlMapCoversEveryObject(controlMap, label) {
  assert.deepEqual(
    Object.keys(controlMap).sort(),
    [...SECURITY_GOVERNANCE_OBJECT_ORDER].sort(),
    `${label} must split controls by every governance object`
  );
  for (const objectId of SECURITY_GOVERNANCE_OBJECT_ORDER) {
    assert.ok(Array.isArray(controlMap[objectId]), `${label} ${objectId} controls must be an array`);
    assert.ok(controlMap[objectId].length > 0, `${label} ${objectId} must list controls`);
  }
}

const governanceSplitFiles = [
  "server/platform/common/security/governance/security-governance-constants.mjs",
  "server/platform/common/security/governance/control-map.mjs",
  "server/platform/common/security/governance/boundaries.mjs",
  "server/platform/common/security/governance/environments.mjs",
  "server/platform/common/security/governance/objects.mjs",
  "server/platform/common/security/governance/client-boundary/controls.mjs",
  "server/platform/common/security/governance/client-boundary/identity-admission-authentication.mjs",
  "server/platform/common/security/governance/client-boundary/permission-behavior-policy.mjs",
  "server/platform/common/security/governance/client-boundary/data-state-semantics.mjs",
  "server/platform/common/security/governance/client-boundary/traffic-resource-management.mjs",
  "server/platform/common/security/governance/client-boundary/audit-fact-verification.mjs",
  "server/platform/common/security/governance/external-service-boundary/controls.mjs",
  "server/platform/common/security/governance/external-service-boundary/identity-admission-authentication.mjs",
  "server/platform/common/security/governance/external-service-boundary/permission-behavior-policy.mjs",
  "server/platform/common/security/governance/external-service-boundary/data-state-semantics.mjs",
  "server/platform/common/security/governance/external-service-boundary/traffic-resource-management.mjs",
  "server/platform/common/security/governance/external-service-boundary/audit-fact-verification.mjs",
  "server/platform/common/security/governance/platform-self-governance/controls.mjs",
  "server/platform/common/security/governance/platform-self-governance/identity-admission-authentication.mjs",
  "server/platform/common/security/governance/platform-self-governance/permission-behavior-policy.mjs",
  "server/platform/common/security/governance/platform-self-governance/data-state-semantics.mjs",
  "server/platform/common/security/governance/platform-self-governance/traffic-resource-management.mjs",
  "server/platform/common/security/governance/platform-self-governance/audit-fact-verification.mjs"
];

await Promise.all(governanceSplitFiles.map((relativePath) => assertProjectFileExists(relativePath)));

const model = assertSecurityGovernanceModelComplete();
assert.equal(model.modelVersion, SECURITY_GOVERNANCE_MODEL_VERSION);
assert.equal(model.boundaryCount, 2);
assert.equal(model.environmentCount, 3);
assert.equal(model.objectCount, 5);
assert.deepEqual(
  model.boundaries.map((boundary) => boundary.id).sort(),
  [
    SECURITY_BOUNDARY_IDS.CLIENT_MCP_INGRESS,
    SECURITY_BOUNDARY_IDS.SERVER_API_EGRESS
  ].sort()
);
assert.deepEqual(
  model.environments.map((environment) => environment.id).sort(),
  [
    SECURITY_ENVIRONMENT_IDS.TERMINAL_AGENT,
    SECURITY_ENVIRONMENT_IDS.PLATFORM_RUNTIME,
    SECURITY_ENVIRONMENT_IDS.APPLICATION_SERVER
  ].sort()
);

const clientBoundary = describeClientBoundaryGovernance();
assert.equal(clientBoundary.boundary.id, SECURITY_BOUNDARY_IDS.CLIENT_MCP_INGRESS);
assertEveryObjectCovered(clientBoundary, "client boundary governance");
assertControlMapCoversEveryObject(CLIENT_BOUNDARY_GOVERNANCE_CONTROLS, "client boundary governance split");

const externalServiceBoundary = describeExternalServiceBoundaryGovernance();
assert.equal(externalServiceBoundary.boundary.id, SECURITY_BOUNDARY_IDS.SERVER_API_EGRESS);
assertEveryObjectCovered(externalServiceBoundary, "external service boundary governance");
assertControlMapCoversEveryObject(EXTERNAL_SERVICE_BOUNDARY_GOVERNANCE_CONTROLS, "external service boundary governance split");

const platformSelfGovernance = describePlatformSelfGovernance();
assert.equal(platformSelfGovernance.environment.id, SECURITY_ENVIRONMENT_IDS.PLATFORM_RUNTIME);
assertEveryObjectCovered(platformSelfGovernance, "platform self governance");
assertControlMapCoversEveryObject(PLATFORM_SELF_GOVERNANCE_CONTROLS, "platform self governance split");

const securityModelDoc = await readProjectFile("docs/boundary/2-3-5-Security-Model.md");
const architectureDoc = await readProjectFile("docs/Architecture.md");
const decisionDoc = await readProjectFile("docs/IMPLEMENTATION-DECISION-REGISTER.md");
const planDoc = await readProjectFile("docs/reports/history/V0.0.1-IMPLEMENTATION-PLAN.md");

for (const phrase of [
  "两条边界",
  "三个环境",
  "五个对象",
  "Security Model 的显式能力词表至少包含",
  "准入、身份、权限、行为、密钥、凭据、风险",
  "## 安全领域",
  "Security Model 只覆盖安全领域",
  "客户端 MCP 入口",
  "服务端 API 出口",
  "终端智能体",
  "平台运行时",
  "应用服务器",
  "身份与准入认证",
  "权限与行为策略",
  "opaque key、sealing key、keyring-backed state、轮换、撤销和失效状态",
  "OAuth、API key、PAT、service account、secretRef、endpointRef",
  "高风险确认、外部副作用、破坏性操作",
  "数据与状态语义",
  "生命周期状态属于数据与状态语义",
  "流量与资源管理",
  "审计与事实验证",
  "client-boundary/identity-admission-authentication.mjs",
  "external-service-boundary/permission-behavior-policy.mjs",
  "platform-self-governance/audit-fact-verification.mjs",
  "server/platform/common/security/governance"
]) {
  assert.match(securityModelDoc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `2-3-5 security model doc must mention ${phrase}`);
}

for (const [label, content] of [
  ["Architecture.md", architectureDoc],
  ["IMPLEMENTATION-DECISION-REGISTER.md", decisionDoc],
  ["V0.0.1-IMPLEMENTATION-PLAN.md", planDoc]
]) {
  assert.match(content, /两条外部边界|两条安全边界|客户端 MCP 入口/, `${label} must mention the 2-boundary security model`);
  assert.match(content, /身份与准入认证/, `${label} must mention the 5-object governance taxonomy`);
}

console.log("2-3-5 security governance model verifier passed");
