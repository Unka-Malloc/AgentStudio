import type { useConsole } from "./useConsole";

type ConsoleContext = ReturnType<typeof useConsole>;

const toolManagementShellKeys = [
  "activeToolManagementToolCount",
  "addAgentPermissionGroup",
  "agentPermissionGroups",
  "busyKey",
  "copyIssuedToolToken",
  "createGrant",
  "deleteGrant",
  "enabledToolGrantCount",
  "ensureAgentPermissionGroupsDraft",
  "grantHasToolset",
  "grantToolRuleState",
  "internalToolManagementToolCount",
  "issuedToolToken",
  "newGrantLabel",
  "newGrantScopes",
  "newGrantToolsets",
  "permissionGroupHasToolset",
  "policyPreviewGrantId",
  "policyPreviewProfileId",
  "policyPreviewProfileOptionBarOptions",
  "policyPreviewResult",
  "policyPreviewToolId",
  "policyPreviewToolOptionBarOptions",
  "previewToolPolicy",
  "refreshToolManagement",
  "removeAgentPermissionGroup",
  "rotateGrant",
  "saveAgentPermissionSettings",
  "selectToolForManagement",
  "selectedToolManagementTool",
  "setGrantToolRule",
  "settingsDraft",
  "toggleGrantToolset",
  "toggleNewGrantToolset",
  "togglePermissionGroupToolset",
  "toolGrants",
  "toolManagementAuditItems",
  "toolManagementCatalogState",
  "toolManagementMetricsState",
  "toolManagementProfiles",
  "toolManagementRiskRows",
  "toolManagementStatusRows",
  "toolManagementTools",
  "toolManagementToolsets",
  "toolScopes",
  "updateGrant",
] as const satisfies readonly (keyof ConsoleContext)[];

export type ToolManagementShellContext = Pick<ConsoleContext, (typeof toolManagementShellKeys)[number]>;

export function pickToolManagementShellContext(context: ConsoleContext): ToolManagementShellContext {
  return Object.fromEntries(toolManagementShellKeys.map((key) => [key, context[key]])) as ToolManagementShellContext;
}
