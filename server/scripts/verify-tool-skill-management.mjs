import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capabilityPackageDigest,
  createCapabilityPackageRegistry,
  normalizeCapabilityPackageManifest
} from "../platform/specialized/capabilities/package-lifecycle/index.mjs";
import {
  TOOL_SKILL_MANAGEMENT_PROTOCOL_VERSION,
  createToolSkillManagementProvider
} from "../platform/specialized/capabilities/skills/tool-skill-management-provider.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function signedManifest(input) {
  const normalized = normalizeCapabilityPackageManifest(input);
  return normalizeCapabilityPackageManifest({
    ...input,
    signature: {
      algorithm: "sha256",
      digestSha256: capabilityPackageDigest(normalized)
    }
  });
}

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

const mcpAdapter = await read("server/platform/common/mcp/http-mcp-adapter.mjs");
for (const forbidden of [
  "toolManagementPlatform",
  ".runtime.executeTool",
  ".registry.resolveToolset",
  ".store.createGrant",
  ".store.authorizeRequest"
]) {
  assert.equal(
    mcpAdapter.includes(forbidden),
    false,
    `MCP adapter must not depend on Tool Management internals: ${forbidden}`
  );
}
for (const required of [
  "toolSkillManagementProvider.authorizeRequest",
  ".listVisibleTools",
  "toolSkillManagementProvider.executeTool",
  "toolSkillManagementProvider.resolveMcpWorkspaceInput",
  "toolSkillManagementProvider.publicMcpToolPayload",
  "toolSkillManagementProvider.createLocalMcpGrant",
  "toolSkillManagementProvider.markLocalMcpGrantUninstalled"
]) {
  assert.equal(
    mcpAdapter.includes(required),
    true,
    `MCP adapter must call Tool/Skill provider boundary: ${required}`
  );
}

const grants = [];
const updatedGrants = [];
const fixturePlatform = {
  securityPermissions: {
    decisions: [],
    appendDecision(decision) {
      this.decisions.push(decision);
    }
  },
  catalog() {
    return {
      tools: [
        {
          id: "pact.knowledge.health",
          status: "active",
          requiredScopes: ["knowledge:read"],
          toolsets: ["pact.knowledge.read"],
          risk: "read_only"
        },
        {
          id: "pact.admin",
          status: "active",
          requiredScopes: ["knowledge:admin"],
          toolsets: ["pact.admin"],
          risk: "repair_write"
        }
      ]
    };
  },
  registry: {
    resolveToolset(input = {}) {
      return {
        toolsets: Array.isArray(input.toolsets) ? input.toolsets : [],
        requiredScopes: ["knowledge:read"],
        maxRisk: "safe_write"
      };
    },
    listToolsets() {
      return [
        { id: "pact.knowledge.read", grantable: true },
        { id: "pact.knowledge.write", grantable: true },
        { id: "pact.storage.read", grantable: true },
        { id: "pact.storage.write", grantable: true },
        { id: "pact.agent.workspace.read", grantable: true },
        { id: "pact.agent.workspace", grantable: true },
        { id: "pact.document.parse", grantable: true },
        { id: "pact.result.export", grantable: true },
        { id: "pact.jobs.read", grantable: true },
        { id: "pact.runtime.read", grantable: true },
        { id: "pact.repo.read", grantable: true }
      ];
    }
  },
  store: {
    authorizeRequest({ request, requiredScopes = [] } = {}) {
      return {
        ok: true,
        requiredScopes,
        grant: {
          id: "grant_1",
          label: "Verify grant",
          scopes: ["knowledge:read"],
          toolsets: ["pact.knowledge.read"],
          toolDeny: [],
          metadata: { maxRisk: "read_only", targets: ["codex"] }
        },
        sawApiKeyAlias: request.headers["x-pact-tool-token"] === "sat_test"
      };
    },
    createGrant(input = {}) {
      const grant = {
        id: input.id || `grant_${grants.length + 1}`,
        label: input.label || "",
        type: input.type || "machine",
        toolsets: input.toolsets || [],
        scopes: input.scopes || [],
        metadata: input.metadata || {},
        tokenPrefix: "sat_test",
        enabled: input.enabled !== false,
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z"
      };
      grants.push(grant);
      return { grant, token: "sat_test_token" };
    },
    listGrants() {
      return grants;
    },
    updateGrant(id, patch = {}) {
      const grant = grants.find((item) => item.id === id);
      if (!grant) {
        return null;
      }
      Object.assign(grant, patch);
      updatedGrants.push(grant);
      return grant;
    },
    createMcpAuthorizationRequest(input = {}) {
      return { requestId: "mcp_auth_1", status: "pending", ...input };
    },
    listMcpAuthorizationRequests() {
      return [{ requestId: "mcp_auth_1", status: "pending" }];
    },
    resolveMcpAuthorizationRequest() {
      return true;
    }
  },
  runtime: {
    async executeTool({ toolId }) {
      if (toolId === "pact.agentWorkspace.list") {
        return {
          ok: true,
          status: 200,
          payload: {
            result: {
              workspaces: [{ workspaceId: "workspace_a", title: "Alpha" }]
            }
          }
        };
      }
      return { ok: true, status: 200, payload: { result: { ok: true, toolId } } };
    }
  },
  router: {
    async handleToolManagementHttpRequest() {
      return true;
    }
  }
};

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-skill-provider-"));
const skillPackageRegistry = createCapabilityPackageRegistry({ userDataPath });
const provider = createToolSkillManagementProvider({ toolManagementPlatform: fixturePlatform, userDataPath });
assert.equal(provider.describe().protocolVersion, TOOL_SKILL_MANAGEMENT_PROTOCOL_VERSION);

