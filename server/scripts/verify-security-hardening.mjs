import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createStorageBackup, restoreStorageBackup } from "../platform/common/storage/backup-restore.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createClientRegistryService } from "../platform/common/storage/client-registry-repository.mjs";
import { createMetadataStore } from "../platform/common/storage/metadata-store.mjs";
import { initializeMetadataSchema } from "../platform/common/storage/schema-manager.mjs";
import { createAuthorizationEngine } from "../platform/common/security/authorization/authorization-engine.mjs";
import { createAuthorizationStore } from "../platform/common/security/authorization/authorization-store.mjs";
import { createConsoleAuth } from "../platform/common/security/auth/console-auth.mjs";
import { createOperationAuditStore } from "../platform/common/security/operation-audit.mjs";
import { createAgentWorkspace } from "../platform/specialized/agent/agent-workspace/index.mjs";
import { resolveNormalizedDocumentPath } from "../platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs";
import { createDocumentParsingRuntime } from "../platform/specialized/knowledge/preprocessing/document-parsing-runtime.mjs";
import { createKnowledgeSourceService } from "../platform/specialized/knowledge/storage/knowledge-source-service.mjs";
import { executeRepoOperation } from "../platform/specialized/capabilities/code-repository/repo-operations/index.mjs";
import { AcpPermissionBridge } from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-permission-bridge.mjs";
import {
  capabilityPackageDigest,
  createCapabilityPackageRegistry,
  normalizeCapabilityPackageManifest
} from "../platform/specialized/capabilities/package-lifecycle/index.mjs";
import {
  proxyShouldForwardCredentials,
  resolveProxyUpstreamUrl,
  startHttpServer
} from "../services/server-runtime/http-server.mjs";
import { createBatchDeletionCoordinator } from "../services/client/work-queue-core/batch-deletion-coordinator.mjs";
import { createCloudDrivePort } from "../platform/specialized/agent/cloud-drive-port/index.mjs";
import { evaluateModelAssistedEgress } from "../platform/specialized/agent/agent-gateway/model-egress-policy.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import {
  createExternalKnowledgeDistillationClient,
  resolveExternalKnowledgeDistillationConfig
} from "../platform/specialized/knowledge/invocation/external-distillation-service/index.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER = "local-file";
process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER = "local-file";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const execFileAsync = promisify(execFile);

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

async function requestText(url, options = {}) {
  const response = await fetch(url, options);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.text()
  };
}

function cookieFromResponse(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response.headers.get("set-cookie") || "").split(/,(?=\s*pact_)/).filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function parseOwnerCredentials(content = "") {
  const username = content.match(/^Username\s*:\s*(.+)$/m)?.[1]?.trim() || "owner";
  const password = content.match(/^Password\s*:\s*(.+)$/m)?.[1]?.trim() || "";
  return { username, password };
}

