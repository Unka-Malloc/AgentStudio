import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ServerConfig } from "../config/ServerConfig.mjs";
import {
  EXTERNAL_SERVICE_BINDING_MODE,
  EXTERNAL_SERVICE_BINDING_OUTLET,
  EXTERNAL_SERVICE_CONFIG_KIND,
  EXTERNAL_SERVICE_MCP_TRANSPORT,
  EXTERNAL_SERVICE_POLICY_PRESET,
  EXTERNAL_SERVICE_TEMPLATE_ID,
  EXTERNAL_SERVICE_UPSTREAM_TYPE,
  normalizeExternalServiceConfig
} from "./external-service-adapter.mjs";

export const SERVICEHUB_TEMPLATE_CATALOG_KIND = "pact.servicehub.template-catalog";
export const SERVICEHUB_MATERIALIZED_MANIFEST_KIND = "pact.servicehub.materialized-manifest";

const SERVICEHUB_PRODUCTION_REQUIRED_GATES = Object.freeze([
  "template-static-validation",
  "manifest-bound-invocation",
  "egress-ssrf-dns-redirect-verifier",
  "secretstore-binding-and-redaction",
  "tool-adoption-gate",
  "grant-projection",
  "quota-bulkhead-deadline",
  "error-taxonomy-and-retry-hint",
  "external-call-receipt",
  "output-governance"
]);

const SERVICEHUB_DEFAULTED_DRAFT_FIELDS = Object.freeze([
  "schemaVersion",
  "kind",
  "templateId",
  "serviceName",
  "displayName",
  "mode",
  "startupPolicy",
  "binding",
  "policyPreset",
  "policies",
  "healthCheck",
  "metadata"
]);

const SERVICEHUB_MATERIALIZED_ONLY_FIELDS = Object.freeze([
  "coreFeatureIds",
  "featureIds",
  "requiredOperations",
  "includePaths",
  "scriptRoots",
  "runtimeDependencies",
  "docker",
  "evidence",
  "promotion",
  "verification",
  "secretBindingStatus",
  "expandedPolicies",
  "audit"
]);

const SERVICEHUB_ADVANCED_OPTIONAL_FIELDS = Object.freeze([
  "serviceName",
  "displayName",
  "description",
  "mode",
  "startupPolicy",
  "upstream.timeoutMs",
  "upstream.defaultHeaders",
  "upstream.auth",
  "binding",
  "healthCheck",
  "policies"
]);