const request = {
  headers: { "x-pact-api-key": "sat_test" },
  socket: { remoteAddress: "127.0.0.1" },
  __pactRequestId: "verify-tool-skill"
};
const authorization = await provider.authorizeRequest({ request });
assert.equal(authorization.ok, true);
assert.equal(authorization.sawApiKeyAlias, true);
assert.deepEqual(provider.visibleGrantSummary({ authorization }).toolsets, ["pact.knowledge.read"]);
assert.deepEqual(
  provider.listVisibleTools({ authorization }).map((tool) => tool.id),
  ["pact.knowledge.health"]
);

const skillManifest = signedManifest({
  kind: "skill",
  name: "mcp-visible-contract-skill",
  version: "1.0.0",
  title: "MCP Visible Contract Skill",
  description: "Visible to read grants after activation.",
  owner: "verification",
  source: "capability-package-upload",
  capabilities: ["skill.contract.visible"],
  risk: "read_only",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  sandbox: { policy: "knowledge-only" },
  license: "MIT"
});
const skillSubmission = await skillPackageRegistry.submit({
  manifest: skillManifest,
  files: [{ path: "SKILL.md", content: "# MCP Visible Contract Skill\n" }]
}, { submittedBy: "verify" });
await skillPackageRegistry.lifecycle(skillSubmission.record.manifest.packageId, { action: "approve", actor: "verify" });
await skillPackageRegistry.lifecycle(skillSubmission.record.manifest.packageId, { action: "install", actor: "verify" });
await skillPackageRegistry.lifecycle(skillSubmission.record.manifest.packageId, { action: "activate", actor: "verify" });

const visibleSkills = await provider.listVisibleSkills({ authorization });
assert.equal(visibleSkills.summary.activeSkillCount, 1);
assert.equal(visibleSkills.summary.visibleSkillCount, 1);
assert.equal(visibleSkills.skills[0].name, "mcp-visible-contract-skill");
assert.equal(visibleSkills.skills[0].mcpOutlet, "pact.skillHub");
assert.equal(visibleSkills.skills[0].library.storage, "server-skill-library");
assert.equal(Object.prototype.hasOwnProperty.call(visibleSkills.skills[0].library, "absolutePath"), false);
assert.equal(JSON.stringify(visibleSkills).includes("MCP Visible Contract Skill\\n"), false);

await skillPackageRegistry.lifecycle(skillSubmission.record.manifest.packageId, { action: "deprecate", actor: "verify" });
const hiddenSkills = await provider.listVisibleSkills({ authorization });
assert.equal(hiddenSkills.summary.activeSkillCount, 0);
assert.equal(hiddenSkills.summary.visibleSkillCount, 0);

const execution = await provider.executeTool({
  toolId: "pact.knowledge.health",
  input: {},
  request,
  context: {}
});
assert.equal(execution.ok, true);
assert.equal(execution.payload.result.toolId, "pact.knowledge.health");