async function verifyStaticSecurityHardeningCode() {
  const [
    httpServerSource,
    safeHtmlSource,
    evidenceRendererSource,
    viteConfigSource,
    dockerIgnoreSource,
    composeSource,
    ragDockerfileSource,
    ragServerSource,
    cloudDriveSource,
    agentExplorationSource,
    settingsSource,
    externalKdServiceSource,
    jobsControllerSource,
    agentWorkspaceSource,
    schemaManagerSource,
    agentGatewaySource,
    modelEgressPolicySource
  ] = await Promise.all([
    fs.readFile(path.join(repoRoot, "server/services/server-runtime/http-server.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server-web/components/SafeHtmlBlock.vue"), "utf8"),
    fs.readFile(path.join(repoRoot, "server-web/composables/console-evidence-rendering.ts"), "utf8"),
    fs.readFile(path.join(repoRoot, "vite.config.ts"), "utf8"),
    fs.readFile(path.join(repoRoot, ".dockerignore"), "utf8"),
    fs.readFile(path.join(repoRoot, "docker-compose.yml"), "utf8"),
    fs.readFile(path.join(repoRoot, "external-services/rag-service/Dockerfile"), "utf8"),
    fs.readFile(path.join(repoRoot, "external-services/rag-service/server.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/specialized/agent/cloud-drive-port/index.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/specialized/capabilities/tools/agent-exploration-runtime/index.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/common/platform-core/settings.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "external-services/knowledge-distillation-service/server.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/common/console/http/controllers/jobs-controller.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/specialized/agent/agent-workspace/index.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/common/storage/schema-manager.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/specialized/agent/agent-gateway/index.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server/platform/specialized/agent/agent-gateway/model-egress-policy.mjs"), "utf8")
  ]);

  assert.match(httpServerSource, /script-src 'self' 'nonce-/, "console CSP must use script nonce");
  assert.doesNotMatch(httpServerSource, /script-src 'self' 'unsafe-inline'/, "console CSP must not include unsafe-inline");
  assert.match(httpServerSource, /injectCspNonceIntoInlineScripts/, "console CSP runtime must inject nonce into inline scripts");

  assert.doesNotMatch(httpServerSource, /console initial owner username/i, "initial owner should not log usernames to stdout");
  assert.match(httpServerSource, /server\.initialOwner\.credentials_file/, "initial owner should log credentials path only to server logger");
  assert.match(httpServerSource, /createFixedWindowRateLimiter/, "HTTP layer should enforce fixed-window rate limits");
  assert.match(httpServerSource, /resolveHttpRateLimits/, "HTTP layer should resolve rate-limit policy from runtime options");
  assert.match(httpServerSource, /httpRateLimitPerIpPerMinute/, "HTTP layer should support IP rate limits");
  assert.match(httpServerSource, /httpRateLimitPerSubjectPerMinute/, "HTTP layer should support subject rate limits");
  assert.match(httpServerSource, /httpRateLimitLoginPerIpPerMinute/, "HTTP layer should support login rate limit");
  assert.match(httpServerSource, /proxyShouldForwardCredentials/, "HTTP proxy must gate credential forwarding");
  assert.match(httpServerSource, /resolveProxyUpstreamUrl/, "HTTP proxy must normalize upstream targets through a relative path helper");
  assert.match(httpServerSource, /credentialRequestHeaders/, "HTTP proxy must identify credential headers");
  assert.match(httpServerSource, /blockedResponseHeaders/, "HTTP proxy must filter upstream response headers");
  assert.match(ragDockerfileSource, /COPY server\.mjs \/app\/server\.mjs/, "RAG Docker proxy must use a source-controlled server entrypoint");
  assert.match(ragDockerfileSource, /CMD \["node", "\/app\/server\.mjs"\]/, "RAG Docker proxy must start the source-controlled server");
  assert.match(ragServerSource, /requestTargetUrl/, "RAG proxy must normalize request targets through a helper");
  assert.match(ragServerSource, /new URL\(String\(requestUrl \|\| "\/"\), "http:\/\/127\.0\.0\.1"\)/, "RAG proxy must discard absolute-form request origins");
  assert.match(ragServerSource, /sanitizeRequestHeaders/, "RAG proxy must filter hop-by-hop request headers");
  assert.match(cloudDriveSource, /fetchExternalServiceWithPinnedDns/, "remote-live Cloud Drive calls must use DNS-pinned egress");
  assert.match(cloudDriveSource, /REMOTE_ENDPOINT_EGRESS_DENIED/, "remote-live Cloud Drive must expose a local/private egress denial");
  assert.match(agentExplorationSource, /fetchExternalServiceWithPinnedDns/, "agent exploration HTTP tools must use DNS-pinned egress");
  assert.match(agentExplorationSource, /http_egress_denied/, "agent exploration HTTP tools must report egress denials");
  assert.match(agentGatewaySource, /fetchExternalServiceWithPinnedDns/, "configured model gateway calls must use DNS-pinned egress");
  assert.match(agentGatewaySource, /allowLocalForConfiguredModelService:\s*true/, "configured model gateway calls may explicitly reach local/private model services");
  assert.match(settingsSource, /allowLocalForDevelopment: false/, "agent HTTP tool defaults must not allow local egress by default");
  assert.doesNotMatch(
    externalKdServiceSource,
    /input\.(?:modelGatewayUrl|agentGatewayUrl|modelGatewayToken|agentGatewayToken)/,
    "external KD service model gateway endpoint/token must not come from run input"
  );
  assert.match(httpServerSource, /"set-cookie"/, "HTTP proxy must not pass upstream Set-Cookie through");
  assert.match(httpServerSource, /isLoopbackHostname/, "HTTP proxy should allow local migration credentials without allowing arbitrary hosts");
  assert.match(httpServerSource, /originFromUrl/, "HTTP proxy credential trust should compare exact origins");
  assert.doesNotMatch(
    httpServerSource,
    /sendJson\(response,\s*statusCode,\s*\{\s*error:\s*message\s*\}\)/,
    "HTTP fallback errors must not reflect raw exception messages"
  );
  assert.match(httpServerSource, /traceId:\s*traceContext\.traceId/, "HTTP fallback errors should return trace ids instead of internals");

  assert.doesNotMatch(viteConfigSource, /secure:\s*false/, "vite proxy must not force TLS verification off");
  assert.match(viteConfigSource, /proxySecure/, "vite proxy secure flag should be calculated explicitly");
  assert.match(viteConfigSource, /isExplicitLocalInsecureCertBypass/, "vite proxy TLS bypass must be explicit-flag gated");
  assert.match(viteConfigSource, /parseProxyApiOrigin/, "vite proxy helper must parse configured API origin");

  assert.match(dockerIgnoreSource, /^\.pact-server-data$/m, "runtime data should be excluded from Docker build context");
  assert.match(dockerIgnoreSource, /^\.pact-agent-history$/m, "agent history should be excluded from Docker build context");
  assert.match(dockerIgnoreSource, /^reports\/$/m, ".dockerignore should exclude runtime reports directory");
  assert.match(dockerIgnoreSource, /server\/platform\/modules\/knowledge\/runtime\/jre\/downloads/, "runtime JRE downloads should stay out of image");

  assert.match(
    composeSource,
    /开发环境|开发模式|development|local.*dev/i,
    "docker-compose should declare development scope"
  );
  assert.match(composeSource, /HTTPS|TLS|reverse proxy/i, "compose/TLS guidance should be present for production");

  assert.match(evidenceRendererSource, /if \(!ALLOWED_EMAIL_FRAME_TAGS\.has\(tagName\)/, "email frame sanitizer should use allowlist");
  assert.doesNotMatch(
    evidenceRendererSource,
    /script, iframe, object, embed, form, input, button, textarea, select/,
    "email sanitizer should not use removed blocklist pattern"
  );
  assert.doesNotMatch(
    evidenceRendererSource,
    /sandbox="[^"]*allow-same-origin[^"]*"/,
    "email frame sandbox must remove allow-same-origin"
  );
  assert.doesNotMatch(
    evidenceRendererSource,
    /sandbox="[^"]*allow-popups-to-escape-sandbox[^"]*"/,
    "email frame sandbox must remove popups escape"
  );
  assert.match(
    evidenceRendererSource,
    /rendered-email-frame\".*sandbox=\"allow-popups\"/,
    "rendered email frame should use allow-popups sandbox profile"
  );

  assert.match(safeHtmlSource, /const sanitizedHtml = computed\(/, "SafeHtmlBlock should expose sanitization output");
  assert.match(safeHtmlSource, /sanitizeEvidenceHtml\(/, "SafeHtmlBlock must sanitize renderEvidenceReadableHtml branch");
  assert.match(safeHtmlSource, /classList\.contains\("rendered-email-frame"\)/, "SafeHtmlBlock should only preserve srcdoc on generated email preview frames");
  assert.match(safeHtmlSource, /!generatedEmailFrame \|\| !element\.getAttribute\("srcdoc"\)[\s\S]*element\.remove\(\)/, "SafeHtmlBlock must remove arbitrary evidence iframes with srcdoc");
  assert.match(safeHtmlSource, /element\.setAttribute\("sandbox",\s*"allow-popups"\)/, "SafeHtmlBlock iframe sandbox must be fixed to a no-script profile");
  assert.match(safeHtmlSource, /element\.removeAttribute\("src"\)/, "SafeHtmlBlock iframe sanitizer must remove remote iframe src");
  assert.doesNotMatch(safeHtmlSource, /allow-scripts/, "SafeHtmlBlock iframe sanitizer must not preserve allow-scripts");
  assert.doesNotMatch(safeHtmlSource, /v-html=\"props\\.html\"/, "SafeHtmlBlock should not render source html without sanitizer");

  const emailFrameTags = evidenceRendererSource.match(/const ALLOWED_EMAIL_FRAME_TAGS = new Set\(\[\n([\s\S]*?)\]\);/)?.[1] || "";
  const emailFrameAttributes = evidenceRendererSource.match(/const ALLOWED_EMAIL_FRAME_ATTRIBUTES = new Set\(\[\n([\s\S]*?)\]\);/)?.[1] || "";
  assert.doesNotMatch(emailFrameTags, /"iframe"/, "email frame sanitizer must not preserve user-supplied iframes");
  assert.doesNotMatch(emailFrameAttributes, /"srcdoc"|"sandbox"|"referrerpolicy"|"allowfullscreen"/, "email frame sanitizer must not preserve iframe control attributes from user HTML");
  assert.doesNotMatch(
    jobsControllerSource,
    /ownerIds\.length === 0\)[\s\S]{0,80}return true/,
    "job access must not preserve legacy ownerless compatibility"
  );
  assert.doesNotMatch(
    agentWorkspaceSource,
    /allowedUserIds\.length === 0\)[\s\S]{0,80}return true/,
    "workspace access must not preserve legacy ownerless compatibility"
  );
  assert.match(jobsControllerSource, /rawObjectJobId/, "raw object access must inspect direct job binding");
  assert.match(jobsControllerSource, /rawObjectOwnerIds/, "raw object access must inspect direct owner binding");
  assert.match(
    jobsControllerSource,
    /rawOwnerMatches === true && jobAccess === true/,
    "raw object access must require owner and job access to agree when both bindings exist"
  );
  assert.match(schemaManagerSource, /owner_subject_id TEXT NOT NULL DEFAULT ''/, "raw objects must persist owner subject id");
  assert.match(schemaManagerSource, /job_id TEXT NOT NULL DEFAULT ''/, "raw objects must persist job id");
  assert.match(agentGatewaySource, /assertModelAssistedEgressAllowed/, "agent gateway must enforce model-assisted egress allowlist");
  assert.match(modelEgressPolicySource, /DEFAULT_ALLOWED_MODEL_EGRESS_SOURCES/, "model egress policy must define explicit allowed sources");
  assert.match(modelEgressPolicySource, /model_assisted_egress_denied/, "model egress policy must deny unlisted model control paths");
  assert.doesNotMatch(
    modelEgressPolicySource,
    /input\.operationId|input\.moduleId|input\.featureId|input\.taskType|input\.surface/,
    "model egress policy must not trust spoofable business input fields as source identities"
  );
}

function verifyModelEgressAndToolCatalogScopeBoundaries() {
  assert.equal(
    evaluateModelAssistedEgress({ operationId: "settings.model_probe" }).ok,
    false,
    "model egress policy must reject operationId source spoofing"
  );
  assert.equal(
    evaluateModelAssistedEgress({ moduleId: "summarization-runtime" }).ok,
    false,
    "model egress policy must reject moduleId source spoofing"
  );
  assert.equal(
    evaluateModelAssistedEgress({ contextCompactionSource: "settings.model_probe" }).ok,
    true,
    "trusted model probe source should still be allowed"
  );

  const toolsByOperationId = new Map(
    createToolCatalog({ operations: SERVER_API_OPERATIONS }).tools
      .filter((tool) => tool.operationId)
      .map((tool) => [tool.operationId, tool])
  );
  for (const [operationId, expectedScope] of [
    ["agent_gateway.call", "model:call"],
    ["knowledge.config_schema", "workspace:read"],
    ["knowledge.capabilities", "workspace:read"],
    ["knowledge.feedback", "workspace:write"]
  ]) {
    const operation = SERVER_API_OPERATIONS.find((item) => item.id === operationId);
    assert.ok(operation, `${operationId} must be registered`);
    assert.ok(operation.requiredScopes.includes(expectedScope), `${operationId} registry must require ${expectedScope}`);
    const tool = toolsByOperationId.get(operationId);
    if (tool) {
      assert.ok(tool.requiredScopes.includes(expectedScope), `${operationId} tool must not weaken ${expectedScope}`);
    }
  }
}

async function verifyStaticSecurityBlockers() {
  const consoleAuthSource = await fs.readFile(
    path.join(repoRoot, "server/platform/common/security/auth/console-auth.mjs"),
    "utf8"
  );
  assert.match(
    consoleAuthSource,
    /function\s+timingSafeStringEqual[\s\S]*crypto\.timingSafeEqual/,
    "console auth must provide a timing-safe string comparison helper"
  );
  assert.match(
    consoleAuthSource,
    /timingSafeStringEqual\(csrf,\s*session\.csrfToken\)/,
    "CSRF verification must use timing-safe comparison"
  );
  assert.doesNotMatch(
    consoleAuthSource,
    /csrf\s*!==\s*session\.csrfToken/,
    "CSRF verification must not use direct string inequality"
  );

  const dockerfile = await fs.readFile(path.join(repoRoot, "Dockerfile"), "utf8");
  const dockerStages = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+([A-Za-z0-9._-]+)(?:\s*(?:#.*)?)?$/gim)];
  const runtimeStageIndex = dockerStages.findIndex((match) => String(match[1] || "").toLowerCase() === "runtime");
  const runtimeStage = runtimeStageIndex >= 0
    ? dockerfile.slice(
        dockerStages[runtimeStageIndex].index + dockerStages[runtimeStageIndex][0].length,
        dockerStages[runtimeStageIndex + 1]?.index || dockerfile.length
      )
    : "";
  assert.ok(runtimeStage, "Dockerfile must define a runtime stage");
  assert.match(runtimeStage, /groupadd\s+--system[\s\S]*\bpact\b/, "runtime Docker stage must create a dedicated pact group");
  assert.match(runtimeStage, /useradd\s+--system[\s\S]*\bpact\b/, "runtime Docker stage must create a dedicated pact user");
  assert.match(runtimeStage, /COPY\s+--chown=pact:pact\s+--from=build/, "runtime Docker stage must copy app files for the pact user");
  assert.match(runtimeStage, /COPY\s+--chown=pact:pact\s+--from=runtime-deps/, "runtime Docker stage must copy runtime modules for the pact user");
  assert.match(
    runtimeStage,
    /mkdir\s+-p\s+\/opt\/pact\/data\s+\/codex-home[\s\S]*chown\s+-R\s+pact:pact\s+\/opt\/pact\s+\/codex-home/,
    "runtime data directories must be created and owned by the pact user"
  );
  assert.match(runtimeStage, /VOLUME\s+\["\/opt\/pact\/data"\]/, "runtime Docker stage must expose the Pact data volume");
  assert.match(runtimeStage, /"--data-dir",\s*"\/opt\/pact\/data"/, "runtime Docker stage must start with the Pact data directory");
  assert.match(runtimeStage, /^USER pact$/m, "runtime Docker stage must run as the pact user");
  assert.equal(/^USER root$/m.test(runtimeStage), false, "runtime Docker stage must not switch back to root");
}

function verifyProxyCredentialTrustBoundary() {
  const absoluteFormUpstream = resolveProxyUpstreamUrl({
    requestUrl: "http://attacker.example.test/api/healthz?probe=1",
    targetBaseUrl: "https://trusted.example.test"
  });
  assert.equal(
    absoluteFormUpstream.toString(),
    "https://trusted.example.test/api/healthz?probe=1",
    "absolute-form proxy request targets must not override the trusted upstream origin"
  );
  assert.equal(
    proxyShouldForwardCredentials({
      targetBaseUrl: "http://127.0.0.1:8765",
      upstreamUrl: "http://127.0.0.1:8765/api/healthz",
      discoveryState: { activeServiceUrl: "http://127.0.0.1:7654" }
    }),
    true,
    "loopback migration may forward credentials across local ports"
  );
  assert.equal(
    proxyShouldForwardCredentials({
      targetBaseUrl: "http://api.example.test",
      upstreamUrl: "http://api.example.test/api/healthz",
      discoveryState: { activeServiceUrl: "http://api.example.test" }
    }),
    false,
    "non-loopback plaintext HTTP must not receive credentials"
  );
  assert.equal(
    proxyShouldForwardCredentials({
      targetBaseUrl: "https://api.example.test:9443",
      upstreamUrl: "https://api.example.test:9443/api/healthz",
      discoveryState: { activeServiceUrl: "https://api.example.test" }
    }),
    false,
    "same host on a different non-loopback origin must not receive credentials"
  );
  assert.equal(
    proxyShouldForwardCredentials({
      targetBaseUrl: "https://api.example.test",
      upstreamUrl: "https://api.example.test/api/healthz",
      discoveryState: { activeServiceUrl: "https://api.example.test" }
    }),
    true,
    "exact trusted non-loopback HTTPS origin may receive credentials"
  );
  assert.equal(
    proxyShouldForwardCredentials({
      targetBaseUrl: "https://api.example.test",
      upstreamUrl: "https://attacker.example.test/api/healthz",
      discoveryState: { activeServiceUrl: "https://api.example.test" }
    }),
    false,
    "credentials must be withheld when final upstream origin differs from targetBaseUrl"
  );
}

async function verifyExternalKnowledgeDistillationEgressBoundary() {
  const config = resolveExternalKnowledgeDistillationConfig({
    input: {
      baseUrl: "http://127.0.0.1:9",
      serviceUrl: "http://localhost:9",
      token: "attacker-token",
      apiKey: "attacker-key"
    },
    env: {
      PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL: "https://kd.example.test/service",
      PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_TOKEN: "trusted-token"
    }
  });
  assert.equal(config.baseUrl, "https://kd.example.test/service");
  assert.equal(config.token, "trusted-token");

  const calls = [];
  const client = createExternalKnowledgeDistillationClient({
    baseUrl: "https://kd.example.test/service",
    token: "trusted-token",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, runId: "run_verify" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    }
  });
  await client.createRun({
    baseUrl: "http://127.0.0.1:9",
    serviceUrl: "http://localhost:9",
    endpoint: "http://169.254.169.254/",
    token: "attacker-token",
    apiKey: "attacker-key",
    modelGatewayUrl: "http://127.0.0.1:7228/api/agent-gateway/call",
    agentGatewayUrl: "http://localhost:7228/api/agent-gateway/call",
    modelGatewayToken: "attacker-model-token",
    agentGatewayToken: "attacker-agent-token",
    documents: []
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://kd.example.test/service/v1/distillation/runs");
  const forwardedBody = JSON.parse(String(calls[0].init.body || "{}"));
  for (const key of [
    "baseUrl",
    "serviceUrl",
    "endpoint",
    "token",
    "apiKey",
    "modelGatewayUrl",
    "agentGatewayUrl",
    "modelGatewayToken",
    "agentGatewayToken"
  ]) {
    assert.equal(Object.hasOwn(forwardedBody, key), false, `${key} must not be forwarded to external KD service`);
  }
}

async function verifyCloudDriveRemoteLiveEgressBoundary() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-cloud-drive-egress-"));
  const previousAllowLocal = process.env.PACT_CLOUD_DRIVE_REMOTE_LIVE_ALLOW_LOCAL;
  delete process.env.PACT_CLOUD_DRIVE_REMOTE_LIVE_ALLOW_LOCAL;
  try {
    const port = createCloudDrivePort({ userDataPath });
    await assert.rejects(
      () => port.connect({
        workspaceId: "workspace_verify",
        provider: "google-drive",
        secretRef: "secret://pact/drive/google-drive-oauth",
        mode: "remote-live",
        endpointUrl: "http://127.0.0.1:9"
      }),
      (error) => error?.code === "REMOTE_ENDPOINT_EGRESS_DENIED"
    );
  } finally {
    if (previousAllowLocal === undefined) {
      delete process.env.PACT_CLOUD_DRIVE_REMOTE_LIVE_ALLOW_LOCAL;
    } else {
      process.env.PACT_CLOUD_DRIVE_REMOTE_LIVE_ALLOW_LOCAL = previousAllowLocal;
    }
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function initGitRepo(repoPath) {
  await fs.mkdir(repoPath, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "repo boundary verifier\n", "utf8");
}

async function verifyLocalFilesystemBoundaryHardening() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-local-boundary-"));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-local-boundary-outside-"));
  const previousRepoRoots = process.env.PACT_REPO_OPERATION_ROOTS;
  let workspaceApi = null;
  let knowledgeSources = null;
  try {
    const outsideFile = path.join(outsideRoot, "outside.txt");
    await fs.writeFile(outsideFile, "outside file must stay private\n", "utf8");

    const controlledLocalRoot = path.join(userDataPath, "agent-workspaces", "local-sources", "workspace-source");
    await fs.mkdir(controlledLocalRoot, { recursive: true });
    await fs.writeFile(path.join(controlledLocalRoot, "allowed.txt"), "allowed local source\n", "utf8");
    workspaceApi = createAgentWorkspace({ userDataPath });
    const ownerAccess = { actorUserId: "owner-user" };
    const workspace = workspaceApi.createWorkspace({
      ownerUserId: "owner-user",
      title: "Local boundary verifier",
      objective: "Verify server-side local path boundaries."
    }).workspace;
    const outsideConnect = workspaceApi.connectLocalDirectory({
      ...ownerAccess,
      workspaceId: workspace.workspaceId,
      sourcePath: outsideRoot,
      targetPath: "outside"
    });
    assert.equal(outsideConnect.ok, false, "local directory connect must reject roots outside controlled sources");
    assert.equal(outsideConnect.status, 400);
    const connected = workspaceApi.connectLocalDirectory({
      ...ownerAccess,
      workspaceId: workspace.workspaceId,
      sourcePath: controlledLocalRoot,
      targetPath: "mirror"
    });
    assert.equal(connected.ok, true);
    const directPlan = workspaceApi.localDirectorySyncPlan({
      ...ownerAccess,
      workspaceId: workspace.workspaceId,
      sourcePath: controlledLocalRoot,
      targetPath: "mirror-direct"
    });
    assert.equal(directPlan.ok, false, "local directory sync must require a registered mountRef");
    assert.equal(directPlan.status, 400);
    const mountPlan = workspaceApi.localDirectorySyncPlan({
      ...ownerAccess,
      workspaceId: workspace.workspaceId,
      mountRef: connected.mount.mountRef,
      targetPath: "mirror"
    });
    assert.equal(mountPlan.ok, true);

    const cloudPort = createCloudDrivePort({ userDataPath });
    await assert.rejects(
      () => cloudPort.connect({
        workspaceId: workspace.workspaceId,
        provider: "icloud",
        rootPath: outsideRoot,
        managedFolder: true
      }),
      /受控本机来源/
    );
    const cloudRoot = path.join(userDataPath, "agent-workspaces", "cloud-drive-local-projections", "icloud");
    await fs.mkdir(path.join(cloudRoot, ".pact-data", "owner"), { recursive: true });
    const cloudConnection = await cloudPort.connect({
      workspaceId: workspace.workspaceId,
      provider: "icloud",
      rootPath: cloudRoot,
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: ["owner"],
      defaultClient: "owner"
    });
    assert.equal(cloudConnection.localAdapterVerified, true);
    const cloudSymlinkPath = path.join(cloudRoot, ".pact-data", "owner", "link.txt");
    const cloudSymlinkCreated = await fs.symlink(outsideFile, cloudSymlinkPath).then(() => true).catch(() => false);
    if (cloudSymlinkCreated) {
      await assert.rejects(
        () => cloudPort.uploadFile({
          workspaceId: workspace.workspaceId,
          driveRef: cloudConnection.drive.driveRef,
          clientId: "owner",
          path: "default/link.txt",
          content: "blocked overwrite\n",
          overwrite: true
        }),
        /符号链接/
      );
    }

    const documentRoot = path.join(userDataPath, "knowledge-sources", "local-sources", "documents");
    await fs.mkdir(documentRoot, { recursive: true });
    const controlledDocument = path.join(documentRoot, "allowed.txt");
    await fs.writeFile(controlledDocument, "controlled parser input\n", "utf8");
    const parser = createDocumentParsingRuntime();
    await assert.rejects(
      () => parser.parseDocuments({
        userDataPath,
        filePaths: [outsideFile],
        expectedOutputs: ["sources"]
      }),
      /受控本机来源|没有可处理的内容/
    );
    const controlledParse = await parser.parseDocuments({
      userDataPath,
      filePaths: [controlledDocument],
      expectedOutputs: ["sources"]
    });
    assert.equal(controlledParse.summary.sources, 1, "document parser should still read controlled local source files");

    const knowledgeRoot = path.join(userDataPath, "knowledge-sources", "local-sources", "source-a");
    await fs.mkdir(knowledgeRoot, { recursive: true });
    await fs.mkdir(path.join(userDataPath, "metadata"), { recursive: true });
    await fs.writeFile(path.join(knowledgeRoot, "note.txt"), "knowledge source\n", "utf8");
    knowledgeSources = createKnowledgeSourceService({
      userDataPath,
      watchingEnabled: false,
      jobManager: {
        getJob: async () => null,
        createJob: async () => ({ id: "job_verify_local_boundary", status: "queued" })
      }
    });
    await knowledgeSources.start();
    await assert.rejects(
      () => knowledgeSources.createSource({
        directoryPath: outsideRoot,
        runNow: false
      }),
      /受控本机来源/
    );
    const sourceCreated = await knowledgeSources.createSource({
      directoryPath: knowledgeRoot,
      runNow: false
    });
    assert.equal(sourceCreated.reason, "created");

    const outsideRepo = path.join(outsideRoot, "outside-repo");
    await initGitRepo(outsideRepo);
    const outsideRepoRead = await executeRepoOperation({
      operationId: "repo.file.read",
      input: { repoId: outsideRepo, path: "README.md" },
      authSession: { user: { scopes: ["repo:read"] } }
    });
    assert.equal(outsideRepoRead.ok, false);
    assert.equal(outsideRepoRead.error.code, "repo_root_denied");

    const allowedRepo = path.join(userDataPath, "local-sources", "repo");
    await initGitRepo(allowedRepo);
    process.env.PACT_REPO_OPERATION_ROOTS = [
      previousRepoRoots,
      allowedRepo
    ].filter(Boolean).join(path.delimiter);
    const allowedRepoRead = await executeRepoOperation({
      operationId: "repo.file.read",
      input: { repoId: allowedRepo, path: "README.md" },
      authSession: { user: { scopes: ["repo:read"] } }
    });
    assert.equal(allowedRepoRead.ok, true);
    const repoSymlinkPath = path.join(allowedRepo, "link.txt");
    const repoSymlinkCreated = await fs.symlink(outsideFile, repoSymlinkPath).then(() => true).catch(() => false);
    if (repoSymlinkCreated) {
      const symlinkRead = await executeRepoOperation({
        operationId: "repo.file.read",
        input: { repoId: allowedRepo, path: "link.txt" },
        authSession: { user: { scopes: ["repo:read"] } }
      });
      assert.equal(symlinkRead.ok, false);
      assert.equal(symlinkRead.error.code, "path_denied");
      const symlinkWrite = await executeRepoOperation({
        operationId: "repo.file.update",
        input: { repoId: allowedRepo, path: "link.txt", content: "blocked\n" },
        authSession: { user: { scopes: ["repo:write"] } }
      });
      assert.equal(symlinkWrite.ok, false);
      assert.equal(symlinkWrite.error.code, "path_denied");
    }

    const acpRoot = path.join(userDataPath, "local-sources", "acp-workspace");
    await fs.mkdir(acpRoot, { recursive: true });
    await fs.writeFile(path.join(acpRoot, "ok.txt"), "acp ok\n", "utf8");
    const acp = new AcpPermissionBridge({ workspaceRoot: acpRoot });
    const acpRead = await acp.readTextFile({ path: "ok.txt" });
    assert.equal(acpRead.ok, true);
    const acpSymlinkPath = path.join(acpRoot, "link.txt");
    const acpSymlinkCreated = await fs.symlink(outsideFile, acpSymlinkPath).then(() => true).catch(() => false);
    if (acpSymlinkCreated) {
      const acpSymlinkRead = await acp.readTextFile({ path: "link.txt" });
      assert.equal(acpSymlinkRead.ok, false);
      assert.equal(acpSymlinkRead.reasonCode, "path_denied");
      const acpSymlinkWrite = await acp.requestWriteTextFile({
        route: {
          virtualAgent: {
            capabilityPolicy: {
              writes: "allow",
              maxRisk: "destructive"
            }
          }
        },
        write: {
          path: "link.txt",
          content: "blocked\n"
        },
        approval: {
          approved: true,
          approvalId: "approval_verify"
        }
      });
      assert.equal(acpSymlinkWrite.ok, false);
      assert.equal(acpSymlinkWrite.reasonCode, "path_denied");
    }

    const registry = createCapabilityPackageRegistry({ userDataPath });
    const badManifest = normalizeCapabilityPackageManifest({
      packageId: "../escape",
      kind: "skill",
      name: "Boundary Skill",
      version: "1.0.0",
      capabilities: ["knowledge.search"],
      risk: "read_only",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      sandbox: { policy: "knowledge-only" },
      license: "UNLICENSED",
      source: "verify",
      owner: "verify"
    });
    const signedBadManifest = {
      ...badManifest,
      signature: {
        ...badManifest.signature,
        digestSha256: capabilityPackageDigest(badManifest)
      }
    };
    await assert.rejects(
      () => registry.submit({
        manifest: signedBadManifest,
        files: [{ path: "SKILL.md", content: "# Boundary Skill\n" }]
      }, { submittedBy: "verify-security-hardening" }),
      (error) =>
        error?.message === "Capability package manifest is invalid." &&
        Array.isArray(error.details) &&
        error.details.some((issue) => issue.field === "packageId")
    );
  } finally {
    if (knowledgeSources) {
      await knowledgeSources.close().catch(() => {});
    }
    if (workspaceApi) {
      workspaceApi.close();
    }
    if (previousRepoRoots === undefined) {
      delete process.env.PACT_REPO_OPERATION_ROOTS;
    } else {
      process.env.PACT_REPO_OPERATION_ROOTS = previousRepoRoots;
    }
    await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(outsideRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function rawObjectFixture({
  objectId,
  fileName,
  hash,
  storageRelativePath,
  capturedAt,
  ownerSubjectId = "",
  ownerUserId = "",
  ownerUsername = "",
  jobId = ""
}) {
  return {
    objectId,
    jobId,
    ownerSubjectId,
    ownerUserId,
    ownerUsername,
    ingestOrigin: "security-hardening-verifier",
    originalFileName: fileName,
    originalRelativePath: fileName,
    clientUid: "verifier-client",
    sourceType: "email",
    providerId: "",
    externalId: "",
    syncBatchId: "",
    contentHash: hash,
    capturedAt,
    sourceMetadata: {},
    archiveFileName: fileName,
    originalSourcePath: "",
    sourceContainerPath: "",
    storageRelativePath,
    sha256: hash,
    byteSize: 12,
    mediaType: "message/rfc822",
    sourceCreatedAt: "",
    sourceUpdatedAt: "",
    sourceCollectedAt: "",
    createdAt: capturedAt
  };
}

async function verifyOwnerBoundMigrationAndRawObjectOwnership() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-owner-bound-"));
  let workspaceApi = null;
  let metadataStore = null;
  try {
    workspaceApi = createAgentWorkspace({ userDataPath });
    const ownerlessWorkspace = workspaceApi.createWorkspace({
      title: "Legacy ownerless verifier",
      objective: "Verify ownerless workspace migration."
    }).workspace;
    assert.equal(
      workspaceApi.listWorkspaces({ actorUserId: "legacy-owner" }).workspaces.some(
        (workspace) => workspace.workspaceId === ownerlessWorkspace.workspaceId
      ),
      false,
      "ownerless workspaces must not remain caller-accessible before migration"
    );
    const workspaceMigration = workspaceApi.migrateOwnerlessWorkspaces({
      userId: "legacy-owner",
      username: "owner"
    });
    assert.equal(workspaceMigration.ok, true);
    assert.equal(workspaceMigration.migratedCount, 1);
    assert.equal(
      workspaceApi.listWorkspaces({ actorUserId: "legacy-owner" }).workspaces.some(
        (workspace) => workspace.workspaceId === ownerlessWorkspace.workspaceId
      ),
      true,
      "owner migration should bind the legacy workspace to the selected owner"
    );
    assert.equal(
      workspaceApi.listWorkspaces({ actorUserId: "other-user" }).workspaces.some(
        (workspace) => workspace.workspaceId === ownerlessWorkspace.workspaceId
      ),
      false,
      "owner migration must not make the workspace broadly visible"
    );

    metadataStore = createMetadataStore({ userDataPath });
    const capturedAt = new Date().toISOString();
    metadataStore.beginBatch({
      batchId: "batch-owned",
      jobId: "job-owned",
      generatedAt: capturedAt,
      settings: {}
    });
    metadataStore.persistSources({
      batchId: "batch-owned",
      jobId: "job-owned",
      ownerSubjectId: "owner-subject",
      ownerUserId: "owner-user",
      ownerUsername: "owner",
      warnings: [],
      rules: {},
      sources: [{
        id: "source-owned",
        name: "owned.eml",
        path: "owned.eml",
        kind: "email",
        text: "",
        rawObject: rawObjectFixture({
          objectId: "raw-owned",
          fileName: "owned.eml",
          hash: "sha256-owned",
          storageRelativePath: "objects/verifier-client/email/owned.eml",
          capturedAt
        })
      }]
    });
    const ownedRawObject = metadataStore.getRawMailObject("raw-owned");
    assert.equal(ownedRawObject.job_id, "job-owned");
    assert.equal(ownedRawObject.owner_subject_id, "owner-subject");
    assert.equal(ownedRawObject.owner_user_id, "owner-user");

    metadataStore.beginBatch({
      batchId: "batch-legacy",
      jobId: "job-legacy",
      generatedAt: capturedAt,
      settings: {}
    });
    metadataStore.persistSources({
      batchId: "batch-legacy",
      warnings: [],
      rules: {},
      sources: [{
        id: "source-legacy",
        name: "legacy.eml",
        path: "legacy.eml",
        kind: "email",
        text: "",
        rawObject: rawObjectFixture({
          objectId: "raw-legacy",
          fileName: "legacy.eml",
          hash: "sha256-legacy",
          storageRelativePath: "objects/verifier-client/email/legacy.eml",
          capturedAt
        })
      }]
    });
    const rawObjectMigration = metadataStore.migrateRawObjectOwnershipFromJobs([{
      jobId: "job-legacy",
      archiveBatchId: "batch-legacy",
      ownerSubjectId: "legacy-owner",
      ownerUserId: "legacy-owner",
      ownerUsername: "owner"
    }]);
    assert.equal(rawObjectMigration.ok, true);
    assert.equal(rawObjectMigration.migratedCount, 1);
    const legacyRawObject = metadataStore.getRawMailObject("raw-legacy");
    assert.equal(legacyRawObject.job_id, "job-legacy");
    assert.equal(legacyRawObject.owner_subject_id, "legacy-owner");
    assert.equal(legacyRawObject.owner_user_id, "legacy-owner");

    metadataStore.beginBatch({
      batchId: "batch-shared",
      jobId: "job-a",
      generatedAt: capturedAt,
      settings: {}
    });
    metadataStore.persistSources({
      batchId: "batch-shared",
      jobId: "job-a",
      warnings: [],
      rules: {},
      sources: [{
        id: "source-shared-a",
        name: "shared-a.eml",
        path: "shared-a.eml",
        kind: "email",
        text: "",
        rawObject: rawObjectFixture({
          objectId: "raw-shared-a",
          jobId: "job-a",
          fileName: "shared-a.eml",
          hash: "sha256-shared-a",
          storageRelativePath: "objects/verifier-client/email/shared-a.eml",
          capturedAt
        })
      }]
    });
    const sharedMigration = metadataStore.migrateRawObjectOwnershipFromJobs([
      {
        jobId: "job-b",
        archiveBatchId: "batch-shared",
        ownerSubjectId: "owner-b",
        ownerUserId: "owner-b",
        ownerUsername: "owner-b"
      },
      {
        jobId: "job-a",
        archiveBatchId: "batch-shared",
        ownerSubjectId: "owner-a",
        ownerUserId: "owner-a",
        ownerUsername: "owner-a"
      }
    ]);
    assert.equal(sharedMigration.ok, true);
    const sharedRawObject = metadataStore.getRawMailObject("raw-shared-a");
    assert.equal(sharedRawObject.job_id, "job-a");
    assert.equal(sharedRawObject.owner_subject_id, "owner-a", "shared archive batch migration must not bind raw object to another job owner");
    assert.throws(
      () => metadataStore.beginBatch({
        batchId: "batch-shared",
        jobId: "job-b",
        generatedAt: capturedAt,
        settings: {}
      }),
      /Archive batch id is already bound to another job/,
      "archive batch ids must not be reusable across jobs"
    );
  } finally {
    metadataStore?.close?.();
    workspaceApi?.close?.();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function verifyHttpRateLimiting() {
  const baseUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-hardening-rate-limit-ip-"));
  const ipLimitedServer = await startHttpServer({
    userDataPath: baseUserDataPath,
    runtimeOptions: {
      profile: "minimal",
      httpRateLimitPerIpPerMinute: 2,
      httpRateLimitPerSubjectPerMinute: 100,
      httpRateLimitLoginPerIpPerMinute: 100,
      httpRateLimitWindowMs: 60_000
    }
  });
  try {
    const first = await requestText(`${ipLimitedServer.url}/api/healthz`);
    const second = await requestText(`${ipLimitedServer.url}/api/healthz`);
    const third = await requestText(`${ipLimitedServer.url}/api/healthz`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
  } finally {
    await ipLimitedServer.close();
    await fs.rm(baseUserDataPath, { recursive: true, force: true });
  }

  const subjectUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-hardening-rate-limit-subject-"));
  const subjectServer = await startHttpServer({
    userDataPath: subjectUserDataPath,
    runtimeOptions: {
      profile: "minimal",
      httpRateLimitPerIpPerMinute: 100,
      httpRateLimitPerSubjectPerMinute: 2,
      httpRateLimitLoginPerIpPerMinute: 100,
      httpRateLimitWindowMs: 60_000
    }
  });
  try {
    const credentials = parseOwnerCredentials(
      await fs.readFile(subjectServer.initialOwner?.credentialsPath || "", "utf8")
    );
    const loginResponse = await requestJson(`${subjectServer.url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: credentials.username,
        password: credentials.password
      })
    });
    assert.equal(loginResponse.status, 200);
    const cookie = cookieFromResponse(loginResponse);

    const firstSession = await requestText(`${subjectServer.url}/api/auth/session`, {
      headers: { Cookie: cookie }
    });
    const secondSession = await requestText(`${subjectServer.url}/api/auth/session`, {
      headers: { Cookie: cookie }
    });
    const thirdSession = await requestText(`${subjectServer.url}/api/auth/session`, {
      headers: { Cookie: cookie }
    });
    assert.equal(firstSession.status, 200);
    assert.equal(secondSession.status, 200);
    assert.equal(thirdSession.status, 429);
  } finally {
    await subjectServer.close();
    await fs.rm(subjectUserDataPath, { recursive: true, force: true });
  }

  const loginUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-hardening-rate-limit-login-"));
  const loginServer = await startHttpServer({
    userDataPath: loginUserDataPath,
    runtimeOptions: {
      profile: "minimal",
      httpRateLimitPerIpPerMinute: 100,
      httpRateLimitPerSubjectPerMinute: 100,
      httpRateLimitLoginPerIpPerMinute: 1,
      httpRateLimitWindowMs: 60_000
    }
  });
  try {
    const loginFirst = await requestJson(`${loginServer.url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", password: "wrong-pass-" + Date.now() })
    });
    assert.equal(loginFirst.status, 401);
    assert.equal(loginFirst.payload.error, "用户名或密码错误。");
    const loginSecond = await requestJson(`${loginServer.url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "owner", password: "wrong-pass-" + Date.now() })
    });
    assert.equal(loginSecond.status, 429);
  } finally {
    await loginServer.close();
    await fs.rm(loginUserDataPath, { recursive: true, force: true });
  }
}

async function verifyAuthorizationTenantAbac(userDataPath) {
  const authorizationStore = createAuthorizationStore({ userDataPath });
  const authorizationEngine = createAuthorizationEngine({ store: authorizationStore });
  try {
    const subject = {
      type: "console-user",
      subjectId: "agent-a",
      username: "agent-a",
      roleId: "operator",
      tenantId: "tenant-a",
      scopes: ["workspace:read", "knowledge:read"],
      allowedWorkspaceIds: ["workspace-a"],
      allowedDataClasses: ["internal"],
      allowedEgress: ["searchResult", "evidenceRead"]
    };

    const tenantDenied = authorizationEngine.evaluate({
      operation: {
        id: "knowledge.evidence.get",
        requiredScopes: ["knowledge:read"],
        safety: { risk: "read_only" },
        readOnly: true
      },
      subject,
      input: {
        tenantId: "tenant-b",
        workspaceId: "workspace-a",
        dataClass: "internal",
        requestedEgress: "evidenceRead"
      },
      traceId: "trace_security_hardening_authz"
    });
    assert.equal(tenantDenied.allowed, false);
    assert.equal(tenantDenied.reasonCode, "tenant_mismatch");
    assert.equal(tenantDenied.tenant.subjectTenantId, "tenant-a");
    assert.equal(tenantDenied.tenant.resourceTenantId, "tenant-b");

    const workspaceDenied = authorizationEngine.evaluate({
      operation: {
        id: "workspace.file.list",
        requiredScopes: ["workspace:read"],
        safety: { risk: "read_only" },
        readOnly: true
      },
      subject,
      input: {
        tenantId: "tenant-a",
        workspaceId: "workspace-b",
        dataClass: "internal",
        requestedEgress: "searchResult"
      }
    });
    assert.equal(workspaceDenied.allowed, false);
    assert.equal(workspaceDenied.reasonCode, "workspace_not_allowed");

    const egressDenied = authorizationEngine.evaluate({
      operation: {
        id: "knowledge.export.request",
        requiredScopes: ["knowledge:read"],
        safety: { risk: "read_only" },
        readOnly: true
      },
      subject,
      input: {
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        dataClass: "internal",
        requestedEgress: "exportFile"
      }
    });
    assert.equal(egressDenied.allowed, false);
    assert.equal(egressDenied.reasonCode, "egress_not_allowed");

    const allowed = authorizationEngine.evaluate({
      operation: {
        id: "knowledge.search",
        requiredScopes: ["knowledge:read"],
        safety: { risk: "read_only" },
        readOnly: true
      },
      subject,
      input: {
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        dataClass: "internal",
        requestedEgress: "searchResult"
      }
    });
    assert.equal(allowed.allowed, true);
    assert.ok(allowed.evaluatedLayers.includes("tenant_boundary_policy"));
    assert.ok(allowed.evaluatedLayers.includes("abac_resource_policy"));

    const storedTenantDenied = authorizationStore.listDecisions({
      traceId: "trace_security_hardening_authz",
      tenantId: "tenant-b",
      limit: 10
    });
    assert.equal(storedTenantDenied.length, 1);
    assert.equal(storedTenantDenied[0].reasonCode, "tenant_mismatch");

    const deniedRequests = authorizationStore.listDeniedRequests({ tenantId: "tenant-b", limit: 10 });
    assert.equal(deniedRequests.length, 1);
    assert.equal(deniedRequests[0].reasonCode, "tenant_mismatch");
  } finally {
    authorizationStore.close();
  }
}

async function verifyConsoleTenantCli(userDataPath) {
  const auth = createConsoleAuth({ userDataPath });
  try {
    const user = await auth.createUser({
      username: "tenant-viewer",
      password: "tenant-viewer-password",
      roleId: "viewer",
      tenantId: "tenant-a",
      orgId: "org-a",
      teamIds: ["team-a"],
      allowedWorkspaceIds: ["workspace-a"],
      allowedDataClasses: ["internal"],
      allowedEgress: ["searchResult"]
    });
    assert.equal(user.tenantId, "tenant-a");
    assert.deepEqual(user.allowedWorkspaceIds, ["workspace-a"]);

    const updated = await auth.updateUser(user.userId, {
      tenantId: "tenant-b",
      allowedWorkspaceIds: ["workspace-b"],
      allowedEgress: ["evidenceRead"]
    });
    assert.equal(updated.tenantId, "tenant-b");
    assert.deepEqual(updated.allowedWorkspaceIds, ["workspace-b"]);
    assert.deepEqual(updated.allowedEgress, ["evidenceRead"]);
  } finally {
    auth.close();
  }
}

function verifyAuditRetentionExport(userDataPath) {
  const auditStore = createOperationAuditStore({ userDataPath });
  try {
    auditStore.setRetentionPolicy({ retentionDays: 30, maxExportItems: 25, updatedBy: { userId: "owner" } });
    const policy = auditStore.getRetentionPolicy();
    assert.equal(policy.retentionDays, 30);
    assert.equal(policy.maxExportItems, 25);

    auditStore.append({
      traceId: "trace_security_hardening_audit",
      tenantId: "tenant-a",
      operationId: "knowledge.export.request",
      transport: "http",
      actor: { userId: "agent-a", username: "agent-a", tenantId: "tenant-a" },
      status: "ok",
      input: {
        token: "secret-token-value",
        nested: { apiKey: "api-key-value" },
        path: "/Users/unka/private/file.txt",
        requestedEgress: "exportFile"
      },
      output: {
        downloadUrl: "https://example.local/download?token=secret-token-value"
      }
    });

    const listed = auditStore.list({ traceId: "trace_security_hardening_audit", tenantId: "tenant-a" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].redactedInput.token, "<redacted>");
    assert.equal(listed[0].redactedInput.nested.apiKey, "<redacted>");
    assert.equal(listed[0].redactedInput.path, "<redacted-path>");

    const exported = auditStore.exportRedacted({
      traceId: "trace_security_hardening_audit",
      tenantId: "tenant-a"
    });
    assert.equal(exported.manifest.protocolVersion, "v0.0.1:platform:audit-export-1");
    assert.equal(exported.items.length, 1);
    assert.doesNotMatch(exported.jsonl, /secret-token-value|api-key-value|\/Users\/unka\/private/);

    auditStore.append({
      traceId: "trace_security_hardening_old",
      operationId: "old.operation",
      createdAt: "2000-01-01T00:00:00.000Z",
      status: "ok"
    });
    const prune = auditStore.pruneExpired({ retentionDays: 1 });
    assert.ok(prune.deletedCount >= 1);
    assert.equal(auditStore.list({ traceId: "trace_security_hardening_old" }).length, 0);
  } finally {
    auditStore.close();
  }
}

async function verifyClientRegistrationCapacity() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-client-registry-"));
  const db = new Database(path.join(dir, "metadata.sqlite"));
  try {
    initializeMetadataSchema(db);
    const registry = createClientRegistryService({ db, maxClientRegistrations: 1 });
    const first = registry.recordClientCheckIn({
      clientId: "client-a",
      clientLabel: "Client A",
      offlineAfterSeconds: 60
    });
    assert.equal(first.ok, true);

    const updateExisting = registry.recordClientCheckIn({
      clientId: "client-a",
      clientLabel: "Client A updated",
      offlineAfterSeconds: 60
    });
    assert.equal(updateExisting.ok, true);

    const denied = registry.recordClientCheckIn({
      clientId: "client-b",
      clientLabel: "Client B",
      offlineAfterSeconds: 60
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.statusCode, 429);
    assert.equal(denied.code, "client_registration_capacity_exceeded");

    db.prepare("UPDATE client_registrations SET last_seen_at = ? WHERE client_id = ?")
      .run("2000-01-01T00:00:00.000Z", "client-a");
    const afterPrune = registry.recordClientCheckIn({
      clientId: "client-b",
      clientLabel: "Client B",
      offlineAfterSeconds: 60
    });
    assert.equal(afterPrune.ok, true);
  } finally {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function verifyNormalizedDocumentPathBoundary() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-normalized-docs-"));
  const jobId = "job-security";
  const normalizedRoot = path.join(dir, "jobs", jobId, "normalized-documents");
  await fs.mkdir(normalizedRoot, { recursive: true });
  await fs.writeFile(path.join(normalizedRoot, "safe.txt"), "ok", "utf8");
  assert.equal(
    resolveNormalizedDocumentPath(dir, jobId, { relativePath: "safe.txt" }),
    path.join(normalizedRoot, "safe.txt")
  );
  assert.throws(
    () => resolveNormalizedDocumentPath(dir, jobId, { relativePath: "../escape.txt" }),
    /归一化文档路径越界/
  );
  const symlinkPath = path.join(normalizedRoot, "escape-link.txt");
  const symlinkCreated = await fs.symlink("/etc/passwd", symlinkPath).then(() => true).catch(() => false);
  if (symlinkCreated) {
    assert.throws(
      () => resolveNormalizedDocumentPath(dir, jobId, { relativePath: "escape-link.txt" }),
      /归一化文档路径越界/
    );
  }
  await fs.rm(dir, { recursive: true, force: true });
}

async function verifyBackupRestorePathBoundary() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-backup-restore-"));
  try {
    await fs.writeFile(path.join(dir, "data.txt"), "safe", "utf8");
    const backup = await createStorageBackup({ userDataPath: dir, label: "security" });
    await fs.rm(path.join(dir, "data.txt"), { force: true });
    const symlinkCreated = await fs.symlink("/etc/passwd", path.join(dir, "data.txt")).then(() => true).catch(() => false);
    if (!symlinkCreated) {
      return;
    }
    const preview = await restoreStorageBackup({
      userDataPath: dir,
      backupId: backup.backupId,
      dryRun: true,
      apply: false
    });
    assert.ok(
      preview.plannedActions.some((action) =>
        action.relativePath === "data.txt" &&
        action.action === "blocked" &&
        action.reason === "target_symlink_outside_root"
      ),
      "backup restore preview must block symlink escapes"
    );
    await assert.rejects(
      restoreStorageBackup({
        userDataPath: dir,
        backupId: backup.backupId,
        dryRun: false,
        apply: true
      }),
      /target_symlink_outside_root/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function verifyDeletionCoordinatorPathBoundary() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-delete-boundary-"));
  const victimDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-delete-victim-"));
  const victimFile = path.join(victimDir, "keep.txt");
  await fs.writeFile(victimFile, "keep", "utf8");
  let deleteOperationCalled = false;
  const maliciousOperation = {
    operationId: "delete-op-malicious",
    batchId: "batch-malicious",
    state: {
      jobId: "job-malicious",
      jobDirectory: victimDir,
      objectRootPath: path.join(dir, "objects"),
      rawObjectPaths: [],
      runtimeDeleted: true,
      metadataDeleted: true,
      artifactsDeleted: false
    }
  };
  const metadataStore = {
    listPendingDeletionOperations: () => [maliciousOperation],
    getBatchArtifactPaths: () => ({ objectRootPath: path.join(dir, "objects") }),
    listRawObjectStoragePathsByBatch: () => [],
    updateBatchStatus: () => null,
    updateDeletionOperation: (_operationId, patch = {}) => ({
      ...maliciousOperation,
      ...patch,
      state: patch.state || maliciousOperation.state
    }),
    deleteDeletionOperation: () => {
      deleteOperationCalled = true;
    }
  };
  const coordinator = createBatchDeletionCoordinator({
    userDataPath: dir,
    jobManager: {
      getJob: async () => null,
      deleteJob: async () => null
    },
    metadataStore
  });
  try {
    await coordinator.resumePendingDeletions();
    assert.equal(await fs.readFile(victimFile, "utf8"), "keep");
    assert.equal(deleteOperationCalled, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(victimDir, { recursive: true, force: true });
  }
}

async function verifyHttpTraceDrilldown() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-hardening-http-"));
  const server = await startHttpServer({
    userDataPath,
    runtimeOptions: {
      profile: "minimal",
      cwd: repoRoot
    }
  });
  try {
    const auth = await installAuthenticatedFetch(server);
    const missingStatic = await requestJson(`${server.url}/missing/rpc_private_token.txt`);
    assert.equal(missingStatic.status, 404);
    assert.doesNotMatch(JSON.stringify(missingStatic.payload), /rpc_private_token|\/missing/);

    const settings = await requestJson(`${server.url}/api/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST", safetyConfirm: true })
      },
      body: JSON.stringify({
        analysisModuleId: "builtin:security-hardening"
      })
    });
    assert.equal(settings.status, 200);
    const traceId = settings.headers.get("x-pact-trace-id");
    assert.match(traceId, /^trace_/);

    const trace = await requestJson(`${server.url}/api/observability/traces/${encodeURIComponent(traceId)}?limit=50`, {
      headers: authHeaders(auth)
    });
    assert.equal(trace.status, 200);
    assert.equal(trace.payload.protocolVersion, "v0.0.1:platform:trace-drilldown-1");
    assert.equal(trace.payload.traceId, traceId);
    assert.ok(
      trace.payload.auditItems.some((item) => item.operationId === "settings.set"),
      "trace drill-down must include the audited operation"
    );

    const retention = await requestJson(`${server.url}/api/auth/audit/retention`, {
      headers: authHeaders(auth)
    });
    assert.equal(retention.status, 200);
    assert.equal(retention.payload.policy.policyVersion, "v0.0.1:platform:audit-retention-1");

    const pathBrowseEscape = await requestJson(`${server.url}/api/runtime/path-browse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST" })
      },
      body: JSON.stringify({ path: "/etc", includeHidden: true })
    });
    assert.equal(pathBrowseEscape.status, 200);
    assert.equal(path.resolve(pathBrowseEscape.payload.currentPath), repoRoot);
    assert.equal(
      (pathBrowseEscape.payload.roots || []).some((root) => path.resolve(root.path) === path.parse(repoRoot).root),
      false,
      "runtime path browser must not expose the filesystem root as a selectable root"
    );

    const symlinkPath = path.join(userDataPath, "path-browser-escape-link");
    const symlinkCreated = await fs.symlink("/etc", symlinkPath).then(() => true).catch(() => false);
    if (symlinkCreated) {
      const pathBrowseSymlinkEscape = await requestJson(`${server.url}/api/runtime/path-browse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(auth, { method: "POST" })
        },
        body: JSON.stringify({ path: symlinkPath })
      });
      assert.equal(pathBrowseSymlinkEscape.status, 200);
      assert.equal(path.resolve(pathBrowseSymlinkEscape.payload.currentPath), repoRoot);
    }

    const auditExport = await requestJson(`${server.url}/api/auth/audit/export?limit=50&traceId=${encodeURIComponent(traceId)}`, {
      headers: authHeaders(auth)
    });
    assert.equal(auditExport.status, 200);
    assert.equal(auditExport.payload.export.manifest.protocolVersion, "v0.0.1:platform:audit-export-1");
    assert.ok(auditExport.payload.export.manifest.itemCount >= 1);
  } finally {
    await server.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function verifyCspAndHtmlSandboxRuntime(userDataPath) {
  const distRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-hardening-dist-"));
  const distPath = path.join(distRoot, "dist");
  await fs.mkdir(distPath, { recursive: true });
  await fs.writeFile(
    path.join(distPath, "index.html"),
    `<!doctype html><html><head><script>var preset = localStorage.getItem('pact-appearance-preset');</script></head><body><div id=\"root\"></div></body></html>`
  );
  const server = await startHttpServer({
    userDataPath,
    distPath,
    runtimeOptions: {
      profile: "minimal",
      cwd: repoRoot
    }
  });
  try {
    const response = await requestText(`${server.url}/`);
    assert.equal(response.status, 200);
    const csp = response.headers.get("content-security-policy") || "";
    assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+\/=]+'/);
    assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/);
    assert.match(response.body, /<script[^>]*nonce=\"[^\"]+\"/);
    assert.match(response.body, /var preset = localStorage\.getItem\('pact-appearance-preset'\);/);
  } finally {
    await server.close();
    await fs.rm(distRoot, { recursive: true, force: true });
  }
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-hardening-"));
try {
  await verifyStaticSecurityBlockers();
  await verifyStaticSecurityHardeningCode();
  verifyModelEgressAndToolCatalogScopeBoundaries();
  verifyProxyCredentialTrustBoundary();
  await verifyExternalKnowledgeDistillationEgressBoundary();
  await verifyCloudDriveRemoteLiveEgressBoundary();
  await verifyLocalFilesystemBoundaryHardening();
  await verifyOwnerBoundMigrationAndRawObjectOwnership();
  await verifyHttpRateLimiting();
  await verifyAuthorizationTenantAbac(userDataPath);
  await verifyConsoleTenantCli(userDataPath);
  verifyAuditRetentionExport(userDataPath);
  await verifyClientRegistrationCapacity();
  await verifyNormalizedDocumentPathBoundary();
  await verifyBackupRestorePathBoundary();
  await verifyDeletionCoordinatorPathBoundary();
  await verifyHttpTraceDrilldown();
  await verifyCspAndHtmlSandboxRuntime(userDataPath);
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("security hardening verification passed");
