import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONSOLE_CSRF_COOKIE,
  CONSOLE_SESSION_COOKIE,
  createConsoleAuth
} from "../../../server/platform/common/security/auth/console-auth.mjs";

async function withTempAuth(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-auth-"));
  const auth = createConsoleAuth({ userDataPath });
  try {
    return await callback(auth, userDataPath);
  } finally {
    auth.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function makeRequest({
  cookie = "",
  csrf = "",
  host = "console.local",
  method = "GET",
  origin = "",
  referer = "",
  remoteAddress = "127.0.0.1",
  secure = false,
  userAgent = "vitest-agent",
  url = "/api/console"
} = {}) {
  const headers = {
    host,
    "user-agent": userAgent
  };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-pact-csrf"] = csrf;
  if (origin) headers.origin = origin;
  if (referer) headers.referer = referer;
  return {
    headers,
    method,
    socket: {
      encrypted: secure,
      remoteAddress
    },
    url
  };
}

function cookieMap(setCookies = []) {
  return Object.fromEntries(setCookies.map((cookie) => {
    const [name, value = ""] = String(cookie).split(";", 1)[0].split("=");
    return [decodeURIComponent(name), decodeURIComponent(value)];
  }));
}

function authCookieHeader(loginResult) {
  const cookies = cookieMap(loginResult.cookies);
  return [
    `${CONSOLE_SESSION_COOKIE}=${encodeURIComponent(cookies[CONSOLE_SESSION_COOKIE])}`,
    `${CONSOLE_CSRF_COOKIE}=${encodeURIComponent(cookies[CONSOLE_CSRF_COOKIE])}`
  ].join("; ");
}

describe("console auth extra branches", () => {
  it("bootstraps the owner, logs in, rotates and logs out sessions", async () => {
    await withTempAuth(async (auth) => {
      expect(auth.hasUsers()).toBe(false);
      expect(auth.getSummary().enabled).toBe(false);

      const initial = await auth.ensureInitialOwner();
      expect(initial).toMatchObject({
        created: true,
        username: "owner"
      });
      await expect(auth.ensureInitialOwner()).resolves.toEqual({ created: false });
      expect(auth.hasUsers()).toBe(true);

      await expect(auth.login({
        username: "owner",
        password: "wrong-password"
      }, makeRequest())).rejects.toThrow("用户名或密码错误。");

      const loginResult = await auth.login({
        username: "OWNER",
        password: initial.password
      }, makeRequest({ secure: true }));
      expect(loginResult.session.user).toMatchObject({
        username: "owner",
        roleId: "owner",
        enabled: true
      });
      expect(loginResult.csrfToken).toMatch(/^csrf_/);
      expect(loginResult.cookies[0]).toContain("HttpOnly");
      expect(loginResult.cookies[0]).toContain("Secure");

      const cookie = authCookieHeader(loginResult);
      const summary = auth.getSummary(makeRequest({ cookie }));
      expect(summary.session).toMatchObject({
        authenticated: true,
        csrfToken: loginResult.csrfToken
      });
      expect(auth.listSessions()).toHaveLength(1);

      const rotated = auth.rotateSession(makeRequest({ cookie }));
      expect(rotated).toMatchObject({ ok: true });
      expect(rotated.csrfToken).not.toBe(loginResult.csrfToken);
      expect(auth.listSessions()).toHaveLength(1);

      const oldSession = auth.getSessionFromRequest(makeRequest({ cookie }));
      expect(oldSession).toBeNull();

      const logout = auth.logout(makeRequest({ cookie: authCookieHeader(rotated) }));
      expect(logout).toMatchObject({ ok: true });
      expect(logout.cookies.join("\n")).toContain("Max-Age=0");
      expect(auth.listSessions()).toHaveLength(0);
      expect(auth.rotateSession(makeRequest({ cookie: authCookieHeader(rotated) }))).toMatchObject({
        ok: false,
        status: 401
      });
    });
  });

  it("creates, updates, disables and revokes user sessions", async () => {
    await withTempAuth(async (auth) => {
      await auth.ensureInitialOwner();
      await expect(auth.createUser({
        username: "x",
        password: "long-enough-password"
      })).rejects.toThrow("用户名需为 3-80 位");

      const user = await auth.createUser({
        username: "Operator.User",
        displayName: "Operator",
        password: "operator-password",
        roleId: "operator",
        tenantId: "tenant:one",
        teamIds: "alpha,beta,alpha",
        allowedWorkspaceIds: ["ws-1", "ws-2", "ws-1"],
        allowedDataClasses: ["public"],
        allowedEgress: ["https://example.test"],
        attributes: { region: "cn" }
      });
      expect(user).toMatchObject({
        username: "operator.user",
        roleId: "operator",
        tenantId: "tenant:one",
        teamIds: ["alpha", "beta"],
        allowedWorkspaceIds: ["ws-1", "ws-2"],
        attributes: { region: "cn" }
      });

      const loginResult = await auth.login({
        username: "operator.user",
        password: "operator-password"
      }, makeRequest());
      expect(auth.listSessions()).toHaveLength(1);

      const updated = await auth.updateUser(user.userId, {
        displayName: "Updated Operator",
        roleId: "viewer",
        enabled: false,
        password: "new-operator-password",
        tenantId: "tenant.two",
        allowedEgress: "https://a.test, https://b.test",
        attributes: { level: 2 }
      });
      expect(updated).toMatchObject({
        displayName: "Updated Operator",
        roleId: "viewer",
        enabled: false,
        tenantId: "tenant.two",
        allowedEgress: ["https://a.test", "https://b.test"],
        attributes: { level: 2 }
      });
      expect(auth.getSessionFromRequest(makeRequest({ cookie: authCookieHeader(loginResult) }))).toBeNull();
      expect(auth.listSessions()).toHaveLength(0);

      await expect(auth.updateUser(user.userId, { tenantId: "bad tenant!" })).rejects.toThrow("tenantId 只能包含");
      expect(await auth.updateUser("missing-user", { displayName: "Nobody" })).toBeNull();
      expect(auth.listUsers().map((item) => item.username)).toContain("operator.user");
      expect(auth.revokeSession("missing-session")).toEqual({ ok: false });
    });
  });

  it("authorizes public, authenticated, denied and CSRF-guarded operations", async () => {
    await withTempAuth(async (auth) => {
      const publicBeforeSetup = auth.authorizeOperation({
        request: makeRequest(),
        operation: { id: "public.status", public: true },
        method: "GET",
        url: new URL("http://console.local/api/status")
      });
      expect(publicBeforeSetup).toMatchObject({ ok: true, setupMode: true });

      const initial = await auth.ensureInitialOwner();
      const viewer = await auth.createUser({
        username: "viewer",
        password: "viewer-password",
        roleId: "viewer"
      });
      expect(viewer.scopes).toContain("console:read");
      const loginResult = await auth.login({
        username: "viewer",
        password: "viewer-password"
      }, makeRequest());
      const cookie = authCookieHeader(loginResult);

      expect(auth.authorizeOperation({
        request: makeRequest(),
        operation: { id: "private.read" },
        method: "GET",
        url: new URL("http://console.local/api/private")
      })).toMatchObject({
        ok: false,
        status: 401
      });

      expect(auth.authorizeOperation({
        request: makeRequest({ cookie }),
        operation: { id: "private.read", requiredScopes: ["console:read"] },
        method: "GET",
        url: new URL("http://console.local/api/private")
      })).toMatchObject({ ok: true });

      expect(auth.authorizeOperation({
        request: makeRequest({ cookie }),
        operation: { id: "admin.write", requiredScopes: ["auth:admin"] },
        method: "GET",
        url: new URL("http://console.local/api/admin")
      })).toMatchObject({
        ok: false,
        status: 403
      });

      expect(auth.authorizeOperation({
        request: makeRequest({ cookie, method: "POST", origin: "http://evil.test" }),
        operation: { id: "private.write", requiredScopes: ["console:read"] },
        method: "POST",
        url: new URL("http://console.local/api/private")
      })).toMatchObject({
        ok: false,
        status: 403,
        error: "请求来源校验失败。"
      });

      expect(auth.authorizeOperation({
        request: makeRequest({ cookie, method: "POST", origin: "http://console.local" }),
        operation: { id: "private.write", requiredScopes: ["console:read"] },
        method: "POST",
        url: new URL("http://console.local/api/private")
      })).toMatchObject({
        ok: false,
        status: 403,
        error: "CSRF 校验失败。"
      });

      expect(auth.authorizeOperation({
        request: makeRequest({
          cookie,
          csrf: loginResult.csrfToken,
          method: "POST",
          origin: "http://console.local"
        }),
        operation: { id: "private.write", requiredScopes: ["console:read"] },
        method: "POST",
        url: new URL("http://console.local/api/private")
      })).toMatchObject({ ok: true });

      const ownerLogin = await auth.login({
        username: "owner",
        password: initial.password
      }, makeRequest());
      expect(auth.authorizeOperation({
        request: makeRequest({
          cookie: authCookieHeader(ownerLogin),
          method: "POST",
          origin: "http://console.local"
        }),
        operation: { id: "admin.skip-csrf", requiredScopes: ["auth:admin"], skipCsrf: true },
        method: "POST",
        url: new URL("http://console.local/api/admin")
      })).toMatchObject({ ok: true });
    });
  });

  it("persists OIDC config and audit filters", async () => {
    await withTempAuth(async (auth) => {
      const initial = await auth.ensureInitialOwner();
      const loginResult = await auth.login({
        username: "owner",
        password: initial.password
      }, makeRequest());
      const user = loginResult.session.user;

      expect(auth.getOidcConfig()).toMatchObject({
        enabled: false,
        clientSecretConfigured: false,
        allowedDomains: []
      });
      const oidc = auth.setOidcConfig({
        enabled: true,
        issuer: "https://issuer.example.test",
        clientId: "client-1",
        clientSecret: "secret-1",
        redirectUri: "https://console.local/callback",
        allowedDomains: ["example.test"],
        roleMapping: { "example.test": "viewer" }
      });
      expect(oidc).toMatchObject({
        enabled: true,
        issuer: "https://issuer.example.test",
        clientId: "client-1",
        clientSecretConfigured: true,
        allowedDomains: ["example.test"],
        roleMapping: { "example.test": "viewer" }
      });
      expect(auth.setOidcConfig({ clientId: "client-2" }).clientSecretConfigured).toBe(true);

      auth.audit({
        user,
        operationId: "auth.audit.test",
        action: "authorize",
        method: "POST",
        path: "/api/audit",
        status: "denied",
        target: { scope: "auth:admin" },
        error: "x".repeat(1200)
      });
      const auditItems = auth.listAudit({ status: "denied", userId: user.userId });
      expect(auditItems).toHaveLength(1);
      expect(auditItems[0]).toMatchObject({
        username: "owner",
        operationId: "auth.audit.test",
        status: "denied",
        target: { scope: "auth:admin" }
      });
      expect(auditItems[0].error).toHaveLength(1000);
      expect(auth.listAudit({ limit: 0 }).length).toBeGreaterThanOrEqual(1);
      expect(auth.roleList().map((role) => role.roleId)).toContain("owner");
      await expect(auth.bootstrapOwner()).rejects.toThrow("旧初始化接口已停用");
    });
  });
});
