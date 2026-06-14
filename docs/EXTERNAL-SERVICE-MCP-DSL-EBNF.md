# External Service MCP DSL EBNF

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: External Service MCP DSL EBNF.
- Staleness check: Scanned on 2026-06-14; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 `pact.external-service.config` 的声明式 DSL 语法草案。该 DSL 的目标是让任意已有外部服务在不改造上游代码的前提下，通过配置注册为 Pact 可治理的 MCP 工具面。DSL 文档描述注册配置本身；配置写入、密钥绑定、刷新和删除只能由 operator/admin control plane 执行，不能通过普通 MCP agent 的 `pact.serviceHub` 自助落库。

注册入口必须从类型化模板生成 manifest 草稿，而不是把一个 URL 直接注册成工具。首批模板族为 `external-service.template.raw-mcp-streamable-http`、`external-service.template.raw-mcp-sse`、`external-service.template.http-json`、`external-service.template.https-json`、`external-service.template.json-rpc`、`external-service.template.sse` 和 `external-service.template.openai-model-gateway`。模板必须输出可审查的 ServiceHub Registration Draft、lint 结果、egress policy 预检、secretRef 缺口和 contract verification 计划；保存或 promote 时再物化为带默认策略和证据的 ServiceHub Materialized Manifest。

ServiceHub 外部 MCP passthrough 只接受 HTTP/HTTPS MCP endpoint，不接受 `stdio` MCP、本机 command transport、`cwd/env` 进程启动描述或 stdio bridge。需要接入的本机 MCP 能力必须先由服务所有者暴露为受控 HTTP/HTTPS MCP endpoint，再按本 DSL 注册。

语法采用 JSON-compatible 配置格式。EBNF 只描述可解析结构；权限、密钥、风险和运行时约束见文末语义规则。

## Lexical Grammar

```ebnf
document          ::= object ;

object            ::= "{" [ member { "," member } ] "}" ;
member            ::= string ":" value ;

array             ::= "[" [ value { "," value } ] "]" ;
value             ::= string | number | boolean | null | object | array ;

string            ::= '"' { character } '"' ;
number            ::= integer [ fraction ] [ exponent ] ;
integer           ::= "-"? ( "0" | nonzero_digit { digit } ) ;
fraction          ::= "." digit { digit } ;
exponent          ::= ( "e" | "E" ) ( "+" | "-" )? digit { digit } ;
boolean           ::= "true" | "false" ;
null              ::= "null" ;

character         ::= ? any valid JSON string character ? ;
digit             ::= "0" | nonzero_digit ;
nonzero_digit     ::= "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

## Top-Level Grammar

```ebnf
external_service_config ::=
  "{"
    [ schema_version_member "," ]
    [ kind_member "," ]
    [ template_id_member "," ]
    service_id_member ","
    upstream_member
    [ "," service_name_member ]
    [ "," display_name_member ]
    [ "," mode_member ]
    [ "," policy_preset_member ]
    [ "," description_member ]
    [ "," startup_policy_member ]
    [ "," health_check_member ]
    [ "," mcp_member ]
    [ "," binding_member ]
    [ "," tools_member ]
    [ "," scopes_member ]
    [ "," policies_member ]
    [ "," metadata_member ]
  "}" ;

schema_version_member   ::= '"schemaVersion"' ":" integer ;
kind_member             ::= '"kind"' ":" '"pact.external-service.config"' ;
template_id_member      ::= '"templateId"' ":" external_service_template_id ;
service_id_member       ::= '"serviceId"' ":" identifier_string ;
service_name_member     ::= '"serviceName"' ":" identifier_string ;
display_name_member     ::= '"displayName"' ":" string ;
description_member      ::= '"description"' ":" string ;
mode_member             ::= '"mode"' ":" mode ;
policy_preset_member    ::= '"policyPreset"' ":" policy_preset ;
startup_policy_member   ::= '"startupPolicy"' ":" startup_policy ;
upstream_member         ::= '"upstream"' ":" upstream ;
health_check_member     ::= '"healthCheck"' ":" health_check ;
mcp_member              ::= '"mcp"' ":" mcp_exposure ;
binding_member          ::= '"binding"' ":" pact_binding ;
tools_member            ::= '"tools"' ":" "[" [ tool_decl { "," tool_decl } ] "]" ;
scopes_member           ::= '"scopes"' ":" "[" [ scope_decl { "," scope_decl } ] "]" ;
policies_member         ::= '"policies"' ":" policies ;
metadata_member         ::= '"metadata"' ":" object ;

mode                    ::= '"managed"' | '"connected"' | '"on-demand"' ;
startup_policy          ::= '"with-platform"' | '"external-only"' | '"on-demand"' ;
external_service_template_id ::=
    '"external-service.template.raw-mcp-streamable-http"'
  | '"external-service.template.raw-mcp-sse"'
  | '"external-service.template.http-json"'
  | '"external-service.template.https-json"'
  | '"external-service.template.json-rpc"'
  | '"external-service.template.sse"'
  | '"external-service.template.openai-model-gateway"' ;
policy_preset ::=
    '"servicehub.production-default"'
  | '"servicehub.development-local"'
  | '"servicehub.readonly-minimal"' ;
identifier_string       ::= string ;
```

## Upstream Grammar

```ebnf
upstream ::=
    http_upstream
  | https_upstream
  | json_rpc_upstream
  | sse_upstream
  | openapi_upstream
  | rpc_upstream
  | llm_upstream
  | grpc_upstream
  | mcp_upstream ;

