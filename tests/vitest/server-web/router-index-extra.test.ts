// @vitest-environment jsdom
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { router } from "../../../server-web/router";

function routeByPath(path: string) {
  return router.getRoutes().find((route) => route.path === path);
}

function callBeforeEnter(path: string, tab: string) {
  const route = routeByPath(path);
  const guard = route?.beforeEnter;
  if (Array.isArray(guard)) {
    return guard[0]?.({ params: { tab } } as any, {} as any, () => undefined);
  }
  return guard?.({ params: { tab } } as any, {} as any, () => undefined);
}

async function loadRouteComponent(path: string) {
  const route = routeByPath(path) as any;
  const loader = route?.components?.default || route?.component;
  if (typeof loader === "function") {
    return loader();
  }
  expect(loader).toBeTruthy();
  return loader;
}

describe("server-web router instance", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  it("registers canonical routes with expected metadata and redirects", () => {
    expect(router.options.history).toBeTruthy();
    expect(routeByPath("/")?.meta).toMatchObject({ viewId: "dashboard" });
    expect(routeByPath("/feed")?.meta).toMatchObject({ viewId: "feed" });
    expect(routeByPath("/approval")?.meta).toMatchObject({ viewId: "approval" });
    expect(routeByPath("/workspaces")?.meta).toMatchObject({ viewId: "workspaces" });
    expect(routeByPath("/external-services")?.redirect).toBe("/external-services/list");
    expect(routeByPath("/knowledge")?.redirect).toBe("/knowledge/management");
    expect(routeByPath("/debug")?.redirect).toBe("/debug/knowledgeRecall");
    expect(routeByPath("/admin/storage")?.meta).toMatchObject({ viewId: "admin", adminView: "storage" });
    expect(routeByPath("/admin/ops-monitor")?.meta).toMatchObject({ viewId: "admin", adminView: "opsMonitor" });
    expect(routeByPath("/admin/runtime-downloads")?.meta).toMatchObject({
      viewId: "admin",
      adminView: "runtimeDownloads",
    });
    expect(routeByPath("/admin/tool-list")?.meta).toMatchObject({ viewId: "admin", adminView: "toolList" });
    expect(routeByPath("/admin/agent-config")?.meta).toMatchObject({ viewId: "admin", adminView: "agentConfig" });
    expect(routeByPath("/:pathMatch(.*)*")?.redirect).toBe("/");
    expect(routeByPath("/admin")?.redirect).toBe("/admin/storage");
    expect(routeByPath("/admin/tools")?.redirect).toBe("/admin/tool-list");
    expect(routeByPath("/intelligence")?.redirect).toBe("/");
    expect(router.options.scrollBehavior?.({} as any, {} as any, {} as any)).toEqual({ top: 0 });
  });

  it("keeps valid sub-tabs and redirects invalid sub-tabs in route guards", () => {
    expect(callBeforeEnter("/external-services/:tab", "list")).toBe(true);
    expect(callBeforeEnter("/external-services/:tab", "unknown")).toBe("/external-services/list");

    expect(callBeforeEnter("/knowledge/:tab", "management")).toBe(true);
    expect(callBeforeEnter("/knowledge/:tab", "wordCloud")).toBe(true);
    expect(callBeforeEnter("/knowledge/:tab", "distillation")).toBe(true);
    expect(callBeforeEnter("/knowledge/:tab", "missing")).toBe("/knowledge/management");

    expect(callBeforeEnter("/debug/:tab", "knowledgeRecall")).toBe(true);
    expect(callBeforeEnter("/debug/:tab", "agentRetrieval")).toBe(true);
    expect(callBeforeEnter("/debug/:tab", "knowledgeDistillation")).toBe(true);
    expect(callBeforeEnter("/debug/:tab", "bad")).toBe("/debug/knowledgeRecall");
  });

  it("redirects invalid tabs through global guards during navigation", async () => {
    await router.push("/knowledge/not-a-tab");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/knowledge/management");

    await router.push("/debug/not-a-tab");
    expect(router.currentRoute.value.path).toBe("/debug/knowledgeRecall");

    await router.push("/external-services/not-a-tab");
    expect(router.currentRoute.value.path).toBe("/external-services/list");
  }, 20_000);

  it("loads lazy route components for core and admin views", async () => {
    await expect(loadRouteComponent("/workspaces")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/feed")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/approval")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/sources")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/external-services/:tab")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/debug/:tab")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/storage")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/jobs")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/logs")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/ops-monitor")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/runtime-downloads")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/production-health")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/clients")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/tool-list")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/tool-stats")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/modules")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/agent-permissions")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/agent-config")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/agent-assignment")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/context-management")).resolves.toBeTruthy();
    await expect(loadRouteComponent("/admin/maintenance-agent")).resolves.toBeTruthy();
  }, 20_000);
});
