// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useExternalServicesViewController } from "../../../server-web/composables/external-services-view-controller";

const clientMocks = vi.hoisted(() => ({
  adoptExternalServiceTools: vi.fn(),
  getExternalServiceConfig: vi.fn(),
  refreshExternalServiceRuntime: vi.fn(),
  saveExternalServiceConfig: vi.fn(),
  verifyExternalServiceConfig: vi.fn(),
}));

const pageRefreshHandlerMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/lib/external-services-client", () => ({
  externalServiceBindingModeOptions: [
    { value: "passthrough", label: "passthrough" },
    { value: "compile", label: "compile" },
  ],
  externalServiceBindingOutletOptions: [
    { value: "pact.serviceHub", label: "pact.serviceHub" },
  ],
  externalServiceCloudDriveModeOptions: [
    { value: "local", label: "local" },
    { value: "contract", label: "contract" },
    { value: "remote-live", label: "remote-live" },
  ],
  externalServiceCloudDriveProviderOptions: [
    { value: "icloud", label: "iCloud Drive" },
    { value: "onedrive", label: "OneDrive" },
    { value: "google-drive", label: "Google Drive" },
  ],
  externalServiceHealthCheckTypeOptions: [
    { value: "none", label: "none" },
    { value: "http", label: "http" },
  ],
  externalServiceMcpTransportOptions: [
    { value: "streamable-http", label: "streamable-http" },
    { value: "sse", label: "sse" },
  ],
  externalServiceModeOptions: [
    { value: "managed", label: "managed" },
    { value: "connected", label: "connected" },
    { value: "on-demand", label: "on-demand" },
  ],
	  externalServiceModelProtocolOptions: [
	    { value: "openai-compatible", label: "OpenAI Compatible" },
	    { value: "openai-responses", label: "OpenAI Responses" },
	  ],
  externalServiceRiskOptions: [
    { value: "read_only", label: "read_only" },
    { value: "safe_write", label: "safe_write" },
  ],
  externalServiceStartupPolicyOptions: [
    { value: "with-platform", label: "with-platform" },
    { value: "external-only", label: "external-only" },
  ],
  externalServiceUpstreamTypeOptions: [
    { value: "mcp", label: "MCP 服务" },
    { value: "llm", label: "LLM Service" },
    { value: "cloud-drive", label: "Cloud Drive Service" },
    { value: "http", label: "HTTP 服务" },
    { value: "https", label: "HTTPS 服务" },
    { value: "json-rpc", label: "JSON-RPC 服务" },
    { value: "sse", label: "SSE 服务" },
    { value: "other", label: "其它服务" },
  ],
  adoptExternalServiceTools: clientMocks.adoptExternalServiceTools,
  getExternalServiceConfig: clientMocks.getExternalServiceConfig,
  refreshExternalServiceRuntime: clientMocks.refreshExternalServiceRuntime,
  saveExternalServiceConfig: clientMocks.saveExternalServiceConfig,
  verifyExternalServiceConfig: clientMocks.verifyExternalServiceConfig,
}));

vi.mock("../../../server-web/composables/usePageRefresh", () => ({
  usePageRefreshHandler: pageRefreshHandlerMock,
}));

const mountedWrappers: Array<{ unmount: () => void }> = [];

function makeConfig(overrides: Record<string, any> = {}) {
  const base = {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: "pact.external-service.config",
    serviceId: "mcp-docs",
    serviceName: "Docs MCP",
    mode: "connected",
    startupPolicy: "external-only",
    description: "Documentation MCP service",
    featureIds: ["knowledge"],
    requiredOperations: ["knowledge.search"],
    includePaths: [],
    scriptRoots: [],
    scripts: {},
    upstream: {
      type: "mcp",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/mcp",
      endpointUrl: "",
      endpointRef: "",
      rootPath: "",
      secretRef: "",
      timeoutMs: null,
      metadata: {},
    },
    binding: {
      mode: "passthrough",
      outlet: "pact.serviceHub",
      requiredScopes: ["knowledge:read"],
      risk: "read_only",
      metadata: {},
    },
    healthCheck: {
      type: "http",
      url: "http://127.0.0.1:8787/health",
      host: "127.0.0.1",
      port: 8787,
      path: "/health",
      timeoutMs: 60000,
      required: true,
    },
    metadata: {},
  };
  return {
    ...base,
    ...overrides,
    upstream: Object.prototype.hasOwnProperty.call(overrides, "upstream")
      ? overrides.upstream
      : { ...base.upstream },
    binding: Object.prototype.hasOwnProperty.call(overrides, "binding")
      ? overrides.binding
      : { ...base.binding },
    healthCheck: Object.prototype.hasOwnProperty.call(overrides, "healthCheck")
      ? overrides.healthCheck
      : { ...base.healthCheck },
    scripts: Object.prototype.hasOwnProperty.call(overrides, "scripts")
      ? overrides.scripts
      : { ...base.scripts },
    metadata: Object.prototype.hasOwnProperty.call(overrides, "metadata")
      ? overrides.metadata
      : { ...base.metadata },
  };
}

