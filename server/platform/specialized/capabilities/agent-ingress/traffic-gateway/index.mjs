import os from "node:os";
import path from "node:path";

export const AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION = "v0.0.1:agent:traffic-gateway-1";

export const DEFAULT_GATEWAY_ADAPTER = "caddy";
export const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:7330";
export const DEFAULT_DIRECT_BASE_URL = "http://127.0.0.1:7228";
export const DEFAULT_MAX_BODY_SIZE = "512m";
export const DEFAULT_STREAM_TIMEOUT = "3600s";

const adapterRegistry = new Map();

export function getDefaultGatewayRuntimeCacheRoot(env = process.env) {
  const explicit = String(env.PACT_GATEWAY_RUNTIME_CACHE_DIR || "").trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const xdgCacheHome = String(env.XDG_CACHE_HOME || "").trim();
  const cacheHome = xdgCacheHome ? path.resolve(xdgCacheHome) : path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "pact", "gateway-ingress");
}

export const DEFAULT_GATEWAY_ROUTES = Object.freeze([
  Object.freeze({
    routeId: "health",
    match: "exact",
    path: "/api/healthz",
    trafficClass: "health",
    streaming: false,
    bodyLimit: "1m"
  }),
  Object.freeze({
    routeId: "mcp-stream",
    match: "prefix",
    path: "/mcp",
    trafficClass: "mcp",
    streaming: true,
    sticky: true,
    bodyLimit: "16m"
  }),
  Object.freeze({
    routeId: "mcp-control",
    match: "prefix",
    path: "/api/mcp",
    trafficClass: "mcp-control",
    streaming: true,
    sticky: true,
    bodyLimit: "16m"
  }),
  Object.freeze({
    routeId: "tool-management",
    match: "prefix",
    path: "/api/tool-management/v1",
    trafficClass: "tool-management",
    streaming: false,
    bodyLimit: "32m"
  }),
  Object.freeze({
    routeId: "agent-workspaces",
    match: "prefix",
    path: "/api/agent-workspaces",
    trafficClass: "workspace",
    streaming: false,
    bodyLimit: "128m"
  }),
  Object.freeze({
    routeId: "client-runtime",
    match: "prefix",
    path: "/api/client-runtime",
    trafficClass: "client-runtime",
    streaming: false,
    bodyLimit: "64m"
  }),
  Object.freeze({
    routeId: "upload-sessions",
    match: "prefix",
    path: "/api/upload-sessions",
    trafficClass: "upload",
    streaming: true,
    bodyLimit: DEFAULT_MAX_BODY_SIZE
  }),
  Object.freeze({
    routeId: "agent-gateway",
    match: "prefix",
    path: "/api/agent-gateway",
    trafficClass: "agent-runtime",
    streaming: true,
    sticky: true,
    bodyLimit: "32m"
  }),
  Object.freeze({
    routeId: "console-api",
    match: "prefix",
    path: "/api/console",
    trafficClass: "console",
    streaming: false,
    bodyLimit: "16m"
  }),
  Object.freeze({
    routeId: "pact-http",
    match: "prefix",
    path: "/",
    trafficClass: "default",
    streaming: false,
    bodyLimit: DEFAULT_MAX_BODY_SIZE
  })
]);

function trimTrailingSlash(value = "") {
  const text = String(value || "").trim();
  return text.length > 1 ? text.replace(/\/+$/, "") : text;
}

function requireUrl(value, label) {
  const normalized = trimTrailingSlash(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be an http(s) URL: ${value}`);
  }
}

function normalizeUrl(value, fallback, label) {
  return requireUrl(value || fallback, label).toString().replace(/\/+$/, "");
}

function normalizeAdapterId(value) {
  const adapterId = String(value || DEFAULT_GATEWAY_ADAPTER).trim().toLowerCase();
  if (!adapterId) {
    return DEFAULT_GATEWAY_ADAPTER;
  }
  if (adapterId === "caddyfile") {
    return "caddy";
  }
  if (adapterId === "nginx.conf") {
    return "nginx";
  }
  return adapterId;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeStringList(item));
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUpstreams(value, directBaseUrl) {
  const rawItems = normalizeStringList(value).length > 0 ? normalizeStringList(value) : [directBaseUrl];
  return rawItems.map((item, index) => {
    const url = normalizeUrl(item, directBaseUrl, `gateway upstream #${index + 1}`);
    const parsed = new URL(url);
    return Object.freeze({
      id: `pact-upstream-${index + 1}`,
      url,
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
      authority: `${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`
    });
  });
}