function field(path, label, {
  value = undefined,
  placeholder = "",
  note = "",
  requiredWhenGroupUsed = false,
  alternatives = []
} = {}) {
  return {
    path,
    label,
    ...(value !== undefined ? { value } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(note ? { note } : {}),
    ...(requiredWhenGroupUsed ? { requiredWhenGroupUsed: true } : {}),
    ...(alternatives.length ? { alternatives } : {})
  };
}

function fieldGroup({
  id,
  label,
  kind,
  fields = [],
  mode = "",
  hiddenByDefault = false,
  note = ""
}) {
  return {
    id,
    label,
    kind,
    fields,
    ...(mode ? { mode } : {}),
    ...(hiddenByDefault ? { hiddenByDefault: true } : {}),
    ...(note ? { note } : {})
  };
}

function templateDefaultGroup(fields = []) {
  return fieldGroup({
    id: "protocol-template-defaults",
    label: "Injected by selected template",
    kind: "defaulted",
    hiddenByDefault: true,
    note: "These fields distinguish the protocol family, but the operator does not hand-author them after selecting a template.",
    fields
  });
}

const COMMON_REQUIRED_IDENTITY_GROUP = Object.freeze(fieldGroup({
  id: "service-identity",
  label: "Service identity",
  kind: "required",
  fields: [
    field("serviceId", "Service ID", {
      placeholder: "billing-api",
      note: "Stable registry key; serviceName/displayName default to this value."
    })
  ]
}));

function secretAuthOptionalGroup() {
  return fieldGroup({
    id: "secret-auth",
    label: "SecretStore auth",
    kind: "optional",
    mode: "all-or-none",
    hiddenByDefault: true,
    note: "Omit the whole group for public upstreams. When used, credentials must be referenced by secretRef; literal tokens are rejected.",
    fields: [
      field("upstream.auth.type", "Auth type", {
        requiredWhenGroupUsed: true,
        placeholder: "bearer"
      }),
      field("upstream.auth.secretRef", "Secret ref", {
        requiredWhenGroupUsed: true,
        placeholder: "secret://servicehub/service/api-key"
      }),
      field("upstream.auth.headerName", "Header name", {
        placeholder: "X-API-Key",
        note: "Only needed for header-based API keys."
      })
    ]
  });
}

function timeoutOptionalGroup() {
  return fieldGroup({
    id: "deadline-timeout",
    label: "Timeout and retry overrides",
    kind: "optional",
    mode: "any",
    hiddenByDefault: true,
    note: "Production defaults come from the ServiceHub policy preset; override only for a service-specific bound.",
    fields: [
      field("upstream.timeoutMs", "Upstream timeout ms"),
      field("policies.deadline", "Deadline policy"),
      field("policies.retry", "Retry policy")
    ]
  });
}

function displayRuntimeOptionalGroup() {
  return fieldGroup({
    id: "display-runtime-overrides",
    label: "Display and runtime overrides",
    kind: "optional",
    mode: "any",
    hiddenByDefault: true,
    note: "These values are defaulted by the draft normalizer and do not belong to the minimum registration path.",
    fields: [
      field("serviceName", "Service name"),
      field("displayName", "Display name"),
      field("description", "Description"),
      field("mode", "Runtime mode"),
      field("startupPolicy", "Startup policy")
    ]
  });
}

function bindingOptionalGroup() {
  return fieldGroup({
    id: "servicehub-binding-overrides",
    label: "ServiceHub exposure overrides",
    kind: "optional",
    mode: "any",
    hiddenByDefault: true,
    note: "Defaults are binding.mode by template, binding.outlet=pact.serviceHub, risk=read_only and empty requiredScopes.",
    fields: [
      field("binding.mode", "Binding mode"),
      field("binding.outlet", "Outlet", { value: EXTERNAL_SERVICE_BINDING_OUTLET.SERVICE_HUB }),
      field("binding.requiredScopes", "Required scopes"),
      field("binding.risk", "Risk")
    ]
  });
}

function healthCheckOptionalGroup() {
  return fieldGroup({
    id: "health-check",
    label: "Health check",
    kind: "optional",
    mode: "all-or-none",
    hiddenByDefault: true,
    note: "Not required for the minimum draft. When enabled, declare either a health URL or host/port.",
    fields: [
      field("healthCheck.type", "Health type", { requiredWhenGroupUsed: true, value: "http" }),
      field("healthCheck.url", "Health URL", { alternatives: ["healthCheck.host", "healthCheck.port"] }),
      field("healthCheck.host", "Health host", { alternatives: ["healthCheck.url"] }),
      field("healthCheck.port", "Health port", { alternatives: ["healthCheck.url"] }),
      field("healthCheck.timeoutMs", "Health timeout ms"),
      field("healthCheck.required", "Require health pass")
    ]
  });
}

function httpMappingOptionalGroups() {
  return [
    fieldGroup({
      id: "input-contract",
      label: "Input schema",
      kind: "optional",
      mode: "any",
      hiddenByDefault: true,
      note: "If omitted, the initial compiled tool has no additional input contract beyond the mapping.",
      fields: [
        field("tools[].inputSchema", "Tool input schema")
      ]
    }),
    fieldGroup({
      id: "request-mapping",
      label: "Request mapping",
      kind: "optional",
      mode: "any",
      hiddenByDefault: true,
      note: "Use only when the upstream needs query/body/business headers derived from validated tool input.",
      fields: [
        field("tools[].request.query", "Query mapping"),
        field("tools[].request.body", "Body mapping"),
        field("tools[].request.headers", "Business header mapping")
      ]
    }),
    fieldGroup({
      id: "response-projection",
      label: "Response projection",
      kind: "optional",
      mode: "any",
      hiddenByDefault: true,
      fields: [
        field("tools[].response.resultPath", "Result path")
      ]
    })
  ];
}

function defaultedFieldGroup() {
  return fieldGroup({
    id: "servicehub-defaults",
    label: "Defaulted by ServiceHub",
    kind: "defaulted",
    hiddenByDefault: true,
    note: "These fields are supplied by normalization or the materialized manifest and should stay out of minimum drafts.",
    fields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS.map((pathName) => field(pathName, pathName))
  });
}

function materializedOnlyFieldGroup() {
  return fieldGroup({
    id: "materialized-manifest-only",
    label: "Materialized manifest only",
    kind: "materialized-only",
    hiddenByDefault: true,
    fields: SERVICEHUB_MATERIALIZED_ONLY_FIELDS.map((pathName) => field(pathName, pathName))
  });
}

function templateDefaultFields(templateId = "") {
  switch (templateId) {
    case EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP:
      return [
        field("upstream.type", "Upstream type", { value: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP }),
        field("upstream.transport", "MCP transport", { value: EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP })
      ];
    case EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE:
      return [
        field("upstream.type", "Upstream type", { value: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP }),
        field("upstream.transport", "MCP transport", { value: EXTERNAL_SERVICE_MCP_TRANSPORT.SSE })
      ];
    case EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON:
      return [field("upstream.type", "Upstream type", { value: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP })];
    case EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON:
      return [field("upstream.type", "Upstream type", { value: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS })];
    case EXTERNAL_SERVICE_TEMPLATE_ID.JSON_RPC:
      return [
        field("upstream.type", "Upstream type", { value: EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC }),
        field("upstream.rpcVersion", "RPC version", { value: "2.0" })
      ];
    case EXTERNAL_SERVICE_TEMPLATE_ID.SSE:
      return [
        field("upstream.type", "Upstream type", { value: EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE }),
        field("upstream.eventFormat", "Event format", { value: "json-data" })
      ];
    case EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY:
      return [field("upstream.type", "Upstream type", { value: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM })];
    default:
      return [];
  }
}

function templateDefaultGroupsFor(templateId = "") {
  const fields = templateDefaultFields(templateId);
  return fields.length ? [templateDefaultGroup(fields)] : [];
}

function createOperatorMinimumDraft(template) {
  const draft = clone(template.draft);
  if (draft.upstream && typeof draft.upstream === "object") {
    delete draft.upstream.type;
    if (
      template.templateId === EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP ||
      template.templateId === EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE
    ) {
      delete draft.upstream.transport;
    }
    if (template.templateId === EXTERNAL_SERVICE_TEMPLATE_ID.SSE) {
      delete draft.upstream.eventFormat;
    }
    if (template.templateId === EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY) {
      delete draft.upstream.modelProtocol;
    }
  }
  return draft;
}

function createSelfDescribingMinimumDraft(template) {
  return {
    templateId: template.templateId,
    ...createOperatorMinimumDraft(template)
  };
}

function createTemplateFieldModel(template) {
  const commonOptionalGroups = [
    displayRuntimeOptionalGroup(),
    secretAuthOptionalGroup(),
    bindingOptionalGroup(),
    healthCheckOptionalGroup(),
    timeoutOptionalGroup()
  ];
  const endpoint = (pathName, label, placeholder) => field(pathName, label, {
    placeholder,
    note: "HTTP/HTTPS endpoints must include explicit scheme, host, port and path where required."
  });
  const toolName = field("tools[].name", "Tool name", {
    placeholder: "searchItems",
    note: "Stable downstream MCP tool name within this service."
  });

  switch (template.templateId) {
    case EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP: {
      const endpointGroup = fieldGroup({
        id: "mcp-streamable-http-endpoint",
        label: "Raw MCP Streamable HTTP endpoint",
        kind: "required",
        fields: [
          endpoint("upstream.url", "MCP URL", "https://mcp.example.com:443/mcp/")
        ]
      });
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolFamily: "raw-mcp-streamable-http",
        endpointField: "upstream.url",
        minimum: fieldGroup({
          id: "minimum-raw-mcp-streamable-http",
          label: "Minimum usable draft",
          kind: "minimum",
          fields: [...COMMON_REQUIRED_IDENTITY_GROUP.fields, ...endpointGroup.fields]
        }),
        requiredGroups: [COMMON_REQUIRED_IDENTITY_GROUP, endpointGroup],
        optionalGroups: commonOptionalGroups,
        defaultedGroups: [...templateDefaultGroupsFor(template.templateId), defaultedFieldGroup()],
        materializedOnlyGroups: [materializedOnlyFieldGroup()]
      };
    }
    case EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE: {
      const endpointGroup = fieldGroup({
        id: "mcp-sse-endpoint",
        label: "Raw MCP SSE endpoint",
        kind: "required",
        fields: [
          endpoint("upstream.url", "MCP SSE URL", "https://mcp.example.com:443/sse")
        ]
      });
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolFamily: "raw-mcp-sse",
        endpointField: "upstream.url",
        minimum: fieldGroup({
          id: "minimum-raw-mcp-sse",
          label: "Minimum usable draft",
          kind: "minimum",
          fields: [...COMMON_REQUIRED_IDENTITY_GROUP.fields, ...endpointGroup.fields]
        }),
        requiredGroups: [COMMON_REQUIRED_IDENTITY_GROUP, endpointGroup],
        optionalGroups: commonOptionalGroups,
        defaultedGroups: [...templateDefaultGroupsFor(template.templateId), defaultedFieldGroup()],
        materializedOnlyGroups: [materializedOnlyFieldGroup()]
      };
    }
    case EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON:
    case EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON: {
      const isHttps = template.templateId === EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON;
      const upstreamType = isHttps ? EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS : EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP;
      const endpointGroup = fieldGroup({
        id: `${upstreamType}-json-endpoint`,
        label: `${upstreamType.toUpperCase()} JSON endpoint`,
        kind: "required",
        fields: [
          endpoint(
            "upstream.baseUrl",
            "Base URL",
            isHttps ? "https://api.example.com:443" : "http://api.internal.example:8080"
          )
        ]
      });
      const toolGroup = fieldGroup({
        id: `${upstreamType}-json-tool-mapping`,
        label: "Tool mapping",
        kind: "required",
        fields: [
          toolName,
          field("tools[].method", "HTTP method", { value: isHttps ? "POST" : "GET" }),
          field("tools[].path", "HTTP path", { placeholder: "/v1/items/{id}" })
        ]
      });
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolFamily: `${upstreamType}-json`,
        endpointField: "upstream.baseUrl",
        minimum: fieldGroup({
          id: `minimum-${upstreamType}-json`,
          label: "Minimum usable draft",
          kind: "minimum",
          fields: [...COMMON_REQUIRED_IDENTITY_GROUP.fields, ...endpointGroup.fields, ...toolGroup.fields]
        }),
        requiredGroups: [COMMON_REQUIRED_IDENTITY_GROUP, endpointGroup, toolGroup],
        optionalGroups: [
          displayRuntimeOptionalGroup(),
          secretAuthOptionalGroup(),
          ...httpMappingOptionalGroups(),
          bindingOptionalGroup(),
          healthCheckOptionalGroup(),
          timeoutOptionalGroup()
        ],
        defaultedGroups: [...templateDefaultGroupsFor(template.templateId), defaultedFieldGroup()],
        materializedOnlyGroups: [materializedOnlyFieldGroup()]
      };
    }
    case EXTERNAL_SERVICE_TEMPLATE_ID.JSON_RPC: {
      const endpointGroup = fieldGroup({
        id: "json-rpc-endpoint",
        label: "JSON-RPC 2.0 endpoint",
        kind: "required",
        fields: [
          endpoint("upstream.url", "JSON-RPC URL", "https://rpc.example.com:443/jsonrpc")
        ]
      });
      const toolGroup = fieldGroup({
        id: "json-rpc-method-mapping",
        label: "JSON-RPC method mapping",
        kind: "required",
        fields: [
          toolName,
          field("tools[].method", "RPC method", {
            placeholder: "ticket.lookup",
            alternatives: ["tools[].rpc.method"]
          })
        ]
      });
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolFamily: "json-rpc-2.0",
        endpointField: "upstream.url",
        minimum: fieldGroup({
          id: "minimum-json-rpc",
          label: "Minimum usable draft",
          kind: "minimum",
          fields: [...COMMON_REQUIRED_IDENTITY_GROUP.fields, ...endpointGroup.fields, ...toolGroup.fields]
        }),
        requiredGroups: [COMMON_REQUIRED_IDENTITY_GROUP, endpointGroup, toolGroup],
        optionalGroups: [
          displayRuntimeOptionalGroup(),
          secretAuthOptionalGroup(),
          fieldGroup({
            id: "rpc-params",
            label: "RPC params mapping",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [
              field("tools[].rpc.params", "RPC params"),
              field("tools[].request.body", "Request body mapping")
            ]
          }),
          fieldGroup({
            id: "rpc-result",
            label: "RPC result projection",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [
              field("tools[].rpc.resultPath", "RPC result path"),
              field("tools[].response.resultPath", "Response result path")
            ]
          }),
          fieldGroup({
            id: "multi-endpoint",
            label: "Multiple RPC endpoints",
            kind: "optional",
            mode: "all-or-none",
            hiddenByDefault: true,
            fields: [
              field("upstream.endpoints", "Endpoint map", { requiredWhenGroupUsed: true }),
              field("tools[].rpc.endpointRef", "Tool endpoint ref", { requiredWhenGroupUsed: true })
            ]
          }),
          bindingOptionalGroup(),
          healthCheckOptionalGroup(),
          timeoutOptionalGroup()
        ],
        defaultedGroups: [...templateDefaultGroupsFor(template.templateId), defaultedFieldGroup()],
        materializedOnlyGroups: [materializedOnlyFieldGroup()]
      };
    }
    case EXTERNAL_SERVICE_TEMPLATE_ID.SSE: {
      const endpointGroup = fieldGroup({
        id: "sse-event-endpoint",
        label: "SSE event endpoint",
        kind: "required",
        fields: [
          endpoint("upstream.url", "SSE URL", "https://events.example.com:443/v1/events")
        ]
      });
      const toolGroup = fieldGroup({
        id: "sse-stream-tool",
        label: "SSE stream tool",
        kind: "required",
        fields: [toolName]
      });
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolFamily: "generic-sse",
        endpointField: "upstream.url",
        minimum: fieldGroup({
          id: "minimum-sse",
          label: "Minimum usable draft",
          kind: "minimum",
          fields: [...COMMON_REQUIRED_IDENTITY_GROUP.fields, ...endpointGroup.fields, ...toolGroup.fields]
        }),
        requiredGroups: [COMMON_REQUIRED_IDENTITY_GROUP, endpointGroup, toolGroup],
        optionalGroups: [
          displayRuntimeOptionalGroup(),
          secretAuthOptionalGroup(),
          fieldGroup({
            id: "event-filter",
            label: "Event filters",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [field("tools[].sse.eventTypes", "Allowed event types")]
          }),
          fieldGroup({
            id: "stream-budget",
            label: "Stream budget",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [
              field("tools[].sse.maxEvents", "Max output events"),
              field("tools[].sse.maxBytes", "Max response bytes"),
              field("policies.streaming", "Streaming policy")
            ]
          }),
          bindingOptionalGroup(),
          healthCheckOptionalGroup(),
          timeoutOptionalGroup()
        ],
        defaultedGroups: [...templateDefaultGroupsFor(template.templateId), defaultedFieldGroup()],
        materializedOnlyGroups: [materializedOnlyFieldGroup()]
      };
    }
    case EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY: {
      const endpointGroup = fieldGroup({
        id: "model-gateway-endpoint",
        label: "OpenAI-compatible model endpoint",
        kind: "required",
        fields: [
          endpoint("upstream.url", "Model endpoint URL", "https://api.openai.com:443/v1/responses")
        ]
      });
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolFamily: "openai-compatible-model-gateway",
        endpointField: "upstream.url",
        minimum: fieldGroup({
          id: "minimum-openai-compatible-model-gateway",
          label: "Minimum usable draft",
          kind: "minimum",
          fields: [...COMMON_REQUIRED_IDENTITY_GROUP.fields, ...endpointGroup.fields]
        }),
        requiredGroups: [COMMON_REQUIRED_IDENTITY_GROUP, endpointGroup],
        optionalGroups: [
          displayRuntimeOptionalGroup(),
          fieldGroup({
            id: "model-protocol",
            label: "Model protocol override",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [field("upstream.modelProtocol", "Model protocol", { value: "openai-responses" })]
          }),
          fieldGroup({
            id: "provider",
            label: "Provider hint",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [field("upstream.provider", "Provider", { placeholder: "openai" })]
          }),
          secretAuthOptionalGroup(),
          fieldGroup({
            id: "model-budget",
            label: "Model budget",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [
              field("policies.modelBudget", "Model budget"),
              field("policies.quota", "Quota policy")
            ]
          }),
          fieldGroup({
            id: "redaction",
            label: "Redaction policy",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [field("policies.redaction", "Redaction policy")]
          }),
          fieldGroup({
            id: "routing-overrides",
            label: "Routing overrides",
            kind: "optional",
            mode: "any",
            hiddenByDefault: true,
            fields: [field("policies.routing", "Routing policy")]
          }),
          bindingOptionalGroup(),
          healthCheckOptionalGroup(),
          timeoutOptionalGroup()
        ],
        defaultedGroups: [...templateDefaultGroupsFor(template.templateId), defaultedFieldGroup()],
        materializedOnlyGroups: [materializedOnlyFieldGroup()]
      };
    }
    default:
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolFamily: "custom",
        endpointField: "",
        minimum: fieldGroup({
          id: "minimum-custom",
          label: "Minimum usable draft",
          kind: "minimum",
          fields: COMMON_REQUIRED_IDENTITY_GROUP.fields
        }),
        requiredGroups: [COMMON_REQUIRED_IDENTITY_GROUP],
        optionalGroups: commonOptionalGroups,
        defaultedGroups: [defaultedFieldGroup()],
        materializedOnlyGroups: [materializedOnlyFieldGroup()]
      };
  }
}

