import { registerPlatformService } from "../../interactive/platform-registry.mjs";

export function registerSecurityPlatformServices(registry, {
  securityPermissions = null,
  consoleAuth = null,
  operationAuditStore = null,
  processIdentity = null
} = {}) {
  return [
    registerPlatformService(registry, {
      id: "security.permissions.provider",
      platform: "security",
      label: "Security permissions provider",
      kind: "authorization-provider",
      ownerFeatureId: "security-permissions",
      value: securityPermissions
    }),
    registerPlatformService(registry, {
      id: "security.auth.console",
      platform: "security",
      label: "Console authentication",
      kind: "auth",
      ownerFeatureId: "security-permissions",
      value: consoleAuth
    }),
    registerPlatformService(registry, {
      id: "security.audit.operations",
      platform: "security",
      label: "Operation audit store",
      kind: "audit",
      ownerFeatureId: "security-permissions",
      value: operationAuditStore
    }),
    registerPlatformService(registry, {
      id: "security.process_identity",
      platform: "security",
      label: "Process identity service",
      kind: "identity-binding",
      ownerFeatureId: "security-permissions",
      value: processIdentity
    })
  ];
}
