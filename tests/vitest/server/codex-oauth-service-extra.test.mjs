import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

const CODEX_DEVICE_URL = "https://auth.openai.com/codex/device";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const SERVICE_PATH = "../../../server/platform/common/security/auth/codex-oauth-service.mjs";
const ENV_KEYS = ["CODEX_HOME", "HOME"];

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: readFileMock
  },
  readFile: readFileMock
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

function base64UrlJson(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function jwtWithPayload(payload) {
  return `header.${base64UrlJson(payload)}.signature`;
}

function createSpawnProcess({
  stdoutChunks = [],
  stderrChunks = [],
  error = null,
  closeCode
} = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const originalStdoutOn = child.stdout.on.bind(child.stdout);
  child.stdout.on = (event, listener) => {
    const result = originalStdoutOn(event, listener);
    if (event === "data") {
      for (const chunk of stdoutChunks) {
        listener(Buffer.from(String(chunk), "utf8"));
      }
    }
    return result;
  };

  const originalStderrOn = child.stderr.on.bind(child.stderr);
  child.stderr.on = (event, listener) => {
    const result = originalStderrOn(event, listener);
    if (event === "data") {
      for (const chunk of stderrChunks) {
        listener(Buffer.from(String(chunk), "utf8"));
      }
    }
    return result;
  };

  const originalChildOn = child.on.bind(child);
  child.on = (event, listener) => {
    const result = originalChildOn(event, listener);
    if (event === "error" && error) {
      listener(error);
    }
    if (event === "close" && closeCode !== undefined) {
      listener(closeCode);
    }
    return result;
  };

  return child;
}

let service;
const envBackup = new Map();

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    envBackup.set(key, process.env[key]);
    delete process.env[key];
  }
  readFileMock.mockReset();
  spawnMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  service = await import(SERVICE_PATH);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of envBackup.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envBackup.clear();
});

