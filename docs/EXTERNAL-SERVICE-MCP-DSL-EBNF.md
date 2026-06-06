# External Service MCP DSL EBNF

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: External Service MCP DSL EBNF.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 `pact.external-service.config` 的声明式 DSL 语法草案。该 DSL 的目标是让任意已有外部服务在不改造上游代码的前提下，通过配置注册为 Pact 可治理的 MCP 工具面。

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
    schema_version_member ","
    kind_member ","
    service_id_member ","
    display_name_member ","
    mode_member ","
    upstream_member
    [ "," description_member ]
    [ "," startup_policy_member ]
    [ "," lifecycle_member ]
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
service_id_member       ::= '"serviceId"' ":" identifier_string ;
display_name_member     ::= '"displayName"' ":" string ;
description_member      ::= '"description"' ":" string ;
mode_member             ::= '"mode"' ":" mode ;
startup_policy_member   ::= '"startupPolicy"' ":" startup_policy ;
upstream_member         ::= '"upstream"' ":" upstream ;
lifecycle_member        ::= '"lifecycle"' ":" lifecycle ;
health_check_member     ::= '"healthCheck"' ":" health_check ;
mcp_member              ::= '"mcp"' ":" mcp_exposure ;
binding_member          ::= '"binding"' ":" pact_binding ;
tools_member            ::= '"tools"' ":" "[" [ tool_decl { "," tool_decl } ] "]" ;
scopes_member           ::= '"scopes"' ":" "[" [ scope_decl { "," scope_decl } ] "]" ;
policies_member         ::= '"policies"' ":" policies ;
metadata_member         ::= '"metadata"' ":" object ;

mode                    ::= '"managed"' | '"connected"' | '"on-demand"' ;
startup_policy          ::= '"with-platform"' | '"external-only"' | '"on-demand"' ;
identifier_string       ::= string ;
```

## Upstream Grammar

```ebnf
upstream ::=
    http_upstream
  | openapi_upstream
  | grpc_upstream
  | mcp_upstream
  | command_upstream ;

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
    transport_member
    [ "," command_member ]
    [ "," url_member ]
    [ "," auth_member ]
    [ "," timeout_member ]
  "}" ;

command_upstream ::=
  "{"
    '"type"' ":" '"command"' ","
    command_member
    [ "," cwd_member ]
    [ "," env_member ]
    [ "," timeout_member ]
  "}" ;

base_url_member         ::= '"baseUrl"' ":" url_string ;
address_member          ::= '"address"' ":" string ;
url_member              ::= '"url"' ":" url_string ;
spec_url_member         ::= '"specUrl"' ":" url_string ;
spec_file_member        ::= '"specFile"' ":" path_string ;
spec_inline_member      ::= '"spec"' ":" object ;
proto_file_member       ::= '"protoFile"' ":" path_string ;
reflection_member       ::= '"reflection"' ":" boolean ;
transport_member        ::= '"transport"' ":" ( '"stdio"' | '"sse"' | '"streamable-http"' | '"http"' ) ;
command_member          ::= '"command"' ":" command ;
cwd_member              ::= '"cwd"' ":" path_string ;
env_member              ::= '"env"' ":" object ;
default_headers_member  ::= '"defaultHeaders"' ":" object ;
timeout_member          ::= '"timeoutMs"' ":" integer ;
route_map_member        ::= '"routeMap"' ":" route_map ;
retry_member            ::= '"retry"' ":" retry ;
tls_member              ::= '"tls"' ":" tls ;

url_string              ::= string ;
path_string             ::= string ;
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
    '"headers"' ":" object
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

mcp_outlet  ::= '"pact.discovery"' | '"pact.knowledge"' | '"pact.sharedspace"' | '"pact.codespace"' | '"pact.skillHub"' ;
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
    tool_id_member ","
    operation_id_member ","
    label_member ","
    tool_transport_member ","
    input_schema_member
    [ "," output_schema_member ]
    [ "," description_member ]
    [ "," required_scopes_member ]
    [ "," toolsets_member ]
    [ "," risk_member ]
    [ "," read_only_member ]
    [ "," destructive_member ]
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

