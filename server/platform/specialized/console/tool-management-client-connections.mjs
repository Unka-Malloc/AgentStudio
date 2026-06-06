export function buildToolManagementClientConnectionRows(
  toolSkillManagementProvider,
  { offlineAfterSeconds = 300 } = {}
) {
  if (typeof toolSkillManagementProvider?.listMcpClientConnections !== "function") {
    return [];
  }
  try {
    return toolSkillManagementProvider.listMcpClientConnections({ offlineAfterSeconds });
  } catch {
    return [];
  }
}