const TEMPLATE_DEFINITIONS = Object.freeze([
  {
    templateId: EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP,
    label: "Raw MCP Streamable HTTP",
    runtimeStatus: {
      state: "production-candidate",
      note: "Streamable HTTP discovery/call runtime exists; production promotion still requires ServiceHub gates."
    },
    upstreamType: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP,
    bindingMode: EXTERNAL_SERVICE_BINDING_MODE.PASSTHROUGH,
    requiredFields: [
      "serviceId",
      "upstream.url"
    ],
    requiredCombinations: [
      {
        id: "raw-mcp-http-endpoint",
        allOf: [
          "upstream.url"
        ]
      }
    ],
    minimalRequiredFields: [
      "serviceId",
      "upstream.url"
    ],
    optionalCombinations: [
      {
        id: "secret-auth",
        allOf: ["upstream.auth.type", "upstream.auth.secretRef"],
        note: "Omit auth for public upstreams; when present it must use SecretStore."
      },
      {
        id: "timeout",
        anyOf: ["upstream.timeoutMs"]
      }
    ],
    optionalGroups: [
      "upstream.timeoutMs",
      "upstream.auth.secretRef"
    ],
    defaultedFields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS,
    productionGates: [
      ...SERVICEHUB_PRODUCTION_REQUIRED_GATES,
      "mcp-capability-firewall",
      "upstream-tools-list-adoption"
    ],
    draft: {
      serviceId: "raw-mcp-http-demo",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP,
        transport: EXTERNAL_SERVICE_MCP_TRANSPORT.STREAMABLE_HTTP,
        url: "https://mcp.example.com:443/mcp/"
      }
    }
  },
  {
    templateId: EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_SSE,
    label: "Raw MCP SSE",
    runtimeStatus: {
      state: "production-candidate",
      note: "Legacy MCP HTTP+SSE discovery/call runtime is available; promotion remains gated by egress, SecretStore, adoption, output governance, and verification evidence."
    },
    upstreamType: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP,
    bindingMode: EXTERNAL_SERVICE_BINDING_MODE.PASSTHROUGH,
    requiredFields: [
      "serviceId",
      "upstream.url"
    ],
    requiredCombinations: [
      {
        id: "raw-mcp-sse-endpoint",
        allOf: [
          "upstream.url"
        ]
      }
    ],
    minimalRequiredFields: [
      "serviceId",
      "upstream.url"
    ],
    optionalCombinations: [
      {
        id: "secret-auth",
        allOf: ["upstream.auth.type", "upstream.auth.secretRef"],
        note: "Omit auth for public upstreams; when present it must use SecretStore."
      },
      {
        id: "timeout",
        anyOf: ["upstream.timeoutMs"]
      }
    ],
    optionalGroups: [
      "upstream.timeoutMs",
      "upstream.auth.secretRef"
    ],
    defaultedFields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS,
    productionGates: [
      ...SERVICEHUB_PRODUCTION_REQUIRED_GATES,
      "mcp-capability-firewall",
      "streaming-and-backpressure",
      "upstream-tools-list-adoption"
    ],
    draft: {
      serviceId: "raw-mcp-sse-demo",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.MCP,
        transport: EXTERNAL_SERVICE_MCP_TRANSPORT.SSE,
        url: "https://mcp.example.com:443/sse"
      }
    }
  },
  {
    templateId: EXTERNAL_SERVICE_TEMPLATE_ID.HTTP_JSON,
    label: "HTTP JSON",
    runtimeStatus: {
      state: "production-candidate-with-egress-policy",
      note: "Use for explicitly allowed non-TLS internal or development endpoints."
    },
    upstreamType: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP,
    bindingMode: EXTERNAL_SERVICE_BINDING_MODE.COMPILE,
    requiredFields: [
      "serviceId",
      "upstream.baseUrl",
      "tools[].name",
      "tools[].method",
      "tools[].path"
    ],
    requiredCombinations: [
      {
        id: "http-endpoint",
        allOf: ["upstream.baseUrl"]
      },
      {
        id: "http-tool-mapping",
        allOf: ["tools[].name", "tools[].method", "tools[].path"]
      }
    ],
    minimalRequiredFields: [
      "serviceId",
      "upstream.baseUrl",
      "tools[].name",
      "tools[].method",
      "tools[].path"
    ],
    optionalCombinations: [
      {
        id: "secret-auth",
        allOf: ["upstream.auth.type", "upstream.auth.secretRef"]
      },
      {
        id: "input-contract",
        anyOf: ["tools[].inputSchema"]
      },
      {
        id: "request-mapping",
        anyOf: ["tools[].request.query", "tools[].request.body", "tools[].request.headers"]
      },
      {
        id: "response-projection",
        anyOf: ["tools[].response.resultPath"]
      },
      {
        id: "health-check",
        allOf: ["healthCheck.type=http", "healthCheck.url|healthCheck.port"]
      },
      {
        id: "deadline-retry",
        anyOf: ["upstream.timeoutMs", "policies.retry", "policies.deadline"]
      }
    ],
    optionalGroups: [
      "tools[].inputSchema",
      "tools[].request",
      "tools[].response",
      "upstream.auth.secretRef",
      "healthCheck",
      "timeout/retry overrides"
    ],
    defaultedFields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS,
    productionGates: [
      ...SERVICEHUB_PRODUCTION_REQUIRED_GATES,
      "mapping-sandbox",
      "outbound-payload-governance"
    ],
    draft: {
      serviceId: "http-json-demo",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTP,
        baseUrl: "http://api.internal.example:8080"
      },
      tools: [
        {
          name: "getItem",
          method: "GET",
          path: "/v1/items/{id}"
        }
      ]
    }
  },
  {
    templateId: EXTERNAL_SERVICE_TEMPLATE_ID.HTTPS_JSON,
    label: "HTTPS JSON",
    runtimeStatus: {
      state: "production-candidate",
      note: "Compiled HTTPS JSON runtime exists; production promotion still requires ServiceHub gates."
    },
    upstreamType: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS,
    bindingMode: EXTERNAL_SERVICE_BINDING_MODE.COMPILE,
    requiredFields: [
      "serviceId",
      "upstream.baseUrl",
      "tools[].name",
      "tools[].method",
      "tools[].path"
    ],
    requiredCombinations: [
      {
        id: "https-endpoint",
        allOf: ["upstream.baseUrl"]
      },
      {
        id: "https-tool-mapping",
        allOf: ["tools[].name", "tools[].method", "tools[].path"]
      }
    ],
    minimalRequiredFields: [
      "serviceId",
      "upstream.baseUrl",
      "tools[].name",
      "tools[].method",
      "tools[].path"
    ],
    optionalCombinations: [
      {
        id: "secret-auth",
        allOf: ["upstream.auth.type", "upstream.auth.secretRef"]
      },
      {
        id: "input-contract",
        anyOf: ["tools[].inputSchema"]
      },
      {
        id: "request-mapping",
        anyOf: ["tools[].request.query", "tools[].request.body", "tools[].request.headers"]
      },
      {
        id: "response-projection",
        anyOf: ["tools[].response.resultPath"]
      },
      {
        id: "health-check",
        allOf: ["healthCheck.type=http", "healthCheck.url|healthCheck.port"]
      },
      {
        id: "deadline-retry",
        anyOf: ["upstream.timeoutMs", "policies.retry", "policies.deadline"]
      }
    ],
    optionalGroups: [
      "tools[].inputSchema",
      "tools[].request",
      "tools[].response",
      "upstream.auth.secretRef",
      "healthCheck",
      "timeout/retry overrides"
    ],
    defaultedFields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS,
    productionGates: [
      ...SERVICEHUB_PRODUCTION_REQUIRED_GATES,
      "mapping-sandbox",
      "outbound-payload-governance",
      "tls-verification"
    ],
    draft: {
      serviceId: "https-json-demo",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.HTTPS,
        baseUrl: "https://api.example.com:443"
      },
      tools: [
        {
          name: "searchItems",
          method: "POST",
          path: "/v1/items/search"
        }
      ]
    }
  },
  {
    templateId: EXTERNAL_SERVICE_TEMPLATE_ID.JSON_RPC,
    label: "JSON-RPC",
    runtimeStatus: {
      state: "production-candidate",
      note: "Compiled JSON-RPC runtime maps JSON-RPC error envelopes to failed tool calls."
    },
    upstreamType: EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC,
    bindingMode: EXTERNAL_SERVICE_BINDING_MODE.COMPILE,
    requiredFields: [
      "serviceId",
      "upstream.url",
      "tools[].name"
    ],
    requiredCombinations: [
      {
        id: "json-rpc-tool-method",
        oneOf: ["tools[].method", "tools[].rpc.method"]
      }
    ],
    minimalRequiredFields: [
      "serviceId",
      "upstream.url",
      "tools[].name",
      "tools[].method|tools[].rpc.method"
    ],
    optionalCombinations: [
      {
        id: "secret-auth",
        allOf: ["upstream.auth.type", "upstream.auth.secretRef"]
      },
      {
        id: "rpc-params",
        anyOf: ["tools[].rpc.params", "tools[].request.body"]
      },
      {
        id: "rpc-result",
        anyOf: ["tools[].rpc.resultPath", "tools[].response.resultPath"]
      },
      {
        id: "multi-endpoint",
        allOf: ["upstream.endpoints", "tools[].rpc.endpointRef"]
      }
    ],
    optionalGroups: [
      "tools[].inputSchema",
      "tools[].rpc.params",
      "tools[].response.resultPath",
      "upstream.auth.secretRef",
      "endpoint refs"
    ],
    defaultedFields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS,
    productionGates: [
      ...SERVICEHUB_PRODUCTION_REQUIRED_GATES,
      "mapping-sandbox",
      "json-rpc-id-correlation",
      "json-rpc-error-mapping"
    ],
    draft: {
      serviceId: "json-rpc-demo",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.JSON_RPC,
        url: "https://rpc.example.com:443/jsonrpc"
      },
      tools: [
        {
          name: "lookupTicket",
          method: "ticket.lookup"
        }
      ]
    }
  },
  {
    templateId: EXTERNAL_SERVICE_TEMPLATE_ID.SSE,
    label: "Generic SSE",
    runtimeStatus: {
      state: "production-candidate-bounded",
      note: "Runtime supports bounded GET + events[] parsing with byte/event budgets and cleanup evidence; long-lived stream forwarding is not exposed."
    },
    upstreamType: EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE,
    bindingMode: EXTERNAL_SERVICE_BINDING_MODE.COMPILE,
    requiredFields: [
      "serviceId",
      "upstream.url",
      "tools[].name"
    ],
    requiredCombinations: [
      {
        id: "sse-stream-tool",
        allOf: ["upstream.url", "tools[].name"]
      }
    ],
    minimalRequiredFields: [
      "serviceId",
      "upstream.url",
      "tools[].name"
    ],
    optionalCombinations: [
      {
        id: "event-filter",
        anyOf: ["tools[].sse.eventTypes"]
      },
      {
        id: "stream-budget",
        anyOf: ["tools[].sse.maxEvents", "tools[].sse.maxBytes", "policies.streaming"]
      },
      {
        id: "secret-auth",
        allOf: ["upstream.auth.type", "upstream.auth.secretRef"]
      }
    ],
    optionalGroups: [
      "tools[].sse.eventTypes",
      "tools[].sse.maxEvents",
      "tools[].sse.maxBytes",
      "upstream.auth.secretRef"
    ],
    defaultedFields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS,
    productionGates: [
      ...SERVICEHUB_PRODUCTION_REQUIRED_GATES,
      "streaming-and-backpressure",
      "event-output-governance"
    ],
    draft: {
      serviceId: "sse-demo",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.SSE,
        url: "https://events.example.com:443/v1/events"
      },
      tools: [
        {
          name: "watchEvents"
        }
      ]
    }
  },
  {
    templateId: EXTERNAL_SERVICE_TEMPLATE_ID.OPENAI_MODEL_GATEWAY,
    label: "OpenAI-Compatible Model Gateway",
    runtimeStatus: {
      state: "production-candidate",
      note: "OpenAI-compatible and OpenAI Responses JSON POST forwarding is available as a bounded ServiceHub model gateway tool; non-OpenAI LLM protocol adapters remain scaffolded."
    },
    upstreamType: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM,
    bindingMode: EXTERNAL_SERVICE_BINDING_MODE.COMPILE,
    requiredFields: [
      "serviceId",
      "upstream.url"
    ],
    requiredCombinations: [
      {
        id: "model-gateway-endpoint",
        allOf: ["upstream.url"]
      }
    ],
    minimalRequiredFields: [
      "serviceId",
      "upstream.url"
    ],
    optionalCombinations: [
      {
        id: "model-protocol",
        anyOf: ["upstream.modelProtocol"]
      },
      {
        id: "provider",
        anyOf: ["upstream.provider"]
      },
      {
        id: "secret-auth",
        allOf: ["upstream.auth.type", "upstream.auth.secretRef"]
      },
      {
        id: "model-budget",
        anyOf: ["policies.modelBudget", "policies.quota"]
      },
      {
        id: "redaction",
        anyOf: ["policies.redaction"]
      },
      {
        id: "routing-overrides",
        anyOf: ["policies.routing"]
      }
    ],
    optionalGroups: [
      "upstream.modelProtocol",
      "upstream.provider",
      "upstream.auth.secretRef",
      "model budget",
      "redaction",
      "routing overrides"
    ],
    defaultedFields: SERVICEHUB_DEFAULTED_DRAFT_FIELDS,
    productionGates: [
      ...SERVICEHUB_PRODUCTION_REQUIRED_GATES,
      "model-gateway-runtime-verifier",
      "model-output-redaction",
      "model-budget-quota"
    ],
    draft: {
      serviceId: "openai-compatible-demo",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM,
        url: "https://api.openai.com:443/v1/responses",
        modelProtocol: "openai-responses"
      }
    }
  }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function registryRoot(userDataPath = "") {
  return path.resolve(userDataPath || ServerConfig.getDataDir(), "external-services");
}