function normalizeListen(input = {}, publicBaseUrl) {
  const publicUrl = requireUrl(publicBaseUrl, "gateway publicBaseUrl");
  const host = String(input.host || publicUrl.hostname || "127.0.0.1").trim();
  const port = Number(input.port || publicUrl.port || (publicUrl.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`gateway listen port must be 1-65535: ${input.port}`);
  }
  const serverName = String(input.serverName || input.server_name || publicUrl.hostname || "_").trim() || "_";
  return Object.freeze({
    host,
    port,
    serverName,
    address: host === "0.0.0.0" || host === "::" ? `:${port}` : `${host}:${port}`
  });
}

function cloneRoute(route = {}) {
  return Object.freeze({
    routeId: String(route.routeId || route.id || route.path || "").trim(),
    match: route.match === "exact" ? "exact" : "prefix",
    path: String(route.path || "/").trim() || "/",
    trafficClass: String(route.trafficClass || route.class || "default").trim(),
    streaming: route.streaming === true,
    sticky: route.sticky === true,
    bodyLimit: String(route.bodyLimit || DEFAULT_MAX_BODY_SIZE).trim()
  });
}

function normalizeRoutes(routes) {
  const inputRoutes = Array.isArray(routes) && routes.length > 0 ? routes : DEFAULT_GATEWAY_ROUTES;
  const normalized = inputRoutes.map(cloneRoute);
  if (!normalized.some((route) => route.path === "/")) {
    normalized.push(cloneRoute({ routeId: "pact-http", path: "/", trafficClass: "default" }));
  }
  return Object.freeze(normalized);
}

function renderProfileInput(profileInput = {}, adapterId = "") {
  if (profileInput?.directMode && profileInput?.gatewayMode) {
    return {
      adapterId: adapterId || profileInput.gatewayMode.adapterId,
      directBaseUrl: profileInput.directMode.baseUrl,
      publicBaseUrl: profileInput.gatewayMode.publicBaseUrl,
      upstream: (profileInput.gatewayMode.upstreams || []).map((upstream) => upstream.url),
      maxBodySize: profileInput.gatewayMode.limits?.maxBodySize,
      streamTimeout: profileInput.gatewayMode.limits?.streamTimeout,
      listen: profileInput.gatewayMode.listen,
      routes: profileInput.routes
    };
  }
  return { ...profileInput, adapterId: adapterId || profileInput.adapterId };
}

export function buildGatewayRouteManifest(profileInput = {}) {
  const profile = profileInput.schemaVersion ? profileInput : normalizeGatewayIngressProfile(profileInput);
  return Object.freeze({
    schemaVersion: "v0.0.1:schema:definition-1",
    protocol: AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
    adapterId: profile.gatewayMode.adapterId,
    publicBaseUrl: profile.gatewayMode.publicBaseUrl,
    directBaseUrl: profile.directMode.baseUrl,
    directModeRequired: true,
    routeCount: profile.routes.length,
    routes: profile.routes.map((route) =>
      Object.freeze({
        ...route,
        directUrl: `${profile.directMode.baseUrl}${route.path === "/" ? "" : route.path}`,
        gatewayUrl: `${profile.gatewayMode.publicBaseUrl}${route.path === "/" ? "" : route.path}`
      })
    )
  });
}