function makeEntry(overrides: Record<string, any> = {}) {
  const config = Object.prototype.hasOwnProperty.call(overrides, "config")
    ? overrides.config
    : makeConfig(overrides.configOverrides || {});
  const serviceId = overrides.serviceId || config?.serviceId || "mcp-docs";
  const serviceName = overrides.serviceName || config?.serviceName || "Docs MCP";
  return {
    entryId: overrides.entryId || serviceId,
    serviceId,
    serviceName,
    displayName: overrides.displayName || serviceName,
    description: overrides.description || config?.description || "",
    mode: overrides.mode || config?.mode || "connected",
    startupPolicy: overrides.startupPolicy || config?.startupPolicy || "external-only",
    source: overrides.source || "configured",
    sourceLabel: overrides.sourceLabel || "本地配置",
    filePath: overrides.filePath || "",
    featureIds: overrides.featureIds || config?.featureIds || [],
    requiredOperations: overrides.requiredOperations || config?.requiredOperations || [],
    scriptIds: overrides.scriptIds || Object.keys(config?.scripts || {}),
    scriptCount: overrides.scriptCount ?? Object.keys(config?.scripts || {}).length,
    healthCheck: Object.prototype.hasOwnProperty.call(overrides, "healthCheck")
      ? overrides.healthCheck
      : config?.healthCheck,
    validationStatus: overrides.validationStatus || "valid",
    validation: overrides.validation || { ok: true, errors: [], warnings: [] },
    externalMcp: Object.prototype.hasOwnProperty.call(overrides, "externalMcp")
      ? overrides.externalMcp
      : null,
    config,
  };
}

function makeTemplate(templateId: string, label: string, protocolFamily: string, fields: Array<Record<string, any>>) {
  const extraOptionalGroups = protocolFamily === "generic-sse"
    ? [
        {
          id: "event-filter",
          label: "Event filters",
          kind: "optional",
          mode: "any",
          fields: [
            { path: "tools[].sse.eventTypes", label: "Allowed event types" },
          ],
        },
        {
          id: "stream-budget",
          label: "Stream budget",
          kind: "optional",
          mode: "any",
          fields: [
            { path: "tools[].sse.maxEvents", label: "Max output events" },
            { path: "tools[].sse.maxBytes", label: "Max response bytes" },
          ],
        },
      ]
    : [];
  return {
    templateId,
    label,
    upstreamType: protocolFamily,
    bindingMode: protocolFamily === "raw-mcp-streamable-http" ? "passthrough" : "compile",
    minimalRequiredFields: fields.map((field) => field.value ? `${field.path}=${field.value}` : field.path),
    optionalGroups: ["upstream.auth.secretRef"],
    fieldModel: {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolFamily,
      endpointField: fields.find((field) => String(field.path).includes("url") || String(field.path).includes("baseUrl"))?.path || "",
      minimum: {
        id: `minimum-${protocolFamily}`,
        label: "Minimum usable draft",
        kind: "minimum",
        fields,
      },
      requiredGroups: [
        {
          id: "required",
          label: "Required",
          kind: "required",
          fields,
        },
      ],
      optionalGroups: [
        {
          id: "secret-auth",
          label: "SecretStore auth",
          kind: "optional",
          mode: "all-or-none",
          fields: [
            { path: "upstream.auth.type", label: "Auth type" },
            { path: "upstream.auth.secretRef", label: "Secret ref" },
          ],
        },
        ...extraOptionalGroups,
      ],
      defaultedGroups: [
        {
          id: "defaults",
          label: "Defaults",
          kind: "defaulted",
          fields: [
            { path: "binding", label: "binding" },
            { path: "policyPreset", label: "policyPreset" },
          ],
        },
      ],
      materializedOnlyGroups: [],
    },
  };
}

