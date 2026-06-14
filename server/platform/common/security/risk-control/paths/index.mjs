export const RISK_CONTROL_PATHS = Object.freeze([
  {
    pathId: "client-mcp-ingress-request",
    label: "Client MCP ingress request",
    controls: Object.freeze([
      "client.registration.admit",
      "client.agent-identity.bind",
      "client.mcp-grant.authorize",
      "client.operation-permission.authorize",
      "client.high-risk-confirmation.approve",
      "client.path-safety.execute",
      "client.access-receipt.audit"
    ])
  },
  {
    pathId: "tool-grant-request",
    label: "Tool grant request",
    controls: Object.freeze([
      "client.mcp-grant.authorize",
      "client.opaque-key.bind",
      "platform.capability-verify.authorize",
      "platform.binding-verify.authorize",
      "platform.tool-management.authorize",
      "platform.operation-ledger.audit"
    ])
  },
  {
    pathId: "external-service-egress-request",
    label: "External service egress request",
    controls: Object.freeze([
      "external.provider-registration.admit",
      "external.credential-secret.bind",
      "external.provider-scope.authorize",
      "external.destructive-operation.approve",
      "external.export-semantics.execute",
      "external.provider-rate-limit.execute",
      "external.provider-receipt.audit"
    ])
  },
  {
    pathId: "platform-self-governance-request",
    label: "Platform self-governance request",
    controls: Object.freeze([
      "platform.console-auth.admit",
      "platform.binding-guard.bind",
      "platform.capability-kernel.authorize",
      "platform.risk-policy.approve",
      "platform.operation-ledger.execute",
      "platform.audit.audit"
    ])
  }
]);