export function normalizeGatewayIngressProfile(input = {}) {
  const adapterId = normalizeAdapterId(input.adapterId || input.adapter || input.gateway);
  const directBaseUrl = normalizeUrl(input.directBaseUrl || input.directUrl, DEFAULT_DIRECT_BASE_URL, "directBaseUrl");
  const publicBaseUrl = normalizeUrl(
    input.publicBaseUrl || input.gatewayBaseUrl || input.publicUrl,
    DEFAULT_GATEWAY_BASE_URL,
    "publicBaseUrl"
  );
  const listen = normalizeListen(input.listen || {}, publicBaseUrl);
  const upstreams = normalizeUpstreams(input.upstreams || input.upstreamUrls || input.upstream, directBaseUrl);
  const routes = normalizeRoutes(input.routes);
  const profile = Object.freeze({
    schemaVersion: "v0.0.1:schema:definition-1",
    protocol: AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
    profileId: String(input.profileId || `pact-agent-traffic-gateway-${adapterId}`).trim(),
    directMode: Object.freeze({
      required: true,
      baseUrl: directBaseUrl,
      mustWorkWithoutGateway: true
    }),
    gatewayMode: Object.freeze({
      optional: true,
      adapterId,
      publicBaseUrl,
      listen,
      upstreams,
      limits: Object.freeze({
        maxBodySize: String(input.maxBodySize || input["max-body-size"] || DEFAULT_MAX_BODY_SIZE).trim(),
        streamTimeout: String(input.streamTimeout || input["stream-timeout"] || DEFAULT_STREAM_TIMEOUT).trim()
      })
    }),
    trustedHeaderPolicy: Object.freeze({
      trustedOnlyFrom: normalizeStringList(input.trustedOnlyFrom || input["trusted-from"] || ["loopback", "private-network", "mtls"]),
      gatewayHeaders: Object.freeze([
        "X-Pact-Gateway",
        "X-Pact-Gateway-Route",
        "X-Pact-Gateway-Request-Id",
        "X-Request-Id",
        "X-Forwarded-For",
        "X-Forwarded-Host",
        "X-Forwarded-Proto"
      ]),
      directModeStripsGatewayOnlyHeaders: true
    }),
    routes,
    switchPlan: Object.freeze({
      activeAdapterId: adapterId,
      supportedAdapterIds: listGatewayAdapters().map((adapter) => adapter.adapterId),
      directFallbackUrl: directBaseUrl,
      gatewayCanBeRemoved: true
    })
  });
  return Object.freeze({
    ...profile,
    routeManifest: buildGatewayRouteManifest(profile)
  });
}

function caddyPathMatchers(routes) {
  return routes
    .filter((route) => route.streaming)
    .flatMap((route) => {
      if (route.match === "exact") {
        return [route.path];
      }
      if (route.path === "/") {
        return ["/"];
      }
      return [route.path, `${route.path}/*`];
    });
}

function renderCaddyProxyBlock({ matcher = "", upstreams, adapterId, streaming = false }) {
  const matcherPart = matcher ? ` ${matcher}` : "";
  const lines = [
    `  reverse_proxy${matcherPart} ${upstreams.map((upstream) => upstream.url).join(" ")} {`,
    `    header_up X-Pact-Gateway ${adapterId}`,
    "    header_up X-Pact-Gateway-Route {http.request.uri.path}",
    "    header_up X-Pact-Gateway-Request-Id {http.request.uuid}",
    "    header_up X-Forwarded-Host {host}",
    "    header_up X-Forwarded-Proto {scheme}",
    "    header_up X-Forwarded-For {remote_host}"
  ];
  if (streaming) {
    lines.push("    flush_interval -1");
  }
  lines.push("  }");
  return lines.join("\n");
}

export function renderCaddyConfig(profileInput = {}) {
  const profile = normalizeGatewayIngressProfile(renderProfileInput(profileInput, "caddy"));
  const streamingMatchers = caddyPathMatchers(profile.routes);
  return [
    "# Generated by Pact. Edit the gateway profile and regenerate instead of hand-editing.",
    "# Pact must keep working through directMode.baseUrl when this gateway is removed.",
    "{",
    "  auto_https off",
    "}",
    "",
    `${profile.gatewayMode.listen.address} {`,
    "  encode zstd gzip",
    "  request_body {",
    `    max_size ${profile.gatewayMode.limits.maxBodySize}`,
    "  }",
    "",
    `  @pact_streaming path ${streamingMatchers.join(" ")}`,
    renderCaddyProxyBlock({
      matcher: "@pact_streaming",
      upstreams: profile.gatewayMode.upstreams,
      adapterId: "caddy",
      streaming: true
    }),
    "",
    renderCaddyProxyBlock({
      upstreams: profile.gatewayMode.upstreams,
      adapterId: "caddy",
      streaming: false
    }),
    "}",
    ""
  ].join("\n");
}

function nginxUpstreamScheme(upstreams) {
  const schemes = new Set(upstreams.map((upstream) => upstream.protocol));
  if (schemes.size !== 1) {
    throw new Error("nginx gateway adapter requires all upstreams to use the same http or https scheme");
  }
  return [...schemes][0];
}