const resolvedInput = await provider.resolveMcpWorkspaceInput({
  input: { workspaceRef: "workspace-1" },
  request,
  context: {}
});
assert.equal(resolvedInput.input.workspaceId, "workspace_a");

const publicPayload = await provider.publicMcpToolPayload({
  payload: {
    workspaces: [{ workspaceId: "workspace_a", title: "Alpha" }],
    selected: {
      workspaceId: "workspace_a",
      absolutePath: "/home/private-user/private.txt"
    },
    cacheReceipt: {
      cacheKey: "workspace:workspace_a:notes",
      indexRoots: {
        "workspace:workspace_a": "cid:sha256:abc"
      }
    },
    metadata: {
      defaultAdminUserId: "grant_internal_admin",
      adminUserIds: ["grant_internal_admin"],
      token: "sat_private_token",
      tokenPrefix: "sat_private",
      secretRef: "secret://pact/drive/google-oauth",
      endpointRef: "config://pact/drive/google-endpoint"
    },
    error: {
      message: "Failed at /home/private-user/private.txt for workspace_a with Authorization: Bearer sat_private_token, token=sat_private_token, and --token sat_private_token",
      details: {
        sourcePath: "/home/private-user/private.txt",
        workspaceId: "workspace_a",
        headers: {
          Authorization: "Bearer sat_private_token",
          "X-Pact-Api-Key": "sat_private_token",
          Accept: "application/json"
        },
        apiKey: "sat_private_token",
        password: "sat_private_password"
      }
    }
  },
  request,
  context: {}
});
assert.equal(publicPayload.selected.workspaceRef, "workspace-1");
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.selected, "absolutePath"), false);
assert.equal(publicPayload.cacheReceipt.cacheKey, "workspace:workspace-1:notes");
assert.equal(publicPayload.cacheReceipt.indexRoots["workspace:workspace-1"], "cid:sha256:abc");
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.metadata, "defaultAdminUserId"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.metadata, "token"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.metadata, "tokenPrefix"), false);
assert.equal(publicPayload.metadata.secretRef, "secret://pact/drive/google-oauth");
assert.equal(publicPayload.metadata.endpointRef, "config://pact/drive/google-endpoint");
assert.equal(
  publicPayload.error.message,
  "Failed at [server-internal-path] for workspace-1 with Authorization: Bearer <redacted-token>, token=<redacted-secret>, and --token <redacted-token>"
);
assert.equal(publicPayload.error.details.workspaceRef, "workspace-1");
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.error.details, "sourcePath"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.error.details.headers, "Authorization"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.error.details.headers, "X-Pact-Api-Key"), false);
assert.equal(publicPayload.error.details.headers.Accept, "application/json");
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.error.details, "apiKey"), false);
assert.equal(Object.prototype.hasOwnProperty.call(publicPayload.error.details, "password"), false);
assert.equal(JSON.stringify(publicPayload).includes("workspace_a"), false);
assert.equal(JSON.stringify(publicPayload).includes("grant_internal_admin"), false);
assert.equal(JSON.stringify(publicPayload).includes("/home/private-user"), false);
assert.equal(JSON.stringify(publicPayload).includes("sat_private_token"), false);
assert.equal(JSON.stringify(publicPayload).includes("sat_private_password"), false);

const localGrant = await provider.createLocalMcpGrant({
  request,
  requestBody: Buffer.from(JSON.stringify({ target: "codex", label: "Verify Codex" })),
  discoveryState: { serverId: "server_1", mcpIdentity: { keyId: "key_1" } },
  url: new URL("http://127.0.0.1/api/mcp/local-grant")
});
assert.equal(localGrant.status, 201);
assert.equal(localGrant.body.targetMatch.matched, true);
assert.equal(localGrant.body.grant.metadata.agentProfileId, "pact.mcp.codex");

const uninstall = await provider.markLocalMcpGrantUninstalled({
  request,
  requestBody: Buffer.from(JSON.stringify({ target: "codex" }))
});
assert.equal(uninstall.status, 200);
assert.equal(uninstall.body.updatedCount, 1);
assert.equal(updatedGrants[0].metadata.currentDeviceVisible, false);

assert.equal(provider.listMcpClientConnections({ offlineAfterSeconds: 300 }).length, 0);

await fs.rm(userDataPath, { recursive: true, force: true });

console.log("tool-skill-management verification passed");
