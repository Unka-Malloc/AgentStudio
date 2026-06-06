import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthorizationEngine } from "../platform/common/security/authorization/authorization-engine.mjs";
import { createAuthorizationStore } from "../platform/common/security/authorization/authorization-store.mjs";
import { createConsoleAuth } from "../platform/common/security/auth/console-auth.mjs";
import { createOperationAuditStore } from "../platform/common/security/operation-audit.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

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
  const [httpServerSource, safeHtmlSource, evidenceRendererSource, viteConfigSource, dockerIgnoreSource, composeSource] = await Promise.all([
    fs.readFile(path.join(repoRoot, "server/services/server-runtime/http-server.mjs"), "utf8"),
    fs.readFile(path.join(repoRoot, "server-web/components/SafeHtmlBlock.vue"), "utf8"),
    fs.readFile(path.join(repoRoot, "server-web/composables/console-evidence-rendering.ts"), "utf8"),
    fs.readFile(path.join(repoRoot, "vite.config.ts"), "utf8"),
    fs.readFile(path.join(repoRoot, ".dockerignore"), "utf8"),
    fs.readFile(path.join(repoRoot, "docker-compose.yml"), "utf8")
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
  assert.doesNotMatch(safeHtmlSource, /v-html=\"props\\.html\"/, "SafeHtmlBlock should not render source html without sanitizer");
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
  const runtimeStage = dockerfile.split(/FROM\s+node:24-bookworm-slim\s+AS\s+runtime\b/)[1] || "";
  assert.match(runtimeStage, /groupadd\s+--system[\s\S]*\bpact\b/, "runtime Docker stage must create a dedicated pact group");
  assert.match(runtimeStage, /useradd\s+--system[\s\S]*\bpact\b/, "runtime Docker stage must create a dedicated pact user");
  assert.match(runtimeStage, /COPY\s+--chown=pact:pact\s+--from=build/, "runtime Docker stage must copy app files for the pact user");
  assert.match(runtimeStage, /COPY\s+--chown=pact:pact\s+--from=runtime-deps/, "runtime Docker stage must copy runtime modules for the pact user");
  assert.match(runtimeStage, /chown\s+-R\s+pact:pact\s+\/data\s+\/codex-home/, "runtime data directories must be owned by the pact user");
  assert.match(runtimeStage, /^USER pact$/m, "runtime Docker stage must run as the pact user");
  assert.equal(/^USER root$/m.test(runtimeStage), false, "runtime Docker stage must not switch back to root");
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
    assert.equal(exported.manifest.protocolVersion, "pact.audit-export.v1");
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
    assert.equal(trace.payload.protocolVersion, "pact.trace-drilldown.v1");
    assert.equal(trace.payload.traceId, traceId);
    assert.ok(
      trace.payload.auditItems.some((item) => item.operationId === "settings.set"),
      "trace drill-down must include the audited operation"
    );

    const retention = await requestJson(`${server.url}/api/auth/audit/retention`, {
      headers: authHeaders(auth)
    });
    assert.equal(retention.status, 200);
    assert.equal(retention.payload.policy.policyVersion, "pact.audit-retention.v1");

    const auditExport = await requestJson(`${server.url}/api/auth/audit/export?limit=50&traceId=${encodeURIComponent(traceId)}`, {
      headers: authHeaders(auth)
    });
    assert.equal(auditExport.status, 200);
    assert.equal(auditExport.payload.export.manifest.protocolVersion, "pact.audit-export.v1");
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
    `<!doctype html><html><head><script>var t = localStorage.getItem('pact-theme');</script></head><body><div id=\"root\"></div></body></html>`
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
    assert.match(response.body, /var t = localStorage\.getItem\('pact-theme'\);/);
  } finally {
    await server.close();
    await fs.rm(distRoot, { recursive: true, force: true });
  }
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-security-hardening-"));
try {
  await verifyStaticSecurityBlockers();
  await verifyStaticSecurityHardeningCode();
  await verifyHttpRateLimiting();
  await verifyAuthorizationTenantAbac(userDataPath);
  await verifyConsoleTenantCli(userDataPath);
  verifyAuditRetentionExport(userDataPath);
  await verifyHttpTraceDrilldown();
  await verifyCspAndHtmlSandboxRuntime(userDataPath);
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("security hardening verification passed");
