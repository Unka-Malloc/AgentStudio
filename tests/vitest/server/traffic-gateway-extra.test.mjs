import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
  DEFAULT_GATEWAY_ADAPTER,
  DEFAULT_GATEWAY_BASE_URL,
  DEFAULT_DIRECT_BASE_URL,
  DEFAULT_GATEWAY_ROUTES,
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_STREAM_TIMEOUT,
  getDefaultGatewayRuntimeCacheRoot,
  getGatewayAdapter,
  listGatewayAdapters,
  normalizeGatewayIngressProfile,
  registerGatewayAdapter,
  renderCaddyConfig,
  renderGatewayConfig,
  renderNginxConfig,
  resolveGatewayRuntimePlan,
  validateGatewayIngressPlan
} from "../../../server/platform/specialized/capabilities/agent-ingress/traffic-gateway/index.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("traffic gateway registry and normalization", () => {
  it("exposes the built-in adapters, accepts aliases, and rejects unknown adapters", () => {
    const adapters = listGatewayAdapters();
    expect(adapters.map((adapter) => adapter.adapterId)).toEqual(["caddy", "nginx"]);
    expect(adapters[0]).toMatchObject({
      adapterId: "caddy",
      label: "Caddy",
      fileName: "Caddyfile",
      mediaType: "text/caddyfile"
    });

    expect(getGatewayAdapter("CaddyFile").adapterId).toBe("caddy");
    expect(getGatewayAdapter("nginx.conf").adapterId).toBe("nginx");
    expect(getGatewayAdapter().adapterId).toBe(DEFAULT_GATEWAY_ADAPTER);
    expect(() => getGatewayAdapter("edge-router")).toThrow("Unsupported gateway adapter: edge-router");
    expect(() => registerGatewayAdapter({ adapterId: "broken" })).toThrow(
      "gateway adapter broken must provide renderConfig(profile)"
    );
  });

  it("normalizes profile inputs, fills defaults, and derives route manifests", () => {
    const profile = normalizeGatewayIngressProfile({
      adapter: "caddyfile",
      directUrl: " https://direct.example.invalid:9443/ ",
      gatewayBaseUrl: " https://gateway.example.invalid:8443/ ",
      listen: {
        host: "0.0.0.0",
        port: "8443",
        server_name: " gateway.example.invalid "
      },
      upstream: [
        "http://upstream-a.example.invalid:7228/",
        ["https://upstream-b.example.invalid/"]
      ],
      routes: [
        {
          id: "health",
          match: "exact",
          path: "/api/healthz",
          class: "health",
          streaming: true,
          sticky: true,
          bodyLimit: "1m"
        },
        {
          routeId: "console",
          path: "/api/console",
          trafficClass: "console",
          bodyLimit: "16m"
        }
      ],
      maxBodySize: "256m",
      streamTimeout: "120s",
      trustedOnlyFrom: ["loopback, private-network", ["mtls"]],
      profileId: "  custom-profile  "
    });

    expect(profile).toMatchObject({
      schemaVersion: 1,
      protocol: AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
      profileId: "custom-profile",
      directMode: {
        required: true,
        baseUrl: "https://direct.example.invalid:9443",
        mustWorkWithoutGateway: true
      },
      gatewayMode: {
        optional: true,
        adapterId: "caddy",
        publicBaseUrl: "https://gateway.example.invalid:8443",
        listen: {
          host: "0.0.0.0",
          port: 8443,
          serverName: "gateway.example.invalid",
          address: ":8443"
        },
        limits: {
          maxBodySize: "256m",
          streamTimeout: "120s"
        }
      },
      trustedHeaderPolicy: {
        trustedOnlyFrom: ["loopback", "private-network", "mtls"],
        directModeStripsGatewayOnlyHeaders: true
      }
    });
    expect(profile.gatewayMode.upstreams).toEqual([
      {
        id: "pact-upstream-1",
        url: "http://upstream-a.example.invalid:7228",
        protocol: "http",
        host: "upstream-a.example.invalid",
        port: "7228",
        authority: "upstream-a.example.invalid:7228"
      },
      {
        id: "pact-upstream-2",
        url: "https://upstream-b.example.invalid",
        protocol: "https",
        host: "upstream-b.example.invalid",
        port: "443",
        authority: "upstream-b.example.invalid:443"
      }
    ]);
    expect(profile.routes).toEqual([
      expect.objectContaining({
        routeId: "health",
        match: "exact",
        path: "/api/healthz",
        trafficClass: "health",
        streaming: true,
        sticky: true,
        bodyLimit: "1m"
      }),
      expect.objectContaining({
        routeId: "console",
        match: "prefix",
        path: "/api/console",
        trafficClass: "console",
        streaming: false,
        sticky: false,
        bodyLimit: "16m"
      }),
      expect.objectContaining({
        routeId: "pact-http",
        path: "/",
        trafficClass: "default"
      })
    ]);
    expect(profile.routeManifest).toMatchObject({
      schemaVersion: 1,
      protocol: AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
      adapterId: "caddy",
      publicBaseUrl: "https://gateway.example.invalid:8443",
      directBaseUrl: "https://direct.example.invalid:9443",
      directModeRequired: true,
      routeCount: 3
    });
    expect(profile.routeManifest.routes).toEqual([
      expect.objectContaining({
        routeId: "health",
        directUrl: "https://direct.example.invalid:9443/api/healthz",
        gatewayUrl: "https://gateway.example.invalid:8443/api/healthz"
      }),
      expect.objectContaining({
        routeId: "console",
        directUrl: "https://direct.example.invalid:9443/api/console",
        gatewayUrl: "https://gateway.example.invalid:8443/api/console"
      }),
      expect.objectContaining({
        routeId: "pact-http",
        directUrl: "https://direct.example.invalid:9443",
        gatewayUrl: "https://gateway.example.invalid:8443"
      })
    ]);
  });
});