function renderNginxProxySettings({ profile, adapterId = "nginx", streaming = false }) {
  const lines = [
    "      proxy_http_version 1.1;",
    "      proxy_set_header Host $host;",
    "      proxy_set_header X-Forwarded-Host $host;",
    "      proxy_set_header X-Forwarded-Proto $scheme;",
    "      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "      proxy_set_header X-Request-Id $request_id;",
    `      proxy_set_header X-Pact-Gateway ${adapterId};`,
    "      proxy_set_header X-Pact-Gateway-Route $uri;",
    "      proxy_set_header X-Pact-Gateway-Request-Id $request_id;",
    "      proxy_set_header Upgrade $http_upgrade;",
    "      proxy_set_header Connection $connection_upgrade;",
    `      proxy_read_timeout ${profile.gatewayMode.limits.streamTimeout};`
  ];
  if (streaming) {
    lines.push("      proxy_buffering off;");
    lines.push("      proxy_request_buffering off;");
    lines.push("      proxy_cache off;");
  }
  return lines.join("\n");
}

function renderNginxLocation(route, profile, scheme) {
  const modifier = route.match === "exact" ? "=" : "^~";
  return [
    `    location ${modifier} ${route.path} {`,
    renderNginxProxySettings({ profile, streaming: route.streaming }),
    `      proxy_pass ${scheme}://pact_backend;`,
    "    }"
  ].join("\n");
}

export function renderNginxConfig(profileInput = {}) {
  const profile = normalizeGatewayIngressProfile(renderProfileInput(profileInput, "nginx"));
  const scheme = nginxUpstreamScheme(profile.gatewayMode.upstreams);
  const listenAddress =
    profile.gatewayMode.listen.host === "0.0.0.0" || profile.gatewayMode.listen.host === "::"
      ? String(profile.gatewayMode.listen.port)
      : `${profile.gatewayMode.listen.host}:${profile.gatewayMode.listen.port}`;
  return [
    "# Generated by Pact. Edit the gateway profile and regenerate instead of hand-editing.",
    "# Pact must keep working through directMode.baseUrl when this gateway is removed.",
    "worker_processes auto;",
    "",
    "events {",
    "  worker_connections 1024;",
    "}",
    "",
    "http {",
    "  map $http_upgrade $connection_upgrade {",
    "    default upgrade;",
    "    '' '';",
    "  }",
    "",
    "  upstream pact_backend {",
    ...profile.gatewayMode.upstreams.map((upstream) => `    server ${upstream.authority};`),
    "    keepalive 32;",
    "  }",
    "",
    "  server {",
    `    listen ${listenAddress};`,
    `    server_name ${profile.gatewayMode.listen.serverName};`,
    `    client_max_body_size ${profile.gatewayMode.limits.maxBodySize};`,
    "",
    ...profile.routes.map((route) => renderNginxLocation(route, profile, scheme)).join("\n\n").split("\n"),
    "  }",
    "}",
    ""
  ].join("\n");
}

export function registerGatewayAdapter(adapter = {}) {
  const adapterId = normalizeAdapterId(adapter.adapterId || adapter.id);
  if (!adapterId) {
    throw new Error("gateway adapterId is required");
  }
  if (typeof adapter.renderConfig !== "function") {
    throw new Error(`gateway adapter ${adapterId} must provide renderConfig(profile)`);
  }
  const normalized = Object.freeze({
    adapterId,
    label: String(adapter.label || adapterId).trim(),
    fileName: String(adapter.fileName || `${adapterId}.conf`).trim(),
    mediaType: String(adapter.mediaType || "text/plain").trim(),
    renderConfig: adapter.renderConfig
  });
  adapterRegistry.set(adapterId, normalized);
  return normalized;
}

registerGatewayAdapter({
  adapterId: "caddy",
  label: "Caddy",
  fileName: "Caddyfile",
  mediaType: "text/caddyfile",
  renderConfig: renderCaddyConfig
});

registerGatewayAdapter({
  adapterId: "nginx",
  label: "Nginx",
  fileName: "nginx.conf",
  mediaType: "text/nginx-conf",
  renderConfig: renderNginxConfig
});