function makeState(overrides: Record<string, any> = {}) {
  const services = overrides.services || [
    makeEntry({
      externalMcp: {
        serviceId: "mcp-docs",
        toolCount: 3,
        activeToolCount: 1,
        candidateToolCount: 2,
        tools: ["searchDocs", "writeDraft", "deleteDraft"],
        activeTools: ["searchDocs"],
        candidateTools: ["writeDraft", "deleteDraft"],
        activeToolDetails: [{
          name: "searchDocs",
          title: "Search Docs",
          fingerprint: "fp-search",
          adoptionState: "adopted",
          inputSchema: {
            type: "object",
            required: ["query"],
            propertyCount: 1,
            properties: [{ name: "query", type: "string", required: true }],
          },
          transport: { type: "mcp" },
        }],
        candidateToolDetails: [
          {
            name: "writeDraft",
            title: "Write Draft",
            descriptionPreview: "Create a draft from search results.",
            fingerprint: "fp-write",
            previousFingerprint: "fp-write-old",
            adoptionState: "candidate",
            reasonCode: "fingerprint_changed_requires_readoption",
            risk: "safe_write",
            requiredScopes: ["knowledge:write"],
            inputSchema: {
              type: "object",
              required: ["title"],
              propertyCount: 2,
              properties: [
                { name: "title", type: "string", required: true },
                { name: "body", type: "string", required: false },
              ],
            },
            transport: { type: "mcp" },
            review: {
              diff: {
                changedFields: ["description", "inputSchema"],
                currentFingerprint: "fp-write",
                previousFingerprint: "fp-write-old",
              },
            },
          },
          {
            name: "deleteDraft",
            title: "Delete Draft",
            fingerprint: "fp-delete",
            adoptionState: "candidate",
            reasonCode: "awaiting_operator_adoption",
            risk: "safe_write",
            inputSchema: {
              type: "object",
              required: ["id"],
              propertyCount: 1,
              properties: [{ name: "id", type: "string", required: true }],
            },
            transport: { type: "mcp" },
          },
        ],
        discoveredAt: "2026-06-04T03:20:00.000Z",
      },
    }),
    makeEntry({
      config: makeConfig({
        serviceId: "icloud-drive",
        serviceName: "iCloud Drive",
        upstream: {
          type: "",
          rootPath: "/Users/unka/Library/Mobile Documents",
          metadata: {},
        },
      }),
      source: "preset",
      sourceLabel: "预设",
      validationStatus: "invalid",
      validation: { ok: false, errors: ["missing token"], warnings: ["read only"] },
    }),
    makeEntry({
      config: makeConfig({
        serviceId: "openai-model",
        serviceName: "OpenAI Model",
        upstream: {
          type: "",
          provider: "openai",
          modelProtocol: "openai-compatible",
          url: "https://api.openai.com/v1",
          metadata: {},
        },
      }),
      externalMcp: {
        serviceId: "openai-model",
        toolCount: 5,
        tools: [],
        discoveredAt: "2026-06-04T03:40:00.000Z",
      },
    }),
  ];
  const templates = overrides.templates || [
    makeTemplate("external-service.template.raw-mcp-streamable-http", "Raw MCP Streamable HTTP", "raw-mcp-streamable-http", [
      { path: "serviceId", label: "Service ID" },
      { path: "upstream.url", label: "MCP URL" },
    ]),
    makeTemplate("external-service.template.https-json", "HTTPS JSON", "https-json", [
      { path: "serviceId", label: "Service ID" },
      { path: "upstream.baseUrl", label: "Base URL" },
      { path: "tools[].name", label: "Tool name" },
      { path: "tools[].method", label: "HTTP method", value: "POST" },
      { path: "tools[].path", label: "HTTP path" },
    ]),
    makeTemplate("external-service.template.json-rpc", "JSON-RPC", "json-rpc-2.0", [
      { path: "serviceId", label: "Service ID" },
      { path: "upstream.url", label: "JSON-RPC URL" },
      { path: "tools[].name", label: "Tool name" },
      { path: "tools[].method", label: "RPC method", alternatives: ["tools[].rpc.method"] },
    ]),
    makeTemplate("external-service.template.sse", "Generic SSE", "generic-sse", [
      { path: "serviceId", label: "Service ID" },
      { path: "upstream.url", label: "SSE URL" },
      { path: "tools[].name", label: "Tool name" },
    ]),
  ];
  return {
    ok: true,
    schemaVersion: "v0.0.1:schema:definition-1",
    generatedAt: "2026-06-04T04:00:00.000Z",
    registryKind: "pact.external-service.registry",
    registryPath: "/tmp/pact/external-services.json",
    activeServiceId: services[0]?.serviceId || "",
    activeConfig: services[0]?.config || makeConfig(),
    activeConfigText: "{}",
    activeValidation: { ok: true, errors: [], warnings: ["registry warning"] },
    templateConfig: makeConfig({ serviceId: "template", serviceName: "Template" }),
    templateConfigText: "{}",
    templateCatalog: {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: "pact.servicehub.template-catalog",
      generatedAt: "2026-06-04T04:00:00.000Z",
      defaultPolicyPreset: "servicehub.production-default",
      templates,
    },
    templates,
    externalMcpCache: {
      updatedAt: "2026-06-04T04:05:00.000Z",
      serviceCount: services.length,
    },
    services,
    configuredCount: services.filter((entry: any) => entry.source === "configured").length,
    presetCount: services.filter((entry: any) => entry.source === "preset").length,
    ...overrides,
  };
}

