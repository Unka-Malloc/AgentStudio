import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apiCapabilityId } from "../platform/common/security/authorization/authorization-engine.mjs";
import { createCapabilityBindingGuard } from "../platform/common/security/authorization/capability-binding-guard.mjs";
import { createOpaqueCapabilityKeyProvider } from "../platform/common/security/authorization/opaque-capability-key.mjs";

async function writeExecutable(filePath, source) {
  await fs.writeFile(filePath, source, { mode: 0o755 });
  await fs.chmod(filePath, 0o755);
}

function fixtureKeyctlSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = process.env.PACT_FAKE_SECURITY_BACKEND_DIR;
const file = path.join(root, "keyctl.json");
function read() {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { next: 1000, bySerial: {}, byDescription: {} }; }
}
function write(state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
function stdin() {
  return fs.readFileSync(0, "utf8");
}
const args = process.argv.slice(2);
if (process.env.PACT_FAKE_KEYCTL_FAIL === "1") {
  console.error("keyctl unavailable");
  process.exit(1);
}
const state = read();
if (args[0] === "search") {
  const description = args[3];
  const serial = state.byDescription[description];
  if (!serial) {
    console.error("requested key not available");
    process.exit(1);
  }
  process.stdout.write(String(serial));
  process.exit(0);
}
if (args[0] === "pipe") {
  const item = state.bySerial[args[1]];
  if (!item) {
    console.error("requested key not available");
    process.exit(1);
  }
  process.stdout.write(item.payload);
  process.exit(0);
}
if (args[0] === "unlink") {
  const serial = args[1];
  const item = state.bySerial[serial];
  if (item) {
    delete state.byDescription[item.description];
    delete state.bySerial[serial];
  }
  write(state);
  process.exit(0);
}
if (args[0] === "padd") {
  const description = args[2];
  const serial = String(state.next++);
  state.bySerial[serial] = { description, payload: stdin() };
  state.byDescription[description] = serial;
  write(state);
  process.stdout.write(serial);
  process.exit(0);
}
console.error("unsupported keyctl call " + args.join(" "));
process.exit(2);
`;
}

function fixtureSecretToolSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = process.env.PACT_FAKE_SECURITY_BACKEND_DIR;
const file = path.join(root, "secret-tool.json");
function read() {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}
function write(state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
function keyFrom(attrs) {
  return JSON.stringify(attrs);
}
function stdin() {
  return fs.readFileSync(0, "utf8");
}
const args = process.argv.slice(2);
const state = read();
if (args[0] === "lookup") {
  const key = keyFrom(args.slice(1));
  if (!state[key]) {
    console.error("not found");
    process.exit(1);
  }
  process.stdout.write(state[key]);
  process.exit(0);
}
if (args[0] === "store") {
  const attrs = [];
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--label") {
      index += 1;
      continue;
    }
    attrs.push(args[index]);
  }
  state[keyFrom(attrs)] = stdin();
  write(state);
  process.exit(0);
}
console.error("unsupported secret-tool call " + args.join(" "));
process.exit(2);
`;
}

function fixturePassSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = process.env.PACT_FAKE_SECURITY_BACKEND_DIR;
const file = path.join(root, "pass.json");
function read() {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}
function write(state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
function stdin() {
  return fs.readFileSync(0, "utf8");
}
const args = process.argv.slice(2);
const state = read();
if (args[0] === "show") {
  const name = args[1];
  if (!state[name]) {
    console.error("Error: " + name + " is not in the password store.");
    process.exit(1);
  }
  process.stdout.write(state[name]);
  process.exit(0);
}
if (args[0] === "insert") {
  const name = args[args.length - 1];
  state[name] = stdin();
  write(state);
  process.exit(0);
}
console.error("unsupported pass call " + args.join(" "));
process.exit(2);
`;
}

async function installFixtureCommands(root) {
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir, { recursive: true });
  await writeExecutable(path.join(binDir, "keyctl"), fixtureKeyctlSource());
  await writeExecutable(path.join(binDir, "secret-tool"), fixtureSecretToolSource());
  await writeExecutable(path.join(binDir, "pass"), fixturePassSource());
  process.env.PACT_FAKE_SECURITY_BACKEND_DIR = root;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ""}`;
}