http_upstream ::=
  "{"
    '"type"' ":" '"http"' ","
    base_url_member
    [ "," auth_member ]
    [ "," default_headers_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

https_upstream ::=
  "{"
    '"type"' ":" '"https"' ","
    base_url_member
    [ "," auth_member ]
    [ "," default_headers_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

json_rpc_upstream ::=
  "{"
    '"type"' ":" '"json-rpc"' ","
    url_member
    [ "," '"rpcVersion"' ":" '"2.0"' ]
    [ "," auth_member ]
    [ "," default_headers_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

sse_upstream ::=
  "{"
    '"type"' ":" '"sse"' ","
    url_member
    [ "," '"eventFormat"' ":" sse_event_format ]
    [ "," auth_member ]
    [ "," default_headers_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

openapi_upstream ::=
  "{"
    '"type"' ":" '"openapi"' ","
    base_url_member ","
    ( spec_url_member | spec_file_member | spec_inline_member )
    [ "," auth_member ]
    [ "," default_headers_member ]
    [ "," route_map_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

rpc_upstream ::=
  "{"
    '"type"' ":" '"rpc"' ","
    ( base_url_member | url_member )
    [ "," '"protocol"' ":" string ]
    [ "," '"path"' ":" path_string ]
    [ "," '"endpoints"' ":" ( object | array ) ]
    [ "," auth_member ]
    [ "," default_headers_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

llm_upstream ::=
  "{"
    '"type"' ":" '"llm"' ","
    url_member ","
    '"modelProtocol"' ":" model_protocol
    [ "," '"provider"' ":" identifier_string ]
    [ "," auth_member ]
    [ "," default_headers_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

grpc_upstream ::=
  "{"
    '"type"' ":" '"grpc"' ","
    address_member
    [ "," proto_file_member ]
    [ "," reflection_member ]
    [ "," auth_member ]
    [ "," timeout_member ]
    [ "," retry_member ]
    [ "," tls_member ]
  "}" ;

mcp_upstream ::=
  "{"
    '"type"' ":" '"mcp"' ","
    mcp_transport_member ","
    url_member
    [ "," auth_member ]
    [ "," timeout_member ]
    [ "," tls_member ]
  "}" ;

base_url_member         ::= '"baseUrl"' ":" url_string ;
address_member          ::= '"address"' ":" string ;
url_member              ::= '"url"' ":" url_string ;
spec_url_member         ::= '"specUrl"' ":" url_string ;
spec_file_member        ::= '"specFile"' ":" path_string ;
spec_inline_member      ::= '"spec"' ":" object ;
proto_file_member       ::= '"protoFile"' ":" path_string ;
reflection_member       ::= '"reflection"' ":" boolean ;
mcp_transport_member    ::= '"transport"' ":" ( '"streamable-http"' | '"sse"' ) ;
default_headers_member  ::= '"defaultHeaders"' ":" object ;
timeout_member          ::= '"timeoutMs"' ":" integer ;
route_map_member        ::= '"routeMap"' ":" route_map ;
retry_member            ::= '"retry"' ":" retry ;
tls_member              ::= '"tls"' ":" tls ;

url_string              ::= string ;
path_string             ::= string ;
model_protocol          ::= '"openai-compatible"' | '"openai-responses"' | '"anthropic-messages"' | '"gemini-generate-content"' | '"custom-json-http"' ;
sse_event_format        ::= '"text-event-stream"' | '"json-data"' | '"ndjson-data"' ;
```

## Auth Grammar

```ebnf
auth_member ::= '"auth"' ":" auth ;

auth ::=
    no_auth
  | bearer_auth
  | api_key_auth
  | basic_auth
  | oauth_auth
  | custom_header_auth ;

no_auth ::=
  "{"
    '"type"' ":" '"none"'
  "}" ;

bearer_auth ::=
  "{"
    '"type"' ":" '"bearer"' ","
    secret_ref_member
  "}" ;

api_key_auth ::=
  "{"
    '"type"' ":" '"apiKey"' ","
    secret_ref_member ","
    '"in"' ":" ( '"header"' | '"query"' ) ","
    '"name"' ":" string
  "}" ;

basic_auth ::=
  "{"
    '"type"' ":" '"basic"' ","
    username_secret_ref_member ","
    password_secret_ref_member
  "}" ;

oauth_auth ::=
  "{"
    '"type"' ":" '"oauth2"' ","
    token_secret_ref_member
    [ "," scopes_array_member ]
    [ "," refresh_member ]
  "}" ;

custom_header_auth ::=
  "{"
    '"type"' ":" '"customHeader"' ","
    '"headerSecretRefs"' ":" "[" header_secret_ref { "," header_secret_ref } "]"
  "}" ;

header_secret_ref ::=
  "{"
    '"name"' ":" string ","
    secret_ref_member
    [ "," '"redactionName"' ":" string ]
  "}" ;

secret_ref_member           ::= '"secretRef"' ":" secret_ref ;
username_secret_ref_member  ::= '"usernameSecretRef"' ":" secret_ref ;
password_secret_ref_member  ::= '"passwordSecretRef"' ":" secret_ref ;
token_secret_ref_member     ::= '"tokenSecretRef"' ":" secret_ref ;
scopes_array_member         ::= '"scopes"' ":" "[" [ string { "," string } ] "]" ;
refresh_member              ::= '"refresh"' ":" object ;
secret_ref                  ::= string ;
```

## MCP Exposure Grammar

```ebnf
mcp_exposure ::=
  "{"
    '"serverName"' ":" identifier_string
    [ "," '"serverVersion"' ":" string ]
    [ "," '"toolNamePrefix"' ":" identifier_string ]
    [ "," '"outlet"' ":" mcp_outlet ]
    [ "," '"visibility"' ":" visibility ]
    [ "," '"instructions"' ":" string ]
  "}" ;

mcp_outlet  ::= '"pact.discovery"' | '"pact.agentLibrary"' | '"pact.sharedspace"' | '"pact.codespace"' | '"pact.skillHub"' | '"pact.agentRelay"' | '"pact.serviceHub"' ;
visibility  ::= '"private"' | '"workspace"' | '"tenant"' | '"public"' ;
```

## Pact Binding Grammar

```ebnf
pact_binding ::=
  "{"
    '"mode"' ":" binding_mode
    [ "," '"outlet"' ":" mcp_outlet ]
    [ "," '"requiredScopes"' ":" "[" [ scope_id { "," scope_id } ] "]" ]
    [ "," '"risk"' ":" risk ]
    [ "," '"metadata"' ":" object ]
  "}" ;

binding_mode ::= '"passthrough"' | '"compile"' ;
```

## Tool Grammar

```ebnf
tool_decl ::=
  "{"
    tool_name_member
    [ "," tool_id_member ]
    [ "," operation_id_member ]
    [ "," label_member ]
    [ "," tool_transport_member ]
    [ "," tool_method_member ]
    [ "," tool_path_member ]
    [ "," input_schema_member ]
    [ "," output_schema_member ]
    [ "," description_member ]
    [ "," required_scopes_member ]
    [ "," toolsets_member ]
    [ "," risk_member ]
    [ "," read_only_member ]
    [ "," destructive_member ]
    [ "," side_effecting_member ]
    [ "," idempotency_member ]
    [ "," request_mapping_member ]
    [ "," response_mapping_member ]
    [ "," error_mapping_member ]
    [ "," audit_member ]
    [ "," rate_limit_member ]
    [ "," retry_member ]
    [ "," timeout_member ]
    [ "," tags_member ]
  "}" ;

tool_name_member        ::= '"name"' ":" tool_id ;
tool_id_member          ::= '"toolId"' ":" tool_id ;
operation_id_member     ::= '"operationId"' ":" operation_id ;
label_member            ::= '"label"' ":" string ;
tool_transport_member   ::= '"transport"' ":" tool_transport ;
tool_method_member      ::= '"method"' ":" string ;
tool_path_member        ::= '"path"' ":" path_string ;
input_schema_member     ::= '"inputSchema"' ":" json_schema ;
output_schema_member    ::= '"outputSchema"' ":" json_schema ;
required_scopes_member  ::= '"requiredScopes"' ":" "[" [ scope_id { "," scope_id } ] "]" ;
toolsets_member         ::= '"toolsets"' ":" "[" [ toolset_id { "," toolset_id } ] "]" ;
risk_member             ::= '"risk"' ":" risk ;
read_only_member        ::= '"readOnly"' ":" boolean ;
destructive_member      ::= '"destructive"' ":" boolean ;
side_effecting_member   ::= '"sideEffecting"' ":" boolean ;
idempotency_member      ::= '"idempotency"' ":" idempotency ;
request_mapping_member  ::= '"request"' ":" request_mapping ;
response_mapping_member ::= '"response"' ":" response_mapping ;
error_mapping_member    ::= '"errors"' ":" error_mapping ;
audit_member            ::= '"audit"' ":" audit_policy ;
rate_limit_member       ::= '"rateLimit"' ":" rate_limit ;
tags_member             ::= '"tags"' ":" "[" [ string { "," string } ] "]" ;

tool_transport          ::= http_tool | json_rpc_tool | sse_tool | grpc_tool | mcp_tool ;

http_tool ::=
  "{"
    '"type"' ":" '"http"' ","
    '"method"' ":" http_method ","
    '"path"' ":" path_template
  "}" ;

json_rpc_tool ::=
  "{"
    '"type"' ":" '"json-rpc"' ","
    '"method"' ":" string
  "}" ;

sse_tool ::=
  "{"
    '"type"' ":" '"sse"'
    [ "," '"path"' ":" path_template ]
    [ "," '"eventTypes"' ":" "[" [ string { "," string } ] "]" ]
  "}" ;

grpc_tool ::=
  "{"
    '"type"' ":" '"grpc"' ","
    '"service"' ":" string ","
    '"method"' ":" string
  "}" ;

mcp_tool ::=
  "{"
    '"type"' ":" '"mcp"' ","
    '"name"' ":" string
  "}" ;

http_method     ::= '"GET"' | '"POST"' | '"PUT"' | '"PATCH"' | '"DELETE"' ;
risk            ::= '"read_only"' | '"safe_write"' | '"repair_write"' | '"destructive"' ;
tool_id         ::= identifier_string ;
operation_id    ::= identifier_string ;
scope_id        ::= identifier_string ;
toolset_id      ::= identifier_string ;
path_template   ::= string ;
json_schema     ::= object ;
```

## Mapping Grammar

```ebnf
request_mapping ::=
  "{"
    [ path_params_member ]
    [ "," query_params_member ]
    [ "," header_params_member ]
    [ "," body_member ]
    [ "," body_template_member ]
  "}" ;

path_params_member    ::= '"pathParams"' ":" object ;
query_params_member   ::= '"query"' ":" object ;
header_params_member  ::= '"headers"' ":" object ;
body_member           ::= '"body"' ":" object ;
body_template_member  ::= '"bodyTemplate"' ":" string ;

response_mapping ::=
  "{"
    [ status_member ]
    [ "," data_path_member ]
    [ "," max_bytes_member ]
    [ "," content_types_member ]
    [ "," max_text_chars_member ]
    [ "," max_json_depth_member ]
    [ "," redaction_member ]
    [ "," transform_member ]
    [ "," binary_member ]
    [ "," asset_ref_member ]
  "}" ;

status_member     ::= '"status"' ":" "[" [ integer { "," integer } ] "]" ;
data_path_member  ::= '"dataPath"' ":" json_path ;
max_bytes_member  ::= '"maxBytes"' ":" integer ;
content_types_member ::= '"contentTypes"' ":" "[" [ string { "," string } ] "]" ;
max_text_chars_member ::= '"maxTextChars"' ":" integer ;
max_json_depth_member ::= '"maxJsonDepth"' ":" integer ;
redaction_member  ::= '"redaction"' ":" redaction_policy ;
transform_member  ::= '"transform"' ":" transform ;
binary_member     ::= '"binary"' ":" boolean ;
asset_ref_member  ::= '"assetRef"' ":" asset_ref_policy ;

asset_ref_policy ::=
  "{"
    [ '"forBinary"' ":" boolean ]
    [ "," '"forLargeResult"' ":" boolean ]
    [ "," '"target"' ":" ( '"agentLibrary"' | '"sharedspace"' ) ]
  "}" ;

error_mapping ::=
  "{"
    [ '"retryOn"' ":" "[" [ integer { "," integer } ] "]" ]
    [ "," '"map"' ":" object ]
  "}" ;

json_path          ::= string ;
redaction_policy  ::= '"none"' | '"default"' | '"strict"' | '"summary"' ;
transform         ::= object ;
```

## Policy Grammar

```ebnf
scope_decl ::=
  "{"
    '"id"' ":" scope_id ","
    '"label"' ":" string
    [ "," '"description"' ":" string ]
  "}" ;

policies ::=
  "{"
    [ '"defaultRisk"' ":" risk ]
    [ "," '"approval"' ":" approval_policy ]
    [ "," '"egress"' ":" egress_policy ]
    [ "," '"outboundPayload"' ":" outbound_payload_policy ]
    [ "," '"mappingSandbox"' ":" mapping_sandbox_policy ]
    [ "," '"secretBinding"' ":" secret_binding_policy ]
    [ "," '"mcpCapabilityFirewall"' ":" mcp_capability_firewall_policy ]
    [ "," '"mcpSession"' ":" mcp_session_policy ]
    [ "," '"circuitBreaker"' ":" circuit_breaker_policy ]
    [ "," '"deadline"' ":" deadline_policy ]
    [ "," '"streaming"' ":" streaming_policy ]
    [ "," '"grantProjection"' ":" grant_projection_policy ]
    [ "," '"verification"' ":" verification_policy ]
    [ "," '"promotion"' ":" promotion_policy ]
    [ "," '"receipt"' ":" receipt_policy ]
    [ "," '"quotas"' ":" quotas_policy ]
    [ "," '"errorTaxonomy"' ":" error_taxonomy_policy ]
    [ "," '"reconciliation"' ":" reconciliation_policy ]
  "}" ;

approval_policy ::=
  "{"
    [ '"requireForRiskAtLeast"' ":" risk ]
    [ "," '"approvalScope"' ":" scope_id ]
  "}" ;

egress_policy ::=
  "{"
    [ '"allowedHosts"' ":" "[" [ string { "," string } ] "]" ]
    [ "," '"deniedHosts"' ":" "[" [ string { "," string } ] "]" ]
    [ "," '"allowedProtocols"' ":" "[" [ string { "," string } ] "]" ]
    [ "," '"allowedPorts"' ":" "[" [ integer { "," integer } ] "]" ]
    [ "," '"allowPrivateNetworks"' ":" boolean ]
    [ "," '"allowLoopback"' ":" boolean ]
    [ "," '"allowLinkLocal"' ":" boolean ]
    [ "," '"allowMetadataService"' ":" boolean ]
    [ "," '"redirectPolicy"' ":" redirect_policy ]
  "}" ;

redirect_policy ::=
  "{"
    [ '"follow"' ":" boolean ]
    [ "," '"maxRedirects"' ":" integer ]
    [ "," '"recheckEgress"' ":" boolean ]
  "}" ;

outbound_payload_policy ::=
  "{"
    [ '"required"' ":" boolean ]
    [ "," '"allowedDataClasses"' ":" "[" [ data_class { "," data_class } ] "]" ]
    [ "," '"allowedInputFields"' ":" "[" [ string { "," string } ] "]" ]
    [ "," '"maxBytes"' ":" integer ]
    [ "," '"maxJsonDepth"' ":" integer ]
    [ "," '"maxTextChars"' ":" integer ]
    [ "," '"allowAssetRefs"' ":" boolean ]
    [ "," '"assetRefMode"' ":" asset_ref_mode ]
    [ "," '"blockSecrets"' ":" boolean ]
    [ "," '"blockHiddenPrompts"' ":" boolean ]
    [ "," '"blockRawWorkspaceAssets"' ":" boolean ]
    [ "," '"requirePerFieldMapping"' ":" boolean ]
    [ "," '"redaction"' ":" redaction_policy ]
  "}" ;

data_class ::=
    '"user_provided"'
  | '"agent_visible_context"'
  | '"metadata"'
  | '"workspace_content"'
  | '"agent_library_content"'
  | '"regulated"'
  | '"secret_like"' ;

asset_ref_mode ::=
    '"deny"'
  | '"allow_governed_ref"'
  | '"deny_raw_require_projection"' ;

mapping_sandbox_policy ::=
  "{"
    [ '"required"' ":" boolean ]
    [ "," '"allowedLanguages"' ":" "[" [ mapping_language { "," mapping_language } ] "]" ]
    [ "," '"allowedFunctions"' ":" "[" [ string { "," string } ] "]" ]
    [ "," '"maxExpressionBytes"' ":" integer ]
    [ "," '"maxTemplateBytes"' ":" integer ]
    [ "," '"maxOutputBytes"' ":" integer ]
    [ "," '"maxJsonDepth"' ":" integer ]
    [ "," '"maxArrayItems"' ":" integer ]
    [ "," '"maxEvaluationMs"' ":" integer ]
    [ "," '"memoryBytes"' ":" integer ]
    [ "," '"allowRegex"' ":" boolean ]
    [ "," '"blockEval"' ":" boolean ]
    [ "," '"blockNetwork"' ":" boolean ]
    [ "," '"blockFileSystem"' ":" boolean ]
    [ "," '"blockEnv"' ":" boolean ]
    [ "," '"blockProcess"' ":" boolean ]
    [ "," '"blockDynamicUrlAuthHeaders"' ":" boolean ]
    [ "," '"deterministic"' ":" boolean ]
  "}" ;

mapping_language ::=
    '"json-pointer"'
  | '"jsonpath-safe"'
  | '"template-safe"'
  | '"jq-safe-subset"' ;

secret_binding_policy ::=
  "{"
    [ '"mode"' ":" secret_binding_mode ]
    [ "," '"requiredSecretRefs"' ":" "[" [ secret_ref { "," secret_ref } ] "]" ]
    [ "," '"publicProjection"' ":" secret_projection ]
    [ "," '"invalidateOnRotation"' ":" boolean ]
    [ "," '"requireHealthRecheckOnChange"' ":" boolean ]
  "}" ;

secret_binding_mode ::=
    '"none"'
  | '"operator_admin"' ;

secret_projection ::=
    '"configured_status_only"'
  | '"redacted_ref"' ;

mcp_capability_firewall_policy ::=
  "{"
    [ '"toolsOnly"' ":" boolean ]
    [ "," '"allowedMethods"' ":" "[" [ mcp_allowed_method { "," mcp_allowed_method } ] "]" ]
    [ "," '"blockedCapabilities"' ":" "[" [ mcp_blocked_capability { "," mcp_blocked_capability } ] "]" ]
    [ "," '"blockClientCallbacks"' ":" boolean ]
    [ "," '"treatPromptsAsData"' ":" boolean ]
  "}" ;

mcp_allowed_method ::=
    '"initialize"'
  | '"tools/list"'
  | '"tools/call"' ;

mcp_blocked_capability ::=
    '"resources"'
  | '"prompts"'
  | '"roots"'
  | '"sampling"'
  | '"elicitation"'
  | '"logging"'
  | '"notifications"'
  | '"clientCallbacks"' ;

mcp_session_policy ::=
  "{"
    [ '"isolation"' ":" mcp_session_isolation ]
    [ "," '"sharedSessionSafe"' ":" boolean ]
    [ "," '"invalidateOnGrantRevoke"' ":" boolean ]
    [ "," '"invalidateOnSecretRotation"' ":" boolean ]
    [ "," '"stateTtlSeconds"' ":" integer ]
  "}" ;

mcp_session_isolation ::=
    '"grant_subject_workspace_auth"'
  | '"workspace_auth"'
  | '"service_shared"' ;

circuit_breaker_policy ::=
  "{"
    [ '"enabled"' ":" boolean ]
    [ "," '"scope"' ":" circuit_breaker_scope ]
    [ "," '"failureThreshold"' ":" integer ]
    [ "," '"failureWindowSeconds"' ":" integer ]
    [ "," '"openSeconds"' ":" integer ]
    [ "," '"halfOpenMaxProbes"' ":" integer ]
    [ "," '"failFast"' ":" boolean ]
  "}" ;

circuit_breaker_scope ::=
    '"service"'
  | '"operation"'
  | '"auth_binding"' ;

deadline_policy ::=
  "{"
    [ '"maxDurationMs"' ":" integer ]
    [ "," '"leaseTtlMs"' ":" integer ]
    [ "," '"acquireTimeoutMs"' ":" integer ]
    [ "," '"cancelPropagation"' ":" cancel_propagation ]
    [ "," '"orphanCleanup"' ":" orphan_cleanup_policy ]
  "}" ;

cancel_propagation ::=
    '"none"'
  | '"best_effort_abort"' ;

orphan_cleanup_policy ::=
  "{"
    [ '"enabled"' ":" boolean ]
    [ "," '"afterMs"' ":" integer ]
    [ "," '"reconcile"' ":" boolean ]
  "}" ;

streaming_policy ::=
  "{"
    [ '"enabled"' ":" boolean ]
    [ "," '"allowedTransports"' ":" "[" [ streaming_transport { "," streaming_transport } ] "]" ]
    [ "," '"allowedEventTypes"' ":" "[" [ string { "," string } ] "]" ]
    [ "," '"maxDurationMs"' ":" integer ]
    [ "," '"maxBytes"' ":" integer ]
    [ "," '"maxChunkBytes"' ":" integer ]
    [ "," '"maxEventsPerSecond"' ":" integer ]
    [ "," '"bufferBytes"' ":" integer ]
    [ "," '"backpressure"' ":" backpressure_mode ]
    [ "," '"partialResultPolicy"' ":" partial_result_policy ]
    [ "," '"cancelPropagation"' ":" cancel_propagation ]
    [ "," '"governEachChunk"' ":" boolean ]
    [ "," '"emitReceiptOnPartial"' ":" boolean ]
  "}" ;

streaming_transport ::=
    '"streamable-http"'
  | '"sse"'
  | '"http-chunked"'
  | '"model-stream"' ;

backpressure_mode ::=
    '"pause_read"'
  | '"buffer_then_error"'
  | '"drop_and_error"' ;

partial_result_policy ::=
    '"discard"'
  | '"governed_partial"'
  | '"asset_ref_only"' ;

grant_projection_policy ::=
  "{"
    [ '"hideUnauthorized"' ":" boolean ]
    [ "," '"realTimeAuthorize"' ":" boolean ]
    [ "," '"requiredDimensions"' ":" "[" [ grant_projection_dimension { "," grant_projection_dimension } ] "]" ]
  "}" ;

grant_projection_dimension ::=
    '"service"'
  | '"operation"'
  | '"risk"'
  | '"tenant"'
  | '"workspace"'
  | '"egress"'
  | '"dataClass"'
  | '"secretBinding"' ;

verification_policy ::=
  "{"
    [ '"required"' ":" boolean ]
    [ "," '"failClosed"' ":" boolean ]
    [ "," '"checks"' ":" "[" [ verification_check { "," verification_check } ] "]" ]
    [ "," '"evidenceStoreRef"' ":" string ]
  "}" ;

verification_check ::=
    '"stableOutletSet"'
  | '"legacyOutletRemoval"'
  | '"templateDryRunStatic"'
  | '"rawMcpHttpOnly"'
  | '"manifestBoundInvocation"'
  | '"mappingSandbox"'
  | '"outboundPayloadGovernance"'
  | '"egressResolvedIpRedirect"'
  | '"secretStoreRedaction"'
  | '"toolAdoptionGate"'
  | '"grantProjection"'
  | '"mcpCapabilityFirewall"'
  | '"quotaBulkhead"'
  | '"errorTaxonomyRetryHint"'
  | '"reconciliationRecovery"'
  | '"healthCircuitBreaker"'
  | '"deadlineCancellationUnknownOutcome"'
  | '"streamingBackpressure"'
  | '"versionedPromotionRollback"'
  | '"outputGovernance"'
  | '"externalCallReceipt"' ;

promotion_policy ::=
  "{"
    [ '"mode"' ":" promotion_mode ]
    [ "," '"candidateRequired"' ":" boolean ]
    [ "," '"requireContractVerification"' ":" boolean ]
    [ "," '"requireRegressionVerification"' ":" boolean ]
    [ "," '"rollbackEnabled"' ":" boolean ]
    [ "," '"retainVersions"' ":" integer ]
  "}" ;

promotion_mode ::=
    '"operator_admin"'
  | '"disabled"' ;

catalog_lifecycle_state ::=
    '"candidate"'
  | '"active"'
  | '"deprecated"'
  | '"rolled_back"'
  | '"retired"' ;

receipt_policy ::=
  "{"
    [ '"required"' ":" boolean ]
    [ "," '"redaction"' ":" redaction_policy ]
    [ "," '"includeFields"' ":" "[" [ receipt_field { "," receipt_field } ] "]" ]
    [ "," '"forbidRawRequestResponse"' ":" boolean ]
    [ "," '"evidenceStoreRef"' ":" string ]
  "}" ;

receipt_field ::=
    '"serviceId"'
  | '"catalogVersion"'
  | '"operationId"'
  | '"grantRef"'
  | '"tenantWorkspace"'
  | '"risk"'
  | '"egressDecision"'
  | '"mappingSandbox"'
  | '"outboundGovernance"'
  | '"quotaBulkhead"'
  | '"errorTaxonomy"'
  | '"reconciliation"'
  | '"secretFingerprint"'
  | '"deadlineLease"'
  | '"retryCircuit"'
  | '"streamingBackpressure"'
  | '"upstreamStatusClass"'
  | '"outputGovernance"'
  | '"redactionSummary"'
  | '"assetRefs"'
  | '"unknownOutcome"'
  | '"recoveryStatus"'
  | '"auditRef"' ;

quotas_policy ::=
  "{"
    [ '"maxCallsPerMinute"' ":" integer ]
    [ "," '"maxConcurrentCalls"' ":" integer ]
    [ "," '"maxResultBytes"' ":" integer ]
    [ "," '"scope"' ":" "[" [ quota_scope { "," quota_scope } ] "]" ]
    [ "," '"queue"' ":" queue_policy ]
    [ "," '"bulkhead"' ":" bulkhead_policy ]
    [ "," '"byteBudget"' ":" byte_budget_policy ]
    [ "," '"streamBudget"' ":" stream_budget_policy ]
    [ "," '"retryBudget"' ":" retry_budget_policy ]
    [ "," '"modelBudget"' ":" model_budget_policy ]
    [ "," '"failClosed"' ":" boolean ]
  "}" ;

quota_scope ::=
    '"service"'
  | '"operation"'
  | '"tenant"'
  | '"workspace"'
  | '"grant"'
  | '"subject"'
  | '"auth_binding"'
  | '"upstream_host"'
  | '"transport_class"'
  | '"model_gateway"' ;

queue_policy ::=
  "{"
    [ '"maxQueued"' ":" integer ]
    [ "," '"queueTtlMs"' ":" integer ]
    [ "," '"fairBy"' ":" "[" [ quota_scope { "," quota_scope } ] "]" ]
  "}" ;

bulkhead_policy ::=
  "{"
    [ '"workerPool"' ":" bulkhead_limit ]
    [ "," '"connectionPool"' ":" bulkhead_limit ]
    [ "," '"streamBuffer"' ":" bulkhead_limit ]
  "}" ;

bulkhead_limit ::=
  "{"
    [ '"maxGlobal"' ":" integer ]
    [ "," '"maxPerService"' ":" integer ]
    [ "," '"maxPerAuthBinding"' ":" integer ]
  "}" ;

byte_budget_policy ::=
  "{"
    [ '"maxRequestBytesPerMinute"' ":" integer ]
    [ "," '"maxResponseBytesPerMinute"' ":" integer ]
    [ "," '"maxTotalBytesPerHour"' ":" integer ]
  "}" ;

stream_budget_policy ::=
  "{"
    [ '"maxEventsPerMinute"' ":" integer ]
    [ "," '"maxStreamSecondsPerHour"' ":" integer ]
    [ "," '"maxBufferedBytes"' ":" integer ]
  "}" ;

retry_budget_policy ::=
  "{"
    [ '"maxRetriesPerMinute"' ":" integer ]
    [ "," '"retryBudgetRatio"' ":" number ]
  "}" ;

model_budget_policy ::=
  "{"
    [ '"maxInputTokensPerMinute"' ":" integer ]
    [ "," '"maxOutputTokensPerMinute"' ":" integer ]
    [ "," '"maxCostPerHourCents"' ":" integer ]
    [ "," '"currency"' ":" string ]
  "}" ;

error_taxonomy_policy ::=
  "{"
    [ '"required"' ":" boolean ]
    [ "," '"envelope"' ":" '"pact-servicehub-error-v1"' ]
    [ "," '"redaction"' ":" redaction_policy ]
    [ "," '"includeFields"' ":" "[" [ error_envelope_field { "," error_envelope_field } ] "]" ]
    [ "," '"categories"' ":" "[" [ error_category { "," error_category } ] "]" ]
    [ "," '"allowedCodes"' ":" "[" [ servicehub_error_code { "," servicehub_error_code } ] "]" ]
    [ "," '"nonEnumerableAuthorizationErrors"' ":" boolean ]
    [ "," '"allowProviderMessages"' ":" boolean ]
    [ "," '"allowProviderDebug"' ":" boolean ]
    [ "," '"retryHint"' ":" retry_hint_policy ]
    [ "," '"failClosed"' ":" boolean ]
  "}" ;

error_envelope_field ::=
    '"pactCode"'
  | '"category"'
  | '"message"'
  | '"retryable"'
  | '"retryAfterMs"'
  | '"unknownOutcome"'
  | '"auditRef"'
  | '"receiptRef"'
  | '"serviceId"'
  | '"operationId"'
  | '"catalogVersion"'
  | '"statusClass"' ;

error_category ::=
    '"visibility_or_authorization"'
  | '"policy_denied"'
  | '"manifest_or_contract"'
  | '"egress_denied"'
  | '"secret_unavailable"'
  | '"mapping_failed"'
  | '"outbound_blocked"'
  | '"quota_or_bulkhead"'
  | '"deadline_or_cancelled"'
  | '"stream_failed"'
  | '"output_blocked"'
  | '"upstream_unavailable"'
  | '"upstream_protocol"'
  | '"unknown_external_outcome"'
  | '"internal_servicehub_error"' ;

servicehub_error_code ::=
    '"not_found_or_not_authorized"'
  | '"grant_denied"'
  | '"service_disabled"'
  | '"tool_not_adopted"'
  | '"contract_verification_required"'
  | '"egress_denied"'
  | '"secret_missing"'
  | '"secret_scope_mismatch"'
  | '"mapping_input_invalid"'
  | '"mapping_sandbox_violation"'
  | '"mapping_timeout"'
  | '"mapping_output_too_large"'
  | '"outbound_payload_blocked"'
  | '"quota_exceeded"'
  | '"concurrency_limited"'
  | '"service_busy"'
  | '"queue_full"'
  | '"queue_timeout"'
  | '"bulkhead_saturated"'
  | '"byte_budget_exceeded"'
  | '"model_budget_exhausted"'
  | '"upstream_unavailable"'
  | '"service_degraded"'
  | '"circuit_open"'
  | '"deadline_exceeded"'
  | '"call_cancelled"'
  | '"stream_limit_exceeded"'
  | '"stream_cancelled"'
  | '"stream_backpressure"'
  | '"partial_result_truncated"'
  | '"output_governance_blocked"'
  | '"upstream_error"'
  | '"upstream_protocol_error"'
  | '"unknown_external_outcome"'
  | '"internal_servicehub_error"' ;

retry_hint_policy ::=
  "{"
    [ '"includeRetryable"' ":" boolean ]
    [ "," '"includeRetryAfterMs"' ":" boolean ]
    [ "," '"maxRetryAfterMs"' ":" integer ]
    [ "," '"deriveFrom"' ":" "[" [ retry_hint_source { "," retry_hint_source } ] "]" ]
    [ "," '"upstreamRetryAfterAdvisoryOnly"' ":" boolean ]
    [ "," '"requireIdempotencyForWriteRetry"' ":" boolean ]
    [ "," '"hideQuotaDetailsFromUnauthorized"' ":" boolean ]
  "}" ;

retry_hint_source ::=
    '"servicehub_policy"'
  | '"operation_risk"'
  | '"idempotency"'
  | '"ledger_attempt"'
  | '"circuit_state"'
  | '"quota_budget"'
  | '"upstream_retry_after"' ;

reconciliation_policy ::=
  "{"
    [ '"requiredForRiskAtLeast"' ":" risk ]
    [ "," '"sideEffectingDefault"' ":" boolean ]
    [ "," '"unknownOutcomeMode"' ":" unknown_outcome_mode ]
    [ "," '"idempotency"' ":" reconciliation_idempotency_policy ]
    [ "," '"statusQuery"' ":" recovery_operation_ref ]
    [ "," '"reconcileOperation"' ":" recovery_operation_ref ]
    [ "," '"compensationOperation"' ":" recovery_operation_ref ]
    [ "," '"operatorRecovery"' ":" operator_recovery_policy ]
    [ "," '"recoveryStates"' ":" "[" [ recovery_state { "," recovery_state } ] "]" ]
    [ "," '"maxRecoveryWindowSeconds"' ":" integer ]
    [ "," '"blockReplayUntilResolved"' ":" boolean ]
    [ "," '"agentVisibleStatus"' ":" boolean ]
    [ "," '"failClosed"' ":" boolean ]
  "}" ;

unknown_outcome_mode ::=
    '"record_and_block_replay"'
  | '"record_and_allow_readonly_status"'
  | '"operator_recovery_only"' ;

reconciliation_idempotency_policy ::=
  "{"
    [ '"required"' ":" boolean ]
    [ "," '"scope"' ":" idempotency_scope ]
    [ "," '"keyFrom"' ":" string ]
    [ "," '"fingerprintOnly"' ":" boolean ]
  "}" ;

idempotency_scope ::=
    '"operation"'
  | '"service"'
  | '"upstream_resource"'
  | '"tenant_workspace"' ;

recovery_operation_ref ::=
  "{"
    '"operationId"' ":" operation_id
    [ "," '"risk"' ":" risk ]
    [ "," '"readOnly"' ":" boolean ]
    [ "," '"requiredScopes"' ":" "[" [ scope_id { "," scope_id } ] "]" ]
  "}" ;

operator_recovery_policy ::=
  "{"
    [ '"enabled"' ":" boolean ]
    [ "," '"workflowRef"' ":" string ]
    [ "," '"agentCanRequest"' ":" boolean ]
    [ "," '"requiresOperatorDecision"' ":" boolean ]
  "}" ;

recovery_state ::=
    '"confirmed_succeeded"'
  | '"confirmed_no_effect"'
  | '"confirmed_failed_with_effect"'
  | '"compensated"'
  | '"still_unknown"'
  | '"requires_operator_recovery"' ;

rate_limit ::=
  "{"
    [ '"callsPerMinute"' ":" integer ]
    [ "," '"concurrency"' ":" integer ]
  "}" ;

retry ::=
  "{"
    [ '"maxAttempts"' ":" integer ]
    [ "," '"backoffMs"' ":" integer ]
    [ "," '"retryOn"' ":" "[" [ integer { "," integer } ] "]" ]
  "}" ;

tls ::=
  "{"
    [ '"verify"' ":" boolean ]
    [ "," '"caSecretRef"' ":" secret_ref ]
    [ "," '"clientCertSecretRef"' ":" secret_ref ]
  "}" ;

audit_policy ::=
  "{"
    [ '"enabled"' ":" boolean ]
    [ "," '"recordInput"' ":" boolean ]
    [ "," '"recordOutput"' ":" boolean ]
    [ "," '"receipt"' ":" boolean ]
  "}" ;

idempotency ::=
  "{"
    [ '"keyFrom"' ":" string ]
    [ "," '"required"' ":" boolean ]
  "}" ;

health_check ::=
  "{"
    '"type"' ":" ( '"none"' | '"http"' )
    [ "," url_member ]
    [ "," '"host"' ":" string ]
    [ "," '"port"' ":" integer ]
    [ "," '"path"' ":" string ]
    [ "," timeout_member ]
    [ "," '"required"' ":" boolean ]
  "}" ;

command ::=
  "{"
    '"executable"' ":" string
    [ "," '"args"' ":" array ]
  "}" ;

route_map ::=
  "{"
    [ '"include"' ":" "[" [ route_selector { "," route_selector } ] "]" ]
    [ "," '"exclude"' ":" "[" [ route_selector { "," route_selector } ] "]" ]
    [ "," '"rename"' ":" object ]
  "}" ;

route_selector ::=
  "{"
    [ '"operationId"' ":" string ]
    [ "," '"method"' ":" http_method ]
    [ "," '"path"' ":" path_template ]
    [ "," '"tag"' ":" string ]
  "}" ;
```

## Semantic Rules

1. `secretRef` MUST reference Pact SecretStore by reference only. Secret values MUST NOT appear in DSL documents, MCP responses, trace payloads, checkpoint nodes, or exports.
2. Ordinary MCP agents MUST NOT submit, read, update, rotate, or rebind external service secret values through `pact.serviceHub`, `pact.discovery`, template draft, dry-run, or invocation operations.
3. Templates and agent-visible drafts MAY expose secret slots, suggested `secretRef` placeholders, missing-secret diagnostics, and configured/missing status only. Public MCP projections MUST NOT expose secret values.
4. Runtime MUST resolve `secretRef` server-side and inject the secret only into manifest-declared auth or transport locations. Agent input MUST NOT carry upstream tokens, cookies, passwords, OAuth access/refresh tokens, or provider sessions.
5. `auth.type="customHeader"` MUST use named `headerSecretRefs`; literal secret header values and arbitrary custom header objects are invalid in ServiceHub registration drafts and materialized manifests.
6. Secret binding scope MUST include service id, workspace/tenant where applicable, allowed upstream host/protocol, auth scheme, and allowed capability scope. Binding mismatch MUST fail closed.
7. Secret rotation, revocation, scope downgrade, or SecretStore entry expiry MUST invalidate related upstream MCP sessions, auth context, discovery caches, and health state, and SHOULD require controlled health or contract recheck before returning to healthy.
8. Operator-facing drafts MAY use `name` as the only stable tool identity. Materialized manifests MUST generate a globally unique `toolId` after applying the ServiceHub namespace and any `mcp.toolNamePrefix`.
9. Materialized `operationId` SHOULD be stable across versions. Drafts MAY omit it; renames SHOULD preserve aliases through explicit migration metadata.
10. `readOnly=true` is only valid when the upstream call has no externally visible side effect.
11. `sideEffecting=true` MUST NOT be combined with `readOnly=true` and MUST require at least `risk=safe_write`.
12. `risk=destructive` MUST require approval before execution through Tool Management.
13. OpenAPI import MUST NOT expose every upstream operation by default in production profiles. Production configs SHOULD use `routeMap.include` or explicit `tools`.
14. Every upstream call MUST produce a Pact audit record containing service id, tool id, operation id, upstream target, status, duration, retry count, and redacted failure evidence.
15. All egress hosts MUST be checked against workspace/tenant egress policy before invocation.
16. Binary responses MUST declare `response.binary=true` and `response.maxBytes`.
17. The runtime MUST compile this DSL into virtual Pact operations and managed tool definitions; it MUST NOT require adding per-service entries to the static operation registry.
18. HTTP and HTTPS upstream URLs MUST include an explicit port. `https://example.com/mcp` is invalid; use `https://example.com:443/mcp`.
19. ServiceHub raw MCP passthrough MUST use HTTP or HTTPS addressed MCP transports only. `upstream.type="mcp"` MUST include a URL whose scheme is `http` or `https`, with explicit host, port, and path.
20. `transport="stdio"`, `upstream.type="command"`, command tool transports, command/args/cwd/env launch descriptors, and stdio bridges are invalid in ServiceHub external-service registrations and MUST be rejected even when hand-written outside the template flow.
21. ServiceHub raw MCP passthrough MUST be tools-only. Pact MAY call upstream `initialize`, `tools/list`, and `tools/call`; it MUST NOT expose or forward upstream resources, prompts, roots, sampling, elicitation, logging, arbitrary notifications, or client callbacks to downstream agents.
22. Upstream MCP requests that attempt to make Pact or the downstream agent sample a model, read resources, provide roots, accept prompt injection, open an extra interaction channel, or subscribe to non-tool notifications MUST be rejected or ignored and audited as blocked capability attempts.
23. Upstream `notifications/tools/list_changed` MAY only mark the upstream tool cache as stale. It MUST NOT directly alter downstream `tools/list`; changes still require Tool Adoption Gate and operator/admin adoption.
24. Prompt-like content returned by upstream tools MUST be treated as untrusted data and MUST NOT become system prompts, tool descriptions, authorization policy, or hidden instructions.
25. For `upstream.type="mcp"` and `binding.mode="passthrough"`, the top-level `tools` array is optional and normally omitted. Pact discovers upstream tools through `tools/list` over the HTTP/HTTPS MCP endpoint and compiles them into virtual Tool Management operations.
26. `templateId` selects the required field combination. Template-selected operator drafts MAY omit it because the control-plane route already selected the template. Self-describing JSON drafts MUST include it unless `upstream.type + upstream.transport` can infer exactly one template. Materialized manifests MUST store the explicit `templateId`. HTTP JSON, HTTPS JSON, JSON-RPC, SSE, raw MCP streamable HTTP, raw MCP SSE, and OpenAI model gateway templates MUST NOT be collapsed into one ambiguous URL template.
27. `schemaVersion`, `kind`, `serviceName`, `mode`, `startupPolicy`, `binding`, `policyPreset`, `metadata`, full `policies`, `upstream.type`, raw MCP `upstream.transport`, JSON-RPC `rpcVersion=2.0`, and generic SSE `eventFormat=json-data` MAY be omitted by operator-facing drafts when they equal template defaults. The materialized manifest MUST record `schemaVersion=v0.0.1:schema:definition-1`, `kind=pact.external-service.config`, the adopted `policyPreset`, `binding.outlet=pact.serviceHub`, protocol defaults, and expanded policy evidence before promotion. Hand-written `policies` blocks are optional overrides, not required boilerplate.
28. Raw MCP streamable HTTP and raw MCP SSE templates MAY omit `tools`; HTTP JSON, HTTPS JSON, JSON-RPC, and generic SSE templates MUST declare at least one tool mapping unless a template-specific generator creates one with verifier evidence.
29. After template default injection, `upstream.type="http"` MUST use an `http://` base URL, `upstream.type="https"` MUST use an `https://` base URL, `upstream.type="json-rpc"` MUST use JSON-RPC 2.0 framing, and `upstream.type="sse"` MUST use server-sent event framing. Runtime MUST reject mismatched template/type/protocol combinations.
30. OpenAI-compatible model gateway registrations MUST use `upstream.type="llm"` and declare the model protocol explicitly. Retired `upstream.type="openai"` input MUST be rejected with an actionable migration error. `openai-compatible` and `openai-responses` MAY omit `tools[]` because ServiceHub generates the bounded model forwarding tool; other LLM protocols MUST NOT be reported as production-ready until their protocol adapter has a passing live or contract verifier.
31. Ordinary MCP template dry-run MUST be static and MUST NOT perform upstream network requests, DNS probes, token probes, remote spec fetches, or MCP discovery.
32. Live contract verification MUST be an operator/admin control-plane operation with egress preflight, explicit confirmation, timeout, rate limit, audit, and read-only probe limits.
33. Runtime invocation MUST be manifest-bound. Agent input MUST NOT override upstream URL, method, path, authorization, cookies, proxy, TLS options, or arbitrary headers.
34. If a tool requires business headers, each header MUST be declared explicitly in the manifest with schema validation, allowlist mapping, and redaction/audit policy. Wildcard header pass-through from agent input is invalid.
35. Request mappings, response mappings, error mappings, `bodyTemplate`, and `transform` MUST run in the Mapping Sandbox declarative safe subset. They MUST NOT execute JavaScript, eval, WASM, shell commands, plugins, or arbitrary user-defined code.
36. Mapping evaluation MUST NOT access filesystem, network, environment variables, process state, system secrets, SecretStore values, hidden prompts, internal paths, or authorization overlays. Mapping MUST NOT dynamically override upstream URL, method, path, auth, cookies, proxy, TLS, wildcard headers, or retry/deadline controls.
37. Mapping evaluation MUST be deterministic and bounded by expression length, template size, output size, JSON depth, array length, CPU/time, memory, recursion, and regex policy. Catastrophic regex, unbounded loops, and data-dependent remote lookups are invalid.
38. Mapping failures MUST return normalized `mapping_input_invalid`, `mapping_sandbox_violation`, `mapping_timeout`, or `mapping_output_too_large`, write denied audit, and emit an `externalCallReceipt` containing mapping policy and failure summary without rendered request bodies, response bodies, intermediate values, or secrets.
39. Every outbound upstream request payload MUST pass Outbound Payload Governance after schema validation and before egress. Runtime MUST enforce declared fields, data classes, size, JSON depth, text length, asset/ref handling, and redaction policy.
40. Secrets, tokens, cookies, hidden/system/developer prompts, Pact internal instructions, raw workspace files, raw AgentLibrary content, unauthorized data classes, unauthorized asset refs, debug context, internal paths, and full conversation transcripts MUST NOT be sent upstream unless a manifest policy and current grant explicitly allow a governed projection.
41. AgentLibrary or SharedSpace content MAY be sent upstream only as an authorized derived/projection view or governed ref declared by manifest. Raw assets, loan records, authorization overlays, and internal storage paths MUST NOT be serialized into upstream request bodies or queries.
42. Outbound payload blocks MUST return `outbound_payload_blocked`, write denied audit, and emit an `externalCallReceipt` containing only outbound governance decision, field summary, dataClass summary, redaction summary, and auditRef, not request body content.
43. Every invocation MUST have a server-enforced deadline derived from manifest, Tool Management policy, ServiceHub policy, and platform maximums. Agent input MUST NOT override timeout, deadline, lease TTL, concurrency limits, or cancellation policy.
44. Runtime MUST acquire a concurrency lease before calling upstream and MUST record attempt/fence evidence in the Operation Ledger. Lease failure MUST return `service_busy` or `concurrency_limited` rather than creating unbounded wait.
45. Client disconnect, MCP request cancellation, deadline expiry, or shutdown MAY propagate best-effort upstream abort/cancel. Cancellation of side-effecting operations MUST NOT be treated as success unless Pact can prove the upstream did not execute.
46. Deadline expiry, disconnect, or ambiguous cancellation for side-effecting operations MUST produce `unknown_external_outcome` or enter a manifest-declared reconciliation path.
47. Timed-out or abandoned calls MUST release local leases, record redacted timeout evidence, update circuit breaker evidence, and run orphan cleanup or reconciliation. Runtime MUST NOT silently complete abandoned calls to a disconnected agent.
48. `safe_write`, `repair_write`, `destructive`, or explicitly side-effecting ServiceHub operations MUST declare a reconciliation policy before production promotion. The policy MUST provide idempotency, a read-only status query, a reconciliation operation, a compensation operation, or an operator recovery workflow.
49. `unknown_external_outcome` MUST create a recovery record with operation ledger attempt/fence, idempotency fingerprint, external reference fingerprint when available, candidate recovery operations, deadline/circuit evidence, recovery state, and auditRef. Automatic replay MUST be blocked until recovery resolves or an operator recovery path explicitly allows a governed next action.
50. Recovery and reconciliation operations MUST remain manifest-bound, grant-authorized, egress-governed, secret-injected, mapping-sandboxed, quota/bulkheaded, error-taxonomized, output-governed, and receipt-audited. Agents MAY read redacted recovery status or trigger declared read-only status queries only when current grant allows it; they MUST NOT forge recovery evidence or resolved states.
51. Upstream streaming responses MUST NOT be raw-passed to agents. Streamable HTTP, SSE, HTTP chunked, model gateway streams, and MCP stream chunks MUST pass through Streaming And Backpressure controls before any downstream emission.
52. Runtime MUST enforce streaming event/content allowlists, max chunk bytes, total bytes, total duration, event rate, bounded buffers, partial-result policy, cancellation, and backpressure behavior declared by manifest and platform maxima.
53. Every stream chunk, frame, or event MUST pass Output Governance and redaction before downstream delivery. Provider debug chunks, raw headers, cookies, token fragments, stack traces, unauthorized assets, and ungoverned binary chunks MUST NOT be emitted.
54. Downstream backpressure MUST pause upstream reads or fail with a governed `stream_backpressure` / `stream_limit_exceeded` / `partial_result_truncated` error. Runtime MUST NOT buffer unbounded streams or return ungoverned tail chunks on error paths.
55. Streaming cancellation, deadline expiry, buffer overflow, or stream parse failure MUST release leases, update circuit/timeout evidence, record chunk/byte/duration summaries, and emit a redacted receipt. Partial results MUST be governed chunks or governed asset refs only.
56. ServiceHub quotas and bulkheads MUST be enforced by service, operation, tenant/workspace, grant/subject, auth binding, upstream host, transport class, and model gateway where applicable. Agent input MUST NOT override quota, priority, queue, worker, connection, stream-buffer, retry, token, or cost budgets.
57. Runtime MUST bound rate, concurrency, queue length, queue TTL, connection pool, worker pool, request bytes, response bytes, stream events, stream buffer bytes, retry attempts, model input/output tokens, and model cost. A single upstream, agent, tenant, or auth binding MUST NOT exhaust global ServiceHub capacity.
58. Quota/Bulkhead rejection MUST return `quota_exceeded`, `concurrency_limited`, `queue_full`, `queue_timeout`, `bulkhead_saturated`, `byte_budget_exceeded`, or `model_budget_exhausted`, write audit evidence, and emit a redacted receipt. Rejected calls MUST NOT acquire later deadline leases, stream buffers, upstream connections, or retry slots.
59. Every ServiceHub invocation error returned to a downstream MCP agent MUST be a Pact-owned normalized error envelope, carried in MCP `error.data.pactError`. Runtime MUST NOT pass through upstream HTTP bodies, MCP error data, provider exceptions, TLS/DNS/socket details, stack traces, internal paths, private object ids, or provider debug payloads.
60. ServiceHub error envelopes MUST include a stable `pactCode`, category, redacted message, `retryable`, optional bounded `retryAfterMs`, `unknownOutcome`, `auditRef`, and optional `receiptRef`. `serviceId`, `operationId`, `catalogVersion`, health state, quota bucket, or provider status class MAY be returned only when current grant visibility allows them.
61. Retry hints MUST be derived from ServiceHub policy, operation risk, idempotency, Operation Ledger attempt/fence evidence, circuit state, and quota budget. Upstream retry headers MAY be advisory inputs only. Unauthorized, unadopted, disabled, or grant-invisible services MUST default to non-enumerating `not_found_or_not_authorized` errors.
62. Egress policy MUST default deny. Allowed hosts, protocols, ports, and address classes MUST be explicit before any upstream network call.
63. Production egress MUST reject loopback, private networks, link-local, cloud metadata addresses, container/orchestration management networks, and local management ports unless an operator/admin explicitly permits a local service with owner, purpose, expiry, and audit.
64. Runtime egress checks MUST validate the resolved IP address after DNS resolution and MUST repeat validation after every redirect. Hostname allowlists alone are not sufficient.
65. External MCP passthrough session state MUST default to `grant_subject_workspace_auth` isolation. Initialized upstream MCP sessions, tool auth context, cursors, pagination tokens, conversation ids, and other stateful upstream context MUST NOT be shared across Pact grant/subject, workspace/tenant, or auth binding boundaries.
66. Runtime MAY reuse low-level TCP/HTTP connection pools, but connection pooling MUST NOT share initialized MCP session state or upstream auth context across authorization boundaries.
67. `service_shared` isolation or `sharedSessionSafe=true` is valid only when the upstream is verified stateless and operator/admin policy explicitly permits it. It MUST NOT expose one agent's upstream MCP session id, cursor, pagination token, or conversation id to another agent.
68. Grant revocation, secretRef rotation, workspace/tenant unbinding, or service disable MUST invalidate related upstream MCP sessions. Upstream session ids, cursors, pagination tokens, and conversation ids MUST be treated as secret-like runtime state and MUST NOT be returned as tool output.
69. Upstream MCP `tools/list` metadata MUST be treated as untrusted. Runtime MUST namespace tool names, sanitize title/description/instructions, validate schemas against a supported safe subset, allowlist annotations, and derive risk from Pact policy rather than trusting upstream annotations.
70. Upstream tool cache MUST store fingerprints and operator-visible diffs. New tools, schema expansion, risk upgrades, destructive/write tools, or substantial metadata changes MUST remain hidden until explicitly adopted by operator/admin policy.
71. Refresh, rediscovery, manifest change, endpoint change, secretRef change, egress policy change, schema change, risk change, metadata change, quota/bulkhead policy change, error taxonomy policy change, reconciliation policy change, mapping sandbox change, outbound policy change, streaming policy change, or output policy change MUST create a candidate catalog version first. It MUST NOT overwrite the active production catalog directly.
72. Candidate versions MUST include fingerprints, operator-visible diffs, contract verification evidence or plan, Tool Adoption Gate results, grant projection impact, regression verification evidence, and rollback plan.
73. Only operator/admin promote MAY make a candidate version active. Promote MUST update projection version, emit needed `notifications/tools/list_changed`, invalidate related sessions/caches/health state, and write audit evidence.
74. Previous active versions MUST be retained as rollback targets according to policy. Rollback MUST be operator/admin controlled, audited, projection-versioned, and must invalidate sessions/caches/health state for the rolled-back version.
75. Existing grants MAY remain bound to a previous active version during a governed migration window. Failed candidates MUST NOT leak schema, risk, metadata, or partial visibility into downstream tools.
76. ServiceHub tool visibility MUST be grant-projected. A tool is visible only when service is enabled, tool is adopted, grant allows service id and operation id, risk is within grant maxRisk, tenant/workspace match, egress and dataClass policies allow it, secret binding is configured and scoped, and the service/tool is not disabled.
77. Unauthorized services and tools SHOULD be hidden from `tools/list`, `pact.capabilities.list`, and discovery projections by default. Hidden tools MUST NOT expose name, schema, description, health, or existence metadata to unauthorized agents.
78. Every ServiceHub invocation MUST perform real-time authorization against current grant and policy state. Runtime MUST NOT treat prior `tools/list` visibility as an execution permit.
79. Grant, tenant/workspace binding, risk policy, egress/dataClass policy, secret binding, service enabled, or tool adoption changes MUST update projection version and trigger `notifications/tools/list_changed` when the current grant's visible set changes.
80. `tools/list` and `pact.capabilities.list` MUST be driven by the adopted stable catalog and current grant projection, not by live upstream health state. Temporary upstream outage, timeout, DNS failure, degraded health, or open circuit MUST NOT automatically remove tools or rewrite schemas.
81. Only operator/admin adoption, disable, delete, schema/risk change, or authorization policy change MAY change the visible ServiceHub tool catalog and trigger `notifications/tools/list_changed`.
82. When invocation is blocked by upstream availability, runtime MUST return a normalized `upstream_unavailable`, `service_degraded`, or `circuit_open` error with redacted message, retry hint, service id, operation id, health state, and audit reference when visible.
83. Circuit breakers MUST track failures at service, operation, or auth-binding scope, fail fast while open, limit concurrent probes, and move back to healthy only after controlled health or contract recheck. Circuit breaker behavior MUST NOT create retry storms or blindly replay side-effecting operations.
84. Every ServiceHub invocation, including success, denial, mapping sandbox block, quota/bulkhead rejection, error normalization, timeout, circuit-open, cancellation, upstream error, outbound payload block, streaming/backpressure stop, output-governance failure, recovery state change, and `unknown_external_outcome`, MUST emit a redacted `externalCallReceipt` and return or link an `auditRef`.
85. `externalCallReceipt` MUST record service, catalog version, operation, redacted grant/subject references, tenant/workspace, risk, Tool Adoption Gate fingerprint, egress decision, mapping sandbox decision, outbound governance decision, quota/bulkhead decision, error taxonomy decision, reconciliation decision, streaming/backpressure decision, secretRef fingerprint, auth binding, deadline/lease, retry attempt, circuit state, upstream status class, latency bucket, output governance decision, redaction summary, governed assetRefs, unknown outcome marker, recovery status, error code, retry hint, and auditRef.
86. `externalCallReceipt` MUST NOT contain secret values, raw Authorization/header/cookie data, raw URL query, raw request body, raw response body, mapping intermediate values, raw stream chunks, provider debug data, stack traces, internal paths, private object ids, or full upstream request ids. Diagnostic evidence MUST be stored only as governed redacted evidence refs.
87. Upstream responses MUST NOT be returned raw. Runtime MUST enforce content-type allowlists, size limits, JSON/text normalization, redaction, and error normalization before returning content to agents.
88. Upstream response headers, cookies, authentication metadata, redirects, server banners, provider debug traces, internal paths, private object ids, and stack traces MUST NOT be passed through to agents.
89. Binary, large, HTML/script, compressed, media, or unknown content-type responses MUST be stored as governed asset references and read through AgentLibrary or SharedSpace authorization rather than inline tool output.
90. Automatic retry MUST default to disabled. Only `read_only` operations with explicit idempotency and retry policy MAY retry automatically.
91. `safe_write`, `repair_write`, and `destructive` operations MUST require an `idempotencyKey`, ledger attempt/fence evidence, and explicit retry policy before any retry is allowed.
92. Timeout, disconnect, or ambiguous upstream failures for side-effecting operations MUST produce `unknown_external_outcome` and MUST NOT be automatically replayed.
93. Production ServiceHub profiles MUST set `policies.verification.required=true` and `failClosed=true`. Missing verifier evidence, stale evidence, or a failed verifier MUST block candidate promotion and MUST prevent affected tools from entering downstream `tools/list`.
94. Production Verification Matrix checks MUST cover stable outlet set, legacy `pact.knowledge`/`pact.call` removal, static template dry-run, HTTP/HTTPS-only raw MCP, manifest-bound invocation, Mapping Sandbox, Outbound Payload Governance, resolved-IP and redirect egress checks, SecretStore-only credential injection and redaction, Tool Adoption Gate, Grant Projection, MCP Capability Firewall, Quota And Bulkhead, Error Taxonomy And Retry Hint, Reconciliation And Recovery, health/circuit behavior, deadline/cancellation/unknown-outcome handling, Streaming And Backpressure, versioned promotion/rollback, Output Governance, and external-call receipt redaction.
95. Ordinary MCP agents MAY read redacted verifier summaries through discovery when authorized, but MUST NOT submit, edit, override, or forge verifier evidence. Live verification probes MUST remain operator/admin control-plane operations with egress preflight, limits, and audit.