async function flushControllerPromises() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function mountController() {
  let controller: ReturnType<typeof useExternalServicesViewController> | undefined;
  const shell = {
    openExternalServiceTab: vi.fn(),
  };
  const wrapper = mount(defineComponent({
    name: "ExternalServicesControllerHarness",
    setup() {
      controller = useExternalServicesViewController(shell as any);
      return () => null;
    },
  }));
  mountedWrappers.push(wrapper);
  return {
    controller: controller!,
    shell,
    wrapper,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T05:00:00.000Z"));
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  pageRefreshHandlerMock.mockReset();
  clientMocks.getExternalServiceConfig.mockResolvedValue(makeState());
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useExternalServicesViewController", () => {
  it("loads external services and derives list labels", async () => {
    const state = makeState();
    clientMocks.getExternalServiceConfig.mockResolvedValue(state);

    const { controller } = mountController();
    await flushControllerPromises();

    expect(controller.loading).toBe(false);
    expect(controller.services).toHaveLength(3);
    expect(controller.configuredCount).toBe(2);
    expect(controller.presetCount).toBe(1);
    expect(controller.validServiceCount).toBe(2);
    expect(controller.discoveredServiceCount).toBe(3);
    expect(controller.mcpToolCount).toBe(8);
    expect(controller.registryPath).toBe("/tmp/pact/external-services.json");
    expect(controller.validationWarnings).toEqual(["registry warning"]);
    expect(controller.configStatusTone).toBe("success");
    expect(controller.configStatusLabel).toBe("Valid");
    expect(controller.discoveryCacheUpdatedAtLabel).not.toBe("未生成");

    const [mcpService, driveService, modelService] = controller.services as any[];
    expect(controller.serviceSourceDetail(mcpService)).toBe("本地配置 / mcp-docs");
    expect(controller.upstreamTargetLabel(mcpService)).toBe("127.0.0.1:8787");
    expect(controller.upstreamTargetDetailLabel(mcpService)).toBe("endpoint");
    expect(controller.serviceDiscoveryLabel(mcpService)).toBe("MCP 服务");
    expect(controller.serviceDiscoveryTone(mcpService)).toBe("success");
    expect(controller.serviceDiscoveryRegistrationLabel(mcpService)).toBe("工具已发现");
    expect(controller.serviceDiscoveryRegistrationTone(mcpService)).toBe("success");
    expect(controller.serviceCandidateToolCount(mcpService)).toBe(2);
    expect(controller.serviceActiveToolCount(mcpService)).toBe(1);
    expect(controller.serviceToolAdoptionLabel(mcpService)).toBe("2 candidate / 1 active");
    expect(controller.serviceHeartbeatLastAtLabel(mcpService)).toBe("Latest: -");
    expect(controller.isServiceHeartbeatRefreshing(mcpService)).toBe(false);

    expect(controller.upstreamTargetLabel(driveService)).toBe("/Users/unka/Library/Mobile Documents");
    expect(controller.upstreamTargetDetailLabel(driveService)).toBe("local path");
    expect(controller.serviceDiscoveryLabel(driveService)).toBe("Cloud Drive Service");
    expect(controller.serviceDiscoveryRegistrationLabel(driveService)).toBe("网盘已注册");

    expect(controller.upstreamTargetLabel(modelService)).toBe("api.openai.com:未声明端口");
    expect(controller.serviceDiscoveryLabel(modelService)).toBe("LLM Service");
    expect(controller.serviceDiscoveryRegistrationLabel(modelService)).toBe("模型已注册");

    const customTypeEntry = makeEntry({
      config: makeConfig({
        serviceId: "vector-runner",
        serviceName: "Vector Runner",
        upstream: { type: "vector-rpc", metadata: {} },
        healthCheck: { type: "none", host: "", port: null, path: "/", timeoutMs: 60000, required: false },
      }),
      filePath: "/etc/pact/vector-runner.json",
      externalMcp: null,
    });
    expect(controller.upstreamTargetDetailLabel(customTypeEntry as any)).toBe("config path");
    expect(controller.serviceDiscoveryLabel(customTypeEntry as any)).toBe("vector-rpc 服务");
    expect(controller.serviceDiscoveryTone(customTypeEntry as any)).toBe("neutral");
    expect(controller.serviceDiscoveryRegistrationLabel(customTypeEntry as any)).toBe("类型已注册");

    const [shouldRefresh, refreshHandler] = pageRefreshHandlerMock.mock.calls[0];
    expect(shouldRefresh({ viewId: "externalServices" })).toBe(true);
    expect(shouldRefresh({ viewId: "debug" })).toBe(false);
    clientMocks.getExternalServiceConfig.mockClear();
    await refreshHandler({ viewId: "externalServices" });
    expect(clientMocks.getExternalServiceConfig).toHaveBeenCalledTimes(1);
  });

  it("normalizes add and edit drafts through public editor actions", async () => {
    const { controller, shell } = mountController();
    await flushControllerPromises();

    controller.openAddServiceConfig();
    expect(controller.configEditorOpen).toBe(true);
    expect(controller.configEditorMode).toBe("add");
    expect(controller.configEditorTitle).toBe("添加服务");
    expect(controller.configEditorSubtitle).toContain("最小可用组合");
    expect(controller.currentTemplateLabel).toBe("Raw MCP Streamable HTTP");
    expect(controller.minimumFieldLabels).toEqual([
      "serviceId",
      "upstream.url",
    ]);
    expect(shell.openExternalServiceTab).toHaveBeenCalledWith("list");

    controller.updateRootField("serviceId" as any, "drive-sync");
    controller.updateRootField("serviceName" as any, "Drive Sync");
    controller.updateUpstreamTypeSelection("cloud-drive");
    expect(controller.configDraft.upstream?.type).toBe("cloud-drive");
    expect(controller.configDraft.upstream?.transport).toBe("pact-upstream-gateway");
    expect(controller.configDraft.upstream?.provider).toBe("icloud");
    expect(controller.configDraft.binding?.requiredScopes).toEqual([
      "drive:read",
      "drive:write",
      "drive:sync",
      "drive:share",
    ]);
    expect(controller.isCloudDriveServiceDraft).toBe(true);

    controller.updateCloudDriveProvider("onedrive");
    controller.updateCloudDriveMode("remote-live");
    controller.updateRequiredScopes("drive:read, drive:write\ndrive:read");
    controller.updateBindingField("risk", "safe_write");
    controller.updateHealthCheckField("type", "http");
    controller.updateHealthCheckField("port", "8080");
    controller.updateHealthCheckField("timeoutMs", "bad");
    controller.updateHealthCheckRequired(true);
    expect(controller.configDraft.upstream?.providers).toEqual(["onedrive"]);
    expect(controller.configDraft.upstream?.mode).toBe("remote-live");
    expect(controller.configDraft.binding?.requiredScopes).toEqual(["drive:read", "drive:write"]);
    expect(controller.configDraft.healthCheck?.port).toBe(8080);
    expect(controller.configDraft.healthCheck?.timeoutMs).toBe(60000);
    expect(controller.dirty).toBe(true);

    controller.updateUpstreamTypeSelection("llm");
    expect(controller.configDraft.upstream?.modelProtocol).toBe("");
    expect(controller.isLlmServiceDraft).toBe(true);
    expect(controller.modelProtocolSelectValue).toBe("openai-responses");
    controller.updateModelProtocol("openai-compatible");
    expect(controller.configDraft.upstream?.modelProtocol).toBe("openai-compatible");
    controller.updateModelProvider("openai");
    controller.updateUpstreamField("timeoutMs", "1500");
    expect(controller.configDraft.upstream?.provider).toBe("openai");
    expect(controller.configDraft.upstream?.timeoutMs).toBe(1500);

    controller.updateUpstreamTypeSelection("https");
    controller.updateUpstreamField("url", "https://api.example.com:443");
    controller.updatePrimaryToolField("name", "searchItems");
    controller.updatePrimaryToolField("method", "post");
    controller.updatePrimaryToolField("path", "/v1/items/search");
    expect(controller.showMcpTransportField).toBe(false);
    expect(controller.showToolMappingFields).toBe(true);
    expect(controller.endpointFieldLabel).toBe("Base URL");
    expect(controller.currentTemplateLabel).toBe("HTTPS JSON");
    expect(controller.minimumFieldLabels).toEqual([
      "serviceId",
      "upstream.baseUrl",
      "tools[].name",
      "tools[].method=POST",
      "tools[].path",
    ]);
    expect(controller.optionalFieldGroupSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "secret-auth",
        mode: "整组填写",
        fields: ["upstream.auth.type", "upstream.auth.secretRef"],
      }),
    ]));
    expect(controller.defaultedFieldLabels).toEqual(["binding", "policyPreset"]);
    expect(JSON.parse(controller.configText)).toMatchObject({
      templateId: "external-service.template.https-json",
      serviceId: "drive-sync",
      upstream: {
        baseUrl: "https://api.example.com:443",
      },
      tools: [
        {
          name: "searchItems",
          method: "POST",
          path: "/v1/items/search",
        },
      ],
    });
    expect(JSON.parse(controller.configText).upstream).not.toHaveProperty("type");
    expect(JSON.parse(controller.configText).upstream).not.toHaveProperty("transport");

    controller.updateUpstreamTypeSelection("json-rpc");
    controller.updateUpstreamField("url", "https://rpc.example.com:443/jsonrpc");
    controller.updatePrimaryToolField("name", "lookupTicket");
    controller.updatePrimaryToolField("method", "ticket.lookup");
    controller.updateUpstreamAuthField("type", "bearer");
    controller.updateUpstreamAuthField("secretRef", "secret://servicehub/rpc/api-key");
    expect(controller.isJsonRpcServiceDraft).toBe(true);
    expect(controller.endpointFieldLabel).toBe("JSON-RPC URL");
    expect(controller.currentTemplateLabel).toBe("JSON-RPC");
    expect(controller.minimumFieldLabels).toEqual([
      "serviceId",
      "upstream.url",
      "tools[].name",
      "tools[].method | tools[].rpc.method",
    ]);
    expect(JSON.parse(controller.configText)).toMatchObject({
      templateId: "external-service.template.json-rpc",
      upstream: {
        url: "https://rpc.example.com:443/jsonrpc",
        auth: {
          type: "bearer",
          secretRef: "secret://servicehub/rpc/api-key",
        },
      },
      tools: [
        {
          name: "lookupTicket",
          method: "ticket.lookup",
        },
      ],
    });
    expect(JSON.parse(controller.configText).upstream).not.toHaveProperty("type");

    controller.updateUpstreamTypeSelection("sse");
    controller.updateUpstreamField("url", "https://events.example.com:443/v1/events");
    controller.updatePrimaryToolField("name", "watchEvents");
    expect(controller.isSseServiceDraft).toBe(true);
    expect(controller.endpointFieldLabel).toBe("SSE URL");
    expect(controller.currentTemplateLabel).toBe("Generic SSE");
    expect(controller.minimumFieldLabels).toEqual([
      "serviceId",
      "upstream.url",
      "tools[].name",
    ]);
    expect(JSON.parse(controller.configText)).toMatchObject({
      templateId: "external-service.template.sse",
      upstream: {
        url: "https://events.example.com:443/v1/events",
      },
      tools: [
        {
          name: "watchEvents",
        },
      ],
    });
    expect(JSON.parse(controller.configText).upstream).not.toHaveProperty("type");
    expect(JSON.parse(controller.configText).upstream).not.toHaveProperty("eventFormat");
    expect(controller.advancedOptionalFieldRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: "event-filter",
        path: "tools[].sse.eventTypes",
        value: "",
      }),
      expect.objectContaining({
        groupId: "stream-budget",
        path: "tools[].sse.maxEvents",
        value: "",
      }),
    ]));
    controller.updateAdvancedOptionalField("tools[].sse.eventTypes", "delta, done");
    controller.updateAdvancedOptionalField("tools[].sse.maxEvents", "2");
    controller.updateAdvancedOptionalField("tools[].sse.maxBytes", "4096");
    expect(JSON.parse(controller.configText).tools[0].sse).toMatchObject({
      eventTypes: ["delta", "done"],
      maxEvents: 2,
      maxBytes: 4096,
    });

    controller.onConfigInput(JSON.stringify({
      templateId: "external-service.template.https-json",
      serviceId: "json-minimum-https",
      upstream: {
        baseUrl: "https://api.example.com:443",
      },
      tools: [{
        name: "searchItems",
        method: "POST",
        path: "/v1/items/search",
      }],
    }));
    expect(controller.configDraft.upstream?.type).toBe("https");
    expect(controller.endpointFieldLabel).toBe("Base URL");

    controller.updateCustomUpstreamType("workflow_rpc");
    expect(controller.configDraft.upstream?.type).toBe("workflow_rpc");
    expect(controller.upstreamTypeSelectValue).toBe("other");
    expect(controller.showCustomUpstreamType).toBe(true);
    expect(controller.customUpstreamTypeValue).toBe("workflow_rpc");

    controller.onConfigInput("{bad json");
    expect(controller.dirty).toBe(true);
    expect(controller.configDraft.serviceId).toBe("json-minimum-https");

    controller.onConfigInput(JSON.stringify({
      serviceId: "json-service",
      serviceName: "JSON Service",
      mode: "managed",
      startupPolicy: "with-platform",
      upstream: {
        type: "llm",
        modelProtocol: "unknown-protocol",
        provider: "custom",
      },
      binding: {
        requiredScopes: ["knowledge:read", "knowledge:write"],
      },
    }));
    expect(controller.configDraft.serviceId).toBe("json-service");
    expect(controller.requiredScopesText).toBe("knowledge:read, knowledge:write");
    expect(controller.modelProtocolSelectValue).toBe("openai-responses");
    expect(controller.activeConfigSummary.serviceId).toBe("json-service");

    const bareEntry = makeEntry({
      displayName: "Bare Service",
      config: {
        serviceId: "bare-service",
        serviceName: "Bare Service",
        mode: "connected",
        startupPolicy: "external-only",
        binding: { requiredScopes: ["bare:read"] },
      },
      validation: { ok: false, errors: ["no upstream"], warnings: [] },
    });
    controller.openEditServiceConfig(bareEntry as any);
    expect(controller.configEditorMode).toBe("edit");
    expect(controller.configEditorTitle).toBe("修改配置：Bare Service");
    expect(controller.configDraft.upstream).toBeUndefined();
    expect(controller.validationErrors).toEqual(["no upstream"]);

    controller.closeConfigEditor();
    expect(controller.configEditorOpen).toBe(false);
    expect(controller.actionError).toBe("");
  });

  it("handles verify, save, refresh, and error paths", async () => {
    const initialState = makeState();
    clientMocks.getExternalServiceConfig.mockResolvedValue(initialState);
    const { controller } = mountController();
    await flushControllerPromises();
    const initialService = (controller.services as any[])[0];
    expect(controller.serviceCandidateToolReviewRows(initialService)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "writeDraft",
        fingerprint: "fp-write",
        previousFingerprint: "fp-write-old",
        reasonCode: "fingerprint_changed_requires_readoption",
        inputSchema: expect.objectContaining({
          required: ["title"],
          propertyCount: 2,
        }),
        review: expect.objectContaining({
          diff: expect.objectContaining({
            changedFields: ["description", "inputSchema"],
          }),
        }),
      }),
    ]));
    expect(controller.serviceActiveToolReviewRows(initialService)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "searchDocs", fingerprint: "fp-search" }),
    ]));
    expect(controller.serviceCandidateToolFingerprintMap(initialService)).toEqual({
      writeDraft: "fp-write",
      deleteDraft: "fp-delete",
    });
    controller.openAddServiceConfig();

    clientMocks.verifyExternalServiceConfig.mockResolvedValueOnce({
      ok: false,
      config: null,
      validation: { ok: false, errors: ["bad json"], warnings: [] },
    });
    await controller.verifyConfig();
    expect(controller.verifying).toBe(false);
    expect(controller.actionMessage).toBe("配置校验未通过。");
    expect(controller.validationErrors).toEqual(["bad json"]);

    clientMocks.verifyExternalServiceConfig.mockRejectedValueOnce(new Error("verify unavailable"));
    await controller.verifyConfig();
    expect(controller.actionError).toBe("verify unavailable");

    clientMocks.saveExternalServiceConfig.mockResolvedValueOnce({
      ok: false,
      error: "registry is locked",
      config: null,
      validation: { ok: false, errors: ["locked"], warnings: [] },
    });
    await controller.saveConfig();
    expect(controller.saving).toBe(false);
    expect(controller.actionError).toBe("registry is locked");
    expect(controller.configEditorOpen).toBe(true);

    clientMocks.saveExternalServiceConfig.mockResolvedValueOnce({
      ok: true,
      config: makeConfig({ serviceId: "saved" }),
      validation: { ok: true, errors: [], warnings: [] },
      registryPath: "/tmp/pact/external-services.json",
    });
    await controller.saveConfig();
    await flushControllerPromises();
    expect(controller.actionMessage).toBe("配置已保存。");
    expect(controller.configEditorOpen).toBe(false);
    expect(controller.dirty).toBe(false);

    const refreshedState = makeState({
      services: [
        makeEntry({
          externalMcp: {
            serviceId: "mcp-docs",
            toolCount: 7,
            tools: [],
            discoveredAt: "2026-06-04T05:05:00.000Z",
          },
        }),
      ],
    });
    clientMocks.refreshExternalServiceRuntime.mockResolvedValueOnce({
      ok: true,
      refreshedAt: "2026-06-04T05:10:00.000Z",
      refreshedCount: 1,
      failedCount: 0,
      skippedCount: 2,
      results: [
        {
          ok: true,
          status: "refreshed",
          serviceId: "mcp-docs",
          displayName: "Docs MCP",
          toolCount: 7,
        },
      ],
      state: refreshedState,
      toolCatalogRefresh: {
        ok: true,
        externalMcpOperationCount: 9,
      },
    });
    await controller.refreshRuntime();
    expect(controller.refreshingRuntime).toBe(false);
    expect(controller.actionMessage).toContain("后台刷新完成：1 个服务已刷新");
    expect(controller.actionMessage).toContain("目录中 9 个外部 MCP 工具");
    expect(controller.mcpToolCount).toBe(7);

    const scopedEntry = (controller.services as any[])[0];
    clientMocks.refreshExternalServiceRuntime.mockResolvedValueOnce({
      ok: false,
      refreshedAt: "2026-06-04T05:12:00.000Z",
      refreshedCount: 0,
      failedCount: 1,
      skippedCount: 0,
      results: [
        {
          ok: false,
          status: "failed",
          serviceId: "mcp-docs",
          displayName: "Docs MCP",
          error: "connection refused",
        },
      ],
      state: refreshedState,
    });
    await controller.refreshRuntime("mcp-docs");
    expect(controller.actionMessage).toBe("Docs MCP 服务探测完成：connection refused。");
    expect(controller.actionError).toBe("connection refused");
    expect(controller.serviceHeartbeatLastAtLabel(scopedEntry)).not.toBe("Latest: -");
    expect(controller.isServiceHeartbeatRefreshing(scopedEntry)).toBe(false);

    const adoptedState = makeState({
      services: [
        makeEntry({
          externalMcp: {
            serviceId: "mcp-docs",
            toolCount: 3,
            activeToolCount: 3,
            candidateToolCount: 0,
            tools: ["searchDocs", "writeDraft", "deleteDraft"],
            activeTools: ["searchDocs", "writeDraft", "deleteDraft"],
            candidateTools: [],
            discoveredAt: "2026-06-04T05:15:00.000Z",
          },
        }),
      ],
    });
    clientMocks.adoptExternalServiceTools.mockResolvedValueOnce({
      ok: true,
      serviceId: "mcp-docs",
      adoptedToolNames: ["writeDraft", "deleteDraft"],
      activeToolCount: 3,
      candidateToolCount: 0,
      state: adoptedState,
    });
    await controller.adoptCandidateTools("mcp-docs");
    expect(clientMocks.adoptExternalServiceTools).toHaveBeenCalledWith({
      serviceId: "mcp-docs",
      toolNames: [],
      adoptAll: true,
      adoptedBy: "operator",
      expectedFingerprints: {},
    });
    expect(controller.actionMessage).toBe("已采纳 2 个候选工具。");
    expect(controller.serviceCandidateToolCount((controller.services as any[])[0])).toBe(0);
    expect(controller.serviceActiveToolCount((controller.services as any[])[0])).toBe(3);
    expect(controller.isServiceToolAdopting("mcp-docs")).toBe(false);

    clientMocks.adoptExternalServiceTools.mockResolvedValueOnce({
      ok: true,
      serviceId: "mcp-docs",
      adoptedToolNames: ["writeDraft"],
      activeToolCount: 2,
      candidateToolCount: 1,
      state: initialState,
    });
    await controller.adoptCandidateTools(initialService, ["writeDraft"]);
    expect(clientMocks.adoptExternalServiceTools).toHaveBeenLastCalledWith({
      serviceId: "mcp-docs",
      toolNames: ["writeDraft"],
      adoptAll: false,
      adoptedBy: "operator",
      expectedFingerprints: {
        writeDraft: "fp-write",
      },
    });

    clientMocks.adoptExternalServiceTools.mockResolvedValueOnce({
      ok: false,
      serviceId: "mcp-docs",
      error: "candidate changed",
    });
    await controller.adoptCandidateTools("mcp-docs");
    expect(controller.actionError).toBe("candidate changed");

    clientMocks.refreshExternalServiceRuntime.mockRejectedValueOnce(new Error("refresh crashed"));
    await controller.refreshRuntime("mcp-docs");
    expect(controller.actionError).toBe("refresh crashed");

    clientMocks.getExternalServiceConfig.mockRejectedValueOnce(new Error("load failed"));
    await controller.refreshExternalServices();
    expect(controller.loadError).toBe("load failed");
  });

  it("derives discovery labels and upstream targets for edge cases", () => {
    const pendingDiscovery = makeEntry({
      config: makeConfig({
        serviceId: "mcp-no-tools",
        serviceName: "MCP Pending",
        upstream: {
          ...makeConfig().upstream,
          type: "mcp",
          url: "http://127.0.0.1:7777/mcp",
        },
      }),
      externalMcp: null,
    });

    const genericEndpoint = makeEntry({
      config: makeConfig({
        serviceId: "generic-endpoint",
        serviceName: "Generic Endpoint",
        upstream: {
          ...makeConfig().upstream,
          type: "",
          url: "https://gateway.example.com/api",
        },
      }),
      externalMcp: { serviceId: "generic-endpoint", tools: [], discoveredAt: "2026-06-04T05:30:00.000Z" },
    });

    const noIdentityService = makeEntry({
      config: {
        ...makeConfig({
          serviceId: "other-service",
          serviceName: "Other Service",
          upstream: {
            ...makeConfig().upstream,
            type: "",
            url: "",
          },
          healthCheck: {
            ...makeConfig().healthCheck,
            host: "",
            port: null,
          },
        }),
      },
      filePath: "/etc/pact/other-service.json",
    });

    const withEndpointRef = {
      ...makeEntry({
        config: {
          ...makeConfig({
            serviceId: "endpoint-ref",
            serviceName: "Endpoint Ref",
            upstream: {
              ...makeConfig().upstream,
              type: "",
              url: "",
              endpointRef: "config://pact/endpoint-ref",
            },
            healthCheck: {
              ...makeConfig().healthCheck,
              host: "",
              port: null,
            },
          }),
        },
      }),
    };

    const state = makeState({
      services: [pendingDiscovery, genericEndpoint, noIdentityService, withEndpointRef],
      validServiceCount: 4,
      configuredCount: 4,
      presetCount: 0,
    });

    clientMocks.getExternalServiceConfig.mockResolvedValue(state);
    const { controller } = mountController();
    return flushControllerPromises().then(() => {
      expect(controller.serviceDiscoveryRegistrationLabel(pendingDiscovery as any)).toBe("工具待刷新");
      expect(controller.serviceDiscoveryRegistrationTone(pendingDiscovery as any)).toBe("warning");

      expect(controller.serviceDiscoveryLabel(genericEndpoint as any)).toBe("HTTPS 服务");
      expect(controller.serviceDiscoveryRegistrationLabel(genericEndpoint as any)).toBe("端点已注册");

      expect(controller.serviceDiscoveryLabel(noIdentityService as any)).toBe("其它服务");
      expect(controller.serviceDiscoveryRegistrationLabel(noIdentityService as any)).toBe("服务已注册");

      expect(controller.upstreamTargetDetailLabel(withEndpointRef as any)).toBe("endpoint ref");
      expect(controller.upstreamTargetLabel(withEndpointRef as any)).toBe("config://pact/endpoint-ref");
    });
  });

  it("prevents duplicated scoped refresh calls and schedules heartbeat timer lifecycle", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    let refreshResolver: ((value: any) => void) | null = null;
    const refreshPromise = new Promise((resolve) => {
      refreshResolver = resolve;
    });

    clientMocks.refreshExternalServiceRuntime.mockImplementation(() => refreshPromise);
    const { controller, wrapper } = mountController();
    await flushControllerPromises();

    const firstRefresh = controller.refreshRuntime("mcp-docs");
    await nextTick();
    await controller.refreshRuntime("mcp-docs");

    expect(clientMocks.refreshExternalServiceRuntime).toHaveBeenCalledTimes(1);

    refreshResolver?.( {
      ok: true,
      refreshedAt: "2026-06-04T06:00:00.000Z",
      refreshedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      results: [
        {
          ok: true,
          status: "refreshed",
          serviceId: "mcp-docs",
          displayName: "Docs MCP",
          toolCount: 3,
        },
      ],
      state: makeState(),
    });
    await firstRefresh;
    await flushControllerPromises();

    expect(controller.isServiceHeartbeatRefreshing((controller.services as any[])[0])).toBe(false);

    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).not.toHaveBeenCalled();

    wrapper.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it("falls back to list refresh and keeps messages on silent scoped refresh", async () => {
    const { controller } = mountController();
    await flushControllerPromises();

    clientMocks.verifyExternalServiceConfig.mockResolvedValueOnce({
      ok: false,
      config: null,
      validation: { ok: false, errors: ["bad json"], warnings: [] },
    });
    await controller.verifyConfig();
    expect(controller.actionMessage).toBe("配置校验未通过。");

    clientMocks.refreshExternalServiceRuntime.mockResolvedValueOnce({
      ok: true,
      refreshedAt: "2026-06-04T06:10:00.000Z",
      refreshedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      results: [
        {
          ok: true,
          status: "checked",
          serviceId: "mcp-docs",
          displayName: "Docs MCP",
        },
      ],
      state: makeState(),
    });
    await controller.refreshRuntime("mcp-docs", { silent: true });
    expect(controller.actionMessage).toBe("配置校验未通过。");

    clientMocks.refreshExternalServiceRuntime.mockResolvedValueOnce({
      ok: true,
      refreshedAt: "2026-06-04T06:20:00.000Z",
      refreshedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      results: [
        {
          ok: true,
          status: "checked",
          serviceId: "mcp-docs",
          displayName: "Docs MCP",
        },
      ],
    });
    await controller.refreshRuntime();

    await flushControllerPromises();
    expect(clientMocks.getExternalServiceConfig).toHaveBeenCalledTimes(2);
  });
});
