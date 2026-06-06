import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { default as createConsoleAuth } from "../platform/common/security/auth/console-auth.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { readInitialOwnerCredentials } from "./test-auth-helper.mjs";

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  return {
    ok: response.ok,
    status: response.status,
    payload,
    headers: response.headers
  };
}

function cookieHeaderFrom(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response.headers.get("set-cookie") || "")
          .split(/,(?=\s*pact_)/)
          .filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function sessionTokenFromCookie(cookie) {
  return String(cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("pact_console_session="))
    ?.slice("pact_console_session=".length) || "";
}

async function postJson(baseUrl, pathName, payload, { cookie = "", csrf = "", safetyConfirm = false } = {}) {
  return requestJson(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { "x-pact-csrf": csrf } : {}),
      ...(safetyConfirm ? { "x-pact-safety-confirm": "true" } : {})
    },
    body: JSON.stringify(payload || {})
  });
}

async function getJson(baseUrl, pathName, { cookie = "", headers = {} } = {}) {
  return requestJson(`${baseUrl}${pathName}`, {
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    }
  });
}

async function login(baseUrl, username, password) {
  const response = await postJson(baseUrl, "/api/auth/login", { username, password });
  assert.equal(response.status, 200);
  return {
    cookie: cookieHeaderFrom(response),
    csrf: response.payload.csrfToken
  };
}

function runAuthCli(args) {
  const scriptPath = fileURLToPath(new URL("./console-auth.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "console-auth CLI failed");
  }
  return result.stdout;
}

async function assertConsoleAuthCannotBeDisabled() {
  const previousAuth = process.env.PACT_CONSOLE_AUTH;
  delete process.env.PACT_CONSOLE_AUTH;
  try {
    await assert.rejects(
      startHttpServer({
        userDataPath: await fs.mkdtemp(path.join(os.tmpdir(), "pact-auth-disabled-blocked-")),
        host: "127.0.0.1",
        port: 0,
        runtimeOptions: {
          profile: "minimal",
          consoleAuth: "disabled"
        }
      }),
      /已被移除/
    );
    process.env.PACT_CONSOLE_AUTH = "disabled";
    await assert.rejects(
      startHttpServer({
        userDataPath: await fs.mkdtemp(path.join(os.tmpdir(), "pact-auth-env-disabled-blocked-")),
        host: "127.0.0.1",
        port: 0,
        runtimeOptions: {
          profile: "minimal"
        }
      }),
      /已被移除/
    );
  } finally {
    if (previousAuth === undefined) {
      delete process.env.PACT_CONSOLE_AUTH;
    } else {
      process.env.PACT_CONSOLE_AUTH = previousAuth;
    }
  }
}

await assertConsoleAuthCannotBeDisabled();

await assert.rejects(
  startHttpServer({
    userDataPath: await fs.mkdtemp(path.join(os.tmpdir(), "pact-public-listen-blocked-")),
    host: "0.0.0.0",
    port: 0,
    runtimeOptions: {
      profile: "minimal"
    }
  }),
  /默认只允许监听本机回环地址/
);

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-auth-"));
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});

