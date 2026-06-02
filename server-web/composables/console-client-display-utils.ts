import type { ClientMigrationState, ServerConsoleState } from "../lib/types";
import { migrationStateLabels } from "./console-defaults";
import { migrationTone } from "./console-status-utils";

type ClientConnectionRow = NonNullable<ServerConsoleState["clients"]["items"][number]>;

export function clientConnectionMethodLabel(client: ClientConnectionRow) {
  if (client.connectionKind === "mcp-plugin") {
    return "MCP 服务";
  }
  return String(client.connectionMethod || "pact-client 封装");
}

export function clientConnectionDetail(client: ClientConnectionRow) {
  if (client.connectionDetail) {
    return String(client.connectionDetail);
  }
  if (client.connectionKind === "mcp-plugin") {
    return client.sourceGrantId ? `授权 ${client.sourceGrantId}` : "Tool Management 授权";
  }
  return "Discovery Check-in";
}

export function clientStatusLabel(client: ClientConnectionRow) {
  if (client.connectionKind === "mcp-plugin") {
    return String(client.connectionStatusLabel || "已配对");
  }
  return migrationStateLabels[client.migrationState as ClientMigrationState] || "未知";
}

export function clientStatusTone(client: ClientConnectionRow) {
  if (client.connectionKind !== "mcp-plugin") {
    return migrationTone(client.migrationState as ClientMigrationState);
  }

  if (
    client.connectionState === "disabled" ||
    client.connectionState === "revoked" ||
    client.connectionState === "offline"
  ) {
    return "offline";
  }
  if (client.connectionState === "pending") {
    return "attention";
  }
  return "aligned";
}