export function listGatewayAdapters() {
  return [...adapterRegistry.values()].map((adapter) =>
    Object.freeze({
      adapterId: adapter.adapterId,
      label: adapter.label,
      fileName: adapter.fileName,
      mediaType: adapter.mediaType
    })
  );
}

export function getGatewayAdapter(adapterId = DEFAULT_GATEWAY_ADAPTER) {
  const normalized = normalizeAdapterId(adapterId);
  const adapter = adapterRegistry.get(normalized);
  if (!adapter) {
    throw new Error(`Unsupported gateway adapter: ${adapterId}`);
  }
  return adapter;
}

function runtimeExecutableName(adapterId) {
  const baseName = adapterId === "nginx" ? "nginx" : "caddy";
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function normalizeRuntimePlatform(value = "") {
  return String(value || `${process.platform}-${process.arch}`).trim();
}

export function resolveGatewayRuntimePlan(input = {}, env = process.env) {
  const adapter = getGatewayAdapter(input.adapterId || input.adapter || input.gateway);
  const platform = normalizeRuntimePlatform(input.platform);
  const cacheRoot = path.resolve(String(input.cacheRoot || input.cacheDir || getDefaultGatewayRuntimeCacheRoot(env)));
  const executableName = runtimeExecutableName(adapter.adapterId);
  const runtimeRoot = path.join(cacheRoot, "runtimes", adapter.adapterId, platform);
  const cachedExecutablePath = path.join(runtimeRoot, "bin", executableName);
  const configuredBinary = String(
    input.runtimeBinary ||
      input.binary ||
      env[`PACT_${adapter.adapterId.toUpperCase()}_BINARY`] ||
      env.PACT_GATEWAY_RUNTIME_BINARY ||
      ""
  ).trim();
  const runtimeUrl = String(
    input.runtimeUrl ||
      input.url ||
      env[`PACT_${adapter.adapterId.toUpperCase()}_RUNTIME_URL`] ||
      env.PACT_GATEWAY_RUNTIME_URL ||
      ""
  ).trim();
  return Object.freeze({
    schemaVersion: "v0.0.1:schema:definition-1",
    protocol: AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
    adapterId: adapter.adapterId,
    platform,
    cacheRoot,
    runtimeRoot,
    binDir: path.join(runtimeRoot, "bin"),
    cachedExecutablePath,
    executableName,
    configuredBinary: configuredBinary ? path.resolve(configuredBinary) : "",
    runtimeUrl,
    sourcePolicy: "configured-binary -> local-cache -> PATH -> runtime-url",
    cacheIsLocal: cacheRoot.includes(`${path.sep}.cache${path.sep}`) || cacheRoot.endsWith(`${path.sep}.cache`)
  });
}

export function renderGatewayConfig(input = {}) {
  const profile = normalizeGatewayIngressProfile(input);
  const adapter = getGatewayAdapter(profile.gatewayMode.adapterId);
  const config = adapter.renderConfig(profile);
  return Object.freeze({
    adapterId: adapter.adapterId,
    fileName: adapter.fileName,
    mediaType: adapter.mediaType,
    profile,
    routeManifest: profile.routeManifest,
    config
  });
}

export function validateGatewayIngressPlan(input = {}) {
  const rendered = renderGatewayConfig(input);
  const failures = [];
  const profile = rendered.profile;
  if (profile.directMode.required !== true || profile.directMode.mustWorkWithoutGateway !== true) {
    failures.push("direct mode must be required and independent from gateway mode");
  }
  if (profile.gatewayMode.optional !== true) {
    failures.push("gateway mode must be optional");
  }
  for (const requiredRoute of ["/mcp", "/api/mcp", "/api/tool-management/v1", "/api/agent-workspaces", "/api/client-runtime", "/api/upload-sessions"]) {
    if (!profile.routes.some((route) => route.path === requiredRoute)) {
      failures.push(`missing gateway route ${requiredRoute}`);
    }
  }
  if (!profile.trustedHeaderPolicy.directModeStripsGatewayOnlyHeaders) {
    failures.push("direct mode must strip or ignore gateway-only headers");
  }
  return Object.freeze({
    ok: failures.length === 0,
    failures,
    adapterId: rendered.adapterId,
    routeCount: profile.routes.length,
    directModeRequired: profile.directMode.required,
    gatewayOptional: profile.gatewayMode.optional
  });
}