function safeFileSegment(value = "") {
  const segment = String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  return segment || "unnamed-service";
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function isLiteralCredentialValue(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  return /^\s*(bearer|basic)\s+\S+/i.test(text) ||
    /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret)\s*[:=]\s*\S+/i.test(text) ||
    /\b(sk-[a-z0-9][a-z0-9_-]{12,}|ghp_[a-z0-9_]{16,}|xox[baprs]-[a-z0-9-]{10,})\b/i.test(text) ||
    /^secret:\/\//i.test(text);
}

function redactConfigValue(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => redactConfigValue(item));
  }
  if (!value || typeof value !== "object") {
    if (
      (/token|password|api[-_]?key|authorization|cookie|secret/i.test(key) && key !== "secretRef") ||
      (key !== "secretRef" && isLiteralCredentialValue(value))
    ) {
      return "[redacted]";
    }
    return value;
  }
  const output = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === "secretRef") {
      output[entryKey] = String(entryValue || "");
      continue;
    }
    if (/token|password|api[-_]?key|authorization|cookie|secret/i.test(entryKey)) {
      output[entryKey] = "[redacted]";
      continue;
    }
    output[entryKey] = redactConfigValue(entryValue, entryKey);
  }
  return output;
}

function summarizeValidation(validation = {}) {
  return {
    ok: validation.ok === true,
    errorCount: Array.isArray(validation.errors) ? validation.errors.length : 0,
    warningCount: Array.isArray(validation.warnings) ? validation.warnings.length : 0,
    errors: Array.isArray(validation.errors) ? validation.errors : [],
    warnings: Array.isArray(validation.warnings) ? validation.warnings : []
  };
}

