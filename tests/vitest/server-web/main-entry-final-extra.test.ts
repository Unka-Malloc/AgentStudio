// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("server-web main entry final extra coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("translate");
    document.documentElement.className = "";
    document.body.removeAttribute("translate");
    document.body.className = "";
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("sets translation guards and mounts the console app with Element Plus components", async () => {
    const app = {
      use: vi.fn(),
      component: vi.fn(),
      mount: vi.fn()
    };
    app.use.mockReturnValue(app);
    app.component.mockReturnValue(app);
    app.mount.mockReturnValue(app);
    const createApp = vi.fn(() => app);
    const router = { name: "router" };
    const ServerConsoleApp = { name: "ServerConsoleApp" };

    vi.doMock("vue", async (importOriginal) => ({
      ...(await importOriginal<typeof import("vue")>()),
      createApp,
    }));
    vi.doMock("../../../server-web/router/index", () => ({ router }));
    vi.doMock("../../../server-web/ServerConsoleApp.vue", () => ({ default: ServerConsoleApp }));
    vi.doMock("element-plus/es/components/button/index.mjs", () => ({ ElButton: { name: "ElButton" } }));
    vi.doMock("element-plus/es/components/select/index.mjs", () => ({
      ElOption: { name: "ElOption" },
      ElSelect: { name: "ElSelect" }
    }));
    vi.doMock("element-plus/es/components/table/index.mjs", () => ({
      ElTable: { name: "ElTable" },
      ElTableColumn: { name: "ElTableColumn" }
    }));
    vi.doMock("element-plus/es/components/button/style/css", () => ({}));
    vi.doMock("element-plus/es/components/select/style/css", () => ({}));
    vi.doMock("element-plus/es/components/table/style/css", () => ({}));
    vi.doMock("element-plus/es/components/table-column/style/css", () => ({}));

    await import("../../../server-web/main");

    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.getAttribute("translate")).toBe("no");
    expect(document.documentElement.classList.contains("notranslate")).toBe(true);
    expect(document.body.getAttribute("translate")).toBe("no");
    expect(document.body.classList.contains("notranslate")).toBe(true);
    expect(createApp).toHaveBeenCalledWith(ServerConsoleApp);
    expect(app.use).toHaveBeenCalledWith(router);
    expect(app.component.mock.calls.map((call) => call[0])).toEqual([
      "ElButton",
      "ElSelect",
      "ElOption",
      "ElTable",
      "ElTableColumn"
    ]);
    expect(app.mount).toHaveBeenCalledWith("#root");
  });

  it("uses the stored console language before mounting", async () => {
    window.localStorage.setItem("pact-language", "en");
    const app = {
      use: vi.fn(),
      component: vi.fn(),
      mount: vi.fn()
    };
    app.use.mockReturnValue(app);
    app.component.mockReturnValue(app);
    app.mount.mockReturnValue(app);
    const createApp = vi.fn(() => app);
    const router = { name: "router" };
    const ServerConsoleApp = { name: "ServerConsoleApp" };

    vi.doMock("vue", async (importOriginal) => ({
      ...(await importOriginal<typeof import("vue")>()),
      createApp,
    }));
    vi.doMock("../../../server-web/router/index", () => ({ router }));
    vi.doMock("../../../server-web/ServerConsoleApp.vue", () => ({ default: ServerConsoleApp }));
    vi.doMock("element-plus/es/components/button/index.mjs", () => ({ ElButton: { name: "ElButton" } }));
    vi.doMock("element-plus/es/components/select/index.mjs", () => ({
      ElOption: { name: "ElOption" },
      ElSelect: { name: "ElSelect" }
    }));
    vi.doMock("element-plus/es/components/table/index.mjs", () => ({
      ElTable: { name: "ElTable" },
      ElTableColumn: { name: "ElTableColumn" }
    }));
    vi.doMock("element-plus/es/components/button/style/css", () => ({}));
    vi.doMock("element-plus/es/components/select/style/css", () => ({}));
    vi.doMock("element-plus/es/components/table/style/css", () => ({}));
    vi.doMock("element-plus/es/components/table-column/style/css", () => ({}));

    await import("../../../server-web/main");

    expect(document.documentElement.lang).toBe("en");
  });
});
