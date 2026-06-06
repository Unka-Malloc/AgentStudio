// @vitest-environment jsdom
import { ref } from "vue";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createConsoleCodexOAuthController } from "../../../server-web/composables/console-codex-oauth-controller";

const getCodexOAuthStatusMock = vi.hoisted(() => vi.fn());
const startCodexOAuthLoginMock = vi.hoisted(() => vi.fn());
const openBrowserPopupMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/lib/codex-oauth-client", () => ({
  getCodexOAuthStatus: getCodexOAuthStatusMock,
  startCodexOAuthLogin: startCodexOAuthLoginMock,
}));

vi.mock("../../../server-web/lib/browser-window", async () => {
  const actual = await vi.importActual("../../../server-web/lib/browser-window");
  return {
    ...actual,
    openBrowserPopup: openBrowserPopupMock,
  };
});

function createHarness() {
  const error = ref("previous error");
  const setBusy = vi.fn();
  const clearBusy = vi.fn();
  const controller = createConsoleCodexOAuthController({
    clearBusy,
    error,
    setBusy,
  });

  return {
    clearBusy,
    controller,
    error,
    setBusy,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  getCodexOAuthStatusMock.mockReset();
  startCodexOAuthLoginMock.mockReset();
  openBrowserPopupMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("console codex oauth controller extra coverage", () => {
  it("refreshes status and stops polling once the token is valid", async () => {
    getCodexOAuthStatusMock.mockResolvedValue({ valid: true, account: { email: "dev@example.com" } });
    const harness = createHarness();
    harness.controller.startCodexOAuthPolling();

    expect(harness.controller.codexOAuthPollTimer.value).not.toBeNull();

    const status = await harness.controller.refreshCodexOAuthStatus();

    expect(status).toMatchObject({ valid: true });
    expect(harness.controller.codexOAuthStatus.value).toEqual(status);
    expect(harness.controller.codexOAuthLogin.value).toBeNull();
    expect(harness.controller.codexOAuthPollTimer.value).toBeNull();
  });

  it("begins login, opens the authorization popup, starts polling, and clears busy state", async () => {
    startCodexOAuthLoginMock.mockResolvedValue({
      authorizationUrl: "https://auth.example.test/oauth",
      status: { valid: false, deviceCode: "device-1" },
    });
    const harness = createHarness();

    await expect(harness.controller.beginCodexOAuthLogin()).resolves.toBe(false);

    expect(harness.setBusy).toHaveBeenCalledWith("codex-oauth");
    expect(harness.clearBusy).toHaveBeenCalledWith("codex-oauth");
    expect(harness.error.value).toBe("");
    expect(harness.controller.codexOAuthLogin.value).toMatchObject({
      authorizationUrl: "https://auth.example.test/oauth",
    });
    expect(harness.controller.codexOAuthStatus.value).toMatchObject({
      valid: false,
      deviceCode: "device-1",
    });
    expect(openBrowserPopupMock).toHaveBeenCalledWith(
      "https://auth.example.test/oauth",
      "pact-codex-oauth",
    );
    expect(harness.controller.codexOAuthPollTimer.value).not.toBeNull();
  });

  it("reports login failures and clears busy state", async () => {
    startCodexOAuthLoginMock.mockRejectedValue(new Error("oauth offline"));
    const harness = createHarness();

    await expect(harness.controller.beginCodexOAuthLogin()).resolves.toBe(false);

    expect(harness.error.value).toBe("oauth offline");
    expect(harness.clearBusy).toHaveBeenCalledWith("codex-oauth");
    expect(openBrowserPopupMock).not.toHaveBeenCalled();
    expect(harness.controller.codexOAuthPollTimer.value).toBeNull();
  });

  it("ensures ready from status or optionally starts login when invalid", async () => {
    getCodexOAuthStatusMock.mockResolvedValueOnce({ valid: true });
    const validHarness = createHarness();

    await expect(validHarness.controller.ensureCodexOAuthReady(false)).resolves.toBe(true);
    expect(startCodexOAuthLoginMock).not.toHaveBeenCalled();

    getCodexOAuthStatusMock.mockResolvedValueOnce({ valid: false });
    const invalidHarness = createHarness();

    await expect(invalidHarness.controller.ensureCodexOAuthReady(false)).resolves.toBe(false);
    expect(startCodexOAuthLoginMock).not.toHaveBeenCalled();

    getCodexOAuthStatusMock.mockResolvedValueOnce({ valid: false });
    startCodexOAuthLoginMock.mockResolvedValueOnce({
      authorizationUrl: "",
      status: { valid: true },
    });
    const loginHarness = createHarness();

    await expect(loginHarness.controller.ensureCodexOAuthReady(true)).resolves.toBe(true);
    expect(startCodexOAuthLoginMock).toHaveBeenCalledTimes(1);
    expect(openBrowserPopupMock).toHaveBeenCalledWith("", "pact-codex-oauth");
  });

  it("polls status on interval and can be stopped idempotently", async () => {
    getCodexOAuthStatusMock.mockResolvedValue({ valid: false });
    const harness = createHarness();

    harness.controller.startCodexOAuthPolling();
    const firstTimer = harness.controller.codexOAuthPollTimer.value;
    harness.controller.startCodexOAuthPolling();
    expect(harness.controller.codexOAuthPollTimer.value).not.toBe(firstTimer);

    await vi.advanceTimersByTimeAsync(2000);
    expect(getCodexOAuthStatusMock).toHaveBeenCalledTimes(1);

    harness.controller.stopCodexOAuthPolling();
    expect(harness.controller.codexOAuthPollTimer.value).toBeNull();
    harness.controller.stopCodexOAuthPolling();
    expect(harness.controller.codexOAuthPollTimer.value).toBeNull();
  });
});