function summarizeDiscovery(discovery = null) {
  if (!discovery) {
    return {
      ok: false,
      status: "not_run"
    };
  }
  return {
    ok: discovery.ok === true,
    status: discovery.ok === true ? "verified" : "failed",
    serviceId: String(discovery.serviceId || "").trim(),
    toolCount: Number(discovery.toolCount || 0),
    discoveredAt: String(discovery.discoveredAt || "").trim(),
    cachePath: String(discovery.cachePath || "").trim(),
    error: String(discovery.error || "").trim()
  };
}

function templateById(templateId = "") {
  return TEMPLATE_DEFINITIONS.find((template) => template.templateId === templateId) || null;
}

function templateDescriptor(template) {
  const operatorMinimumDraft = createOperatorMinimumDraft(template);
  const minimumDraft = createSelfDescribingMinimumDraft(template);
  const requiredFields = clone(template.minimalRequiredFields || template.requiredFields || []);
  const optionalCombinations = clone(template.optionalCombinations || []);
  const defaultedFields = clone(template.defaultedFields || []);
  const optionalFields = clone(template.optionalGroups || []);
  const fieldModel = createTemplateFieldModel(template);
  const templateInjectedDefaultFields = templateDefaultFields(template.templateId).map((item) => item.path);
  const advancedOptionalFields = SERVICEHUB_ADVANCED_OPTIONAL_FIELDS.filter((field) =>
    optionalFields.includes(field) ||
    optionalFields.some((item) => String(item).includes(field.split(".")[0])) ||
    field === "serviceName" ||
    field === "displayName" ||
    field === "description" ||
    field === "mode" ||
    field === "startupPolicy" ||
    field === "binding" ||
    field === "policies"
  );
  return {
    ...clone(template),
    draft: minimumDraft,
    minimumDraft,
    operatorMinimumDraft,
    materializedDraft: normalizeExternalServiceConfig(minimumDraft),
    fieldModel,
    formContract: {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolFamily: fieldModel.protocolFamily,
      endpointField: fieldModel.endpointField,
      requiredFields,
      templateSelectedRequiredFields: requiredFields,
      directJsonRequiredFields: ["templateId", ...requiredFields],
      requiredCombinations: clone(template.requiredCombinations || []),
      optionalCombinations,
      optionalFields,
      fieldModel,
      minimumUsableCombination: {
        mode: "template-selected",
        fields: requiredFields,
        draft: operatorMinimumDraft
      },
      directJsonMinimumCombination: {
        mode: "self-describing-json",
        fields: ["templateId", ...requiredFields],
        draft: minimumDraft
      },
      fieldCategories: {
        required: requiredFields,
        requiredCombinations: clone(template.requiredCombinations || []),
        optionalCombinations,
        optionalFields,
        advancedOptionalFields,
        defaultedByTemplateFields: templateInjectedDefaultFields,
        defaultedByNormalizerFields: defaultedFields,
        materializedOnlyFields: clone(SERVICEHUB_MATERIALIZED_ONLY_FIELDS)
      },
      defaultedFields,
      advancedOptionalFields,
      materializedOnlyFields: clone(SERVICEHUB_MATERIALIZED_ONLY_FIELDS),
      hiddenByDefaultFields: uniqueStrings([
        ...defaultedFields,
        ...templateInjectedDefaultFields,
        ...SERVICEHUB_ADVANCED_OPTIONAL_FIELDS,
        ...SERVICEHUB_MATERIALIZED_ONLY_FIELDS
      ]),
      minimumDraft,
      operatorMinimumDraft
    }
  };
}