tool_id_member          ::= '"toolId"' ":" tool_id ;
operation_id_member     ::= '"operationId"' ":" operation_id ;
label_member            ::= '"label"' ":" string ;
tool_transport_member   ::= '"transport"' ":" tool_transport ;
input_schema_member     ::= '"inputSchema"' ":" json_schema ;
output_schema_member    ::= '"outputSchema"' ":" json_schema ;
required_scopes_member  ::= '"requiredScopes"' ":" "[" [ scope_id { "," scope_id } ] "]" ;
toolsets_member         ::= '"toolsets"' ":" "[" [ toolset_id { "," toolset_id } ] "]" ;
risk_member             ::= '"risk"' ":" risk ;
read_only_member        ::= '"readOnly"' ":" boolean ;
destructive_member      ::= '"destructive"' ":" boolean ;
idempotency_member      ::= '"idempotency"' ":" idempotency ;
request_mapping_member  ::= '"request"' ":" request_mapping ;
response_mapping_member ::= '"response"' ":" response_mapping ;
error_mapping_member    ::= '"errors"' ":" error_mapping ;
audit_member            ::= '"audit"' ":" audit_policy ;
rate_limit_member       ::= '"rateLimit"' ":" rate_limit ;
tags_member             ::= '"tags"' ":" "[" [ string { "," string } ] "]" ;

tool_transport          ::= http_tool | grpc_tool | mcp_tool | command_tool ;

http_tool ::=
  "{"
    '"type"' ":" '"http"' ","
    '"method"' ":" http_method ","
    '"path"' ":" path_template
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

command_tool ::=
  "{"
    '"type"' ":" '"command"' ","
    command_member
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
    [ "," redaction_member ]
    [ "," transform_member ]
    [ "," binary_member ]
  "}" ;

status_member     ::= '"status"' ":" "[" [ integer { "," integer } ] "]" ;
data_path_member  ::= '"dataPath"' ":" json_path ;
max_bytes_member  ::= '"maxBytes"' ":" integer ;
redaction_member  ::= '"redaction"' ":" redaction_policy ;
transform_member  ::= '"transform"' ":" transform ;
binary_member     ::= '"binary"' ":" boolean ;

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
    [ "," '"quotas"' ":" quotas_policy ]
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
  "}" ;

quotas_policy ::=
  "{"
    [ '"maxCallsPerMinute"' ":" integer ]
    [ "," '"maxConcurrentCalls"' ":" integer ]
    [ "," '"maxResultBytes"' ":" integer ]
  "}" ;

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

lifecycle ::=
  "{"
    [ '"scripts"' ":" scripts ]
    [ "," '"docker"' ":" object ]
  "}" ;

scripts ::=
  "{"
    [ '"prepare"' ":" script ]
    [ "," '"start"' ":" script ]
    [ "," '"stop"' ":" script ]
    [ "," '"doctor"' ":" script ]
    [ "," '"smoke"' ":" script ]
  "}" ;

script ::=
  "{"
    ( '"path"' ":" path_string | command_member )
    [ "," '"args"' ":" array ]
    [ "," cwd_member ]
    [ "," env_member ]
    [ "," '"required"' ":" boolean ]
    [ "," '"longRunning"' ":" boolean ]
  "}" ;

health_check ::=
  "{"
    '"type"' ":" ( '"none"' | '"http"' | '"command"' )
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
2. `toolId` MUST be globally unique after applying `mcp.toolNamePrefix`.
3. `operationId` SHOULD be stable across versions. Renames SHOULD preserve aliases through explicit migration metadata.
4. `readOnly=true` is only valid when the upstream call has no externally visible side effect.
5. `risk=destructive` MUST require approval before execution through Tool Management.
6. OpenAPI import MUST NOT expose every upstream operation by default in production profiles. Production configs SHOULD use `routeMap.include` or explicit `tools`.
7. Every upstream call MUST produce a Pact audit record containing service id, tool id, operation id, upstream target, status, duration, retry count, and redacted failure evidence.
8. All egress hosts MUST be checked against workspace/tenant egress policy before invocation.
9. Binary responses MUST declare `response.binary=true` and `response.maxBytes`.
10. The runtime MUST compile this DSL into virtual Pact operations and managed tool definitions; it MUST NOT require adding per-service entries to the static operation registry.
11. HTTP and HTTPS upstream URLs MUST include an explicit port. `https://example.com/mcp` is invalid; use `https://example.com:443/mcp`.
12. For `upstream.type="mcp"` and `binding.mode="passthrough"`, the top-level `tools` array is optional and normally omitted. Pact discovers upstream tools through `tools/list` and compiles them into virtual Tool Management operations.