describe("traffic gateway rendering", () => {
  it("renders caddy and nginx configs from plain and pre-normalized inputs", () => {
    const caddy = renderCaddyConfig({
      directMode: {
        baseUrl: "https://direct.example.invalid:9443"
      },
      gatewayMode: {
        publicBaseUrl: "https://gateway.example.invalid:8443",
        upstreams: [
          { url: "http://upstream-a.example.invalid:7228" },
          { url: "http://upstream-b.example.invalid:7229" }
        ],
        limits: {
          maxBodySize: "64m",
          streamTimeout: "90s"
        },
        listen: {
          host: "127.0.0.1",
          port: 7330
        }
      },
      routes: [
        {
          routeId: "health",
          match: "exact",
          path: "/api/healthz",
          trafficClass: "health",
          streaming: true,
          bodyLimit: "1m"
        },
        {
          routeId: "stream",
          match: "prefix",
          path: "/mcp",
          trafficClass: "mcp",
          streaming: true,
          sticky: true,
          bodyLimit: "16m"
        },
        {
          routeId: "root-stream",
          match: "prefix",
          path: "/",
          trafficClass: "default",
          streaming: true,
          bodyLimit: "16m"
        },
        {
          routeId: "console",
          match: "prefix",
          path: "/api/console",
          trafficClass: "console",
          streaming: false,
          bodyLimit: "16m"
        }
      ]
    });

    expect(caddy).toContain("@pact_streaming path /api/healthz /mcp /mcp/* /");
    expect(caddy).toContain("reverse_proxy @pact_streaming http://upstream-a.example.invalid:7228 http://upstream-b.example.invalid:7229 {");
    expect(caddy).toContain("flush_interval -1");
    expect(caddy).toContain("header_up X-Pact-Gateway caddy");
    expect(caddy).toContain("header_up X-Pact-Gateway-Request-Id {http.request.uuid}");

    const nginx = renderNginxConfig({
      adapterId: "nginx",
      directBaseUrl: "https://direct.example.invalid:9443",
      publicBaseUrl: "https://gateway.example.invalid:8443",
      upstream: "https://upstream-a.example.invalid:7443,https://upstream-b.example.invalid",
      listen: {
        host: "::",
        port: 8443,
        serverName: "gateway.example.invalid"
      },
      routes: [
        {
          routeId: "health",
          match: "exact",
          path: "/api/healthz",
          trafficClass: "health",
          streaming: true,
          bodyLimit: "1m"
        },
        {
          routeId: "console",
          match: "prefix",
          path: "/api/console",
          trafficClass: "console",
          streaming: false,
          bodyLimit: "16m"
        }
      ]
    });

    expect(nginx).toContain("listen 8443;");
    expect(nginx).toContain("server_name gateway.example.invalid;");
    expect(nginx).toContain("server upstream-a.example.invalid:7443;");
    expect(nginx).toContain("server upstream-b.example.invalid:443;");
    expect(nginx).toContain("location = /api/healthz {");
    expect(nginx).toContain("location ^~ /api/console {");
    expect(nginx).toContain("proxy_buffering off;");
    expect(nginx).toContain("proxy_request_buffering off;");
    expect(nginx).toContain("proxy_set_header X-Pact-Gateway nginx;");
  });

  it("registers and renders a custom adapter", () => {
    const customAdapter = registerGatewayAdapter({
      adapterId: "example-edge",
      label: "Example Edge",
      fileName: "example-edge.conf",
      mediaType: "text/example-edge",
      renderConfig(profile) {
        return JSON.stringify({
          adapterId: "example-edge",
          routeCount: profile.routes.length,
          directBaseUrl: profile.directMode.baseUrl
        });
      }
    });

    expect(customAdapter).toMatchObject({
      adapterId: "example-edge",
      label: "Example Edge",
      fileName: "example-edge.conf",
      mediaType: "text/example-edge"
    });
    expect(listGatewayAdapters().map((adapter) => adapter.adapterId)).toEqual(
      expect.arrayContaining(["caddy", "nginx", "example-edge"])
    );

    const rendered = renderGatewayConfig({
      adapterId: "example-edge",
      directBaseUrl: "https://direct.example.invalid:9443",
      publicBaseUrl: "https://gateway.example.invalid:8443"
    });

    expect(rendered).toMatchObject({
      adapterId: "example-edge",
      fileName: "example-edge.conf",
      mediaType: "text/example-edge"
    });
    expect(rendered.config).toBe(
      JSON.stringify({
        adapterId: "example-edge",
        routeCount: DEFAULT_GATEWAY_ROUTES.length,
        directBaseUrl: "https://direct.example.invalid:9443"
      })
    );
    expect(rendered.routeManifest.directModeRequired).toBe(true);
  });
});