try {
  const initialSession = await getJson(server.url, "/api/auth/session");
  assert.equal(initialSession.status, 200);
  assert.equal(initialSession.payload.enabled, true);
  assert.equal(initialSession.payload.bootstrap.required, false);
  assert.equal(initialSession.payload.bootstrap.tokenFilePath, "");

  const publicHealth = await getJson(server.url, "/api/healthz");
  assert.equal(publicHealth.status, 200);

  const publicBootstrap = await getJson(server.url, "/api/bootstrap");
  assert.equal(publicBootstrap.status, 200);

  const interfacesBeforeLogin = await getJson(server.url, "/api/interfaces");
  assert.equal(interfacesBeforeLogin.status, 401);

  const eventsBeforeLogin = await getJson(server.url, "/api/events?includeSnapshot=1");
  assert.equal(eventsBeforeLogin.status, 401);

  const agentSyncSubscribeBeforeLogin = await getJson(
    server.url,
    "/api/agent-sync/events?topic=answer&includeSnapshot=1"
  );
  assert.equal(agentSyncSubscribeBeforeLogin.status, 401);

  const agentsBeforeLogin = await getJson(server.url, "/api/agents");
  assert.equal(agentsBeforeLogin.status, 401);

  const oauthStatusBeforeLogin = await getJson(server.url, "/api/oauth/codex/status");
  assert.equal(oauthStatusBeforeLogin.status, 401);

  const consoleBeforeLogin = await getJson(server.url, "/api/knowledge/console");
  assert.equal(consoleBeforeLogin.status, 401);

  const ownerCredentials = await readInitialOwnerCredentials(server);
  const ownerPassword = ownerCredentials.password;
  assert.ok(ownerPassword);
  assert.ok(ownerCredentials.credentialsPath);
  await fs.access(ownerCredentials.credentialsPath);
  await assert.rejects(
    fs.access(path.join(userDataPath, "auth", "initial-owner-password.txt"))
  );
  const owner = await login(server.url, ownerCredentials.username, ownerPassword);
  let ownerCookie = owner.cookie;
  let ownerCsrf = owner.csrf;
  assert.ok(ownerCookie.includes("pact_console_session="));
  assert.ok(ownerCsrf);
  await assert.rejects(fs.access(ownerCredentials.credentialsPath));

  const ownerSession = await getJson(server.url, "/api/auth/session", {
    cookie: ownerCookie
  });
  assert.equal(ownerSession.status, 200);
  const ownerSessionWithMismatchedUserAgent = await getJson(server.url, "/api/auth/session", {
    cookie: ownerCookie,
    headers: {
      "User-Agent": "pact-ua-mismatch-test/1.0"
    }
  });
  assert.equal(ownerSessionWithMismatchedUserAgent.status, 200);
  assert.equal(ownerSessionWithMismatchedUserAgent.payload.session.authenticated, true);
  const authStore = createConsoleAuth({ userDataPath: userDataPath });
  const uaMismatchAudit = authStore.listAudit({ status: "warning" });
  try {
    assert.ok(
      uaMismatchAudit.some((item) => item.action === "user-agent-mismatch"),
      "user-agent mismatch should be visible in auth audit"
    );
  } finally {
    authStore.close();
  }
  for (const scope of ["workspace:read", "workspace:write", "workspace:maintain", "storage:read", "storage:write"]) {
    assert.ok(
      ownerSession.payload.session.user.scopes.includes(scope),
      `owner role should include ${scope}`
    );
  }

  const rotatedOwner = await postJson(
    server.url,
    "/api/auth/sessions/rotate",
    {},
    { cookie: ownerCookie, csrf: ownerCsrf }
  );
  assert.equal(rotatedOwner.status, 200);
  const rotatedOwnerCookie = cookieHeaderFrom(rotatedOwner);
  const rotatedOwnerCsrf = rotatedOwner.payload.csrfToken;
  assert.ok(rotatedOwnerCookie.includes("pact_console_session="));
  assert.notEqual(sessionTokenFromCookie(rotatedOwnerCookie), sessionTokenFromCookie(ownerCookie));
  const oldOwnerSession = await getJson(server.url, "/api/auth/session", {
    cookie: ownerCookie
  });
  assert.equal(oldOwnerSession.payload.session.authenticated, false);
  const newOwnerSession = await getJson(server.url, "/api/auth/session", {
    cookie: rotatedOwnerCookie
  });
  assert.equal(newOwnerSession.payload.session.authenticated, true);
  assert.equal(newOwnerSession.payload.session.user.username, "owner");
  ownerCookie = rotatedOwnerCookie;
  ownerCsrf = rotatedOwnerCsrf;

  const headerSessionBypass = await requestJson(`${server.url}/api/knowledge/console`, {
    headers: {
      "x-pact-console-session": sessionTokenFromCookie(ownerCookie)
    }
  });
  assert.equal(headerSessionBypass.status, 401);

  const unauthenticatedWrite = await postJson(server.url, "/api/knowledge/maintenance/run", {
    taskType: "validate_assets"
  });
  assert.equal(unauthenticatedWrite.status, 401);

  const missingCsrf = await postJson(
    server.url,
    "/api/knowledge/maintenance/run",
    { taskType: "validate_assets" },
    { cookie: ownerCookie }
  );
  assert.equal(missingCsrf.status, 403);

  const badOrigin = await requestJson(`${server.url}/api/knowledge/maintenance/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: ownerCookie,
      "x-pact-csrf": ownerCsrf,
      Origin: "https://evil.example"
    },
    body: JSON.stringify({ taskType: "validate_assets" })
  });
  assert.equal(badOrigin.status, 403);
  assert.match(badOrigin.payload.error, /来源/);

  const ownerMaintenance = await postJson(
    server.url,
    "/api/knowledge/maintenance/run",
    { taskType: "validate_assets" },
    { cookie: ownerCookie, csrf: ownerCsrf }
  );
  assert.equal(ownerMaintenance.status, 200);
  assert.equal(ownerMaintenance.payload.status, "completed");

  const ownerRepairWithoutConfirm = await postJson(
    server.url,
    "/api/knowledge/maintenance/run",
    { taskType: "reindex" },
    { cookie: ownerCookie, csrf: ownerCsrf }
  );
  assert.equal(ownerRepairWithoutConfirm.status, 428);
  assert.equal(ownerRepairWithoutConfirm.payload.operationId, "knowledge.maintenance.run");
  assert.equal(ownerRepairWithoutConfirm.payload.safety.risk, "repair_write");

  const ownerHttpCreate = await postJson(
    server.url,
    "/api/auth/users",
    {
      username: "blocked-owner-http",
      password: "blocked-password-123",
      roleId: "viewer"
    },
    { cookie: ownerCookie, csrf: ownerCsrf }
  );
  assert.equal(ownerHttpCreate.status, 405);

  runAuthCli([
    "--data-dir",
    userDataPath,
    "create-user",
    "--username",
    "viewer",
    "--password",
    "viewer-password-123",
    "--role",
    "viewer"
  ]);
  runAuthCli([
    "--data-dir",
    userDataPath,
    "create-user",
    "--username",
    "operator",
    "--password",
    "operator-password-123",
    "--role",
    "operator"
  ]);
  const cliSetPassword = runAuthCli(
    [
      "--data-dir",
      userDataPath,
      "set-password",
      "--username",
      "viewer",
      "--generate-password"
    ]
  );
  assert.match(cliSetPassword, /new password: sap_/);
  runAuthCli([
    "--data-dir",
    userDataPath,
    "set-password",
    "--username",
    "viewer",
    "--password",
    "viewer-password-123"
  ]);

  const viewer = await login(server.url, "viewer", "viewer-password-123");
  const viewerConsole = await getJson(server.url, "/api/knowledge/console", {
    cookie: viewer.cookie
  });
  assert.equal(viewerConsole.status, 200);
  const viewerMaintenance = await postJson(
    server.url,
    "/api/knowledge/maintenance/run",
    { taskType: "validate_assets" },
    { cookie: viewer.cookie, csrf: viewer.csrf }
  );
  assert.equal(viewerMaintenance.status, 403);

  const operator = await login(server.url, "operator", "operator-password-123");
  const operatorJob = await postJson(
    server.url,
    "/api/jobs",
    {
      inputText: "Console auth operator ingest smoke.",
      uploadedFiles: [],
      settings: {}
    },
    { cookie: operator.cookie, csrf: operator.csrf }
  );
  assert.equal(operatorJob.status, 202);
  assert.ok(operatorJob.payload.id);

  const operatorUserCreate = await postJson(
    server.url,
    "/api/auth/users",
    {
      username: "blocked",
      password: "blocked-password-123",
      roleId: "viewer"
    },
    { cookie: operator.cookie, csrf: operator.csrf }
  );
  assert.equal(operatorUserCreate.status, 403);

  const oidc = await postJson(
    server.url,
    "/api/auth/oidc",
    {
      enabled: true,
      issuer: "https://idp.example.local",
      clientId: "pact-console",
      clientSecret: "secret-value",
      redirectUri: `${server.url}/api/auth/oidc/callback`,
      allowedDomains: ["example.local"],
      roleMapping: {
        "ops@example.local": "operator"
      }
    },
    { cookie: ownerCookie, csrf: ownerCsrf, safetyConfirm: true }
  );
  assert.equal(oidc.status, 200);
  assert.equal(oidc.payload.oidc.clientSecretConfigured, true);
  assert.equal(oidc.payload.oidc.clientSecret, undefined);

  const traversal = await getJson(
    server.url,
    "/api/knowledge/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    { cookie: ownerCookie }
  );
  assert.notEqual(traversal.status, 200);

  const audit = await getJson(server.url, "/api/auth/audit?limit=20", {
    cookie: ownerCookie
  });
  assert.equal(audit.status, 200);
  assert.ok(audit.payload.items.length > 0);

  console.log("Console auth verification passed.");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
