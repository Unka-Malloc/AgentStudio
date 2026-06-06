import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  oauthDefaultsForProvider,
  runLocalOAuthAuthorizationCodeFlow,
} from "../../../server/platform/common/security/secrets/oauth-local-flow.mjs";

function requestLocal(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          body,
          statusCode: response.statusCode,
        });
      });
    });
    request.on("error", reject);
  });
}

function createStderrCapture() {
  const lines = [];
  let resolveAuthorizationUrl;
  const authorizationUrl = new Promise((resolve) => {
    resolveAuthorizationUrl = resolve;
  });
  return {
    authorizationUrl,
    lines,
    stream: {
      write(value) {
        const text = String(value);
        lines.push(text);
        const match = text.match(/^oauthAuthorizationUrl=(.+)$/m);
        if (match) {
          resolveAuthorizationUrl(match[1]);
        }
      },
    },
  };
}

async function startFlowAndCallback(options = {}, callback = async ({ authorizeUrl }) => {
  const url = new URL(authorizeUrl);
  await requestLocal(`${url.searchParams.get("redirect_uri")}?state=${url.searchParams.get("state")}&code=code-123`);
}) {
  const stderr = createStderrCapture();
  const flowPromise = runLocalOAuthAuthorizationCodeFlow({
    clientId: "client-a",
    clientSecret: "secret-a",
    open: false,
    provider: "google-drive",
    stderr: stderr.stream,
    timeoutMs: 1000,
    ...options,
  });
  flowPromise.catch(() => {});
  const authorizeUrl = await stderr.authorizationUrl;
  await callback({ authorizeUrl, stderr });
  return await flowPromise;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
  vi.stubGlobal("fetch", vi.fn(async (_url, request) => {
    const body = request.body;
    return new Response(JSON.stringify({
      access_token: "access-token",
      expires_in: 3600,
      id_token: "id-token",
      refresh_token: "refresh-token",
      scope: "drive.file",
      token_type: "Bearer",
      visible: "kept",
    }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("oauth local flow extra coverage", () => {
  it("normalizes provider defaults and option overrides", () => {
    expect(oauthDefaultsForProvider("gdrive")).toMatchObject({
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      provider: "google-drive",
      scope: "https://www.googleapis.com/auth/drive.file",
      tokenClientAuth: "body",
      tokenUrl: "https://oauth2.googleapis.com/token",
    });
    expect(oauthDefaultsForProvider("onedrive", {
      authorizeParams: "prompt=select_account,custom",
      scope: "Files.Read, offline_access",
      tenant: "organizations",
    })).toMatchObject({
      authorizationUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
      authorizeParams: {
        custom: "",
        prompt: "select_account",
      },
      provider: "onedrive",
      scope: "Files.Read offline_access",
      tenant: "organizations",
      tokenUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    });
    expect(oauthDefaultsForProvider("dropbox", {
      authorizeParams: { force_reapprove: true },
      tokenClientAuth: "none",
    })).toMatchObject({
      authorizeParams: {
        force_reapprove: true,
        token_access_type: "offline",
      },
      tokenClientAuth: "none",
    });
    expect(oauthDefaultsForProvider("unknown")).toBeNull();
  });

  it("runs the authorization code callback, exchanges the token, and redacts provider response secrets", async () => {
    const result = await startFlowAndCallback({
      authorizeParams: "login_hint=alice@example.com",
      scope: "drive.file,offline_access",
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "google-drive",
      scope: "drive.file offline_access",
      tokenClientAuth: "body",
      tokenUrl: "https://oauth2.googleapis.com/token",
      oauth: {
        accessToken: "access-token",
        idToken: "id-token",
        refreshToken: "refresh-token",
        scope: "drive.file",
        tokenType: "Bearer",
        providerResponse: {
          access_token: undefined,
          id_token: undefined,
          refresh_token: undefined,
          visible: "kept",
        },
      },
    });
    expect(Date.parse(result.oauth.expiresAt)).toBeGreaterThanOrEqual(Date.parse("2026-06-04T13:00:00.000Z"));
    expect(Date.parse(result.oauth.expiresAt)).toBeLessThan(Date.parse("2026-06-04T13:00:05.000Z"));
    const authorizationUrl = new URL(result.authorizationUrl);
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("client-a");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("login_hint")).toBe("alice@example.com");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        }),
      }),
    );
    const requestBody = globalThis.fetch.mock.calls[0][1].body;
    expect(requestBody.get("grant_type")).toBe("authorization_code");
    expect(requestBody.get("code")).toBe("code-123");
    expect(requestBody.get("client_id")).toBe("client-a");
    expect(requestBody.get("client_secret")).toBe("secret-a");
    expect(requestBody.get("code_verifier")).toBeTruthy();
  });

  it("uses basic client auth and parses raw token responses for dropbox", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("token accepted", {
      status: 200,
    })));

    const result = await startFlowAndCallback({
      provider: "dropbox",
    });

    expect(result).toMatchObject({
      oauth: {
        accessToken: "",
        refreshToken: "",
        tokenType: "Bearer",
        providerResponse: {
          raw: "token accepted",
        },
      },
      provider: "dropbox",
      tokenClientAuth: "basic",
      tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    });
    expect(globalThis.fetch.mock.calls[0][1].headers.authorization).toBe(
      `Basic ${Buffer.from("client-a:secret-a").toString("base64")}`,
    );
    expect(globalThis.fetch.mock.calls[0][1].body.get("client_secret")).toBeNull();
  });

  it("rejects unsupported providers and missing client ids before listening", async () => {
    await expect(runLocalOAuthAuthorizationCodeFlow({
      clientId: "client-a",
      open: false,
      provider: "github",
    })).rejects.toThrow("Provider does not support Pact OAuth redirect flow");

    await expect(runLocalOAuthAuthorizationCodeFlow({
      clientId: "",
      open: false,
      provider: "google-drive",
    })).rejects.toThrow("--client-id is required");
  });

  it("rejects callback errors, state mismatches, and missing codes", async () => {
    await expect(startFlowAndCallback({}, async ({ authorizeUrl }) => {
      const url = new URL(authorizeUrl);
      const redirectUri = url.searchParams.get("redirect_uri");
      const response = await requestLocal(`${redirectUri}?state=${url.searchParams.get("state")}&error=access_denied&error_description=Denied%20by%20user`);
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Pact OAuth Failed");
    })).rejects.toThrow("Denied by user");

    await expect(startFlowAndCallback({}, async ({ authorizeUrl }) => {
      const url = new URL(authorizeUrl);
      const response = await requestLocal(`${url.searchParams.get("redirect_uri")}?state=wrong&code=code-123`);
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Pact OAuth State Mismatch");
    })).rejects.toThrow("OAuth state mismatch.");

    await expect(startFlowAndCallback({}, async ({ authorizeUrl }) => {
      const url = new URL(authorizeUrl);
      const response = await requestLocal(`${url.searchParams.get("redirect_uri")}?state=${url.searchParams.get("state")}`);
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Pact OAuth Missing Code");
    })).rejects.toThrow("OAuth callback did not include code.");
  });

  it("surfaces token exchange failures with parsed error payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "invalid_grant",
      error_description: "bad code",
    }), {
      status: 400,
    })));

    await expect(startFlowAndCallback()).rejects.toMatchObject({
      message: "bad code",
      payload: {
        error: "invalid_grant",
        error_description: "bad code",
      },
      status: 400,
    });
  });
});