describe("traffic gateway runtime planning and validation", () => {
  it("resolves runtime plans from env, explicit cache roots, and runtime URLs", () => {
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue("/Users/pact");

    expect(getDefaultGatewayRuntimeCacheRoot({ PACT_GATEWAY_RUNTIME_CACHE_DIR: " /tmp/pact-cache " })).toBe(
      path.resolve("/tmp/pact-cache")
    );
    expect(getDefaultGatewayRuntimeCacheRoot({ XDG_CACHE_HOME: " /Users/pact/.cache-home " })).toBe(
      path.join(path.resolve("/Users/pact/.cache-home"), "pact", "gateway-ingress")
    );
    expect(getDefaultGatewayRuntimeCacheRoot({})).toBe(
      path.join("/Users/pact/.cache", "pact", "gateway-ingress")
    );
    expect(homedirSpy).toHaveBeenCalled();

    const plan = resolveGatewayRuntimePlan(
      {
        adapter: "NGINX.CONF",
        platform: "linux-arm64",
        cacheRoot: "/tmp/pact/.cache/gateway-runtime",
        runtimeBinary: " /opt/nginx/bin/nginx ",
        runtimeUrl: " https://downloads.example.invalid/nginx.tar.gz "
      },
      {
        PACT_NGINX_BINARY: "/env/ignored",
        PACT_GATEWAY_RUNTIME_BINARY: "/env/runtime-binary",
        PACT_NGINX_RUNTIME_URL: "https://env.example.invalid/nginx.tar.gz",
        PACT_GATEWAY_RUNTIME_URL: "https://env.example.invalid/runtime.tar.gz"
      }
    );

    expect(plan).toMatchObject({
      schemaVersion: 1,
      protocol: AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
      adapterId: "nginx",
      platform: "linux-arm64",
      cacheRoot: "/tmp/pact/.cache/gateway-runtime",
      runtimeRoot: "/tmp/pact/.cache/gateway-runtime/runtimes/nginx/linux-arm64",
      binDir: "/tmp/pact/.cache/gateway-runtime/runtimes/nginx/linux-arm64/bin",
      cachedExecutablePath: "/tmp/pact/.cache/gateway-runtime/runtimes/nginx/linux-arm64/bin/nginx",
      executableName: "nginx",
      configuredBinary: "/opt/nginx/bin/nginx",
      runtimeUrl: "https://downloads.example.invalid/nginx.tar.gz",
      sourcePolicy: "configured-binary -> local-cache -> PATH -> runtime-url",
      cacheIsLocal: true
    });
  });

  it("validates the gateway contract and reports missing route and policy failures", () => {
    const report = validateGatewayIngressPlan({
      schemaVersion: 1,
      protocol: AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
      adapterId: "caddy",
      directMode: {
        required: false,
        baseUrl: DEFAULT_DIRECT_BASE_URL,
        mustWorkWithoutGateway: true
      },
      gatewayMode: {
        optional: false,
        adapterId: "caddy",
        publicBaseUrl: DEFAULT_GATEWAY_BASE_URL,
        listen: {
          host: "127.0.0.1",
          port: 7330,
          serverName: "gateway.example.invalid"
        },
        upstreams: [
          {
            id: "pact-upstream-1",
            url: DEFAULT_DIRECT_BASE_URL,
            protocol: "http",
            host: "127.0.0.1",
            port: "7228",
            authority: "127.0.0.1:7228"
          }
        ],
        limits: {
          maxBodySize: DEFAULT_MAX_BODY_SIZE,
          streamTimeout: DEFAULT_STREAM_TIMEOUT
        }
      },
      trustedHeaderPolicy: {
        trustedOnlyFrom: ["loopback"],
        gatewayHeaders: ["X-Pact-Gateway"],
        directModeStripsGatewayOnlyHeaders: false
      },
      routes: [
        {
          routeId: "health",
          match: "exact",
          path: "/api/healthz",
          trafficClass: "health",
          streaming: false,
          bodyLimit: "1m"
        }
      ]
    });

    expect(report.ok).toBe(false);
    expect(report.adapterId).toBe("caddy");
    expect(report.routeCount).toBe(2);
    expect(report.failures).toEqual([
      "missing gateway route /mcp",
      "missing gateway route /api/mcp",
      "missing gateway route /api/tool-management/v1",
      "missing gateway route /api/agent-workspaces",
      "missing gateway route /api/client-runtime",
      "missing gateway route /api/upload-sessions"
    ]);
    expect(report.directModeRequired).toBe(true);
    expect(report.gatewayOptional).toBe(true);
  });
});