export function listExternalServiceTemplates() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: SERVICEHUB_TEMPLATE_CATALOG_KIND,
    generatedAt: nowIso(),
    defaultPolicyPreset: EXTERNAL_SERVICE_POLICY_PRESET.PRODUCTION_DEFAULT,
    templates: TEMPLATE_DEFINITIONS.map(templateDescriptor)
  };
}

export function getExternalServiceTemplate(templateId = "") {
  const template = templateById(templateId);
  return template ? templateDescriptor(template) : null;
}

export function createExternalServiceDraft({
  templateId = EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP,
  serviceId = ""
} = {}) {
  const template = templateById(templateId) || templateById(EXTERNAL_SERVICE_TEMPLATE_ID.RAW_MCP_STREAMABLE_HTTP);
  const draft = createSelfDescribingMinimumDraft(template);
  if (serviceId) {
    draft.serviceId = serviceId;
  }
  return draft;
}

export function materializeExternalServiceManifest({
  config,
  validation = {},
  discovery = null,
  source = "draft",
  now = nowIso()
} = {}) {
  const normalized = normalizeExternalServiceConfig(config);
  if (!normalized) {
    return null;
  }
  const template = templateById(normalized.templateId);
  const validationSummary = summarizeValidation(validation);
  const discoverySummary = summarizeDiscovery(discovery);
  const productionGates = (template?.productionGates || SERVICEHUB_PRODUCTION_REQUIRED_GATES)
    .map((gateId) => ({
      gateId,
      status: "missing_evidence"
    }));
  const lifecycle = validationSummary.ok
    ? discoverySummary.ok
      ? "contractVerified"
      : "draftVerified"
    : "invalid";
  const redactedConfig = redactConfigValue(normalized);
  const templateContract = template ? {
    templateId: template.templateId,
    label: template.label,
    requiredFields: template.requiredFields || [],
    requiredCombinations: template.requiredCombinations || [],
    minimalRequiredFields: template.minimalRequiredFields,
    optionalCombinations: template.optionalCombinations || [],
    defaultedFields: template.defaultedFields || [],
    optionalGroups: template.optionalGroups,
    fieldModel: templateDescriptor(template).fieldModel,
    formContract: templateDescriptor(template).formContract
  } : null;
  const manifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: SERVICEHUB_MATERIALIZED_MANIFEST_KIND,
    manifestId: `servicehub.manifest.${safeFileSegment(normalized.serviceId)}`,
    serviceId: normalized.serviceId,
    serviceName: normalized.serviceName || normalized.serviceId,
    templateId: normalized.templateId,
    policyPreset: normalized.policyPreset || EXTERNAL_SERVICE_POLICY_PRESET.PRODUCTION_DEFAULT,
    lifecycle,
    productionReady: false,
    generatedAt: now,
    source,
    binding: {
      mode: normalized.binding?.mode || template?.bindingMode || EXTERNAL_SERVICE_BINDING_MODE.PASSTHROUGH,
      outlet: normalized.binding?.outlet || EXTERNAL_SERVICE_BINDING_OUTLET.SERVICE_HUB,
      risk: normalized.binding?.risk || "read_only",
      requiredScopes: Array.isArray(normalized.binding?.requiredScopes) ? normalized.binding.requiredScopes : []
    },
    upstream: {
      type: normalized.upstream?.type || "",
      transport: normalized.upstream?.transport || "",
      url: normalized.upstream?.url || normalized.upstream?.baseUrl || ""
    },
    draftConfigHash: sha256Json(redactedConfig),
    redactedConfig,
    template: templateContract,
    evidence: {
      validation: validationSummary,
      discovery: discoverySummary,
      productionGates
    },
    promotion: {
      status: "not_promoted",
      reason: "Production promotion requires every ServiceHub production gate to provide verifier evidence.",
      missingGateIds: productionGates.map((gate) => gate.gateId)
    }
  };
  manifest.manifestFingerprint = sha256Json({
    schemaVersion: manifest.schemaVersion,
    kind: manifest.kind,
    manifestId: manifest.manifestId,
    serviceId: manifest.serviceId,
    serviceName: manifest.serviceName,
    templateId: manifest.templateId,
    policyPreset: manifest.policyPreset,
    binding: manifest.binding,
    upstream: manifest.upstream,
    draftConfigHash: manifest.draftConfigHash,
    redactedConfig: manifest.redactedConfig,
    template: manifest.template,
    validation: manifest.evidence.validation
  });
  return manifest;
}

export function externalServiceManifestPath({
  userDataPath = "",
  serviceId = ""
} = {}) {
  return path.join(registryRoot(userDataPath), "manifests", `${safeFileSegment(serviceId)}.manifest.json`);
}

export async function writeExternalServiceManifest({
  userDataPath = "",
  manifest
} = {}) {
  if (!manifest?.serviceId) {
    return "";
  }
  const filePath = externalServiceManifestPath({ userDataPath, serviceId: manifest.serviceId });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return filePath;
}

export async function readExternalServiceManifest({
  userDataPath = "",
  serviceId = ""
} = {}) {
  const filePath = externalServiceManifestPath({ userDataPath, serviceId });
  try {
    return {
      filePath,
      manifest: JSON.parse(await fs.readFile(filePath, "utf8"))
    };
  } catch {
    return {
      filePath,
      manifest: null
    };
  }
}