async function verifyOpaqueBackend({ backend, alias }) {
  const provider = createOpaqueCapabilityKeyProvider({ backend, alias });
  let issued = null;
  try {
    issued = await provider.issue({
      credentialId: `credential-${backend}`,
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    const allowed = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    assert.equal(allowed.ok, true, `${backend} should verify issued opaque capability keys`);
    const description = await provider.describe();
    assert.equal(description.keySource.provider, backend);
    assert.notEqual(description.securityMode, "degraded_file_fallback");
    assert.equal(JSON.stringify(description).includes("runtimeLookupKeyBase64"), false);
  } finally {
    provider.close();
  }
  const reloadedProvider = createOpaqueCapabilityKeyProvider({ backend, alias });
  try {
    const allowedAfterReload = await reloadedProvider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    assert.equal(allowedAfterReload.ok, true, `${backend} should persist opaque capability state`);
  } finally {
    reloadedProvider.close();
  }
}

async function verifyBindingBackend({ backend, alias }) {
  const guard = createCapabilityBindingGuard({ backend, alias });
  const capabilityKey = `ock_test_${backend}`;
  try {
    await guard.bindCapabilityKey({
      capabilityKey,
      credentialId: `credential-${backend}`,
      context: {
        namespace: "tool-management",
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    const allowed = await guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: `credential-${backend}`,
      context: {
        namespace: "tool-management",
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    assert.equal(allowed.ok, true, `${backend} should verify sealed binding guard entries`);
    const denied = await guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: `credential-${backend}`,
      context: {
        namespace: "tool-management",
        userId: "user-b",
        agentId: "agent-a"
      }
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.reasonCode, "binding_user_mismatch");
    const description = await guard.describe();
    assert.equal(description.provider, backend);
    assert.notEqual(description.securityMode, "degraded_file_fallback");
    assert.equal(JSON.stringify(description).includes("bindingLookupKeyBase64"), false);
  } finally {
    guard.close();
  }
  const reloadedGuard = createCapabilityBindingGuard({ backend, alias });
  try {
    const allowedAfterReload = await reloadedGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: `credential-${backend}`,
      context: {
        namespace: "tool-management",
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    assert.equal(allowedAfterReload.ok, true, `${backend} should persist sealed binding state`);
  } finally {
    reloadedGuard.close();
  }
}

async function verifyAutoFallsThroughToSecretService({ alias }) {
  if (process.platform !== "linux") {
    return;
  }
  process.env.PACT_FAKE_KEYCTL_FAIL = "1";
  try {
    const provider = createOpaqueCapabilityKeyProvider({ backend: "auto", alias });
    try {
      const issued = await provider.issue({
        credentialId: "credential-auto-fallback",
        capabilities: [apiCapabilityId("knowledge.search")]
      });
      const allowed = await provider.verify({
        capabilityKey: issued.capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      });
      assert.equal(allowed.ok, true, "auto backend should verify after falling through to secret-service");
      const description = await provider.describe();
      assert.equal(description.keySource.provider, "secret-service");
      assert.notEqual(description.securityMode, "degraded_file_fallback");
    } finally {
      provider.close();
    }

    const guard = createCapabilityBindingGuard({ backend: "auto", alias });
    try {
      const capabilityKey = "ock_test_auto_fallback";
      await guard.bindCapabilityKey({
        capabilityKey,
        credentialId: "credential-auto-fallback",
        context: {
          namespace: "tool-management",
          userId: "user-a",
          agentId: "agent-a"
        }
      });
      const allowed = await guard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "credential-auto-fallback",
        context: {
          namespace: "tool-management",
          userId: "user-a",
          agentId: "agent-a"
        }
      });
      assert.equal(allowed.ok, true, "auto binding backend should verify after falling through to secret-service");
      const description = await guard.describe();
      assert.equal(description.provider, "secret-service");
      assert.notEqual(description.securityMode, "degraded_file_fallback");
    } finally {
      guard.close();
    }
  } finally {
    delete process.env.PACT_FAKE_KEYCTL_FAIL;
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-linux-security-backends-"));
try {
  await installFixtureCommands(root);
  for (const backend of ["linux-kernel-keyring", "secret-service", "pass-gpg"]) {
    await verifyOpaqueBackend({ backend, alias: `verify-${backend}` });
    await verifyBindingBackend({ backend, alias: `verify-${backend}` });
  }
  await verifyAutoFallsThroughToSecretService({ alias: "verify-auto-fallback" });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log("linux security backend verifier passed");