describe("codex oauth service extra coverage", () => {
  it("returns an empty codex home when no env vars are configured", async () => {
    const status = await service.getCodexOAuthStatus();

    expect(status).toMatchObject({
      configured: false,
      valid: false,
      codexHome: "",
      authPath: "",
      reason: "CODEX_HOME 未配置。"
    });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("uses HOME fallback for auth path and reports unreadable auth files", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockRejectedValueOnce(new Error("ENOENT"));

    const status = await service.getCodexOAuthStatus();

    expect(status).toMatchObject({
      configured: false,
      valid: false,
      codexHome: "/home/unit/.codex",
      authPath: "/home/unit/.codex/auth.json",
      reason: "未找到 Codex OAuth 登录信息。"
    });
  });

  it("recognizes CODEX_HOME precedence and decodes valid chatgpt tokens", async () => {
    process.env.HOME = "/home/unit";
    process.env.CODEX_HOME = "/override/codex";
    const exp = Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000);
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        auth_mode: "chatgpt",
        last_refresh: "2026-06-04T00:00:00.000Z",
        tokens: {
          access_token: jwtWithPayload({ exp }),
          account_id: "acct-123",
          id_token: jwtWithPayload({ email: "ada@example.test" }),
          refresh_token: "refresh-token"
        }
      })
    );

    const status = await service.getCodexOAuthStatus();

    expect(status).toMatchObject({
      configured: true,
      valid: true,
      authMode: "chatgpt",
      accountIdConfigured: true,
      accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
      lastRefresh: "2026-06-04T00:00:00.000Z",
      email: "ada@example.test",
      hasRefreshToken: true,
      codexHome: "/override/codex",
      authPath: "/override/codex/auth.json",
      reason: "",
      login: null
    });
  });

  it("treats malformed or expired access tokens as invalid", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: "not-a-jwt",
          account_id: "acct-123",
          id_token: "bad.id.token",
          refresh_token: "refresh-token"
        }
      })
    );

    const status = await service.getCodexOAuthStatus();

    expect(status).toMatchObject({
      configured: true,
      valid: false,
      accountIdConfigured: true,
      accessTokenExpiresAt: "",
      email: "",
      hasRefreshToken: true,
      reason: "ChatGPT OAuth 已过期或即将过期。"
    });
  });

  it("starts device login, strips ansi codes, and keeps an active login available for reuse", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockResolvedValue(
      JSON.stringify({
        auth_mode: "manual",
        tokens: {
          access_token: jwtWithPayload({ exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) }),
          account_id: "acct-123"
        }
      })
    );
    spawnMock.mockReturnValue(
      createSpawnProcess({
        stdoutChunks: [
          "\u001b[32mhttps://auth.openai.com/codex/device\u001b[0m",
          " one-time code ABCD-EFGHI "
        ],
        closeCode: undefined
      })
    );

    const first = await service.startCodexDeviceLogin();
    const status = await service.getCodexOAuthStatus();
    const second = await service.startCodexDeviceLogin();

    expect(first).toMatchObject({
      started: true,
      alreadyValid: false,
      authorizationUrl: CODEX_DEVICE_URL,
      userCode: "ABCD-EFGHI"
    });
    expect(status.login).toMatchObject({
      active: true,
      authorizationUrl: CODEX_DEVICE_URL,
      userCode: "ABCD-EFGHI",
      message: "请在 Codex 验证页输入一次性代码。",
      error: ""
    });
    expect(second).toMatchObject({
      started: false,
      alreadyValid: false,
      authorizationUrl: CODEX_DEVICE_URL,
      userCode: "ABCD-EFGHI"
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("returns already-valid when an existing auth file is fresh", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockResolvedValue(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwtWithPayload({ exp: Math.floor((Date.now() + 90 * 60 * 1000) / 1000) }),
          account_id: "acct-123",
          id_token: jwtWithPayload({ email: "valid@example.test" })
        }
      })
    );

    const result = await service.startCodexDeviceLogin();

    expect(result).toMatchObject({
      started: false,
      alreadyValid: true,
      authorizationUrl: "",
      userCode: ""
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("surfaces spawn errors as login failures", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockResolvedValue(
      JSON.stringify({
        auth_mode: "manual",
        tokens: {
          access_token: jwtWithPayload({ exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) }),
          account_id: "acct-123"
        }
      })
    );
    spawnMock.mockReturnValue(
      createSpawnProcess({
        error: new Error("spawn failed"),
        closeCode: 17
      })
    );

    const result = await service.startCodexDeviceLogin();
    const status = await service.getCodexOAuthStatus();

    expect(result).toMatchObject({
      started: true,
      alreadyValid: false,
      authorizationUrl: CODEX_DEVICE_URL,
      userCode: ""
    });
    expect(status.login).toMatchObject({
      active: false,
      error: "spawn failed"
    });
  });

  it("rejects codex json calls when oauth is missing", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        auth_mode: "manual",
        tokens: {
          access_token: "",
          account_id: ""
        }
      })
    );

    await expect(
      service.callCodexChatGptJson({
        model: "gpt-5-mini",
        prompt: "hello"
      })
    ).rejects.toMatchObject({
      code: "CODEX_OAUTH_REQUIRED",
      message: "ChatGPT OAuth 未配置或已过期。"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the codex responses request and parses fenced json from streamed deltas", async () => {
    process.env.HOME = "/home/unit";
    const accessToken = jwtWithPayload({ exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) });
    readFileMock.mockResolvedValue(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: accessToken,
          account_id: "acct-123"
        }
      })
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        `data: ${JSON.stringify({
          delta: "```json\n{\"foo\":\"bar\"}\n```"
        })}\n`
    });

    const result = await service.callCodexChatGptJson({
      model: "gpt-5-mini",
      prompt: "hello"
    });

    expect(result).toEqual({ foo: "bar" });
    expect(fetchMock).toHaveBeenCalledWith(
      CODEX_RESPONSES_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "chatgpt-account-id": "acct-123"
        })
      })
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody).toMatchObject({
      model: "gpt-5-mini",
      store: false,
      stream: true,
      instructions: "你是客户端知识图谱的轻量语义增强器。只返回 JSON，不要 Markdown。",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "hello"
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    });
  });

  it("falls back to completed response content when the sse stream has no deltas", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockResolvedValue(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwtWithPayload({ exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) }),
          account_id: "acct-123"
        }
      })
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            output: [
              {
                content: [
                  {
                    text: "{\"answer\":42}"
                  }
                ]
              }
            ]
          }
        })}\n`
    });

    const result = await service.callCodexChatGptJson({
      model: "gpt-5-mini",
      prompt: "hello"
    });

    expect(result).toEqual({ answer: 42 });
  });

  it("surfaces upstream codex response errors with and without body text", async () => {
    process.env.HOME = "/home/unit";
    readFileMock.mockResolvedValue(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwtWithPayload({ exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) }),
          account_id: "acct-123"
        }
      })
    );
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => ""
    });
    await expect(
      service.callCodexChatGptJson({
        model: "gpt-5-mini",
        prompt: "hello"
      })
    ).rejects.toThrow("Codex Responses 请求失败：502");

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "upstream said no"
    });
    await expect(
      service.callCodexChatGptJson({
        model: "gpt-5-mini",
        prompt: "hello"
      })
    ).rejects.toThrow("upstream said no");
  });
});
