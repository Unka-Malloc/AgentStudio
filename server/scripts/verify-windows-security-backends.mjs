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

function fixturePowerShellModuleSource() {
  return `
import fs from "node:fs";
const script = process.argv.slice(2).join(" ");
const input = fs.readFileSync(0, "utf8");
if (script.includes("ProtectedData]::Protect")) {
  process.stdout.write(Buffer.from(input, "utf8").toString("base64"));
  process.exit(0);
}
if (script.includes("ProtectedData]::Unprotect")) {
  process.stdout.write(Buffer.from(input.trim(), "base64").toString("utf8"));
  process.exit(0);
}
console.error("unsupported PowerShell DPAPI script");
process.exit(2);
`;
}

function fixturePowerShellWrapperSource(modulePath) {
  return `#!/bin/sh
exec node ${JSON.stringify(modulePath)} "$@"
`;
}

async function installFixturePowerShell(root) {
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const modulePath = path.join(binDir, "fixture-powershell.mjs");
  await fs.writeFile(modulePath, fixturePowerShellModuleSource(), "utf8");
  const executable = path.join(binDir, "powershell.exe");
  await writeExecutable(executable, fixturePowerShellWrapperSource(modulePath));
  process.env.PACT_WINDOWS_DPAPI_COMMAND = executable;
}

async function verifyOpaqueDpapi(dataDir) {
  const provider = createOpaqueCapabilityKeyProvider({
    backend: "windows-dpapi",
    dataDir,
    alias: "verify-windows-kernel"
  });
  try {
    const issued = await provider.issue({
      credentialId: "credential-windows",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    const allowed = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    assert.equal(allowed.ok, true);
    const description = await provider.describe();
    assert.equal(description.keySource.provider, "windows-dpapi");
    assert.equal(description.securityMode, "dpapi");
    assert.equal(JSON.stringify(description).includes("runtimeLookupKeyBase64"), false);

    const protectedPath = path.join(dataDir, "security", "capability-kernel", "verify-windows-kernel.dpapi");
    const protectedBytes = await fs.readFile(protectedPath, "utf8");
    assert.equal(protectedBytes.includes("runtimeLookupKeyBase64"), false);
    assert.equal(protectedBytes.includes(apiCapabilityId("knowledge.search")), false);
    assert.equal(protectedBytes.includes(issued.capabilityKey), false);
  } finally {
    provider.close();
  }
}

async function verifyBindingDpapi(dataDir) {
  const guard = createCapabilityBindingGuard({
    backend: "windows-dpapi",
    dataDir,
    alias: "verify-windows-binding"
  });
  const capabilityKey = "ock_windows_binding_key";
  try {
    await guard.bindCapabilityKey({
      capabilityKey,
      credentialId: "credential-windows",
      context: {
        namespace: "tool-management",
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    const allowed = await guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "credential-windows",
      context: {
        namespace: "tool-management",
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    assert.equal(allowed.ok, true);
    const denied = await guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "credential-windows",
      context: {
        namespace: "tool-management",
        userId: "user-b",
        agentId: "agent-a"
      }
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.reasonCode, "binding_user_mismatch");
    const description = await guard.describe();
    assert.equal(description.provider, "windows-dpapi");
    assert.equal(description.securityMode, "dpapi");
    assert.equal(JSON.stringify(description).includes("bindingLookupKeyBase64"), false);

    const protectedPath = path.join(dataDir, "security", "capability-binding-guard", "verify-windows-binding.dpapi");
    const protectedBytes = await fs.readFile(protectedPath, "utf8");
    assert.equal(protectedBytes.includes("bindingLookupKeyBase64"), false);
    assert.equal(protectedBytes.includes(capabilityKey), false);
    assert.equal(protectedBytes.includes("user-a"), false);
    assert.equal(protectedBytes.includes("agent-a"), false);
  } finally {
    guard.close();
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-windows-security-backends-"));
const dataDir = path.join(root, "data");
try {
  await installFixturePowerShell(root);
  await verifyOpaqueDpapi(dataDir);
  await verifyBindingDpapi(dataDir);
} finally {
  delete process.env.PACT_WINDOWS_DPAPI_COMMAND;
  await fs.rm(root, { recursive: true, force: true });
}

console.log("windows security backend verifier passed");
